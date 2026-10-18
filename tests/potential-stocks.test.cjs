const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/potential-model.js');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const byId = id => data.companies.find(c => c.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('stockholder return divides terminal value by diluted shares, not starting shares', () => {
  const c = byId('AMPX'), bull = M.scenario(c, 'bull'), p = M.project(c, bull);
  near(p.price, 1000 * .15 * 30 / 210);
  near(p.priceMultiple, p.capitalMultiple / (210 / 146.080618));
  const h = M.hurdle(c, bull);
  near(h.price, 77.1);
  near(h.equity, 16191);
  near(h.revenue, 3598);
  near(M.project(c, { ...bull, revenue: h.revenue }).priceMultiple, 10);
  assert.ok(h.capitalMultiple > 14);
});

test('cash dividends stay separate from the price multiple and compound over five years', () => {
  const c = byId('688389'), base = M.scenario(c, 'base'), p = M.project(c, base);
  near(p.totalMultiple - p.priceMultiple, 2.5 / 10.82);
  near(M.returnPercent(10, false), 900);
  near(M.returnPercent(10, true), (10 ** .2 - 1) * 100);
  near(M.returnPercent(0, true), -100);
  assert.equal(M.returnPercent(-1, false), null);
});

test('losses require an explicit residual value and missing inputs never silently become zero', () => {
  const c = byId('AMPX'), bear = M.scenario(c, 'bear');
  near(M.project(c, bear).price, .4);
  assert.throws(() => M.project(c, { ...bear, equityValue: undefined }), RangeError);
  assert.throws(() => M.project(c, { ...bear, shares: 0 }), RangeError);
  assert.throws(() => M.project({ ...c, shares: { value: null } }, bear), RangeError);
  assert.equal(M.hurdle(c, bear), null);
  assert.equal(M.hurdle({ ...c, financials: { anchorRevenue: null } }, M.scenario(c, 'bull')), null);
});

test('the price start, provenance, unit build and scenario claims reconcile for every candidate', () => {
  const sourceIds = new Set(data.sources.map(s => s.id));
  assert.equal(sourceIds.size, data.sources.length);
  for (const s of data.sources) {
    assert.match(s.url, /^https:\/\//);
    if (s.datePrecision === 'unknown') {
      assert.equal(s.publishedAt, null, 'an undated page must not use its retrieval date as publication date');
      assert.match(s.retrievedAt, /^\d{4}-\d\d-\d\d$/);
      assert.ok(s.retrievedAt <= data.reviewedAt);
    } else {
      assert.match(s.publishedAt, s.datePrecision === 'month' ? /^\d{4}-\d\d$/ : /^\d{4}-\d\d-\d\d$/);
      assert.ok(s.publishedAt <= data.reviewedAt);
    }
    assert.ok(s.period && s.locator && s.type);
  }
  for (const c of data.companies) {
    const q = quotes.find(q => q.symbol === c.price.symbol), last = q.observations.at(-1);
    near(c.price.value, Math.round(last.close * 100) / 100);
    assert.equal(last.date, c.price.asOf);
    assert.equal(q.currency, c.currency);
    assert.equal(c.price.asOf, data.priceDate);
    assert.equal(c.price.basis, 'regular_close_unadjusted');
    const ids = [c.financials.source, c.shares.source, ...(c.shares.sources || []), ...c.facts.flatMap(f => f.sources), ...c.guidance.flatMap(g => g.sources), ...c.fundingSources, ...c.marketTest.sources, ...c.alternatives.flatMap(a => a.sources), ...c.calibration.flatMap(a => a.sources), ...(c.financingCheck?.sources || []), ...(c.earningsAdjustment?.sources || []), ...(c.productCheck?.sources || []), ...(c.profitCheck?.sources || []), ...(c.cashCheck?.sources || []), ...(c.ownershipCheck?.sources || [])];
    for (const audit of [c.cashAudit, c.awardAudit, c.dilutionAudit, c.liquidityCheck, c.medicalAudit, c.diagnosticAudit, c.sensingAudit, c.dataServiceAudit]) ids.push(...(audit?.sources || []));
    ids.forEach(id => assert.ok(sourceIds.has(id), `${c.id}: unknown source ${id}`));
    if (c.marketTest.kind === 'segment_growth') {
      near(c.marketTest.parts.reduce((sum, p) => sum + p.reportedRevenue, 0), c.financials.revenue);
      for (const p of c.marketTest.parts) {
        near(p.baseRevenue, p.reportedRevenue * 2);
        assert.ok(p.priorRevenue > 0 && p.revenue > 0);
        assert.equal(p.units, undefined, 'do not invent device counts from revenue');
      }
    } else if (c.marketTest.kind === 'annual_segments') {
      near(c.marketTest.parts.reduce((sum,p)=>sum+p.baseRevenue,0), c.diagnosticAudit.history.annual.revenue);
      assert.equal(c.marketTest.targetYear - c.marketTest.baseYear, 6, '2025 annual actual to 2031 is six years, independent of five-year stock return');
      for (const p of c.marketTest.parts) {
        assert.ok(p.baseRevenue > 0 && p.revenue > 0);
        assert.equal(p.units, undefined, 'new installations must not become the active installed base');
      }
    } else for (const p of c.marketTest.parts) {
      if (p.kind === 'annual_revenue') {
        assert.equal(c.marketTest.kind, 'mixed_units');
        assert.equal(p.units, undefined, 'contracted sites must not become paid subscription counts');
        assert.equal(p.price, undefined, 'a distributor quote is not the manufacturer net revenue');
      } else near(p.units * p.price / 1e6, p.revenue);
    }
    const bull = M.scenario(c, 'bull');
    near(c.marketTest.parts.reduce((sum, p) => sum + p.revenue, 0), bull.revenue);
    // Arithmetic and evidence integrity must not enforce an investment conclusion.
    for (const s of c.scenarios) assert.ok(Number.isFinite(M.project(c, s).priceMultiple));
    near(M.project(c, { ...bull, pe: bull.pe * .75, shares: bull.shares * 1.2 }).priceMultiple,
      M.project(c, bull).priceMultiple * .75 / 1.2);
    assert.ok(c.withdraw.length >= 2 && c.gaps.length >= 2 && c.milestones.length >= 2);
    assert.ok(c.shares.futureBasis && c.shares.convertibles && c.marketTest.gap);
    assert.ok(c.evidenceLabel && c.calibration.length);
  }
  for (const c of data.comparisons) {
    c.sources.forEach(id => assert.ok(sourceIds.has(id)));
    const q = quotes.find(q => q.symbol === c.price.symbol);
    // Provider closes may retain binary float precision; compare both at the quoted cent.
    near(Math.round(c.price.value * 100) / 100, Math.round(q.observations.at(-1).close * 100) / 100);
    assert.equal(c.price.asOf, q.observations.at(-1).date);
    assert.equal(c.currency, q.currency);
    assert.ok(c.shareDate || c.shareBasis);
    const checkSources = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'sources') child.forEach(id => assert.ok(sourceIds.has(id), `${c.id}: unknown audit source ${id}`));
        else checkSources(child);
      }
    };
    checkSources(c.audit);
  }
});

test('Novelbeam reconciles consolidated cash with parent profit and keeps all investing and financing uses', () => {
  const c=data.comparisons.find(c=>c.id==='688677'),a=c.audit,e=a.earnings,f=a.cash,p=a.periods.at(-1);
  near(p.revenue-p.cost-e.surcharge-e.selling-e.admin-e.research-e.finance+e.otherIncome+e.investment+e.fairValue+e.creditLoss+e.assetLoss+e.disposal,p.operating);
  near(p.operating+e.nonOperatingIncome-e.nonOperatingExpense-e.tax,e.totalNet);
  near(e.totalNet-e.minorityNet,p.net);
  near(e.totalNet+e.cashAdjustments.reduce((s,x)=>s+x,0),f.operating);
  near(f.assetDisposals-f.capex-f.investPaid,f.investing);
  near(f.borrowed-f.debtRepaid-f.dividendAndInterest-f.buyback-f.leaseCash-f.dividendFees,f.financing);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.operating-f.capex,41.64838203);
  assert.equal(f.capexPrepaid,0,'a balance-sheet equipment prepayment is not a second cash outflow');
  assert.match(a.cashNote,/0\.436.*未见独立净额解释/);
});

test('Novelbeam preserves the repair disclosure gap and separates customer revenue from receivables', () => {
  const c=data.comparisons.find(c=>c.id==='688677'),a=c.audit,p=a.products;
  near(p.current.reduce((s,x)=>s+x,0),a.periods[1].revenue);
  near(p.prior.reduce((s,x)=>s+x,0),a.periods[0].revenue);
  near(p.cost.reduce((s,x)=>s+x,0),a.periods[1].cost);
  near(p.largestCustomer/a.periods[1].revenue,.701459353550748);
  assert.notEqual(p.largestCustomer/a.periods[1].revenue,p.largestReceivableShare);
  assert.ok(p.current[2]/p.prior[2]-1<.002);
  assert.ok((p.current[2]+p.current[3])/p.prior[2]-1<.11);
  assert.equal(p.repairGrowthReconciled,false);
  assert.equal(p.reportedRepairGrowthApprox,.3);
  assert.equal(p.newOpticsGrossMarginVerified,null);
  assert.equal(p.expected2026Units,100000);
  assert.ok(p.expected2026Units<p.newOpticsOrderUnits);
  assert.ok(p.ownBrand2025Selling+p.ownBrand2025Research>p.ownBrand2025BroaderScope);
  for(const parts of p.scenarioParts) near(Object.entries(parts).filter(([k])=>k!=='id').reduce((s,[,v])=>s+v,0),a.scenarios.find(s=>s.id===parts.id).revenue);
});

test('Novelbeam treasury-funded awards restore outstanding shares once and financing uses a separate denominator', () => {
  const c=data.comparisons.find(c=>c.id==='688677'),a=c.audit,k=a.capital,f=a.funding;
  near(k.registered-k.treasuryAfter,k.outstanding);
  near(k.treasuryBefore+k.newBuyback,k.treasuryAfter);
  near(k.outstanding+k.treasuryResaleAssumed+k.granted+k.reservedNotGranted+k.futureAwardsAssumed,k.preFinancingShares);
  near(k.registered+k.newAwardIssuedAssumed,k.preFinancingShares);
  assert.equal(k.postJuneFullAwardLedgerVerified,false);
  assert.equal(k.granted,.8);assert.equal(k.reservedNotGranted,.2);
  assert.ok(!Object.hasOwn(k,'controllerIssuance'),'shareholder transfers do not finance the issuer');
  for(const s of a.scenarios) {
    near(s.shares,k.preFinancingShares+f.paths[s.id].netRaise/(1-f.feeRate)/c.price.value);
    const company={price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}};
    near(M.project(company,s).price,s.revenue*s.margin*s.pe/s.shares);
  }
  for(const h of a.hurdleCases) {
    const revenue=c.price.value*10*h.shares/h.margin/h.pe;
    near(revenue*h.margin*h.pe/h.shares/c.price.value,10);
  }
});

test('Novelbeam cash restrictions, lagged dividends and low-price funding stress reconcile', () => {
  const c=data.comparisons.find(c=>c.id==='688677'),a=c.audit,f=a.funding,k=a.capital;
  near(f.startCash,f.cashAtJune-f.ipoBankReserved-f.temporaryFundsReturnReserved-f.debtAndLeaseCarryingReserved-f.postJuneBuyback-f.uncalledFundReserved+f.h2FreeCashAssumed);
  near(f.openingNetRaise,19.73175716);
  for(const [id,path] of Object.entries(f.paths)) {
    let cash=f.startCash+f.openingNetRaise,previousRevenue=f.anchorRevenueAssumed,previousNet=680*.23,raised=f.openingNetRaise;
    for(const y of path.years) {
      near(y.net,y.revenue*y.margin);near(y.da,y.revenue*f.daRatio);
      near(y.workingCapital,(y.revenue-previousRevenue)*f.workingCapitalRatio);
      near(y.dividend,id==='bear'?0:previousNet*.3);
      near(y.fcf,y.net+y.da-y.capex-y.workingCapital-y.dividend-f.newLeaseCashPerYear);
      near(y.netRaise,Math.max(0,f.minimumCash-cash-y.fcf));
      cash+=y.fcf+y.netRaise;raised+=y.netRaise;near(y.cashEnd,cash);
      previousRevenue=y.revenue;previousNet=y.net;
    }
    near(path.netRaise,raised);
  }
  let stress=f.startCash+f.openingNetRaise,previousRevenue=f.anchorRevenueAssumed,raised=f.openingNetRaise;
  for(const y of f.years) {
    near(y.stressFcf,y.revenue*(y.margin-f.stressMarginReduction)+y.da-y.capex-f.stressExtraCapexPerYear-(y.revenue-previousRevenue)*f.stressWorkingCapitalRatio-f.newLeaseCashPerYear);
    near(y.stressNetRaise,Math.max(0,f.minimumCash-stress-y.stressFcf));
    stress+=y.stressFcf+y.stressNetRaise;raised+=y.stressNetRaise;
    near(stress,y.stressCashEnd);previousRevenue=y.revenue;
  }
  near(raised,f.stressNetRaise);near(raised,421.73175716);
  for(const x of f.priceCases) {
    near(x.financingShares,raised/(1-f.feeRate)/x.price);
    near(x.futureAwardShares,Math.max(k.futureAwardsAssumed,k.futureAwardValueStress/x.price));
    near(x.totalShares,k.outstanding+k.treasuryResaleAssumed+k.granted+k.reservedNotGranted+x.futureAwardShares+x.financingShares);
    near(x.priceMultiple,2200*.19*22.5/x.totalShares/c.price.value);
  }
  assert.ok(f.priceCases.at(-1).priceMultiple<f.priceCases[0].priceMultiple);
  const bull=a.scenarios.find(s=>s.id==='bull');
  near(f.paths.bull.dividendCash,427.62);
  near(f.bullDividendPerOriginalShareConservative,427.62/bull.shares);
  near(f.bullWealthMultiple,(2200*.27*30/bull.shares+427.62/bull.shares)/c.price.value);
});

test('Novelbeam new dossier exposes the evidence gaps and scenarios in both outputs', () => {
  const c=data.comparisons.find(c=>c.id==='688677'),sourceIds=new Set(data.sources.map(s=>s.id));
  c.sources.forEach(id=>assert.ok(sourceIds.has(id)));
  c.audit.sections.flatMap(s=>s.sources).forEach(id=>assert.ok(sourceIds.has(id)));
  const q=quotes.find(q=>q.symbol===c.price.symbol);
  near(c.price.value,Math.round(q.observations.at(-1).close*100)/100);
  assert.equal(q.observations.at(-1).date,'2026-10-16');
  const f=fixture();f.H.market='cn';f.api.handleInput({value:'688677'});f.H.render();f.click('potential-comparisons');
  const md=fs.readFileSync('docs/research/potential-stocks-2026-10-18.md','utf8').split('海泰新光 · 688677').at(-1);
  for(const output of [f.modal,md]) {
    assert.match(output,/维修披露存在未解释差异/);
    assert.match(output,/70\.15%/);assert.match(output,/93\.05/);
    assert.match(output,/低利润、垫资与低价融资压力/);
    assert.match(output,/2\.36×/);
    assert.match(output,/2032年分红未计入/);
    assert.doesNotMatch(output,/NaN|undefined/);
  }
});

test('Cohu reconciles GAAP earnings, amortization and cash without treating withholding as a buyback', () => {
  const a=data.comparisons.find(c=>c.id==='COHU').audit,p=a.periods.at(-1),e=a.earnings,f=a.cash;
  near(p.revenue-p.cost-e.research-e.sga-e.purchasedAmortization-e.restructuring,p.operating);
  near(p.operating-e.interestExpense+e.interestIncome-e.fxLoss-e.tax,p.net);
  near(p.net+e.cashAdjustments.reduce((sum,x)=>sum+x,0),p.operatingCash);
  near(1-(p.cost+e.costRelatedAmortization)/p.revenue,.421886685077028);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(-f.investmentPurchases+f.investmentMaturities+f.hedgeSettlement-f.capex+f.ppeSale,f.investing);
  near(-f.employeeTaxNetEspp+f.revolvingNet-f.debtRepaid,f.financing);
  near(f.operating-f.capex-f.capexPrepaid,16.426);
  assert.match(a.cashNote,/并非市场回购/);
  near(a.sections.find(s=>s.title==='利润到现金：增长也占用营运资金').rows.reduce((sum,r)=>sum+r[1],0),f.operating);
});

test('Cohu keeps non-system revenue, subscription fees, orders and opportunity stages distinct', () => {
  const a=data.comparisons.find(c=>c.id==='COHU').audit,p=a.products;
  near(p.systemsH1+p.nonSystemsH1,a.periods.at(-1).revenue);
  near(p.nonSystemsFY25-p.nonSystemsPriorH1+p.nonSystemsH1,p.ltmNonSystems);
  near(p.history.at(-1).revenue-a.periods[0].revenue+a.periods[1].revenue,p.ltmRevenue);
  assert.equal(p.softwareSubscriptionTotal,null,'one customer potential fees are not company ARR');
  assert.equal(p.cumulativeUnfilledOrders,null,'two dated announcements do not establish current backlog');
  near(p.aprilSubscriptionPotentialAnnual,.330);
  near(p.systemsPipelineApprox+p.recurringPipelineApprox,p.pipelineApprox);
  assert.ok(p.notContributingOpportunityRange[0]>p.hpcGuidance[1]);
  assert.ok(p.serviceLtmApprox<p.ltmNonSystems,'services are included in recurring business');
});

test('Cohu reserves cash principal and uses the same-date equity award ledger', () => {
  const c=data.comparisons.find(c=>c.id==='COHU'),s=c.audit.capital;
  near(s.issued-s.treasury,s.outstandingJune);
  near(c.shares,s.coverOutstanding);
  assert.equal(c.shareDate,s.coverDate);
  near(s.principal+s.otherDebtPrincipal.reduce((sum,x)=>sum+x,0),s.totalDebtPrincipal);
  near(s.totalDebtPrincipal-s.debtDiscount-s.currentDebt,s.longDebtCarrying);
  near(s.outstandingJune+s.rsu+s.psuTarget*s.psuMaxFactor+s.assumedFutureAwardsAndEspp,s.preConversionShares);
  assert.equal(s.psuMaxFactor,2);
  assert.equal(s.postJuneConversions,null,'conversion eligibility is not actual conversion');
  assert.equal(s.postJuneShareReconciliation,null);
  assert.ok(s.maturity<data.horizonDate,'principal matures before the five-year terminal date');
  assert.ok(s.preConversionShares<s.authorized,'authorization is not issued capital');
});

test('Cohu capped call dilution changes at the strike and cap and the tenfold hurdle recomputes shares', () => {
  const c=data.comparisons.find(c=>c.id==='COHU'),a=c.audit,s=a.capital;
  near(s.underlyingShares*s.strikePrice,s.principal);
  for(const row of s.conversionPriceCases) {
    near(row.excessShares*row.price,Math.max(s.underlyingShares*row.price-s.principal,0));
    near(row.callShareEquivalent*row.price,row.callValue);
    near(row.incrementalShares,row.excessShares-row.callShareEquivalent);
    if(row.price<=s.capPrice) near(row.incrementalShares,0);
    else near(row.incrementalShares*row.price,s.underlyingShares*(row.price-s.capPrice));
  }
  for(const row of s.settlementCases) {
    const scenario=a.scenarios.find(x=>x.id===row.id);
    near(row.price*row.totalShares,scenario.revenue*scenario.margin*scenario.pe);
    near(row.preConversionShares+row.incrementalShares,scenario.shares);
  }
  const hurdle=a.hurdleCases[1],bull=a.scenarios.find(x=>x.id==='bull'),target=c.price.value*10;
  near(hurdle.shares,s.preConversionShares+s.underlyingShares*(1-s.capPrice/target));
  assert.ok(hurdle.shares>bull.shares,'a tenfold price has more residual dilution than the bull price');
  near(target*hurdle.shares/hurdle.margin/hurdle.pe,5322.165027908333);
  assert.ok(a.hurdleCases[2].shares>hurdle.shares,'no hedge recovery raises the share denominator');
  assert.match(a.scenarioNote,/转换观察期均价等于2031终值价/);
});

test('Cohu financing stress reserves debt once and translates lower issue prices into additional shares', () => {
  const a=data.comparisons.find(c=>c.id==='COHU').audit,f=a.funding,s=a.capital;
  near(f.investmentsDueWithinYear+f.investmentsDueAfterYear,f.investments);
  near(f.cash+f.investments-f.reservedPrincipal-f.assumedH2NetCashUse,f.start);
  near(f.reservedPrincipal,s.totalDebtPrincipal);
  near(f.cash+f.investmentsDueWithinYear*(1-f.stressLiquidationHaircut)-f.reservedPrincipal-f.assumedH2NetCashUse,f.stressStartBeforeRaise);
  let cash=f.start,stress=f.stressStartBeforeRaise+f.openingNetRaise,previous=f.anchorRevenueAssumed,raised=f.openingNetRaise;
  for(const row of f.years) {
    near(row.net,row.revenue*row.margin);
    near(row.workingCapital,(row.revenue-previous)*f.workingCapitalRatio);
    near(row.net+row.da-row.capex-row.workingCapital,row.fcf);
    near(row.stressNet+row.da-row.stressCapex-row.stressWorkingCapital,row.stressFcf);
    cash+=row.fcf;stress+=row.stressFcf+row.netRaise;raised+=row.netRaise;
    near(cash,row.cashEnd);near(stress,row.stressCashEnd);
    assert.ok(stress>=f.minimumCash);previous=row.revenue;
  }
  near(raised,f.totalNetRaise);near(raised,267.7116);
  for(const row of f.priceCases) {
    near(row.newShares*row.issuePrice*(1-f.feeRate),raised);
    near(row.preConversionShares,s.preConversionShares+row.newShares);
    near(row.totalShares*row.price,1500*row.stressTerminalMargin*row.stressTerminalPe);
  }
  assert.ok(f.priceCases[2].newShares>f.priceCases[0].newShares);
  assert.ok(f.priceCases[2].priceMultiple<f.priceCases[0].priceMultiple);
});

test('Cohu records issuer historical-price provenance instead of labeling it a Yahoo raw quote', () => {
  const c=data.comparisons.find(c=>c.id==='COHU'),q=quotes.find(x=>x.symbol==='COHU');
  assert.equal(q.basis,'issuer_historical_close');
  assert.equal(c.price.url,q.sourceUrl);
  assert.match(q.sourceUrl,/ir\.cohu\.com/);
  near(q.observations.at(-1).close,50.81);
  assert.ok(q.observations.every(x=>x.splitFactor==='1:1'));
});

test('PDF Solutions reconciles cash, capitalized compensation, primary issuance and debt maturities', () => {
  const c=data.comparisons.find(c=>c.id==='PDFS'),a=c.audit,f=a.cash,s=a.capital;
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(-f.capex-f.capexPrepaid,f.investing);
  near(f.operating-f.capex-f.capexPrepaid,-6.507);
  near(f.issueNet+f.equityPlanCash-f.rsuTaxes-f.debtRepaid-f.debtIssueCosts,f.financing);
  near(f.sbcExpense+f.sbcCapitalized,f.sbcEquity);
  near(s.issued-s.treasury,s.outstanding);
  near(s.rsuStart+s.rsuGranted-s.rsuVested-s.rsuForfeited,s.rsuEnd);
  assert.ok(Math.abs(s.newIssue*s.offerPrice-f.issueNet-f.issueCosts)<.001, 'primary proceeds reconcile within thousands rounding');
  assert.notEqual((s.newIssue+s.secondarySale)*s.offerPrice,f.issueNet+f.issueCosts, 'selling holder proceeds are not issuer funding');
  near(s.debtMaturities.reduce((sum,v)=>sum+v,0),s.debtPrincipal);
  near(s.debtPrincipal-s.debtDiscount,s.debtCarrying);
  near(c.shares,s.coverOutstanding);
  assert.equal(c.shareDate,s.coverDate);
  assert.match(c.shareBasis,/日期不同不机械相加/);
  assert.match(a.cashNote,/未担保残值/);
});

test('Dinglong separates acquisition cash, disposal cash, minorities and convertible dilution', () => {
  const c=data.comparisons.find(c=>c.id==='300054'),a=c.audit,f=a.cash,s=a.capital,b=a.acquisition;
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.investRecovered+f.investIncome+f.ppeDisposals-f.capex-f.investPaid-f.acquisitionNet-f.otherInvesting,f.investing);
  near(f.equityCash+f.borrowed-f.debtRepaid-f.dividendsAndInterest-f.leaseCash,f.financing);
  near(f.disposalNetOut+f.otherInvestingRest,f.otherInvesting);
  near(f.operating-f.capex,276.50575984);
  near(b.cashPaid-b.acquiredCash,f.acquisitionNet);
  near(b.consideration-b.netAssetsAttributable,b.goodwill);
  assert.equal(b.netIncome,null,'redacted acquiree earnings must remain unknown');
  assert.equal(b.operatingCash,null,'redacted acquiree cash must remain unknown');
  near(s.juneRegistered+s.q3ConvertedShares+s.q3OtherIncrease,s.septRegistered);
  near(c.shares,s.septRegistered);
  near(s.convertibleFace/s.conversionPrice,32.04892177589852);
  assert.match(c.shareBasis,/含138.562万股回购专户股份/);
  assert.match(a.cashNote,/不能再从净现金重复扣一次/);
  assert.ok(a.sections.some(s=>s.paragraphs.some(p=>p.includes('未来转股不能再计一次现金'))));
  const forecast=a.preliminary;
  assert.equal(forecast.asOf,'2026-10-09');
  assert.equal(forecast.audited,false);
  assert.equal(forecast.operatingCash,null,'earnings guidance cannot fill a missing quarter cash flow');
  near(forecast.parentNetRange[0]-forecast.adjustedNetRange[0],forecast.nonRecurringApprox);
  near(forecast.parentNetRange[1]-forecast.adjustedNetRange[1],forecast.nonRecurringApprox);
  near(c.anchorRevenue,forecast.revenueApprox*4/3);
  near(forecast.photoresistApprox,10.24);
  assert.ok(a.periods.every(p=>p.label!=='2026前三季度'),'preliminary results stay separate from statement periods');
});

test('comparison scenarios and tenfold hurdles use their own diluted denominators', () => {
  for(const id of ['PDFS','300054','RDW','603061','COHU']) {
    const c=data.comparisons.find(c=>c.id===id),a=c.audit;
    const company={price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}};
    assert.deepEqual(a.scenarios.map(s=>s.id),['bear','base','bull']);
    for(const s of a.scenarios) {
      const p=M.project(company,s);
      near(p.price,(s.margin>0?s.revenue*s.margin*s.pe:s.equityValue)/s.shares);
      near(p.capitalMultiple/(s.shares/c.shares),p.priceMultiple);
      assert.equal(p.revenueCagr,null,'H1 scale references do not silently become full-year growth forecasts');
    }
    const bull=a.scenarios.find(s=>s.id==='bull');
    near(a.sections.at(-1).rows.reduce((sum,r)=>sum+r[1],0),bull.revenue);
    for(const h of a.hurdleCases) {
      const revenue=c.price.value*10*h.shares/h.margin/h.pe;
      near(M.project(company,{...h,revenue,dividends:0}).priceMultiple,10);
    }
    near(M.project(company,{...bull,pe:bull.pe*.75,shares:bull.shares*1.2}).priceMultiple,M.project(company,bull).priceMultiple*.75/1.2);
  }
});

test('new comparison dossiers expose financial evidence and scenario conditions', () => {
  const f=fixture();
  for(const [id,market,name,amount,source] of [['PDFS','us','PDF Solutions','4.59','pdfs20260630_10q'],['300054','cn','鼎龙股份','2.39','1225596727'],['RDW','us','Redwire','4.19','000181981026000124'],['603061','cn','金海通','1.65','12607453.PDF'],['COHU','us','Cohu','2.91','cohu20260627_10q']]) {
    f.H.market=market;
    f.api.handleInput({value:id});f.H.render();f.click('potential-comparisons');
    assert.match(f.modal,new RegExp(name));
    assert.match(f.modal,/查看报表利润与现金/);
    assert.ok(f.modal.includes(amount+'×'));
    assert.match(f.modal,/2031年终值/);
    assert.match(f.modal,/十倍反算/);
    assert.ok(f.modal.includes(source));
    assert.doesNotMatch(f.modal,/undefined|NaN/);
  }
});

test('JHT reconciles reported profit, working capital and all cash activities', () => {
  const a=data.comparisons.find(c=>c.id==='603061').audit,p=a.periods.at(-1),e=a.earnings,f=a.cash;
  near(p.revenue-p.cost-e.surcharge-e.selling-e.admin-e.research-e.finance+e.otherIncome+e.investment+e.fairValue+e.creditLoss+e.assetLoss+e.disposal,p.operating);
  near(p.operating+e.nonOperatingIncome-e.nonOperatingExpense-e.tax,p.net);
  near(p.net+e.cashAdjustments.reduce((sum,v)=>sum+v,0),p.operatingCash);
  near(e.cashAdjustments.at(-1),e.sbc);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.investRecovered+f.investIncome+f.assetDisposals-f.investPaid-f.capex,f.investing);
  near(f.borrowed-f.debtRepaid-f.dividendAndInterest-f.leaseCash-f.issueFeePrepaid,f.financing);
  near(f.operating-f.capex,-66.90175688);
});

test('JHT separates dated preliminary earnings, capacity moves and existing employee shares', () => {
  const c=data.comparisons.find(c=>c.id==='603061'),a=c.audit,p=a.products,s=a.capital,r=a.collections;
  near(p.mix.reduce((sum,x)=>sum+x.revenue,0),p.h1DeviceRevenueApprox);
  near(p.deviceAverageDerived*p.h1Sales,p.h1DeviceRevenueApprox);
  near(p.h1DeviceRevenueApprox+p.h1OtherRevenueDerived,a.periods.at(-1).revenue);
  const cap=p.capacity;
  near(cap.tianjinPlanned+cap.malaysiaPlanned+cap.newShanghaiPlanned,cap.oldMovedTotal);
  near(cap.oldMovedTotal+cap.oldShanghai,cap.oldRetainedTotal);
  for(const v of p.scenarioUnits) near(v.units*v.price+v.partsAndOther,a.scenarios.find(s=>s.id===v.id).revenue);
  near(s.preTransfer*s.transferFactor,c.shares);
  assert.ok(Math.abs(s.esopBeforeTransfer*s.transferFactor-s.esopIncluded)<=.000001,'transfer rounding within one share');
  assert.ok(s.esopUnlocked<=s.esopInitialAfterTransfer && s.esopIncluded<c.shares);
  assert.equal(s.actualConversionPrice,null,'a proposed bond has no assumed actual conversion price');
  assert.equal(c.shareDate,s.date);
  assert.equal(r.asOf,'2026-08-18');
  assert.ok(r.cohorts[0].date>r.cohorts[1].date,'collection cohorts have unequal follow-up windows');
  assert.equal(r.demoCutoff,null,'the Demo paragraph does not identify a cutoff date');
  assert.equal(r.demoBasis,'issuer_reported_amount_ratio_not_unit_win_rate');
  const q=a.preliminary;
  assert.equal(q.revenue,null);assert.equal(q.operatingCash,null);assert.equal(q.audited,false);
  assert.ok(q.asOf>c.price.asOf,'post-price disclosure is explicitly dated');
  q.parentNetRange.forEach((v,i)=>near(v-a.periods.at(-1).net,q.q3NetDerivedRange[i]));
  assert.ok(a.periods.every(p=>p.label!==q.period),'preliminary earnings do not become a complete quarterly statement');
});

test('JHT cash stress funds the deficit once and carries conversion and new-award dilution', () => {
  const c=data.comparisons.find(c=>c.id==='603061'),a=c.audit,f=a.funding;
  near(f.startCash,f.cashAtJune-f.ipoBankReservedApprox-f.shortDebtReserved-f.h2OtherCashUse);
  near(f.bondNetAssumed,f.bondGrossAssumed*(1-f.feeRate));
  let revenue=f.anchorRevenueAssumed,cash=f.startCash+f.bondNetAssumed,stress=cash;
  for(const y of f.years) {
    near(y.net,y.revenue*y.margin);near(y.da,y.revenue*f.daRatio);near(y.newSbc,y.revenue*f.newSbcRatio);
    near(y.workingCapital,(y.revenue-revenue)*f.workingCapitalRatio);
    near(y.stressWorkingCapital,(y.revenue-revenue)*f.stressWorkingCapitalRatio);
    near(y.fcf,y.net+y.da+y.newSbc-y.capex-f.leasePrincipalPerYear-y.workingCapital);
    near(y.stressFcf,y.revenue*(y.margin-f.stressMarginReduction)+y.da+y.newSbc-y.capex-f.leasePrincipalPerYear-y.stressWorkingCapital);
    near(y.netRaise,Math.max(0,f.minimumCash-stress-y.stressFcf));
    cash+=y.fcf;stress+=y.stressFcf+y.netRaise;
    near(cash,y.cashEnd);near(stress,y.stressCashEnd);assert.ok(stress>=f.minimumCash-1e-8);revenue=y.revenue;
  }
  near(f.netRaise,f.years.reduce((sum,y)=>sum+y.netRaise,0));
  near(f.futureSbc,f.years.reduce((sum,y)=>sum+y.newSbc,0));
  near(a.project.manufacturingTotal+a.project.researchTotal+a.project.workingCapital,f.bondGrossAssumed);
  for(const p of f.priceCases) {
    near(p.conversionShares,f.bondGrossAssumed/p.price);
    near(p.financingShares,f.netRaise/(1-f.feeRate)/p.price);
    near(p.awardShares,f.futureSbc/p.price);
    near(p.totalShares,c.shares+p.conversionShares+p.financingShares+p.awardShares);
  }
});

test('Redwire reconciles common earnings, cash restrictions and financing without treating equity as operating cash', () => {
  const c=data.comparisons.find(c=>c.id==='RDW'),a=c.audit,f=a.cash;
  for(const p of a.periods) {
    near(p.revenue-p.cost-p.sga-p.rd-p.transactions,p.operating);
    near(p.operating-p.interest-p.debtLoss-p.other,p.pretax);
    near(p.pretax-p.tax,p.consolidatedNet);
    near(p.consolidatedNet-p.preferredDividends,p.net);
  }
  near(a.ocfRows.reduce((sum,r)=>sum+r[1],0),f.operating);
  near(f.ppe+f.intangibles,f.capex);
  near(f.operating-f.capex,-48.043);
  near(f.borrowed-f.debtRepaid-f.debtFees-f.financeLeaseCash+f.stockProceeds-f.equityIssueFees+f.stockPlanCash-f.preferredCashDividends,f.financing);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.unrestricted+f.restricted,f.end);
  assert.notEqual(a.periods[1].preferredDividends,f.preferredCashDividends,'EPS allocation is not the cash payment period');
  near(a.earnings.edgeCost+a.earnings.edgeSga,42.531);
  near(a.periods[1].operating+42.531,-49.260);
});

test('Redwire acquisition comparisons, order rollforward and dated capital reconcile', () => {
  const c=data.comparisons.find(c=>c.id==='RDW'),a=c.audit,g=a.growth,o=a.orders,s=a.capital;
  near(g.spaceH1+g.defenseH1,g.currentH1);
  near(g.spacePriorH1+g.defensePriorH1,g.reportedPriorH1);
  near(g.currentH1/g.proformaPriorH1-1,.019155044923651277);
  assert.notEqual(g.proformaPriorH1,g.reportedPriorH1);
  near(o.start+o.additions-o.revenue+o.fx,o.end);
  near(o.space+o.defense,o.end);
  near(a.earnings.eacFavorable+a.earnings.eacUnfavorable,a.earnings.eacNet);
  near(s.decReportedCommon+s.atmIssued+s.awardIssued+s.warrantIssued+s.preferredConverted,s.juneReportedCommon);
  near(s.coverOutstanding,c.shares);
  assert.equal(c.shareDate,s.coverDate);
  near(s.debtPrincipal-s.debtDiscount,s.debtCarrying);
  near(s.psuTarget*s.psuMaximumFactor,2.024418);
  assert.equal(s.preferredRemaining,0);
  assert.equal(s.privateExpiryOutcome,null,'an elapsed expiry date is not evidence of settlement or cash proceeds');
  assert.equal(a.funding.startCash,a.cash.unrestricted,'restricted cash and undrawn credit cannot fund the scenario');
});

test('Redwire annual cash shortfalls link to net issuance prices and persistent compensation dilution', () => {
  const c=data.comparisons.find(c=>c.id==='RDW'),f=c.audit.funding;
  let cash=f.startCash-f.h2CashUse-f.debtReserved,stressCash=cash,prior=f.anchorRevenue;
  for(const p of f.years) {
    near(p.net,p.revenue*p.margin);
    near(p.da,p.revenue*f.daRatio);
    near(p.sbc,p.revenue*f.sbcRatio);
    near(p.capex,p.revenue*f.capexRatio);
    near(p.workingCapital,(p.revenue-prior)*f.workingCapitalRatio);
    near(p.stressWorkingCapital,(p.revenue-prior)*f.stressWorkingCapitalRatio);
    near(p.fcf,p.net+p.da+p.sbc-p.workingCapital-p.capex);
    near(p.stressFcf,p.net-p.revenue*f.stressMarginReduction+p.da+p.sbc-p.stressWorkingCapital-p.capex);
    cash+=p.fcf;stressCash+=p.stressFcf;
    near(p.netRaise,Math.max(0,f.minimumCash-stressCash));
    stressCash+=p.netRaise;near(p.cashEnd,cash);near(p.stressCashEnd,stressCash);
    prior=p.revenue;
  }
  near(f.years.reduce((sum,p)=>sum+p.netRaise,0),f.netRaise);
  near(f.years.reduce((sum,p)=>sum+p.sbc,0),f.futureSbc);
  for(const p of f.priceCases) {
    near(p.financingShares*p.price*(1-f.feeRate),f.netRaise);
    near(p.awardShares*p.price,f.futureSbc);
    near(c.shares+f.knownAwardStress+p.financingShares+p.awardShares,p.totalShares);
  }
  assert.ok(f.priceCases[1].totalShares>f.priceCases[0].totalShares,'lower issue and grant prices increase dilution');
  assert.equal(f.basis,'research_assumptions_not_guidance');
});

test('Redwire loss valuation and restricted cash labels survive both dossier renderers', () => {
  const f=fixture();f.H.market='us';f.api.handleInput({value:'RDW'});f.H.render();f.click('potential-comparisons');
  const md=fs.readFileSync(require('node:path').join(__dirname,'../docs/research/potential-stocks-2026-10-18.md'),'utf8');
  for(const rendered of [f.modal,md]) {
    assert.match(rendered,/普通股股东净利/);
    assert.match(rendered,/期末现金、等价物及受限现金/);
    assert.match(rendered,/亏损残值法/);
    assert.match(rendered,/3亿美元普通股残值/);
    assert.match(rendered,/311\.658/);
    assert.doesNotMatch(rendered,/NaN|undefined/);
  }
});

test('Innodata reconciles GAAP earnings and cash without treating project funds as recurring free cash', () => {
  const c=byId('INOD'),a=c.dataServiceAudit,f=a.cash;
  for (const p of a.periods) {
    near(p.revenue-p.cost-p.sga,p.operating);
    near(p.operating+p.interest,p.pretax);
    near(p.pretax-p.tax,p.net);
  }
  near(a.ocfRows.reduce((sum,[,v])=>sum+v,0),164.441);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(-f.capex-f.investmentPurchases,f.investing);
  near(f.optionCash+f.rsuTax+f.obligationPayments,f.financing);
  near(f.end+f.shortInvestments,250.371);
  near(f.end+f.shortInvestments-f.advances-f.unpaidProjectCosts,121.609);
  near(f.managementNetCash-121.609,12.391);
  assert.match(a.cashNote,/期末负债不等于本期现金流/);
  assert.match(c.financials.operatingCashNote,/项目款/);
  assert.match(c.financials.anchorLabel,/指引下限/);
  near(c.financials.anchorRevenue,352.3282);
  assert.ok(a.periods[2].net/a.periods[2].revenue < .22);
});

test('Innodata maximum PRSUs reconcile across filings and are not doubled or counted as treasury shares', () => {
  const c=byId('INOD'),s=c.dataServiceAudit.capital;
  near(s.juneIssued-s.juneTreasury,s.juneOutstanding);
  near(s.marchOrdinaryRsu+s.marchPerformanceRsu,s.proxyMaximumFullValueAwards);
  near(s.marchPerformanceRsu,s.performanceRsu);
  assert.equal(s.performanceBasis,'maximum');
  near(s.juneOptions.reduce((sum,p)=>sum+p.shares,0)+s.ordinaryRsu+s.performanceRsu,c.shares.knownPotential);
  near(c.shares.knownPotential,2.336011);
  near(c.shares.value,34.382651);
  assert.ok(c.shares.value<s.juneIssued);
  assert.match(c.shares.gap,/不是10月股本/);
  assert.match(c.dataServiceAudit.shareNote,/不另加高管子集或再乘2/);
});

test('Innodata gross ATM proceeds determine new shares while commission reduces cash only', () => {
  const c=byId('INOD'),bull=M.scenario(c,'bull');
  const low=M.dataServiceFunding(c,25),mid=M.dataServiceFunding(c,50),high=M.dataServiceFunding(c,75);
  near(low.newShares,12); near(mid.newShares,6); near(high.newShares,4);
  for(const x of [low,mid,high])near(x.netProceeds,294);
  near(mid.shares,45.712011); near(low.shares,51.712011);
  assert.ok(mid.shares < bull.shares && low.shares > bull.shares);
  assert.ok(M.project(c,{...bull,shares:low.shares}).priceMultiple < M.project(c,bull).priceMultiple);
  const hurdle=M.hurdle(c,bull);
  near(hurdle.revenue,3761.4242424242425);
  assert.ok(M.project(c,bull).priceMultiple < 10);
  assert.match(c.marketTest.assumptions,/不能再作为第四项重复相加/);
  assert.match(c.marketTest.boundary,/不是可验证市场份额/);
  assert.throws(()=>M.dataServiceFunding(c,0),RangeError);
  assert.throws(()=>M.dataServiceFunding({...c,dataServiceAudit:{capital:{...c.dataServiceAudit.capital,commissionMax:1}}},50),RangeError);
});

test('Tiancheng cash and treasury-funded old vesting stay separate from its new incentive targets and H-share plans', () => {
  const c=data.comparisons.find(c=>c.id==='688603'),a=c.audit,f=a.cash,s=a.capital;
  near(a.products.reduce((v,p)=>v+p.revenue,0),a.financials.revenue);
  near(a.products.reduce((v,p)=>v+p.cost,0),a.financials.cost);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.investmentRecovered+f.investmentIncome-f.investmentPaid-f.capex,f.investing);
  near(f.borrowed-f.repaid-f.dividendsInterest-f.otherFinancing,f.financing);
  near(f.end+f.restricted,f.monetary);
  near(f.operating-f.capex,-18.37101017);
  near(c.shares,s.registered);
  near(s.oldTreasuryTransferred,.136113);
  assert.match(c.shareBasis,/未改变总股本/);
  near(s.firstGrant+s.reserve,s.totalPlan);
  near(s.expenseByYear.reduce((v,x)=>v+x,0),s.expenseTotal);
  assert.deepEqual(s.targets.map(p=>p.revenue),[700,1050,1575,2363]);
  assert.match(c.anchorLabel,/非业绩指引/);
  assert.equal(s.hShareStatus,'planning_terms_unknown');
  assert.equal(s.source,'new_shares_and_or_treasury');
  near(a.scaleExample.revenue,5316.75);
  const p=M.project({price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}},{...a.scaleExample,dividends:0});
  near(p.price,250.64678571428573);
  assert.ok(p.priceMultiple < 3);
  near(c.price.value*10*140/.22/30,19203.333333333332);
});

test('new research details expose the cash caveat, share stress, comparison targets and original evidence', () => {
  const f=fixture();
  assert.match(f.html,/Innodata/);
  assert.match(f.html,/含客户项目款流入/);
  f.click('potential-detail','INOD');
  assert.match(f.modal,/GAAP盈利与项目现金/);
  assert.match(f.modal,/121\.609/);
  assert.match(f.modal,/12\.391/);
  f.click('potential-detail-tab','scenarios');
  assert.match(f.modal,/最大业绩RSU/);
  assert.match(f.modal,/51\.712011/);
  assert.match(f.modal,/45\.712011/);
  assert.match(f.modal,/独立客户组年度收入假设/);
  f.click('potential-detail-tab','evidence');
  assert.match(f.modal,/2024-11/);
  assert.match(f.modal,/tm261509d1_def14a/);
  assert.doesNotMatch(f.modal,/undefined|NaN/);
  f.click('potential-comparisons');
  assert.match(f.modal,/Aehr Test Systems/);
  assert.doesNotMatch(f.modal,/天承科技/);
  f.H.market='cn';f.H.render();
  f.click('potential-comparisons');
  assert.match(f.modal,/新产业/);
  assert.match(f.modal,/天承科技/);
  assert.match(f.modal,/23\.63/);
  assert.match(f.modal,/1575|15\.75/);
  assert.match(f.modal,/H股尚未给出发行规模/);
  assert.match(f.modal,/1225606038/);
  assert.doesNotMatch(f.modal,/Aehr Test Systems|undefined|NaN/);
  f.api.handleInput({value:'688603'});f.H.render();
  f.click('potential-comparisons');
  assert.match(f.modal,/天承科技/);
  assert.doesNotMatch(f.modal,/新产业/);
});

test('Ouster compares both reported and combined historical revenue without inventing software ARR', () => {
  const c = byId('OUST'), a = c.sensingAudit;
  assert.equal(a.unit, 'million_USD');
  for (const r of a.revenue) {
    near(r.product + r.royalty, r.reported);
    near(r.priorProduct + r.priorRoyalty, r.priorReported);
    assert.ok(r.proforma / r.priorProforma < r.reported / r.priorReported);
  }
  near(a.revenue[1].reported, c.financials.revenue);
  near(a.revenue[1].proforma-a.revenue[1].reported, 1.985);
  near(a.revenue[1].proforma/a.revenue[1].priorProforma-1, .4247267407999349);
  assert.match(a.proformaNote, /不是Gemini或BlueCity订阅收入/);
  assert.match(a.software.recognition, /永久或定期功能性许可/);
  assert.match(a.software.recognition, /维护期/);
  assert.doesNotMatch(c.marketTest.headline + c.thesis.join(' ') + c.scenarios.map(s=>s.story).join(' '), /软件收费未获证实|软件无法收费/);
});

test('Ouster reconciles cash, acquisition and receivables without deducting an unreceived refund twice', () => {
  const c = byId('OUST'), a = c.sensingAudit, f = a.cash;
  near(a.cashRows.reduce((sum,[,v])=>sum+v,0),f.operating);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.endIncludingRestricted);
  near(-f.capex-f.investmentPurchases+f.investmentMaturities-f.acquisitionNet,f.investing);
  near(f.atmNetLine-f.extraAtmFees+f.espp+f.options+f.employeeTaxReceipts,f.financing);
  near(f.cashEquivalents+f.restrictedCurrent+f.restrictedNoncurrent,f.endIncludingRestricted);
  near(f.cashEquivalents+f.shortInvestments,c.financials.cash);
  near(f.tariffCashReceived+f.tariffUnreceivedRounded,f.tariffProfitBenefit);
  near(f.operating-f.tariffCashReceived,-20.639);
  near(f.operating-f.tariffCashReceived-f.capex,-25.848);
  assert.notEqual(f.tariffCashReceived,f.tariffProfitBenefit);
  const q=a.acquisition;
  near(q.cashConsideration-q.acquiredCash,f.acquisitionNet);
  near(q.cashConsideration+q.stockConsideration,q.totalConsideration);
  near(q.netAssets+q.goodwill,q.totalConsideration);
  assert.ok(q.indemnificationCap < q.taxLiability);
  const k=a.contracts;
  near(k.start+k.deferred+k.acquired-k.recognized,k.end);
  near(k.licenseCurrent+k.licenseNoncurrent+k.otherCurrent+k.otherNoncurrent,k.end);
  assert.match(k.note,/不能充作软件ARR/);
});

test('Ouster share rollforward excludes already issued acquisition shares and later option conversions', () => {
  const c=byId('OUST'), s=c.sensingAudit.shares;
  near(s.juneIssued+s.julyIssued+s.julyDirector,s.julyTotal);
  near(s.julyTotal/1e6,c.shares.value);
  near(s.options+s.rsu+s.espp+s.amazon+s.issuedService,s.totalAntidilutive);
  near((s.totalAntidilutive-s.issuedService)/1e6,c.shares.knownPotential);
  near(s.optionTranches.reduce((sum,r)=>sum+r.shares,0),s.options);
  assert.equal(s.augExercise,100000);
  assert.equal(s.octDirector,779);
  assert.ok(s.amazonExpiry < data.horizonDate);
  const index=JSON.parse(fs.readFileSync('docs/research/ouster-filings-2026-10-18.json'));
  assert.equal(index.records.length,31);
  assert.equal(index.records.length,s.directoryCount);
  assert.equal(new Set(index.records.map(r=>r.accessionNumber)).size,31);
  for(const r of index.records) {
    assert.match(r.sha256,/^[a-f0-9]{64}$/);
    assert.ok(r.bytes>0 && r.filingDate>=index.from && r.filingDate<=index.through);
    assert.match(r.url,/^https:\/\/www.sec.gov\/Archives\/edgar\//);
  }
  for(const [form,count] of Object.entries(index.counts)) assert.equal(index.records.filter(r=>r.form===form).length,count);
});

test('Ouster retail contract price constrains a sensitivity, not an assumed count of paid sites', () => {
  const a=byId('OUST').sensingAudit, s=a.softwareStress, k=a.customerContract;
  near(k.subscriptionRetailPrice,s.retailAnnualFee);
  near(s.annualRevenueTarget,byId('OUST').marketTest.parts.find(p=>p.kind==='annual_revenue').revenue);
  assert.deepEqual(s.realizationFractions.map(r=>s.annualRevenueTarget*1e6/(s.retailAnnualFee*r)),[90000,112500,150000]);
  assert.equal(k.estimatedValue,6);
  assert.equal(k.termMonths,60);
  assert.equal(k.terminationNoticeDays,30);
  assert.match(k.note,/不是Ouster厂家净收入/);
  assert.match(k.note,/硬性购买下限/);
  assert.match(s.note,/无已证实的一一关系/);
  assert.match(a.commercial.find(r=>r.label==='犹他州扩单').boundary,/不能写成全部完成/);
});

test('Pumen price-volume evidence keeps new domestic installations distinct from overseas sell-in', () => {
  const c = byId('688389'), a = c.diagnosticAudit;
  assert.equal(a.unit, 'million_CNY');
  near(a.mainRevenue.find(p=>p.label==='诊断试剂').current, 528.3995);
  assert.ok(Math.abs(a.mainRevenue.reduce((s,p)=>s+p.current,0)-a.mainRevenueTotal)<.0002, 'rounded source revenue allows only a small rounding difference');
  for (const p of a.products) assert.ok(Math.abs((1+p.volumeGrowth)*(1+p.priceGrowth)-1-p.revenueGrowth)<.0002, p.label);
  const ecl = a.products.find(p=>p.label==='化学发光试剂');
  assert.ok(ecl.volumeGrowth>0 && ecl.revenueGrowth<0 && ecl.priceGrowth<0);
  assert.equal(a.installations.find(p=>p.label==='化学发光境内').deviceBasis,'new_domestic_installations');
  assert.equal(a.installations.find(p=>p.label==='化学发光境外').deviceBasis,'foreign_shipments');
  assert.deepEqual(a.installations.find(p=>p.label==='特定蛋白境外').devices,[null,null]);
  near(a.reagentTargets.reduce((s,p)=>s+p.base,0),a.reagentRevenue);
  near(a.reagentTargets.reduce((s,p)=>s+p.target,0),c.marketTest.parts.find(p=>p.label==='诊断试剂').revenue);
  near((1800/a.reagentRevenue)**(1/a.targetYears)/.95-1,.291203652511568);
});

test('Pumen cash, bank debt and signed income rows reconcile without adding restricted deposits or pretax FX twice', () => {
  const c = byId('688389'), a = c.diagnosticAudit, f = a.cash;
  near(a.profitRows.reduce((s,p)=>s+p.current,0),a.history.current.netIncome);
  near(a.profitRows.reduce((s,p)=>s+p.prior,0),a.history.prior.netIncome);
  near(a.financeRows.reduce((s,p)=>s+p.current,0),23.24441347);
  near(a.financeRows.reduce((s,p)=>s+p.prior,0),-20.11832897);
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.end+f.termDeposits+f.accruedInterest+f.frozen,f.monetaryFunds);
  near(f.investmentReceipts-f.investmentPayments-f.capex+f.assetDisposalCash,f.investing);
  near(f.borrowed-f.repaid-f.dividendsAndInterest-f.otherFinancingOut,f.financing);
  near(f.shortDebtStart+f.borrowed-f.repaid,f.shortDebtEnd);
  near(f.operating-f.capex,64.66006148);
  near(c.financials.cash,f.end);
  near(c.financials.debt,f.shortDebtEnd);
  assert.ok(f.dividendsAndInterest>f.operating-f.capex);
  assert.ok(f.termDeposits>100*f.frozen, 'term deposits must not all be described as frozen cash');
  const g=a.goodwill;
  near(g.openingProvision+g.annualCharge-g.disposedImpaired,g.endingProvision);
  near(g.selected.reduce((s,p)=>s+p.impairment,0),g.endingProvision);
  near(g.endingGross-g.endingProvision,g.endingNet);
});

test('Pumen post-half filing audit advances issued-share evidence but not the date of outstanding options', () => {
  const c=byId('688389'), a=c.diagnosticAudit.shares;
  const inv=JSON.parse(fs.readFileSync('docs/research/pumen-filings-2026-10-18.json'));
  assert.equal(inv.records.length,inv.reportedTotal);
  assert.equal(inv.records.length,a.directoryCount);
  assert.equal(new Set(inv.records.map(r=>r.id)).size,28);
  assert.ok(inv.records.every(r=>r.publishedAt>='2026-07-01' && r.publishedAt<=data.reviewedAt));
  assert.equal(inv.confirmedIssuedShares.asOf,c.shares.asOf);
  assert.ok(inv.records.some(r=>r.id===inv.confirmedIssuedShares.sourceId));
  near(inv.confirmedIssuedShares.value/1e6,c.shares.value);
  assert.equal(c.shares.knownPotentialAsOf,'2026-06-30');
  assert.equal(a.q2Exercised,0);
  assert.ok(a.exercisePrices.every(p=>p>c.price.value));
  assert.match(c.shares.gap,/登记结算/);
  assert.equal(a.confirmedDate,'2026-09-04');
});

test('Aibo award rollforward includes the split, final registration and treasury shares once', () => {
  const c = byId('688050'), a = c.medicalAudit.incentives;
  assert.equal(a.unit, 'actual_shares');
  let remaining = a.originalAwards, vested = 0, canceled = 0;
  for (const r of a.rollforward) {
    near(r.opening, remaining);
    remaining = remaining * r.multiplier - r.vested - r.canceled;
    vested = vested * r.multiplier + r.vested;
    canceled = canceled * r.multiplier + r.canceled;
    near(remaining, r.remaining);
  }
  near(vested, a.adjustedVested);
  near(canceled, a.adjustedCanceled);
  near(vested + canceled + remaining, a.adjustedAwards);
  near(a.registeredBefore + a.rollforward.at(-1).vested, a.registeredAfter);
  near(a.registeredAfter / 1e6, c.shares.value);
  near(a.remaining / 1e6, c.shares.knownPotential);
  near(a.dividendEligible + a.treasury, a.registeredAfter);
  near(a.dividendEligible * a.dividendPerShare, a.cashDividend);
  assert.equal(c.shares.knownPotentialAsOf, '2026-06-30');
  near(M.scenario(c, 'bull').shares, 230);
  assert.match(c.shares.futureBasis, /未来融资|未来增股/);
  const inv = JSON.parse(fs.readFileSync('docs/research/aibo-filings-2026-10-18.json'));
  assert.equal(inv.records.length, inv.reportedTotal);
  assert.equal(new Set(inv.records.map(r => r.id)).size, inv.reportedTotal);
  assert.equal(inv.records.filter(r => r.publishedAt > '2026-06-30').length, a.postJuneCount);
  assert.ok(inv.records.every(r => r.publishedAt <= data.reviewedAt));
  assert.deepEqual(inv.pagesFetched, [1, 2, 3]);
});

test('Aibo cash reconciles net acquisition cash without double counting financing or minorities', () => {
  const c = byId('688050'), a = c.medicalAudit, f = a.cash, d = a.debt;
  near(f.acquisitionOutflow - f.acquisitionRelatedReceipt, f.acquisitionNet);
  near(f.currentCombinationsPaid - f.acquiredCash + f.priorCombinationsPaid, f.acquisitionNet);
  near(f.start + f.operating + f.investing + f.financing + f.fx, f.end);
  near(f.equityCash + f.borrowed + f.otherFinanceIn - f.repaid - f.dividendsAndInterest - f.otherFinanceOut, f.financing);
  near(f.operating - f.capex, 42.06008660);
  near(f.end, c.financials.cash);
  near(f.operating, c.financials.operatingCash);
  const bank = i => d.short[i] + d.long[i] + d.currentLong[i];
  near(bank(0), c.financials.debt);
  near(bank(0) - bank(1), f.borrowed - f.repaid + d.bankNonCashIncrease - d.bankNonCashDecrease);
  near(bank(0) - d.cash[0], 549.37447281);
  assert.ok(bank(1) - d.cash[1] < 0);
  assert.ok(f.minorityPurchases < f.otherFinanceOut);
  assert.ok(f.acquisitionNet > 15 * (f.operating - f.capex));
});

test('Aibo product mix and acquired goodwill reconcile while source limitations remain visible', () => {
  const c = byId('688050'), a = c.medicalAudit, h = a.history, g = a.goodwill, p = a.project;
  near(a.products.reduce((sum, r) => sum + r.revenue, 0), c.financials.revenue);
  near(a.products.reduce((sum, r) => sum + r.cost, 0), a.totalCost);
  near(h.annual.revenue + h.current.revenue - h.prior.revenue, 1628.77845593);
  near(h.annual.netIncome + h.current.netIncome - h.prior.netIncome, 237.46452554);
  for (const x of a.acquisitions) {
    near(x.cashCost + x.previousInterest, x.cost);
    near(x.cost - x.netAssetsShare, x.goodwill);
  }
  near(a.acquisitions.reduce((sum, x) => sum + x.goodwill, 0), g.additions);
  near(g.startGross + g.additions, g.endGross);
  near(g.endGross - g.impairmentBalance, g.net);
  near(a.commitment.targets.reduce((s, v) => s + v, 0), a.commitment.cumulative);
  assert.match(a.acquisitionNote, /未写经营现金流/);
  assert.match(a.acquisitionNote, /7月15日/);
  assert.match(a.commitment.note, /未经审计/);
  assert.match(a.commitment.note, /不是全年违约/);
  near(p.historicIssueShares * p.historicIssuePrice, p.historicIssueGross);
  near(p.fundedBudget - p.spentAtJuly, 174.5939);
  assert.equal(p.newReady, '2028-10');
  assert.ok(Math.abs(p.spentAtJuly / p.fundedBudget - p.reportedProgress) < .00005);
});

test('Snibe rolling financials and product totals use matching reporting periods', () => {
  const c = data.comparisons.find(c => c.id === '300832'), a = c.audit, f = a.financials;
  const trailing = key => f.annual[key] + f.current[key] - f.prior[key];
  near(trailing('revenue'), c.anchorRevenue);
  near(trailing('netIncome'), 1716.88870050);
  near(trailing('adjustedNetIncome'), 1662.33716328);
  near(trailing('operatingCash') - trailing('capex'), 1639.65605545);
  for (const [i, period] of [f.current, f.prior].entries()) {
    near(a.products.rows.reduce((sum, r) => sum + r.revenue[i], 0), period.revenue);
    near(a.products.regions.reduce((sum, r) => sum + r.revenue[i], 0), period.revenue);
  }
  near(a.products.rows.reduce((sum, r) => sum + r.cost[0], 0), 704.68098521);
  const review = JSON.parse(fs.readFileSync('docs/research/' + a.filingReview.file, 'utf8'));
  assert.equal(new Set(review.announcements.map(x => x.id)).size, review.reportedTotal);
  assert.equal(review.announcements.length, a.filingReview.count);
  assert.equal(review.pages.at(-1).hasMore, false);
  assert.ok(review.announcements.every(x => x.date <= data.reviewedAt && x.url.includes('/' + x.date + '/')));
});

test('Snibe collection analysis includes the current portion of installment receivables once', () => {
  const r = data.comparisons.find(c => c.id === '300832').audit.receivables;
  for (let i = 0; i < 2; i++) {
    near(r.gross[i] - r.allowance[i], r.net[i]);
    near(r.installmentLongGross[i] - r.installmentAllowance[i], r.installmentLongNet[i]);
    near((i ? r.agingPrior : r.agingCurrent).reduce((sum, v) => sum + v, 0), r.gross[i]);
  }
  near(r.installmentLongGross[0] + r.installmentCurrentNet[0], r.installmentTotalGross);
  near(r.installmentTotalGross - r.installmentAllowance[0], 676.72684477);
  near(r.net[0] + r.installmentLongNet[0] + r.installmentCurrentNet[0], 1671.31272673);
  assert.equal(Math.round(r.topFiveAmount / r.gross[0] * 10000) / 10000, r.topFiveShare);
  assert.notEqual(r.topFiveShare, r.riskSectionTopFiveShare, 'the two filing disclosures remain separately recorded');
});

test('Snibe cash sources reconcile without erasing distinct dividend and investment bases', () => {
  const a = data.comparisons.find(c => c.id === '300832').audit, f = a.cash;
  near(Object.values(a.ocfBridge).reduce((sum, v) => sum + v, 0), f.operatingCash);
  near(f.investmentRecovered + f.investmentIncomeReceived + f.ppeDisposals - f.investmentPaid - f.capexAndIntangibles, f.investingCash);
  near(f.otherFinancingIn - f.dividendProfitInterestCashOut - f.otherFinancingOut, f.financingCash);
  near(f.buybackCashIncludingFees + f.returnedDeposit + f.leaseCash, f.otherFinancingOut);
  near(f.startCashEquivalents + f.operatingCash + f.investingCash + f.financingCash + f.fxEffect, f.endCashEquivalents);
  near(f.startMoneyBalance - f.startRestricted, f.startCashEquivalents);
  near(f.bankWealthProducts + f.derivatives, f.tradingFinancialAssets[0]);
  near(a.reconciliationGaps[0].left - a.reconciliationGaps[0].right, 4.87353610);
  near(a.reconciliationGaps[1].left - a.reconciliationGaps[1].right, .06406288);
  near(a.reconciliationGaps[2].left - a.reconciliationGaps[2].right, .06229264);
});

test('Snibe repurchased shares fund awards without a second increase to registered capital', () => {
  const c = data.comparisons.find(c => c.id === '300832'), s = c.audit.capital, a = s.award;
  near(s.buybacks.reduce((sum, b) => sum + b.shares, 0), s.treasury);
  near(s.fromMarch + s.fromAugust, a.shares);
  near(s.treasury - a.shares, s.residualTreasury);
  near(s.registered - s.treasury + a.shares + s.residualTreasury, c.shares);
  near(s.registered - s.dividend.treasury, s.dividend.eligibleShares);
  near(s.dividend.eligibleShares * s.dividend.perShare, s.dividend.grossAmount);
  near(a.expenseYears.reduce((sum, v) => sum + v, 0), a.expenseTotal);
  near(a.vesting.reduce((sum, v) => sum + v, 0), 1);
  const early = Date.parse(s.dividend.exDate), start = Date.parse(c.price.asOf);
  assert.ok(early < start, 'the already-paid dividend precedes the future-return start');
});

test('Aehr separates the fiscal transition and reconciles reported product revenue', () => {
  const a = data.comparisons.find(c => c.id === 'AEHR').audit;
  const inclusiveDays = p => (Date.parse(p.end) - Date.parse(p.start)) / 86400000 + 1;
  for (const p of a.periods) near(inclusiveDays(p), p.days);
  const [prior, transition, year, quarter] = a.periods;
  assert.equal(Date.parse(prior.end) + 86400000, Date.parse(transition.start));
  assert.equal(Date.parse(transition.end) + 86400000, Date.parse(year.start));
  assert.equal(year.start, quarter.start);
  near(year.days / 7, 52);
  near(quarter.days / 7, 13);
  near(transition.days, 28);
  const r = a.productRevenue;
  r.total.forEach((value, i) => near(r.rows.reduce((sum, p) => sum + p.values[i], 0), value));
  near(r.total[0], a.earnings.revenue);
  // Time-based service recognition is a subset, not all service revenue or contactor revenue.
  r.overTime.forEach((value, i) => assert.ok(value < r.rows.find(p => p.label === '服务').values[i]));
});

test('Aehr cash funding, tax benefits and award cancellations reconcile independently', () => {
  const c = data.comparisons.find(c => c.id === 'AEHR'), a = c.audit, e = a.earnings, f = a.cash, s = a.shareCheck;
  near(e.grossProfit - e.rd - e.sga - e.restructuring, e.operating);
  near(e.operating + e.interest + e.other, e.pretax);
  near(e.pretax + e.taxBenefit, e.net);
  near(e.q4.pretax + e.q4.taxBenefit, e.q4.net);
  near(f.atmNet + f.employeeProceeds - f.withholdingRepurchase, f.financing);
  near(-f.capex - f.acquisitionPayment, f.investing);
  near(f.startTotal + f.operating + f.investing + f.financing + f.fx, f.endTotal);
  near(f.cash + f.restricted, f.endTotal);
  near(f.operating - f.capex, -5.376);
  near(s.rsu.begin + s.rsu.granted - s.rsu.vested - s.rsu.canceled, s.rsu.end);
  near(s.options.begin + s.options.grantedRounded - s.options.exercised - s.options.canceled, s.options.end);
  near(s.rsu.end + s.options.end, s.reportedPotential);
  near(s.atmIssues.reduce((sum, p) => sum + p.shares, 0), s.atmTotal);
  near(s.snapshots.at(-1).shares, c.shares);
  assert.equal(s.snapshots.at(-1).asOf, c.shareDate);
  assert.ok(s.periodEnd < c.shareDate, 'old award balances cannot imply a same-day diluted total');
  const company = { price: c.price, shares: { value: c.shares }, financials: { anchorRevenue: null } };
  for (const row of a.hurdleCases) {
    const revenue = c.price.value * 10 * row.shares / row.pe / row.margin;
    const result = M.project(company, { ...row, revenue, dividends: 0 });
    near(result.priceMultiple, 10);
    assert.equal(result.revenueCagr, null, 'different fiscal anchors must not imply a five-year revenue CAGR');
  }
});

test('investment adjustments use the attributable bridge and retain ongoing stock compensation', () => {
  const c = byId('ACMR'), a = c.profitCheck;
  const now = M.investmentProfit(a.current), prior = M.investmentProfit(a.prior);
  near(now.parentGain, 50.011);
  near(now.withoutGain, 56.280);
  near(prior.withoutGain, 48.808);
  near(now.issuerNonGaap, a.current.issuerNonGaap);
  near(M.investmentProfit(a.prior).issuerNonGaap, a.prior.issuerNonGaap);
  near(now.margin, 56.280 / 524.182);
  near(now.withoutGain / prior.withoutGain - 1, .15308965743320746);
  assert.notEqual(now.withoutGain, c.financials.netIncome - a.current.consolidatedGain);
  assert.notEqual(now.withoutGain, (c.financials.netIncome - now.parentGain) * c.ownershipCheck.ownership);
  assert.throws(() => M.investmentProfit({ ...a.current, minorityGain: null }), RangeError);
});

test('parent shares include both classes and distinguish an award upper bound from a complete balance', () => {
  const s = byId('ACMR').shares, b = s.issuedBridge, a = s.awardUpperBound;
  near(b.priorA + b.priorB + b.newIssue + b.optionExercises, b.endA + b.endB);
  near(b.endA + b.endB + b.laterNetIssue, s.value);
  near(a.employeeOptions + a.nonEmployeeOptions + a.newOptions - a.exercised + a.newRsu, s.potentialUpperBound);
  near(s.potentialUpperBound, 5.927590);
  assert.equal(a.unreportedCancellations, null);
  assert.equal(s.knownPotential, null);
  assert.match(s.gap, /取消/);
});

test('subsidiary post-offering issuance and greenshoe have a separate denominator', () => {
  const o = byId('ACMR').ownershipCheck;
  near(M.subsidiaryOwnership(o.ownership, o.proposedFraction), .68076);
  near(M.subsidiaryOwnership(o.ownership, o.proposedFraction, o.overAllotment), .6736862939139041);
  near(M.subsidiaryOwnership(.7, .2, .15), .7 / 1.2875);
  near(M.subsidiaryOwnership(.7, 0, .15), .7);
  assert.throws(() => M.subsidiaryOwnership(.7, 1), RangeError);
  assert.throws(() => M.subsidiaryOwnership(.7, null), RangeError);
});

test('cash reconciliation separates funding proceeds, operating burn and the issuer FCF definition', () => {
  const c = byId('ACMR'), f = c.cashCheck;
  near(Object.values(f.jurisdictions).reduce((a, b) => a + b, 0), f.cash);
  near(f.debtParts.reduce((a, b) => a + b, 0), c.financials.debt);
  near(f.operatingCash, c.financials.operatingCash);
  near(f.operatingCash - f.capex, -123.207);
  near(f.operatingCash - f.capex - f.longTermInvestments, f.issuerFcf);
  near(f.parentEquityProceeds + f.subsidiarySaleGross + f.shortBorrowed - f.shortRepaid +
    f.longBorrowed - f.longRepaid + f.optionProceeds, f.financingTotal);
  near(f.financingTotal, 332.598);
});

test('reconstructed option balances exclude canceled awards instead of retaining original grants', () => {
  const c = byId('688389'), plans = c.shares.rollforward;
  for (const p of plans) near(p.granted - p.exercised - p.canceled.reduce((s, x) => s + x, 0), p.remaining);
  near(plans.reduce((s, p) => s + p.remaining, 0), c.shares.knownPotential);
  near(c.shares.knownPotential, 19.994);
});

test('cost refunds and acquisition-related products cannot silently inflate operating evidence', () => {
  const a = byId('OUST').earningsAdjustment;
  near(M.adjustedGrossMargin(a.revenue, a.reportedCost, a.costBenefit), 21.285 / 54.626);
  near(M.adjustedGrossMargin(a.priorRevenue, a.priorReportedCost, a.priorCostBenefit), 14.142 / 35.049);
  assert.throws(() => M.adjustedGrossMargin(0, 2, 1), RangeError);
  assert.throws(() => M.adjustedGrossMargin(10, 2, null), RangeError);
  const p = byId('688050').productCheck;
  near(p.current.reduce((s, x) => s + x, 0), 808.13489042);
  near(p.prior.reduce((s, x) => s + x, 0), 779.25557159);
});

test('financing pressure reserves awards and exposes the feedback from a lower issue price', () => {
  const c = byId('AMPX'), bull = M.scenario(c, 'bull');
  const low = M.fundingStress(c, bull, .25, 4), high = M.fundingStress(c, bull, .25, 8);
  near(low.workingCapital, 42.4);
  near(low.fundingShares, 32.031342);
  near(low.additionalWorkingCapital, 207.6);
  near(low.balanceBeforeOtherFlows, -4.957632);
  near(high.balanceBeforeOtherFlows, 123.167736);
  assert.ok(M.fundingStress(c, bull, low.currentRatio, 4).balanceBeforeOtherFlows < low.balanceBeforeOtherFlows);
  assert.equal(M.fundingStress(byId('688050'), M.scenario(byId('688050'), 'bull'), .25, 4), null);
  assert.throws(() => M.fundingStress({ ...c, shares: { ...c.shares, knownPotential: null } }, bull, .25, 4), RangeError);
  assert.throws(() => M.fundingStress(c, { ...bull, shares: 160 }, .25, 4), RangeError);
});

test('Amprius cash reconciles the reported loss, one-time exit cash and existing financing without double counting', () => {
  const c = byId('AMPX'), a = c.cashAudit, f = a.cash;
  near(f.netLoss - f.commonStockholderLoss, f.warrantModificationCharge);
  near(Object.values(a.ocfBridge).reduce((sum, v) => sum + v, 0), f.operating);
  near(a.workingCapitalKeys.reduce((sum, key) => sum + a.ocfBridge[key], 0), f.workingCapitalExcludingLeases);
  near(f.operating + f.leaseTerminationPaid, f.ocfExcludingTermination);
  near(f.ocfExcludingTermination - f.workingCapitalExcludingLeases, -2.193);
  near(f.assetSale - f.capexPaid, f.investing);
  near(f.warrantExerciseCash + f.optionExerciseCash, f.financing);
  near(f.startCashAndRestricted + f.operating + f.investing + f.financing + f.fx, f.endCashAndRestricted);
  near(f.endCash + f.restrictedCurrent + f.restrictedOther, f.endCashAndRestricted);
  near(c.liquidityCheck.cash, f.endCash);
  near(c.awardAudit.obligated + c.awardAudit.unfunded, c.awardAudit.maximum);
  near(c.awardAudit.maximum, 74.79317311);
  const inventory = require('../docs/research/ampx-filings-2026-10-18.json');
  assert.equal(inventory.records.length, inventory.count);
  assert.equal(new Set(inventory.records.map(r => r.url)).size, inventory.count);
  assert.ok(inventory.records.every(r => r.date >= inventory.range[0] && r.date <= inventory.range[1]));
  assert.ok(inventory.earlierBoundary < inventory.range[0]);
});

test('annual funding includes interim profits and capital expenditure while issue prices affect shares, not cash needs', () => {
  const c = byId('AMPX'), f = c.liquidityCheck, r = f.routes.find(r => r.id === 'delayed');
  near(f.periods[0].revenue + c.financials.revenue, f.periods[0].annualRevenue);
  const low = M.liquidityProjection(c, r, 2), middle = M.liquidityProjection(c, r, 4), high = M.liquidityProjection(c, r, 8);
  near(middle.totalRaised, 155.8415730724971);
  near(middle.shares, 216.92905126812425);
  near(low.totalRaised, high.totalRaised);
  near(low.newShares, high.newShares * 4);
  near(middle.terminal.profit, 150);
  for (const route of f.routes) {
    const x = M.liquidityProjection(c, route, 4);
    near(x.totalRaised, x.rows.reduce((sum, row) => sum + row.raised, 0));
    x.rows.forEach((row, i) => {
      near(row.openingCash + row.operatingCash - row.capex + row.projectNet + row.exerciseCash + row.raised, row.cash);
      assert.ok(row.cash >= f.minimumCash - 1e-8);
      near(row.openingCash, i ? x.rows[i - 1].cash : f.cash);
      near(row.operatingCash, row.netIncome + f.periods[i].depreciation + f.periods[i].stockComp + f.periods[i].otherCashAdjustment - row.workingCapitalChange);
    });
    near(x.rows.reduce((sum, row) => sum + row.projectNet, 0), 0);
  }
  // The earlier working-capital-only deficit does not imply the same funding need once profits are included.
  near(M.liquidityProjection(c, f.routes[0], 4).totalRaised, 3.583);
  near(M.liquidityProjection(c, f.routes[1], 4).totalRaised, 20.298675744789673);
  assert.throws(() => M.liquidityProjection(c, { ...r, projectReceipts: [] }, 4), RangeError);
  assert.throws(() => M.liquidityProjection({ ...c, shares: { ...c.shares, knownPotential: null } }, r, 4), RangeError);
  assert.throws(() => M.liquidityProjection(c, r, 0), RangeError);
});

test('a later cash surplus does not erase the shares needed to survive an earlier shortfall', () => {
  const c = structuredClone(byId('AMPX'));
  c.shares.value = 4; c.shares.knownPotential = 2;
  c.liquidityCheck = { cash: 10, workingCapital: 0, minimumCash: 10, futureAwards: 1,
    periods: ['first', 'second'].map(label => ({ label, revenue: 100, annualRevenue: 100, depreciation: 0, stockComp: 0, otherCashAdjustment: 0, capex: 0 })) };
  const route = { netMargins: [-.2, 1], workingCapitalRatios: [0, 0], projectSpend: [0, 0], projectReceipts: [0, 0] };
  const x = M.liquidityProjection(c, route, 2);
  near(x.rows[0].raised, 20); near(x.rows[1].raised, 0);
  near(x.cash, 110); near(x.newShares, 10); near(x.shares, 17);
  // Moving an accepted project receipt earlier can remove that issuance; leaving it later cannot.
  near(M.liquidityProjection(c, { ...route, projectReceipts: [20, 0] }, 2).newShares, 0);
  near(M.liquidityProjection(c, { ...route, projectReceipts: [0, 20] }, 2).newShares, 10);
});

test('warrant lapse and cash exercise are distinct branches and incentive reserves are not counted twice', () => {
  const c = byId('AMPX'), f = c.liquidityCheck, d = c.dilutionAudit, r = f.routes.find(r => r.id === 'delayed');
  const warrants = d.warrants.reduce((sum, w) => sum + w.shares, 0);
  const cashExercise = d.warrants.reduce((sum, w) => sum + w.shares * w.strike, 0);
  near(warrants + d.options + d.rsus, c.shares.knownPotential);
  near(cashExercise, 121.4610285);
  const defaultPressure = M.liquidityProjection(c, r, 4);
  const lapse = M.liquidityProjection(c, r, 4, { potentialShares: c.shares.knownPotential - warrants });
  const paid = M.liquidityProjection(c, r, 4, { exerciseCash: [0, cashExercise, 0, 0, 0, 0] });
  near(lapse.totalRaised, defaultPressure.totalRaised);
  near(defaultPressure.shares - lapse.shares, warrants);
  near(defaultPressure.totalRaised - paid.totalRaised, cashExercise);
  near(paid.totalRaised, 34.380544572497115);
  near(M.liquidityProjection(c, r, 4, { futureAwards: f.awardSensitivity }).shares - defaultPressure.shares, 10);
  near(defaultPressure.shares, c.shares.value + c.shares.knownPotential + f.futureAwards + defaultPressure.newShares);
  assert.equal(d.expiry, '2027-09-14');
});

test('filtering and the three-step sort cycle return to the research order', () => {
  let state = { market: 'us', status: 'all', sector: 'all', query: '', sort: 'default', descending: true };
  const ids = () => M.select(data.companies, state).map(c => c.id);
  assert.deepEqual(ids(), ['AMPX', 'ACMR', 'INOD', 'OUST']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.deepEqual(ids(), ['ACMR', 'INOD', 'OUST', 'AMPX']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.deepEqual(ids(), ['AMPX', 'OUST', 'INOD', 'ACMR']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.equal(state.sort, 'default');
  assert.deepEqual(ids(), ['AMPX', 'ACMR', 'INOD', 'OUST']);
  state.query = ' ampx ';
  assert.deepEqual(ids(), ['AMPX']);
  state.query = ''; state.status = 'watch';
  assert.deepEqual(ids(), ['OUST']);
  state.market = 'cn';
  assert.deepEqual(ids(), ['688050']);
});

function fixture() {
  const context = { window: { ChanghengPotentialModel: M, POTENTIAL_RESEARCH: structuredClone(data) } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/potential-stocks.js', 'utf8'), context);
  let renders = 0, preserved = 0, modal = '', html = '';
  const api = context.window.ChanghengPotential;
  const H = {
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '—',
    pct: (v, d = 2) => v.toFixed(d) + '%', pc: (v, d = 2) => v.toFixed(d) + '%',
    action: (text, action, cls = '', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`,
    modalTitle: (title, sub) => `<h2>${title}</h2><p>${sub}</p>`,
    openModal: content => { modal = content; },
    render: () => { renders++; html = api.view(H); },
    renderStockView: () => { preserved++; html = api.view(H); },
    market: 'us', annual: true, annualControl: () => '<button data-action="annual">累计收益</button>'
  };
  H.render();
  return { api, H, data: context.window.POTENTIAL_RESEARCH, click: (action, value) => api.handleAction({ dataset: { action, value } }), get html() { return html; }, get modal() { return modal; }, get preserved() { return preserved; }, get renders() { return renders; } };
}

test('switching financial, valuation and return views preserves sort and uses the existing scroll anchor', () => {
  const f = fixture();
  f.click('potential-sort', 'revenue');
  for (const mode of ['valuation', 'returns', 'financials']) {
    f.click('potential-view', mode);
    assert.ok(f.html.indexOf('data-stock-row="OUST"') < f.html.indexOf('data-stock-row="AMPX"'));
    assert.match(f.html, /按营收降序/);
  }
  assert.equal(f.preserved, 3);
  f.click('potential-sort-reset');
  assert.ok(f.html.indexOf('data-stock-row="AMPX"') < f.html.indexOf('data-stock-row="OUST"'));
  f.click('potential-view', 'returns');
  assert.match(f.html, /基准 \/ 年化/);
  f.H.annual = false; f.H.render();
  assert.match(f.html, /基准 \/ 累计/);
  assert.match(f.html, /data-action="annual"/);
});

test('both markets, empty search recovery and every detail tab expose complete evidence', () => {
  const f = fixture();
  for (const market of ['us', 'cn']) {
    f.H.market = market; f.H.render();
    assert.doesNotMatch(f.html, /stock-market-nav|potential-market/);
    for (const c of data.companies.filter(c => c.market === market)) {
      assert.ok(f.html.includes(c.name));
      f.click('potential-detail', c.id);
      assert.match(f.modal, /已验证事实/);
      assert.match(f.modal, /管理层指引/);
      if (c.profitCheck) {
        assert.match(f.modal, /归母利润复核/);
        assert.match(f.modal, /56\.280/);
        assert.match(f.modal, /现金来源与去向/);
        assert.match(f.html, /含未实现投资收益/);
      }
      if (c.cashAudit) {
        assert.match(f.modal, /现金复核/);
        assert.match(f.modal, /20\.126/);
      }
      if (c.medicalAudit) {
        assert.match(f.modal, /并购现金与债务/);
        assert.match(f.modal, /640\.716/);
        assert.match(f.modal, /2028-10/);
        assert.match(f.modal, /未写经营现金流/);
      }
      if (c.diagnosticAudit) {
        assert.match(f.modal, /试剂量价/);
        assert.match(f.modal, /境外出货/);
        assert.match(f.modal, /H100Plus/);
        assert.match(f.modal, /64\.660/);
        assert.match(f.modal, /不能直接全部加回归母/);
      }
      if (c.sensingAudit) {
        assert.match(f.modal, /软件收费与项目交付/);
        assert.match(f.modal, /七位数/);
        assert.match(f.modal, /42\.47/);
        assert.match(f.modal, /20\.639/);
        assert.match(f.modal, /不是Ouster厂家净收入/);
      }
      f.click('potential-detail-tab', 'scenarios');
      assert.match(f.modal, /期末股数/);
      assert.match(f.modal, /终值PE降低25%/);
      assert.match(f.modal, /缺项/);
      assert.match(f.modal, /参数根据与未验证条件/);
      if (c.priorBull) assert.match(f.modal, /已撤回的旧乐观假设/);
      else assert.doesNotMatch(f.modal, /已撤回的旧乐观假设/);
      if (c.ownershipCheck) assert.match(f.modal, /子公司融资稀释/);
      if (c.marketTest.kind === 'segment_growth') {
        assert.match(f.modal, /H1简单年化/);
        assert.doesNotMatch(f.modal, /单位净收入<\/th>/);
      }
      if (c.marketTest.kind === 'annual_segments') {
        assert.match(f.modal, /所需6年增速/);
        assert.match(f.modal, /试剂增长与降价压力/);
        assert.match(f.modal, /2026-09-04/);
        assert.doesNotMatch(f.modal, /单位净收入<\/th>|NaN|undefined/);
      }
      if (c.sensingAudit) {
        assert.match(f.modal, /渠道实收敏感性/);
        assert.match(f.modal, /112,?500/);
        assert.match(f.modal, /72,?112,?333/);
        assert.match(f.modal, /未假定已知厂家单价/);
        assert.doesNotMatch(f.modal, /NaN|undefined/);
      }
      if (c.financingCheck) assert.match(f.modal, /融资敏感性/);
      if (c.medicalAudit) {
        assert.match(f.modal, /2021激励计划完整归属记录/);
        assert.match(f.modal, /193,437,735/);
        assert.doesNotMatch(f.modal, /潜在余额未知|NaN|undefined/);
      }
      if (c.liquidityCheck) {
        assert.match(f.modal, /逐年现金与融资/);
        assert.match(f.modal, /216\.929/);
        assert.match(f.modal, /255\.889/);
        assert.doesNotMatch(f.modal, /NaN|undefined/);
      }
      f.click('potential-detail-tab', 'evidence');
      assert.match(f.modal, /撤回或下修信号/);
      assert.match(f.modal, /原始来源与定位/);
      assert.ok(f.modal.includes(c.price.url.replace(/&/g, '&amp;')));
    }
  }
  f.api.handleInput({ value: 'no matching company' }); f.H.render();
  assert.match(f.html, /当前条件没有匹配公司/);
  f.click('potential-reset');
  assert.match(f.html, /普门科技/);
  f.click('potential-method');
  assert.match(f.modal, /10倍终值相当于累计\+900%/);
  assert.match(f.modal, /报价记录 JSON/);
});

test('company content is escaped and non-HTTPS source links are not executable', () => {
  const f = fixture();
  f.data.companies[0].name = '<img src=x onerror=alert(1)>';
  f.data.companies[0].tagline = 'a & b';
  f.data.sources[0].url = 'javascript:alert(1)';
  f.H.render();
  assert.match(f.html, /&lt;img/);
  assert.match(f.html, /a &amp; b/);
  assert.doesNotMatch(f.html, /<img/);
  f.click('potential-detail', 'AMPX');
  assert.doesNotMatch(f.modal, /href="javascript:/);
});
