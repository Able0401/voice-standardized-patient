// Gemini Live session config and ephemeral token minting.
//
// The browser connects to the Gemini Live WebSocket directly. The server only mints a token with the
// API key and locks the session config into that token, so the client cannot change the
// instructions, the model, or the voice.

import { GoogleGenAI } from '@google/genai';

export const LIVE_MODEL_DEFAULT = 'gemini-3.8-live';

// Prebuilt Gemini voice name. The case sheet names the voice directly.
export const geminiVoice = (voice) => voice || 'Kore';

// Only what VAD and transcription cannot do goes into the instructions.
const voiceRules = (lang) =>
  (lang === 'en'
    ? [
        '[VOICE CONVERSATION RULES]',
        '- Keep listening while the student pauses to think. Do not treat a cough, noise, or nearby talk as a new question.',
      ]
    : [
        '[음성 대화 규칙]',
        '- 학생이 말하다 멈추고 생각해도 끝까지 기다린다. 기침·잡음·주변 말소리는 새 질문으로 취급하지 않는다.',
      ]
  ).join('\n');

/**
 * Live session config (@google/genai LiveConnectConfig).
 * With `resumable`, sessionResumption is enabled. On reconnect the server mints a new token that
 * carries the handle, because the token locks the full config and the client setup is ignored.
 * @param {{instructions:string, voice?:string, lang?:'ko'|'en', resumable?:boolean, handle?:string}} o
 */
export function liveConfig({ instructions, voice, lang, resumable = false, handle = null }) {
  const code = lang === 'en' ? 'en' : 'ko';
  return {
    responseModalities: ['AUDIO'],
    systemInstruction: [instructions, voiceRules(code)].join('\n\n'),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice(voice) } } },
    realtimeInputConfig: {
      automaticActivityDetection: {
        // 2.5 s of silence before the turn ends, so a visitor who pauses mid-sentence is not cut off.
        silenceDurationMs: 2500,
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
      },
    },
    // Transcription stays in the default VERBATIM mode; SMART mode removes hesitations from the transcript.
    inputAudioTranscription: { languageCodes: [code] },
    outputAudioTranscription: {},
    ...(resumable ? { sessionResumption: handle ? { handle } : {} } : {}),
  };
}

/**
 * Single-use ephemeral token with the whole config locked. The client's own setup is ignored.
 * (Locking only some fields with lockAdditionalFields did not work: the API rejected the field mask
 * the SDK produced, checked 2026-09-21.)
 * @returns {Promise<string>} token.name ("auth_tokens/...")
 */
export async function mintLiveToken({ apiKey, model, config, expireMin = 30, newSessionMin = 1 }) {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  const now = Date.now();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + expireMin * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + newSessionMin * 60_000).toISOString(),
      liveConnectConstraints: { model, config },
    },
  });
  return token.name;
}
