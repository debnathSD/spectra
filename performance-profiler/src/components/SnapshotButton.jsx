import { useState } from 'react';
import { snapshotFileName, withCommit } from '../../shared/snapshot.js';
import { api } from '../api.js';
import { downloadJson } from '../download.js';
import { DownloadIcon } from './Icons.jsx';

/**
 * Exports the open report as a snapshot named after its commit, for the Compare tab:
 * `perf_<commit>_<mode>_<time>[_<label>].json`. The commit is whatever git had
 * checked out when the recording was made, and can be corrected here.
 */
export default function SnapshotButton({ report }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hash, setHash] = useState(report.meta.git?.hash || '');
  const [git, setGit] = useState(report.meta.git || null);
  const [label, setLabel] = useState(report.meta.label || '');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const lookup = async () => {
    setState({ status: 'working', message: '' });
    try {
      const info = await api.gitCommit(hash.trim() || 'HEAD');
      setGit(info);
      setHash(info.hash);
      setState({ status: 'ok', message: '' });
      return info;
    } catch (err) {
      setState({ status: 'error', message: err.message });
      return null;
    }
  };

  const download = async () => {
    let commit = git;
    // A hash typed but never looked up: resolve it so the author is included.
    if (hash.trim() && hash.trim() !== git?.hash) commit = await lookup();
    if (!commit && hash.trim())
      commit = {
        hash: hash.trim(),
        shortHash: hash.trim().slice(0, 10),
        author: '',
      };
    downloadJson(
      withCommit(report, commit, label),
      snapshotFileName(report, commit, label),
    );
  };

  return (
    <span className="trace-button">
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
      >
        <DownloadIcon /> Snapshot for comparison
      </button>
      {isOpen && (
        <div
          className="trace-note snapshot"
          role="dialog"
          aria-label="Snapshot for comparison"
        >
          <button
            type="button"
            className="close"
            aria-label="Close"
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>
          <p>
            Saves this report as <code>perf_&lt;commit&gt;_…json</code>. Upload
            two of these in the <b>Compare</b> tab to see what a commit changed.
          </p>
          <label className="field">
            <span>Commit</span>
            <span className="field-row">
              <input
                value={hash}
                onChange={e => setHash(e.target.value)}
                placeholder="commit hash (blank = current HEAD)"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={lookup}
                disabled={state.status === 'working'}
              >
                Look up
              </button>
            </span>
          </label>
          {git && (
            <dl className="git-facts">
              <dt>Commit</dt>
              <dd className="mono">{git.shortHash}</dd>
              <dt>Author</dt>
              <dd>{git.author || 'unknown'}</dd>
              <dt>Message</dt>
              <dd>{git.subject || '–'}</dd>
              {git.branch && (
                <>
                  <dt>Branch</dt>
                  <dd>{git.branch}</dd>
                </>
              )}
            </dl>
          )}
          {git?.dirty && (
            <p className="warn">
              The working tree had uncommitted changes when this was recorded,
              so the commit may not describe exactly what was measured.
            </p>
          )}
          {!git && (
            <p className="muted">
              No commit was recorded with this report (it predates commit
              tracking). Enter the hash it was taken at.
            </p>
          )}
          {state.status === 'error' && <p className="warn">{state.message}</p>}
          <label className="field">
            <span>
              Scenario label <span className="muted">(optional)</span>
            </span>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. dashboard 579, page load"
            />
          </label>
          <button type="button" className="primary" onClick={download}>
            Download snapshot
          </button>
        </div>
      )}
    </span>
  );
}
