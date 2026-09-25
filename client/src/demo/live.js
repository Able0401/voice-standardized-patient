// Live pipeline: one Gemini Live session listens and speaks.
// The token comes from /api/demo/session. The server chooses the case sheet and the voice and locks
// them into the token, so the browser only receives a token and never sees the instructions.
// There is no reconnect: a demo session is short and the token is single-use.

import { createTurnAssembler, openLiveAudio } from '../lib/geminiLive';

export async function startDemoSession({ lang = 'en', onStatus, onUserText, onAssistantText, onSpeaking }) {
  let live = null;
  let stopped = false;

  // The screen sorts by start time, because a visitor utterance and a patient backchannel can overlap.
  const turns = createTurnAssembler({
    onUserText,
    onAssistantText,
    onSpeaking: () => {}, // the screen only shows whether patient audio is playing
  });

  function stop() {
    if (stopped) return;
    turns.flushAll();
    stopped = true;
    live?.stop();
  }

  try {
    onStatus('connecting');
    // Called once; the demo does not reconnect.
    const getToken = async () => {
      const res = await fetch('/api/demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw Object.assign(new Error(data.error || 'session'), { code: data.error || 'session' });
      // The model name is informational; the model locked in the token wins.
      return { token: data.token, model: data.model || 'gemini-3.8-live' };
    };

    try {
      live = await openLiveAudio({
        getToken,
        onMessage: (msg) => msg.serverContent && turns.handle(msg.serverContent),
        onPlaying: (playing) => onSpeaking(playing ? 'assistant' : null),
        onClosed: () => {
          if (!stopped) onStatus('ended');
        },
      });
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'NotFoundError') throw Object.assign(new Error('mic'), { code: 'mic' });
      throw err;
    }
    onStatus('live');
  } catch (err) {
    stop();
    onStatus('error', err.code || 'session');
  }

  return { stop };
}
