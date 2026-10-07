import { useState } from 'react';
import { fmtMs } from '../format.js';
import CodeRef from './CodeRef.jsx';
import CulpritsHero from './CulpritsHero.jsx';
import FindingsList from './FindingsList.jsx';
import TimeBreakdown from './TimeBreakdown.jsx';
import Vitals from './Vitals.jsx';

function HotFunctions({ report, hideVendor, onOpenFile }) {
  const rows = (report.hotFunctions || [])
    .filter(f => !(hideVendor && f.vendor))
    .slice(0, 15);
  if (!rows.length) return null;
  return (
    <section>
      <h2>
        Slowest functions{' '}
        <span className="muted">(by time spent in the function itself)</span>
      </h2>
      <table className="data hot-functions">
        <thead>
          <tr>
            <th>#</th>
            <th>Function</th>
            <th>File</th>
            <th>Self</th>
            <th>With callees</th>
            <th>% of CPU</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr
              key={`${f.file}|${f.name}|${f.bundleLine}`}
              className={f.vendor ? 'vendor-row' : ''}
            >
              <td className="num">{i + 1}</td>
              <td>
                <code className="fn">{f.name}()</code>
              </td>
              <td>
                <CodeRef
                  file={f.file}
                  line={f.line}
                  lineKind={f.lineKind}
                  abs={f.abs}
                  onOpenFile={onOpenFile}
                />
              </td>
              <td className="num">{fmtMs(f.selfMs)}</td>
              <td className="num">{fmtMs(f.totalMs)}</td>
              <td className="num">{f.share}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Culprits({ report, hideVendor, onOpenFile }) {
  const [focus, setFocus] = useState(null);
  const counts = report.findings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }),
    {},
  );
  return (
    <div className="culprits">
      <CulpritsHero
        report={report}
        hideVendor={hideVendor}
        onOpenFile={onOpenFile}
        onJump={id => setFocus(prev => ({ id, tick: (prev?.tick || 0) + 1 }))}
      />
      <Vitals report={report} />
      <section>
        <h2>Where main-thread time went</h2>
        <TimeBreakdown totals={report.totals} />
      </section>
      <HotFunctions
        report={report}
        hideVendor={hideVendor}
        onOpenFile={onOpenFile}
      />
      <section>
        <h2>
          Findings{' '}
          <span className="muted">
            {counts.critical || 0} critical · {counts.warning || 0} warnings ·{' '}
            {counts.info || 0} notes
          </span>
        </h2>
        {report.findings.length === 0 ? (
          <p className="muted">
            Nothing stood out in this recording. Try a longer or more demanding
            interaction.
          </p>
        ) : (
          <FindingsList
            findings={report.findings}
            onOpenFile={onOpenFile}
            focus={focus}
          />
        )}
      </section>
      {report.notes.length > 0 && (
        <section>
          <h2>Notes</h2>
          <ul>
            {report.notes.map(n => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
