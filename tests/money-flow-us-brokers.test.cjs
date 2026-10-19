const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261012.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const base = { ...config, date: '2026-10-12', sellDate: '2026-10-12', startBank: 'cib', bank: 'hsbc',
  returnBank: 'hsbc', exitBank: 'boc', route: 'USD', mainlandMethod: 'swift', depositMethod: '',
  outcome: 'usd-balance', hsbcBalanceWaiver: true, months: 1, sharePriceUsd: 100, buyOrders: 1, sellOrders: 1 };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q);
const broker = id => D.brokers.find(item => item.id === id);
const row = (r, key) => r.rows.find(item => item.key === key);
const refs = { USD: 7, HKD: 7 / 7.8, CNH: 1, CNY: 1 };

test('US brokerage accounts retain independent banks and use only the USD international wire route', () => {
  for (const id of ['firstrade', 'schwab']) for (const bank of D.calculator.hkBanks) for (const route of D.calculator.currencies) {
    const input = M.calculatorRoute({ ...base, broker: id, bank, route });
    assert.equal(input.bank, bank); assert.equal(input.returnBank, 'hsbc');
    assert.equal(input.depositMethod, 'swift');
    assert.equal(input.fxMode, route === 'USD' ? 'manual' : 'bank');
    assert.deepEqual(M.calculatorChannels(input, D).depositMethods, ['swift']);
    const actual = run({ broker: id, bank, route });
    const result = actual.selected || actual.partial;
    assert.ok(result, `${id}/${bank}/${route}`);
    assert.equal(result.broker.id, id);
    if (result.steps.fundedUsd != null) {
      close(row(result, 'depositBroker').cny, 0);
      assert.equal(row(result, 'depositOther').cny, null);
    }
  }
});

test('US instructions reject local channels and convert non-USD balances at the bank for direct model callers', () => {
  for (const id of ['firstrade', 'schwab']) for (const depositMethod of ['chats', 'fps', 'edda', 'internal', 'via-hsbc']) {
    const actual = run({ broker: id, depositMethod });
    assert.match(actual.error, /美国USD收款指示/);
    assert.equal(actual.partial.errorStage, '03');
    assert.ok(actual.partial.steps.hongKong > 0);
    assert.equal(actual.partial.steps.fundedUsd, undefined);
  }
  const actual = M.calculatorJourney({ ...base, broker: 'firstrade', route: 'HKD', fxMode: 'manual', depositMethod: 'swift' }, D, Q);
  assert.equal(actual.selected.fxMode, 'bank');
  assert.ok(actual.selected.steps.hkConvertedUsd > 0);
  assert.equal(actual.selected.depositMethod, 'swift');
});

test('each broker wire fee remains separate from sending, intermediary and receiving bank charges', () => {
  for (const id of ['firstrade', 'schwab']) {
    const r = run({ broker: id }).selected;
    close(row(r, 'depositBank').cny, 70 * r.refs.HKD);
    close(row(r, 'depositBroker').cny, 0);
    close(row(r, 'withdraw').cny, (id === 'firstrade' ? 25 : 15) * r.refs.USD);
    assert.equal(row(r, 'withdraw').nativeCurrency, 'USD');
    assert.equal(row(r, 'depositOther').cny, null);
    assert.equal(row(r, 'withdrawMiddle').cny, null);
    close(row(r, 'returnInward').cny, 0);
    assert.equal(r.complete, false);
    const priced = run({ broker: id, depositOtherCny: 10, intermediaryCny: 20 }).selected;
    close(row(priced, 'depositOther').cny, 10); close(row(priced, 'withdrawMiddle').cny, 20);
    close(priced.budgetCny + priced.profitUsd * priced.refs.USD - priced.costCny - priced.taxCny + priced.fxImpactCny, priced.netCny);
    const retained = run({ broker: id, outcome: 'broker-balance' }).selected;
    assert.equal(row(retained, 'withdraw'), undefined);
    assert.equal(row(retained, 'withdrawMiddle'), undefined);
  }
});

test('Schwab online and assisted wires use 15 and 25 dollars without IBKR free-withdrawal allowances', () => {
  for (const withdrawalIndex of [1, 2, 3, 10]) {
    for (const [brokerWireChannel, fee] of [['online', 15], ['assisted', 25]]) {
      const r = run({ broker: 'schwab', brokerWireChannel, withdrawalIndex }).selected;
      close(row(r, 'withdraw').cny, fee * r.refs.USD);
    }
    const r = run({ broker: 'firstrade', withdrawalIndex, brokerWireChannel: 'assisted' }).selected;
    close(row(r, 'withdraw').cny, 25 * r.refs.USD);
  }
  assert.match(run({ broker: 'schwab', brokerWireChannel: 'invalid' }).error, /出金渠道/);
});

test('zero commission is not zero sell-side regulatory cost and Schwab marks its industry fee estimate', () => {
  for (const id of ['firstrade', 'schwab']) {
    const t = M.brokerTradingFees(base, broker(id), 1000, 0, refs);
    close(t.buyFeeUsd, 0); close(t.sellFeeUsd, .03);
    for (const o of t.orders) {
      close(o.commission, 0); close(o.platform, 0); close(o.clearing, 0); close(o.cat, 0);
      close(o.taf, 0); // FINRA's October–December 2026 holiday.
    }
  }
  const estimated = run({ broker: 'schwab' }).selected;
  assert.match(row(estimated, 'trade').estimate, /Industry Fee/);
  const actual = run({ broker: 'schwab', tradeFeeUsd: 2 }).selected;
  assert.equal(row(actual, 'trade').estimate, undefined);
});

test('Firstrade fractional orders honor the five-dollar and strictly-more-than-0.00001-share limits', () => {
  const trade = changes => M.brokerTradingFees({ ...base, ...changes }, broker('firstrade'), changes.cash ?? 5, 0, refs);
  const t = trade({ sharePriceUsd: 1000 });
  assert.equal(t.error, undefined); close(t.investUsd, 5); close(t.orders[0].shares, .005);
  assert.match(trade({ cash: 4.99 }).error, /5 USD/);
  assert.match(trade({ sharePriceUsd: 1000000, cash: 10 }).error, /0.00002股/);
  assert.match(trade({ sharePriceUsd: 1000000, cash: 40, sellOrders: 3 }).error, /0.00002股/);
  const split = trade({ sharePriceUsd: 1000000, cash: 40, sellOrders: 2 });
  assert.equal(split.error, undefined);
  assert.ok(split.orders.every(order => order.shares >= .00002 - 1e-12));
});

test('Schwab whole-share scenario retains spare cash and names the correct broker for insufficient capital', () => {
  const t = M.brokerTradingFees(base, broker('schwab'), 1050, 0, refs);
  assert.equal(t.wholeSharesOnly, true); close(t.investUsd, 1000); close(t.cashRemainderUsd, 50);
  const tiny = M.brokerTradingFees(base, broker('schwab'), 99, 0, refs);
  assert.match(tiny.error, /嘉信国际.*整股/); assert.doesNotMatch(tiny.error, /盈立/);
});
