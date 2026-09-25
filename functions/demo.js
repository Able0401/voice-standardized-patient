// HTTP routes for the demo. One Express app, one route: the session token.
//
// - The case sheet and the voice are chosen here (demoCase.js) and locked into a Gemini Live
//   ephemeral token. The client sends nothing but `lang` and receives a token.
// - Origins are allow-listed. Without it any site could embed this page and spend the key.
// - Quota: DEMO_PER_IP sessions per IP per day, DEMO_PER_DAY overall. If the counter cannot be read
//   the request is refused. A blocked demo costs nothing; a leaked key does.
// - Key: GEMINI_DEMO_API_KEY (a key with its own spending limit) if set, else GEMINI_API_KEY.

import express from 'express';
import { demoCase } from './demoCase.js';
import { LIVE_MODEL_DEFAULT, liveConfig, mintLiveToken } from './gemini.js';

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

/**
 * @param {object} deps
 * @param {(ip:string)=>Promise<boolean>} deps.takeQuota  returns true and counts one use if allowed
 */
export function createDemoApp({ takeQuota }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

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

  // One token per session; the model listens and speaks.
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
