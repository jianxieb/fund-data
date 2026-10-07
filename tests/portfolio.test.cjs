const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const M = require('../assets/model.js');

const dates = ['2025-01-30', '2025-02-03', '2025-02-04'];
function fixture(specs, options = {}) {
  const assets = specs.map((s, i) => ({ id: s.id || 'stock:' + (i + 1), name: s.name || '资产' + (i + 1),
    code: s.code || String(i + 1), currency: s.currency || 'CNY', status: 'available', ...s }));
  const history = (a, values, days = dates) => ({ schemaVersion: 1, id: a.id, currency: a.currency,
    basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1),
    series: values.map((v, i) => [days[i], v]) });
  const histories = Object.fromEntries(assets.map(a => [a.id, history(a, a.values, a.days)]));
  const fx = { id: 'fx:CNY', name: '美元汇率', currency: 'CNY', status: 'available' };
  return { catalog: { assets, fx }, histories,
    fxHistory: history(fx, options.fxValues || [7, 7, 7], options.fxDays),
    config: { positions: assets.map(a => ({ id: a.id, weight: 100 / assets.length })),
      initial: 1000, monthly: 0, years: 'common', rebalance: 'none', transactionFee: 0, feeBasis: 'net', ...options } };
}
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('investment amounts translate to weights and the same initial funding in the simulation', () => {
  const input = fixture([{ values: [1, 1, 1] }], { initial: 100000 });
  input.config.positions[0].weight = P.weightFromAmount(100000, 30000);
  close(input.config.positions[0].weight, 30);
  const first = P.simulate(input);
  close(first.holdings[0].bought, 30000); close(first.cash, 70000);
  input.config.initial = 200000;
  close(P.amountFromWeight(input.config.initial, input.config.positions[0].weight), 60000);
  input.config.positions[0].weight = P.weightFromAmount(input.config.initial, 30000);
  close(input.config.positions[0].weight, 15);
  close(P.simulate(input).holdings[0].bought, 30000);
  const amount = 30000.01, total = 123456.78;
  close(P.amountFromWeight(total, P.weightFromAmount(total, amount)), amount);
});

test('amount conversion leaves overspending visible and does not divide by a zero or invalid budget', () => {
  const input = fixture([{ values: [1, 1, 1] }], { initial: 100000 });
  input.config.positions[0].weight = P.weightFromAmount(100000, 110000);
  close(input.config.positions[0].weight, 110);
  assert.match(P.simulate(input).error, /权重/);
  for (const total of [0, -1, NaN, null]) assert.ok(Number.isNaN(P.weightFromAmount(total, 30000)));
  for (const amount of [-1, NaN, null]) assert.ok(Number.isNaN(P.weightFromAmount(100000, amount)));
  close(P.amountFromWeight(0, 30), 0);
  assert.ok(Number.isNaN(P.amountFromWeight(NaN, 30)));
});

test('portfolio structure counts weights and treats 2x/3x as ETF subsets', () => {
  const assets = [{ id: 'e2', kind: 'etf', leverage: 2 }, { id: 'e3', kind: 'etf', leverage: 3 },
    { id: 'e1', kind: 'etf' }, { id: 's', kind: 'stock', leverage: 2 }, { id: 'f', kind: 'fund' }];
  const positions = [15, 20, 10, 25, 20].map((weight, i) => ({ id: assets[i].id, weight }));
  assert.deepEqual(P.allocation(positions, assets), { etf: 45, stock: 25, fund: 20, cash: 10,
    unclassified: 0, total: 90, x2: 15, x3: 20, invalid: false });
  const excess = P.allocation([...positions, { id: 'unknown', weight: 20 }], assets);
  assert.equal(excess.total, 110); assert.equal(excess.etf, 45); assert.equal(excess.invalid, true);
  assert.equal(excess.unclassified, 20); assert.equal(excess.cash, 0);
  assert.equal(P.allocation([{ id: 's', weight: NaN }], assets).invalid, true);
});

test('1/2/3/5-year snapshots restart cash flows at each window with a shared end date', () => {
  const days = [];
  for (let t = Date.parse('2020-01-01'); t <= Date.parse('2026-01-01'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const input = fixture([{ days, values: days.map(() => 1) }], { monthly: 100, years: 1 });
  const before = JSON.stringify(input.config), snapshots = P.simulateWindows(input, '2026-01-01');
  assert.equal(JSON.stringify(input.config), before);
  assert.deepEqual(snapshots.map(r => r.start), ['2025-01-01', '2024-01-01', '2023-01-01', '2021-01-01']);
  assert.ok(snapshots.every(r => r.end === '2026-01-01'));
  for (const [i, expected] of [2200, 3400, 4600, 7000].entries()) {
    close(snapshots[i].value, expected); close(snapshots[i].contributed, expected);
    close(snapshots[i].totalReturn, 0);
  }
  const recentDays = days.filter(day => day >= '2024-01-01');
  const recent = fixture([{ days: recentDays, values: recentDays.map(() => 1) }], { monthly: 100 });
  const partial = P.simulateWindows(recent, '2026-01-01');
  assert.equal(partial[0].error, undefined); assert.equal(partial[1].error, undefined);
  close(partial[0].value, 2200); close(partial[1].value, 3400);
  assert.match(partial[2].error, /不覆盖/); assert.match(partial[3].error, /不覆盖/);
  const short = fixture([{ values: [1, 2, 3] }]);
  assert.ok(P.simulateWindows(short, dates.at(-1)).every(r => /不覆盖/.test(r.error)));
});

test('buy and hold uses real paths; monthly rebalance has a different hand-calculated result', () => {
  const input = fixture([{ values: [1, 2, 1] }, { values: [1, 1, 2] }]);
  const hold = P.simulate(input);
  assert.equal(hold.error, undefined);
  close(hold.value, 1500); close(hold.totalReturn, 50);
  close(hold.holdings[0].profit, 0); close(hold.holdings[1].profit, 500);
  input.config.rebalance = 'month';
  const balanced = P.simulate(input);
  close(balanced.value, 1875); close(balanced.totalReturn, 87.5);
  assert.equal(balanced.rebalances, 1);
});

test('holding returns and drawdown follow the asset path, independently of contributions and rebalancing', () => {
  const input = fixture([{ values: [100, 120, 90] }, { values: [100, 100, 100] }]);
  const hold = P.simulate(input), metrics = hold.holdings[0].performance;
  close(metrics.totalReturn, -10); close(metrics.annualReturn, -10); close(metrics.mdd, -25);
  close(metrics.volatility, Math.sqrt((.45 ** 2 / 2) * 250) * 100);
  close(hold.holdings[1].performance.volatility, 0);
  assert.equal(metrics.start, hold.start); assert.equal(metrics.end, hold.end);
  assert.equal(metrics.currency, 'CNY'); assert.equal(metrics.transactionFeesIncluded, false);
  assert.ok(hold.mdd > metrics.mdd);
  Object.assign(input.config, { monthly: 1500, transactionFee: 1, rebalance: 'month' });
  const changed = P.simulate(input);
  assert.deepEqual(changed.holdings.map(h => h.performance), hold.holdings.map(h => h.performance));
  assert.notEqual(changed.holdings[0].profit, hold.holdings[0].profit);
});

test('holding risk does not acquire zero-return dates from a second market calendar', () => {
  const alone = fixture([{ values: [100, 120, 90] }]);
  const mixed = fixture([{ values: [100, 120, 90] },
    { values: [1, 1, 1, 1], days: [dates[0], '2025-01-31', dates[1], dates[2]] }]);
  assert.deepEqual(P.simulate(alone).holdings[0].performance, P.simulate(mixed).holdings[0].performance);
  assert.equal(P.simulate(mixed).curve.length, 4);
});

test('holding metrics include historical FX once, including exchange-rate changes on local market holidays', () => {
  const input = fixture([{ currency: 'USD', values: [10, 10], days: [dates[0], dates[2]] }], { fxValues: [7, 8, 6] });
  const r = P.simulate(input), p = r.holdings[0].performance;
  close(p.totalReturn, (6 / 7 - 1) * 100); close(p.mdd, -25);
  close(p.volatility, Math.sqrt(((1 / 7 + .25) ** 2 / 2) * 250) * 100);
  assert.equal(p.observations, 3);
  close(p.totalReturn, r.totalReturn);
});

test('holding returns use the chosen window rather than inception and annualize only beyond a year', () => {
  const days = [];
  for (let t = Date.parse('2023-01-02'); t <= Date.parse('2025-01-02'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const input = fixture([{ days, values: days.map((_, i) => 100 * 1.44 ** (i / (days.length - 1))) }]);
  const full = P.simulate(input).holdings[0].performance;
  close(full.totalReturn, 44); close(full.mdd, 0);
  close(full.annualReturn, (1.44 ** (365.2425 / 731) - 1) * 100);
  Object.assign(input.config, { years: 'custom', start: '2024-12-02', end: '2025-01-02' });
  const short = P.simulate(input).holdings[0].performance;
  close(short.totalReturn, (1.44 ** (31 / 731) - 1) * 100);
  close(short.annualReturn, short.totalReturn);
  assert.equal(short.start, '2024-12-02');
});

test('cash is the unallocated weight and excess allocation is rejected', () => {
  const input = fixture([{ values: [1, 2, 3] }]);
  input.config.positions[0].weight = 40;
  const r = P.simulate(input);
  close(r.cash, 600); close(r.value, 1800); close(r.totalReturn, 80);
  input.config.positions[0].weight = 101;
  assert.match(P.simulate(input).error, /权重/);
  input.config.positions = [{ id: 'stock:1', weight: 60 }, { id: 'stock:1', weight: 30 }];
  assert.match(P.simulate(input).error, /重复/);
});

test('additional capital is unitized before buying and cannot inflate portfolio return', () => {
  const input = fixture([{ values: [1, 2, 3] }], { monthly: 1000 });
  const r = P.simulate(input);
  close(r.contributed, 2000); close(r.value, 4500); close(r.profit, 2500);
  close(r.totalReturn, 200); // Price tripled; 125% account profit / capital is a different measure.
  close(r.curve[1].nav, 2); close(r.curve[1].contributed, 2000);
  assert.equal(r.deposits, 2); assert.equal(r.xirr, null);
});

test('monthly-only cash flows start at the first actual common trade date', () => {
  const input = fixture([{ values: [2, 2, 2] }], { initial: 0, monthly: 3000 });
  const r = P.simulate(input);
  close(r.value, 6000); close(r.contributed, 6000); close(r.totalReturn, 0);
  assert.deepEqual(r.transactions.map(t => t.day), dates.slice(0, 2));
});

test('transaction cost is paid from available cash and rebalancing is self financing', () => {
  const input = fixture([{ values: [1, 2, 1] }, { values: [1, 1, 2] }], { transactionFee: 1, rebalance: 'month', monthly: 300 });
  const r = P.simulate(input);
  assert.equal(r.error, undefined);
  assert.ok(r.cash >= 0);
  close(r.transactions.filter(t => t.reason === 'initial').reduce((s, t) => s + t.amount + t.fee, 0), 1000);
  close(r.holdings.reduce((s, h) => s + h.profit, 0), r.value - r.contributed);
  close(r.tradeCost, r.transactions.reduce((s, t) => s + t.fee, 0));
  close(r.holdings.reduce((s, h) => s + h.value, 0) + r.cash, r.value);
});

test('USD assets convert once using historical FX; a missing FX day uses only a preceding quote', () => {
  const input = fixture([{ currency: 'USD', values: [1, 1, 2] }], { fxValues: [7, 8, 8] });
  const r = P.simulate(input);
  close(r.value, 1000 * 16 / 7);
  input.fxHistory.series = [['2025-01-30', 7], ['2025-02-04', 8]];
  const carried = P.simulate(input);
  close(carried.curve[1].nav, 1); // 8 is tomorrow's quote, not usable on February 3.
  assert.ok(carried.carriedFx > 0);
});

test('net histories keep embedded expenses; gross estimates undo fees once by actual holding days', () => {
  const input = fixture([{ id: 'us:TEST', name: '费用ETF', feesEmbedded: true, expenseRatio: 2, values: [1, 1, 1] }], { monthly: 500 });
  const net = P.simulate(input);
  close(net.value, 1500); close(net.tradeCost, 0);
  close(net.holdings[0].performance.totalReturn, 0);
  close(net.holdings[0].performance.mdd, 0);
  input.config.feeBasis = 'gross_estimate';
  const gross = P.simulate(input), factor = M.annualFeeFactor(2, dates[0], dates[2]), later = M.annualFeeFactor(2, dates[1], dates[2]);
  close(gross.value, 1000 * factor + 500 * later);
  input.config.feeOverrides = { '1': 0 };
  close(P.simulate(input).value, 1500);
});

test('feeder gross scenario needs an effective fee, while actual net returns remain usable', () => {
  const input = fixture([{ name: '标普500ETF联接A', fee: [1, .1, 0], values: [1, 1, 1] }]);
  assert.equal(P.simulate(input).error, undefined);
  input.config.feeBasis = 'gross_estimate';
  assert.match(P.simulate(input).error, /计费资产比例/);
  input.config.feeOverrides = { '1': .2 };
  assert.equal(P.simulate(input).error, undefined);
});

test('short-period annualization zero pads a year and does not compound a monthly return to 100%', () => {
  close(P.annualReturn(1.05, '2025-01-01', '2025-02-01'), 5);
  close(P.annualReturn(1.05, '2025-01-01', '2025-10-01'), 5);
  const long = P.annualReturn(1.21, '2023-01-01', '2025-01-01');
  assert.ok(long > 9.9 && long < 10.1);
  assert.equal(P.addYears('2024-02-29', -1), '2023-02-28');
});

test('a benchmark lacking the window does not truncate the requested portfolio', () => {
  const input = fixture([{ values: [1, 2, 3] }, { values: [1, 2, 3], days: ['2025-02-03', '2025-02-04', '2025-02-05'] }]);
  input.config.positions = [input.config.positions[0]];
  input.config.positions[0].weight = 100;
  input.config.benchmarkId = 'stock:2';
  const r = P.simulate(input);
  assert.equal(r.error, undefined); assert.equal(r.start, dates[0]); assert.equal(r.end, dates[2]);
  assert.match(r.benchmarkError, /不覆盖/); assert.equal(r.benchmark, null);
});

test('orders wait for common actual observations while valuation can use a preceding price', () => {
  const input = fixture([{ values: [1, 1, 1], days: ['2025-01-30', '2025-02-03', '2025-02-04'] },
    { values: [1, 1], days: ['2025-01-30', '2025-02-04'] }], { monthly: 1000 });
  const r = P.simulate(input);
  assert.equal(r.error, undefined);
  close(r.curve[1].contributed, 1000); close(r.curve[2].contributed, 2000);
  assert.ok(r.carriedPrices > 0);
  assert.ok(r.transactions.filter(t => t.reason === 'contribution').every(t => t.day === '2025-02-04'));
});

test('missing or mismatched source evidence cannot become a simulated return', () => {
  const input = fixture([{ values: [1, 1, 1] }]);
  input.histories['stock:1'].currency = 'USD';
  assert.match(P.simulate(input).error, /币种/);
  input.histories['stock:1'].currency = 'CNY';
  input.histories['stock:1'].basis = 'cumulative_nav';
  assert.match(P.simulate(input).error, /分红/);
  input.histories['stock:1'].basis = 'provider_adjusted_close';
  input.histories['stock:1'].series[1][0] = dates[0];
  assert.match(P.simulate(input).error, /日期/);
});

test('a requested long window cannot silently become a short inception window', () => {
  const input = fixture([{ values: [1, 2, 3] }], { years: 5 });
  assert.match(P.simulate(input).error, /不覆盖/);
  input.config.years = 'custom'; input.config.start = dates[0]; input.config.end = '2025-02-05';
  assert.match(P.simulate(input).error, /末日/);
});

test('a gap inside a single-asset window cannot disappear just because other markets are absent', () => {
  const input = fixture([{ values: [1, 2, 3], days: ['2025-01-02', '2025-02-03', '2025-02-04'] }]);
  assert.match(P.simulate(input).error, /超过14日/);
});

test('import accepts only tracked identities and valid funding, weights and fee overrides', () => {
  const config = { schemaVersion: 1, positions: [{ id: 'stock:1', weight: 80 }], initial: 1000, monthly: 0,
    rebalance: 'none', transactionFee: 0, years: 'common', feeBasis: 'net', feeOverrides: {} };
  assert.equal(P.sanitizeDraft(config, new Set(['stock:1'])).positions.length, 1);
  assert.throws(() => P.sanitizeDraft({ ...config, positions: [{ id: 'unknown', weight: 100 }] }, new Set(['stock:1'])), /未收录/);
  assert.throws(() => P.sanitizeDraft({ ...config, feeOverrides: { '123456': -1 } }, new Set(['stock:1'])), /年费/);
});

test('shipped catalog covers the exact research universe and a real mixed combination reconciles', () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const root = path.resolve(__dirname, '..'), context = {};
  vm.createContext(context);
  for (const name of ['data/snapshot.js', 'data/overseas-stocks.js', 'data/portfolio/catalog.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  const catalog = context.PORTFOLIO_CATALOG;
  const expected = [...M.dedupeFunds(context.FUNDS, context.EXTRA).map(f => 'fund:' + f.c), ...context.STOCKS.map(s => 'stock:' + s.c), ...context.OVERSEAS_STOCKS.map(s => 'stock:' + s.symbol),
    ...context.BM.filter(b => b.symbol && b.feesEmbedded).map(b => 'us:' + b.symbol)];
  assert.deepEqual([...catalog.assets.map(a => a.id)].sort(), expected.sort());
  const ids = ['us:SPY', 'stock:601138', 'fund:050025'];
  const histories = Object.fromEntries(ids.map(id => [id, JSON.parse(fs.readFileSync(path.join(root, catalog.assets.find(a => a.id === id).historyUrl)))]));
  const result = P.simulate({ catalog, histories, fxHistory: JSON.parse(fs.readFileSync(path.join(root, catalog.fx.historyUrl))),
    config: { positions: ids.map(id => ({ id, weight: 100 / 3 })), initial: 100000, monthly: 3000, transactionFee: .025,
      rebalance: 'quarter', years: 5, feeBasis: 'net', benchmarkId: 'us:SPY' } });
  assert.equal(result.error, undefined);
  close(result.holdings.reduce((s, h) => s + h.profit, 0), result.profit, .001);
  close(result.holdings.reduce((s, h) => s + h.value, 0) + result.cash, result.value, .001);
  assert.ok(result.deposits >= 60);
  assert.ok(result.annualReturn > -100 && result.annualReturn < 1000);
  for (const h of result.holdings) {
    const rows = histories[h.id].series;
    const fx = JSON.parse(fs.readFileSync(path.join(root, catalog.fx.historyUrl))).series;
    const value = day => P.at(rows, day).value * (h.currency === 'USD' ? P.at(fx, day, 7).value : 1);
    close(h.performance.totalReturn, (value(result.end) / value(result.start) - 1) * 100);
    assert.equal(h.performance.start, result.start); assert.equal(h.performance.end, result.end);
    assert.ok(Number.isFinite(h.performance.volatility));
    assert.ok(h.performance.mdd <= 0 && h.performance.mdd > -100);
  }
});
