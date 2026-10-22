/**
 * Signing in before profiling. Most production frontends sit behind a login,
 * and Spectra's Chrome starts signed out. Every kind of web login is covered:
 *
 *   form    a username and password typed into the app's own login form: one
 *           step or two (username, Next, password), in the page, an iframe or
 *           a web component, behind a "Sign in" button, on the app or on an
 *           identity provider it redirects to (OAuth, OpenID Connect, SAML),
 *           optionally with an authenticator-app code (TOTP)
 *   link    a sign-in URL template, e.g. a dev-only `/login/?redirect={url}`
 *   http    the browser's own login prompt (HTTP Basic or Digest)
 *   token   a header (only on the app's own origin), cookies, or localStorage
 *           entries set before the app loads
 *   manual  you sign in yourself in Spectra's Chrome window (SMS or email
 *           codes, push approvals, passkeys, CAPTCHAs) and Spectra waits
 *
 * Secrets (the password, the TOTP secret, header values, cookies, storage
 * entries) come from the dashboard or the environment, never from a file. They
 * stay in memory: they are never written to disk, a report, a log or an error
 * message, and signing in happens before recording starts, so it never appears
 * in a trace. Spectra does not solve CAPTCHAs: that is what `manual` is for.
 */
import crypto from 'node:crypto';

export const METHODS = ['form', 'link', 'http', 'token', 'manual'];
export const ENV = {
  user: 'SPECTRA_LOGIN_USER',
  password: 'SPECTRA_LOGIN_PASSWORD',
  totp: 'SPECTRA_LOGIN_TOTP_SECRET',
  header: 'SPECTRA_LOGIN_HEADER', // "Name: value"
  cookies: 'SPECTRA_LOGIN_COOKIES', // "name=value; name2=value2"
  storage: 'SPECTRA_LOGIN_STORAGE', // "key=value; key2=value2" (localStorage)
};
export const USER_ENV = ENV.user;
export const PASSWORD_ENV = ENV.password;

/**
 * Builds the URL that signs in and then lands on `pageUrl`.
 *
 * `template` is the app's login URL with a `{url}` placeholder for the page to
 * return to, e.g. `http://localhost:3000/login/?redirect={url}`.
 * `{url}` becomes the URL-encoded path + query of the page (relative, which is
 * what login redirects usually accept). The template must not contain secrets:
 * it is remembered in the browser's localStorage.
 */
export function buildSignInUrl(template, pageUrl) {
  if (!template) return null;
  const u = new URL(pageUrl);
  const relative = `${u.pathname}${u.search}${u.hash}`;
  return template.includes('{url}')
    ? template.replaceAll('{url}', encodeURIComponent(relative))
    : template;
}

/** True when the document we ended up on is a failed load or a login screen. */
export function looksSignedOut(navigation, finalUrl) {
  if (navigation && navigation.status >= 400) return true;
  try {
    return /^\/(?:login|log-in|signin|sign-in|auth)\b/i.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}

const text = v => (typeof v === 'string' ? v.trim() : '');
const secret = v => (typeof v === 'string' ? v : ''); // used exactly as given: spaces can matter

/**
 * A sign-in in one shape. A string is a sign-in URL template (the original
 * form); an object names its `method`, or the method is inferred from what it
 * holds. Null when there is nothing to sign in with.
 */
export function normalizeSignIn(value) {
  if (!value) return null;
  if (typeof value === 'string') return text(value) ? { method: 'link', url: text(value) } : null;
  const s = {
    method: METHODS.includes(value.method) ? value.method : '',
    url: text(value.url),
    username: text(value.username),
    password: secret(value.password),
    totpSecret: text(value.totpSecret).replace(/\s+/g, ''),
    startSelector: text(value.startSelector),
    usernameSelector: text(value.usernameSelector),
    passwordSelector: text(value.passwordSelector),
    submitSelector: text(value.submitSelector),
    codeSelector: text(value.codeSelector),
    headerName: text(value.headerName),
    headerValue: secret(value.headerValue).trim(),
    cookies: secret(value.cookies).trim(),
    storage: secret(value.storage).trim(),
    waitMs: Number(value.waitMs) > 0 ? Number(value.waitMs) : 5 * 60_000,
  };
  if (!s.method)
    s.method = s.username || s.password ? 'form' : s.headerValue || s.cookies || s.storage ? 'token' : s.url ? 'link' : '';
  if (!s.method) return null;
  if (s.method === 'link' && !s.url) return null;
  if (s.method === 'form' && !s.username && !s.password) return null;
  if (s.method === 'http' && !s.username) return null;
  if (s.method === 'token' && !(s.headerValue || s.cookies || s.storage)) return null;
  return s;
}

/** True when the sign-in fills in a form rather than only visiting a URL. */
export const hasCredentials = s => Boolean(s && s.method === 'form' && (s.username || s.password));

/** "Name: value" as [name, value]. */
export const parseHeader = line => {
  const i = (line || '').indexOf(':');
  return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : null;
};
/** "a=1; b=2" as [['a', '1'], ['b', '2']]. */
export const parsePairs = list =>
  (list || '')
    .split(/;\s*|\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const i = p.indexOf('=');
      return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : null;
    })
    .filter(Boolean);

/**
 * The sign-in for a CLI run: command-line options first, then the project's
 * spectra.config.json `signIn`, then the environment. Secrets only ever come
 * from the environment, so they never sit in a file or in the process list.
 */
export function resolveSignIn(flags = {}, config = {}, env = process.env) {
  const header = parseHeader(env[ENV.header]);
  return normalizeSignIn({
    method: flags.method || config.method,
    url: flags.loginUrl || flags.signIn || config.url,
    username: flags.loginUser || config.username || env[ENV.user],
    password: env[ENV.password] || '',
    totpSecret: env[ENV.totp] || '',
    startSelector: flags.startSelector || config.startSelector,
    usernameSelector: flags.usernameSelector || config.usernameSelector,
    passwordSelector: flags.passwordSelector || config.passwordSelector,
    submitSelector: flags.submitSelector || config.submitSelector,
    codeSelector: flags.codeSelector || config.codeSelector,
    headerName: header?.[0] || '',
    headerValue: header?.[1] || '',
    cookies: env[ENV.cookies] || '',
    storage: env[ENV.storage] || '',
    waitMs: (Number(flags.waitSeconds || config.waitSeconds) || 0) * 1000,
  });
}

/**
 * The sign-in options every command shares, read with args.js's `opt`. The
 * secrets are not among them: they only come from the environment.
 */
export const signInFromOptions = (opt, config = {}, env = process.env) =>
  resolveSignIn(
    {
      method: opt('login'),
      loginUrl: opt('login-url'),
      signIn: opt('sign-in'),
      loginUser: opt('login-user'),
      startSelector: opt('login-start'),
      usernameSelector: opt('login-user-field'),
      passwordSelector: opt('login-password-field'),
      submitSelector: opt('login-submit'),
      codeSelector: opt('login-code-field'),
      waitSeconds: opt('login-wait'),
    },
    config || {},
    env,
  );

/** Progress for the command line: what a session is doing to sign in. */
export function logSignIn(session, log = console.error) {
  session.on('state', s => {
    if (s.state !== 'signing-in') return;
    log(
      s.method === 'manual'
        ? `spectra: sign in in the Chrome window (any way the app asks); Spectra carries on once you are in …`
        : 'spectra: signing in through the login form …',
    );
  });
}

/** What `spectra … --help` says about signing in. */
export const SIGN_IN_HELP = `Signing in (when the app is behind a login):
  --login <method>      form, link, http, token or manual (guessed when left out)
  --login-url <url>     The login page, e.g. https://app.example.com/login
                        ({url} in it becomes the page to return to)
  --login-user <name>   The username or email (or ${ENV.user})
  --login-wait <s>      How long to wait for a manual sign-in (default 300)
  --login-start, --login-user-field, --login-password-field, --login-submit,
  --login-code-field <css>   Point at the controls when Spectra can't find them
  Secrets only come from the environment, never from a flag or a file:
${[
  [ENV.password, 'the password (form, http)'],
  [ENV.totp, 'the authenticator-app secret, for one-time codes'],
  [ENV.header, '"Name: value", sent only to the app\'s own origin'],
  [ENV.cookies, '"name=value; name2=value2"'],
  [ENV.storage, 'localStorage entries, "key=value; key2=value2"'],
]
  .map(([name, what]) => `    ${name.padEnd(27)}${what}`)
  .join('\n')}`;

const CONFIG_KEYS = ['method', 'url', 'username', 'startSelector', 'usernameSelector', 'passwordSelector', 'submitSelector', 'codeSelector', 'waitSeconds'];
const SECRET_KEYS = { password: ENV.password, totpSecret: ENV.totp, headerValue: ENV.header, header: ENV.header, cookies: ENV.cookies, storage: ENV.storage };

/** Checks spectra.config.json's `signIn`; returns it, or throws a readable Error. */
export function validateSignInConfig(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('"signIn" must be an object, e.g. { "method": "form", "url": "https://app.example.com/login", "username": "me@example.com" }.');
  for (const [k, envName] of Object.entries(SECRET_KEYS))
    if (k in raw) throw new Error(`"signIn" must not hold "${k}": set the ${envName} environment variable instead, so the secret never sits in a file.`);
  const unknown = Object.keys(raw).filter(k => !CONFIG_KEYS.includes(k));
  if (unknown.length) throw new Error(`"signIn" has unknown keys: ${unknown.join(', ')} (allowed: ${CONFIG_KEYS.join(', ')}).`);
  if (raw.method != null && !METHODS.includes(raw.method)) throw new Error(`"signIn.method" must be one of ${METHODS.join(', ')}.`);
  for (const k of CONFIG_KEYS.filter(k => k !== 'waitSeconds'))
    if (raw[k] != null && typeof raw[k] !== 'string') throw new Error(`"signIn.${k}" must be a string.`);
  if (raw.waitSeconds != null && !(Number(raw.waitSeconds) > 0)) throw new Error('"signIn.waitSeconds" must be a positive number.');
  return raw;
}

// ---------------------------------------------------------------- TOTP

function base32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of value.toUpperCase().replace(/=+$/, '')) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('The authenticator secret is not valid base32 (letters A–Z and digits 2–7).');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The current authenticator-app code (RFC 6238: HMAC-SHA1, 30 s, 6 digits) for a base32 secret. */
export function totp(secretBase32, now = Date.now(), { step = 30, digits = 6 } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / step)));
  const h = crypto.createHmac('sha1', base32(secretBase32.replace(/\s+/g, ''))).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

// ---------------------------------------------------------------- in the page

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Runs in the page: every element, including those inside open shadow roots
// (web components), and whether an element can be seen and used.
const HELPERS = `
  const deep = root => {
    const out = [];
    const walk = node => {
      for (const el of node.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  };
  const visible = el => {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const describe = i => [i.name, i.id, i.placeholder, i.getAttribute('aria-label'), i.autocomplete, i.labels && [...i.labels].map(l => l.textContent).join(' ')].join(' ').toLowerCase();
  const label = el => (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
  const CODE = /one-?time|\\botp\\b|verification|2fa|\\bmfa\\b|totp|authenticator|security code|passcode/;
`;

// Every frame of the page: the login form may sit in an iframe.
const framesOf = page => [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];

/** True when the page (any frame) shows a password field: a login screen, whatever its URL. */
export async function hasLoginForm(page) {
  for (const frame of framesOf(page)) {
    try {
      if (await frame.evaluate(`(() => { ${HELPERS} return deep(document).some(el => el.tagName === 'INPUT' && el.type === 'password' && visible(el)); })()`))
        return true;
    } catch {}
  }
  return false;
}

// What a login form is made of, found in one frame: element handles, each may be null.
async function controlsIn(frame, s) {
  const handle = await frame.evaluateHandle(
    `(() => {
      ${HELPERS}
      const all = deep(document);
      const inputs = all.filter(el => el.tagName === 'INPUT' && visible(el));
      const password = inputs.find(i => i.type === 'password') || null;
      // a one-time-code step: a field that says so, or a row of one-digit boxes
      const digitBoxes = inputs.filter(i => i.maxLength === 1 && /numeric|tel|number/.test(i.inputMode + ' ' + i.type));
      const codeBoxes = digitBoxes.length >= 4 ? digitBoxes : inputs.filter(i => i !== password && i.type !== 'hidden' && (i.autocomplete === 'one-time-code' || CODE.test(describe(i))));
      const score = i => {
        if (['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'search'].includes(i.type) || codeBoxes.includes(i)) return -1;
        let s = 0;
        if (/username|email/.test(i.autocomplete || '')) s += 6;
        if (i.type === 'email') s += 4;
        if (/user|e-?mail|login|account|phone|mobile|\\bid\\b/.test(describe(i))) s += 3;
        if (['text', 'tel', ''].includes(i.type)) s += 1;
        if (password && i.form === password.form && i.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) s += 2;
        return s;
      };
      const ranked = inputs.map(i => [score(i), i]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
      const username = ranked.length ? ranked[0][1] : null;
      const field = password || username || codeBoxes[0];
      const scope = field ? field.form || field.getRootNode() : document;
      const buttons = deep(scope === document ? document : scope).filter(el => /^(BUTTON|INPUT)$/.test(el.tagName) ? ['submit', 'button', ''].includes(el.type) || el.tagName === 'BUTTON' : el.getAttribute('role') === 'button').filter(visible);
      // in a <form>, its submit button; elsewhere only a button that says what it does
      const inForm = Boolean(field && field.form);
      const submit =
        (inForm && buttons.find(b => b.type === 'submit')) ||
        buttons.find(b => /^(sign|log)\\s*-?\\s*in$|^login$|^continue$|^next$|^submit$|^verify$/i.test(label(b))) ||
        buttons.find(b => /sign\\s*-?\\s*in|log\\s*-?\\s*in|continue|next|verify/i.test(label(b))) ||
        null;
      // a link or button that opens the login (a modal, or the identity provider)
      const opener = all.filter(el => /^(A|BUTTON)$/.test(el.tagName) || el.getAttribute('role') === 'button').filter(visible).find(el => /^(sign\\s*-?\\s*in|log\\s*-?\\s*in|login)$/i.test(label(el))) || null;
      const captcha = all.some(el => (el.tagName === 'IFRAME' && /recaptcha|hcaptcha|turnstile|challenges\\.cloudflare|arkoselabs|funcaptcha/i.test(el.src)) || el.matches('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]'));
      // a challenge a person must answer (an invisible reCAPTCHA needs nothing from anyone)
      const captchaShown = all.some(el => visible(el) && !/size=invisible/.test(el.src || '') && el.getAttribute('data-size') !== 'invisible' &&
        ((el.tagName === 'IFRAME' && /recaptcha\\/api2\\/anchor|recaptcha\\/enterprise\\/anchor|hcaptcha|challenges\\.cloudflare|arkoselabs|funcaptcha/i.test(el.src)) || el.matches('.g-recaptcha, .h-captcha, .cf-turnstile')));
      return { username, password, submit, code: codeBoxes[0] || null, codeBoxes: codeBoxes.length, opener, captcha, captchaShown };
    })()`,
  );
  const get = async key => {
    const p = await handle.getProperty(key);
    const el = p.asElement();
    if (!el) {
      const v = await p.jsonValue().catch(() => null);
      await p.dispose();
      return v;
    }
    return el;
  };
  const pick = async (key, selector) => (selector ? frame.$(selector).catch(() => null) : get(key));
  const c = {
    frame,
    username: await pick('username', s.usernameSelector),
    password: await pick('password', s.passwordSelector),
    submit: await pick('submit', s.submitSelector),
    code: await pick('code', s.codeSelector),
    codeBoxes: await get('codeBoxes'),
    opener: await get('opener'),
    captcha: await get('captcha'),
    captchaShown: await get('captchaShown'),
  };
  await handle.dispose();
  return c;
}

// The frame that holds the login form, or the main frame's findings when none does.
async function findControls(page, s) {
  let first = null;
  for (const frame of framesOf(page)) {
    let c;
    try {
      c = await controlsIn(frame, s);
    } catch {
      continue; // a frame that is navigating or gone
    }
    first ??= c;
    if (c.password || c.username || c.code) return c;
  }
  return first || { username: null, password: null, submit: null, code: null, opener: null, captcha: false };
}

// Replace a field's value the way a person would, so framework-controlled inputs see it.
async function fill(page, field, value) {
  await field.click({ count: 3 });
  await field.evaluate(el => {
    try {
      el.select();
    } catch {}
  });
  await page.keyboard.press('Backspace');
  await field.type(value, { delay: 12 });
}

// Whether any frame says the details were wrong. Compared before and after
// submitting, so text that was already on the page never counts.
const REJECTED = /\b(wrong|invalid|incorrect|not recogni[sz]ed|doesn.t match|does not match|couldn.t sign you in|could not sign you in|unable to (?:sign|log) (?:you )?in|failed to (?:sign|log) in)\b/i;
async function saysRejected(page) {
  for (const frame of framesOf(page)) {
    try {
      if (await frame.evaluate(`(() => ${REJECTED}.test(document.body ? document.body.innerText : ''))()`)) return true;
    } catch {}
  }
  return false;
}

async function submit(page, c, lastField) {
  if (c.submit) await c.submit.click().catch(() => lastField?.press('Enter'));
  else await lastField?.press('Enter');
}

// Polls until `check()` is true or the time runs out. A page that is navigating
// throws "execution context was destroyed": that just means "ask again".
async function waitUntil(check, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await check()) return true;
    } catch {}
    await sleep(stepMs);
  }
  return false;
}

const where = page => {
  try {
    const u = new URL(page.url());
    return `${u.origin}${u.pathname}`;
  } catch {
    return page.url();
  }
};
const captchaError = page =>
  new Error(`The login on ${where(page)} shows a CAPTCHA, which Spectra does not solve. Choose "Sign in myself" and sign in in Spectra's Chrome window.`);

/**
 * Signs in through a login form on `page`: opens `signIn.url` (if given),
 * clicks the "click first" control or a plain "Sign in" button when no form is
 * showing, types the username and password (a two-step form gets the
 * username, then Next, then the password), answers an authenticator-code step
 * when a TOTP secret is given, and waits until the login form is gone. Works
 * in iframes and web components, and on identity providers the app redirects
 * to. Throws a readable Error that never contains a secret.
 */
export async function signInWithForm(page, signIn, { timeoutMs = 30_000 } = {}) {
  const s = normalizeSignIn(signIn);
  if (!hasCredentials(s)) throw new Error('No username or password to sign in with.');
  if (s.url) await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (s.startSelector) {
    // e.g. "Sign in with Okta", or the button that opens a login modal
    const start = await waitUntil(async () => Boolean(await page.$(s.startSelector)), 15_000);
    if (!start) throw new Error(`The "click first" control (${s.startSelector}) was not found on ${where(page)}.`);
    await page.click(s.startSelector);
  }

  let c = null;
  let clickedOpener = Boolean(s.startSelector);
  const ready = await waitUntil(async () => {
    c = await findControls(page, s);
    if (c.password || c.username) return true;
    // no form yet: a plain "Sign in" button may open it (a modal, or the provider)
    if (!clickedOpener && c.opener) {
      clickedOpener = true;
      await c.opener.click().catch(() => {});
    }
    return false;
  }, 20_000);
  if (!ready) {
    if (c?.captcha) throw captchaError(page);
    throw new Error(`No login form was found on ${where(page)}. Check the login page URL, or give the field selectors.`);
  }
  // a challenge for a person: don't even send the details
  if (c.captchaShown) throw captchaError(page);
  const rejectedBefore = await saysRejected(page);

  if (s.username && c.username) await fill(page, c.username, s.username);
  if (!c.password && s.password) {
    // two steps: the username first, then the password on the next screen
    await submit(page, c, c.username);
    const next = await waitUntil(async () => {
      c = await findControls(page, s);
      return Boolean(c.password);
    }, 20_000);
    if (!next) {
      if (c.captcha) throw captchaError(page);
      if (!rejectedBefore && (await saysRejected(page)))
        throw new Error(`The login on ${where(page)} did not accept the username. Check it.`);
      throw new Error(`After the username, no password field appeared on ${where(page)}. If this login uses a one-time code sent by SMS or email, or a passkey, choose "Sign in myself".`);
    }
  }
  if (s.password && c.password) await fill(page, c.password, s.password);
  await submit(page, c, c.password || c.username);

  // the form leaves, or asks for an authenticator code first
  const end = Date.now() + timeoutMs;
  const submittedAt = Date.now();
  let answeredCode = false;
  while (Date.now() < end) {
    // the app answered "wrong password": no need to wait out the timeout
    if (Date.now() - submittedAt > 1000 && !rejectedBefore && (await hasLoginForm(page)) && (await saysRejected(page)))
      throw new Error(`The login on ${where(page)} did not accept the username and password. Check them.`);
    if (!(await hasLoginForm(page))) {
      const after = await findControls(page, s).catch(() => null);
      if (after?.code && !answeredCode) {
        if (!s.totpSecret) {
          // only a login step: an app page can have a "verification" field of its own
          if (/login|sign-?in|auth|mfa|2fa|verify|otp|challenge/i.test(page.url()))
            throw new Error(`The login on ${where(page)} asks for a one-time code. Give the authenticator (TOTP) secret, or choose "Sign in myself".`);
          break;
        }
        const code = totp(s.totpSecret);
        if (after.codeBoxes > 1) {
          // one box per digit: typing into the first usually moves along; fill each to be sure
          await after.code.click();
          for (const digit of code) await page.keyboard.type(digit, { delay: 30 });
        } else await fill(page, after.code, code);
        answeredCode = true;
        await submit(page, after, after.code);
        await sleep(800);
        continue;
      }
      if (!after?.code) break;
    }
    await sleep(300);
  }
  if (await hasLoginForm(page)) {
    const now = await findControls(page, s).catch(() => null);
    if (now?.captcha) throw captchaError(page);
    throw new Error(`Spectra filled in the login form on ${where(page)}, but it is still showing after ${Math.round(timeoutMs / 1000)} s. Check the username and password, or give the field selectors.`);
  }
  // let the app finish what follows a login (redirects, first data loads)
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 8_000 }).catch(() => {});
  return { url: page.url() };
}

/**
 * Waits while a person signs in in the visible Chrome window: until the page
 * no longer shows a login form or a login URL. Used for logins Spectra must
 * not automate: SMS or email codes, push approvals, passkeys, CAPTCHAs.
 */
export async function waitForManualSignIn(page, { loginUrl = '', timeoutMs = 5 * 60_000, onWaiting } = {}) {
  onWaiting?.();
  const loginPath = (() => {
    try {
      return loginUrl ? new URL(loginUrl).origin + new URL(loginUrl).pathname : '';
    } catch {
      return '';
    }
  })();
  const done = await waitUntil(async () => {
    if (await hasLoginForm(page)) return false;
    const now = where(page);
    if (loginPath && now === loginPath) return false;
    return !looksSignedOut(null, page.url());
  }, timeoutMs, 1000);
  if (!done) throw new Error(`Waited ${Math.round(timeoutMs / 60_000)} min for you to sign in in Spectra's Chrome window, but the login is still showing.`);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 }).catch(() => {});
  return { url: page.url() };
}
