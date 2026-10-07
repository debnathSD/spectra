import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtMs, fmtNumber } from '../format.js';
import { highlightSource } from '../highlight.js';

function Metric({ label, value, warn }) {
  return (
    <div className={`metric ${warn ? 'warn' : ''}`}>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function Source({ path, functions }) {
  const [state, setState] = useState({ status: 'loading', file: null });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', file: null });
    api
      .source(path)
      .then(file => !cancelled && setState({ status: 'ready', file }))
      .catch(() => !cancelled && setState({ status: 'missing', file: null }));
    return () => {
      cancelled = true;
    };
  }, [path]);

  // highlight.js escapes everything it emits and highlightSource escapes the
  // fallback path, so the markup never contains raw file content.
  const html = useMemo(
    () => (state.file ? highlightSource(path, state.file.content) : ''),
    [state.file, path],
  );
  const hot = useMemo(() => {
    const map = new Map();
    for (const fn of functions)
      if (fn.line && fn.selfMs >= 0.5) map.set(fn.line, fn);
    return map;
  }, [functions]);

  if (state.status === 'loading')
    return <div className="empty">Loading source…</div>;
  if (state.status === 'missing') {
    return (
      <div className="empty">
        Source not found on disk for <code>{path}</code>. Bundled or generated
        files have no source file.
      </div>
    );
  }
  const lineCount = state.file.content.split('\n').length;
  return (
    <div className="code-scroll">
      <div className="gutter">
        {Array.from({ length: lineCount }, (_, i) => {
          const fn = hot.get(i + 1);
          return (
            <div
              key={i + 1}
              className={`gutter-line ${fn ? 'gutter-hot' : ''}`}
              title={fn ? `${fn.name}: ${fmtMs(fn.selfMs)} self` : undefined}
            >
              {fn ? `${fmtMs(fn.selfMs)} ` : ''}
              {i + 1}
            </div>
          );
        })}
      </div>
      <pre className="code">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

export default function FilePanel({ report, path, onClose }) {
  const [tab, setTab] = useState('functions');
  const file = report.files.find(f => f.path === path);
  const relatedFindings = report.findings.filter(f => f.file === path);
  const maxSelf = Math.max(
    ...(file?.functions.map(f => f.selfMs) || [0]),
    0.001,
  );
  const canShowSource = !path.startsWith('bundle:') && !path.startsWith('(');

  return (
    <aside className="file-panel" aria-label="Selected file">
      <div className="panel-head">
        <h2 title={path}>{path}</h2>
        <button type="button" onClick={onClose} aria-label="Close file panel">
          ×
        </button>
      </div>
      {file ? (
        <div className="metrics">
          <Metric label="CPU self" value={fmtMs(file.selfMs)} />
          <Metric label="CPU inclusive" value={fmtMs(file.totalMs)} />
          <Metric
            label="Blocking"
            value={fmtMs(file.blockMs)}
            warn={file.blockMs > 0}
          />
          <Metric label="React renders" value={fmtNumber(file.renders)} />
          <Metric
            label="Wasted"
            value={fmtNumber(file.wasted)}
            warn={file.wasted > 0}
          />
          <Metric
            label="Forced reflows"
            value={fmtNumber(file.forcedCount)}
            warn={file.forcedCount > 0}
          />
        </div>
      ) : (
        <p className="muted pad">
          No profile samples were recorded for this file.
        </p>
      )}
      {relatedFindings.length > 0 && (
        <ul className="mini-findings">
          {relatedFindings.map(f => (
            <li key={f.id} className={`sev-${f.severity}`}>
              {f.title}
              <div className="muted">{f.fix}</div>
            </li>
          ))}
        </ul>
      )}
      <div role="tablist" className="tabs">
        {[
          ['functions', 'Functions'],
          ['components', 'Components'],
          ['source', 'Source'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'functions' && (
          <table className="data">
            <thead>
              <tr>
                <th>Function</th>
                <th>Self</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(file?.functions || []).map(fn => (
                <tr key={`${fn.name}${fn.line}${fn.bundleLine}`}>
                  <td className="mono">
                    {fn.name}()
                    <span className="muted">
                      {' '}
                      {fn.line
                        ? `:${fn.lineKind === 'located' ? '≈' : ''}${fn.line}`
                        : fn.bundleLine
                          ? `(bundle line ${fn.bundleLine})`
                          : ''}
                    </span>
                    <div className="bar">
                      <span
                        style={{ width: `${(fn.selfMs / maxSelf) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="num">{fmtMs(fn.selfMs)}</td>
                  <td className="num">{fmtMs(fn.totalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'components' &&
          ((file?.components.length || 0) === 0 ? (
            <p className="muted pad">
              No React components from this file rendered.
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Renders</th>
                  <th>Wasted</th>
                  <th>Self</th>
                </tr>
              </thead>
              <tbody>
                {file.components.map(c => (
                  <tr key={`${c.name}${c.line}`}>
                    <td className="mono">
                      {c.name}
                      {c.line ? <span className="muted">:{c.line}</span> : null}
                    </td>
                    <td className="num">{fmtNumber(c.renders)}</td>
                    <td className={`num ${c.wasted ? 'warn' : ''}`}>
                      {fmtNumber(c.wasted)}
                    </td>
                    <td className="num">{fmtMs(c.selfMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === 'source' &&
          (canShowSource ? (
            <Source path={path} functions={file?.functions || []} />
          ) : (
            <div className="empty">This is a bundle, not a source file.</div>
          ))}
      </div>
    </aside>
  );
}
