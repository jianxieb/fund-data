#!/usr/bin/env node
'use strict';
// Offline, fixed-protocol research. Reference NAV supplies signals only;
// each account holds separate adjusted-price units of the actual products.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const Timing = require('../assets/portfolio-timing-model.js');
const ROOT = path.resolve(__dirname, '..'), DAY = 86400000, YEAR = 365.2425, SEED = 0x6d2b79f5, SIGNAL_TOLERANCE = 1e-12;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const stamp = day => Date.parse(day + 'T00:00:00Z');
const gap = (a, b) => (stamp(b) - stamp(a)) / DAY;
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mean = xs => xs.length ? sum(xs) / xs.length : null;
function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b), at = (sorted.length - 1) * fraction, i = Math.floor(at);
  return sorted[i] + (sorted[Math.ceil(at)] - sorted[i]) * (at - i);
}
function lowerBound(rows, day) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].day < day) lo = mid + 1; else hi = mid; }
  return lo;
}
function buildMarket(reference, prices, signalConfig = { ma: 200, returnLookback: 21 }) {
  assert.equal(reference.length, prices.length, 'reference and actual price calendars differ');
  let peak = 0, maSum = 0;
  return reference.map((row, i) => {
    assert.equal(row.day, prices[i].day, 'actual prices must be on the reference common close');
    assert.ok(Number.isFinite(row.value) && row.value > 0 && prices[i].prices.every(p => Number.isFinite(p) && p > 0), 'invalid source price');
    assert.ok(!i || row.day > reference[i - 1].day, 'common dates must strictly increase');
    peak = Math.max(peak, row.value); maSum += row.value;
    if (i >= signalConfig.ma) maSum -= reference[i - signalConfig.ma].value;
    return { day: row.day, prices: prices[i].prices.slice(), features: {
      drawdown: row.value / peak - 1,
      deviation: i + 1 >= signalConfig.ma ? row.value / (maSum / signalConfig.ma) - 1 : null,
      return21: i >= signalConfig.returnLookback ? row.value / reference[i - signalConfig.returnLookback].value - 1 : null
    } };
  });
}
function loadInputs(protocolPath = path.join(ROOT, 'docs/research/portfolio-entry-protocol-v1.json')) {
  const protocolText = fs.readFileSync(protocolPath), protocol = JSON.parse(protocolText);
  assert.equal(protocol.id, 'equal-budget-entry-v1');
  assert.equal(protocol.portfolio.currency, 'CNY'); assert.equal(protocol.portfolio.rebalance, 'none');
  const catalogPath = 'data/portfolio/catalog.js', catalogText = fs.readFileSync(path.join(ROOT, catalogPath), 'utf8');
  const match = catalogText.match(/^\s*var\s+PORTFOLIO_CATALOG\s*=\s*([\s\S]+);\s*$/);
  assert.ok(match, 'catalog format'); const catalog = JSON.parse(match[1]);
  const selected = protocol.portfolio.positions.map(position => catalog.assets.find(asset => asset.id === position.id));
  const histories = {}, sources = [...selected, catalog.fx].map(asset => {
    assert.ok(asset?.status === 'available' && asset.historyUrl && /^[a-f0-9]{64}$/.test(asset.sha256), 'missing source metadata');
    assert.match(asset.historyUrl, /^data\/portfolio\/[a-z]+\/[\w-]+\.json$/);
    const text = fs.readFileSync(path.join(ROOT, asset.historyUrl));
    assert.equal(sha256(text), asset.sha256, asset.id + ': history hash mismatch');
    const history = JSON.parse(text); P.validateHistory(asset, history);
    assert.equal(history.first, asset.first); assert.equal(history.asOf, asset.asOf); assert.equal(history.basis, asset.basis);
    histories[asset.id] = history;
    return { id: asset.id, path: asset.historyUrl, sha256: asset.sha256, first: history.first, asOf: history.asOf, basis: history.basis };
  });
  const sourceEnd = sources.map(source => source.asOf).sort()[0];
  const timing = Timing.analyze({ catalog: { assets: selected, fx: catalog.fx }, histories, fxHistory: histories[catalog.fx.id], config: {
    positions: protocol.portfolio.positions.map(p => ({ id: p.id, weight: p.weight * 100 })), currency: 'CNY', initial: 100, monthly: 0,
    years: 'common', rebalance: 'none', transactionFee: 0, feeBasis: 'net'
  } }, { today: sourceEnd });
  assert.ok(!['error', 'future'].includes(timing.status) && timing.curve?.length, timing.missing || 'missing reference history');
  const assetPrices = selected.map(asset => new Map(histories[asset.id].series));
  const priceRows = timing.curve.map(row => {
    const quote = P.at(histories[catalog.fx.id].series, row.day, 7);
    assert.ok(quote, row.day + ': missing prior FX');
    return { day: row.day, prices: selected.map((asset, i) => {
      assert.ok(assetPrices[i].has(row.day), row.day + ': missing actual asset close');
      return assetPrices[i].get(row.day) * (asset.currency === 'USD' ? quote.value : 1);
    }) };
  });
  return { protocol, market: buildMarket(timing.curve, priceRows, protocol.signal), inputs: {
    protocol: { path: path.relative(ROOT, protocolPath), sha256: sha256(protocolText), id: protocol.id, frozenDate: protocol.frozenDate },
    catalog: { path: catalogPath, sha256: sha256(catalogText), generatedAt: catalog.generatedAt }, histories: sources,
    referenceEngine: { path: 'assets/portfolio-timing-model.js', sha256: sha256(fs.readFileSync(path.join(ROOT, 'assets/portfolio-timing-model.js'))) },
    researchEngine: { path: 'scripts/research_portfolio_entry.cjs', sha256: sha256(fs.readFileSync(__filename)) },
    engineDependencies: ['assets/portfolio-model.js', 'assets/model.js'].map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(ROOT, file))) })),
    first: timing.first, end: timing.end, commonObservations: timing.curve.length
  } };
}
function createEpisodes(market, protocol) {
  const episodes = [], excluded = { warmup: 0, unmatured: 0, delayedExit: 0, crossingPartition: 0 };
  const horizons = [protocol.episodes.primaryHorizonYears, protocol.episodes.secondaryHorizonYears];
  for (let startIndex = 0; startIndex < market.length; startIndex++) {
    const start = market[startIndex].day;
    if (startIndex && start.slice(0, 7) === market[startIndex - 1].day.slice(0, 7)) continue;
    if (startIndex < protocol.signal.warmupObservations) { excluded.warmup++; continue; }
    const partition = protocol.episodes.partitions.find(p => (!p.start || start >= p.start) && (!p.end || start <= p.end));
    if (!partition) continue;
    for (const years of horizons) {
      const anniversary = P.addYears(start, years), endIndex = lowerBound(market, anniversary);
      if (endIndex >= market.length) { excluded.unmatured++; continue; }
      const end = market[endIndex].day;
      if (gap(anniversary, end) > 14) { excluded.delayedExit++; continue; }
      if (partition.end && end > partition.end) { excluded.crossingPartition++; continue; }
      episodes.push({ startIndex, endIndex, start, end, anniversary, years, partition: partition.id });
    }
  }
  return { episodes, excluded };
}
function fundingPlan(market, episode, mode, amount) {
  assert.ok(['existing_cash', 'monthly_new_cash'].includes(mode));
  const plan = [{ index: episode.startIndex, day: episode.start, amount }];
  if (mode === 'monthly_new_cash') for (let i = episode.startIndex + 1; i <= episode.endIndex; i++) {
    if (market[i].day >= episode.anniversary) break;
    if (market[i].day.slice(0, 7) !== market[i - 1].day.slice(0, 7)) plan.push({ index: i, day: market[i].day, amount });
  }
  return plan;
}
function simulateEpisode(market, episode, rule, scenario, mode, portfolio, amount = 100, audit = false) {
  assert.equal(scenario.capitalTaxRate, 0, 'phase one is personal-tax-free; nonzero tax requires the separate audited tax ledger');
  assert.equal(scenario.dividendTaxRate, 0, 'phase one is personal-tax-free');
  assert.ok(scenario.feeRate >= 0 && scenario.feeRate < 1 && scenario.annualCashRate >= 0);
  const riskWeight = sum(portfolio.positions.map(p => p.weight)), cashWeight = portfolio.strategicCashWeight;
  assert.ok(Math.abs(riskWeight + cashWeight - 1) < 1e-12 && riskWeight > 0);
  const plan = fundingPlan(market, episode, mode, amount), arrivals = new Map(plan.map(row => [row.index, row]));
  const units = portfolio.positions.map(() => 0), lots = [], trades = [], curve = [], auditCurve = audit === true || audit?.curve;
  let strategicCash = 0, fundUnits = 0, contributed = 0, fees = 0, interest = 0, peak = 1, mdd = 0;
  const pendingCash = () => sum(lots.filter(lot => lot.boughtIndex === null).map(lot => lot.cash));
  const wealth = prices => strategicCash + pendingCash() + sum(units.map((unit, i) => unit * prices[i]));
  for (let index = episode.startIndex; index <= episode.endIndex; index++) {
    const row = market[index], prices = row.prices;
    if (index > episode.startIndex && scenario.annualCashRate) {
      const factor = Math.pow(1 + scenario.annualCashRate, gap(market[index - 1].day, row.day) / YEAR);
      const before = strategicCash + pendingCash(); strategicCash *= factor;
      for (const lot of lots) if (lot.boughtIndex === null) lot.cash *= factor;
      interest += strategicCash + pendingCash() - before;
    }
    const arrival = arrivals.get(index);
    if (arrival) {
      const nav = fundUnits ? wealth(prices) / fundUnits : 1;
      assert.ok(Number.isFinite(nav) && nav > 0, 'invalid pre-deposit NAV');
      fundUnits += arrival.amount / nav; contributed += arrival.amount; strategicCash += arrival.amount * cashWeight;
      const offsets = rule.tranches || [null], part = arrival.amount * riskWeight / offsets.length;
      for (const offset of offsets) lots.push({ arrivalIndex: index, arrivalDay: row.day, offset, original: part, cash: part, boughtIndex: null });
    }
    const prior = market[index - 1];
    for (const lot of lots) {
      if (lot.boughtIndex !== null) continue;
      const wait = index - lot.arrivalIndex;
      const observed = prior?.features[rule.feature];
      const signalMatched = Number.isFinite(observed) && observed <= rule.threshold + SIGNAL_TOLERANCE;
      const triggered = lot.offset !== null ? wait >= lot.offset : signalMatched || wait >= rule.maxWait;
      if (!triggered) continue;
      const budget = lot.cash, usable = budget / (1 + scenario.feeRate);
      for (let assetIndex = 0; assetIndex < units.length; assetIndex++) {
        const notional = usable * portfolio.positions[assetIndex].weight / riskWeight, fee = notional * scenario.feeRate, boughtUnits = notional / prices[assetIndex];
        units[assetIndex] += boughtUnits; fees += fee;
        if (audit) trades.push({ day: row.day, side: 'buy', id: portfolio.positions[assetIndex].id, units: boughtUnits, price: prices[assetIndex], notional, fee,
          arrivalDay: lot.arrivalDay, signalDay: rule.tranches ? null : prior?.day ?? null, observed: rule.tranches ? null : observed, waitSessions: wait,
          reason: rule.tranches ? 'fixed_tranche' : signalMatched ? 'feature' : 'deadline' });
      }
      lot.cash = 0; lot.boughtIndex = index;
    }
    if (index === episode.endIndex) for (let assetIndex = 0; assetIndex < units.length; assetIndex++) {
      if (!units[assetIndex]) continue;
      const notional = units[assetIndex] * prices[assetIndex], fee = notional * scenario.feeRate;
      strategicCash += notional - fee; fees += fee;
      if (audit) trades.push({ day: row.day, side: 'sell', id: portfolio.positions[assetIndex].id, units: units[assetIndex], price: prices[assetIndex], notional, fee, reason: 'terminal_liquidation' });
      units[assetIndex] = 0;
    }
    const value = wealth(prices), nav = value / fundUnits;
    assert.ok(Number.isFinite(value) && strategicCash >= -1e-9 && lots.every(lot => lot.cash >= -1e-9), 'non-self-financing account');
    peak = Math.max(peak, nav); mdd = Math.min(mdd, (nav / peak - 1) * 100);
    if (auditCurve) curve.push({ day: row.day, value, nav, contributed, strategicCash, pendingCash: pendingCash(), units: units.slice(), fees, interest, drawdown: (nav / peak - 1) * 100 });
  }
  const originalBudget = sum(lots.map(lot => lot.original)), executed = lots.filter(lot => lot.boughtIndex !== null), executedBudget = sum(executed.map(lot => lot.original));
  const terminalWealth = wealth(market[episode.endIndex].prices);
  return { rule: rule.id, start: episode.start, end: episode.end, years: episode.years, partition: episode.partition, fundingMode: mode,
    terminalWealth, contributed, accountReturnPp: (terminalWealth / contributed - 1) * 100, navReturnPp: (terminalWealth / fundUnits - 1) * 100, maxDrawdownPp: mdd,
    meanWaitSessions: sum(lots.map(lot => lot.original * ((lot.boughtIndex ?? episode.endIndex) - lot.arrivalIndex))) / originalBudget,
    executedMeanWaitSessions: executedBudget ? sum(executed.map(lot => lot.original * (lot.boughtIndex - lot.arrivalIndex))) / executedBudget : null,
    pendingCash: pendingCash(), pendingLots: lots.length - executed.length, fees, interest, externalFlows: plan.map(({ day, amount }) => ({ day, amount })),
    ...(audit ? { trades } : {}), ...(auditCurve ? { curve, lots } : {}) };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function bootstrapMean(values, blockLength = 12, draws = 2000, seed = SEED) {
  const n = values.length, metadata = { method: 'non_circular_moving_block', prng: 'Mulberry32', seed, blockLength, draws, n };
  if (!n) return { ...metadata, status: 'no_samples', lower: null, upper: null };
  if (n <= blockLength) return { ...metadata, status: 'insufficient_blocks', lower: mean(values), upper: mean(values) };
  const random = mulberry32(seed), means = [];
  for (let draw = 0; draw < draws; draw++) {
    let total = 0, count = 0;
    while (count < n) { const start = Math.floor(random() * (n - blockLength + 1)); for (let i = 0; i < blockLength && count < n; i++, count++) total += values[start + i]; }
    means.push(total / n);
  }
  return { ...metadata, status: 'descriptive', lower: quantile(means, .025), upper: quantile(means, .975) };
}
function nonOverlap(rows) {
  let lastEnd = '', count = 0;
  for (const row of rows.slice().sort((a, b) => a.start.localeCompare(b.start))) if (row.start > lastEnd) { count++; lastEnd = row.end; }
  return count;
}
function summarizeAccounts(rows) {
  return { n: rows.length, nonOverlappingN: nonOverlap(rows), meanAccountReturnPp: mean(rows.map(r => r.accountReturnPp)), medianAccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .5),
    p10AccountReturnPp: quantile(rows.map(r => r.accountReturnPp), .1), medianMaxDrawdownPp: quantile(rows.map(r => r.maxDrawdownPp), .5), worstMaxDrawdownPp: rows.length ? Math.min(...rows.map(r => r.maxDrawdownPp)) : null,
    meanWaitSessions: mean(rows.map(r => r.meanWaitSessions)), meanFees: mean(rows.map(r => r.fees)), meanInterest: mean(rows.map(r => r.interest)), pendingEpisodes: rows.filter(r => r.pendingCash > 1e-9).length,
    contributedRange: rows.length ? { min: Math.min(...rows.map(r => r.contributed)), max: Math.max(...rows.map(r => r.contributed)) } : null,
    depositCountRange: rows.length ? { min: Math.min(...rows.map(r => r.externalFlows.length)), max: Math.max(...rows.map(r => r.externalFlows.length)) } : null };
}
function pairedSummary(candidate, benchmark, withBootstrap = true) {
  assert.equal(candidate.length, benchmark.length);
  const deltas = candidate.map((row, i) => {
    assert.equal(row.start, benchmark[i].start); assert.equal(row.end, benchmark[i].end);
    assert.deepEqual(row.externalFlows, benchmark[i].externalFlows, 'external funding differs');
    assert.equal(row.contributed, benchmark[i].contributed);
    return 100 * (row.terminalWealth - benchmark[i].terminalWealth) / row.contributed;
  });
  const a = summarizeAccounts(candidate), b = summarizeAccounts(benchmark), diff = key => a[key] === null || b[key] === null ? null : a[key] - b[key];
  return { n: candidate.length, nonOverlappingN: a.nonOverlappingN, identicalExternalFlows: true,
    meanDeltaPp: mean(deltas), medianDeltaPp: quantile(deltas, .5), positiveDeltaShare: deltas.length ? deltas.filter(delta => delta > 0).length / deltas.length : null,
    p10AccountReturnDifferencePp: diff('p10AccountReturnPp'), pairedDeltaP10Pp: quantile(deltas, .1), medianMaxDrawdownDifferencePp: diff('medianMaxDrawdownPp'), worstMaxDrawdownDifferencePp: diff('worstMaxDrawdownPp'),
    meanInterval: withBootstrap ? bootstrapMean(deltas) : null };
}
function economicGates(result, thresholds) {
  const tests = [
    ['meanDeltaPp', 'minMeanDeltaPp'], ['medianDeltaPp', 'minMedianDeltaPp'], ['positiveDeltaShare', 'minWinRate'],
    ['p10AccountReturnDifferencePp', 'minP10ReturnDifferencePp'], ['medianMaxDrawdownDifferencePp', 'minMedianDrawdownDifferencePp'], ['worstMaxDrawdownDifferencePp', 'minWorstDrawdownDifferencePp']
  ].map(([metric, threshold]) => ({ metric, value: result?.[metric] ?? null, minimum: thresholds[threshold], passed: Number.isFinite(result?.[metric]) && result[metric] >= thresholds[threshold] }));
  return { passed: tests.every(test => test.passed), tests };
}
function selectAndConfirm(results, protocol) {
  const find = (mode, partition, scenario, id) => results.find(row => row.fundingMode === mode && row.partition === partition && row.scenario === scenario && row.horizonYears === protocol.episodes.primaryHorizonYears)?.rules.find(rule => rule.id === id);
  return protocol.funding.modes.map(mode => {
    const development = protocol.candidates.map(rule => ({ id: rule.id, ...economicGates(find(mode, 'development', 'base', rule.id)?.vsImmediate, protocol.selection.economicGates), meanDeltaPp: find(mode, 'development', 'base', rule.id)?.vsImmediate.meanDeltaPp ?? null }));
    let winner = null;
    for (const rule of development) if (rule.passed && (!winner || rule.meanDeltaPp > winner.meanDeltaPp + 1e-10)) winner = rule;
    const confirmation = winner ? ['validation', 'replication'].map(partition => {
      const base = find(mode, partition, 'base', winner.id), economic = economicGates(base?.vsImmediate, protocol.selection.economicGates);
      const interval = base?.vsImmediate.meanInterval, intervalPassed = interval?.status === 'descriptive' && interval.lower > 0;
      const stress = protocol.scenarios.filter(scenario => scenario.id !== 'base').map(scenario => {
        const result = find(mode, partition, scenario.id, winner.id)?.vsImmediate;
        return { scenario: scenario.id, meanDeltaPp: result?.meanDeltaPp ?? null, medianDeltaPp: result?.medianDeltaPp ?? null, passed: result?.meanDeltaPp > 0 && result?.medianDeltaPp > 0 };
      });
      const tranche = base?.vsThreeTranches, tranchePassed = Number.isFinite(tranche?.meanDeltaPp) && tranche.meanDeltaPp >= 0 && tranche.medianDeltaPp >= 0;
      return { partition, economic, stress, vsThreeTranches: { meanDeltaPp: tranche?.meanDeltaPp ?? null, medianDeltaPp: tranche?.medianDeltaPp ?? null, passed: tranchePassed },
        meanInterval: interval, intervalPassed, passed: economic.passed && stress.every(s => s.passed) && tranchePassed && intervalPassed };
    }) : [];
    const historicalConfirmationPassed = !!winner && confirmation.every(row => row.passed);
    return { fundingMode: mode, development, selectedRule: winner?.id ?? null, confirmation, historicalConfirmationPassed,
      independentLedgerAudit: 'pending_external_review', productionEquivalentTaxValidation: 'not_performed_phase_one_personal_tax_free',
      integrationPassed: false, status: !winner ? 'no_development_candidate' : !historicalConfirmationPassed ? 'confirmation_failed' : 'awaiting_independent_and_tax_validation',
      reason: !winner ? 'No registered candidate passed all development gates; later periods cannot select a replacement.' : !historicalConfirmationPassed ? 'The frozen development winner failed one or more confirmation requirements.' : 'Numerical historical confirmation alone is insufficient for integration; independent and personal-tax validation remain required.' };
  });
}
function runResearch(loaded, options = {}) {
  const { protocol, market, inputs } = loaded, { episodes, excluded } = createEpisodes(market, protocol);
  const registry = [...protocol.benchmarks.map(rule => ({ ...rule, kind: 'benchmark' })), ...protocol.candidates.map(rule => ({ ...rule, kind: 'candidate' }))];
  const results = [], pairedBaseWindows = [];
  for (const scenario of protocol.scenarios) for (const mode of protocol.funding.modes) for (const years of [protocol.episodes.primaryHorizonYears, protocol.episodes.secondaryHorizonYears]) for (const partition of protocol.episodes.partitions) {
    const selected = episodes.filter(episode => episode.years === years && episode.partition === partition.id);
    const accounts = new Map(registry.map(rule => [rule.id, selected.map(episode => simulateEpisode(market, episode, rule, scenario, mode, protocol.portfolio, protocol.funding.amountPerDeposit,
      scenario.id === 'base' && options.auditWindows ? { curve: false } : false))]));
    const immediate = accounts.get('immediate'), tranches = accounts.get('three_tranches');
    results.push({ scenario: scenario.id, fundingMode: mode, horizonYears: years, partition: partition.id, episodesN: selected.length,
      rules: registry.map(rule => ({ id: rule.id, kind: rule.kind, summary: summarizeAccounts(accounts.get(rule.id)),
        vsImmediate: pairedSummary(accounts.get(rule.id), immediate, years === protocol.episodes.primaryHorizonYears),
        vsThreeTranches: pairedSummary(accounts.get(rule.id), tranches, years === protocol.episodes.primaryHorizonYears) })) });
    if (scenario.id === 'base') selected.forEach((episode, index) => {
      if (options.auditWindows) options.auditWindows.push({ start: episode.start, end: episode.end, years, partition: partition.id, fundingMode: mode, scenario: scenario.id,
        rules: Object.fromEntries(registry.map(rule => [rule.id, accounts.get(rule.id)[index]])) });
      pairedBaseWindows.push({ start: episode.start, end: episode.end, years, partition: partition.id, fundingMode: mode, contributed: immediate[index].contributed,
      rules: Object.fromEntries(registry.map(rule => { const row = accounts.get(rule.id)[index]; return [rule.id, { wealth: row.terminalWealth, accountReturnPp: row.accountReturnPp, maxDrawdownPp: row.maxDrawdownPp,
        deltaImmediatePp: 100 * (row.terminalWealth - immediate[index].terminalWealth) / row.contributed, deltaThreeTranchesPp: 100 * (row.terminalWealth - tranches[index].terminalWealth) / row.contributed,
        meanWaitSessions: row.meanWaitSessions, pendingCash: row.pendingCash, fees: row.fees }]; })) });
    });
  }
  return { schemaVersion: 1, protocolId: protocol.id, researchOnly: true, inputs, method: {
    priorExposure: protocol.priorExposure, account: 'individual adjusted-price units; CNY cash; no rebalancing; terminal liquidation', valuationCalendar: 'common actual asset closes only; not all calendar days or FX-only dates',
    signalExecution: 'strictly previous common close', signalComparisonTolerance: SIGNAL_TOLERANCE, taxes: 'before personal taxes; product expenses already embedded', cashRate: 'hypothetical net annual rate; actual-day compound /365.2425',
    waitMetric: 'initial risk-budget weighted common sessions; pending sub-lots included through terminal date; executed-only wait also calculated by ledger',
    bootstrap: { prng: 'Mulberry32', seed: SEED, blockLength: 12, draws: 2000, circular: false, resetPerSummary: true, shortSegmentPolicy: 'n<=12 insufficient_blocks; never passes integration' },
    selection: 'development/base/one-year only; candidate registry order breaks mean ties within 1e-10', productionIntegration: 'requires independent ledger/causality audit and production-equivalent personal-tax validation after numerical confirmation' },
    coverage: { first: market[0].day, end: market.at(-1).day, commonObservations: market.length, eligibleEpisodes: episodes.length, excluded,
      excludedUnits: { warmup: 'start_months', unmatured: 'horizon_episodes', delayedExit: 'horizon_episodes', crossingPartition: 'horizon_episodes' },
      groups: protocol.episodes.partitions.flatMap(partition => [1, 3].map(years => ({ partition: partition.id, years, n: episodes.filter(e => e.partition === partition.id && e.years === years).length }))) },
    results, selection: selectAndConfirm(results, protocol), pairedBaseWindows };
}
function statisticsHash(report) {
  return sha256(JSON.stringify({ results: report.results, selection: report.selection, pairedBaseWindows: report.pairedBaseWindows }));
}
if (require.main === module) {
  const args = process.argv.slice(2);
  assert.ok(!args.length || args.length === 2 && args[0] === '--audit-output', 'usage: node scripts/research_portfolio_entry.cjs [--audit-output /tmp/audit.json]');
  const output = path.join(ROOT, 'docs/evidence/portfolio-entry-research-v1.json');
  const previousText = fs.existsSync(output) ? fs.readFileSync(output) : null, previous = previousText ? JSON.parse(previousText) : null;
  const firstRun = previous?.numericalReview?.firstRun || (previous ? { reportSha256: sha256(previousText), statisticsSha256: statisticsHash(previous), protocolSha256: previous.inputs.protocol.sha256 } : null);
  const loaded = loadInputs(), auditWindows = args.length ? [] : null, result = runResearch(loaded, { auditWindows });
  if (firstRun) result.numericalReview = { fix: 'Inclusive threshold comparison uses 1e-12 floating-point tolerance; not a candidate threshold adjustment.', firstRun,
    currentStatisticsSha256: statisticsHash(result), unchangedFromFirstRun: statisticsHash(result) === firstRun.statisticsSha256 };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  if (auditWindows) { const auditPath = path.resolve(args[1]); fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify({ protocolId: loaded.protocol.id, inputs: result.inputs, windows: auditWindows }) + '\n'); }
  console.log(JSON.stringify({ output: path.relative(ROOT, output), protocolSha256: result.inputs.protocol.sha256, inputEnd: result.coverage.end, bytes: fs.statSync(output).size,
    coverage: result.coverage.groups, selection: result.selection.map(({ fundingMode, selectedRule, status, historicalConfirmationPassed, integrationPassed }) => ({ fundingMode, selectedRule, status, historicalConfirmationPassed, integrationPassed })) }, null, 2));
}
module.exports = { loadInputs, buildMarket, createEpisodes, fundingPlan, simulateEpisode, bootstrapMean, summarizeAccounts, pairedSummary, economicGates, selectAndConfirm, runResearch, quantile, statisticsHash };
