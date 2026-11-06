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

test('every common close has an immutable numerical daily state even without an order', () => {
  for (const method of methods) {
    const input = fixture(method), r = run(input), daily = r.systematic.daily;
    assert.equal(daily.length, r.curve.length);
    assert.equal(daily[0].trackingStart, r.start);
    assert.ok(daily.some(row => row.nextPlan === null && row.status === 'ready'));
    assert.ok(Object.isFrozen(daily) && Object.isFrozen(daily[0]) && Object.isFrozen(daily[0].metadata));
    assert.ok(Object.isFrozen(daily[0].positions));
    assert.equal(Reflect.set(daily[0].metadata, 'sourceDay', '2099-01-01'), false);
    for (const row of daily) {
      if (row.status !== 'ready') { assert.ok(row.indicators.every(s => s.value === null)); continue; }
      assert.ok(row.indicators.every(s => Number.isFinite(s.value) && s.unit === '%'));
      if (method === 'relative_strength_rotation') near(sum(row.indicators.map(s => s.value)), 100);
      else assert.ok([0, 100].includes(row.indicator));
    }
  }
});

test('daily state preserves the full prefix when future dates and prices are extended with the same start', () => {
  for (const method of methods) {
    const input = fixture(method), cut = method === 'relative_strength_rotation' ? 650 : 335;
    const earlier = run({ ...input, config: { ...input.config, end: input.days[cut] } });
    const future = structuredClone(input);
    for (const id of Object.keys(future.histories)) future.histories[id].series = future.histories[id].series.map((row, i) => [row[0], i > cut ? row[1] * (i % 2 ? 4 : .5) : row[1]]);
    future.marketContext.series = future.marketContext.series.map((row, i) => [row[0], i > cut ? 80 : row[1], row[2]]);
    const extended = run(future);
    assert.deepEqual(extended.systematic.daily.filter(row => row.day <= input.days[cut]), earlier.systematic.daily);
  }
});

test('addition quotes conserve the budget with fees, changed weights, parked cash and a third asset', () => {
  for (const method of methods) {
    const input = fixture(method, { positions: [{ id: 'us:USD', weight: 15 }, { id: 'us:TQQQ', weight: 45 }, { id: 'us:OTHER', weight: 20 }] });
    const r = run(input);
    for (const row of r.systematic.daily) for (const budget of [0, 1000.25]) {
      const q = P.additionAllocation(row, budget);
      assert.ok(q); near(q.total, budget);
      near(sum(q.orders.map(o => o.amount + o.fee)) + q.parkedCash + q.originalCash, budget);
      near(q.orders.find(o => o.id === 'us:OTHER').amount, budget / 1.0008 * .2);
      near(q.originalCash, budget / 1.0008 * .2);
      assert.equal(q.currency, 'USD');
      assert.deepEqual(q, P.additionAllocation(row, budget));
    }
    assert.throws(() => P.additionAllocation(r.systematic.daily.at(-1), -1), /新增资金/);
  }
});

test('a previous-close addition quote equals actual next-close contribution orders for every method', () => {
  for (const method of methods) for (const initial of [0, 100]) {
    const input = fixture(method, { initial, monthly: 123.45, positions: [{ id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 40 }, { id: 'us:OTHER', weight: 10 }] });
    input.marketContext.series = input.marketContext.series.map((row, i) => [row[0], i >= 300 && i < 360 ? 40 : 20, row[2]]);
    const r = run(input), daily = r.systematic.daily;
    for (const { day, amount } of r.plan.income) {
      const index = daily.findIndex(row => row.day === day); if (index <= 0) continue;
      const quote = P.additionAllocation(daily[index - 1], amount), trades = r.transactions.filter(t => t.day === day && t.reason === 'contribution');
      assert.ok(quote);
      for (const order of quote.orders) {
        const actual = trades.find(t => t.id === order.id);
        near(actual?.amount || 0, order.amount); near(actual?.fee || 0, order.fee);
      }
      const other = quote.orders.find(o => o.id === 'us:OTHER'); assert.ok(other.amount > 0);
      if (quote.parkedCash > 0 && !strategyTrades(r).some(t => t.day === day)) {
        const before = r.curve.find(row => row.day === daily[index - 1].day), after = r.curve.find(row => row.day === day);
        near(sum(after.systematicCash) - sum(before.systematicCash), quote.parkedCash);
      }
    }
  }
});

test('addition quotes use pending targets before executed targets change', () => {
  const r = run(fixture()), out = r.systematic.daily.find(row => row.nextPlan?.orders.some(o => o.side === 'sell'));
  assert.deepEqual(out.executedTargets, [.3, .3]); assert.deepEqual(out.desiredTargets, [.3, 0]);
  const quote = P.additionAllocation(out, 1000);
  assert.equal(quote.orders.find(o => o.id === 'us:TQQQ').amount, 0); assert.ok(quote.parkedCash > 300);
  const incoming = r.systematic.daily.find(row => row.nextPlan?.orders.some(o => o.side === 'buy'));
  assert.deepEqual(incoming.executedTargets, [.3, 0]);
  assert.ok(P.additionAllocation(incoming, 1000).orders.find(o => o.id === 'us:TQQQ').amount > 0);
});

test('warmup is a labelled original-allocation fallback; missing and liquidation never become zero scores', () => {
  const rotation = run(fixture('relative_strength_rotation')), warm = rotation.systematic.daily.find(row => row.warmingUp);
  assert.equal(P.additionAllocation(warm, 1000).status, 'fallback');
  assert.match(P.additionAllocation(warm, 1000).reason, /505/);
  assert.equal(warm.indicator, null); assert.ok(warm.indicators.every(x => x.value === null));
  near(P.additionAllocation(warm, 1000).orders[0].targetWeight, .3);
  const missing = fixture(); missing.config.start = missing.days[299]; missing.config.end = missing.days[307];
  missing.marketContext.series = missing.marketContext.series.slice(0, 300); missing.marketContext.asOf = missing.days[299];
  const absent = run(missing).systematic.daily.at(-1);
  assert.equal(absent.status, 'missing'); assert.equal(absent.indicator, null);
  assert.ok(absent.indicators.every(x => x.value === null)); assert.equal(P.additionAllocation(absent, 1000), null);
  const closed = fixture(undefined, { tax: { usCapitalGains: 20, usDividend: 20, liquidate: true } });
  const last = run(closed).systematic.daily.at(-1);
  assert.equal(last.status, 'liquidated'); assert.equal(last.indicator, null); assert.equal(last.nextPlan, null);
  assert.equal(P.additionAllocation(last, 1000), null);
});

test('non-common valuation dates do not add decisions or advance confirmation counts', () => {
  const input = fixture(undefined, { positions: [{ id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 30 }, { id: 'us:OTHER', weight: 10 }] });
  input.histories['us:OTHER'].series = input.histories['us:OTHER'].series.filter(row => row[0] !== input.days[311]);
  const r = run(input);
  assert.ok(r.curve.some(row => row.day === input.days[311]));
  assert.ok(!r.systematic.daily.some(row => row.day === input.days[311]));
  for (const row of r.systematic.daily) {
    assert.ok(row.metadata.vixDay < row.day);
    assert.equal(row.metadata.units.vixExitRun, 'source_observations');
  }
});

test('daily explanatory data distinguishes warmup, initial neutral phases, and completed monthly review', () => {
  const r = run(fixture('relative_strength_rotation')), daily = r.systematic.daily;
  assert.equal(daily[0].metadata.startup.initialDecision, true);
  assert.equal(daily[0].metadata.startup.neutralPhases, 3);
  assert.equal(daily[0].metadata.lastReviewDay, null);
  const reviewed = daily.find(row => row.metadata.reviewedToday);
  assert.equal(reviewed.metadata.lastReviewDay, reviewed.day);
  near(reviewed.metadata.relativeRatio, Math.exp(reviewed.metadata.relativeLogReturn));
  const next = daily[daily.indexOf(reviewed) + 1];
  assert.equal(next.metadata.lastReviewDay, reviewed.day);
  assert.equal(next.metadata.reviewedToday, false);
  const dual = run(fixture('dual_risk_guard')).systematic.daily.find(row => row.metadata.qqqExitRun === 19);
  assert.equal(dual.metadata.qqqPrice, 70);
  near(dual.metadata.qqqDrawdown, dual.metadata.qqqPrice / dual.metadata.qqqHigh - 1);
  near(dual.metadata.qqqMaDistance, dual.metadata.qqqPrice / dual.metadata.qqqMA - 1);
});
