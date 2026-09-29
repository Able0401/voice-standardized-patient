// Screen text (English). The patient is a fictional case written for this demo; the same person is
// defined in functions/demoCase.js. The patient's instructions and the portrayal texts are not here;
// only the server has them. This file names the two portrayals and describes each in a sentence.

export const MINUTES = 8;

export const TEXT = {
  tag: 'Demo',
  title: 'Practice a clinical interview\nout loud',
  lede: 'To practise patient interviews, medical students usually need someone to play the patient. Here an AI plays her. Ask your questions into the mic and she answers out loud.',
  doorLabel: 'Door note',
  door: [
    'Jieun Kim, a 31-year-old woman, comes in saying she cannot sleep well.',
    'Vitals: BP 118/74 mmHg · HR 88/min · RR 16/min · Temp 36.6 °C',
    `Take her history, then discuss your working diagnosis and plan with her. (${MINUTES} min)`,
  ],
  notes: [
    'You’ll need to allow the mic. Earphones and a quiet room help a lot.',
    'We don’t save the conversation. Your voice goes to Google’s Gemini API so she can answer.',
    '10 interviews a day per person.',
    'She’s made up. This isn’t medical advice.',
  ],
  portrayalLabel: 'How she is played',
  portrayals: {
    assessment: {
      name: 'Assessment standardized patient',
      desc: 'Like the actor in the exam room. As close to a real patient as possible, so she may bring things up before you ask.',
    },
    teaching: {
      name: 'Teaching patient',
      desc: 'Set up as a practice partner. She answers what you ask, and if you come back to a topic two or three times she tells you. Be kind and she talks more.',
    },
  },
  againOther: (name) => `Now try the ${name.toLowerCase()}`,
  start: 'Start interview',
  connecting: 'Connecting…',
  listening: 'Listening',
  patientSpeaking: 'Patient speaking',
  you: 'You',
  patient: 'Patient',
  hint: 'Try opening with “Hello, what brings you in today?”',
  end: 'End interview',
  doneTitle: 'That’s the interview',
  doneLede: 'How many of these did you ask about? Some of them she never mentions unless you do.',
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
  again: 'Back to start',
  errors: {
    mic: 'Can’t reach your mic. Allow it from the icon in the address bar.',
    quota: 'That’s all 10 for today. Come back tomorrow.',
    budget: 'The demo has run out of API credit for now. Try again later.',
    connect: 'Couldn’t reach the patient. Try again in a bit.',
    network: 'The connection dropped.',
    default: 'Couldn’t connect. Try again in a bit.',
  },
  footer: 'Hyun Seung Moon · Voice Standardized Patient',
};
