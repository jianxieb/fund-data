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

test('QQQI cash example preserves final 8937 precision without inventing Chinese or final US tax', () => {
  const r = Tax.qqqiExample(10);
  close(r.gross, 641.28519);
  close(r.roc, 638.70371);
  close(r.other, 2.58148);
  close(r.initialWithholding, 64.128519);
  close(r.firstCash, 577.156671);
  close(r.rocAdjustment, 63.870371);
  close(r.remainingWithholding, 0.258148);
  close(r.cashAfterRocAdjustment, 641.027042);
  assert.equal(r.cnTax, null);
  assert.equal(r.finalCash, null);
  const high = Tax.qqqiExample(30);
  close(high.rocAdjustment, 191.611113);
  close(high.firstCash + high.rocAdjustment, high.cashAfterRocAdjustment);
  assert.equal(Tax.qqqiExample(20), null);
});

test('examples identify historical ROC and scenario assumptions for all requested products', () => {
  for (const product of ['QQQ', 'SPY', 'KO']) {
    const text = Tax.example(product, 30);
    assert.match(text, /普通现金股息/);
    assert.match(text, /\$600\.00/);
    assert.match(text, /若美国端最终退回\$200/);
  }
  const qqqi = Tax.example('QQQI', 10);
  assert.match(qqqi, /2025-12-26/);
  assert.match(qqqi, /99\.597452%/);
  assert.match(qqqi, /境内税后金额：待确认/);
  assert.match(qqqi, /假设托管方完成重分类/);
  assert.equal(Tax.example('not-a-product', 30), '');
});
