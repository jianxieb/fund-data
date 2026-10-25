const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const E = require('./fixtures/money-flow-za-platform-rebate-20261011.json');
const broker = D.brokers.find(item => item.id === 'za');
const refs = { USD: 7, HKD: 7 / 7.8 };
const input = { date: '2026-10-11', months: 1, sharePriceUsd: 100, buyOrders: 1, sellOrders: 1, zaPerksLevel: 'lv2', usedPromoOrders: 0 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const trade = (changes = {}, cash = 1000, profit = 0) => M.brokerTradingFees({ ...input, ...changes }, broker, cash, profit, refs);
const voucher = { useVoucher: true, voucherUsd: 1, voucherOrders: 1, voucherExpiry: '2026-12-31', voucherScope: 'platform' };

test('ZA Lv2 can buy only after funding the full initial standard platform debit', () => {
  assert.equal(D.sources.zaPerks.url, E.source);
  close(broker.platform.minimum, E.standardPlatform.minimumUsd);
  for (const cash of [100.99, 101, 101.98]) assert.match(trade({}, cash).error, /不足.*买入/);
  const r = trade({}, 101.99);
  assert.ok(!r.error); close(r.investUsd, 100);
  close(r.buyDebitFeeUsd, 1.99); close(r.buyFeeUsd, .99); close(r.cashRemainderUsd, 0);
  close(r.orders[0].rebateUsd, 1); close(r.orders[0].upfrontPlatform, 1.99);
  close(r.buyDebitFeeUsd + r.sellDebitFeeUsd - r.rebateUsd, r.totalUsd);
  assert.match(trade({ buyOrders: 3 }, 305.96).error, /不足.*买入/);
  const split = trade({ buyOrders: 3 }, 305.97);
  assert.ok(!split.error); close(split.investUsd, 300); close(split.buyDebitFeeUsd, 5.97); close(split.cashRemainderUsd, 0);
  const ordinary = trade({ zaPerksLevel: 'standard' }, 101.99);
  close(ordinary.rebateUsd, 0); close(ordinary.buyDebitFeeUsd, ordinary.buyFeeUsd);
});

test('ZA membership and platform vouchers select one benefit and only eligible membership orders consume the monthly quota', () => {
  const tie = trade({ ...voucher, usedPromoOrders: 4 });
  const [buy, sell] = tie.orders;
  close(buy.platform, 1.99); close(buy.discount, 1); close(buy.rebateUsd, 0); close(buy.feeUsd, .99);
  assert.equal(buy.offer, ''); assert.equal(sell.offer, 'ZA Perks Lv2'); close(sell.rebateUsd, 1);
  const smaller = trade({ ...voucher, voucherUsd: .5, usedPromoOrders: 4 });
  assert.equal(smaller.orders[0].offer, 'ZA Perks Lv2'); close(smaller.orders[0].discount, 0);
  assert.equal(smaller.orders[1].offer, ''); close(smaller.orders[1].discount, .5);
  const larger = trade({ ...voucher, voucherUsd: 2, usedPromoOrders: 4 });
  close(larger.orders[0].discount, 1.99); close(larger.orders[0].rebateUsd, 0);
  assert.equal(larger.orders[1].offer, 'ZA Perks Lv2'); close(larger.orders[1].discount, 0);
  const expired = trade({ ...voucher, voucherExpiry: '2026-10-10', usedPromoOrders: 4 });
  close(expired.discountUsd, 0); close(expired.rebateUsd, 1);
  const unusedScope = trade({ ...voucher, voucherScope: 'commission', usedPromoOrders: 4 });
  close(unusedScope.discountUsd, 0); close(unusedScope.rebateUsd, 1);
  for (const r of [tie, smaller, larger, expired, unusedScope]) {
    assert.ok(r.orders.every(order => !(order.rebateUsd > 0 && order.discount > 0)));
    close(r.buyDebitFeeUsd + r.sellDebitFeeUsd - r.rebateUsd, r.totalUsd);
  }
});

test('ZA upfront liquidity, month reset and refund reconciliation hold at share and fee boundaries', () => {
  let checked = 0;
  for (const cash of [101.98, 101.99, 1000, 10000, 1000000]) for (const buys of [1, 3]) for (const sells of [1, 4])
    for (const months of [0, 1, 2]) for (const usedPromoOrders of [0, 4, 5]) for (const voucherUsd of [0, .5, 1, 100]) {
      const r = trade({ ...voucher, voucherUsd, buyOrders: buys, sellOrders: sells, months, usedPromoOrders }, cash);
      if (r.error) { assert.match(r.error, /余额不足/); continue; }
      close(r.investUsd + r.buyDebitFeeUsd + r.cashRemainderUsd, cash);
      close(r.totalUsd + r.rebateUsd, r.buyDebitFeeUsd + r.sellDebitFeeUsd);
      assert.ok(r.cashRemainderUsd >= 0 && r.orders.every(order => order.debitFeeUsd >= order.feeUsd && order.feeUsd >= 0));
      const saleCashBeforeRefund = r.cashRemainderUsd + r.investUsd - r.sellDebitFeeUsd;
      assert.ok(saleCashBeforeRefund >= 0);
      close(saleCashBeforeRefund + r.rebateUsd, cash - r.totalUsd);
      checked++;
    }
  assert.ok(checked > 400);
  const same = trade({ usedPromoOrders: 4 });
  const next = trade({ usedPromoOrders: 4, months: 2 });
  close(same.rebateUsd, 1); close(next.rebateUsd, 2);
  assert.match(trade({}, 101.99, -100).error, /尚未返还.*不能支付当前费用/);
  assert.match(trade({ months: 1 }, 101.99, -99).error, /尚未返还.*不能支付当前费用/);
  assert.match(trade({ months: 2 }, 101.99, -99).error, /尚未返还/);
  const credited = trade({ months: 2, buyRebateReceivedUsd: 1 }, 101.99, -99);
  assert.ok(!credited.error); close(credited.buyRebateAvailableUsd, 1);
  close(credited.investUsd - 99 + credited.cashRemainderUsd + credited.buyRebateAvailableUsd, credited.sellDebitFeeUsd);
  close(credited.investUsd - 99 + credited.cashRemainderUsd - credited.sellDebitFeeUsd + credited.rebateUsd, 1);
});

test('ZA rebate accounting keeps independent bank actions and net cash consistent in the complete flow', () => {
  const base = { budgetCny: 100000, count: 1, months: 12, date: '2026-10-11', profitUsd: 0, taxRate: 20,
    startBank: 'boc', bank: 'bochk', broker: 'za', returnBank: 'bochk', exitBank: 'boc', route: 'USD', outcome: 'usd-balance',
    buyOrders: 1, sellOrders: 1, sharePriceUsd: 100, zaPerksLevel: 'lv2', usedPromoOrders: 4 };
  const calculate = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q).selected;
  const ordinary = calculate({ zaPerksLevel: 'standard' });
  const member = calculate({});
  const coupon = calculate(voucher);
  assert.ok(ordinary && member && coupon);
  const fees = ['entryFx', 'sender', 'entryMiddle', 'entryInward', 'depositBank', 'depositOther', 'depositBroker', 'withdraw', 'returnInward', 'withdrawMiddle', 'account'];
  for (const r of [member, coupon]) {
    for (const key of fees) close(r.rows.find(row => row.key === key).cny, ordinary.rows.find(row => row.key === key).cny);
    close(r.trading.investUsd + r.trading.buyDebitFeeUsd + r.trading.cashRemainderUsd, r.steps.fundedUsd);
    close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  }
  assert.ok(member.trading.rebateUsd > 0); assert.ok(coupon.trading.discountUsd > 0);
});

test('calendar gaps never make an unreceived ZA rebate spendable and confirmed cash is capped by the earned rebate', () => {
  for (const sellDate of ['2026-10-12', '2026-11-15', '2026-12-20']) {
    assert.match(trade({ sellDate }, 101.99, -99).error, /尚未返还/);
    const confirmed = trade({ sellDate, buyRebateReceivedUsd: 1 }, 101.99, -99);
    assert.ok(!confirmed.error); close(confirmed.buyRebateAvailableUsd, 1);
  }
  for (const buyRebateReceivedUsd of [-1, 2, 'NaN']) assert.match(trade({ buyRebateReceivedUsd }).error, /已到账.*返还金额/);
});
