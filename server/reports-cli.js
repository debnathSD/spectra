/**
 * spectra reports [--json] [--limit n] — the saved reports, newest first, so
 * their ids can be passed to `spectra compare` or opened in the dashboard.
 */
import { listReports } from './recorder.js';
import { REPORTS_DIR } from './config.js';
import { intOption, parseArgs } from './args.js';
import { EXIT, SPECTRA_VERSION, exitAfterFlush, writeResult } from './output.js';
import { buildReportsResult } from '../shared/result.js';

const { opt, flag } = parseArgs(process.argv.slice(2));
let limit;
try {
  limit = intOption(opt('limit'), 'limit', { max: 10_000, fallback: 20 });
} catch (err) {
  console.error(`spectra: ${err.message}`);
  process.exit(EXIT.ERROR);
}

const reports = listReports().slice(0, limit);
if (flag('json')) {
  writeResult(buildReportsResult({ reports, dir: REPORTS_DIR, spectraVersion: SPECTRA_VERSION }), { json: true });
} else if (!reports.length) {
  console.log(`No reports yet in ${REPORTS_DIR}. Create one with: spectra performance --quick`);
} else {
  console.log(`${'Report id'.padEnd(26)}${'Mode'.padEnd(7)}${'Findings'.padStart(9)}${'Critical'.padStart(10)}  URL`);
  for (const r of reports)
    console.log(`${r.id.padEnd(26)}${String(r.mode).padEnd(7)}${String(r.findings).padStart(9)}${String(r.critical).padStart(10)}  ${r.url}`);
  console.log(`\n${reports.length} shown · ${REPORTS_DIR}`);
}
exitAfterFlush(EXIT.OK);
