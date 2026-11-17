const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');

const day = i => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function history(asset, values, days) {
  return { schemaVersion: 1, id: asset.id, currency: asset.currency, basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: values.map((value, i) => [days[i], value]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} } };
}
// Each spec is one asset priced on consecutive calendar days from 2024-01-01, a Monday.
function account(specs, config = {}, fxValues) {
  const days = specs[0].values.map((_, i) => day(i));
  const assets = specs.map((spec, i) => ({ id: 'stock:' + 'ABCD'[i], code: 'ABCD'[i], name: '资产' + 'ABCD'[i], kind: 'stock',
    currency: spec.currency || 'CNY', status: 'available' }));
  const fx = { id: 'fx:CNY', name: '美元兑人民币', currency: 'CNY', status: 'available' };
  return { catalog: { assets, fx }, histories: Object.fromEntries(assets.map((asset, i) => [asset.id, history(asset, specs[i].values, days)])),
    fxHistory: history(fx, fxValues || days.map(() => 7), days),
    config: { positions: assets.map(asset => ({ id: asset.id, weight: 100 / assets.length })), initial: 1000, monthly: 0, years: 'common',
      rebalance: 'none', transactionFee: 0, feeBasis: 'net', ...config } };
}
const run = (...args) => { const result = P.simulate(account(...args)); assert.equal(result.error, undefined); return result; };

test('drawdown episodes record peak, trough, recovery and an episode still open at the end', () => {
  const r = run([{ values: [100, 110, 99, 104.5, 110, 121, 96.8] }]), risk = P.riskAnalysis(r);
  assert.equal(risk.episodes, 2);
  const [deepest, earlier] = risk.drawdowns;
  assert.deepEqual([deepest.peakDay, deepest.troughDay, deepest.recoveryDay, deepest.recovered], [day(5), day(6), null, false]);
  close(deepest.depth, -20);
  assert.deepEqual([deepest.declineDays, deepest.recoveryDays, deepest.totalDays], [1, null, 1]);
  assert.deepEqual([earlier.peakDay, earlier.troughDay, earlier.recoveryDay, earlier.recovered], [day(1), day(2), day(4), true]);
  close(earlier.depth, -10);
  assert.deepEqual([earlier.declineDays, earlier.recoveryDays, earlier.totalDays], [1, 2, 3]);
  assert.strictEqual(risk.maxDrawdown, deepest);
  assert.strictEqual(risk.longestDrawdown, earlier);
  close(risk.maxDrawdown.depth, r.mdd); close(risk.currentDrawdown, -20);
  assert.equal(risk.marketDrawdown, null);
  assert.deepEqual(risk.returnToDrawdown, { value: null, missing: '不足一年' });
  assert.deepEqual(risk.returnToVolatility, { value: null, missing: '不足一年' });
});

test('an opening trading fee starts an episode on the start day', () => {
  const r = run([{ values: [100, 100, 103] }], { transactionFee: 1 }), risk = P.riskAnalysis(r);
  const [episode] = risk.drawdowns;
  assert.deepEqual([episode.peakDay, episode.troughDay, episode.recoveryDay], [day(0), day(0), day(2)]);
  close(episode.depth, (1 / 1.01 - 1) * 100);
  assert.deepEqual([episode.declineDays, episode.recoveryDays, episode.totalDays], [0, 2, 2]);
  close(risk.principal.deepestLoss, (1 / 1.01 - 1) * 100); assert.equal(risk.principal.deepestLossDay, day(0));
  assert.deepEqual(risk.principal.longestBelow, { start: day(0), end: day(2), recovered: true, days: 2 });
  assert.equal(risk.principal.endingBelow, null);
});

test('the deepest episode equals the ledger maximum drawdown for every ordinary funding method', () => {
  const values = Array.from({ length: 900 }, (_, i) => 100 * Math.exp(i * .0004) * (1 + .2 * Math.sin(i / 37)));
  for (const initialMethod of ['lump_sum', 'tranche_12', 'drawdown_ladder', 'ma200_hold']) {
    const r = run([{ values }], { initialMethod, monthly: 300, contributionMethod: 'dca_drawdown', rebalance: 'quarter', transactionFee: .1,
      tax: { cnStockCapitalGains: 20 } }), risk = P.riskAnalysis(r);
    close(risk.maxDrawdown.depth, r.mdd);
    assert.ok(risk.drawdowns.length <= 5 && risk.drawdowns.length <= risk.episodes, initialMethod);
    assert.ok(risk.drawdowns.every((e, i, all) => !i || all[i - 1].depth <= e.depth), initialMethod);
    assert.ok(risk.longestDrawdown.totalDays >= Math.max(...risk.drawdowns.map(e => e.totalDays)), initialMethod);
    close(risk.currentDrawdown, r.curve.at(-1).drawdown, 1e-12);
  }
});

test('loss against contributed capital differs from the cash-flow-neutral drawdown', () => {
  const price = d => d < '2024-02-01' ? 100 : d < '2024-03-01' ? 50 : 100;
  const values = Array.from({ length: 65 }, (_, i) => price(day(i)));   // 2024-01-01 … 2024-03-05
  const risk = P.riskAnalysis(run([{ values }], { monthly: 1000 }));
  close(risk.principal.deepestLoss, -25); assert.equal(risk.principal.deepestLossDay, '2024-02-01');
  assert.deepEqual(risk.principal.longestBelow, { start: '2024-02-01', end: '2024-03-01', recovered: true, days: 29 });
  assert.equal(risk.principal.endingBelow, null);
  const [episode] = risk.drawdowns;
  close(episode.depth, -50);
  assert.deepEqual([episode.peakDay, episode.troughDay, episode.recoveryDay], ['2024-01-31', '2024-02-01', '2024-03-01']);
  assert.deepEqual([episode.declineDays, episode.recoveryDays, episode.totalDays], [1, 29, 30]);

  const open = P.riskAnalysis(run([{ values: values.map((_, i) => day(i) < '2024-02-01' ? 100 : 50) }], { monthly: 1000 })).principal;
  close(open.deepestLoss, -25); assert.equal(open.deepestLossDay, '2024-02-01');
  assert.deepEqual(open.longestBelow, { start: '2024-02-01', end: '2024-03-05', recovered: false, days: 33 });
  assert.strictEqual(open.endingBelow, open.longestBelow);
});

test('risk ratios need a full year and name what is missing', () => {
  const values = Array.from({ length: 400 }, (_, i) => i < 200 ? 100 + i * .1 : i < 250 ? 119.9 - (i - 199) * .4 : 99.9 + (i - 249) * .2);
  const r = run([{ values }]), risk = P.riskAnalysis(r);
  close(r.mdd, (99.9 / 119.9 - 1) * 100);
  assert.equal(risk.fullYear, true);
  close(risk.returnToDrawdown.value, r.annualReturn / -r.mdd); assert.equal(risk.returnToDrawdown.missing, null);
  close(risk.returnToVolatility.value, r.annualReturn / r.volatility); assert.equal(risk.returnToVolatility.missing, null);
  assert.deepEqual(P.riskRatios(r), { fullYear: true, drawdown: risk.returnToDrawdown, volatility: risk.returnToVolatility });

  const rising = P.riskAnalysis(run([{ values: Array.from({ length: 400 }, (_, i) => 100 + i) }]));
  assert.deepEqual(rising.returnToDrawdown, { value: null, missing: '未出现回撤' });
  assert.ok(rising.returnToVolatility.value > 0);
  assert.equal(rising.maxDrawdown, null); assert.equal(rising.longestDrawdown, null);
  assert.deepEqual(rising.drawdowns, []); assert.equal(rising.currentDrawdown, 0);
  assert.equal(P.riskAnalysis({ error: '缺历史' }), null);
});

test('market-value NAV equals the after-reserve NAV without gains tax and stays neutral to deposits with it', () => {
  const values = Array.from({ length: 400 }, (_, i) => 100 * (1 + .3 * Math.sin(i / 23)) + i * .05);
  const untaxed = run([{ values }], { monthly: 200, rebalance: 'month', transactionFee: .2 });
  assert.ok(untaxed.curve.every(p => p.grossNav === p.nav));
  assert.equal(P.riskAnalysis(untaxed).marketDrawdown, null);

  const taxed = run([{ values: [100, 200, 100] }], { tax: { cnStockCapitalGains: 20 } }), risk = P.riskAnalysis(taxed);
  assert.deepEqual(taxed.curve.map(p => p.nav), [1, 1.8, 1]);
  assert.deepEqual(taxed.curve.map(p => p.grossNav), [1, 2, 1]);
  close(risk.maxDrawdown.depth, (1 / 1.8 - 1) * 100);
  assert.deepEqual(risk.marketDrawdown, { depth: -50, peakDay: day(1), troughDay: day(2) });

  const price = d => d < '2024-02-01' ? 100 : 200;
  const funded = run([{ values: Array.from({ length: 65 }, (_, i) => price(day(i))) }], { monthly: 1000, tax: { cnStockCapitalGains: 20 } });
  const at = d => funded.curve.find(p => p.day === d);
  close(at('2024-02-29').grossNav, 2); close(at('2024-03-01').grossNav, 2);
  close(at('2024-02-29').nav, 1.8); close(at('2024-03-01').nav, 1.8);
  assert.ok(at('2024-03-01').contributed > at('2024-02-29').contributed);
});

const weekly = k => ((k * 37) % 11 - 5) / 100;   // −5% … +5%, one step each Monday
function weeklyPath(weeks, sign = 1, base = 100) {
  const values = []; let price = base;
  for (let k = 0; k < weeks; k++) { price *= 1 + sign * weekly(k); for (let d = 0; d < 7; d++) values.push(price); }
  return values;
}

test('holding correlation uses the last common day of each week and names a short sample', () => {
  const weeks = 30, flat = Array.from({ length: weeks * 7 }, () => 50);
  const r = run([{ values: weeklyPath(weeks) }, { values: weeklyPath(weeks, 1, 20) }, { values: weeklyPath(weeks, -1) }, { values: flat }]);
  const c = P.holdingCorrelation(r);
  assert.deepEqual(c.codes, ['A', 'B', 'C', 'D']); assert.deepEqual(c.ids, r.holdings.map(h => h.id));
  assert.equal(c.observations, weeks - 1); assert.equal(c.first, day(6)); assert.equal(c.last, day(weeks * 7 - 1));
  close(c.matrix[0][1], 1); close(c.matrix[1][0], 1); close(c.matrix[0][2], -1); close(c.matrix[2][1], -1);
  assert.deepEqual([c.matrix[0][0], c.matrix[1][1], c.matrix[2][2]], [1, 1, 1]);
  assert.deepEqual(c.matrix[3], [null, null, null, null]); assert.equal(c.matrix[0][3], null);

  assert.deepEqual(P.holdingCorrelation(run([{ values: weeklyPath(26) }, { values: weeklyPath(26, -1) }])), { missing: '共同周收益仅 25 个，少于 26 个' });
  assert.equal(P.holdingCorrelation(run([{ values: weeklyPath(weeks) }])), null);
  assert.equal(P.holdingCorrelation(JSON.parse(JSON.stringify(r))), null, 'a JSON copy has no live price source');
});

test('a foreign holding is correlated on converted prices, not on its native price', () => {
  const weeks = 30, specs = [{ values: weeklyPath(weeks) }, { values: Array.from({ length: weeks * 7 }, () => 10), currency: 'USD' }];
  const fx = weeklyPath(weeks, 1, 7);
  close(P.holdingCorrelation(run(specs, { currency: 'CNY' }, fx)).matrix[0][1], 1);   // a flat USD price follows the exchange rate in CNY
  const usd = P.holdingCorrelation(run(specs, { currency: 'USD' }, fx));
  assert.equal(usd.matrix[1][1], null);   // and does not move in USD
  assert.equal(usd.matrix[0][1], null);
});

test('chart axes use round steps that cover the data, reaching zero unless told not to', () => {
  const check = (min, max, options, expected) => {
    const a = P.niceAxis(min, max, options);
    if (expected) assert.deepEqual(a.ticks, expected);
    assert.ok([1, 2, 2.5, 5].includes(+(a.step / 10 ** Math.floor(Math.log10(a.step))).toFixed(6)), 'round step ' + a.step);
    assert.ok(a.ticks.every(v => Math.abs(v / a.step - Math.round(v / a.step)) < 1e-9), 'ticks sit on the step');
    assert.ok(a.low <= min && a.high >= max, 'covers the data');
    if (max > min && max > 0) assert.ok(a.high - a.step < max, 'no spare step above the data');
    assert.equal(a.low, a.ticks[0]); assert.equal(a.high, a.ticks.at(-1));
    return a;
  };
  check(5.2, 46, undefined, [0, 10, 20, 30, 40, 50]);
  check(-6, 17.7, undefined, [-10, -5, 0, 5, 10, 15, 20]);
  check(-73.06, 0, undefined, [-80, -60, -40, -20, 0]);
  check(95000, 1694775, { includeZero: false }, [0, 500000, 1000000, 1500000, 2000000]);
  check(1620000, 1694775, { includeZero: false }, [1620000, 1640000, 1660000, 1680000, 1700000]);
  assert.ok(!check(61.3, 61.3, { includeZero: false }).ticks.includes(0), 'a flat line gets a small round range around it');
  assert.deepEqual(P.niceAxis(0, 0).ticks.slice(0, 1), [0]);
  assert.deepEqual(P.niceAxis(0, 100).ticks, [0, 20, 40, 60, 80, 100]);
});
