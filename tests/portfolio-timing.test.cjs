const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/portfolio-timing-model.js');
const P = require('../assets/portfolio-model.js');
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function calendar(start, end) {
  const rows = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += 86400000) {
    const d = new Date(time);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) rows.push(d.toISOString().slice(0, 10));
  }
  return rows;
}
function history(id, currency, days, prices) {
  return { schemaVersion: 1, id, currency, basis: 'provider_adjusted_close', dividends: 'reinvested', first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, prices[i]]) };
}
function fixture(days, prices = days.map((_, i) => Math.exp(i / 2000 + .3 * Math.sin(i / 90))), overrides = {}) {
  const rows = Array.isArray(prices[0]) ? prices : [prices];
  const assets = rows.map((_, i) => ({ id: 'stock:' + i, name: '标的' + i, status: 'available', currency: 'CNY' }));
  const histories = Object.fromEntries(assets.map((asset, i) => [asset.id, history(asset.id, asset.currency, days, rows[i])]));
  return { catalog: { assets }, histories, config: { positions: assets.map(asset => ({ id: asset.id, weight: 100 / assets.length })), currency: 'CNY', initial: 100000, monthly: 8000, years: 'common', transactionFee: 0, feeBasis: 'net', rebalance: 'none', ...overrides } };
}
function analyze(input, options = {}) { return T.analyze(input, { today: Object.values(input.histories)[0].asOf, ...options }); }

test('reference uses target weights on actual common closes and retains zero-interest cash', () => {
  const days = ['2026-01-05', '2026-01-06', '2026-01-07'];
  const input = fixture(days, [[100, 200, 100], [100, 100, 200]], { positions: [{ id: 'stock:0', weight: 30 }, { id: 'stock:1', weight: 30 }] });
  const result = analyze(input);
  close(result.cashWeight, 40); close(result.curve[1].value, 1.3); close(result.curve[2].value, 1.3 * 1.15);
  close(result.latest.drawdown, 0); assert.equal(result.latest.ma200, null); assert.equal(result.status, 'insufficient');
  input.histories['stock:1'].series.splice(1, 1);
  const common = analyze(input);
  assert.deepEqual(common.curve.map(r => r.day), [days[0], days[2]]); close(common.latest.value, 1.3);
});

test('FX uses only same-day or prior quotes, both conversion directions, and same-currency needs no FX', () => {
  const days = ['2026-01-05', '2026-01-06', '2026-01-07'];
  const input = fixture(days, [100, 100, 100]);
  input.catalog.assets[0].currency = 'USD'; input.histories['stock:0'].currency = 'USD';
  input.catalog.fx = { id: 'fx', name: '美元兑人民币', status: 'available', currency: 'CNY' };
  input.fxHistory = history('fx', 'CNY', [days[0], days[2]], [7, 8]);
  const cny = analyze(input); close(cny.curve[1].value, 1); close(cny.latest.value, 8 / 7);
  input.catalog.assets[0].currency = 'CNY'; input.histories['stock:0'].currency = 'CNY'; input.config.currency = 'USD';
  close(analyze(input).latest.value, 7 / 8);
  input.config.currency = 'CNY'; delete input.fxHistory; delete input.catalog.fx;
  close(analyze(input).latest.value, 1);
});

test('MA200 and peak drawdown are calculated from complete history independently of account and simulation settings', () => {
  const days = calendar('2018-01-01', '2026-10-23'), input = fixture(days);
  const result = analyze(input), latest = result.latest;
  close(latest.ma200, result.curve.slice(-200).reduce((sum, r) => sum + r.value, 0) / 200);
  close(latest.drawdown, (latest.value / Math.max(...result.curve.map(r => r.value)) - 1) * 100);
  assert.equal(result.status, 'available'); assert.ok(latest.return1y !== null && latest.volatility1y > 0);
  Object.assign(input.config, { years: 1, initial: 0, monthly: 400, initialMethod: 'ma200_hold', contributionMethod: 'dca_drawdown', transactionFee: 2, tax: { cnStockCapitalGains: 20 }, rebalance: 'month' });
  assert.deepEqual(analyze(input), result);
});

test('long-term percentile requires three years of earlier deviations and at least 600 observations', () => {
  const days = calendar('2020-01-01', '2024-12-31'), result = analyze(fixture(days, days.map(() => 100)));
  const firstValid = result.curve.find(r => r.percentile !== null), firstDeviation = result.curve[199];
  assert.ok(firstValid.day >= P.addYears(firstDeviation.day, 3)); assert.ok(firstValid.percentileSamples >= 600);
  assert.equal(result.curve[result.curve.indexOf(firstValid) - 1].percentile, null);
  close(firstValid.percentile, 50); assert.equal(result.band, 'middle');
  assert.equal(result.latest.trend, 'flat'); close(result.latest.volatility1y, 0);
});

test('historical percentiles exclude the current value and all future values', () => {
  const days = calendar('2010-01-01', '2026-10-23'), input = fixture(days), cutoff = '2020-10-23';
  const before = analyze(input, { end: cutoff });
  const current = before.latest, prior = before.curve.slice(0, -1).filter(row => row.deviation !== null);
  const less = prior.filter(row => row.deviation < current.deviation).length, equal = prior.filter(row => row.deviation === current.deviation).length;
  close(current.percentile, (less + equal / 2) / prior.length * 100);
  input.histories['stock:0'].series.filter(([day]) => day > cutoff).forEach(row => { row[1] *= 100; });
  assert.deepEqual(analyze(input, { end: cutoff }), before);
});

test('forward evidence enters at next close and uses only matured outcomes from prior completed months', () => {
  const days = calendar('2010-01-01', '2026-10-23'), result = analyze(fixture(days));
  assert.ok(result.monthly.length > 100);
  assert.ok(result.monthly.every(row => row.day < '2026-10-01'));
  for (const horizon of result.horizons) {
    assert.ok(horizon.baseline.n > 80); assert.ok(horizon.matched.n > 0);
    assert.equal(horizon.baseline.n, horizon.samples.length);
    assert.equal(horizon.matched.n, horizon.samples.filter(sample => sample.band === result.band).length);
    assert.ok(horizon.matched.nonOverlappingN < horizon.matched.n);
    for (const sample of horizon.samples) {
      const signalIndex = result.curve.findIndex(row => row.day === sample.signal), entry = result.curve[signalIndex + 1];
      assert.equal(sample.entry, entry.day);
      const target = P.addYears(sample.entry, horizon.years), expectedExit = result.curve.find(row => row.day >= target);
      assert.equal(sample.exit, expectedExit.day); assert.ok(sample.exit <= result.end);
      close(sample.return, (expectedExit.value / entry.value - 1) * 100);
      assert.ok(sample.drawdown <= 0);
      assert.equal(sample.percentile, result.curve[signalIndex].percentile);
    }
  }
});

test('summary reports zero positive outcomes for flat paths and empty samples as null', () => {
  const days = calendar('2010-01-01', '2026-10-23'), result = analyze(fixture(days, days.map(() => 100)));
  for (const horizon of result.horizons) {
    assert.ok(horizon.matched.n > 0); close(horizon.matched.positiveRate, 0);
    ['median', 'p10', 'worstReturn', 'worstDrawdown'].forEach(key => close(horizon.matched[key], 0));
  }
  const short = analyze(fixture(days.slice(-50)));
  assert.equal(short.horizons[0].matched.n, 0); assert.equal(short.horizons[0].matched.median, null);
});

test('gaps, identity errors, catalog dates and missing FX are explicit instead of silently dropped', () => {
  const days = calendar('2025-01-01', '2026-10-23');
  const gapInput = fixture(days); gapInput.histories['stock:0'].series.splice(100, 20);
  assert.match(analyze(gapInput).missing, /超过14日/);
  const identity = fixture(days); identity.histories['stock:0'].id = 'wrong';
  assert.match(analyze(identity).missing, /身份/);
  const metadata = fixture(days); metadata.catalog.assets[0].asOf = '2026-10-22';
  assert.match(analyze(metadata).missing, /标的库与历史/);
  const fxInput = fixture(days); fxInput.catalog.assets[0].currency = 'USD'; fxInput.histories['stock:0'].currency = 'USD';
  assert.match(analyze(fxInput).missing, /缺美元兑人民币/);
  fxInput.catalog.fx = { id: 'fx', name: '美元兑人民币', status: 'available', currency: 'CNY' };
  fxInput.fxHistory = history('fx', 'CNY', days, days.map(() => 7)); fxInput.fxHistory.series.splice(100, 10);
  assert.match(analyze(fxInput).missing, /缺7日内/);
});

test('freshness and future dates are explicit, future source values are never consumed', () => {
  const days = calendar('2010-01-01', '2026-10-23'), input = fixture(days);
  const stale = analyze(input, { today: '2026-11-01' });
  assert.equal(stale.status, 'stale'); assert.match(stale.missing, /2026-10-23.*9 日/);
  const future = analyze(input, { end: '2026-10-24', today: '2026-10-23' });
  assert.equal(future.status, 'future'); assert.equal(future.latest, undefined);
  const truncated = analyze(input, { today: '2025-01-01' });
  assert.equal(truncated.end, '2025-01-01'); assert.ok(truncated.curve.every(row => row.day <= '2025-01-01'));
  assert.equal(analyze(input, { end: '2026-02-30' }).status, 'error');
});

test('custom historical review is distinct from stale latest data and never includes later prices or outcomes', () => {
  const days = calendar('2010-01-01', '2026-10-23'), cutoff = '2020-10-23';
  const input = fixture(days, undefined, { years: 'custom', start: '2018-01-01', end: cutoff });
  const historical = analyze(input, { end: cutoff, today: '2026-10-28' });
  assert.equal(historical.historical, true);
  assert.equal(historical.sourceEnd, '2026-10-23'); assert.equal(historical.end, cutoff);
  assert.equal(historical.status, 'available'); assert.equal(historical.missing, null);
  assert.ok(historical.ageDays > 7);
  assert.ok(historical.curve.every(row => row.day <= cutoff));
  assert.ok(historical.horizons.every(horizon => horizon.samples.every(sample => sample.exit <= cutoff)));

  // An old final source quote is still stale, even if the user chose that exact
  // endpoint explicitly; only an earlier review with newer source data is historical.
  const latestHistory = input.histories['stock:0'];
  latestHistory.series = latestHistory.series.filter(([day]) => day <= cutoff);
  latestHistory.asOf = cutoff;
  const stale = analyze(input, { end: cutoff, today: '2026-10-28' });
  assert.equal(stale.historical, false); assert.equal(stale.status, 'stale');
  assert.match(stale.missing, /最新共同报价为 2020-10-23.*缺最近行情/);
  assert.deepEqual(stale.latest, historical.latest);
  assert.deepEqual(stale.horizons, historical.horizons);
});
