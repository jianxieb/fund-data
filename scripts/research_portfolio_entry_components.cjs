#!/usr/bin/env node
'use strict';
// One joint v4 policy; two mandatory regressions and separate fixed-budget orders.
// No scalar candidate offset, cross-leg transfers or selection between components.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R1 = require('./research_portfolio_entry.cjs');
const R2 = require('./research_portfolio_entry_predictive.cjs');
const S = require('./research_portfolio_entry_scope.cjs');
const V3 = require('./research_portfolio_entry_value.cjs');
const P = require('../assets/portfolio-model.js');
const ROOT = path.resolve(__dirname, '..'), MODEL_ID = 'expanding_component_ridge_year1_delay5', MIN_TRAINING = 756, YEAR = 365.2425, PP_TOLERANCE = 1e-10;
const COMPONENT_IDS = ['us:USD', 'us:TQQQ'];
const CATEGORIES = ['both_immediate', 'delay_usd_only', 'delay_tqqq_only', 'delay_both'];
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sum = xs => xs.reduce((a, b) => a + b, 0), mean = xs => xs.length ? sum(xs) / xs.length : null;
const gap = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
const finiteFeatures = xs => Array.isArray(xs) && xs.length === 5 && xs.every(Number.isFinite);
const greater = v => Number.isFinite(v) && v > PP_TOLERANCE;
const atLeast = (v, minimum) => Number.isFinite(v) && v >= minimum - PP_TOLERANCE;
function lowerBound(market, day) { let lo = 0, hi = market.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (market[mid].day < day) lo = mid + 1; else hi = mid; } return lo; }
function featureAt(features, index, id) { return features[index]?.components[id]?.features; }
function deriveAction(componentValues) {
  if (!COMPONENT_IDS.every(id => Number.isFinite(componentValues?.[id]))) return { legOffsets: null, anyDelay: null, actionCategory: null };
  const legOffsets = Object.fromEntries(COMPONENT_IDS.map(id => [id, componentValues[id] > 1e-12 ? 5 : 0]));
  const a = legOffsets['us:USD'] === 5, b = legOffsets['us:TQQQ'] === 5;
  return { legOffsets, anyDelay: a || b, actionCategory: a ? b ? 'delay_both' : 'delay_usd_only' : b ? 'delay_tqqq_only' : 'both_immediate' };
}
function validComponentFit(c, trainingN) {
  return c?.trainingN === trainingN && Number.isFinite(c.trainingMeanY) && Number.isFinite(c.predictedY) && Number.isFinite(c.predictedFullDepositBps) &&
    [c.features, c.featureMeans, c.featureStd, c.beta].every(finiteFeatures) && c.featureStd.every(sd => sd >= 0);
}
function availablePrediction(p) {
  if (!p || p.missing !== null || p.labelHoldingYears !== 1 || !Number.isInteger(p.trainingN) || p.trainingN < MIN_TRAINING || !COMPONENT_IDS.every(id => validComponentFit(p.components?.[id], p.trainingN))) return false;
  const expected = deriveAction(Object.fromEntries(COMPONENT_IDS.map(id => [id, p.components[id].predictedY])));
  return COMPONENT_IDS.every(id => p.legOffsets?.[id] === expected.legOffsets[id]) && p.anyDelay === expected.anyDelay && p.actionCategory === expected.actionCategory;
}
function buildComponentFeatures(market) {
  const rows = market.map(r => ({ day: r.day, components: {} }));
  for (let j = 0; j < COMPONENT_IDS.length; j++) {
    const id = COMPONENT_IDS[j], prices = market.map(r => r.prices[j]), returns = []; let peak = 0, maSum = 0;
    for (let i = 0; i < market.length; i++) {
      const price = prices[i]; assert.ok(Number.isFinite(price) && price > 0); assert.ok(!i || market[i].day > market[i - 1].day);
      if (i) returns.push(price / prices[i - 1] - 1);
      peak = Math.max(peak, price); maSum += price; if (i >= 200) maSum -= prices[i - 200];
      const recent = returns.slice(-21), avg = mean(recent), volatility = recent.length === 21 ? Math.sqrt(sum(recent.map(r => (r - avg) ** 2)) / 20) : null;
      rows[i].components[id] = { features: [i >= 199 ? price / (maSum / 200) - 1 : null, price / peak - 1,
        i >= 5 ? price / prices[i - 5] - 1 : null, i >= 21 ? price / prices[i - 21] - 1 : null, volatility] };
    }
  }
  return rows;
}
function buildLabelData(market, features, portfolio, feeRate = .001) {
  assert.deepEqual(portfolio.positions.map(p => p.id), COMPONENT_IDS);
  const excluded = {}, labels = market.map((row, s) => {
    const missing = reason => { excluded[reason] = (excluded[reason] || 0) + 1; return null; };
    if (!s || !COMPONENT_IDS.every(id => finiteFeatures(featureAt(features, s - 1, id)))) return missing('incomplete_prior_component_features');
    const anniversary = P.addYears(row.day, 1), exitIndex = lowerBound(market, anniversary);
    if (exitIndex >= market.length) return missing('year_terminal_not_observed');
    const exitDay = market[exitIndex].day;
    if (gap(anniversary, exitDay) > 14) return missing('year_terminal_more_than_14_days_late');
    if (s + 5 > exitIndex) return missing('five_session_purchase_after_terminal');
    const components = Object.fromEntries(COMPONENT_IDS.map((id, j) => [id, { features: featureAt(features, s - 1, id).slice(),
      y: (1 - feeRate) / (1 + feeRate) * portfolio.positions[j].weight * market[exitIndex].prices[j] * (1 / market[s + 5].prices[j] - 1 / row.prices[j]) }]));
    if (!COMPONENT_IDS.every(id => Number.isFinite(components[id].y))) return missing('nonfinite_component_annual_label');
    return { entryIndex: s, entryDay: row.day, featureDay: market[s - 1].day, exitIndex, exitDay, anniversary, components };
  });
  return { labels, excluded };
}
function trainPredictions(market, features, labels) {
  const maturityQueue = labels.filter(Boolean).sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex);
  const states = Object.fromEntries(COMPONENT_IDS.map(id => [id, R2.createMoments()])), predictions = [];
  let pointer = 0, poolHash = sha256(''), latestTrainingEntry = null, latestTrainingExit = null;
  for (let t = 0; t < market.length; t++) {
    let inserted = 0;
    while (pointer < maturityQueue.length && maturityQueue[pointer].exitIndex <= t - 1) {
      const event = maturityQueue[pointer++];
      for (const id of COMPONENT_IDS) { assert.ok(finiteFeatures(event.components[id].features) && Number.isFinite(event.components[id].y)); R2.updateMoments(states[id], event.components[id].features, event.components[id].y); }
      poolHash = sha256(poolHash + '\n' + JSON.stringify(event)); latestTrainingEntry = event.entryDay; latestTrainingExit = event.exitDay; inserted++;
    }
    assert.ok(COMPONENT_IDS.every(id => states[id].n === pointer));
    const header = { day: market[t].day, executionDay: market[t].day, featureDay: t ? market[t - 1].day : null, labelHoldingYears: 1,
      trainingN: pointer, trainingQueuePrefixLength: pointer, trainingPoolSha256: poolHash, latestTrainingEntry, latestTrainingExit, newlyMatureLabels: inserted };
    const unavailableFeatures = COMPONENT_IDS.filter(id => !finiteFeatures(featureAt(features, t - 1, id)));
    if (pointer < MIN_TRAINING || unavailableFeatures.length) {
      predictions.push({ ...header, components: Object.fromEntries(COMPONENT_IDS.map(id => [id, null])), legOffsets: null, anyDelay: null, actionCategory: null,
        missing: pointer < MIN_TRAINING ? 'fewer_than_756_shared_mature_annual_dates' : 'incomplete_prior_component_features:' + unavailableFeatures.join(',') }); continue;
    }
    const components = {}, failed = [];
    for (const id of COMPONENT_IDS) {
      const x = featureAt(features, t - 1, id);
      try {
        const fit = R2.fitMoments(states[id], 1), predictedY = R2.predictFit(fit, x);
        if (![fit.trainingMeanY, predictedY, 10000 * predictedY, ...fit.featureMeans, ...fit.featureStd, ...fit.beta].every(Number.isFinite)) throw new Error('nonfinite_component_fit');
        components[id] = { ...fit, features: x.slice(), predictedY, predictedFullDepositBps: 10000 * predictedY };
      } catch (error) { failed.push(id); components[id] = { features: x.slice(), predictedY: null, missing: error.message }; }
    }
    predictions.push({ ...header, components, ...deriveAction(Object.fromEntries(COMPONENT_IDS.map(id => [id, components[id].predictedY]))),
      missing: failed.length ? 'invalid_component_fit:' + failed.join(',') : null });
  }
  return { maturityQueue, predictions };
}
function buildPredictions(market, portfolio) {
  const features = buildComponentFeatures(market), labelData = buildLabelData(market, features, portfolio);
  return { features, labels: labelData.labels, labelExclusions: labelData.excluded, ...trainPredictions(market, features, labelData.labels) };
}
function buildScopeEpisodes(market, schedule, predictions, partitions, evaluation, years, amount = 100) {
  assert.ok(['equal_age_lot', 'twelve_deposit_account'].includes(evaluation)); assert.ok([1, 3].includes(years));
  const depositCount = evaluation === 'equal_age_lot' ? 1 : 12, episodes = [], rejected = [], counts = {};
  function reject(row, reason, detail = null) {
    counts[reason] = (counts[reason] || 0) + 1;
    rejected.push({ month: row.month, requestedDay: row.requestedDay, start: row.day, evaluation, years, reason, ...(detail ? { detail } : {}) });
  }
  for (let s = 0; s < schedule.length; s++) {
    const first = schedule[s];
    if (first.index === null) { reject(first, first.missing); continue; }
    if (!availablePrediction(predictions[first.index])) { reject(first, 'prediction_unavailable_at_start'); continue; }
    const partition = partitions.find(p => (!p.start || first.day >= p.start) && (!p.end || first.day <= p.end));
    if (!partition) { reject(first, 'outside_registered_partitions'); continue; }
    if (s + depositCount > schedule.length) { reject(first, 'funding_months_not_yet_observed'); continue; }
    const arrivals = schedule.slice(s, s + depositCount), absent = arrivals.find(a => a.index === null);
    if (absent) { reject(first, 'required_funding_date_missing', absent.requestedDay + ': ' + absent.missing); continue; }
    assert.ok(arrivals.every((a, i) => a.month === S.monthOffset(first.month, i)), 'deposits must be consecutive calendar months');
    const missingPrediction = arrivals.find(a => !availablePrediction(predictions[a.index]));
    if (missingPrediction) { reject(first, 'prediction_unavailable_on_funding_date', missingPrediction.day); continue; }
    const lastFundingDay = arrivals.at(-1).day, anniversary = P.addYears(lastFundingDay, years), endIndex = lowerBound(market, anniversary);
    if (endIndex >= market.length) { reject(first, 'terminal_outcome_unmatured', anniversary); continue; }
    const end = market[endIndex].day;
    if (gap(anniversary, end) > 14) { reject(first, 'terminal_close_more_than_14_calendar_days_late', anniversary); continue; }
    if (partition.end && end > partition.end) { reject(first, 'complete_outcome_crosses_partition', partition.end); continue; }
    assert.ok(arrivals.every(a => (!partition.start || a.day >= partition.start) && (!partition.end || a.day <= partition.end)));
    const fundingPlan = arrivals.map(a => ({ day: a.day, index: a.index, amount, requestedDay: a.requestedDay }));
    episodes.push({ evaluation, years, start: first.day, startIndex: first.index, end, endIndex, anniversary, lastFundingDay,
      partition: partition.id, depositCount, fundingPlan, contributed: amount * depositCount });
  }
  return { episodes, excluded: counts, rejected, attemptedStartMonths: schedule.length, exclusionUnits: 'one_start_month_for_this_evaluation_and_horizon' };
}
function simulateFundingPlan(market, episode, rule, scenario, portfolio, predictions, audit = false) {
  assert.equal(scenario.capitalTaxRate, 0); assert.equal(scenario.dividendTaxRate, 0);
  assert.ok(scenario.feeRate >= 0 && scenario.feeRate < 1 && scenario.annualCashRate >= 0);
  assert.deepEqual(portfolio.positions.map(p => p.id), COMPONENT_IDS);
  assert.ok(Math.abs(sum(portfolio.positions.map(p => p.weight)) + portfolio.strategicCashWeight - 1) < 1e-12);
  const plan = episode.fundingPlan, arrivals = new Map(plan.map(p => [p.index, p]));
  assert.equal(plan.length, episode.depositCount); assert.equal(arrivals.size, plan.length);
  assert.ok(plan.every((p, i) => p.day === market[p.index]?.day && p.index >= episode.startIndex && p.index <= episode.endIndex && p.amount > 0 && (!i || p.index > plan[i - 1].index)));
  const units = COMPONENT_IDS.map(() => 0), lots = [], deposits = [], trades = [], curve = [];
  let strategicCash = 0, fundUnits = 0, contributed = 0, fees = 0, interest = 0, peak = 1, mdd = 0;
  const pendingCash = () => sum(lots.filter(l => l.boughtIndex === null).map(l => l.cash));
  const wealth = prices => strategicCash + pendingCash() + sum(units.map((u, j) => u * prices[j]));
  for (let index = episode.startIndex; index <= episode.endIndex; index++) {
    const row = market[index];
    if (index > episode.startIndex && scenario.annualCashRate) {
      const factor = (1 + scenario.annualCashRate) ** (gap(market[index - 1].day, row.day) / YEAR), before = strategicCash + pendingCash();
      strategicCash *= factor;
      for (const d of deposits) { d.strategicInterest += d.strategicCash * (factor - 1); d.strategicCash *= factor; }
      for (const lot of lots) if (lot.boughtIndex === null) { lot.waitingInterest += lot.cash * (factor - 1); lot.cash *= factor; }
      interest += strategicCash + pendingCash() - before;
    }
    const arrival = arrivals.get(index);
    if (arrival) {
      const nav = fundUnits ? wealth(row.prices) / fundUnits : 1; assert.ok(Number.isFinite(nav) && nav > 0);
      fundUnits += arrival.amount / nav; contributed += arrival.amount; strategicCash += arrival.amount * portfolio.strategicCashWeight;
      const prediction = predictions[index];
      if (rule.id === MODEL_ID) {
        assert.ok(availablePrediction(prediction), 'both component predictions required'); assert.equal(prediction.day, row.day);
        assert.equal(prediction.featureDay, market[index - 1]?.day); assert.ok(prediction.latestTrainingExit <= prediction.featureDay);
      }
      const depositIndex = deposits.length;
      deposits.push({ arrivalDay: arrival.day, amount: arrival.amount, strategicCash: arrival.amount * portfolio.strategicCashWeight, strategicInterest: 0,
        ...(rule.id === MODEL_ID ? { legOffsets: { ...prediction.legOffsets }, anyDelay: prediction.anyDelay, actionCategory: prediction.actionCategory } : {}) });
      for (let j = 0; j < COMPONENT_IDS.length; j++) {
        const id = COMPONENT_IDS[j], offsets = rule.id === MODEL_ID ? [prediction.legOffsets[id]] : rule.offsets;
        assert.ok(offsets.length && offsets.every(offset => Number.isInteger(offset) && offset >= 0));
        for (const offset of offsets) lots.push({ depositIndex, id, assetIndex: j, arrivalIndex: index, arrivalDay: row.day, offset, executionIndex: index + offset,
          original: arrival.amount * portfolio.positions[j].weight / offsets.length, cash: arrival.amount * portfolio.positions[j].weight / offsets.length,
          units: 0, buyFees: 0, waitingInterest: 0, boughtIndex: null,
          ...(rule.id === MODEL_ID ? { featureDay: prediction.featureDay, predictedY: prediction.components[id].predictedY, trainingN: prediction.trainingN,
            latestTrainingExit: prediction.latestTrainingExit, trainingPoolSha256: prediction.trainingPoolSha256, labelHoldingYears: prediction.labelHoldingYears } : {}) });
      }
    }
    for (const lot of lots) {
      if (lot.boughtIndex !== null || index !== lot.executionIndex) continue;
      const price = row.prices[lot.assetIndex], notional = lot.cash / (1 + scenario.feeRate), fee = notional * scenario.feeRate, boughtUnits = notional / price;
      lot.units += boughtUnits; units[lot.assetIndex] += boughtUnits; fees += fee; lot.buyFees += fee; lot.boughtIndex = index; lot.cash = 0;
      if (audit) trades.push({ day: row.day, side: 'buy', id: lot.id, units: boughtUnits, price, notional, fee, arrivalDay: lot.arrivalDay, decisionDay: lot.arrivalDay,
        offset: lot.offset, waitSessions: index - lot.arrivalIndex, featureDay: lot.featureDay ?? null, predictedY: lot.predictedY ?? null,
        trainingN: lot.trainingN ?? null, latestTrainingExit: lot.latestTrainingExit ?? null, trainingPoolSha256: lot.trainingPoolSha256 ?? null, labelHoldingYears: lot.labelHoldingYears ?? null,
        reason: rule.id === MODEL_ID ? 'locked_component_annual_value_prediction' : 'fixed_component_tranche' });
    }
    if (index === episode.endIndex) for (let j = 0; j < units.length; j++) {
      if (!units[j]) continue;
      const notional = units[j] * row.prices[j], fee = notional * scenario.feeRate; fees += fee; strategicCash += notional - fee;
      if (audit) trades.push({ day: row.day, side: 'sell', id: COMPONENT_IDS[j], units: units[j], price: row.prices[j], notional, fee, reason: 'terminal_liquidation' });
      units[j] = 0;
    }
    const value = wealth(row.prices), nav = value / fundUnits;
    assert.ok(Number.isFinite(value) && strategicCash >= -1e-9 && lots.every(l => l.cash >= -1e-9)); peak = Math.max(peak, nav); mdd = Math.min(mdd, 100 * (nav / peak - 1));
    if (audit === true || audit?.curve) curve.push({ day: row.day, value, nav, contributed, strategicCash, pendingCash: pendingCash(), units: units.slice(), fees, interest });
  }
  const terminalWealth = wealth(market[episode.endIndex].prices), original = sum(lots.map(l => l.original)), executed = lots.filter(l => l.boughtIndex !== null), executedBudget = sum(executed.map(l => l.original));
  const contributionAttribution = deposits.map((deposit, depositIndex) => {
    const components = Object.fromEntries(COMPONENT_IDS.map((id, j) => {
      const scheduledPurchases = lots.filter(l => l.depositIndex === depositIndex && l.id === id).map(lot => {
        const terminalGrossValue = lot.units * market[episode.endIndex].prices[j], sellFees = terminalGrossValue * scenario.feeRate;
        return { originalBudget: lot.original, offset: lot.offset, scheduledIndex: lot.executionIndex, scheduledDay: market[lot.executionIndex]?.day ?? null,
          executedDay: lot.boughtIndex === null ? null : market[lot.boughtIndex].day, units: lot.units, buyFees: lot.buyFees, sellFees, waitingInterest: lot.waitingInterest,
          terminalGrossValue, productLiquidationValue: terminalGrossValue - sellFees, pendingCash: lot.cash, waitSessions: (lot.boughtIndex ?? episode.endIndex) - lot.arrivalIndex };
      });
      const pending = sum(scheduledPurchases.map(l => l.pendingCash)), productLiquidationValue = sum(scheduledPurchases.map(l => l.productLiquidationValue));
      return [id, { originalBudget: deposit.amount * portfolio.positions[j].weight, pendingCash: pending, productLiquidationValue, terminalWealth: pending + productLiquidationValue,
        fees: sum(scheduledPurchases.map(l => l.buyFees + l.sellFees)), waitingInterest: sum(scheduledPurchases.map(l => l.waitingInterest)),
        executedUnits: sum(scheduledPurchases.map(l => l.units)), scheduledPurchases }];
    }));
    return { ...deposit, components, terminalWealth: deposit.strategicCash + sum(COMPONENT_IDS.map(id => components[id].terminalWealth)),
      fees: sum(COMPONENT_IDS.map(id => components[id].fees)), interest: deposit.strategicInterest + sum(COMPONENT_IDS.map(id => components[id].waitingInterest)) };
  });
  assert.equal(contributed, sum(plan.map(p => p.amount)));
  assert.ok(Math.abs(sum(contributionAttribution.map(a => a.terminalWealth)) - terminalWealth) < Math.max(1e-8, Math.abs(terminalWealth) * 1e-12));
  return { rule: rule.id, evaluation: episode.evaluation, start: episode.start, end: episode.end, lastFundingDay: episode.lastFundingDay,
    years: episode.years, partition: episode.partition, fundingMode: episode.evaluation, depositCount: plan.length, terminalWealth, contributed,
    accountReturnPp: 100 * (terminalWealth / contributed - 1), navReturnPp: 100 * (terminalWealth / fundUnits - 1), maxDrawdownPp: mdd,
    meanWaitSessions: sum(lots.map(l => l.original * ((l.boughtIndex ?? episode.endIndex) - l.arrivalIndex))) / original,
    executedMeanWaitSessions: executedBudget ? sum(executed.map(l => l.original * (l.boughtIndex - l.arrivalIndex))) / executedBudget : null,
    pendingCash: pendingCash(), pendingLots: lots.length - executed.length, fees, interest,
    externalFlows: plan.map(({ day, amount }) => ({ day, amount })), contributionAttribution, ...(audit ? { trades } : {}), ...(audit === true || audit?.curve ? { curve, lots } : {}) };
}
function nonOverlap(rows) {
  let last = '', count = 0;
  for (const row of rows.slice().sort((a, b) => a.day.localeCompare(b.day))) if (row.day > last) { count++; last = row.end; }
  return count;
}
function primaryGates(pair, rows, config) {
  const economic = V3.economicChecks(pair, config.unconditionalGates), delayed = rows.filter(r => r.anyDelay === true), actionConfig = config.actionGates;
  const actions = { perComponentDelayedMonths: Object.fromEntries(COMPONENT_IDS.map(id => [id, rows.filter(r => r.legOffsets?.[id] === 5).length])), uniqueDelayedMonths: delayed.length, arrivalYearsWithDelay: new Set(delayed.map(r => r.day.slice(0, 4))).size,
    nonOverlappingDelayedOneYearWindows: nonOverlap(delayed), strictPositiveShareAmongDelayedMonths: delayed.length ? delayed.filter(r => greater(r.deltaPp)).length / delayed.length : null,
    medianDeltaPpAmongDelayedMonths: R1.quantile(delayed.map(r => r.deltaPp), .5), dates: delayed };
  const counts = [['uniqueDelayedMonths', 'minimumUniqueDelayedMonths'], ['arrivalYearsWithDelay', 'minimumArrivalYearsWithDelay'], ['nonOverlappingDelayedOneYearWindows', 'minimumNonOverlappingDelayedOneYearWindows']];
  const tests = counts.map(([metric, gate]) => ({ metric, value: actions[metric], minimum: actionConfig[gate], passed: Number.isInteger(actions[metric]) && actions[metric] >= actionConfig[gate] }));
  tests.push({ metric: 'strictPositiveShareAmongDelayedMonths', value: actions.strictPositiveShareAmongDelayedMonths, minimum: actionConfig.minimumStrictPositiveShareAmongDelayedMonths,
    passed: Number.isFinite(actions.strictPositiveShareAmongDelayedMonths) && actions.strictPositiveShareAmongDelayedMonths >= actionConfig.minimumStrictPositiveShareAmongDelayedMonths });
  tests.push({ metric: 'medianDeltaPpAmongDelayedMonths', value: actions.medianDeltaPpAmongDelayedMonths, minimum: actionConfig.minimumMedianDeltaPpAmongDelayedMonths,
    passed: atLeast(actions.medianDeltaPpAmongDelayedMonths, actionConfig.minimumMedianDeltaPpAmongDelayedMonths) });
  actions.tests = tests; actions.sufficientCoverage = tests.slice(0, 3).every(t => t.passed); actions.passed = tests.every(t => t.passed);
  const concentration = V3.concentrationChecks(rows), sufficient = rows.length > 0 && actions.sufficientCoverage && concentration.status !== 'insufficient';
  const passed = economic.passed && actions.passed && concentration.passed;
  return { status: !sufficient ? 'insufficient' : passed ? 'passed' : 'failed', passed, economic, actions, concentration };
}
function confirm(results, protocol) {
  const config = protocol.selectionAndConfirmation;
  const find = (partition, scenario = 'base', calendarDay = 1, evaluation = 'equal_age_lot') => results.find(r => r.partition === partition && r.scenario === scenario && r.calendarDay === calendarDay && r.evaluation === evaluation && r.horizonYears === 1)?.rules.find(r => r.id === MODEL_ID);
  const development = find('development')?.primaryEvidence ?? primaryGates(null, [], config);
  const confirmation = ['validation', 'replication'].map(partition => {
    const candidate = find(partition), primary = candidate?.primaryEvidence ?? primaryGates(null, [], config), interval = candidate?.vsImmediate.meanInterval;
    const intervalPassed = interval?.status === 'descriptive' && greater(interval.lower);
    const benchmarks = ['vsFixedDelay5', 'vsThreeTranches'].map(id => ({ id, ...V3.pairNonnegative(candidate?.[id]) }));
    const stress = ['cash2', 'fee20'].map(scenario => ({ scenario, ...V3.economicChecks(find(partition, scenario)?.vsImmediate, config.unconditionalGates, { minimumMean: 0, strictMean: true, minimumMedian: 0 }) }));
    const calendarTransfer = [10, 20].map(calendarDay => ({ calendarDay, ...V3.pairNonnegative(find(partition, 'base', calendarDay)?.vsImmediate) }));
    const completeMonthlyAccount = V3.economicChecks(find(partition, 'base', 1, 'twelve_deposit_account')?.vsImmediate, config.unconditionalGates, { minimumMean: 0, minimumMedian: 0 });
    const passed = primary.passed && intervalPassed && benchmarks.every(b => b.passed) && stress.every(s => s.passed) && calendarTransfer.every(c => c.passed) && completeMonthlyAccount.passed;
    return { partition, diagnosticOnly: !development.passed, primary, interval: interval ?? null, intervalPassed, benchmarks, stress, calendarTransfer, completeMonthlyAccount, passed };
  });
  const historicalConfirmationPassed = development.passed && confirmation.every(c => c.passed);
  return { candidate: MODEL_ID, candidateSelection: 'none_single_fixed_candidate', development, eligibleForConfirmation: development.passed, confirmation,
    historicalConfirmationPassed, integrationEligible: false, priorFailuresUnchanged: true,
    status: !development.passed ? 'development_' + (development.status === 'insufficient' ? 'insufficient' : 'failed') + '_research_only' : historicalConfirmationPassed ? 'historical_pass_pending_independent_and_production_validation' : 'confirmation_failed_research_only',
    pendingIntegrationRequirements: ['independent_annual_label_model_ledger_causality_audit', 'production_equivalent_fees_dividend_and_personal_tax', 'validated_portfolio_funding_holding_scope_and_future_recomputation'] };
}
function decisionCoverage(episodes, predictions) {
  const decisions = new Map();
  for (const ep of episodes) for (const arrival of ep.fundingPlan) {
    if (decisions.has(arrival.day)) { decisions.get(arrival.day).occurrencesInAccounts++; continue; }
    const p = predictions[arrival.index]; assert.ok(availablePrediction(p));
    decisions.set(arrival.day, { day: arrival.day, featureDay: p.featureDay, trainingN: p.trainingN, latestTrainingExit: p.latestTrainingExit,
      legOffsets: { ...p.legOffsets }, anyDelay: p.anyDelay, actionCategory: p.actionCategory,
      predictedYByComponent: Object.fromEntries(COMPONENT_IDS.map(id => [id, p.components[id].predictedY])), occurrencesInAccounts: 1 });
  }
  const dates = [...decisions.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { uniqueArrivalDecisions: dates.length, delayedUniqueDecisions: dates.filter(d => d.anyDelay).length,
    perComponentDelayedDecisions: Object.fromEntries(COMPONENT_IDS.map(id => [id, dates.filter(d => d.legOffsets[id] === 5).length])),
    actionCategoryCounts: Object.fromEntries(CATEGORIES.map(category => [category, dates.filter(d => d.actionCategory === category).length])), dates };
}
function forecastMetrics(rows) {
  const errors = rows.map(r => r.predictedY - r.actualY), baseline = rows.map(r => r.referenceForecast - r.actualY);
  const MSE = mean(errors.map(e => e * e)), referenceMSE = mean(baseline.map(e => e * e));
  return { n: rows.length, MAE: mean(errors.map(Math.abs)), MSE, referenceMAE: mean(baseline.map(Math.abs)), referenceMSE,
    R2: referenceMSE > 0 ? 1 - MSE / referenceMSE : null, dates: rows };
}
function primaryDiagnostics(rows) {
  const components = Object.fromEntries(COMPONENT_IDS.map(id => [id, forecastMetrics(rows.map(r => ({ day: r.day, ...r.components[id] })))]));
  const bothDelayCounterfactual = forecastMetrics(rows.map(r => ({ day: r.day, predictedY: sum(COMPONENT_IDS.map(id => r.components[id].predictedY)),
    actualY: sum(COMPONENT_IDS.map(id => r.components[id].actualY)), referenceForecast: sum(COMPONENT_IDS.map(id => r.components[id].referenceForecast)) })));
  const categories = CATEGORIES.map(actionCategory => {
    const group = rows.filter(r => r.actionCategory === actionCategory), totalDeltaPp = sum(group.map(r => r.deltaPp));
    return { actionCategory, n: group.length, conditionalMeanDeltaPp: mean(group.map(r => r.deltaPp)), medianDeltaPp: R1.quantile(group.map(r => r.deltaPp), .5),
      strictPositiveShare: group.length ? group.filter(r => greater(r.deltaPp)).length / group.length : null, totalDeltaPp,
      unconditionalMeanContributionPp: rows.length ? totalDeltaPp / rows.length : null, dates: group.map(r => r.day) };
  });
  return { scope: 'distinct_primary_monthly_whole_deposit_outcomes', units: 'full_original_deposit_fraction_for_forecasts_percentage_points_for_account_deltas',
    uniqueMonths: rows.length, anyDelayMonths: rows.filter(r => r.anyDelay).length, components,
    bothDelayCounterfactual: { meaning: 'both_products_delay_five_sessions_not_the_realized_joint_policy_when_one_leg_waits', ...bothDelayCounterfactual }, categories,
    identityMaximumErrorPp: rows.length ? Math.max(...rows.map(r => Math.abs(r.deltaPp - 100 * sum(COMPONENT_IDS.map(id => r.legOffsets[id] === 5 ? r.components[id].actualY : 0))))) : null,
    dates: rows };
}
function evaluateResearch(market, model, parent, protocol, { audit = false } = {}) {
  const predictions = model.predictions, rules = [{ id: MODEL_ID }, ...protocol.benchmarks], results = [], coverage = [], pairedBaseWindows = [], auditWindows = [], primaryPredictionDiagnostics = [];
  for (const calendarDay of protocol.evaluation.allCalendars) {
    const schedule = S.buildArrivalSchedule(market, calendarDay);
    for (const evaluation of protocol.evaluation.allScopes) for (const years of protocol.evaluation.allHoldingYears) {
      const scope = buildScopeEpisodes(market, schedule, predictions, parent.episodes.partitions, evaluation, years, 100);
      coverage.push({ calendarDay, evaluation, years, excluded: scope.excluded, rejected: scope.rejected, attemptedStartMonths: scope.attemptedStartMonths,
        eligibleEpisodeCount: scope.episodes.length, exclusionUnits: scope.exclusionUnits, scheduledMonths: schedule });
      for (const scenario of parent.scenarios) for (const partition of parent.episodes.partitions) {
        const episodes = scope.episodes.filter(e => e.partition === partition.id);
        const accounts = new Map(rules.map(rule => [rule.id, episodes.map(ep => simulateFundingPlan(market, ep, rule, scenario, parent.portfolio, predictions, audit && scenario.id === 'base' ? { curve: false } : false))]));
        const rows = episodes.map((ep, i) => {
          const p = predictions[ep.startIndex], label = model.labels[ep.startIndex], deltaPp = 100 * (accounts.get(MODEL_ID)[i].terminalWealth - accounts.get('immediate')[i].terminalWealth) / ep.contributed;
          if (evaluation === 'equal_age_lot' && years === 1 && scenario.id === 'base') {
            assert.ok(label && label.exitDay === ep.end);
            const identity = 100 * sum(COMPONENT_IDS.map(id => p.legOffsets[id] === 5 ? label.components[id].y : 0));
            assert.ok(Math.abs(deltaPp - identity) < 1e-8, 'joint leg-action/annual-label/account identity mismatch');
            const fixedDelta = 100 * (accounts.get('fixed_delay5')[i].terminalWealth - accounts.get('immediate')[i].terminalWealth) / ep.contributed;
            assert.ok(Math.abs(fixedDelta - 100 * sum(COMPONENT_IDS.map(id => label.components[id].y))) < 1e-8, 'both-delay counterfactual mismatch');
          }
          return { day: ep.start, end: ep.end, deltaPp, legOffsets: { ...p.legOffsets }, anyDelay: p.anyDelay, actionCategory: p.actionCategory,
            featureDay: p.featureDay, trainingN: p.trainingN, latestTrainingExit: p.latestTrainingExit, trainingPoolSha256: p.trainingPoolSha256,
            components: Object.fromEntries(COMPONENT_IDS.map(id => [id, { predictedY: p.components[id].predictedY, predictedFullDepositBps: p.components[id].predictedFullDepositBps,
              referenceForecast: p.components[id].trainingMeanY, actualY: label?.components[id]?.y ?? null, legOffset: p.legOffsets[id] }])) };
        });
        const primary = calendarDay === 1 && evaluation === 'equal_age_lot' && years === 1 && scenario.id === 'base';
        const ruleResults = rules.map(rule => ({ id: rule.id, summary: R1.summarizeAccounts(accounts.get(rule.id)),
          vsImmediate: V3.pairedSummary(accounts.get(rule.id), accounts.get('immediate'), evaluation, years),
          vsFixedDelay5: V3.pairedSummary(accounts.get(rule.id), accounts.get('fixed_delay5'), evaluation, years),
          vsThreeTranches: V3.pairedSummary(accounts.get(rule.id), accounts.get('three_tranches'), evaluation, years) }));
        if (primary) { ruleResults[0].primaryEvidence = primaryGates(ruleResults[0].vsImmediate, rows, protocol.selectionAndConfirmation); primaryPredictionDiagnostics.push({ partition: partition.id, ...primaryDiagnostics(rows) }); }
        results.push({ calendarDay, primaryCalendar: calendarDay === 1, evaluation, horizonYears: years, scenario: scenario.id, partition: partition.id,
          startRange: episodes.length ? { first: episodes[0].start, last: episodes.at(-1).start } : null, decisionCoverage: decisionCoverage(episodes, predictions), rules: ruleResults });
        if (scenario.id === 'base') episodes.forEach((ep, i) => {
          const window = { calendarDay, evaluation, years, start: ep.start, end: ep.end, lastFundingDay: ep.lastFundingDay, anniversary: ep.anniversary, partition: ep.partition, scenario: 'base', fundingPlan: ep.fundingPlan };
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
function loadInputs(protocolPath = path.join(ROOT, 'docs/research/portfolio-entry-components-protocol-v4.json')) {
  const text = fs.readFileSync(protocolPath), protocol = JSON.parse(text);
  assert.equal(protocol.id, 'equal-budget-component-value-delay-v4'); assert.equal(protocol.status, 'frozen_before_component_labels_predictions_and_outcomes', 'v4 protocol must be frozen before loading research inputs'); assert.equal(protocol.model.id, MODEL_ID);
  assert.equal(protocol.model.minimumMatureLabels, MIN_TRAINING); assert.equal(protocol.model.ridgeLambda, 1); assert.equal(protocol.model.delaySessions, 5); assert.equal(protocol.model.labelHoldingYears, 1);
  assert.deepEqual(protocol.model.components, COMPONENT_IDS.map(id => ({ id, originalWeight: .3 })));
  for (const dependency of protocol.frozenDependencies) assert.equal(sha256(fs.readFileSync(path.join(ROOT, dependency.path))), dependency.sha256, dependency.path + ': frozen dependency mismatch');
  const source = V3.loadInputs();
  assert.equal(source.parent.portfolio.currency, 'CNY'); assert.equal(source.parent.portfolio.strategicCashWeight, .4);
  assert.deepEqual(source.parent.portfolio.positions, COMPONENT_IDS.map(id => ({ id, weight: .3 })));
  const v3Report = JSON.parse(fs.readFileSync(path.join(ROOT, protocol.sourceSnapshot.evidencePath)));
  assert.deepEqual(source.inputs.sourceSnapshot, v3Report.inputs.sourceSnapshot);
  assert.equal(sha256(JSON.stringify(source.inputs.sourceSnapshot)), protocol.sourceSnapshot.sourceSnapshotSha256);
  assert.equal(source.inputs.marketCalendarSha256, protocol.sourceSnapshot.marketCalendarSha256);
  assert.equal(source.inputs.actualCnyPriceRowsSha256, protocol.sourceSnapshot.actualCnyPriceRowsSha256);
  assert.equal(source.market.length, protocol.sourceSnapshot.commonObservations);
  return { protocol, parent: source.parent, market: source.market, v3Labels: v3Report.maturityQueue, inputs: {
    protocol: { path: path.relative(ROOT, protocolPath), sha256: sha256(text), id: protocol.id, frozenDate: protocol.frozenDate },
    frozenDependencies: protocol.frozenDependencies, sourceSnapshot: source.inputs.sourceSnapshot,
    marketCalendarSha256: source.inputs.marketCalendarSha256, actualCnyPriceRowsSha256: source.inputs.actualCnyPriceRowsSha256,
    researchEngine: { path: path.relative(ROOT, __filename), sha256: sha256(fs.readFileSync(__filename)) }, first: source.market[0].day, end: source.market.at(-1).day, commonObservations: source.market.length
  } };
}
function runResearch({ audit = false, protocolPath } = {}) {
  const { protocol, parent, market, v3Labels, inputs } = loadInputs(protocolPath), model = buildPredictions(market, parent.portfolio);
  const previousLabels = new Map(v3Labels.map(l => [l.entryDay, l])); let maximumCommonWaitLabelError = 0;
  for (const label of model.maturityQueue) {
    const previous = previousLabels.get(label.entryDay); assert.ok(previous && previous.exitDay === label.exitDay);
    const error = Math.abs(sum(COMPONENT_IDS.map(id => label.components[id].y)) - previous.y); maximumCommonWaitLabelError = Math.max(maximumCommonWaitLabelError, error);
    assert.ok(error < 1e-12, 'component-label sum must equal the frozen v3 common-wait label');
  }
  inputs.maturityQueueSha256 = sha256(JSON.stringify(model.maturityQueue)); inputs.predictionTraceSha256 = sha256(JSON.stringify(model.predictions));
  const result = evaluateResearch(market, model, parent, protocol, { audit });
  const report = { protocolId: protocol.id, generatedAt: new Date().toISOString(), inputs,
    method: { purpose: protocol.purpose, targetPreference: protocol.targetPreference, priorExposure: protocol.priorExposure, model: protocol.model,
      trainingPoolHash: 'initial SHA256(empty UTF8 string); on each sorted shared event hash(previous lowercase hex + newline + JSON.stringify(full event)); both fits share the same prefix',
      actionRepresentation: protocol.decisionTrace, units: protocol.model.labelUnits, maximumCommonWaitLabelError,
      auditTolerances: { commonWaitLabelFraction: 1e-12, primaryIdentityPp: 1e-8 }, precision: protocol.selectionAndConfirmation.precision },
    maturityQueue: model.maturityQueue, labelExclusions: model.labelExclusions, dailyPredictions: model.predictions,
    results: result.results, coverage: result.coverage, pairedBaseWindows: result.pairedBaseWindows, primaryPredictionDiagnostics: result.primaryPredictionDiagnostics,
    decision: confirm(result.results, protocol) };
  report.statisticsSha256 = sha256(JSON.stringify({ maturityQueue: report.maturityQueue, dailyPredictions: report.dailyPredictions, results: report.results,
    coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows, primaryPredictionDiagnostics: report.primaryPredictionDiagnostics, decision: report.decision }));
  return { report, audit: audit ? { protocolId: protocol.id, inputs, predictions: model.predictions, maturityQueue: model.maturityQueue, windows: result.auditWindows } : null };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
  const output = value('--output') || path.join(ROOT, 'docs/evidence/portfolio-entry-components-v4.json'), auditPath = value('--audit-output');
  const result = runResearch({ audit: Boolean(auditPath) }); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result.report, null, 2) + '\n');
  if (auditPath) { fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify(result.audit) + '\n'); }
  console.log(JSON.stringify({ output, auditPath, statisticsSha256: result.report.statisticsSha256, groups: result.report.results.length, baseWindows: result.report.pairedBaseWindows.length,
    decision: result.report.decision, primary: result.report.results.filter(r => r.calendarDay === 1 && r.evaluation === 'equal_age_lot' && r.horizonYears === 1 && r.scenario === 'base').map(r => ({ partition: r.partition, candidate: r.rules[0] })) }, null, 2));
}
module.exports = { MODEL_ID, COMPONENT_IDS, CATEGORIES, MIN_TRAINING, deriveAction, availablePrediction, buildComponentFeatures, buildLabelData, trainPredictions, buildPredictions,
  buildScopeEpisodes, simulateFundingPlan, decisionCoverage, primaryGates, confirm, forecastMetrics, primaryDiagnostics, evaluateResearch, loadInputs, runResearch };
