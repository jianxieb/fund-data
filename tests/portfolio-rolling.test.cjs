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
  assert.deepEqual(s.annual, { min: -5, q1: 0, median: 5, q3: 10, max: 20, mean: 6 });
  assert.deepEqual(s.drawdown, { worst: -30, q1: -20, median: -15, q3: -10, best: -5, mean: -16 });
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

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../assets/model.js');
function rollingView() {
  const context = { window: { Changheng: M, ChanghengPortfolioModel: P } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../assets/portfolio-rolling.js'), 'utf8'), context);
  return context.window.ChanghengPortfolioRolling;
}
const H = { esc: String, pct: String, pc: String, money: String,
  action: (label, act, cls, extra = '') => '<button data-action="' + act + '" ' + extra + '>' + label + '</button>',
  card: (title, subtitle, html, controls = '') => '<section><h2>' + title + '</h2><p>' + subtitle + '</p>' + controls + html + '</section>' };
// 72 monthly starts from 2015-01; references are set per start by the caller.
function syntheticRun({ annualAt = i => 12 + 9 * Math.sin(i / 6), lumpSumAt = () => null, benchmarkAt = () => null, mddAt = i => -20 - (i % 9) * 3 } = {}) {
  const rows = Array.from({ length: 72 }, (_, i) => {
    const start = new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10), annual = annualAt(i);
    return { start, actualStart: start, end: P.addYears(start, 5), annualReturn: annual, totalReturn: annual * 5, mdd: mddAt(i), contributed: 10000,
      value: 10000 * (1 + annual / 100) ** 5, lumpSum: lumpSumAt(i, annual), benchmark: benchmarkAt(i) };
  });
  return { config: { currency: 'CNY' }, years: 5, rows, summary: P.rollingSummary(rows), benchmark: 'SPY', catalogRefresh: null };
}
const chartOf = html => html.split('各起点的年化收益')[1];
const ticksOf = html => [...chartOf(html).matchAll(/data-rolling-tick="(-?[\d.]+)"/g)].map(m => Number(m[1]));
const lineOf = (html, key) => chartOf(html).match(new RegExp('<path data-rolling-line="' + key + '"[^>]*>'))?.[0];
const attr = (tag, name) => tag.match(new RegExp(' ' + name + '="([^"]*)"'))?.[1];

test('a reference identical to the setup stays visible: drawn on top in its own colour, counted and shaded only where they differ', () => {
  const Rolling = rollingView();
  // The first 30 starts match 一次性投入 exactly; later ones sit above, then below, crossing once.
  const run = syntheticRun({ lumpSumAt: (i, annual) => i < 30 ? annual : annual + (i < 50 ? -4 : 3) });
  const html = Rolling.view({ years: 5, run, progress: null, error: '' }, H);
  const setup = lineOf(html, 'setup'), lumpSum = lineOf(html, 'lumpSum');
  assert.ok(setup && lumpSum);
  assert.ok(chartOf(html).indexOf(setup) < chartOf(html).indexOf(lumpSum), '一次性投入 is drawn after, so on top of, the setup');
  assert.equal(attr(lumpSum, 'stroke'), '#4a6fb5');
  assert.notEqual(attr(lumpSum, 'stroke'), attr(setup, 'stroke'));
  assert.ok(html.includes('30 个起点的结果与一次性投入完全相同，两条线重合。'));
  assert.match(chartOf(html), /<path data-rolling-gap="above" [^>]*d="M/);
  assert.match(chartOf(html), /<path data-rolling-gap="below" [^>]*d="M/);
  const allSame = Rolling.view({ years: 5, run: syntheticRun({ lumpSumAt: (i, annual) => annual }), progress: null, error: '' }, H);
  assert.ok(allSame.includes('72 个起点的结果与一次性投入完全相同'));
  assert.doesNotMatch(chartOf(allSame), /data-rolling-gap/);
  const lumpSumSetup = Rolling.view({ years: 5, run: syntheticRun(), progress: null, error: '' }, H);
  assert.doesNotMatch(lumpSumSetup, /完全相同|data-rolling-gap|data-rolling-line="lumpSum"/);
});

test('legend samples copy each line’s colour and dash, and the axis uses round ticks that include zero', () => {
  const Rolling = rollingView();
  const run = syntheticRun({ lumpSumAt: (i, annual) => annual - 3, benchmarkAt: i => 8 + (i % 7) });
  const html = Rolling.view({ years: 5, run, progress: null, error: '' }, H);
  for (const key of ['setup', 'lumpSum', 'benchmark']) {
    const path = lineOf(html, key), sample = html.match(new RegExp('<line data-rolling-sample="' + key + '"[^>]*>'))?.[0];
    assert.ok(sample, key + ' has a legend sample');
    assert.equal(attr(sample, 'stroke'), attr(path, 'stroke'), key);
    assert.equal(attr(sample, 'stroke-dasharray') || '', attr(path, 'stroke-dasharray') || '', key);
  }
  const positive = ticksOf(html), step = positive[1] - positive[0];
  assert.ok([1, 2, 2.5, 5, 10, 20, 25, 50].includes(step), 'round step ' + step);
  assert.ok(positive.every(v => Math.abs(v / step - Math.round(v / step)) < 1e-9));
  assert.equal(positive[0], 0, 'all values are positive, so the axis starts at 0 with no negative tick');
  const values = run.rows.flatMap(r => [r.annualReturn, r.lumpSum, r.benchmark]);
  assert.ok(positive.at(-1) >= Math.max(...values) && positive.at(-2) < Math.max(...values));
  const negative = ticksOf(Rolling.view({ years: 5, run: syntheticRun({ annualAt: i => -6 + i / 3 }), progress: null, error: '' }, H));
  assert.ok(negative.includes(0) && negative[0] < 0 && negative[0] <= -6);
  assert.deepEqual([...chartOf(html).matchAll(/data-rolling-year="(\d{4})"/g)].map(m => m[1]), ['2016', '2017', '2018', '2019', '2020']);
});

test('the distribution card draws a histogram on round bins, a drawdown strip and count bars, keeping every figure as text', () => {
  const Rolling = rollingView();
  const run = syntheticRun({ annualAt: i => -6 + i / 3 + 2 * Math.sin(i), lumpSumAt: (i, annual) => annual - 1 + (i % 3), benchmarkAt: i => 4 + (i % 5) });
  const s = run.summary, html = Rolling.view({ years: 5, run, progress: null, error: '' }, H);
  const card = html.split('<h2>起点分布</h2>')[1].split('各起点的年化收益')[0];
  const bins = [...card.matchAll(/<rect data-rolling-bin="(-?[\d.]+)\|(-?[\d.]+)" data-count="(\d+)" fill="([^"]+)"/g)].map(m => ({ from: +m[1], to: +m[2], count: +m[3], fill: m[4] }));
  assert.ok(bins.length >= 5, 'bins ' + bins.length);
  const step = bins[0].to - bins[0].from;
  assert.ok([1, 2, 2.5, 5, 10].includes(step), 'round bin width ' + step);
  assert.equal(bins.reduce((n, b) => n + b.count, 0), s.count, 'every start falls in one bin');
  for (const b of bins) {
    assert.ok(Math.abs(b.from / step - Math.round(b.from / step)) < 1e-9 && b.from >= 0 === b.to > 0, 'no bin straddles 0: ' + b.from);
    assert.equal(b.fill, b.from >= 0 ? '#6f9f7e' : '#cf8072');
  }
  assert.ok(bins.some(b => b.from < 0) && bins.some(b => b.from >= 0));
  for (let i = 1; i < bins.length; i++) assert.equal(bins[i].from, bins[i - 1].to, 'bins are contiguous');
  assert.ok(bins[0].from <= s.annual.min && bins.at(-1).to >= s.annual.max);
  for (const key of ['q1', 'median', 'q3']) assert.match(card, new RegExp('data-rolling-marker="' + key + '"'));
  assert.ok(card.includes('<span>平均</span><strong class="num">' + String(s.annual.mean) + '</strong>'), 'the mean sits beside the median');
  assert.ok(card.includes('<h3>最大回撤<small>平均 ' + String(s.drawdown.mean) + '</small></h3>'));
  for (const value of [s.annual.min, s.annual.q1, s.annual.median, s.annual.q3, s.annual.max, s.drawdown.worst, s.drawdown.q1, s.drawdown.median, s.drawdown.q3, s.drawdown.best])
    assert.ok(card.includes('>' + String(value) + '<'), String(value));
  for (const key of ['worst', 'q1', 'median', 'q3', 'best']) assert.match(card, new RegExp('data-rolling-drawdown="' + key + '"'));
  const meter = key => card.match(new RegExp('data-rolling-meter="' + key + '" style="width:([\\d.]+)%"'))?.[1];
  assert.equal(Number(meter('losses')), +(100 * s.losses / s.count).toFixed(2));
  assert.equal(Number(meter('beatLumpSum')), +(100 * s.beatLumpSum.wins / s.beatLumpSum.of).toFixed(2));
  assert.equal(Number(meter('beatBenchmark')), +(100 * s.beatBenchmark.wins / s.beatBenchmark.of).toFixed(2));
  assert.ok(card.includes(s.losses + ' / ' + s.count) && card.includes('胜过对照 SPY'));
  assert.doesNotMatch(card, /NaN|undefined|概率/);
  const plain = Rolling.view({ years: 5, run: syntheticRun(), progress: null, error: '' }, H).split('<h2>起点分布</h2>')[1].split('各起点的年化收益')[0];
  assert.doesNotMatch(plain, /data-rolling-meter="beatLumpSum"|data-rolling-meter="beatBenchmark"/);
});

test('the period choice is one bare control row, and the start rule moves into the result subtitle', () => {
  const Rolling = rollingView(), run = syntheticRun();
  const empty = Rolling.view({ years: 5, run: null, progress: null, error: '' }, H);
  assert.doesNotMatch(empty, /<h2>起点检验<\/h2>|card-head/, 'no card title above the period choice');
  assert.match(empty, /^<div class="portfolio-comparison portfolio-rolling"><div class="portfolio-rolling-controls">/);
  const html = Rolling.view({ years: 5, run, progress: null, error: '' }, H);
  assert.ok(html.includes('<p>每月首个共同交易日建仓 · ' + run.summary.firstStart + ' — ' + run.summary.lastStart + ' · ' + run.summary.count + ' 个起点 · 各持有 5 年</p>'));
});
