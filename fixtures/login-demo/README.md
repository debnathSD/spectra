# Login demo

A small test app with every kind of login Spectra can sign in through, in front of one protected
page (`/app`). Spectra's sign-in tests (`server/test-signin.js`) run against it.

```bash
node fixtures/login-demo/server.mjs   # http://localhost:5191/
```

Test credentials, for this fixture only:

| | |
| --- | --- |
| Email | `demo@spectra.test` |
| Password | `spectra-demo-pass` |
| Authenticator (TOTP) secret | `JBSWY3DPEHPK3PXP` |
| Token | `spectra-demo-token` |

| Path | Login |
| --- | --- |
| `/login` | A classic form |
| `/two-step` | The username, then Next, then the password |
| `/spa` | A single-page app's form, rendered late, whose fields only change through input events |
| `/iframe` | The form in an iframe |
| `/shadow` | The form inside a web component's shadow DOM |
| `/modal` | Behind a "Sign in" button that opens a modal |
| `/otp`, `/otp-boxes` | A password, then an authenticator code (one box, or six one-digit boxes) |
| `/basic` | The browser's login prompt (HTTP Basic) |
| `/header-app` | An `X-Demo-Token` header |
| `/cookie-app` | A `demo_token` cookie |
| `/storage-app` | A `demo_token` localStorage entry |
| `/magic?next=/app` | A sign-in link |
| `/captcha` | A CAPTCHA, which Spectra must refuse to get past |
