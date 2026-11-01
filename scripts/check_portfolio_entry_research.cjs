#!/usr/bin/env node
'use strict';
// Independent, read-only audit of the frozen equal-budget experiment.
// This file does not import the research engine, Timing, or portfolio accounting.
// Every deposit/sub-lot is valued separately at a requested date; account values
// are sums of these claims, rather than a second mutable cash/position ledger.
// Usage: node scripts/check_portfolio_entry_research.cjs --self-test
//        node scripts/check_portfolio_entry_research.cjs --report FILE --audit FILE
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = 'docs/research/portfolio-entry-protocol-v1.json';
const DAY = 86400000, YEAR = 365.2425, EPS = 1e-8;
const SIGNAL_EPS = 1e-12;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const timestamp = day => Date.parse(day + 'T00:00:00Z');
const elapsed = (from, to) => (timestamp(to) - timestamp(from)) / DAY;
const total = values => values.reduce((a, b) => a + b, 0);
const grow = (amount, from, to, rate) => rate === 0 ? amount : amount * Math.pow(1 + rate, elapsed(from, to) / YEAR);
// Fixed floating-point equality protection, not an economically wider rule.
const triggers = (value, threshold) => Number.isFinite(value) && (value < threshold || Math.abs(value - threshold) <= SIGNAL_EPS);
function close(actual, expected, context) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)),
    context + ': ' + actual + ' != ' + expected);
}
function addYears(day, years) {
  const d = new Date(timestamp(day)), month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function validateSeries(history, asset) {
  assert.equal(history.id, asset.id);
  assert.equal(history.currency, asset.currency);
  assert.equal(history.basis, 'provider_adjusted_close');
  assert.equal(history.first, asset.first); assert.equal(history.asOf, asset.asOf);
  assert.ok(Array.isArray(history.series) && history.series.length > 1);
  history.series.forEach(([day, price], i) => {
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(timestamp(day)).toISOString().slice(0, 10), day);
    assert.ok(Number.isFinite(price) && price > 0, asset.id + ': invalid price');
    assert.ok(!i || day > history.series[i - 1][0], asset.id + ': non-increasing history');
  });
  assert.equal(history.series[0][0], history.first);
  assert.equal(history.series.at(-1)[0], history.asOf);
}
function readInputs(root = ROOT) {
  const protocolBytes = fs.readFileSync(path.join(root, PROTOCOL));
  const protocol = JSON.parse(protocolBytes);
  assert.equal(protocol.id, 'equal-budget-entry-v1');
  assert.equal(protocol.portfolio.currency, 'CNY');
  assert.equal(protocol.portfolio.rebalance, 'none');
  close(total(protocol.portfolio.positions.map(p => p.weight)) + protocol.portfolio.strategicCashWeight, 1, 'portfolio budget');
  const catalogBytes = fs.readFileSync(path.join(root, 'data/portfolio/catalog.js'));
  const sandbox = {}; vm.runInNewContext(catalogBytes.toString(), sandbox);
  const catalog = sandbox.PORTFOLIO_CATALOG;
  const assets = protocol.portfolio.positions.map(p => catalog.assets.find(a => a.id === p.id));
  const allAssets = [...assets, catalog.fx], histories = new Map(), sources = [];
  for (const asset of allAssets) {
    assert.ok(asset && asset.status === 'available' && asset.historyUrl, 'missing source');
    assert.match(asset.historyUrl, /^data\/portfolio\/[a-z]+\/[\w-]+\.json$/);
    const bytes = fs.readFileSync(path.join(root, asset.historyUrl));
    assert.equal(digest(bytes), asset.sha256, asset.id + ': source digest');
    const history = JSON.parse(bytes); validateSeries(history, asset);
    if (asset !== catalog.fx) assert.equal(history.dividends, 'reinvested');
    histories.set(asset.id, history);
    sources.push({ id: asset.id, path: asset.historyUrl, sha256: digest(bytes) });
  }
  const market = makeMarket(assets, histories, catalog.fx.id, protocol);
  return { protocol, market, fingerprints: { protocol: digest(protocolBytes), catalog: digest(catalogBytes), histories: sources } };
}
function makeMarket(assets, histories, fxId, protocol) {
  const quoteMaps = assets.map(a => new Map(histories.get(a.id).series));
  const fx = histories.get(fxId).series;
  let fxIndex = -1;
  const rows = [];
  // Only observed common product closes are trade dates. FX may be earlier,
  // but never later than the product close and never older than seven days.
  for (const [day] of histories.get(assets[0].id).series) {
    if (!quoteMaps.every(quotes => quotes.has(day))) continue;
    while (fxIndex + 1 < fx.length && fx[fxIndex + 1][0] <= day) fxIndex++;
    if (fxIndex < 0 || elapsed(fx[fxIndex][0], day) > 7) continue;
    rows.push({ day, fxDay: fx[fxIndex][0], prices: assets.map((a, k) => {
      assert.ok(a.currency === 'USD' || a.currency === 'CNY', 'unsupported source currency');
      return quoteMaps[k].get(day) * (a.currency === 'USD' ? fx[fxIndex][1] : 1);
    }) });
  }
  assert.ok(rows.length > protocol.signal.warmupObservations, 'not enough common history');
  return attachFeatures(rows, protocol);
}
function attachFeatures(rows, protocol) {
  const values = [], weights = protocol.portfolio.positions.map(p => p.weight);
  let value = 100, peak = 100;
  return rows.map((row, i) => {
    if (i) value *= 1 + total(weights.map((weight, j) => weight * (row.prices[j] / rows[i - 1].prices[j] - 1)));
    values.push(value); peak = Math.max(peak, value);
    const ma = protocol.signal.ma, lag = protocol.signal.returnLookback;
    // A fresh slice/reduction intentionally differs from an incremental MA.
    const average = i + 1 >= ma ? total(values.slice(i + 1 - ma)) / ma : null;
    return { ...row, reference: value, features: {
      drawdown: value / peak - 1,
      deviation: average === null ? null : value / average - 1,
      return21: i >= lag ? value / values[i - lag] - 1 : null
    } };
  });
}
function windows(market, protocol) {
  const monthStarts = market.map((row, index) => ({ ...row, index })).filter((row, i) => !i || row.day.slice(0, 7) !== market[i - 1].day.slice(0, 7));
  const answer = [];
  for (const first of monthStarts) {
    if (first.index < protocol.signal.warmupObservations) continue;
    const partition = protocol.episodes.partitions.find(p => (!p.start || first.day >= p.start) && (!p.end || first.day <= p.end));
    if (!partition) continue;
    for (const years of [protocol.episodes.primaryHorizonYears, protocol.episodes.secondaryHorizonYears]) {
      const anniversary = addYears(first.day, years);
      const lastIndex = market.findIndex(row => row.day >= anniversary);
      if (lastIndex < 0 || elapsed(anniversary, market[lastIndex].day) > 14) continue;
      if (partition.end && market[lastIndex].day > partition.end) continue;
      answer.push({ startIndex: first.index, endIndex: lastIndex, start: first.day, end: market[lastIndex].day, anniversary, years, partition: partition.id });
    }
  }
  return answer;
}
function deposits(market, episode, mode, amount) {
  if (mode === 'existing_cash') return [{ index: episode.startIndex, day: episode.start, amount }];
  assert.equal(mode, 'monthly_new_cash');
  return market.map((row, index) => ({ day: row.day, index, amount })).filter(row => row.index >= episode.startIndex && row.day < episode.anniversary &&
    (!row.index || row.day.slice(0, 7) !== market[row.index - 1].day.slice(0, 7)));
}
function priceDeposit(market, episode, rule, scenario, portfolio, deposit) {
  const riskWeight = 1 - portfolio.strategicCashWeight, fractions = rule.tranches || [0];
  const riskBudget = deposit.amount * riskWeight / fractions.length;
  const lots = fractions.map(delay => {
    let boughtIndex = null;
    if (rule.tranches) {
      if (deposit.index + delay <= episode.endIndex) boughtIndex = deposit.index + delay;
    } else {
      for (let index = deposit.index; index <= episode.endIndex; index++) {
        const state = market[index - 1]?.features[rule.feature];
        if (index - deposit.index >= rule.maxWait || triggers(state, rule.threshold)) { boughtIndex = index; break; }
      }
    }
    const budgetAtBuy = boughtIndex === null ? null : grow(riskBudget, deposit.day, market[boughtIndex].day, scenario.annualCashRate);
    const positions = boughtIndex === null ? [] : portfolio.positions.map((position, k) => {
      const budget = budgetAtBuy * position.weight / riskWeight;
      const notional = budget / (1 + scenario.feeRate);
      return { id: position.id, index: k, units: notional / market[boughtIndex].prices[k], notional, fee: budget - notional };
    });
    return { original: riskBudget, arrival: deposit, boughtIndex, positions, budgetAtBuy };
  });
  return { ...deposit, strategic: deposit.amount * portfolio.strategicCashWeight, lots };
}
function valueDeposit(deposit, market, at, scenario, options = {}) {
  if (deposit.index > at || options.beforeDeposit && deposit.index === at) return 0;
  const day = market[at].day;
  let value = grow(deposit.strategic, deposit.day, day, scenario.annualCashRate);
  for (const lot of deposit.lots) {
    // Before the same-day arrival the price move has happened but that day's
    // purchases have not; this gives external deposits the pre-trade NAV.
    const waiting = lot.boughtIndex === null || lot.boughtIndex > at || options.beforeDeposit && lot.boughtIndex === at;
    value += waiting ? grow(lot.original, deposit.day, day, scenario.annualCashRate) :
      total(lot.positions.map(p => p.units * market[at].prices[p.index] * (options.liquidate ? 1 - scenario.feeRate : 1)));
  }
  return value;
}
function independentAccount(market, episode, rule, scenario, mode, protocol) {
  assert.equal(scenario.capitalTaxRate, 0); assert.equal(scenario.dividendTaxRate, 0);
  const flows = deposits(market, episode, mode, protocol.funding.amountPerDeposit);
  const claims = flows.map(deposit => priceDeposit(market, episode, rule, scenario, protocol.portfolio, deposit));
  const lots = claims.flatMap(d => d.lots), executed = lots.filter(l => l.boughtIndex !== null);
  const terminalWealth = total(claims.map(d => valueDeposit(d, market, episode.endIndex, scenario, { liquidate: true })));
  const contributed = total(flows.map(d => d.amount));
  const pendingCash = total(lots.filter(l => l.boughtIndex === null).map(l => grow(l.original, l.arrival.day, episode.end, scenario.annualCashRate)));
  const buyFees = total(executed.flatMap(l => l.positions.map(p => p.fee)));
  const saleFees = total(executed.flatMap(l => l.positions.map(p => p.units * market[episode.endIndex].prices[p.index] * scenario.feeRate)));
  const interest = total(claims.map(d => grow(d.strategic, d.day, episode.end, scenario.annualCashRate) - d.strategic)) +
    total(lots.map(l => grow(l.original, l.arrival.day, l.boughtIndex === null ? episode.end : market[l.boughtIndex].day, scenario.annualCashRate) - l.original));
  const original = total(lots.map(l => l.original));
  const meanWaitSessions = total(lots.map(l => l.original * ((l.boughtIndex ?? episode.endIndex) - l.arrival.index))) / original;
  const trades = executed.flatMap(lot => lot.positions.map(position => {
    const index = lot.boughtIndex, prior = market[index - 1], observed = rule.tranches ? null : prior?.features[rule.feature] ?? null;
    return { day: market[index].day, side: 'buy', id: position.id, units: position.units, price: market[index].prices[position.index], notional: position.notional, fee: position.fee,
      arrivalDay: lot.arrival.day, signalDay: rule.tranches ? null : prior?.day ?? null, observed, waitSessions: index - lot.arrival.index,
      reason: rule.tranches ? 'fixed_tranche' : triggers(observed, rule.threshold) ? 'feature' : 'deadline' };
  }));
  for (let i = 0; i < protocol.portfolio.positions.length; i++) {
    const units = total(executed.flatMap(lot => lot.positions.filter(p => p.index === i).map(p => p.units)));
    if (!units) continue;
    const notional = units * market[episode.endIndex].prices[i];
    trades.push({ day: episode.end, side: 'sell', id: protocol.portfolio.positions[i].id, units, price: market[episode.endIndex].prices[i], notional, fee: notional * scenario.feeRate, reason: 'terminal_liquidation' });
  }
  // Only unit issuance is sequential. Every valuation is a direct sum of
  // independently priced claims, with no mutable cash or asset-unit account.
  let fundUnits = 0, peak = 1, maxDrawdownPp = 0;
  for (let at = episode.startIndex; at <= episode.endIndex; at++) {
    const arrival = flows.find(d => d.index === at);
    if (arrival) {
      const pre = total(claims.map(d => valueDeposit(d, market, at, scenario, { beforeDeposit: true })));
      fundUnits += arrival.amount / (fundUnits ? pre / fundUnits : 1);
    }
    const nav = total(claims.map(d => valueDeposit(d, market, at, scenario, { liquidate: at === episode.endIndex }))) / fundUnits;
    peak = Math.max(peak, nav); maxDrawdownPp = Math.min(maxDrawdownPp, 100 * (nav / peak - 1));
  }
  return { terminalWealth, contributed, accountReturnPp: 100 * (terminalWealth / contributed - 1), maxDrawdownPp,
    pendingCash, pendingLots: lots.length - executed.length, fees: buyFees + saleFees, interest, meanWaitSessions,
    externalFlows: flows.map(({ day, amount }) => ({ day, amount })), trades };
}

const windowKey = row => [row.fundingMode, row.years, row.partition, row.start, row.end].join('/');
function uniqueMap(rows, key, context) {
  const map = new Map();
  for (const row of rows) { const id = key(row); assert.ok(!map.has(id), context + ': duplicate ' + id); map.set(id, row); }
  return map;
}
function checkTrades(actual, expected, context) {
  const key = trade => [trade.day, trade.side, trade.id, trade.arrivalDay ?? ''].join('/');
  const sortedActual = actual.slice().sort((a, b) => key(a).localeCompare(key(b)));
  const sortedExpected = expected.slice().sort((a, b) => key(a).localeCompare(key(b)));
  assert.equal(sortedActual.length, sortedExpected.length, context + '.trade count');
  for (let i = 0; i < sortedExpected.length; i++) {
    const a = sortedActual[i], e = sortedExpected[i], prefix = context + '.trade.' + i;
    for (const field of ['day', 'side', 'id', 'arrivalDay', 'signalDay', 'reason', 'waitSessions']) assert.equal(a[field], e[field], prefix + '.' + field);
    for (const field of ['units', 'price', 'notional', 'fee']) close(a[field], e[field], prefix + '.' + field);
    if (e.observed === null || e.observed === undefined) assert.equal(a.observed, e.observed, prefix + '.observed');
    else close(a.observed, e.observed, prefix + '.observed');
    if (a.side === 'buy' && a.signalDay) assert.ok(a.signalDay < a.day, prefix + ': signal must precede trade');
  }
}
function checkAccount(actual, expected, context) {
  assert.deepEqual(actual.externalFlows, expected.externalFlows, context + '.externalFlows');
  for (const field of ['terminalWealth', 'contributed', 'accountReturnPp', 'maxDrawdownPp', 'pendingCash', 'pendingLots', 'fees', 'interest', 'meanWaitSessions'])
    close(actual[field], expected[field], context + '.' + field);
  checkTrades(actual.trades, expected.trades, context);
}
function checkFingerprints(actual, expected, context) {
  assert.equal(actual.protocol.sha256, expected.protocol, context + '.protocol');
  assert.equal(actual.catalog.sha256, expected.catalog, context + '.catalog');
  assert.equal(actual.histories.length, expected.histories.length, context + '.source count');
  for (const source of expected.histories) {
    const recorded = actual.histories.find(s => s.id === source.id);
    assert.ok(recorded, context + ': missing source ' + source.id);
    assert.equal(recorded.path, source.path, context + ': source path');
    assert.equal(recorded.sha256, source.sha256, context + ': source hash');
  }
}
function auditReports(report, audit, loaded) {
  const { protocol, market, fingerprints } = loaded;
  assert.equal(report.protocolId, protocol.id); assert.equal(audit.protocolId, protocol.id);
  assert.equal(report.researchOnly, true, 'the report must remain research only');
  checkFingerprints(report.inputs, fingerprints, 'report.inputs');
  checkFingerprints(audit.inputs, fingerprints, 'audit.inputs');
  const episodes = windows(market, protocol);
  const expectedWindows = protocol.funding.modes.flatMap(fundingMode => episodes.map(e => ({ ...e, fundingMode })));
  const actualWindows = uniqueMap(audit.windows, windowKey, 'audit.windows');
  const pairedWindows = uniqueMap(report.pairedBaseWindows, windowKey, 'report.pairedBaseWindows');
  assert.equal(actualWindows.size, expectedWindows.length, 'audit window coverage');
  assert.equal(pairedWindows.size, expectedWindows.length, 'report window coverage');
  assert.equal(report.coverage.first, market[0].day); assert.equal(report.coverage.end, market.at(-1).day);
  assert.equal(report.coverage.commonObservations, market.length); assert.equal(report.coverage.eligibleEpisodes, episodes.length);
  const rules = [...protocol.benchmarks, ...protocol.candidates], scenario = protocol.scenarios.find(s => s.id === 'base');
  assert.equal(scenario.annualCashRate, 0); assert.equal(scenario.feeRate, .001);
  const counts = {}, errors = { terminalWealth: 0, fees: 0, maxDrawdownPp: 0, observedSignal: 0 };
  let accountCount = 0, tradeCount = 0, flowCount = 0;
  // Monthly cash is the primary task; inspect it first, then existing cash.
  expectedWindows.sort((a, b) => (a.fundingMode === 'monthly_new_cash' ? 0 : 1) - (b.fundingMode === 'monthly_new_cash' ? 0 : 1));
  for (const episode of expectedWindows) {
    const key = windowKey(episode), actual = actualWindows.get(key), paired = pairedWindows.get(key);
    assert.ok(actual && paired, 'missing window ' + key); assert.equal(actual.scenario, 'base');
    assert.deepEqual(Object.keys(actual.rules).sort(), rules.map(r => r.id).sort(), key + '.audit rule registry');
    assert.deepEqual(Object.keys(paired.rules).sort(), rules.map(r => r.id).sort(), key + '.report rule registry');
    const independent = new Map(rules.map(rule => [rule.id, independentAccount(market, episode, rule, scenario, episode.fundingMode, protocol)]));
    for (const rule of rules) {
      const expected = independent.get(rule.id), recorded = actual.rules[rule.id], summary = paired.rules[rule.id], prefix = key + '/' + rule.id;
      checkAccount(recorded, expected, prefix);
      close(paired.contributed, expected.contributed, prefix + '.summary.contributed');
      close(summary.wealth, expected.terminalWealth, prefix + '.summary.wealth');
      for (const field of ['accountReturnPp', 'maxDrawdownPp', 'meanWaitSessions', 'pendingCash', 'fees']) close(summary[field], expected[field], prefix + '.summary.' + field);
      for (const [field, benchmark] of [['deltaImmediatePp', 'immediate'], ['deltaThreeTranchesPp', 'three_tranches']])
        close(summary[field], 100 * (expected.terminalWealth - independent.get(benchmark).terminalWealth) / expected.contributed, prefix + '.summary.' + field);
      for (const field of ['terminalWealth', 'fees', 'maxDrawdownPp']) errors[field] = Math.max(errors[field], Math.abs(recorded[field] - expected[field]));
      const expectedBuys = new Map(expected.trades.filter(t => t.side === 'buy').map(t => [[t.day, t.id, t.arrivalDay].join('/'), t]));
      for (const t of recorded.trades.filter(t => t.side === 'buy' && Number.isFinite(t.observed))) {
        const e = expectedBuys.get([t.day, t.id, t.arrivalDay].join('/'));
        errors.observedSignal = Math.max(errors.observedSignal, Math.abs(t.observed - e.observed));
      }
      accountCount++; tradeCount += expected.trades.length; flowCount += expected.externalFlows.length;
    }
    const group = [episode.fundingMode, episode.years, episode.partition].join('/'); counts[group] = (counts[group] || 0) + 1;
  }
  return { status: 'passed', protocolId: protocol.id, independentMethod: 'sum of separately valued deposit and tranche claims; independent source calendar and prior-close signals',
    scenario: 'base', personalTaxes: 'not audited; phase-one tax rates are zero', commonObservations: market.length, windows: expectedWindows.length,
    accounts: accountCount, trades: tradeCount, externalFlows: flowCount, windowsByGroup: counts, maximumAbsoluteDifference: errors,
    sourceFingerprints: fingerprints, limitations: ['Checks source consistency and arithmetic, not vendor price accuracy.', 'Stress-scenario full ledgers and selection/bootstrap inference are outside this audit.', 'Audit success does not establish an investment advantage or permit UI integration.'] };
}

function selfTest() {
  const p = { portfolio: { strategicCashWeight: .4, positions: [{ id: 'a', weight: .3 }, { id: 'b', weight: .3 }] },
    signal: { ma: 2, returnLookback: 1 }, funding: { amountPerDeposit: 100 } };
  const base = { annualCashRate: 0, feeRate: .001, capitalTaxRate: 0, dividendTaxRate: 0 };
  const market = attachFeatures([{ day: '2020-01-02', prices: [10, 20] }, { day: '2020-01-03', prices: [20, 10] }, { day: '2020-01-06', prices: [30, 40] }], p);
  close(market[1].reference, 115, 'hand weighted reference');
  close(market[2].reference, 235.75, 'reference preserves constant target exposure');
  close(market[1].features.deviation, 115 / 107.5 - 1, 'MA includes trailing closes');
  const e = { startIndex: 0, endIndex: 2, start: market[0].day, end: market[2].day, anniversary: '2021-01-02' };
  const immediate = independentAccount(market, e, { id: 'immediate', tranches: [0] }, base, 'existing_cash', p);
  close(immediate.terminalWealth, 40 + 150 * .999 / 1.001, 'hand terminal buy/sell fees');
  close(immediate.fees, (.06 + .15) / 1.001, 'hand sum nominal fees');
  close(immediate.contributed, 100, 'hand contribution');
  close(immediate.maxDrawdownPp, 40 + 60 / 1.001 - 100, 'initial purchase fee belongs in drawdown');
  const waiting = independentAccount(market, e, { id: 'wait', feature: 'drawdown', threshold: -1, maxWait: 3 }, base, 'existing_cash', p);
  close(waiting.terminalWealth, 100, 'outstanding lot remains cash'); assert.equal(waiting.trades.length, 0);
  const terminal = independentAccount(market, e, { id: 'wait', feature: 'drawdown', threshold: -1, maxWait: 2 }, base, 'existing_cash', p);
  close(terminal.terminalWealth, 40 + 60 * .999 / 1.001, 'deadline at terminal pays both fees');
  assert.ok(terminal.trades.every(t => t.day === e.end));
  const simple = [0, 1, 2].map(i => ({ day: ['2020-01-02', '2020-02-03', '2020-03-02'][i], prices: [10, 10], features: { drawdown: i === 0 ? -.2 : 0 } }));
  const se = { startIndex: 1, endIndex: 2, start: simple[1].day, end: simple[2].day, anniversary: simple[2].day };
  const triggered = independentAccount(simple, se, { id: 'lag', feature: 'drawdown', threshold: -.1, maxWait: 21 }, base, 'monthly_new_cash', p);
  assert.deepEqual(triggered.externalFlows, [{ day: '2020-02-03', amount: 100 }], 'anniversary funding is excluded');
  assert.equal(triggered.trades[0].day, '2020-02-03'); assert.equal(triggered.trades[0].signalDay, '2020-01-02');
  simple[1].features.drawdown = -.9; simple[0].features.drawdown = 0;
  const lagged = independentAccount(simple, se, { id: 'lag', feature: 'drawdown', threshold: -.1, maxWait: 21 }, base, 'monthly_new_cash', p);
  assert.equal(lagged.trades[0].day, '2020-03-02', 'same-close shock cannot trigger same-close purchase');
  const interest = independentAccount(market, e, { id: 'wait', feature: 'drawdown', threshold: -1, maxWait: 3 }, { ...base, annualCashRate: .02 }, 'existing_cash', p);
  close(interest.terminalWealth, 100 * Math.pow(1.02, 4 / YEAR), 'cash uses calendar-day interest');
  const tranches = independentAccount(market, e, { id: 'tranches', tranches: [0, 1, 3] }, base, 'existing_cash', p);
  close(tranches.terminalWealth, 60 + (50 + 55) * .999 / 1.001, 'separate tranche futures and pending cash');
  assert.equal(tranches.pendingLots, 1);
  assert.equal(addYears('2020-02-29', 1), '2021-02-28');
  checkAccount(structuredClone(immediate), immediate, 'matching hand account');
  const wrongFee = structuredClone(immediate); wrongFee.trades[0].fee += .01;
  assert.throws(() => checkAccount(wrongFee, immediate, 'tampered fee'));
  const wrongDate = structuredClone(triggered); wrongDate.trades[0].signalDay = wrongDate.trades[0].day;
  assert.throws(() => checkAccount(wrongDate, triggered, 'tampered same-close signal'));
  const wrongFlow = structuredClone(immediate); wrongFlow.externalFlows.push({ day: e.end, amount: 100 });
  assert.throws(() => checkAccount(wrongFlow, immediate, 'tampered future deposit'));
  assert.equal(triggers(.9 - 1, -.1), true, 'mathematically equal threshold survives binary rounding');
  assert.equal(triggers(-.1 - 2e-12, -.1), true, 'below threshold triggers');
  assert.equal(triggers(-.1 + 2e-12, -.1), false, 'above equality tolerance does not trigger');
  const assets = [{ id: 'a', currency: 'USD' }, { id: 'b', currency: 'USD' }];
  const history = new Map([
    ['a', { series: [['2020-01-02', 10], ['2020-01-03', 10], ['2020-01-04', 10], ['2020-01-10', 10], ['2020-01-11', 10]] }],
    ['b', { series: [['2020-01-02', 20], ['2020-01-03', 20], ['2020-01-10', 20], ['2020-01-11', 20]] }],
    ['fx', { series: [['2019-12-31', 2], ['2020-01-03', 3]] }]
  ]);
  const converted = makeMarket(assets, history, 'fx', { ...p, signal: { ...p.signal, warmupObservations: 0 } });
  assert.deepEqual(converted.map(r => r.day), ['2020-01-02', '2020-01-03', '2020-01-10'], 'no carried asset quote or FX older than seven days');
  assert.deepEqual(converted[0].prices, [20, 40], 'FX cannot look forward');
  assert.deepEqual(converted[1].prices, [30, 60], 'same-day FX enters both CNY prices');
  close(converted[1].reference, 130, 'strategic CNY cash is not converted into USD exposure');
  return { passed: true, cases: 20 };
}

module.exports = { readInputs, makeMarket, attachFeatures, windows, deposits, independentAccount, auditReports, selfTest };
if (require.main === module) {
  const args = process.argv.slice(2), selfTests = selfTest();
  if (args.length === 1 && args[0] === '--self-test') console.log(JSON.stringify({ independentAuditSelfTest: selfTests }, null, 2));
  else {
    assert.ok(args.length === 4 && args[0] === '--report' && args[2] === '--audit', 'usage: --self-test OR --report REPORT.json --audit LEDGERS.json');
    const reportBytes = fs.readFileSync(path.resolve(args[1])), auditBytes = fs.readFileSync(path.resolve(args[3]));
    const report = JSON.parse(reportBytes), ledger = JSON.parse(auditBytes);
    const enginePath = 'scripts/research_portfolio_entry.cjs', engineSha256 = digest(fs.readFileSync(path.join(ROOT, enginePath)));
    for (const payload of [report, ledger]) {
      assert.equal(payload.inputs.researchEngine.path, enginePath, 'research engine path');
      assert.equal(payload.inputs.researchEngine.sha256, engineSha256, 'research engine has changed since report generation');
    }
    const result = auditReports(report, ledger, readInputs());
    console.log(JSON.stringify({ ...result, selfTests, tolerance: { relativeOrAbsolute: EPS, signalEqualityAbsolute: SIGNAL_EPS, expression: 'abs(actual - expected) <= 1e-8 * max(1, abs(expected))' },
      reportSha256: digest(reportBytes), ledgerSha256: digest(auditBytes), protocolSha256: result.sourceFingerprints.protocol,
      engineSha256, checkerSha256: digest(fs.readFileSync(__filename)) }, null, 2));
  }
}
