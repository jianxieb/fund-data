const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../assets/etf-distributions.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('data/etf-distributions.js', 'utf8'), context);
const data = context.window.ETF_DISTRIBUTIONS;
const products = JSON.parse(fs.readFileSync('data/overseas-etf-catalog.json')).products;

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
  const html = D.indexCell(spy, data);
  assert.equal((html.match(/<td /g) || []).length, 2);
  assert.match(html, /0\.0945%/);
  assert.match(html, /data-value="SPY"/);
  assert.match(html, /近12|过去12/);
  assert.doesNotMatch(html, /持续年费 \/ 分配|↗|undefined|NaN/);
  const missing = D.indexCell(spy, { products: { SPY: { metricsMissingEvidence: '缺普通收盘价记录' } } });
  assert.match(missing, /缺普通收盘价记录/);
  assert.doesNotMatch(missing, /<strong>0\.00%/);
});

test('published cash histories expose explicit ratios and preserve loss and ROC limitations', () => {
  for (const product of products) {
    const item = data.products[product.symbol];
    assert.ok(Number.isFinite(item.metrics.trailing.rate), product.symbol);
    assert.ok(item.records.every(r => Number.isFinite(r.pricePercent) || r.referencePrice === null));
    const html = D.render(product, data);
    for (const label of ['近12月现金分配率', '最近单次分配率', '历年分红与收益', '现金占同期净收益', '单次分配率', '除息前收盘价']) assert.ok(html.includes(label), label);
    assert.match(html, /领现金、不再投/);
    assert.doesNotMatch(html, /undefined|NaN|Infinity/);
  }
  const loss = D.returnBreakdown(data.products.TLT, 'qii');
  assert.match(loss, /现金占同期净收益 不适用/);
  assert.match(loss, /亏损期/);
  const roc = D.returnBreakdown(data.products.QQQI, 'roc');
  assert.match(roc, /敏感度/);
  assert.doesNotMatch(roc, /合计20%|仅扣分配税后回报/);
  assert.match(D.annualTable(data.products.QQQ, 'ordinary-confirmed'), /2026年至今/);
  assert.match(D.annualTable(data.products.QQQI, 'roc'), /待确认/);
});
