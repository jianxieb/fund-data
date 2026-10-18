const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../assets/potential-model.js');
const data = JSON.parse(fs.readFileSync('data/potential-stocks.json', 'utf8'));
const quotes = JSON.parse(fs.readFileSync('data/potential-quotes.json', 'utf8'));
const c = data.comparisons.find(x => x.id === 'AOSL');
const a = c.audit;
const near = (x, y, tolerance = 1e-7) => assert.ok(Math.abs(x-y) < tolerance, `${x} != ${y}`);

test('AOSL distinguishes improving reported net loss from deteriorating operating profit', () => {
  const [,prior,current] = a.periods, e=a.earnings;
  for(const p of a.periods) near(p.revenue-p.cost-p.rd-p.sga,p.operating);
  near(current.operating+e.otherIncome+e.interestIncome-e.interestExpense-e.taxExpense+e.equityMethodIncome,current.net);
  near(prior.operating+e.priorOtherIncome+e.priorInterestIncome-e.priorInterestExpense-e.priorTaxExpense+e.priorEquityMethodIncome,prior.net);
  near(current.net-prior.net,54.711);
  near(current.operating-prior.operating,-14.759);
  assert.ok(current.net>prior.net && current.operating<prior.operating);
  assert.equal(e.priorJvImpairment,76.8);
  assert.equal(e.msuPriorExpenseReversal,3.9);
  assert.equal(a.guidance.reportedActual,false);
  near(a.guidance.impliedNetAtMidpoint,-11.212);
});

test('AOSL reconciles cash without calling an asset sale recurring operating cash', () => {
  const f=a.cash, d=a.cashDetails;
  near(a.operatingCashBridge.reduce((sum,row)=>sum+row[1],0),f.operating);
  near(d.ppe+d.intangibles,f.capex);
  near(f.operating-f.capex,-68.641);
  near(f.operating-f.capex-d.supplierLoan,-78.318);
  near(d.jvSale-d.ppe-d.intangibles-d.supplierLoan+d.ppeDisposal+d.privateInvestmentRecovery+d.equipmentGrants,f.investing);
  near(d.employeePurchaseCash-d.awardWithholding-d.buybackCash-d.debtRepaid-d.financeLeasePrincipal,f.financing);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(d.unrestricted+d.restricted,f.end);
  near(f.end-f.start,27.927);
  assert.equal(a.jv.allInstallmentsReceived,true);
  assert.equal(a.jv.consolidateInvesteeRevenue,false);
  near(a.jv.priorOwnership-a.jv.soldOwnership,a.jv.remainingOwnership);
  assert.ok(a.jv.saleGainApprox>a.jv.equityMethodIncome);
});

test('AOSL keeps the advanced-computing denominator and guidance distinct from AI actuals', () => {
  const p=a.products, x=p.advancedComputing;
  for(const rows of [p.rows,p.endMarkets]) {
    near(rows.reduce((sum,row)=>sum+row[1],0),a.periods[1].revenue);
    near(rows.reduce((sum,row)=>sum+row[2],0),a.periods[2].revenue);
  }
  near(x.q4TotalShareEstimate,.15438);
  near(x.q4AdvancedRevenueEstimate,26.306352);
  near(x.q4AdvancedRevenueEstimate,x.q4RevenueRounded*x.computingShare*x.advancedWithinComputing);
  assert.equal(x.standaloneAiRevenue,null);
  assert.equal(x.standaloneAdvancedGrossMargin,null);
  assert.equal(x.segmentProfitVerified,false);
  assert.equal(x.guidanceIsActual,false);
  near(x.annualizedScaleOnly,105.225408);
});

test('AOSL uses September outstanding shares and does not double count treasury or proposed awards', () => {
  const k=a.capital;
  near(k.issuedJuneRounded-k.treasuryJuneRounded,k.outstandingJuneRounded);
  near(k.priorIssuedRounded-k.priorTreasuryRounded,k.priorOutstandingRounded);
  near(k.outstandingJuneRounded-k.priorOutstandingRounded,.244);
  near(k.august31TimeBased+k.august31PerformanceBased,k.august31Awards);
  near(Object.values(k.juneAwards).reduce((s,v)=>s+v,0),3.114407);
  near(k.august31UnusedPlan+k.proposedNovemberIncrease,k.proposedTotalUnusedPlan);
  assert.equal(k.optionsAugust31,0);
  assert.equal(k.performanceMaximumOfTarget,1);
  assert.equal(k.proposedIncreaseApproved,false);
  assert.equal(k.fullOctoberAwardLedgerVerified,false);
  assert.equal(c.shareDate,'2026-09-17');
  near(c.shares,30.305071);
  near(c.price.value*c.shares,659.13529425);
});

test('AOSL annual funding conserves cash and adds financing shares only once', () => {
  const f=a.funding;
  for(const p of [...Object.values(f.paths),f.stress]) {
    let cash=f.openingCash,shares=f.openingShares;
    for(const y of p.rows) {
      near(y.operating,y.gross-y.rd-y.sga);
      near(y.net,y.operating+y.netInterest-y.tax);
      near(y.operatingCash,y.net+y.da+y.sbc-y.workingCapital);
      near(y.fcf,y.operatingCash-y.capex);
      near(y.cashEnd,cash+y.fcf-y.debtPrincipal-y.financeLeasePrincipal+y.esppCash-y.awardWithholding+y.raiseNet);
      near(y.raiseNet,y.raiseGross*(1-f.feeRate));
      near(y.raiseShares,y.raiseGross/p.issuePrice);
      near(y.sharesEnd,shares+y.awardNetShares+y.esppShares+y.raiseShares);
      assert.ok(y.cashEnd>=f.minimumCash-1e-7);
      if(y.raiseNet>0) near(y.cashEnd,f.minimumCash);
      cash=y.cashEnd; shares=y.sharesEnd;
    }
    near(shares,p.futureShares);
    near(p.rows.reduce((s,y)=>s+y.raiseNet,0),p.netRaise);
  }
  near(f.paths.base.futureShares,37.753);
  near(f.paths.bull.futureShares,40.253);
  near(f.paths.bear.netRaise,88.98079);
  near(f.stress.netRaise,252.5159);
  assert.equal(a.fullFundingModelVerified,false);
  assert.equal(a.liquidity.receivableLoanTermsVerified,false);
});

test('AOSL per-share upside changes materially when growth requires low-price funding', () => {
  const company={price:c.price,shares:{value:c.shares},financials:{anchorRevenue:c.anchorRevenue}};
  for(const s of a.scenarios) {
    const p=M.project(company,s);
    near(p.price,s.price); near(p.priceMultiple,s.priceMultiple);
    near(s.operating,s.grossProfit-s.rd-s.sga);
    near(s.net,s.operating+s.netInterest-s.tax);
  }
  const base=a.scenarios.find(s=>s.id==='base'),bull=a.scenarios.find(s=>s.id==='bull'),bear=a.scenarios.find(s=>s.id==='bear');
  near(M.project(company,base).priceMultiple,2.8984527681594003);
  near(M.project(company,bull).priceMultiple,9.896028310590687);
  near(a.funding.stress.priceMultiple,4.344837239684589);
  assert.ok(a.funding.stress.futureShares>bull.shares+25);
  assert.equal(bear.pe,null); assert.equal(bear.equityValue,200);
  for(const h of a.hurdleCases) near(M.hurdle(company,h).revenue*h.margin*h.pe/h.shares/c.price.value,10);
});

test('AOSL new research has dated primary evidence and preserves quote provenance', () => {
  const ids=new Set(data.sources.map(s=>s.id));
  for(const id of [...c.sources,...a.sections.flatMap(s=>s.sources)]) assert.ok(ids.has(id));
  const source=data.sources.find(s=>s.id==='aosl-q4-remarks');
  assert.match(source.url,/sec\.gov\/Archives\/edgar\/data\/1387467\/000162828026056197\/exhibit992/);
  assert.equal(source.publishedAt,'2026-08-12');
  const q=quotes.find(q=>q.symbol==='AOSL');
  assert.equal(q.observations.at(-1).date,c.price.asOf);
  near(q.observations.at(-1).close,c.price.value);
  assert.equal(q.currency,c.currency);
  const md=fs.readFileSync('docs/research/potential-stocks-2026-10-18.md','utf8').split('Alpha and Omega Semiconductor（万国半导体） · AOSL').at(-1);
  assert.match(md,/15\.438%/);
  assert.match(md,/252\.516/);
  assert.match(md,/尚未批准/);
  assert.match(md,/不是.*股价底/);
  assert.doesNotMatch(md,/NaN|undefined/);
});
