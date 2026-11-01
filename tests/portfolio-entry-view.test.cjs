const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../assets/portfolio-entry-view.js');
const summary = { n: 24, nonOverlappingN: 3, median: 12.25, p10: -9, worstReturn: -15, medianDrawdown: -14, worstDrawdown: -30 };
function fixture() {
  return { status: 'available', end: '2026-10-30', latest: { drawdown: -20 }, entry: {
    status: 'available', value: 56.439, asOf: '2026-10-30', feature: { value: 14.7 }, trainingN: 143, matched: summary, baseline: { ...summary, n: 143, median: 10 },
    neighbors: [{ signal: '2020-01-31', entry: '2020-02-03', exit: '2021-02-03', return: 12, rank: 56, distance: 0.1 }],
    history: [{ asOf: '2020-01-31', value: 44, trainingN: 60, actual: { return: -5 } }, { asOf: '2026-09-30', value: 57, trainingN: 142, actual: null }],
    walkForward: { predictionMAE: 20.1, baselineMAE: 18, rankingCorrelation: -0.1, baseline: { ...summary, n: 95 }, bands: ['low','middle','high'].map(id => ({ ...summary, id })), highVsRest: { high: { n: 0 }, rest: summary, medianDifference: null }, periods: [] }
  }};
}
test('history-derived rank, risk and failed continuous prediction comparison are visible without withdrawal notice or advice', () => {
  const html = V.render(fixture());
  assert.match(html, /56\.4/); assert.match(html, /非上涨概率/); assert.match(html, /12\.25%/); assert.match(html, /-9\.00%/);
  assert.match(html, /平均误差没有更小/); assert.match(html, /20\.10 个百分点/); assert.match(html, /18\.00 个百分点/);
  assert.match(html, /-0\.10/); assert.match(html, /24 个月/);
  assert.doesNotMatch(html, /当前没有通过验证|旧规则|优先分批|暂缓额外加仓|胜率/);
  assert.match(html, /2020-01-31/); assert.match(html, /2021-02-03/);
});
test('stale and missing data hide latest score and matched stats, retaining dated replay', () => {
  for (const status of ['stale', 'error', 'future', 'insufficient']) {
    const t = fixture(); t.status = status; t.entry.missing = '缺最新共同收盘';
    const html = V.render(t);
    assert.doesNotMatch(html, /56\.4|12\.25%<\/strong>/); assert.match(html, /缺最新共同收盘/);
    assert.match(html, /逐月重演/);
  }
});
test('historical mode, escaped fields and slider make observation and maturity explicit', () => {
  const t = fixture(); t.historical = true; t.entry.neighbors[0].signal = '<img onerror=1>';
  assert.match(V.render(t), /历史时点 · 买点历史分/); assert.doesNotMatch(V.render(t), /<img/);
  const before = JSON.stringify(t), first = V.inspect(t, 0), last = V.inspect(t, 99);
  assert.equal(first.x, 44); assert.match(first.text, /2020-01-31.*44.0.*-5.00%/);
  assert.equal(last.x, 982); assert.match(last.text, /尚未走完/); assert.equal(JSON.stringify(t), before);
});
