const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');

const day = i => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function history(asset, values, days) {
  return { schemaVersion: 1, id: asset.id, currency: asset.currency, basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: values.map((value, i) => [days[i], value]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} } };
}
// Each spec is one CNY asset priced on consecutive calendar days starting `offset` days after 2024-01-01.
function account(specs, config = {}, offset = 0) {
  const days = specs[0].values.map((_, i) => day(i + offset));
  const assets = specs.map((spec, i) => ({ id: 'stock:' + 'ABCD'[i], code: 'ABCD'[i], name: '资产' + 'ABCD'[i], kind: 'stock', currency: 'CNY', status: 'available' }));
  return { catalog: { assets, fx: { id: 'fx:CNY', name: '美元兑人民币', currency: 'CNY', status: 'available' } },
    histories: Object.fromEntries(assets.map((asset, i) => [asset.id, history(asset, specs[i].values, days)])),
    config: { positions: assets.map(asset => ({ id: asset.id, weight: 100 / assets.length })), initial: 1000, monthly: 0, years: 'common',
      rebalance: 'none', transactionFee: 0, feeBasis: 'net', ...config } };
}
const run = (...args) => { const result = P.simulate(account(...args)); assert.equal(result.error, undefined); return result; };
const rebalances = r => r.transactions.filter(t => t.reason === 'rebalance');

test('a band rebalances at the close after the one where drift reached it, at that day’s prices', () => {
  const specs = [{ values: [100, 120, 150, 150, 150] }, { values: [100, 100, 100, 100, 100] }];
  const r = run(specs, { rebalance: 'band', rebalanceBand: 10 });
  // Day 2 closes at 750 / 500: weights 60% / 40%, exactly ten points from 50%.
  assert.deepEqual(rebalances(r).map(t => [t.day, t.signalDay, t.id, t.side]), [[day(3), day(2), 'stock:A', 'sell'], [day(3), day(2), 'stock:B', 'buy']]);
  for (const t of rebalances(r)) close(t.amount, 125);
  assert.equal(r.rebalances, 1);
  assert.deepEqual(r.holdings.map(h => Math.round(h.grossValue * 1e6) / 1e6), [625, 625]);
  assert.deepEqual(rebalances(run(specs, { rebalance: 'band', rebalanceBand: 10.01 })), [], 'under the band nothing trades');
});

test('band mode ignores the calendar and calendar modes ignore the band', () => {
  const specs = [{ values: [100, 105, 105, 105] }, { values: [100, 100, 100, 100] }];   // 2024-01-30 … 2024-02-02
  assert.equal(run(specs, { rebalance: 'band', rebalanceBand: 10 }, 29).rebalances, 0);
  const monthly = run(specs, { rebalance: 'month', rebalanceBand: 10 }, 29);
  assert.equal(monthly.rebalances, 1);
  assert.deepEqual([...new Set(rebalances(monthly).map(t => t.day))], ['2024-02-01']);
  assert.ok(rebalances(monthly).every(t => t.signalDay === undefined));
});

test('a triggered band leaves no drift, pays fees and sale tax once, and never fires on the first day', () => {
  const values = Array.from({ length: 300 }, (_, i) => 100 * (1 + .5 * Math.sin(i / 20)) + i * .2);
  const r = run([{ values }, { values: values.map(() => 100) }], { rebalance: 'band', rebalanceBand: 5, transactionFee: .5, tax: { cnStockCapitalGains: 20 } });
  const days = [...new Set(rebalances(r).map(t => t.day))];
  assert.ok(days.length >= 2 && !days.includes(r.start));
  assert.equal(r.rebalances, days.length);
  // A rebalance resets drift to zero, so the next one cannot follow on the very next close.
  const order = r.curve.map(p => p.day);
  assert.ok(days.every((d, i) => !i || order.indexOf(d) - order.indexOf(days[i - 1]) > 1));
  assert.ok(r.capitalTax > 0 && r.tradeCost > 0);
  close(r.holdings.reduce((sum, h) => sum + h.profit, 0), r.profit, 1e-6);
});

test('a band does not buy back what a timing rule has parked', () => {
  const values = Array.from({ length: 420 }, (_, i) => i < 260 ? 100 + i : i < 330 ? 360 - (i - 260) * 3 : 150);
  const r = run([{ values }, { values: values.map(() => 100) }], { initialMethod: 'ma200_hold', rebalance: 'band', rebalanceBand: 5 });
  const out = r.curve.filter(p => p.exposure === 0).map(p => p.day);
  assert.ok(out.length > 20, 'the fixture must spend time out of the market');
  assert.deepEqual(r.transactions.filter(t => t.side === 'buy' && out.includes(t.day)), []);
});

test('band settings are validated and survive import; other modes do not require a band', () => {
  const input = account([{ values: [100, 101, 102] }]);
  for (const rebalanceBand of [0, -1, 50.1, NaN, undefined, '5']) {
    assert.match(P.simulate({ ...input, config: { ...input.config, rebalance: 'band', rebalanceBand } }).error, /偏离阈值须大于0且不超过50个百分点/);
  }
  assert.match(P.simulate({ ...input, config: { ...input.config, rebalance: 'weekly' } }).error, /再平衡方式无效/);
  assert.equal(P.simulate({ ...input, config: { ...input.config, rebalance: 'year' } }).error, undefined);
  const ids = new Set(['stock:A']), draft = { schemaVersion: 1, ...input.config, rebalance: 'band', rebalanceBand: 7.5 };
  assert.equal(P.sanitizeDraft(draft, ids).rebalanceBand, 7.5);
  assert.throws(() => P.sanitizeDraft({ ...draft, rebalanceBand: 0 }, ids), /偏离阈值/);
  assert.equal(P.sanitizeDraft({ ...draft, rebalance: 'year' }, ids).rebalanceBand, undefined);
});
