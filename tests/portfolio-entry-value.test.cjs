const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const R = require('../scripts/research_portfolio_entry_value.cjs');
const V2 = require('../scripts/research_portfolio_entry_predictive.cjs');
const S = require('../scripts/research_portfolio_entry_scope.cjs');
const P = require('../assets/portfolio-model.js');
const parent = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v1.json')));
const protocol = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-value-protocol-v3.json')));
const portfolio = parent.portfolio, config = protocol.selectionAndConfirmation, modelRule = { id: R.MODEL_ID };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function market(start = '2010-01-01', end = '2016-12-31', variable = false) {
  const rows = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) { const d = new Date(t), i = rows.length;
    if (![0, 6].includes(d.getUTCDay())) rows.push({ day: d.toISOString().slice(0, 10), prices: variable ? [100 * Math.exp(.0003 * i + .12 * Math.sin(i / 23)), 50 * Math.exp(.0005 * i + .1 * Math.cos(i / 37))] : [100, 100] }); }
  return rows;
}
const features = rows => rows.map((r, i) => ({ day: r.day, features: [.01 * i, -.1, .02, .03, .04] }));
function syntheticPreds(rows, delay = true) {
  return rows.map((row, i) => ({ day: row.day, featureDay: i ? rows[i - 1].day : null, labelHoldingYears: 1, trainingN: i ? 756 : 0,
    latestTrainingExit: i ? rows[i - 1].day : null, trainingPoolSha256: 'synthetic_mature_pool', predictedY: i ? delay ? .01 : -.01 : null,
    predictedFullDepositBps: delay ? 100 : -100, trainingMeanY: 0, offset: i ? delay ? 5 : 0 : null }));
}
function episode(rows, start = 1, end = rows.length - 1) {
  return { evaluation: 'equal_age_lot', years: 1, partition: 'all', startIndex: start, start: rows[start].day, endIndex: end, end: rows[end].day,
    lastFundingDay: rows[start].day, anniversary: rows[end].day, contributed: 100, depositCount: 1, fundingPlan: [{ index: start, day: rows[start].day, amount: 100 }] };
}
function account(rows, ep, rule = modelRule, prediction = syntheticPreds(rows), scenario = parent.scenarios[0]) { return R.simulateFundingPlan(rows, ep, rule, scenario, portfolio, prediction, true); }

test('annual full-deposit labels match flat, falling and rising hand calculations with original 0.3 weights', () => {
  const rows = market('2020-01-01', '2021-02-01'), s = 1, f = features(rows);
  close(R.buildYearLabels(rows, f, portfolio, 0)[s].y, 0);
  const down = structuredClone(rows); down[s + 5].prices = [50, 50]; close(R.buildYearLabels(down, f, portfolio, 0)[s].y, .6);
  const up = structuredClone(rows); up[s + 5].prices = [200, 200]; close(R.buildYearLabels(up, f, portfolio, 0)[s].y, -.3);
  close(R.buildYearLabels(down, f, portfolio)[s].y, .6 * .999 / 1.001);
  assert.notEqual(R.buildYearLabels(down, f, portfolio, 0)[s].y, 1);
});

test('basket annual value can have the opposite sign from the fifth-session liquidation label', () => {
  const rows = market('2020-01-01', '2021-02-01'), f = features(rows), s = 1;
  const H = R.buildYearLabels(rows, f, portfolio, 0)[s].exitIndex;
  rows[s + 5].prices = [50, 200]; rows[H].prices = [400, 50];
  const year = R.buildYearLabels(rows, f, portfolio, 0)[s], short = V2.buildLabels(rows, f, portfolio, 0)[s];
  close(year.y, 1.125); close(short.y, -.25); assert.equal(year.featureDay, rows[s - 1].day);
  const ep = episode(rows, s, H), zeroFee = { ...parent.scenarios[0], feeRate: 0 };
  const a = account(rows, ep, modelRule, syntheticPreds(rows), zeroFee), b = account(rows, ep, protocol.benchmarks[0], syntheticPreds(rows), zeroFee);
  close(a.terminalWealth, 287.5); close(b.terminalWealth, 175); close((a.terminalWealth - b.terminalWealth) / 100, year.y);
});

test('year endpoints are calendar anniversaries, including leap clamp and first common close', () => {
  const rows = market('2024-02-01', '2025-03-31'), s = rows.findIndex(r => r.day === '2024-02-29'), label = R.buildYearLabels(rows, features(rows), portfolio)[s];
  assert.equal(label.anniversary, '2025-02-28'); assert.equal(label.exitDay, '2025-02-28');
  assert.ok(label.exitIndex - s !== 252); assert.ok(label.exitIndex >= s + 5);
  const shifted = market('2020-01-01', '2021-02-01'), sl = R.buildYearLabels(shifted, features(shifted), portfolio)[1];
  assert.equal(sl.anniversary, '2021-01-02'); assert.equal(sl.exitDay, '2021-01-04');
});

test('unobserved or excessively late annual outcomes and incomplete features do not create labels', () => {
  const rows = market('2020-01-01', '2021-01-31'), f = features(rows), full = R.buildLabelData(rows, f, portfolio);
  assert.equal(full.labels.at(-1), null); assert.ok(full.excluded.year_terminal_not_observed > 0);
  const absent = rows.filter(r => r.day < '2021-01-01' || r.day >= '2021-01-25'), result = R.buildLabelData(absent, features(absent), portfolio);
  assert.equal(result.labels[1], null); assert.ok(result.excluded.year_terminal_more_than_14_days_late > 0);
  const bad = structuredClone(f); bad[0].features[0] = null;
  assert.equal(R.buildYearLabels(rows, bad, portfolio)[1], null);
});

test('H=t-1 labels enter together in entry order, while H=t remains excluded and pool hashes bind the prefix', () => {
  const rows = market('2020-01-01', '2020-01-15'), f = features(rows), labels = rows.map(() => null);
  const event = (entryIndex, exitIndex, y) => ({ entryIndex, entryDay: rows[entryIndex].day, featureDay: rows[entryIndex - 1].day,
    exitIndex, exitDay: rows[exitIndex].day, anniversary: rows[exitIndex].day, features: f[entryIndex - 1].features, y });
  labels[2] = event(2, 6, 2); labels[1] = event(1, 6, 1); labels[3] = event(3, 7, 3);
  const out = R.trainPredictions(rows, f, labels);
  assert.deepEqual(out.maturityQueue.map(l => l.entryIndex), [1, 2, 3]);
  assert.equal(out.predictions[6].trainingN, 0); assert.equal(out.predictions[7].trainingN, 2); assert.equal(out.predictions[7].newlyMatureLabels, 2);
  assert.equal(out.predictions[7].latestTrainingExit, rows[6].day); assert.equal(out.predictions[8].trainingN, 3);
  let expected = hash(''); for (const label of out.maturityQueue.slice(0, 2)) expected = hash(expected + '\n' + JSON.stringify(label));
  assert.equal(out.predictions[7].trainingPoolSha256, expected);
});

test('756 means mature one-year labels, not five-session outcomes; ridge uses exactly the mature pool', () => {
  const rows = market(undefined, undefined, true), out = R.buildPredictions(rows, portfolio), first = out.predictions.findIndex(p => p.predictedY !== null);
  assert.ok(first > 961); assert.equal(out.predictions[first].trainingN, 756); assert.equal(out.predictions[first - 1].trainingN, 755);
  const matured = out.maturityQueue.filter(l => l.exitIndex < first); assert.equal(matured.length, 756);
  const fit = V2.fitRidge(matured), p = out.predictions[first];
  close(p.predictedY, V2.predictFit(fit, out.features[first - 1].features), 1e-12);
  assert.ok(matured.every(l => l.exitDay <= p.featureDay)); assert.equal(p.labelHoldingYears, 1);
  close(p.predictedFullDepositBps, 10000 * p.predictedY);
});

test('truncation, append and changes to current/future prices cannot change past or current predictions', () => {
  const rows = market(undefined, undefined, true), out = R.buildPredictions(rows, portfolio), cutoff = 1400;
  const short = R.buildPredictions(rows.slice(0, cutoff + 1), portfolio);
  assert.deepEqual(short.predictions, out.predictions.slice(0, cutoff + 1));
  const changed = structuredClone(rows); for (let i = cutoff; i < changed.length; i++) changed[i].prices = [1e5 * (i + 1), .001 * (i + 1)];
  const modified = R.buildPredictions(changed, portfolio);
  assert.deepEqual(modified.predictions.slice(0, cutoff + 1), out.predictions.slice(0, cutoff + 1));
  assert.notDeepEqual(modified.predictions[cutoff + 1], out.predictions[cutoff + 1]);
});

test('flat full history predicts zero and never delays, including zero-variance features', () => {
  const out = R.buildPredictions(market(), portfolio), available = out.predictions.filter(p => p.predictedY !== null);
  assert.ok(available.length); assert.ok(available.every(p => p.predictedY === 0 && p.offset === 0));
});

test('actual annual account delta equals 100*action*y and fixed-five-day delta equals 100*y', () => {
  const rows = market('2020-01-01', '2021-04-30', true), labels = R.buildYearLabels(rows, features(rows), portfolio), s = 1, ep = episode(rows, s, labels[s].exitIndex);
  const immediate = account(rows, ep, protocol.benchmarks[0]), delayed = account(rows, ep), fixed = account(rows, ep, protocol.benchmarks[1]);
  close(delayed.terminalWealth - immediate.terminalWealth, 100 * labels[s].y); close(fixed.terminalWealth, delayed.terminalWealth);
  const noAction = account(rows, ep, modelRule, syntheticPreds(rows, false)); close(noAction.terminalWealth, immediate.terminalWealth);
  assert.ok(delayed.trades.filter(t => t.side === 'buy').every(t => t.reason === 'frozen_year1_value_prediction' && t.labelHoldingYears === 1));
});

test('annual provenance is required and an arrival action stays frozen while predictions change', () => {
  const rows = market('2020-01-01', '2020-01-31'), ps = syntheticPreds(rows), ep = episode(rows);
  for (let i = 2; i < ps.length; i++) { ps[i].offset = 0; ps[i].predictedY = -.01; }
  const accountResult = account(rows, ep, modelRule, ps);
  assert.ok(accountResult.trades.filter(t => t.side === 'buy').every(t => t.day === rows[6].day));
  const wrong = structuredClone(ps); wrong[1].labelHoldingYears = 0;
  assert.throws(() => account(rows, ep, modelRule, wrong), /annual-label provenance/);
  const premature = structuredClone(ps); premature[1].latestTrainingExit = rows[1].day;
  assert.throws(() => account(rows, ep, modelRule, premature), /unmatured training label/);
});

test('base actions are identical across cash and fee stresses, and lot attribution reconciles', () => {
  const rows = market('2020-01-01', '2021-02-01', true), ps = syntheticPreds(rows), ep = episode(rows), all = parent.scenarios.map(s => account(rows, ep, modelRule, ps, s));
  const actions = a => a.trades.filter(t => t.side === 'buy').map(({ day, id, arrivalDay, offset }) => ({ day, id, arrivalDay, offset }));
  for (const a of all) { assert.deepEqual(actions(a), actions(all[0])); close(a.contributionAttribution.reduce((s, r) => s + r.terminalWealth, 0), a.terminalWealth); }
  assert.notEqual(all[0].terminalWealth, all[1].terminalWealth); assert.notEqual(all[0].fees, all[2].fees);
});

function gateRows(n = 48, start = '2015-01', value = 1) {
  return Array.from({ length: n }, (_, i) => { const day = S.monthOffset(start, i) + '-02'; return { day, end: P.addYears(day, 1), deltaPp: value, offset: 5 }; });
}
const goodPair = n => ({ n, meanDeltaPp: 1, medianDeltaPp: 1, positiveDeltaShare: 1, p10AccountReturnDifferencePp: 0, medianMaxDrawdownDifferencePp: 0, worstMaxDrawdownDifferencePp: 0,
  meanInterval: { status: 'descriptive', lower: .5, upper: 1.5 } });

test('concentration checks reject a sole good year or sole twelve-month block and preserve zero actions', () => {
  const rows = gateRows(), yearOnly = rows.map(r => ({ ...r, deltaPp: r.day.startsWith('2016') ? 10 : 0, offset: r.day.startsWith('2016') ? 5 : 0 }));
  const result = R.concentrationChecks(yearOnly); assert.equal(result.passed, false);
  assert.equal(result.deleteYear.find(r => r.year === '2016').remainingMeanDeltaPp, 0);
  assert.equal(result.delete12Months.find(r => r.firstMonth === '2016-01').remainingMeanDeltaPp, 0);
  assert.equal(R.concentrationChecks(rows).passed, true);
  assert.equal(R.concentrationChecks(rows.slice(0, 23)).status, 'insufficient');
});

test('an internally missing month does not skip the only failing concentration blocks', () => {
  const rows = gateRows(36, '2020-01', -1).filter(r => !r.day.startsWith('2021-06'));
  for (const r of rows) if (r.day.startsWith('2020-12') || r.day.startsWith('2021-07')) r.deltaPp = 100;
  const result = R.concentrationChecks(rows);
  assert.ok(result.deleteYear.every(r => r.passed)); assert.ok(result.delete12Months.filter(r => r.complete).every(r => r.passed));
  assert.ok(result.delete12Months.some(r => !r.complete && !r.passed)); assert.equal(result.passed, false); assert.equal(result.status, 'failed');
  assert.equal(result.calendarBlocks, 25); assert.ok(result.fullyObservedBlocks > 0);
});

test('action coverage counts unique dates, distinct years and strictly non-overlapping one-year outcomes', () => {
  const rows = gateRows(), good = R.primaryGates(goodPair(rows.length), rows, config);
  assert.equal(good.passed, true); assert.equal(good.actions.uniqueDelayedMonths, 48); assert.equal(good.actions.arrivalYearsWithDelay, 4); assert.equal(good.actions.nonOverlappingDelayedOneYearWindows, 4);
  const sparse = rows.map((r, i) => ({ ...r, offset: i < 2 ? 5 : 0, deltaPp: i < 2 ? 100 : 0 })), fail = R.primaryGates(goodPair(48), sparse, config);
  assert.equal(fail.status, 'insufficient'); assert.equal(fail.passed, false);
  const touch = [{ day: '2020-01-02', end: '2021-01-02', deltaPp: 1, offset: 5 }, { day: '2021-01-02', end: '2022-01-02', deltaPp: 1, offset: 5 }];
  assert.equal(R.primaryGates(goodPair(2), touch, config).actions.nonOverlappingDelayedOneYearWindows, 1);
});

test('money tolerances do not turn ratios, zero strict wins, or empty groups into passing evidence', () => {
  assert.equal(R.economicChecks({ ...goodPair(30), meanDeltaPp: .5 - .5e-10 }, config.unconditionalGates).passed, true);
  assert.equal(R.economicChecks({ ...goodPair(30), meanDeltaPp: .5 - 2e-10 }, config.unconditionalGates).passed, false);
  assert.equal(R.economicChecks(goodPair(0), config.unconditionalGates, { minimumMean: 0, minimumMedian: 0 }).passed, false);
  assert.equal(R.pairNonnegative({ n: 0, meanDeltaPp: 0, medianDeltaPp: 0 }).passed, false);
  assert.equal(R.pairNonnegative({ n: 1, meanDeltaPp: null, medianDeltaPp: 0 }).passed, false);
  const rows = gateRows().map((r, i) => ({ ...r, offset: i % 3 === 0 && i < 45 ? 5 : 0, deltaPp: i % 3 === 0 && i < 27 ? 1 : 0 }));
  const raisedFraction = structuredClone(config); raisedFraction.actionGates.minimumStrictPositiveShareAmongDelayedMonths = .6 + 5e-11;
  const actions = R.primaryGates(goodPair(48), rows, raisedFraction).actions;
  close(actions.strictPositiveShareAmongDelayedMonths, .6); assert.equal(actions.tests.find(t => t.metric === 'strictPositiveShareAmongDelayedMonths').passed, false);
});

test('all paired strict win shares use the v3 1e-10pp rule without changing parent helpers', () => {
  const make = (wealth, i) => ({ start: `2020-0${i + 1}-01`, end: `2021-0${i + 1}-01`, terminalWealth: wealth, contributed: 100, accountReturnPp: wealth - 100,
    maxDrawdownPp: 0, meanWaitSessions: 0, fees: 0, interest: 0, pendingCash: 0, externalFlows: [{ day: `2020-0${i + 1}-01`, amount: 100 }] });
  const baseAccounts = [make(100, 0), make(100, 1)], candidateAccounts = [make(100 + .5e-10, 0), make(100 + 2e-10, 1)];
  assert.equal(R.pairedSummary(candidateAccounts, baseAccounts, 'equal_age_lot', 1).positiveDeltaShare, .5);
});

test('diagnostics use annual labels and exact same mature-pool mean, with no five-session field', () => {
  const rows = [{ day: 'a', predictedY: 2, actualY: 1, referenceForecast: 0, offset: 5, deltaPp: 100 }, { day: 'b', predictedY: 1, actualY: 3, referenceForecast: 0, offset: 0, deltaPp: 0 }];
  const result = R.primaryDiagnostics(rows); close(result.MAE, 1.5); close(result.MSE, 2.5); close(result.referenceMSE, 5); close(result.R2, .5);
  assert.equal(result.maturedAnnualLabels, 2); assert.equal(result.identityMaximumErrorPp, 0); assert.ok(!Object.hasOwn(result, 'maturedFiveSessionLabels'));
});

function confirmationFixture() {
  const rows = gateRows(), evidence = R.primaryGates(goodPair(48), rows, config), results = [];
  for (const partition of ['development', 'validation', 'replication']) for (const scenario of ['base', 'cash2', 'fee20']) for (const calendarDay of [1, 10, 20]) for (const evaluation of ['equal_age_lot', 'twelve_deposit_account']) {
    results.push({ partition, scenario, calendarDay, evaluation, horizonYears: 1, rules: [{ id: R.MODEL_ID, vsImmediate: goodPair(48), vsFixedDelay5: goodPair(48), vsThreeTranches: goodPair(48), primaryEvidence: evidence }] });
  }
  return results;
}

test('development failure is never rescued, and a historical pass still cannot enable integration', () => {
  const results = confirmationFixture(), passed = R.confirm(results, protocol);
  assert.equal(passed.historicalConfirmationPassed, true); assert.equal(passed.integrationEligible, false);
  const dev = results.find(r => r.partition === 'development' && r.scenario === 'base' && r.calendarDay === 1 && r.evaluation === 'equal_age_lot');
  dev.rules[0].primaryEvidence = R.primaryGates({ ...goodPair(48), meanDeltaPp: -.1 }, gateRows(), config);
  const failed = R.confirm(results, protocol); assert.equal(failed.historicalConfirmationPassed, false); assert.equal(failed.eligibleForConfirmation, false);
  assert.ok(failed.confirmation.every(c => c.diagnosticOnly)); assert.equal(failed.priorFailuresUnchanged, true);
});

test('calendar transfer, full monthly account, stress means and later intervals each independently prevent confirmation', () => {
  for (const type of ['calendar', 'monthly', 'stress', 'interval']) {
    const results = confirmationFixture(); let row;
    if (type === 'calendar') row = results.find(r => r.partition === 'validation' && r.scenario === 'base' && r.calendarDay === 10 && r.evaluation === 'equal_age_lot');
    if (type === 'monthly') row = results.find(r => r.partition === 'validation' && r.scenario === 'base' && r.calendarDay === 1 && r.evaluation === 'twelve_deposit_account');
    if (type === 'stress') row = results.find(r => r.partition === 'validation' && r.scenario === 'cash2' && r.calendarDay === 1 && r.evaluation === 'equal_age_lot');
    if (type === 'interval') row = results.find(r => r.partition === 'validation' && r.scenario === 'base' && r.calendarDay === 1 && r.evaluation === 'equal_age_lot');
    if (type === 'interval') row.rules[0].vsImmediate.meanInterval = { status: 'insufficient_blocks', lower: 1, upper: 1 };
    else row.rules[0].vsImmediate = type === 'stress' ? { ...goodPair(48), meanDeltaPp: 0 } : { ...goodPair(0), meanDeltaPp: 0, medianDeltaPp: 0 };
    assert.equal(R.confirm(results, protocol).historicalConfirmationPassed, false, type);
  }
});

test('all 108 result groups remain explicit when the annual model has no available predictions', () => {
  const rows = market('2020-01-01', '2020-03-31'), model = R.buildPredictions(rows, portfolio), result = R.evaluateResearch(rows, model, parent, protocol);
  assert.equal(result.results.length, 108); assert.equal(result.pairedBaseWindows.length, 0); assert.equal(result.primaryPredictionDiagnostics.length, 3);
  assert.ok(result.results.every(r => r.rules.every(rule => rule.summary.n === 0 && rule.vsImmediate.positiveDeltaShare === null)));
  assert.equal(R.confirm(result.results, protocol).historicalConfirmationPassed, false);
});
