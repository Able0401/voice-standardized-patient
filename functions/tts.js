// Speech pipeline, server side: the patient's line (text model) and the voice (TTS).
// Listening runs in the browser on a transcription-only Live session (gemini.js mints its token).
// TTS has no ephemeral tokens, so the server relays the audio.
//
// Acting direction follows the Gemini 3.8 TTS guide (ai.google.dev/gemini-api/docs/speech-generation,
// "Prompting guide", 2026-09-24): the text is a verbatim transcript, delivery for the whole utterance
// goes in speech_metadata.style, and momentary sounds are inline angle-bracket tags.
// style is one sentence on every turn (2026-10-01); before, it was written only when the delivery left the baseline.

import { GoogleGenAI } from '@google/genai';

export const STT_MODEL_DEFAULT = 'gemini-3.5-transcribe-live';
// The expressive model. gemini-3.8-flash-lite-tts starts about 0.4 s sooner.
export const TTS_MODEL_DEFAULT = 'gemini-3.8-flash-tts';
export const BRAIN_MODEL_DEFAULT = 'gemini-3.8-flash';
// Silence that ends the student's turn (1200 -> 600 ms, 2026-10-02: the listening state lingered too long
// after the student stopped). A question cut off by a longer pause is joined to the next fragment by the
// client, as long as the patient has not started speaking.
export const STT_SILENCE_MS = 600;

// Vocal tags from the guide's recommended list that fit a clinic interview. Whispering is a style, not a tag.
export const DELIVERY_TAGS = [
  'short pause', 'long pause',
  'sigh', 'breath', 'heavy breath', 'exhales',
  'chuckle', 'laugh', 'cough', 'throat-clearing',
  'sob', 'whimper', 'tsk', 'groan', 'yawn',
];
const TAG_LIST = DELIVERY_TAGS.map((t) => `<${t}>`).join(' ');

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: '환자가 소리 내어 말하는 대본. 글자 그대로 읽힌다. 지문·괄호 설명 금지, 순간적인 소리만 <영어 태그>.',
    },
    style: {
      type: 'string',
      description: 'How this whole utterance is delivered: one English sentence on emotional state, pace and volume. Written on every turn.',
    },
    moment: {
      type: 'string',
      description: 'Id of the scripted moment this utterance performs, copied exactly from the portrayal block (for example "S2"). Empty string on every other turn.',
    },
  },
  required: ['text', 'style'],
};

const TURN_RULES_KO = `당신은 위 지시문대로 연기하는 환자다. 학생(의사)의 마지막 말에 대한 환자의 다음 발화 하나만 만든다.
이 발화는 음성 합성 모델이 읽는다. 무엇을 말하는지는 text, 발화 전체를 어떻게 말하는지는 style, 특정 순간의 소리는 text 안의 태그가 맡는다.

[text — 그대로 읽히는 대본]
- 환자가 입 밖으로 내는 말만 쓴다. text 에 쓴 글자는 전부 소리로 나온다. "(한숨)", "(작게)", "*머뭇거리며*" 같은 지문은 쓰지 않는다.
- 실제 말하는 사람의 전사처럼 쓴다. 망설임("음…", "그게…", "어…"), 말끝 흐림(…), 말을 고쳐 하기를 필요한 만큼 넣는다. 매 문장마다는 아니다.
- 한 번에 한두 문장.

[태그 — 특정 순간의 소리]
- 한숨·숨·뜸처럼 한 번 나고 끝나는 소리는 그 소리가 나는 자리에 꺾쇠 태그로 넣는다. 한국어 대사여도 태그는 영어로 쓴다.
- 쓸 수 있는 태그: ${TAG_LIST}. 다른 태그는 쓰지 않는다. 속삭임·떨림·빠르기 같은 말투는 태그가 아니라 style 이다.
- 태그는 한 발화에 많아야 두 개. 없는 발화가 더 많다. 쉼표·말줄임표로 충분한 곳에는 <short pause> 를 쓰지 않는다. 연기 방식 블록이 내지 말라고 한 소리(예: 울먹임)는 태그로도 내지 않는다.
- 세로 막대(|)는 쓰지 않는다.

[style — 이 발화 전체의 말투]
- 매 발화마다 쓴다. 이 인물의 평소 말투(위 표현 지침)를 지금 이 순간의 기분으로 읽어, 음성 모델이 연기할 수 있게 영어 한 문장으로 적는다. 감정 상태와 빠르기·크기를 담고, 숨이 거칠거나 목소리가 떨리면 그것도 쓴다.
- 형용사 나열보다 어떻게 들리는지 그린 한 문장이 낫다. 예: "Tired and flat, speaking slowly with little energy." "Guarded; a quiet, even voice, keeping the words short." "Voice tightens and trembles a little as the topic gets closer." "Mild irritation under polite words, a touch faster than usual."
- 한 문장, 25단어 안. 지시를 여러 개 붙이지 않는다. 과하게 정하면 연기가 나빠진다.
- 한 사람의 한 면담이다. 빠르기·크기·톤의 기본값은 위 지시문에서 이 인물의 말투를 적은 블록이 정한다. 그 기본값에서 어느 대목에 얼마나 멀리 움직이는지, 어떤 소리를 내지 않는지는 위 지시문 중 연기 방식을 정한 블록이 정한다. 그 블록을 따른다. 이유 없이 턴마다 바뀌지 않는다. 움직일 때는 대화 속 이유(주제, 학생의 태도)가 있다. 대화 기록의 환자 줄에 괄호로 적힌 것이 바로 앞 발화들의 style 이다. 거기서 이어 간다.
- 같은 기분이 다음 발화에도 이어지면 같은 문자열을 그대로 다시 쓴다. 기분이 움직였을 때만, 그것도 한 번에 한 걸음만 바꾼다.
- 나이·성별·이름·사투리·인물 설명, "목소리를 유지하라" 같은 지시는 쓰지 않는다. 무엇을 말할지도 쓰지 않는다.
- 한 발화 안에서 말투가 확 바뀌어야 하면 거기서 발화를 끝낸다.

[moment — 장면 보고]
- 위 지시문의 연기 방식 블록에 미리 정해 둔 장면 표가 있고, 이번 발화가 그 표의 한 줄에 적힌 반응을 연기한 것이면 그 줄의 id 를 그대로 적는다(예: "S2").
- 대화 기록의 환자 줄에 대괄호로 적힌 id 는 그 발화에서 이미 연기한 장면이다. 끝난 장면은 다시 시작하지 않는다. 장면이 아직 풀리지 않아 다음 발화로 이어지면(연기 방식 블록이 허락하는 만큼) 그 발화에도 같은 id 를 적는다. 장면 수의 상한은 서로 다른 id 의 수로 센다.
- 그 밖의 발화는 빈 문자열이다. 표가 없으면 항상 빈 문자열이다. 장면을 연기한 발화의 style 과 태그는 그 줄의 반응이 정한 만큼 움직인다.

[내용]
- 메모에 없는 임상 사실은 지어내지 않는다. 메모가 비어 있으면 사실을 말하지 않고 짧게 반응만 한다.
- 한국어로만 말한다. 학생이 영어로 물어도 한국어로 답한다. text 에 영어 단어·문장을 쓰지 않는다(태그는 예외). style 은 영어로 쓴다. 이 규칙이 다른 모든 지시보다 우선한다.`;

const TURN_RULES_EN = `You are the patient described above. Produce only the patient's next single utterance in reply to the student's last turn.
A speech model reads this utterance aloud. text carries what is said, style carries how the whole utterance is delivered, and inline tags carry momentary sounds.

[text — a verbatim transcript]
- Only the words the patient says out loud. Every character in text is spoken. No stage directions such as "(sighs)" or "*hesitates*".
- Write it like a transcript of real speech: hesitations ("um…", "well…"), trailing off (…), self-corrections, as needed. Not in every sentence.
- One or two sentences.

[tags — momentary sounds]
- Put one-off sounds (a sigh, a breath, a pause) at the exact point they happen, as angle-bracket tags.
- Allowed tags: ${TAG_LIST}. Use no other tags. Whispering, trembling or pace are style, not tags.
- At most two tags per utterance; most utterances have none. Do not add <short pause> where a comma or ellipsis already does the job. A sound the portrayal block rules out (a sob, for instance) is not made as a tag either.
- Never use the pipe character (|).

[style — delivery of the whole utterance]
- Write it on every turn. Read the character's usual delivery (the expression guidance above) through this moment's mood and put it in one English sentence the speech model can act: emotional state, pace and volume, plus breath or a trembling voice when present.
- One sentence that describes how it sounds beats a list of adjectives. Examples: "Tired and flat, speaking slowly with little energy." "Guarded; a quiet, even voice, keeping the words short." "Voice tightens and trembles a little as the topic gets closer." "Mild irritation under polite words, a touch faster than usual."
- One sentence, under 25 words. Do not stack directions; over-specifying makes the performance worse.
- One person, one interview. Pace, volume and tone default to the block above that describes how this person talks. How far they move from that default, at which moments, and which sounds are off limits is set by the block above that defines the portrayal. Follow that block. Nothing changes from turn to turn without a reason, and the reason is in the conversation (the topic, the student's manner). The parenthesis on each Patient line in the conversation is the style of that earlier utterance; continue from it.
- If the same mood continues into the next utterance, repeat the exact same string. Change it only when the mood moves, and then by one step at a time.
- Never put age, gender, name, accent, character description, or instructions like "keep the same voice" in style. Never put the content in style.
- If the delivery must change sharply mid-utterance, end the utterance there.

[moment — reporting a scripted moment]
- If the portrayal block above carries a table of scripted moments and this utterance performs the reaction written on one of its rows, copy that row's id exactly (for example "S2").
- An id in square brackets on a Patient line in the conversation marks a moment already performed there. Do not start a finished moment again. If a moment is not yet resolved and carries into the next utterance (as far as the portrayal block allows), write the same id on that utterance too. Count the limit on moments by distinct ids.
- On every other utterance it is an empty string. With no table it is always empty. On an utterance that performs a moment, style and tags move as far as that row's reaction says.

[content]
- Never invent clinical facts that are not in the notes. If the notes are empty, react briefly without stating facts.
- Speak English.`;

/**
 * The patient's next utterance. { text, style, moment }
 * @param {{apiKey:string, model:string, instructions:string, history:Array<{role:string,text:string}>, notes:string, lang:'ko'|'en'}} o
 */
export async function patientTurn({ apiKey, model, instructions, history = [], notes = '', lang = 'ko' }) {
  const ai = new GoogleGenAI({ apiKey });
  // Each Patient line carries its own style in parentheses, so the model sees how it spoke last time and continues from it.
  const transcript = history
    .slice(-20)
    .map((m) => {
      const who = m.role === 'user' ? (lang === 'en' ? 'Student' : '학생') : lang === 'en' ? 'Patient' : '환자';
      const st = m.role !== 'user' && typeof m.style === 'string' ? m.style.trim().slice(0, 200) : '';
      // A moment already performed is marked on its line so the model does not repeat it and can count them
      const mo = m.role !== 'user' && typeof m.moment === 'string' ? m.moment.trim().slice(0, 20) : '';
      return `${who}${st ? ` (${st})` : ''}${mo ? ` [${mo}]` : ''}: ${m.text}`;
    })
    .join('\n');
  const res = await ai.models.generateContent({
    model,
    config: {
      systemInstruction: [instructions, lang === 'en' ? TURN_RULES_EN : TURN_RULES_KO].join('\n\n'),
      responseMimeType: 'application/json',
      responseSchema: TURN_SCHEMA,
      temperature: 1,
      // Thinking off: 8.2 s -> 1.6 s per line (measured 2026-09-25). One line of dialogue needs no reasoning.
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
              '',
              lang === 'en' ? '[Notes for this turn]' : '[이번 턴 메모]',
              notes || (lang === 'en' ? '(none)' : '(없음)'),
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
  return { text: String(out.text || '').trim(), style: String(out.style || '').trim(), moment: String(out.moment || '').trim().slice(0, 20) };
}

// Cleaned only right before synthesis. Tags outside the list may be read out as words, and |...| is
// the two-speaker backchannel syntax.
const ALLOWED = new Set(DELIVERY_TAGS);
export function speakable(text = '') {
  return String(text)
    .replace(/<([^<>]{1,30})>/g, (m, t) => (ALLOWED.has(t.trim().toLowerCase()) ? `<${t.trim().toLowerCase()}>` : ' '))
    .replace(/\|[^|]{0,40}\|/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Streaming TTS. Sends 24 kHz 16-bit PCM chunks to onChunk.
 * @param {{apiKey:string, model:string, text:string, style?:string, voice:string, onChunk:(b:Buffer|Uint8Array)=>void}} o
 */
export async function streamTts({ apiKey, model, text, style = '', voice, onChunk }) {
  const ai = new GoogleGenAI({ apiKey });
  text = speakable(text);
  if (!text) return;
  const stream = await ai.interactions.create({
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text,
            // Delivery goes here so it is not read aloud (Gemini 3.8 TTS reads text verbatim)
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

// The first call in a process is 0.5-1.3 s slower while the connection opens (measured 2026-09-29).
// A free metadata call at session start opens it early.
export async function warmUp({ apiKey, model }) {
  await new GoogleGenAI({ apiKey }).models.get({ model });
}

/**
 * Line and voice in one request (saves a round trip). The line is in the X-Turn header (URI-encoded JSON),
 * the body is 24 kHz PCM.
 * The line is not split by sentence: when streamed, its first chunk arrives near the end anyway.
 */
export async function speakTurn(res, { apiKey, brainModel, ttsModel, voice, ...turnArgs }) {
  const turn = await patientTurn({ apiKey, model: brainModel, ...turnArgs });
  if (!turn.text) throw new Error('empty turn');
  res.set({
    'Content-Type': 'audio/l16; rate=24000',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    'X-Turn': encodeURIComponent(JSON.stringify(turn)),
  });
  res.flushHeaders?.();
  await streamTts({ apiKey, model: ttsModel, text: turn.text, style: turn.style, voice, onChunk: (b) => res.write(b) });
  res.end();
}
