/**
 * The Markdown the GitHub Action writes to the job summary and the pull
 * request comment. Pure functions over Spectra's --json results.
 */

export const MARKER = '<!-- spectra-performance -->';

const ms = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v >= 10 || v === 0) return `${Math.round(v)} ms`;
  return `${v.toFixed(1)} ms`;
};
const count = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const esc = s => String(s ?? '').replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ');
const where = f => (f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '—');
const byUnit = (unit, v) => (unit === 'ms' ? ms(v) : unit === 'KB' ? `${count(v)} KB` : unit === 'MB' ? `${v} MB` : unit === 'count' ? count(v) : String(v));
const SEV = { critical: '🔴 critical', warning: '🟠 warning', info: '🔵 note' };

const ROWS = [
  ['Total blocking time', 'tbtMs', ms],
  ['Largest contentful paint', 'lcpMs', ms],
  ['First contentful paint', 'fcpMs', ms],
  ['Cumulative layout shift', 'cls', v => (v == null ? '—' : String(v))],
  ['Long tasks', 'longTaskCount', count],
  ['Scripting time', 'scriptingMs', ms],
  ['DOM nodes', 'domNodes', count],
  ['Transferred', 'transferKb', v => (v == null ? '—' : `${count(v)} KB`)],
  ['Findings (critical)', 'findingCount', null],
];

const VERDICT = {
  improved: '✅ Improved',
  regressed: '❌ Regressed',
  mixed: '⚠️ Mixed: some better, some worse',
  neutral: '➖ No significant change',
};

function budgetsBlock(budgets) {
  if (!budgets) return [];
  const failed = budgets.checks.filter(c => c.status === 'fail');
  if (!failed.length) return [`**Budgets:** ✅ all ${budgets.checks.filter(c => c.status === 'pass').length} checks within budget.`, ''];
  return [
    `**Budgets:** ❌ ${failed.length} over budget`,
    '',
    '| Budget | Value | Limit | Where |',
    '| --- | --- | --- | --- |',
    ...failed.map(c => `| \`${c.key}\` | ${byUnit(c.unit, c.value)} | ${byUnit(c.unit, c.limit)} | ${esc(c.where)} |`),
    '',
  ];
}

function findingsBlock(all, limit) {
  // notes (e.g. "no component framework seen" on a plain page) are noise in CI
  const findings = (all || []).filter(f => f.severity !== 'info');
  if (!findings.length) return ['No warnings or critical findings.', ''];
  return [
    `### Top findings`,
    '',
    '| | Finding | Where | Cost | Fix |',
    '| --- | --- | --- | --- | --- |',
    ...findings
      .slice(0, limit)
      .map(f => `| ${SEV[f.severity] || f.severity} | ${esc(f.title)} | ${where(f)} | ${ms(f.impactMs)} | ${esc(f.fix)} |`),
    '',
  ];
}

function metricsTable(head, base, comparison) {
  const metric = id => comparison?.metrics.find(m => m.id === id);
  const verdictOf = key =>
    ({ tbtMs: 'tbt', lcpMs: 'lcp', fcpMs: 'fcp', cls: 'cls', longTaskCount: 'longTasks', scriptingMs: 'scripting' })[key];
  const rows = ROWS.map(([label, key, fmt]) => {
    const value = r => (key === 'findingCount' ? `${count(r.summary.findingCount)} (${count(r.summary.criticalFindings)})` : fmt(r.summary[key]));
    if (!base) return `| ${label} | ${value(head)} |`;
    const m = metric(verdictOf(key));
    const mark = !m ? '' : m.verdict === 'improved' ? '✅ better' : m.verdict === 'degraded' ? '❌ worse' : m.verdict === 'same' ? 'within noise' : '';
    return `| ${label} | ${value(base)} | ${value(head)} | ${mark} |`;
  });
  return base
    ? ['| Metric | Base | This change | |', '| --- | --- | --- | --- |', ...rows, '']
    : ['| Metric | Median |', '| --- | --- |', ...rows, ''];
}

/**
 * @param {object} o
 * @param {object} o.head        the profile or evaluation result of this commit
 * @param {object} [o.base]      the base commit's profile result (pull requests)
 * @param {object} [o.comparison] spectra compare's comparison of base → head
 * @param {string} [o.reproduce] the command to reproduce the run locally
 */
export function summaryMarkdown({ head, base, comparison, reproduce, findings = 8, artifact } = {}) {
  const out = [MARKER];
  if (head.kind === 'evaluation') {
    out.push(
      `## ⚡ Spectra performance: ${head.passed}/${head.total} journeys passed`,
      '',
      `**Page:** ${head.url} · golden paths · Spectra ${head.spectraVersion || ''}`.trim(),
      '',
      '| Journey | Result | TBT | LCP | Top finding |',
      '| --- | --- | --- | --- | --- |',
      ...head.journeys.map(
        j =>
          `| ${esc(j.title)} | ${j.ok ? 'PASS' : `FAIL${j.error ? `: ${esc(j.error)}` : ''}`} | ${ms(j.summary?.tbtMs)} | ${ms(j.summary?.lcpMs)} | ${j.findings[0] ? `${SEV[j.findings[0].severity] || ''} ${esc(j.findings[0].title)} ${where(j.findings[0])}` : '—'} |`,
      ),
      '',
      ...budgetsBlock(head.budgets),
    );
  } else {
    const title = comparison ? VERDICT[comparison.verdict] || comparison.verdict : head.budgets && !head.budgets.ok ? '❌ Over budget' : '📊 Measured';
    out.push(
      `## ⚡ Spectra performance: ${title}`,
      '',
      `**Page:** ${head.url} · ${head.runs.length} page-load run${head.runs.length === 1 ? '' : 's'}${base ? ' per side' : ''}${head.runs.length > 1 ? ', medians' : ''} · Spectra ${head.spectraVersion || ''}`.trim(),
      '',
    );
    if (comparison) {
      out.push(`**Confidence:** ${comparison.confidence}. A change counts only when it is bigger than the run-to-run noise.`, '');
      if (comparison.headlines.length) out.push(...comparison.headlines.map(h => `- ${h.kind === 'improved' ? '✅' : '❌'} ${esc(h.text)}`), '');
    }
    out.push(...metricsTable(head, base, comparison), ...budgetsBlock(head.budgets));
    if (comparison) {
      const { resolved, added } = comparison.findings;
      if (resolved.length || added.length) {
        out.push(
          '### Findings that changed',
          '',
          ...resolved.slice(0, findings).map(f => `- ✅ resolved: ${esc(f.title)}`),
          ...added.slice(0, findings).map(f => `- ❌ new: ${esc(f.title)}`),
          '',
        );
      }
      const concerns = comparison.checks.filter(c => c.level === 'warn' || c.level === 'bad');
      if (concerns.length)
        out.push('<details><summary>Comparability notes</summary>', '', ...concerns.map(c => `- ${esc(c.title)}${c.detail ? ` — ${esc(c.detail)}` : ''}`), '', '</details>', '');
    }
    out.push(...findingsBlock(head.findings, findings));
  }
  const footer = [];
  if (artifact) footer.push(`Full reports: the **${artifact}** artifact of this run; open them with \`npx spectra dashboard\`.`);
  if (reproduce) footer.push(`Reproduce locally: \`${reproduce}\``);
  if (footer.length) out.push(...footer.map(l => `${l}  `), '');
  out.push('<sub>Measured by [Spectra](https://progen-labs.github.io/website/#spectra/docs/github-action), free and open source.</sub>');
  return `${out.join('\n')}\n`;
}

/** Should the job fail? Returns a reason, or null. */
export function failureReason({ headCode, comparison, failOnBudget, failOnRegression }) {
  if (headCode === 1) return 'Spectra could not run; see the log above.';
  if (failOnBudget && headCode === 2) return 'A performance budget was exceeded.';
  if (failOnRegression && comparison && ['regressed', 'mixed'].includes(comparison.verdict))
    return `Performance ${comparison.verdict === 'mixed' ? 'got worse in some key metrics' : 'regressed'} compared with the base commit.`;
  return null;
}
