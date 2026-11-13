const test = require('node:test');
const assert = require('node:assert/strict');
const { study, horizons, waits, validWait } = require('../assets/drop-study-model.js');

function sessions(prices, start = '2020-01-02') {
  const day = new Date(start + 'T00:00:00Z');
  return prices.map(close => {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 1);
    return [date, close];
  });
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, actual + ' ≠ ' + expected);

test('observation periods accept custom integer sessions through one trading year', () => {
  assert.deepEqual(waits, [2, 3, 4, 5, 10, 21, 42, 63, 126, 252]);
  for (const wait of [2, 5, 6, 17, 21, 63, 251, 252]) {
    assert.equal(validWait(wait), true);
    assert.equal(study([], { wait }).wait, wait);
  }
  for (const wait of [1, 253, 2.5, '21', null, NaN, Infinity]) {
    assert.equal(validWait(wait), false);
    assert.throws(() => study([], { wait }), /统计条件/);
  }
});

test('a recovery after the first week changes the cohort but each long period anchors at its own final close', () => {
  const series = sessions([100, 90, ...Array.from({ length: 504 }, (_, i) => i < 6 ? 91 + i : 100 + (i - 6) * .1)]);
  for (const wait of [5, 6, 7, 10, 21, 63, 252]) {
    const anchor = 1 + wait, status = wait < 7 ? 'unrecovered' : 'recovered';
    const result = study(series, { wait, group: status });
    assert.equal(result.events.length, 1);
    const event = result.events[0];
    assert.equal(event.status, status);
    assert.equal(event.observations.length, wait);
    assert.equal(event.recoveryDate, wait < 7 ? null : series[8][0]);
    assert.equal(event.anchorDate, series[anchor][0]);
    assert.equal(event.anchorClose, series[anchor][1]);
    for (const h of horizons) {
      assert.equal(event.outcomes[h].date, series[anchor + h][0]);
      near(result.summary[h].mean, (series[anchor + h][1] / series[anchor][1] - 1) * 100);
    }
    assert.equal(study(series, { wait, group: status === 'recovered' ? 'unrecovered' : 'recovered' }).events.length, 0);
  }
});

test('long observations must finish before inclusion and forward horizons mature independently', () => {
  const series = sessions([100, 90, ...Array(525).fill(100)]), wait = 21, anchor = 1 + wait;
  const waiting = study(series.slice(0, anchor), { wait, group: 'all' });
  assert.equal(waiting.latest.status, 'pending');
  assert.equal(waiting.latest.recoveryDate, series[2][0]);
  assert.equal(waiting.latest.observations.length, wait - 1);
  assert.equal(waiting.latest.anchorDate, null);
  assert.equal(waiting.events.length, 0);
  const confirmed = study(series.slice(0, anchor + 1), { wait, group: 'all' });
  assert.equal(confirmed.events.length, 1);
  assert.ok(horizons.every(h => confirmed.latest.outcomes[h].status === 'pending'));
  for (const elapsed of [4, 5, 20, 21, 62, 63, 251, 252]) {
    const result = study(series.slice(0, anchor + elapsed + 1), { wait, group: 'all' });
    assert.deepEqual(horizons.map(h => result.summary[h].n), horizons.map(h => Number(elapsed >= h)));
    for (const h of horizons) {
      assert.equal(result.latest.outcomes[h].status, elapsed >= h ? 'complete' : 'pending');
      assert.equal(result.latest.outcomes[h].pct, elapsed >= h ? 0 : null);
    }
  }
});

test('long high-based observations keep missing highs and price gaps out of recovered cohorts and baselines', () => {
  const wait = 21, series = sessions([100, 90, ...Array.from({ length: 70 }, (_, i) => 95 + i * .01)]);
  const highs = series.map(([day, close]) => [day, close + .1]);
  highs[15][1] = 100;
  const valid = study(series, { wait, recovery: 'high', group: 'recovered' }, null, highs);
  assert.equal(valid.events.length, 1);
  assert.equal(valid.latest.recoveryDate, series[15][0]);
  const withoutHigh = highs.filter((_, i) => i !== 12);
  const missing = study(series, { wait, recovery: 'high', group: 'all' }, null, withoutHigh);
  assert.equal(missing.latest.status, 'missingHigh');
  assert.equal(missing.latest.recoveryDate, null);
  assert.deepEqual(missing.latest.missingHighDates, [series[12][0]]);
  assert.equal(missing.events.length, 0);
  for (const h of horizons) {
    const expected = [];
    for (let anchor = wait + 1; anchor + h < series.length; anchor++) {
      if (anchor - wait + 1 <= 12 && 12 <= anchor) continue;
      expected.push((series[anchor + h][1] / series[anchor][1] - 1) * 100);
    }
    assert.equal(missing.baseline[h].n, expected.length);
    if (expected.length) near(missing.baseline[h].mean, expected.reduce((a, b) => a + b, 0) / expected.length);
  }
  const before = series.slice(0, 15), after = sessions(Array.from({ length: 70 }, (_, i) => 96 + i * .01), '2021-01-04');
  const broken = [...before, ...after], brokenHighs = broken.map(([day, close]) => [day, close + 10]);
  const gap = study(broken, { wait, recovery: 'high', group: 'all' }, null, brokenHighs);
  assert.equal(gap.latest.status, 'gap');
  assert.equal(gap.latest.anchorDate, null);
  assert.equal(gap.latest.observations.length, before.length - 2);
  assert.equal(gap.events.length, 0);
  assert.equal(gap.baseline[5].n, after.length - (wait + 1) - 5);
});
