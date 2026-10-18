const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-stocks.json'), 'utf8'));
const quotes = JSON.parse(fs.readFileSync(path.join(root, 'data/potential-quotes.json'), 'utf8'));
const M = require('../assets/potential-model.js');
const c = data.comparisons.find(x => x.id === 'CEVA');
const a = c.audit;
const near = (actual, expected, eps = 1e-8) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
const company = {price:c.price,shares:{value:c.shares},financials:{anchorRevenue:c.anchorRevenue}};

test('CEVA uses dated outstanding shares and unadjusted close, not the old weighted average', () => {
  assert.equal(c.shareDate,'2026-08-04');
  near(c.shares,28.154072);
  near(c.price.value,27.5);
  near(c.price.value*c.shares,774.23698);
  const q=quotes.find(x=>x.symbol==='CEVA');
  assert.equal(q.basis,'unadjusted_regular_session_close');
  const end=q.observations.at(-1);
  assert.equal(end.date,'2026-10-16');
  near(end.close,c.price.value);
});

test('CEVA LTM joins matching periods and retains negative owner earnings and capex', () => {
  const [y24,y25,h25,h26,ltm]=a.periods;
  for(const field of ['revenue','cost','operating','net','operatingCash','capex','sbc','license','royalty'])
    near(ltm[field],y25[field]-h25[field]+h26[field]);
  near(ltm.revenue,115.732);
  near(ltm.net,-10.976);
  near(ltm.fcf,-1.063);
  near(h26.fcf,-2.009);
  near(h26.net,-7.161+2.855+.088-3.151);
  near(y24.fcf,.516);
  near(ltm.sbc,21.114);
});

test('CEVA revenue growth is predominantly licensing and the royalty mix offsets reconcile', () => {
  const r=a.revenueQuality;
  const h25=r.mix.find(x=>x.label==='2025H1'),h26=r.mix.find(x=>x.label==='2026H1');
  near(h26.connectRoyalty+h26.senseRoyalty,20.016);
  near(h25.connectRoyalty+h25.senseRoyalty,19.859);
  near(h26.connectRoyalty-h25.connectRoyalty,.348);
  near(h26.senseRoyalty-h25.senseRoyalty,-.191);
  near((36.041-30.064)+(20.016-19.859),56.057-49.923);
  assert.ok((36.041-30.064)/(56.057-49.923)>.97);
  near(r.h1LicensePoint+r.h1LicenseOverTime,36.041);
  near(r.remainingPerformanceObligations.reduce((x,y)=>x+y,0),11.507);
});

test('CEVA terminal markets reconcile to reported shipments without adding technology categories', () => {
  const r=a.revenueQuality;
  near(r.q2EndMarketUnits2025.reduce((x,y)=>x+y,0),488);
  near(r.q2EndMarketUnits2026.reduce((x,y)=>x+y,0),567);
  near(r.q2Units2026/r.q2Units2025-1,.16188524590163933);
  near(r.q2Royalty2026/r.q2Royalty2025-1,.014639639639639545);
  near((r.q2Royalty2026/r.q2Units2026)/(r.q2Royalty2025/r.q2Units2025)-1,-.1267299045076824);
  assert.ok(r.q2EndMarketUnits2026[2]<r.q2EndMarketUnits2025[2] && r.industrialRoyaltyGrowth>0);
});

test('CEVA external issuance and award bridges do not disappear into buyback authorization', () => {
  const k=a.capital;
  near(k.shares2024-k.buyback2025+k.offeringShares+k.newSharesAwards2025+k.treasuryReissued2025,k.shares2025);
  near(k.shares2025+k.newSharesAwardsH1+k.treasuryReissuedH1,k.sharesJune);
  near(k.unvestedStart+k.granted-k.vested-k.forfeited,k.unvestedEnd);
  near(k.sharesJune+k.unvestedEnd+k.options,30.013670);
  near(k.offeringShares*k.offeringGrossPrice,67.275);
  near(k.offeringNetCash,63.261);
  assert.ok(k.offeringShares>k.buyback2025);
  assert.ok(a.scenarios.every(s=>s.shares>k.sharesJune+k.unvestedEnd+k.options));
});

test('CEVA cash roll keeps securities redemption and employee proceeds outside operating cash', () => {
  const f=a.cash,l=a.liquiditySensitivity;
  near(f.start+f.operating+f.investing+f.financing+f.fx,f.end);
  near(f.operating-f.capex-f.capexPrepaid,-2.009);
  near(l.cash+l.deposits+l.bonds,220.720);
  near(l.bondsWithinYear+l.bondsAfterYear,l.bonds);
  near(220.720-(40.586+2.095+179.302),-1.263);
  assert.ok(l.reportedLiquidAssets>l.cash && l.foreignHoldingsRounded>0);
});

test('CEVA operating cases retain taxes in loss case and use dilution in terminal prices', () => {
  for(const s of a.scenarios){
    near(s.revenue,s.license+s.royalty);
    near(s.grossProfit,s.revenue*s.grossMargin);
    near(s.operating,s.grossProfit-s.rd-s.salesMarketing-s.generalAdministration-s.amortization);
    near(s.net,s.operating+s.financialIncome-s.tax);
    near(s.margin*s.revenue,s.net);
    near(M.project(company,s).price,s.price);
  }
  const [bear,base,bull]=a.scenarios;
  near(bear.net,-9);near(bear.tax,3);assert.equal(bear.pe,null);
  near(base.net,46.5);near(bull.net,146.25);
  near(M.project(company,base).priceMultiple,1.2433155080213902);
  near(M.project(company,bull).priceMultiple,4.762550881953866);
});

test('CEVA tenfold hurdle and combined valuation dilution stress exceed the bullish operating case', () => {
  const bull=a.scenarios.find(s=>s.id==='bull');
  const h=M.hurdle(company,{shares:33.5,margin:.35,pe:30});
  near(h.profit,307.0833333333333);
  near(h.revenue,877.3809523809524);
  assert.ok(h.profit>bull.net*2);
  near(M.project(company,{...bull,pe:22.5,shares:40.2}).priceMultiple,4.762550881953866*.75/1.2);
  assert.equal(a.fullFundingModelVerified,false);
});

test('CEVA acquisition stress adds issuance only for a real cash shortfall and guidance stays prospective', () => {
  const l=a.liquiditySensitivity;
  near(l.stressedStartingAssets,212.15645);
  near(l.afterFiveYears,132.15645);
  near(l.acquisitionHeadroom,92.15645);
  near(l.netRaiseIfAcquisition,57.84355);
  near(l.extraSharesAt15*15*(1-l.issueFee),l.netRaiseIfAcquisition);
  near(l.extraSharesAt10*10*(1-l.issueFee),l.netRaiseIfAcquisition);
  assert.equal(a.guidance.actual,false);
  near(a.guidance.revenueLow,123.84574);
  near(a.guidance.revenueHigh,126.0377);
  assert.equal(a.guidance.nextRelease,'2026-11-09');
});

