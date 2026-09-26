# Voice Standardized Patient

A voice AI patient for practising a clinical interview in the browser: one page, one fictional patient (Jieun Kim, 31, cannot sleep), one Gemini Live session. English by default, Korean with `?lang=ko`.

Live demo: https://sptalk-demo.web.app

## What it is for

In the clinical skills part of the Korean medical licensing exam (CPX), a student interviews a patient played by a trained actor and is scored against a checklist of what they asked. The patient answers what is asked and does not volunteer the rest. To practise, a student needs someone willing to play the patient.

This page puts one such patient in a browser tab. You press start, speak, and the patient answers out loud. There is nothing to install and no account. The demo shows that a spoken patient interview can run in an ordinary browser while the patient's script stays hidden and nothing is recorded.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img alt="Architecture. The student speaks; the browser streams the microphone to the Gemini Live API over one live connection and plays back the patient's voice and transcripts. At the start of the session the session server assembles a fixed prompt: a role section that keeps the model in the patient's part, the case sheet (with facts marked only if asked, such as wine before bed), and a rule for voice conversation, plus settings for the voice, turn detection and transcription. Gemini Live, a single speech-to-speech model, listens, decides when the question has ended, answers as the patient in speech, and transcribes both sides. Example exchange: the student asks whether she drinks anything to help her sleep; the patient admits to a glass or two of wine." src="docs/architecture-light.png">
</picture>

The student speaks and the browser streams the microphone to the Gemini Live API over one live connection. Gemini Live is a single speech-to-speech model: it listens, decides when the question has ended, answers as the patient in speech, and writes down what each side said. There is no separate speech-to-text or text-to-speech step. The browser plays the answer, shows the transcript, and cuts playback if the student talks over the patient.

What the model knows comes from one prompt, fixed for the session. It has three parts: a role section that keeps the model in the patient's part ("Only answer, as the patient, when the doctor asks."), the case sheet, and a rule for voice conversation. Some facts in the case sheet are marked "only if asked", such as the wine in the example, and the patient keeps them back until the student asks. The session server assembles this prompt once, at the start, and hands it to Google inside a one-time token; after that it takes no part in the conversation.

Gemini decides when the student has finished a question. It waits for 2.5 s of silence, so a student who pauses to think is not cut off. The first patient audio arrives 2.9–3.1 s after the student stops speaking (measured in 2026-09 with synthesized speech as input); most of that is the deliberate wait.

## What the design gives you

- The student cannot read the answers. Because the patient only reveals what is asked, the script works as an answer key. It stays on the server and inside the sealed ticket. The browser can neither read it nor replace it with its own instructions.
- Nothing is recorded. Audio goes from the browser to Google, and the demo server never receives it. The transcript lives in the page and is gone on reload.

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
cp .firebaserc.example .firebaserc   # set your Firebase project id
npm run deploy
```

In `functions/.env`, `DEMO_ORIGINS` lists the sites allowed to ask for a session (localhost is always allowed). `DEMO_PER_IP` and `DEMO_PER_DAY` cap sessions per visitor and in total per day, counted in one Firestore document per day; if the counter cannot be read, the request is refused.

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
docs/architecture.*           the figure; architecture.html is the source (SVG, light and dark)
```

## Models

`gemini-3.8-live`, voice `Kore`; override the model with `GEMINI_LIVE_MODEL`.

## License

MIT. See `LICENSE`.
