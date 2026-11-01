#!/usr/bin/env node
'use strict';
// v3 target-alignment experiment: annual full-deposit wealth labels, one frozen model.
// Parent modules are immutable; use only their audited pure input/math helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R1 = require('./research_portfolio_entry.cjs');
const R2 = require('./research_portfolio_entry_predictive.cjs');
const S = require('./research_portfolio_entry_scope.cjs');
const P = require('../assets/portfolio-model.js');
const ROOT = path.resolve(__dirname, '..'), MODEL_ID = 'expanding_ridge_year1_delay5', MIN_TRAINING = 756, PP_TOLERANCE = 1e-10, YEAR = 365.2425;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sum = xs => xs.reduce((a, b) => a + b, 0), mean = xs => xs.length ? sum(xs) / xs.length : null;
const gap = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
const finiteFeatures = xs => Array.isArray(xs) && xs.length === 5 && xs.every(Number.isFinite);
const availablePrediction = p => Number.isFinite(p?.predictedY) && Number.isInteger(p.trainingN) && p.trainingN >= MIN_TRAINING && [0, 5].includes(p.offset);
const greater = value => Number.isFinite(value) && value > PP_TOLERANCE;
const atLeast = (value, minimum) => Number.isFinite(value) && value >= minimum - PP_TOLERANCE;
function lowerBound(market, day) {
  let lo = 0, hi = market.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (market[mid].day < day) lo = mid + 1; else hi = mid; }
  return lo;
}
function buildLabelData(market, features, portfolio, feeRate = .001) {
  const excluded = {}, labels = market.map((row, s) => {
    const missing = reason => { excluded[reason] = (excluded[reason] || 0) + 1; return null; };
    if (!s || !finiteFeatures(features[s - 1]?.features)) return missing('incomplete_prior_features');
    const anniversary = P.addYears(row.day, 1), exitIndex = lowerBound(market, anniversary);
    if (exitIndex >= market.length) return missing('year_terminal_not_observed');
    const exitDay = market[exitIndex].day;
    if (gap(anniversary, exitDay) > 14) return missing('year_terminal_more_than_14_days_late');
    if (s + 5 > exitIndex) return missing('five_session_purchase_after_terminal');
    const y = (1 - feeRate) / (1 + feeRate) * sum(portfolio.positions.map((position, j) =>
      position.weight * market[exitIndex].prices[j] * (1 / market[s + 5].prices[j] - 1 / row.prices[j])));
    if (!Number.isFinite(y)) return missing('nonfinite_annual_label');
    return { entryIndex: s, entryDay: row.day, featureDay: market[s - 1].day, exitIndex, exitDay, anniversary,
      features: features[s - 1].features.slice(), y };
  });
  return { labels, excluded };
}
function buildYearLabels(market, features, portfolio, feeRate = .001) { return buildLabelData(market, features, portfolio, feeRate).labels; }
function trainPredictions(market, features, labels) {
  const maturityQueue = labels.filter(Boolean).sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex);
  const state = R2.createMoments(), predictions = []; let pointer = 0, poolHash = sha256(''), latestTrainingExit = null, latestTrainingEntry = null;
  for (let t = 0; t < market.length; t++) {
    let inserted = 0;
    while (pointer < maturityQueue.length && maturityQueue[pointer].exitIndex <= t - 1) {
      const label = maturityQueue[pointer++]; R2.updateMoments(state, label.features, label.y);
      poolHash = sha256(poolHash + '\n' + JSON.stringify(label));
      latestTrainingExit = label.exitDay; latestTrainingEntry = label.entryDay; inserted++;
    }
    const header = { day: market[t].day, executionDay: market[t].day, featureDay: t ? market[t - 1].day : null,
      labelHoldingYears: 1, trainingN: state.n, trainingQueuePrefixLength: pointer, latestTrainingExit, latestTrainingEntry,
      trainingPoolSha256: poolHash, newlyMatureLabels: inserted };
    const x = features[t - 1]?.features;
    if (state.n < MIN_TRAINING || !finiteFeatures(x)) {
      predictions.push({ ...header, predictedY: null, offset: null, missing: state.n < MIN_TRAINING ? 'fewer_than_756_mature_annual_labels' : 'incomplete_prior_features' }); continue;
    }
    const fit = R2.fitMoments(state, 1), predictedY = R2.predictFit(fit, x);
    assert.ok(Number.isFinite(predictedY));
    predictions.push({ ...header, ...fit, features: x.slice(), predictedY, predictedFullDepositBps: 10000 * predictedY,
      offset: R2.decisionOffset(predictedY), missing: null });
  }
  return { maturityQueue, predictions };
}
function buildPredictions(market, portfolio) {
  const features = R2.buildFeatures(market, portfolio), labelData = buildLabelData(market, features, portfolio);
  return { features, labels: labelData.labels, labelExclusions: labelData.excluded, ...trainPredictions(market, features, labelData.labels) };
}
function simulateFundingPlan(market, episode, rule, scenario, portfolio, predictions, audit = false) {
  assert.equal(scenario.capitalTaxRate, 0, 'scope audit retains pre-personal-tax accounting'); assert.equal(scenario.dividendTaxRate, 0);
  assert.ok(scenario.feeRate >= 0 && scenario.feeRate < 1 && scenario.annualCashRate >= 0);
  const risk = sum(portfolio.positions.map(p => p.weight)); assert.ok(risk > 0 && Math.abs(risk + portfolio.strategicCashWeight - 1) < 1e-12);
  const plan = episode.fundingPlan, arrivals = new Map(plan.map(p => [p.index, p]));
  assert.equal(arrivals.size, plan.length); assert.equal(plan.length, episode.depositCount);
  assert.ok(plan.every((p, i) => p.index >= episode.startIndex && p.index <= episode.endIndex && p.day === market[p.index].day && p.amount > 0 && (!i || p.index > plan[i - 1].index)));
  const units = portfolio.positions.map(() => 0), lots = [], deposits = [], trades = [], curve = [];
  let strategicCash = 0, fundUnits = 0, contributed = 0, fees = 0, interest = 0, peak = 1, mdd = 0;
  const pendingCash = () => sum(lots.filter(l => l.boughtIndex === null).map(l => l.cash));
  const wealth = prices => strategicCash + pendingCash() + sum(units.map((u, j) => u * prices[j]));
  for (let i = episode.startIndex; i <= episode.endIndex; i++) {
    const row = market[i];
    if (i > episode.startIndex && scenario.annualCashRate) {
      const factor = (1 + scenario.annualCashRate) ** (gap(market[i - 1].day, row.day) / YEAR), before = strategicCash + pendingCash();
      strategicCash *= factor;
      for (const deposit of deposits) { const increment = deposit.strategicCash * (factor - 1); deposit.strategicCash *= factor; deposit.interest += increment; }
      for (const lot of lots) if (lot.boughtIndex === null) { deposits[lot.depositIndex].interest += lot.cash * (factor - 1); lot.cash *= factor; }
      interest += strategicCash + pendingCash() - before;
    }
    const arrival = arrivals.get(i);
    if (arrival) {
      const nav = fundUnits ? wealth(row.prices) / fundUnits : 1; assert.ok(nav > 0 && Number.isFinite(nav));
      fundUnits += arrival.amount / nav; contributed += arrival.amount; strategicCash += arrival.amount * portfolio.strategicCashWeight;
      const depositIndex = deposits.length; deposits.push({ arrivalDay: arrival.day, amount: arrival.amount, strategicCash: arrival.amount * portfolio.strategicCashWeight, interest: 0 });
      const prediction = predictions[i];
      if (rule.id === MODEL_ID) {
        assert.ok(availablePrediction(prediction)); assert.equal(prediction.labelHoldingYears, 1, 'annual-label provenance required'); assert.equal(prediction.day, row.day);
        assert.equal(prediction.featureDay, market[i - 1]?.day, 'arrival uses its own strictly prior close');
        assert.ok(prediction.latestTrainingExit <= prediction.featureDay, 'unmatured training label');
        assert.equal(prediction.offset, R2.decisionOffset(prediction.predictedY), 'frozen prediction action mismatch');
      }
      const offsets = rule.id === MODEL_ID ? [prediction.offset] : rule.offsets, part = arrival.amount * risk / offsets.length;
      for (const offset of offsets) lots.push({ depositIndex, units: portfolio.positions.map(() => 0), buyFees: 0, arrivalDay: arrival.day, arrivalIndex: i, original: part, cash: part, offset, executionIndex: i + offset, boughtIndex: null,
        ...(rule.id === MODEL_ID ? { featureDay: prediction.featureDay, predictedY: prediction.predictedY, trainingN: prediction.trainingN, latestTrainingExit: prediction.latestTrainingExit, labelHoldingYears: prediction.labelHoldingYears, trainingPoolSha256: prediction.trainingPoolSha256 } : {}) });
    }
    for (const lot of lots) {
      if (lot.boughtIndex !== null || i !== lot.executionIndex) continue;
      const usable = lot.cash / (1 + scenario.feeRate);
      for (let j = 0; j < units.length; j++) {
        const notional = usable * portfolio.positions[j].weight / risk, fee = notional * scenario.feeRate, boughtUnits = notional / row.prices[j];
        units[j] += boughtUnits; lot.units[j] += boughtUnits; lot.buyFees += fee; fees += fee;
        if (audit) trades.push({ day: row.day, side: 'buy', id: portfolio.positions[j].id, units: boughtUnits, price: row.prices[j], notional, fee,
          arrivalDay: lot.arrivalDay, decisionDay: lot.arrivalDay, featureDay: lot.featureDay ?? null, signalDay: lot.featureDay ?? null,
          predictedY: lot.predictedY ?? null, trainingN: lot.trainingN ?? null, latestTrainingExit: lot.latestTrainingExit ?? null, labelHoldingYears: lot.labelHoldingYears ?? null, trainingPoolSha256: lot.trainingPoolSha256 ?? null,
          offset: lot.offset, waitSessions: i - lot.arrivalIndex, reason: rule.id === MODEL_ID ? 'frozen_year1_value_prediction' : 'fixed_tranche' });
      }
      lot.cash = 0; lot.boughtIndex = i;
    }
    if (i === episode.endIndex) for (let j = 0; j < units.length; j++) {
      if (!units[j]) continue;
      const notional = units[j] * row.prices[j], fee = notional * scenario.feeRate;
      fees += fee; strategicCash += notional - fee;
      if (audit) trades.push({ day: row.day, side: 'sell', id: portfolio.positions[j].id, units: units[j], price: row.prices[j], notional, fee, reason: 'terminal_liquidation' });
      units[j] = 0;
    }
    const value = wealth(row.prices), nav = value / fundUnits;
    assert.ok(Number.isFinite(value) && strategicCash >= -1e-9 && lots.every(l => l.cash >= -1e-9), 'account must remain self-financing');
    peak = Math.max(peak, nav); mdd = Math.min(mdd, 100 * (nav / peak - 1));
    if (audit === true || audit?.curve) curve.push({ day: row.day, value, nav, contributed, strategicCash, pendingCash: pendingCash(), units: units.slice(), fees, interest });
  }
  const terminalWealth = wealth(market[episode.endIndex].prices), original = sum(lots.map(l => l.original)), executed = lots.filter(l => l.boughtIndex !== null), executedBudget = sum(executed.map(l => l.original));
  assert.equal(contributed, sum(plan.map(p => p.amount)));
  const contributionAttribution = deposits.map((deposit, depositIndex) => {
    const scheduledPurchases = lots.filter(l => l.depositIndex === depositIndex).map(lot => {
      const terminalGrossValue = sum(lot.units.map((u, j) => u * market[episode.endIndex].prices[j])), sellFees = terminalGrossValue * scenario.feeRate;
      return { offset: lot.offset, scheduledDay: market[lot.executionIndex]?.day ?? null, scheduledIndex: lot.executionIndex,
        executedDay: lot.boughtIndex === null ? null : market[lot.boughtIndex].day, units: lot.units.slice(), buyFees: lot.buyFees,
        sellFees, terminalGrossValue, productLiquidationValue: terminalGrossValue - sellFees, pendingCash: lot.cash,
        waitSessions: (lot.boughtIndex ?? episode.endIndex) - lot.arrivalIndex };
    });
    const pending = sum(scheduledPurchases.map(l => l.pendingCash)), productLiquidationValue = sum(scheduledPurchases.map(l => l.productLiquidationValue));
    return { ...deposit, pendingCash: pending, productLiquidationValue, terminalWealth: deposit.strategicCash + pending + productLiquidationValue,
      fees: sum(scheduledPurchases.map(l => l.buyFees + l.sellFees)), scheduledPurchases };
  });
  assert.ok(Math.abs(sum(contributionAttribution.map(a => a.terminalWealth)) - terminalWealth) < Math.max(1e-8, Math.abs(terminalWealth) * 1e-12), 'per-arrival terminal attribution must reconcile');
  return { rule: rule.id, evaluation: episode.evaluation, start: episode.start, end: episode.end, lastFundingDay: episode.lastFundingDay,
    years: episode.years, partition: episode.partition, fundingMode: episode.evaluation, depositCount: plan.length,
    terminalWealth, contributed, accountReturnPp: 100 * (terminalWealth / contributed - 1), navReturnPp: 100 * (terminalWealth / fundUnits - 1), maxDrawdownPp: mdd,
    meanWaitSessions: sum(lots.map(l => l.original * ((l.boughtIndex ?? episode.endIndex) - l.arrivalIndex))) / original,
    executedMeanWaitSessions: executedBudget ? sum(executed.map(l => l.original * (l.boughtIndex - l.arrivalIndex))) / executedBudget : null,
    pendingCash: pendingCash(), pendingLots: lots.length - executed.length, fees, interest,
    externalFlows: plan.map(({ day, amount }) => ({ day, amount })), contributionAttribution, ...(audit ? { trades } : {}),
    ...(audit === true || audit?.curve ? { curve, lots } : {}) };
}
function pairedSummary(candidate, benchmark, evaluation, years) {
  const summary = S.pairedSummary(candidate, benchmark, evaluation, years);
  const deltas = candidate.map((row, i) => 100 * (row.terminalWealth - benchmark[i].terminalWealth) / row.contributed);
  return { ...summary, positiveDeltaShare: deltas.length ? deltas.filter(greater).length / deltas.length : null };
}
function nonOverlap(rows) {
  let last = '', count = 0;
  for (const row of rows.slice().sort((a, b) => a.day.localeCompare(b.day))) if (row.day > last) { count++; last = row.end; }
  return count;
}
function concentrationChecks(rows) {
  const ordered = rows.slice().sort((a, b) => a.day.localeCompare(b.day)), years = [...new Set(ordered.map(r => r.day.slice(0, 4)))];
  const outcome = (removed, remaining) => ({ removedCount: removed.length, remainingCount: remaining.length,
    removedDates: removed.map(r => r.day), remainingMeanDeltaPp: mean(remaining.map(r => r.deltaPp)), passed: remaining.length > 0 && greater(mean(remaining.map(r => r.deltaPp))) });
  const deleteYear = years.map(year => ({ year, ...outcome(ordered.filter(r => r.day.startsWith(year)), ordered.filter(r => !r.day.startsWith(year))) }));
  const delete12Months = [], monthSet = new Set(ordered.map(r => r.day.slice(0, 7)));
  if (ordered.length) for (let firstMonth = ordered[0].day.slice(0, 7); S.monthOffset(firstMonth, 11) <= ordered.at(-1).day.slice(0, 7); firstMonth = S.monthOffset(firstMonth, 1)) {
    const lastMonth = S.monthOffset(firstMonth, 11), months = Array.from({ length: 12 }, (_, i) => S.monthOffset(firstMonth, i));
    const removed = ordered.filter(r => r.day.slice(0, 7) >= firstMonth && r.day.slice(0, 7) <= lastMonth), remaining = ordered.filter(r => r.day.slice(0, 7) < firstMonth || r.day.slice(0, 7) > lastMonth);
    const complete = months.every(month => monthSet.has(month));
    delete12Months.push({ firstMonth, lastMonth, complete, missingMonths: months.filter(m => !monthSet.has(m)), ...outcome(removed, remaining) });
  }
  const fullyObservedBlocks = delete12Months.filter(b => b.complete), sufficient = ordered.length >= 24 && fullyObservedBlocks.length > 0;
  const passed = sufficient && deleteYear.every(r => r.passed) && delete12Months.every(r => r.passed);
  return { eligibleMonths: ordered.length, minimumEligibleMonths: 24, calendarBlocks: delete12Months.length, fullyObservedBlocks: fullyObservedBlocks.length,
    status: !sufficient ? 'insufficient' : passed ? 'passed' : 'failed', passed, deleteYear, delete12Months };
}
function economicChecks(pair, gates, { minimumMean = gates.minimumMeanDeltaPp, strictMean = false, minimumMedian = gates.minimumMedianDeltaPp } = {}) {
  const definitions = [['meanDeltaPp', minimumMean], ['medianDeltaPp', minimumMedian], ['p10AccountReturnDifferencePp', gates.minimumP10AccountReturnDifferencePp],
    ['medianMaxDrawdownDifferencePp', gates.minimumMedianDrawdownDifferencePp], ['worstMaxDrawdownDifferencePp', gates.minimumWorstDrawdownDifferencePp]];
  const tests = definitions.map(([metric, minimum]) => ({ metric, value: pair?.[metric] ?? null, minimum,
    comparison: metric === 'meanDeltaPp' && strictMean ? '>1e-10' : '>= with 1e-10 pp tolerance',
    passed: metric === 'meanDeltaPp' && strictMean ? greater(pair?.[metric]) : atLeast(pair?.[metric], minimum) }));
  const sampleAvailable = Number.isInteger(pair?.n) && pair.n > 0;
  return { sampleAvailable, passed: sampleAvailable && tests.every(t => t.passed), tests };
}
function primaryGates(pair, rows, config) {
  const economic = economicChecks(pair, config.unconditionalGates), delayed = rows.filter(r => r.offset === 5), actionConfig = config.actionGates;
  const actions = { uniqueDelayedMonths: delayed.length, arrivalYearsWithDelay: new Set(delayed.map(r => r.day.slice(0, 4))).size,
    nonOverlappingDelayedOneYearWindows: nonOverlap(delayed), strictPositiveShareAmongDelayedMonths: delayed.length ? delayed.filter(r => greater(r.deltaPp)).length / delayed.length : null,
    medianDeltaPpAmongDelayedMonths: R1.quantile(delayed.map(r => r.deltaPp), .5), dates: delayed };
  const counts = [['uniqueDelayedMonths', 'minimumUniqueDelayedMonths'], ['arrivalYearsWithDelay', 'minimumArrivalYearsWithDelay'], ['nonOverlappingDelayedOneYearWindows', 'minimumNonOverlappingDelayedOneYearWindows']];
  const tests = counts.map(([metric, gate]) => ({ metric, value: actions[metric], minimum: actionConfig[gate], passed: Number.isInteger(actions[metric]) && actions[metric] >= actionConfig[gate] }));
  tests.push({ metric: 'strictPositiveShareAmongDelayedMonths', value: actions.strictPositiveShareAmongDelayedMonths, minimum: actionConfig.minimumStrictPositiveShareAmongDelayedMonths,
    passed: Number.isFinite(actions.strictPositiveShareAmongDelayedMonths) && actions.strictPositiveShareAmongDelayedMonths >= actionConfig.minimumStrictPositiveShareAmongDelayedMonths });
  tests.push({ metric: 'medianDeltaPpAmongDelayedMonths', value: actions.medianDeltaPpAmongDelayedMonths, minimum: actionConfig.minimumMedianDeltaPpAmongDelayedMonths,
    passed: atLeast(actions.medianDeltaPpAmongDelayedMonths, actionConfig.minimumMedianDeltaPpAmongDelayedMonths) });
  actions.tests = tests; actions.sufficientCoverage = tests.slice(0, 3).every(t => t.passed); actions.passed = tests.every(t => t.passed);
  const concentration = concentrationChecks(rows), sufficient = rows.length > 0 && actions.sufficientCoverage && concentration.status !== 'insufficient';
  const passed = economic.passed && actions.passed && concentration.passed;
  return { status: !sufficient ? 'insufficient' : passed ? 'passed' : 'failed', passed, economic, actions, concentration };
}
function pairNonnegative(pair) {
  return { n: pair?.n ?? 0, meanDeltaPp: pair?.meanDeltaPp ?? null, medianDeltaPp: pair?.medianDeltaPp ?? null,
    passed: Number.isInteger(pair?.n) && pair.n > 0 && atLeast(pair.meanDeltaPp, 0) && atLeast(pair.medianDeltaPp, 0) };
}
function confirm(results, protocol) {
  const config = protocol.selectionAndConfirmation;
  const find = (partition, scenario = 'base', calendarDay = 1, evaluation = 'equal_age_lot') => results.find(r => r.partition === partition && r.scenario === scenario && r.calendarDay === calendarDay && r.evaluation === evaluation && r.horizonYears === 1)?.rules.find(r => r.id === MODEL_ID);
  const development = find('development')?.primaryEvidence ?? primaryGates(null, [], config);
  const confirmation = ['validation', 'replication'].map(partition => {
    const candidate = find(partition), primary = candidate?.primaryEvidence ?? primaryGates(null, [], config), interval = candidate?.vsImmediate.meanInterval;
    const intervalPassed = interval?.status === 'descriptive' && greater(interval.lower);
    const benchmarks = ['vsFixedDelay5', 'vsThreeTranches'].map(id => ({ id, ...pairNonnegative(candidate?.[id]) }));
    const stress = ['cash2', 'fee20'].map(scenario => ({ scenario, ...economicChecks(find(partition, scenario)?.vsImmediate, config.unconditionalGates, { minimumMean: 0, strictMean: true, minimumMedian: 0 }) }));
    const calendarTransfer = [10, 20].map(calendarDay => ({ calendarDay, ...pairNonnegative(find(partition, 'base', calendarDay)?.vsImmediate) }));
    const completeMonthlyAccount = economicChecks(find(partition, 'base', 1, 'twelve_deposit_account')?.vsImmediate, config.unconditionalGates, { minimumMean: 0, minimumMedian: 0 });
    const passed = primary.passed && intervalPassed && benchmarks.every(b => b.passed) && stress.every(s => s.passed) && calendarTransfer.every(c => c.passed) && completeMonthlyAccount.passed;
    return { partition, diagnosticOnly: !development.passed, primary, interval: interval ?? null, intervalPassed, benchmarks, stress, calendarTransfer, completeMonthlyAccount, passed };
  });
  const historicalConfirmationPassed = development.passed && confirmation.every(c => c.passed);
  return { candidate: MODEL_ID, candidateSelection: 'none_single_fixed_candidate', development, eligibleForConfirmation: development.passed, confirmation,
    historicalConfirmationPassed, integrationEligible: false, priorFailuresUnchanged: true,
    status: !development.passed ? 'development_' + (development.status === 'insufficient' ? 'insufficient' : 'failed') + '_research_only' : historicalConfirmationPassed ? 'historical_pass_pending_independent_and_production_validation' : 'confirmation_failed_research_only',
    pendingIntegrationRequirements: ['independent_annual_label_model_ledger_causality_audit', 'production_equivalent_fees_dividend_and_personal_tax', 'validated_portfolio_funding_holding_scope_and_future_recomputation'] };
}
function primaryDiagnostics(rows) {
  const { maturedFiveSessionLabels, ...diagnostics } = R2.diagnosticSummary(rows.map(r => ({ ...r, actualY: r.actualY, referenceForecast: r.referenceForecast })));
  return { ...diagnostics, maturedAnnualLabels: rows.length, scope: 'same_unique_primary_eligible_one_year_monthly_lots', units: 'full_original_deposit_fraction',
    identityMaximumErrorPp: rows.length ? Math.max(...rows.map(r => Math.abs(r.deltaPp - (r.offset === 5 ? 100 * r.actualY : 0)))) : null };
}
function evaluateResearch(market, model, parent, protocol, { audit = false } = {}) {
  const predictions = model.predictions, rules = [{ id: MODEL_ID }, ...protocol.benchmarks], results = [], coverage = [], pairedBaseWindows = [], auditWindows = [], primaryPredictionDiagnostics = [];
  for (const calendarDay of protocol.evaluation.allCalendars) {
    const schedule = S.buildArrivalSchedule(market, calendarDay);
    for (const evaluation of protocol.evaluation.allScopes) for (const years of protocol.evaluation.allHoldingYears) {
      const scope = S.buildScopeEpisodes(market, schedule, predictions, parent.episodes.partitions, evaluation, years, 100);
      coverage.push({ calendarDay, evaluation, years, excluded: scope.excluded, rejected: scope.rejected, attemptedStartMonths: scope.attemptedStartMonths,
        eligibleEpisodeCount: scope.episodes.length, exclusionUnits: scope.exclusionUnits, scheduledMonths: schedule });
      for (const scenario of parent.scenarios) for (const partition of parent.episodes.partitions) {
        const episodes = scope.episodes.filter(e => e.partition === partition.id);
        const accounts = new Map(rules.map(rule => [rule.id, episodes.map(ep => simulateFundingPlan(market, ep, rule, scenario, parent.portfolio, predictions, audit && scenario.id === 'base' ? { curve: false } : false))]));
        const rows = episodes.map((ep, i) => {
          const p = predictions[ep.startIndex], label = model.labels[ep.startIndex];
          const deltaPp = 100 * (accounts.get(MODEL_ID)[i].terminalWealth - accounts.get('immediate')[i].terminalWealth) / ep.contributed;
          if (evaluation === 'equal_age_lot' && years === 1 && scenario.id === 'base') {
            assert.ok(label && label.exitDay === ep.end, 'label and account endpoint mismatch');
            assert.ok(Math.abs(deltaPp - (p.offset === 5 ? 100 * label.y : 0)) < 1e-8, 'annual label/action/account identity mismatch');
            const fixedDelta = 100 * (accounts.get('fixed_delay5')[i].terminalWealth - accounts.get('immediate')[i].terminalWealth) / ep.contributed;
            assert.ok(Math.abs(fixedDelta - 100 * label.y) < 1e-8, 'fixed delay annual label identity mismatch');
          }
          return { day: ep.start, end: ep.end, deltaPp, offset: p.offset, featureDay: p.featureDay, trainingN: p.trainingN,
            latestTrainingExit: p.latestTrainingExit, trainingPoolSha256: p.trainingPoolSha256, predictedY: p.predictedY,
            predictedFullDepositBps: p.predictedFullDepositBps, referenceForecast: p.trainingMeanY, actualY: label?.y ?? null };
        });
        const primary = calendarDay === 1 && evaluation === 'equal_age_lot' && years === 1 && scenario.id === 'base';
        const ruleResults = rules.map(rule => ({ id: rule.id, summary: R1.summarizeAccounts(accounts.get(rule.id)),
          vsImmediate: pairedSummary(accounts.get(rule.id), accounts.get('immediate'), evaluation, years),
          vsFixedDelay5: pairedSummary(accounts.get(rule.id), accounts.get('fixed_delay5'), evaluation, years),
          vsThreeTranches: pairedSummary(accounts.get(rule.id), accounts.get('three_tranches'), evaluation, years) }));
        if (primary) { ruleResults[0].primaryEvidence = primaryGates(ruleResults[0].vsImmediate, rows, protocol.selectionAndConfirmation);
          primaryPredictionDiagnostics.push({ partition: partition.id, ...primaryDiagnostics(rows) }); }
        results.push({ calendarDay, primaryCalendar: calendarDay === 1, evaluation, horizonYears: years, scenario: scenario.id, partition: partition.id,
          startRange: episodes.length ? { first: episodes[0].start, last: episodes.at(-1).start } : null, decisionCoverage: S.decisionCoverage(episodes, predictions), rules: ruleResults });
        if (scenario.id === 'base') episodes.forEach((ep, i) => {
          const window = { calendarDay, evaluation, years, start: ep.start, end: ep.end, lastFundingDay: ep.lastFundingDay,
            anniversary: ep.anniversary, partition: ep.partition, scenario: 'base', fundingPlan: ep.fundingPlan };
          pairedBaseWindows.push({ ...window, contributed: ep.contributed, rules: Object.fromEntries(rules.map(rule => {
            const account = accounts.get(rule.id)[i], { trades, contributionAttribution, externalFlows, ...scalar } = account;
            return [rule.id, { ...scalar, deltaVsImmediatePp: 100 * (account.terminalWealth - accounts.get('immediate')[i].terminalWealth) / account.contributed }];
          })) });
          if (audit) auditWindows.push({ ...window, rules: Object.fromEntries(rules.map(rule => [rule.id, accounts.get(rule.id)[i]])) });
        });
      }
    }
  }
  return { results, coverage, pairedBaseWindows, primaryPredictionDiagnostics, auditWindows };
}
function loadInputs(protocolPath = path.join(ROOT, 'docs/research/portfolio-entry-value-protocol-v3.json')) {
  const text = fs.readFileSync(protocolPath), protocol = JSON.parse(text);
  assert.equal(protocol.id, 'equal-budget-mature-value-delay-v3'); assert.equal(protocol.model.id, MODEL_ID);
  assert.equal(protocol.model.minimumMatureLabels, MIN_TRAINING); assert.equal(protocol.model.ridgeLambda, 1); assert.equal(protocol.model.labelHoldingYears, 1); assert.equal(protocol.model.delaySessions, 5);
  for (const dependency of protocol.frozenDependencies) assert.equal(sha256(fs.readFileSync(path.join(ROOT, dependency.path))), dependency.sha256, dependency.path + ': frozen dependency mismatch');
  const source = S.loadInputs();
  return { protocol, parent: source.parent, market: source.market, inputs: {
    protocol: { path: path.relative(ROOT, protocolPath), sha256: sha256(text), id: protocol.id, frozenDate: protocol.frozenDate }, frozenDependencies: protocol.frozenDependencies,
    sourceSnapshot: source.inputs, researchEngine: { path: path.relative(ROOT, __filename), sha256: sha256(fs.readFileSync(__filename)) },
    marketCalendarSha256: source.inputs.marketCalendarSha256, actualCnyPriceRowsSha256: source.inputs.actualCnyPriceRowsSha256,
    first: source.market[0].day, end: source.market.at(-1).day, commonObservations: source.market.length
  } };
}
function runResearch({ audit = false, protocolPath } = {}) {
  const { protocol, parent, market, inputs } = loadInputs(protocolPath), model = buildPredictions(market, parent.portfolio);
  inputs.maturityQueueSha256 = sha256(JSON.stringify(model.maturityQueue)); inputs.predictionTraceSha256 = sha256(JSON.stringify(model.predictions));
  const result = evaluateResearch(market, model, parent, protocol, { audit });
  const report = { protocolId: protocol.id, generatedAt: new Date().toISOString(), inputs,
    method: { purpose: protocol.purpose, targetPreference: protocol.targetPreference, priorExposure: protocol.priorExposure, model: protocol.model,
      trainingPoolHash: 'initial SHA256(empty UTF8 string); on each sorted label event hash(previous lowercase hex + newline + JSON.stringify(full label)); prediction stores current prefix hash',
      units: 'label_and_prediction_fraction_of_full_deposit_account_deltas_percentage_points', precision: protocol.selectionAndConfirmation.precision,
      evaluations: protocol.evaluation, source: 'exact_hash_bound_snapshot_verified_through_immutable_scope_loader_without_reusing_old_predictions' },
    maturityQueue: model.maturityQueue, labelExclusions: model.labelExclusions, dailyPredictions: model.predictions,
    results: result.results, coverage: result.coverage, pairedBaseWindows: result.pairedBaseWindows,
    primaryPredictionDiagnostics: result.primaryPredictionDiagnostics, decision: confirm(result.results, protocol) };
  report.statisticsSha256 = sha256(JSON.stringify({ maturityQueue: report.maturityQueue, dailyPredictions: report.dailyPredictions, results: report.results,
    coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows, primaryPredictionDiagnostics: report.primaryPredictionDiagnostics, decision: report.decision }));
  return { report, audit: audit ? { protocolId: protocol.id, inputs, predictions: model.predictions, maturityQueue: model.maturityQueue, windows: result.auditWindows } : null };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = key => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : null; };
  const output = value('--output') || path.join(ROOT, 'docs/evidence/portfolio-entry-value-v3.json'), auditPath = value('--audit-output');
  const result = runResearch({ audit: Boolean(auditPath) });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result.report, null, 2) + '\n');
  if (auditPath) { fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify(result.audit) + '\n'); }
  console.log(JSON.stringify({ output, auditPath, statisticsSha256: result.report.statisticsSha256, groups: result.report.results.length,
    baseWindows: result.report.pairedBaseWindows.length, decision: result.report.decision,
    primary: result.report.results.filter(r => r.calendarDay === 1 && r.scenario === 'base' && r.evaluation === 'equal_age_lot' && r.horizonYears === 1).map(r => ({ partition: r.partition, candidate: r.rules[0] })) }, null, 2));
}
module.exports = { MODEL_ID, MIN_TRAINING, PP_TOLERANCE, buildLabelData, buildYearLabels, trainPredictions, buildPredictions, simulateFundingPlan, pairedSummary,
  concentrationChecks, primaryGates, economicChecks, pairNonnegative, confirm, primaryDiagnostics, evaluateResearch, loadInputs, runResearch, availablePrediction };
