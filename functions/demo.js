// HTTP routes for the demo.
//
//   POST /api/demo/stt    session start: a transcription token (counts against the quota)
//   POST /api/demo/warm   session start: wakes the instance and the Gemini connection (free call)
//   POST /api/demo/speak  one patient turn: the line (X-Turn header) and its audio (24 kHz PCM body)
//
// - The case sheet, the portrayal text and the voice live here (demoCase.js, portrayals.js). The client
//   sends `lang`, the portrayal name, and the conversation so far.
// - Origins are allow-listed. Without it any site could embed this page and spend the key.
// - Quota: DEMO_PER_IP sessions per IP per day, DEMO_PER_DAY overall. If the counter cannot be read
//   the request is refused. A blocked demo costs nothing; a leaked key does.
// - Key: GEMINI_DEMO_API_KEY (a key with its own spending limit) if set, else GEMINI_API_KEY.

import express from 'express';
import { demoCase } from './demoCase.js';
import { geminiVoice, mintLiveToken } from './gemini.js';
import { PORTRAYALS, portrayalBrief } from './portrayals.js';
import { BRAIN_MODEL_DEFAULT, STT_MODEL_DEFAULT, STT_SILENCE_MS, TTS_MODEL_DEFAULT, speakTurn, warmUp } from './tts.js';

const DEMO_PER_IP = Number(process.env.DEMO_PER_IP || 10);
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

const sttModel = () => process.env.GEMINI_STT_MODEL || STT_MODEL_DEFAULT;
const brainModel = () => process.env.GEMINI_BRAIN_MODEL || BRAIN_MODEL_DEFAULT;
const ttsModel = () => process.env.GEMINI_TTS_MODEL || TTS_MODEL_DEFAULT;

/**
 * @param {object} deps
 * @param {(ip:string)=>Promise<boolean>} deps.takeQuota  returns true and counts one use if allowed
 */
export function createDemoApp({ takeQuota }) {
  const app = express();
  // text/plain is parsed as JSON too: the browser calls the function URL directly with a simple
  // request (no CORS preflight). Cloud Functions has already read such a body as a string.
  app.use(express.json({ limit: '64kb', type: ['application/json', 'text/plain'] }));
  app.use((req, _res, next) => {
    if (typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        req.body = {};
      }
    }
    next();
  });

  // Origin check and key lookup. Returns the API key or null after replying.
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
  const askedPortrayal = (req) => (req.body?.portrayal in PORTRAYALS ? req.body.portrayal : 'assessment');

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

  // Session start. The token locks a transcription-only config: text out, no instructions.
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
            automaticActivityDetection: { silenceDurationMs: STT_SILENCE_MS, endOfSpeechSensitivity: 'END_SENSITIVITY_LOW' },
          },
        },
        expireMin: 10,
        newSessionMin: 5,
      });
      return res.json({ token, model: sttModel() });
    } catch (err) {
      console.error('demo token failed:', err);
      return res.status(502).json({ error: /402|credit|billing/i.test(String(err?.message)) ? 'budget' : 'connect' });
    }
  });

  // Free metadata call, so the first turn does not pay for a cold connection.
  app.post('/api/demo/warm', async (req, res) => {
    const apiKey = guard(req, res);
    if (!apiKey) return;
    try {
      await warmUp({ apiKey, model: brainModel() });
    } catch (err) {
      console.warn('demo warm failed:', err?.message || err);
    }
    return res.status(204).end();
  });

  // One patient turn. The instructions are assembled here from the case sheet and the portrayal.
  app.post('/api/demo/speak', async (req, res) => {
    const apiKey = guard(req, res);
    if (!apiKey) return;
    const lang = askedLang(req);
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-20) : [];
    if (!history.length || history.some((m) => typeof m?.text !== 'string' || m.text.length > 2000)) {
      return res.status(400).json({ error: 'history' });
    }
    res.set('Access-Control-Expose-Headers', 'X-Turn');
    try {
      await speakTurn(res, {
        apiKey,
        brainModel: brainModel(),
        ttsModel: ttsModel(),
        voice: geminiVoice(demoCase(lang).voice),
        instructions: [demoCase(lang).instructions, portrayalBrief(askedPortrayal(req), lang)].join('\n\n'),
        history,
        notes: '',
        lang,
      });
    } catch (err) {
      console.error('demo turn failed:', err);
      if (!res.headersSent) {
        return res.status(502).json({ error: /402|credit|billing/i.test(String(err?.message)) ? 'budget' : 'connect' });
      }
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
