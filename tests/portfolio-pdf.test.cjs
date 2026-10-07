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
  const input = { catalog: { assets, summary: { total: assets.length } }, histories, config };
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
    '初始投入 + 每月追加', '每季度', '策略年化收益', '累计投入收益', '近3年', '近5年', '两倍测试ETF']) assert.ok(text.includes(value), value);
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

function uiFixture() {
  const { input } = fixture(), downloads = [], notices = [], reports = [], renderStates = [];
  const context = { window: { Changheng: M, ChanghengPortfolioModel: P, PORTFOLIO_CATALOG: input.catalog,
    ChanghengPortfolioPdf: { snapshot: Pdf.snapshot, async create(report) { reports.push(report); return new Blob(['PDF']); } } },
    localStorage: { getItem: () => JSON.stringify(input.config), setItem() {} },
    document: { getElementById: () => null }, TextEncoder,
    fetch: async url => ({ ok: true, text: async () => JSON.stringify(Object.values(input.histories).find(h => input.catalog.assets.find(a => a.id === h.id).historyUrl === url)) }) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../assets/portfolio.js'), 'utf8'), context);
  const ui = context.window.ChanghengPortfolio;
  const helpers = { esc: String, action: (label, act, cls, extra = '') => '<button data-action="' + act + '" ' + extra + '>' + label + '</button>',
    annual: true, annualControl: '', pct: String, pc: String, money: String, card: (title, subtitle, html) => html,
    stat: () => '', lazyRows: (key, rows, render) => rows.map(render).join(''), loadFooter: () => '', resetList() {},
    toast: message => notices.push(message), download: (...args) => downloads.push(args),
    render: () => renderStates.push(ui.view(helpers)) };
  ui.view(helpers);
  const action = (name, extras = {}) => ui.handleAction({ dataset: { action: 'portfolio-' + name, ...extras } });
  const monthly = value => ui.handleInput({ id: 'portfolio-monthly', value: String(value), dataset: { portfolioField: 'monthly' } });
  return { ui, action, monthly, context, helpers, downloads, notices, reports, renderStates };
}

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
