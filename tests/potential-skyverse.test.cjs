const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const model = require('../assets/potential-model.js');
const c = data.comparisons.find(c => c.id === '688361');
const a = c.audit;
const sum = values => values.reduce((x, y) => x + y, 0);
const near = (actual, expected, label = '') => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6,
  label + ': ' + actual + ' != ' + expected
);

test('Skyverse LTM combines financial periods without annualizing a loss or removing recurring R&D', () => {
  const h = a.history;
  for (const field of ['revenue', 'cost', 'operating', 'net', 'adjustedNet', 'ocf', 'capex', 'rd']) {
    near(h.ltm[field], h['2025'][field] - h['2025H1'][field] + h['2026H1'][field], field);
  }
  near(h.ltm.revenue, 2292.14194551);
  near(h.ltm.net, -50.43078556);
  near(h.ltm.adjustedNet, -203.97564016);
  near(h.ltm.fcf, h.ltm.ocf - h.ltm.capex);
  near(h.ltm.fcf, -1205.7683254);
  near(a.earnings.net, a.earnings.pretax - a.earnings.tax);
  near(a.earnings.rd, 381.17781355);
  near(a.earnings.capitalizedRd, 0);
  assert.ok(a.earnings.netExSbcAsDisclosed < 0);
  assert.notEqual(a.earnings.net + a.earnings.sbc, a.earnings.netExSbcAsDisclosed);
});

test('Skyverse product sales and costs sum to reported revenue, with hardware unit figures kept separate', () => {
  near(sum(a.products.map(p => p.revenue2025)), a.history['2025'].revenue);
  near(sum(a.products.map(p => p.cost2025)), a.history['2025'].cost);
  near(sum(a.products.map(p => p.revenueH1)), a.history['2026H1'].revenue);
  near(sum(a.products.map(p => p.costH1)), a.history['2026H1'].cost);
  const hardware = a.products.filter(p => p.sold2025 != null);
  near(sum(hardware.map(p => p.sold2025)), 367);
  near(sum(hardware.map(p => p.produced2025)), 421);
  near(a.marketEvidence.equipmentRevenuePerMixedUnit2025,
    sum(hardware.map(p => p.revenue2025)) / sum(hardware.map(p => p.sold2025)));
  assert.ok(1 - a.history['2026H1'].cost / a.history['2026H1'].revenue
    < 1 - a.history['2025H1'].cost / a.history['2025H1'].revenue);
});

test('Skyverse operating and financing cash reconcile separately from investment principal turnover', () => {
  const f = a.cash;
  near(a.earnings.net + sum(a.earnings.cashAdjustments), f.operating);
  near(f.salesReceipts + f.taxRefunds + f.otherReceipts, f.operatingInflows);
  near(f.operatingInflows - f.operatingOutflows, f.operating);
  near(f.equityProceeds + f.borrowings - f.debtRepaid
    - f.dividendsInterestPaid - f.leasePrincipalInterestPaid, f.financing);
  near(f.start + f.operating + f.investing + f.financing + f.fx, f.end);
  near(f.end - f.start, -579.83204063);
  near(f.operating - f.capex, -525.68510936);
  const w = a.workingCapital;
  near(-w.inventoryCashUse - w.receivableCashUse + w.payableCashContribution,
    -193.98601666);
});

test('Skyverse shipped equipment and inventory are net carrying amounts, not unrecognized sales prices', () => {
  const w = a.workingCapital;
  near(w.shippedGross - w.shippedReserve, w.shippedNet);
  near(w.inventoryGross - w.inventoryReserve, w.inventoryNet);
  near(w.shippedNet - w.shippedPriorNet, 373.01831771);
  near(w.contractLiability - w.contractLiabilityPrior, 375.07988752);
  assert.notEqual(w.inventoryNet - w.inventoryPriorNet, w.inventoryCashUse);
  assert.ok(w.shippedNet < w.inventoryNet);
});

test('Skyverse earmarked cash, outside-cash guarantees and temporary internal transfers are not counted twice', () => {
  const l = a.liquidity;
  near(l.cashEquivalents + l.outsideCashGuarantees, l.monetaryFunds);
  near(l.otherCash + l.earmarkedInsideCash, l.cashEquivalents);
  near(l.otherCash, 464.12040903);
  near(l.otherCashAfterTemporaryReturn, l.otherCash - l.temporaryWorkingCapital);
  near(l.otherCashAfterTemporaryReturn, 164.12430903);
  near(l.otherCashAfterTemporaryReturn + l.earmarkedInsideCash + l.temporaryWorkingCapital,
    l.cashEquivalents);
  assert.equal(l.temporaryReturnIsExternalDebt, false);
  near(l.oneYearBorrowings, l.shortBorrowings + l.currentLongBorrowings);
  near(l.totalBorrowings, l.oneYearBorrowings + l.longBorrowings);
  near(l.oneYearBorrowings, 369.17479147);
  near(sum(a.projects.map(p => p.plan - p.spent)), 1594.199);
  for (const project of a.projects) near(project.remaining, project.plan - project.spent);
  assert.ok(l.fundCashManagementPrincipal > 0); // It is separate from reported cash equivalents.
});

test('Skyverse paid June awards enter July registered shares only once; remaining awards are an explicit upper bound', () => {
  const k = a.capital;
  near(k.registeredJune + k.paidAwardShares, k.registeredJuly);
  near(k.registeredJuly, c.shares);
  assert.equal(c.shareDate, '2026-07-07');
  near(k.initialPlan - k.exercised2025 - k.exercisedH1,
    k.maximumRemainingIgnoringForfeitures);
  near(k.maximumRemainingIgnoringForfeitures, 4.519757);
  near(k.existingPlanMaxShares, c.shares + k.maximumRemainingIgnoringForfeitures);
  near(k.exercisedH1 * k.shareSubscriptionPrice, a.cash.equityProceeds);
  assert.ok(k.forfeited2025 + k.forfeitedH1 > 0);
  assert.equal(k.currentAllAwardBalanceVerified, false);
  assert.equal(k.legacyPartnershipTransfersAlreadyInIssuedShares, true);
});

test('Skyverse price and market hurdle use dated ordinary close and keep conflicting TAM quotations visible', () => {
  const q = quotes.find(q => q.symbol === c.price.symbol);
  assert.equal(q.basis, 'unadjusted_regular_session_close');
  near(q.observations.find(q => q.date === c.price.asOf).close, c.price.value);
  near(c.price.value * c.shares, 118289.361456);
  const m = a.marketEvidence;
  assert.equal(m.originalYoleScopeReconciled, false);
  assert.notEqual(m.global2025AnnualUsdMillions, m.global2025HalfYearUsdMillions);
  near(m.china2026CnyMillions, m.china2026ForecastUsdMillions * m.fxAssumption);
  near(m.tenfoldRevenue, c.price.value * 10 * a.capital.existingPlanMaxShares / .25 / 30);
  near(m.tenfoldRevenue, 159743.999744);
  for (const row of m.domesticGrowthSensitivities) {
    near(row.market2031, m.china2026CnyMillions * (1 + row.rate) ** 5);
    near(row.tenfoldRequiredShare, m.tenfoldRevenue / row.market2031);
  }
  near(m.unitsForBullAtSameMix, 30000 * .9 / m.equipmentRevenuePerMixedUnit2025);
  near(m.unitsForBullAtDoubleMixPrice, m.unitsForBullAtSameMix / 2);
});

test('Skyverse scale cases remain unfunded sensitivities; issue fees and new awards reduce per-share outcomes', () => {
  const company = {price: c.price, shares: {value: c.shares}, financials: {anchorRevenue: null}};
  assert.equal(a.fullFundingModelVerified, false);
  for (const s of a.scenarios) {
    const result = model.project(company, s);
    near(result.priceMultiple, s.priceMultiple);
    near(result.priceMultiple, result.totalMultiple);
    near(s.shares, a.capital.existingPlanMaxShares);
  }
  near(a.scenarios.find(s => s.id === 'bull').priceMultiple, 1.8780048107019307);
  for (const f of a.fundingSensitivity) {
    near(f.raiseGross * (1 - f.feeRate), f.raiseNet);
    near(f.newEquityShares, f.raiseGross / f.issuePrice);
    near(f.awardShares, a.capital.existingPlanMaxShares * f.awardRate);
    near(f.endingShares, a.capital.existingPlanMaxShares + f.awardShares + f.newEquityShares);
    near(f.priceMultiple, 30000 * .25 * 30 / f.endingShares / c.price.value);
    assert.equal(f.contracted, false);
  }
  const paths = a.fundingSensitivity;
  assert.ok(paths.at(-1).priceMultiple < paths[0].priceMultiple);
  assert.ok(paths.at(-1).endingShares > paths.at(-2).endingShares);
});

