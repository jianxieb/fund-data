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
const ledger = r => {
  const sum = r.rows.reduce((total, row) => total + (row.cny ?? 0), 0);
  close(r.costCny, sum);
  close(r.net + sum + r.taxCny, r.budgetCny + r.refs.USD * 1000);
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
  const p = M.journeyPlans({ ...mainlandConfig, startBank: 'comm', entryMiddleCny: '', depositOtherCny: '', intermediaryCny: '', returnExtraCny: '' }, D, richQuotes);
  assert.equal(p.selected.rankable, false); assert.equal(p.selected.complete, false);
  for (const key of ['sender', 'entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther']) assert.equal(p.selected.rows.find(row => row.key === key).cny, null);
  assert.ok(p.plans.every(row => !['comm', 'icbc'].includes(row.start.id)));
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
    { depositMethod: 'swift' }
  ]) {
    const p = M.journeyPlans({ ...mainlandConfig, ...overrides }, D, richQuotes);
    for (const [key, id] of [['start', p.selected.start.id], ['bank', p.selected.bank.id], ['route', p.selected.route]]) {
      const current = p.alternatives[key].find(row => (key === 'route' ? row.route : row[key].id) === id);
      assert.equal(current.error, undefined); close(current.net, p.selected.net);
    }
  }
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
