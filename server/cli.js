/**
 * Headless / scripted profiling:
 *
 *   npm run profile -- --url http://localhost:3000/ --mode load
 *   npm run profile -- --url http://localhost:5188/ --duration 8 --throttle 4
 *   npm run profile -- --url ... --scenario ./scenario.mjs   # export default async page => {…}
 *
 * The report is saved in reports/ and can be opened in the UI (npm run dev).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PerfSession, readReport } from './recorder.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const flag = name => args.includes(`--${name}`);

const url = opt('url');
if (!url || flag('help')) {
  console.log(
    'usage: npm run profile -- --url <page> [--mode live|load] [--duration seconds] [--throttle 4] [--scenario file.mjs] [--headed] [--save-trace] [--sign-in "http://host/login/?redirect={url}"]',
  );
  process.exit(url ? 0 : 1);
}
const mode = opt('mode', 'live');
const duration = Number(opt('duration', 8)) * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const session = new PerfSession();
try {
  await session.connect({
    mode: 'launch',
    url,
    headless: !flag('headed'),
    signIn: opt('sign-in'),
  });
  await sleep(1500);
  await session.reload(); // make sure the probe was installed before the app loaded
  await sleep(1000);
  await session.start({
    mode,
    cpuThrottle: Number(opt('throttle', 1)),
    saveTrace: flag('save-trace'),
  });
  let report;
  if (mode === 'live') {
    const scenario = opt('scenario');
    if (scenario) {
      const mod = await import(pathToFileURL(path.resolve(scenario)).href);
      await mod.default(session.page);
    } else await sleep(duration);
    report = await session.stop();
  } else {
    // Page-load recordings stop themselves shortly after the load event.
    const id = await new Promise((resolve, reject) => {
      session.once('report', r => resolve(r.id));
      session.on('state', s => s.error && reject(new Error(s.error)));
    });
    report = readReport(id);
  }
  console.log(
    `\nReport ${report.id} (${report.meta.attribution}, ${report.meta.sampleCount} samples)`,
  );
  console.log(
    `TBT ${report.vitals.tbtMs}ms · long tasks ${report.vitals.longTaskCount} · CLS ${report.vitals.cls} · FCP ${report.vitals.fcpMs}ms · LCP ${report.vitals.lcpMs}ms · forced layouts ${report.totals.forcedLayoutCount}`,
  );
  console.log('\nCulprits:');
  for (const f of report.findings.slice(0, 15)) {
    console.log(` [${f.severity}] (${f.category}) ${f.title}`);
    for (const c of f.culprits) {
      const line = c.line
        ? `:${c.lineKind === 'located' ? '≈' : ''}${c.line}`
        : '';
      console.log(
        `      ↳ ${c.fn}()  ${c.file || 'unknown'}${line}${c.ms ? `  ${c.ms}ms` : ''}${c.note ? `  (${c.note})` : ''}`,
      );
    }
  }
  console.log(`\nSaved reports/${report.id}.json — open it with: npm run dev`);
} finally {
  await session.disconnect();
}
process.exit(0);
