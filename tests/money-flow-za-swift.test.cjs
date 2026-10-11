const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const E = require('./fixtures/money-flow-za-swift-perks-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const za = D.hkBanks.find(bank => bank.id === 'za');
const refs = { CNY: 1, USD: 7, HKD: 7 / 7.8, CNH: 7 / 7.1 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const base = { ...config, date: '2026-11-01', startBank: 'boc', bank: 'za', broker: 'ibkr', returnBank: 'za', exitBank: 'boc',
  route: 'USD', outcome: 'mainland', months: 1, count: 1, mainlandMethod: 'boc-online', depositMethod: 'swift', returnMethod: 'swift',
  startSell: 7, usdCny: 7, usdHkd: 7.8, usdCnh: 7.1, zaPerksLevel: 'standard', zaSwiftUsed: 0 };
const run = input => {
  const result = M.calculatorJourney(M.calculatorRoute({ ...base, ...input }), D, Q);
  const r = result.selected || result.partial;
  assert.ok(r, result.error);
  return r;
};
const row = (r, key) => r.rows.find(item => item.key === key);

test('ZA official tariff distinguishes local SWIFT from overseas membership waivers and their effective date', () => {
  assert.equal(D.sources.zaPerksNov.url, E.waiverSource);
  assert.equal(D.sources.zaTariff.url, E.tariffSource);
  assert.equal(za.localSwiftHkd, E.localHongKongSwiftHkd);
  assert.equal(za.swiftMemberWaiver.from, E.effectiveFrom);
  assert.equal(za.swiftMemberWaiver.lv1FreePerMonth, E.lv1FreePerCalendarMonth);
  assert.equal(za.swiftMemberWaiver.lv2Unlimited, E.lv2Unlimited);
  for (const date of ['2026-10-31', '2026-11-01', '2027-01-01']) for (const zaPerksLevel of ['standard', 'lv1', 'lv2']) for (const zaSwiftUsed of [0, 1, 2, 3, 30]) {
    const s = { zaPerksLevel, zaSwiftUsed };
    const expected = date < E.effectiveFrom || zaPerksLevel === 'lv2' || zaPerksLevel === 'lv1' && zaSwiftUsed < 3 ? 0 : 70;
    close(M.swiftFee(za, date, s).hkd, expected);
    close(M.swiftFee(za, date, s, 1, 'hong-kong').hkd, 0);
    close(M.depositFee(za, 'swift', 'USD', refs, date, { config: s }), expected * refs.HKD);
    close(M.returnFee(za, D.mainlandBanks[0], 'swift', refs, date, { config: s }), expected * refs.HKD);
  }
  // The published standard tariff stays separate from a user's qualification.
  close(M.outwardFee(za, '2026-11-01'), 70);
});

test('same-month overseas funding and mainland return share one ZA quota; CHATS and local SWIFT do not consume it', () => {
  for (const months of [0, 1, 2, 12]) for (const zaSwiftUsed of [0, 1, 2, 3]) {
    const r = run({ months, zaPerksLevel: 'lv1', zaSwiftUsed });
    const deposit = row(r, 'depositBank'), back = row(r, 'returnWire');
    const returnIndex = zaSwiftUsed + (months <= 1 ? 2 : 1);
    close(deposit.cny / r.refs.HKD, zaSwiftUsed < 3 ? 0 : 70);
    close(back.cny / r.refs.HKD, returnIndex <= 3 ? 0 : 70);
    assert.equal(deposit.swiftTariff.monthlyIndex, zaSwiftUsed + 1);
    assert.equal(back.swiftTariff.monthlyIndex, returnIndex);
    assert.equal(back.swiftTariff.date, r.returnDate);
    close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  }
  for (const broker of ['ibkr', 'chief', 'usmart', 'za', 'hsbc']) {
    const r = run({ broker, depositMethod: 'chats', zaPerksLevel: 'lv1', zaSwiftUsed: 2 });
    if (row(r, 'returnWire')) close(row(r, 'returnWire').cny, 0);
  }
  for (const broker of ['chief', 'usmart']) {
    assert.equal(D.brokers.find(item => item.id === broker).swiftDestination, 'hong-kong');
    const r = run({ broker, depositMethod: 'swift', zaPerksLevel: 'lv1', zaSwiftUsed: 2, returnBank: 'bochk' });
    close(row(r, 'depositBank').cny, 0);
    assert.equal(row(r, 'depositBank').swiftTariff.destination, 'hong-kong');
    assert.equal(row(r, 'depositOther').cny, null);
  }
});

test('bank tier survives each stock account and receipt/return combination without waiving independent fees', () => {
  let checked = 0;
  for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const returnBank of D.calculator.hkBanks)
    for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) for (const zaPerksLevel of ['standard', 'lv1', 'lv2']) {
      const r = run({ bank, broker, returnBank, outcome, zaPerksLevel, zaSwiftUsed: 2, mainlandMethod: '', depositMethod: '', returnMethod: '' });
      if (row(r, 'returnWire')?.swiftTariff) close(row(r, 'returnWire').cny / r.refs.HKD, zaPerksLevel === 'standard' ? 70 : 0);
      const ordinary = run({ bank, broker, returnBank, outcome, zaPerksLevel: 'standard', mainlandMethod: '', depositMethod: '', returnMethod: '' });
      for (const key of ['entryMiddle', 'withdrawMiddle', 'returnOther']) if (row(r, key)) assert.equal(row(r, key).cny, row(ordinary, key).cny);
      if (!r.error) close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
      assert.equal(M.calculatorIssue(M.calculatorRoute({ ...base, bank, broker, returnBank, outcome, zaPerksLevel }), D), '');
      checked++;
    }
  assert.equal(checked, 2700);
  for (const zaPerksLevel of ['standard', 'lv1', 'lv2']) {
    const r = run({ zaPerksLevel, zaSwiftUsed: 3 });
    assert.equal(row(r, 'depositOther').cny, null);
    assert.equal(row(r, 'withdrawMiddle').cny, null);
    assert.equal(row(r, 'returnOther').cny, null);
    assert.equal(r.complete, false); assert.equal(r.rankable, false);
  }
});

test('invalid active ZA quota is named locally while unused, pre-change and unlimited tiers still calculate', () => {
  for (const zaSwiftUsed of [-1, .5, 'invalid', Infinity]) {
    const r = run({ zaPerksLevel: 'lv1', zaSwiftUsed });
    assert.equal(row(r, 'depositBank').cny, null);
    assert.match(row(r, 'depositBank').status, /须为非负整数/);
    assert.ok(r.missing.some(item => item.includes('海外汇款笔数')));
    assert.ok(r.steps.hongKong > 0);
    for (const zaPerksLevel of ['standard', 'lv2']) {
      const unused = run({ zaPerksLevel, zaSwiftUsed });
      close(row(unused, 'depositBank').cny / unused.refs.HKD, zaPerksLevel === 'lv2' ? 0 : 70);
    }
    const before = run({ date: '2026-10-31', months: 1, zaPerksLevel: 'lv1', zaSwiftUsed });
    close(row(before, 'depositBank').cny, 0); close(row(before, 'returnWire').cny, 0);
    const local = run({ broker: 'usmart', outcome: 'broker-balance', zaPerksLevel: 'lv1', zaSwiftUsed });
    close(row(local, 'depositBank').cny, 0);
  }
  const badTier = run({ zaPerksLevel: 'invalid' });
  assert.equal(row(badTier, 'depositBank').cny, null);
  assert.match(row(badTier, 'depositBank').status, /ZA Perks等级/);
  const overridden = run({ zaPerksLevel: 'lv1', zaSwiftUsed: 'invalid', depositHkd: 5, returnWireHkd: 6 });
  close(row(overridden, 'depositBank').cny / overridden.refs.HKD, 5);
  close(row(overridden, 'returnWire').cny / overridden.refs.HKD, 6);
});

test('legacy stock Lv2 qualification migrates to the unified bank tier and recommendation application retains it', () => {
  const provider = D.brokers.find(item => item.id === 'za');
  const trading = input => M.brokerTradingFees({ ...config, ...input }, provider, 10000, 0, refs);
  assert.deepEqual(trading({ zaLv2: true }), trading({ zaPerksLevel: 'lv2' }));
  assert.deepEqual(trading({ zaLv2: true, zaPerksLevel: 'standard' }), trading({ zaLv2: false }));
  const input = { ...base, broker: 'za', bank: 'bochk', outcome: 'broker-balance', date: '2026-10-11', zaPerksLevel: 'lv2', zaSwiftUsed: 2,
    startSell: '', usdCny: '', usdHkd: '', usdCnh: '', pricingBasis: 'best-quote' };
  const plans = M.calculatorRecommendations(input, D, Q).plans;
  assert.ok(plans.length >= 2);
  for (const plan of plans) {
    const applied = M.applyRoute(input, plan.result, plan.id);
    assert.equal(applied.zaPerksLevel, 'lv2'); assert.equal(applied.zaSwiftUsed, 2);
    assert.equal(applied.broker, 'za');
    const r = M.calculatorJourney(M.calculatorRoute(applied), D, Q).selected;
    close(r.costCny, plan.result.costCny); close(r.netCny, plan.result.netCny);
  }
});
