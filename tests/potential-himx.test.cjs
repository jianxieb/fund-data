const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../assets/potential-model.js');
const data = JSON.parse(fs.readFileSync('data/potential-stocks.json','utf8'));
const quotes = JSON.parse(fs.readFileSync('data/potential-quotes.json','utf8'));
const c = data.comparisons.find(x => x.id === 'HIMX');
const a = c.audit;
const near = (x,y,tolerance=1e-7) => assert.ok(Math.abs(x-y)<tolerance,`${x} != ${y}`);

test('HIMX reconciles IFRS profit, tax, minority earnings and rolling twelve months', () => {
  for (const p of a.periods) {
    near(p.revenue-p.cost-p.rd-p.ga-p.sales,p.operating);
    near(p.operating+p.interestIncome+p.fairValueGain+p.fxGain-p.financeCost-p.associateLoss+p.otherGain+p.otherIncome-p.tax-p.nci,p.net);
    near(p.operatingCash-p.capex,p.fcf);
  }
  const [fy24,fy25,h125,h126,ltm] = a.periods;
  for (const k of Object.keys(ltm).filter(k=>k!=='label')) near(fy25[k]-h125[k]+h126[k],ltm[k]);
  near(ltm.revenue,828.627); near(ltm.net,35.274); near(ltm.operatingCash,45.054);
  assert.ok(h126.revenue<h125.revenue && h126.net<h125.net);
  assert.ok(fy24.tax<0 && fy25.tax>0);
  const s=a.segments;
  near(s.driverRevenue[2]+s.otherRevenue[2],fy25.revenue);
  near(s.driverOperating[2]+s.otherOperating[2],fy25.operating);
  assert.ok(s.otherRevenue[2]>s.otherRevenue[1] && s.otherOperating[2]<0);
});

test('HIMX cash conserves funds and distinguishes tax timing, deposits and operating cash', () => {
  const f=a.cash,d=a.cashDetails,h=d.h1;
  near(a.operatingCashBridge.reduce((s,r)=>s+r[1],0),f.operating);
  near(d.investing.reduce((s,r)=>s+r[1],0),f.investing);
  near(d.financing.reduce((s,r)=>s+r[1],0),f.financing);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(h.ppe+h.intangibles,f.capex);
  near(f.operating-f.capex,14.077);
  near(f.operating-f.capex-a.liquidity.taxDeferredApprox,d.taxTimingAdjustedH1Fcf);
  near(d.ltmFcf,26.930);
  near(d.ltmFcf-a.liquidity.taxDeferredApprox,d.taxTimingAdjustedLtmFcf);
  near((d.priorH1ReceivableChange-h.receivableChange)+(d.priorH1PayablesChange-h.payablesChange)+(d.priorH1InventoryChange-h.inventoryChange),85.037);
  near(a.liquidity.cash+a.liquidity.shortFinancialAssets,a.liquidity.headlineCashAndFinancialAssets);
  near(a.liquidity.restrictedDeposits,a.liquidity.matchingSecuredBorrowings);
  assert.equal(a.liquidity.parentCashFreelyRemittableVerified,false);
  assert.equal(a.liquidity.currentSupplierDepositTotalVerified,false);
});

test('HIMX ADS and RSU conversions do not turn cash awards or insider vesting into double dilution', () => {
  const k=a.capital;
  near(k.issuedOrdinary2025-k.treasuryOrdinary2025,k.outstandingOrdinary2025);
  near(k.outstandingOrdinary2025/k.ordinaryPerAds,k.outstandingAds2025);
  assert.equal(k.rsuOrdinaryShares,k.ordinaryPerAds);
  near(k.septemberVestedCfoRsu*2,k.septemberVestedCfoOrdinary);
  near(k.septemberVestedCeoRsu*2,k.septemberVestedCeoOrdinary);
  near(k.totalSbcExpense2025-k.cashSettledRsuCost2025,k.noncashSbc2025);
  assert.ok(k.unvestedRsu2025<k.grantRsu2025*.1);
  assert.equal(c.shares,174.4); assert.equal(c.shareDate,'2026-06-30');
  assert.equal(k.fullOctoberShareLedgerVerified,false);
  assert.equal(k.actualFullBonus2026Verified,false);
  for(const form of k.insiderForms.filter(f=>f.eventDate==='2026-09-30')) {
    const ordinary=form.transactions.filter(x=>x.security.startsWith('Ordinary')).reduce((s,x)=>s+x.shares,0);
    const rsu=form.transactions.filter(x=>x.security==='Restricted Stock Units').reduce((s,x)=>s+x.shares,0);
    near(ordinary,rsu*2);
  }
});

test('HIMX product adoption and disposal expectations are not substituted for booked CPO earnings', () => {
  assert.equal(a.business.qwenAdoptionActual,true);
  assert.equal(a.business.qwenAsp,null);
  assert.equal(a.segments.standaloneCpoRevenue,null);
  assert.equal(a.segments.standaloneCpoMargin,null);
  assert.equal(a.business.cpoMassProductionTimingVerified,false);
  assert.equal(a.guidance.reportedActual,false);
  near(a.disposal.wholeInvesteeCashConsideration*a.disposal.himaxOwnershipApprox,a.disposal.unadjustedProceedsInference);
  assert.equal(a.disposal.includedInRecurringProfit,false);
  assert.equal(a.disposal.includedInFunding,false);
  assert.equal(a.funding.h2Bridge.saleProceeds,0);
  assert.equal(a.funding.h2Bridge.depositRefund,0);
});

test('HIMX annual funding includes cash bonuses in earnings and repays deferred tax only once', () => {
  const f=a.funding,h=f.h2Bridge;
  near(h.operatingCash,h.parentNet+h.da+h.sbc-h.workingCapital);
  near(h.cashEnd,h.cashStart+h.operatingCash-h.capex-h.debtPrincipal-h.leasePrincipal-h.paidJulyDividend);
  near(h.sharesEnd,h.sharesStart+h.awardAds);
  near(h.cashEnd,251.196);
  for(const p of [...Object.values(f.paths),f.stress,f.stressNoDividend]) {
    let cash=p.openingCash,shares=f.openingShares;
    near(p.openingCash,f.openingCash-p.openingCashHaircut);
    for(const y of p.rows) {
      near(y.revenue,y.parts.reduce((s,x)=>s+x.revenue,0));
      near(y.operating,y.parts.reduce((s,x)=>s+x.revenue*x.operatingMargin,0));
      near(y.net,y.pretax-y.tax-y.nci);
      near(y.tax,Math.max(0,y.pretax)*f.annualTaxRate);
      near(y.operatingCash,y.net+y.da+y.sbc-y.workingCapital-y.taxRepayment);
      near(y.fcf,y.operatingCash-y.capex);
      near(y.cashEnd,cash+y.fcf-y.debtPrincipal-y.leasePrincipal-y.dividendCash+y.raiseNet);
      near(y.raiseNet,y.raiseGross*(1-f.feeRate));
      near(y.raiseShares,y.raiseGross/p.issuePrice);
      near(y.sharesEnd,shares+y.awardShares+y.raiseShares);
      assert.ok(y.cashEnd>=f.minimumCash-1e-7);
      if(y.raiseNet>0) near(y.cashEnd,f.minimumCash);
      cash=y.cashEnd; shares=y.sharesEnd;
    }
    near(p.rows.reduce((s,y)=>s+y.taxRepayment,0),11);
    near(p.rows.reduce((s,y)=>s+y.debtPrincipal,0),22.5);
    near(shares,p.futureShares);
  }
  assert.equal(a.fullFundingModelVerified,false);
});

test('HIMX five-year dividends use prior-year earnings and exclude the July 2026 payout', () => {
  const f=a.funding;
  for(const p of [...Object.values(f.paths),f.stress,f.stressNoDividend]) {
    let prior=f.h2Bridge.fy2026ParentNet;
    for(const y of p.rows) {
      assert.equal(y.dividendProfitYear,y.year-1);
      near(y.dividendProfit,prior);
      near(y.dividendCash,Math.max(prior,0)*p.payout);
      near(y.dividendPerAds,y.dividendCash/y.dividendShares);
      prior=y.net;
    }
    assert.equal(p.rows[0].year,2027);
    assert.equal(p.rows.at(-1).dividendProfitYear,2030);
    near(p.dividends,p.rows.reduce((s,y)=>s+y.dividendPerAds,0));
    near(p.totalMultiple,(p.price+p.dividends)/c.price.value);
  }
  near(f.paths.base.dividends,1.3543831889255373);
  near(f.stressNoDividend.dividends,0);
  assert.ok(f.stressNoDividend.netRaise<f.stress.netRaise);
  assert.ok(f.stressNoDividend.futureShares<f.stress.futureShares);
});

test('HIMX per-ADS value and conditional tenfold threshold reflect financing dilution', () => {
  const company={price:c.price,shares:{value:c.shares},financials:{anchorRevenue:c.anchorRevenue}};
  for(const s of a.scenarios) {
    const p=M.project(company,s);
    near(p.price,s.price);near(p.priceMultiple,s.priceMultiple);near(p.totalMultiple,s.totalMultiple);
  }
  near(a.funding.paths.base.priceMultiple,2.153255056849845);
  near(a.funding.paths.bull.priceMultiple,7.529928696066374);
  near(a.funding.stress.netRaise,513.80325);
  near(a.funding.stressNoDividend.netRaise,308.26925);
  near(a.funding.stressNoDividend.priceMultiple,4.670852634605448);
  const h=a.funding.conditionalTenfoldCpo,b=a.funding.paths.bull,last=b.rows.at(-1);
  near(h.parentNetRequired,h.targetPrice*h.shares/h.pe);
  const nonCpo=last.parts.filter(p=>p.name!=='cpo').reduce((s,p)=>s+p.operating,0);
  near((nonCpo+h.revenueRequired*h.cpoOperatingMargin)*.8-last.nci,h.parentNetRequired);
  assert.equal(h.extraFundingModeled,false);
  for(const x of a.hurdleCases) near(M.hurdle(company,x).revenue*x.margin*x.pe/x.shares/c.price.value,10);
});

test('HIMX dated source records and the dossier retain explicit evidence gaps', () => {
  const ids=new Set(data.sources.map(x=>x.id));
  for(const id of [...c.sources,...a.sections.flatMap(s=>s.sources)]) assert.ok(ids.has(id));
  const q=quotes.find(x=>x.symbol==='HIMX');
  assert.equal(q.currency,'USD');assert.equal(q.basis,'unadjusted_regular_session_close');
  assert.equal(q.observations.at(-1).date,c.price.asOf);
  near(q.observations.at(-1).close,c.price.value,1e-6);
  const sec=data.sources.find(s=>s.id==='himx-insider-grant-ceo');
  assert.equal(sec.publishedAt,'2026-09-25'); assert.match(sec.url,/000117184326006228\/ownership.xml$/);
  const md=fs.readFileSync('docs/research/potential-stocks-2026-10-18.md','utf8').split('### 奇景光电（Himax） · HIMX').at(-1).split('\n## ')[0];
  assert.match(md,/98\.74%/);assert.match(md,/暂停未来分红/);assert.match(md,/2032年/);
  assert.match(md,/1,059百万/);assert.match(md,/未见交割证据/);assert.match(md,/不是股价底/);
  assert.doesNotMatch(md,/NaN|undefined/);
});
