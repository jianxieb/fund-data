const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/return-comparison-model.js');
const M = require('../assets/model.js');
function fixture(id, currency, points, kind='etf') {
  const row={id,code:id,name:id,currency,kind,market:currency==='USD'?'us':'cn',basis:kind==='index'?'price_index':'provider_adjusted_close',first:points[0][0],asOf:points.at(-1)[0]};
  return {row,history:{...row,series:points}};
}
function run(f,options={}) { return C.compare({assets:f.map(x=>x.row),histories:Object.fromEntries(f.map(x=>[x.row.id,x.history])),years:'common',...options}); }
test('common dates align every asset while preserving own-market drawdown',()=>{
  const a=fixture('a','USD',[['2024-01-02',100],['2024-06-01',200],['2025-01-02',110]]);
  const b=fixture('b','USD',[['2024-01-02',100],['2025-01-02',120]]);
  const r=run([a,b]);assert.equal(r.start,'2024-01-02');assert.equal(r.rows[0].points.length,2);assert.equal(r.rows[0].mdd,null);assert.match(r.rows[0].riskMissing,/21日/);
  assert.ok(Math.abs(r.rows[0].total-10)<1e-10);assert.equal(r.rows[0].annual,M.annualized(r.rows[0].total,M.yearsBetween(r.start,r.end)));
});
test('same-date FX conversion never forward fills absent FX',()=>{
  const a=fixture('a','USD',[['2025-01-02',100],['2025-01-03',110],['2025-01-06',90]]);
  const b=fixture('b','CNY',[['2025-01-02',700],['2025-01-03',770],['2025-01-06',630]]);
  const r=run([a,b],{currency:'CNY',fx:{series:[['2025-01-02',7],['2025-01-06',8]]}});
  assert.deepEqual(r.dates,['2025-01-02','2025-01-06']);assert.ok(Math.abs(r.rows[0].total-100*(720/700-1))<1e-10);
  assert.equal(r.rows[0].mdd,null);assert.equal(r.rows[0].missingFx[0],'2025-01-03');assert.equal(r.rows[0].annual,null);
  assert.ok(Math.abs(r.rows[1].mdd-(630/770-1)*100)<1e-10);
});
test('a shorter listing visibly changes the shared start without fabricating prior history',()=>{
  const a=fixture('a','USD',[['2024-01-02',100],['2025-01-02',110],['2026-01-02',120]]);
  const b=fixture('b','USD',[['2025-01-02',100],['2026-01-02',130]]);
  const r=run([a,b],{years:2});assert.equal(r.start,'2025-01-02');assert.equal(r.shortened,true);assert.ok(Math.abs(r.rows[0].total-(120/110-1)*100)<1e-10);
});
test('drawdown uses own full path, including dates excluded from the intersection',()=>{
  const a=fixture('a','USD',[['2025-01-02',100],['2025-01-03',150],['2025-01-06',90]]);
  const b=fixture('b','USD',[['2025-01-02',100],['2025-01-06',110]]);
  const r=run([a,b]);assert.equal(r.rows[0].mdd,-40);assert.equal(r.rows[0].drawdowns.at(-1)[1],-40);
});
test('calendar rows compound across actual year boundaries',()=>{
  const a=fixture('a','USD',[['2024-06-03',100],['2024-12-31',120],['2025-12-31',150],['2026-01-02',135]]);
  const r=run([a]);assert.deepEqual(r.calendar.map(x=>x.year),[2024,2025,2026]);assert.deepEqual(r.calendar.map(x=>x.partial),[true,false,true]);
  assert.ok(Math.abs(r.calendar[1].returns[0]-25)<1e-10);assert.ok(Math.abs(r.rows[0].total-35)<1e-10);
});
test('identity guards, custom reversed dates and no common trading days fail explicitly',()=>{
  const a=fixture('a','USD',[['2025-01-02',100],['2025-01-03',110]]);
  assert.throws(()=>C.validate(a.row,{...a.history,currency:'CNY'}),/不一致/);
  assert.throws(()=>run([a],{years:'custom',start:'2025-02-01',end:'2025-01-01'}),/开始日期/);
  const b=fixture('b','USD',[['2025-02-02',100],['2025-02-03',110]]);assert.throws(()=>run([a,b]),/共同交易日/);
  assert.equal(C.priorYear('2024-02-29',1),'2023-02-28');
});
test('search intersects type, market, category and every search token',()=>{
  const rows=[{code:'QQQ',name:'纳斯达克100',kind:'etf',market:'us',category:'科技'},{code:'000300',name:'沪深300',kind:'index',market:'cn',category:'宽基'}];
  assert.deepEqual(C.filterAssets(rows,{query:'QQQ 纳斯达克',kind:'etf',market:'us'}),[rows[0]]);
  assert.deepEqual(C.filterAssets(rows,{query:'QQQ',market:'cn'}),[]);
});
