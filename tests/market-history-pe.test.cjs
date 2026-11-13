const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/market-history-model.js');

function market(id, closes, readings) {
  return {id, symbol:id.toUpperCase(), prices:{symbol:id === 'spx' ? '^GSPC' : '^NDX',
    source:'yahoo-' + id, basis:'price_index', currency:'USD', points:closes},
    metrics:[{id:'pe', source:'jiucai-' + id, evidence:'provider', valuationBasis:'aggregate_ttm',
      vintage:'latest_available', limitations:'No constituent earnings history', frequency:'daily', unit:'倍', points:readings}]};
}

test('SPX keeps a quarter-end PE jump, real crisis moves and only exact-close observations', () => {
  const raw = market('spx', [
    ['2020-03-13',2711.02002], ['2020-03-16',2386.129883],
    ['2021-03-30',3958.550049], ['2021-03-31',3972.889893],
    ['2026-07-02',7483.240234], ['2026-07-06',7537.430176]
  ], [
    ['2020-03-13',19.2447], ['2020-03-16',16.9582],
    ['2021-03-30',40.0497], ['2021-03-31',31.4228],
    ['2026-07-02',25.433], ['2026-07-03',28.0606], ['2026-07-06',25.5471]
  ]);
  const original = structuredClone(raw), view = M.prepareMarketPE(raw), pe = view.metrics[0];
  assert.deepEqual(raw, original);
  assert.deepEqual(pe.unmatchedPoints, [['2026-07-03',28.0606]]);
  // The intervening provider-only July 3 reading does not turn a closed exchange into a missing trading session.
  assert.deepEqual(pe.missingSessionStarts, []);
  assert.deepEqual(pe.points, original.metrics[0].points.filter(([d]) => d !== '2026-07-03'));
  assert.deepEqual(M.segments(pe.points, 'daily', new Set(pe.missingSessionStarts)), [
    pe.points.slice(0,2),pe.points.slice(2,4),pe.points.slice(4)
  ]);
  const summary = M.summarize(pe, '2026-07-06', 10);
  assert.equal(summary.count, 6);
  assert.equal(summary.percentile, 100 * 3.5 / 6);
  const csv = M.csv(view, pe, summary);
  assert.ok(csv.includes('"2021-03-31","31.4228"'));
  assert.ok(!csv.includes('2026-07-03'));
});

test('the Nasdaq April 2020 spike remains an unaltered continuous line across actual observations', () => {
  const raw = market('ndx', [['2020-04-28',8677.599609],['2020-04-29',8982.759766],['2020-04-30',9000.509766]],
    [['2020-04-28',25.2787],['2020-04-29',30.5858],['2020-04-30',26.1231]]);
  const pe = M.prepareMarketPE(raw).metrics[0];
  assert.deepEqual(pe.points, raw.metrics[0].points);
  assert.deepEqual(M.segments(pe.points, 'daily', new Set(pe.missingSessionStarts)), [pe.points]);
});

test('only missing PE sessions and long history gaps break the line, regardless of value changes', () => {
  const day = n => '2026-06-' + String(n).padStart(2,'0');
  const raw = market('spx', [1,2,3,4,15,16,17].map(n => [day(n),100]),
    [[1,20],[3,10],[4,10.5],[15,21],[16,19.95],[17,20.94]].map(([n,v]) => [day(n),v]));
  const pe = M.prepareMarketPE(raw).metrics[0];
  assert.deepEqual(pe.missingSessionStarts, [day(3)]);
  assert.deepEqual(M.segments(pe.points, 'daily', new Set(pe.missingSessionStarts))
    .map(segment => segment.map(p => p[0])), [[day(1)],[day(3),day(4)],[day(15),day(16),day(17)]]);
});

test('a mismatched index, ETF, currency, source or absent price history cannot produce valid PE statistics', () => {
  const day = '2026-06-30', raw = market('ndx', [[day,100]], [[day,20]]);
  for (const prices of [null, {...raw.prices, points:undefined}, {...raw.prices, symbol:'^IXIC'},
    {...raw.prices, basis:'etf_price'}, {...raw.prices, currency:'CNY'}, {...raw.prices, source:'yahoo-spx'}]) {
    const pe = M.prepareMarketPE({...raw, prices}).metrics[0];
    assert.deepEqual(pe.points, []);
    assert.deepEqual(pe.missingSessionStarts, []);
    assert.deepEqual(pe.unmatchedPoints, [[day,20]]);
    assert.equal(M.summarize(pe, day, 5), null);
  }
});
