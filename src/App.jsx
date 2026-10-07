import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import AppearanceMenu from './components/AppearanceMenu.jsx';
import { CallHeatTree, FileHeatTree } from './components/HeatTrees.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import ControlBar from './components/ControlBar.jsx';
import Culprits from './components/Culprits.jsx';
import FilePanel from './components/FilePanel.jsx';
import LongTasks from './components/LongTasks.jsx';
import NetworkPanel from './components/NetworkPanel.jsx';
import PageMap from './components/PageMap.jsx';
import ReactPanel from './components/ReactPanel.jsx';
import SnapshotButton from './components/SnapshotButton.jsx';
import TraceButton from './components/TraceButton.jsx';
import { fmtMs } from './format.js';
import { useCompare } from './hooks/useCompare.js';
import { useSession } from './hooks/useSession.js';
import { useAppearance } from './theme.js';

const TABS = [
  { id: 'culprits', label: 'Culprits' },
  { id: 'page', label: 'Page map' },
  { id: 'files', label: 'File tree' },
  { id: 'calls', label: 'Call tree' },
  { id: 'react', label: 'React' },
  { id: 'tasks', label: 'Long tasks' },
  { id: 'network', label: 'Network & memory' },
  { id: 'compare', label: 'Compare commits' },
];

function ReportPicker({ reports, current, onPick, onDelete }) {
  if (!reports.length)
    return <span className="muted">No saved reports yet</span>;
  return (
    <span className="report-picker">
      <select
        aria-label="Saved report"
        value={current || ''}
        onChange={e => onPick(e.target.value)}
      >
        {!current && <option value="">Open a saved report…</option>}
        {reports.map(r => (
          <option key={r.id} value={r.id}>
            {new Date(r.createdAt).toLocaleString()} · {r.mode} ·{' '}
            {fmtMs(r.durationMs)} · {r.critical} critical
          </option>
        ))}
      </select>
      {current && (
        <button
          type="button"
          className="ghost destructive"
          onClick={() => onDelete(current)}
          aria-label="Delete this report"
        >
          Delete
        </button>
      )}
    </span>
  );
}

const STEPS = [
  {
    title: 'Start the frontend',
    body: (
      <>
        Run <code>npm run dev-server</code> (usually on port 9000). A{' '}
        <b>development</b> build gives per-file and per-component results.
      </>
    ),
  },
  {
    title: 'Launch Chrome',
    body: (
      <>
        Click <b>Launch Chrome</b>, sign in to the app in the window that opens,
        and navigate to the page you care about.
      </>
    ),
  },
  {
    title: 'Record',
    body: (
      <>
        Press <b>Record interaction</b>, use the page, then <b>Stop</b> — or use{' '}
        <b>Record page load</b> for startup performance.
      </>
    ),
  },
];

function Welcome({ onCompare }) {
  return (
    <div className="welcome">
      <div>
        <h2>Find what makes the frontend slow</h2>
        <p className="welcome-lead">
          Ranked culprits, heat trees, React re-renders, long tasks and network
          findings from a single recording.
        </p>
      </div>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="step-num">{i + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="welcome-foot">
        Reviewing a PR? Use{' '}
        <button type="button" className="link" onClick={onCompare}>
          Compare commits
        </button>{' '}
        to see what a commit changed.
      </p>
    </div>
  );
}

export default function App() {
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState('culprits');
  const [selectedFile, setSelectedFile] = useState(null);
  const [hideVendor, setHideVendor] = useState(false);
  const [revealTick, setRevealTick] = useState(0);
  const compare = useCompare();
  const [appearance, setAppearance] = useAppearance();

  const openReport = useCallback(async id => {
    const data = await api.report(id);
    setReport(data);
    setSelectedFile(null);
    setTab('culprits');
  }, []);
  const { status, reports, error, clearError, run, refreshReports } =
    useSession({ onReport: openReport });

  // Open the newest saved report on first load so the page is never empty.
  useEffect(() => {
    if (!report && reports.length) openReport(reports[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports.length]);

  const openFile = useCallback(path => {
    setSelectedFile(path);
    setRevealTick(t => t + 1);
    setTab(t =>
      t === 'culprits' || t === 'network' || t === 'tasks' ? 'files' : t,
    );
  }, []);

  const deleteReport = async id => {
    await api.deleteReport(id);
    setReport(null);
    refreshReports();
  };

  const showPanel =
    selectedFile &&
    report &&
    ['files', 'calls', 'react', 'culprits', 'tasks', 'page'].includes(tab);
  const inCompare = tab === 'compare';
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path
                d="M1.5 8.5h3l2-5 3 9 2-4h3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h1>Performance Profiler</h1>
            <small>{status?.defaultName || 'target-frontend'}</small>
          </div>
        </div>
        <span className="spacer" />
        <ReportPicker
          reports={reports}
          current={report?.id}
          onPick={openReport}
          onDelete={deleteReport}
        />
        <AppearanceMenu appearance={appearance} onChange={setAppearance} />
      </header>
      <ControlBar status={status} run={run} isCompact={Boolean(report)} />
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      <div className="workspace">
        {report && !inCompare && (
          <div className="report-bar">
            <span className="report-title" title={report.meta.url}>
              {report.meta.title || report.meta.url}
            </span>
            <span className="report-meta">
              <span className="pill">
                {report.meta.mode === 'load' ? 'Page load' : 'Interaction'}
              </span>
              <span className="pill">{fmtMs(report.meta.durationMs)}</span>
              {report.meta.cpuThrottle > 1 && (
                <span className="pill warn">
                  {report.meta.cpuThrottle}× CPU slowdown
                </span>
              )}
              <span className="pill">
                Attribution: {report.meta.attribution}
              </span>
              {report.meta.git && (
                <span className="pill">
                  Commit <code>{report.meta.git.shortHash}</code>
                  {report.meta.git.dirty ? ' · uncommitted changes' : ''}
                </span>
              )}
            </span>
            <span className="spacer" />
            <span className="btn-group">
              <SnapshotButton key={`snap-${report.id}`} report={report} />
              <TraceButton key={report.id} reportId={report.id} />
            </span>
          </div>
        )}
        <div className="tabs main-tabs">
          <div role="tablist" className="tab-list" aria-label="Report views">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={
                  tab === t.id && (Boolean(report) || t.id === 'compare')
                }
                disabled={!report && t.id !== 'compare'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'culprits' && report && (
                  <span className="count">{report.findings.length}</span>
                )}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={hideVendor}
              onChange={e => setHideVendor(e.target.checked)}
            />
            Hide node_modules
          </label>
        </div>
        {inCompare && (
          <main className="main">
            <div className="content">
              <ComparePanel
                compare={compare}
                savedReports={reports}
                hideVendor={hideVendor}
              />
            </div>
          </main>
        )}
        {!inCompare && report && (
          <main className="main">
            <div className="content">
              {tab === 'culprits' && (
                <Culprits
                  key={report.id}
                  report={report}
                  hideVendor={hideVendor}
                  onOpenFile={openFile}
                />
              )}
              {tab === 'page' && (
                <PageMap
                  report={report}
                  hideVendor={hideVendor}
                  onOpenFile={openFile}
                />
              )}
              {tab === 'files' && (
                <FileHeatTree
                  report={report}
                  hideVendor={hideVendor}
                  selectedPath={selectedFile}
                  revealTick={revealTick}
                  onSelectFile={setSelectedFile}
                />
              )}
              {tab === 'calls' && (
                <CallHeatTree report={report} onSelectFile={setSelectedFile} />
              )}
              {tab === 'react' && (
                <ReactPanel
                  report={report}
                  hideVendor={hideVendor}
                  onOpenFile={openFile}
                />
              )}
              {tab === 'tasks' && (
                <LongTasks report={report} onOpenFile={openFile} />
              )}
              {tab === 'network' && <NetworkPanel report={report} />}
            </div>
            {showPanel && (
              <FilePanel
                report={report}
                path={selectedFile}
                onClose={() => setSelectedFile(null)}
              />
            )}
          </main>
        )}
        {!inCompare && !report && (
          <Welcome onCompare={() => setTab('compare')} />
        )}
      </div>
    </div>
  );
}
