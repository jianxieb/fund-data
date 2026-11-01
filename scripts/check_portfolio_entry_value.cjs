#!/usr/bin/env node
'use strict';
// Independent v3 audit: annual cash-value labels and explicit matured-row batch
// regression. No producer label, fitting, account or gate function supplies an
// expected result. Source/features/batch algebra and separately valued claims
// reuse the earlier independent auditors, not their five-session labels.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Source = require('./check_portfolio_entry_research.cjs');
const Batch = require('./check_portfolio_entry_predictive.cjs');
const Scope = require('./check_portfolio_entry_scope.cjs');
const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = 'docs/research/portfolio-entry-value-protocol-v3.json';
const SCOPE_PROTOCOL = 'docs/research/portfolio-entry-scope-audit-protocol-v1.json';
const ENGINE = 'scripts/research_portfolio_entry_value.cjs';
const MODEL = 'expanding_ridge_year1_delay5', MIN = 756, EPS = 1e-8, MONEY_EPS = 1e-10;
const DAY = 86400000, sum = xs => xs.reduce((s, x) => s + x, 0);
const mean = xs => xs.length ? sum(xs) / xs.length : null;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const date = s => Date.parse(s + 'T00:00:00Z');
const monthNumber = s => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const monthName = n => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
const finite = Number.isFinite;
const ge = (x, limit) => finite(x) && x >= limit - MONEY_EPS;
const positive = x => finite(x) && x > MONEY_EPS;
const countGe = (x, limit) => Number.isInteger(x) && x >= 0 && x >= limit;
const ratioGe = (x, limit) => finite(x) && x >= 0 && x <= 1 && x >= limit;
function close(actual, expected, label, errors) {
  if (expected === null) return assert.equal(actual, null, label);
  assert.ok(finite(actual) && finite(expected) && Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
  if (errors) { const last = label.split('.').at(-1), key = /^\d+$/.test(last) ? 'arrayElements' : last; errors[key] = Math.max(errors[key] || 0, Math.abs(actual - expected)); }
}
function numbers(actual, expected, label, errors) {
  assert.ok(actual && typeof actual === 'object', label + ': missing object');
  for (const [key, value] of Object.entries(expected)) {
    if (value === null || typeof value === 'number') close(actual[key], value, label + '.' + key, errors);
    else if (typeof value === 'string' || typeof value === 'boolean') assert.equal(actual[key], value, label + '.' + key);
  }
}
function quantile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b), at = p * (sorted.length - 1), left = Math.floor(at);
  return sorted[left] * (1 - at + left) + sorted[Math.ceil(at)] * (at - left);
}
function nonOverlap(rows) {
  let n = 0, end = '';
  for (const row of [...rows].sort((a, b) => a.start.localeCompare(b.start))) if (row.start > end) { n++; end = row.end; }
  return n;
}
function annualLabels(market, features, portfolio) {
  const rows = [];
  for (let s = 1; s + 5 < market.length; s++) {
    const x = features[s - 1];
    if (!x || !x.every(finite)) continue;
    const anniversary = Scope.anniversary(market[s].day, 1);
    const end = market.findIndex(row => row.day >= anniversary);
    if (end < 0 || end < s + 5 || (date(market[end].day) - date(anniversary)) / DAY > 14) continue;
    // Closed-form terminal value of actual per-product unit differences.
    const y = .999 / 1.001 * sum(portfolio.positions.map((p, j) =>
      p.weight * market[end].prices[j] * (1 / market[s + 5].prices[j] - 1 / market[s].prices[j])));
    assert.ok(finite(y));
    rows.push({ entryIndex: s, entryDay: market[s].day, featureDay: market[s - 1].day,
      exitIndex: end, exitDay: market[end].day, anniversary, features: x.slice(), y });
  }
  return rows.sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex);
}
function predict(market, features, labels, t) {
  const pool = labels.filter(row => row.exitIndex < t), x = features[t - 1];
  const header = { day: market[t].day, featureDay: market[t - 1]?.day ?? null, trainingN: pool.length,
    latestTrainingExit: pool.at(-1)?.exitDay ?? null, latestTrainingEntry: pool.at(-1)?.entryDay ?? null };
  if (pool.length < MIN || !x?.every(finite)) return { ...header, predictedY: null, offset: null };
  const fit = Batch.batchRidge(pool.map(r => ({ x: r.features, y: r.y })), x, 1);
  return { ...header, features: x.slice(), ...fit, predictedFullDepositBps: fit.predictedY * 10000 };
}
function fitDates(market, features, labels) {
  const indices = new Set();
  for (const calendarDay of [1, 10, 20]) for (const arrival of Scope.arrivalCalendar(market, calendarDay)) if (arrival.index !== null) indices.add(arrival.index);
  const first = market.findIndex((_, i) => labels.filter(r => r.exitIndex < i).length >= MIN);
  for (const i of [0, 199, 200, first - 1, first, first + 1, market.length - 1]) if (i >= 0 && i < market.length) indices.add(i);
  // Fixed extra historical cuts, chosen without inspecting any prediction.
  for (let i = 0; i < market.length; i += 97) indices.add(i);
  for (const year of ['2018', '2019', '2022', '2023']) {
    const starts = market.findIndex(r => r.day >= year + '-01-01');
    if (starts >= 0) indices.add(starts);
  }
  return new Map([...indices].sort((a, b) => a - b).map(i => [i, predict(market, features, labels, i)]));
}
function actionEvidence(rows) {
  assert.equal(new Set(rows.map(r => r.start)).size, rows.length, 'primary lots must be distinct decisions');
  const acted = rows.filter(r => r.offset === 5);
  const years = [...new Set(acted.map(r => r.start.slice(0, 4)))].sort();
  return { allMonths: rows.length, delayedMonths: acted.length, arrivalYears: years, arrivalYearCount: years.length,
    nonOverlappingDelayedN: nonOverlap(acted), positiveShare: acted.length ? acted.filter(r => positive(r.deltaPp)).length / acted.length : null,
    medianDeltaPp: quantile(acted.map(r => r.deltaPp), .5), meanDeltaPp: mean(acted.map(r => r.deltaPp)),
    dates: acted.map(r => ({ start: r.start, end: r.end, deltaPp: r.deltaPp })) };
}
function concentration(rows) {
  const ordered = [...rows].sort((a, b) => a.start.localeCompare(b.start)), years = [...new Set(ordered.map(r => r.start.slice(0, 4)))];
  function exclusion(key, predicate) {
    const removed = ordered.filter(predicate), kept = ordered.filter(r => !predicate(r));
    return { ...key, removedN: removed.length, remainingN: kept.length, removedDates: removed.map(r => r.start),
      remainingDates: kept.map(r => r.start), meanDeltaPp: mean(kept.map(r => r.deltaPp)), passed: positive(mean(kept.map(r => r.deltaPp))) };
  }
  const deleteYear = years.map(year => exclusion({ year }, r => r.start.startsWith(year)));
  const delete12Months = [];
  if (ordered.length) for (let start = monthNumber(ordered[0].start); start <= monthNumber(ordered.at(-1).start) - 11; start++) {
    const end = start + 12;
    const represented = new Set(ordered.map(r => r.start.slice(0, 7))), months = Array.from({ length: 12 }, (_, i) => monthName(start + i));
    const missingMonths = months.filter(m => !represented.has(m));
    delete12Months.push(exclusion({ startMonth: monthName(start), endMonthExclusive: monthName(end), complete: !missingMonths.length, missingMonths }, r => monthNumber(r.start) >= start && monthNumber(r.start) < end));
  }
  const fullyObservedBlocks = delete12Months.filter(b => b.complete).length;
  const sufficient = ordered.length >= 24 && fullyObservedBlocks > 0;
  return { n: ordered.length, status: sufficient ? 'sufficient_month_coverage' : 'insufficient_month_coverage',
    fullyObservedBlocks, deleteYear, delete12Months, passed: sufficient && deleteYear.length > 0 && deleteYear.every(r => r.passed) && delete12Months.every(r => r.passed) };
}
function riskPass(pair, gates) {
  return ge(pair.p10AccountReturnDifferencePp, gates.minimumP10AccountReturnDifferencePp) &&
    ge(pair.medianMaxDrawdownDifferencePp, gates.minimumMedianDrawdownDifferencePp) && ge(pair.worstMaxDrawdownDifferencePp, gates.minimumWorstDrawdownDifferencePp);
}
function primaryPass(pair, actions, concentrated, protocol) {
  const u = protocol.selectionAndConfirmation.unconditionalGates, a = protocol.selectionAndConfirmation.actionGates;
  const checks = { sampleAvailable: countGe(pair.n, 1), mean: ge(pair.meanDeltaPp, u.minimumMeanDeltaPp), median: ge(pair.medianDeltaPp, u.minimumMedianDeltaPp), risk: riskPass(pair, u),
    actionCount: countGe(actions.delayedMonths, a.minimumUniqueDelayedMonths), actionYears: countGe(actions.arrivalYearCount, a.minimumArrivalYearsWithDelay),
    nonOverlap: countGe(actions.nonOverlappingDelayedN, a.minimumNonOverlappingDelayedOneYearWindows), actionWins: ratioGe(actions.positiveShare, a.minimumStrictPositiveShareAmongDelayedMonths),
    actionMedian: ge(actions.medianDeltaPp, a.minimumMedianDeltaPpAmongDelayedMonths), concentration: concentrated.passed === true };
  return { passed: Object.values(checks).every(Boolean), checks };
}
function summary(rows) {
  return { n: rows.length, nonOverlappingN: nonOverlap(rows), meanAccountReturnPp: mean(rows.map(r => r.accountReturnPp)), medianAccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .5),
    p10AccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .1), medianMaxDrawdownPp: quantile(rows.map(r => r.maxDrawdownPp), .5),
    worstMaxDrawdownPp: rows.length ? Math.min(...rows.map(r => r.maxDrawdownPp)) : null, meanWaitSessions: mean(rows.map(r => r.meanWaitSessions)),
    meanFees: mean(rows.map(r => r.fees)), meanInterest: mean(rows.map(r => r.interest)), pendingEpisodes: rows.filter(r => r.pendingCash > 1e-9).length };
}
function pair(rows, baseline, blockLength) {
  assert.equal(rows.length, baseline.length);
  const deltas = rows.map((r, i) => { assert.deepEqual(r.externalFlows, baseline[i].externalFlows); return 100 * (r.terminalWealth - baseline[i].terminalWealth) / r.contributed; });
  const a = summary(rows), b = summary(baseline), difference = k => a[k] === null ? null : a[k] - b[k];
  return { n: rows.length, nonOverlappingN: a.nonOverlappingN, identicalExternalFlows: true, meanDeltaPp: mean(deltas), medianDeltaPp: quantile(deltas, .5),
    positiveDeltaShare: rows.length ? deltas.filter(positive).length / rows.length : null, pairedDeltaP10Pp: quantile(deltas, .1),
    p10AccountReturnDifferencePp: difference('p10AccountReturnPp'), medianMaxDrawdownDifferencePp: difference('medianMaxDrawdownPp'),
    worstMaxDrawdownDifferencePp: difference('worstMaxDrawdownPp'), meanInterval: Scope.interval(deltas, blockLength) };
}
function independentAccount(market, episode, rule, scenario, portfolio, predictions) {
  // The reused auditor selects a provided arrival decision by its old ID. This
  // explicit adapter changes only that selector; no old predictor/label is used.
  const adapted = rule.id === MODEL ? { id: 'expanding_ridge_delay5' } : rule;
  return Scope.account(market, episode, adapted, scenario, portfolio, predictions);
}
function readInputs() {
  const source = Source.readInputs(), bytes = fs.readFileSync(path.join(ROOT, PROTOCOL)), protocol = JSON.parse(bytes);
  assert.equal(protocol.id, 'equal-budget-mature-value-delay-v3'); assert.equal(protocol.model.id, MODEL);
  assert.equal(protocol.model.minimumMatureLabels, MIN); assert.equal(protocol.model.ridgeLambda, 1); assert.equal(protocol.model.labelHoldingYears, 1);
  for (const item of protocol.frozenDependencies) assert.equal(sha(fs.readFileSync(path.join(ROOT, item.path))), item.sha256, item.path);
  const scope = JSON.parse(fs.readFileSync(path.join(ROOT, SCOPE_PROTOCOL)));
  return { ...source, parent: source.protocol, protocol, scope, protocolSha256: sha(bytes) };
}
function subset(actual, expected, label, errors) {
  if (expected === null || typeof expected === 'number') return close(actual, expected, label, errors);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), label + ': array'); assert.equal(actual.length, expected.length, label + '.length');
    expected.forEach((v, i) => subset(actual[i], v, label + '.' + i, errors)); return;
  }
  if (typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', label + ': object');
    for (const [key, value] of Object.entries(expected)) subset(actual[key], value, label + '.' + key, errors); return;
  }
  assert.equal(actual, expected, label);
}
const windowKey = e => [e.calendarDay, e.evaluation, e.years, e.partition, e.start, e.end].join('/');
const groupKey = e => [e.calendarDay, e.evaluation, e.horizonYears, e.partition, e.scenario].join('/');
function unique(rows, key, label) {
  const result = new Map();
  for (const row of rows) { const id = key(row); assert.ok(!result.has(id), label + ': duplicate ' + id); result.set(id, row); }
  return result;
}
const ACCOUNT_FIELDS = ['terminalWealth', 'contributed', 'accountReturnPp', 'navReturnPp', 'maxDrawdownPp', 'fees', 'interest', 'pendingCash', 'pendingLots', 'meanWaitSessions'];
function compareAccount(actual, expected, label, errors, trace) {
  for (const key of ACCOUNT_FIELDS) close(actual[key], expected[key], label + '.' + key, errors);
  assert.deepEqual(actual.externalFlows, expected.externalFlows, label + '.externalFlows');
  subset(actual.contributionAttribution, expected.contributionAttribution, label + '.contributionAttribution');
  for (const key of ['terminalWealth', 'fees', 'interest', 'pendingCash']) close(sum(actual.contributionAttribution.map(r => r[key])), actual[key], label + '.attribution sum ' + key);
  const key = r => [r.day, r.side, r.id, r.arrivalDay || ''].join('/');
  const a = [...actual.trades].sort((x, y) => key(x).localeCompare(key(y))), b = [...expected.trades].sort((x, y) => key(x).localeCompare(key(y)));
  subset(a, b, label + '.trades');
  if (actual.rule === MODEL) for (const trade of actual.trades.filter(t => t.side === 'buy')) {
    const p = trace.find(r => r.day === trade.arrivalDay); assert.ok(p);
    subset(trade, { decisionDay: p.day, featureDay: p.featureDay, signalDay: p.featureDay, predictedY: p.predictedY,
      trainingN: p.trainingN, latestTrainingExit: p.latestTrainingExit, trainingPoolSha256: p.trainingPoolSha256,
      labelHoldingYears: 1, offset: p.offset, reason: 'frozen_year1_value_prediction' }, label + '.annual trade provenance');
  }
}
function compareEconomic(actual, expectedPair, gates, options = {}) {
  const sampleAvailable = Number.isInteger(expectedPair?.n) && expectedPair.n > 0;
  const limits = { meanDeltaPp: options.minimumMean ?? gates.minimumMeanDeltaPp, medianDeltaPp: options.minimumMedian ?? gates.minimumMedianDeltaPp,
    p10AccountReturnDifferencePp: gates.minimumP10AccountReturnDifferencePp, medianMaxDrawdownDifferencePp: gates.minimumMedianDrawdownDifferencePp,
    worstMaxDrawdownDifferencePp: gates.minimumWorstDrawdownDifferencePp };
  const expected = Object.entries(limits).map(([metric, minimum]) => ({ metric, minimum, value: expectedPair?.[metric] ?? null,
    passed: metric === 'meanDeltaPp' && options.strictMean ? positive(expectedPair?.[metric]) : ge(expectedPair?.[metric], minimum) }));
  subset(actual.tests, expected, 'economic gate tests');
  assert.equal(actual.sampleAvailable, sampleAvailable, 'economic sample availability');
  assert.equal(actual.passed, sampleAvailable && expected.every(t => t.passed), 'economic gate aggregate');
  return actual.passed;
}
function compareConcentration(actual, expected) {
  const convert = r => ({ removedCount: r.removedN, remainingCount: r.remainingN, removedDates: r.removedDates, remainingMeanDeltaPp: r.meanDeltaPp, passed: r.passed });
  subset(actual, { eligibleMonths: expected.n, minimumEligibleMonths: 24, calendarBlocks: expected.delete12Months.length, fullyObservedBlocks: expected.fullyObservedBlocks,
    status: expected.status === 'insufficient_month_coverage' ? 'insufficient' : expected.passed ? 'passed' : 'failed', passed: expected.passed,
    deleteYear: expected.deleteYear.map(r => ({ year: r.year, ...convert(r) })),
    delete12Months: expected.delete12Months.map(r => ({ firstMonth: r.startMonth, lastMonth: monthName(monthNumber(r.endMonthExclusive) - 1), complete: r.complete, missingMonths: r.missingMonths, ...convert(r) })) }, 'concentration');
}
function comparePrimary(actual, paired, rows, protocol) {
  const a = actionEvidence(rows), c = concentration(rows), gate = primaryPass(paired, a, c, protocol);
  const ac = protocol.selectionAndConfirmation.actionGates;
  const actions = { uniqueDelayedMonths: a.delayedMonths, arrivalYearsWithDelay: a.arrivalYearCount,
    nonOverlappingDelayedOneYearWindows: a.nonOverlappingDelayedN, strictPositiveShareAmongDelayedMonths: a.positiveShare, medianDeltaPpAmongDelayedMonths: a.medianDeltaPp };
  const tests = [['uniqueDelayedMonths', 'minimumUniqueDelayedMonths', gate.checks.actionCount], ['arrivalYearsWithDelay', 'minimumArrivalYearsWithDelay', gate.checks.actionYears],
    ['nonOverlappingDelayedOneYearWindows', 'minimumNonOverlappingDelayedOneYearWindows', gate.checks.nonOverlap],
    ['strictPositiveShareAmongDelayedMonths', 'minimumStrictPositiveShareAmongDelayedMonths', gate.checks.actionWins], ['medianDeltaPpAmongDelayedMonths', 'minimumMedianDeltaPpAmongDelayedMonths', gate.checks.actionMedian]]
    .map(([metric, limit, passed]) => ({ metric, value: actions[metric], minimum: ac[limit], passed }));
  const sufficientCoverage = tests.slice(0, 3).every(r => r.passed), sufficient = rows.length > 0 && sufficientCoverage && c.status !== 'insufficient_month_coverage';
  subset(actual.actions, { ...actions, tests, sufficientCoverage, passed: tests.every(t => t.passed),
    dates: rows.filter(r => r.offset === 5).map(r => ({ day: r.start, end: r.end, offset: 5, deltaPp: r.deltaPp })) }, 'primary actions');
  compareEconomic(actual.economic, paired, protocol.selectionAndConfirmation.unconditionalGates);
  compareConcentration(actual.concentration, c);
  assert.equal(actual.status, !sufficient ? 'insufficient' : gate.passed ? 'passed' : 'failed'); assert.equal(actual.passed, gate.passed);
  return { status: actual.status, ...gate, actions: a, concentration: c };
}
function independentDiagnostics(rows) {
  const error = rows.map(r => r.predictedY - r.actualY), reference = rows.map(r => r.referenceForecast - r.actualY), acted = rows.filter(r => r.offset === 5);
  const mse = mean(error.map(x => x * x)), referenceMSE = mean(reference.map(x => x * x));
  return { distinctMonthDecisions: rows.length, delayedMonthDecisions: acted.length, maturedAnnualLabels: rows.length,
    meanRealizedWaitingAdvantageOfDelayedDecisions: mean(acted.map(r => r.actualY)), MAE: mean(error.map(Math.abs)), MSE: mse,
    referenceMAE: mean(reference.map(Math.abs)), referenceMSE, R2: referenceMSE > 0 ? 1 - mse / referenceMSE : null,
    scope: 'same_unique_primary_eligible_one_year_monthly_lots', units: 'full_original_deposit_fraction',
    dates: rows.map(r => ({ day: r.start, end: r.end, offset: r.offset, deltaPp: r.deltaPp, featureDay: r.featureDay, trainingN: r.trainingN,
      latestTrainingExit: r.latestTrainingExit, predictedY: r.predictedY, predictedFullDepositBps: 10000 * r.predictedY, referenceForecast: r.referenceForecast, actualY: r.actualY })) };
}
function verifyConfirmation(report, computedGroups, primary, protocol) {
  const d = report.decision, gates = protocol.selectionAndConfirmation.unconditionalGates;
  const get = (partition, scenario = 'base', calendarDay = 1, evaluation = 'equal_age_lot') => computedGroups.get([calendarDay, evaluation, 1, partition, scenario].join('/')).get(MODEL);
  const dev = primary.get('development'), later = [];
  subset(d, { candidate: MODEL, candidateSelection: 'none_single_fixed_candidate', eligibleForConfirmation: dev.passed,
    integrationEligible: false, priorFailuresUnchanged: true }, 'decision metadata');
  assert.deepEqual(d.development, report.results.find(r => r.calendarDay === 1 && r.evaluation === 'equal_age_lot' && r.horizonYears === 1 && r.scenario === 'base' && r.partition === 'development').rules.find(r => r.id === MODEL).primaryEvidence);
  assert.equal(d.confirmation.length, 2);
  for (const [i, partition] of ['validation', 'replication'].entries()) {
    const actual = d.confirmation[i], p = primary.get(partition), candidate = get(partition), ci = candidate.vsImmediate.meanInterval;
    const intervalPassed = ci.status === 'descriptive' && positive(ci.lower);
    assert.equal(actual.partition, partition); assert.equal(actual.diagnosticOnly, !dev.passed); assert.equal(actual.primary.passed, p.passed);
    subset(actual.interval, ci, partition + '.interval'); assert.equal(actual.intervalPassed, intervalPassed);
    const nonnegative = pair => Number.isInteger(pair.n) && pair.n > 0 && ge(pair.meanDeltaPp, 0) && ge(pair.medianDeltaPp, 0);
    const benchmarks = ['vsFixedDelay5', 'vsThreeTranches'].map((id, k) => {
      const pair = candidate[id], passed = nonnegative(pair); subset(actual.benchmarks[k], { id, n: pair.n, meanDeltaPp: pair.meanDeltaPp, medianDeltaPp: pair.medianDeltaPp, passed }, 'benchmark'); return passed;
    });
    const stress = ['cash2', 'fee20'].map((scenario, k) => { assert.equal(actual.stress[k].scenario, scenario); return compareEconomic(actual.stress[k], get(partition, scenario).vsImmediate, gates, { minimumMean: 0, minimumMedian: 0, strictMean: true }); });
    const transfer = [10, 20].map((calendarDay, k) => { const pair = get(partition, 'base', calendarDay).vsImmediate, passed = nonnegative(pair);
      subset(actual.calendarTransfer[k], { calendarDay, n: pair.n, meanDeltaPp: pair.meanDeltaPp, medianDeltaPp: pair.medianDeltaPp, passed }, 'calendar transfer'); return passed; });
    const account = compareEconomic(actual.completeMonthlyAccount, get(partition, 'base', 1, 'twelve_deposit_account').vsImmediate, gates, { minimumMean: 0, minimumMedian: 0 });
    const passed = p.passed && intervalPassed && benchmarks.every(Boolean) && stress.every(Boolean) && transfer.every(Boolean) && account;
    assert.equal(actual.passed, passed, partition + ': confirmation gates'); later.push(passed);
  }
  const passed = dev.passed && later.every(Boolean);
  assert.equal(d.historicalConfirmationPassed, passed);
  assert.equal(d.status, !dev.passed ? `development_${dev.status === 'insufficient' ? 'insufficient' : 'failed'}_research_only` : passed ? 'historical_pass_pending_independent_and_production_validation' : 'confirmation_failed_research_only');
  return { independentlyRecomputed: true, developmentPassed: dev.passed, laterPassed: later, historicalConfirmationPassed: passed, integrationEligible: false };
}
function engineCausality(market, portfolio, trace) {
  // This is a separate metamorphic check of the producer, never an expected fit.
  const Engine = require(path.join(ROOT, ENGINE)), first = trace.findIndex(p => p.predictedY !== null);
  const indices = [...new Set([first, market.findIndex(r => r.day >= '2019-01-01'), market.findIndex(r => r.day >= '2023-01-01'), market.length - 1])].filter(i => i >= first);
  for (const t of indices) {
    const changed = market.map((r, i) => ({ ...r, prices: r.prices.map((p, j) => i >= t ? p * (j ? .017 : 81) : p) }));
    const altered = Engine.buildPredictions(changed, portfolio).predictions[t];
    assert.deepEqual(altered, trace[t], 'producer current/future mutation at ' + market[t].day);
    const prefix = Engine.buildPredictions(market.slice(0, t + 1), portfolio).predictions[t];
    assert.deepEqual(prefix, trace[t], 'producer future truncation at ' + market[t].day);
  }
  return { type: 'separate_producer_metamorphic_check_not_expected_value_source', days: indices.map(i => market[i].day), currentAndFutureMutation: true, futureTruncation: true };
}
function auditReports(report, ledger, loaded) {
  const { market, parent, protocol, scope } = loaded, features = Batch.featureRows(market), labels = annualLabels(market, features, parent.portfolio);
  const trace = report.dailyPredictions, labelErrors = {}, predictionErrors = {}, ledgerErrors = {}, byEntry = new Map(labels.map(r => [r.entryIndex, r]));
  assert.equal(trace.length, market.length); assert.equal(report.maturityQueue.length, labels.length); subset(report.maturityQueue, labels, 'independent annual labels', labelErrors);
  const labelExclusions = {};
  market.forEach((row, s) => {
    if (byEntry.has(s)) return;
    let reason;
    if (!s || !features[s - 1]?.every(finite)) reason = 'incomplete_prior_features';
    else {
      const anniversary = Scope.anniversary(row.day, 1), end = market.findIndex(r => r.day >= anniversary);
      if (end < 0) reason = 'year_terminal_not_observed';
      else if ((date(market[end].day) - date(anniversary)) / DAY > 14) reason = 'year_terminal_more_than_14_days_late';
      else if (s + 5 > end) reason = 'five_session_purchase_after_terminal';
      else assert.fail('unexplained omitted annual label at ' + row.day);
    }
    labelExclusions[reason] = (labelExclusions[reason] || 0) + 1;
  });
  assert.deepEqual(report.labelExclusions, labelExclusions);
  assert.deepEqual(ledger.maturityQueue, report.maturityQueue); assert.deepEqual(ledger.predictions, trace);
  for (const output of [report, ledger]) {
    assert.equal(output.protocolId, protocol.id); assert.equal(output.inputs.protocol.sha256, loaded.protocolSha256);
    assert.deepEqual(output.inputs.frozenDependencies, protocol.frozenDependencies);
    assert.equal(output.inputs.researchEngine.path, ENGINE); assert.equal(output.inputs.researchEngine.sha256, sha(fs.readFileSync(path.join(ROOT, ENGINE))));
    assert.equal(output.inputs.maturityQueueSha256, sha(JSON.stringify(report.maturityQueue))); assert.equal(output.inputs.predictionTraceSha256, sha(JSON.stringify(trace)));
    assert.equal(output.inputs.marketCalendarSha256, sha(JSON.stringify(market.map(r => r.day))));
    assert.equal(output.inputs.actualCnyPriceRowsSha256, sha(JSON.stringify(market.map(({ day, prices }) => ({ day, prices })))));
    const source = output.inputs.sourceSnapshot.v2Inputs;
    assert.equal(source.catalog.sha256, loaded.fingerprints.catalog);
    for (const h of loaded.fingerprints.histories) subset(source.histories.find(r => r.id === h.id), h, 'source history');
  }
  assert.equal(report.statisticsSha256, sha(JSON.stringify({ maturityQueue: report.maturityQueue, dailyPredictions: trace, results: report.results,
    coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows, primaryPredictionDiagnostics: report.primaryPredictionDiagnostics, decision: report.decision })));
  let pointer = 0, chain = sha(''), availableN = 0, multiMaturityDays = 0;
  for (let t = 0; t < market.length; t++) {
    const before = pointer;
    while (pointer < labels.length && labels[pointer].exitIndex < t) { chain = sha(chain + '\n' + JSON.stringify(report.maturityQueue[pointer])); pointer++; }
    const p = trace[t], last = pointer ? labels[pointer - 1] : null, ready = pointer >= MIN && features[t - 1]?.every(finite);
    subset(p, { day: market[t].day, executionDay: market[t].day, featureDay: market[t - 1]?.day ?? null, labelHoldingYears: 1, trainingN: pointer,
      trainingQueuePrefixLength: pointer, latestTrainingExit: last?.exitDay ?? null, latestTrainingEntry: last?.entryDay ?? null,
      trainingPoolSha256: chain, newlyMatureLabels: pointer - before }, 'daily causal header ' + t);
    if (pointer - before > 1) multiMaturityDays++;
    if (!ready) { assert.equal(p.predictedY, null); assert.equal(p.offset, null); }
    else { assert.ok(finite(p.predictedY)); assert.equal(p.offset, p.predictedY > 1e-12 ? 5 : 0); availableN++; }
  }
  const fits = fitDates(market, features, labels), predictions = market.map((row, i) => ({ day: row.day, featureDay: market[i - 1]?.day ?? null, trainingN: 0, predictedY: null, offset: null }));
  let availableFits = 0;
  for (const [index, expected] of fits) { subset(trace[index], expected, 'batch prediction ' + market[index].day, predictionErrors); predictions[index] = expected; if (expected.predictedY !== null) availableFits++; }
  const monthlyIndices = new Set([1, 10, 20].flatMap(day => Scope.arrivalCalendar(market, day).filter(r => r.index !== null).map(r => r.index)));
  const monthlyFits = [...monthlyIndices].filter(i => predictions[i].predictedY !== null).length;
  const calendarAudit = protocol.preOutcomeCalendarAudit;
  assert.equal(labels[0].entryDay, calendarAudit.firstLabelEntry); assert.equal(labels[0].exitDay, calendarAudit.firstLabelExit);
  assert.equal(labels[755].entryDay, calendarAudit.label756Entry); assert.equal(labels[755].exitDay, calendarAudit.label756Exit);
  assert.equal(trace.find(p => p.predictedY !== null).day, calendarAudit.firstPrediction);
  const panels = new Map(), episodes = [];
  for (const calendarDay of [1, 10, 20]) for (const evaluation of ['equal_age_lot', 'twelve_deposit_account']) for (const years of [1, 3]) {
    const panel = Scope.independentEpisodes(market, predictions, scope, calendarDay, evaluation, years);
    assert.deepEqual(parent.episodes.partitions.map(p => panel.episodes.filter(e => e.partition === p.id).length), calendarAudit.perCalendarEligibleCountsDevelopmentValidationReplication[evaluation + '_' + years]);
    panels.set([calendarDay, evaluation, years].join('/'), panel); episodes.push(...panel.episodes);
  }
  const coverage = unique(report.coverage, r => [r.calendarDay, r.evaluation, r.years].join('/'), 'coverage'); assert.equal(coverage.size, 12);
  const reasonMap = { prediction_warmup_at_start: 'prediction_unavailable_at_start', prediction_unavailable_on_arrival: 'prediction_unavailable_on_funding_date',
    unmatured_terminal: 'terminal_outcome_unmatured', delayed_terminal: 'terminal_close_more_than_14_calendar_days_late', crossing_partition: 'complete_outcome_crosses_partition', outside_partitions: 'outside_registered_partitions' };
  for (const [key, panel] of panels) {
    const c = coverage.get(key); assert.ok(c); assert.equal(c.attemptedStartMonths, panel.calendar.length); assert.equal(c.eligibleEpisodeCount, panel.episodes.length);
    subset(c.scheduledMonths, panel.calendar, key + '.calendar'); assert.equal(c.rejected.length, panel.rejected.length);
    const actualRejected = unique(c.rejected, r => r.month, 'rejected months'), counts = {};
    for (const r of panel.rejected) {
      const observed = actualRejected.get(r.month); assert.ok(observed);
      const reason = reasonMap[r.reason]; if (reason) assert.equal(observed.reason, reason, key + ': exclusion ' + r.month);
      else assert.ok(['missing_first_arrival', 'missing_required_month'].includes(r.reason));
      counts[observed.reason] = (counts[observed.reason] || 0) + 1;
    }
    assert.deepEqual(c.excluded, counts); assert.equal(sum(Object.values(c.excluded)), panel.rejected.length);
  }
  const windows = unique(ledger.windows, windowKey, 'base ledger'), pairedWindows = unique(report.pairedBaseWindows, windowKey, 'paired summaries');
  assert.equal(windows.size, episodes.length); assert.equal(pairedWindows.size, episodes.length);
  const rules = [{ id: MODEL }, ...protocol.benchmarks], caches = new Map(); let tradeN = 0, flowN = 0, lotIdentities = 0;
  for (const scenario of parent.scenarios) {
    const cache = new Map(); caches.set(scenario.id, cache);
    for (const episode of episodes) {
      const key = windowKey(episode), accounts = new Map(rules.map(rule => [rule.id, independentAccount(market, episode, rule, scenario, parent.portfolio, predictions)])); cache.set(key, accounts);
      if (scenario.id !== 'base') continue;
      const recorded = windows.get(key), scalar = pairedWindows.get(key); assert.ok(recorded && scalar);
      for (const output of [recorded, scalar]) { assert.equal(output.scenario, 'base'); assert.equal(output.lastFundingDay, episode.lastFundingDay); assert.equal(output.anniversary, episode.anniversary);
        assert.deepEqual(output.fundingPlan, episode.fundingPlan); assert.deepEqual(Object.keys(output.rules).sort(), rules.map(r => r.id).sort()); }
      for (const rule of rules) {
        const expected = accounts.get(rule.id); compareAccount(recorded.rules[rule.id], expected, key + '/' + rule.id, ledgerErrors, trace);
        for (const field of ACCOUNT_FIELDS) close(scalar.rules[rule.id][field], expected[field], 'published.' + field);
        close(scalar.rules[rule.id].deltaVsImmediatePp, 100 * (expected.terminalWealth - accounts.get('immediate').terminalWealth) / expected.contributed, 'published.deltaPp');
        tradeN += expected.trades.length; flowN += expected.externalFlows.length;
      }
      if (episode.evaluation === 'equal_age_lot' && episode.years === 1) {
        const label = byEntry.get(episode.startIndex), p = predictions[episode.startIndex]; assert.ok(label); assert.equal(label.exitDay, episode.end);
        close(accounts.get(MODEL).terminalWealth - accounts.get('immediate').terminalWealth, 100 * (p.offset === 5 ? label.y : 0), 'candidate lot label identity');
        close(accounts.get('fixed_delay5').terminalWealth - accounts.get('immediate').terminalWealth, 100 * label.y, 'fixed delay label identity'); lotIdentities++;
      }
    }
  }
  const groups = unique(report.results, groupKey, '108 registered cells'); assert.equal(groups.size, 108);
  const computed = new Map(), primary = new Map(), counts = [], statuses = {}; let pairs = 0, emptyGroups = 0;
  for (const [panelKey, panel] of panels) for (const partition of parent.episodes.partitions) for (const scenario of parent.scenarios) {
    const [calendarString, evaluation, yearString] = panelKey.split('/'), calendarDay = +calendarString, horizonYears = +yearString;
    const key = groupKey({ calendarDay, evaluation, horizonYears, partition: partition.id, scenario: scenario.id }), group = groups.get(key); assert.ok(group);
    const selected = panel.episodes.filter(e => e.partition === partition.id), block = (evaluation === 'equal_age_lot' ? 0 : 12) + 12 * horizonYears;
    assert.equal(group.primaryCalendar, calendarDay === 1); assert.deepEqual(group.startRange, selected.length ? { first: selected[0].start, last: selected.at(-1).start } : null);
    subset(group.decisionCoverage, Scope.decisionsFor(selected, predictions), key + '.distinct decisions');
    assert.deepEqual(group.rules.map(r => r.id).sort(), rules.map(r => r.id).sort()); if (!selected.length) emptyGroups++;
    const cache = caches.get(scenario.id), cell = new Map(); computed.set(key, cell);
    for (const rule of rules) {
      const recorded = group.rules.find(r => r.id === rule.id), a = selected.map(e => cache.get(windowKey(e)).get(rule.id)), expected = { summary: summary(a) };
      subset(recorded.summary, expected.summary, key + '.summary');
      for (const [field, baseline] of [['vsImmediate', 'immediate'], ['vsFixedDelay5', 'fixed_delay5'], ['vsThreeTranches', 'three_tranches']]) {
        const b = selected.map(e => cache.get(windowKey(e)).get(baseline)), paired = pair(a, b, block); expected[field] = paired;
        subset(recorded[field], paired, key + '.' + field); const interval = recorded[field].meanInterval;
        subset(interval, { draws: 2000, seed: 0x6d2b79f5, method: 'non_circular_moving_block', prng: 'Mulberry32' }, key + '.interval metadata');
        statuses[interval.status] = (statuses[interval.status] || 0) + 1; pairs++;
      }
      cell.set(rule.id, expected);
    }
    if (scenario.id === 'base') counts.push({ calendarDay, evaluation, years: horizonYears, partition: partition.id, n: selected.length, nonOverlappingN: nonOverlap(selected), blockLength: block });
    if (calendarDay === 1 && evaluation === 'equal_age_lot' && horizonYears === 1 && scenario.id === 'base') {
      const rows = selected.map(e => { const p = predictions[e.startIndex], accounts = cache.get(windowKey(e)); return { ...p, start: e.start, end: e.end,
        deltaPp: accounts.get(MODEL).terminalWealth - accounts.get('immediate').terminalWealth, actualY: byEntry.get(e.startIndex).y, referenceForecast: p.trainingMeanY }; });
      const evidence = group.rules.find(r => r.id === MODEL).primaryEvidence;
      primary.set(partition.id, comparePrimary(evidence, cell.get(MODEL).vsImmediate, rows, protocol));
      const diagnostic = report.primaryPredictionDiagnostics.find(d => d.partition === partition.id); assert.ok(diagnostic);
      assert.ok(!('maturedFiveSessionLabels' in diagnostic)); subset(diagnostic, independentDiagnostics(rows), partition.id + '.annual diagnostic');
      close(diagnostic.identityMaximumErrorPp, 0, partition.id + '.identity error');
    }
  }
  const decision = verifyConfirmation(report, computed, primary, protocol), causalChecks = engineCausality(market, parent.portfolio, trace);
  return { status: 'passed', protocolId: protocol.id, method: 'independent annual unit-difference labels; explicit mature-row population-standardized batch ridge; independent source-price claims and unitized NAV; independent gates and BigInt block bootstrap',
    annualLabels: labels.length, dailyMaturityHeaders: trace.length, multiLabelMaturityDays: multiMaturityDays, availableDailyPredictions: availableN,
    batchFits: availableFits, distinctMonthlyFits: monthlyFits, additionalDailyFits: availableFits - monthlyFits, checkedDateCutsIncludingWarmup: fits.size,
    firstAvailablePrediction: trace.find(p => p.predictedY !== null).day, latestPredictionTrainingN: trace.at(-1).trainingN,
    registeredGroups: groups.size, emptyGroups, baseWindows: episodes.length, baseAccounts: episodes.length * rules.length, independentlyRecomputedAllScenarioAccounts: episodes.length * rules.length * parent.scenarios.length,
    baseTrades: tradeN, baseExternalFlows: flowN, annualLotLabelIdentities: lotIdentities, independentlyRecomputedPairs: pairs, intervalStatuses: statuses,
    groups: counts, primary: Object.fromEntries([...primary].map(([phase, value]) => [phase, { status: value.status, passed: value.passed, actions: value.actions, concentrationPassed: value.concentration.passed }])),
    decision, causalChecks, maximumAbsoluteLabelDifferences: labelErrors, maximumAbsolutePredictionDifferences: predictionErrors, maximumAbsoluteLedgerDifferences: ledgerErrors,
    sourceFingerprints: loaded.fingerprints, protocolSha256: loaded.protocolSha256,
    limitations: ['Hashes verify consistency with the saved sources, not vendor quote accuracy or historical data vintages.',
      'Full trade/attribution ledgers are published and checked for base only. All three scenarios have independent terminal value, fee, interest, NAV-risk and summary reconstructions; stress trade-ledger comparisons are unavailable.',
      'Numerical batch regression is checked at every actual 1/10/20 monthly arrival plus fixed extra historical cuts. Daily maturation, pool lineage and action threshold are checked on the full trace; non-scheduled daily coefficients are not all independently refit.',
      'Producer future-mutation checks are metamorphic tests and are separate from the independent expected-value construction.',
      'This audit cannot turn exposed, overlapping historical samples into untouched evidence, resolve the user holding-period preference, validate personal taxes, or authorize a score/integration.'] };
}
function selfTest() {
  const checks = [], test = (name, fn) => { fn(); checks.push(name); };
  const portfolio = { strategicCashWeight: .4, positions: [{ id: 'a', weight: .3 }, { id: 'b', weight: .3 }] };
  test('annual endpoint and whole-deposit fee/weight formula', () => {
    const days = ['2019-01-01', '2019-01-02', '2019-01-03', '2019-01-04', '2019-01-07', '2019-01-08', '2019-01-09', '2020-01-02'];
    const prices = days.map(day => ({ day, prices: [100, 100] })); prices[6].prices = [90, 110]; prices[7].prices = [180, 110];
    const f = prices.map(() => [0, 0, 0, 0, 0]), labels = annualLabels(prices, f, portfolio), first = labels[0];
    assert.equal(first.entryIndex, 1); assert.equal(first.exitIndex, 7); assert.equal(first.anniversary, '2020-01-02');
    close(first.y, .03 * .999 / 1.001, 'whole deposit label');
    const ep = { startIndex: 1, endIndex: 7, start: prices[1].day, end: prices[7].day, fundingPlan: [{ index: 1, day: prices[1].day, amount: 100 }] };
    const base = { annualCashRate: 0, feeRate: .001, capitalTaxRate: 0, dividendTaxRate: 0 };
    const now = independentAccount(prices, ep, { id: 'immediate', offsets: [0] }, base, portfolio, []);
    const later = independentAccount(prices, ep, { id: 'fixed_delay5', offsets: [5] }, base, portfolio, []);
    close(later.terminalWealth - now.terminalWealth, 100 * first.y, 'ledger delta equals label');
    prices[7].day = '2020-01-17'; assert.ok(!annualLabels(prices, f, portfolio).some(r => r.entryIndex === 1), 'late anniversary excluded');
  });
  const synthetic = [];
  for (let ms = date('2010-01-01'); synthetic.length < 1600; ms += DAY) {
    const d = new Date(ms); if ([0, 6].includes(d.getUTCDay())) continue;
    const i = synthetic.length; synthetic.push({ day: d.toISOString().slice(0, 10), prices: [10 * Math.exp(i / 800 + .03 * Math.sin(i / 13)), 20 * Math.exp(i / 900 + .04 * Math.cos(i / 11))] });
  }
  const parent = { portfolio, signal: { ma: 200, returnLookback: 21 } };
  const market = Source.attachFeatures(synthetic, parent), features = Batch.featureRows(market), labels = annualLabels(market, features, portfolio);
  test('first label uses 200 strictly prior common closes', () => { assert.equal(labels[0].entryIndex, 200); assert.equal(labels[0].featureDay, market[199].day); });
  test('same-close multiple annual labels mature together', () => {
    const duplicate = labels.find((r, i) => i && labels[i - 1].exitIndex === r.exitIndex); assert.ok(duplicate);
    const before = labels.filter(r => r.exitIndex < duplicate.exitIndex).length, same = labels.filter(r => r.exitIndex === duplicate.exitIndex).length;
    assert.equal(predict(market, features, labels, duplicate.exitIndex).trainingN, before);
    assert.equal(predict(market, features, labels, duplicate.exitIndex + 1).trainingN, before + same);
  });
  const first = market.findIndex((_, i) => labels.filter(r => r.exitIndex < i).length >= MIN);
  test('756 fully matured labels and strict preceding-close boundary', () => {
    assert.equal(predict(market, features, labels, first - 1).predictedY, null);
    assert.ok(finite(predict(market, features, labels, first).predictedY));
    assert.ok(predict(market, features, labels, first).latestTrainingExit < market[first].day);
  });
  test('batch lambda1 population SD unpenalized intercept', () => {
    const rows = Array.from({ length: 756 }, (_, i) => ({ x: [i % 2 ? 1 : -1, 3, 0, 0, 0], y: i % 2 ? 5 : 1 }));
    const fit = Batch.batchRidge(rows, [1, 3, 0, 0, 0]); close(fit.featureStd[0], 1, 'population SD'); close(fit.beta[0], 1, 'mean MSE lambda'); close(fit.predictedY, 4, 'free intercept');
  });
  test('independent prediction is invariant to current/future price mutation and truncation', () => {
    const expected = predict(market, features, labels, first);
    const altered = synthetic.map((r, i) => ({ ...r, prices: i >= first ? r.prices.map((p, j) => p * (j ? .01 : 100)) : r.prices.slice() }));
    const changed = Source.attachFeatures(altered, parent), changedX = Batch.featureRows(changed);
    assert.deepEqual(predict(changed, changedX, annualLabels(changed, changedX, portfolio), first), expected);
    const prefix = market.slice(0, first + 1), prefixX = features.slice(0, first + 1);
    assert.deepEqual(predict(prefix, prefixX, annualLabels(prefix, prefixX, portfolio), first), expected);
  });
  test('February 29 clamps and absence does not create an early endpoint', () => {
    assert.equal(Scope.anniversary('2020-02-29', 1), '2021-02-28');
    const rows = [{ day: '2020-02-28', prices: [1, 1] }, { day: '2020-02-29', prices: [1, 1] }, ...Array.from({ length: 5 }, (_, i) => ({ day: `2020-03-0${i + 1}`, prices: [1, 1] })), { day: '2021-03-01', prices: [1, 1] }];
    const label = annualLabels(rows, rows.map(() => Array(5).fill(0)), portfolio)[0]; assert.equal(label.anniversary, '2021-02-28'); assert.equal(label.exitDay, '2021-03-01');
    assert.equal(annualLabels(rows.slice(0, -1), rows.map(() => Array(5).fill(0)), portfolio).length, 0);
  });
  const decisions = Array.from({ length: 36 }, (_, i) => ({ start: monthName(2019 * 12 + i) + '-02', end: monthName(2020 * 12 + i) + '-02', offset: i % 3 ? 0 : 5, deltaPp: i % 3 ? 0 : 3 }));
  test('action evidence includes abstention zeros and does not duplicate rolling windows', () => {
    const a = actionEvidence(decisions); assert.equal(a.delayedMonths, 12); assert.equal(a.arrivalYearCount, 3); assert.equal(a.positiveShare, 1); assert.equal(a.nonOverlappingDelayedN, 3);
    assert.equal(quantile(decisions.map(r => r.deltaPp), .5), 0); assert.throws(() => actionEvidence([...decisions, decisions[0]]));
  });
  test('concentration preserves zeros and enumerates calendar blocks despite missing months', () => {
    const c = concentration(decisions); assert.equal(c.deleteYear.length, 3); assert.equal(c.delete12Months.length, 25); assert.equal(c.passed, true);
    const missing = concentration(decisions.filter((_, i) => i !== 4)); assert.equal(missing.delete12Months.length, 25); assert.equal(missing.delete12Months[0].removedN, 11);
    assert.equal(concentration(decisions.slice(0, 23)).passed, false);
    const oneYear = decisions.map(r => ({ ...r, deltaPp: r.start.startsWith('2020') ? 2 : 0 })); assert.equal(concentration(oneYear).passed, false);
  });
  test('monetary tolerance differs from strict wins and exact action ratios/counts', () => {
    assert.equal(positive(1e-10), false); assert.equal(positive(1.01e-10), true); assert.equal(ge(-.5e-10, 0), true);
    assert.equal(ratioGe(.6 - 1e-12, .6), false); assert.equal(countGe(11.99999999999, 12), false);
    for (const value of [null, undefined, NaN, Infinity]) { assert.equal(ge(value, 0), false); assert.equal(positive(value), false); }
  });
  test('new primary gates permit abstention but reject thin action evidence and empty samples', () => {
    const p = { selectionAndConfirmation: { unconditionalGates: { minimumMeanDeltaPp: .5, minimumMedianDeltaPp: 0, minimumP10AccountReturnDifferencePp: -1,
      minimumMedianDrawdownDifferencePp: -2, minimumWorstDrawdownDifferencePp: -2 }, actionGates: { minimumUniqueDelayedMonths: 12, minimumArrivalYearsWithDelay: 3,
      minimumNonOverlappingDelayedOneYearWindows: 3, minimumStrictPositiveShareAmongDelayedMonths: .6, minimumMedianDeltaPpAmongDelayedMonths: .5 } } };
    const paired = { n: 36, meanDeltaPp: 1, medianDeltaPp: 0, p10AccountReturnDifferencePp: 0, medianMaxDrawdownDifferencePp: 0, worstMaxDrawdownDifferencePp: 0 };
    const actions = actionEvidence(decisions), concentrated = concentration(decisions);
    assert.equal(primaryPass(paired, actions, concentrated, p).passed, true);
    assert.equal(primaryPass({ ...paired, n: 0 }, actions, concentrated, p).passed, false);
    assert.equal(primaryPass(paired, { ...actions, delayedMonths: 11 }, concentrated, p).passed, false);
    assert.equal(primaryPass(paired, { ...actions, nonOverlappingDelayedN: 2 }, concentrated, p).passed, false);
    assert.equal(primaryPass(paired, { ...actions, positiveShare: .6 - 1e-12 }, concentrated, p).passed, false);
    assert.equal(primaryPass({ ...paired, meanDeltaPp: null }, actions, concentrated, p).passed, false);
  });
  test('complete observed block is coverage only; every incomplete calendar block is still tested', () => {
    const c = concentration(decisions.filter((_, i) => i !== 4));
    assert.ok(c.fullyObservedBlocks > 0); assert.equal(c.delete12Months.length, 25);
    assert.ok(c.delete12Months.some(b => !b.complete));
    const sparse = decisions.filter((_, i) => i % 3 !== 0).map((r, i) => ({ ...r, start: monthName(2019 * 12 + i * 2) + '-02', deltaPp: 1 }));
    assert.equal(sparse.length, 24); assert.equal(concentration(sparse).fullyObservedBlocks, 0); assert.equal(concentration(sparse).passed, false);
  });
  return { passed: true, cases: checks.length, checks, reusedIndependentScopeSyntheticTests: Scope.selfTest() };
}
module.exports = { annualLabels, predict, fitDates, actionEvidence, concentration, primaryPass, independentAccount, readInputs, auditReports, selfTest };
if (require.main === module) {
  const args = process.argv.slice(2), selfTests = selfTest();
  if (args.length === 1 && args[0] === '--self-test') console.log(JSON.stringify({ selfTests }, null, 2));
  else {
    assert.ok(args.length === 4 && args[0] === '--report' && args[2] === '--audit', 'usage: --self-test OR --report REPORT.json --audit LEDGERS.json');
    const reportBytes = fs.readFileSync(path.resolve(args[1])), ledgerBytes = fs.readFileSync(path.resolve(args[3])), loaded = readInputs();
    const result = auditReports(JSON.parse(reportBytes), JSON.parse(ledgerBytes), loaded);
    console.log(JSON.stringify({ ...result, selfTests, reportSha256: sha(reportBytes), ledgerSha256: sha(ledgerBytes),
      checkerSha256: sha(fs.readFileSync(__filename)), engineSha256: sha(fs.readFileSync(path.join(ROOT, ENGINE))),
      independentCheckerDependencies: ['scripts/check_portfolio_entry_research.cjs', 'scripts/check_portfolio_entry_predictive.cjs', 'scripts/check_portfolio_entry_scope.cjs'].map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(ROOT, file))) })),
      tolerance: { numericAbsoluteOrRelative: EPS, monetaryGateAbsolute: MONEY_EPS, actionFractionThreshold: 1e-12, ratiosAndCounts: 'exact_without_monetary_tolerance' } }, null, 2));
  }
}
