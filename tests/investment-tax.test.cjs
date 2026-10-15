const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/model.js');
const Tax = require('../assets/investment-tax.js');
const close = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} != ${expected}`);

test('ordinary treaty dividend: 10% US plus 10% China, not 30% combined', () => {
  assert.deepEqual(M.ordinaryDividendTax(1000), {
    gross: 1000, usWithheld: 100, cnCredit: 100, cnTopUp: 100, firstCash: 900, afterTax: 800
  });
});

test('30% actual withholding cannot credit tax disallowed under the 10% treaty ceiling', () => {
  const r = M.ordinaryDividendTax(1000, 30);
  assert.equal(r.usWithheld, 300);
  assert.equal(r.cnCredit, 100);
  assert.equal(r.cnTopUp, 100);
  assert.equal(r.firstCash, 700);
  assert.equal(r.afterTax, 600); // Not 700; no hypothetical refund included.
  assert.equal(M.ordinaryDividendTax(1000, 30, 20, 0).afterTax, 500);
});

test('foreign credit is limited by actual tax and domestic liability and rejects invalid inputs', () => {
  assert.equal(M.ordinaryDividendTax(1000, 5).cnTopUp, 150);
  assert.equal(M.ordinaryDividendTax(1000, 10, 5).cnCredit, 50);
  assert.equal(M.ordinaryDividendTax(0).afterTax, 0);
  for (const args of [[-1], [NaN], [Infinity], [1, -1], [1, 101], [1, 10, -1], [1, 10, 20, NaN]]) {
    assert.equal(M.ordinaryDividendTax(...args), null);
  }
});

test('QQQI shows issuer-confirmed composition without inventing account withholding or Chinese tax', () => {
  const r = Tax.qqqiExample();
  close(r.gross, 641.28519);
  close(r.roc, 638.70371);
  close(r.other, 2.58148);
  assert.equal(r.usWithheld, null);
  assert.equal(r.cnTax, null);
  assert.equal(r.finalCash, null);
  const html = Tax.example('QQQI');
  assert.match(html, /99\.597452%/);
  assert.match(html, /所得分类及成本调整确认/);
  assert.doesNotMatch(html, /调账后现金|初次预扣|buy-tax-rate/);
});

test('QQQ, SPY and KO use distinct documented payments and reconcile treaty tax to 20%', () => {
  const proof = require('../docs/evidence/buy-location-tax/issuer-distributions-2025.json');
  for (const product of ['QQQ', 'SPY', 'KO']) {
    const record = Tax.records[product];
    const original = proof.documents[product].records.find(r => r.payableDate === record.payableDate);
    assert.ok(original, product + ' payment date is in the issuer document');
    assert.equal(record.distributionPerShare, original.perShare);
    assert.equal(record.ordinaryPerShare, original.ordinaryPerShare);
    const r = Tax.ordinaryExample(product);
    close(r.gross, Math.round(original.perShare * 1000 * 100) / 100);
    close(r.usWithheld + r.cnTopUp, Math.round(r.gross * 20) / 100);
    close(r.firstCash - r.cnTopUp, r.afterTax);
    const html = Tax.example(product);
    assert.match(html, new RegExp(record.payableDate));
    assert.match(html, /卖出持仓/);
    assert.match(html, /分红再投资 DRIP/);
    assert.match(html, /内地仍需另备/);
    assert.doesNotMatch(html, /buy-tax-rate/);
  }
  close(Tax.ordinaryExample('QQQ').gross, 693.95);
  close(Tax.ordinaryExample('SPY').gross, 1831.11);
  close(Tax.ordinaryExample('QQQ').firstCash, 624.55);
  close(Tax.ordinaryExample('QQQ').cnTopUp, 69.39);
  close(Tax.ordinaryExample('KO').afterTax, 408);
  assert.equal(Tax.ordinaryExample('QQQI'), null);
  assert.equal(Tax.ordinaryExample('invalid'), null);
  assert.equal(Tax.example('invalid'), '');
});

test('2025 ordinary ETF classification is supported by all four issuer rows, not extrapolated from QQQI', () => {
  const proof = require('../docs/evidence/buy-location-tax/issuer-distributions-2025.json');
  for (const ticker of ['QQQ', 'SPY']) {
    const doc = proof.documents[ticker];
    assert.equal(doc.records.length, 4);
    assert.match(doc.headerRow.Q13, /Ordinary Dividends/);
    assert.match(doc.headerRow.V13, /Total Capital Gain/);
    assert.match(doc.headerRow.Z13, /Nondividend/);
    for (const r of doc.records) {
      close(r.ordinaryPerShare, r.perShare);
      assert.equal(r.capitalGainPerShare, 0);
      assert.equal(r.rocPerShare, 0);
    }
  }
  assert.equal(proof.documents.SPY.records.at(-1).payableDate, '2026-01-30');
});

test('historical UI baseline cannot be overridden by arbitrary tax inputs and preserves real cost inputs', () => {
  const fees = { usCommission: .08, usMinimum: 2, fxSpread: .3, usDividendTax: 30,
    usDividendCreditCap: 0, cnDividendTax: 0, capitalGainsTax: 0 };
  const fixed = Tax.historyFees(fees);
  assert.equal(fixed.usCommission, .08);
  assert.equal(fixed.fxSpread, .3);
  assert.equal(fixed.usDividendTax, 10);
  assert.equal(fixed.usDividendCreditCap, 10);
  assert.equal(fixed.cnDividendTax, 20);
  assert.equal(fixed.capitalGainsTax, 20);
  assert.equal(fees.usDividendTax, 30); // Caller-owned object is untouched.
  for (const view of ['rules', 'products', 'channels']) {
    const html = Tax.render(view);
    assert.doesNotMatch(html, /buy-tax-rate|data-buy-input|<input/);
  }
});

test('tax content has separate accessible panels and comparison is the first/default navigation', () => {
  assert.equal(Tax.tabs[0][0], 'comparison');
  assert.match(Tax.navigation(), /id="buy-tab-comparison" role="tab" aria-selected="true"/);
  for (const [id] of Tax.tabs) {
    assert.match(Tax.navigation(id), new RegExp('id="buy-tab-' + id + '" role="tab" aria-selected="true"'));
    assert.match(Tax.panel(id, 'content'), new RegExp('role="tabpanel" aria-labelledby="buy-tab-' + id + '"'));
  }
  assert.equal(Tax.render('comparison'), '');
  assert.doesNotMatch(Tax.render('rules'), /tax-product-picker|tax-channel-table/);
  assert.doesNotMatch(Tax.render('channels'), /tax-product-picker|tax-rules-table/);
});

test('channel claims retain the actual evidence boundaries instead of assigning rates to broad categories', () => {
  const html = Tax.render('channels');
  assert.match(html, /2025-04-07公告明确按30%预扣/);
  assert.match(html, /2026-01-13提示实体及清算链限制/);
  assert.match(html, /正常普通股息税不会全部退/);
  assert.match(html, /未取得Trade25自动处理QQQI的ROC退款承诺/);
  assert.match(Tax.render('rules'), /中国内地目前未开征遗产税/);
  assert.match(Tax.render('rules'), /美国遗产税为什么也可能涉及内地居民/);
  assert.match(Tax.sources.china[1], /c5143076/);
});
