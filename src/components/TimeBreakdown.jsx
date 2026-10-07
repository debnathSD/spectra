import { fmtMs } from '../format.js';

const PARTS = [
  { key: 'scriptingMs', label: 'Scripting', color: 'var(--cat-1)' },
  { key: 'layoutMs', label: 'Layout', color: 'var(--cat-2)' },
  { key: 'styleMs', label: 'Style', color: 'var(--cat-3)' },
  { key: 'paintMs', label: 'Paint', color: 'var(--cat-4)' },
  { key: 'gcMs', label: 'Garbage collection', color: 'var(--cat-5)' },
  { key: 'compileMs', label: 'Compile/parse', color: 'var(--cat-6)' },
  { key: 'otherMs', label: 'Other', color: 'var(--cat-other)' },
];

/** Where main-thread time went, as one stacked bar with a labelled legend. */
export default function TimeBreakdown({ totals }) {
  const parts = PARTS.map(p => ({ ...p, value: totals[p.key] || 0 })).filter(
    p => p.value > 0,
  );
  const sum = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="breakdown">
      <div
        className="breakdown-bar"
        role="img"
        aria-label="Main-thread time breakdown"
      >
        {parts.map(p => (
          <span
            key={p.key}
            style={{ width: `${(p.value / sum) * 100}%`, background: p.color }}
            title={`${p.label}: ${fmtMs(p.value)}`}
          />
        ))}
      </div>
      <ul className="breakdown-legend">
        {parts.map(p => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            {p.label} <b>{fmtMs(p.value)}</b>{' '}
            <span className="muted">{Math.round((p.value / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
