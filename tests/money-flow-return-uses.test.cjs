const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261012.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const base = { ...config, date: '2026-10-12', sellDate: '2026-10-12', startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc', exitBank: 'boc',
  broker: 'ibkr', route: 'USD', mainlandMethod: 'swift', depositMethod: 'chats', outcome: 'usd-balance',
  hsbcBalanceWaiver: true, months: 1, entryMiddleCny: 0, depositOtherCny: 0, inwardHkd: 0, intermediaryCny: 0,
  brokerExitPrice: 6.7, atmAmountCny: 5000, atmTransactions: 2 };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q);
const row = (r, key) => r.rows.find(item => item.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const conserved = r => close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);

test('IBKR sells USD into CNH once before withdrawal, with minimum and proportional commission', () => {
  for (const budgetCny of [100000, 2000000]) {
    const r = run({ budgetCny, withdrawCurrency: 'CNH', outcome: 'cnh-card', exitPrice: 8 }).selected;
    const fee = row(r, 'brokerExitCommission').cny / r.refs.USD;
    if (budgetCny === 100000) close(fee, 2);
    else { assert.ok(fee > 2); close(fee, (r.steps.afterTaxUsd - fee) * .00002); }
    close(r.steps.brokerCnh, (r.steps.afterTaxUsd - fee) * 6.7);
    close(r.steps.returnCnh, r.steps.brokerCnh);
    assert.equal(r.steps.returnUsd, undefined);
    assert.equal(row(r, 'exitFx'), undefined);
    assert.equal(r.currency, 'CNH'); conserved(r);
  }
});

test('IBKR CNH local and wire fees use two monthly free withdrawals and the CNH tariff', () => {
  for (const method of ['local', 'wire']) for (const index of [1, 2, 3]) {
    const r = run({ withdrawCurrency: 'CNH', cnhWithdrawalMethod: method, withdrawalIndex: index }).selected;
    close(row(r, 'withdraw').cny / r.refs.CNH, index <= 2 ? 0 : method === 'local' ? 7 : 60);
    assert.equal(row(r, 'withdraw').nativeCurrency, 'CNH'); conserved(r);
  }
  const unpriced = run({ withdrawCurrency: 'CNH', inwardHkd: '', brokerExitPrice: '' }).selected;
  assert.equal(unpriced.indicativeBrokerExit, true);
  assert.equal(row(unpriced, 'brokerExitFx').cny, null);
  assert.equal(row(unpriced, 'returnInward').cny, null);
  assert.equal(unpriced.rankable, false);
  assert.ok(unpriced.missing.some(item => /USD\/CNH实际成交价/.test(item)));
  assert.equal(row(unpriced, 'withdrawMiddle').cny, 0);
  const wire = run({ withdrawCurrency: 'CNH', cnhWithdrawalMethod: 'wire', intermediaryCny: '' }).selected;
  assert.equal(row(wire, 'withdrawMiddle').cny, null);
});

test('CNH cannot silently become another broker withdrawal or an unverified mainland RMB remittance', () => {
  for (const change of [{ broker: 'firstrade', depositMethod: 'swift' }, { outcome: 'mainland' }, { outcome: 'mainland-usd' }, { outcome: 'usd-card' }]) {
    const r = run({ ...change, withdrawCurrency: 'CNH' });
    assert.ok(r.error); assert.ok(r.partial.steps.afterTaxUsd > 0);
    assert.equal(r.partial.steps.returnCnh, undefined);
  }
  const retained = run({ outcome: 'broker-balance', withdrawCurrency: 'CNH', brokerExitPrice: -1 }).selected;
  assert.equal(row(retained, 'brokerExitCommission'), undefined);
});

test('BOCHK to BOC USD receipt and subsequent settlement are independent choices', () => {
  const dollars = run({ outcome: 'mainland-usd', returnBank: 'bochk', returnMethod: 'bochk-fast' }).selected;
  assert.equal(dollars.currency, 'USD'); close(row(dollars, 'returnWire').cny, 0);
  assert.equal(row(dollars, 'exitFx'), undefined);
  assert.equal(row(dollars, 'returnOther').cny, null);
  close(dollars.net, dollars.steps.mainlandReceived); conserved(dollars);
  const yuan = run({ outcome: 'mainland', returnBank: 'bochk', returnMethod: 'bochk-fast', returnExtraCny: 25 }).selected;
  assert.equal(yuan.currency, 'CNY'); assert.ok(row(yuan, 'exitFx')); conserved(yuan);
});

test('direct mainland USD wire stops before unsupported or unconfirmed withdrawals', () => {
  const pending = run({ outcome: 'mainland-usd', withdrawDestination: 'mainland' });
  assert.match(pending.error, /出金可用性及收款银行/);
  assert.ok(pending.partial.steps.afterTaxUsd > 0);
  assert.equal(row(pending.partial, 'withdraw'), undefined);
  for (const broker of ['chief', 'usmart', 'za', 'hsbc']) {
    const result = run({ outcome: 'mainland-usd', withdrawDestination: 'mainland', broker, depositMethod: '', directReceiptConfirmed: true });
    assert.match(result.error, /直达内地/);
  }
});

test('confirmed direct wires omit the Hong Kong return account, use the mainland inward fee and retain USD', () => {
  for (const broker of ['ibkr', 'firstrade', 'schwab']) {
    const r = run({ broker, depositMethod: '', outcome: 'mainland-usd', withdrawDestination: 'mainland', directReceiptConfirmed: true,
      returnBank: 'sc', returnMonthlyHkd: 500, directInwardCny: 8, intermediaryCny: 12 }).selected;
    assert.equal(r.currency, 'USD'); assert.equal(r.directReturn, true);
    close(row(r, 'returnInward').cny, 8); close(row(r, 'withdrawMiddle').cny, 12);
    assert.equal(row(r, 'returnWire'), undefined); assert.equal(row(r, 'exitFx'), undefined);
    assert.ok(!row(r, 'account').items.some(item => item.region === 'hong-kong' && item.bankId === 'sc'));
    conserved(r);
  }
  const yuan = run({ outcome: 'mainland', withdrawDestination: 'mainland', directReceiptConfirmed: true, returnCurrency: 'HKD' }).selected;
  assert.equal(yuan.returnCurrency, 'USD'); assert.equal(row(yuan, 'exitFx').exchanges[0].from, 'USD'); conserved(yuan);
  assert.match(run({ outcome: 'mainland-usd', withdrawDestination: 'mainland', directReceiptConfirmed: true, directInwardCny: -1 }).error, /非负数/);
});

test('HSBC group ATM separates the requested cash from retained CNH and never spends the whole balance', () => {
  const r = run({ outcome: 'atm', withdrawCurrency: 'CNH' }).selected;
  close(r.cashPlan.cash, 5000); close(row(r, 'atmFee').cny, 0);
  close(row(r, 'atmOther').cny, 0); close(r.net, r.steps.returnCnh - 5000);
  close(r.netCny, r.net * r.refs.CNH + 5000 + r.sourceRemainderCny);
  assert.ok(row(r, 'brokerExitCommission').cny > 0); conserved(r);
  const other = run({ outcome: 'atm', withdrawCurrency: 'CNH', atmMode: 'hsbc-other', atmTransactions: 3 }).selected;
  close(row(other, 'atmFee').cny, 120 * other.refs.HKD);
  assert.equal(row(other, 'atmOther').cny, null); assert.equal(other.complete, false); conserved(other);
});

test('ICBC Asia HKD ATM fee waiver does not waive FX, and the RMB card has its separate fee and qualification', () => {
  const pending = run({ outcome: 'atm', returnBank: 'icbc-asia', returnHkdPrice: 7.8 }).selected;
  assert.equal(row(pending, 'cashFx').cny, null); assert.equal(pending.cashPlan, null);
  assert.equal(pending.indicativeExit, true); assert.equal(row(pending, 'atmFee').cny, 0);
  const cash = run({ outcome: 'atm', returnBank: 'icbc-asia', returnHkdPrice: 7.8, atmCnyPerUnit: .85 }).selected;
  close(cash.cashPlan.debit, 5000 / .85); assert.notEqual(row(cash, 'cashFx').cny, 0); conserved(cash);
  const cnh = run({ outcome: 'atm', returnBank: 'icbc-asia', withdrawCurrency: 'CNH', atmMode: 'icbc-cnh', icbcCnhAccount: true, atmExtraCny: 0 }).selected;
  close(row(cnh, 'atmFee').cny, 30 * cnh.refs.CNH); conserved(cnh);
  assert.match(run({ outcome: 'atm', returnBank: 'icbc-asia', withdrawCurrency: 'CNH', atmMode: 'icbc-cnh' }).error, /香港身份证/);
});

test('CCB linkage charges per transaction and per annual cycle, and enforces transaction and daily caps', () => {
  const input = { outcome: 'atm', returnBank: 'ccb-asia', returnHkdPrice: 7.8, atmCnyPerUnit: .85, ccbLinkedCard: true };
  const r = run(input).selected;
  close(row(r, 'atmFee').cny, 20);
  close(row(r, 'account').items.find(item => /年费/.test(item.label)).cny, 50 * r.refs.HKD);
  conserved(r);
  assert.match(run({ ...input, atmTransactions: 1 }).error, /单笔3000/);
  assert.match(run({ ...input, atmAmountCny: 18000, atmTransactions: 6 }).error, /每日上限/);
  assert.match(run({ ...input, ccbLinkedCard: false }).error, /关联/);
});

test('personal zero daily limits, ATM dispensing limits, negative fees and insufficient funds are not bypassed', () => {
  const input = { outcome: 'atm', withdrawCurrency: 'CNH' };
  for (const override of [{ atmDailyLimitCny: 0 }, { atmDailyLimitCny: 2000 }, { atmPerTransactionCny: 2000 },
    { atmExtraCny: -1 }, { atmDailyLimitCny: -1 }, { atmPerTransactionCny: 0 }, { atmAmountCny: 1000000 }, { atmTransactions: 1.5 }]) {
    assert.ok(run({ ...input, ...override }).error, JSON.stringify(override));
  }
  const unsupported = run({ outcome: 'atm', returnBank: 'za' });
  assert.match(unsupported.error, /ATM卡种、收费及限额依据/);
  assert.ok(unsupported.partial.steps.returnUsd > 0);
});

test('BOCHK Apple Pay uses the CNH balance without another conversion and ATM uses the current 50 RMB tariff', () => {
  for (const cardMode of ['unionpay', 'apple-pay', 'cnh']) {
    const r = run({ returnBank: 'bochk', outcome: 'cnh-card', withdrawCurrency: 'CNH', cardMode }).selected;
    assert.equal(r.currency, 'CNH'); assert.equal(row(r, 'exitFx'), undefined);
    close(row(r, 'card').cny, 0); conserved(r);
  }
  const cash = run({ returnBank: 'bochk', outcome: 'atm', withdrawCurrency: 'CNH', atmExtraCny: 10 }).selected;
  close(row(cash, 'atmFee').cny, 100 * cash.refs.CNH); close(row(cash, 'atmOther').cny, 10); conserved(cash);
});
