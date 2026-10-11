const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const E = require('./fixtures/money-flow-hang-local-swift-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const hang = D.hkBanks.find(bank => bank.id === E.bank);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const base = { ...config, date: '2026-10-11', count: 1, months: 1, startBank: 'boc', bank: 'hang',
  broker: 'chief', returnBank: 'hang', exitBank: 'boc', route: 'USD', outcome: 'broker-balance',
  mainlandMethod: '', depositMethod: 'swift', returnMethod: 'swift', pricingBasis: 'best-quote', startSell: 7 };
const run = input => {
  const result = M.calculatorJourney(M.calculatorRoute({ ...base, ...input }), D, Q);
  const r = result.selected || result.partial;
  assert.ok(r, result.error);
  return r;
};
const row = (r, key) => r.rows.find(item => item.key === key);

test('Hang Seng local USD SWIFT has its own verified mobile tariff and retains the overseas tariff', () => {
  assert.equal(D.sources.hangHk.url, E.source);
  assert.equal(hang.localSwiftHkd, E.localSwiftHkd);
  assert.equal(hang.localSwiftChannel, E.channel);
  const refs = { CNY: 1, USD: 7, HKD: 7 / 7.8, CNH: 7 / 7.1 };
  for (const date of ['2026-10-11', '2026-11-01']) {
    const local = M.swiftFee(hang, date, {}, 1, 'hong-kong');
    close(local.hkd, 0); assert.equal(local.channel, E.channel);
    close(M.swiftFee(hang, date).hkd, E.overseasOnlineSwiftHkd);
    close(M.depositFee(hang, 'swift', 'USD', refs, date, { destination: 'hong-kong' }), 0);
    close(M.depositFee(hang, 'swift', 'USD', refs, date), E.overseasOnlineSwiftHkd * refs.HKD);
    close(M.returnFee(hang, D.mainlandBanks[0], 'swift', refs, date), E.overseasOnlineSwiftHkd * refs.HKD);
  }
});

test('local recipient waivers do not waive broker recipient charges, overseas wires or mainland returns', () => {
  let checked = 0;
  for (const startBank of D.calculator.mainland) for (const broker of ['chief', 'usmart', 'ibkr'])
    for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
      const r = run({ startBank, broker, outcome });
      const deposit = row(r, 'depositBank');
      assert.ok(deposit, JSON.stringify({ startBank, broker, outcome, error: r.error }));
      const local = broker !== 'ibkr';
      close(deposit.cny, (local ? 0 : E.overseasOnlineSwiftHkd) * r.refs.HKD);
      assert.equal(deposit.swiftTariff.destination, local ? 'hong-kong' : 'overseas');
      assert.deepEqual(deposit.sources, ['hangHk']);
      if (local) assert.match(deposit.evidence, /恒生Mobile App.*香港本地SWIFT.*0 HKD/);
      assert.equal(row(r, 'depositOther').cny, null);
      assert.equal(r.complete, false);
      if (outcome === 'mainland') {
        close(row(r, 'returnWire').cny, E.overseasOnlineSwiftHkd * r.refs.HKD);
        assert.equal(row(r, 'returnOther').cny, null);
      }
      close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
      checked++;
    }
  assert.equal(checked, 135);
  const receipt = run({ depositHkd: 12, depositOtherCny: 7 });
  close(row(receipt, 'depositBank').cny, 12 * receipt.refs.HKD);
  close(row(receipt, 'depositOther').cny, 7);
  assert.equal(row(receipt, 'depositBank').swiftTariff, undefined);
  for (const bank of ['za', 'hsbc', 'bochk', 'sc']) {
    const r = run({ bank, broker: 'ibkr' });
    close(row(r, 'depositBank').cny, M.outwardFee(D.hkBanks.find(item => item.id === bank), base.date) * r.refs.HKD);
  }
});
