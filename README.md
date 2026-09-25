# Voice Standardized Patient

A voice AI patient for practising a clinical interview in the browser: one page, one fictional patient (Jieun Kim, 31, cannot sleep), one Gemini Live session. English by default, Korean with `?lang=ko`.

Live demo: https://sptalk-demo.web.app

## How it works

```
browser                                  server                          Google
─────────────────────────────────────    ────────────────────────────    ──────────────────────
mic permission
POST /api/demo/session {lang}  ──────▶   origin check, quota,
                                         mint ephemeral token with the
                                         case sheet, voice, VAD and
                                         transcription locked in
◀── {token} ─────────────────────────
WebSocket live.connect(token) ─────────────────────────────────────────▶ gemini-3.8-live
  mic 16 kHz PCM ────────────────────────────────────────────────────▶   listens, decides the turn,
◀── 24 kHz PCM, input/output transcription, interrupted, turnComplete ─   speaks
```

The server mints the token and is out of the loop after that; the browser talks to Google directly. Utterance boundaries come from server signals: the visitor's transcript is closed when the first patient audio arrives, the patient's when `turnComplete` or `interrupted` arrives. If Google closes the socket, the page shows the close code and reason.

First patient audio 2.9–3.1 s after the visitor stops speaking (author's measurement, 2026-09, synthesized speech input).

## Why the token is locked

- The token is single-use and carries the whole session config (system instruction, model, voice, VAD, transcription). The client's own setup is ignored, so the browser cannot change the instructions, the model, or the voice, and never sees the case sheet.
- Origins are allow-listed (`DEMO_ORIGINS` plus localhost). Without this any site could embed the page and spend the key.
- Quota: `DEMO_PER_IP` sessions per IP per day and `DEMO_PER_DAY` overall, counted in one Firestore document per day. If the counter cannot be read the request is refused.
- Nothing is stored. The conversation lives in browser memory and is gone on reload.

## Run locally

Requires Node 22 and a Google AI Studio key.

```
npm run install:all
cp .env.example functions/.env   # add GEMINI_API_KEY
npm run dev
```

The API runs on http://localhost:8788 with an in-memory quota; the page on http://localhost:5173 proxies `/api/demo` to it.

## Deploy

```
cp .firebaserc.example .firebaserc   # set your Firebase project id; set DEMO_ORIGINS in functions/.env
npm run deploy
```

Hosting serves `client/dist`, `/api/**` goes to the `demo` function in `us-central1`, and Firestore holds the quota counter.

## Layout

```
client/src/demo/DemoApp.jsx   the page: intro, call, done
client/src/demo/live.js       session: token, status, errors
client/src/demo/content.js    screen text and the door note
client/src/lib/geminiLive.js  Live WebSocket transport, mic worklet, playback, utterance assembler
functions/index.js            Cloud Function export
functions/dev.js              local server with in-memory quota
functions/demo.js             the session route, origin check, quota
functions/demoCase.js         the fictional patient (English and Korean sheets)
functions/gemini.js           Live config and token minting
```

## Models

`gemini-3.8-live`, voice `Kore`; override the model with `GEMINI_LIVE_MODEL`.

## License

MIT. See `LICENSE`.
