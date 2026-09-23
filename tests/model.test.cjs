'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/model.js');

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual), `Expected a finite number, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function fund(patch = {}) {
  return { c: '000001', n: '沪深300指数基金A', ix: '沪深300指数', g: 'x3', t: '场外', d: '2010-01-01', navdate: '2026-09-21',
    r: [10, 20, 30, 50, 100], mdd5: -20, vol5: 15, mdd3: -15, v3: 12, fee: [0.15, 0.05, 0], ...patch };
}

test('calendar coverage rejects impossible dates and handles leap anniversaries', () => {
  assert.equal(M.hasWindow('2021-02-28', '2024-02-29', 3), true);
  assert.equal(M.hasWindow('2021-03-01', '2024-02-29', 3), false);
  for (const invalid of ['2026-02-30', '2026-13-01', 'not-a-date', null]) {
    assert.doesNotThrow(() => M.hasWindow(invalid, '2026-09-21', 5));
    assert.equal(M.hasWindow(invalid, '2026-09-21', 5), false);
    assert.equal(M.hasWindow('2010-01-01', invalid, 5), false);
    assert.equal(M.yearsBetween('2010-01-01', invalid), null);
  }
  assert.equal(M.hasWindow('2027-01-01', '2026-01-01', 1), false);
  assert.equal(M.hasWindow('2010-01-01', '2026-01-01', 1.5), false);
  assert.equal(M.hasWindow('2010-01-01', '2026-01-01', 1e12), false);
});

test('deduplication keeps NAV, return and risk observation dates independent', () => {
  const freshNAV = fund({ navdate: '2026-09-21', returnAsOf: '2026-09-10', riskAsOf: '2026-09-19', r: [1, 2, 3, 4, 5], mdd5: -25 });
  const freshReturns = fund({ navdate: '2026-09-18', returnAsOf: '2026-09-18', riskAsOf: '2026-09-18', r: [10, 20, 30, 40, 50], returnSource: 'verified-snapshot' });
  const [f] = M.dedupeFunds([freshNAV], [freshReturns]);
  assert.equal(f.navdate, '2026-09-21'); assert.equal(f.returnAsOf, '2026-09-18'); assert.equal(f.riskAsOf, '2026-09-19');
  assert.deepEqual(f.r, [10, 20, 30, 40, 50]); assert.equal(f.mdd5, -25);
  assert.equal(f.returnSource, 'verified-snapshot'); assert.equal(f.origin, 'overseas');
  assert.equal(f.returnDateInferred, false); assert.equal(f.riskDateInferred, false);
});

test('a newer NAV does not upgrade unknown return/risk dates or replace verified returns', () => {
  const legacy = fund({ navdate: '2026-09-21' });
  const verified = fund({ navdate: '2026-09-10', returnAsOf: '2026-09-10', riskAsOf: '2026-09-10', r: [1, 2, 3, 4, 5] });
  const [merged] = M.dedupeFunds([legacy], [verified]);
  assert.deepEqual(merged.r, [1, 2, 3, 4, 5]);
  const [old] = M.dedupeFunds([], [legacy]);
  assert.equal(old.returnAsOf, null); assert.equal(old.riskAsOf, null);
  assert.equal(old.returnDateInferred, true); assert.equal(old.riskDateInferred, true);
});

test('insufficient inception and history coverage leave the named window empty', () => {
  const [young] = M.dedupeFunds([], [fund({ d: '2023-09-20', returnAsOf: '2026-09-18', riskAsOf: '2026-09-18' })]);
  assert.deepEqual(young.r, [10, 20, null, null, null]);
  assert.equal(young.mdd3, null); assert.equal(young.mdd5, null);
  const [incomplete] = M.dedupeFunds([], [fund({ returnFirst: '2024-01-01', riskFirst: '2025-01-01', returnAsOf: '2026-09-18', riskAsOf: '2026-09-18' })]);
  assert.deepEqual(incomplete.r, [10, 20, null, null, null]);
  assert.equal(incomplete.mdd3, null); assert.equal(incomplete.vol5, null);
});

test('per-window source dates are retained and cannot substitute shorter histories', () => {
  const [f] = M.dedupeFunds([], [fund({ returnAsOf: '2026-09-18', returnFirst: '2010-01-01', returnPeriods: [
    { years: 1, start: '2025-09-18', end: '2026-09-18' },
    { years: 2, start: '2024-09-18', end: '2026-09-18' },
    { years: 3, start: '2024-09-18', end: '2026-09-18' },
    { years: 5, start: null, end: '2026-09-18' },
    { years: 10, start: '2016-09-18', end: '2026-09-10' }
  ] })]);
  assert.deepEqual(f.r, [10, 20, null, null, null]);
  close(f.returnYears[0], 365 / 365.2425);
});

test('normalization ignores invalid identities and leaves raw snapshots unchanged', () => {
  const input = fund(); const before = M.copy(input);
  assert.deepEqual(M.dedupeFunds({}, null), []);
  assert.equal(M.dedupeFunds([null, false, { c: 'bad' }, input], []).length, 1);
  assert.deepEqual(input, before);
  const [normalized] = M.dedupeFunds([], [fund({ r: [10, '20', NaN, -101, null], vol5: -5, mdd5: 5 })]);
  assert.deepEqual(normalized.r, [10, null, null, null, null]);
  assert.equal(normalized.vol5, null); assert.equal(normalized.mdd5, null);
});

test('fee coverage distinguishes missing service charges from verified zero', () => {
  const input = [fund({ c: '000001', fee: [0.15, 0.05, null] }), fund({ c: '000002', fee: [0, 0, 0] }), fund({ c: '000003', fee: [null, null, null] }), fund({ c: '000004', fee: [-1, 0.1, 0] })];
  const [partial, zero, unknown, malformed] = M.dedupeFunds([], input);
  close(partial.annualFee, 0.2); assert.equal(partial.feeCoverage, 'partial'); assert.equal(partial.totalOngoingFee, null);
  close(partial.knownOngoingFee, 0.2);
  assert.equal(zero.feeCoverage, 'complete'); assert.equal(zero.totalOngoingFee, 0);
  assert.equal(unknown.annualFee, null); assert.equal(unknown.knownOngoingFee, null); assert.equal(unknown.feeCoverage, 'unknown');
  assert.equal(malformed.annualFee, null);
});

test('asset labels do not mistake mixed funds, gold miners or oil futures for defensive assets', () => {
  const cases = [
    [{ n: '稳健债券混合基金', ix: '混合型-偏债', g: 'x5' }, 'other'],
    [{ n: '灵活配置混合A', ix: '混合型-灵活', g: 'x1' }, 'other'],
    [{ n: '中证黄金产业股票ETF', ix: '中证黄金产业股票指数', g: 'x4' }, 'cn'],
    [{ n: '上海金ETF', ix: '上海金', g: 'x4' }, 'gold'],
    [{ n: '原油期货基金', ix: '原油期货指数', g: 'x2' }, 'other'],
    [{ n: '股票红利基金', ix: '中证红利指数', g: 'x3' }, 'cn']
  ];
  for (const [patch, expected] of cases) assert.equal(M.dedupeFunds([], [fund(patch)])[0].asset, expected);
  assert.equal(M.dedupeFunds([], [fund({ g: 'x7', n: '通信ETF' })])[0].active, false);
  assert.equal(M.dedupeFunds([], [fund({ g: 'x2', n: '海外指数基金' })])[0].active, false);
  assert.equal(M.dedupeFunds([], [fund({ n: '沪深300指数增强A' })])[0].active, true);
});

test('research labels follow the product exposure rather than which scraper supplied it', () => {
  const rows = M.dedupeFunds([], [
    fund({ c: '007280', n: '摩根日本精选股票(QDII)A', ix: 'QDII-普通股票', g: 'x2' }),
    fund({ c: '000002', n: '主动红利混合A', ix: '混合型-偏股', g: 'x1' }),
    fund({ c: '000003', n: '沪港深红利ETF', ix: '沪港深红利指数', g: 'x3' })
  ]);
  assert.equal(rows[0].overseasExposure, true);
  assert.equal(rows[1].dividend, true);
  assert.equal(rows[1].fixedIncomeOrMixed, true);
  assert.equal(rows[2].asset, 'other');
});

test('display text can be safely escaped without trusting imported names', () => {
  const payload = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const escaped = M.escapeHtml(payload);
  assert.ok(!escaped.includes('<')); assert.ok(!escaped.includes('>'));
  assert.match(escaped, /&lt;img/); assert.match(escaped, /&quot;/); assert.match(escaped, /&#39;/); assert.match(escaped, /&amp;/);
  assert.equal(M.escapeHtml(null), '');
});

test('CSV neutralizes spreadsheet formulas while preserving numeric negatives and quotes', () => {
  const csv = M.csv([['=1+1', '+SUM(A1)', '-1', '@SUM(A1)', '\t=1', '\n=1', '  =1', -1, 'a"b', null]]);
  assert.ok(csv.startsWith('\ufeff'));
  for (const text of ['"\'=1+1"', '"\'+SUM(A1)"', '"\'-1"', '"\'@SUM(A1)"', '"\'  =1"', '"-1"', '"a""b"', '""']) assert.ok(csv.includes(text), text);
});

test('annualization does not turn invalid data or overflow into a displayed number', () => {
  close(M.annualized(21, 2), 10);
  assert.equal(M.annualized(-100, 10), -100);
  for (const args of [[-101, 2], [10, 0], [10, NaN], [null, 1], [Infinity, 1], [1e308, 0.001]]) assert.equal(M.annualized(...args), null);
});

test('multiple return periods keep canonical order and recover from empty or invalid preferences', () => {
  assert.deepEqual(M.visiblePeriods([10, 1, 5, 1, 7]), [1, 5, 10]);
  for (const invalid of [null, {}, [], ['5'], [7]]) assert.deepEqual(M.visiblePeriods(invalid), [3, 5, 10]);
});

test('research sorting keeps missing values last in either direction', () => {
  const input = [null, 10, 0, -3, NaN, 20];
  assert.deepEqual(input.toSorted ? input.toSorted((a, b) => M.compareNullable(a, b, true)).slice(0, 4) : input.slice().sort((a, b) => M.compareNullable(a, b, true)).slice(0, 4), [20, 10, 0, -3]);
  assert.deepEqual(input.slice().sort((a, b) => M.compareNullable(a, b, false)).slice(0, 4), [-3, 0, 10, 20]);
});

test('equity filter uses independent multiyear thresholds and exact current-manager tenure', () => {
  const limits = { minA3: 5, minA5: 8, minA10: null, minHistoryYears: 7, minScale: 1, minManagerYears: 5 };
  const rule = { equityEligible: true, thresholdInputs: { a3: 6, a5: 9, a10: null, historyYears: 10, scale: 2, managerYears: 5.1, passive: false } };
  assert.equal(M.equityQualifies(rule, limits), true);
  assert.equal(M.equityQualifies({ ...rule, equityEligible: false }, limits), false);
  for (const patch of [{ a3: 4.9 }, { a5: 7.9 }, { scale: 0.9 }, { historyYears: 6.9 }, { managerYears: 4.9999 }, { managerYears: null }]) {
    assert.equal(M.equityQualifies({ ...rule, thresholdInputs: { ...rule.thresholdInputs, ...patch } }, limits), false);
  }
  assert.equal(M.equityQualifies(rule, { ...limits, minA10: 0 }), false);
  assert.equal(M.equityQualifies({ ...rule, thresholdInputs: { ...rule.thresholdInputs, managerYears: null, passive: true } }, limits), true);
  assert.equal(M.equityQualifies(null, limits), false);
  assert.equal(M.equityQualifies(rule, { ...limits, minA3: 7 }), false);
});
