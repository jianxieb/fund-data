const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const evidence = require('./fixtures/money-flow-za-exchange-limits-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);

// Synthetic executed prices isolate exchange ability from unavailable app
// quotes and downstream stock prices. They are not public ZA FX quotations.
const input = (route, budgetCny, broker = 'za', changes = {}) => M.calculatorRoute({ ...config,
  date: '2026-10-11', startBank: 'boc', bank: 'za', returnBank: 'bochk', exitBank: 'boc',
  broker, route, budgetCny, count: 1, months: 1, mainlandMethod: 'swift', fxMode: 'bank',
  outcome: 'broker-balance', senderFeeCny: 0, entryMiddleCny: 0, entryInwardHkd: 0,
  startSell: route === 'HKD' ? 1 : '', entryPrice: route === 'HKD' ? 8 : 7.2,
  tradeFeeUsd: 0, sharePriceUsd: .01, ...changes });

test('ZA exchange bounds apply to the received currency before funding every stock venue and retain completed steps', () => {
  for (const [route, limit] of Object.entries(evidence.inputCurrencyLimits)) for (const broker of D.calculator.brokers) {
    for (const amount of [limit.minimum - .01, limit.maximum + .01]) {
      const s = input(route, amount, broker), data = M.calculatorJourney(s, D, Q), r = data.partial;
      assert.match(data.error || '', /单笔.*换汇/, route + '/' + broker + '/' + amount);
      assert.equal(r.errorStage, '03');
      close(r.steps.hongKong, amount);
      assert.equal(r.steps.fundedUsd, undefined);
      assert.equal(r.rows.find(row => row.key === 'depositBank'), undefined);
      for (const key of ['sender', 'entryMiddle', 'entryInward']) close(r.rows.find(row => row.key === key).cny, 0);
      assert.equal(r.bank.id, 'za'); assert.equal(r.broker.id, broker);
      assert.equal(M.calculatorIssue(s, D), '');
    }
    for (const amount of [limit.minimum, limit.maximum]) {
      const data = M.calculatorJourney(input(route, amount, broker), D, Q), r = data.selected || data.partial;
      assert.ok(r, route + '/' + broker + '/' + amount + ': ' + data.error);
      close(r.steps.hongKong, amount); close(r.steps.hkConvertedUsd, amount / (route === 'HKD' ? 8 : 7.2));
      if (data.error) {
        assert.equal(broker, 'firstrade'); assert.equal(amount, limit.minimum);
        assert.match(data.error, /每笔买入至少5 USD/); assert.equal(r.errorAction, 'trade');
      } else close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
    }
  }
});

test('exchange limits use the bank balance after receipt fees and never multiply the allowed conversion by remittance count', () => {
  const deducted = M.calculatorJourney(input('CNH', 30, 'za', { entryInwardHkd: 1 }), D, Q);
  assert.match(deducted.error || '', /单笔.*换汇/);
  assert.ok(deducted.partial.steps.hongKong < 30);
  const upper = evidence.inputCurrencyLimits.CNH.maximum;
  const splitWires = M.calculatorJourney(input('CNH', upper + 1, 'za', { count: 2 }), D, Q);
  assert.match(splitWires.error || '', /单笔.*换汇/);
  close(splitWires.partial.steps.hongKong, upper + 1);
  const noPrice = M.calculatorJourney(input('CNH', 29, 'za', { entryPrice: '' }), D, Q);
  assert.match(noPrice.error || '', /单笔.*换汇/);
  close(noPrice.partial.steps.hongKong, 29);
});

test('ZA stock selection does not apply ZA bank exchange limits to another bank or to USD that requires no exchange', () => {
  for (const route of ['HKD', 'CNH']) {
    const amount = evidence.inputCurrencyLimits[route].maximum + 1;
    const data = M.calculatorJourney(input(route, amount, 'za', { bank: 'bochk' }), D, Q);
    assert.ok(data.selected, route + ': ' + data.error);
    assert.equal(data.selected.bank.id, 'bochk'); assert.equal(data.selected.broker.id, 'za');
  }
  const usd = M.calculatorJourney(input('USD', 10000000, 'za', { startSell: 7, entryPrice: '', fxMode: 'manual' }), D, Q);
  assert.ok(usd.selected, usd.error); close(usd.selected.steps.hongKong, 10000000 / 7);
  assert.equal(D.sources.zaExchangeLimits.url, evidence.source);
});
