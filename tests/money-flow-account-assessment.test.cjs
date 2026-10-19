const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const Q = require('./fixtures/money-flow-quotes-20261011.json');
const evidence = require('./fixtures/money-flow-hsbc-one-assessment-20261011.json');
const { config } = require('../scripts/audit_money_flow.cjs');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const base = { ...config, date: '2026-10-11', startBank: 'cib', bank: 'hsbc', returnBank: 'hsbc', exitBank: 'boc',
  broker: 'za', route: 'USD', count: 1, months: 12, mainlandMethod: 'swift', outcome: 'broker-balance',
  hsbcBalanceWaiver: false, trade25: false };
const calculate = input => {
  const result = M.calculatorJourney(M.calculatorRoute({ ...base, ...input }), D, Q);
  const r = result.selected || result.partial;
  assert.ok(r, result.error);
  const items = r.rows.find(row => row.key === 'account').items;
  return { r, hsbc: items.filter(item => item.region === 'hong-kong' && item.bankId === 'hsbc'), items };
};

test('HSBC One initial assessment counts only remaining complete exempt months, independently of full-period qualification', () => {
  assert.equal(D.sources.hsbcOneBalance.url, evidence.source);
  const bank = D.hkBanks.find(bank => bank.id === 'hsbc');
  assert.equal(bank.introductoryAssessment.maximumMonths, evidence.initialAssessmentCompleteCalendarMonths);
  assert.equal(bank.monthlyHkd, evidence.monthlyBelowBalanceFeeHkd);
  for (const months of [0, 1, 3, 4, 12]) for (const hkHsbcFreeMonths of [0, 1, 2, 3]) for (const hsbcBalanceWaiver of [false, true]) {
    const { r, hsbc: [item] } = calculate({ months, hkHsbcFreeMonths, hsbcBalanceWaiver });
    const charged = hsbcBalanceWaiver ? 0 : Math.max(months - hkHsbcFreeMonths, 0);
    close(item.cny / r.refs.HKD, charged * 100);
    assert.equal(item.chargedMonths, charged);
    assert.equal(item.waivedMonths, months - charged);
    close(r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny, r.netCny);
  }
  for (const hkHsbcFreeMonths of [undefined, null, '', '  ']) {
    const { r, hsbc: [item] } = calculate({ hkHsbcFreeMonths });
    close(item.cny / r.refs.HKD, 1200);
  }
});

test('all receipt, stock settlement and return bank combinations count the HSBC assessment once at its actual bank', () => {
  const outcomes = ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland'];
  let checked = 0;
  for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers)
    for (const returnBank of D.calculator.hkBanks) for (const outcome of outcomes) {
      const input = { bank, broker, returnBank, outcome };
      const standard = calculate({ ...input, hkHsbcFreeMonths: 0 });
      const initial = calculate({ ...input, hkHsbcFreeMonths: 3 });
      const used = bank === 'hsbc' || broker === 'hsbc' || outcome !== 'broker-balance' && returnBank === 'hsbc';
      assert.equal(initial.hsbc.length, used ? 1 : 0, JSON.stringify(input));
      if (used) {
        close(initial.hsbc[0].cny / initial.r.refs.HKD, 900);
        close(standard.hsbc[0].cny / standard.r.refs.HKD, 1200);
      }
      assert.deepEqual(initial.items.filter(item => item.bankId !== 'hsbc'), standard.items.filter(item => item.bankId !== 'hsbc'));
      for (const row of initial.r.rows.filter(row => row.key !== 'account' && row.key !== 'extra'))
        close(row.cny ?? 0, standard.r.rows.find(before => before.key === row.key).cny ?? 0);
      if (!initial.r.error) close(initial.r.budgetCny + initial.r.profitUsd * initial.r.refs.USD - initial.r.costCny - initial.r.taxCny + initial.r.fxImpactCny, initial.r.netCny);
      checked++;
    }
  assert.equal(checked, D.calculator.hkBanks.length ** 2 * D.calculator.brokers.length * outcomes.length);
  const bridge = calculate({ bank: 'hang', broker: 'usmart', returnBank: 'hsbc', outcome: 'usd-balance', depositMethod: 'via-hsbc', hkHsbcFreeMonths: 3 });
  assert.equal(bridge.hsbc.length, 1);
  assert.equal(bridge.r.fundingBank.id, 'hsbc');
  close(bridge.hsbc[0].cny / bridge.r.refs.HKD, 900);
});

test('invalid initial assessment does not become a zero fee or affect an unused or fully exempt HSBC account', () => {
  for (const hkHsbcFreeMonths of [-1, .5, 4, 'bad']) {
    const { r, hsbc: [item] } = calculate({ hkHsbcFreeMonths });
    assert.equal(item.cny, null);
    assert.match(item.status, /剩余免收费月数须为0–3的整数/);
    assert.ok(r.missing.includes(item.status));
    assert.equal(r.complete, false);
    assert.equal(r.rankable, false);
    const free = calculate({ hkHsbcFreeMonths, hsbcBalanceWaiver: true });
    close(free.hsbc[0].cny, 0);
    assert.equal(free.hsbc[0].status, undefined);
    const unused = calculate({ bank: 'bochk', returnBank: 'hsbc', outcome: 'broker-balance', hkHsbcFreeMonths });
    assert.equal(unused.hsbc.length, 0);
    assert.equal(unused.r.rows.find(row => row.key === 'account').cny, 0);
  }
  const input = { ...base, hkHsbcFreeMonths: 3 };
  const plans = M.calculatorRecommendations(input, D, Q).plans;
  assert.ok(plans.length >= 2);
  for (const plan of plans) {
    const applied = M.applyRoute(input, plan.result, plan.id);
    assert.equal(applied.hkHsbcFreeMonths, 3);
    for (const key of ['broker', 'budgetCny', 'count', 'months', 'outcome']) assert.equal(applied[key], input[key]);
    const r = M.calculatorJourney(M.calculatorRoute(applied), D, Q).selected;
    close(r.costCny, plan.result.costCny);
    close(r.netCny, plan.result.netCny);
  }
});
