import { useEffect, useRef, useState } from 'react';
import { startDemoSession } from './live';
import { startTtsSession } from '../lib/ttsVoice';
import { MINUTES, TEXT } from './content';

// Both the engine and the language are chosen from the query string at load time:
//   ?engine=live|tts (default live)   ?lang=en|ko (default en)
// Switching either one reloads the page, so a session never changes pipeline mid-way.
const QUERY = new URLSearchParams(window.location.search);
const ENGINE = QUERY.get('engine') === 'tts' ? 'tts' : 'live';
const LANG = QUERY.get('lang') === 'ko' ? 'ko' : 'en';

function switchEngine(engine) {
  const q = new URLSearchParams(window.location.search);
  q.set('engine', engine);
  window.location.assign(`${window.location.pathname}?${q.toString()}`);
}

// The cascade session reports 'connected' and free-form error text; the screen expects 'live' and an
// error code. This adapter maps one to the other.
const toDemoStatus = (onStatus) => (st, detail) => {
  if (st === 'connected') return onStatus('live');
  if (st !== 'error') return onStatus(st, detail);
  const d = String(detail || '');
  if (/quota|429/i.test(d)) return onStatus('error', 'quota');
  if (/NotAllowed|NotFound|permission|mic/i.test(d)) return onStatus('error', 'mic');
  return onStatus('error', 'session');
};

const startSession = ({ onStatus, ...o }) =>
  ENGINE === 'tts'
    ? startTtsSession({ ...o, onStatus: toDemoStatus(onStatus), lang: LANG })
    : startDemoSession({ ...o, onStatus, lang: LANG });

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Three phases: intro, call, done. The conversation lives in component state and is gone on reload.
export default function DemoApp() {
  const [phase, setPhase] = useState('intro');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null); // code from content.js `errors`
  const [errorDetail, setErrorDetail] = useState(null); // the server's own words, e.g. the WebSocket close reason
  const [dropped, setDropped] = useState(null); // close reason when the connection ended mid-interview
  const [speaking, setSpeaking] = useState(null);
  const [turns, setTurns] = useState([]);
  const [left, setLeft] = useState(MINUTES * 60 * 1000);
  const ctrl = useRef(null);
  const seq = useRef(0); // start() attempt counter, so a session that resolves after End is stopped
  const turnCount = useRef(0);
  const endAt = useRef(0);
  const logEl = useRef(null);
  const t = TEXT;

  useEffect(() => () => ctrl.current?.stop(), []);

  useEffect(() => {
    if (status !== 'live') return;
    endAt.current = Date.now() + MINUTES * 60 * 1000;
    const id = setInterval(() => {
      const ms = endAt.current - Date.now();
      setLeft(ms);
      if (ms <= 0) finish();
    }, 500);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    logEl.current?.scrollTo({ top: logEl.current.scrollHeight, behavior: 'smooth' });
  }, [turns, speaking]);

  // Insert by start time; merge with the previous entry when the same speaker continues.
  const push = (who, text, at) => {
    turnCount.current += 1;
    setTurns((xs) => {
      const next = [...xs, { who, text, at }].sort((a, b) => a.at - b.at);
      return next.reduce((out, x) => {
        const prev = out[out.length - 1];
        if (prev && prev.who === x.who) out[out.length - 1] = { ...prev, text: `${prev.text} ${x.text}` };
        else out.push(x);
        return out;
      }, []);
    });
  };

  async function start() {
    const my = ++seq.current;
    setError(null);
    setErrorDetail(null);
    setDropped(null);
    setTurns([]);
    turnCount.current = 0;
    setLeft(MINUTES * 60 * 1000);
    setPhase('call');
    const session = await startSession({
      onStatus: (st, code, detail) => {
        if (my !== seq.current) return;
        setStatus(st);
        if (st === 'error') {
          setError(code);
          setErrorDetail(detail || null);
          setPhase('intro');
        }
        if (st === 'ended') {
          // The server closed the socket. Before any exchange that is a failed start, not a finished
          // interview: show the reason on the intro screen instead of the checklist.
          if (turnCount.current === 0) {
            setError('network');
            setErrorDetail(code || null);
            setStatus('idle');
            setPhase('intro');
          } else {
            finish(code || null);
          }
        }
      },
      onUserText: (x, at) => push('user', x, at),
      onAssistantText: (x, at) => push('patient', x, at),
      onSpeaking: setSpeaking,
    });
    if (my !== seq.current) session.stop(); // the visitor pressed End (or the session ended) while connecting
    else ctrl.current = session;
  }

  function finish(reason = null) {
    seq.current += 1;
    ctrl.current?.stop();
    ctrl.current = null;
    setStatus('idle');
    setSpeaking(null);
    setDropped(reason);
    setPhase('done');
  }

  return (
    <div className="demo">
      <header className="demo-bar">
        <span className="brand">VOICE&nbsp;SP</span>
        <span className="demo-tag">{t.tag}</span>
      </header>

      {phase === 'intro' && (
        <main className="demo-main">
          <h1 className="demo-title">{t.title}</h1>
          <p className="demo-engine">
            {t.engines[ENGINE].caption}
            {LANG === 'ko' ? ' · 한국어' : ''}
          </p>
          <p className="demo-lede">{t.lede}</p>

          <section className="door">
            <div className="label">{t.doorLabel}</div>
            {t.door.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>

          <div className="engine-switch" role="group" aria-label={t.engineLabel}>
            <span className="label">{t.engineLabel}</span>
            {['live', 'tts'].map((e) => (
              <button
                key={e}
                type="button"
                className={`btn btn--sm ${ENGINE === e ? 'btn--solid' : ''}`}
                aria-pressed={ENGINE === e}
                onClick={() => ENGINE !== e && switchEngine(e)}
              >
                {t.engines[e].name}
              </button>
            ))}
          </div>

          {error && (
            <p className="demo-error">
              {t.errors[error] || t.errors.default}
              {errorDetail && <span className="demo-error-detail">{errorDetail}</span>}
            </p>
          )}

          <button className="btn btn--solid demo-start" onClick={start}>
            {t.start}
          </button>

          <ul className="demo-notes">
            {t.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </main>
      )}

      {phase === 'call' && (
        <main className="demo-main demo-call">
          <div className="call-head">
            <span className={`pulse ${speaking === 'assistant' ? 'on' : ''}`} aria-hidden />
            <span className="call-status">
              {status === 'live'
                ? speaking === 'assistant'
                  ? t.patientSpeaking
                  : t.listening
                : t.connecting}
            </span>
            <span className={`call-timer ${left < 60000 ? 'low' : ''}`}>{fmt(left)}</span>
          </div>

          <div className="log" ref={logEl}>
            {turns.length === 0 && status === 'live' && <p className="faint">{t.hint}</p>}
            {turns.map((x, i) => (
              <p key={i} className={`turn turn--${x.who}`}>
                <span className="label">{x.who === 'user' ? t.you : t.patient}</span>
                {x.text}
              </p>
            ))}
          </div>

          <button className="btn demo-end" onClick={() => finish()}>
            {t.end}
          </button>
        </main>
      )}

      {phase === 'done' && (
        <main className="demo-main">
          <h2>{t.doneTitle}</h2>
          {dropped && (
            <p className="demo-error">
              {t.errors.network}
              <span className="demo-error-detail">{dropped}</span>
            </p>
          )}
          <p className="demo-lede">{t.doneLede}</p>
          <ul className="check">
            {t.checklist.map((c) => (
              <li key={c}>
                <label>
                  <input type="checkbox" /> {c}
                </label>
              </li>
            ))}
          </ul>

          {turns.length > 0 && (
            <details className="demo-transcript">
              <summary className="label">{t.transcript}</summary>
              {turns.map((x, i) => (
                <p key={i} className={`turn turn--${x.who}`}>
                  <span className="label">{x.who === 'user' ? t.you : t.patient}</span>
                  {x.text}
                </p>
              ))}
            </details>
          )}

          <button className="btn btn--solid demo-start" onClick={() => setPhase('intro')}>
            {t.again}
          </button>
        </main>
      )}

      <footer className="demo-foot faint">{t.footer}</footer>
    </div>
  );
}
