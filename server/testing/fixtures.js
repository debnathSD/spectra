// Synthetic reports and throwaway project folders for the tests. Not a test
// file itself (only server/**/test-*.js run), so it can be imported freely.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPORT_SCHEMA_VERSION } from '../../shared/result.js';

export const finding = (over = {}) => ({
  id: 'slow-component-Row-src/Row.jsx',
  severity: 'critical',
  category: 'React',
  title: 'Row is slow to render',
  detail: 'src/Row.jsx:3.',
  impactMs: 1442.94,
  file: 'src/Row.jsx',
  fix: 'Memoise it.',
  culprits: [{ fn: 'Row', file: 'src/Row.jsx', line: 3, lineKind: 'exact', abs: '/p/src/Row.jsx', ms: 1442.94, note: 'slow render' }],
  ...over,
});

/** A report with just enough in it for summaries, budgets and compare. */
export function report(id, { tbt = 0, lcp = 100, scripting = 1000, findings = [finding()] } = {}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    id,
    createdAt: '2026-10-17T10:00:00.000Z',
    meta: { url: 'http://localhost:5188/', title: 'Demo', mode: 'load', durationMs: 4000, cpuThrottle: 1, attribution: 'sourcemap', git: null, label: '' },
    vitals: { tbtMs: tbt, lcpMs: lcp, fcpMs: lcp, cls: 0.0015, inpMs: null, ttfbMs: 2.4, longTaskCount: 0, maxLongTaskMs: 0 },
    totals: { activeMs: scripting + 100, scriptingMs: scripting, layoutMs: 10, styleMs: 10, paintMs: 5, gcMs: 5, compileMs: 5, layoutCount: 4, styleRecalcCount: 4, forcedLayoutCount: 0, forcedStyleCount: 0, forcedMs: 0 },
    memory: { domNodes: 800, listeners: 20, heapUsedMb: 9.4, heapGrowthMb: 0 },
    network: { count: 10, totalEncoded: 2048 * 1024 },
    react: { detected: true, hasTimings: true, version: '18.3.1', components: [], commits: { count: 60, totalMs: 100, maxMs: 10 } },
    files: [],
    findings,
  };
}

/** A project folder with four saved reports: two slow (before), two fast (after). */
export function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-cli-'));
  const reports = path.join(dir, '.spectra', 'reports');
  fs.mkdirSync(reports, { recursive: true });
  const save = r => fs.writeFileSync(path.join(reports, `${r.id}.json`), JSON.stringify(r));
  save(report('20261017T100000-load', { scripting: 1500 }));
  save(report('20261017T100010-load', { scripting: 1510 }));
  save(report('20261017T100100-load', { scripting: 90, findings: [] }));
  save(report('20261017T100110-load', { scripting: 92, findings: [] }));
  return { dir, reports };
}
