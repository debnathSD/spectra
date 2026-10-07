import { useEffect, useMemo, useRef } from 'react';
import { fmtMs } from '../format.js';

const FOV = 3;
const RADIUS = 0.8;
const AUTO_SPIN = 0.00035;
const DRAG_SPEED = 0.008;
const MAX_TILT = 1.2;
const LAT_DEG = [-60, -30, 0, 30, 60];
const MERIDIANS = 6;
const RING_POINTS = 48;
const MAX_NAME = 20;

// Evenly spread points on a unit sphere (Fibonacci lattice).
function latticePoints(n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    return [Math.cos(i * golden) * r, y, Math.sin(i * golden) * r];
  });
}

function rotate([x, y, z], ax, ay) {
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
}

// Perspective: nearer points are bigger and further from the centre.
function project(p, ax, ay) {
  const [x, y, z] = rotate(p, ax, ay);
  const k = FOV / (FOV - z);
  return { x: x * k * RADIUS, y: y * k * RADIUS, z, k };
}

function ringPoints(fn) {
  return Array.from({ length: RING_POINTS + 1 }, (_, i) =>
    fn((i / RING_POINTS) * Math.PI * 2),
  );
}

const WIREFRAME = [
  ...LAT_DEG.map(deg => {
    const lat = (deg * Math.PI) / 180;
    return ringPoints(t => [
      Math.cos(lat) * Math.cos(t),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(t),
    ]);
  }),
  ...Array.from({ length: MERIDIANS }, (_, m) => {
    const lon = (m / MERIDIANS) * Math.PI;
    return ringPoints(t => [
      Math.cos(t) * Math.cos(lon),
      Math.sin(t),
      Math.cos(t) * Math.sin(lon),
    ]);
  }),
];

const shortName = name =>
  name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;

/**
 * Culprits as labels on a slowly rotating sphere. Drag to spin it; hovering a
 * label pauses it. The motion is driven straight onto the DOM nodes (no React
 * render per frame) and is off entirely for people who ask for reduced motion.
 */
export default function CulpritSphere({
  items,
  activeKey,
  highlightKey,
  onActivate,
  onSelect,
}) {
  const points = useMemo(() => latticePoints(items.length), [items.length]);
  const maxMs = Math.max(1, ...items.map(i => i.ms));
  const labelRefs = useRef([]);
  const pathRefs = useRef([]);
  const motion = useRef({
    ax: -0.35,
    ay: 0,
    vy: 0,
    vx: 0,
    isDragging: false,
    isPaused: false,
  });
  const drag = useRef({ x: 0, y: 0 });

  useEffect(() => {
    motion.current.isPaused = Boolean(activeKey);
  }, [activeKey]);

  useEffect(() => {
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const paint = () => {
      const { ax, ay } = motion.current;
      points.forEach((p, i) => {
        const el = labelRefs.current[i];
        if (!el) return;
        const q = project(p, ax, ay);
        const depth = (q.z + 1) / 2;
        el.style.left = `${50 + q.x * 50}%`;
        el.style.top = `${50 + q.y * 50}%`;
        el.style.transform = `translate(-50%, -50%) scale(${0.7 + depth * 0.45})`;
        el.style.opacity = String(0.16 + depth * 0.84);
        el.style.zIndex = String(Math.round(depth * 100));
        el.style.pointerEvents = q.z > -0.35 ? 'auto' : 'none';
      });
      WIREFRAME.forEach((ring, i) => {
        const path = pathRefs.current[i];
        if (!path) return;
        path.setAttribute(
          'd',
          ring
            .map((p, j) => {
              const q = project(p, ax, ay);
              return `${j ? 'L' : 'M'}${q.x.toFixed(3)} ${q.y.toFixed(3)}`;
            })
            .join(''),
        );
      });
    };
    paint();
    // requestAnimationFrame: this is a continuous animation with no event to hook into.
    let frame = 0;
    let last = performance.now();
    const tick = now => {
      const m = motion.current;
      const dt = Math.min(64, now - last);
      last = now;
      const isSpinning = !reduced && !m.isPaused && !m.isDragging;
      const isCoasting = Math.abs(m.vy) > 1e-4 || Math.abs(m.vx) > 1e-4;
      if (isSpinning || isCoasting) {
        m.ay += (isSpinning ? AUTO_SPIN * dt : 0) + m.vy;
        m.ax = Math.max(-MAX_TILT, Math.min(MAX_TILT, m.ax + m.vx));
        if (!m.isDragging) {
          m.vy *= 0.94;
          m.vx *= 0.94;
        }
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [points]);

  const handlePointerDown = e => {
    if (e.target.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    motion.current.isDragging = true;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerMove = e => {
    const m = motion.current;
    if (!m.isDragging) return;
    m.vy = (e.clientX - drag.current.x) * DRAG_SPEED;
    m.vx = -(e.clientY - drag.current.y) * DRAG_SPEED;
    drag.current = { x: e.clientX, y: e.clientY };
    m.ay += m.vy;
    m.ax = Math.max(-MAX_TILT, Math.min(MAX_TILT, m.ax + m.vx));
  };
  const handlePointerUp = () => {
    motion.current.isDragging = false;
  };

  return (
    <div
      className="sphere"
      role="group"
      aria-label="Top culprits on a rotating sphere. Drag to rotate."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="sphere-glow" aria-hidden="true" />
      <svg className="sphere-wire" viewBox="-1 -1 2 2" aria-hidden="true">
        {WIREFRAME.map((_, i) => (
          <path
            key={i}
            ref={el => {
              pathRefs.current[i] = el;
            }}
          />
        ))}
      </svg>
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={el => {
            labelRefs.current[i] = el;
          }}
          type="button"
          className={`orb sev-${item.severity} ${highlightKey === item.key ? 'active' : ''}`}
          style={{ fontSize: `${0.7 + 0.28 * Math.sqrt(item.ms / maxMs)}rem` }}
          title={item.name}
          onMouseEnter={() => onActivate(item.key)}
          onMouseLeave={() => onActivate(null)}
          onFocus={() => onActivate(item.key)}
          onBlur={() => onActivate(null)}
          onClick={() => onSelect(item.key)}
        >
          <span className="orb-name">{shortName(item.name)}</span>
          <span className="orb-ms">{fmtMs(item.ms)}</span>
        </button>
      ))}
    </div>
  );
}
