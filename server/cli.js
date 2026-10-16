/**
 * Single-page profiling: one or more recordings of one page.
 *
 *   spectra performance --quick                       # one page-load profile
 *   spectra performance --quick --runs 5 --json       # median of 5, as JSON
 *   npm run profile -- --url http://localhost:3000/ --mode load
 *   npm run profile -- --url http://localhost:5188/ --duration 8 --throttle 4
 *   npm run profile -- --url ... --scenario ./scenario.mjs   # export default async page => {…}
 *
 * Every run is saved in reports/ and can be opened in the UI (npm run dev).
 * Several runs are reduced to their median, so one noisy recording can't
 * decide a number. Budgets from spectra.config.json are checked against it.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PerfSession, readReport } from './recorder.js';
import { REPORTS_DIR, TARGET_NAME } from './config.js';
import { intOption, parseArgs } from './args.js';
import { loadProjectConfig } from './project-config.js';
import { EXIT, SPECTRA_VERSION, exitAfterFlush, fmt, printBudgets, reportFile, writeResult } from './output.js';
import { buildProfileResult } from '../shared/result.js';

const { opt, flag } = parseArgs(process.argv.slice(2));

const url = opt('url');
if (!url || flag('help')) {
  console.error(
    'usage: npm run profile -- --url <page> [--mode live|load] [--runs n] [--duration seconds] [--throttle 4] [--scenario file.mjs] [--json] [--out file.json] [--config spectra.config.json] [--headed] [--save-trace] [--sign-in "http://host/login/?redirect={url}"]',
  );
  process.exit(url ? EXIT.OK : EXIT.ERROR);
}

const json = flag('json');
const out = opt('out');
// In --json mode stdout carries only the result; people still see progress.
const log = json ? console.error : console.log;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let mode, runs, duration, cpuThrottle, config, scenario;
try {
  mode = opt('mode', 'live');
  if (!['live', 'load'].includes(mode)) throw new Error(`--mode must be live or load (got ${mode}).`);
  runs = intOption(opt('runs'), 'runs', { max: 25, fallback: 1 });
  duration = Number(opt('duration', 8)) * 1000;
  cpuThrottle = Number(opt('throttle', 1));
  config = loadProjectConfig(opt('config'));
  const scenarioFile = opt('scenario');
  if (scenarioFile) scenario = (await import(pathToFileURL(path.resolve(scenarioFile)).href)).default;
} catch (err) {
  console.error(`spectra: ${err.message}`);
  process.exit(EXIT.ERROR);
}

/** A page-load recording stops itself shortly after the load event. */
function recordLoad(session, startOpts) {
  return new Promise((resolve, reject) => {
    const onReport = r => {
      cleanup();
      resolve(readReport(r.id));
    };
    const onState = s => {
      if (s.error) {
        cleanup();
        reject(new Error(s.error));
      }
    };
    const cleanup = () => {
      session.off('report', onReport);
      session.off('state', onState);
    };
    session.on('report', onReport);
    session.on('state', onState);
    session.start(startOpts).catch(err => {
      cleanup();
      reject(err);
    });
  });
}

async function recordOnce(session, index) {
  const startOpts = { mode, cpuThrottle, saveTrace: flag('save-trace') };
  if (mode === 'load') return recordLoad(session, startOpts);
  // live: every run starts from the same freshly loaded page
  if (index > 0) {
    await session.navigate(url, opt('sign-in'));
    await sleep(800);
  }
  await session.start(startOpts);
  if (scenario) await scenario(session.page);
  else await sleep(duration);
  return session.stop();
}

const lineRef = c => (c.line ? `:${c.lineKind === 'located' ? '≈' : ''}${c.line}` : '');

function printProfile(result, reports) {
  const rep = reports.find(r => r.id === result.representativeRunId) || reports[0];
  const s = result.summary;
  if (reports.length === 1) {
    log(`\nReport ${rep.id} (${rep.meta.attribution}, ${rep.meta.sampleCount} samples)`);
    log(
      `TBT ${rep.vitals.tbtMs}ms · long tasks ${rep.vitals.longTaskCount} · CLS ${rep.vitals.cls} · FCP ${rep.vitals.fcpMs}ms · LCP ${rep.vitals.lcpMs}ms · forced layouts ${rep.totals.forcedLayoutCount}`,
    );
  } else {
    const range = (key, unit) => {
      const sp = result.spread[key];
      return sp && sp.min !== sp.max ? ` (${fmt(unit, sp.min)}–${fmt(unit, sp.max)})` : '';
    };
    log(`\n${reports.length} runs — medians:`);
    log(
      `TBT ${fmt('ms', s.tbtMs)}${range('tbtMs', 'ms')} · LCP ${fmt('ms', s.lcpMs)}${range('lcpMs', 'ms')} · FCP ${fmt('ms', s.fcpMs)}${range('fcpMs', 'ms')} · CLS ${s.cls ?? '—'} · long tasks ${s.longTaskCount ?? '—'} · forced layouts ${s.forcedLayoutCount ?? '—'}`,
    );
    result.runs.forEach((r, i) =>
      log(`  run ${i + 1}  ${r.id}  TBT ${fmt('ms', r.summary.tbtMs)} · LCP ${fmt('ms', r.summary.lcpMs)} · scripting ${fmt('ms', r.summary.scriptingMs)}`),
    );
  }
  log(
    reports.length > 1
      ? `\nCulprits (from ${rep.id}, the most typical run):`
      : '\nCulprits:',
  );
  for (const f of result.findings.slice(0, 15)) {
    const seen = f.seenIn != null ? `  [seen in ${f.seenIn}/${reports.length} runs]` : '';
    log(` [${f.severity}] (${f.category}) ${f.title}${seen}`);
    for (const c of f.culprits)
      log(`      ↳ ${c.fn}()  ${c.file || 'unknown'}${lineRef(c)}${c.ms ? `  ${c.ms}ms` : ''}${c.note ? `  (${c.note})` : ''}`);
  }
}

const session = new PerfSession();
const reports = [];
let code = EXIT.OK;
try {
  await session.connect({ mode: 'launch', url, headless: !flag('headed'), signIn: opt('sign-in') });
  await sleep(1500);
  await session.reload(); // make sure the probe was installed before the app loaded
  await sleep(1000);
  for (let i = 0; i < runs; i++) {
    if (runs > 1) console.error(`spectra: run ${i + 1}/${runs} …`);
    reports.push(await recordOnce(session, i));
    if (i < runs - 1) await sleep(500);
  }
} catch (err) {
  console.error(`spectra: ${err.message}`);
  code = EXIT.ERROR;
} finally {
  await session.disconnect();
}

if (code === EXIT.OK) {
  const result = buildProfileResult({
    reports,
    fileOf: reportFile,
    target: TARGET_NAME,
    spectraVersion: SPECTRA_VERSION,
    budgets: config.budgets,
  });
  printProfile(result, reports);
  printBudgets(result.budgets, log);
  if (result.budgets && !result.budgets.ok) code = EXIT.CHECKS_FAILED;
  writeResult(result, { json, out });

  // When launched by the installed CLI the bin sets PERF_REPORTS_DIR; in a dev
  // checkout it is unset. Tailor the "how to view it" hint to each.
  const installed = !!process.env.PERF_REPORTS_DIR;
  const saved = reports.length === 1 ? `${reportFile(reports[0].id)}` : `${reports.length} reports in ${REPORTS_DIR}`;
  log(`\nSaved ${saved} — view with: ${installed ? 'spectra dashboard' : 'npm run dev'}`);
  if (out) log(`Result written to ${path.resolve(out)}`);
}
exitAfterFlush(code);
