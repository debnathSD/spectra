/**
 * "Snapshots" are profiler reports exported for comparison. This module knows how
 * to name them (the commit hash goes in the file name so they are recognisable
 * once downloaded), check that an uploaded file really is one, and recover the
 * commit from a file name when the report itself carries no git information.
 */

/** @returns {{ok: true} | {ok: false, reason: string}} */
export function validateReport(obj) {
  if (obj && (Array.isArray(obj) || Array.isArray(obj.traceEvents))) {
    return {
      ok: false,
      reason:
        'This is a raw Chrome trace (.trace.json). Comparison needs the profiler report: use “Snapshot for comparison” on the report instead — the trace lacks the React and source-file data.',
    };
  }
  const ok =
    obj &&
    typeof obj === 'object' &&
    obj.meta &&
    obj.vitals &&
    obj.totals &&
    obj.memory &&
    obj.network &&
    Array.isArray(obj.files) &&
    Array.isArray(obj.findings);
  return ok
    ? { ok: true }
    : { ok: false, reason: 'This file is not a performance-profiler report.' };
}

/**
 * Commit hash from a file name such as `perf_3fa516c_load_20260930-1548.json`.
 * The segment right after the `perf_` prefix wins; otherwise the first hex-looking
 * token that contains a letter (so plain dates like 20260930 are never mistaken for a hash).
 */
export function hashFromFileName(name) {
  const base = String(name || '').replace(/\.json$/i, '');
  const prefixed = /^perf[_-]([0-9a-f]{7,40})(?:[_-]|$)/i.exec(base);
  if (prefixed) return prefixed[1].toLowerCase();
  const token = base
    .split(/[^0-9a-zA-Z]+/)
    .find(t => /^[0-9a-f]{7,40}$/i.test(t) && /[a-f]/i.test(t));
  return token ? token.toLowerCase() : '';
}

const slug = text =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function snapshotFileName(report, git, label) {
  const hash = (git?.shortHash || git?.hash || '').slice(0, 10) || 'nocommit';
  const stamp = String(report.createdAt || '')
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')
    .slice(0, 15); // yyyymmdd-hhmmss: two runs a few seconds apart must not share a name
  const parts = ['perf', hash, report.meta.mode, stamp, slug(label)].filter(
    Boolean,
  );
  return `${parts.join('_')}.json`;
}

/** The report with the commit and an optional label recorded in `meta`. */
export function withCommit(report, git, label) {
  return {
    ...report,
    meta: {
      ...report.meta,
      git: git || report.meta.git || null,
      label: label || report.meta.label || '',
    },
  };
}
