const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../assets/portfolio-model.js');
const M = require('../assets/model.js');
const Pdf = require('../assets/portfolio-pdf.js');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const catalogContext = {};
vm.runInNewContext(read('data/portfolio/catalog.js'), catalogContext);
const catalog = catalogContext.PORTFOLIO_CATALOG;
const historyUrl = id => catalog.assets.find(a => a.id === id).historyUrl;
const money = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function setup(method, { weights = [30, 30], end = '2024-01-02', forbidden = [] } = {}) {
  const config = { positions: [{ id: 'us:USD', weight: weights[0] }, { id: 'us:TQQQ', weight: weights[1] }],
    currency: 'CNY', initial: 100000, monthly: 0, initialMethod: method, contributionMethod: 'dca_month',
    rebalance: 'none', transactionFee: .1, years: 'custom', start: '2014-01-02', end,
    benchmarkId: '', tax: { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20 } };
  const calls = [], downloads = [], accounts = [];
  // The real account and fee engine runs once. Historical snapshot windows are
  // a separate model concern and would repeat the same integration work here.
  const model = { ...P, simulate(input) { const result = P.simulate(input);
    if (input.config.initialMethod === method) accounts.push(result); return result;
  }, simulateWindows: () => [] };
  const context = { window: { Changheng: M, ChanghengPortfolioModel: model, ChanghengPortfolioPdf: Pdf,
    PORTFOLIO_CATALOG: catalog }, localStorage: { getItem: () => JSON.stringify(config), setItem() {} },
    document: { getElementById: () => null, querySelectorAll: () => [] }, TextEncoder,
    fetch: async url => { calls.push(url); if (forbidden.includes(url)) throw new Error('unconfigured evidence must not be fetched: ' + url);
      return { ok: true, text: async () => read(url) }; } };
  vm.createContext(context); vm.runInContext(read('assets/portfolio.js'), context);
  const ui = context.window.ChanghengPortfolio;
  const helpers = { esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    action: (label, action, cls, extra = '') => '<button data-action="' + action + '" ' + extra + '>' + label + '</button>',
    annual: true, annualControl: '', pct: (n, digits = 2) => Number(n).toFixed(digits) + '%', pc: String, money,
    card: (title, subtitle, body) => '<section><h2>' + title + '</h2><p>' + subtitle + '</p>' + body + '</section>',
    stat: (label, value, unit, note = '') => '<article>' + label + ' ' + value + ' ' + (unit || '') + ' ' + note + '</article>',
    lazyRows: (key, rows, render) => rows.map(render).join(''), loadFooter: () => '', resetList() {}, toast() {},
    download: (...args) => downloads.push(args), render: () => ui.view(helpers) };
  const view = () => ui.view(helpers);
  view();
  const action = name => ui.handleAction({ dataset: { action: 'portfolio-' + name } });
  return { ui, view, action, calls, downloads, accounts };
}

for (const [method, weights] of [['opportunity_discount_10', [30, 30]], ['opportunity_discount_20', [20, 40]], ['opportunity_mixed_10', [40, 20]]]) {
  test(method + ' exposes real first buys, visible score calculations and separate budget exports', async () => {
    const u = setup(method, { weights }), before = u.view();
    assert.match(before, /这笔钱怎么投入/);
    assert.match(before, /USD待加现金/);
    await u.action('run');
    const account = u.accounts[0]; assert.equal(account.error, undefined);
    assert.ok(account.systematic.daily.length >= 2500);
    const initialOrders = account.transactions.filter(t => t.reason === 'initial');
    assert.equal(initialOrders.length, 2);
    for (const order of initialOrders) {
      const code = order.id === 'us:USD' ? 'USD ETF' : 'TQQQ';
      assert.ok(before.includes('<dt>买' + code + '</dt><dd>' + money(order.amount) + ' 元</dd>'), 'first quote matches the actual fee-funded order');
    }
    for (const id of ['us:USD', 'us:TQQQ', 'us:QQQ', 'us:SOXX']) assert.ok(u.calls.includes(historyUrl(id)), id);
    assert.ok(u.calls.includes('data/portfolio/entry-context.json'));
    const html = u.view(), start = html.indexOf('<h2>每日加仓分数');
    assert.ok(start > 0);
    const card = html.slice(start, html.indexOf('<h2>', start + 5));
    const calculation = card.slice(card.indexOf('本日分数与买入金额怎么算'), card.indexOf('<div class="portfolio-daily-history">'));
    assert.ok(calculation.length > 200);
    assert.doesNotMatch(calculation, /<details|NaN|undefined|—|\[object Object\]/);
    assert.match(calculation, /分数代入/);
    assert.match(card, /历史研究规则，非胜率/);
    for (const item of account.systematic.daily.at(-1).indicators) {
      assert.equal(item.kind, 'buy_score');
      assert.ok(card.includes('<strong>' + money(item.value) + ' 分</strong>'));
      assert.ok(!card.includes('<strong>' + money(item.value) + '%</strong>'));
    }
    const ledger = JSON.stringify({ value: account.value, contributed: account.contributed, deposits: account.deposits, transactions: account.transactions });
    u.ui.handleInput({ id: 'portfolio-addition-budget', value: '12345.67', dataset: { portfolioField: 'indicator-budget' } });
    await u.action('export-daily');
    const [name, csv] = u.downloads.at(-1);
    assert.match(name, /逐日加仓分数/); assert.match(csv, /budgetInput/); assert.match(csv, /12345\.67/);
    assert.match(u.view(), /预算试算，不计入回测年化/);
    assert.equal(JSON.stringify({ value: account.value, contributed: account.contributed, deposits: account.deposits, transactions: account.transactions }), ledger);
    assert.equal(account.contributed, 100000); assert.equal(account.deposits, 1);
  });
}

test('unconfigured legs never require their proxy history; USD-only discount also does not fetch VIX', async () => {
  for (const [method, weights, excluded, needsVix] of [
    ['opportunity_discount_10', [60, 0], ['us:TQQQ', 'us:QQQ'], false],
    ['opportunity_discount_10', [0, 60], ['us:USD', 'us:SOXX'], true],
    ['opportunity_mixed_10', [60, 0], ['us:TQQQ', 'us:QQQ'], true]
  ]) {
    const forbidden = excluded.map(historyUrl);
    if (!needsVix) forbidden.push('data/portfolio/entry-context.json');
    const u = setup(method, { weights, end: '2014-02-03', forbidden });
    await u.action('run');
    assert.equal(u.accounts[0]?.error, undefined); assert.ok(u.accounts[0]?.curve.length > 0);
    assert.ok(forbidden.every(url => !u.calls.includes(url)));
    assert.equal(u.calls.includes('data/portfolio/entry-context.json'), needsVix);
    assert.match(u.view(), /每日加仓分数/);
  }
});
