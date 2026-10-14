const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../assets/market-history-model.js');

test('historical rank handles ties, endpoints and empty data without a false zero', () => {
  assert.equal(M.percentile([1, 2, 2, 3], 2), 50);
  assert.equal(M.percentile([1, 2, 3], 3), 100 * 2.5 / 3);
  assert.equal(M.percentile([1, 1, 1], 1), 50);
  assert.equal(M.percentile([], 5), null);
  assert.equal(M.percentile([1], NaN), null);
  assert.equal(M.quantile([1, 2, 3, 4], .25), 1.75);
});
test('windows use a fixed report date, exclude future samples and preserve leap-day boundaries', () => {
  assert.equal(M.windowStart('2024-02-29', 5), '2019-02-28');
  const metric = { frequency: 'quarterly', points: [['2019-02-27', 1], ['2019-02-28', 10], ['2023-09-30', 20], ['2025-01-01', 1000]] };
  const s = M.summarize(metric, '2024-02-29', 5);
  assert.equal(s.count, 2);
  assert.equal(s.percentile, 75);
  assert.deepEqual(s.last, ['2023-09-30', 20]);
  assert.equal(s.stale, true);
  assert.equal(s.gaps.length, 1);
  assert.equal(M.summarize(metric, '2010-01-01', 5), null);
});
test('display sampling retains crisis extrema and never bridges a missing quarter', () => {
  const points = Array.from({length: 1000}, (_, i) => [new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), i === 501 ? 10000 : i === 502 ? -10000 : i]);
  const sample = M.downsample(points, 80);
  assert.ok(sample.length <= 80);
  assert.deepEqual(sample[0], points[0]);
  assert.deepEqual(sample.at(-1), points.at(-1));
  assert.ok(sample.some(p => p[1] === 10000));
  assert.ok(sample.some(p => p[1] === -10000));
  assert.equal(M.segments([['2025-06-30', 4], ['2025-09-30', 5], ['2026-10-13', 6]], 'quarterly').length, 2);
});
test('histograms count all observations including repeated maximum and constant series', () => {
  const h = M.histogram([['a', -1], ['b', 0], ['c', 1], ['d', 1]], 2);
  assert.deepEqual(h.counts, [1, 3]);
  const equal = M.histogram([['a', 5], ['b', 5]], 20);
  assert.equal(equal.counts.reduce((a, b) => a + b), 2);
  assert.ok(equal.max > equal.min);
});
test('published indices stay independent and snapshot-only fundamentals have no rank', () => {
  const data = JSON.parse(fs.readFileSync(require.resolve('../data/market-history.json'), 'utf8'));
  assert.deepEqual(data.markets.map(m => m.id), ['spx', 'ndx']);
  for (const market of [...data.markets, data.context]) {
    for (const metric of market.metrics) {
      const s = M.summarize(metric, data.asOf, 20);
      assert.ok(s.count >= 60, `${market.id} ${metric.id}`);
      assert.ok(s.percentile >= 0 && s.percentile <= 100);
      const explicitlyShort = (market.id === 'spx' && ['vix9d', 'vix3m', 'vol_term'].includes(metric.id)) || (market.id === 'ndx' && ['vxn', 'vol_gap'].includes(metric.id));
      assert.equal(s.lateStart, explicitlyShort, `${market.id} ${metric.id}: historical coverage changed`);
      if (s.lateStart) assert.ok(s.coverageYears < 20);
    }
    market.snapshots.forEach(s => assert.equal(s.percentile, null));
  }
  const spx = data.markets[0], ndx = data.markets[1];
  assert.ok(spx.metrics.some(m => m.id === 'vix'));
  assert.ok(ndx.metrics.some(m => m.id === 'vxn'));
  assert.ok(!ndx.metrics.some(m => m.id === 'vix'));
  assert.equal(ndx.metrics.find(m => m.id === 'vxn').source, 'vxn');
  assert.equal(ndx.metrics.find(m => m.id === 'forward_pe').source, 'ndx-forward');
});
test('CSV exports the selected original-frequency observations with their window and source', () => {
  const metric = { id: 'pe', source: 'source"name', unit: '倍', frequency: 'monthly', points: [['2025-01-01', 20], ['2025-02-01', 21]] };
  const s = M.summarize(metric, '2025-02-01', 5), csv = M.csv({symbol:'SPX'}, metric, s);
  assert.ok(csv.startsWith('\uFEFF"index"'));
  assert.ok(csv.includes('"source""name"'));
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.ok(csv.includes('"2020-02-01","2025-02-01"'));
});
