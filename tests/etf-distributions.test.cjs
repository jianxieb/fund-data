const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../assets/etf-distributions.js');
const M = require('../assets/model.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('data/etf-distributions.js', 'utf8'), context);
const data = context.window.ETF_DISTRIBUTIONS;
const products = JSON.parse(fs.readFileSync('data/overseas-etf-catalog.json')).products;
const snapshot = {};
vm.runInNewContext(fs.readFileSync('data/snapshot.js', 'utf8'), snapshot);
vm.runInNewContext(fs.readFileSync('data/portfolio/catalog.js', 'utf8'), snapshot);

function reconcileReinvested(item, index, asset, prices, symbol) {
  if (!item.metrics) {
    assert.ok(item.metricsMissingEvidence, symbol);
    assert.ok(item.records.every(row => row.pricePercent === null), symbol);
    return;
  }
  const r = item.metrics.reinvested, cash = item.metrics.trailing.return;
  assert.equal(r.status, cash.status, symbol);
  if (r.status !== 'available') {
    assert.ok(r.reason, symbol);
    return;
  }
  assert.equal(r.start, cash.start, symbol);
  assert.equal(r.end, cash.end, symbol);
  assert.equal(r.end, item.through, symbol);
  assert.ok(prices.has(r.start) && prices.has(r.end), symbol);
  const cumulative = (prices.get(r.end) / prices.get(r.start) - 1) * 100;
  const annualized = M.annualized(cumulative, M.yearsBetween(r.start, r.end));
  // Retained cash evidence can reference an older, validated vendor snapshot.
  const tolerance = item.priceReference.sha256 === asset.sha256 ? 1e-9 : .002;
  assert.ok(Math.abs(r.cumulative - cumulative) < tolerance, symbol);
  assert.ok(Math.abs(r.annualized - annualized) < tolerance, symbol);
  assert.ok(Math.abs(r.cumulative - cash.totalReturn - r.differenceFromCash) < 1e-9, symbol);
  const period = index.periods.find(p => p.years === 1);
  if (item.through < period.end) {
    assert.equal(item.status, 'stale', symbol);
    assert.ok(item.missingEvidence?.includes(item.through), symbol);
    return;
  }
  assert.equal(r.end, period.end, symbol);
  // Ordinary and adjusted histories may select different preceding closes.
  // The displayed cash interval was reconciled above; compare table values
  // only when that rolling window has the same endpoints.
  if (r.start !== period.start) return;
  const annual = M.annualized(index.usd[0], M.yearsBetween(period.start, period.end));
  // Separate vendor snapshots can differ by one float32 ULP, below 0.0001 pp.
  assert.ok(Math.abs(r.cumulative - index.usd[0]) < 1e-4, symbol);
  assert.ok(Math.abs(r.annualized - annual) < 1e-4, symbol);
  assert.equal(r.cumulative.toFixed(2), index.usd[0].toFixed(2), symbol);
  assert.equal(r.annualized.toFixed(2), annual.toFixed(2), symbol);
}

test('cash versus DRIP changes use of proceeds, never original tax or credit', () => {
  for (const kind of ['ordinary', 'qii']) {
    const cash = D.cashChoice(kind, 'cash'), drip = D.cashChoice(kind, 'drip');
    for (const key of ['gross', 'usWithheld', 'cnTax', 'availableAtPayment', 'afterBothTaxes']) assert.equal(cash[key], drip[key]);
    assert.equal(cash.afterBothTaxes, 800);
    assert.equal(drip.cashAtPayment, 0);
    assert.equal(drip.reinvestBeforeFees, cash.cashAtPayment);
    assert.equal(cash.reinvestBeforeFees, 0);
  }
  assert.equal(D.cashChoice('ordinary', 'drip').cnTax, 100);
  assert.equal(D.cashChoice('qii', 'drip').cnTax, 200);
  assert.equal(D.cashChoice('roc', 'drip'), null, 'unknown mainland ROC tax must not become zero');
});

test('all catalog ETFs have observed cash history with distinct date meanings', () => {
  for (const product of products) {
    assert.ok(data.products[product.symbol].records.length);
    const html = D.render(product, data);
    assert.match(html, /有现金分配/);
    assert.match(html, /不是现金到账日/);
    assert.match(html, /历史回报假设分红再投，不表示你的账户已启用DRIP/);
    assert.match(html, /IBKR 盈透/);
    assert.match(html, /汇丰香港 Trade25/);
    assert.match(html, /富途香港/);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});

test('final 2025 classifications cannot silently label 2026 events or all ETF distributions', () => {
  assert.equal(D.taxCase('SGOV', data), 'qii');
  assert.equal(D.taxCase('QQQ', data), 'ordinary-confirmed');
  assert.equal(D.taxCase('QQQI', data), 'roc');
  assert.equal(D.taxCase('JEPQ', data), 'classification-missing');
  assert.match(D.render(products.find(p => p.symbol === 'SGOV'), data), /不证明2026年每笔均免美国税/);
  assert.match(D.render(products.find(p => p.symbol === 'QQQI'), data), /尚缺这笔ROC在内地的所得分类和成本调整确认/);
  assert.match(D.render(products.find(p => p.symbol === 'JEPQ'), data), /不作为这只ETF最新一笔的税款报价/);
});

test('history year selection preserves source cash precision and split warning', () => {
  const item = { records: [
    { exDate: '2026-03-01', perShare: .333, subsequentSplit: false },
    { exDate: '2025-06-01', perShare: .12345678, subsequentSplit: true }
  ] };
  const html = D.history(item, '2025');
  assert.match(html, /0\.12345678/);
  assert.match(html, /此后有拆分/);
  assert.doesNotMatch(html, /2026-03-01/);
  assert.match(D.history(item, '<script>'), /2026-03-01/);
});

test('broker comparison never promises uniform ETF eligibility or investor chosen withholding', () => {
  assert.equal(D.brokers.length, 3);
  const html = D.brokerComparison();
  assert.match(html, /不保证本页每只ETF都支持/);
  assert.match(html, /不能断言Trade25统一扣30%/);
  assert.match(html, /未确认美股ETF自动再投服务/);
  assert.doesNotMatch(html, /<input|<select/);
});

test('distribution tax reduces return in percentage points, not a percentage of all profit', () => {
  const row = { status: 'available', cashReturn: 5, totalReturn: 15 };
  const impact = D.taxImpact(row, 'ordinary-confirmed');
  assert.equal(impact.reduction, 1);
  assert.equal(impact.afterReturn, 14);
  assert.ok(Math.abs(impact.gainPercent - 100 / 15) < 1e-9);
  const loss = D.taxImpact({ ...row, totalReturn: -15 }, 'ordinary-confirmed');
  assert.equal(loss.afterReturn, -16);
  assert.equal(loss.gainPercent, null);
  const roc = D.taxImpact(row, 'roc');
  assert.equal(roc.reduction, null);
  assert.equal(roc.afterReturn, null);
  assert.equal(roc.sensitivity, .05);
});

test('index separates precise operating fee from trailing cash rate and its detail action', () => {
  const spy = products.find(p => p.symbol === 'SPY');
  const html = D.indexCell(spy, { products: { SPY: {
    through: '2026-10-20', frequency: '季度', metrics: { trailing: { rate: 2 } }
  } } });
  assert.equal((html.match(/<td /g) || []).length, 2);
  assert.match(html, /0\.0945%/);
  assert.match(html, /data-value="SPY"/);
  assert.match(html, /近12|过去12/);
  assert.doesNotMatch(html, /持续年费 \/ 分配|↗|undefined|NaN/);
  const missing = D.indexCell(spy, { products: { SPY: { metricsMissingEvidence: '缺普通收盘价记录' } } });
  assert.match(missing, /缺普通收盘价记录/);
  assert.doesNotMatch(missing, /<strong>0\.00%/);
  const boxx = products.find(p => p.symbol === 'BOXX');
  assert.match(D.indexCell(boxx, data), /0\.1949%/);
  assert.equal(D.taxCase('BOXX', data), 'classification-missing');
  assert.match(D.render(boxx, data), /有现金分配/);
  assert.match(D.history(data.products.BOXX, '2024'), /2024-08-13/);
});

test('published cash histories expose explicit ratios and preserve loss and ROC limitations', () => {
  for (const product of products) {
    const item = data.products[product.symbol];
    assert.ok(item.records.every(r => Number.isFinite(r.pricePercent) || r.referencePrice === null));
    const html = D.render(product, data);
    for (const label of ['近12月现金分配率', '最近单次分配率', '单次分配率', '除息前收盘价']) assert.ok(html.includes(label), label);
    if (item.metrics) {
      assert.ok(Number.isFinite(item.metrics.trailing.rate) || item.metrics.trailing.reason, product.symbol);
      assert.match(html, /历年分红与收益/);
      if (item.metrics.trailing.return.status === 'available') {
        assert.match(html, /现金占同期净收益/);
        assert.match(html, /领现金、不再投/);
      }
    } else {
      assert.ok(item.metricsMissingEvidence, product.symbol);
      assert.ok(html.includes(M.escapeHtml(item.metricsMissingEvidence)), product.symbol);
    }
    assert.doesNotMatch(html, /undefined|NaN|Infinity/);
  }
  const row = { status: 'available', start: '2025-12-31', end: '2026-06-30', year: 2026, yearToDate: true,
    priceReturn: -20, cashReturn: 5, totalReturn: -15, cashPerShare: 5, cashShareOfGain: null, shareReason: '亏损期' };
  const example = { metrics: { trailing: { return: row }, annual: [row] } };
  const loss = D.returnBreakdown(example, 'qii');
  assert.match(loss, /现金占同期净收益 不适用/);
  assert.match(loss, /亏损期/);
  const roc = D.returnBreakdown(example, 'roc');
  assert.match(roc, /敏感度/);
  assert.doesNotMatch(roc, /合计20%|仅扣分配税后回报/);
  assert.match(D.annualTable(example, 'ordinary-confirmed'), /2026年至今/);
  assert.match(D.annualTable(example, 'roc'), /待确认/);
});

test('reinvested comparison reconciles to published USD history at its own observed dates', () => {
  for (const product of products) {
    const item = data.products[product.symbol];
    const index = snapshot.BM.find(p => p.symbol === product.symbol);
    const asset = snapshot.PORTFOLIO_CATALOG.assets.find(p => p.id === 'us:' + product.symbol);
    const prices = new Map(JSON.parse(fs.readFileSync(asset.historyUrl)).series);
    reconcileReinvested(item, index, asset, prices, product.symbol);
    if (item.metrics?.reinvested?.status === 'available') assert.match(D.reinvestedComparison(item), /累计回报.*年化回报/);
  }
});

test('an advancing index cannot relabel or replace retained cash return dates', () => {
  const product = products.find(p => p.symbol === 'FDMO');
  const cash = { status: 'available', start: '2025-10-20', end: '2026-10-20',
    priceReturn: 15, cashReturn: 5, totalReturn: 20, cashShareOfGain: 25 };
  const annualized = M.annualized(22, M.yearsBetween(cash.start, cash.end));
  const asset = { sha256: 'a'.repeat(64) };
  const item = { status: 'stale', through: cash.end, frequency: '季度',
    missingEvidence: '缺 2026-10-20 之后的现金分配记录', priceReference: asset,
    records: [{ exDate: '2026-06-30', perShare: 5, pricePercent: 5, referencePrice: 100, referenceDate: '2026-06-29' }],
    metrics: { trailing: { rate: 5 / 115 * 100, cashPerShare: 5, price: 115, return: cash }, annual: [],
      reinvested: { status: 'available', start: cash.start, end: cash.end, cumulative: 22, annualized,
        differenceFromCash: 2, annualizationDifference: annualized - 22 } } };
  const index = { periods: [{ years: 1, start: '2025-10-22', end: '2026-10-22' }], usd: [30] };
  const prices = new Map([[cash.start, 100], [cash.end, 122], ['2026-10-22', 130]]);
  reconcileReinvested(item, index, asset, prices, 'FDMO');
  const html = D.render(product, { ...data, products: { ...data.products, FDMO: item } });
  assert.ok(html.includes(item.missingEvidence));
  assert.match(D.indexCell(product, { products: { FDMO: item } }), /旧记录/);
  const bad = structuredClone(item);
  bad.metrics.reinvested.cumulative += 1;
  assert.throws(() => reconcileReinvested(bad, index, asset, prices, 'FDMO'));
  item.status = 'recorded';
  assert.throws(() => reconcileReinvested(item, index, asset, prices, 'FDMO'));
  // A missing ordinary close can also choose an earlier opening date while
  // both sources have the same final date. Keep the displayed interval exact.
  const shifted = structuredClone(item);
  delete shifted.missingEvidence;
  shifted.through = '2026-10-22';
  shifted.metrics.trailing.return.end = shifted.through;
  const r = shifted.metrics.reinvested;
  r.end = shifted.through;
  r.cumulative = 24;
  r.annualized = M.annualized(24, M.yearsBetween(r.start, r.end));
  r.differenceFromCash = 4;
  r.annualizationDifference = r.annualized - 24;
  const updated = new Map([...prices, ['2025-10-22', 101], ['2026-10-22', 124]]);
  index.usd[0] = (124 / 101 - 1) * 100;
  reconcileReinvested(shifted, index, asset, updated, 'FDMO');
});

test('cash events survive unavailable prices without displaying invented returns', () => {
  const product = products.find(p => p.symbol === 'FDMO');
  const item = { status: 'stale', through: '2026-10-20', frequency: '季度',
    missingEvidence: '缺 2026-10-20 之后的现金分配记录',
    metricsMissingEvidence: '缺已收盘且与指数表一致的普通行情',
    records: [{ exDate: '2026-06-30', perShare: 5, pricePercent: null, referencePrice: null, referenceDate: null }] };
  reconcileReinvested(item, null, null, null, 'FDMO');
  const html = D.render(product, { ...data, products: { ...data.products, FDMO: item } });
  assert.ok(html.includes(item.metricsMissingEvidence));
  assert.match(html, /缺除息前收盘价/);
  assert.doesNotMatch(D.returnBreakdown(item, 'ordinary-confirmed'), /0\.00%|累计回报/);
  assert.doesNotMatch(html, /undefined|NaN|Infinity/);
});

test('QQQ correction uses its closed price and separates price error, reinvestment and annualization', () => {
  const item = data.products.QQQ, cash = item.metrics?.trailing.return, r = item.metrics?.reinvested;
  // Regression for the 2026-10-13 intraday $743.00 cache, which produced 23.93%.
  if (item.through === '2026-10-13' && cash && r) {
    assert.ok(Math.abs(cash.closingPrice - 743.57) < .0001);
    assert.equal(cash.totalReturn.toFixed(2), '24.03');
    assert.equal(r.cumulative.toFixed(2), '24.09');
    assert.equal(r.annualized.toFixed(2), '24.11');
  }
  if (cash?.status === 'available') assert.match(D.returnBreakdown(item, 'ordinary-confirmed'), /现金不再投 · 税前合计/);
  if (r?.status === 'available') assert.match(D.reinvestedComparison(item), /与指数表的美元回报口径一致/);
});
