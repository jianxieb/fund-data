const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const mainland = id => D.mainlandBanks.find(b => b.id === id);
const hk = id => D.hkBanks.find(b => b.id === id);
const base = { amount: 100000, currency: 'HKD', count: 1, months: 0, sell: .88,
  usdCny: 7, usdHkd: 8, usdCnh: 7.1, date: '2026-10-08', intermediaryCny: 0,
  usedFreeTransfers: 0, balanceHkd: 10000, enabled: [], purpose: 'consume' };
const offshore = { ...base, origin: 'offshore', amount: 10000, currency: 'USD', brokerApproved: true,
  fxMode: 'manual', entryPrice: 8, profitUsd: 0, taxableCny: 0, taxRate: 20,
  creditCny: 0, withdrawalIndex: 1, spend: 'USD', exitPrice: '' };

test('sender commission is inside the budget; minimum and cap apply to each transfer', () => {
  const once = M.mainlandTransfer(base, mainland('boc'), hk('za'));
  close(once.principal, (100000 - 80) / 1.001);
  close(once.sendingFees, 179.82017982018);
  close(once.net, once.principal / .88);
  close(once.costCny, 100000 - once.net * .875);
  const monthly = M.mainlandTransfer({ ...base, count: 12 }, mainland('boc'), hk('za'));
  close(monthly.sendingFees, 12 * (50 + 80));
  close(monthly.principal, 100000 - 1560);
  close(M.fee(mainland('boc'), 1e6), 260 + 80);
  assert.ok(monthly.costCny > once.costCny);
});

test('the CIB 30-transfer allowance is shared across the promotion and expires', () => {
  const input = { ...base, enabled: ['cib'], usedFreeTransfers: 29, count: 4 };
  close(M.mainlandTransfer(input, mainland('cib'), hk('za')).sendingFees, 300);
  const expired = { ...input, date: '2027-07-01' };
  assert.match(M.mainlandTransfer(expired, mainland('cib'), hk('za')).error, /到期/);
  close(M.mainlandTransfer({ ...expired, senderFeeCny: 140 }, mainland('cib'), hk('za')).sendingFees, 560);
});

test('free linked-account tariffs require both eligibility and the matching receiving bank', () => {
  assert.match(M.mainlandTransfer(base, mainland('hang'), hk('hang')).error, /资格/);
  const eligible = { ...base, enabled: ['hang'], intermediaryCny: '' };
  assert.equal(M.mainlandTransfer(eligible, mainland('hang'), hk('hang')).complete, true);
  assert.match(M.mainlandTransfer(eligible, mainland('hang'), hk('za')).error, /同名账户/);
  const hsbc = M.mainlandTransfer({ ...base, enabled: ['hsbc'], intermediaryCny: '' }, mainland('hsbc'), hk('hsbc'));
  assert.equal(hsbc.complete, true);
});

test('blank third-party fees stay unknown, while confirmed zero completes the quote', () => {
  const unknown = M.mainlandTransfer({ ...base, intermediaryCny: '' }, mainland('boc'), hk('za'));
  assert.equal(unknown.complete, false); assert.deepEqual(unknown.missing, ['中转行费用']);
  const paid = M.mainlandTransfer({ ...base, intermediaryCny: 50 }, mainland('boc'), hk('za'));
  assert.equal(paid.complete, true); close(unknown.net - paid.net, 50 / .875);
  assert.equal(M.number('   '), null);
  assert.match(M.mainlandTransfer({ ...base, intermediaryCny: -50 }, mainland('boc'), hk('za')).error, /非负/);
});

test('bank incoming wire fees are distinct from free local transfers and group waivers', () => {
  close(M.inwardFee(hk('bochk'), 501, 'broker'), 60);
  close(M.inwardFee(hk('bochk'), 500, 'broker'), 0);
  close(M.inwardFee(hk('bochk'), 100000, 'boc'), 0);
  close(M.inwardFee(hk('bochk'), 100000, 'broker', true), 0);
  const r = M.offshoreTransfer(offshore, hk('bochk'), D.broker);
  close(r.bankUsd, 10000 - 60 / 8);
});

test('account fees are separate from retained capital and include the selected duration', () => {
  close(M.maintenance(hk('hsbc'), 9999, 12), 1200);
  close(M.maintenance(hk('hsbc'), 10000, 12), 0);
  close(M.maintenance(hk('hsbc'), 0, 12, 0), 0);
  assert.equal(M.maintenance(hk('hsbc'), 0, -12), null);
  close(M.opportunityCost(500000, 2, 12), 10000);
  const withAssets = M.mainlandTransfer({ ...base, balanceHkd: 500000 }, mainland('boc'), hk('hsbc'));
  const withoutAssets = M.mainlandTransfer({ ...base, balanceHkd: 0 }, mainland('boc'), hk('hsbc'));
  close(withAssets.net, withoutAssets.net); // zero months; capital is never charged
});

test('manual and automatic broker conversions fit fees into cash without double charging', () => {
  const manual = M.brokerFx(80000, 'HKD', 8, 'manual', D.broker);
  close(manual.usd, 9998); close(manual.commissionUsd, 2); close(manual.markupUsd, 0);
  const auto = M.brokerFx(80000, 'HKD', 8, 'auto', D.broker);
  close(auto.usd, 10000 / 1.0003); close(auto.commissionUsd, 0);
  close(auto.usd + auto.markupUsd, 10000);
  const large = M.brokerFx(1600000, 'HKD', 8, 'manual', D.broker);
  close(large.usd + large.commissionUsd, 200000);
  close(M.brokerFx(1000, 'USD', null, 'manual', D.broker).usd, 1000);
  assert.equal(M.brokerFx(8, 'HKD', 8, 'manual', D.broker), null);
});

test('October 2026 IBKR fees have two free withdrawals in a calendar month', () => {
  for (const withdrawalIndex of [1, 2]) close(M.offshoreTransfer({ ...offshore, withdrawalIndex }, hk('za'), D.broker).net, 10000);
  close(M.offshoreTransfer({ ...offshore, withdrawalIndex: 3 }, hk('za'), D.broker).net, 9990);
  assert.match(M.offshoreTransfer({ ...offshore, withdrawalIndex: 1.5 }, hk('za'), D.broker).error, /第几次/);
});

test('USD RTGS fees charged in USD are not treated as HKD or a free FPS transfer', () => {
  const r = M.offshoreTransfer(offshore, hk('sc'), D.broker);
  close(r.investUsd, 9978); close(r.net, 9978); close(r.explicitCny, 22 * 7);
  const exempt = M.offshoreTransfer({ ...offshore, depositHkd: 0 }, hk('sc'), D.broker);
  close(exempt.net, 10000);
});

test('local deposit fees are removed before broker FX, but after bank FX', () => {
  const input = { ...offshore, currency: 'HKD', amount: 80000, depositHkd: 80 };
  close(M.offshoreTransfer(input, hk('za'), D.broker).investUsd, (80000 - 80) / 8 - 2);
  close(M.offshoreTransfer({ ...input, fxMode: 'bank' }, hk('za'), D.broker).investUsd, 10000 - 10);
});

test('tax reserves apply to RMB taxable income, never to the transfer principal', () => {
  const r = M.offshoreTransfer({ ...offshore, profitUsd: 1000, taxableCny: 7000, creditCny: 100 }, hk('za'), D.broker);
  close(r.taxCny, 1300); close(r.net, 11000 - 1300 / 7);
  close(M.taxReserve(0, 20, 0), 0); close(M.taxReserve(1000, 20, 1000), 0);
  assert.equal(M.taxReserve(1000, 101, 0), null);
});

test('the RMB ledger reconciles across source currencies, FX, wire fees, monthly fees and tax', () => {
  for (const currency of ['USD', 'HKD', 'CNH']) for (const spend of ['USD', 'HKD', 'CNY']) for (const fxMode of ['manual', 'auto', 'bank']) {
    const input = { ...offshore, currency, amount: currency === 'USD' ? 10000 : currency === 'HKD' ? 80000 : 71000,
      entryPrice: currency === 'CNH' ? 7.15 : 8.02, spend, exitPrice: spend === 'HKD' ? 7.97 : 6.95,
      fxMode, profitUsd: 1000, taxableCny: 7000, creditCny: 100, withdrawalIndex: 3,
      depositHkd: 30, inwardHkd: 20, intermediaryCny: 40, returnWireHkd: 70, returnExtraCny: 25,
      months: 12, balanceHkd: 0 };
    const r = M.offshoreTransfer(input, hk('hsbc'), D.broker);
    assert.equal(r.error, undefined, `${currency}/${spend}/${fxMode}`); assert.equal(r.complete, true);
    close(r.net * r.refs[spend] + r.costCny + r.taxCny, input.amount * r.refs[currency] + 1000 * 7);
  }
});

test('a mainland origin cannot become an allowed investment path through a same-name bank', () => {
  assert.equal(M.legalPath('mainland', 'invest', true).allowed, false);
  assert.match(M.offshoreTransfer({ ...offshore, origin: 'mainland' }, hk('za'), D.broker).error, /购汇/);
  assert.match(M.mainlandTransfer({ ...base, purpose: 'invest' }, mainland('boc'), hk('za')).error, /购汇/);
  assert.match(M.offshoreTransfer({ ...offshore, brokerApproved: false }, hk('za'), D.broker).error, /身份/);
  assert.match(M.offshoreTransfer({ ...offshore, months: -12 }, hk('za'), D.broker).error, /非负/);
});

test('future tariff changes do not alter the current ZA outward fee', () => {
  close(M.outwardFee(hk('za'), '2026-10-31'), 0);
  close(M.outwardFee(hk('za'), '2026-11-01'), 70);
});

test('direct USD debit spending avoids a fictitious HKD conversion', () => {
  for (const id of ['hsbc', 'bochk', 'hang', 'sc']) {
    const r = M.consumption({ amount: 1000, currency: 'USD', method: 'card' }, hk(id));
    close(r.net, 1000); close(r.cost, 0); assert.deepEqual(r.missing, []);
  }
  close(M.consumption({ amount: 1000, currency: 'HKD', method: 'local' }, hk('za')).net, 1000);
});

test('ZA USD spending includes both FX directions and charges 1.95% on purchases, not budget', () => {
  const r = M.consumption({ amount: 1000, currency: 'USD', method: 'card', bankHkdPerUsd: 7.8, networkHkdPerUsd: 7.85 }, hk('za'));
  close(r.net, 7800 / (7.85 * 1.0195));
  close(r.fx, 1000 - 7800 / 7.85); close(r.fee, r.net * .0195);
  close(r.cost, r.fee + r.fx); close(r.net + r.cost, 1000);
  assert.equal(M.consumption({ amount: 1000, currency: 'USD', method: 'card' }, hk('za')).net, null);
  const foreignHkd = M.consumption({ amount: 1000, currency: 'HKD', method: 'card', overseasProcessed: true }, hk('za'));
  close(foreignHkd.net, 1000 / 1.0195);
});
