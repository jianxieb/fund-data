const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');

const day = i => new Date(Date.UTC(2024, 0, 15 + i)).toISOString().slice(0, 10);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
// Two CNY assets for 800 days; the USD/TQQQ rules cannot run on them and must say why.
function fixture(config = {}) {
  const days = Array.from({ length: 800 }, (_, i) => day(i));
  const assets = ['A', 'B'].map(code => ({ id: 'stock:' + code, code, name: '资产' + code, kind: 'stock', currency: 'CNY', status: 'available' }));
  const history = (asset, rows) => ({ schemaVersion: 1, id: asset.id, currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: rows[0][0], asOf: rows.at(-1)[0], series: rows, dividendEvidence: { status: 'recorded', first: rows[0][0], through: rows.at(-1)[0], fractions: {} } });
  const a = days.map((d, i) => [d, 100 * Math.exp(i * .0006) * (1 + .15 * Math.sin(i / 40))]);
  const b = days.map((d, i) => [d, 50 * Math.exp(i * .0002) * (1 + .1 * Math.cos(i / 55))]);
  return { catalog: { assets, fx: { id: 'fx:CNY', name: '美元兑人民币', currency: 'CNY', status: 'available' } },
    histories: { 'stock:A': history(assets[0], a), 'stock:B': history(assets[1], b) },
    config: { positions: [{ id: 'stock:A', weight: 50 }, { id: 'stock:B', weight: 30 }], initial: 10000, monthly: 0, years: 5, rebalance: 'none',
      transactionFee: .1, feeBasis: 'net', benchmarkId: '', tax: { cnStockCapitalGains: 20 }, ...config } };
}
const mddOf = navs => { let peak = -Infinity, worst = 0; for (const n of navs) { peak = Math.max(peak, n); worst = Math.min(worst, (n / peak - 1) * 100); } return worst; };

test('candidates are every rule alone, every pair at 25/75, 50/50 and 75/25, and every trio in thirds', () => {
  const c = P.searchCandidates(['a', 'b', 'c', 'd']);
  assert.equal(c.length, 4 + 6 * 3 + 4);
  assert.equal(new Set(c.map(x => x.id)).size, c.length, 'ids are unique');
  for (const x of c) close(x.legs.reduce((s, l) => s + l.weight, 0), 1, 1e-12);
  assert.deepEqual(c.slice(0, 4).map(x => x.legs), [[{ id: 'a', weight: 1 }], [{ id: 'b', weight: 1 }], [{ id: 'c', weight: 1 }], [{ id: 'd', weight: 1 }]]);
  assert.deepEqual(c.find(x => x.id === 'a:25+b:75').legs, [{ id: 'a', weight: .25 }, { id: 'b', weight: .75 }]);
  assert.equal(c.filter(x => x.legs.length === 3).length, 4);
  assert.equal(P.searchCandidates(P.initialMethods.map(([id]) => id)).length, 651);
});

test('a blend is the sum of separate sleeves: one rule reproduces the engine, two rules follow their summed value', () => {
  const input = fixture(), start = P.rollingStarts(input, 1).starts[2];
  const ids = ['lump_sum', 'tranche_6', 'ma200_hold', 'vix_panic_reentry'];
  const window = P.searchWindow(start, ids.map(id => P.rollingPath(input, start, 1, id)));
  assert.match(window.errors.vix_panic_reentry, /TQQQ/, 'a rule that cannot run keeps its reason');
  const direct = id => P.simulate({ ...input, requireFullWindow: true, config: { ...input.config, initialMethod: id, years: 'custom', start, end: P.addYears(start, 1) } });
  const lump = direct('lump_sum'), tranche = direct('tranche_6');
  const one = P.blendWindow(window, [{ id: 'lump_sum', weight: 1 }]);
  assert.equal(one.annualReturn, lump.annualReturn); assert.equal(one.mdd, lump.mdd);
  // Without later deposits each sleeve's unit value is its value over the initial capital, so the blend is too.
  const blend = P.blendWindow(window, [{ id: 'lump_sum', weight: .25 }, { id: 'tranche_6', weight: .75 }]);
  const summed = lump.curve.map((p, i) => (.25 * p.value + .75 * tranche.curve[i].value) / input.config.initial);
  close(blend.annualReturn, P.annualReturn(summed.at(-1), lump.start, lump.end), 1e-9);
  close(blend.mdd, mddOf(summed), 1e-9);
  assert.equal(P.blendWindow(window, [{ id: 'lump_sum', weight: .5 }, { id: 'vix_panic_reentry', weight: .5 }]), null, 'a blend with a failed sleeve has no result');
  // With monthly additions, two identical sleeves are the rule itself.
  const monthly = fixture({ monthly: 200 }), s2 = P.rollingStarts(monthly, 1).starts[1];
  const w2 = P.searchWindow(s2, [P.rollingPath(monthly, s2, 1, 'tranche_6')]);
  const twice = P.blendWindow({ ...w2, paths: { a: w2.paths.tranche_6, b: w2.paths.tranche_6 } }, [{ id: 'a', weight: .5 }, { id: 'b', weight: .5 }]);
  close(twice.annualReturn, w2.paths.tranche_6.annualReturn, 1e-9); close(twice.mdd, w2.paths.tranche_6.mdd, 1e-9);
});

test('the summary gives medians, worst cases, strict wins against lump sum, both halves of the starts and an optional start filter', () => {
  const candidates = [{ id: 'lump_sum', legs: [{ id: 'lump_sum', weight: 1 }] }, { id: 'x', legs: [{ id: 'x', weight: 1 }] }, { id: 'y', legs: [{ id: 'y', weight: 1 }] }];
  const rows = [[10, 12, NaN], [20, 20, 5], [5, 4, 6], [8, 9, 7]], mdds = [[-20, -10, NaN], [-30, -30, -5], [-10, -12, -6], [-25, -5, -7]];
  const evaluated = rows.map((annual, s) => ({ start: '2020-0' + (s + 1) + '-01', annual: Float64Array.from(annual), mdd: Float64Array.from(mdds[s]) }));
  const out = P.searchSummary(evaluated, candidates);
  const x = out.find(r => r.id === 'x'), lump = out.find(r => r.id === 'lump_sum'), y = out.find(r => r.id === 'y');
  assert.equal(x.all.count, 4); assert.equal(x.all.failed, 0);
  assert.equal(x.all.median, 10.5); assert.equal(x.all.worst, 4); assert.equal(x.all.mddMedian, -11); assert.equal(x.all.mddWorst, -30);
  close(x.all.ratio, 10.5 / 11);
  assert.deepEqual(x.all.beat, { wins: 2, of: 4 }, 'a tie is no win');
  assert.equal(lump.all.beat, null);
  assert.equal(y.all.count, 3); assert.equal(y.all.failed, 1); assert.deepEqual(y.all.beat, { wins: 1, of: 3 }, 'only starts where both ran count');
  assert.equal(x.early.count, 2); assert.equal(x.early.median, 16); assert.equal(x.late.median, 6.5);
  const filtered = P.searchSummary(evaluated, candidates, { include: start => start >= '2020-02-01' });
  assert.equal(filtered.find(r => r.id === 'x').all.count, 3);
  assert.equal(P.searchSummary(evaluated.slice(0, 1), candidates).find(r => r.id === 'y').all.median, null, 'no successful start leaves the figures empty');
});

test('ranking follows the chosen criterion, breaks ties by median, and leaves candidates without results out', () => {
  const s = (id, median, worst, ratio, wins, of) => ({ id, all: { count: median === null ? 0 : 3, median, worst, ratio, beat: of == null ? null : { wins, of } } });
  const rows = [s('lump_sum', 10, 2, .5, null, null), s('a', 12, 1, .4, 2, 3), s('b', 11, 3, .6, 3, 3), s('c', 12, 0, null, 1, 3), s('d', null, null, null, 0, 0)];
  assert.deepEqual(P.searchRank(rows, 'median').map(r => r.id), ['a', 'c', 'b', 'lump_sum']);
  assert.deepEqual(P.searchRank(rows, 'worst').map(r => r.id), ['b', 'lump_sum', 'a', 'c']);
  assert.deepEqual(P.searchRank(rows, 'ratio').map(r => r.id), ['b', 'lump_sum', 'a', 'c']);
  assert.deepEqual(P.searchRank(rows, 'wins').map(r => r.id), ['b', 'a', 'c', 'lump_sum'], 'the reference has no wins and goes last');
});

test('the reference trend gives the target mix distance from its 200-day line once 200 closes exist', () => {
  const input = fixture(), trend = P.referenceTrend(input);
  assert.equal(trend.days.length, trend.deviation.length);
  assert.equal(trend.deviation[198], null); assert.equal(typeof trend.deviation[199], 'number');
  const chart = P.chartIndicators(P.simulate({ ...input, config: { ...input.config, initialMethod: 'ma200_hold', years: 'common' } }));
  const line = new Map(chart.series.find(l => l.id === 'basket:ma200').points);
  for (const i of [199, 400, 799]) close(trend.deviation[i], line.get(trend.days[i]), 1e-12);
});

test('the pick is the candidate whose weaker half ranks best, with every candidate’s ranks kept', () => {
  const s = (id, all, early, late) => ({ id, all: { count: 3, median: all, worst: 0, ratio: null, beat: null }, early: { count: 2, median: early, worst: 0, ratio: null, beat: null }, late: { count: 1, median: late, worst: 0, ratio: null, beat: null } });
  // 'top' leads overall but is weak in the later half; 'steady' is second in both halves.
  const rows = [s('top', 30, 40, 5), s('steady', 29, 41, 20), s('early', 28, 45, 1), s('late', 27, 10, 25)];
  const pick = P.searchPick(rows, 'median');
  assert.deepEqual(pick.ranked.map(r => r.id), ['top', 'steady', 'early', 'late']);
  assert.equal(pick.robust.id, 'steady');
  assert.deepEqual(pick.ranks.steady, { all: 2, early: 2, late: 2 });
  assert.deepEqual(pick.ranks.top, { all: 1, early: 3, late: 3 });
  assert.equal(P.searchPick([], 'median').robust, null);
});
