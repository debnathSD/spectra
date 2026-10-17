// Pure logic for the extension: turns Spectra results and reports into
// problems, CodeLens and status-bar text. No `vscode` import, so it can be
// unit-tested with plain node (test/model.test.js).
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const formatMs = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v >= 10 || v === 0) return `${Math.round(v)} ms`;
  return `${v.toFixed(1)} ms`;
};
const formatCount = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));

/** Spectra severities on VS Code's scale: perf problems are warnings, not errors. */
const SEVERITY = { critical: 'warning', warning: 'information', info: 'hint' };

/**
 * Where a culprit's file is in the workspace: its absolute path when that is
 * inside the workspace, otherwise its project-relative path. null when the
 * file isn't there (library code, a bundle, another machine).
 */
function makeResolver(workspaceDir, exists = fs.existsSync) {
  return ({ abs, file }) => {
    const inside = p => {
      const rel = path.relative(workspaceDir, p);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    };
    if (abs && inside(abs) && exists(abs)) return abs;
    if (file && !/^(https?:|node_modules[\\/]|bundle:)/.test(file)) {
      const p = path.join(workspaceDir, file);
      if (exists(p)) return p;
    }
    return null;
  };
}

/**
 * One problem per (finding, culprit location). `context` names the journey a
 * finding came from, for golden-path runs.
 */
function diagnosticsFrom(findings, resolve, context = '') {
  const out = [];
  const seen = new Set();
  for (const f of findings || []) {
    const culprits = f.culprits && f.culprits.length ? f.culprits : [{ file: f.file, line: f.line }];
    for (const c of culprits) {
      const file = resolve(c);
      if (!file) continue;
      const line = Math.max(0, (c.line || 1) - 1);
      const key = `${f.id}|${file}|${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cost = c.ms != null ? ` (${formatMs(c.ms)})` : '';
      out.push({
        file,
        line,
        severity: SEVERITY[f.severity] || 'information',
        message: `${f.title}${cost}${context ? ` — in ${context}` : ''}${f.fix ? `\nFix: ${f.fix}` : ''}`,
        code: f.category || 'performance',
        approximate: c.lineKind === 'located',
      });
    }
  }
  return out;
}

/** CodeLens above the components and functions that cost the most. */
function lensesFrom(report, resolve, { limit = 40, minMs = 1 } = {}) {
  const out = [];
  if (!report) return out;
  const components = ((report.react && report.react.components) || [])
    .filter(c => c.selfMs >= minMs || c.wasted > 0)
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, limit);
  for (const c of components) {
    const file = resolve(c);
    if (!file || !c.line) continue;
    const wasted = c.wasted ? ` · ${formatCount(c.wasted)} wasted` : '';
    out.push({
      file,
      line: c.line - 1,
      title: `⚡ Spectra: ${c.name} · ${formatCount(c.renders)} renders · ${formatMs(c.selfMs)} rendering${wasted}`,
      tooltip: `Self render time ${formatMs(c.selfMs)}, slowest render ${formatMs(c.maxMs)}, from report ${report.id}`,
    });
  }
  const taken = new Set(out.map(l => `${l.file}:${l.line}`));
  for (const f of (report.hotFunctions || []).filter(f => !f.vendor && f.selfMs >= minMs).slice(0, limit)) {
    const file = resolve(f);
    if (!file || !f.line || taken.has(`${file}:${f.line - 1}`)) continue;
    const share = f.share != null ? ` (${Math.round(f.share)}% of CPU)` : ''; // share is already a percentage
    out.push({
      file,
      line: f.line - 1,
      title: `⚡ Spectra: ${f.name}() · ${formatMs(f.selfMs)} own time${share}`,
      tooltip: `${formatMs(f.totalMs)} including what it calls, from report ${report.id}`,
    });
  }
  return out;
}

function headline(s) {
  return `TBT ${formatMs(s.tbtMs)} · LCP ${formatMs(s.lcpMs)} · scripting ${formatMs(s.scriptingMs)}`;
}

/** Status-bar text and tooltip for a profile or golden-path result. */
function statusFrom(result) {
  if (!result) return { text: '$(pulse) Spectra', tooltip: 'Profile the page load with Spectra', warn: false };
  const over = result.budgets && !result.budgets.ok;
  if (result.kind === 'evaluation') {
    return {
      text: `$(pulse) ${result.passed}/${result.total} journeys${over ? ' $(warning)' : ''}`,
      tooltip: `Spectra golden paths on ${result.url}\n${result.passed} of ${result.total} journeys passed${over ? `\n${result.budgets.failed} budget checks over` : ''}`,
      warn: over,
    };
  }
  const s = result.summary;
  const top = result.findings && result.findings[0];
  return {
    text: `$(pulse) ${headline(s)}${over ? ' $(warning)' : ''}`,
    tooltip: [
      `Spectra · ${result.url} · ${result.runs.length} run${result.runs.length === 1 ? '' : 's'} (medians)`,
      `TBT ${formatMs(s.tbtMs)} · LCP ${formatMs(s.lcpMs)} · FCP ${formatMs(s.fcpMs)} · CLS ${s.cls ?? '—'}`,
      `Scripting ${formatMs(s.scriptingMs)} · long tasks ${formatCount(s.longTaskCount)} · ${formatCount(s.findingCount)} findings`,
      over ? `${result.budgets.failed} over budget` : '',
      top ? `Top: [${top.severity}] ${top.title}` : '',
      'Click to profile again',
    ]
      .filter(Boolean)
      .join('\n'),
    warn: over,
  };
}

const VERDICT = {
  improved: 'Improved',
  regressed: 'Regressed',
  mixed: 'Mixed: some better, some worse',
  neutral: 'No significant change',
};

/** A one-line verdict for a notification, and the full text for the output channel. */
function compareText(c) {
  const lead = c.headlines.find(h => h.kind === (c.verdict === 'regressed' ? 'degraded' : 'improved')) || c.headlines[0];
  const short = `Spectra: ${VERDICT[c.verdict] || c.verdict}${lead ? ` — ${lead.text}` : ''} (confidence: ${c.confidence})`;
  const moved = c.metrics.filter(m => m.verdict === 'improved' || m.verdict === 'degraded');
  const lines = [
    `Verdict: ${VERDICT[c.verdict] || c.verdict} (confidence ${c.confidence}; ${c.before.runs.length} runs before, ${c.after.runs.length} after)`,
    ...c.headlines.map(h => `  ${h.kind === 'improved' ? '✓' : '✗'} ${h.text}`),
    moved.length ? 'Metrics beyond the run-to-run noise:' : 'No metric moved beyond the run-to-run noise.',
    ...moved.map(m => `  ${m.verdict === 'improved' ? '✓' : '✗'} ${m.label}: ${m.unit === 'ms' ? formatMs(m.before.value) : m.before.value} → ${m.unit === 'ms' ? formatMs(m.after.value) : m.after.value}`),
    `Findings: ${c.findings.resolved.length} resolved, ${c.findings.added.length} new, ${c.findings.persisting.length} still present`,
    ...c.findings.resolved.map(f => `  resolved  [${f.severity}] ${f.title}`),
    ...c.findings.added.map(f => `  new       [${f.severity}] ${f.title}`),
    ...c.checks.filter(x => x.level === 'warn' || x.level === 'bad').map(x => `  ! ${x.title}${x.detail ? ` — ${x.detail}` : ''}`),
  ];
  return { short, lines, good: c.verdict === 'improved', bad: c.verdict === 'regressed' || c.verdict === 'mixed' };
}

/** The newest result file in .spectra/results, if any. */
function latestResultFile(workspaceDir) {
  const dir = path.join(workspaceDir, '.spectra', 'results');
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Everything the editor shows for one result file: problems and lenses (from
 * the most typical run, or every journey), and the status bar.
 */
function viewOf(resultFile, workspaceDir, exists) {
  const result = readJson(resultFile);
  const resolve = makeResolver(workspaceDir, exists);
  const loadReport = file => {
    try {
      return file && fs.existsSync(file) ? readJson(file) : null;
    } catch {
      return null;
    }
  };
  let diagnostics = [];
  let lenses = [];
  if (result.kind === 'profile') {
    diagnostics = diagnosticsFrom(result.findings, resolve);
    const rep = result.runs.find(r => r.id === result.representativeRunId) || result.runs[result.runs.length - 1];
    lenses = lensesFrom(loadReport(rep && rep.file), resolve);
  } else if (result.kind === 'evaluation') {
    for (const j of result.journeys) {
      const report = loadReport(j.reportFile);
      diagnostics.push(...diagnosticsFrom(report ? report.findings : j.findings, resolve, j.title));
      if (j.kind === 'load') lenses = lensesFrom(report, resolve);
    }
  }
  return { result, diagnostics, lenses, status: statusFrom(result) };
}

/** Minimum Spectra version the extension needs (--json, --quick, compare). */
const MIN_VERSION = '0.2.0';
const atLeast = (v, min) => {
  const a = String(v).split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
};

module.exports = {
  formatMs,
  formatCount,
  makeResolver,
  diagnosticsFrom,
  lensesFrom,
  statusFrom,
  compareText,
  latestResultFile,
  viewOf,
  readJson,
  MIN_VERSION,
  atLeast,
};
