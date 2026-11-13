const test = require('node:test');
const assert = require('node:assert/strict');
const {study,horizons,validWindow,validMinCrossings} = require('../assets/ma-study-model.js');

function sessions(values, start = '2020-01-02') {
  const day = new Date(start + 'T00:00:00Z');
  return values.map(close => {
    while ([0,6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0,10);
    day.setUTCDate(day.getUTCDate() + 1);
    return [date,close];
  });
}
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-10, a + ' ≠ ' + b);
const cold = (period=200) => Array(period).fill(100);

test('full moving-average warm-up is required and the first observed side is not a crossing', () => {
  for (const period of [200,250]) {
    const series = sessions([...Array(period-1).fill(100),120,80,120]);
    const short = study(series.slice(0,period-1),{period,direction:'both'});
    assert.equal(short.current.ma,null); assert.equal(short.events.length,0);
    const initial = study(series.slice(0,period),{period,direction:'both'});
    near(initial.current.ma,100+20/period);
    assert.equal(initial.current.side,'above'); assert.equal(initial.events.length,0);
    const full = study(series,{period,direction:'both'});
    assert.deepEqual(full.events.map(e=>[e.index,e.direction]),[[period+1,'up'],[period,'down']]);
    near(full.events[1].ma,100);
    assert.equal(full.events[1].anchorDate,series[period][0]);
    assert.equal(full.events[1].anchorClose,80);
  }
});

test('touching the MA keeps the prior side and creates no duplicate crossing', () => {
  const values = [...cold(),101];
  for (let i=0; i<3; i++) values.push(values.slice(-199).reduce((a,b)=>a+b,0)/199);
  const touch = study(sessions(values),{direction:'both'});
  assert.equal(touch.current.side,'equal'); assert.equal(touch.events.length,0);
  values.push(102); // Return to the same side after touching: still no cross.
  assert.equal(study(sessions(values),{direction:'both'}).events.length,0);
  values.push(99);
  const below = study(sessions(values),{direction:'both'});
  assert.equal(below.events.length,1); assert.equal(below.events[0].direction,'down');
  values.push(values.slice(-199).reduce((a,b)=>a+b,0)/199);
  values.push(98); // Another touch followed by the same below-side is not new.
  assert.equal(study(sessions(values),{direction:'both'}).events.length,1);
  values.push(102);
  assert.deepEqual(study(sessions(values),{direction:'both'}).events.map(e=>e.direction),['up','down']);
  assert.equal(study(sessions(Array(500).fill(1.1)),{direction:'both'}).events.length,0);
});

test('window counts include both directions and today, exclude the left boundary, and need complete coverage', () => {
  // index 200 establishes above; 201 down, 202 up, 203 down, 204 up.
  const series = sessions([...cold(),101,99,101,99,101,102,103,99]);
  const all = study(series,{direction:'both',window:3});
  const at = i => all.events.find(e=>e.index===i);
  assert.equal(at(201).rollingCrosses,null);
  assert.equal(at(202).windowComplete,false);
  assert.equal(at(203).rollingCrosses,3);
  assert.equal(at(204).rollingCrosses,3); // index 201 has left the window.
  assert.equal(at(207).rollingCrosses,1); // Noncrossing days still consume the window.
  const selected = study(series,{direction:'up',window:3,minCrossings:3});
  assert.deepEqual(selected.events.map(e=>e.index),[204]);
  assert.equal(selected.cohortN,2);
  assert.equal(selected.counts.windowIncomplete,1);
  assert.equal(selected.counts.total,5);
  assert.equal(selected.counts.matching,1);
  assert.equal(selected.latest.direction,'down');
  assert.equal(selected.latestMatching.index,204);
  assert.equal(selected.current.rollingCrosses,1);
  const one = study(series,{direction:'both',window:1,minCrossings:1});
  assert.equal(one.events.length,5);
  assert.ok(one.events.every(e=>e.rollingCrosses===1));
});

test('future outcomes start at the crossing close and distinguish peak drawdown from loss versus entry', () => {
  const series = sessions([...cold(),101,99,110,80,90,100,120]);
  const result = study(series,{direction:'down'});
  const event = result.events.find(e=>e.index===201), o = event.outcomes[5];
  assert.equal(o.status,'complete'); assert.equal(o.date,series[206][0]);
  near(o.pct,(120/99-1)*100);
  near(o.maxDrawdownPct,(80/110-1)*100);
  near(o.minFromStartPct,(80/99-1)*100);
  assert.equal(event.outcomes[21].status,'pending');
  assert.equal(event.outcomes[21].pct,null);
  assert.equal(event.outcomes[21].maxDrawdownPct,null);
  assert.equal(result.summary[5].n,1);
  assert.equal(result.summary[5].pending,1); // The second downcross is too recent.
  near(result.summary[5].drawdown.median,o.maxDrawdownPct);
  near(result.summary[5].minFromStart.mean,o.minFromStartPct);
  assert.equal(result.summary[21].n,0);
  assert.equal(result.summary[21].mean,null);
});

test('a return can stay above entry while still experiencing a peak-to-trough drawdown', () => {
  const series = sessions([...cold(),101,99,110,130,120,140,135]);
  const event = study(series,{direction:'down'}).events.find(e=>e.index===201);
  near(event.outcomes[5].minFromStartPct,0);
  near(event.outcomes[5].maxDrawdownPct,(120/130-1)*100);
  near(event.outcomes[5].pct,(135/99-1)*100);
});

test('each horizon matures separately and appending future prices cannot change an existing signal', () => {
  const base = sessions([...cold(),101,99,101,99,101]);
  const future = sessions(Array(252).fill(105),new Date(Date.parse(base.at(-1)[0]+'T00:00:00Z')+86400000).toISOString().slice(0,10));
  const before = study(base,{direction:'both',window:3,minCrossings:3});
  const after = study(base.concat(future),{direction:'both',window:3,minCrossings:3});
  for (const e of before.events) {
    const later = after.events.find(v=>v.date===e.date);
    const {outcomes:a,...signalA} = e, {outcomes:b,...signalB} = later;
    assert.deepEqual(signalA,signalB);
    assert.equal(a[252].status,'pending'); assert.equal(b[252].status,'complete');
  }
  const atFive = study(base.concat(future.slice(0,5)),{direction:'both',window:3,minCrossings:3});
  assert.equal(atFive.summary[5].n,2);
  assert.equal(atFive.summary[21].n,0);
  assert.equal(after.summary[252].n,2);
  assert.deepEqual(horizons,[5,21,63,252]);
});

test('known long gaps invalidate affected outcomes and reset MA and rolling-cross warm-up', () => {
  const first = sessions([...cold(),101,99]);
  const restart = new Date(Date.parse(first.at(-1)[0]+'T00:00:00Z')+20*86400000).toISOString().slice(0,10);
  const second = sessions([...cold(),101,99,101],restart);
  const result = study(first.concat(second),{direction:'both',window:2,minCrossings:null});
  const old = result.events.find(e=>e.date===first.at(-1)[0]);
  for (const h of horizons) {
    assert.equal(old.outcomes[h].status,'gap');
    assert.equal(old.outcomes[h].pct,null); assert.equal(old.outcomes[h].maxDrawdownPct,null);
  }
  assert.equal(result.summary[5].missing,1);
  assert.equal(result.events.length,3);
  assert.equal(result.current.rollingCrosses,2);
  const insufficient = study(first.concat(second.slice(0,199)),{direction:'both'});
  assert.equal(insufficient.current.ma,null);
  assert.equal(insufficient.events.length,1); // No crossing across the outage.
});

test('empty and malformed data are handled explicitly without mutating inputs', () => {
  const empty = study([]);
  assert.equal(empty.current,null); assert.equal(empty.latest,null); assert.equal(empty.first,null);
  assert.equal(empty.summary[5].upPct,null);
  const s = sessions([...cold(),101,99,101]), snapshot = JSON.stringify(s);
  study(s,{direction:'both'}); assert.equal(JSON.stringify(s),snapshot);
  for (const bad of [null,{},[['2025-02-30',100]],[['2025-01-01',0]],[['2025-01-01','100']],
    [['2025-01-01',NaN]],[['2025-01-01',100],['2025-01-01',101]],
    [['2025-01-02',100],['2025-01-01',101]],[['2025-01-01',100,101]]])
    assert.throws(()=>study(bad),/序列/);
  for (const options of [{period:199},{period:'200'},{direction:'repeated'},{window:0},{window:2521},
    {window:2.5},{window:'63'},{minCrossings:0},{minCrossings:'2'},{window:2,minCrossings:3}])
    assert.throws(()=>study(s,options),/统计条件/);
  assert.equal(validWindow(2520),true); assert.equal(validWindow(0),false);
  assert.equal(validMinCrossings(2,2),true); assert.equal(validMinCrossings(3,2),false);
});
