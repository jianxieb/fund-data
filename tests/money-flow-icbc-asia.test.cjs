const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const E = require('./fixtures/money-flow-icbc-asia-personal-20261012.json');
const raw = require('./fixtures/icbc-asia-fx-20261012.json');
const Q = structuredClone(require('./fixtures/money-flow-quotes-20261011.json'));
const usd = raw.data.find(item => item.currename === 'USD'), cnh = raw.data.find(item => item.currename === 'CNY');
// Independent arithmetic from the archived bank response, not production parsing.
Q.offshoreUsd['icbc-asia'] = { source: D.sources.icbcAsiaFx.url, quotes: {
  HKD: { bidPerUsd: +usd.buyrate, askPerUsd: +usd.salrate, asOf: usd.updateTime },
  CNH: { bidPerUsd: +usd.buyrate / +cnh.salrate, askPerUsd: +usd.salrate / +cnh.buyrate,
    asOf: usd.updateTime, path: 'via-HKD', legs: { usdBuy: +usd.buyrate, usdSell: +usd.salrate, cnhBuy: +cnh.buyrate, cnhSell: +cnh.salrate } }
} };
const input = { date: E.checkedAt, budgetCny: 100000, count: 1, months: 0, profitUsd: 0,
  startBank: 'icbc', bank: 'icbc-asia', broker: 'usmart', route: 'USD', outcome: 'broker-balance',
  returnBank: 'icbc-asia', exitBank: 'icbc', mainlandMethod: '', depositMethod: '', returnMethod: '',
  buyOrders: 1, sellOrders: 1, sharePriceUsd: 100, taxRate: 20, creditCny: 0, withdrawalIndex: 1,
  entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', icbcEAccount: false,
  icbcCnhAccount: false, hsbcBalanceWaiver: false, trade25: false, useVoucher: false };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...input, ...changes }), D, Q);
const row = (r, key) => r.rows.find(item => item.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const bank = id => D.hkBanks.find(item => item.id === id);
const mainland = id => D.mainlandBanks.find(item => item.id === id);
const ledger = r => {
  close(r.rows.reduce((sum, item) => sum + (item.cny ?? 0), 0), r.costCny);
  close(r.netCny, r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);
};

test('ICBC mobile group, other-bank electronic and ordinary RMB tariffs cannot substitute for one another', () => {
  assert.equal(D.sources.icbcInternational.url, E.mainland.source);
  assert.equal(D.sources.icbcOnline.url, E.mainland.electronicSource);
  const before = structuredClone(D.calculator);
  for (const route of E.mainland.foreignCurrencyMobileToGroup.modelCurrencies) for (const count of [1, 2, 3]) {
    const s = M.calculatorRoute({ ...input, route, count });
    assert.equal(s.mainlandMethod, 'icbc-mobile'); assert.equal(s.depositMethod, 'internal');
    const r = M.calculatorJourney(s, D, Q).selected;
    assert.ok(r); close(row(r, 'sender').cny, 0);
    assert.deepEqual(row(r, 'sender').sources, ['icbcInternational', 'icbcOnline']);
    assert.deepEqual(row(r, 'sender').items.map(item => item.cny), [0, 0]);
    close(row(r, 'entryInward').cny, count * E.hongKong.swiftInwardHkd * r.refs.HKD);
    close(row(r, 'depositBank').cny, 0); close(row(r, 'depositOther').cny, 0); ledger(r);
  }
  for (const bankId of D.calculator.hkBanks) for (const route of D.calculator.currencies) {
    const channels = M.calculatorChannels({ ...input, bank: bankId, route }, D);
    assert.equal(channels.mainlandMethods.includes('icbc-mobile'), bankId === 'icbc-asia' && route !== 'CNH');
  }
  for (const changes of [{ route: 'CNH' }, { bank: 'bochk' }, { startBank: 'ccb' }]) {
    assert.match(M.calculatorJourney({ ...input, ...changes, mainlandMethod: 'icbc-mobile' }, D, Q).error, /须选择工商银行→工银亚洲/);
  }
  const tariff = E.mainland.otherBankElectronic;
  const ordinary = run({ bank: 'bochk', mainlandMethod: 'swift' }).selected;
  close(row(ordinary, 'sender').cny, 100000 - (100000 - tariff.telegramHongKongCny) / (1 + tariff.counterRate * tariff.discount));
  assert.equal(run({ route: 'CNH', icbcCnhAccount: true }).selected.rows.find(item => item.key === 'sender').cny, null);
  assert.deepEqual(D.calculator, before);
});

test('e-account qualifications waive only active group basic fees, never local CHATS or agent fees', () => {
  assert.equal(D.sources.icbcAsiaInwardOffer.url, E.eAccountOffer.inwardSource);
  assert.equal(D.sources.icbcAsiaOutwardOffer.url, E.eAccountOffer.outwardSource);
  for (const [date, active] of [['2026-06-30', false], ['2026-07-01', true], ['2026-12-31', true], ['2027-01-01', false]]) {
    close(M.inwardFee(bank('icbc-asia'), 100000, 'icbc', false, date, { icbcEAccount: true }), active ? 0 : 60);
    close(M.inwardFee(bank('icbc-asia'), 100000, 'boc', false, date, { icbcEAccount: true }), 60);
    close(M.inwardFee(bank('icbc-asia'), 100000, 'icbc', false, date, { icbcEAccount: false }), 60);
  }
  for (const icbcEAccount of [false, true]) {
    const r = run({ icbcEAccount, count: 3 }).selected;
    close(row(r, 'entryInward').cny, (icbcEAccount ? 0 : 180) * r.refs.HKD);
    assert.ok(row(r, 'entryMiddle').estimate); assert.match(row(r, 'entryMiddle').evidence, /大湾区一类/);
    assert.equal(row(r, 'account').items.find(item => item.bankId === 'icbc-asia').cny, 0);
    ledger(r);
  }
  const overridden = run({ icbcEAccount: true, entryMiddleCny: '12', count: 3 }).selected;
  close(row(overridden, 'entryMiddle').cny, 36); close(row(overridden, 'entryInward').cny, 0); ledger(overridden);
});

test('local USD transfers use 50 HKD sending and 10 HKD personal receiving, independently from corporate receipt and same-bank funding', () => {
  const refs = run({}).selected.refs;
  close(M.localUsdTransfer(bank('icbc-asia'), bank('za'), refs, input.date), E.hongKong.localUsdChatsOutwardHkd * refs.HKD);
  close(M.localUsdTransfer(bank('bochk'), bank('icbc-asia'), refs, input.date), E.hongKong.localUsdChatsInwardHkd * refs.HKD);
  close(M.localUsdTransfer(bank('icbc-asia'), bank('icbc-asia'), refs, input.date), 0);
  for (const icbcEAccount of [false, true]) {
    const intoZa = run({ broker: 'za', icbcEAccount }).selected;
    close(row(intoZa, 'depositBank').cny, 50 * intoZa.refs.HKD); ledger(intoZa);
    const via = run({ startBank: 'boc', bank: 'bochk', depositMethod: 'via-icbc-asia', icbcEAccount }).selected;
    assert.equal(via.fundingBank.id, 'icbc-asia'); close(row(via, 'depositOther').cny, 10 * via.refs.HKD);
    close(row(via, 'depositBroker').cny, 0); ledger(via);
    const corporate = run({ startBank: 'boc', bank: 'bochk', depositMethod: 'chats-icbc-asia', icbcEAccount }).selected;
    assert.equal(corporate.fundingBank, null); close(row(corporate, 'depositOther').cny, 10 * corporate.refs.HKD); ledger(corporate);
    for (const broker of ['za', 'hsbc']) {
      const back = run({ broker, outcome: 'usd-balance', returnBank: 'icbc-asia', icbcEAccount }).selected;
      close(row(back, 'returnInward').cny, 10 * back.refs.HKD); ledger(back);
    }
  }
});

test('ICBC Asia CNH conversion preserves both actual HKD exchange legs and does not discount an entire quote by 30 percent', () => {
  const result = run({ startBank: 'boc', route: 'CNH', icbcCnhAccount: true, entryMiddleCny: '0' });
  const r = result.selected;
  assert.ok(r); const fx = row(r, 'brokerSpread');
  close(r.entryPrice, +usd.salrate / +cnh.buyrate);
  assert.deepEqual(fx.path, ['CNH', 'HKD', 'USD']); assert.equal(fx.exchanges.length, 2);
  close(fx.exchanges[0].output, r.steps.hongKong * +cnh.buyrate);
  close(fx.exchanges[1].output, fx.exchanges[0].output / +usd.salrate);
  close(fx.items.reduce((sum, item) => sum + item.cny, 0), fx.cny);
  close(r.steps.fundedUsd, fx.exchanges[1].output); ledger(r);
  const back = run({ icbcEAccount: true, icbcCnhAccount: true, outcome: 'cnh-card' }).selected;
  const exitFx = row(back, 'exitFx'); close(back.exitPrice, +usd.buyrate / +cnh.salrate);
  assert.equal(exitFx.exchanges.length, 2); close(row(back, 'card').cny, 0); ledger(back);
});

test('HKID account and card boundaries preserve upstream amounts and all six banks remain selectable for each broker', () => {
  const before = structuredClone(D.calculator);
  for (const broker of D.calculator.brokers) {
    const rejected = run({ startBank: 'boc', route: 'CNH', broker });
    assert.match(rejected.error, /香港身份证/); assert.equal(rejected.partial.errorStage, '02');
    assert.ok(rejected.partial.steps.mainlandForeign > 0); assert.equal(rejected.partial.steps.hongKong, undefined);
    assert.ok(rejected.partial.rows.some(item => item.key === 'sender'));
    assert.equal(M.calculatorIssue(M.calculatorRoute({ ...input, broker }), D), '');
  }
  const card = run({ outcome: 'cnh-card' }); assert.match(card.error, /香港身份证/);
  assert.ok(card.partial.steps.returnUsd > 0);
  const usdCard = run({ outcome: 'usd-card' }); assert.match(usdCard.error, /不支持本页美元余额原币刷卡/);
  assert.ok(usdCard.partial.steps.returnUsd > 0);
  assert.equal(bank('icbc-asia').directUsdCard, E.account.directUsdDebit);
  assert.deepEqual(D.calculator.hkBanks, ['bochk', 'hsbc', 'za', 'hang', 'sc', 'icbc-asia']);
  assert.deepEqual(D.calculator, before);
});

test('ICBC express and ordinary return fees use the actual sell date and keep agents separate after promotion expiry', () => {
  const refs = run({}).selected.refs;
  for (const [method, target, feeHkd] of [['icbc-express', 'icbc', 80], ['swift', 'icbc', 100], ['swift', 'boc', 140]]) {
    close(M.returnFee(bank('icbc-asia'), mainland(target), method, refs, input.date), feeHkd * refs.HKD);
  }
  assert.equal(M.returnFee(bank('icbc-asia'), mainland('boc'), 'icbc-express', refs, input.date), null);
  for (const [months, expectedHkd, expectedDate] of [[0, 0, '2026-10-12'], [3, 0, '2026-12-12'], [4, 80, '2027-01-12'], [12, 80, '2027-09-12']]) {
    const s = M.calculatorRoute({ ...input, outcome: 'mainland', months, icbcEAccount: true });
    assert.equal(s.returnMethod, 'icbc-express'); const r = M.calculatorJourney(s, D, Q).selected;
    assert.ok(r); close(row(r, 'returnWire').cny, expectedHkd * r.refs.HKD);
    assert.ok(row(r, 'returnWire').evidence.includes(expectedDate));
    assert.equal(row(r, 'returnOther').cny, null); assert.ok(r.missing.includes('回内地中转行费')); ledger(r);
  }
});

test('Hong Kong USD clearing cheques use the local counter tariff without copying foreign collection fees or SC prefilled discounts', () => {
  const b = bank('icbc-asia'), tariff = E.hongKong.counterLocalCheque;
  for (const chequeIndex of [1, 30, 31, 99]) for (const chequePreFilled of [false, true]) {
    close(M.localUsdChequeFee(b, chequeIndex, input.date, chequePreFilled), chequeIndex <= tariff.freePerDay ? 0 : tariff.excessPerChequeHkd);
    for (const broker of ['usmart', 'chief']) {
      const r = run({ broker, outcome: 'usd-balance', chequeIndex, chequePreFilled }).selected;
      assert.ok(r); close(row(r, 'returnInward').cny, (chequeIndex <= tariff.freePerDay ? 0 : tariff.excessPerChequeHkd) * r.refs.HKD);
      assert.match(row(r, 'returnInward').evidence, /每日前30张免费/); ledger(r);
    }
  }
  assert.equal(M.localUsdChequeFee(b, 1, '2026-08-31'), null);
  assert.equal(M.localUsdChequeFee(b, 1.5, input.date), null);
});
