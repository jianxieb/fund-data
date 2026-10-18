const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const model = require('../assets/potential-model.js');

const company = data.comparisons.find(c => c.id === 'VICR');
const audit = company.audit;
const funding = audit.funding;
const allPaths = [
  ...Object.values(funding.paths), ...funding.stress,
  ...funding.buybackComparison, ...funding.creditSensitivity,
];
const sum = values => values.reduce((total, value) => total + value, 0);
function near(actual, expected, label = '') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-7,
    `${label}: ${actual} != ${expected}`);
}

test('Vicor historical income and LTM exclude the old settlement exactly once', () => {
  const h = audit.history;
  for (const period of ['2023', '2024', '2025', '2025H1', '2026H1']) {
    near(h[period].revenue, h[period].product + h[period].royalty, period);
  }
  for (const field of ['revenue', 'product', 'royalty', 'settlement', 'operating',
    'pretax', 'tax', 'parentNet', 'operatingCash', 'capex', 'sbc']) {
    near(h.ltm[field], h['2025'][field] - h['2025H1'][field] + h['2026H1'][field], field);
  }
  near(h.ltm.settlement, 0);
  near(h.ltm.revenue, 474.008);
  near(h.ltm.parentNet, 145.261);
  near(h.ltm.taxNormalizedParentNet, h.ltm.pretax * 0.76 - h.ltm.minorityNet);
  near(h.ltm.taxNormalizedParentNet, 77.3852);
  near(h.ltm.fcf, h.ltm.operatingCash - h.ltm.capex);
  near(h.ltm.fcf, 51.268);
  near(h.ltm.fcfBeforePaidSynqor, h.ltm.fcf + audit.cash.synqorPayment);
  near(audit.earnings.taxNormalizedParentNet, audit.earnings.pretax * 0.76 - 0.026);
});

test('Vicor half-year and quarterly cash distinguish operating receipts from employee financing', () => {
  const e = audit.earnings;
  const c = audit.cash;
  near(e.groupNet, e.pretax - e.tax);
  near(e.parentNet, e.groupNet - e.minorityNet);
  near(e.groupNet + sum(e.cashAdjustments), c.operating);
  near(c.operating, 30.197);
  near(c.start + c.operating + c.investing + c.financing + c.fx, c.end);
  near(c.operating - c.capex, 6.637);
  near(c.financing, c.employeePlanProceeds);
  near(c.repurchases, 0);
  near(e.q1.operatingCash + e.q2Cash.operating, c.operating);
  near(e.q1.capex + e.q2Cash.capex, c.capex);
  near(e.q1.financing + e.q2Cash.financing, c.financing);
  near(e.q2Cash.start, e.q1.endCash);
  near(e.q2Cash.start + e.q2Cash.operating - e.q2Cash.capex
    + e.q2Cash.financing + e.q2Cash.fx, e.q2Cash.end);
  near(e.q2Cash.operating - e.q2Cash.capex, 22.966);
});

test('Vicor advanced hardware excludes both royalties and NRE', () => {
  const p = audit.products;
  near(p.advancedIncludingRoyaltyH1, p.advancedExRoyaltyH1 + p.royaltyH1);
  near(p.advancedHardwareH1 + p.advancedNreH1, p.advancedExRoyaltyH1);
  near(p.advancedHardwarePriorH1 + p.advancedNrePriorH1 + p.advancedOtherPriorH1,
    p.advancedExRoyaltyPriorH1);
  near(p.advancedHardwareH1, 92.463 + 17.794);
  near(p.advancedHardwarePriorH1, 83.642 + 11.841);
  near(p.advancedHardwareQ2, 52.371 + 9.432);
  near(p.productGrossProfitH1, p.productH1 - audit.earnings.cost);
  near(p.productGrossProfitQ2, audit.earnings.q2.product - audit.earnings.q2.cost);
  const license = p.licenseMay;
  near(4 * license.firstYearQuarterlyCash + 4 * license.secondYearQuarterlyCash,
    license.totalScheduledCash);
  near(license.q2Recognized + sum(license.recognitionAfterQ2), license.totalScheduledCash);
  assert.equal(license.contractOriginalAvailable, false);
  assert.equal(license.cashReceiptReconciled, false);
  assert.equal(p.guidanceQ3.isActual, false);
  near(p.guidanceQ3.revenueLowerExclusive, audit.earnings.q2.revenue * 1.3);
});

test('Vicor valuation uses both outstanding share classes and a dated regular-session quote', () => {
  const c = audit.capital;
  const quote = quotes.find(q => q.symbol === 'VICR');
  assert.equal(quote.basis, 'unadjusted_regular_session_close');
  const close = quote.observations.find(q => q.date === company.price.asOf);
  near(close.close, company.price.value);
  near(company.price.value, 191.5);
  near(c.commonJuly + c.classBJuly, company.shares);
  near(c.commonJune + c.classBJune, c.sharesJune);
  assert.equal(company.shareDate, '2026-07-22');
  assert.notEqual(company.shares, c.dilutedWeightedQ2);
  const o = c.options2025;
  near(o.begin + o.granted - o.forfeitedExpired - o.exercised, o.end);
  near(sum(c.unrecognizedSchedule2025), c.unrecognizedExpense2025);
  assert.equal(c.verifiedCurrentOptionCount, null);
  near(funding.openingAwardReserve, c.assumedExistingAwardReserve);
  near(funding.ordinaryShares, company.shares);
  assert.equal(c.newAuthorizationReplacesOld, true);
  near(c.newBuybackAuthorization, 150);
});

test('Vicor every forecast year reconciles earnings, cash financing and potential shares', () => {
  for (const path of allPaths) {
    let cash = funding.openingCash;
    let shares = funding.ordinaryShares + funding.openingAwardReserve;
    let priorProduct = audit.earnings.productRevenue * 2;
    let priorRoyalty = audit.earnings.royaltyRevenue * 2;
    for (const r of path.rows) {
      near(r.revenue, r.productRevenue + r.royaltyRevenue);
      near(r.grossProfit, r.productRevenue * r.productGrossMargin + r.royaltyRevenue);
      near(r.operating, r.grossProfit - r.opex);
      near(r.tax, Math.max(0, r.operating) * funding.taxRate);
      near(r.groupNet, r.operating - r.tax);
      near(r.minorityNet, Math.max(0, r.groupNet) * funding.minorityRate);
      near(r.parentNet, r.groupNet - r.minorityNet);
      near(r.productGrowthForWc, Math.max(0, r.annualProductAnchor - priorProduct));
      near(r.royaltyGrowthForWc, Math.max(0, r.annualRoyaltyAnchor - priorRoyalty));
      near(r.workingCapital, r.productGrowthForWc * path.parameters.wcProduct
        + r.royaltyGrowthForWc * path.parameters.wcRoyalty);
      near(r.freeCash, r.groupNet + r.sbc + r.depreciation - r.workingCapital
        - r.expansion - r.maintenance);
      near(r.openingCash, cash);
      near(r.cashBeforeFunding, cash + r.freeCash + r.governmentCreditCash - r.repurchase);
      near(r.raiseNet, Math.max(0, funding.minimumCash - r.cashBeforeFunding));
      near(r.raiseGross * (1 - funding.issueFeeRate), r.raiseNet);
      near(r.newEquityShares, r.raiseGross / r.issuePrice);
      near(r.repurchasedShares, r.repurchase / r.repurchasePrice);
      near(r.endingCash, r.cashBeforeFunding + r.raiseNet);
      near(r.shares, shares + r.newEquityShares + r.awardShares - r.repurchasedShares);
      assert.equal(r.assumedOptionExerciseCash, 0);
      cash = r.endingCash;
      shares = r.shares;
      priorProduct = r.annualProductAnchor;
      priorRoyalty = r.annualRoyaltyAnchor;
    }
    near(path.endingCash, cash);
    near(path.shares, shares);
    near(path.raises, sum(path.rows.map(r => r.raiseNet)));
    near(path.expansion, sum(path.rows.map(r => r.expansion)));
    near(path.repurchases, sum(path.rows.map(r => r.repurchase)));
  }
});

test('Vicor grant shares use grant value while cash adds back only amortized compensation', () => {
  for (const path of allPaths) {
    path.rows.forEach((r, index) => {
      near(r.awardGrantValue, Math.max(index === 0 ? 9 : 18, r.revenue * 0.03));
      near(r.optionFairValue, r.grantPrice * 0.4);
      near(r.awardShares, r.awardGrantValue / r.optionFairValue);
      const newExpense = sum(path.rows.slice(0, index + 1).map((grant, grantIndex) => {
        const fraction = grantIndex === 0 ? (index === 0 || index === 5 ? 0.1 : 0.2)
          : index - grantIndex < 5 ? 0.2 : 0;
        return grant.awardGrantValue * fraction;
      }));
      near(r.newAwardSbc, newExpense);
      near(r.sbc, r.legacySbc + newExpense);
    });
    near(path.awards, sum(path.rows.map(r => r.awardShares)));
  }
});

test('Vicor published scenarios include dilution and do not turn a management target into tenfold upside', () => {
  const input = { price: company.price, shares: { value: company.shares },
    financials: { anchorRevenue: company.anchorRevenue } };
  for (const scenario of audit.scenarios) {
    const path = funding.paths[scenario.id];
    const result = model.project(input, scenario);
    near(result.profit, path.rows.at(-1).parentNet);
    near(result.priceMultiple, path.priceMultiple);
    near(result.totalMultiple, path.wealthMultiple);
    near(scenario.shares, path.shares);
    near(scenario.dividends, 0);
  }
  const bull = funding.paths.bull.rows.at(-1);
  near(bull.grossProfit / bull.revenue, 0.7);
  near(bull.operating / bull.revenue, 0.4);
  near(funding.paths.base.priceMultiple, 0.7702738217160257);
  near(funding.paths.bull.priceMultiple, 2.3129039123368584);
  const hurdle = model.hurdle(input, audit.scenarios.find(s => s.id === 'bull'));
  near(hurdle.revenue, 10808.92287252049);
  assert.equal(audit.products.managementLongTermTarget.committed2031Date, false);
});

test('Vicor buybacks consume cash and an unverified tax refund changes cash rather than earnings', () => {
  const noBuyback = funding.buybackComparison.find(p => p.repurchases === 0);
  const fullBuyback = funding.buybackComparison.find(p => p.repurchases === 150);
  near(noBuyback.shares - fullBuyback.shares, 150 / company.price.value);
  near(noBuyback.endingCash - fullBuyback.endingCash, 150);
  near(fullBuyback.net, noBuyback.net);
  near(fullBuyback.dividends, 0);
  const noRefund = funding.creditSensitivity.find(p => p.parameters.taxCreditCash === 0);
  const withRefund = funding.creditSensitivity.find(p => p.parameters.taxCreditCash === 14.3);
  near(withRefund.endingCash - noRefund.endingCash, 14.3);
  near(withRefund.net, noRefund.net);
  near(withRefund.shares, noRefund.shares);
});

test('Vicor adverse funding prices dilute both financing and new awards with the same cash requirement', () => {
  const stress = [...funding.stress].sort((a, b) => b.rows[0].issuePrice - a.rows[0].issuePrice);
  for (const path of stress) {
    near(path.raises, 792.472023);
    near(path.expansion, 1200);
    near(path.net, 94.905);
    near(path.priceMultiple, path.net * path.pe / path.shares / company.price.value);
    assert.ok(path.rows.every(r => r.endingCash >= funding.minimumCash - 1e-7));
    assert.ok(path.rows.slice(1).every(r => r.issuePrice === r.grantPrice));
  }
  assert.ok(stress[0].shares < stress[1].shares && stress[1].shares < stress[2].shares);
  assert.ok(stress[0].awards < stress[1].awards && stress[1].awards < stress[2].awards);
  assert.ok(stress[0].priceMultiple > stress[1].priceMultiple
    && stress[1].priceMultiple > stress[2].priceMultiple);
});
