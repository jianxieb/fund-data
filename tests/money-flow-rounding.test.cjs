const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261012.json');
const base = { budgetCny: 100000, count: 1, months: 12, date: '2026-10-12', profitUsd: 0, creditCny: 0, taxRate: 20,
  startBank: 'boc', bank: 'bochk', broker: 'za', returnBank: 'bochk', exitBank: 'boc', outcome: 'broker-balance', route: 'USD',
  buyOrders: 1, sellOrders: 1, sharePriceUsd: 100, withdrawalIndex: 1, usedFreeTransfers: 0, bankBalancesHkd: {} };
const groups = r => {
  const auto = r.broker?.id === 'ibkr' && r.route !== 'USD' && r.fxMode === 'auto', fx = ['brokerSpread', 'brokerFx'];
  return [['entryFx', 'sender', 'entryMiddle', 'entryInward'], ['depositBank', 'depositOther', 'depositBroker', ...(!auto ? fx : [])],
    ['trade', 'brokerAccount', ...(auto ? fx : [])], ['withdraw', 'returnInward', 'withdrawMiddle'],
    ['returnFx', 'returnWire', 'returnOther', 'exitFx', 'card'], ['account', 'extra']];
};
const cents = value => { const absolute = Math.round(Math.abs(value) * 100 + 1e-8); return absolute === 0 ? 0 : Math.sign(value) * absolute; };
const sum = values => values.reduce((total, value) => total + (value == null ? 0 : cents(value)), 0);
function verify(r) {
  const before = JSON.stringify(r), v = M.roundedCosts(r, groups(r));
  assert.equal(cents(v.totalCny), sum(v.groups));
  assert.equal(cents(v.totalCny), sum(r.rows.map(row => v.amounts.get(row))));
  for (const row of r.rows) {
    assert.equal(v.amounts.get(row), v.byKey.get(row.key));
    if (row.cny == null) assert.equal(v.amounts.get(row), null);
    else assert.ok(Math.abs(v.amounts.get(row) - row.cny) < .010000001, row.key);
    if (row.cny === 0) assert.equal(v.amounts.get(row), 0);
    if (row.items?.length && row.cny != null) assert.equal(cents(v.amounts.get(row)), sum(row.items.map(part => v.amounts.get(part))), row.key);
    for (const part of row.items || []) {
      if (part.cny == null) assert.equal(v.amounts.get(part), null);
      if (part.cny === 0) assert.equal(v.amounts.get(part), 0);
    }
  }
  if (v.tradeCny) {
    assert.equal(sum(Object.values(v.tradeCny)), cents(v.byKey.get('trade')));
    const parts = r.rows.find(row => row.key === 'trade').items;
    for (const kind of ['buy', 'sell']) assert.equal(sum(parts.filter(part => part.kind === kind).map(part => v.amounts.get(part))), cents(v.tradeCny[kind]));
  }
  assert.equal(JSON.stringify(r), before, 'presentation changed a native fee or a balance');
  return v;
}

test('default displayed buy and sell CNY fees reconcile with the stage and total while native fees stay intact', () => {
  const r = M.calculatorJourney(M.calculatorRoute(base), D, Q).selected, v = verify(r);
  assert.equal(v.totalCny, 238.29);
  assert.deepEqual(v.tradeCny, { buy: 13.33, sell: 15.61 });
  assert.equal(v.byKey.get('trade'), 28.94);
  assert.equal(r.trading.orders.find(order => order.kind === 'buy').feeUsd, 1.99);
});

test('converted cost projections retain missing amounts, negative FX advantages and exactly free actions', () => {
  for (const values of [[-.0049, .001, .0049, 0, null], [-.125, .125, .005, 0], [20.001, 30.001, .001, 0], [-2.345, -3.456, 0], [-.001, 0, null]]) {
    const r = { rows: values.map((cny, index) => ({ key: String(index), cny })) };
    const v = verify(r);
    assert.equal(cents(v.totalCny), cents(values.reduce((total, value) => total + (value || 0), 0)));
  }
  const r = { rows: [{ key: 'period', cny: 8.5666, items: [{ cny: 4.2833 }, { cny: 4.2833 }, { cny: 0 }] }] };
  verify(r);
});

test('fractional, large, discounted and incomplete amounts preserve known cents and native balances', () => {
  const profiles = [
    ...[.01, .5, 1, 1000, 1000000, 1000000000, 1000000000000].map(budgetCny => ({ budgetCny })),
    { count: 120 }, { months: 1200 }, { sharePriceUsd: .0001 }, { sharePriceUsd: 1000000 },
    { profitUsd: -100 }, { profitUsd: 1000000 }, { startSell: .0001 },
    ...['commission', 'platform', 'both'].map(voucherScope => ({ useVoucher: true, voucherScope, voucherUsd: 100, voucherOrders: 2, voucherExpiry: '2030-01-01' })),
    { tradeFeeUsd: .0001, senderFeeCny: .0001, entryMiddleCny: .0001, entryInwardHkd: .0001, openingCny: .0001 },
    { startBank: 'sc', openingCny: 123 }, { bank: 'sc', route: 'CNH', outcome: 'cnh-card' }
  ];
  for (const profile of profiles) for (const broker of D.calculator.brokers) {
    const data = M.calculatorJourney(M.calculatorRoute({ ...base, ...profile, broker }), D, Q), r = data.selected || data.partial;
    if (r?.rows) try { verify(r); } catch (error) { error.message += ' in ' + JSON.stringify({ ...profile, broker }); throw error; }
  }
});

test('all independent account combinations and applicable currencies and FX modes preserve the displayed cost hierarchy', t => {
  let checked = 0;
  for (const startBank of D.calculator.departureBanks) for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers)
    for (const route of D.calculator.currencies) for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
      for (const returnBank of outcome === 'broker-balance' ? [bank] : D.calculator.hkBanks)
        for (const exitBank of outcome === 'mainland' ? D.calculator.receivingBanks : [startBank])
          for (const returnCurrency of outcome === 'mainland' ? ['USD', 'HKD'] : ['USD']) {
            const input = M.calculatorRoute({ ...base, startBank, bank, broker, route, outcome, returnBank, exitBank, returnCurrency });
            for (const fxMode of M.calculatorChannels(input, D).fxModes) {
              const data = M.calculatorJourney({ ...input, fxMode }, D, Q), r = data.selected || data.partial;
              if (!r?.rows) continue;
              try { verify(r); } catch (error) { error.message += ' in ' + JSON.stringify({ startBank, bank, broker, route, outcome, returnBank, exitBank, returnCurrency, fxMode }); throw error; }
              checked++;
            }
          }
    }
  assert.ok(checked>0,String(checked));
  t.diagnostic(checked + ' independent account/currency/endpoint/FX states reconciled; numerical results may still be partial financial quotes');
});
