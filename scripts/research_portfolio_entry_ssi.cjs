#!/usr/bin/env node
'use strict';
// V5 frozen single monthly SSI candidate. No production dependency is modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R1 = require('./research_portfolio_entry.cjs');
const R2 = require('./research_portfolio_entry_predictive.cjs');
const V3 = require('./research_portfolio_entry_value.cjs');
const S = require('./research_portfolio_entry_scope.cjs');
const P = require('../assets/portfolio-model.js');
const ROOT = path.resolve(__dirname, '..'), MODEL_ID = 'expanding_monthly_ssi_ridge_year1_delay5', MIN_TRAINING = 36, YEAR = 365.2425;
const PROTOCOL_SHA = '943b6356c8826cb149d6d9aa9fcb9c18eac48730006257dac46565b54f7a64c9';
const SYMBOLS = ['SSO', 'QLD', 'DDM', 'SDS', 'QID', 'DXD'];
const DECISION_CLOCK = 'One hour before the scheduled US equity market close on the actual common funding session, including early-close sessions; declared convention, not an observed publication timestamp.';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sum = xs => xs.reduce((a, b) => a + b, 0);
const greater = value => Number.isFinite(value) && value > 1e-10;
const monthOffset = S.monthOffset;
const gap = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
function lowerBound(market, day) { let lo = 0, hi = market.length; while (lo < hi) { const m = (lo + hi) >> 1; if (market[m].day < day) lo = m + 1; else hi = m; } return lo; }
function parseCsv(text) {
  const table = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(x => x !== '')) table.push(row); row = []; value = ''; }
    else value += c;
  }
  assert.ok(!quoted, 'unterminated CSV quote');
  if (value || row.length) { row.push(value); table.push(row); }
  const fields = table.shift(); assert.ok(fields?.length); fields[0] = fields[0].replace(/^\uFEFF/, '');
  return table.map(values => { assert.equal(values.length, fields.length, 'CSV field count'); return Object.fromEntries(fields.map((field, i) => [field, values[i]])); });
}
function sourceDay(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text); assert.ok(match, 'invalid source date');
  const day = `${match[3]}-${match[1]}-${match[2]}`;
  assert.equal(new Date(day + 'T00:00:00Z').toISOString().slice(0, 10), day); return day;
}
function buildMonthlySsi(histories) {
  const endpoints = {}, months = new Set();
  for (const id of SYMBOLS) {
    assert.ok(Array.isArray(histories[id]), id + ': missing share history'); endpoints[id] = new Map(); const seen = new Set();
    for (const row of histories[id].slice().sort((a, b) => a.day.localeCompare(b.day))) {
      assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/); assert.ok(!seen.has(row.day), 'duplicate share date'); seen.add(row.day);
      const month = row.day.slice(0, 7); months.add(month); endpoints[id].set(month, row);
    }
  }
  return [...months].sort().map(month => {
    const previousMonth = S.monthOffset(month, -1), sixSourceMonthEndDates = {}, sixPriorMonthEndDates = {}, sourceSharesThousands = {}, priorSharesThousands = {}, growthFractionByFund = {};
    let missingReason = null;
    for (const id of SYMBOLS) {
      const a = endpoints[id].get(previousMonth), b = endpoints[id].get(month);
      sixSourceMonthEndDates[id] = b?.day ?? null; sixPriorMonthEndDates[id] = a?.day ?? null;
      sourceSharesThousands[id] = Number.isFinite(b?.shares) ? b.shares : null; priorSharesThousands[id] = Number.isFinite(a?.shares) ? a.shares : null;
      if (!a || !b) missingReason ??= 'missing_consecutive_month_endpoint:' + id;
      else if (![a.shares, b.shares].every(x => Number.isFinite(x) && x > 0)) missingReason ??= 'invalid_month_end_shares:' + id;
      growthFractionByFund[id] = a && b && [a.shares, b.shares].every(x => Number.isFinite(x) && x > 0) ? b.shares / a.shares - 1 : null;
    }
    if (!missingReason && (new Set(Object.values(sixSourceMonthEndDates)).size !== 1 || new Set(Object.values(sixPriorMonthEndDates)).size !== 1)) missingReason = 'asynchronous_six_fund_month_end_dates';
    let value = missingReason ? null : sum(SYMBOLS.map((id, i) => (i < 3 ? 1 : -1) * growthFractionByFund[id]));
    if (value !== null && !Number.isFinite(value)) { value = null; missingReason = 'nonfinite_raw_ssi'; }
    return { month, previousMonth, value, missingReason, sixSourceMonthEndDates, sixPriorMonthEndDates, sourceSharesThousands, priorSharesThousands, growthFractionByFund };
  });
}
function buildFeatureInputs(market, monthlySsi) {
  const lookup = new Map(monthlySsi.map(row => [row.month, row]));
  return market.map((row, t) => {
    const featureMonth = S.monthOffset(row.day.slice(0, 7), -1), source = lookup.get(featureMonth);
    const assumedFeatureAvailableIndex = lowerBound(market, S.monthOffset(featureMonth, 1) + '-01');
    const assumedFeatureAvailableSession = market[assumedFeatureAvailableIndex]?.day ?? null;
    const missingReason = source?.missingReason ?? (!source ? 'required_previous_month_ssi_absent' : null);
    const featureValue = Number.isFinite(source?.value) ? source.value : null;
    const inputAvailable = !missingReason && featureValue !== null && assumedFeatureAvailableIndex <= t;
    return { featureMonth, sixSourceMonthEndDates: source?.sixSourceMonthEndDates ?? Object.fromEntries(SYMBOLS.map(id => [id, null])),
      sixPriorMonthEndDates: source?.sixPriorMonthEndDates ?? Object.fromEntries(SYMBOLS.map(id => [id, null])),
      assumedFeatureAvailableSession, assumedFeatureAvailableIndex, featureValue, inputAvailable,
      missingReason: missingReason || (inputAvailable ? null : 'required_ssi_not_available_by_cutoff') };
  });
}
function annualValueLabel(market, s, portfolio, feeRate = .001) {
  const anniversary = P.addYears(market[s].day, 1), exitIndex = lowerBound(market, anniversary);
  if (exitIndex >= market.length) return { label: null, missing: 'year_terminal_not_observed' };
  const exitDay = market[exitIndex].day;
  if (gap(anniversary, exitDay) > 14) return { label: null, missing: 'year_terminal_more_than_14_days_late' };
  if (s + 5 > exitIndex) return { label: null, missing: 'five_session_purchase_after_terminal' };
  const y = (1 - feeRate) / (1 + feeRate) * sum(portfolio.positions.map((p, j) => p.weight * market[exitIndex].prices[j] * (1 / market[s + 5].prices[j] - 1 / market[s].prices[j])));
  if (!Number.isFinite(y)) return { label: null, missing: 'nonfinite_annual_label' };
  return { label: { entryIndex: s, entryDay: market[s].day, exitIndex, exitDay, anniversary, y }, missing: null };
}
function buildLabelData(market, featureInputs, portfolio) {
  const schedules = Object.fromEntries([1, 10, 20].map(d => [d, S.buildArrivalSchedule(market, d)]));
  const indices = [...new Set(Object.values(schedules).flat().filter(r => r.index !== null).map(r => r.index))].sort((a, b) => a - b);
  const evaluationLabels = market.map(() => null), evaluationExclusions = [], trainingExclusions = [], trainingLabels = [];
  for (const s of indices) { const result = annualValueLabel(market, s, portfolio); evaluationLabels[s] = result.label;
    if (!result.label) evaluationExclusions.push({ entryIndex: s, entryDay: market[s].day, missing: result.missing }); }
  for (const arrival of schedules[1]) {
    const s = arrival.index, input = s === null ? null : featureInputs[s];
    const reason = s === null ? arrival.missing : s === 0 ? 'no_previous_common_close' : !input?.inputAvailable ? input?.missingReason || 'training_ssi_unavailable' : !evaluationLabels[s] ? 'annual_price_outcome_unavailable' : null;
    if (reason) { trainingExclusions.push({ month: arrival.month, entryDay: arrival.day, missing: reason }); continue; }
    trainingLabels.push({ ...evaluationLabels[s], trainingMonth: arrival.month, featureMonth: input.featureMonth,
      sixSourceMonthEndDates: { ...input.sixSourceMonthEndDates }, sixPriorMonthEndDates: { ...input.sixPriorMonthEndDates },
      assumedFeatureAvailableSession: input.assumedFeatureAvailableSession, features: [input.featureValue] });
  }
  assert.equal(new Set(trainingLabels.map(l => l.trainingMonth)).size, trainingLabels.length, 'monthly training labels must be unique');
  return { trainingLabels, evaluationLabels, labelExclusions: { training: trainingExclusions, evaluation: evaluationExclusions } };
}
function validFit(fit) { return [fit.trainingMeanY, ...fit.featureMeans, ...fit.featureStd, ...fit.beta].every(Number.isFinite) && fit.featureStd.length === 1 && fit.featureStd[0] >= 0 && fit.beta.length === 1; }
function trainPredictions(market, featureInputs, trainingLabels) {
  assert.equal(new Set(trainingLabels.map(l => l.trainingMonth)).size, trainingLabels.length, 'duplicate training month');
  const maturityQueue = trainingLabels.slice().sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex);
  const state = R2.createMoments(1), predictions = []; let pointer = 0, poolHash = sha256(''), latestTrainingExit = null, latestTrainingEntry = null;
  for (let t = 0; t < market.length; t++) {
    let inserted = 0;
    while (pointer < maturityQueue.length && maturityQueue[pointer].exitIndex < t) {
      const label = maturityQueue[pointer++]; assert.ok(label.entryIndex < label.exitIndex && label.features.length === 1);
      R2.updateMoments(state, label.features, label.y); poolHash = sha256(poolHash + '\n' + JSON.stringify(label));
      latestTrainingExit = label.exitDay; latestTrainingEntry = label.entryDay; inserted++;
    }
    const input = featureInputs[t], header = { day: market[t].day, executionDay: market[t].day, decisionClockConvention: DECISION_CLOCK,
      priceLabelCutoffDay: market[t - 1]?.day ?? null, labelHoldingYears: 1, ...input,
      trainingN: state.n, trainingQueuePrefixLength: pointer, newlyMatureLabels: inserted, latestTrainingExit, latestTrainingEntry, trainingPoolSha256: poolHash };
    let fit = null, error = state.n < MIN_TRAINING ? 'fewer_than_36_mature_unique_monthly_labels' : null;
    if (!error) try { fit = R2.fitMoments(state, 1); assert.ok(validFit(fit), 'nonfinite_or_invalid_one_feature_fit'); } catch (e) { error = 'invalid_fit:' + e.message; }
    if (error) { predictions.push({ ...header, fitReady: false, actionAvailable: false, featureMean: null, featurePopulationSd: null, beta: null, trainingMeanY: null,
      predictedY: null, predictedFullDepositBps: null, offset: null, missingReason: error, fallbackReason: null }); continue; }
    const coefficients = { featureMean: fit.featureMeans[0], featurePopulationSd: fit.featureStd[0], beta: fit.beta[0], trainingMeanY: fit.trainingMeanY };
    if (!input.inputAvailable) { predictions.push({ ...header, ...coefficients, fitReady: true, actionAvailable: true,
      predictedY: null, predictedFullDepositBps: null, offset: 0, fallbackReason: input.missingReason, missingReason: input.missingReason }); continue; }
    const predictedY = R2.predictFit(fit, [input.featureValue]);
    if (!Number.isFinite(predictedY) || !Number.isFinite(10000 * predictedY)) { predictions.push({ ...header, ...coefficients, fitReady: false, actionAvailable: false,
      predictedY: null, predictedFullDepositBps: null, offset: null, fallbackReason: null, missingReason: 'invalid_fit:nonfinite_prediction' }); continue; }
    predictions.push({ ...header, ...coefficients, fitReady: true, actionAvailable: true, predictedY, predictedFullDepositBps: 10000 * predictedY,
      offset: R2.decisionOffset(predictedY), missingReason: null, fallbackReason: null });
  }
  return { maturityQueue, predictions };
}
function buildPredictions(market, portfolio, histories) {
  const monthlySsi = buildMonthlySsi(histories), featureInputs = buildFeatureInputs(market, monthlySsi), labels = buildLabelData(market, featureInputs, portfolio);
  return { monthlySsi, featureInputs, ...labels, ...trainPredictions(market, featureInputs, labels.trainingLabels) };
}
function availablePrediction(p) {
  if (p?.fitReady !== true || p.actionAvailable !== true || typeof p.inputAvailable !== 'boolean' || !Number.isInteger(p.trainingN) || p.trainingN < MIN_TRAINING || ![p.featureMean, p.featurePopulationSd, p.beta, p.trainingMeanY].every(Number.isFinite) || p.featurePopulationSd < 0) return false;
  if (p.inputAvailable) return Number.isFinite(p.featureValue) && Number.isFinite(p.predictedY) && Number.isFinite(p.predictedFullDepositBps) && p.predictedFullDepositBps === 10000 * p.predictedY && p.offset === R2.decisionOffset(p.predictedY) && !p.fallbackReason;
  return p.predictedY === null && p.predictedFullDepositBps === null && p.offset === 0 && typeof p.fallbackReason === 'string' && p.fallbackReason.length > 0;
}
function publicationSensitivity(market, predictions) {
  return predictions.map((p, t) => {
    const availableIndex = p.assumedFeatureAvailableIndex + 1, inputAvailable = p.inputAvailable && t >= availableIndex;
    const inputDelayedByDiagnostic = p.fitReady && p.inputAvailable && !inputAvailable;
    const extra = { baseOffset: p.offset, baseAssumedFeatureAvailableSession: p.assumedFeatureAvailableSession,
      assumedFeatureAvailableIndex: availableIndex, assumedFeatureAvailableSession: market[availableIndex]?.day ?? null,
      inputAvailable, inputDelayedByDiagnostic, cancelledBaseDelay: inputDelayedByDiagnostic && p.offset === 5,
      sensitivity: 'ssi_publication_plus_one_common_session' };
    return !inputDelayedByDiagnostic ? { ...p, ...extra } : { ...p, ...extra, inputAvailable: false, predictedY: null, predictedFullDepositBps: null,
      offset: 0, missingReason: 'ssi_publication_plus_one_common_session', fallbackReason: 'ssi_publication_plus_one_common_session' };
  });
}
const PROVENANCE_FIELDS = ['fitReady', 'inputAvailable', 'actionAvailable', 'decisionClockConvention', 'priceLabelCutoffDay', 'featureMonth', 'sixSourceMonthEndDates', 'sixPriorMonthEndDates',
  'assumedFeatureAvailableSession', 'featureValue', 'trainingN', 'latestTrainingEntry', 'latestTrainingExit', 'trainingPoolSha256', 'predictedY', 'predictedFullDepositBps', 'labelHoldingYears',
  'missingReason', 'fallbackReason', 'baseOffset', 'inputDelayedByDiagnostic', 'cancelledBaseDelay', 'sensitivity'];
function provenance(p) { return Object.fromEntries(PROVENANCE_FIELDS.filter(k => p[k] !== undefined).map(k => [k, p[k]])); }

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
      if (rule.id === MODEL_ID) {
        assert.ok(availablePrediction(prediction)); assert.equal(prediction.labelHoldingYears, 1, 'annual-label provenance required'); assert.equal(prediction.day, row.day);
        assert.equal(prediction.priceLabelCutoffDay, market[i - 1]?.day, 'arrival uses its own strictly prior close');
        assert.ok(prediction.latestTrainingExit <= prediction.priceLabelCutoffDay, 'unmatured training label');
        if (prediction.inputAvailable) assert.equal(prediction.offset, R2.decisionOffset(prediction.predictedY), 'frozen prediction action mismatch');
        else { assert.equal(prediction.predictedY, null); assert.equal(prediction.offset, 0); assert.ok(prediction.fallbackReason); }
      }
      const offsets = rule.id === MODEL_ID ? [prediction.offset] : rule.offsets, part = arrival.amount * risk / offsets.length;
      for (const offset of offsets) lots.push({ depositIndex, units: portfolio.positions.map(() => 0), buyFees: 0, arrivalDay: arrival.day, arrivalIndex: i, original: part, cash: part, offset, executionIndex: i + offset, boughtIndex: null,
        ...(rule.id === MODEL_ID ? provenance(prediction) : {}) });
    }
    for (const lot of lots) {
      if (lot.boughtIndex !== null || i !== lot.executionIndex) continue;
      const usable = lot.cash / (1 + scenario.feeRate);
      for (let j = 0; j < units.length; j++) {
        const notional = usable * portfolio.positions[j].weight / risk, fee = notional * scenario.feeRate, boughtUnits = notional / row.prices[j];
        units[j] += boughtUnits; lot.units[j] += boughtUnits; lot.buyFees += fee; fees += fee;
        if (audit) trades.push({ day: row.day, side: 'buy', id: portfolio.positions[j].id, units: boughtUnits, price: row.prices[j], notional, fee,
          arrivalDay: lot.arrivalDay, decisionDay: lot.arrivalDay, priceLabelCutoffDay: lot.priceLabelCutoffDay ?? null,
          predictedY: lot.predictedY ?? null, trainingN: lot.trainingN ?? null, latestTrainingExit: lot.latestTrainingExit ?? null, labelHoldingYears: lot.labelHoldingYears ?? null, trainingPoolSha256: lot.trainingPoolSha256 ?? null,
          ...provenance(lot), offset: lot.offset, waitSessions: i - lot.arrivalIndex, reason: rule.id === MODEL_ID ? (lot.fallbackReason ? 'monthly_ssi_immediate_fallback' : 'locked_monthly_ssi_annual_value_prediction') : 'fixed_tranche' });
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


const primaryGates = V3.primaryGates, economicChecks = V3.economicChecks, pairNonnegative = V3.pairNonnegative;
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

function decisionCoverage(episodes, predictions) {
  const decisions = new Map();
  for (const ep of episodes) for (const a of ep.fundingPlan) {
    if (decisions.has(a.day)) { decisions.get(a.day).occurrencesInAccounts++; continue; }
    const p = predictions[a.index]; decisions.set(a.day, { day: a.day, ...provenance(p), offset: p.offset, occurrencesInAccounts: 1 });
  }
  const dates = [...decisions.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { uniqueArrivalDecisions: dates.length, delayedUniqueDecisions: dates.filter(d => d.offset === 5).length,
    fallbackUniqueDecisions: dates.filter(d => d.fallbackReason).length,
    inputDelayedByDiagnosticUniqueDecisions: dates.filter(d => d.inputDelayedByDiagnostic).length,
    cancelledBaseDelayUniqueDecisions: dates.filter(d => d.cancelledBaseDelay).length, dates };
}
function primaryDiagnostics(rows) {
  const predicted = rows.filter(r => r.inputAvailable && Number.isFinite(r.predictedY));
  return { ...V3.primaryDiagnostics(predicted), eligiblePrimaryMonths: rows.length, availableForecastMonths: predicted.length,
    fallbackMonths: rows.filter(r => r.fallbackReason).length, fallbackDates: rows.filter(r => r.fallbackReason).map(r => ({ day: r.day, fallbackReason: r.fallbackReason, deltaPp: r.deltaPp })),
    identityMaximumErrorPpAllEligible: rows.length ? Math.max(...rows.map(r => Math.abs(r.deltaPp - (r.offset === 5 ? 100 * r.actualY : 0)))) : null };
}
function evaluateResearch(market, model, parent, protocol, { audit = false } = {}) {
  const predictions = model.predictions, sensitivityPredictions = publicationSensitivity(market, predictions), rules = [{ id: MODEL_ID }, ...protocol.benchmarks];
  const results = [], sensitivityResults = [], coverage = [], pairedBaseWindows = [], sensitivityPairedBaseWindows = [], auditWindows = [], sensitivityAuditWindows = [], primaryPredictionDiagnostics = [];
  for (const calendarDay of protocol.evaluation.allCalendars) {
    const schedule = S.buildArrivalSchedule(market, calendarDay);
    for (const evaluation of protocol.evaluation.allScopes) for (const years of protocol.evaluation.allHoldingYears) {
      const scope = buildScopeEpisodes(market, schedule, predictions, parent.episodes.partitions, evaluation, years, 100);
      coverage.push({ calendarDay, evaluation, years, excluded: scope.excluded, rejected: scope.rejected, attemptedStartMonths: scope.attemptedStartMonths,
        eligibleEpisodeCount: scope.episodes.length, exclusionUnits: scope.exclusionUnits, scheduledMonths: schedule });
      for (const scenario of parent.scenarios) for (const partition of parent.episodes.partitions) {
        const episodes = scope.episodes.filter(e => e.partition === partition.id), primary = calendarDay === 1 && evaluation === 'equal_age_lot' && years === 1 && scenario.id === 'base';
        for (const sensitivity of [false, true]) {
          const stream = sensitivity ? sensitivityPredictions : predictions;
          const accounts = new Map(rules.map(rule => [rule.id, episodes.map(ep => simulateFundingPlan(market, ep, rule, scenario, parent.portfolio, stream, audit && scenario.id === 'base' ? { curve: false } : false))]));
          const rows = episodes.map((ep, i) => {
            const p = stream[ep.startIndex], label = model.evaluationLabels[ep.startIndex];
            const deltaPp = 100 * (accounts.get(MODEL_ID)[i].terminalWealth - accounts.get('immediate')[i].terminalWealth) / ep.contributed;
            if (evaluation === 'equal_age_lot' && years === 1 && scenario.id === 'base') {
              assert.ok(label && label.exitDay === ep.end, 'price-only evaluation label endpoint mismatch');
              assert.ok(Math.abs(deltaPp - (p.offset === 5 ? 100 * label.y : 0)) < 1e-8, 'annual label/action/account identity');
              const fixedDelta = 100 * (accounts.get('fixed_delay5')[i].terminalWealth - accounts.get('immediate')[i].terminalWealth) / ep.contributed;
              assert.ok(Math.abs(fixedDelta - 100 * label.y) < 1e-8, 'fixed-delay annual identity');
            }
            if (sensitivity && calendarDay === 1) assert.ok(Math.abs(deltaPp) < 1e-8, 'month-first publication sensitivity is zero by construction');
            return { day: ep.start, end: ep.end, deltaPp, offset: p.offset, ...provenance(p), referenceForecast: p.trainingMeanY, actualY: label?.y ?? null };
          });
          const ruleResults = rules.map(rule => ({ id: rule.id, summary: R1.summarizeAccounts(accounts.get(rule.id)),
            vsImmediate: V3.pairedSummary(accounts.get(rule.id), accounts.get('immediate'), evaluation, years),
            vsFixedDelay5: V3.pairedSummary(accounts.get(rule.id), accounts.get('fixed_delay5'), evaluation, years),
            vsThreeTranches: V3.pairedSummary(accounts.get(rule.id), accounts.get('three_tranches'), evaluation, years) }));
          if (primary && !sensitivity) { ruleResults[0].primaryEvidence = primaryGates(ruleResults[0].vsImmediate, rows, protocol.selectionAndConfirmation); primaryPredictionDiagnostics.push({ partition: partition.id, ...primaryDiagnostics(rows) }); }
          const group = { calendarDay, primaryCalendar: calendarDay === 1, evaluation, horizonYears: years, scenario: scenario.id, partition: partition.id,
            ...(sensitivity ? { sensitivity: 'ssi_publication_plus_one_common_session', qualification: 'identical_base_qualified_accounts', noConfirmationGate: true } : {}),
            startRange: episodes.length ? { first: episodes[0].start, last: episodes.at(-1).start } : null, decisionCoverage: decisionCoverage(episodes, stream), rules: ruleResults };
          (sensitivity ? sensitivityResults : results).push(group);
          if (scenario.id === 'base') episodes.forEach((ep, i) => {
            const window = { calendarDay, evaluation, years, start: ep.start, end: ep.end, lastFundingDay: ep.lastFundingDay, anniversary: ep.anniversary,
              partition: ep.partition, scenario: 'base', fundingPlan: ep.fundingPlan, ...(sensitivity ? { sensitivity: 'ssi_publication_plus_one_common_session' } : {}) };
            (sensitivity ? sensitivityPairedBaseWindows : pairedBaseWindows).push({ ...window, contributed: ep.contributed, rules: Object.fromEntries(rules.map(rule => {
              const account = accounts.get(rule.id)[i], { trades, contributionAttribution, externalFlows, ...scalar } = account;
              return [rule.id, { ...scalar, deltaVsImmediatePp: 100 * (account.terminalWealth - accounts.get('immediate')[i].terminalWealth) / account.contributed }];
            })) });
            if (audit) (sensitivity ? sensitivityAuditWindows : auditWindows).push({ ...window, rules: Object.fromEntries(rules.map(rule => [rule.id, accounts.get(rule.id)[i]])) });
          });
        }
      }
    }
  }
  return { results, coverage, pairedBaseWindows, primaryPredictionDiagnostics, auditWindows,
    publicationSensitivity: { id: 'ssi_publication_plus_one_common_session', type: 'availability_cancellation_sensitivity_only',
      sameBaseQualifiedAccounts: true, primaryZeroByConstruction: true, predictions: sensitivityPredictions, results: sensitivityResults,
      pairedBaseWindows: sensitivityPairedBaseWindows, coverageReference: 'coverage' }, sensitivityAuditWindows };
}
function verifyDependencies(dependencies, seen = new Set()) {
  for (const d of dependencies) {
    const file = path.join(ROOT, d.path), raw = fs.readFileSync(file); assert.equal(sha256(raw), d.sha256, d.path + ': frozen dependency changed');
    if (seen.has(d.path)) continue; seen.add(d.path);
    if (d.path.startsWith('docs/research/') && d.path.endsWith('.json')) verifyDependencies(JSON.parse(raw).frozenDependencies || [], seen);
  }
}
function loadInputs(protocolPath = path.join(ROOT, 'docs/research/portfolio-entry-ssi-protocol-v5.json')) {
  const raw = fs.readFileSync(protocolPath), protocol = JSON.parse(raw); assert.equal(sha256(raw), PROTOCOL_SHA, 'v5 protocol fingerprint');
  assert.equal(protocol.status, 'frozen_before_any_v5_labels_predictions_or_outcomes'); assert.equal(protocol.model.id, MODEL_ID);
  assert.equal(protocol.model.minimumMatureLabels, 36); assert.equal(protocol.model.ridgeLambda, 1); assert.equal(protocol.model.features.length, 1);
  verifyDependencies(protocol.frozenDependencies);
  const source = V3.loadInputs(), parent = source.parent, market = source.market;
  assert.deepEqual(parent.portfolio.positions, [{ id: 'us:USD', weight: .3 }, { id: 'us:TQQQ', weight: .3 }]); assert.equal(parent.portfolio.strategicCashWeight, .4);
  assert.equal(sha256(JSON.stringify(source.inputs.sourceSnapshot)), protocol.sourceSnapshot.sourceSnapshotSha256);
  assert.equal(source.inputs.marketCalendarSha256, protocol.sourceSnapshot.marketCalendarSha256); assert.equal(source.inputs.actualCnyPriceRowsSha256, protocol.sourceSnapshot.actualCnyPriceRowsSha256);
  assert.equal(market.length, protocol.sourceSnapshot.commonObservations); assert.equal(market[0].day, protocol.sourceSnapshot.first); assert.equal(market.at(-1).day, protocol.sourceSnapshot.end);
  const histories = {}, shareSources = protocol.ssiSource.historyFiles.map(info => {
    const text = fs.readFileSync(info.localPath); assert.equal(sha256(text), info.sha256, info.id + ': share source hash mismatch');
    const rows = parseCsv(text.toString('utf8')); assert.equal(rows.length, info.rows); assert.ok(rows.every(r => r.Ticker === info.id));
    histories[info.id] = rows.map(r => ({ day: sourceDay(r.Date), shares: r['Shares Outstanding (000)'].trim() === '' ? null : Number(r['Shares Outstanding (000)']) })).sort((a, b) => a.day.localeCompare(b.day));
    assert.equal(histories[info.id][0].day, info.first); assert.equal(histories[info.id].at(-1).day, info.last);
    return { ...info, bytes: text.length };
  });
  assert.deepEqual(Object.keys(histories).sort(), SYMBOLS.slice().sort());
  return { protocol, parent, market, histories, inputs: { protocol: { path: path.relative(ROOT, protocolPath), sha256: sha256(raw), id: protocol.id, frozenDate: protocol.frozenDate },
    frozenDependencies: protocol.frozenDependencies, sourceSnapshot: source.inputs.sourceSnapshot, shareSources,
    marketCalendarSha256: source.inputs.marketCalendarSha256, actualCnyPriceRowsSha256: source.inputs.actualCnyPriceRowsSha256,
    researchEngine: { path: path.relative(ROOT, __filename), sha256: sha256(fs.readFileSync(__filename)) },
    implementationDependencies: ['scripts/research_portfolio_entry_predictive.cjs', 'scripts/research_portfolio_entry_value.cjs', 'scripts/research_portfolio_entry_scope.cjs', 'scripts/research_portfolio_entry.cjs', 'assets/portfolio-model.js', 'assets/model.js'].map(p => ({ path: p, sha256: sha256(fs.readFileSync(path.join(ROOT, p))) })),
    first: market[0].day, end: market.at(-1).day, commonObservations: market.length } };
}
function runResearch({ audit = false, protocolPath } = {}) {
  const { protocol, parent, market, histories, inputs } = loadInputs(protocolPath), model = buildPredictions(market, parent.portfolio, histories);
  inputs.monthlySsiSha256 = sha256(JSON.stringify(model.monthlySsi)); inputs.trainingLabelsSha256 = sha256(JSON.stringify(model.trainingLabels));
  inputs.maturityQueueSha256 = sha256(JSON.stringify(model.maturityQueue)); inputs.evaluationLabelsSha256 = sha256(JSON.stringify(model.evaluationLabels)); inputs.predictionTraceSha256 = sha256(JSON.stringify(model.predictions));
  const result = evaluateResearch(market, model, parent, protocol, { audit }), decision = confirm(result.results, protocol);
  decision.pendingIntegrationRequirements.push('input_provenance_and_actual_next_session_arrival_validation');
  const report = { protocolId: protocol.id, generatedAt: new Date().toISOString(), inputs,
    method: { purpose: protocol.purpose, priorExposure: protocol.priorExposure, targetPreference: protocol.targetPreference, model: protocol.model, availability: protocol.availability,
      units: protocol.model.labelUnits, trainingPoolHash: 'SHA256(empty UTF8); then SHA256(previous lowercase hex + newline + JSON.stringify(full label)), sorted by exitIndex then entryIndex',
      evaluationLabels: 'price-only labels on unique union of nominal1/10/20 arrivals; indexed by market date; never inserted into the training pool',
      primaryIdentityTolerancePp: 1e-8, precision: protocol.selectionAndConfirmation.precision, initialRunPolicy: 'Any implementation repair after first real outcomes must be documented; no parameter or gate changes.' },
    monthlySsi: model.monthlySsi, trainingLabels: model.trainingLabels, maturityQueue: model.maturityQueue, evaluationLabels: model.evaluationLabels,
    labelExclusions: model.labelExclusions, dailyPredictions: model.predictions, results: result.results, coverage: result.coverage, pairedBaseWindows: result.pairedBaseWindows,
    primaryPredictionDiagnostics: result.primaryPredictionDiagnostics, publicationSensitivity: result.publicationSensitivity, decision };
  report.statisticsSha256 = sha256(JSON.stringify({ monthlySsi: report.monthlySsi, trainingLabels: report.trainingLabels, maturityQueue: report.maturityQueue, evaluationLabels: report.evaluationLabels,
    dailyPredictions: report.dailyPredictions, results: report.results, coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows,
    primaryPredictionDiagnostics: report.primaryPredictionDiagnostics, publicationSensitivity: report.publicationSensitivity, decision: report.decision }));
  return { report, audit: audit ? { protocolId: protocol.id, inputs, predictions: model.predictions, monthlySsi: model.monthlySsi,
    trainingLabels: model.trainingLabels, maturityQueue: model.maturityQueue, evaluationLabels: model.evaluationLabels, windows: result.auditWindows,
    publicationSensitivity: { predictions: result.publicationSensitivity.predictions, windows: result.sensitivityAuditWindows } } : null };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
  const output = value('--output') || path.join(ROOT, 'docs/evidence/portfolio-entry-ssi-v5.json'), auditPath = value('--audit-output');
  const result = runResearch({ audit: Boolean(auditPath) }); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result.report, null, 2) + '\n');
  if (auditPath) { fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify(result.audit) + '\n'); }
  console.log(JSON.stringify({ output, auditPath, statisticsSha256: result.report.statisticsSha256, engineSha256: result.report.inputs.researchEngine.sha256,
    groups: result.report.results.length, sensitivityGroups: result.report.publicationSensitivity.results.length, baseWindows: result.report.pairedBaseWindows.length,
    decision: result.report.decision, primary: result.report.results.filter(r => r.calendarDay === 1 && r.evaluation === 'equal_age_lot' && r.horizonYears === 1 && r.scenario === 'base').map(r => ({ partition: r.partition, candidate: r.rules[0] })) }));
}
module.exports = { MODEL_ID, MIN_TRAINING, SYMBOLS, parseCsv, sourceDay, buildMonthlySsi, buildFeatureInputs, annualValueLabel, buildLabelData, trainPredictions,
  buildPredictions, availablePrediction, publicationSensitivity, buildScopeEpisodes, simulateFundingPlan, decisionCoverage, primaryDiagnostics, confirm, evaluateResearch, loadInputs, runResearch };
