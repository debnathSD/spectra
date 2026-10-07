import { hierarchy, tree } from 'd3';

export const ROW_HEIGHT = 24;
const CHAR_WIDTH = 6.7;
const LABEL_PAD = 30;
const COLUMN_GAP = 40;
const MAX_LABEL_CHARS = 64;

export function truncate(text) {
  return text.length > MAX_LABEL_CHARS
    ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…`
    : text;
}

/**
 * Left-to-right tree layout with one column per depth, each as wide as its
 * longest label so text never overlaps. `decorate(data)` supplies what the view
 * needs beyond the label: {heat, r, isDir, expandable, vendor, tooltip}.
 */
export function layoutTree(
  rootData,
  childrenOf,
  labelOf,
  decorate = () => ({}),
) {
  const root = hierarchy(rootData, childrenOf);
  tree()
    .nodeSize([ROW_HEIGHT, 1])
    .separation(() => 1)(root);
  const nodes = root.descendants();
  const columnWidth = [];
  for (const node of nodes) {
    node.label = truncate(labelOf(node.data));
    node.view = decorate(node.data);
    node.labelWidth = node.label.length * CHAR_WIDTH + LABEL_PAD;
    columnWidth[node.depth] = Math.max(
      columnWidth[node.depth] || 0,
      node.labelWidth,
    );
  }
  const columnX = [0];
  for (let d = 1; d < columnWidth.length; d += 1) {
    columnX[d] = columnX[d - 1] + columnWidth[d - 1] + COLUMN_GAP;
  }
  for (const node of nodes) {
    node.px = columnX[node.depth];
    node.py = node.x;
  }
  return {
    root,
    nodes,
    links: root.links(),
    byKey: new Map(nodes.map(n => [n.data.id, n])),
  };
}
