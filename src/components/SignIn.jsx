// "My app needs a sign-in": how Spectra's Chrome signs in to the app before
// profiling it. Every kind of web login has a method (server/signin.js does
// the work). The page URL, the method, the login page, the username and the
// selectors are remembered in this browser; passwords, codes, tokens and
// cookies never are: they live in this tab's memory only, until it reloads.
import { useState } from 'react';
import { ChevronIcon } from './Icons.jsx';

const KEY = 'perf-profiler:sign-in-v2';
const OLD_KEY = 'perf-profiler:sign-in'; // a sign-in URL template, before 0.5

export const SIGN_IN_METHODS = [
  {
    id: 'form',
    title: 'Login form',
    hint: 'A username and password typed into your app’s login page. One step or two, any identity provider, optional authenticator codes.',
  },
  {
    id: 'manual',
    title: 'I’ll sign in myself',
    hint: 'Chrome opens on the login page and waits for you. For SMS or email codes, passkeys, push approvals or CAPTCHAs.',
  },
  {
    id: 'http',
    title: 'Browser prompt',
    hint: 'The browser’s own username and password box (HTTP Basic or Digest), common on staging servers.',
  },
  {
    id: 'token',
    title: 'Token or cookie',
    hint: 'A header, cookies or localStorage entries your app already accepts, set before it loads.',
  },
  {
    id: 'link',
    title: 'Sign-in link',
    hint: 'A URL that signs in by itself, such as a dev-only auto-login.',
  },
];
export const methodTitle = id => SIGN_IN_METHODS.find(m => m.id === id)?.title || 'Sign-in';

const PLAIN = ['enabled', 'method', 'url', 'username', 'waitMinutes', 'headerName', 'startSelector', 'usernameSelector', 'passwordSelector', 'submitSelector', 'codeSelector'];
const SECRET = ['password', 'totpSecret', 'headerValue', 'cookies', 'storage'];
const EMPTY = { enabled: false, method: 'form', url: '', username: '', waitMinutes: 5, headerName: '', startSelector: '', usernameSelector: '', passwordSelector: '', submitSelector: '', codeSelector: '' };

// secrets for this tab only: they survive closing and relaunching Chrome, not a reload
let secrets = { password: '', totpSecret: '', headerValue: '', cookies: '', storage: '' };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) return { ...EMPTY, ...saved };
    const old = localStorage.getItem(OLD_KEY);
    if (old) return { ...EMPTY, enabled: true, method: 'link', url: old };
  } catch {
    // storage blocked: start empty
  }
  return { ...EMPTY };
}
function save(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(PLAIN.map(k => [k, value[k]]))));
    localStorage.removeItem(OLD_KEY);
  } catch {
    // storage blocked: nothing is remembered
  }
}

/** What is missing before this sign-in can work, or '' when it is ready. */
export function missing(v) {
  if (!v.enabled) return '';
  if (v.method === 'form' && !v.username && !v.password) return 'Add the username and password.';
  if (v.method === 'http' && !v.username) return 'Add the username and password.';
  if (v.method === 'link' && !v.url) return 'Add the sign-in link.';
  if (v.method === 'token' && !(v.headerValue || v.cookies || v.storage)) return 'Add a header, a cookie or a storage entry.';
  return '';
}

/** The sign-in to send to the server: null when it is off. */
export function toSignIn(v) {
  if (!v.enabled) return null;
  return {
    method: v.method,
    url: v.url,
    username: v.username,
    password: v.password,
    totpSecret: v.totpSecret,
    startSelector: v.startSelector,
    usernameSelector: v.usernameSelector,
    passwordSelector: v.passwordSelector,
    submitSelector: v.submitSelector,
    codeSelector: v.codeSelector,
    headerName: v.headerName,
    headerValue: v.headerValue,
    cookies: v.cookies,
    storage: v.storage,
    waitMs: Math.max(1, Number(v.waitMinutes) || 5) * 60_000,
  };
}

/** The sign-in form's state: [value, update(patch)]. */
export function useSignIn() {
  const [value, setValue] = useState(() => ({ ...load(), ...secrets }));
  const update = patch =>
    setValue(v => {
      const next = { ...v, ...patch };
      secrets = Object.fromEntries(SECRET.map(k => [k, next[k]]));
      save(next);
      return next;
    });
  return [value, update];
}

function Text({ label, hint, value, onChange, type = 'text', placeholder, secret, wide }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`} title={hint}>
      <span>
        {label}
        {secret && (
          <span className="secret-tag" title="Kept in this tab’s memory only: never saved, logged or put in a report.">
            not saved
          </span>
        )}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        autoComplete={secret ? 'off' : undefined}
        spellCheck={false}
      />
    </label>
  );
}

function Selectors({ value, update }) {
  const [open, setOpen] = useState(Boolean(value.usernameSelector || value.passwordSelector || value.submitSelector || value.startSelector || value.codeSelector || value.totpSecret));
  const set = k => v => update({ [k]: v });
  return (
    <div className="signin-more">
      <button type="button" className="ghost small" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        One-time codes and fields <ChevronIcon isUp={open} />
      </button>
      {open && (
        <div className="signin-grid">
          <Text
            label="Authenticator secret"
            hint="For apps that ask for a 6-digit code from an authenticator app: the base32 secret behind the QR code (Spectra makes the codes, RFC 6238). Codes sent by SMS or email need “I’ll sign in myself”."
            value={value.totpSecret}
            onChange={set('totpSecret')}
            type="password"
            placeholder="JBSWY3DPEHPK3PXP"
            secret
            wide
          />
          <p className="muted wide">
            Spectra finds the fields by itself, in iframes and web components too. When it can’t, point at them with
            CSS selectors:
          </p>
          <Text label="Button that opens the form" value={value.startSelector} onChange={set('startSelector')} placeholder="#open-login" />
          <Text label="Username field" value={value.usernameSelector} onChange={set('usernameSelector')} placeholder="input[name=email]" />
          <Text label="Password field" value={value.passwordSelector} onChange={set('passwordSelector')} placeholder="input[name=password]" />
          <Text label="Submit button" value={value.submitSelector} onChange={set('submitSelector')} placeholder="button[type=submit]" />
          <Text label="Code field" value={value.codeSelector} onChange={set('codeSelector')} placeholder="input[name=otp]" />
        </div>
      )}
    </div>
  );
}

function Fields({ value, update }) {
  const set = k => v => update({ [k]: v });
  const loginPage = (
    <Text
      label="Login page (optional)"
      hint="Where to sign in. Leave it empty to sign in wherever the app sends a signed-out visitor. {url} in it becomes the page to return to."
      value={value.url}
      onChange={set('url')}
      type="url"
      placeholder="https://app.example.com/login"
      wide
    />
  );
  const user = <Text label="Username or email" value={value.username} onChange={set('username')} placeholder="me@example.com" />;
  const password = <Text label="Password" value={value.password} onChange={set('password')} type="password" secret />;
  switch (value.method) {
    case 'form':
      return (
        <>
          <div className="signin-grid">
            {loginPage}
            {user}
            {password}
          </div>
          <Selectors value={value} update={update} />
        </>
      );
    case 'manual':
      return (
        <div className="signin-grid">
          {loginPage}
          <Text label="Wait up to (minutes)" value={value.waitMinutes} onChange={set('waitMinutes')} type="number" />
        </div>
      );
    case 'http':
      return (
        <div className="signin-grid">
          {user}
          {password}
        </div>
      );
    case 'token':
      return (
        <div className="signin-grid">
          <Text label="Header name" value={value.headerName} onChange={set('headerName')} placeholder="Authorization" />
          <Text
            label="Header value"
            hint="Sent only with requests to the page’s own origin, never to third parties."
            value={value.headerValue}
            onChange={set('headerValue')}
            type="password"
            placeholder="Bearer eyJ…"
            secret
          />
          <Text label="Cookies" value={value.cookies} onChange={set('cookies')} type="password" placeholder="session=abc123; theme=dark" secret />
          <Text
            label="localStorage entries"
            value={value.storage}
            onChange={set('storage')}
            type="password"
            placeholder="auth_token=abc123"
            secret
          />
        </div>
      );
    default:
      return (
        <div className="signin-grid">
          <Text
            label="Sign-in link"
            hint="Opened when the page asks for a login. {url} becomes the page to return to. Do not put tokens in it: it is remembered."
            value={value.url}
            onChange={set('url')}
            placeholder="http://localhost:3000/dev-login?redirect={url}"
            wide
          />
        </div>
      );
  }
}

export default function SignInPanel({ value, update }) {
  const method = SIGN_IN_METHODS.find(m => m.id === value.method) || SIGN_IN_METHODS[0];
  const gap = missing(value);
  return (
    <div className={`signin${value.enabled ? ' on' : ''}`}>
      <label className="switch">
        <input type="checkbox" role="switch" checked={value.enabled} onChange={e => update({ enabled: e.target.checked })} />
        <span>
          <b>My app needs a sign-in</b>
          <span className="muted"> · Chrome starts signed out, so Spectra signs in before it profiles</span>
        </span>
      </label>
      {value.enabled && (
        <div className="signin-body">
          <div className="signin-methods" role="radiogroup" aria-label="How the app signs in">
            {SIGN_IN_METHODS.map(m => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === method.id}
                className={`signin-method${m.id === method.id ? ' selected' : ''}`}
                onClick={() => update({ method: m.id })}
              >
                {m.title}
              </button>
            ))}
          </div>
          <p className="muted signin-hint">{method.hint}</p>
          <Fields value={value} update={update} />
          <p className="signin-note">
            {gap ? <b>{gap} </b> : null}
            Passwords, codes, tokens and cookies stay in this tab’s memory and in Spectra’s: never saved to disk, logged
            or put in a report. Use a test account where you can.
          </p>
        </div>
      )}
    </div>
  );
}
