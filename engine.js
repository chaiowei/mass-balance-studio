(function(root){
'use strict';
const MODELS={source:{in:[],out:['out']},sink:{in:['in'],out:[]},mixer:{in:['in1','in2'],out:['out']},splitter:{in:['in'],out:['out1','out2']},separator:{in:['in'],out:['product','reject']},collector:{in:['in'],out:['captured','out']},multi:{in:['in'],out:[]},reactor:{in:['in'],out:[]}};
// 多出口分配器的出口由使用者自訂（params.outputs=[{id,name}]），其他設備的端口固定。
function ports(n){const m=n&&MODELS[n.type];if(!m)return {in:[],out:[]};if(n.type==='multi'||n.type==='reactor')return {in:['in'],out:Array.isArray(n.params?.outputs)?n.params.outputs.map(o=>o.id):[]};return m}
function portName(n,port){if(n.type!=='multi'&&n.type!=='reactor')return port;const o=n.params.outputs.find(o=>o.id===port);return n.type==='reactor'?(o?.comp||o?.name||port):(o?.name||port)}
function solve(p){
 const errors=[],values={},residuals={}; const nodes=p.nodes||[],edges=p.edges||[],components=p.components||[];const ids=new Set(),cids=new Set();
 if(!components.length) errors.push('至少需要一種成分'); if(!nodes.length) errors.push('至少需要一個設備');
 for(const c of components){if(!c.id||cids.has(c.id))errors.push('成分 ID 不可空白或重複');cids.add(c.id)}
 for(const n of nodes){if(!n.id||ids.has(n.id))errors.push('設備 ID 不可空白或重複');ids.add(n.id);if(!MODELS[n.type])errors.push(`設備 ${n.id} 型別不支援`)}
 const lookup=Object.fromEntries(nodes.map(n=>[n.id,n])),occupied=new Set(),edgeIds=new Set();
 for(const e of edges){let a=lookup[e.from],b=lookup[e.to];if(!e.id||edgeIds.has(e.id))errors.push('流股 ID 不可空白或重複');edgeIds.add(e.id);if(!a||!b||!ports(a).out.includes(e.fromPort)||!ports(b).in.includes(e.toPort)){errors.push(`流股 ${e.id} 端口不合法`);continue}for(const key of [`${e.from}:out:${e.fromPort}`,`${e.to}:in:${e.toPort}`]){if(occupied.has(key))errors.push(`端口 ${key} 重複連接`);occupied.add(key)}}
 for(const n of nodes){if(!MODELS[n.type])continue;let m=ports(n);if(n.type==='multi'||n.type==='reactor'){const o=n.params?.outputs;if(!Array.isArray(o)||!o.length)errors.push(`${n.id} 至少需要一個出口`);else if(new Set(o.map(x=>x.id)).size!==o.length)errors.push(`${n.id} 出口 ID 重複`)}for(const port of m.in)if(!edges.some(e=>e.to===n.id&&e.toPort===port))errors.push(`${n.id} 缺少入口 ${port}`);for(const port of m.out)if(!edges.some(e=>e.from===n.id&&e.fromPort===port))errors.push(`${n.id} 缺少出口 ${portName(n,port)}`)}
 const indegree=Object.fromEntries(nodes.map(n=>[n.id,0]));for(const e of edges)if(lookup[e.from]&&lookup[e.to])indegree[e.to]++;let q=nodes.filter(n=>indegree[n.id]===0),order=[];while(q.length){let n=q.shift();order.push(n);for(const e of edges.filter(e=>e.from===n.id)){if(--indegree[e.to]===0)q.push(lookup[e.to])}}const cyclic=order.length!==nodes.length;
 function number(v,label,min=0,max=Infinity){if(v===null||v===undefined||(typeof v==='string' && v.trim()==='')||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max){errors.push(`${label} 必須是 ${min} 至 ${max===Infinity?'無上限':max} 的有限數值`);return null}return Number(v)}
 if(errors.length)return {ok:false,errors};
 // 多出口分配：每個出口、每個成分一個百分比；同一成分各出口合計必須剛好 100%（入=出）。
 const MF={};for(const n of nodes){if(n.type!=='multi')continue;MF[n.id]={};for(const o of n.params.outputs)MF[n.id][o.id]={};for(const c of components){let sum=0;for(const o of n.params.outputs){const v=number(n.params?.fractions?.[o.id]?.[c.id],`${n.id} ${c.id} 出口「${o.name}」比例（%）`,0,100);MF[n.id][o.id][c.id]=v===null?null:v/100;sum+=v===null?0:v/100}if(!errors.length&&Math.abs(sum-1)>1e-9)errors.push(`${n.id} ${c.id} 各出口比例合計 ${Number((sum*100).toPrecision(8))}%，必須剛好 100%`)}}
 if(errors.length)return {ok:false,errors};
 // 反應器（產率分配）：進料各成分先加總成總質量，各出口依「產率 %」分走總質量（合計必須剛好 100%），
 // 每個出口的物料全是它指定的產物成分。反應會改變成分，所以只守恆總質量。
 const RY={};for(const n of nodes){if(n.type!=='reactor')continue;RY[n.id]={};let sum=0;for(const o of n.params.outputs){if(!cids.has(o.comp)){errors.push(`${n.id} 出口「${o.name}」未指定產物成分`);continue}const v=number(n.params?.yields?.[o.id],`${n.id} 出口「${o.comp}」產率（%）`,0,100);RY[n.id][o.id]={comp:o.comp,y:v===null?null:v/100};sum+=v===null?0:v/100}if(!errors.length&&Math.abs(sum-1)>1e-9)errors.push(`${n.id} 各出口產率合計 ${Number((sum*100).toPrecision(8))}%，必須剛好 100%`)}
 if(errors.length)return {ok:false,errors};
 // 回流（循環）：各成分的穩態平衡全是線性方程式，直接解聯立方程組（不用迭代，沒有收斂問題）。
 function gauss(A,b){const n=b.length;for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;if(Math.abs(A[p][c])<1e-9)return null;[A[c],A[p]]=[A[p],A[c]];[b[c],b[p]]=[b[p],b[c]];for(let r=c+1;r<n;r++){const f=A[r][c]/A[c][c];if(f===0)continue;for(let k=c;k<n;k++)A[r][k]-=f*A[c][k];b[r]-=f*b[c]}}const x=new Array(n);for(let r=n-1;r>=0;r--){let s=b[r];for(let k=r+1;k<n;k++)s-=A[r][k]*x[k];x[r]=s/A[r][r]}return x}
 function solveCyclic(){
  const P={};for(const n of nodes){if(n.type==='source')P[n.id]=Object.fromEntries(components.map(c=>[c.id,number(n.params?.flows?.[c.id],`${n.id} ${c.id} 進料`)]));else if(n.type==='splitter')P[n.id]=number(n.params?.ratio,`${n.id} 分流比例`,0,1);else if(n.type==='multi')P[n.id]=MF[n.id];else if(n.type==='reactor')P[n.id]=RY[n.id];else if(n.type==='separator'||n.type==='collector')P[n.id]=Object.fromEntries(components.map(c=>[c.id,number(n.params?.fractions?.[c.id],`${n.id} ${c.id} 分配比例`,0,1)]))}
  if(errors.length)return {ok:false,errors};
  const idx=Object.fromEntries(edges.map((e,i)=>[e.id,i])),N=edges.length,inIdx=(n,port)=>idx[edges.find(e=>e.to===n.id&&e.toPort===port).id];
  for(const e of edges)values[e.id]={};
  // 沒有反應器時各成分互不影響，逐成分解（小矩陣）；有反應器時所有成分一起解。
  const groups=nodes.some(n=>n.type==='reactor')?[components.map(c=>c.id)]:components.map(c=>[c.id]);
  for(const g of groups){
   const K=g.length,M=N*K,u=(i,k)=>i*K+k,A=Array.from({length:M},()=>new Array(M).fill(0)),b=new Array(M).fill(0);
   edges.forEach((e,i)=>{const n=lookup[e.from];g.forEach((cid,k)=>{const r=u(i,k);A[r][r]+=1;
    if(n.type==='source')b[r]=P[n.id][cid];
    else if(n.type==='mixer'){A[r][u(inIdx(n,'in1'),k)]-=1;A[r][u(inIdx(n,'in2'),k)]-=1}
    else if(n.type==='multi')A[r][u(inIdx(n,'in'),k)]-=P[n.id][e.fromPort][cid];
    else if(n.type==='reactor'){const o=P[n.id][e.fromPort];if(o.comp===cid)for(let k2=0;k2<K;k2++)A[r][u(inIdx(n,'in'),k2)]-=o.y}
    else{const rt=n.type==='splitter'?P[n.id]:P[n.id][cid],first=n.type==='splitter'?'out1':n.type==='separator'?'product':'captured';A[r][u(inIdx(n,'in'),k)]-=(e.fromPort===first?rt:1-rt)}})});
   const scale=Math.max(1,...b.map(Math.abs)),x=gauss(A,b);
   if(!x){errors.push('回流迴路沒有出口（各回流比例合計為 100%），物料會無限累積，無法求穩態');return {ok:false,errors}}
   for(let i=0;i<N;i++)for(let k=0;k<K;k++){let v=x[u(i,k)];if(!Number.isFinite(v)||v<-1e-9*scale){errors.push(`${edges[i].id} 流量超出合理範圍（${Number.isFinite(v)?'為負值':'數值溢位'}）`);return {ok:false,errors}}values[edges[i].id][g[k]]=Math.max(0,v)}
  }
  for(const n of nodes){const m=ports(n);if(!m.in.length||!m.out.length)continue;residuals[n.id]={};const flowIn=k=>values[edges.find(e=>e.to===n.id&&e.toPort===k).id],flowOut=k=>values[edges.find(e=>e.from===n.id&&e.fromPort===k).id];
   if(n.type==='reactor'){const inp=components.reduce((s,c)=>s+flowIn('in')[c.id],0),out=m.out.reduce((s,k)=>s+components.reduce((t,c)=>t+flowOut(k)[c.id],0),0),r=inp-out;residuals[n.id].__total=Math.abs(r)<=1e-9*Math.max(1,inp)?0:r;continue}
   for(const c of components){const inp=m.in.reduce((s,k)=>s+flowIn(k)[c.id],0),out=m.out.reduce((s,k)=>s+flowOut(k)[c.id],0),r=inp-out;residuals[n.id][c.id]=Math.abs(r)<=1e-9*Math.max(1,inp)?0:r}}
  return {ok:true,values,residuals,errors:[],cyclic:true};
 }
 if(cyclic)return solveCyclic();
 for(const n of order){let m=ports(n),incoming={};for(const port of m.in){let e=edges.find(x=>x.to===n.id&&x.toPort===port);incoming[port]=values[e.id]}let outputs={};
 if(n.type==='source'){let v={};for(const c of components)v[c.id]=number(n.params?.flows?.[c.id],`${n.id} ${c.id} 進料`);outputs.out=v}
 else if(n.type==='sink'){}
 else if(n.type==='mixer'){outputs.out=Object.fromEntries(components.map(c=>[c.id,incoming.in1[c.id]+incoming.in2[c.id]]))}
 else if(n.type==='multi'){for(const port of m.out){outputs[port]={};for(const c of components)outputs[port][c.id]=incoming.in[c.id]*MF[n.id][port][c.id]}}
 else if(n.type==='reactor'){const tot=components.reduce((s,c)=>s+incoming.in[c.id],0);for(const port of m.out){const o=RY[n.id][port];outputs[port]=Object.fromEntries(components.map(c=>[c.id,c.id===o.comp?tot*o.y:0]))}}
 else if(n.type==='splitter'){let r=number(n.params?.ratio,`${n.id} 分流比例`,0,1);outputs.out1={};outputs.out2={};for(const c of components){outputs.out1[c.id]=incoming.in[c.id]*r;outputs.out2[c.id]=incoming.in[c.id]-outputs.out1[c.id]}}
 else {let first=n.type==='separator'?'product':'captured',second=n.type==='separator'?'reject':'out';outputs[first]={};outputs[second]={};for(const c of components){let r=number(n.params?.fractions?.[c.id],`${n.id} ${c.id} 分配比例`,0,1);outputs[first][c.id]=incoming.in[c.id]*r;outputs[second][c.id]=incoming.in[c.id]-outputs[first][c.id]}}
 if(errors.length)return {ok:false,errors};for(const port of m.out){let flows=outputs[port];let total=Object.values(flows).reduce((sum,v)=>sum+v,0);if(!Number.isFinite(total)||Object.values(flows).some(v=>!Number.isFinite(v)||v<0)){errors.push(`${n.tag||n.id} 的流量超出數值範圍`);return {ok:false,errors}}}for(const port of m.out){let e=edges.find(x=>x.from===n.id&&x.fromPort===port);values[e.id]=outputs[port]}
 if(n.type==='reactor'){const inT=components.reduce((s,c)=>s+incoming.in[c.id],0),outT=m.out.reduce((s,k)=>s+components.reduce((t,c)=>t+outputs[k][c.id],0),0),r=inT-outT;residuals[n.id]={__total:Math.abs(r)<=1e-9*Math.max(1,inT)?0:r}}
 else if(m.in.length&&m.out.length){residuals[n.id]={};for(const c of components){let input=m.in.reduce((s,k)=>s+incoming[k][c.id],0),output=m.out.reduce((s,k)=>s+outputs[k][c.id],0);if(!Number.isFinite(input)||!Number.isFinite(output)){errors.push(`${n.id} 數值超出範圍`);return {ok:false,errors}}{const r=input-output;residuals[n.id][c.id]=Math.abs(r)<=1e-9*Math.max(1,input)?0:r}}}
 }
 return {ok:true,values,residuals,errors:[]};
}
const api={MODELS,ports,solve};if(typeof module!=='undefined')module.exports=api;else root.Engine=api;
})(globalThis);
