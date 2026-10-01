// Voice session in the browser: listen, then speak.
//
//   microphone -> transcription-only Gemini Live session (token from /api/demo/stt)
//   final transcript = one student turn -> /api/demo/speak -> the patient's line (X-Turn header)
//   and its audio (24 kHz PCM body) -> Web Audio playback
//
// An interim transcript means the student has started talking: patient audio stops and the pending
// turn is dropped. If the patient had not made a sound yet, the next fragment is joined to the cut-off
// question and answered as one turn.
//
// There is no reconnect: a demo session is shorter than the transcription connection's lifetime.

import { GoogleGenAI } from '@google/genai';
import { createPlayer, startMic, toBase64 } from '../lib/audioIo';

// Firebase Hosting buffers a rewritten response until it is complete, so audio relayed through
// /api/... would only start after the whole line was synthesized (measured 2026-09-29: first audio
// 7.7-13.7 s through Hosting, 2.7-3.1 s from the function URL). Set VITE_API_BASE to the function URL
// (e.g. https://us-central1-<project>.cloudfunctions.net/demo) to stream directly. Unset = same origin.
const API_BASE = import.meta.env.VITE_API_BASE || '';

const stripTags = (s) => s.replace(/<[^>]{1,30}>/g, ' ').replace(/\s+/g, ' ').trim();

// Error codes the screen knows (content.js `errors`). `detail` carries the server's own words.
const classify = (err) => {
  if (err?.name === 'NotAllowedError' || err?.name === 'NotFoundError') return { code: 'mic' };
  const text = String(err?.message || err?.reason || '');
  if (err?.code) return { code: err.code, detail: text };
  if (/credit|billing|RESOURCE_EXHAUSTED|1011/i.test(text)) return { code: 'budget', detail: text };
  return { code: 'session', detail: text };
};

const httpError = (data, fallback) => Object.assign(new Error(data?.error || fallback), { code: data?.error || fallback });

/**
 * onStatus(status, code?, detail?):
 *   'connecting' | 'live' | 'ended' (detail = close reason) | 'error' (code from content.js, detail)
 * onUserText(text, at, { replace }) — replace: the last student entry now reads `text` (a joined question)
 */
export async function startDemoSession({
  lang = 'en',
  portrayal = 'assessment',
  onStatus,
  onUserText,
  onAssistantText,
  onSpeaking,
}) {
  let stopped = false;
  let session = null;
  let mic = null;
  let player = null;
  let turnSeq = 0;
  let pendingUser = null; // a student turn the patient has not answered out loud yet
  const history = []; // [{ role: 'user'|'assistant', text }]

  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      session?.close();
    } catch {}
    mic?.stop();
    player?.close();
  }

  // Line and audio in one request. text/plain keeps it a simple request, so there is no CORS preflight
  // when calling the function URL directly; the server parses the body as JSON.
  async function speak(myTurn) {
    const res = await fetch(`${API_BASE}/api/demo/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ lang, portrayal, history: history.slice(-20) }),
    });
    if (!res.ok || !res.body) throw httpError(await res.json().catch(() => ({})), 'session');
    let turn = {};
    try {
      turn = JSON.parse(decodeURIComponent(res.headers.get('X-Turn') || ''));
    } catch {}
    if (!turn.text) throw httpError(null, 'session');
    const reader = res.body.getReader();
    let heard = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (stopped || myTurn !== turnSeq) return reader.cancel().catch(() => {}); // interrupted
      if (!heard) {
        // The patient has spoken once the first sound plays; only then does the line count.
        heard = true;
        pendingUser = null;
        const spoken = stripTags(turn.text);
        // The style travels with the line so the model can carry its own delivery into the next turn.
        history.push({ role: 'assistant', text: spoken, style: turn.style || '', ...(turn.moment ? { moment: turn.moment } : {}) });
        onAssistantText(spoken, Date.now());
      }
      player.push(value);
    }
  }

  async function runTurn(userText, merge) {
    const myTurn = ++turnSeq;
    pendingUser = userText;
    if (merge) {
      history[history.length - 1] = { role: 'user', text: userText };
      onUserText(userText, Date.now(), { replace: true });
    } else {
      history.push({ role: 'user', text: userText });
      onUserText(userText, Date.now(), { replace: false });
    }
    try {
      await speak(myTurn);
    } catch (err) {
      console.warn('[demo] turn failed:', err);
      if (stopped || myTurn !== turnSeq) return;
      const { code, detail } = classify(err);
      stop();
      onStatus('error', code, detail);
    }
  }

  try {
    onStatus('connecting');
    player = createPlayer((playing) => onSpeaking(playing ? 'assistant' : null));
    // Wake the server instance and its Gemini connection before the first turn (not awaited).
    fetch(`${API_BASE}/api/demo/warm`, { method: 'POST' }).catch(() => {});
    // Open the microphone before asking for the token, so the token is used within a second of minting.
    mic = await startMic((buf) => {
      if (stopped || !session) return;
      try {
        session.sendRealtimeInput({ audio: { data: toBase64(buf), mimeType: 'audio/pcm;rate=16000' } });
      } catch {}
    });

    const tokenRes = await fetch('/api/demo/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.token) throw httpError(tok, 'session');

    const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: 'v1alpha' } });
    session = await ai.live.connect({
      model: tok.model,
      config: { responseModalities: ['TEXT'] }, // the rest is locked in the token
      callbacks: {
        onmessage: (msg) => {
          const sc = msg.serverContent;
          if (stopped || !sc) return;
          if (sc.interimInputTranscription?.text) {
            onSpeaking('user');
            if (player.playing) player.clear();
            turnSeq += 1; // drops the pending turn
          }
          const finalText = sc.inputTranscription?.text?.trim();
          if (finalText) {
            const merge = pendingUser != null && history[history.length - 1]?.role === 'user';
            runTurn(merge ? `${pendingUser} ${finalText}` : finalText, merge);
          }
        },
        onerror: (e) => console.warn('[demo] transcription error:', e?.message || e),
        onclose: (e) => {
          if (stopped) return;
          stop();
          onStatus('ended', e?.reason || String(e?.code || ''));
        },
      },
    });
    if (stopped) {
      session.close();
      return { stop };
    }
    await player.resume();
    onStatus('live');
  } catch (err) {
    console.warn('[demo] session failed:', err);
    stop();
    const { code, detail } = classify(err);
    onStatus('error', code, detail);
  }

  return { stop };
}
