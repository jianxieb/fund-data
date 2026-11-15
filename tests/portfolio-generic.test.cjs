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

const month = (before, after) => Array.from({ length: 35 }, (_, i) => day(i) < '2024-02-01' ? before : after);   // 2024-01-01 … 2024-02-04
const contributions = r => r.transactions.filter(t => t.reason === 'contribution');

test('a contribution buys the holdings below target in proportion to their gaps and sells nothing', () => {
  const r = run([{ values: month(100, 200) }, { values: month(100, 100) }], { monthly: 1000, contributionAllocation: 'underweight' });
  // 1 Feb: A is worth 1000 and B 500; with the new 1000 each target is 1250, so the gaps are 250 and 750.
  assert.deepEqual(contributions(r).map(t => [t.day, t.id, t.side]), [['2024-02-01', 'stock:A', 'buy'], ['2024-02-01', 'stock:B', 'buy']]);
  close(contributions(r)[0].amount, 250); close(contributions(r)[1].amount, 750);
  assert.deepEqual(r.holdings.map(h => Math.round(h.grossValue * 1e6) / 1e6), [1250, 1250]);
  assert.equal(r.transactions.filter(t => t.side === 'sell').length, 0);
  const proportional = run([{ values: month(100, 200) }, { values: month(100, 100) }], { monthly: 1000 });
  assert.deepEqual(contributions(proportional).map(t => t.amount), [500, 500]);
  assert.equal(r.contributed, proportional.contributed); assert.equal(r.deposits, proportional.deposits);
});

test('a holding above target receives nothing and none is bought past its target', () => {
  const r = run([{ values: month(100, 400) }, { values: month(100, 100) }], { monthly: 1000, contributionAllocation: 'underweight' });
  // A is worth 2000 against a 1750 target; all 1000 goes to B, which ends at 1500, still under 1750.
  assert.deepEqual(contributions(r).map(t => [t.id, Math.round(t.amount * 1e6) / 1e6]), [['stock:B', 1000]]);
});

test('on target, underweight equals the proportional purchase to the cent, with a fee and a cash share', () => {
  const specs = [{ values: month(100, 100) }, { values: month(100, 100) }];
  const config = { positions: [{ id: 'stock:A', weight: 30 }, { id: 'stock:B', weight: 30 }], monthly: 1000, transactionFee: 1 };
  const proportional = run(specs, config), under = run(specs, { ...config, contributionAllocation: 'underweight' });
  assert.equal(contributions(under).length, 2);
  contributions(under).forEach((t, i) => { close(t.amount, contributions(proportional)[i].amount); close(t.fee, contributions(proportional)[i].fee); });
  close(under.cash, proportional.cash); close(under.value, proportional.value);
});

test('underweight contributions realise no gains tax where a calendar rebalance would', () => {
  const specs = [{ values: month(100, 200) }, { values: month(100, 100) }], tax = { cnStockCapitalGains: 20 };
  const under = run(specs, { monthly: 1000, contributionAllocation: 'underweight', tax });
  const calendar = run(specs, { monthly: 1000, rebalance: 'month', tax });
  assert.equal(under.capitalTax, 0); assert.ok(calendar.capitalTax > 0);
});

test('underweight is rejected with position-managing methods, ignored without a budget, and validated', () => {
  const input = account([{ values: month(100, 100) }, { values: month(100, 100) }], { monthly: 1000, contributionAllocation: 'underweight' });
  for (const initialMethod of ['ma200_hold', 'cash_topup']) {
    const r = P.simulate({ ...input, config: { ...input.config, initialMethod } });
    assert.equal(r.error, '优先补低配只能与一次性、分批或回撤阶梯投入同时使用'); assert.equal(r.errorField, 'initialMethod');
  }
  for (const initialMethod of ['lump_sum', 'tranche_6', 'tranche_12', 'tranche_24', 'drawdown_ladder']) {
    assert.equal(P.simulate({ ...input, config: { ...input.config, initialMethod } }).error, undefined, initialMethod);
  }
  assert.equal(P.simulate({ ...input, config: { ...input.config, initialMethod: 'ma200_hold', monthly: 0 } }).error, undefined);
  assert.match(P.simulate({ ...input, config: { ...input.config, contributionAllocation: 'momentum' } }).error, /追加资金去向无效/);
  const ids = new Set(['stock:A', 'stock:B']);
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config }, ids).contributionAllocation, 'underweight');
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config, contributionAllocation: undefined }, ids).contributionAllocation, 'target');
});

const YEAR = 365.2425, flat = n => Array.from({ length: n }, () => 100);
const half = { positions: [{ id: 'stock:A', weight: 50 }] };

test('idle cash compounds at the annual rate by calendar days, whatever the spacing of valuation days', () => {
  const r = run([{ values: flat(367) }], { ...half, cashRate: 3 });   // 2024-01-01 … 2025-01-01, 366 days
  close(r.cashInterest, 500 * (Math.pow(1.03, 366 / YEAR) - 1));
  close(r.cash, 500 + r.cashInterest); close(r.value, 1000 + r.cashInterest); close(r.profit, r.cashInterest);
  assert.equal(r.contributed, 1000);
  close(r.curve.at(-1).cashInterest, r.cashInterest); assert.equal(r.curve[0].cashInterest, 0);
  const input = account([{ values: flat(367) }], { ...half, cashRate: 3 });
  const sparse = input.histories['stock:A'];
  sparse.series = sparse.series.filter((_, i) => i % 5 === 0 || i === 366);
  close(P.simulate(input).cashInterest, r.cashInterest);
});

test('interest is return, not capital: NAV, XIRR and the cash row rise while contributions and signals stay put', () => {
  const values = Array.from({ length: 400 }, (_, i) => i < 200 ? 100 + i * .2 : i < 260 ? 140 - (i - 200) : 80 + (i - 260) * .3);
  const config = { positions: [{ id: 'stock:A', weight: 60 }], initialMethod: 'drawdown_ladder', monthly: 100, contributionMethod: 'dca_drawdown' };
  const zero = run([{ values }], config), paid = run([{ values }], { ...config, cashRate: 4 });
  assert.equal(paid.contributed, zero.contributed);
  assert.deepEqual(paid.plan, zero.plan, 'no drawdown trigger may move with the cash rate');
  assert.ok(paid.cashInterest > 0 && paid.value > zero.value && paid.xirr > zero.xirr && paid.annualReturn > zero.annualReturn);
  close(paid.holdings.reduce((sum, h) => sum + h.profit, 0) + paid.cashInterest, paid.profit, 1e-6);
  assert.equal(zero.cashInterest, 0);
});

test('principal waiting in a tranche plan earns interest and is still released in the planned amounts', () => {
  const r = run([{ values: flat(200) }], { positions: [{ id: 'stock:A', weight: 100 }], initial: 600, initialMethod: 'tranche_6', cashRate: 5 });
  assert.deepEqual(r.plan.initial.map(p => p.amount), [100, 100, 100, 100, 100, 100]);
  let cash = 600, last = null, expected = 0;
  for (const p of r.curve) {   // the same account written out by hand: accrue, then release 100 on each planned day
    if (last) { const interest = cash * (Math.pow(1.05, (Date.parse(p.day) - Date.parse(last)) / 86400000 / YEAR) - 1); cash += interest; expected += interest; }
    if (r.plan.initial.some(step => step.day === p.day)) cash -= 100;
    last = p.day;
  }
  close(r.cashInterest, expected); close(r.profit, expected); close(r.cash, expected);
});

test('the cash rate is validated, defaults to zero, and an unset configuration reproduces the earlier ledger', () => {
  const input = account([{ values: flat(40) }], half);
  for (const cashRate of [-0.1, 20.1, NaN, '2']) assert.match(P.simulate({ ...input, config: { ...input.config, cashRate } }).error, /现金年利率须在0至20%之间/);
  const plain = P.simulate(input), explicit = P.simulate({ ...input, config: { ...input.config, cashRate: 0, contributionAllocation: 'target' } });
  assert.deepEqual(explicit.curve, plain.curve); assert.deepEqual(explicit.transactions, plain.transactions);
  assert.equal(plain.cashInterest, 0);
  const ids = new Set(['stock:A']);
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config }, ids).cashRate, 0);
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config, cashRate: 2.5 }, ids).cashRate, 2.5);
  assert.throws(() => P.sanitizeDraft({ schemaVersion: 1, ...input.config, cashRate: 99 }, ids), /现金年利率/);
});
