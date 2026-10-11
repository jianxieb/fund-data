const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const evidence = require('./fixtures/money-flow-finra-schedule-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const refs = { CNY: 1, USD: 7, HKD: 7 / 8, CNH: 7 / 7.1 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const dates = ['2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01',
  '2028-12-31', '2029-01-01', '2029-12-31', '2030-01-01', '2030-12-31', '2031-01-01'];
const expectedTaf = order => {
  if (order.kind !== 'sell' || order.date >= evidence.holiday.from && order.date <= evidence.holiday.until) return 0;
  const rate = evidence.schedule.filter(item => item.from <= order.date).at(-1);
  return Math.max(.01, Math.min(rate.maximumPerTradeUsd, Math.ceil((order.shares * rate.perShareUsd - 1e-10) * 100) / 100));
};

test('every stock venue applies the published FINRA schedule to the actual sell date and caps each order independently', () => {
  for (const id of D.calculator.brokers) for (const date of dates) for (const sharePriceUsd of [1, 100]) {
    const provider = D.brokers.find(item => item.id === id);
    const r = M.brokerTradingFees({ date, months: 1, buyOrders: 2, sellOrders: 3, sharePriceUsd }, provider, 1e6, 0, refs);
    assert.ok(!r.error, id + '/' + date + '/' + sharePriceUsd);
    for (const order of r.orders) close(order.taf, expectedTaf(order));
    close(r.totalUsd, r.orders.reduce((sum, order) => sum + order.feeUsd, 0));
    if (sharePriceUsd === 1 && date >= '2029-01-01') {
      const rate = evidence.schedule.filter(item => item.from <= date).at(-1);
      close(r.orders.filter(item => item.kind === 'sell').reduce((sum, item) => sum + item.taf, 0), rate.maximumPerTradeUsd * 3);
    }
  }
});

test('holding periods crossing a scheduled fee change preserve coupon scope, bank costs and the whole-route ledger', () => {
  const buyDate = '2026-10-11';
  for (const broker of D.calculator.brokers) for (const [months, sellDate] of [[27, '2028-12-11'], [28, '2029-01-11'], [40, '2030-01-11'], [52, '2031-01-11']]) {
    const input = M.calculatorRoute({ ...config, date: buyDate, count: 1, months, startBank: 'boc', bank: 'bochk',
      returnBank: 'bochk', exitBank: 'boc', broker, route: 'USD', outcome: 'broker-balance', buyOrders: 2, sellOrders: 3,
      trade25: false, sharePriceUsd: 1, useVoucher: true, voucherScope: 'both', voucherUsd: 1e6, voucherOrders: 5, voucherExpiry: '2032-01-01' });
    const r = M.calculatorJourney(input, D, Q).selected;
    assert.ok(r, broker + '/' + months);
    assert.equal(r.trading.sellDate, sellDate);
    for (const order of r.trading.orders) close(order.taf, expectedTaf(order));
    assert.ok(r.trading.orders.filter(item => item.kind === 'sell').every(item => item.taf > 0));
    const ordinary = M.calculatorJourney({ ...input, useVoucher: false }, D, Q).selected;
    for (const key of ['sender', 'entryMiddle', 'entryInward', 'depositBank', 'depositOther', 'account']) {
      close(r.rows.find(item => item.key === key).cny, ordinary.rows.find(item => item.key === key).cny);
    }
    close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  }
});
