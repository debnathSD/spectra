/**
 * Joins the four data sources into one report:
 *   trace (main-thread work) + CPU samples (which code) + React probe
 *   (which components, why) + browser vitals (what users feel).
 */
import {
  buildCallTree,
  analyzeCpuProfile,
  extractCpuProfile,
  nodeAt,
  pathTo,
  windowSelf,
} from './cpu.js';
import { buildFindings } from './findings.js';
import {
  CATEGORIES,
  LONG_TASK_US,
  analyzeTrace,
  findMainThread,
} from './trace.js';
import { packageOf } from './sources.js';

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const ms = us => us / 1000;

function newFile(path, vendor, pkg) {
  return {
    path,
    vendor,
    pkg,
    selfMs: 0,
    totalMs: 0,
    blockMs: 0,
    reactMs: 0,
    renders: 0,
    wasted: 0,
    forcedMs: 0,
    forcedCount: 0,
    functions: [],
    components: [],
  };
}

function fileEntry(map, loc) {
  let f = map.get(loc.file);
  if (!f) {
    f = newFile(loc.file, loc.vendor, loc.pkg);
    map.set(loc.file, f);
  }
  return f;
}

function pickBlameFrame(frames) {
  return (
    frames.find(f => !f.vendor && f.file !== '(native)') ||
    frames.find(f => f.file !== '(native)') ||
    frames[0] ||
    null
  );
}

const isAnonymous = name => !name || name === '(anonymous)';

/**
 * Best line to show for a function. A source-mapped line is exact; otherwise the
 * function's definition is looked up by name in the real file ("located").
 */
function locate(sourceIndex, file, name, line, exact) {
  const real = file && !file.startsWith('(') && !file.startsWith('bundle:');
  const abs = real && sourceIndex ? sourceIndex.absolutePath(file) : null;
  if (exact && line) return { line, lineKind: 'exact', abs };
  const hit = real && sourceIndex ? sourceIndex.lookup(file, name) : null;
  if (hit?.line) return { line: hit.line, lineKind: 'located', abs: hit.abs };
  return { line: line ?? null, lineKind: line ? 'exact' : null, abs };
}

function collectScriptIds(events, profile, locations) {
  const ids = new Set();
  for (const n of profile?.nodes || [])
    if (n.callFrame?.scriptId) ids.add(String(n.callFrame.scriptId));
  for (const e of events) {
    const stack = e.args?.beginData?.stackTrace || e.args?.data?.stackTrace;
    if (stack)
      for (const f of stack) if (f.scriptId) ids.add(String(f.scriptId));
  }
  for (const loc of locations.values())
    if (loc?.scriptId) ids.add(String(loc.scriptId));
  return ids;
}

/**
 * @param {object} input
 * @param {object[]} input.events              raw trace events
 * @param {object|null} input.probe            __PERF_PROBE__.snapshot()
 * @param {object} input.metrics               {before, after, dom}
 * @param {Map<number, {scriptId: string, lineNumber: number, columnNumber: number}>} input.locations  component id -> function location
 * @param {import('./sources.js').SourceResolver} input.resolver
 * @param {object} input.meta
 */
export async function buildReport({
  events,
  probe,
  metrics,
  locations,
  resolver,
  meta,
  sourceIndex = null,
}) {
  const thread = findMainThread(events);
  if (!thread)
    throw new Error(
      'No renderer main thread found in the trace (was the page idle or closed?).',
    );

  const trace = analyzeTrace(events, thread);
  const profile = extractCpuProfile(events, thread.pid, thread.tid);
  await resolver.prepare(collectScriptIds(events, profile, locations));

  const cpu = profile
    ? analyzeCpuProfile(profile, cf =>
        resolver.resolve(
          String(cf.scriptId),
          cf.url,
          cf.lineNumber,
          cf.columnNumber,
          cf.functionName,
        ),
      )
    : null;
  const origin = trace.firstTs;
  const rel = us => ms(us - origin);
  const files = new Map();

  // ----- CPU per file / function ------------------------------------------
  if (cpu) {
    for (const f of cpu.files) {
      if (f.file.startsWith('(')) continue;
      const entry = fileEntry(files, f);
      entry.selfMs += ms(f.selfUs);
      entry.totalMs += ms(f.totalUs);
    }
    for (const fn of cpu.functions) {
      if (fn.file.startsWith('(')) continue;
      const entry = files.get(fn.file);
      if (entry) {
        entry.functions.push({
          name: fn.name,
          line: fn.line,
          bundleLine: fn.bundleLine + 1,
          exact: fn.exact,
          selfMs: ms(fn.selfUs),
          totalMs: ms(fn.totalUs),
        });
      }
    }
    for (const f of files.values()) {
      f.functions = f.functions
        .filter(fn => fn.selfMs >= 0.3 || fn.totalMs >= 3)
        .sort((a, b) => b.selfMs - a.selfMs)
        .slice(0, 30);
      if (!f.vendor) {
        f.functions = f.functions.map(fn => ({
          ...fn,
          ...locate(sourceIndex, f.path, fn.name, fn.line, fn.exact),
        }));
      }
    }
  }

  // Starting the CPU profiler makes V8 index every function of a large app, which
  // stalls the main thread at the very start of a live recording. It looks like a
  // long task with no JavaScript in it; it is measurement overhead, not the app.
  const jsUsIn = t => {
    if (!cpu) return 0;
    let sum = 0;
    for (const [node, us] of windowSelf(cpu, t.ts, t.ts + t.durUs)) {
      if (!node.native) sum += us;
    }
    return sum;
  };
  const isStartupArtifact = t =>
    meta.mode === 'live' &&
    rel(t.ts) < 500 &&
    t.breakdown.other >= 0.8 * t.durUs &&
    jsUsIn(t) < 0.1 * t.durUs;
  const artifactTasks = new Set(trace.longTasks.filter(isStartupArtifact));
  const artifactMs = ms([...artifactTasks].reduce((s, t) => s + t.durUs, 0));
  const realLongTasks = trace.longTasks.filter(t => !artifactTasks.has(t));

  // ----- long tasks (with blame from the samples inside them) ---------------
  const longTasks = realLongTasks.slice(0, 40).map(t => {
    const topFiles = new Map();
    const topFns = new Map();
    if (cpu) {
      for (const [node, us] of windowSelf(cpu, t.ts, t.ts + t.durUs)) {
        if (node.native) continue;
        topFiles.set(node.loc.file, (topFiles.get(node.loc.file) || 0) + us);
        const key = `${node.name}|${node.loc.file}|${node.loc.line ?? ''}`;
        topFns.set(key, {
          name: node.name,
          file: node.loc.file,
          line: node.loc.line,
          exact: node.loc.exact,
          ms: (topFns.get(key)?.ms || 0) + ms(us),
        });
      }
    }
    const blocking = ms(t.durUs) - ms(LONG_TASK_US);
    for (const [file, us] of topFiles) {
      const f = files.get(file);
      if (f) f.blockMs += ms(us) * (blocking / ms(t.durUs));
    }
    return {
      startMs: round(rel(t.ts)),
      durMs: round(ms(t.durUs)),
      blockingMs: round(blocking),
      trigger: t.trigger,
      breakdown: Object.fromEntries(
        CATEGORIES.map(c => [c, round(ms(t.breakdown[c]))]),
      ),
      topFiles: [...topFiles]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([file, us]) => ({ file, ms: round(ms(us)) })),
      topFunctions: [...topFns.values()]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 6)
        .map(f => ({
          name: f.name,
          file: f.file,
          ms: round(f.ms),
          ...locate(sourceIndex, f.file, f.name, f.line, f.exact),
        })),
      forcedCount: t.forcedCount,
      thrash: t.thrash,
    };
  });

  // ----- forced reflow ----------------------------------------------------
  const forcedReflows = trace.forced.map(f => {
    let frames = [];
    if (f.stack) {
      frames = f.stack.map(fr => ({
        ...resolver.resolve(
          String(fr.scriptId),
          fr.url,
          fr.lineNumber,
          fr.columnNumber,
          fr.functionName,
        ),
        fnName: fr.functionName,
      }));
    } else if (cpu) {
      const node = nodeAt(cpu, f.ts + f.durUs / 2);
      if (node) {
        frames = pathTo(node, cpu.nodes)
          .reverse()
          .map(n => ({ ...n.loc, fnName: n.name }));
      }
    }
    const blame = pickBlameFrame(frames);
    const caller = blame ? frames[frames.indexOf(blame) + 1] : null;
    const callerName = caller?.name || caller?.fnName || '';
    let fn = blame?.name || blame?.fnName || '';
    if (isAnonymous(fn) && callerName) fn = `(anonymous in ${callerName})`;
    return {
      kind: f.kind,
      ms: ms(f.durUs),
      startMs: rel(f.ts),
      file: blame?.file || '',
      fn,
      line: blame?.line ?? null,
      exact: Boolean(blame?.exact),
      caller: callerName
        ? { fn: callerName, file: caller.file, line: caller.line ?? null }
        : null,
      trigger: f.scriptParent,
    };
  });
  for (const f of forcedReflows) {
    const entry = f.file && files.get(f.file);
    if (entry) {
      entry.forcedMs += f.ms;
      entry.forcedCount += 1;
    }
  }

  // ----- React ------------------------------------------------------------
  const reactReport = summarizeReact(
    probe,
    locations,
    resolver,
    files,
    meta.durationMs,
    sourceIndex,
  );

  // ----- vitals -----------------------------------------------------------
  const v = probe?.vitals;
  const tbtMs = realLongTasks.reduce((s, t) => s + (ms(t.durUs) - 50), 0);
  const tbtCulprits = mergeFunctions(longTasks);
  const loadMode = meta.mode === 'load';
  const shifts = (v?.shifts || []).sort((a, b) => b.value - a.value);
  const interactions = summarizeInteractions(v?.events || []);
  const m = metrics;
  const delta = key => (m.after[key] ?? 0) - (m.before[key] ?? 0);
  const activeMs = cpu ? ms(cpu.totals.activeUs) : ms(trace.busyUs);

  const network = summarizeNetwork(
    probe?.resources || [],
    meta.mode === 'load' ? 0 : probe?.since || 0,
  );

  const report = {
    id: meta.id,
    createdAt: meta.createdAt,
    meta: {
      url: meta.url,
      title: meta.title,
      mode: meta.mode,
      durationMs: meta.durationMs,
      cpuThrottle: meta.cpuThrottle,
      userAgent: meta.userAgent,
      git: meta.git ?? null,
      label: meta.label || '',
      navStatus: meta.navStatus ?? null,
      navUrl: meta.navUrl || '',
      attribution: [...resolver.kinds].join(' + ') || 'none',
      sampleCount: cpu?.totals.sampleCount || 0,
      probeOverheadMs: round(probe?.overheadMs || 0),
    },
    vitals: {
      // FCP/LCP belong to page load; in an interaction recording they describe an earlier load.
      fcpMs: loadMode && v?.fcp ? round(v.fcp) : null,
      lcpMs: loadMode && v?.lcp ? round(v.lcp.start) : null,
      lcpElement: loadMode ? v?.lcp?.el || '' : '',
      cls: round(
        shifts.reduce((s, x) => s + x.value, 0),
        4,
      ),
      shifts: shifts.slice(0, 8).map(s => ({
        ...s,
        value: round(s.value, 4),
        start: round(s.start),
        sources: s.sources.filter(Boolean),
      })),
      tbtMs: round(tbtMs),
      tbtCulprits,
      longTaskCount: realLongTasks.length,
      maxLongTaskMs: round(
        realLongTasks.length ? ms(realLongTasks[0].durUs) : 0,
      ),
      inpMs: interactions.length ? interactions[0].durMs : null,
      ttfbMs: probe?.navigation ? round(probe.navigation.ttfb) : null,
      loadMs: probe?.navigation?.load ? round(probe.navigation.load) : null,
    },
    totals: {
      activeMs: round(activeMs),
      busyMs: round(Math.max(0, ms(trace.busyUs) - artifactMs)),
      scriptingMs: round(ms(trace.totals.scripting)),
      compileMs: round(ms(trace.totals.compile)),
      styleMs: round(ms(trace.totals.style)),
      layoutMs: round(ms(trace.totals.layout)),
      paintMs: round(ms(trace.totals.paint)),
      gcMs: round(cpu ? ms(cpu.totals.gcUs) : ms(trace.totals.gc)),
      parseMs: round(ms(trace.totals.parse)),
      otherMs: round(Math.max(0, ms(trace.totals.other) - artifactMs)),
      layoutCount: trace.counts.layout,
      styleRecalcCount: trace.counts.style,
      forcedLayoutCount: forcedReflows.filter(f => f.kind === 'layout').length,
      forcedStyleCount: forcedReflows.filter(f => f.kind === 'style').length,
      forcedMs: round(forcedReflows.reduce((s, f) => s + f.ms, 0)),
      maxLayoutObjects: trace.maxLayoutObjects,
    },
    memory: {
      domNodes: m.dom?.nodes ?? m.after.Nodes ?? 0,
      listeners: m.dom?.jsEventListeners ?? m.after.JSEventListeners ?? 0,
      heapUsedMb: round((m.after.JSHeapUsedSize || 0) / 1048576, 1),
      heapGrowthMb: round(delta('JSHeapUsedSize') / 1048576, 1),
      layoutCount: delta('LayoutCount'),
      recalcStyleCount: delta('RecalcStyleCount'),
    },
    longTasks,
    thrashTasks:
      realLongTasks.filter(t => t.thrash).length +
      trace.tasks.filter(t => t.thrash && t.durUs < LONG_TASK_US).length,
    forcedReflows: aggregateForced(forcedReflows, sourceIndex),
    interactions,
    react: reactReport,
    network,
    callTree: cpu
      ? buildCallTree(cpu, {
          minUs: Math.max(1000, cpu.totals.activeUs * 0.004),
        })
      : null,
    files: [],
    timeline: trace.tasks
      .filter(t => t.durUs >= 8000 && !artifactTasks.has(t))
      .map(t => ({ startMs: round(rel(t.ts)), durMs: round(ms(t.durUs)) }))
      .slice(0, 2000),
    hotFunctions: hotFunctions(cpu, sourceIndex),
    vendorDrivers: vendorDrivers(cpu, sourceIndex),
    notes: [],
  };
  if (artifactMs > 0) {
    report.notes.push(
      `Ignored a ${round(artifactMs)} ms stall at the very start of the recording: Chrome was indexing the app's code for the CPU profiler, so it is measurement overhead, not something your app did.`,
    );
  }

  report.files = [...files.values()]
    .filter(f => f.selfMs >= 0.2 || f.renders || f.forcedCount || f.blockMs)
    .map(f => ({
      ...f,
      selfMs: round(f.selfMs),
      totalMs: round(f.totalMs),
      blockMs: round(f.blockMs),
      reactMs: round(f.reactMs),
      forcedMs: round(f.forcedMs),
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 2500);

  if (!cpu)
    report.notes.push(
      'No CPU samples were captured; file attribution is limited to React and layout data.',
    );
  if (
    report.meta.attribution === 'urls' ||
    report.meta.attribution === 'none'
  ) {
    report.notes.push(
      'Scripts have no source maps and no webpack module markers, so time is attributed to bundles. Profile a development build for per-file results.',
    );
  }
  report.findings = buildFindings(report);
  return report;
}

function aggregateForced(list, sourceIndex) {
  const map = new Map();
  for (const f of list) {
    const key = `${f.kind}|${f.file}|${f.fn}|${f.line}`;
    const agg = map.get(key) || {
      kind: f.kind,
      file: f.file,
      fn: f.fn,
      line: f.line,
      exact: f.exact,
      caller: f.caller,
      count: 0,
      ms: 0,
    };
    agg.count += 1;
    agg.ms += f.ms;
    map.set(key, agg);
  }
  return [...map.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 60)
    .map(a => ({
      ...a,
      ms: round(a.ms),
      ...locate(sourceIndex, a.file, a.fn, a.line, a.exact),
    }));
}

/** The same function across several long tasks, summed and ranked. */
function mergeFunctions(longTasks) {
  const merged = new Map();
  for (const t of longTasks) {
    for (const f of t.topFunctions) {
      if (f.file.startsWith('(')) continue;
      const key = `${f.file}|${f.name}`;
      const cur = merged.get(key) || { ...f, ms: 0 };
      cur.ms += f.ms;
      merged.set(key, cur);
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 4)
    .map(f => ({ ...f, ms: round(f.ms) }));
}

/** The slowest functions by self time: the exact code to look at first. */
function hotFunctions(cpu, sourceIndex) {
  if (!cpu) return [];
  const active = cpu.totals.activeUs || 1;
  return cpu.functions
    .filter(fn => !fn.file.startsWith('(') && fn.selfUs >= 1000)
    .sort((a, b) => b.selfUs - a.selfUs)
    .slice(0, 25)
    .map(fn => {
      const vendor = fn.file.includes('node_modules/');
      return {
        name: fn.name,
        file: fn.file,
        vendor,
        selfMs: round(ms(fn.selfUs)),
        totalMs: round(ms(fn.totalUs)),
        share: round((fn.selfUs / active) * 100, 1),
        bundleLine: fn.bundleLine + 1,
        ...(vendor
          ? { line: null, lineKind: null, abs: null }
          : locate(sourceIndex, fn.file, fn.name, fn.line, fn.exact)),
      };
    });
}

/** For each hot library, the application functions that call into it. */
function vendorDrivers(cpu, sourceIndex) {
  const out = {};
  if (!cpu) return out;
  const totals = [...cpu.vendorDrivers].map(([pkg, drivers]) => [
    pkg,
    drivers,
    [...drivers.values()].reduce((s, d) => s + d.us, 0),
  ]);
  for (const [pkg, drivers] of totals
    .sort((a, b) => b[2] - a[2])
    .slice(0, 15)) {
    out[pkg] = [...drivers.values()]
      .sort((a, b) => b.us - a.us)
      .slice(0, 3)
      .map(d => ({
        fn: d.name,
        file: d.file,
        ms: round(ms(d.us)),
        ...locate(sourceIndex, d.file, d.name, d.line, d.exact),
      }));
  }
  return out;
}

function summarizeInteractions(events) {
  const byInteraction = new Map();
  for (const e of events) {
    // Only events with an interactionId are user interactions (hover events have none);
    // pointerdown/pointerup/click of one gesture share the id.
    if (!e.interaction) continue;
    const key = e.interaction;
    const cur = byInteraction.get(key);
    if (!cur || e.dur > cur.dur) byInteraction.set(key, e);
  }
  return [...byInteraction.values()]
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 15)
    .map(e => ({
      type: e.name,
      target: e.target,
      startMs: round(e.start),
      durMs: round(e.dur),
      inputDelayMs: round(e.input),
      processingMs: round(e.processing),
      presentMs: round(e.present),
    }));
}

function shortName(url) {
  try {
    const u = new URL(url);
    return (
      decodeURIComponent(
        u.pathname.split('/').filter(Boolean).pop() || u.host,
      ) + (u.search ? '?…' : '')
    );
  } catch {
    return url.slice(0, 60);
  }
}

function summarizeNetwork(resources, sinceMs) {
  const list = resources
    .filter(r => r.start >= sinceMs)
    .map(r => ({
      url: r.url,
      name: shortName(r.url),
      type: r.type,
      startMs: round(r.start),
      durMs: round(r.dur),
      transfer: r.transfer,
      encoded: r.encoded,
      decoded: r.decoded,
      blocking: r.blocking,
    }));
  const compressible = /\.(?:js|mjs|css|json|svg|html)(?:$|\?)/i;
  const dupes = new Map();
  for (const r of list) dupes.set(r.url, (dupes.get(r.url) || 0) + 1);
  return {
    count: list.length,
    totalEncoded: list.reduce((s, r) => s + (r.encoded || 0), 0),
    totalDecoded: list.reduce((s, r) => s + (r.decoded || 0), 0),
    slow: [...list].sort((a, b) => b.durMs - a.durMs).slice(0, 15),
    large: [...list].sort((a, b) => b.encoded - a.encoded).slice(0, 15),
    uncompressed: list
      .filter(
        r =>
          compressible.test(r.url) &&
          r.decoded > 50 * 1024 &&
          r.encoded >= r.decoded * 0.95 &&
          r.transfer > 0,
      )
      .sort((a, b) => b.decoded - a.decoded)
      .slice(0, 10),
    duplicates: [...dupes]
      .filter(([, n]) => n >= 3)
      .map(([url, n]) => ({ url, name: shortName(url), count: n }))
      .slice(0, 10),
  };
}

function summarizeReact(
  probe,
  locations,
  resolver,
  files,
  durationMs,
  sourceIndex,
) {
  const empty = {
    detected: false,
    hasTimings: false,
    version: '',
    components: [],
    commits: { count: 0, totalMs: 0, maxMs: 0 },
    slowCommits: [],
    commitSeries: [],
  };
  if (!probe || !probe.info?.react) return empty;
  const originMs = probe.since || 0;
  const components = probe.components
    .map(c => {
      let loc;
      if (locations.has(c.id)) {
        const l = locations.get(c.id);
        const script = resolver.scripts.get(String(l.scriptId));
        loc = resolver.resolve(
          String(l.scriptId),
          script?.url || '',
          l.lineNumber,
          l.columnNumber,
        );
      } else loc = { file: '', line: null, vendor: false, pkg: null };

      const unstableProps = Object.entries(c.props)
        .map(([prop, r]) => {
          const kind = r.fn >= r.obj ? 'function' : 'object';
          // Equality was only checked for the first renders; scale the ratio up to all changes.
          const count = r.sampled
            ? Math.round((r.n * Math.max(r.fn, r.obj)) / r.sampled)
            : 0;
          return { prop, count, kind, changed: r.n };
        })
        .filter(p => p.count > 0)
        .sort((a, b) => b.count - a.count);
      const changedProps = Object.entries(c.props)
        .map(([prop, r]) => ({ prop, count: r.n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      const topParent =
        Object.entries(c.parents).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      const wastedMs = c.renders ? (c.selfMs * c.wasted) / c.renders : 0;
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        file: loc.file,
        ...(loc.vendor
          ? { line: loc.line, lineKind: null, abs: null }
          : locate(sourceIndex, loc.file, c.name, loc.line, loc.exact)),
        vendor: loc.vendor,
        renders: c.renders,
        mounts: c.mounts,
        wasted: c.wasted,
        selfMs: round(c.selfMs),
        totalMs: round(c.totalMs),
        maxMs: round(c.maxMs),
        wastedMs: round(wastedMs),
        reasons: c.reasons,
        unstableProps,
        changedProps,
        topParent,
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs || b.renders - a.renders);

  for (const c of components) {
    if (!c.file) continue;
    const entry = fileEntry(files, {
      file: c.file,
      vendor: c.vendor,
      pkg: packageOf(c.file),
    });
    entry.reactMs += c.selfMs;
    entry.renders += c.renders;
    entry.wasted += c.wasted;
    entry.components.push({
      name: c.name,
      renders: c.renders,
      wasted: c.wasted,
      selfMs: c.selfMs,
      line: c.line,
    });
  }
  const commits = probe.commits;
  const sorted = [...commits].sort((a, b) => b.dur - a.dur);
  return {
    detected: true,
    hasTimings: probe.info.timings,
    version: probe.info.version,
    components: components.slice(0, 600),
    commits: {
      count: probe.commitCount,
      totalMs: round(commits.reduce((s, c) => s + c.dur, 0)),
      maxMs: round(sorted[0]?.dur || 0),
    },
    slowCommits: sorted.slice(0, 10).map(c => ({
      tMs: round(c.t - originMs),
      dur: round(c.dur),
      rendered: c.rendered,
      wasted: c.wasted,
    })),
    commitSeries: commits
      .filter(c => c.dur >= 4)
      .slice(0, 1500)
      .map(c => ({
        tMs: round(c.t - originMs),
        dur: round(c.dur),
        rendered: c.rendered,
        wasted: c.wasted,
      })),
    durationMs,
  };
}
