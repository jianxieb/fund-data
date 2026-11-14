const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/market-history-model.js');

function market(id, closes, readings) {
  return {id, symbol:id.toUpperCase(), prices:{symbol:id === 'spx' ? '^GSPC' : '^NDX',
    source:'yahoo-' + id, basis:'price_index', currency:'USD', points:closes},
    metrics:[{id:'pe', label:'指数 PE · TTM', source:'proshares-' + id, evidence:'provider',
      valuationBasis:'issuer_trailing_pe', vintage:'latest_verified_publication',
      limitations:'Issuer benchmark disclosure; not a point-in-time earnings archive',
      frequency:'quarterly', unit:'倍', points:readings}]};
}

test('only the reviewed issuer, index, methodology and quarterly frequency qualify as PE', () => {
  for (const id of ['spx','ndx']) {
    const metric = market(id, [], []).metrics[0];
    assert.ok(M.eligibleMetric(id, metric));
    for (const patch of [
      {source:'jiucai-' + id,valuationBasis:'aggregate_ttm',vintage:'latest_available',frequency:'daily'},
      {source:'proshares-' + (id === 'spx' ? 'ndx' : 'spx')}, {evidence:'published'},
      {valuationBasis:'etf_pe'}, {vintage:'latest_available'}, {frequency:'daily'}, {limitations:''}
    ]) assert.equal(M.eligibleMetric(id, {...metric,...patch}), false, JSON.stringify(patch));
  }
});

test('weekend quarter ends remain original observations in charts, statistics and exports', () => {
  const raw = market('ndx', [['2022-12-30',100],['2023-01-03',101],['2023-03-31',110],['2023-06-30',115]],
    [['2022-12-31',20],['2023-03-31',40],['2023-06-30',30]]);
  const original = structuredClone(raw), view = M.prepareMarketPE(raw), pe = view.metrics[0];
  assert.deepEqual(raw, original);
  assert.deepEqual(pe.points, original.metrics[0].points);
  const a = M.overlay(view, pe, '2023-06-30', 5, '2023-06-30');
  assert.deepEqual(a.timeline.find(p => p.date === '2022-12-31'), {date:'2022-12-31',price:null,value:20});
  assert.deepEqual(a.timeline.find(p => p.date === '2022-12-30'), {date:'2022-12-30',price:100,value:null});
  assert.equal(a.timeline.find(p => p.date === '2023-01-03').value, null);
  assert.deepEqual(a.metricPoints, original.metrics[0].points);
  assert.deepEqual(a.prices, original.prices.points);
  assert.equal(a.summary.count, 3);
  assert.equal(a.summary.percentile, 50);
  const csv = M.csv(view, pe, a.summary);
  assert.ok(csv.includes('"2022-12-31","20"'));
  assert.ok(!csv.includes('2022-12-30') && !csv.includes('2023-01-03'));
});

test('quarterly observations stay connected across ordinary trading sessions and large changes', () => {
  const raw = market('spx', [['2020-12-31',100],['2021-01-04',101],['2021-03-31',102]],
    [['2020-12-31',40],['2021-03-31',20],['2021-06-30',60]]);
  const pe = M.prepareMarketPE(raw).metrics[0];
  assert.deepEqual(M.segments(pe.points, pe.frequency), [pe.points]);
  assert.equal(M.summarize(pe, '2021-06-30', 5, '2021-07-31').stale, false);
});

test('a missing quarter remains a genuine gap without manufactured observations', () => {
  const raw = market('ndx', [], [['2020-12-31',30],['2021-03-31',40],['2021-09-30',35]]);
  const pe = M.prepareMarketPE(raw).metrics[0];
  assert.deepEqual(M.segments(pe.points, pe.frequency), [pe.points.slice(0,2),pe.points.slice(2)]);
  assert.equal(M.summarize(pe, '2021-09-30', 5).count, 3);
  assert.ok(!pe.points.some(([d]) => d === '2021-06-30'));
});

test('PE is preserved independently of missing prices, while the overlay still rejects index proxies', () => {
  const day = '2026-06-30', raw = market('ndx', [[day,100]], [[day,20]]);
  for (const prices of [null, {...raw.prices, points:undefined}, {...raw.prices, symbol:'^IXIC'},
    {...raw.prices, basis:'etf_price'}, {...raw.prices, currency:'CNY'}, {...raw.prices, source:'yahoo-spx'}]) {
    const view = M.prepareMarketPE({...raw, prices}), pe = view.metrics[0];
    assert.deepEqual(pe.points, [[day,20]]);
    assert.equal(M.summarize(pe, day, 5).count, 1);
    assert.equal(M.overlay(view, pe, day, 5).error, '缺少同一指数的美元价格历史');
  }
});
