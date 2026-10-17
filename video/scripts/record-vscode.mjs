// Records the VS Code demo: drives a real, isolated VS Code (the extension
// test build) with the packaged Spectra extension through the whole workflow
// on the demo app, and records the window with the DevTools screencast.
// Writes public/footage/vscode.mp4 (60 fps) and public/footage/vscode.json
// (timestamps of each step and the mouse positions, for the edit).
//
// Needs macOS, the demo app running (npm run demo in the repository root), the
// extension packaged (vscode/spectra-performance-<version>.vsix) and the VS Code
// test build downloaded (npm --prefix vscode run test:e2e once).
import { createRequire } from 'node:module';
import { spawn, execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(VIDEO, '..');
const require = createRequire(`${REPO}/package.json`);
const puppeteer = require('puppeteer-core');
// ffmpeg: $FFMPEG, or the one that ships with Remotion
const FFMPEG = (() => {
  if (process.env.FFMPEG) return { bin: process.env.FFMPEG, env: process.env };
  const { dir } = createRequire(`${VIDEO}/package.json`)(`@remotion/compositor-${process.platform}-${process.arch}`);
  return { bin: path.join(dir, 'ffmpeg'), env: { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir } };
})();
const VSCODE = fs.readdirSync(`${REPO}/vscode/.vscode-test`).find(d => d.startsWith('vscode-darwin'));
const APP = `${REPO}/vscode/.vscode-test/${VSCODE}/Visual Studio Code.app`;
const VSIX = fs.readdirSync(`${REPO}/vscode`).find(f => /^spectra-performance-.*\.vsix$/.test(f));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'svs-'));
const UD = path.join(TMP, 'ud');
const EXT = path.join(TMP, 'ext');
const FRAMES = path.join(TMP, 'frames');
const OUT = path.join(VIDEO, 'public', 'footage');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// a clean project: no results from earlier runs
fs.rmSync(`${REPO}/fixtures/demo-app/.spectra`, { recursive: true, force: true });
execFileSync(`${APP}/Contents/Resources/app/bin/code`, [`--user-data-dir=${UD}`, `--extensions-dir=${EXT}`, '--install-extension', `${REPO}/vscode/${VSIX}`], { stdio: 'inherit' });
fs.mkdirSync(`${UD}/User`, { recursive: true });
fs.writeFileSync(
  `${UD}/User/settings.json`,
  JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'spectra.cliPath': `${REPO}/bin/spectra.js`,
    'spectra.runs': 3,
    'editor.fontSize': 15,
    'editor.lineHeight': 24,
    'editor.minimap.enabled': false,
    'editor.cursorBlinking': 'solid',
    'breadcrumbs.enabled': false,
    'workbench.tips.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.ignoreRecommendations': true,
    'chat.disableAIFeatures': true,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'window.commandCenter': false,
    'security.workspace.trust.enabled': false,
    'files.exclude': { '**/.spectra': true },
    'git.enabled': false,
    'workbench.layoutControl.enabled': false,
  }),
);

const proc = spawn(
  `${APP}/Contents/MacOS/Code`,
  [`--user-data-dir=${UD}`, `--extensions-dir=${EXT}`, '--remote-debugging-port=9333', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window', `${REPO}/fixtures/demo-app`],
  { stdio: 'ignore' },
);

let browser;
for (let i = 0; i < 60 && !browser; i++) {
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
  } catch {
    await sleep(500);
  }
}
let page;
for (let i = 0; i < 60 && !page; i++) {
  page = (await browser.pages()).find(p => p.url().includes('workbench'));
  if (!page) await sleep(500);
}
const cdp = await page.createCDPSession();
try {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 40, top: 40, width: 1440, height: 900 } });
} catch {} // Electron doesn't support it; the window keeps its size
await sleep(5000);

// --- the recording: every frame VS Code paints, with its timestamp
const frames = [];
let t0 = null;
const markers = [];
const now = () => Date.now() / 1000 - t0;
const mark = (name, extra = {}) => {
  markers.push({ name, t: +now().toFixed(3), ...extra });
  console.log(`${now().toFixed(1)}s ${name}`);
};
// frames and markers share one clock: arrival time
cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  if (t0 === null) t0 = Date.now() / 1000;
  const file = path.join(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: now() });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
let mouse = { x: viewport.width * 0.62, y: viewport.height * 0.5 };
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width * viewport.dpr, maxHeight: viewport.height * viewport.dpr });
for (let i = 0; t0 === null; i++) {
  await page.mouse.move(mouse.x + (i % 2), mouse.y); // something to paint
  await sleep(100);
}

const moveTo = async (x, y, ms = 700) => {
  // an eased glide, so the drawn cursor and VS Code's hover state agree
  const from = mouse;
  const steps = Math.max(2, Math.round(ms / 16));
  mark('mouse', { from, to: { x, y }, ms });
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(16);
  }
  mouse = { x, y };
};
const keys = async (...combo) => {
  for (const k of combo.slice(0, -1)) await page.keyboard.down(k);
  await page.keyboard.press(combo[combo.length - 1]);
  for (const k of combo.slice(0, -1).reverse()) await page.keyboard.up(k);
};
const type = (text, delay = 55) => page.keyboard.type(text, { delay });
const command = async (title, name) => {
  mark(`${name}:palette`);
  await keys('Meta', 'Shift', 'P');
  await sleep(600);
  await type(title);
  await sleep(700);
  mark(`${name}:enter`);
  await page.keyboard.press('Enter');
};
const waitFor = async (fn, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return true;
    await sleep(200);
  }
  return false;
};
const notice = re => page.evaluate(src => [...document.querySelectorAll('.notification-list-item-message')].map(e => e.textContent).find(t => new RegExp(src).test(t)), re.source);
const lensText = () => page.evaluate(() => document.querySelector('.codelens-decoration')?.textContent.trim());
const rect = sel =>
  page.evaluate(sel => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && { x: r.x, y: r.y, width: r.width, height: r.height };
  }, sel);

try {
  await page.mouse.move(mouse.x, mouse.y);
  mark('start');
  await sleep(1200);
  await keys('Meta', 'P');
  await sleep(500);
  await type('Row.jsx', 70);
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(1800);
  mark('editor');

  await command('Spectra: Profile page load', 'profile');
  await sleep(1000);
  await keys('Meta', 'A');
  await type('http://localhost:5188/', 40);
  await sleep(600);
  mark('profile:url');
  await page.keyboard.press('Enter');
  mark('profile:running', { notification: await rect('.notifications-toasts') });
  const found = await waitFor(
    () => [...document.querySelectorAll('.notification-list-item-message')].some(e => /Spectra: .*blocking/.test(e.textContent)) && !!document.querySelector('.squiggly-warning'),
    150000,
  );
  if (!found) {
    await page.screenshot({ path: path.join(OUT, 'failed.png') });
    throw new Error(`profiling did not finish: ${await page.evaluate(() => [...document.querySelectorAll('.notification-list-item-message')].map(e => e.textContent).join(' | '))}`);
  }
  await sleep(400);
  mark('profile:done', {
    text: await notice(/Spectra: .*blocking/),
    lensText: await lensText(),
    notification: await rect('.notifications-toasts .notification-toast'),
    status: await page.evaluate(() => {
      const el = [...document.querySelectorAll('.statusbar-item')].find(e => /TBT/.test(e.textContent));
      const r = el?.getBoundingClientRect();
      return r && { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
    lens: await rect('.codelens-decoration'),
  });
  await sleep(3500);

  const sq = await rect('.squiggly-warning');
  await moveTo(sq.x + sq.width * 0.4, sq.y + sq.height / 2, 900);
  await sleep(500);
  mark('hover', { at: { x: sq.x + sq.width * 0.4, y: sq.y + sq.height / 2 }, box: await rect('.monaco-hover') });
  await sleep(3500);
  await moveTo(viewport.width * 0.55, viewport.height * 0.62, 700);
  await sleep(600);

  mark('problems');
  await keys('Meta', 'Shift', 'M');
  await sleep(600);
  mark('problems:open', { panel: await rect('.part.panel') });
  await sleep(3800);
  await keys('Meta', 'J');
  await sleep(900);

  // the fix, typed into the editor
  mark('edit');
  await keys('Control', 'G');
  await sleep(500);
  await type('4', 80);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('End');
  await keys('Shift', 'Home');
  await sleep(500);
  mark('edit:type');
  await type('// removed the expensive per-row work', 45);
  await sleep(300);
  await keys('Meta', 'S');
  await sleep(1200);
  mark('edit:saved');

  await command('Spectra: Verify against baseline', 'verify');
  await sleep(300);
  mark('verify:running');
  const verified = await waitFor(
    () => [...document.querySelectorAll('.notification-list-item-message')].some(e => /Spectra: (Improved|Regressed|Mixed|No significant)/.test(e.textContent)),
    120000,
  );
  if (!verified) throw new Error('verify did not finish');
  mark('verify:shown');
  await sleep(1500); // the CodeLens refreshes with the new result
  mark('verify:done', {
    text: await notice(/Spectra: (Improved|Regressed|Mixed|No)/),
    lensText: await lensText(),
    notification: await rect('.notifications-toasts .notification-toast'),
    lens: await rect('.codelens-decoration'),
  });
  await sleep(3500);
  mark('end');
  await sleep(300);
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {});
  await browser.close().catch(() => {});
  proc.kill();
  execSync(`git -C "${REPO}" checkout -- fixtures/demo-app/src/Row.jsx`);
}

// a constant 60 fps video from the variable-rate screencast
const end = markers.at(-1).t;
const list = frames
  .map((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    return `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
  })
  .join('\n');
fs.writeFileSync(path.join(TMP, 'frames.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
execFileSync(FFMPEG.bin, [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'frames.txt'),
  '-vf', 'fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', path.join(OUT, 'vscode.mp4'),
], { env: FFMPEG.env });
fs.writeFileSync(path.join(OUT, 'vscode.json'), JSON.stringify({ viewport, duration: end, frames: frames.length, markers }, null, 2));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`recorded ${frames.length} frames, ${end.toFixed(1)} s → ${path.join(OUT, 'vscode.mp4')}`);
