#!/usr/bin/env node
'use strict';
// Independent scope audit. No producer calendar, account, statistics or model
// fitting code is imported. The already frozen v2 trace is an input, not refit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Source = require('./check_portfolio_entry_research.cjs');
const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = 'docs/research/portfolio-entry-scope-audit-protocol-v1.json';
const TRACE = 'docs/evidence/portfolio-entry-predictive-v2.json';
const ENGINE = 'scripts/research_portfolio_entry_scope.cjs';
const MODEL = 'expanding_ridge_delay5', EPS = 1e-8, DAY = 86400000, YEAR = 365.2425;
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => a.length ? sum(a) / a.length : null;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const time = day => Date.parse(day + 'T00:00:00Z');
const days = (a, b) => (time(b) - time(a)) / DAY;
const grow = (money, from, to, rate) => rate ? money * (1 + rate) ** (days(from, to) / YEAR) : money;
function close(a, b, label) {
  if (b === null) return assert.equal(a, null, label);
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`);
}
function anniversary(day, years) {
  const [year, month, date] = day.split('-').map(Number), last = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return [year + years, String(month).padStart(2, '0'), String(Math.min(date, last)).padStart(2, '0')].join('-');
}
const monthNumber = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthName = n => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
const available = p => Number.isFinite(p?.predictedY) && p.trainingN >= 756 && p.offset === (p.predictedY > 1e-12 ? 5 : 0);
function readInputs() {
  const source = Source.readInputs(), bytes = fs.readFileSync(path.join(ROOT, PROTOCOL)), protocol = JSON.parse(bytes);
  assert.equal(protocol.id, 'monthly-entry-evaluation-scope-audit-v1');
  assert.deepEqual(protocol.funding.calendarDays, [1, 10, 20]); assert.equal(protocol.funding.amountPerDeposit, 100);
  for (const dependency of protocol.frozenDependencies) assert.equal(sha(fs.readFileSync(path.join(ROOT, dependency.path))), dependency.sha256, dependency.path);
  const traceBytes = fs.readFileSync(path.join(ROOT, TRACE)), prior = JSON.parse(traceBytes), predictions = prior.dailyPredictions;
  assert.equal(prior.inputs.catalog.sha256, source.fingerprints.catalog, 'frozen catalog');
  assert.equal(prior.inputs.parentProtocol.sha256, source.fingerprints.protocol, 'frozen accounting protocol');
  for (const history of source.fingerprints.histories) {
    const frozen = prior.inputs.histories.find(h => h.id === history.id);
    assert.equal(frozen?.sha256, history.sha256, 'frozen source ' + history.id); assert.equal(frozen.path, history.path);
  }
  assert.equal(predictions.length, source.market.length, 'trace calendar length');
  predictions.forEach((p, i) => {
    assert.equal(p.day, source.market[i].day, 'trace day');
    if (p.predictedY !== null) {
      assert.ok(available(p), 'frozen prediction/action mismatch');
      assert.equal(p.featureDay, source.market[i - 1]?.day);
      assert.ok(p.latestTrainingExit <= p.featureDay && p.featureDay < p.day, 'causal trace cutoff');
    }
  });
  return { ...source, parent: source.protocol, protocol, predictions, prior,
    hashes: { protocol: sha(bytes), frozenDependencies: protocol.frozenDependencies, predictionTraceSha256: sha(JSON.stringify(predictions)),
      marketCalendarSha256: sha(JSON.stringify(source.market.map(r => r.day))), frozenReport: sha(traceBytes) } };
}
function arrivalCalendar(market, calendarDay) {
  const grouped = new Map();
  market.forEach((row, index) => { const month = row.day.slice(0, 7); if (!grouped.has(month)) grouped.set(month, []); grouped.get(month).push({ ...row, index }); });
  const result = [];
  for (let n = monthNumber(market[0].day); n <= monthNumber(market.at(-1).day); n++) {
    const month = monthName(n), requestedDay = `${month}-${String(calendarDay).padStart(2, '0')}`;
    const found = (grouped.get(month) || []).find(r => r.day >= requestedDay);
    result.push({ month, requestedDay, day: found?.day ?? null, index: found?.index ?? null });
  }
  return result;
}
function independentEpisodes(market, predictions, protocol, calendarDay, evaluation, years) {
  const calendar = arrivalCalendar(market, calendarDay), byMonth = new Map(calendar.map(a => [a.month, a]));
  const count = evaluation === 'equal_age_lot' ? 1 : 12;
  assert.ok(['equal_age_lot', 'twelve_deposit_account'].includes(evaluation));
  const episodes = [], rejected = [];
  for (const first of calendar) {
    let reason = null;
    const arrivals = Array.from({ length: count }, (_, k) => byMonth.get(monthName(monthNumber(first.month) + k)));
    if (first.index === null) reason = 'missing_first_arrival';
    else if (!available(predictions[first.index])) reason = 'prediction_warmup_at_start';
    else if (arrivals.some(a => !a || a.index === null)) reason = 'missing_required_month';
    else if (arrivals.some(a => !available(predictions[a.index]))) reason = 'prediction_unavailable_on_arrival';
    if (reason) { rejected.push({ month: first.month, reason }); continue; }
    const phase = protocol.endpoints.partitions.find(p => (!p.start || first.day >= p.start) && (!p.end || first.day <= p.end));
    const anchor = arrivals.at(-1).day, target = anniversary(anchor, years), endIndex = market.findIndex(r => r.day >= target);
    if (!phase) reason = 'outside_partitions';
    else if (endIndex < 0) reason = 'unmatured_terminal';
    else if (days(target, market[endIndex].day) > 14) reason = 'delayed_terminal';
    else if ((phase.end && market[endIndex].day > phase.end) || arrivals.some(a => (phase.start && a.day < phase.start) || (phase.end && a.day > phase.end))) reason = 'crossing_partition';
    if (reason) { rejected.push({ month: first.month, reason }); continue; }
    episodes.push({ calendarDay, evaluation, years, start: first.day, startIndex: first.index, end: market[endIndex].day, endIndex,
      anniversary: target, lastFundingDay: anchor, partition: phase.id, depositCount: count,
      fundingPlan: arrivals.map(a => ({ day: a.day, index: a.index, amount: protocol.funding.amountPerDeposit, requestedDay: a.requestedDay })) });
  }
  return { calendar, episodes, rejected };
}
function account(market, episode, rule, scenario, portfolio, predictions) {
  const risk = sum(portfolio.positions.map(p => p.weight));
  assert.equal(scenario.capitalTaxRate, 0); assert.equal(scenario.dividendTaxRate, 0);
  const deposits = episode.fundingPlan.map(flow => {
    const offsets = rule.id === MODEL ? [predictions[flow.index].offset] : rule.offsets;
    assert.ok(offsets.length && offsets.every(Number.isInteger));
    const original = flow.amount * risk / offsets.length;
    return { ...flow, strategic: flow.amount * portfolio.strategicCashWeight, lots: offsets.map(offset => {
      const scheduledIndex = flow.index + offset, executedIndex = scheduledIndex <= episode.endIndex ? scheduledIndex : null;
      const boughtBudget = executedIndex === null ? null : grow(original, flow.day, market[executedIndex].day, scenario.annualCashRate);
      const notional = boughtBudget === null ? 0 : boughtBudget / (1 + scenario.feeRate);
      const units = portfolio.positions.map((p, j) => executedIndex === null ? 0 : notional * p.weight / risk / market[executedIndex].prices[j]);
      const buyFees = notional * scenario.feeRate, sellFees = sum(units.map((u, j) => u * market[episode.endIndex].prices[j] * scenario.feeRate));
      return { original, offset, scheduledIndex, executedIndex, boughtBudget, units, buyFees, sellFees };
    }) };
  });
  function claim(deposit, index, beforeDeposit = false, liquidate = false) {
    if (deposit.index > index || beforeDeposit && deposit.index === index) return 0;
    const day = market[index].day;
    let value = grow(deposit.strategic, deposit.day, day, scenario.annualCashRate);
    for (const lot of deposit.lots) {
      const waiting = lot.executedIndex === null || lot.executedIndex > index || beforeDeposit && lot.executedIndex === index;
      value += waiting ? grow(lot.original, deposit.day, day, scenario.annualCashRate) : sum(lot.units.map((u, j) => u * market[index].prices[j])) * (liquidate ? 1 - scenario.feeRate : 1);
    }
    return value;
  }
  const attribution = deposits.map(deposit => {
    const strategicCash = grow(deposit.strategic, deposit.day, episode.end, scenario.annualCashRate);
    const pendingCash = sum(deposit.lots.filter(l => l.executedIndex === null).map(l => grow(l.original, deposit.day, episode.end, scenario.annualCashRate)));
    const productLiquidationValue = sum(deposit.lots.map(l => sum(l.units.map((u, j) => u * market[episode.endIndex].prices[j])) - l.sellFees));
    return { arrivalDay: deposit.day, amount: deposit.amount, strategicCash, pendingCash, productLiquidationValue,
      terminalWealth: strategicCash + pendingCash + productLiquidationValue,
      fees: sum(deposit.lots.map(l => l.buyFees + l.sellFees)),
      interest: strategicCash - deposit.strategic + sum(deposit.lots.map(l => grow(l.original, deposit.day, l.executedIndex === null ? episode.end : market[l.executedIndex].day, scenario.annualCashRate) - l.original)),
      scheduledPurchases: deposit.lots.map(l => ({ offset: l.offset, scheduledDay: market[l.scheduledIndex]?.day ?? null,
        executedDay: l.executedIndex === null ? null : market[l.executedIndex].day, units: l.units, buyFees: l.buyFees, sellFees: l.sellFees,
        pendingCash: l.executedIndex === null ? grow(l.original, deposit.day, episode.end, scenario.annualCashRate) : 0 })) };
  });
  let fundUnits = 0, peak = 1, maxDrawdownPp = 0;
  for (let i = episode.startIndex; i <= episode.endIndex; i++) {
    const incoming = deposits.find(d => d.index === i);
    if (incoming) fundUnits += incoming.amount / (fundUnits ? sum(deposits.map(d => claim(d, i, true))) / fundUnits : 1);
    const nav = sum(deposits.map(d => claim(d, i, false, i === episode.endIndex))) / fundUnits;
    peak = Math.max(peak, nav); maxDrawdownPp = Math.min(maxDrawdownPp, 100 * (nav / peak - 1));
  }
  const contributed = sum(deposits.map(d => d.amount)), terminalWealth = sum(attribution.map(d => d.terminalWealth));
  const lots = deposits.flatMap(d => d.lots.map(l => ({ ...l, arrival: d }))), executed = lots.filter(l => l.executedIndex !== null);
  const trades = executed.flatMap(l => portfolio.positions.map((p, j) => ({ side: 'buy', day: market[l.executedIndex].day, id: p.id, arrivalDay: l.arrival.day,
    units: l.units[j], price: market[l.executedIndex].prices[j], notional: l.units[j] * market[l.executedIndex].prices[j],
    fee: l.units[j] * market[l.executedIndex].prices[j] * scenario.feeRate, waitSessions: l.offset })));
  portfolio.positions.forEach((p, j) => {
    const units = sum(executed.map(l => l.units[j])); if (units) trades.push({ side: 'sell', day: episode.end, id: p.id, units,
      price: market[episode.endIndex].prices[j], notional: units * market[episode.endIndex].prices[j], fee: units * market[episode.endIndex].prices[j] * scenario.feeRate });
  });
  return { ...episode, terminalWealth, contributed, accountReturnPp: 100 * (terminalWealth / contributed - 1), navReturnPp: 100 * (terminalWealth / fundUnits - 1),
    maxDrawdownPp, fees: sum(attribution.map(d => d.fees)), interest: sum(attribution.map(d => d.interest)),
    pendingCash: sum(attribution.map(d => d.pendingCash)), pendingLots: lots.length - executed.length,
    meanWaitSessions: sum(lots.map(l => l.original * ((l.executedIndex ?? episode.endIndex) - l.arrival.index))) / sum(lots.map(l => l.original)),
    externalFlows: deposits.map(({ day, amount }) => ({ day, amount })), contributionAttribution: attribution, trades };
}
function quantile(xs, p) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), t = p * (a.length - 1), left = Math.floor(t);
  return a[left] * (1 - t + left) + a[Math.ceil(t)] * (t - left);
}
function random32() {
  let state = 0x6d2b79f5n; const u = n => BigInt.asUintN(32, n);
  return () => { state = u(state + 0x6d2b79f5n); let t = u((state ^ (state >> 15n)) * (state | 1n));
    t = u(t ^ u(t + u((t ^ (t >> 7n)) * (t | 61n)))); return Number(u(t ^ (t >> 14n))) / 4294967296; };
}
function interval(values, blockLength) {
  if (!values.length) return { n: 0, blockLength, status: 'no_samples', lower: null, upper: null };
  if (values.length <= blockLength) return { n: values.length, blockLength, status: 'insufficient_blocks', lower: mean(values), upper: mean(values) };
  const random = random32(), samples = [];
  for (let i = 0; i < 2000; i++) {
    const sample = [];
    while (sample.length < values.length) { const begin = Math.floor(random() * (values.length - blockLength + 1)); sample.push(...values.slice(begin, begin + blockLength)); }
    samples.push(mean(sample.slice(0, values.length)));
  }
  return { n: values.length, blockLength, status: 'descriptive', lower: quantile(samples, .025), upper: quantile(samples, .975) };
}
function nonOverlap(rows) {
  let count = 0, end = '';
  for (const row of [...rows].sort((a, b) => a.start.localeCompare(b.start))) if (row.start > end) { count++; end = row.end; }
  return count;
}
function summary(rows) {
  return { n: rows.length, nonOverlappingN: nonOverlap(rows), meanAccountReturnPp: mean(rows.map(r => r.accountReturnPp)), medianAccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .5),
    p10AccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .1), medianMaxDrawdownPp: quantile(rows.map(r => r.maxDrawdownPp), .5),
    worstMaxDrawdownPp: rows.length ? Math.min(...rows.map(r => r.maxDrawdownPp)) : null, meanWaitSessions: mean(rows.map(r => r.meanWaitSessions)),
    meanFees: mean(rows.map(r => r.fees)), meanInterest: mean(rows.map(r => r.interest)), pendingEpisodes: rows.filter(r => r.pendingCash > 1e-9).length };
}
function pair(rows, baseline, blockLength) {
  assert.equal(rows.length, baseline.length);
  const deltas = rows.map((r, i) => { assert.deepEqual(r.externalFlows, baseline[i].externalFlows); const d = 100 * (r.terminalWealth - baseline[i].terminalWealth) / r.contributed; return Math.abs(d) <= 1e-12 ? 0 : d; });
  const a = summary(rows), b = summary(baseline), difference = k => a[k] === null ? null : a[k] - b[k];
  return { n: rows.length, nonOverlappingN: a.nonOverlappingN, identicalExternalFlows: true, meanDeltaPp: mean(deltas), medianDeltaPp: quantile(deltas, .5),
    positiveDeltaShare: rows.length ? deltas.filter(d => d > 0).length / rows.length : null, pairedDeltaP10Pp: quantile(deltas, .1),
    p10AccountReturnDifferencePp: difference('p10AccountReturnPp'), medianMaxDrawdownDifferencePp: difference('medianMaxDrawdownPp'),
    worstMaxDrawdownDifferencePp: difference('worstMaxDrawdownPp'), meanInterval: interval(deltas, blockLength) };
}
function mapUnique(rows, key, label) {
  const map = new Map(); for (const row of rows) { const id = key(row); assert.ok(!map.has(id), label + ': duplicate ' + id); map.set(id, row); } return map;
}
const windowKey = e => [e.calendarDay, e.evaluation, e.years, e.partition, e.start, e.end].join('/');
const groupKey = e => [e.calendarDay, e.evaluation, e.horizonYears, e.partition, e.scenario].join('/');
function checkNumbers(actual, expected, context) {
  for (const [key, value] of Object.entries(expected)) {
    if (value === null || typeof value === 'number') close(actual[key], value, context + '.' + key);
    else if (typeof value === 'boolean' || typeof value === 'string') assert.equal(actual[key], value, context + '.' + key);
  }
}
function checkAccount(actual, expected, context, errors) {
  assert.deepEqual(actual.externalFlows, expected.externalFlows, context + '.externalFlows');
  for (const key of ['terminalWealth', 'contributed', 'accountReturnPp', 'navReturnPp', 'maxDrawdownPp', 'fees', 'interest', 'pendingCash', 'pendingLots', 'meanWaitSessions']) {
    close(actual[key], expected[key], context + '.' + key); errors[key] = Math.max(errors[key] || 0, Math.abs(actual[key] - expected[key]));
  }
  assert.equal(actual.contributionAttribution.length, expected.contributionAttribution.length, context + '.attribution count');
  expected.contributionAttribution.forEach((d, i) => {
    const a = actual.contributionAttribution[i]; checkNumbers(a, d, context + '.attribution.' + i);
    assert.equal(a.scheduledPurchases.length, d.scheduledPurchases.length);
    d.scheduledPurchases.forEach((p, j) => {
      const q = a.scheduledPurchases[j]; checkNumbers(q, p, context + '.purchase.' + i + '.' + j);
      assert.equal(q.units.length, p.units.length); p.units.forEach((v, k) => close(q.units[k], v, context + '.purchase.units'));
    });
  });
  for (const key of ['terminalWealth', 'fees', 'interest', 'pendingCash']) close(sum(actual.contributionAttribution.map(a => a[key])), actual[key], context + '.attribution sum ' + key);
  const key = t => [t.day, t.side, t.id, t.arrivalDay || ''].join('/');
  const a = [...actual.trades].sort((x, y) => key(x).localeCompare(key(y))), b = [...expected.trades].sort((x, y) => key(x).localeCompare(key(y)));
  assert.equal(a.length, b.length, context + '.trade count'); b.forEach((t, i) => checkNumbers(a[i], t, context + '.trade.' + i));
}
function decisionsFor(episodes, predictions) {
  const result = new Map();
  for (const episode of episodes) for (const flow of episode.fundingPlan) {
    if (!result.has(flow.day)) { const p = predictions[flow.index]; result.set(flow.day, { day: flow.day, featureDay: p.featureDay,
      trainingN: p.trainingN, latestTrainingExit: p.latestTrainingExit, predictedY: p.predictedY, offset: p.offset, occurrencesInAccounts: 0 }); }
    result.get(flow.day).occurrencesInAccounts++;
  }
  const dates = [...result.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { dates, uniqueArrivalDecisions: dates.length, delayedUniqueDecisions: dates.filter(d => d.offset === 5).length };
}
function auditReports(report, ledger, loaded) {
  const { market, predictions, protocol, parent, hashes } = loaded;
  for (const output of [report, ledger]) {
    assert.equal(output.protocolId, protocol.id);
    assert.equal(output.inputs.protocol.sha256, hashes.protocol);
    assert.deepEqual(output.inputs.frozenDependencies, hashes.frozenDependencies);
    assert.equal(output.inputs.predictionTraceSha256, hashes.predictionTraceSha256);
    assert.equal(output.inputs.marketCalendarSha256, hashes.marketCalendarSha256);
    assert.equal(output.inputs.actualCnyPriceRowsSha256, sha(JSON.stringify(market.map(({ day, prices }) => ({ day, prices })))));
    assert.equal(output.inputs.researchEngine.path, ENGINE);
    assert.equal(output.inputs.researchEngine.sha256, sha(fs.readFileSync(path.join(ROOT, ENGINE))));
    assert.deepEqual(output.inputs.v2Inputs, loaded.prior.inputs);
  }
  assert.deepEqual(ledger.predictions, predictions, 'no trace refit or modification');
  assert.equal(report.decision.selection, null); assert.equal(report.decision.integrationEligible, false); assert.equal(report.decision.priorV2FailureUnchanged, true);
  assert.equal(report.statisticsSha256, sha(JSON.stringify({ results: report.results, coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows, decision: report.decision })));
  const rules = [{ id: MODEL }, ...protocol.strategy.benchmarks], base = parent.scenarios.find(s => s.id === 'base');
  assert.equal(base.feeRate, .001); assert.equal(base.annualCashRate, 0);
  const expected = [], panel = new Map();
  for (const calendarDay of protocol.funding.calendarDays) for (const evaluation of protocol.evaluations) for (const years of evaluation.holdingYears) {
    const independent = independentEpisodes(market, predictions, protocol, calendarDay, evaluation.id, years);
    const key = [calendarDay, evaluation.id, years].join('/'); panel.set(key, independent); expected.push(...independent.episodes);
  }
  const actual = mapUnique(ledger.windows, windowKey, 'ledger windows'), paired = mapUnique(report.pairedBaseWindows, windowKey, 'paired windows');
  assert.equal(actual.size, expected.length); assert.equal(paired.size, expected.length);
  const coverages = mapUnique(report.coverage, r => [r.calendarDay, r.evaluation, r.years].join('/'), 'coverage'); assert.equal(coverages.size, 12);
  for (const [key, independent] of panel) {
    const coverage = coverages.get(key); assert.ok(coverage, key);
    assert.equal(coverage.attemptedStartMonths, independent.calendar.length); assert.equal(coverage.eligibleEpisodeCount, independent.episodes.length);
    assert.equal(coverage.rejected.length, independent.rejected.length);
    assert.deepEqual([...new Set(coverage.rejected.map(r => r.month))].sort(), independent.rejected.map(r => r.month).sort());
    assert.equal(sum(Object.values(coverage.excluded)), independent.rejected.length, key + ': exclusion counts');
    assert.equal(coverage.scheduledMonths.length, independent.calendar.length);
    independent.calendar.forEach((row, i) => checkNumbers(coverage.scheduledMonths[i], row, key + ': monthly calendar'));
  }
  const accountCache = new Map(), errors = {}; let trades = 0, deposits = 0;
  for (const episode of expected) {
    const key = windowKey(episode), recorded = actual.get(key), published = paired.get(key);
    assert.ok(recorded && published, key + ': omitted expected window');
    for (const output of [recorded, published]) {
      assert.equal(output.scenario, 'base'); assert.equal(output.lastFundingDay, episode.lastFundingDay); assert.equal(output.anniversary, episode.anniversary);
      assert.deepEqual(output.fundingPlan, episode.fundingPlan, key + ': exact funding calendar');
      assert.deepEqual(Object.keys(output.rules).sort(), rules.map(r => r.id).sort());
    }
    assert.equal(published.contributed, episode.depositCount * 100);
    const accounts = new Map(rules.map(rule => [rule.id, account(market, episode, rule, base, parent.portfolio, predictions)])); accountCache.set(key, accounts);
    for (const rule of rules) {
      const expectedAccount = accounts.get(rule.id), observed = recorded.rules[rule.id], scalar = published.rules[rule.id];
      checkAccount(observed, expectedAccount, key + '/' + rule.id, errors);
      for (const field of ['terminalWealth', 'contributed', 'accountReturnPp', 'navReturnPp', 'maxDrawdownPp', 'fees', 'interest', 'pendingCash', 'pendingLots', 'meanWaitSessions']) close(scalar[field], expectedAccount[field], key + ': published ' + field);
      close(scalar.deltaVsImmediatePp, 100 * (expectedAccount.terminalWealth - accounts.get('immediate').terminalWealth) / expectedAccount.contributed, key + ': published paired delta');
      trades += expectedAccount.trades.length; deposits += expectedAccount.externalFlows.length;
    }
  }
  const groups = mapUnique(report.results, groupKey, 'report result groups'); assert.equal(groups.size, 108);
  const groupCounts = [], intervalStatuses = {}, seenMonthlyKeys = new Set(); let basePairs = 0, emptyGroups = 0;
  for (const calendarDay of protocol.funding.calendarDays) for (const evaluation of protocol.evaluations) for (const years of evaluation.holdingYears) for (const partition of protocol.endpoints.partitions) for (const scenario of parent.scenarios) {
    const key = groupKey({ calendarDay, evaluation: evaluation.id, horizonYears: years, partition: partition.id, scenario: scenario.id }), group = groups.get(key);
    assert.ok(group, key + ': missing registered cell');
    const episodes = panel.get([calendarDay, evaluation.id, years].join('/')).episodes.filter(e => e.partition === partition.id);
    const decisions = decisionsFor(episodes, predictions), block = (evaluation.id === 'equal_age_lot' ? 0 : 12) + 12 * years;
    assert.equal(group.primaryCalendar, calendarDay === 1);
    assert.deepEqual(group.decisionCoverage, decisions, key + ': unique decisions/occurrences');
    assert.deepEqual(group.startRange, episodes.length ? { first: episodes[0].start, last: episodes.at(-1).start } : null);
    assert.deepEqual(group.rules.map(r => r.id).sort(), rules.map(r => r.id).sort());
    if (!episodes.length) emptyGroups++;
    for (const rule of rules) {
      const result = group.rules.find(r => r.id === rule.id); assert.equal(result.summary.n, episodes.length);
      assert.equal(result.summary.nonOverlappingN, nonOverlap(episodes));
      for (const [field, baseline] of [['vsImmediate', 'immediate'], ['vsFixedDelay5', 'fixed_delay5'], ['vsThreeTranches', 'three_tranches']]) {
        const p = result[field], ci = p.meanInterval;
        assert.equal(p.n, episodes.length); assert.equal(p.nonOverlappingN, nonOverlap(episodes)); assert.equal(p.identicalExternalFlows, true);
        assert.equal(ci.blockLength, block); assert.equal(ci.n, episodes.length); assert.equal(ci.draws, 2000); assert.equal(ci.seed, 0x6d2b79f5);
        assert.equal(ci.method, 'non_circular_moving_block'); assert.equal(ci.prng, 'Mulberry32');
        const status = !episodes.length ? 'no_samples' : episodes.length <= block ? 'insufficient_blocks' : 'descriptive'; assert.equal(ci.status, status);
        intervalStatuses[status] = (intervalStatuses[status] || 0) + 1;
        if (!episodes.length) { assert.equal(ci.lower, null); assert.equal(ci.upper, null); checkNumbers(result.summary, summary([]), key + ': empty summary'); checkNumbers(p, pair([], [], block), key + ': empty pair'); }
        if (scenario.id === 'base') {
          const candidateRows = episodes.map(e => accountCache.get(windowKey(e)).get(rule.id)), baselineRows = episodes.map(e => accountCache.get(windowKey(e)).get(baseline));
          checkNumbers(result.summary, summary(candidateRows), key + ': independent summary');
          const reconstructed = pair(candidateRows, baselineRows, block); checkNumbers(p, reconstructed, key + ': independent pair'); checkNumbers(ci, reconstructed.meanInterval, key + ': independent interval'); basePairs++;
        }
      }
    }
    if (scenario.id === 'base') {
      groupCounts.push({ calendarDay, evaluation: evaluation.id, years, partition: partition.id, n: episodes.length, uniqueDecisions: decisions.uniqueArrivalDecisions, delayedUniqueDecisions: decisions.delayedUniqueDecisions, nonOverlappingN: nonOverlap(episodes), blockLength: block });
      decisions.dates.forEach(d => seenMonthlyKeys.add(calendarDay + '/' + d.day));
    }
  }
  return { status: 'passed', protocolId: protocol.id, auditScope: 'frozen-model evaluation scope only; no predictive advantage or integration authorization',
    method: 'independent nominal-month calendar and anniversaries; sum of separately priced deposit/tranche claims; independent unitized NAV and BigInt Mulberry32 bootstrap',
    sourceCommonCloses: market.length, registeredGroups: groups.size, emptyGroups, baseWindows: expected.length, baseAccounts: expected.length * rules.length,
    baseTrades: trades, baseExternalFlows: deposits, distinctCalendarArrivalKeys: seenMonthlyKeys.size, independentlyRecomputedBasePairs: basePairs,
    intervalStatusesAcrossAllGroups: intervalStatuses, groups: groupCounts, maximumAbsoluteDifferences: errors,
    protocolSha256: hashes.protocol, frozenPredictionTraceSha256: hashes.predictionTraceSha256, marketCalendarSha256: hashes.marketCalendarSha256,
    sourceFingerprints: loaded.fingerprints,
    limitations: ['All real-history account and attribution reconstructions cover the base scenario only; cash2 and fee20 have hand-derived synthetic checks, not a full independent historical ledger replay.',
      'All 108 cells are checked for complete calendar coverage, unique decisions, block lengths and insufficient/empty statuses; numerical bootstrap intervals are independently reconstructed for base cells.',
      'Source hashes establish consistency, not correctness of vendor quotes. Existing v2 forecasts are replayed unchanged, not refit or newly validated.',
      'Passing this audit does not rehabilitate v1/v2, choose a payday or horizon, or establish a strategy advantage.'] };
}
function selfTest() {
  assert.equal(anniversary('2020-02-29', 1), '2021-02-28'); assert.equal(anniversary('2020-02-29', 4), '2024-02-29');
  const minimal = [{ day: '2021-01-04' }, { day: '2021-01-11' }, { day: '2021-01-20' }, { day: '2021-03-01' }, { day: '2021-03-08' }];
  assert.deepEqual(arrivalCalendar(minimal, 10).map(r => r.day), ['2021-01-11', null, null]);
  assert.equal(arrivalCalendar(minimal, 1)[0].day, '2021-01-04');
  const market = []; for (let t = time('2019-01-02'); t <= time('2026-10-30'); t += DAY) {
    const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) market.push({ day: d.toISOString().slice(0, 10), prices: [10, 20] });
  }
  const predictions = market.map((r, i) => ({ day: r.day, predictedY: 0, offset: 0, trainingN: 756, featureDay: market[i - 1]?.day ?? null, latestTrainingExit: market[i - 1]?.day ?? null }));
  const protocol = { funding: { amountPerDeposit: 100 }, endpoints: { partitions: [{ id: 'validation', start: '2019-01-01', end: '2022-12-31' }, { id: 'replication', start: '2023-01-01', end: null }] } };
  const one = independentEpisodes(market, predictions, protocol, 1, 'equal_age_lot', 1), batch = independentEpisodes(market, predictions, protocol, 1, 'twelve_deposit_account', 1);
  const initial = batch.episodes[0]; assert.equal(initial.fundingPlan.length, 12); assert.equal(initial.lastFundingDay, '2019-12-02'); assert.equal(initial.anniversary, '2020-12-02');
  assert.equal(initial.fundingPlan.at(-1).requestedDay, '2019-12-01');
  assert.ok(batch.episodes.every(e => e.fundingPlan.length === 12 && e.anniversary === anniversary(e.lastFundingDay, 1)));
  assert.ok(one.episodes.every(e => e.fundingPlan.length === 1 && e.anniversary === anniversary(e.start, 1)));
  const long = independentEpisodes(market, predictions, protocol, 1, 'twelve_deposit_account', 3);
  assert.equal(long.episodes.filter(e => e.partition === 'replication').length, 0, 'no shortened long account');
  const lost = structuredClone(predictions); lost[initial.fundingPlan[5].index].predictedY = null;
  assert.ok(!independentEpisodes(market, lost, protocol, 1, 'twelve_deposit_account', 1).episodes.some(e => e.start === initial.start), 'missing intermediate prediction rejects whole paired batch');
  const p = { strategicCashWeight: .4, positions: [{ id: 'a', weight: .3 }, { id: 'b', weight: .3 }] }, base = { annualCashRate: 0, feeRate: .001, capitalTaxRate: 0, dividendTaxRate: 0 };
  const tiny = [{ day: '2020-01-02', prices: [10, 20] }, { day: '2020-01-03', prices: [20, 10] }, { day: '2020-01-06', prices: [30, 40] }];
  const episode = { startIndex: 0, endIndex: 2, start: tiny[0].day, end: tiny[2].day, fundingPlan: [{ index: 0, day: tiny[0].day, amount: 100 }], depositCount: 1 };
  const immediate = account(tiny, episode, { id: 'immediate', offsets: [0] }, base, p, []);
  close(immediate.terminalWealth, 40 + 150 * .999 / 1.001, 'hand terminal'); close(immediate.fees, .21 / 1.001, 'hand fees');
  close(immediate.maxDrawdownPp, 40 + 60 / 1.001 - 100, 'initial buy fee belongs in NAV drawdown');
  const feeStress = account(tiny, episode, { id: 'immediate', offsets: [0] }, { ...base, feeRate: .002 }, p, []);
  close(feeStress.terminalWealth, 40 + 150 * .998 / 1.002, 'fee20 hand result');
  const cashStress = account(tiny, episode, { id: 'immediate', offsets: [0] }, { ...base, annualCashRate: .02 }, p, []);
  close(cashStress.terminalWealth, 40 * 1.02 ** (4 / YEAR) + 150 * .999 / 1.001, 'cash2 separate strategic cash');
  const pending = account(tiny, episode, { id: 'fixed_delay5', offsets: [5] }, { ...base, annualCashRate: .02 }, p, []);
  close(pending.terminalWealth, 100 * 1.02 ** (4 / YEAR), 'pending cash2'); close(pending.fees, 0, 'unexecuted has no fees');
  const tranches = account(tiny, episode, { id: 'synthetic_three', offsets: [0, 1, 5] }, base, p, []);
  close(tranches.terminalWealth, 60 + 105 * .999 / 1.001, 'initial equal thirds'); assert.equal(tranches.pendingLots, 1);
  checkAccount(structuredClone(immediate), immediate, 'same hand ledger', {});
  const changedFee = structuredClone(immediate); changedFee.trades[0].fee += .01; assert.throws(() => checkAccount(changedFee, immediate, 'reject fee change', {}));
  const changedAttribution = structuredClone(immediate); changedAttribution.contributionAttribution[0].terminalWealth += .01; assert.throws(() => checkAccount(changedAttribution, immediate, 'reject attribution change', {}));
  const distinct = decisionsFor([{ fundingPlan: initial.fundingPlan }, { fundingPlan: initial.fundingPlan }], predictions);
  assert.equal(distinct.uniqueArrivalDecisions, 12); assert.ok(distinct.dates.every(d => d.occurrencesInAccounts === 2));
  assert.equal(interval([], 12).status, 'no_samples'); assert.equal(interval(Array(12).fill(2), 12).status, 'insufficient_blocks');
  assert.equal(interval(Array(36).fill(2), 36).status, 'insufficient_blocks'); assert.equal(interval(Array(48).fill(2), 48).status, 'insufficient_blocks');
  const stable = interval(Array(49).fill(2), 48); assert.equal(stable.lower, 2); assert.equal(stable.upper, 2);
  assert.deepEqual(interval(Array.from({ length: 30 }, (_, i) => i), 12), interval(Array.from({ length: 30 }, (_, i) => i), 12));
  return { passed: true, cases: 25, stresses: ['cash2 closed-form only', 'fee20 closed-form only'] };
}
module.exports = { readInputs, anniversary, arrivalCalendar, independentEpisodes, account, interval, decisionsFor, auditReports, selfTest };
if (require.main === module) {
  const args = process.argv.slice(2), selfTests = selfTest();
  if (args.length === 1 && args[0] === '--self-test') console.log(JSON.stringify({ selfTests }, null, 2));
  else {
    assert.ok(args.length === 4 && args[0] === '--report' && args[2] === '--audit', 'usage: --self-test OR --report REPORT.json --audit LEDGERS.json');
    const reportBytes = fs.readFileSync(path.resolve(args[1])), ledgerBytes = fs.readFileSync(path.resolve(args[3]));
    const result = auditReports(JSON.parse(reportBytes), JSON.parse(ledgerBytes), readInputs());
    console.log(JSON.stringify({ ...result, selfTests, reportSha256: sha(reportBytes), ledgerSha256: sha(ledgerBytes),
      checkerSha256: sha(fs.readFileSync(__filename)), sourceCalendarCheckerSha256: sha(fs.readFileSync(path.join(ROOT, 'scripts/check_portfolio_entry_research.cjs'))),
      researchEngineSha256: sha(fs.readFileSync(path.join(ROOT, ENGINE))), tolerance: { absoluteOrRelative: EPS, expression: 'abs(a-b) <= 1e-8 * max(1,abs(b))' } }, null, 2));
  }
}
