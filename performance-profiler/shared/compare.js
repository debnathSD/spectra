/**
 * Performance comparison of two commits ("before" vs "after").
 *
 * Pure functions, no I/O: the browser uses this to draw the Compare tab and the
 * server uses the very same module to render the PDF, so the two can never
 * disagree.
 *
 * Input: each side is one or more profiler reports (snapshots) of the same
 * scenario taken on one commit. Several runs per side are reduced to their
 * median, and a difference only counts when it is larger than
 *   - an absolute floor (a few ms is never a regression),
 *   - a relative floor (a few percent is never a regression), and
 *   - the run-to-run spread observed on either side (noise).
 * Every measured quantity here is "lower is better".
 */

export const COMPARE_VERSION = 1;

// ------------------------------------------------------------------ numbers

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const finite = v => typeof v === 'number' && Number.isFinite(v);

function stats(values) {
  const v = values.filter(finite);
  if (!v.length) return { value: null, min: null, max: null, n: 0 };
  return {
    value: median(v),
    min: Math.min(...v),
    max: Math.max(...v),
    n: v.length,
  };
}

/** Relative change; null when there is no baseline to divide by. */
function pctChange(before, after) {
  if (!finite(before) || !finite(after)) return null;
  if (before === 0) return after === 0 ? 0 : null;
  return (after - before) / Math.abs(before);
}

/**
 * Decides whether `after` differs from `before` beyond the thresholds and the
 * observed noise. Lower is better.
 * @returns {{verdict: 'improved'|'degraded'|'same'|'n/a', delta: number|null, pct: number|null, threshold: number}}
 */
export function judge(beforeValues, afterValues, { minAbs, minRel }) {
  const b = stats(beforeValues);
  const a = stats(afterValues);
  if (b.value === null || a.value === null) {
    return {
      verdict: 'n/a',
      delta: null,
      pct: null,
      threshold: 0,
      before: b,
      after: a,
    };
  }
  const delta = a.value - b.value;
  const spread = Math.max(b.max - b.min, a.max - a.min);
  const threshold = Math.max(minAbs, minRel * Math.abs(b.value), spread);
  const verdict =
    Math.abs(delta) < threshold ? 'same' : delta < 0 ? 'improved' : 'degraded';
  return {
    verdict,
    delta,
    pct: pctChange(b.value, a.value),
    threshold,
    before: b,
    after: a,
  };
}

// ------------------------------------------------------------------ formatting

export function formatValue(unit, v) {
  if (!finite(v)) return '–';
  switch (unit) {
    case 'ms':
      if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
      if (v >= 100) return `${Math.round(v)} ms`;
      if (v >= 1) return `${v.toFixed(1)} ms`;
      return `${v.toFixed(2)} ms`;
    case 'score':
      return v.toFixed(v !== 0 && Math.abs(v) < 0.01 ? 4 : 3);
    case 'MB':
      return `${v.toFixed(1)} MB`;
    case 'bytes':
      if (v < 1024) return `${Math.round(v)} B`;
      if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
      return `${(v / 1024 / 1024).toFixed(2)} MB`;
    default:
      return Math.round(v).toLocaleString('en-US');
  }
}

/** '+12%', '−42%', 'new' (no baseline), '0%'. */
export function formatPct(pct) {
  if (pct === null || pct === undefined) return 'new';
  const n = Math.round(Math.abs(pct) * 100);
  if (n === 0) return '0%';
  return `${pct > 0 ? '+' : '−'}${n}%`;
}

export function formatDelta(unit, delta) {
  if (!finite(delta)) return '–';
  const body = formatValue(unit, Math.abs(delta));
  if (delta === 0) return body;
  return `${delta > 0 ? '+' : '−'}${body}`;
}

// ------------------------------------------------------------------ headline metrics

const reactSum = (r, key) =>
  r.react?.detected
    ? r.react.components.reduce((s, c) => s + (c[key] || 0), 0)
    : null;
const reactOnly = (r, get) => (r.react?.detected ? get(r.react) : null);

/**
 * `minAbs` / `minRel`: a change smaller than either is noise.
 * `key`: counts toward the overall verdict.
 */
export const METRICS = [
  {
    id: 'tbt',
    group: 'Responsiveness',
    label: 'Total blocking time',
    unit: 'ms',
    get: r => r.vitals.tbtMs,
    minAbs: 50,
    minRel: 0.1,
    key: true,
  },
  {
    id: 'longTasks',
    group: 'Responsiveness',
    label: 'Long tasks (> 50 ms)',
    unit: 'count',
    get: r => r.vitals.longTaskCount,
    minAbs: 1,
    minRel: 0.15,
    key: true,
  },
  {
    id: 'maxTask',
    group: 'Responsiveness',
    label: 'Longest task',
    unit: 'ms',
    get: r => r.vitals.maxLongTaskMs,
    minAbs: 25,
    minRel: 0.1,
  },
  {
    id: 'inp',
    group: 'Responsiveness',
    label: 'Slowest interaction',
    unit: 'ms',
    get: r => r.vitals.inpMs,
    minAbs: 40,
    minRel: 0.1,
    key: true,
  },
  {
    id: 'lcp',
    group: 'Loading',
    label: 'Largest contentful paint',
    unit: 'ms',
    get: r => r.vitals.lcpMs,
    minAbs: 100,
    minRel: 0.05,
    key: true,
  },
  {
    id: 'fcp',
    group: 'Loading',
    label: 'First contentful paint',
    unit: 'ms',
    get: r => r.vitals.fcpMs,
    minAbs: 50,
    minRel: 0.05,
  },
  {
    id: 'cls',
    group: 'Visual stability',
    label: 'Layout shift (CLS)',
    unit: 'score',
    get: r => r.vitals.cls,
    minAbs: 0.01,
    minRel: 0.2,
    key: true,
  },
  {
    id: 'cpu',
    group: 'CPU and main thread',
    label: 'JavaScript CPU time',
    unit: 'ms',
    get: r => r.totals.activeMs,
    minAbs: 50,
    minRel: 0.1,
    key: true,
  },
  {
    id: 'scripting',
    group: 'CPU and main thread',
    label: 'Scripting',
    unit: 'ms',
    get: r => r.totals.scriptingMs,
    minAbs: 50,
    minRel: 0.1,
  },
  {
    id: 'layout',
    group: 'CPU and main thread',
    label: 'Layout',
    unit: 'ms',
    get: r => r.totals.layoutMs,
    minAbs: 20,
    minRel: 0.15,
  },
  {
    id: 'style',
    group: 'CPU and main thread',
    label: 'Style recalculation',
    unit: 'ms',
    get: r => r.totals.styleMs,
    minAbs: 20,
    minRel: 0.15,
  },
  {
    id: 'paint',
    group: 'CPU and main thread',
    label: 'Paint',
    unit: 'ms',
    get: r => r.totals.paintMs,
    minAbs: 20,
    minRel: 0.15,
  },
  {
    id: 'gc',
    group: 'CPU and main thread',
    label: 'Garbage collection',
    unit: 'ms',
    get: r => r.totals.gcMs,
    minAbs: 20,
    minRel: 0.2,
  },
  {
    id: 'compile',
    group: 'CPU and main thread',
    label: 'Script compile / parse',
    unit: 'ms',
    get: r => r.totals.compileMs,
    minAbs: 20,
    minRel: 0.2,
  },
  {
    id: 'layouts',
    group: 'Layout work',
    label: 'Layouts performed',
    unit: 'count',
    get: r => r.totals.layoutCount,
    minAbs: 10,
    minRel: 0.15,
  },
  {
    id: 'recalcs',
    group: 'Layout work',
    label: 'Style recalculations',
    unit: 'count',
    get: r => r.totals.styleRecalcCount,
    minAbs: 10,
    minRel: 0.15,
  },
  {
    id: 'forced',
    group: 'Layout work',
    label: 'Forced reflows',
    unit: 'count',
    get: r => r.totals.forcedLayoutCount + r.totals.forcedStyleCount,
    minAbs: 5,
    minRel: 0.2,
    key: true,
  },
  {
    id: 'forcedMs',
    group: 'Layout work',
    label: 'Time in forced reflows',
    unit: 'ms',
    get: r => r.totals.forcedMs,
    minAbs: 10,
    minRel: 0.2,
  },
  {
    id: 'renders',
    group: 'React',
    label: 'Component renders',
    unit: 'count',
    get: r => reactSum(r, 'renders'),
    minAbs: 50,
    minRel: 0.15,
  },
  {
    id: 'wasted',
    group: 'React',
    label: 'Wasted renders',
    unit: 'count',
    get: r => reactSum(r, 'wasted'),
    minAbs: 25,
    minRel: 0.15,
    key: true,
  },
  {
    id: 'renderMs',
    group: 'React',
    label: 'React render time',
    unit: 'ms',
    get: r => reactOnly(r, x => x.commits.totalMs),
    minAbs: 25,
    minRel: 0.1,
  },
  {
    id: 'maxCommit',
    group: 'React',
    label: 'Slowest React commit',
    unit: 'ms',
    get: r => reactOnly(r, x => x.commits.maxMs),
    minAbs: 10,
    minRel: 0.15,
  },
  {
    id: 'dom',
    group: 'Memory and DOM',
    label: 'DOM nodes',
    unit: 'count',
    get: r => r.memory.domNodes,
    minAbs: 100,
    minRel: 0.05,
  },
  {
    id: 'listeners',
    group: 'Memory and DOM',
    label: 'Event listeners',
    unit: 'count',
    get: r => r.memory.listeners,
    minAbs: 50,
    minRel: 0.1,
  },
  {
    id: 'heapGrowth',
    group: 'Memory and DOM',
    label: 'JS heap growth',
    unit: 'MB',
    get: r => r.memory.heapGrowthMb,
    minAbs: 5,
    minRel: 0.15,
    key: true,
  },
  {
    id: 'requests',
    group: 'Network',
    label: 'Requests',
    unit: 'count',
    get: r => r.network.count,
    minAbs: 3,
    minRel: 0.1,
  },
  {
    id: 'transferred',
    group: 'Network',
    label: 'Data transferred',
    unit: 'bytes',
    get: r => r.network.totalEncoded,
    minAbs: 100 * 1024,
    minRel: 0.05,
  },
];

function compareMetrics(beforeRuns, afterRuns) {
  return METRICS.map(def => {
    const bv = beforeRuns.map(def.get);
    const av = afterRuns.map(def.get);
    const j = judge(bv, av, def);
    return {
      id: def.id,
      group: def.group,
      label: def.label,
      unit: def.unit,
      key: Boolean(def.key),
      before: j.before,
      after: j.after,
      delta: j.delta,
      pct: j.pct,
      verdict: j.verdict,
      threshold: j.threshold,
    };
  });
}

// ------------------------------------------------------------------ entities

const MAX_LISTED = 40;

/**
 * Generic "which files/components/functions changed" diff.
 * `extract(report)` returns Map(key -> {values: {sub: number}, meta}).
 * The first sub-metric doubles as the presence test for added/removed.
 */
function compareEntities(
  beforeRuns,
  afterRuns,
  { extract, subs, presenceMin, scoreOf },
) {
  const beforeMaps = beforeRuns.map(extract);
  const afterMaps = afterRuns.map(extract);
  const keys = new Set();
  [...beforeMaps, ...afterMaps].forEach(m => m.forEach((_, k) => keys.add(k)));

  const valuesOf = (maps, key, sub) =>
    maps.map(m => m.get(key)?.values[sub] ?? 0);
  const metaOf = key => {
    for (const m of [...afterMaps, ...beforeMaps])
      if (m.has(key)) return m.get(key).meta;
    return {};
  };

  const buckets = {
    improved: [],
    degraded: [],
    mixed: [],
    added: [],
    removed: [],
  };
  let unchanged = 0;

  for (const key of keys) {
    const changes = subs.map(sub => {
      const j = judge(
        valuesOf(beforeMaps, key, sub.id),
        valuesOf(afterMaps, key, sub.id),
        sub,
      );
      return {
        id: sub.id,
        label: sub.label,
        unit: sub.unit,
        before: j.before.value,
        after: j.after.value,
        delta: j.delta,
        pct: j.pct,
        verdict: j.verdict,
      };
    });
    const presence = changes[0];
    const entity = { key, ...metaOf(key), changes };
    entity.score = scoreOf(changes);

    if (presence.before === 0 && presence.after >= presenceMin) {
      buckets.added.push(entity);
    } else if (presence.after === 0 && presence.before >= presenceMin) {
      buckets.removed.push(entity);
    } else {
      const worse = changes.some(c => c.verdict === 'degraded');
      const better = changes.some(c => c.verdict === 'improved');
      if (worse && better) buckets.mixed.push(entity);
      else if (worse) buckets.degraded.push(entity);
      else if (better) buckets.improved.push(entity);
      else unchanged += 1;
    }
  }

  const out = { unchanged, compared: keys.size };
  for (const [name, list] of Object.entries(buckets)) {
    list.sort((a, b) => b.score - a.score);
    out[name] = list.slice(0, MAX_LISTED);
    out[`${name}Total`] = list.length;
  }
  return out;
}

const SUBS = {
  components: [
    { id: 'renders', label: 'Renders', unit: 'count', minAbs: 20, minRel: 0.2 },
    {
      id: 'wasted',
      label: 'Wasted renders',
      unit: 'count',
      minAbs: 10,
      minRel: 0.2,
    },
    { id: 'selfMs', label: 'Render time', unit: 'ms', minAbs: 5, minRel: 0.2 },
  ],
  files: [
    { id: 'selfMs', label: 'CPU time', unit: 'ms', minAbs: 10, minRel: 0.15 },
    {
      id: 'blockMs',
      label: 'Blocking time',
      unit: 'ms',
      minAbs: 20,
      minRel: 0.15,
    },
    {
      id: 'reactMs',
      label: 'React render time',
      unit: 'ms',
      minAbs: 5,
      minRel: 0.2,
    },
    {
      id: 'forcedCount',
      label: 'Forced reflows',
      unit: 'count',
      minAbs: 5,
      minRel: 0.2,
    },
  ],
  functions: [
    { id: 'selfMs', label: 'Self time', unit: 'ms', minAbs: 10, minRel: 0.2 },
  ],
};

const byId = (subs, id) => subs.find(s => s.id === id);
const changeOf = (changes, id) => changes.find(c => c.id === id);
const absDelta = (changes, id) => Math.abs(changeOf(changes, id)?.delta ?? 0);

function compareComponents(beforeRuns, afterRuns) {
  return compareEntities(beforeRuns, afterRuns, {
    subs: SUBS.components,
    presenceMin: 20,
    scoreOf: ch =>
      absDelta(ch, 'selfMs') +
      0.01 * absDelta(ch, 'wasted') +
      0.001 * absDelta(ch, 'renders'),
    extract: r => {
      const map = new Map();
      for (const c of r.react?.components || []) {
        map.set(`${c.name}|${c.file || ''}`, {
          values: { renders: c.renders, wasted: c.wasted, selfMs: c.selfMs },
          meta: {
            name: c.name,
            file: c.file,
            line: c.line,
            lineKind: c.lineKind,
            abs: c.abs,
            vendor: Boolean(c.vendor),
          },
        });
      }
      return map;
    },
  });
}

function compareFiles(beforeRuns, afterRuns) {
  return compareEntities(beforeRuns, afterRuns, {
    subs: SUBS.files,
    presenceMin: 10,
    scoreOf: ch =>
      absDelta(ch, 'selfMs') +
      absDelta(ch, 'blockMs') +
      absDelta(ch, 'reactMs'),
    extract: r => {
      const map = new Map();
      for (const f of r.files || []) {
        map.set(f.path, {
          values: {
            selfMs: f.selfMs,
            blockMs: f.blockMs,
            reactMs: f.reactMs,
            forcedCount: f.forcedCount,
          },
          meta: { name: f.path, file: f.path, vendor: Boolean(f.vendor) },
        });
      }
      return map;
    },
  });
}

function compareFunctions(beforeRuns, afterRuns) {
  return compareEntities(beforeRuns, afterRuns, {
    subs: SUBS.functions,
    presenceMin: 10,
    scoreOf: ch => absDelta(ch, 'selfMs'),
    extract: r => {
      const map = new Map();
      for (const f of r.files || []) {
        for (const fn of f.functions || []) {
          map.set(`${f.path}::${fn.name}`, {
            values: { selfMs: fn.selfMs },
            meta: {
              name: fn.name,
              file: f.path,
              line: fn.line,
              lineKind: fn.lineKind,
              abs: fn.abs,
              vendor: Boolean(f.vendor),
            },
          });
        }
      }
      return map;
    },
  });
}

// ------------------------------------------------------------------ findings

/** Stable identity of a finding across recordings (ids like long-task-3 are positional). */
export function findingKey(f) {
  const first = f.culprits?.[0];
  if (f.id.startsWith('long-task-'))
    return `long-task:${first?.file || ''}:${first?.fn || ''}`;
  if (f.id.startsWith('interaction-')) return 'slow-interaction';
  if (f.id.startsWith('commit-')) return 'slow-react-commit';
  if (
    f.id.startsWith('uncompressed-') ||
    f.id.startsWith('large-') ||
    f.id.startsWith('slow-request-')
  ) {
    return `${f.id.replace(/-\d+$/, '')}:${f.detail || f.title}`;
  }
  return f.id;
}

/** A finding "exists" on a side when it appears in at least half of that side's runs. */
function presentFindings(runs) {
  const seen = new Map();
  for (const r of runs) {
    const keys = new Set();
    for (const f of r.findings || []) {
      const key = findingKey(f);
      if (keys.has(key)) continue;
      keys.add(key);
      const cur = seen.get(key) || { count: 0, best: f };
      cur.count += 1;
      if (f.impactMs > cur.best.impactMs) cur.best = f;
      seen.set(key, cur);
    }
  }
  const need = Math.ceil(runs.length / 2);
  const out = new Map();
  for (const [key, { count, best }] of seen)
    if (count >= need) out.set(key, best);
  return out;
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
const brief = f => ({
  id: f.id,
  severity: f.severity,
  category: f.category,
  title: f.title,
  impactMs: Math.round(f.impactMs || 0),
  fix: f.fix,
  culprits: (f.culprits || []).slice(0, 3),
});

function compareFindings(beforeRuns, afterRuns) {
  const b = presentFindings(beforeRuns);
  const a = presentFindings(afterRuns);
  const ranked = list =>
    list.sort(
      (x, y) =>
        SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
        y.impactMs - x.impactMs,
    );
  const added = [];
  const resolved = [];
  const persisting = [];
  for (const [key, f] of a) {
    if (!b.has(key)) added.push(brief(f));
    else
      persisting.push({
        ...brief(f),
        beforeTitle: b.get(key).title,
        beforeImpactMs: Math.round(b.get(key).impactMs || 0),
      });
  }
  for (const [key, f] of b) if (!a.has(key)) resolved.push(brief(f));
  return {
    added: ranked(added),
    resolved: ranked(resolved),
    persisting: ranked(persisting),
  };
}

// ------------------------------------------------------------------ comparability

const pathOf = url => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url || '';
  }
};
const unique = list => [...new Set(list)];

function comparability(before, after) {
  const checks = [];
  const add = (level, id, title, detail) =>
    checks.push({ level, id, title, detail });
  const all = [...before.runs, ...after.runs];
  const bm = before.runs.map(r => r.meta);
  const am = after.runs.map(r => r.meta);

  const failed = all.filter(r => r.meta.navStatus >= 400);
  if (failed.length) {
    add(
      'bad',
      'failed-page',
      'A recording profiled an error page',
      `${failed.length} run(s) had an HTTP error on the page itself (e.g. ${failed[0].meta.navStatus}). Not signed in?`,
    );
  }

  const paths = unique(all.map(r => pathOf(r.meta.url)));
  add(
    paths.length === 1 ? 'ok' : 'warn',
    'page',
    paths.length === 1 ? 'Same page' : 'Different pages',
    paths.length === 1
      ? paths[0]
      : `The recordings are of different pages (${paths.slice(0, 3).join(', ')}). Compare like with like.`,
  );

  const modes = unique(all.map(r => r.meta.mode));
  add(
    modes.length === 1 ? 'ok' : 'warn',
    'mode',
    modes.length === 1
      ? `Same mode (${modes[0] === 'load' ? 'page load' : 'interaction'})`
      : 'Different recording modes',
    modes.length === 1
      ? ''
      : 'Page-load and interaction recordings measure different things.',
  );

  const throttles = unique(all.map(r => r.meta.cpuThrottle || 1));
  add(
    throttles.length === 1 ? 'ok' : 'warn',
    'cpu',
    throttles.length === 1
      ? `Same CPU setting (${throttles[0]}×)`
      : 'Different CPU throttling',
    throttles.length === 1
      ? ''
      : `Recorded at ${throttles.join('× and ')}× slowdown.`,
  );

  const bd = median(bm.map(m => m.durationMs));
  const ad = median(am.map(m => m.durationMs));
  const ratio = Math.max(bd, ad) / Math.max(Math.min(bd, ad), 1);
  if (before.runs[0]?.meta.mode !== 'load') {
    add(
      ratio <= 1.25 ? 'ok' : 'warn',
      'duration',
      ratio <= 1.25 ? 'Similar recording length' : 'Recording lengths differ',
      `${formatValue('ms', bd)} vs ${formatValue('ms', ad)}.${ratio <= 1.25 ? '' : ' Totals such as CPU time and render counts grow with length, so they are not directly comparable.'}`,
    );
  }

  const nb = before.runs.length;
  const na = after.runs.length;
  const minRuns = Math.min(nb, na);
  add(
    minRuns >= 3 ? 'ok' : 'warn',
    'runs',
    `${nb} run${nb > 1 ? 's' : ''} before, ${na} after`,
    minRuns >= 3
      ? 'Medians are used and differences must exceed the run-to-run spread.'
      : 'Run-to-run noise could not be measured well. Record each side at least 3 times for a trustworthy verdict.',
  );

  const noReact = all.filter(r => !r.react?.detected || !r.react?.hasTimings);
  if (noReact.length)
    add(
      'warn',
      'react',
      'React timings missing in some runs',
      `${noReact.length} run(s) had no React data (production build, or the probe loaded after React). React metrics are skipped or partial.`,
    );

  const attributions = unique(all.map(r => r.meta.attribution));
  if (attributions.length > 1)
    add(
      'warn',
      'attribution',
      'Different file-attribution modes',
      `${attributions.join(' / ')}: function lines may differ between sides.`,
    );

  const idle = all.filter(r => r.totals.activeMs < 300);
  if (idle.length)
    add(
      'warn',
      'idle',
      'Some recordings were nearly idle',
      `${idle.length} run(s) executed under 300 ms of JavaScript: little was measured.`,
    );

  const dirty = [before, after].flatMap((s, i) =>
    s.git?.dirty ? [i === 0 ? 'before' : 'after'] : [],
  );
  if (dirty.length)
    add(
      'warn',
      'dirty',
      'Uncommitted changes while recording',
      `The ${dirty.join(' and ')} snapshot was taken with uncommitted edits, so its commit hash may not describe exactly what was measured.`,
    );

  for (const [name, side] of [
    ['before', before],
    ['after', after],
  ]) {
    const hashes = unique(side.runs.map(r => r.meta.git?.hash).filter(Boolean));
    if (hashes.length > 1)
      add(
        'warn',
        `mixed-${name}`,
        `Runs on the ${name} side come from different commits`,
        hashes.map(h => h.slice(0, 7)).join(', '),
      );
  }
  if (before.git?.hash && before.git.hash === after.git?.hash) {
    add(
      'warn',
      'same-commit',
      'Both sides are the same commit',
      'This is an A/A comparison: any difference shown is measurement noise.',
    );
  }
  return checks;
}

// ------------------------------------------------------------------ verdict

function overall(metrics) {
  const key = metrics.filter(m => m.key && m.verdict !== 'n/a');
  const improved = key.filter(m => m.verdict === 'improved').length;
  const degraded = key.filter(m => m.verdict === 'degraded').length;
  if (!improved && !degraded) return 'neutral';
  if (!degraded) return 'improved';
  if (!improved) return 'regressed';
  return 'mixed';
}

const sentence = m =>
  `${m.label}: ${formatValue(m.unit, m.before.value)} → ${formatValue(m.unit, m.after.value)} (${formatPct(m.pct)})`;
const magnitude = m => (m.pct === null ? Infinity : Math.abs(m.pct));

/**
 * Biggest component changes as plain sentences. A component that used to render
 * and no longer does (or the reverse) is a cost going away (or appearing), so it
 * counts as an improvement (or a degradation) here.
 */
function entityHeadlines(entities) {
  const line = (e, kind) => {
    const c = e.changes.find(x => x.verdict !== 'same') || e.changes[0];
    return {
      kind,
      score: e.score,
      text: `${e.name}${e.file && e.file !== e.name ? ` (${e.file})` : ''} — ${c.label.toLowerCase()}: ${formatValue(c.unit, c.before)} → ${formatValue(c.unit, c.after)} (${formatPct(c.pct)})`,
    };
  };
  const worse = [
    ...entities.degraded.map(e => line(e, 'degraded')),
    ...entities.added.map(e => line(e, 'degraded')),
  ];
  const better = [
    ...entities.improved.map(e => line(e, 'improved')),
    ...entities.removed.map(e => line(e, 'improved')),
  ];
  const top = (list, n) =>
    list
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(({ kind, text }) => ({ kind, text }));
  return [...top(worse, 2), ...top(better, 3)];
}

// ------------------------------------------------------------------ public API

function sideInfo(side) {
  const first = side.runs[0];
  const git =
    side.git && (side.git.hash || side.git.author)
      ? side.git
      : first?.meta.git || null;
  return {
    git,
    label: side.label || first?.meta.label || '',
    runs: side.runs.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      title: r.meta.title,
      url: r.meta.url,
      mode: r.meta.mode,
      durationMs: r.meta.durationMs,
      cpuThrottle: r.meta.cpuThrottle || 1,
      attribution: r.meta.attribution,
      reactVersion: r.react?.version || '',
      commit: r.meta.git?.shortHash || '',
    })),
  };
}

/**
 * @param {{runs: object[], git?: object, label?: string}} before
 * @param {{runs: object[], git?: object, label?: string}} after
 */
export function compareSides(before, after) {
  if (!before?.runs?.length || !after?.runs?.length) return null;
  const metrics = compareMetrics(before.runs, after.runs);
  const components = compareComponents(before.runs, after.runs);
  const files = compareFiles(before.runs, after.runs);
  const functions = compareFunctions(before.runs, after.runs);
  const findings = compareFindings(before.runs, after.runs);
  const checks = comparability(before, after);

  const count = verdict => metrics.filter(m => m.verdict === verdict).length;
  const verdict = overall(metrics);
  const keyMoves = verdict_ =>
    metrics
      .filter(m => m.key && m.verdict === verdict_)
      .sort((a, b) => magnitude(b) - magnitude(a));
  const warns = checks.filter(c => c.level === 'warn').length;
  const confidence =
    checks.some(c => c.level === 'bad') || warns >= 3
      ? 'low'
      : warns > 0 || Math.min(before.runs.length, after.runs.length) < 3
        ? 'medium'
        : 'high';

  return {
    version: COMPARE_VERSION,
    generatedAt: new Date().toISOString(),
    before: sideInfo(before),
    after: sideInfo(after),
    checks,
    confidence,
    verdict,
    counts: {
      improved: count('improved'),
      degraded: count('degraded'),
      same: count('same'),
      unavailable: count('n/a'),
    },
    headlines: [
      ...keyMoves('degraded')
        .slice(0, 3)
        .map(m => ({ kind: 'degraded', text: sentence(m) })),
      ...keyMoves('improved')
        .slice(0, 3)
        .map(m => ({ kind: 'improved', text: sentence(m) })),
      ...entityHeadlines(components),
    ],
    metrics,
    components,
    files,
    functions,
    findings,
  };
}

/** Lookup used by the UI to show which sub-metric changed. */
export const subLabel = (entityType, id) =>
  byId(SUBS[entityType], id)?.label || id;
export { changeOf };
