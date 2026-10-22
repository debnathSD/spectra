// Signing in: the option handling, the authenticator codes, and every kind of
// login, end to end in Chrome against fixtures/login-demo (skipped without Chrome).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import puppeteer from 'puppeteer-core';
import { normalizeSignIn, resolveSignIn, signInFromOptions, totp, validateSignInConfig, waitForManualSignIn } from './signin.js';
import { DEMO, startLoginDemo } from '../fixtures/login-demo/server.mjs';

// a throwaway Chrome profile, set before the recorder reads it: never the real one
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-signin-'));
process.env.PERF_CHROME_PROFILE_DIR = profile;
const { PerfSession } = await import('./recorder.js');
const { findChrome } = await import('./chrome.js');

test('totp makes the RFC 6238 codes', () => {
  // RFC 6238 appendix B, SHA-1: the secret is "12345678901234567890"
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 59_000, { digits: 8 }), '94287082');
  assert.equal(totp(secret, 1_111_111_109_000, { digits: 8 }), '07081804');
  assert.equal(totp(secret, 2_000_000_000_000, { digits: 8 }), '69279037');
  assert.match(totp('jbsw y3dp ehpk 3pxp'), /^\d{6}$/); // spaces and lower case are fine
});

test('normalizeSignIn guesses the method and drops what cannot work', () => {
  assert.deepEqual(normalizeSignIn('http://x/login?r={url}'), { method: 'link', url: 'http://x/login?r={url}' });
  assert.equal(normalizeSignIn(''), null);
  assert.equal(normalizeSignIn({}), null);
  assert.equal(normalizeSignIn({ username: 'a', password: 'b' }).method, 'form');
  assert.equal(normalizeSignIn({ cookies: 'a=1' }).method, 'token');
  assert.equal(normalizeSignIn({ url: 'http://x/sso' }).method, 'link');
  assert.equal(normalizeSignIn({ method: 'manual' }).method, 'manual');
  assert.equal(normalizeSignIn({ method: 'form' }), null); // nothing to type
  assert.equal(normalizeSignIn({ method: 'http', password: 'b' }), null); // a prompt needs a username
  assert.equal(normalizeSignIn({ method: 'token' }), null);
  assert.equal(normalizeSignIn({ method: 'nope', username: 'a' }).method, 'form');
  // a password is used as given; other values are trimmed
  assert.equal(normalizeSignIn({ username: ' a ', password: ' b ' }).password, ' b ');
  assert.equal(normalizeSignIn({ username: ' a ', password: ' b ' }).username, 'a');
  assert.equal(normalizeSignIn({ method: 'manual', waitMs: 1000 }).waitMs, 1000);
});

test('resolveSignIn takes flags, then the config file, then the environment; secrets only from the environment', () => {
  const env = {
    SPECTRA_LOGIN_PASSWORD: 'pw',
    SPECTRA_LOGIN_TOTP_SECRET: 'JBSW Y3DP',
    SPECTRA_LOGIN_USER: 'env-user',
  };
  const s = resolveSignIn({ loginUser: 'flag-user' }, { url: 'http://x/login', username: 'config-user' }, env);
  assert.equal(s.method, 'form');
  assert.equal(s.username, 'flag-user');
  assert.equal(s.password, 'pw');
  assert.equal(s.totpSecret, 'JBSWY3DP');
  assert.equal(s.url, 'http://x/login');
  assert.equal(resolveSignIn({}, { username: 'config-user' }, env).username, 'config-user');
  assert.equal(resolveSignIn({}, {}, env).username, 'env-user');
  // a header from the environment, scoped by the recorder
  const t = resolveSignIn({}, {}, { SPECTRA_LOGIN_HEADER: 'Authorization: Bearer abc:def' });
  assert.equal(t.method, 'token');
  assert.equal(t.headerName, 'Authorization');
  assert.equal(t.headerValue, 'Bearer abc:def');
  // nothing given: no sign-in
  assert.equal(resolveSignIn({}, {}, {}), null);
  // the old --sign-in template still works
  assert.equal(resolveSignIn({ signIn: 'http://x/login/?r={url}' }, {}, {}).method, 'link');
  // the CLI's option names
  const opts = { login: 'http', 'login-user': 'u', 'login-wait': '30' };
  const fromCli = signInFromOptions(name => opts[name], {}, { SPECTRA_LOGIN_PASSWORD: 'pw' });
  assert.equal(fromCli.method, 'http');
  assert.equal(fromCli.username, 'u');
  assert.equal(fromCli.waitMs, 30_000);
});

test('validateSignInConfig keeps secrets out of spectra.config.json', () => {
  assert.equal(validateSignInConfig(undefined), null);
  assert.deepEqual(validateSignInConfig({ method: 'form', url: 'http://x/login', username: 'me' }), {
    method: 'form',
    url: 'http://x/login',
    username: 'me',
  });
  assert.throws(() => validateSignInConfig({ password: 'x' }), /SPECTRA_LOGIN_PASSWORD/);
  assert.throws(() => validateSignInConfig({ totpSecret: 'x' }), /SPECTRA_LOGIN_TOTP_SECRET/);
  assert.throws(() => validateSignInConfig({ cookies: 'a=1' }), /SPECTRA_LOGIN_COOKIES/);
  assert.throws(() => validateSignInConfig({ headerValue: 'x' }), /SPECTRA_LOGIN_HEADER/);
  assert.throws(() => validateSignInConfig({ method: 'sso' }), /must be one of/);
  assert.throws(() => validateSignInConfig({ user: 'x' }), /unknown keys: user/);
  assert.throws(() => validateSignInConfig('http://x'), /must be an object/);
  assert.throws(() => validateSignInConfig({ waitSeconds: -1 }), /positive/);
});

const chrome = findChrome();
describe('signing in, in Chrome', { skip: !chrome && 'Chrome was not found (set CHROME_PATH)', concurrency: false }, () => {
  let demo;
  const creds = { username: DEMO.username, password: DEMO.password };

  before(async () => {
    demo = await startLoginDemo();
  });
  after(async () => {
    await demo?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  });

  // a fresh Chrome per test, signed out: what one test stored is cleared after it
  async function signIn(pagePath, how) {
    const session = new PerfSession();
    try {
      await session.connect({ mode: 'launch', url: `${demo.url}${pagePath}`, headless: true, signIn: how });
      const welcome = await session.page.$eval('#welcome', el => el.textContent).catch(() => null);
      return { welcome, url: session.page.url(), status: await session.status() };
    } finally {
      await session.client?.send('Storage.clearDataForOrigin', { origin: demo.url, storageTypes: 'all' }).catch(() => {});
      await session.client?.send('Network.clearBrowserCookies').catch(() => {});
      await session.disconnect();
    }
  }
  const signedIn = r => {
    assert.equal(r.welcome, 'Welcome, signed in', `still not signed in, on ${r.url}`);
  };

  test('a classic login form, found where the app redirects to', async () => {
    const r = await signIn('/app', creds);
    signedIn(r);
    assert.deepEqual(r.status.signIn, { method: 'form', signedIn: true });
    assert.equal(JSON.stringify(r.status).includes(DEMO.password), false, 'the status never carries the password');
  });
  test('two steps: the username, Next, then the password', async () => signedIn(await signIn('/app', { ...creds, url: `${demo.url}/two-step` })));
  test('a page that swallows the first click: Enter sends the form', async () => signedIn(await signIn('/app', { ...creds, url: `${demo.url}/busy` })));
  test('a single-page app whose form renders late', async () => signedIn(await signIn('/app', { ...creds, url: `${demo.url}/spa` })));
  test('a login form inside an iframe', async () => signedIn(await signIn('/app', { ...creds, url: `${demo.url}/iframe` })));
  test("a login form inside a web component's shadow DOM", async () => signedIn(await signIn('/app', { ...creds, url: `${demo.url}/shadow` })));
  test('a login behind a "Sign in" button that opens a modal', async () => signedIn(await signIn('/app', { ...creds, url: `${demo.url}/modal` })));
  test('a password, then an authenticator code', async () =>
    signedIn(await signIn('/app', { ...creds, totpSecret: DEMO.totpSecret, url: `${demo.url}/otp` })));
  test('a password, then six one-digit code boxes', async () =>
    signedIn(await signIn('/app', { ...creds, totpSecret: DEMO.totpSecret, url: `${demo.url}/otp-boxes` })));
  test('an authenticator code without the secret says what is missing', async () =>
    assert.rejects(signIn('/app', { ...creds, url: `${demo.url}/otp` }), /one-time code.*TOTP/));
  test('the browser login prompt (HTTP Basic)', async () => signedIn(await signIn('/basic', { method: 'http', ...creds })));
  test('a token header, sent to the app', async () =>
    signedIn(await signIn('/header-app', { method: 'token', headerName: 'X-Demo-Token', headerValue: DEMO.token })));
  test('a cookie', async () => signedIn(await signIn('/cookie-app', { method: 'token', cookies: `demo_token=${DEMO.token}` })));
  test('a localStorage entry, there before the app loads', async () =>
    signedIn(await signIn('/storage-app', { method: 'token', storage: `demo_token=${DEMO.token}` })));
  test('a sign-in link', async () => signedIn(await signIn('/app', `${demo.url}/magic?next={url}`)));
  test('a wrong password fails fast, and the error never contains it', async () => {
    const started = Date.now();
    await assert.rejects(signIn('/app', { username: DEMO.username, password: 'not-the-password' }), err => {
      assert.match(err.message, /did not accept/);
      assert.equal(err.message.includes('not-the-password'), false);
      return true;
    });
    assert.ok(Date.now() - started < 20_000, 'no need to wait for the timeout');
  });
  test('a CAPTCHA is refused before anything is sent', async () =>
    assert.rejects(signIn('/app', { ...creds, url: `${demo.url}/captcha` }), /CAPTCHA.*Sign in myself/));
  test('signing in yourself needs a visible window', async () =>
    assert.rejects(signIn('/app', { method: 'manual' }), /visible Chrome window/));

  test('waiting for a person to sign in', async () => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: fs.mkdtempSync(path.join(profile, 'm-')) });
    try {
      const page = await browser.newPage();
      await page.goto(`${demo.url}/login?next=/app`);
      const waiting = waitForManualSignIn(page, { timeoutMs: 20_000 });
      // the "person": types the details in a moment
      setTimeout(async () => {
        await page.type('input[type=email]', DEMO.username);
        await page.type('input[type=password]', DEMO.password);
        await page.click('button[type=submit]');
      }, 1500);
      await waiting;
      assert.equal(await page.$eval('#welcome', el => el.textContent), 'Welcome, signed in');
    } finally {
      await browser.close();
    }
  });
});
