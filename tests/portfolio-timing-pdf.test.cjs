const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const T = require('../assets/portfolio-timing-model.js');
const Pdf = require('../assets/portfolio-pdf.js');
const measure = { font: '', measureText(value) { const size = Number(this.font.match(/ (\d+)px/)[1]); return { width: Array.from(String(value)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : .58), 0) * size }; } };
const textOf = document => document.ops.filter(op => op.type === 'text').map(op => op.value).join('\n');
const pct = n => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
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

test('PDF preserves dated reference metrics, both evidence groups and sample limitations', () => {
  const { input, result } = fixture(), report = Pdf.snapshot(result, input.catalog, '2026-10-28T02:00:00Z');
  const timing = JSON.parse(JSON.stringify(result.timing));
  result.timing.latest.deviation = -999; result.timing.horizons[0].matched.n = -999;
  assert.deepEqual(report.result.timing, timing);
  const document = Pdf.layout(report, measure), text = textOf(document);
  assert.match(text, /买卖时机与长期位置/); assert.match(text, /截至 2026-10-27 共同收盘/);
  for (const key of ['deviation', 'percentile', 'drawdown', 'volatility1y']) assert.ok(text.includes(pct(timing.latest[key])), key);
  assert.match(text, /全部可比月份/); assert.match(text, /不重叠窗口/);
  for (const horizon of timing.horizons) for (const group of [horizon.matched, horizon.baseline]) {
    ['median', 'positiveRate', 'worstReturn', 'worstDrawdown'].forEach(key => { if (group[key] !== null) assert.ok(text.includes(pct(group[key])), key); });
    assert.ok(text.includes('\n' + group.n + '\n')); assert.ok(text.includes('\n' + group.nonOverlappingN + '\n'));
  }
  assert.match(text, /均为累计收益/); assert.match(text, /下一共同收盘进入/);
  assert.match(text, /历史正收益比例不是未来胜率/); assert.match(text, /尚未验证扣税费后的择时优势/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
  for (const op of document.ops.filter(op => op.type === 'text')) {
    measure.font = op.weight + ' ' + op.size + 'px Arial';
    const width = measure.measureText(op.value).width, left = op.align === 'right' ? op.x - width : op.align === 'center' ? op.x - width / 2 : op.x;
    assert.ok(left >= 0 && left + width <= document.width, op.value);
    assert.ok(op.y + op.h <= document.height, op.value);
  }
});

test('PDF allocation review uses gross market weights and 5pp thresholds, including cash shortfall', () => {
  const { input, result } = fixture();
  Object.assign(result, { grossValue: 100000, value: 80000, cash: 20000 });
  result.holdings[0].grossValue = 70000; result.holdings[1].grossValue = 10000;
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  const start = text.indexOf('模拟账户期末仓位'), end = text.indexOf('区间快照', start), allocation = text.slice(start, end);
  assert.match(allocation, /70\.00%/); assert.match(allocation, /10\.00%/); assert.match(allocation, /20\.00%/);
  assert.doesNotMatch(allocation, /87\.50%|12\.50%|25\.00%/);
  assert.match(allocation, /现金低于目标至少5个百分点/); assert.match(allocation, /恢复目标权重/);
  assert.match(allocation.replace(/\n/g, ''), /与买卖时机判断分开/);
  result.cash = 40000; result.holdings[0].grossValue = 35000; result.holdings[1].grossValue = 25000;
  assert.match(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /部分持仓高于目标至少5个百分点/);
  result.holdings[0].grossValue = 34999; result.holdings[1].grossValue = 25001;
  assert.doesNotMatch(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /部分持仓高于目标至少5个百分点/);
});

test('PDF states missing/stale evidence and liquidated accounts without suggesting a fresh timing edge', () => {
  const { input, result } = fixture();
  result.timing.status = 'stale'; result.timing.missing = '最新共同报价为 2026-10-27，缺最近行情，不能判断今天的买卖时机';
  result.config.tax = { liquidate: true };
  Object.assign(result, { cash: 100000, grossValue: 100000 }); result.holdings.forEach(h => { h.grossValue = 0; });
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  assert.match(text, /缺最近行情，不能判断今天的买卖时机/);
  assert.match(text, /不把清仓后的仓位差异作为超配信号/);
  assert.doesNotMatch(text, /配置复核应关注恢复目标权重/);
  result.timing = { status: 'error', missing: '所选基金缺200个共同收盘' };
  assert.match(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /所选基金缺200个共同收盘/);
  delete result.timing;
  assert.doesNotMatch(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /买卖时机与长期位置/);
});

test('PDF labels historical reviews, unmatured matched samples and differing account dates explicitly', () => {
  const { input, result } = fixture();
  result.timing.historical = true; result.timing.end = '2026-10-23';
  result.timing.curve = result.timing.curve.filter(row => row.day <= result.timing.end);
  result.timing.horizons.forEach(h => { h.matched = { n: 0, positiveRate: null, median: null, p10: null, worstReturn: null, worstDrawdown: null, nonOverlappingN: 0 }; });
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)).replace(/\n/g, '');
  assert.match(text, /历史时点复盘，不能代表今天的买卖时机/);
  assert.match(text, /类似位置缺完整1年后续样本/); assert.match(text, /类似位置缺完整3年后续样本/);
  assert.match(text, /截至 2026-10-23 共同收盘/);
  assert.match(text, /模拟账户期末仓位 · 2026-10-27/);
  assert.match(text, /账户共同收盘 2026-10-23/);
});
