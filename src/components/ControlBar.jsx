import { frameworkName } from '../framework.js';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ChevronIcon, PageLoadIcon, RecordIcon, StopIcon } from './Icons.jsx';
import Popover from './Popover.jsx';
import SignInPanel, { methodTitle, missing, toSignIn, useSignIn } from './SignIn.jsx';

const URL_KEY = 'perf-profiler:url';

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
  // the probe names the framework it hooked: 'react', 'vue', 'angular', …
  const name = frameworkName(probe.framework || (probe.react ? 'react' : ''));
  if (probe.react || probe.detected) {
    return (
      <span
        className="pill ok"
        title={`${name || 'A component framework'} was detected; per-component render data will be recorded.`}
      >
        ✓ {name || 'Components'} {probe.version}
        {probe.react && !probe.timings ? ' · no timings (production build)' : ''}
      </span>
    );
  }
  // not a problem: any app is profiled down to its files and functions
  return (
    <span
      className="pill"
      title="Files and functions are profiled for any app. If this one uses React, Vue or Angular, the probe must load before the framework does: use Reload, or “Record page load”."
    >
      No component framework seen
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
  const [signIn, updateSignIn] = useSignIn();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const gap = missing(signIn);
  // signing in yourself needs the window
  const manual = signIn.enabled && signIn.method === 'manual';
  const go = async options => {
    if (options.url) localStorage.setItem(URL_KEY, options.url);
    setBusy(true);
    await run(() => api.connect({ ...options, signIn: toSignIn(signIn) }));
    setBusy(false);
  };
  return (
    <div className="connect">
      {!isCompact && (
        <div className="connect-head">
          <h2>Connect to a browser</h2>
          <p className="muted">
            Spectra opens a fresh Chrome window on the page you want to profile,
            signing in first when your app needs it.
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
          disabled={busy || Boolean(gap)}
          title={gap || undefined}
          onClick={() => go({ mode: 'launch', url, headless: headless && !manual })}
        >
          {busy ? (signIn.enabled ? 'Opening and signing in…' : 'Starting Chrome…') : 'Launch Chrome'}
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
      <SignInPanel value={signIn} update={updateSignIn} />
      {isAdvancedOpen && (
        <div className="advanced">
          <div className="advanced-section">
            <label
              className="switch"
              title={manual ? 'Signing in yourself needs the Chrome window.' : undefined}
            >
              <input
                type="checkbox"
                role="switch"
                checked={headless && !manual}
                disabled={manual}
                onChange={e => setHeadless(e.target.checked)}
              />
              Headless <span className="muted">(no Chrome window)</span>
            </label>
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
                disabled={busy || Boolean(gap)}
                onClick={() => go({ mode: 'attach', browserURL })}
              >
                Attach
              </button>
            </div>
            <span className="muted">
              Start it with <code>--remote-debugging-port=9222</code>. A Chrome
              you already use is usually signed in already.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SignInProgress({ method, signingIn }) {
  return (
    <div className="rec-strip">
      <span className="rec">
        <i className="spin" />{' '}
        {!signingIn
          ? 'Opening the page…'
          : method === 'manual'
            ? 'Waiting for you to sign in'
            : `Signing in (${methodTitle(method).toLowerCase()})…`}
      </span>
      {signingIn && method === 'manual' && (
        <span className="muted">
          Sign in in the Chrome window, any way your app asks: codes, passkeys,
          CAPTCHAs. Spectra carries on by itself once you are in.
        </span>
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
  const signingIn = status.state === 'signing-in';
  const opening = status.state === 'connecting';
  return (
    <section className="session" aria-label="Browser session">
      {failed && (
        <div className="error" role="alert">
          <span>
            The page answered <b>HTTP {failed.status}</b> ({failed.url}). You
            are probably not signed in.{' '}
            {status.signIn
              ? 'Press Go to sign in again, or sign in by hand in the Chrome window.'
              : 'Sign in by hand in the Chrome window, or close Chrome and launch again with “My app needs a sign-in” turned on.'}
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
            e.key === 'Enter' && run(() => api.navigate(address))
          }
        />
        <button
          type="button"
          disabled={!idle}
          onClick={() => run(() => api.navigate(address))}
        >
          Go
        </button>
        <button type="button" disabled={!idle} onClick={() => run(api.reload)}>
          Reload
        </button>
        {status.signIn?.signedIn && (
          <span
            className="pill ok"
            title={`Signed in with: ${methodTitle(status.signIn.method)}. Spectra signs in again if the session ends.`}
          >
            ✓ Signed in
          </span>
        )}
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
        {signingIn || opening ? (
          <SignInProgress method={status.signIn?.method} signingIn={signingIn} />
        ) : (
          <RecordRow status={status} run={run} />
        )}
      </div>
    </section>
  );
}
