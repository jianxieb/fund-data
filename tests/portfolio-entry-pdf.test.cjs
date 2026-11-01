const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const T = require('../assets/portfolio-timing-model.js');
const E = require('../assets/portfolio-entry-model.js');
const Pdf = require('../assets/portfolio-pdf.js');
const measure = { font: '', measureText(value) { const size = Number(this.font.match(/ (\d+)px/)[1]); return { width: Array.from(String(value)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : .58), 0) * size }; } };
const textOf = document => document.ops.filter(op => op.type === 'text').map(op => op.value).join('\n');
const pct = n => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
function summary(n, median, nonOverlappingN) {
  return { n, median, p10: median - 17, worstReturn: median - 30, worstDrawdown: -31.17, nonOverlappingN, medianDrawdown: -12.34, p10Drawdown: -23.45 };
}
function fixture() {
  const days = [];
  for (let t = Date.parse('2010-01-01'); t <= Date.parse('2026-10-27'); t += 86400000) {
    const d = new Date(t); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  const asset = { id: 'stock:TEST', code: 'TEST', name: '测试持仓', status: 'available', kind: 'stock', currency: 'CNY', first: days[0], asOf: days.at(-1), sourceUrl: 'https://example.org/price' };
  const history = { schemaVersion: 1, id: asset.id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, Math.exp(i / 2100 + .25 * Math.sin(i / 80))]) };
  const input = { catalog: { assets: [asset] }, histories: { [asset.id]: history }, config: { positions: [{ id: asset.id, weight: 60 }], initial: 100000, monthly: 8000, currency: 'CNY', years: 'common', rebalance: 'none', feeBasis: 'net', transactionFee: 0 } };
  const result = P.simulate(input);
  assert.equal(result.error, undefined);
  result.timing = T.analyze(input, { end: result.end, today: '2026-10-28' });
  result.timing.status = 'available'; result.timing.missing = null;
  result.timing.entry = {
    status: 'available', value: 63.75, asOf: '2026-10-27', version: 'entry-history-rank-v1', usage: 'experimental_history_rank', missing: null,
    feature: { id: 'ma200_deviation_prior_percentile', value: 20 }, trainingN: 96, neighbors: [],
    matched: summary(24, 22.22, 5), baseline: summary(96, 11.11, 10), distanceRange: { min: .12, max: 8.76 }, latestTrainingExit: '2026-09-30',
    history: [{ asOf: '2020-01-31', value: 40.25, actual: { return: 10, drawdown: -20, entry: '2020-02-03', exit: '2021-02-03' } }, { asOf: '2026-09-30', value: 61.15, actual: null }],
    walkForward: { validation: 'historical_replay', predictionMAE: 21.37, baselineMAE: 29.46, rankingCorrelation: .318,
      baseline: summary(60, 16.67, 6), bands: [{ id: 'low', ...summary(10, 3.21, 2) }, { id: 'middle', ...summary(30, 10.43, 4) }, { id: 'high', ...summary(20, 30.21, 3) }], highVsRest: { high: summary(20, 30.21, 3), rest: summary(40, 17.91, 5), medianDifference: 12.3 }, periods: [] }
  };
  return { input, result };
}

test('entry PDF freezes current historical rank and shows matched, training and replay return/risk distributions', () => {
  const { input, result } = fixture(), report = Pdf.snapshot(result, input.catalog, '2026-10-28T02:00:00Z');
  const saved = JSON.stringify(report.result.timing.entry);
  result.timing.entry.value = 0; result.timing.entry.matched.median = -999; result.timing.entry.history[0].value = 0;
  assert.equal(JSON.stringify(report.result.timing.entry), saved);
  const document = Pdf.layout(report, measure), text = textOf(document), entry = report.result.timing.entry;
  assert.match(text, /当前历史买点分/); assert.match(text, /63\.75 \/ 100分/);
  assert.match(text, /截至 2026-10-27 共同收盘 · 持有期1年/); assert.match(text, /entry-history-rank-v1/);
  assert.match(text, /非上涨概率/); assert.match(text, /历史平均相对位置/);
  assert.match(text, /训练池 96个月/); assert.match(text, /相似样本 24个月/); assert.match(text, /最新训练结果结束于 2026-09-30/);
  assert.match(text, /0\.12-8\.76 个百分点/);
  for (const s of [entry.matched, entry.baseline, entry.walkForward.baseline, ...entry.walkForward.bands, entry.walkForward.highVsRest.rest]) {
    for (const key of ['median', 'p10', 'medianDrawdown', 'p10Drawdown', 'worstDrawdown']) assert.ok(text.includes(pct(s[key])), key);
    assert.ok(text.includes('\n' + s.n + '\n'));
  }
  for (const label of ['低于40分', '40至不足60分', '60分及以上', '其余有分月份（不足60分）', '全部有分月份']) assert.ok(text.replace(/\n/g, '').includes(label));
  assert.match(text, /高 12\.30 个百分点/);
  assert.match(text, /相似买点预测平均误差/); assert.match(text, /21\.37 个百分点/);
  assert.match(text, /普通历史基准平均误差/); assert.match(text, /29\.46 个百分点/);
  assert.ok(text.replace(/\n/g, '').includes('分数与后来收益的秩相关'));
  assert.ok(text.includes('0.32')); assert.match(text.replace(/\n/g, ''), /相关为正也不等于模型已经验证/);
  const path = document.ops.find(op => op.role === 'entry-history');
  assert.equal(path.points.length, 2); assert.ok(path.points.flat().every(Number.isFinite));
  assert.match(text.replace(/\n/g, ''), /不是真正未见数据的样本外验证/);
  assert.match(text, /未计交易费和投资者税/); assert.match(text, /不重叠窗口数也不代表完全独立/);
  assert.doesNotMatch(text, /已撤回|当前无经过验证|旧规则|add-score-v1|暂缓额外加仓|小额分批候选|优先分批候选|NaN|Infinity|undefined/);
  assert.match(text, /模拟账户期末仓位/); assert.ok(document.links.some(link => link.url === 'https://example.org/price'));
  for (const op of document.ops.filter(op => op.type === 'text')) {
    measure.font = op.weight + ' ' + op.size + 'px Arial';
    const w = measure.measureText(op.value).width, left = op.align === 'right' ? op.x - w : op.align === 'center' ? op.x - w / 2 : op.x;
    assert.ok(left >= 0 && left + w <= document.width, op.value);
    assert.ok(op.y + op.h <= document.height, op.value);
  }
});

test('PDF renders the actual entry model contract, including small or empty replay groups', () => {
  const { input, result } = fixture();
  result.timing.entry = E.analyze(result.timing);
  const entry = result.timing.entry;
  assert.equal(entry.status, 'available'); assert.ok(Number.isFinite(entry.value));
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure)).replace(/\n/g, '');
  assert.ok(text.includes(entry.value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' / 100分'));
  assert.ok(text.includes(entry.version)); assert.ok(text.includes(pct(entry.matched.median)));
  assert.ok(text.includes(pct(entry.matched.p10Drawdown)));
  assert.ok(text.includes('训练池 ' + entry.trainingN + '个月'));
  assert.ok(text.includes('相似样本 ' + entry.matched.n + '个月'));
  assert.match(text, /截至当时共同收盘已成熟/);
  assert.doesNotMatch(text, /已撤回|旧规则|当前无经过验证|NaN|Infinity|undefined/);
});

test('entry PDF never revives a score from stale timing, missing data or unavailable entry payloads', () => {
  for (const state of ['stale-timing', 'missing-entry', 'unavailable-entry']) {
    const { input, result } = fixture();
    if (state === 'stale-timing') { result.timing.status = 'stale'; result.timing.missing = '缺最近行情'; }
    else if (state === 'missing-entry') result.timing.entry.missing = '仅有35个成熟月份，缺36个月训练样本';
    else result.timing.entry.status = 'insufficient';
    const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
    assert.match(text, /暂缺当前分数/); assert.doesNotMatch(text, /63\.75 \/ 100分/);
    if (state === 'stale-timing') assert.match(text, /缺最近行情/);
    if (state === 'missing-entry') assert.match(text, /仅有35个成熟月份/);
    assert.match(text, /模拟账户期末仓位/); assert.match(text, /逐月历史买点分/);
    assert.doesNotMatch(text, /已撤回|当前无经过验证|add-score-v1/);
  }
});

test('historical entry PDF labels the chosen date and missing replay outcomes without legacy conclusions', () => {
  const { input, result } = fixture();
  result.timing.historical = true;
  result.timing.entry.asOf = result.timing.end = '2020-01-31';
  result.timing.entry.history = [];
  result.timing.entry.walkForward = { validation: 'historical_replay', bands: [], periods: [] };
  result.timing.entry.matched = null; result.timing.entry.baseline = null;
  const text = textOf(Pdf.layout(Pdf.snapshot(result, input.catalog), measure));
  assert.match(text, /指定历史时点的买点分/); assert.match(text, /截至 2020-01-31 共同收盘/);
  assert.match(text, /分数只对应所选日期/);
  assert.match(text, /缺满足训练条件的历史月份/); assert.match(text, /缺完整结束的一年后续样本/);
  assert.match(text, /模拟账户期末仓位 · 2026-10-27/);
  assert.doesNotMatch(text, /当前历史买点分|已撤回|NaN|Infinity|undefined/);
});
