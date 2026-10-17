// Records the launch film's "Compare two commits" chapter from the real
// dashboard. It builds a throwaway git copy of the demo app with two commits:
// the app as it is, then the fixes Claude Code made in the fix-harness bench
// (compare/*.patch: memoised rows and the tick moved out of App). It profiles
// each commit three times, opens `spectra dashboard` on the project, fills the
// Compare tab with the two commits' recordings, screenshots it, downloads both
// PDF reports and renders their pages to PNG (compare/pdf2png.swift, macOS).
//
// Writes public/compare/: sides.png, verdict.png, files.png,
// summary-<n>.png, detailed-<n>.png, and compare.json (what the shots show).
//
//   node scripts/record-compare.mjs [--keep]
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(VIDEO, '..');
const OUT = path.join(VIDEO, 'public/compare');
const HERE = path.join(VIDEO, 'scripts/compare');
const require = createRequire(`${REPO}/package.json`);
const puppeteer = require('puppeteer-core');
const { findChrome } = await import(path.join(REPO, 'server/chrome.js'));
const SPECTRA = path.join(REPO, 'bin/spectra.js');
const APP_PORT = 5236, DASH_PORT = 4436;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- the project
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-compare-')));
fs.cpSync(path.join(REPO, 'fixtures/demo-app/src'), path.join(dir, 'src'), { recursive: true });
fs.copyFileSync(path.join(REPO, 'fixtures/demo-app/index.html'), path.join(dir, 'index.html'));
fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'storefront', private: true, type: 'module', scripts: { dev: `vite --port ${APP_PORT} --strictPort` } }, null, 2)}\n`);
fs.writeFileSync(path.join(dir, 'vite.config.js'), "import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };\n");
fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.spectra\n');
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

const git = (args, date) =>
  execFileSync('git', args, {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }), GIT_AUTHOR_NAME: 'Demo Developer', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo Developer', GIT_COMMITTER_EMAIL: 'demo@example.com' },
  }).toString().trim();
git(['init', '-q', '-b', 'main']);
git(['add', '-A']);
git(['commit', '-q', '-m', 'Product list with a live ticker'], '2026-10-15T10:24:00');
const before = git(['rev-parse', '--short', 'HEAD']);

const profile = label => {
  console.log(`profiling ${label} (3 runs) …`);
  execFileSync(process.execPath, [SPECTRA, 'performance', '--quick', '--runs', '3'], { cwd: dir, stdio: 'inherit' });
};
profile(`before (${before})`);
for (const patch of ['1-memoise-rows.patch', '2-tick-store.patch']) git(['apply', path.join(HERE, patch)]);
git(['commit', '-qam', 'Memoise list rows and move the ticker out of App'], '2026-10-16T16:05:00');
const after = git(['rev-parse', '--short', 'HEAD']);
profile(`after (${after})`);

// the recordings of each commit
const reports = path.join(dir, '.spectra/reports');
const byCommit = { [before]: [], [after]: [] };
for (const f of fs.readdirSync(reports).filter(f => f.endsWith('.json'))) {
  const r = JSON.parse(fs.readFileSync(path.join(reports, f), 'utf8'));
  const hash = r.meta?.git?.shortHash;
  if (hash in byCommit) byCommit[hash].push(f.replace(/\.json$/, ''));
}
console.log('recordings:', JSON.stringify(byCommit));

// ---------------------------------------------------------------- the dashboard
const dash = spawn(process.execPath, [SPECTRA, 'dashboard', '--port', String(DASH_PORT)], { cwd: dir, stdio: 'ignore', env: { ...process.env, BROWSER: 'none', SPECTRA_NO_OPEN: '1' } });
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, defaultViewport: null, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
fs.mkdirSync(OUT, { recursive: true });
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-pdf-'));
try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }]);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const url = `http://127.0.0.1:${DASH_PORT}/`;
  // the dashboard keeps a live connection open, so wait for its content, not for network silence
  for (let i = 0; i < 60; i++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 }); break; } catch { await sleep(500); }
  }
  await page.waitForFunction(() => [...document.querySelectorAll('button, [role="tab"]')].some(b => /Compare commits/.test(b.textContent)), { timeout: 30000 });
  await page.setViewport({ width: 1440, height: 3600, deviceScaleFactor: 1.5 });
  const clickText = (sel, text) => page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find(e => new RegExp(text).test(e.textContent.trim()));
    if (!el) throw new Error(`no ${sel} matching ${text}`);
    el.click();
  }, sel, text);
  await clickText('button, [role="tab"]', '^Compare commits$');
  await sleep(800);
  for (const [label, hash] of [['Before', before], ['After', after]])
    for (const id of byCommit[hash]) {
      await page.select(`select[aria-label="Add a saved report to ${label}"]`, id);
      await sleep(500);
    }
  await page.waitForSelector('.compare-toolbar', { timeout: 30000 });
  await sleep(1200);

  const rect = async specs => page.evaluate(list => {
    const rs = list.map(([sel, nth]) => document.querySelectorAll(sel)[nth || 0]?.getBoundingClientRect()).filter(Boolean);
    const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
    return { x: x - 14, y: y + window.scrollY - 14, width: Math.max(...rs.map(r => r.right)) - x + 28, height: Math.max(...rs.map(r => r.bottom)) - y + 28 };
  }, specs);
  const shot = async (name, specs) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: await rect(specs) });
    console.log(`✓ ${name}.png`);
  };
  await shot('sides', [['.sides']]);
  await shot('verdict', [['.compare-toolbar'], ['.compare-results ul.icons']]);
  await clickText('.compare-results [role="tab"], .compare-results .tabs button', '^Files');
  await sleep(800);
  await shot('files', [['.compare-results div.tabs'], ['.detail-pane']]);

  // both PDFs, through the dashboard's own buttons
  for (const [button, kind] of [['PDF summary', 'summary'], ['PDF detailed report', 'detailed']]) {
    const had = new Set(fs.readdirSync(downloads));
    await clickText('.pdf-buttons button', button);
    let file;
    for (let i = 0; i < 120 && !file; i++) {
      await sleep(500);
      file = fs.readdirSync(downloads).find(f => f.endsWith('.pdf') && !had.has(f));
    }
    if (!file) throw new Error(`the ${kind} PDF did not download`);
    fs.copyFileSync(path.join(downloads, file), path.join(OUT, `${kind}.pdf`));
    for (const old of fs.readdirSync(OUT).filter(f => f.startsWith(`${kind}-`) && f.endsWith('.png'))) fs.rmSync(path.join(OUT, old));
    execFileSync('swift', [path.join(HERE, 'pdf2png.swift'), path.join(OUT, `${kind}.pdf`), path.join(OUT, kind), '2'], { stdio: 'inherit' });
  }
  const pages = kind => fs.readdirSync(OUT).filter(f => new RegExp(`^${kind}-\\d+\\.png$`).test(f)).length;
  fs.writeFileSync(path.join(OUT, 'compare.json'), `${JSON.stringify({ before, after, author: 'Demo Developer', summaryPages: pages('summary'), detailedPages: pages('detailed'), recordings: byCommit }, null, 2)}\n`);
  console.log(`done: ${before} → ${after}, summary ${pages('summary')} pages, detailed ${pages('detailed')} pages`);
} finally {
  await browser.close();
  dash.kill();
  if (!process.argv.includes('--keep')) fs.rmSync(dir, { recursive: true, force: true });
  else console.log('project kept at', dir);
}
