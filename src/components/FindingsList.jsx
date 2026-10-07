import { useEffect, useMemo, useRef, useState } from 'react';
import { SEVERITY, SEVERITY_RANK, groupFindings } from '../culprits.js';
import { fmtMs, splitPath } from '../format.js';
import CodeRef from './CodeRef.jsx';
import { ChevronIcon } from './Icons.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warnings' },
  { id: 'info', label: 'Notes' },
];

function CulpritTable({ culprits, onOpenFile }) {
  const maxMs = Math.max(1, ...culprits.map(c => c.ms || 0));
  return (
    <table className="data culprit-table">
      <thead>
        <tr>
          <th>Function</th>
          <th>Where</th>
          <th className="num">Time</th>
        </tr>
      </thead>
      <tbody>
        {culprits.map(c => (
          <tr key={`${c.fn}|${c.file}|${c.line}`}>
            <td>
              <code className="fn">{c.fn || '(unknown)'}()</code>
              {c.note && <div className="muted small">{c.note}</div>}
            </td>
            <td>
              <CodeRef
                file={c.file}
                line={c.line}
                lineKind={c.lineKind}
                abs={c.abs}
                onOpenFile={onOpenFile}
              />
            </td>
            <td className="num">
              {c.ms > 0 && (
                <>
                  {fmtMs(c.ms)}
                  <div className="bar">
                    <span style={{ width: `${(c.ms / maxMs) * 100}%` }} />
                  </div>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FixCallout({ fix }) {
  if (!fix) return null;
  return (
    <div className="fix-callout">
      <span className="fix-label">What to do</span>
      <p>{fix}</p>
    </div>
  );
}

function FindingBody({ finding, onOpenFile }) {
  return (
    <div className="fbody">
      <FixCallout fix={finding.fix} />
      {finding.detail && (
        <p className="fdetail">
          <b>Why it matters</b>
          {finding.detail}
        </p>
      )}
      {finding.culprits?.length > 0 && (
        <CulpritTable culprits={finding.culprits} onOpenFile={onOpenFile} />
      )}
      {!finding.culprits?.length && finding.file && (
        <button type="button" onClick={() => onOpenFile(finding.file)}>
          Open {finding.file}
        </button>
      )}
    </div>
  );
}

function RowHead({
  severity,
  title,
  chips,
  impactMs,
  maxImpact,
  isOpen,
  onToggle,
  subtitle,
}) {
  const sev = SEVERITY[severity];
  return (
    <button
      type="button"
      className="frow-head"
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span className="sev-badge" aria-label={sev.label} title={sev.label}>
        {sev.icon}
      </span>
      <span className="frow-main">
        <span className="frow-title">{title}</span>
        {subtitle && <span className="frow-sub muted">{subtitle}</span>}
      </span>
      <span className="frow-chips">
        {chips.map(c => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </span>
      <span className="impact">
        {impactMs > 0 ? (
          <>
            <span className="impact-bar">
              <span
                style={{
                  width: `${Math.max(4, (impactMs / maxImpact) * 100)}%`,
                }}
              />
            </span>
            <span className="impact-ms">{fmtMs(impactMs)}</span>
          </>
        ) : (
          <span className="muted">–</span>
        )}
      </span>
      <ChevronIcon isUp={isOpen} />
    </button>
  );
}

function SingleRow({
  finding,
  maxImpact,
  isOpen,
  onToggle,
  onOpenFile,
  rowRef,
}) {
  return (
    <li
      ref={rowRef}
      className={`frow sev-${finding.severity} ${isOpen ? 'open' : ''}`}
    >
      <RowHead
        severity={finding.severity}
        title={finding.title}
        subtitle={finding.file ? splitPath(finding.file).name : ''}
        chips={[finding.category]}
        impactMs={finding.impactMs}
        maxImpact={maxImpact}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen && <FindingBody finding={finding} onOpenFile={onOpenFile} />}
    </li>
  );
}

function GroupRow({
  group,
  maxImpact,
  openIds,
  onToggle,
  onOpenFile,
  rowRefs,
}) {
  const isOpen = openIds.has(group.id);
  const count = group.members.length;
  const name = `${group.culprit.fn || '(unknown)'}()`;
  return (
    <li
      ref={el => rowRefs.current.set(group.id, el)}
      className={`frow group sev-${group.severity} ${isOpen ? 'open' : ''}`}
    >
      <RowHead
        severity={group.severity}
        title={`${name} is behind ${count} findings`}
        subtitle={splitPath(group.culprit.file).name}
        chips={[...new Set(group.members.map(m => m.category))]}
        impactMs={group.impactMs}
        maxImpact={maxImpact}
        isOpen={isOpen}
        onToggle={() => onToggle(group.id)}
      />
      {isOpen && (
        <div className="fbody">
          <FixCallout fix={group.lead.fix} />
          <CulpritTable culprits={[group.culprit]} onOpenFile={onOpenFile} />
          <h4 className="members-title">Findings it causes</h4>
          <ul className="members">
            {group.members.map(m => (
              <SingleRow
                key={m.id}
                finding={m}
                maxImpact={group.impactMs}
                isOpen={openIds.has(m.id)}
                onToggle={() => onToggle(m.id)}
                onOpenFile={onOpenFile}
                rowRef={el => rowRefs.current.set(m.id, el)}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Findings as a scannable list: root causes grouped, one line each, details
 * (what to do first, then why, then the exact code) only when expanded.
 */
export default function FindingsList({ findings, onOpenFile, focus }) {
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const items = useMemo(
    () =>
      groupFindings(
        findings.filter(
          f =>
            (severity === 'all' || f.severity === severity) &&
            (category === 'all' || f.category === category),
        ),
      ),
    [findings, severity, category],
  );
  const [openIds, setOpenIds] = useState(() => {
    const first = groupFindings(findings)[0];
    return new Set(first ? [first.id] : []);
  });
  const rowRefs = useRef(new Map());
  const pendingScroll = useRef(null);

  const categories = useMemo(
    () => [...new Set(findings.map(f => f.category))].sort(),
    [findings],
  );
  const counts = useMemo(
    () => ({
      all: findings.length,
      ...Object.fromEntries(
        Object.keys(SEVERITY_RANK).map(s => [
          s,
          findings.filter(f => f.severity === s).length,
        ]),
      ),
    }),
    [findings],
  );
  const maxImpact = Math.max(1, ...items.map(i => i.impactMs));

  const toggle = id =>
    setOpenIds(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  useEffect(() => {
    if (!focus) return;
    const target = groupFindings(findings).find(
      i => i.id === focus.id || i.members?.some(m => m.id === focus.id),
    );
    if (!target) return;
    setSeverity('all');
    setCategory('all');
    setOpenIds(prev => new Set([...prev, target.id, focus.id]));
    pendingScroll.current = focus.id;
    // Only a new jump request should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.tick]);

  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    const el = rowRefs.current.get(id);
    if (el) {
      pendingScroll.current = null;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  return (
    <div className="findings-list">
      <div className="findings-toolbar">
        <div className="segmented" role="group" aria-label="Filter by severity">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              aria-pressed={severity === f.id}
              onClick={() => setSeverity(f.id)}
            >
              {f.label} <span className="muted">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        {categories.length > 1 && (
          <select
            aria-label="Filter by category"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="ghost"
          onClick={() =>
            setOpenIds(
              new Set(
                items.flatMap(i =>
                  i.kind === 'group'
                    ? [i.id, ...i.members.map(m => m.id)]
                    : [i.id],
                ),
              ),
            )
          }
        >
          Expand all
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setOpenIds(new Set())}
        >
          Collapse all
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted pad">Nothing matches these filters.</p>
      ) : (
        <ul className="frows">
          {items.map(item =>
            item.kind === 'group' ? (
              <GroupRow
                key={item.id}
                group={item}
                maxImpact={maxImpact}
                openIds={openIds}
                onToggle={toggle}
                onOpenFile={onOpenFile}
                rowRefs={rowRefs}
              />
            ) : (
              <SingleRow
                key={item.id}
                finding={item.finding}
                maxImpact={maxImpact}
                isOpen={openIds.has(item.id)}
                onToggle={() => toggle(item.id)}
                onOpenFile={onOpenFile}
                rowRef={el => rowRefs.current.set(item.id, el)}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
