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
    ChanghengPortfolioPdf: { snapshot: Pdf.snapshot, async create(report) { reports.push(report); return new Blob(['PDF']); } } },
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
  return { ui, action, monthly, context, helpers, downloads, notices, reports, renderStates, input };
}

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
  await f.action('run');
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
    await f.action('run');
    const html = f.ui.view(f.helpers);
    assert.match(html, expected); assert.doesNotMatch(html, /class="badge">待执行/);
    assert.match(html, /2020和2022两个历史事件/);
  }
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
    await f.action('run');
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
  await f.action('run');
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
  await f.action('run'); await f.action('export-pdf');
  const html = f.ui.view(f.helpers);
  assert.equal(html.match(/role="alert">([^<]*)/)?.[1], undefined);
  const plan = f.reports[0].result.nextTopupPlan;
  assert.ok(plan && plan.orders.length === 2);
  for (const order of plan.orders) assert.ok(html.includes(String(order.amount)));
  assert.ok(html.includes(String(plan.fee))); assert.ok(html.includes(plan.signalDay + '收盘确定'));
  assert.match(html, /金额已确定；成交价格变化会使实际仓位偏离目标/);
});

test('normal and historical simulations export the same account risk shown in the result', async () => {
  for (const historical of [false, true]) {
    const f = accountUiFixture(input => { if (historical) Object.assign(input.config, { years: 'custom', start: '2024-01-01', end: '2025-01-08' }); });
    await f.action('run'); await f.action('export-pdf');
    assert.equal(f.reports.length, 1);
    const report = f.reports[0], html = f.ui.view(f.helpers);
    assert.equal(report.result.timing, undefined);
    assert.match(html, /模拟账户的期末风险/); assert.ok(html.includes(report.result.end));
    assert.doesNotMatch(html, scoreUi);
    assert.equal((html.match(/href="docs\/portfolio-method\.md"/g) || []).length, 1);
  }
});

test('the standalone risk card uses actual gross holdings, cash drift and account drawdown', async () => {
  const f = accountUiFixture(input => {
    input.config.tax = { cnFundCapitalGains: 30, cnStockCapitalGains: 30 };
    for (const h of Object.values(input.histories)) h.dividendEvidence = { status: 'recorded', first: h.first, through: h.asOf, fractions: {} };
  });
  await f.action('run');
  const html = f.ui.view(f.helpers), account = P.simulate(f.input), fmt = f.helpers.pct;
  const card = html.match(/<section><h2>模拟账户的期末风险<\/h2>[\s\S]*?<\/section>/)[0];
  assert.ok(account.cashWeight - account.cash / account.grossValue * 100 >= 5);
  assert.ok(account.taxReserve > 0 && account.grossValue > account.value);
  assert.ok(card.includes('期末回撤 ' + fmt(account.curve.at(-1).drawdown)));
  assert.ok(card.includes('实际现金 ' + fmt(account.cash / account.grossValue * 100)));
  for (const holding of account.holdings) assert.ok(card.includes(holding.code + ' ' + fmt(holding.grossValue / account.grossValue * 100) + '（目标 ' + fmt(holding.targetWeight) + '）'));
  assert.match(card, /仓位按未减浮盈预留税的市值计算/);
  assert.match(card, /实际现金低于目标至少5个百分点/);
  assert.doesNotMatch(card, /优先考虑卖出|恢复目标权重|分批加仓|200日均线/);
  assert.doesNotMatch(card, scoreUi);
});

test('mixed-market risk facts use the simulation valuation date without a reference signal date', async () => {
  const f = accountUiFixture(input => {
    const asset = input.catalog.assets[1], history = input.histories[asset.id];
    history.series = history.series.filter(([day]) => day !== '2026-01-08');
    history.series.push(['2026-01-09', history.series.at(-1)[1] * 1.01]);
    history.asOf = asset.asOf = '2026-01-09';
  });
  await f.action('run'); await f.action('export-pdf');
  const report = f.reports[0], html = f.ui.view(f.helpers);
  assert.equal(report.result.end, '2026-01-08');
  assert.match(html, /模拟账户的期末风险/); assert.match(html, /2026-01-08 · 人民币 · 实际持仓与现金/);
  assert.ok(html.includes('期末回撤 ' + f.helpers.pct(report.result.curve.at(-1).drawdown)));
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
  assert.match(html, /模拟账户的期末风险/); assert.doesNotMatch(html, scoreUi);
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
  assert.match(annual, /按实际投入时间和金额计算/); assert.match(annual, /现金流中性 · 对照持有/);
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
  assert.match(f.ui.view(f.helpers), /初始投入 · 美元/);
  await f.action('run');
  const html = f.ui.view(f.helpers), expected = P.simulate(f.input);
  assert.ok(expected.taxReserve > 0);
  assert.match(html, /期末税后估值/); assert.match(html, /浮盈预留税/);
  assert.doesNotMatch(html, /浮盈未征税|期末市值 \/ 元/);
  assert.match(html, /税后估值 \/ USD/);
  await f.action('export-pdf');
  const report = f.reports[0], text = textOf(Pdf.layout(report, measure));
  assert.equal(report.result.currency, 'USD');
  assert.equal(report.result.taxReserve, expected.taxReserve);
  assert.match(text, /初始投入 \/ USD/); assert.match(text, /浮盈预留税 \/ USD/);
  assert.match(text, /税后估值与累计投入 \/ 美元/);
  assert.doesNotMatch(text, /人民币现金|\/ 元|NaN|undefined/);
  await f.action('select', { field: 'currency', value: 'CNY' });
  const stale = f.ui.view(f.helpers);
  assert.match(stale, /投入与计价币种：人民币 CNY/); assert.match(stale, /上次模拟结果/);
  assert.match(stale, /税后估值 \/ USD/);
  await f.action('export-result');
  const curveCsv = f.downloads.at(-1)[1];
  assert.match(curveCsv, /税后估值USD/); assert.match(curveCsv, /当前浮盈预留税USD/);
  assert.doesNotMatch(curveCsv.split('\n')[0], /CNY/);
  await f.action('export-holdings');
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
  assert.deepEqual(assets, ['portfolio-systematic.js', 'portfolio-model.js', 'portfolio-pdf.js', 'portfolio.js']);
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
