const test = require('node:test');
const assert = require('node:assert/strict');
const {rolling, validDays, validThreshold, exceeds} = require('../assets/drop-window-model.js');

function dates(prices) {
  return prices.map((p,i) => [new Date(Date.UTC(2020,0,6+i)).toISOString().slice(0,10), p]);
}

test('peak window counts closes including today; cumulative loss counts intervals, including gradual declines', () => {
  const s = dates([120, 110, 110, 105, 100, 110, 108]);
  const r = rolling(s, {peakDays:3,lossDays:3});
  assert.deepEqual(r[0], {peak:null,loss:null});
  assert.deepEqual(r[2], {peak:{date:s[0][0],close:120,pct:10/120*100},loss:null});
  // Equal highs: the most recent 110; cumulative change still begins at 120.
  assert.deepEqual(r[3], {peak:{date:s[2][0],close:110,pct:5/110*100},
                          loss:{date:s[0][0],close:120,pct:12.5}});
  assert.equal(r[5].peak.date, s[5][0]);
  assert.equal(r[5].peak.pct, 0);
  assert.ok(r[6].loss.pct < 0); // A rising interval does not become a loss.
  assert.equal(exceeds(r[6].loss, 1), false);
  const gradual = rolling(dates([100,98,96,94]), {lossDays:3});
  assert.equal(exceeds(gradual[3].loss, 5), true);
  assert.equal(gradual[3].peak, null);
});

test('partial windows restart after more than 10 calendar days; 10 days is still continuous', () => {
  const s = [['2020-01-01',100],['2020-01-11',95],['2020-01-22',80],['2020-01-23',79],['2020-01-24',78]];
  const r = rolling(s, {peakDays:2,lossDays:2});
  assert.deepEqual(r[1], {peak:{date:s[0][0],close:100,pct:5},loss:null});
  assert.deepEqual(r[2], {peak:null,loss:null});
  assert.equal(r[3].peak.date,s[2][0]);
  assert.equal(r[3].loss,null);
  assert.equal(r[4].loss.date,s[2][0]);
  assert.equal(exceeds(null, 0.01),false);
});

test('declines must strictly exceed the cutoff at full price precision', () => {
  for (const boundary of [0.01,0.29,5,7.25,25,99.99]) {
    // 123.45 * (1 - boundary / 100) is exact to at most 6 decimal places.
    const level = Number((123.45*(1-boundary/100)).toFixed(6));
    const metric = end => rolling(dates([123.45,end]),{lossDays:1})[1].loss;
    assert.equal(exceeds(metric(level),boundary),false);
    assert.equal(exceeds(metric(level+0.000001),boundary),false);
    assert.equal(exceeds(metric(level-0.000001),boundary),true);
  }
  for (const bad of [0,-1,100,101,7.125,'5',null,NaN,Infinity]) assert.equal(validThreshold(bad),false);
  for (const good of [0.01,0.29,5,7.25,99.99]) assert.equal(validThreshold(good),true);
  for (const [kind,min] of [['peak',2],['loss',1]]) {
    for (const n of [min,13,2520]) assert.equal(validDays(kind,n),true);
    for (const n of [min-1,2521,1.5,'12',NaN]) assert.equal(validDays(kind,n),false);
    assert.throws(()=>rolling([], {[kind+'Days']:0}),/交易日/);
  }
});

test('moving high agrees with full-window rescans after old highs expire and equal or new highs arrive', () => {
  const s = dates(Array.from({length:450}, (_,i)=>100+(i*19 % 29)+(i % 7===0 ? 20:0)));
  for (const days of [2,7,32,252]) {
    const r = rolling(s,{peakDays:days});
    for (let i=days-1;i<s.length;i++) {
      const range = s.slice(i-days+1,i+1), high=Math.max(...range.map(row=>row[1]));
      assert.deepEqual(r[i].peak, {date:range.filter(row=>row[1]===high).at(-1)[0],close:high,pct:(high-s[i][1])/high*100});
    }
  }
});
