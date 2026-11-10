const test = require('node:test');
const assert = require('node:assert/strict');
const { study, horizons, matchesFilters } = require('../assets/drop-study-model.js');

function sessions(prices, start = '2020-01-02') {
  const day = new Date(start + 'T00:00:00Z');
  return prices.map(close => {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 1);
    return [date, close];
  });
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} ≠ ${b}`);

test('only one-session losses strictly beyond the selected threshold qualify', () => {
  for (const threshold of [3, 3.01, 4, 4.35, 5, 6, 6.5, 7, 8, 9, 9.99, 10]) {
    const cutoff = Number((123.45 * (1 - threshold / 100)).toFixed(6));
    assert.equal(study(sessions([123.45, cutoff]), { threshold }).latest, null);
    assert.equal(study(sessions([123.45, cutoff - 0.000001]), { threshold }).counts.total, 1);
  }
  assert.equal(study(sessions([100, 97, 94, 91])).counts.total, 0);
});

test('reject out-of-range thresholds, excess precision and non-session observation lengths', () => {
  for (const threshold of [2.99, 10.01, 6.125, NaN, Infinity, '5', null]) {
    assert.throws(() => study([], { threshold }), /统计条件/);
  }
  for (const wait of [1, 6, 2.5, '3', null]) {
    assert.throws(() => study([], { wait }), /统计条件/);
  }
});

test('a recovery on day one still counts if the index falls back; returns start on day two', () => {
  const s = sessions([100, 90, 100, 96, 96, 97, 99, 101, 105.6]);
  const waiting = study(s.slice(0, 3), { group: 'all' });
  assert.equal(waiting.latest.status, 'pending');
  assert.equal(waiting.latest.anchorClose, null);
  assert.equal(waiting.events.length, 0);
  const r = study(s, { group: 'recovered' });
  assert.equal(study(s).events.length, 0);
  assert.deepEqual(study(s, { group: 'all' }).events, r.events);
  const e = r.events[0];
  assert.equal(e.recoveryDate, s[2][0]);
  assert.deepEqual(e.observations, s.slice(2, 4));
  assert.deepEqual([e.priorDate, e.priorClose, e.date, e.close, e.dropPct], [s[0][0], 100, s[1][0], 90, -10]);
  assert.deepEqual([e.anchorDate, e.anchorClose, e.outcomes[5].date], [s[3][0], 96, s[8][0]]);
  near(e.outcomes[5].pct, 10);
});

test('a late recovery changes the event group but each observation length has its own return anchor', () => {
  const s = sessions([100, 93, 96, 99, 100, 98, 99, 99, 101, 103, 105, 106, 107]);
  const cases = [[2, 'unrecovered', 99], [3, 'recovered', 100], [4, 'recovered', 98], [5, 'recovered', 99]];
  for (const [wait, status, anchorClose] of cases) {
    const anchor = 1 + wait;
    const r = study(s, { threshold: 6.99, wait, group: status });
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.equal(e.recoveryDate, wait === 2 ? null : s[4][0]);
    assert.deepEqual([e.anchorDate, e.anchorClose, e.outcomes[5].date], [s[anchor][0], anchorClose, s[anchor + 5][0]]);
    near(r.summary[5].mean, (s[anchor + 5][1] / anchorClose - 1) * 100);
    assert.equal(study(s.slice(0, anchor), { wait, group: 'all' }).latest.status, 'pending');
    assert.equal(study(s, { threshold: 7, wait }).counts.total, 0); // exactly 7%, not more
  }
});

test('overlapping event windows each count once and a flat finish is not a gain', () => {
  const s = sessions([100, 94, 88, 90, 91, 91, 91, 91, 99, 91]);
  const r = study(s);
  assert.equal(r.counts.unrecovered, 2); // The later final drop is a third, pending event.
  assert.equal(r.counts.pending, 1);
  assert.deepEqual(r.events.map(e => e.date), [s[2][0], s[1][0]]);
  assert.deepEqual(r.summary[5], { n: 2, median: 5, mean: 5, upPct: 50, min: 0, max: 10 });
  assert.equal(r.latest.status, 'pending');
  assert.equal(r.baseline[5].n, 2); // All comparable anchors in this fixture are events.
  assert.deepEqual(r.baseline[5], r.summary[5]);
  assert.deepEqual(study(s, {group:'recovered'}).baseline, r.baseline);
});

test('censor each horizon independently without substituting the last seen close', () => {
  const prices = Array(265).fill(100);
  for (const i of [1, 36, 222, 250, 260, 264]) {
    prices[i] = 90;
    if (i + 2 < prices.length) { prices[i + 1] = 91; prices[i + 2] = 92; }
  }
  const s = sessions(prices), r = study(s);
  assert.deepEqual(horizons.map(h => r.summary[h].n), [4, 3, 2, 1]);
  assert.deepEqual(horizons.map(h => r.baseline[h].n), horizons.map(h => 265 - 3 - h));
  assert.equal(r.events.length, 5);
  assert.equal(r.latest.status, 'pending');
  assert.deepEqual(r.events[0].outcomes[5], { status: 'pending', pct: null, date: null, close: null });
  const p = study(s.slice(0, 9));
  assert.deepEqual(p.events[0].outcomes[5], r.events.at(-1).outcomes[5]);
  assert.deepEqual(p.summary[21], { n: 0, median: null, mean: null, upPct: null, min: null, max: null });
});

test('long gaps invalidate daily drops, confirmations and forward returns on both sides of the comparison', () => {
  const a = sessions([100, 94, 95, 100]);
  const b = sessions([90, 91, 92, 92, 92, 92, 92, 92, 93], '2020-02-03');
  const r = study([...a, ...b], { group: 'all' });
  assert.equal(r.counts.total, 1); // 100 -> 90 over the break is not a daily loss.
  assert.equal(r.latest.status, 'recovered');
  for (const h of horizons) {
    assert.deepEqual(r.latest.outcomes[h], { status:'gap', date:null, close:null, pct:null });
    assert.equal(r.summary[h].n, 0);
  }
  assert.equal(r.baseline[5].n, 1); // Only b[3] ... b[8] has lookback and follow-up in one segment.
  near(r.baseline[5].mean, (93 / 92 - 1) * 100);

  const broken = study([...a.slice(0, 3), ...b]);
  assert.equal(broken.latest.status, 'gap');
  assert.deepEqual(broken.latest.observations, [a[2]]);
  assert.equal(broken.latest.anchorDate, null);
  assert.equal(broken.events.length, 0);
  assert.equal(study([['2020-01-01', 100], ['2020-01-11', 90]]).counts.total, 1);
  assert.equal(study([['2020-01-01', 100], ['2020-01-12', 90]]).counts.total, 0);
});

test('end-of-observation rebound uses lost points, independent of an earlier full recovery', () => {
  for (const [anchor, bucket] of [[89, 'none'], [90, 'none'], [94.99, 'partial'], [95, 'half'],
    [99.99, 'half'], [100, 'full'], [101, 'full']]) {
    const r = study(sessions([100, 90, 100, anchor]), { group: 'recovered', rebound: bucket });
    assert.equal(r.events.length, 1);
    near(r.events[0].features.reboundPct, (anchor - 90) * 10);
    assert.equal(r.facetCounts.rebound[bucket], 1);
  }
  const pending = study(sessions([100, 90, 99])).latest;
  assert.equal(pending.features.reboundPct, null);
  assert.equal(matchesFilters(pending, { rebound: 'half' }), false);
});

test('the 21 preceding session returns exclude today, include day −21, and follow the chosen threshold', () => {
  function history(day, value) {
    const prices = Array(36).fill(100);
    prices[day] = value;
    prices.splice(30, 3, 89, 90, 94);
    return sessions(prices);
  }
  for (const [day, value, threshold, priorDrops] of [[9, 94, 5, 1], [8, 94, 5, 0], [9, 94, 7, 0], [9, 95, 5, 0]]) {
    const s = history(day, value);
    const r = study(s, { threshold, repeat: priorDrops ? 'repeat' : 'first' });
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].date, s[30][0]);
    assert.equal(r.events[0].features.priorDrops, priorDrops);
  }
});

test('pre-drop features need their own complete lookbacks after a gap; any retains missing events', () => {
  const before = sessions(Array(260).fill(99));
  for (const n of [21, 22, 199, 200, 251, 252]) {
    const after = sessions([...Array(n).fill(111.11), 100, 101, 105], '2023-01-03');
    const s = [...before, ...after];
    const r = study(s);
    assert.equal(r.events.length, 1);
    const f = r.latest.features;
    assert.deepEqual([f.priorDrops, f.ma200Pct, f.drawdownPct], [n < 22 ? null : 0, n < 200 ? null : 0, n < 252 ? null : 0]);
    for (const [key, value, need] of [['repeat', 'first', 22], ['trend', 'below', 200], ['drawdown', 'near', 252]]) {
      const filtered = study(s, { [key]: value });
      assert.equal(filtered.events.length, n < need ? 0 : 1);
      assert.equal(filtered.facetCounts[key].any, 1);
      assert.equal(filtered.facetCounts[key].missing, n < need ? 1 : 0);
      assert.equal(filtered.cohortN, 1);
    }
  }
});

test('MA and drawdown only use pre-event closes and partition boundary values consistently', () => {
  const high = 123.4;
  for (const [pct, bucket] of [[0, 'near'], [4.99, 'near'], [5, 'pullback'], [10, 'correction'], [20, 'bear']]) {
    const prior = high * (1 - pct / 100);
    const s = sessions([high * 2, high, ...Array(250).fill(prior - 1), prior, prior * .9, prior * .91, prior * .92]);
    const r = study(s, { trend: 'above', drawdown: bucket });
    assert.equal(r.events[0].date, s.at(-3)[0]);
    near(r.latest.features.drawdownPct, pct);
    near(r.latest.features.ma200Pct, (prior / (prior - 199 / 200) - 1) * 100);
  }
});

test('combining facets retains matching outcomes while counts offer alternatives within the other active filters', () => {
  const p = Array(340).fill(100);
  for (const [i, anchor] of [[265, 96], [275, 94], [300, 94], [310, 96]]) p.splice(i, 3, 90, 91, anchor);
  const s = sessions(p), all = study(s);
  const selected = study(s, { rebound: 'half', repeat: 'first' });
  assert.equal(selected.cohortN, 4);
  assert.deepEqual(selected.events, [all.events.at(-1)]);
  assert.deepEqual(selected.latest, all.latest);
  assert.deepEqual(selected.counts, all.counts);
  assert.deepEqual(selected.baseline, all.baseline);
  assert.equal(selected.summary[21].n, 1);
  near(selected.summary[21].mean, selected.events[0].outcomes[21].pct);
  assert.deepEqual(selected.facetCounts.repeat, { any: 2, first: 1, repeat: 1, missing: 0 });
  assert.deepEqual(selected.facetCounts.rebound, { any: 2, none: 0, partial: 1, half: 1, full: 0, missing: 0 });
  assert.equal(matchesFilters(selected.latest, { rebound: 'half', repeat: 'first' }), false);
  for (const key of ['rebound', 'repeat', 'trend', 'drawdown']) {
    assert.throws(() => study(s, { [key]: 'other' }), /统计条件/);
  }
});
