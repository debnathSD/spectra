// The test bench for `spectra fix`: runs the harness against a copy of the
// React demo app and checks its decisions.
//
//   node bench/run.mjs                    every case, with the scripted agent
//   node bench/run.mjs --case memoize     one case
//   node bench/run.mjs --agent claude     your real agent instead: Claude Code
//                                         (--budget <usd> per finding, default 1)
//   node bench/run.mjs --agent "<cmd>"    or any agent command
//
// With the scripted agent each case must end exactly as expected (the exit
// code says so). With a real agent the bench reports what it achieved: which
// findings it fixed, by how much, and whether anything slipped through.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.js';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(BENCH, '..');
const args = process.argv.slice(2);
const arg = name => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const agentArg = arg('agent');
const only = arg('case');
const keep = args.includes('--keep');

/** A standalone copy of the demo app, as its own git project, with a behaviour check. */
function makeProject(id, port) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `spectra-bench-${id}-`)));
  fs.cpSync(path.join(REPO, 'fixtures/demo-app/src'), path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'fixtures/demo-app/index.html'), path.join(dir, 'index.html'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: `bench-${id}`, private: true, type: 'module', scripts: { dev: `vite --port ${port} --strictPort`, test: 'node check.mjs' } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(dir, 'vite.config.js'), "import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };\n");
  // the behaviour check: the page still renders its heading, buttons and all 120 rows
  fs.writeFileSync(
    path.join(dir, 'check.mjs'),
    `import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(path.join(REPO, 'package.json'))});
const puppeteer = require('puppeteer-core');
const { findChrome } = await import(${JSON.stringify(path.join(REPO, 'server/chrome.js'))});
const url = process.env.SPECTRA_FIX_URL;
if (!url) throw new Error('SPECTRA_FIX_URL is not set');
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: (process.env.PERF_CHROME_ARGS || '').split(' ').filter(Boolean) });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 400));
  const seen = await page.evaluate(() => ({
    heading: /Perf demo/.test(document.querySelector('h1')?.textContent || ''),
    buttons: document.querySelectorAll('button').length,
    rows: [...document.querySelectorAll('.row')].map(r => r.textContent.trim()),
  }));
  const ok = seen.heading && seen.buttons === 3 && seen.rows.length === 120 && seen.rows[0] === 'Row 0' && seen.rows[119] === 'Row 119';
  if (!ok) {
    console.error('behaviour check failed:', JSON.stringify({ heading: seen.heading, buttons: seen.buttons, rows: seen.rows.length }));
    process.exit(1);
  }
  console.log('behaviour check passed: heading, 3 buttons, 120 rows');
} finally {
  await browser.close();
}
`,
  );
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.spectra\n');
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-q', '-m', 'demo app');
  return dir;
}

function fix(dir, agent, maxFixes) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(REPO, 'bin/spectra.js'), 'fix', '--max-fixes', String(maxFixes), '--runs', '3', '--agent', agent, '--json'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => {
      err += d;
      for (const line of String(d).split('\n').filter(Boolean)) console.error(`    ${line}`);
    });
    child.on('close', code => {
      let session = null;
      try {
        session = JSON.parse(out.trim().split('\n').pop());
      } catch {
        /* failed */
      }
      resolve({ code, session, err });
    });
  });
}

const results = [];
if (!agentArg || agentArg === 'replay') {
  for (const [i, c] of CASES.entries()) {
    if (only && c.id !== only) continue;
    console.error(`\n▶ ${c.id}: ${c.what}`);
    const dir = makeProject(c.id, 5300 + i);
    const t0 = Date.now();
    const { session, err } = await fix(dir, `node ${JSON.stringify(path.join(BENCH, 'agents/replay.mjs'))} ${c.id}`, 1);
    const got = session?.attempts?.[0]?.outcome || `error: ${err.trim().split('\n').pop()}`;
    results.push({ case: c.id, expected: c.expect, got, ok: got === c.expect, seconds: Math.round((Date.now() - t0) / 1000), reason: session?.attempts?.[0]?.reason || '', headline: session?.final?.headlines?.find(h => h.kind === 'improved')?.text || '' });
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('\nSpectra fix test bench — scripted agent\n');
  console.log(`${'Case'.padEnd(16)}${'Expected'.padEnd(16)}${'Got'.padEnd(16)}Result`);
  for (const r of results) console.log(`${r.case.padEnd(16)}${r.expected.padEnd(16)}${r.got.padEnd(16)}${r.ok ? '✓' : '✗'}  ${r.headline || r.reason}`);
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} cases decided correctly.`);
  fs.writeFileSync(path.join(BENCH, 'last-run.json'), `${JSON.stringify({ agent: 'replay', results }, null, 2)}\n`);
  // in CI: each wrong decision as an annotation (readable without the log), and the table as Markdown
  if (process.env.GITHUB_ACTIONS)
    for (const r of results.filter(r => !r.ok)) console.log(`::error title=Bench case ${r.case}::expected ${r.expected}, got ${r.got}: ${(r.headline || r.reason || '').replace(/\n/g, ' ')}`);
  const md = [
    `${passed}/${results.length} cases decided correctly.`,
    '',
    '| Case | Expected | Got | |',
    '| --- | --- | --- | --- |',
    ...results.map(r => `| ${r.case} | ${r.expected} | ${r.got} | ${r.ok ? '✅' : '❌'} ${(r.headline || r.reason || '').replace(/\|/g, '\\|')} |`),
  ].join('\n');
  if (process.env.SPECTRA_BENCH_MD) fs.writeFileSync(process.env.SPECTRA_BENCH_MD, `${md}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Fix harness test bench\n\n${md}\n`);
  process.exit(passed === results.length ? 0 : 1);
} else {
  const agent = agentArg === 'claude' ? undefined : agentArg;
  console.error(`\n▶ real agent: ${agentArg} on the React demo app`);
  const dir = makeProject('agent', 5390);
  const t0 = Date.now();
  const { session, err, code } = await new Promise(resolve => {
    const extra = agent ? ['--agent', agent] : ['--max-budget-usd', arg('budget') || '1'];
    const child = spawn(process.execPath, [path.join(REPO, 'bin/spectra.js'), 'fix', '--max-fixes', '3', '--runs', '3', ...extra, '--json'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let e = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => {
      e += d;
      for (const line of String(d).split('\n').filter(Boolean)) console.error(`    ${line}`);
    });
    child.on('close', c => {
      let s = null;
      try {
        s = JSON.parse(out.trim().split('\n').pop());
      } catch {
        /* none */
      }
      resolve({ session: s, err: e, code: c });
    });
  });
  if (!session) {
    console.error(`the harness did not finish (exit ${code}): ${err.trim().split('\n').pop()}`);
    process.exit(1);
  }
  const kept = session.attempts.filter(a => a.outcome === 'kept');
  console.log(`\nSpectra fix test bench — ${session.agent}\n`);
  for (const a of session.attempts) console.log(`  ${a.outcome === 'kept' ? '✓' : '✗'} ${a.outcome.padEnd(14)} ${a.finding.title} — ${a.reason}`);
  console.log(`\nFixed ${kept.length} of ${session.attempts.length} findings in ${Math.round((Date.now() - t0) / 1000)} s${session.attempts.some(a => a.costUsd) ? `, agent cost $${session.attempts.reduce((n, a) => n + (a.costUsd || 0), 0).toFixed(2)}` : ''}.`);
  if (session.final) for (const h of session.final.headlines) console.log(`  ${h.kind === 'improved' ? '✓' : '✗'} ${h.text}`);
  fs.writeFileSync(path.join(BENCH, 'last-run.json'), `${JSON.stringify({ agent: session.agent, session }, null, 2)}\n`);
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
}
