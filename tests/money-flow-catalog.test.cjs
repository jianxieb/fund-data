const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const { audit: auditCurrent, config: currentConfig } = require('../scripts/audit_money_flow.cjs');
const Q = require('./fixtures/money-flow-quotes-20261009.json');
const diversityQuotes = require('./fixtures/money-flow-quotes-20261011.json');
const fundingEvidence = require('./fixtures/money-flow-ibkr-funding-20261011.json');
const usmartFundingEvidence = require('./fixtures/money-flow-usmart-same-bank-20261011.json');
const bocBankAnswer = require('./fixtures/money-flow-boc-bank-answer-20260819.json');
const swiftGoAvailability = require('./fixtures/money-flow-swift-go-availability-20261012.json');
const cibSmallUsd = require('./fixtures/money-flow-cib-small-usd-20260317.json');
const cibTariff = require('./fixtures/money-flow-cib-tariff-20261011.json');
const config = { ...currentConfig, date: '2026-10-10' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const base = M.calculatorRoute({ ...config, startBank: 'cib', bank: 'bochk', broker: 'za', returnBank: 'bochk', exitBank: 'hsbc', route: 'USD', outcome: 'broker-balance' });
const run = changes => M.calculatorJourney({ ...base, ...changes }, D, Q);
const ledger = r => {
  assert.ok(Number.isFinite(r.net));
  close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  close(r.rows.reduce((sum, x) => sum + (x.cny || 0), 0), r.costCny);
};

test('BOC electronic transfers to other banks apply the current bank-authored discount per transfer', () => {
  assert.equal(D.sources.bocBankAnswer2026.url, bocBankAnswer.source);
  const tariff = bocBankAnswer.otherBankElectronic;
  for (const bank of D.calculator.hkBanks.filter(id => id !== 'bochk')) for (const broker of D.calculator.brokers) for (const route of tariff.modelCurrencies) {
    const input = M.calculatorRoute({ ...base, startBank: 'boc', bank, broker, route, count: 1, mainlandMethod: '', depositMethod: '' });
    assert.equal(input.mainlandMethod, 'boc-online');
    const result = M.calculatorJourney(input, D, Q), r = result.selected || result.partial;
    assert.ok(r, bank + '/' + broker + '/' + route);
    const principal = (100000 - tariff.telegramCny) / (1 + tariff.rate), sender = r.rows.find(item => item.key === 'sender');
    close(sender.cny, 100000 - principal);
    close(sender.items[0].cny, principal * tariff.rate); close(sender.items[1].cny, tariff.telegramCny);
    assert.deepEqual(sender.sources, ['bocBankAnswer2026']);
    assert.equal(r.rows.find(item => item.key === 'entryMiddle').cny, null);
    ledger(r);
  }
  for (const [budgetCny, count, expected] of [[1000, 2, 234], [1000000, 2, 612]]) {
    const r = run({ startBank: 'boc', bank: 'hsbc', mainlandMethod: 'boc-online', budgetCny, count }).selected;
    close(r.rows.find(item => item.key === 'sender').cny, expected);
    close(r.steps.mainlandForeign * r.startSell + expected, budgetCny); ledger(r);
  }
  assert.match(run({ startBank: 'boc', bank: 'hsbc', mainlandMethod: 'boc-online', budgetCny: 112 }).error, /预算不足/);
});

test('BOC group mobile, other-bank electronic, standard wire and normal inward receipt stay separate', () => {
  for (const route of ['USD', 'HKD']) {
    const input = M.calculatorRoute({ ...base, startBank: 'boc', bank: 'bochk', route, mainlandMethod: '' });
    assert.equal(input.mainlandMethod, 'boc-mobile');
    close(M.calculatorJourney(input, D, Q).selected.rows.find(item => item.key === 'sender').cny, bocBankAnswer.groupMobile.feeCny);
    assert.match(run({ ...input, mainlandMethod: 'boc-online' }).error, /向境外他行/);
  }
  const normal = run({ startBank: 'boc', bank: 'hsbc', mainlandMethod: 'swift', count: 1 }).selected;
  close(normal.rows.find(item => item.key === 'sender').cny, 100000 - (100000 - 80) / 1.001);
  const cnh = M.calculatorRoute({ ...base, startBank: 'boc', bank: 'hsbc', route: 'CNH', mainlandMethod: '' });
  assert.equal(cnh.mainlandMethod, 'swift');
  assert.ok(!M.calculatorChannels(cnh, D).mainlandMethods.includes('boc-online'));
  assert.match(run({ ...cnh, mainlandMethod: 'boc-online' }).error, /USD\/HKD/);
  const returned = run({ outcome: 'mainland', returnBank: 'bochk', exitBank: 'boc', returnMethod: 'swift' }).selected;
  const receipt = returned.rows.find(item => item.key === 'returnOther').items.find(item => item.label.endsWith('USD收款费'));
  close(receipt.cny, bocBankAnswer.normalPersonalInward.bankFeeCny);
  assert.ok(!returned.missing.includes(receipt.label));
  assert.ok(returned.missing.includes('回内地中转行费'));
  assert.equal(returned.rows.find(item => item.key === 'returnOther').items.find(item => item.label === '回内地中转行费').cny, null);
  ledger(returned);
});

test('IBKR funding choices agree with the current public tool for mainland and Hong Kong residents', () => {
  const ibkr = D.brokers.find(b => b.id === 'ibkr');
  for (const profile of fundingEvidence.profiles) {
    assert.equal(Object.keys(profile.currenciesResponse.errors).length, 0);
    assert.equal(profile.currenciesResponse.ibEntity, profile.region === 'CHN' ? 'LLC' : 'HK');
    for (const currency of D.calculator.currencies) {
      const api = profile.deposits[currency].response;
      assert.deepEqual(api.errors, {}); assert.deepEqual(api.requestErrors, {});
      for (const [channel, method] of [['fps', 'FPS_NOTIFICATION'], ['edda', 'EDDA']]) {
        assert.equal(ibkr.depositCurrencies[channel].includes(currency), api.methods.includes(method), profile.region + '/' + currency + '/' + channel);
      }
      for (const bank of D.calculator.hkBanks) for (const fxMode of ['manual', 'auto', 'bank']) {
        const channels = M.calculatorChannels({ ...base, broker: 'ibkr', bank, route: currency, fxMode }, D).depositMethods;
        const funded = fxMode === 'bank' ? 'USD' : currency;
        for (const [channel, method] of [['fps', 'FPS_NOTIFICATION'], ['edda', 'EDDA']]) {
          assert.equal(channels.includes(channel), profile.deposits[funded].response.methods.includes(method));
        }
      }
    }
  }
  assert.deepEqual(D.broker.depositCurrencies, ibkr.depositCurrencies);
});

test('broker local payment channels use their own published currency coverage', () => {
  for (const bank of D.calculator.hkBanks) for (const [broker, fps, edda] of [
    ['chief', ['HKD'], ['HKD', 'CNH']], ['usmart', ['HKD', 'CNH'], ['HKD']]
  ]) for (const route of D.calculator.currencies) {
    const methods = M.calculatorChannels({ ...base, bank, broker, route, fxMode: 'manual' }, D).depositMethods;
    assert.equal(methods.includes('fps'), fps.includes(route), bank + '/' + broker + '/' + route);
    assert.equal(methods.includes('edda'), edda.includes(route), bank + '/' + broker + '/' + route);
  }
});

test('uSMART same-bank funding includes the published HSBC account without waiving cross-bank fees', () => {
  const usmart = D.brokers.find(b => b.id === 'usmart');
  const supported = usmartFundingEvidence.publishedReceivingBanks.filter(b => D.calculator.hkBanks.includes(b.id));
  assert.deepEqual(usmart.internalFundingBanks, supported.map(b => b.id));
  assert.equal(D.sources.usmartFundingAccounts.url, usmartFundingEvidence.accountSource);
  assert.equal(D.sources.usmartSameFunding.url, usmartFundingEvidence.feeSource);
  for (const bank of D.calculator.hkBanks) for (const route of D.calculator.currencies) {
    const s = M.calculatorRoute({ ...config, bank, startBank: 'hsbc', broker: 'usmart', returnBank: bank,
      exitBank: 'hsbc', route, outcome: 'broker-balance', icbcCnhAccount: true });
    const allowed = supported.some(item => item.id === bank && item.currencies.includes(route));
    assert.equal(M.calculatorChannels(s, D).depositMethods.includes('internal'), allowed);
    assert.equal(s.depositMethod === 'internal', allowed);
    const result = M.calculatorJourney(s, D, diversityQuotes), r = result.selected || result.partial;
    assert.ok(r, bank + '/' + route);
    if (allowed) {
      for (const key of ['depositBank', 'depositOther', 'depositBroker']) close(r.rows.find(row => row.key === key).cny, usmartFundingEvidence.sameBank.fee);
      assert.ok(!r.missing.includes('入金代理／收款行费'));
      assert.equal(r.depositMethod, 'internal'); ledger(r);
    } else {
      assert.match(M.calculatorJourney({ ...s, depositMethod: 'internal' }, D, diversityQuotes).error, /同行入金/);
      close(r.rows.find(row => row.key === 'depositOther').cny, 15 * r.refs.HKD);
      assert.match(r.rows.find(row => row.key === 'depositOther').estimate, /企业CHATS标准价/);
    }
  }
  const explicitCrossBank = M.calculatorJourney(M.calculatorRoute({ ...config, startBank: 'hsbc', bank: 'hsbc',
    broker: 'usmart', route: 'USD', outcome: 'broker-balance', returnBank: 'hsbc', exitBank: 'hsbc', depositMethod: 'swift' }), D, diversityQuotes).selected;
  assert.equal(explicitCrossBank.rows.find(row => row.key === 'depositOther').cny, null);
});

test('all 262440 catalogue combinations including USD and HKD returns retain selection and reconcile or name the exact local issue', () => {
  const r = auditCurrent({ quotes: Q, date: config.date });
  assert.equal(r.combinationsChecked, 262440);
  assert.equal(r.completeQuoteCombinations + r.partialQuoteCombinations + r.inputOrRouteIssues, r.combinationsChecked);
  assert.equal(r.ledgerChecks, r.completeQuoteCombinations + r.partialQuoteCombinations);
  assert.ok(r.completeQuoteCombinations > 0); assert.ok(r.partialQuoteCombinations > 0);
  assert.ok(r.routes.every(r => !r.key.includes('abc')));
  assert.equal(r.channelProfiles.length, 3);
  for (const profile of r.channelProfiles) {
    assert.ok(profile.checked - profile.chequeBoundaryChecks > 139295);
    for (const method of ['via-bochk', 'via-hsbc', 'via-hang']) assert.ok(profile.coverage.depositMethods.includes(method));
    assert.ok(profile.chequeBoundaryChecks > 0);
    assert.equal(profile.priced + profile.partial + profile.routeIssues, profile.checked);
    assert.equal(profile.ledgerChecks, profile.priced + profile.partial);
    assert.ok(profile.retainedPartialResults > 0);
    assert.ok(profile.referencePriced <= profile.priced);
    assert.deepEqual(profile.coverage.mainlandMethods, ['boc-mobile', 'boc-online', 'full', 'icbc-mobile', 'linked', 'swift']);
    assert.deepEqual(profile.coverage.fxModes, ['auto', 'bank', 'manual']);
    assert.deepEqual(profile.coverage.depositMethods, ['chats', 'chats-citic', 'chats-hang', 'chats-hsbc', 'chats-icbc-asia', 'edda', 'fps', 'internal', 'swift', 'via-bochk', 'via-hang', 'via-hsbc', 'via-icbc-asia']);
    assert.deepEqual(profile.coverage.returnMethods, ['bochk-fast', 'icbc-express', 'linked', 'swift']);
    assert.deepEqual(profile.coverage.returnCurrencies, ['HKD', 'USD']);
    assert.equal(Object.values(profile.sources).reduce((sum, source) => sum + source.checked, 0), profile.checked);
  }
  assert.equal(r.channelProfiles[0].profile.hsbcBalanceWaiver, false);
  assert.equal(r.channelProfiles[0].profile.trade25, false);
  assert.deepEqual(r.channelProfiles[2].qualificationCoverage, ['chequePreFilled', 'chiefMonthly', 'cnHangFeeWaived', 'cnHsbcFeeWaived', 'cnScFeeWaived',
    'hsbcBalanceWaiver', 'icbcCnhAccount', 'icbcEAccount', 'scCnhAccount', 'trade25', 'usmartPromo', 'zaPerksLevel', 'zaSwiftUsed']);
  const bounds = r.numericBoundaries;
  assert.equal(bounds.checked, 63180);
  assert.deepEqual(bounds.profiles.map(p => p.id), ['principal-0.01', 'principal-1', 'principal-100', 'principal-1000', 'principal-100000', 'principal-1000000',
    'transfers-120', 'holding-1200-months', 'share-price-0.01', 'share-price-1000000', 'orders-120-per-side', 'impossible-loss', 'oversized-tax']);
  for (const p of bounds.profiles) {
    assert.equal(p.checked, 4860); assert.equal(p.priced + p.partial + p.routeIssues, p.checked);
    assert.equal(p.ledgerChecks, p.priced + p.partial); assert.ok(p.referencePriced <= p.priced);
    if (p.id === 'impossible-loss' || p.id === 'oversized-tax') {
      assert.equal(p.routeIssues, p.checked); assert.ok(p.retainedPartialResults > 0);
    }
  }
  for (const key of ['checked', 'priced', 'referencePriced', 'partial', 'routeIssues', 'ledgerChecks', 'retainedPartialResults']) {
    assert.equal(bounds[key], bounds.profiles.reduce((sum, p) => sum + p[key], 0));
  }
  const receipts = r.executedFxPrices;
  assert.equal(receipts.syntheticOnly, true);
  assert.deepEqual(receipts.prices, { HKD: 8, CNH: 6.72 });
  assert.equal(receipts.checked, 163944);
  assert.equal(receipts.profiles.length, 6);
  assert.equal(receipts.priced + receipts.partial + receipts.routeIssues, receipts.checked);
  assert.equal(receipts.ledgerChecks, receipts.priced + receipts.partial);
  assert.equal(receipts.inclusiveAutoFxChecks + receipts.manualFxChecks, receipts.ledgerChecks);
  assert.equal(receipts.legChecks, receipts.ledgerChecks * 6);
  assert.ok(receipts.inclusiveAutoFxChecks > 0); assert.ok(receipts.manualFxChecks > 0);
  assert.ok(receipts.partial > 0); assert.ok(receipts.retainedPartialResults > 0);
  for (const key of ['checked', 'priced', 'partial', 'routeIssues', 'ledgerChecks', 'legChecks', 'inclusiveAutoFxChecks', 'manualFxChecks', 'retainedPartialResults']) {
    assert.equal(receipts[key], receipts.profiles.reduce((sum, p) => sum + p[key], 0));
  }
});

test('ordinary CIB wire is the default; the optional full-amount service adds exactly 50 CNY per payment', () => {
  assert.equal(base.mainlandMethod, 'swift');
  assert.equal(run({}).selected.rows.find(x => x.key === 'entryMiddle').cny, null);
  for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const count of [2, 3, 30]) {
    const r = run({ bank, broker, count, mainlandMethod: 'cib-go', depositMethod: broker === 'usmart' && bank === 'bochk' ? 'internal' : 'chats' }).selected;
    assert.ok(r, [bank, broker, count].join('/'));
    close(r.rows.find(x => x.key === 'sender').cny, count * 50);
    close(r.rows.find(x => x.key === 'entryMiddle').cny, 0);
    close(r.rows.find(x => x.key === 'entryInward').cny, 0);
    close(r.steps.hongKong, (100000 - count * 50) / r.startSell); ledger(r);
  }
  close(run({ count: 2, usedFreeTransfers: 29, mainlandMethod: 'cib-go' }).selected.rows.find(x => x.key === 'sender').cny, 200);
});

test('full-amount limit never silently splits payments and honours exact budget boundaries', () => {
  const go = changes => run({ mainlandMethod: 'cib-go', ...changes });
  for (const changes of [{ count: 1 }, { count: 0 }, { count: 1.5 }, { count: 121 }, { budgetCny: 50, count: 1 }, { months: -1 }]) {
    const r = go(changes); assert.ok(r.error); assert.equal(r.selected, undefined);
  }
  const quote = go({ count: 1, budgetCny: 60000 }).selected.startSell;
  assert.ok(go({ count: 1, budgetCny: quote * 10000 + 50 }).selected);
  assert.match(go({ count: 1, budgetCny: quote * 10000 + 50.01 }).error, /上限/);
  const after = go({ date: '2027-07-01' });
  assert.ok(after.error || after.selected?.missing.length);
});

test('CIB RMB wire uses retail commission and telegram charges without inheriting FX-only waivers', () => {
  const bank = D.mainlandBanks.find(b => b.id === 'cib');
  const cnh = { ...bank, ...bank.cnhTariff };
  for (const date of ['2026-10-10', '2027-07-01']) for (const index of [1, 30, 31]) {
    for (const [principal, charge] of [[10000, 150], [50000, 150], [100000, 200], [200000, 300], [1000000, 300]]) {
      close(M.fee(cnh, principal, index, date), charge);
    }
  }
  for (const count of [1, 2, 3]) for (const usedFreeTransfers of [0, 29, 30]) {
    const r = run({ startBank: 'cib', route: 'CNH', bank: 'bochk', mainlandMethod: 'swift', fxMode: 'bank', count, usedFreeTransfers }).selected;
    const sender = r.rows.find(x => x.key === 'sender');
    const expected = count === 1 ? 100000 - 99900 / 1.001 : count * 150;
    close(sender.cny, expected);
    close(sender.items.find(x => x.label === '汇出电讯费').cny, count * 100);
    close(sender.items.reduce((sum, item) => sum + item.cny, 0), expected);
    close(r.steps.mainlandForeign, 100000 - expected);
    close(r.rows.find(x => x.key === 'entryFx').cny, 0);
    assert.equal(r.rows.find(x => x.key === 'entryMiddle').cny, null);
    assert.ok(!r.missing.some(x => /兴业.*汇出手续费|兴业.*电讯费/.test(x)));
    ledger(r);
  }
  close(run({ count: 1, usedFreeTransfers: 0 }).selected.rows.find(x => x.key === 'sender').cny, 0);
  close(run({ count: 1, usedFreeTransfers: 30 }).selected.rows.find(x => x.key === 'sender').cny, 100);
});

test('CIB published standard fees survive the promotion end for every bank, broker and wire currency', () => {
  const expired = { ...base, date: '2027-07-01', count: 1, months: 0, outcome: 'broker-balance',
    startSell: 6.75, usdCny: 6.75, usdHkd: 7.8, usdCnh: 7.1, usedFreeTransfers: 'inactive-invalid',
    mainlandMethod: 'swift', fxMode: 'bank', icbcCnhAccount: true };
  const bank = D.mainlandBanks.find(item => item.id === 'cib');
  assert.equal(D.sources.cib.url, cibTariff.source);
  assert.equal(bank.rate, cibTariff.standard.rate);
  assert.equal(bank.commissionWaiver.until, cibTariff.cardCommissionWaiver.until);
  assert.equal(cibTariff.cardCommissionWaiver.transferLimit, null);
  assert.equal(M.telegramAllowance(bank, '2027-06-30'), cibTariff.telegram.freeTransfers);
  assert.equal(M.telegramAllowance(bank, expired.date), 0);
  for (const receiving of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const route of D.calculator.currencies) {
    const input = M.calculatorRoute({ ...expired, bank: receiving, broker, route, depositMethod: '' });
    const result = M.calculatorJourney(input, D, Q), r = result.selected || result.partial;
    assert.ok(r, `${receiving}/${broker}/${route}: ${result.error}`);
    const sender = r.rows.find(item => item.key === 'sender');
    const principal = (input.budgetCny - cibTariff.telegram.standardCny) / (1 + cibTariff.standard.rate);
    close(sender.cny, input.budgetCny - principal);
    close(sender.items[0].cny, principal * cibTariff.standard.rate);
    close(sender.items[1].cny, cibTariff.telegram.standardCny);
    assert.ok(!r.missing.some(item => /兴业.*汇出手续费|兴业.*电讯费/.test(item)));
    if (result.selected) ledger(r);
  }
});

test('source accounts, Hong Kong banks, stock venues and every currency have independent catalogues', () => {
  assert.deepEqual(D.calculator.mainland, ['boc', 'cib', 'cmb', 'icbc', 'ccb', 'comm', 'hsbc', 'hang', 'sc']);
  for (const startBank of D.calculator.mainland) for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const route of D.calculator.currencies) {
    assert.equal(M.calculatorIssue({ ...base, startBank, bank, broker, route }, D), '');
  }
  assert.match(M.calculatorIssue({ ...base, startBank: 'abc' }, D), /农业银行/);
});

test('ICBC ordinary USD full-amount service includes the recipient fee without waiving normal sender tariffs', () => {
  const bank = D.mainlandBanks.find(x => x.id === 'icbc');
  assert.equal(bank.fullAmountUsd, 25);
  const quotes = structuredClone(Q);
  quotes.banks.icbc = { quotes: { USD: { buy: 6.69, sell: 6.71, asOf: '2026-10-10 10:00:00' } } };
  const icbcRun = changes => M.calculatorJourney({ ...base, startBank: 'icbc', ...changes }, D, quotes);
  const ordinaryConfig = M.calculatorRoute({ ...base, startBank: 'icbc', mainlandMethod: '' });
  assert.equal(ordinaryConfig.mainlandMethod, 'swift');
  assert.equal(icbcRun(ordinaryConfig).selected.rows.find(x => x.key === 'entryMiddle').cny, null);
  for (const receiving of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const count of [1, 2, 3]) {
    const r = icbcRun({ bank: receiving, broker, count, mainlandMethod: 'full', depositMethod: 'chats' }).selected;
    assert.ok(r, [receiving, broker, count].join('/'));
    const sender = r.rows.find(x => x.key === 'sender');
    const supplemental = sender.items.find(x => x.label.startsWith('全额到账附加费'));
    close(supplemental.cny, count * 25 * r.startSell);
    close(sender.items.find(x => x.label === '汇出电讯费').cny, count * 80);
    close(sender.items.find(x => x.label === '汇出手续费').cny, count * Math.min(208, Math.max(40, r.steps.mainlandForeign * r.startSell / count * .0008)));
    close(sender.items.reduce((sum, item) => sum + item.cny, 0), sender.cny);
    close(r.steps.mainlandForeign * r.startSell + sender.cny, 100000);
    close(r.rows.find(x => x.key === 'entryMiddle').cny, 0);
    close(r.rows.find(x => x.key === 'entryInward').cny, 0);
    ledger(r);
  }
  for (const route of ['CNH', 'HKD']) assert.match(run({ startBank: 'icbc', route, fxMode: 'bank', mainlandMethod: 'full' }).error, /USD全额到账/);
});

test('CCB current personal full-amount tariff prices every receiving bank and stock account without deducting a second recipient fee', () => {
  const evidence = require('./fixtures/money-flow-full-amount-20261011.json');
  const bank = D.mainlandBanks.find(x => x.id === 'ccb');
  assert.equal(bank.fullAmountUsd, evidence.ccb.supplementUsd);
  assert.equal(bank.fullAmountIncludesInward, true);
  assert.equal(D.sources.ccbFullAmount.url, evidence.ccb.productSource);
  const quotes = structuredClone(Q);
  quotes.banks.ccb = { quotes: { USD: { buy: 6.69, sell: 6.71, asOf: '2026-10-10 10:00:00' } } };
  const ccbRun = changes => M.calculatorJourney(M.calculatorRoute({ ...base, count: 1, startBank: 'ccb', mainlandMethod: 'full', ...changes }), D, quotes);
  for (const receiving of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const count of [1, 2, 3]) {
    const input = { bank: receiving, broker, count, depositMethod: '', months: 0 };
    const r = ccbRun(input).selected;
    assert.ok(r, [receiving, broker, count].join('/'));
    assert.ok(M.calculatorChannels({ ...base, ...input, startBank: 'ccb', route: 'USD' }, D).mainlandMethods.includes('full'));
    const sender = r.rows.find(x => x.key === 'sender');
    close(sender.items.find(x => x.label.startsWith('全额到账附加费')).cny, count * evidence.ccb.supplementUsd * r.startSell);
    close(sender.items.find(x => x.label === '汇出手续费').cny, count * Math.min(300, Math.max(20, r.steps.mainlandForeign * r.startSell / count * .001)));
    close(sender.items.find(x => x.label === '汇出电讯费').cny, count * 80);
    close(r.steps.mainlandForeign * r.startSell + sender.cny, 100000);
    close(r.rows.find(x => x.key === 'entryMiddle').cny, 0);
    close(r.rows.find(x => x.key === 'entryInward').cny, 0);
    close(r.steps.hongKong, r.steps.mainlandForeign);
    assert.ok(r.rows.find(x => x.key === 'entryInward').sources.includes('ccbFullAmount'));
    ledger(r);
  }
  const ordinary = ccbRun({ bank: 'bochk', mainlandMethod: 'swift' }).selected;
  close(ordinary.rows.find(x => x.key === 'entryInward').cny, 60 * ordinary.refs.HKD);
  assert.equal(ordinary.rows.find(x => x.key === 'entryMiddle').cny, null);
  const actual = ccbRun({ entryInwardHkd: 10, entryMiddleCny: 20 }).selected;
  close(actual.rows.find(x => x.key === 'entryInward').cny, 10 * actual.refs.HKD);
  close(actual.rows.find(x => x.key === 'entryMiddle').cny, 20);
  for (const route of ['HKD', 'CNH']) assert.match(ccbRun({ route }).error, /USD全额到账/);
  const missingQuote = structuredClone(quotes); delete missingQuote.banks.ccb;
  const partial = M.calculatorJourney({ ...base, startBank: 'ccb', mainlandMethod: 'full' }, D, missingQuote).partial;
  close(partial.rows.find(x => x.key === 'entryInward').cny, 0);
  assert.equal(partial.steps.hongKong, undefined);
});

test('the screenshot uses one benchmark: HSBC 0.451% equals 450.87 CNY; the best CIB purchase is zero', () => {
  const r = run({ startBank: 'hsbc', bank: 'hsbc', broker: 'hsbc', mainlandMethod: 'linked', trade25: true }).selected;
  const entry = r.rows.find(x => x.key === 'entryFx');
  close(entry.cny, 100000 * (1 - 6.70175 / Q.banks.hsbc.quotes.USD.sell));
  assert.equal((entry.cny / 100000 * 100).toFixed(3), '0.451');
  assert.equal(entry.cny.toFixed(2), '450.87');
  close(r.fxImpactCny, 0); ledger(r);
  close(run({}).selected.rows.find(x => x.key === 'entryFx').cny, 0);
});

test('original RMB transfer has no artificial FX fee; CNY/CNH basis moves to the actual conversion', () => {
  const r = run({ startBank: 'boc', route: 'CNH', fxMode: 'bank', broker: 'za', mainlandMethod: 'swift' }).selected;
  close(r.rows.find(x => x.key === 'entryFx').cny, 0);
  close(r.fxImpactCny, 0); ledger(r);
  assert.ok(r.rows.find(x => x.key === 'brokerSpread').cny != null);
});

test('retaining USD in the stock account skips withdrawals, return FX and unused bank management', () => {
  const r = run({ broker: 'ibkr', returnBank: 'hsbc', hsbcBalanceWaiver: false, withdrawalIndex: 10 }).selected;
  assert.ok(!r.rows.some(x => ['withdraw', 'returnInward', 'withdrawMiddle', 'returnWire', 'exitFx'].includes(x.key)));
  assert.ok(!r.rows.find(x => x.key === 'account').items.some(x => x.label.includes('汇丰')));
  ledger(r);
  const bankStock = run({ broker: 'hsbc', returnBank: 'hsbc', hsbcBalanceWaiver: false }).selected;
  const item = bankStock.rows.find(x => x.key === 'account');
  close(item.cny, 1200 * bankStock.refs.HKD);
  assert.equal(item.items.filter(x => x.label.includes('汇丰')).length, 1);
  const oldUnused = run({ exitBank: 'abc', returnBank: 'retired-bank' });
  assert.ok(oldUnused.selected); ledger(oldUnused.selected);
  const used = run({ exitBank: 'abc', outcome: 'mainland' });
  assert.equal(used.errorStage, '04');
  assert.match(used.error, /内地收款银行/);
});

test('published uSMART BOCHK internal funding is free, without incorrectly waiving cross-bank payments', () => {
  const r = run({ broker: 'usmart', depositMethod: 'internal' }).selected;
  for (const key of ['depositBank', 'depositOther', 'depositBroker']) close(r.rows.find(x => x.key === key).cny, 0);
  assert.match(run({ broker: 'usmart', bank: 'sc', depositMethod: 'internal' }).error, /同行入金/);
  const cross = run({ broker: 'usmart', bank: 'sc', depositMethod: 'chats' }).selected;
  close(cross.rows.find(x => x.key === 'depositOther').cny, 15 * cross.refs.HKD);
  close(cross.rows.find(x => x.key === 'depositBank').cny, 22 * cross.refs.USD);
  assert.match(cross.rows.find(x => x.key === 'depositOther').estimate, /企业CHATS标准价/);
});

test('HSBC China standard wire is priced separately from the free linked service; documented inward fees remain zero', () => {
  const ordinary = run({ startBank: 'hsbc', bank: 'bochk', mainlandMethod: 'swift', count: 1 }).selected;
  close(ordinary.rows.find(x => x.key === 'sender').cny, 220);
  close(ordinary.steps.mainlandForeign, (100000 - 220) / ordinary.startSell);
  ledger(ordinary);
  const linked = run({ startBank: 'hsbc', bank: 'hsbc', mainlandMethod: 'linked' }).selected;
  close(linked.rows.find(x => x.key === 'sender').cny, 0);
  for (const exitBank of ['cib', 'hsbc', 'comm']) {
    const back = run({ outcome: 'mainland', returnBank: 'bochk', exitBank, returnMethod: 'swift' }).selected;
    const item = back.rows.find(x => x.key === 'returnOther').items.find(x => x.label.endsWith('USD收款费'));
    close(item.cny, 0);
    assert.ok(!back.missing.includes(item.label));
    assert.ok(back.missing.includes('回内地中转行费'));
    ledger(back);
  }
});

test('Hang Seng China Prestige uses the current ordinary FX-wire tariff and free inward receipt, separately from linked transfers', () => {
  for (const route of ['USD', 'HKD']) {
    const ordinary = run({ startBank: 'hang', bank: 'bochk', route, mainlandMethod: 'swift', fxMode: 'bank', count: 2,
      startSell: route === 'USD' ? 6.75 : .86 }).selected;
    close(ordinary.rows.find(x => x.key === 'sender').cny, 340);
    close(ordinary.steps.mainlandForeign, (100000 - 340) / ordinary.startSell);
    assert.equal(ordinary.rows.find(x => x.key === 'entryMiddle').cny, null);
    ledger(ordinary);
  }
  const linked = run({ startBank: 'hang', bank: 'hang', mainlandMethod: 'linked', count: 4, usedFreeTransfers: 3, startSell: 6.75 }).selected;
  close(linked.rows.find(x => x.key === 'sender').cny, 0);
  close(linked.rows.find(x => x.key === 'entryMiddle').cny, 0);
  assert.match(linked.start.name, /优越理财/);
  const back = run({ outcome: 'mainland', returnBank: 'bochk', exitBank: 'hang', returnMethod: 'swift', exitPrice: 6.7 }).selected;
  close(back.rows.find(x => x.key === 'returnOther').items.find(x => x.label.endsWith('USD收款费')).cny, 0);
  assert.ok(back.missing.includes('回内地中转行费'));
  ledger(back);
});

test('fees, periods, trading offers, stock prices and vouchers reconcile at numeric boundaries', () => {
  const scenarios = [
    { months: 0 }, { months: 1 }, { months: 12, hsbcBalanceWaiver: false }, { trade25: false }, { usedFreeTransfers: 30 },
    { zaLv2: true, usedPromoOrders: 4 }, { trade25: true, otherTurnoverHkd: 250001 }, { profitUsd: 1000 },
    { buyOrders: 12, sellOrders: 12 }, { sharePriceUsd: .5 },
    { useVoucher: true, voucherUsd: 10, voucherOrders: 1, voucherScope: 'platform', voucherExpiry: '2026-12-31' }
  ];
  for (const broker of D.calculator.brokers) for (const changes of scenarios) {
    const r = run({ broker, mainlandMethod: 'cib-go', ...changes }).selected; assert.ok(r); ledger(r);
    assert.ok(r.rows.every(x => x.cny == null || Number.isFinite(x.cny)));
  }
});

test('RMB cross-border tariffs apply their own current waiver and restore amount bands after expiry', () => {
  const tariffs = Object.fromEntries(['hang', 'sc'].map(id => [id, D.mainlandBanks.find(b => b.id === id).cnhTariff]));
  for (const [amount, charged] of [[2000, 2], [2000.01, 5], [5000, 5], [5000.01, 10], [10000, 10], [10000.01, 15], [50000, 15], [100000, 30], [1000000, 50]]) {
    close(M.fee(tariffs.hang, amount, 1, config.date), charged);
  }
  for (const [amount, charged] of [[50000, .6], [50000.01, 5.5], [100000, 5.5], [100000.01, 8], [500000, 8], [500000.01, 10.5], [1000000, 10.5], [2000000, 20], [6000000, 50]]) {
    close(M.fee(tariffs.sc, amount, 1, config.date), 0);
    close(M.fee(tariffs.sc, amount, 1, '2026-12-31'), 0);
    close(M.fee(tariffs.sc, amount, 1, '2027-01-01'), charged);
  }
  for (const startBank of ['hang', 'hsbc', 'sc']) {
    for (const count of [1, 2]) {
      const r = run({ startBank, route: 'CNH', bank: 'bochk', mainlandMethod: 'swift', fxMode: 'bank', count }).selected;
      const sender = r.rows.find(x => x.key === 'sender');
      close(sender.cny, startBank === 'hang' ? count === 1 ? 100000 - 100000 / 1.0003 : 30 : startBank === 'hsbc' ? count * 220 : 0);
      close(sender.items.reduce((s, row) => s + row.cny, 0), sender.cny);
      close(r.steps.mainlandForeign + sender.cny + r.sourceRemainderCny, 100000);
      close(r.rows.find(x => x.key === 'entryFx').cny, 0);
      assert.equal(r.rows.find(x => x.key === 'entryMiddle').cny, null);
      ledger(r);
    }
  }
  const paired = M.calculatorRoute({ ...base, startBank: 'sc', bank: 'sc', route: 'CNH', mainlandMethod: '' });
  assert.equal(paired.mainlandMethod, 'swift');
  assert.match(run({ ...paired, mainlandMethod: 'linked' }).error, /仅支持外币同币种/);
  const linkedHang = run({ startBank: 'hang', bank: 'hang', route: 'CNH', mainlandMethod: 'linked', fxMode: 'bank' }).selected;
  close(linkedHang.rows.find(x => x.key === 'sender').cny, 0);
  close(linkedHang.rows.find(x => x.key === 'entryMiddle').cny, 0);
});

test('amounts between fee bands retain source cash instead of overstating fees or losing money', () => {
  const tariff = D.mainlandBanks.find(b => b.id === 'hang').cnhTariff;
  for (const [budgetCny, principal, charge, remainder] of [[2002, 2000, 2, 0], [2004, 2000, 2, 2], [5006, 5000, 5, 1], [10014, 10000, 10, 4]]) {
    const solved = M.remitPrincipal(budgetCny, tariff, 1, config.date, null);
    close(solved.principal, principal); close(solved.fee, charge); close(solved.remainderCny, remainder);
    const r = run({ budgetCny, count: 1, months: 0, startBank: 'hang', route: 'CNH', bank: 'bochk', mainlandMethod: 'swift', fxMode: 'bank', outcome: 'mainland' }).selected;
    assert.ok(r); close(r.sourceRemainderCny, remainder); close(r.steps.mainlandForeign, principal);
    close(r.rows.find(x => x.key === 'sender').cny, charge);
    close(r.netCny, r.net * r.refs[r.currency] + remainder); ledger(r);
    for (const leg of M.flowLedger(r).legs) close(leg.inputCny + leg.profitCny + leg.fxImpactCny, leg.outputCny + leg.costCny + leg.taxCny);
  }
  // The SC fee drops slightly above one million; a global binary search can
  // miss the larger affordable transfer in the next band.
  const sc = D.mainlandBanks.find(b => b.id === 'sc').cnhTariff;
  const above = M.remitPrincipal(1000010.25, sc, 1, '2027-01-01', null);
  assert.ok(above.principal > 1000000); close(above.principal + above.fee + above.remainderCny, 1000010.25);
  close(above.fee, above.principal * .00001);
});

test('monthly account rates survive zero months for receiving, settlement and return accounts', () => {
  const scenarios = [
    { bank: 'hsbc', broker: 'za' },
    { bank: 'bochk', broker: 'hsbc' },
    { bank: 'bochk', broker: 'za', outcome: 'usd-balance', returnBank: 'hsbc' }
  ];
  for (const selection of scenarios) for (const months of [0, 1, 12]) for (const hsbcBalanceWaiver of [false, true]) {
    const r = run({ ...selection, months, hsbcBalanceWaiver }).selected;
    const account = r.rows.find(row => row.key === 'account'), item = account.items.find(item => item.bankId === 'hsbc');
    close(item.monthlyHkd, hsbcBalanceWaiver ? 0 : 100); close(item.months, months);
    close(item.cny, item.monthlyHkd * months * r.refs.HKD);
    close(account.cny, account.items.reduce((sum, item) => sum + item.cny, 0)); ledger(r);
  }
  const own = run({ bank: 'hsbc', months: 0, monthlyHkd: 27 }).selected;
  close(own.rows.find(row => row.key === 'account').items[0].monthlyHkd, 27);
  const back = run({ outcome: 'usd-balance', returnBank: 'hsbc', months: 0, returnMonthlyHkd: 37 }).selected;
  close(back.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc').monthlyHkd, 37);
  for (const months of [-1, .5, 1.2, '', 'bad', Infinity]) {
    const invalid = run({ months }); assert.equal(invalid.selected, undefined);
    assert.match(invalid.error, /持有月数须为非负整数/);
  }
});

test('mainland premium account fees use CNY, actual charged months and distinct bank-specific waivers', () => {
  for (const [id, monthly] of [['hsbc', 300], ['hang', 180], ['sc', 150]]) {
    const service = D.mainlandBanks.find(bank => bank.id === id).accountService;
    const input = { startBank: id, route: 'CNH', mainlandMethod: 'swift', fxMode: 'bank', months: 12, hsbcBalanceWaiver: true };
    for (const [changes, chargedMonths] of [[{}, 12], [{ [service.freeMonthsField]: 3 }, 9], [{ [service.freeMonthsField]: 24 }, 0], [{ [service.waiverField]: true }, 0], [{ months: 0 }, 0]]) {
      const r = run({ ...input, ...changes }).selected;
      assert.ok(r, id);
      const account = r.rows.find(row => row.key === 'account');
      const item = account.items.find(item => item.region === 'mainland');
      close(item.monthlyCny, monthly); close(item.chargedMonths, chargedMonths); close(item.cny, monthly * chargedMonths);
      close(account.cny, account.items.reduce((sum, item) => sum + item.cny, 0));
      assert.equal(item.monthlyHkd, undefined); assert.equal(item.bankId, id);
      ledger(r);
    }
    for (const value of [-1, .5, 'bad']) assert.match(run({ ...input, [service.freeMonthsField]: value }).error, /剩余免收费月数/);
    const ownCny = run({ ...input, usdCny: 8, usdHkd: 7.5 }).selected.rows.find(row => row.key === 'account').items.find(item => item.region === 'mainland');
    close(ownCny.cny, monthly * 12);
  }
});

test('mainland service fees charge only used accounts once and remain separate from HSBC One', () => {
  const input = { startBank: 'hsbc', bank: 'hsbc', returnBank: 'hsbc', exitBank: 'hsbc', broker: 'hsbc', route: 'USD', mainlandMethod: 'linked',
    returnMethod: 'linked', outcome: 'mainland', months: 12, hsbcBalanceWaiver: false, trade25: true };
  const same = run(input).selected, costs = same.rows.find(row => row.key === 'account');
  assert.equal(costs.items.filter(item => item.region === 'mainland').length, 1);
  close(costs.cny, 3600 + 12 * 100 * same.refs.HKD); ledger(same);
  const hkFree = run({ ...input, hsbcBalanceWaiver: true }).selected;
  close(hkFree.rows.find(row => row.key === 'account').cny, 3600);
  const cnFree = run({ ...input, cnHsbcFeeWaived: true }).selected;
  close(cnFree.rows.find(row => row.key === 'account').cny, 12 * 100 * same.refs.HKD);
  close(cnFree.rows.find(row => row.key === 'brokerAccount').cny, 0);
  const separate = run({ ...input, exitBank: 'hang', returnMethod: 'swift', hsbcBalanceWaiver: true }).selected;
  close(separate.rows.find(row => row.key === 'account').cny, 5760); ledger(separate);
  const unused = run({ ...input, startBank: 'boc', mainlandMethod: 'swift', exitBank: 'hang', outcome: 'broker-balance', hsbcBalanceWaiver: true }).selected;
  assert.ok(!unused.rows.find(row => row.key === 'account').items.some(item => item.region === 'mainland'));
  const missing = run({ ...input, startBank: 'sc', bank: 'bochk', mainlandMethod: 'swift', outcome: 'broker-balance' }).partial;
  close(missing.rows.find(row => row.key === 'account').items.find(item => item.region === 'mainland').cny, 1800);
  const insufficient = run({ budgetCny: 2004, count: 1, startBank: 'hang', route: 'CNH', fxMode: 'bank', months: 12 });
  assert.match(insufficient.error, /不足以支付账户期间费/);
  close(insufficient.partial.rows.find(row => row.key === 'account').cny, 2160);
  close(insufficient.partial.sourceRemainderCny, 2);
  assert.ok(insufficient.partial.steps.proceedsUsd > 0);
  assert.equal(insufficient.partial.rows.filter(row => row.key === 'account').length, 1);
  assert.ok(run({ cnScFreeMonths: -1, outcome: 'broker-balance' }).selected);
  assert.ok(run({ startBank: 'sc', route: 'CNH', fxMode: 'bank', cnScFeeWaived: true, cnScFreeMonths: -1 }).selected);
});

test('stale quotes keep tariff data but cannot claim a complete quote; missing quote preserves selection', () => {
  const stale = structuredClone(Q); stale.banks.cib.quotes.USD.asOf = '2020-01-01';
  const r = M.calculatorJourney(base, D, stale);
  assert.ok(r.selected.rows.length); assert.equal(r.selected.complete, false); assert.match(r.selected.missing.join(), /超过3天/);
  const missing = structuredClone(Q); delete missing.banks.cib;
  const absent = M.calculatorJourney(base, D, missing);
  assert.equal(absent.selection.start.id, 'cib'); assert.match(absent.error, /现汇卖出价/);
  assert.equal(M.calculatorIssue(base, D), '');
});

test('HKD full-amount cap requires current same-bank USD valuation without a borrowed quote', () => {
  for (const mutate of [q => { delete q.banks.cib.quotes.USD; }, q => { q.banks.cib.quotes.USD.asOf = '2020-01-01'; }]) {
    const q = structuredClone(Q); mutate(q);
    const r = M.calculatorJourney({ ...base, mainlandMethod: 'cib-go', route: 'HKD', fxMode: 'bank' }, D, q);
    assert.equal(r.selected, undefined); assert.match(r.error, /兴业USD牌价/); assert.doesNotMatch(r.error, /NaN/);
  }
});

test('IBKR local USD receiving instructions price the observed route, while overseas wires and withdrawals retain their separate fees', () => {
  const local = run({ startBank: 'boc', bank: 'bochk', broker: 'ibkr', mainlandMethod: 'boc-mobile', depositMethod: 'chats' }).selected;
  for (const key of ['depositBank', 'depositBroker', 'depositOther']) close(local.rows.find(x => x.key === key).cny, 0);
  assert.match(local.rows.find(x => x.key === 'depositOther').estimate, /香港花旗／渣打/);
  assert.equal(local.complete, true); ledger(local);
  const international = run({ broker: 'ibkr', depositMethod: 'swift' }).selected;
  assert.equal(international.rows.find(x => x.key === 'depositOther').cny, null);
  const sc = run({ broker: 'ibkr', bank: 'sc', depositMethod: 'chats' }).selected;
  close(sc.rows.find(x => x.key === 'depositBank').cny, 22 * sc.refs.USD);
  const withdrawn = run({ broker: 'ibkr', depositMethod: 'chats', outcome: 'usd-balance', withdrawalIndex: 3 }).selected;
  close(withdrawn.rows.find(x => x.key === 'withdraw').cny, 10 * withdrawn.refs.USD);
  assert.equal(withdrawn.rows.find(x => x.key === 'withdrawMiddle').cny, null);
  const custom = run({ broker: 'ibkr', depositMethod: 'chats', depositOtherCny: '15' }).selected;
  close(custom.rows.find(x => x.key === 'depositOther').cny, 15);
  assert.equal(custom.rows.find(x => x.key === 'depositOther').estimate, undefined);
});

test('recommendations compare distinct upstream routes while retaining the chosen stock venue and eligibility', () => {
  const input = { ...base, date: '2026-10-11', count: 1, hsbcBalanceWaiver: false, trade25: false, outcome: 'broker-balance' };
  const snapshot = structuredClone(input), recommendations = M.calculatorRecommendations(input, D, diversityQuotes);
  assert.deepEqual(input, snapshot);
  assert.equal(recommendations.plans.length, 5);
  assert.equal(new Set(recommendations.plans.map(p => p.config.startBank)).size, 5);
  assert.deepEqual(new Set(recommendations.plans.map(p => p.config.broker)), new Set(['za']));
  for (const [index, p] of recommendations.plans.entries()) {
    assert.equal(p.result.complete, true); assert.equal(p.result.quotedCore, true);
    assert.ok(p.result.rows.every(x => Number.isFinite(x.cny))); ledger(p.result);
    if (index) assert.ok(p.result.costCny >= recommendations.plans[index - 1].result.costCny);
    assert.notEqual(p.config.mainlandMethod, 'cib-go'); // one 100k-CNY payment exceeds its USD cap
    const applied = M.calculatorJourney({ ...input, ...p.config }, D, diversityQuotes).selected;
    close(applied.costCny, p.result.costCny);
    if (p.config.broker === 'hsbc') assert.ok(p.result.rows.find(x => x.key === 'account').cny > 0);
  }
  const sameProfile = M.calculatorRecommendations({ ...input, startBank: 'cmb', plan: 'custom', activeStep: '03' }, D, diversityQuotes);
  assert.equal(sameProfile, recommendations);
  for (const broker of D.calculator.brokers) {
    const changed = M.calculatorRecommendations({ ...input, broker }, D, diversityQuotes);
    assert.ok(changed.plans.length >= 2, broker);
    assert.ok(changed.plans.every(p => p.config.broker === broker));
    assert.equal(new Set(changed.plans.map(p => p.config.startBank)).size, changed.plans.length);
  }
  const two = M.calculatorRecommendations({ ...input, broker: 'hsbc', count: 2, hsbcBalanceWaiver: true, trade25: true }, D, diversityQuotes);
  assert.equal(two.plans[0].config.startBank, 'cib'); assert.equal(two.plans[0].config.mainlandMethod, 'swift');
  assert.equal(two.plans[0].config.broker, 'hsbc');
  close(two.plans[0].result.rows.find(x => x.key === 'sender').cny, 0);
  close(two.plans[0].result.rows.find(x => x.key === 'account').cny, 0);
  assert.match(two.plans[0].result.rows.find(x => x.key === 'entryMiddle').estimate, /2026年美元直达/);
  const noReports = structuredClone(D); noReports.entryTransferReferences = [];
  const publicOnly = M.calculatorRecommendations({ ...input, count: 2, broker: 'hsbc', hsbcBalanceWaiver: true, trade25: true }, noReports, diversityQuotes);
  assert.ok(publicOnly.plans.length > 0);
  assert.ok(publicOnly.plans.every(p => p.config.mainlandMethod !== 'cib-go'));
});

test('a current CCB full-amount quote contributes a distinct source route for each selected stock venue and each card reproduces its price', () => {
  const quotes = structuredClone(diversityQuotes);
  const evidence = require('./fixtures/money-flow-full-amount-20261011.json');
  quotes.banks.ccb = { quotes: { USD: evidence.ccb.regressionQuote } };
  for (const broker of D.calculator.brokers) {
    const input = { ...base, date: '2026-10-11', broker, count: 1, months: 12, hsbcBalanceWaiver: false, trade25: false };
    const plans = M.calculatorRecommendations(input, D, quotes).plans;
    assert.equal(plans.length, 5);
    assert.equal(new Set(plans.map(p => p.config.startBank)).size, 5);
    const ccb = plans.find(p => p.config.startBank === 'ccb');
    assert.ok(ccb, broker);
    assert.equal(ccb.config.mainlandMethod, 'full');
    assert.equal(ccb.config.broker, broker);
    close(ccb.result.rows.find(row => row.key === 'entryInward').cny, 0);
    for (const p of plans) {
      const r = M.calculatorJourney({ ...input, ...p.config }, D, quotes).selected;
      close(r.costCny, p.result.costCny); ledger(r);
      assert.equal(r.broker.id, broker); assert.equal(input.count, 1);
    }
  }
});

test('SWIFT Go tariffs never prove all receiving banks are reachable or qualify a preferred route', () => {
  assert.deepEqual(D.calculator.hkBanks, swiftGoAvailability.reviewedHkBanks);
  assert.deepEqual(D.entryServiceRoutes, swiftGoAvailability.verifiedCatalogueReceivingRoutes);
  assert.equal(D.sources.cibGo.url, swiftGoAvailability.tariffSource);
  assert.equal(D.sources.swiftGoBanks.url, swiftGoAvailability.participantSource);
  for (const bank of D.calculator.hkBanks) for (const route of ['USD', 'HKD']) {
    const input = { ...base, bank, route, fxMode: 'bank', count: 2, mainlandMethod: 'cib-go' };
    const r = M.calculatorJourney(input, D, diversityQuotes).selected;
    assert.ok(r, bank + '/' + route);
    assert.equal(r.serviceAvailability.verified, false);
    assert.match(r.serviceAvailability.evidence, new RegExp(route + '的SWIFT Go开通记录'));
    assert.deepEqual(r.serviceAvailability.sources, ['cibGo', 'swiftGoBanks']);
    assert.equal(r.quotedCore, false); assert.equal(r.rankable, false);
    const sender = r.rows.find(item => item.key === 'sender');
    assert.match(sender.estimate, /开通记录/);
    assert.equal(sender.items.find(item => item.label === '汇出手续费').estimate, false);
    assert.match(sender.items.find(item => item.label.startsWith('SWIFT GO')).estimate, /服务资费/);
    close(sender.cny, 100); ledger(r);
    assert.ok(!M.calculatorChannels(input, D).mainlandMethods.includes('cib-go'));
  }
  const input = { ...base, date: '2026-10-11', broker: 'hsbc', hsbcBalanceWaiver: true, trade25: true, count: 2 };
  const publicOnly = structuredClone(D); publicOnly.entryTransferReferences = [];
  assert.ok(M.calculatorRecommendations(input, publicOnly, diversityQuotes).plans.every(p => p.config.mainlandMethod !== 'cib-go'));
  const evidenced = structuredClone(publicOnly);
  // Synthetic reachability is scoped to one currency and validity interval;
  // it is never shipped as a real bank record.
  evidenced.entryServiceRoutes = [{ startBank: 'cib', bank: 'hsbc', method: 'cib-go', currencies: ['USD'],
    validFrom: '2026-10-11', validUntil: '2026-10-11', sources: ['test-only-reachability'] }];
  assert.ok(M.calculatorChannels({ ...input, bank: 'hsbc', route: 'USD' }, evidenced).mainlandMethods.includes('cib-go'));
  const exact = M.calculatorRecommendations(input, evidenced, diversityQuotes).plans.find(p => p.config.startBank === 'cib');
  assert.equal(exact.config.mainlandMethod, 'cib-go'); assert.equal(exact.config.route, 'USD');
  assert.equal(exact.result.serviceAvailability.verified, true);
  for (const changes of [{ bank: 'bochk' }, { route: 'HKD', fxMode: 'bank' }, { date: '2026-10-10' }, { date: '2026-10-12' }]) {
    const r = M.calculatorJourney({ ...input, bank: 'hsbc', mainlandMethod: 'cib-go', ...changes }, evidenced, diversityQuotes).selected;
    assert.equal(r.serviceAvailability.verified, false); assert.equal(r.quotedCore, false);
    assert.ok(!M.calculatorChannels({ ...input, bank: 'hsbc', route: 'USD', ...changes }, evidenced).mainlandMethods.includes('cib-go'));
  }
});

test('unpriced transfer subtotals and private quote overrides cannot become recommended minima', () => {
  const input = { ...base, count: 1, hsbcBalanceWaiver: false, trade25: false };
  const plain = M.calculatorRecommendations(input, D, Q);
  const overridden = M.calculatorRecommendations({ ...input, startSell: .1, senderFeeCny: 0, entryMiddleCny: 0, depositOtherCny: 0,
    tradeFeeUsd: 0, balanceHkd: 1000000, useVoucher: true, voucherUsd: 999999 }, D, Q);
  assert.deepEqual(overridden.plans.map(x => [x.id, x.result.costCny]), plain.plans.map(x => [x.id, x.result.costCny]));
  assert.ok(plain.plans.every(p => p.config.startBank !== 'comm' && p.result.complete && p.result.rows.every(row => Number.isFinite(row.cny))));
  const stale = structuredClone(Q);
  for (const bank of Object.values(stale.banks)) for (const quote of Object.values(bank.quotes)) quote.asOf = '2020-01-01';
  assert.deepEqual(M.calculatorRecommendations(input, D, stale).plans, []);
  const returns = M.calculatorRecommendations({ ...input, outcome: 'mainland' }, D, Q);
  assert.ok(returns.plans.length > 0);
  assert.ok(returns.plans.every(p => p.config.broker !== 'ibkr' && p.result.complete)); // USD withdrawal correspondent fee is still unpriced
});

test('upstream recommendations retain the selected stock account voucher and its actual trade dates', () => {
  for (const broker of D.calculator.brokers) {
    const input = { ...base, date: '2026-10-11', count: 1, months: 1, broker, trade25: false, outcome: 'broker-balance',
      useVoucher: true, voucherUsd: 5, voucherOrders: 2, voucherScope: 'both', voucherExpiry: '2026-12-31' };
    const before = structuredClone(input), ordinary = M.calculatorRecommendations({ ...input, useVoucher: false }, D, diversityQuotes);
    const discounted = M.calculatorRecommendations(input, D, diversityQuotes);
    assert.deepEqual(input, before); assert.equal(discounted.plans.length, ordinary.plans.length);
    for (const plan of discounted.plans) {
      assert.equal(plan.config.broker, broker); assert.ok(plan.result.trading.discountUsd > 0, broker);
      const applied = M.calculatorJourney({ ...input, ...plan.config }, D, diversityQuotes).selected;
      close(applied.costCny, plan.result.costCny); close(applied.trading.discountUsd, plan.result.trading.discountUsd); ledger(applied);
      const full = M.calculatorJourney({ ...input, ...plan.config, useVoucher: false }, D, diversityQuotes).selected;
      assert.ok(applied.costCny < full.costCny);
      for (const key of ['sender', 'entryMiddle', 'entryInward', 'depositBank', 'depositOther', 'depositBroker', 'account'])
        close(applied.rows.find(row => row.key === key).cny, full.rows.find(row => row.key === key).cny);
    }
    const expiredInput = { ...input, voucherExpiry: '2026-10-10' };
    const expired = M.calculatorRecommendations(expiredInput, D, diversityQuotes);
    for (const plan of expired.plans) {
      close(plan.result.trading.discountUsd, 0);
      const full = M.calculatorJourney({ ...expiredInput, ...plan.config, useVoucher: false }, D, diversityQuotes).selected;
      close(plan.result.costCny, full.costCny);
    }
    const expiresBeforeSale = M.calculatorRecommendations({ ...input, months: 12 }, D, diversityQuotes);
    for (const plan of expiresBeforeSale.plans) {
      assert.ok(plan.result.trading.orders.filter(order => order.kind === 'buy').some(order => order.discount > 0));
      assert.ok(plan.result.trading.orders.filter(order => order.kind === 'sell').every(order => order.discount === 0));
    }
  }
});

test('upstream comparison retains real bank asset qualification without transferring it to another bank', () => {
  for (const broker of D.calculator.brokers) {
    const input = { ...base, date: '2026-10-11', broker, bank: 'hsbc', returnBank: 'bochk', months: 12, count: 1,
      balanceHkd: 10000, returnBalanceHkd: 0, hsbcBalanceWaiver: false, outcome: 'broker-balance' };
    const plans = M.calculatorRecommendations(input, D, diversityQuotes).plans;
    assert.ok(plans.length >= 2, broker);
    for (const plan of plans) {
      const item = plan.result.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc');
      if (item) close(item.cny, 0);
      assert.equal(plan.result.broker.id, broker);
    }
    const below = M.calculatorRecommendations({ ...input, balanceHkd: 9999.99 }, D, diversityQuotes).plans;
    const cib = below.find(plan => plan.config.startBank === 'cib');
    const charged = cib.result.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc');
    close(charged.cny, 100 * 12 * cib.result.refs.HKD);
  }
  const returning = { ...base, date: '2026-10-11', broker: 'za', bank: 'bochk', returnBank: 'hsbc', months: 12,
    balanceHkd: 0, returnBalanceHkd: 10000, hsbcBalanceWaiver: false, outcome: 'usd-balance' };
  const plans = M.calculatorRecommendations(returning, D, diversityQuotes).plans;
  assert.ok(plans.length >= 2);
  for (const plan of plans) {
    const hsbc = plan.result.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc');
    if (hsbc) close(hsbc.cny, 0);
  }
  for (const balanceHkd of [0, '']) {
    const input = { ...returning, outcome: 'broker-balance', bank: 'hsbc', count: 1,
      bankBalancesHkd: { hsbc: 10000 }, balanceHkd };
    const cib = M.calculatorRecommendations(input, D, diversityQuotes).plans.find(plan => plan.config.startBank === 'cib');
    const hsbc = cib.result.rows.find(row => row.key === 'account').items.find(item => item.bankId === 'hsbc');
    close(hsbc.cny, 100 * 12 * cib.result.refs.HKD);
  }
});

test('each upstream recommendation matches an independent exhaustive comparison for the selected stock venue', () => {
  const data = structuredClone(D);
  data.calculator.mainland = ['boc', 'cib', 'hsbc']; data.calculator.hkBanks = ['bochk', 'hsbc'];
  const input = { ...base, count: 2, trade25: true, hsbcBalanceWaiver: true, outcome: 'broker-balance' }, minimum = new Map();
  const broker = input.broker;
  for (const startBank of data.calculator.mainland) for (const bank of data.calculator.hkBanks)
    for (const route of ['USD', 'HKD', 'CNH']) for (const mainlandMethod of ['swift', 'boc-mobile', 'linked', 'cib-go', 'full'])
      for (const fxMode of ['manual', 'auto', 'bank']) for (const depositMethod of ['internal', 'chats', 'fps', 'edda', 'swift']) {
        const r = M.calculatorJourney({ ...input, startBank, bank, broker, route, mainlandMethod, fxMode, depositMethod }, data, Q).selected;
        if (r?.complete && r.quotedCore && (!minimum.has(startBank) || r.costCny < minimum.get(startBank))) minimum.set(startBank, r.costCny);
      }
  const choices = M.calculatorRecommendations(input, data, Q).plans;
  assert.equal(choices.length, minimum.size);
  for (const p of choices) close(p.result.costCny, minimum.get(p.config.startBank));
});

test('CIB USD/HKD direct-to-HSBC references keep their actual scope and counterexamples', () => {
  const input = { ...base, date: '2026-10-11', count: 1, startBank: 'cib', bank: 'hsbc', mainlandMethod: 'swift', fxMode: 'bank' };
  const hkd = M.calculatorJourney({ ...input, route: 'HKD' }, D, diversityQuotes).selected;
  const middle = hkd.rows.find(x => x.key === 'entryMiddle');
  close(middle.cny, 0); assert.match(middle.estimate, /港币直达汇丰香港/); assert.ok(middle.sources.includes('cibRouteCounterexample'));
  assert.equal(hkd.complete, true); ledger(hkd);
  const usd = M.calculatorJourney({ ...input, route: 'USD' }, D, diversityQuotes).selected;
  close(usd.rows.find(x => x.key === 'entryMiddle').cny, 0);
  assert.match(usd.rows.find(x => x.key === 'entryMiddle').estimate, /2026年美元直达/);
  assert.ok(usd.rows.find(x => x.key === 'entryMiddle').sources.includes('cibUsdCase'));
  assert.equal(usd.complete, true); ledger(usd);
  assert.equal(M.calculatorJourney({ ...input, route: 'USD', budgetCny: 1000 }, D, diversityQuotes).selected.rows.find(x => x.key === 'entryMiddle').cny, null);
  assert.equal(M.calculatorJourney({ ...input, route: 'CNH' }, D, diversityQuotes).selected.rows.find(x => x.key === 'entryMiddle').cny, null);
  for (const bank of ['bochk', 'za', 'hang', 'sc']) for (const route of ['USD', 'HKD']) assert.equal(M.calculatorJourney({ ...input, bank, route }, D, diversityQuotes).selected.rows.find(x => x.key === 'entryMiddle').cny, null);
  const own = M.calculatorJourney({ ...input, route: 'HKD', entryMiddleCny: 25, count: 2 }, D, diversityQuotes).selected.rows.find(x => x.key === 'entryMiddle');
  close(own.cny, 50); assert.equal(own.estimate, undefined);
  const go = M.calculatorJourney({ ...input, route: 'HKD', mainlandMethod: 'cib-go', count: 2 }, D, diversityQuotes).selected;
  close(go.rows.find(x => x.key === 'sender').cny, 100); assert.equal(go.rows.find(x => x.key === 'entryMiddle').estimate, undefined);
});

test('CIB small-USD receipt evidence corrects the reference scope without asserting a universal bank minimum', () => {
  assert.equal(D.sources.cibSmallUsdCase.url, cibSmallUsd.source);
  const input = { ...base, date: '2026-10-11', bank: 'hsbc', broker: 'za', count: 1, months: 0, mainlandMethod: 'swift' };
  const quote = M.calculatorJourney(input, D, diversityQuotes).selected.startSell;
  for (const [usd, reported] of [[200, false], [200.99, false], [201, true], [250, true], [299, true], [300, true]]) {
    const s = { ...input, budgetCny: quote * usd }, r = M.calculatorJourney(s, D, diversityQuotes).selected;
    close(r.steps.hongKong, usd); ledger(r);
    const middle = r.rows.find(item => item.key === 'entryMiddle');
    assert.equal(middle.cny, reported ? cibSmallUsd.principalDeductionUsd : null);
    if (reported) {
      assert.ok(middle.sources.includes('cibSmallUsdCase'));
      assert.match(middle.estimate, /最小已录金额201 USD/);
      assert.equal(r.complete, true); assert.ok(r.rows.some(item => item.estimate));
      const p = M.calculatorRecommendations(s, D, diversityQuotes).plans.find(p => p.config.startBank === 'cib');
      assert.ok(p); assert.equal(p.config.mainlandMethod, 'swift'); assert.equal(p.config.bank, 'hsbc');
      close(p.result.costCny, r.costCny);
    } else assert.equal(r.complete, false);
    for (const bank of D.calculator.hkBanks.filter(id => id !== 'hsbc')) {
      const other = M.calculatorJourney({ ...s, bank }, D, diversityQuotes).selected;
      assert.equal(other.rows.find(item => item.key === 'entryMiddle').cny, null);
    }
    const standard = M.calculatorJourney({ ...s, usedFreeTransfers: 30 }, D, diversityQuotes).selected;
    assert.ok(standard.rows.find(item => item.key === 'sender').cny > 0);
    ledger(standard);
  }
  for (const [usd, reported] of [[400, false], [402, true]]) {
    const r = M.calculatorJourney({ ...input, count: 2, budgetCny: quote * usd }, D, diversityQuotes).selected;
    assert.equal(r.rows.find(item => item.key === 'entryMiddle').cny, reported ? 0 : null);
    close(r.steps.hongKong, usd); ledger(r);
  }
  assert.equal(cibSmallUsd.level, 'reported');
});

test('a bank that rejects cheques is an unsupported Chief withdrawal route, not an unknown cheque fee', () => {
  const result = run({ broker: 'chief', depositMethod: 'internal', returnBank: 'za', outcome: 'usd-balance', inwardHkd: 0 });
  assert.equal(result.selected, undefined); assert.match(result.error, /不接受支票存款/);
  assert.equal(result.partial.errorAction, 'withdraw'); assert.equal(result.partial.errorStage, '04');
  assert.ok(Number.isFinite(result.partial.steps.proceedsUsd)); assert.equal(result.partial.steps.returnUsd, undefined);
  assert.ok(result.partial.trading.orders.length > 0);
  assert.ok(!result.partial.rows.some(x => x.key === 'returnInward'));
});
