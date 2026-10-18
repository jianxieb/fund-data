const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const M = require('../assets/potential-model.js');
const c = data.comparisons.find(x => x.id === 'GCT');
const a = c.audit;
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-8, `${x} != ${y}`);
const sum = values => values.reduce((x, y) => x + y, 0);

test('GCT reconciles GAAP income, cash, quarter recovery and the LTM cash basis', () => {
  const p = a.periods.find(x => x.label === '2026H1'), e = a.earnings, f = a.cash, h = a.history;
  near(p.revenue-p.cost-e.selling-e.admin-e.research-e.disposalLoss, e.operating);
  near(e.operating-e.interestExpense+e.interestIncome+e.fx+e.other, e.pretax);
  near(e.pretax-e.tax, p.net);
  near(p.net+sum(e.cashAdjustments), f.operating);
  near(f.assetDisposals-f.capex-f.acquisitionsNet-f.investmentPurchases+f.investmentSalesMaturities, f.investing);
  near(-f.financeLeaseRepaid-f.buybacks, f.financing);
  near(f.start+f.operating+f.investing+f.financing+f.fx, f.end);
  near(f.end, f.cashEquivalentEnd+f.restrictedEnd);
  near(h.q1OperatingCash+h.q2OperatingCash, f.operating);
  near(h.q2OperatingCash, 48.439);
  near(h.ltmOperatingCash, 190.660-48.042+26.704);
  near(h.ltmOperatingCash-h.ltmCapex, 157.637);
  assert.ok(h.q1OperatingCash<0 && h.q2OperatingCash>0);
  assert.match(f.basis, /受限现金/);
  assert.match(f.capexPrepaidDisplay, /未单列/);
});

test('GCT separates gross logistics revenue, commissions, organic growth and GMV', () => {
  const p = a.products;
  near(sum(p.h1Lines), 771.131);
  near(p.serviceRevenue+p.productRevenue, 771.131);
  near(p.serviceCost+p.productCost, 579.729);
  near(p.q2OrganicApprox, (411.643-16.3)/322.606-1);
  assert.equal(p.h1OrganicGrowthVerified, false);
  assert.ok(p.commission/p.serviceRevenue<.05);
  assert.match(p.gmv.period, /LTM/);
  assert.match(p.gmv.definition, /cancellations or returns/);
  const bull = a.scenarios.find(x => x.id === 'bull');
  near(sum(p.bullParts.map(x => x.revenue)), bull.revenue);
  near((sum(p.bullParts.map(x => x.revenue*x.grossMargin))/bull.revenue-p.bullNetExpenseRate)*(1-p.bullTaxRate), bull.margin);
  assert.equal(p.europeRegionMarginDisclosed, false);
});

test('GCT acquisition advance and marketplace obligations are reserved without double counting', () => {
  const x = a.acquisition, f = a.funding;
  near(x.cashPaidAtAcquisitionTable+x.cashPayableAtAcquisition+x.contingentFairValueAtAcquisition, x.purchasePrice);
  near(x.cashPaidAtAcquisitionTable+x.payablePaidQ2-x.advancePaid2025-x.acquiredCash, a.cash.acquisitionsNet);
  near(a.cash.acquisitionsNet, 14.284);
  assert.equal(x.newSharesIssued, 0);
  assert.equal(f.marketplaceReceiptsJune, null);
  near(f.marketplaceReceipts2025, 65.173);
  near(f.cashStart, f.openingCashEquivalent-f.postJuneRepurchaseCashIncludingFees-f.accruedLiabilitiesReserve-f.noncurrentFinanceLeaseReserve-f.potentialRepatriationTaxReserve+f.assumedH2FreeCash);
  near(f.cashStart, 221.675);
  assert.ok(f.accruedLiabilitiesReserve>f.marketplaceReceipts2025);
  assert.ok(f.investmentsExcluded>0 && f.restrictedExcluded>0);
  // Current finance lease obligations are inside the accrued reserve; only the non-current balance is added.
  near(f.noncurrentFinanceLeaseReserve, .774);
  for (const path of Object.values(f.paths)) near(sum(path.rows.map(r => r.earnout)), x.earnoutMaximum);
});

test('GCT counts actual net repurchases, award settlement and replacement authorization once', () => {
  const s = a.capital;
  near(s.startingOutstanding+s.issuedForAwardsH1-s.repurchasedH1, s.juneOutstanding);
  near(s.juneOutstanding-s.julyRepurchases, s.julyOutstanding);
  near(s.julyClassA+s.julyClassB, c.shares);
  near(c.shares, 35.710237);
  assert.equal(s.oldAuthorizationCancelled, true);
  assert.equal(s.newAuthorization, 120);
  assert.equal(s.latestFullShareLedgerVerified, false);
  assert.equal(c.shareDate, '2026-07-31');
  const base = a.funding.paths.base;
  near(sum(base.rows.map(r => r.buyback)), s.newAuthorization);
  assert.ok(base.rows.filter(r => r.year>=2030).every(r => r.buyback===0));
  near(base.shares, c.shares+s.juneUnvestedAwards+sum(base.rows.map(r => r.grants-r.buybackShares)));
});

test('GCT annual cash and share budgets include grants, cash buybacks and transaction costs', () => {
  const f = a.funding;
  for (const [id, path] of Object.entries(f.paths)) {
    let cash=f.cashStart, shares=c.shares+f.fixedExistingAwards, revenue=f.anchor2026Revenue;
    for (const r of path.rows) {
      near(r.net, r.revenue*r.margin);
      near(r.grants, Math.max(f.annualMinimumAwardShares,r.revenue*f.annualAwardRevenueRate/r.grantPrice));
      near(r.sbc, r.grants*r.grantPrice);
      near(r.workingCapital, Math.max(0,r.revenue-revenue)*f.workingCapitalOnGrowth);
      near(r.capex, r.revenue*f.capexRate);
      near(r.freeCash, r.net+r.sbc+r.depreciation-r.workingCapital-r.capex-r.newFinanceLeasePrincipal-r.earnout);
      near(r.buybackShares, r.buyback/r.grantPrice);
      near(r.buybackFees, r.buyback*.001);
      cash+=r.freeCash-r.buyback-r.buybackFees;
      shares+=r.grants-r.buybackShares;
      near(r.endingCash,cash); near(r.shares,shares);
      assert.ok(cash>=f.minimumCash);
      revenue=r.revenue;
    }
    const scenario=a.scenarios.find(x => x.id===id);
    near(scenario.shares,shares);
    near(M.project({price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}},scenario).priceMultiple,path.multiple);
    assert.equal(scenario.dividends,0);
  }
});

test('GCT funding stress raises cash in the deficit year and exposes conditional share authorization', () => {
  const f=a.funding, stress=f.stress;
  assert.equal(stress.buybacks,0);
  assert.equal(stress.financingConditional,true);
  assert.equal(stress.shareAuthorizationNotAssured,true);
  let previousShares=0;
  for (const scenario of stress.cases) {
    let cash=f.cashStart, shares=c.shares+f.fixedExistingAwards, priorRevenue=f.anchor2026Revenue;
    for (const r of scenario.rows) {
      near(r.net,r.revenue*r.margin);
      near(r.workingCapital,Math.max(0,r.revenue-priorRevenue)*stress.workingCapitalOnGrowth);
      near(r.capex,r.revenue*stress.capexRate);
      near(r.sbc,r.grants*scenario.issuePrice);
      near(r.freeCash,r.net+r.sbc+r.depreciation-r.workingCapital-r.capex-r.newFinanceLeasePrincipal-r.earnout-r.acquisition);
      cash+=r.freeCash;
      near(r.raiseNet,Math.max(0,stress.minimumCash-cash));
      near(r.issueShares,r.raiseNet/(1-stress.issueFeeRate)/scenario.issuePrice);
      cash+=r.raiseNet; shares+=r.grants+r.issueShares;
      near(r.endingCash,cash); near(r.shares,shares);
      assert.ok(cash>=stress.minimumCash-1e-8);
      priorRevenue=r.revenue;
    }
    near(sum(scenario.rows.map(r => r.raiseNet)),scenario.raiseNet);
    near(shares,scenario.shares);
    assert.ok(shares>previousShares);
    previousShares=shares;
  }
  assert.ok(stress.cases.at(-1).shares>a.capital.authorizedClassA+a.capital.authorizedClassB);
});

test('GCT quote, source links and generated report carry the new dossier and its evidence gaps', () => {
  const q=quotes.find(x => x.symbol==='GCT');
  near(c.price.value,Math.round(q.observations.at(-1).close*100)/100);
  assert.equal(q.observations.at(-1).date,c.price.asOf);
  const ids=new Set(data.sources.map(x => x.id));
  for (const id of [...c.sources,...a.sections.flatMap(x => x.sources)]) assert.ok(ids.has(id));
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync('data/potential-stocks.js','utf8'),context);
  assert.equal(JSON.stringify(context.window.POTENTIAL_RESEARCH.comparisons.find(x=>x.id==='GCT')),JSON.stringify(c));
  const report=fs.readFileSync('docs/research/potential-stocks-2026-10-18.md','utf8');
  for (const text of ['GigaCloud Technology','平台押金、代收款与租赁义务','低价压力的现金缺口按年度发生','H1完整并购收入桥','截至10月全部股本滚动缺口']) assert.ok(report.includes(text),text);
  assert.ok(report.includes(c.facts) && report.includes(c.judgment));
  assert.ok(report.includes('| 设备预付款 | 未单列（不另加现金支出） |'));
});
