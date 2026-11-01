#!/usr/bin/env node
'use strict';
// Independent v4 audit. Own-price features, explicit shared mature rows and two
// fresh batch matrix fits; each asset/tranche is a separate cash claim. Producer
// functions are used only in separately identified future-mutation checks.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Source = require('./check_portfolio_entry_research.cjs');
const Batch = require('./check_portfolio_entry_predictive.cjs');
const Scope = require('./check_portfolio_entry_scope.cjs');
const Value = require('./check_portfolio_entry_value.cjs');
const ROOT = path.resolve(__dirname, '..'), PROTOCOL = 'docs/research/portfolio-entry-components-protocol-v4.json';
const ENGINE = 'scripts/research_portfolio_entry_components.cjs', MODEL = 'expanding_component_ridge_year1_delay5';
const IDS = ['us:USD', 'us:TQQQ'], CATEGORIES = ['both_immediate', 'delay_usd_only', 'delay_tqqq_only', 'delay_both'];
const MIN = 756, EPS = 1e-8, PP = 1e-10, DAY = 86400000, YEAR = 365.2425;
const sum = xs => xs.reduce((a, b) => a + b, 0), mean = xs => xs.length ? sum(xs) / xs.length : null;
const finite = Number.isFinite, sha = x => crypto.createHash('sha256').update(x).digest('hex');
const time = s => Date.parse(s + 'T00:00:00Z'), gap = (a, b) => (time(b) - time(a)) / DAY;
const grow = (amount, from, to, rate) => rate ? amount * (1 + rate) ** (gap(from, to) / YEAR) : amount;
const monthNumber = s => +s.slice(0, 4) * 12 + +s.slice(5, 7) - 1;
const monthName = n => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
const positive = x => finite(x) && x > PP, ge = (x, minimum) => finite(x) && x >= minimum - PP;
function close(a, b, label, errors) {
  if (b === null) return assert.equal(a, null, label);
  assert.ok(finite(a) && finite(b) && Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`);
  if (errors) { const last = label.split('.').at(-1), key = /^\d+$/.test(last) ? 'arrayElements' : last; errors[key] = Math.max(errors[key] || 0, Math.abs(a - b)); }
}
function subset(actual, expected, label, errors) {
  if (expected === null || typeof expected === 'number') return close(actual, expected, label, errors);
  if (Array.isArray(expected)) { assert.ok(Array.isArray(actual), label); assert.equal(actual.length, expected.length, label); expected.forEach((v, i) => subset(actual[i], v, label + '.' + i, errors)); return; }
  if (typeof expected === 'object') { assert.ok(actual && typeof actual === 'object', label); for (const [k, v] of Object.entries(expected)) subset(actual[k], v, label + '.' + k, errors); return; }
  assert.equal(actual, expected, label);
}
function quantile(xs, p) { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), t = p * (a.length - 1), l = Math.floor(t); return a[l] * (1 - t + l) + a[Math.ceil(t)] * (t - l); }
function nonOverlap(rows) { let n = 0, end = ''; for (const r of [...rows].sort((a, b) => a.start.localeCompare(b.start))) if (r.start > end) { n++; end = r.end; } return n; }
function ownFeatures(market) {
  const prices = IDS.map((_, j) => market.map(r => r.prices[j])), peaks = [0, 0];
  return market.map((row, i) => Object.fromEntries(IDS.map((id, j) => {
    const p = prices[j]; peaks[j] = Math.max(peaks[j], p[i]);
    if (i < 199) return [id, null];
    const returns = Array.from({ length: 21 }, (_, k) => p[i - 20 + k] / p[i - 21 + k] - 1), average = mean(returns);
    return [id, [p[i] / mean(p.slice(i - 199, i + 1)) - 1, p[i] / peaks[j] - 1, p[i] / p[i - 5] - 1,
      p[i] / p[i - 21] - 1, Math.sqrt(sum(returns.map(r => (r - average) ** 2)) / 20)]];
  })));
}
const complete = x => IDS.every(id => Array.isArray(x?.[id]) && x[id].length === 5 && x[id].every(finite));
function annualLabels(market, features) {
  const queue = [], excluded = {};
  market.forEach((row, s) => {
    let reason;
    if (!s || !complete(features[s - 1])) reason = 'incomplete_prior_features';
    const anniversary = Scope.anniversary(row.day, 1), end = reason ? -1 : market.findIndex(r => r.day >= anniversary);
    if (!reason && end < 0) reason = 'year_terminal_not_observed';
    if (!reason && gap(anniversary, market[end].day) > 14) reason = 'year_terminal_more_than_14_days_late';
    if (!reason && s + 5 > end) reason = 'five_session_purchase_after_terminal';
    if (reason) { excluded[reason] = (excluded[reason] || 0) + 1; return; }
    const components = Object.fromEntries(IDS.map((id, j) => [id, { features: features[s - 1][id].slice(),
      y: .999 / 1.001 * .3 * market[end].prices[j] * (1 / market[s + 5].prices[j] - 1 / row.prices[j]) }]));
    assert.ok(IDS.every(id => finite(components[id].y)));
    queue.push({ entryIndex: s, entryDay: row.day, featureDay: market[s - 1].day, exitIndex: end, exitDay: market[end].day, anniversary, components });
  });
  return { queue: queue.sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex), excluded };
}
function actions(components) {
  const legOffsets = Object.fromEntries(IDS.map(id => [id, components[id].predictedY > 1e-12 ? 5 : 0]));
  const mask = (legOffsets[IDS[0]] ? 1 : 0) + (legOffsets[IDS[1]] ? 2 : 0);
  return { legOffsets, anyDelay: mask !== 0, actionCategory: CATEGORIES[mask] };
}
function available(p) { return Number.isInteger(p?.trainingN) && p.trainingN >= MIN && IDS.every(id => finite(p.components?.[id]?.predictedY) && [0, 5].includes(p.legOffsets?.[id])); }
function predict(market, features, queue, t) {
  const pool = queue.filter(e => e.exitIndex < t), last = pool.at(-1);
  const header = { day: market[t].day, featureDay: market[t - 1]?.day ?? null, trainingN: pool.length, latestTrainingEntry: last?.entryDay ?? null, latestTrainingExit: last?.exitDay ?? null };
  if (pool.length < MIN || !complete(features[t - 1])) return { ...header, legOffsets: null, anyDelay: null, actionCategory: null };
  const components = Object.fromEntries(IDS.map(id => {
    const x = features[t - 1][id], fit = Batch.batchRidge(pool.map(e => ({ x: e.components[id].features, y: e.components[id].y })), x, 1);
    const { offset, ...coefficients } = fit;
    return [id, { features: x.slice(), ...coefficients, predictedFullDepositBps: fit.predictedY * 10000 }];
  }));
  return { ...header, components, ...actions(components) };
}
function fitDates(market, features, queue) {
  const monthly = new Set([1, 10, 20].flatMap(day => Scope.arrivalCalendar(market, day).filter(r => r.index !== null).map(r => r.index))), cuts = new Set(monthly);
  const first = market.findIndex((_, t) => queue.filter(e => e.exitIndex < t).length >= MIN);
  for (const t of [0, 199, 200, first - 1, first, first + 1, market.length - 1]) if (t >= 0 && t < market.length) cuts.add(t);
  for (let t = 0; t < market.length; t += 97) cuts.add(t);
  for (const year of ['2018', '2019', '2022', '2023']) { const t = market.findIndex(r => r.day >= year + '-01-01'); if (t >= 0) cuts.add(t); }
  return { monthly, fits: new Map([...cuts].sort((a, b) => a - b).map(t => [t, predict(market, features, queue, t)])) };
}
function episodesFor(market, predictions, partitions, calendarDay, evaluation, years) {
  const calendar = Scope.arrivalCalendar(market, calendarDay), months = new Map(calendar.map(r => [r.month, r])), count = evaluation === 'equal_age_lot' ? 1 : 12, episodes = [], rejected = [];
  for (const first of calendar) {
    let reason = null;
    const funding = Array.from({ length: count }, (_, i) => months.get(monthName(monthNumber(first.month) + i)));
    if (first.index === null) reason = 'missing_first_arrival';
    else if (!available(predictions[first.index])) reason = 'prediction_unavailable_at_start';
    else if (funding.some(r => !r || r.index === null)) reason = 'missing_required_month';
    else if (funding.some(r => !available(predictions[r.index]))) reason = 'prediction_unavailable_on_funding_date';
    if (reason) { rejected.push({ month: first.month, reason }); continue; }
    const phase = partitions.find(p => (!p.start || first.day >= p.start) && (!p.end || first.day <= p.end)), anchor = funding.at(-1).day;
    const anniversary = Scope.anniversary(anchor, years), end = market.findIndex(r => r.day >= anniversary);
    if (!phase) reason = 'outside_registered_partitions';
    else if (end < 0) reason = 'terminal_outcome_unmatured';
    else if (gap(anniversary, market[end].day) > 14) reason = 'terminal_close_more_than_14_calendar_days_late';
    else if (phase.end && market[end].day > phase.end) reason = 'complete_outcome_crosses_partition';
    if (reason) { rejected.push({ month: first.month, reason }); continue; }
    episodes.push({ calendarDay, evaluation, years, start: first.day, startIndex: first.index, end: market[end].day, endIndex: end,
      anniversary, lastFundingDay: anchor, partition: phase.id, depositCount: count, fundingPlan: funding.map(r => ({ day: r.day, index: r.index, amount: 100, requestedDay: r.requestedDay })) });
  }
  return { calendar, episodes, rejected };
}
function account(market, episode, rule, scenario, predictions) {
  assert.equal(scenario.capitalTaxRate, 0); assert.equal(scenario.dividendTaxRate, 0);
  const deposits = episode.fundingPlan.map(flow => ({ ...flow, strategic: .4 * flow.amount, lots: IDS.flatMap((id, j) => {
    const offsets = rule.id === MODEL ? [predictions[flow.index].legOffsets[id]] : rule.offsets;
    return offsets.map(offset => {
      const original = .3 * flow.amount / offsets.length, scheduledIndex = flow.index + offset, executedIndex = scheduledIndex <= episode.endIndex ? scheduledIndex : null;
      const budget = executedIndex === null ? 0 : grow(original, flow.day, market[executedIndex].day, scenario.annualCashRate), notional = budget / (1 + scenario.feeRate);
      const units = executedIndex === null ? 0 : notional / market[executedIndex].prices[j], buyFees = notional * scenario.feeRate;
      const sellFees = units * market[episode.endIndex].prices[j] * scenario.feeRate;
      return { id, j, original, offset, scheduledIndex, executedIndex, units, buyFees, sellFees };
    });
  }) }));
  function claim(deposit, t, before = false, liquidate = false) {
    if (deposit.index > t || before && deposit.index === t) return 0;
    let result = grow(deposit.strategic, deposit.day, market[t].day, scenario.annualCashRate);
    for (const lot of deposit.lots) {
      const waiting = lot.executedIndex === null || lot.executedIndex > t || before && lot.executedIndex === t;
      result += waiting ? grow(lot.original, deposit.day, market[t].day, scenario.annualCashRate) : lot.units * market[t].prices[lot.j] * (liquidate ? 1 - scenario.feeRate : 1);
    }
    return result;
  }
  const contributionAttribution = deposits.map(deposit => {
    const strategicCash = grow(deposit.strategic, deposit.day, episode.end, scenario.annualCashRate);
    const scheduledPurchases = deposit.lots.map(l => ({ id: l.id, offset: l.offset, scheduledDay: market[l.scheduledIndex]?.day ?? null,
      scheduledIndex: l.scheduledIndex, executedDay: l.executedIndex === null ? null : market[l.executedIndex].day,
      originalBudget: l.original, waitingInterest: grow(l.original, deposit.day, l.executedIndex === null ? episode.end : market[l.executedIndex].day, scenario.annualCashRate) - l.original,
      units: l.units, buyFees: l.buyFees, sellFees: l.sellFees, terminalGrossValue: l.units * market[episode.endIndex].prices[l.j],
      productLiquidationValue: l.units * market[episode.endIndex].prices[l.j] - l.sellFees,
      pendingCash: l.executedIndex === null ? grow(l.original, deposit.day, episode.end, scenario.annualCashRate) : 0,
      waitSessions: (l.executedIndex ?? episode.endIndex) - deposit.index }));
    const pendingCash = sum(scheduledPurchases.map(l => l.pendingCash)), productLiquidationValue = sum(scheduledPurchases.map(l => l.productLiquidationValue));
    const components = Object.fromEntries(IDS.map(id => { const purchases = scheduledPurchases.filter(l => l.id === id).map(({id, ...l}) => l);
      return [id, { originalBudget: deposit.amount * .3, pendingCash: sum(purchases.map(l => l.pendingCash)), productLiquidationValue: sum(purchases.map(l => l.productLiquidationValue)),
        terminalWealth: sum(purchases.map(l => l.pendingCash + l.productLiquidationValue)), fees: sum(purchases.map(l => l.buyFees + l.sellFees)),
        waitingInterest: sum(purchases.map(l => l.waitingInterest)), executedUnits: sum(purchases.map(l => l.units)), scheduledPurchases: purchases }]; }));
    return { arrivalDay: deposit.day, amount: deposit.amount, strategicCash, strategicInterest: strategicCash - deposit.strategic, components,
      ...(rule.id === MODEL ? {legOffsets: predictions[deposit.index].legOffsets, anyDelay: predictions[deposit.index].anyDelay, actionCategory: predictions[deposit.index].actionCategory} : {}),
      terminalWealth: strategicCash + pendingCash + productLiquidationValue, fees: sum(scheduledPurchases.map(l => l.buyFees + l.sellFees)),
      interest: strategicCash - deposit.strategic + sum(scheduledPurchases.map(l => l.waitingInterest)) };
  });
  let fundUnits = 0, peak = 1, maxDrawdownPp = 0;
  for (let t = episode.startIndex; t <= episode.endIndex; t++) {
    const arrival = deposits.find(r => r.index === t);
    if (arrival) fundUnits += arrival.amount / (fundUnits ? sum(deposits.map(d => claim(d, t, true))) / fundUnits : 1);
    const nav = sum(deposits.map(d => claim(d, t, false, t === episode.endIndex))) / fundUnits;
    peak = Math.max(peak, nav); maxDrawdownPp = Math.min(maxDrawdownPp, 100 * (nav / peak - 1));
  }
  const lots = deposits.flatMap(d => d.lots.map(l => ({ ...l, arrival: d }))), bought = lots.filter(l => l.executedIndex !== null);
  const trades = bought.map(l => ({ day: market[l.executedIndex].day, side: 'buy', id: l.id, arrivalDay: l.arrival.day,
    units: l.units, price: market[l.executedIndex].prices[l.j], notional: l.units * market[l.executedIndex].prices[l.j], fee: l.buyFees, waitSessions: l.offset }));
  IDS.forEach((id, j) => { const units = sum(bought.filter(l => l.id === id).map(l => l.units)); if (units) trades.push({ day: episode.end, side: 'sell', id, units,
    price: market[episode.endIndex].prices[j], notional: units * market[episode.endIndex].prices[j], fee: units * market[episode.endIndex].prices[j] * scenario.feeRate }); });
  const contributed = sum(deposits.map(d => d.amount)), terminalWealth = sum(contributionAttribution.map(d => d.terminalWealth));
  return { ...episode, contributed, terminalWealth, accountReturnPp: 100 * (terminalWealth / contributed - 1), navReturnPp: 100 * (terminalWealth / fundUnits - 1), maxDrawdownPp,
    fees: sum(contributionAttribution.map(d => d.fees)), interest: sum(contributionAttribution.map(d => d.interest)), pendingCash: sum(contributionAttribution.flatMap(d => IDS.map(id => d.components[id].pendingCash))), pendingLots: lots.length - bought.length,
    meanWaitSessions: sum(lots.map(l => l.original * ((l.executedIndex ?? episode.endIndex) - l.arrival.index))) / sum(lots.map(l => l.original)),
    executedMeanWaitSessions: bought.length ? sum(bought.map(l => l.original * (l.executedIndex - l.arrival.index))) / sum(bought.map(l => l.original)) : null,
    externalFlows: deposits.map(({ day, amount }) => ({ day, amount })), contributionAttribution, trades };
}
function actionEvidence(rows) {
  assert.equal(new Set(rows.map(r => r.start)).size, rows.length);
  const acted = rows.filter(r => r.anyDelay), years = [...new Set(acted.map(r => r.start.slice(0, 4)))].sort();
  return { allMonths: rows.length, delayedMonths: acted.length, arrivalYears: years, arrivalYearCount: years.length, nonOverlappingDelayedN: nonOverlap(acted),
    positiveShare: acted.length ? acted.filter(r => positive(r.deltaPp)).length / acted.length : null, medianDeltaPp: quantile(acted.map(r => r.deltaPp), .5), meanDeltaPp: mean(acted.map(r => r.deltaPp)),
    componentActionCounts: Object.fromEntries(IDS.map(id => [id, rows.filter(r => r.legOffsets[id] === 5).length])) };
}
function summary(rows) { return { n: rows.length, nonOverlappingN: nonOverlap(rows), meanAccountReturnPp: mean(rows.map(r => r.accountReturnPp)), medianAccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .5), p10AccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .1),
  medianMaxDrawdownPp: quantile(rows.map(r => r.maxDrawdownPp), .5), worstMaxDrawdownPp: rows.length ? Math.min(...rows.map(r => r.maxDrawdownPp)) : null, meanWaitSessions: mean(rows.map(r => r.meanWaitSessions)), meanFees: mean(rows.map(r => r.fees)), meanInterest: mean(rows.map(r => r.interest)), pendingEpisodes: rows.filter(r => r.pendingCash > 1e-9).length }; }
function paired(rows, baseline, block) {
  const delta = rows.map((r, i) => { assert.deepEqual(r.externalFlows, baseline[i].externalFlows); return 100 * (r.terminalWealth - baseline[i].terminalWealth) / r.contributed; });
  const a = summary(rows), b = summary(baseline), diff = k => a[k] === null ? null : a[k] - b[k];
  return { n: rows.length, nonOverlappingN: a.nonOverlappingN, identicalExternalFlows: true, meanDeltaPp: mean(delta), medianDeltaPp: quantile(delta, .5), positiveDeltaShare: rows.length ? delta.filter(positive).length / rows.length : null,
    pairedDeltaP10Pp: quantile(delta, .1), p10AccountReturnDifferencePp: diff('p10AccountReturnPp'), medianMaxDrawdownDifferencePp: diff('medianMaxDrawdownPp'), worstMaxDrawdownDifferencePp: diff('worstMaxDrawdownPp'), meanInterval: Scope.interval(delta, block) };
}
function readInputs() {
  const source = Source.readInputs(), bytes = fs.readFileSync(path.join(ROOT, PROTOCOL)), protocol = JSON.parse(bytes);
  assert.equal(protocol.id, 'equal-budget-component-value-delay-v4'); assert.equal(protocol.model.id, MODEL); assert.equal(protocol.model.ridgeLambda, 1); assert.equal(protocol.model.minimumMatureLabels, MIN);
  assert.deepEqual(source.protocol.portfolio.positions, IDS.map(id => ({ id, weight: .3 }))); assert.equal(source.protocol.portfolio.strategicCashWeight, .4);
  for (const d of protocol.frozenDependencies) assert.equal(sha(fs.readFileSync(path.join(ROOT, d.path))), d.sha256, d.path);
  const prior = JSON.parse(fs.readFileSync(path.join(ROOT, protocol.sourceSnapshot.evidencePath)));
  assert.equal(sha(JSON.stringify(prior.inputs.sourceSnapshot)), protocol.sourceSnapshot.sourceSnapshotSha256);
  assert.equal(sha(JSON.stringify(source.market.map(r => r.day))), protocol.sourceSnapshot.marketCalendarSha256);
  assert.equal(sha(JSON.stringify(source.market.map(({ day, prices }) => ({ day, prices })))), protocol.sourceSnapshot.actualCnyPriceRowsSha256);
  return { ...source, parent: source.protocol, protocol, prior, protocolSha256: sha(bytes) };
}
const windowKey = e => [e.calendarDay, e.evaluation, e.years, e.partition, e.start, e.end].join('/');
const groupKey = e => [e.calendarDay, e.evaluation, e.horizonYears, e.partition, e.scenario].join('/');
function unique(rows, key, label) {
  const result = new Map();
  for (const row of rows) { const id = key(row); assert.ok(!result.has(id), label + ': duplicate ' + id); result.set(id, row); }
  return result;
}
const ACCOUNT_FIELDS = ['terminalWealth', 'contributed', 'accountReturnPp', 'navReturnPp', 'maxDrawdownPp', 'fees', 'interest', 'pendingCash', 'pendingLots', 'meanWaitSessions', 'executedMeanWaitSessions'];
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
  const a = actionEvidence(rows), c = Value.concentration(rows), gate = Value.primaryPass(paired, a, c, protocol);
  const ac = protocol.selectionAndConfirmation.actionGates;
  const actions = { uniqueDelayedMonths: a.delayedMonths, arrivalYearsWithDelay: a.arrivalYearCount,
    nonOverlappingDelayedOneYearWindows: a.nonOverlappingDelayedN, strictPositiveShareAmongDelayedMonths: a.positiveShare, medianDeltaPpAmongDelayedMonths: a.medianDeltaPp };
  const tests = [['uniqueDelayedMonths', 'minimumUniqueDelayedMonths', gate.checks.actionCount], ['arrivalYearsWithDelay', 'minimumArrivalYearsWithDelay', gate.checks.actionYears],
    ['nonOverlappingDelayedOneYearWindows', 'minimumNonOverlappingDelayedOneYearWindows', gate.checks.nonOverlap],
    ['strictPositiveShareAmongDelayedMonths', 'minimumStrictPositiveShareAmongDelayedMonths', gate.checks.actionWins], ['medianDeltaPpAmongDelayedMonths', 'minimumMedianDeltaPpAmongDelayedMonths', gate.checks.actionMedian]]
    .map(([metric, limit, passed]) => ({ metric, value: actions[metric], minimum: ac[limit], passed }));
  const sufficientCoverage = tests.slice(0, 3).every(r => r.passed), sufficient = rows.length > 0 && sufficientCoverage && c.status !== 'insufficient_month_coverage';
  subset(actual.actions, { ...actions, tests, sufficientCoverage, passed: tests.every(t => t.passed),
    perComponentDelayedMonths: a.componentActionCounts, dates: rows.filter(r => r.anyDelay).map(({ start, ...r }) => ({ ...r, day: start })) }, 'primary actions');
  compareEconomic(actual.economic, paired, protocol.selectionAndConfirmation.unconditionalGates);
  compareConcentration(actual.concentration, c);
  assert.equal(actual.status, !sufficient ? 'insufficient' : gate.passed ? 'passed' : 'failed'); assert.equal(actual.passed, gate.passed);
  return { status: actual.status, ...gate, actions: a, concentration: c };
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
function compareAccount(actual, expected, label, errors, trace) {
  for (const key of ACCOUNT_FIELDS) close(actual[key], expected[key], label + '.' + key, errors);
  assert.deepEqual(actual.externalFlows, expected.externalFlows);
  subset(actual.contributionAttribution, expected.contributionAttribution, label + '.claims', errors);
  for (const key of ['terminalWealth', 'fees', 'interest']) close(sum(actual.contributionAttribution.map(r => r[key])), actual[key], label + '.claim sum ' + key);
  const key = r => [r.day, r.side, r.id, r.arrivalDay || ''].join('/');
  subset([...actual.trades].sort((a,b)=>key(a).localeCompare(key(b))), [...expected.trades].sort((a,b)=>key(a).localeCompare(key(b))), label + '.trades', errors);
  for (const trade of actual.trades.filter(t => t.side === 'buy')) {
    if (actual.rule !== MODEL) { assert.equal(trade.reason, 'fixed_component_tranche'); continue; }
    const p = trace.find(r => r.day === trade.arrivalDay); assert.ok(p);
    subset(trade, {decisionDay:p.day, featureDay:p.featureDay, predictedY:p.components[trade.id].predictedY,
      trainingN:p.trainingN, latestTrainingExit:p.latestTrainingExit, trainingPoolSha256:p.trainingPoolSha256,
      labelHoldingYears:1, offset:p.legOffsets[trade.id], reason:'locked_component_annual_value_prediction'},label+'.component provenance');
  }
}
function decisions(episodes, predictions) {
  const unique = new Map();
  for (const ep of episodes) for (const a of ep.fundingPlan) {
    if (unique.has(a.day)) { unique.get(a.day).occurrencesInAccounts++; continue; }
    const p=predictions[a.index]; assert.ok(available(p));
    unique.set(a.day,{day:a.day,featureDay:p.featureDay,trainingN:p.trainingN,latestTrainingExit:p.latestTrainingExit,
      legOffsets:p.legOffsets,anyDelay:p.anyDelay,actionCategory:p.actionCategory,
      predictedYByComponent:Object.fromEntries(IDS.map(id=>[id,p.components[id].predictedY])),occurrencesInAccounts:1});
  }
  const dates=[...unique.values()].sort((a,b)=>a.day.localeCompare(b.day));
  return {uniqueArrivalDecisions:dates.length,delayedUniqueDecisions:dates.filter(p=>p.anyDelay).length,
    perComponentDelayedDecisions:Object.fromEntries(IDS.map(id=>[id,dates.filter(p=>p.legOffsets[id]===5).length])),
    actionCategoryCounts:Object.fromEntries(CATEGORIES.map(c=>[c,dates.filter(p=>p.actionCategory===c).length])),dates};
}
function metrics(rows) {
  const err=rows.map(r=>r.predictedY-r.actualY), ref=rows.map(r=>r.referenceForecast-r.actualY), MSE=mean(err.map(x=>x*x)),referenceMSE=mean(ref.map(x=>x*x));
  return {n:rows.length,MAE:mean(err.map(Math.abs)),MSE,referenceMAE:mean(ref.map(Math.abs)),referenceMSE,R2:referenceMSE>0?1-MSE/referenceMSE:null,dates:rows};
}
function diagnostics(rows) {
  const dates=rows.map(({start,...r})=>({...r,day:start})), components=Object.fromEntries(IDS.map(id=>[id,metrics(dates.map(r=>({day:r.day,...r.components[id]})))]));
  const bothDelayCounterfactual=metrics(dates.map(r=>({day:r.day,predictedY:sum(IDS.map(id=>r.components[id].predictedY)),actualY:sum(IDS.map(id=>r.components[id].actualY)),referenceForecast:sum(IDS.map(id=>r.components[id].referenceForecast))})));
  const categories=CATEGORIES.map(actionCategory=>{const selected=dates.filter(r=>r.actionCategory===actionCategory),delta=selected.map(r=>r.deltaPp),totalDeltaPp=sum(delta);
    return {actionCategory,n:selected.length,conditionalMeanDeltaPp:mean(delta),medianDeltaPp:quantile(delta,.5),strictPositiveShare:selected.length?delta.filter(positive).length/selected.length:null,totalDeltaPp,
      unconditionalMeanContributionPp:rows.length?totalDeltaPp/rows.length:null,dates:selected.map(r=>r.day)};});
  return {scope:'distinct_primary_monthly_whole_deposit_outcomes',units:'full_original_deposit_fraction_for_forecasts_percentage_points_for_account_deltas',uniqueMonths:rows.length,anyDelayMonths:rows.filter(r=>r.anyDelay).length,components,
    bothDelayCounterfactual:{meaning:'both_products_delay_five_sessions_not_the_realized_joint_policy_when_one_leg_waits',...bothDelayCounterfactual},categories,dates};
}
function engineCausality(market, portfolio, trace) {
  const Engine=require(path.join(ROOT,ENGINE)),first=trace.findIndex(available);
  const cuts=[...new Set([first,market.findIndex(r=>r.day>='2019-01-01'),market.findIndex(r=>r.day>='2023-01-01'),market.length-1])].filter(t=>t>=first);
  for(const t of cuts){
    const changed=market.map((r,i)=>({...r,prices:r.prices.map((p,j)=>i>=t?p*(j?.017:81):p)}));
    assert.deepEqual(Engine.buildPredictions(changed,portfolio).predictions[t],trace[t],'producer current/future mutation '+market[t].day);
    assert.deepEqual(Engine.buildPredictions(market.slice(0,t+1),portfolio).predictions[t],trace[t],'producer future truncation '+market[t].day);
  }
  return {type:'separate_producer_metamorphic_check_not_expected_value_source',days:cuts.map(t=>market[t].day),currentAndFutureMutation:true,futureTruncation:true};
}
function auditReports(report, ledger, loaded) {
  const {market,parent,protocol,prior}=loaded, features=ownFeatures(market), {queue,excluded}=annualLabels(market,features);
  const trace=report.dailyPredictions,labelErrors={},predictionErrors={},ledgerErrors={},byEntry=new Map(queue.map(q=>[q.entryIndex,q]));
  assert.equal(trace.length,market.length);subset(report.maturityQueue,queue,'independent component labels',labelErrors);
  const exclusions={...excluded}; exclusions.incomplete_prior_component_features=exclusions.incomplete_prior_features;delete exclusions.incomplete_prior_features;
  assert.deepEqual(report.labelExclusions,exclusions);assert.deepEqual(ledger.maturityQueue,report.maturityQueue);assert.deepEqual(ledger.predictions,trace);
  for(const output of [report,ledger]){
    assert.equal(output.protocolId,protocol.id);assert.equal(output.inputs.protocol.sha256,loaded.protocolSha256);assert.deepEqual(output.inputs.frozenDependencies,protocol.frozenDependencies);
    assert.equal(output.inputs.researchEngine.path,ENGINE);assert.equal(output.inputs.researchEngine.sha256,sha(fs.readFileSync(path.join(ROOT,ENGINE))));
    assert.equal(output.inputs.maturityQueueSha256,sha(JSON.stringify(report.maturityQueue)));assert.equal(output.inputs.predictionTraceSha256,sha(JSON.stringify(trace)));
    assert.deepEqual(output.inputs.sourceSnapshot,prior.inputs.sourceSnapshot);assert.equal(output.inputs.marketCalendarSha256,protocol.sourceSnapshot.marketCalendarSha256);assert.equal(output.inputs.actualCnyPriceRowsSha256,protocol.sourceSnapshot.actualCnyPriceRowsSha256);
    const source=output.inputs.sourceSnapshot.v2Inputs;assert.equal(source.catalog.sha256,loaded.fingerprints.catalog);
    for(const h of loaded.fingerprints.histories)subset(source.histories.find(r=>r.id===h.id),h,'source history');
  }
  assert.equal(report.statisticsSha256,sha(JSON.stringify({maturityQueue:report.maturityQueue,dailyPredictions:trace,results:report.results,coverage:report.coverage,pairedBaseWindows:report.pairedBaseWindows,primaryPredictionDiagnostics:report.primaryPredictionDiagnostics,decision:report.decision})));
  const oldLabels=new Map(prior.maturityQueue.map(q=>[q.entryIndex,q]));let sumLabelError=0;
  for(const q of queue){const old=oldLabels.get(q.entryIndex);assert.equal(old.exitDay,q.exitDay);const difference=Math.abs(sum(IDS.map(id=>q.components[id].y))-old.y);assert.ok(difference<=1e-12);sumLabelError=Math.max(sumLabelError,difference);}
  close(report.method.maximumCommonWaitLabelError,sumLabelError,'v3 common-wait label identity');
  let pointer=0,chain=sha(''),availableN=0,multipleDays=0;
  for(let t=0;t<market.length;t++){
    const before=pointer;while(pointer<queue.length&&queue[pointer].exitIndex<t){chain=sha(chain+'\n'+JSON.stringify(report.maturityQueue[pointer++]));}
    const p=trace[t],last=queue[pointer-1],ready=pointer>=MIN&&complete(features[t-1]);
    for(const forbidden of ['predictedY','offset'])assert.ok(!(forbidden in p),'no synthetic scalar '+forbidden);
    subset(p,{day:market[t].day,executionDay:market[t].day,featureDay:market[t-1]?.day??null,labelHoldingYears:1,trainingN:pointer,trainingQueuePrefixLength:pointer,
      latestTrainingEntry:last?.entryDay??null,latestTrainingExit:last?.exitDay??null,trainingPoolSha256:chain,newlyMatureLabels:pointer-before},'daily causal header '+t);
    if(pointer-before>1)multipleDays++;
    if(!ready){subset(p,{legOffsets:null,anyDelay:null,actionCategory:null},'warmup');assert.ok(p.missing);}
    else{assert.equal(p.missing,null);assert.ok(available(p));subset(p,actions(p.components),'daily leg action');
      for(const id of IDS){const c=p.components[id];assert.equal(c.trainingN,pointer);for(const xs of [c.features,c.featureMeans,c.featureStd,c.beta])assert.ok(xs.length===5&&xs.every(finite));assert.ok(c.featureStd.every(x=>x>=0));subset(c.features,features[t-1][id],'daily component features',predictionErrors);close(c.predictedFullDepositBps,c.predictedY*10000,'forecast units');}availableN++;}
  }
  const {monthly,fits}=fitDates(market,features,queue), predictions=market.map(r=>({day:r.day,trainingN:0,legOffsets:null,anyDelay:null,actionCategory:null}));let fitN=0;
  for(const [t,expected]of fits){subset(trace[t],expected,'independent batch fits '+market[t].day,predictionErrors);predictions[t]={...expected,trainingPoolSha256:trace[t].trainingPoolSha256};if(available(expected))fitN++;}
  const panels=new Map(),episodes=[];
  for(const day of [1,10,20])for(const evaluation of ['equal_age_lot','twelve_deposit_account'])for(const years of [1,3]){
    const panel=episodesFor(market,predictions,parent.episodes.partitions,day,evaluation,years);panels.set([day,evaluation,years].join('/'),panel);episodes.push(...panel.episodes);}
  const coverage=unique(report.coverage,r=>[r.calendarDay,r.evaluation,r.years].join('/'),'coverage');assert.equal(coverage.size,12);
  for(const [key,panel]of panels){const c=coverage.get(key);assert.ok(c);assert.equal(c.attemptedStartMonths,panel.calendar.length);assert.equal(c.eligibleEpisodeCount,panel.episodes.length);subset(c.scheduledMonths,panel.calendar,key+'.calendar');
    const rejected=unique(c.rejected,r=>r.month,'rejections'),counts={};assert.equal(rejected.size,panel.rejected.length);
    for(const r of panel.rejected){const observed=rejected.get(r.month);assert.ok(observed);
      if(r.reason==='missing_first_arrival')assert.equal(observed.reason,panel.calendar.find(m=>m.month===r.month).missing);
      else if(r.reason==='missing_required_month')assert.ok(['funding_months_not_yet_observed','required_funding_date_missing'].includes(observed.reason));else assert.equal(observed.reason,r.reason);
      counts[observed.reason]=(counts[observed.reason]||0)+1;}assert.deepEqual(c.excluded,counts);}
  const windows=unique(ledger.windows,windowKey,'base ledger'),pairedWindows=unique(report.pairedBaseWindows,windowKey,'paired windows');assert.equal(windows.size,episodes.length);assert.equal(pairedWindows.size,episodes.length);
  const rules=[{id:MODEL},...protocol.benchmarks],caches=new Map();let tradeN=0,flowN=0,identities=0;
  for(const scenario of parent.scenarios){const cache=new Map();caches.set(scenario.id,cache);
    for(const ep of episodes){const key=windowKey(ep),accounts=new Map(rules.map(rule=>[rule.id,account(market,ep,rule,scenario,predictions)]));cache.set(key,accounts);if(scenario.id!=='base')continue;
      const recorded=windows.get(key),scalar=pairedWindows.get(key);assert.ok(recorded&&scalar);
      for(const output of [recorded,scalar]){assert.equal(output.scenario,'base');assert.equal(output.lastFundingDay,ep.lastFundingDay);assert.equal(output.anniversary,ep.anniversary);assert.deepEqual(output.fundingPlan,ep.fundingPlan);assert.deepEqual(Object.keys(output.rules).sort(),rules.map(r=>r.id).sort());}
      for(const rule of rules){const expected=accounts.get(rule.id);compareAccount(recorded.rules[rule.id],expected,key+'/'+rule.id,ledgerErrors,trace);for(const field of ACCOUNT_FIELDS)close(scalar.rules[rule.id][field],expected[field],'published.'+field);
        close(scalar.rules[rule.id].deltaVsImmediatePp,100*(expected.terminalWealth-accounts.get('immediate').terminalWealth)/expected.contributed,'published delta');tradeN+=expected.trades.length;flowN+=expected.externalFlows.length;}
      if(ep.evaluation==='equal_age_lot'&&ep.years===1){const q=byEntry.get(ep.startIndex),p=predictions[ep.startIndex];assert.equal(q.exitDay,ep.end);
        close(accounts.get(MODEL).terminalWealth-accounts.get('immediate').terminalWealth,100*sum(IDS.map(id=>p.legOffsets[id]===5?q.components[id].y:0)),'joint selected annual identity');
        close(accounts.get('fixed_delay5').terminalWealth-accounts.get('immediate').terminalWealth,100*sum(IDS.map(id=>q.components[id].y)),'both-delay identity');identities++;}
    }
  }
  const groups=unique(report.results,groupKey,'all 108 cells');assert.equal(groups.size,108);
  const computed=new Map(),primary=new Map(),counts=[],statuses={};let pairs=0,emptyGroups=0;
  for(const [panelKey,panel]of panels)for(const partition of parent.episodes.partitions)for(const scenario of parent.scenarios){
    const [d,evaluation,y]=panelKey.split('/'),calendarDay=+d,horizonYears=+y,key=groupKey({calendarDay,evaluation,horizonYears,partition:partition.id,scenario:scenario.id}),group=groups.get(key);assert.ok(group);
    const selected=panel.episodes.filter(e=>e.partition===partition.id),block=12*horizonYears+(evaluation==='equal_age_lot'?0:12),cache=caches.get(scenario.id),cell=new Map();computed.set(key,cell);
    assert.equal(group.primaryCalendar,calendarDay===1);assert.deepEqual(group.startRange,selected.length?{first:selected[0].start,last:selected.at(-1).start}:null);subset(group.decisionCoverage,decisions(selected,predictions),key+'.unique decisions');
    assert.deepEqual(group.rules.map(r=>r.id).sort(),rules.map(r=>r.id).sort());if(!selected.length)emptyGroups++;
    for(const rule of rules){const actual=group.rules.find(r=>r.id===rule.id),rows=selected.map(e=>cache.get(windowKey(e)).get(rule.id)),expected={summary:summary(rows)};subset(actual.summary,expected.summary,key+'.summary');
      for(const [field,id]of [['vsImmediate','immediate'],['vsFixedDelay5','fixed_delay5'],['vsThreeTranches','three_tranches']]){const baseline=selected.map(e=>cache.get(windowKey(e)).get(id));expected[field]=paired(rows,baseline,block);subset(actual[field],expected[field],key+'.'+field);
        subset(actual[field].meanInterval,{draws:2000,seed:0x6d2b79f5,method:'non_circular_moving_block',prng:'Mulberry32'},'bootstrap metadata');const status=actual[field].meanInterval.status;statuses[status]=(statuses[status]||0)+1;pairs++;}cell.set(rule.id,expected);}
    if(scenario.id==='base')counts.push({calendarDay,evaluation,years:horizonYears,partition:partition.id,n:selected.length,nonOverlappingN:nonOverlap(selected),blockLength:block});
    if(calendarDay===1&&evaluation==='equal_age_lot'&&horizonYears===1&&scenario.id==='base'){
      const rows=selected.map(ep=>{const p=predictions[ep.startIndex],q=byEntry.get(ep.startIndex),a=cache.get(windowKey(ep));return {start:ep.start,end:ep.end,
        deltaPp:100*(a.get(MODEL).terminalWealth-a.get('immediate').terminalWealth)/a.get(MODEL).contributed,legOffsets:p.legOffsets,anyDelay:p.anyDelay,actionCategory:p.actionCategory,
        featureDay:p.featureDay,trainingN:p.trainingN,latestTrainingExit:p.latestTrainingExit,trainingPoolSha256:p.trainingPoolSha256,
        components:Object.fromEntries(IDS.map(id=>[id,{predictedY:p.components[id].predictedY,predictedFullDepositBps:p.components[id].predictedFullDepositBps,referenceForecast:p.components[id].trainingMeanY,actualY:q.components[id].y,legOffset:p.legOffsets[id]}]))};});
      primary.set(partition.id,comparePrimary(group.rules.find(r=>r.id===MODEL).primaryEvidence,cell.get(MODEL).vsImmediate,rows,protocol));
      const diagnostic=report.primaryPredictionDiagnostics.find(d=>d.partition===partition.id);assert.ok(diagnostic);subset(diagnostic,diagnostics(rows),partition.id+'.diagnostics');close(diagnostic.identityMaximumErrorPp,rows.length?0:null,'diagnostic identity');
    }
  }
  const decision=verifyConfirmation(report,computed,primary,protocol),causalChecks=engineCausality(market,parent.portfolio,trace),monthlyFits=[...monthly].filter(t=>available(predictions[t])).length;
  return {status:'passed',protocolId:protocol.id,method:'Independent own-CNY features, shared mature annual labels, two explicit batch matrix fits, separate per-leg cash claims, joint unitized NAV, joint evidence gates and independent BigInt bootstrap',
    annualSharedLabels:queue.length,annualComponentLabels:queue.length*2,dailyMaturityHeaders:trace.length,multiLabelMaturityDays:multipleDays,availableDailyPredictions:availableN,
    jointlyCheckedBatchDates:fitN,componentBatchFits:fitN*2,distinctMonthlyDates:monthlyFits,additionalDailyDates:fitN-monthlyFits,checkedDateCutsIncludingWarmup:fits.size,
    firstAvailablePrediction:trace.find(available).day,latestPredictionTrainingN:trace.at(-1).trainingN,registeredGroups:108,emptyGroups,baseWindows:episodes.length,baseAccounts:episodes.length*rules.length,
    independentlyRecomputedAllScenarioAccounts:episodes.length*rules.length*parent.scenarios.length,baseTrades:tradeN,baseExternalFlows:flowN,annualLotLabelIdentities:identities,independentlyRecomputedPairs:pairs,intervalStatuses:statuses,
    groups:counts,primary:Object.fromEntries([...primary].map(([phase,v])=>[phase,{status:v.status,passed:v.passed,actions:v.actions,concentrationPassed:v.concentration.passed}])),decision,causalChecks,
    maximumCommonWaitLabelDifferenceFromV3:sumLabelError,maximumAbsoluteLabelDifferences:labelErrors,maximumAbsolutePredictionDifferences:predictionErrors,maximumAbsoluteLedgerDifferences:ledgerErrors,
    sourceFingerprints:loaded.fingerprints,protocolSha256:loaded.protocolSha256,limitations:[
      'Saved-source hashes establish reproducibility, not vendor accuracy or historical data vintages.',
      'Only base has complete producer transaction and attribution ledgers for individual matching. Cash2/fee20 account scalars, NAV risk and statistics are independently reconstructed; their full producer trade ledgers are not compared.',
      'Both batch regressions are independently fitted on every actual 1/10/20 arrival and fixed extra cuts. Other daily fits receive causal-pool, own-feature and action-threshold checks rather than a separate full matrix refit.',
      'Producer future mutation and truncation are separately identified metamorphic tests, not sources of independent expected values.',
      'Exposed overlapping history, unconfirmed personal holding preferences and unimplemented personal taxes remain limitations. Audit correctness cannot make failed research useful or authorize integration.' ]};
}
function selfTest() {
  const tests = [], test = (name, f) => { f(); tests.push(name); }, market = [];
  for (let ms = time('2010-01-01'); market.length < 1600; ms += DAY) { const d = new Date(ms); if ([0, 6].includes(d.getUTCDay())) continue; const i = market.length;
    market.push({ day: d.toISOString().slice(0, 10), prices: [10 * Math.exp(i / 800 + .03 * Math.sin(i / 13)), 20 * Math.exp(i / 900 + .04 * Math.cos(i / 11))] }); }
  const features = ownFeatures(market), { queue } = annualLabels(market, features), first = market.findIndex((_, t) => queue.filter(e => e.exitIndex < t).length >= MIN);
  test('own CNY price feature definitions and no cross-asset reference', () => {
    const t = 300, values = market.map(r => r.prices[0]); close(features[t][IDS[0]][0], values[t] / mean(values.slice(t - 199, t + 1)) - 1, 'MA200');
    const altered = market.map((r, i) => ({ ...r, prices: [r.prices[0], r.prices[1] * Math.exp(.2 * Math.sin(i / 5))] }));
    assert.deepEqual(ownFeatures(altered).map(x => x[IDS[0]]), features.map(x => x[IDS[0]]));
    assert.notDeepEqual(ownFeatures(altered)[t][IDS[1]], features[t][IDS[1]]);
  });
  test('shared annual labels use original .3 weights and one common maturity', () => {
    assert.equal(queue[0].entryIndex, 200); const q = queue[0];
    IDS.forEach((id, j) => close(q.components[id].y, .999 / 1.001 * .3 * market[q.exitIndex].prices[j] * (1 / market[q.entryIndex + 5].prices[j] - 1 / market[q.entryIndex].prices[j]), 'component label'));
    const missing = structuredClone(features); missing[199][IDS[1]] = null; assert.ok(!annualLabels(market, missing).queue.some(e => e.entryIndex === 200));
  });
  test('same-day annual events are all mature only on the following close', () => {
    const event = queue.find((q, i) => i && q.exitIndex === queue[i - 1].exitIndex); assert.ok(event);
    const before = predict(market, features, queue, event.exitIndex).trainingN, after = predict(market, features, queue, event.exitIndex + 1).trainingN;
    assert.equal(after - before, queue.filter(q => q.exitIndex === event.exitIndex).length);
  });
  test('756 shared dates and current prediction requires no future current label', () => {
    assert.equal(predict(market, features, queue, first - 1).legOffsets, null); assert.ok(available(predict(market, features, queue, first)));
    const prefix = market.slice(0, first + 1), px = ownFeatures(prefix), pq = annualLabels(prefix, px).queue;
    assert.ok(!pq.some(q => q.entryIndex === first)); assert.deepEqual(predict(prefix, px, pq, first), predict(market, features, queue, first));
  });
  test('future mutation preserves both independent fits and locked actions', () => {
    const changed = market.map((r, i) => ({ ...r, prices: i >= first ? r.prices.map((p, j) => p * (j ? .001 : 100)) : r.prices.slice() }));
    const x = ownFeatures(changed); assert.deepEqual(predict(changed, x, annualLabels(changed, x).queue, first), predict(market, features, queue, first));
  });
  test('two ridge fits retain population SD lambda1 and free intercept', () => {
    for (const shift of [0, .5]) { const rows = Array.from({ length: 756 }, (_, i) => ({ x: [i % 2 ? 1 : -1, 3, 0, 0, 0], y: (i % 2 ? 5 : 1) + shift })), fit = Batch.batchRidge(rows, [1, 3, 0, 0, 0]);
      close(fit.featureStd[0], 1, 'population'); close(fit.beta[0], 1, 'lambda1'); close(fit.predictedY, 4 + shift, 'intercept'); }
  });
  const base = { annualCashRate: 0, feeRate: .001, capitalTaxRate: 0, dividendTaxRate: 0 };
  const tiny = ['2019-01-01','2019-01-02','2019-01-03','2019-01-04','2019-01-07','2019-01-08','2020-01-01'].map(day => ({ day, prices: [100, 100] }));
  tiny[5].prices = [90, 110]; tiny[6].prices = [180, 110];
  const episode = { startIndex: 0, endIndex: 6, start: tiny[0].day, end: tiny[6].day, fundingPlan: [{ index: 0, day: tiny[0].day, amount: 100 }] };
  const prediction = [{ legOffsets: { [IDS[0]]: 5, [IDS[1]]: 0 } }], a = account(tiny, episode, { id: MODEL }, base, prediction);
  const immediate = account(tiny, episode, { id: 'immediate', offsets: [0] }, base, []);
  test('split-leg cash accounting and selected-label identity', () => {
    close(a.terminalWealth, 40 + 93 * .999 / 1.001, 'split terminal'); close(immediate.terminalWealth, 40 + 87 * .999 / 1.001, 'immediate terminal');
    close(a.terminalWealth - immediate.terminalWealth, 6 * .999 / 1.001, 'only delayed USD contributes'); close(a.meanWaitSessions, 2.5, 'summary wait not scalar execution');
    assert.equal(a.trades.find(t => t.side === 'buy' && t.id === IDS[0]).day, tiny[5].day); assert.equal(a.trades.find(t => t.side === 'buy' && t.id === IDS[1]).day, tiny[0].day);
    close(sum(a.contributionAttribution.map(r => r.terminalWealth)), a.terminalWealth, 'claim reconciliation');
  });
  test('cash/fee stresses keep budgets separate and do not change leg actions', () => {
    const rate = .02, c = account(tiny, episode, { id: MODEL }, { ...base, annualCashRate: rate }, prediction), factor = (1 + rate) ** (gap(tiny[0].day, tiny[5].day) / YEAR);
    close(c.terminalWealth, 40 * (1 + rate) ** (gap(tiny[0].day, tiny[6].day) / YEAR) + .999 / 1.001 * (60 * factor + 33), 'cash2');
    close(account(tiny, episode, { id: MODEL }, { ...base, feeRate: .002 }, prediction).terminalWealth, 40 + 93 * .998 / 1.002, 'fee20');
    const shorter = { ...episode, endIndex: 4, end: tiny[4].day }, pending = account(tiny, shorter, { id: MODEL }, base, prediction);
    assert.equal(pending.pendingLots, 1); assert.equal(pending.pendingCash, 30); assert.equal(pending.trades.filter(t => t.side === 'buy').length, 1);
  });
  test('four categories use individual strict thresholds and count a both-delay month once', () => {
    const rows = [[0,0],[2e-12,0],[0,2e-12],[2e-12,2e-12]].map((ys, i) => ({ start: `2020-0${i+1}-02`, end: `2021-0${i+1}-02`, deltaPp: i === 3 ? -1 : 1,
      ...actions(Object.fromEntries(IDS.map((id,j)=>[id,{predictedY:ys[j]}]))) }));
    assert.deepEqual(rows.map(r=>r.actionCategory), CATEGORIES); const e = actionEvidence(rows); assert.equal(e.delayedMonths,3); assert.equal(sum(Object.values(e.componentActionCounts)),4); close(e.positiveShare,2/3,'joint wins');
    assert.equal(actions(Object.fromEntries(IDS.map(id=>[id,{predictedY:1e-12}]))).anyDelay,false);
  });
  test('joint concentration and evidence screens retain zeros and calendar missing blocks', () => {
    const rows = Array.from({length:36},(_,i)=>({start:monthName(2019*12+i)+'-02',end:monthName(2020*12+i)+'-02',deltaPp:i%3?0:3,anyDelay:i%3===0,legOffsets:{[IDS[0]]:i%3?0:5,[IDS[1]]:i%3?0:5}}));
    assert.equal(actionEvidence(rows).delayedMonths,12); assert.equal(Value.concentration(rows).passed,true); assert.equal(Value.concentration(rows.filter((_,i)=>i!==4)).delete12Months.length,25);
    assert.equal(Value.concentration(rows.map(r=>({...r,deltaPp:r.start.startsWith('2020')?3:0}))).passed,false);
  });
  test('combined NAV adjusts for deposits and is not the sum of leg drawdowns',()=>{
    const m=[{day:'2020-01-01',prices:[100,100]},{day:'2020-01-02',prices:[200,200]},{day:'2020-01-03',prices:[100,100]}],
      ep={start:m[0].day,startIndex:0,end:m[2].day,endIndex:2,fundingPlan:[{day:m[0].day,index:0,amount:100},{day:m[1].day,index:1,amount:100}]},
      r=account(m,ep,{id:'immediate',offsets:[0]},{...base,feeRate:0},[]);
    close(r.terminalWealth,170,'two deposit wealth');close(r.navReturnPp,100*(170/162.5-1),'flow neutral NAV');close(r.maxDrawdownPp,100*((170/162.5)/1.6-1),'joint drawdown');
  });
  test('nested component attribution detects budget transfer and double action counting',()=>{
    const expected=a.contributionAttribution,actual=structuredClone(expected);actual[0].components[IDS[0]].originalBudget+=1;actual[0].components[IDS[1]].originalBudget-=1;
    assert.throws(()=>subset(actual,expected,'tampered allocation'));assert.equal(sum(IDS.map(id=>expected[0].components[id].originalBudget)),60);
    const e=actionEvidence([{start:'2020-01-01',end:'2021-01-01',deltaPp:-1,...actions(Object.fromEntries(IDS.map(id=>[id,{predictedY:1}])))}]);
    assert.equal(e.delayedMonths,1);assert.equal(e.positiveShare,0);assert.equal(sum(Object.values(e.componentActionCounts)),2);
  });
  test('empty samples cannot pass and bootstrap retains fixed insufficient-block rule',()=>{
    const p=paired([],[],12),a=actionEvidence([]),c=Value.concentration([]),protocol=JSON.parse(fs.readFileSync(path.join(ROOT,PROTOCOL)));
    assert.equal(Value.primaryPass(p,a,c,protocol).passed,false);assert.equal(p.meanInterval.status,'no_samples');
    assert.equal(Scope.interval(Array(12).fill(1),12).status,'insufficient_blocks');assert.equal(Scope.interval(Array(13).fill(1),12).status,'descriptive');
  });
  return { passed:true,cases:tests.length,checks:tests };
}
module.exports = { ownFeatures, annualLabels, predict, fitDates, episodesFor, account, actionEvidence, readInputs, auditReports, selfTest };
if (require.main === module) {
  const args=process.argv.slice(2),tests=selfTest();
  if(args[0]==='--self-test'){assert.equal(args.length,1);console.log(JSON.stringify({selfTests:tests},null,2));}
  else {
    assert.ok(args.length<=2,'Usage: check_portfolio_entry_components.cjs [report.json] [ledger.json]');
    const reportPath=path.resolve(args[0]||path.join(ROOT,'docs/evidence/portfolio-entry-components-v4.json')),ledgerPath=path.resolve(args[1]||'/tmp/portfolio-entry-components-v4-ledgers.json');
    const reportBytes=fs.readFileSync(reportPath),ledgerBytes=fs.readFileSync(ledgerPath),loaded=readInputs(),result=auditReports(JSON.parse(reportBytes),JSON.parse(ledgerBytes),loaded);
    console.log(JSON.stringify({...result,selfTests:tests,files:{checker:{path:path.relative(ROOT,__filename),sha256:sha(fs.readFileSync(__filename))},engine:{path:ENGINE,sha256:sha(fs.readFileSync(path.join(ROOT,ENGINE)))},report:{path:path.relative(ROOT,reportPath),sha256:sha(reportBytes)},ledger:{path:ledgerPath,sha256:sha(ledgerBytes)},independentDependencies:['check_portfolio_entry_research.cjs','check_portfolio_entry_predictive.cjs','check_portfolio_entry_scope.cjs','check_portfolio_entry_value.cjs'].map(name=>({path:'scripts/'+name,sha256:sha(fs.readFileSync(path.join(__dirname,name)))}))}},null,2));
  }
}
