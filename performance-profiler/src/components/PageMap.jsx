import { useMemo, useState } from 'react';
import { fmtMs, fmtNumber } from '../format.js';

const MAX_PINS = 14;
const MIN_SELF_MS = 0.5;
const HUGE_AREA = 0.7;

const REASON_LABELS = {
  props: 'props changed',
  state: 'state changed',
  hooks: 'hook state changed',
  context: 'context changed',
  parent: 'parent re-rendered with nothing new',
};

function buildPins(report, hideVendor) {
  const { pageView } = report;
  const byId = new Map(report.react.components.map(c => [c.id, c]));
  const viewArea = pageView.width * pageView.height;
  const candidates = [];
  for (const entry of pageView.entries) {
    const c = byId.get(entry.id);
    if (!c || (hideVendor && c.vendor)) continue;
    if (c.selfMs < MIN_SELF_MS && !c.wasted) continue;
    const [x, y, w, h] = entry.rects[0];
    candidates.push({ c, rect: { x, y, w, h }, count: entry.count });
  }
  // Page-sized wrappers say nothing about where the time goes; keep them only
  // when nothing smaller was found.
  const focused = candidates.filter(
    p => (p.rect.w * p.rect.h) / viewArea < HUGE_AREA,
  );
  const pool = focused.length ? focused : candidates;
  return pool
    .sort((a, b) => b.c.selfMs + b.c.wastedMs - (a.c.selfMs + a.c.wastedMs))
    .slice(0, MAX_PINS)
    .map((p, i) => ({ ...p, key: `${p.c.id}`, n: i + 1 }));
}

function severityOf(c, maxSelf) {
  if (c.renders && c.wasted / c.renders > 0.5 && c.wasted > 5) return 'warn';
  return c.selfMs >= maxSelf * 0.5 ? 'hot' : 'mild';
}

function topReason(c) {
  const [key, n] =
    Object.entries(c.reasons).sort((a, b) => b[1] - a[1])[0] || [];
  return n ? `${n}× ${REASON_LABELS[key]}` : null;
}

function Details({ pin }) {
  const { c } = pin;
  const reason = topReason(c);
  const unstable = c.unstableProps[0];
  return (
    <div className="pin-card-body">
      <div className="pin-card-title">
        <span className="pin-num">{pin.n}</span>
        <b>{c.name}</b>
      </div>
      <code className="pin-file">
        {c.file ? `${c.file}${c.line ? `:${c.line}` : ''}` : 'file unknown'}
      </code>
      <dl className="pin-stats">
        <div>
          <dt>Self time</dt>
          <dd>{fmtMs(c.selfMs)}</dd>
        </div>
        <div>
          <dt>Renders</dt>
          <dd>{fmtNumber(c.renders)}</dd>
        </div>
        <div>
          <dt>Wasted</dt>
          <dd className={c.wasted ? 'warn' : ''}>{fmtNumber(c.wasted)}</dd>
        </div>
        <div>
          <dt>Slowest</dt>
          <dd>{fmtMs(c.maxMs)}</dd>
        </div>
      </dl>
      {reason && <p>Mostly {reason}.</p>}
      {unstable && (
        <p className="pin-fix">
          Fix: <code>{unstable.prop}</code> is a new {unstable.kind} on almost
          every render — memoize it or pass a stable reference.
        </p>
      )}
      {!unstable && c.wasted > 0 && (
        <p className="pin-fix">
          Fix: {fmtNumber(c.wasted)} renders changed nothing — wrap in{' '}
          <code>React.memo</code> or stop the parent re-rendering.
        </p>
      )}
      {pin.count > 1 && (
        <p className="muted">
          {pin.count} instances on screen; the largest is outlined.
        </p>
      )}
    </div>
  );
}

const GUTTER_RATIO = 0.06;
const MIN_GUTTER = 56;
const MARKER_GAP_RATIO = 0.058;
const ANCHOR_INSET = 8;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Puts each pin's number in the left or right gutter (nearer side), as close as
 * possible to the element's height but never closer than `gap` to a neighbour,
 * so numbers never overlap however the elements are nested.
 */
function placeMarkers(pins, view, gutter) {
  const gap = view.height * MARKER_GAP_RATIO;
  const placed = new Map();
  ['left', 'right'].forEach(side => {
    const group = pins
      .filter(
        p =>
          (p.rect.x + p.rect.w / 2 < view.width / 2 ? 'left' : 'right') ===
          side,
      )
      .map(pin => ({ pin, y: pin.rect.y + pin.rect.h / 2 }))
      .sort((a, b) => a.y - b.y);
    group.forEach((g, i) => {
      g.y = Math.max(gap / 2, i ? Math.max(g.y, group[i - 1].y + gap) : g.y);
    });
    for (let i = group.length - 1; i >= 0; i -= 1) {
      const limit =
        i === group.length - 1 ? view.height - gap / 2 : group[i + 1].y - gap;
      group[i].y = Math.min(group[i].y, limit);
    }
    group.forEach(({ pin, y }) => {
      const { x, y: top, w, h } = pin.rect;
      const inset = Math.min(ANCHOR_INSET, w / 4);
      placed.set(pin.key, {
        side,
        markerX: side === 'left' ? gutter / 2 : view.width + gutter * 1.5,
        markerY: y,
        anchorX: gutter + (side === 'left' ? x + inset : x + w - inset),
        anchorY: clamp(y, top + 4, top + h - 4),
      });
    });
  });
  return placed;
}

function Callouts({ pins, pageView, active, onActivate, onOpenFile, maxSelf }) {
  const gutter = Math.max(MIN_GUTTER, pageView.width * GUTTER_RATIO);
  const totalWidth = pageView.width + gutter * 2;
  const placed = useMemo(
    () => placeMarkers(pins, pageView, gutter),
    [pins, pageView, gutter],
  );
  const pctX = v => `${(v / totalWidth) * 100}%`;
  const pctY = v => `${(v / pageView.height) * 100}%`;
  const activePlace = active ? placed.get(active.key) : null;
  return (
    <div
      className="page-frame"
      style={{ aspectRatio: `${totalWidth} / ${pageView.height}` }}
    >
      <img
        src={`/api/reports/${encodeURIComponent(pageView.reportId)}/page.jpg`}
        alt="The profiled page when recording stopped"
        style={{ left: pctX(gutter), width: pctX(pageView.width) }}
        onError={pageView.onImageError}
      />
      <svg
        className="callout-svg"
        viewBox={`0 0 ${totalWidth} ${pageView.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {pins.map(pin => {
          const at = placed.get(pin.key);
          const { x, y, w, h } = pin.rect;
          const cls = `sev-${severityOf(pin.c, maxSelf)} ${
            active?.key === pin.key ? 'active' : ''
          }`;
          return (
            <g key={pin.key} className={`callout ${cls}`}>
              <rect x={gutter + x} y={y} width={w} height={h} rx="4" />
              <line
                x1={at.markerX}
                y1={at.markerY}
                x2={at.anchorX}
                y2={at.anchorY}
              />
              <circle cx={at.anchorX} cy={at.anchorY} r="4" />
            </g>
          );
        })}
      </svg>
      {pins.map(pin => {
        const at = placed.get(pin.key);
        return (
          <button
            key={pin.key}
            type="button"
            className={`marker sev-${severityOf(pin.c, maxSelf)} ${
              active?.key === pin.key ? 'active' : ''
            }`}
            style={{ left: pctX(at.markerX), top: pctY(at.markerY) }}
            aria-label={`${pin.n}. ${pin.c.name}, ${fmtMs(pin.c.selfMs)} self time`}
            onMouseEnter={() => onActivate(pin)}
            onMouseLeave={() => onActivate(null)}
            onFocus={() => onActivate(pin)}
            onBlur={() => onActivate(null)}
            onClick={() => pin.c.file && onOpenFile(pin.c.file)}
          >
            {pin.n}
          </button>
        );
      })}
      {active && activePlace && (
        <div
          className="pin-card"
          style={{
            [activePlace.side]: pctX(gutter),
            ...(activePlace.markerY / pageView.height > 0.55
              ? {
                  bottom: `${100 - (activePlace.markerY / pageView.height) * 100}%`,
                }
              : { top: pctY(activePlace.markerY) }),
          }}
        >
          <Details pin={active} />
        </div>
      )}
    </div>
  );
}

/**
 * Screenshot of the page at the moment recording stopped, with the slowest
 * React components outlined where they sit on screen. Hover or focus a pin for
 * the file, render counts and a fix; click it to open the source.
 */
export default function PageMap({ report, hideVendor, onOpenFile }) {
  const { pageView } = report;
  const [activeKey, setActiveKey] = useState(null);
  const [isImageMissing, setIsImageMissing] = useState(false);
  const pins = useMemo(
    () => (pageView ? buildPins(report, hideVendor) : []),
    [report, pageView, hideVendor],
  );
  const maxSelf = Math.max(1, ...pins.map(p => p.c.selfMs));
  const active = pins.find(p => p.key === activeKey) || null;
  const frameView = useMemo(
    () =>
      pageView && {
        ...pageView,
        reportId: report.id,
        onImageError: () => setIsImageMissing(true),
      },
    [pageView, report.id],
  );

  if (!pageView?.hasImage || isImageMissing)
    return (
      <div className="empty">
        <b>No page map for this report</b>
        <span>
          It needs a development build of a React app and a recording made with
          this version of the profiler. Older reports and production builds have
          none.
        </span>
      </div>
    );
  if (!pins.length)
    return (
      <div className="empty">
        <b>No slow components are visible on screen</b>
        <span>
          Nothing that rendered during the recording is currently on screen (or
          everything is hidden by “Hide node_modules”).
        </span>
      </div>
    );

  return (
    <div className="page-map">
      <div className="page-stage">
        <p className="muted page-caption">
          Screenshot taken when the recording stopped. Numbers in the margins
          point to the components that spent the most time rendering and are on
          screen now; hover a number for details.
        </p>
        <Callouts
          pins={pins}
          pageView={frameView}
          active={active}
          maxSelf={maxSelf}
          onActivate={pin => setActiveKey(pin ? pin.key : null)}
          onOpenFile={onOpenFile}
        />
      </div>
      <aside className="page-list" aria-label="Components on this page">
        <h2>Hot spots on this page</h2>
        <ol>
          {pins.map(pin => (
            <li key={pin.key}>
              <button
                type="button"
                className={`hotspot ${active?.key === pin.key ? 'active' : ''}`}
                onMouseEnter={() => setActiveKey(pin.key)}
                onFocus={() => setActiveKey(pin.key)}
                onClick={() => pin.c.file && onOpenFile(pin.c.file)}
              >
                <span className="pin-num">{pin.n}</span>
                <span className="hotspot-main">
                  <b>{pin.c.name}</b>
                  <span className="muted mono">
                    {pin.c.file || 'file unknown'}
                  </span>
                </span>
                <span className="hotspot-time">{fmtMs(pin.c.selfMs)}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
