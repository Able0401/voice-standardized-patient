// Screen text (English). The patient is a fictional case written for this demo; the same person is
// defined in functions/demoCase.js. The patient's instructions are not here. Only the server has them.

export const MINUTES = 8;

export const TEXT = {
  tag: 'Demo',
  title: 'Practice a clinical interview\nwith a voice AI patient',
  lede: 'Medical students rehearse patient interviews with trained actors playing standardized patients. This page puts a voice agent in the actor’s place. Talk into your microphone and the patient answers out loud.',
  doorLabel: 'Door note',
  door: [
    'Jieun Kim, a 31-year-old woman, comes in saying she cannot sleep well.',
    'Vitals: BP 118/74 mmHg · HR 88/min · RR 16/min · Temp 36.6 °C',
    `Take her history, then discuss your working diagnosis and plan with her. (${MINUTES} min)`,
  ],
  engineLabel: 'Speech pipeline',
  engines: {
    live: { name: 'Live', caption: 'Voice: single speech-to-speech model' },
    tts: { name: 'Cascade', caption: 'Voice: transcription + text model + TTS' },
  },
  notes: [
    'Needs microphone access. Works best in a quiet room with earphones.',
    'Nothing is stored. Audio is sent to the Google Gemini API to generate the replies.',
    'Public demo: up to 3 sessions per person per day.',
    'Simulated patient. Not medical care or advice.',
  ],
  start: 'Start interview',
  connecting: 'Connecting…',
  listening: 'Listening',
  patientSpeaking: 'Patient speaking',
  you: 'You',
  patient: 'Patient',
  hint: 'Try opening with “Hello, what brings you in today?”',
  end: 'End interview',
  doneTitle: 'Interview finished',
  doneLede: 'Check which of these you asked about. Some things the patient only mentions when asked.',
  checklist: [
    'Sleep pattern and duration (trouble falling asleep, early waking, two months)',
    'What she worries about and for how long (many areas, over six months, hard to stop)',
    'Physical symptoms (muscle tension, fatigue, poor concentration)',
    'Whether she has had panic attacks',
    'Depressive symptoms and loss of interest',
    'Suicidal thoughts',
    'Alcohol: wine to fall asleep (not mentioned unless asked)',
    'Caffeine and phone use in bed',
    'Hyperthyroid symptoms (weight, heat, tremor)',
    'Family history',
    'What she wants and fears (sleeping pills, “Is this an illness?”)',
  ],
  transcript: 'Transcript',
  again: 'Try again',
  errors: {
    mic: 'Microphone unavailable. Allow microphone access in the address bar.',
    quota: 'The demo limit for today has been reached. Please try again tomorrow.',
    budget: 'The demo’s API budget is used up. Please try again later.',
    connect: 'The patient could not be reached.',
    network: 'The connection dropped.',
    default: 'Could not connect. Please try again shortly.',
  },
  footer: 'Hyun Seung Moon · Voice Standardized Patient',
};
