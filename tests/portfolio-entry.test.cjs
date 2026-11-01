const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/portfolio-entry-model.js');
const T = require('../assets/portfolio-timing-model.js');
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function samples(count = 36) {
  return Array.from({ length: count }, (_, i) => {
    const year = 2000 + Math.floor(i / 12), month = String(i % 12 + 1).padStart(2, '0');
    return { signal: `${year}-${month}-01`, entry: `${year}-${month}-02`, exit: `${year + 1}-${month}-02`, percentile: i, return: i, drawdown: -(i + 1) / 2 };
  });
}
function calendar(start, end) {
  const days = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
    const date = new Date(t);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days.push(date.toISOString().slice(0, 10));
  }
  return days;
}
function timing(end = '2026-10-23') {
  const days = calendar('2010-01-01', end), id = 'test:asset';
  const history = { schemaVersion: 1, id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1),
    series: days.map((day, i) => [day, Math.exp(i / 2000 + .3 * Math.sin(i / 90))]) };
  return T.analyze({ catalog: { assets: [{ id, name: '测试标的', status: 'available', currency: 'CNY' }] }, histories: { [id]: history },
    config: { positions: [{ id, weight: 100 }], currency: 'CNY', initial: 100000, monthly: 8000, years: 'common', transactionFee: 0, feeBasis: 'net', rebalance: 'none' } }, { today: end });
}

test('hand calculation learns the selected outcomes ranks without imposing a direction on the feature', () => {
  const training = samples(), state = { day: '2005-01-01', percentile: 0 };
  const low = E.predict(state, training), high = E.predict({ ...state, percentile: 35 }, training);
  assert.equal(low.trainingN, 36); assert.equal(low.neighborN, 24);
  assert.deepEqual(low.neighbors.map(row => row.return), Array.from({ length: 24 }, (_, i) => i));
  close(low.neighbors[0].rank, .5 / 36 * 100); close(low.neighbors[23].rank, 23.5 / 36 * 100);
  close(low.value, 100 / 3); close(high.value, 200 / 3);
  close(low.matched.median, 11.5); close(low.baseline.median, 17.5);
  assert.deepEqual(low.distanceRange, { min: 0, max: 23 }); assert.equal(low.latestTrainingExit, '2003-12-02');
  const reversed = training.map(row => ({ ...row, return: 35 - row.return }));
  close(E.predict(state, reversed).value, 200 / 3);
  assert.deepEqual(E.predict({ ...state, ma200: 100, ma200Prior20: 200, ma50: 200, value: 1, scoreGate: true }, training), low);
  assert.notEqual(low.value, Math.round(low.value));
});

test('every distance tie at the 24th boundary is included; identical states or identical outcomes yield 50', () => {
  const tied = samples().map((row, i) => ({ ...row, percentile: i < 23 ? i : i < 26 ? 23 : i + 20 }));
  const result = E.predict({ day: '2005-01-01', percentile: 0 }, tied);
  assert.equal(result.neighborN, 26); assert.equal(result.distanceRange.max, 23);
  assert.equal(result.neighbors.filter(row => row.distance === 23).length, 3);
  const flatStates = samples().map(row => ({ ...row, percentile: 50 }));
  const flat = E.predict({ day: '2005-01-01', percentile: 70 }, flatStates);
  assert.equal(flat.neighborN, 36); assert.equal(flat.value, 50);
  const flatReturns = samples().map(row => ({ ...row, return: 7 }));
  const equal = E.predict({ day: '2005-01-01', percentile: 0 }, flatReturns);
  assert.equal(equal.value, 50); assert.ok(equal.neighbors.every(row => row.rank === 50));
  assert.deepEqual(E.predict({ day: '2005-01-01', percentile: 0 }, tied.slice().reverse()), result);
});

test('minimum training counts distinct completed months with one full year mature at the observation close', () => {
  const training = samples();
  const before = E.predict({ day: '2003-12-01', percentile: 0 }, training);
  assert.equal(before.value, null); assert.equal(before.trainingN, 35); assert.match(before.missing, /35.*至少需要36/);
  assert.notEqual(E.predict({ day: '2003-12-02', percentile: 0 }, training).value, null);
  const duplicated = [...training.slice(0, 35), ...training.slice(0, 35)];
  assert.equal(E.predict({ day: '2005-01-01', percentile: 0 }, duplicated).trainingN, 35);
  const incomplete = training.map((row, i) => i === 35 ? { ...row, exit: '2003-12-01' } : row);
  assert.equal(E.predict({ day: '2005-01-01', percentile: 0 }, incomplete).value, null);
  const distantExit = training.map((row, i) => i === 35 ? { ...row, exit: '2003-12-17' } : row);
  assert.equal(E.predict({ day: '2005-01-01', percentile: 0 }, distantExit).value, null);
  assert.equal(E.predict({ day: '2005-01-01', percentile: null }, training).value, null);
  assert.match(E.predict({ day: '2005-02-30', percentile: 50 }, training).missing, /观察日期/);
});

test('unmatured future labels and future signals cannot change a historical prediction', () => {
  const training = samples(), state = { day: '2005-01-01', percentile: 0 }, original = E.predict(state, training);
  const future = samples(84).slice(36).map(row => ({ ...row, percentile: 0, return: 100000 }));
  const onlyUnmatured = future.filter(row => row.exit > state.day);
  assert.deepEqual(E.predict(state, [...training, ...onlyUnmatured]), original);
  onlyUnmatured.forEach(row => { row.return = -90; row.drawdown = -99; });
  assert.deepEqual(E.predict(state, [...training, ...onlyUnmatured]), original);
  assert.ok(original.neighbors.every(row => row.exit <= original.asOf && row.signal < original.asOf));
});

test('summaries calculate matched risk on the same windows and count nonoverlap chronologically', () => {
  const rows = [
    { entry: '2000-01-01', exit: '2001-01-01', return: -5, drawdown: -40 },
    { entry: '2000-06-01', exit: '2001-06-01', return: 0, drawdown: -30 },
    { entry: '2001-01-01', exit: '2002-01-01', return: 10, drawdown: -20 },
    { entry: '2001-01-02', exit: '2002-01-02', return: 15, drawdown: -10 }
  ];
  const result = E.summarize(rows.slice().reverse());
  assert.equal(result.n, 4); assert.equal(result.median, 5); close(result.p10, -3.5);
  assert.equal(result.medianDrawdown, -25); assert.equal(result.p10Drawdown, -37); assert.equal(result.worstDrawdown, -40);
  assert.equal(result.positiveRate, 50); assert.equal(result.nonOverlappingN, 2);
  const empty = E.summarize([]); assert.equal(empty.n, 0); assert.equal(empty.median, null); assert.equal(empty.medianDrawdown, null);
});

test('Spearman handles positive, negative and tied ranks; constant data has no correlation', () => {
  const rows = [{ value: 10, return: 1 }, { value: 20, return: 2 }, { value: 30, return: 3 }];
  close(E.rankingCorrelation(rows), 1);
  close(E.rankingCorrelation(rows.map(row => ({ ...row, return: -row.return }))), -1);
  const tied = [{ value: 1, return: 1 }, { value: 1, return: 2 }, { value: 2, return: 3 }];
  close(E.rankingCorrelation(tied), Math.sqrt(3) / 2);
  assert.equal(E.rankingCorrelation(rows.map(row => ({ ...row, value: 50 }))), null);
  assert.equal(E.rankingCorrelation(rows.map(row => ({ ...row, return: 0 }))), null);
  assert.equal(E.rankingCorrelation(rows.slice(0, 1)), null);
});

test('walk-forward errors use the frozen prediction and baseline medians, same samples, and fixed raw-score bands', () => {
  const history = [
    { day: '2019-12-30', value: 39.9, matched: { median: 6 }, baseline: { median: 4 }, actual: { entry: '2020-01-02', exit: '2021-01-02', return: 10, drawdown: -10 } },
    { day: '2021-12-30', value: 40, matched: { median: 18 }, baseline: { median: 15 }, actual: { entry: '2022-01-02', exit: '2023-01-02', return: 20, drawdown: -20 } },
    { day: '2023-12-29', value: 60, matched: { median: 26 }, baseline: { median: 20 }, actual: { entry: '2024-01-02', exit: '2025-01-02', return: 30, drawdown: -30 } },
    { day: '2025-12-31', value: 65, matched: { median: 10 }, baseline: { median: 5 }, actual: null }
  ];
  const result = E.walkForward(history);
  assert.equal(result.validation, 'historical_replay'); assert.equal(result.genuineUnseenHoldout, false);
  assert.equal(result.predictionN, 4); assert.equal(result.pendingN, 1); assert.equal(result.errorN, 3);
  close(result.predictionMAE, 10 / 3); close(result.baselineMAE, 7); close(result.rankingCorrelation, 1);
  assert.deepEqual(result.bands.map(row => row.n), [1, 1, 1]);
  assert.deepEqual(result.periods.map(row => row.baseline.n), [1, 1, 1]);
  assert.deepEqual(result.periods.map(row => row.predictionMAE), [4, 2, 4]);
  assert.equal(result.highVsRest.high.n, 1); assert.equal(result.highVsRest.rest.n, 2);
  assert.equal(result.highVsRest.medianDifference, 15); assert.equal(result.highVsRest.medianDrawdownDifference, -15);
  assert.equal(E.scoreBand(59.9999), 'middle'); assert.equal(E.scoreBand(60), 'high');
});

test('analysis derives state features from signal curves and trains each monthly prediction only on then-mature outcomes', () => {
  const source = timing(), result = E.analyze(source);
  assert.equal(result.status, 'available'); assert.equal(result.usage, 'experimental_history_rank');
  assert.equal(result.method.designDate, '2026-11-01'); assert.equal(result.method.genuineUnseenHoldout, false);
  assert.equal(result.asOf, source.end); assert.ok(result.value >= 0 && result.value <= 100);
  const curve = new Map(source.curve.map(row => [row.day, row]));
  assert.ok(result.history.some(row => row.value === null) && result.history.some(row => row.value !== null));
  for (const prediction of result.history.filter(row => row.value !== null)) {
    assert.ok(prediction.trainingN >= 36); assert.ok(prediction.neighborN >= 24);
    assert.ok(prediction.latestTrainingExit <= prediction.day);
    for (const sample of prediction.neighbors) {
      assert.ok(sample.exit <= prediction.day && sample.signal < prediction.day);
      assert.equal(sample.percentile, curve.get(sample.signal).percentile);
    }
  }
  const edited = structuredClone(source);
  edited.horizons[0].samples.forEach(row => { row.percentile = 100 - row.percentile; });
  assert.deepEqual(E.analyze(edited), result);
  assert.equal(result.walkForward.baseline.n, result.history.filter(row => row.value !== null && row.actual).length);
  assert.equal(result.walkForward.bands.reduce((total, row) => total + row.n, 0), result.walkForward.baseline.n);
  assert.equal(result.walkForward.errorN, result.walkForward.baseline.n);
});

test('future append leaves prior predictions unchanged, while actual outcomes appear only after maturity', () => {
  const earlier = E.analyze(timing('2020-10-23')), later = E.analyze(timing());
  const laterByDay = new Map(later.history.map(row => [row.day, row]));
  for (const row of earlier.history) {
    const { actual, ...prediction } = row, { actual: laterActual, ...laterPrediction } = laterByDay.get(row.day);
    assert.deepEqual(laterPrediction, prediction);
    if (actual) assert.deepEqual(laterActual, actual);
  }
  assert.ok(earlier.history.some(row => row.value !== null && !row.actual && laterByDay.get(row.day).actual));
});

test('an explicit earlier cutoff isolates both current prediction and monthly replay from future curves and outcomes', () => {
  const cutoff = '2020-10-23', short = E.analyze(timing(cutoff)), long = timing();
  long.end = cutoff; long.today = cutoff;
  assert.deepEqual(E.analyze(long), short);
  long.curve.filter(row => row.day > cutoff).forEach(row => { row.percentile = 100; });
  long.horizons[0].samples.filter(row => row.exit > cutoff).forEach(row => { row.return = 1e10; row.drawdown = -99; });
  assert.deepEqual(E.analyze(long), short);
});

test('monthly replay never invents the final observation of an unfinished month or uses a future month-end', () => {
  const source = timing(), bad = structuredClone(source), cutoff = '2020-06-15';
  bad.monthly.push(bad.curve.find(row => row.day === '2020-06-01'), bad.latest, bad.monthly[100]);
  const original = E.analyze(source), added = E.analyze(bad);
  assert.deepEqual(added.history, original.history);
  bad.end = cutoff; bad.today = cutoff;
  const limited = E.analyze(bad);
  assert.equal(limited.asOf, cutoff);
  assert.ok(limited.history.every(row => row.day < '2020-06-01'));
  assert.ok(limited.neighbors.every(row => row.exit <= cutoff));
});

test('stale, error and future statuses disable the current value while preserving dated replay', () => {
  const source = timing(), good = E.analyze(source);
  for (const status of ['stale', 'error', 'future']) {
    const result = E.analyze({ ...source, status, missing: '测试行情不可用于今天' });
    assert.equal(result.status, status); assert.equal(result.value, null); assert.equal(result.band, null);
    assert.equal(result.missing, '测试行情不可用于今天'); assert.deepEqual(result.history, good.history);
  }
  assert.equal(E.analyze({ status: 'error', missing: '缺行情' }).value, null);
  const small = E.analyze(timing('2016-10-23'));
  assert.equal(small.status, 'insufficient'); assert.equal(small.value, null); assert.match(small.missing, /至少需要36/);
});
