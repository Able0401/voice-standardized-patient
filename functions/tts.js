// Server side of the cascade pipeline: patient line (text model) and voice (TTS).
//
// The cascade is: listen (Live transcription, in the browser) -> line (text model) -> voice (TTS).
// This file holds the last two steps. Ephemeral tokens cover Live sessions only, so the server
// relays the TTS audio instead of handing the browser a key.

import { GoogleGenAI } from '@google/genai';

export const STT_MODEL_DEFAULT = 'gemini-3.5-transcribe-live';
export const TTS_MODEL_DEFAULT = 'gemini-3.8-flash-lite-tts'; // first audio in about 1.1 s (the larger flash-tts: 1.8 s)
export const BRAIN_MODEL_DEFAULT = 'gemini-3.8-flash';

// The model returns the spoken words and a one-line delivery note together.
const TURN_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Only the words the patient says out loud. No stage directions or parentheticals.' },
    style: { type: 'string', description: 'One short line describing the delivery of this utterance (for example "tired, a little slow"). Empty string if nothing special.' },
  },
  required: ['text', 'style'],
};

const TURN_RULES_KO = `당신은 위 지시문대로 연기하는 환자다. 학생(의사)의 마지막 말에 대한 환자의 다음 발화 하나만 만든다.

- text: 환자가 소리 내어 말하는 말만 쓴다. 지문이나 설명을 넣지 않는다.
- 뜸·한숨·기침 같은 순간적인 소리는 text 안에 <short pause>, <long pause>, <sigh>, <breath>, <laugh>, <cough> 태그로 넣는다. 다른 태그는 쓰지 않는다.
- style: 이 발화 전체의 말투를 짧은 한 줄로 쓴다. 특별할 게 없으면 빈 문자열로 둔다.
- 위 환자 시트에 없는 임상 사실은 지어내지 않는다. 시트에 없는 것을 물으면 "잘 모르겠어요"라고 한다.
- 한국어로 말한다. 한 번에 한두 문장.`;

const TURN_RULES_EN = `You are the patient described above. Produce only the patient's next single utterance in reply to the student's last turn.

- text: only the words the patient says out loud. No stage directions.
- Put momentary sounds inline with the tags <short pause>, <long pause>, <sigh>, <breath>, <laugh>, <cough>. Use no other tags.
- style: one short line describing the delivery of this whole utterance, or an empty string.
- Never invent clinical facts that are not on the patient sheet above. If asked about something not on the sheet, say "I'm not sure."
- Speak English. One or two sentences.`;

/**
 * The patient's next utterance: { text, style }
 * @param {{apiKey:string, model:string, instructions:string, history:Array<{role:string,text:string}>, lang:'ko'|'en'}} o
 */
export async function patientTurn({ apiKey, model, instructions, history = [], lang = 'en' }) {
  const ai = new GoogleGenAI({ apiKey });
  const transcript = history
    .slice(-20)
    .map((m) => `${m.role === 'user' ? (lang === 'en' ? 'Student' : '학생') : lang === 'en' ? 'Patient' : '환자'}: ${m.text}`)
    .join('\n');
  const res = await ai.models.generateContent({
    model,
    config: {
      systemInstruction: [instructions, lang === 'en' ? TURN_RULES_EN : TURN_RULES_KO].join('\n\n'),
      responseMimeType: 'application/json',
      responseSchema: TURN_SCHEMA,
      temperature: 1,
      // Thinking off: turn text takes 1.6 s instead of 8.2 s (measured 2026-09-25). One line of
      // dialogue does not need reasoning.
      thinkingConfig: { thinkingBudget: 0 },
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              lang === 'en' ? '[Conversation so far]' : '[지금까지의 대화]',
              transcript || (lang === 'en' ? '(none)' : '(없음)'),
            ].join('\n'),
          },
        ],
      },
    ],
  });
  let out = {};
  try {
    out = JSON.parse(res.text || '{}');
  } catch {
    out = { text: (res.text || '').trim(), style: '' };
  }
  return { text: String(out.text || '').trim(), style: String(out.style || '').trim() };
}

/**
 * Streaming TTS. Emits 24 kHz 16-bit PCM chunks through onChunk.
 * @param {{apiKey:string, model:string, text:string, style?:string, voice:string, onChunk:(b:Buffer|Uint8Array)=>void}} o
 */
export async function streamTts({ apiKey, model, text, style = '', voice, onChunk }) {
  const ai = new GoogleGenAI({ apiKey });
  const stream = await ai.interactions.create({
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text,
            // The delivery note goes into metadata so it is not read aloud (the TTS model reads `text` verbatim).
            ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}),
          },
        ],
      },
    ],
    response_format: { type: 'audio', mime_type: 'audio/l16' },
    generation_config: { speech_config: [{ voice }] },
    stream: true,
  });
  for await (const e of stream) {
    if (e.event_type === 'step.delta' && e.delta?.type === 'audio' && e.delta.data) {
      onChunk(Buffer.from(e.delta.data, 'base64'));
    }
  }
}
