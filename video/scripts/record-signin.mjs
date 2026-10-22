// Records the "Signing in" video's footage from the real dashboard and CLI.
// It starts the login test app (fixtures/login-demo: a store whose pages are
// behind a login, with test credentials only) and `spectra dashboard` on a
// throwaway project, then, in a headless Chrome:
//
//   - fills the dashboard's sign-in panel and screenshots it, for each method
//   - launches Spectra's own Chrome and screenshots it signing in, then signed in
//   - screenshots the app's login page, filled in, and Spectra's form sign-in
//     getting past it
//   - runs `spectra performance --quick` behind the login and keeps its output
//
// Writes public/signin/: *.png and signin.json (what the shots and the CLI show).
//
//   node scripts/record-signin.mjs     (build the dashboard first: npm run build in the repository)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(VIDEO, '..');
const OUT = path.join(VIDEO, 'public/signin');
const require = createRequire(`${REPO}/package.json`);
const puppeteer = require('puppeteer-core');
const { findChrome } = await import(pathToFileURL(path.join(REPO, 'server/chrome.js')).href);
const { signInWithForm } = await import(pathToFileURL(path.join(REPO, 'server/signin.js')).href);
const { DEMO, startLoginDemo } = await import(pathToFileURL(path.join(REPO, 'fixtures/login-demo/server.mjs')).href);
const SPECTRA = path.join(REPO, 'bin/spectra.js');
const APP_PORT = 5291, DASH_PORT = 4437;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const temp = name => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `spectra-signin-${name}-`)));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const demo = await startLoginDemo(APP_PORT);
const PAGE = `${demo.url}/app`;
const dir = temp('project');
fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'acme-store', private: true }, null, 2)}\n`);
// Spectra's Chrome gets a fresh profile, so it starts signed out
const env = { ...process.env, BROWSER: 'none', SPECTRA_NO_OPEN: '1', PERF_CHROME_PROFILE_DIR: temp('chrome') };
const dash = spawn(process.execPath, [SPECTRA, 'dashboard', '--port', String(DASH_PORT)], { cwd: dir, stdio: 'ignore', env });
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, defaultViewport: null, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const facts = { page: PAGE, username: DEMO.username, shots: {} };

try {
  // ------------------------------------------------------------ the dashboard
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setViewport({ width: 1180, height: 1000, deviceScaleFactor: 2 });
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`http://127.0.0.1:${DASH_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 5000 });
      break;
    } catch {
      await sleep(500);
    }
  }
  await page.waitForSelector('.connect', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.connect');
  await sleep(600);

  const shot = async (name, note) => {
    const el = await page.$('.session');
    await el.screenshot({ path: path.join(OUT, `${name}.png`) });
    const box = await el.boundingBox();
    facts.shots[name] = { note, width: Math.round(box.width), height: Math.round(box.height) };
    console.log(`✓ ${name}.png`);
  };
  const clickText = (sel, text) =>
    page.evaluate(
      (sel, text) => {
        const el = [...document.querySelectorAll(sel)].find(e => new RegExp(text).test(e.textContent.trim()));
        if (!el) throw new Error(`no ${sel} matching ${text}`);
        el.click();
      },
      sel,
      text,
    );
  const typeInto = async (selector, text) => {
    await page.click(selector, { count: 3 });
    await page.keyboard.press('Backspace');
    await page.type(selector, text, { delay: 8 });
  };

  await typeInto('.connect-main input[type=url]', PAGE);
  await shot('connect', 'the Connect panel, sign-in off');
  await page.click('.signin input[role=switch]');
  await sleep(300);
  await shot('form-empty', 'sign-in on: Login form');
  await typeInto('.signin input[placeholder="me@example.com"]', DEMO.username);
  await typeInto('.signin input[type=password]', DEMO.password);
  await sleep(200);
  await shot('form-filled', 'username and password filled in');
  for (const [title, name] of [
    ['I’ll sign in myself', 'manual'],
    ['Browser prompt', 'http'],
    ['Token or cookie', 'token'],
    ['Sign-in link', 'link'],
  ]) {
    await clickText('.signin-method', `^${title}$`);
    await sleep(250);
    await shot(`method-${name}`, title);
  }
  await clickText('.signin-method', '^Login form$');
  await sleep(250);

  // Headless, so no window opens while recording, then launch
  await clickText('.connect-main button', '^Advanced');
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll('.advanced .switch')].find(l => /Headless/.test(l.textContent)).querySelector('input').click());
  await clickText('.connect-main button', '^Advanced');
  await sleep(200);
  await clickText('.connect-main button', '^Launch Chrome$');
  let sawSigningIn = false;
  for (let i = 0; i < 300; i++) {
    const text = await page.evaluate(() => document.querySelector('.session')?.innerText || '');
    if (!sawSigningIn && /Signing in/.test(text)) {
      sawSigningIn = true;
      await shot('signing-in', 'Spectra signing in');
    }
    if (/Signed in/.test(text)) break;
    await sleep(60);
  }
  await sleep(900);
  await shot('signed-in', 'signed in, on the protected page');
  facts.sawSigningIn = sawSigningIn;
  facts.status = await page.evaluate(() => fetch('/api/status').then(r => r.json()).then(s => ({ pageUrl: s.pageUrl, signIn: s.signIn, title: s.pages.find(p => p.selected)?.title })));
  await clickText('.session button', '^Close Chrome$').catch(() => {});

  // ------------------------------------------------------------ the app's login page, as Spectra fills it
  const app = await browser.newPage();
  await app.setViewport({ width: 760, height: 620, deviceScaleFactor: 2 });
  await app.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await app.screenshot({ path: path.join(OUT, 'app-login.png') });
  console.log('✓ app-login.png');
  // the form as Spectra fills it in (typed the same way: click, type), then Spectra signs in for real
  await app.type('input[type=email]', DEMO.username, { delay: 12 });
  await app.type('input[type=password]', DEMO.password, { delay: 12 });
  await app.screenshot({ path: path.join(OUT, 'app-typed.png') });
  console.log('✓ app-typed.png');
  await signInWithForm(app, { username: DEMO.username, password: DEMO.password });
  await app.screenshot({ path: path.join(OUT, 'app-welcome.png') });
  console.log('✓ app-welcome.png');
} finally {
  await browser.close();
  dash.kill();
}

// ------------------------------------------------------------ the command line
const cliArgs = ['performance', '--quick', '--url', PAGE, '--login-user', DEMO.username];
// asynchronously: the login app answers from this very process
const output = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [SPECTRA, ...cliArgs], {
    cwd: dir,
    env: { ...env, PERF_CHROME_PROFILE_DIR: temp('cli'), SPECTRA_LOGIN_PASSWORD: DEMO.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout.on('data', d => (text += d));
  child.stderr.on('data', d => (text += d));
  child.on('error', reject);
  child.on('close', () => resolve(text));
});
if (output.includes(DEMO.password)) throw new Error('the CLI output contains the password');
facts.cli = {
  command: `SPECTRA_LOGIN_PASSWORD=•••• npx spectra ${cliArgs.join(' ')}`,
  lines: output
    .split('\n')
    // the throwaway project as a project in your home folder would print
    .map(l => l.replaceAll(dir, '~/acme-store').replace(/\s+$/, ''))
    .filter(Boolean)
    .slice(0, 16),
};
await demo.close();
fs.rmSync(dir, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, 'signin.json'), `${JSON.stringify(facts, null, 2)}\n`);
console.log(`done: ${Object.keys(facts.shots).length} dashboard shots, CLI ${facts.cli.lines.length} lines`);
