#!/usr/bin/env node
'use strict';
// Scope audit only. Replay the previously frozen v2 prediction trace unchanged.
// No candidate search, refit, winner selection or production integration gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const R1 = require('./research_portfolio_entry.cjs');
const R2 = require('./research_portfolio_entry_predictive.cjs');
const P = require('../assets/portfolio-model.js');
const YEAR = 365.2425, DAY = 86400000;
const sum = xs => xs.reduce((a, b) => a + b, 0);
const gap = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY;
const monthOffset = (month, n) => {
  const date = new Date(month + '-01T00:00:00Z'); date.setUTCMonth(date.getUTCMonth() + n); return date.toISOString().slice(0, 7);
};
function lowerBound(market, day) {
  let low = 0, high = market.length;
  while (low < high) { const mid = (low + high) >> 1; if (market[mid].day < day) low = mid + 1; else high = mid; }
  return low;
}
function buildArrivalSchedule(market, calendarDay) {
  assert.ok([1, 10, 20].includes(calendarDay)); assert.ok(market.length);
  const firstMonth = market[0].day.slice(0, 7), lastMonth = market.at(-1).day.slice(0, 7), schedule = [];
  for (let month = firstMonth; month <= lastMonth; month = monthOffset(month, 1)) {
    const requestedDay = month + '-' + String(calendarDay).padStart(2, '0'), index = lowerBound(market, requestedDay);
    const available = index < market.length && market[index].day.slice(0, 7) === month;
    schedule.push({ month, requestedDay, day: available ? market[index].day : null, index: available ? index : null,
      missing: available ? null : requestedDay > market.at(-1).day ? 'requested_date_after_data_end' : 'no_common_close_remaining_in_month' });
  }
  return schedule;
}
function availablePrediction(prediction) {
  return Number.isFinite(prediction?.predictedY) && prediction.trainingN >= R2.MIN_TRAINING && [0, 5].includes(prediction.offset);
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
    assert.ok(arrivals.every((a, i) => a.month === monthOffset(first.month, i)), 'deposits must be consecutive calendar months');
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
      if (rule.id === R2.MODEL_ID) {
        assert.ok(availablePrediction(prediction)); assert.equal(prediction.day, row.day);
        assert.equal(prediction.featureDay, market[i - 1]?.day, 'arrival uses its own strictly prior close');
        assert.ok(prediction.latestTrainingExit <= prediction.featureDay, 'unmatured training label');
        assert.equal(prediction.offset, R2.decisionOffset(prediction.predictedY), 'frozen prediction action mismatch');
      }
      const offsets = R2.offsetsFor(rule, prediction), part = arrival.amount * risk / offsets.length;
      for (const offset of offsets) lots.push({ depositIndex, units: portfolio.positions.map(() => 0), buyFees: 0, arrivalDay: arrival.day, arrivalIndex: i, original: part, cash: part, offset, executionIndex: i + offset, boughtIndex: null,
        ...(rule.id === R2.MODEL_ID ? { featureDay: prediction.featureDay, predictedY: prediction.predictedY, trainingN: prediction.trainingN, latestTrainingExit: prediction.latestTrainingExit } : {}) });
    }
    for (const lot of lots) {
      if (lot.boughtIndex !== null || i !== lot.executionIndex) continue;
      const usable = lot.cash / (1 + scenario.feeRate);
      for (let j = 0; j < units.length; j++) {
        const notional = usable * portfolio.positions[j].weight / risk, fee = notional * scenario.feeRate, boughtUnits = notional / row.prices[j];
        units[j] += boughtUnits; lot.units[j] += boughtUnits; lot.buyFees += fee; fees += fee;
        if (audit) trades.push({ day: row.day, side: 'buy', id: portfolio.positions[j].id, units: boughtUnits, price: row.prices[j], notional, fee,
          arrivalDay: lot.arrivalDay, decisionDay: lot.arrivalDay, featureDay: lot.featureDay ?? null, signalDay: lot.featureDay ?? null,
          predictedY: lot.predictedY ?? null, trainingN: lot.trainingN ?? null, latestTrainingExit: lot.latestTrainingExit ?? null,
          offset: lot.offset, waitSessions: i - lot.arrivalIndex, reason: rule.id === R2.MODEL_ID ? 'frozen_v2_arrival_prediction' : 'fixed_tranche' });
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
  const result = R1.pairedSummary(candidate, benchmark, false), blockLength = (evaluation === 'equal_age_lot' ? 0 : 12) + 12 * years;
  const values = candidate.map((row, i) => 100 * (row.terminalWealth - benchmark[i].terminalWealth) / row.contributed);
  return { ...result, meanInterval: R1.bootstrapMean(values, blockLength, 2000, 0x6d2b79f5) };
}
function decisionCoverage(episodes, predictions) {
  const decisions = new Map();
  for (const ep of episodes) for (const arrival of ep.fundingPlan) {
    if (decisions.has(arrival.day)) { decisions.get(arrival.day).occurrencesInAccounts++; continue; }
    const p = predictions[arrival.index];
    decisions.set(arrival.day, { day: arrival.day, featureDay: p.featureDay, trainingN: p.trainingN, latestTrainingExit: p.latestTrainingExit,
      predictedY: p.predictedY, offset: p.offset, occurrencesInAccounts: 1 });
  }
  const dates = [...decisions.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { uniqueArrivalDecisions: dates.length, delayedUniqueDecisions: dates.filter(d => d.offset === 5).length, dates };
}
function evaluateScope(market, predictions, parent, rules, { audit = false, protocol = null } = {}) {
  assert.equal(market.length, predictions.length); market.forEach((r, i) => assert.equal(r.day, predictions[i].day));
  const results = [], coverage = [], pairedBaseWindows = [], auditWindows = [];
  const partitions = protocol?.endpoints.partitions || parent.episodes.partitions;
  const calendarDays = protocol?.funding.calendarDays || [1, 10, 20], amount = protocol?.funding.amountPerDeposit ?? 100;
  const evaluations = protocol?.evaluations || [{ id: 'equal_age_lot', holdingYears: [1, 3] }, { id: 'twelve_deposit_account', holdingYears: [1, 3] }];
  for (const calendarDay of calendarDays) {
    const schedule = buildArrivalSchedule(market, calendarDay);
    for (const evaluationConfig of evaluations) for (const years of evaluationConfig.holdingYears) {
      const evaluation = evaluationConfig.id, scope = buildScopeEpisodes(market, schedule, predictions, partitions, evaluation, years, amount);
      coverage.push({ calendarDay, evaluation, years, excluded: scope.excluded, rejected: scope.rejected, attemptedStartMonths: scope.attemptedStartMonths,
        eligibleEpisodeCount: scope.episodes.length, exclusionUnits: scope.exclusionUnits, scheduledMonths: schedule });
      for (const scenario of parent.scenarios) for (const partition of partitions) {
        const episodes = scope.episodes.filter(e => e.partition === partition.id);
        const accounts = new Map(rules.map(rule => [rule.id, episodes.map(ep => simulateFundingPlan(market, ep, rule, scenario, parent.portfolio, predictions, audit && scenario.id === 'base' ? { curve: false } : false))]));
        results.push({ calendarDay, primaryCalendar: calendarDay === 1, evaluation, horizonYears: years, scenario: scenario.id, partition: partition.id,
          startRange: episodes.length ? { first: episodes[0].start, last: episodes.at(-1).start } : null, decisionCoverage: decisionCoverage(episodes, predictions),
          rules: rules.map(rule => ({ id: rule.id, summary: R1.summarizeAccounts(accounts.get(rule.id)),
            vsImmediate: pairedSummary(accounts.get(rule.id), accounts.get('immediate'), evaluation, years),
            vsFixedDelay5: pairedSummary(accounts.get(rule.id), accounts.get('fixed_delay5'), evaluation, years),
            vsThreeTranches: pairedSummary(accounts.get(rule.id), accounts.get('three_tranches'), evaluation, years) })) });
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
  return { results, coverage, pairedBaseWindows, auditWindows };
}
function loadInputs(protocolPath = path.join(ROOT, 'docs/research/portfolio-entry-scope-audit-protocol-v1.json')) {
  const protocolText = fs.readFileSync(protocolPath), protocol = JSON.parse(protocolText);
  assert.equal(protocol.id, 'monthly-entry-evaluation-scope-audit-v1'); assert.equal(protocol.strategy.id, R2.MODEL_ID);
  assert.deepEqual(protocol.funding.calendarDays, [1, 10, 20]); assert.equal(protocol.funding.amountPerDeposit, 100);
  assert.deepEqual(protocol.evaluations.map(e => [e.id, e.deposits, e.holdingYears]), [['equal_age_lot', 1, [1, 3]], ['twelve_deposit_account', 12, [1, 3]]]);
  for (const dependency of protocol.frozenDependencies) assert.equal(sha256(fs.readFileSync(path.join(ROOT, dependency.path))), dependency.sha256, dependency.path + ': frozen dependency mismatch');
  const v2EvidenceDependency = protocol.frozenDependencies.find(d => d.path === 'docs/evidence/portfolio-entry-predictive-v2.json');
  assert.ok(v2EvidenceDependency); const v2Report = JSON.parse(fs.readFileSync(path.join(ROOT, v2EvidenceDependency.path)));
  const source = R2.loadInputs(); assert.deepEqual(source.inputs, v2Report.inputs, 'market sources and code dependencies must match the original v2 evidence');
  const predictions = v2Report.dailyPredictions;
  assert.equal(predictions.length, source.market.length);
  source.market.forEach((row, i) => {
    const p = predictions[i]; assert.equal(p.day, row.day); assert.equal(p.featureDay, i ? source.market[i - 1].day : null);
    if (p.predictedY !== null) { assert.ok(availablePrediction(p)); assert.equal(p.offset, R2.decisionOffset(p.predictedY)); assert.ok(p.latestTrainingExit <= p.featureDay); }
  });
  return { protocol, parent: source.parent, market: source.market, predictions, inputs: {
    protocol: { path: path.relative(ROOT, protocolPath), sha256: sha256(protocolText), id: protocol.id, frozenDate: protocol.frozenDate },
    frozenDependencies: protocol.frozenDependencies, v2Inputs: source.inputs,
    researchEngine: { path: path.relative(ROOT, __filename), sha256: sha256(fs.readFileSync(__filename)) },
    predictionTraceSha256: sha256(JSON.stringify(predictions)), marketCalendarSha256: sha256(JSON.stringify(source.market.map(r => r.day))),
    actualCnyPriceRowsSha256: sha256(JSON.stringify(source.market.map(r => ({ day: r.day, prices: r.prices })))),
    first: source.market[0].day, end: source.market.at(-1).day, commonObservations: source.market.length
  } };
}
function runResearch({ audit = false, protocolPath } = {}) {
  const { protocol, parent, market, predictions, inputs } = loadInputs(protocolPath), rules = [{ id: protocol.strategy.id }, ...protocol.strategy.benchmarks];
  const result = evaluateScope(market, predictions, parent, rules, { audit, protocol });
  const report = { protocolId: protocol.id, generatedAt: new Date().toISOString(), inputs,
    method: { purpose: protocol.purpose, priorExposure: protocol.priorExposure, predictionMode: 'replay_hash_bound_v2_dailyPredictions_no_refitting',
      accounting: 'unchanged_v1_40_per_100_strategic_cash_remaining_60_funds_actual_product_units_and_buy_fees_pre_personal_tax',
      evaluationInterpretation: protocol.evaluations, calendar: protocol.funding.arrival, terminal: protocol.endpoints.terminal,
      exclusions: 'mutually_exclusive_in_order_missing_start_prediction_warmup_partition_missing_funding_prediction_missing_terminal_excess_delay_crossing_partition',
      uncertainty: protocol.reporting.uncertainty, riskScope: protocol.accounting.riskScope },
    results: result.results, coverage: result.coverage, pairedBaseWindows: result.pairedBaseWindows,
    decision: { status: 'scope_audit_only_no_selection_or_integration', selection: null, integrationEligible: false, priorV2FailureUnchanged: true, meaning: protocol.decision.meaning } };
  report.statisticsSha256 = sha256(JSON.stringify({ results: report.results, coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows, decision: report.decision }));
  return { report, audit: audit ? { protocolId: protocol.id, inputs, predictions, windows: result.auditWindows } : null };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = key => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : null; };
  const output = value('--output') || path.join(ROOT, 'docs/evidence/portfolio-entry-scope-v1.json'), auditPath = value('--audit-output');
  const result = runResearch({ audit: Boolean(auditPath) });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result.report, null, 2) + '\n');
  if (auditPath) { fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify(result.audit) + '\n'); }
  console.log(JSON.stringify({ output, auditPath, statisticsSha256: result.report.statisticsSha256, groups: result.report.results.length,
    baseWindows: result.report.pairedBaseWindows.length, primaryBase: result.report.results.filter(r => r.calendarDay === 1 && r.scenario === 'base').map(r => ({ evaluation: r.evaluation, years: r.horizonYears, partition: r.partition, candidate: r.rules[0].vsImmediate })) }, null, 2));
}
module.exports = { buildArrivalSchedule, availablePrediction, buildScopeEpisodes, simulateFundingPlan, evaluateScope, pairedSummary, decisionCoverage, monthOffset, loadInputs, runResearch };
