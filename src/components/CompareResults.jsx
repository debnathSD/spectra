import { useState } from 'react';
import { formatDelta, formatPct, formatValue } from '../../shared/compare.js';
import CodeRef from './CodeRef.jsx';

const VERDICT = {
  improved: { icon: '✓', word: 'Improved', cls: 'good' },
  degraded: { icon: '✕', word: 'Degraded', cls: 'bad' },
  same: { icon: '=', word: 'Unchanged', cls: 'same' },
  'n/a': { icon: '–', word: 'Not measured', cls: 'na' },
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
  low: 'Low confidence: the recordings are not cleanly comparable.',
};

const CHECK_ICON = {
  ok: ['✓', 'good'],
  warn: ['!', 'warn'],
  bad: ['✕', 'bad'],
};

function Chip({ verdict }) {
  const v = VERDICT[verdict];
  return (
    <span className={`verdict ${v.cls}`}>
      <span aria-hidden="true">{v.icon}</span> {v.word}
    </span>
  );
}

/** Diverging bar: left of the axis = lower (better), right = higher (worse); capped at ±100 %. */
function ChangeBar({ metric }) {
  if (metric.verdict === 'n/a') return null;
  const half = 60;
  const frac = metric.pct === null ? 1 : Math.min(Math.abs(metric.pct), 1);
  const len = Math.max(frac * (half - 2), metric.verdict === 'same' ? 1 : 3);
  const x = metric.delta < 0 ? half - len : half;
  return (
    <svg
      className={`change-bar ${VERDICT[metric.verdict].cls}`}
      width={half * 2}
      height="12"
      role="img"
      aria-label={formatPct(metric.pct)}
    >
      <line x1={half} x2={half} y1="0" y2="12" className="axis" />
      <rect x={x} y="3" width={len} height="6" rx="2" />
    </svg>
  );
}

function Verdict({ comparison }) {
  const o = OVERALL[comparison.verdict];
  const { improved, degraded, same, unavailable } = comparison.counts;
  return (
    <div className={`verdict-banner ${o.cls}`} role="status">
      <div className="big">{o.title}</div>
      <p>
        {o.sentence} {CONFIDENCE[comparison.confidence]}
      </p>
      <p className="counts">
        <span className="good">✓ {improved} improved</span>
        <span className="bad">✕ {degraded} degraded</span>
        <span className="same">= {same} unchanged</span>
        {unavailable > 0 && (
          <span className="muted">{unavailable} not measured</span>
        )}
      </p>
    </div>
  );
}

function Checks({ checks }) {
  return (
    <ul className="checks">
      {checks.map(c => (
        <li key={c.id} className={CHECK_ICON[c.level][1]}>
          <span className="i" aria-hidden="true">
            {CHECK_ICON[c.level][0]}
          </span>
          <span>
            <b>{c.title}.</b> {c.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MetricsTable({ metrics }) {
  const [filter, setFilter] = useState('all');
  const shown = metrics.filter(m => filter === 'all' || m.verdict === filter);
  const counts = v => metrics.filter(m => m.verdict === v).length;
  const filters = [
    ['all', `All (${metrics.length})`],
    ['improved', `✓ Improved (${counts('improved')})`],
    ['degraded', `✕ Degraded (${counts('degraded')})`],
    ['same', `= Unchanged (${counts('same')})`],
  ];
  let group = null;
  return (
    <section>
      <h2>Metrics</h2>
      <div className="segmented" role="group" aria-label="Filter metrics">
        {filters.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <table className="data compare-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Before</th>
            <th className="num">After</th>
            <th className="num">Change</th>
            <th aria-label="Change as a bar" />
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(m => {
            const header =
              m.group !== group
                ? ((group = m.group),
                  (
                    <tr key={`g-${m.group}`} className="group-row">
                      <td colSpan={6}>{m.group}</td>
                    </tr>
                  ))
                : null;
            return [
              header,
              <tr
                key={m.id}
                className={
                  m.verdict === 'same' || m.verdict === 'n/a' ? 'dim' : ''
                }
              >
                <td>
                  {m.label}{' '}
                  {m.key && (
                    <span
                      className="chip"
                      title="Counts toward the overall verdict"
                    >
                      key
                    </span>
                  )}
                  {(m.before.n > 1 || m.after.n > 1) && (
                    <div className="muted small">
                      range {formatValue(m.unit, m.before.min)}–
                      {formatValue(m.unit, m.before.max)} →{' '}
                      {formatValue(m.unit, m.after.min)}–
                      {formatValue(m.unit, m.after.max)}
                    </div>
                  )}
                </td>
                <td className="num">{formatValue(m.unit, m.before.value)}</td>
                <td className="num">{formatValue(m.unit, m.after.value)}</td>
                <td className="num">
                  {m.verdict === 'n/a'
                    ? '–'
                    : `${formatDelta(m.unit, m.delta)} (${formatPct(m.pct)})`}
                </td>
                <td>
                  <ChangeBar metric={m} />
                </td>
                <td>
                  <Chip verdict={m.verdict} />
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      {!shown.length && <p className="muted">Nothing in this category.</p>}
    </section>
  );
}

function EntityList({ title, tone, list, total, hideVendor, defaultOpen }) {
  const rows = hideVendor ? list.filter(e => !e.vendor) : list;
  if (!rows.length) return null;
  return (
    <details className={`entity-group ${tone}`} open={defaultOpen}>
      <summary>
        {title}{' '}
        <span className="muted">({hideVendor ? rows.length : total})</span>
      </summary>
      <table className="data">
        <tbody>
          {rows.map(e => (
            <tr key={e.key}>
              <td className="entity-name">
                <b>
                  {e.name === e.file ? (
                    <span className="mono">{e.name}</span>
                  ) : (
                    e.name
                  )}
                </b>
                {e.vendor && <span className="chip">library</span>}
                {e.name !== e.file && e.file && (
                  <CodeRef
                    file={e.file}
                    line={e.line}
                    lineKind={e.lineKind}
                    abs={e.abs}
                  />
                )}
              </td>
              <td>
                {e.changes.map(c => (
                  <div
                    key={c.id}
                    className={
                      c.verdict === 'same' ? 'muted' : VERDICT[c.verdict].cls
                    }
                  >
                    {c.verdict !== 'same' && (
                      <b aria-hidden="true">{VERDICT[c.verdict].icon} </b>
                    )}
                    {c.label}: {formatValue(c.unit, c.before)} →{' '}
                    {formatValue(c.unit, c.after)}
                    {c.verdict !== 'same' && ` (${formatPct(c.pct)})`}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Entities({ data, hideVendor }) {
  const group = (title, bucket, tone, open) => (
    <EntityList
      key={bucket}
      title={title}
      tone={tone}
      list={data[bucket]}
      total={data[`${bucket}Total`]}
      hideVendor={hideVendor}
      defaultOpen={open}
    />
  );
  return (
    <>
      <p className="muted">
        {data.compared} compared · {data.unchanged} unchanged
      </p>
      {group('Degraded', 'degraded', 'bad', true)}
      {group('Mixed (some metrics better, some worse)', 'mixed', 'warn', true)}
      {group('Improved', 'improved', 'good', true)}
      {group('Newly active (new cost)', 'added', 'bad', false)}
      {group('No longer active (cost gone)', 'removed', 'good', false)}
      {!data.degradedTotal &&
        !data.improvedTotal &&
        !data.mixedTotal &&
        !data.addedTotal &&
        !data.removedTotal && (
          <p className="muted">Nothing changed beyond the thresholds.</p>
        )}
    </>
  );
}

function FindingCard({ finding, tone }) {
  const sev = { critical: 'bad', warning: 'warn', info: 'info' }[
    finding.severity
  ];
  return (
    <li className={`finding-card ${tone || sev}`}>
      <div>
        <span className={`sev ${sev}`}>{finding.severity.toUpperCase()}</span>{' '}
        <span className="chip">{finding.category}</span>
      </div>
      <h4>{finding.title}</h4>
      {finding.culprits?.map(c => (
        <div key={`${c.fn}${c.file}`} className="mono">
          {c.fn}() in{' '}
          <CodeRef
            file={c.file}
            line={c.line}
            lineKind={c.lineKind}
            abs={c.abs}
          />
        </div>
      ))}
      <p className="fix">
        <b>Fix:</b> {finding.fix}
      </p>
    </li>
  );
}

function Findings({ findings }) {
  const block = (title, list, tone, empty) => (
    <section>
      <h3>
        {title} <span className="muted">({list.length})</span>
      </h3>
      {list.length ? (
        <ul className="finding-cards">
          {list.map(f => (
            <FindingCard key={f.id} finding={f} tone={tone} />
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
  return (
    <>
      {block(
        'New problems introduced',
        findings.added,
        'bad',
        'No new problems.',
      )}
      {block(
        'Problems resolved',
        findings.resolved,
        'good',
        'No problems were resolved.',
      )}
      <section>
        <h3>
          Problems that persist{' '}
          <span className="muted">({findings.persisting.length})</span>
        </h3>
        {findings.persisting.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>Issue</th>
                <th className="num">Impact before</th>
                <th className="num">Impact after</th>
              </tr>
            </thead>
            <tbody>
              {findings.persisting.map(f => (
                <tr key={f.id}>
                  <td>
                    <span
                      className={`sev ${{ critical: 'bad', warning: 'warn', info: 'info' }[f.severity]}`}
                    >
                      {f.severity}
                    </span>{' '}
                    · {f.title}
                  </td>
                  <td className="num">{formatValue('ms', f.beforeImpactMs)}</td>
                  <td className="num">{formatValue('ms', f.impactMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
    </>
  );
}

const DETAIL_TABS = [
  ['components', 'React components'],
  ['files', 'Files'],
  ['functions', 'Functions'],
  ['findings', 'Problems'],
];

export default function CompareResults({ comparison, hideVendor }) {
  const [detail, setDetail] = useState('components');
  const badge = id => {
    if (id === 'findings')
      return (
        comparison.findings.added.length + comparison.findings.resolved.length
      );
    const d = comparison[id];
    return (
      d.degradedTotal +
      d.improvedTotal +
      d.mixedTotal +
      d.addedTotal +
      d.removedTotal
    );
  };
  return (
    <div className="compare-results">
      <Verdict comparison={comparison} />
      {comparison.headlines.length > 0 && (
        <section>
          <h2>Highlights</h2>
          <ul className="icons">
            {comparison.headlines.map(h => (
              <li key={h.text} className={VERDICT[h.kind].cls}>
                <span className="i" aria-hidden="true">
                  {VERDICT[h.kind].icon}
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>Can this comparison be trusted?</h2>
        <Checks checks={comparison.checks} />
      </section>
      <MetricsTable metrics={comparison.metrics} />
      <section>
        <h2>What changed, in detail</h2>
        <div role="tablist" className="tabs">
          {DETAIL_TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={detail === id}
              onClick={() => setDetail(id)}
            >
              {label}
              <span className="count">{badge(id)}</span>
            </button>
          ))}
        </div>
        <div className="detail-pane">
          {detail === 'findings' ? (
            <Findings findings={comparison.findings} />
          ) : (
            <Entities data={comparison[detail]} hideVendor={hideVendor} />
          )}
        </div>
      </section>
    </div>
  );
}
