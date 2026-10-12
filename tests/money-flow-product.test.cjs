const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const quotes = require('./fixtures/money-flow-quotes-20261012.json');
const date = '2026-10-12';
function ui(input = {}) {
  let saved = { bankFeeDefaultsVersion: 1, ...input }, modal = '';
  const ctx = { window: { MONEY_FLOW: D, MONEY_FLOW_QUOTES: quotes, ChanghengMoneyFlowModel: M },
    localStorage: { getItem: () => JSON.stringify(saved), setItem: (_, value) => { saved = JSON.parse(value); } },
    document: { querySelectorAll: () => [], getElementById: () => null },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date + 'T04:00:00Z'])); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/money-flow.js'), 'utf8'), ctx);
  const helpers = { esc: value => String(value ?? ''), money: (value, digits) => Number(value).toFixed(digits), head: () => '',
    action: (label, action, cls, extra) => '<button data-action="' + action + '" class="' + cls + '" ' + extra + '>' + label + '</button>',
    modalTitle: title => '<h2>' + title + '</h2>', openModal: text => { modal = text; } };
  return { render: () => ctx.window.ChanghengMoneyFlow.view(helpers), saved: () => saved, modal: () => modal,
    act: (action, field, value) => ctx.window.ChanghengMoneyFlow.handleAction({ dataset: { action: 'money-flow-' + action, field, value } }),
    check: (moneyCheck, checked) => ctx.window.ChanghengMoneyFlow.handleChange({ dataset: { moneyCheck }, checked }),
    result: () => M.calculatorJourney({ ...saved, date, sellDate: date }, D, quotes) };
}
const toolbar = html => html.split('id="flow-live-toolbar"')[1].split('id="flow-live-summary"')[0];
const section = (html, label) => html.split('aria-label="' + label + '"')[1]?.split('</section>')[0];
test('preferred catalogue, prices and product names are independent of every current account and qualification', () => {
  const baseline = toolbar(ui().render());
  for (const broker of D.calculator.brokers) {
    const subject = ui({ broker, bank: 'sc', outcome: 'mainland', hsbcBalanceWaiver: false, budgetCny: 150000,
      count: 2, months: 24, useVoucher: true, voucherUsd: 100, voucherOrders: 100, voucherScope: 'both', voucherExpiry: '2026-11-12' });
    assert.equal(toolbar(subject.render()), baseline, broker);
  }
  assert.match(baseline, /兴业寰宇人生/); assert.match(baseline, /汇丰Trade25/);
  assert.doesNotMatch(baseline, /损耗从低到高|买股账户 ZA|已开通|寰宇人生卡|data-value="best:/);
});
test('each fixed plan applies a complete route and its own conditions while preserving principal and editable accounts', () => {
  const plans = M.calculatorPreferredPlans(D, quotes, date);
  for (const plan of plans) {
    const subject = ui({ broker: 'chief', outcome: 'mainland', hsbcBalanceWaiver: false, useVoucher: true,
      voucherUsd: 100, voucherOrders: 100, voucherScope: 'both', voucherExpiry: '2026-11-12', senderFeeCny: 137 });
    subject.render(); subject.act('preset', '', plan.id); const saved = subject.saved(), actual = subject.result().selected;
    assert.ok(actual?.complete, plan.id);
    for (const key of ['startBank','bank','broker','returnBank','outcome','mainlandMethod','depositMethod'])
      assert.equal(saved[key], plan.config[key], key);
    assert.equal(saved.hsbcBalanceWaiver, true); assert.equal(saved.useVoucher, false); assert.equal(saved.senderFeeCny, '');
    assert.ok(Math.abs(actual.costCny - plan.calculated.selected.costCny) < 1e-7);
    const priorBank = saved.bank; subject.act('choose', 'broker', 'usmart'); assert.equal(subject.saved().bank, priorBank);
    subject.act('choose', 'bank', 'bochk'); assert.equal(subject.saved().broker, 'usmart');
  }
  const amount = ui({ budgetCny: 150000 }); amount.render(); amount.act('preset', '', plans[0].id);
  assert.equal(amount.saved().budgetCny, 150000);
});
test('departure picker has exactly four banks; retired saved senders repair without replacing Hong Kong banks or brokers', () => {
  for (const startBank of ['ccb','comm','hsbc','hang','sc','abc','missing']) {
    const subject = ui({ startBank, bank: 'hsbc', broker: 'chief', returnBank: 'bochk', startSell: 6.1, senderFeeCny: 137 });
    subject.render(); assert.equal(subject.saved().startBank, 'boc');
    assert.equal(subject.saved().bank, 'hsbc'); assert.equal(subject.saved().broker, 'chief');
    assert.equal(subject.saved().returnBank, 'bochk'); assert.equal(subject.saved().startSell, '');
    subject.act('pick', '', 'startBank');
    const ids = [...subject.modal().matchAll(/data-field="startBank" data-value="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(ids, ['boc','cib','cmb','icbc']);
    subject.act('choose', 'startBank', 'ccb'); assert.equal(subject.saved().startBank, 'boc');
  }
});
test('Hong Kong banks and stock venues remain complete and enabled after plan application and manual changes', () => {
  const subject = ui(); subject.render(); subject.act('preset', '', 'cib-trade25');
  for (const [key, expected] of [['bank', D.calculator.hkBanks], ['returnBank', D.calculator.hkBanks], ['broker', D.calculator.brokers]]) {
    subject.act('pick', '', key);
    const ids = [...subject.modal().matchAll(new RegExp('data-field="' + key + '" data-value="([^"]+)"','g'))].map(m => m[1]);
    assert.deepEqual(ids, expected); assert.doesNotMatch(subject.modal(), /\bdisabled\b/);
  }
});
test('principal defaults to 100000 and currency choices are RMB, USD, HKD without a trade date form', () => {
  const subject = ui({ sellDate: '2027-09-12' }), html = subject.render();
  assert.equal(subject.saved().budgetCny, '100000');
  assert.match(html, /100000.00 <small>CNY/);
  const currencies = [...section(html, '内地出发银行').matchAll(/data-field="route" data-value="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(currencies, ['CNH','USD','HKD']);
  assert.doesNotMatch(html, /交易日期|卖出 2027|买入 2026/);
  subject.act('detail','','trade-settings'); assert.doesNotMatch(subject.modal(), /data-money-field="sellDate"/);
  assert.equal(subject.saved().sellDate,date);
});
test('withdrawal is between the stock account and return bank, before bank FX or spending', () => {
  const subject = ui({ startBank:'cib',bank:'hsbc',broker:'za',returnBank:'bochk',route:'USD',outcome:'cnh-card',hsbcBalanceWaiver:true });
  const html=subject.render(); const stock=html.indexOf('data-flow-stage="03"'), withdrawal=html.indexOf('aria-label="ZA Bank出金 → 中银香港"');
  const bank=html.indexOf('data-flow-stage="04"'), fx=html.indexOf('美元换人民币 → 消费');
  assert.ok(stock<withdrawal && withdrawal<bank && bank<fx);
  assert.match(section(html,'卖出后的资金'), /取回银行：中银香港/);
  assert.ok(html.indexOf('id="flow-live-summary"')<html.indexOf('id="flow-live-ledger"'));
});
test('stage losses precede compact components, which reconcile without duplicate sender fees', () => {
  for (const startBank of D.calculator.departureBanks) {
    const subject=ui({ startBank,bank:'bochk',broker:'za',route:'USD',mainlandMethod:startBank==='boc'?'boc-mobile':'swift',depositMethod:'chats',entryMiddleCny:0,outcome:'usd-balance',returnBank:'bochk',hsbcBalanceWaiver:true });
    const html=subject.render();
    for(const match of html.matchAll(/<section class="flow-edge"[^>]*>([\s\S]*?)<\/section>/g)) {
      const part=match[1]; assert.ok(part.indexOf('flow-edge-loss')<part.indexOf('flow-edge-title'));
      assert.ok(part.indexOf('flow-edge-loss')<part.indexOf('flow-fee-chip'));
      const total=Number(part.match(/class="flow-edge-loss">[\s\S]*?<small>([\d.]+) CNY<\/small>/)?.[1]);
      const prices=[...part.matchAll(/class="flow-fee-chip">[\s\S]*?<b>(?:参考 )?([\d.]+) CNY<\/b>/g)].map(m=>Number(m[1]));
      if(Number.isFinite(total)) assert.ok(Math.abs(prices.reduce((a,b)=>a+b,0)-total)<.011,startBank);
    }
    subject.act('detail','','edge-01'); assert.match(subject.modal(),/汇出手续费|手续费/); assert.match(subject.modal(), /source-link/);
  }
});
test('bank management conditions stay in bank nodes and toggling them does not alter preferred plans', () => {
  const subject=ui({ startBank:'cib',bank:'hsbc',broker:'za',mainlandMethod:'swift',depositMethod:'chats',outcome:'usd-balance',returnBank:'hsbc',hsbcBalanceWaiver:true });
  const before=subject.render(), initial=subject.result().selected;
  const node=section(before,'香港收款银行'); assert.match(node,/账户使用月数/); assert.match(node,/管理费/); assert.match(node,/10,000 HKD/);
  assert.doesNotMatch(node,/ZA交易权益/); assert.match(section(before,'买美股的账户'),/ZA交易权益/);
  subject.check('hsbcBalanceWaiver',false); const after=subject.render(), paid=subject.result().selected;
  assert.equal(toolbar(after),toolbar(before));
  assert.ok(paid.rows.find(row=>row.key==='account').cny>1000);
  assert.ok(paid.costCny>initial.costCny+1000);
  assert.equal((after.match(/data-money-check="hsbcBalanceWaiver"/g)||[]).length,1);
});
test('a valid coupon covers current buy and sell fees while bank fees remain unchanged by account months', () => {
  const input={ startBank:'boc',bank:'bochk',broker:'chief',route:'USD',outcome:'broker-balance',months:12,sellDate:'2027-09-12',
    useVoucher:true,voucherUsd:100,voucherOrders:100,voucherScope:'both',voucherExpiry:'2026-11-12' };
  const subject=ui(input);subject.render();const actual=subject.result().selected;
  assert.ok(actual.trading.orders.every(order=>order.netPlatform===0));
  const ordinary=ui({...input,useVoucher:false});ordinary.render();const base=ordinary.result().selected;
  for(const key of ['sender','entryFx','entryMiddle','entryInward','depositBank','depositOther','depositBroker'])
    assert.equal(actual.rows.find(row=>row.key===key).cny,base.rows.find(row=>row.key===key).cny,key);
  subject.act('detail','','offers');assert.doesNotMatch(subject.modal(),/券已过期/);
  subject.act('detail','','edge-trade');
  assert.equal((subject.modal().match(/买入美股 · 1笔/g)||[]).length,1);
  assert.equal((subject.modal().match(/卖出美股 · 1笔/g)||[]).length,1);
  const original=JSON.stringify(actual.trading);
  const display=M.displayedTradingFees(actual.trading);
  assert.equal(display.orders.reduce((sum,order)=>sum+Math.round(order.discount*10000),0),Math.round(display.discountUsd*10000));
  assert.equal(JSON.stringify(actual.trading),original);
});
