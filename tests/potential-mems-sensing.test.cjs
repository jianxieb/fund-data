const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const M = require('../assets/potential-model.js');
const c = data.comparisons.find(x => x.id === '688582');
const a = c.audit;
const r = a.researchModel;
const close = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} does not match ${expected}`);
};
const sum = values => values.reduce((x, y) => x + y, 0);

test('芯动联科 Q2/LTM use matching consolidated periods, not annualized H1', () => {
  const f = r.financialCny;
  close(f['2025'].revenue, 523740685.28);
  close(f['2026H1'].net, 36477090.64);
  close(f['2026Q1'].operatingCash, -18931170.33);
  close(f['2026Q2'].revenue, 105496312.99);
  close(f['2026Q2'].net, 33923770.67);
  close(f['LTM'].revenue, 427207771.34);
  close(f['LTM'].net, 185565421.12);
  close(f['LTM'].operatingCash, 125396008.08);
  for (const k of Object.keys(f['2025'])) {
    close(f['2026Q2'][k], f['2026H1'][k] - f['2026Q1'][k]);
    close(f['LTM'][k], f['2025'][k] + f['2026H1'][k] - f['2025H1'][k]);
  }
  for (const p of a.periods) {
    assert.ok(Number.isFinite(p.operatingCash));
    close(p.net, p.operating + p.nonOpIncome - p.nonOpExpense - p.tax);
  }
});

test('芯动联科 product totals preserve annual other-business and H1 group scope', () => {
  close(sum(r.products.map(p => p.annualRevenue)), 523.70513129);
  close(sum(r.products.map(p => p.annualCost)), 74.50794830);
  close(sum(r.products.map(p => p.annualRevenue)) + .03555399, 523.74068528);
  close(sum(r.products.map(p => p.h1Revenue)), 156.60119630);
  close(sum(r.products.map(p => p.h1Cost)), 35.18151732);
  const imu = r.products.find(p => p.name === 'IMU');
  close(imu.h1Revenue, 18.49492192);
  assert.ok(1 - imu.h1Cost / imu.h1Revenue < .4);
  assert.ok(1 - imu.annualCost / imu.annualRevenue > .53);
});

test('芯动联科 profit bridge retains financial income, credit losses and tax credits separately', () => {
  for (const p of a.periods) {
    const core = p.revenue - p.cost - p.surcharge - p.sales - p.admin - p.rd;
    close(core, p.coreOperating);
    close(p.operating, core - p.finance + p.other + p.investment + p.fairValue + p.credit + p.disposal);
  }
  close(r.financialCny['2026H1'].net / 1e6 - 10.44603561, 26.03105503);
  assert.ok(r.financialCny['2026H1'].tax < 0);
  for (const path of Object.values(r.funding)) {
    for (const y of path.years) close(y.tax, Math.max(0, y.pretax) * .15);
  }
});

test('芯动联科 H1 cash distinguishes asset purchases, dividends and lease financing', () => {
  const f = a.cash, d = r.cashDetails;
  close(f.start + f.operating + f.investing + f.financing + f.fx, f.end);
  close(f.investing, d.investmentRedemptions + d.investmentIncomeCash - d.investmentPurchases - f.capex);
  close(f.financing, -d.dividend - d.leasePayments - d.dividendFee);
  close(f.operating - f.capex, -7.36351303);
  close(f.operating - f.capex - d.leasePayments, -12.94411951);
  close(sum(Object.values(r.operatingCashBridge)), 1.88285099);
  close(r.operatingCashBridge.shareCompensation, 15.82823637);
});

test('芯动联科 liquidity excludes IPO accounts and avoids double counting CDs', () => {
  const b = r.balance;
  close(b.grossFinancialAssets, 1810.05235185);
  close(b.ipoDedicated, 707.73493458);
  close(b.freeGross, 1102.31741727);
  close(b.nonDedicatedBank, 116.01527760);
  close(b.nonDedicatedInvestments, 986.30213967);
  close(b.modelLiquidity, b.nonDedicatedBank + .95 * b.nonDedicatedInvestments);
  close(b.operatingNwc, 631.28013083);
  close(b.receivablesGross - b.arAllowance, b.receivablesNet);
  assert.equal(r.assumptions.dedicatedFundsAvailable, 0);
  assert.equal(a.fullFundingModelVerified, false);
});

test('芯动联科 registered shares use registration date rather than later listing date', () => {
  const p = r.capital;
  close(p.priorRegisteredShares + p.newRegisteredShares, c.shares);
  close(p.issueCash / p.newRegisteredShares, p.impliedIssuePrice);
  assert.equal(c.shareDate, '2026-10-15');
  assert.equal(p.publishedAt, '2026-10-17');
  assert.equal(p.tradeableAt, '2026-10-23');
  close(p.legacy2023Buffer + p.legacy2025Buffer, 4.8);
  assert.equal(p.exactUnvestedLedgerVerified, false);
  assert.equal(p.legacyExerciseCashAssumed, 0);
  const q = quotes.find(q => q.symbol === '688582.SS');
  assert.deepEqual(q.observations.map(q => q.date), ['2026-10-14', '2026-10-15', '2026-10-16']);
  close(Math.round(q.observations.at(-1).close * 100) / 100, c.price.value);
});

test('芯动联科 terminal volume-price assumptions retain product margin limits', () => {
  for (const [key, rows] of Object.entries(r.terminalProducts)) {
    for (const p of rows) {
      close(p.revenue, p.units * p.asp / 1e6);
      close(p.grossProfit, p.revenue * p.grossMargin);
    }
    const end = r.funding[key].years.at(-1);
    close(end.revenue, sum(rows.map(p => p.revenue)));
    close(end.grossProfit, sum(rows.map(p => p.grossProfit)));
    const auto = rows.find(p => p.name.startsWith('汽车'));
    assert.ok(auto.grossMargin >= .3 && auto.grossMargin <= .5);
  }
  close(sum(r.terminalProducts.base.map(p => p.revenue)), 1216);
  close(sum(r.terminalProducts.bull.map(p => p.grossProfit)), 2455.2);
  close(r.terminalProducts.base.find(p => p.name === '新时钟芯片').revenue, 0);
});

test('芯动联科 annual cash, awards, fees and dividends roll through the same denominator', () => {
  for (const path of [...Object.values(r.funding), r.bankOnlyStress]) {
    const h = path.transition;
    close(h.startingLiquidity + h.cashChange + h.raiseNet, h.endCash);
    close(h.cashChange, h.net + h.da + h.sbc - h.nwcIncrease - h.capex + r.capital.issueCash);
    close(h.raiseGross * .95, h.raiseNet);
    close(h.newFundingShares, h.raiseGross / h.issuePrice);
    let cash = h.endCash, shares = h.endShares;
    let nwc = r.balance.operatingNwc + h.nwcIncrease;
    let priorYearNet = r.financialCny['2026H1'].net / 1e6 + h.net;
    for (const y of path.years) {
      close(y.startCash, cash); close(y.startShares, shares); close(y.openingNwc, nwc);
      close(y.grossProfit, y.revenue - y.cost);
      close(y.newSbc, y.newGrantShares * y.grantFairValue);
      close(y.sbc, y.newSbc + y.legacySbc);
      close(y.pretax, y.grossProfit - y.rdCash - y.sgaCash - y.da - y.sbc - y.revenue * (y.surchargeRate + y.creditRate));
      close(y.net, y.pretax - y.tax);
      close(y.closingNwc, y.revenue * y.receivableDays / 365 + y.cost * (y.inventoryDays - y.payableDays) / 365 + y.revenue * .015);
      close(y.nwcIncrease, y.closingNwc - y.openingNwc);
      close(y.operatingCash, y.net + y.da + y.sbc - y.nwcIncrease);
      close(y.endCash, y.startCash + y.operatingCash - y.capex - y.dividend + y.raiseNet);
      close(y.raiseGross * .95, y.raiseNet);
      close(y.fundingShares, y.raiseGross / y.issuePrice);
      close(y.endShares, y.startShares + y.legacyShares + y.newGrantShares + y.fundingShares);
      close(y.dividendPerShare * y.endShares, y.dividend);
      close(y.dividendEarningsBasis, priorYearNet);
      close(y.dividend, Math.max(0, priorYearNet) * y.dividendPayoutRate);
      assert.ok(y.endCash >= 200 - 1e-7);
      cash = y.endCash; shares = y.endShares; nwc = y.closingNwc; priorYearNet = y.net;
    }
    close(path.endingShares, shares);
    close(path.cumulativeDividendsPerShare, sum(path.years.map(y => y.dividendPerShare)));
    close(sum(path.years.map(y => y.legacyShares)), 4.8);
    close(path.totalRaiseNet, h.raiseNet + sum(path.years.map(y => y.raiseNet)));
  }
  close(r.bankOnlyStress.totalRaiseNet, 182.2455078487809);
  assert.ok(r.bankOnlyStress.endingShares > r.funding.bear.endingShares);
  assert.equal(r.assumptions.futureRentIncludedInCashExpenses, true);
  assert.equal(r.assumptions.futureDaExcludesRou, true);
});

test('芯动联科 price returns include dilution and do not add net cash twice', () => {
  const company = {price: c.price, shares: {value: c.shares}, financials: {anchorRevenue: 450}};
  for (const scenario of a.scenarios) {
    const terminal = r.funding[scenario.id].terminal;
    const p = M.project(company, scenario);
    close(p.profit, terminal.net);
    close(p.priceMultiple, terminal.priceMultiple);
    close(p.totalMultiple, terminal.totalMultiple);
    close(scenario.shares, r.funding[scenario.id].endingShares);
  }
  const bull = a.scenarios.find(s => s.id === 'bull');
  close(M.project(company, bull).priceMultiple, 3.2280538157577);
  close(M.project(company, bull).totalMultiple, 3.2656109256916617);
  const hurdle = M.hurdle(company, bull);
  close(hurdle.revenue, 11118.15417227664);
  close(hurdle.profit * bull.pe / bull.shares, 307);
  const bear = a.scenarios.find(s => s.id === 'bear');
  assert.ok(bear.margin < 0); assert.equal(bear.pe, null); assert.equal(bear.equityValue, 800);
});

test('芯动联科 evidence references resolve to original issuer documents', () => {
  const sources = new Map(data.sources.map(s => [s.id, s]));
  for (const id of [...c.sources, ...a.sections.flatMap(s => s.sources)]) {
    const s = sources.get(id);
    assert.ok(s && s.url.startsWith('https://'));
    assert.ok(s.publishedAt <= '2026-10-18');
  }
  assert.equal(c.market, 'cn');
  assert.equal(a.researchModel.assumptions.quarterlyPeakVerified, false);
  assert.match(c.gaps, /客户P/);
  assert.match(c.gaps, /全部未归属奖励/);
});
