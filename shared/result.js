/**
 * The machine-readable side of Spectra: what `--json` prints, what `--out`
 * writes, and what editor / CI / AI integrations consume.
 *
 * Pure functions, no I/O. A "result" is a small, versioned envelope that
 * points at the full reports on disk instead of embedding them:
 *
 *   kind 'profile'     one or more page-load / live recordings of one page,
 *                      reduced to a median summary plus the findings
 *   kind 'evaluation'  the golden-path suite: one summary per journey
 *   kind 'compare'     before vs after, judged against run-to-run noise
 *
 * Every summary metric is "lower is better", which is what budgets assume.
 */
import { compareSides, findingKey, median } from './compare.js';

/** Bumped on breaking changes to the saved report format. */
export const REPORT_SCHEMA_VERSION = 1;
/** Bumped on breaking changes to the result envelopes below. */
export const RESULT_SCHEMA_VERSION = 1;

const finite = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 1) => (finite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// ------------------------------------------------------------------ summaries

/**
 * The headline numbers budgets and summaries are built from. `get` reads a
 * full report; every entry is lower-is-better.
 */
export const SUMMARY_METRICS = [
  { key: 'tbtMs', label: 'Total blocking time', unit: 'ms', get: r => r.vitals?.tbtMs },
  { key: 'lcpMs', label: 'Largest contentful paint', unit: 'ms', get: r => r.vitals?.lcpMs },
  { key: 'fcpMs', label: 'First contentful paint', unit: 'ms', get: r => r.vitals?.fcpMs },
  { key: 'cls', label: 'Cumulative layout shift', unit: 'score', digits: 3, get: r => r.vitals?.cls },
  { key: 'inpMs', label: 'Interaction to next paint', unit: 'ms', get: r => r.vitals?.inpMs },
  { key: 'ttfbMs', label: 'Time to first byte', unit: 'ms', get: r => r.vitals?.ttfbMs },
  { key: 'longTaskCount', label: 'Long tasks', unit: 'count', get: r => r.vitals?.longTaskCount },
  { key: 'maxLongTaskMs', label: 'Longest task', unit: 'ms', get: r => r.vitals?.maxLongTaskMs },
  { key: 'scriptingMs', label: 'Scripting time', unit: 'ms', get: r => r.totals?.scriptingMs },
  { key: 'forcedLayoutCount', label: 'Forced layouts', unit: 'count', get: r => r.totals?.forcedLayoutCount },
  { key: 'domNodes', label: 'DOM nodes', unit: 'count', get: r => r.memory?.domNodes },
  { key: 'heapUsedMb', label: 'JS heap used', unit: 'MB', get: r => r.memory?.heapUsedMb },
  {
    key: 'transferKb',
    label: 'Transferred',
    unit: 'KB',
    get: r => (finite(r.network?.totalEncoded) ? r.network.totalEncoded / 1024 : null),
  },
  {
    key: 'criticalFindings',
    label: 'Critical findings',
    unit: 'count',
    get: r => (Array.isArray(r.findings) ? r.findings.filter(f => f.severity === 'critical').length : null),
  },
  {
    key: 'findingCount',
    label: 'Findings',
    unit: 'count',
    get: r => (Array.isArray(r.findings) ? r.findings.length : null),
  },
];

const metricDef = key => SUMMARY_METRICS.find(m => m.key === key);
const valueOf = (def, r) => {
  const v = def.get(r);
  return finite(v) ? v : null;
};

/** Headline numbers of one report; null where the recording has no value. */
export function summarize(report) {
  const out = {};
  for (const def of SUMMARY_METRICS) out[def.key] = round(valueOf(def, report), def.digits ?? 1);
  return out;
}

/**
 * Median of each headline number across runs, plus the min / max spread
 * (only when there is more than one run, so the spread means something).
 */
export function summarizeRuns(reports) {
  const summary = { runs: reports.length };
  const spread = {};
  for (const def of SUMMARY_METRICS) {
    const values = reports.map(r => valueOf(def, r)).filter(finite);
    summary[def.key] = values.length ? round(median(values), def.digits ?? 1) : null;
    if (reports.length > 1 && values.length > 1) {
      spread[def.key] = {
        min: round(Math.min(...values), def.digits ?? 1),
        max: round(Math.max(...values), def.digits ?? 1),
      };
    }
  }
  return { summary, spread };
}

/**
 * The run that best stands for the set: closest to the median on main-thread
 * cost. Its findings are the ones reported, so they match the summary.
 */
export function representativeRun(reports) {
  if (reports.length <= 2) return reports[reports.length - 1] || null;
  const keys = ['tbtMs', 'scriptingMs', 'lcpMs'];
  const medians = Object.fromEntries(
    keys.map(k => [k, median(reports.map(r => valueOf(metricDef(k), r)).filter(finite))]),
  );
  let best = null;
  let bestScore = Infinity;
  for (const r of reports) {
    let score = 0;
    for (const k of keys) {
      const v = valueOf(metricDef(k), r);
      const m = medians[k];
      if (finite(v) && finite(m)) score += Math.abs(v - m) / Math.max(Math.abs(m), 1);
    }
    if (score < bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** A finding trimmed to what a reader (or an agent) acts on. */
export function briefFinding(f) {
  const top = (f.culprits || [])[0];
  return {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: f.title,
    detail: f.detail || '',
    impactMs: round(f.impactMs || 0),
    file: f.file || top?.file || null,
    line: top?.line ?? null,
    fix: f.fix || '',
    culprits: (f.culprits || []).slice(0, 5).map(c => ({
      fn: c.fn,
      file: c.file || null,
      line: c.line ?? null,
      lineKind: c.lineKind || null,
      abs: c.abs || null,
      ms: round(c.ms),
      note: c.note || '',
    })),
  };
}

// ------------------------------------------------------------------ budgets

export const BUDGET_KEYS = SUMMARY_METRICS.map(m => m.key);

/**
 * Validates a `budgets` object from spectra.config.json.
 * @returns {{ok: true, budgets: object} | {ok: false, error: string}}
 */
export function validateBudgets(budgets) {
  if (budgets == null) return { ok: true, budgets: {} };
  if (typeof budgets !== 'object' || Array.isArray(budgets))
    return { ok: false, error: '"budgets" must be an object such as { "tbtMs": 200 }.' };
  for (const [key, limit] of Object.entries(budgets)) {
    if (!BUDGET_KEYS.includes(key))
      return { ok: false, error: `Unknown budget "${key}". Known budgets: ${BUDGET_KEYS.join(', ')}.` };
    if (!finite(limit) || limit < 0)
      return { ok: false, error: `Budget "${key}" must be a number ≥ 0 (got ${JSON.stringify(limit)}).` };
  }
  return { ok: true, budgets };
}

/**
 * Checks budgets (upper limits) against one or more measured summaries, e.g.
 * the median of a profile, or every journey of an evaluation. A metric the
 * recording did not measure is reported as skipped, never as a failure.
 * @param {object} budgets           { tbtMs: 200, ... } (already validated)
 * @param {{name: string, summary: object}[]} items
 */
export function checkBudgets(budgets, items) {
  const entries = Object.entries(budgets || {});
  if (!entries.length) return null;
  const checks = [];
  for (const [key, limit] of entries) {
    const def = metricDef(key);
    for (const item of items) {
      const value = item.summary?.[key];
      checks.push({
        key,
        label: def.label,
        unit: def.unit,
        limit,
        value: finite(value) ? value : null,
        where: item.name,
        status: !finite(value) ? 'skipped' : value <= limit ? 'pass' : 'fail',
      });
    }
  }
  const failed = checks.filter(c => c.status === 'fail');
  return { ok: failed.length === 0, failed: failed.length, checks };
}

// ------------------------------------------------------------------ envelopes

const envelope = (kind, spectraVersion) => ({
  schemaVersion: RESULT_SCHEMA_VERSION,
  kind,
  spectraVersion: spectraVersion || null,
  createdAt: new Date().toISOString(),
});

/**
 * @param {object} o
 * @param {object[]} o.reports        full reports, in run order
 * @param {(id: string) => string} o.fileOf   where each report is saved
 */
export function buildProfileResult({ reports, fileOf, target, spectraVersion, budgets }) {
  const first = reports[0];
  const { summary, spread } = summarizeRuns(reports);
  const rep = representativeRun(reports);
  const keysPerRun = reports.map(r => new Set((r.findings || []).map(findingKey)));
  const findings = (rep?.findings || []).map(f => {
    const brief = briefFinding(f);
    if (reports.length > 1) brief.seenIn = keysPerRun.filter(s => s.has(findingKey(f))).length;
    return brief;
  });
  return {
    ...envelope('profile', spectraVersion),
    target: target || null,
    url: first?.meta?.url || null,
    mode: first?.meta?.mode || null,
    cpuThrottle: first?.meta?.cpuThrottle || 1,
    git: first?.meta?.git || null,
    runs: reports.map(r => ({ id: r.id, file: fileOf ? fileOf(r.id) : null, summary: summarize(r) })),
    representativeRunId: rep?.id || null,
    summary,
    spread,
    findings,
    budgets: checkBudgets(budgets, [{ name: 'median', summary }]),
  };
}

/**
 * @param {object} o
 * @param {object} o.evaluation   the object runEvaluation() returns
 * @param {(id: string) => object|null} o.readReport
 */
export function buildEvaluationResult({ evaluation, readReport, fileOf, file, spectraVersion, budgets }) {
  const journey = j => {
    const report = j.id ? readReport(j.id) : null;
    return {
      title: j.title,
      kind: j.kind,
      ok: j.ok,
      error: j.error || null,
      reportId: j.id || null,
      reportFile: j.id && fileOf ? fileOf(j.id) : null,
      summary: report ? summarize(report) : null,
      findings: report ? (report.findings || []).slice(0, 5).map(briefFinding) : [],
    };
  };
  const journeys = [journey(evaluation.baseline), ...evaluation.paths.map(journey)];
  return {
    ...envelope('evaluation', spectraVersion),
    target: evaluation.target || null,
    url: evaluation.url,
    file: file || null,
    discovered: evaluation.discovered,
    skippedDestructive: evaluation.skippedDestructive || [],
    passed: evaluation.paths.filter(p => p.ok).length,
    total: evaluation.paths.length,
    journeys,
    budgets: checkBudgets(
      budgets,
      journeys.filter(j => j.summary).map(j => ({ name: j.title, summary: j.summary })),
    ),
  };
}

/** Before vs after; the comparison itself is shared/compare.js (COMPARE_VERSION). */
export function buildCompareResult({ before, after, spectraVersion }) {
  const comparison = compareSides({ runs: before }, { runs: after });
  if (!comparison) return null;
  return { ...envelope('compare', spectraVersion), comparison };
}

/** The saved reports, newest first (rows from recorder.listReports()). */
export function buildReportsResult({ reports, dir, spectraVersion }) {
  return { ...envelope('reports', spectraVersion), dir: dir || null, reports };
}

/** A compare counts as a regression when any key metric got worse. */
export const isRegression = result =>
  ['regressed', 'mixed'].includes(result?.comparison?.verdict);
