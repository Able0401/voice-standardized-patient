// Ephemeral token minting for the transcription session.
//
// The browser streams microphone audio straight to a transcription-only Gemini Live session. The server
// mints a token with the API key and locks the session config into it, so the client cannot change
// the model or turn the session into anything but transcription.

import { GoogleGenAI } from '@google/genai';

// Prebuilt Gemini voice name. The case sheet names the voice directly.
export const geminiVoice = (voice) => voice || 'Kore';

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
