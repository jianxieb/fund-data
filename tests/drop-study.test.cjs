const test = require('node:test');
const assert = require('node:assert/strict');
const { study, horizons } = require('../assets/drop-study-model.js');

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
