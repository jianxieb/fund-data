const test = require('node:test');
const assert = require('node:assert/strict');
const {study, matchesFilters} = require('../assets/drop-study-model.js');

const sessions = (closes, start = '2020-01-06') => {
  const day = new Date(start + 'T00:00:00Z');
  return closes.map(close => {
    while ([0,6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate()+1);
    const row = [day.toISOString().slice(0,10),close];
    day.setUTCDate(day.getUTCDate()+1);
    return row;
  });
};

test('window filters intersect the original one-session events; they never add a gradual decline', () => {
  const p = [], event = [];
  for (const block of [
    [100,96,92,89,86,85,85,85,76.5], // Both filters.
    [100,96,92,89,86,84,83,84,77],   // Peak only.
    [100,100,100,100,100,100,100,100,90], // Two-day loss only.
    [100,100,100,100,100,100,100,100,94]  // Neither.
  ]) {
    p.push(...block); event.push(p.length-1);
    p.push(block.at(-1), block.at(-1), ...Array(12).fill(100));
  }
  // A slow decline breaches both window thresholds but never drops over 5% on any day.
  for (let i=0; i<10; i++) p.push(100*.955**i);
  p.push(100,100);
  const series = sessions(p), base = {peakDays:9,lossDays:2};
  const r = study(series,{...base,peakMin:20,lossMin:8}), unfiltered = study(series,base);
  assert.deepEqual(unfiltered.events.map(e=>e.date),event.slice().reverse().map(i=>series[i][0]));
  assert.deepEqual(r.events,unfiltered.events.slice(-1));
  assert.equal(r.cohortN,4);
  assert.equal(r.events[0].features.windows.peak.close,100);
  assert.equal(r.events[0].features.windows.loss.date,series[event[0]-2][0]);
  assert.deepEqual(r.windowCounts,{peak:{any:2,match:1,missing:0},loss:{any:2,match:1,missing:0}});
  assert.deepEqual(r.facetCounts.low,{any:1,hold:1,break:0,missing:0});
  assert.deepEqual(r.baseline,unfiltered.baseline);
  assert.equal(r.summary[5].n,1);
  assert.equal(r.summary[5].mean,r.events[0].outcomes[5].pct);
  assert.equal(matchesFilters(r.latest,{peakMin:20,lossMin:8}),false);
  assert.equal(matchesFilters(r.events[0],{peakMin:20,lossMin:8}),true);
  const cap = study(series,{...base,peakMin:20,lossMin:8,cap:'9'});
  assert.equal(cap.events.length,0);
  assert.deepEqual(cap.windowCounts,{peak:{any:0,match:0,missing:0},loss:{any:1,match:0,missing:0}});
  assert.equal(cap.facetCounts.cap.any,1);
});

test('missing windows are reported separately per metric; disabled windows preserve the sample', () => {
  const series = [...sessions([100,94,94,94,94]), ...sessions([100,94,88,88,88], '2020-03-02')];
  const r = study(series,{peakDays:3,lossDays:1});
  assert.equal(r.events.length,3);
  assert.deepEqual(r.windowCounts,{peak:{any:3,match:null,missing:2},loss:{any:3,match:null,missing:0}});
  const filtered = study(series,{peakDays:3,peakMin:8,lossDays:1,lossMin:6});
  assert.equal(filtered.events.length,1); // Exactly 6% is not over 6%; the last 94 -> 88 decline is.
  assert.deepEqual(filtered.windowCounts,{peak:{any:1,match:1,missing:0},loss:{any:1,match:1,missing:0}});
  assert.equal(study(series,{peakDays:3,peakMin:8}).windowCounts.peak.missing,2);
  assert.equal(r.events[1].features.windows.peak,null);
  assert.equal(matchesFilters(r.events[1],{peakMin:5}),false);
});

test('selected windows must be valid even for an empty series; invalid thresholds never silently pass', () => {
  for (const options of [{peakDays:1},{lossDays:0},{lossDays:2521},{peakDays:12.5},
    {peakMin:0},{lossMin:100},{lossMin:1.005},{peakMin:'5'}]) {
    assert.throws(()=>study([],options),/统计条件/);
  }
  assert.equal(study([],{peakDays:2520,lossDays:2520,peakMin:null,lossMin:null}).events.length,0);
});
