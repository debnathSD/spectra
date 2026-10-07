import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FILE_METRICS,
  ancestorIds,
  buildFileTree,
  decorateCallNode,
  decorateFileNode,
  defaultCallExpanded,
  defaultExpanded,
  formatMetric,
} from '../heat.js';
import { fmtMs } from '../format.js';
import { layoutTree } from '../layout.js';
import TreeView from './TreeView.jsx';

function Legend({ extra }) {
  return (
    <div className="legend">
      <span className="ramp" aria-hidden="true" /> low → high heat (share of the
      total)
      <span>
        <i className="ring" /> library code (node_modules)
      </span>
      {extra}
    </div>
  );
}

/** Directory tree of profiled files, heat-coloured by the chosen metric. */
export function FileHeatTree({
  report,
  hideVendor,
  selectedPath,
  revealTick,
  onSelectFile,
}) {
  const [metricId, setMetricId] = useState('selfMs');
  const [expanded, setExpanded] = useState(null);
  const [centerTick, setCenterTick] = useState(0);
  const metric = FILE_METRICS.find(m => m.id === metricId);

  const tree = useMemo(
    () =>
      buildFileTree(report.files, metric, {
        hideVendor,
        rootName: report?.meta?.title || report?.meta?.url || 'target-frontend',
      }),
    [report, metric, hideVendor],
  );
  // A new tree (report, metric, filter) restarts from its hottest paths.
  useEffect(() => {
    setExpanded(null);
    setCenterTick(t => t + 1);
  }, [tree]);
  const expandedSet = useMemo(
    () => expanded || defaultExpanded(tree),
    [expanded, tree],
  );

  // Reveal a file chosen elsewhere (findings, React table, search).
  useEffect(() => {
    if (!selectedPath || !tree.byId.has(selectedPath)) return;
    setExpanded(
      prev =>
        new Set([
          ...(prev || defaultExpanded(tree)),
          ...ancestorIds(tree, selectedPath),
        ]),
    );
    setCenterTick(t => t + 1);
  }, [revealTick, selectedPath, tree]);

  const layout = useMemo(
    () =>
      layoutTree(
        tree.root,
        n => (n.isDir && expandedSet.has(n.id) ? n.children : null),
        n => `${n.name}${n.isDir ? '/' : ''}  ${formatMetric(metric, n.value)}`,
        n => decorateFileNode(n, tree, metric),
      ),
    [tree, expandedSet, metric],
  );
  const toggle = useCallback(
    node => {
      setExpanded(prev => {
        const next = new Set(prev || expandedSet);
        if (next.has(node.data.id)) next.delete(node.data.id);
        else next.add(node.data.id);
        return next;
      });
    },
    [expandedSet],
  );

  const activate = useCallback(
    node => {
      if (node.data.isDir) toggle(node);
      else onSelectFile(node.data.id);
    },
    [toggle, onSelectFile],
  );

  return (
    <div className="tree-pane">
      <div className="tree-toolbar">
        <label>
          Colour and size by
          <select value={metricId} onChange={e => setMetricId(e.target.value)}>
            {FILE_METRICS.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{metric.hint}</span>
        <span className="spacer" />
        <button
          type="button"
          onClick={() => setExpanded(new Set([tree.root.id]))}
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => setExpanded(new Set(tree.byId.keys()))}
        >
          Expand all
        </button>
      </div>
      {tree.total === 0 ? (
        <div className="empty">
          No files have any “{metric.label}” in this recording.
        </div>
      ) : (
        <TreeView
          layout={layout}
          selectedKey={selectedPath}
          centerKey={selectedPath}
          centerTick={centerTick}
          onActivate={activate}
          onToggle={toggle}
        />
      )}
      <Legend />
    </div>
  );
}

/** Top-down call tree: hot paths are expanded, colour = self time. */
export function CallHeatTree({ report, onSelectFile }) {
  const root = report.callTree;
  const [expanded, setExpanded] = useState(() =>
    root ? defaultCallExpanded(root) : new Set(),
  );
  const [centerTick, setCenterTick] = useState(0);
  useEffect(() => {
    setExpanded(root ? defaultCallExpanded(root) : new Set());
    setCenterTick(t => t + 1);
  }, [root]);

  const layout = useMemo(
    () =>
      root &&
      layoutTree(
        root,
        n => (expanded.has(n.id) || n === root ? n.children : null),
        n => `${n.name}  ${fmtMs(n.totalMs)} · self ${fmtMs(n.selfMs)}`,
        n => decorateCallNode(n, root.totalMs),
      ),
    [root, expanded],
  );

  // Open the view on the function with the most self time among the visible nodes.
  const hottestKey = useMemo(() => {
    if (!layout) return undefined;
    return layout.nodes.reduce(
      (best, n) => (n.data.selfMs > (best?.data.selfMs ?? -1) ? n : best),
      null,
    )?.data.id;
  }, [layout]);

  const toggle = useCallback(node => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(node.data.id)) next.delete(node.data.id);
      else next.add(node.data.id);
      return next;
    });
  }, []);
  const activate = useCallback(
    node => {
      const { file } = node.data;
      if (file && !file.startsWith('(')) onSelectFile(file);
      else if (node.view.expandable) toggle(node);
    },
    [toggle, onSelectFile],
  );

  if (!layout)
    return <div className="empty">No CPU samples were captured.</div>;
  return (
    <div className="tree-pane">
      <div className="tree-toolbar">
        <span className="muted">
          Each node is a function call path: total time, then self time. Click a
          circle to expand/collapse; click a label to open its file.
        </span>
      </div>
      <TreeView
        layout={layout}
        selectedKey={null}
        centerKey={hottestKey}
        centerTick={centerTick}
        anchor={0.55}
        onActivate={activate}
        onToggle={toggle}
      />
      <Legend extra={<span>colour = self time · size = total time</span>} />
    </div>
  );
}
