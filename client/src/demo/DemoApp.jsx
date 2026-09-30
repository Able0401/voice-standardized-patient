import { useEffect, useRef, useState } from 'react';
import { startDemoSession } from './session';
import { MINUTES, TEXT } from './content';

// The language is read from the query string at load time: ?lang=en|ko (default en).
const LANG = new URLSearchParams(window.location.search).get('lang') === 'ko' ? 'ko' : 'en';
// Two ways to play the same patient, side by side: assessment on the left, teaching on the right.
// The right panel can start only after the left interview ends.
const PORTRAYALS = ['assessment', 'teaching'];

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// One page: the description on top, two panels below (assessment left, teaching right), switched on
// one at a time. When the right one ends (done), the checklist appears below both. The conversation lives in
// component state and is gone on reload.
export default function DemoApp() {
  const [stage, setStage] = useState('assessment'); // assessment | teaching | done
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null); // code from content.js `errors`
  const [errorDetail, setErrorDetail] = useState(null); // the server's own words, e.g. the WebSocket close reason
  const [dropped, setDropped] = useState({}); // per panel: close reason when the connection ended mid-interview
  const [speaking, setSpeaking] = useState(null);
  const [turns, setTurns] = useState({ assessment: [], teaching: [] });
  const [left, setLeft] = useState(MINUTES * 60 * 1000);
  const ctrl = useRef(null);
  const cur = useRef(null); // the panel connecting or in progress, else null
  const seq = useRef(0); // start() attempt counter, so a session that resolves after End is stopped
  const turnCount = useRef(0);
  const endAt = useRef(0);
  const logs = useRef({});
  const duoEl = useRef(null);
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
    logs.current[stage]?.scrollTo({ top: logs.current[stage].scrollHeight, behavior: 'smooth' });
  }, [turns, speaking, stage]);

  // Insert by start time; merge with the previous entry when the same speaker continues.
  const push = (a, who, text, at) => {
    turnCount.current += 1;
    setTurns((all) => {
      const next = [...all[a], { who, text, at }].sort((x, y) => x.at - y.at);
      const merged = next.reduce((out, x) => {
        const prev = out[out.length - 1];
        if (prev && prev.who === x.who) out[out.length - 1] = { ...prev, text: `${prev.text} ${x.text}` };
        else out.push(x);
        return out;
      }, []);
      return { ...all, [a]: merged };
    });
  };

  // A cut-off question was joined to its continuation: rewrite the last student entry.
  const replaceLastUser = (a, text, at) =>
    setTurns((all) => {
      const xs = all[a];
      const i = xs.map((y) => y.who).lastIndexOf('user');
      const next = i < 0 ? [...xs, { who: 'user', text, at }] : xs.map((y, j) => (j === i ? { ...y, text } : y));
      return { ...all, [a]: next };
    });

  function stopSession() {
    seq.current += 1;
    cur.current = null;
    ctrl.current?.stop();
    ctrl.current = null;
    setStatus('idle');
    setSpeaking(null);
  }

  async function start(a) {
    const my = ++seq.current;
    cur.current = a;
    setStage(a);
    setError(null);
    setErrorDetail(null);
    setDropped((d) => ({ ...d, [a]: null }));
    turnCount.current = 0;
    setTurns((all) => ({ ...all, [a]: [] }));
    setLeft(MINUTES * 60 * 1000);
    setStatus('connecting');
    const session = await startDemoSession({
      lang: LANG,
      portrayal: a,
      onStatus: (st, code, detail) => {
        if (my !== seq.current) return;
        if (st === 'error') {
          stopSession();
          setError(code);
          setErrorDetail(detail || null);
          return;
        }
        if (st === 'ended') {
          // The server closed the socket. Before any exchange that is a failed start, not a finished
          // interview: show the reason in the panel and keep it open for another try.
          if (turnCount.current === 0) {
            stopSession();
            setError('network');
            setErrorDetail(code || null);
            return;
          }
          return finish(code || null);
        }
        setStatus(st);
      },
      onUserText: (x, at, { replace = false } = {}) => (replace ? replaceLastUser(a, x, at) : push(a, 'user', x, at)),
      onAssistantText: (x, at) => push(a, 'patient', x, at),
      onSpeaking: setSpeaking,
    });
    if (my !== seq.current) session?.stop(); // the visitor pressed End (or the session ended) while connecting
    else ctrl.current = session;
  }

  // The left panel ending switches on the right one; the right one ending shows the checklist.
  function finish(reason = null) {
    const a = cur.current;
    if (!a) return;
    stopSession();
    setDropped((d) => ({ ...d, [a]: reason }));
    setStage(a === 'assessment' ? 'teaching' : 'done');
  }

  function restart() {
    stopSession();
    setError(null);
    setErrorDetail(null);
    setDropped({});
    setTurns({ assessment: [], teaching: [] });
    setStage('assessment');
    duoEl.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function pane(a) {
    const active = stage === a;
    const running = active && status !== 'idle';
    const waiting = a === 'teaching' && stage === 'assessment';
    const ended = stage === 'done' || (a === 'assessment' && stage === 'teaching');
    const note = running
      ? status === 'live'
        ? speaking === 'assistant'
          ? t.patientSpeaking
          : t.listening
        : t.connecting
      : waiting
        ? t.waiting
        : ended
          ? t.ended
          : '';
    return (
      <section key={a} className={`pane ${active ? 'pane--on' : ''} ${waiting ? 'pane--off' : ''}`} aria-disabled={waiting}>
        <div className="call-head">
          <span className={`pulse ${running && speaking === 'assistant' ? 'on' : ''}`} aria-hidden />
          <span className="pane-name">{t.portrayals[a].name}</span>
          {running && <span className={`call-timer ${left < 60000 ? 'low' : ''}`}>{fmt(left)}</span>}
        </div>
        {note && <p className="pane-status">{note}</p>}

        <div className="log" ref={(el) => (logs.current[a] = el)}>
          {turns[a].length === 0 && running && status === 'live' && <p className="faint">{t.hint}</p>}
          {turns[a].length === 0 && active && !running && <p className="faint">{a === 'assessment' ? t.readyFirst : t.ready}</p>}
          {turns[a].map((x, i) => (
            <p key={i} className={`turn turn--${x.who}`}>
              <span className="label">{x.who === 'user' ? t.you : t.patient}</span>
              {x.text}
            </p>
          ))}
        </div>

        {active && error && (
          <p className="demo-error">
            {t.errors[error] || t.errors.default}
            {errorDetail && <span className="demo-error-detail">{errorDetail}</span>}
          </p>
        )}
        {dropped[a] && (
          <p className="demo-error">
            {t.errors.network}
            <span className="demo-error-detail">{dropped[a]}</span>
          </p>
        )}
        {running && (
          <button className="btn pane-btn" onClick={() => finish()}>
            {t.end}
          </button>
        )}
        {active && !running && (
          <div className="pane-actions">
            <button className="btn btn--solid pane-btn" onClick={() => start(a)}>
              {t.start}
            </button>
            {a === 'teaching' && (
              <button className="btn pane-btn" onClick={() => setStage('done')}>
                {t.skip}
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="demo">
      <header className="demo-bar">
        <span className="brand">VOICE&nbsp;SP</span>
        <span className="demo-tag">{t.tag}</span>
      </header>

      <main>
        <section className="demo-main demo-intro">
          <h1 className="demo-title">{t.title}</h1>
          <p className="demo-lede">{t.lede}</p>
          <p className="demo-compare">{t.compare}</p>

          <section className="door">
            <div className="label">{t.doorLabel}</div>
            {t.door.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>

          <ul className="demo-notes">
            {t.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>

        <section className="demo-duo" ref={duoEl}>
          <p className="demo-order">{t.order}</p>
          <div className="duo">{PORTRAYALS.map(pane)}</div>

          {stage === 'done' && (
            <section className="duo-done">
              <h2>{t.doneTitle}</h2>
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
              <button className="btn demo-start" onClick={restart}>
                {t.again}
              </button>
            </section>
          )}
        </section>
      </main>

      <footer className="demo-foot faint">{t.footer}</footer>
    </div>
  );
}
