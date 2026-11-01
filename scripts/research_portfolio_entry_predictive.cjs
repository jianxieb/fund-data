#!/usr/bin/env node
'use strict';
// Frozen v2: one expanding ridge model, strictly mature labels, per-arrival decisions.
// v1 helpers are read-only: source integrity, episode calendar, summary definitions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const R = require('./research_portfolio_entry.cjs');
const ROOT = path.resolve(__dirname, '..'), MIN_TRAINING = 756, DELAY = 5, THRESHOLD = 1e-12, YEAR = 365.2425;
const MODEL_ID = 'expanding_ridge_delay5';
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mean = xs => xs.length ? sum(xs) / xs.length : null;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const gap = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
const finiteFeatures = xs => Array.isArray(xs) && xs.length === 5 && xs.every(Number.isFinite);
function loadInputs(protocolPath = path.join(ROOT, 'docs/research/portfolio-entry-protocol-v2.json')) {
  const text = fs.readFileSync(protocolPath), protocol = JSON.parse(text);
  assert.equal(protocol.id, 'equal-budget-predictive-delay-v2');
  assert.equal(protocol.model.id, MODEL_ID); assert.equal(protocol.model.ridgeLambda, 1);
  const parentPath = path.join(ROOT, protocol.parentProtocol.path);
  assert.equal(sha256(fs.readFileSync(parentPath)), protocol.parentProtocol.sha256, 'parent protocol hash mismatch');
  const source = R.loadInputs(parentPath);
  return { protocol, parent: source.protocol, market: source.market, inputs: { ...source.inputs,
    protocol: { path: path.relative(ROOT, protocolPath), id: protocol.id, sha256: sha256(text), frozenDate: protocol.frozenDate },
    parentProtocol: source.inputs.protocol, parentResearchEngine: source.inputs.researchEngine,
    researchEngine: { path: path.relative(ROOT, __filename), sha256: sha256(fs.readFileSync(__filename)) }
  } };
}
function buildFeatures(market, portfolio) {
  let value = 1, peak = 1, maSum = 0;
  const values = [], returns = [], features = [];
  for (let i = 0; i < market.length; i++) {
    assert.ok(!i || market[i].day > market[i - 1].day, 'calendar must strictly increase');
    assert.ok(market[i].prices.length === portfolio.positions.length && market[i].prices.every(p => Number.isFinite(p) && p > 0));
    if (i) {
      value *= portfolio.strategicCashWeight + sum(portfolio.positions.map((p, j) => p.weight * market[i].prices[j] / market[i - 1].prices[j]));
      returns.push(value / values[i - 1] - 1);
    }
    values.push(value); peak = Math.max(peak, value); maSum += value;
    if (i >= 200) maSum -= values[i - 200];
    const recent = returns.slice(-21), avg = mean(recent);
    const volatility = recent.length === 21 ? Math.sqrt(sum(recent.map(r => (r - avg) ** 2)) / 20) : null;
    features.push({ day: market[i].day, value, features: [i >= 199 ? value / (maSum / 200) - 1 : null,
      value / peak - 1, i >= 5 ? value / values[i - 5] - 1 : null,
      i >= 21 ? value / values[i - 21] - 1 : null, volatility] });
  }
  return features;
}
function buildLabels(market, features, portfolio, feeRate = .001) {
  const risk = sum(portfolio.positions.map(p => p.weight));
  return market.map((row, s) => {
    if (!s || s + DELAY >= market.length || !finiteFeatures(features[s - 1]?.features)) return null;
    const ratio = sum(portfolio.positions.map((p, j) => p.weight / risk * market[s + DELAY].prices[j] / row.prices[j]));
    return { entryIndex: s, featureDay: market[s - 1].day, entryDay: row.day, exitIndex: s + DELAY,
      exitDay: market[s + DELAY].day, features: features[s - 1].features.slice(), y: (1 - feeRate) / (1 + feeRate) * (1 - ratio) };
  });
}
function createMoments(dim = 5) {
  return { n: 0, meanX: Array(dim).fill(0), meanY: 0, m2: Array.from({ length: dim }, () => Array(dim).fill(0)), xy: Array(dim).fill(0) };
}
function updateMoments(state, x, y) {
  assert.ok(x.length === state.meanX.length && x.every(Number.isFinite) && Number.isFinite(y));
  const dx = x.map((v, i) => v - state.meanX[i]), dy = y - state.meanY;
  state.n++; state.meanY += dy / state.n;
  x.forEach((v, i) => { state.meanX[i] += dx[i] / state.n; });
  x.forEach((v, j) => {
    state.xy[j] += dx[j] * (y - state.meanY);
    x.forEach((_, k) => { state.m2[j][k] += dx[j] * (x[k] - state.meanX[k]); });
  });
  return state;
}
function solveLinear(matrix, target) {
  const a = matrix.map((r, i) => [...r, target[i]]), n = a.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    assert.ok(Math.abs(a[pivot][col]) > 1e-15, 'singular regression system');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col]; for (let j = col; j <= n; j++) a[col][j] /= scale;
    for (let i = 0; i < n; i++) if (i !== col) {
      const factor = a[i][col]; for (let j = col; j <= n; j++) a[i][j] -= factor * a[col][j];
    }
  }
  return a.map(r => r[n]);
}
function fitMoments(state, lambda = 1) {
  assert.ok(state.n && lambda >= 0);
  const sd = state.meanX.map((_, j) => Math.sqrt(Math.max(0, state.m2[j][j] / state.n)));
  const covariance = state.meanX.map((_, j) => state.meanX.map((__, k) =>
    (sd[j] && sd[k] ? (state.m2[j][k] + state.m2[k][j]) / (2 * state.n * sd[j] * sd[k]) : 0) + (j === k ? lambda : 0)));
  const beta = solveLinear(covariance, state.xy.map((v, j) => sd[j] ? v / (state.n * sd[j]) : 0));
  return { trainingN: state.n, trainingMeanY: state.meanY, featureMeans: state.meanX.slice(), featureStd: sd, beta };
}
function fitRidge(rows, lambda = 1) {
  assert.ok(rows.length); const state = createMoments(rows[0].features.length);
  for (const row of rows) updateMoments(state, row.features, row.y);
  return fitMoments(state, lambda);
}
function predictFit(fit, features) {
  return fit.trainingMeanY + sum(features.map((v, j) => fit.featureStd[j] ? (v - fit.featureMeans[j]) / fit.featureStd[j] * fit.beta[j] : 0));
}
function decisionOffset(predictedY) { return predictedY > THRESHOLD ? DELAY : 0; }
function buildPredictions(market, portfolio, options = {}) {
  const features = buildFeatures(market, portfolio), labels = buildLabels(market, features, portfolio, options.feeRate ?? .001);
  const moments = createMoments(), predictions = []; let latestTrainingExit = null;
  for (let t = 0; t < market.length; t++) {
    const newlyMature = labels[t - DELAY - 1];
    if (newlyMature) {
      assert.equal(newlyMature.exitIndex, t - 1);
      updateMoments(moments, newlyMature.features, newlyMature.y); latestTrainingExit = newlyMature.exitDay;
    }
    const x = features[t - 1]?.features;
    const header = { day: market[t].day, executionDay: market[t].day, featureDay: t ? market[t - 1].day : null, trainingN: moments.n, latestTrainingExit };
    if (moments.n < MIN_TRAINING || !finiteFeatures(x)) {
      predictions.push({ ...header, predictedY: null, offset: null, missing: moments.n < MIN_TRAINING ? 'fewer_than_756_mature_daily_labels' : 'incomplete_prior_features' });
      continue;
    }
    const fit = fitMoments(moments, 1), predictedY = predictFit(fit, x);
    assert.ok(Number.isFinite(predictedY), 'non-finite fitted prediction');
    predictions.push({ ...header, ...fit, features: x.slice(), predictedY, predictedAdvantageBps: predictedY * 10000,
      offset: decisionOffset(predictedY), missing: null });
  }
  return { features, labels, predictions };
}
function eligibleEpisodes(market, parent, predictions) {
  const all = R.createEpisodes(market, parent), episodes = all.episodes.filter(ep => Number.isFinite(predictions[ep.startIndex]?.predictedY));
  return { episodes, excluded: { ...all.excluded, predictionWarmupEpisodes: all.episodes.length - episodes.length },
    predictionWarmupStarts: [...new Set(all.episodes.filter(ep => !Number.isFinite(predictions[ep.startIndex]?.predictedY)).map(ep => ep.start))] };
}
function offsetsFor(rule, prediction) {
  if (rule.id === MODEL_ID) { assert.ok(Number.isFinite(prediction?.predictedY) && [0, DELAY].includes(prediction.offset), 'prediction missing on arrival'); return [prediction.offset]; }
  return rule.offsets || [rule.offset];
}
function simulateEpisode(market, episode, rule, scenario, portfolio, predictions, amount = 100, audit = false) {
  assert.equal(scenario.capitalTaxRate, 0); assert.equal(scenario.dividendTaxRate, 0);
  assert.ok(scenario.feeRate >= 0 && scenario.feeRate < 1 && scenario.annualCashRate >= 0);
  const risk = sum(portfolio.positions.map(p => p.weight));
  assert.ok(risk > 0 && Math.abs(risk + portfolio.strategicCashWeight - 1) < 1e-12);
  const plan = R.fundingPlan(market, episode, 'monthly_new_cash', amount), arrivals = new Map(plan.map(r => [r.index, r]));
  const units = portfolio.positions.map(() => 0), lots = [], trades = [], curve = [];
  let strategicCash = 0, fundUnits = 0, contributed = 0, fees = 0, interest = 0, peak = 1, mdd = 0;
  const pendingCash = () => sum(lots.filter(lot => lot.boughtIndex === null).map(lot => lot.cash));
  const wealth = prices => strategicCash + pendingCash() + sum(units.map((u, j) => u * prices[j]));
  for (let i = episode.startIndex; i <= episode.endIndex; i++) {
    const row = market[i];
    if (i > episode.startIndex && scenario.annualCashRate) {
      const factor = (1 + scenario.annualCashRate) ** (gap(market[i - 1].day, row.day) / YEAR), before = strategicCash + pendingCash();
      strategicCash *= factor; for (const lot of lots) if (lot.boughtIndex === null) lot.cash *= factor;
      interest += strategicCash + pendingCash() - before;
    }
    const arrival = arrivals.get(i);
    if (arrival) {
      const nav = fundUnits ? wealth(row.prices) / fundUnits : 1; assert.ok(nav > 0 && Number.isFinite(nav));
      fundUnits += amount / nav; contributed += amount; strategicCash += amount * portfolio.strategicCashWeight;
      const prediction = predictions[i], offsets = offsetsFor(rule, prediction), part = amount * risk / offsets.length;
      for (const offset of offsets) lots.push({ arrivalIndex: i, arrivalDay: row.day, offset, executionIndex: i + offset, original: part, cash: part, boughtIndex: null,
        ...(rule.id === MODEL_ID ? { featureDay: prediction.featureDay, predictedY: prediction.predictedY, trainingN: prediction.trainingN } : {}) });
    }
    for (const lot of lots) {
      if (lot.boughtIndex !== null || i !== lot.executionIndex) continue;
      const usable = lot.cash / (1 + scenario.feeRate);
      for (let j = 0; j < units.length; j++) {
        const notional = usable * portfolio.positions[j].weight / risk, fee = notional * scenario.feeRate, boughtUnits = notional / row.prices[j];
        units[j] += boughtUnits; fees += fee;
        if (audit) trades.push({ day: row.day, side: 'buy', id: portfolio.positions[j].id, units: boughtUnits, price: row.prices[j], notional, fee,
          arrivalDay: lot.arrivalDay, decisionDay: lot.arrivalDay, signalDay: lot.featureDay ?? null, featureDay: lot.featureDay ?? null,
          predictedY: lot.predictedY ?? null, trainingN: lot.trainingN ?? null, offset: lot.offset, waitSessions: i - lot.arrivalIndex,
          reason: rule.id === MODEL_ID ? 'frozen_arrival_prediction' : 'fixed_tranche' });
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
    assert.ok(Number.isFinite(value) && strategicCash >= -1e-9 && lots.every(lot => lot.cash >= -1e-9));
    peak = Math.max(peak, nav); mdd = Math.min(mdd, 100 * (nav / peak - 1));
    if (audit === true || audit?.curve) curve.push({ day: row.day, value, nav, contributed, strategicCash, pendingCash: pendingCash(), units: units.slice(), fees, interest });
  }
  const original = sum(lots.map(l => l.original)), executed = lots.filter(l => l.boughtIndex !== null), executedBudget = sum(executed.map(l => l.original));
  const terminalWealth = wealth(market[episode.endIndex].prices);
  return { rule: rule.id, start: episode.start, end: episode.end, years: episode.years, partition: episode.partition, fundingMode: 'monthly_new_cash',
    terminalWealth, contributed, accountReturnPp: 100 * (terminalWealth / contributed - 1), navReturnPp: 100 * (terminalWealth / fundUnits - 1), maxDrawdownPp: mdd,
    meanWaitSessions: sum(lots.map(l => l.original * ((l.boughtIndex ?? episode.endIndex) - l.arrivalIndex))) / original,
    executedMeanWaitSessions: executedBudget ? sum(executed.map(l => l.original * (l.boughtIndex - l.arrivalIndex))) / executedBudget : null,
    pendingCash: pendingCash(), pendingLots: lots.length - executed.length, fees, interest,
    externalFlows: plan.map(({ day, amount }) => ({ day, amount })), ...(audit ? { trades } : {}),
    ...(audit === true || audit?.curve ? { curve, lots } : {}) };
}
function diagnosticSummary(rows) {
  const errors = rows.map(r => r.predictedY - r.actualY), referenceErrors = rows.map(r => r.referenceForecast - r.actualY);
  const mse = mean(errors.map(e => e * e)), referenceMSE = mean(referenceErrors.map(e => e * e));
  const delayed = rows.filter(r => r.offset === DELAY);
  return { distinctMonthDecisions: rows.length, delayedMonthDecisions: delayed.length, maturedFiveSessionLabels: rows.length,
    meanRealizedWaitingAdvantageOfDelayedDecisions: mean(delayed.map(r => r.actualY)), MAE: mean(errors.map(Math.abs)), MSE: mse,
    referenceMAE: mean(referenceErrors.map(Math.abs)), referenceMSE, R2: referenceMSE > 0 ? 1 - mse / referenceMSE : null,
    dates: rows };
}
function predictionDiagnostics(market, predictions, labels, partitions) {
  return partitions.map(partition => {
    const rows = []; let availableMonthDecisions = 0, excludedUnmaturedOrCrossing = 0;
    for (let i = 0; i < market.length; i++) {
      const day = market[i].day, prediction = predictions[i];
      if ((i && day.slice(0, 7) === market[i - 1].day.slice(0, 7)) || (partition.start && day < partition.start) || (partition.end && day > partition.end) || !Number.isFinite(prediction.predictedY)) continue;
      availableMonthDecisions++;
      const label = labels[i];
      if (!label || (partition.end && label.exitDay > partition.end)) { excludedUnmaturedOrCrossing++; continue; }
      rows.push({ day, featureDay: prediction.featureDay, labelExit: label.exitDay, trainingN: prediction.trainingN,
        latestTrainingExit: prediction.latestTrainingExit, predictedY: prediction.predictedY, referenceForecast: prediction.trainingMeanY, actualY: label.y, offset: prediction.offset });
    }
    return { partition: partition.id, scope: 'unique_first_common_close_of_month_with_available_prediction_and_five_session_label_mature_inside_partition_and_data',
      availableMonthDecisions, excludedUnmaturedOrCrossing, ...diagnosticSummary(rows) };
  });
}
function confirm(results, parent) {
  const find = (partition, scenario = 'base') => results.find(r => r.partition === partition && r.scenario === scenario && r.horizonYears === 1)?.rules.find(r => r.id === MODEL_ID);
  const development = R.economicGates(find('development')?.vsImmediate, parent.selection.economicGates);
  const confirmation = ['validation', 'replication'].map(partition => {
    const base = find(partition), economic = R.economicGates(base?.vsImmediate, parent.selection.economicGates);
    const interval = base?.vsImmediate.meanInterval, intervalPassed = interval?.status === 'descriptive' && interval.lower > 0;
    const benchmarks = ['vsFixedDelay5', 'vsThreeTranches'].map(key => ({ id: key,
      meanDeltaPp: base?.[key]?.meanDeltaPp ?? null, medianDeltaPp: base?.[key]?.medianDeltaPp ?? null,
      passed: Number.isFinite(base?.[key]?.meanDeltaPp) && base[key].meanDeltaPp >= 0 && base[key].medianDeltaPp >= 0 }));
    const stress = parent.scenarios.filter(s => s.id !== 'base').map(s => { const pair = find(partition, s.id)?.vsImmediate; return {
      scenario: s.id, meanDeltaPp: pair?.meanDeltaPp ?? null, medianDeltaPp: pair?.medianDeltaPp ?? null,
      passed: Number.isFinite(pair?.meanDeltaPp) && pair.meanDeltaPp > 0 && pair.medianDeltaPp > 0 }; });
    return { partition, diagnosticOnly: !development.passed, economic, interval, intervalPassed, benchmarks, stress,
      passed: economic.passed && intervalPassed && benchmarks.every(b => b.passed) && stress.every(s => s.passed) };
  });
  return { candidate: MODEL_ID, development, eligibleForConfirmation: development.passed, confirmation,
    historicalConfirmationPassed: development.passed && confirmation.every(c => c.passed), integrationPassed: false,
    integrationRequirements: { independentModelLedgerCausalityAudit: 'separate_evidence_required', productionEquivalentDividendAndPersonalTaxValidation: 'not_completed', futureReevaluationScope: 'not_integrated' },
    status: !development.passed ? 'development_failed_research_only' : confirmation.every(c => c.passed) ? 'historical_pass_pending_validation' : 'confirmation_failed_research_only' };
}
function runResearch({ audit = false, protocolPath } = {}) {
  const { protocol, parent, market, inputs } = loadInputs(protocolPath), model = buildPredictions(market, parent.portfolio);
  const coverage = eligibleEpisodes(market, parent, model.predictions), rules = [{ id: MODEL_ID }, ...protocol.benchmarks];
  const results = [], pairedBaseWindows = [], auditWindows = [];
  for (const scenario of parent.scenarios) for (const years of [1, 3]) for (const partition of parent.episodes.partitions) {
    const episodes = coverage.episodes.filter(e => e.years === years && e.partition === partition.id);
    const accounts = new Map(rules.map(rule => [rule.id, episodes.map(ep => simulateEpisode(market, ep, rule, scenario, parent.portfolio, model.predictions, parent.funding.amountPerDeposit,
      audit && scenario.id === 'base' ? { curve: false } : false))]));
    results.push({ fundingMode: 'monthly_new_cash', partition: partition.id, scenario: scenario.id, horizonYears: years,
      startRange: episodes.length ? { first: episodes[0].start, last: episodes.at(-1).start } : null,
      rules: rules.map(rule => ({ id: rule.id, summary: R.summarizeAccounts(accounts.get(rule.id)),
        vsImmediate: R.pairedSummary(accounts.get(rule.id), accounts.get('immediate'), years === 1),
        vsFixedDelay5: R.pairedSummary(accounts.get(rule.id), accounts.get('fixed_delay5'), years === 1),
        vsThreeTranches: R.pairedSummary(accounts.get(rule.id), accounts.get('three_tranches'), years === 1) })) });
    if (scenario.id === 'base') episodes.forEach((ep, i) => {
      const window = { start: ep.start, end: ep.end, anniversary: ep.anniversary, years, partition: partition.id, fundingMode: 'monthly_new_cash', scenario: 'base' };
      if (years === 1) pairedBaseWindows.push({ ...window, contributed: accounts.get('immediate')[i].contributed,
        rules: Object.fromEntries(rules.map(rule => { const r = accounts.get(rule.id)[i]; return [rule.id, { terminalWealth: r.terminalWealth, accountReturnPp: r.accountReturnPp,
          maxDrawdownPp: r.maxDrawdownPp, fees: r.fees, interest: r.interest, meanWaitSessions: r.meanWaitSessions, pendingCash: r.pendingCash,
          deltaVsImmediatePp: 100 * (r.terminalWealth - accounts.get('immediate')[i].terminalWealth) / r.contributed }]; })) });
      if (audit) auditWindows.push({ ...window, rules: Object.fromEntries(rules.map(rule => [rule.id, accounts.get(rule.id)[i]])) });
    });
  }
  const report = { protocolId: protocol.id, generatedAt: new Date().toISOString(), inputs,
    method: { usage: 'research_only_predictive_waiting_advantage', frozenDate: protocol.frozenDate, priorExposure: protocol.priorExposure,
      modelId: MODEL_ID, features: protocol.model.features, minimumMatureLabels: MIN_TRAINING, ridgeLambda: 1, standardization: 'training_population_sd_zero_variance_maps_zero',
      predictionDates: 'day_and_executionDay_are_historical_funding_execution_dates_featureDay_is_the_strict_prior_close_not_a_current_recommendation',
      solver: 'Welford_centered_moments_symmetric_covariance_partial_pivot_Gauss_Jordan', objective: protocol.model.objective,
      decisionThreshold: THRESHOLD, positiveDecision: 'strictly_greater_than_threshold', labelDelaySessions: DELAY, feeRateForLabels: .001,
      scenariosShareFrozenBasePredictions: true, fundingModes: ['monthly_new_cash'], adjustedPrices: 'total_return_pre_personal_tax_not_net_of_personal_tax',
      calendar: 'actual_common_product_closes_with_prior_FX_max_7_calendar_days_not_every_real_world_day',
      waiting: 'each_arrival_offset_fixed_once_cash_interest_on_each_pending_lot_terminal_pending_retained',
      bootstrap: parent.metricDefinitions.bootstrap, uncertainty: 'descriptive_historical_replication_not_genuine_unseen_holdout',
      diagnostics: 'unique_available_month_first_decisions_with_label_exit_inside_partition_and_data_not_duplicated_rolling_accounts' },
    coverage: { ...coverage, episodes: undefined, eligibleEpisodeCount: coverage.episodes.length,
      firstAvailablePrediction: model.predictions.find(p => Number.isFinite(p.predictedY))?.day ?? null,
      firstEligibleEpisode: coverage.episodes[0]?.start ?? null, allSourceCommonObservations: market.length,
      excludedUnits: { warmup: 'month_start', predictionWarmupEpisodes: 'horizon_episode', otherExclusions: 'horizon_episode' } },
    dailyPredictions: model.predictions.map(({ features, featureMeans, featureStd, beta, ...p }) => p),
    latestPrediction: model.predictions.at(-1), predictionDiagnostics: predictionDiagnostics(market, model.predictions, model.labels, parent.episodes.partitions),
    results, pairedBaseWindows, decision: confirm(results, parent) };
  report.statisticsSha256 = sha256(JSON.stringify({ results, pairedBaseWindows, predictionDiagnostics: report.predictionDiagnostics, decision: report.decision }));
  return { report, audit: audit ? { protocolId: protocol.id, inputs, predictions: model.predictions, windows: auditWindows } : null };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
  const auditPath = value('--audit-output'), output = value('--output') || path.join(ROOT, 'docs/evidence/portfolio-entry-predictive-v2.json');
  const result = runResearch({ audit: Boolean(auditPath) });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result.report, null, 2) + '\n');
  if (auditPath) { fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify(result.audit) + '\n'); }
  console.log(JSON.stringify({ output, auditPath, statisticsSha256: result.report.statisticsSha256, decision: result.report.decision,
    basePrimary: result.report.results.filter(r => r.scenario === 'base' && r.horizonYears === 1).map(r => ({ partition: r.partition, candidate: r.rules[0] })) }, null, 2));
}
module.exports = { MIN_TRAINING, MODEL_ID, loadInputs, buildFeatures, buildLabels, createMoments, updateMoments, fitMoments, fitRidge, predictFit,
  solveLinear, decisionOffset, buildPredictions, eligibleEpisodes, offsetsFor, simulateEpisode, diagnosticSummary, predictionDiagnostics, confirm, runResearch };
