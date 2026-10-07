import { fmtMs, fmtNumber } from '../format.js';

// Web-vitals style thresholds: [good, poor]. `hero` ones get a full card.
const RATINGS = [
  {
    key: 'tbt',
    label: 'Total blocking time',
    get: r => r.vitals.tbtMs,
    limits: [200, 600],
    fmt: fmtMs,
    hero: true,
  },
  {
    key: 'long',
    label: 'Longest task',
    get: r => r.vitals.maxLongTaskMs,
    limits: [50, 200],
    fmt: fmtMs,
    hero: true,
  },
  {
    key: 'inp',
    label: 'Slowest interaction',
    get: r => r.vitals.inpMs,
    limits: [200, 500],
    fmt: fmtMs,
    hero: true,
  },
  {
    key: 'wasted',
    label: 'Wasted React renders',
    get: r =>
      r.react.detected
        ? r.react.components.reduce((s, c) => s + c.wasted, 0)
        : null,
    limits: [20, 200],
    fmt: fmtNumber,
    hero: true,
  },
  {
    key: 'lcp',
    label: 'Largest paint',
    get: r => r.vitals.lcpMs,
    limits: [2500, 4000],
    fmt: fmtMs,
  },
  {
    key: 'fcp',
    label: 'First paint',
    get: r => r.vitals.fcpMs,
    limits: [1800, 3000],
    fmt: fmtMs,
  },
  {
    key: 'cls',
    label: 'Layout shift',
    get: r => r.vitals.cls,
    limits: [0.1, 0.25],
    fmt: v => v.toFixed(3),
  },
  {
    key: 'dom',
    label: 'DOM nodes',
    get: r => r.memory.domNodes,
    limits: [1500, 3000],
    fmt: fmtNumber,
  },
  {
    key: 'heap',
    label: 'Heap growth',
    get: r => r.memory.heapGrowthMb,
    limits: [30, 100],
    fmt: v => `${v.toFixed(1)} MB`,
  },
  {
    key: 'forced',
    label: 'Forced reflows',
    get: r => r.totals.forcedLayoutCount + r.totals.forcedStyleCount,
    limits: [10, 100],
    fmt: fmtNumber,
  },
];

const LABELS = { good: 'Good', warn: 'Needs work', poor: 'Poor', none: 'n/a' };
const ICONS = { good: '✓', warn: '!', poor: '✕', none: '–' };
const GAUGE_HEADROOM = 1.5;

function rate(value, [good, poor]) {
  if (value == null) return 'none';
  if (value <= good) return 'good';
  return value >= poor ? 'poor' : 'warn';
}

function Gauge({ value, limits }) {
  const max = limits[1] * GAUGE_HEADROOM;
  const pct = n => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div
      className="gauge"
      aria-hidden="true"
      style={{ '--g': pct(limits[0]), '--p': pct(limits[1]) }}
    >
      <span className="gauge-needle" style={{ left: pct(value) }} />
    </div>
  );
}

function HeroCard({ vital, value, rating }) {
  const [good, poor] = vital.limits;
  return (
    <div className={`vital-hero rating-${rating}`}>
      <div className="vital-label">{vital.label}</div>
      <div className="vital-value">
        {value == null ? '–' : vital.fmt(value)}
      </div>
      <div className="vital-rating">
        <span aria-hidden="true">{ICONS[rating]}</span> {LABELS[rating]}
      </div>
      {value != null && <Gauge value={value} limits={vital.limits} />}
      <div className="vital-target muted">
        Good ≤ {vital.fmt(good)} · Poor ≥ {vital.fmt(poor)}
      </div>
    </div>
  );
}

function Chip({ vital, value, rating }) {
  return (
    <div className={`vital-chip rating-${rating}`}>
      <span className="vital-chip-icon" aria-hidden="true">
        {ICONS[rating]}
      </span>
      <span className="vital-chip-label">{vital.label}</span>
      <b>{value == null ? '–' : vital.fmt(value)}</b>
      <span className="visually-hidden">{LABELS[rating]}</span>
    </div>
  );
}

export default function Vitals({ report }) {
  const rows = RATINGS.map(v => {
    const value = v.get(report);
    return { vital: v, value, rating: rate(value, v.limits) };
  });
  return (
    <div className="vitals-block">
      <div className="vitals-hero">
        {rows
          .filter(r => r.vital.hero)
          .map(r => (
            <HeroCard key={r.vital.key} {...r} />
          ))}
      </div>
      <div className="vitals-secondary">
        {rows
          .filter(r => !r.vital.hero)
          .map(r => (
            <Chip key={r.vital.key} {...r} />
          ))}
      </div>
    </div>
  );
}
