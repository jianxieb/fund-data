const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../assets/portfolio-model.js');
const M = require('../assets/model.js');
const Pdf = require('../assets/portfolio-pdf.js');

function fixture() {
  const days = [];
  for (let t = Date.parse('2024-01-01'); t <= Date.parse('2026-01-08'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const assets = [
    { id: 'us:TWO', code: 'TWO', name: '两倍测试ETF', kind: 'etf', leverage: 2 },
    { id: 'stock:TEST', code: 'TEST', name: '测试公司', kind: 'stock' },
    { id: 'fund:ZERO', code: 'ZERO', name: '零权重仍应完整收录的基金', kind: 'fund' }
  ].map(a => ({ ...a, status: 'available', currency: 'CNY', first: days[0], asOf: days.at(-1), sourceUrl: 'https://example.org/' + a.code, historyUrl: 'data/portfolio/stock/' + a.code + '.json' }));
  const histories = Object.fromEntries(assets.map((a, k) => [a.id, { schemaVersion: 1, id: a.id,
    currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1),
    series: days.map((day, i) => [day, 100 * Math.exp(i * (k ? .0004 : .0007)) * (1 + .06 * Math.sin(i / 21 + k))]) }]));
  const config = { positions: [{ id: assets[0].id, weight: 47.12345678 }, { id: assets[1].id, weight: 42.87654322 }, { id: assets[2].id, weight: 0 }],
    initial: 100000, monthly: 3000, rebalance: 'quarter', transactionFee: .025, feeBasis: 'net', years: 'common', benchmarkId: assets[0].id };
  const input = { catalog: { schemaVersion: 1, assets, fx: { id: 'fx:CNY', currency: 'CNY', status: 'available' }, summary: { total: assets.length } }, histories, config };
  const result = P.simulate(input);
  assert.equal(result.error, undefined);
  result.snapshots = P.simulateWindows(input, result.end);
  return { input, result };
}
const measure = { font: '', measureText(value) { const size = Number(this.font.match(/ (\d+)px/)[1]); return { width: Array.from(String(value)).reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 1 : .58), 0) * size }; } };
const textOf = document => document.ops.filter(op => op.type === 'text').map(op => op.value).join('\n');

test('opportunity output identifies rule points, raw calculations and cash-limited buys', () => {
  const item = { id: 'us:TQQQ', label: 'TQQQ加仓分数', kind: 'buy_score', value: 65 };
  assert.equal(Pdf.dailyDisplay(item).value, '65.00 分');
  assert.match(Pdf.dailyDisplay(item).basis, /不是胜率/);
  const row = { status: 'ready', currency: 'CNY', metadata: { opportunity: {
    family: 'mixed', reserve: .1, threshold: 35, formula: '100 × (0.4D + 0.3S + 0.15F + 0.15R)',
    legs: [{ id: 'us:TQQQ', proxyId: 'us:QQQ', score: 76.625, inputs: { price: 80, high252: 100, ma252: 90,
      stretch: 80 / 90, rankGreater: 800, rankEqual: 0, rankCount: 1000, vix: 25, vixPeak63: 40,
      fearBelow: 750, fearCount: 1000, vixDay: '2024-01-02' }, components: { D: .8, S: .8, F: .75, R: .625 },
      weights: { D: .4, S: .3, F: .15, R: .15 }, availableCash: 3000, intensity: 51.625 / 75, buyAmount: 2065 / 1.001 }]
  } }, nextPlan: { orders: [{ id: 'us:TQQQ', side: 'buy', amount: 2065 / 1.001 }] } };
  const text = Pdf.explainDaily(row).flat().join('\n');
  for (const value of ['800个较高', '750 个 ÷ 1000', '63次VIX峰值=40', '阈值 35 分', '68.833333%', '下一共同收盘买入TQQQ']) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /NaN|undefined|持有开关/);
  row.nextPlan = null;
  assert.match(Pdf.explainDaily(row).flat().join(' '), /没有待加仓现金，即使高分也不会买入/);
});

test('PDF freezes the result and matching catalog, retaining zero-weight configuration', () => {
  const { input, result } = fixture();
  const report = Pdf.snapshot(result, input.catalog, '2026-10-08T00:00:00Z');
  const before = JSON.stringify(report);
  result.config.initial = 1; result.curve[0].value = 1; result.snapshots[0].profit = 1;
  input.catalog.assets[0].name = 'changed'; input.config.positions[0].weight = 1;
  assert.equal(JSON.stringify(report), before);
  assert.equal(report.result.config.positions.length, 3);
  assert.equal(report.assets.length, 3);
  assert.throws(() => Pdf.snapshot({ error: 'history failed' }, input.catalog), /先完成/);
});

test('PDF includes actual strategy results, precise fee and weights, all curves and missing windows', () => {
  const { input, result } = fixture();
  const document = Pdf.layout(Pdf.snapshot(result, input.catalog), measure), text = textOf(document);
  for (const value of ['0.025%', '47.12345678%', '42.87654322%', '零权重仍应完整收录的基金', '0.00（未投入）',
    '一次性投入', '每月定投', '本金投入方式', '持续投入方式', '每季度', '策略年化收益', '累计投入收益', '近3年', '近5年', '两倍测试ETF']) assert.ok(text.includes(value), value);
  for (const window of result.snapshots.filter(s => s.error)) assert.ok(text.includes(window.error));
  const displayPct = n => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  for (const h of result.holdings) for (const key of ['annualReturn', 'totalReturn', 'mdd', 'volatility']) assert.ok(text.includes(displayPct(h.performance[key])), key);
  assert.ok(result.rebalances > 0 && result.deposits > 1);
  assert.equal(document.ops.filter(op => op.type === 'path').length, 7);
  assert.ok(document.ops.filter(op => op.type === 'path').every(op => op.points.length === result.curve.length && op.points.flat().every(Number.isFinite)));
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
  assert.ok(document.ops.every(op => op.y + op.h <= document.height));
});

test('long names and maximum funding fit their report bounds; all positions reach the bottom', () => {
  const { input, result } = fixture();
  result.config.initial = 1e12; result.value = 9876543210987.65; result.contributed = 9999999999999.99;
  for (let i = 0; i < 350; i++) {
    const id = 'fund:LONG' + i;
    result.config.positions.push({ id, weight: 0 });
    input.catalog.assets.push({ id, code: 'LONG' + i, kind: 'fund', name: '这是很长的基金产品名称用于检查换行和超长组合末行没有截断' + i });
  }
  const document = Pdf.layout(Pdf.snapshot(result, input.catalog), measure), text = textOf(document);
  assert.ok(text.includes('LONG349'));
  assert.ok(document.height > 14400 / (720 / document.width));
  for (const op of document.ops.filter(op => op.type === 'text')) {
    measure.font = op.weight + ' ' + op.size + 'px Arial';
    const w = measure.measureText(op.value).width;
    const left = op.align === 'right' ? op.x - w : op.align === 'center' ? op.x - w / 2 : op.x;
    assert.ok(left >= 0 && left + w <= document.width, op.value);
  }
});

test('single-page PDF has binary-safe xref offsets, contiguous bands and correct long-page units', () => {
  const content = { width: 1120, height: 30000, links: [{ x: 48, y: 29500, w: 200, h: 40, url: 'https://example.org/a?q=(one)' }] };
  const bands = [{ top: 0, logicalHeight: 15000, width: 2240, height: 30000, bytes: Uint8Array.from([255, 216, 128, 255, 217]) },
    { top: 15000, logicalHeight: 15000, width: 2240, height: 30000, bytes: Uint8Array.from([255, 216, 0, 255, 217]) }];
  const bytes = Buffer.from(Pdf.assemble(content, bands)), raw = bytes.toString('latin1');
  assert.match(raw, /^%PDF-1\.6/); assert.match(raw, /\/Count 1\b/); assert.match(raw, /\/UserUnit 2\b/);
  assert.match(raw, /\/MediaBox \[0 0 360 9642\.857143\]/);
  const start = Number(raw.match(/startxref\n(\d+)/)[1]);
  assert.equal(bytes.subarray(start, start + 4).toString(), 'xref');
  const entries = raw.slice(start).split('\n');
  const count = Number(entries[1].split(' ')[1]);
  for (let id = 1; id < count; id++) {
    const offset = Number(entries[2 + id].slice(0, 10));
    assert.equal(bytes.subarray(offset, offset + String(id).length + 6).toString(), id + ' 0 obj');
  }
  assert.match(raw, /q 360 0 0 4821\.428571 0 4821\.428571 cm \/B0 Do Q/);
  assert.match(raw, /q 360 0 0 4821\.428571 0 0 cm \/B1 Do Q/);
  assert.match(raw, /\/Rect \[15\.428571 147\.857143 79\.714286 160\.714286\]/);
  assert.ok(raw.includes('/URI (https://example.org/a?q=\\(one\\))'));
  assert.ok(raw.includes('/Title <feff957f88617ec454086a2162df62a5544a>'));
  for (const band of bands) assert.ok(bytes.includes(Buffer.from(band.bytes)));
});

function uiFixture(configure, model = P) {
  const { input } = fixture(), downloads = [], notices = [], reports = [], renderStates = [];
  if (configure) configure(input);
  const context = { window: { Changheng: M, ChanghengPortfolioModel: model, PORTFOLIO_CATALOG: input.catalog,
    ChanghengPortfolioPdf: { ...Pdf, snapshot: Pdf.snapshot, async create(report) { reports.push(report); return new Blob(['PDF']); } } },
    localStorage: { getItem: () => JSON.stringify(input.config), setItem() {} },
    document: { getElementById: () => null, querySelectorAll: () => [] }, TextEncoder,
    fetch: async url => ({ ok: true, text: async () => url === 'data/portfolio/catalog.js' ? 'var PORTFOLIO_CATALOG=' + JSON.stringify(input.catalog) + ';' : JSON.stringify(Object.values(input.histories).find(h => input.catalog.assets.find(a => a.id === h.id).historyUrl === url)) }) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../assets/portfolio.js'), 'utf8'), context);
  const ui = context.window.ChanghengPortfolio;
  const helpers = { esc: String, action: (label, act, cls, extra = '') => '<button data-action="' + act + '" ' + extra + '>' + label + '</button>',
    annual: true, annualControl: '', pct: String, pc: String, money: String, card: (title, subtitle, html) => '<section><h2>' + title + '</h2><p>' + subtitle + '</p>' + html + '</section>',
    stat: (label, value, unit, note) => '<article class="stat"><strong>' + label + '</strong><b>' + value + '</b><small>' + note + '</small></article>', lazyRows: (key, rows, render) => rows.map(render).join(''), loadFooter: () => '', resetList() {},
    toast: message => notices.push(message), download: (...args) => downloads.push(args),
    render: () => renderStates.push(ui.view(helpers)) };
  ui.view(helpers);
  const action = (name, extras = {}) => ui.handleAction({ dataset: { action: 'portfolio-' + name, ...extras } });
  const monthly = value => ui.handleInput({ id: 'portfolio-monthly', value: String(value), dataset: { portfolioField: 'monthly' } });
  return { ui, action, section: value => action('result-tab', { value }), monthly, context, helpers, downloads, notices, reports, renderStates, input };
}

test('a dividend policy selected in holdings reaches the simulated cash ledger, exported configuration, PDF and sales CSV', async () => {
  const f = uiFixture(input => {
    Object.assign(input.config, { monthly: 0, rebalance: 'none', transactionFee: 0, tax: P.taxConfig() });
    for (const h of Object.values(input.histories)) h.dividendEvidence = { status: 'recorded', first: h.first, through: h.asOf,
      fractions: h.id === 'us:TWO' ? { '2025-02-03': .05 } : {} };
  });
  assert.doesNotMatch(f.ui.view(f.helpers), /分红处理/);
  await f.action('tab', {value: 'holdings'});
  assert.match(f.ui.view(f.helpers), /data-value="reinvest" aria-pressed="true"/);
  await f.action('dividend-policy', {value: 'cash'});
  await f.action('save'); assert.equal(JSON.parse(f.downloads.at(-1)[1]).dividendPolicy, 'cash');
  await f.action('run'); await f.section('holdings'); await f.action('export-pdf');
  const report = f.reports.at(-1), r = report.result, html = f.ui.view(f.helpers);
  const control = P.simulate(f.input);
  assert.ok(r.cashDividends > 0 && control.cashDividends === 0);
  assert.ok(Math.abs(r.cash - control.cash - r.cashDividends) < 1e-7);
  assert.equal(r.contributed, control.contributed);
  assert.match(html, /累计现金分红/); assert.doesNotMatch(html, /已减浮盈预留税/);
  const reportText = textOf(Pdf.layout(report, measure));
  assert.match(reportText, /分红计入账户现金/); assert.match(reportText, /累计税后现金分红/);
  await f.action('export-holdings');
  const [head, first] = f.downloads.at(-1)[1].split(/\r?\n/).slice(0, 2).map(line => line.split('","').map(field => field.replace(/^\uFEFF?"|"$|^"/g, '')));
  assert.equal(Number(first[head.indexOf('累计卖出净回款CNY')]), 0);
  assert.equal(Number(first[head.indexOf('累计税后现金分红CNY')]), r.cashDividends);
});

test('changing the chart benchmark preserves the simulated ledger, dirty draft and zoom; missing evidence affects only the comparison', async () => {
  let runs = 0, account, modal;
  const model = { ...P, simulate(input) { runs++; account = P.simulate(input); return account; } };
  const f = uiFixture(input => {
    const history = input.histories['fund:ZERO'];
    history.series = history.series.slice(90); history.first = history.series[0][0];
    input.catalog.assets[2].first = history.first;
  }, model);
  f.helpers.openModal = html => { modal = html; }; f.helpers.modalTitle = title => '<h2>' + title + '</h2>';
  const view = () => f.ui.view(f.helpers);
  await f.action('run'); assert.equal(runs, 1);
  await f.action('chart-zoom', { value: '3' });
  const saved = JSON.stringify([account.curve, account.transactions, account.value, account.start, account.end]);
  const zoomRow = view().match(/data-portfolio-field="chart-from"[^>]+value="([^"]+)"/)[1];
  await f.action('tab', {value:'settings'}); f.monthly(4001);
  await f.action('tab', {value:'results'}); await f.action('benchmark');
  assert.match(modal, /搜索对照标的/); assert.match(modal, /取消并返回/); assert.match(modal, /不设对照/);
  assert.equal(account.config.benchmarkId, 'us:TWO', 'opening the picker must not change the active benchmark');
  await f.action('select-benchmark', { value: 'stock:TEST' });
  assert.equal(account.benchmark.id, 'stock:TEST');
  assert.deepEqual(account.benchmark, P.simulate({ ...f.input, config: { ...f.input.config, benchmarkId: 'stock:TEST' } }).benchmark);
  assert.equal(account.config.monthly, 3000);
  assert.ok(account.snapshots.filter(w => !w.error).every(w => w.config.benchmarkId === 'stock:TEST' && w.benchmark.id === 'stock:TEST'));
  assert.match(view(), /上次模拟结果/);
  assert.equal(view().match(/data-portfolio-field="chart-from"[^>]+value="([^"]+)"/)[1], zoomRow);
  assert.match(view(), /对照：测试公司/);
  await f.action('select-benchmark', {value:'fund:ZERO'});
  assert.equal(account.benchmark, null); assert.match(account.benchmarkError, /不覆盖组合区间/);
  assert.ok(account.snapshots.find(w => w.years === 1).benchmark, 'a covered short snapshot can still compare');
  await f.action('no-benchmark'); assert.equal(account.benchmarkError, null);
  assert.match(view(), /添加对照标的/);
  assert.ok(account.snapshots.filter(w => !w.error).every(w => !w.config.benchmarkId && !w.benchmark && !w.benchmarkError));
  assert.equal(JSON.stringify([account.curve, account.transactions, account.value, account.start, account.end]), saved);
  await f.action('save'); const draft = JSON.parse(f.downloads.at(-1)[1]);
  assert.equal(draft.monthly, 4001); assert.equal(draft.benchmarkId, '');
  assert.equal(runs, 1, 'comparison changes must not execute account strategies again');
});

test('clearing a benchmark during a slow history download keeps the chart and exported report cleared', async () => {
  const f = uiFixture(), fetch = f.context.fetch;
  await f.action('run');
  let release;
  f.context.fetch = async (url, ...args) => {
    if (url.endsWith('ZERO.json')) await new Promise(resolve => { release = resolve; });
    return fetch(url, ...args);
  };
  const pending = f.action('select-benchmark', {value:'fund:ZERO'});
  assert.match(f.ui.view(f.helpers), /正在读取 ZERO/);
  await f.action('no-benchmark');
  release(); await pending;
  assert.match(f.ui.view(f.helpers), /添加对照标的/);
  assert.doesNotMatch(f.ui.view(f.helpers), /正在读取 ZERO|上次模拟结果/);
  await f.action('export-pdf');
  const result = f.reports.at(-1).result;
  assert.equal(result.config.benchmarkId, '');
  assert.equal(result.benchmark, null);
  assert.ok(result.snapshots.filter(w => !w.error).every(w => !w.benchmark));
});

test('workspace tabs isolate settings, asset editing and results while preserving drafts and the last run', async () => {
  const f = uiFixture(input => { input.config.positions = []; });
  const view = () => f.ui.view(f.helpers), tab = value => f.action('tab', { value });
  const selected = name => assert.match(view(), new RegExp('data-value="' + name + '" role="tab"[^>]*aria-selected="true"'));
  selected('settings');
  assert.doesNotMatch(view(), /id="portfolio-search"|class="portfolio-results"/);
  f.monthly(777);
  await tab('holdings');
  assert.match(view(), /<h2>我的组合<\/h2>/);
  assert.match(view(), /<h2>添加标的<\/h2>/);
  assert.doesNotMatch(view(), /id="portfolio-monthly"/);
  const [asset, benchmark] = f.input.catalog.assets;
  f.ui.handleInput({ id: 'portfolio-search', value: asset.code, dataset: {} });
  await f.action('add', { value: asset.id });
  await tab('settings');
  assert.match(view(), /id="portfolio-monthly"[^>]*value="777"/);
  await tab('results');
  assert.match(view(), /portfolio-result-placeholder/);
  await tab('holdings');
  assert.match(view(), new RegExp('id="portfolio-search"[^>]*value="' + asset.code + '"'));
  assert.doesNotMatch(view(), new RegExp('data-portfolio-weight="' + benchmark.id + '"'));
  await f.action('run');
  selected('results');
  assert.match(view(), /class="portfolio-results"/);
  assert.doesNotMatch(view(), /id="portfolio-monthly"|id="portfolio-search"/);
  const html = view();
  assert.ok(html.indexOf('data-portfolio-plot') > html.indexOf('portfolio-result-summary'));
  assert.doesNotMatch(html, /<h2>区间快照<\/h2>/);
  await f.section('periods'); assert.match(view(), /<h2>区间快照<\/h2>/);
  await f.section('overview');
  assert.doesNotMatch(html, /role="tabpanel"[^>]*tabindex=/);
  await tab('settings'); f.monthly(222);
  await tab('results');
  assert.match(view(), /上次模拟结果/);
  await tab('settings');
  assert.match(view(), /id="portfolio-monthly"[^>]*value="222"/);
  f.monthly(-1); await f.action('run');
  selected('settings');
  assert.match(view(), /role="alert"/);
  await f.action('save'); // Invalid draft cannot replace or export the previous simulation.
  assert.equal(f.downloads.length, 0);
});

test('result navigation contains actions and tabs; the chart identifies the funded strategy', async () => {
  const f = uiFixture(input => Object.assign(input.config, { initial: 0, monthly: 400, contributionMethod: 'dca_quarter' }));
  const view = () => f.ui.view(f.helpers);
  await f.action('run');
  const overview = view(), toolbar = overview.split('role="tabpanel" aria-labelledby="portfolio-result-tab-overview"')[0];
  assert.doesNotMatch(toolbar, /每季度定投|一次性投入|<summary[^>]*>报告/);
  assert.match(overview.slice(overview.indexOf('<h2>组合走势')), /每季度定投/);
  assert.doesNotMatch(overview, /一次性投入|<h[1-6]\b[^>]*>[^<]*每季度定投/);
  const directActions = html => {
    const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    for (const id of ['sources', 'export-pdf', 'export-result', 'export-holdings']) {
      assert.equal(visible.split('data-action="portfolio-' + id + '"').length - 1, 1, id + ' must be available in one click');
    }
  };
  directActions(overview);
  assert.doesNotMatch(overview, /id="portfolio-result-tab-signals"|<h2>区间快照|<h2>年度表现|<h2>持仓贡献/);
  await f.action('result-tab', { value: 'periods' });
  const periods = view();
  directActions(periods);
  assert.ok(periods.indexOf('<h2>区间快照') >= 0 && periods.indexOf('<h2>年度表现') > periods.indexOf('<h2>区间快照'));
  assert.doesNotMatch(periods, /data-portfolio-plot|<h2>持仓贡献|portfolio-result-summary|portfolio-chart-strategy/);
  await f.action('result-tab', { value: 'holdings' });
  directActions(view());
  assert.match(view(), /<h2>持仓贡献/); assert.doesNotMatch(view(), /<h2>区间快照|<h2>年度表现|data-portfolio-plot|portfolio-chart-strategy/);
  await f.action('run');
  assert.match(view(), /data-portfolio-plot/);
});

test('funding, strategy rules and settlement settings are grouped by what the investor changes', async () => {
  const f = uiFixture(input => {
    input.catalog.assets[0].market = 'us';
    input.config.tax = {...P.taxConfig(), usCapitalGains: 20, usDividend: 20};
  });
  const view = () => f.ui.view(f.helpers);
  f.helpers.card = (title, sub, body, right = '', foot = '') => '<section><h2>' + title + '</h2>' + sub + right + body + foot + '</section>';
  const first = view();
  const order = selectors => {
    const indices = selectors.map(text => first.indexOf(text));
    assert.ok(indices.every((at, i) => at >= 0 && (!i || at > indices[i - 1])), selectors.join(' → '));
  };
  order(['id="portfolio-initialMethod"', 'id="portfolio-initial"', 'id="portfolio-contributionMethod"', 'id="portfolio-monthly"', 'id="portfolio-rebalance"', 'id="portfolio-years"']);
  assert.doesNotMatch(first, /id="portfolio-benchmark"/);
  order(['aria-label="税务情景"', 'id="portfolio-transactionFee"', 'aria-label="期末处理"']);
  const directPlan = first.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
  assert.match(directPlan, /id="portfolio-purchase-plan"/);
  assert.match(directPlan, /id="portfolio-contribution-plan"/);
  assert.doesNotMatch(first, /<summary[^>]*>查看投入金额与执行规则/);
  assert.doesNotMatch(first, /收益已含年费|境内ETF净值|人民币 · 分红再投/);
  await f.action('tax-zero');
  assert.match(view(), /id="portfolio-transactionFee"/);
  assert.doesNotMatch(view(), /自定义税率|浮盈预留|portfolio-tax-usDividend|portfolio-tax-assumption/);
  await f.action('settle-sell'); assert.match(view(), /扣除卖出手续费后结为现金/);
  await f.action('save'); const free = JSON.parse(f.downloads.at(-1)[1]);
  assert.equal(free.tax.liquidate, true); assert.equal(free.tax.usCapitalGains, 0);
  assert.equal(free.transactionFee, f.input.config.transactionFee);
  await f.action('tax-custom'); assert.match(view(), /id="portfolio-tax-usCapitalGains"/);
  assert.ok(view().indexOf('id="portfolio-tax-usCapitalGains"') < view().indexOf('id="portfolio-transactionFee"'));
  f.ui.handleInput({dataset:{portfolioField:'tax-usCapitalGains'},value:'15'});
  assert.match(view(), /扣除卖出手续费和适用的盈利税/);
  await f.action('settle-hold'); assert.match(view(), /估值扣除浮盈预留税，持股和现金不变/);
  await f.action('save'); const manual = JSON.parse(f.downloads.at(-1)[1]);
  assert.equal(manual.tax.liquidate, false); assert.equal(manual.tax.usCapitalGains, 15);
  await f.action('tab', {value:'holdings'});
  assert.doesNotMatch(view(), /id="portfolio-(?:initial|monthly)"|组合含每日杠杆ETF/);
  assert.match(view(), /历史收益已扣产品年费/);

});

test('switching tabs resumes each reading position and a new simulation opens at the result summary', async () => {
  const f = uiFixture(), win = f.context.window, workspaceTop = 180;
  win.scrollY = 0;
  win.scrollTo = ({ top }) => { win.scrollY = top; };
  f.context.document.getElementById = id => id === 'portfolio-workspace' ? { getBoundingClientRect: () => ({ top: workspaceTop - win.scrollY }) } : null;
  const tab = value => f.action('tab', { value });
  await f.action('run');
  win.scrollY = 2500;
  await tab('settings'); assert.equal(win.scrollY, workspaceTop);
  win.scrollY = 650;
  await tab('results'); assert.equal(win.scrollY, 2500);
  await tab('settings'); assert.equal(win.scrollY, 650);
  await f.action('run'); assert.equal(win.scrollY, workspaceTop);
});

function systematicUiFixture(method, state = {}) {
  const calls = [], fetches = [], methods = ['vix_panic_reentry', 'relative_strength_rotation', 'dual_risk_guard'];
  // Keep account rendering real while isolating the UI's data-loading and new
  // result contract from the independently tested trading controllers.
  const model = { ...P,
    validateConfig: (config, ids) => P.validateConfig({ ...config, initialMethod: methods.includes(config.initialMethod) ? 'lump_sum' : config.initialMethod }, ids),
    simulate(input) {
      calls.push(input);
      const systematic = methods.includes(input.config.initialMethod);
      const computed = P.simulate({ ...input, config: { ...input.config, initialMethod: systematic ? 'lump_sum' : input.config.initialMethod } });
      if (systematic && !computed.error) {
        computed.config.initialMethod = input.config.initialMethod;
        computed.systematic = { method: input.config.initialMethod, signalDay: computed.end,
          executedTargets: [.3, .3], nextPlan: null, state: { missing: null, warmingUp: false, metadata: {} }, ...state };
      }
      return computed;
    },
    simulateWindows: () => []
  };
  const f = uiFixture(input => {
    Object.assign(input.config, { initialMethod: method, monthly: 0, rebalance: 'none', benchmarkId: '', tax: P.taxConfig() });
    for (const [i, id] of ['us:USD', 'us:TQQQ'].entries()) {
      const a = input.catalog.assets[i], old = a.id, h = input.histories[old];
      Object.assign(a, { id, code: id.slice(3), name: id.slice(3), kind: 'etf' });
      h.id = id; delete input.histories[old]; input.histories[id] = h;
      input.config.positions[i] = { id, weight: 30 };
    }
    const first = input.catalog.assets[0], history = input.histories[first.id];
    input.catalog.assets.push({ ...first, id: 'us:QQQ', code: 'QQQ', name: 'QQQ', historyUrl: 'data/portfolio/etf/QQQ.json' });
    input.histories['us:QQQ'] = { ...history, id: 'us:QQQ' };
  }, model);
  f.helpers.pct = value => M.finite(value) ? value.toFixed(2) + '%' : '—';
  f.marketContext = { schemaVersion: 1, status: 'available', first: '2026-01-07', asOf: '2026-01-08', series: [['2026-01-07', 18, 21], ['2026-01-08', 19, 22]] };
  const originalFetch = f.context.fetch;
  f.context.fetch = async (url, options) => {
    fetches.push({ url, options });
    if (url === 'data/portfolio/entry-context.json') return { ok: true, text: async () => JSON.stringify(f.marketContext) };
    return originalFetch(url, options);
  };
  return Object.assign(f, { calls, fetches });
}

test('systematic UI refreshes VIX evidence on every applicable run and isolates other methods', async () => {
  for (const method of ['lump_sum', 'cash_topup', 'relative_strength_rotation', 'vix_panic_reentry', 'dual_risk_guard']) {
    const f = systematicUiFixture(method);
    await f.action('run');
    const first = f.calls.find(call => call.config.initialMethod === method);
    assert.ok(first, f.ui.view(f.helpers));
    const needsVix = ['vix_panic_reentry', 'dual_risk_guard'].includes(method);
    assert.equal(Boolean(first.marketContext), needsVix);
    f.marketContext = { ...f.marketContext, asOf: '2026-01-09', series: [...f.marketContext.series, ['2026-01-09', 20, 23]] };
    await f.action('run');
    const vixFetches = f.fetches.filter(x => x.url === 'data/portfolio/entry-context.json');
    assert.equal(vixFetches.length, needsVix ? 2 : 0);
    assert.ok(vixFetches.every(x => x.options.cache === 'no-store'));
    assert.equal(f.fetches.filter(x => x.url === 'data/portfolio/etf/QQQ.json').length, method === 'dual_risk_guard' ? 1 : 0);
    if (needsVix) assert.equal(f.calls.filter(call => call.config.initialMethod === method).at(-1).marketContext.asOf, '2026-01-09');
  }
});

test('systematic UI retains the prior account and blocks recomputation when VIX refresh fails', async () => {
  for (const method of ['vix_panic_reentry', 'dual_risk_guard']) {
    const f = systematicUiFixture(method), fetch = f.context.fetch;
    await f.action('run'); await f.action('export-pdf');
    assert.equal(f.reports.length, 1);
    const value = f.reports[0].result.value, before = f.calls.length;
    f.context.fetch = async (url, options) => url === 'data/portfolio/entry-context.json' ? { ok: false, status: 503 } : fetch(url, options);
    await f.action('run');
    assert.equal(f.calls.length, before);
    const html = f.ui.view(f.helpers);
    assert.match(html, /最新VIX\/VIX3M配对数据请求失败（503）/);
    assert.match(html, /仍显示上次成功模拟结果/);
    assert.ok(html.includes(String(value)));
    await f.action('export-pdf'); assert.equal(f.reports.length, 1);
    f.context.fetch = fetch; f.marketContext.series = [['2026-01-08', 19, 22], ['2026-01-07', 18, 21]];
    await f.action('run'); assert.equal(f.calls.length, before);
    assert.match(f.ui.view(f.helpers), /配对数据不完整或日期无效/);
  }
});

test('systematic next-day orders show fixed money and signal-day sale proportions, never normalized units', async () => {
  const f = systematicUiFixture('relative_strength_rotation', { nextPlan: { signalDay: '2026-01-08',
    orders: [{ id: 'us:TQQQ', side: 'sell', sellFraction: .25, units: .123456789 }, { id: 'us:USD', side: 'buy', amount: 1234.56 }],
    buyAmount: 1234.56, buyFee: 1.23, desiredTargets: [.4, .2], parkedWeights: [0, 0], metadata: {} } });
  await f.action('run'); await f.section('signals');
  const html = f.ui.view(f.helpers);
  assert.match(html, /待执行/); assert.match(html, /卖出 TQQQ/); assert.match(html, /信号日持仓的 25\.00%/);
  assert.match(html, /买入 USD/); assert.match(html, /固定买入金额 1234\.56 元，另预留交易费 1\.23 元/);
  assert.match(html, /最近执行目标：USD ETF 30\.00% · TQQQ 30\.00%/);
  assert.doesNotMatch(html, /0\.123456789|<strong>[^<]*\d+(?:\.\d+)?\s*股<\/strong>/);
  assert.match(html, /轮动可能集中于单只ETF，最大回撤可能增大/);
});

test('systematic no-order states distinguish missing evidence, warmup and an unchanged allocation', async () => {
  for (const [state, expected] of [[{ missing: '缺同日VIX/VIX3M', metadata: {} }, /暂不生成新计划.*信号缺项：缺同日VIX\/VIX3M/],
    [{ warmingUp: true, metadata: { reason: 'USD/TQQQ不足505个共同实际收盘' } }, /等待信号历史积累/], [{ metadata: {} }, /暂无调仓计划/]]) {
    const f = systematicUiFixture('dual_risk_guard', { state });
    await f.action('run'); await f.section('signals');
    const html = f.ui.view(f.helpers);
    assert.match(html, expected); assert.doesNotMatch(html, /class="badge">待执行/);
    assert.match(html, /2020和2022两个历史事件/);
  }
});

function dailyUiFixture(method = 'vix_panic_reentry') {
  const daily = ['2026-01-06', '2026-01-07', '2026-01-08'].map((day, i) => ({ day, method, status: 'ready', missing: null,
    warmingUp: false, trackingStart: '2024-01-01', currency: 'CNY', fee: .001,
    indicator: i === 1 ? 0 : 100,
    indicators: [{ id: 'us:TQQQ', label: 'TQQQ新增预算投入率', value: i === 1 ? 0 : 100, unit: '%', kind: 'execution_rate', basis: 'assigned_asset_budget' }],
    positions: [{ id: 'us:USD', code: 'USD', name: 'USD ETF', weight: .3 }, { id: 'us:TQQQ', code: 'TQQQ', name: 'TQQQ', weight: .3 }],
    desiredTargets: [.3, i === 1 ? 0 : .3], executedTargets: [.3, i === 1 ? 0 : .3], executedParked: [0, i === 1 ? .3 : 0], nextPlan: null,
    metadata: { vixDay: '2026-01-0' + (5 + i), vixOn: i !== 1, vixRatio: 1.012 + i * .1, vixExitRun: i,
      vixCalmRun: 0, vixArmed: true, vixPeakDrop: .25, vixHeld: 7 }
  }));
  return { ...systematicUiFixture(method, { daily }), daily };
}

test('daily UI selects historical indicators and budgets without changing the simulated account', async () => {
  const f = dailyUiFixture();
  await f.action('run'); await f.section('signals');
  let html = f.ui.view(f.helpers);
  assert.ok(html.indexOf('每日策略状态') < html.indexOf('与一次性投入比较'));
  assert.match(html, /TQQQ策略状态.*持有状态/);
  assert.match(html, /预算试算，不计入回测年化/);
  assert.match(html, /规则调仓买入 0笔、卖出 0笔/);
  assert.match(html, /状态天数不等于买入次数/);
  assert.doesNotMatch(html, /TQQQ新增预算投入率|每日加仓指标/);
  for (const field of ['indicator-index', 'indicator-date', 'indicator-budget']) assert.ok(html.includes('data-portfolio-field="' + field + '"'), 'root event routing: ' + field);
  assert.equal((html.match(/规则说明与历史检验/g) || []).length, 1);
  assert.ok(html.includes('docs/portfolio-entry-research.html#vix_panic_reentry'));
  assert.match(html, /2026-01-08.*来源 VIX\/VIX3M 2026-01-07/);
  const calls = f.calls.length;
  await f.action('daily-prev');
  f.ui.handleInput({ id: 'portfolio-addition-budget', value: '4321', dataset: {} });
  html = f.ui.view(f.helpers);
  assert.match(html, /value="2026-01-07"/);
  assert.match(html, /TQQQ策略状态.*退出状态/);
  assert.match(html, /TQQQ对应预算暂存现金/);
  assert.match(html, /原有账户 · 下一共同交易日/);
  assert.match(html, /实际持仓见组合走势中的“实际仓位”/);
  const allocation = P.additionAllocation(f.daily[1], 4321);
  assert.ok(html.includes(String(allocation.parkedCash)));
  assert.equal(f.calls.length, calls, 'date and trial budget must not rerun the account');
  await f.action('export-pdf');
  const report = f.reports.at(-1), value = report.result.value;
  assert.equal(report.dailyIndicator.row.day, '2026-01-07');
  assert.equal(report.dailyIndicator.budget, 4321);
  assert.equal(report.dailyIndicator.allocation.total, allocation.total);
  await f.action('daily-next'); await f.action('export-pdf');
  assert.equal(f.reports.at(-1).dailyIndicator.row.day, '2026-01-08');
  assert.equal(f.reports.at(-1).result.value, value);
  assert.equal(report.dailyIndicator.row.day, '2026-01-07', 'prior exported snapshot stays frozen');
  await f.ui.handleChange({ id: 'portfolio-daily-date', value: '2026-01-06', dataset: {} });
  assert.match(f.ui.view(f.helpers), /value="2026-01-06"/);
  await f.action('export-daily');
  const csv = f.downloads.at(-1);
  assert.match(csv[0], /逐日策略状态/);
  for (const field of ['metadata.vixRatio', 'budgetAllocation.parkedCash', 'executedTargets', '2026-01-06', '2026-01-07', '2026-01-08', '4321']) assert.ok(csv[1].includes(field), field);
  assert.match(csv[1], /不是券商实际股数/);
});

test('daily explanation uses pre-reset trigger counts and separates state from the pending order', () => {
  const row = dailyUiFixture().daily[1];
  Object.assign(row.metadata, { vixValue: 24, vix3mValue: 20, vixRatio: 1.2, vixExitRun: 0,
    vixDecision: { previousOn: true, previousArmed: true, armedForExit: true, stressed: true,
      exitCountTested: 10, exitTriggered: true, on: false, lastTransitionDay: '2026-01-06' } });
  row.nextPlan = { orders: [{ id: 'us:TQQQ', side: 'sell', sellFraction: 1 }] };
  const text = Pdf.explainDaily(row).flat().join('\n');
  assert.match(text, /24 ÷ 20 = 1\.2/);
  assert.match(text, /本次连续 10 \/ 10 次/);
  assert.match(text, /来源日状态从持有切换为退出/);
  assert.match(text, /下一共同收盘卖出TQQQ的信号日持仓 100%/);
  assert.equal(Pdf.dailyDisplay(row.indicators[0]).value, '退出状态');
  row.nextPlan = null;
  assert.match(Pdf.explainDaily(row).flat().join('\n'), /没有新调仓订单；保持状态不会每天重复买入/);
});

test('rotation explanation exposes price substitution and retains three phase memories between reviews', () => {
  const row = { status: 'ready', method: 'relative_strength_rotation', metadata: {
    relativeInputs: { startDay: '2024-01-02', endDay: '2026-01-06', usdStart: 100, usdEnd: 150, tqqqStart: 100, tqqqEnd: 100, ratio: 1.5 },
    originalShares: [1/3, 2/3], leaders: [0, null, 1], reviewedToday: false,
    phaseReviews: [{ day: '2025-10-01', sourceDay: '2025-10-01', ratio: 1.3, leader: 0 }, null,
      { day: '2025-12-01', sourceDay: '2025-12-01', ratio: .7, leader: 1 }] }, nextPlan: null };
  const text = Pdf.explainDaily(row).flat().join('\n');
  assert.match(text, /\(150 ÷ 100\) ÷ \(100 ÷ 100\) = 1\.5/);
  assert.match(text, /本日没有复核/);
  assert.match(text, /\(100% \+ 33\.333333% \+ 0%\) ÷ 3 = 44\.444444%/);
  assert.match(text, /2025-12-01复核；来源 2025-12-01，相对增长 0\.7；保留方向：TQQQ/);
});

test('daily indicators preserve missing and warmup semantics and freeze the same selection in PDF', async () => {
  const f = dailyUiFixture();
  Object.assign(f.daily[0], { status: 'missing', missing: 'VIX记录缺连续日线', indicator: null,
    indicators: [{ ...f.daily[0].indicators[0], value: null }] });
  Object.assign(f.daily[1], { status: 'warming-up', warmingUp: true, metadata: { reason: '不足505个共同收盘', sourceDay: '2026-01-07' },
    executedTargets: [.3, .3], executedParked: [0, 0] });
  f.daily[2].nextPlan = { signalDay: f.daily[2].day, desiredTargets: [.3, 0], parkedWeights: [0, .3],
    orders: [{ id: 'us:TQQQ', side: 'sell', sellFraction: .25, units: .123456789 }], buyAmount: 0, buyFee: 0 };
  await f.action('run'); await f.section('signals'); await f.action('export-pdf');
  let text = textOf(Pdf.layout(f.reports.at(-1), measure));
  assert.match(text, /Cboe VIX\/VIX3M/); assert.match(text, /每日策略状态/);
  assert.match(text, /信号日持仓的 25\.00%/); assert.doesNotMatch(text, /0\.123456789/);
  await f.action('daily-prev'); await f.action('export-pdf');
  assert.equal(f.reports.at(-1).dailyIndicator.allocation.status, 'fallback');
  assert.match(f.ui.view(f.helpers), /预热期间沿用原配置/);
  await f.action('daily-prev'); await f.action('export-pdf');
  const html = f.ui.view(f.helpers);
  assert.match(html, /TQQQ策略状态<\/span><strong>—/);
  assert.match(html, /VIX记录缺连续日线/);
  assert.equal(f.reports.at(-1).dailyIndicator.allocation, null);
  f.ui.handleInput({ id: 'portfolio-addition-budget', value: '-1', dataset: {} });
  const count = f.reports.length;
  await f.action('export-pdf');
  assert.equal(f.reports.length, count);
  assert.match(f.notices.at(-1), /请输入有效新增预算/);
});

test('extend-to-latest refreshes coverage but preserves the original account start and rejects dirty or liquidated drafts', async () => {
  const f = dailyUiFixture('relative_strength_rotation');
  await f.action('select', { field: 'years', value: 'custom' });
  f.ui.handleInput({ id: 'portfolio-start', value: '2024-06-03', dataset: { portfolioField: 'start' } });
  f.ui.handleInput({ id: 'portfolio-end', value: '2025-06-03', dataset: { portfolioField: 'end' } });
  await f.action('run'); await f.action('export-pdf');
  const original = f.reports.at(-1).result;
  await f.section('signals');
  await f.action('extend-latest'); await f.action('export-pdf');
  const latest = f.reports.at(-1).result;
  assert.equal(latest.start, original.start); assert.equal(latest.end, '2026-01-08');
  assert.equal(latest.config.years, 'custom'); assert.equal(latest.config.start, original.start);
  assert.deepEqual(latest.config.positions, original.config.positions);
  assert.equal(f.fetches.filter(x => x.url.endsWith('entry-context.json')).length, 0);
  const before = f.calls.length;
  await f.action('tab', {value: 'settings'}); f.monthly(123); await f.action('tab', {value: 'results'});
  await f.action('extend-latest'); assert.equal(f.calls.length, before);
  assert.match(f.ui.view(f.helpers), /参数已改动，请先重新模拟/);
  await f.action('tab', {value: 'settings'}); f.monthly(0); await f.action('settle-sell');
  await f.action('run');
  await f.section('signals');
  const cleared = f.calls.length;
  await f.action('extend-latest'); assert.equal(f.calls.length, cleared);
  assert.match(f.ui.view(f.helpers), /期末已清仓，不能延续账户/);
});

test('extend-to-latest refuses an unconfirmed catalog and leaves the successful result intact', async () => {
  const f = dailyUiFixture();
  await f.action('run'); await f.section('signals'); await f.action('export-pdf');
  const prior = f.reports.at(-1).result.value, before = f.calls.length, fetch = f.context.fetch;
  f.context.fetch = async (url, options) => url === 'data/portfolio/catalog.js' ? { ok: false, status: 503 } : fetch(url, options);
  await f.action('extend-latest');
  assert.equal(f.calls.length, before);
  await f.section('overview');
  assert.ok(f.ui.view(f.helpers).includes(String(prior)));
  assert.match(f.ui.view(f.helpers), /最新标的库请求失败（503）/);
});

function accountUiFixture(configure) {
  const f = uiFixture(input => {
    Object.assign(input.config, { monthly: 0, rebalance: 'none', transactionFee: 0 });
    input.config.positions.forEach((position, index) => { position.weight = index < 2 ? 30 : 0; });
    // Sustained asset growth makes the difference between contribution weights
    // and the account's actual exposure material, without stubbing the account.
    input.histories[input.config.positions[0].id].series.forEach((row, index) => { row[1] = 100 * Math.exp(index * .004); });
    if (configure) configure(input);
  });
  f.helpers.pct = value => M.finite(value) ? value.toFixed(2) + '%' : '—';
  f.helpers.card = (title, subtitle, html) => '<section><h2>' + title + '</h2><p>' + subtitle + '</p>' + html + '</section>';
  return f;
}

const scoreUi = /买点历史分|加仓评分/;

function nextPlanFixture(endIndex, mixedCalendar = false) {
  return accountUiFixture(input => {
    const asset = input.catalog.assets[0], oldId = asset.id, history = input.histories[oldId];
    asset.id = 'us:TQQQ'; asset.code = 'TQQQ'; history.id = asset.id;
    delete input.histories[oldId]; input.histories[asset.id] = history;
    input.config.positions[0].id = asset.id;
    const days = history.series.map(row => row[0]);
    input.catalog.assets.push({ id: 'us:QQQ', code: 'QQQ', kind: 'etf', currency: 'USD', status: 'available', historyUrl: 'data/portfolio/etf/QQQ.json' });
    input.histories['us:QQQ'] = { schemaVersion: 1, id: 'us:QQQ', currency: 'USD', basis: 'provider_adjusted_close', dividends: 'reinvested',
      first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, i < 300 || i >= 320 ? 100 : 60]) };
    Object.assign(input.config, { initialMethod: 'qqq_bear_confirm', years: 'custom', start: days[280], end: days[endIndex], benchmarkId: '', tax: { usCapitalGains: 0, usDividend: 0, cnStockDividend: 0 } });
    if (mixedCalendar) input.histories[input.config.positions[1].id].series = input.histories[input.config.positions[1].id].series.filter(([day]) => day !== days[endIndex]);
  });
}

test('next-trade panel distinguishes pending QQQ exits and entries from executed holdings', async () => {
  for (const [endIndex, action, held] of [[319, '退出TQQQ对应仓位', '持有TQQQ'], [322, '买回TQQQ对应仓位', '持有对应现金']]) {
    const f = nextPlanFixture(endIndex);
    await f.action('run'); await f.section('signals');
    assert.equal(f.notices.length, 0, f.notices.join('; '));
    const html = f.ui.view(f.helpers);
    assert.equal(html.match(/role="alert">([^<]*)/)?.[1], undefined);
    assert.match(html, /下一共同交易日/);
    assert.ok(html.includes(action)); assert.match(html, /待执行/);
    assert.ok(html.includes('模拟账户当前' + held));
  }
});

test('a newer QQQ-only close is shown as observation, not the next common-day order', async () => {
  const f = nextPlanFixture(319, true);
  await f.action('run'); await f.section('signals');
  assert.equal(f.notices.length, 0, f.notices.join('; '));
  const html = f.ui.view(f.helpers);
  assert.equal(html.match(/role="alert">([^<]*)/)?.[1], undefined);
  assert.match(html, /继续持有TQQQ/); assert.match(html, /较新观察：QQQ .*收盘为持有现金状态/);
  assert.match(html, /暂不改变上述计划/);
  assert.doesNotMatch(html, /退出TQQQ对应仓位|class="badge">待执行/);
});

test('cash-topup panel exposes predeclared per-asset order amounts and fees', async () => {
  const f = accountUiFixture(input => {
    const days = input.histories[input.config.positions[0].id].series.map(row => row[0]);
    for (const p of input.config.positions.filter(p => p.weight)) input.histories[p.id].series.forEach((row, i) => { row[1] = i ? 80 : 100; });
    Object.assign(input.config, { initialMethod: 'cash_topup', years: 'custom', start: days[0], end: days[1], benchmarkId: '', transactionFee: .1, tax: { usCapitalGains: 0, usDividend: 0, cnStockDividend: 0 } });
  });
  await f.action('run'); await f.section('signals'); await f.action('export-pdf');
  const html = f.ui.view(f.helpers);
  assert.equal(html.match(/role="alert">([^<]*)/)?.[1], undefined);
  const plan = f.reports[0].result.nextTopupPlan;
  assert.ok(plan && plan.orders.length === 2);
  for (const order of plan.orders) assert.ok(html.includes(String(order.amount)));
  assert.ok(html.includes(String(plan.fee))); assert.ok(html.includes(plan.signalDay + '收盘确定'));
  assert.match(html, /金额已确定；成交价格变化会使实际仓位偏离目标/);
});

test('normal and historical results retain holdings and drawdown without the retired terminal risk section', async () => {
  for (const historical of [false, true]) {
    const f = accountUiFixture(input => { if (historical) Object.assign(input.config, { years: 'custom', start: '2024-01-01', end: '2025-01-08' }); });
    await f.action('run'); await f.action('export-pdf');
    assert.equal(f.reports.length, 1);
    const report = f.reports[0], html = f.ui.view(f.helpers);
    assert.equal(report.result.timing, undefined);
    const pdf = textOf(Pdf.layout(report, measure));
    await f.section('holdings');
    const holdings = f.ui.view(f.helpers);
    assert.match(html, /最大回撤/); assert.match(holdings, /持仓贡献/);
    assert.match(pdf, /最大回撤/); assert.match(pdf, /持仓贡献/);
    for (const surface of [html, holdings, pdf]) {
      assert.doesNotMatch(surface, /模拟账户的期末风险|实际现金低于目标至少5个百分点/);
      assert.ok(surface.includes(report.result.end));
    }
    assert.doesNotMatch(html, scoreUi);
  }
});

test('mixed-market reports use the actual simulation valuation date', async () => {
  const f = accountUiFixture(input => {
    const asset = input.catalog.assets[1], history = input.histories[asset.id];
    history.series = history.series.filter(([day]) => day !== '2026-01-08');
    history.series.push(['2026-01-09', history.series.at(-1)[1] * 1.01]);
    history.asOf = asset.asOf = '2026-01-09';
  });
  await f.action('run'); await f.action('export-pdf');
  const report = f.reports[0], html = f.ui.view(f.helpers);
  assert.equal(report.result.end, '2026-01-08');
  for (const [field, day] of [['from', report.result.start], ['to', report.result.end]]) {
    assert.match(html, new RegExp('data-portfolio-field="chart-' + field + '"[^>]*value="' + day + '"'));
  }
  assert.ok(textOf(Pdf.layout(report, measure)).includes(report.result.end));
  assert.equal(report.result.timing, undefined);
});

function longHistoryUiFixture() {
  return uiFixture(input => {
    Object.assign(input.config, { monthly: 0, rebalance: 'none', transactionFee: 0 });
    input.config.positions.forEach((p, i) => { p.weight = i < 2 ? 30 : 0; });
    for (const [k, a] of input.catalog.assets.entries()) {
      const series = [];
      for (let t = Date.parse('2010-01-01'), i = 0; t <= Date.parse('2026-01-08'); t += 86400000, i++) {
        if ([0, 6].includes(new Date(t).getUTCDay())) continue;
        series.push([new Date(t).toISOString().slice(0, 10), 100 * Math.exp(i / 5000 + .2 * Math.sin(i / (90 + k * 20)))]);
      }
      Object.assign(input.histories[a.id], { series, first: series[0][0], asOf: series.at(-1)[0] });
      Object.assign(a, { first: series[0][0], asOf: series.at(-1)[0], sha256: 'v1-' + a.id });
    }
  });
}

test('a page kept open refreshes the manifest and actual simulation from histories added 100 days later', async () => {
  const f = longHistoryUiFixture(), fetches = [], originalFetch = f.context.fetch;
  f.context.fetch = async (url, options) => { fetches.push({ url, options }); return originalFetch(url); };
  await f.action('run'); await f.action('export-pdf');
  const original = f.reports.at(-1).result;
  await f.action('run');
  assert.equal(fetches.filter(r => r.url.endsWith('.json')).length, 2);
  assert.equal(fetches.filter(r => r.url === 'data/portfolio/catalog.js').length, 2);
  assert.ok(fetches.filter(r => r.url === 'data/portfolio/catalog.js').every(r => r.options.cache === 'no-store'));
  for (const [k, a] of f.input.catalog.assets.entries()) {
    const h = f.input.histories[a.id], base = h.series.at(-1)[1];
    for (let t = Date.parse('2026-01-09'), i = 1; t <= Date.parse('2026-04-18'); t += 86400000, i++) {
      if ([0, 6].includes(new Date(t).getUTCDay())) continue;
      h.series.push([new Date(t).toISOString().slice(0, 10), base * Math.exp(-i * .009 - .02 * Math.sin(i * (1 + k)))]);
    }
    h.asOf = a.asOf = h.series.at(-1)[0]; a.sha256 = 'v2-' + a.id;
    a.historyUrl = a.historyUrl.replace('.json', '-v2.json');
  }
  await f.action('run'); await f.action('export-pdf');
  const current = f.reports.at(-1).result;
  assert.equal(fetches.filter(r => r.url.endsWith('.json')).length, 4);
  assert.equal(current.end, '2026-04-17'); assert.notEqual(current.value, original.value);
  assert.equal(current.catalogRefresh.available, true); assert.equal(current.timing, undefined);
  assert.doesNotMatch(f.ui.view(f.helpers), scoreUi);
  await f.action('export-result');
  const csv = f.downloads.at(-1);
  assert.match(csv[0], /组合模拟.*2026-04-17/); assert.match(csv[1], /税后估值/);
  assert.doesNotMatch(csv[1], scoreUi);
});

test('failed freshness checks retain dated simulation results and name the missing update in page and PDF', async () => {
  const f = longHistoryUiFixture(), originalFetch = f.context.fetch;
  await f.action('run'); await f.action('export-pdf');
  const original = f.reports.at(-1).result;
  f.context.fetch = async url => url === 'data/portfolio/catalog.js' ? { ok: false, status: 503 } : originalFetch(url);
  await f.action('run'); await f.action('export-pdf');
  const current = f.reports.at(-1).result;
  assert.equal(current.value, original.value); assert.equal(current.end, original.end);
  assert.equal(current.catalogRefresh.available, false); assert.match(current.catalogRefresh.missing, /未能确认最新行情.*503/);
  const html = f.ui.view(f.helpers), pdfText = textOf(Pdf.layout(f.reports.at(-1), measure));
  for (const text of [html, pdfText]) { assert.match(text, /本次模拟使用已保存的历史数据/); assert.doesNotMatch(text, scoreUi); }
  assert.equal(current.timing, undefined);
});

test('ordinary account exports include the result and holdings', async () => {
  const f = accountUiFixture(); await f.action('run'); const before = f.downloads.length;
  await f.action('export-result'); assert.equal(f.downloads.length, before + 1); assert.match(f.downloads.at(-1)[0], /组合模拟/);
  await f.section('holdings');
  await f.action('export-holdings'); assert.equal(f.downloads.length, before + 2); assert.match(f.downloads.at(-1)[0], /持仓贡献/);
});

test('a new history download failure preserves account facts and blocks export until a successful rerun', async () => {
  const f = longHistoryUiFixture(), originalFetch = f.context.fetch;
  await f.action('run'); await f.action('export-pdf'); const count = f.downloads.length;
  f.input.catalog.assets[0].sha256 = 'updated-content';
  f.context.fetch = async url => url === f.input.catalog.assets[0].historyUrl ? { ok: false, status: 503 } : originalFetch(url);
  await f.action('run');
  const html = f.ui.view(f.helpers);
  assert.match(html, /本次行情更新失败：两倍测试ETF：历史文件请求失败（503）/);
  assert.match(html, /data-portfolio-plot/); assert.doesNotMatch(html, scoreUi);
  await f.action('export-pdf'); assert.equal(f.downloads.length, count);
  assert.match(f.notices.at(-1), /PDF 导出失败/);
  f.context.fetch = originalFetch;
  await f.action('run'); await f.action('export-pdf');
  assert.equal(f.reports.at(-1).result.catalogRefresh.available, true); assert.equal(f.reports.at(-1).result.timing, undefined);
});

test('running with a cleared or saved blank allocation fills zero and preserves the 40% cash budget', async () => {
  for (const mode of ['weight', 'amount', 'saved']) {
    const f = uiFixture(input => {
      input.config.monthly = 0;
      input.config.positions.forEach((p, i) => { p.weight = i < 2 ? 30 : mode === 'saved' ? null : 0; });
    });
    const id = f.input.config.positions[2].id;
    if (mode !== 'saved') f.ui.handleInput({ id: '', value: '', validity: { badInput: false },
      dataset: mode === 'amount' ? { portfolioAmount: id } : { portfolioWeight: id } });
    await f.action('run');
    await f.action('tab', { value: 'holdings' });
    const html = f.ui.view(f.helpers);
    assert.doesNotMatch(html, /请修正无效权重|每项权重须/);
    assert.ok(html.includes('value="0" data-portfolio-weight="' + id + '"'));
    await f.action('export-pdf');
    assert.equal(f.reports.length, 1, mode);
    assert.equal(f.reports[0].result.config.positions[2].weight, 0);
    assert.equal(f.reports[0].result.cashWeight, 40);
    assert.equal(f.reports[0].result.holdings.length, 2);
  }
});

test('blank allocation defaults never hide malformed, negative or excessive weights', async () => {
  for (const [value, badInput, message] of [['', true, /每项权重须/], ['-1', false, /每项权重须/],
    ['101', false, /每项权重须/], ['80', false, /权重合计超过100/]]) {
    const f = uiFixture();
    f.ui.handleInput({ id: '', value, validity: { badInput }, dataset: { portfolioWeight: f.input.config.positions[2].id } });
    await f.action('run');
    assert.match(f.ui.view(f.helpers), message);
  }
});

test('funding XIRR stays annualized beside portfolio returns in both display modes and exports', async () => {
  const f = uiFixture();
  await f.action('run');
  const expected = P.simulate(f.input);
  const summary = html => html.match(/<div class="stats-grid portfolio-result-summary">([\s\S]*?)<\/div>/)[1];
  const annual = summary(f.ui.view(f.helpers));
  assert.ok(annual.includes('<strong>资金年化 XIRR</strong><b>' + expected.xirr + '</b>'));
  assert.ok(annual.includes('<strong>组合年化收益</strong><b>' + expected.annualReturn + '</b>'));
  assert.notEqual(expected.xirr, expected.annualReturn, 'different contribution dates change XIRR without changing the portfolio’s return basis');
  f.helpers.annual = false;
  const cumulative = summary(f.ui.view(f.helpers));
  assert.ok(cumulative.includes('<strong>资金年化 XIRR</strong><b>' + expected.xirr + '</b>'));
  assert.ok(cumulative.includes('<strong>组合累计收益</strong><b>' + expected.totalReturn + '</b>'));
  assert.doesNotMatch(cumulative, /资金累计|资金年化 XIRR.*组合年化收益/);
  await f.action('export-result');
  assert.match(f.downloads[0][1], /组合累计收益%（现金流中性）/);
  assert.match(f.downloads[0][1], /全区间资金年化XIRR%/);
  assert.ok(f.downloads[0][1].includes(String(expected.xirr)));
  await f.action('export-pdf');
  const document = Pdf.layout(f.reports[0], measure), text = textOf(document);
  assert.ok(text.indexOf('资金年化 XIRR') < text.indexOf('组合年化收益'));
  assert.equal(f.reports[0].result.xirr, expected.xirr);
  assert.match(text, /资金年化 XIRR 使用实际投入日期与金额/);
});

test('short periods explain unavailable funding XIRR and snapshots retain exact benchmark failures', async () => {
  const short = uiFixture(input => Object.assign(input.config, { years: 'custom', start: '2025-08-01', end: '2026-01-08' }));
  await short.action('run');
  const html = short.ui.view(short.helpers);
  assert.match(html, /资金年化 XIRR[\s\S]*模拟不足一年，不外推资金年化/);
  await short.action('export-pdf');
  assert.match(textOf(Pdf.layout(short.reports[0], measure)), /模拟不足一年，不外推资金年化/);
  const missing = uiFixture(input => {
    const benchmarkId = input.catalog.assets[0].id;
    input.config.positions = [{ id: input.catalog.assets[1].id, weight: 100 }];
    Object.assign(input.config, { years: 'custom', start: '2025-08-01', end: '2026-01-08', benchmarkId });
    const history = input.histories[benchmarkId];
    history.series = history.series.filter(([day]) => day >= '2025-07-01'); history.first = history.series[0][0];
  });
  await missing.action('run');
  await missing.section('periods');
  const missingHtml = missing.ui.view(missing.helpers);
  assert.match(missingHtml, /近1年对照：对照标的的历史不覆盖组合区间/);
  assert.doesNotMatch(missingHtml, />无覆盖</);
});

test('changed settings are resimulated before export; failures never download old results', async () => {
  const f = uiFixture();
  await f.action('run');
  f.monthly(6500);
  await f.action('export-pdf');
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].result.config.monthly, 6500);
  assert.ok(f.reports[0].result.contributed > 100000 + 24 * 6000);
  assert.equal(f.downloads[0][2], 'application/pdf');
  assert.match(f.renderStates.find(s => s.includes('正在生成 PDF')), /portfolio-export-pdf" disabled/);
  f.monthly(1e11);
  await f.action('export-pdf');
  assert.equal(f.downloads.length, 1);
  assert.match(f.notices.at(-1), /PDF 导出失败/);
});

test('editing during generation leaves the report frozen and duplicate exports suppressed', async () => {
  const f = uiFixture();
  await f.action('run');
  let release;
  f.context.window.ChanghengPortfolioPdf.create = report => { f.reports.push(report); return new Promise(resolve => { release = resolve; }); };
  const pending = f.action('export-pdf');
  await f.action('export-pdf');
  assert.equal(f.reports.length, 1);
  f.monthly(7000);
  release(new Blob(['PDF'])); await pending;
  assert.equal(f.reports[0].result.config.monthly, 3000);
  assert.equal(f.downloads.length, 1);
  assert.match(f.ui.view(f.helpers), /上次模拟结果/);
});

test('editing during the export rerun stops the download instead of silently exporting different settings', async () => {
  const f = uiFixture();
  await f.action('run');
  f.monthly(6500);
  const pending = f.action('export-pdf');
  f.monthly(7000);
  await pending;
  assert.equal(f.downloads.length, 0);
  assert.match(f.notices.at(-1), /参数在模拟期间发生改动/);
  await f.action('export-pdf');
  assert.equal(f.downloads.length, 1);
  assert.equal(f.reports[0].result.config.monthly, 7000);
});

test('USD settings, tax reserve, PDF and CSV keep the same result currency after draft edits', async () => {
  const f = uiFixture(input => {
    input.config.currency = 'USD';
    input.config.tax = { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20 };
    input.catalog.assets.forEach(a => { a.currency = 'USD'; a.market = 'us'; });
    Object.values(input.histories).forEach(h => {
      h.currency = 'USD';
      h.dividendEvidence = { status: 'recorded', first: h.first, through: h.asOf, fractions: {} };
    });
  });
  assert.match(f.ui.view(f.helpers), /投入与计价币种：美元 USD/);
  await f.action('tab', { value: 'holdings' });
  assert.doesNotMatch(f.ui.view(f.helpers), /id="portfolio-(?:initial|monthly)"/);
  assert.match(f.ui.view(f.helpers), /data-portfolio-amount="us:TWO"[^<]*><span>USD<\/span>/);
  await f.action('run');
  const html = f.ui.view(f.helpers), expected = P.simulate(f.input);
  assert.ok(expected.taxReserve > 0);
  assert.match(html, /期末税后估值/); assert.match(html, /浮盈预留税/);
  assert.doesNotMatch(html, /浮盈未征税|期末市值 \/ 元/);
  await f.section('holdings');
  assert.match(f.ui.view(f.helpers), /税后估值 \/ USD/);
  await f.action('export-pdf');
  const report = f.reports[0], text = textOf(Pdf.layout(report, measure));
  assert.equal(report.result.currency, 'USD');
  assert.equal(report.result.taxReserve, expected.taxReserve);
  assert.match(text, /初始投入 \/ USD/); assert.match(text, /浮盈预留税 \/ USD/);
  assert.match(text, /税后估值与累计转入本金 \/ 美元/);
  assert.doesNotMatch(text, /人民币现金|\/ 元|NaN|undefined/);
  await f.action('tab', { value: 'settings' });
  await f.action('select', { field: 'currency', value: 'CNY' });
  assert.match(f.ui.view(f.helpers), /投入与计价币种：人民币 CNY/);
  await f.action('tab', { value: 'results' });
  const stale = f.ui.view(f.helpers);
  assert.match(stale, /上次模拟结果/);
  assert.match(stale, /税后估值 \/ USD/);
  await f.section('overview'); await f.action('export-result');
  const curveCsv = f.downloads.at(-1)[1];
  assert.match(curveCsv, /税后估值USD/); assert.match(curveCsv, /当前浮盈预留税USD/);
  assert.doesNotMatch(curveCsv.split('\n')[0], /CNY/);
  await f.section('holdings'); await f.action('export-holdings');
  const holdingsCsv = f.downloads.at(-1)[1];
  assert.match(holdingsCsv, /当前浮盈预留税USD/); assert.match(holdingsCsv, /cash:USD/);
  assert.doesNotMatch(holdingsCsv.split('\n')[0], /CNY/);
  await f.action('save');
  assert.equal(JSON.parse(f.downloads.at(-1)[1]).currency, 'CNY');
  await f.action('select', { field: 'currency', value: 'USD' });
  await f.action('save');
  assert.equal(JSON.parse(f.downloads.at(-1)[1]).currency, 'USD');
});

test('production entrypoint loads the account model, PDF and simulator', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const assets = [...html.matchAll(/src="assets\/(portfolio[^"?]*)/g)].map(match => match[1]);
  assert.deepEqual(assets, ['portfolio-opportunity.js', 'portfolio-systematic.js', 'portfolio-model.js', 'portfolio-pdf.js', 'portfolio.js']);
});


test('retired saved entry methods retain allocations and require an explicit replacement before simulation', async () => {
  for (const method of ['entry_option', 'entry_volatility', 'entry_breadth', 'entry_composite']) {
    const f = uiFixture(input => { input.config.initialMethod = method; });
    const fetches = [], originalFetch = f.context.fetch;
    f.context.fetch = async (url, options) => { fetches.push(url); return originalFetch(url, options); };
    let html = f.ui.view(f.helpers);
    assert.match(html, /本金投入方式：已撤回，请重新选择/);
    assert.match(html, /未证明优于一次性投入，请重新选择本金投入方式/);
    assert.doesNotMatch(html, /data-value="entry_/);
    await f.action('run'); await f.action('export-pdf');
    assert.equal(fetches.length, 0); assert.equal(f.reports.length, 0);
    assert.match(f.ui.view(f.helpers), /原研究投入方式已撤回/);
    await f.action('select', { field: 'initialMethod', value: 'tranche_6' });
    await f.action('run'); await f.action('export-pdf');
    const result = f.reports.at(-1).result;
    assert.equal(result.config.initialMethod, 'tranche_6');
    assert.deepEqual(result.config.positions, f.input.config.positions);
    assert.equal(result.config.initial, f.input.config.initial);
    assert.equal(result.config.monthly, f.input.config.monthly);
    assert.equal(result.entryOpportunity, undefined);
    assert.equal(result.entryPlan, undefined);
    assert.equal(fetches.some(url => url.includes('entry-context')), false);
    html = f.ui.view(f.helpers);
    assert.doesNotMatch(html, /综合加仓分数|回撤与期权恐慌|历史研究分数|data-value="entry_/);
  }
});

test('retired imported methods fail explicitly without replacing the current allocation or method', async () => {
  const f = uiFixture();
  const imported = { schemaVersion: 1, ...f.input.config, initialMethod: 'entry_composite', initial: 999,
    positions: f.input.config.positions.map((p, i) => ({ ...p, weight: i === 0 ? 100 : 0 })) };
  const text = JSON.stringify(imported);
  await f.ui.handleChange({ id: 'portfolio-import', files: [{ size: text.length, text: async () => text }] });
  assert.match(f.ui.view(f.helpers), /配置导入失败：原研究投入方式已撤回/);
  await f.action('save');
  const retained = JSON.parse(f.downloads.at(-1)[1]);
  assert.deepEqual(retained.positions, f.input.config.positions);
  assert.equal(retained.initial, f.input.config.initial);
  assert.notEqual(retained.initialMethod, 'entry_composite');
});
