// 專案資料格式（schema 1）與 React Flow 狀態互轉；計算一律交給 engine.js。
import '../engine.js';
export const Engine = globalThis.Engine;

export const KINDS = {
  source: '進料 Source', sink: '出口 Sink', mixer: '混合器 Mixer',
  splitter: '分流器 Splitter', separator: '成分分離器', collector: '捕集器',
  reactor: '反應器（產率分配）',
  multi: '多出口分離（各成分分別分配）',
};
export const PORT_LABEL = {
  in: '入', in1: '入1', in2: '入2', out: '出', out1: '出1', out2: '出2',
  product: '產品', reject: '殘渣', captured: '捕集',
};
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? 'id' + Date.now() + Math.random().toString(36).slice(2));

export function newNode(kind, position, index, components = []) {
  const params = {};
  if (kind === 'source') params.flows = {};
  if (kind === 'splitter') params.ratio = '';
  if (kind === 'multi') { params.outputs = [1, 2, 3].map(i => ({ id: 'o' + i, name: '出口 ' + 'ABC'[i - 1] })); params.fractions = {}; }
  if (kind === 'reactor') { params.outputs = [1, 2, 3].map(i => { const c = components[i % Math.max(1, components.length)]; return { id: 'o' + i, name: c?.name ?? '', comp: c?.id ?? '' }; }); params.yields = {}; }
  if (kind === 'separator' || kind === 'collector') params.fractions = {};
  return {
    id: uid(), type: 'equip', position,
    data: { kind, tag: KINDS[kind].split(' ')[0] + ' ' + index, params },
  };
}

export function toEngine({ nodes, edges, components, name }) {
  return {
    schema: 1, name, components,
    nodes: nodes.map(n => ({ id: n.id, tag: n.data.tag, type: n.data.kind, x: n.position.x, y: n.position.y, params: n.data.params })),
    edges: edges.map(e => {
      const route = { ...e.data };
      const ss = sideOf(e.sourceHandle), ts = sideOf(e.targetHandle);
      if (ss) route.sSide = ss; if (ts) route.tSide = ts;
      return { id: e.id, from: e.source, fromPort: portOf(e.sourceHandle), to: e.target, toPort: portOf(e.targetHandle), ...(Object.keys(route).length ? { route } : {}) };
    }),
  };
}

/** 端點 id：左右為埠名本身；上／下邊中心接點加 @t／@b。 */
export const portOf = h => (typeof h === 'string' ? h.split('@')[0] : h);
const sideOf = h => (typeof h === 'string' && h.includes('@') ? h.split('@')[1] : undefined);

function cleanRoute(r) {
  const out = {};
  if (r && typeof r === 'object') {
    for (const k of ['cx', 't', 'cy', 'dx', 'dy']) if (Number.isFinite(r[k])) out[k] = r[k];
    if (typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color)) out.color = r.color;
    for (const k of ['sSide', 'tSide']) if (r[k] === 't' || r[k] === 'b') out[k] = r[k];
  }
  return out;
}

export function fromEngine(p) {
  return {
    name: p.name || '未命名專案', components: p.components,
    nodes: p.nodes.map(n => ({ id: n.id, type: 'equip', position: { x: n.x, y: n.y }, data: { kind: n.type, tag: n.tag, params: n.params } })),
    edges: p.edges.map(e => {
      const { sSide, tSide, ...data } = cleanRoute(e.route);
      return {
        id: e.id, source: e.from, sourceHandle: e.fromPort + (sSide ? '@' + sSide : ''), target: e.to, targetHandle: e.toPort + (tSide ? '@' + tSide : ''),
        type: 'flow', data, ...(data.color ? { markerEnd: { type: 'arrowclosed', color: data.color } } : {}),
      };
    }),
  };
}

export function validateImport(x) {
  const bad = m => { throw Error(m); };
  if (!x || x.schema !== 1 || !Array.isArray(x.nodes) || !Array.isArray(x.edges) || !Array.isArray(x.components)) bad('檔案格式不符');
  if (x.nodes.length > 200 || x.edges.length > 400 || x.components.length > 100) bad('超過大小限制');
  const ids = new Set();
  for (const n of x.nodes) {
    if (!Engine.MODELS[n.type] || typeof n.id !== 'string' || typeof n.tag !== 'string' || !Number.isFinite(n.x) || !Number.isFinite(n.y) || !n.params || typeof n.params !== 'object') bad('設備資料不合法');
    if (ids.has(n.id)) bad('設備 ID 重複');
    ids.add(n.id);
    if (n.type === 'source' && (typeof n.params.flows !== 'object' || !n.params.flows)) bad('進料參數不合法');
    if ((n.type === 'separator' || n.type === 'collector') && (typeof n.params.fractions !== 'object' || !n.params.fractions)) bad('分配比例參數不合法');
    if (n.type === 'reactor') {
      const o = n.params.outputs;
      if (!Array.isArray(o) || o.length < 1 || o.length > 20 || o.some(x => !x || typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.comp !== 'string' || x.name.length > 100) || new Set(o.map(x => x.id)).size !== o.length || typeof n.params.yields !== 'object' || !n.params.yields) bad('反應器參數不合法');
    }
    if (n.type === 'multi') {
      const o = n.params.outputs;
      if (!Array.isArray(o) || o.length < 1 || o.length > 20 || o.some(x => !x || typeof x.id !== 'string' || typeof x.name !== 'string' || x.name.length > 100) || new Set(o.map(x => x.id)).size !== o.length || typeof n.params.fractions !== 'object' || !n.params.fractions) bad('多出口分配器參數不合法');
    }
  }
  const byId = Object.fromEntries(x.nodes.map(n => [n.id, n]));
  const eids = new Set();
  for (const e of x.edges) {
    const a = byId[e.from], b = byId[e.to];
    if (typeof e.id !== 'string' || eids.has(e.id) || !a || !b || !Engine.ports(a).out.includes(e.fromPort) || !Engine.ports(b).in.includes(e.toPort)) bad('流股連線不合法');
    eids.add(e.id);
  }
  const cids = new Set();
  for (const c of x.components) { if (!c.id || typeof c.name !== 'string' || cids.has(c.id)) bad('成分資料不合法'); cids.add(c.id); }
  return x;
}

export function sample() {
  const [a, b, c, d] = [uid(), uid(), uid(), uid()];
  return {
    schema: 1, name: '炭黑分離範例',
    components: [{ id: 'carbon', name: '炭黑' }, { id: 'water', name: '水' }],
    nodes: [
      { id: a, tag: '進料', type: 'source', x: 20, y: 120, params: { flows: { carbon: 9000, water: 1000 } } },
      { id: b, tag: '分離器', type: 'separator', x: 330, y: 100, params: { fractions: { carbon: 0.99, water: 0.1 } } },
      { id: c, tag: '產品', type: 'sink', x: 680, y: 30, params: {} },
      { id: d, tag: '另一出口', type: 'sink', x: 680, y: 250, params: {} },
    ],
    edges: [
      { id: 'S-1', from: a, fromPort: 'out', to: b, toPort: 'in' },
      { id: 'S-2', from: b, fromPort: 'product', to: c, toPort: 'in' },
      { id: 'S-3', from: b, fromPort: 'reject', to: d, toPort: 'in' },
    ],
  };
}

export function sampleRecycle() {
  const [s, m, sep, sp, prod, wst] = [uid(), uid(), uid(), uid(), uid(), uid()];
  return {
    schema: 1, name: '回流範例（分離後部分回流）',
    components: [{ id: 'carbon', name: '炭黑' }, { id: 'water', name: '水' }],
    nodes: [
      { id: s, tag: '進料', type: 'source', x: 20, y: 160, params: { flows: { carbon: 100, water: 50 } } },
      { id: m, tag: '混合器', type: 'mixer', x: 340, y: 150, params: {} },
      { id: sep, tag: '分離器', type: 'separator', x: 640, y: 150, params: { fractions: { carbon: 0.6, water: 0.2 } } },
      { id: sp, tag: '回流分流', type: 'splitter', x: 940, y: 40, params: { ratio: 0.5 } },
      { id: prod, tag: '產品', type: 'sink', x: 1240, y: 100, params: {} },
      { id: wst, tag: '殘渣', type: 'sink', x: 940, y: 320, params: {} },
    ],
    edges: [
      { id: 'S-1', from: s, fromPort: 'out', to: m, toPort: 'in1' },
      { id: 'S-2', from: m, fromPort: 'out', to: sep, toPort: 'in' },
      { id: 'S-3', from: sep, fromPort: 'product', to: sp, toPort: 'in' },
      { id: 'S-4', from: sep, fromPort: 'reject', to: wst, toPort: 'in' },
      { id: 'S-5', from: sp, fromPort: 'out1', to: m, toPort: 'in2' },
      { id: 'S-6', from: sp, fromPort: 'out2', to: prod, toPort: 'in' },
    ],
  };
}

/** 某成分在「其他出口」已分配的百分比合計（空白或非數字不算）。 */
export function fracSum(params, exceptPort, comp) {
  let sum = 0;
  for (const o of params.outputs) {
    if (o.id === exceptPort) continue;
    const raw = params.fractions?.[o.id]?.[comp];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}
/** 反應器：其他出口已分配的產率合計（%）。 */
export function yieldSum(params, exceptPort) {
  let sum = 0;
  for (const o of params.outputs) {
    if (o.id === exceptPort) continue;
    const raw = params.yields?.[o.id];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

export function sampleReactor() {
  const ids = Array.from({ length: 7 }, () => uid());
  const [s, r, k1, k2, k3, k4, k5] = ids;
  return {
    schema: 1, name: '廢輪胎裂解範例（產率為假設值，非實測）',
    components: [{ id: 'tire', name: '廢輪胎' }, { id: 'cb', name: '炭黑' }, { id: 'oil', name: '裂解油' }, { id: 'gas', name: '不凝氣' }, { id: 'wire', name: '鋼絲' }, { id: 'waste', name: '廢棄物' }],
    nodes: [
      { id: s, tag: '廢輪胎進料', type: 'source', x: 20, y: 160, params: { flows: { tire: 1000, cb: 0, oil: 0, gas: 0, wire: 0, waste: 0 } } },
      { id: r, tag: '裂解反應器', type: 'reactor', x: 330, y: 20, params: {
        outputs: [
          { id: 'o1', name: '炭黑', comp: 'cb' }, { id: 'o2', name: '裂解油', comp: 'oil' }, { id: 'o3', name: '不凝氣', comp: 'gas' },
          { id: 'o4', name: '鋼絲', comp: 'wire' }, { id: 'o5', name: '廢棄物', comp: 'waste' }],
        yields: { o1: 33, o2: 42, o3: 12, o4: 10, o5: 3 } } },
      { id: k1, tag: '炭黑倉', type: 'sink', x: 800, y: 0, params: {} },
      { id: k2, tag: '油槽', type: 'sink', x: 800, y: 120, params: {} },
      { id: k3, tag: '氣體處理', type: 'sink', x: 800, y: 240, params: {} },
      { id: k4, tag: '鋼絲回收', type: 'sink', x: 800, y: 360, params: {} },
      { id: k5, tag: '廢棄物', type: 'sink', x: 800, y: 480, params: {} },
    ],
    edges: [
      { id: 'S-1', from: s, fromPort: 'out', to: r, toPort: 'in' },
      { id: 'S-2', from: r, fromPort: 'o1', to: k1, toPort: 'in' },
      { id: 'S-3', from: r, fromPort: 'o2', to: k2, toPort: 'in' },
      { id: 'S-4', from: r, fromPort: 'o3', to: k3, toPort: 'in' },
      { id: 'S-5', from: r, fromPort: 'o4', to: k4, toPort: 'in' },
      { id: 'S-6', from: r, fromPort: 'o5', to: k5, toPort: 'in' },
    ],
  };
}

/** 流股代表什麼：多出口用使用者命名；分離器／分流器用端口名稱。 */
export function streamName(node, port, components = []) {
  if (!node) return '';
  if (node.data.kind === 'reactor') {
    const o = node.data.params.outputs.find(x => x.id === port);
    return components.find(c => c.id === o?.comp)?.name || o?.name || '';
  }
  if (node.data.kind === 'multi') return node.data.params.outputs.find(o => o.id === port)?.name || '';
  return ['product', 'reject', 'captured', 'out1', 'out2'].includes(port) ? PORT_LABEL[port] : '';
}

export function sampleMulti() {
  const [s, m, a, b, c] = [uid(), uid(), uid(), uid(), uid()];
  return {
    schema: 1, name: '多成品分配範例（3 個成品）',
    components: [{ id: 'carbon', name: '炭黑' }, { id: 'water', name: '水' }],
    nodes: [
      { id: s, tag: '進料', type: 'source', x: 20, y: 120, params: { flows: { carbon: 1000, water: 200 } } },
      { id: m, tag: '產品分配', type: 'multi', x: 330, y: 40, params: {
        outputs: [{ id: 'o1', name: '成品 A（高純）' }, { id: 'o2', name: '成品 B（中純）' }, { id: 'o3', name: '成品 C（低純）' }],
        fractions: { o1: { carbon: 70, water: 10 }, o2: { carbon: 20, water: 30 }, o3: { carbon: 10, water: 60 } } } },
      { id: a, tag: 'A 成品倉', type: 'sink', x: 780, y: 20, params: {} },
      { id: b, tag: 'B 成品倉', type: 'sink', x: 780, y: 150, params: {} },
      { id: c, tag: 'C 成品倉', type: 'sink', x: 780, y: 280, params: {} },
    ],
    edges: [
      { id: 'S-1', from: s, fromPort: 'out', to: m, toPort: 'in' },
      { id: 'S-2', from: m, fromPort: 'o1', to: a, toPort: 'in' },
      { id: 'S-3', from: m, fromPort: 'o2', to: b, toPort: 'in' },
      { id: 'S-4', from: m, fromPort: 'o3', to: c, toPort: 'in' },
    ],
  };
}

export const fmt = v => Number(v.toPrecision(6)).toString();
