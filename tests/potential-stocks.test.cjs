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
    assert.match(s.publishedAt, /^\d{4}-\d\d-\d\d$/);
    assert.ok(s.publishedAt <= data.reviewedAt);
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
    for (const audit of [c.cashAudit, c.awardAudit, c.dilutionAudit, c.liquidityCheck, c.medicalAudit, c.diagnosticAudit]) ids.push(...(audit?.sources || []));
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
    } else for (const p of c.marketTest.parts) near(p.units * p.price / 1e6, p.revenue);
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
    near(c.price.value, Math.round(q.observations.at(-1).close * 100) / 100);
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
  assert.deepEqual(ids(), ['AMPX', 'ACMR', 'OUST']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.deepEqual(ids(), ['ACMR', 'OUST', 'AMPX']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.deepEqual(ids(), ['AMPX', 'OUST', 'ACMR']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.equal(state.sort, 'default');
  assert.deepEqual(ids(), ['AMPX', 'ACMR', 'OUST']);
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
