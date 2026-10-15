const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = structuredClone(require('./fixtures/money-flow-quotes-20261012.json'));
// Public ordinary-personal TT table, 2026-10-15 10:23:58 (raw response archived).
Q.offshoreUsd['ccb-asia'] = { quotes: { HKD: { bidPerUsd: 7.8242, askPerUsd: 7.8727, asOf: '2026-10-15 10:23:58' } } };
const base = { budgetCny: 100000, date: '2026-10-15', months: 12, count: 1, profitUsd: 0,
  startBank: 'cib', bank: 'hsbc', broker: 'hsbc', returnBank: 'ccb-asia', exitBank: 'ccb',
  route: 'USD', outcome: 'cnh-card', mainlandMethod: 'swift', depositMethod: 'internal',
  hsbcBalanceWaiver: true, trade25: true, ccbLinkedCard: true, cardMode: 'ccb-link',
  buyOrders: 1, sellOrders: 1, sharePriceUsd: 100, taxRate: 20, creditCny: 0, withdrawalIndex: 1 };
const run = (changes = {}, quotes = Q) => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, quotes);
const row = (r, key) => r.rows.find(item => item.key === key);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const ledger = r => {
  near(r.rows.reduce((sum, item) => sum + (item.cny ?? 0), 0), r.costCny);
  near(r.netCny, r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);
};

test('CCB Asia is a return bank, CCB mainland is a receiver, and prior departure choices stay intact', () => {
  assert.deepEqual(D.calculator.departureBanks, ['boc', 'cib', 'cmb', 'icbc']);
  assert.ok(D.calculator.receivingBanks.includes('ccb'));
  assert.ok(D.calculator.returnBanks.includes('ccb-asia'));
  assert.ok(D.calculator.returnBanks.includes('icbc-asia'));
  assert.ok(!D.calculator.hkBanks.includes('ccb-asia'));
  assert.match(run({ bank: 'ccb-asia' }).error, /香港收款银行/);
  const r = run({ outcome: 'mainland', returnCurrency: 'USD', returnMethod: 'swift', returnExtraCny: 0 }).selected;
  assert.ok(r); assert.equal(r.exit.id, 'ccb');
  near(row(r, 'returnInward').cny, 15 * r.refs.HKD);
  near(row(r, 'returnWire').cny, 100 * r.refs.HKD);
  assert.equal(row(r, 'returnFx'), undefined);
  near(r.steps.settledCny, r.steps.mainlandReceived * r.exitPrice);
  assert.equal(row(r, 'account').items.some(item => item.label.includes('龙卡')), false);
  ledger(r);
  const wire = run({ broker: 'ibkr', outcome: 'usd-balance', depositMethod: 'chats' }).selected;
  near(row(wire, 'returnInward').cny, 60 * wire.refs.HKD);
  const cheque = run({ broker: 'chief', outcome: 'usd-balance', depositMethod: 'chats' }).selected;
  assert.equal(row(cheque, 'returnInward').cny, null);
  assert.match(row(cheque, 'returnInward').label, /建行亚洲.*本地USD支票/);
  assert.equal(cheque.complete, false);
});

test('Long Card requires linked accounts before spending and bills each annual cycle once', () => {
  const blocked = run({ ccbLinkedCard: false });
  assert.match(blocked.error, /两地建行账户/);
  assert.equal(blocked.partial.errorStage, '04');
  assert.ok(blocked.partial.steps.returnUsd > 0);
  assert.equal(blocked.partial.steps.returnHkd, undefined);
  assert.equal(row(blocked.partial, 'account').items.some(item => item.label.includes('龙卡')), false);
  for (const [months, annualPeriods] of [[0, 1], [12, 1], [13, 2], [24, 2]]) {
    const r = run({ months }).selected;
    assert.ok(r); assert.equal(r.cardMode, 'ccb-link');
    const annual = row(r, 'account').items.filter(item => item.label.includes('龙卡'));
    assert.equal(annual.length, 1); near(annual[0].cny, annualPeriods * 50 * r.refs.HKD);
    near(row(r, 'returnInward').cny, 15 * r.refs.HKD);
    near(r.steps.returnHkd, r.steps.returnUsd * 7.8242);
    near(r.steps.settledCny, r.steps.returnHkd * Q.banks.ccb.quotes.HKD.buy);
    near(row(r, 'card').cny, 0);
    assert.match(row(r, 'exitFx').estimate, /公开牌价测算/);
    assert.equal(r.currency, 'CNY'); ledger(r);
  }
});

test('Long Card actual settlement replaces the reference and no other bank supplies a missing CCB Asia price', () => {
  const actual = run({ returnHkdPrice: 7.8, cardCnyPerHkd: .85 }).selected;
  near(actual.steps.returnHkd, actual.steps.returnUsd * 7.8);
  near(actual.steps.settledCny, actual.steps.returnHkd * .85);
  assert.equal(row(actual, 'exitFx').estimate, undefined); ledger(actual);
  const missing = structuredClone(Q); delete missing.offshoreUsd['ccb-asia'];
  const r = run({}, missing).selected;
  assert.equal(r.indicativeReturnFx, true); assert.equal(r.complete, false);
  assert.equal(row(r, 'returnFx').cny, null);
  assert.match(row(r, 'returnFx').status, /建行亚洲.*USD\/HKD直接报价尚未取得/);
  assert.equal(row(r, 'exitFx').cny, null);
  assert.equal(row(r, 'exitFx').exchanges, undefined); ledger(r);
});

test('ICBC HKD card works without HKID but requires its own all-in payment rate', () => {
  const missing = run({ returnBank: 'icbc-asia', cardMode: '', ccbLinkedCard: false, icbcCnhAccount: false }).selected;
  assert.ok(missing); assert.equal(missing.cardMode, 'hkd');
  assert.equal(row(missing, 'exitFx').cny, null);
  assert.match(missing.exitIssue, /银联／ICBC Pay.*实际扣账汇率/);
  assert.ok(!missing.missing.some(item => /香港身份证/.test(item)));
  const actual = run({ returnBank: 'icbc-asia', cardMode: 'hkd', icbcCnhAccount: false, cardCnyPerHkd: .84 }).selected;
  near(actual.steps.returnHkd, actual.steps.returnUsd * Q.offshoreUsd['icbc-asia'].quotes.HKD.bidPerUsd);
  near(actual.steps.settledCny, actual.steps.returnHkd * .84);
  assert.equal(row(actual, 'card'), undefined); // Payment rate includes all card debits.
  assert.equal(row(actual, 'account').items.some(item => item.label.includes('龙卡')), false);
  ledger(actual);
  for (const cardCnyPerHkd of [-1, 0, 'invalid']) assert.match(run({ returnBank: 'icbc-asia', cardMode: 'hkd', cardCnyPerHkd }).error, /有效正数|非负数/);
  assert.match(run({ returnBank: 'icbc-asia', cardMode: 'cnh', icbcCnhAccount: false }).error, /香港身份证/);
});
