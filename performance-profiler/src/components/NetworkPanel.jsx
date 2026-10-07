import { fmtBytes, fmtMs, fmtNumber } from '../format.js';

function Table({ title, rows, columns }) {
  if (!rows.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <table className="data">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.label}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.url}${r.startMs}`}>
              {columns.map(c => (
                <td
                  key={c.label}
                  className={c.num ? 'num' : 'mono'}
                  title={c.title?.(r)}
                >
                  {c.get(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function NetworkPanel({ report }) {
  const { network, memory, totals } = report;
  const cols = [
    { label: 'Resource', get: r => r.name, title: r => r.url },
    { label: 'Type', get: r => r.type },
    { label: 'Time', get: r => fmtMs(r.durMs), num: true },
    { label: 'Over the wire', get: r => fmtBytes(r.encoded), num: true },
    { label: 'Decoded', get: r => fmtBytes(r.decoded), num: true },
  ];
  return (
    <div className="network pad">
      <div className="summary-row">
        <span>{fmtNumber(network.count)} requests</span>
        <span>{fmtBytes(network.totalEncoded)} transferred</span>
        <span>{fmtBytes(network.totalDecoded)} decoded</span>
        <span>{fmtNumber(memory.domNodes)} DOM nodes</span>
        <span>{fmtNumber(memory.listeners)} event listeners</span>
        <span>
          heap {memory.heapUsedMb} MB ({memory.heapGrowthMb >= 0 ? '+' : ''}
          {memory.heapGrowthMb} MB)
        </span>
        <span>
          {fmtNumber(totals.layoutCount)} layouts ·{' '}
          {fmtNumber(totals.styleRecalcCount)} style recalcs
        </span>
      </div>
      <Table title="Slowest requests" rows={network.slow} columns={cols} />
      <Table title="Largest resources" rows={network.large} columns={cols} />
      <Table
        title="Served uncompressed"
        rows={network.uncompressed}
        columns={cols}
      />
      {network.duplicates.length > 0 && (
        <section>
          <h2>Requested repeatedly</h2>
          <ul>
            {network.duplicates.map(d => (
              <li key={d.url} title={d.url}>
                {d.name} <b>{d.count}×</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.vitals.shifts.length > 0 && (
        <section>
          <h2>Layout shifts</h2>
          <ul>
            {report.vitals.shifts.map(s => (
              <li key={`${s.start}${s.value}`}>
                <b>{s.value}</b> at {(s.start / 1000).toFixed(2)} s{' '}
                {s.sources.length > 0 && (
                  <span className="mono muted">— {s.sources.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
