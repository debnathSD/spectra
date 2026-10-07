import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ChevronIcon, PageLoadIcon, RecordIcon, StopIcon } from './Icons.jsx';
import Popover from './Popover.jsx';

const URL_KEY = 'perf-profiler:url';
const SIGNIN_KEY = 'perf-profiler:sign-in';
const readSignIn = () => localStorage.getItem(SIGNIN_KEY) || '';

function Elapsed({ startedAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // Ticks the on-screen recording timer; cleared on unmount.
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="elapsed">{((now - startedAt) / 1000).toFixed(1)} s</span>
  );
}

function ProbePill({ probe }) {
  if (!probe) return null;
  if (probe.react) {
    return (
      <span
        className="pill ok"
        title="React was detected; per-component render data will be recorded."
      >
        ✓ React {probe.version}
        {probe.timings ? '' : ' · no timings (production build)'}
      </span>
    );
  }
  return (
    <span
      className="pill warn"
      title="The probe must load before React. Use Reload, or “Record page load”."
    >
      ! No React seen — reload
    </span>
  );
}

function Connect({ status, run, isCompact }) {
  const [url, setUrl] = useState(
    () => localStorage.getItem(URL_KEY) || status.defaultUrl || '',
  );
  const [headless, setHeadless] = useState(false);
  const [browserURL, setBrowserURL] = useState('http://127.0.0.1:9222');
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(readSignIn);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const go = async options => {
    if (options.url) localStorage.setItem(URL_KEY, options.url);
    localStorage.setItem(SIGNIN_KEY, signIn);
    setBusy(true);
    await run(() => api.connect(options));
    setBusy(false);
  };
  return (
    <div className="connect">
      {!isCompact && (
        <div className="connect-head">
          <h2>Connect to a browser</h2>
          <p className="muted">
            Launch a fresh Chrome window, sign in, and open the page you want to
            profile.
          </p>
        </div>
      )}
      <div className="connect-main">
        <label className="field">
          Page to profile
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://localhost:3000/"
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => go({ mode: 'launch', url, headless, signIn })}
        >
          {busy ? 'Starting Chrome…' : 'Launch Chrome'}
        </button>
        <button
          type="button"
          className="ghost"
          aria-expanded={isAdvancedOpen}
          onClick={() => setIsAdvancedOpen(open => !open)}
        >
          Advanced <ChevronIcon isUp={isAdvancedOpen} />
        </button>
      </div>
      {isAdvancedOpen && (
        <div className="advanced">
          <div className="advanced-section">
            <div className="advanced-row">
              <label
                className="field"
                title="Used automatically when the page fails to load or lands on a login screen. {url} is replaced with the page above. Do not put tokens in it."
              >
                Sign-in URL <span className="muted">(optional)</span>
                <input
                  value={signIn}
                  onChange={e => setSignIn(e.target.value)}
                  placeholder="http://localhost:3000/login/?redirect={url}"
                />
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={headless}
                  onChange={e => setHeadless(e.target.checked)}
                />
                Headless
              </label>
            </div>
            <span className="muted">
              The Chrome window starts signed out every time, so give it your
              app’s login URL once; {'{url}'} is where the page to profile goes.
            </span>
          </div>
          <div className="advanced-section">
            <div className="advanced-row">
              <label className="field">
                Attach to a running Chrome
                <input
                  value={browserURL}
                  onChange={e => setBrowserURL(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => go({ mode: 'attach', browserURL })}
              >
                Attach
              </button>
            </div>
            <span className="muted">
              Start it with <code>--remote-debugging-port=9222</code>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordingOptions({ throttle, setThrottle, saveTrace, setSaveTrace }) {
  return (
    <Popover label="Options" align="left">
      <div className="options-list">
        <label className="field">
          <span className="field-label">CPU throttling</span>
          <select
            value={throttle}
            onChange={e => setThrottle(Number(e.target.value))}
          >
            <option value={1}>No throttling</option>
            <option value={4}>4× slowdown</option>
            <option value={6}>6× slowdown</option>
          </select>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={saveTrace}
            onChange={e => setSaveTrace(e.target.checked)}
          />
          Save raw trace for DevTools
        </label>
      </div>
    </Popover>
  );
}

function RecordRow({ status, run }) {
  const [throttle, setThrottle] = useState(1);
  const [saveTrace, setSaveTrace] = useState(false);
  const { state } = status;
  const options = mode => ({ mode, cpuThrottle: throttle, saveTrace });
  if (state === 'recording')
    return (
      <div className="rec-strip recording">
        <span className="rec">
          <i /> Recording
          {status.recording?.mode === 'load' ? ' page load' : ''}{' '}
          <Elapsed startedAt={status.recording.startedAt} />
        </span>
        <span className="muted">
          {status.recording?.mode === 'load'
            ? 'Stops on its own a few seconds after the page finishes loading.'
            : 'Use the page now — click, scroll, type — then stop.'}
        </span>
        <span className="spacer" />
        <button type="button" className="danger" onClick={() => run(api.stop)}>
          <StopIcon /> Stop &amp; analyse
        </button>
      </div>
    );
  if (state === 'analyzing')
    return (
      <div className="rec-strip">
        <span className="rec">
          <i className="spin" /> Analysing trace, CPU samples and source maps…
        </span>
      </div>
    );
  return (
    <div className="rec-strip">
      <button
        type="button"
        className="primary"
        onClick={() => run(() => api.start(options('live')))}
      >
        <RecordIcon /> Record interaction
      </button>
      <button
        type="button"
        onClick={() => run(() => api.start(options('load')))}
      >
        <PageLoadIcon /> Record page load
      </button>
      <RecordingOptions
        throttle={throttle}
        setThrottle={setThrottle}
        saveTrace={saveTrace}
        setSaveTrace={setSaveTrace}
      />
      {throttle > 1 && (
        <span className="pill warn">{throttle}× CPU slowdown</span>
      )}
    </div>
  );
}

export default function ControlBar({ status, run, isCompact }) {
  const [address, setAddress] = useState('');
  useEffect(() => {
    if (status?.pageUrl) setAddress(status.pageUrl);
  }, [status?.pageUrl]);

  if (!status)
    return (
      <section className="session">
        <span className="muted">Connecting to the profiler server…</span>
      </section>
    );
  if (!status.connected)
    return (
      <section className="session">
        <Connect status={status} run={run} isCompact={isCompact} />
      </section>
    );

  const failed =
    status.navigation && status.navigation.status >= 400
      ? status.navigation
      : null;
  const idle = status.state === 'idle';
  return (
    <section className="session" aria-label="Browser session">
      {failed && (
        <div className="error" role="alert">
          <span>
            The page answered <b>HTTP {failed.status}</b> ({failed.url}). You
            are probably not signed in. Press Go to retry (the saved Sign-in URL
            is applied automatically), or sign in by hand in the Chrome window.
            If no Sign-in URL was saved, close Chrome and launch again with one.
          </span>
        </div>
      )}
      <div className="session-row">
        <select
          aria-label="Browser tab"
          value={status.pages.find(p => p.selected)?.id ?? ''}
          disabled={!idle}
          onChange={e => run(() => api.selectPage(Number(e.target.value)))}
        >
          {status.pages.map(p => (
            <option key={p.id} value={p.id}>
              {p.title || p.url}
            </option>
          ))}
        </select>
        <input
          className="address"
          aria-label="Page URL"
          value={address}
          disabled={!idle}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e =>
            e.key === 'Enter' && run(() => api.navigate(address, readSignIn()))
          }
        />
        <button
          type="button"
          disabled={!idle}
          onClick={() => run(() => api.navigate(address, readSignIn()))}
        >
          Go
        </button>
        <button type="button" disabled={!idle} onClick={() => run(api.reload)}>
          Reload
        </button>
        <ProbePill probe={status.probe} />
        <button
          type="button"
          className="ghost destructive"
          onClick={() => run(api.disconnect)}
        >
          {status.launched ? 'Close Chrome' : 'Detach'}
        </button>
      </div>
      <div className="session-row">
        <RecordRow status={status} run={run} />
      </div>
    </section>
  );
}
