// Cascade pipeline: transcription, text model, TTS. Same interface as demo/live.js so DemoApp can
// swap engines.
//
// Flow:
//   microphone -> transcription-only Live session (gemini-3.5-transcribe-live)
//              -> final transcript = one visitor utterance
//              -> POST /api/demo/turn : the text model returns { text, style }
//              -> POST /api/demo/tts  : the server relays streamed TTS audio -> WebAudio playback
//   An interim transcript means the visitor has started talking: playback stops and the turn in
//   flight is discarded. The model is not told about the interruption; only playback is cut.
//
// Unlike the live pipeline, the patient cannot backchannel while the visitor is speaking. In return,
// each utterance carries an explicit delivery line (style) and inline sound tags that can be
// inspected and overridden.
//
// The case sheet and the voice live on the server. The client sends only `lang` and the
// conversation history.

import { createPlayer, startMic, toBase64 } from './audioIo';
import { GoogleGenAI } from '@google/genai';

export async function startTtsSession({
  lang = 'en',
  endpoints = { stt: '/api/demo/stt', turn: '/api/demo/turn', tts: '/api/demo/tts' },
  onStatus = () => {},
  onUserText = () => {},
  onAssistantText = () => {},
  onSpeaking = () => {},
  onDelivery = () => {}, // (style, taggedText): the delivery line and the text with sound tags
}) {
  let stopped = false;
  let session = null;
  let mic = null;
  let player = null;
  let turnSeq = 0;
  const history = []; // [{ role: 'user'|'assistant', text }]

  function cleanup() {
    if (stopped) return;
    stopped = true;
    try {
      session?.close();
    } catch {}
    session = null;
    mic?.stop();
    player?.close();
  }

  // The transcript shown on screen has the sound tags removed.
  const stripTags = (s) => s.replace(/<[^>]{1,20}>/g, ' ').replace(/\s+/g, ' ').trim();

  async function speak(text, style, myTurn) {
    const res = await fetch(endpoints.tts, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style, lang }),
    });
    if (!res.ok || !res.body) throw new Error('TTS request failed');
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (stopped || myTurn !== turnSeq) return reader.cancel().catch(() => {}); // interrupted
      player.push(value);
    }
  }

  // One visitor utterance -> patient line -> voice
  async function runTurn(userText) {
    const myTurn = ++turnSeq;
    onUserText(userText, Date.now());
    history.push({ role: 'user', text: userText });
    try {
      const r = await fetch(endpoints.turn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: history.slice(-20), lang }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.text) throw new Error(data.error || 'Patient turn failed');
      if (stopped || myTurn !== turnSeq) return;

      const spoken = stripTags(data.text);
      history.push({ role: 'assistant', text: spoken });
      onAssistantText(spoken, Date.now());
      onDelivery(data.style || '', data.text);
      await speak(data.text, data.style || '', myTurn);
    } catch (e) {
      console.warn('[tts] turn failed:', e);
      if (!stopped) onStatus('error', e.message || String(e));
    }
  }

  try {
    onStatus('connecting');

    const tokenRes = await fetch(endpoints.stt, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.token) throw Object.assign(new Error(tok.error || 'session'), { code: tok.error || 'session' });

    player = createPlayer((playing) => onSpeaking(playing ? 'assistant' : null));

    const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: 'v1alpha' } });
    session = await ai.live.connect({
      model: tok.model,
      config: { responseModalities: ['TEXT'] }, // everything else is locked in the token
      callbacks: {
        onmessage: (msg) => {
          const sc = msg.serverContent;
          if (!sc || stopped) return;
          // The visitor started talking: cut the patient's audio and drop the turn in flight.
          if (sc.interimInputTranscription?.text) {
            onSpeaking('user');
            if (player.playing) player.clear();
            turnSeq += 1;
          }
          const finalText = sc.inputTranscription?.text?.trim();
          if (finalText) runTurn(finalText);
        },
        onerror: (e) => console.warn('[tts] stt error:', e?.message || e),
        onclose: (e) => {
          if (!stopped) onStatus('error', `Transcription connection closed (${e?.reason || e?.code || '?'}).`);
        },
      },
    });

    mic = await startMic((buf) => {
      if (stopped || !session) return;
      try {
        session.sendRealtimeInput({ audio: { data: toBase64(buf), mimeType: 'audio/pcm;rate=16000' } });
      } catch {}
    });
    await player.resume();
    onStatus('connected');
  } catch (err) {
    console.error('[tts] connection failed:', err);
    // A getUserMedia failure is a DOMException whose numeric `code` is meaningless here; report its
    // name (NotAllowedError, NotFoundError) so the screen can say "mic". Otherwise pass our own code.
    const isMic = err?.name === 'NotAllowedError' || err?.name === 'NotFoundError';
    onStatus('error', isMic ? err.name : err.code || err.message || String(err));
    cleanup();
  }

  return { stop: cleanup };
}
