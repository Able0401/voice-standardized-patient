// Screen text (English). The patient is a fictional case written for this demo; the same person is
// defined in functions/demoCase.js. The patient's instructions and the portrayal texts are not here;
// only the server has them. This file names the two portrayals and describes each in a sentence.

export const MINUTES = 8;

export const TEXT = {
  tag: 'Demo',
  title: 'Practice psychiatric history taking\nwith an AI patient',
  lede: 'A demo for practicing psychiatric patient interviews on your own. Ask questions through your microphone and the patient responds by voice.',
  doorLabel: 'Door note',
  door: [
    'Jieun Kim, 31, female, presents with trouble sleeping.',
    'Vitals: BP 118/74 mmHg · HR 88/min · RR 16/min · Temp 36.6 °C',
    `Take a history, then explain your likely diagnosis and next steps to the patient. (${MINUTES} min)`,
  ],
  notes: [
    'Microphone access is required. Earphones improve recognition by keeping the patient’s voice out of the microphone.',
    'Conversations are not stored. Audio is processed by the Google Gemini API.',
    'Limited to 10 interviews per day.',
  ],
  portrayalLabel: 'Patient type',
  portrayals: {
    assessment: { name: 'Assessment standardized patient' },
    teaching: { name: 'Teaching patient' },
  },
  againOther: (name) => `Try the ${name.toLowerCase()}`,
  start: 'Start interview',
  connecting: 'Connecting…',
  listening: 'Listening',
  patientSpeaking: 'Patient speaking',
  you: 'You',
  patient: 'Patient',
  hint: 'For example: “Hello, what brings you in today?”',
  end: 'End interview',
  doneTitle: 'Interview complete',
  doneLede: 'Review which items you asked about. Some information is disclosed only when asked.',
  checklist: [
    'Sleep: trouble falling asleep, waking early, for two months',
    'Worry: about many things, for over six months, hard to stop',
    'Physical symptoms: tense muscles, tiredness, poor focus',
    'Any panic attacks',
    'Low mood or loss of interest',
    'Suicidal thoughts',
    'Wine to fall asleep (she won’t bring it up)',
    'Coffee, and phone use in bed',
    'Thyroid: weight change, feeling hot, shaky hands',
    'Family history',
    'What she wants and fears (sleeping pills, “Is this an illness?”)',
  ],
  transcript: 'Transcript',
  again: 'Return to start',
  errors: {
    mic: 'Microphone unavailable. Allow access from the icon at the left of the address bar.',
    quota: 'The daily limit of 10 interviews has been reached. Please try again tomorrow.',
    network: 'The connection was lost.',
    budget: 'The AI service is temporarily unavailable. Please try again later.',
    connect: 'Unable to reach the patient. Please try again shortly.',
    default: 'Unable to connect. Please try again shortly.',
  },
  footer: 'Hyun Seung Moon · Voice Standardized Patient',
};
