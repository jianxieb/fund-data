const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const { audit: auditCurrent, config: currentConfig } = require('../scripts/audit_money_flow.cjs');
const Q = require('./fixtures/money-flow-quotes-20261009.json');
const config = { ...currentConfig, date: '2026-10-10' };
const audit = () => auditCurrent({ quotes: Q, date: config.date });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const base = M.calculatorRoute({ ...config, startBank: 'cib', bank: 'bochk', broker: 'za', returnBank: 'bochk', exitBank: 'hsbc', route: 'USD', outcome: 'usd-balance' });
const run = changes => M.calculatorJourney({ ...base, ...changes }, D, Q);

test('every account/currency/endpoint combination has a decision; every selectable route has a reconciled full quote', () => {
  const r = audit();
  assert.equal(r.combinationsChecked, 150000);
  assert.equal(r.pricedCombinations, 610);
  assert.equal(r.distinctPricedRoutes, 70);
  assert.equal(r.unpricedSelectableRoutes, 0);
  assert.equal(Object.values(r.rejected).reduce((a, b) => a + b, 0) + r.pricedCombinations, r.combinationsChecked);
  assert.ok(r.routes.every(r => !r.key.includes('abc')));
});

test('SWIFT GO adds exactly 50 CNY per payment and covers overseas fees rather than charging them again', () => {
  for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const count of [2, 3, 30]) {
    const r = run({ bank, broker, count }).selected;
    assert.ok(r?.complete, [bank, broker, count].join('/'));
    close(r.rows.find(x => x.key === 'sender').cny, count * 50);
    close(r.rows.find(x => x.key === 'entryMiddle').cny, 0);
    close(r.rows.find(x => x.key === 'entryInward').cny, 0);
    close(r.steps.hongKong, (100000 - count * 50) / r.startSell);
    close(r.rows.find(x => x.key === 'sender').items.reduce((a, b) => a + b.cny, 0), count * 50);
  }
  const r = run({ count: 2, usedFreeTransfers: 29 }).selected;
  close(r.rows.find(x => x.key === 'sender').cny, 200); // 100 GO + 100 for the 31st telegram.
});

test('SWIFT GO limits reject over-limit, exhausted budget and invalid numeric inputs without a partial balance', () => {
  for (const changes of [{ count: 1 }, { count: 0 }, { count: 1.5 }, { count: 121 }, { budgetCny: 50, count: 1 }, { months: -1 }]) {
    const r = run(changes); assert.ok(r.error); assert.equal(r.selected, undefined); assert.equal(r.partial, undefined);
  }
  const quote = run({ count: 1, budgetCny: 60000 }).selected.startSell;
  assert.ok(run({ count: 1, budgetCny: quote * 10000 + 50 }).selected);
  assert.match(run({ count: 1, budgetCny: quote * 10000 + 50.01 }).error, /上限/);
  const before = run({ count: 2 });
  const after = run({ date: '2027-07-01' });
  assert.ok(before.selected); assert.equal(after.selected, undefined); assert.match(after.error, /有效期/);
});

test('ordinary wires and retired banks cannot regain a complete badge through private zero-fee overrides', () => {
  for (const startBank of ['abc', 'boc', 'cmb', 'comm', 'hang', 'sc', 'icbc', 'ccb']) {
    const r = run({ startBank, entryMiddleCny: 0, senderFeeCny: 0, startSell: 6.7 });
    assert.ok(r.excluded); assert.equal(r.selected, undefined);
  }
  assert.ok(run({ mainlandMethod: 'swift', entryMiddleCny: 0 }).excluded);
  assert.equal(M.calculatorIssue({ ...base, broker: 'za', bank: 'bochk' }, D), '');
  assert.equal(M.calculatorIssue({ ...base, broker: 'hsbc', bank: 'bochk' }, D), '');
});

test('all kept routes survive fees, account, stock order and promotion boundaries', () => {
  const scenarios = [
    { months: 0 }, { months: 1 }, { months: 12, hsbcBalanceWaiver: false },
    { trade25: false }, { usedFreeTransfers: 30 }, { zaLv2: true, usedPromoOrders: 4 },
    { trade25: true, otherTurnoverHkd: 250001 }, { profitUsd: 1000 },
    { buyOrders: 12, sellOrders: 12 }, { sharePriceUsd: .5 },
    { useVoucher: true, voucherUsd: 10, voucherOrders: 1, voucherScope: 'platform', voucherExpiry: '2026-12-31' }
  ];
  for (const row of audit().routes) {
    const [startBank, bank, broker, returnBank, exitBank, route, outcome] = row.key.split('/');
    for (const changes of scenarios) {
      const s = M.calculatorRoute({ ...base, ...changes, startBank, bank, broker, returnBank, exitBank: exitBank || 'hsbc', route, outcome });
      const r = M.calculatorJourney(s, D, Q).selected;
      assert.ok(r?.complete, row.key + JSON.stringify(changes));
      assert.ok(r.rows.every(x => Number.isFinite(x.cny) && x.cny >= 0));
      close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
    }
  }
});

test('missing or stale source quotes close the whole quote, never downgrade to a partial total', () => {
  for (const mutate of [q => { delete q.banks.cib; }, q => { q.banks.cib.quotes.USD.asOf = '2020-01-01'; }]) {
    const q = structuredClone(Q); mutate(q);
    const r = M.calculatorJourney(base, D, q);
    assert.ok(r.error); assert.equal(r.selected, undefined); assert.equal(r.partial, undefined);
  }
});


test('HKD GO limit requires a current same-bank USD valuation, with no NaN error or borrowed quote', () => {
  for (const mutate of [q => { delete q.banks.cib.quotes.USD; }, q => { q.banks.cib.quotes.USD.asOf = '2020-01-01'; }]) {
    const q = structuredClone(Q); mutate(q);
    const r = M.calculatorJourney({ ...base, route: 'HKD', fxMode: 'bank' }, D, q);
    assert.equal(r.selected, undefined); assert.match(r.error, /兴业USD牌价/); assert.doesNotMatch(r.error, /NaN/);
  }
});
