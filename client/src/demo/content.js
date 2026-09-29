// Screen text (English). The patient is a fictional case written for this demo; the same person is
// defined in functions/demoCase.js. The patient's instructions and the portrayal texts are not here;
// only the server has them. This file names the two portrayals and describes each in a sentence.

export const MINUTES = 8;

export const TEXT = {
  tag: 'Demo',
  title: 'Practice psychiatric history taking\nwith an AI patient',
  lede: 'A way to practice a patient interview on your own. Ask questions into your mic and the patient talks back.',
  doorLabel: 'Door note',
  door: [
    'Jieun Kim, 31, female, presents with trouble sleeping.',
    'Vitals: BP 118/74 mmHg · HR 88/min · RR 16/min · Temp 36.6 °C',
    `Take a history, then explain your likely diagnosis and next steps to the patient. (${MINUTES} min)`,
  ],
  notes: [
    'Allow microphone access. Earphones help, since they keep the patient’s voice out of your mic.',
    'Nothing is saved. Your audio goes to the Google Gemini API to generate replies.',
    'Up to 10 interviews per day.',
    'Fictional patient. Not medical advice.',
  ],
  portrayalLabel: 'Patient type',
  portrayals: {
    assessment: {
      name: 'Exam patient',
      desc: 'Acts like a standardized patient in the exam room. She may bring things up before you ask.',
    },
    teaching: {
      name: 'Teaching patient',
      desc: 'Only answers what you ask. Come back to a topic two or three times and she’ll tell you. Show some empathy and she opens up.',
    },
  },
  againOther: (name) => `Try again with the ${name.toLowerCase()}`,
  start: 'Start interview',
  connecting: 'Connecting…',
  listening: 'Listening',
  patientSpeaking: 'Patient is talking',
  you: 'You',
  patient: 'Patient',
  hint: 'Try starting with “Hi, what brings you in today?”',
  end: 'End interview',
  doneTitle: 'Interview over',
  doneLede: 'Tick off what you asked about. Some of these she won’t mention unless you ask.',
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
  again: 'Back to the start',
  errors: {
    mic: 'Couldn’t turn on your mic. Allow it from the icon on the left of the address bar.',
    quota: 'You’ve used all 10 for today. Try again tomorrow.',
    budget: 'The AI service is out of credit right now. Try again a little later.',
    connect: 'Couldn’t reach the patient. Try again in a moment.',
    network: 'The connection dropped.',
    default: 'Couldn’t connect. Try again in a moment.',
  },
  footer: 'Hyun Seung Moon · Voice Standardized Patient',
};
