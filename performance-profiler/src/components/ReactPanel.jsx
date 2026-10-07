import { useMemo, useState } from 'react';
import { fmtMs, fmtNumber, splitPath } from '../format.js';

const COLUMNS = [
  { id: 'name', label: 'Component', get: c => c.name, text: true },
  { id: 'renders', label: 'Renders', get: c => c.renders },
  { id: 'wasted', label: 'Wasted', get: c => c.wasted },
  {
    id: 'wastedPct',
    label: 'Wasted %',
    get: c => (c.renders ? (c.wasted / c.renders) * 100 : 0),
  },
  { id: 'selfMs', label: 'Self time', get: c => c.selfMs },
  {
    id: 'avgMs',
    label: 'Avg / render',
    get: c => (c.renders ? c.selfMs / c.renders : 0),
  },
  { id: 'maxMs', label: 'Slowest', get: c => c.maxMs },
];

const REASON_LABELS = {
  props: 'props changed',
  state: 'state',
  hooks: 'hook state',
  context: 'context',
  parent: 'parent re-render (nothing changed)',
};

function Detail({ c }) {
  const reasons = Object.entries(c.reasons).filter(([, n]) => n);
  return (
    <tr className="detail">
      <td colSpan={COLUMNS.length + 1}>
        <div className="detail-grid">
          <div>
            <h4>Why it rendered</h4>
            <ul>
              {c.mounts > 0 && <li>{c.mounts}× mounted</li>}
              {reasons.map(([k, n]) => (
                <li key={k}>
                  {n}× {REASON_LABELS[k]}
                </li>
              ))}
              {c.topParent && (
                <li className="muted">
                  usually triggered by parent <b>{c.topParent}</b>
                </li>
              )}
            </ul>
          </div>
          <div>
            <h4>Props that changed</h4>
            {c.changedProps.length === 0 ? (
              <p className="muted">none</p>
            ) : (
              <ul>
                {c.changedProps.map(p => {
                  const unstable = c.unstableProps.find(u => u.prop === p.prop);
                  return (
                    <li key={p.prop}>
                      <code>{p.prop}</code> {p.count}×
                      {unstable && (
                        <span className="warn">
                          {' '}
                          — new{' '}
                          {unstable.kind === 'function'
                            ? 'function with identical code'
                            : 'object with identical contents'}{' '}
                          each time{' '}
                          {unstable.kind === 'function'
                            ? '(useCallback)'
                            : '(useMemo)'}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function ReactPanel({ report, hideVendor, onOpenFile }) {
  const [sort, setSort] = useState({ id: 'selfMs', dir: -1 });
  const [open, setOpen] = useState(null);
  const react = report.react;
  const rows = useMemo(() => {
    const col = COLUMNS.find(c => c.id === sort.id);
    return react.components
      .filter(c => !(hideVendor && c.vendor))
      .sort(
        (a, b) =>
          (col.text
            ? col.get(a).localeCompare(col.get(b))
            : col.get(a) - col.get(b)) * sort.dir,
      );
  }, [react.components, sort, hideVendor]);

  if (!react.detected) {
    return (
      <div className="empty">
        <h3>No React renderer was detected</h3>
        <p>
          The probe has to be installed before React loads. Use{' '}
          <b>Record page load</b>, or reload the tab from this tool and record
          again.
        </p>
      </div>
    );
  }
  return (
    <div className="react-panel">
      <div className="summary-row">
        <span>React {react.version}</span>
        <span>{fmtNumber(react.commits.count)} commits</span>
        <span>total render time {fmtMs(react.commits.totalMs)}</span>
        <span>slowest commit {fmtMs(react.commits.maxMs)}</span>
        {!react.hasTimings && (
          <span className="warn">production build: no timings</span>
        )}
      </div>
      <table className="data">
        <thead>
          <tr>
            {COLUMNS.map(c => (
              <th key={c.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSort({
                      id: c.id,
                      dir: sort.id === c.id ? -sort.dir : -1,
                    })
                  }
                >
                  {c.label} {sort.id === c.id ? (sort.dir < 0 ? '↓' : '↑') : ''}
                </button>
              </th>
            ))}
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 300).map(c => {
            const key = `${c.name}|${c.file}|${c.line}`;
            return [
              <tr key={key} className={open === key ? 'open' : ''}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setOpen(open === key ? null : key)}
                  >
                    {open === key ? '▾' : '▸'} {c.name}
                  </button>
                </td>
                <td className="num">{fmtNumber(c.renders)}</td>
                <td className={`num ${c.wasted ? 'warn' : ''}`}>
                  {fmtNumber(c.wasted)}
                </td>
                <td className="num">
                  {c.renders ? Math.round((c.wasted / c.renders) * 100) : 0}%
                </td>
                <td className="num">{fmtMs(c.selfMs)}</td>
                <td className="num">
                  {fmtMs(c.renders ? c.selfMs / c.renders : 0)}
                </td>
                <td className="num">{fmtMs(c.maxMs)}</td>
                <td>
                  {c.file ? (
                    <button
                      type="button"
                      className="link mono"
                      onClick={() => onOpenFile(c.file)}
                      title={c.file}
                    >
                      <span className="muted">
                        {splitPath(c.file).dir.slice(-28)}
                      </span>
                      {splitPath(c.file).name}
                      {c.line ? `:${c.line}` : ''}
                    </button>
                  ) : (
                    <span className="muted">unknown</span>
                  )}
                </td>
              </tr>,
              open === key && <Detail key={`${key}-detail`} c={c} />,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
