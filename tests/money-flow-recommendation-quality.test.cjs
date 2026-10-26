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
  assert.deepEqual(sources(plans), ['boc', 'icbc']);
  assert.equal(new Set(plans.map(plan => plan.id)).size, plans.length);
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
  assert.deepEqual(sources(plans), ['cib', 'boc', 'icbc']);
  close(period(plans[0].result), 0);
  assert.equal(plans[0].config.mainlandMethod, 'swift'); assert.equal(plans[0].config.bank, 'hsbc');
  assert.equal(qualified.cnHangFeeWaived, false);
  assert.deepEqual(sources(M.calculatorRecommendations(input, D, Q).plans), ['boc', 'icbc']);
});

test('a qualified but dominated Hang Seng route remains selectable without padding recommendations, while zero months retain useful routes', () => {
  const qualified = { ...input, cnHangFeeWaived: true };
  const hang = M.calculatorJourney(M.calculatorRoute({ ...qualified, startBank: 'hang', bank: 'hang',
    route: 'CNH', fxMode: 'bank', mainlandMethod: 'linked', depositMethod: '' }), D, Q).selected;
  assert.ok(hang?.complete); close(period(hang), 0);
  assert.ok(!sources(M.calculatorRecommendations(qualified, D, Q).plans).includes('hang'));
  for (const [profile, requiredSources] of [[qualified, ['boc', 'icbc']], [{ ...input, months: 0 }, ['cib', 'icbc']]]) {
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
  assert.deepEqual(new Set(sources(plans)), new Set(['cib', 'boc', 'icbc']));
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

test('mainland-return comparisons only include the scoped, sourced USD estimate or capped HKD record', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const qualified = { ...input, date:'2026-10-12', outcome:'mainland', hsbcBalanceWaiver:true,
    cnHsbcFeeWaived:true, cnHangFeeWaived:true, cnScFeeWaived:true };
  const usdPlans=M.calculatorRecommendations(qualified,D,quotes).plans;
  assert.ok(usdPlans.length>0);
  assert.ok(usdPlans.every(p=>p.config.returnBank==='bochk'&&p.config.exitBank==='boc'&&p.config.returnMethod==='bochk-fast'));
  assert.ok(usdPlans.every(p=>p.result.rows.find(row=>row.key==='returnOther').estimate));
  const small={...qualified,budgetCny:5000,returnCurrency:'HKD'};
  const plans=M.calculatorRecommendations(small,D,quotes).plans;
  assert.ok(plans.length>0);
  assert.equal(plans[0].config.startBank,'cib');
  assert.equal(plans[0].config.returnBank,'bochk'); assert.equal(plans[0].config.exitBank,'boc');
  close(plans[0].result.costCny,60.3371676643);
  assert.ok(plans.every(plan=>D.calculator.departureBanks.includes(plan.config.startBank)&&D.calculator.receivingBanks.includes(plan.config.exitBank)));
  assert.ok(plans.every(plan=>period(plan.result)===0&&plan.result.complete));
  const unqualified=M.calculatorRecommendations({...small,hsbcBalanceWaiver:false},D,quotes).plans;
  assert.ok(unqualified.length>0); assert.equal(unqualified[0].config.startBank,'boc');
  assert.ok(unqualified.every(plan=>period(plan.result)===0));
  const retired=M.calculatorJourney(M.calculatorRoute({...qualified,exitBank:'hang'}),D,quotes);
  assert.match(retired.error,/目录中的内地收款银行/);
});

test('recommendations retain named tradeoffs rather than padding a bank quota, and a dominated extra bank adds no plan', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const qualified = { ...input, date: '2026-10-12', hsbcBalanceWaiver: true,
    cnHsbcFeeWaived: true, cnHangFeeWaived: true, cnScFeeWaived: true };
  const plans = M.calculatorRecommendations(qualified, D, quotes).plans;
  assert.ok(plans.find(plan => plan.config.startBank === 'cib').benefits.includes('当前最低损耗'));
  assert.ok(plans.find(plan => plan.config.startBank === 'boc').benefits.includes('普通出发账户'));
  assert.ok(plans.find(plan => plan.config.startBank === 'icbc').benefits.includes('银行费按官方价'));
  assert.ok(plans.find(plan => plan.config.startBank === 'icbc').benefits.includes('少用香港账户'));
  const synthetic = structuredClone(D), poorer = structuredClone(quotes);
  const extra = { ...synthetic.mainlandBanks.find(bank => bank.id === 'ccb'), id: 'qa-worse-ccb', name: 'QA dearer full-amount bank' };
  synthetic.mainlandBanks.push(extra); synthetic.calculator.mainland.push(extra.id);
  poorer.banks[extra.id] = structuredClone(poorer.banks.ccb);
  for (const price of Object.values(poorer.banks[extra.id].quotes)) if (Number.isFinite(price.sell)) price.sell *= 1.01;
  const revised = M.calculatorRecommendations(qualified, synthetic, poorer).plans;
  assert.deepEqual(sources(revised), sources(plans));
  const selected = M.calculatorJourney(M.calculatorRoute({ ...qualified, startBank: extra.id,
    bank: 'za', mainlandMethod: 'full', depositMethod: 'internal' }), synthetic, poorer).selected;
  assert.ok(selected?.complete); assert.ok(selected.costCny > plans.find(plan => plan.config.startBank === 'icbc').result.costCny);
});

test('a sender cheapest mobile route cannot discard its more certain full-amount alternative before comparison', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const profile = { ...input, date: '2026-10-12', hsbcBalanceWaiver: true,
    cnHsbcFeeWaived: true, cnHangFeeWaived: true, cnScFeeWaived: true };
  const manual = changes => M.calculatorJourney(M.calculatorRoute({ ...profile, ...changes }), D, quotes).selected;
  const mobile = manual({ startBank: 'icbc', bank: 'icbc-asia', mainlandMethod: 'icbc-mobile', depositMethod: 'chats' });
  const full = manual({ startBank: 'icbc', bank: 'za', mainlandMethod: 'full', depositMethod: 'internal' });
  const oldOfficial = manual({ startBank: 'hsbc', bank: 'hsbc', mainlandMethod: 'linked', depositMethod: 'chats' });
  assert.ok(mobile.complete && full.complete && oldOfficial.complete);
  assert.ok(mobile.costCny < full.costCny); assert.ok(full.costCny < oldOfficial.costCny);
  assert.ok(mobile.rows.some(row => row.estimate)); assert.ok(!full.rows.some(row => row.estimate));
  const plans = M.calculatorRecommendations(profile, D, quotes).plans;
  const chosen = plans.find(plan => plan.config.startBank === 'icbc');
  assert.ok(chosen); assert.equal(chosen.config.bank, 'za'); assert.equal(chosen.config.mainlandMethod, 'full');
  close(chosen.result.costCny, full.costCny); assert.equal(Math.round(full.costCny * 100) / 100, 614.90);
  assert.ok(chosen.benefits.includes('少用香港账户')); assert.ok(chosen.benefits.includes('银行费按官方价'));
  assert.ok(!sources(plans).includes('hsbc') && !sources(plans).includes('ccb'));
});

test('one sender can retain two genuinely different routes without a bank-name or recommendation-count quota', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json'), data = structuredClone(D);
  data.calculator.mainland = ['icbc'];
  const profile = { ...input, date: '2026-10-12', hsbcBalanceWaiver: true };
  const plans = M.calculatorRecommendations(profile, data, quotes).plans;
  assert.equal(plans.length, 2); assert.ok(plans.every(plan => plan.config.startBank === 'icbc'));
  assert.equal(plans[0].config.mainlandMethod, 'icbc-mobile'); assert.equal(plans[1].config.mainlandMethod, 'full');
  assert.ok(plans[0].result.costCny < plans[1].result.costCny);
  assert.ok(plans[1].benefits.includes('少用香港账户') && plans[1].benefits.includes('银行费按官方价'));
  for (const plan of plans) {
    const applied = M.calculatorJourney({ ...profile, ...plan.config }, data, quotes).selected;
    close(applied.costCny, plan.result.costCny); close(applied.net, plan.result.net);
  }
});

test('fewer estimated fees must not label an IBKR route as having only official bank fees', () => {
  const quotes = require('./fixtures/money-flow-quotes-20261012.json');
  const profile = { ...input, date: '2026-10-12', broker: 'ibkr', hsbcBalanceWaiver: true,
    cnHsbcFeeWaived: true, cnHangFeeWaived: true, cnScFeeWaived: true };
  const plans = M.calculatorRecommendations(profile, D, quotes).plans;
  const full = plans.find(plan => plan.config.startBank === 'icbc' && plan.config.mainlandMethod === 'full');
  assert.ok(full);
  assert.ok(full.result.rows.some(row => row.key === 'depositOther' && row.estimate));
  assert.ok(plans.some(plan => plan.result.costCny < full.result.costCny &&
    plan.result.rows.filter(row => row.estimate).length > full.result.rows.filter(row => row.estimate).length));
  assert.ok(full.benefits.includes('参考费项更少'));
  assert.ok(!full.benefits.includes('银行费按官方价'));
  for (const plan of plans.filter(plan => plan.benefits.includes('银行费按官方价'))) {
    assert.ok(!plan.result.rows.some(row => row.estimate));
  }
});
