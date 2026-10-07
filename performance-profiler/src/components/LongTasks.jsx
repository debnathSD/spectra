import { fmtMs } from '../format.js';
import CodeRef from './CodeRef.jsx';

const CATS = [
  ['scripting', 'Scripting', 'var(--cat-1)'],
  ['layout', 'Layout', 'var(--cat-2)'],
  ['style', 'Style', 'var(--cat-3)'],
  ['paint', 'Paint', 'var(--cat-4)'],
  ['gc', 'GC', 'var(--cat-5)'],
  ['compile', 'Compile', 'var(--cat-6)'],
  ['parse', 'Parse', 'var(--cat-6)'],
  ['other', 'Other', 'var(--cat-other)'],
];

/** Every main-thread task over 8 ms on a time axis; long tasks (>50 ms) stand out. */
function Timeline({ report }) {
  const total = Math.max(
    report.meta.durationMs,
    ...report.timeline.map(t => t.startMs + t.durMs),
    1,
  );
  const maxDur = Math.max(...report.timeline.map(t => t.durMs), 50);
  const H = 90;
  return (
    <svg
      className="timeline"
      viewBox={`0 0 1000 ${H + 18}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Main-thread tasks over time"
    >
      <line
        x1="0"
        x2="1000"
        y1={H - (50 / maxDur) * H}
        y2={H - (50 / maxDur) * H}
        className="limit"
      />
      {report.timeline.map(t => (
        <rect
          key={`${t.startMs}-${t.durMs}`}
          x={(t.startMs / total) * 1000}
          width={Math.max((t.durMs / total) * 1000, 1.5)}
          y={H - (t.durMs / maxDur) * H}
          height={(t.durMs / maxDur) * H}
          className={t.durMs >= 50 ? 'task long' : 'task'}
        >
          <title>{`${fmtMs(t.durMs)} at ${(t.startMs / 1000).toFixed(2)}s`}</title>
        </rect>
      ))}
      <text x="2" y={H + 13} className="axis">
        0
      </text>
      <text x="998" y={H + 13} className="axis" textAnchor="end">
        {(total / 1000).toFixed(1)} s
      </text>
      <text
        x="998"
        y={H - (50 / maxDur) * H - 3}
        className="axis"
        textAnchor="end"
      >
        50 ms
      </text>
    </svg>
  );
}

export default function LongTasks({ report, onOpenFile }) {
  return (
    <div className="long-tasks">
      <Timeline report={report} />
      {report.longTasks.length === 0 ? (
        <p className="muted pad">No task exceeded 50 ms in this recording.</p>
      ) : (
        <ul className="task-list">
          {report.longTasks.map(t => {
            const sum =
              CATS.reduce((s, [k]) => s + (t.breakdown[k] || 0), 0) || 1;
            return (
              <li
                key={t.startMs}
                className={t.durMs >= 200 ? 'sev-critical' : 'sev-warning'}
              >
                <div className="task-head">
                  <b>{fmtMs(t.durMs)}</b>
                  <span>at {(t.startMs / 1000).toFixed(2)} s</span>
                  <span className="chip">{t.trigger.type}</span>
                  {t.trigger.detail && t.trigger.detail !== t.trigger.type && (
                    <span className="muted mono">{t.trigger.detail}</span>
                  )}
                  {t.thrash && (
                    <span className="chip chip-warn">layout thrashing</span>
                  )}
                  {t.forcedCount > 0 && (
                    <span className="muted">
                      {t.forcedCount} forced layouts
                    </span>
                  )}
                </div>
                <div className="breakdown-bar small">
                  {CATS.map(([k, label, color]) =>
                    t.breakdown[k] > 0 ? (
                      <span
                        key={k}
                        style={{
                          width: `${(t.breakdown[k] / sum) * 100}%`,
                          background: color,
                        }}
                        title={`${label}: ${fmtMs(t.breakdown[k])}`}
                      />
                    ) : null,
                  )}
                </div>
                <div className="task-cols">
                  <div>
                    <h4>Files</h4>
                    {t.topFiles.map(f => (
                      <button
                        key={f.file}
                        type="button"
                        className="link mono row"
                        onClick={() => onOpenFile(f.file)}
                      >
                        <span>{f.file}</span>
                        <b>{fmtMs(f.ms)}</b>
                      </button>
                    ))}
                  </div>
                  <div>
                    <h4>Functions</h4>
                    {t.topFunctions.map(f => (
                      <div
                        key={`${f.name}${f.file}${f.line}`}
                        className="row mono"
                      >
                        <span title={`${f.file}${f.line ? `:${f.line}` : ''}`}>
                          {f.name}()&nbsp;
                          <CodeRef
                            file={f.file}
                            line={f.line}
                            lineKind={f.lineKind}
                            abs={f.abs}
                            onOpenFile={onOpenFile}
                          />
                        </span>
                        <b>{fmtMs(f.ms)}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {report.forcedReflows.length > 0 && (
        <section className="pad">
          <h2>
            Forced reflows{' '}
            <span className="muted">
              (layout/style recalculated synchronously by script)
            </span>
          </h2>
          <table className="data">
            <thead>
              <tr>
                <th>Where</th>
                <th>Kind</th>
                <th>Count</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {report.forcedReflows.slice(0, 20).map(f => (
                <tr key={`${f.kind}${f.file}${f.fn}${f.line}`}>
                  <td>
                    <button
                      type="button"
                      className="link mono"
                      onClick={() => f.file && onOpenFile(f.file)}
                    >
                      {f.fn && f.fn !== '(anonymous)' ? `${f.fn} — ` : ''}
                      {f.file || 'unknown'}
                      {f.line ? `:${f.line}` : ''}
                    </button>
                  </td>
                  <td>{f.kind}</td>
                  <td className="num">{f.count}</td>
                  <td className="num">{fmtMs(f.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
