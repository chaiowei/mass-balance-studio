const assert=require('node:assert/strict');const {solve}=require('./engine.js');
const component=[{id:'carbon'},{id:'water'}];
const n=(id,type,params={})=>({id,type,params});const e=(id,from,fromPort,to,toPort)=>({id,from,fromPort,to,toPort});
let p={components:component,nodes:[n('feed','source',{flows:{carbon:9000,water:1000}}),n('sep','separator',{fractions:{carbon:.99,water:.1}}),n('product','sink'),n('reject','sink')],edges:[e('a','feed','out','sep','in'),e('b','sep','product','product','in'),e('c','sep','reject','reject','in')]};
let r=solve(p);assert(r.ok,JSON.stringify(r.errors));assert.deepEqual(r.values.b,{carbon:8910,water:100});assert.deepEqual(r.values.c,{carbon:90,water:900});assert.deepEqual(r.residuals.sep,{carbon:0,water:0});
for(const val of [null,'',-1,Infinity]){let x=structuredClone(p);x.nodes[0].params.flows.carbon=val;assert.equal(solve(x).ok,false)}
for(const val of [-.1,1.1,null]){let x=structuredClone(p);x.nodes[1].params.fractions.water=val;assert.equal(solve(x).ok,false)}
let x=structuredClone(p);x.edges.pop();assert.equal(solve(x).ok,false);x=structuredClone(p);x.edges.push({...x.edges[0],id:'duplicate'});assert.equal(solve(x).ok,false);x=structuredClone(p);x.edges[0].fromPort='in';assert.equal(solve(x).ok,false);
console.log('separator benchmark and invalid input checks passed');
let q={components:[{id:'dust'}],nodes:[n('s','source',{flows:{dust:10}}),n('c','collector',{fractions:{dust:.99}}),n('a','sink'),n('b','sink')],edges:[e('i','s','out','c','in'),e('captured','c','captured','a','in'),e('emitted','c','out','b','in')]};r=solve(q);assert(r.ok);assert(Math.abs(r.values.captured.dust-9.9)<1e-12);assert(Math.abs(r.values.emitted.dust-.1)<1e-12);
q={components:[{id:'oil'},{id:'water'}],nodes:[n('s','source',{flows:{oil:100,water:50}}),n('sep','separator',{fractions:{oil:.9,water:.2}}),n('a','sink'),n('b','sink')],edges:[e('i','s','out','sep','in'),e('a','sep','product','a','in'),e('b','sep','reject','b','in')]};r=solve(q);assert(r.ok);assert.deepEqual(r.values.a,{oil:90,water:10});assert.equal(r.values.a.water/(r.values.a.water+r.values.a.oil),.1);
q={components:[{id:'x'}],nodes:[n('s1','source',{flows:{x:20}}),n('s2','source',{flows:{x:10}}),n('m','mixer'),n('split','splitter',{ratio:.25}),n('a','sink'),n('b','sink')],edges:[e('s1','s1','out','m','in1'),e('s2','s2','out','m','in2'),e('mix','m','out','split','in'),e('a','split','out1','a','in'),e('b','split','out2','b','in')]};r=solve(q);assert(r.ok);assert.equal(r.values.mix.x,30);assert.equal(r.values.a.x,7.5);assert.equal(r.values.b.x,22.5);assert.equal(r.residuals.m.x,0);
q={components:[{id:'x'}],nodes:[n('m','mixer'),n('sp','splitter',{ratio:.5}),n('s','source',{flows:{x:1}}),n('out','sink')],edges:[e('feed','s','out','m','in1'),e('recycle','sp','out1','m','in2'),e('mixed','m','out','sp','in'),e('product','sp','out2','out','in')]};
// 回流：feed 1 + recycle = mixed；recycle = 0.5*mixed → mixed 2、recycle 1、product 1
r=solve(q);assert(r.ok,JSON.stringify(r.errors));assert(r.cyclic);assert(Math.abs(r.values.mixed.x-2)<1e-12);assert(Math.abs(r.values.recycle.x-1)<1e-12);assert(Math.abs(r.values.product.x-1)<1e-12);assert.equal(r.residuals.m.x,0);assert.equal(r.residuals.sp.x,0);
// 全部回流（比例 1）：無出口，應拒絕
let sealed=structuredClone(q);sealed.nodes.find(n=>n.id==='sp').params.ratio=1;assert.equal(solve(sealed).ok,false);assert(solve(sealed).errors.some(m=>m.includes('回流')));
// 缺值仍拒絕
let miss=structuredClone(q);miss.nodes.find(n=>n.id==='sp').params.ratio='';assert.equal(solve(miss).ok,false);
// 二成分回流＋分離器：分離器產品回到混合器（炭黑 0.6 回流、水 0.2 回流），驗證各成分守恆
let t={components:[{id:'a'},{id:'b'}],nodes:[n('s','source',{flows:{a:100,b:50}}),n('m','mixer'),n('sep','separator',{fractions:{a:.6,b:.2}}),n('sp','splitter',{ratio:.5}),n('out','sink'),n('out2','sink')],edges:[e('f','s','out','m','in1'),e('mx','m','out','sep','in'),e('rec','sp','out1','m','in2'),e('p','sep','product','sp','in'),e('rej','sep','reject','out','in'),e('pr','sp','out2','out2','in')]};
r=solve(t);assert(r.ok,JSON.stringify(r.errors));
// a：mx=100+0.5*0.6*mx → mx=100/0.7；b：mx=50+0.5*0.2*mx → mx=50/0.9
assert(Math.abs(r.values.mx.a-100/0.7)<1e-9);assert(Math.abs(r.values.mx.b-50/0.9)<1e-9);
for(const id of ['m','sep','sp'])for(const c of ['a','b'])assert.equal(r.residuals[id][c],0);
// 系統總守恆：進料 = 出口（rej + pr）
for(const c of ['a','b'])assert(Math.abs(r.values.rej[c]+r.values.pr[c]-t.nodes[0].params.flows[c])<1e-9);
console.log('collector, oil-water, mixer, splitter, and cycle checks passed');
let huge=structuredClone(p);huge.nodes[0].params.flows={carbon:1e308,water:1e308};assert.equal(solve(huge).ok,false);
console.log('overflow input rejected');
// 多出口分配：三個成品，各成分比例（%）逐出口填，同成分合計必須剛好 100%
const mo=(fr)=>({components:[{id:'a'},{id:'b'}],nodes:[n('s','source',{flows:{a:100,b:10}}),n('mu','multi',{outputs:[{id:'o1',name:'成品A'},{id:'o2',name:'成品B'},{id:'o3',name:'成品C'}],fractions:fr}),n('x','sink'),n('y','sink'),n('z','sink')],edges:[e('i','s','out','mu','in'),e('pa','mu','o1','x','in'),e('pb','mu','o2','y','in'),e('pc','mu','o3','z','in')]});
const good={o1:{a:50,b:100},o2:{a:30,b:0},o3:{a:20,b:0}};
r=solve(mo(good));assert(r.ok,JSON.stringify(r.errors));assert.equal(r.values.pa.a,50);assert.equal(r.values.pb.a,30);assert.equal(r.values.pc.a,20);assert.equal(r.values.pa.b,10);assert.equal(r.residuals.mu.a,0);assert.equal(r.residuals.mu.b,0);
let over=structuredClone(good);over.o3.a=25;r=solve(mo(over));assert.equal(r.ok,false);assert(r.errors.some(m=>m.includes('105%')));
let under=structuredClone(good);under.o3.a=10;r=solve(mo(under));assert.equal(r.ok,false);assert(r.errors.some(m=>m.includes('90%')));
let blank=structuredClone(good);blank.o2.a='';assert.equal(solve(mo(blank)).ok,false);
let third=structuredClone(good);third.o1.a=100/3;third.o2.a=100/3;third.o3.a=100/3;assert(solve(mo(third)).ok);
let noconn=mo(good);noconn.edges.pop();r=solve(noconn);assert.equal(r.ok,false);assert(r.errors.some(m=>m.includes('成品C')));
// 多出口含回流：成品C 回到混合器
const mr={components:[{id:'a'}],nodes:[n('s','source',{flows:{a:100}}),n('m','mixer'),n('mu','multi',{outputs:[{id:'o1',name:'成品A'},{id:'o2',name:'回流'}],fractions:{o1:{a:60},o2:{a:40}}}),n('x','sink')],edges:[e('f','s','out','m','in1'),e('mx','m','out','mu','in'),e('pa','mu','o1','x','in'),e('rc','mu','o2','m','in2')]};
r=solve(mr);assert(r.ok,JSON.stringify(r.errors));assert(Math.abs(r.values.pa.a-100)<1e-9);assert(Math.abs(r.values.rc.a-200/3)<1e-9);assert(Math.abs(r.values.mx.a-500/3)<1e-9);
console.log('multi-output allocation checks passed');
// 反應器（產率分配）：廢輪胎裂解 → 炭黑／油／氣／鋼絲／水氣，全部加起來必須剛好 100% 進料總質量
{
 const comps=['tire','cb','oil','gas','wire','steam'].map(id=>({id}));
 const outs=[{id:'o1',name:'炭黑',comp:'cb'},{id:'o2',name:'熱解油',comp:'oil'},{id:'o3',name:'不凝氣',comp:'gas'},{id:'o4',name:'鋼絲',comp:'wire'},{id:'o5',name:'水氣',comp:'steam'}];
 const mk=(y)=>({components:comps,nodes:[n('feed','source',{flows:{tire:1000,cb:0,oil:0,gas:0,wire:0,steam:0}}),n('r','reactor',{outputs:outs,yields:y}),...outs.map((o,i)=>n('k'+i,'sink'))],edges:[e('i','feed','out','r','in'),...outs.map((o,i)=>e('p'+i,'r',o.id,'k'+i,'in'))]});
 const good={o1:33,o2:42,o3:12,o4:10,o5:3};
 let rr=solve(mk(good));assert(rr.ok,JSON.stringify(rr.errors));
 assert.deepEqual(rr.values.p0,{tire:0,cb:330,oil:0,gas:0,wire:0,steam:0});assert.equal(rr.values.p1.oil,420);assert.equal(rr.values.p4.steam,30);
 assert.equal(rr.residuals.r.__total,0);
 let y=structuredClone(good);y.o5=4;rr=solve(mk(y));assert.equal(rr.ok,false);assert(rr.errors.some(m=>m.includes('101%')));
 y=structuredClone(good);y.o5=2;rr=solve(mk(y));assert.equal(rr.ok,false);assert(rr.errors.some(m=>m.includes('99%')));
 y=structuredClone(good);y.o5='';assert.equal(solve(mk(y)).ok,false);
 let nc=structuredClone(mk(good));nc.nodes[1].params.outputs[0].comp='';assert.equal(solve(nc).ok,false);
 // 進料有多個成分：先加總成總質量再分配
 let mixedFeed=mk(good);mixedFeed.nodes[0].params.flows={tire:600,cb:200,oil:0,gas:0,wire:200,steam:0};rr=solve(mixedFeed);assert(rr.ok);assert.equal(rr.values.p0.cb,330);
 // 反應器含回流：20% 產率是未反應輪胎，回到混合器再進反應器 → 總量 100/(1-0.2)=125
 const rc=[{id:'tire'},{id:'cb'}];
 const cyc={components:rc,nodes:[n('f','source',{flows:{tire:100,cb:0}}),n('m','mixer'),n('r','reactor',{outputs:[{id:'o1',name:'未反應',comp:'tire'},{id:'o2',name:'炭黑',comp:'cb'}],yields:{o1:20,o2:80}}),n('k','sink')],edges:[e('a','f','out','m','in1'),e('b','m','out','r','in'),e('c','r','o1','m','in2'),e('d','r','o2','k','in')]};
 rr=solve(cyc);assert(rr.ok,JSON.stringify(rr.errors));assert(rr.cyclic);assert(Math.abs(rr.values.b.tire-125)<1e-9);assert(Math.abs(rr.values.d.cb-100)<1e-9);assert.equal(rr.residuals.r.__total,0);
 let seal=structuredClone(cyc);seal.nodes[2].params.yields={o1:100,o2:0};assert.equal(solve(seal).ok,false);
}
console.log('reactor yield checks passed');
