/**
 * CLI wrapper for the evaluation orchestrator — the default action of
 * `spectra performance`. Runs the golden-path suite against --url, prints the
 * performance matrix, and saves an aggregate report alongside the per-path
 * reports (all openable in the dashboard).
 */
import fs from 'node:fs';
import path from 'node:path';
import { runEvaluation } from './evaluate.js';
import { REPORTS_DIR, TARGET_NAME } from '../config.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1] ?? true;
};
const flag = name => args.includes(`--${name}`);

const url = opt('url');
if (!url) {
  console.error('spectra: evaluate requires --url');
  process.exit(1);
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padL = (s, n) => String(s ?? '').padStart(n);
const ms = v => (v == null ? '—' : `${v}ms`);

function printMatrix(result) {
  const rows = [result.baseline, ...result.paths];
  console.log(`\n${'═'.repeat(78)}`);
  console.log(`Spectra performance evaluation — ${result.target}`);
  console.log(`${result.url}`);
  console.log(
    `${result.discovered} actionable elements · ${result.paths.length} golden paths · ` +
      `${result.skippedDestructive.length} destructive skipped (safe mode)`,
  );
  console.log('═'.repeat(78));
  console.log(
    `${pad('#', 3)}${pad('Golden path', 34)}${pad('Result', 8)}${padL('TBT', 7)}${padL('LCP', 8)}${padL('LongT', 7)}  Top finding`,
  );
  console.log('─'.repeat(78));
  rows.forEach((r, i) => {
    const num = i === 0 ? '·' : String(i);
    const status = r.ok ? 'PASS' : 'FAIL';
    const s = r.summary || {};
    const top = s.topFinding ? `[${s.topFinding.severity}] ${s.topFinding.title}` : '—';
    console.log(
      `${pad(num, 3)}${pad(r.title, 34)}${pad(status, 8)}${padL(ms(s.tbtMs), 7)}${padL(ms(s.lcpMs), 8)}${padL(s.longTaskCount ?? '—', 7)}  ${top.slice(0, 40)}`,
    );
    if (!r.ok && r.error) console.log(`      ↳ ${r.error}`);
  });
  console.log('─'.repeat(78));
  const passed = result.paths.filter(p => p.ok).length;
  console.log(`Automation: ${passed}/${result.paths.length} golden paths passed.`);
  if (result.skippedDestructive.length) {
    console.log(
      `Skipped (safe mode): ${result.skippedDestructive.map(s => s.name).join(', ')}`,
    );
  }
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const result = await runEvaluation({
  url,
  headless: !flag('headed'),
  limit: Number(opt('paths', 12)),
  signIn: opt('sign-in'),
  onProgress: ev => {
    if (ev.phase === 'baseline') console.error('spectra: recording baseline page load …');
    else if (ev.phase === 'discover') console.error('spectra: discovering actionable elements …');
    else if (ev.phase === 'synthesized')
      console.error(
        `spectra: ${ev.discovered} actionable elements (${ev.skipped} destructive skipped) → ${ev.paths} golden paths`,
      );
    else if (ev.phase === 'path')
      console.error(`spectra: [${ev.index}/${ev.total}] ${ev.title}`);
  },
});

printMatrix(result);

const id = `evaluation-${stamp()}`;
fs.mkdirSync(REPORTS_DIR, { recursive: true });
const file = path.join(REPORTS_DIR, `${id}.json`);
fs.writeFileSync(
  file,
  JSON.stringify({ id, kind: 'evaluation', createdAt: Date.now(), target: TARGET_NAME, ...result }, null, 2),
);

const installed = !!process.env.PERF_REPORTS_DIR;
console.log(`\nSaved ${file}`);
console.log(
  `Per-path reports are in ${REPORTS_DIR} — view them with: ${installed ? 'spectra dashboard' : 'npm run dev'}`,
);
process.exit(0);
