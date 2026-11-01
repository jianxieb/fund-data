const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const T = require('../assets/portfolio-timing-model.js');
const Pdf = require('../assets/portfolio-pdf.js');
const measure = { font: '', measureText(value) { const size = Number(this.font.match(/ (\d+)px/)[1]); return { width: Array.from(String(value)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : .58), 0) * size }; } };
const textOf = document => document.ops.filter(op => op.type === 'text').map(op => op.value).join('\n');
const pct = n => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const advice = /暂缓额外加仓|观察，维持原计划|小额分批候选|优先分批候选|优先考虑分批加仓|适合加仓|当前加仓评分|评分只提供固定条件参考/;
function fixture() {
  const days = [];
  for (let time = Date.parse('2010-01-01'); time <= Date.parse('2026-10-27'); time += 86400000) {
    const d = new Date(time); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  const assets = [0, 1].map(i => ({ id: 'stock:' + i, code: 'TEST' + i, name: '测试持仓' + i, status: 'available', kind: 'stock', currency: 'CNY', first: days[0], asOf: days.at(-1), sourceUrl: 'https://example.org/price' }));
  const histories = Object.fromEntries(assets.map((a, k) => [a.id, { schemaVersion: 1, id: a.id, currency: a.currency, basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, Math.exp(i / (1800 + 300 * k) + .25 * Math.sin(i / (80 + 10 * k)))]) }]));
  const input = { catalog: { assets }, histories, config: { positions: assets.map(a => ({ id: a.id, weight: 30 })), initial: 100000, monthly: 8000, currency: 'CNY', years: 'common', rebalance: 'none', feeBasis: 'net', transactionFee: 0 } };
  const result = P.simulate(input); assert.equal(result.error, undefined);
  result.timing = T.analyze(input, { end: result.end, today: '2026-10-28' });
  return { input, result };
}

const scoringCopy = /历史买点分|买点历史分|规则分|加仓评分|已撤回|add-score-v1|entry-percentile-knn-v1|优先分批候选|暂缓额外加仓/;

test('PDF ignores all legacy timing payloads and produces exactly the account-only report', () => {
  const { input, result } = fixture(), report = Pdf.snapshot(result, input.catalog, '2026-10-28T02:00:00Z');
  const legacy = report.result.timing;
  delete report.result.timing;
  const expected = Pdf.layout(report, measure);
  for (const timing of [legacy, { ...legacy, historical: true }, { ...legacy, status: 'stale', missing: '历史买点模型未加载' }, { status: 'error', missing: '缺可靠长期分位' }]) {
    report.result.timing = timing;
    const before = JSON.stringify(report), document = Pdf.layout(report, measure);
    assert.deepEqual(document, expected);
    assert.equal(JSON.stringify(report), before);
    assert.doesNotMatch(textOf(document), scoringCopy);
    assert.doesNotMatch(textOf(document), /历史买点模型未加载|缺可靠长期分位/);
    assert.match(textOf(document), /模拟账户的期末风险/);
  }
});

test('PDF account risk uses gross market weights and a factual cash shortfall without trading instructions', () => {
  const { input, result } = fixture();
  Object.assign(result, { grossValue: 100000, value: 80000, cash: 20000 });
  result.holdings[0].grossValue = 70000; result.holdings[1].grossValue = 10000;
  const document = Pdf.layout(Pdf.snapshot(result, input.catalog), measure), text = textOf(document);
  const start = text.indexOf('模拟账户的期末风险'), end = text.indexOf('区间快照', start), risk = text.slice(start, end);
  for (const value of ['70.00%', '10.00%', '20.00%']) assert.ok(risk.includes(value));
  assert.doesNotMatch(risk, /87\.50%|12\.50%|25\.00%/);
  assert.match(risk, /实际现金低于目标至少5个百分点/);
  assert.ok(risk.includes('期末回撤 ' + pct(result.curve.at(-1).drawdown)));
  assert.doesNotMatch(risk, /恢复目标权重|优先|分批|均线/);
  assert.doesNotMatch(text, scoringCopy);
  assert.ok(document.links.some(link => link.url === 'https://example.org/price'));
  for (const op of document.ops.filter(op => op.type === 'text')) {
    measure.font = op.weight + ' ' + op.size + 'px Arial';
    const width = measure.measureText(op.value).width, left = op.align === 'right' ? op.x - width : op.align === 'center' ? op.x - width / 2 : op.x;
    assert.ok(left >= 0 && left + width <= document.width, op.value);
    assert.ok(op.y + op.h <= document.height, op.value);
  }
});

test('PDF preserves the exact 5pp exposure threshold and excludes deliberate liquidation from drift warnings', () => {
  const { input, result } = fixture();
  Object.assign(result, { cash: 40000, grossValue: 100000 });
  result.holdings[0].grossValue = 35000; result.holdings[1].grossValue = 25000;
  assert.match(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /部分持仓高于目标至少5个百分点/);
  result.holdings[0].grossValue = 34999; result.holdings[1].grossValue = 25001;
  assert.doesNotMatch(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /部分持仓高于目标至少5个百分点/);
  result.config.tax = { liquidate: true }; result.cash = 100000; result.holdings.forEach(h => { h.grossValue = 0; });
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  assert.match(text, /此模拟已期末清仓，账户为现金/);
  assert.doesNotMatch(text, /实际现金低于目标至少5个百分点|部分持仓高于目标至少5个百分点/);
});

test('PDF uses the account valuation date even when an old analysis stored a different date', () => {
  const { input, result } = fixture();
  result.timing.historical = true; result.timing.end = '2026-10-23';
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)).replace(/\n/g, '');
  assert.match(text, /2026-10-27 · 实际持仓与现金/);
  assert.doesNotMatch(text, /2026-10-23|共同收盘|指定历史时点/);
});

test('PDF keeps saved-history freshness evidence without showing research availability messages', () => {
  const { input, result } = fixture();
  result.catalogRefresh = { available: false, missing: '未能确认最新行情：标的库请求失败（503）。本次模拟使用已保存的历史数据。' };
  result.timing = { status: 'error', missing: '研究组件未加载' };
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  assert.match(text, /标的库请求失败（503）/); assert.match(text, /本次模拟使用已保存的历史数据/);
  assert.doesNotMatch(text, /研究组件未加载/); assert.doesNotMatch(text, scoringCopy);
});
