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

function setup(method, { weights = [30, 30], start = '2014-01-02', end = '2024-01-02', fee = .1, forbidden = [] } = {}) {
  const config = { positions: [{ id: 'us:USD', weight: weights[0] }, { id: 'us:TQQQ', weight: weights[1] }],
    currency: 'CNY', initial: 100000, monthly: 0, initialMethod: method, contributionMethod: 'dca_month',
    rebalance: 'none', transactionFee: fee, years: 'custom', start, end,
    benchmarkId: '', tax: { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20 } };
  const calls = [], downloads = [], accounts = [], runs = [];
  // The real account and fee engine runs once. Historical snapshot windows are
  // a separate model concern and would repeat the same integration work here.
  const model = { ...P, simulate(input) { const result = P.simulate(input);
    runs.push(result);
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
    card: (title, subtitle, body, controls = '', foot = '') => '<section><h2>' + title + '</h2><p>' + subtitle + '</p>' + controls + body + foot + '</section>',
    stat: (label, value, unit, note = '') => '<article>' + label + ' ' + value + ' ' + (unit || '') + ' ' + note + '</article>',
    lazyRows: (key, rows, render) => rows.map(render).join(''), loadFooter: () => '', resetList() {}, toast() {},
    download: (...args) => downloads.push(args), render: () => ui.view(helpers) };
  const view = () => ui.view(helpers);
  view();
  const action = (name, value) => ui.handleAction({ dataset: { action: 'portfolio-' + name, value } });
  const selectMethod = value => ui.handleAction({ dataset: { action: 'portfolio-select', field: 'initialMethod', value } });
  return { ui, view, action, selectMethod, calls, downloads, accounts, runs };
}

test('scoring families expose only their implemented reserve branches and run the exact saved rule', async () => {
  const u = setup('opportunity_discount_20', { weights: [0, 30], start: '2014-01-02', end: '2014-02-04', fee: 0 });
  const selected = id => u.view().includes('data-value="' + id + '" aria-pressed="true"');
  const familyMenu = () => u.view().match(/<summary id="portfolio-initialMethod"[^]*?<\/details>/)[0];
  assert.ok(selected('opportunity_discount_20'), 'a saved 20% rule restores the correct branch');
  assert.match(familyMenu(), /本金投入方式：低位评分加仓/);
  assert.doesNotMatch(familyMenu(), /opportunity_discount_\d+|opportunity_mixed_\d+|预留/);
  await u.selectMethod('discount');
  assert.ok(selected('opportunity_discount_20'), 'choosing the same family preserves its active branch');
  for (const [method, firstBuy, threshold] of [['opportunity_discount_10', 27000, 35], ['opportunity_discount_20', 24000, 50]]) {
    await u.action('reserve-branch', method);
    assert.ok(selected(method)); const n = u.runs.length;
    await u.action('run'); const r = u.runs[n];
    assert.equal(r.config.initialMethod, method);
    assert.equal(r.curve[0].positionPrincipal, firstBuy);
    assert.equal(r.systematic.daily[0].metadata.opportunity.threshold, threshold);
    await u.action('tab', 'settings');
  }
  await u.selectMethod('mixed');
  assert.match(familyMenu(), /本金投入方式：低位与恐慌评分加仓/);
  assert.match(u.view(), /首笔股票预算预留<\/span><strong>10%（35 分起买）/);
  assert.doesNotMatch(u.view(), /data-action="portfolio-reserve-branch"/);
  const n = u.runs.length;
  await u.action('run'); assert.equal(u.runs[n].config.initialMethod, 'opportunity_mixed_10');
  await u.action('tab', 'settings'); await u.selectMethod('dual_risk_guard');
  assert.doesNotMatch(u.view(), /首笔股票预算预留|data-action="portfolio-reserve-branch"/);
});

test('draft strategy changes keep the last successful ledger visible until the selected strategy completes', async () => {
  const forbidden = [], u = setup('dual_risk_guard', {weights: [0, 30], start: '2010-02-11', end: '2010-06-30', fee: 0, forbidden});
  await u.action('run');
  const original = u.runs[0];
  assert.equal(original.curve[0].positionPrincipal, 30000);
  const results = [];
  for (const [method, name, principal, reserve, threshold] of [
    ['opportunity_discount_10', '低位评分加仓·10%预留', 27000, 3000, 35],
    ['opportunity_discount_20', '低位评分加仓·20%预留', 24000, 6000, 50]
  ]) {
    const previous = results.at(-1) || original, previousName = P.strategyNames(previous.config).initial;
    await u.action('tab', 'settings'); await u.selectMethod(method); await u.action('tab', 'results');
    const lastRun = () => {
      const html = u.view();
      assert.match(html, /当前显示上次模拟结果/);
      assert.match(html, /portfolio-result-summary/);
      assert.match(html, /data-portfolio-plot/);
      assert.match(html, /重新模拟并导出 PDF/);
      assert.ok(html.includes('<dt>上次模拟策略</dt><dd><strong class="portfolio-run-strategy">' + previousName));
      assert.ok(html.includes(money(previous.profit)));
      assert.ok(!html.includes('class="portfolio-run-strategy">' + name));
    };
    lastRun();
    const count = u.downloads.length;
    for (const action of ['export-result', 'export-holdings', 'export-daily']) await u.action(action);
    assert.equal(u.downloads.length, count + 3);
    assert.ok(u.downloads[count][1].includes(previous.config.initialMethod));
    assert.ok(!u.downloads[count][1].includes(method));
    // The previous strategy's 30,000 / 27,000 stays attached to its own configuration, even after failure.
    forbidden.push('data/portfolio/entry-context.json');
    const attempts = u.runs.length;
    await u.action('run'); assert.match(u.view(), /role="alert"/);
    lastRun();
    assert.equal(u.runs.length, attempts);
    forbidden.pop();
    const n = u.runs.length;
    await u.action('run');
    const r = u.runs[n]; results.push(r);
    assert.equal(r.systematic.method, method);
    assert.equal(r.transactions.find(t => t.reason === 'initial').amount, principal);
    assert.equal(r.curve[0].positionPrincipal, principal);
    assert.equal(r.systematic.daily[0].metadata.opportunity.threshold, threshold);
    assert.deepEqual(r.systematic.daily[0].indicators.map(i => i.id), ['us:TQQQ']);
    const report = Pdf.layout(Pdf.snapshot(r, catalog), {measureText: s => ({ width: [...s].length * 10 })});
    const text = report.ops.filter(op => op.type === 'text').map(op => op.value).join('');
    assert.ok(text.includes('QQQ美元复权价、VIX/VIX3M · 买入门槛 ' + threshold + ' 分'));
    assert.ok(u.view().includes('class="portfolio-run-strategy">' + name));
    assert.ok(u.view().includes('<dt>首日实际持仓</dt><dd><span>' + money(principal) + ' 元'));
    assert.ok(u.view().includes('待加仓现金 ' + money(reserve) + ' 元'));
    assert.ok(u.view().includes(money(r.profit)));
  }
  assert.notEqual(results[0].value, results[1].value);
  assert.notEqual(results[0].annualReturn, results[1].annualReturn);
  assert.notEqual(...results.map(r => r.transactions.find(t => t.reason === r.systematic.method && t.side === 'buy').day));
  // If the selected rule changes during a data refresh, retain the last matching successful ledger.
  const n = u.runs.length;
  await u.action('tab', 'settings'); await u.selectMethod('opportunity_discount_10');
  const inflight = u.action('run');
  await u.selectMethod('opportunity_discount_20'); await inflight;
  await u.action('tab', 'results');
  assert.equal(u.runs.length, n);
  assert.ok(u.view().includes('<dt>首日实际持仓</dt><dd><span>24,000.00 元'));
});

for (const [method, weights] of [['opportunity_discount_10', [30, 30]], ['opportunity_discount_20', [20, 40]], ['opportunity_mixed_10', [40, 20]]]) {
  test(method + ' exposes real first buys, expandable score calculations and separate budget exports', async () => {
    const u = setup(method, { weights }), before = u.view();
    const visiblePlan = before.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    assert.match(visiblePlan, /USD待加现金/);
    await u.action('run');
    const account = u.accounts[0]; assert.equal(account.error, undefined);
    assert.ok(account.systematic.daily.length >= 2500);
    const initialOrders = account.transactions.filter(t => t.reason === 'initial');
    assert.equal(initialOrders.length, 2);
    for (const order of initialOrders) {
      const code = order.id === 'us:USD' ? 'USD ETF' : 'TQQQ';
      assert.ok(visiblePlan.includes('<dt>买' + code + '</dt><dd>' + money(order.amount) + ' 元</dd>'), 'the visible first quote matches the actual fee-funded order');
    }
    for (const id of ['us:USD', 'us:TQQQ', 'us:QQQ', 'us:SOXX']) assert.ok(u.calls.includes(historyUrl(id)), id);
    assert.ok(u.calls.includes('data/portfolio/entry-context.json'));
    assert.doesNotMatch(u.view(), /<h2>每日加仓分数/);
    await u.action('result-tab', 'daily');
    const html = u.view(), start = html.indexOf('<h2>每日加仓分数');
    assert.ok(start > 0);
    const card = html.slice(start, html.indexOf('</section>', start));
    const detail = card.match(/<details\b([^>]*)><summary>本日分数与买入金额怎么算<\/summary>([\s\S]*?)<\/details>/);
    assert.ok(detail, 'score inputs and formula are accessible through the disclosure');
    assert.doesNotMatch(detail[1], /\bopen\b/);
    const calculation = detail[2];
    assert.doesNotMatch(calculation, /NaN|undefined|—|\[object Object\]/);
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
    await u.action('result-tab', 'daily');
    assert.match(u.view(), /<h2>每日加仓分数/);
  }
});

test('reserve 20% chart export records actual holdings, not transferred capital or the timing permission', async () => {
  const u = setup('opportunity_discount_20', { weights: [50, 50], end: '2014-02-03' });
  await u.action('run');
  const account = u.accounts[0], first = account.curve[0];
  const securities = account.transactions.filter(t => t.day === first.day && t.side === 'buy').reduce((s, t) => s + t.amount, 0);
  assert.equal(first.contributed, 100000);
  const a = P.accountAllocation(first);
  assert.ok(Math.abs(a.securitiesValue - securities) < 1e-8);
  assert.ok(Math.abs(a.securitiesPct - 80) < 1e-9 && Math.abs(a.cashPct - 20) < 1e-9);
  await u.action('export-result');
  const [, csv] = u.downloads.at(-1);
  const fields = line => [...line.matchAll(/"((?:[^"]|"")*)"(?=,|$)/g)].map(m => m[1]);
  const [header, row] = csv.split('\r\n', 2).map(fields);
  const get = name => Number(row[header.indexOf(name)]);
  assert.equal(get('累计转入本金（含现金）CNY'), 100000);
  const buyFees = account.transactions.filter(t => t.day === first.day && t.side === 'buy').reduce((s, t) => s + t.fee, 0);
  assert.ok(Math.abs(get('持仓本金（不含现金）CNY') - (securities + buyFees)) < 1e-8);
  assert.equal(get('实际证券仓位%'), a.securitiesPct);
  assert.equal(get('实际现金占比%'), a.cashPct);
  assert.equal(get('实际证券市值CNY'), a.securitiesValue);
  assert.equal(get('账户现金CNY'), first.cash);
  assert.ok(Math.abs(get('加仓策略待加现金CNY') - first.cash) < 1e-8);
});

test('other strategy evidence loads on demand; a failed reference can retry without rerunning or changing the account', async () => {
  const soxx = historyUrl('us:SOXX'), forbidden = [soxx], vix = 'data/portfolio/entry-context.json';
  const u = setup('lump_sum', { end: '2014-02-03', forbidden });
  await u.action('run');
  const account = u.accounts[0], ledger = JSON.stringify(account);
  const count = path => u.calls.filter(p => p === path).length;
  assert.equal(count(soxx), 0); assert.equal(count(vix), 0);
  await u.action('chart-chooser');
  await u.action('chart-references');
  assert.equal(count(soxx), 1); assert.equal(count(vix), 1);
  assert.match(u.view(), /SOXX/);
  forbidden.length = 0;
  await u.action('chart-references');
  await u.action('chart-references');
  assert.equal(count(soxx), 2); assert.equal(count(vix), 1);
  assert.equal(u.accounts.length, 1); assert.equal(JSON.stringify(account), ledger);
});
