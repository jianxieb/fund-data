const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const sum = xs => xs.reduce((a, b) => a + b, 0);

function fixture(days, paths, weights, config = {}) {
  const assets = paths.map((_, i) => ({ id: 'stock:' + i, code: String(i), name: '资产' + i,
    kind: 'stock', market: 'cn', currency: 'CNY', status: 'available' }));
  const histories = Object.fromEntries(assets.map((asset, i) => [asset.id, {
    schemaVersion: 1, id: asset.id, currency: asset.currency, basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: days.map((day, j) => [day, paths[i][j]]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} }
  }]));
  return { catalog: { assets }, histories, config: { positions: assets.map((a, i) => ({ id: a.id, weight: weights[i] })),
    initial: 100, monthly: 0, years: 'common', rebalance: 'none', transactionFee: 0, feeBasis: 'net',
    initialMethod: 'cash_topup', ...config } };
}
function simulate(input) { const r = P.simulate(input); assert.equal(r.error, undefined); return r; }
const topups = r => r.transactions.filter(t => t.reason === 'cash_topup');
const lump = input => simulate({ ...input, config: { ...input.config, initialMethod: 'lump_sum' } });

// Rebuild cash and market value from the public event ledger, independently of
// the top-up formula. Dividend tax reduces reinvested units, never cash twice.
function reconcile(input, result) {
  const ids = input.config.positions.filter(p => p.weight > 0).map(p => p.id), units = Object.fromEntries(ids.map(id => [id, 0]));
  const price = (id, day) => {
    const asset = input.catalog.assets.find(a => a.id === id), raw = P.at(input.histories[id].series, day).value;
    if (asset.currency === (input.config.currency || 'CNY')) return raw;
    const fx = P.at(input.fxHistory.series, day).value;
    return raw * ((input.config.currency || 'CNY') === 'CNY' ? fx : 1 / fx);
  };
  let cash = 0, contribution = 0;
  for (const row of result.curve) {
    const deposit = row.contributed - contribution; cash += deposit; contribution = row.contributed;
    for (const event of result.taxEvents.filter(e => e.day === row.day && e.type === 'dividend')) units[event.id] -= event.tax / price(event.id, row.day);
    for (const t of result.transactions.filter(t => t.day === row.day)) {
      const sign = t.side === 'buy' ? 1 : -1;
      units[t.id] += sign * t.amount / price(t.id, row.day);
      cash -= sign * t.amount + t.fee + t.tax;
    }
    // Rebalance legs settle as one netted batch, so their array order is not
    // the execution order. Its sales can fund purchases in the same batch.
    assert.ok(cash >= -1e-6, 'settled trades consume unavailable cash');
    close(cash, row.cash, 1e-6);
    close(cash + sum(ids.map(id => units[id] * price(id, row.day))), row.grossValue, 1e-6);
    close(row.grossValue - row.taxReserve, row.value, 1e-6);
  }
  close(sum(result.holdings.map(h => h.profit)), result.profit, 1e-6);
  close(sum(result.transactions.map(t => t.fee)), result.tradeCost, 1e-6);
  close(sum(topups(result).map(t => t.amount)), result.topupAmount);
  close(sum(topups(result).map(t => t.fee)), result.topupFees);
  assert.equal(new Set(topups(result).map(t => t.day)).size, result.topupTimes);
  assert.ok(topups(result).every(t => t.side === 'buy' && t.signalDay < t.day));
}

test('initial allocation equals lump sum; a previous-close deficit buys only the deficient holding and never sells a rally', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08'];
  const input = fixture(days, [[100, 50, 50, 200, 210], [100, 100, 100, 200, 210]], [30, 30]);
  const r = simulate(input), baseline = lump(input);
  assert.deepEqual(r.transactions.filter(t => t.day === days[0]), baseline.transactions.filter(t => t.day === days[0]));
  assert.deepEqual(r.curve.slice(0, 2), baseline.curve.slice(0, 2));
  assert.deepEqual(topups(r), [{ day: days[2], id: 'stock:0', side: 'buy', amount: 6, fee: 0, tax: 0, reason: 'cash_topup', signalDay: days[1] }]);
  close(r.curve[2].cash, 34); close(r.curve[2].grossValue, 85);
  close((85 - r.curve[2].cash) / 85, .6);
  assert.ok(r.transactions.every(t => t.side === 'buy'));
  assert.equal(r.topupTimes, 1); close(r.topupAmount, 6);
  reconcile(input, r);
});

test('three holdings use previous positive gaps but current closing prices to cap total exposure', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06'];
  const input = fixture(days, [[100, 50, 70], [100, 80, 100], [100, 100, 50]], [20, 30, 10]);
  const r = simulate(input), buys = topups(r);
  // Previous marks 10/24/10, wealth 84: positive gaps 6.8/1.2/0.
  // Current marks 14/30/5, wealth 89: buy 4.4 using the old 85%/15% split.
  assert.deepEqual(buys.map(t => t.id), ['stock:0', 'stock:1']);
  close(buys[0].amount, 3.74); close(buys[1].amount, .66);
  close(r.cash, 35.6); close(r.grossValue, 89);
  close((r.grossValue - r.cash) / r.grossValue, .6);
  reconcile(input, r);
});

test('a rebound can cancel a previous deficit; a new same-day drop cannot trigger its own buy', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'];
  const input = fixture(days, [[100, 50, 200, 50], [100, 100, 200, 100]], [30, 30]);
  const r = simulate(input);
  assert.equal(r.topupTimes, 0); assert.deepEqual(r.transactions, lump(input).transactions);
});

test('floating point rounding at the supported maximum account size cannot manufacture a top-up', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06'];
  const input = fixture(days, [[100, 100, 100], [100, 100, 100], [100, 100, 100]], [1, 37, 11], { initial: 1e12, transactionFee: .1 });
  const r = simulate(input);
  assert.equal(r.topupTimes, 0); assert.deepEqual(r.transactions, lump(input).transactions);
});

test('transaction fees are paid from existing cash and the post-fee portfolio reaches, not exceeds, its target', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06'];
  const input = fixture(days, [[100, 50, 50], [100, 100, 100]], [30, 30], { transactionFee: 1 });
  const r = simulate(input), scale = 1 / 1.006;
  // Initial stock 60*scale and cash 40*scale. A 50% fall in one leg
  // makes the target gap 6*scale; 1% purchase fees reduce total wealth.
  const purchase = 6 * scale / 1.006;
  close(r.topupAmount, purchase); close(r.topupFees, purchase * .01);
  close(r.cash, 40 * scale - purchase * 1.01);
  close(r.grossValue, 85 * scale - purchase * .01);
  close((r.grossValue - r.cash) / r.grossValue, .6);
  close(r.holdings[0].costBasis, 30 * scale * 1.01 + purchase * 1.01);
  reconcile(input, r);
});

test('100% allocated accounts without cash remain identical to lump sum, including taxes, income and rebalancing', () => {
  const days = ['2025-01-29', '2025-01-30', '2025-01-31', '2025-02-03', '2025-02-04'];
  for (const weights of [[35, 65], [10, 20, 70]]) for (const transactionFee of [0, .1, 5]) {
    const paths = [[100, 50, 90, 110, 80], [100, 110, 80, 50, 70], [100, 95, 60, 90, 120]].slice(0, weights.length);
    const input = fixture(days, paths, weights, { transactionFee, monthly: 20, rebalance: 'month', tax: { cnStockCapitalGains: 20, cnStockDividend: 15 } });
    input.histories['stock:0'].dividendEvidence.fractions[days[2]] = .01;
    const r = simulate(input), baseline = lump(input);
    assert.equal(r.topupTimes, 0); close(r.topupAmount, 0);
    assert.deepEqual(r.curve, baseline.curve); assert.deepEqual(r.transactions, baseline.transactions);
    assert.deepEqual(r.taxEvents, baseline.taxEvents);
    reconcile(input, r);
  }
});

test('only common actual trading closes update the signal, and liquidation day cannot create an extra buy', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'];
  const input = fixture(days, [[100, 50, 50, 50], [100, 100, 100, 100]], [30, 30]);
  input.histories['stock:1'].series.splice(1, 1);
  const held = simulate(input);
  assert.deepEqual(topups(held).map(t => [t.day, t.signalDay]), [[days[3], days[2]]]);
  input.config.tax = { liquidate: true };
  const liquidated = simulate(input);
  assert.equal(liquidated.topupTimes, 0);
  assert.ok(liquidated.transactions.filter(t => t.day === days[3]).every(t => t.reason === 'liquidation'));
  reconcile(input, liquidated);
});

test('income is processed before top-up and periodic rebalancing can remove its need', () => {
  const days = ['2025-01-30', '2025-01-31', '2025-02-03', '2025-02-04'];
  const input = fixture(days, [[100, 50, 50, 50], [100, 100, 100, 100]], [30, 30], { monthly: 20 });
  const r = simulate(input);
  close(r.contributed, 120); close(r.topupAmount, 6); close(r.cash, 42);
  const dayTrades = r.transactions.filter(t => t.day === days[2]);
  assert.deepEqual(dayTrades.map(t => t.reason), ['contribution', 'contribution', 'cash_topup']);
  input.config.rebalance = 'month';
  const balanced = simulate(input);
  assert.equal(balanced.rebalances, 1); assert.equal(balanced.topupTimes, 0);
  reconcile(input, balanced);
});

test('mixed currencies and three assets reconcile tax, dividends, additions, rebalance and optional liquidation', () => {
  const days = ['2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-03', '2025-02-04', '2025-02-05'];
  for (const currency of ['CNY', 'USD']) for (const rebalance of ['none', 'month']) for (const liquidate of [false, true]) {
    const input = fixture(days, [[100, 45, 55, 130, 160, 80, 150], [100, 100, 70, 100, 90, 70, 110], [100, 80, 60, 130, 100, 50, 80]], [15, 25, 35], {
      currency, initial: 10000, monthly: 500, transactionFee: .3, rebalance,
      tax: { cnStockCapitalGains: 20, cnStockDividend: 15, usCapitalGains: 30, usDividend: 25, liquidate }
    });
    input.catalog.assets[0].market = 'us'; input.catalog.assets[0].currency = 'USD'; input.histories['stock:0'].currency = 'USD';
    input.histories['stock:0'].dividendEvidence.fractions[days[3]] = .02;
    input.histories['stock:1'].dividendEvidence.fractions[days[5]] = .03;
    const fx = { id: 'fx:CNY', currency: 'CNY', status: 'available' }; input.catalog.fx = fx;
    input.fxHistory = { schemaVersion: 1, id: fx.id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested',
      first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, 7 + i / 100]) };
    const r = simulate(input);
    assert.ok(r.topupTimes > 0); assert.ok(r.dividendTax > 0); close(r.contributed, 10500);
    assert.ok(topups(r).every(t => !(liquidate && t.day === days.at(-1))));
    reconcile(input, r);
  }
});

test('future price changes and appended history cannot change earlier decisions or account values', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09'];
  const input = fixture(days, [[100, 50, 50, 130, 60, 70], [100, 100, 90, 100, 80, 90]], [35, 25], { transactionFee: .2, tax: { cnStockCapitalGains: 20 } });
  const before = simulate(input), cutoff = days[3];
  for (const [i, h] of Object.values(input.histories).entries()) {
    h.series.filter(([day]) => day > cutoff).forEach(r => { r[1] *= 3 + i; });
    h.series.push(['2025-01-10', 1000 + i]); h.asOf = '2025-01-10'; h.dividendEvidence.through = '2025-01-10';
  }
  const after = simulate(input);
  for (const key of ['curve', 'transactions', 'taxEvents']) assert.deepEqual(after[key].filter(r => r.day <= cutoff), before[key].filter(r => r.day <= cutoff));
  const restored = P.sanitizeDraft({ schemaVersion: 1, ...input.config }, new Set(input.catalog.assets.map(a => a.id)));
  assert.equal(restored.initialMethod, 'cash_topup'); assert.deepEqual(restored.positions, input.config.positions);
});
