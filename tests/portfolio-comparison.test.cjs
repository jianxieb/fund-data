const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');

function fixture(config = {}) {
  const days = Array.from({ length: 850 }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
  const assets = ['USD', 'TQQQ', 'QQQ', 'SOXX'].map(code => ({ id: 'us:' + code, code, name: code,
    kind: 'etf', market: 'us', currency: 'USD', status: 'available' }));
  const histories = Object.fromEntries(assets.map(asset => [asset.id, {
    schemaVersion: 1, id: asset.id, currency: 'USD', basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day,
      ['QQQ', 'SOXX'].includes(asset.code) ? i < 600 ? 100 : i < 640 ? 70 : 110 : 10 + i / 100]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} }
  }]));
  const marketContext = { schemaVersion: 1, status: 'available', first: days[0], asOf: days.at(-1),
    series: days.map((day, i) => [day, i >= 630 && i < 660 ? 40 : 20, 30]),
    sources: Object.fromEntries(['VIX', 'VIX3M'].map(id => [id, {
      url: `https://cdn.cboe.com/api/global/us_indices/daily_prices/${id}_History.csv`, first: days[0], asOf: days.at(-1),
      sha256: 'a'.repeat(64), retrievedAt: '2024-01-01T00:00:00Z'
    }])) };
  return { days, catalog: { assets }, histories, marketContext, config: {
    positions: [{ id: 'us:USD', weight: 30 }, { id: 'us:TQQQ', weight: 30 }], initial: 100000, monthly: 2000,
    currency: 'USD', years: 'custom', start: days[590], end: days[730], initialMethod: 'lump_sum',
    contributionMethod: 'dca_ma_contrarian', rebalance: 'month', transactionFee: .1, feeBasis: 'net',
    tax: { usCapitalGains: 20, usDividend: 20 }, benchmarkId: 'us:QQQ', ...config
  } };
}

test('advanced strategy comparison runs independent full-budget accounts with identical settings', () => {
  const input = fixture(), before = JSON.stringify(input), comparison = P.simulateStrategies(input);
  assert.equal(comparison.error, undefined);
  assert.equal(comparison.strategies.length, 10);
  assert.equal(comparison.start, input.config.start); assert.equal(comparison.end, input.config.end);
  assert.equal(JSON.stringify(input), before);
  assert.ok(comparison.strategies.every(row => !/^(lump_sum|tranche_)/.test(row.id)));
  for (const row of comparison.strategies) {
    assert.equal(row.error, undefined, row.label + ': ' + row.error);
    const expected = P.simulate({ ...input, config: { ...input.config, initialMethod: row.id, benchmarkId: '' } });
    assert.deepEqual(row.result, expected);
    assert.equal(row.result.config.initial, 100000);
    assert.equal(row.result.config.monthly, 2000);
    assert.equal(row.result.config.contributionMethod, 'dca_ma_contrarian');
    assert.equal(row.result.benchmark, null);
    assert.equal(row.result.snapshots, undefined);
    assert.deepEqual(row.result.curve.map(p => p.day), comparison.strategies[0].result.curve.map(p => p.day));
  }
  const low10 = comparison.strategies.find(row => row.id === 'opportunity_discount_10').result;
  const low20 = comparison.strategies.find(row => row.id === 'opportunity_discount_20').result;
  assert.ok(low10.curve[0].positionPrincipal > low20.curve[0].positionPrincipal);
  assert.notEqual(low10.value, low20.value);
});

test('incompatible selections and missing reference data fail only affected comparison rows', () => {
  const input = fixture({ positions: [{ id: 'us:TQQQ', weight: 30 }], initialMethod: 'relative_strength_rotation' });
  input.marketContext = null;
  delete input.histories['us:QQQ'];
  const comparison = P.simulateStrategies(input);
  assert.equal(comparison.error, undefined);
  for (const id of ['drawdown_ladder', 'ma200_hold', 'cash_topup']) assert.ok(comparison.strategies.find(row => row.id === id).result);
  const rotation = comparison.strategies.find(row => row.id === 'relative_strength_rotation');
  assert.match(rotation.error, /均有正权重/); assert.equal(rotation.errorField, 'initialMethod');
  assert.match(comparison.strategies.find(row => row.id === 'qqq_bear_confirm').error, /QQQ/);
  assert.match(comparison.strategies.find(row => row.id === 'vix_panic_reentry').error, /VIX/);
  const invalid = P.simulateStrategies({ ...input, config: { ...input.config, initial: -1 } });
  assert.match(invalid.error, /初始投入/); assert.deepEqual(invalid.strategies, []);
});

test('both reserve variants execute their own first purchase instead of borrowing another strategy’s ledger', () => {
  const comparison = P.simulateStrategies(fixture({ monthly: 0, transactionFee: 0, rebalance: 'none', positions: [{ id: 'us:TQQQ', weight: 30 }] }));
  for (const [method, amount, reserved] of [['opportunity_discount_10', 27000, 3000], ['opportunity_discount_20', 24000, 6000]]) {
    const result = comparison.strategies.find(row => row.id === method).result;
    assert.ok(result);
    const first = result.curve[0], buys = result.transactions.filter(t => t.day === result.start && t.side === 'buy');
    assert.equal(buys.length, 1); assert.equal(buys[0].amount, amount);
    assert.equal(first.positionPrincipal, amount); assert.equal(first.systematicCash[1], reserved);
    assert.equal(first.cash, 100000 - amount); assert.equal(result.config.initialMethod, method);
  }
});

test('historical strategy status uses that date’s recorded signal and preserves missing evidence', () => {
  const input = fixture({ initialMethod: 'dual_risk_guard', rebalance: 'none', monthly: 0 });
  const result = P.simulate(input), day = input.days[642], status = P.strategyStatus(result, day);
  assert.equal(result.error, undefined);
  assert.equal(status.day, day);
  assert.strictEqual(status.observation, result.systematic.daily.find(row => row.day === day));
  assert.equal(status.signalDay, day);
  assert.ok(status.sourceDay < day);
  assert.deepEqual(status.nextPlan, status.observation.nextPlan);
  assert.equal(status.account.value, result.curve.find(row => row.day === day).value);
  assert.equal(status.nextPlanAvailable, true);
  assert.equal(P.strategyStatus(result, input.days[589]), null);
  assert.equal(P.strategyStatus(result, 'not-a-date'), null);
  assert.equal(P.strategyStatus(result, input.days[800]).day, result.end);

  const partial = fixture({ initialMethod: 'vix_panic_reentry', start: input.days[629], end: input.days[637] });
  partial.marketContext.series = partial.marketContext.series.slice(0, 630); partial.marketContext.asOf = input.days[629];
  const last = P.simulate(partial), unavailable = P.strategyStatus(last);
  assert.equal(last.error, undefined);
  assert.equal(unavailable.status, 'missing'); assert.match(unavailable.detail, /超过7日/);
  assert.equal(unavailable.nextPlan, null);
});

test('non-systematic rows show actual exposure and distinguish unrecorded historical orders from no pending order', () => {
  const input = fixture({ monthly: 0, initialMethod: 'cash_topup' }), result = P.simulate(input);
  const earlier = P.strategyStatus(result, input.days[600]), last = P.strategyStatus(result);
  assert.equal(result.error, undefined);
  assert.equal(earlier.nextPlanAvailable, false);
  assert.equal(earlier.nextPlan, null);
  assert.equal(last.nextPlanAvailable, true);
  assert.equal(last.account.securitiesValue, result.grossValue - result.cash);
  const ladder = P.simulate({ ...input, config: { ...input.config, initialMethod: 'drawdown_ladder' } });
  const first = P.strategyStatus(ladder, ladder.start);
  assert.equal(first.account.initialReserve, 75000);
  assert.equal(first.label, '等待阶梯加仓');
  const qqq = P.simulate({ ...input, config: { ...input.config, initialMethod: 'qqq_bear_confirm' } });
  assert.equal(P.strategyStatus(qqq, input.days[600]).nextSignal, null);
  assert.deepEqual(P.strategyStatus(qqq).nextSignal, qqq.qqqNextSignal);

  const closed = P.simulate({ ...input, config: { ...input.config, tax: { ...input.config.tax, liquidate: true } } });
  const state = P.strategyStatus(closed);
  assert.equal(state.status, 'liquidated'); assert.equal(state.nextPlanAvailable, true); assert.equal(state.nextPlan, null);
  assert.ok(Math.abs(state.account.securitiesValue) < 1e-7);
});

test('a valuation-only day cannot advance a moving-average strategy out of warmup', () => {
  const input = fixture({ initialMethod: 'ma200_hold', monthly: 0, rebalance: 'none' });
  input.config.start = input.days[199]; input.config.end = input.days[205];
  input.histories['us:TQQQ'].series = input.histories['us:TQQQ'].series.filter(([day]) => day !== input.days[200]);
  const result = P.simulate(input);
  assert.equal(result.error, undefined);
  assert.equal(result.strategy.warmupDays, 199);
  assert.equal(P.strategyStatus(result, input.days[199]).status, 'warming-up');
  assert.equal(P.strategyStatus(result, input.days[200]).status, 'warming-up');
  assert.equal(P.strategyStatus(result, input.days[200]).observationDay, input.days[199]);
  assert.equal(P.strategyStatus(result, input.days[201]).status, 'ready');
});
