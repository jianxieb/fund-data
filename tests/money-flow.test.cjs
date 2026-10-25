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
  const standard = M.mainlandTransfer(expired, mainland('cib'), hk('za'));
  assert.equal(standard.error, undefined);
  close(standard.sendingFees, 600);
  close(standard.principal, 99400);
  close(M.mainlandTransfer({ ...expired, senderFeeCny: 140 }, mainland('cib'), hk('za')).sendingFees, 560);
});

test('CIB card commission and the 30-telegram promotion have independent dates and currency scopes', () => {
  const bank = mainland('cib');
  for (const index of [1, 30, 31, 120]) {
    close(M.fee(bank, 100000, index, '2027-06-30'), index <= 30 ? 0 : 100);
    close(M.fee(bank, 100000, index, '2027-07-01'), 200);
    close(M.fee({ ...bank, ...bank.cnhTariff }, 100000, index, '2027-06-30'), 200);
    close(M.fee({ ...bank, ...bank.cnhTariff }, 100000, index, '2027-07-01'), 200);
  }
  for (const [principal, expected] of [[100, 150], [50000, 150], [100000, 200], [200000, 300], [1e6, 300]]) {
    close(M.fee(bank, principal, 1, '2027-07-01'), expected);
  }
  assert.equal(M.fee(bank, 100000, 1, '2026-06-30'), null);
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
  const executedAuto = M.brokerFx(80000, 'HKD', 8, 'auto', D.broker, true);
  close(executedAuto.usd, 10000); close(executedAuto.commissionUsd, 0); close(executedAuto.markupUsd, 0);
  assert.equal(executedAuto.priceIncludesAutoMarkup, true);
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

const publicQuotes = {
  banks: { boc: { quotes: { USD: { buy: 6.99, sell: 7.01, asOf: '2026-10-08 20:00:00' } } },
    cmb: { quotes: { USD: { buy: 6.98, sell: 7.02, asOf: '2026-10-08 20:01:00' } } } },
  offshoreUsd: { bochk: { quotes: { HKD: { bidPerUsd: 7.98, askPerUsd: 8.02, asOf: '2026-10-08 20:00:00' },
    CNH: { bidPerUsd: 7, askPerUsd: 7.2, asOf: '2026-10-08 20:00:00' } } } }
};
const journey = { budgetCny: 70000, currency: 'USD', plan: 'recommended', bank: '', months: 12,
  balanceHkd: 0, profitUsd: 0, taxRate: 20, creditCny: 0, withdrawalIndex: 1,
  intermediaryCny: 0, returnExtraCny: 0, tradeFeeUsd: 0, date: '2026-10-08' };

test('default recommendation completes one USD-to-CNY path, without a HKD conversion or asset threshold', () => {
  const p = M.journeyPlans(journey, D, publicQuotes), r = p.selected;
  assert.equal(r.bank.id, 'hang'); assert.equal(r.exitBank, 'boc');
  assert.equal(r.currency, 'CNY'); close(r.sourceAmount, 10000); close(r.investUsd, 10000);
  close(r.brokerFx.commissionUsd, 0); close(r.taxCny, 0);
  close(r.net, (10000 - 65 / 8) * 6.99);
  assert.equal(r.complete, true);
  close(r.net + r.costCny + r.taxCny, journey.budgetCny);
});

test('minimum uses today’s ZA tariff, while default avoids its expiring promotion', () => {
  const p = M.journeyPlans({ ...journey, plan: 'minimum' }, D, publicQuotes);
  assert.equal(p.selected.bank.id, 'za'); assert.equal(p.recommended.bank.id, 'hang');
  close(p.selected.costCny, 100);
  const expired = M.journeyPlans({ ...journey, date: '2026-11-01', plan: 'minimum' }, D, publicQuotes);
  assert.equal(expired.selected.bank.id, 'hang');
  assert.ok(expired.plans.find(r => r.bank.id === 'za').costCny > expired.selected.costCny);
});

test('CNH goes directly to USD; optimal conversion changes with size and includes local transfer fees', () => {
  const large = M.journeyPlans({ ...journey, currency: 'CNH' }, D, publicQuotes);
  assert.equal(large.selected.bank.id, 'sc'); assert.equal(large.selected.fxMode, 'manual');
  close(large.selected.sourceAmount, 71000); close(large.selected.investUsd, 9998);
  close(large.selected.brokerFx.commissionUsd, 2);
  const small = M.journeyPlans({ ...journey, currency: 'CNH', budgetCny: 7000 }, D, publicQuotes);
  assert.equal(small.selected.fxMode, 'auto');
  close(small.selected.brokerFx.commissionUsd, 0);
  close(small.selected.investUsd, 1000 / 1.0003);
  const bank = large.plans.find(r => r.bank.id === 'bochk');
  assert.equal(bank.fxMode, 'manual'); // bank ask costs more than the reference + IBKR fee
  close(large.selected.net + large.selected.costCny + large.selected.taxCny, journey.budgetCny);
});

test('choose bank conversion only with that bank’s actual USD ask; never assign it to other banks', () => {
  const p = M.journeyPlans({ ...journey, currency: 'CNH', entryPrice: 7.5 }, D, publicQuotes);
  assert.equal(p.plans.find(r => r.bank.id === 'bochk').fxMode, 'bank');
  assert.ok(p.plans.filter(r => r.bank.id !== 'bochk').every(r => r.fxMode !== 'bank'));
  const noAsk = structuredClone(publicQuotes); delete noAsk.offshoreUsd.bochk.quotes.CNH;
  assert.match(M.journeyPlans({ ...journey, currency: 'CNH' }, D, noAsk).error, /参考汇率/);
});

test('changing mainland settlement bank holds the source amount and reference currency rates fixed', () => {
  const a = M.journeyPlans(journey, D, publicQuotes).selected;
  const b = M.journeyPlans({ ...journey, exitBank: 'cmb' }, D, publicQuotes).selected;
  close(a.sourceAmount, b.sourceAmount); close(a.refs.USD, b.refs.USD);
  close(a.net - b.net, (10000 - 65 / 8) * .01);
});

test('estimated tax uses positive net profit, exact RMB taxable income takes priority, principal is not taxed', () => {
  const p = M.journeyPlans({ ...journey, profitUsd: 1000, tradeFeeUsd: 10 }, D, publicQuotes).selected;
  close(p.taxableCny, 990 * 7); close(p.taxCny, 990 * 7 * .2);
  close(p.net + p.costCny + p.taxCny, journey.budgetCny + 1000 * 7);
  assert.equal(p.estimatedTax, true);
  const exact = M.journeyPlans({ ...journey, profitUsd: 1000, taxableCny: 5000, creditCny: 100 }, D, publicQuotes).selected;
  close(exact.taxCny, 900); assert.equal(exact.estimatedTax, false);
  close(M.journeyPlans({ ...journey, profitUsd: -500 }, D, publicQuotes).selected.taxCny, 0);
});

test('unknown fees stay unknown; same-bank rebates cannot conceal broker wire charges', () => {
  const p = M.journeyPlans({ ...journey, intermediaryCny: '', returnExtraCny: '', tradeFeeUsd: '' }, D, publicQuotes);
  assert.equal(p.selected.complete, false);
  assert.deepEqual(p.selected.missing, ['证券交易费用', '出金中转行费用', '回大陆的中转费及收款行费']);
  close(p.plans.find(r => r.bank.id === 'bochk').rows.find(r => r.label === '香港银行汇入费').cny, 60 * 7 / 8);
  const r = M.journeyPlans({ ...journey, intermediaryCny: 20, returnExtraCny: 30, tradeFeeUsd: 4 }, D, publicQuotes).selected;
  assert.equal(r.complete, true); close(p.selected.net - r.net, (4 + 20 / 7) * 6.99 + 30);
});

test('customer fee override applies only to selected bank; asset principal is not deducted as a fee', () => {
  const p = M.journeyPlans({ ...journey, bank: 'hang', returnWireHkd: 0, openingCny: 100,
    extraCapitalCny: 500000, annualGapPct: 2 }, D, publicQuotes);
  close(p.selected.extraCny, 10100); close(p.selected.rows.find(r => r.label === '回大陆汇出费').cny, 0);
  close(p.plans.find(r => r.bank.id === 'sc').rows.find(r => r.label === '回大陆汇出费').cny, 50 * 7 / 8);
  close(p.selected.net + p.selected.costCny, journey.budgetCny);
});

test('mainland RMB has a complete tariff scenario while keeping the investment purpose restriction explicit', () => {
  const p = M.journeyPlans({ ...journey, currency: 'CNY' }, D, publicQuotes);
  assert.equal(p.origin, 'mainland'); assert.equal(p.permission.allowed, false);
  assert.match(p.permission.reason, /不能用于境外证券投资/);
  assert.equal(p.selected.origin, 'mainland'); assert.equal(p.selected.sourceAmount, journey.budgetCny);
  assert.equal(p.selected.route, 'USD'); assert.ok(p.selected.investUsd > 0);
  close(p.selected.net + p.selected.costCny + p.selected.taxCny, journey.budgetCny);
  assert.match(M.journeyPlans({ ...journey, budgetCny: -1 }, D, publicQuotes).error, /正数/);
  assert.match(M.journeyPlans({ ...journey, tradeFeeUsd: -1 }, D, publicQuotes).error, /非负数/);
  assert.match(M.journeyPlans({ ...journey, returnWireHkd: -1 }, D, publicQuotes).error, /非负数/);
  assert.match(M.journeyPlans({ ...journey, entryPrice: 'invalid' }, D, publicQuotes).error, /有效正数/);
  assert.match(M.journeyPlans({ ...journey, usdCny: 0 }, D, publicQuotes).error, /有效正数/);
});

const mainlandConfig = { ...journey, currency: 'CNY', startBank: 'boc', bank: 'hang', returnBank: 'hang', exitBank: 'boc',
  route: 'USD', fxMode: 'manual', mainlandMethod: 'swift', depositMethod: 'chats', returnMethod: 'swift',
  entryMiddleCny: 0, depositOtherCny: 0 };
const richQuotes = structuredClone(publicQuotes);
richQuotes.banks.boc.quotes.HKD = { buy: .873, sell: .878, asOf: '2026-10-08 20:00:00' };
richQuotes.banks.abc = { quotes: { USD: { buy: 6.99, sell: 7.01, asOf: '2026-10-08 20:00:00' } } };
richQuotes.banks.comm = { quotes: { USD: { buy: 7, sell: 7.01, asOf: '2026-10-08 20:00:00' } } };
const ledger = (r, profit = 1000) => {
  const sum = r.rows.reduce((total, row) => total + (row.cny ?? 0), 0);
  close(r.costCny, sum);
  close(r.net + sum + r.taxCny, r.budgetCny + r.refs.USD * profit + r.fxImpactCny);
};

test('every mainland route reconciles actual RMB principal, FX, fees and profit exactly once', () => {
  for (const route of ['USD', 'HKD', 'CNH']) for (const fxMode of route === 'USD' ? ['manual'] : ['manual', 'auto', 'bank']) {
    const p = M.journeyPlans({ ...mainlandConfig, bank: 'bochk', returnBank: 'bochk', route, fxMode,
      profitUsd: 1000, tradeFeeUsd: 8, depositMethod: route === 'USD' || fxMode === 'bank' ? 'chats' : 'fps',
      senderFeeCny: 30, entryInwardHkd: 0, inwardHkd: 60, returnWireHkd: 65, openingCny: 100,
      extraCapitalCny: 50000, annualGapPct: 2 }, D, richQuotes);
    assert.equal(p.error, undefined); ledger(p.selected);
    close(p.selected.taxCny, 992 * 7 * .2);
    if (route === 'USD' || fxMode === 'bank') close(p.selected.brokerFx.commissionUsd, 0);
  }
});

test('sender fees are solved inside the budget; multiple transfers pay the minimum per transfer', () => {
  const r = M.journeyPlans({ ...mainlandConfig, count: 3, profitUsd: 1000 }, D, richQuotes).selected;
  const sender = r.rows.find(row => row.key === 'sender').cny;
  close(sender, 3 * 130);
  close(r.steps.mainlandForeign, (70000 - sender) / 7.01); ledger(r);
});

test('ABC full-amount USD fee is per transfer and never charged twice', () => {
  for (const senderFeeCny of ['', 30]) {
    const r = M.journeyPlans({ ...mainlandConfig, startBank: 'abc', count: 2, mainlandMethod: 'full',
      senderFeeCny, profitUsd: 1000 }, D, richQuotes).selected;
    const sender = r.rows.find(row => row.key === 'sender').cny;
    const principal = r.steps.mainlandForeign * 7.01;
    const baseFee = senderFeeCny === '' ? 2 * (principal / 2 * .001 + 80) : 60;
    close(sender, baseFee + 2 * 25 * 7.01);
    close(sender + principal, 70000); close(r.rows.find(row => row.key === 'entryMiddle').cny, 0); ledger(r);
  }
});

test('unknown bank and correspondent fees remain unknown, and incomplete sender tariffs cannot win', () => {
  const p = M.journeyPlans({ ...mainlandConfig, startBank: 'comm', depositMethod: 'swift', entryMiddleCny: '', depositOtherCny: '', intermediaryCny: '', returnExtraCny: '' }, D, richQuotes);
  assert.equal(p.selected.rankable, false); assert.equal(p.selected.complete, false);
  for (const key of ['sender', 'entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther']) assert.equal(p.selected.rows.find(row => row.key === key).cny, null);
  assert.ok(p.plans.every(row => row.start.id !== 'comm'));
  assert.notEqual(p.recommended.start.id, 'comm'); assert.notEqual(p.minimum.start.id, 'comm');
  assert.equal(M.fee(D.mainlandBanks.find(bank => bank.id === 'comm'), 100000), null);
});

test('USD bank deposits distinguish CHATS, SWIFT and unsupported FPS/eDDA', () => {
  const refs = { USD: 7, HKD: 7 / 8 };
  close(M.depositFee(hk('sc'), 'chats', 'USD', refs, '2026-10-08'), 22 * 7);
  close(M.depositFee(hk('hang'), 'swift', 'USD', refs, '2026-10-08'), 65 * 7 / 8);
  for (const method of ['fps', 'edda']) assert.equal(M.depositFee(hk('hang'), method, 'USD', refs, '2026-10-08'), null);
  const p = M.journeyPlans({ ...mainlandConfig, bank: 'sc', profitUsd: 1000 }, D, richQuotes);
  close(p.selected.rows.find(row => row.key === 'depositBank').cny, 154);
  close(p.selected.rows.find(row => row.key === 'depositBroker').cny, 0); ledger(p.selected);
  assert.match(M.journeyPlans({ ...mainlandConfig, depositMethod: 'fps' }, D, richQuotes).error, /不支持USD/);
});

test('BOCHK fast return only waives its own matching route, not broker inward or other bank costs', () => {
  const r = M.journeyPlans({ ...mainlandConfig, bank: 'bochk', returnBank: 'bochk', returnMethod: 'bochk-fast',
    inwardHkd: '', returnExtraCny: '', profitUsd: 1000 }, D, richQuotes).selected;
  close(r.rows.find(row => row.key === 'entryInward').cny, 0);
  close(r.rows.find(row => row.key === 'returnWire').cny, 0);
  close(r.rows.find(row => row.key === 'returnInward').cny, 60 * 7 / 8);
  assert.equal(r.rows.find(row => row.key === 'returnOther').cny, null); ledger(r);
  assert.match(M.journeyPlans({ ...mainlandConfig, bank: 'bochk', returnBank: 'bochk', returnMethod: 'bochk-fast', exitBank: 'cmb' }, D, richQuotes).error, /不匹配/);
  close(M.returnFee(hk('bochk'), mainland('boc'), 'swift', feeRefs, '2026-10-09'), 0);
  close(M.returnFee(hk('bochk'), mainland('cmb'), 'swift', feeRefs, '2026-10-09'), 65 * feeRefs.HKD);
});

test('two HK accounts have separate maintenance costs, one account is never charged twice', () => {
  const two = M.journeyPlans({ ...mainlandConfig, bank: 'hsbc', returnBank: 'hang', months: 12, profitUsd: 1000 }, D, richQuotes).selected;
  close(two.rows.find(row => row.key === 'account').cny, 1200 * 7 / 8); ledger(two);
  const one = M.journeyPlans({ ...mainlandConfig, bank: 'hsbc', returnBank: 'hsbc', months: 12, profitUsd: 1000 }, D, richQuotes).selected;
  close(one.rows.find(row => row.key === 'account').cny, 1200 * 7 / 8); ledger(one);
});

test('manual bank fees and rates are scoped to that bank, and one-step comparisons keep the other selections', () => {
  const p = M.journeyPlans({ ...mainlandConfig, senderFeeCny: 0, returnWireHkd: 0 }, D, richQuotes);
  close(p.selected.rows.find(row => row.key === 'sender').cny, 0);
  assert.ok(p.alternatives.start.find(row => row.start.id === 'cmb').rows.find(row => row.key === 'sender').cny > 0);
  for (const row of p.alternatives.start.filter(row => !row.error)) {
    assert.equal(row.bank.id, 'hang'); assert.equal(row.returning.id, 'hang'); assert.equal(row.exit.id, 'boc'); assert.equal(row.route, 'USD');
  }
  const preset = M.journeyPlans({ ...mainlandConfig, returnMethod: 'bochk-fast' }, D, richQuotes);
  assert.ok(preset.recommended); // invalid manual method must not invalidate automatic candidates
  assert.match(preset.error, /不匹配/);
});

test('stale bank quotes stay dated and cannot be used by automatic recommendations', () => {
  const quotes = structuredClone(richQuotes);
  quotes.banks.comm.quotes.USD.buy = 7.5;
  quotes.banks.comm.quotes.USD.asOf = '2026-09-30 12:00:00';
  const p = M.journeyPlans(mainlandConfig, D, quotes);
  assert.ok(p.plans.every(row => row.exit.id !== 'comm'));
  assert.equal(M.quoteFresh({ asOf: '2026-10-08' }, '2026-10-08'), true);
  assert.equal(M.quoteFresh({ asOf: '2026-10-09 12:00:00' }, '2026-10-08'), false);
  assert.equal(M.quoteFresh({ asOf: '2026-10-04 23:59:59' }, '2026-10-08'), false);
});

test('the current comparison row matches the displayed route including full-amount, eDDA and automatic FX', () => {
  for (const overrides of [
    { startBank: 'abc', mainlandMethod: 'full' },
    { route: 'HKD', fxMode: 'auto', depositMethod: 'edda' },
    { depositMethod: 'swift' },
    { bank: 'bochk', returnBank: 'bochk', returnMethod: 'swift' },
    { bank: 'bochk', returnBank: 'bochk', route: 'CNH', depositMethod: 'fps', mainlandMethod: 'payment-connect', senderFeeCny: 0, broker: 'ibkr' }
  ]) {
    const p = M.journeyPlans({ ...mainlandConfig, ...overrides }, D, richQuotes);
    for (const [key, entity] of Object.entries({ start: 'start', bank: 'bank', route: 'route', returnBank: 'returning', exit: 'exit', ...(overrides.broker ? { broker: 'broker' } : {}) })) {
      const id = key === 'route' ? p.selected.route : p.selected[entity].id;
      const current = p.alternatives[key].find(row => (key === 'route' ? row.route : row[entity].id) === id);
      assert.equal(current.error, undefined); close(current.net, p.selected.net);
    }
  }
});

test('diagram bank selectors use their own leg; wider comparison ranges stay explicit', () => {
  for (const route of ['USD', 'HKD', 'CNH']) {
    const r = M.journeyPlans({ ...mainlandConfig, route, bank: 'bochk', returnBank: 'bochk',
      depositMethod: route === 'USD' ? 'chats' : 'fps', monthlyHkd: 100, profitUsd: 1000 }, D, richQuotes).selected;
    const diagram = M.diagramLedger(r);
    for (const [key, index] of Object.entries({ start: 0, bank: 0, returnBank: 3, exit: 4 })) {
      const metric = M.comparisonMetric(r, key, 'step'), leg = diagram.legs[index];
      close(metric.costCny, leg.costCny); close(metric.lossRate, leg.lossRate);
      close(metric.lossCny, metric.costCny + metric.taxCny - metric.fxImpactCny);
    }
    close(M.comparisonMetric(r, 'bank').costCny, diagram.legs[0].costCny + diagram.legs[1].costCny);
    close(M.comparisonMetric(r, 'exit', 'step').costCny - M.comparisonMetric(r, 'exit').costCny, r.rows.find(row => row.key === 'account').cny);
  }
  assert.equal(M.comparisonMetric({ error: 'no source quote' }, 'bank', 'step'), null);
});

test('the reported RMB example reconciles the fee, valuation change and loss without including the next leg', () => {
  const r = M.journeyPlans({ ...mainlandConfig, budgetCny: 100000, bank: 'bochk', returnBank: 'bochk', route: 'CNH',
    depositMethod: 'fps', entryMiddleCny: '', usdCny: 6.70035, usdHkd: 7.8484, usdCnh: 6.697095 }, D, richQuotes).selected;
  const entry = M.comparisonMetric(r, 'bank', 'step');
  assert.equal(entry.costCny.toFixed(2), '179.82');
  assert.equal(entry.fxImpactCny.toFixed(2), '48.52');
  assert.equal(entry.lossCny.toFixed(2), '131.30');
  assert.equal((entry.lossRate * 100).toFixed(3), '0.131');
  assert.equal(M.comparisonMetric(r, 'bank').costCny.toFixed(2), '193.22');
  const partial = { ...r, net: undefined };
  close(M.comparisonMetric(partial, 'bank', 'step').costCny, entry.costCny);
  close(M.comparisonMetric(partial, 'bank', 'step').lossCny, entry.lossCny);
});

test('comparison rows retain known charges but never rank unquoted remittances by a numeric loss', () => {
  const input = { ...mainlandConfig, budgetCny: 100000, bank: 'bochk', returnBank: 'bochk', route: 'CNH',
    depositMethod: 'fps', entryMiddleCny: '', usdCny: 6.70035, usdHkd: 7.8484, usdCnh: 6.697095 };
  const p = M.journeyPlans(input, D, richQuotes);
  for (const id of ['boc', 'cmb', 'icbc', 'ccb']) {
    const r = p.alternatives.start.find(row => row.start.id === id), metric = M.comparisonMetric(r, 'start');
    assert.equal(metric.complete, false);
    assert.equal(metric.lossCny, null); assert.equal(metric.lossRate, null);
    assert.ok(metric.costCny > 0);
    assert.ok(metric.missing.includes('内地→香港中转行费'));
    if (!['boc', 'cmb', 'ccb'].includes(id)) {
      assert.ok(metric.missing.includes(r.start.name + '汇出手续费'));
      assert.ok(metric.missing.includes(r.start.name + '电讯费'));
      close(metric.costCny, r.rows.find(row => row.key === 'entryInward').cny);
    }
    assert.deepEqual([...new Set(metric.rows.map(row => row.key))], ['sender', 'entryFx', 'entryMiddle', 'entryInward']);
    close(metric.costCny, metric.rows.reduce((sum, row) => sum + (row.cny ?? 0), 0));
  }
  assert.equal(M.comparisonMetric(p.selected, 'start').costCny.toFixed(2), '179.82');
  const quoted = M.journeyPlans({ ...input, entryMiddleCny: 0 }, D, richQuotes).selected;
  const entry = M.comparisonMetric(quoted, 'start');
  assert.ok(quoted.indicativeFx); // A later FX quote must not blank a fully priced first operation.
  assert.equal(entry.complete, true); assert.deepEqual(entry.missing, []);
  assert.equal(entry.lossCny.toFixed(2), '131.30');
  close(entry.lossCny, entry.costCny - entry.fxImpactCny);
  close(entry.lossRate, entry.lossCny / 100000);
  const funding = M.comparisonMetric(quoted, 'bank');
  assert.equal(funding.complete, false); assert.equal(funding.lossRate, null);
  assert.ok(funding.missing.includes(quoted.indicativeFx));
});

test('a missing settlement quote preserves all upstream trades and fees without inventing final CNY', () => {
  const p = M.journeyPlans({ ...mainlandConfig, bank: 'bochk', route: 'CNH', depositMethod: 'fps',
    mainlandMethod: 'payment-connect', senderFeeCny: 0, entryInwardHkd: 0, exitBank: 'cib' }, D, richQuotes);
  assert.equal(p.error, undefined);
  assert.equal(p.selected.indicativeExit, true);
  assert.match(p.selected.exitIssue, /USD现汇买入价尚未取得/);
  assert.ok(p.selected.steps.fundedUsd > 0);
  assert.ok(p.selected.rows.some(x => x.key === 'trade'));
  assert.equal(p.selected.rows.find(x => x.key === 'exitFx').cny, null);
  const entry = p.alternatives.start.find(row => row.start.id === 'boc');
  assert.equal(entry.mainlandMethod, 'payment-connect');
  const metric = M.comparisonMetric(entry, 'start');
  assert.equal(metric.complete, true); close(metric.costCny, 0);
  assert.equal(M.comparisonMetric(entry, 'bank').complete, false);
});

test('Payment Connect does not inherit SWIFT tariffs or pretend a historical free case is a current quote', () => {
  const input = { ...mainlandConfig, bank: 'bochk', returnBank: 'bochk', route: 'CNH', depositMethod: 'fps', mainlandMethod: 'payment-connect' };
  const r = M.journeyPlans(input, D, richQuotes).selected;
  assert.ok(r); assert.equal(r.rankable, false);
  const sender = r.rows.find(row => row.key === 'sender');
  assert.equal(sender.cny, null); assert.deepEqual(sender.items.map(row => row.label), ['跨境支付通本次汇出服务费']);
  close(r.rows.find(row => row.key === 'entryMiddle').cny, 0);
  close(r.steps.hongKong, input.budgetCny);
  assert.ok(r.missing.includes('跨境支付通本次汇出服务费'));
  const confirmed = M.journeyPlans({ ...input, senderFeeCny: 0, entryInwardHkd: 0 }, D, richQuotes).selected;
  close(confirmed.rows.find(row => row.key === 'sender').cny, 0);
  assert.equal(M.comparisonMetric(confirmed, 'bank', 'step').missing.length, 0);
  assert.equal(confirmed.rankable, false);
  const paid = M.journeyPlans({ ...input, count: 2, senderFeeCny: 5 }, D, richQuotes).selected;
  close(paid.rows.find(row => row.key === 'sender').cny, 10);
  close(paid.steps.hongKong, input.budgetCny - 10);
  const badRoute = M.journeyPlans({ ...input, route: 'USD', depositMethod: 'chats' }, D, richQuotes);
  assert.match(badRoute.error, /不支持美元/);
  const otherBank = M.journeyPlans({ ...input, bank: 'za' }, D, richQuotes);
  assert.equal(otherBank.error, undefined); assert.equal(otherBank.selected.bank.id, 'za');
});

test('when all upstream quotes are stale, own confirmed quotes still compute without claiming an automatic recommendation', () => {
  const p = M.journeyPlans({ ...mainlandConfig, date: '2026-11-01', startSell: 7.02, exitPrice: 6.98,
    usdCny: 7, usdHkd: 8, usdCnh: 7.1, profitUsd: 1000 }, D, richQuotes);
  assert.equal(p.recommended, undefined); assert.equal(p.minimum, undefined);
  assert.equal(p.selected.rankable, true); ledger(p.selected);
  const stale = M.journeyPlans({ ...mainlandConfig, date: '2026-11-01' }, D, richQuotes);
  assert.equal(stale.selected.rankable, false);
  assert.ok(stale.selected.missing.includes('USD/CNY参照牌价超过3天'));
  assert.equal(stale.selected.entryAsOf, '2026-10-08 20:00:00');
});

test('RMB remitted unchanged has no negative fee; CNH basis is a separate signed valuation effect', () => {
  const quotes = structuredClone(richQuotes);
  quotes.offshoreUsd.bochk.quotes.CNH = { bidPerUsd: 6.95, askPerUsd: 6.97, asOf: '2026-10-08 20:00:00' };
  const r = M.journeyPlans({ ...mainlandConfig, route: 'CNH', depositMethod: 'fps', senderFeeCny: 0, profitUsd: 1000 }, D, quotes).selected;
  const entry = r.rows.find(row => row.key === 'entryFx');
  close(entry.cny, 0);
  assert.ok(entry.fxImpactCny > 0);
  assert.ok(r.rows.every(row => row.cny == null || row.cny >= 0));
  assert.ok(r.costCny >= 0); ledger(r);
  close(r.steps.mainlandForeign, r.budgetCny);
});

test('bank spread uses its own bid/ask; another bank midpoint cannot become a negative bank charge', () => {
  const quotes = structuredClone(richQuotes);
  quotes.banks.abc.quotes.USD = { buy: 6.95, sell: 6.97, asOf: '2026-10-08 20:00:00' };
  const r = M.journeyPlans({ ...mainlandConfig, startBank: 'abc', profitUsd: 1000 }, D, quotes).selected;
  const entry = r.rows.find(row => row.key === 'entryFx');
  close(entry.cny, r.steps.mainlandForeign * .01);
  close(entry.fxImpactCny, r.steps.mainlandForeign * .04);
  assert.ok(r.rows.every(row => row.cny == null || row.cny >= 0)); ledger(r);
});

test('BOC RMB cross-border tariff is priced before CNH arrives, independently of currency valuation', () => {
  const p = M.journeyPlans({ ...mainlandConfig, route: 'CNH', depositMethod: 'fps', profitUsd: 1000 }, D, richQuotes);
  const r = p.selected;
  close(r.rows.find(row => row.key === 'sender').cny, (70000 - 80) / 1.001 * .001 + 80);
  assert.equal(r.rows.find(row => row.key === 'entryFx').cny, 0);
  close(r.steps.mainlandForeign + r.rows.find(row => row.key === 'sender').cny, 70000);
  assert.equal(r.missing.some(reason => reason === '中国银行所选渠道汇出收费'), false);
  ledger(r);
});

const broker = id => D.brokers.find(row => row.id === id);
const feeConfig = { date: '2026-10-09', months: 1, sharePriceUsd: 100, buyOrders: 1, sellOrders: 1, tradeFeeUsd: '' };
const feeRefs = { CNY: 1, USD: 7, HKD: 7 / 8, CNH: 7 / 7.1 };
test('broker fee caps preserve each provider’s minimum/cap precedence', () => {
  close(M.cappedCharge(broker('ibkr').commission, .1, 10), .1);
  close(M.cappedCharge(broker('chief').platform, .1, 10), .99);
  close(M.cappedCharge(broker('usmart').platform, .1, 10), 1.88);
  close(M.cappedCharge(broker('za').platform, .1, 10), 1.99);
});
test('sub-one-share orders use the published IBKR and uSMART fractional tariffs', () => {
  for (const [value, price, expected] of [[5, 10, .05], [.75, 15, .01], [500, 1000, 5]]) {
    const cash = value + expected + value / price * .000003;
    const r = M.brokerTradingFees({ ...feeConfig, sharePriceUsd: price }, broker('ibkr'), cash, 0, feeRefs);
    assert.ok(!r.error); close(r.investUsd, value); close(r.buyFeeUsd, cash - value);
    close(r.orders[0].commission, expected); close(r.orders[1].commission, expected);
    close(r.investUsd + r.buyFeeUsd, cash);
  }
  for (const usmartPromo of [false, true]) {
    const r = M.brokerTradingFees({ ...feeConfig, sharePriceUsd: 99, usmartPromo, months: 12 }, broker('usmart'), 10, 0, feeRefs);
    assert.ok(!r.error); close(r.orders[0].platform, .99); close(r.orders[1].platform, .99);
    assert.equal(r.orders[0].offer, ''); close(r.investUsd + r.buyFeeUsd + r.cashRemainderUsd, 10);
    assert.ok(r.orders.every(order => order.clearing > 0 && order.cat > 0));
  }
});
test('fractional pricing does not miss an affordable whole-share order at a tariff boundary', () => {
  const r = M.brokerTradingFees({ ...feeConfig, sharePriceUsd: 1000 }, broker('ibkr'), 1001.000003, 0, feeRefs);
  assert.ok(!r.error); close(r.investUsd, 1000); close(r.orders[0].commission, 1);
  close(r.buyFeeUsd, 1.000003); close(r.investUsd + r.buyFeeUsd, 1001.000003);
  const tiny = M.brokerTradingFees(feeConfig, broker('ibkr'), .005, 0, feeRefs);
  assert.match(tiny.error, /不足/);
});
test('buy commissions fit inside USD cash; regulatory fees are separate from zero commission', () => {
  for (const id of ['ibkr', 'chief', 'usmart', 'za']) {
    const r = M.brokerTradingFees(feeConfig, broker(id), 10000, 0, feeRefs);
    assert.ok(!r.error); close(r.investUsd + r.buyFeeUsd + r.cashRemainderUsd, 10000);
    close(r.totalUsd, r.buyFeeUsd + r.sellFeeUsd);
    assert.ok(r.orders.every(order => order.feeUsd >= 0));
    assert.ok(r.orders.find(order => order.kind === 'sell').sec > 0);
    assert.equal(r.orders.find(order => order.kind === 'buy').sec, 0);
    assert.equal(r.orders.find(order => order.kind === 'sell').taf, 0);
  }
  const ib = M.brokerTradingFees(feeConfig, broker('ibkr'), 10000, 0, feeRefs);
  close(ib.totalUsd, 2.21 + (10000 - 1 - .0003) / 100 * .000003 * 2, 1e-7);
  const za = M.brokerTradingFees(feeConfig, broker('za'), 10000, 0, feeRefs);
  close(za.totalUsd, 1.99 * 2 + .21);
});

test('ZA ordinary trades use whole shares and retain uninvested cash rather than buying unsupported fractions', () => {
  const evidence = require('./fixtures/money-flow-za-stock-unit-20261011.json');
  assert.equal(D.sources.zaStockUnits.url, evidence.source);
  for (const zaLv2 of [false, true]) for (const useVoucher of [false, true]) {
    const settings = { ...feeConfig, zaLv2, useVoucher, voucherUsd: 10, voucherOrders: 2, voucherScope: 'both', voucherExpiry: '2026-12-31' };
    assert.match(M.brokerTradingFees(settings, broker('za'), 99, 0, feeRefs).error, /不足.*买入.*1股/);
    assert.match(M.brokerTradingFees({ ...settings, sharePriceUsd: 1000000 }, broker('za'), 10000, 0, feeRefs).error, /不足.*买入.*1股/);
    const r = M.brokerTradingFees(settings, broker('za'), 10000, 0, feeRefs);
    assert.ok(!r.error); assert.ok(r.orders.every(order => Number.isInteger(order.shares) && order.shares >= 1));
    close(r.investUsd + r.buyDebitFeeUsd + r.cashRemainderUsd, 10000);
    close(r.buyDebitFeeUsd + r.sellDebitFeeUsd - r.rebateUsd, r.totalUsd);
    assert.ok(r.cashRemainderUsd >= 0 && r.cashRemainderUsd < 102);
  }
  const one = M.brokerTradingFees(feeConfig, broker('za'), 101.99, 0, feeRefs);
  assert.ok(!one.error); close(one.investUsd, 100); close(one.buyFeeUsd, 1.99); close(one.cashRemainderUsd, 0);
  assert.match(M.brokerTradingFees(feeConfig, broker('za'), 101.98, 0, feeRefs).error, /不足.*买入.*1股/);
  const split = M.brokerTradingFees({ ...feeConfig, buyOrders: 3, sellOrders: 4 }, broker('za'), 750, 40, feeRefs);
  assert.ok(!split.error);
  assert.deepEqual(split.orders.filter(order => order.kind === 'buy').map(order => order.shares), [3, 2, 2]);
  assert.deepEqual(split.orders.filter(order => order.kind === 'sell').map(order => order.shares), [2, 2, 2, 1]);
  close(split.orders.filter(order => order.kind === 'sell').reduce((sum, order) => sum + order.value, 0), 740);
  close(split.investUsd + split.buyFeeUsd + split.cashRemainderUsd, 750);
  assert.match(M.brokerTradingFees({ ...feeConfig, sellOrders: 4 }, broker('za'), 350, 0, feeRefs).error, /不足.*4笔/);
  assert.match(M.brokerTradingFees({ ...feeConfig, tradeFeeUsd: 0 }, broker('za'), 99, 0, feeRefs).error, /不足.*买入.*1股/);
});
test('HSBC ordinary and Trade25 trades require whole shares and preserve uninvested USD', () => {
  const evidence = require('./fixtures/money-flow-stock-units-20261011.json');
  assert.equal(D.sources.hsbcUsTariff.url, evidence.hsbc.source);
  for (const trade25 of [false, true]) for (const useVoucher of [false, true]) {
    const settings = { ...feeConfig, trade25, useVoucher, voucherUsd: 100, voucherOrders: 2, voucherScope: 'both', voucherExpiry: '2026-12-31' };
    assert.match(M.brokerTradingFees(settings, broker('hsbc'), 99, 0, feeRefs).error, /不足.*买入.*1股/);
    const r = M.brokerTradingFees({ ...settings, buyOrders: 3, sellOrders: 4 }, broker('hsbc'), 750, 40, feeRefs);
    assert.ok(!r.error); assert.ok(r.orders.every(order => Number.isInteger(order.shares) && order.shares >= 1));
    close(r.investUsd + r.buyFeeUsd + r.cashRemainderUsd, 750);
    close(r.orders.filter(order => order.kind === 'sell').reduce((sum, order) => sum + order.value, 0), r.investUsd + 40);
  }
  const one = M.brokerTradingFees(feeConfig, broker('hsbc'), 118, 0, feeRefs);
  assert.ok(!one.error); close(one.investUsd, 100); close(one.buyFeeUsd, 18); close(one.cashRemainderUsd, 0);
  assert.match(M.brokerTradingFees(feeConfig, broker('hsbc'), 117.99, 0, feeRefs).error, /不足.*买入.*1股/);
  assert.match(M.brokerTradingFees({ ...feeConfig, trade25: true, tradeFeeUsd: 0 }, broker('hsbc'), 99, 0, feeRefs).error, /不足.*买入.*1股/);
});
test('uSMART fractional buys respect one-dollar and 0.0001-share minima, including vouchers and split orders', () => {
  const evidence = require('./fixtures/money-flow-stock-units-20261011.json');
  assert.equal(D.sources.usmartStockUnits.url, evidence.usmart.source);
  for (const useVoucher of [false, true]) {
    const settings = { ...feeConfig, useVoucher, voucherUsd: 10, voucherOrders: 2, voucherScope: 'platform', voucherExpiry: '2026-12-31' };
    assert.match(M.brokerTradingFees(settings, broker('usmart'), .5, 0, feeRefs).error, /不足.*1 USD/);
    assert.match(M.brokerTradingFees({ ...settings, sharePriceUsd: 1000000 }, broker('usmart'), 10, 0, feeRefs).error, /不足.*0.0001股/);
  }
  const one = M.brokerTradingFees(feeConfig, broker('usmart'), 2.01, 0, feeRefs);
  assert.ok(!one.error); close(one.investUsd, 1); close(one.buyFeeUsd, 1.01); close(one.cashRemainderUsd, 0);
  assert.match(M.brokerTradingFees(feeConfig, broker('usmart'), 2, 0, feeRefs).error, /不足.*1 USD/);
  const split = M.brokerTradingFees({ ...feeConfig, buyOrders: 3, sellOrders: 4 }, broker('usmart'), 105, 10, feeRefs);
  assert.ok(!split.error);
  for (const order of split.orders) {
    assert.ok(Math.abs(order.shares * 10000 - Math.round(order.shares * 10000)) < 1e-8);
    assert.ok(order.shares >= .0001); if (order.kind === 'buy') assert.ok(order.value >= 1);
  }
  close(split.investUsd + split.buyFeeUsd + split.cashRemainderUsd, 105);
  close(split.orders.filter(order => order.kind === 'sell').reduce((sum, order) => sum + order.value, 0), split.investUsd + 10);
  const liquidation = M.brokerTradingFees({ ...feeConfig, tradeFeeUsd: 0 }, broker('usmart'), 1.005, -.5, feeRefs);
  assert.ok(!liquidation.error); close(liquidation.investUsd, 1); close(liquidation.cashRemainderUsd, .005);
  assert.ok(liquidation.orders[1].value < 1);
  assert.match(M.brokerTradingFees({ ...feeConfig, tradeFeeUsd: 0, buyOrders: 2 }, broker('usmart'), 1.99, 0, feeRefs).error, /不足.*2笔/);
});
test('Trade25 US monthly fee is waived and the whole first quota-crossing order is exempt', () => {
  const ordinary = M.brokerTradingFees(feeConfig, broker('hsbc'), 10000, 0, feeRefs);
  close(ordinary.orders[0].commission, 18); close(ordinary.monthlyHkd, 0);
  const offer = M.brokerTradingFees({ ...feeConfig, trade25: true, months: 12 }, broker('hsbc'), 10000, 0, feeRefs);
  close(offer.monthlyHkd, 0); close(offer.monthlyUsd, 0); close(offer.orders[0].commission, 0);
  assert.ok(offer.orders[1].sec > 0); assert.ok(offer.orders[1].taf > 0);
  const capped = M.brokerTradingFees({ ...feeConfig, trade25: true, otherTurnoverHkd: 100000 }, broker('hsbc'), 10000, 0, feeRefs);
  close(capped.orders[0].commission, 0); close(capped.orders[1].commission, 0);
  const crossed = M.brokerTradingFees({ ...feeConfig, trade25: true, buyOrders: 2, otherTurnoverHkd: 249999 }, broker('hsbc'), 10000, 0, feeRefs);
  close(crossed.orders[0].commission, 0); close(crossed.orders[1].commission, 18);
  const normal2027 = M.brokerTradingFees({ ...feeConfig, date: '2026-10-09', months: 12 }, broker('hsbc'), 10000, 0, feeRefs);
  close(normal2027.monthlyUsd, 8 * 5);
  const manual = M.brokerTradingFees({ ...feeConfig, trade25: true, tradeFeeUsd: 0 }, broker('hsbc'), 10000, 0, feeRefs);
  close(manual.totalUsd, 0); close(manual.monthlyHkd, 0);
});
test('Chief monthly allocations use gross dollar contributions and retain rounded cash, including vouchers', () => {
  const evidence = require('./fixtures/money-flow-stock-units-20261011.json');
  assert.equal(D.sources.chiefMonthlyTerms.url, evidence.chiefMonthly.source);
  const settings = { ...feeConfig, chiefMonthly: true };
  assert.match(M.brokerTradingFees(settings, broker('chief'), .99, 0, feeRefs).error, /供款.*1 USD/);
  assert.match(M.brokerTradingFees({ ...settings, tradeFeeUsd: 0 }, broker('chief'), .99, 0, feeRefs).error, /供款.*1 USD/);
  const minimum = M.brokerTradingFees(settings, broker('chief'), 1, 0, feeRefs);
  assert.ok(!minimum.error); close(minimum.orders[0].contributionUsd, 1); close(minimum.investUsd, .99);
  close(minimum.buyFeeUsd, .01); close(minimum.cashRemainderUsd, 0);
  const threshold = M.brokerTradingFees({ ...settings, buyOrders: 2, sellOrders: 3 }, broker('chief'), 1001.7, 10, feeRefs);
  assert.ok(!threshold.error);
  assert.deepEqual(threshold.orders.filter(order => order.kind === 'buy').map(order => order.contributionUsd), [501, 500]);
  close(threshold.orders[0].platform, .0015); close(threshold.orders[1].platform, 0);
  for (const order of threshold.orders) {
    assert.ok(Math.abs(order.shares * 100000 - Math.round(order.shares * 100000)) < 1e-7);
    assert.ok(order.shares >= .00001);
    if (order.kind === 'buy') assert.ok(order.value + order.feeUsd <= order.contributionUsd + 1e-8);
  }
  close(threshold.investUsd + threshold.buyFeeUsd + threshold.cashRemainderUsd, 1001.7);
  close(threshold.orders.filter(order => order.kind === 'sell').reduce((sum, order) => sum + order.value, 0), threshold.investUsd + 10);
  assert.ok(threshold.cashRemainderUsd >= .7);
  const coupon = M.brokerTradingFees({ ...settings, useVoucher: true, voucherUsd: 2, voucherOrders: 2,
    voucherScope: 'platform', voucherExpiry: '2026-12-31' }, broker('chief'), 1000.5, 0, feeRefs);
  assert.ok(!coupon.error); close(coupon.orders[0].contributionUsd, 1000); close(coupon.orders[0].platform, .75);
  close(coupon.orders[0].discount, .75);
  close(coupon.investUsd + coupon.buyFeeUsd + coupon.cashRemainderUsd, 1000.5);
  assert.match(M.brokerTradingFees({ ...settings, buyOrders: 3 }, broker('chief'), 2.99, 0, feeRefs).error, /供款.*1 USD/);
  assert.match(M.brokerTradingFees({ ...settings, sharePriceUsd: 1000000 }, broker('chief'), 1, 0, feeRefs).error, /0.00001股/);
});
test('Chief monthly offer applies to eligible buys, expires and leaves clearing and ordinary sale fees', () => {
  const r = M.brokerTradingFees({ ...feeConfig, chiefMonthly: true }, broker('chief'), 500, 0, feeRefs);
  close(r.orders[0].platform, 0); assert.ok(r.orders[0].clearing > 0);
  close(r.orders[1].platform, .99);
  const large = M.brokerTradingFees({ ...feeConfig, chiefMonthly: true }, broker('chief'), 1000, 0, feeRefs);
  close(large.orders[0].platform, .75); close(large.orders[0].contributionUsd, 1000);
  const expired = M.brokerTradingFees({ ...feeConfig, chiefMonthly: true, date: '2027-01-01' }, broker('chief'), 500, 0, feeRefs);
  close(expired.orders[0].platform, .99); assert.match(expired.warnings.join(' '), /过期/);
});
test('uSMART discount checks price, non-HK opening age, campaign dates and the sale date', () => {
  const offer = M.brokerTradingFees({ ...feeConfig, usmartPromo: true, months: 12 }, broker('usmart'), 10000, 0, feeRefs);
  close(offer.orders[0].platform, .99); close(offer.orders[1].platform, 1.88);
  for (const change of [{ sharePriceUsd: 99 }, { usmartDays: 180 }, { date: '2027-01-01' }]) {
    const r = M.brokerTradingFees({ ...feeConfig, usmartPromo: true, ...change }, broker('usmart'), 10000, 0, feeRefs);
    close(r.orders[0].platform, 1.88);
  }
});
test('ZA Lv2 shares five monthly orders across HK/US trading and both sides of the fee benchmark', () => {
  const same = M.brokerTradingFees({ ...feeConfig, zaLv2: true, usedPromoOrders: 4 }, broker('za'), 10000, 0, feeRefs);
  close(same.orders[0].platform, .99); close(same.orders[1].platform, 1.99);
  const separate = M.brokerTradingFees({ ...feeConfig, zaLv2: true, usedPromoOrders: 4, months: 2 }, broker('za'), 10000, 0, feeRefs);
  close(separate.orders[0].platform, .99); close(separate.orders[1].platform, .99);
});
test('welcome vouchers cannot double-discount zero commission or pay regulatory fees; scope and expiry apply', () => {
  const voucher = { ...feeConfig, useVoucher: true, voucherUsd: 100, voucherOrders: 2, voucherExpiry: '2026-12-31' };
  const commissionOnly = M.brokerTradingFees({ ...voucher, voucherScope: 'commission' }, broker('za'), 10000, 0, feeRefs);
  close(commissionOnly.discountUsd, 0); close(commissionOnly.totalUsd, 4.19);
  const platform = M.brokerTradingFees({ ...voucher, voucherScope: 'platform' }, broker('za'), 10000, 0, feeRefs);
  close(platform.discountUsd, 3.98); close(platform.totalUsd, .21);
  const limited = M.brokerTradingFees({ ...voucher, voucherScope: 'platform', voucherUsd: 1 }, broker('za'), 10000, 0, feeRefs);
  close(limited.discountUsd, 1);
  const expired = M.brokerTradingFees({ ...voucher, voucherScope: 'platform', months: 12 }, broker('za'), 10000, 0, feeRefs);
  close(expired.orders[1].discount, 0);
  const pending = M.brokerTradingFees({ ...voucher, voucherExpiry: '' }, broker('za'), 10000, 0, feeRefs);
  assert.match(pending.voucher.message, /截止日期/);
  close(pending.discountUsd, 0); close(pending.totalUsd, commissionOnly.totalUsd);
});
test('all broker journeys reconcile RMB and retain the exact deposit and withdrawal method', () => {
  for (const provider of D.brokers) {
    const input = { ...mainlandConfig, broker: provider.id, depositMethod: provider.usdDepositMethods?.[0] || 'chats', tradeFeeUsd: '', buyOrders: 3, sellOrders: 2, sharePriceUsd: 100,
      trade25: true, hsbcBalanceWaiver: true, chiefMonthly: true, usmartPromo: true, zaLv2: true, months: 12,
      profitUsd: 1000, inwardHkd: 0, intermediaryCny: 0, returnExtraCny: 0 };
    const r = M.journeyPlans(input, D, richQuotes).selected;
    assert.ok(r, provider.id); assert.equal(r.broker.id, provider.id);
    close(r.net + r.costCny + r.taxCny, input.budgetCny + input.profitUsd * r.refs.USD + r.fxImpactCny);
    assert.ok(r.rows.every(row => row.cny == null || row.cny >= 0));
    if (provider.integratedBank) {
      assert.equal(r.bank.id, input.bank); assert.equal(r.returning.id, input.returnBank || input.bank);
      assert.equal(r.settlementBank.id, provider.integratedBank);
      assert.equal(r.depositMethod, r.bank.id === provider.integratedBank ? 'internal' : 'chats');
      for (const key of ['depositBank', 'depositOther', 'returnInward', 'withdrawMiddle', 'withdraw']) close(r.rows.find(row => row.key === key).cny, 0);
    }
    if (provider.id === 'hsbc') close(r.taxCny, Math.max(0, input.profitUsd - r.trading.totalUsd) * r.refs.USD * .2);
    if (provider.id === 'chief') close(r.rows.find(row => row.key === 'withdrawMiddle').cny, 0);
  }
});

test('unfinished vouchers retain every priced leg and all standard trading fees', () => {
  for (const provider of D.brokers) {
    const input = { ...mainlandConfig, broker: provider.id, depositMethod: provider.usdDepositMethods?.[0] || 'chats', tradeFeeUsd: '', profitUsd: 0 };
    const base = M.journeyPlans(input, D, richQuotes).selected;
    for (const draft of [
      { voucherUsd: 0, voucherExpiry: '' },
      { voucherUsd: 20, voucherExpiry: '' },
      { voucherUsd: 20, voucherExpiry: '2026-02-30' },
      { voucherUsd: -1, voucherExpiry: '2026-12-31' },
      { voucherUsd: 20, voucherExpiry: '2026-12-31', voucherOrders: 0 }
    ]) {
      const data = M.journeyPlans({ ...input, useVoucher: true, ...draft }, D, richQuotes), r = data.selected;
      assert.ok(r, provider.id); assert.equal(data.error, undefined);
      assert.equal(r.trading.voucher.pending, true); close(r.trading.discountUsd, 0);
      close(r.trading.totalUsd, base.trading.totalUsd); close(r.net, base.net);
      assert.deepEqual(r.rows, base.rows); assert.deepEqual(r.steps, base.steps);
      assert.deepEqual(r.missing, base.missing);
      assert.equal(M.diagramLedger(r).legs.length, 5);
    }
  }
});

test('broker comparison keeps account-specific vouchers and manual trading fees on that broker', () => {
  const r = M.journeyPlans({ ...mainlandConfig, broker: 'za', tradeFeeUsd: '', useVoucher: true, voucherScope: 'platform', voucherUsd: 100,
    voucherOrders: 2, voucherExpiry: '2026-12-31', months: 1 }, D, richQuotes);
  assert.ok(r.selected.trading.discountUsd > 0);
  for (const row of r.alternatives.broker.filter(row => row.broker.id !== 'za' && !row.error)) close(row.trading.discountUsd, 0);
  const manual = M.journeyPlans({ ...mainlandConfig, broker: 'za', tradeFeeUsd: 0 }, D, richQuotes);
  close(manual.selected.trading.totalUsd, 0);
  assert.ok(manual.alternatives.broker.find(row => row.broker.id === 'ibkr').trading.totalUsd > 0);
});
test('other brokers never inherit IBKR FX commissions; Chief cheque pricing follows the receiving bank', () => {
  const rejected = M.journeyPlans({ ...mainlandConfig, broker: 'chief', route: 'CNH', fxMode: 'manual', tradeFeeUsd: '' }, D, richQuotes);
  assert.match(rejected.error, /换汇成交价未公开/);
  const bank = M.journeyPlans({ ...mainlandConfig, broker: 'chief', bank: 'bochk', route: 'CNH', fxMode: 'bank', tradeFeeUsd: '' }, D, richQuotes).selected;
  assert.ok(bank); close(bank.rows.find(row => row.key === 'brokerFx').cny, 0);
  const cheque = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'sc', returnMethod: 'swift', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(cheque.rows.find(row => row.key === 'returnInward').cny, 0);
  close(cheque.rows.find(row => row.key === 'withdrawMiddle').cny, 0);
  const hsbc = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'hsbc', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(hsbc.rows.find(row => row.key === 'returnInward').cny, 5 * hsbc.refs.HKD);
  const bochk = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'bochk', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(bochk.rows.find(row => row.key === 'returnInward').cny, 0);
  const hang = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'hang', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(hang.rows.find(row => row.key === 'returnInward').cny, 0);
  assert.match(hang.rows.find(row => row.key === 'returnInward').label, /本地USD支票存入/);
});

test('SC local USD cheque deposits use the daily free allowance and not foreign-cheque collection fees', () => {
  for (const index of [1, 29, 30]) for (const preFilled of [false, true]) close(M.localUsdChequeFee(hk('sc'), index, '2026-10-11', preFilled), 0);
  for (const index of [31, 32, 200]) {
    close(M.localUsdChequeFee(hk('sc'), index, '2026-10-11'), 2);
    close(M.localUsdChequeFee(hk('sc'), index, '2026-10-11', true), 1);
  }
  for (const index of [0, -1, 1.5, NaN]) assert.equal(M.localUsdChequeFee(hk('sc'), index), null);
  assert.equal(M.localUsdChequeFee(hk('sc'), 1, '2026-09-30'), null);
  assert.equal(M.localUsdChequeFee(hk('za')), null);
  close(M.localUsdChequeFee(hk('hsbc'), 200), 5);
  close(M.localUsdChequeFee(hk('hang'), 200), 0);
});

test('every displayed leg conserves value, tax and reference effects; coefficients compare equal units', () => {
  for (const id of ['ibkr', 'hsbc', 'chief', 'usmart', 'za']) for (const profitUsd of [0, 1500, -500]) {
    const r = M.journeyPlans({ ...mainlandConfig, broker: id, tradeFeeUsd: '', profitUsd, months: 12,
      bank: id === 'hsbc' || id === 'za' ? id : 'bochk', returnBank: id === 'hsbc' || id === 'za' ? id : 'hang',
      trade25: true, useVoucher: true, voucherUsd: 2, voucherScope: 'both', voucherOrders: 2, voucherExpiry: '2026-12-31',
      returnMethod: 'swift', openingCny: 25, extraCapitalCny: 10000, annualGapPct: 2 }, D, richQuotes).selected;
    assert.ok(r, id);
    const l = M.flowLedger(r);
    close(l.stops[0].amount, r.budgetCny);
    close(l.stops[2].amount, r.steps.fundedUsd); // Buy fees belong to the NEXT leg.
    close(l.stops.at(-1).amount, r.net);
    close(l.legs.reduce((sum, leg) => sum + leg.costCny, 0), r.costCny);
    close(l.legs.reduce((sum, leg) => sum + leg.lossCny, 0), l.lossCny);
    for (const leg of l.legs) {
      close(leg.inputCny + leg.profitCny + leg.fxImpactCny, leg.outputCny + leg.costCny + leg.taxCny);
      close(leg.coefficient, (leg.outputCny - leg.profitCny) / leg.inputCny);
      close(leg.lossRate, leg.lossCny / leg.inputCny);
      close(leg.rows.reduce((sum, row) => sum + (row.cny ?? 0), 0), leg.costCny);
      assert.ok(leg.rows.every(row => row.cny == null || row.cny >= -1e-10));
    }
    close(l.stops.at(-1).cumulativeLossCny, r.budgetCny + profitUsd * r.refs.USD - r.net);
    assert.notEqual(l.legs[0].coefficient, r.steps.hongKong / r.budgetCny);
    assert.notEqual(l.legs[0].coefficient, r.net / r.budgetCny);
  }
});

test('CNH transfer has no conversion charge; conversion stays after Hong Kong arrival in both orders', () => {
  for (const fxMode of ['manual', 'auto', 'bank']) {
    const r = M.journeyPlans({ ...mainlandConfig, bank: 'bochk', returnBank: 'hang', broker: 'ibkr', route: 'CNH',
      fxMode, depositMethod: fxMode === 'bank' ? 'chats' : 'edda', profitUsd: 0, tradeFeeUsd: '', depositHkd: 20 }, D, richQuotes).selected;
    const l = M.flowLedger(r);
    close(l.legs[0].rows.find(row => row.key === 'entryFx').cny, 0);
    assert.equal(l.stops[1].currency, 'CNH');
    assert.ok(l.legs[fxMode === 'auto' ? 2 : 1].rows.some(row => row.key === 'brokerFx'));
    if (fxMode === 'bank') close(r.steps.hkConvertedUsd - 20 * r.refs.HKD / r.refs.USD, r.steps.fundedUsd);
    else close(r.steps.brokerOriginal, r.steps.hongKong - 20 * r.refs.HKD / r.refs.CNH);
    close(l.legs[0].inputCny + l.legs[0].fxImpactCny, l.legs[0].outputCny + l.legs[0].costCny);
  }
});

test('favourable currency valuation is signed, never hidden by an absolute value or a clamp', () => {
  const q = structuredClone(richQuotes);
  q.offshoreUsd.bochk.quotes.CNH = { bidPerUsd: 6.85, askPerUsd: 6.87, asOf: '2026-10-08 20:00:00' };
  const r = M.journeyPlans({ ...mainlandConfig, broker: 'ibkr', profitUsd: 0, route: 'CNH', depositMethod: 'fps',
    senderFeeCny: 0, tradeFeeUsd: '' }, D, q).selected;
  const l = M.flowLedger(r);
  assert.ok(l.legs[0].lossCny < 0); assert.ok(l.legs[0].coefficient > 1);
  close(l.legs[0].costCny, 0); close(l.legs[0].lossCny, -l.legs[0].fxImpactCny);
});

test('unquoted fees remain named in every affected node, while explicit zero clears that gap', () => {
  const input = { ...mainlandConfig, broker: 'ibkr', profitUsd: 0, tradeFeeUsd: '', entryMiddleCny: '',
    depositOtherCny: '', intermediaryCny: '', returnExtraCny: '' };
  const r = M.journeyPlans(input, D, richQuotes).selected, l = M.flowLedger(r);
  assert.ok(l.legs[0].missing.includes('内地→香港中转行费'));
  assert.ok(l.stops[2].missing.includes('内地→香港中转行费'));
  assert.ok(l.legs[4].missing.includes('回内地中转行费'));
  assert.ok(!l.legs[4].missing.includes('中国银行USD收款费'));
  close(l.legs[4].rows.find(item => item.label === '中国银行USD收款费').cny, 0);
  assert.equal(r.complete, false);
  const confirmed = M.journeyPlans({ ...input, entryMiddleCny: 0, depositOtherCny: 0, intermediaryCny: 0, returnExtraCny: 0 }, D, richQuotes).selected;
  assert.equal(confirmed.complete, true); assert.equal(M.flowLedger(confirmed).stops.at(-1).missing.length, 0);
});

test('route presets replace all routing and scoped prices, and reproduce their advertised result', () => {
  const dirty = { ...mainlandConfig, broker: 'hsbc', trade25: true, hsbcBalanceWaiver: true, profitUsd: 0, tradeFeeUsd: '99',
    startSell: '7.9', entryPrice: '8.1', exitPrice: '6.8', senderFeeCny: '10', monthlyHkd: '1', useVoucher: true,
    voucherUsd: '20', voucherOrders: '2', voucherScope: 'both', voucherExpiry: '2026-12-31', months: 12 };
  const data = M.journeyPlans(dirty, D, richQuotes);
  assert.ok(data.presets.length >= 7);
  for (const preset of data.presets) {
    const applied = M.applyRoute(dirty, preset.result, preset.id);
    for (const key of M.routeKeys) assert.equal(applied[key], M.routeConfiguration(preset.result)[key], key);
    for (const key of M.bankQuoteKeys) assert.equal(applied[key], '', key);
    assert.equal(applied.budgetCny, dirty.budgetCny); assert.equal(applied.months, dirty.months);
    assert.equal(applied.useVoucher, false); assert.equal(applied.tradeFeeUsd, '');
    const r = M.journeyPlans(applied, D, richQuotes).selected;
    close(r.net, preset.result.net); close(r.costCny, preset.result.costCny);
  }
});

test('recommendations compare complete routes across brokers without using unknown bank or FX prices as free', () => {
  const data = M.journeyPlans({ ...mainlandConfig, broker: 'ibkr', profitUsd: 0, tradeFeeUsd: '', bank: '', returnBank: '',
    startBank: '', exitBank: '', route: '', fxMode: '', mainlandMethod: '', depositMethod: '', returnMethod: '', months: 1 }, D, richQuotes);
  assert.ok(data.plans.some(r => r.broker.id === 'za'));
  assert.ok(data.plans.every(r => !r.indicativeFx));
  assert.ok(data.plans.every(r => !r.requiredEligibility.length));
  close(data.minimum.net, Math.max(...data.plans.map(r => r.net)));
  assert.equal(data.recommended, data.minimum);
  assert.ok(data.recommendationReason.includes(data.recommended.complete ? '费用已核齐' : '缺项另列'));
  if (data.simple) assert.ok(data.simple.net <= data.minimum.net + 1e-7);
  assert.equal(data.alternatives.start.length, 10); assert.equal(data.alternatives.bank.length, 6);
});

test('ZA return fees use the expected sell month, with publicly announced November changes included', () => {
  const input = { ...mainlandConfig, broker: 'za', bank: 'za', returnBank: 'za', profitUsd: 0, tradeFeeUsd: '', date: '2026-10-08', returnMethod: 'swift' };
  const current = M.journeyPlans({ ...input, months: 1 }, D, richQuotes).selected;
  const later = M.journeyPlans({ ...input, months: 12 }, D, richQuotes).selected;
  close(current.rows.find(row => row.key === 'returnWire').cny, 0);
  close(later.rows.find(row => row.key === 'returnWire').cny, 70 * later.refs.HKD);
  assert.equal(later.returnDate, '2027-09-08');
});

test('linked return channels require the destination mainland account eligibility too', () => {
  const config = { ...mainlandConfig, startBank: '', bank: '', returnBank: '', exitBank: '', route: '', fxMode: '',
    mainlandMethod: '', depositMethod: '', returnMethod: '', broker: 'ibkr', profitUsd: 0, tradeFeeUsd: '' };
  const q = structuredClone(richQuotes);
  q.banks.hsbc = { quotes: { USD: { buy: 7, sell: 7.01, asOf: '2026-10-08 20:00:00' } } };
  const ordinary = M.journeyPlans(config, D, q);
  assert.ok(ordinary.plans.every(row => row.returnMethod !== 'linked'));
  const enabled = M.journeyPlans({ ...config, eligible_hsbc: true }, D, q);
  assert.ok(enabled.plans.some(row => row.returnMethod === 'linked'));
  assert.ok(enabled.plans.filter(row => row.returnMethod === 'linked').every(row => row.requiredEligibility.includes('hsbc')));
  for (const preset of ordinary.presets.filter(row => !row.evidenceOnly)) assert.ok(preset.result.rows.find(row => row.key === 'sender').cny != null);
  assert.ok(ordinary.plans.some(row => row.mainlandMethod === 'full'));
  assert.ok(ordinary.plans.some(row => row.depositMethod === 'swift'));
  close(ordinary.recommended.net, ordinary.minimum.net);
});

test('BOC mobile uses the bank-authored 2026 waiver separately from the observed SHA agent charge', () => {
  const input = { ...mainlandConfig, broker: 'ibkr', bank: 'bochk', returnBank: 'bochk', returnMethod: 'bochk-fast',
    mainlandMethod: 'boc-mobile', profitUsd: 0, tradeFeeUsd: '', senderFeeCny: '', entryMiddleCny: '' };
  const data = M.journeyPlans(input, D, richQuotes), r = data.selected;
  close(r.rows.find(row => row.key === 'sender').cny, 0);
  assert.match(r.rows.find(row => row.key === 'sender').evidence, /手机银行双免/);
  assert.equal(D.bocMobileEvidence.level, 'bank-statement');
  assert.equal(D.bocMobileEvidence.intermediaryLevel, 'reported');
  close(r.rows.find(row => row.key === 'entryInward').cny, 0);
  close(r.rows.find(row => row.key === 'entryMiddle').cny, 0);
  assert.match(r.rows.find(row => row.key === 'entryMiddle').evidence, /USD\/HKD同行SHA路径/);
  assert.match(r.rows.find(row => row.key === 'entryMiddle').estimate, /同名同行SHA操作记录/);
  for (const key of ['sender', 'entryInward']) assert.equal(r.rows.find(row => row.key === key).estimate, undefined);
  assert.equal(r.rankable, false);
  assert.ok(data.plans.every(row => row.mainlandMethod !== 'boc-mobile'));
  const mobile = data.presets.find(row => row.id === 'boc-mobile');
  assert.equal(mobile.evidenceOnly, true); assert.equal(mobile.differenceCny, null);
  assert.equal(mobile.result.mainlandMethod, 'boc-mobile');
  const standard = M.journeyPlans({ ...input, mainlandMethod: 'swift' }, D, richQuotes).selected;
  assert.ok(standard.rows.find(row => row.key === 'sender').cny > 0);
  assert.equal(standard.rows.find(row => row.key === 'entryMiddle').cny, null);
  assert.match(M.journeyPlans({ ...input, bank: 'za' }, D, richQuotes).error, /同名中银香港/);
  assert.match(M.journeyPlans({ ...input, route: 'CNH' }, D, richQuotes).error, /另一渠道/);
});

test('confirmed free BOC mobile transfers preserve the foreign principal without erasing purchase spreads', () => {
  const input = { ...mainlandConfig, broker: 'ibkr', bank: 'bochk', returnBank: 'bochk', returnMethod: 'bochk-fast',
    mainlandMethod: 'boc-mobile', profitUsd: 0, tradeFeeUsd: '', senderFeeCny: 0, entryMiddleCny: 0 };
  const data = M.journeyPlans(input, D, richQuotes), r = data.selected;
  for (const key of ['sender', 'entryMiddle', 'entryInward']) close(r.rows.find(row => row.key === key).cny, 0);
  assert.equal(r.rows.find(row => row.key === 'entryMiddle').estimate, undefined);
  close(r.steps.hongKong, r.steps.mainlandForeign);
  close(r.steps.hongKong, r.budgetCny / r.startSell);
  assert.ok(r.rows.find(row => row.key === 'entryFx').cny > 0);
  close(r.net + r.costCny + r.taxCny, r.budgetCny + r.fxImpactCny);
  const elsewhere = data.alternatives.bank.find(row => row.bank.id === 'za');
  assert.ok(elsewhere.rows.find(row => row.key === 'sender').cny > 0);
  assert.equal(elsewhere.rows.find(row => row.key === 'entryMiddle').cny, null);
  const hkd = data.alternatives.route.find(row => row.route === 'HKD');
  close(hkd.rows.find(row => row.key === 'sender').cny, 0);
  assert.match(hkd.rows.find(row => row.key === 'sender').evidence, /手机银行双免/);
  const cnh = data.alternatives.route.find(row => row.route === 'CNH');
  assert.equal(cnh.mainlandMethod, 'swift');
  assert.ok(cnh.rows.find(row => row.key === 'sender').cny > 0);
});

test('all trading accounts retain fees for USD, HKD and CNH without inventing bank FX quotes', () => {
  for (const route of ['USD', 'HKD', 'CNH']) {
    const input = { ...mainlandConfig, route, broker: 'ibkr', bank: 'za', returnBank: 'bochk', returnMethod: 'swift',
      fxMode: 'manual', mainlandMethod: 'swift', depositMethod: route === 'USD' ? 'chats' : 'fps', tradeFeeUsd: '', profitUsd: 0 };
    const data = M.journeyPlans(input, D, richQuotes);
    assert.equal(data.alternatives.broker.length, D.calculator.brokers.length);
    for (const row of data.alternatives.broker) {
      assert.equal(row.error, undefined, route + ':' + row.broker.id);
      assert.ok(row.trading.totalUsd > 0); assert.ok(Number.isFinite(row.net));
      const ledger = M.diagramLedger(row);
      assert.equal(ledger.legs.length, 5);
      close(row.net + row.costCny + row.taxCny, row.budgetCny + row.fxImpactCny);
      if (route !== 'USD' && !['ibkr', 'ibkr-lite'].includes(row.broker.id)) {
        assert.match(row.indicativeFx, /成交价（暂按参考中间价）/);
        assert.equal(row.rows.find(r => r.key === 'brokerSpread').cny, null);
        assert.equal(row.quotedCore, false); assert.equal(row.rankable, false);
        close(row.rows.find(r => r.key === 'brokerFx').cny, 0);
        assert.equal(ledger.legs[1].indicative, true);
        assert.ok(row.missing.some(text => text.includes(row.bank.name) && text.includes(route)));
      } else if (route !== 'USD' && row.broker.id === 'ibkr-lite') {
        assert.equal(row.fxMode, 'manual');
        assert.equal(row.depositMethod, 'swift');
        assert.ok(row.rows.find(r => r.key === 'brokerFx').cny > 0);
        assert.equal(row.rows.find(r => r.key === 'brokerSpread').cny, null);
        assert.ok(row.missing.some(text => text.includes('IBKR') && text.includes(route)));
      }
    }
  }
  const input = { ...mainlandConfig, broker: 'za', bank: 'za', returnBank: 'za', route: 'HKD', fxMode: 'bank', tradeFeeUsd: '', profitUsd: 0 };
  const priced = M.journeyPlans({ ...input, entryPrice: 8 }, D, richQuotes).selected;
  assert.equal(priced.indicativeFx, ''); close(priced.entryPrice, 8);
  assert.ok(priced.rows.find(row => row.key === 'brokerSpread').cny != null);
});

test('the diagram shows the final RMB only once and retains every closing cost', () => {
  const r = M.journeyPlans({ ...mainlandConfig, broker: 'ibkr', profitUsd: 0, tradeFeeUsd: '', months: 12,
    bank: 'hsbc', returnBank: 'hang', openingCny: 100, extraCapitalCny: 50000, annualGapPct: 2 }, D, richQuotes).selected;
  const l = M.diagramLedger(r);
  assert.equal(l.stops.length, 6); assert.equal(l.legs.length, 5);
  assert.deepEqual(l.stops.filter(row => row.currency === 'CNY').map(row => row.id), ['start', 'destination']);
  close(l.legs.reduce((sum, row) => sum + row.costCny, 0), r.costCny);
  close(l.stops.at(-1).amount, r.net);
  const end = l.legs.at(-1);
  close(end.inputCny + end.fxImpactCny, end.outputCny + end.costCny);
  for (const key of ['returnWire', 'returnOther', 'exitFx', 'account', 'extra']) assert.ok(end.rows.some(row => row.key === key));
});

test('current ICBC online fees use 80% of the 50–260 CNY counter schedule, not obsolete limits', () => {
  const bank = D.mainlandBanks.find(row => row.id === 'icbc');
  close(M.fee(bank, 1000, 1, '2026-10-09'), 120);
  close(M.fee(bank, 100000, 1, '2026-10-09'), 160);
  close(M.fee(bank, 1000000, 1, '2026-10-09'), 288);
  assert.equal(M.fee(bank, 100000, 1, '2026-08-07'), null);
  const r = M.journeyPlans({ ...mainlandConfig, startBank: 'icbc', startSell: 7.01 }, D, richQuotes).selected;
  assert.ok(r.rows.find(row => row.key === 'sender').cny > 0);
  assert.ok(!r.missing.some(text => /工商银行汇出手续费|工商银行电讯费/.test(text)));
  ledger(r, 0);
});

test('CCB cross-border RMB and free incoming transfer are supported by the current schedule', () => {
  const r = M.journeyPlans({ ...mainlandConfig, startBank: 'ccb', bank: 'bochk', route: 'CNH', depositMethod: 'fps',
    exitBank: 'ccb', exitPrice: 7, returnExtraCny: '' }, D, richQuotes).selected;
  const sender = r.rows.find(row => row.key === 'sender');
  close(sender.cny, (70000 - 80) / 1.001 * .001 + 80);
  const incoming = r.rows.find(row => row.key === 'returnOther').items;
  close(incoming.find(row => row.label === '建设银行USD收款费').cny, 0);
  assert.ok(!r.missing.includes('建设银行USD收款费'));
  assert.ok(r.missing.includes('回内地中转行费'));
  assert.ok(!M.flowLedger(r).legs[4].missing.includes('建设银行USD收款费'));
  ledger(r, 0);
});

test('COMM regional price endpoints fit inside the budget, with per-transfer minimums and caps', () => {
  const bank = D.mainlandBanks.find(row => row.id === 'comm');
  const range = (budget, count = 1, currency = 'USD', date = '2026-10-09') => M.senderFeeRange(bank, budget, count, 0, date, currency);
  const bounds = range(100000);
  close(bounds[0], (100000 - 80) / 1.0005 * .0005 + 80);
  close(bounds[1], (100000 - 150) / 1.0008 * .0008 + 150);
  assert.deepEqual(range(1000), [100, 190]);
  assert.deepEqual(range(3000, 3), [300, 570]);
  assert.deepEqual(range(1000000), [280, 350]);
  assert.equal(range(80), null);
  assert.equal(range(100000, 1, 'CNH'), null);
  assert.equal(range(100000, 1, 'USD', '2026-05-26'), null);
  const r = M.journeyPlans({ ...mainlandConfig, startBank: 'comm', budgetCny: 100000 }, D, richQuotes).selected;
  const sender = r.rows.find(row => row.key === 'sender');
  assert.equal(sender.cny, null); assert.deepEqual(sender.rangeCny, bounds);
  assert.equal(sender.status, '按地区定价');
  const first = M.comparisonMetric(r, 'start');
  assert.equal(first.lossRate, null); assert.equal(r.rankable, false);
  assert.deepEqual(first.rows.find(row => row.key === 'sender').rangeCny, bounds);
  const quoted = M.journeyPlans({ ...mainlandConfig, startBank: 'comm', senderFeeCny: 150 }, D, richQuotes).selected;
  close(quoted.rows.find(row => row.key === 'sender').cny, 150);
  assert.equal(quoted.rows.find(row => row.key === 'sender').rangeCny, undefined);
  ledger(r, 0); ledger(quoted, 0);
});

test('choosing BOC preserves an explicitly selected standard tariff alongside the reported mobile waiver', () => {
  const config = { ...mainlandConfig, bank: 'bochk', mainlandMethod: '' };
  const standard = M.journeyPlans(config, D, richQuotes).selected;
  assert.equal(standard.mainlandMethod, 'swift');
  assert.ok(standard.rows.find(row => row.key === 'sender').cny > 0);
  const mobile = M.journeyPlans({ ...config, mainlandMethod: 'boc-mobile' }, D, richQuotes).selected;
  const sender = mobile.rows.find(row => row.key === 'sender');
  close(sender.cny, 0); assert.match(sender.evidence, /手机银行双免/);
  close(mobile.rows.find(row => row.key === 'entryInward').cny, 0);
});

test('an unavailable saved SWIFT Go channel repairs only its remittance fees and keeps every account and unrelated setting', () => {
  const initial = { ...currentRoute, startBank: 'cib', bank: 'bochk', returnBank: 'bochk', broker: 'za', count: 2,
    mainlandMethod: 'cib-go', route: 'USD', outcome: 'broker-balance', profitUsd: 0,
    senderFeeCny: '99', entryMiddleCny: '13', entryInwardHkd: '17', startSell: '6.8',
    depositHkd: '9', inwardHkd: '7', usdCny: '6.7', months: 12, useVoucher: true };
  const ui = moneyUi(initial), html = ui.render();
  assert.doesNotMatch(html, /SWIFT Go|SWIFT GO|仅按50元服务资费测算|小额全额到账/);
  assert.match(html, /普通汇款/);
  assert.equal(ui.saved().mainlandMethod, 'swift');
  for (const key of ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd']) assert.equal(ui.saved()[key], '', key);
  for (const key of ['startBank', 'bank', 'returnBank', 'broker', 'route', 'budgetCny', 'count', 'months',
    'startSell', 'depositHkd', 'inwardHkd', 'usdCny', 'useVoucher']) assert.equal(ui.saved()[key], initial[key], key);
  for (const [key, ids] of [['startBank', D.calculator.departureBanks], ['bank', D.calculator.hkBanks], ['broker', D.calculator.brokers]]) {
    ui.act('pick', '', key);
    const picker = ui.modal();
    for (const id of ids) assert.ok(picker.includes('data-value="' + id + '"'), key + '/' + id);
    ui.act('close');
  }
  ui.act('choose', 'mainlandMethod', 'cib-go');
  assert.equal(ui.saved().mainlandMethod, 'swift');
  const restored = moneyUi(ui.saved()); assert.doesNotMatch(restored.render(), /SWIFT Go|SWIFT GO|小额全额到账/);
  assert.equal(ui.saved().count, 2); assert.equal(ui.saved().bank, 'bochk'); assert.equal(ui.saved().broker, 'za');
});

test('only explicitly removed ABC is blocked; ordinary banks, brokers, currencies and channels remain selectable', () => {
  const initial = { ...mainlandConfig, startBank: 'cib', bank: 'bochk', broker: 'za', count: 2, mainlandMethod: 'swift', outcome: 'usd-balance', profitUsd: 0 };
  const ui = moneyUi(initial); ui.render();
  const before = structuredClone(ui.saved());
  ui.act('choose', 'startBank', 'abc'); assert.deepEqual(ui.saved(), before);
  for (const [field, value] of [['startBank', 'boc'], ['broker', 'ibkr'], ['route', 'CNH'], ['mainlandMethod', 'swift']]) {
    ui.act('choose', field, value);
    assert.equal(ui.saved()[field], value);
    assert.equal(ui.saved().bank, 'bochk');
  }
});

test('BOCHK receiving and bank stock settlement accounts stay independent in both directions', () => {
  for (const id of ['za', 'hsbc']) {
    const input = { ...mainlandConfig, selectedOnly: true, broker: id, tradeFeeUsd: '', startBank: 'boc', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc',
      route: 'USD', mainlandMethod: 'boc-mobile', outcome: 'usd-balance', trade25: true, hsbcBalanceWaiver: true, profitUsd: 0, months: 12 };
    const r = M.journeyPlans(input, D, richQuotes).selected;
    assert.equal(r.bank.id, 'bochk'); assert.equal(r.returning.id, 'bochk'); assert.equal(r.settlementBank.id, id);
    assert.equal(r.depositMethod, 'chats');
    for (const key of ['sender', 'entryInward', 'depositBank', 'depositOther', 'withdraw', 'returnInward', 'withdrawMiddle']) close(r.rows.find(x => x.key === key).cny, 0);
    assert.equal(r.rows.some(x => ['returnWire', 'exitFx'].includes(x.key)), false);
    close(r.steps.hongKong, r.budgetCny / r.startSell);
    if (id === 'hsbc') { close(r.trading.monthlyHkd, 0); close(r.rows.find(x => x.key === 'brokerAccount').cny, 0); }
  }
});

test('holding, USD debit, CNH debit and mainland settlement each conserve their own currency and rate', () => {
  const input = { ...mainlandConfig, selectedOnly: true, broker: 'za', tradeFeeUsd: '', startBank: 'boc', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc',
    route: 'USD', mainlandMethod: 'boc-mobile', profitUsd: 1000, entryMiddleCny: 0, returnExtraCny: 0, months: 12 };
  const results = {};
  for (const outcome of ['usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
    const r = M.journeyPlans({ ...input, outcome }, D, richQuotes).selected; assert.ok(r, outcome); results[outcome] = r;
    close(r.netCny, r.net * r.refs[r.currency]);
    close(r.netCny + r.costCny + r.taxCny, r.budgetCny + input.profitUsd * r.refs.USD + r.fxImpactCny);
    for (const leg of M.flowLedger(r).legs) close(leg.outputCny + leg.costCny + leg.taxCny, leg.inputCny + leg.profitCny + leg.fxImpactCny);
  }
  close(results['usd-balance'].net, results['usd-card'].net);
  close(results['cnh-card'].exitPrice, richQuotes.offshoreUsd.bochk.quotes.CNH.bidPerUsd);
  close(results.mainland.exitPrice, richQuotes.banks.boc.quotes.USD.buy);
  assert.equal(results['cnh-card'].currency, 'CNY'); assert.equal(results.mainland.currency, 'CNY');
  assert.match(M.journeyPlans({ ...input, outcome: 'usd-card', returnBank: 'za' }, D, richQuotes).error, /不支持.*美元/);
  const hsbc = M.journeyPlans({ ...input, outcome: 'cnh-card', returnBank: 'hsbc', exitPrice: 6.5 }, D, richQuotes);
  assert.equal(hsbc.error, undefined); assert.equal(hsbc.selected.returning.id, 'hsbc'); close(hsbc.selected.exitPrice, 6.5);
});

test('a third settlement bank adds its own monthly charge once and keeps native currency arithmetic', () => {
  const input = { ...mainlandConfig, selectedOnly: true, broker: 'hsbc', tradeFeeUsd: '', startBank: 'boc', bank: 'bochk', returnBank: 'za', exitBank: 'boc',
    route: 'USD', mainlandMethod: 'boc-mobile', outcome: 'usd-balance', profitUsd: 0, months: 12, trade25: true };
  const charged = M.journeyPlans(input, D, richQuotes).selected;
  const account = charged.rows.find(x => x.key === 'account');
  close(account.cny, 100 * 12 * charged.refs.HKD);
  assert.equal(account.items.filter(x => x.label.includes('汇丰')).length, 1);
  const waived = M.journeyPlans({ ...input, hsbcBalanceWaiver: true }, D, richQuotes).selected;
  close(waived.net - charged.net, 1200 * charged.refs.HKD / charged.refs.USD);
  close(charged.rows.find(x => x.key === 'brokerAccount').cny, 0);
});

test('bank bridge charges cannot be confused with free stock internal settlement', () => {
  close(M.localUsdTransfer(hk('sc'), hk('za'), feeRefs, '2026-10-09'), 22 * feeRefs.USD);
  close(M.localUsdTransfer(hk('za'), hk('bochk'), feeRefs, '2027-01-09'), 0);
  close(M.localUsdTransfer(hk('hsbc'), hk('bochk'), feeRefs, '2026-10-09'), 0);
});

test('switching the stock venue in the UI preserves both selected banks and does not disturb entry fees', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  let saved = { ...mainlandConfig, bank: 'bochk', returnBank: 'bochk', broker: 'ibkr', route: 'USD', mainlandMethod: 'boc-mobile', entryMiddleCny: '0', profitUsd: 0 };
  const context = { window: { MONEY_FLOW: D, MONEY_FLOW_QUOTES: richQuotes, ChanghengMoneyFlowModel: M },
    document: { querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => JSON.stringify(saved), setItem: (_, v) => { saved = JSON.parse(v); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/money-flow.js'), 'utf8'), context);
  for (const id of ['za', 'hsbc', 'ibkr']) {
    context.window.ChanghengMoneyFlow.handleAction({ dataset: { action: 'money-flow-choose', field: 'broker', value: id } });
    assert.equal(saved.bank, 'bochk'); assert.equal(saved.returnBank, 'bochk'); assert.equal(saved.mainlandMethod, 'boc-mobile'); assert.equal(saved.entryMiddleCny, '0');
  }
});

const cibQuotes = structuredClone(richQuotes);
cibQuotes.banks.cib = { quotes: {
  USD: { buy: 6.6827, sell: 6.7081, asOf: '2026-10-09 12:00:00', timeBasis: 'observed' },
  HKD: { buy: .8515, sell: .8548, asOf: '2026-10-09 12:00:00', timeBasis: 'observed' }
} };
const currentRoute = { ...mainlandConfig, budgetCny: 100000, date: '2026-10-09', selectedOnly: true, startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc',
  broker: 'za', outcome: 'usd-balance', tradeFeeUsd: '', profitUsd: 0, months: 12, hsbcBalanceWaiver: true, entryMiddleCny: '', startSell: '' };

test('CIB public quotes apply the current card half-spread exactly once, with dated expiry', () => {
  const raw = structuredClone(cibQuotes.banks.cib);
  const r = M.journeyPlans(currentRoute, D, cibQuotes).selected;
  close(r.startSell, 6.70175);
  close(r.rows.find(x => x.key === 'entryFx').cny, 100000 / 6.70175 * .00635);
  close(r.rows.find(x => x.key === 'sender').cny, 0);
  assert.equal(r.entryTimeBasis, 'observed');
  close(r.steps.hongKong, 100000 / 6.70175);
  assert.deepEqual(cibQuotes.banks.cib, raw);
  const own = M.journeyPlans({ ...currentRoute, startSell: '6.69' }, D, cibQuotes).selected;
  close(own.startSell, 6.69);
  for (const date of ['2026-06-30', '2027-07-01']) close(M.quotedMainlandBanks(D, cibQuotes, date).find(x => x.id === 'cib').quotes.USD.sell, 6.7081);
  const next = M.journeyPlans({ ...currentRoute, usedFreeTransfers: 30 }, D, cibQuotes).selected;
  close(next.rows.find(x => x.key === 'sender').cny, 100);
});

test('FX comparison uses same-currency output, cannot crown missing or stale quotes, and is not a fee coefficient', () => {
  const c = M.purchaseComparison(currentRoute, D, cibQuotes);
  assert.equal(c.best.bank.id, 'cib');
  close(c.rows.find(x => x.bank.id === 'cib').lossRate, 0);
  close(c.rows.find(x => x.bank.id === 'boc').lossRate, 1 - 6.70175 / richQuotes.banks.boc.quotes.USD.sell);
  assert.equal(c.rows.find(x => x.bank.id === 'sc').lossRate, null);
  const stale = structuredClone(cibQuotes); stale.banks.cib.quotes.USD.asOf = '2026-01-01';
  assert.notEqual(M.purchaseComparison(currentRoute, D, stale).best.bank.id, 'cib');
  const hkd = M.purchaseComparison({ ...currentRoute, route: 'HKD' }, D, cibQuotes);
  close(hkd.best.sell, .853975);
  assert.deepEqual(M.purchaseComparison({ ...currentRoute, route: 'CNH' }, D, cibQuotes).rows, []);
});

test('CMB current personal RMB wire fee is present in the balance and ledger, never hidden as free', () => {
  const r = M.journeyPlans({ ...currentRoute, startBank: 'cmb', route: 'CNH', broker: 'hsbc', fxMode: 'bank' }, D, cibQuotes).selected;
  const sender = r.rows.find(x => x.key === 'sender');
  close(sender.cny, 100000 - (100000 - 100) / 1.001);
  close(r.steps.mainlandForeign, (100000 - 100) / 1.001);
  close(sender.items[0].cny + sender.items[1].cny, sender.cny);
  close(sender.items[1].cny, 100);
  close(M.fee(mainland('cmb'), 1000, 1, '2026-10-09'), 150);
  close(M.fee(mainland('cmb'), 1000000, 1, '2026-10-09'), 380);
  assert.ok(!r.missing.some(x => x.includes('招商银行') && x.includes('汇出')));
});

function moneyUi(input, quotes = cibQuotes, date = '2026-10-09', data = D, legacy = false) {
  const fs = require('node:fs'), vm = require('node:vm');
  // Existing test scenarios intentionally exercise unqualified accounts. Keep
  // those assumptions explicit; fresh and legacy defaults have their own tests.
  let saved = input == null || legacy ? input : { hsbcBalanceWaiver: false, cnHsbcFeeWaived: false,
    cnHangFeeWaived: false, cnScFeeWaived: false, consumptionVersion: 2, ...input, bankFeeDefaultsVersion: 1 }, modal = '';
  const context = { window: { MONEY_FLOW: data, MONEY_FLOW_QUOTES: quotes, ChanghengMoneyFlowModel: M },
    document: { querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => JSON.stringify(saved), setItem: (_, v) => { saved = JSON.parse(v); } },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date + 'T04:00:00Z'])); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/money-flow.js'), 'utf8'), context);
  const helpers = { esc: x => String(x ?? ''), money: (v, d) => Number(v).toFixed(d), head: () => '',
    action: (label, act, cls, extra) => '<button data-action="' + act + '" class="' + cls + '" ' + extra + '>' + label + '</button>',
    openModal: text => { modal = text; }, modalTitle: text => '<h2>' + text + '</h2>' };
  return { render: () => context.window.ChanghengMoneyFlow.view(helpers), saved: () => saved, modal: () => modal,
    check: (moneyCheck, checked) => context.window.ChanghengMoneyFlow.handleChange({ dataset: { moneyCheck }, checked }),
    act: (action, field, value) => context.window.ChanghengMoneyFlow.handleAction({ dataset: { action: 'money-flow-' + action, field, value } }) };
}

function moneyDetails(ui, key) { ui.act('detail', '', key); return ui.modal(); }

test('IBKR pricing choices persist through the actual picker handler without changing banks', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const ui = moneyUi({ ...currentRoute, broker: 'ibkr', startBank: 'cib', bank: 'hsbc', outcome: 'broker-balance', sellDate: '2026-10-12' }, quotes, '2026-10-12');
  ui.render(); ui.act('pick-choice', 'ibkrPricing', 'lite');
  const saved = ui.saved();
  assert.equal(saved.ibkrPricing, 'lite');
  assert.equal(saved.startBank, 'cib'); assert.equal(saved.bank, 'hsbc'); assert.equal(saved.broker, 'ibkr-lite');
  const r = M.calculatorJourney({ ...saved, date: '2026-10-12' }, D, quotes).selected;
  assert.ok(r.trading.orders.every(order => order.commission === 0));
  assert.match(ui.render(), /Lite · 合资格美国居民/);
  ui.act('pick-choice', 'ibkrPricing', 'invalid'); assert.equal(ui.saved().ibkrPricing, 'lite');
  ui.act('pick-choice', 'ibkrPricing', 'fixed'); assert.equal(ui.saved().ibkrPricing, 'fixed');
  assert.ok(M.calculatorJourney({ ...ui.saved(), date: '2026-10-12' }, D, quotes).selected.trading.orders.every(order => order.commission > 0));
});

test('fresh accounts default to management-fee waivers without enabling other offers or changing accounts', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const ui = moneyUi(null, quotes, '2026-10-12'); ui.render();
  const saved = ui.saved();
  assert.equal(saved.bankFeeDefaultsVersion, 1);
  for (const key of ['hsbcBalanceWaiver', 'cnHsbcFeeWaived', 'cnHangFeeWaived', 'cnScFeeWaived']) assert.equal(saved[key], true, key);
  for (const key of ['trade25', 'chiefMonthly', 'usmartPromo', 'zaLv2', 'scCnhAccount', 'icbcEAccount', 'icbcCnhAccount', 'hsbcChequeNonCounter', 'useVoucher']) assert.equal(saved[key], false, key);
  assert.equal(saved.startBank, 'boc'); assert.equal(saved.bank, 'bochk'); assert.equal(saved.broker, 'za');
  assert.equal(saved.budgetCny, '100000'); assert.equal(saved.count, '1'); assert.equal(saved.months, '12');
  const result = M.calculatorJourney({ ...saved, date: '2026-10-12' }, D, quotes).selected;
  close(result.refs.USD, (quotes.banks.boc.quotes.USD.buy + quotes.banks.boc.quotes.USD.sell) / 2);
  close(result.rows.find(row => row.key === 'entryFx').cny, 100000 - result.steps.mainlandForeign * result.refs.USD);
  close(result.costCny, result.budgetCny - result.netCny);
  close(result.rows.find(row => row.key === 'account').cny, 0);
});

test('old automatic management-fee assumptions migrate once while accounts, real fees and other qualifications survive', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const old = { ...currentRoute, startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc', broker: 'chief',
    budgetCny: '123456', count: '2', months: '24', hsbcBalanceWaiver: false, cnHsbcFeeWaived: false,
    cnHangFeeWaived: false, cnScFeeWaived: false, monthlyHkd: '3', inwardHkd: '7', startSell: '6.8',
    hsbcChequeNonCounter: false, scCnhAccount: false, icbcEAccount: true, useVoucher: true, voucherUsd: '2' };
  const ui = moneyUi(old, quotes, '2026-10-12', D, true); ui.render();
  const migrated = ui.saved();
  for (const key of ['hsbcBalanceWaiver', 'cnHsbcFeeWaived', 'cnHangFeeWaived', 'cnScFeeWaived']) assert.equal(migrated[key], true, key);
  for (const key of ['startBank', 'bank', 'returnBank', 'broker', 'budgetCny', 'count', 'months', 'monthlyHkd', 'inwardHkd',
    'startSell', 'hsbcChequeNonCounter', 'scCnhAccount', 'icbcEAccount', 'useVoucher', 'voucherUsd']) assert.equal(migrated[key], old[key], key);
  assert.equal(migrated.bankFeeDefaultsVersion, 1);
  const result = M.calculatorJourney({ ...migrated, date: '2026-10-12' }, D, quotes).selected;
  close(result.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc' && item.region === 'hong-kong').cny,
    3 * 24 * result.refs.HKD);
  ui.check('hsbcBalanceWaiver', false); ui.check('cnHangFeeWaived', false);
  const reloaded = moneyUi(ui.saved(), quotes, '2026-10-12', D, true); reloaded.render();
  assert.equal(reloaded.saved().hsbcBalanceWaiver, false); assert.equal(reloaded.saved().cnHangFeeWaived, false);
  assert.equal(reloaded.saved().cnHsbcFeeWaived, true); assert.equal(reloaded.saved().cnScFeeWaived, true);
  reloaded.act('reset');
  for (const key of ['hsbcBalanceWaiver', 'cnHsbcFeeWaived', 'cnHangFeeWaived', 'cnScFeeWaived']) assert.equal(reloaded.saved()[key], true, key);
  assert.equal(reloaded.saved().monthlyHkd, ''); assert.equal(reloaded.saved().inwardHkd, '');
});

test('actual-price details show relevant currencies and charges across every stock venue, entry currency and endpoint', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const broker of D.calculator.brokers) for (const route of ['USD', 'HKD', 'CNH'])
    for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
      const input = { ...currentRoute, startBank: 'boc', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc',
        broker, route, outcome, returnCurrency: 'HKD', fxMode: 'bank', hsbcBalanceWaiver: false };
      const ui = moneyUi(input, quotes, '2026-10-12'); ui.render(); ui.act('detail', '', 'adjustments');
      const html = ui.modal(), fields = new Set([...html.matchAll(/data-money-field="([^"]+)"/g)].map(match => match[1]));
      assert.equal(fields.has('startSell'), route !== 'CNH');
      assert.equal(fields.has('entryPrice'), route !== 'USD');
      assert.equal(fields.has('returnHkdPrice'), outcome === 'mainland');
      assert.equal(fields.has('exitPrice'), ['mainland', 'cnh-card'].includes(outcome));
      assert.equal(fields.has('inwardHkd'), outcome !== 'broker-balance');
      assert.equal(fields.has('intermediaryCny'), ['ibkr', 'ibkr-lite', 'firstrade', 'schwab'].includes(broker) && outcome !== 'broker-balance');
      assert.equal(fields.has('returnWireHkd'), outcome === 'mainland');
      assert.equal(fields.has('returnExtraCny'), outcome === 'mainland');
      for (const key of ['returnMonthlyHkd', 'returnBalanceHkd', 'balanceHkd']) assert.ok(!fields.has(key), key);
      if (route !== 'USD') assert.match(html, /中银香港每1USD购入价/);
      assert.match(html, /实际成交价/); assert.match(html, /恢复公开报价/);
    }
});

test('the actual-fee editor retains a separate bank fee only when that bank is used and hides internal settlement inputs', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const outcome of ['broker-balance', 'usd-balance', 'mainland']) {
    const ui = moneyUi({ ...currentRoute, broker: 'za', bank: 'za', returnBank: 'hsbc', depositMethod: 'internal',
      outcome, hsbcBalanceWaiver: false }, quotes, '2026-10-12');
    ui.render(); ui.act('detail', '', 'adjustments');
    const fields = new Set([...ui.modal().matchAll(/data-money-field="([^"]+)"/g)].map(match => match[1]));
    for (const key of ['depositHkd', 'depositOtherCny']) assert.ok(!fields.has(key), key);
    assert.equal(fields.has('returnMonthlyHkd'), outcome !== 'broker-balance');
    assert.equal(fields.has('returnBalanceHkd'), outcome !== 'broker-balance');
  }
});

test('an actual receipt does not mark a differently priced public recommendation as already applied', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', returnBank: 'bochk', broker: 'za',
    route: 'USD', outcome: 'broker-balance', hsbcBalanceWaiver: false }, quotes, '2026-10-12');
  const card = ui.render().match(/<button[^>]*data-action="money-flow-preset"[^>]*>/)[0];
  const id = 'boc-ibkr';
  ui.act('preset', '', id);
  const applied = ui.render();
  assert.equal([...applied.matchAll(/data-action="money-flow-preset"[^>]*aria-pressed="true"/g)].length, 1);
  const saved = ui.saved(), before = M.calculatorJourney({ ...saved, date: '2026-10-12' }, D, quotes).selected;
  const personal = moneyUi({ ...saved, depositOtherCny: '137' }, quotes, '2026-10-12');
  const actual = personal.render();
  assert.match(actual, /优选方案/);
  assert.equal([...actual.matchAll(/data-action="money-flow-preset"[^>]*aria-pressed="true"/g)].length, 0);
  const after = M.calculatorJourney({ ...saved, date: '2026-10-12', depositOtherCny: '137' }, D, quotes).selected;
  close(after.steps.fundedUsd, before.steps.fundedUsd - 137 / before.refs.USD);
  const settlementChange = after.rows.find(row => row.key === 'exitFx').cny - before.rows.find(row => row.key === 'exitFx').cny;
  close(after.costCny, before.costCny + 137 + (after.trading.totalUsd - before.trading.totalUsd) * before.refs.USD + settlementChange);
  personal.act('preset', '', id);
  assert.equal(personal.saved().depositOtherCny, '');
  assert.equal([...personal.render().matchAll(/data-action="money-flow-preset"[^>]*aria-pressed="true"/g)].length, 1);
  const restored = M.calculatorJourney({ ...personal.saved(), date: '2026-10-12' }, D, quotes).selected;
  close(restored.costCny, before.costCny); close(restored.net, before.net);
});

test('supported direct-payment settings preserve their channel and known opening costs survive missing source quotes', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const payment = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', returnBank: 'bochk', route: 'CNH',
    fxMode: 'bank', mainlandMethod: 'payment-connect', outcome: 'broker-balance', senderFeeCny: '0',
    entryMiddleCny: '137', entryInwardHkd: '0', depositHkd: '3', startSell: '6.6', entryPrice: '6.7' }, quotes, '2026-10-12');
  payment.render(); payment.act('detail', '', 'adjustments');
  assert.equal(payment.saved().mainlandMethod, 'payment-connect');
  assert.equal(payment.saved().senderFeeCny, '0'); assert.equal(payment.saved().entryInwardHkd, '0');
  assert.equal(payment.saved().bank, 'bochk'); assert.equal(payment.saved().broker, 'za');
  assert.equal(payment.saved().entryPrice, '6.7'); assert.equal(payment.saved().startSell, '6.6'); assert.equal(payment.saved().depositHkd, '3');
  assert.doesNotMatch(payment.modal(), /data-money-field="entryMiddleCny"/);
  assert.match(payment.modal(), /data-money-field="senderFeeCny"/);
  const unquoted = structuredClone(quotes); delete unquoted.banks.boc;
  const missing = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', returnBank: 'bochk', broker: 'za',
    route: 'USD', outcome: 'broker-balance', openingCny: '123' }, unquoted, '2026-10-12');
  const html = missing.render(); assert.match(html, /中国银行的USD现汇卖出价尚未取得/);
  assert.ok(M.calculatorJourney({ ...missing.saved(), date: '2026-10-12' }, D, unquoted).partial.rows.find(item => item.key === 'extra').cny >= 123);
  missing.act('detail', '', 'ledger'); assert.match(missing.modal(), /开户／赴港支出/); assert.match(missing.modal(), /123\.00 CNY/);
  assert.doesNotMatch(missing.modal(), /＝ .* CNY/);
});

test('cash-account AutoFX preserves original deposited cash and charges conversion at purchase', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const route of ['HKD', 'CNH']) for (const pricingBasis of ['best-quote', undefined]) for (const profitUsd of [0, 500, -500]) {
    const config = { ...currentRoute, date: '2026-10-12', startBank: 'boc', bank: 'bochk', broker: 'ibkr', route,
      fxMode: 'auto', entryPrice: route === 'HKD' ? 7.84 : 6.72, mainlandMethod: 'swift', depositMethod: 'fps',
      entryMiddleCny: 0, months: 0, outcome: 'broker-balance', pricingBasis, profitUsd };
    const r = M.journeyPlans(config, D, quotes).selected, ledger = M.flowLedger(r);
    assert.ok(r, route); assert.equal(ledger.stops[2].currency, route);
    close(ledger.stops[2].amount, r.steps.brokerOriginal);
    assert.equal(ledger.stops[2].indicative, false);
    for (const key of ['brokerFx', 'brokerSpread']) {
      assert.equal(r.rows.find(row => row.key === key).step, 'investment');
      assert.ok(!ledger.legs[1].rows.some(row => row.key === key));
      assert.ok(ledger.legs[2].rows.some(row => row.key === key));
    }
    const transferCosts = ['depositBank', 'depositOther', 'depositBroker'].reduce((sum, key) => sum + (r.rows.find(row => row.key === key)?.cny || 0), 0);
    close(ledger.legs[1].costCny, transferCosts);
    close(r.steps.brokerOriginal, r.steps.hongKong - transferCosts / r.refs[route]);
    close(r.brokerFx.usd + r.brokerFx.markupUsd, r.steps.brokerOriginal / r.entryPrice);
    close(ledger.legs.reduce((sum, leg) => sum + leg.costCny, 0), r.costCny);
    for (const leg of ledger.legs) close(leg.outputCny + leg.costCny + leg.taxCny, leg.inputCny + leg.profitCny + leg.fxImpactCny);
    close(r.netCny, r.budgetCny + profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);
    // Manual and bank conversions still finish before the displayed USD stop.
    for (const fxMode of ['manual', 'bank']) {
      const other = M.journeyPlans({ ...config, fxMode, depositMethod: fxMode === 'bank' ? 'chats' : 'fps' }, D, quotes).selected;
      const normal = M.flowLedger(other);
      assert.equal(normal.stops[2].currency, 'USD'); close(normal.stops[2].amount, other.steps.fundedUsd);
      assert.ok(normal.legs[1].rows.some(row => row.key === 'brokerFx'));
      assert.ok(!normal.legs[2].rows.some(row => row.key === 'brokerFx'));
    }
  }
});

test('missing AutoFX execution prices do not erase original IBKR cash or move missing evidence into funding', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const route of ['HKD', 'CNH']) {
    const config = { ...currentRoute, date: '2026-10-12', startBank: 'boc', bank: 'bochk', broker: 'ibkr', route,
      fxMode: 'auto', entryPrice: '', mainlandMethod: 'swift', depositMethod: 'fps', entryMiddleCny: 0,
      months: 0, outcome: 'broker-balance' };
    const r = M.calculatorJourney(config, D, quotes).selected, ledger = M.flowLedger(r);
    assert.ok(r.indicativeFx); assert.equal(ledger.stops[2].currency, route);
    assert.equal(ledger.stops[2].indicative, false); assert.equal(ledger.legs[1].indicative, false);
    assert.equal(ledger.stops[3].indicative, true); assert.equal(ledger.legs[2].indicative, true);
    assert.ok(!ledger.legs[1].missing.some(label => /IBKR.*\/USD/.test(label)));
    assert.ok(ledger.legs[2].missing.some(label => /IBKR.*\/USD/.test(label)));
    const ui = moneyUi(config, quotes, config.date), html = ui.render();
    const funded = html.split('data-flow-stage="03"')[1].split('</section>')[0];
    assert.match(funded, /入金到账/);
    assert.match(funded, new RegExp(r.steps.brokerOriginal.toFixed(2) + ' <small>' + route + '<'));
    const funding = html.split('aria-label="' + route + '原币转入IBKR"')[1].split('</section>')[0];
    const trade = html.split('aria-label="买入时自动换美元 → 买入美股 → 卖出"')[1].split('</section>')[0];
    assert.doesNotMatch(funding, /实时成交点差|自动换USD加价/);
    assert.match(moneyDetails(ui, 'edge-trade'), /实时成交点差/); assert.match(ui.modal(), /买入时自动换USD加价/);
    assert.match(html, /IBKR现金账户自动换汇/);
    const terminal = html.split('data-flow-stage="04"')[1].split('</section>')[0];
    assert.match(terminal, /参考最终余额/);
    assert.match(terminal, new RegExp(r.net.toFixed(2) + ' <small>USD'));
    assert.doesNotMatch(terminal, /美元留在账户/);
    const depositLinks = evidenceLinks(ui, 'edge-03');
    assert.ok(depositLinks.has(D.sources['ibFunding' + route].url));
    assert.ok(!depositLinks.has(D.sources.ibFx.url));
    assert.doesNotMatch(ui.modal(), /自动换USD加价/);
    const purchaseLinks = evidenceLinks(ui, 'edge-trade');
    assert.ok(purchaseLinks.has(D.sources.ibFx.url)); assert.ok(purchaseLinks.has(D.sources.ibAutoFxTerms.url));
    assert.match(ui.modal(), /买入时自动换USD加价/);
    for (const leg of ledger.legs) close(leg.outputCny + leg.costCny + leg.taxCny, leg.inputCny + leg.profitCny + leg.fxImpactCny);
  }
});

test('actual AutoFX execution prices include the markup once and keep manual commissions separate', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  // These effective prices are synthetic receipt examples, not current market quotes.
  for (const route of ['HKD', 'CNH']) for (const pricingBasis of ['best-quote', undefined]) for (const budgetCny of [5000, 100000, 1500000]) {
    const config = { ...currentRoute, date: '2026-10-12', budgetCny, startBank: 'boc', bank: 'bochk', broker: 'ibkr', route,
      fxMode: 'auto', entryPrice: route === 'HKD' ? 8 : 6.72, mainlandMethod: 'swift', depositMethod: 'fps',
      entryMiddleCny: 0, months: 0, outcome: 'broker-balance', pricingBasis };
    const r = M.calculatorJourney(config, D, quotes).selected, ledger = M.flowLedger(r);
    const original = r.steps.brokerOriginal, actualGrossUsd = original / config.entryPrice;
    close(r.steps.fundedUsd, actualGrossUsd); close(r.brokerFx.usd, actualGrossUsd);
    close(r.brokerFx.markupUsd, 0); close(r.brokerFx.commissionUsd, 0);
    assert.equal(r.brokerFx.priceIncludesAutoMarkup, true);
    close(r.rows.find(row => row.key === 'brokerFx').cny, 0);
    assert.match(r.rows.find(row => row.key === 'brokerSpread').label, /含自动加价/);
    assert.equal(r.indicativeFx, ''); close(ledger.stops[2].amount, original);
    for (const leg of ledger.legs) close(leg.outputCny + leg.costCny + leg.taxCny, leg.inputCny + leg.profitCny + leg.fxImpactCny);
    close(ledger.legs.reduce((sum, leg) => sum + leg.costCny, 0), r.costCny);
    close(r.netCny, r.budgetCny + config.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);

    const estimate = M.calculatorJourney({ ...config, entryPrice: '' }, D, quotes).selected;
    assert.ok(estimate.indicativeFx); assert.ok(estimate.brokerFx.markupUsd > 0);
    close(estimate.brokerFx.usd, estimate.steps.brokerOriginal / estimate.entryPrice / 1.0003);
    assert.notEqual(estimate.brokerFx.priceIncludesAutoMarkup, true);
    for (const mode of ['manual', 'bank']) {
      const other = M.calculatorJourney({ ...config, fxMode: mode, depositMethod: mode === 'bank' ? 'chats' : 'fps' }, D, quotes).selected;
      const gross = (mode === 'bank' ? other.steps.hongKong : other.steps.brokerOriginal) / other.entryPrice;
      close(other.brokerFx.usd + other.brokerFx.commissionUsd, gross);
      close(other.brokerFx.markupUsd, 0); assert.notEqual(other.brokerFx.priceIncludesAutoMarkup, true);
      close(other.brokerFx.commissionUsd, mode === 'manual' ? Math.max(2, other.brokerFx.usd * D.broker.manualRate) : 0);
    }
    const ui = moneyUi(config, quotes, config.date), html = ui.render();
    const trade = html.split('aria-label="买入时自动换美元 → 买入美股 → 卖出"')[1].split('</section>')[0];
    assert.match(trade, /已含自动加价/);
    const detail = moneyDetails(ui, 'edge-trade');
    assert.match(detail, /自动换汇无单独佣金/);
    assert.match(detail, /买入换汇差额（含自动加价）/);
    assert.doesNotMatch(trade, /买入时自动换USD加价|按参考汇率估算/);
    ui.act('detail', '', 'adjustments');
    assert.match(ui.modal(), /IBKR每1USD成交价（含自动加价）/);
  }
});

test('return currency remains in its real action, with two exchange amounts and independent account choices', () => {
  const input = { ...currentRoute, budgetCny: 5000, count: 1, months: 0, broker: 'za', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc',
    outcome: 'mainland', returnCurrency: 'HKD', returnMethod: 'bochk-fast', returnHkdPrice: '', exitPrice: '' };
  const ui = moneyUi(input, require('./fixtures/money-flow-quotes-20261011.json'), '2026-10-12');
  const html = ui.render();
  assert.ok(html.indexOf('aria-label="美元换港币"') < html.indexOf('aria-label="汇回内地"'));
  assert.ok(html.indexOf('aria-label="汇回内地"') < html.indexOf('aria-label="内地结汇"'));
  assert.match(html, /aria-label="回款币种"/);
  assert.match(html, /1 HKD = /);
  const detail = moneyDetails(ui, 'edge-return-fx');
  assert.match(detail, /USD → .* HKD/);
  assert.match(detail, /USD → HKD换汇差额/);
  const settlement = moneyDetails(ui, 'edge-settle');
  assert.match(settlement, /HKD → .* CNY/);
  assert.doesNotMatch(settlement, /USD → HKD换汇差额|香港→内地汇出费/);
  ui.act('choose', 'returnCurrency', 'USD');
  assert.equal(ui.saved().returnCurrency, 'USD');
  assert.equal(ui.saved().returnHkdPrice, '');
  assert.equal(ui.saved().exitPrice, '');
  for (const key of ['startBank', 'bank', 'broker', 'returnBank', 'exitBank', 'budgetCny', 'count']) assert.equal(ui.saved()[key], input[key], key);
  assert.match(ui.render(), /aria-label="汇回内地"/);
  assert.match(ui.render(), /aria-label="内地结汇"/);
  assert.doesNotMatch(ui.render(), /aria-label="美元换港币"/);
  ui.act('choose', 'returnCurrency', 'HKD');
  const restored = moneyUi(ui.saved(), require('./fixtures/money-flow-quotes-20261011.json'), '2026-10-12');
  assert.match(restored.render(), /aria-label="美元换港币"/);
});

test('missing return HKD price keeps USD and missing mainland HKD price keeps actual HKD', () => {
  const q = structuredClone(require('./fixtures/money-flow-quotes-20261011.json'));
  const input = { ...currentRoute, broker: 'za', bank: 'bochk', returnBank: 'sc', exitBank: 'boc', outcome: 'mainland', returnCurrency: 'HKD', returnMethod: 'swift', months: 0 };
  const ui = moneyUi(input, q, '2026-10-12');
  const r = M.calculatorJourney(input, D, q).selected;
  assert.match(ui.render(), new RegExp('最后可计余额 · [^<]*.*?' + r.steps.returnUsd.toFixed(2) + '\\s*<small>USD', 's'));
  assert.doesNotMatch(ui.render(), /全程损耗 · 历史报价/);
  delete q.banks.cib.quotes.HKD;
  const other = { ...input, returnBank: 'bochk', exitBank: 'cib', returnMethod: 'swift' };
  const actual = M.calculatorJourney(other, D, q).selected;
  assert.match(moneyUi(other, q, '2026-10-12').render(), new RegExp('最后可计余额 · [^<]*.*?' + actual.steps.remitHkd.toFixed(2) + '\\s*<small>HKD', 's'));
});

test('mainland return picker shows the same currency, discount expiry and actual execution price as settlement', () => {
  const q = require('./fixtures/money-flow-quotes-20261011.json');
  const base = { ...currentRoute, broker: 'za', bank: 'bochk', returnBank: 'bochk', exitBank: 'cib', outcome: 'mainland', returnCurrency: 'HKD', returnMethod: 'swift' };
  for (const changes of [{ months: 1 }, { months: 12 }, { months: 12, exitPrice: .82 }, { months: 1, returnCurrency: 'USD' }]) {
    const input = { ...base, ...changes }, ui = moneyUi(input, q, '2026-10-12'); ui.render(); ui.act('pick', '', 'exitBank');
    const r = M.calculatorJourney({ ...ui.saved(), date: '2026-10-12', sellDate: '2026-10-12' }, D, q).selected;
    const option = ui.modal().match(/data-field="exitBank" data-value="cib"[^>]*>(.*?)<\/button>/s)?.[1];
    assert.ok(option);
    assert.ok(option.includes('<b>' + String(Number(r.exitPrice.toFixed(8))) + '</b>'), option);
    assert.ok(option.includes('CNY/' + input.returnCurrency), option);
    assert.ok(option.includes('境外' + input.returnCurrency + '汇入'), option);
    if (input.returnCurrency === 'HKD') assert.doesNotMatch(option, /USD/);
    assert.equal(option.includes('实际成交'), !!changes.exitPrice);
  }
});

test('a service channel is offered only for its evidenced bank, currency and current date; expiry preserves account choices', () => {
  const data = structuredClone(D), quotes = require('./fixtures/money-flow-quotes-20261011.json');
  data.entryServiceRoutes = [{ startBank: 'cib', bank: 'hsbc', method: 'cib-go', currencies: ['USD'],
    validFrom: '2026-10-12', validUntil: '2026-10-12', sources: ['test-only-reachability'] }];
  const input = { ...currentRoute, startBank: 'cib', bank: 'hsbc', broker: 'usmart', count: 2,
    mainlandMethod: 'cib-go', depositMethod: 'internal', route: 'USD', outcome: 'broker-balance' };
  const active = moneyUi(input, quotes, '2026-10-12', data); active.render();
  assert.equal(active.saved().mainlandMethod, 'cib-go');
  active.act('control-pick', '', 'mainlandMethod'); assert.match(active.modal(), /data-value="cib-go"/);
  active.act('choose', 'broker', 'chief'); assert.equal(active.saved().mainlandMethod, 'cib-go');
  active.act('choose', 'bank', 'bochk'); assert.equal(active.saved().mainlandMethod, 'swift');
  assert.equal(active.saved().broker, 'chief'); assert.equal(active.saved().count, 2);
  active.act('choose', 'mainlandMethod', 'cib-go'); assert.equal(active.saved().mainlandMethod, 'swift');
  for (const date of ['2026-10-11', '2026-10-13']) {
    const expired = moneyUi(input, quotes, date, data); const html = expired.render();
    assert.equal(expired.saved().mainlandMethod, 'swift'); assert.equal(expired.saved().bank, 'hsbc');
    assert.equal(expired.saved().broker, 'usmart'); assert.equal(expired.saved().count, 2);
    assert.doesNotMatch(html, /小额全额到账|SWIFT GO/);
  }
});

test('ICBC Asia selection, qualification, same-bank funding and return channel remain independent across broker switches and reloads', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, startBank: 'icbc', bank: 'icbc-asia', broker: 'usmart', route: 'USD',
    mainlandMethod: '', depositMethod: '', returnMethod: '', returnBank: 'icbc-asia', exitBank: 'icbc', outcome: 'broker-balance',
    icbcEAccount: false }, quotes, '2026-10-12');
  let html = ui.render();
  ui.act('choose', 'bank', 'bochk'); ui.act('choose', 'bank', 'icbc-asia'); html = ui.render();
  assert.equal(ui.saved().mainlandMethod, 'icbc-mobile'); assert.equal(ui.saved().depositMethod, 'internal');
  assert.equal((html.match(/data-money-check="icbcEAccount"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-money-check="icbcCnhAccount"/);
  ui.act('pick', '', 'bank');
  assert.equal((ui.modal().match(/data-field="bank"/g) || []).length, 6);
  assert.match(pickerOption(ui.modal(), 'bank', 'icbc-asia'), /USD汇入费：60\.00 HKD/); assert.doesNotMatch(ui.modal(), /undefined|NaN/);
  ui.check('icbcEAccount', true);
  ui.act('pick', '', 'bank');
  assert.match(pickerOption(ui.modal(), 'bank', 'icbc-asia'), /USD汇入费：0\.00 HKD/);
  for (const broker of D.calculator.brokers) {
    ui.act('choose', 'broker', broker); html = ui.render();
    assert.equal(ui.saved().bank, 'icbc-asia'); assert.equal(ui.saved().icbcEAccount, true);
    assert.match(html, /data-money-check="icbcEAccount"/);
    ui.act('pick', '', 'broker'); assert.equal((ui.modal().match(/data-field="broker"/g) || []).length, D.calculator.brokers.length);
  }
  ui.act('choose', 'broker', 'usmart'); ui.act('choose', 'outcome', 'mainland');
  assert.equal(ui.saved().returnMethod, 'icbc-express');
  for (const stage of ['edge-01', 'edge-03', 'edge-04', 'bank-settings']) {
    ui.act('detail', '', stage);
    assert.ok(ui.modal().includes(D.sources.icbcAsiaInward.url) || stage === 'bank-settings');
    assert.doesNotMatch(ui.modal(), /undefined|NaN/);
  }
  const restored = moneyUi(ui.saved(), quotes, '2026-10-12'); restored.render();
  for (const key of ['bank', 'broker', 'mainlandMethod', 'depositMethod', 'returnMethod', 'icbcEAccount']) assert.equal(restored.saved()[key], ui.saved()[key]);
  restored.act('choose', 'bank', 'bochk'); html = restored.render();
  assert.equal(restored.saved().broker, 'usmart'); assert.equal(restored.saved().icbcEAccount, true);
  restored.act('choose', 'outcome', 'broker-balance'); html = restored.render();
  assert.doesNotMatch(html, /data-money-check="icbcEAccount"/);
});

test('ICBC Asia RMB identity controls belong to receipt or consumption, and do not add SC cheque discounts', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'icbc-asia', broker: 'usmart', route: 'CNH',
    returnBank: 'icbc-asia', outcome: 'broker-balance', icbcCnhAccount: false }, quotes, '2026-10-12');
  let html = ui.render();
  assert.equal((html.match(/data-money-check="icbcCnhAccount"/g) || []).length, 1);
  assert.match(html, /人民币储蓄账户须持香港身份证/);
  assert.match(html, /100000.00/); assert.match(html, /第02步尚未完成/);
  assert.equal((html.match(/class="flow-error"/g) || []).length, 1);
  ui.check('icbcCnhAccount', true); ui.act('choose', 'route', 'USD');
  ui.act('choose', 'outcome', 'cnh-card'); html = ui.render();
  assert.equal((html.match(/data-money-check="icbcCnhAccount"/g) || []).length, 0);
  ui.act('choose', 'cardMode', 'cnh'); html = ui.render();
  assert.equal((html.match(/data-money-check="icbcCnhAccount"/g) || []).length, 1);
  ui.act('detail', '', 'edge-04'); assert.ok(ui.modal().includes(D.sources.icbcAsiaCard.url));
  ui.act('choose', 'outcome', 'usd-balance');
  const cheques = moneyUi({ ...ui.saved(), chequeIndex: 31 }, quotes, '2026-10-12'); cheques.render(); cheques.act('detail', '', 'profit-settings');
  assert.match(cheques.modal(), /每日前30张免费/); assert.match(cheques.modal(), /2 HKD/);
  assert.doesNotMatch(cheques.modal(), /data-money-check="chequePreFilled"/);
});

test('the default round trip returns to the starting BOC account without adding an unrelated mainland management fee', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi(null, quotes, '2026-10-12');
  ui.render();
  ui.act('choose', 'outcome', 'mainland');
  assert.equal(ui.saved().startBank, 'boc');
  assert.equal(ui.saved().exitBank, 'boc');
  assert.equal(ui.saved().returnMethod, 'bochk-fast');
  assert.equal(ui.saved().budgetCny, '100000');
  assert.equal(ui.saved().count, '1');
  const r = M.calculatorJourney({ ...ui.saved(), date: '2026-10-12' }, D, quotes).selected;
  close(r.rows.find(x => x.key === 'account').cny, 0);
  close(r.rows.find(x => x.key === 'returnWire').cny, 0);
  assert.equal(r.rows.find(x => x.key === 'returnOther').cny, null); // Do not invent an intermediary waiver.
  assert.doesNotMatch(ui.render(), /汇丰中国 · 卓越理财期间管理费/);
  assert.match(ui.render(), /总损耗尚缺：回内地中转行费<\/small>/);
  assert.doesNotMatch(ui.render(), /总损耗尚缺：回内地中转／收款费/);

  const existing = moneyUi({ ...ui.saved(), exitBank: 'hsbc', cnHsbcFeeWaived: false }, quotes, '2026-10-12');
  existing.render();
  existing.act('choose', 'outcome', 'broker-balance');
  existing.act('choose', 'outcome', 'mainland');
  assert.equal(existing.saved().exitBank, 'boc');
  assert.doesNotMatch(existing.render(), /汇丰中国 · 卓越理财期间管理费/);
  existing.act('reset');
  assert.equal(existing.saved().exitBank, 'boc');
});

test('an unquoted retained settlement bank identifies the missing bid once without marking its free receipt as unknown', () => {
  const quotes = structuredClone(require('./fixtures/money-flow-quotes-20261011.json'));
  delete quotes.banks.cib.quotes.USD;
  const ui = moneyUi({ outcome: 'mainland', exitBank: 'cib' }, quotes, '2026-10-12');
  ui.render();
  ui.act('choose', 'exitBank', 'cib');
  const r = M.calculatorJourney({ ...ui.saved(), date: '2026-10-12' }, D, quotes).selected;
  assert.equal(r.indicativeExit, true);
  const receipt = r.rows.find(row => row.key === 'returnOther').items.find(item => item.label === '兴业 · 寰宇人生USD收款费');
  close(receipt.cny, 0);
  assert.equal(r.missing.filter(label => label === r.exitIssue).length, 1);
  assert.ok(!r.missing.includes('内地结汇差额'));
  assert.ok(!r.missing.includes(receipt.label));
  assert.match(ui.render(), /总损耗尚缺：回内地中转行费、兴业 · 寰宇人生USD现汇买入价尚未取得/);
  assert.doesNotMatch(ui.render(), /总损耗尚缺：[^<]*内地结汇差额/);
});

test('saved SC local USD wires migrate to its published clearing channel without replacing accounts or conditions', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const broker of ['chief', 'usmart']) for (const route of ['USD', 'HKD', 'CNH']) {
    const input = { ...currentRoute, startBank: 'boc', bank: 'sc', broker, route, fxMode: 'bank', depositMethod: 'swift',
      returnBank: 'bochk', exitBank: 'cmb', count: '3', months: '5', zaPerksLevel: 'lv1', zaSwiftUsed: '2',
      depositHkd: '50', depositOtherCny: '8', startSell: '', entryPrice: '', outcome: 'broker-balance' };
    const ui = moneyUi(input, quotes, '2026-10-11');
    const html = ui.render();
    ui.act('choose', 'bank', 'sc');
    assert.equal(ui.saved().depositMethod, 'chats');
    assert.equal(ui.saved().depositHkd, ''); assert.equal(ui.saved().depositOtherCny, '');
    for (const key of ['startBank', 'bank', 'broker', 'route', 'returnBank', 'exitBank', 'count', 'months', 'zaPerksLevel', 'zaSwiftUsed']) assert.equal(ui.saved()[key], input[key]);
    assert.match(moneyDetails(ui, 'edge-03'), /22.00 USD/);
    ui.act('pick', '', 'depositMethod');
    assert.doesNotMatch(ui.modal(), /data-value="swift"/);
    assert.match(ui.modal(), /data-value="chats"/);
    for (const field of ['bank', 'broker', 'returnBank']) {
      ui.act('pick', '', field);
      assert.equal((ui.modal().match(new RegExp('data-field="' + field + '"', 'g')) || []).length, field === 'broker' ? D.calculator.brokers.length : field === 'returnBank' ? 7 : 6);
    }
    const restored = moneyUi(ui.saved(), quotes, '2026-10-11'); restored.render();
    assert.equal(restored.saved().depositMethod, 'chats');
    restored.act('choose', 'bank', 'hang');
    restored.render();
    restored.act('pick', '', 'depositMethod');
    assert.match(restored.modal(), /data-value="swift"/);
    assert.equal(restored.saved().broker, broker);
  }
  const overseas = moneyUi({ ...currentRoute, bank: 'sc', broker: 'ibkr', route: 'USD', depositMethod: 'swift', depositHkd: '9' }, quotes, '2026-10-11');
  overseas.render(); assert.equal(overseas.saved().depositMethod, 'swift'); assert.equal(overseas.saved().depositHkd, '9');
});

test('direct corporate CHATS choices name their receiving bank and retain independent account and personal-bridge choices', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const evidence = require('./fixtures/money-flow-corporate-chats-20261012.json');
  for (const broker of ['chief', 'usmart']) for (const bank of D.calculator.hkBanks) {
    const input = { ...currentRoute, startBank: 'boc', bank, broker, route: 'USD', fxMode: 'bank', depositMethod: 'chats',
      outcome: 'broker-balance', entryMiddleCny: '0', depositHkd: '', depositOtherCny: '', months: '7', count: '2' };
    const ui = moneyUi(input, quotes, '2026-10-11'); ui.render(); ui.act('pick', '', 'depositMethod');
    const methods = M.calculatorChannels(input, D).depositMethods.filter(id => id === 'chats' || id.startsWith('chats-'));
    const recipientNames = { bochk: '中银香港', hsbc: '汇丰香港', hang: '恒生香港', 'icbc-asia': '工银亚洲', citic: '中信国际' };
    for (const method of methods) {
      const target = M.calculatorDepositBank({ ...input, depositMethod: method }, D);
      assert.match(ui.modal(), new RegExp('CHATS → 券商的' + recipientNames[target.id] + '收款账户'));
      ui.act('choose', 'depositMethod', method); const html = ui.render();
      assert.equal(ui.saved().depositMethod, method);
      for (const key of ['startBank', 'bank', 'broker', 'months', 'count']) assert.equal(ui.saved()[key], input[key]);
      const funding = html.split('aria-label="转入买股账户"')[1].split('</section>')[0];
      const detail = moneyDetails(ui, 'edge-03');
      assert.match(detail, /券商企业账户CHATS收款/);
      assert.ok(detail.includes(evidence.tariffs[target.id].feeHkd.toFixed(2) + ' HKD'));
      assert.doesNotMatch(funding, /undefined|NaN|此汇路代理／收款行收费未公开/);
      ui.act('detail', '', '03'); assert.match(ui.modal(), new RegExp(D.sources[target.corporateLocalUsdInward.sources[0]].url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      const restored = moneyUi(ui.saved(), quotes, '2026-10-11'); restored.render();
      assert.equal(restored.saved().depositMethod, method);
      ui.act('pick', '', 'depositMethod');
    }
    for (const field of ['bank', 'broker', 'returnBank']) { ui.act('pick', '', field); assert.equal((ui.modal().match(new RegExp('data-field="' + field + '"', 'g')) || []).length, field === 'broker' ? D.calculator.brokers.length : field === 'returnBank' ? 7 : 6); }
    ui.act('pick', '', 'depositMethod');
    assert.match(ui.modal(), /经本人.*USD账户 → 同行入金/);
  }
});

test('ZA membership appears with its actual account role and survives every broker switch and reload', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', mainlandMethod: '', broker: 'za', outcome: 'broker-balance', zaLv2: true }, quotes, '2026-10-11');
  let html = ui.render();
  const bankNode = html.match(/<section class="flow-node" data-flow-stage="02"[\s\S]*?<\/section>/)[0];
  const stockNode = html.match(/<section class="flow-node" data-flow-stage="03"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(bankNode, /zaPerksLevel/); assert.match(stockNode, /ZA交易权益/); assert.match(stockNode, /ZA Perks · Lv2/);
  assert.doesNotMatch(html, /data-money-check="zaLv2"/);
  ui.act('choose', 'broker', 'za');
  assert.equal(ui.saved().zaPerksLevel, 'lv2');
  for (const zaPerksLevel of ['standard', 'lv1', 'lv2']) {
    ui.act('choose', 'zaPerksLevel', zaPerksLevel);
    for (const broker of D.calculator.brokers) {
      ui.act('choose', 'broker', broker); html = ui.render();
      assert.equal(ui.saved().zaPerksLevel, zaPerksLevel); assert.equal(ui.saved().zaLv2, zaPerksLevel === 'lv2');
      assert.equal(ui.saved().bank, 'bochk');
      ui.act('pick', '', 'broker'); assert.equal((ui.modal().match(/data-field="broker"/g) || []).length, D.calculator.brokers.length);
      ui.act('pick', '', 'bank'); assert.equal((ui.modal().match(/data-field="bank"/g) || []).length, 6);
    }
    const restored = moneyUi(ui.saved(), quotes, '2026-10-11');
    restored.render(); restored.act('choose', 'broker', 'za');
    assert.equal(restored.saved().zaPerksLevel, zaPerksLevel);
    assert.match(restored.render(), new RegExp('ZA Perks · ' + (zaPerksLevel === 'standard' ? '标准' : zaPerksLevel === 'lv1' ? 'Lv1' : 'Lv2')));
  }
  ui.act('choose', 'broker', 'za'); ui.render(); ui.act('detail', '', 'offers');
  assert.match(ui.modal(), /ZA交易权益/); assert.match(ui.modal(), /ZA Perks · Lv2/);
  assert.doesNotMatch(ui.modal(), /SWIFT|海外汇款笔数/);
  ui.act('detail', '', 'bank-settings');
  assert.match(ui.modal(), /2026年11月1日起，海外SWIFT本行费70 HKD/);
  assert.match(ui.modal(), /ZA银行权益/);
});

test('ZA Swift quota is edited and validated at its bank while local instructions keep their own fee and source', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const input = { ...currentRoute, startBank: 'boc', bank: 'za', broker: 'ibkr', returnBank: 'za', exitBank: 'boc', outcome: 'mainland',
    route: 'USD', mainlandMethod: 'boc-online', depositMethod: 'swift', returnMethod: 'swift', months: 1, zaPerksLevel: 'lv1', zaSwiftUsed: 2 };
  const ui = moneyUi(input, quotes, '2026-11-01');
  let html = ui.render();
  assert.match(moneyDetails(ui, 'edge-03'), /ZA Perks Lv1 · 当月第3笔 · 本行手续费豁免/);
  assert.match(moneyDetails(ui, 'edge-04'), /海外SWIFT · 本行手续费70 HKD · 当月第4笔/);
  ui.act('detail', '', 'bank-settings'); assert.match(ui.modal(), /每个汇款月其他已用海外汇款笔数/);
  assert.ok(evidenceLinks(ui, 'edge-03').has(D.sources.zaPerksNov.url));
  assert.ok(evidenceLinks(ui, 'edge-04').has(D.sources.zaTariff.url));
  for (const zaSwiftUsed of [-1, 1.5, 'bad']) {
    const invalid = moneyUi({ ...input, zaSwiftUsed }, quotes, '2026-11-01');
    invalid.render(); invalid.act('detail', '', 'bank-settings');
    assert.match(invalid.modal(), /aria-invalid="true"/); assert.match(invalid.modal(), /须为非负整数/);
  }
  ui.act('choose', 'broker', 'usmart'); ui.act('choose', 'depositMethod', 'swift'); html = ui.render();
  assert.match(html, /香港收款账户 · USD SWIFT/);
  assert.match(moneyDetails(ui, 'edge-03'), /香港本地SWIFT · 本行手续费0/);
  const updated = M.calculatorJourney({ ...ui.saved(), date: '2026-11-01' }, D, quotes).selected;
  assert.equal(updated.rows.find(row => row.key === 'depositBank').swiftTariff.destination, 'hong-kong');
  assert.equal(updated.rows.find(row => row.key === 'returnWire').swiftTariff.monthlyIndex, 3);
  assert.equal(ui.saved().zaPerksLevel, 'lv1'); assert.equal(ui.saved().zaSwiftUsed, 2);
});

test('ZA standard debits and later refunds are readable beside each trade and the same basis labels the summary and route cards', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const input = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', mainlandMethod: 'boc-mobile',
    route: 'USD', outcome: 'broker-balance', budgetCny: '7000', entryMiddleCny: '0', months: 1, zaPerksLevel: 'lv2', usedPromoOrders: 4 };
  const ui = moneyUi(input, quotes, '2026-10-11');
  const html = ui.render();
  const r = M.calculatorJourney({ ...ui.saved(), date: '2026-10-11' }, D, quotes).selected;
  const buys = r.trading.orders.filter(order => order.kind === 'buy');
  const detail = moneyDetails(ui, 'edge-trade');
  assert.match(detail, new RegExp('先扣 ' + buys[0].debitFeeUsd.toFixed(2) + ' USD，5个工作日内返还 1.00 USD'));
  assert.match(detail, /返还后 0.99 USD/); assert.match(html, /全程损耗 · 返还后/);
  assert.match(html, /优惠返还后 · 最终余额/);
  assert.ok(evidenceLinks(ui, 'offers').has(D.sources.zaPerks.url));
  const before = ui.saved(); ui.act('choose', 'zaPerksLevel', 'standard');
  assert.doesNotMatch(ui.render(), /5个工作日内返还|优惠返还后|损耗 · 返还后/);
  assert.equal(ui.saved().bank, before.bank); assert.equal(ui.saved().broker, before.broker);
  const invalid = moneyUi({ ...input, budgetCny: '100.99', startSell: '1', usdCny: '1', senderFeeCny: '0', entryMiddleCny: '0', entryInwardHkd: '0' }, quotes, '2026-10-11');
  assert.match(invalid.render(), /余额不足.*买入/);
  invalid.act('detail', '', 'budget'); assert.match(invalid.modal(), /aria-invalid="true"/);
});

test('CIB expiry keeps standard fees visible and removes only the inactive quota control', () => {
  const input = { ...currentRoute, startBank: 'cib', bank: 'hsbc', broker: 'za', route: 'USD',
    outcome: 'broker-balance', months: 0, count: 1, mainlandMethod: 'swift', depositMethod: 'chats',
    date: '2027-07-01', startSell: 6.75, usdCny: 6.75, usdHkd: 7.8, usdCnh: 7.1, usedFreeTransfers: 'inactive-invalid' };
  const ui = moneyUi(input, cibQuotes, input.date), html = ui.render();
  const r = M.calculatorJourney(ui.saved(), D, cibQuotes).selected;
  assert.ok(r); close(r.rows.find(item => item.key === 'sender').cny, 100000 - 99900 / 1.001);
  assert.match(html, /99.80 CNY/); assert.match(html, /100.00 CNY/);
  ui.act('detail', '', 'edge-01');
  assert.match(ui.modal(), /手续费按标准1‰、50–200元，电讯费100元\/笔/);
  assert.doesNotMatch(ui.modal(), /data-money-field="usedFreeTransfers"|前30笔/);
  ui.act('pick', '', 'startBank'); assert.match(ui.modal(), /外汇优惠已到期；按标准1‰、50–200元＋100元电讯费/);
  assert.equal((ui.modal().match(/data-field="startBank"/g) || []).length, 4);
  assert.equal(ui.saved().bank, 'hsbc'); assert.equal(ui.saved().broker, 'za');
});

test('personal-bank funding keeps the receiving bank and broker independent and names the intermediate receipt on the same screen', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const input = { ...currentRoute, date: '2026-10-11', startBank: 'boc', entryMiddleCny: 0, bank: 'hang', broker: 'usmart',
    outcome: 'broker-balance', route: 'USD', mainlandMethod: '', depositMethod: 'chats' };
  const ui = moneyUi(input, quotes, input.date); ui.render();
  ui.act('pick', '', 'depositMethod');
  assert.match(ui.modal(), /经本人中银香港 USD账户 → 同行入金/);
  assert.match(ui.modal(), /经本人汇丰香港 USD账户 → 同行入金/);
  ui.act('choose', 'depositMethod', 'via-bochk');
  const saved = ui.saved(), r = M.calculatorJourney({ ...saved, date: input.date }, D, quotes).selected, html = ui.render();
  assert.equal(saved.bank, 'hang'); assert.equal(saved.broker, 'usmart');
  assert.match(html, /经本人中银香港 → 同行入金/);
  assert.match(html, new RegExp('本人中银香港到账 ' + r.steps.fundingBankUsd.toFixed(2) + ' USD'));
  assert.match(moneyDetails(ui, 'edge-03'), /恒生 · 优进理财 → 本人中银香港 · CHATS/);
  assert.match(moneyDetails(ui, 'edge-03'), /本人中银香港 → 盈立 · 个人标准账户 · 同行入金/);
  assert.ok(evidenceLinks(ui, 'edge-03').has(D.sources.bochk.url));
  assert.ok(evidenceLinks(ui, 'edge-03').has(D.sources.usmartSameFunding.url));
  const restored = moneyUi(saved, quotes, input.date); restored.render();
  assert.equal(restored.saved().depositMethod, 'via-bochk');
  for (const field of ['bank', 'broker']) {
    restored.act('pick', '', field);
    assert.equal((restored.modal().match(new RegExp('data-field="' + field + '"', 'g')) || []).length, field === 'broker' ? D.calculator.brokers.length : field === 'returnBank' ? 7 : 6);
  }
  restored.act('choose', 'bank', 'hsbc');
  assert.equal(restored.saved().broker, 'usmart'); assert.equal(restored.saved().depositMethod, 'via-bochk');
  assert.equal(M.calculatorJourney({ ...restored.saved(), date: input.date }, D, quotes).selected.fundingBank.id, 'bochk');
  restored.render(); assert.match(moneyDetails(restored, 'edge-03'), /本人中银香港 → 盈立 · 个人标准账户 · 同行入金/);
  restored.act('choose', 'depositMethod', 'internal'); assert.equal(restored.saved().depositMethod, 'internal');
});

test('an intermediate HSBC account adds the bank fee control while the BOCHK path does not inherit that qualification', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, date: '2026-10-11', startBank: 'hang', bank: 'hang', returnBank: 'bochk', broker: 'usmart',
    outcome: 'broker-balance', mainlandMethod: '', depositMethod: 'via-hsbc', hsbcBalanceWaiver: false }, quotes, '2026-10-11');
  assert.match(ui.render(), /HSBC One本持有期均免管理费/);
  ui.act('detail', '', 'bank-settings'); assert.match(ui.modal(), /汇丰 HSBC One期间管理费/); assert.match(ui.modal(), /100.00 HKD\/月 × 12个月/);
  ui.act('choose', 'depositMethod', 'via-bochk');
  assert.doesNotMatch(ui.render(), /HSBC One本持有期均免管理费/);
  ui.act('detail', '', 'bank-settings'); assert.doesNotMatch(ui.modal(), /汇丰 HSBC One期间管理费/);
});

test('ZA whole-share limits retain upstream funds and account choices, and the cash remainder appears beside the buy fee', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const input = { ...currentRoute, date: '2026-10-11', startBank: 'boc', bank: 'bochk', returnBank: 'bochk',
    broker: 'za', mainlandMethod: 'boc-mobile', route: 'USD', outcome: 'broker-balance', months: 0 };
  const r = M.calculatorJourney(input, D, quotes).selected, ui = moneyUi(input, quotes, input.date);
  ui.render(); const detail = moneyDetails(ui, 'edge-trade');
  assert.match(detail, new RegExp(r.trading.orders[0].shares + '股'));
  assert.match(detail, new RegExp('未买入余款 ' + r.trading.cashRemainderUsd.toFixed(2) + ' USD'));
  close(r.steps.proceedsUsd, r.steps.fundedUsd - r.trading.totalUsd);
  const expensive = { ...input, sharePriceUsd: 1000000, useVoucher: true, voucherUsd: 10, voucherOrders: 2,
    voucherScope: 'both', voucherExpiry: '2026-12-31' };
  const invalid = M.calculatorJourney(expensive, D, quotes), failed = moneyUi(expensive, quotes, input.date);
  assert.match(invalid.error, /不足.*买入.*1股/); assert.equal(invalid.partial.errorAction, 'trade');
  close(invalid.partial.steps.fundedUsd, r.steps.fundedUsd);
  close(invalid.partial.rows.find(item => item.key === 'entryFx').cny, r.rows.find(item => item.key === 'entryFx').cny);
  assert.equal(M.calculatorRecommendations(expensive, D, quotes).plans.length, 0);
  assert.match(failed.render(), /不足.*买入.*1股/);
  failed.act('detail', '', 'trade-settings'); assert.match(failed.modal(), /不足.*买入.*1股/);
  failed.act('pick', '', 'broker');
  assert.equal((failed.modal().match(/data-field="broker"/g) || []).length, D.calculator.brokers.length);
});

test('broker unit constraints preserve the bank flow and stable choices, and quantify supported orders in the trade detail', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const id of ['hsbc', 'usmart']) for (const bank of D.calculator.hkBanks) {
    const input = { ...currentRoute, date: '2026-10-11', startBank: 'boc', bank, returnBank: bank,
      broker: id, mainlandMethod: bank === 'bochk' ? 'boc-mobile' : 'boc-online', route: 'USD', outcome: 'broker-balance', months: 0 };
    const valid = M.calculatorJourney(input, D, quotes).selected;
    assert.ok(valid); close(valid.steps.proceedsUsd, valid.steps.fundedUsd - valid.trading.totalUsd);
    const ui = moneyUi(input, quotes, input.date), digits = id === 'hsbc' ? 0 : 4;
    ui.render(); assert.match(moneyDetails(ui, 'edge-trade'), new RegExp(valid.trading.orders[0].shares.toFixed(digits) + '股'));
    const invalidInput = { ...input, sharePriceUsd: 1e9, useVoucher: true, voucherUsd: 100, voucherOrders: 2,
      voucherScope: 'both', voucherExpiry: '2026-12-31' };
    const invalid = M.calculatorJourney(invalidInput, D, quotes), failed = moneyUi(invalidInput, quotes, input.date);
    assert.match(invalid.error, /不足.*买入/); assert.equal(invalid.partial.errorAction, 'trade');
    close(invalid.partial.steps.fundedUsd, valid.steps.fundedUsd);
    close(invalid.partial.rows.find(row => row.key === 'entryFx').cny, valid.rows.find(row => row.key === 'entryFx').cny);
    assert.equal(M.calculatorRecommendations(invalidInput, D, quotes).plans.length, 0);
    failed.render(); failed.act('detail', '', 'trade-settings'); assert.match(failed.modal(), /不足.*买入/);
    failed.act('pick', '', 'bank'); assert.equal((failed.modal().match(/data-field="bank"/g) || []).length, D.calculator.hkBanks.length);
    failed.act('pick', '', 'broker'); assert.equal((failed.modal().match(/data-field="broker"/g) || []).length, D.calculator.brokers.length);
  }
});

test('Chief monthly contribution, quantity and cash changes remain visible without erasing bank charges or choices', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const bank of D.calculator.hkBanks) {
    const input = { ...currentRoute, date: '2026-10-11', startBank: 'boc', bank, returnBank: bank, broker: 'chief',
      mainlandMethod: bank === 'bochk' ? 'boc-mobile' : 'boc-online', route: 'USD', outcome: 'broker-balance', months: 0,
      chiefMonthly: true, buyOrders: 3, sellOrders: 2 };
    const data = M.calculatorJourney(input, D, quotes), r = data.selected;
    assert.ok(r); close(r.trading.investUsd + r.trading.buyFeeUsd + r.trading.cashRemainderUsd, r.steps.fundedUsd);
    close(r.steps.proceedsUsd, r.steps.fundedUsd - r.trading.totalUsd);
    const ui = moneyUi(input, quotes, input.date), buys = r.trading.orders.filter(order => order.kind === 'buy');
    ui.render(); const detail = moneyDetails(ui, 'edge-trade');
    assert.match(detail, new RegExp('扣费前供款 ' + buys.reduce((sum, order) => sum + order.contributionUsd, 0) + ' USD'));
    assert.match(detail, new RegExp(buys.reduce((sum, order) => sum + order.shares, 0).toFixed(5) + '股'));
    assert.match(detail, new RegExp('未买入余款 ' + r.trading.cashRemainderUsd.toFixed(5) + ' USD'));
    const invalidInput = { ...input, sharePriceUsd: 1e10, useVoucher: true, voucherUsd: 100, voucherOrders: 6,
      voucherScope: 'both', voucherExpiry: '2026-12-31' };
    const failed = M.calculatorJourney(invalidInput, D, quotes);
    assert.match(failed.error, /不足.*0.00001股/); assert.equal(failed.partial.errorAction, 'trade');
    close(failed.partial.steps.fundedUsd, r.steps.fundedUsd);
    assert.deepEqual(failed.partial.rows.filter(row => ['entry', 'deposit'].includes(row.step)), r.rows.filter(row => ['entry', 'deposit'].includes(row.step)));
    assert.equal(M.calculatorRecommendations(invalidInput, D, quotes).plans.length, 0);
    const failedUi = moneyUi(invalidInput, quotes, input.date); failedUi.render();
    failedUi.act('detail', '', 'trade-settings'); assert.match(failedUi.modal(), /不足.*0.00001股/);
    failedUi.act('pick', '', 'broker'); assert.equal((failedUi.modal().match(/data-field="broker"/g) || []).length, D.calculator.brokers.length);
  }
});

test('BOC channel switching renders the same discounted sender fee and keeps group and bank choices independent', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, date: '2026-10-11', startBank: 'boc', bank: 'bochk', broker: 'za',
    returnBank: 'bochk', mainlandMethod: 'boc-mobile', route: 'USD', outcome: 'broker-balance' }, quotes, '2026-10-11');
  ui.render(); ui.act('choose', 'bank', 'hsbc');
  const saved = ui.saved(), r = M.calculatorJourney({ ...saved, date: '2026-10-11' }, D, quotes).selected;
  assert.equal(saved.broker, 'za'); assert.equal(saved.mainlandMethod, 'boc-online');
  assert.match(ui.render(), /向他行9折/);
  assert.match(ui.render(), /72.00 CNY/);
  close(r.rows.find(item => item.key === 'sender').cny, 100000 - (100000 - 72) / 1.0009);
  ui.act('pick', '', 'mainlandMethod');
  assert.match(ui.modal(), /boc-online/); assert.match(ui.modal(), /普通电汇/);
  ui.act('choose', 'mainlandMethod', 'swift');
  assert.match(ui.render(), /80.00 CNY/);
  ui.act('choose', 'bank', 'bochk');
  assert.equal(ui.saved().mainlandMethod, 'boc-mobile'); assert.equal(ui.saved().broker, 'za');
  ui.render(); ui.act('detail', '', 'edge-01'); assert.match(ui.modal(), /BKCHHKHH/);
  ui.act('choose', 'route', 'CNH');
  assert.equal(ui.saved().mainlandMethod, 'swift');
  ui.act('pick', '', 'mainlandMethod'); assert.doesNotMatch(ui.modal(), /boc-online/);
});

function evidenceLinks(ui, detail) {
  ui.act('detail', '', detail);
  return new Set([...ui.modal().matchAll(/class="source-link"[^>]*href="([^"]+)"/g)].map(match => match[1]));
}

test('Hong Kong SC exchange evidence uses its own retail quote channel in funding, return and consumption', () => {
  const quoteChannel = 'https://www.sc.com/hk/zh/investment/foreign-exchange/';
  const cases = [
    ['edge-03', { ...currentRoute, bank: 'sc', broker: 'za', route: 'HKD', fxMode: 'bank', depositMethod: 'chats', outcome: 'broker-balance' }],
    ['edge-04', { ...currentRoute, returnBank: 'sc', exitBank: 'cib', outcome: 'mainland', returnCurrency: 'HKD', returnMethod: 'swift' }],
    ['edge-04', { ...currentRoute, returnBank: 'sc', outcome: 'cnh-card', scCnhAccount: true }]
  ];
  for (const [detail, config] of cases) {
    const ui = moneyUi(config); ui.render();
    const links = evidenceLinks(ui, detail);
    assert.ok(links.has(quoteChannel), detail + '/' + config.outcome);
    assert.ok(links.has(D.sources.scHkFxTerms.url), 'SC discount scope must have its current retail terms');
    assert.ok(!links.has(D.sources.scFx.url), 'Hong Kong conversion cannot cite mainland SC quote access');
    assert.ok(!links.has(D.sources.bochkUsdFx.url), 'SC cannot inherit BOCHK FX evidence');
  }
});

test('switching uSMART funding to HSBC uses the verified same-bank channel and retains independent account choices', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', mainlandMethod: 'swift',
    route: 'USD', outcome: 'broker-balance', hsbcBalanceWaiver: true, cnHsbcFeeWaived: true }, quotes, '2026-10-11');
  ui.render(); ui.act('choose', 'broker', 'usmart'); ui.act('choose', 'bank', 'hsbc');
  assert.equal(ui.saved().broker, 'usmart'); assert.equal(ui.saved().bank, 'hsbc');
  assert.equal(ui.saved().depositMethod, 'internal'); assert.equal(ui.saved().mainlandMethod, 'boc-online');
  const html = ui.render();
  assert.match(html, /同行转账 → 券商收款账户 · 免费/);
  assert.doesNotMatch(html, /同行交收/);
  const funding = html.split('aria-label="转入买股账户"')[1].split('</section>')[0];
  assert.match(moneyDetails(ui, 'edge-03'), /同行收款<\/strong>.*?0.00 CNY/s);
  assert.doesNotMatch(funding, /flow-variable|同行入金须/);
  const sources = evidenceLinks(ui, 'edge-03');
  assert.ok(sources.has(D.sources.usmartFundingAccounts.url)); assert.ok(sources.has(D.sources.usmartSameFunding.url));
  ui.act('pick', '', 'bank');
  for (const bank of D.calculator.hkBanks) assert.match(ui.modal(), new RegExp('data-value="' + bank + '"'));
  assert.doesNotMatch(ui.modal(), /\bdisabled\b/);
  ui.act('choose', 'bank', 'za'); assert.equal(ui.saved().depositMethod, 'chats');
  assert.equal(ui.saved().broker, 'usmart');
  ui.render(); const cross = moneyDetails(ui, 'edge-03');
  assert.match(cross, /中银香港 · 券商企业账户CHATS收款/);
  assert.match(cross, /估算 15.00 HKD/);
  assert.doesNotMatch(cross, /此汇路代理／收款行收费未公开/);
});

test('BOC observed correspondent cost is reference-priced without downgrading bank-confirmed fee waivers', () => {
  const config = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', mainlandMethod: 'boc-mobile', outcome: 'broker-balance' };
  const ui = moneyUi(config), html = ui.render(), r = M.calculatorJourney({ ...config, sellDate: '2026-10-09' }, D, cibQuotes).selected;
  const transfer = html.split('aria-label="汇往香港"')[1].split('</section>')[0];
  assert.match(transfer, /参考损耗/);
  assert.match(moneyDetails(ui, 'edge-01'), /手机银行双免|双免/);
  assert.match(transfer, /参考 0.00 CNY/);
  const summary = html.split('id="flow-live-summary"')[1];
  assert.match(summary, /参考总损耗/);
  assert.match(summary, new RegExp(r.costCny.toFixed(2).replace('.', '\\.')));
  const confirmed = M.calculatorJourney({ ...config, entryMiddleCny: 0, sellDate: '2026-10-09' }, D, cibQuotes).selected;
  close(confirmed.costCny, r.costCny); close(confirmed.net, r.net);
  const confirmedUi = moneyUi({ ...config, entryMiddleCny: 0 }).render().split('id="flow-live-summary"')[1];
  assert.match(confirmedUi, /全程损耗/); assert.doesNotMatch(confirmedUi, /参考总损耗/);
  const noFx = structuredClone(cibQuotes); delete noFx.banks.boc;
  const partial = M.calculatorJourney(config, D, noFx).partial;
  assert.match(partial.rows.find(row => row.key === 'entryMiddle').estimate, /同名同行SHA操作记录/);
  assert.equal(partial.rows.find(row => row.key === 'sender').estimate, undefined);
});

test('remittance evidence follows its own channel and excludes stock, card and expired offer sources', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', mainlandMethod: 'boc-mobile', outcome: 'broker-balance' });
  ui.render();
  const mobile = evidenceLinks(ui, 'edge-01');
  for (const key of ['bocMobile2026', 'bocMobileUsdGuide', 'bocFx', 'bochkSame']) assert.ok(mobile.has(D.sources[key].url), key);
  for (const key of ['bocMobileHistory', 'bocPaymentConnect', 'bocPaymentGuide', 'zaStocks', 'zaCard', 'secFees']) assert.ok(!mobile.has(D.sources[key].url), key);
  ui.act('choose', 'mainlandMethod', 'swift');
  const ordinary = evidenceLinks(ui, 'edge-01');
  assert.ok(ordinary.has(D.sources.boc.url));
  assert.ok(!ordinary.has(D.sources.bocMobile2026.url));
  ui.act('choose', 'startBank', 'cib'); ui.act('choose', 'route', 'CNH');
  const rmb = evidenceLinks(ui, 'edge-01');
  assert.ok(rmb.has(D.sources.cib.url));
  assert.ok(rmb.has(D.sources.cibCard.url)); // Explains why the foreign-currency waiver does not apply.
  for (const key of ['cibGo', 'cibFx']) assert.ok(!rmb.has(D.sources[key].url), key);
});

test('offer eligibility is readable before enabling it and bank management evidence stays with banks', () => {
  for (const [broker, offer] of [['hsbc', 'trade25Age'], ['za', 'zaStockService'], ['chief', 'chiefMonthlyTerms'], ['usmart', 'usmartPromo']]) {
    const ui = moneyUi({ ...currentRoute, bank: 'bochk', broker, outcome: 'broker-balance', trade25: false, zaLv2: false, chiefMonthly: false, usmartPromo: false });
    ui.render();
    assert.ok(evidenceLinks(ui, 'offers').has(D.sources[offer].url), broker);
    const trade = evidenceLinks(ui, 'edge-trade');
    assert.ok(trade.has(D.sources.secFees.url));
    assert.ok(!trade.has(D.sources.hsbcOne.url));
    assert.ok(!trade.has(D.sources.bocMobile2026.url));
    assert.ok(!trade.has(D.sources[offer].url), 'inactive offer: ' + broker);
    if (broker === 'hsbc') {
      const bank = evidenceLinks(ui, 'bank-settings');
      assert.ok(bank.has(D.sources.hsbcOne.url));
      assert.ok(bank.has(D.sources.hsbcOneBalance.url));
      assert.ok(!bank.has(D.sources.trade25.url));
      assert.ok(!bank.has(D.sources.secFees.url));
    }
  }
});

test('funding evidence distinguishes IBKR local USD instructions and the selected bank FX', () => {
  const ui = moneyUi({ ...currentRoute, bank: 'bochk', broker: 'ibkr', depositMethod: 'chats', outcome: 'broker-balance' });
  ui.render();
  const local = evidenceLinks(ui, 'edge-03');
  for (const key of ['ibDeposits', 'ibLocalUsd', 'ibLocalCiti', 'bochk']) assert.ok(local.has(D.sources[key].url), key);
  ui.act('choose', 'depositMethod', 'swift');
  const overseas = evidenceLinks(ui, 'edge-03');
  for (const key of ['ibLocalUsd', 'ibLocalCiti', 'ibEdda']) assert.ok(!overseas.has(D.sources[key].url), key);
  ui.act('choose', 'broker', 'hsbc'); ui.act('choose', 'bank', 'hsbc'); ui.act('choose', 'route', 'HKD');
  const bankFx = evidenceLinks(ui, 'edge-03');
  assert.ok(bankFx.has(D.sources.hsbcHkFx.url));
  assert.ok(!bankFx.has(D.sources.ibFx.url));
  assert.ok(!bankFx.has(D.sources.bochkUsdFx.url));
});

test('IBKR funding evidence follows the actual deposited currency after bank or broker FX', () => {
  for (const route of ['USD', 'HKD', 'CNH']) for (const fxMode of ['manual', 'auto', 'bank']) {
    const ui = moneyUi({ ...currentRoute, bank: 'bochk', broker: 'ibkr', route, fxMode,
      mainlandMethod: 'swift', depositMethod: route === 'USD' || fxMode === 'bank' ? 'chats' : 'fps', outcome: 'broker-balance' });
    ui.render();
    const links = evidenceLinks(ui, 'edge-03'), funded = route === 'USD' || fxMode === 'bank' ? 'USD' : route;
    for (const currency of ['USD', 'HKD', 'CNH']) {
      assert.equal(links.has(D.sources['ibFunding' + currency].url), currency === funded, route + '/' + fxMode + '/' + currency);
    }
    ui.act('choose', 'broker', 'za');
    const bankStock = evidenceLinks(ui, 'edge-03');
    assert.ok(!['USD', 'HKD', 'CNH'].some(c => bankStock.has(D.sources['ibFunding' + c].url)));
  }
});

test('return and full-journey evidence include the actual receiving bank rather than the departure bank', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'chief', returnBank: 'bochk', exitBank: 'cib', outcome: 'mainland' });
  ui.render();
  const returning = evidenceLinks(ui, 'edge-04');
  for (const key of ['cibInward', 'cibFx', 'bochk']) assert.ok(returning.has(D.sources[key].url), key);
  for (const key of ['bocMobile2026', 'bocFx', 'chiefStocks']) assert.ok(!returning.has(D.sources[key].url), key);
  const all = evidenceLinks(ui, 'all');
  assert.ok(all.has(D.sources.cibInward.url));
  assert.ok(all.has(D.sources.chiefStocks.url));
  ui.act('choose', 'returnBank', 'hsbc'); ui.act('choose', 'outcome', 'cnh-card');
  const card = evidenceLinks(ui, 'edge-04');
  for (const key of ['hsbcCard', 'hsbcHkFx']) assert.ok(card.has(D.sources[key].url), key);
  for (const key of ['bochkCard', 'bochkUsdFx', 'cibInward', 'cibFx']) assert.ok(!card.has(D.sources[key].url), key);
  assert.ok(!evidenceLinks(ui, 'all').has(D.sources.cibInward.url));
});

test('the terminal balance reconciles with the summary after bank period fees and tax for every outcome', () => {
  const q = require('./fixtures/money-flow-quotes-20261011.json');
  for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
    const input = M.calculatorRoute({ budgetCny: 100000, count: 1, months: 12, date: '2026-10-11',
      startBank: 'cib', bank: 'hsbc', broker: 'hsbc', returnBank: 'hsbc', exitBank: 'cib',
      route: 'USD', mainlandMethod: 'swift', depositMethod: 'internal', returnMethod: 'swift',
      outcome, profitUsd: 1000, taxRate: 20, returnExtraCny: 0, exitPrice: outcome === 'cnh-card' ? 6.68 : '', hsbcBalanceWaiver: false, cnHsbcFeeWaived: false });
    const ui = moneyUi(input, q, '2026-10-11'), html = ui.render(), r = M.calculatorJourney({ ...ui.saved(), date: '2026-10-11', sellDate: '2026-10-11' }, D, q).selected;
    assert.ok(r, outcome); assert.ok(r.rows.find(row => row.key === 'account').cny > 0); assert.ok(r.taxCny > 0);
    const terminal = html.split(['broker-balance', 'usd-balance'].includes(outcome) ? 'aria-label="卖出后的资金"' : 'aria-label="资金终点"')[1].split('</section>')[0];
    const summary = html.split('id="flow-live-summary"')[1];
    for (const section of [summary]) {
      assert.ok(section.includes(r.net.toFixed(2) + ' <small>' + r.currency), outcome);
      assert.ok(section.includes((r.costCny / r.budgetCny * 100).toFixed(3) + '%'), outcome);
      assert.match(section, /预留税款/);
    }
    assert.ok(terminal.includes((outcome === 'usd-balance' ? r.steps.returnUsd : r.net).toFixed(2) + ' <small>' + r.currency));
    assert.doesNotMatch(terminal, /期间管理费/); // Bank fees remain at their bank controls, with no duplicate terminal block.
    assert.match(html.split('data-flow-stage="02"')[1].split('</section>')[0], /银行管理费/);
    assert.doesNotMatch(terminal, /税前/);
  }
});

test('IBKR USD funding separates Hong Kong receiving instructions from overseas wire instructions', () => {
  const ui = moneyUi({ ...currentRoute, broker: 'ibkr', route: 'USD', depositMethod: 'chats', depositOtherCny: '', outcome: 'broker-balance' });
  assert.match(ui.render(), /香港收款指示 · USD本地转账/);
  assert.match(moneyDetails(ui, 'edge-03'), /香港花旗／渣打收款指示/);
  assert.match(ui.render(), /参考总损耗/);
  ui.act('control-pick', '', 'depositMethod');
  assert.match(ui.modal(), /境外收款指示 · USD电汇/);
});

test('a stale final quote preserves earlier arrivals and a numeric known-cost total', () => {
  const q = structuredClone(cibQuotes); q.banks.boc.quotes.USD.asOf = '2020-01-01';
  const html = moneyUi({ ...currentRoute, startBank: 'cib', exitBank: 'boc', outcome: 'mainland' }, q).render();
  assert.match(html, /汇款到账[^<]*<\/small><div>.*?<small>USD/);
  assert.match(html, /全程损耗 · 历史报价/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('missing source evidence cannot hide later account choices or the default principal', () => {
  const q = structuredClone(cibQuotes); delete q.banks.cib;
  const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'swift' }, q), html = ui.render();
  assert.equal((html.match(/data-flow-stage=/g) || []).length, 4);
  for (const text of ['香港收款', '买股', '人民币本金', '汇出笔数', '现汇卖出价尚未取得']) assert.ok(html.includes(text), text);
  assert.match(html, /100000.00 <small>CNY/);
  assert.doesNotMatch(html, /<select|此组合不提供全程报价|完整收费方案|NaN|undefined/);
  ui.act('pick', '', 'broker');
  for (const id of D.calculator.brokers) assert.match(ui.modal(), new RegExp('data-value="' + id + '"'));
  assert.doesNotMatch(ui.modal(), /\bdisabled\b/);
});

test('entry HKD cross trades stay explicit and cannot masquerade as a direct RMB consumption quote', () => {
  const q = structuredClone(cibQuotes);
  const market = { bidPerUsd: 6.5, askPerUsd: 8 / 1.1, asOf: '2026-10-09 12:00:00', path: 'via-HKD',
    legs: { usdBuy: 7.8, usdSell: 8, cnhBuy: 1.1, cnhSell: 1.2 } };
  q.offshoreUsd.hsbc = { quotes: { CNH: market, HKD: { bidPerUsd: 7.8, askPerUsd: 8, asOf: market.asOf } } };
  const config = { ...currentRoute, route: 'CNH', mainlandMethod: 'swift', fxMode: 'bank', depositMethod: 'internal',
    bank: 'hsbc', broker: 'hsbc', returnBank: 'hsbc', outcome: 'cnh-card', senderFeeCny: 0, entryMiddleCny: 0,
    months: 0, tradeFeeUsd: 0, entryPrice: '', exitPrice: '' };
  const r = M.calculatorJourney(config, D, q).selected;
  close(r.steps.fundedUsd, 100000 * 1.1 / 8);
  close(r.entryPrice, 8 / 1.1);
  assert.equal(r.indicativeFx, ''); assert.equal(r.indicativeExit, true);
  const entry = r.rows.find(x => x.key === 'brokerSpread');
  assert.equal(entry.exchanges.length, 2);
  close(entry.items.reduce((sum, x) => sum + x.cny, 0), entry.cny);
  close(entry.exchanges[0].output, entry.exchanges[1].input);
  assert.equal(entry.path[1], 'HKD');
  assert.equal(r.rows.find(x => x.key === 'exitFx').cny, null);
  assert.match(r.exitIssue, /USD\/CNH直接报价尚未取得/);
  const direct = M.calculatorJourney({ ...config, exitPrice: 6.6 }, D, q).selected;
  close(direct.net, direct.steps.returnUsd * 6.6);
  assert.deepEqual(direct.rows.find(x => x.key === 'exitFx').exchanges.map(x => [x.from, x.to]), [['USD', 'CNH']]);
  close(r.budgetCny - r.costCny, r.netCny);
  const html = moneyUi(config, q).render();
  assert.match(html, /人民币 → 港币 → 美元/);
  assert.match(html, /美元直接换人民币 → 商户刷卡/);
  assert.doesNotMatch(html, /美元 → 港币 → 人民币 → 消费/);
  assert.doesNotMatch(html, /请选择中银香港消费|NaN|undefined/);
  const without = structuredClone(q); delete without.offshoreUsd.hsbc;
  const unquoted = M.calculatorJourney(config, D, without).selected;
  assert.ok(unquoted.indicativeFx); assert.equal(unquoted.indicativeExit, true);
  assert.equal(unquoted.rankable, false);
  assert.equal(unquoted.rows.find(x => x.key === 'exitFx').cny, null);
});

test('a different return bank cannot inherit an old bank FX override; vouchers stay with their broker', () => {
  const ui = moneyUi({ ...currentRoute, exitPrice: '9', useVoucher: true });
  ui.render(); ui.act('choose', 'returnBank', 'hang');
  assert.equal(ui.saved().exitPrice, '');
  ui.act('choose', 'broker', 'hsbc'); assert.equal(ui.saved().useVoucher, false);
});

test('bank management stays next to the bank and monthly and period prices reconcile', () => {
  for (const broker of ['za', 'hsbc']) {
    const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'swift', broker, trade25: true, hsbcBalanceWaiver: false }), html = ui.render();
    const bank = html.split('data-flow-stage="02"')[1].split('</section>')[0];
    const trade = html.split('data-flow-stage="03"')[1].split('</section>')[0];
    assert.match(bank, /HSBC One本持有期均免管理费/);
    assert.doesNotMatch(trade, /data-money-check="hsbcBalanceWaiver"/);
    ui.act('detail', '', 'bank-settings'); assert.match(ui.modal(), /100.00 HKD\/月 × 12个月/); assert.match(ui.modal(), /1200.00 HKD/);
    if (broker === 'hsbc') { assert.match(trade, /Trade25 · 仅美股月费0/); assert.doesNotMatch(trade, /25.00 HKD/); }
  }
});

test('HSBC One remaining initial assessment is edited with bank fees and survives stock and account selections', () => {
  const input = { ...currentRoute, hsbcBalanceWaiver: false, hkHsbcFreeMonths: 3, outcome: 'broker-balance' };
  const ui = moneyUi(input); ui.render(); ui.act('detail', '', 'bank-settings');
  assert.equal((ui.modal().match(/data-money-field="hkHsbcFreeMonths"/g) || []).length, 1);
  assert.match(ui.modal(), /100.00 HKD\/月 × 9个月；另3个月免收/);
  assert.match(ui.modal(), /900.00 HKD/);
  ui.act('choose', 'broker', 'hsbc'); ui.act('choose', 'bank', 'bochk');
  assert.equal(ui.saved().hkHsbcFreeMonths, 3);
  ui.act('detail', '', 'bank-settings'); assert.match(ui.modal(), /data-money-field="hkHsbcFreeMonths"/);
  const restored = moneyUi(ui.saved()); restored.render(); restored.act('detail', '', 'bank-settings');
  assert.match(restored.modal(), /100.00 HKD\/月 × 9个月；另3个月免收/);
  for (const overrides of [{ hsbcBalanceWaiver: true }, { bank: 'bochk', broker: 'za', outcome: 'broker-balance' }]) {
    const hidden = moneyUi({ ...input, ...overrides }); hidden.render(); hidden.act('detail', '', 'bank-settings');
    assert.doesNotMatch(hidden.modal(), /data-money-field="hkHsbcFreeMonths"/);
  }
  for (const hkHsbcFreeMonths of [-1, .5, 4, 'bad']) {
    const invalid = moneyUi({ ...input, hkHsbcFreeMonths }); invalid.render(); invalid.act('detail', '', 'bank-settings');
    assert.match(invalid.modal(), /aria-invalid="true" aria-describedby="flow-error-hkHsbcFreeMonths"/);
    const hsbcFee = invalid.modal().split('汇丰 HSBC One期间管理费')[1].split('<div class="flow-fee-line">')[0];
    assert.doesNotMatch(hsbcFee, /0.00 HKD<|0.00 HKD\/月/);
    assert.match(invalid.modal(), /月数须为/);
  }
});

test('month controls show zero-period unit prices and report invalid months where they are edited', () => {
  const input = { ...currentRoute, bank: 'hsbc', hsbcBalanceWaiver: false, months: 0 };
  const zero = moneyUi(input); zero.render(); zero.act('detail', '', 'bank-settings');
  assert.match(zero.modal(), /100.00 HKD\/月 × 0个月/); assert.match(zero.modal(), /0.00 HKD/);
  assert.doesNotMatch(zero.modal(), /aria-invalid/);
  for (const months of [.5, -1, '', 'bad']) {
    const ui = moneyUi({ ...input, months }); ui.render(); ui.act('detail', '', 'bank-settings');
    assert.match(ui.modal(), /aria-invalid="true" aria-describedby="flow-error-months"/);
    assert.match(ui.modal(), /月数须为非负整数/);
    assert.doesNotMatch(ui.modal(), /100.00 HKD\/月 × 1个月/);
  }
  const free = moneyUi({ ...input, months: 12, startBank: 'hsbc', mainlandMethod: 'linked', cnHsbcFreeMonths: .5 });
  free.render(); free.act('detail', '', 'cn-bank-hsbc');
  assert.equal(free.saved().startBank, 'boc');
  assert.equal(free.saved().exitBank, 'boc');
  assert.doesNotMatch(free.modal(), /data-money-field="cnHsbcFreeMonths"/);
});

test('invalid editable values are explained inside their open dialog instead of behind its backdrop', () => {
  const cases = [
    ['budget', 'budgetCny', 0, /须为有效正数/],
    ['budget', 'budgetCny', -10, /须为有效正数/],
    ['budget', 'count', 1.5, /笔数须为1–120的整数/],
    ['budget', 'count', 0, /笔数须为1–120的整数/],
    ['budget', 'count', 121, /笔数须为1–120的整数/],
    ['trade-settings', 'buyOrders', 1.5, /笔数须为1–120的整数/],
    ['trade-settings', 'sharePriceUsd', 'bad', /须为有效正数/],
    ['profit-settings', 'taxRate', 101, /税率须为0–100%/],
    ['profit-settings', 'withdrawalIndex', 0, /出金次数须为正整数/, { broker: 'ibkr', outcome: 'usd-balance' }],
    ['bank-settings', 'months', 1201, /账户使用月数须为0–1200的整数/],
    ['offers', 'voucherOrders', 241, /费用券适用订单数须为1–240的整数/],
    ['adjustments', 'senderFeeCny', -1, /须为非负数/],
    ['adjustments', 'entryPrice', 0, /汇率须为有效正数/, { route: 'HKD', fxMode: 'bank' }]
  ];
  for (const [detail, key, value, message, overrides = {}] of cases) {
    const ui = moneyUi({ ...currentRoute, ...(detail === 'offers' ? { useVoucher: true } : {}), ...overrides, [key]: value }); ui.render(); ui.act('detail', '', detail);
    assert.match(ui.modal(), new RegExp('aria-invalid="true" aria-describedby="flow-error-' + key + '"'), key);
    assert.match(ui.modal(), message, key);
    assert.equal((ui.render().match(/data-flow-stage=/g) || []).length, 4, key);
  }
  const valid = moneyUi({ ...currentRoute, budgetCny: 120000, count: 3, profitUsd: -100 });
  valid.render(); valid.act('detail', '', 'budget'); assert.doesNotMatch(valid.modal(), /aria-invalid/);
  valid.act('detail', '', 'profit-settings'); assert.doesNotMatch(valid.modal(), /aria-invalid/);
});

test('missing entry conversion prices keep the same labelled reference balance at the terminal and summary', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const base = { ...currentRoute, date: '2026-10-11', startBank: 'boc', bank: 'bochk', mainlandMethod: 'boc-mobile',
    broker: 'ibkr', outcome: 'broker-balance', route: 'HKD', depositMethod: 'fps', entryPrice: '', count: 1 };
  for (const fxMode of ['manual', 'auto']) {
    const input = M.calculatorRoute({ ...base, fxMode }), r = M.calculatorJourney(input, D, quotes).selected;
    assert.ok(r.indicativeFx); assert.ok(r.steps.brokerOriginal > 0);
    const ui = moneyUi(input, quotes, '2026-10-11'), html = ui.render();
    const displayed = M.calculatorJourney({ ...ui.saved(), date: '2026-10-11', sellDate: '2026-10-11' }, D, quotes).selected;
    const terminal = html.split('data-flow-stage="04"')[1].split('</section>')[0];
    const summary = html.split('id="flow-live-summary"')[1].split('flow-bottom-tools')[0];
    for (const section of [terminal, summary]) {
      assert.match(section, /参考最终余额/);
      assert.match(section, new RegExp(displayed.net.toFixed(2) + ' <small>USD<'));
    }
    assert.equal(r.missing.filter(label => /IBKR HKD\/USD/.test(label)).length, 1);
    assert.match(moneyDetails(ui, 'edge-03'), /入金代理／收款行费/);
    assert.match(moneyDetails(ui, fxMode === 'auto' ? 'edge-trade' : 'edge-03'), fxMode === 'auto' ? /买入时自动换USD加价/ : /换USD佣金／自动加价/);
  }
  const bank = M.calculatorRoute({ ...base, bank: 'sc', route: 'CNH', mainlandMethod: 'swift', fxMode: 'bank' });
  const bankUi = moneyUi(bank, quotes, '2026-10-11'), html = bankUi.render();
  const bankResult = M.calculatorJourney({ ...bankUi.saved(), date: '2026-10-11', sellDate: '2026-10-11' }, D, quotes), r = bankResult.selected || bankResult.partial;
  const terminal = html.split('data-flow-stage="04"')[1].split('</section>')[0];
  assert.match(terminal, /最后可计余额 · 渣打 · 快易理财/);
  assert.match(terminal, new RegExp(r.steps.hongKong.toFixed(2) + ' <small>CNH<'));
});

test('switching HKD and CNH retains a valid FX location while clearing the old currency price', () => {
  for (const fxMode of ['bank', 'manual', 'auto']) {
    const ui = moneyUi({ ...currentRoute, broker: 'ibkr', bank: 'bochk', route: 'HKD', fxMode, entryPrice: '7.8' });
    ui.render(); ui.act('choose', 'route', 'CNH');
    assert.equal(ui.saved().fxMode, fxMode); assert.equal(ui.saved().entryPrice, '');
    assert.equal(ui.saved().broker, 'ibkr'); assert.equal(ui.saved().bank, 'bochk');
    ui.act('choose', 'route', 'HKD'); assert.equal(ui.saved().fxMode, fxMode);
  }
  for (const broker of ['hsbc', 'za', 'chief', 'usmart']) {
    const ui = moneyUi({ ...currentRoute, broker, route: 'USD', fxMode: 'manual' });
    ui.render(); ui.act('choose', 'route', 'HKD'); assert.equal(ui.saved().fxMode, 'bank', broker);
    ui.act('choose', 'route', 'CNH'); assert.equal(ui.saved().fxMode, 'bank', broker);
  }
});

test('a voucher expired before buying explains zero deduction without changing bank charges', () => {
  const config = { ...currentRoute, startBank: 'cmb', broker: 'za', outcome: 'broker-balance', useVoucher: true,
    voucherUsd: 1000, voucherScope: 'platform', voucherOrders: 2, voucherExpiry: '2026-10-08' };
  const expired = M.voucherState(config); assert.equal(expired.expired, true); assert.equal(expired.ready, false);
  const data = M.calculatorJourney(config, D, cibQuotes).selected;
  const ordinary = M.calculatorJourney({ ...config, useVoucher: false }, D, cibQuotes).selected;
  close(data.costCny, ordinary.costCny); close(data.rows.find(row => row.key === 'sender').cny, ordinary.rows.find(row => row.key === 'sender').cny);
  close(data.trading.discountUsd, 0);
  assert.deepEqual(data.trading.warnings, ['费用券已过期，本次未抵扣。']);
  const ui = moneyUi(config); ui.render(); ui.act('detail', '', 'offers'); assert.match(ui.modal(), /费用券已过期，本次未抵扣/);
});

test('the inline bank management fee identifies HSBC even when the receiving bank is BOCHK', () => {
  const html = moneyUi({ ...currentRoute, bank: 'bochk', broker: 'hsbc', outcome: 'broker-balance', months: 12, hsbcBalanceWaiver: false }).render();
  const bankNode = html.split('data-flow-stage="02"')[1].split('</section>')[0];
  assert.match(bankNode, /香港收款银行：中银香港/);
  assert.match(bankNode, /data-money-field="months"[^>]*value="12"/);
  assert.match(bankNode, /汇丰 HSBC One · 管理费/); assert.match(bankNode, /data-money-check="hsbcBalanceWaiver"/);
  assert.doesNotMatch(bankNode, /中银香港管理费 [1-9]/);
});

test('withdrawal capability and minimum errors appear at the withdrawal action, including a USD-balance endpoint', () => {
  const input = { ...currentRoute, bank: 'bochk', returnBank: 'za', broker: 'chief', depositMethod: 'internal', outcome: 'usd-balance' };
  const html = moneyUi(input).render(), withdrawal = html.split('aria-label="致富出金 → 众安 ZA Bank"')[1].split('</section>')[0];
  assert.match(withdrawal, /不接受支票存款/); assert.equal((html.match(/不接受支票存款/g) || []).length, 1);
  assert.match(withdrawal, /本次无法出金/); assert.doesNotMatch(withdrawal, /已核费用/);
  assert.match(html, /买1笔 · 卖1笔/); assert.match(html, /最后可计余额/);
  const small = moneyUi({ ...input, broker: 'usmart', budgetCny: 20 * cibQuotes.banks.boc.quotes.USD.sell,
    startBank: 'boc', route: 'USD', mainlandMethod: 'boc-mobile', startSell: '', tradeFeeUsd: '0' }).render();
  assert.match(small.split('aria-label="盈立出金 → 众安 ZA Bank"')[1].split('</section>')[0], /须超过20 USD/);
});

test('RMB source is not described as free when its sender tariff remains unpriced', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'icbc', route: 'CNH', mainlandMethod: 'swift' }), html = ui.render();
  assert.match(html, /aria-label="汇出币种"/); assert.match(html, /人民币原币/); assert.match(html, /aria-label="汇往香港"/);
  assert.doesNotMatch(html, /人民币原币跨境渠道未纳入全程报价/);
  ui.act('detail', '', 'cost'); assert.match(ui.modal(), /个人普通跨境人民币手续费及电讯费适用条款未取得/);
});

test('ICBC full-amount service is explicitly selected, visibly priced and cleared on currency changes', () => {
  const quotes = structuredClone(cibQuotes);
  quotes.banks.icbc = { quotes: { USD: { buy: 6.69, sell: 6.71, asOf: '2026-10-09 10:00:00' } } };
  const ui = moneyUi({ ...currentRoute, startBank: 'icbc', bank: 'bochk', broker: 'za', count: 1, mainlandMethod: 'swift', route: 'USD', outcome: 'broker-balance' }, quotes);
  ui.render(); ui.act('control-pick', '', 'mainlandMethod');
  assert.match(ui.modal(), /美元全额到账 · 另加25 USD\/笔/);
  ui.act('choose', 'mainlandMethod', 'full');
  const html = ui.render();
  assert.match(html, /美元全额到账 · 另加25 USD\/笔/);
  assert.match(html, /全额到账附加费 · 25 USD/);
  assert.equal(ui.saved().count, 1);
  assert.equal(ui.saved().bank, 'bochk'); assert.equal(ui.saved().broker, 'za');
  ui.act('detail', '', 'edge-01'); assert.match(ui.modal(), /美元全额到账附加服务按笔收费/);
  ui.act('choose', 'route', 'HKD');
  assert.equal(ui.saved().mainlandMethod, 'swift');
  assert.doesNotMatch(ui.render(), /美元全额到账 · 另加25 USD\/笔/);
});

test('explicit receiving-bank funding survives compatible account changes and clears only when inapplicable', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...currentRoute, startBank: 'cib', bank: 'za', broker: 'usmart', route: 'USD',
    mainlandMethod: 'swift', depositMethod: 'via-bochk', outcome: 'broker-balance' }, quotes, '2026-10-12');
  ui.render(); ui.act('choose', 'bank', 'hang');
  assert.equal(ui.saved().mainlandMethod, 'swift'); assert.equal(ui.saved().depositMethod, 'via-bochk');
  ui.act('choose', 'broker', 'chief'); assert.equal(ui.saved().depositMethod, 'via-bochk');
  ui.act('choose', 'depositMethod', 'chats-hsbc'); ui.act('choose', 'bank', 'za');
  assert.equal(ui.saved().depositMethod, 'chats-hsbc');
  ui.act('choose', 'bank', 'hsbc'); assert.equal(ui.saved().depositMethod, 'internal');
  ui.act('choose', 'bank', 'hang'); ui.act('choose', 'depositMethod', 'via-bochk');
  ui.act('choose', 'bank', 'bochk'); assert.equal(ui.saved().depositMethod, 'internal');
  ui.act('choose', 'route', 'CNH'); assert.equal(ui.saved().mainlandMethod, 'swift');
  ui.act('choose', 'startBank', 'cmb'); assert.equal(ui.saved().mainlandMethod, 'swift');
});

test('a missing ICBC quote preserves the fixed telegram tariff and named full-amount service instead of clearing known fees', () => {
  const config = { ...currentRoute, startBank: 'icbc', bank: 'bochk', broker: 'za', count: 1, mainlandMethod: 'full', route: 'USD', outcome: 'broker-balance' };
  const q = structuredClone(cibQuotes); delete q.banks.icbc;
  const result = M.calculatorJourney(config, D, q), r = result.partial;
  assert.match(result.error, /工商银行的USD现汇卖出价/);
  const sender = r.rows.find(x => x.key === 'sender');
  assert.ok(sender.estimate);
  const telegram = sender.items.find(x => x.label === '汇出电讯费');
  close(telegram.cny, 80); assert.equal(telegram.estimate, false);
  assert.ok(sender.items.find(x => x.label === '全额到账附加费 · 25 USD').estimate);
  assert.equal(r.rows.find(x => x.key === 'entryMiddle').cny, 0);
  assert.equal(r.steps.mainlandForeign, undefined);
  const ui = moneyUi(config, q), html = ui.render();
  assert.match(html, /汇出电讯费/); assert.match(html, /全额到账附加费 · 25 USD/);
  assert.match(html, /已计费用占本金 · 含估算/); assert.doesNotMatch(html, /NaN|undefined/);
});

test('mainland receiving-bank choices show inward tariffs and USD bid prices regardless of the initial remittance currency', () => {
  const quotes = structuredClone(cibQuotes);
  quotes.banks.icbc = { quotes: { USD: { buy: 6.60, sell: 6.90, asOf: '2026-10-09 10:00:00' } } };
  for (const route of ['USD', 'HKD', 'CNH']) {
    const ui = moneyUi({ ...currentRoute, route, fxMode: 'bank', outcome: 'mainland', exitBank: 'icbc' }, quotes);
    ui.render(); ui.act('pick', '', 'exitBank');
    const modal = ui.modal();
    assert.match(modal, /境外USD汇入手续费：0.00 CNY/);
    assert.doesNotMatch(modal, /境外USD汇入手续费：尚未取得适用价目/);
    assert.match(modal, /<b>6.6<\/b><small>CNY\/USD · 结汇/);
    assert.doesNotMatch(modal, /汇出|电讯|全额到账|前30笔/);
  }
});

test('RMB source descriptions never substitute foreign-wire tariffs in the picker, channel or evidence', () => {
  for (const startBank of ['icbc']) {
    const ui = moneyUi({ ...currentRoute, startBank, route: 'CNH', fxMode: 'bank', mainlandMethod: 'swift', outcome: 'broker-balance' });
    assert.match(ui.render(), /人民币跨境汇款/);
    ui.act('pick', '', 'startBank');
    assert.match(ui.modal(), /人民币跨境汇出手续费／电讯费：尚未取得适用价目/);
    assert.doesNotMatch(ui.modal(), /USD全额到账|网银0.8‰|手机银行同名优惠单列/);
    ui.act('detail', '', 'edge-01');
    assert.match(ui.modal(), /人民币跨境汇出手续费／电讯费：尚未取得适用价目/);
    assert.doesNotMatch(ui.modal(), /USD全额到账另加|网银0.8‰/);
  }
  const boc = moneyUi({ ...currentRoute, startBank: 'boc', route: 'CNH', fxMode: 'bank', mainlandMethod: 'swift' });
  boc.render(); boc.act('detail', '', 'edge-01');
  assert.match(boc.modal(), /人民币跨境1‰，50–260元＋80元电讯费/);
  assert.doesNotMatch(boc.modal(), /手机银行同名优惠单列/);
});

test('CIB RMB channel, picker and fee detail agree without an FX-only free-transfer label', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'cib', bank: 'bochk', route: 'CNH', count: 1, mainlandMethod: 'swift', senderFeeCny: '' });
  const html = ui.render();
  assert.match(html, /人民币跨境电汇 · 标准价/);
  assert.match(html, /99.80 CNY/); assert.match(html, /100.00 CNY/);
  assert.doesNotMatch(html, /人民币资费未收录|普通汇款 · 寰宇人生卡/);
  ui.act('pick', '', 'startBank');
  assert.match(ui.modal(), /人民币跨境1‰、50–200元＋100元电讯费/);
  ui.act('detail', '', 'cost');
  assert.match(ui.modal(), /汇出手续费<\/span><b>99.80 CNY/);
  assert.match(ui.modal(), /汇出电讯费<\/span><b>100.00 CNY/);
  ui.act('detail', '', 'edge-01');
  assert.match(ui.modal(), /人民币跨境1‰、50–200元＋100元电讯费/);
  assert.doesNotMatch(ui.modal(), /data-money-field="usedFreeTransfers"|前30笔/);
  ui.act('choose', 'route', 'USD');
  assert.equal(ui.saved().bank, 'bochk'); assert.equal(ui.saved().startBank, 'cib');
  assert.match(ui.render(), /普通汇款/);
  ui.act('detail', '', 'edge-01');
  assert.match(ui.modal(), /外汇汇出手续费免，优惠期前30笔电讯费免/);
  assert.match(ui.modal(), /data-money-field="usedFreeTransfers"/);
});

test('missing terminal FX never forces a different bank, erases the total, or shows a zero loss rate', () => {
  const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'swift', outcome: 'cnh-card', returnBank: 'hsbc' });
  const html = ui.render(), edge = html.split('aria-label="美元直接换人民币 → 商户刷卡"')[1].split('</section>')[0];
  assert.equal((html.match(/data-flow-stage=/g) || []).length, 4);
  assert.match(html, /汇丰 HSBC One/); assert.match(html, /已计费用占本金 · 含估算/);
  assert.match(html, /最后可计余额/); assert.doesNotMatch(edge, /0.000%/);
  assert.doesNotMatch(edge, /历史报价/);
  assert.doesNotMatch(html, /请选择中银香港消费账户/);
});

test('partial journeys retain the counted cost percentage and amount without calling it a complete loss', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const cases = [
    { input: { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'ibkr', returnBank: 'bochk', months: 0,
      mainlandMethod: 'boc-mobile', depositMethod: 'chats', outcome: 'usd-balance', intermediaryCny: '' }, quotes },
    { input: { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'ibkr', returnBank: 'sc', months: 0,
      mainlandMethod: 'boc-mobile', depositMethod: 'chats', outcome: 'mainland', exitBank: 'boc', returnCurrency: 'HKD',
      returnHkdPrice: '', intermediaryCny: '', returnExtraCny: '' }, quotes },
    { input: { ...currentRoute, startBank: 'icbc', bank: 'hsbc', broker: 'za', outcome: 'broker-balance', mainlandMethod: 'full',
      hsbcBalanceWaiver: false }, quotes: (() => { const q = structuredClone(quotes); delete q.banks.icbc; return q; })() }
  ];
  for (const { input, quotes: q } of cases) {
    const config = { ...input, date: '2026-10-11' }, r0 = M.calculatorJourney(config, D, q), r = r0.selected || r0.partial;
    const counted = r.rows.reduce((sum, row) => sum + (row.cny ?? 0), 0);
    assert.ok(counted > 0); assert.ok(r.rows.some(row => row.cny == null) || r0.error);
    const ui = moneyUi(config, q, config.date), html = ui.render();
    const total = html.split('id="flow-live-summary"')[1].split('</div><div class="flow-result-equation">')[0];
    assert.match(total, /已计费用占本金|已核费用占本金/);
    assert.ok(total.includes((counted / config.budgetCny * 100).toFixed(3) + '%'), total);
    assert.ok(total.includes(counted.toFixed(2) + ' CNY'), total);
    assert.doesNotMatch(total, /<span>全程损耗|<span>参考总损耗|NaN|undefined/);
    assert.match(total, /总损耗尚缺|尚未完成/);
    const keyGroups = [
      ['内地购美元 → 汇往香港', ['sender', 'entryFx', 'entryMiddle', 'entryInward']],
      ['出金 →', ['withdraw', 'returnInward', 'withdrawMiddle']],
      ['香港换港币 →', ['returnFx', 'returnWire', 'returnOther', 'exitFx']]
    ];
    for (const [title, keys] of keyGroups) {
      const rows = r.rows.filter(row => keys.includes(row.key)), cost = rows.reduce((sum, row) => sum + (row.cny ?? 0), 0);
      const section = html.match(/<section class="flow-edge"[\s\S]*?<\/section>/g)?.find(section => section.includes('aria-label="' + title));
      if (!section || !rows.some(row => row.cny == null) || cost === 0) continue;
      const loss = section.split('class="flow-edge-loss"')[1].split('</div>')[0];
      assert.match(loss, /费用占本金/);
      assert.ok(loss.includes((cost / config.budgetCny * 100).toFixed(3) + '%'), loss);
      assert.ok(loss.includes(cost.toFixed(2) + ' CNY'), loss);
    }
  }
});

test('nonzero costs too small for three percentage decimals never appear as zero percent', () => {
  const q = require('./fixtures/money-flow-quotes-20261011.json');
  const config = { ...currentRoute, date: '2026-10-11', startBank: 'boc', bank: 'bochk', broker: 'za',
    outcome: 'broker-balance', months: 0, mainlandMethod: 'boc-mobile', depositMethod: 'chats', tradeFeeUsd: '.01',
    senderFeeCny: 0, entryMiddleCny: 0, startSell: '6.7111' };
  const html = moneyUi(config, q, config.date).render();
  const trade = html.split('aria-label="买入美股 → 卖出"')[1].split('</section>')[0];
  const ratio = trade.match(/class="flow-edge-loss"[\s\S]*?<strong class="num">([^<]+)%/)[1];
  assert.ok(Number(ratio) > 0); assert.ok(Number(ratio) < .0005);
  assert.doesNotMatch(trade.split('class="flow-edge-loss"')[1].split('</div>')[0], />0\.000%/);
  const r = M.calculatorJourney(config, D, q).selected;
  assert.ok(Math.abs(Number(ratio) - r.rows.find(row => row.key === 'trade').cny / config.budgetCny * 100) < 1e-7);
});

test('stale quotes never make an incomplete fee subtotal look like a complete historical loss', () => {
  const q = require('./fixtures/money-flow-quotes-20261011.json');
  const input = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'ibkr', returnBank: 'bochk', months: 0,
    mainlandMethod: 'boc-mobile', depositMethod: 'chats', outcome: 'usd-balance', intermediaryCny: '' };
  const html = moneyUi(input, q, '2026-10-20').render();
  const summary = html.split('id="flow-live-summary"')[1];
  assert.match(summary, /已计费用占本金 · 含估算 · 历史报价/);
  assert.match(summary, /总损耗尚缺：/);
  assert.doesNotMatch(summary, /全程损耗 · 历史报价|参考总损耗/);
});

test('missing funding FX is named consistently alongside explicitly labelled reference balances', () => {
  for (const [broker, fxMode, bank, expected] of [
    ['za', 'bank', 'sc', /渣打 · 快易理财 CNH\/USD成交价尚未取得/],
    ['ibkr', 'manual', 'bochk', /IBKR CNH\/USD成交价尚未取得/]
  ]) {
    const config = { ...currentRoute, startBank: 'boc', bank, route: 'CNH', broker, fxMode,
      mainlandMethod: 'swift', depositMethod: fxMode === 'bank' ? 'chats' : 'fps', outcome: 'broker-balance' };
    const r = M.calculatorJourney({ ...config, sellDate: '2026-10-09' }, D, cibQuotes).selected;
    assert.ok(r?.indicativeFx);
    assert.match(r.rows.find(x => x.key === 'trade').estimate, /交易金额按参考汇率估算/);
    const parts = r.rows.find(x => x.key === 'trade').items;
    const knownParts = broker === 'za' ? ['买入佣金', '卖出佣金', '买入SEC费', '买入TAF费', '买入CAT费'] : ['买入平台费', '卖出平台费', '买入清算费', '买入SEC费', '买入TAF费'];
    const estimatedParts = broker === 'za' ? ['买入平台费', '卖出平台费', '卖出SEC费'] : ['买入佣金', '卖出佣金', '买入CAT费', '卖出SEC费'];
    for (const label of knownParts) assert.equal(parts.find(x => x.label === label).estimate, false, label);
    for (const label of estimatedParts) assert.ok(parts.find(x => x.label === label).estimate, label);
    for (const key of ['sender', 'entryInward', 'depositBank', 'depositBroker', 'account']) assert.equal(r.rows.find(x => x.key === key).estimate, undefined, key);
    const ui = moneyUi(config), html = ui.render();
    assert.match(html, expected);
    const trade = html.split('aria-label="买入美股 → 卖出"')[1].split('</section>')[0];
    assert.match(trade, /参考损耗/); assert.match(moneyDetails(ui, 'edge-trade'), /估算 .*? USD/);
    assert.match(html.split('id="flow-live-summary"')[1], /已计费用占本金 · 含估算/);
    for (const key of ['edge-03', 'cost']) {
      ui.act('detail', '', key);
      assert.match(ui.modal(), expected);
      assert.doesNotMatch(ui.modal(), /换汇.*?<b>按实际汇路收费|未报价换汇估值差额|本金 ＋/);
      if (key === 'cost') assert.match(ui.modal(), new RegExp('参考最终余额.*' + r.net.toFixed(2) + ' USD'));
      if (key === 'cost') for (const label of knownParts) assert.doesNotMatch(ui.modal(), new RegExp(label + '</span><b>估算'));
    }
    const quoted = M.calculatorJourney({ ...config, entryPrice: 7 }, D, cibQuotes).selected;
    assert.equal(quoted.indicativeFx, ''); assert.equal(quoted.rows.find(x => x.key === 'trade').estimate, undefined);
    const confirmedFee = M.calculatorJourney({ ...config, tradeFeeUsd: 10 }, D, cibQuotes).selected;
    assert.equal(confirmedFee.rows.find(x => x.key === 'trade').estimate, undefined);
    close(confirmedFee.rows.find(x => x.key === 'trade').cny, 10 * confirmedFee.refs.USD);
  }
});

test('unquoted funding propagates into amount-based conversion fees without changing fixed transfer tariffs', () => {
  const config = { ...currentRoute, startBank: 'cib', bank: 'bochk', broker: 'ibkr', route: 'CNH', fxMode: 'auto', mainlandMethod: 'swift', depositMethod: 'fps',
    outcome: 'cnh-card', returnBank: 'bochk', entryPrice: '', exitPrice: '' };
  const r = M.calculatorJourney(config, D, cibQuotes).selected;
  for (const key of ['brokerFx', 'trade', 'returnInward', 'exitFx']) assert.ok(r.rows.find(x => x.key === key).estimate, key);
  for (const key of ['sender', 'depositBank', 'withdraw', 'brokerAccount', 'account']) assert.equal(r.rows.find(x => x.key === key).estimate, undefined, key);
  const quoted = M.calculatorJourney({ ...config, entryPrice: 7.2 }, D, cibQuotes).selected;
  for (const key of ['brokerFx', 'trade', 'returnInward', 'exitFx']) assert.equal(quoted.rows.find(x => x.key === key).estimate, undefined, key);
});

test('missing terminal and source FX never leak reference rates or an executable CNY equation into details', () => {
  const terminalQuotes = structuredClone(cibQuotes); delete terminalQuotes.banks.icbc;
  const config = { ...currentRoute, startBank: 'cib', route: 'USD', fxMode: 'bank', outcome: 'mainland', exitBank: 'icbc', exitPrice: '', returnMethod: 'swift' };
  const r = M.calculatorJourney({ ...config, sellDate: '2026-10-09' }, D, terminalQuotes).selected;
  assert.equal(r?.indicativeExit, true);
  const ui = moneyUi(config, terminalQuotes), html = ui.render();
  const exit = html.split('aria-label="内地结汇"')[1].split('</section>')[0];
  assert.doesNotMatch(exit, /1 USD =/);
  ui.act('detail', '', 'cost');
  assert.match(ui.modal(), new RegExp('最后可计余额：' + r.steps.remitUsd.toFixed(2) + ' USD'));
  assert.doesNotMatch(ui.modal(), /未报价换汇估值差额|本金 ＋/);
  const q = structuredClone(cibQuotes); delete q.banks.cib;
  const source = moneyUi({ ...config, outcome: 'broker-balance' }, q); source.render(); source.act('detail', '', 'cost');
  assert.match(source.modal(), /USD现汇卖出价尚未取得/);
  assert.doesNotMatch(source.modal(), /未报价换汇估值差额|本金 ＋|最后可计余额/);
});

test('detail reconciliation stays available for priced routes but not stale FX conversions', () => {
  const config = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', mainlandMethod: 'boc-mobile', route: 'USD', outcome: 'broker-balance' };
  const ui = moneyUi(config); ui.render(); ui.act('detail', '', 'cost');
  assert.match(ui.modal(), /余额 \d+\.\d{2} USD，折合 \d+\.\d{2} CNY/);
  assert.match(ui.modal(), /人民币折算尾差按余数分配/);
  const q = structuredClone(cibQuotes); q.banks.boc.quotes.USD.asOf = '2020-01-01';
  const stale = moneyUi(config, q); stale.render(); stale.act('detail', '', 'cost');
  assert.doesNotMatch(stale.modal(), /本金 ＋|最后可计余额/);
  const fundingQuotes = structuredClone(cibQuotes);
  fundingQuotes.offshoreUsd.hsbc = { quotes: { CNH: { bidPerUsd: 6.8, askPerUsd: 7, asOf: '2020-01-01' } } };
  const fundingConfig = { ...currentRoute, startBank: 'boc', route: 'CNH', mainlandMethod: 'swift', fxMode: 'bank', outcome: 'broker-balance' };
  const r = M.calculatorJourney(fundingConfig, D, fundingQuotes).selected;
  assert.equal(r?.quoteFreshness.entryMarket, false); assert.equal(r?.indicativeFx, '');
  const funding = moneyUi(fundingConfig, fundingQuotes), html = funding.render();
  assert.match(html.split('id="flow-live-summary"')[1], /参考最终余额[\s\S]*USD/);
  funding.act('detail', '', 'cost');
  assert.match(funding.modal(), /参考最终余额.*USD/);
  assert.doesNotMatch(funding.modal(), /本金 ＋/);
});

test('CIB settlement does not extend the card FX discount past its published expiry', () => {
  const base = { ...currentRoute, outcome: 'mainland', exitBank: 'cib', returnMethod: 'swift', exitPrice: '', returnExtraCny: 0 };
  const before = M.journeyPlans({ ...base, months: 1 }, D, cibQuotes).selected;
  const after = M.journeyPlans({ ...base, months: 12 }, D, cibQuotes).selected;
  close(before.exitPrice, 6.68905); close(after.exitPrice, 6.6827);
});

test('every bank, currency and stock venue renders its four stages even with unavailable quotes', () => {
  for (const start of D.mainlandBanks) for (const route of ['USD', 'HKD', 'CNH']) for (const broker of D.brokers) {
    const html = moneyUi({ ...currentRoute, startBank: start.id, route, broker: broker.id, fxMode: broker.id === 'ibkr' ? 'manual' : 'bank',
      mainlandMethod: start.id === 'hsbc' ? 'linked' : 'swift', depositMethod: route === 'USD' || broker.id !== 'ibkr' ? 'chats' : 'fps' }).render();
    assert.equal((html.match(/data-flow-stage=/g) || []).length, 4, [start.id, route, broker.id].join('/'));
    assert.doesNotMatch(html, /NaN|undefined|<select/);
  }
});

test('old channel settings are repairable with an explicit channel choice', () => {
  const ui = moneyUi({ ...currentRoute, mainlandMethod: 'boc-mobile' });
  assert.match(ui.render(), /汇款渠道：请选择/);
  ui.act('control-pick', '', 'mainlandMethod');
  assert.match(ui.modal(), /data-value="swift"/); assert.doesNotMatch(ui.modal(), /data-value="cib-go"/);
  ui.act('choose', 'mainlandMethod', 'swift');
  assert.doesNotMatch(ui.render(), /汇款渠道：请选择|向境外中行渠道须/);
});

test('bank and broker lists keep stable order and remain enabled after every choice', () => {
  const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'swift', bank: 'bochk', returnBank: 'bochk', senderFeeCny: '99', entryMiddleCny: '0' });
  ui.render();
  const ids = modal => [...modal.matchAll(/data-value="([^"]+)"/g)].map(m => m[1]);
  for (const broker of D.calculator.brokers) {
    ui.act('choose', 'broker', broker);
    assert.equal(ui.saved().bank, 'bochk'); assert.equal(ui.saved().returnBank, 'bochk');
    assert.equal(ui.saved().senderFeeCny, '99'); assert.equal(ui.saved().entryMiddleCny, '0');
    ui.act('pick', '', 'startBank'); assert.deepEqual(ids(ui.modal()), D.calculator.departureBanks); assert.doesNotMatch(ui.modal(), /农业银行|\bdisabled\b/);
    ui.act('pick', '', 'bank'); assert.deepEqual(ids(ui.modal()), D.calculator.hkBanks);
    ui.act('pick', '', 'broker'); assert.deepEqual(ids(ui.modal()), D.calculator.brokers); assert.doesNotMatch(ui.modal(), /\bdisabled\b/);
  }
});

test('incompatible card choices remain editable and never lock unrelated bank selections', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', count: 2, mainlandMethod: 'boc-mobile', bank: 'bochk', returnBank: 'za' });
  ui.render(); ui.act('pick', '', 'outcome'); assert.doesNotMatch(ui.modal(), /\bdisabled\b/);
  ui.act('choose', 'outcome', 'usd-card'); assert.equal(ui.saved().outcome, 'usd-card');
  assert.match(ui.render(), /不支持.*美元/);
  ui.act('choose', 'returnBank', 'bochk'); assert.equal(ui.saved().returnBank, 'bochk');
  assert.match(ui.render(), /参考总损耗/);
});

test('uSMART local USD cheques and digital-bank withdrawals retain their separate charges and minimum', () => {
  const config = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', mainlandMethod: 'boc-mobile',
    depositMethod: 'internal', outcome: 'usd-balance', returnBank: 'bochk', inwardHkd: '', intermediaryCny: '', months: 0 };
  for (const returnBank of ['bochk', 'hsbc', 'hang', 'sc']) {
    const r = M.calculatorJourney({ ...config, returnBank }, D, cibQuotes).selected;
    for (const key of ['withdraw', 'withdrawMiddle']) close(r.rows.find(x => x.key === key).cny, 0);
    close(r.rows.find(x => x.key === 'returnInward').cny, returnBank === 'hsbc' ? 5 * r.refs.HKD : 0);
    assert.match(r.rows.find(x => x.key === 'returnInward').label, /支票/);
  }
  const digital = M.calculatorJourney({ ...config, returnBank: 'za' }, D, cibQuotes).selected;
  close(digital.rows.find(x => x.key === 'returnInward').cny, 7.5 * digital.refs.USD);
  assert.match(digital.rows.find(x => x.key === 'returnInward').estimate, /约7.5/);
  const small = { ...config, budgetCny: 21 * cibQuotes.banks.boc.quotes.USD.sell, tradeFeeUsd: 0 };
  const traditional = M.calculatorJourney(small, D, cibQuotes).selected;
  assert.ok(traditional); close(traditional.net, 21);
  const boundary = M.calculatorJourney({ ...small, budgetCny: 20 * cibQuotes.banks.boc.quotes.USD.sell, returnBank: 'za' }, D, cibQuotes);
  assert.match(boundary.error, /超过20 USD/); assert.equal(boundary.partial.errorStage, '04');
});

test('SC local USD bank charge retains its native unit in the fee detail', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'sc', broker: 'za', route: 'USD', mainlandMethod: 'swift', depositMethod: 'chats' });
  ui.render(); const funding = moneyDetails(ui, 'edge-03');
  assert.match(funding, /22.00 USD/); assert.doesNotMatch(funding, /22.00 HKD/);
});

test('an only available transfer method is readable without opening an empty choice dialog', () => {
  const html = moneyUi({ ...currentRoute, startBank: 'cmb', bank: 'bochk', broker: 'za', route: 'USD', mainlandMethod: 'swift', depositMethod: 'chats' }).render();
  assert.match(html, /flow-control-value[^>]*>个人跨境汇款/);
  assert.match(html, /flow-control-value[^>]*>本地美元转账 → 本人众安 ZA Bank账户/);
  assert.doesNotMatch(html, /money-flow-control-pick[^>]*data-value="(?:mainlandMethod|depositMethod)"/);
  assert.match(html, /data-value="bank"/); assert.match(html, /data-value="broker"/);
});

test('ICBC and SC China inward bank fees are zero without waiving separate intermediary costs', () => {
  for (const exitBank of ['icbc', 'sc']) {
    // Keep the historical tariff audit even though SC China is retired from
    // the product's receiving-bank catalogue. The public picker is tested separately.
    const r = M.mainlandJourney({ ...currentRoute, outcome: 'mainland', returnBank: 'bochk', exitBank,
      returnMethod: 'swift', returnExtraCny: '' }, D, cibQuotes).selected;
    const fees = r.rows.find(x => x.key === 'returnOther');
    assert.equal(fees.cny, null); assert.equal(fees.items[0].cny, null); close(fees.items[1].cny, 0);
  }
});

test('a published approximate digital-bank withdrawal fee is labeled in both the step and total', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', mainlandMethod: 'boc-mobile',
    depositMethod: 'internal', outcome: 'usd-balance', returnBank: 'za', inwardHkd: '', intermediaryCny: '', months: 0 });
  const html = ui.render();
  assert.match(html, /参考损耗/); assert.match(html, /参考总损耗/); assert.match(moneyDetails(ui, 'edge-withdraw'), /公布约7.5 USD/);
  assert.match(html, /按公布参考价费计算的余额/);
});

test('an incomplete or inapplicable voucher never claims that a discount is active', () => {
  const html = moneyUi({ ...currentRoute, useVoucher: true, voucherUsd: '0', voucherExpiry: '' }).render();
  assert.match(html, /费用券 · 未抵扣/); assert.doesNotMatch(html, /费用券 · 已启用/);
});

test('missing source FX keeps independent sender charges without a fabricated foreign balance', () => {
  const q = structuredClone(cibQuotes); delete q.banks.cmb;
  const config = { ...currentRoute, startBank: 'cmb', bank: 'hsbc', broker: 'za', route: 'USD', mainlandMethod: 'swift', startSell: '',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '' };
  const data = M.calculatorJourney(config, D, q), r = data.partial;
  assert.equal(data.selected, undefined); assert.equal(r.errorStage, '01'); assert.equal(r.missingQuote, 'USD');
  close(r.rows.find(x => x.key === 'sender').cny, 199.80019980019983);
  assert.equal(r.rows.find(x => x.key === 'entryFx').cny, null);
  assert.equal(r.rows.find(x => x.key === 'entryMiddle').cny, null);
  close(r.rows.find(x => x.key === 'entryInward').cny, 0);
  assert.deepEqual(r.steps, {});
  const html = moneyUi(config, q).render();
  assert.match(html, /199.80 CNY/); assert.match(html, /现汇卖出价尚未取得/);
  assert.doesNotMatch(html, /1 USD = —|NaN|undefined/);
  const source = html.split('aria-label="汇往香港"')[1].split('</section>')[0];
  assert.doesNotMatch(source, /0.000%/);
  assert.equal((source.match(/现汇卖出价尚未取得/g) || []).length, 1);
  const sc = M.calculatorJourney({ ...config, startBank: 'sc', bank: 'sc', mainlandMethod: 'linked' }, D, q).partial;
  for (const key of ['sender', 'entryMiddle', 'entryInward']) close(sc.rows.find(x => x.key === key).cny, 0);
  const charged = M.calculatorJourney({ ...config, hsbcBalanceWaiver: false, balanceHkd: 0, monthlyHkd: '' }, D, q).partial;
  close(charged.rows.find(x => x.key === 'account').cny, 1200 * charged.refs.HKD);
  assert.doesNotMatch(html, /全程损耗 · 历史报价/);
  const unquoted = structuredClone(q); delete unquoted.banks.icbc;
  const missingTariff = structuredClone(D); const sourceBank = missingTariff.mainlandBanks.find(bank => bank.id === 'icbc'); sourceBank.rate = null; sourceBank.telegram = null;
  const allUnknown = moneyUi({ ...config, startBank: 'icbc', bank: 'bochk', returnBank: 'bochk' }, unquoted, '2026-10-09', missingTariff).render();
  const unknownTransfer = allUnknown.split('aria-label="汇往香港"')[1].split('</section>')[0];
  assert.match(unknownTransfer, /class="num">—</); assert.doesNotMatch(unknownTransfer, /0.00 CNY/);
});

test('SC RMB debit eligibility is separate from USD debit support and preserves prior balances', () => {
  const input = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', mainlandMethod: 'boc-mobile',
    returnBank: 'sc', outcome: 'cnh-card', exitPrice: 6.5 };
  const blocked = M.calculatorJourney(input, D, cibQuotes);
  assert.match(blocked.error, /有效香港身份证/);
  assert.equal(blocked.partial.errorStage, '04');
  assert.ok(blocked.partial.steps.returnUsd > 0);
  assert.ok(blocked.partial.trading.orders.length === 2);
  close(blocked.partial.rows.find(x => x.key === 'account').cny, 0);
  assert.ok(!blocked.partial.rows.some(x => x.key === 'exitFx'));
  const allowed = M.calculatorJourney({ ...input, scCnhAccount: true }, D, cibQuotes).selected;
  assert.ok(allowed);
  close(allowed.steps.terminal, blocked.partial.steps.returnUsd * 6.5);
  close(allowed.rows.find(x => x.key === 'card').cny, 0);
  const usd = M.calculatorJourney({ ...input, outcome: 'usd-card' }, D, cibQuotes).selected;
  assert.ok(usd); close(usd.rows.find(x => x.key === 'card').cny, 0);
  const za = M.calculatorJourney({ ...input, returnBank: 'za' }, D, cibQuotes);
  assert.match(za.error, /不支持人民币余额原币消费/);
  assert.ok(za.partial.steps.returnUsd > 0);
  const html = moneyUi(input).render();
  assert.match(html, /data-money-check="scCnhAccount"/);
  assert.match(html, /最后可计余额/);
  assert.match(html, /买1笔 · 卖1笔/);
  assert.equal((html.match(/渣打[^<]*人民币原币消费须持有效香港身份证/g) || []).length, 1);
  assert.doesNotMatch(moneyUi({ ...input, outcome: 'usd-card' }).render(), /data-money-check="scCnhAccount"/);
});

test('SC Priority standard overseas FX remittance waives sender fees without waiving other banks', () => {
  for (const route of ['USD', 'HKD']) {
    const input = { ...currentRoute, startBank: 'sc', bank: 'bochk', broker: 'za', route, mainlandMethod: 'swift',
      outcome: 'broker-balance', senderFeeCny: '', entryMiddleCny: '' };
    const data = M.calculatorJourney(input, D, cibQuotes), r = data.selected || data.partial;
    close(r.rows.find(x => x.key === 'sender').cny, 0);
    assert.equal(r.rows.find(x => x.key === 'entryMiddle').cny, null);
    assert.equal(data.partial.missingQuote, route);
  }
  const cnh = M.calculatorJourney({ ...currentRoute, startBank: 'sc', bank: 'bochk', broker: 'za', route: 'CNH', fxMode: 'bank',
    outcome: 'broker-balance', mainlandMethod: 'swift', senderFeeCny: '' }, D, cibQuotes).selected;
  close(cnh.rows.find(x => x.key === 'sender').cny, 0);
  assert.equal(cnh.rows.find(x => x.key === 'entryMiddle').cny, null);
});

const chequeRoute = { budgetCny: 100000, count: 1, months: 12, date: '2026-10-11', usedFreeTransfers: 0,
  profitUsd: 0, taxRate: 20, creditCny: 0, withdrawalIndex: 1, buyOrders: 1, sellOrders: 1, sharePriceUsd: 100,
  startBank: 'boc', bank: 'bochk', broker: 'chief', route: 'USD', returnBank: 'sc', exitBank: 'boc',
  outcome: 'usd-balance', mainlandMethod: 'boc-mobile', depositMethod: 'internal' };

test('the best purchase and settlement banks both use one absolute midpoint reference without resetting either leg to zero', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const config = { ...chequeRoute, date:'2026-10-12', sellDate:'2026-10-12', startBank:'cib', bank:'hsbc', broker:'za', returnBank:'hsbc', exitBank:'cib',
    outcome:'mainland', route:'USD', mainlandMethod:'swift', depositMethod:'chats', returnMethod:'swift', returnCurrency:'USD',
    senderFeeCny:0, entryMiddleCny:0, entryInwardHkd:0, depositHkd:0, depositOtherCny:0, inwardHkd:0, intermediaryCny:0,
    returnWireHkd:0, returnExtraCny:0, tradeFeeUsd:0, months:0 };
  const r=M.calculatorJourney(config,D,quotes).selected;
  const reference=(quotes.banks.boc.quotes.USD.buy+quotes.banks.boc.quotes.USD.sell)/2;
  const bank=M.quotedMainlandBanks(D,quotes,config.date).find(bank=>bank.id==='cib');
  assert.equal(M.purchaseComparison(config,D,quotes).best.bank.id,'cib');
  assert.equal(bank.quotes.USD.buy,Math.max(...M.quotedMainlandBanks(D,quotes,config.date).filter(bank=>D.calculator.receivingBanks.includes(bank.id)).map(bank=>bank.quotes.USD.buy)));
  assert.equal(r.pricingBasis,'reference-mid'); close(r.refs.USD,reference);
  close(r.steps.mainlandForeign,config.budgetCny/bank.quotes.USD.sell);
  close(r.steps.mainlandReceived,r.steps.mainlandForeign);
  close(r.net,config.budgetCny*bank.quotes.USD.buy/bank.quotes.USD.sell);
  const entry=r.rows.find(row=>row.key==='entryFx'), exit=r.rows.find(row=>row.key==='exitFx');
  assert.ok(entry.cny>0); assert.ok(exit.cny>0);
  close(entry.cny,config.budgetCny-r.steps.mainlandForeign*reference);
  close(exit.cny,r.steps.mainlandReceived*(reference-bank.quotes.USD.buy));
  close(entry.cny+exit.cny,config.budgetCny-r.net);
  close(r.costCny,config.budgetCny-r.net); close(r.fxImpactCny,0);
  for(const startBank of D.calculator.departureBanks) for(const exitBank of D.calculator.receivingBanks) {
    const other=M.calculatorJourney(M.calculatorRoute({...config,startBank,exitBank,mainlandMethod:'',returnMethod:''}),D,quotes).selected;
    assert.deepEqual(other.refs,r.refs); // Changing accounts never redefines valuation.
  }
  const custom=M.calculatorJourney({...config,startSell:6.6},D,quotes).selected;
  assert.deepEqual(custom.refs,r.refs); assert.ok(custom.rows.find(row=>row.key==='entryFx').cny<0);
  close(custom.costCny,custom.budgetCny-custom.netCny); close(custom.fxImpactCny,0);
});

test('USD, HKD and CNH entry routes and both return currencies reconcile every FX leg at the same reference vector', () => {
  const quotes=require('./fixtures/money-flow-quotes-20261012.json');
  // Confirmed zero-fee test inputs isolate valuation from unpriced intermediary
  // tariffs; these are not assertions that the public routes are all free.
  const base={...chequeRoute,date:'2026-10-12',sellDate:'2026-10-12',bank:'hsbc',broker:'za',returnBank:'hsbc',outcome:'mainland',fxMode:'bank',
    senderFeeCny:0,entryMiddleCny:0,entryInwardHkd:0,depositHkd:0,depositOtherCny:0,inwardHkd:0,intermediaryCny:0,
    returnWireHkd:7,returnExtraCny:3,tradeFeeUsd:5,months:0,profitUsd:250,taxRate:0};
  for(const startBank of D.calculator.departureBanks) for(const exitBank of D.calculator.receivingBanks)
    for(const route of D.calculator.currencies) for(const returnCurrency of ['USD','HKD']) {
      const config=M.calculatorRoute({...base,startBank,exitBank,route,returnCurrency,mainlandMethod:'',depositMethod:'',returnMethod:''});
      const data=M.calculatorJourney(config,D,quotes), r=data.selected;
      assert.ok(r,[startBank,exitBank,route,returnCurrency,data.error].join('/'));
      assert.equal(r.complete,true,r.missing.join('/'));
      close(r.rows.find(row=>row.key==='entryFx').cny,route==='CNH'?0:(r.steps.mainlandForeign*r.startSell-r.steps.mainlandForeign*r.refs[route]));
      close(r.rows.find(row=>row.key==='exitFx').cny,r.steps.mainlandReceived*r.refs[returnCurrency]-r.steps.settledCny);
      const transfer=r.rows.filter(row=>['returnWire','returnOther'].includes(row.key));
      assert.ok(transfer.every(row=>row.step==='remit')); assert.equal(r.rows.find(row=>row.key==='exitFx').step,'settle');
      close((returnCurrency==='HKD'?r.steps.returnHkd:r.steps.returnUsd)-r.steps.mainlandReceived,transfer.reduce((sum,row)=>sum+row.cny,0)/r.refs[returnCurrency]);
      close(r.costCny,r.budgetCny+r.profitUsd*r.refs.USD-r.netCny); close(r.fxImpactCny,0);
      const ledger=M.flowLedger(r);
      for(const leg of ledger.legs) close(leg.lossCny,leg.costCny+leg.taxCny-leg.fxImpactCny);
    }
});

test('Chief and uSMART reconcile SC cheque deposits identically and keep bank-specific charges separate', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const broker of ['chief', 'usmart']) {
    const run = changes => M.calculatorJourney({ ...chequeRoute, broker, ...changes }, D, quotes);
    const first = run({}).selected;
    assert.ok(first.complete, first.missing.join(', '));
    close(first.rows.find(row => row.key === 'returnInward').cny, 0);
    assert.deepEqual(first.rows.find(row => row.key === 'returnInward').sources, ['scCheque', 'scChequeDeposit']);
    for (const [chequePreFilled, hkd] of [[false, 2], [true, 1]]) {
      const paid = run({ chequeIndex: 31, chequePreFilled }).selected;
      assert.ok(paid.complete, paid.missing.join(', '));
      close(paid.rows.find(row => row.key === 'returnInward').cny, hkd * paid.refs.HKD);
      close(paid.costCny - first.costCny, hkd * paid.refs.HKD);
      close(first.net - paid.net, hkd * paid.refs.HKD / paid.refs.USD);
      close(paid.budgetCny - paid.costCny + paid.fxImpactCny, paid.netCny);
      close(paid.rows.find(row => row.key === 'entryInward').cny, 0);
    }
    const invalid = run({ chequeIndex: 1.5 });
    assert.match(invalid.error, /当日存票序号/);
    assert.equal(invalid.partial.errorAction, 'withdraw');
    assert.ok(invalid.partial.steps.proceedsUsd > 0);
    const unused = run({ returnBank: 'hsbc', hsbcBalanceWaiver: true, chequeIndex: 'invalid', withdrawalIndex: 0 }).selected;
    assert.ok(unused.complete, unused.missing.join(', '));
    close(unused.rows.find(row => row.key === 'returnInward').cny, 0);
  }
  const ibkrInvalid = M.calculatorJourney({ ...chequeRoute, broker: 'ibkr', depositMethod: 'chats', withdrawalIndex: 0 }, D, quotes);
  assert.match(ibkrInvalid.error, /本月券商出金次数/);
  assert.ok(ibkrInvalid.partial.steps.hongKong > 0);
  assert.ok(ibkrInvalid.partial.steps.proceedsUsd > 0);
  const kept = M.calculatorJourney({ ...chequeRoute, outcome: 'broker-balance', withdrawalIndex: 0, chequeIndex: 'invalid' }, D, quotes).selected;
  assert.ok(kept.complete, kept.missing.join(', '));
});

test('cheque qualification is visible beside its fee and unused withdrawal controls do not appear', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...chequeRoute, chequeIndex: 31 }, quotes, '2026-10-11');
  let html = ui.render();
  assert.match(html, /存票当日第31张/);
  assert.match(moneyDetails(ui, 'edge-withdraw'), /当日第31张；每日前30张免费/);
  assert.match(ui.modal(), /2.00 HKD/);
  ui.act('detail', '', 'profit-settings');
  assert.match(ui.modal(), /存票当日第几张支票/);
  assert.match(ui.modal(), /已预填多支票存款表/);
  assert.doesNotMatch(ui.modal(), /本月第几次出金/);
  assert.ok(evidenceLinks(ui, 'edge-withdraw').has(D.sources.scCheque.url));
  assert.ok(evidenceLinks(ui, 'edge-withdraw').has(D.sources.scChequeDeposit.url));
  const invalid = moneyUi({ ...chequeRoute, chequeIndex: 0 }, quotes, '2026-10-11');
  invalid.render(); invalid.act('detail', '', 'profit-settings');
  assert.match(invalid.modal(), /aria-invalid="true"/);
  assert.match(invalid.modal(), /当日存票序号须为正整数/);
  ui.act('choose', 'returnBank', 'bochk'); ui.render(); ui.act('detail', '', 'profit-settings');
  assert.match(ui.modal(), /存票当日第几张支票/);
  assert.doesNotMatch(ui.modal(), /已预填多支票存款表|本月第几次出金/);
  ui.act('choose', 'returnBank', 'hsbc'); ui.render(); ui.act('detail', '', 'profit-settings');
  assert.doesNotMatch(ui.modal(), /存票当日第几张支票|已预填多支票存款表|本月第几次出金/);
  ui.act('choose', 'broker', 'ibkr'); html = ui.render(); ui.act('detail', '', 'profit-settings');
  assert.match(html, /本月第1次出金/);
  assert.match(ui.modal(), /本月第几次出金/);
  assert.doesNotMatch(ui.modal(), /存票当日第几张支票/);
});

test('BOCHK daily cheque allowance survives stock account switches and restores the correct native fee', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const broker of ['chief', 'usmart']) for (const chequeIndex of [30, 31]) {
    const input = { ...chequeRoute, broker, returnBank: 'bochk', chequeIndex };
    const ui = moneyUi(input, quotes, '2026-10-12');
    let html = ui.render();
    assert.match(html, new RegExp('存票当日第' + chequeIndex + '张'));
    assert.match(moneyDetails(ui, 'edge-withdraw'), new RegExp('当日第' + chequeIndex + '张；每日前30张免费，其后1 HKD'));
    ui.act('detail', '', 'profit-settings');
    assert.match(ui.modal(), /存票当日第几张支票/);
    assert.match(ui.modal(), new RegExp((chequeIndex <= 30 ? '0' : '1') + '\\.00 HKD'));
    assert.doesNotMatch(ui.modal(), /已预填多支票存款表|本月第几次出金/);
    assert.ok(evidenceLinks(ui, 'edge-withdraw').has(D.sources.bochkChequeTariff.url));
    ui.act('pick', '', 'returnBank');
    const bankOption = ui.modal().match(/data-field="returnBank" data-value="bochk"[^>]*>(.*?)<\/button>/s)?.[1];
    assert.ok(bankOption);
    assert.match(bankOption, new RegExp('本地USD存票 · 当日第' + chequeIndex + '张：' + (chequeIndex <= 30 ? '0' : '1') + '\\.00 HKD'));
    assert.doesNotMatch(bankOption, /本地美元转账0|中行同名汇入0/);
    const scOption = ui.modal().match(/data-field="returnBank" data-value="sc"[^>]*>(.*?)<\/button>/s)?.[1];
    assert.match(scOption, new RegExp((chequeIndex <= 30 ? '0' : '2') + '\\.00 HKD'));
    const zaOption = ui.modal().match(/data-field="returnBank" data-value="za"[^>]*>(.*?)<\/button>/s)?.[1];
    if (broker === 'chief') assert.match(zaOption, /不接受支票/);
    assert.doesNotMatch(ui.modal(), /disabled/);
    ui.act('choose', 'broker', broker === 'chief' ? 'usmart' : 'chief');
    html = ui.render();
    assert.match(html, new RegExp('存票当日第' + chequeIndex + '张'));
    assert.equal(ui.saved().returnBank, 'bochk');
    const restored = moneyUi(ui.saved(), quotes, '2026-10-12');
    assert.equal(restored.render(), html);
    restored.act('choose', 'returnBank', 'hsbc'); restored.render(); restored.act('detail', '', 'profit-settings');
    assert.doesNotMatch(restored.modal(), /存票当日第几张支票/);
    restored.act('choose', 'returnBank', 'bochk'); html = restored.render();
    assert.match(html, new RegExp('存票当日第' + chequeIndex + '张'));
  }
});

const pickerOption = (html, key, id) => {
  const option = html.match(new RegExp('data-field="' + key + '" data-value="' + id + '"[^>]*>(.*?)</button>', 's'))?.[1];
  assert.ok(option, key + ':' + id);
  return option;
};

test('all mainland/currency/stock combinations preview the incoming bank fee that is actually applied', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  let applied = 0, priced = 0;
  for (const startBank of D.calculator.mainland) for (const route of D.calculator.currencies) for (const broker of D.calculator.brokers) {
    const ui = moneyUi({ ...chequeRoute, startBank, route, broker, count: 2, bank: 'bochk', months: 1,
      mainlandMethod: '', depositMethod: '', fxMode: route === 'USD' ? 'manual' : 'bank',
      scCnhAccount: true, icbcCnhAccount: true }, quotes, '2026-10-12');
    ui.render();
    for (const bank of D.calculator.hkBanks) {
      ui.act('pick', '', 'bank');
      const menu = ui.modal(), option = pickerOption(menu, 'bank', bank);
      assert.equal((menu.match(/data-field="bank" data-value=/g) || []).length, 6);
      assert.doesNotMatch(menu, /disabled|中行同名汇入0|本地美元转账0|同名跨域转账0/);
      ui.act('choose', 'bank', bank); applied++;
      const result = M.calculatorJourney({ ...ui.saved(), date: '2026-10-12' }, D, quotes), r = result.selected || result.partial;
      const fee = r?.rows?.find(row => row.key === 'entryInward');
      if (fee?.cny != null) {
        assert.ok(option.includes((fee.cny / r.refs.HKD).toFixed(2) + ' HKD'), startBank + ':' + route + ':' + broker + ':' + bank + '\n' + option);
        assert.match(option, /2笔合计/); priced++;
      } else assert.doesNotMatch(option, /0\.00 HKD/);
      const account = r?.rows?.find(row => row.key === 'account')?.items?.find(item => item.region === 'hong-kong' && item.bankId === bank);
      if (account?.cny > 0) assert.ok(option.includes((account.cny / r.refs.HKD).toFixed(2) + ' HKD'), option);
    }
  }
  assert.equal(applied, D.calculator.mainland.length * D.calculator.currencies.length * D.calculator.brokers.length * D.calculator.hkBanks.length);
  assert.ok(priced > 700, 'known incoming fees must remain visible even when another step is missing');
});

test('return bank previews distinguish wire, local transfer, cheque and virtual-bank withdrawal across all endpoints', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  let applied = 0;
  for (const broker of D.calculator.brokers) for (const outcome of ['usd-balance', 'usd-card', 'cnh-card', 'mainland']) for (const returnCurrency of outcome === 'mainland' ? ['USD', 'HKD'] : ['USD']) {
    const ui = moneyUi({ ...chequeRoute, broker, outcome, returnCurrency, returnBank: 'bochk', exitBank: 'boc',
      chequeIndex: 31, months: 12, inwardHkd: '', hsbcBalanceWaiver: false }, quotes, '2026-10-12');
    ui.render();
    const provider = M.selectedBroker(ui.saved(), D);
    for (const bank of D.calculator.hkBanks) {
      ui.act('pick', '', 'returnBank');
      const menu = ui.modal(), option = pickerOption(menu, 'returnBank', bank);
      assert.equal((menu.match(/data-field="returnBank" data-value=/g) || []).length, 7);
      assert.doesNotMatch(menu, /disabled|中行同名汇入0|本地美元转账0|同名跨域转账0/);
      ui.act('choose', 'returnBank', bank); applied++;
      const result = M.calculatorJourney({ ...ui.saved(), date: '2026-10-12' }, D, quotes), r = result.selected || result.partial;
      const fee = r?.rows?.find(row => row.key === 'returnInward');
      if (provider.withdrawalMethod === 'cheque' && hk(bank).acceptsCheques === false) {
        assert.match(option, /不接受支票/); assert.match(result.error, /不接受支票/);
      } else if (fee?.cny != null) {
        const cheque = provider.withdrawalMethod === 'cheque' || provider.localChequeBanks?.includes(bank);
        const virtual = provider.withdrawalMethod === 'local' && !cheque;
        const expected = provider.integratedBank ? fee.cny.toFixed(2) + ' CNY' : virtual ? (fee.cny / r.refs.USD).toFixed(2) + ' USD' : (fee.cny / r.refs.HKD).toFixed(2) + ' HKD';
        assert.ok(option.includes(expected), broker + ':' + outcome + ':' + returnCurrency + ':' + bank + '\n' + option);
        assert.match(option, cheque ? /存票|支票/ : virtual ? /数字银行USD提款：参考/ : provider.integratedBank ? /USD本地转账|USD内部交收/ : /USD电汇收款费/);
      } else assert.doesNotMatch(option.split('；')[0], /(?:^|[：\s>])0\.00 (?:HKD|CNY)/);
      const account = r?.rows?.find(row => row.key === 'account')?.items?.find(item => item.region === 'hong-kong' && item.bankId === bank);
      if (account?.cny > 0) assert.ok(option.includes((account.cny / r.refs.HKD).toFixed(2) + ' HKD'), option);
    }
  }
  assert.equal(applied, D.calculator.brokers.length * 5 * D.calculator.hkBanks.length);
});

test('bank preview keeps personal receipt fees on their selected account and never transfers a waiver to a new account', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const ui = moneyUi({ ...chequeRoute, broker: 'ibkr', bank: 'bochk', returnBank: 'bochk', entryInwardHkd: 17,
    inwardHkd: 13, monthlyHkd: 0, returnMonthlyHkd: 0, hsbcBalanceWaiver: false, count: 2, depositMethod: 'chats' }, quotes, '2026-10-12');
  ui.render(); ui.act('pick', '', 'bank');
  assert.match(pickerOption(ui.modal(), 'bank', 'bochk'), /本人回单收款费：34\.00 HKD/);
  assert.match(pickerOption(ui.modal(), 'bank', 'hsbc'), /USD汇入费 · 2笔合计：0\.00 HKD/);
  assert.match(pickerOption(ui.modal(), 'bank', 'hsbc'), /12个月管理费/);
  assert.doesNotMatch(pickerOption(ui.modal(), 'bank', 'hsbc'), /本人回单|管理费0/);
  ui.act('pick', '', 'returnBank');
  assert.match(pickerOption(ui.modal(), 'returnBank', 'bochk'), /本人回单收款费：13\.00 HKD/);
  assert.match(pickerOption(ui.modal(), 'returnBank', 'hsbc'), /USD电汇收款费：0\.00 HKD/);
  assert.match(pickerOption(ui.modal(), 'returnBank', 'hsbc'), /12个月管理费/);
  ui.act('choose', 'returnBank', 'hsbc');
  assert.equal(ui.saved().inwardHkd, ''); assert.equal(ui.saved().returnMonthlyHkd, '');
  ui.act('pick', '', 'returnBank');
  assert.match(pickerOption(ui.modal(), 'returnBank', 'bochk'), /USD电汇收款费：60\.00 HKD/);
  assert.doesNotMatch(pickerOption(ui.modal(), 'returnBank', 'bochk'), /本人回单|13\.00 HKD/);
  for (const [change, key, expected] of [[{ entryInwardHkd: -1 }, 'bank', /须为非负数/],
    [{ inwardHkd: -1 }, 'returnBank', /须为非负数/], [{ entryInwardHkd: 1, count: '' }, 'bank', /汇出笔数须为正整数/]]) {
    const invalid = moneyUi({ ...chequeRoute, broker: 'ibkr', bank: 'bochk', returnBank: 'bochk', depositMethod: 'chats', ...change }, quotes, '2026-10-12');
    invalid.render(); invalid.act('pick', '', key);
    const option = pickerOption(invalid.modal(), key, 'bochk');
    assert.match(option, expected); assert.doesNotMatch(option, /0\.00 HKD|-1\.00 HKD/);
  }
});

test('inactive or other-broker offer inputs never change the selected account fees', () => {
  const inputs = [['hsbc', 'trade25', 'otherTurnoverHkd'], ['za', 'zaLv2', 'usedPromoOrders'], ['usmart', 'usmartPromo', 'usmartDays']];
  for (const id of D.calculator.brokers) for (let mask = 0; mask < 8; mask++) {
    const config = { ...feeConfig, ...Object.fromEntries(inputs.map(([, flag], i) => [flag, !!(mask & (1 << i))])) };
    const ordinary = M.brokerTradingFees(config, broker(id), 10000, 0, feeRefs);
    for (const invalid of [-1, 1.5, 'invalid', Infinity]) {
      const stale = { ...config, ...Object.fromEntries(inputs.filter(([owner, flag]) => owner !== id || !config[flag]).map(([, , key]) => [key, invalid])) };
      assert.deepEqual(M.brokerTradingFees(stale, broker(id), 10000, 0, feeRefs), ordinary, id + ':' + mask + ':' + invalid);
    }
  }
  for (const [id, flag, key] of inputs) for (const invalid of [-1, 'invalid', Infinity, ...(key === 'otherTurnoverHkd' ? [] : [1.5])]) {
    const r = M.brokerTradingFees({ ...feeConfig, [flag]: true, [key]: invalid }, broker(id), 10000, 0, feeRefs);
    assert.ok(r.error, id + ':' + key + ':' + invalid);
  }
  assert.ok(!M.brokerTradingFees({ ...feeConfig, trade25: true, otherTurnoverHkd: 1.5 }, broker('hsbc'), 10000, 0, feeRefs).error);
});

test('unused remittance quota inputs cannot break other banks or CIB RMB calculations', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const startBank of D.calculator.mainland) for (const route of D.calculator.currencies) {
    if (startBank === 'cib' && route !== 'CNH') continue;
    for (const bank of D.calculator.hkBanks) for (const id of D.calculator.brokers) {
      const input = M.calculatorRoute({ ...chequeRoute, broker: id, startBank, bank, route,
        mainlandMethod: '', depositMethod: '', outcome: 'broker-balance', returnBank: bank, usedFreeTransfers: 0 });
      const baseline = M.calculatorJourney(input, D, quotes), r = baseline.selected || baseline.partial;
      for (const usedFreeTransfers of [-1, 1.5, 'invalid']) {
        const next = M.calculatorJourney({ ...input, usedFreeTransfers }, D, quotes), other = next.selected || next.partial;
        assert.equal(next.error, baseline.error, startBank + ':' + bank + ':' + id + ':' + route);
        assert.deepEqual(other?.rows, r?.rows); assert.deepEqual(other?.steps, r?.steps);
        if (r?.net != null) close(other.net, r.net);
      }
    }
  }
  for (const route of ['USD', 'HKD']) for (const usedFreeTransfers of [-1, 1.5, 'invalid']) {
    const active = M.calculatorRoute({ ...chequeRoute, startBank: 'cib', bank: 'hsbc', route, usedFreeTransfers,
      mainlandMethod: 'swift', depositMethod: '', outcome: 'broker-balance' });
    assert.match(M.calculatorJourney(active, D, quotes).error, /已用免费笔数/);
    const confirmed = M.calculatorJourney({ ...active, senderFeeCny: 0 }, D, quotes);
    assert.equal(confirmed.error, undefined);
  }
});

test('switching accounts or disabling an offer restores calculation without erasing the whole route', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const base = { ...chequeRoute, outcome: 'broker-balance', broker: 'usmart', usmartPromo: true, usmartDays: -1 };
  for (const id of ['ibkr', 'hsbc', 'za', 'chief']) {
    const ui = moneyUi(base, quotes, '2026-10-11');
    assert.match(ui.render(), /开户距今须为非负整数天/);
    ui.act('choose', 'broker', id);
    const html = ui.render();
    assert.doesNotMatch(html, /开户距今须为非负整数天/);
    assert.equal(ui.saved().bank, base.bank); assert.equal(ui.saved().startBank, base.startBank);
    assert.match(html, /全程/); assert.match(html, /买入美股 → 卖出/);
  }
  const inactive = moneyUi({ ...base, usmartPromo: false }, quotes, '2026-10-11');
  assert.doesNotMatch(inactive.render(), /开户距今须为非负整数天/);
  const bank = moneyUi({ ...base, broker: 'za', usmartPromo: false, startBank: 'cib', bank: 'hsbc', mainlandMethod: 'swift', usedFreeTransfers: -1 }, quotes, '2026-10-11');
  assert.match(bank.render(), /已用免费笔数/);
  bank.act('choose', 'startBank', 'boc');
  assert.doesNotMatch(bank.render(), /已用免费笔数/);
  assert.equal(bank.saved().bank, 'hsbc'); assert.equal(bank.saved().broker, 'za');
});

test('invalid trading settings preserve funded balances and put the error on the trading action', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const id of D.calculator.brokers) for (const route of D.calculator.currencies) {
    const input = M.calculatorRoute({ ...chequeRoute, broker: id, route, outcome: 'broker-balance',
      mainlandMethod: '', depositMethod: '', fxMode: 'bank' });
    const baseline = M.calculatorJourney(input, D, quotes).selected;
    assert.ok(baseline.steps.fundedUsd > 0);
    const invalid = { ...input, buyOrders: 0 };
    const data = M.calculatorJourney(invalid, D, quotes), r = data.partial;
    assert.match(data.error, /交易笔数/); assert.equal(r.errorAction, 'trade');
    close(r.steps.fundedUsd, baseline.steps.fundedUsd);
    assert.deepEqual(r.rows.filter(row => ['entry', 'deposit'].includes(row.step)), baseline.rows.filter(row => ['entry', 'deposit'].includes(row.step)));
    const html = moneyUi(invalid, quotes, '2026-10-11').render();
    const funding = html.split('<section class="flow-edge" aria-label="')[2].split('</section>')[0];
    const trading = html.split('aria-label="买入美股 → 卖出"')[1].split('</section>')[0];
    const stock = html.split('data-flow-stage="03"')[1].split('</section>')[0];
    const summary = html.split('id="flow-live-summary"')[1].split('flow-bottom-tools')[0];
    assert.doesNotMatch(funding, /交易笔数须为/); assert.match(trading, /交易笔数须为/);
    assert.match(stock, new RegExp(baseline.steps.fundedUsd.toFixed(2) + ' <small>USD<'));
    assert.match(summary, /最后可计余额/); assert.match(summary, new RegExp(baseline.steps.fundedUsd.toFixed(2) + ' <small>USD<'));
  }
  const stale = structuredClone(quotes);
  for (const q of Object.values(stale.offshoreUsd.bochk.quotes)) q.asOf = '2026-10-01 12:00:00';
  const input = M.calculatorRoute({ ...chequeRoute, broker: 'za', route: 'CNH', outcome: 'broker-balance', mainlandMethod: '', depositMethod: '', fxMode: 'bank', buyOrders: 0 });
  const data = M.calculatorJourney(input, D, stale);
  assert.equal(data.partial.quoteFreshness.entryMarket, false);
  const summary = moneyUi(input, stale, '2026-10-11').render().split('id="flow-live-summary"')[1];
  assert.doesNotMatch(summary, /最后可计余额 · ZA/); assert.match(summary, /最后可计余额 · 中银香港/);
});

test('unused exit settings and exchange quotes never invalidate a route that does not use them', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const returnKeys = ['inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd', 'returnBalanceHkd', 'exitPrice'];
  for (const broker of D.calculator.brokers) for (const route of D.calculator.currencies) {
    const input = M.calculatorRoute({ ...chequeRoute, broker, route, outcome: 'broker-balance', mainlandMethod: '', depositMethod: '', fxMode: 'bank' });
    const baseline = M.calculatorJourney(input, D, quotes);
    for (const value of [-1, 'invalid', Infinity]) {
      const bad = Object.fromEntries(returnKeys.map(key => [key, value]));
      if (route === 'USD') bad.entryPrice = value;
      if (route === 'CNH') bad.startSell = value;
      const r = M.calculatorJourney({ ...input, ...bad }, D, quotes);
      assert.deepEqual(r.error, baseline.error); assert.deepEqual(r.selected, baseline.selected);
    }
  }
  for (const outcome of ['usd-balance', 'usd-card', 'cnh-card']) {
    const input = M.calculatorRoute({ ...chequeRoute, outcome, returnBank: 'hsbc', hsbcBalanceWaiver: true });
    const baseline = M.calculatorJourney(input, D, quotes);
    const unused = { returnWireHkd: -1, returnExtraCny: 'invalid', ...(outcome !== 'cnh-card' ? { exitPrice: -1 } : {}) };
    assert.deepEqual(M.calculatorJourney({ ...input, ...unused }, D, quotes).selected, baseline.selected);
    assert.match(M.calculatorJourney({ ...input, inwardHkd: -1 }, D, quotes).error, /非负数/);
    if (outcome === 'cnh-card') assert.match(M.calculatorJourney({ ...input, exitPrice: -1 }, D, quotes).error, /汇率/);
  }
  assert.match(M.calculatorJourney(M.calculatorRoute({ ...chequeRoute, outcome: 'mainland', returnWireHkd: -1 }), D, quotes).error, /非负数/);
});

test('bank asset assumptions and confirmed quotes stay bound to their selected accounts', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const field of ['bank', 'returnBank']) for (const from of D.calculator.hkBanks) for (const to of D.calculator.hkBanks) {
    if (from === to) continue;
    const input = { ...chequeRoute, outcome: 'usd-balance', [field]: from, balanceHkd: '10000', returnBalanceHkd: '20000', mainlandMethod: '' };
    const ui = moneyUi(input, quotes, '2026-10-11');
    ui.render(); ui.act('choose', field, to);
    const bound = field === 'bank' ? 'balanceHkd' : 'returnBalanceHkd', independent = field === 'bank' ? 'returnBalanceHkd' : 'balanceHkd';
    const alreadyKnown = to === input[field === 'bank' ? 'returnBank' : 'bank'];
    assert.equal(M.number(ui.saved()[bound]), alreadyKnown ? field === 'bank' ? 20000 : 10000 : 0);
    assert.equal(ui.saved()[independent], field === 'bank' ? '20000' : '10000');
  }
  const ui = moneyUi({ ...chequeRoute, outcome: 'usd-balance', bank: 'bochk', returnBank: 'bochk', balanceHkd: '10000', returnBalanceHkd: '20000',
    monthlyHkd: '5', returnMonthlyHkd: '6', hsbcBalanceWaiver: false }, quotes, '2026-10-11');
  ui.render(); ui.act('choose', 'bank', 'hsbc');
  assert.equal(ui.saved().balanceHkd, '0'); assert.equal(ui.saved().returnBalanceHkd, '20000');
  const next = M.calculatorJourney(ui.saved(), D, quotes).selected;
  assert.ok(next); assert.equal(next.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc').monthlyHkd, 100);
  ui.act('choose', 'returnBank', 'hsbc');
  assert.equal(ui.saved().returnBalanceHkd, '0');
  const same = moneyUi({ ...chequeRoute, startSell: '6.7', entryMiddleCny: '12', monthlyHkd: '3', balanceHkd: '10000' }, quotes, '2026-10-11');
  same.render(); same.act('choose', 'bank', 'bochk');
  assert.equal(same.saved().startSell, '6.7'); assert.equal(same.saved().entryMiddleCny, '12');
  assert.equal(same.saved().monthlyHkd, '3'); assert.equal(same.saved().balanceHkd, '10000');
});

test('cash below a broker minimum never becomes a free zero-value trade', () => {
  for (const id of ['hsbc', 'za', 'chief', 'usmart']) {
    const r = M.brokerTradingFees(feeConfig, broker(id), .1, 0, feeRefs);
    assert.match(r.error, /不足.*买入/);
  }
  for (const [id, offer] of [['ibkr', {}],
    ]) {
    const r = M.brokerTradingFees({ ...feeConfig, ...offer }, broker(id), .1, 0, feeRefs);
    assert.ok(!r.error, id); assert.ok(r.investUsd > 0, id);
    close(r.investUsd + r.buyFeeUsd, .1);
  }
  assert.match(M.brokerTradingFees({ ...feeConfig, trade25: true }, broker('hsbc'), .1, 0, feeRefs).error, /不足.*买入.*1股/);
  assert.match(M.brokerTradingFees({ ...feeConfig, chiefMonthly: true }, broker('chief'), .1, 0, feeRefs).error, /供款.*1 USD/);
  const confirmed = M.brokerTradingFees({ ...feeConfig, tradeFeeUsd: 0 }, broker('za'), .1, 0, feeRefs);
  assert.match(confirmed.error, /不足.*买入.*1股/);
  const coupon = M.brokerTradingFees({ ...feeConfig, useVoucher: true, voucherUsd: 10, voucherOrders: 2,
    voucherScope: 'both', voucherExpiry: '2026-12-31' }, broker('za'), .1, 0, feeRefs);
  assert.match(coupon.error, /不足.*买入.*1股/);
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const input = M.calculatorRoute({ ...chequeRoute, broker: 'za', budgetCny: 1, months: 0, outcome: 'broker-balance', depositMethod: 'chats' });
  const r = M.calculatorJourney(input, D, quotes);
  assert.match(r.error, /不足.*买入/); assert.equal(r.partial.errorAction, 'trade');
  assert.ok(r.partial.steps.fundedUsd > 0);
});

test('impossible losses and oversized trading fees preserve every completed upstream action', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const id of D.calculator.brokers) for (const route of D.calculator.currencies) for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
    const input = M.calculatorRoute({ ...chequeRoute, broker: id, bank: 'bochk', returnBank: 'bochk', route, outcome,
      months: 0, mainlandMethod: '', depositMethod: '', fxMode: 'bank' });
    const baseline = M.calculatorJourney(input, D, quotes).selected;
    assert.ok(baseline, [id, route, outcome].join('/'));
    for (const change of [{ profitUsd: -1e6 }, { tradeFeeUsd: 1e6 }]) {
      const data = M.calculatorJourney({ ...input, ...change }, D, quotes), r = data.partial;
      assert.ok(data.error); assert.equal(r.errorAction, 'trade');
      close(r.steps.fundedUsd, baseline.steps.fundedUsd);
      assert.deepEqual(r.rows.filter(row => ['entry', 'deposit'].includes(row.step)), baseline.rows.filter(row => ['entry', 'deposit'].includes(row.step)));
      assert.equal(r.steps.proceedsUsd, undefined); assert.equal(r.steps.returnUsd, undefined);
      assert.ok(Object.values(r.steps).every(value => value >= 0));
    }
  }
});

test('tax cannot consume more than sale proceeds and later errors show the balance after reserved tax', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const id of D.calculator.brokers) for (const route of D.calculator.currencies) {
    const input = M.calculatorRoute({ ...chequeRoute, broker: id, returnBank: 'bochk', route, outcome: 'broker-balance',
      profitUsd: 1000, months: 0, mainlandMethod: '', depositMethod: '', fxMode: 'bank' });
    const baseline = M.calculatorJourney(input, D, quotes).selected;
    const data = M.calculatorJourney({ ...input, taxableCny: 1e8 }, D, quotes), r = data.partial;
    assert.match(data.error, /税款/); assert.equal(r.errorAction, 'trade');
    close(r.steps.fundedUsd, baseline.steps.fundedUsd); close(r.steps.proceedsUsd, baseline.steps.proceedsUsd);
    assert.equal(r.steps.afterTaxUsd, undefined); assert.equal(r.steps.returnUsd, undefined);
    assert.equal(r.taxCny, 0); assert.ok(Object.values(r.steps).every(value => value >= 0));
  }
  const input = { ...chequeRoute, broker: 'ibkr', depositMethod: 'chats', returnBank: 'bochk', profitUsd: 1000, withdrawalIndex: 0 };
  const r = M.calculatorJourney(input, D, quotes).partial;
  assert.equal(r.errorAction, 'withdraw'); assert.ok(r.taxCny > 0);
  close(r.steps.afterTaxUsd, r.steps.proceedsUsd - r.taxCny / r.refs.USD);
  const ui = moneyUi(input, quotes, '2026-10-11'), html = ui.render();
  const uiResult = M.calculatorJourney({ ...ui.saved(), date: '2026-10-11', sellDate: '2026-10-11' }, D, quotes).partial;
  const summary = html.split('id="flow-live-summary"')[1].split('flow-bottom-tools')[0];
  assert.match(summary, new RegExp(uiResult.steps.afterTaxUsd.toFixed(2) + ' <small>USD<'));
});

test('fees exceeding cash fail at their own action without erasing earlier balances', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const base = { ...chequeRoute, broker: 'chief', returnBank: 'bochk', depositMethod: 'chats', outcome: 'mainland', months: 0 };
  const baseline = M.calculatorJourney(base, D, quotes).selected;
  for (const [change, stage, previous] of [
    [{ entryInwardHkd: 1e9 }, '01', 'mainlandForeign'],
    [{ depositHkd: 1e9 }, '03', 'hongKong'],
    [{ inwardHkd: 1e9 }, 'withdraw', 'afterTaxUsd'],
    [{ returnWireHkd: 1e9 }, '04', 'returnUsd']
  ]) {
    const data = M.calculatorJourney({ ...base, ...change }, D, quotes), r = data.partial;
    assert.ok(data.error); assert.equal(r.errorAction, stage);
    close(r.steps[previous], baseline.steps[previous]);
    assert.ok(r.rows.length > 0); assert.ok(Object.values(r.steps).every(value => value >= 0));
    assert.ok(r.rows.some(row => row.cny > 1e8));
  }
});

test('impossible financial inputs are explained inside their open editor as well as on the flow', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  const base = { ...chequeRoute, broker: 'za', returnBank: 'bochk', depositMethod: 'chats', outcome: 'broker-balance', months: 0 };
  for (const [change, editor, field, message] of [
    [{ budgetCny: 1 }, 'budget', 'budgetCny', /不足.*买入/],
    [{ profitUsd: -1e6 }, 'profit-settings', 'profitUsd', /亏损不能超过/],
    [{ taxableCny: 1e8 }, 'profit-settings', 'taxableCny', /税款预留/],
    [{ tradeFeeUsd: 1e6 }, 'adjustments', 'tradeFeeUsd', /不足.*交易/]
  ]) {
    const ui = moneyUi({ ...base, ...change }, quotes, '2026-10-11');
    const html = ui.render(); assert.match(html, message);
    ui.act('detail', '', editor);
    assert.match(ui.modal(), new RegExp('aria-describedby="flow-error-' + field + '"'));
    assert.match(ui.modal(), message);
  }
});

test('confirmed withdrawal bank charges override public prices once for every supported stock account', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261011.json');
  for (const id of D.calculator.brokers) for (const returnBank of D.calculator.hkBanks) {
    const input = M.calculatorRoute({ ...chequeRoute, broker: id, returnBank, depositMethod: '', months: 0 });
    const before = M.calculatorJourney(input, D, quotes).selected;
    if (id === 'chief' && returnBank === 'za') { assert.equal(before, undefined); continue; }
    assert.ok(before, id + '/' + returnBank);
    const quoted = M.calculatorJourney({ ...input, inwardHkd: 99 }, D, quotes).selected;
    const oldFee = before.rows.find(row => row.key === 'returnInward');
    const newFee = quoted.rows.find(row => row.key === 'returnInward');
    close(newFee.cny, 99 * quoted.refs.HKD);
    close(quoted.netCny, before.netCny + (oldFee.cny ?? 0) - newFee.cny);
    assert.deepEqual(quoted.rows.filter(row => row.step === 'entry' || row.step === 'deposit' || row.step === 'investment'),
      before.rows.filter(row => row.step === 'entry' || row.step === 'deposit' || row.step === 'investment'));
    assert.match(newFee.evidence, /本人回单/);
    const restored = M.calculatorJourney({ ...input, inwardHkd: '' }, D, quotes).selected;
    assert.deepEqual(restored, before);
  }
  const input = { ...chequeRoute, broker: 'za', returnBank: 'bochk', depositMethod: 'chats', months: 0, inwardHkd: 99 };
  const r = M.calculatorJourney(input, D, quotes).selected;
  const ui = moneyUi(input, quotes, '2026-10-11'); ui.render();
  const withdrawal = moneyDetails(ui, 'edge-withdraw');
  assert.match(withdrawal, /99\.00 HKD/);
  const converted = Number(withdrawal.match(/≈ ([\d.]+) CNY/)[1]);
  assert.ok(Math.abs(converted - 99 * r.refs.HKD) < .01);
  assert.match(withdrawal, new RegExp(converted.toFixed(2) + ' CNY'));
  assert.match(withdrawal, /本人回单/);
});
