const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const refs = { USD: 7, HKD: .9, CNH: 1 };
const base = { date: '2026-10-12', months: 12, buyOrders: 1, sellOrders: 1, sharePriceUsd: 100 };
const run = (id, changes = {}) => M.brokerTradingFees({ ...base, ...changes }, D.brokers.find(b => b.id === id), 14912.19, 0, refs);
const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);
test('a valid Chief voucher covers both orders before expiry independently of bank account months', () => {
  const coupon = { useVoucher: true, voucherScope: 'both', voucherUsd: 100, voucherOrders: 100, voucherExpiry: '2026-11-12' };
  const legacy = run('chief', coupon);
  near(legacy.orders[0].discount, legacy.orders[0].platform);
  near(legacy.orders[1].discount, 0);
  assert.equal(legacy.sellDate, '2027-09-12');
  const current = run('chief', { ...coupon, sellDate: '2026-10-12' });
  for (const order of current.orders) {
    near(order.discount, order.platform);
    near(order.netPlatform, 0);
    near(order.netCommission, 0);
    near(order.feeUsd, order.clearing + order.sec + order.taf + order.cat);
  }
  near(current.discountUsd, current.orders.reduce((s,o)=>s+o.platform,0));
  near(current.investUsd+current.buyDebitFeeUsd+current.cashRemainderUsd,14912.19);
});
test('voucher expiry applies to each actual order date and sale cannot precede purchase', () => {
  const coupon = { useVoucher: true, voucherScope: 'platform', voucherUsd: 100, voucherOrders: 100, voucherExpiry: '2026-11-12' };
  const end = run('chief', { ...coupon, sellDate: '2026-11-12' });
  assert.ok(end.orders.every(o=>o.discount>0));
  const after = run('chief', { ...coupon, sellDate: '2026-11-13' });
  assert.equal(after.orders[1].discount,0);
  for (const sellDate of ['2026-10-11','2026-02-30','x']) assert.equal(run('chief',{sellDate}).errorField,'sellDate');
});
test('explicit sale date controls securities custody and return offer date without erasing the bank period', () => {
  const sameDay = run('hsbc', { sellDate: '2026-10-12', trade25: false });
  assert.equal(sameDay.monthlyUsd,0);
  assert.ok(run('hsbc',{trade25:false}).monthlyUsd>0);
  const Q=require('./fixtures/money-flow-quotes-20261012.json');
  const profile={...base,budgetCny:100000,count:1,profitUsd:0,taxRate:20,creditCny:0,startBank:'cib',bank:'hsbc',broker:'za',route:'USD',mainlandMethod:'swift',depositMethod:'chats',returnBank:'hsbc',exitBank:'boc',outcome:'mainland',returnMethod:'swift',returnCurrency:'USD',hsbcBalanceWaiver:false,cnHsbcFeeWaived:true,sellDate:'2026-10-12'};
  const r=M.calculatorJourney(M.calculatorRoute(profile),D,Q).selected;
  assert.ok(r);assert.equal(r.returnDate,profile.sellDate);
  assert.equal(r.rows.find(row=>row.key==='account').items.find(item=>item.bankId==='hsbc'&&item.region!=='mainland').months,12);
});
test('Lite normal listed-share commissions are zero with regulatory charges and Pro remains the default', () => {
  const pro=run('ibkr');const lite=run('ibkr',{ibkrPricing:'lite',sellDate:'2026-10-12'});
  assert.ok(pro.orders.every(o=>o.commission>0));
  assert.ok(lite.orders.every(o=>o.commission===0));
  assert.ok(lite.orders[1].sec>0);
  near(lite.totalUsd,lite.orders.reduce((s,o)=>s+o.sec+o.taf+o.cat,0));
  assert.match(M.selectedBroker({broker:'ibkr',ibkrPricing:'lite'},D).feeShort,/美国居民/);
  near(run('chief',{ibkrPricing:'lite'}).totalUsd,run('chief').totalUsd);
});
test('Lite sub-dollar benchmark uses its special-order cap rather than a Pro minimum', () => {
  const low=run('ibkr',{ibkrPricing:'lite',sharePriceUsd:.5,sellDate:'2026-10-12'});
  for(const order of low.orders)near(order.commission,Math.min(order.shares*.005,order.value*.01));
  assert.match(low.orders[0].pricing,/超过10%/);
});
