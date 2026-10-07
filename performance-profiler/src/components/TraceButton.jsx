import { useState } from 'react';
import { api } from '../api.js';
import { fmtBytes } from '../format.js';
import { DownloadIcon } from './Icons.jsx';

/**
 * Writes the recording's raw trace to reports/<id>.trace.json so it can be opened
 * in Chrome DevTools → Performance → Load profile. (The report JSON itself is this
 * tool's own format and cannot be loaded there.)
 */
export default function TraceButton({ reportId }) {
  const [state, setState] = useState({ status: 'idle' });

  const save = async () => {
    setState({ status: 'working' });
    try {
      const result = await api.saveTrace(reportId);
      setState({ status: 'done', ...result });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  };

  return (
    <span className="trace-button">
      <button
        type="button"
        onClick={save}
        disabled={state.status === 'working'}
      >
        {state.status === 'working' ? (
          'Preparing…'
        ) : (
          <>
            <DownloadIcon /> Trace for Chrome DevTools
          </>
        )}
      </button>
      {state.status !== 'idle' && state.status !== 'working' && (
        <div className={`trace-note ${state.status}`} role="status">
          <button
            type="button"
            className="close"
            aria-label="Dismiss"
            onClick={() => setState({ status: 'idle' })}
          >
            ×
          </button>
          {state.status === 'error' ? (
            state.message
          ) : (
            <>
              <b>Saved</b> <code>{state.path}</code> ({fmtBytes(state.size)}).
              <ol>
                <li>
                  In Chrome open DevTools (<kbd>F12</kbd>) → <b>Performance</b>.
                </li>
                <li>
                  Click <b>Load profile…</b> (the ↑ icon) and choose that file —
                  or{' '}
                  <a
                    href={`/api/reports/${encodeURIComponent(reportId)}/trace`}
                    download
                  >
                    download it
                  </a>{' '}
                  first.
                </li>
              </ol>
            </>
          )}
        </div>
      )}
    </span>
  );
}
