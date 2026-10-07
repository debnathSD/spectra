/**
 * Main-thread analysis of a Chrome trace: what kind of work filled each task,
 * which tasks were long, and which layout/style work was forced by script.
 * Timestamps are microseconds (trace clock) throughout.
 */

export const LONG_TASK_US = 50_000;
export const THRASH_THRESHOLD = 3;

const SCRIPTING = new Set([
  'FunctionCall',
  'EvaluateScript',
  'v8.evaluateModule',
  'v8.callFunction',
  'v8.run',
  'EventDispatch',
  'TimerFire',
  'FireAnimationFrame',
  'FireIdleCallback',
  'RunMicrotasks',
  'XHRReadyStateChange',
  'XHRLoad',
  'HandlePostMessage',
  'FireAnimationFrame',
]);
const COMPILE = new Set([
  'v8.compile',
  'V8.CompileCode',
  'CompileScript',
  'v8.produceCache',
  'v8.compileModule',
  'V8.CompileScript',
]);
const STYLE = new Set(['UpdateLayoutTree', 'RecalculateStyles']);
const LAYOUT = new Set(['Layout']);
const PAINT = new Set([
  'Paint',
  'PrePaint',
  'Layerize',
  'UpdateLayer',
  'CompositeLayers',
  'Commit',
  'HitTest',
]);
const PARSE = new Set(['ParseHTML', 'ParseAuthorStyleSheet']);

export const CATEGORIES = [
  'scripting',
  'compile',
  'style',
  'layout',
  'paint',
  'gc',
  'parse',
  'other',
];

export function categoryOf(name) {
  if (SCRIPTING.has(name)) return 'scripting';
  if (COMPILE.has(name)) return 'compile';
  if (STYLE.has(name)) return 'style';
  if (LAYOUT.has(name)) return 'layout';
  if (PAINT.has(name)) return 'paint';
  if (PARSE.has(name)) return 'parse';
  if (
    /GC|Scavenge|MajorGC|MinorGC/.test(name) &&
    !/^(?:RunTask|ThreadControllerImpl)/.test(name)
  )
    return 'gc';
  return 'other';
}

const ENTRY_EVENTS = new Set([
  'EventDispatch',
  'TimerFire',
  'FireAnimationFrame',
  'FireIdleCallback',
  'XHRReadyStateChange',
  'XHRLoad',
  'EvaluateScript',
  'v8.evaluateModule',
  'RunMicrotasks',
  'HandlePostMessage',
  'FunctionCall',
  'ParseHTML',
]);
const SCRIPT_PARENTS = new Set([...SCRIPTING]);

/** Picks the renderer main thread: the CrRendererMain with the most task time. */
export function findMainThread(events) {
  const names = new Map();
  for (const e of events) {
    if (
      e.ph === 'M' &&
      e.name === 'thread_name' &&
      e.args?.name === 'CrRendererMain'
    ) {
      names.set(`${e.pid}:${e.tid}`, { pid: e.pid, tid: e.tid });
    }
  }
  const busy = new Map();
  for (const e of events) {
    if (e.name !== 'RunTask' || e.ph !== 'X') continue;
    const k = `${e.pid}:${e.tid}`;
    if (names.has(k)) busy.set(k, (busy.get(k) || 0) + (e.dur || 0));
  }
  let best = null;
  let bestBusy = -1;
  for (const [k, v] of busy) {
    if (v > bestBusy) {
      best = names.get(k);
      bestBusy = v;
    }
  }
  return best || [...names.values()][0] || null;
}

/** Complete ('X') events of one thread, with B/E pairs folded in, sorted for nesting. */
function threadEvents(events, pid, tid) {
  const out = [];
  const open = [];
  for (const e of events) {
    if (e.pid !== pid || e.tid !== tid) continue;
    if (e.ph === 'X') out.push(e);
    else if (e.ph === 'B') open.push(e);
    else if (e.ph === 'E') {
      const b = open.pop();
      if (b) out.push({ ...b, ph: 'X', dur: e.ts - b.ts });
    }
  }
  out.sort((a, b) => a.ts - b.ts || (b.dur || 0) - (a.dur || 0));
  return out;
}

function buildTree(list) {
  const roots = [];
  const stack = [];
  for (const e of list) {
    const node = {
      e,
      start: e.ts,
      end: e.ts + (e.dur || 0),
      children: [],
      parent: null,
      self: e.dur || 0,
    };
    while (stack.length && stack[stack.length - 1].end <= node.start)
      stack.pop();
    const parent = stack[stack.length - 1] || null;
    node.parent = parent;
    if (parent) {
      parent.children.push(node);
      parent.self -= node.end - node.start;
    } else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function* descendants(node) {
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.pop();
    yield n;
    for (const c of n.children) stack.push(c);
  }
}

function frameOf(cf) {
  return {
    functionName: cf.functionName || '(anonymous)',
    url: cf.url || '',
    scriptId: cf.scriptId,
    lineNumber: cf.lineNumber,
    columnNumber: cf.columnNumber,
  };
}

function describeTrigger(node) {
  // The outermost entry point (event, timer, script…) with the longest duration.
  let best = null;
  const stack = [...node.children].reverse();
  while (stack.length) {
    const n = stack.pop();
    if (
      ENTRY_EVENTS.has(n.e.name) &&
      (!best || n.end - n.start > best.end - best.start)
    )
      best = n;
    for (let i = n.children.length - 1; i >= 0; i -= 1)
      stack.push(n.children[i]);
  }
  if (!best) return { type: 'task', detail: '' };
  const data = best.e.args?.data || {};
  switch (best.e.name) {
    case 'EventDispatch':
      return {
        type: `${data.type || 'event'} handler`,
        detail: data.type || '',
      };
    case 'TimerFire':
      return { type: 'timer', detail: `timer #${data.timerId ?? ''}` };
    case 'FireAnimationFrame':
      return { type: 'requestAnimationFrame', detail: '' };
    case 'EvaluateScript':
    case 'v8.evaluateModule':
      return { type: 'script evaluation', detail: data.url || '' };
    case 'FunctionCall':
      return {
        type: 'function call',
        detail: data.functionName
          ? `${data.functionName} (${data.url || ''}:${data.lineNumber ?? ''})`
          : data.url || '',
      };
    case 'ParseHTML':
      return { type: 'HTML parsing', detail: '' };
    default:
      return { type: best.e.name, detail: data.url || '' };
  }
}

/**
 * @param {object[]} events  raw trace events
 * @param {{pid: number, tid: number}} thread
 */
export function analyzeTrace(events, thread) {
  const list = threadEvents(events, thread.pid, thread.tid);
  const roots = buildTree(list);

  const totals = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  const counts = { layout: 0, style: 0, paint: 0, gc: 0, majorGc: 0 };
  let maxLayoutObjects = 0;
  const tasks = [];
  const forced = [];

  const visit = (node, forcedAncestor) => {
    const name = node.e.name;
    const cat = categoryOf(name);
    const isTask = name === 'RunTask';
    if (!isTask || node.children.length === 0)
      totals[isTask ? 'other' : cat] += Math.max(node.self, 0);
    if (cat === 'layout') {
      counts.layout += 1;
      maxLayoutObjects = Math.max(
        maxLayoutObjects,
        node.e.args?.beginData?.totalObjects || 0,
      );
    } else if (cat === 'style') counts.style += 1;
    else if (cat === 'paint' && name === 'Paint') counts.paint += 1;
    else if (cat === 'gc') {
      counts.gc += 1;
      if (/Major/.test(name)) counts.majorGc += 1;
    }
    let scripted = forcedAncestor;
    if (SCRIPT_PARENTS.has(name)) scripted = node;
    if ((cat === 'layout' || cat === 'style') && forcedAncestor) {
      const stack =
        node.e.args?.beginData?.stackTrace || node.e.args?.data?.stackTrace;
      forced.push({
        kind: cat,
        ts: node.start,
        durUs: node.end - node.start,
        stack: stack ? stack.map(frameOf) : null,
        scriptParent: forcedAncestor.e.name,
        dirtyObjects: node.e.args?.beginData?.dirtyObjects ?? null,
        totalObjects: node.e.args?.beginData?.totalObjects ?? null,
      });
    }
    for (const c of node.children) visit(c, scripted);
  };

  for (const r of roots) {
    if (r.e.name === 'RunTask') {
      const breakdown = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
      const before = forced.length;
      breakdown.other += Math.max(r.self, 0);
      for (const d of descendants(r))
        breakdown[categoryOf(d.e.name)] += Math.max(d.self, 0);
      visit(r, null);
      const taskForced = forced.slice(before);
      tasks.push({
        ts: r.start,
        durUs: r.end - r.start,
        breakdown,
        trigger: describeTrigger(r),
        forcedCount: taskForced.length,
        thrash:
          taskForced.filter(f => f.kind === 'layout').length >=
          THRASH_THRESHOLD,
      });
    } else {
      visit(r, null);
    }
  }

  // RunTask self time is scheduler overhead, not work: fold it into 'other'.
  const busyUs = tasks.reduce((s, t) => s + t.durUs, 0);
  const first = list.length ? list[0].ts : 0;
  const last = list.reduce((m, e) => Math.max(m, e.ts + (e.dur || 0)), 0);

  return {
    tasks,
    longTasks: tasks
      .filter(t => t.durUs >= LONG_TASK_US)
      .sort((a, b) => b.durUs - a.durUs),
    forced,
    totals,
    counts,
    maxLayoutObjects,
    busyUs,
    firstTs: first,
    lastTs: last,
  };
}
