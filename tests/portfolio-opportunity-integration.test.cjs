const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../assets/portfolio-model.js');
const methods = ['opportunity_discount_10', 'opportunity_discount_20', 'opportunity_mixed_10'];
const sum = a => a.reduce((x, y) => x + y, 0);
const near = (a, b, e = 1e-7) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= e, `${a} != ${b}`);
function fixture(method = methods[0], config = {}) {
  const days = Array.from({ length: 850 }, (_, i) => new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10));
  const assets = ['USD', 'TQQQ', 'QQQ', 'SOXX', 'OTHER'].map(code => ({ id: 'us:' + code, code, name: code,
    kind: 'etf', market: 'us', currency: 'USD', status: 'available' }));
  const histories = Object.fromEntries(assets.map(asset => [asset.id, { schemaVersion: 1, id: asset.id, currency: 'USD',
    basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1),
    series: days.map((day, i) => [day, ['QQQ', 'SOXX'].includes(asset.code) ? i < 600 ? 100 : i < 640 ? 70 : i < 700 ? 110 : 70 : 10 + i / 100]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} }
  }]));
  const marketContext = { schemaVersion: 1, status: 'available', first: days[0], asOf: days.at(-1),
    series: days.map((day, i) => [day, i >= 630 && i < 660 ? 40 : 20, 30]),
    sources: Object.fromEntries(['VIX', 'VIX3M'].map(id => [id, {
      url: `https://cdn.cboe.com/api/global/us_indices/daily_prices/${id}_History.csv`, first: days[0], asOf: days.at(-1),
      sha256: 'a'.repeat(64), retrievedAt: '2024-01-01T00:00:00Z'
    }])) };
  return { days, catalog: { assets }, histories, marketContext, config: {
    positions: [{ id: 'us:USD', weight: 30 }, { id: 'us:TQQQ', weight: 30 }], initial: 100, monthly: 0,
    currency: 'USD', years: 'custom', start: days[590], end: days[730], initialMethod: method,
    contributionMethod: 'dca_month', rebalance: 'none', transactionFee: .1, feeBasis: 'net',
    tax: { usCapitalGains: 20, usDividend: 20 }, ...config } };
}
function run(input) { const r = P.simulate(input); assert.equal(r.error, undefined, r.error); return r; }
const trades = r => r.transactions.filter(t => methods.includes(t.reason));
function reconcile(input, r) {
  const ids = input.config.positions.filter(p => p.weight > 0).map(p => p.id), units = Object.fromEntries(ids.map(id => [id, 0]));
  let cash = 0, contributed = 0;
  function price(id, day) {
    let p = P.at(input.histories[id].series, day).value;
    if (input.config.currency === 'CNY') p *= P.at(input.fxHistory.series, day).value;
    return p;
  }
  for (const row of r.curve) {
    cash += row.contributed - contributed; contributed = row.contributed;
    for (const event of r.taxEvents.filter(t => t.day === row.day && t.type === 'dividend')) units[event.id] -= event.tax / price(event.id, row.day);
    for (const transaction of r.transactions.filter(t => t.day === row.day)) {
      const delta = transaction.amount * (transaction.side === 'buy' ? 1 : -1);
      units[transaction.id] += delta / price(transaction.id, row.day);
      cash -= delta + transaction.fee + transaction.tax;
    }
    near(cash, row.cash); near(row.grossValue, cash + sum(ids.map(id => units[id] * price(id, row.day))));
    near(row.value, row.grossValue - row.taxReserve);
    assert.ok(row.systematicCash.every(x => x >= 0)); assert.ok(sum(row.systematicCash) <= row.cash + 1e-7);
  }
  near(contributed, r.contributed); near(sum(r.transactions.map(t => t.fee)), r.tradeCost);
  assert.ok(trades(r).every(t => t.signalDay < t.day));
}

test('all three methods use exact reduced first purchases and per-leg reserve, with immutable continuous daily scores', () => {
  for (const method of methods) {
    const input = fixture(method), r = run(input), reserve = method.endsWith('_20') ? .2 : .1;
    const denominator = 1 + .001 * .6 * (1 - reserve), initial = r.transactions.filter(t => t.reason === 'initial');
    assert.equal(initial.length, 2); initial.forEach(t => near(t.amount, 100 * .3 * (1 - reserve) / denominator));
    r.curve[0].systematicCash.forEach(c => near(c, 100 * .3 * reserve / denominator));
    near(r.curve[0].cash - sum(r.curve[0].systematicCash), 40 / denominator);
    assert.equal(r.deposits, 1); near(r.contributed, 100); reconcile(input, r);
    assert.equal(r.systematic.daily.length, r.curve.length);
    assert.ok(Object.isFrozen(r.systematic.daily[0].metadata.opportunity));
    assert.ok(r.systematic.daily.every(row => row.indicators.every(i => i.kind === 'buy_score' && i.unit === 'points')));
    assert.ok(new Set(r.systematic.daily.map(row => row.indicator)).size > 2);
    const purchase = r.systematic.daily.find(row => row.day === input.days[600]);
    assert.ok(purchase.indicators.every(i => i.value > 50 && i.value <= 100));
    assert.equal(purchase.metadata.opportunity.legs[0].inputs.price, 70);
    assert.equal(purchase.metadata.opportunity.legs[0].inputs.ma252 > 70, true);
  }
});

test('each known score fixes next-close currency purchases; price jumps cannot resize an existing order', () => {
  const input = fixture(), prior = run({ ...input, config: { ...input.config, end: input.days[600] } });
  const plan = prior.systematic.nextPlan; assert.ok(plan.buyAmount > 0);
  const changed = structuredClone(input);
  for (const id of ['us:USD', 'us:TQQQ']) changed.histories[id].series[601][1] *= 5;
  const r = run(changed), filled = trades(r).filter(t => t.day === input.days[601]);
  near(sum(filled.map(t => t.amount)), plan.buyAmount); near(sum(filled.map(t => t.fee)), plan.buyFee);
  assert.ok(filled.every(t => t.signalDay === input.days[600])); reconcile(changed, r);
  const laterBuys = trades(r).filter(t => t.side === 'buy' && t.day > input.days[601] && t.day < input.days[641]);
  assert.equal(laterBuys.length, 0); // A repeated high score cannot refill an emptied reserve.
});

test('low scores do not sell; VIX exits still execute and reopening waits for the score', () => {
  const input = fixture(), r = run(input), sales = trades(r).filter(t => t.side === 'sell');
  assert.equal(sales.length, 1); assert.equal(sales[0].id, 'us:TQQQ');
  assert.equal(sales[0].signalDay, input.days[640]); assert.equal(sales[0].day, input.days[641]);
  const openLow = r.systematic.daily.find(row => row.day === input.days[661]);
  assert.equal(openLow.metadata.vixOn, true); assert.ok(openLow.metadata.opportunity.legs[1].score < 35);
  assert.equal(openLow.metadata.opportunity.legs[1].buyAmount, 0);
  assert.ok(openLow.metadata.opportunity.legs[1].availableCash > 0);
  const reentry = trades(r).find(t => t.side === 'buy' && t.day > sales[0].day);
  assert.equal(reentry.day, input.days[701]); assert.equal(reentry.signalDay, input.days[700]);
  reconcile(input, r);
});

test('score warmup retains reserves and still permits a VIX exit; stale or missing required quotes stop new orders', () => {
  const input = fixture('opportunity_mixed_10');
  input.marketContext.series = input.marketContext.series.slice(589); input.marketContext.first = input.days[589];
  const r = run(input);
  assert.ok(r.systematic.daily.every(row => row.status === 'warming-up'));
  assert.ok(r.systematic.daily.every(row => row.indicator === null));
  assert.equal(trades(r).filter(t => t.side === 'buy').length, 0);
  assert.equal(trades(r).filter(t => t.side === 'sell').length, 1);
  const stale = fixture(); const p = stale.histories['us:SOXX']; p.series = p.series.slice(0, 590); p.asOf = p.series.at(-1)[0];
  assert.match(P.simulate(stale).error, /超过7日/);
  const absent = fixture(); delete absent.histories['us:SOXX']; assert.match(P.simulate(absent).error, /SOXX/);
});

test('initially closed risk gate keeps the frozen first buy then sells next close', () => {
  const input = fixture(); input.config.start = input.days[645]; input.config.end = input.days[650];
  const r = run(input);
  assert.equal(r.transactions.filter(t => t.reason === 'initial').length, 2);
  assert.equal(trades(r).find(t => t.side === 'sell').day, input.days[646]);
  reconcile(input, r);
});

test('cash-flow additions are fully reserved for pair scores; isolated addition quotes reconcile and match the next fill', () => {
  for (const method of methods) {
    const input = fixture(method, { initial: 0, monthly: 100 });
    input.config.start = input.days[600]; input.config.end = input.days[603];
    const r = run(input), day = r.systematic.daily[0], quote = P.additionAllocation(day, 100);
    near(r.curve[0].cash, 100); assert.equal(r.transactions.filter(t => t.day === input.days[600]).length, 0);
    assert.deepEqual(r.curve[0].systematicCash, [30, 30]); near(quote.total, 100);
    const next = trades(r).filter(t => t.day === input.days[601]);
    quote.orders.forEach(o => near(next.find(t => t.id === o.id)?.amount || 0, o.amount));
    near(quote.originalCash, 40);
    if (method === 'opportunity_mixed_10') {
      near(quote.parkedCash, 24); // Score70 =>60% of the sleeve, not70% of the account.
      near(P.additionAllocation(day, .01).parkedCash, .0024); // No account-tail sweep in an isolated quote.
    } else near(quote.parkedCash, 0);
    reconcile(input, r);
  }
  const ordinary = fixture('opportunity_mixed_10', { monthly: 37, positions: [
    { id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 40 }, { id: 'us:OTHER', weight: 15 }] });
  const mixed = run(ordinary); reconcile(ordinary, mixed);
  assert.ok(mixed.transactions.filter(t => t.reason === 'contribution').every(t => t.id === 'us:OTHER'));
  for (const row of mixed.systematic.daily) {
    const q = P.additionAllocation(row, 1234); near(q.total, 1234);
    near(q.fee, sum(q.orders.map(o => o.fee)));
    const leg = row.metadata.opportunity.legs[1], buy = q.orders.find(o => o.id === 'us:TQQQ');
    if (leg.blockedByRisk) assert.equal(buy.amount, 0);
  }
});

test('periodic rebalance preserves the spent reserve instead of replenishing it, including other assets', () => {
  const input = fixture(undefined, { rebalance: 'month', positions: [
    { id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 40 }, { id: 'us:OTHER', weight: 10 }] });
  const r = run(input); reconcile(input, r); assert.ok(r.rebalances > 0);
  const afterSpent = r.curve.filter(row => row.day >= input.days[602] && row.day < input.days[641]);
  assert.ok(afterSpent.every(row => sum(row.systematicCash) < 1e-7));
  assert.ok(trades(r).every(t => t.id !== 'us:OTHER'));
});

test('arbitrary positive pair weights, a single supported leg and another reporting currency remain self-financing', () => {
  for (const positions of [[{ id: 'us:USD', weight: 100 }], [{ id: 'us:TQQQ', weight: 100 }],
    [{ id: 'us:USD', weight: 50 }, { id: 'us:TQQQ', weight: 50 }], [{ id: 'us:USD', weight: 20 }, { id: 'us:TQQQ', weight: 70 }]]) {
    const input = fixture(undefined, { positions }), r = run(input); reconcile(input, r);
    const imported = P.sanitizeDraft({ schemaVersion: 1, ...input.config }, new Set(input.catalog.assets.map(a => a.id)));
    assert.equal(imported.initialMethod, input.config.initialMethod);
  }
  const input = fixture(undefined, { currency: 'CNY' }), fx = { id: 'fx:CNY', currency: 'CNY', status: 'available', name: '人民币' };
  input.catalog.fx = fx; input.fxHistory = { schemaVersion: 1, id: fx.id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: input.days[0], asOf: input.days.at(-1), series: input.days.map((day, i) => [day, 6 + i / 1000]) };
  const r = run(input); reconcile(input, r);
  assert.deepEqual(r.systematic.daily.map(d => d.indicator), run(fixture()).systematic.daily.map(d => d.indicator));
});

test('future quote changes and end truncation preserve historical scores, orders and actual account values', () => {
  const input = fixture('opportunity_mixed_10'), cutoff = input.days[620], original = run(input), changed = structuredClone(input);
  Object.values(changed.histories).forEach(history => history.series.forEach(row => { if (row[0] > cutoff) row[1] *= 4; }));
  changed.marketContext.series.forEach(row => { if (row[0] > cutoff) { row[1] = 99; row[2] = 10; } });
  const future = run(changed), shorter = run({ ...input, config: { ...input.config, end: cutoff } });
  for (const altered of [future, shorter]) {
    assert.deepEqual(altered.systematic.daily.filter(r => r.day <= cutoff), original.systematic.daily.filter(r => r.day <= cutoff));
    assert.deepEqual(altered.curve.filter(r => r.day <= cutoff), original.curve.filter(r => r.day <= cutoff));
    assert.deepEqual(altered.transactions.filter(r => r.day <= cutoff), original.transactions.filter(r => r.day <= cutoff));
  }
});

test('dividend tax, a next-fill price jump, full exits and end liquidation retain exact cash ownership', () => {
  const input = fixture(undefined, { initial: 1000000, monthly: 5000, tax: { usCapitalGains: 20, usDividend: 20, liquidate: true } });
  input.histories['us:TQQQ'].dividendEvidence.fractions[input.days[641]] = .1;
  input.histories['us:TQQQ'].series[641][1] *= 3;
  const r = run(input); reconcile(input, r);
  assert.equal(r.systematic.nextPlan, null); assert.deepEqual(r.systematic.cashByLeg, [0, 0]);
  assert.ok(r.holdings.every(h => h.value === 0 && h.costBasis === 0)); near(r.value, r.cash);
  assert.equal(P.additionAllocation(r.systematic.daily.at(-1), 100), null);
  const last = r.systematic.daily.at(-1);
  assert.equal(last.metadata.opportunity.legs[0].sourceDay, r.end);
  assert.ok(last.indicators.every(i => Number.isFinite(i.value)));
  const held = run({ ...input, config: { ...input.config, tax: { ...input.config.tax, liquidate: false } } });
  assert.deepEqual(last.indicators, held.systematic.daily.at(-1).indicators);
});

test('a missing browser scoring module cannot silently execute a different initial strategy', () => {
  const sandbox = { Changheng: require('../assets/model.js') }; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/portfolio-model.js'), 'utf8'), sandbox);
  assert.match(sandbox.ChanghengPortfolioModel.simulate(fixture()).error, /加仓评分模块未加载/);
});
