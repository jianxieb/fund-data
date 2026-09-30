'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../assets/model.js');

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual), `Expected a finite number, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function fund(patch = {}) {
  return { c: '000001', n: '沪深300指数基金A', ix: '沪深300指数', g: 'x3', t: '场外', d: '2010-01-01', navdate: '2026-09-21',
    r: [10, 20, 30, 50, 100], mdd5: -20, vol5: 15, mdd3: -15, v3: 12, fee: [0.15, 0.05, 0], ...patch };
}

test('quality candidates and dividend stocks stay separate even with stale qualification flags', () => {
  const growth = {c:'123456', group:'quality', qualityReview:{qualified:true}, longTermReview:{qualified:true}, growthReview:{qualified:true}, qualityResearch:{code:'123456', status:'reviewed'}};
  const failed = {group:'quality', qualityReview:{qualified:false}};
  const dividend = {group:'dividend', qualityReview:{qualified:true}};
  const dividendWithStaleFailure = {group:'dividend', qualityReview:{qualified:false}};
  const noResearch = {...growth, qualityResearch:null};
  const wrongResearch = {...growth, qualityResearch:{code:'654321', status:'reviewed'}};
  const rows = [growth, failed, noResearch, wrongResearch, dividend, dividendWithStaleFailure];
  assert.deepEqual(rows.filter(s => M.stockMatches(s, 'quality')), [growth]);
  assert.deepEqual(rows.filter(s => M.stockMatches(s, 'growth')), [growth]);
  const growthOnly = {...growth, group:'growth', longTermReview:{qualified:false}};
  assert.equal(M.stockMatches(growthOnly, 'growth'), true);
  assert.equal(M.stockMatches(growthOnly, 'quality'), false);
  assert.equal(M.stockMatches({...dividend, growthReview:{qualified:true}, qualityResearch:growth.qualityResearch}, 'growth'), false);
  assert.deepEqual(rows.filter(s => M.stockMatches(s, 'quality', true)), [growth]);
  assert.deepEqual(rows.filter(s => M.stockMatches(s, 'dividend')), [dividend, dividendWithStaleFailure]);
  assert.deepEqual(rows.filter(s => M.stockMatches(s, 'all', true)), []);
  assert.equal(M.stockMatches({qualityReview:{qualified:true}}, 'quality', true), false);
});

test('earnings breakouts require reviewed evidence and remain separate from quality stages', () => {
  const stock = {c:'002648', group:'quality', qualityResearch:{code:'002648',status:'reviewed'},
    longTermReview:{qualified:false}, growthReview:{qualified:false}, breakoutReview:{qualified:true}};
  assert.equal(M.stockMatches(stock, 'breakout'), true);
  assert.equal(M.stockMatches(stock, 'quality'), false);
  assert.equal(M.stockMatches({...stock, growthReview:{qualified:true}}, 'breakout'), false);
  assert.equal(M.stockMatches({...stock, group:'dividend'}, 'breakout'), false);
  assert.equal(M.stockMatches({...stock, qualityResearch:{code:'601138',status:'reviewed'}}, 'breakout'), false);
});

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

function buyData(products, fx = [['2020-01-01', 1], ['2021-01-01', 1]]) {
  return { asOf: '2021-01-01', fx, products: products.map(p => ({ family: 'sp', name: p.code, channel: 'us', dividendFraction: {}, ...p })) };
}
const freeFees = { usCommission: 0, usMinimum: 0, fxSpread: 0, exchangeCommission: 0, exchangeMinimum: 0,
  subscription: 0, redemption: 0, usDividendTax: 10, cnDividendTax: 20, capitalGainsTax: 20 };
const buyConfig = { family: 'sp', years: 1, plan: 'lump', lumpAmount: 100, monthlyAmount: 100, fees: freeFees };

test('buy-location simulation taxes US realized gains but not domestic fund gains', () => {
  const series = [['2020-01-01', 100], ['2021-01-01', 120]];
  const data = buyData([{ code: 'SPY', series }, { code: 'CN', channel: 'off', series }]);
  const result = M.buyLocationResult(data, buyConfig);
  assert.equal(result.start, '2020-01-01'); assert.equal(result.end, '2021-01-01');
  close(result.rows[0].taxableGain, 20); close(result.rows[0].capitalTax, 4); close(result.rows[0].terminal, 116);
  close(result.rows[1].terminal, 120); close(result.rows[1].capitalTax, 0);
  close(result.rows[0].xirr, 16, 0.05);
});

test('US dividend withholding and China top-up reduce reinvestment without double-taxing the sale', () => {
  const data = buyData([{ code: 'SPY', series: [['2020-01-01', 100], ['2021-01-01', 110]],
    dividendFraction: { '2021-01-01': 10 / 110 } }]);
  const [row] = M.buyLocationResult(data, buyConfig).rows;
  close(row.usDividendTax, 1); close(row.cnDividendTax, 1);
  close(row.basis, 108); close(row.capitalTax, 0); close(row.terminal, 108);
  const noTreaty = M.buyLocationResult(data, { ...buyConfig, fees: { ...freeFees, usDividendTax: 30 } }).rows[0];
  close(noTreaty.usDividendTax, 3); close(noTreaty.cnDividendTax, 0); close(noTreaty.terminal, 107);
});

test('monthly investing pays minimum commission each time and rejects unaffordable orders', () => {
  const series = [['2020-01-01', 100], ['2020-02-03', 100], ['2021-01-01', 100]];
  const data = buyData([{ code: 'CN', channel: 'exchange', series, navSeries: series }], series.map(([day]) => [day, 1]));
  const config = { ...buyConfig, plan: 'monthly', fees: { ...freeFees, exchangeMinimum: 5 } };
  const [row] = M.buyLocationResult(data, config).rows;
  assert.equal(row.purchases, 3); close(row.transactionCost, 20); close(row.terminal, 280);
  assert.match(M.buyLocationResult(data, { ...config, monthlyAmount: 5 }).rows[0].error, /最低手续费/);
});

test('off-exchange funds use their own subscription and redemption fees', () => {
  const series = [['2020-01-01', 100], ['2021-01-01', 100]];
  const data = buyData([{ code: 'A', channel: 'off', series }, { code: 'B', channel: 'off', series }]);
  const [a, b] = M.buyLocationResult(data, { ...buyConfig, fundFees: {
    A: { subscription: 0, redemption: 0 }, B: { subscription: 10, redemption: 10 }
  } }).rows;
  close(a.terminal, 100);
  close(b.terminal, 100 / 1.1 * 0.9);
  close(b.transactionCost, 100 - b.terminal);
});

test('comparison requires a full shared window rather than filling missing history', () => {
  const data = buyData([{ code: 'SPY', series: [['2020-06-01', 100], ['2021-01-01', 120]] }],
    [['2020-06-01', 1], ['2021-01-01', 1]]);
  assert.match(M.buyLocationResult(data, buyConfig).error, /完整共同历史/);
});

test('published buy-location snapshot supports both index families across every offered period', () => {
  const source = fs.readFileSync(require.resolve('../data/buy-location.js'), 'utf8');
  const data = JSON.parse(source.slice('window.BUY_LOCATION_DATA='.length).trim().replace(/;$/, ''));
  assert.equal(data.products.length, 8);
  for (const family of ['sp', 'nq']) for (const years of [1, 2, 3, 5, 10]) for (const plan of ['lump', 'monthly']) for (const exchangeBasis of ['nav', 'market']) {
    const result = M.buyLocationResult(data, { ...buyConfig, family, years, plan, exchangeBasis });
    assert.equal(result.error, undefined, `${family} ${years}年：${result.error}`);
    assert.equal(result.end, data.asOf);
    for (const row of result.rows) {
      assert.equal(row.error, undefined, `${row.code}：${row.error}`);
      assert.ok(Number.isFinite(row.terminal) && Number.isFinite(row.xirr));
      assert.ok(row.transactionCost >= 0 && row.capitalTax >= 0);
    }
  }
});

test('default NAV simulation excludes premium changes while retaining per-order costs and dividends once', () => {
  const navSeries = [['2020-01-01', 100], ['2021-01-01', 110]]; // Total return already includes the distribution.
  const series = [['2020-01-01', 120], ['2021-01-01', 110]]; // Initial premium of 20% disappears.
  const data = buyData([{ code: 'CN', channel: 'exchange', series, navSeries,
    actions: { cash: [{ date: '2021-01-01', perUnit: 10 }] } }]);
  const fees = { ...freeFees, exchangeMinimum: 5 };
  const nav = M.buyLocationResult(data, { ...buyConfig, fees }).rows[0];
  const market = M.buyLocationResult(data, { ...buyConfig, fees, exchangeBasis: 'market' }).rows[0];
  close(nav.terminal, 95 * 1.1 - 5);
  close(market.terminal, 95 * 110 / 120 - 5);
  close(nav.transactionCost, 10); close(market.transactionCost, 10);
  close(nav.premiumRatioChange, -100 / 6);
  assert.equal(nav.dividendsIncluded, true); assert.equal(nav.exchangeBasis, 'nav');
  delete data.products[0].navSeries;
  assert.match(M.buyLocationResult(data, buyConfig).error, /缺少历史序列/);
  assert.equal(M.buyLocationResult(data, { ...buyConfig, exchangeBasis: 'market' }).error, undefined);
});

test('cross-border multiselect combines within each dimension and excludes unknown premiums only when capped', () => {
  const a = { c: 'A', n: '国泰纳指', ix: '纳斯达克100', exchange: true, prem: 4 };
  const b = { ...a, c: 'B', ix: '标普500', prem: null };
  const c = { ...a, c: 'C', exchange: false, prem: null, st: '开放申购' };
  const filters = { types: ['纳斯达克100', '标普500'], channels: ['exchange', 'off'] };
  assert.equal([a, b, c].filter(f => M.crossborderMatches(f, filters)).length, 3);
  assert.deepEqual([a, b, c].filter(f => M.crossborderMatches(f, { ...filters, premiumMax: 5 })).map(f => f.c), ['A', 'C']);
  assert.equal(M.crossborderMatches(a, { ...filters, channels: ['off'] }), false);
  assert.equal(M.crossborderMatches(c, { query: '国泰', purchasable: true }), true);
  assert.equal(M.crossborderMatches({ ...c, st: '暂停申购' }, { purchasable: true }), false);
  assert.equal(M.crossborderMatches({ ...c, st: '暂停大额申购' }, { purchasable: true }), false);
});

test('cross-border market returns never silently substitute NAV when missing', () => {
  const f = { exchange: true, r: [10], returnAsOf: '2026-09-24' };
  const evidence = { nav: { r: [10], returnAsOf: '2026-09-24' }, market: { r: [25], returnAsOf: '2026-09-24' } };
  assert.equal(M.crossborderPerformance(f, evidence).r[0], 10);
  assert.equal(M.crossborderPerformance(f, evidence, 'market').r[0], 25);
  assert.equal(M.crossborderPerformance(f, {}, 'market').r[0], null);
  assert.equal(M.crossborderPerformance({ ...f, exchange: false }, evidence, 'market').r[0], 10);
});


test('all fund facets include every individual selection and combine by union', () => {
  const vm = require('node:vm'), ctx = {};
  for (const path of ['data/snapshot.js', 'data/screening.js']) vm.runInNewContext(fs.readFileSync(path, 'utf8'), ctx);
  const funds = M.dedupeFunds(ctx.FUNDS, ctx.EXTRA), policy = ctx.SCREEN_POLICY;
  const pool = funds.filter(f => M.fundScopeMatches(f, policy.byCode[f.c], 'equity', policy.defaults));
  const codes = facets => new Set(pool.filter(f => M.fundFacetMatches(f, policy.byCode[f.c], 'equity', facets, policy.defaults)).map(f => f.c));
  const all = codes([]), broad = codes(['broad']), theme = codes(['theme']), both = codes(['broad', 'theme']);
  assert.ok(all.size > policy.shortlist.length);
  for (const code of [...broad, ...theme]) assert.ok(all.has(code));
  assert.deepEqual(both, all);
  assert.equal(broad.size + theme.size, all.size);
  assert.equal(pool.filter(f => f.exchange).length, 0);
});

test('index categories distinguish actual sectors, factors and broad exposure', () => {
  const kind = (n, ix = n) => M.indexFundKind(M.dedupeFunds([], [fund({n, ix})])[0], {});
  assert.equal(kind('中证A500ETF', '中证A500指数'), 'broad');
  assert.equal(kind('机器人ETF'), 'sector');
  assert.equal(kind('大数据ETF'), 'sector');
  assert.equal(kind('中证红利ETF'), 'factor');
  assert.equal(kind('国债ETF'), 'fixed');
  assert.equal(kind('豆粕ETF'), 'commodity');
  assert.equal(kind('标普500ETF'), 'overseas');
  assert.equal(M.indexSectorMatches(fund({n:'银行ETF', ix:'中证银行指数'}), ['medical']), false);
  assert.equal(M.indexSectorMatches(fund({n:'银行ETF', ix:'中证银行指数'}), ['medical', 'financial']), true);
  assert.equal(M.indexSectorMatches(fund(), []), true);
});

test('reviewed coverage products keep identity, real NAV dates and complete-window boundaries', () => {
  const vm = require('node:vm'), ctx = {};
  vm.runInNewContext(fs.readFileSync('data/snapshot.js', 'utf8'), ctx);
  const funds = new Map(M.dedupeFunds(ctx.FUNDS, ctx.EXTRA).map(f => [f.c, f]));
  const catalog = JSON.parse(fs.readFileSync('data/index-fund-catalog.json', 'utf8'));
  for (const item of catalog.products) {
    const f = funds.get(item.code);
    assert.ok(f, item.code);
    assert.equal(f.n, item.expectedName);
    assert.ok(f.ix && f.indexCode, item.code);
    assert.ok(M.validDate(f.returnAsOf), item.code);
    assert.ok(f.returnAsOf >= '2026-09-28', item.code);
    for (let i = 0; i < 5; i++) if (f.r[i] !== null) assert.ok(M.hasWindow(f.returnFirst, f.returnAsOf, [1,2,3,5,10][i]), item.code);
  }
  const young = funds.get('512450');
  for (let i = 0; i < 5; i++) if (!M.hasWindow(young.returnFirst, young.returnAsOf, [1,2,3,5,10][i])) assert.equal(young.r[i], null);
});

test('growth board exclusion uses security code rather than company labels', () => {
  assert.equal(M.stockBoard('688700'), 'star');
  assert.equal(M.stockBoard('689009'), 'star');
  assert.equal(M.stockBoard('300308'), 'chinext');
  assert.equal(M.stockBoard('301269'), 'chinext');
  assert.equal(M.stockBoard('601138'), 'main');
  assert.equal(M.stockBoard('002384'), 'main');
});

test('scroll batches cover all results once, including a partial final batch', () => {
  for (const total of [0, 2, 22, 45, 112, 1369]) {
    let shown = 0; const indices = [];
    do {
      const w = M.loadWindow(total, shown, 20);
      for (let i = w.start; i < w.end; i++) indices.push(i);
      shown = w.end;
      if (!w.hasMore) break;
    } while (shown < total);
    assert.deepEqual(indices, Array.from({length: total}, (_, i) => i));
    assert.equal(M.loadWindow(total, shown, 20).hasMore, false);
  }
});
