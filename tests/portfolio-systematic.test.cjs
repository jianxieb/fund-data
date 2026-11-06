const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../assets/portfolio-systematic.js');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const days = Array.from({ length: 850 }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
function context(series) {
  return { schemaVersion: 1, status: 'available', first: series[0][0], asOf: series.at(-1)[0], series,
    sources: Object.fromEntries(['VIX', 'VIX3M'].map(id => [id, {
      url: `https://cdn.cboe.com/api/global/us_indices/daily_prices/${id}_History.csv`,
      first: series[0][0], asOf: series.at(-1)[0], sha256: 'a'.repeat(64), retrievedAt: '2024-01-01T00:00:00Z'
    }])) };
}
function setup(method = 'vix_panic_reentry', modify = {}) {
  return { method, weights: [.3, .3], rawHistories: {
    'us:USD': days.map((day, i) => [day, Math.exp(i / 1000)]),
    'us:TQQQ': days.map(day => [day, 1]),
    'us:QQQ': days.map((day, i) => [day, i < 300 ? 100 : i < 350 ? 70 : 110])
  }, vixContext: context(days.map((day, i) => [day, i >= 300 && i < 330 ? 40 : 20, 30])), ...modify };
}
function ctx(index, overrides = {}) {
  return { day: days[index], prices: [10, 10], units: [3, 3], basis: [30, 30], marks: [30, 30],
    cash: 40, cashByLeg: [0, 0], wealth: 100, initialCash: 40, weights: [.3, .3], fee: .001, latestFills: [], ...overrides };
}

test('VIX waits for ten source observations and uses a strictly earlier source close', () => {
  const c = S.create(setup());
  for (let i = 299; i <= 309; i++) assert.equal(c.step(ctx(i)), null);
  const sale = c.step(ctx(310));
  assert.deepEqual(sale.sellFractions, [0, 1]);
  assert.equal(sale.metadata.sourceDay, days[309]);
  assert.deepEqual(sale.desiredTargets, [.3, 0]);
  assert.deepEqual(sale.parkedWeights, [0, .3]);
  assert.equal(sale.metadata.allocationStateChange, true);
  assert.equal(c.step(ctx(310)), null);
});

test('reentry spends only the known TQQQ sale pool and does not use original or other-leg cash', () => {
  const c = S.create(setup());
  for (let i = 299; i <= 330; i++) c.step(ctx(i));
  const buy = c.step(ctx(331, { cash: 9999, cashByLeg: [500, 80], units: [3, 0], marks: [30, 0] }));
  close(buy.buyAmounts[1] * 1.001, 80); assert.equal(buy.buyAmounts[0], 0);
  assert.deepEqual(buy.desiredTargets, [.3, .3]);
  assert.deepEqual(buy.parkedWeights, [0, 0]);
});

test('dual guard stays out after VIX recovers while QQQ remains in its confirmed bear', () => {
  const c = S.create(setup('dual_risk_guard')), changes = [];
  for (let i = 299; i <= 352; i++) {
    const order = c.step(ctx(i, { cashByLeg: [0, 80] }));
    if (order?.metadata.allocationStateChange) changes.push([i, order.desiredTargets[1]]);
  }
  assert.deepEqual(changes, [[310, 0], [352, .3]]);
  assert.equal(c.state().metadata.qqqDay, days[352]);
  assert.equal(c.state().metadata.vixDay, days[351]);
});

test('zero initial holdings still emit a target-change event for later contributions', () => {
  const c = S.create(setup(undefined, { weights: [0, .5] }));
  const result = c.step(ctx(310, { units: [0, 0], marks: [0, 0], cash: 0, cashByLeg: [0, 0] }));
  assert.equal(result.metadata.allocationStateChange, true);
  assert.deepEqual(result.desiredTargets, [0, 0]);
  assert.deepEqual(result.parkedWeights, [0, .5]);
  assert.deepEqual(result.buyAmounts, [0, 0]);
});

test('three quarterly phases update on successive months and use one aggregate tax account', () => {
  const c = S.create(setup('relative_strength_rotation'));
  const monthStarts = days.map((day, i) => [day, i]).filter(([day, i]) => i >= 505 && day.endsWith('-01')).slice(0, 3);
  const desired = [];
  for (const [, i] of monthStarts) {
    const order = c.step(ctx(i)); desired.push(order.desiredTargets);
    assert.equal(order.metadata.allocationStateChange, true);
    assert.equal(order.buyAmounts[0], 0); // future sale proceeds cannot finance this order
    c.step(ctx(i + 1)); // completion has no settled cash in this synthetic account
  }
  desired.forEach((a, i) => { close(a[0], .4 + .1 * i); close(a[1], .2 - .1 * i); });
  assert.deepEqual(c.state().metadata.leaders, [0, 0, 0]);
  assert.deepEqual(c.state().parkedWeights, [0, 0]);
});

test('rotation completion uses pair proceeds only, including with unrelated cash present', () => {
  const c = S.create(setup('relative_strength_rotation'));
  c.step(ctx(520));
  const buy = c.step(ctx(521, { cash: 10000, cashByLeg: [-5, 15], marks: [30, 20] }));
  close(buy.buyAmounts[0] + buy.buyAmounts[1], 10 / 1.001);
  assert.deepEqual(buy.sellFractions, [0, 0]);
  assert.equal(buy.metadata.allocationStateChange, false);
});

test('insufficient 504-return history is explicit warmup and does not add a mid-month review', () => {
  const c = S.create(setup('relative_strength_rotation'));
  const before = c.step(ctx(503));
  assert.equal(before.warmingUp, true); assert.equal(before.missing, null);
  assert.match(before.metadata.reason, /505/);
  assert.deepEqual(before.desiredTargets, [.3, .3]);
  assert.equal(days[503].slice(0, 7), days[504].slice(0, 7));
  assert.equal(c.step(ctx(504)), null);
  const nextMonth = days.findIndex((d, i) => i > 504 && d.slice(0, 7) !== days[504].slice(0, 7));
  assert.equal(c.step(ctx(nextMonth)).metadata.allocationStateChange, true);
});

test('missing or stale observations do not produce an invented zero-risk allocation', () => {
  const input = setup(); input.vixContext = context(input.vixContext.series.slice(0, 300));
  const c = S.create(input), unavailable = c.step(ctx(310));
  assert.match(unavailable.missing, /超过7日/);
  assert.deepEqual(unavailable.sellFractions, [0, 0]);
  assert.deepEqual(c.state().desiredTargets, [.3, .3]);
  const dual = setup('dual_risk_guard'); delete dual.rawHistories['us:QQQ'];
  assert.match(S.create(dual).step(ctx(310)).missing, /QQQ.*缺实际收盘/);
});

test('an internal long gap is named and does not silently advance confirmation counts', () => {
  const input = setup(); input.vixContext = context(input.vixContext.series.filter((_, i) => i < 300 || i > 310));
  const result = S.create(input).step(ctx(320));
  assert.match(result.missing, /VIX\/VIX3M.*缺连续日线/);
  const rotation = setup('relative_strength_rotation');
  rotation.rawHistories['us:TQQQ'] = rotation.rawHistories['us:TQQQ'].filter((_, i) => i < 400 || i > 411);
  assert.match(S.create(rotation).step(ctx(600)).missing, /共同收盘.*缺连续日线/);
});

test('official VIX identity, coverage, hash and retrieval dates are mandatory', () => {
  for (const change of [
    x => { x.status = 'missing'; }, x => { x.asOf = days[500]; },
    x => { x.sources.VIX.url = 'https://example.com/VIX_History.csv'; },
    x => { x.sources.VIX3M.first = days[1]; },
    x => { x.sources.VIX3M.asOf = days[500]; },
    x => { x.sources.VIX.sha256 = 'not-a-hash'; },
    x => { x.sources.VIX.retrievedAt = '2024-02-30T00:00:00Z'; },
    x => { x.sources.VIX.retrievedAt = '2999-01-01T00:00:00Z'; },
    x => { x.sources.VIX.retrievedAt = '2020-01-01T00:00:00Z'; }
  ]) { const input = setup(); change(input.vixContext); assert.throws(() => S.create(input), /VIX/); }
  const malformed = setup(); malformed.vixContext.series[5][1] = NaN;
  assert.throws(() => S.create(malformed), /正值记录/);
});

test('future QQQ and VIX observations cannot rewrite previous decisions', () => {
  const original = setup('dual_risk_guard'), changed = structuredClone(original);
  changed.rawHistories['us:QQQ'] = changed.rawHistories['us:QQQ'].map((r, i) => [r[0], i > 320 ? 10000 : r[1]]);
  changed.vixContext.series = changed.vixContext.series.map((r, i) => [r[0], i > 320 ? 1000 : r[1], r[2]]);
  const a = S.create(original), b = S.create(changed);
  for (let i = 299; i <= 320; i++) assert.deepEqual(a.step(ctx(i)), b.step(ctx(i)));
  assert.deepEqual(a.state(), b.state());
});

test('native relative return cancels a shared currency conversion and state copies are isolated', () => {
  const a = setup('relative_strength_rotation'), b = structuredClone(a);
  for (const id of ['us:USD', 'us:TQQQ']) b.rawHistories[id] = b.rawHistories[id].map((r, i) => [r[0], r[1] * (6 + i / 10000)]);
  const ca = S.create(a), cb = S.create(b);
  for (let i = 500; i < 650; i++) {
    const ra = ca.step(ctx(i)), rb = cb.step(ctx(i));
    assert.deepEqual(ra?.sellFractions, rb?.sellFractions);
    assert.deepEqual(ra?.buyAmounts, rb?.buyAmounts);
  }
  const state = ca.state(); state.desiredTargets[0] = 99;
  assert.notEqual(ca.state().desiredTargets[0], 99);
});
