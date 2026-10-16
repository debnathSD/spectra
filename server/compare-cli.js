/**
 * spectra compare <before> <after> [--json] [--out file.json] [--fail-on-regression]
 *
 * Each side is any of:
 *   - a report id from .spectra/reports        20261017T101500-load
 *   - a report file                            ./perf_3fa516c_load.json
 *   - a result file from `spectra performance --out` (all of its runs)
 *   - several of the above joined by commas    id1,id2,id3
 *
 * Several runs per side are reduced to their median and a change only counts
 * when it is bigger than the noise between runs (shared/compare.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readReport } from './recorder.js';
import { REPORTS_DIR } from './config.js';
import { parseArgs } from './args.js';
import { EXIT, SPECTRA_VERSION, exitAfterFlush, writeResult } from './output.js';
import { buildCompareResult, isRegression } from '../shared/result.js';
import { validateReport } from '../shared/snapshot.js';
import { formatPct, formatValue } from '../shared/compare.js';

const { opt, flag, positionals } = parseArgs(process.argv.slice(2), { values: ['out'] });
const json = flag('json');
const out = opt('out');
const log = json ? console.error : console.log;

if (flag('help') || positionals.length !== 2) {
  console.error('usage: spectra compare <before> <after> [--json] [--out file.json] [--fail-on-regression]');
  console.error('  each side: a report id, a report file, a `spectra performance --out` result file, or id1,id2,…');
  process.exit(flag('help') ? EXIT.OK : EXIT.ERROR);
}

const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}).`);
  }
};

/** The runs a result file points at: its recorded path, the reports dir, or next to the result. */
function loadRun(run, dir) {
  const candidates = [run.file, path.join(REPORTS_DIR, `${run.id}.json`), path.join(dir, `${run.id}.json`)];
  const found = candidates.find(f => f && fs.existsSync(f));
  if (!found) throw new Error(`report ${run.id} (listed in the result file) was not found; it was saved to ${run.file}.`);
  return readJson(found);
}

function loadToken(token) {
  const file = path.resolve(token);
  if (fs.existsSync(file) || token.endsWith('.json')) {
    if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
    const obj = readJson(file);
    if (obj?.schemaVersion && obj.kind === 'profile') return obj.runs.map(run => loadRun(run, path.dirname(file)));
    if (obj?.kind === 'evaluation')
      throw new Error(
        `${token} is a golden-path evaluation. Compare single-page profiles instead: run "spectra performance --quick --runs 5 --out before.json" (and again for after), or compare two journey reports by id.`,
      );
    if (obj?.kind) throw new Error(`${token} is a "${obj.kind}" result, not a profile.`);
    const valid = validateReport(obj);
    if (!valid.ok) throw new Error(`${token}: ${valid.reason}`);
    return [obj];
  }
  const report = readReport(token);
  if (!report) throw new Error(`no report "${token}" in ${REPORTS_DIR}. List them with: spectra reports`);
  return [report];
}

const loadSide = arg =>
  arg
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .flatMap(loadToken);

let result;
try {
  const before = loadSide(positionals[0]);
  const after = loadSide(positionals[1]);
  result = buildCompareResult({ before, after, spectraVersion: SPECTRA_VERSION });
  if (!result) throw new Error('nothing to compare.');
} catch (err) {
  console.error(`spectra: ${err.message}`);
  process.exit(EXIT.ERROR);
}

const VERDICT = {
  improved: 'IMPROVED',
  regressed: 'REGRESSED',
  mixed: 'MIXED (some better, some worse)',
  neutral: 'NO SIGNIFICANT CHANGE',
};
const sideLine = side => {
  const commit = side.git?.shortHash || side.runs.find(r => r.commit)?.commit;
  return `${side.runs.length} run${side.runs.length === 1 ? '' : 's'}${commit ? ` · commit ${commit}` : ''}${side.label ? ` · ${side.label}` : ''}`;
};

const c = result.comparison;
log(`\nSpectra compare — ${VERDICT[c.verdict] || c.verdict} (confidence: ${c.confidence})`);
log(`Before: ${sideLine(c.before)}`);
log(`After:  ${sideLine(c.after)}`);
if (c.headlines.length) {
  log('');
  for (const h of c.headlines) log(`  ${h.kind === 'improved' ? '✓' : '✗'} ${h.text}`);
}
log(`\n${'Key metric'.padEnd(28)}${'Before'.padStart(11)}${'After'.padStart(11)}${'Change'.padStart(9)}  Verdict`);
for (const m of c.metrics.filter(x => x.key)) {
  log(
    `${m.label.padEnd(28)}${formatValue(m.unit, m.before.value).padStart(11)}${formatValue(m.unit, m.after.value).padStart(11)}${(m.verdict === 'n/a' ? '' : formatPct(m.pct)).padStart(9)}  ${m.verdict}`,
  );
}
log(`(${c.counts.improved} improved · ${c.counts.degraded} worse · ${c.counts.same} within noise across all ${c.metrics.length} metrics)`);
const { added, resolved, persisting } = c.findings;
log(`\nFindings: ${resolved.length} resolved · ${added.length} new · ${persisting.length} still present`);
for (const f of resolved.slice(0, 8)) log(`  resolved  [${f.severity}] ${f.title}`);
for (const f of added.slice(0, 8)) log(`  new       [${f.severity}] ${f.title}`);
const concerns = c.checks.filter(x => x.level === 'warn' || x.level === 'bad');
if (concerns.length) {
  log('\nComparability:');
  for (const x of concerns) log(`  ! ${x.title}${x.detail ? ` — ${x.detail}` : ''}`);
}

writeResult(result, { json, out });
if (out) log(`\nResult written to ${path.resolve(out)}`);
exitAfterFlush(flag('fail-on-regression') && isRegression(result) ? EXIT.CHECKS_FAILED : EXIT.OK);
