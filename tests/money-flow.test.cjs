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
    mainlandMethod: 'payment-connect', senderFeeCny: 0, exitBank: 'cib' }, D, richQuotes);
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
  const confirmed = M.journeyPlans({ ...input, senderFeeCny: 0 }, D, richQuotes).selected;
  close(confirmed.rows.find(row => row.key === 'sender').cny, 0);
  assert.equal(M.comparisonMetric(confirmed, 'bank', 'step').missing.length, 0);
  assert.equal(confirmed.rankable, false);
  const paid = M.journeyPlans({ ...input, count: 2, senderFeeCny: 5 }, D, richQuotes).selected;
  close(paid.rows.find(row => row.key === 'sender').cny, 10);
  close(paid.steps.hongKong, input.budgetCny - 10);
  const badRoute = M.journeyPlans({ ...input, route: 'USD', depositMethod: 'chats' }, D, richQuotes);
  assert.match(badRoute.error, /人民币原币/);
  const otherBank = M.journeyPlans({ ...input, bank: 'za' }, D, richQuotes);
  assert.match(otherBank.error, /仅收录/);
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
test('buy commissions fit inside USD cash; regulatory fees are separate from zero commission', () => {
  for (const id of ['ibkr', 'chief', 'usmart', 'za']) {
    const r = M.brokerTradingFees(feeConfig, broker(id), 10000, 0, feeRefs);
    assert.ok(!r.error); close(r.investUsd + r.buyFeeUsd, 10000);
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
test('Chief monthly offer applies to eligible buys, expires and leaves clearing and ordinary sale fees', () => {
  const r = M.brokerTradingFees({ ...feeConfig, chiefMonthly: true }, broker('chief'), 500, 0, feeRefs);
  close(r.orders[0].platform, 0); assert.ok(r.orders[0].clearing > 0);
  close(r.orders[1].platform, .99);
  const large = M.brokerTradingFees({ ...feeConfig, chiefMonthly: true }, broker('chief'), 1000, 0, feeRefs);
  close(large.orders[0].platform, (large.investUsd - 500) * .0015);
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
test('the five broker journeys reconcile RMB and retain the exact deposit and withdrawal method', () => {
  for (const provider of D.brokers) {
    const input = { ...mainlandConfig, broker: provider.id, tradeFeeUsd: '', buyOrders: 3, sellOrders: 2, sharePriceUsd: 100,
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
    const input = { ...mainlandConfig, broker: provider.id, tradeFeeUsd: '', profitUsd: 0 };
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
  assert.equal(cheque.rows.find(row => row.key === 'returnInward').cny, null);
  close(cheque.rows.find(row => row.key === 'withdrawMiddle').cny, 0);
  const hsbc = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'hsbc', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(hsbc.rows.find(row => row.key === 'returnInward').cny, 0);
  const bochk = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'bochk', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(bochk.rows.find(row => row.key === 'returnInward').cny, 0);
  const hang = M.journeyPlans({ ...mainlandConfig, broker: 'chief', returnBank: 'hang', tradeFeeUsd: '', inwardHkd: '' }, D, richQuotes).selected;
  close(hang.rows.find(row => row.key === 'returnInward').cny, 0);
  assert.match(hang.rows.find(row => row.key === 'returnInward').label, /本地USD支票存入/);
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
    assert.ok(l.legs[1].rows.some(row => row.key === 'brokerFx'));
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
  assert.ok(l.legs[4].missing.includes('中国银行USD收款费'));
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
  assert.equal(data.alternatives.start.length, 10); assert.equal(data.alternatives.bank.length, 5);
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

test('BOC mobile uses explicitly attributed 2026 reported waiver, independent of standard wire and agent fees', () => {
  const input = { ...mainlandConfig, broker: 'ibkr', bank: 'bochk', returnBank: 'bochk', returnMethod: 'bochk-fast',
    mainlandMethod: 'boc-mobile', profitUsd: 0, tradeFeeUsd: '', senderFeeCny: '', entryMiddleCny: '' };
  const data = M.journeyPlans(input, D, richQuotes), r = data.selected;
  close(r.rows.find(row => row.key === 'sender').cny, 0);
  assert.match(r.rows.find(row => row.key === 'sender').evidence, /2026公开报道/);
  assert.equal(D.bocMobileEvidence.level, 'reported');
  close(r.rows.find(row => row.key === 'entryInward').cny, 0);
  close(r.rows.find(row => row.key === 'entryMiddle').cny, 0);
  assert.match(r.rows.find(row => row.key === 'entryMiddle').evidence, /USD\/HKD同行SHA路径/);
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
  close(r.steps.hongKong, r.steps.mainlandForeign);
  close(r.steps.hongKong, r.budgetCny / r.startSell);
  assert.ok(r.rows.find(row => row.key === 'entryFx').cny > 0);
  close(r.net + r.costCny + r.taxCny, r.budgetCny + r.fxImpactCny);
  const elsewhere = data.alternatives.bank.find(row => row.bank.id === 'za');
  assert.ok(elsewhere.rows.find(row => row.key === 'sender').cny > 0);
  assert.equal(elsewhere.rows.find(row => row.key === 'entryMiddle').cny, null);
  const hkd = data.alternatives.route.find(row => row.route === 'HKD');
  close(hkd.rows.find(row => row.key === 'sender').cny, 0);
  assert.match(hkd.rows.find(row => row.key === 'sender').evidence, /公开报道/);
  const cnh = data.alternatives.route.find(row => row.route === 'CNH');
  assert.equal(cnh.mainlandMethod, 'swift');
  assert.ok(cnh.rows.find(row => row.key === 'sender').cny > 0);
});

test('all five trading accounts retain fees for USD, HKD and CNH without inventing bank FX quotes', () => {
  for (const route of ['USD', 'HKD', 'CNH']) {
    const input = { ...mainlandConfig, route, broker: 'ibkr', bank: 'za', returnBank: 'bochk', returnMethod: 'swift',
      fxMode: 'manual', mainlandMethod: 'swift', depositMethod: route === 'USD' ? 'chats' : 'fps', tradeFeeUsd: '', profitUsd: 0 };
    const data = M.journeyPlans(input, D, richQuotes);
    assert.equal(data.alternatives.broker.length, 5);
    for (const row of data.alternatives.broker) {
      assert.equal(row.error, undefined, route + ':' + row.broker.id);
      assert.ok(row.trading.totalUsd > 0); assert.ok(Number.isFinite(row.net));
      const ledger = M.diagramLedger(row);
      assert.equal(ledger.legs.length, 5);
      close(row.net + row.costCny + row.taxCny, row.budgetCny + row.fxImpactCny);
      if (route !== 'USD' && row.broker.id !== 'ibkr') {
        assert.match(row.indicativeFx, /成交价（暂按参考中间价）/);
        assert.equal(row.rows.find(r => r.key === 'brokerSpread').cny, null);
        assert.equal(row.quotedCore, false); assert.equal(row.rankable, false);
        close(row.rows.find(r => r.key === 'brokerFx').cny, 0);
        assert.equal(ledger.legs[1].indicative, true);
        assert.ok(row.missing.some(text => text.includes(row.bank.name) && text.includes(route)));
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
  close(sender.cny, 0); assert.match(sender.evidence, /2026公开报道/);
  close(mobile.rows.find(row => row.key === 'entryInward').cny, 0);
});

test('only explicitly removed ABC is blocked; ordinary banks, brokers, currencies and channels remain selectable', () => {
  const initial = { ...mainlandConfig, startBank: 'cib', bank: 'bochk', broker: 'za', count: 2, mainlandMethod: 'cib-go', outcome: 'usd-balance', profitUsd: 0 };
  const ui = moneyUi(initial); ui.render();
  ui.act('choose', 'startBank', 'abc'); assert.deepEqual(ui.saved(), initial);
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
  assert.equal(results['cnh-card'].currency, 'CNH'); assert.equal(results.mainland.currency, 'CNY');
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

function moneyUi(input, quotes = cibQuotes) {
  const fs = require('node:fs'), vm = require('node:vm');
  let saved = input, modal = '';
  const context = { window: { MONEY_FLOW: D, MONEY_FLOW_QUOTES: quotes, ChanghengMoneyFlowModel: M },
    document: { querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => JSON.stringify(saved), setItem: (_, v) => { saved = JSON.parse(v); } },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-09T04:00:00Z'])); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/money-flow.js'), 'utf8'), context);
  const helpers = { esc: x => String(x ?? ''), money: (v, d) => Number(v).toFixed(d), head: () => '',
    action: (label, act, cls, extra) => '<button data-action="' + act + '" class="' + cls + '" ' + extra + '>' + label + '</button>',
    openModal: text => { modal = text; }, modalTitle: text => '<h2>' + text + '</h2>' };
  return { render: () => context.window.ChanghengMoneyFlow.view(helpers), saved: () => saved, modal: () => modal,
    act: (action, field, value) => context.window.ChanghengMoneyFlow.handleAction({ dataset: { action: 'money-flow-' + action, field, value } }) };
}

test('all nodes, action losses, balance summaries and quick plans are visible without step navigation', () => {
  const ui = moneyUi({ ...currentRoute, outcome: 'broker-balance', activeStep: '04' }), html = ui.render();
  assert.equal((html.match(/data-flow-stage=/g) || []).length, 4);
  assert.equal((html.match(/data-action="money-flow-preset"/g) || []).length, 5);
  assert.equal((html.match(/class="flow-edge-loss"/g) || []).length, 3);
  for (const label of ['内地出发银行', '香港收款银行', '买美股的账户', '卖出后的资金', '人民币本金', '汇款到账', '入金到账', '全程损耗']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /自由组合|下一步|上一步|data-action="money-flow-step"|data-action="money-flow-presets"/);
  assert.match(html, /100000.00 <small>CNY/);
  assert.equal((html.match(/aria-label="修改人民币本金"/g) || []).length, 1);
  assert.doesNotMatch(html, /money-flow-amount|本金快捷金额/);
  ui.act('detail', '', 'budget'); assert.match(ui.modal(), /data-money-field="budgetCny"[^>]*value="100000"/); assert.match(ui.modal(), /data-money-field="count"/);
});

test('IBKR USD funding separates Hong Kong receiving instructions from overseas wire instructions', () => {
  const ui = moneyUi({ ...currentRoute, broker: 'ibkr', route: 'USD', depositMethod: 'chats', depositOtherCny: '', outcome: 'broker-balance' });
  assert.match(ui.render(), /香港收款指示 · USD本地转账/);
  assert.match(ui.render(), /香港花旗／渣打收款指示/);
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

test('HK bank conversions use the selected bank and reconcile each leg through HKD', () => {
  const q = structuredClone(cibQuotes);
  const market = { bidPerUsd: 6.5, askPerUsd: 8 / 1.1, asOf: '2026-10-09 12:00:00', path: 'via-HKD',
    legs: { usdBuy: 7.8, usdSell: 8, cnhBuy: 1.1, cnhSell: 1.2 } };
  q.offshoreUsd.hsbc = { quotes: { CNH: market, HKD: { bidPerUsd: 7.8, askPerUsd: 8, asOf: market.asOf } } };
  const config = { ...currentRoute, route: 'CNH', mainlandMethod: 'swift', fxMode: 'bank', depositMethod: 'internal',
    bank: 'hsbc', broker: 'hsbc', returnBank: 'hsbc', outcome: 'cnh-card', senderFeeCny: 0, entryMiddleCny: 0,
    months: 0, tradeFeeUsd: 0, entryPrice: '', exitPrice: '' };
  const r = M.calculatorJourney(config, D, q).selected;
  close(r.steps.fundedUsd, 100000 * 1.1 / 8);
  close(r.net, r.steps.returnUsd * 7.8 / 1.2);
  close(r.entryPrice, 8 / 1.1); close(r.exitPrice, 6.5);
  assert.equal(r.indicativeFx, ''); assert.equal(r.indicativeExit, false);
  for (const key of ['brokerSpread', 'exitFx']) {
    const row = r.rows.find(x => x.key === key);
    assert.equal(row.exchanges.length, 2);
    close(row.items.reduce((sum, x) => sum + x.cny, 0), row.cny);
    close(row.exchanges[0].output, row.exchanges[1].input);
    assert.equal(row.path[1], 'HKD');
  }
  close(r.budgetCny - r.costCny, r.netCny);
  const html = moneyUi(config, q).render();
  assert.match(html, /人民币 → 港币 → 美元/);
  assert.match(html, /美元 → 港币 → 人民币 → 消费/);
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
    const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'cib-go', broker, trade25: true, hsbcBalanceWaiver: false }), html = ui.render();
    const bank = html.split('data-flow-stage="02"')[1].split('</section>')[0];
    const trade = html.split('data-flow-stage="03"')[1].split('</section>')[0];
    assert.match(bank, /HSBC One已满足免管理费条件/);
    assert.doesNotMatch(trade, /data-money-check="hsbcBalanceWaiver"/);
    ui.act('detail', '', 'bank-settings'); assert.match(ui.modal(), /100.00 HKD\/月 × 12个月/); assert.match(ui.modal(), /1200.00 HKD/);
    if (broker === 'hsbc') { assert.match(trade, /Trade25 · 仅美股月费0/); assert.doesNotMatch(trade, /25.00 HKD/); }
  }
});

test('presets preserve amounts, duration and eligibility; every selected bank remains editable', () => {
  const ui = moneyUi({ ...currentRoute, budgetCny: 150000, count: 2, months: 6, startSell: '8', senderFeeCny: '99', trade25: false, hsbcBalanceWaiver: false });
  assert.match(ui.render(), /中行.*IBKR/);
  ui.act('preset', '', 'cib-usd'); const state = ui.saved();
  assert.equal(state.startBank, 'cib'); assert.equal(state.bank, 'hsbc'); assert.equal(state.broker, 'hsbc');
  assert.equal(state.budgetCny, 150000); assert.equal(state.count, 2); assert.equal(state.months, 6);
  assert.equal(state.mainlandMethod, 'swift'); assert.equal(state.trade25, false); assert.equal(state.hsbcBalanceWaiver, false);
  assert.equal(state.startSell, ''); assert.equal(state.senderFeeCny, '');
  ui.act('choose', 'bank', 'bochk'); ui.act('choose', 'broker', 'chief');
  assert.equal(ui.saved().bank, 'bochk'); assert.equal(ui.saved().broker, 'chief');
  ui.act('preset', '', 'boc-za'); assert.equal(ui.saved().broker, 'za'); assert.equal(ui.saved().bank, 'bochk');
});

test('every visible calculated plan reproduces its full price after selection and preserves user conditions', () => {
  const initial = { ...currentRoute, budgetCny: 100000, count: 2, months: 12, outcome: 'broker-balance', trade25: true, hsbcBalanceWaiver: true };
  const ui = moneyUi(initial), html = ui.render();
  const cards = [...html.matchAll(/<button[^>]*data-action="money-flow-preset"[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.equal(cards.length, 5);
  for (const card of cards) {
    const id = card.match(/data-value="([^\"]+)"/)[1];
    ui.act('preset', '', id);
    const state = ui.saved(), r = M.calculatorJourney({ ...state, date: '2026-10-09' }, D, cibQuotes).selected;
    assert.ok(card.includes(r.costCny.toFixed(2) + ' CNY'));
    assert.ok(card.includes((r.costCny / r.budgetCny * 100).toFixed(3) + '%'));
    assert.equal(state.budgetCny, 100000); assert.equal(state.count, 2); assert.equal(state.months, 12);
    assert.equal(state.trade25, true); assert.equal(state.hsbcBalanceWaiver, true);
  }
});

test('the inline bank management fee identifies HSBC even when the receiving bank is BOCHK', () => {
  const html = moneyUi({ ...currentRoute, bank: 'bochk', broker: 'hsbc', outcome: 'broker-balance', months: 12, hsbcBalanceWaiver: false }).render();
  const bankNode = html.split('data-flow-stage="02"')[1].split('</section>')[0];
  assert.match(bankNode, /香港收款银行：中银香港/);
  assert.match(bankNode, /账户使用 12个月 · 汇丰 HSBC One管理费/);
  assert.doesNotMatch(bankNode, /中银香港管理费 [1-9]/);
});

test('withdrawal capability and minimum errors appear at the withdrawal action, including a USD-balance endpoint', () => {
  const input = { ...currentRoute, bank: 'bochk', returnBank: 'za', broker: 'chief', depositMethod: 'internal', outcome: 'usd-balance' };
  const html = moneyUi(input).render(), withdrawal = html.split('aria-label="出金 → 众安 ZA Bank"')[1].split('</section>')[0];
  assert.match(withdrawal, /不接受支票存款/); assert.equal((html.match(/不接受支票存款/g) || []).length, 1);
  assert.match(withdrawal, /本次无法出金/); assert.doesNotMatch(withdrawal, /已核费用/);
  assert.match(html, /买入美股 · 1笔/); assert.match(html, /最后可计余额/);
  const small = moneyUi({ ...input, broker: 'usmart', budgetCny: 20 * cibQuotes.banks.boc.quotes.USD.sell,
    startBank: 'boc', route: 'USD', mainlandMethod: 'boc-mobile', startSell: '', tradeFeeUsd: '0' }).render();
  assert.match(small.split('aria-label="出金 → 众安 ZA Bank"')[1].split('</section>')[0], /须超过20 USD/);
});

test('RMB source is not described as free when its sender tariff remains unpriced', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'icbc', route: 'CNH', mainlandMethod: 'swift' }), html = ui.render();
  assert.match(html, /人民币原币汇往香港/);
  assert.doesNotMatch(html, /人民币原币跨境渠道未纳入全程报价/);
  ui.act('detail', '', 'cost'); assert.match(ui.modal(), /人民币资费未收录/);
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
  assert.match(ui.render(), /普通汇款 · 寰宇人生卡/);
  ui.act('detail', '', 'edge-01');
  assert.match(ui.modal(), /外汇汇出手续费免，优惠期前30笔电讯费免/);
  assert.match(ui.modal(), /data-money-field="usedFreeTransfers"/);
});

test('RMB channels show the correct tariff and repair the old SC foreign-only choice without changing accounts', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'sc', bank: 'sc', route: 'CNH', mainlandMethod: 'linked', count: 1, senderFeeCny: '', outcome: 'broker-balance' });
  const html = ui.render();
  assert.match(html, /优先理财 · 人民币跨境汇款/);
  assert.match(html, /5.50 CNY/);
  assert.doesNotMatch(html, /同名速汇 · 免费|汇款渠道：请选择/);
  assert.match(html, /渣打 · 快易理财 CNH\/USD成交价尚未取得/);
  assert.doesNotMatch(html, /转入IBKR|请选择换美元地点/);
  const summary = html.split('id="flow-live-summary"')[1];
  assert.match(summary, /最后可计余额/); assert.match(summary, /99994.50/); assert.match(summary, /CNH/);
  ui.act('choose', 'broker', 'za');
  assert.equal(ui.saved().startBank, 'sc'); assert.equal(ui.saved().bank, 'sc'); assert.equal(ui.saved().mainlandMethod, 'swift');
  ui.act('choose', 'route', 'USD');
  assert.equal(ui.saved().mainlandMethod, 'linked');
  assert.match(ui.render(), /优先理财 · 同名速汇 · 免费/);
  ui.act('choose', 'route', 'CNH');
  assert.equal(ui.saved().mainlandMethod, 'swift');
  ui.act('pick', '', 'startBank');
  assert.match(ui.modal(), /人民币跨境按金额分档/);
  const gap = moneyUi({ ...currentRoute, startBank: 'hang', bank: 'bochk', route: 'CNH', budgetCny: 2004, count: 1, senderFeeCny: '', mainlandMethod: 'swift', outcome: 'broker-balance' }).render();
  assert.match(gap, /留在本账户 2.00 CNY/);
  assert.match(gap, /另留内地账户 2.00 CNY/);
  assert.doesNotMatch(gap, /NaN|undefined/);
});

test('missing terminal FX never forces a different bank, erases the total, or shows a zero loss rate', () => {
  const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'cib-go', outcome: 'cnh-card', returnBank: 'hsbc' });
  const html = ui.render(), edge = html.split('aria-label="美元换人民币 → 消费"')[1].split('</section>')[0];
  assert.equal((html.match(/data-flow-stage=/g) || []).length, 4);
  assert.match(html, /汇丰 HSBC One/); assert.match(html, /全程已核费用|全程损耗 · 历史报价/);
  assert.match(html, /最后可计余额/); assert.doesNotMatch(edge, /0.000%/);
  assert.doesNotMatch(html, /请选择中银香港消费账户/);
});

test('missing funding FX is named consistently in the flow and details without a fabricated converted balance', () => {
  for (const [broker, fxMode, bank, expected] of [
    ['za', 'bank', 'sc', /渣打 · 快易理财 CNH\/USD成交价尚未取得/],
    ['ibkr', 'manual', 'bochk', /IBKR CNH\/USD成交价尚未取得/]
  ]) {
    const config = { ...currentRoute, startBank: 'sc', bank, route: 'CNH', broker, fxMode,
      mainlandMethod: 'swift', depositMethod: fxMode === 'bank' ? 'chats' : 'fps', outcome: 'broker-balance' };
    const r = M.calculatorJourney(config, D, cibQuotes).selected;
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
    assert.match(trade, /参考损耗/); assert.match(trade, /估算 .*? USD/);
    assert.match(html.split('id="flow-live-summary"')[1], /费用小计 · 含估算/);
    for (const key of ['edge-03', 'cost']) {
      ui.act('detail', '', key);
      assert.match(ui.modal(), expected);
      assert.doesNotMatch(ui.modal(), /换汇.*?<b>按实际汇路收费|未报价换汇估值差额|本金 ＋/);
      if (key === 'cost') assert.match(ui.modal(), new RegExp('最后可计余额：' + r.steps.hongKong.toFixed(2) + ' CNH'));
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
  const config = { ...currentRoute, startBank: 'cib', route: 'USD', fxMode: 'bank', outcome: 'mainland', exitBank: 'sc', exitPrice: '', returnMethod: 'swift' };
  const r = M.calculatorJourney(config, D, cibQuotes).selected;
  assert.equal(r?.indicativeExit, true);
  const ui = moneyUi(config), html = ui.render();
  const exit = html.split('aria-label="汇回内地 → 美元结汇"')[1].split('</section>')[0];
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
  assert.match(ui.modal(), /100000.00 本金 ＋/);
  const q = structuredClone(cibQuotes); q.banks.boc.quotes.USD.asOf = '2020-01-01';
  const stale = moneyUi(config, q); stale.render(); stale.act('detail', '', 'cost');
  assert.doesNotMatch(stale.modal(), /本金 ＋|最后可计余额/);
  const fundingQuotes = structuredClone(cibQuotes);
  fundingQuotes.offshoreUsd.hsbc = { quotes: { CNH: { bidPerUsd: 6.8, askPerUsd: 7, asOf: '2020-01-01' } } };
  const fundingConfig = { ...currentRoute, startBank: 'sc', route: 'CNH', mainlandMethod: 'swift', fxMode: 'bank', outcome: 'broker-balance' };
  const r = M.calculatorJourney(fundingConfig, D, fundingQuotes).selected;
  assert.equal(r?.quoteFreshness.entryMarket, false); assert.equal(r?.indicativeFx, '');
  const funding = moneyUi(fundingConfig, fundingQuotes), html = funding.render();
  assert.match(html.split('id="flow-live-summary"')[1], /最后可计余额[\s\S]*CNH/);
  funding.act('detail', '', 'cost');
  assert.match(funding.modal(), new RegExp('最后可计余额：' + r.steps.hongKong.toFixed(2) + ' CNH'));
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
  assert.match(ui.modal(), /data-value="swift"/); assert.match(ui.modal(), /data-value="cib-go"/);
  ui.act('choose', 'mainlandMethod', 'swift');
  assert.doesNotMatch(ui.render(), /汇款渠道：请选择|向境外中行渠道须/);
});


test('bank and broker lists keep stable order and remain enabled after every choice', () => {
  const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'cib-go', bank: 'bochk', returnBank: 'bochk', senderFeeCny: '99', entryMiddleCny: '0' });
  ui.render();
  const ids = modal => [...modal.matchAll(/data-value="([^"]+)"/g)].map(m => m[1]);
  for (const broker of D.calculator.brokers) {
    ui.act('choose', 'broker', broker);
    assert.equal(ui.saved().bank, 'bochk'); assert.equal(ui.saved().returnBank, 'bochk');
    assert.equal(ui.saved().senderFeeCny, '99'); assert.equal(ui.saved().entryMiddleCny, '0');
    ui.act('pick', '', 'startBank'); assert.deepEqual(ids(ui.modal()), D.calculator.mainland); assert.doesNotMatch(ui.modal(), /农业银行|\bdisabled\b/);
    ui.act('pick', '', 'bank'); assert.deepEqual(ids(ui.modal()), D.calculator.hkBanks);
    ui.act('pick', '', 'broker'); assert.deepEqual(ids(ui.modal()), D.calculator.brokers); assert.doesNotMatch(ui.modal(), /\bdisabled\b/);
  }
});


test('incompatible card choices remain editable and never lock unrelated bank selections', () => {
  const ui = moneyUi({ ...currentRoute, count: 2, mainlandMethod: 'cib-go', bank: 'bochk', returnBank: 'za' });
  ui.render(); ui.act('pick', '', 'outcome'); assert.doesNotMatch(ui.modal(), /\bdisabled\b/);
  ui.act('choose', 'outcome', 'usd-card'); assert.equal(ui.saved().outcome, 'usd-card');
  assert.match(ui.render(), /不支持.*美元/);
  ui.act('choose', 'returnBank', 'bochk'); assert.equal(ui.saved().returnBank, 'bochk');
  assert.match(ui.render(), /全程损耗/);
});

test('uSMART local USD cheques are free; digital-bank withdrawal uses its separate fee and minimum', () => {
  const config = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', mainlandMethod: 'boc-mobile',
    depositMethod: 'internal', outcome: 'usd-balance', returnBank: 'bochk', inwardHkd: '', intermediaryCny: '', months: 0 };
  for (const returnBank of ['bochk', 'hsbc', 'hang', 'sc']) {
    const r = M.calculatorJourney({ ...config, returnBank }, D, cibQuotes).selected;
    for (const key of ['withdraw', 'returnInward', 'withdrawMiddle']) close(r.rows.find(x => x.key === key).cny, 0);
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

test('primary fee details are visible immediately below each loss and sum to that edge total', () => {
  const state = { ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'za', route: 'USD', mainlandMethod: 'boc-mobile',
    depositMethod: 'chats', outcome: 'broker-balance', tradeFeeUsd: '', months: 0 };
  const ui = moneyUi(state), html = ui.render();
  const sections = [...html.matchAll(/<section class="flow-edge"[\s\S]*?<\/section>/g)].map(m => m[0]);
  assert.equal(sections.length, 3);
  for (const section of sections) {
    assert.ok(section.indexOf('flow-edge-loss') < section.indexOf('flow-edge-fees'));
    assert.match(section, /flow-fee-line/); assert.doesNotMatch(section, /<details|\shidden(?:=|\s|>)|display:none/);
  }
  for (const label of ['汇出手续费', '汇出电讯费', '内地购汇差额', '买入美股 · 1笔', '卖出美股 · 1笔']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /下限|上限|≥|≤|自由组合|上一页|下一页/);
  const card = [...html.matchAll(/<button[^>]*data-action="money-flow-preset"[\s\S]*?<\/button>/g)].map(m => m[0]).find(card => /aria-label="优选方案：[^\"]*→ ZA"/.test(card));
  ui.act('preset', '', card.match(/data-value="([^\"]+)"/)[1]);
  const applied = M.calculatorJourney({ ...ui.saved(), date: '2026-10-09' }, D, cibQuotes).selected;
  assert.match(card, new RegExp((applied.costCny / applied.budgetCny * 100).toFixed(3) + '%'));
  assert.ok(card.includes(applied.costCny.toFixed(2) + ' CNY'));
});

test('SC local USD bank charge retains its native unit in the inline fee row', () => {
  const html = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'sc', broker: 'za', route: 'USD', mainlandMethod: 'swift', depositMethod: 'chats' }).render();
  const funding = html.split('aria-label="转入买股账户"')[1].split('</section>')[0];
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
    const r = M.calculatorJourney({ ...currentRoute, outcome: 'mainland', returnBank: 'bochk', exitBank,
      returnMethod: 'swift', returnExtraCny: '' }, D, cibQuotes).selected;
    const fees = r.rows.find(x => x.key === 'returnOther');
    assert.equal(fees.cny, null); assert.equal(fees.items[0].cny, null); close(fees.items[1].cny, 0);
  }
});

test('a published approximate digital-bank withdrawal fee is labeled in both the step and total', () => {
  const ui = moneyUi({ ...currentRoute, startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', mainlandMethod: 'boc-mobile',
    depositMethod: 'internal', outcome: 'usd-balance', returnBank: 'za', inwardHkd: '', intermediaryCny: '', months: 0 });
  const html = ui.render();
  assert.match(html, /参考损耗/); assert.match(html, /参考总损耗/); assert.match(html, /公布约7.5 USD/);
  assert.match(html, /按公布参考费计算的余额/);
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
  const source = html.split('aria-label="内地购美元 → 汇往香港"')[1].split('</section>')[0];
  assert.doesNotMatch(source, /0.000%/);
  assert.equal((source.match(/现汇卖出价尚未取得/g) || []).length, 1);
  const sc = M.calculatorJourney({ ...config, startBank: 'sc', bank: 'sc', mainlandMethod: 'linked' }, D, q).partial;
  for (const key of ['sender', 'entryMiddle', 'entryInward']) close(sc.rows.find(x => x.key === key).cny, 0);
  const charged = M.calculatorJourney({ ...config, hsbcBalanceWaiver: false, balanceHkd: 0, monthlyHkd: '' }, D, q).partial;
  close(charged.rows.find(x => x.key === 'account').cny, 1200 * charged.refs.HKD);
  assert.doesNotMatch(html, /全程损耗 · 历史报价/);
  const unquoted = structuredClone(q); delete unquoted.banks.comm;
  const allUnknown = moneyUi({ ...config, startBank: 'comm', bank: 'bochk', returnBank: 'bochk' }, unquoted).render();
  const unknownTransfer = allUnknown.split('aria-label="内地购美元 → 汇往香港"')[1].split('</section>')[0];
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
  assert.match(html, /买入美股 · 1笔/);
  assert.equal((html.match(/渣打人民币原币消费须持有效香港身份证/g) || []).length, 1);
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
  close(cnh.rows.find(x => x.key === 'sender').cny, 5.5);
  assert.equal(cnh.rows.find(x => x.key === 'entryMiddle').cny, null);
});
