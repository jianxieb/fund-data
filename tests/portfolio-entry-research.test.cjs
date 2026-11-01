const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../scripts/research_portfolio_entry.cjs');
const P = require('../assets/portfolio-model.js');
const protocol = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v1.json')));
const portfolio = protocol.portfolio, immediate = protocol.benchmarks[0], base = { annualCashRate: 0, feeRate: 0, capitalTaxRate: 0, dividendTaxRate: 0 };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
function market(days, prices = days.map(() => [1, 1]), features = {}) {
  return days.map((day, i) => ({ day, prices: prices[i], features: { drawdown: 0, deviation: .1, return21: 0, ...features } }));
}
function episode(rows, endIndex = rows.length - 1, anniversary = rows[endIndex].day) {
  return { startIndex: 0, endIndex, start: rows[0].day, end: rows[endIndex].day, anniversary, years: 1, partition: 'development' };
}
function run(rows, rule = immediate, scenario = base, mode = 'existing_cash', e = episode(rows)) {
  return R.simulateEpisode(rows, e, rule, scenario, mode, portfolio, 100, true);
}
function days(start, end) {
  const out = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10)); }
  return out;
}

test('flat prices reconcile all funded cash, per-asset units, and both sides of fees', () => {
  const rows = market(['2020-01-01', '2020-01-02', '2020-01-03']);
  const zero = run(rows); close(zero.terminalWealth, 100); close(zero.accountReturnPp, 0); close(zero.maxDrawdownPp, 0);
  const fee = .001, paid = run(rows, immediate, { ...base, feeRate: fee });
  const expected = 40 + 60 * (1 - fee) / (1 + fee);
  close(paid.terminalWealth, expected); close(paid.fees, 100 - expected); close(paid.maxDrawdownPp, expected - 100);
  assert.deepEqual(paid.trades.map(t => t.side), ['buy', 'buy', 'sell', 'sell']);
  close(paid.trades[0].notional, 30 / (1 + fee)); close(paid.trades[0].fee, 30 * fee / (1 + fee));
  close(paid.curve[0].strategicCash, 40); assert.deepEqual(paid.curve.at(-1).units, [0, 0]);
});

test('each arrival buys actual asset shares at current prices; it never buys a synthetic target-weight NAV', () => {
  const rows = market(['2025-01-31', '2025-02-01', '2025-02-02'], [[1, 1], [2, 1], [1, 2]]);
  const result = run(rows, immediate, base, 'monthly_new_cash');
  close(result.contributed, 200); close(result.terminalWealth, 245); close(result.curve[1].strategicCash, 80);
  assert.deepEqual(result.trades.filter(t => t.side === 'buy').map(t => t.units), [30, 30, 15, 30]);
  assert.deepEqual(result.externalFlows, [{ day: '2025-01-31', amount: 100 }, { day: '2025-02-01', amount: 100 }]);
  assert.notEqual(result.terminalWealth, 230); assert.notEqual(result.terminalWealth, 264.5);
});

test('a signal formed at a close executes only at the following common close, including a rebound', () => {
  const rows = market(['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-06'], [[100, 100], [50, 50], [100, 100], [200, 200]]);
  rows[1].features.drawdown = -.5;
  const rule = { id: 'test', feature: 'drawdown', threshold: -.1, maxWait: 63 }, result = run(rows, rule);
  const buys = result.trades.filter(t => t.side === 'buy');
  assert.ok(buys.every(t => t.day === '2020-01-03' && t.signalDay === '2020-01-02' && t.price === 100));
  close(result.terminalWealth, 160); close(result.meanWaitSessions, 2);
  assert.equal(result.curve[1].pendingCash, 60);
});

test('unused cash and strategic cash earn the same actual-day compound rate without manufactured money', () => {
  const rows = market(['2020-01-01', '2020-06-01', '2021-01-01']), rule = { id: 'wait', feature: 'drawdown', threshold: -.5, maxWait: 63 };
  const result = run(rows, rule, { ...base, annualCashRate: .02 });
  const factor = 1.02 ** (366 / 365.2425);
  close(result.terminalWealth, 100 * factor); close(result.pendingCash, 60 * factor); close(result.interest, 100 * (factor - 1));
  assert.equal(result.pendingLots, 1); assert.equal(result.trades.length, 0); close(result.meanWaitSessions, 2);
  assert.equal(result.executedMeanWaitSessions, null);
});

test('three tranches split original budgets equally and accrue interest separately until their fixed dates', () => {
  const rows = market(['2020-01-01', '2020-04-01', '2020-07-01', '2021-01-01']);
  const result = run(rows, { id: 'three', tranches: [0, 1, 2] }, { ...base, annualCashRate: .02 });
  const factor = d => 1.02 ** ((Date.parse(d) - Date.parse(rows[0].day)) / 86400000 / 365.2425);
  const expected = 40 * factor(rows[3].day) + 20 + 20 * factor(rows[1].day) + 20 * factor(rows[2].day);
  close(result.terminalWealth, expected); close(result.meanWaitSessions, 1);
  assert.deepEqual(result.trades.filter(t => t.side === 'buy').map(t => t.day), [rows[0].day, rows[0].day, rows[1].day, rows[1].day, rows[2].day, rows[2].day]);
});

test('an independently due terminal-day purchase happens before liquidation and pays both fees', () => {
  const rows = market(['2020-01-01', '2020-01-02', '2020-01-03']);
  const result = run(rows, { id: 'deadline', feature: 'drawdown', threshold: -.5, maxWait: 2 }, { ...base, feeRate: .001 });
  assert.ok(result.trades.every(t => t.day === '2020-01-03'));
  assert.deepEqual(result.trades.map(t => t.side), ['buy', 'buy', 'sell', 'sell']);
  close(result.terminalWealth, 40 + 60 * .999 / 1.001); assert.equal(result.pendingCash, 0);
  const earlier = run(rows, { id: 'deadline', feature: 'drawdown', threshold: -.5, maxWait: 2 }, base, 'existing_cash', episode(rows, 1));
  assert.equal(earlier.trades.length, 0); assert.equal(earlier.pendingCash, 60);
});

test('all seven candidates and two benchmarks receive identical monthly cash flows, including an allowed thirteenth deposit', () => {
  const dateRows = days('2023-01-03', '2024-01-03'), rows = market(dateRows), e = episode(rows, rows.length - 1, '2024-01-03');
  const expected = R.fundingPlan(rows, e, 'monthly_new_cash', 100);
  assert.equal(expected.length, 13); assert.equal(expected.at(-1).day, '2024-01-01');
  for (const rule of [...protocol.candidates, ...protocol.benchmarks]) {
    const result = run(rows, rule, base, 'monthly_new_cash', e);
    assert.deepEqual(result.externalFlows, expected.map(({ day, amount }) => ({ day, amount })));
    close(result.contributed, 1300); close(result.terminalWealth, 1300);
    assert.ok(result.curve.every(row => row.strategicCash >= 0 && row.pendingCash >= 0));
  }
});

test('future appends and future price mutations cannot change earlier buys or funded amounts', () => {
  const rows = market(days('2020-01-01', '2020-03-02')), cutoff = 22, rule = { id: 'wait', feature: 'drawdown', threshold: -.1, maxWait: 3 };
  rows[1].features.drawdown = -.2;
  const short = run(rows.slice(0, cutoff + 1), rule), full = run(rows, rule);
  const before = full.trades.filter(t => t.side === 'buy' && t.day <= rows[cutoff].day);
  assert.deepEqual(short.trades.filter(t => t.side === 'buy'), before);
  const changed = structuredClone(rows); changed.slice(cutoff + 1).forEach(row => { row.prices = [1e6, 1e-3]; row.features.drawdown = -.99; });
  const after = run(changed, rule);
  assert.deepEqual(after.trades.filter(t => t.side === 'buy' && t.day <= rows[cutoff].day), before);
  assert.deepEqual(after.curve.filter(row => row.day <= rows[cutoff].day), full.curve.filter(row => row.day <= rows[cutoff].day));
});

test('signals preserve all-history peaks and compute inclusive MA/lookback while the account reads only the prior row', () => {
  const reference = [{ day: '2020-01-01', value: 2 }, { day: '2020-01-02', value: 1 }, { day: '2020-01-03', value: 1.5 }];
  const rows = R.buildMarket(reference, reference.map(row => ({ day: row.day, prices: [10, 20] })), { ma: 2, returnLookback: 1 });
  close(rows[1].features.drawdown, -.5); close(rows[2].features.drawdown, -.25);
  close(rows[1].features.deviation, 1 / 1.5 - 1); close(rows[2].features.return21, .5);
  assert.equal(rows[0].features.deviation, null);
});

test('inclusive thresholds tolerate binary roundoff but do not accept a feature genuinely above the threshold', () => {
  const reference = [{ day: '2020-01-01', value: 1 }, { day: '2020-01-02', value: .9 }, { day: '2020-01-03', value: .95 }];
  const rows = R.buildMarket(reference, reference.map(row => ({ day: row.day, prices: [row.value, row.value] })), { ma: 2, returnLookback: 1 });
  assert.ok(rows[1].features.drawdown > -.1); // 0.9 / 1 - 1 has binary roundoff.
  const rule = { id: 'exact', feature: 'drawdown', threshold: -.1, maxWait: 63 };
  const exact = run(rows, rule), buys = exact.trades.filter(t => t.side === 'buy');
  assert.equal(buys.length, 2); assert.ok(buys.every(t => t.day === rows[2].day && t.reason === 'feature'));
  const above = structuredClone(rows); above[1].features.drawdown = -.1 + 1e-8;
  assert.equal(run(above, rule).trades.length, 0);
});

test('episode starts require 200 prior observations and full terminal outcomes remain in their original partition', () => {
  const rows = market(days('2010-01-01', '2026-10-30')), result = R.createEpisodes(rows, protocol);
  assert.ok(result.episodes.length > 0 && result.excluded.crossingPartition > 0 && result.excluded.unmatured > 0);
  for (const e of result.episodes) {
    assert.ok(e.startIndex >= 200); assert.notEqual(rows[e.startIndex - 1].day.slice(0, 7), e.start.slice(0, 7));
    assert.equal(e.anniversary, P.addYears(e.start, e.years)); assert.ok(e.end >= e.anniversary);
    assert.ok((Date.parse(e.end) - Date.parse(e.anniversary)) / 86400000 <= 14);
    const p = protocol.episodes.partitions.find(p => p.id === e.partition);
    assert.ok(!p.end || e.end <= p.end); assert.ok(!p.start || e.start >= p.start);
    assert.ok(!rows[e.endIndex - 1] || rows[e.endIndex - 1].day < e.anniversary);
  }
});

test('paired summaries use differences between marginal p10s and drawdowns, while preserving identical flows', () => {
  const make = (value, i, dd) => ({ start: `2020-0${i + 1}-01`, end: `2021-0${i + 1}-01`, contributed: 100, terminalWealth: 100 + value, accountReturnPp: value, maxDrawdownPp: dd,
    externalFlows: [{ day: `2020-0${i + 1}-01`, amount: 100 }], meanWaitSessions: 1, fees: 0, interest: 0, pendingCash: 0 });
  const candidates = [make(0, 0, -10), make(100, 1, -5)], baseline = [make(20, 0, -20), make(0, 1, -10)];
  const result = R.pairedSummary(candidates, baseline, false);
  close(result.meanDeltaPp, 40); close(result.p10AccountReturnDifferencePp, 8); close(result.pairedDeltaP10Pp, -8);
  close(result.medianMaxDrawdownDifferencePp, 7.5); close(result.worstMaxDrawdownDifferencePp, 10);
  baseline[0].externalFlows[0].amount = 101; assert.throws(() => R.pairedSummary(candidates, baseline), /funding/);
});

test('bootstrap is deterministic, never promotes a one-block segment, and returns exact constant-series means', () => {
  const xs = Array.from({ length: 37 }, (_, i) => i - 18);
  assert.deepEqual(R.bootstrapMean(xs), R.bootstrapMean(xs));
  for (const n of [1, 11, 12]) assert.equal(R.bootstrapMean(Array(n).fill(2)).status, 'insufficient_blocks');
  const constant = R.bootstrapMean(Array(24).fill(2)); assert.equal(constant.lower, 2); assert.equal(constant.upper, 2);
  assert.equal(constant.status, 'descriptive'); assert.equal(R.bootstrapMean([]).status, 'no_samples');
});

test('development failure cannot be rescued by favorable later results; confirmation never means tax validation passed', () => {
  const passing = { n: 30, meanDeltaPp: 1, medianDeltaPp: 1, positiveDeltaShare: .7, p10AccountReturnDifferencePp: 0, medianMaxDrawdownDifferencePp: 0, worstMaxDrawdownDifferencePp: 0,
    meanInterval: { status: 'descriptive', lower: .1, upper: 2 } };
  const rows = protocol.funding.modes.flatMap(fundingMode => protocol.scenarios.flatMap(scenario => protocol.episodes.partitions.map(partition => ({ fundingMode, scenario: scenario.id, partition: partition.id, horizonYears: 1,
    rules: protocol.candidates.map(rule => ({ id: rule.id, vsImmediate: { ...passing, meanDeltaPp: partition.id === 'development' ? .1 : 100 }, vsThreeTranches: { meanDeltaPp: 1, medianDeltaPp: 1 } })) }))));
  assert.ok(R.selectAndConfirm(rows, protocol).every(row => row.selectedRule === null && !row.integrationPassed));
  rows.filter(row => row.partition === 'development').forEach(row => row.rules.forEach(rule => { rule.vsImmediate.meanDeltaPp = 1; }));
  const selected = R.selectAndConfirm(rows, protocol);
  assert.ok(selected.every(row => row.selectedRule === protocol.candidates[0].id && row.historicalConfirmationPassed && !row.integrationPassed));
  assert.ok(selected.every(row => /not_performed/.test(row.productionEquivalentTaxValidation)));
  rows.find(row => row.fundingMode === 'monthly_new_cash' && row.partition === 'replication' && row.scenario === 'base').rules[0].vsImmediate.meanInterval.status = 'insufficient_blocks';
  const noSwitch = R.selectAndConfirm(rows, protocol).find(row => row.fundingMode === 'monthly_new_cash');
  assert.equal(noSwitch.historicalConfirmationPassed, false); assert.equal(noSwitch.selectedRule, protocol.candidates[0].id);
});

test('phase one refuses a nonzero personal tax assumption rather than silently treating it as zero', () => {
  assert.throws(() => run(market(['2020-01-01', '2020-01-02']), immediate, { ...base, capitalTaxRate: .2 }), /personal-tax-free/);
});
