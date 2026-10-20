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

test('Payment Connect participants support CNH/HKD but never a USD transfer', () => {
  for (const startBank of D.calculator.departureBanks) for (const bank of D.calculator.hkBanks) {
    for (const route of ['CNH', 'HKD']) assert.ok(M.calculatorChannels({ ...base, startBank, bank, route }, D).mainlandMethods.includes('payment-connect'));
    assert.ok(!M.calculatorChannels({ ...base, startBank, bank, route: 'USD' }, D).mainlandMethods.includes('payment-connect'));
  }
  assert.match(run({ route: 'USD', mainlandMethod: 'payment-connect' }).error, /不支持美元/);
});
test('Payment Connect waiver is a named condition, isolated from ordinary wire fees and overrides', () => {
  for (const startBank of D.calculator.departureBanks) for (const bank of ['bochk', 'hsbc', 'hang']) {
    const r = run({ startBank, bank, mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true, count: 3 }).selected;
    assert.ok(r, startBank + bank);
    for (const key of ['sender', 'entryMiddle', 'entryInward']) close(row(r, key).cny, 0);
    close(r.steps.hongKong, 100000); assert.match(row(r, 'sender').estimate, /豁免/);
    assert.equal(r.rankable, false);
    assert.ok(r.requirements.some(x => x.includes('单笔、每日')));
  }
  const unknown = run({ mainlandMethod: 'payment-connect', paymentConnectFeeWaived: false }).selected;
  assert.equal(row(unknown, 'sender').cny, null); close(row(unknown, 'entryInward').cny, 0);
  assert.ok(row(unknown, 'entryInward').sources.includes('paymentHsbcReceive'));
  const other = run({ bank: 'bochk', mainlandMethod: 'payment-connect', paymentConnectFeeWaived: false }).selected;
  assert.equal(row(other, 'entryInward').cny, null);
  const paid = run({ mainlandMethod: 'payment-connect', paymentConnectFeeWaived: true, count: 2, senderFeeCny: 5, entryInwardHkd: 10 }).selected;
  close(row(paid, 'sender').cny, 10); close(row(paid, 'entryInward').cny, 20 * paid.refs.HKD);
  close(row(run({ paymentConnectFeeWaived: true }).selected, 'sender').cny, 100 + (100000 - 100) / 1.001 * .001);
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
  assert.deepEqual(M.calculatorChannels({ ...base, broker: 'ibkr-lite', route: 'USD' }, D).depositMethods, ['swift']);
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
