// A test app with every kind of login, in front of one protected page, for
// Spectra's sign-in tests (server/test-signin.js). No dependencies.
//
//   node fixtures/login-demo/server.mjs    then open http://localhost:5191/
//
// The credentials are test values for this fixture only (see README.md).
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const DEMO = {
  username: 'demo@spectra.test',
  password: 'spectra-demo-pass',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  token: 'spectra-demo-token',
};

// RFC 6238, written separately from Spectra's own, so the test checks one against the other
function totpAt(secret, step) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const codeOk = code => [-1, 0, 1].some(d => totpAt(DEMO.totpSecret, Math.floor(Date.now() / 30000) + d) === code);

const STYLE = `
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.4 system-ui, sans-serif; color: #1d2433; background: linear-gradient(160deg, #eef2fb, #f8f4fd); }
  main { min-width: 340px; padding: 34px 36px; border-radius: 18px; background: #fff; box-shadow: 0 24px 60px rgba(30, 40, 90, 0.14); }
  h1 { margin: 0 0 20px; font-size: 24px; letter-spacing: -0.01em; }
  form, .box { display: grid; gap: 12px; }
  label { display: grid; gap: 6px; font-size: 14px; color: #4a5470; }
  input { padding: 11px 12px; border: 1px solid #cfd6e6; border-radius: 9px; font: inherit; }
  button { padding: 11px 16px; border: 0; border-radius: 9px; background: #3b5bfd; color: #fff; font: 600 15px system-ui, sans-serif; cursor: pointer; }
  .brand { margin-bottom: 18px; font: 700 14px system-ui; letter-spacing: 0.12em; text-transform: uppercase; color: #3b5bfd; }
  .error { color: #c62842; }
  .modal { display: none; margin-top: 16px; } .modal.open { display: block; }
  .g-recaptcha { width: 300px; height: 76px; border-radius: 6px; background: #eef0f4; }
  iframe { border: 0; }
  input[maxlength="1"] { width: 2.4em; text-align: center; }
`;
const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${STYLE}</style></head><body><main><div class="brand">Acme Store</div>${body}</main></body></html>`;
const WELCOME = page('Dashboard', '<h1 id="welcome">Welcome, signed in</h1><p>The protected page.</p>');
const formHtml = (action, extra = '') =>
  `<form method="post" action="${action}"><label>Email <input type="email" name="email" autocomplete="username"></label><label>Password <input type="password" name="password" autocomplete="current-password"></label>${extra}<button type="submit">Sign in</button></form>`;

export function createLoginDemo() {
  const sessions = new Set();
  const pending = new Set(); // signed in with a password, waiting for the code

  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(c => c.split('=').map(decodeURIComponent)));
  const body = req =>
    new Promise(resolve => {
      let raw = '';
      req.on('data', c => (raw += c));
      req.on('end', () => resolve(req.headers['content-type']?.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw))));
    });
  const send = (res, status, html, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(html);
  };
  const redirect = (res, to, headers = {}) => send(res, 302, '', { location: to, ...headers });
  const startSession = () => {
    const id = crypto.randomBytes(12).toString('hex');
    sessions.add(id);
    return `sid=${id}; Path=/; HttpOnly`;
  };
  const signedIn = req => sessions.has(cookies(req).sid);
  const credsOk = b => (b.email || b.username) === DEMO.username && b.password === DEMO.password;
  const next = url => new URL(url, 'http://x').searchParams.get('next') || '/app';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    // the protected page
    if (p === '/app') return signedIn(req) ? send(res, 200, WELCOME) : redirect(res, `/login?next=${encodeURIComponent('/app')}`);
    if (p === '/') return send(res, 200, page('Login demo', '<h1>Login demo</h1><p><a href="/app">Protected page</a></p>'));

    // 1. a classic form
    if (p === '/login' && req.method === 'GET') return send(res, 200, page('Sign in', `<h1>Sign in</h1>${formHtml(`/login?next=${encodeURIComponent(next(req.url))}`)}`));
    if (p === '/login' && req.method === 'POST') {
      const b = await body(req);
      if (credsOk(b)) return redirect(res, next(req.url), { 'set-cookie': startSession() });
      return send(res, 401, page('Sign in', `<h1>Sign in</h1><p class="error">Wrong email or password.</p>${formHtml(req.url)}`));
    }

    // 2. two steps: the username, then the password
    if (p === '/two-step' && req.method === 'GET')
      return send(res, 200, page('Sign in', '<h1>Sign in</h1><form method="post" action="/two-step/id"><label>Email or phone <input type="text" name="identifier" autocomplete="username"></label><button type="submit">Next</button></form>'));
    if (p === '/two-step/id') {
      const b = await body(req);
      return send(res, 200, page('Sign in', `<h1>Welcome ${b.identifier}</h1><form method="post" action="/two-step/password"><input type="hidden" name="email" value="${b.identifier}"><label>Password <input type="password" name="password"></label><button type="submit">Sign in</button></form>`));
    }
    if (p === '/two-step/password') {
      const b = await body(req);
      return credsOk(b) ? redirect(res, '/app', { 'set-cookie': startSession() }) : send(res, 401, page('Sign in', '<p>Wrong password.</p><a href="/two-step">Try again</a>'));
    }

    // 3. a single-page app: the form appears late and its fields only change through input events
    if (p === '/spa')
      return send(res, 200, page('App', `<div id="root">Loading…</div><script>
        setTimeout(() => {
          const state = { email: '', password: '' };
          document.getElementById('root').innerHTML = '<div class="box"><h1>Sign in</h1><input id="e" placeholder="Email address"><input id="p" type="password" placeholder="Password"><button id="go">Log in</button><p id="msg"></p></div>';
          e.addEventListener('input', ev => (state.email = ev.target.value));
          p.addEventListener('input', ev => (state.password = ev.target.value));
          go.addEventListener('click', async () => {
            const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
            if (r.ok) location.href = '/app'; else msg.textContent = 'Wrong email or password';
          });
        }, 400);
      </script>`));
    if (p === '/api/login') {
      const b = await body(req);
      return credsOk(b) ? send(res, 200, '{}', { 'set-cookie': startSession(), 'content-type': 'application/json' }) : send(res, 401, '{}');
    }

    // 4. the form in an iframe
    if (p === '/iframe') return send(res, 200, page('Sign in', '<h1>Sign in</h1><iframe src="/login-frame" width="420" height="300"></iframe>'));
    if (p === '/login-frame') return send(res, 200, page('Frame', formHtml('/login?next=/app').replace('<form ', '<form target="_top" ')));

    // 5. the form inside a web component's shadow DOM
    if (p === '/shadow')
      return send(res, 200, page('Sign in', `<h1>Sign in</h1><login-box></login-box><script>
        customElements.define('login-box', class extends HTMLElement {
          connectedCallback() {
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = '<div class="box"><input name="user" type="email" placeholder="Email"><input name="pass" type="password" placeholder="Password"><button>Sign in</button></div>';
            root.querySelector('button').addEventListener('click', async () => {
              const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: root.querySelector('[name=user]').value, password: root.querySelector('[name=pass]').value }) });
              if (r.ok) location.href = '/app';
            });
          }
        });
      </script>`));

    // 6. behind a "Sign in" button that opens a modal
    if (p === '/modal')
      return send(res, 200, page('Home', `<h1>Home</h1><button id="open-login">Sign in</button><div class="modal" id="m"><form id="f"><input type="email" placeholder="Email"><input type="password" placeholder="Password"><button type="submit">Continue</button></form></div><script>
        document.getElementById('open-login').onclick = () => m.classList.add('open');
        f.onsubmit = async ev => {
          ev.preventDefault();
          const [email, password] = [...f.querySelectorAll('input')].map(i => i.value);
          const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
          if (r.ok) location.href = '/app';
        };
      </script>`));

    // 7. a password, then an authenticator-app code (one box, or six one-digit boxes)
    if ((p === '/otp' || p === '/otp-boxes') && req.method === 'GET') return send(res, 200, page('Sign in', `<h1>Sign in</h1>${formHtml(p)}`));
    if ((p === '/otp' || p === '/otp-boxes') && req.method === 'POST') {
      const b = await body(req);
      if (!credsOk(b)) return send(res, 401, page('Sign in', '<p>Wrong email or password.</p>'));
      const id = crypto.randomBytes(8).toString('hex');
      pending.add(id);
      return redirect(res, `${p}/verify`, { 'set-cookie': `pending=${id}; Path=/` });
    }
    if (p === '/otp/verify' && req.method === 'GET')
      return send(res, 200, page('Verify', '<h1>Two-step verification</h1><form method="post" action="/otp/verify"><label>Enter the 6-digit code from your authenticator app <input name="code" autocomplete="one-time-code" inputmode="numeric"></label><button type="submit">Verify</button></form>'));
    if (p === '/otp-boxes/verify' && req.method === 'GET')
      return send(res, 200, page('Verify', `<h1>Verification code</h1><form method="post" action="/otp-boxes/verify" id="f">${Array.from({ length: 6 }, (_, i) => `<input name="d${i}" maxlength="1" inputmode="numeric" size="1">`).join('')}<button type="submit">Verify</button></form><script>
        const boxes = [...document.querySelectorAll('input')];
        boxes.forEach((b, i) => b.addEventListener('input', () => { if (b.value && boxes[i + 1]) boxes[i + 1].focus(); }));
      </script>`));
    if ((p === '/otp/verify' || p === '/otp-boxes/verify') && req.method === 'POST') {
      const b = await body(req);
      const code = b.code || Array.from({ length: 6 }, (_, i) => b[`d${i}`] || '').join('');
      if (pending.has(cookies(req).pending) && codeOk(code)) return redirect(res, '/app', { 'set-cookie': startSession() });
      return send(res, 401, page('Verify', '<p>Wrong code.</p>'));
    }

    // 8. the browser's own login prompt (HTTP Basic)
    if (p === '/basic') {
      const expected = `Basic ${Buffer.from(`${DEMO.username}:${DEMO.password}`).toString('base64')}`;
      return req.headers.authorization === expected ? send(res, 200, WELCOME) : send(res, 401, page('401', 'Unauthorized'), { 'www-authenticate': 'Basic realm="Spectra demo"' });
    }

    // 9. a token: in a header, a cookie, or localStorage
    if (p === '/header-app') return req.headers['x-demo-token'] === DEMO.token ? send(res, 200, WELCOME) : send(res, 401, page('401', '<h1>Unauthorized</h1>'));
    if (p === '/cookie-app') return cookies(req).demo_token === DEMO.token ? send(res, 200, WELCOME) : redirect(res, '/login?next=/cookie-app');
    if (p === '/storage-app')
      return send(res, 200, page('App', `<div id="root"></div><script>
        root.innerHTML = localStorage.getItem('demo_token') === ${JSON.stringify(DEMO.token)}
          ? '<h1 id="welcome">Welcome, signed in</h1>'
          : '<form><input type="email" placeholder="Email"><input type="password" placeholder="Password"><button>Sign in</button></form>';
      </script>`));

    // 10. a sign-in link (a dev-only auto login)
    if (p === '/magic') return redirect(res, next(req.url), { 'set-cookie': startSession() });

    // 11. a CAPTCHA, which Spectra must not try to get past
    if (p === '/captcha' && req.method === 'GET') return send(res, 200, page('Sign in', `<h1>Sign in</h1>${formHtml('/captcha', '<div class="g-recaptcha" data-sitekey="test"></div>')}`));
    if (p === '/captcha') return send(res, 200, page('Sign in', `<h1>Sign in</h1><p>Please complete the CAPTCHA.</p>${formHtml('/captcha', '<div class="g-recaptcha" data-sitekey="test"></div>')}`));

    send(res, 404, page('404', 'Not found'));
  });
  return server;
}

/** Starts the app on `port` (0: any free port); resolves to { url, close }. */
export function startLoginDemo(port = 0) {
  const server = createLoginDemo();
  return new Promise(resolve =>
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) })),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startLoginDemo(Number(process.env.PORT) || 5191);
  console.log(`login demo on ${url}  (test user ${DEMO.username})`);
}
