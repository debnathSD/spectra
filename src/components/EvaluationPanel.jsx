import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtMs } from '../format.js';

/**
 * Golden-path evaluation view: lists the `spectra performance` runs, and for
 * the selected one shows the performance matrix (baseline + each journey with
 * its automation result and key metrics). Each row opens its full report.
 */
export default function EvaluationPanel({ evaluations, onOpenReport }) {
  const [current, setCurrent] = useState(evaluations[0]?.id || '');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!current) {
      setDetail(null);
      return;
    }
    let live = true;
    setError('');
    api
      .evaluation(current)
      .then(d => live && setDetail(d))
      .catch(e => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [current]);

  if (!evaluations.length) {
    return (
      <div className="welcome">
        <div>
          <h2>No golden-path evaluations yet</h2>
          <p className="welcome-lead">
            Run <code>spectra performance</code> in your project. Spectra starts
            your dev server, auto-discovers the actionable elements, drives a set
            of golden-path journeys, and records each one. They’ll appear here as
            a performance matrix — every path openable as a full report.
          </p>
        </div>
      </div>
    );
  }

  const rows = detail ? [detail.baseline, ...detail.paths] : [];
  const passed = detail ? detail.paths.filter(p => p.ok).length : 0;

  return (
    <div className="eval-panel">
      <div className="eval-head">
        <select
          aria-label="Evaluation run"
          value={current}
          onChange={e => setCurrent(e.target.value)}
        >
          {evaluations.map(e => (
            <option key={e.id} value={e.id}>
              {new Date(e.createdAt).toLocaleString()} · {e.passed}/{e.pathCount}{' '}
              passed
            </option>
          ))}
        </select>
        {detail && (
          <span className="eval-summary">
            <span className="pill">{detail.discovered} actionable elements</span>
            <span className="pill">{detail.paths.length} golden paths</span>
            <span className={`pill ${passed === detail.paths.length ? 'ok' : 'warn'}`}>
              {passed}/{detail.paths.length} passed
            </span>
            {detail.skippedDestructive?.length > 0 && (
              <span className="pill" title={detail.skippedDestructive.map(s => s.name).join(', ')}>
                {detail.skippedDestructive.length} destructive skipped
              </span>
            )}
          </span>
        )}
      </div>

      {error && <div className="error" role="alert"><span>{error}</span></div>}

      {detail && (
        <>
          <div className="eval-target" title={detail.url}>
            {detail.target} — <span className="muted">{detail.url}</span>
          </div>
          <div className="eval-table-wrap">
            <table className="eval-matrix">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Golden path</th>
                  <th>Result</th>
                  <th className="num">TBT</th>
                  <th className="num">LCP</th>
                  <th className="num">Long tasks</th>
                  <th className="num">Findings</th>
                  <th>Top finding</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s = r.summary || {};
                  const top = s.topFinding;
                  return (
                    <tr key={r.id || i} className={r.ok ? '' : 'row-fail'}>
                      <td className="muted">{i === 0 ? '—' : i}</td>
                      <td>
                        <div className="eval-path-title">{r.title}</div>
                        {!r.ok && r.error && (
                          <div className="eval-path-error">{r.error}</div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${r.ok ? 'badge-pass' : 'badge-fail'}`}>
                          {r.ok ? 'PASS' : 'FAIL'}
                        </span>
                      </td>
                      <td className="num">{s.tbtMs == null ? '—' : fmtMs(s.tbtMs)}</td>
                      <td className="num">{s.lcpMs == null ? '—' : fmtMs(s.lcpMs)}</td>
                      <td className="num">{s.longTaskCount ?? '—'}</td>
                      <td className="num">{s.findingCount ?? '—'}</td>
                      <td>
                        {top ? (
                          <span className={`top-finding sev-${top.severity}`}>
                            [{top.severity}] {top.title}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.id && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => onOpenReport(r.id)}
                          >
                            Open report →
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted eval-foot">
            Automation: {passed}/{detail.paths.length} golden paths passed. Open any
            row for its full report — culprits, component re-renders, long tasks, PDF
            export and commit compare.
          </p>
        </>
      )}
    </div>
  );
}
