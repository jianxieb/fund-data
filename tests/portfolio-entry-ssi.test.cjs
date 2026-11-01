const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../scripts/research_portfolio_entry_ssi.cjs');
const S = require('../scripts/research_portfolio_entry_scope.cjs');
const V3 = require('../scripts/research_portfolio_entry_value.cjs');
const parent = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v1.json')));
const protocol = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-ssi-protocol-v5.json')));
const portfolio = parent.portfolio, rule = { id: R.MODEL_ID };
const close = (a, b, eps = 1e-10) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
function market(start = '2010-01-01', end = '2018-12-31', variable = false) {
  const rows = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += 86400000) {
    const d = new Date(time), i = rows.length;
    if (![0, 6].includes(d.getUTCDay())) rows.push({ day: d.toISOString().slice(0, 10), prices: variable ? [100 * Math.exp(.0004 * i + .15 * Math.sin(i / 31)), 80 * Math.exp(.0003 * i + .1 * Math.cos(i / 47))] : [100, 100] });
  }
  return rows;
}
function histories(start = '2008-01', end = '2020-12') {
  const result = Object.fromEntries(R.SYMBOLS.map(s => [s, []])); let k = 0;
  for (let month = start; month <= end; month = S.monthOffset(month, 1), k++) {
    const last = new Date(Date.parse(S.monthOffset(month, 1) + '-01') - 86400000);
    while ([0, 6].includes(last.getUTCDay())) last.setUTCDate(last.getUTCDate() - 1);
    R.SYMBOLS.forEach((id, j) => result[id].push({ day: last.toISOString().slice(0, 10), shares: 1000 * Math.exp(.002 * k + .02 * Math.sin(k / 3 + j)) }));
  }
  return result;
}
function featureInputs(rows) { return R.buildFeatureInputs(rows, R.buildMonthlySsi(histories())); }
function simplePredictions(rows, offset = 5) {
  const inputs = featureInputs(rows);
  return rows.map((r, i) => ({ day: r.day, executionDay: r.day, priceLabelCutoffDay: rows[i - 1]?.day ?? null,
    labelHoldingYears: 1, ...inputs[i], fitReady: i > 0, actionAvailable: i > 0, trainingN: i ? 36 : 0,
    latestTrainingEntry: rows[0].day, latestTrainingExit: rows[i - 1]?.day ?? null, trainingPoolSha256: 'synthetic_pool',
    featureMean: 0, featurePopulationSd: 1, beta: 1, trainingMeanY: 0,
    predictedY: i ? offset ? .01 : -.01 : null, predictedFullDepositBps: i ? offset ? 100 : -100 : null,
    offset: i ? offset : null, missingReason: i ? null : 'warmup', fallbackReason: null }));
}
function episode(rows, start = 1, end = rows.length - 1, fundingPlan = null) {
  const plan = fundingPlan || [{ day: rows[start].day, index: start, amount: 100 }];
  return { evaluation: plan.length === 1 ? 'equal_age_lot' : 'twelve_deposit_account', years: 1, partition: 'all', startIndex: start, start: rows[start].day,
    endIndex: end, end: rows[end].day, lastFundingDay: plan.at(-1).day, anniversary: rows[end].day, contributed: 100 * plan.length, depositCount: plan.length, fundingPlan: plan };
}
function manualTraining(rows, boundary, count = 36, constant = false) {
  return Array.from({ length: count }, (_, i) => {
    const month = S.monthOffset('2010-02', i), entryIndex = rows.findIndex(r => r.day.slice(0, 7) === month), exitIndex = i === count - 1 ? boundary : boundary - 1;
    return { entryIndex, entryDay: rows[entryIndex].day, trainingMonth: month, exitIndex, exitDay: rows[exitIndex].day,
      features: [constant ? 7 : i % 2 ? 1 : -1], y: i % 2 ? 5 : 1 };
  });
}
function makeFallback(p, reason = 'synthetic_missing_ssi') {
  return { ...p, fitReady: true, inputAvailable: false, actionAvailable: true, featureValue: null,
    predictedY: null, predictedFullDepositBps: null, offset: 0, missingReason: reason, fallbackReason: reason };
}

test('CSV parses quoted fields; feature only uses printed shares and correct long-minus-short units', () => {
  assert.deepEqual(R.parseCsv('Date,Name\r\n"01/01/2020","a, b"\r\n'), [{ Date: '01/01/2020', Name: 'a, b' }]);
  assert.throws(() => R.parseCsv('A\n"unfinished'), /unterminated/);
  const second = [110, 120, 90, 130, 80, 100], h = Object.fromEntries(R.SYMBOLS.map((id, i) => [id, [{ day: '2020-01-31', shares: 100, aum: 1 }, { day: '2020-02-28', shares: second[i], aum: 1e20 }]]));
  const point = R.buildMonthlySsi(h).at(-1); close(point.value, .1);
  assert.equal(point.previousMonth, '2020-01'); assert.deepEqual(Object.values(point.sixSourceMonthEndDates), Array(6).fill('2020-02-28'));
  for (const rows of Object.values(h)) for (const row of rows) { row.aum = 0; row.nav = 999; }
  assert.deepEqual(R.buildMonthlySsi(h).at(-1), point);
});

test('missing calendar months, invalid shares and asynchronous endpoints never use older SSI', () => {
  const h = histories('2019-11', '2020-04');
  h.QID = h.QID.filter(r => r.day.slice(0, 7) !== '2020-02');
  const monthly = R.buildMonthlySsi(h), inputs = R.buildFeatureInputs(market('2020-03-02', '2020-03-20'), monthly);
  assert.equal(monthly.find(m => m.month === '2020-02').value, null);
  assert.ok(inputs.every(r => r.featureMonth === '2020-02' && !r.inputAvailable));
  const async = histories('2020-01', '2020-02'); async.SSO[1].day = '2020-02-27';
  assert.equal(R.buildMonthlySsi(async).at(-1).missingReason, 'asynchronous_six_fund_month_end_dates');
  const invalid = histories('2020-01', '2020-02'); invalid.DXD[1].shares = 0;
  assert.match(R.buildMonthlySsi(invalid).at(-1).missingReason, /invalid_month_end_shares/);
});

test('availability starts after the complete calendar month, not after an early last source row', () => {
  const h = histories('2019-12', '2020-03'); for (const rows of Object.values(h)) rows.find(r => r.day.startsWith('2020-02')).day = '2020-02-10';
  const rows = market('2020-02-03', '2020-03-20'), inputs = R.buildFeatureInputs(rows, R.buildMonthlySsi(h));
  const feb = inputs[rows.findIndex(r => r.day === '2020-02-20')], mar = inputs[rows.findIndex(r => r.day === '2020-03-02')];
  assert.equal(feb.featureMonth, '2020-01'); assert.equal(mar.featureMonth, '2020-02'); assert.equal(mar.assumedFeatureAvailableSession, '2020-03-02');
});

test('training is unique nominal1 months without 200-day warmup; evaluation-only labels survive missing input', () => {
  const rows = market(), inputs = featureInputs(rows), result = R.buildLabelData(rows, inputs, portfolio);
  assert.equal(result.trainingLabels[0].entryDay, '2010-02-01'); assert.ok(result.trainingLabels[0].entryIndex < 200);
  const firsts = new Set(S.buildArrivalSchedule(rows, 1).filter(r => r.index !== null).map(r => r.index));
  assert.ok(result.trainingLabels.every(r => firsts.has(r.entryIndex) && r.entryIndex !== 0));
  assert.equal(new Set(result.trainingLabels.map(r => r.trainingMonth)).size, result.trainingLabels.length);
  const s = rows.findIndex(r => r.day === '2011-03-01'), changed = structuredClone(inputs); changed[s].inputAvailable = false; changed[s].missingReason = 'missing_test';
  const missing = R.buildLabelData(rows, changed, portfolio);
  assert.ok(missing.evaluationLabels[s]); assert.ok(!missing.trainingLabels.some(r => r.entryIndex === s));
  const tenth = S.buildArrivalSchedule(rows, 10).find(r => r.month === '2011-03').index;
  assert.ok(result.evaluationLabels[tenth]); assert.ok(!result.trainingLabels.some(r => r.entryIndex === tenth));
});

test('annual label is the original whole-deposit unit difference with exact calendar maturity', () => {
  const rows = market('2020-01-01', '2021-03-01'), s = 1;
  close(R.annualValueLabel(rows, s, portfolio, 0).label.y, 0);
  rows[s + 5].prices = [50, 50]; close(R.annualValueLabel(rows, s, portfolio, 0).label.y, .6);
  close(R.annualValueLabel(rows, s, portfolio).label.y, .6 * .999 / 1.001);
  assert.equal(R.annualValueLabel(rows, s, portfolio).label.exitDay, '2021-01-04');
  const leap = market('2024-02-01', '2025-03-03'), index = leap.findIndex(r => r.day === '2024-02-29');
  assert.equal(R.annualValueLabel(leap, index, portfolio).label.anniversary, '2025-02-28');
  assert.equal(R.annualValueLabel(rows.slice(0, 100), s, portfolio).label, null);
});

test('35/36 monthly boundary, H=t exclusion, shared maturity insertions and one-dimensional ridge hand calculation', () => {
  const rows = market(), inputs = featureInputs(rows).map(x => ({ ...x, featureValue: 1, inputAvailable: true, missingReason: null }));
  const t = rows.findIndex(r => r.day === '2014-01-02'), labels = manualTraining(rows, t);
  const out = R.trainPredictions(rows, inputs, labels);
  assert.equal(out.predictions[t].trainingN, 35); assert.equal(out.predictions[t].fitReady, false); assert.equal(out.predictions[t].offset, null);
  const p = out.predictions[t + 1]; assert.equal(p.trainingN, 36); assert.equal(p.fitReady, true); close(p.featureMean, 0); close(p.featurePopulationSd, 1);
  close(p.trainingMeanY, 3); close(p.beta, 1); close(p.predictedY, 4); close(p.predictedFullDepositBps, 40000);
  assert.equal(p.latestTrainingExit, rows[t].day); assert.equal(out.predictions[t].newlyMatureLabels, 35);
  assert.throws(() => R.trainPredictions(rows, inputs, [...labels, labels[0]]), /duplicate training month/);
});

test('zero-variance SSI maps to the unpenalized mature mean; fit-ready missing input is retained fallback', () => {
  const rows = market(), t = rows.findIndex(r => r.day === '2014-01-02'), labels = manualTraining(rows, t, 36, true), inputs = featureInputs(rows);
  const target = t + 1; inputs[target] = { ...inputs[target], inputAvailable: false, featureValue: null, missingReason: 'required_previous_month_ssi_absent' };
  const ps = R.trainPredictions(rows, inputs, labels).predictions, fallback = ps[target];
  assert.equal(fallback.fitReady, true); assert.equal(fallback.actionAvailable, true); assert.equal(fallback.predictedY, null); assert.equal(fallback.offset, 0); assert.ok(R.availablePrediction(fallback));
  close(ps[target + 1].beta, 0); close(ps[target + 1].predictedY, 3); close(ps[target + 1].featurePopulationSd, 0);
  assert.equal(ps[t].fitReady, false); assert.equal(ps[t].offset, null); assert.equal(R.availablePrediction({ ...ps[target + 1], predictedFullDepositBps: Infinity }), false);
});

test('nonfinite fit is ineligible, never an immediate-investment fallback', () => {
  const rows = market(), t = rows.findIndex(r => r.day === '2014-01-02'), labels = manualTraining(rows, t);
  labels.forEach((r, i) => { r.y = i % 2 ? 1e308 : -1e308; });
  const p = R.trainPredictions(rows, featureInputs(rows), labels).predictions[t + 1];
  assert.equal(p.fitReady, false); assert.equal(p.actionAvailable, false); assert.equal(p.offset, null); assert.equal(p.fallbackReason, null); assert.match(p.missingReason, /invalid_fit/);
});

test('current/future prices, current incomplete SSI month and future append do not alter prior decisions', () => {
  const rows = market(undefined, undefined, true), h = histories(), baseline = R.buildPredictions(rows, portfolio, h), cutoff = rows.findIndex(r => r.day === '2015-07-15');
  assert.ok(baseline.predictions[cutoff].fitReady);
  const altered = structuredClone(rows); for (let i = cutoff; i < altered.length; i++) altered[i].prices = [1e6 * (i + 1), .001 * (i + 1)];
  const alteredH = structuredClone(h); for (const list of Object.values(alteredH)) for (const r of list) if (r.day > rows[cutoff].day) r.shares *= 100 + Number(r.day.slice(8));
  const changed = R.buildPredictions(altered, portfolio, alteredH);
  assert.deepEqual(changed.predictions.slice(0, cutoff + 1), baseline.predictions.slice(0, cutoff + 1));
  const prefixH = Object.fromEntries(Object.entries(h).map(([id, list]) => [id, list.filter(r => r.day <= rows[cutoff].day)]));
  const prefix = R.buildPredictions(rows.slice(0, cutoff + 1), portfolio, prefixH);
  assert.deepEqual(prefix.predictions, baseline.predictions.slice(0, cutoff + 1));
  assert.ok(baseline.predictions.at(-1).fitReady); assert.equal(baseline.evaluationLabels.at(-1), null);
});

test('later monthly funding dates can have updated coefficients from the same nominal1 pool', () => {
  const rows = market(), inputs = featureInputs(rows), t = rows.findIndex(r => r.day === '2014-01-06'), labels = manualTraining(rows, t);
  const ps = R.trainPredictions(rows, inputs, labels).predictions;
  const first = S.buildArrivalSchedule(rows, 1).find(a => a.month === '2014-01').index, tenth = S.buildArrivalSchedule(rows, 10).find(a => a.month === '2014-01').index;
  assert.equal(ps[first].trainingN, 0); assert.equal(ps[tenth].trainingN, 36); assert.equal(ps[first].featureMonth, ps[tenth].featureMonth);
});

test('flat actual-unit account pays both fees; falling-price annual label reconciles to candidate wealth', () => {
  const rows = market('2020-01-01', '2021-02-01'), s = 1, H = R.annualValueLabel(rows, s, portfolio).label.exitIndex, ep = episode(rows, s, H), ps = simplePredictions(rows);
  const base = parent.scenarios[0], immediate = R.simulateFundingPlan(rows, ep, protocol.benchmarks[0], base, portfolio, ps, true);
  close(immediate.terminalWealth, 40 + 60 / 1.001 * .999);
  rows[s + 5].prices = [50, 50];
  const delayed = R.simulateFundingPlan(rows, ep, rule, base, portfolio, ps, true);
  close(delayed.terminalWealth - immediate.terminalWealth, 100 * R.annualValueLabel(rows, s, portfolio).label.y);
  assert.ok(delayed.trades.filter(t => t.side === 'buy').every(t => t.reason === 'locked_monthly_ssi_annual_value_prediction' && t.featureMonth === ps[s].featureMonth));
});

test('fallback preserves immediate wealth and null forecast; waiting decisions stay locked under stresses', () => {
  const rows = market('2020-01-01', '2021-02-01', true), ps = simplePredictions(rows), ep = episode(rows);
  const immediate = R.simulateFundingPlan(rows, ep, protocol.benchmarks[0], parent.scenarios[0], portfolio, ps, true);
  const missing = structuredClone(ps); missing[1] = makeFallback(missing[1]);
  const fallback = R.simulateFundingPlan(rows, ep, rule, parent.scenarios[0], portfolio, missing, true);
  close(fallback.terminalWealth, immediate.terminalWealth); assert.ok(fallback.trades.filter(t => t.side === 'buy').every(t => t.predictedY === null && t.offset === 0 && t.fallbackReason));
  for (let i = 2; i < ps.length; i++) { ps[i].offset = 0; ps[i].predictedY = -.01; ps[i].predictedFullDepositBps = -100; }
  const accounts = parent.scenarios.map(s => R.simulateFundingPlan(rows, ep, rule, s, portfolio, ps, true));
  const actions = a => a.trades.filter(t => t.side === 'buy').map(t => [t.day, t.id, t.offset]);
  for (const a of accounts) { assert.deepEqual(actions(a), actions(accounts[0])); close(a.contributionAttribution.reduce((total, d) => total + d.terminalWealth, 0), a.terminalWealth); }
  assert.ok(accounts[0].trades.filter(t => t.side === 'buy').every(t => t.day === rows[6].day));
});

test('same-budget twelve-deposit plans never borrow future funding and require all paired arrivals fit-ready', () => {
  const rows = market('2010-01-01', '2015-12-31'), ps = simplePredictions(rows), schedule = S.buildArrivalSchedule(rows, 1), partitions = [{ id: 'all', start: null, end: null }];
  const missing = schedule.find(a => a.month === '2011-03').index; ps[missing] = makeFallback(ps[missing]);
  const scope = R.buildScopeEpisodes(rows, schedule, ps, partitions, 'twelve_deposit_account', 1), ep = scope.episodes.find(e => e.start.startsWith('2011-01'));
  assert.ok(ep && ep.depositCount === 12 && ep.contributed === 1200);
  const a = R.simulateFundingPlan(rows, ep, rule, parent.scenarios[0], portfolio, ps, true);
  assert.ok(a.trades.filter(t => t.side === 'buy').every(t => t.day >= t.arrivalDay));
  assert.equal(a.externalFlows.length, 12); assert.ok(a.curve.every(r => r.strategicCash >= 0 && r.pendingCash >= 0));
  ps[missing] = { ...ps[missing], fitReady: false, actionAvailable: false, offset: null };
  assert.ok(!R.buildScopeEpisodes(rows, schedule, ps, partitions, 'twelve_deposit_account', 1).episodes.some(e => e.start === ep.start));
});

test('forecast diagnostics separate unavailable-input fallback instead of treating null as zero', () => {
  const rows = [{ day: '2020-01-02', end: '2021-01-04', inputAvailable: true, predictedY: 1, referenceForecast: 0, actualY: 2, offset: 0, deltaPp: 0 },
    { day: '2020-02-03', end: '2021-02-03', inputAvailable: false, predictedY: null, referenceForecast: 0, actualY: 100, offset: 0, deltaPp: 0, fallbackReason: 'missing' }];
  const d = R.primaryDiagnostics(rows); assert.equal(d.eligiblePrimaryMonths, 2); assert.equal(d.availableForecastMonths, 1); assert.equal(d.fallbackMonths, 1); close(d.MAE, 1); close(d.referenceMAE, 2);
});

test('publication +1 updates input status even in warmup, distinguishes input delay from cancelled offset5 orders', () => {
  const rows = market('2014-01-01', '2014-03-31'), ps = simplePredictions(rows), schedule = S.buildArrivalSchedule(rows, 1);
  const jan = schedule[0].index, feb = schedule[1].index, mar = schedule[2].index;
  ps[jan] = { ...ps[jan], fitReady: false, actionAvailable: false, offset: null };
  ps[feb] = { ...ps[feb], offset: 0, predictedY: -.01, predictedFullDepositBps: -100 };
  const copy = structuredClone(ps), out = R.publicationSensitivity(rows, ps);
  assert.deepEqual(ps, copy); assert.equal(out[jan].inputAvailable, false); assert.equal(out[jan].actionAvailable, false); assert.equal(out[jan].offset, null); assert.equal(out[jan].inputDelayedByDiagnostic, false);
  assert.equal(out[feb].inputDelayedByDiagnostic, true); assert.equal(out[feb].cancelledBaseDelay, false); assert.equal(out[feb].predictedY, null);
  assert.equal(out[mar].inputDelayedByDiagnostic, true); assert.equal(out[mar].cancelledBaseDelay, true); assert.equal(out[mar].offset, 0);
  for (let i = 0; i < ps.length; i++) for (const k of ['trainingN', 'trainingPoolSha256', 'featureMean', 'featurePopulationSd', 'beta', 'trainingMeanY']) assert.equal(out[i][k], ps[i][k]);
});

test('all 108 cells and publication sensitivity preserve base-qualified accounts; flat history stays zero', () => {
  const rows = market(), model = R.buildPredictions(rows, portfolio, histories()), localParent = structuredClone(parent);
  localParent.episodes.partitions = [{ id: 'development', start: '2010-01-01', end: '2012-12-31' }, { id: 'validation', start: '2013-01-01', end: '2015-12-31' }, { id: 'replication', start: '2016-01-01', end: '2018-12-31' }];
  const out = R.evaluateResearch(rows, model, localParent, protocol);
  assert.equal(out.results.length, 108); assert.equal(out.publicationSensitivity.results.length, 108);
  assert.equal(out.pairedBaseWindows.length, out.publicationSensitivity.pairedBaseWindows.length);
  for (let i = 0; i < out.results.length; i++) {
    const a = out.results[i], b = out.publicationSensitivity.results[i]; assert.equal(a.rules[0].vsImmediate.n, b.rules[0].vsImmediate.n);
    if (a.rules[0].vsImmediate.n) { close(a.rules[0].vsImmediate.meanDeltaPp, 0); close(b.rules[0].vsImmediate.meanDeltaPp, 0); }
  }
  const decision = R.confirm(out.results, protocol); assert.equal(decision.candidate, R.MODEL_ID); assert.equal(decision.historicalConfirmationPassed, false); assert.equal(decision.integrationEligible, false);
  assert.deepEqual(V3.primaryGates(null, [], protocol.selectionAndConfirmation), out.results.find(r => r.calendarDay === 1 && r.evaluation === 'equal_age_lot' && r.horizonYears === 1 && r.scenario === 'base' && r.partition === 'development').rules[0].primaryEvidence);
});
