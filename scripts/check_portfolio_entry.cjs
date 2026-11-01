#!/usr/bin/env node
'use strict';
// Offline independent audit of the fixed USD30/TQQQ30/CNY-cash40 reference.
// Run from any directory: node scripts/check_portfolio_entry.cjs
// Uses timing.curve for prices/prior-only MA200 percentiles only. Reconstructs
// monthly labels, neighbors, scores and replay statistics independently. No writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const Timing = require('../assets/portfolio-timing-model.js');
const DAY = 86400000, MIN_TRAINING = 36, NEIGHBORS = 24, TOLERANCE = 1e-8;
const periods = [
  { id: 'before2020', label: '2020年之前', start: null, end: '2019-12-31' },
  { id: '2020to2022', label: '2020—2022年', start: '2020-01-01', end: '2022-12-31' },
  { id: 'from2023', label: '2023年及之后', start: '2023-01-01', end: null }
];
const date = day => Date.parse(day + 'T00:00:00Z');
const gap = (a, b) => (date(b) - date(a)) / DAY;
function anniversary(day) {
  const d = new Date(date(day)), month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function bound(rows, target, selector = x => x, upper = false) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1, value = selector(rows[mid]);
    if (value < target || upper && value === target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * fraction, lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
}
function summary(rows) {
  const returns = rows.map(r => r.return).sort((a, b) => a - b);
  const drawdowns = rows.map(r => r.drawdown).sort((a, b) => a - b);
  let lastExit = '', nonOverlappingN = 0;
  for (const row of rows.slice().sort((a, b) => a.entry.localeCompare(b.entry))) {
    if (row.entry > lastExit) { nonOverlappingN++; lastExit = row.exit; }
  }
  return { n: rows.length, nonOverlappingN, median: quantile(returns, .5), p10: quantile(returns, .1),
    worstReturn: returns[0] ?? null, positiveRate: rows.length ? rows.filter(r => r.return > 0).length / rows.length * 100 : null,
    medianDrawdown: quantile(drawdowns, .5), p10Drawdown: quantile(drawdowns, .1), worstDrawdown: drawdowns[0] ?? null };
}
function createLabels(curve) {
  const endMonth = curve.at(-1).day.slice(0, 7);
  // Conservative source-month convention: the month containing the last saved
  // quote is excluded from monthly replay, even if today's calendar is later.
  // The latest saved quote still receives a separate current score.
  const monthly = curve.filter((row, i) => Number.isFinite(row.percentile) && row.day.slice(0, 7) < endMonth &&
    curve[i + 1]?.day.slice(0, 7) !== row.day.slice(0, 7));
  const samples = [];
  for (const signal of monthly) {
    const entryIndex = bound(curve, signal.day, row => row.day, true), entry = curve[entryIndex];
    if (!entry) continue;
    const target = anniversary(entry.day), exitIndex = bound(curve, target, row => row.day), exit = curve[exitIndex];
    if (!exit || gap(target, exit.day) > 14) continue;
    let peak = entry.value, drawdown = 0;
    for (let i = entryIndex; i <= exitIndex; i++) {
      peak = Math.max(peak, curve[i].value);
      drawdown = Math.min(drawdown, (curve[i].value / peak - 1) * 100);
    }
    samples.push({ signal: signal.day, entry: entry.day, exit: exit.day, percentile: signal.percentile,
      return: (exit.value / entry.value - 1) * 100, drawdown });
  }
  return { monthly, samples };
}
function predict(state, samples) {
  if (!Number.isFinite(state.percentile)) return null;
  const training = samples.filter(s => s.signal < state.day && s.exit <= state.day);
  if (training.length < MIN_TRAINING) return null;
  const sortedReturns = training.map(s => s.return).sort((a, b) => a - b);
  const ordered = training.map(s => ({ ...s, distance: Math.abs(s.percentile - state.percentile) }))
    .sort((a, b) => a.distance - b.distance || a.signal.localeCompare(b.signal));
  const boundary = ordered[NEIGHBORS - 1].distance;
  const neighbors = ordered.filter(s => s.distance <= boundary).map(s => ({ ...s,
    rank: (bound(sortedReturns, s.return) + bound(sortedReturns, s.return, x => x, true)) / (2 * training.length) * 100 }));
  // Averaging every training midrank is exactly50, including repeated outcomes.
  const value = neighbors.length === training.length ? 50 : neighbors.reduce((sum, s) => sum + s.rank, 0) / neighbors.length;
  return { day: state.day, value, trainingN: training.length, neighborN: neighbors.length, neighbors,
    matched: summary(neighbors), baseline: summary(training) };
}
function correlation(rows) {
  if (rows.length < 2) return null;
  const ranks = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    return values.map(value => (bound(sorted, value) + bound(sorted, value, x => x, true) + 1) / 2);
  };
  const x = ranks(rows.map(r => r.value)), y = ranks(rows.map(r => r.return));
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length, mx = mean(x), my = mean(y);
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < rows.length; i++) { const a = x[i] - mx, b = y[i] - my; xy += a * b; xx += a * a; yy += b * b; }
  return xx && yy ? xy / Math.sqrt(xx * yy) : null;
}
function evidence(rows) {
  const mae = field => rows.length ? rows.reduce((sum, r) => sum + Math.abs(r.return - r[field]), 0) / rows.length : null;
  return { baseline: summary(rows), rankingCorrelation: correlation(rows), predictionMAE: mae('predictionMedian'),
    baselineMAE: mae('baselineMedian'), errorN: rows.length,
    bands: [
      { id: 'low', ...summary(rows.filter(r => r.value < 40)) },
      { id: 'middle', ...summary(rows.filter(r => r.value >= 40 && r.value < 60)) },
      { id: 'high', ...summary(rows.filter(r => r.value >= 60)) }
    ] };
}
function independent(curve) {
  const { monthly, samples } = createLabels(curve), actual = new Map(samples.map(s => [s.signal, s]));
  const predictions = monthly.map(state => predict(state, samples)).filter(Boolean);
  const replay = predictions.filter(p => actual.has(p.day)).map(p => ({ ...actual.get(p.day), value: p.value,
    predictionMedian: p.matched.median, baselineMedian: p.baseline.median }));
  return { current: predict(curve.at(-1), samples), predictions, replay, samples, evidence: evidence(replay),
    periods: periods.map(period => ({ ...period, ...evidence(replay.filter(r => (!period.start || r.signal >= period.start) && (!period.end || r.signal <= period.end))) })) };
}
function close(actual, expected, context) {
  if (expected === null) assert.equal(actual, null, context);
  else assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= TOLERANCE, context + ': ' + actual + ' != ' + expected);
}
function checkSummary(actual, expected, context) {
  for (const key of Object.keys(expected)) close(actual[key], expected[key], context + '.' + key);
}
function checkEvidence(actual, expected, context) {
  checkSummary(actual.baseline, expected.baseline, context + '.baseline');
  for (const key of ['rankingCorrelation', 'predictionMAE', 'baselineMAE', 'errorN']) close(actual[key], expected[key], context + '.' + key);
  for (const band of expected.bands) {
    const { id, ...stats } = band;
    checkSummary(actual.bands.find(b => b.id === id), stats, context + '.' + id);
  }
}
function checkPrediction(actual, expected, context) {
  for (const key of ['value', 'trainingN', 'neighborN']) close(actual[key], expected[key], context + '.' + key);
  assert.deepEqual(actual.neighbors.map(n => n.signal), expected.neighbors.map(n => n.signal), context + '.selectedSignals');
  expected.neighbors.forEach((neighbor, i) => {
    for (const key of ['entry', 'exit']) assert.equal(actual.neighbors[i][key], neighbor[key], context + '.' + key);
    for (const key of ['percentile', 'return', 'drawdown', 'rank', 'distance']) close(actual.neighbors[i][key], neighbor[key], context + '.neighbor.' + key);
  });
  checkSummary(actual.matched, expected.matched, context + '.matched');
  checkSummary(actual.baseline, expected.baseline, context + '.baseline');
}

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(repo, 'data/portfolio/catalog.js'), 'utf8'), context);
const catalog = context.PORTFOLIO_CATALOG;
const assets = ['us:USD', 'us:TQQQ'].map(id => catalog.assets.find(a => a.id === id));
const histories = {}, sources = [...assets, catalog.fx].map(asset => {
  assert.ok(asset?.historyUrl && asset.sha256, 'missing input identity');
  const text = fs.readFileSync(path.join(repo, asset.historyUrl), 'utf8');
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(digest, asset.sha256, asset.id + ' history hash');
  histories[asset.id] = JSON.parse(text);
  return { id: asset.id, first: asset.first, asOf: asset.asOf, path: asset.historyUrl, sha256: digest };
});
const sourceEnd = sources.map(s => s.asOf).sort()[0];
const input = { catalog: { assets, fx: catalog.fx }, histories, fxHistory: histories[catalog.fx.id],
  config: { positions: assets.map(a => ({ id: a.id, weight: 30 })), currency: 'CNY', initial: 100, monthly: 0,
    rebalance: 'none', transactionFee: 0, feeBasis: 'net', years: 'common' } };
// Audit at the saved quote date, so rerunning later does not silently turn a
// historical numerical comparison into a real-time freshness check.
const timing = Timing.analyze(input, { today: sourceEnd });
assert.ok(timing.curve?.length, timing.missing);
const result = independent(timing.curve);
assert.ok(result.current, 'saved portfolio has insufficient training data');

// The implementation under review is called only after independent results exist.
const Entry = require('../assets/portfolio-entry-model.js');
const model = Entry.analyze(timing);
assert.equal(model.status, 'available', model.missing);
checkPrediction(model, result.current, 'current');
const modelPredictions = model.history.filter(p => Number.isFinite(p.value));
assert.equal(modelPredictions.length, result.predictions.length, 'monthly prediction count');
result.predictions.forEach((prediction, i) => {
  assert.equal(modelPredictions[i].day, prediction.day, 'monthly date');
  checkPrediction(modelPredictions[i], prediction, prediction.day);
});
checkEvidence(model.walkForward, result.evidence, 'all replay');
for (const period of result.periods) {
  const actual = model.walkForward.periods.find(p => p.id === period.id);
  assert.ok(actual, period.id); assert.equal(actual.start, period.start); assert.equal(actual.end, period.end);
  checkEvidence(actual, period, period.id);
}
const causalChecks = [];
for (const cutoff of ['2019-12-31', '2022-12-30', '2024-12-31']) {
  const prefix = independent(timing.curve.filter(r => r.day <= cutoff));
  const fullByDay = new Map(result.predictions.map(p => [p.day, p]));
  for (const prediction of prefix.predictions) assert.deepEqual(prediction, fullByDay.get(prediction.day), 'future append changed ' + prediction.day);
  const mutated = independent(timing.curve.map(r => r.day > cutoff ? { ...r, value: r.value * 100, percentile: 100 - r.percentile } : r));
  const mutatedByDay = new Map(mutated.predictions.map(p => [p.day, p]));
  for (const prediction of result.predictions.filter(p => p.day <= cutoff)) assert.deepEqual(prediction, mutatedByDay.get(prediction.day), 'future mutation changed ' + prediction.day);
  causalChecks.push({ cutoff, prefixPredictions: prefix.predictions.length, futureAppendAndMutationInvariant: true });
}
const sameStates = result.samples.slice(0, 36).map(s => ({ ...s, percentile: 50 }));
const samePrediction = predict({ day: timing.end, percentile: 50 }, sameStates);
assert.equal(samePrediction.neighborN, 36); assert.equal(samePrediction.value, 50);
close(Entry.predict({ day: timing.end, percentile: 50 }, sameStates).value, 50, 'identical states');
console.log(JSON.stringify({ ok: true, tolerance: TOLERANCE, method: '24 nearest states including boundary ties; >=36 matured training months; one-year return midrank mean',
  portfolio: { positions: input.config.positions, currency: 'CNY', cashWeight: 40 },
  source: { first: timing.first, end: timing.end, observations: timing.curve.length, histories: sources },
  monthRule: 'exclude latest saved quote month from monthly replay; score latest close separately',
  latest: { day: timing.end, statePercentile: timing.latest.percentile, value: result.current.value, trainingN: result.current.trainingN,
    neighborN: result.current.neighborN, matched: result.current.matched, baseline: result.current.baseline },
  walkForward: { predictionN: result.predictions.length, firstPrediction: result.predictions[0]?.day,
    lastMaturedSignal: result.replay.at(-1)?.signal, ...result.evidence, periods: result.periods },
  causalChecks, sameStateScore: 50, validation: 'historical_replay_not_genuine_unseen_holdout' }));
