// Live pipeline: one Gemini Live session listens and speaks.
// The token comes from /api/demo/session. The server chooses the case sheet and the voice and locks
// them into the token, so the browser only receives a token and never sees the instructions.
// There is no reconnect: a demo session is short and the token is single-use.

import { createTurnAssembler, openLiveAudio } from '../lib/geminiLive';

// Error codes the screen knows (content.js `errors`). `detail` carries the server's own words,
// for example the WebSocket close reason, so the visitor sees why and not just that it failed.
const classify = (err) => {
  if (err?.name === 'NotAllowedError' || err?.name === 'NotFoundError') return { code: 'mic' };
  const text = String(err?.message || err?.reason || ''); // "1011 Your prepayment credits are depleted. ..."
  if (err?.code === 'connect') {
    if (/credit|billing|RESOURCE_EXHAUSTED/i.test(text)) return { code: 'budget', detail: text };
    return { code: 'connect', detail: text };
  }
  return { code: err?.code || 'session', detail: err?.code ? undefined : text };
};

/**
 * onStatus(status, code?, detail?):
 *   'connecting' | 'live' | 'ended' (detail = close reason) | 'error' (code from content.js, detail)
 */
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
    // Called once; the demo does not reconnect. The microphone is opened before this runs, so the
    // token is used within a second of being minted.
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

    live = await openLiveAudio({
      getToken,
      onMessage: (msg) => msg.serverContent && turns.handle(msg.serverContent),
      onPlaying: (playing) => onSpeaking(playing ? 'assistant' : null),
      // The server closed the socket after the session was up (goAway, network, limit). The
      // transport has already released the microphone; clean up here so the screen does not have to.
      onClosed: (reason) => {
        if (stopped) return;
        stop();
        onStatus('ended', reason);
      },
    });
    if (stopped) {
      live.stop(); // closed while the worklet was being set up; the transport already stopped itself
      return { stop };
    }
    onStatus('live');
  } catch (err) {
    console.warn('[demo] session failed:', err);
    stop();
    const { code, detail } = classify(err);
    onStatus('error', code, detail);
  }

  return { stop };
}
