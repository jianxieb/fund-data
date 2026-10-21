const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const base = { budgetCny: 100000, count: 1, months: 0, date: '2026-10-12', startBank: 'boc', bank: 'bochk',
  returnBank: 'bochk', exitBank: 'boc', route: 'USD', broker: 'za', outcome: 'broker-balance',
  profitUsd: 0, taxRate: 20, creditCny: 0, tradeFeeUsd: 0, withdrawalIndex: 1, buyOrders: 1, sellOrders: 1, sharePriceUsd: 100 };
const calc = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const fee = (r, key) => r.rows.find(row => row.key === key);

test('a confirmed funding receipt fee changes the named receiving account, funded USD and total once for all offered non-internal channels', () => {
  let checked = 0;
  for (const broker of D.calculator.brokers) for (const bank of D.calculator.hkBanks) {
    const config = M.calculatorRoute({ ...base, broker, bank });
    for (const depositMethod of M.calculatorChannels(config, D).depositMethods) {
      const before = calc({ broker, bank, depositMethod }).selected;
      if (!before || before.depositMethod === 'internal') continue;
      const after = calc({ broker, bank, depositMethod, depositOtherCny: 137 }).selected;
      assert.ok(after, `${broker}/${bank}/${depositMethod}`);
      near(fee(after, 'depositOther').cny, 137);
      near(after.steps.hongKong, before.steps.hongKong);
      near(after.steps.fundedUsd, before.steps.fundedUsd - (137 - (fee(before, 'depositOther').cny ?? 0)) / after.refs.USD);
      near(after.costCny, before.costCny + 137 - (fee(before, 'depositOther').cny ?? 0));
      assert.equal(fee(after, 'depositOther').estimate, undefined);
      assert.match(fee(after, 'depositOther').evidence, /本人(?:回单|报价)/);
      const restored = calc({ broker, bank, depositMethod, depositOtherCny: '' }).selected;
      assert.deepEqual(restored, before);
      checked++;
    }
  }
  assert.ok(checked > 30, checked);
});

test('same-account settlement does not expose or validate nonexistent transfer fees', () => {
  for (const [broker, bank] of [['za', 'za'], ['hsbc', 'hsbc'], ['chief', 'bochk'], ['usmart', 'hsbc']]) {
    const config = M.calculatorRoute({ ...base, broker, bank, depositMethod: 'internal', hsbcBalanceWaiver: true });
    const fields = M.calculatorAdjustmentFields(config, D);
    assert.ok(!fields.includes('depositHkd')); assert.ok(!fields.includes('depositOtherCny'));
    const before = M.calculatorJourney(config, D, Q).selected;
    const after = M.calculatorJourney({ ...config, depositHkd: 'invalid', depositOtherCny: -1 }, D, Q).selected;
    assert.ok(before); assert.ok(after);
    near(fee(after, 'depositBank').cny, 0); near(fee(after, 'depositOther').cny, 0);
    near(after.net, before.net); near(after.costCny, before.costCny);
  }
});

test('unused FX, withdrawal and second-account inputs cannot break a broker cash endpoint or same-bank result', () => {
  for (const broker of D.calculator.brokers) {
    const config = M.calculatorRoute({ ...base, broker, bank: 'hsbc', returnBank: 'hsbc', hsbcBalanceWaiver: true });
    const before = M.calculatorJourney(config, D, Q).selected;
    const after = M.calculatorJourney({ ...config, entryPrice: 'invalid', returnHkdPrice: -1, exitPrice: 'invalid',
      inwardHkd: -1, intermediaryCny: -1, returnWireHkd: -1, returnExtraCny: -1,
      returnMonthlyHkd: -1, returnBalanceHkd: -1, balanceHkd: 'invalid' }, D, Q).selected;
    assert.ok(before); assert.ok(after, broker);
    near(after.net, before.net); near(after.costCny, before.costCny);
  }
  const before = calc({ outcome: 'usd-balance', bank: 'bochk', returnBank: 'bochk' }).selected;
  const after = calc({ outcome: 'usd-balance', bank: 'bochk', returnBank: 'bochk',
    returnMonthlyHkd: -1, returnBalanceHkd: -1, balanceHkd: 'invalid' }).selected;
  assert.ok(after); near(after.net, before.net); near(fee(after, 'account').cny, 0);
});

test('real FX and asset qualification inputs still reject invalid numbers and change the relevant fee', () => {
  assert.match(calc({ route: 'HKD', entryPrice: -1 }).error, /汇率/);
  assert.match(calc({ outcome: 'mainland', returnCurrency: 'HKD', returnHkdPrice: -1 }).error, /汇率/);
  assert.match(calc({ outcome: 'cnh-card', exitPrice: 'invalid' }).error, /汇率/);
  assert.match(calc({ bank: 'hsbc', balanceHkd: -1 }).error, /非负数/);
  const charged = calc({ bank: 'hsbc', months: 12, balanceHkd: 0 }).selected;
  const qualified = calc({ bank: 'hsbc', months: 12, balanceHkd: 10000 }).selected;
  near(fee(charged, 'account').cny, 1200 * charged.refs.HKD);
  near(fee(qualified, 'account').cny, 0);
});

test('direct Payment Connect has no editable SWIFT intermediary charge and stale charge inputs cannot break it', () => {
  const config = M.calculatorRoute({ ...base, route: 'CNH', fxMode: 'bank', mainlandMethod: 'payment-connect' });
  assert.ok(!M.calculatorAdjustmentFields(config, D).includes('entryMiddleCny'));
  const before = M.calculatorJourney(config, D, Q).selected;
  for (const value of ['invalid', -1, 137]) {
    const after = M.calculatorJourney({ ...config, entryMiddleCny: value }, D, Q).selected;
    assert.ok(after); near(fee(after, 'entryMiddle').cny, 0);
    near(after.net, before.net); near(after.costCny, before.costCny);
  }
});

test('an unavailable source FX quote retains known opening and asset costs separately from bank charges', () => {
  for (const route of ['USD', 'HKD']) {
    const config = M.calculatorRoute({ ...base, startBank: 'sc', bank: 'hsbc', broker: 'hsbc', route,
      months: 12, openingCny: 123, extraCapitalCny: 50000, annualGapPct: 2, hsbcBalanceWaiver: false });
    const r = M.calculatorJourney(config, D, Q).partial;
    assert.ok(r); assert.equal(r.errorStage, '01'); assert.match(r.error, /现汇卖出价/);
    near(fee(r, 'extra').cny, 1123); near(fee(r, 'extra').items[0].cny, 123);
    near(fee(r, 'extra').items[1].cny, 1000);
    near(fee(r, 'account').items.find(item => item.bankId === 'hsbc').cny, 1200 * r.refs.HKD);
    near(fee(r, 'account').items.find(item => item.region === 'mainland' && item.bankId === 'sc').cny, 1800);
    assert.equal(r.steps.hongKong, undefined); assert.equal(r.steps.fundedUsd, undefined);
    const withOtherOpening = M.calculatorJourney({ ...config, openingCny: 321 }, D, Q).partial;
    near(fee(withOtherOpening, 'extra').cny, 1321);
    near(fee(withOtherOpening, 'account').cny, fee(r, 'account').cny);
  }
});
