const test = require('node:test');
const assert = require('node:assert/strict');
const {study,electionDate,horizons} = require('../assets/midterm-study-model.js');

function sessions(first,last,quote=()=>100) {
  const rows=[];
  for (let t=Date.parse(first); t<=Date.parse(last); t+=86400000) {
    const day=new Date(t), weekday=day.getUTCDay();
    if (weekday===0 || weekday===6) continue;
    const d=day.toISOString().slice(0,10), p=quote(d);
    if (p!=null) rows.push([d,p]);
  }
  return rows;
}
const near=(actual,value)=>assert.ok(Math.abs(actual-value)<1e-9,actual+' is not '+value);

test('midterms use the Tuesday after the first Monday, not necessarily the first Tuesday',()=>{
  assert.deepEqual([1950,1954,1966,1974,1994,2022,2026].map(electionDate),[
    '1950-11-07','1954-11-02','1966-11-08','1974-11-05','1994-11-08','2022-11-08','2026-11-03'
  ]);
  const s=sessions('1950-10-20','1958-11-07');
  assert.deepEqual(study(s).events.map(e=>[e.year,e.preLaunch]),[[1958,false],[1954,true],[1950,true]]);
  assert.deepEqual(study(s,{era:'live'}).events.map(e=>e.year),[1958]);
  assert.deepEqual(study(s,{asOf:'1958-11-03'}).events.map(e=>e.year),[1954,1950]);
});

test('election-day closure and alternate entry use actual closes, measured to fixed election anniversaries',()=>{
  const s=sessions('1950-11-01','1951-11-08',d=>{
    if (['1950-11-07','1950-12-07'].includes(d)) return null;
    if (d==='1950-11-06') return 80;
    if (d==='1950-11-08') return 110;
    return 100;
  });
  const a=study(s).events[0], b=study(s,{entry:'next'}).events[0];
  assert.equal(a.anchorDate,'1950-11-06'); assert.equal(b.anchorDate,'1950-11-08');
  assert.deepEqual(horizons.map(h=>a.outcomes[h].targetDate),[
    '1950-11-14','1950-12-07','1951-02-07','1951-05-07','1951-11-07'
  ]);
  assert.equal(a.outcomes['1m'].date,'1950-12-06');
  assert.equal(b.outcomes['1m'].date,'1950-12-06');
  near(a.outcomes['12m'].pct,25); near(b.outcomes['12m'].pct,100/110*100-100);
  const recent=study(sessions('2026-11-02','2026-11-03'),{entry:'next'}).events[0];
  assert.equal(recent.anchorDate,null);
  assert.equal(recent.anchorStatus,'pending');
});

test('unmatured calendar periods do not use an earlier close; terminal holidays use preceding closes only once mature',()=>{
  const s=sessions('2026-10-30','2026-11-12', d=>d==='2026-11-10'?null: d==='2026-11-09'?103:100);
  const prior=study(s,{asOf:'2026-11-09'});
  assert.deepEqual(prior,study(s.filter(([d])=>d<='2026-11-09')));
  const before=prior.events[0].outcomes['1w'];
  assert.equal(before.status,'pending'); assert.equal(before.pct,null); assert.equal(before.maxDrawdownPct,null);
  assert.equal(prior.summary['1w'].n,0); assert.equal(prior.summary['1w'].upPct,null);
  const after=study(s).events[0].outcomes['1w'];
  assert.equal(after.status,'complete'); assert.equal(after.targetDate,'2026-11-10'); assert.equal(after.date,'2026-11-09');
  near(after.pct,3);
});

test('a late history start and long gaps are stated as missing, never manufactured into zero returns',()=>{
  const s=sessions('2022-11-01','2023-11-09',d=>d>='2023-03-01'&&d<='2023-03-15'?null:100);
  const r=study(s), current=r.events[0];
  assert.equal(r.events.at(-1).anchorStatus,'missing');
  assert.equal(r.events.at(-1).anchorClose,null);
  assert.equal(current.outcomes['3m'].status,'complete');
  assert.equal(current.outcomes['12m'].status,'missing');
  assert.equal(r.summary['12m'].mean,null);
  const outage=sessions('2022-10-28','2022-12-01',d=>d>='2022-11-08'&&d<='2022-11-28'?null:100);
  for (const entry of ['election','next']) assert.equal(study(outage,{entry}).events[0].anchorStatus,'missing');
  assert.equal(study(sessions('2022-11-09','2022-12-08'),{entry:'next'}).events[0].anchorStatus,'missing');
});

test('mature gains, flats and losses have separate counts; drawdown is measured from an intervening high',()=>{
  const s=sessions('2014-10-01','2026-11-09',d=>new Map([
    ['2014-11-11',110],['2018-11-13',90],
    ['2022-11-09',150],['2022-11-10',120],['2022-11-15',100]
  ]).get(d)??100);
  const r=study(s,{era:'live'}), stats=r.summary['1w'];
  assert.deepEqual([stats.n,stats.up,stats.flat,stats.down,stats.pending],[3,1,1,1,1]);
  near(stats.upPct,100/3); near(stats.mean,0); near(stats.median,0); near(stats.min,-10); near(stats.max,10);
  // The index never fell below entry in the 2022 observation; it still fell from 150 to 100.
  near(r.events.find(e=>e.year===2022).outcomes['1w'].maxDrawdownPct,-100/3);
  const fresh=r.events[0].outcomes['1w']; assert.equal(fresh.status,'pending'); assert.equal(fresh.maxDrawdownPct,null);
});

const control=(year,house,senate,status='confirmed')=>({
  year,house,senate,congress:(year-1786)/2,status,note:'',sourceUrls:['https://example.org/congress/'+year]
});
test('chamber filters intersect and recompute each horizon while preview counts preserve the other chamber',()=>{
  const quotes=sessions('1950-01-03','1963-11-07',day=>day==='1954-11-09'?120:day==='1958-11-11'?90:100);
  const rows=[control(1950,'dem','dem'),control(1954,'rep','rep'),control(1958,'dem','rep'),control(1962,'rep','dem')];
  const all=study(quotes,{},rows);
  assert.equal(all.cohortN,4); assert.equal(all.partyMissingN,0);
  assert.deepEqual(all.events.map(e=>e.year),[1962,1958,1954,1950]);
  const house=study(quotes,{house:'dem'},rows);
  assert.deepEqual(house.events.map(e=>e.year),[1958,1950]);
  assert.equal(house.summary['1w'].n,2); near(house.summary['1w'].mean,-5);
  assert.deepEqual(house.facetCounts,{
    house:{any:4,dem:2,rep:2,unknown:0},senate:{any:2,dem:1,rep:1,unknown:0}
  });
  const split=study(quotes,{house:'dem',senate:'rep'},rows);
  assert.deepEqual(split.events.map(e=>e.year),[1958]);
  assert.equal(split.cohortN,4); assert.equal(split.summary['1w'].n,1); near(split.summary['1w'].mean,-10);
  assert.deepEqual(split.events[0].outcomes,all.events.find(e=>e.year===1958).outcomes);
  const live=study(quotes,{era:'live',house:'rep',senate:'rep'},rows);
  assert.equal(live.cohortN,2); assert.equal(live.events.length,0); assert.equal(live.summary['12m'].mean,null);
  assert.deepEqual(live.facetCounts.house,{any:1,dem:1,rep:0,unknown:0});
});

test('unknown chamber evidence remains distinct from both parties and missing data never removes default returns',()=>{
  const quotes=sessions('1950-01-03','1959-11-05');
  const rows=[control(1950,'dem',null,'unknown'),control(1954,'rep','rep')];
  const all=study(quotes,{},rows), absent=study(quotes);
  assert.equal(all.partyMissingN,2); assert.equal(all.cohortN,3);
  assert.deepEqual(all.summary,absent.summary);
  assert.deepEqual(all.events.map(e=>e.outcomes),absent.events.map(e=>e.outcomes));
  const unknown=study(quotes,{senate:'unknown'},rows);
  assert.deepEqual(unknown.events.map(e=>e.year),[1958,1950]);
  assert.match(unknown.events[0].congress.note,/1958.*众议院、参议院.*缺失/);
  assert.match(unknown.events[1].congress.note,/1950.*参议院.*缺失/);
  assert.equal(study(quotes,{house:'dem'}).events.length,0);
  assert.equal(study(quotes,{house:'unknown'}).events.length,3);
  assert.equal(absent.partyMissingN,3);
});

test('projected control is labelled and immature returns remain excluded independently for each horizon',()=>{
  const quotes=sessions('2026-11-02','2026-11-10',day=>day==='2026-11-10'?103:100);
  const rows=[control(2026,'dem','rep','projected')];
  const r=study(quotes,{house:'dem',senate:'rep'},rows);
  assert.equal(r.events.length,1); assert.equal(r.events[0].congress.status,'projected');
  assert.equal(r.summary['1w'].n,1); near(r.summary['1w'].mean,3);
  assert.equal(r.summary['12m'].n,0); assert.equal(r.summary['12m'].pending,1);
  const before=study(quotes,{house:'dem',asOf:'2026-11-09'},rows);
  assert.equal(before.summary['1w'].n,0); assert.equal(before.summary['1w'].pending,1);
});

test('duplicate or malformed political evidence is rejected before it can silently classify a cohort',()=>{
  const good=control(1950,'dem','dem');
  for (const rows of [null,[good,good],[{...good,house:'Democratic'}],[{...good,senate:undefined}],
    [{...good,status:'probably'}],[{...good,year:1952}],[{...good,congress:82.5}],[{...good,sourceUrls:['javascript:alert(1)']}]]) {
    assert.throws(()=>study([],{},rows),/控制党资料/);
  }
  assert.throws(()=>study([],{house:'green'}),/统计条件/);
  assert.throws(()=>study([],{senate:null}),/统计条件/);
  const s=sessions('1950-11-01','1951-11-08'), result=study(s,{},[good]);
  result.events[0].congress.sourceUrls.push('https://example.org/modified');
  assert.deepEqual(good.sourceUrls,['https://example.org/congress/1950']);
});
