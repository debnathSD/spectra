import { useState } from 'react';
import { api } from '../api.js';
import { downloadBlob } from '../download.js';
import { DownloadIcon } from './Icons.jsx';
import CompareResults from './CompareResults.jsx';
import SidePicker from './SidePicker.jsx';

function PdfButtons({ comparison }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const save = async kind => {
    setBusy(kind);
    setError('');
    try {
      const { blob, name } = await api.comparePdf(comparison, kind);
      downloadBlob(blob, name);
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  };
  return (
    <span className="pdf-buttons">
      <button
        type="button"
        className="primary"
        disabled={Boolean(busy)}
        onClick={() => save('summary')}
      >
        {busy === 'summary' ? (
          'Preparing…'
        ) : (
          <>
            <DownloadIcon /> PDF summary
          </>
        )}
      </button>
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => save('detailed')}
      >
        {busy === 'detailed' ? (
          'Preparing…'
        ) : (
          <>
            <DownloadIcon /> PDF detailed report
          </>
        )}
      </button>
      {error && (
        <span className="warn" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * Compare tab: pick the recordings taken before and after a commit and see what
 * improved, degraded or stayed the same. All numbers come from shared/compare.js.
 */
export default function ComparePanel({ compare, savedReports, hideVendor }) {
  const {
    sides,
    comparison,
    addFiles,
    addSaved,
    removeRun,
    setLabel,
    lookupCommit,
    swap,
    reset,
  } = compare;
  const picker = (name, title, hint) => (
    <SidePicker
      title={title}
      hint={hint}
      side={sides[name]}
      saved={savedReports}
      onFiles={files => addFiles(name, files)}
      onSaved={id => addSaved(name, id)}
      onRemove={id => removeRun(name, id)}
      onLabel={label => setLabel(name, label)}
      onLookup={hash => lookupCommit(name, hash)}
    />
  );
  return (
    <div className="compare-panel">
      <div className="compare-intro">
        <h2>Compare two commits</h2>
        <p className="muted">
          Record the same scenario on the base commit and on the commit under
          review (<b>3 times each</b> is best), use{' '}
          <b>Snapshot for comparison</b> to save each recording, then upload
          them here. A change counts only if it is bigger than the noise between
          runs.
        </p>
      </div>
      <div className="sides">
        {picker('before', 'Before', '· base commit')}
        <div className="swap">
          <button
            type="button"
            onClick={swap}
            title="Swap before and after"
            aria-label="Swap before and after"
          >
            ⇄
          </button>
        </div>
        {picker('after', 'After', '· commit under review')}
      </div>
      {comparison ? (
        <>
          <div className="compare-toolbar">
            <span className="commit-pair">
              <code>{comparison.before.git?.shortHash || 'before'}</code>
              {comparison.before.git?.author && (
                <span className="muted"> ({comparison.before.git.author})</span>
              )}{' '}
              → <code>{comparison.after.git?.shortHash || 'after'}</code>
              {comparison.after.git?.author && (
                <span className="muted"> ({comparison.after.git.author})</span>
              )}
            </span>
            <span className="spacer" />
            <PdfButtons comparison={comparison} />
            <button type="button" onClick={reset}>
              Clear
            </button>
          </div>
          <CompareResults comparison={comparison} hideVendor={hideVendor} />
        </>
      ) : (
        <p className="empty">
          Add at least one recording on each side to see the comparison.
        </p>
      )}
    </div>
  );
}
