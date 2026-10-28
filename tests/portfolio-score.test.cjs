const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/portfolio-timing-model.js');
const P = require('../assets/portfolio-model.js');
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function calendar(start, end) {
  const days = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
    const date = new Date(t);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days.push(date.toISOString().slice(0, 10));
  }
  return days;
}
function fixture(days, prices = days.map((_, i) => Math.exp(i / 2000 + .3 * Math.sin(i / 90)))) {
  const id = 'test:asset';
  return { catalog: { assets: [{ id, name: '测试标的', status: 'available', currency: 'CNY' }] },
    histories: { [id]: { schemaVersion: 1, id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, prices[i]]) } },
    config: { positions: [{ id, weight: 100 }], currency: 'CNY', initial: 100000, monthly: 8000, years: 'common', transactionFee: 0, feeBasis: 'net', rebalance: 'none' } };
}
const analyze = (input, options = {}) => T.analyze(input, { today: input.histories['test:asset']?.asOf, ...options });
const metrics = overrides => ({ value: 110, ma200: 100, ma200Prior20: 95, ma50: 105, percentile: 20, volatilityPercentile: 25, ...overrides });

test('v1 hand calculation exposes fixed components, downside gate, and strict trend comparisons', () => {
  const score = T.scoreFromMetrics(metrics());
  assert.deepEqual(score.components.map(c => [c.id, c.points, c.max]), [['location', 32, 40], ['trend', 40, 40], ['stability', 15, 20]]);
  assert.equal(score.raw, 87); assert.equal(score.value, 87); assert.equal(score.band.id, 'priority');
  assert.deepEqual(score.gate, { active: false, cap: null, deduction: 0, reason: null });
  const falling = T.scoreFromMetrics(metrics({ value: 80, ma200Prior20: 110, ma50: 90, percentile: 0, volatilityPercentile: 0 }));
  assert.equal(falling.raw, 60); assert.equal(falling.value, 39); assert.equal(falling.band.id, 'wait');
  assert.equal(falling.gate.cap, 39); assert.equal(falling.gate.deduction, 21); assert.match(falling.gate.reason, /200日均线下降/);
  const rounded = T.scoreFromMetrics(metrics({ value: 80, ma200Prior20: 110, ma50: 90, percentile: 25.5, volatilityPercentile: 52 }));
  close(rounded.raw, 39.4); close(rounded.gate.deduction, .4); assert.equal(rounded.value, 39);
  const tied = T.scoreFromMetrics(metrics({ value: 100, ma200: 100, ma200Prior20: 100, ma50: 100, percentile: 50, volatilityPercentile: 50 }));
  assert.equal(tied.components[1].points, 0); assert.equal(tied.value, 30); assert.equal(tied.gate.active, false);
  assert.equal(T.scoreFromMetrics(metrics({ percentile: null })), null);
  assert.equal(T.scoreFromMetrics(metrics({ volatilityPercentile: Infinity })), null);
});

test('score bands use the final rounded score and remain frozen', () => {
  for (const [value, expected] of [[0, 'wait'], [39, 'wait'], [40, 'watch'], [59, 'watch'], [60, 'small'], [79, 'small'], [80, 'priority'], [100, 'priority']]) {
    const trend = value >= 40 ? 40 : 0, remaining = value - trend;
    const row = metrics({ ...(trend ? {} : { value: 100, ma200Prior20: 100, ma50: 100 }), percentile: 100 - Math.min(remaining, 40) / 40 * 100, volatilityPercentile: 100 - Math.max(remaining - 40, 0) / 20 * 100 });
    const score = T.scoreFromMetrics(row);
    assert.equal(score.value, value); assert.equal(score.band.id, expected);
  }
  assert.equal(T.scoreFromMetrics(metrics({ percentile: 100, volatilityPercentile: 2.5 })).value, 60); // 59.5 rounds only at the end.
  assert.ok(Object.isFrozen(T.scoreBands) && T.scoreBands.every(Object.isFrozen));
});

test('MA50, MA200 slope and sample volatility match independent calculations; percentiles use prior observations only', () => {
  const result = analyze(fixture(calendar('2010-01-01', '2026-10-23'))), current = result.latest;
  const average = rows => rows.reduce((n, r) => n + r.value, 0) / rows.length;
  close(current.ma50, average(result.curve.slice(-50)));
  close(current.ma200Prior20, average(result.curve.slice(-220, -20)));
  const tail = result.curve.slice(-64), returns = tail.slice(1).map((row, i) => row.value / tail[i].value - 1);
  const mean = returns.reduce((n, r) => n + r, 0) / returns.length;
  close(current.volatility63, Math.sqrt(returns.reduce((n, r) => n + (r - mean) ** 2, 0) / 62) * Math.sqrt(252) * 100);
  const prior = result.curve.slice(0, -1).filter(row => row.volatility63 !== null);
  const lower = prior.filter(row => row.volatility63 < current.volatility63).length, equal = prior.filter(row => row.volatility63 === current.volatility63).length;
  close(current.volatilityPercentile, (lower + equal / 2) / prior.length * 100);
  assert.equal(current.volatilityPercentileSamples, prior.length);
  assert.equal(result.scoring.version, 'add-score-v1');
  assert.equal(result.scoring.value, current.score);
  const previous = result.curve.at(-21);
  assert.deepEqual(result.scoring.change20, { value: current.score - previous.score, day: previous.day, previous: previous.score });
});

test('three calendar years and 600 earlier samples are both required; flat ties earn the midpoint percentile', () => {
  const days = calendar('2010-01-01', '2015-01-01'), result = analyze(fixture(days, days.map(() => 100)));
  const firstVolatility = result.curve.find(row => row.volatility63 !== null), firstVolatilityRank = result.curve.find(row => row.volatilityPercentile !== null);
  assert.ok(firstVolatilityRank.day >= P.addYears(firstVolatility.day, 3)); assert.ok(firstVolatilityRank.volatilityPercentileSamples >= 600);
  const firstScore = result.curve.find(row => row.score !== null), firstDeviation = result.curve.find(row => row.deviation !== null);
  assert.ok(firstScore.day >= P.addYears(firstDeviation.day, 3)); assert.ok(firstScore.percentileSamples >= 600);
  assert.ok(result.curve.slice(0, result.curve.indexOf(firstScore)).every(row => row.score === null));
  close(result.latest.volatilityPercentile, 50); close(result.latest.percentile, 50); assert.equal(result.scoring.value, 30);
  assert.equal(result.scoring.history.length, result.curve.filter(row => row.score !== null).length);
});

test('appending future prices preserves every previous daily score and historical evidence', () => {
  const cutoff = '2020-10-23', fullDays = calendar('2010-01-01', '2026-10-23');
  const short = analyze(fixture(fullDays.filter(day => day <= cutoff)));
  const full = fixture(fullDays), complete = analyze(full);
  assert.deepEqual(complete.scoring.history.filter(row => row.day <= cutoff), short.scoring.history);
  Object.assign(full.config, { years: 'custom', start: fullDays[0], end: cutoff });
  const historical = analyze(full, { end: cutoff });
  assert.equal(historical.status, 'available'); assert.equal(historical.historical, true);
  assert.deepEqual(historical.scoring, short.scoring);
  full.histories['test:asset'].series.filter(([day]) => day > cutoff).forEach(row => { row[1] *= 100000; });
  assert.deepEqual(analyze(full, { end: cutoff }).scoring, historical.scoring);
});

test('rerunning 100 days later recalculates with new observations, while an unchanged old feed cannot issue a current score', () => {
  const oldDays = calendar('2010-01-01', '2024-01-31'), newDay = '2024-05-10';
  assert.equal((Date.parse(newDay) - Date.parse(oldDays.at(-1))) / 86400000, 100);
  const oldInput = fixture(oldDays, oldDays.map(() => 100)), oldResult = analyze(oldInput);
  const newDays = calendar(oldDays[0], newDay), newPrices = newDays.map((_, i) => i < oldDays.length ? 100 : 100 * 1.005 ** (i - oldDays.length + 1));
  const updated = analyze(fixture(newDays, newPrices));
  assert.equal(oldResult.scoring.value, 30); assert.notEqual(updated.scoring.value, oldResult.scoring.value);
  assert.equal(updated.end, newDay); assert.equal(updated.status, 'available');
  assert.ok(updated.scoring.history.length > oldResult.scoring.history.length);
  assert.deepEqual(updated.scoring.history.filter(row => row.day <= oldResult.end), oldResult.scoring.history);
  const stale = analyze(oldInput, { today: newDay });
  assert.equal(stale.status, 'stale'); assert.equal(stale.scoring.value, null); assert.equal(stale.scoring.band, null);
  assert.equal(stale.scoring.change20, null); assert.deepEqual(stale.scoring.components, []);
  assert.match(stale.scoring.missing, /最新共同报价.*100 日/);
  assert.deepEqual(stale.scoring.history, oldResult.scoring.history);
  assert.ok(stale.scoring.evidence.horizons.every(h => h.current === null));
});

test('funding, investor costs, account strategies and simulation start do not change a same-day score', () => {
  const input = fixture(calendar('2010-01-01', '2026-10-23')), original = analyze(input).scoring;
  Object.assign(input.config, { initial: 0, monthly: 1000000, years: 1, start: '2025-10-23', initialMethod: 'ma200_hold', contributionMethod: 'dca_drawdown', transactionFee: 2, tax: { cnStockCapitalGains: 20 }, rebalance: 'month' });
  assert.deepEqual(analyze(input).scoring, original);
  input.config.positions[0].weight = 30;
  const cash = analyze(input);
  assert.equal(cash.cashWeight, 70);
  close(cash.curve[1].value, .7 + .3 * input.histories['test:asset'].series[1][1] / input.histories['test:asset'].series[0][1]);
  assert.notDeepEqual(cash.scoring.history, original.history); // Target cash is a portfolio choice, unlike account funding.
});

test('score evidence uses all four frozen bands on the same eligible monthly baseline and only mature next-close outcomes', () => {
  const result = analyze(fixture(calendar('2010-01-01', '2026-10-23')));
  assert.equal(result.scoring.evidence.validation, 'descriptive');
  for (const horizon of result.scoring.evidence.horizons) {
    assert.deepEqual(horizon.bands.map(b => b.id), T.scoreBands.map(b => b.id));
    assert.equal(horizon.bands.reduce((n, b) => n + b.n, 0), horizon.baseline.n);
    assert.equal(horizon.samples.length, horizon.baseline.n);
    assert.equal(horizon.current.id, result.scoring.band.id);
    for (const sample of horizon.samples) {
      const i = result.curve.findIndex(row => row.day === sample.signal), signal = result.curve[i];
      assert.equal(sample.score, signal.score); assert.equal(sample.scoreBand, signal.scoreBand);
      assert.equal(sample.entry, result.curve[i + 1].day);
      assert.ok(sample.exit >= P.addYears(sample.entry, horizon.years) && sample.exit <= result.end);
      assert.ok(sample.signal < result.end.slice(0, 7) + '-01');
    }
  }
  const flatDays = calendar('2010-01-01', '2026-10-23'), flat = analyze(fixture(flatDays, flatDays.map(() => 100)));
  assert.equal(flat.scoring.evidence.horizons[0].bands[3].n, 0);
  assert.equal(flat.scoring.evidence.horizons[0].bands[3].median, null);
  assert.equal(flat.scoring.evidence.assessment.status, 'insufficient');
  assert.equal(flat.scoring.evidence.assessment.high.n, 0);
});

test('evidence assessment reports observed high-vs-low differences without presenting them as validation', () => {
  const result = analyze(fixture(calendar('1990-01-01', '2026-10-23'))), { assessment, horizons } = result.scoring.evidence;
  const samples = horizons[0].samples;
  assert.equal(assessment.high.n, samples.filter(sample => sample.score >= 60).length);
  assert.equal(assessment.low.n, samples.filter(sample => sample.score < 60).length);
  close(assessment.medianDifference, assessment.high.median - assessment.low.median);
  assert.ok(assessment.high.nonOverlappingN >= 5 && assessment.low.nonOverlappingN >= 5);
  const expected = assessment.medianDifference <= 0 ? 'not_supported' : assessment.high.p10 < assessment.low.p10 || assessment.high.worstDrawdown < assessment.low.worstDrawdown ? 'mixed' : 'favorable';
  assert.equal(assessment.status, expected);
  assert.match(assessment.detail, /回溯描述，未做样本外验证/);
});

test('missing history, future endpoint, invalid input and insufficient warmup never return a live score', () => {
  const days = calendar('2026-01-01', '2026-10-23'), input = fixture(days);
  const short = analyze(input); assert.equal(short.status, 'insufficient'); assert.equal(short.scoring.value, null); assert.match(short.scoring.missing, /长期分位/);
  assert.equal(short.scoring.history.length, 0);
  const future = analyze(input, { end: '2026-10-24' }); assert.equal(future.status, 'future'); assert.equal(future.scoring.value, null);
  delete input.histories['test:asset'];
  const failed = analyze(input, { today: '2026-10-23' }); assert.equal(failed.status, 'error'); assert.equal(failed.scoring.value, null);
});
