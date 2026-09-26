# Voice Standardized Patient

A browser-based voice standardized patient (SP) for practising clinical history taking. The demo runs a single fictional case (Jieun Kim, 31, chief complaint: insomnia) on the Gemini Live API. The interface is in English by default and in Korean with `?lang=ko`.

**Live demo:** https://sptalk-demo.web.app

## Overview

The Clinical Performance Examination (CPX) in the Korean Medical Licensing Examination asks students to interview a standardized patient, a trained actor who follows a case script. Students are scored on a checklist of the questions they ask. The SP answers only what is asked and does not volunteer additional information. Practising outside the exam therefore requires another person to play the patient.

This project replaces that person with a speech-to-speech model. The student opens the page, starts a session, and interviews the patient by voice. No installation or account is required. The demo tests two things: whether a spoken SP interview can run in a standard web browser, and whether this can be done without exposing the case script to the student and without recording the conversation.

## System architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img alt="System architecture. The browser streams microphone audio to the Gemini Live API over a single WebSocket connection and plays back the patient's speech and transcripts. At session start, the server builds a fixed system prompt from three parts: a role section, the case sheet (with some facts marked as disclosed only on direct questioning, such as drinking wine before bed), and voice-conversation rules. It also sets the voice, turn detection, and transcription options. Gemini Live detects the end of the student's turn, responds as the patient in speech, and transcribes both speakers. Example exchange: the student asks whether the patient drinks anything to help her sleep, and the patient reports one or two glasses of wine." src="docs/architecture-light.png">
</picture>

The browser streams microphone audio to the Gemini Live API over a single WebSocket connection. Gemini Live is an end-to-end speech-to-speech model: it performs turn detection, generates the patient's spoken response, and transcribes both speakers. The pipeline has no separate speech-to-text or text-to-speech stage. The client plays the response audio, displays the transcript, and stops playback when the student interrupts (barge-in).

The patient's behaviour is defined by a system prompt that is fixed for the whole session. The prompt has three parts:

1. **Role instructions** that keep the model in the patient role (e.g., "Only answer, as the patient, when the doctor asks.").
2. **Case sheet** with the patient's history. Some items are marked as disclosed only on direct questioning, such as alcohol use before bed in the example above.
3. **Voice-conversation rules** for pauses, coughs, and background noise.

The server assembles this prompt when the session starts and locks it into a single-use ephemeral token. After the token is issued, the server is not involved in the conversation.

**Turn detection.** Voice activity detection ends the student's turn after 2.5 s of silence, so a student who pauses mid-question is not interrupted. Measured latency from the end of student speech to the first patient audio is 2.9–3.1 s (September 2026, synthesized speech input); most of this is the 2.5 s silence threshold.

## Privacy and security

- **The case script is not exposed to the client.** The case sheet also serves as the answer key, since it lists what a complete interview should uncover. It exists only on the server and inside the ephemeral token, which locks the full session configuration (system prompt, model, voice). The browser cannot read the prompt or override it with its own.
- **No conversation data is stored.** Audio is sent from the browser directly to the Gemini Live API and never reaches the demo server. Transcripts are kept in browser memory only and are cleared when the page is reloaded. Audio sent to Google is handled under the Gemini API terms.

## Getting started

### Requirements

- Node.js 22
- A Google AI Studio API key

### Installation and local run

```bash
npm run install:all
cp .env.example functions/.env   # set GEMINI_API_KEY
npm run dev
```

The API server runs at http://localhost:8788 with an in-memory quota. The client runs at http://localhost:5173 and proxies `/api/demo` to the API server.

## Deployment

The demo is deployed on Firebase (Hosting, Cloud Functions, Firestore).

```bash
cp .firebaserc.example .firebaserc   # set your Firebase project ID
npm run deploy
```

Hosting serves `client/dist`. Requests to `/api/**` are routed to the `demo` function in `us-central1`. Firestore stores the daily usage counter.

### Configuration

Set these in `functions/.env`:

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key (required) |
| `GEMINI_DEMO_API_KEY` | Optional second key with its own spending limit; used instead of `GEMINI_API_KEY` when set |
| `DEMO_ORIGINS` | Comma-separated origins allowed to request a session; localhost is always allowed |
| `DEMO_PER_IP` | Maximum sessions per IP address per day |
| `DEMO_PER_DAY` | Maximum sessions in total per day |
| `GEMINI_LIVE_MODEL` | Live model (default `gemini-3.8-live`) |

The quota is counted in one Firestore document per day. If the counter cannot be read, the request is rejected.

## Repository structure

```
client/src/demo/DemoApp.jsx   UI: intro, session, and end screens
client/src/demo/live.js       session management: token request, status, errors
client/src/demo/content.js    UI text and the doorway information shown before the encounter
client/src/lib/geminiLive.js  Live WebSocket client, microphone AudioWorklet, playback, transcript assembly
functions/index.js            Cloud Functions entry point
functions/dev.js              local development server with in-memory quota
functions/demo.js             session endpoint, origin check, quota
functions/demoCase.js         the fictional case (English and Korean case sheets)
functions/gemini.js           Live session configuration and ephemeral token issuance
docs/architecture.*           architecture figure; architecture.html is the source (SVG, light and dark)
```

## Model

`gemini-3.8-live` with the prebuilt voice `Kore`. Override the model with `GEMINI_LIVE_MODEL`.

## License

MIT. See [LICENSE](LICENSE).
