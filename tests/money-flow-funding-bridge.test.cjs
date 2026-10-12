const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const evidence = require('./fixtures/money-flow-personal-bank-bridge-20261012.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const input = { ...config, date: '2026-10-11', budgetCny: 100000, count: 1, months: 12, profitUsd: 0,
  startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', outcome: 'broker-balance', returnBank: 'bochk', exitBank: 'boc',
  mainlandMethod: '', depositMethod: '', depositHkd: '', depositOtherCny: '', entryMiddleCny: '',
  hsbcBalanceWaiver: false, balanceHkd: '0', returnBalanceHkd: '0', bankBalancesHkd: {},
  cnHsbcFeeWaived: false, cnHangFeeWaived: false, cnScFeeWaived: false, useVoucher: false, icbcCnhAccount: true };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...input, ...changes }), D, Q);
const fee = (r, key) => r.rows.find(item => item.key === key);
const reconcile = r => close(r.netCny, r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);

test('personal-bank bridges are separate offered USD actions, without changing the account catalogue or direct methods', () => {
  const before = structuredClone(D.calculator);
  for (const broker of D.calculator.brokers) for (const bank of D.calculator.hkBanks) for (const route of D.calculator.currencies) {
    const provider = D.brokers.find(item => item.id === broker), s = { ...input, broker, bank, route, fxMode: 'bank' };
    const methods = M.calculatorChannels(s, D).depositMethods;
    const expected = (evidence.brokerReceivingBanks[broker]?.banks || []).filter(id => id !== bank).map(id => 'via-' + id);
    assert.deepEqual(methods.filter(method => method.startsWith('via-')), expected);
    for (const method of expected) assert.equal(M.calculatorFundingBank({ ...s, depositMethod: method }, D).id, method.slice(4));
    if (expected.length) {
      assert.ok(methods.includes('chats'));
      // SC's local USD tariff is CHATS; its 50 HKD SWIFT fee is overseas.
      assert.equal(methods.includes('swift'), bank !== 'sc');
    }
    if (provider.internalFundingBanks) for (const currency of ['HKD', 'CNH']) {
      assert.deepEqual(M.calculatorChannels({ ...s, route: currency, fxMode: 'manual' }, D).depositMethods.filter(method => method.startsWith('via-')), []);
    }
  }
  assert.deepEqual(D.calculator, before);
  for (const broker of D.calculator.brokers) assert.equal(M.calculatorFundingBank({ ...input, broker, depositMethod: 'via-absent' }, D), null);
});

test('each supported personal-bank bridge charges the sending bank, personal receipt and same-bank broker funding separately', () => {
  for (const broker of ['usmart', 'chief']) for (const bank of D.calculator.hkBanks) for (const target of D.brokers.find(item => item.id === broker).internalFundingBanks) {
    if (target === bank) continue;
    for (const route of D.calculator.currencies) {
      const result = run({ broker, bank, route, fxMode: 'bank', depositMethod: 'via-' + target, entryMiddleCny: '0' });
      const r = result.selected || result.partial;
      assert.ok(result.selected, `${bank}/${target}/${broker}/${route}: ${result.error}`);
      assert.equal(r.bank.id, bank); assert.equal(r.broker.id, broker); assert.equal(r.fundingBank.id, target);
      close(fee(r, 'depositBank').cny, bank === 'sc' ? 22 * r.refs.USD : bank === 'icbc-asia' ? 50 * r.refs.HKD : 0);
      close(fee(r, 'depositOther').cny, evidence.personalReceipt[target].fee * r.refs.HKD); close(fee(r, 'depositBroker').cny, 0);
      assert.match(fee(r, 'depositBank').label, new RegExp('本人' + r.fundingBank.name));
      assert.match(fee(r, 'depositBroker').label, /同行入金/);
      assert.ok(!r.missing.some(item => /入金代理|收款行费/.test(item)));
      close(r.steps.fundingBankUsd, (r.steps.hkConvertedUsd ?? r.steps.hongKong) - (fee(r, 'depositBank').cny + fee(r, 'depositOther').cny) / r.refs.USD);
      reconcile(r);
      if (bank === 'sc') assert.equal(fee(r, 'depositBank').nativeCurrency, 'USD');
    }
  }
  const direct = run({ bank: 'hang', depositMethod: 'chats', entryMiddleCny: '0' }).selected;
  close(fee(direct, 'depositOther').cny, 15 * direct.refs.HKD);
  assert.match(fee(direct, 'depositOther').estimate, /企业CHATS标准价/);
  assert.equal(direct.corporateReceivingBank.id, 'bochk');
  assert.equal(direct.fundingBank, null); assert.equal(direct.complete, true);
  const receipt = run({ bank: 'hang', depositMethod: 'via-bochk', entryMiddleCny: '0', depositHkd: '5', depositOtherCny: '9' }).selected;
  close(fee(receipt, 'depositBank').cny, 5 * receipt.refs.HKD); close(fee(receipt, 'depositOther').cny, 9); reconcile(receipt);
});

test('a bridge account carries its own period fee and asset qualification and is counted once when it is also the return account', () => {
  const s = { bank: 'hang', depositMethod: 'via-hsbc', entryMiddleCny: '0' };
  const charged = run(s).selected;
  const hsbcItem = r => fee(r, 'account').items.filter(item => item.region === 'hong-kong' && item.bankId === 'hsbc');
  assert.equal(hsbcItem(charged).length, 1); close(hsbcItem(charged)[0].cny, 1200 * charged.refs.HKD);
  close(hsbcItem(run({ ...s, balanceHkd: '10000' }).selected)[0].cny, hsbcItem(charged)[0].cny);
  close(hsbcItem(run({ ...s, bankBalancesHkd: { hsbc: 10000 } }).selected)[0].cny, 0);
  close(hsbcItem(run({ ...s, hsbcBalanceWaiver: true }).selected)[0].cny, 0);
  for (const outcome of ['usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
    const r = run({ ...s, outcome, returnBank: 'hsbc', exitBank: 'hsbc', returnMethod: 'linked' }).selected;
    assert.ok(r); assert.equal(hsbcItem(r).length, 1); close(hsbcItem(r)[0].cny, 1200 * r.refs.HKD); reconcile(r);
  }
  const unused = run({ ...s, depositMethod: 'via-bochk', returnBank: 'hsbc' }).selected;
  assert.equal(hsbcItem(unused).length, 0);
});

test('invalid and unaffordable bridges preserve the first leg without inventing a bank receipt or negative intermediate balance', () => {
  for (const changes of [{ broker: 'za', bank: 'hang', depositMethod: 'via-bochk' },
    { bank: 'bochk', depositMethod: 'via-bochk' }, { bank: 'hang', depositMethod: 'via-sc' },
    { bank: 'hang', route: 'HKD', fxMode: 'manual', broker: 'ibkr', depositMethod: 'via-bochk' }]) {
    const result = run({ ...changes, entryMiddleCny: '0' });
    assert.match(result.error, /经本人银行同行入金/); assert.ok(result.partial.steps.hongKong > 0);
    assert.equal(result.partial.steps.fundingBankUsd, undefined);
  }
  const result = run({ bank: 'sc', depositMethod: 'via-bochk', budgetCny: 100, senderFeeCny: '0', entryMiddleCny: '0' });
  assert.match(result.error, /余额不足/);
  assert.ok(result.partial.steps.hongKong > 0); assert.equal(result.partial.steps.fundingBankUsd, undefined);
  for (const amount of Object.values(result.partial.steps)) if (typeof amount === 'number') assert.ok(amount >= 0);
});

test('a qualified Hang Seng bridge remains selectable but does not pad uSMART recommendations, and applying useful routes reproduces their prices', () => {
  const qualified = { ...input, cnHangFeeWaived: true };
  const snapshot = structuredClone(qualified), recommendations = M.calculatorRecommendations(qualified, D, Q);
  assert.deepEqual(qualified, snapshot);
  assert.equal(new Set(recommendations.plans.map(plan => plan.result.start.id)).size, recommendations.plans.length);
  assert.ok(!recommendations.plans.some(plan => plan.result.start.id === 'hang'));
  const hang = M.calculatorJourney(M.calculatorRoute({ ...qualified, startBank: 'hang', bank: 'hang',
    route: 'CNH', fxMode: 'bank', mainlandMethod: 'linked', depositMethod: 'via-bochk' }), D, Q).selected;
  assert.ok(hang?.complete); assert.equal(hang.fundingBank.id, 'bochk'); reconcile(hang);
  for (const plan of recommendations.plans) {
    assert.equal(plan.result.broker.id, 'usmart'); assert.ok(plan.result.complete && plan.result.quotedCore);
    const r = M.calculatorJourney({ ...qualified, ...plan.config, ...M.calculatorAccountState(qualified, plan.config, D) }, D, Q).selected;
    close(r.costCny, plan.result.costCny); reconcile(r);
  }
});
