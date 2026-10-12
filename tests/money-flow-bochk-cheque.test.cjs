const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const E = require('./fixtures/money-flow-bochk-cheque-20261012.json');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const bank = id => D.hkBanks.find(item => item.id === id);
const row = (r, key) => r.rows.find(item => item.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const base = { date: E.checkedAt, budgetCny: 100000, count: 1, months: 0, profitUsd: 0,
  startBank: 'boc', bank: 'bochk', broker: 'chief', route: 'USD', outcome: 'usd-balance',
  returnBank: 'bochk', exitBank: 'boc', mainlandMethod: 'boc-mobile', depositMethod: 'internal', returnMethod: '',
  buyOrders: 1, sellOrders: 1, sharePriceUsd: 100, taxRate: 20, creditCny: 0, withdrawalIndex: 1 };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q);

test('BOCHK local cheque tariff preserves its daily allowance and source scope', () => {
  assert.equal(D.sources.bochkCheque.url, E.source);
  assert.equal(D.sources.bochkChequeTariff.url, E.pdf.url);
  const b = bank('bochk');
  assert.equal(b.localUsdChequeTariff.freePerDay, E.tariff.freePerDay);
  assert.equal(b.localUsdChequeTariff.standardHkd, E.tariff.excessPerChequeHkd);
  assert.equal(b.localUsdChequeHkd, undefined);
  assert.equal(b.localUsdChequeTariff.validFrom, undefined);
  for (const { dailyIndex, feeHkd } of E.boundaries) for (const preFilled of [false, true]) {
    close(M.localUsdChequeFee(b, dailyIndex, E.checkedAt, preFilled), feeHkd);
  }
  for (const dailyIndex of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(M.localUsdChequeFee(b, dailyIndex, E.checkedAt), null);
  }
  close(M.localUsdChequeFee(bank('sc'), 31, E.checkedAt, true), 1);
  close(M.localUsdChequeFee(bank('sc'), 31, E.checkedAt), 2);
  close(M.localUsdChequeFee(bank('icbc-asia'), 31, E.checkedAt, true), 2);
  close(M.localUsdChequeFee(bank('hsbc'), 200, E.checkedAt), 5);
  close(M.localUsdChequeFee(bank('hang'), 200, E.checkedAt), 0);
  assert.equal(M.localUsdChequeFee(bank('za'), 1, E.checkedAt), null);
});

test('BOCHK cheque fees reconcile every downstream outcome, explicit receipt and retained stock cash', () => {
  for (const broker of ['chief', 'usmart']) for (const budgetCny of [5000, 100000, 1500000]) {
    for (const outcome of ['usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
      for (const returnCurrency of outcome === 'mainland' ? ['USD', 'HKD'] : ['USD']) {
        const input = { broker, budgetCny, outcome, returnCurrency };
        const free = run({ ...input, chequeIndex: 30 }).selected;
        assert.ok(free, JSON.stringify(input));
        for (const chequeIndex of [31, 200]) for (const chequePreFilled of [false, true]) {
          const paid = run({ ...input, chequeIndex, chequePreFilled }).selected;
          assert.ok(paid, JSON.stringify({ ...input, chequeIndex }));
          const fee = row(paid, 'returnInward');
          close(fee.cny, E.tariff.excessPerChequeHkd * paid.refs.HKD);
          assert.equal(fee.nativeCurrency, 'HKD');
          assert.ok(fee.sources.includes('bochkChequeTariff'));
          assert.match(fee.evidence, new RegExp('当日第' + chequeIndex + '张；每日前30张免费，其后1 HKD'));
          close(paid.costCny - free.costCny - (row(paid, 'returnFx')?.cny ?? 0) - (row(paid, 'exitFx')?.cny ?? 0) +
            (row(free, 'returnFx')?.cny ?? 0) + (row(free, 'exitFx')?.cny ?? 0), paid.refs.HKD);
          close(free.steps.returnUsd - paid.steps.returnUsd, paid.refs.HKD / paid.refs.USD);
          for (const leg of M.flowLedger(paid).legs) {
            close(leg.inputCny + leg.profitCny + leg.fxImpactCny, leg.outputCny + leg.costCny + leg.taxCny);
            close(leg.rows.reduce((sum, item) => sum + (item.cny ?? 0), 0), leg.costCny);
          }
          close(paid.netCny, paid.budgetCny + paid.profitUsd * paid.refs.USD - paid.costCny - paid.taxCny + paid.fxImpactCny);
          assert.deepEqual(paid.rows.filter(item => ['entry', 'deposit', 'investment'].includes(item.step)),
            free.rows.filter(item => ['entry', 'deposit', 'investment'].includes(item.step)));
          const receipt = run({ ...input, chequeIndex: 0, inwardHkd: 3 }).selected;
          assert.ok(receipt); close(row(receipt, 'returnInward').cny, 3 * receipt.refs.HKD);
          assert.match(row(receipt, 'returnInward').evidence, /本人回单/);
        }
      }
    }
    const kept = run({ broker, budgetCny, outcome: 'broker-balance', chequeIndex: 'invalid' }).selected;
    assert.ok(kept); assert.equal(row(kept, 'returnInward'), undefined);
    const invalid = run({ broker, budgetCny, chequeIndex: 0 });
    assert.match(invalid.error, /当日存票序号/);
    assert.equal(invalid.partial.errorAction, 'withdraw');
    assert.ok(invalid.partial.steps.proceedsUsd > 0);
  }
});
