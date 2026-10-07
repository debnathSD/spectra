import { select, zoom, zoomIdentity } from 'd3';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ROW_HEIGHT } from '../layout.js';

const CULL_MARGIN = 200;

function linkPath(link) {
  const sx = link.source.px + link.source.labelWidth - 10;
  const sy = link.source.py;
  const tx = link.target.px;
  const ty = link.target.py;
  const mid = (sx + tx) / 2;
  return `M${sx},${sy}C${mid},${sy} ${mid},${ty} ${tx},${ty}`;
}

function TreeNode({ node, isSelected, onActivate, onToggle }) {
  const view = node.view;
  const hasChildren = view.expandable;
  const heat = Math.max(0, Math.min(1, view.heat || 0));
  const cls = [
    'node',
    view.isDir ? 'dir' : 'file',
    view.vendor ? 'vendor' : '',
    isSelected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const r = view.r || 5;
  return (
    <g className={cls} transform={`translate(${node.px},${node.py})`}>
      <title>{view.tooltip || node.label}</title>
      <rect
        className="node-hit"
        x={-r}
        y={-ROW_HEIGHT / 2 + 1}
        width={node.labelWidth}
        height={ROW_HEIGHT - 2}
        rx={4}
      />
      <circle
        className="node-dot"
        r={r}
        style={{ '--heat-pct': `${Math.round(12 + heat * 88)}%` }}
        onClick={() => (hasChildren ? onToggle(node) : onActivate(node))}
      />
      {hasChildren && (
        <text className="node-glyph" y={3.5} textAnchor="middle">
          {node.children ? '−' : '+'}
        </text>
      )}
      <text
        className="node-label"
        x={r + 6}
        y={4}
        role="button"
        tabIndex={0}
        onClick={() => onActivate(node)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(node);
          }
        }}
      >
        {node.label}
      </text>
    </g>
  );
}

/** Pan/zoomable node-link tree. Wheel scrolls, ctrl/cmd + wheel zooms. */
export default function TreeView({
  layout,
  selectedKey,
  centerKey,
  centerTick,
  anchor = 0.12,
  onActivate,
  onToggle,
}) {
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const sizeRef = useRef({ width: 800, height: 600 });
  const [size, setSize] = useState(sizeRef.current);
  const [transform, setTransform] = useState(zoomIdentity);

  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoom()
      .scaleExtent([0.25, 2.5])
      .filter(e => (e.type === 'wheel' ? e.ctrlKey || e.metaKey : !e.button))
      .on('zoom', e => setTransform(e.transform));
    zoomRef.current = behavior;
    select(svg).call(behavior).on('dblclick.zoom', null);
    const onWheel = e => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      select(svg).call(behavior.translateBy, -e.deltaX, -e.deltaY);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    const observer = new ResizeObserver(([entry]) => {
      sizeRef.current = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      setSize(sizeRef.current);
    });
    observer.observe(svg);
    return () => {
      svg.removeEventListener('wheel', onWheel);
      observer.disconnect();
      select(svg).on('.zoom', null);
    };
  }, []);

  // Re-centre on an explicit request (new report, search, list click) only.
  useEffect(() => {
    const node = layout.byKey.get(centerKey) || layout.root;
    const { width, height } = sizeRef.current;
    const target = zoomIdentity.translate(
      Math.max(60, width * anchor) - node.px,
      height / 2 - node.py,
    );
    select(svgRef.current)
      .transition()
      .duration(centerTick > 0 ? 300 : 0)
      .call(zoomRef.current.transform, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerTick]);

  const visible = useMemo(() => {
    const top = (-transform.y - CULL_MARGIN) / transform.k;
    const bottom = (size.height - transform.y + CULL_MARGIN) / transform.k;
    const inView = n => n.py >= top && n.py <= bottom;
    return {
      nodes: layout.nodes.filter(inView),
      links: layout.links.filter(l => inView(l.source) || inView(l.target)),
    };
  }, [layout, transform, size.height]);

  return (
    <svg
      ref={svgRef}
      className="tree-svg"
      role="tree"
      aria-label="Performance heat tree"
    >
      <g
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
      >
        <g className="tree-links">
          {visible.links.map(l => (
            <path
              key={`${l.source.data.id}>${l.target.data.id}`}
              d={linkPath(l)}
            />
          ))}
        </g>
        <g>
          {visible.nodes.map(n => (
            <TreeNode
              key={n.data.id}
              node={n}
              isSelected={n.data.id === selectedKey}
              onActivate={onActivate}
              onToggle={onToggle}
            />
          ))}
        </g>
      </g>
    </svg>
  );
}
