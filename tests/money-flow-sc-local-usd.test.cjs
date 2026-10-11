const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const E = require('./fixtures/money-flow-sc-local-usd-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const bank = D.hkBanks.find(row => row.id === 'sc');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const base = { ...config, date: '2026-10-11', count: 1, months: 1, startBank: 'boc', bank: 'sc', broker: 'chief',
  returnBank: 'sc', exitBank: 'boc', route: 'USD', outcome: 'broker-balance', mainlandMethod: '',
  depositMethod: 'chats', fxMode: 'bank', returnMethod: 'swift', startSell: 7, entryPrice: 7.8 };
const run = input => {
  const result = M.calculatorJourney(M.calculatorRoute({ ...base, ...input }), D, Q);
  const r = result.selected || result.partial;
  assert.ok(r, result.error);
  return r;
};

test('SC personal USD local tariff cannot fall back to its overseas 50 HKD tariff', () => {
  assert.equal(D.sources.scHk.url, E.source);
  assert.deepEqual(bank.localSwiftExcluded, E.excludedLocalSwiftCurrencies);
  close(bank.localUsdNative, E.localUsdChatsUsd);
  const refs = { CNY: 1, USD: 7, HKD: 7 / 7.8, CNH: 7 / 7.1 };
  const local = M.swiftFee(bank, base.date, {}, 1, 'hong-kong');
  assert.equal(local.hkd, null); assert.match(local.status, /本地USD.*CHATS/);
  assert.equal(M.depositFee(bank, 'swift', 'USD', refs, base.date, { destination: 'hong-kong' }), null);
  close(M.swiftFee(bank, base.date).hkd, 50);
  close(M.depositFee(bank, 'chats', 'USD', refs, base.date), 22 * refs.USD);
  close(M.depositFee(bank, 'swift', 'USD', refs, base.date), 50 * refs.HKD);
  close(M.returnFee(bank, D.mainlandBanks[0], 'swift', refs, base.date), 50 * refs.HKD);
});

test('all banks and stock accounts stay selectable; only the unsupported SC local USD channel is excluded', () => {
  let checked = 0;
  for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const route of D.calculator.currencies) {
    const s = M.calculatorRoute({ ...base, bank, broker, route, depositMethod: '', fxMode: 'bank' });
    const channels = M.calculatorChannels(s, D);
    assert.equal(M.calculatorIssue(s, D), '');
    assert.ok(channels.depositMethods.includes('chats') || channels.depositMethods.includes('internal'));
    if (broker === 'chief' || broker === 'usmart') assert.equal(channels.depositMethods.includes('swift'), bank !== 'sc');
    if (broker === 'ibkr') assert.ok(channels.depositMethods.includes('swift'));
    checked++;
  }
  assert.equal(checked, 90);
  for (const broker of ['chief', 'usmart', 'ibkr']) {
    const r = run({ broker });
    close(r.rows.find(row => row.key === 'depositBank').cny, 22 * r.refs.USD);
    close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  }
});

test('an explicitly unsupported local channel retains completed bank steps rather than fabricating an overseas fee', () => {
  let checked = 0;
  for (const startBank of D.calculator.mainland) for (const broker of ['chief', 'usmart'])
    for (const route of D.calculator.currencies) for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
      const r = run({ startBank, broker, route, outcome, depositMethod: 'swift' });
      assert.match(r.error, /本地USD.*CHATS/);
      assert.equal(r.errorStage, '03');
      assert.ok(r.steps.hongKong > 0);
      assert.ok(r.rows.find(row => row.key === 'sender'));
      assert.equal(r.rows.find(row => row.key === 'depositBank'), undefined);
      checked++;
    }
  assert.equal(checked, 270);
});
