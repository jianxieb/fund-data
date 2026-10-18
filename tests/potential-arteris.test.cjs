const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-stocks.json'), 'utf8'));
const quotes = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-quotes.json'), 'utf8'));
const M = require('../assets/potential-model.js');
const c = data.comparisons.find(x => x.id === 'AIP');
const a = c.audit;
const company = {price:c.price,shares:{value:c.shares},financials:{anchorRevenue:c.anchorRevenue}};
const near = (x,y,eps=1e-8) => assert.ok(Math.abs(x-y)<eps,`${x} != ${y}`);

test('Arteris uses the dated outstanding share count and original closing observation', () => {
  assert.equal(c.shareDate,'2026-07-30');
  near(c.shares,49.152102);
  near(c.price.value,18.76,1e-6);
  near(c.price.value*c.shares,922.0934447700233);
  const q=quotes.find(x=>x.symbol==='AIP');
  assert.equal(q.basis,'unadjusted_regular_session_close');
  assert.equal(q.observations.at(-1).date,'2026-10-16');
  near(q.observations.at(-1).close,c.price.value);
});

test('Arteris LTM preserves the annual note revenue split and vendor financing cash', () => {
  const [y24,y25,h25,h26,ltm]=a.periods;
  for(const field of ['revenue','cost','operating','net','operatingCash','capex','sbc','license','royalty','services','vendorPrincipal','newVendorPPE'])
    near(ltm[field],y25[field]-h25[field]+h26[field]);
  for(const p of a.periods){
    near(p.revenue,p.license+p.royalty+p.services);
    near(p.fcf,p.operatingCash-p.capex);
    near(p.afterVendorCash,p.fcf-p.vendorPrincipal);
  }
  near(y24.net,-33.638);near(ltm.revenue,84.615);
  near(ltm.royalty,8.633);near(ltm.services,2.450);
  near(ltm.net,-39.519);near(ltm.afterVendorCash,5.140);
  near(h26.fcf,1.258);near(h26.afterVendorCash,.577);
  near(h26.newVendorPPE,2.558);
});

test('Arteris does not add overlapping deferred revenue or cancellable metrics to binding orders', () => {
  const r=a.revenueQuality;
  near(r.kpiRpo-r.nonCancelableRpo,3.5);
  near(r.next12Months+r.thereafter,r.nonCancelableRpo);
  assert.ok(r.deferredEnd<r.nonCancelableRpo);
  near(r.deferredStart+r.deferredAcquired+r.deferredCashChange,r.deferredEnd,.0011);
  near((26-25)/25,.04);
  assert.notEqual((r.q2DesignStarts-r.priorQ2DesignStarts)/r.priorQ2DesignStarts,r.ttmDesignGrowth);
  near(r.acv+r.ltmRoyaltyRounded,r.acvPlusRoyalty);
  assert.equal(r.organicRevenueVerified,false);
  near((40.096-30.423)+(4.606-2.569)+(2.368-.042),47.070-33.034);
});

test('Arteris cash bridge separates equity proceeds and reconciles accrual versus cash offering fees', () => {
  const f=a.cash,k=a.capital,l=a.liquiditySensitivity;
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(72.546+1.037+.644-.681+.093,f.financing);
  near(-11.179-16.329+11.978-.890,f.investing);
  near(l.cash+l.restricted,f.end);
  near(k.atmNetCash-k.atmNetEquity,.540);
  near(k.atmReconciliation,.540);
  near(k.currentAccruedOfferingCost+(k.priorDeferredOfferingCost-k.priorAccruedOfferingCost),.540);
  near(2.148-5.376-10.056,-13.284);
});

test('Arteris removes the acquisition tax benefit without silently deleting recurring stock compensation', () => {
  const q=a.profitQuality;
  near(-23.208-.068+1.240-2.989+3.001,q.h1ReportedNet);
  near(q.h1ReportedNet-q.oneTimeTaxBenefit,q.netWithoutTaxBenefit);
  near(-23.208+q.acquisitionExpense,q.operatingWithoutAcquisitionExpense);
  near(q.h1ReportedNet+11.858+q.h1IntangibleAmortization+q.acquisitionExpense,q.h1NonGaapNet);
  near(q.h1NonGaapNet-q.oneTimeTaxBenefit,-10.007);
  assert.ok(q.operatingWithoutAcquisitionExpense < -15.956);
});

test('Arteris acquisition includes shares and contingent consideration beyond the cash payment', () => {
  const x=a.acquisition;
  near(x.cashClose+x.cashAwards+x.stockValue+x.initialEarnout,x.purchaseConsideration);
  near(x.cashClose+x.cashAwards-x.cashAcquired,x.reportedNetCash,.0011);
  near(x.initialEarnout+a.profitQuality.earnoutRemeasurement,x.currentEarnout);
  assert.ok(x.currentEarnout<x.maximumEarnout);
  assert.equal(x.deadline,'2027-03-31');
});

test('Arteris common shares and award roll reconcile without double counting maximum PSUs', () => {
  const k=a.capital;
  near(k.shares2024+k.optionsIssued2025+k.rsuIssued2025+k.esppIssued2025,k.shares2025);
  near(k.shares2025+k.optionsIssuedH1+k.rsuIssuedH1+k.esppIssuedH1+k.acquisitionIssuedH1+k.atmIssuedH1,k.sharesJune);
  near(k.unvestedStart+k.granted-k.vested-k.cancelled,k.unvestedEnd);
  near(k.knownPoolAtTarget,55.621866);
  near(k.knownPoolNewPsuAtMax-k.knownPoolAtTarget,k.newPsuTarget);
  assert.equal(k.futureGrantSharesVerified,false);
  for(const s of a.scenarios)
    near(k.knownPoolNewPsuAtMax+s.futureAwardsAcquisitionAndOtherShares+s.fundingSharesIncluded,s.shares);
});

test('Arteris operating scenarios separately price low-margin services and retain taxes and dilution', () => {
  for(const s of a.scenarios){
    near(s.revenue,s.license+s.royalty+s.services);
    near(s.grossProfit,s.license*s.licenseGrossMargin+s.royalty*s.royaltyGrossMargin+s.services*s.servicesGrossMargin);
    near(s.operating,s.grossProfit-s.rd-s.salesMarketing-s.generalAdministration-s.amortization);
    near(s.net,s.operating+s.financialIncome-s.tax);
    near(s.margin*s.revenue,s.net);
    near(M.project(company,s).price,s.price);
  }
  const [bear,base,bull]=a.scenarios;
  near(bear.net,-50.75);near(bear.tax,1.5);assert.equal(bear.pe,null);
  near(base.net,31.3875);near(bull.net,131.025);
  near(M.project(company,base).priceMultiple,.6856998588087674);
  near(M.project(company,bull).priceMultiple,3.32584522290147);
});

test('Arteris liquidity stress pays existing liabilities once and treats stock settlement as an alternative', () => {
  const l=a.liquiditySensitivity;
  near(l.reportedLiquidAssets,123.262);
  near(l.stressedStartingAssets,121.7624);
  near(l.beforeFiveYearBurn,90.7544);
  near(l.afterFiveYears,-29.2456);
  near(l.netRaise,54.2456);
  near(l.sharesAt10*10*(1-l.issueFee),l.netRaise);
  near(l.sharesAt5,2*l.sharesAt10);
  near(l.allStockEarnoutAlternativeNetRaise+l.earnoutCap,l.netRaise);
  near(l.allStockAlternativeSharesAt10,l.allStockEarnoutAlternativeNetRaise/9.5+1.2);
  for(let i=1;i<l.annualRows.length;i++)
    near(l.annualRows[i].cashBeforeNewFinancing-l.annualRows[i-1].cashBeforeNewFinancing,-24);
  near(a.scenarios[0].fundingSharesIncluded,l.sharesAt10);
  assert.equal(a.fullFundingModelVerified,false);
});

test('Arteris tenfold revenue hurdle exceeds the strong operating case even before extra dilution', () => {
  const bull=a.scenarios.find(s=>s.id==='bull');
  const h=M.hurdle(company,{shares:63,margin:.30,pe:30});
  near(h.revenue,1313.2,.0001);
  near(h.profit,393.96,.0001);
  assert.ok(h.profit>bull.net*3);
  assert.ok(M.project(company,{...bull,shares:c.shares}).priceMultiple<4.27);
  near(M.project(company,{...bull,pe:22.5,shares:75.6}).priceMultiple,bull.priceMultiple*.75/1.2);
  assert.equal(a.guidance.actual,false);
  assert.equal(a.guidance.date,'2026-08-06');
  assert.ok(a.guidance.fyRevenueLow>47.070);
});
