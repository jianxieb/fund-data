const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-stocks.json'), 'utf8'));
const c = data.comparisons.find(x => x.id === 'XPER');
const a = c.audit;
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test('Xperi LTM uses actual comparative periods and deducts capitalized software', () => {
  const get = label => a.periods.find(p => p.label === label);
  const year = get('2025'), prior = get('2025H1'), current = get('2026H1'), ltm = get('LTM至2026-06');
  for (const k of ['revenue', 'cost', 'operating', 'net', 'operatingCash', 'software', 'ppe', 'sbc']) {
    near(ltm[k], year[k] + current[k] - prior[k]);
  }
  near(ltm.revenue, 456.837);
  near(ltm.net, -32.518);
  near(ltm.operatingCash, 8.181);
  near(ltm.fcfSoftwarePPE, -15.575);
  near(year.fcfSoftwarePPE, -21.492);
  near(get('2024').net, -14.008); // Parent loss, not consolidated loss of 0.869.
});

test('Xperi operating improvement bridge preserves cost reductions and advertising losses', () => {
  const b = a.operatingBridge;
  near(b.priorOperating + b.revenueDelta - b.costDelta + b.rdSaving + b.sgaSaving - b.depreciationIncrease + b.amortizationSaving - b.impairmentIncrease, b.currentOperating);
  near(b.currentOperating - b.priorOperating, 32.637);
  const r = a.revenueQuality;
  near(r.advertisingH1 - r.adCostH1, -2.613);
  near(r.adQ2 - r.adCostQ2, -1.259);
  near((r.advertisingH1 - r.adQ2) - (r.adCostH1 - r.adCostQ2), -1.354);
  near(r.overTimeH1 + r.pointInTimeH1, r.licensingH1);
  near(r.overTimeH1 - r.overTimePriorH1, -18.273);
  near(r.pointInTimeH1 - r.pointInTimePriorH1, 20.401);
  near(r.licensingH1 - r.licensingPriorH1, 2.128);
});

test('Xperi quarter cash and divestiture proceeds reconcile without adding the receipt twice', () => {
  const f = a.cash, d = a.cashDetails;
  near(f.start + f.operating + f.investing + f.financing + f.fx, f.end);
  near(d.q1OCF + d.q2OCF, f.operating);
  near(d.q1Software + d.q2Software, 10.156);
  near(d.q1PPE + d.q2PPE, 1.602);
  near(d.q2OCF - d.q2Software - d.q2PPE, d.q2FCF);
  near(d.q2FCF, 7.636);
  near(d.perceiveFinancing + d.perceiveOperating, d.perceiveTotal);
  near(d.q2FCF - d.perceiveOperating, 6.938);
  near(f.operating - f.capex, -15.234);
  near(f.financing, 11.302 + 2.132 - 4.434);
});

test('Xperi potential shares use a common June date, PSU maximum and separate future reserves', () => {
  const k = a.capital;
  near(k.juneCommon + k.timeRSU + k.targetPSU * k.maximumPSUMultiple, k.existingMaximumShares);
  near(k.existingMaximumShares, 58.404);
  near(k.existingMaximumShares + k.ungrantedPlanReserve + k.esppReserve, k.allDisclosedCapacity);
  near(k.allDisclosedCapacity, 65.104);
  near(k.marketCap, 242.88367356);
  assert.notEqual(c.shares, k.weightedH1Shares);
  for (const s of a.scenarios) assert.ok(s.shares > k.allDisclosedCapacity);
});

test('Xperi counterparty assets are excluded from available cash and funding stress receipts', () => {
  const d = a.debtor;
  near(d.noteCurrent + d.noteNoncurrent + d.deferredConsideration, 41.726);
  near(d.principalPayments.reduce((n, x) => n + x, 0), 27.676);
  near(a.capital.netCashBeforeLeases, a.cash.end - 40);
  assert.equal(d.increasedFinancingRiskDisclosed, true);
  assert.equal(d.tobiiCashSEKm, 37); // SEK, never added to Xperi's USD liquidity.
  for (const s of a.fundingSensitivity.scenarios) for (const y of s.rows) assert.equal(y.tobiiCash, 0);
});

test('Xperi terminal earnings include operating expenses, depreciation, interest and tax floor', () => {
  for (const s of a.scenarios) {
    near(s.averageMAU * s.arpu + s.autoDataRevenue, s.adRevenue);
    near(s.licenseRevenue * s.licenseGrossMargin + s.adRevenue * s.adGrossMargin, s.grossProfit);
    near(s.grossProfit - s.rd - s.sga - s.da - s.netInterest, s.pretax);
    near(s.pretax - s.foreignTaxFloor - Math.max(0, s.pretax) * s.domesticTaxRate, s.net);
    near(s.revenue * s.margin, s.net);
    near(s.net * s.pe / s.shares / c.price.value, s.priceMultiple);
  }
  const base = a.scenarios.find(s => s.id === 'base'), bull = a.scenarios.find(s => s.id === 'bull');
  near(base.net, 61.25);
  near(base.priceMultiple, 2.951807228915662);
  near(bull.net, 168);
  near(bull.priceMultiple, 11.244979919678714);
  const lowerAdMarginNet = bull.net - bull.adRevenue * .20 * (1 - bull.domesticTaxRate);
  near(lowerAdMarginNet * bull.pe / bull.shares / c.price.value, 6.224899598393574);
  assert.ok(bull.priceMultiple * .75 < 10);
});

test('Xperi operating tenfold hurdle is solved from the expense structure, not a target label', () => {
  const b = a.scenarios.find(s => s.id === 'bull'), h = a.operatingHurdle;
  near(h.targetNet, 149.4);
  near(h.requiredAd, 458.6666666666667);
  const pretax = b.licenseRevenue * b.licenseGrossMargin + h.requiredAd * b.adGrossMargin - b.rd - b.sga - b.da - b.netInterest;
  near((pretax * (1 - b.domesticTaxRate) - b.foreignTaxFloor) * b.pe / b.shares, c.price.value * 10);
  near(h.averageMAUAt20 * 20 + 20, h.requiredAd);
  near(h.averageMAUAt10, 2 * h.averageMAUAt20);
});

test('Xperi financing sensitivity pays 2028 debt, charges fees and preserves cash through dilution', () => {
  const f = a.fundingSensitivity;
  for (const s of f.scenarios) {
    let previous = s.opening2027;
    let net = 0, added = 0;
    for (const y of s.rows) {
      near(y.start, previous);
      near(y.start + y.operatingCash - y.capex + y.netEmployeeCash - y.debtRepayment + y.tobiiCash, y.beforeEquity);
      near(y.equityGross * (1 - f.issueFee), y.equityNet);
      near(y.newShares * y.issuePrice, y.equityGross);
      near(y.beforeEquity + y.equityNet, y.end);
      near(y.debtRepayment, y.year === 2028 ? 40 : 0);
      assert.ok(y.end >= f.minimumCashAssumption - 1e-9);
      previous = y.end; net += y.equityNet; added += y.newShares;
    }
    near(net, s.netRaised); near(added, s.newShares);
  }
  const slow = f.scenarios.find(s => s.label === '缓慢改善' && s.issuePrice === 5);
  const slowLow = f.scenarios.find(s => s.label === '缓慢改善' && s.issuePrice === 2.5);
  near(slow.netRaised, 7.197);
  near(slowLow.newShares, slow.newShares * 2);
  near(f.scenarios.find(s => s.label === '低回款' && s.issuePrice === 5).netRaised, 42.197);
  near(f.scenarios.find(s => s.label === '2026下半年也失速').netRaised, 75.652);
  assert.equal(a.fullFundingModelVerified, false);
});

test('Xperi valuation uses dated ordinary closing price and resolvable evidence', () => {
  const quotes = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-quotes.json'), 'utf8'));
  const q = quotes.find(x => x.symbol === 'XPER');
  assert.equal(q.basis, 'unadjusted_regular_session_close');
  assert.equal(q.observations.at(-1).date, '2026-10-16');
  near(q.observations.at(-1).close, c.price.value);
  near(c.price.value, 4.98);
  const ids = new Set(data.sources.map(s => s.id));
  for (const id of [...c.sources, ...a.sections.flatMap(s => s.sources)]) assert.ok(ids.has(id), id);
  assert.ok(c.sources.includes('xperi-mg-correction'));
  assert.ok(c.sources.includes('tobii-h1-2026'));
});
