const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../assets/global-finance-model.js');
const D=require('../data/global-finance.js');
const S=require('../data/global-finance-scenarios.js');
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

test('fixed coupon bonds price at par when coupon and yield agree for all displayed maturities',()=>{
  for(const years of [2,10,30]) close(M.bondPrice({coupon:4,yieldRate:4,years}),100);
});
test('zero yield and zero coupon cases retain all contractual cash flows',()=>{
  close(M.bondPrice({coupon:4,yieldRate:0,years:10}),140);
  close(M.bondPrice({coupon:0,yieldRate:10,years:1,frequency:1}),100/1.1);
});
test('rate shock has correct direction and greater price effect on longer cash flows',()=>{
  const price2=M.bondPrice({yieldRate:5,years:2}),price10=M.bondPrice({yieldRate:5,years:10}),price30=M.bondPrice({yieldRate:5,years:30});
  assert.ok(100>price2&&price2>price10&&price10>price30);
  close(price10,92.20541885717668,1e-6);
  assert.ok(M.bondPrice({yieldRate:3,years:30})>M.bondPrice({yieldRate:3,years:2}));
});
test('bond model rejects invalid cash flow schedules instead of returning an invented price',()=>{
  for(const args of [{years:0},{years:1.1},{yieldRate:NaN},{yieldRate:-200},{coupon:-1},{frequency:0},{face:-100}]) assert.equal(M.bondPrice(args),null);
});
test('purchasing power is compounded and separates nominal from real money',()=>{
  close(M.purchasingPower({amount:100000,inflation:0,years:30}),100000);
  close(M.purchasingPower({amount:100000,inflation:10,years:1}),100000/1.1);
  close(M.purchasingPower({amount:100000,inflation:3,years:10}),74409.39148967251,1e-6);
  assert.equal(M.purchasingPower({inflation:-100}),null);
});
test('foreign asset return compounds the same-direction exchange quote',()=>{
  close(M.fxReturn(10,-8),1.2);
  close(M.fxReturn(-20,10),-12);
  close(M.fxReturn(-100,20),-100);
  assert.equal(M.fxReturn(10,-100),null);
  assert.equal(M.fxReturn(NaN,10),null);
});
test('mortgage payments amortize principal and use the interest-free limit',()=>{
  const zero=M.mortgage({principal:1000000,rate:0,years:30});
  close(zero.monthly,1000000/360);close(zero.interest,0);
  const m=M.mortgage({principal:1000000,rate:5,years:30});
  close(m.monthly,5368.216230121398,1e-6);
  let outstanding=1000000;
  for(let i=0;i<360;i++)outstanding=outstanding*(1+5/1200)-m.monthly;
  close(outstanding,0,1e-5);
  assert.equal(M.mortgage({rate:-1}),null);
});
test('all interactive slider endpoints calculate finite values',()=>{
  for(const yieldRate of [0,10])for(const years of [2,10,30])assert.ok(Number.isFinite(M.bondPrice({yieldRate,years})));
  for(const inflation of [0,10])for(const years of [1,30])assert.ok(Number.isFinite(M.purchasingPower({inflation,years})));
  for(const asset of [-40,40])for(const fx of [-20,20])assert.ok(Number.isFinite(M.fxReturn(asset,fx)));
  for(const rate of [0,8])for(const years of [5,40])assert.ok(Number.isFinite(M.mortgage({rate,years}).monthly));
});
test('policy review freshness uses the review date and never silently refreshes the observation',()=>{
  assert.equal(M.freshness('2026-10-15','2026-10-29').stale,false);
  assert.equal(M.freshness('2026-10-15','2026-10-30').stale,true);
  assert.equal(M.freshness('2026-10-15','2026-10-14').future,true);
  assert.equal(M.freshness('invalid','2026-10-15').stale,true);
});
test('knowledge search combines category, Chinese terms, Latin abbreviations and full width text',()=>{
  assert.ok(M.searchTopics(D.topics,'ＰＥ').some(t=>t.id==='valuation'));
  assert.ok(M.searchTopics(D.topics,'CNY').some(t=>t.id==='cny'));
  assert.ok(M.searchTopics(D.topics,'黄金','real').some(t=>t.id==='gold'));
  assert.equal(M.searchTopics(D.topics,'黄金','bonds').length,0);
  assert.equal(M.searchTopics(D.topics,'不存在的检索词987').length,0);
});
test('every topic has a real definition, example, limits, observations and resolvable connections',()=>{
  const ids=new Set(D.topics.map(t=>t.id));assert.equal(ids.size,D.topics.length);
  for(const c of D.categories)assert.ok(D.topics.some(t=>t.category===c.id));
  for(const t of D.topics){
    assert.ok(D.categories.some(c=>c.id===t.category));
    for(const field of ['name','en','definition','example','pitfall'])assert.ok(typeof t[field]==='string'&&t[field].length>0,`${t.id}.${field}`);
    assert.equal(t.chain.length,3);assert.ok(t.watch.length>0);assert.ok(t.refs.length>0);
    for(const id of t.related)assert.ok(ids.has(id),`${t.id} links to missing ${id}`);
    for(const id of t.refs)assert.ok(D.sources[id],`${t.id} cites missing ${id}`);
  }
});
test('scenarios maintain conditional impact explanations and all diagram nodes open knowledge',()=>{
  assert.equal(new Set(S.map(s=>s.id)).size,S.length);
  for(const s of S){
    assert.ok(s.premise.length>0&&s.timing.length>0);assert.equal(s.steps.length,4);
    for(const n of [...s.steps,...s.branches.flatMap(b=>b.nodes)])assert.ok(D.topics.some(t=>t.id===n.topic),`${s.id} has unresolved ${n.topic}`);
    for(const impact of s.impacts){assert.ok(['up','down','mixed'].includes(impact.direction));assert.ok(impact.reason&&impact.condition);}
    for(const id of s.refs)assert.ok(D.sources[id]);
  }
});
test('policy snapshot distinguishes instrument, observation date and source with no future observations',()=>{
  for(const p of D.policies){assert.ok(p.label&&p.date&&p.value);assert.ok(p.date<=D.checkedAt);for(const id of p.refs)assert.ok(D.sources[id]);}
  assert.equal(D.policies.find(p=>p.id==='cn').label,'政策立场');
  assert.notEqual(D.policies.find(p=>p.id==='hk').label,D.policies.find(p=>p.id==='us').label);
  for(const [id,source] of Object.entries(D.sources)){assert.ok(source[0]);assert.equal(new URL(source[1]).protocol,'https:',id);if(source[2])assert.ok(source[2]<=D.checkedAt);}
});
