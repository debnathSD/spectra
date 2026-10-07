/**
 * Rule-based "culprits": turns the measured report into a ranked list of
 * concrete problems, each with evidence, the exact code responsible
 * (`culprits`: function + file + line) and a suggested fix.
 * `impactMs` is what the ranking sorts on within a severity.
 */

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

const fmt = ms => (ms >= 100 ? `${Math.round(ms)}ms` : `${ms.toFixed(1)}ms`);
const where = (file, line) =>
  file ? `${file}${line ? `:${line}` : ''}` : 'unknown location';

/** One exact piece of code to blame. `lineKind` is 'exact' (source map) or 'located' (found by name). */
const culprit = (fn, file, line, lineKind, abs, ms, note = '') => ({
  fn,
  file,
  line,
  lineKind,
  abs,
  ms,
  note,
});

const fromFunction = f =>
  culprit(f.name, f.file, f.line, f.lineKind, f.abs, f.ms ?? f.selfMs);

export function buildFindings(report) {
  const out = [];
  const add = f =>
    out.push({ severity: 'warning', impactMs: 0, culprits: [], ...f });
  const {
    vitals,
    files,
    longTasks,
    forcedReflows,
    react,
    network,
    memory,
    totals,
  } = report;
  const appFiles = files.filter(f => !f.vendor);
  const activeMs = totals.activeMs || 1;
  // Ratios are meaningless when almost nothing ran.
  const busyEnough = totals.activeMs >= 500;

  // Profiling an error page is the most common way to get a meaningless report.
  if (report.meta.navStatus >= 400) {
    add({
      id: 'page-failed',
      severity: 'critical',
      category: 'Setup',
      title: `The page itself failed to load (HTTP ${report.meta.navStatus}) — this recording profiled an error page`,
      detail: `${report.meta.navUrl}. Results below describe the error page, not your app. A redirect to a login page that errors usually means the session is not signed in.`,
      pinned: 2,
      fix: 'Sign in (in the Chrome window this tool opened, or by opening your app’s login URL as the page to profile), check that the page renders, then record again.',
    });
  }

  // A quiet recording explains an empty report better than a list of trivia.
  const commits = react.commits?.count ?? 0;
  const quiet = totals.activeMs < 300 && commits < 5 && longTasks.length === 0;
  if (quiet && report.meta.mode === 'live' && report.meta.durationMs >= 2000) {
    add({
      id: 'recording-idle',
      severity: 'warning',
      category: 'Setup',
      title: `Almost nothing ran during this ${(report.meta.durationMs / 1000).toFixed(0)} s recording`,
      detail: `Only ${fmt(totals.activeMs)} of JavaScript executed${react.detected ? ` and React committed ${commits} times` : ''}, so there is nothing slow to point at.`,
      pinned: 1,
      fix: 'Press Record, then use the page (open a dashboard, scroll, type, switch tabs) before you press Stop — or use “Record page load” to profile startup.',
    });
  }

  // ----- long tasks -------------------------------------------------------
  longTasks.slice(0, 6).forEach((t, i) => {
    const top = t.topFunctions.find(f => !f.file.startsWith('('));
    add({
      id: `long-task-${i}`,
      severity: t.durMs >= 200 ? 'critical' : 'warning',
      category: 'Main thread',
      title: `${fmt(t.durMs)} long task at ${(t.startMs / 1000).toFixed(2)}s (${t.trigger.type})`,
      detail:
        `Blocked input for ${fmt(t.blockingMs)}. ` +
        `${Object.entries(t.breakdown)
          .filter(([, v]) => v >= 1)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k} ${fmt(v)}`)
          .join(', ')}.` +
        (top
          ? ` Most time in ${top.name}() — ${where(top.file, top.line)} (${fmt(top.ms)}).`
          : ' No JavaScript was sampled inside it (native browser work).'),
      file: top?.file,
      culprits: t.topFunctions
        .filter(f => !f.file.startsWith('('))
        .slice(0, 3)
        .map(fromFunction),
      impactMs: t.blockingMs,
      fix: 'Break the work up (chunk it, defer with requestIdleCallback/startTransition), memoize the expensive computation, or move it off the main thread.',
    });
  });
  if (vitals.tbtMs >= 200) {
    add({
      id: 'tbt',
      severity: vitals.tbtMs >= 600 ? 'critical' : 'warning',
      category: 'Main thread',
      title: `Total blocking time ${fmt(vitals.tbtMs)} across ${vitals.longTaskCount} long tasks`,
      detail: `Longest task ${fmt(vitals.maxLongTaskMs)}. Anything over 200ms of TBT makes the page feel unresponsive.`,
      culprits: (vitals.tbtCulprits || []).map(fromFunction),
      impactMs: vitals.tbtMs,
      fix: 'Start with the long tasks listed above, biggest first.',
    });
  }

  // ----- hot code ---------------------------------------------------------
  appFiles
    .filter(
      f =>
        f.selfMs >= 80 ||
        (busyEnough && f.selfMs >= 30 && f.selfMs / activeMs >= 0.1),
    )
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 5)
    .forEach(f => {
      const fn = f.functions[0];
      add({
        id: `hot-file-${f.path}`,
        severity: f.selfMs >= 300 ? 'critical' : 'warning',
        category: 'CPU',
        title: `${f.path} spent ${fmt(f.selfMs)} of JavaScript (${Math.round((f.selfMs / activeMs) * 100)}% of CPU)`,
        detail: fn
          ? `Hottest function: ${fn.name}() — ${where(f.path, fn.line)} (${fmt(fn.selfMs)} self).`
          : '',
        file: f.path,
        culprits: f.functions
          .slice(0, 3)
          .map(fn =>
            culprit(fn.name, f.path, fn.line, fn.lineKind, fn.abs, fn.selfMs),
          ),
        impactMs: f.selfMs,
        fix: 'Look for work repeated on every render/event, loops over large data, or JSON/regex/sort work that can be cached, memoized or moved to a worker.',
      });
    });
  files
    .filter(
      f =>
        f.vendor &&
        (f.selfMs >= 100 || (busyEnough && f.selfMs / activeMs >= 0.12)),
    )
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 3)
    .forEach(f => {
      const drivers = (report.vendorDrivers || {})[f.pkg] || [];
      add({
        id: `hot-vendor-${f.pkg}`,
        severity: 'info',
        category: 'CPU',
        title: `Library ${f.pkg} used ${fmt(f.selfMs)} of CPU`,
        detail: drivers.length
          ? `Driven mostly by ${drivers[0].fn}() — ${where(drivers[0].file, drivers[0].line)}. Libraries are rarely slow by themselves; the cost comes from how often and with how much data the app calls them.`
          : 'Libraries are rarely slow by themselves; the cost comes from how often and with how much data the app calls them.',
        file: drivers[0]?.file || f.path,
        culprits: drivers.map(d =>
          culprit(
            d.fn,
            d.file,
            d.line,
            d.lineKind,
            d.abs,
            d.ms,
            `calls into ${f.pkg}`,
          ),
        ),
        impactMs: f.selfMs,
        fix: 'Reduce how often the calling code runs or how much data it passes in (memoize, debounce, paginate).',
      });
    });

  // ----- forced reflow ----------------------------------------------------
  const byBlame = new Map();
  for (const f of forcedReflows) {
    const key = `${f.file}|${f.fn}|${f.line}`;
    const agg = byBlame.get(key) || { ...f, count: 0, ms: 0 };
    agg.count += f.count;
    agg.ms += f.ms;
    byBlame.set(key, agg);
  }
  [...byBlame.values()]
    .filter(f => f.ms >= 5 || f.count >= 10)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .forEach(f => {
      add({
        id: `forced-${f.file}-${f.fn}`,
        severity: f.ms >= 50 ? 'critical' : 'warning',
        category: 'Layout',
        title: `Forced reflow in ${f.fn || 'an unknown function'} — ${f.count}× for ${fmt(f.ms)}`,
        detail: `${where(f.file, f.line)} reads layout (offsetHeight, getBoundingClientRect, scrollTop…) after the DOM was changed, forcing the browser to recalculate layout synchronously.`,
        file: f.file,
        culprits: [
          culprit(
            f.fn,
            f.file,
            f.line,
            f.lineKind,
            f.abs,
            f.ms,
            f.caller ? `called from ${f.caller.fn}()` : '',
          ),
        ],
        impactMs: f.ms,
        fix: 'Batch reads before writes, read layout once and reuse it, or use ResizeObserver/IntersectionObserver instead of measuring in handlers.',
      });
    });
  if (report.thrashTasks > 0) {
    add({
      id: 'layout-thrash',
      severity: 'critical',
      category: 'Layout',
      title: `Layout thrashing in ${report.thrashTasks} task${report.thrashTasks > 1 ? 's' : ''}`,
      detail:
        'Several forced layouts happened inside a single task: reads and writes of layout are interleaved.',
      impactMs: forcedReflows.reduce((s, f) => s + f.ms, 0),
      fix: 'Separate the read phase from the write phase (measure everything first, then mutate).',
    });
  }

  // ----- React ------------------------------------------------------------
  const componentCulprit = (c, ms, note) =>
    culprit(c.name, c.file, c.line, c.lineKind, c.abs, ms, note);
  if (react.detected && react.hasTimings) {
    react.components
      .filter(c => c.wasted >= 5 && c.wasted / c.renders >= 0.3)
      .sort((a, b) => b.wastedMs - a.wastedMs || b.wasted - a.wasted)
      .slice(0, 6)
      .forEach(c => {
        const unstable = c.unstableProps[0];
        add({
          id: `wasted-${c.name}-${c.file}`,
          severity:
            c.wastedMs >= 30 || c.wasted >= 100 ? 'critical' : 'warning',
          category: 'React',
          title: `${c.name} re-rendered ${c.renders}× — ${c.wasted} with nothing changed (${Math.round((c.wasted / c.renders) * 100)}%)`,
          detail:
            `${where(c.file, c.line)}. ${fmt(c.wastedMs)} spent on renders whose props, state and context were identical.` +
            (c.topParent
              ? ` Usually re-rendered by its parent ${c.topParent}.`
              : ''),
          file: c.file,
          culprits: [
            componentCulprit(
              c,
              c.wastedMs,
              c.topParent
                ? `re-rendered by parent ${c.topParent}`
                : 'component',
            ),
          ],
          impactMs: c.wastedMs,
          fix: unstable
            ? `Wrap in React.memo, and stabilise the props that keep changing identity (${unstable.prop}: ${unstable.kind}).`
            : 'Wrap in React.memo, or stop the parent re-rendering (move state down, split the component).',
        });
      });
    react.components
      .flatMap(c => c.unstableProps.map(p => ({ c, p })))
      .filter(({ p }) => p.count >= 8)
      .sort((a, b) => b.p.count - a.p.count)
      .slice(0, 6)
      .forEach(({ c, p }) => {
        add({
          id: `unstable-${c.name}-${p.prop}`,
          severity: 'warning',
          category: 'React',
          title: `${c.name} gets a new ${p.kind === 'function' ? 'function' : 'object'} for “${p.prop}” on every render (${p.count}×)`,
          detail: `${where(c.file, c.line)}. The value is recreated with ${p.kind === 'function' ? 'identical code' : 'identical contents'} but a new identity, which defeats React.memo and re-triggers effects that depend on it. Look at where ${c.topParent || 'the parent'} passes “${p.prop}”.`,
          file: c.file,
          culprits: [
            componentCulprit(
              c,
              c.totalMs * (p.count / Math.max(c.renders, 1)),
              `receives unstable prop “${p.prop}”`,
            ),
          ],
          impactMs: c.totalMs * (p.count / Math.max(c.renders, 1)),
          fix:
            p.kind === 'function'
              ? `Create “${p.prop}” with useCallback (or hoist it out of the parent).`
              : `Create “${p.prop}” with useMemo, or hoist the constant out of the component.`,
        });
      });
    react.components
      .filter(
        c => c.selfMs >= 100 || (c.renders >= 5 && c.selfMs / c.renders >= 12),
      )
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, 5)
      .forEach(c => {
        add({
          id: `slow-component-${c.name}-${c.file}`,
          severity: c.selfMs >= 300 ? 'critical' : 'warning',
          category: 'React',
          title: `${c.name} is slow to render: ${fmt(c.selfMs)} total, ${fmt(c.selfMs / c.renders)} per render (${c.renders}×)`,
          detail: `${where(c.file, c.line)}. Self time excludes its children.`,
          file: c.file,
          culprits: [componentCulprit(c, c.selfMs, 'slow render')],
          impactMs: c.selfMs,
          fix: 'Move expensive calculations into useMemo, virtualise long lists, and avoid deriving large data structures inside render.',
        });
      });
    react.components
      .filter(
        c =>
          c.renders >= 60 &&
          c.renders / Math.max(report.meta.durationMs / 1000, 1) >= 10,
      )
      .sort((a, b) => b.renders - a.renders)
      .slice(0, 3)
      .forEach(c => {
        add({
          id: `frequent-${c.name}-${c.file}`,
          severity: 'warning',
          category: 'React',
          title: `${c.name} rendered ${c.renders}× (${(c.renders / (report.meta.durationMs / 1000)).toFixed(0)}/s)`,
          detail: `${where(c.file, c.line)}. Reasons: ${
            Object.entries(c.reasons)
              .filter(([, n]) => n)
              .map(([k, n]) => `${k} ${n}`)
              .join(', ') || 'mount'
          }.`,
          file: c.file,
          culprits: [componentCulprit(c, c.selfMs, 'renders very often')],
          impactMs: c.selfMs,
          fix: 'Find what updates this often (a timer, a store subscription, a scroll handler) and throttle it or narrow the selector/subscription.',
        });
      });
    react.slowCommits.slice(0, 3).forEach((c, i) => {
      if (c.dur < 50) return;
      add({
        id: `commit-${i}`,
        severity: c.dur >= 100 ? 'critical' : 'warning',
        category: 'React',
        title: `React commit took ${fmt(c.dur)} (${c.rendered} components rendered, ${c.wasted} wasted)`,
        detail: `At ${(c.tMs / 1000).toFixed(2)}s.`,
        culprits: react.components
          .slice(0, 3)
          .map(k =>
            componentCulprit(k, k.selfMs, 'slowest components overall'),
          ),
        impactMs: c.dur,
        fix: 'Look for a high component count: a state change near the root of a large tree. Lift state down or split context.',
      });
    });
  } else if (react.detected && !react.hasTimings) {
    add({
      id: 'react-prod',
      severity: 'info',
      category: 'React',
      title: 'React is a production build: render timings are unavailable',
      detail:
        'Render counts and reasons are still collected where possible, but durations need a development or profiling build.',
      fix: 'Profile against the dev server (npm run start / webpack-dev-server).',
    });
  } else if (!react.detected) {
    add({
      id: 'react-missing',
      severity: 'info',
      category: 'React',
      title: 'No React renderer was seen on this page',
      detail:
        'The probe must be installed before React loads. Use “Reload & record” (or Reload after connecting) so it is injected first.',
      fix: 'Click “Record page load”, or reload the tab from this tool.',
    });
  }

  // ----- layout shifts / interactions / vitals ----------------------------
  if (vitals.cls >= 0.1) {
    const worst = vitals.shifts[0];
    add({
      id: 'cls',
      severity: vitals.cls >= 0.25 ? 'critical' : 'warning',
      category: 'Visual stability',
      title: `Cumulative layout shift ${vitals.cls.toFixed(3)}`,
      detail: worst
        ? `Biggest shift (${worst.value.toFixed(3)}) moved ${worst.sources.join(', ') || 'unknown elements'}.`
        : '',
      impactMs: vitals.cls * 1000,
      fix: 'Reserve space (width/height, min-height, skeletons) for content that loads late, and avoid inserting content above existing content.',
    });
  }
  report.interactions.slice(0, 3).forEach((e, i) => {
    if (e.durMs < 200) return;
    add({
      id: `interaction-${i}`,
      severity: e.durMs >= 500 ? 'critical' : 'warning',
      category: 'Responsiveness',
      title: `Slow ${e.type} on ${e.target || 'page'}: ${fmt(e.durMs)}`,
      detail: `Input delay ${fmt(e.inputDelayMs)}, handler ${fmt(e.processingMs)}, next paint ${fmt(e.presentMs)}.`,
      culprits: (vitals.tbtCulprits || []).slice(0, 2).map(fromFunction),
      impactMs: e.durMs,
      fix:
        e.processingMs >= e.inputDelayMs && e.processingMs >= e.presentMs
          ? 'The handler itself is slow: profile it in Call tree.'
          : 'The main thread was busy (input delay) or rendering after the handler was slow (presentation delay).',
    });
  });
  if (vitals.lcpMs && vitals.lcpMs > 2500) {
    add({
      id: 'lcp',
      severity: vitals.lcpMs > 4000 ? 'critical' : 'warning',
      category: 'Loading',
      title: `Largest Contentful Paint ${(vitals.lcpMs / 1000).toFixed(2)}s`,
      detail: vitals.lcpElement ? `LCP element: ${vitals.lcpElement}.` : '',
      culprits: (report.hotFunctions || [])
        .filter(f => !f.vendor)
        .slice(0, 3)
        .map(f =>
          culprit(
            f.name,
            f.file,
            f.line,
            f.lineKind,
            f.abs,
            f.selfMs,
            'hottest app function during load',
          ),
        ),
      impactMs: vitals.lcpMs,
      fix: 'Reduce render-blocking JS/CSS, split the main bundle, and avoid fetching data before the first meaningful content can render.',
    });
  }
  if (vitals.fcpMs && vitals.fcpMs > 1800) {
    add({
      id: 'fcp',
      severity: vitals.fcpMs > 3000 ? 'critical' : 'warning',
      category: 'Loading',
      title: `First Contentful Paint ${(vitals.fcpMs / 1000).toFixed(2)}s`,
      detail: '',
      impactMs: vitals.fcpMs,
      fix: 'Reduce the JavaScript that must run before first paint.',
    });
  }

  // ----- time spent outside app code -------------------------------------
  if (busyEnough && totals.gcMs / activeMs >= 0.1 && totals.gcMs >= 50) {
    add({
      id: 'gc',
      severity: 'warning',
      category: 'Memory',
      title: `Garbage collection took ${fmt(totals.gcMs)} (${Math.round((totals.gcMs / activeMs) * 100)}% of CPU)`,
      detail:
        'Heavy allocation churn: many short-lived objects or arrays created per render/event.',
      culprits: (report.hotFunctions || [])
        .filter(f => !f.vendor)
        .slice(0, 3)
        .map(f =>
          culprit(
            f.name,
            f.file,
            f.line,
            f.lineKind,
            f.abs,
            f.selfMs,
            'busiest app function (likely allocator)',
          ),
        ),
      impactMs: totals.gcMs,
      fix: 'Avoid creating large intermediate arrays/objects in hot paths; reuse or memoize them.',
    });
  }
  if (totals.compileMs >= 100) {
    add({
      id: 'compile',
      severity: 'warning',
      category: 'Loading',
      title: `Script compile/parse took ${fmt(totals.compileMs)}`,
      detail: 'Large JavaScript bundles cost CPU to parse before they run.',
      impactMs: totals.compileMs,
      fix: 'Code-split by route/feature and lazy-load heavy components.',
    });
  }
  if (memory.domNodes >= 1500) {
    add({
      id: 'dom-size',
      severity: memory.domNodes >= 3000 ? 'critical' : 'warning',
      category: 'Memory',
      title: `Large DOM: ${memory.domNodes.toLocaleString()} nodes`,
      detail: `${memory.listeners.toLocaleString()} event listeners. Style recalculation and layout cost grows with DOM size.`,
      impactMs: memory.domNodes / 50,
      fix: 'Virtualise long lists and tables, and unmount hidden tabs/modals instead of hiding them.',
    });
  }
  if (memory.heapGrowthMb >= 30) {
    add({
      id: 'heap-growth',
      severity: memory.heapGrowthMb >= 100 ? 'critical' : 'warning',
      category: 'Memory',
      title: `JS heap grew ${memory.heapGrowthMb.toFixed(0)} MB during the recording`,
      detail:
        'Sustained growth across repeated actions indicates a leak (listeners, timers or caches never released).',
      impactMs: memory.heapGrowthMb * 5,
      fix: 'Repeat the action a few times and compare. Check for un-removed listeners, intervals and growing module-level caches.',
    });
  }

  // ----- network ----------------------------------------------------------
  network.uncompressed.slice(0, 3).forEach((r, i) => {
    add({
      id: `uncompressed-${i}`,
      severity: 'warning',
      category: 'Network',
      title: `${r.name} is served uncompressed (${(r.decoded / 1024).toFixed(0)} KB)`,
      detail: r.url,
      impactMs: r.decoded / 1024 / 4,
      fix: 'Enable gzip/brotli for JS, CSS and JSON responses.',
    });
  });
  network.large.slice(0, 3).forEach((r, i) => {
    if (r.encoded < 500 * 1024) return;
    add({
      id: `large-${i}`,
      severity: r.encoded > 2 * 1024 * 1024 ? 'critical' : 'warning',
      category: 'Network',
      title: `${r.name} is ${(r.encoded / 1024 / 1024).toFixed(2)} MB over the wire`,
      detail: r.url,
      impactMs: r.encoded / 1024 / 4,
      fix: 'Split the bundle, drop unused dependencies, or lazy-load it.',
    });
  });
  network.slow.slice(0, 3).forEach((r, i) => {
    if (r.durMs < 1500) return;
    add({
      id: `slow-request-${i}`,
      severity: r.durMs >= 4000 ? 'critical' : 'warning',
      category: 'Network',
      title: `${r.name} took ${(r.durMs / 1000).toFixed(2)}s`,
      detail: r.url,
      impactMs: r.durMs,
      fix: 'Check the backend endpoint, add caching, or fetch it earlier / in parallel.',
    });
  });

  // Setup problems (error page, idle recording) explain everything else, so they lead their severity.
  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.pinned || 0) - (a.pinned || 0) ||
      b.impactMs - a.impactMs,
  );
}
