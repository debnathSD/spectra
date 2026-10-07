import { fmtMs, fmtNumber } from './format.js';

export const FILE_METRICS = [
  {
    id: 'selfMs',
    label: 'CPU self time',
    unit: 'ms',
    hint: 'JavaScript executed by functions in this file (excluding callees).',
  },
  {
    id: 'blockMs',
    label: 'Main-thread blocking',
    unit: 'ms',
    hint: 'Self time inside long tasks (>50 ms): what made the page unresponsive.',
  },
  {
    id: 'reactMs',
    label: 'React render time',
    unit: 'ms',
    hint: 'Time React spent rendering components defined in this file (self time).',
  },
  {
    id: 'wasted',
    label: 'Wasted re-renders',
    unit: '',
    hint: 'Renders where props, state and context were identical.',
  },
  {
    id: 'renders',
    label: 'React renders',
    unit: '',
    hint: 'How many times components in this file rendered.',
  },
  {
    id: 'forcedCount',
    label: 'Forced reflows',
    unit: '',
    hint: 'Synchronous layouts/style recalcs triggered by code in this file.',
  },
];

export const formatMetric = (metric, value) =>
  metric.unit === 'ms' ? fmtMs(value) : fmtNumber(Math.round(value));

/**
 * Directory tree of the profiled files, aggregated by `metric` and sorted
 * hottest first. Single-child directory chains are merged.
 */
export function buildFileTree(files, metric, { hideVendor }) {
  const root = {
    id: '',
    name: 'superset-frontend',
    isDir: true,
    children: [],
    parent: null,
    value: 0,
  };
  const dirs = new Map([['', root]]);
  const dirFor = dirPath => {
    let node = dirs.get(dirPath);
    if (node) return node;
    const slash = dirPath.lastIndexOf('/');
    const parent = dirFor(slash < 0 ? '' : dirPath.slice(0, slash));
    node = {
      id: dirPath,
      name: dirPath.slice(slash + 1),
      isDir: true,
      children: [],
      parent,
      value: 0,
    };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };
  for (const file of files) {
    if (hideVendor && file.vendor) continue;
    const value = file[metric.id] || 0;
    if (value <= 0) continue;
    const slash = file.path.lastIndexOf('/');
    const parent = dirFor(slash < 0 ? '' : file.path.slice(0, slash));
    parent.children.push({
      id: file.path,
      name: file.path.slice(slash + 1),
      isDir: false,
      file,
      vendor: file.vendor,
      value,
      parent,
      children: [],
    });
  }
  const finish = node => {
    if (!node.isDir) return node.value;
    node.value = node.children.reduce((sum, c) => sum + finish(c), 0);
    node.children.sort((a, b) => b.value - a.value);
    while (
      node.parent &&
      node.children.length === 1 &&
      node.children[0].isDir
    ) {
      const only = node.children[0];
      node.id = only.id;
      node.name = `${node.name}/${only.name}`;
      node.children = only.children;
      node.children.forEach(c => {
        c.parent = node;
      });
    }
    return node.value;
  };
  finish(root);
  const byId = new Map();
  const index = node => {
    byId.set(node.id, node);
    node.children.forEach(index);
  };
  index(root);
  return { root, byId, total: root.value };
}

/** Expand the root and the paths leading to the hottest leaves. */
export function defaultExpanded(tree, topLeaves = 6) {
  const leaves = [...tree.byId.values()]
    .filter(n => !n.isDir)
    .sort((a, b) => b.value - a.value)
    .slice(0, topLeaves);
  const set = new Set([tree.root.id]);
  for (const leaf of leaves)
    for (let n = leaf.parent; n; n = n.parent) set.add(n.id);
  return set;
}

export function ancestorIds(tree, path) {
  const ids = [];
  for (let n = tree.byId.get(path)?.parent; n; n = n.parent) ids.push(n.id);
  return ids;
}

/** Turn an aggregated node into the shape TreeView renders. */
export function decorateFileNode(node, tree, metric) {
  const heat = tree.total ? Math.sqrt(node.value / tree.total) : 0;
  return {
    isDir: node.isDir,
    vendor: node.vendor,
    expandable: node.isDir && node.children.length > 0,
    heat,
    r: 4 + heat * 7,
    tooltip: `${node.id || 'superset-frontend'}\n${metric.label}: ${formatMetric(metric, node.value)} (${tree.total ? Math.round((node.value / tree.total) * 100) : 0}% of total)`,
  };
}

/** Heat + label data for the top-down call tree. */
export function decorateCallNode(node, total) {
  const share = total ? node.totalMs / total : 0;
  const selfShare = total ? node.selfMs / total : 0;
  return {
    isDir: false,
    vendor: node.vendor,
    expandable: node.children.length > 0,
    heat: Math.min(1, Math.sqrt(selfShare) * 1.6),
    r: 4 + Math.sqrt(share) * 6,
    tooltip: `${node.name}\n${node.file}${node.line ? `:${node.line}` : ''}\nself ${fmtMs(node.selfMs)} · total ${fmtMs(node.totalMs)}`,
  };
}

export function defaultCallExpanded(root) {
  const set = new Set();
  const limit = root.totalMs * 0.08;
  const walk = node => {
    if (node.totalMs < limit || !node.children.length) return;
    set.add(node.id);
    node.children.forEach(walk);
  };
  walk(root);
  return set;
}
