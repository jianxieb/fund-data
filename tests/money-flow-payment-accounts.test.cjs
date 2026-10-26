const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261012.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const base = { ...config, date: '2026-10-21', sellDate: '2026-10-21', count: 1,
  startBank: 'cib', bank: 'hsbc', returnBank: 'bochk', exitBank: 'boc', broker: 'ibkr',
  route: 'CNH', mainlandMethod: 'swift', depositMethod: 'fps', fxMode: 'manual', outcome: 'broker-balance' };
const run = changes => M.calculatorJourney(M.calculatorRoute({ ...base, ...changes }), D, Q);
const row = (r, key) => r.rows.find(x => x.key === key);
function ui(input = {}, quotes = Q, date = '2026-10-21') {
  let saved = { bankFeeDefaultsVersion: 1, consumptionVersion: 2, ibkrFundingVersion: 1, ...input }, modal = '';
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

test('Payment Connect participants support CNH/HKD but never a USD transfer', () => {
  for (const startBank of D.calculator.departureBanks) for (const bank of D.calculator.hkBanks) {
    for (const route of ['CNH', 'HKD']) assert.ok(M.calculatorChannels({ ...base, startBank, bank, route }, D).mainlandMethods.includes('payment-connect'));
    assert.ok(!M.calculatorChannels({ ...base, startBank, bank, route: 'USD' }, D).mainlandMethods.includes('payment-connect'));
  }
  assert.match(run({ route: 'USD', mainlandMethod: 'payment-connect' }).error, /不支持美元/);
});
test('Payment Connect never turns missing sender or receiving tariffs into zero through the retired waiver', () => {
  for (const startBank of ['cib', 'cmb', 'icbc']) for (const bank of ['bochk', 'hsbc', 'hang']) {
    for (const paymentConnectFeeWaived of [true, false, undefined]) {
      const r = run({ startBank, bank, mainlandMethod: 'payment-connect', paymentConnectFeeWaived, count: 3 }).selected;
      assert.ok(r, startBank + bank);
      assert.equal(row(r, 'sender').cny, null);
      close(row(r, 'entryMiddle').cny, 0);
      assert.equal(row(r, 'entryInward').cny, bank === 'bochk' ? null : 0);
      assert.equal(r.complete, false); assert.equal(r.rankable, false);
      assert.ok(r.requirements.some(x => x.includes('银行单笔、累计')));
    }
  }
  const paid = run({ mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true, count: 2, senderFeeCny: 5, entryInwardHkd: 10 }).selected;
  close(row(paid, 'sender').cny, 10); close(row(paid, 'entryInward').cny, 20 * paid.refs.HKD);
  close(row(run({ paymentConnectFeeWaived: true }).selected, 'sender').cny, 100 + (100000 - 100) / 1.001 * .001);
});
test('BOC RMB Payment Connect uses a dated regional reference and actual charges take precedence', () => {
  const config = { ...base, startBank: 'boc', mainlandMethod: 'payment-connect' };
  const reference = M.paymentConnectFeeReference(config, D);
  assert.equal(reference.feeCny, 0); assert.deepEqual(reference.currencies, ['CNH']);
  assert.deepEqual(reference.sources, ['bocMobile2026']); assert.match(reference.estimate, /山西中行2026-05-29/);
  for (const changes of [{ route: 'HKD' }, { startBank: 'cib' }, { date: '2026-05-28' }, { mainlandMethod: 'swift' }]) {
    assert.equal(M.paymentConnectFeeReference({ ...config, ...changes }, D), null);
  }
  for (const paymentConnectFeeWaived of [true, false, undefined]) {
    const r = run({ ...config, paymentConnectFeeWaived }).selected;
    close(row(r, 'sender').cny, 0); assert.equal(row(r, 'sender').estimate, reference.estimate);
    assert.equal(row(r, 'sender').items[0].estimate, reference.estimate);
    assert.deepEqual(row(r, 'sender').sources, reference.sources);
  }
  const otherBank = run({ ...config, bank: 'bochk', paymentConnectFeeWaived: true }).selected;
  assert.equal(row(otherBank, 'entryInward').cny, null);
  const actual = run({ ...config, count: 2, senderFeeCny: 7 }).selected;
  close(row(actual, 'sender').cny, 14); assert.equal(row(actual, 'sender').estimate, undefined);
});
test('retired Payment Connect defaults are removed without changing principal or actual charges', () => {
  const subject = ui({ ...base, budgetCny: 250000, mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true,
    senderFeeCny: 7, entryInwardHkd: 10 });
  assert.equal(Object.hasOwn(subject.saved(), 'paymentConnectFeeWaived'), false);
  assert.equal(subject.saved().budgetCny, 250000); assert.equal(subject.saved().senderFeeCny, 7); assert.equal(subject.saved().entryInwardHkd, 10);
  assert.doesNotMatch(subject.render(), /已享跨境支付通手续费豁免|data-money-check="paymentConnectFeeWaived"/);
  subject.act('preset', '', 'cnh-ibkr');
  assert.equal(Object.hasOwn(subject.saved(), 'paymentConnectFeeWaived'), false);
  assert.equal(subject.saved().budgetCny, 250000);
  assert.match(section(subject.render(), '汇往香港'), /跨境支付通本次汇出服务费<\/span><b>参考 0\.00 CNY/);
  subject.act('detail', '', 'edge-01'); assert.match(subject.modal(), /山西中行2026-05-29/);
  assert.match(subject.modal(), /app\.xinhuanet\.com/);
});
test('Payment Connect HKD uses a separately labelled reference or actual rate, never a standard bank ask', () => {
  const r = run({ mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true, route: 'HKD' }).selected;
  close(r.steps.hongKong, 100000 / r.refs.HKD);
  assert.equal(r.indicativeEntryFx, true); assert.equal(row(r, 'entryFx').cny, null);
  assert.equal(r.quotedCore, false); assert.equal(r.rankable, false);
  close(r.netCny, r.budgetCny - r.costCny + r.fxImpactCny);
  const actual = run({ mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true, route: 'HKD', startSell: .9 }).selected;
  close(actual.steps.hongKong, 100000 / .9); assert.equal(actual.indicativeEntryFx, false);
});
test('IBKR Pro and Lite are distinct accounts with distinct funding and the correct commission', () => {
  assert.ok(D.calculator.brokers.includes('ibkr-lite'));
  const pro = run({ route: 'USD', depositMethod: 'chats' }).selected;
  const lite = run({ broker: 'ibkr-lite', route: 'USD', depositMethod: '' }).selected;
  assert.equal(lite.broker.id, 'ibkr-lite'); assert.equal(lite.depositMethod, 'swift');
  assert.ok(lite.trading.buyFeeUsd < pro.trading.buyFeeUsd);
  assert.equal(row(lite, 'depositOther').cny, null);
  assert.deepEqual(M.calculatorChannels({ ...base, broker: 'ibkr-lite', route: 'USD' }, D).depositMethods, ['swift', 'wise']);
  for (const depositMethod of ['chats', 'fps', 'edda']) assert.match(run({ broker: 'ibkr-lite', route: 'USD', depositMethod }).error, /美国USD收款指示/);
});
test('legacy Lite state migrates the account and clears inapplicable Pro funding quotes without moving banks', () => {
  const subject = ui({ ...base, route: 'USD', broker: 'ibkr', ibkrPricing: 'lite', depositMethod: 'chats', depositHkd: 0, depositOtherCny: 0 });
  let html = subject.render();
  assert.equal(subject.saved().broker, 'ibkr-lite'); assert.equal(subject.saved().depositMethod, 'swift');
  assert.equal(subject.saved().depositHkd, ''); assert.equal(subject.saved().depositOtherCny, '');
  assert.equal(subject.saved().bank, 'hsbc'); assert.equal(subject.saved().returnBank, 'bochk');
  assert.match(section(html, '买美股的账户'), /IBKR Lite/);
  assert.doesNotMatch(section(html, '转入买股账户'), /香港收款指示|CHATS|FPS|eDDA/);
  subject.act('choose', 'broker', 'ibkr'); html = subject.render();
  assert.equal(subject.saved().ibkrPricing, 'fixed'); assert.match(section(html, '买美股的账户'), /IBKR Pro/);
  assert.match(section(html, '转入买股账户'), /香港收款指示/);
  assert.doesNotMatch(html, /data-money-select="ibkrPricing"/);
});
test('dated USD and HKD quotes retain numeric bank and brokerage balances with their historical basis', () => {
  for (const route of ['USD', 'HKD']) {
    const subject = ui({ ...base, route, depositMethod: route === 'USD' ? 'chats' : 'fps' });
    const html = subject.render();
    for (const label of ['香港收款银行', '买美股的账户']) {
      const node = section(html, label); assert.match(node, /<b class="num">[\d,.]+/);
      assert.doesNotMatch(node, /<b>—/); assert.match(node, /历史报价 2026-10/);
    }
    assert.match(html.split('id="flow-live-summary"')[1], /参考最终余额/);
  }
});
test('CNH manual conversion shows reference USD while AutoFX retains original CNH until purchase', () => {
  for (const fxMode of ['manual', 'auto']) {
    const subject = ui({ ...base, fxMode }); const html = subject.render(); const node = section(html, '买美股的账户');
    assert.match(node, /<b class="num">[\d,.]+/); assert.doesNotMatch(node, /<b>—/);
    assert.match(node, fxMode === 'manual' ? /参考汇率估算 · 缺换汇成交价/ : /CNH/);
    assert.match(html, /IBKR CNH\/USD成交价尚未取得/);
    assert.match(html.split('id="flow-live-summary"')[1], /参考最终余额/);
  }
});
test('absent source prices keep genuinely uncomputable balances unavailable', () => {
  const q = structuredClone(Q); delete q.banks.cib.quotes.USD;
  const html = ui({ ...base, route: 'USD', depositMethod: 'chats' }, q).render();
  assert.match(section(html, '香港收款银行'), /<b>—/); assert.match(html, /现汇卖出价尚未取得/);
});

test('Lite can receive CNH/HKD by wire and convert at IBKR with manual or purchase-time FX', () => {
  for (const route of ['CNH', 'HKD']) for (const fxMode of ['manual', 'auto']) {
    const input = { broker: 'ibkr-lite', route, fxMode, depositMethod: 'swift' };
    const result = run(input), r = result.selected;
    assert.ok(r, result.error); assert.equal(r.fxMode, fxMode);
    assert.ok(r.steps.brokerOriginal > 0); assert.ok(r.steps.fundedUsd > 0);
    assert.equal(r.steps.hkConvertedUsd, undefined);
    assert.equal(row(r, 'brokerSpread').cny, null);
    assert.equal(row(r, 'depositOther').cny, null);
    assert.equal(row(r, 'brokerFx').step, fxMode === 'auto' ? 'investment' : 'deposit');
    if (fxMode === 'manual') close(row(r, 'brokerFx').cny, 2 * r.refs.USD);
    const channels = M.calculatorChannels({ ...base, ...input }, D);
    assert.deepEqual(channels.fxModes, ['manual', 'auto', 'bank']);
    assert.deepEqual(channels.depositMethods, ['fps', 'edda', 'swift']);
    assert.match(run({ ...input, depositMethod: 'chats' }).error, /原币入金.*FPS、eDDA或SWIFT/);
    const ledger = M.flowLedger(r), brokerStop = ledger.stops.find(x => x.id === 'funding');
    assert.equal(brokerStop.currency, fxMode === 'auto' ? route : 'USD');
    close(r.netCny, r.budgetCny - r.costCny + r.fxImpactCny);
  }
});

test('Lite FX picker can leave the formerly forced bank mode and persist all three modes', () => {
  for (const route of ['CNH', 'HKD']) {
    const subject = ui({ ...base, broker: 'ibkr-lite', route, fxMode: 'bank', depositMethod: 'swift', entryPrice: 9 });
    subject.render();
    subject.act('pick', '', 'fxMode');
    for (const label of ['IBKR手动换汇', 'IBKR现金账户自动换汇', '汇丰 HSBC One换汇']) assert.ok(subject.modal().includes(label), label);
    for (const fxMode of ['manual', 'auto', 'bank']) {
      subject.act('choose', 'fxMode', fxMode);
      let html = subject.render();
      assert.equal(subject.saved().fxMode, fxMode); assert.equal(subject.saved().entryPrice, '');
      assert.equal(subject.saved().bank, 'hsbc'); assert.equal(subject.saved().startBank, 'cib');
      assert.equal(subject.result().selected.fxMode, fxMode);
      const reopened = ui(subject.saved()); html = reopened.render();
      assert.equal(reopened.result().selected.fxMode, fxMode);
      const node = section(html, '买美股的账户');
      assert.match(node, /<b class="num">[\d,.]+/); assert.doesNotMatch(node, /<b>—/);
      if (fxMode === 'auto') assert.match(node, new RegExp(route));
      if (fxMode === 'manual') assert.match(node, /参考汇率估算 · 缺换汇成交价/);
    }
    subject.act('choose', 'fxMode', 'auto'); subject.render();
    for (const broker of ['ibkr', 'ibkr-lite']) {
      subject.act('choose', 'broker', broker); subject.render();
      assert.equal(subject.saved().fxMode, 'auto'); assert.equal(subject.saved().bank, 'hsbc');
      assert.equal(subject.result().selected.fxMode, 'auto');
    }
  }
});

test('legacy Lite preserves broker conversion while USD-only venues remain bank-conversion routes', () => {
  for (const fxMode of ['manual', 'auto']) {
    const subject = ui({ ...base, ibkrPricing: 'lite', fxMode }); subject.render();
    assert.equal(subject.saved().broker, 'ibkr-lite'); assert.equal(subject.saved().fxMode, fxMode);
    assert.equal(subject.saved().depositMethod, 'fps'); assert.equal(subject.result().selected.fxMode, fxMode);
  }
  for (const broker of ['firstrade', 'schwab']) {
    const r = run({ broker, fxMode: 'manual', depositMethod: '' }).selected;
    assert.equal(r.fxMode, 'bank'); assert.ok(r.steps.hkConvertedUsd > 0);
  }
});

test('Lite offers original CNH/HKD FPS and eDDA without changing the principal or FX mode', () => {
  const current = require('./fixtures/money-flow-quotes-20261025.json');
  const preferred = M.calculatorPreferredPlans(D, current, '2026-10-25')[0].config;
  for (const route of ['CNH', 'HKD']) for (const fxMode of ['manual', 'auto']) for (const depositMethod of ['fps', 'edda']) {
    const input = { ...preferred, broker: 'ibkr-lite', ibkrPricing: 'lite', route, fxMode, depositMethod,
      budgetCny: 250000, outcome: 'broker-balance', withdrawCurrency: 'USD' };
    const result = M.calculatorJourney(input, D, current), r = result.selected;
    assert.ok(r, result.error); assert.equal(r.depositMethod, depositMethod);
    close(r.budgetCny, 250000); assert.equal(r.fxMode, fxMode);
    for (const key of ['depositBank', 'depositOther', 'depositBroker']) close(row(r, key).cny, 0);
    if (route === 'CNH') {
      close(r.steps.hongKong, 250000); close(r.steps.brokerOriginal, 250000);
      close(r.steps.fundedUsd, fxMode === 'manual' ? 250000 / 6.67006 - 2 : 250000 / 6.67006 / 1.0003);
    }
    close(r.netCny, r.budgetCny - r.costCny + r.fxImpactCny);
    const subject = ui(input, current, '2026-10-25'); subject.render();
    subject.act('pick', '', 'depositMethod');
    for (const label of ['FPS', 'eDDA', 'SWIFT']) assert.ok(subject.modal().includes(label), label);
    for (const broker of ['ibkr', 'ibkr-lite']) {
      subject.act('choose', 'broker', broker); subject.render();
      assert.equal(subject.saved().depositMethod, depositMethod);
      assert.equal(subject.saved().budgetCny, 250000); assert.equal(subject.saved().bank, 'hsbc');
      assert.equal(subject.saved().fxMode, fxMode);
    }
    const reopened = ui(subject.saved(), current, '2026-10-25'); reopened.render();
    assert.equal(reopened.saved().depositMethod, depositMethod); assert.equal(reopened.saved().budgetCny, 250000);
  }
});

test('old forced Lite wire migrates once while preserving principal and saved execution prices', () => {
  for (const route of ['CNH', 'HKD']) {
    const input = { ...base, broker: 'ibkr-lite', route, budgetCny: 250000, fxMode: 'manual', depositMethod: 'swift',
      entryPrice: 6.7, depositHkd: 70, depositOtherCny: 50, ibkrFundingVersion: undefined };
    const subject = ui(input); subject.render();
    assert.equal(subject.saved().depositMethod, 'fps'); assert.equal(subject.saved().ibkrFundingVersion, 1);
    assert.equal(subject.saved().budgetCny, 250000); assert.equal(subject.saved().entryPrice, 6.7);
    assert.equal(subject.saved().bank, 'hsbc'); assert.equal(subject.saved().returnBank, 'bochk');
    assert.equal(subject.saved().depositHkd, ''); assert.equal(subject.saved().depositOtherCny, '');
    subject.act('choose', 'depositMethod', 'swift'); subject.render();
    const reopened = ui(subject.saved()); reopened.render();
    assert.equal(reopened.saved().depositMethod, 'swift'); assert.equal(reopened.saved().budgetCny, 250000);
  }
  const usd = ui({ ...base, broker: 'ibkr-lite', route: 'USD', depositMethod: 'swift', ibkrFundingVersion: undefined });
  usd.render(); assert.equal(usd.saved().depositMethod, 'swift');
});


test('R167 preferred first route keeps RMB intact until IBKR and exposes the unpriced execution spread', () => {
  const plans = M.calculatorPreferredPlans(D, Q, '2026-10-12'), plan = plans[0], r = plan.calculated.selected;
  assert.equal(plan.id, 'cnh-ibkr'); assert.equal(plan.config.route, 'CNH');
  assert.equal(plan.config.broker, 'ibkr'); assert.equal(plan.config.fxMode, 'manual');
  assert.equal(plan.config.depositMethod, 'fps'); assert.equal(plan.config.mainlandMethod, 'payment-connect');
  close(r.steps.hongKong, 100000); close(r.steps.brokerOriginal, 100000);
  assert.equal(r.steps.hkConvertedUsd, undefined); assert.equal(row(r, 'brokerSpread').cny, null);
  close(row(r, 'brokerFx').cny, 2 * r.refs.USD); assert.equal(r.complete, false); assert.equal(r.rankable, false);
  assert.ok(r.costCny < plans.slice(1).map(p => p.calculated.selected.costCny).reduce((a,b) => Math.min(a,b)));
  const subject = ui({ broker: 'ibkr-lite', route: 'CNH', fxMode: 'bank', entryPrice: 7, depositHkd: 88, useVoucher: true });
  subject.render(); subject.act('preset', '', plan.id); const saved = subject.saved();
  assert.equal(saved.broker, 'ibkr'); assert.equal(saved.fxMode, 'manual'); assert.equal(saved.depositHkd, ''); assert.equal(saved.entryPrice, '');
  const header = toolbar(subject.render());
  assert.match(header, /人民币原币/); assert.match(header, /人民币换美元/);
  assert.match(header, /已计费用/); assert.match(header, /IBKR CNH\/USD实时成交点差/); assert.match(header, /支付通限经常项目/);
  assert.equal(ui(saved).saved().fxMode, 'manual');
});

test('every preferred plan applies its complete consumption route and reproduces all quoted costs independently', () => {
  const plans = M.calculatorPreferredPlans(D, Q, '2026-10-12');
  const subject = ui({ budgetCny: 100000, outcome: 'broker-balance', withdrawDestination: 'mainland',
    withdrawCurrency: 'USD', returnBank: 'ccb-asia', brokerExitPrice: 8, exitPrice: 9, inwardHkd: 90, returnExtraCny: 600 }, Q, '2026-10-12');
  subject.render();
  for (const plan of plans) {
    subject.act('preset', '', plan.id);
    const actual = subject.result().selected, expected = plan.calculated.selected;
    assert.ok(actual, plan.id);
    assert.ok(['cnh-card', 'mainland'].includes(subject.saved().outcome), plan.id);
    close(actual.costCny, expected.costCny);
    assert.deepEqual(actual.rows.map(x => [x.key, x.cny]), expected.rows.map(x => [x.key, x.cny]));
    assert.ok(row(actual, 'withdraw'), plan.id);
    assert.ok(row(actual, 'card') || row(actual, 'exitFx'), plan.id);
    if (subject.saved().withdrawCurrency === 'CNH') assert.ok(row(actual, 'brokerExitCommission').cny > 0);
    assert.deepEqual(actual.missing, expected.missing);
    if (['cnh-ibkr', 'cib-wise-ibkr'].includes(plan.id)) assert.ok(row(actual, 'brokerExitFx').cny == null, 'Absent IBKR snapshot stays explicit');
    else assert.ok(actual.complete && actual.rows.some(x => x.estimate), 'Authorized estimates remain labelled');
  }
  const header = toolbar(subject.render());
  const route = id => header.split('data-value="' + id + '"')[1].split('</button>')[0];
  const roles = id => [...route(id).matchAll(/data-route-role="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(roles('cib-wise-ibkr'), ['startBank', 'bank', 'bridge', 'broker', 'returnBank', 'consumption']);
  assert.deepEqual(roles('boc-ibkr'), ['startBank', 'bank', 'broker', 'returnBank', 'exitBank', 'consumption']);
  for (const plan of plans) assert.equal(roles(plan.id).at(-1), 'consumption');
  assert.doesNotMatch(route('cib-wise-ibkr'), /账户内留美元|USD入金 · 账户内/);
});

test('payment limits separate direction, bank evidence and CNY principal even when receiving HKD', () => {
  const subject = ui({ ...base, budgetCny: 100000, count: 1, route: 'HKD', mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true });
  const html = subject.render();
  assert.match(html, /本次约100000\.00 CNY\/笔/);
  assert.match(html, /超过公开操作参考的单笔1万元/);
  subject.act('detail', '', 'quotes');
  const detail = subject.modal();
  assert.match(detail, /每人每家参与机构每日等值10,000 HKD、每年200,000 HKD/);
  assert.match(detail, /历史参考，不是四家银行现行统一承诺/);
  assert.match(detail, /现行支付通单笔／日／月统一公告/);
  assert.match(detail, /5个工作日/);
  for (const item of D.verificationReview.items) for (const key of item.sources) assert.ok(D.sources[key], key);
  for (const bank of ['hsbc', 'hang', 'za']) {
    const r = run({ bank, route: 'CNH', fxMode: 'manual', mainlandMethod: 'payment-connect', paymentConnectFeeWaived: false }).selected;
    assert.ok(r, bank); close(row(r, 'entryInward').cny, 0);
    assert.ok(row(r, 'entryInward').sources.length);
    assert.equal(row(r, 'sender').cny, null);
    assert.match(row(r, 'sender').status, /南向支付通现行服务费条款未取得/);
  }
});

test('R168 Wise offers USD bridging for Pro and Lite without removing direct or original-currency methods', () => {
  for (const broker of D.calculator.brokers) for (const bank of D.calculator.hkBanks) for (const route of D.calculator.currencies) {
    for (const fxMode of ['manual', 'bank']) {
      const available = M.calculatorChannels({ ...base, broker, bank, route, fxMode }, D).depositMethods;
      assert.equal(available.includes('wise'), ['ibkr', 'ibkr-lite'].includes(broker) && (route === 'USD' || fxMode === 'bank'));
    }
  }
  for (const broker of ['ibkr', 'ibkr-lite']) for (const route of ['CNH', 'HKD']) {
    assert.match(run({ broker, route, fxMode: 'manual', depositMethod: 'wise' }).error, /Wise桥接只提供/);
  }
  for (const broker of ['hsbc', 'za', 'chief', 'usmart', 'firstrade', 'schwab']) {
    assert.match(run({ broker, bank: broker === 'za' ? 'za' : 'hsbc', route: 'USD', depositMethod: 'wise' }).error, /Wise桥接只提供/);
  }
});

test('R168 each USD Wise leg costs 10 HKD, USD remains USD, with no direct SWIFT fee or repeated charge', () => {
  for (const broker of ['ibkr', 'ibkr-lite']) for (const bank of D.calculator.hkBanks) for (const count of [1, 3]) {
    const r = run({ broker, bank, route: 'USD', depositMethod: 'wise', count, entryMiddleCny: 0, hsbcBalanceWaiver: true }).selected;
    assert.ok(r, broker + bank);
    for (const key of ['depositBank', 'depositOther']) {
      close(row(r, key).cny, 10 * r.refs.HKD);
      assert.equal(row(r, key).nativeCurrency, 'HKD'); assert.match(row(r, key).estimate, /用户提供/);
    }
    close(row(r, 'depositBroker').cny, 0); close(row(r, 'brokerFx').cny, 0);
    close(r.steps.wiseUsd, r.steps.hongKong - 10 * r.refs.HKD / r.refs.USD);
    close(r.steps.fundedUsd, r.steps.hongKong - 20 * r.refs.HKD / r.refs.USD);
    close(r.netCny, r.budgetCny - r.costCny - r.taxCny + r.fxImpactCny);
    assert.equal(r.rankable, false); assert.match(r.requirements.join(' '), /Transfer from Wise Balance/);
  }
});

test('Wise accepts bank-converted USD and actual leg quotes, and insufficient balances stay explicit', () => {
  const converted = run({ route: 'CNH', mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true,
    fxMode: 'bank', entryPrice: 7, depositMethod: 'wise' }).selected;
  close(converted.steps.fundedUsd, converted.steps.hkConvertedUsd - 20 * converted.refs.HKD / converted.refs.USD);
  const actual = run({ route: 'USD', depositMethod: 'wise', depositHkd: 25, depositOtherCny: 13 }).selected;
  close(row(actual, 'depositBank').cny, 25 * actual.refs.HKD); close(row(actual, 'depositOther').cny, 13);
  assert.ok(!row(actual, 'depositBank').estimate); assert.ok(!row(actual, 'depositOther').estimate);
  close(actual.steps.fundedUsd, actual.steps.hongKong - (25 * actual.refs.HKD + 13) / actual.refs.USD);
  const empty = run({ startBank: 'boc', bank: 'bochk', budgetCny: 10, route: 'USD', mainlandMethod: 'boc-mobile', depositMethod: 'wise' });
  assert.match(empty.error, /余额不足/); assert.ok(!empty.selected);
});

test('Wise UI shows both HKD charges, accepts both plans, persists reloads and preserves independent accounts', () => {
  const subject = ui({ ...base, broker: 'ibkr-lite', route: 'USD', depositMethod: 'swift' }, Q, '2026-10-12');
  subject.render(); subject.act('choose', 'depositMethod', 'wise');
  let html = subject.render(), saved = subject.saved();
  assert.equal(saved.bank, 'hsbc'); assert.equal(saved.broker, 'ibkr-lite'); assert.equal(saved.depositMethod, 'wise');
  assert.match(html, /美元 → 本人Wise → IBKR/); assert.match(html, /Wise参考到账/);
  assert.match(html, /按参考情景计算的余额/); assert.doesNotMatch(html, /按公布参考价费计算的余额/);
  assert.equal((section(html, '美元 → 本人Wise → IBKR').match(/10.00 HKD/g) || []).length, 2);
  const reloaded = ui(saved); reloaded.render(); assert.equal(reloaded.saved().depositMethod, 'wise');
  subject.act('detail', '', 'edge-03'); assert.match(subject.modal(), /Transfer from Wise Balance/);
  assert.match(subject.modal(), /data-money-field="depositHkd"/); assert.match(subject.modal(), /data-money-field="depositOtherCny"/);
  assert.doesNotMatch(subject.modal(), /须通过SWIFT国际电汇/);
  subject.act('choose', 'bank', 'bochk'); assert.equal(subject.saved().depositMethod, 'wise'); assert.equal(subject.saved().broker, 'ibkr-lite');
  subject.act('choose', 'broker', 'ibkr'); assert.equal(subject.saved().depositMethod, 'wise'); assert.equal(subject.saved().bank, 'bochk');
  subject.act('choose', 'route', 'CNH'); assert.equal(subject.saved().depositMethod, 'fps'); assert.equal(subject.saved().fxMode, 'manual');
  subject.act('preset', '', 'cib-wise-ibkr'); html = subject.render(); saved = subject.saved();
  assert.equal(saved.depositMethod, 'wise'); assert.equal(saved.route, 'USD');
  assert.match(toolbar(html), /assets\/institutions\/wise.png/); assert.match(toolbar(html), /10 \+ 10 = 20 HKD/);
  subject.act('choose', 'broker', 'firstrade'); assert.equal(subject.saved().depositMethod, 'swift'); assert.equal(subject.saved().bank, 'hsbc');
});
