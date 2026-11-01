#!/usr/bin/env node
'use strict';
// Independent batch audit of the frozen v2 predictor and equal-cash accounts.
// Source prices/reference reuse the independent v1 auditor. Ridge expectations
// use explicit training rows and a fresh 5x5 batch solve, never online moments.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const V1 = require('./check_portfolio_entry_research.cjs');
const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = 'docs/research/portfolio-entry-protocol-v2.json';
const ENGINE = 'scripts/research_portfolio_entry_predictive.cjs';
const MIN_TRAINING = 756, DELAY = 5, EPS = 1e-8;
const total = xs => xs.reduce((a, b) => a + b, 0);
const mean = xs => total(xs) / xs.length;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function close(actual, expected, context, tolerance = EPS) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    context + ': ' + actual + ' != ' + expected);
}
function readInputs() {
  const source = V1.readInputs(), bytes = fs.readFileSync(path.join(ROOT, PROTOCOL)), protocol = JSON.parse(bytes);
  assert.equal(protocol.id, 'equal-budget-predictive-delay-v2');
  assert.equal(protocol.parentProtocol.sha256, source.fingerprints.protocol);
  assert.deepEqual(source.protocol.portfolio.positions, [{ id: 'us:USD', weight: .3 }, { id: 'us:TQQQ', weight: .3 }]);
  assert.equal(source.protocol.portfolio.strategicCashWeight, .4);
  const base = source.protocol.scenarios.find(s => s.id === 'base');
  assert.equal(base.annualCashRate, 0); assert.equal(base.feeRate, .001); assert.equal(base.capitalTaxRate, 0); assert.equal(base.dividendTaxRate, 0);
  assert.equal(protocol.model.ridgeLambda, 1); assert.equal(protocol.model.candidates, 1);
  assert.deepEqual(protocol.model.features, ['MA200_deviation', 'all_history_drawdown', 'return5', 'return21', 'volatility21']);
  return { ...source, parent: source.protocol, protocol, protocolSha256: hash(bytes) };
}
function featureRows(market) {
  return market.map((row, i) => {
    if (i < 199) return null;
    const observations = [];
    for (let j = i - 20; j <= i; j++) observations.push(market[j].reference / market[j - 1].reference - 1);
    const average = mean(observations);
    const volatility = Math.sqrt(total(observations.map(x => (x - average) ** 2)) / 20);
    return [row.features.deviation, row.features.drawdown, row.reference / market[i - 5].reference - 1, row.features.return21, volatility];
  });
}
function trainingRows(market, features) {
  const rows = [];
  for (let s = 1; s + DELAY < market.length; s++) {
    if (!features[s - 1] || !features[s - 1].every(Number.isFinite)) continue;
    const returnFactor = mean(market[s].prices.map((price, k) => market[s + DELAY].prices[k] / price));
    rows.push({ index: s, featureIndex: s - 1, exitIndex: s + DELAY, x: features[s - 1].slice(), y: .999 / 1.001 * (1 - returnFactor) });
  }
  return rows;
}
function solve(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]), n = a.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    assert.ok(Math.abs(a[pivot][col]) > 1e-14, 'ridge matrix must be invertible');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= divisor;
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map(row => row[n]);
}
function batchRidge(rows, currentX, lambda = 1) {
  const n = rows.length, d = currentX.length;
  assert.ok(n > 0 && lambda > 0);
  const featureMeans = currentX.map((_, j) => mean(rows.map(row => row.x[j])));
  const featureStd = currentX.map((_, j) => rows.every(row => row.x[j] === rows[0].x[j]) ? 0 : Math.sqrt(mean(rows.map(row => (row.x[j] - featureMeans[j]) ** 2))));
  const trainingMeanY = mean(rows.map(row => row.y));
  const standardized = rows.map(row => row.x.map((value, j) => featureStd[j] ? (value - featureMeans[j]) / featureStd[j] : 0));
  const matrix = Array.from({ length: d }, (_, j) => Array.from({ length: d }, (_, k) =>
    total(standardized.map(z => z[j] * z[k])) / n + (j === k ? lambda : 0)));
  const rhs = Array.from({ length: d }, (_, j) => total(standardized.map((z, k) => z[j] * (rows[k].y - trainingMeanY))) / n);
  const beta = solve(matrix, rhs);
  const z = currentX.map((value, j) => featureStd[j] ? (value - featureMeans[j]) / featureStd[j] : 0);
  const predictedY = trainingMeanY + total(z.map((value, j) => value * beta[j]));
  return { trainingMeanY, featureMeans, featureStd, beta, predictedY, offset: predictedY > 1e-12 ? DELAY : 0 };
}
function predict(market, features, labels, index) {
  const currentX = features[index - 1];
  if (!currentX || !currentX.every(Number.isFinite)) return null;
  const rows = labels.filter(row => row.exitIndex < index);
  if (rows.length < MIN_TRAINING) return null;
  const fit = batchRidge(rows, currentX);
  return { day: market[index].day, index, featureDay: market[index - 1].day, trainingN: rows.length,
    latestTrainingExit: market[rows.at(-1).exitIndex].day, features: currentX.slice(), ...fit };
}
function monthPredictions(market, features, labels) {
  const result = new Map();
  market.forEach((row, i) => {
    if (i && row.day.slice(0, 7) === market[i - 1].day.slice(0, 7)) return;
    const p = predict(market, features, labels, i);
    if (p) result.set(row.day, p);
  });
  return result;
}
function comparePrediction(actual, expected, context, maxima) {
  for (const field of ['day', 'featureDay', 'trainingN', 'latestTrainingExit', 'offset']) assert.equal(actual[field], expected[field], context + '.' + field);
  assert.ok(actual.latestTrainingExit <= actual.featureDay && actual.featureDay < actual.day, context + ': training cutoff');
  for (const field of ['trainingMeanY', 'predictedY']) {
    close(actual[field], expected[field], context + '.' + field);
    if (maxima) maxima[field] = Math.max(maxima[field] || 0, Math.abs(actual[field] - expected[field]));
  }
  for (const field of ['features', 'featureMeans', 'featureStd', 'beta']) {
    assert.equal(actual[field].length, expected[field].length, context + '.' + field + '.length');
    expected[field].forEach((value, i) => {
      close(actual[field][i], value, context + '.' + field + '.' + i);
      if (maxima) maxima[field] = Math.max(maxima[field] || 0, Math.abs(actual[field][i] - value));
    });
  }
}
function lotsForWindow(market, episode, rule, decisions, parent) {
  const flows = V1.deposits(market, episode, 'monthly_new_cash', parent.funding.amountPerDeposit);
  return { flows, lots: flows.flatMap(flow => {
    const offsets = rule.id === 'expanding_ridge_delay5' ? [decisions.get(flow.day).offset] : rule.offsets || [rule.offset];
    return offsets.map(offset => {
      const index = flow.index + offset;
      const buyIndex = index <= episode.endIndex ? index : null;
      const original = flow.amount * .6 / offsets.length;
      const notional = original / 1.001;
      return { arrival: flow, offset, original, buyIndex, notional,
        units: buyIndex === null ? [0, 0] : market[buyIndex].prices.map(price => notional / 2 / price) };
    });
  }) };
}
function independentAccount(market, episode, rule, decisions, parent) {
  const { flows, lots } = lotsForWindow(market, episode, rule, decisions, parent);
  const value = (index, beforeDeposit = false, liquidation = false) => {
    const active = flows.filter(f => beforeDeposit ? f.index < index : f.index <= index);
    let amount = total(active.map(f => f.amount * .4));
    for (const lot of lots) {
      if (beforeDeposit ? lot.arrival.index >= index : lot.arrival.index > index) continue;
      if (lot.buyIndex === null || (beforeDeposit ? lot.buyIndex >= index : lot.buyIndex > index)) amount += lot.original;
      else amount += total(lot.units.map((units, j) => units * market[index].prices[j])) * (liquidation ? .999 : 1);
    }
    return amount;
  };
  const bought = lots.filter(lot => lot.buyIndex !== null), contributed = total(flows.map(f => f.amount));
  const buyFees = total(bought.map(lot => lot.original - lot.notional));
  const sellFees = total(bought.flatMap(lot => lot.units.map((units, j) => units * market[episode.endIndex].prices[j] * .001)));
  const terminalWealth = value(episode.endIndex, false, true);
  let fundUnits = 0, peak = 1, maxDrawdownPp = 0;
  for (let index = episode.startIndex; index <= episode.endIndex; index++) {
    const flow = flows.find(f => f.index === index);
    if (flow) fundUnits += flow.amount / (fundUnits ? value(index, true) / fundUnits : 1);
    const nav = value(index, false, index === episode.endIndex) / fundUnits;
    peak = Math.max(peak, nav); maxDrawdownPp = Math.min(maxDrawdownPp, 100 * (nav / peak - 1));
  }
  const trades = bought.flatMap(lot => parent.portfolio.positions.map((p, j) => ({ day: market[lot.buyIndex].day, side: 'buy', id: p.id,
    arrivalDay: lot.arrival.day, units: lot.units[j], price: market[lot.buyIndex].prices[j], notional: lot.notional / 2,
    fee: (lot.original - lot.notional) / 2, waitSessions: lot.offset })));
  parent.portfolio.positions.forEach((p, j) => {
    const units = total(bought.map(lot => lot.units[j]));
    if (units) trades.push({ day: episode.end, side: 'sell', id: p.id, units, price: market[episode.endIndex].prices[j],
      notional: units * market[episode.endIndex].prices[j], fee: units * market[episode.endIndex].prices[j] * .001 });
  });
  return { terminalWealth, contributed, accountReturnPp: 100 * (terminalWealth / contributed - 1), maxDrawdownPp,
    meanWaitSessions: total(lots.map(lot => lot.original * ((lot.buyIndex ?? episode.endIndex) - lot.arrival.index))) / total(lots.map(lot => lot.original)),
    pendingCash: total(lots.filter(lot => lot.buyIndex === null).map(lot => lot.original)), pendingLots: lots.length - bought.length,
    fees: buyFees + sellFees, interest: 0, externalFlows: flows.map(({ day, amount }) => ({ day, amount })), trades };
}
function compareAccount(actual, expected, context, maxima) {
  assert.deepEqual(actual.externalFlows, expected.externalFlows, context + '.externalFlows');
  for (const field of ['terminalWealth', 'contributed', 'accountReturnPp', 'maxDrawdownPp', 'meanWaitSessions', 'pendingCash', 'pendingLots', 'fees', 'interest']) {
    close(actual[field], expected[field], context + '.' + field);
    if (maxima) maxima[field] = Math.max(maxima[field] || 0, Math.abs(actual[field] - expected[field]));
  }
  const key = t => [t.day, t.side, t.id, t.arrivalDay || ''].join('/');
  const a = actual.trades.slice().sort((x, y) => key(x).localeCompare(key(y))), e = expected.trades.slice().sort((x, y) => key(x).localeCompare(key(y)));
  assert.equal(a.length, e.length, context + '.trades.length');
  e.forEach((trade, i) => {
    for (const field of ['day', 'side', 'id', 'arrivalDay', 'waitSessions']) assert.equal(a[i][field], trade[field], context + '.trade.' + i + '.' + field);
    for (const field of ['units', 'price', 'notional', 'fee']) close(a[i][field], trade[field], context + '.trade.' + i + '.' + field);
  });
}
function diagnosticRows(market, decisions, labels, parent) {
  const byEntry = new Map(labels.map(row => [market[row.index].day, row]));
  return parent.episodes.partitions.map(partition => {
    const predictions = [...decisions.values()].filter(p => (!partition.start || p.day >= partition.start) && (!partition.end || p.day <= partition.end));
    const matured = predictions.filter(p => {
      const label = byEntry.get(p.day);
      return label && (!partition.end || market[label.exitIndex].day <= partition.end);
    }).map(p => ({ ...p, realizedY: byEntry.get(p.day).y, exit: market[byEntry.get(p.day).exitIndex].day }));
    const delayed = matured.filter(p => p.offset === 5);
    const metric = fn => matured.length ? mean(matured.map(fn)) : null;
    const mse = metric(p => (p.predictedY - p.realizedY) ** 2), baselineMSE = metric(p => (p.trainingMeanY - p.realizedY) ** 2);
    return { partition: partition.id, decisionN: predictions.length, delayedDecisionN: predictions.filter(p => p.offset === 5).length,
      maturedN: matured.length, delayedMaturedN: delayed.length, first: predictions[0]?.day ?? null, end: predictions.at(-1)?.day ?? null,
      maturedFirst: matured[0]?.day ?? null, maturedEnd: matured.at(-1)?.day ?? null, latestLabelExit: matured.at(-1)?.exit ?? null,
      meanRealizedWaitingAdvantage: delayed.length ? mean(delayed.map(p => p.realizedY)) : null,
      mae: metric(p => Math.abs(p.predictedY - p.realizedY)), mse,
      referenceMAE: metric(p => Math.abs(p.trainingMeanY - p.realizedY)), referenceMSE: baselineMSE,
      r2: baselineMSE > 0 ? 1 - mse / baselineMSE : null };
  });
}
const windowKey = row => [row.fundingMode, row.years, row.partition, row.start, row.end].join('/');
function uniqueMap(rows, key, context) {
  const map = new Map();
  for (const row of rows) { const id = key(row); assert.ok(!map.has(id), context + ': duplicate ' + id); map.set(id, row); }
  return map;
}
function checkInputs(inputs, loaded) {
  assert.equal(inputs.protocol.sha256, loaded.protocolSha256);
  assert.equal(inputs.parentProtocol.sha256, loaded.fingerprints.protocol);
  assert.equal(inputs.catalog.sha256, loaded.fingerprints.catalog);
  for (const source of loaded.fingerprints.histories) {
    const recorded = inputs.histories.find(row => row.id === source.id);
    assert.ok(recorded, 'missing source ' + source.id); assert.equal(recorded.path, source.path); assert.equal(recorded.sha256, source.sha256);
  }
  assert.equal(inputs.researchEngine.path, ENGINE);
  assert.equal(inputs.researchEngine.sha256, hash(fs.readFileSync(path.join(ROOT, ENGINE))), 'engine has changed since report generation');
}
function compareDiagnostics(report, market, decisions, labels, parent) {
  const expected = diagnosticRows(market, decisions, labels, parent), byEntry = new Map(labels.map(row => [market[row.index].day, row]));
  assert.equal(report.length, expected.length);
  for (const e of expected) {
    const actual = report.find(row => row.partition === e.partition), prefix = 'diagnostics.' + e.partition;
    assert.ok(actual, prefix);
    const countPairs = { availableMonthDecisions: e.decisionN, excludedUnmaturedOrCrossing: e.decisionN - e.maturedN,
      distinctMonthDecisions: e.maturedN, delayedMonthDecisions: e.delayedMaturedN, maturedFiveSessionLabels: e.maturedN };
    for (const [field, value] of Object.entries(countPairs)) assert.equal(actual[field], value, prefix + '.' + field);
    const fields = { meanRealizedWaitingAdvantageOfDelayedDecisions: e.meanRealizedWaitingAdvantage,
      MAE: e.mae, MSE: e.mse, referenceMAE: e.referenceMAE, referenceMSE: e.referenceMSE, R2: e.r2 };
    for (const [field, value] of Object.entries(fields)) if (value === null) assert.equal(actual[field], null, prefix + '.' + field); else close(actual[field], value, prefix + '.' + field);
    const dates = uniqueMap(actual.dates, row => row.day, prefix + '.dates'); assert.equal(dates.size, e.maturedN);
    const partition = parent.episodes.partitions.find(p => p.id === e.partition);
    for (const p of decisions.values()) {
      if (partition.start && p.day < partition.start || partition.end && p.day > partition.end) continue;
      const label = byEntry.get(p.day);
      if (!label || partition.end && market[label.exitIndex].day > partition.end) { assert.ok(!dates.has(p.day), prefix + ': immature date included'); continue; }
      const actualDay = dates.get(p.day); assert.ok(actualDay, prefix + ': missing ' + p.day);
      for (const field of ['featureDay', 'trainingN', 'latestTrainingExit', 'offset']) assert.equal(actualDay[field], p[field], prefix + '.' + p.day + '.' + field);
      assert.equal(actualDay.labelExit, market[label.exitIndex].day);
      close(actualDay.predictedY, p.predictedY, prefix + '.predictedY'); close(actualDay.referenceForecast, p.trainingMeanY, prefix + '.referenceForecast');
      close(actualDay.actualY, label.y, prefix + '.actualY');
    }
  }
  return expected.map(({ partition, decisionN, delayedDecisionN, maturedN, delayedMaturedN, first, end, maturedFirst, maturedEnd, latestLabelExit }) =>
    ({ partition, decisionN, delayedDecisionN, maturedN, delayedMaturedN, first, end, maturedFirst, maturedEnd, latestLabelExit }));
}
function engineCausality(market, parent, auditedPredictions) {
  // The engine is invoked only as the subject of this adversarial test. Its
  // outputs never supply independent training rows, fits, offsets or accounts.
  const Engine = require(path.join(ROOT, ENGINE));
  const prices = market.map(row => ({ day: row.day, prices: row.prices.slice() }));
  const baseline = Engine.buildPredictions(prices, parent.portfolio).predictions;
  assert.deepEqual(baseline, auditedPredictions, 'current engine prediction trace differs from saved audit');
  const checks = [];
  for (const day of ['2015-08-24', '2020-03-16', '2022-10-13', '2025-04-07']) {
    const index = market.findIndex(row => row.day >= day); assert.ok(index > 961 && index + 1 < market.length);
    const altered = prices.map((row, i) => ({ day: row.day, prices: row.prices.map((price, j) => i < index ? price : price * (j ? .001 : 1000) * (i % 2 ? 1.2 : .8)) }));
    const after = Engine.buildPredictions(altered, parent.portfolio).predictions;
    assert.deepEqual(after.slice(0, index + 1), baseline.slice(0, index + 1), 'current/future quote mutation changed past prediction at ' + market[index].day);
    assert.notDeepEqual(after[index + 1], baseline[index + 1], 'future shock did not exercise the predictor');
    checks.push({ firstAlteredPrice: market[index].day, unchangedThroughDecision: market[index].day, identicalPredictionRows: index + 1, includesWarmupRows: true, futureChangeExercised: true });
  }
  return checks;
}
function auditReports(report, audit, loaded) {
  const { protocol, parent, market } = loaded;
  assert.equal(report.protocolId, protocol.id); assert.equal(audit.protocolId, protocol.id);
  checkInputs(report.inputs, loaded); checkInputs(audit.inputs, loaded);
  assert.equal(report.decision.integrationPassed, false, 'no automatic production integration');
  const features = featureRows(market), labels = trainingRows(market, features);
  const decisions = monthPredictions(market, features, labels), trace = audit.predictions;
  assert.equal(trace.length, market.length, 'prediction trace must include every source day');
  assert.equal(report.dailyPredictions.length, trace.length, 'report daily prediction coverage');
  const predictionErrors = {}, ledgerErrors = {};
  let firstAvailable = null, availableN = 0;
  for (let i = 0; i < market.length; i++) {
    const p = trace[i], matured = labels.filter(row => row.exitIndex < i), display = report.dailyPredictions[i];
    assert.equal(p.day, market[i].day); assert.equal(p.featureDay, i ? market[i - 1].day : null);
    assert.equal(p.trainingN, matured.length, p.day + ': training count');
    assert.equal(p.latestTrainingExit, matured.length ? market[matured.at(-1).exitIndex].day : null, p.day + ': last label exit');
    for (const field of ['day', 'featureDay', 'trainingN', 'latestTrainingExit', 'predictedY', 'offset']) assert.equal(display[field], p[field], 'report/ledger prediction ' + p.day + '.' + field);
    if (matured.length < MIN_TRAINING || !features[i - 1]) { assert.equal(p.predictedY, null); assert.equal(p.offset, null); continue; }
    firstAvailable ??= p.day; availableN++;
    assert.ok(Number.isFinite(p.predictedY)); assert.equal(p.offset, p.predictedY > 1e-12 ? 5 : 0);
    features[i - 1].forEach((value, j) => close(p.features[j], value, p.day + '.current feature.' + j));
    close(p.trainingMeanY, mean(matured.map(row => row.y)), p.day + '.training mean label');
    close(p.predictedAdvantageBps, p.predictedY * 10000, p.day + '.basis points');
  }
  const dailyChecks = [firstAvailable, '2015-08-24', '2018-12-24', '2020-03-16', '2022-10-13', '2025-04-07', market.at(-1).day]
    .map(day => market.findIndex(row => row.day >= day));
  const fitted = new Map(decisions);
  for (const index of dailyChecks) { const p = predict(market, features, labels, index); assert.ok(p); fitted.set(p.day, p); }
  for (const p of fitted.values()) comparePrediction(trace[p.index], p, 'batch.' + p.day, predictionErrors);
  comparePrediction(report.latestPrediction, predict(market, features, labels, market.length - 1), 'latest prediction', predictionErrors);
  const episodes = V1.windows(market, parent).filter(e => decisions.has(e.start));
  const windows = uniqueMap(audit.windows, windowKey, 'audit.windows'), paired = uniqueMap(report.pairedBaseWindows, windowKey, 'report.pairedBaseWindows');
  assert.equal(windows.size, episodes.length, 'all primary/auxiliary windows');
  assert.equal(paired.size, episodes.filter(e => e.years === 1).length, 'primary paired windows');
  assert.equal(report.coverage.eligibleEpisodeCount, episodes.length); assert.equal(report.coverage.firstAvailablePrediction, firstAvailable);
  assert.equal(report.coverage.firstEligibleEpisode, episodes[0].start); assert.equal(report.coverage.allSourceCommonObservations, market.length);
  const rules = [{ id: protocol.model.id }, ...protocol.benchmarks], groups = {};
  let accounts = 0, tradeN = 0, flowN = 0;
  for (const episode of episodes) {
    const key = windowKey({ ...episode, fundingMode: 'monthly_new_cash' }), window = windows.get(key);
    assert.ok(window, key); assert.equal(window.scenario, 'base'); assert.equal(window.anniversary, episode.anniversary);
    assert.deepEqual(Object.keys(window.rules).sort(), rules.map(r => r.id).sort());
    const expected = new Map(rules.map(rule => [rule.id, independentAccount(market, episode, rule, decisions, parent)]));
    for (const rule of rules) {
      const calculated = expected.get(rule.id), recorded = window.rules[rule.id];
      compareAccount(recorded, calculated, key + '/' + rule.id, ledgerErrors);
      if (rule.id === protocol.model.id) for (const trade of recorded.trades.filter(t => t.side === 'buy')) {
        const decision = decisions.get(trade.arrivalDay); assert.ok(decision);
        assert.equal(trade.signalDay, decision.featureDay, key + ': one fixed arrival decision');
        assert.equal(trade.trainingN, decision.trainingN); assert.equal(trade.offset, decision.offset);
        close(trade.predictedY, decision.predictedY, key + ': frozen prediction');
        assert.equal(trade.reason, 'frozen_arrival_prediction');
      }
      if (episode.years === 1) {
        const summary = paired.get(key); assert.ok(summary); close(summary.contributed, calculated.contributed, key + '.contributed');
        const row = summary.rules[rule.id]; assert.ok(row);
        for (const field of ['terminalWealth', 'accountReturnPp', 'maxDrawdownPp', 'fees', 'interest', 'meanWaitSessions', 'pendingCash']) close(row[field], calculated[field], key + '.summary.' + field);
        close(row.deltaVsImmediatePp, 100 * (calculated.terminalWealth - expected.get('immediate').terminalWealth) / calculated.contributed, key + '.delta');
      }
      accounts++; tradeN += calculated.trades.length; flowN += calculated.externalFlows.length;
    }
    const group = episode.years + '/' + episode.partition; groups[group] = (groups[group] || 0) + 1;
  }
  const diagnostics = compareDiagnostics(report.predictionDiagnostics, market, decisions, labels, parent);
  const causalChecks = engineCausality(market, parent, trace);
  return { status: 'passed', protocolId: protocol.id, method: 'explicit matured training rows, population-standardized batch ridge with fresh 5x5 solve; separately valued monthly cash claims',
    scenario: 'base', commonObservations: market.length, trainingAlignmentRowsChecked: trace.length, availableDailyPredictions: availableN,
    distinctMonthFits: decisions.size, additionalDailyFits: fitted.size - decisions.size, totalBatchFits: fitted.size,
    firstAvailablePrediction: firstAvailable, firstEligibleMonthlyFunding: episodes[0].start, monthlyDiagnostics: diagnostics,
    windows: episodes.length, windowsByGroup: groups, accounts, trades: tradeN, externalFlows: flowN,
    maximumAbsolutePredictionDifference: predictionErrors, maximumAbsoluteLedgerDifference: ledgerErrors, causalChecks,
    sourceFingerprints: loaded.fingerprints, limitations: ['Checks arithmetic and causal alignment, not vendor quote accuracy.',
      'Full independent ledger verification covers the base scenario only; stress ledgers, bootstrap/selection inference and personal-tax validation are separate.',
      'Passing this audit does not establish investment improvement or authorize production integration.'] };
}
function selfTest() {
  const row = (x, y) => ({ x: [x, 3, 0, 0, 0], y });
  const fit = batchRidge([row(-1, -.1), row(1, .1)], [1, 3, 0, 0, 0]);
  close(fit.featureStd[0], 1, 'population standard deviation'); close(fit.featureStd[1], 0, 'constant feature');
  close(fit.beta[0], .05, 'mean-loss ridge lambda1'); close(fit.predictedY, .05, 'hand prediction');
  const shifted = batchRidge([row(-1, .1), row(1, .3)], [1, 3, 0, 0, 0]);
  close(shifted.predictedY, .25, 'unpenalized intercept');
  const large = Array.from({ length: 756 }, (_, i) => row(i % 2 ? 1 : -1, i % 2 ? 5 : 1));
  const largeFit = batchRidge(large, [1, 3, 0, 0, 0]);
  close(largeFit.predictedY, 4, '756-row average-loss normalization'); close(largeFit.beta[0], 1, 'lambda does not shrink with n');
  const collinear = large.map(r => ({ x: Array(5).fill(r.x[0]), y: r.y }));
  const collinearFit = batchRidge(collinear, Array(5).fill(1));
  collinearFit.beta.forEach(beta => close(beta, 1 / 3, 'collinear coefficients remain stable'));
  close(collinearFit.predictedY, 3 + 5 / 3, 'collinear ridge closed form');
  const parent = { portfolio: { positions: [{ id: 'a', weight: .3 }, { id: 'b', weight: .3 }] }, funding: { amountPerDeposit: 100 } };
  const market = ['2020-01-02', '2020-01-03', '2020-01-06', '2020-01-07', '2020-01-08', '2020-01-09'].map((day, i) => ({ day, prices: [10 + i * 2, 20 - i * 2] }));
  const episode = { startIndex: 0, endIndex: 5, start: market[0].day, end: market[5].day, anniversary: '2021-01-02' };
  const immediate = independentAccount(market, episode, { id: 'immediate', offset: 0 }, new Map(), parent);
  close(immediate.terminalWealth, 40 + 75 * .999 / 1.001, 'hand immediate account');
  const fixed = independentAccount(market, episode, { id: 'fixed_delay5', offset: 5 }, new Map(), parent);
  close(fixed.terminalWealth, 40 + 60 * .999 / 1.001, 'fixed delay buys and liquidates at terminal');
  const candidate = independentAccount(market, episode, { id: 'expanding_ridge_delay5' }, new Map([[episode.start, { offset: 5 }]]), parent);
  compareAccount(candidate, fixed, 'candidate locked5 matches fixed5');
  const short = { ...episode, endIndex: 4, end: market[4].day };
  const pending = independentAccount(market, short, { id: 'fixed_delay5', offset: 5 }, new Map(), parent);
  close(pending.terminalWealth, 100, 'waiting past terminal remains cash'); assert.equal(pending.trades.length, 0);
  const tampered = structuredClone(candidate); tampered.trades[0].day = market[4].day;
  assert.throws(() => compareAccount(tampered, candidate, 'reject changed trade day'));
  const sourceProtocol = { portfolio: { positions: [{ weight: .3 }, { weight: .3 }] }, signal: { ma: 200, returnLookback: 21 } };
  const prices = Array.from({ length: 1000 }, (_, i) => ({ day: new Date(Date.UTC(2010, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    prices: [10 * Math.exp(i / 800 + .03 * Math.sin(i / 13)), 20 * Math.exp(i / 900 + .04 * Math.cos(i / 11))] }));
  const prepared = V1.attachFeatures(prices, sourceProtocol), features = featureRows(prepared), labels = trainingRows(prepared, features);
  assert.equal(labels[0].index, 200); assert.equal(labels[0].featureIndex, 199); assert.equal(labels[0].exitIndex, 205);
  close(labels[0].y, .999 / 1.001 * (1 - (prices[205].prices[0] / prices[200].prices[0] + prices[205].prices[1] / prices[200].prices[1]) / 2), 'five-session label endpoints');
  assert.equal(predict(prepared, features, labels, 960), null, '755 labels are insufficient');
  const first = predict(prepared, features, labels, 961);
  assert.equal(first.trainingN, 756); assert.equal(first.latestTrainingExit, prepared[960].day); assert.equal(first.featureDay, prepared[960].day);
  const altered = prices.map((r, i) => ({ ...r, prices: i >= 961 ? r.prices.map((x, j) => x * (j ? .001 : 1000)) : r.prices.slice() }));
  const future = V1.attachFeatures(altered, sourceProtocol), futureFeatures = featureRows(future);
  comparePrediction(predict(future, futureFeatures, trainingRows(future, futureFeatures), 961), first, 'future prices cannot alter current fit');
  // Test volatility at a mature feature date with an explicit sample SD.
  const returns = [];
  for (let i = 941; i <= 961; i++) returns.push(prepared[i].reference / prepared[i - 1].reference - 1);
  close(features[961][4], Math.sqrt(total(returns.map(x => (x - mean(returns)) ** 2)) / 20), 'volatility uses sample SD of 21 daily simple returns');
  return { passed: true, cases: 18 };
}
module.exports = { readInputs, featureRows, trainingRows, batchRidge, predict, monthPredictions, independentAccount, auditReports, selfTest };
if (require.main === module) {
  const args = process.argv.slice(2), tests = selfTest();
  if (args.length === 1 && args[0] === '--self-test') console.log(JSON.stringify({ selfTests: tests }, null, 2));
  else {
    assert.ok(args.length === 4 && args[0] === '--report' && args[2] === '--audit', 'usage: --self-test OR --report REPORT.json --audit LEDGERS.json');
    const reportBytes = fs.readFileSync(path.resolve(args[1])), ledgerBytes = fs.readFileSync(path.resolve(args[3])), loaded = readInputs();
    const result = auditReports(JSON.parse(reportBytes), JSON.parse(ledgerBytes), loaded);
    console.log(JSON.stringify({ ...result, selfTests: tests, tolerance: { relativeOrAbsolute: EPS, expression: 'abs(actual - expected) <= 1e-8 * max(1, abs(expected))' },
      reportSha256: hash(reportBytes), ledgerSha256: hash(ledgerBytes), protocolSha256: loaded.protocolSha256,
      engineSha256: hash(fs.readFileSync(path.join(ROOT, ENGINE))), checkerSha256: hash(fs.readFileSync(__filename)),
      independentParentCheckerSha256: hash(fs.readFileSync(path.join(ROOT, 'scripts/check_portfolio_entry_research.cjs'))) }, null, 2));
  }
}
