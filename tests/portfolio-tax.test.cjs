const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const days = ['2025-01-30', '2025-02-03', '2025-02-04'];
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function fixture(specs, config = {}) {
  const assets = specs.map((s, i) => ({ id: 'us:' + String.fromCharCode(65 + i), code: String.fromCharCode(65 + i),
    name: '资产' + i, market: 'us', currency: 'USD', kind: 'etf', status: 'available', ...s }));
  const history = (a, values) => ({ schemaVersion: 1, id: a.id, currency: a.currency, basis: 'provider_adjusted_close',
    dividends: 'reinvested', first: days[0], asOf: days.at(-1), series: values.map((v, i) => [days[i], v]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: a.fractions || {} } });
  const fx = { id: 'fx:CNY', currency: 'CNY', status: 'available' };
  return { catalog: { assets, fx }, histories: Object.fromEntries(assets.map(a => [a.id, history(a, a.values)])),
    fxHistory: history(fx, [7, 7, 7]), config: { positions: assets.map(a => ({ id: a.id, weight: 100 / assets.length })),
      initial: 1000, monthly: 0, years: 'common', rebalance: 'none', transactionFee: 0, feeBasis: 'net',
      tax: { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20 }, ...config } };
}
test('unrealized profits reserve tax without selling; liquidation releases the same reserve', () => {
  const input = fixture([{ values: [1, 2, 2] }]);
  const held = P.simulate(input); close(held.value, 1800); close(held.capitalTax, 0);
  close(held.grossValue, 2000); close(held.taxReserve, 200); close(held.paidTax, 0); close(held.taxCost, 200);
  close(held.holdings[0].performance.totalReturn, 80); close(held.cash, 0);
  assert.equal(held.transactions.length, 1); assert.equal(held.taxEvents.length, 0);
  assert.deepEqual(held.curve.map(p => p.taxReserve), [0, 200, 200]);
  input.config.tax.liquidate = true;
  const sold = P.simulate(input); close(sold.value, 1800); close(sold.profit, 800); close(sold.capitalTax, 200);
  close(sold.taxReserve, 0); close(sold.paidTax, 200); close(sold.value, held.value);
  close(sold.cash, 1800); close(sold.holdings[0].value, 0); close(sold.holdings[0].performance.totalReturn, 80);
  assert.equal(sold.transactions.at(-1).reason, 'liquidation'); close(sold.curve.at(-1).taxCost, 200);
  input.histories['us:A'].series = [[days[0], 2], [days[1], 1], [days[2], 1]];
  const loss = P.simulate(input); close(loss.value, 500); close(loss.capitalTax, 0);
});
test('cash distributions are taxed once and net reinvestments become capital cost basis', () => {
  const input = fixture([{ values: [1, 1.1, 1.1], fractions: { [days[1]]: .1 / 1.1 } }]);
  input.config.tax.liquidate = true;
  const r = P.simulate(input); assert.equal(r.error, undefined);
  close(r.dividendTax, 20); close(r.capitalTax, 0); close(r.value, 1080); close(r.profit, 80);
  close(r.holdings[0].performance.totalReturn, 8); close(r.taxEvents.find(t => t.type === 'dividend').basisAdded, 80);
  close(r.curve[1].positionPrincipal, 1000); close(r.curve.at(-1).positionPrincipal, 0);
  input.config.tax.usDividend = 0;
  const untaxedDividend = P.simulate(input); close(untaxedDividend.value, 1100); close(untaxedDividend.capitalTax, 0);
});
test('rebalancing solves tax and trading fees before target allocations, preserving the cash ledger', () => {
  const input = fixture([{ values: [1, 2, 2] }, { market: 'cn', currency: 'CNY', kind: 'fund', values: [1, 1, 1] }], { rebalance: 'month' });
  const r = P.simulate(input); assert.equal(r.error, undefined);
  close(r.capitalTax, 250 / .95 * .1); close(r.grossValue, 1500 - r.capitalTax); close(r.value, 1400); close(r.taxCost, 100); close(r.cash, 0);
  close(r.holdings[0].grossValue, r.grossValue / 2); close(r.holdings[1].grossValue, r.grossValue / 2);
  close(r.holdings.reduce((s, h) => s + h.profit, 0), r.profit);
  close(r.holdings[0].performance.returned, 250 / .95 * .9);
  input.config.transactionFee = 1;
  const paid = P.simulate(input); assert.equal(paid.error, undefined);
  close(paid.cash, 0); close(paid.holdings[0].grossValue, paid.grossValue / 2); close(paid.holdings[1].grossValue, paid.grossValue / 2);
});
test('tax is in RMB with acquisition fees included; rates distinguish US, A stocks and domestic funds', () => {
  const input = fixture([{ values: [1, 2, 2] }, { market: 'cn', currency: 'CNY', kind: 'stock', values: [1, 2, 2] },
    { market: 'cn', currency: 'CNY', kind: 'fund', values: [1, 2, 2] }], { transactionFee: 1 });
  input.config.tax.liquidate = true;
  input.config.tax.overrides = { 'us:A': { gain: 30 } };
  const r = P.simulate(input); assert.equal(r.error, undefined);
  const amount = 1000 / 3, gross = amount / 1.01 * 2, sale = gross * .99;
  close(r.holdings[0].capitalTax, (sale - amount) * .3);
  close(r.holdings[1].capitalTax, 0); close(r.holdings[2].capitalTax, 0);
  input.fxHistory.series[2][1] = 8;
  const fx = P.simulate(input); close(fx.holdings[0].capitalTax, (gross * 8 / 7 * .99 - amount) * .3);
});
test('new purchases on an ex-date do not receive or pay tax on that distribution', () => {
  const input = fixture([{ values: [1, 1.1, 1.1], fractions: { [days[0]]: .5, [days[1]]: .1 / 1.1 } }], { monthly: 1000 });
  const r = P.simulate(input); close(r.contributed, 2000); close(r.dividendTax, 20); close(r.value, 2080);
  assert.equal(r.taxEvents.filter(t => t.type === 'dividend').length, 1);
});
test('the benchmark uses matching dividend and liquidation taxes but no user trading fee', () => {
  const input = fixture([{ values: [1, 1.1, 1.2], fractions: { [days[1]]: .1 / 1.1 } }], { benchmarkId: 'us:A' });
  input.config.tax.liquidate = true;
  const r = P.simulate(input); assert.equal(r.benchmarkError, null);
  close(r.benchmark.totalReturn, r.totalReturn); close(r.benchmark.annualReturn, r.annualReturn);
  input.config.transactionFee = 1;
  const cost = P.simulate(input); assert.ok(cost.benchmark.totalReturn > cost.totalReturn);
});
test('unknown distributions cannot become zero tax or an overstated capital-gains base', () => {
  const input = fixture([{ values: [1, 2, 2] }]);
  delete input.histories['us:A'].dividendEvidence;
  assert.match(P.simulate(input).error, /资产0.*现金分红.*分红再投成本/);
  input.config.tax.usDividend = 0;
  assert.match(P.simulate(input).error, /分红再投成本/);
  input.config.tax.usCapitalGains = 0;
  assert.equal(P.simulate(input).error, undefined);
});
test('tax configuration and per-asset overrides survive export/import; old imports retain no-tax behavior', () => {
  const input = fixture([{ values: [1, 2, 2] }]);
  const saved = { schemaVersion: 1, ...input.config, tax: { ...input.config.tax, overrides: { 'us:A': { dividend: 21 } }, liquidate: true } };
  const restored = P.sanitizeDraft(JSON.parse(JSON.stringify(saved)), new Set(['us:A']));
  assert.deepEqual(restored.tax, saved.tax);
  const old = { ...saved }; delete old.tax;
  assert.deepEqual(P.sanitizeDraft(old, new Set(['us:A'])).tax, P.taxConfig());
  for (const tax of [null, { usCapitalGains: -1 }, { usDividend: 101 }, { liquidate: 'yes' }, { overrides: [] }, { overrides: { 'unknown': { gain: 20 } } }]) {
    assert.match(P.simulate({ ...input, config: { ...input.config, tax } }).error, /税|未收录|清仓/);
  }
});

// These examples exercise liabilities rather than mirroring the simulator's loop.
test('USD 1000 growing to 1200 leaves 1160 after reserving 20% of profit, not principal', () => {
  const input = fixture([{ values: [1, 1.2, 1.2] }], { currency: 'USD', benchmarkId: 'us:A' });
  delete input.fxHistory; delete input.catalog.fx;
  const r = P.simulate(input); assert.equal(r.error, undefined);
  close(r.value, 1160); close(r.taxReserve, 40); close(r.profit, 160); close(r.totalReturn, 16);
  close(r.benchmark.totalReturn, 16); close(r.benchmark.taxReserve, .04);
  assert.equal(r.holdings[0].performance.currency, 'USD');
  input.config.tax.usCapitalGains = 30;
  close(P.simulate(input).value, 1140);
  input.config.tax = P.taxConfig();
  close(P.simulate(input).value, 1200);
});
test('a disappearing gain releases its reserve without a refund or a sale', () => {
  const r = P.simulate(fixture([{ values: [1, 2, .5] }], { benchmarkId: 'us:A' }));
  assert.deepEqual(r.curve.map(p => p.taxReserve), [0, 200, 0]);
  close(r.value, 500); close(r.capitalTax, 0); close(r.taxCost, 0);
  close(r.mdd, (500 / 1800 - 1) * 100);
  close(r.holdings[0].performance.mdd, r.mdd);
  assert.equal(r.transactions.length, 1);
});
test('tax reserve excludes taxed dividends and follows deposits without changing risk or benchmark return', () => {
  const input = fixture([{ values: [1, 1.2, 1.2], fractions: { [days[1]]: .1 / 1.2 } }], { monthly: 1000, benchmarkId: 'us:A' });
  const r = P.simulate(input); assert.equal(r.error, undefined);
  close(r.contributed, 2000); close(r.dividendTax, 20); close(r.taxReserve, 20);
  close(r.value, 2160); close(r.profit, 160); close(r.totalReturn, 16);
  close(r.benchmark.totalReturn, 16);
  close(r.curve[1].nav, r.curve[2].nav);
  close(r.holdings[0].performance.profit, r.profit);
  input.config.tax.liquidate = true;
  const sold = P.simulate(input);
  close(sold.value, r.value); close(sold.capitalTax, 20); close(sold.taxReserve, 0);
});
test('cost includes acquisition fees; reserve anticipates exit fees without charging them until sale', () => {
  const input = fixture([{ values: [1, 2, 2] }], { transactionFee: 1 });
  const held = P.simulate(input), gross = 1000 / 1.01 * 2, exitFee = gross * .01;
  close(held.taxReserve, (gross - exitFee - 1000) * .2);
  close(held.value, gross - held.taxReserve); close(held.tradeCost, 1000 - 1000 / 1.01);
  input.config.tax.liquidate = true;
  const sold = P.simulate(input);
  close(sold.capitalTax, held.taxReserve); close(sold.taxReserve, 0);
  close(sold.value, held.value - exitFee);
  close(sold.holdings[0].performance.profit, sold.profit);
});

test('cash dividends stay in cash through subsequent price gains, and a sale does not tax them again', () => {
  const input = fixture([{ values: [100, 110, 220], fractions: { [days[1]]: 10 / 110 } }],
    { currency: 'USD', dividendPolicy: 'cash', benchmarkId: 'us:A' });
  const held = P.simulate(input); assert.equal(held.error, undefined);
  const h = held.holdings[0];
  // Ten shares, a $10 gross dividend on each, then a $100 -> $200 move.
  close(held.curve[1].cash, 80); close(held.curve[1].value, 1080);
  close(h.grossValue, 2000); close(h.costBasis, 1000); close(h.taxReserve, 200);
  close(held.cashDividends, 80); close(h.cashDividends, 80); close(held.cash, 80);
  close(held.contributed, 1000); assert.equal(held.deposits, 1); assert.equal(held.transactions.length, 1);
  close(held.value, 1880); close(held.profit, h.profit); close(h.performance.profit, 880);
  close(h.performance.returned, 80); close(h.performance.mdd, 0);
  assert.deepEqual(h.performance.flows, [[days[0], -1000], [days[1], 80], [days[2], 1800]]);
  close(held.benchmark.totalReturn, held.totalReturn); close(held.benchmark.cashDividends, 8);
  close(held.taxEvents[0].cashPaid, 80); close(held.taxEvents[0].basisAdded, 0);
  input.config.tax.liquidate = true;
  const sold = P.simulate(input);
  close(sold.cash, 1880); close(sold.capitalTax, 200); close(sold.dividendTax, 20); close(sold.taxReserve, 0);
  close(sold.holdings[0].performance.returned, 1880); close(sold.benchmark.totalReturn, sold.totalReturn);
  input.config.dividendPolicy = 'reinvest';
  const reinvest = P.simulate(input); close(reinvest.cash, 1944); close(reinvest.cashDividends, 0);
  close(reinvest.holdings[0].cashDividends, 0); close(reinvest.taxEvents[0].basisAdded, 80);
  close(reinvest.benchmark.totalReturn, reinvest.totalReturn);
});

test('cash entitlements accrue only to pre-existing shares, stay in the reporting currency, and can fund an explicit rebalance', () => {
  const input = fixture([{ values: [1, 1.1, 1.21], fractions: { [days[0]]: .5, [days[1]]: 1 / 11, [days[2]]: 1 / 11 } }],
    { initial: 7000, monthly: 7000, currency: 'CNY', dividendPolicy: 'cash' });
  input.fxHistory.series[2][1] = 8;
  const r = P.simulate(input); assert.equal(r.error, undefined);
  // First ex-date: only original 1000 USD shares receive 560 CNY; another 1000 shares then purchased.
  // Second ex-date: 2000 USD shares pay 1280 CNY. The first 560 CNY are never retranslated.
  close(r.curve[1].cash, 560); close(r.cashDividends, 1840); close(r.cash, 1840); close(r.contributed, 14000);
  close(r.holdings[0].grossValue, 16000); close(r.dividendTax, 460);
  assert.equal(r.taxEvents.filter(e => e.type === 'dividend').length, 2);
  input.config.rebalance = 'month';
  const rebalanced = P.simulate(input); assert.equal(rebalanced.error, undefined);
  close(rebalanced.curve[1].cash, 0);
  close(rebalanced.transactions.find(t => t.reason === 'rebalance').amount, 560);
  close(rebalanced.cash, 2080 * .1 * 8 * .8);
  close(rebalanced.profit, rebalanced.holdings[0].performance.profit);
});

test('a cash policy requires distribution coverage even without taxes; missing benchmark evidence stays isolated', () => {
  const input = fixture([{ values: [1, 1, 1] }, { values: [1, 2, 3] }], {
    currency: 'USD', positions: [{ id: 'us:A', weight: 100 }], dividendPolicy: 'cash', tax: P.taxConfig(), benchmarkId: 'us:B' });
  delete input.histories['us:B'].dividendEvidence;
  let r = P.simulate(input);
  assert.equal(r.error, undefined); close(r.value, 1000); close(r.cashDividends, 0);
  assert.match(r.benchmarkError, /资产1.*分红.*无法拆出现金分红/);
  input.histories['us:A'].dividendEvidence.through = days[1];
  assert.match(P.simulate(input).error, /资产0.*仅覆盖.*2025-02-03.*无法拆出现金分红/);
  delete input.config.dividendPolicy;
  r = P.simulate(input); assert.equal(r.error, undefined); assert.equal(r.config.dividendPolicy, 'reinvest');
  const copy = policy => P.sanitizeDraft({schemaVersion: 1, ...input.config, dividendPolicy: policy}, new Set(['us:A', 'us:B']));
  assert.equal(copy(undefined).dividendPolicy, 'reinvest'); assert.equal(copy('cash').dividendPolicy, 'cash');
  for (const invalid of [null, false, 'withdraw']) {
    assert.throws(() => copy(invalid), /分红处理/);
    assert.match(P.simulate({...input, config: {...input.config, dividendPolicy: invalid}}).error, /分红处理/);
  }
});
