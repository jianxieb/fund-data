const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const E = require('./fixtures/money-flow-corporate-chats-20261012.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const input = { ...config, date: '2026-10-11', budgetCny: 100000, count: 1, months: 12,
  startBank: 'boc', bank: 'za', broker: 'usmart', route: 'USD', fxMode: 'bank', outcome: 'broker-balance',
  entryMiddleCny: '0', depositHkd: '', depositOtherCny: '', mainlandMethod: 'swift', depositMethod: 'chats',
  useVoucher: false, hsbcBalanceWaiver: false, bankBalancesHkd: {}, balanceHkd: '0', icbcCnhAccount: true };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...input, ...changes }), D, Q);
const row = (r, key) => r.rows.find(x => x.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const reconcile = r => close(r.netCny, r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);

test('corporate USD CHATS has a named broker recipient and published bank tariff, distinct from personal receipt', () => {
  const catalogue = structuredClone(D.calculator);
  for (const broker of ['chief', 'usmart']) for (const bank of D.calculator.hkBanks) for (const route of D.calculator.currencies) {
    const s = { ...input, broker, bank, route }, targets = E.receivingAccounts[broker].banks.filter(id => id !== bank);
    const direct = M.calculatorChannels(s, D).depositMethods.filter(id => id === 'chats' || id.startsWith('chats-'));
    assert.equal(direct.length, targets.length);
    for (const method of direct) {
      const receiving = M.calculatorDepositBank({ ...s, depositMethod: method }, D), tariff = E.tariffs[receiving.id];
      assert.ok(targets.includes(receiving.id)); assert.equal(D.sources[tariff.sourceKey].url, tariff.source);
      const result = run({ ...s, depositMethod: method }), r = result.selected;
      assert.ok(r, `${broker}/${bank}/${route}/${method}: ${result.error}`);
      assert.equal(r.corporateReceivingBank.id, receiving.id); assert.equal(r.fundingBank, null);
      close(row(r, 'depositBank').cny, bank === 'sc' ? 22 * r.refs.USD : bank === 'icbc-asia' ? 50 * r.refs.HKD : 0);
      close(row(r, 'depositOther').cny, tariff.feeHkd * r.refs.HKD);
      assert.equal(row(r, 'depositOther').nativeCurrency, 'HKD');
      assert.match(row(r, 'depositOther').estimate, /企业CHATS标准价/);
      assert.ok(row(r, 'depositOther').sources.includes(tariff.sourceKey));
      assert.doesNotMatch(row(r, 'depositOther').label, /One|优进理财|本人/);
      close(r.steps.fundedUsd, (r.steps.hkConvertedUsd ?? r.steps.hongKong) - (row(r, 'depositBank').cny + row(r, 'depositOther').cny) / r.refs.USD);
      assert.deepEqual(row(r, 'account').items.filter(x => x.region === 'hong-kong').map(x => x.bankId), [bank]);
      reconcile(r);
    }
  }
  assert.deepEqual(D.calculator, catalogue);
});

test('the BOCHK small-receipt exemption uses the actual local transfer amount, not the original CNY budget or mainland wire count', () => {
  const basis = run({ senderFeeCny: '0', entryInwardHkd: '0', budgetCny: 1000 }).selected;
  for (const [amountHkd, feeHkd] of [[499.99, 0], [500, 0], [500.01, 15]]) for (const count of [1, 2, 3]) {
    const r = run({ senderFeeCny: '0', entryInwardHkd: '0', startSell: basis.refs.USD, budgetCny: amountHkd * basis.refs.HKD, count }).selected;
    assert.ok(r); close(row(r, 'depositOther').cny, feeHkd * r.refs.HKD); reconcile(r);
  }
  const hsbc = run({ bank: 'za', depositMethod: 'chats-hsbc', senderFeeCny: '0', entryInwardHkd: '0', budgetCny: 100 }).selected;
  close(row(hsbc, 'depositOther').cny, 15 * hsbc.refs.HKD);
});

test('uSMART ICBC Asia corporate CHATS charges 10 HKD once without inventing an additional personal account or small-receipt waiver', () => {
  const catalogue = structuredClone(D.calculator);
  for (const bank of D.calculator.hkBanks) for (const count of [1, 2, 3]) {
    if (bank === 'icbc-asia') continue;
    const r = run({ bank, count, depositMethod: 'chats-icbc-asia' }).selected;
    assert.ok(r, bank + '/' + count);
    assert.equal(r.corporateReceivingBank.id, 'icbc-asia'); assert.equal(r.fundingBank, null);
    close(row(r, 'depositOther').cny, 10 * r.refs.HKD);
    assert.ok(row(r, 'depositOther').sources.includes('icbcAsiaInward'));
    assert.deepEqual(row(r, 'account').items.filter(x => x.region === 'hong-kong').map(x => x.bankId), [bank]);
    close(row(r, 'account').cny, bank === 'hsbc' ? 1200 * r.refs.HKD : 0);
    const methods = M.calculatorChannels({ ...input, bank }, D).depositMethods;
    assert.ok(methods.includes('chats-icbc-asia')); assert.ok(methods.includes('via-icbc-asia'));
    reconcile(r);
  }
  const small = run({ bank: 'za', depositMethod: 'chats-icbc-asia', senderFeeCny: '0', entryInwardHkd: '0', budgetCny: 100 }).selected;
  close(row(small, 'depositOther').cny, 10 * small.refs.HKD);
  const actual = run({ depositMethod: 'chats-icbc-asia', depositOtherCny: '0' }).selected;
  close(row(actual, 'depositOther').cny, 0); assert.equal(row(actual, 'depositOther').estimate, undefined); reconcile(actual);
  assert.equal(M.calculatorDepositBank({ ...input, broker: 'chief', depositMethod: 'chats-icbc-asia' }, D), null);
  assert.equal(M.calculatorFundingBank({ ...input, depositMethod: 'via-icbc-asia' }, D).id, 'icbc-asia');
  const same = run({ bank: 'icbc-asia', depositMethod: 'internal' }).selected;
  close(row(same, 'depositBank').cny, 0); close(row(same, 'depositOther').cny, 0);
  assert.deepEqual(D.calculator, catalogue);
});

test('uSMART CITIC uses the distinct 20 HKD wholesale corporate receipt and does not copy free retail, 15 HKD or 10 HKD tariffs', () => {
  for (const bank of D.calculator.hkBanks) for (const count of [1, 2, 3]) {
    const r = run({ bank, count, depositMethod: 'chats-citic' }).selected;
    assert.ok(r, bank + '/' + count);
    assert.equal(r.corporateReceivingBank.id, 'citic'); assert.equal(r.fundingBank, null);
    close(row(r, 'depositOther').cny, 20 * r.refs.HKD);
    assert.ok(row(r, 'depositOther').sources.includes('citicBusinessInward'));
    assert.match(row(r, 'depositOther').evidence, /公司业务/);
    assert.deepEqual(row(r, 'account').items.filter(x => x.region === 'hong-kong').map(x => x.bankId), [bank]);
    assert.ok(!M.calculatorChannels({ ...input, bank }, D).depositMethods.includes('via-citic'));
    reconcile(r);
  }
  const small = run({ bank: 'za', depositMethod: 'chats-citic', senderFeeCny: '0', entryInwardHkd: '0', budgetCny: 100 }).selected;
  close(row(small, 'depositOther').cny, 20 * small.refs.HKD);
  const actual = run({ depositMethod: 'chats-citic', depositOtherCny: '0' }).selected;
  close(row(actual, 'depositOther').cny, 0); assert.equal(row(actual, 'depositOther').estimate, undefined);
  assert.equal(M.calculatorDepositBank({ ...input, broker: 'chief', depositMethod: 'chats-citic' }, D), null);
});

test('corporate receipt, personal-bank bridge, internal funding and overseas SWIFT do not inherit each other\'s fees', () => {
  const direct = run({}).selected, personal = run({ depositMethod: 'via-bochk' }).selected;
  assert.ok(row(direct, 'depositOther').sources.includes('usmartChatsGuide'));
  close(row(personal, 'depositOther').cny, 0); assert.equal(personal.corporateReceivingBank, null);
  assert.equal(personal.fundingBank.id, 'bochk');
  for (const bank of ['bochk', 'hsbc']) {
    const r = run({ bank, depositMethod: 'internal' }).selected;
    close(row(r, 'depositOther').cny, 0); assert.equal(r.corporateReceivingBank, null); reconcile(r);
  }
  const swift = run({ depositMethod: 'swift' }).selected;
  assert.equal(swift.corporateReceivingBank, null); assert.equal(row(swift, 'depositOther').cny, null);
  const override = run({ depositOtherCny: '8.5' }).selected;
  close(row(override, 'depositOther').cny, 8.5); assert.equal(row(override, 'depositOther').estimate, undefined); reconcile(override);
  const coupon = run({ useVoucher: true, voucherType: 'cash', voucherAmount: '1', voucherScope: 'both' }).selected;
  close(row(coupon, 'depositOther').cny, row(direct, 'depositOther').cny);
  for (const changes of [{ depositMethod: 'chats-absent' }, { bank: 'bochk', depositMethod: 'chats-bochk' },
    { broker: 'ibkr', depositMethod: 'chats-bochk' }, { route: 'HKD', fxMode: 'manual', broker: 'ibkr', depositMethod: 'chats-bochk' }]) {
    const result = run(changes); assert.match(result.error, /CHATS收款|本地美元转账/); assert.ok(result.partial.steps.hongKong > 0);
  }
  for (const depositMethod of [7, true, {}, ['chats']]) {
    assert.equal(M.calculatorDepositBank({ ...input, depositMethod }, D), null);
    const result = run({ depositMethod }); assert.match(result.error, /保存的入金方式无效/);
    assert.ok(result.partial.steps.hongKong > 0);
  }
});
