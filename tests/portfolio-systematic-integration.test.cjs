const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const sum = a => a.reduce((x, y) => x + y, 0);
const methods = ['vix_panic_reentry', 'dual_risk_guard', 'relative_strength_rotation'];
function fixture(method = methods[0], config = {}) {
  const days = Array.from({ length: 850 }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
  const assets = ['USD', 'TQQQ', 'QQQ', 'OTHER'].map(code => ({ id: 'us:' + code, code, name: code, kind: 'etf', market: 'us', currency: 'USD', status: 'available' }));
  const histories = Object.fromEntries(assets.map(asset => [asset.id, { schemaVersion: 1, id: asset.id, currency: 'USD', basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, asset.code === 'USD' ? 10 * Math.exp(i / 700) : asset.code === 'QQQ' ? i < 300 ? 100 : i < 350 ? 70 : 110 : 10]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} }
  }]));
  const marketContext = { schemaVersion: 1, status: 'available', first: days[0], asOf: days.at(-1),
    series: days.map((day, i) => [day, i >= 300 && i < 330 ? 40 : 20, 30]), sources: Object.fromEntries(['VIX', 'VIX3M'].map(id => [id, {
      url: `https://cdn.cboe.com/api/global/us_indices/daily_prices/${id}_History.csv`, first: days[0], asOf: days.at(-1), sha256: 'a'.repeat(64), retrievedAt: '2024-01-01T00:00:00Z'
    }])) };
  return { days, catalog: { assets }, histories, marketContext, config: { positions: [{ id: 'us:USD', weight: 30 }, { id: 'us:TQQQ', weight: 30 }],
    initial: 100, monthly: 0, currency: 'USD', years: 'custom', start: days[method === methods[2] ? 490 : 290], end: days[method === methods[2] ? 800 : 400],
    initialMethod: method, contributionMethod: 'dca_month', rebalance: 'none', transactionFee: .1, feeBasis: 'net', tax: { usCapitalGains: 20, usDividend: 20 }, ...config } };
}
function run(input) { const result = P.simulate(input); assert.equal(result.error, undefined, result.error); return result; }
function strategyTrades(result) { return result.transactions.filter(t => methods.includes(t.reason)); }
function reconcile(input, result) {
  const selected = input.config.positions.filter(p => p.weight > 0).map(p => p.id), units = Object.fromEntries(selected.map(id => [id, 0]));
  let cash = 0, contributed = 0;
  const price = (id, day) => P.at(input.histories[id].series, day).value;
  for (const row of result.curve) {
    cash += row.contributed - contributed; contributed = row.contributed;
    for (const e of result.taxEvents.filter(e => e.day === row.day && e.type === 'dividend')) units[e.id] -= e.tax / price(e.id, row.day);
    for (const t of result.transactions.filter(t => t.day === row.day)) {
      const delta = (t.side === 'buy' ? 1 : -1) * t.amount;
      units[t.id] += delta / price(t.id, t.day); cash -= delta + t.fee + t.tax;
    }
    near(row.cash, cash); near(row.grossValue, cash + sum(selected.map(id => units[id] * price(id, row.day))));
    near(row.value, row.grossValue - row.taxReserve);
    assert.ok(sum(row.systematicCash) >= -1e-6 && sum(row.systematicCash) <= row.cash + 1e-6);
  }
  near(result.contributed, contributed); near(result.tradeCost, sum(result.transactions.map(t => t.fee)));
  assert.ok(strategyTrades(result).every(t => t.signalDay < t.day));
}

test('all three strategies first invest exactly like lump and preserve the full cash ledger', () => {
  for (const method of methods) {
    const input = fixture(method), r = run(input), lump = run({ ...input, config: { ...input.config, initialMethod: 'lump_sum' } });
    assert.deepEqual(r.transactions.filter(t => t.day === r.start), lump.transactions.filter(t => t.day === lump.start));
    reconcile(input, r);
    assert.ok(strategyTrades(r).length > 0);
  }
});

test('VIX signal uses prior source close and acts next common close; dual waits for QQQ too', () => {
  const v = fixture(), vr = run(v);
  assert.deepEqual(strategyTrades(vr).map(t => [t.day, t.side, t.signalDay]), [[v.days[311], 'sell', v.days[310]], [v.days[332], 'buy', v.days[331]]]);
  const d = fixture('dual_risk_guard'), dr = run(d);
  assert.deepEqual(strategyTrades(dr).map(t => [t.day, t.side, t.signalDay]), [[d.days[311], 'sell', d.days[310]], [d.days[353], 'buy', d.days[352]]]);
});

test('pending reentry amount is fixed before a next-day price jump and uses sale cash only', () => {
  const input = fixture(), before = run({ ...input, config: { ...input.config, end: input.days[331] } });
  const plan = before.systematic.nextPlan;
  assert.equal(plan.signalDay, input.days[331]); assert.ok(plan.buyAmount > 0);
  const changed = structuredClone(input); changed.histories['us:TQQQ'].series[332][1] = 100;
  const r = run(changed), buy = strategyTrades(r).find(t => t.side === 'buy');
  near(buy.amount, plan.buyAmount); near(buy.fee, plan.buyFee);
  const sale = strategyTrades(r).find(t => t.side === 'sell');
  near(buy.amount + buy.fee, sale.amount - sale.fee - sale.tax);
  reconcile(changed, r);
});

test('pending sales keep signal-date units despite an execution-day jump and dividend tax', () => {
  const input = fixture(), prior = run({ ...input, config: { ...input.config, end: input.days[310] } });
  const order = prior.systematic.nextPlan.orders[0], changed = structuredClone(input);
  changed.histories['us:TQQQ'].series[311][1] = 100;
  changed.histories['us:TQQQ'].dividendEvidence.fractions[input.days[311]] = .1;
  const r = run(changed), sale = strategyTrades(r).find(t => t.side === 'sell');
  // Full exit may only clip to units still available after the intervening dividend tax.
  near(sale.amount / 100, order.units * .98); assert.equal(sale.signalDay, input.days[310]);
  reconcile(changed, r);
});

test('monthly income, rebalancing, third asset and full-stock weights use executed allocation', () => {
  for (const method of methods) for (const rebalance of ['none', 'month']) {
    const positions = [{ id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 30 }, { id: 'us:OTHER', weight: 20 }];
    const input = fixture(method, { monthly: 10, rebalance, positions }), r = run(input);
    reconcile(input, r); assert.ok(r.contributed > 100);
    assert.ok(strategyTrades(r).every(t => t.id !== 'us:OTHER'));
    for (const t of r.transactions.filter(t => t.id === 'us:TQQQ' && t.side === 'buy' && ['contribution', 'rebalance'].includes(t.reason))) {
      assert.ok(r.curve.find(row => row.day === t.day).systematicTargets[1] > 0);
    }
    assert.ok(r.holdings.find(h => h.id === 'us:OTHER').bought > 0);
  }
  for (const method of methods) {
    const input = fixture(method, { positions: [{ id: 'us:USD', weight: 50 }, { id: 'us:TQQQ', weight: 50 }] });
    const r = run(input); reconcile(input, r); assert.ok(strategyTrades(r).length > 0);
  }
});

test('zero initial capital with monthly deposits still updates risk allocation and stays self-financing', () => {
  for (const method of methods) {
    const input = fixture(method, { initial: 0, monthly: 10 }), r = run(input);
    reconcile(input, r); assert.ok(r.contributed > 0); assert.ok(r.systematic.planCount > 0);
  }
});

test('complete exits remain exactly flat when account size magnifies floating-point division', () => {
  for (const method of methods) for (const initial of [100000, 1000000, 100000000]) {
    const input = fixture(method, { initial }), r = run(input);
    reconcile(input, r);
    assert.ok(r.holdings.every(h => h.grossValue >= 0 && h.costBasis >= 0));
  }
});

test('a third-market holiday delays execution to the next shared close without resizing', () => {
  const input = fixture(undefined, { positions: [{ id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 30 }, { id: 'us:OTHER', weight: 10 }] });
  const h = input.histories['us:OTHER']; h.series = h.series.filter(r => r[0] !== input.days[311]);
  const r = run(input), sale = strategyTrades(r).find(t => t.side === 'sell');
  assert.equal(sale.signalDay, input.days[310]); assert.equal(sale.day, input.days[312]);
  reconcile(input, r);
});

test('data identity errors stop the run while a final missing observation exposes unavailable next state', () => {
  const input = fixture(); input.marketContext.sources.VIX.url = 'https://example.com/fake.csv';
  assert.match(P.simulate(input).error, /官方/);
  const dual = fixture('dual_risk_guard'); dual.catalog.assets.find(a => a.id === 'us:QQQ').code = 'QQQM';
  assert.match(P.simulate(dual).error, /QQQ.*身份/);
  const stale = fixture(); stale.marketContext.series = stale.marketContext.series.slice(0, 300); stale.marketContext.asOf = stale.days[299];
  assert.match(P.simulate(stale).error, /超过7日/);
  const final = fixture(); final.config.start = final.days[299]; final.config.end = final.days[307];
  final.marketContext.series = final.marketContext.series.slice(0, 300); final.marketContext.asOf = final.days[299];
  const r = run(final); assert.match(r.systematic.state.missing, /超过7日/); assert.equal(r.systematic.nextPlan, null);
});

test('liquidation cancels pending reentry and clears strategy cash without a buy-sell round trip', () => {
  const input = fixture(undefined, { tax: { usCapitalGains: 20, usDividend: 20, liquidate: true } }); input.config.end = input.days[332];
  const r = run(input); assert.equal(strategyTrades(r).filter(t => t.side === 'buy').length, 0);
  assert.equal(r.systematic.nextPlan, null); assert.deepEqual(r.systematic.cashByLeg, [0, 0]);
  near(r.value, r.cash); reconcile(input, r);
});
