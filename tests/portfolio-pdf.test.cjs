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

function uiFixture(configure) {
  const { input } = fixture(), downloads = [], notices = [], reports = [], renderStates = [];
  if (configure) configure(input);
  const context = { window: { Changheng: M, ChanghengPortfolioModel: P, ChanghengPortfolioTimingModel: require('../assets/portfolio-timing-model.js'), ChanghengPortfolioScoreView: require('../assets/portfolio-score-view.js'), PORTFOLIO_CATALOG: input.catalog,
    ChanghengPortfolioPdf: { snapshot: Pdf.snapshot, async create(report) { reports.push(report); return new Blob(['PDF']); } } },
    localStorage: { getItem: () => JSON.stringify(input.config), setItem() {} },
    document: { getElementById: () => null, querySelectorAll: () => [] }, TextEncoder,
    fetch: async url => ({ ok: true, text: async () => url === 'data/portfolio/catalog.js' ? 'var PORTFOLIO_CATALOG=' + JSON.stringify(input.catalog) + ';' : JSON.stringify(Object.values(input.histories).find(h => input.catalog.assets.find(a => a.id === h.id).historyUrl === url)) }) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../assets/portfolio.js'), 'utf8'), context);
  const ui = context.window.ChanghengPortfolio;
  const helpers = { esc: String, action: (label, act, cls, extra = '') => '<button data-action="' + act + '" ' + extra + '>' + label + '</button>',
    annual: true, annualControl: '', pct: String, pc: String, money: String, card: (title, subtitle, html) => html,
    stat: (label, value, unit, note) => '<article class="stat"><strong>' + label + '</strong><b>' + value + '</b><small>' + note + '</small></article>', lazyRows: (key, rows, render) => rows.map(render).join(''), loadFooter: () => '', resetList() {},
    toast: message => notices.push(message), download: (...args) => downloads.push(args),
    render: () => renderStates.push(ui.view(helpers)) };
  ui.view(helpers);
  const action = (name, extras = {}) => ui.handleAction({ dataset: { action: 'portfolio-' + name, ...extras } });
  const monthly = value => ui.handleInput({ id: 'portfolio-monthly', value: String(value), dataset: { portfolioField: 'monthly' } });
  return { ui, action, monthly, context, helpers, downloads, notices, reports, renderStates, input };
}

function timingUiFixture(configure) {
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

test('historical timing review labels its date and suppresses present-day buy and sell advice', async () => {
  const f = timingUiFixture(input => Object.assign(input.config, { years: 'custom', start: '2024-01-01', end: '2025-01-08' }));
  const T = require('../assets/portfolio-timing-model.js');
  let timing;
  f.context.window.ChanghengPortfolioTimingModel = { analyze(input, options) {
    timing = T.analyze(input, { ...options, today: '2026-10-28' }); return timing;
  } };
  await f.action('run');
  const html = f.ui.view(f.helpers), account = P.simulate(f.input);
  assert.equal(timing.historical, true);
  assert.ok(account.holdings.some(h => h.actualWeight - h.targetWeight > 5));
  assert.match(html, /截至 2025-01-08 共同收盘/);
  assert.match(html, /历史时点加仓评分/);
  assert.match(html, /缺可靠长期分位/);
  assert.doesNotMatch(html, /优先考虑卖出超配部分|可按原计划分批投入|缺最近行情/);
});

test('stale quotes suppress the overweight sell recommendation while retaining dated exposure evidence', async () => {
  const f = timingUiFixture(), T = require('../assets/portfolio-timing-model.js');
  let timing;
  f.context.window.ChanghengPortfolioTimingModel = { analyze(input, options) {
    timing = T.analyze(input, { ...options, today: '2026-10-28' }); return timing;
  } };
  await f.action('run');
  const html = f.ui.view(f.helpers), account = P.simulate(f.input);
  assert.equal(timing.status, 'stale'); assert.equal(timing.historical, false);
  assert.ok(account.cashWeight - account.cash / account.grossValue * 100 > 5);
  assert.match(html, /最新共同报价为 2026-01-08/);
  assert.match(html, /当前评分不可用/);
  assert.match(html, /模拟账户的期末风险 · 2026-01-08/);
  assert.match(html, /每笔投入预留现金，不代表账户一直保持该现金比例/);
  assert.doesNotMatch(html, /优先考虑卖出超配部分|可按原计划分批投入/);
});

test('timing evidence names each missing forward horizon even when current position metrics are available', async () => {
  const f = timingUiFixture(), T = require('../assets/portfolio-timing-model.js');
  f.context.window.ChanghengPortfolioTimingModel = { analyze(input, options) {
    const timing = T.analyze(input, { ...options, today: options.end });
    // Isolate rendering of a valid current diagnostic with no matured matches.
    return { ...timing, status: 'available', missing: null, band: 'low', latest: { ...timing.latest, percentile: 10 } };
  } };
  await f.action('run');
  const html = f.ui.view(f.helpers);
  assert.match(html, /分组缺完整 1 年后续样本/);
  assert.match(html, /分组缺完整 3 年后续样本/);
  assert.match(html, /0 个月<small>不重叠 0 个/);
  assert.match(html, /正收益比例不是未来胜率/);
  const diagnostic = html.match(/<section><h2>加仓评分<\/h2>[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(diagnostic, /NaN|undefined/);
});

test('mixed-market timing labels the common close separately from the later account valuation date', async () => {
  const f = timingUiFixture(input => {
    const asset = input.catalog.assets[1], history = input.histories[asset.id];
    history.series = history.series.filter(([day]) => day !== '2026-01-08');
    history.series.push(['2026-01-09', history.series.at(-1)[1] * 1.01]);
    history.asOf = asset.asOf = '2026-01-09';
  });
  const T = require('../assets/portfolio-timing-model.js');
  let timing;
  f.context.window.ChanghengPortfolioTimingModel = { analyze(input, options) {
    timing = T.analyze(input, { ...options, today: '2026-01-09' }); return timing;
  } };
  await f.action('run');
  const html = f.ui.view(f.helpers), account = P.simulate(f.input);
  assert.equal(account.end, '2026-01-08'); assert.equal(timing.end, '2026-01-07');
  assert.match(html, /截至 2026-01-07 共同收盘/);
  assert.match(html, /模拟账户的期末风险 · 2026-01-08/);
  assert.match(html, /账户净值相对200日均线 [^<]+ · 回撤 [^<]+（2026-01-07）/);
});

test('timing renders distinct reference metrics and the actual drifting account instead of reusing target weights', async () => {
  const f = timingUiFixture(), T = require('../assets/portfolio-timing-model.js');
  let timing;
  f.context.window.ChanghengPortfolioTimingModel = { analyze(input, options) {
    timing = T.analyze(input, { ...options, today: options.end }); return timing;
  } };
  await f.action('run');
  const html = f.ui.view(f.helpers), account = P.simulate(f.input), fmt = f.helpers.pct;
  const latest = account.curve.at(-1), ma = account.curve.slice(-200).reduce((total, point) => total + point.nav, 0) / 200;
  const accountDeviation = (latest.nav / ma - 1) * 100;
  assert.notEqual(fmt(timing.latest.deviation), fmt(accountDeviation));
  assert.match(html, /不参与加仓评分/);
  assert.ok(html.includes('账户净值相对200日均线 ' + fmt(accountDeviation) + ' · 回撤 ' + fmt(latest.drawdown)));
  for (const holding of account.holdings) {
    assert.ok(html.includes(holding.code + ' ' + fmt(holding.grossValue / account.grossValue * 100) + '（目标 ' + fmt(holding.targetWeight) + '）'));
  }
  assert.ok(html.includes('现金 ' + fmt(account.cash / account.grossValue * 100) + '（目标 40.00%）'));
  assert.match(html, /目标组合 · 人民币 · 每次模拟按行情重算/);
});

function scoreUiFixture() {
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

test('a page kept open revalidates the manifest and recomputes from new histories 100 days later', async () => {
  const f = scoreUiFixture(), T = require('../assets/portfolio-timing-model.js'), fetches = [], originalFetch = f.context.fetch;
  f.context.fetch = async (url, options) => { fetches.push({ url, options }); return originalFetch(url); };
  let today = '2026-01-08', timing;
  f.context.window.ChanghengPortfolioTimingModel = { ...T, analyze(input, options) { timing = T.analyze(input, { ...options, today }); return timing; } };
  await f.action('run');
  const firstScore = timing.scoring.value, priorHistory = JSON.stringify(timing.scoring.history);
  assert.equal(timing.status, 'available'); assert.ok(Number.isFinite(firstScore));
  await f.action('run');
  assert.equal(fetches.filter(r => r.url.endsWith('.json')).length, 2, 'unchanged hashes reuse the two selected histories');
  assert.equal(fetches.filter(r => r.url === 'data/portfolio/catalog.js').length, 2);
  assert.ok(fetches.filter(r => r.url === 'data/portfolio/catalog.js').every(r => r.options.cache === 'no-store'));
  today = '2026-04-18';
  for (const [k, a] of f.input.catalog.assets.entries()) {
    const h = f.input.histories[a.id], base = h.series.at(-1)[1];
    for (let t = Date.parse('2026-01-09'), i = 1; t <= Date.parse(today); t += 86400000, i++) {
      if ([0, 6].includes(new Date(t).getUTCDay())) continue;
      h.series.push([new Date(t).toISOString().slice(0, 10), base * Math.exp(-i * .009 - .02 * Math.sin(i * (1 + k)))]);
    }
    h.asOf = a.asOf = h.series.at(-1)[0]; a.sha256 = 'v2-' + a.id;
    a.historyUrl = a.historyUrl.replace('.json', '-v2.json');
  }
  await f.action('run');
  assert.equal(fetches.filter(r => r.url.endsWith('.json')).length, 4, 'changed content reloads selected histories');
  assert.equal(timing.end, '2026-04-17'); assert.equal(timing.status, 'available');
  assert.notEqual(timing.scoring.value, firstScore); assert.ok(timing.scoring.value <= 39);
  assert.equal(JSON.stringify(timing.scoring.history.filter(p => p.day <= '2026-01-08')), priorHistory);
  await f.action('export-pdf');
  assert.equal(f.reports.at(-1).result.timing.scoring.value, timing.scoring.value);
  await f.action('export-score');
  const exported = f.downloads.find(row => row[0].includes('加仓评分'));
  assert.match(exported[1], /add-score-v1/); assert.match(exported[1], /2026-04-17/);
  assert.match(exported[1], /长期位置分\/40/); assert.match(exported[1], /上限39分/);
});

test('failed freshness checks retain historical results but disable current score, band and gate', async () => {
  const f = scoreUiFixture(), T = require('../assets/portfolio-timing-model.js'), originalFetch = f.context.fetch;
  f.context.window.ChanghengPortfolioTimingModel = { ...T, analyze: (input, options) => T.analyze(input, { ...options, today: options.end }) };
  await f.action('run');
  f.context.fetch = async url => url === 'data/portfolio/catalog.js' ? { ok: false, status: 503 } : originalFetch(url);
  await f.action('run'); await f.action('export-pdf');
  const t = f.reports.at(-1).result.timing;
  assert.equal(t.status, 'stale'); assert.equal(t.scoring.value, null); assert.equal(t.scoring.band, null);
  assert.equal(t.scoring.gate.active, false); assert.ok(t.scoring.evidence.horizons.every(h => h.current === null));
  assert.ok(t.scoring.history.length > 0); assert.match(t.scoring.missing, /未能确认最新行情.*503/);
  const html = f.ui.view(f.helpers);
  assert.match(html, /当前评分不可用/); assert.match(html, /过往评分记录/);
  assert.equal(f.reports.at(-1).result.catalogRefresh.available, false);
});

test('history slider changes only its dated readout and cursor, leaving the current score and configuration intact', async () => {
  const f = scoreUiFixture(), T = require('../assets/portfolio-timing-model.js');
  let timing;
  f.context.window.ChanghengPortfolioTimingModel = { ...T, analyze(input, options) { timing = T.analyze(input, { ...options, today: options.end }); return timing; } };
  await f.action('run');
  const nodes = Object.fromEntries(['portfolio-score-readout', 'portfolio-score-cursor', 'portfolio-score-point'].map(id => [id, { setAttribute(k, v) { this[k] = v; } }]));
  f.context.document.getElementById = id => nodes[id] || null;
  const slider = { dataset: { portfolioScoreDay: '' }, value: '0', setAttribute(k, v) { this[k] = v; } };
  const before = JSON.stringify(timing), renders = f.renderStates.length;
  f.ui.handleInput(slider);
  assert.match(nodes['portfolio-score-readout'].textContent, new RegExp(timing.scoring.history[0].day));
  assert.equal(nodes['portfolio-score-cursor'].x1, 44); assert.equal(nodes['portfolio-score-point'].cx, 44);
  assert.equal(slider['aria-valuetext'], nodes['portfolio-score-readout'].textContent);
  assert.equal(JSON.stringify(timing), before); assert.equal(f.renderStates.length, renders);
});

test('failure downloading a newly published history invalidates the previous current score until a successful rerun', async () => {
  const f = scoreUiFixture(), T = require('../assets/portfolio-timing-model.js'), originalFetch = f.context.fetch;
  f.context.window.ChanghengPortfolioTimingModel = { ...T, analyze: (input, options) => T.analyze(input, { ...options, today: options.end }) };
  await f.action('run');
  f.input.catalog.assets[0].sha256 = 'updated-content';
  f.context.fetch = async url => url === f.input.catalog.assets[0].historyUrl ? { ok: false, status: 503 } : originalFetch(url);
  await f.action('run');
  const html = f.ui.view(f.helpers);
  assert.match(html, /本次行情更新失败：两倍测试ETF：历史文件请求失败（503）/);
  assert.match(html, /当前评分不可用/); assert.doesNotMatch(html, /<strong>\d+<\/strong><span>\/ 100/);
  f.context.fetch = originalFetch;
  await f.action('run'); await f.action('export-pdf');
  assert.equal(f.reports.at(-1).result.timing.status, 'available');
  assert.ok(Number.isFinite(f.reports.at(-1).result.timing.scoring.value));
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
