/**
 * Turns V8 CPU profile samples (recorded inside the trace as Profile /
 * ProfileChunk events) into file, function and call-tree attribution.
 */
import { isNativeFrame } from './sources.js';

/**
 * Re-assembles the CPU profile of the main thread from trace events.
 *
 * A `Profile` event (emitted on the sampled thread) announces a profile; its
 * `ProfileChunk` events carry the samples but come from V8's profiler helper
 * thread, so they are paired by (pid, id) - not by thread. Ids restart for each
 * profiler instance (Chrome's own WebUI in the same process has a "0x1" too), so
 * a chunk whose node ids collide with the profile being built starts a new one.
 *
 * @returns {{nodes: object[], samples: number[], timeDeltas: number[], startTime: number} | null}
 */
export function extractCpuProfile(events, pid, tid) {
  const headers = events
    .filter(e => e.name === 'Profile')
    .sort((a, b) => a.ts - b.ts);
  const chunksByGroup = new Map();
  for (const e of events) {
    if (e.name !== 'ProfileChunk') continue;
    const key = `${e.pid}:${e.id || e.id2?.local || '0x0'}`;
    if (!chunksByGroup.has(key)) chunksByGroup.set(key, []);
    chunksByGroup.get(key).push(e);
  }

  const profiles = [];
  for (const [key, chunks] of chunksByGroup) {
    chunks.sort((a, b) => a.ts - b.ts);
    const groupPid = chunks[0].pid;
    const groupHeaders = headers.filter(
      h => `${h.pid}:${h.id || h.id2?.local || '0x0'}` === key,
    );
    let current = null;
    let seen = null;
    for (const chunk of chunks) {
      const data = chunk.args?.data || {};
      const cp = data.cpuProfile || {};
      const nodes = cp.nodes || [];
      if (!current || nodes.some(n => seen.has(n.id))) {
        const header =
          groupHeaders[profiles.filter(p => p.group === key).length];
        current = {
          group: key,
          pid: groupPid,
          tid: header?.tid ?? chunk.tid,
          startTime: header?.args?.data?.startTime || header?.ts || chunk.ts,
          nodes: [],
          samples: [],
          timeDeltas: [],
        };
        seen = new Set();
        profiles.push(current);
      }
      for (const n of nodes) {
        current.nodes.push(n);
        seen.add(n.id);
      }
      for (const sample of cp.samples || []) current.samples.push(sample);
      for (const d of data.timeDeltas || []) current.timeDeltas.push(d);
    }
  }

  const candidates = profiles.filter(p => p.samples.length);
  return (
    candidates.find(p => p.pid === pid && p.tid === tid) ||
    candidates
      .filter(p => p.pid === pid)
      .sort((a, b) => b.samples.length - a.samples.length)[0] ||
    candidates.sort((a, b) => b.samples.length - a.samples.length)[0] ||
    null
  );
}

const IDLE = '(idle)';

/**
 * @param {{nodes: object[], samples: number[], timeDeltas: number[], startTime: number}} profile
 * @param {(callFrame: object) => {file: string, vendor: boolean, pkg: string|null, line: number|null, name: string|null, exact: boolean}} resolveFrame
 */
export function analyzeCpuProfile(profile, resolveFrame) {
  const byId = new Map();
  for (const n of profile.nodes) {
    byId.set(n.id, {
      id: n.id,
      frame: n.callFrame,
      children: [],
      parent: n.parent ?? null,
      self: 0,
      total: 0,
    });
  }
  for (const n of byId.values()) {
    if (n.parent !== null) byId.get(n.parent)?.children.push(n);
  }
  // Older profiles list children instead of parents.
  for (const raw of profile.nodes) {
    if (raw.children && !raw.parent) {
      const node = byId.get(raw.id);
      for (const c of raw.children) {
        const child = byId.get(c);
        if (child && child.parent === null) {
          child.parent = node.id;
          node.children.push(child);
        }
      }
    }
  }
  const roots = [...byId.values()].filter(n => n.parent === null);

  // Sample timestamps (µs) and the time each sample represents.
  const count = profile.samples.length;
  const sampleTs = new Float64Array(count);
  const sampleDur = new Float64Array(count);
  let t = profile.startTime;
  for (let i = 0; i < count; i += 1) {
    t += profile.timeDeltas[i] || 0;
    sampleTs[i] = t;
  }
  for (let i = 0; i < count; i += 1) {
    sampleDur[i] =
      i + 1 < count ? sampleTs[i + 1] - sampleTs[i] : sampleDur[i - 1] || 1000;
  }
  const sampleNodes = profile.samples.map(id => byId.get(id));
  sampleNodes.forEach((node, i) => {
    if (node) node.self += sampleDur[i];
  });

  // Resolve every frame once.
  for (const node of byId.values()) {
    const f = node.frame;
    node.native = isNativeFrame(f.functionName);
    node.idle = f.functionName === IDLE;
    node.loc = node.native
      ? {
          file: f.functionName,
          vendor: false,
          pkg: null,
          line: null,
          name: null,
          exact: false,
        }
      : resolveFrame(f);
    node.name = node.loc.name || f.functionName || '(anonymous)';
    node.key = `${node.loc.file}|${node.name}|${node.loc.line ?? f.lineNumber}`;
    // Builtins without a script (Array.sort, performance.now…) are blamed on their caller.
    node.builtin = !node.native && !f.url;
  }

  // Post-order totals, iteratively (call trees can be thousands deep).
  const order = [];
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    order.push(n);
    for (const c of n.children) stack.push(c);
  }
  for (const n of order) {
    const parent = n.parent === null ? null : byId.get(n.parent);
    n.rep = n.builtin && parent ? parent.rep : n;
    if (n.rep !== n) {
      n.rep.self += n.self;
      n.self = 0;
    }
    // Anonymous callbacks are named after the function they sit in, so a culprit
    // reads "(anonymous in renderRows)" instead of an unlocatable "(anonymous)".
    const named = !n.native && !n.builtin && n.name !== '(anonymous)';
    n.enclosing = named ? n.name : (parent?.enclosing ?? null);
    if (
      n.name === '(anonymous)' &&
      !n.native &&
      !n.builtin &&
      parent?.enclosing
    ) {
      n.name = `(anonymous in ${parent.enclosing})`;
      n.key = `${n.loc.file}|${n.name}|${n.loc.line ?? n.frame.lineNumber}`;
    }
  }
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    n.total = n.self + n.children.reduce((sum, c) => sum + c.total, 0);
  }

  // Which application function drives each library's time (nearest non-library caller).
  const vendorDrivers = new Map();
  for (const n of order) {
    if (!n.loc.vendor || n.self <= 0) continue;
    let caller = n.parent === null ? null : byId.get(n.parent);
    while (caller && (caller.native || caller.builtin || caller.loc.vendor)) {
      caller = caller.parent === null ? null : byId.get(caller.parent);
    }
    if (!caller) continue;
    const drivers = vendorDrivers.get(n.loc.pkg) || new Map();
    const key = caller.key;
    const entry = drivers.get(key) || {
      file: caller.loc.file,
      name: caller.name,
      line: caller.loc.line,
      exact: caller.loc.exact,
      us: 0,
    };
    entry.us += n.self;
    drivers.set(key, entry);
    vendorDrivers.set(n.loc.pkg, drivers);
  }

  // Function / file aggregation with recursion-safe inclusive time.
  const functions = new Map();
  const files = new Map();
  const fnOnStack = new Map();
  const fileOnStack = new Map();
  const walk = [];
  roots.forEach(r => walk.push({ node: r, phase: 0 }));
  while (walk.length) {
    const { node, phase } = walk.pop();
    const fnKey = node.key;
    const fileKey = node.loc.file;
    if (phase === 1) {
      fnOnStack.set(fnKey, fnOnStack.get(fnKey) - 1);
      fileOnStack.set(fileKey, fileOnStack.get(fileKey) - 1);
      continue;
    }
    if (!node.idle) {
      let fn = functions.get(fnKey);
      if (!fn) {
        fn = {
          key: fnKey,
          name: node.name,
          file: node.loc.file,
          line: node.loc.line,
          exact: node.loc.exact,
          bundleLine: node.frame.lineNumber,
          selfUs: 0,
          totalUs: 0,
        };
        functions.set(fnKey, fn);
      }
      fn.selfUs += node.self;
      if (!fnOnStack.get(fnKey)) fn.totalUs += node.total;

      let file = files.get(fileKey);
      if (!file) {
        file = {
          file: fileKey,
          vendor: node.loc.vendor,
          pkg: node.loc.pkg,
          selfUs: 0,
          totalUs: 0,
        };
        files.set(fileKey, file);
      }
      file.selfUs += node.self;
      if (!fileOnStack.get(fileKey)) file.totalUs += node.total;
    }
    fnOnStack.set(fnKey, (fnOnStack.get(fnKey) || 0) + 1);
    fileOnStack.set(fileKey, (fileOnStack.get(fileKey) || 0) + 1);
    walk.push({ node, phase: 1 });
    for (const c of node.children) walk.push({ node: c, phase: 0 });
  }

  let activeUs = 0;
  let idleUs = 0;
  let gcUs = 0;
  for (const n of byId.values()) {
    if (n.idle) idleUs += n.self;
    else activeUs += n.self;
    if (n.frame.functionName === '(garbage collector)') gcUs += n.self;
  }

  return {
    nodes: byId,
    roots,
    functions: [...functions.values()],
    files: [...files.values()],
    vendorDrivers,
    totals: { activeUs, idleUs, gcUs, sampleCount: count },
    sampleTs,
    sampleDur,
    sampleNodes,
    startUs: profile.startTime,
    endUs: count ? sampleTs[count - 1] : profile.startTime,
  };
}

/** Self time per node within [fromUs, toUs). */
export function windowSelf(cpu, fromUs, toUs) {
  const { sampleTs, sampleDur, sampleNodes } = cpu;
  let lo = 0;
  let hi = sampleTs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sampleTs[mid] < fromUs) lo = mid + 1;
    else hi = mid;
  }
  const out = new Map();
  for (let i = lo; i < sampleTs.length && sampleTs[i] < toUs; i += 1) {
    const node = sampleNodes[i]?.rep;
    if (!node || node.idle) continue;
    out.set(node, (out.get(node) || 0) + sampleDur[i]);
  }
  return out;
}

/** The sampled node at (or just before) a timestamp: used to blame forced layouts. */
export function nodeAt(cpu, us) {
  const { sampleTs, sampleNodes } = cpu;
  let lo = 0;
  let hi = sampleTs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sampleTs[mid] <= us) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found === -1 ? null : sampleNodes[found].rep;
}

/** Path from the root to a node (frames only, natives dropped). */
export function pathTo(node, byId) {
  const path = [];
  for (let n = node; n; n = n.parent === null ? null : byId.get(n.parent))
    path.push(n);
  return path.reverse().filter(n => !n.native);
}

/**
 * Pruned top-down call tree for the UI.
 * @param {number} minUs  drop subtrees that account for less than this
 */
export function buildCallTree(cpu, { minUs, maxDepth = 60, maxChildren = 14 }) {
  let counter = 0;
  const convert = (node, depth) => {
    const out = {
      id: `c${counter++}`,
      name: node.native ? node.frame.functionName : node.name,
      file: node.loc.file,
      vendor: node.loc.vendor,
      line: node.loc.line,
      selfMs: node.self / 1000,
      totalMs: node.total / 1000,
      children: [],
    };
    if (depth >= maxDepth) return out;
    const kids = node.children
      .filter(c => !c.idle && c.total >= minUs)
      .sort((a, b) => b.total - a.total)
      .slice(0, maxChildren);
    out.children = kids.map(c => convert(c, depth + 1));
    return out;
  };
  const top = cpu.roots.flatMap(r => (r.children.length ? [r] : []));
  const root = {
    id: 'c-root',
    name: '(all samples)',
    file: '',
    vendor: false,
    line: null,
    selfMs: 0,
    totalMs: cpu.totals.activeUs / 1000,
    children: [],
  };
  root.children = top.flatMap(r => convert(r, 0).children);
  return root;
}
