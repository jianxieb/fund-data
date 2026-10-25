const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261025.json');
const plans = M.calculatorPreferredPlans(D, Q, '2026-10-25');
const base = plans[0].config;
const run = (changes = {}, quotes = Q) => M.calculatorJourney({ ...base, ...changes }, D, quotes).selected;
const row = (r, key) => r.rows.find(x => x.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const conserved = r => close(r.netCny, r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny);

test('public IBKR ask funds USD, bid returns CNH, and RMB purchases use face amount', () => {
  const r = run();
  assert.equal(r.complete, true); assert.deepEqual(r.missing, []);
  assert.equal(r.indicativeFx, ''); assert.equal(r.indicativeBrokerExit, false);
  close(r.entryPrice, 6.67006);
  close(r.steps.fundedUsd, r.steps.brokerOriginal / 6.67006 - 2);
  close(r.steps.brokerCnh, (r.steps.afterTaxUsd - 2) * 6.66889);
  close(r.net, r.steps.returnCnh); close(r.netCny, r.net);
  assert.equal(r.currency, 'CNY');
  close(r.costCny, r.budgetCny - r.net);
  // A closed RMB -> USD -> RMB loop has a spread and commissions; the
  // CNH valuation benchmark must not manufacture a mainland spending gain.
  assert.ok(r.costCny > 0);
  for (const key of ['brokerSpread', 'brokerExitFx']) {
    assert.match(row(r, key).estimate, /公开买卖盘/);
    assert.equal(row(r, key).quote.quoteStatus, 'frozen');
    assert.equal(row(r, key).quote.timeBasis, 'snapshot');
    assert.ok(row(r, key).sources.includes('ibFxQuotes'));
  }
  conserved(r);
  for (const leg of M.flowLedger(r).legs) {
    assert.ok(Number.isFinite(leg.inputCny) && Number.isFinite(leg.outputCny));
    close(leg.inputCny + leg.profitCny + leg.fxImpactCny, leg.outputCny + leg.costCny + leg.taxCny);
  }
});

test('public prices fill first and fifth plans without filling HSBC direct rates or wire deductions', () => {
  assert.equal(plans[0].calculated.selected.complete, true);
  assert.equal(plans[4].calculated.selected.complete, true);
  for (const plan of plans.slice(1, 3)) {
    assert.ok(plan.calculated.selected.missing.some(x => /汇丰.*USD\/CNH直接报价/.test(x)));
    assert.equal(row(plan.calculated.selected, 'exitFx').cny, null);
    assert.equal(row(plan.calculated.selected, 'cardFx'), undefined);
  }
  assert.deepEqual(plans[3].calculated.selected.missing, ['券商出金中转行费', '回内地中转行费']);
  for (const plan of plans) conserved(plan.calculated.selected);
});

test('actual IBKR execution prices override public rates and AutoFX adds markup only once', () => {
  const actual = run({ entryPrice: 6.71, brokerExitPrice: 6.69 });
  close(actual.steps.fundedUsd, actual.steps.brokerOriginal / 6.71 - 2);
  close(actual.steps.brokerCnh, (actual.steps.afterTaxUsd - 2) * 6.69);
  assert.equal(row(actual, 'brokerSpread').quote, undefined);
  assert.equal(row(actual, 'brokerExitFx').quote, undefined);
  const auto = run({ fxMode: 'auto' });
  close(auto.steps.fundedUsd, auto.steps.brokerOriginal / 6.67006 / 1.0003);
  assert.equal(row(auto, 'brokerFx').step, 'investment');
  const autoActual = run({ fxMode: 'auto', entryPrice: 6.72 });
  close(autoActual.steps.fundedUsd, autoActual.steps.brokerOriginal / 6.72);
  close(row(autoActual, 'brokerFx').cny, 0);
  for (const r of [actual, auto, autoActual]) conserved(r);
});

test('absent and stale broker quotes remain explicit and never borrow a bank quote', () => {
  const absent = structuredClone(Q); delete absent.brokerUsd;
  const r = run({}, absent);
  assert.equal(row(r, 'brokerSpread').cny, null);
  assert.equal(row(r, 'brokerExitFx').cny, null);
  assert.equal(r.complete, false); assert.equal(r.indicativeBrokerExit, true);
  const stale = structuredClone(Q);
  stale.brokerUsd.ibkr.quotes.CNH.asOf = '2026-10-20 21:36:33.432';
  const old = run({}, stale);
  assert.equal(old.complete, false); assert.equal(old.quoteFreshness.entryMarket, false);
  assert.equal(old.quoteFreshness.exit, false);
  assert.ok(old.missing.some(x => /IBKR USD\/CNH.*超过3天/.test(x)));
  assert.equal(run({ entryPrice: 6.71, brokerExitPrice: 6.69 }, stale).complete, true);
});
