const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');

const config = { budgetCny: 5000, count: 1, months: 0, usedFreeTransfers: 0,
  date: '2026-10-12', startBank: 'boc', bank: 'bochk', broker: 'za', route: 'USD',
  returnBank: 'bochk', exitBank: 'boc', outcome: 'mainland', returnCurrency: 'HKD',
  mainlandMethod: 'boc-mobile', depositMethod: 'chats', returnMethod: 'bochk-fast',
  profitUsd: 0, taxRate: 20, creditCny: 0, withdrawalIndex: 1,
  buyOrders: 1, sellOrders: 1, sharePriceUsd: 100 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const calc = changes => M.calculatorJourney(M.calculatorRoute({ ...config, ...changes }), D, Q);

test('HKD return applies the chosen HK bank USD bid and mainland HKD buy separately', () => {
  const { selected: r, error } = calc();
  assert.equal(error, undefined);
  assert.equal(r.returnCurrency, 'HKD');
  const hkdBid = Q.offshoreUsd.bochk.quotes.HKD.bidPerUsd;
  const mainlandBuy = Q.banks.boc.quotes.HKD.buy;
  near(r.steps.returnHkd, r.steps.returnUsd * hkdBid);
  near(r.steps.remitHkd, r.steps.returnHkd);
  near(r.steps.terminal, r.steps.remitHkd * mainlandBuy);
  near(r.returnHkdPrice, hkdBid);
  near(r.exitPrice, mainlandBuy);
  assert.equal(r.steps.remitUsd, undefined);
  const fx = r.rows.find(row => row.key === 'returnFx'), settle = r.rows.find(row => row.key === 'exitFx');
  near(fx.cny, r.steps.returnUsd * r.refs.USD - r.steps.returnHkd * r.refs.HKD);
  near(settle.cny, r.steps.remitHkd * r.refs.HKD - r.steps.terminal);
  assert.deepEqual(fx.exchanges.map(x => [x.from, x.to]), [['USD', 'HKD']]);
  assert.deepEqual(settle.exchanges.map(x => [x.from, x.to]), [['HKD', 'CNY']]);
  const ledger = M.flowLedger(r);
  near(ledger.legs[4].costCny, fx.cny + settle.cny);
  near(r.netCny, r.budgetCny - r.costCny);
  assert.equal(r.complete, true);
  assert.ok(r.rows.find(row => row.key === 'returnOther').estimate);
});

test('HKD and USD returning amounts use different actual prices and do not inherit each other', () => {
  const hkd = calc({ returnExtraCny: 0 }).selected;
  const usd = calc({ returnCurrency: 'USD', returnExtraCny: 0 }).selected;
  near(usd.steps.terminal, usd.steps.remitUsd * Q.banks.boc.quotes.USD.buy);
  assert.equal(usd.rows.some(row => row.key === 'returnFx'), false);
  assert.notEqual(hkd.steps.terminal, usd.steps.terminal);
  const actual = calc({ returnHkdPrice: 7.6, exitPrice: .82, returnExtraCny: 15, returnWireHkd: 20 }).selected;
  near(actual.steps.returnHkd, actual.steps.returnUsd * 7.6);
  near(actual.steps.remitHkd, actual.steps.returnHkd - 20 - 15 / actual.refs.HKD);
  near(actual.steps.terminal, actual.steps.remitHkd * .82);
  near(actual.netCny, actual.budgetCny - actual.costCny);
});

test('small HKD arrival records do not make large transfers, USD or SWIFT intermediary fees free', () => {
  for (const changes of [{ budgetCny: 100000 }, { returnCurrency: 'USD' }, { returnMethod: 'swift' }, { exitBank: 'icbc', returnMethod: 'swift' }]) {
    const r = calc(changes).selected;
    assert.equal(r.rows.find(row => row.key === 'returnOther').cny, null, JSON.stringify(changes));
    assert.equal(r.complete, false);
  }
  const large = calc({ budgetCny: 100000, count: 1 }).selected;
  assert.ok(large.steps.remitHkd > 10000);
  assert.equal(large.rows.find(row => row.key === 'returnWire').cny, 0);
  assert.ok(large.rows.find(row => row.key === 'returnOther').items.some(x => x.label.includes('HKD') && x.cny === 0));
});

test('missing personal HKD conversion prices keep known costs and never produce a quoted HKD amount', () => {
  const r = calc({ returnBank: 'sc', returnMethod: 'swift' }).selected;
  assert.ok(r.indicativeReturnFx);
  assert.equal(r.rows.find(row => row.key === 'returnFx').cny, null);
  assert.equal(r.complete, false);
  assert.equal(r.quotedCore, false);
  assert.ok(r.steps.returnUsd > 0);
  assert.ok(r.rows.find(row => row.key === 'trade').cny > 0);
  assert.ok(r.missing.some(x => x.includes('渣打') && x.includes('USD/HKD')));
});

test('HKD return quote freshness and currency-specific inputs are checked without affecting unused outcomes', () => {
  assert.match(calc({ returnCurrency: 'CNH' }).error, /回款币种/);
  assert.match(calc({ returnHkdPrice: -1 }).error, /汇率/);
  assert.equal(calc({ returnCurrency: 'USD', returnHkdPrice: -1 }).error, undefined);
  assert.equal(calc({ outcome: 'broker-balance', returnCurrency: 'invalid', returnHkdPrice: -1 }).error, undefined);
  const q = structuredClone(Q); q.offshoreUsd.bochk.quotes.HKD.asOf = '2026-01-01';
  const stale = M.calculatorJourney(config, D, q).selected;
  assert.equal(stale.quoteFreshness.returnMarket, false);
  assert.equal(stale.quotedCore, false);
});
