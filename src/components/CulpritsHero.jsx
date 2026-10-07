import { useMemo, useState } from 'react';
import { SEVERITY, topCulprits } from '../culprits.js';
import { fmtMs } from '../format.js';
import CodeRef from './CodeRef.jsx';
import CulpritSphere from './CulpritSphere.jsx';

const MAX_CULPRITS = 12;

function Insight({ item, onOpenFile, onJump }) {
  const sev = SEVERITY[item.severity];
  return (
    <div className={`insight sev-${item.severity}`} aria-live="polite">
      <div className="insight-head">
        <span className="badge-sev">
          <span aria-hidden="true">{sev.icon}</span> {sev.label}
        </span>
        <b className="insight-name">{item.name}()</b>
        <span className="insight-ms">{fmtMs(item.ms)}</span>
      </div>
      <CodeRef
        file={item.file}
        line={item.line}
        lineKind={item.lineKind}
        abs={item.abs}
        onOpenFile={onOpenFile}
      />
      {item.categories.length > 0 && (
        <p className="muted">
          Appears in {item.findings.length} finding
          {item.findings.length === 1 ? '' : 's'} · {item.categories.join(', ')}
        </p>
      )}
      {item.lead && (
        <p className="insight-fix">
          <b>What to do:</b> {item.lead.fix}
        </p>
      )}
      {item.lead && (
        <button type="button" onClick={() => onJump(item.lead.id)}>
          Show the finding
        </button>
      )}
    </div>
  );
}

/** Top culprits: the sphere, a ranked list for exact reading, and one insight card. */
export default function CulpritsHero({
  report,
  hideVendor,
  onOpenFile,
  onJump,
}) {
  const items = useMemo(
    () => topCulprits(report, hideVendor, MAX_CULPRITS),
    [report, hideVendor],
  );
  const [hoverKey, setHoverKey] = useState(null);
  const [pickedKey, setPickedKey] = useState(null);
  if (!items.length) return null;
  const shown =
    items.find(i => i.key === hoverKey) ||
    items.find(i => i.key === pickedKey) ||
    items[0];
  const maxMs = Math.max(1, ...items.map(i => i.ms));
  return (
    <section className="culprits-hero" aria-label="Top culprits">
      <div className="hero-sphere">
        <h2>
          Top culprits <span className="muted">· drag to rotate</span>
        </h2>
        <CulpritSphere
          items={items}
          activeKey={hoverKey}
          highlightKey={shown.key}
          onActivate={setHoverKey}
          onSelect={setPickedKey}
        />
      </div>
      <div className="hero-detail">
        <Insight item={shown} onOpenFile={onOpenFile} onJump={onJump} />
        <ol className="rank-list">
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                className={`rank-row sev-${item.severity} ${
                  shown.key === item.key ? 'active' : ''
                }`}
                onMouseEnter={() => setHoverKey(item.key)}
                onMouseLeave={() => setHoverKey(null)}
                onFocus={() => setHoverKey(item.key)}
                onBlur={() => setHoverKey(null)}
                onClick={() => setPickedKey(item.key)}
              >
                <span className="rank-n">{i + 1}</span>
                <span className="rank-name">{item.name}()</span>
                <span className="rank-bar">
                  <span style={{ width: `${(item.ms / maxMs) * 100}%` }} />
                </span>
                <span className="rank-ms">{fmtMs(item.ms)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
