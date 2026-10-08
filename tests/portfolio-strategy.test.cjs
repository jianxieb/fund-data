const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function calendar(start, end) {
  const result = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) result.push(new Date(t).toISOString().slice(0, 10));
  return result;
}
function fixture(days, values, overrides = {}) {
  const prices = Array.isArray(values[0]) ? values : [values];
  const assets = prices.map((_, i) => ({ id: 'stock:' + i, code: String(i), name: '标的' + i, kind: 'stock', market: 'cn', currency: 'CNY', status: 'available' }));
  const histories = Object.fromEntries(assets.map((a, i) => [a.id, { schemaVersion: 1, id: a.id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1), series: days.map((day, j) => [day, prices[i][j]]), dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} } }]));
  return { catalog: { assets }, histories, config: { positions: assets.map(a => ({ id: a.id, weight: 100 / assets.length })), initial: 600, monthly: 0, years: 'common', rebalance: 'none', transactionFee: 0, feeBasis: 'net', ...overrides } };
}
function simulate(input) { const r = P.simulate(input); assert.equal(r.error, undefined); return r; }

test('staged principal enters the account immediately but only scheduled portions are invested', () => {
  const days = calendar('2025-01-05', '2025-02-10');
  for (const count of [6, 12, 24]) {
    const r = simulate(fixture(days, days.map(() => 1), { initialMethod: 'tranche_' + count }));
    close(r.contributed, 600); close(r.value, 600); close(r.totalReturn, 0);
    close(r.holdings[0].bought, 1200 / count); close(r.cash, 600 - 1200 / count);
    close(r.initialReserve, r.cash); assert.equal(r.deposits, 1);
    assert.deepEqual(r.transactions.map(t => t.day), ['2025-01-05', '2025-02-01']);
  }
});

test('periodic rebalance excludes reserved principal and keeps tax and fee charges self financing', () => {
  const days = calendar('2025-01-01', '2025-02-02');
  const input = fixture(days, [days.map(day => day >= '2025-01-10' ? 2 : 1), days.map(() => 1)], { initialMethod: 'tranche_6', rebalance: 'month' });
  const r = simulate(input);
  close(r.initialReserve, 400); close(r.cash, 400); close(r.value, 650);
  r.holdings.forEach(h => close(h.value, 125)); close(r.profit, 50);
  Object.assign(input.config, { monthly: 100, transactionFee: 1, tax: { cnStockCapitalGains: 20 } });
  const taxed = simulate(input);
  close(taxed.initialReserve, 400); assert.ok(taxed.cash >= 400 - 1e-7);
  close(taxed.holdings[0].value, taxed.holdings[1].value);
  assert.ok(taxed.tradeCost > 0 && taxed.capitalTax > 0);
  close(taxed.holdings.reduce((a, h) => a + h.profit, 0), taxed.profit);
});

test('drawdown tranches trigger from prior closes once per threshold and cannot buy on the signal day', () => {
  const days = calendar('2025-01-01', '2025-01-10');
  const prices = [100, 90, 100, 80, 70, 70, 100, 90, 80, 70];
  const r = simulate(fixture(days, prices, { initial: 400, initialMethod: 'drawdown_ladder' }));
  assert.deepEqual(r.transactions.map(t => [t.day, t.amount]), [['2025-01-01', 100], ['2025-01-03', 100], ['2025-01-05', 100], ['2025-01-06', 100]]);
  close(r.value, 340); close(r.profit, -60); close(r.initialReserve, 0);
  const basket = simulate(fixture(days.slice(0, 3), [[100, 50, 50], [100, 100, 100]], { initial: 400, initialMethod: 'drawdown_ladder' }));
  // The reference basket fell 25%, even though only 25% of the real account was invested.
  close(basket.initialReserve, 100); close(basket.cash, 100); close(basket.value, 375);
  assert.deepEqual(basket.plan.initial.map(e => e.amount), [100, 200]);
});

test('drawdown principal still in cash is released after 36 months', () => {
  const days = calendar('2025-01-07', '2028-01-08');
  const r = simulate(fixture(days, days.map(() => 1), { initial: 400, initialMethod: 'drawdown_ladder' }));
  assert.deepEqual(r.plan.initial, [{ day: '2025-01-07', amount: 100 }, { day: '2028-01-01', amount: 300 }]);
  close(r.value, 400); close(r.cash, 0); close(r.initialReserve, 0);
});

test('monthly, quarterly and yearly investing use actual dated budgets, including partial periods', () => {
  const days = calendar('2025-01-30', '2025-05-02'), prices = days.map(() => 1);
  for (const method of ['dca_month', 'dca_quarter', 'dca_year']) {
    const r = simulate(fixture(days, prices, { initial: 0, monthly: 100, contributionMethod: method }));
    close(r.contributed, 500); close(r.value, 500); close(r.totalReturn, 0);
    assert.equal(r.deposits, { dca_month: 5, dca_quarter: 2, dca_year: 1 }[method]);
    if (method === 'dca_quarter') assert.deepEqual(r.plan.income, [{ day: '2025-01-30', amount: 300 }, { day: '2025-04-01', amount: 200 }]);
    if (method === 'dca_year') assert.deepEqual(r.plan.income, [{ day: '2025-01-30', amount: 500 }]);
    const combined = simulate(fixture(days, prices, { initial: 600, monthly: 100, initialMethod: 'tranche_12', contributionMethod: method }));
    close(combined.contributed, 1000); close(combined.initialReserve, 350);
    assert.equal(combined.plan.income[0].day, '2025-02-01');
  }
});

test('drawdown multiples change actual cash flows and use the previous close at each month start', () => {
  const days = calendar('2025-01-01', '2025-05-01');
  const prices = days.map(day => day === '2025-01-31' ? 90 : day.slice(0, 7) === '2025-01' ? 100 : day.slice(0, 7) === '2025-02' ? 80 : day.slice(0, 7) === '2025-03' ? 70 : 60);
  const input = fixture(days, prices, { initial: 0, monthly: 100, contributionMethod: 'dca_drawdown' });
  const r = simulate(input);
  assert.deepEqual(r.plan.income.map(e => e.amount), [100, 150, 200, 300, 300]);
  close(r.contributed, 1050); close(r.value, (100 / 100 + 150 / 80 + 200 / 70 + 300 / 60 + 300 / 60) * 60);
  close(r.profit, r.holdings[0].profit); close(r.holdings[0].performance.invested, 1050);
  input.histories['stock:0'].series.at(-1)[1] = 999;
  assert.deepEqual(simulate(input).plan.income, r.plan.income);
});

test('MA200 warms up before the window, executes the next close and pays tax on actual sales', () => {
  const days = calendar('2024-01-01', '2024-07-26'), start = days[200];
  const prices = days.map((_, i) => i <= 200 ? 100 : [120, 150, 180, 90, 200, 210, 210][i - 201]);
  const r = simulate(fixture(days, prices, { initial: 1000, initialMethod: 'ma200_hold', years: 'custom', start, end: days.at(-1), tax: { cnStockCapitalGains: 20 } }));
  assert.equal(r.strategy.warmupDays, 200); assert.equal(r.strategy.insufficientMaDays, 0);
  assert.deepEqual(r.transactions.map(t => [t.day, t.side]), [[days[202], 'buy'], [days[205], 'sell'], [days[206], 'buy']]);
  close(r.capitalTax, (1000 * 200 / 150 - 1000) * .2); close(r.value, 1000 * 200 / 150 - r.capitalTax);
  assert.equal(r.holdings[0].performance.start, days[202]);
  assert.equal(r.holdings[0].performance.observations, days.length - 202);
  close(r.curve[1].value, 1000); assert.equal(r.curve[0].exposure, 0);
  close(r.holdings[0].profit, r.profit); assert.equal(r.timingChanges, 3);
});

test('MA income plans distinguish above, below and missing history without inventing signals', () => {
  const days = calendar('2024-01-01', '2024-08-02'), start = days[200];
  const prices = days.map((day, i) => i < 200 ? 100 : day < '2024-08-01' ? 80 : 120);
  for (const [method, factor] of [['dca_ma_trend', .5], ['dca_ma_contrarian', 2]]) {
    const r = simulate(fixture(days, prices, { initial: 0, monthly: 100, contributionMethod: method, years: 'custom', start, end: days.at(-1) }));
    assert.deepEqual(r.plan.income.map(e => e.amount), [100 * factor, 100 * factor]);
    close(r.contributed, 200 * factor);
    const shortDays = days.slice(0, 5);
    const short = simulate(fixture(shortDays, shortDays.map(() => 80), { initial: 0, monthly: 100, contributionMethod: method }));
    close(short.contributed, 100); assert.equal(short.strategy.warmupDays, 0);
  }
});

test('future prices cannot change earlier trading decisions, signals, taxes or account values', () => {
  const days = calendar('2024-01-01', '2024-12-31'), start = days[200], cutoff = days[275];
  const input = fixture(days, days.map((_, i) => 100 + 20 * Math.sin(i / 7)), { initial: 1000, monthly: 100, initialMethod: 'ma200_hold', contributionMethod: 'dca_ma_contrarian', rebalance: 'quarter', years: 'custom', start, end: days.at(-1), tax: { cnStockCapitalGains: 20 } });
  const before = simulate(input);
  input.histories['stock:0'].series.filter(([day]) => day > cutoff).forEach(row => row[1] *= 5);
  const after = simulate(input);
  assert.deepEqual(after.transactions.filter(t => t.day <= cutoff), before.transactions.filter(t => t.day <= cutoff));
  assert.deepEqual(after.curve.filter(t => t.day <= cutoff), before.curve.filter(t => t.day <= cutoff));
});

test('all initial and income combinations reconcile; legacy configs and exported strategies stay compatible', () => {
  const days = calendar('2024-01-01', '2025-03-02'), prices = days.map(() => 1), ids = new Set(['stock:0']);
  for (const [initialMethod] of P.initialMethods) for (const [contributionMethod] of P.contributionMethods) {
    const input = fixture(days, prices, { initial: 600, monthly: 100, initialMethod, contributionMethod });
    const r = simulate(input);
    close(r.value, r.contributed); close(r.profit, 0); assert.ok(r.cash >= r.initialReserve - 1e-6);
    assert.equal(r.config.initialMethod, initialMethod); assert.equal(r.config.contributionMethod, contributionMethod);
    const copy = P.sanitizeDraft({ schemaVersion: 1, ...r.config }, ids);
    close(simulate({ ...input, config: copy }).value, r.value);
  }
  const input = fixture(days, prices);
  const legacy = simulate(input), explicit = simulate({ ...input, config: { ...input.config, initialMethod: 'lump_sum', contributionMethod: 'dca_month' } });
  assert.deepEqual(legacy.curve, explicit.curve); assert.deepEqual(legacy.transactions, explicit.transactions);
  const imported = P.sanitizeDraft({ schemaVersion: 1, ...input.config }, ids);
  assert.equal(imported.initialMethod, 'lump_sum'); assert.equal(imported.contributionMethod, 'dca_month');
  for (const field of ['initialMethod', 'contributionMethod']) {
    assert.match(P.simulate({ ...input, config: { ...input.config, [field]: 'unknown' } }).error, /投入方式/);
    assert.throws(() => P.sanitizeDraft({ schemaVersion: 1, ...input.config, [field]: 1 }, ids), /投入方式/);
  }
});
