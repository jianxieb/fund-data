const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const quotes = require('./fixtures/money-flow-quotes-20261012.json');
const date = '2026-10-12';
function ui(input = {}) {
  let saved = { bankFeeDefaultsVersion: 1, consumptionVersion: 2, ...input }, modal = '';
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
const toolbar = html => html.split('id="flow-live-toolbar"')[1].split('id="flow-live-ledger"')[0];
const section = (html, label) => html.split('aria-label="' + label + '"')[1]?.split('</section>')[0];
test('IBKR CNH withdrawal and cash use expose separate controls, fees, cash and retained bank funds', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc', broker: 'ibkr', route: 'USD', mainlandMethod: 'swift', depositMethod: 'chats',
    outcome: 'atm', withdrawCurrency: 'CNH', brokerExitPrice: 6.7, inwardHkd: 0, intermediaryCny: 0 });
  const html = subject.render();
  assert.match(html, /IBKR换人民币 → CNH出金/);
  assert.match(html, /券商出金币种/); assert.match(html, /CNH出金渠道/);
  assert.match(html, /本次计划取现/); assert.match(html, /另有本次计划现金/);
  assert.match(html, /计划取现后的银行余额/);
  const action = section(html, '银行余额 → 内地ATM人民币现金');
  assert.match(action, /提款／联动费/); assert.doesNotMatch(action, /美元直接换人民币/);
  subject.act('detail', '', 'edge-withdraw');
  assert.match(subject.modal(), /每单最低2 USD/); assert.match(subject.modal(), /CNH\/USD/);
  subject.act('detail', '', 'edge-04');
  assert.match(subject.modal(), /本人已启用的每日限额/); assert.match(subject.modal(), /ATM单笔提款上限/);
});
test('missing IBKR exit FX never appears as a spendable CNH bank balance or cash result', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc', broker: 'ibkr', route: 'USD', mainlandMethod: 'swift', depositMethod: 'chats',
    outcome: 'atm', withdrawCurrency: 'CNH', brokerExitPrice: '', inwardHkd: 0 });
  const html = subject.render(), endpoint = section(html, '卖出后的资金');
  assert.match(endpoint, /— <small>CNH/); assert.match(html, /IBKR卖出后USD\/CNH实际成交价尚未取得/);
  assert.doesNotMatch(html, /另有本次计划现金/); assert.match(html, /最后可计余额.*IBKR/);
});
test('card, currency and return bank switches discard only the corresponding execution inputs', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc', broker: 'ibkr', outcome: 'atm', route: 'USD',
    withdrawCurrency: 'CNH', brokerExitPrice: 6.7, inwardHkd: 8, atmExtraCny: 2, atmCnyPerUnit: .9, atmDailyLimitCny: 10000 });
  subject.render(); subject.act('choose', 'returnBank', 'icbc-asia');
  assert.equal(subject.saved().bank, 'hsbc'); assert.equal(subject.saved().brokerExitPrice, 6.7);
  for (const key of ['atmExtraCny', 'atmCnyPerUnit', 'atmDailyLimitCny', 'inwardHkd']) assert.equal(subject.saved()[key], '');
  subject.act('choose', 'withdrawCurrency', 'USD'); assert.equal(subject.saved().brokerExitPrice, '');
  subject.act('choose', 'broker', 'schwab'); assert.equal(subject.saved().withdrawCurrency, 'USD');
});
test('direct mainland USD selection clears route confirmation and removes the fictitious Hong Kong return node', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', returnBank: 'sc', broker: 'ibkr', route: 'USD', outcome: 'mainland', exitBank: 'boc', mainlandMethod: 'swift', depositMethod: 'chats',
    directReceiptConfirmed: true, brokerExitPrice: 6.7, withdrawCurrency: 'CNH' });
  subject.render(); subject.act('choose', 'withdrawDestination', 'mainland');
  assert.equal(subject.saved().outcome, 'mainland-usd'); assert.equal(subject.saved().withdrawCurrency, 'USD');
  assert.equal(subject.saved().directReceiptConfirmed, false); assert.equal(subject.saved().returnBank, 'sc');
  const html = subject.render();
  assert.match(html, /内地美元收款银行/); assert.doesNotMatch(html, /data-flow-stage="05"/);
  assert.match(html, /出金可用性及收款银行/); assert.doesNotMatch(html, /aria-label="内地结汇"/);
  subject.check('directReceiptConfirmed', true); subject.act('choose', 'exitBank', 'icbc');
  assert.equal(subject.saved().directReceiptConfirmed, false);
  subject.act('choose', 'outcome', 'atm'); assert.equal(subject.saved().withdrawDestination, 'hong-kong');
  assert.equal(subject.saved().returnBank, 'sc');
});
test('BOCHK Apple Pay has a named UnionPay mode and consumes already-converted CNH without another FX leg', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', returnBank: 'bochk', broker: 'ibkr', route: 'USD', outcome: 'cnh-card',
    withdrawCurrency: 'CNH', brokerExitPrice: 6.7, inwardHkd: 0, cardMode: 'apple-pay' });
  const html = subject.render();
  assert.match(html, /人民币余额 → 银联卡Apple Pay消费/);
  assert.match(html, /Apple Pay须支持银联闪付/);
  assert.doesNotMatch(html, /美元直接换人民币 → 商户刷卡/);
  subject.act('detail', '', 'edge-04');
  assert.ok(subject.modal().includes(D.sources.bochkApplePay.url));
  assert.doesNotMatch(subject.modal(), /data-money-field="exitPrice"/);
});
test('BOCHK to mainland USD retains a bank node and transfer fee without an automatic CNY settlement', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', returnBank: 'bochk', exitBank: 'boc', broker: 'ibkr', route: 'USD', outcome: 'mainland-usd', mainlandMethod: 'swift', depositMethod: 'chats' });
  const html = subject.render();
  assert.match(html, /汇回内地 · 美元原币/); assert.match(html, /中银快汇/);
  assert.match(html, /美元现汇保留在内地账户/); assert.doesNotMatch(html, /aria-label="内地结汇"/);
  subject.act('pick', '', 'exitBank');
  assert.match(subject.modal(), /保留USD原币/); assert.doesNotMatch(subject.modal(), /结汇牌价|CNY\/USD/);
});
test('CIB RMB fee explanation distinguishes an original-currency wire from purchasing foreign currency', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', broker: 'hsbc', route: 'CNH', mainlandMethod: 'swift', outcome: 'broker-balance' });
  const entry = section(subject.render(), '汇往香港');
  assert.match(entry, /人民币原币电汇：寰宇人生外汇双免不适用/);
  assert.match(entry, /汇出手续费<\/span><b>99.80 CNY/);
  assert.match(entry, /汇出电讯费<\/span><b>100.00 CNY/);
  subject.act('detail', '', 'edge-01');
  assert.match(subject.modal(), /含费预算 100000.00 CNY ＝ 汇出本金 99800.20 CNY ＋ 本行汇款费用 199.80 CNY/);
  assert.match(subject.modal(), /VIP等级减免/);
  assert.ok(subject.modal().includes(D.sources.cib.url));
  assert.ok(subject.modal().includes(D.sources.cibCard.url));
  for (const currency of ['USD', 'HKD']) {
    subject.act('choose', 'route', currency);
    const html = section(subject.render(), '汇往香港');
    assert.doesNotMatch(html, /外汇双免不适用/);
    assert.match(html, /汇出手续费<\/span><b>0.00 CNY/);
    assert.match(html, /汇出电讯费<\/span><b>0.00 CNY/);
    assert.equal(subject.saved().bank, 'hsbc');
  }
});
test('new US broker pickers retain bank selections, show American wire instructions and recalculate withdrawal channels', () => {
  const subject = ui({ startBank: 'cib', bank: 'hsbc', broker: 'ibkr', returnBank: 'bochk', outcome: 'usd-balance',
    mainlandMethod: 'swift', depositMethod: 'chats', depositHkd: 0, depositOtherCny: 0, intermediaryCny: 0 });
  subject.render(); subject.act('pick', '', 'broker');
  for (const id of ['firstrade', 'schwab']) assert.ok(subject.modal().includes('data-field="broker" data-value="' + id + '"'));
  for (const id of ['firstrade', 'schwab']) {
    subject.act('choose', 'broker', id); const html = subject.render(), saved = subject.saved();
    assert.equal(saved.bank, 'hsbc'); assert.equal(saved.returnBank, 'bochk'); assert.equal(saved.depositMethod, 'swift');
    for (const key of ['depositHkd', 'depositOtherCny', 'intermediaryCny']) assert.equal(saved[key], '');
    assert.match(html, /美国收款账户 · USD SWIFT/);
    assert.ok(html.includes('assets/institutions/' + id + '.png'));
    subject.act('detail', '', 'edge-03'); assert.ok(subject.modal().includes(id === 'firstrade' ? D.sources.firstradeWire.url : D.sources.schwabWire.url));
    subject.act('detail', '', 'edge-withdraw'); assert.match(subject.modal(), /USD/);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
  assert.match(subject.render(), /网上提交 · 15 USD/);
  const online = subject.result().selected;
  subject.act('choose', 'brokerWireChannel', 'assisted');
  assert.match(subject.render(), /人工／表格 · 25 USD/);
  const assisted = subject.result().selected;
  assert.ok(Math.abs(assisted.costCny - online.costCny - 10 * online.refs.USD) < 1e-7);
  subject.act('choose', 'brokerWireChannel', 'invalid'); assert.equal(subject.saved().brokerWireChannel, 'assisted');
  subject.act('choose', 'outcome', 'broker-balance');
  assert.doesNotMatch(subject.render(), /出金渠道|人工／表格 · 25 USD/);
});
test('saved US brokers repair unsupported local funding without losing unrelated user inputs', () => {
  for (const broker of ['firstrade', 'schwab']) {
    const subject = ui({ startBank: 'cib', bank: 'hsbc', broker, route: 'HKD', mainlandMethod: 'swift', depositMethod: 'chats',
      depositHkd: 0, depositOtherCny: 0, entryPrice: 7.9, intermediaryCny: 12 });
    subject.render(); const saved = subject.saved();
    assert.equal(saved.broker, broker); assert.equal(saved.bank, 'hsbc'); assert.equal(saved.depositMethod, 'swift');
    assert.equal(saved.fxMode, 'bank'); assert.equal(saved.entryPrice, 7.9); assert.equal(saved.intermediaryCny, 12);
    assert.equal(saved.depositHkd, ''); assert.equal(saved.depositOtherCny, '');
  }
});
test('legacy generic RMB spending becomes a mainland bank endpoint once without replacing user accounts', () => {
  const subject = ui({ consumptionVersion: undefined, outcome: 'cnh-card', startBank: 'cib', bank: 'hsbc', broker: 'hsbc',
    returnBank: 'hsbc', exitBank: 'boc', exitPrice: 6.2, returnHkdPrice: 7.8, cardCnyPerHkd: .8 });
  const html = subject.render(), saved = subject.saved();
  assert.equal(saved.outcome, 'mainland'); assert.equal(saved.returnCurrency, 'USD'); assert.equal(saved.consumptionVersion, 2);
  for (const key of ['exitPrice', 'returnHkdPrice', 'cardCnyPerHkd']) assert.equal(saved[key], '');
  for (const [key, value] of Object.entries({ startBank: 'cib', bank: 'hsbc', broker: 'hsbc', returnBank: 'hsbc', exitBank: 'boc' })) assert.equal(saved[key], value);
  assert.match(html, /data-flow-stage="05"/); assert.doesNotMatch(html, /aria-label="美元换港币"/);
  subject.act('choose', 'outcome', 'cnh-card');
  const reloaded = ui(subject.saved()); reloaded.render(); assert.equal(reloaded.saved().outcome, 'cnh-card');
});
test('card payment choices name their coverage and clear FX overrides when the actual payment mechanism changes', () => {
  const subject = ui({ outcome: 'cnh-card', returnBank: 'icbc-asia', cardCnyPerHkd: .85, returnHkdPrice: 7.8 });
  let html = subject.render();
  assert.match(html, /港币扣账 · 银联/); assert.doesNotMatch(html, /data-money-check="icbcCnhAccount"/);
  assert.match(html, /不等同内地微信／支付宝余额/);
  subject.act('choose', 'cardMode', 'cnh'); html = subject.render();
  assert.match(html, /data-money-check="icbcCnhAccount"/);
  assert.equal(subject.saved().cardCnyPerHkd, ''); assert.equal(subject.saved().returnHkdPrice, '');
  subject.act('choose', 'cardMode', 'invalid'); assert.equal(subject.saved().cardMode, 'cnh');
  subject.act('choose', 'returnBank', 'ccb-asia'); html = subject.render();
  assert.match(html, /data-money-check="ccbLinkedCard"/);
  assert.match(html, /关联内地账户：中国建设银行/);
  assert.match(html, /不能推定微信、支付宝或个人收款码都能联动/);
  subject.check('ccbLinkedCard', true); subject.render(); subject.act('detail', '', 'cost');
  assert.match(subject.modal(), /龙卡.*年费/); assert.match(subject.modal(), /每个年费周期50 HKD/);
  assert.doesNotMatch(subject.modal(), /undefined|NaN/);
  subject.act('choose', 'outcome', 'mainland'); subject.act('choose', 'exitBank', 'ccb'); html = subject.render();
  assert.equal(subject.saved().exitBank, 'ccb'); assert.match(html, /data-flow-stage="05"/);
});
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
    assert.ok(actual, plan.id);
    assert.equal(actual.complete, plan.calculated.selected.complete, plan.id);
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
test('mainland receiving picker adds CCB for the return path and migrates only retired receiving-bank settings', () => {
  for (const exitBank of ['comm','hsbc','hang','sc','abc','missing']) {
    const subject = ui({ startBank:'cib',bank:'hsbc',broker:'chief',returnBank:'bochk',outcome:'mainland',exitBank,
      returnMethod:'linked',exitPrice:6.2,returnExtraCny:9,returnWireHkd:17,startSell:6.8,tradeFeeUsd:12,intermediaryCny:3 });
    subject.render(); const saved=subject.saved();
    assert.equal(saved.exitBank,'boc');
    for(const [key,value] of Object.entries({startBank:'cib',bank:'hsbc',broker:'chief',returnBank:'bochk',startSell:6.8,tradeFeeUsd:12,intermediaryCny:3}))
      assert.equal(saved[key],value,key);
    for(const key of ['exitPrice','returnExtraCny','returnWireHkd']) assert.equal(saved[key],'');
    subject.act('pick','','exitBank');
    const ids=[...subject.modal().matchAll(/data-field="exitBank" data-value="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(ids,['boc','cib','cmb','icbc','ccb']);
    subject.act('choose','exitBank',exitBank); assert.equal(subject.saved().exitBank,'boc');
  }
});
test('return transfer and settlement own separate fees, rates, details and sources in USD and HKD', () => {
  for(const returnCurrency of ['USD','HKD']) for(const exitBank of D.calculator.receivingBanks) {
    const subject=ui({startBank:'cib',bank:'hsbc',broker:'za',returnBank:'hsbc',outcome:'mainland',exitBank,route:'USD',returnCurrency,
      mainlandMethod:'swift',depositMethod:'chats',returnMethod:'swift',months:0});
    const html=subject.render(), wire=section(html,'汇回内地'), settlement=section(html,'内地结汇');
    assert.ok(wire&&settlement); assert.ok(html.indexOf('aria-label="汇回内地"')<html.indexOf('aria-label="内地结汇"'));
    assert.match(wire,/汇回手续费/); assert.match(wire,/中转费/); assert.match(wire,/本行收款费/);
    assert.doesNotMatch(wire,/结汇差额|1 (?:USD|HKD) =/);
    assert.match(settlement,/结汇差额/); assert.doesNotMatch(settlement,/汇回手续费|中转费|本行收款费/);
    assert.equal((settlement.match(new RegExp('1 '+returnCurrency+' =','g'))||[]).length,1);
    const receiver=section(html,'内地收款银行');
    assert.ok(html.indexOf('aria-label="汇回内地"')<html.indexOf('data-flow-stage="05"'));
    assert.ok(html.indexOf('data-flow-stage="05"')<html.indexOf('aria-label="内地结汇"'));
    const wrapper=receiver.split('class="flow-account-field"')[1];
    assert.ok(wrapper.indexOf('内地收款银行')<wrapper.indexOf('class="flow-account-button"'));
    assert.doesNotMatch(wrapper.split('class="flow-account-button"')[1].split('</button>')[0],/>内地收款银行</);
    assert.match(receiver,/微信／支付宝绑卡、刷卡、缴费及转账/);
    subject.act('detail','','edge-remit'); assert.match(subject.modal(),/香港→内地汇出费/); assert.doesNotMatch(subject.modal(),/内地结汇差额/);
    subject.act('detail','','edge-settle'); assert.match(subject.modal(),/内地结汇差额/); assert.doesNotMatch(subject.modal(),/香港→内地汇出费|回内地中转行费/);
    assert.equal((subject.modal().match(new RegExp('1 '+returnCurrency+' =','g'))||[]).length,1);
    assert.doesNotMatch(subject.modal(),/实际兑换顺序/);
    if(returnCurrency==='HKD') {
      assert.ok(html.indexOf('aria-label="美元换港币"')<html.indexOf('aria-label="汇回内地"'));
      subject.act('detail','','edge-return-fx'); assert.match(subject.modal(),/USD → HKD换汇差额/); assert.doesNotMatch(subject.modal(),/内地结汇差额/);
    } else assert.doesNotMatch(html,/aria-label="美元换港币"/);
  }
});
test('changing a downstream return currency never reallocates earlier displayed purchase or trading cents', () => {
  const base={startBank:'cib',bank:'hsbc',broker:'za',returnBank:'hsbc',exitBank:'cib',outcome:'mainland',route:'USD',
    mainlandMethod:'swift',depositMethod:'chats',returnMethod:'swift',months:12};
  const usd=ui({...base,returnCurrency:'USD'}).render(), hkd=ui({...base,returnCurrency:'HKD'}).render();
  for(const label of ['汇往香港','转入买股账户','买入美股 → 卖出','ZA Bank出金 → 汇丰 HSBC One'])
    assert.equal(section(usd,label),section(hkd,label),label);
});
test('purchase and settlement pickers quote actual rates without a competing relative-loss percentage', () => {
  const subject=ui({startBank:'cib',bank:'hsbc',broker:'za',returnBank:'hsbc',exitBank:'cib',outcome:'mainland',route:'USD',returnCurrency:'USD'});
  subject.render(); subject.act('pick','','startBank');
  assert.match(subject.modal(),/最低可比购汇价/); assert.doesNotMatch(subject.modal(),/购汇少得|相对损耗|系数/);
  subject.act('detail','','quotes');
  assert.match(subject.modal(),/购汇、香港换汇和结汇均按同一组参考汇率/);
  assert.doesNotMatch(subject.modal(),/最优购汇差额为0|最低有效卖出价为基准/);
});
test('Hong Kong banks and stock venues remain complete and enabled after plan application and manual changes', () => {
  const subject = ui(); subject.render(); subject.act('preset', '', 'cib-trade25');
  for (const [key, expected] of [['bank', D.calculator.hkBanks], ['returnBank', D.calculator.returnBanks], ['broker', D.calculator.brokers]]) {
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
  subject.act('detail','','budget');
  assert.match(subject.modal(), /人民币本金 · 含费用/);
  assert.doesNotMatch(subject.modal(), /flow-budget-presets|人民币本金快捷金额/);
});
test('withdrawal is between the stock account and return bank, before bank FX or spending', () => {
  const subject = ui({ startBank:'cib',bank:'hsbc',broker:'za',returnBank:'bochk',route:'USD',outcome:'cnh-card',hsbcBalanceWaiver:true });
  const html=subject.render(); const stock=html.indexOf('data-flow-stage="03"'), withdrawal=html.indexOf('aria-label="ZA Bank出金 → 中银香港"');
  const bank=html.indexOf('data-flow-stage="04"'), fx=html.indexOf('美元直接换人民币 → 商户刷卡');
  assert.ok(stock<withdrawal && withdrawal<bank && bank<fx);
  assert.match(section(html,'卖出后的资金'), /取回银行：中银香港/);
  assert.ok(html.indexOf('id="flow-live-summary"')>html.indexOf('id="flow-live-ledger"'));
  const unfinished=ui({startBank:'boc',bank:'bochk',broker:'ibkr',route:'CNH',fxMode:'manual',outcome:'mainland',mainlandMethod:'swift',depositMethod:'fps',returnBank:'bochk',exitBank:'boc',returnMethod:'boc-express'}).render();
  const terminal=section(unfinished,'资金终点');
  assert.match(terminal,/最后可计账户[\s\S]*IBKR/);
  assert.doesNotMatch(terminal,/<strong>中国银行<\/strong>/);
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
  const ownFee=ui({startBank:'cib',bank:'hsbc',broker:'za',route:'USD',outcome:'usd-balance',returnBank:'bochk',returnMonthlyHkd:50,hsbcBalanceWaiver:true,mainlandMethod:'swift',depositMethod:'chats',returnMethod:'swift'});
  const end=section(ownFee.render(),'卖出后的资金');
  assert.match(end,/银行管理费[\s\S]*已计本人实际期间费用/);
  assert.doesNotMatch(end,/此账户免管理费/);
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
