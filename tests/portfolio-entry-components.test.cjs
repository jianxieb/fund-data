const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('../scripts/research_portfolio_entry_components.cjs');
const R2 = require('../scripts/research_portfolio_entry_predictive.cjs');
const V3 = require('../scripts/research_portfolio_entry_value.cjs');
const S = require('../scripts/research_portfolio_entry_scope.cjs');
const P = require('../assets/portfolio-model.js');
const parent = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v1.json')));
const protocol = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-components-protocol-v4.json')));
const portfolio = parent.portfolio, ids = R.COMPONENT_IDS, candidate = { id: R.MODEL_ID }, zero = { ...parent.scenarios[0], feeRate: 0 };
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
function market(start = '2010-01-01', end = '2016-12-31', variable = false) {
  const rows = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) { const d = new Date(t), i = rows.length;
    if (![0, 6].includes(d.getUTCDay())) rows.push({ day: d.toISOString().slice(0, 10), prices: variable ? [100 * Math.exp(.0003 * i + .1 * Math.sin(i / 21)), 50 * Math.exp(.0005 * i + .15 * Math.cos(i / 31))] : [100, 100] }); }
  return rows;
}
function featureRows(rows) { return rows.map((r, i) => ({ day: r.day, components: Object.fromEntries(ids.map((id, j) => [id, { features: [i / 1000, j * -.1, .02, .03, .04] }])) })); }
function predictions(rows, offsets = [0, 5]) {
  return rows.map((r, i) => {
    const values = Object.fromEntries(ids.map((id, j) => [id, offsets[j] === 5 ? .01 : -.01]));
    return { day: r.day, featureDay: i ? rows[i - 1].day : null, labelHoldingYears: 1, trainingN: 756, latestTrainingExit: i ? rows[i - 1].day : null,
      trainingPoolSha256: 'synthetic_joint_pool', components: Object.fromEntries(ids.map(id => [id, { features: [0, 0, 0, 0, 0], featureMeans: [0, 0, 0, 0, 0],
        featureStd: [1, 1, 1, 1, 1], beta: [0, 0, 0, 0, 0], trainingN: 756, trainingMeanY: 0, predictedY: values[id], predictedFullDepositBps: values[id] * 10000 }])),
      ...R.deriveAction(values), missing: null };
  });
}
function episode(rows, indices = [1], end = rows.length - 1) { return { evaluation: indices.length === 1 ? 'equal_age_lot' : 'twelve_deposit_account', years: 1, partition: 'all',
  startIndex: indices[0], start: rows[indices[0]].day, endIndex: end, end: rows[end].day, lastFundingDay: rows[indices.at(-1)].day,
  anniversary: rows[end].day, contributed: indices.length * 100, depositCount: indices.length, fundingPlan: indices.map(i => ({ index: i, day: rows[i].day, amount: 100 })) }; }
function account(rows, rule = candidate, ps = predictions(rows), scenario = zero, ep = episode(rows)) { return R.simulateFundingPlan(rows, ep, rule, scenario, portfolio, ps, true); }

test('component features use only their own CNY prices, inclusive MA and sample21 SD', () => {
  const rows = market('2020-01-01', '2021-01-31', true), f = R.buildComponentFeatures(rows), i = 230;
  for (let j = 0; j < 2; j++) {
    const prices = rows.map(r => r.prices[j]), x = f[i].components[ids[j]].features, ma = prices.slice(i - 199, i + 1).reduce((a, b) => a + b) / 200;
    close(x[0], prices[i] / ma - 1); close(x[1], prices[i] / Math.max(...prices.slice(0, i + 1)) - 1); close(x[2], prices[i] / prices[i - 5] - 1); close(x[3], prices[i] / prices[i - 21] - 1);
    const ret = prices.slice(i - 20, i + 1).map((v, k) => v / prices[i - 21 + k] - 1), avg = ret.reduce((a, b) => a + b) / 21;
    close(x[4], Math.sqrt(ret.reduce((s, r) => s + (r - avg) ** 2, 0) / 20)); assert.equal(f[198].components[ids[j]].features[0], null);
  }
  const changed = structuredClone(rows); changed.forEach((r, k) => { r.prices[1] = 1 + (k % 9) * 1000; });
  assert.deepEqual(R.buildComponentFeatures(changed).map(r => r.components[ids[0]]), f.map(r => r.components[ids[0]]));
  assert.notEqual(f[i].components[ids[0]].features[0], R2.buildFeatures(rows, portfolio)[i].features[0]);
});

test('each annual component label uses original30% budget and their sum equals the common-wait label', () => {
  const rows = market('2020-01-01', '2021-02-01'), f = featureRows(rows), s = 1;
  rows[s + 5].prices = [50, 200]; const labels = R.buildLabelData(rows, f, portfolio, 0).labels, label = labels[s];
  close(label.components[ids[0]].y, .3); close(label.components[ids[1]].y, -.15);
  const legacyFeatures = f.map(r => ({ day: r.day, features: r.components[ids[0]].features }));
  const common = V3.buildYearLabels(rows, legacyFeatures, portfolio, 0)[s]; close(label.components[ids[0]].y + label.components[ids[1]].y, common.y);
  assert.equal(label.featureDay, rows[s - 1].day); assert.equal(label.anniversary, P.addYears(rows[s].day, 1));
  close(R.buildLabelData(rows, f, portfolio).labels[s].components[ids[0]].y, .3 * .999 / 1.001);
});

test('one missing component feature excludes that training date from both shared pools', () => {
  const rows = market('2020-01-01', '2021-03-01'), f = featureRows(rows); f[10].components[ids[1]].features[0] = null;
  const result = R.buildLabelData(rows, f, portfolio); assert.equal(result.labels[11], null); assert.ok(result.labels[10]);
  const out = R.trainPredictions(rows, f, result.labels); assert.ok(!out.maturityQueue.some(l => l.entryIndex === 11));
  assert.ok(out.predictions.every(p => p.trainingN === p.trainingQueuePrefixLength));
});

test('shared queue inserts every same-day maturity once per fit and excludes H=t', () => {
  const rows = market('2020-01-01', '2020-01-20'), f = featureRows(rows), labels = rows.map(() => null);
  const event = (entryIndex, exitIndex) => ({ entryIndex, entryDay: rows[entryIndex].day, featureDay: rows[entryIndex - 1].day, exitIndex, exitDay: rows[exitIndex].day,
    anniversary: rows[exitIndex].day, components: Object.fromEntries(ids.map((id, j) => [id, { features: f[entryIndex - 1].components[id].features, y: (j + 1) * .1 }])) });
  labels[2] = event(2, 6); labels[1] = event(1, 6); labels[3] = event(3, 7);
  const out = R.trainPredictions(rows, f, labels); assert.deepEqual(out.maturityQueue.map(l => l.entryIndex), [1, 2, 3]);
  assert.equal(out.predictions[6].trainingN, 0); assert.equal(out.predictions[7].trainingN, 2); assert.equal(out.predictions[7].newlyMatureLabels, 2); assert.equal(out.predictions[8].trainingN, 3);
  let expected = hash(''); for (const event of out.maturityQueue.slice(0, 2)) expected = hash(expected + '\n' + JSON.stringify(event));
  assert.equal(out.predictions[7].trainingPoolSha256, expected);
});

test('two independent batch fits share756 dates, not1512 observations, and use own feature matrices', () => {
  const rows = market(undefined, undefined, true), out = R.buildPredictions(rows, portfolio), t = out.predictions.findIndex(R.availablePrediction), p = out.predictions[t];
  assert.ok(p.trainingN >= 756); assert.ok(out.predictions[t - 1].trainingN < 756); const mature = out.maturityQueue.filter(l => l.exitIndex < t);
  assert.equal(mature.length, p.trainingN);
  for (const id of ids) {
    const fit = R2.fitRidge(mature.map(l => l.components[id]));
    close(p.components[id].predictedY, R2.predictFit(fit, out.features[t - 1].components[id].features), 1e-12); assert.equal(p.components[id].trainingN, p.trainingN);
  }
  assert.notDeepEqual(p.components[ids[0]].featureMeans, p.components[ids[1]].featureMeans);
  assert.ok(!Object.hasOwn(p, 'offset')); assert.ok(!Object.hasOwn(p, 'predictedY'));
});

test('current prediction needs no current annual outcome and survives truncation/current-future mutations', () => {
  const rows = market(undefined, undefined, true), out = R.buildPredictions(rows, portfolio), cutoff = 1450;
  assert.equal(out.labels.at(-1), null); assert.ok(R.availablePrediction(out.predictions.at(-1)));
  const short = R.buildPredictions(rows.slice(0, cutoff + 1), portfolio); assert.equal(short.labels.at(-1), null); assert.ok(R.availablePrediction(short.predictions.at(-1)));
  assert.deepEqual(short.predictions, out.predictions.slice(0, cutoff + 1));
  const changed = structuredClone(rows); changed.slice(cutoff).forEach((r, i) => { r.prices = [1e7 * (1 + i), .001 * (1 + i)]; });
  const after = R.buildPredictions(changed, portfolio);
  assert.deepEqual(after.predictions.slice(0, cutoff + 1), out.predictions.slice(0, cutoff + 1)); assert.notDeepEqual(after.predictions[cutoff + 1], out.predictions[cutoff + 1]);
});

test('a missing current feature or invalid fit in either component makes the whole action unavailable', () => {
  const rows = market(), f = featureRows(rows), labels = rows.map(() => null);
  for (let i = 1; i <= 756; i++) labels[i] = { entryIndex: i, entryDay: rows[i].day, featureDay: rows[i - 1].day, exitIndex: i + 1, exitDay: rows[i + 1].day,
    anniversary: rows[i + 1].day, components: { [ids[0]]: { features: [i % 2 ? 1e308 : -1e308, 0, 0, 0, 0], y: 1 }, [ids[1]]: { features: [i % 2, 0, 0, 0, 0], y: .1 } } };
  const invalid = R.trainPredictions(rows, f, labels).predictions[758]; assert.equal(invalid.trainingN, 756); assert.match(invalid.missing, /invalid_component_fit/);
  assert.equal(invalid.legOffsets, null); assert.equal(invalid.anyDelay, null); assert.equal(invalid.actionCategory, null); assert.equal(R.availablePrediction(invalid), false);
  const realSynthetic = R.buildPredictions(rows, portfolio), alteredFeatures = structuredClone(realSynthetic.features), last = rows.length - 1;
  alteredFeatures[last - 1].components[ids[0]].features[0] = null;
  const missing = R.trainPredictions(rows, alteredFeatures, realSynthetic.labels).predictions[last];
  assert.match(missing.missing, /incomplete_prior_component_features/); assert.equal(missing.legOffsets, null);
  const corrupted = predictions(rows)[1]; corrupted.components[ids[1]].beta[0] = NaN; assert.equal(R.availablePrediction(corrupted), false);
});

test('four action categories are explicit and the trigger is strictly greater than1e-12', () => {
  for (const [values, name, offsets, any] of [ [[0, 0], 'both_immediate', [0, 0], false], [[.01, 0], 'delay_usd_only', [5, 0], true], [[0, .01], 'delay_tqqq_only', [0, 5], true], [[.01, .01], 'delay_both', [5, 5], true] ]) {
    const out = R.deriveAction(Object.fromEntries(ids.map((id, j) => [id, values[j]]))); assert.equal(out.actionCategory, name); assert.equal(out.anyDelay, any); assert.deepEqual(ids.map(id => out.legOffsets[id]), offsets);
  }
  assert.equal(R.deriveAction({ [ids[0]]: 1e-12, [ids[1]]: -1 }).anyDelay, false);
  assert.equal(R.deriveAction({ [ids[0]]: 1e-12 + 1e-15, [ids[1]]: -1 }).actionCategory, 'delay_usd_only');
  assert.deepEqual(R.deriveAction({ [ids[0]]: null, [ids[1]]: 1 }), { legOffsets: null, anyDelay: null, actionCategory: null });
});

test('only TQQQ waits: terminal85, not fake both-wait115, with fixed30 budgets', () => {
  const rows = market('2020-01-01', '2020-01-20'); rows[6].prices = [50, 200];
  const result = account(rows), immediate = account(rows, protocol.benchmarks[0]), both = account(rows, candidate, predictions(rows, [5, 5]));
  close(result.terminalWealth, 85); close(immediate.terminalWealth, 100); close(both.terminalWealth, 115);
  const buys = result.trades.filter(t => t.side === 'buy'); assert.deepEqual(buys.map(t => [t.id, t.day, t.notional, t.units]), [[ids[0], rows[1].day, 30, .3], [ids[1], rows[6].day, 30, .15]]);
  close(result.curve[0].strategicCash, 40); close(result.curve[0].pendingCash, 30); close(result.meanWaitSessions, 2.5);
  assert.equal(result.contributionAttribution[0].anyDelay, true); assert.equal(result.contributionAttribution[0].actionCategory, 'delay_tqqq_only');
});

test('every primary leg-action identity uses only the legs actually delayed', () => {
  const rows = market('2020-01-01', '2021-02-01'); rows[6].prices = [50, 200];
  const label = R.buildLabelData(rows, featureRows(rows), portfolio, 0).labels[1], ep = episode(rows, [1], label.exitIndex), baseline = account(rows, protocol.benchmarks[0], predictions(rows), zero, ep);
  for (const offsets of [[0, 0], [5, 0], [0, 5], [5, 5]]) {
    const a = account(rows, candidate, predictions(rows, offsets), zero, ep), expected = 100 * ids.reduce((total, id, j) => total + (offsets[j] === 5 ? label.components[id].y : 0), 0);
    close(a.terminalWealth - baseline.terminalWealth, expected);
  }
});

test('cash2 interest stays with the waiting30 leg, while strategic40 grows separately', () => {
  const rows = market('2020-01-01', '2020-02-01'), ep = episode(rows), scenario = { ...zero, annualCashRate: .02 }, a = account(rows, candidate, predictions(rows), scenario, ep);
  const factor = i => 1.02 ** ((Date.parse(rows[i].day) - Date.parse(rows[1].day)) / 86400000 / 365.2425);
  close(a.terminalWealth, 40 * factor(ep.endIndex) + 30 + 30 * factor(6));
  const attr = a.contributionAttribution[0]; close(attr.strategicCash, 40 * factor(ep.endIndex)); close(attr.components[ids[0]].waitingInterest, 0);
  close(attr.components[ids[1]].waitingInterest, 30 * (factor(6) - 1)); close(attr.interest, a.interest);
});

test('three tranches divide each30 component into thirds and fees never draw from the other leg', () => {
  const rows = market('2020-01-01', '2020-04-30'), a = account(rows, protocol.benchmarks[2], predictions(rows), parent.scenarios[0]);
  const attr = a.contributionAttribution[0];
  for (const id of ids) {
    assert.equal(attr.components[id].scheduledPurchases.length, 3);
    assert.ok(attr.components[id].scheduledPurchases.every(l => l.originalBudget === 10));
    close(attr.components[id].productLiquidationValue, 30 * .999 / 1.001);
  }
  close(a.terminalWealth, 40 + 60 * .999 / 1.001); close(a.fees, 100 - a.terminalWealth);
});

test('each required arrival needs both fits and a partial missing fit excludes all paired accounts', () => {
  const rows = market('2019-12-30', '2024-01-31'), ps = predictions(rows), schedule = S.buildArrivalSchedule(rows, 1), missing = schedule.find(r => r.month === '2020-06');
  ps[missing.index].components[ids[1]].predictedY = null;
  const result = R.buildScopeEpisodes(rows, schedule, ps, [{ id: 'all', start: null, end: null }], 'twelve_deposit_account', 1);
  assert.ok(result.rejected.some(r => r.start === '2020-01-01' && r.reason === 'prediction_unavailable_on_funding_date'));
  assert.ok(!result.episodes.some(e => e.start === '2020-01-01'));
  const wrong = predictions(rows); wrong[1].legOffsets[ids[0]] = 5; assert.throws(() => account(rows, candidate, wrong), /both component predictions required/);
});

test('two-leg decisions lock on their own arrival and no future deposit funds an earlier order', () => {
  const rows = market('2020-01-01', '2020-04-30'), ps = predictions(rows), ep = episode(rows, [1, 23]);
  for (let i = 2; i < ps.length; i++) ps[i] = predictions(rows, [5, 0])[i];
  const a = account(rows, candidate, ps, zero, ep), buys = a.trades.filter(t => t.side === 'buy');
  assert.ok(buys.some(t => t.arrivalDay === rows[1].day && t.id === ids[1] && t.day === rows[6].day));
  assert.ok(buys.some(t => t.arrivalDay === rows[23].day && t.id === ids[0] && t.day === rows[28].day));
  assert.ok(a.curve.filter(r => r.day < rows[23].day).every(r => r.contributed === 100 && r.value <= 100 + 1e-8));
});

test('full account NAV, attribution and fixed actions reconcile across all three scenarios', () => {
  const rows = market('2020-01-01', '2022-01-31', true), ps = predictions(rows), plan = S.buildArrivalSchedule(rows, 10).slice(0, 12).map(r => r.index), ep = episode(rows, plan);
  const all = parent.scenarios.map(scenario => account(rows, candidate, ps, scenario, ep)), actions = a => a.trades.filter(t => t.side === 'buy').map(({ day, id, arrivalDay, offset }) => ({ day, id, arrivalDay, offset }));
  for (const a of all) {
    assert.equal(a.contributed, 1200); assert.equal(a.externalFlows.length, 12); assert.deepEqual(actions(a), actions(all[0]));
    close(a.contributionAttribution.reduce((s, x) => s + x.terminalWealth, 0), a.terminalWealth); close(a.contributionAttribution.reduce((s, x) => s + x.fees, 0), a.fees); close(a.contributionAttribution.reduce((s, x) => s + x.interest, 0), a.interest);
    let peak = 1, mdd = 0; for (const p of a.curve) { peak = Math.max(peak, p.nav); mdd = Math.min(mdd, 100 * (p.nav / peak - 1)); } close(mdd, a.maxDrawdownPp);
  }
});

test('terminal purchase happens before sale, while a later leg remains pending without transfer', () => {
  const rows = market('2020-01-01', '2020-01-20'), ps = predictions(rows), due = account(rows, candidate, ps, parent.scenarios[0], episode(rows, [1], 6));
  assert.ok(due.trades.some(t => t.id === ids[1] && t.day === rows[6].day && t.side === 'buy'));
  close(due.terminalWealth, 40 + 60 * .999 / 1.001);
  const early = account(rows, candidate, ps, parent.scenarios[0], episode(rows, [1], 5));
  close(early.pendingCash, 30); assert.ok(!early.trades.some(t => t.id === ids[1])); close(early.terminalWealth, 70 + 30 * .999 / 1.001);
});

test('any-delay counts each monthly deposit once, including both-delay arrivals and overlap duplicates', () => {
  const rows = market('2020-01-01', '2020-04-30'), ps = predictions(rows, [5, 5]), ep1 = episode(rows, [1, 23]), ep2 = episode(rows, [23, 43]);
  const d = R.decisionCoverage([ep1, ep2], ps); assert.equal(d.uniqueArrivalDecisions, 3); assert.equal(d.delayedUniqueDecisions, 3);
  assert.deepEqual(d.perComponentDelayedDecisions, { 'us:USD': 3, 'us:TQQQ': 3 }); assert.equal(d.dates.find(r => r.day === rows[23].day).occurrencesInAccounts, 2);
  assert.equal(d.actionCategoryCounts.delay_both, 3); assert.equal(d.actionCategoryCounts.delay_usd_only, 0);
});

function gateRows(n = 48) { return Array.from({ length: n }, (_, i) => { const day = S.monthOffset('2015-01', i) + '-02'; return { day, end: P.addYears(day, 1), deltaPp: 1, legOffsets: { 'us:USD': 5, 'us:TQQQ': 5 }, anyDelay: true, actionCategory: 'delay_both' }; }); }
const goodPair = n => ({ n, meanDeltaPp: 1, medianDeltaPp: 1, positiveDeltaShare: 1, p10AccountReturnDifferencePp: 0, medianMaxDrawdownDifferencePp: 0, worstMaxDrawdownDifferencePp: 0,
  meanInterval: { status: 'descriptive', lower: .5, upper: 1.5 } });
test('joint action gates use combined wealth, not per-component wins or twice the action coverage', () => {
  const rows = gateRows(), evidence = R.primaryGates(goodPair(48), rows, protocol.selectionAndConfirmation);
  assert.equal(evidence.passed, true); assert.equal(evidence.actions.uniqueDelayedMonths, 48); assert.equal(evidence.actions.nonOverlappingDelayedOneYearWindows, 4);
  const loss = rows.map(r => ({ ...r, deltaPp: -1, componentDeltas: { 'us:USD': 10, 'us:TQQQ': -11 } }));
  const failed = R.primaryGates(goodPair(48), loss, protocol.selectionAndConfirmation); assert.equal(failed.actions.strictPositiveShareAmongDelayedMonths, 0); assert.equal(failed.actions.medianDeltaPpAmongDelayedMonths, -1); assert.equal(failed.passed, false);
  const sparse = gateRows(6); assert.equal(R.primaryGates(goodPair(6), sparse, protocol.selectionAndConfirmation).actions.uniqueDelayedMonths, 6);
});

test('component forecasts and the both-delay counterfactual stay distinct from realized joint policy', () => {
  const row = { day: '2020-01-02', end: '2021-01-02', deltaPp: -15, ...R.deriveAction({ 'us:USD': -.1, 'us:TQQQ': .1 }), components: {
    'us:USD': { predictedY: -.1, actualY: .3, referenceForecast: 0 }, 'us:TQQQ': { predictedY: .1, actualY: -.15, referenceForecast: 0 } } };
  const d = R.primaryDiagnostics([row]); assert.equal(d.identityMaximumErrorPp, 0); close(d.bothDelayCounterfactual.dates[0].actualY, .15);
  assert.equal(d.categories.length, 4); assert.equal(d.categories.find(c => c.actionCategory === 'delay_tqqq_only').conditionalMeanDeltaPp, -15);
  assert.equal(d.categories.find(c => c.actionCategory === 'delay_both').n, 0); assert.equal(d.categories.find(c => c.actionCategory === 'delay_both').conditionalMeanDeltaPp, null);
});

test('development failure cannot be rescued by a good component, category or later date', () => {
  const evidence = R.primaryGates(goodPair(48), gateRows(), protocol.selectionAndConfirmation), results = [];
  for (const partition of ['development', 'validation', 'replication']) for (const scenario of ['base', 'cash2', 'fee20']) for (const calendarDay of [1, 10, 20]) for (const evaluation of ['equal_age_lot', 'twelve_deposit_account']) results.push({ partition, scenario, calendarDay, evaluation, horizonYears: 1,
    rules: [{ id: R.MODEL_ID, vsImmediate: goodPair(48), vsFixedDelay5: goodPair(48), vsThreeTranches: goodPair(48), primaryEvidence: evidence }] });
  assert.equal(R.confirm(results, protocol).historicalConfirmationPassed, true); assert.equal(R.confirm(results, protocol).integrationEligible, false);
  results[0].rules[0].primaryEvidence = R.primaryGates({ ...goodPair(48), meanDeltaPp: -1 }, gateRows(), protocol.selectionAndConfirmation);
  const failed = R.confirm(results, protocol); assert.equal(failed.historicalConfirmationPassed, false); assert.ok(failed.confirmation.every(c => c.diagnosticOnly));
});

test('empty joint availability preserves all108 cells and all original failed gates', () => {
  const rows = market('2020-01-01', '2020-03-31'), model = R.buildPredictions(rows, portfolio), result = R.evaluateResearch(rows, model, parent, protocol);
  assert.equal(result.results.length, 108); assert.equal(result.pairedBaseWindows.length, 0); assert.equal(result.primaryPredictionDiagnostics.length, 3);
  assert.ok(result.results.every(r => r.rules.every(x => x.summary.n === 0))); assert.equal(R.confirm(result.results, protocol).historicalConfirmationPassed, false);
});

test('draft protocol is rejected before loading any source or generating a candidate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-components-protocol-test-'));
  try { const file = path.join(dir, 'draft.json'); fs.writeFileSync(file, JSON.stringify({ ...protocol, status: 'draft_not_frozen' })); assert.throws(() => R.loadInputs(file), /must be frozen/); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
