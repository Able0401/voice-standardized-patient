# Voice Standardized Patient

A voice AI patient for practising a clinical interview in the browser: one page, one fictional patient, and two interchangeable speech pipelines that the visitor can switch between.

Live demo (Live engine): https://sptalk-demo.web.app

The patient is Jieun Kim, a 31-year-old office worker who cannot sleep. English by default, Korean with `?lang=ko`. The patient's case sheet lives on the server only. The browser sends audio and receives audio; it never sees the instructions.

## Two pipelines

`?engine=live` (default) uses a single speech-to-speech model. `?engine=tts` runs a cascade of three models. The page shows a two-button switch; changing the engine reloads the page so a session never changes pipeline half way.

### live

```
browser                                   server                      Google
──────────────────────────────────────    ─────────────────────────   ──────────────────────
POST /api/demo/session {lang}  ───────▶   mint ephemeral token
                                          (case sheet, voice, VAD,
                                           transcription locked in)
◀── {token} ──────────────────────────
WebSocket live.connect(token) ──────────────────────────────────────▶ gemini-3.8-live
  mic 16 kHz PCM ─────────────────────────────────────────────────▶   listens, decides the
◀──────────────────────────────────────────────────────────────────   turn, speaks 24 kHz PCM
  input/output transcription, interrupted, turnComplete
```

One model listens and speaks. The server's only job is to mint the token; after that the browser talks to Google directly. Utterance boundaries come from server signals: the visitor's transcript is closed when the first patient audio arrives, the patient's when `turnComplete` or `interrupted` arrives.

### tts (cascade)

```
browser                                   server                      Google
──────────────────────────────────────    ─────────────────────────   ──────────────────────
POST /api/demo/stt {lang}  ───────────▶   mint transcription token
◀── {token, model} ───────────────────
WebSocket live.connect(token) ──────────────────────────────────────▶ gemini-3.5-transcribe-live
  mic 16 kHz PCM ─────────────────────────────────────────────────▶
◀── interim transcript ──────────────── (visitor started talking: stop playback, drop the turn in flight)
◀── final transcript ─────────────────  (2.5 s of silence)
POST /api/demo/turn {history, lang} ─▶   case sheet + history  ───▶ gemini-3.8-flash
◀── {text, style} ────────────────────                          ◀── {text, style}, thinking off
POST /api/demo/tts {text, style, lang} ▶ relay stream  ─────────▶ gemini-3.8-flash-lite-tts
◀── 24 kHz PCM chunks ────────────────                          ◀── audio/l16 stream
  WebAudio playback
```

The transcription session decides when the visitor has finished (2.5 s of silence, low end-of-speech sensitivity). The text model returns the spoken words plus a one-line delivery note and inline sound tags (`<short pause>`, `<sigh>`, `<breath>`, `<laugh>`, `<cough>`). The TTS model reads the words verbatim and takes the delivery note as metadata so it is not read aloud. An interim transcript while the patient is speaking stops playback and discards the turn in flight; the model is not told about the interruption.

## Measured latency

Author's own measurements, 2026-09, with synthesized speech as input. Times are from the moment the visitor stops speaking to the first patient audio.

| | Live | Cascade |
| :- | :- | :- |
| First patient audio after the visitor stops speaking | 2.9 to 3.1 s | 5.7 s |
| of which: transcript finalised | | 3.0 s (includes 2.5 s silence detection) |
| of which: turn text | | 1.6 s |
| of which: TTS first audio | | 1.1 s |

Two settings that move the cascade number:

| Setting | Value | Time |
| :- | :- | :- |
| TTS model | `gemini-3.8-flash-lite-tts` | first audio 1.1 s |
| | `gemini-3.8-flash-tts` | first audio 1.8 s |
| Turn text with thinking | off (`thinkingBudget: 0`) | 1.6 s |
| | on | 8.2 s |

## Trade-offs

| | Live | Cascade |
| :- | :- | :- |
| Backchannels while the visitor speaks | yes | no |
| Barge-in | server-signalled `interrupted`; playback is cleared and the model's turn ends | playback stops only; the model is unaware |
| Per-utterance delivery control | implicit, inside the model | explicit `{text, style}` plus sound tags; inspectable and overridable |
| Failure points | 1 (one WebSocket) | 4 (transcription socket, turn request, TTS request, playback) |
| Approximate cost | audio out $0.018/min | TTS out about $0.014/min, plus transcription and text generation; TTS output price doubles on 2027-01-01 |

## Security and cost limits

- The Live token is single-use (`uses: 1`) and carries the whole session config: system instruction, model, voice, VAD, transcription. The client's own setup is ignored, so it cannot change the instructions, the model, or the voice. Locking only some fields was tried and the API rejected the field mask, so the whole config is locked.
- Origins are allow-listed (`DEMO_ORIGINS` plus localhost). Without this any site could embed the page and spend the key.
- Quota: `DEMO_PER_IP` sessions per IP per day and `DEMO_PER_DAY` overall, counted in one Firestore document per day. If the counter cannot be read the request is refused. A blocked demo costs nothing; a leaked key does.
- TTS is relayed by the server because ephemeral tokens cover Live sessions only. The browser never holds a key.
- The function runs with `maxInstances: 2`.
- Nothing is stored. The conversation lives in browser memory and is gone on reload.

## Run locally

Requires Node 22 and a Google AI Studio key.

```
npm run install:all
cp .env.example functions/.env   # add GEMINI_API_KEY
npm run dev
```

`npm run dev` starts the API on http://localhost:8788 with an in-memory quota (no Firestore needed) and the page on http://localhost:5173, which proxies `/api/demo` to the API. Open http://localhost:5173/?engine=tts for the cascade.

## Deploy

```
cp .firebaserc.example .firebaserc   # set your Firebase project id
# set DEMO_ORIGINS in functions/.env to your hosting URLs
npm run deploy
```

Hosting serves `client/dist`; `/api/**` is rewritten to the `demo` function in `us-central1`. The function reads `functions/.env` at deploy time. Firestore must be enabled in the project for the quota counter.

## Project layout

```
client/
  index.html
  vite.config.js           dev proxy to :8788, build to dist/
  src/demo/DemoApp.jsx     the page: intro, call, done; engine and language from the query string
  src/demo/live.js         live pipeline session
  src/demo/content.js      screen text and the door note
  src/lib/geminiLive.js    Live WebSocket transport, mic worklet, playback, utterance assembler
  src/lib/ttsVoice.js      cascade session: transcription, turn, TTS
  src/lib/audioIo.js       mic capture and PCM player for the cascade
functions/
  index.js                 Cloud Function export
  dev.js                   local server with in-memory quota
  demo.js                  routes, origin check, quota
  demoCase.js              the fictional patient (English and Korean sheets)
  gemini.js                Live config and token minting
  tts.js                   turn text and TTS streaming
Firebase config at the repo root: hosting rewrites and the functions source.
```

## Models

| Role | Default | Override |
| :- | :- | :- |
| Live (speech to speech) | `gemini-3.8-live` | `GEMINI_LIVE_MODEL` |
| Transcription | `gemini-3.5-transcribe-live` | `GEMINI_STT_MODEL` |
| Turn text | `gemini-3.8-flash` | `GEMINI_BRAIN_MODEL` |
| TTS | `gemini-3.8-flash-lite-tts` | `GEMINI_TTS_MODEL` |

The voice is `Kore` for both pipelines and both languages.

## License

MIT. See `LICENSE`.
