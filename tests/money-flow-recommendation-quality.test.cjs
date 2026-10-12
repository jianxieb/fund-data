const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const input = { ...config, date: '2026-10-11', count: 1, months: 12, broker: 'za', outcome: 'broker-balance',
  startBank: 'boc', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc', route: 'USD', mainlandMethod: 'boc-mobile',
  depositMethod: 'chats', hsbcBalanceWaiver: false, cnHangFeeWaived: false, bankBalancesHkd: {} };
const sources = plans => plans.map(plan => plan.config.startBank);
const period = result => result.rows.find(row => row.key === 'account').cny;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('preferred routes exclude avoidable bank period fees while retaining all accounts and actual settings', () => {
  const before = structuredClone(input), catalogue = structuredClone(D.calculator);
  const plans = M.calculatorRecommendations(input, D, Q).plans;
  assert.deepEqual(input, before); assert.deepEqual(D.calculator, catalogue);
  assert.deepEqual(sources(plans), ['boc', 'icbc', 'ccb']);
  assert.equal(new Set(sources(plans)).size, plans.length);
  for (const plan of plans) {
    assert.equal(plan.config.broker, 'za'); assert.equal(plan.result.budgetCny, 100000);
    close(period(plan.result), 0);
    const applied = M.calculatorJourney({ ...input, ...plan.config }, D, Q).selected;
    close(applied.costCny, plan.result.costCny);
  }
  for (const changes of [{ startBank: 'cib', bank: 'hsbc', mainlandMethod: 'swift' },
    { startBank: 'hang', bank: 'hang', route: 'CNH', mainlandMethod: 'linked', fxMode: 'bank' }]) {
    const result = M.calculatorJourney(M.calculatorRoute({ ...input, ...changes }), D, Q).selected;
    assert.ok(result?.complete); assert.ok(period(result) > 0);
  }
});

test('a confirmed One fee waiver restores the common CIB route without assuming a mainland fee waiver', () => {
  const qualified = { ...input, hsbcBalanceWaiver: true };
  const plans = M.calculatorRecommendations(qualified, D, Q).plans;
  assert.deepEqual(sources(plans), ['cib', 'boc', 'icbc', 'ccb']);
  close(period(plans[0].result), 0);
  assert.equal(plans[0].config.mainlandMethod, 'swift'); assert.equal(plans[0].config.bank, 'hsbc');
  assert.equal(qualified.cnHangFeeWaived, false);
  assert.deepEqual(sources(M.calculatorRecommendations(input, D, Q).plans), ['boc', 'icbc', 'ccb']);
});

test('confirmed mainland qualification and a zero holding period retain qualified routes without inventing waivers', () => {
  for (const [profile, requiredSources] of [[{ ...input, cnHangFeeWaived: true }, ['hang']], [{ ...input, months: 0 }, ['cib', 'hsbc']]]) {
    const plans = M.calculatorRecommendations(profile, D, Q).plans;
    for (const source of requiredSources) assert.ok(sources(plans).includes(source));
    for (const plan of plans) {
      close(period(plan.result), 0);
      const applied = M.calculatorJourney({ ...profile, ...plan.config }, D, Q).selected;
      close(applied.costCny, plan.result.costCny);
    }
  }
});

test('a recurring fee common to the selected stock account does not erase all upstream strategies', () => {
  const profile = { ...input, broker: 'hsbc', trade25: true };
  const plans = M.calculatorRecommendations(profile, D, Q).plans;
  assert.deepEqual(new Set(sources(plans)), new Set(['cib', 'boc', 'icbc', 'ccb']));
  assert.ok(plans.every(plan => plan.config.broker === 'hsbc' && period(plan.result) > 0));
  close(period(plans[0].result), period(plans[1].result));
  assert.equal(profile.hsbcBalanceWaiver, false);
});

test('a route with fewer accounts remains eligible even when its period and total cost are higher', () => {
  const synthetic = structuredClone(D);
  synthetic.calculator.mainland = ['boc', 'cib'];
  synthetic.mainlandBanks.find(bank => bank.id === 'cib').accountService = {
    monthlyCny: 100, waiverField: 'testOnlyCibWaiver', freeMonthsField: 'testOnlyCibFreeMonths', name: 'QA recurring fee'
  };
  const profile = { ...input, broker: 'hsbc', trade25: true };
  const plans = M.calculatorRecommendations(profile, synthetic, Q).plans;
  const cib = plans.find(plan => plan.config.startBank === 'cib'), boc = plans.find(plan => plan.config.startBank === 'boc');
  assert.ok(cib && boc); assert.equal(cib.config.bank, 'hsbc'); assert.equal(cib.result.broker.integratedBank, 'hsbc');
  assert.ok(period(cib.result) > period(boc.result)); assert.ok(cib.result.costCny > boc.result.costCny);
  assert.equal(D.mainlandBanks.find(bank => bank.id === 'cib').accountService, undefined);
});
