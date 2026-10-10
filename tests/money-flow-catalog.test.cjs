const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const { audit: auditCurrent, config: currentConfig } = require('../scripts/audit_money_flow.cjs');
const Q = require('./fixtures/money-flow-quotes-20261009.json');
const config = { ...currentConfig, date: '2026-10-10' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const base = M.calculatorRoute({ ...config, startBank: 'cib', bank: 'bochk', broker: 'za', returnBank: 'bochk', exitBank: 'hsbc', route: 'USD', outcome: 'broker-balance' });
const run = changes => M.calculatorJourney({ ...base, ...changes }, D, Q);
const ledger = r => {
  assert.ok(Number.isFinite(r.net));
  close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  close(r.rows.reduce((sum, x) => sum + (x.cny || 0), 0), r.costCny);
};

test('all 151875 catalogue combinations retain selection and either reconcile or name the exact local issue', () => {
  const r = auditCurrent({ quotes: Q, date: config.date });
  assert.equal(r.combinationsChecked, 151875);
  assert.equal(r.completeQuoteCombinations + r.partialQuoteCombinations + r.inputOrRouteIssues, r.combinationsChecked);
  assert.equal(r.ledgerChecks, r.completeQuoteCombinations + r.partialQuoteCombinations);
  assert.ok(r.completeQuoteCombinations > 0); assert.ok(r.partialQuoteCombinations > 0);
  assert.ok(r.routes.every(r => !r.key.includes('abc')));
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

test('source accounts, Hong Kong banks, stock venues and every currency have independent catalogues', () => {
  assert.deepEqual(D.calculator.mainland, ['boc', 'cib', 'cmb', 'icbc', 'ccb', 'comm', 'hsbc', 'hang', 'sc']);
  for (const startBank of D.calculator.mainland) for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const route of D.calculator.currencies) {
    assert.equal(M.calculatorIssue({ ...base, startBank, bank, broker, route }, D), '');
  }
  assert.match(M.calculatorIssue({ ...base, startBank: 'abc' }, D), /农业银行/);
});

test('ICBC optional USD full-amount service adds 25 USD per transfer without waiving normal sender or receiving tariffs', () => {
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
    close(r.rows.find(x => x.key === 'entryInward').cny, receiving === 'bochk' ? count * 60 * r.refs.HKD : 0);
    ledger(r);
  }
  for (const route of ['CNH', 'HKD']) assert.match(run({ startBank: 'icbc', route, fxMode: 'bank', mainlandMethod: 'full' }).error, /USD全额到账/);
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
  assert.equal(run({ broker: 'usmart', bank: 'sc', depositMethod: 'chats' }).selected.rows.find(x => x.key === 'depositOther').cny, null);
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
    const r = run({ budgetCny, count: 1, startBank: 'hang', route: 'CNH', bank: 'bochk', mainlandMethod: 'swift', fxMode: 'bank', outcome: 'mainland' }).selected;
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

test('recommendations compare complete routes for all stock venues under the same budget and eligibility', () => {
  const input = { ...base, count: 1, hsbcBalanceWaiver: false, trade25: false, outcome: 'broker-balance' };
  const snapshot = structuredClone(input), recommendations = M.calculatorRecommendations(input, D, Q);
  assert.deepEqual(input, snapshot);
  assert.equal(new Set(recommendations.plans.map(p => p.config.broker)).size, 5);
  for (const [index, p] of recommendations.plans.entries()) {
    assert.equal(p.result.complete, true); assert.equal(p.result.quotedCore, true);
    assert.ok(p.result.rows.every(x => Number.isFinite(x.cny))); ledger(p.result);
    if (index) assert.ok(p.result.costCny >= recommendations.plans[index - 1].result.costCny);
    assert.notEqual(p.config.mainlandMethod, 'cib-go'); // one 100k-CNY payment exceeds its USD cap
    const applied = M.calculatorJourney({ ...input, ...p.config }, D, Q).selected;
    close(applied.costCny, p.result.costCny);
    if (p.config.broker === 'hsbc') assert.ok(p.result.rows.find(x => x.key === 'account').cny > 0);
  }
  const sameProfile = M.calculatorRecommendations({ ...input, startBank: 'cmb', broker: 'chief', plan: 'custom', activeStep: '03' }, D, Q);
  assert.equal(sameProfile, recommendations);
  const two = M.calculatorRecommendations({ ...input, count: 2, hsbcBalanceWaiver: true, trade25: true }, D, Q);
  assert.equal(two.plans[0].config.startBank, 'cib'); assert.equal(two.plans[0].config.mainlandMethod, 'cib-go');
  assert.equal(two.plans[0].config.broker, 'hsbc');
  close(two.plans[0].result.rows.find(x => x.key === 'sender').cny, 100);
  close(two.plans[0].result.rows.find(x => x.key === 'account').cny, 0);
});

test('unpriced transfer subtotals and private quote overrides cannot become recommended minima', () => {
  const input = { ...base, count: 1, hsbcBalanceWaiver: false, trade25: false };
  const plain = M.calculatorRecommendations(input, D, Q);
  const overridden = M.calculatorRecommendations({ ...input, startSell: .1, senderFeeCny: 0, entryMiddleCny: 0, depositOtherCny: 0,
    tradeFeeUsd: 0, balanceHkd: 1000000, useVoucher: true, voucherUsd: 999999 }, D, Q);
  assert.deepEqual(overridden.plans.map(x => [x.id, x.result.costCny]), plain.plans.map(x => [x.id, x.result.costCny]));
  assert.ok(plain.plans.every(p => p.config.startBank !== 'comm' && p.config.mainlandMethod !== 'swift'));
  const stale = structuredClone(Q);
  for (const bank of Object.values(stale.banks)) for (const quote of Object.values(bank.quotes)) quote.asOf = '2020-01-01';
  assert.deepEqual(M.calculatorRecommendations(input, D, stale).plans, []);
  const returns = M.calculatorRecommendations({ ...input, outcome: 'mainland' }, D, Q);
  assert.ok(returns.plans.length > 0);
  assert.ok(returns.plans.every(p => p.config.broker !== 'ibkr' && p.result.complete)); // USD withdrawal correspondent fee is still unpriced
});

test('each stock-venue recommendation matches an independent exhaustive route comparison', () => {
  const data = structuredClone(D);
  data.calculator.mainland = ['boc', 'cib', 'hsbc']; data.calculator.hkBanks = ['bochk', 'hsbc'];
  const input = { ...base, count: 2, trade25: true, hsbcBalanceWaiver: true, outcome: 'broker-balance' }, minimum = new Map();
  for (const startBank of data.calculator.mainland) for (const bank of data.calculator.hkBanks) for (const broker of data.calculator.brokers)
    for (const route of ['USD', 'HKD', 'CNH']) for (const mainlandMethod of ['swift', 'boc-mobile', 'linked', 'cib-go', 'full'])
      for (const fxMode of ['manual', 'auto', 'bank']) for (const depositMethod of ['internal', 'chats', 'fps', 'edda', 'swift']) {
        const r = M.calculatorJourney({ ...input, startBank, bank, broker, route, mainlandMethod, fxMode, depositMethod }, data, Q).selected;
        if (r?.complete && r.quotedCore && (!minimum.has(broker) || r.costCny < minimum.get(broker))) minimum.set(broker, r.costCny);
      }
  const choices = M.calculatorRecommendations(input, data, Q).plans;
  assert.equal(choices.length, minimum.size);
  for (const p of choices) close(p.result.costCny, minimum.get(p.config.broker));
});

test('a bank that rejects cheques is an unsupported Chief withdrawal route, not an unknown cheque fee', () => {
  const result = run({ broker: 'chief', depositMethod: 'internal', returnBank: 'za', outcome: 'usd-balance', inwardHkd: 0 });
  assert.equal(result.selected, undefined); assert.match(result.error, /不接受支票存款/);
  assert.equal(result.partial.errorAction, 'withdraw'); assert.equal(result.partial.errorStage, '04');
  assert.ok(Number.isFinite(result.partial.steps.proceedsUsd)); assert.equal(result.partial.steps.returnUsd, undefined);
  assert.ok(result.partial.trading.orders.length > 0);
  assert.ok(!result.partial.rows.some(x => x.key === 'returnInward'));
});
