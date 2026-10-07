/**
 * Print-ready HTML for a commit-to-commit performance comparison.
 *
 * Two variants of the same document:
 *   summary   2-3 pages for a PR description or a reviewer glancing at it
 *   detailed  everything: every metric, component, file, function, finding,
 *             the run inventory and the methodology
 *
 * The input is the object produced by shared/compare.js, so the PDF is
 * guaranteed to say what the Compare tab says. Every dynamic string is escaped:
 * names and URLs come from the profiled app.
 */
import {
  METRICS,
  formatDelta,
  formatPct,
  formatValue,
} from '../../shared/compare.js';
import { TARGET_NAME } from '../config.js';

const esc = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const VERDICT = {
  improved: { icon: '✓', word: 'Improved', cls: 'good' },
  degraded: { icon: '✕', word: 'Degraded', cls: 'bad' },
  same: { icon: '=', word: 'Unchanged', cls: 'same' },
  'n/a': { icon: '–', word: 'n/a', cls: 'na' },
  mixed: { icon: '±', word: 'Mixed', cls: 'warn' },
};

const OVERALL = {
  improved: {
    title: 'Improved',
    cls: 'good',
    sentence: 'Key metrics got better and none got significantly worse.',
  },
  regressed: {
    title: 'Regressed',
    cls: 'bad',
    sentence: 'Key metrics got worse and none got significantly better.',
  },
  mixed: {
    title: 'Mixed result',
    cls: 'warn',
    sentence: 'Some key metrics improved while others degraded.',
  },
  neutral: {
    title: 'No significant change',
    cls: 'same',
    sentence: 'No key metric moved beyond the noise thresholds.',
  },
};

const CONFIDENCE = {
  high: 'High confidence: comparable recordings, repeated runs.',
  medium: 'Medium confidence: see the comparability notes.',
  low: 'Low confidence: the recordings are not cleanly comparable (see below).',
};

const CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 9.5pt/1.45 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #15150f; }
h1 { font-size: 20pt; margin: 0; }
h2 { font-size: 12.5pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #15150f; break-after: avoid; }
h3 { font-size: 10.5pt; margin: 12pt 0 4pt; break-after: avoid; }
p { margin: 3pt 0; }
code, .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.5pt; }
.muted { color: #5b5a52; }
.sub { color: #5b5a52; margin-top: 2pt; }
.good { --c: #1a7f37; } .bad { --c: #c62828; } .warn { --c: #b45309; } .same { --c: #6b6a62; } .na { --c: #6b6a62; } .info { --c: #1f5fb4; }
.cls-text { color: var(--c); font-weight: 600; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; margin-top: 10pt; }
.commit { border: 1pt solid #d7d6cf; border-radius: 5pt; padding: 8pt 10pt; break-inside: avoid; background: #f7f7f4; }
.commit .role { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #5b5a52; }
.commit .hash { font: 700 13pt ui-monospace, Menlo, monospace; margin: 1pt 0 3pt; }
.commit dl { margin: 4pt 0 0; display: grid; grid-template-columns: 52pt 1fr; gap: 1pt 6pt; }
.commit dt { color: #5b5a52; } .commit dd { margin: 0; overflow-wrap: anywhere; }
.badge { display: inline-block; border: 1pt solid var(--c, #999); color: var(--c, #555); border-radius: 3pt; padding: 0 4pt; font-size: 8pt; font-weight: 600; }
.banner { margin-top: 12pt; border: 1.5pt solid var(--c); border-left-width: 6pt; border-radius: 5pt; padding: 9pt 12pt; break-inside: avoid; }
.banner .big { font-size: 17pt; font-weight: 700; color: var(--c); }
.counts span { margin-right: 14pt; font-weight: 600; }
ul.tight { margin: 3pt 0 3pt 14pt; padding: 0; } ul.tight li { margin: 2pt 0; }
ul.icons { list-style: none; margin: 4pt 0; padding: 0; } ul.icons li { margin: 3pt 0; padding-left: 15pt; text-indent: -15pt; }
ul.icons .i { display: inline-block; width: 15pt; text-indent: 0; font-weight: 700; color: var(--c); }
table { width: 100%; border-collapse: collapse; margin: 4pt 0; }
th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #5b5a52; border-bottom: 1pt solid #15150f; padding: 3pt 5pt; }
td { padding: 3.5pt 5pt; border-bottom: .5pt solid #d7d6cf; vertical-align: top; }
tr { break-inside: avoid; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.group td { background: #efeee9; font-weight: 700; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; border-bottom: 0; }
.verdict { color: var(--c); font-weight: 700; white-space: nowrap; }
.dim td { color: #77766d; }
svg.bar { display: block; }
.sev { font-weight: 700; color: var(--c); }
.entity-changes div { white-space: nowrap; }
.card { border: 1pt solid #d7d6cf; border-left: 4pt solid var(--c, #999); border-radius: 4pt; padding: 6pt 9pt; margin: 6pt 0; break-inside: avoid; }
.card h4 { margin: 0 0 2pt; font-size: 10pt; }
.card p { color: #3b3a33; }
.callout { background: #f7f7f4; border: 1pt solid #d7d6cf; border-radius: 4pt; padding: 6pt 9pt; margin: 8pt 0; break-inside: avoid; }
.pagebreak { break-before: page; }
`;

// -------------------------------------------------------------------- pieces

function verdictCell(verdict) {
  const v = VERDICT[verdict] || VERDICT['n/a'];
  return `<span class="verdict ${v.cls}"><span aria-hidden="true">${v.icon}</span> ${v.word}</span>`;
}

/** Diverging bar of percentage change: left = lower (better), right = higher (worse), capped at ±100%. */
function changeBar(m) {
  if (m.verdict === 'n/a') return '';
  const width = 120;
  const mid = width / 2;
  const frac = m.pct === null ? 1 : Math.min(Math.abs(m.pct), 1);
  const len =
    m.verdict === 'same'
      ? Math.max(frac * (mid - 4), 1)
      : Math.max(frac * (mid - 4), 3);
  const x = m.delta < 0 ? mid - len : mid;
  const colour =
    m.verdict === 'improved'
      ? '#1a7f37'
      : m.verdict === 'degraded'
        ? '#c62828'
        : '#9a998f';
  return `<svg class="bar" width="${width}" height="11" viewBox="0 0 ${width} 11" role="img" aria-label="${esc(formatPct(m.pct))}">
    <line x1="${mid}" x2="${mid}" y1="0" y2="11" stroke="#15150f" stroke-width="1"/>
    <rect x="${x}" y="2" width="${len}" height="7" rx="1.5" fill="${colour}"/></svg>`;
}

function metricRow(m) {
  const change =
    m.verdict === 'n/a'
      ? '–'
      : `${esc(formatDelta(m.unit, m.delta))} <span class="muted">(${esc(formatPct(m.pct))})</span>`;
  const runs =
    m.before.n > 1 || m.after.n > 1
      ? `<div class="muted" style="font-size:7.5pt">range ${esc(formatValue(m.unit, m.before.min))}–${esc(formatValue(m.unit, m.before.max))} → ${esc(formatValue(m.unit, m.after.min))}–${esc(formatValue(m.unit, m.after.max))}</div>`
      : '';
  return `<tr class="${m.verdict === 'same' || m.verdict === 'n/a' ? 'dim' : ''}">
    <td>${esc(m.label)}${m.key ? ' <span class="badge info" title="key metric">key</span>' : ''}${runs}</td>
    <td class="n">${esc(formatValue(m.unit, m.before.value))}</td>
    <td class="n">${esc(formatValue(m.unit, m.after.value))}</td>
    <td class="n">${change}</td>
    <td>${changeBar(m)}</td>
    <td>${verdictCell(m.verdict)}</td></tr>`;
}

const METRIC_HEAD = `<thead><tr><th>Metric</th><th class="n">Before</th><th class="n">After</th><th class="n">Change</th><th>Δ%</th><th>Result</th></tr></thead>`;

function metricsTable(metrics, { grouped }) {
  let rows = '';
  let group = null;
  for (const m of metrics) {
    if (grouped && m.group !== group) {
      group = m.group;
      rows += `<tr class="group"><td colspan="6">${esc(group)}</td></tr>`;
    }
    rows += metricRow(m);
  }
  return `<table>${METRIC_HEAD}<tbody>${rows}</tbody></table>`;
}

function commitCard(role, side) {
  const git = side.git;
  const run = side.runs[0];
  const date = git?.date
    ? new Date(git.date).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  const rows = [
    ['Author', git?.author || 'unknown'],
    ['Date', date || 'unknown'],
    ['Message', git?.subject || '–'],
    git?.branch ? ['Branch', git.branch] : null,
    ['Scenario', side.label || run?.title || '–'],
    [
      'Runs',
      `${side.runs.length} (${run?.mode === 'load' ? 'page load' : 'interaction'}${run?.cpuThrottle > 1 ? `, ${run.cpuThrottle}× CPU slowdown` : ''})`,
    ],
  ].filter(Boolean);
  return `<div class="commit"><div class="role">${esc(role)}</div>
    <div class="hash">${esc(git?.shortHash || (git?.hash || '').slice(0, 10) || 'no commit')}${git?.dirty ? ' <span class="badge warn">uncommitted changes</span>' : ''}</div>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
}

function verdictBanner(cmp) {
  const o = OVERALL[cmp.verdict];
  const { improved, degraded, same, unavailable } = cmp.counts;
  return `<div class="banner ${o.cls}"><div class="big">${esc(o.title)}</div>
    <p>${esc(o.sentence)} ${esc(CONFIDENCE[cmp.confidence])}</p>
    <p class="counts"><span class="good cls-text">✓ ${improved} improved</span><span class="bad cls-text">✕ ${degraded} degraded</span><span class="same cls-text">= ${same} unchanged</span>${unavailable ? `<span class="muted">${unavailable} not measured</span>` : ''}</p></div>`;
}

function headlines(cmp) {
  if (!cmp.headlines.length)
    return '<p class="muted">No metric moved beyond the noise thresholds.</p>';
  const item = h => {
    const v = VERDICT[h.kind];
    return `<li class="${v.cls}"><span class="i">${v.icon}</span>${esc(h.text)}</li>`;
  };
  return `<ul class="icons">${cmp.headlines.map(item).join('')}</ul>`;
}

function checksList(cmp, { onlyProblems }) {
  const icon = { ok: ['✓', 'good'], warn: ['!', 'warn'], bad: ['✕', 'bad'] };
  const list = onlyProblems
    ? cmp.checks.filter(c => c.level !== 'ok')
    : cmp.checks;
  const okCount =
    cmp.checks.length - cmp.checks.filter(c => c.level !== 'ok').length;
  const intro =
    onlyProblems && okCount
      ? `<p class="muted">${okCount} of ${cmp.checks.length} comparability checks passed.</p>`
      : '';
  if (!list.length)
    return intro || '<p class="muted">All comparability checks passed.</p>';
  return `${intro}<ul class="icons">${list.map(c => `<li class="${icon[c.level][1]}"><span class="i">${icon[c.level][0]}</span><b>${esc(c.title)}.</b> ${esc(c.detail)}</li>`).join('')}</ul>`;
}

function whereLine(e) {
  if (!e.file) return '';
  return `<div class="muted mono">${esc(e.file)}${e.line ? `:${e.lineKind === 'located' ? '≈' : ''}${e.line}` : ''}</div>`;
}

function changesCell(e) {
  return `<div class="entity-changes">${e.changes
    .map(c => {
      const v = VERDICT[c.verdict];
      return `<div class="${c.verdict === 'same' ? 'muted' : v.cls}">${c.verdict === 'same' ? '' : `<b>${v.icon}</b> `}${esc(c.label)}: ${esc(formatValue(c.unit, c.before))} → ${esc(formatValue(c.unit, c.after))}${c.verdict === 'same' ? '' : ` (${esc(formatPct(c.pct))})`}</div>`;
    })
    .join('')}</div>`;
}

function entityTable(title, list, total, { empty }) {
  if (!list.length)
    return empty
      ? `<h3>${esc(title)}</h3><p class="muted">${esc(empty)}</p>`
      : '';
  const more =
    total > list.length
      ? `<p class="muted">Showing the ${list.length} largest of ${total}.</p>`
      : '';
  return `<h3>${esc(title)} <span class="muted">(${total})</span></h3>
    <table><thead><tr><th>Name</th><th>What changed</th></tr></thead><tbody>
    ${list.map(e => `<tr><td><b>${esc(e.name)}</b>${e.vendor ? ' <span class="badge same">library</span>' : ''}${e.name === e.file ? '' : whereLine(e)}</td><td>${changesCell(e)}</td></tr>`).join('')}
    </tbody></table>${more}`;
}

function entitySection(title, key, cmp, { vendor }) {
  const data = cmp[key];
  const keep = list => (vendor ? list : list.filter(e => !e.vendor));
  const build = (name, bucket, emptyText) => {
    const list = keep(data[bucket]);
    return entityTable(
      name,
      list,
      vendor ? data[`${bucket}Total`] : list.length,
      { empty: emptyText },
    );
  };
  return `<h2>${esc(title)}</h2>
    <p class="muted">${data.compared} compared · ${data.unchanged} unchanged${vendor ? '' : ' · library code (node_modules) omitted'}</p>
    ${build('Degraded', 'degraded', 'None degraded.')}
    ${build('Mixed (some metrics better, some worse)', 'mixed', '')}
    ${build('Improved', 'improved', 'None improved.')}
    ${build('Newly active in the “after” recording (new cost)', 'added', '')}
    ${build('No longer active in the “after” recording (cost gone)', 'removed', '')}`;
}

function culpritLine(c) {
  return `<code>${esc(c.fn)}()</code> in <code>${esc(c.file || 'unknown')}${c.line ? `:${c.lineKind === 'located' ? '≈' : ''}${c.line}` : ''}</code>`;
}

function findingCard(f, tone) {
  const sev = { critical: 'bad', warning: 'warn', info: 'info' }[f.severity];
  return `<div class="card ${tone || sev}"><h4><span class="sev ${sev}">${esc(f.severity.toUpperCase())}</span> · ${esc(f.category)} — ${esc(f.title)}</h4>
    ${f.culprits?.length ? `<p>${f.culprits.map(culpritLine).join('<br>')}</p>` : ''}
    <p><b>Fix:</b> ${esc(f.fix || '–')}</p></div>`;
}

function findingsSection(cmp, { limit }) {
  const { added, resolved, persisting } = cmp.findings;
  const cap = list => (limit ? list.slice(0, limit) : list);
  const group = (title, list, tone, empty) =>
    `<h3>${esc(title)} <span class="muted">(${list.length})</span></h3>${
      list.length
        ? cap(list)
            .map(f => findingCard(f, tone))
            .join('')
        : `<p class="muted">${esc(empty)}</p>`
    }${limit && list.length > limit ? `<p class="muted">… and ${list.length - limit} more in the detailed report.</p>` : ''}`;
  const persistingTable = persisting.length
    ? `<table><thead><tr><th>Issue</th><th class="n">Impact before</th><th class="n">Impact after</th></tr></thead><tbody>${cap(
        persisting,
      )
        .map(
          f =>
            `<tr><td><span class="sev ${{ critical: 'bad', warning: 'warn', info: 'info' }[f.severity]}">${esc(f.severity)}</span> · ${esc(f.title)}</td><td class="n">${esc(formatValue('ms', f.beforeImpactMs))}</td><td class="n">${esc(formatValue('ms', f.impactMs))}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="muted">None.</p>';
  return `${group('New problems introduced', added, 'bad', 'No new problems.')}
    ${group('Problems resolved', resolved, 'good', 'No problems were resolved.')}
    <h3>Problems that persist <span class="muted">(${persisting.length})</span></h3>${persistingTable}`;
}

function topChanges(cmp) {
  const rows = [];
  for (const [kind, label] of [
    ['components', 'Component'],
    ['files', 'File'],
  ]) {
    for (const bucket of ['degraded', 'improved']) {
      cmp[kind][bucket]
        .filter(e => !e.vendor)
        .slice(0, 4)
        .forEach(e => rows.push({ label, bucket, e }));
    }
  }
  if (!rows.length)
    return '<p class="muted">No application component or file changed beyond the thresholds.</p>';
  return `<table><thead><tr><th>Where</th><th>What changed</th><th>Result</th></tr></thead><tbody>${rows
    .map(
      ({ label, bucket, e }) =>
        `<tr><td><span class="muted">${label}</span> <b>${esc(e.name)}</b>${e.name === e.file ? '' : whereLine(e)}</td><td>${changesCell(e)}</td><td>${verdictCell(bucket)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function runsTable(cmp) {
  const rows = (role, side) =>
    side.runs
      .map(
        r =>
          `<tr><td>${role}</td><td class="mono">${esc(r.id)}</td><td>${esc(r.commit || '–')}</td><td>${esc(r.mode === 'load' ? 'page load' : 'interaction')}</td><td class="n">${esc(formatValue('ms', r.durationMs))}</td><td class="n">${r.cpuThrottle}×</td><td class="mono">${esc(r.url)}</td></tr>`,
      )
      .join('');
  return `<table><thead><tr><th>Side</th><th>Recording</th><th>Commit</th><th>Mode</th><th class="n">Length</th><th class="n">CPU</th><th>URL</th></tr></thead><tbody>${rows('Before', cmp.before)}${rows('After', cmp.after)}</tbody></table>`;
}

function methodology() {
  const rows = METRICS.map(
    m =>
      `<tr><td>${esc(m.label)}</td><td>${esc(m.group)}</td><td class="n">${esc(formatValue(m.unit, m.minAbs))}</td><td class="n">${Math.round(m.minRel * 100)}%</td><td>${m.key ? 'yes' : ''}</td></tr>`,
  ).join('');
  return `<h2>Methodology</h2>
    <div class="callout">
      <p><b>What is compared.</b> Profiler reports recorded in Chrome through the DevTools Protocol (tracing, V8 CPU sampling and an in-page React probe). When a side has several runs, each metric is the <b>median</b> of its runs.</p>
      <p><b>What counts as a change.</b> A metric is “improved” or “degraded” only when the difference exceeds <b>all three</b> of: its absolute floor, its relative floor (both in the table below) and the <b>run-to-run spread</b> seen on either side. Everything else is “unchanged”. For every metric listed here <b>lower is better</b>.</p>
      <p><b>Overall verdict.</b> Decided only by the <i>key</i> metrics: improved if some improved and none degraded; regressed if some degraded and none improved; mixed if both; otherwise no significant change.</p>
      <p><b>Limits.</b> A single run per side cannot separate a real change from noise: record each side at least three times, on the same page, in the same mode, with the same CPU setting. Interaction recordings are only comparable if the same actions were performed. Dev builds are slower than production: trust direction and ranking more than absolute numbers.</p>
    </div>
    <table><thead><tr><th>Metric</th><th>Group</th><th class="n">Abs. floor</th><th class="n">Rel. floor</th><th>Key</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function header(cmp, kind) {
  const b = cmp.before.git?.shortHash || 'before';
  const a = cmp.after.git?.shortHash || 'after';
  return `<h1>Performance comparison</h1>
    <p class="sub">${esc(TARGET_NAME)} · <span class="mono">${esc(b)}</span> → <span class="mono">${esc(a)}</span> · ${kind === 'summary' ? 'Summary' : 'Detailed report'} · generated ${esc(new Date(cmp.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
    <div class="pair">${commitCard('Before', cmp.before)}${commitCard('After', cmp.after)}</div>`;
}

// -------------------------------------------------------------------- documents

function summaryBody(cmp) {
  const keyMetrics = cmp.metrics.filter(m => m.key);
  const movedOthers = cmp.metrics.filter(
    m => !m.key && (m.verdict === 'improved' || m.verdict === 'degraded'),
  );
  return `${header(cmp, 'summary')}
    ${verdictBanner(cmp)}
    <h2>Highlights</h2>${headlines(cmp)}
    <h2>Key metrics</h2>${metricsTable(keyMetrics, { grouped: false })}
    ${movedOthers.length ? `<h3>Other metrics that moved</h3>${metricsTable(movedOthers, { grouped: false })}` : ''}
    <h2>Components and files that changed most</h2>${topChanges(cmp)}
    <h2>Problems found</h2>${findingsSection(cmp, { limit: 4 })}
    <h2>Can this comparison be trusted?</h2>${checksList(cmp, { onlyProblems: true })}
    <p class="muted" style="margin-top:8pt">A change counts only if it exceeds the metric's noise floor and the run-to-run spread. The detailed report lists every metric, component, file and function, plus the methodology.</p>`;
}

function detailedBody(cmp) {
  return `${header(cmp, 'detailed')}
    ${verdictBanner(cmp)}
    <h2>Highlights</h2>${headlines(cmp)}
    <h2>Comparability</h2>${checksList(cmp, { onlyProblems: false })}
    <h2 class="pagebreak">All metrics</h2>${metricsTable(cmp.metrics, { grouped: true })}
    <div class="pagebreak"></div>${entitySection('React components', 'components', cmp, { vendor: false })}
    <div class="pagebreak"></div>${entitySection('Files', 'files', cmp, { vendor: false })}
    <div class="pagebreak"></div>${entitySection('Functions', 'functions', cmp, { vendor: false })}
    <div class="pagebreak"></div><h2>Problems found</h2>${findingsSection(cmp, { limit: 0 })}
    <h2 class="pagebreak">Recordings used</h2>${runsTable(cmp)}
    ${methodology()}`;
}

/** @param {'summary'|'detailed'} kind */
export function renderComparisonHtml(cmp, kind = 'summary') {
  const body = kind === 'detailed' ? detailedBody(cmp) : summaryBody(cmp);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Performance comparison</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

export function footerTemplate(cmp, kind) {
  const b = esc(cmp.before.git?.shortHash || 'before');
  const a = esc(cmp.after.git?.shortHash || 'after');
  return `<div style="width:100%;padding:0 14mm;font:7.5pt -apple-system,Helvetica,Arial,sans-serif;color:#6b6a62;display:flex;justify-content:space-between">
    <span>${esc(TARGET_NAME)} performance · ${b} → ${a} · ${kind === 'summary' ? 'summary' : 'detailed'}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}
