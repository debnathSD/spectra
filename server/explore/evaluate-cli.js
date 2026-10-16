/**
 * CLI wrapper for the evaluation orchestrator — the default action of
 * `spectra performance`. Runs the golden-path suite against --url, prints the
 * performance matrix, and saves an aggregate report alongside the per-path
 * reports (all openable in the dashboard). With --json / --out it also emits
 * the machine-readable result, and budgets from spectra.config.json are
 * checked against every journey.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runEvaluation } from './evaluate.js';
import { readReport } from '../recorder.js';
import { REPORTS_DIR, TARGET_NAME } from '../config.js';
import { parseArgs } from '../args.js';
import { loadProjectConfig } from '../project-config.js';
import { EXIT, SPECTRA_VERSION, exitAfterFlush, printBudgets, reportFile, writeResult } from '../output.js';
import { buildEvaluationResult } from '../../shared/result.js';

const { opt, flag } = parseArgs(process.argv.slice(2));

const url = opt('url');
if (!url) {
  console.error('spectra: evaluate requires --url');
  process.exit(EXIT.ERROR);
}
const json = flag('json');
const out = opt('out');
// In --json mode stdout carries only the result; people still see the matrix.
const log = json ? console.error : console.log;

let config;
try {
  config = loadProjectConfig(opt('config'));
} catch (err) {
  console.error(`spectra: ${err.message}`);
  process.exit(EXIT.ERROR);
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padL = (s, n) => String(s ?? '').padStart(n);
const ms = v => (v == null ? '—' : `${Math.round(v)}ms`);

function printMatrix(result) {
  const rows = [result.baseline, ...result.paths];
  log(`\n${'═'.repeat(78)}`);
  log(`Spectra performance evaluation — ${result.target}`);
  log(`${result.url}`);
  log(
    `${result.discovered} actionable elements · ${result.paths.length} golden paths · ` +
      `${result.skippedDestructive.length} destructive skipped (safe mode)`,
  );
  log('═'.repeat(78));
  log(
    `${pad('#', 3)}${pad('Golden path', 34)}${pad('Result', 8)}${padL('TBT', 7)}${padL('LCP', 8)}${padL('LongT', 7)}  Top finding`,
  );
  log('─'.repeat(78));
  rows.forEach((r, i) => {
    const num = i === 0 ? '·' : String(i);
    const status = r.ok ? 'PASS' : 'FAIL';
    const s = r.summary || {};
    const top = s.topFinding ? `[${s.topFinding.severity}] ${s.topFinding.title}` : '—';
    log(
      `${pad(num, 3)}${pad(r.title, 34)}${pad(status, 8)}${padL(ms(s.tbtMs), 7)}${padL(ms(s.lcpMs), 8)}${padL(s.longTaskCount ?? '—', 7)}  ${top.slice(0, 40)}`,
    );
    if (!r.ok && r.error) log(`      ↳ ${r.error}`);
  });
  log('─'.repeat(78));
  const passed = result.paths.filter(p => p.ok).length;
  log(`Automation: ${passed}/${result.paths.length} golden paths passed.`);
  if (result.skippedDestructive.length) {
    log(
      `Skipped (safe mode): ${result.skippedDestructive.map(s => s.name).join(', ')}`,
    );
  }
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let result;
try {
  result = await runEvaluation({
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
} catch (err) {
  console.error(`spectra: ${err.message}`);
  process.exit(EXIT.ERROR);
}

printMatrix(result);

const id = `evaluation-${stamp()}`;
fs.mkdirSync(REPORTS_DIR, { recursive: true });
const file = path.join(REPORTS_DIR, `${id}.json`);
fs.writeFileSync(
  file,
  JSON.stringify({ id, kind: 'evaluation', createdAt: Date.now(), target: TARGET_NAME, ...result }, null, 2),
);

const evaluation = buildEvaluationResult({
  evaluation: result,
  readReport,
  fileOf: reportFile,
  file,
  spectraVersion: SPECTRA_VERSION,
  budgets: config.budgets,
});
printBudgets(evaluation.budgets, log);
writeResult(evaluation, { json, out });

const installed = !!process.env.PERF_REPORTS_DIR;
log(`\nSaved ${file}`);
log(
  `Per-path reports are in ${REPORTS_DIR} — view them with: ${installed ? 'spectra dashboard' : 'npm run dev'}`,
);
if (out) log(`Result written to ${path.resolve(out)}`);
exitAfterFlush(evaluation.budgets && !evaluation.budgets.ok ? EXIT.CHECKS_FAILED : EXIT.OK);
