const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const O = require('../assets/portfolio-opportunity.js');
const S = require('../assets/portfolio-systematic.js');
const days = Array.from({ length: 1700 }, (_, i) => new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10));
const close = (a, b, e = 1e-10) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
function context(rows) {
  return { schemaVersion: 1, status: 'available', first: rows[0][0], asOf: rows.at(-1)[0], series: rows,
    sources: Object.fromEntries(['VIX', 'VIX3M'].map(id => [id, {
      url: `https://cdn.cboe.com/api/global/us_indices/daily_prices/${id}_History.csv`,
      first: rows[0][0], asOf: rows.at(-1)[0], sha256: 'a'.repeat(64), retrievedAt: '2024-01-01T00:00:00Z'
    }])) };
}
function input(n = 800) {
  const rows = days.slice(0, n).map((day, i) => [day, i === 600 ? 70 : 100 + (i % 17)]);
  return { rawHistories: { 'us:SOXX': rows, 'us:QQQ': rows.map(r => r.slice()) },
    vixContext: context(days.slice(0, n).map((day, i) => [day, 20 + i % 31, 30])) };
}
test('opportunity module runs in the browser and keeps score and probability distinct', () => {
  const sandbox = {}; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/portfolio-opportunity.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.ChanghengPortfolioOpportunity.createFeatures, 'function');
  assert.equal(O.createFeatures(input()).at(days[600]).metadata.probability, false);
});
test('252-close moving averages must mature before any ratio enters the 252-prior rank', () => {
  const rows = O.priceFeatures(days.slice(0, 600).map(day => [day, 100]));
  assert.equal(rows[250].D, null); assert.equal(rows[251].D, 0);
  assert.equal(rows[502].S, null); assert.equal(rows[502].rankCount, 251);
  assert.equal(rows[503].S, .5); assert.equal(rows[503].rankGreater, 0); assert.equal(rows[503].rankEqual, 252);
  assert.equal(rows[503].ma252, 100); assert.equal(rows[503].Z, null);
  const full = O.createFeatures({ rawHistories: { 'us:SOXX': days.slice(0, 600).map(day => [day, 100]) } }).at(days[599]);
  assert.equal(full.legs[0].scores.volatility, null); assert.equal(full.legs[0].scores.discount, 20);
});
test('scores expose exact operands and use the frozen weighted formulas, including strict VIX ties', () => {
  const x = O.createFeatures(input()).at(days[600]);
  for (const leg of x.legs) {
    const { D, S, Z, F, R } = leg.components, p = leg.inputs;
    close(D, Math.min(1, (1 - p.price / p.high252) / .25));
    close(S, (p.rankGreater + .5 * p.rankEqual) / p.rankCount);
    close(F, p.fearBelow / p.fearCount);
    close(R, Math.max(0, Math.min(1, (p.vixPeak63 - p.vix) / (.4 * p.vixPeak63))) * Math.max(0, Math.min(1, (p.vixPeak63 - 20) / 30)));
    close(leg.scores.discount, 100 * (.6 * D + .4 * S));
    close(leg.scores.mixed, 100 * (.4 * D + .3 * S + .15 * F + .15 * R));
    close(leg.scores.fear, 100 * (.5 * D + .25 * F + .25 * R));
    close(leg.scores.volatility, 100 * (.5 * D + .35 * Z + .15 * Math.max(0, Math.min(1, 1 - p.rv21 / (2 * p.rv126)))));
    assert.equal(p.vixDay, days[599]);
  }
  const flat = O.fearFeatures(days.slice(0, 1400).map(day => [day, 20, 30]));
  assert.equal(flat[251].F, null); assert.equal(flat[252].F, 0); assert.equal(flat[1399].fearCount, 1260);
});
test('current price can inform the next close, but only a strictly earlier VIX close is usable', () => {
  const source = input(), before = O.createFeatures(source).at(days[600]);
  source.vixContext.series[600] = [days[600], 999, 1];
  assert.deepEqual(O.createFeatures(source).at(days[600]), before);
  source.rawHistories['us:QQQ'][600][1] = 200;
  assert.notEqual(O.createFeatures(source).at(days[600]).legs[1].scores.discount, before.legs[1].scores.discount);
});
test('appended or changed future quotes and mutable consumers cannot rewrite historical snapshots', () => {
  const original = input(), all = O.createFeatures(original), saved = all.at(days[600]);
  saved.legs[0].inputs.price = 999; assert.notEqual(all.at(days[600]).legs[0].inputs.price, 999);
  const truncated = { rawHistories: Object.fromEntries(Object.entries(original.rawHistories).map(([k, v]) => [k, v.slice(0, 601)])),
    vixContext: { ...original.vixContext, series: original.vixContext.series.slice(0, 601) } };
  assert.deepEqual(all.at(days[600]), O.createFeatures(truncated).at(days[600]));
  for (const rows of Object.values(original.rawHistories)) rows.forEach((r, i) => { if (i > 600) r[1] *= 3; });
  original.vixContext.series.forEach((r, i) => { if (i > 600) { r[1] = 300; r[2] = 1; } });
  assert.deepEqual(all.at(days[600]), O.createFeatures(original).at(days[600]));
});
test('stale, missing and interrupted sources are named; missing VIX does not erase a price-only score', () => {
  const source = input(), absent = O.createFeatures({ rawHistories: source.rawHistories }).at(days[600]);
  assert.ok(Number.isFinite(absent.legs[0].scores.discount)); assert.equal(absent.legs[0].scores.mixed, null);
  assert.equal(absent.legs[0].missingReasons.mixed[0].code, 'missing_vix');
  const stale = O.createFeatures(source).at(days[810]);
  assert.equal(stale.legs[0].scores.discount, null); assert.equal(stale.legs[0].missingReasons.discount[0].code, 'stale_proxy');
  source.rawHistories['us:SOXX'] = source.rawHistories['us:SOXX'].filter((_, i) => i < 550 || i > 560);
  const interrupted = O.createFeatures(source).at(days[600]);
  assert.equal(interrupted.legs[0].scores.discount, null); assert.equal(interrupted.legs[0].missingReasons.discount[0].code, 'proxy_gap');
  assert.deepEqual(interrupted.legs[0].inputs.sourceGap, { from: days[549], to: days[561] });
});
test('controller uses actual per-leg cash and score intensity, not a repeating deposit or holding switch', () => {
  const setup = input(), method = 'opportunity_discount_10';
  const controller = S.create({ method, weights: [.2, .5], ...setup });
  const ctx = { day: days[600], marks: [20, 50], cashByLeg: [3, 7], fee: .001, initial: 100, units: [1, 1] };
  const order = controller.step(ctx), meta = controller.state().metadata.opportunity;
  for (let k = 0; k < 2; k++) {
    const leg = meta.legs[k]; close(order.buyAmounts[k] * 1.001, ctx.cashByLeg[k] * leg.intensity);
    assert.ok(leg.score > 35 && leg.score <= 100); assert.equal(leg.weights.D, .6);
  }
  assert.deepEqual(order.sellFractions, [0, 0]); assert.equal(controller.step(ctx), null);
  const empty = controller.step({ ...ctx, day: days[601], cashByLeg: [0, 0] });
  assert.deepEqual(empty.buyAmounts, [0, 0]); assert.ok(controller.state().metadata.opportunity.legs.every(l => l.score !== null));
});
