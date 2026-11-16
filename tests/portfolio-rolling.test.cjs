const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');

const day = i => new Date(Date.UTC(2024, 0, 15 + i)).toISOString().slice(0, 10);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
// Two CNY assets from 2024-01-15 for 800 days; B has no quote on the 1st and 2nd of any month.
function fixture(config = {}) {
  const days = Array.from({ length: 800 }, (_, i) => day(i));
  const assets = ['A', 'B'].map(code => ({ id: 'stock:' + code, code, name: '资产' + code, kind: 'stock', currency: 'CNY', status: 'available' }));
  const history = (asset, rows) => ({ schemaVersion: 1, id: asset.id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: rows[0][0], asOf: rows.at(-1)[0], series: rows, dividendEvidence: { status: 'recorded', first: rows[0][0], through: rows.at(-1)[0], fractions: {} } });
  const a = days.map((d, i) => [d, 100 * Math.exp(i * .0006) * (1 + .15 * Math.sin(i / 40))]);
  const b = days.map((d, i) => [d, 50 * Math.exp(i * .0002) * (1 + .1 * Math.cos(i / 55))]).filter(([d]) => Number(d.slice(8)) > 2);
  return { catalog: { assets, fx: { id: 'fx:CNY', name: '美元兑人民币', currency: 'CNY', status: 'available' } },
    histories: { 'stock:A': history(assets[0], a), 'stock:B': history(assets[1], b) },
    config: { positions: [{ id: 'stock:A', weight: 50 }, { id: 'stock:B', weight: 30 }], initial: 10000, monthly: 200, years: 5, rebalance: 'quarter',
      transactionFee: .1, feeBasis: 'net', benchmarkId: '', tax: { cnStockCapitalGains: 20 }, ...config } };
}

test('starts are each month’s first common trading day that leaves a full holding period', () => {
  const input = fixture(), before = JSON.stringify(input), calendar = P.rollingStarts(input, 1);
  assert.equal(JSON.stringify(input), before);
  assert.equal(calendar.error, undefined);
  assert.equal(calendar.first, '2024-01-15'); assert.equal(calendar.last, day(799)); assert.equal(calendar.years, 1);
  assert.equal(calendar.starts.length, 15);
  assert.deepEqual(calendar.starts.slice(0, 3), ['2024-01-15', '2024-02-03', '2024-03-03']);
  assert.equal(calendar.starts.at(-1), '2025-03-03');
  assert.ok(calendar.starts.every(start => P.addYears(start, 1) <= calendar.last));
  assert.deepEqual(P.rollingStarts(input, 3).starts, []);
  assert.equal(P.rollingStarts(input, 2).error, '持有期须为1、3、5或10年');
  // The calendar must not depend on the strategy's own warm-up, tax evidence or end-of-period sale.
  const strict = fixture({ initialMethod: 'ma200_hold', tax: { cnStockCapitalGains: 20, liquidate: true } });
  assert.deepEqual(P.rollingStarts(strict, 1).starts, calendar.starts);
  const broken = fixture(); delete broken.histories['stock:B'];
  assert.match(P.rollingStarts(broken, 1).error, /资产B/);
});

test('one start is an ordinary simulation of that window, kept as a compact row with its references', () => {
  const input = fixture(), start = '2024-02-03', window = { ...input.config, years: 'custom', start, end: '2025-02-03' };
  const row = P.rollingWindow(input, start, 1), direct = P.simulate({ ...input, requireFullWindow: true, config: window });
  assert.equal(direct.error, undefined);
  assert.deepEqual(row, { start, actualStart: direct.start, end: direct.end, annualReturn: direct.annualReturn, totalReturn: direct.totalReturn, mdd: direct.mdd,
    contributed: direct.contributed, value: direct.value, lumpSum: null, benchmark: null });
  assert.ok(direct.deposits > 1 && direct.rebalances > 0, 'contributions and rebalancing run inside the window');

  const staged = fixture({ initialMethod: 'tranche_6', benchmarkId: 'stock:A' });
  const compared = P.rollingWindow(staged, start, 1), settings = { ...staged.config, years: 'custom', start, end: '2025-02-03' };
  const own = P.simulate({ ...staged, requireFullWindow: true, config: settings });
  const plain = P.simulate({ ...staged, requireFullWindow: true, config: { ...settings, initialMethod: 'lump_sum', benchmarkId: '' } });
  assert.equal(compared.annualReturn, own.annualReturn); assert.equal(compared.lumpSum, plain.annualReturn);
  assert.equal(compared.benchmark, own.benchmark.annualReturn);
  assert.notEqual(compared.annualReturn, compared.lumpSum);

  const early = P.rollingWindow(input, '2023-06-01', 1);
  assert.equal(early.start, '2023-06-01'); assert.ok(early.error); assert.equal(early.annualReturn, undefined);
});

test('the summary gives quartiles, losses and strict wins, and counts failed starts apart', () => {
  const annual = [10, -5, 20, 0, 5], mdd = [-10, -30, -20, -5, -15], reference = [8, -5, null, 1, 5];
  const rows = annual.map((value, i) => ({ start: '2020-0' + (i + 1) + '-01', actualStart: '2020-0' + (i + 1) + '-01', end: '2025-0' + (i + 1) + '-01', annualReturn: value,
    totalReturn: value * 5, mdd: mdd[i], contributed: 100, value: 100 + value, lumpSum: reference[i], benchmark: null }));
  rows.splice(2, 0, { start: '2019-12-02', error: '缺预热历史' });
  const s = P.rollingSummary(rows);
  assert.equal(s.count, 5); assert.equal(s.failed, 1);
  assert.equal(s.firstStart, '2020-01-01'); assert.equal(s.lastStart, '2020-05-01');
  assert.deepEqual(s.annual, { min: -5, q1: 0, median: 5, q3: 10, max: 20 });
  assert.deepEqual(s.drawdown, { worst: -30, median: -15 });
  assert.equal(s.losses, 1);
  assert.deepEqual(s.beatLumpSum, { wins: 1, of: 4 });
  assert.equal(s.beatBenchmark, null);
  assert.deepEqual(s.worst.map(r => r.annualReturn), [-5, 0, 5, 10, 20]);
  assert.deepEqual(s.best.map(r => r.annualReturn), [20, 10, 5, 0, -5]);
  // Interpolation between ranks: four values put the quartiles between observations.
  close(P.rollingSummary(rows.filter(r => !r.error).slice(0, 4)).annual.q1, -1.25);
  const none = P.rollingSummary([{ start: '2020-01-01', error: 'x' }]);
  assert.deepEqual(none, { count: 0, failed: 1, firstStart: null, lastStart: null, annual: null, drawdown: null, losses: null, beatLumpSum: null, beatBenchmark: null, worst: [], best: [] });
});
