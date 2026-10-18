const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const M = require('../assets/potential-model.js');
const c = data.comparisons.find(x => x.id === '688150');
const a = c.audit;
const f = a.funding;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message || ''}: ${actual} != ${expected}`);
const allPaths = [...Object.values(f.paths), ...f.stress.cases];

test('Lighte uses actual October bond proceeds, September shares and the fixed October close', () => {
  near(f.bondFace - 6.90211223, f.netBondProceeds, 'actual issue costs');
  near(f.netBondProceeds, 517.87688777);
  assert.equal(c.shareDate, '2026-09-24');
  near(a.capital.registered - a.capital.treasury, a.capital.participatingShares);
  assert.equal(a.capital.planUnitsAreNewShares, false);
  const q = quotes.find(x => x.symbol === '688150.SS');
  assert.equal(q.basis, 'unadjusted_regular_session_close');
  assert.equal(c.price.asOf, '2026-10-16');
  assert.equal(Math.round(q.observations.find(x => x.date === c.price.asOf).close * 100) / 100, c.price.value);
  assert.ok(data.sources.some(x => x.id === 'lighte-funds' && x.publishedAt === '2026-10-16'));
});

test('Lighte reconciles group profit, parent profit and each cash statement subtotal', () => {
  const e = a.earnings, k = a.cash;
  near(e.parentNet + e.minorityNet, e.groupNet);
  near(e.groupNet + e.cashAdjustments.reduce((x,y) => x+y, 0), k.operating);
  near(k.investmentRedemptions + k.investmentIncomeCash - k.investmentPurchases - k.capex, k.investing);
  near(k.minorityCapital + k.esopCashReturned + k.debtBorrowed - k.debtRepaid - k.dividendAndInterestCash, k.financing);
  near(k.start + k.operating + k.investing + k.financing + k.fx, k.end);
  assert.equal(k.debtBorrowed, 0, '20m borrowing belongs to the prior-year column');
  near(k.operating - k.capex, -174.1103889);
  near(a.history.ltmOperatingCash - a.history.ltmCapex, -113.85164171);
});

test('Lighte separates terminal capacity, client concentration and minority-owned Q-cloth profit', () => {
  const p = a.products;
  assert.ok(Math.abs(p.terminalProductionKgH1 / p.terminalCapacityKgH1 - p.terminalUtilizationH1) < .0001);
  assert.equal(p.boeShareH1, .8953);
  assert.equal(p.boeReceivableShare, .9266);
  assert.equal(p.qRevenueH1, 0);
  assert.equal(p.perovskiteRevenueH1, .02331244);
  near(p.bullParts.reduce((s,x) => s+x.revenue*x.netMargin*x.parentOwnership, 0), 741.912);
  for (const x of p.bullParts.filter(x => x.quantity)) near(x.quantity*x.price/1e6, x.revenue);
  assert.ok(p.bullParts.find(x => x.name === 'Q布').quantity <= p.qPlannedAnnualMeters);
});

test('Lighte keeps IPO and bond money separate from general cash in every path', () => {
  near(f.openingCashEquivalent - f.ipoProtected - f.oldDebtReserved, f.openingFree);
  for (const path of allPaths) {
    let free=f.openingFree, ipo=f.ipoProtected, bond=f.netBondProceeds;
    for (const r of path.rows) {
      near(r.openingFree, free);
      assert.ok(r.bondDraw <= r.projectSpend-r.projectForbidden+1e-6);
      bond-=r.bondDraw; ipo-=r.ipoSpend;
      near(r.bondRemaining, bond); near(r.ipoRemaining, ipo);
      near(r.projectSelf+r.bondDraw, r.projectSpend);
      assert.ok(bond>=-1e-6 && ipo>=-1e-6);
      near(r.freeCash, r.groupNet+r.sbc+r.depreciation-r.workingCapital-r.maintenance-r.qCapex-r.legacyCapex-r.perovskiteCapex-r.projectSelf);
      free+=r.freeCash-r.dividend-r.minorityDividend-r.putCash-r.maturityReserve+r.raiseNet;
      near(r.endingFree, free);
      assert.ok(r.endingFree>=f.minimumCash-1e-6);
      near(r.raiseNet, Math.max(0,f.minimumCash-r.cashBeforeFunding));
    }
    near(bond, 0); near(ipo, 0);
  }
});

test('Lighte applies project working-capital cash once, then credits it against growth needs', () => {
  for (const path of allPaths) {
    let pool=0;
    for (const r of path.rows) {
      pool+=r.projectWcAdded;
      assert.ok(r.projectWcCreditUsed<=pool+1e-6);
      near(r.workingCapital+r.projectWcCreditUsed,r.workingCapitalGross);
      pool-=r.projectWcCreditUsed;
      near(r.projectWcCreditRemaining,pool);
    }
  }
  near(f.paths.base.rows.reduce((s,r)=>s+r.projectWcAdded,0),22.4338);
  near(f.paths.base.rows.reduce((s,r)=>s+r.projectSpend,0),557.5076);
  near(f.paths.base.rows.reduce((s,r)=>s+r.projectSelf,0),557.5076-517.87688777);
});

test('Lighte does not count treasury releases as new registered shares', () => {
  for (const path of allPaths) {
    let shares=a.capital.registered, treasury=a.capital.treasury, dividends=0;
    for (const r of path.rows) {
      near(r.grants,r.treasuryUsed+r.newGrantShares);
      treasury-=r.treasuryUsed;
      shares+=r.newGrantShares+r.issueShares+r.convertedShares;
      near(r.shares,shares); near(r.treasuryRemaining,treasury);
      near(r.issueShares*r.issuePrice*(1-f.issueFeeRate),r.raiseNet);
      if(r.year>2026) near(r.sbc,r.grants*r.issuePrice);
      near(r.dividendPerShare*(shares-treasury),r.dividend);
      dividends+=r.dividendPerShare;
    }
    near(path.shares,shares); near(path.dividends,dividends);
  }
});

test('Lighte models conversion, put risk and maturity cash as mutually exclusive bond outcomes', () => {
  const bear=f.paths.bear.rows, base=f.paths.base.rows, bull=f.paths.bull.rows;
  assert.ok(bear.find(r=>r.year===2030).putCash>f.bondFace);
  near(bear.at(-1).coupon,0); near(bear.at(-1).maturityReserve,0);
  near(base.at(-1).maturityReserve,f.bondFace*1.10);
  near(base.at(-1).bondFaceRemaining,f.bondFace);
  assert.ok(base.every(r=>r.convertedShares===0 && r.putCash===0));
  const converted=bull.find(r=>r.year===2029);
  near(converted.convertedShares*converted.conversionPriceUsed,f.bondFace);
  assert.ok(converted.conversionPriceUsed<f.initialConversionPrice);
  for(const r of bull.filter(r=>r.year>=2029)) {
    near(r.coupon,0); near(r.putCash,0); near(r.maturityReserve,0); near(r.bondFaceRemaining,0);
  }
  for(const path of allPaths) for(const r of path.rows) near(r.parentNet,r.coreProfit+r.otherProfit+f.qOwnership*r.qProfit-r.coupon);
});

test('Lighte returns use funded shares and separate dividends; low-price funding dilutes value', () => {
  for(const s of a.scenarios) {
    const p=M.project({price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}},s), path=f.paths[s.id];
    near(p.priceMultiple,path.priceMultiple); near(p.totalMultiple,path.totalMultiple);
    near(path.tenfoldRevenue*s.margin*s.pe/s.shares,c.price.value*10);
    assert.ok(s.pe<=30);
  }
  const stress=f.stress.cases;
  assert.ok(stress[2].shares>stress[1].shares && stress[1].shares>stress[0].shares);
  assert.ok(stress[2].totalMultiple<stress[1].totalMultiple && stress[1].totalMultiple<stress[0].totalMultiple);
  assert.ok(f.paths.base.totalMultiple<1 && f.paths.bull.totalMultiple<2);
});
