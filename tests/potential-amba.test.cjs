const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../assets/potential-model.js');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-stocks.json'), 'utf8'));
const company = data.comparisons.find(c => c.id === 'AMBA');
const a = company.audit;
const f = a.funding;
const near = (actual, expected, eps = 1e-7) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
const sum = xs => xs.reduce((x, y) => x + y, 0);

test('AMBA: GAAP income statements, quarterly cash and LTM use the same fiscal periods', () => {
  for (const p of a.periods) {
    near(p.revenue - p.cost - p.rd - p.sga, p.operating);
    near(p.operating + p.otherIncome - p.tax, p.net);
    near(p.operatingCash - p.capex - p.licenseFinancePayments, p.afterLicenseCash);
  }
  const [,,year, prior,q1,q2,h1,ltm] = a.periods;
  for (const key of ['revenue','cost','rd','sga','operating','otherIncome','tax','net','operatingCash','capex','licenseFinancePayments']) {
    near(year[key] - prior[key] + h1[key], ltm[key]);
    near(q1[key] + q2[key], h1[key]);
  }
  near(ltm.afterLicenseCash, 2.290);
  near(h1.afterLicenseCash, -42.489);
});

test('AMBA: customer termination is an R&D credit already removed from company non-GAAP', () => {
  near(a.termination.depositBefore - a.termination.cashRefund, a.termination.rdCredit);
  near(a.periods[5].operating - a.termination.rdCredit, -17.143);
  near(a.periods[6].operating - a.termination.rdCredit, -36.559);
  near(-24.782 + 44.593 + 2.426 - 9 + .029, 13.266);
  near(-6.689 + 22.700 + 1.213 - 9 + .009, 8.233);
  assert.equal(a.termination.companyNonGaapAlreadyExcludesCredit, true);
});

test('AMBA: cash bridge excludes double-counted securities and license obligations', () => {
  const c = a.cashDetails, l = a.liquidity;
  near(sum(a.operatingCashBridge), c.operating);
  near(c.start + c.operating + c.investing + c.financing + c.fx, c.end);
  near(-c.investmentPurchases + c.investmentSales + c.investmentMaturities - c.capex, c.investing);
  near(-c.repurchases + c.employeeEquityProceeds - c.intangibleFinancePayments, c.financing);
  near(c.end - c.restricted, l.cash);
  near(60.387 + 131.590 + 2.023, 170.482 + 23.518);
  near(l.cash + 60.387 - 23.518, l.cashPlusNonduplicatedWithinYearMaturities);
  near(101.850 + 170.482 * .95 - 9.1, f.initialLiquid);
  near(l.licensesCurrent + l.licensesNoncurrent, 19.452);
});

test('AMBA: independent unit-price pools reconstruct terminal sales and GAAP profit', () => {
  for (const key of ['bear','base','bull']) {
    const model = f.models[key], row = model.rows.at(-1);
    near(sum(f.terminalUnits[key].map(p => p.units * p.asp)) + f.nre[key], model.terminalRevenue);
    near(row.revenue * row.grossMargin - row.rd - row.sga, row.operating);
    near(row.operating - Math.max(2, row.operating * .2), model.terminalNet);
    assert.ok(row.sbc > 0, 'SBC remains in GAAP expenses and is added back only in cash');
    const scenario = a.scenarios.find(s => s.id === key);
    near(scenario.revenue * scenario.margin, model.terminalNet);
    const result = M.project({price:company.price, shares:{value:company.shares},financials:{anchorRevenue:company.anchorRevenue}}, scenario);
    near(result.price, model.terminalPrice);
  }
});

test('AMBA: award grants, vesting, ending unvested shares and financing reconcile without adding authorization twice', () => {
  near(2.621997 + 1.084210 - .736997 - .105365, a.capital.unvestedRsuJuly31);
  for (const model of Object.values(f.models)) {
    const l = model.capitalLedger;
    near(sum([l.openingIssued,l.existingRsu,l.existingOptions,l.performanceUplift,l.newAwardsGranted,l.esppShares,l.financingShares]), model.terminalShares);
    near(model.terminalIssuedShares + model.terminalUnvestedShares, model.terminalShares);
    near(l.newAwardsGranted - l.newAwardsVested, model.terminalUnvestedShares);
    for (const r of model.rows) {
      near(r.startIssuedShares + r.oldVesting + r.newVesting + r.uplift + r.option + r.espp + r.financingShares, r.endIssuedShares);
      near(r.espp * r.esppPurchasePrice + r.option * 58.23, r.employeeEquityCash);
    }
  }
  near(a.capital.planIncreaseApprovedJune26, 2.75);
  near(a.capital.performanceAwardFY26MaximumTimesTarget, 2.5);
  assert.equal(a.capital.fullOctoberLedgerVerified, false);
});

test('AMBA: future grants follow dollar budgets and their expense cannot disappear from GAAP', () => {
  for (const model of Object.values(f.models)) {
    near(sum(model.rows.map(r => r.oldAwardExpense)), 174.1);
    for (const r of model.rows.filter(r => r.year > 2026)) {
      near(r.grantBudget / r.grantPrice, r.grant);
      near(r.esppPurchasePrice, r.grantPrice * .85);
      const compensation = r.oldAwardExpense + r.newAwardExpense + r.performanceExpense + r.esppExpense;
      assert.ok(r.sbc >= compensation - 1e-7);
      const i = r.year - 2027, p = model.parameters;
      near(r.rd - p.rd[i], r.sbcExtra * .62);
      near(r.sga - p.sga[i], r.sbcExtra * .34);
      near((p.gm[i] - r.gm) * r.revenue, r.sbcExtra * .04);
    }
  }
});

test('AMBA: annual cash funds shortfalls when they occur and retains financing dilution', () => {
  for (const model of Object.values(f.models)) {
    let liquid = model.initialLiquid;
    for (const r of model.rows) {
      near(r.startLiquid, liquid);
      near(r.net + r.sbc + r.da - r.workingCapitalIncrease, r.operatingCash);
      near(r.operatingCash - r.cashCapex - r.license, r.cashAfterCapexAndLicense);
      near(liquid + r.cashAfterCapexAndLicense + r.employeeEquityCash, r.preFinancingLiquid);
      near(Math.max(0, model.cashFloor - r.preFinancingLiquid), r.netEquityRaised);
      near(r.grossEquityRaised * (1 - model.feeRate), r.netEquityRaised);
      near(r.grossEquityRaised / r.financingPrice, r.financingShares);
      near(r.preFinancingLiquid + r.netEquityRaised, r.endLiquid);
      assert.ok(r.endLiquid >= model.cashFloor - 1e-7);
      liquid = r.endLiquid;
    }
    near(sum(model.rows.map(r => r.netEquityRaised)), model.totalNetRaised);
    near(sum(model.rows.map(r => r.financingShares)), model.totalFinancingShares);
  }
  near(f.models.base.totalNetRaised, 0);
  assert.ok(f.models.bear.totalNetRaised > 58);
  assert.deepEqual(f.models.stress.rows.filter(r => r.netEquityRaised > 0).map(r => r.year), [2027,2028]);
  assert.ok(f.models.stress.terminalShares > f.models.bull.terminalShares);
  assert.ok(f.models.stress.priceMultiple < f.models.bull.priceMultiple);
});

test('AMBA: tenfold reverse calculation is conditional on fixed costs and diluted shares', () => {
  const h = f.hurdle;
  near(h.requiredRevenue * h.grossMargin - h.fixedRd - h.fixedSga, h.requiredNet / (1-h.tax));
  near(h.requiredNet * h.pe / h.terminalShares, company.price.value * 10);
  near(h.requiredEdgeUnits * 130 + 936 + 650 + 40, h.requiredRevenue);
  assert.ok(h.requiredRevenue > f.models.bull.terminalRevenue);
  assert.equal(h.assumesNoExtraFixedCostOrDilution, true);
  assert.equal(a.fullFundingModelVerified, false);
});

test('AMBA: source dates, raw quotes and research retain unresolved commercial evidence', () => {
  const sources = new Map(data.sources.map(s => [s.id,s]));
  for (const id of company.sources) assert.ok(sources.get(id)?.url);
  assert.equal(company.shareDate, '2026-08-31');
  assert.equal(company.price.asOf, '2026-10-16');
  const quotes = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-quotes.json'),'utf8')).find(q => q.symbol === 'AMBA');
  near(Math.round(quotes.observations.at(-1).close*100)/100, company.price.value);
  assert.equal(a.business.hanwhaGuaranteedMinimumVerified, false);
  assert.equal(a.business.macnicaNonexclusive, true);
  assert.deepEqual(a.business.indirectChannelMeaningfulRevenueExpectedYears, [2,3]);
  const report = fs.readFileSync(path.join(root,'docs/research/potential-stocks-2026-10-18.md'),'utf8').split('### 安霸（Ambarella） · AMBA')[1]?.split('\n## ')[0];
  assert.ok(report?.includes('最低采购量'));
  assert.ok(report.includes('不是实际三季报'));
  assert.ok(report.includes('2.292'));
  assert.ok(report.includes('不把资金模型标记为全部验证'));
});
