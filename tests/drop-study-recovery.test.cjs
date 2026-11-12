const test = require('node:test');
const assert = require('node:assert/strict');
const { study, matchesFilters, eraRanges } = require('../assets/drop-study-model.js');

function sessions(values, start = '2025-01-02') {
  const day = new Date(start + 'T00:00:00Z');
  return values.map(close => {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 1);
    return [date, close];
  });
}
const highsOf = series => series.map(([day, close]) => [day, close + 1]);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, actual + ' ≠ ' + expected);

test('an intraday touch changes recovery classification but not the closing return path', () => {
  const series = sessions([100, 90, 95, 96, 97, 98, 100, 102, 105.6]), highs = highsOf(series);
  highs[2][1] = 100;
  const close = study(series, { group: 'unrecovered' });
  const high = study(series, { group: 'recovered', recovery: 'high' }, null, highs);
  assert.equal(close.events.length, 1); assert.equal(high.events.length, 1);
  const e = high.events[0], c = close.events[0];
  assert.equal(e.recoveryDate, series[2][0]);
  assert.deepEqual(e.observations, c.observations);
  assert.deepEqual(e.observationHighs, highs.slice(2, 4));
  assert.deepEqual(e.missingHighDates, []);
  assert.equal(e.anchorDate, c.anchorDate); assert.equal(e.anchorClose, 96);
  assert.deepEqual(e.outcomes, c.outcomes); near(e.outcomes[5].pct, 10);
  assert.deepEqual(e.features, c.features); assert.equal(e.features.reboundPct, 60);
  assert.equal(study(series, { recovery: 'high' }, null, highs).events.length, 0);
  assert.equal(high.counts.recovered, 1); assert.equal(high.counts.missingHigh, 0);
  assert.deepEqual(high.baseline, close.baseline);
});

test('touch equality is inclusive and only the requested post-drop observations can recover', () => {
  const series = sessions([100, 90, 95, 96, 97, 98, 99, 100, 101]), highs = highsOf(series);
  highs[1][1] = 110; // A high on the drop day is outside the observation period.
  highs[2][1] = 99.999;
  highs[4][1] = 110; // A high after the selected two days is also outside it.
  assert.equal(study(series, { recovery: 'high' }, null, highs).latest.status, 'unrecovered');
  highs[2][1] = 100;
  const result = study(series, { recovery: 'high' }, null, highs);
  assert.equal(result.latest.status, 'recovered');
  assert.equal(result.latest.recoveryDate, series[2][0]);
  assert.equal(study(series.slice(0, 3), { recovery: 'high', group: 'all' }, null, highs).latest.status, 'pending');
  assert.equal(study(series.slice(0, 3), { recovery: 'high', group: 'all' }, null, highs).events.length, 0);
});

test('missing or contradictory highs cannot silently classify a complete event as recovered or unrecovered', () => {
  const series = sessions([100, 90, 95, 96, 97, 98, 99, 100, 101]);
  for (const bad of [null, NaN, Infinity, -1, 0, '100', 94.99]) {
    const highs = highsOf(series); highs[2][1] = bad; highs[3][1] = 101;
    for (const group of ['unrecovered', 'recovered', 'all']) {
      const result = study(series, { recovery: 'high', group }, null, highs);
      assert.equal(result.latest.status, 'missingHigh');
      assert.equal(result.latest.recoveryDate, null);
      assert.deepEqual(result.latest.missingHighDates, [series[2][0]]);
      assert.deepEqual(result.latest.observationHighs, [[series[2][0], null], [series[3][0], 101]]);
      assert.equal(result.counts.total, 1); assert.equal(result.counts.missingHigh, 1);
      assert.equal(result.counts.recovered, 0); assert.equal(result.counts.unrecovered, 0);
      assert.equal(result.events.length, 0); assert.equal(result.cohortN, 0);
      assert.equal(result.summary[5].n, 0);
      assert.equal(result.facetCounts.rebound.any, 0);
      assert.equal(result.latest.anchorClose, 96);
    }
  }
  const absent = study(series, { recovery: 'high' });
  assert.deepEqual(absent.latest.missingHighDates, series.slice(2, 4).map(([date]) => date));
  assert.deepEqual(study(series, {}, null, { invalid: true }), study(series));
  const incomplete = study(series.slice(0, 3), { recovery: 'high' });
  assert.equal(incomplete.latest.status, 'pending'); assert.equal(incomplete.counts.missingHigh, 0);
});

test('the high-based baseline uses the same complete observation coverage and still respects price gaps', () => {
  const series = sessions(Array.from({ length: 30 }, (_, i) => 100 + i));
  const highs = highsOf(series).filter((_, i) => i !== 10);
  const close = study(series), high = study(series, { recovery: 'high' }, null, highs);
  assert.equal(high.baseline[5].n, close.baseline[5].n - 2);
  const expected = [];
  for (let anchor = 3; anchor + 5 < series.length; anchor++) {
    if ([anchor - 1, anchor].includes(10)) continue;
    expected.push(100 * (series[anchor + 5][1] / series[anchor][1] - 1));
  }
  near(high.baseline[5].mean, expected.reduce((sum, value) => sum + value, 0) / expected.length);
  const broken = [...sessions([100, 90, 95]), ...sessions([100, 101, 102], '2025-02-03')];
  const gap = study(broken, { recovery: 'high', group: 'all' }, null, highsOf(broken));
  assert.equal(gap.latest.status, 'gap'); assert.equal(gap.events.length, 0);
});

test('recovery inputs reject ambiguous dates and unsupported modes instead of quietly changing basis', () => {
  const series = sessions([100, 90, 95, 96]);
  for (const recovery of ['', 'intraday', 1, null]) assert.throws(() => study(series, { recovery }), /统计条件/);
  for (const high of [{}, [[series[2][0], 100], [series[2][0], 101]],
    [['2025-02-30', 100]], [[series[3][0], 100], [series[2][0], 100]], [[series[2][0], 100, 95]]]) {
    assert.throws(() => study(series, { recovery: 'high' }, null, high), /最高价历史/);
  }
});

test('excluding dotcom event dates preserves complete histories and applies the same dates to the baseline', () => {
  // Synthetic daily observations exercise the exact inclusive date boundaries,
  // independent of whether those dates happened to be exchange sessions.
  const first = Date.parse('1999-12-27T00:00:00Z'), end = Date.parse('2003-01-12T00:00:00Z');
  const series = [];
  for (let day = first; day <= end; day += 86400000) series.push([new Date(day).toISOString().slice(0, 10), 100]);
  const drops = { '1999-12-31': 90, '2000-01-01': 80, '2002-12-31': 90, '2003-01-01': 80 };
  series.forEach(row => { if (drops[row[0]]) row[1] = drops[row[0]]; });
  const before = JSON.stringify(series), all = study(series, { group: 'all' });
  const kept = study(series, { group: 'all', era: 'exclude_dotcom' });
  assert.equal(JSON.stringify(series), before);
  assert.deepEqual(eraRanges.exclude_dotcom, ['2000-01-01', '2002-12-31']);
  assert.equal(kept.excludedEvents, 2); assert.equal(all.excludedEvents, 0);
  assert.equal(kept.counts.total, all.counts.total - 2);
  const outside = date => date < '2000-01-01' || date > '2002-12-31';
  assert.deepEqual(kept.events, all.events.filter(event => outside(event.date)));
  assert.deepEqual(kept.events.map(event => event.date), ['2003-01-01', '1999-12-31']);
  assert.equal(kept.latest.date, '2003-01-01');
  assert.equal(kept.latest.priorDate, '2002-12-31');
  assert.equal(kept.latest.priorClose, 90); // Do not join across deleted rows.
  for (const event of all.events) assert.equal(matchesFilters(event, { era: 'exclude_dotcom' }), outside(event.date));
  const expected = [];
  for (let anchor = 3; anchor + 5 < series.length; anchor++) {
    if (!outside(series[anchor - 2][0])) continue;
    expected.push(100 * (series[anchor + 5][1] / series[anchor][1] - 1));
  }
  assert.equal(kept.baseline[5].n, expected.length);
  near(kept.baseline[5].mean, expected.reduce((sum, value) => sum + value, 0) / expected.length);
  const throughExcluded = series.filter(([day]) => day <= '2002-12-31');
  assert.equal(study(throughExcluded, { era: 'exclude_dotcom' }).latest.date, '1999-12-31');
  for (const era of ['', 'exclude_2000', null, 2000]) assert.throws(() => study(series, { era }), /统计条件/);
});
