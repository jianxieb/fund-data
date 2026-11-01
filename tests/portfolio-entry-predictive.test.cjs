const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../scripts/research_portfolio_entry_predictive.cjs');
const parent = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v1.json')));
const protocol = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v2.json')));
const portfolio = parent.portfolio, base = { annualCashRate: 0, feeRate: 0, capitalTaxRate: 0, dividendTaxRate: 0 };
const close = (a, b, eps = 1e-10) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
function days(n, start = '2010-01-01') {
  const out = []; let t = Date.parse(start);
  while (out.length < n) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10)); t += 86400000; }
  return out;
}
function market(n, variable = false, start) {
  return days(n, start).map((day, i) => ({ day, prices: variable ? [100 * Math.exp(.0004 * i + .1 * Math.sin(i / 17)), 50 * Math.exp(.0002 * i + .2 * Math.cos(i / 37))] : [100, 50] }));
}
function episode(rows, endIndex = rows.length - 1, startIndex = 0) {
  return { startIndex, endIndex, start: rows[startIndex].day, end: rows[endIndex].day, anniversary: rows[endIndex].day, years: 1, partition: 'development' };
}
function predictions(rows, offset = 5) {
  return rows.map((r, i) => ({ day: r.day, featureDay: i ? rows[i - 1].day : '2009-12-31', predictedY: offset ? .01 : -.01, offset, trainingN: 756 }));
}
const candidate = { id: R.MODEL_ID };
function simulate(rows, rule = candidate, scenario = base, preds = predictions(rows), ep = episode(rows)) {
  return R.simulateEpisode(rows, ep, rule, scenario, portfolio, preds, 100, true);
}

test('one-dimensional OLS and average-loss ridge match hand calculations with unpenalized intercept', () => {
  const data = [{ features: [-1], y: -1 }, { features: [1], y: 3 }];
  const ols = R.fitRidge(data, 0), ridge = R.fitRidge(data, 1);
  assert.deepEqual(ols.featureMeans, [0]); assert.deepEqual(ols.featureStd, [1]);
  close(ols.trainingMeanY, 1); close(ols.beta[0], 2); close(R.predictFit(ols, [3]), 7);
  close(ridge.beta[0], 1); close(R.predictFit(ridge, [3]), 4);
  const replicated = R.fitRidge(Array.from({ length: 378 }, () => data).flat(), 1);
  close(replicated.beta[0], ridge.beta[0]); close(replicated.trainingMeanY, 1);
});

test('population standard deviation, collinear predictors and zero variance have defined behavior', () => {
  const data = [{ features: [1, 7], y: 2 }, { features: [3, 7], y: 6 }], fit = R.fitRidge(data);
  assert.deepEqual(fit.featureStd, [1, 0]); close(fit.beta[0], 1); close(fit.beta[1], 0);
  close(R.predictFit(fit, [2, 1e8]), 4);
  const collinear = R.fitRidge([{ features: [-1, -1], y: -2 }, { features: [1, 1], y: 2 }]);
  close(collinear.beta[0], 2 / 3); close(collinear.beta[1], 2 / 3);
  const constant = R.fitRidge([{ features: [1, 1], y: 2 }, { features: [1, 1], y: 4 }]);
  close(R.predictFit(constant, [1, 1]), 3); assert.deepEqual(constant.beta, [0, 0]);
});

test('inclusive MA200, all-history peak, five and twenty-one returns and sample volatility are explicit', () => {
  const rows = market(250, true), out = R.buildFeatures(rows, portfolio);
  assert.equal(out[198].features[0], null); assert.ok(Number.isFinite(out[199].features[0]));
  const i = 249, values = out.map(r => r.value), avg = values.slice(i - 199, i + 1).reduce((a, b) => a + b) / 200;
  close(out[i].features[0], values[i] / avg - 1); close(out[i].features[1], values[i] / Math.max(...values) - 1);
  close(out[i].features[2], values[i] / values[i - 5] - 1); close(out[i].features[3], values[i] / values[i - 21] - 1);
  const ret = values.slice(i - 20, i + 1).map((v, j) => v / values[i - 21 + j] - 1), mu = ret.reduce((a, b) => a + b) / 21;
  close(out[i].features[4], Math.sqrt(ret.reduce((a, b) => a + (b - mu) ** 2, 0) / 20));
  close(values[1], .4 + .3 * rows[1].prices[0] / rows[0].prices[0] + .3 * rows[1].prices[1] / rows[0].prices[1]);
});

test('label uses the prior feature and the actual entry-to-fifth-close product prices including both fees', () => {
  const rows = market(210, true), features = R.buildFeatures(rows, portfolio), labels = R.buildLabels(rows, features, portfolio);
  assert.equal(labels[199], null); const row = labels[200];
  assert.deepEqual(row.features, features[199].features); assert.equal(row.featureDay, rows[199].day);
  assert.equal(row.entryDay, rows[200].day); assert.equal(row.exitDay, rows[205].day);
  close(row.y, .999 / 1.001 * (1 - .5 * rows[205].prices[0] / rows[200].prices[0] - .5 * rows[205].prices[1] / rows[200].prices[1]));
  assert.equal(labels[205], null);
});

test('756 mature labels and current execution price exclusion hold at the exact first prediction boundary', () => {
  const rows = market(970, true), out = R.buildPredictions(rows, portfolio);
  assert.equal(out.predictions[960].trainingN, 755); assert.equal(out.predictions[960].predictedY, null);
  const p = out.predictions[961]; assert.equal(p.trainingN, 756); assert.equal(p.featureDay, rows[960].day);
  assert.equal(p.latestTrainingExit, rows[960].day); assert.equal(p.executionDay, rows[961].day);
  const direct = R.fitRidge(out.labels.slice(200, 956));
  close(p.predictedY, R.predictFit(direct, out.features[960].features));
  const changed = structuredClone(rows); changed[961].prices = [1e8, .0001];
  assert.deepEqual(R.buildPredictions(changed, portfolio).predictions[961], p);
});

test('appending or mutating every future observation preserves the complete earlier prediction trace', () => {
  const rows = market(1150, true), cutoff = 1040, full = R.buildPredictions(rows, portfolio);
  const short = R.buildPredictions(rows.slice(0, cutoff + 1), portfolio);
  assert.deepEqual(short.predictions, full.predictions.slice(0, cutoff + 1));
  const altered = structuredClone(rows); for (let i = cutoff + 1; i < altered.length; i++) altered[i].prices = [1e5 * (1 + i), .000001];
  const other = R.buildPredictions(altered, portfolio);
  assert.deepEqual(other.predictions.slice(0, cutoff + 1), short.predictions);
});

test('flat prices predict zero and strict positive threshold does not become an inclusive trigger', () => {
  const out = R.buildPredictions(market(980), portfolio);
  assert.ok(out.predictions.slice(961).every(p => p.predictedY === 0 && p.offset === 0));
  assert.equal(R.decisionOffset(0), 0); assert.equal(R.decisionOffset(1e-12), 0);
  assert.equal(R.decisionOffset(1e-12 + 1e-15), 5); assert.equal(R.decisionOffset(-1e-8), 0);
});

test('each arrival locks its five-session delay even when all later predictions change', () => {
  const rows = market(10), preds = predictions(rows); for (let i = 1; i < preds.length; i++) { preds[i].predictedY = -1; preds[i].offset = 0; }
  const result = simulate(rows, candidate, base, preds), buys = result.trades.filter(t => t.side === 'buy');
  assert.ok(buys.every(t => t.day === rows[5].day && t.offset === 5 && t.predictedY === .01));
  assert.equal(result.curve[4].pendingCash, 60); assert.equal(result.curve[5].pendingCash, 0); close(result.terminalWealth, 100);
});

test('individual actual shares produce hand-calculated rising and falling path terminal wealth', () => {
  const rows = market(8); rows.forEach((r, i) => { r.prices = i >= 5 ? [50, 200] : [100, 100]; }); rows[7].prices = [100, 100];
  const delay = simulate(rows), immediate = simulate(rows, { id: 'immediate', offset: 0 });
  close(delay.terminalWealth, 115); close(immediate.terminalWealth, 100);
  assert.deepEqual(delay.trades.filter(t => t.side === 'buy').map(t => t.units), [.6, .15]);
  close(delay.curve[0].strategicCash, 40); close(delay.curve[0].pendingCash, 60);
});

test('pending cash, waiting interest and terminal-date double fees reconcile exact budgets', () => {
  const rows = market(6), fee = .001, paid = simulate(rows, candidate, { ...base, feeRate: fee });
  close(paid.terminalWealth, 40 + 60 * .999 / 1.001); close(paid.fees, 100 - paid.terminalWealth);
  assert.deepEqual(paid.trades.map(t => t.side), ['buy', 'buy', 'sell', 'sell']); assert.ok(paid.trades.every(t => t.day === rows[5].day));
  const early = simulate(rows, candidate, { ...base, annualCashRate: .02 }, predictions(rows), episode(rows, 4));
  const factor = 1.02 ** ((Date.parse(rows[4].day) - Date.parse(rows[0].day)) / 86400000 / 365.2425);
  close(early.terminalWealth, 100 * factor); close(early.pendingCash, 60 * factor); close(early.interest, 100 * (factor - 1));
  assert.equal(early.trades.length, 0); assert.equal(early.pendingLots, 1);
});

test('all benchmarks receive identical monthly deposits including thirteen allowed by the anniversary boundary', () => {
  const rows = market(263, false, '2023-01-03'), end = rows.findIndex(r => r.day === '2024-01-03'), ep = episode(rows, end);
  const all = [candidate, ...protocol.benchmarks].map(rule => simulate(rows, rule, base, predictions(rows), ep));
  assert.equal(all[0].externalFlows.length, 13); assert.equal(all[0].contributed, 1300);
  for (const a of all) { assert.deepEqual(a.externalFlows, all[0].externalFlows); close(a.terminalWealth, 1300); }
});

test('all stress scenarios use the same base prediction action and fixed buying dates', () => {
  const rows = market(100, true), preds = predictions(rows); preds.forEach((p, i) => { p.offset = i % 2 ? 5 : 0; p.predictedY = p.offset ? .01 : -.01; });
  const accounts = parent.scenarios.map(s => simulate(rows, candidate, s, preds));
  const actions = a => a.trades.filter(t => t.side === 'buy').map(({ day, id, arrivalDay, offset, predictedY }) => ({ day, id, arrivalDay, offset, predictedY }));
  for (const a of accounts) assert.deepEqual(actions(a), actions(accounts[0]));
  assert.notEqual(accounts[0].terminalWealth, accounts[1].terminalWealth); assert.notEqual(accounts[0].fees, accounts[2].fees);
});

test('account future price changes do not change earlier orders or cash flow units', () => {
  const rows = market(100, true), preds = predictions(rows), cutoff = 40, full = simulate(rows, candidate, base, preds);
  const changed = structuredClone(rows); for (let i = cutoff + 1; i < rows.length; i++) changed[i].prices = [.01, 1e6];
  const other = simulate(changed, candidate, base, preds);
  assert.deepEqual(other.trades.filter(t => t.day <= rows[cutoff].day), full.trades.filter(t => t.day <= rows[cutoff].day));
  assert.deepEqual(other.curve.slice(0, cutoff + 1), full.curve.slice(0, cutoff + 1));
});

test('prediction warmup excludes the same complete episodes from candidate and all benchmarks', () => {
  const rows = market(2000), model = R.buildPredictions(rows, portfolio), coverage = R.eligibleEpisodes(rows, parent, model.predictions);
  assert.ok(coverage.excluded.predictionWarmupEpisodes > 0); assert.ok(coverage.episodes.length > 0);
  for (const ep of coverage.episodes) assert.ok(model.predictions[ep.startIndex].trainingN >= 756);
  for (const day of coverage.predictionWarmupStarts) assert.ok(day < model.predictions[961].day);
});

test('short-horizon diagnostics use unique month starts and purge labels crossing the partition end', () => {
  const rows = market(1100, true), model = R.buildPredictions(rows, portfolio), boundary = rows[1045].day;
  const partitions = [{ id: 'early', start: null, end: boundary }, { id: 'late', start: rows[1046].day, end: null }];
  const out = R.predictionDiagnostics(rows, model.predictions, model.labels, partitions);
  for (const segment of out) {
    assert.equal(segment.distinctMonthDecisions, new Set(segment.dates.map(d => d.day.slice(0, 7))).size);
    assert.equal(segment.availableMonthDecisions, segment.distinctMonthDecisions + segment.excludedUnmaturedOrCrossing);
    for (const row of segment.dates) { assert.ok(row.latestTrainingExit < row.day); assert.ok(row.labelExit > row.day); if (segment.partition === 'early') assert.ok(row.labelExit <= boundary); }
  }
  const lastMonthIndex = rows.findIndex(r => r.day.slice(0, 7) === rows.at(-1).day.slice(0, 7));
  const short = rows.slice(0, lastMonthIndex + 2), sm = R.buildPredictions(short, portfolio), d = R.predictionDiagnostics(short, sm.predictions, sm.labels, [{ id: 'all' }])[0];
  assert.equal(d.excludedUnmaturedOrCrossing, 1);
});

test('MAE MSE and reference-mean R2 use the same monthly decisions and fraction units', () => {
  const rows = [{ day: 'a', predictedY: 2, actualY: 1, referenceForecast: 0, offset: 5 }, { day: 'b', predictedY: 1, actualY: 3, referenceForecast: 0, offset: 0 }];
  const result = R.diagnosticSummary(rows); close(result.MAE, 1.5); close(result.MSE, 2.5); close(result.referenceMAE, 2); close(result.referenceMSE, 5); close(result.R2, .5);
  close(result.meanRealizedWaitingAdvantageOfDelayedDecisions, 1); assert.equal(result.delayedMonthDecisions, 1);
  assert.equal(R.diagnosticSummary([]).R2, null); assert.equal(R.diagnosticSummary([{ predictedY: 0, actualY: 0, referenceForecast: 0, offset: 0 }]).R2, null);
});

test('failed development cannot be rescued by perfect later account or short-term prediction results', () => {
  const good = { meanDeltaPp: 2, medianDeltaPp: 2, positiveDeltaShare: .8, p10AccountReturnDifferencePp: 1, medianMaxDrawdownDifferencePp: 1, worstMaxDrawdownDifferencePp: 1,
    meanInterval: { status: 'descriptive', lower: .5, upper: 4 } };
  const results = parent.episodes.partitions.flatMap(p => parent.scenarios.map(s => ({ partition: p.id, scenario: s.id, horizonYears: 1,
    rules: [{ id: R.MODEL_ID, vsImmediate: p.id === 'development' ? { ...good, medianDeltaPp: .4 } : good, vsFixedDelay5: good, vsThreeTranches: good }] })));
  const result = R.confirm(results, parent);
  assert.equal(result.development.passed, false); assert.equal(result.eligibleForConfirmation, false); assert.equal(result.historicalConfirmationPassed, false); assert.equal(result.integrationPassed, false);
  assert.ok(result.confirmation.every(r => r.passed && r.diagnosticOnly)); assert.equal(result.status, 'development_failed_research_only');
  results[0].rules[0].vsImmediate = good;
  const passed = R.confirm(results, parent); assert.equal(passed.historicalConfirmationPassed, true); assert.equal(passed.integrationPassed, false);
});

test('a nonpositive or insufficient-block later interval fails despite positive mean and all economic gates', () => {
  const good = { meanDeltaPp: 2, medianDeltaPp: 2, positiveDeltaShare: .8, p10AccountReturnDifferencePp: 1, medianMaxDrawdownDifferencePp: 1, worstMaxDrawdownDifferencePp: 1,
    meanInterval: { status: 'insufficient_blocks', lower: 2, upper: 2 } };
  const results = parent.episodes.partitions.flatMap(p => parent.scenarios.map(s => ({ partition: p.id, scenario: s.id, horizonYears: 1,
    rules: [{ id: R.MODEL_ID, vsImmediate: good, vsFixedDelay5: good, vsThreeTranches: good }] })));
  assert.equal(R.confirm(results, parent).historicalConfirmationPassed, false);
});
