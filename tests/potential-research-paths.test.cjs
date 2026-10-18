const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/potential-model.js');
const data = require('../data/potential-screening-prior.json');
const quotes = require('../data/potential-screening-quotes.json');
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
const capital = {outstanding:100,potential:0,futureAwards:0,netFunding:0,issuePrice:10,issueFee:.03};
const scenario = {patientYears:1000,netAnnualReceipt:100000,contributionMargin:.6,profitShare:.5,foreignRevenue:200,royaltyRate:.1,operatingExpense:25,interest:1,taxRate:.25,peRange:[10,20]};

test('shared drug retains half of US commercial profit and only foreign royalties', () => {
  const c={quote:{priceUsd:1},research:{kind:'shared_drug',capital}};
  const p=M.researchProjection(c,scenario);
  // $100m US sales -> $60m commercial profit -> $30m retained;
  // $20m foreign royalties - $25m overhead - $1m interest -> $18m net.
  close(p.revenue,100); close(p.retainedProfit,30); close(p.royalty,20);
  close(p.netIncome,18);close(p.eps,.18);
  assert.deepEqual(p.prices,[1.7999999999999998,3.5999999999999996]);
  const noRoyalty=M.researchProjection(c,scenario,{royaltyRate:0});
  close(p.netIncome-noRoyalty.netIncome,15);
});

test('owned drug retains its contribution; loss has no positive tax benefit or PE value', () => {
  const c={quote:{priceUsd:1},research:{kind:'owned_drug',capital}};
  const p=M.researchProjection(c,scenario);
  close(p.royalty,0); close(p.netIncome,25.5);
  const loss=M.researchProjection(c,scenario,{operatingExpense:100});
  close(loss.netIncome,-41);
  assert.equal(loss.prices,null); assert.equal(loss.multiples,null);
});

test('net funding includes issue fees, and financing stress dilutes the same earnings', () => {
  const c={...capital,outstanding:80,potential:10,futureAwards:5,netFunding:97};
  const base=M.researchCapital(c);
  close(base.newShares,10);close(base.shares,105);
  const stress=M.researchCapital(c,{issuePrice:5});
  close(stress.newShares,20);close(stress.shares,115);
});

test('archived assumptions stay explicit and stress never improves per-share results', () => {
  for(const raw of data.companies.filter(c=>c.research)) {
    const c={...raw,quote:quotes.quotes.find(q=>q.symbol===raw.id)},r=c.research;
    for(const s of r.cases) {
      const base=M.researchProjection(c,s);
      const stress=M.researchProjection(c,s,{patientYears:s.patientYears*.75,netAnnualReceipt:s.netAnnualReceipt*.75,capital:{netFunding:r.capital.stressNetFunding,issuePrice:r.capital.stressIssuePrice}});
      assert.ok(base.shares>r.capital.outstanding);
      assert.ok(stress.shares>base.shares);
      assert.ok(stress.netIncome<base.netIncome);
      if(stress.multiples) assert.ok(stress.multiples[1]<base.multiples[1]);
      assert.equal(s.taxRate,.25);
    }
    assert.equal(r.sections,undefined,'computed presentation belongs in generated output');
  }
  const v=data.companies.find(c=>c.id==='VKTX');
  close(v.research.capital.potential,1.813501+5.990015);
});

test('missing or invalid financial inputs fail instead of silently creating a target', () => {
  const c={quote:{priceUsd:1},research:{kind:'shared_drug',capital}};
  assert.throws(()=>M.researchProjection(c,{...scenario,royaltyRate:undefined}),RangeError);
  assert.throws(()=>M.researchProjection(c,{...scenario,peRange:[30,20]}),RangeError);
  assert.throws(()=>M.researchProjection(c,{...scenario,contributionMargin:1.1}),RangeError);
  assert.throws(()=>M.researchCapital({...capital,issueFee:1}),RangeError);
  assert.throws(()=>M.researchCapital({...capital,netFunding:-1}),RangeError);
});
