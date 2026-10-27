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
  close(r.costCny - r.fxImpactCny, r.budgetCny - r.net);
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

test('saved quotes and explicitly authorized estimates price every remaining preferred route', () => {
  for (const plan of plans) {
    assert.equal(plan.calculated.selected.complete, true);
    assert.deepEqual(plan.calculated.selected.missing, []);
  }
  for (const plan of plans.filter(plan => plan.config.broker === 'hsbc')) {
    const r = plan.calculated.selected;
    assert.equal(r.estimatedExitFx, true);
    assert.match(row(r, 'exitFx').estimate, /汇丰本行/);
    assert.equal(row(r, 'exitFx').quoteBasis, 'bank-cross-estimate');
    assert.equal(row(r, 'exitFx').exchanges.length, 1);
    assert.equal(r.exitAsOf, Q.offshoreUsd.hsbc.quotes.CNH.asOf);
    close(r.exitPrice, Q.offshoreUsd.hsbc.quotes.CNH.bidPerUsd);
    close(row(r, 'cardFx').cny, 0);
  }
  for (const key of ['withdrawMiddle', 'returnOther']) assert.ok(row(plans.find(plan => plan.id === 'boc-ibkr').calculated.selected, key).estimate);
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

test('10万 and 25万 Lite FPS funding retain cash and never present valuation gains as negative fees', () => {
  for (const budgetCny of [100000, 250000]) {
    const r = run({ budgetCny, broker: 'ibkr-lite', outcome: 'broker-balance' });
    close(r.steps.hongKong, budgetCny); close(r.steps.brokerOriginal, budgetCny);
    close(r.steps.fundedUsd, budgetCny / 6.67006 - 2);
    close(row(r, 'brokerFx').cny, 13.3492);
    close(row(r, 'brokerSpread').cny, (budgetCny / ((6.67006 + 6.66889) / 2) - budgetCny / 6.67006) * r.refs.USD);
    assert.ok(r.rows.every(x => x.cny >= 0));
    assert.ok(r.fxImpactCny > 0, 'The signed valuation effect is preserved outside costs');
    conserved(r);
    for (const leg of M.flowLedger(r).legs) {
      assert.ok(leg.costCny >= 0);
      close(leg.inputCny + leg.profitCny + leg.fxImpactCny, leg.outputCny + leg.costCny + leg.taxCny);
    }
    const betterExecution = run({ budgetCny, broker: 'ibkr-lite', outcome: 'broker-balance', entryPrice: 6.6 });
    close(row(betterExecution, 'brokerSpread').cny, 0);
    close(row(betterExecution, 'brokerFx').cny, 13.3492);
    close(betterExecution.steps.fundedUsd, budgetCny / 6.6 - 2);
    conserved(betterExecution);
  }
});

test('HSBC estimate preserves saved legs and timestamps, is scoped to HSBC, and yields to actual prices', () => {
  const original = JSON.stringify(Q), config = plans[1].config;
  const calculate = (changes = {}, quotes = Q, data = D) => M.calculatorJourney({ ...config, ...changes }, data, quotes).selected;
  const actual = calculate({ exitPrice: 6.7 });
  assert.equal(actual.estimatedExitFx, false); assert.equal(row(actual, 'exitFx').estimate, undefined);
  close(actual.net, actual.steps.returnUsd * 6.7);
  assert.equal(row(actual, 'exitFx').exchanges.length, 1); conserved(actual);
  const unapproved = structuredClone(D); delete unapproved.referenceEstimates;
  assert.equal(row(calculate({}, Q, unapproved), 'exitFx').cny, null);
  const absent = structuredClone(Q); delete absent.offshoreUsd.hsbc;
  assert.equal(row(calculate({}, absent), 'exitFx').cny, null);
  const other = structuredClone(Q); other.offshoreUsd.hang = structuredClone(Q.offshoreUsd.hsbc);
  assert.equal(row(calculate({ returnBank: 'hang' }, other), 'exitFx').cny, null);
  const stale = structuredClone(Q); stale.offshoreUsd.hsbc.quotes.CNH.asOf = '2026-10-01';
  assert.equal(calculate({}, stale).complete, false);
  assert.equal(calculate({ exitPrice: 6.7 }, stale).complete, true);
  const cash = calculate({ outcome: 'atm', atmProfile: 'hsbc-group', atmAmountCny: 1000, atmTransactions: 1 });
  assert.equal(row(cash, 'exitFx').quoteBasis, 'bank-cross-estimate'); conserved(cash);
  assert.equal(JSON.stringify(Q), original);
});

test('wire estimates avoid double counting receiving fees and actual receipts override each component', () => {
  const config = plans.find(plan => plan.id === 'boc-ibkr').config;
  const calculate = changes => M.calculatorJourney({ ...config, ...changes }, D, Q).selected;
  const r = calculate({});
  close(row(r, 'returnInward').cny, 60 * r.refs.HKD);
  close(row(r, 'withdrawMiddle').cny + row(r, 'returnInward').cny, 20 * r.refs.USD);
  assert.deepEqual(row(r, 'withdrawMiddle').combinedRangeUsd, [10, 30]);
  assert.match(row(r, 'returnOther').estimate, /无额外报文/);
  const actual = calculate({ intermediaryCny: 7, returnExtraCny: 8, inwardHkd: 9 });
  close(row(actual, 'withdrawMiddle').cny, 7); close(row(actual, 'returnOther').cny, 8);
  close(row(actual, 'returnInward').cny, 9 * actual.refs.HKD);
  assert.equal(row(actual, 'withdrawMiddle').estimate, undefined);
  assert.equal(row(actual, 'returnOther').estimate, undefined); conserved(actual);
  const bankActual = calculate({ inwardHkd: 99 });
  close(row(bankActual, 'withdrawMiddle').cny, row(r, 'withdrawMiddle').cny);
  const swift = calculate({ returnMethod: 'swift' });
  assert.equal(row(swift, 'returnOther').cny, null);
  const other = calculate({ returnBank: 'hang', returnMethod: 'swift' });
  assert.equal(row(other, 'withdrawMiddle').cny, null);
  for (const [budgetCny, expectedUsd] of [[5000, 0], [100000, 10]]) {
    const hsbc = calculate({ budgetCny, returnBank: 'hsbc', outcome: 'usd-balance' });
    close(row(hsbc, 'withdrawMiddle').cny, expectedUsd * hsbc.refs.USD);
    assert.ok(row(hsbc, 'withdrawMiddle').estimate); conserved(hsbc);
  }
});
