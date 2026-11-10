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
