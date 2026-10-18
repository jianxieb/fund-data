const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-stocks.json'), 'utf8'));
const quotes = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-quotes.json'), 'utf8'));
const M = require('../assets/potential-model.js');
const c = data.comparisons.find(x => x.id === '688167');
const a = c.audit;
const near = (x, y, e = 1e-8) => assert.ok(Math.abs(x-y) < e, `${x} != ${y}`);

test('Focuslight uses the post-distribution close and distinguishes registered shares from awards', () => {
  assert.equal(c.price.asOf, '2026-10-16');
  assert.equal(c.shareDate, '2026-06-30');
  near(c.price.value, 208.80);
  near(c.shares, 130.138971);
  const q = quotes.find(x => x.symbol === '688167.SS');
  assert.equal(q.currency, 'CNY');
  assert.equal(q.basis, 'unadjusted_regular_session_close');
  near(q.observations.at(-1).close, c.price.value, 1e-5);
  assert.equal(q.observations.at(-1).date, c.price.asOf);
  const k = a.capital;
  near(k.registeredStart-k.treasuryExcludedFromDistribution, k.distributionBase);
  near(k.registeredStart+k.newSplitShares, k.registeredJune);
  near(Math.round(k.distributionBase*1e6*k.distributionRatio)/1e6, k.newSplitShares);
  near(k.awardAdjustmentFactor, 1.448);
  assert.notEqual(k.awardAdjustmentFactor, 1.45);
});

test('Focuslight LTM uses reported annual and comparative half-year statements', () => {
  const [, fy, h25, h26, ltm] = a.periods;
  for (const k of ['revenue','cost','operating','pretax','net','operatingCash','capex','adjustedNet'])
    near(ltm[k], fy[k]-h25[k]+h26[k]);
  for (const p of a.periods) near(p.fcf, p.operatingCash-p.capex);
  near(fy.revenue, 879.99932916);
  near(ltm.revenue, 905.79835689);
  near(ltm.net, -80.69764333);
  near(ltm.fcf, -39.61617818);
  near(h26.fcf, -71.63714117);
  assert.ok(h26.revenue*2 !== ltm.revenue);
});

test('Focuslight cash bridge does not count investment maturities or treasury award proceeds as earnings', () => {
  const f=a.cash, d=a.cashDetails;
  near(f.start+f.operating+f.investing+f.financing+f.fx, f.end);
  near(d.investmentMaturities-d.investmentPurchases+d.investmentInterest-f.capex-d.bvtInvestment-d.derivativeSettlement, f.investing);
  near(d.awardSubscription-d.debtRepaid-d.dividendInterest-d.otherFinancing, f.financing);
  near(d.newBorrowing, 0);
  near(d.awardSubscription, 24.56761346);
  near(f.end, 506.61480578);
  near(f.end-f.start, -107.55941422);
  near(f.capexPrepaid, 0);
});

test('Focuslight segment reconciliation preserves signed eliminations and separates non-auto GPF', () => {
  const [lsa,lo,gpf]=a.segments, z=a.segmentAdjustments;
  const h=a.periods.find(p=>p.label==='2026H1');
  for (const s of a.segments) near(s.external+s.internal-s.cost, s.gross);
  near(a.segments.reduce((sum,s)=>sum+s.external,0),h.revenue);
  near(a.segments.reduce((sum,s)=>sum+s.gross,0)-z.grossElimination,h.revenue-h.cost);
  near(a.segments.reduce((sum,s)=>sum+s.pretax,0)+z.pretaxUnallocated-z.pretaxElimination,h.pretax);
  near(z.nonAutoGpfGross,-16.23761969);
  near(z.nonAutoGpfExternal,21.15261419);
  near(gpf.impairment,0);
  near(lsa.impairment,-31.00156994);
  near(z.unallocatedInventoryImpairment,-35.37955688);
  near(lo.pretax,53.97209868);
  assert.ok(lo.external !== a.profitQuality.h1OpticalRevenueRounded);
});

test('Focuslight profit deterioration includes smaller tax benefits without counting equity tax as earnings', () => {
  const p=a.profitQuality, h25=a.periods[2], h26=a.periods[3];
  near(p.goodwillImpairment+p.inventoryImpairment,66.38112682);
  near(p.pretaxChange-p.taxBenefitReduction,p.netChange);
  near(p.netChange,-42.28806906);
  near(p.taxBenefitReduction,19.92132295);
  near(h26.pretax-p.taxExpense,h26.net);
  near(h25.pretax-p.priorTaxExpense,h25.net);
  near(p.equityRecognizedAwardDeferredTax,88.77300410);
  assert.ok(h26.pretax+p.goodwillImpairment < 0);
});

test('Focuslight available cash excludes restricted cash, accrued interest and earmarked IPO funds', () => {
  const l=a.liquidity;
  near(l.monetaryFunds-l.restrictedGuarantees-l.accruedDepositInterest,l.cashEquivalents);
  near(l.currentBorrowings+l.longBorrowings,l.borrowings);
  near(l.cashEquivalents-l.ipoDemandDeposits,l.unearmarkedCashEstimate);
  near(l.unearmarkedCashEstimate,449.53090578);
  near(l.cashEquivalents+l.tradingAssets-l.borrowings,l.broadNetLiquidAssets);
  near(l.unearmarkedCashEstimate-l.borrowings-l.currentLease-l.longLease,l.unearmarkedAfterLoansAndLeases);
  assert.ok(l.unearmarkedAfterLoansAndLeases<0);
  near(l.ipoDemandDeposits+l.ipoStructuredPrincipal,127.0839);
  assert.ok(l.ipoStructuredPrincipal<=l.tradingAssets);
});

test('Focuslight grant pools exclude forfeitures and do not add the October vesting subset twice', () => {
  const k=a.capital;
  near(k.old2023Remaining,0);
  near(k.acquisitionPoolAdjusted-k.acquisitionForfeitOctober,k.acquisitionPoolAfterForfeit);
  near(k.acquisitionPoolAfterForfeit,3.443576);
  assert.ok(k.acquisitionApprovedOctober<k.acquisitionPoolAfterForfeit);
  assert.equal(k.octoberVestingCompletedVerified,false);
  near(k.awards2025First+k.awards2025Reserved+k.awards2025Final,k.awards2025Total);
  near(k.awards2025Total,5.2128);
  near(k.awards2026First+k.awards2026September+k.awards2026October,k.awards2026Total);
  near(k.awards2026Total,3.6);
  assert.ok(k.awards2026Price>c.price.value);
  near(k.registeredJune+k.normal2024AdjustedEstimate+k.acquisitionPoolAfterForfeit+k.awards2025Total+k.awards2026Total,k.registeredPlusEstimatedAwards);
  near(k.registeredPlusEstimatedAwards+k.proposedPlacementShareCap,k.estimatedPoolIncludingPlacement);
  assert.equal(k.normal2024AdjustedCountVerified,false);
  assert.equal(k.futureGrantSharesVerified,false);
});

test('Focuslight proposed financing respects both cash and share caps and remains outside current cash', () => {
  const f=a.fundingSensitivity;
  assert.equal(f.proceedsReceivedVerified,false);
  assert.equal(f.shareholderApproved,'2026-08-24');
  near(f.projects.reduce((x,p)=>x+p.investment,0),1152.3139);
  near(f.projects.reduce((x,p)=>x+p.plannedFunding,0),1021.1495);
  near(f.plannedGross/f.shareCap,f.minimumPriceForFullGrossAtJuneCap);
  for (const s of f.cases) {
    assert.ok(s.shares<=f.shareCap);
    assert.ok(s.gross<=f.plannedGross+1e-8);
    near(s.shares*s.price,s.gross);
    near(s.net,s.gross*(1-f.feeAssumption));
    near(s.gapToEntirePlan,f.totalInvestment-s.net);
  }
  const low=f.cases.find(s=>s.price===100);
  near(low.shares,6.506948);
  near(low.net,637.680904);
  near(low.gapToEntirePlan,514.632996);
});

test('Focuslight scenarios rebuild earnings from revenue groups and retain dilution and funding gaps', () => {
  const company={price:c.price,shares:{value:c.shares},financials:{anchorRevenue:c.anchorRevenue}};
  for(const s of a.scenarios){
    near(s.componentRevenues.reduce((x,y)=>x+y,0),s.revenue);
    near(s.componentRevenues.reduce((x,y,i)=>x+y*s.componentGrossMargins[i],0),s.grossProfit);
    near(s.rd+s.selling+s.administration+s.writeDown,s.opex);
    near(s.grossProfit-s.opex,s.operating);
    near(s.operating-s.netInterest,s.pretax);
    near(s.pretax-s.tax,s.net);
    near(s.net/s.revenue,s.margin);
    near(s.shares-a.capital.estimatedPoolIncludingPlacement,s.futureShareBuffer);
    assert.ok(s.futureShareBuffer>0);
    near(M.project(company,s).price,s.price);
    near(M.project(company,s).priceMultiple,s.priceMultiple);
    assert.equal(s.probability,undefined);
  }
  const bull=a.scenarios.find(s=>s.id==='bull'), base=a.scenarios.find(s=>s.id==='base');
  near(base.net,321);near(bull.net,1500);near(bull.price,375);
  near(c.price.value*10*160/.30/40,27840);
  assert.equal(a.fullFundingModelVerified,false);
  assert.ok(a.sourceLimitations.length>=4);
  for(const section of a.sections) for(const id of section.sources) assert.ok(data.sources.some(s=>s.id===id));
});
