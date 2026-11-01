#!/usr/bin/env node
'use strict';
// Independent SSI auditor: direct CSV shares, monthly endpoint differences,
// explicit mature rows, closed-form one-variable ridge and per-deposit claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Source = require('./check_portfolio_entry_research.cjs');
const Scope = require('./check_portfolio_entry_scope.cjs');
const Value = require('./check_portfolio_entry_value.cjs');
const ROOT = path.resolve(__dirname, '..'), PROTOCOL = 'docs/research/portfolio-entry-ssi-protocol-v5.json';
const ENGINE = 'scripts/research_portfolio_entry_ssi.cjs', MODEL = 'expanding_monthly_ssi_ridge_year1_delay5';
const FROZEN_PROTOCOL_SHA = '943b6356c8826cb149d6d9aa9fcb9c18eac48730006257dac46565b54f7a64c9';
const SYMBOLS = ['SSO', 'QLD', 'DDM', 'SDS', 'QID', 'DXD'];
const EPS = 1e-8, PP = 1e-10, MIN = 36, DAY = 86400000;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const sum = xs => xs.reduce((s, x) => s + x, 0), mean = xs => xs.length ? sum(xs) / xs.length : null;
const finite = Number.isFinite, positive = x => finite(x) && x > PP, ge = (x, limit) => finite(x) && x >= limit - PP;
const time = day => Date.parse(day + 'T00:00:00Z');
const monthNumber = day => +day.slice(0, 4) * 12 + +day.slice(5, 7) - 1;
const monthName = n => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
function close(actual, expected, label, errors) {
  if (expected === null) return assert.equal(actual, null, label);
  assert.ok(finite(actual) && finite(expected) && Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
  if (errors) { const key = label.split('.').at(-1); errors[key] = Math.max(errors[key] || 0, Math.abs(actual - expected)); }
}
function subset(actual, expected, label, errors) {
  if (expected === null || typeof expected === 'number') return close(actual, expected, label, errors);
  if (Array.isArray(expected)) { assert.ok(Array.isArray(actual), label); assert.equal(actual.length, expected.length, label); expected.forEach((v, i) => subset(actual[i], v, label + '.' + i, errors)); return; }
  if (typeof expected === 'object') { assert.ok(actual && typeof actual === 'object', label); for (const [k, v] of Object.entries(expected)) subset(actual[k], v, label + '.' + k, errors); return; }
  assert.equal(actual, expected, label);
}
function unique(rows, key, label) { const map = new Map(); for (const r of rows) { const id = key(r); assert.ok(!map.has(id), label + ': duplicate ' + id); map.set(id, r); } return map; }
function csvRows(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (c === '"') quoted = false; else value += c; }
    else if (c === '"') { assert.equal(value, '', 'quote must start a field'); quoted = true; }
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ''; }
    else value += c;
  }
  assert.equal(quoted, false, 'unterminated CSV quote');
  if (value || row.length) { row.push(value); rows.push(row); }
  const header = rows.shift(); assert.ok(header); header[0] = header[0].replace(/^\uFEFF/, '');
  assert.equal(new Set(header).size, header.length);
  return rows.map(values => { assert.equal(values.length, header.length); return Object.fromEntries(header.map((key, i) => [key, values[i]])); });
}
function parseShares(text, symbol) {
  const rows = csvRows(text).map(r => {
    assert.equal(r.Ticker, symbol); const parts = r.Date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); assert.ok(parts);
    const day = `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    assert.equal(new Date(time(day)).toISOString().slice(0, 10), day);
    const shares = Number(r['Shares Outstanding (000)']); assert.ok(finite(shares) && shares > 0);
    return { day, shares };
  }).sort((a, b) => a.day.localeCompare(b.day));
  unique(rows, r => r.day, 'daily shares ' + symbol); return rows;
}
function monthlyShares(histories) {
  const ends = new Map(SYMBOLS.map(symbol => [symbol, new Map()])), months = new Set();
  for (const symbol of SYMBOLS) for (const row of histories.get(symbol)) {
    const month = row.day.slice(0, 7), old = ends.get(symbol).get(month); months.add(month);
    if (!old || row.day > old.day) ends.get(symbol).set(month, row);
  }
  const output = new Map();
  for (const month of [...months].sort()) {
    const prior = monthName(monthNumber(month) - 1), sourceDates = {}, priorDates = {}, growth = {};
    let reason = null;
    for (const symbol of SYMBOLS) {
      const a = ends.get(symbol).get(prior), b = ends.get(symbol).get(month);
      sourceDates[symbol] = b?.day ?? null; priorDates[symbol] = a?.day ?? null;
      if (!a || !b || !finite(a.shares) || !finite(b.shares) || a.shares <= 0 || b.shares <= 0) { reason = 'missing_or_invalid_endpoint'; growth[symbol] = null; }
      else growth[symbol] = b.shares / a.shares - 1;
    }
    if (!reason && (new Set(Object.values(sourceDates)).size !== 1 || new Set(Object.values(priorDates)).size !== 1)) reason = 'asynchronous_month_endpoints';
    const value = reason ? null : sum(SYMBOLS.slice(0, 3).map(s => growth[s])) - sum(SYMBOLS.slice(3).map(s => growth[s]));
    if (value !== null && !finite(value)) reason = 'nonfinite_ssi';
    output.set(month, { month, value: reason ? null : value, sourceDates, priorDates, growth, reason });
  }
  return output;
}
function featureInput(market, monthly, t, extra = 0) {
  const currentMonth = market[t].day.slice(0, 7), featureMonth = monthName(monthNumber(currentMonth) - 1), row = monthly.get(featureMonth);
  const first = market.findIndex(r => r.day.slice(0, 7) === currentMonth), availableIndex = first + extra;
  const available = Boolean(row && row.reason === null && finite(row.value) && availableIndex <= t);
  return { featureMonth, featureValue: row?.value ?? null, inputAvailable: available,
    sourceDates: row?.sourceDates ?? null, priorDates: row?.priorDates ?? null, availableIndex,
    assumedFeatureAvailableSession: market[availableIndex]?.day ?? null,
    reason: !row ? 'missing_ssi_month' : row.reason || (availableIndex > t ? 'ssi_not_yet_available' : null) };
}
function annualOutcome(market, s, portfolio) {
  const anniversary = Scope.anniversary(market[s].day, 1), end = market.findIndex(r => r.day >= anniversary);
  if (end < 0 || end < s + 5 || (time(market[end].day) - time(anniversary)) / DAY > 14) return null;
  // Difference of two independent terminal purchase claims, divided by full funding.
  const wealth = entry => sum(portfolio.positions.map((p, j) => p.weight / 1.001 / market[entry].prices[j] * market[end].prices[j] * .999));
  const y = wealth(s + 5) - wealth(s); assert.ok(finite(y));
  return { entryIndex: s, entryDay: market[s].day, exitIndex: end, exitDay: market[end].day, anniversary, y };
}
function trainingEvents(market, monthly, portfolio) {
  const rows = [];
  for (const arrival of Scope.arrivalCalendar(market, 1)) {
    if (arrival.index === null || arrival.index === 0) continue;
    const input = featureInput(market, monthly, arrival.index), outcome = annualOutcome(market, arrival.index, portfolio);
    if (input.inputAvailable && outcome) rows.push({ ...outcome, x: input.featureValue, featureMonth: input.featureMonth, sourceDates: input.sourceDates, priorDates: input.priorDates });
  }
  assert.equal(new Set(rows.map(r => r.entryDay.slice(0, 7))).size, rows.length);
  return rows.sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex);
}
function closedFit(rows) {
  const featureMean = mean(rows.map(r => r.x)), trainingMeanY = mean(rows.map(r => r.y));
  const featurePopulationSd = Math.sqrt(mean(rows.map(r => (r.x - featureMean) ** 2)));
  const beta = featurePopulationSd ? mean(rows.map(r => (r.x - featureMean) / featurePopulationSd * (r.y - trainingMeanY))) / 2 : 0;
  return { featureMean, featurePopulationSd, beta, trainingMeanY };
}
function predict(market, monthly, queue, t) {
  const rows = queue.filter(r => r.exitIndex < t), last = rows.at(-1), input = featureInput(market, monthly, t);
  const header = { day: market[t].day, executionDay: market[t].day, priceLabelCutoffDay: market[t - 1]?.day ?? null,
    trainingN: rows.length, latestTrainingEntry: last?.entryDay ?? null, latestTrainingExit: last?.exitDay ?? null,
    ...input, labelHoldingYears: 1 };
  const fit = rows.length >= MIN ? closedFit(rows) : null, fitReady = Boolean(fit && Object.values(fit).every(finite));
  if (!fitReady) return { ...header, fitReady: false, actionAvailable: false, predictedY: null, predictedFullDepositBps: null, offset: null };
  if (!input.inputAvailable) return { ...header, ...fit, fitReady: true, actionAvailable: true, predictedY: null, predictedFullDepositBps: null, offset: 0 };
  const z = fit.featurePopulationSd ? (input.featureValue - fit.featureMean) / fit.featurePopulationSd : 0;
  const predictedY = fit.trainingMeanY + fit.beta * z;
  if (!finite(predictedY)) return { ...header, ...fit, fitReady: false, actionAvailable: false, predictedY: null, predictedFullDepositBps: null, offset: null };
  return { ...header, ...fit, fitReady: true, actionAvailable: true, predictedY, predictedFullDepositBps: predictedY * 10000, offset: predictedY > 1e-12 ? 5 : 0 };
}
function reconstruct(market, histories, portfolio) {
  const monthly = monthlyShares(histories), queue = trainingEvents(market, monthly, portfolio);
  return { monthly, queue, predictions: market.map((_, t) => predict(market, monthly, queue, t)) };
}
function cancellation(market, monthly, predictions) {
  return predictions.map((p, t) => {
    const input = featureInput(market, monthly, t, 1), delayed = p.fitReady && p.inputAvailable && !input.inputAvailable;
    return { ...p, availableIndex: input.availableIndex, inputAvailable: input.inputAvailable, assumedFeatureAvailableSession: input.assumedFeatureAvailableSession,
      predictedY: delayed ? null : p.predictedY, predictedFullDepositBps: delayed ? null : p.predictedFullDepositBps,
      offset: delayed ? 0 : p.offset, inputDelayedByDiagnostic: delayed, cancelledBaseDelay: delayed && p.offset === 5 };
  });
}
function episodesFor(market, predictions, parent, calendarDay, evaluation, years) {
  const calendar = Scope.arrivalCalendar(market, calendarDay), byMonth = new Map(calendar.map(r => [r.month, r])), count = evaluation === 'equal_age_lot' ? 1 : 12;
  const episodes = [], rejected = [];
  for (const first of calendar) {
    const funding = Array.from({ length: count }, (_, i) => byMonth.get(monthName(monthNumber(first.month) + i)));
    let reason = null;
    if (first.index === null) reason = 'missing_first_arrival';
    else if (!predictions[first.index]?.actionAvailable) reason = 'prediction_unavailable_at_start';
    else if (funding.some(r => !r || r.index === null)) reason = 'missing_required_month';
    else if (funding.some(r => !predictions[r.index]?.actionAvailable)) reason = 'prediction_unavailable_on_funding_date';
    if (reason) { rejected.push({ month: first.month, reason }); continue; }
    const phase = parent.episodes.partitions.find(p => (!p.start || first.day >= p.start) && (!p.end || first.day <= p.end)), anchor = funding.at(-1).day;
    const anniversary = Scope.anniversary(anchor, years), end = market.findIndex(r => r.day >= anniversary);
    if (!phase) reason = 'outside_registered_partitions';
    else if (end < 0) reason = 'terminal_outcome_unmatured';
    else if ((time(market[end].day) - time(anniversary)) / DAY > 14) reason = 'terminal_close_more_than_14_calendar_days_late';
    else if (phase.end && market[end].day > phase.end) reason = 'complete_outcome_crosses_partition';
    if (reason) { rejected.push({ month: first.month, reason }); continue; }
    episodes.push({ calendarDay, evaluation, years, start: first.day, startIndex: first.index, end: market[end].day, endIndex: end, anniversary,
      lastFundingDay: anchor, partition: phase.id, depositCount: count, fundingPlan: funding.map(r => ({ day: r.day, index: r.index, amount: 100, requestedDay: r.requestedDay })) });
  }
  return { calendar, episodes, rejected };
}
function account(market, episode, rule, scenario, portfolio, predictions) {
  // Reuse only the independently audited cash-claim evaluator's selector.
  // Both policies have a genuine scalar 0/5 order; no old fit or label is used.
  return Scope.account(market, episode, rule.id === MODEL ? { id: 'expanding_ridge_delay5' } : rule, scenario, portfolio, predictions);
}
function readInputs() {
  const bytes = fs.readFileSync(path.join(ROOT, PROTOCOL)), protocol = JSON.parse(bytes);
  assert.equal(sha(bytes), FROZEN_PROTOCOL_SHA); assert.equal(protocol.status, 'frozen_before_any_v5_labels_predictions_or_outcomes');
  assert.equal(protocol.model.id, MODEL); assert.equal(protocol.model.minimumMatureLabels, MIN); assert.equal(protocol.model.ridgeLambda, 1);
  for (const dependency of protocol.frozenDependencies) assert.equal(sha(fs.readFileSync(path.join(ROOT, dependency.path))), dependency.sha256, dependency.path);
  const source = Source.readInputs(), histories = new Map(), shareFingerprints = [];
  for (const input of protocol.ssiSource.historyFiles) {
    const data = fs.readFileSync(input.localPath); assert.equal(sha(data), input.sha256, input.id);
    const rows = parseShares(data.toString(), input.id); assert.equal(rows.length, input.rows); assert.equal(rows[0].day, input.first); assert.equal(rows.at(-1).day, input.last);
    histories.set(input.id, rows); shareFingerprints.push({ id: input.id, path: input.localPath, sha256: sha(data) });
  }
  assert.deepEqual([...histories.keys()].sort(), [...SYMBOLS].sort());
  assert.equal(source.market.length, protocol.sourceSnapshot.commonObservations);
  assert.equal(sha(JSON.stringify(source.market.map(r => r.day))), protocol.sourceSnapshot.marketCalendarSha256);
  assert.equal(sha(JSON.stringify(source.market.map(({ day, prices }) => ({ day, prices })))), protocol.sourceSnapshot.actualCnyPriceRowsSha256);
  const prior = JSON.parse(fs.readFileSync(path.join(ROOT, protocol.sourceSnapshot.evidencePath)));
  assert.equal(sha(JSON.stringify(prior.inputs.sourceSnapshot)), protocol.sourceSnapshot.sourceSnapshotSha256);
  return { ...source, parent: source.protocol, protocol, histories, shareFingerprints, protocolSha256: sha(bytes), sourceSnapshot: prior.inputs.sourceSnapshot };
}
function selfTest() {
  const checks = [], test = (name, fn) => { fn(); checks.push(name); };
  test('CSV quotes, thousands shares and last actual monthly endpoint', () => {
    const rows = parseShares('Date,Ticker,Name,Shares Outstanding (000)\r\n02/28/2020,SSO,"A, B",120\r\n01/31/2020,SSO,A,100\r\n01/30/2020,SSO,A,90\r\n', 'SSO');
    const h = new Map(SYMBOLS.map(s => [s, rows.map(r => ({ ...r, shares: s === 'SSO' ? r.shares : 100 }))]));
    const x = monthlyShares(h).get('2020-02'); close(x.value, .2, 'one long growth'); assert.equal(x.priorDates.SSO, '2020-01-31');
    h.set('DXD', rows.map(r => ({ ...r, day: r.day === '2020-02-28' ? '2020-02-27' : r.day, shares: 100 })));
    assert.equal(monthlyShares(h).get('2020-02').value, null);
  });
  test('missing prior month cannot be bridged and short shares subtract', () => {
    const h = new Map(SYMBOLS.map(s => [s, [{ day: '2020-01-31', shares: 100 }, { day: '2020-03-31', shares: s === 'DXD' ? 110 : 100 }]]));
    assert.equal(monthlyShares(h).get('2020-03').value, null);
    for (const rows of h.values()) rows.push({ day: '2020-02-28', shares: 100 });
    close(monthlyShares(h).get('2020-03').value, -.1, 'short sign');
  });
  test('closed form mean-loss ridge uses population SD and free intercept', () => {
    const rows = Array.from({ length: 36 }, (_, i) => ({ x: i % 2 ? 1 : -1, y: i % 2 ? 5 : 1 })), fit = closedFit(rows);
    assert.deepEqual(fit, { featureMean: 0, featurePopulationSd: 1, beta: 1, trainingMeanY: 3 });
    const flat = closedFit(rows.map(r => ({ ...r, x: 7 }))); assert.equal(flat.beta, 0); assert.equal(flat.trainingMeanY, 3);
  });
  const market = [];
  for (let ms = time('2010-01-01'); market.length < 1600; ms += DAY) { const d = new Date(ms); if ([0, 6].includes(d.getUTCDay())) continue; const i = market.length; market.push({ day: d.toISOString().slice(0, 10), prices: [100 * Math.exp(.0001 * i + .02 * Math.sin(i / 13)), 80 * Math.exp(.0002 * i + .03 * Math.cos(i / 17))] }); }
  const portfolio = { strategicCashWeight: .4, positions: [{ id: 'a', weight: .3 }, { id: 'b', weight: .3 }] };
  const histories = new Map(SYMBOLS.map((s, j) => [s, [{ day: '2009-12-31', shares: 100 }, ...market.map((r, i) => ({ day: r.day, shares: 100 * Math.exp(.0001 * i * (j + 1) + .1 * Math.sin(i / (9 + j))) }))]]));
  const own = reconstruct(market, histories, portfolio), first = own.predictions.findIndex(p => p.fitReady);
  test('unique monthly labels, no price warmup and strict annual maturity', () => {
    assert.ok(own.queue[0].entryIndex < 200 && own.queue[0].entryIndex > 0);
    assert.equal(new Set(own.queue.map(r => r.entryDay.slice(0, 7))).size, own.queue.length);
    assert.equal(own.predictions[first - 1].trainingN, 35); assert.equal(own.predictions[first].trainingN, 36);
    assert.ok(own.predictions[first].latestTrainingExit < market[first].day);
    assert.equal(own.predictions.at(-1).fitReady, true); assert.equal(annualOutcome(market, market.length - 1, portfolio), null);
  });
  test('fit-ready missing current SSI falls back with a null forecast and retained action', () => {
    const changed = new Map(own.monthly); changed.delete(own.predictions[first].featureMonth);
    const p = predict(market, changed, own.queue, first); assert.equal(p.fitReady, true); assert.equal(p.actionAvailable, true); assert.equal(p.inputAvailable, false); assert.equal(p.predictedY, null); assert.equal(p.offset, 0);
    assert.ok(annualOutcome(market, first, portfolio), 'price-only evaluation label survives missing SSI');
  });
  test('one-extra-session publication cancellation preserves fits and primary zero actions', () => {
    const delayed = cancellation(market, own.monthly, own.predictions);
    for (const a of Scope.arrivalCalendar(market, 1).filter(a => a.index !== null && own.predictions[a.index].fitReady)) {
      const p = delayed[a.index], base = own.predictions[a.index]; assert.equal(p.offset, 0); assert.equal(p.predictedY, null); assert.equal(p.beta, base.beta); assert.equal(p.trainingN, base.trainingN); assert.equal(p.inputDelayedByDiagnostic, true); assert.equal(p.cancelledBaseDelay, base.offset === 5);
    }
  });
  test('current/future prices and future monthly shares cannot alter the current decision', () => {
    const t = first + 80, expected = own.predictions[t];
    const changedPrices = market.map((r, i) => ({ ...r, prices: i >= t ? [r.prices[0] * 81, r.prices[1] * .017] : r.prices.slice() }));
    assert.deepEqual(reconstruct(changedPrices, histories, portfolio).predictions[t], expected);
    const changedShares = new Map([...histories].map(([s, rows]) => [s, rows.map(r => ({ ...r, shares: r.day >= market[t].day ? r.shares * 123 : r.shares }))]));
    assert.deepEqual(reconstruct(market, changedShares, portfolio).predictions[t], expected);
    assert.deepEqual(reconstruct(market.slice(0, t + 1), histories, portfolio).predictions[t], expected);
  });
  test('whole-deposit annual label equals independent fee-aware fixed-wait account difference', () => {
    const label = own.queue[0], ep = { startIndex: label.entryIndex, endIndex: label.exitIndex, start: label.entryDay, end: label.exitDay, fundingPlan: [{ index: label.entryIndex, day: label.entryDay, amount: 100 }] };
    const scenario = { annualCashRate: 0, feeRate: .001, capitalTaxRate: 0, dividendTaxRate: 0 };
    const now = account(market, ep, { id: 'immediate', offsets: [0] }, scenario, portfolio, []), later = account(market, ep, { id: 'fixed_delay5', offsets: [5] }, scenario, portfolio, []);
    close(later.terminalWealth - now.terminalWealth, 100 * label.y, 'annual full-deposit identity');
  });
  test('empty evidence retains null outcomes and fails positive and nonnegative gates', () => {
    const empty = pair([], [], 12); assert.equal(empty.n, 0); assert.equal(empty.meanDeltaPp, null);
    assert.equal(empty.meanInterval.status, 'no_samples'); assert.equal(ge(null, 0), false); assert.equal(positive(null), false);
    assert.equal(positive(1e-10), false); assert.equal(positive(1.01e-10), true);
  });
  return { passed: true, cases: checks.length, checks };
}

// Generic summaries and gates copied from the independent v3 auditor, not the producer.
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

const { actionEvidence, concentration, primaryPass } = Value;
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


const windowKey = e => [e.calendarDay, e.evaluation, e.years, e.partition, e.start, e.end].join('/');
const groupKey = e => [e.calendarDay, e.evaluation, e.horizonYears, e.partition, e.scenario].join('/');
const ACCOUNT_FIELDS = ['terminalWealth', 'contributed', 'accountReturnPp', 'navReturnPp', 'maxDrawdownPp', 'fees', 'interest', 'pendingCash', 'pendingLots', 'meanWaitSessions'];
const PREDICTION_FIELDS = ['day', 'executionDay', 'priceLabelCutoffDay', 'labelHoldingYears', 'trainingN', 'latestTrainingEntry', 'latestTrainingExit', 'featureMonth',
  'featureValue', 'inputAvailable', 'assumedFeatureAvailableSession', 'fitReady', 'actionAvailable', 'predictedY', 'predictedFullDepositBps', 'offset'];
function predictionView(p) {
  const nullDates = Object.fromEntries(SYMBOLS.map(s => [s, null]));
  return { ...Object.fromEntries(PREDICTION_FIELDS.map(k => [k, p[k]])), sixSourceMonthEndDates: p.sourceDates || nullDates,
    sixPriorMonthEndDates: p.priorDates || nullDates, assumedFeatureAvailableIndex: p.availableIndex,
    ...Object.fromEntries(['featureMean', 'featurePopulationSd', 'beta', 'trainingMeanY'].map(k => [k, p[k] ?? null])) };
}
function compareAccount(actual, expected, name, errors, trace) {
  for (const field of ACCOUNT_FIELDS) close(actual[field], expected[field], name + '.' + field, errors);
  assert.deepEqual(actual.externalFlows, expected.externalFlows, name + '.externalFlows');
  subset(actual.contributionAttribution, expected.contributionAttribution, name + '.contributionAttribution');
  for (const field of ['terminalWealth', 'fees', 'interest', 'pendingCash']) close(sum(actual.contributionAttribution.map(r => r[field])), actual[field], name + '.attribution sum ' + field);
  const key = r => [r.day, r.side, r.id, r.arrivalDay || ''].join('/');
  const a = [...actual.trades].sort((x, y) => key(x).localeCompare(key(y))), b = [...expected.trades].sort((x, y) => key(x).localeCompare(key(y)));
  subset(a, b, name + '.trades');
  if (actual.rule === MODEL) for (const trade of actual.trades.filter(t => t.side === 'buy')) {
    const p = trace.find(r => r.day === trade.arrivalDay); assert.ok(p);
    subset(trade, { decisionDay: p.day, priceLabelCutoffDay: p.priceLabelCutoffDay, featureMonth: p.featureMonth,
      sixSourceMonthEndDates: p.sixSourceMonthEndDates, sixPriorMonthEndDates: p.sixPriorMonthEndDates,
      assumedFeatureAvailableSession: p.assumedFeatureAvailableSession, featureValue: p.featureValue, fitReady: p.fitReady,
      inputAvailable: p.inputAvailable, actionAvailable: p.actionAvailable, predictedY: p.predictedY,
      predictedFullDepositBps: p.predictedFullDepositBps, trainingN: p.trainingN, latestTrainingEntry: p.latestTrainingEntry,
      latestTrainingExit: p.latestTrainingExit, trainingPoolSha256: p.trainingPoolSha256, labelHoldingYears: 1,
      offset: p.offset, missingReason: p.missingReason, fallbackReason: p.fallbackReason,
      reason: p.fallbackReason ? 'monthly_ssi_immediate_fallback' : 'locked_monthly_ssi_annual_value_prediction' }, name + '.trade provenance');
    if (p.sensitivity) subset(trade, { sensitivity: p.sensitivity, inputDelayedByDiagnostic: p.inputDelayedByDiagnostic, cancelledBaseDelay: p.cancelledBaseDelay, baseOffset: p.baseOffset }, name + '.sensitivity provenance');
    assert.ok(!('featureDay' in trade) && !('signalDay' in trade), 'SSI provenance must not fabricate a price-feature day');
  }
}
function decisionCoverage(episodes, predictions) {
  const byDay = new Map();
  for (const episode of episodes) for (const flow of episode.fundingPlan) {
    if (byDay.has(flow.day)) { byDay.get(flow.day).occurrencesInAccounts++; continue; }
    const p = predictions[flow.index];
    byDay.set(flow.day, { day: flow.day, fitReady: p.fitReady, inputAvailable: p.inputAvailable, actionAvailable: p.actionAvailable,
      featureMonth: p.featureMonth, trainingN: p.trainingN, latestTrainingExit: p.latestTrainingExit, offset: p.offset,
      predictedY: p.predictedY, occurrencesInAccounts: 1,
      ...(p.inputDelayedByDiagnostic !== undefined ? { inputDelayedByDiagnostic: p.inputDelayedByDiagnostic, cancelledBaseDelay: p.cancelledBaseDelay } : {}) });
  }
  const dates = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { uniqueArrivalDecisions: dates.length, delayedUniqueDecisions: dates.filter(r => r.offset === 5).length,
    fallbackUniqueDecisions: dates.filter(r => r.fitReady && !r.inputAvailable).length,
    inputDelayedByDiagnosticUniqueDecisions: dates.filter(r => r.inputDelayedByDiagnostic).length,
    cancelledBaseDelayUniqueDecisions: dates.filter(r => r.cancelledBaseDelay).length, dates };
}
function diagnostics(rows) {
  const usable = rows.filter(r => r.inputAvailable && finite(r.predictedY)), acted = usable.filter(r => r.offset === 5);
  const errors = usable.map(r => r.predictedY - r.actualY), reference = usable.map(r => r.trainingMeanY - r.actualY);
  const mse = mean(errors.map(x => x * x)), referenceMSE = mean(reference.map(x => x * x));
  return { distinctMonthDecisions: usable.length, delayedMonthDecisions: acted.length, maturedAnnualLabels: usable.length,
    meanRealizedWaitingAdvantageOfDelayedDecisions: mean(acted.map(r => r.actualY)), MAE: mean(errors.map(Math.abs)), MSE: mse,
    referenceMAE: mean(reference.map(Math.abs)), referenceMSE, R2: referenceMSE > 0 ? 1 - mse / referenceMSE : null,
    eligiblePrimaryMonths: rows.length, availableForecastMonths: usable.length, fallbackMonths: rows.length - usable.length,
    fallbackDates: rows.filter(r => !r.inputAvailable).map(r => ({ day: r.start, deltaPp: r.deltaPp })),
    dates: usable.map(r => ({ day: r.start, end: r.end, offset: r.offset, deltaPp: r.deltaPp, trainingN: r.trainingN,
      latestTrainingExit: r.latestTrainingExit, predictedY: r.predictedY, predictedFullDepositBps: r.predictedFullDepositBps,
      referenceForecast: r.trainingMeanY, actualY: r.actualY })) };
}
function verifySources(report, ledger, loaded) {
  const { protocol, market } = loaded;
  for (const output of [report, ledger]) {
    assert.equal(output.protocolId, protocol.id); assert.equal(output.inputs.protocol.sha256, FROZEN_PROTOCOL_SHA);
    assert.deepEqual(output.inputs.frozenDependencies, protocol.frozenDependencies);
    assert.equal(output.inputs.researchEngine.path, ENGINE); assert.equal(output.inputs.researchEngine.sha256, sha(fs.readFileSync(path.join(ROOT, ENGINE))));
    assert.deepEqual(output.inputs.sourceSnapshot, loaded.sourceSnapshot);
    assert.equal(output.inputs.marketCalendarSha256, protocol.sourceSnapshot.marketCalendarSha256);
    assert.equal(output.inputs.actualCnyPriceRowsSha256, protocol.sourceSnapshot.actualCnyPriceRowsSha256);
    assert.equal(output.inputs.commonObservations, market.length);
    for (const entry of output.inputs.implementationDependencies) assert.equal(entry.sha256, sha(fs.readFileSync(path.join(ROOT, entry.path))), entry.path);
    for (const entry of protocol.ssiSource.historyFiles) subset(output.inputs.shareSources.find(r => r.id === entry.id), entry, 'SSI source');
    for (const [field, value] of [['monthlySsiSha256', report.monthlySsi], ['trainingLabelsSha256', report.trainingLabels], ['maturityQueueSha256', report.maturityQueue],
      ['evaluationLabelsSha256', report.evaluationLabels], ['predictionTraceSha256', report.dailyPredictions]]) assert.equal(output.inputs[field], sha(JSON.stringify(value)), field);
  }
  for (const [ledgerField, reportField] of [['monthlySsi', 'monthlySsi'], ['trainingLabels', 'trainingLabels'], ['maturityQueue', 'maturityQueue'],
    ['evaluationLabels', 'evaluationLabels'], ['predictions', 'dailyPredictions']]) assert.deepEqual(ledger[ledgerField], report[reportField]);
  assert.deepEqual(ledger.publicationSensitivity.predictions, report.publicationSensitivity.predictions);
  const stats = { monthlySsi: report.monthlySsi, trainingLabels: report.trainingLabels, maturityQueue: report.maturityQueue, evaluationLabels: report.evaluationLabels,
    dailyPredictions: report.dailyPredictions, results: report.results, coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows,
    primaryPredictionDiagnostics: report.primaryPredictionDiagnostics, publicationSensitivity: report.publicationSensitivity, decision: report.decision };
  assert.equal(report.statisticsSha256, sha(JSON.stringify(stats)), 'published statistics fingerprint');
}
function verifyModel(report, loaded, model) {
  const { market, protocol, histories, parent } = loaded, { monthly, queue, predictions } = model;
  const errors = {}, trace = report.dailyPredictions, suppliedMonths = unique(report.monthlySsi, r => r.month, 'monthly SSI');
  assert.equal(suppliedMonths.size, monthly.size);
  for (const [month, row] of monthly) {
    const actual = suppliedMonths.get(month); assert.ok(actual);
    subset(actual, { month, previousMonth: monthName(monthNumber(month) - 1), value: row.value,
      sixSourceMonthEndDates: row.sourceDates, sixPriorMonthEndDates: row.priorDates, growthFractionByFund: row.growth }, 'monthly SSI ' + month, errors);
    assert.equal(Boolean(actual.missingReason), Boolean(row.reason), 'monthly validity');
    for (const symbol of SYMBOLS) {
      close(actual.sourceSharesThousands[symbol], histories.get(symbol).find(r => r.day === row.sourceDates[symbol])?.shares ?? null, 'displayed current shares');
      close(actual.priorSharesThousands[symbol], histories.get(symbol).find(r => r.day === row.priorDates[symbol])?.shares ?? null, 'displayed prior shares');
    }
  }
  assert.equal(report.maturityQueue.length, queue.length); assert.equal(report.trainingLabels.length, queue.length);
  const byEntry = unique(report.trainingLabels, r => r.entryIndex, 'training labels');
  assert.deepEqual(report.trainingLabels.map(r => r.entryIndex), [...byEntry.keys()].sort((a, b) => a - b));
  for (const [i, event] of queue.entries()) {
    const expected = { entryIndex: event.entryIndex, entryDay: event.entryDay, exitIndex: event.exitIndex, exitDay: event.exitDay,
      anniversary: event.anniversary, y: event.y, trainingMonth: event.entryDay.slice(0, 7), featureMonth: event.featureMonth,
      sixSourceMonthEndDates: event.sourceDates, sixPriorMonthEndDates: event.priorDates,
      assumedFeatureAvailableSession: market[event.entryIndex].day, features: [event.x] };
    subset(report.maturityQueue[i], expected, 'monthly annual label ' + i, errors);
    assert.deepEqual(report.maturityQueue[i], byEntry.get(event.entryIndex));
    assert.deepEqual(Object.keys(report.maturityQueue[i]).sort(), Object.keys(expected).sort(), 'full lineage label fields');
  }
  const evaluationIndices = new Set([1, 10, 20].flatMap(d => Scope.arrivalCalendar(market, d).filter(r => r.index !== null).map(r => r.index)));
  assert.equal(report.evaluationLabels.length, market.length); let evaluationN = 0;
  for (let t = 0; t < market.length; t++) {
    const expected = evaluationIndices.has(t) ? annualOutcome(market, t, parent.portfolio) : null;
    subset(report.evaluationLabels[t], expected, 'price-only evaluation label ' + t, errors); if (expected) evaluationN++;
  }
  assert.equal(trace.length, predictions.length);
  let pointer = 0, chain = sha(''), readyN = 0, multiMaturityDays = 0;
  for (let t = 0; t < market.length; t++) {
    const before = pointer;
    while (pointer < queue.length && queue[pointer].exitIndex < t) { chain = sha(chain + '\n' + JSON.stringify(report.maturityQueue[pointer])); pointer++; }
    const actual = trace[t], expected = predictions[t];
    assert.equal(actual.decisionClockConvention, 'One hour before the scheduled US equity market close on the actual common funding session, including early-close sessions; declared convention, not an observed publication timestamp.');
    subset(actual, predictionView(expected), 'independent daily fit ' + market[t].day, errors);
    subset(actual, { trainingPoolSha256: chain, trainingQueuePrefixLength: pointer, newlyMatureLabels: pointer - before }, 'mature prefix ' + t);
    assert.equal(Boolean(actual.fallbackReason), expected.fitReady && !expected.inputAvailable);
    if (expected.fitReady && expected.inputAvailable) assert.equal(actual.missingReason, null);
    if (!expected.fitReady) assert.ok(actual.missingReason);
    if (pointer - before > 1) multiMaturityDays++;
    if (expected.fitReady) { readyN++; assert.ok(actual.latestTrainingExit <= actual.priceLabelCutoffDay); }
  }
  const dateAudit = protocol.preOutcomeCalendarAudit;
  assert.equal(queue.length, dateAudit.trainingUniverseMonthsWithObservedAnnualEndpoints);
  assert.equal(queue[0].entryDay, dateAudit.firstTrainingEntry); assert.equal(queue[0].exitDay, dateAudit.firstTrainingExit);
  assert.equal(queue[35].entryDay, dateAudit.label36Entry); assert.equal(queue[35].exitDay, dateAudit.label36Exit);
  assert.equal(predictions.find(p => p.fitReady).day, dateAudit.firstPotentialPrediction);
  const firstMonthly = Scope.arrivalCalendar(market, 1).find(a => a.index !== null && predictions[a.index].fitReady);
  assert.equal(firstMonthly.day, dateAudit.firstNominal1PotentialPrediction);
  const sensitivity = cancellation(market, monthly, predictions), published = report.publicationSensitivity;
  subset(published, { id: 'ssi_publication_plus_one_common_session', type: 'availability_cancellation_sensitivity_only', sameBaseQualifiedAccounts: true,
    primaryZeroByConstruction: true, coverageReference: 'coverage' }, 'sensitivity definition');
  assert.equal(published.predictions.length, predictions.length);
  for (let t = 0; t < market.length; t++) {
    const p = published.predictions[t], base = trace[t], expected = sensitivity[t];
    subset(p, { ...predictionView(expected), inputDelayedByDiagnostic: expected.inputDelayedByDiagnostic, cancelledBaseDelay: expected.cancelledBaseDelay,
      baseOffset: predictions[t].offset, baseAssumedFeatureAvailableSession: predictions[t].assumedFeatureAvailableSession,
      sensitivity: 'ssi_publication_plus_one_common_session' }, 'independent cancellation ' + t, errors);
    for (const key of ['trainingN', 'trainingPoolSha256', 'trainingQueuePrefixLength', 'newlyMatureLabels', 'latestTrainingEntry', 'latestTrainingExit', 'featureMean', 'featurePopulationSd', 'beta', 'trainingMeanY']) assert.equal(p[key], base[key], 'cancellation must preserve base fit ' + key);
    assert.equal(Boolean(p.fallbackReason), expected.fitReady && !expected.inputAvailable);
  }
  return { sensitivity, facts: { sourceMonths: monthly.size, validSourceMonths: [...monthly.values()].filter(r => finite(r.value)).length,
    trainingMonthlyLabels: queue.length, evaluationPriceLabels: evaluationN, dailyIndependentFitsIncludingWarmup: predictions.length,
    availableDailyFits: readyN, multiMaturityDays, firstAvailablePrediction: predictions.find(p => p.fitReady).day,
    firstPrimaryMonthlyPrediction: firstMonthly.day, latestTrainingN: predictions.at(-1).trainingN, maximumAbsoluteModelDifferences: errors } };
}

function buildPanels(report, loaded, predictions) {
  const { market, parent, protocol } = loaded, panels = new Map(), episodes = [];
  const coverage = unique(report.coverage, r => [r.calendarDay, r.evaluation, r.years].join('/'), 'coverage'); assert.equal(coverage.size, 12);
  for (const calendarDay of [1, 10, 20]) for (const evaluation of ['equal_age_lot', 'twelve_deposit_account']) for (const years of [1, 3]) {
    const key = [calendarDay, evaluation, years].join('/'), panel = episodesFor(market, predictions, parent, calendarDay, evaluation, years);
    panels.set(key, panel); episodes.push(...panel.episodes);
    const pre = protocol.preOutcomeCalendarAudit.groups.find(r => r.calendarDay === calendarDay && r.evaluation === evaluation && r.holdingYears === years); assert.ok(pre);
    for (const phase of parent.episodes.partitions) {
      const selected = panel.episodes.filter(e => e.partition === phase.id), expected = pre.partitions[phase.id];
      assert.equal(selected.length, expected.n, 'pre-outcome calendar count ' + key + '/' + phase.id);
      if (selected.length) { assert.equal(selected[0].start, expected.first); assert.equal(selected.at(-1).start, expected.last); }
    }
    const c = coverage.get(key); assert.ok(c); assert.equal(c.attemptedStartMonths, panel.calendar.length); assert.equal(c.eligibleEpisodeCount, panel.episodes.length);
    subset(c.scheduledMonths, panel.calendar, key + '.calendar'); assert.equal(c.rejected.length, panel.rejected.length);
    const rejected = unique(c.rejected, r => r.month, 'excluded start months'), counts = {};
    for (const row of panel.rejected) {
      const actual = rejected.get(row.month); assert.ok(actual);
      if (row.reason === 'missing_required_month') assert.ok(['funding_months_not_yet_observed', 'required_funding_date_missing'].includes(actual.reason));
      else if (row.reason !== 'missing_first_arrival') assert.equal(actual.reason, row.reason, key + '/' + row.month);
      counts[actual.reason] = (counts[actual.reason] || 0) + 1;
    }
    assert.deepEqual(c.excluded, counts); assert.equal(sum(Object.values(counts)) + panel.episodes.length, panel.calendar.length);
  }
  return { panels, episodes };
}
function verifyAccountsAndGroups(published, ledger, loaded, panels, episodes, predictions, trace, sensitivity, model) {
  const { market, parent, protocol } = loaded, rules = [{ id: MODEL }, ...protocol.benchmarks];
  const windows = unique(ledger.windows, windowKey, 'base ledgers'), paired = unique(published.pairedBaseWindows, windowKey, 'paired base windows');
  assert.equal(windows.size, episodes.length); assert.equal(paired.size, episodes.length);
  const groups = unique(published.results, groupKey, 'registered cells'); assert.equal(groups.size, 108);
  const errors = {}, counts = [], computed = new Map(), primary = new Map(), intervalStatuses = {};
  let trades = 0, flows = 0, identities = 0, pairs = 0, emptyGroups = 0;
  for (const scenario of parent.scenarios) {
    const cache = new Map();
    for (const episode of episodes) {
      const key = windowKey(episode), accounts = new Map(rules.map(rule => [rule.id, account(market, episode, rule, scenario, parent.portfolio, predictions)])); cache.set(key, accounts);
      if (scenario.id !== 'base') continue;
      const actual = windows.get(key), scalar = paired.get(key); assert.ok(actual && scalar);
      for (const output of [actual, scalar]) {
        assert.equal(output.scenario, 'base'); assert.equal(output.lastFundingDay, episode.lastFundingDay); assert.equal(output.anniversary, episode.anniversary);
        assert.deepEqual(output.fundingPlan, episode.fundingPlan); assert.deepEqual(Object.keys(output.rules).sort(), rules.map(r => r.id).sort());
      }
      for (const rule of rules) {
        const expected = accounts.get(rule.id); assert.equal(actual.rules[rule.id].rule, rule.id);
        compareAccount(actual.rules[rule.id], expected, key + '/' + rule.id, errors, trace);
        for (const field of ACCOUNT_FIELDS) close(scalar.rules[rule.id][field], expected[field], 'published.' + field, errors);
        close(scalar.rules[rule.id].deltaVsImmediatePp, 100 * (expected.terminalWealth - accounts.get('immediate').terminalWealth) / expected.contributed, 'published.deltaPp', errors);
        trades += expected.trades.length; flows += expected.externalFlows.length;
      }
      if (episode.evaluation === 'equal_age_lot' && episode.years === 1) {
        const label = annualOutcome(market, episode.startIndex, parent.portfolio), p = predictions[episode.startIndex]; assert.ok(label); assert.equal(label.exitDay, episode.end);
        close(accounts.get(MODEL).terminalWealth - accounts.get('immediate').terminalWealth, 100 * (p.offset === 5 ? label.y : 0), 'candidate annual identity');
        close(accounts.get('fixed_delay5').terminalWealth - accounts.get('immediate').terminalWealth, 100 * label.y, 'fixed delay annual identity'); identities++;
      }
      if (sensitivity && episode.calendarDay === 1) {
        close(accounts.get(MODEL).terminalWealth, accounts.get('immediate').terminalWealth, 'primary calendar zero by construction');
        assert.ok(episode.fundingPlan.every(f => predictions[f.index].offset === 0));
      }
    }
    for (const [panelKey, panel] of panels) for (const phase of parent.episodes.partitions) {
      const [calendar, evaluation, years] = panelKey.split('/'), calendarDay = +calendar, horizonYears = +years;
      const key = groupKey({ calendarDay, evaluation, horizonYears, partition: phase.id, scenario: scenario.id }), group = groups.get(key); assert.ok(group);
      const selected = panel.episodes.filter(e => e.partition === phase.id), block = (evaluation === 'equal_age_lot' ? 0 : 12) + 12 * horizonYears;
      assert.equal(group.primaryCalendar, calendarDay === 1); assert.deepEqual(group.startRange, selected.length ? { first: selected[0].start, last: selected.at(-1).start } : null);
      subset(group.decisionCoverage, decisionCoverage(selected, predictions), key + '.unique arrival coverage');
      assert.deepEqual(group.rules.map(r => r.id).sort(), rules.map(r => r.id).sort()); if (!selected.length) emptyGroups++;
      if (sensitivity) subset(group, { sensitivity: 'ssi_publication_plus_one_common_session', qualification: 'identical_base_qualified_accounts', noConfirmationGate: true }, 'cancellation group');
      const cell = new Map(); computed.set(key, cell);
      for (const rule of rules) {
        const recorded = group.rules.find(r => r.id === rule.id), a = selected.map(e => cache.get(windowKey(e)).get(rule.id)), expected = { summary: summary(a) };
        subset(recorded.summary, expected.summary, key + '.summary', errors);
        for (const [field, benchmark] of [['vsImmediate', 'immediate'], ['vsFixedDelay5', 'fixed_delay5'], ['vsThreeTranches', 'three_tranches']]) {
          const b = selected.map(e => cache.get(windowKey(e)).get(benchmark)), value = pair(a, b, block); expected[field] = value;
          subset(recorded[field], value, key + '.' + field, errors);
          subset(recorded[field].meanInterval, { draws: 2000, seed: 0x6d2b79f5, method: 'non_circular_moving_block', prng: 'Mulberry32' }, 'bootstrap settings');
          intervalStatuses[value.meanInterval.status] = (intervalStatuses[value.meanInterval.status] || 0) + 1; pairs++;
        }
        if (sensitivity) assert.ok(!('primaryEvidence' in recorded), 'cancellation diagnostic must not acquire a confirmation gate');
        cell.set(rule.id, expected);
      }
      if (scenario.id === 'base') counts.push({ calendarDay, evaluation, years: horizonYears, partition: phase.id, n: selected.length, nonOverlappingN: nonOverlap(selected), blockLength: block });
      if (!sensitivity && calendarDay === 1 && evaluation === 'equal_age_lot' && horizonYears === 1 && scenario.id === 'base') {
        const rows = selected.map(e => { const p = predictions[e.startIndex], accounts = cache.get(windowKey(e)); return { ...p, start: e.start, end: e.end,
          deltaPp: accounts.get(MODEL).terminalWealth - accounts.get('immediate').terminalWealth,
          actualY: annualOutcome(market, e.startIndex, parent.portfolio).y }; });
        const evidence = group.rules.find(r => r.id === MODEL).primaryEvidence;
        primary.set(phase.id, comparePrimary(evidence, cell.get(MODEL).vsImmediate, rows, protocol));
        const diagnostic = published.primaryPredictionDiagnostics.find(d => d.partition === phase.id); assert.ok(diagnostic);
        subset(diagnostic, diagnostics(rows), phase.id + '.annual prediction diagnostics', errors);
        assert.ok(!('maturedFiveSessionLabels' in diagnostic)); close(diagnostic.identityMaximumErrorPp, rows.some(r => r.inputAvailable) ? 0 : null, 'forecast identity');
        close(diagnostic.identityMaximumErrorPpAllEligible, rows.length ? 0 : null, 'all eligible annual identity');
      }
    }
  }
  return { computed, primary, facts: { registeredGroups: groups.size, emptyGroups, baseWindows: episodes.length, baseAccounts: episodes.length * rules.length,
    independentlyReconstructedAllScenarioAccounts: episodes.length * rules.length * parent.scenarios.length,
    baseLedgerTrades: trades, baseLedgerExternalFlows: flows, equalAgeAnnualLabelIdentities: identities,
    independentlyRecomputedPairs: pairs, intervalStatuses, groups: counts, maximumAbsoluteAccountAndStatisticDifferences: errors } };
}
function engineCausality(loaded, trace) {
  // Producer calls here are only metamorphic checks; independent expected fits
  // and cash claims above never invoke its feature, label, model or ledger APIs.
  const Engine = require(path.join(ROOT, ENGINE)), { market, parent, histories } = loaded;
  const raw = Object.fromEntries(histories), first = trace.findIndex(p => p.fitReady);
  const cuts = [...new Set([first, market.findIndex(r => r.day >= '2019-01-01'), market.findIndex(r => r.day >= '2023-01-01'), market.length - 1])].filter(t => t >= first);
  for (const t of cuts) {
    const futurePrices = market.map((r, i) => ({ day: r.day, prices: r.prices.map((p, j) => i >= t ? p * (j ? .017 : 81) : p) }));
    const currentMonth = market[t].day.slice(0, 7);
    const futureShares = Object.fromEntries([...histories].map(([symbol, rows]) => [symbol, rows.map(r => ({ ...r, shares: r.day.slice(0, 7) >= currentMonth ? r.shares * 123 : r.shares }))]));
    const altered = Engine.buildPredictions(futurePrices, parent.portfolio, futureShares).predictions;
    assert.deepEqual(altered.slice(0, t + 1), trace.slice(0, t + 1), 'producer future price/current-incomplete-and-future SSI mutation ' + market[t].day);
    const cropped = Object.fromEntries([...histories].map(([symbol, rows]) => [symbol, rows.filter(r => r.day <= market[t].day)]));
    const prefix = Engine.buildPredictions(market.slice(0, t + 1), parent.portfolio, cropped).predictions;
    assert.deepEqual(prefix, trace.slice(0, t + 1), 'producer future price/SSI truncation ' + market[t].day);
  }
  const appended = market.map(r => ({ day: r.day, prices: r.prices.slice() }));
  for (let ms = time(market.at(-1).day) + DAY; appended.length < market.length + 40; ms += DAY) {
    const d = new Date(ms); if ([0, 6].includes(d.getUTCDay())) continue;
    appended.push({ day: d.toISOString().slice(0, 10), prices: [1e5, .02] });
  }
  const appendedShares = Object.fromEntries([...histories].map(([symbol, rows], j) => [symbol, rows.concat(appended.filter(r => r.day > rows.at(-1).day).map((r, i) => ({ day: r.day, shares: (j + 1) * (i + 3) * 1000 })))]));
  assert.deepEqual(Engine.buildPredictions(appended, parent.portfolio, appendedShares).predictions.slice(0, market.length), trace, 'future append must not rewrite decisions');
  const target = Scope.arrivalCalendar(market, 1).find(r => r.index !== null && r.index > first + 50), t = target.index, missingMonth = trace[t].featureMonth;
  const removed = Object.fromEntries([...histories].map(([symbol, rows]) => [symbol, rows.filter(r => r.day.slice(0, 7) !== missingMonth)]));
  const missing = Engine.buildPredictions(market, parent.portfolio, removed), p = missing.predictions[t];
  subset(p, { fitReady: true, actionAvailable: true, inputAvailable: false, predictedY: null, predictedFullDepositBps: null, offset: 0,
    trainingN: trace[t].trainingN, trainingPoolSha256: trace[t].trainingPoolSha256, featureMean: trace[t].featureMean,
    featurePopulationSd: trace[t].featurePopulationSd, beta: trace[t].beta, trainingMeanY: trace[t].trainingMeanY }, 'producer fit-ready missing input fallback');
  assert.ok(p.fallbackReason); assert.ok(missing.evaluationLabels[t], 'missing current SSI must not erase price-only evaluation label');
  const schedule = Scope.arrivalCalendar(market, 1), scope = Engine.buildScopeEpisodes(market, schedule, missing.predictions, parent.episodes.partitions, 'equal_age_lot', 1);
  assert.ok(scope.episodes.some(e => e.startIndex === t), 'missing input fallback stays in paired qualification');
  return { type: 'separate_producer_metamorphic_checks_not_independent_expected_value_source', historicalCuts: cuts.map(t => market[t].day),
    changedCurrentAndFuturePrices: true, changedIncompleteAndFutureSsiMonths: true, futurePriceAndShareTruncation: true,
    futurePriceAndShareAppend: true, fitReadyMissingMonthRetained: target.day, noNewCandidateOrParameter: true };
}
function auditReports(report, ledger, loaded) {
  verifySources(report, ledger, loaded);
  const model = reconstruct(loaded.market, loaded.histories, loaded.parent.portfolio), checkedModel = verifyModel(report, loaded, model);
  const { panels, episodes } = buildPanels(report, loaded, model.predictions);
  const main = verifyAccountsAndGroups(report, ledger, loaded, panels, episodes, model.predictions, report.dailyPredictions, false, model);
  const sensitivity = verifyAccountsAndGroups(report.publicationSensitivity, ledger.publicationSensitivity, loaded, panels, episodes,
    checkedModel.sensitivity, report.publicationSensitivity.predictions, true, model);
  const decision = verifyConfirmation(report, main.computed, main.primary, loaded.protocol), causalChecks = engineCausality(loaded, report.dailyPredictions);
  const calendarEnds = new Map(); for (const r of loaded.market) calendarEnds.set(r.day.slice(0, 7), r.day);
  const comparable = [...model.monthly.values()].filter(r => finite(r.value) && calendarEnds.has(r.month));
  const mismatches = comparable.filter(r => Object.values(r.sourceDates).some(d => d !== calendarEnds.get(r.month))).map(r => ({ month: r.month, commonPriceLastClose: calendarEnds.get(r.month), sixSourceDates: r.sourceDates }));
  return { status: 'passed', protocolId: loaded.protocol.id, statisticsSha256: report.statisticsSha256,
    tolerance: { numericAbsoluteOrRelative: EPS, monetaryGateAbsolute: PP, actionFractionThreshold: 1e-12, ratiosAndCounts: 'exact_without_monetary_tolerance' },
    method: 'Independent displayed-share CSV month ends, monthly annual terminal claims, direct mature-row one-variable ridge closed form, per-deposit cash claims/unitized NAV, inherited independent gates and BigInt bootstrap.',
    ...checkedModel.facts, main: main.facts, publicationCancellation: { ...sensitivity.facts, primaryZeroByConstruction: true, treatedAsPositiveRobustness: false,
      registeredBaseQualificationPreserved: true, trainingFitsUnchanged: true },
    primary: Object.fromEntries([...main.primary].map(([phase, value]) => [phase, { status: value.status, passed: value.passed, actions: value.actions, concentrationPassed: value.concentration.passed }])),
    decision, causalChecks, sourceFingerprints: loaded.fingerprints, shareFingerprints: loaded.shareFingerprints,
    snapshotMonthEndCrossCheck: { basis: 'Six displayed-share endpoint dates compared with the last observed product-common close of each overlapping calendar month; not proof of publication time or future completeness.', comparedMonths: comparable.length, mismatches },
    limitations: ['All fits and source arithmetic use the fixed current-vintage archive. Source hashes and date alignment do not establish historical publication, vintage availability, split adjustment accuracy or future input freshness.',
      'Agreement among six source dates alone cannot detect six files all stopping before month end. Future integration needs complete month-end coverage and actual arrival/cutoff checks; the current archive does not prove execution 100 days later.',
      'Full trades, fees, flows and per-deposit attribution are compared against producer ledgers for base cost only, for both main and cancellation streams. All three cost/cash scenarios have independently reconstructed terminal wealth, fees, interest, daily-unitized-NAV drawdown and aggregate statistics; stress trade ledgers were not supplied for direct comparison.',
      'The extra publication session is a fixed-base-fit runtime cancellation diagnostic. Primary nominal1 outcomes are zero by construction and cannot be called positive robustness evidence.',
      '36 overlapping annual monthly labels are not independent years; date/holding panels remain exposed history. Numerical correctness does not prove predictive validity, resolve personal tax/fee/holding preferences or authorize score integration.'] };
}
module.exports = { parseShares, monthlyShares, featureInput, annualOutcome, trainingEvents, closedFit, predict, reconstruct, cancellation, episodesFor, account, readInputs, selfTest, auditReports };
if (require.main === module) {
  const args = process.argv.slice(2), arg = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  if (args.includes('--self-test')) console.log(JSON.stringify(selfTest(), null, 2));
  else {
    const reportPath = arg('--report', path.join(ROOT, 'docs/evidence/portfolio-entry-ssi-v5.json'));
    const ledgerPath = arg('--ledger', '/tmp/portfolio-entry-ssi-v5-ledgers.json');
    const reportBytes = fs.readFileSync(reportPath), ledgerBytes = fs.readFileSync(ledgerPath), loaded = readInputs();
    const result = auditReports(JSON.parse(reportBytes), JSON.parse(ledgerBytes), loaded);
    result.selfTest = selfTest();
    result.bindings = { report: { path: path.relative(ROOT, reportPath), sha256: sha(reportBytes) },
      protocol: { path: PROTOCOL, sha256: loaded.protocolSha256 }, engine: { path: ENGINE, sha256: sha(fs.readFileSync(path.join(ROOT, ENGINE))) },
      ledger: { path: ledgerPath, sha256: sha(ledgerBytes) }, checker: { path: path.relative(ROOT, __filename), sha256: sha(fs.readFileSync(__filename)) },
      independentDependencies: ['scripts/check_portfolio_entry_research.cjs', 'scripts/check_portfolio_entry_predictive.cjs', 'scripts/check_portfolio_entry_scope.cjs', 'scripts/check_portfolio_entry_value.cjs'].map(p => ({ path: p, sha256: sha(fs.readFileSync(path.join(ROOT, p))) })) };
    assert.equal(sha(fs.readFileSync(reportPath)), result.bindings.report.sha256, 'report unchanged during audit');
    assert.equal(sha(fs.readFileSync(ledgerPath)), result.bindings.ledger.sha256, 'ledger unchanged during audit');
    for (const source of loaded.shareFingerprints) assert.equal(sha(fs.readFileSync(source.path)), source.sha256, 'share sources unchanged');
    const text = JSON.stringify(result, null, 2) + '\n', output = arg('--write', null);
    if (output) { fs.writeFileSync(output, text); console.log(JSON.stringify({ output, status: result.status, statisticsSha256: result.statisticsSha256, trainingMonthlyLabels: result.trainingMonthlyLabels,
      dailyFits: result.dailyIndependentFitsIncludingWarmup, mainAccounts: result.main.independentlyReconstructedAllScenarioAccounts,
      sensitivityAccounts: result.publicationCancellation.independentlyReconstructedAllScenarioAccounts, decision: result.decision })); }
    else process.stdout.write(text);
  }
}
