const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const E = require('./fixtures/money-flow-hsbc-cheque-20261012.json');
const Q = require('./fixtures/money-flow-quotes-20261012.json');
const bank = id => D.hkBanks.find(item => item.id === id);
const row = (r, key) => r.rows.find(item => item.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const base = { date: E.checkedAt, budgetCny: 100000, count: 1, months: 0, profitUsd: 0,
  startBank: 'boc', bank: 'bochk', broker: 'chief', route: 'USD', outcome: 'usd-balance',
  returnBank: 'hsbc', exitBank: 'boc', mainlandMethod: 'boc-mobile', depositMethod: 'internal',
  buyOrders: 1, sellOrders: 1, sharePriceUsd: 100, taxRate: 20, creditCny: 0, hsbcBalanceWaiver: true };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q).selected;

test('HSBC One local USD cheque fee uses the correct account column and separate channel waivers', () => {
  const b = bank('hsbc'), tariff = b.localUsdChequeTariff;
  assert.equal(b.localUsdChequeHkd, undefined);
  assert.equal(tariff.standardHkd, E.tariff.counterPerChequeHkd);
  assert.equal(tariff.nonCounterHkd, E.tariff.nonCounterPerChequeHkd);
  assert.equal(tariff.smallAmountUnderHkd, E.tariff.waivedBelowEquivalentHkd);
  for (const date of ['2026-08-01', E.checkedAt, '2026-11-01', '2027-10-01']) {
    for (const index of [1, 30, 31, 200, NaN]) {
      close(M.localUsdChequeFee(b, index, date), 5);
      close(M.localUsdChequeFee(b, index, date, true), 5);
      close(M.localUsdChequeFee(b, index, date, false, { nonCounter: true }), 0);
    }
  }
  assert.equal(M.localUsdChequeFee(b, 1, '2026-07-31'), null);
  close(M.localUsdChequeFee(b, 1, E.checkedAt, false, { amountHkd: 4.999 }), 0);
  close(M.localUsdChequeFee(b, 1, E.checkedAt, false, { amountHkd: 5 }), 5);
  close(M.localUsdChequeFee(b, 1, E.checkedAt, false, { amountHkd: NaN }), 5);
  close(M.localUsdChequeFee(bank('bochk'), 31, E.checkedAt, false, { nonCounter: true }), 1);
});

test('HSBC cheque charges occur once, use HKD conversion, and reconcile every applicable outcome', () => {
  for (const broker of ['chief', 'usmart']) for (const budgetCny of [5000, 100000, 1500000]) {
    for (const outcome of ['usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
      for (const returnCurrency of outcome === 'mainland' ? ['USD', 'HKD'] : ['USD']) {
        const input = { broker, budgetCny, outcome, returnCurrency };
        const paid = run(input), waived = run({ ...input, hsbcChequeNonCounter: true });
        assert.ok(paid && waived, JSON.stringify(input));
        close(row(paid, 'withdraw').cny, 0);
        close(row(paid, 'returnInward').cny, 5 * paid.refs.HKD);
        close(row(waived, 'returnInward').cny, 0);
        close(paid.steps.returnUsd, waived.steps.returnUsd - 5 * paid.refs.HKD / paid.refs.USD);
        assert.equal(row(paid, 'returnInward').nativeCurrency, 'HKD');
        assert.match(row(paid, 'returnInward').evidence, /柜台存票/);
        assert.match(row(waived, 'returnInward').evidence, /非柜台/);
        for (const result of [paid, waived]) {
          const ledger = M.flowLedger(result);
          for (const leg of ledger.legs) close(leg.inputCny + leg.profitCny - leg.outputCny,
            leg.costCny + leg.taxCny - leg.fxImpactCny);
        }
      }
    }
  }
});

test('actual receipt overrides only the cheque credit while inactive HSBC and unused daily index do not affect other actions', () => {
  for (const broker of ['chief', 'usmart']) {
    const actual = run({ broker, inwardHkd: 3, hsbcChequeNonCounter: true });
    close(row(actual, 'returnInward').cny, 3 * actual.refs.HKD);
    close(row(actual, 'withdraw').cny, 0);
    assert.ok(run({ broker, chequeIndex: 'invalid' }));
    const kept = run({ broker, outcome: 'broker-balance', chequeIndex: 'invalid' });
    assert.equal(row(kept, 'returnInward'), undefined);
    for (const returnBank of ['bochk', 'hang', 'sc', 'icbc-asia']) {
      const a = run({ broker, returnBank, chequeIndex: 31 }), b = run({ broker, returnBank, chequeIndex: 31, hsbcChequeNonCounter: true });
      assert.ok(a && b, returnBank);
      close(a.costCny, b.costCny);
      close(a.net, b.net);
    }
  }
  for (const broker of ['ibkr', 'hsbc', 'za']) {
    const a = run({ broker, depositMethod: '' }), b = run({ broker, depositMethod: '', hsbcChequeNonCounter: true });
    assert.ok(a && b, broker); close(a.costCny, b.costCny); close(a.net, b.net);
  }
});

test('a preferred route retains non-counter confirmation only for the same broker and receiving bank', () => {
  const input = { ...base, hsbcChequeNonCounter: true }, same = run(input);
  const applied = M.applyRoute(input, same);
  assert.equal(applied.hsbcChequeNonCounter, true);
  close(row(run(applied), 'returnInward').cny, 0);
  for (const change of [{ returnBank: 'bochk' }, { broker: 'usmart' }]) {
    const other = run(change), next = M.applyRoute(input, other);
    assert.equal(next.hsbcChequeNonCounter, false);
    if (change.broker) close(row(run(next), 'returnInward').cny, 5 * other.refs.HKD);
  }
});
