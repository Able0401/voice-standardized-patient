// HTTP routes for the demo. One Express app serves both pipelines.
//
// - The case sheet and the voice are chosen here (demoCase.js) and locked into a Gemini Live
//   ephemeral token. The client sends nothing but `lang` and receives a token.
// - Origins are allow-listed. Without it any site could embed this page and spend the key.
// - Quota: DEMO_PER_IP sessions per IP per day, DEMO_PER_DAY overall. If the counter cannot be read
//   the request is refused. A blocked demo costs nothing; a leaked key does.
// - Key: GEMINI_DEMO_API_KEY (a key with its own spending limit) if set, else GEMINI_API_KEY.

import express from 'express';
import { demoCase } from './demoCase.js';
import { LIVE_MODEL_DEFAULT, geminiVoice, liveConfig, mintLiveToken } from './gemini.js';
import { BRAIN_MODEL_DEFAULT, STT_MODEL_DEFAULT, TTS_MODEL_DEFAULT, patientTurn, streamTts } from './tts.js';

const DEMO_PER_IP = Number(process.env.DEMO_PER_IP || 3);
const DEMO_PER_DAY = Number(process.env.DEMO_PER_DAY || 30);
const ALLOWED_ORIGINS = [
  ...String(process.env.DEMO_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  'http://localhost:5173',
  'http://localhost:5174',
];

// Behind Firebase Hosting the first x-forwarded-for value is the real client.
const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();

const liveModel = () => process.env.GEMINI_LIVE_MODEL || LIVE_MODEL_DEFAULT;
const sttModel = () => process.env.GEMINI_STT_MODEL || STT_MODEL_DEFAULT;
const brainModel = () => process.env.GEMINI_BRAIN_MODEL || BRAIN_MODEL_DEFAULT;
const ttsModel = () => process.env.GEMINI_TTS_MODEL || TTS_MODEL_DEFAULT;

/**
 * @param {object} deps
 * @param {(ip:string)=>Promise<boolean>} deps.takeQuota  returns true and counts one use if allowed
 */
export function createDemoApp({ takeQuota }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Origin check and key lookup shared by every route. Returns the API key or null after replying.
  const guard = (req, res) => {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'origin' });
      return null;
    }
    res.set('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
    const apiKey = process.env.GEMINI_DEMO_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'not_configured' });
      return null;
    }
    return apiKey;
  };
  const askedLang = (req) => (req.body?.lang === 'ko' ? 'ko' : 'en');

  // Quota is taken where a session starts. Returns false after replying 429.
  const takeOrReject = async (req, res) => {
    let allowed = false;
    try {
      allowed = await takeQuota(clientIp(req));
    } catch (err) {
      console.error('demo quota check failed:', err);
    }
    if (!allowed) res.status(429).json({ error: 'quota' });
    return allowed;
  };

  // ----- live pipeline: one token, the model listens and speaks -----
  app.post('/api/demo/session', async (req, res) => {
    const apiKey = guard(req, res);
    if (!apiKey) return;
    if (!(await takeOrReject(req, res))) return;
    const lang = askedLang(req);
    try {
      // The whole config is locked in the token; the client setup is ignored. No reconnect: the
      // session is short. The client opens the microphone before asking for the token, so the token
      // is used within about a second of being minted. Minting succeeds even when the project's
      // credits are exhausted; that failure only shows up as the WebSocket close reason.
      const token = await mintLiveToken({
        apiKey,
        model: liveModel(),
        config: liveConfig({ instructions: demoCase(lang).instructions, voice: demoCase(lang).voice, lang }),
        expireMin: 10,
        newSessionMin: 5,
      });
      return res.json({ token, model: liveModel() });
    } catch (err) {
      console.error('demo token failed:', err);
      return res.status(502).json({ error: 'upstream' });
    }
  });

  // ----- cascade pipeline: transcription token, then one turn and one TTS call per utterance -----
  // Same case sheet, same voice, same screen. The client sends only `lang` and the history.

  // Session start = transcription token. Quota is counted here (the cascade's equivalent of /api/demo/session).
  app.post('/api/demo/stt', async (req, res) => {
    const apiKey = guard(req, res);
    if (!apiKey) return;
    if (!(await takeOrReject(req, res))) return;
    try {
      const token = await mintLiveToken({
        apiKey,
        model: sttModel(),
        config: {
          responseModalities: ['TEXT'],
          inputAudioTranscription: { languageCodes: [askedLang(req)] },
          realtimeInputConfig: {
            // Same 2.5 s end-of-turn silence as the live pipeline. This is the largest single piece
            // of the cascade's latency, and shortening it cuts off visitors who pause to think.
            automaticActivityDetection: { silenceDurationMs: 2500, endOfSpeechSensitivity: 'END_SENSITIVITY_LOW' },
          },
        },
        expireMin: 10,
        newSessionMin: 5,
      });
      return res.json({ token, model: sttModel() });
    } catch (err) {
      console.error('demo STT token failed:', err);
      return res.status(502).json({ error: 'upstream' });
    }
  });

  app.post('/api/demo/turn', async (req, res) => {
    const apiKey = guard(req, res);
    if (!apiKey) return;
    const lang = askedLang(req);
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-20) : [];
    if (history.some((m) => typeof m?.text !== 'string' || m.text.length > 2000)) return res.status(400).json({ error: 'history' });
    try {
      const turn = await patientTurn({
        apiKey,
        model: brainModel(),
        instructions: demoCase(lang).instructions, // the case sheet exists only on the server
        history,
        lang,
      });
      return res.json(turn);
    } catch (err) {
      console.error('demo patient turn failed:', err);
      return res.status(502).json({ error: 'upstream' });
    }
  });

  app.post('/api/demo/tts', async (req, res) => {
    const apiKey = guard(req, res);
    if (!apiKey) return;
    const { text, style } = req.body || {};
    if (typeof text !== 'string' || !text || text.length > 1000) return res.status(400).json({ error: 'text' });
    res.set({ 'Content-Type': 'audio/l16; rate=24000', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    try {
      await streamTts({
        apiKey,
        model: ttsModel(),
        text,
        style: typeof style === 'string' ? style.slice(0, 200) : '',
        voice: geminiVoice(demoCase(askedLang(req)).voice),
        onChunk: (b) => res.write(b),
      });
      return res.end();
    } catch (err) {
      console.error('demo TTS failed:', err);
      if (!res.headersSent) return res.status(502).json({ error: 'upstream' });
      return res.end();
    }
  });

  return app;
}

const today = () => new Date().toISOString().slice(0, 10);
const ipKey = (ip) => ip.replace(/[^0-9a-fA-F]/g, '_');

// Firestore counter. One document per day holds the per-IP counts and the total (a few dozen
// sessions a day fit in one document).
export function firestoreQuota(db) {
  return async (ip) => {
    const ref = db.collection('demoQuota').doc(today());
    const key = ipKey(ip);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const total = d.total || 0;
      const mine = (d.ips && d.ips[key]) || 0;
      if (total >= DEMO_PER_DAY || mine >= DEMO_PER_IP) return false;
      tx.set(ref, { total: total + 1, ips: { [key]: mine + 1 } }, { merge: true });
      return true;
    });
  };
}

// In-memory counter with the same limits and the same UTC-day window, for local development without
// Firestore. Resets when the process restarts.
export function memoryQuota() {
  const days = new Map(); // day -> { total, ips: Map }
  return async (ip) => {
    const day = today();
    if (!days.has(day)) days.set(day, { total: 0, ips: new Map() });
    const d = days.get(day);
    const key = ipKey(ip);
    const mine = d.ips.get(key) || 0;
    if (d.total >= DEMO_PER_DAY || mine >= DEMO_PER_IP) return false;
    d.total += 1;
    d.ips.set(key, mine + 1);
    return true;
  };
}
