import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position,
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, applyNodeChanges, applyEdgeChanges,
  useReactFlow, useUpdateNodeInternals, MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { autoLayout } from './layout.js';
import { Engine, KINDS, PORT_LABEL, portOf, uid, newNode, toEngine, fromEngine, validateImport, sample, sampleRecycle, sampleMulti, sampleReactor, fracSum, yieldSum, streamName, fmt } from './model.js';

const Ctx = createContext(null);
const STORE_KEY = 'mass-balance-studio-v2';
const readPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* 略 */ } };

/* ---------- 設備節點 ---------- */
/** 上／下邊中心接點：某方向只有一個端口時，才在上下邊各加一個（多端口的方向用左右側各自的點）。 */
function SideHandles({ ins, outs }) {
  const both = ins.length === 1 && outs.length === 1;
  const hs = [];
  if (ins.length === 1) for (const [s, pos] of [['t', Position.Top], ['b', Position.Bottom]])
    hs.push(<Handle key={'i' + s} id={`${ins[0]}@${s}`} type="target" position={pos} className="hx" style={{ left: both ? '35%' : '50%' }} />);
  if (outs.length === 1) for (const [s, pos] of [['t', Position.Top], ['b', Position.Bottom]])
    hs.push(<Handle key={'o' + s} id={`${outs[0]}@${s}`} type="source" position={pos} className="hx" style={{ left: both ? '65%' : '50%' }} />);
  return <>{hs}</>;
}


function Equip({ id, data, selected }) {
  const { components, setTag, setParam, snapshot, problems } = useContext(Ctx);
  const m = Engine.MODELS[data.kind];
  const bad = problems.has(id);
  const field = (label, value, onChange) => (
    <label className="pf" key={label}>
      <span>{label}</span>
      <input
        className={'nodrag' + (String(value ?? '').trim() === '' ? ' empty' : '')}
        inputMode="decimal" value={value ?? ''} placeholder="必填"
        onFocus={snapshot} onChange={e => onChange(e.target.value)}
      />
    </label>
  );
  const portStyle = (i, n) => ({ top: `${((i + 1) * 100) / (n + 1)}%` });
  return (
    <div className={`equip k-${data.kind}${selected ? ' sel' : ''}${bad ? ' bad' : ''}`}>
      <div className="head">
        <input className="tag nodrag" value={data.tag} onFocus={snapshot} onChange={e => setTag(id, e.target.value)} />
        <small>{KINDS[data.kind]}</small>
      </div>
      <div className="params">
        {data.kind === 'source' && components.map(c => field(`${c.name} kg/h`, data.params.flows?.[c.id], v => setParam(id, 'flows', c.id, v)))}
        {data.kind === 'splitter' && field('出1 分流比例 0–1', data.params.ratio, v => setParam(id, null, 'ratio', v))}
        {(data.kind === 'separator' || data.kind === 'collector') &&
          components.map(c => field(`${c.name} ${data.kind === 'collector' ? '捕集' : '產品'}比例`, data.params.fractions?.[c.id], v => setParam(id, 'fractions', c.id, v)))}
        {data.kind === 'sink' && <div className="hint">收集流入的物料</div>}
        {data.kind === 'mixer' && <div className="hint">兩股相加</div>}
      </div>
      {m.in.map((p, i) => (
        <Handle key={p} id={p} type="target" position={Position.Left} style={portStyle(i, m.in.length)}>
          <span className="plabel l">{PORT_LABEL[p]}</span>
        </Handle>
      ))}
      {m.out.map((p, i) => (
        <Handle key={p} id={p} type="source" position={Position.Right} style={portStyle(i, m.out.length)}>
          <span className="plabel r">{PORT_LABEL[p]}</span>
        </Handle>
      ))}
      <SideHandles ins={m.in} outs={m.out} />
    </div>
  );
}

/* ---------- 多出口分配器：每個出口自己命名，各成分比例合計必須 100% ---------- */
const pct = v => Number(v.toFixed(6));
function MultiEquip({ id, data, selected }) {
  const { components, setTag, snapshot, problems, addOutput, removeOutput, setOutputName, setFraction, fillLast } = useContext(Ctx);
  const upd = useUpdateNodeInternals();
  const outs = data.params.outputs;
  const key = outs.map(o => o.id).join(',') + '|' + components.length;
  useEffect(() => { upd(id); }, [key, id, upd]);
  const cols = `minmax(84px,1fr) repeat(${components.length}, 56px) 20px`;
  const sums = components.map(c => fracSum(data.params, null, c.id));
  return (
    <div className={`equip multi k-multi${selected ? ' sel' : ''}${problems.has(id) ? ' bad' : ''}`}>
      <Handle id="in" type="target" position={Position.Left} style={{ top: '50%' }}><span className="plabel l">入</span></Handle>
      <SideHandles ins={['in']} outs={[]} />
      <div className="head">
        <input className="tag nodrag" value={data.tag} onFocus={snapshot} onChange={e => setTag(id, e.target.value)} />
        <small>{KINDS.multi}</small>
      </div>
      <div className="mrow mhead" style={{ gridTemplateColumns: cols }}>
        <span>出口（成品名稱）</span>
        {components.map(c => <span className="r" key={c.id}>{c.name} %</span>)}
        <span />
      </div>
      {outs.map(o => (
        <div className="mrow" key={o.id} style={{ gridTemplateColumns: cols }}>
          <input className={'nodrag' + (o.name.trim() === '' ? ' empty' : '')} value={o.name} placeholder="成品名稱"
            onFocus={snapshot} onChange={e => setOutputName(id, o.id, e.target.value)} />
          {components.map(c => {
            const val = data.params.fractions?.[o.id]?.[c.id] ?? '';
            const rem = 100 - fracSum(data.params, o.id, c.id);
            const blank = String(val).trim() === '';
            const full = blank && rem <= 1e-9;
            return (
              <input key={c.id} inputMode="decimal" disabled={full}
                className={'nodrag' + (blank && !full ? ' empty' : '')}
                placeholder={full ? '已滿' : `≤${pct(rem)}`} title={`${c.name}：此出口最多還能分配 ${pct(rem)}%`}
                value={val} onFocus={snapshot} onChange={e => setFraction(id, o.id, c.id, e.target.value)} />
            );
          })}
          <button className="nodrag x" title="刪除此出口" disabled={outs.length <= 1} onClick={() => removeOutput(id, o.id)}>✕</button>
          <Handle id={o.id} type="source" position={Position.Right} />
        </div>
      ))}
      <div className="mrow msum" style={{ gridTemplateColumns: cols }}>
        <span>合計（須 100）</span>
        {components.map((c, i) => <span key={c.id} className={'r ' + (Math.abs(sums[i] - 100) < 1e-9 ? 'okc' : 'badc')}>{pct(sums[i])}</span>)}
        <span />
      </div>
      <div className="mrow" style={{ gridTemplateColumns: cols }}>
        <button className="nodrag mini" onClick={() => addOutput(id)}>＋ 新增出口</button>
        {components.map((c, i) => (
          <button key={c.id} className="nodrag mini" disabled={Math.abs(sums[i] - 100) < 1e-9}
            title={`把最後一個出口的「${c.name}」設為 100% 減其他出口`} onClick={() => fillLast(id, c.id)}>補滿</button>
        ))}
        <span />
      </div>
    </div>
  );
}

/* ---------- 反應器：每個出口一個「佔進料總質量」的產率 %，全部出口合計必須 100% ---------- */
function ReactorEquip({ id, data, selected }) {
  const { components, setTag, snapshot, problems, addOutput, removeOutput, setOutputName, setOutputComp, setYield, fillLastYield } = useContext(Ctx);
  const upd = useUpdateNodeInternals();
  const outs = data.params.outputs;
  const key = outs.map(o => o.id).join(',');
  useEffect(() => { upd(id); }, [key, id, upd]);
  const cols = 'minmax(120px,1fr) 64px 20px';
  const total = yieldSum(data.params, null);
  const ok = Math.abs(total - 100) < 1e-9;
  return (
    <div className={`equip multi k-reactor${selected ? ' sel' : ''}${problems.has(id) ? ' bad' : ''}`}>
      <Handle id="in" type="target" position={Position.Left} style={{ top: '50%' }}><span className="plabel l">進料</span></Handle>
      <SideHandles ins={['in']} outs={[]} />
      <div className="head">
        <input className="tag nodrag" value={data.tag} onFocus={snapshot} onChange={e => setTag(id, e.target.value)} />
        <small>{KINDS.reactor}</small>
      </div>
      <div className="hint">進料總質量 = 100%，所有出口（產品、副產品、廢棄物）合計不可超過 100%</div>
      <div className="mrow mhead" style={{ gridTemplateColumns: cols }}>
        <span>出口（產物）</span><span className="r">產率 %</span><span />
      </div>
      {outs.map(o => {
        const val = data.params.yields?.[o.id] ?? '';
        const rem = 100 - yieldSum(data.params, o.id);
        const blank = String(val).trim() === '';
        const full = blank && rem <= 1e-9;
        return (
          <div className="mrow" key={o.id} style={{ gridTemplateColumns: cols }}>
            <select className={'nodrag' + (o.comp ? '' : ' empty')} value={o.comp} onFocus={snapshot} onChange={e => setOutputComp(id, o.id, e.target.value)}>
              <option value="">選產物…</option>
              {components.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input inputMode="decimal" disabled={full} className={'nodrag' + (blank && !full ? ' empty' : '')}
              placeholder={full ? '已滿' : `≤${pct(rem)}`} title={`此出口最多還能分配 ${pct(rem)}%`}
              value={val} onFocus={snapshot} onChange={e => setYield(id, o.id, e.target.value)} />
            <button className="nodrag x" title="刪除此出口" disabled={outs.length <= 1} onClick={() => removeOutput(id, o.id)}>✕</button>
            <Handle id={o.id} type="source" position={Position.Right} />
          </div>
        );
      })}
      <div className="mrow msum" style={{ gridTemplateColumns: cols }}>
        <span>合計（須 100）</span><span /><span className={'r ' + (ok ? 'okc' : 'badc')}>{pct(total)}</span><span />
      </div>
      <div className="mrow" style={{ gridTemplateColumns: cols }}>
        <button className="nodrag mini" onClick={() => addOutput(id)}>＋ 新增出口</button>
        <span />
        <button className="nodrag mini" disabled={ok} title="把最後一個出口設為 100% 減其他出口" onClick={() => fillLastYield(id)}>補滿</button>
        <span />
      </div>
    </div>
  );
}

/* ---------- 流股連線：可拖拉走線；標籤放在線旁，不壓線 ---------- */
function roundedPath(pts, r = 10) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { d += ` L ${b.x} ${b.y}`; continue; }
    const p1 = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L ${z.x} ${z.y}`;
}
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
/** 走線：順向＝出口水平→垂直段（x 可拖）→入口；回流（目標在左邊）＝繞出去走水平段（y 可拖）。 */
function route(sx, sy, tx, ty, d, bounds, k) {
  const S = { x: sx, y: sy }, T = { x: tx, y: ty };
  if (tx - sx >= 48) {
    const cx = clamp(d?.cx ?? (sx + tx) / 2, sx + 16, tx - 16);
    const vertical = Math.abs(ty - sy) >= 40;
    const t = clamp(d?.t ?? 0.5, 0.15, 0.85);
    const ay = sy + (ty - sy) * t;
    return {
      back: false, vertical, pts: [S, { x: cx, y: sy }, { x: cx, y: ty }, T],
      handle: { x: cx, y: vertical ? ay : sy },
      label: vertical ? { x: cx + 10, y: ay, mode: 'right' } : { x: (sx + cx) / 2, y: Math.min(sy, ty) - 6, mode: 'above' },
    };
  }
  const cx1 = sx + 28, cx2 = tx - 28;
  const cy = d?.cy ?? (bounds ? bounds.minY - 36 - k * 16 : Math.max(sy, ty) + 110); // 預設繞到整張圖上方，不穿過設備
  const mid = (cx1 + cx2) / 2;
  return {
    back: true, vertical: false, pts: [S, { x: cx1, y: sy }, { x: cx1, y: cy }, { x: cx2, y: cy }, { x: cx2, y: ty }, T],
    handle: { x: mid, y: cy }, label: { x: mid, y: cy - 8, mode: 'above' },
  };
}

const DIR = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] };
const dedupe = pts => pts.filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
/** 水平／垂直線段是否穿過方塊（四周外擴 m）。 */
function segHitsBox(a, b, box, m = 6) {
  const l = box.x - m, r = box.x + box.w + m, t = box.y - m, bt = box.y + box.h + m;
  if (a.y === b.y) return a.y > t && a.y < bt && Math.max(a.x, b.x) > l && Math.min(a.x, b.x) < r;
  if (a.x === b.x) return a.x > l && a.x < r && Math.max(a.y, b.y) > t && Math.min(a.y, b.y) < bt;
  return false;
}
/** 在兩個接點的外側小段（S2、T2）之間找「不穿過來源／目標方塊、轉彎少、距離短」的直角走線。 */
function searchRoute(S2, T2, ds, dt, boxes) {
  const m = 24;
  const xs = new Set([S2.x, T2.x, (S2.x + T2.x) / 2]), ys = new Set([S2.y, T2.y, (S2.y + T2.y) / 2]);
  for (const b of boxes) { xs.add(b.x - m); xs.add(b.x + b.w + m); ys.add(b.y - m); ys.add(b.y + b.h + m); }
  const X = [...xs], Y = [...ys];
  const cands = [[], [{ x: T2.x, y: S2.y }], [{ x: S2.x, y: T2.y }]];
  for (const c of X) cands.push([{ x: c, y: S2.y }, { x: c, y: T2.y }]);
  for (const c of Y) cands.push([{ x: S2.x, y: c }, { x: T2.x, y: c }]);
  for (const x of X) for (const y of Y) {
    cands.push([{ x: S2.x, y }, { x, y }, { x, y: T2.y }]);
    cands.push([{ x, y: S2.y }, { x, y }, { x: T2.x, y }]);
  }
  const dir = (a, b) => [Math.sign(b.x - a.x), Math.sign(b.y - a.y)];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  let best = null, bestScore = Infinity;
  for (const c of cands) {
    const pts = dedupe([S2, ...c, T2]);
    let ok = true, len = 0;
    const dirs = [];
    for (let i = 1; i < pts.length && ok; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a.x !== b.x && a.y !== b.y) { ok = false; break; }
      if (boxes.some(bx => segHitsBox(a, b, bx))) { ok = false; break; }
      dirs.push(dir(a, b)); len += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    }
    if (!ok) continue;
    if (dirs.length) {
      if (dot(dirs[0], ds) < 0) continue;                       // 不可一出去就掉頭撞回來源
      if (dot(dirs[dirs.length - 1], [-dt[0], -dt[1]]) < 0) continue; // 不可從反方向進入目標
      if (dirs.some((d, i) => i && dot(d, dirs[i - 1]) < 0)) continue; // 不可原地折返
    }
    const score = len + 30 * Math.max(0, pts.length - 2);
    if (score < bestScore) { bestScore = score; best = pts; }
  }
  return best;
}
/** 從上／下邊接點進出的走線：先離開方塊一小段，再直角連線；預設會繞開來源與目標方塊。 */
function routeSides(sx, sy, tx, ty, d, sp, tp, boxes) {
  const L = 24, ds = DIR[sp], dt = DIR[tp];
  const S = { x: sx, y: sy }, T = { x: tx, y: ty };
  const S2 = { x: sx + ds[0] * L, y: sy + ds[1] * L }, T2 = { x: tx + dt[0] * L, y: ty + dt[1] * L };
  const a1 = ds[0] !== 0 ? 'x' : 'y', a2 = dt[0] !== 0 ? 'x' : 'y';
  let inner = null;
  if (a1 === 'y' && a2 === 'y' && d?.cy !== undefined) {
    // 使用者拖過水平段：照他指定的高度走
    inner = dedupe([S2, { x: S2.x, y: d.cy }, { x: T2.x, y: d.cy }, T2]);
  } else if (boxes?.length) {
    inner = searchRoute(S2, T2, ds, dt, boxes);
  }
  if (!inner) {
    let mid;
    if (a1 === 'y' && a2 === 'y') { const my = ds[1] === dt[1] ? (ds[1] < 0 ? Math.min(S2.y, T2.y) : Math.max(S2.y, T2.y)) : (S2.y + T2.y) / 2; mid = [{ x: S2.x, y: my }, { x: T2.x, y: my }]; }
    else if (a1 === 'x' && a2 === 'x') { const cx = (S2.x + T2.x) / 2; mid = [{ x: cx, y: S2.y }, { x: cx, y: T2.y }]; }
    else if (a1 === 'x') mid = [{ x: T2.x, y: S2.y }];
    else mid = [{ x: S2.x, y: T2.y }];
    inner = dedupe([S2, ...mid, T2]);
  }
  const pts = dedupe([S, ...inner, T]);
  // 標籤放在最長的一段旁邊：水平段在上方、垂直段在右側
  let best = 0, bi = 1;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > best) { best = l; bi = i; } }
  const a = pts[bi - 1] ?? pts[0], b = pts[bi] ?? pts[0];
  const horiz = Math.abs(b.y - a.y) < Math.abs(b.x - a.x), mx = (a.x + b.x) / 2, my2 = (a.y + b.y) / 2;
  // 只有垂直對垂直的組合可以拖水平段調高度
  const kind = a1 === 'y' && a2 === 'y' && horiz ? 'y' : 'none';
  return { back: false, vertical: false, kind, pts, handle: kind === 'y' ? { x: mx, y: my2 } : null, label: horiz ? { x: mx, y: my2 - 6, mode: 'above' } : { x: mx + 10, y: my2, mode: 'right' } };
}

const EDGE_COLORS = ['#587c82', '#c0392b', '#2a6fdb', '#2a9d4a', '#e59422', '#8a63c7', '#222222', '#9aa5a8'];
function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }) {
  const { values, components, streamNames, setEdgeData, setEdgeColor, snapshot, bounds } = useContext(Ctx);
  const { screenToFlowPosition, getInternalNode } = useReactFlow();
  const boxOf = nid => { const n = getInternalNode(nid); return n?.measured?.width ? { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width, h: n.measured.height } : null; };
  const drag = useRef(null);
  const r = (sourcePosition === 'right' && targetPosition === 'left') ? route(sourceX, sourceY, targetX, targetY, data, bounds, (parseInt(id.replace(/\D/g, ''), 10) || 0) % 4) : routeSides(sourceX, sourceY, targetX, targetY, data, sourcePosition, targetPosition, [source, target].map(boxOf).filter(Boolean));
  const v = values?.[id];
  const total = v ? components.reduce((s, c) => s + (v[c.id] ?? 0), 0) : null;
  const tip = v ? components.map(c => `${c.name}：${fmt(v[c.id])} kg/h（${total === 0 ? '—' : fmt((v[c.id] / total) * 100) + '%'}）`).join('\n') : '';
  const color = data?.color;
  const dx = data?.dx ?? 0, dy = data?.dy ?? 0;
  const lx = r.label.x + dx, ly = r.label.y + dy;
  /* 拖圓點：改走線 */
  const down = e => { e.stopPropagation(); snapshot(); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (r.back || r.kind === 'y') setEdgeData(id, { cy: Math.round(p.y) });
    else setEdgeData(id, { cx: Math.round(clamp(p.x, sourceX + 16, targetX - 16)), ...(r.vertical ? { t: clamp((p.y - sourceY) / (targetY - sourceY), 0.15, 0.85) } : {}) });
  };
  /* 拖標籤：移動標籤位置（只是顯示位置，不影響計算） */
  const lDown = e => {
    e.stopPropagation(); snapshot();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    drag.current = { x: p.x - dx, y: p.y - dy };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const lMove = e => {
    if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setEdgeData(id, { dx: Math.round(p.x - drag.current.x), dy: Math.round(p.y - drag.current.y) });
  };
  const lt = r.label.mode === 'right' ? 'translate(0,-50%)' : 'translate(-50%,-100%)';
  return (
    <>
      <BaseEdge id={id} path={roundedPath(r.pts)} markerEnd={markerEnd} interactionWidth={20}
        style={{ ...(color ? { stroke: color } : {}), ...(selected ? { strokeWidth: 3.5 } : {}) }} />
      <EdgeLabelRenderer>
        <div className={'elabel nodrag nopan' + (v ? '' : ' none')} title={(tip ? tip + '\n' : '') + '拖拉可移動標籤，雙擊還原'}
          style={{ transform: `${lt} translate(${lx}px,${ly}px)`, ...(color ? { borderColor: color } : {}) }}
          onPointerDown={lDown} onPointerMove={lMove} onPointerUp={() => { drag.current = null; }}
          onDoubleClick={() => { snapshot(); setEdgeData(id, { dx: undefined, dy: undefined }); }}>
          <b>{id}</b>{streamNames[id] && <> {streamNames[id]}</>}{v && <> · {fmt(total)} kg/h</>}
        </div>
        {r.handle && <div className={'ehandle nodrag nopan' + (selected ? ' on' : '')} title="拖拉可調整走線（雙擊還原）"
          style={{ transform: `translate(-50%,-50%) translate(${r.handle.x}px,${r.handle.y}px)`, ...(color ? { background: color } : {}) }}
          onPointerDown={down} onPointerMove={move} onDoubleClick={() => { snapshot(); setEdgeData(id, { cx: undefined, t: undefined, cy: undefined }); }} />}
        {selected && (
          <div className="ecolors nodrag nopan" style={{ transform: `translate(-50%,0) translate(${lx}px,${ly + (r.label.mode === 'right' ? 14 : 8)}px)` }}>
            {EDGE_COLORS.map(c => (
              <button key={c} className={'sw' + (color === c ? ' cur' : '')} style={{ background: c }} title={c}
                onClick={() => { snapshot(); setEdgeColor(id, c); }} />
            ))}
            <input type="color" value={color || '#587c82'} title="自訂顏色" onFocus={snapshot} onChange={e => setEdgeColor(id, e.target.value)} />
            <button className="swr" onClick={() => { snapshot(); setEdgeColor(id, undefined); }}>還原</button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { equip: props => (props.data.kind === 'multi' ? <MultiEquip {...props} /> : props.data.kind === 'reactor' ? <ReactorEquip {...props} /> : <Equip {...props} />) };
const edgeTypes = { flow: FlowEdge };

/* ---------- 主畫面 ---------- */
function loadInitial() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return fromEngine(validateImport(JSON.parse(raw)));
  } catch { /* 沒有或損毀的存檔就用範例 */ }
  return fromEngine(sample());
}

function Studio() {
  const init = useMemo(loadInitial, []);
  const [nodes, setNodes] = useState(init.nodes);
  const [edges, setEdges] = useState(init.edges);
  const [components, setComponents] = useState(init.components);
  const [name, setName] = useState(init.name);
  const [notice, setNotice] = useState('');
  const [leftOpen, setLeftOpen] = useState(() => readPref('mbs-left', true));
  const [rightOpen, setRightOpen] = useState(() => readPref('mbs-right', true));
  const toggleLeft = () => setLeftOpen(v => { writePref('mbs-left', !v); return !v; });
  const toggleRight = () => setRightOpen(v => { writePref('mbs-right', !v); return !v; });
  const rf = useReactFlow();
  const fileRef = useRef(null);
  const wrapRef = useRef(null);

  const state = { nodes, edges, components, name };
  const stateRef = useRef(state); stateRef.current = state;
  const past = useRef([]), future = useRef([]);
  const apply = s => { setNodes(s.nodes); setEdges(s.edges); setComponents(s.components); setName(s.name); };

  const snapshot = useCallback(() => {
    past.current.push(structuredClone(stateRef.current));
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  }, []);
  const undo = useCallback(() => {
    const s = past.current.pop(); if (!s) return;
    future.current.push(structuredClone(stateRef.current)); apply(s);
  }, []);
  const redo = useCallback(() => {
    const s = future.current.pop(); if (!s) return;
    past.current.push(structuredClone(stateRef.current)); apply(s);
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.target.matches?.('input,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);

  /* 自動存檔（本機瀏覽器） */
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(toEngine(stateRef.current))); } catch { /* 隱私模式等 */ }
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges, components, name]);

  /* 計算：只在模型內容（不含位置）改變時重算 */
  const modelKey = JSON.stringify([nodes.map(n => [n.id, n.data]), edges.map(e => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle]), components]);
  const result = useMemo(() => Engine.solve(toEngine(stateRef.current)), [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagOf = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n.data.tag])), [nodes]);
  const messages = result.ok ? [] : result.errors.map(msg => {
    for (const [id, tag] of Object.entries(tagOf)) msg = msg.replaceAll(id, tag);
    for (const c of components) msg = msg.replaceAll(c.id, c.name);
    return msg;
  });
  const problems = useMemo(() => {
    const s = new Set();
    if (!result.ok) for (const msg of result.errors) for (const id of Object.keys(tagOf)) if (msg.includes(id)) s.add(id);
    return s;
  }, [result, tagOf]);

  /* 編輯動作 */
  const setTag = useCallback((id, tag) => setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, tag } } : n)), []);
  const setParam = useCallback((id, group, key, value) => setNodes(ns => ns.map(n => {
    if (n.id !== id) return n;
    const params = group ? { ...n.data.params, [group]: { ...n.data.params[group], [key]: value } } : { ...n.data.params, [key]: value };
    return { ...n, data: { ...n.data, params } };
  })), []);

  const patchParams = (id, fn) => setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, params: fn(n.data.params) } } : n));
  const setEdgeData = useCallback((id, patch) => setEdges(es => es.map(e => {
    if (e.id !== id) return e;
    const d = { ...e.data, ...patch };
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return { ...e, data: d };
  })), []);
  const setOutputName = useCallback((id, pid, name) => patchParams(id, p => ({ ...p, outputs: p.outputs.map(o => o.id === pid ? { ...o, name } : o) })), []);
  const addOutput = useCallback(id => {
    snapshot();
    patchParams(id, p => {
      const next = Math.max(0, ...p.outputs.map(o => Number(o.id.slice(1)) || 0)) + 1;
      const isR = p.yields !== undefined;
      const used = new Set(p.outputs.map(o => o.comp));
      const rc = isR ? (stateRef.current.components.find(c => !used.has(c.id)) ?? stateRef.current.components[0]) : null;
      return { ...p, outputs: [...p.outputs, { id: 'o' + next, name: isR ? (rc?.name ?? '') : '出口 ' + (p.outputs.length + 1), ...(isR ? { comp: rc?.id ?? '' } : {}) }] };
    });
  }, [snapshot]);
  const removeOutput = useCallback((id, pid) => {
    snapshot();
    patchParams(id, p => {
      const { [pid]: _gone, ...rest } = p.fractions || {};
      const out = { ...p, outputs: p.outputs.filter(o => o.id !== pid) };
      if (p.fractions) out.fractions = rest;
      if (p.yields) { const { [pid]: _g2, ...ry } = p.yields; out.yields = ry; }
      return out;
    });
    setEdges(es => es.filter(e => !(e.source === id && portOf(e.sourceHandle) === pid)));
  }, [snapshot]);
  /* 輸入比例時即時限制：同一成分各出口合計不可超過 100%，超過的部分直接擋掉 */
  const setFraction = useCallback((id, pid, cid, raw) => {
    if (!/^\d*\.?\d*$/.test(raw)) return;
    const node = stateRef.current.nodes.find(n => n.id === id);
    let v = raw;
    if (raw !== '' && raw !== '.') {
      const rem = Math.max(0, Number((100 - fracSum(node.data.params, pid, cid)).toFixed(6)));
      if (Number(raw) > rem + 1e-9) {
        v = String(rem);
        const cname = stateRef.current.components.find(c => c.id === cid)?.name ?? '';
        setNotice(`「${cname}」各出口合計不可超過 100%，已限制為剩餘 ${rem}%`);
      }
    }
    patchParams(id, p => {
      const fractions = { ...p.fractions, [pid]: { ...p.fractions?.[pid], [cid]: v } };
      const next = { ...p, fractions };
      // 這個成分已剛好分配滿 100%：其餘還空白的出口一定是 0，自動補 0（算式確定，不是猜）
      if (Math.abs(fracSum(next, null, cid) - 100) < 1e-9) {
        for (const o of p.outputs) if (String(fractions[o.id]?.[cid] ?? '').trim() === '') fractions[o.id] = { ...fractions[o.id], [cid]: '0' };
      }
      return next;
    });
  }, []);
  const fillLast = useCallback((id, cid) => {
    const node = stateRef.current.nodes.find(n => n.id === id);
    const last = node.data.params.outputs.at(-1);
    const rem = Number((100 - fracSum(node.data.params, last.id, cid)).toFixed(6));
    if (rem < 0) { setNotice('其他出口已超過 100%，請先調低'); return; }
    snapshot();
    patchParams(id, p => ({ ...p, fractions: { ...p.fractions, [last.id]: { ...p.fractions?.[last.id], [cid]: String(rem) } } }));
  }, [snapshot]);

  const setOutputComp = useCallback((id, pid, comp) => patchParams(id, p => ({ ...p, outputs: p.outputs.map(o => o.id === pid ? { ...o, comp, name: stateRef.current.components.find(c => c.id === comp)?.name ?? '' } : o) })), []);
  /* 反應器產率：全部出口合計不可超過 100%，輸入時即時夾住；合計剛好 100% 時其餘空白出口自動補 0 */
  const setYield = useCallback((id, pid, raw) => {
    if (!/^\d*\.?\d*$/.test(raw)) return;
    const node = stateRef.current.nodes.find(n => n.id === id);
    let v = raw;
    if (raw !== '' && raw !== '.') {
      const rem = Math.max(0, Number((100 - yieldSum(node.data.params, pid)).toFixed(6)));
      if (Number(raw) > rem + 1e-9) { v = String(rem); setNotice(`所有出口產率合計不可超過 100%，已限制為剩餘 ${rem}%`); }
    }
    patchParams(id, p => {
      const yields = { ...p.yields, [pid]: v };
      const next = { ...p, yields };
      if (Math.abs(yieldSum(next, null) - 100) < 1e-9) for (const o of p.outputs) if (String(yields[o.id] ?? '').trim() === '') yields[o.id] = '0';
      return next;
    });
  }, []);
  const fillLastYield = useCallback(id => {
    const node = stateRef.current.nodes.find(n => n.id === id);
    const last = node.data.params.outputs.at(-1);
    const rem = Number((100 - yieldSum(node.data.params, last.id)).toFixed(6));
    if (rem < 0) { setNotice('其他出口已超過 100%，請先調低'); return; }
    snapshot();
    patchParams(id, p => ({ ...p, yields: { ...p.yields, [last.id]: String(rem) } }));
  }, [snapshot]);

  const setEdgeColor = useCallback((id, color) => setEdges(es => es.map(e => {
    if (e.id !== id) return e;
    const d = { ...e.data };
    if (color) d.color = color; else delete d.color;
    return { ...e, data: d, markerEnd: { type: MarkerType.ArrowClosed, ...(color ? { color } : {}) } };
  })), []);

  const onNodesChange = useCallback(ch => setNodes(ns => applyNodeChanges(ch, ns)), []);
  const onEdgesChange = useCallback(ch => setEdges(es => applyEdgeChanges(ch, es)), []);
  const isValidConnection = useCallback(c => {
    if (c.source === c.target) return false;
    return !stateRef.current.edges.some(e => (e.source === c.source && portOf(e.sourceHandle) === portOf(c.sourceHandle)) || (e.target === c.target && portOf(e.targetHandle) === portOf(c.targetHandle)));
  }, []);
  const onConnect = useCallback(c => {
    if (!isValidConnection(c)) return;
    snapshot();
    setEdges(es => {
      let i = 1; while (es.some(e => e.id === 'S-' + i)) i++;
      return [...es, { id: 'S-' + i, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle, type: 'flow' }];
    });
  }, [isValidConnection, snapshot]);

  const addNode = useCallback((kind, position) => {
    snapshot();
    const n = newNode(kind, position, stateRef.current.nodes.length + 1, stateRef.current.components);
    setNodes(ns => [...ns.map(x => ({ ...x, selected: false })), { ...n, selected: true }]);
  }, [snapshot]);
  const onDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const onDrop = e => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/mbs');
    if (!KINDS[kind]) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, { x: p.x - 80, y: p.y - 30 });
  };
  const addAtCenter = kind => {
    const r = wrapRef.current.getBoundingClientRect();
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const jitter = (stateRef.current.nodes.length % 5) * 24;
    addNode(kind, { x: p.x - 80 + jitter, y: p.y - 30 + jitter });
  };

  /* 專案檔 */
  const open = (p, label) => {
    const s = fromEngine(p);
    snapshot(); apply(s); setNotice(label);
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 200 }), 60);
  };
  const download = (fileName, data, type) => {
    const u = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = u; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  const exportJson = () => download((name || 'project') + '.json', JSON.stringify(toEngine(state), null, 2), 'application/json');
  const importJson = async e => {
    try {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 1_000_000) throw Error('檔案超過 1 MB');
      open(validateImport(JSON.parse(await f.text())), '已匯入專案');
    } catch (err) { setNotice('匯入失敗：' + err.message); } finally { e.target.value = ''; }
  };
  const exportCsv = () => {
    if (!result.ok) return;
    const q = x => '"' + String(x).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"';
    const rows = [['流股', '成分', '流率 kg/h']];
    for (const e of edges) for (const c of components) rows.push([e.id, c.name, result.values[e.id][c.id]]);
    download('streams.csv', '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  };
  const newBlank = () => { if (confirm('建立空白專案會取代目前畫面（可用 Ctrl+Z 復原）。繼續？')) open({ schema: 1, name: '未命名專案', components: [], nodes: [], edges: [] }, '已建立空白專案'); };
  const loadSample = () => { if (confirm('載入範例會取代目前畫面（可用 Ctrl+Z 復原）。繼續？')) open(sample(), '已載入範例'); };

  const loadRecycle = () => { if (confirm('載入回流範例會取代目前畫面（可用 Ctrl+Z 復原）。繼續？')) open(sampleRecycle(), '已載入回流範例'); };

  const loadMulti = () => { if (confirm('載入多成品範例會取代目前畫面（可用 Ctrl+Z 復原）。繼續？')) open(sampleMulti(), '已載入多成品範例'); };

  const arrange = () => {
    if (!stateRef.current.nodes.length) return;
    snapshot();
    setNodes(autoLayout(stateRef.current.nodes.map(n => ({ ...n, measured: rf.getNode(n.id)?.measured ?? n.measured })), stateRef.current.edges));
    setEdges(es => es.map(e => ({ ...e, sourceHandle: portOf(e.sourceHandle), targetHandle: portOf(e.targetHandle), data: e.data?.color ? { color: e.data.color } : {} })));
    setNotice('已自動排版（可用 Ctrl+Z 復原）');
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 250);
  };

  const loadReactor = () => { if (confirm('載入裂解範例會取代目前畫面（可用 Ctrl+Z 復原）。繼續？')) open(sampleReactor(), '已載入裂解範例'); };

  const addComponent = () => { snapshot(); setComponents(cs => [...cs, { id: uid(), name: '新成分' }]); };
  const renameComponent = (id, v) => setComponents(cs => cs.map(c => c.id === id ? { ...c, name: v } : c));
  const removeComponent = id => { if (confirm('刪除此成分？')) { snapshot(); setComponents(cs => cs.filter(c => c.id !== id)); } };

  const streamNames = useMemo(() => Object.fromEntries(edges.map(e => [e.id, streamName(nodes.find(n => n.id === e.source), portOf(e.sourceHandle), components)])), [nodes, edges, components]);
  const bounds = useMemo(() => (nodes.length ? { minY: Math.min(...nodes.map(n => n.position.y)) } : null), [nodes]);
  const ctx = useMemo(() => ({ bounds, components, values: result.ok ? result.values : null, problems, setTag, setParam, snapshot, streamNames, setEdgeData, setEdgeColor, addOutput, removeOutput, setOutputName, setFraction, fillLast, setOutputComp, setYield, fillLastYield }),
    [bounds, components, result, problems, setTag, setParam, snapshot, streamNames, setEdgeData, setEdgeColor, addOutput, removeOutput, setOutputName, setFraction, fillLast, setOutputComp, setYield, fillLastYield]);

  return (
    <Ctx.Provider value={ctx}>
      <div className={'app' + (leftOpen ? '' : ' noleft') + (rightOpen ? '' : ' noright')}>
        <header>
          <input className="pname" value={name} onFocus={snapshot} onChange={e => setName(e.target.value)} aria-label="專案名稱" />
          <button onClick={newBlank}>空白專案</button>
          <button onClick={loadSample}>範例</button>
          <button onClick={loadRecycle}>回流範例</button>
          <button onClick={loadReactor}>裂解範例</button>
          <button onClick={loadMulti}>多出口分離範例</button>
          <button onClick={undo} title="Ctrl+Z">復原</button>
          <button onClick={redo} title="Ctrl+Shift+Z">重做</button>
          <button onClick={arrange} title="依流向由左到右重新排列，並重設走線">自動排版</button>
          <span className="sp" />
          <button onClick={exportJson}>匯出 JSON</button>
          <button onClick={() => fileRef.current.click()}>匯入 JSON</button>
          <button onClick={exportCsv} disabled={!result.ok}>匯出 CSV</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importJson} />
        </header>
        <aside className="palette">
          <h3>設備（拖到圖面）</h3>
          {Object.entries(KINDS).map(([k, label]) => (
            <div key={k} className={`pitem k-${k}`} draggable
              onDragStart={e => { e.dataTransfer.setData('application/mbs', k); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => addAtCenter(k)} title="拖到圖面，或點一下加入">
              {label}
            </div>
          ))}
          <h3>成分</h3>
          {components.map(c => (
            <div className="crow" key={c.id}>
              <input value={c.name} onFocus={snapshot} onChange={e => renameComponent(c.id, e.target.value)} />
              <button onClick={() => removeComponent(c.id)} aria-label="刪除成分">✕</button>
            </div>
          ))}
          <button onClick={addComponent}>＋ 新增成分</button>
          <p className="hint">單位固定 kg/h；穩態、無反應、無循環。欄位空白視為未填，不當作 0。線：點一下選取可換顏色；拖線上圓點調走線；拖標籤移位置（雙擊還原）。</p>
        </aside>
        <main ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            isValidConnection={isValidConnection} onNodeDragStart={snapshot}
            onBeforeDelete={async () => { snapshot(); return true; }}
            defaultEdgeOptions={{ type: 'flow', markerEnd: { type: MarkerType.ArrowClosed } }}
            connectionRadius={30} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          <button className="pane-toggle left" onClick={toggleLeft} title={leftOpen ? '收合左側（設備／成分）' : '展開左側（設備／成分）'}>{leftOpen ? '◀' : '▶ 設備'}</button>
          <button className="pane-toggle right" onClick={toggleRight} title={rightOpen ? '收合右側（結果／說明）' : '展開右側（結果／說明）'}>{rightOpen ? '▶' : '◀ 結果'}</button>
          {notice && <div className="notice" onClick={() => setNotice('')}>{notice}</div>}
        </main>
        <aside className="results">
          <h3>狀態</h3>
          {result.ok ? <div className="ok">計算正常（即時更新）{result.cyclic && <small>　含回流：以聯立方程組直接求解穩態</small>}</div>
            : <div className="err">{messages.map((m, i) => <div key={i}>{m}</div>)}</div>}
          {result.ok && (
            <>
              <h3>流股結果</h3>
              <table>
                <thead><tr><th>流股</th><th>成分</th><th>kg/h</th><th>%</th></tr></thead>
                <tbody>
                  {edges.flatMap(e => {
                    const v = result.values[e.id], total = components.reduce((s, c) => s + v[c.id], 0);
                    // 反應器後各流股只有自己的產物成分；零流量成分不列，整條都是 0 時保留第一列
                    const shown = components.filter(c => v[c.id] !== 0);
                    return (shown.length ? shown : components.slice(0, 1)).map((c, i) => (
                      <tr key={e.id + c.id} className={i === 0 ? 'first' : ''}>
                        <td>{i === 0 ? e.id + (streamNames[e.id] ? ' ' + streamNames[e.id] : '') : ''}</td><td>{c.name}</td><td>{fmt(v[c.id])}</td>
                        <td>{total === 0 ? '—' : fmt((v[c.id] / total) * 100)}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
              <h3>設備守恆殘差（應為 0）</h3>
              <table>
                <tbody>
                  {Object.entries(result.residuals).map(([id, r]) => (
                    <tr key={id}><td>{tagOf[id]}</td><td>{r.__total !== undefined ? `總質量 ${fmt(r.__total)}（反應器只守恆總質量）` : components.map(c => `${c.name} ${fmt(r[c.id])}`).join('；')}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="hint">守恆成立不代表模型符合現場；此為開發雛形，不可作正式工程決策。</p>
        </aside>
      </div>
    </Ctx.Provider>
  );
}

export default function App() {
  return <ReactFlowProvider><Studio /></ReactFlowProvider>;
}
