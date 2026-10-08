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
test('unrealized gains are untaxed; liquidation taxes only positive net proceeds over cost', () => {
  const input = fixture([{ values: [1, 2, 2] }]);
  const held = P.simulate(input); close(held.value, 2000); close(held.capitalTax, 0);
  input.config.tax.liquidate = true;
  const sold = P.simulate(input); close(sold.value, 1800); close(sold.profit, 800); close(sold.capitalTax, 200);
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
  input.config.tax.usDividend = 0;
  const untaxedDividend = P.simulate(input); close(untaxedDividend.value, 1100); close(untaxedDividend.capitalTax, 0);
});
test('rebalancing solves tax and trading fees before target allocations, preserving the cash ledger', () => {
  const input = fixture([{ values: [1, 2, 2] }, { market: 'cn', currency: 'CNY', kind: 'fund', values: [1, 1, 1] }], { rebalance: 'month' });
  const r = P.simulate(input); assert.equal(r.error, undefined);
  close(r.capitalTax, 250 / .95 * .1); close(r.value, 1500 - r.capitalTax); close(r.cash, 0);
  close(r.holdings[0].value, r.value / 2); close(r.holdings[1].value, r.value / 2);
  close(r.holdings.reduce((s, h) => s + h.profit, 0), r.profit);
  close(r.holdings[0].performance.returned, 250 / .95 * .9);
  input.config.transactionFee = 1;
  const paid = P.simulate(input); assert.equal(paid.error, undefined);
  close(paid.cash, 0); close(paid.holdings[0].value, paid.value / 2); close(paid.holdings[1].value, paid.value / 2);
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
