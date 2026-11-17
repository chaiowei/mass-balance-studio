import dagre from '@dagrejs/dagre';
import { Engine, portOf } from './model.js';

/** 由左到右自動排版：依流向分欄，出口順序對應上下順序；回流線由 dagre 自動處理。 */
export function autoLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 160, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.measured?.width ?? 200, height: n.measured?.height ?? 110 });
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const portIndex = e => {
    const n = byId[e.source];
    const outs = n ? Engine.ports({ type: n.data.kind, params: n.data.params }).out : [];
    return Math.max(0, outs.indexOf(portOf(e.sourceHandle)));
  };
  const sorted = [...edges].sort((a, b) => (nodes.findIndex(n => n.id === a.source) - nodes.findIndex(n => n.id === b.source)) || (portIndex(a) - portIndex(b)));
  for (const e of sorted) if (byId[e.source] && byId[e.target]) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map(n => {
    const p = g.node(n.id);
    return { ...n, position: { x: Math.round(p.x - p.width / 2), y: Math.round(p.y - p.height / 2) } };
  });
}
