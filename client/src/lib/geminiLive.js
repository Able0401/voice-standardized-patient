// Gemini Live browser transport. Used by the "live" pipeline (demo/live.js).
// Imports nothing but the SDK, so the bundle never carries case text or server secrets.
//
// - Connects the WebSocket (@google/genai live.connect) with an ephemeral token minted by the server.
//   The whole session config is locked into the token, so the browser cannot change instructions,
//   model, or voice.
// - Microphone: an AudioWorklet produces 16 kHz 16-bit PCM and sends it as realtimeInput.audio.
// - Patient audio: 24 kHz PCM chunks are scheduled back to back through WebAudio. When the server
//   signals `interrupted` (the visitor started talking), the queue is cleared.
//   The output node is also connected to a MediaStreamDestination so callers can record the remote side.
// - With `resumable`, a goAway or drop leads to a new token that carries the last sessionResumption
//   handle (connection lifetime is roughly 10 minutes). Because the token locks the full config, the
//   server has to put the handle into the token; the client cannot add it. The demo does not use this.

import { GoogleGenAI } from '@google/genai';

const IN_RATE = 16000;
const OUT_RATE = 24000;
const MAX_RECONNECTS = 3;

// Worklet that downsamples the input rate (usually 48 kHz) to 16 kHz and emits Int16 chunks of about 50 ms.
const WORKLET = `
class PcmDown extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${IN_RATE}; this.pos = 0; this.out = new Int16Array(800); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(800); this.n = 0; }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('pcm-down', PcmDown);
`;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function pcm16ToFloat(b64) {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
  }
  return out;
}

/**
 * Utterance boundaries. Server signals decide where one utterance ends; there is no client-side
 * silence timer.
 * - Visitor: input transcription accumulates until the first patient output, an explicit flushUser(),
 *   or a turnComplete in which the patient did not speak.
 * - Patient: output transcription accumulates until turnComplete or interrupted.
 * onUserText/onAssistantText receive (text, startTime).
 */
export function createTurnAssembler({ onUserText, onAssistantText, onSpeaking }) {
  const buf = { user: '', assistant: '' };
  const started = { user: 0, assistant: 0 };
  let lastUserAt = 0;

  function flush(role) {
    const text = buf[role].trim();
    buf[role] = '';
    if (!text) return '';
    if (role === 'user') onSpeaking(null);
    (role === 'user' ? onUserText : onAssistantText)(text, started[role]);
    return text;
  }
  function add(role, text) {
    if (!text) return;
    if (!buf[role]) started[role] = Date.now();
    buf[role] += text;
  }

  return {
    handle(sc) {
      if (sc.inputTranscription?.text) {
        add('user', sc.inputTranscription.text);
        lastUserAt = Date.now();
        onSpeaking('user');
      }
      const modelOut = sc.outputTranscription?.text || sc.modelTurn?.parts?.some((p) => p.inlineData);
      if (modelOut) flush('user');
      if (sc.outputTranscription?.text) add('assistant', sc.outputTranscription.text);
      if (sc.interrupted) flush('assistant');
      if (sc.turnComplete) {
        if (!flush('assistant')) flush('user'); // the patient chose not to answer this turn (proactive audio)
      }
    },
    flushUser: () => flush('user'),
    // Input transcription has no ordering guarantee and can arrive a little late. Wait until it has
    // been quiet for 300 ms (at most 1 s).
    async settleUser() {
      const until = Date.now() + 1000;
      while (Date.now() - lastUserAt < 300 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    },
    flushAll() {
      flush('user');
      flush('assistant');
    },
  };
}

/**
 * @param {object} o
 * @param {(handle:string|null)=>Promise<{token:string, model:string}>} o.getToken
 *        Fetches an ephemeral token ("auth_tokens/...") from the server. On reconnect it receives
 *        the last resumption handle.
 * @param {boolean} [o.resumable] reconnect on goAway or drop
 * @param {(msg:object)=>void} o.onMessage   LiveServerMessage (setupComplete, serverContent, toolCall, ...)
 * @param {(playing:boolean)=>void} [o.onPlaying]
 * @param {(reason:string)=>void} [o.onClosed] called when the connection is gone and was not reconnected
 * @returns {Promise<{micStream:MediaStream, remoteStream:MediaStream, sendToolResponse:(r:object)=>void, stop:()=>void}>}
 */
export async function openLiveAudio({ getToken, resumable = false, onMessage, onPlaying = () => {}, onClosed = () => {} }) {
  let session = null;
  let handle = null;
  let stopped = false;
  let reconnects = 0;
  let micStream = null;
  let inCtx = null;
  let outCtx = null;
  let worklet = null;

  // ----- playback -----
  const sources = new Set();
  let nextTime = 0;
  let outGain = null;
  let remoteDest = null;

  function play(b64) {
    const pcm = pcm16ToFloat(b64);
    if (!pcm.length) return;
    const ab = outCtx.createBuffer(1, pcm.length, OUT_RATE);
    ab.copyToChannel(pcm, 0);
    const src = outCtx.createBufferSource();
    src.buffer = ab;
    src.connect(outGain);
    const at = Math.max(outCtx.currentTime + 0.02, nextTime);
    src.start(at);
    nextTime = at + ab.duration;
    if (!sources.size) onPlaying(true);
    sources.add(src);
    src.onended = () => {
      sources.delete(src);
      if (!sources.size) onPlaying(false);
    };
  }
  function clearPlayback() {
    for (const s of sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {}
    }
    const was = sources.size;
    sources.clear();
    nextTime = 0;
    if (was) onPlaying(false);
  }

  // ----- connection -----
  let gen = 0; // generation counter so events from a discarded connection are ignored
  async function connect() {
    const { token, model } = await getToken(handle);
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    const my = ++gen;
    session = await ai.live.connect({
      model,
      // The config is fully locked in the token; the values given here are ignored.
      config: { responseModalities: ['AUDIO'] },
      callbacks: {
        onmessage: (msg) => {
          if (my !== gen) return;
          if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
            handle = msg.sessionResumptionUpdate.newHandle;
          }
          if (msg.goAway && resumable && handle) {
            reconnect();
            return;
          }
          const sc = msg.serverContent;
          if (sc?.interrupted) clearPlayback();
          for (const p of sc?.modelTurn?.parts || []) {
            if (p.inlineData?.data) play(p.inlineData.data);
          }
          onMessage(msg);
        },
        onerror: (e) => console.warn('[gemini-live] ws error:', e?.message || e),
        onclose: (e) => {
          if (stopped || my !== gen) return;
          if (resumable && handle && reconnects < MAX_RECONNECTS) reconnect();
          else onClosed(e?.reason || `code ${e?.code ?? '?'}`);
        },
      },
    });
  }

  let reconnecting = false;
  async function reconnect() {
    if (reconnecting || stopped) return;
    reconnecting = true;
    reconnects += 1;
    const old = session;
    session = null; // microphone chunks are dropped while reconnecting
    gen += 1; // so the old connection's onclose does not trigger another reconnect
    try {
      old?.close();
    } catch {}
    try {
      await connect();
      reconnects = 0;
    } catch (err) {
      console.warn('[gemini-live] reconnect failed:', err);
      if (!stopped) onClosed('reconnect');
    } finally {
      reconnecting = false;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {}
    try {
      session?.close();
    } catch {}
    session = null;
    clearPlayback();
    try {
      worklet?.disconnect();
    } catch {}
    micStream?.getTracks().forEach((t) => t.stop());
    inCtx?.close().catch(() => {});
    outCtx?.close().catch(() => {});
  }

  try {
    // Microphone (https or localhost only). Echo cancellation, noise suppression, auto gain.
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    outCtx = new AudioContext();
    outGain = outCtx.createGain();
    outGain.connect(outCtx.destination);
    remoteDest = outCtx.createMediaStreamDestination();
    outGain.connect(remoteDest);

    await connect();

    inCtx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    worklet = new AudioWorkletNode(inCtx, 'pcm-down');
    worklet.port.onmessage = (e) => {
      if (stopped || !session) return;
      try {
        session.sendRealtimeInput({ audio: { data: toBase64(e.data), mimeType: `audio/pcm;rate=${IN_RATE}` } });
      } catch {}
    };
    inCtx.createMediaStreamSource(micStream).connect(worklet);
    await Promise.all([inCtx.resume(), outCtx.resume()]);
  } catch (err) {
    stop();
    throw err;
  }

  return {
    micStream,
    remoteStream: remoteDest.stream,
    sendToolResponse: (r) => {
      if (!stopped && session) session.sendToolResponse(r);
    },
    stop,
  };
}
