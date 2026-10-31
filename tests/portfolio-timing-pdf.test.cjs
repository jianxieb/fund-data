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

test('PDF freezes withdrawn rule audit, all four neutral evidence groups, reference metrics and sample limitations', () => {
  const { input, result } = fixture(), report = Pdf.snapshot(result, input.catalog, '2026-10-28T02:00:00Z');
  const timing = JSON.parse(JSON.stringify(result.timing));
  result.timing.latest.deviation = -999; result.timing.horizons[0].matched.n = -999;
  result.timing.scoring.value = -999; result.timing.scoring.components[0].points = -999; result.timing.scoring.history[0].value = -999;
  assert.deepEqual(report.result.timing, timing);
  const document = Pdf.layout(report, measure), text = textOf(document);
  assert.match(text, /加仓时机检验/); assert.match(text, /截至 2026-10-27 共同收盘/);
  assert.match(text, /当前无经过验证的加仓评分/); assert.match(text, /add-score-v1/);
  assert.match(text, /已撤回的规则分 · 不用于加仓决策/); assert.match(text, /最新规则分（已撤回）/);
  assert.ok(text.includes(timing.scoring.value + ' / 100分'));
  for (const component of timing.scoring.components) {
    assert.ok(text.includes({ location: '长期位置项', trend: '趋势项', stability: '波动项' }[component.id]));
    assert.ok(text.includes(component.points.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' / ' + component.max + '分'));
  }
  assert.match(text, /较20个共同收盘前/); assert.ok(text.includes(timing.scoring.change20.day));
  assert.match(text, /历史检验/); assert.match(text, /旧规则未经过独立样本外验证/);
  for (const key of ['deviation', 'percentile', 'drawdown', 'volatility1y']) assert.ok(text.includes(pct(timing.latest[key])), key);
  assert.match(text, /全部可比月份/); assert.match(text, /不重叠窗口/);
  for (const horizon of timing.scoring.evidence.horizons) for (const group of [...horizon.bands, horizon.baseline]) {
    if (group.min !== undefined) assert.ok(text.replace(/\n/g, '').includes(group.min + '-' + group.max + '规则分'));
    ['median', 'positiveRate', 'worstReturn', 'worstDrawdown'].forEach(key => { if (group[key] !== null) assert.ok(text.includes(pct(group[key])), key); });
    assert.ok(text.includes('\n' + group.n + '\n')); assert.ok(text.includes('\n' + group.nonOverlappingN + '\n'));
  }
  assert.match(text, /均为累计收益/); assert.match(text, /下一共同收盘进入/);
  assert.match(text, /历史正收益比例不是未来胜率/); assert.match(text, /尚未验证扣税费后的择时优势/);
  const history = document.ops.find(op => op.role === 'score-history');
  assert.equal(history.points.length, timing.scoring.history.length);
  assert.ok(history.points.flat().every(Number.isFinite));
  const ys = history.points.map(p => p[1]);
  assert.ok(Math.min(...ys) >= history.y && Math.max(...ys) <= history.y + history.h);
  assert.ok(text.includes(timing.scoring.history[0].day));
  assert.doesNotMatch(text, advice);
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
  assert.match(text, /规则分暂缺/); assert.match(text, /当前无经过验证的加仓评分/);
  assert.ok(!text.includes(result.timing.scoring.value + ' / 100分'));
  assert.doesNotMatch(text, /较20个共同收盘前/);
  assert.match(text, /已撤回规则的历史分数/); // Keep dated audit history without republishing a current score.
  assert.doesNotMatch(text, advice);
  assert.match(text, /不把清仓后的仓位差异作为超配信号/);
  assert.doesNotMatch(text, /配置复核应关注恢复目标权重/);
  result.timing = { status: 'error', missing: '所选基金缺200个共同收盘' };
  assert.match(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /所选基金缺200个共同收盘/);
  assert.match(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /模拟账户期末仓位/);
  delete result.timing;
  assert.doesNotMatch(textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)), /加仓评分/);
});

test('PDF labels historical rule audit, each unmatured group and differing account dates explicitly', () => {
  const { input, result } = fixture();
  result.timing.historical = true; result.timing.end = '2026-10-23';
  result.timing.curve = result.timing.curve.filter(row => row.day <= result.timing.end);
  result.timing.scoring.evidence.horizons.forEach(h => { h.bands.forEach(b => Object.assign(b, { n: 0, positiveRate: null, median: null, p10: null, worstReturn: null, worstDrawdown: null, nonOverlappingN: 0 })); });
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)).replace(/\n/g, '');
  assert.match(text, /历史时点复盘，不能代表今天的买卖时机/);
  assert.match(text, /指定历史时点的规则分/); assert.doesNotMatch(text, advice);
  for (const years of [1, 3]) assert.ok(text.includes('随后' + years + '年：0-39规则分、40-59规则分、60-79规则分、80-100规则分缺完整后续样本。'));
  assert.match(text, /截至 2026-10-23 共同收盘/);
  assert.match(text, /模拟账户期末仓位 · 2026-10-27/);
  assert.match(text, /账户共同收盘 2026-10-23/);
});

test('PDF keeps unsupported results and old caps as audit information, never an actionable score', () => {
  const { input, result } = fixture();
  Object.assign(result.timing.scoring, T.scoreFromMetrics({ value: 80, ma200: 100, ma200Prior20: 110, ma50: 90, percentile: 0, volatilityPercentile: 0 }));
  result.timing.scoring.evidence.assessment = { status: 'not_supported', label: '暂未证实高分更好', detail: '高分组一年收益中位数较低分组低 12.34 个百分点。属于回溯描述，未做样本外验证。', medianDifference: -12.34, high: { nonOverlappingN: 6 }, low: { nonOverlappingN: 8 } };
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)).replace(/\n/g, '');
  assert.match(text, /39 \/ 100分/); assert.match(text, /规则分上限39分/);
  assert.match(text, /原始分 60\.00，封顶扣减 21\.00分/);
  assert.match(text, /历史检验：暂未证实高规则分更好/); assert.match(text, /低 12\.34 个百分点/);
  assert.match(text, /当前无经过验证的加仓评分/); assert.match(text, /不恢复加仓建议/);
  assert.match(text, /规则分不是上涨概率/);
  assert.doesNotMatch(text, advice);
});

test('PDF keeps old snapshots without rules and incomplete rule data explicit without promising a new score', () => {
  const { input, result } = fixture();
  delete result.timing.scoring;
  let text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  assert.match(text, /此旧报告未包含规则分审计记录/); assert.match(text, /旧位置分组/);
  assert.match(text, /当前无经过验证的加仓评分/);
  assert.match(text, /类似月份/); assert.match(text, /模拟账户期末仓位/);
  assert.doesNotMatch(text, /重新运行模拟后可生成评分|NaN|Infinity|undefined/); assert.doesNotMatch(text, advice);
  result.timing.scoring = { version: 'add-score-v1', value: null, missing: '缺可靠长期分位', history: [], components: [] };
  result.timing.status = 'insufficient';
  text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  assert.match(text, /规则分暂缺/); assert.match(text, /缺可靠长期分位/);
  assert.match(text, /历史规则分：缺满足长期分位条件的每日样本/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

test('favorable legacy snapshots cannot restore recommendations through saved labels, actions or descriptive text', () => {
  const { input, result } = fixture();
  const legacy = result.timing.scoring;
  legacy.band = { ...legacy.band, label: '优先分批候选', action: '优先考虑分批加仓' };
  legacy.components.forEach(c => { c.label = '小额分批候选'; c.detail = '适合加仓'; });
  legacy.gate = { active: true, cap: 39, deduction: 10, reason: '暂缓额外加仓' };
  legacy.evidence.assessment = { status: 'favorable', label: '优先分批候选', detail: '适合加仓', medianDifference: 8.5, high: { nonOverlappingN: 10 }, low: { nonOverlappingN: 10 } };
  legacy.evidence.horizons.forEach(h => {
    h.bands.forEach((b, i) => { b.label = ['暂缓额外加仓', '观察，维持原计划', '小额分批候选', '优先分批候选'][i]; b.action = '优先考虑分批加仓'; });
  });
  const report = Pdf.snapshot(result, input.catalog);
  const before = JSON.stringify(report);
  const document = Pdf.layout(report, measure), text = textOf(document).replace(/\n/g, '');
  assert.equal(JSON.stringify(report), before); // Auditing an old report must not rewrite its preserved record.
  assert.match(text, /当前无经过验证的加仓评分/);
  assert.match(text, /已撤回的规则分 · 不用于加仓决策/);
  assert.match(text, /历史高规则分组较有利（仅回溯描述）/);
  assert.match(text, /前者较后者高 8\.50 个百分点/);
  assert.match(text, /即使某组回溯表现较好，也不恢复加仓建议/);
  for (const range of ['0-39', '40-59', '60-79', '80-100']) assert.ok(text.includes(range + '规则分'));
  assert.doesNotMatch(text, advice);
  assert.match(text, /模拟账户期末仓位/); assert.ok(document.links.some(link => link.url === 'https://example.org/price'));
});
