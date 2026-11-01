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

test('an actual experimental entry model cannot appear in a production PDF, including old snapshots', () => {
  const { input, result } = fixture();
  result.timing.entry = E.analyze(result.timing);
  assert.equal(result.timing.entry.status, 'available'); assert.ok(Number.isFinite(result.timing.entry.value));
  const report = Pdf.snapshot(result, input.catalog, '2026-10-28T02:00:00Z');
  const oldTiming = report.result.timing;
  delete report.result.timing;
  const accountOnly = Pdf.layout(report, measure);
  report.result.timing = oldTiming;
  const actual = Pdf.layout(report, measure), text = textOf(actual);
  assert.deepEqual(actual, accountOnly);
  assert.doesNotMatch(text, /历史买点分|买点历史分|平均误差|秩相关|已撤回|当前无经过验证|add-score-v1|entry-percentile-knn-v1/);
  assert.match(text, /模拟账户的期末风险/);
  assert.ok(actual.links.some(link => link.url === 'https://example.org/price'));
});

test('even favorable or newly labeled legacy entry payloads cannot restore score cards, charts or advice', () => {
  const { input, result } = fixture(), report = Pdf.snapshot(result, input.catalog, '2026-10-28T02:00:00Z');
  delete report.result.timing;
  const expected = Pdf.layout(report, measure);
  for (const status of ['available', 'stale', 'insufficient', 'error']) {
    report.result.timing = { status, historical: true, end: '2020-01-31', scoring: { value: 99, band: { label: '优先分批候选' } },
      entry: { status, value: 99, version: 'future-unverified-model', label: '最好的买点', usage: 'experimental_history_rank',
        history: [{ asOf: '2020-01-31', value: 99 }], walkForward: { predictionMAE: 0, baselineMAE: 100, rankingCorrelation: 1 } } };
    const document = Pdf.layout(report, measure);
    assert.deepEqual(document, expected);
    assert.ok(!document.ops.some(op => op.role === 'entry-history' || op.role === 'score-history'));
    assert.doesNotMatch(textOf(document), /最好的买点|优先分批候选|99 \/ 100分|future-unverified-model|2020-01-31/);
  }
});
