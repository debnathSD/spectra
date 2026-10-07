import { useRef, useState } from 'react';
import { fmtMs } from '../format.js';

function CommitFacts({ git, runsCommit }) {
  if (!git)
    return (
      <p className="muted">
        No commit information yet: enter a hash and press Look up, or upload
        snapshots that carry one.
      </p>
    );
  const date = git.date
    ? new Date(git.date).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  return (
    <dl className="git-facts">
      <dt>Commit</dt>
      <dd className="mono">{git.shortHash || git.hash?.slice(0, 10)}</dd>
      <dt>Author</dt>
      <dd>{git.author || <span className="muted">unknown</span>}</dd>
      {date && (
        <>
          <dt>Date</dt>
          <dd>{date}</dd>
        </>
      )}
      {git.subject && (
        <>
          <dt>Message</dt>
          <dd>{git.subject}</dd>
        </>
      )}
      {git.branch && (
        <>
          <dt>Branch</dt>
          <dd>{git.branch}</dd>
        </>
      )}
      {runsCommit && runsCommit !== git.shortHash && (
        <>
          <dt>Runs say</dt>
          <dd className="mono">{runsCommit}</dd>
        </>
      )}
    </dl>
  );
}

/** One side of the comparison: commit details plus the recordings (snapshots) taken on that commit. */
export default function SidePicker({
  title,
  hint,
  side,
  saved,
  onFiles,
  onSaved,
  onRemove,
  onLabel,
  onLookup,
}) {
  const input = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hash, setHash] = useState(null);
  const git = side.git || side.runs[0]?.report.meta.git || null;
  const hashValue = hash ?? (side.hashInput || git?.shortHash || '');
  const addable = saved.filter(r => !side.runs.some(x => x.report.id === r.id));

  const drop = e => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };

  return (
    <section className="side-picker" aria-label={title}>
      <h3>
        {title} <span className="muted">{hint}</span>
      </h3>

      <label className="field">
        <span>Commit hash</span>
        <span className="field-row">
          <input
            value={hashValue}
            onChange={e => setHash(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onLookup(hashValue)}
            placeholder="e.g. 3fa516c"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => {
              onLookup(hashValue);
              setHash(null);
            }}
            disabled={side.lookup.status === 'working'}
          >
            {side.lookup.status === 'working' ? 'Looking up…' : 'Look up'}
          </button>
        </span>
      </label>
      <CommitFacts
        git={git}
        runsCommit={side.runs[0]?.report.meta.git?.shortHash}
      />
      {git?.dirty && (
        <p className="warn">
          This snapshot was recorded with uncommitted changes.
        </p>
      )}
      {side.lookup.status === 'error' && (
        <p className="warn">{side.lookup.message}</p>
      )}

      <label className="field">
        <span>
          Scenario <span className="muted">(optional)</span>
        </span>
        <input
          value={side.label}
          onChange={e => onLabel(e.target.value)}
          placeholder={
            side.runs[0]?.report.meta.title || 'e.g. dashboard 579, page load'
          }
        />
      </label>

      <div
        className={`dropzone ${isDragging ? 'dragging' : ''}`}
        onDragOver={e => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={drop}
      >
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={e => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => input.current.click()}
        >
          Upload snapshot(s)
        </button>
        <span className="muted">
          or drop <code>perf_*.json</code> files here. Several runs of the same
          commit are welcome: medians are used.
        </span>
      </div>
      {addable.length > 0 && (
        <select
          aria-label={`Add a saved report to ${title}`}
          value=""
          onChange={e => e.target.value && onSaved(e.target.value)}
        >
          <option value="">…or add a report recorded on this machine</option>
          {addable.map(r => (
            <option key={r.id} value={r.id}>
              {new Date(r.createdAt).toLocaleString()} · {r.mode} ·{' '}
              {fmtMs(r.durationMs)}
            </option>
          ))}
        </select>
      )}

      {side.problems.map(p => (
        <p key={p} className="warn" role="alert">
          {p}
        </p>
      ))}
      <ul className="run-chips">
        {side.runs.map(({ report, fileName }) => (
          <li key={report.id}>
            <span className="mono" title={fileName}>
              {fileName.replace(/^reports\//, '')}
            </span>
            <span className="muted">
              {report.meta.mode === 'load' ? 'load' : 'interaction'} ·{' '}
              {fmtMs(report.meta.durationMs)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${fileName}`}
              onClick={() => onRemove(report.id)}
            >
              ×
            </button>
          </li>
        ))}
        {!side.runs.length && <li className="muted">No recordings yet.</li>}
      </ul>
    </section>
  );
}
