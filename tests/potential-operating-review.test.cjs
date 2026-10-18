const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/potential-screening.json');
const quotes = require('../data/potential-screening-quotes.json');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('a tenfold share price needs more profit when shares increase; PE is a sensitivity, not a forecast', async () => {
  const { tenfoldRequirements } = await import('../scripts/potential_operating_review.mjs');
  const p = tenfoldRequirements(7.07, 28.219070, 20);
  close(p.price, 70.7);
  close(p.profit, 99.75441245);
  close(tenfoldRequirements(7.07, 29.219070, 20).profit - p.profit, p.profitPerNewMillionShares);
  close(tenfoldRequirements(7.07, 28.219070, 40).profit, p.profit / 2);
  assert.throws(() => tenfoldRequirements(7.07, 28.219070, 0));
});

test('acquired revenue is removed before comparing the original business, without removing it twice', async () => {
  const { organicGrowth } = await import('../scripts/potential_operating_review.mjs');
  close(organicGrowth(24.646, 6.963, 16.552), 1.131 / 16.552);
  assert.ok(organicGrowth(24.646, 0, 16.552) > 0.48);
  assert.throws(() => organicGrowth(24.646, 30, 16.552));
});

test('integration hurdle keeps depreciation in gross profit and normalizes tax without pretending revenue was forecast', async () => {
  const { integrationHurdle } = await import('../scripts/potential_operating_review.mjs');
  const b = data.companies.find(c=>c.id==='TSSI').research.integrationBridge;
  const h = integrationHurdle(99.75441245, b);
  close(h.normalizedAnnualProfit, 6.5424);
  close(h.additionalRevenue * (4.439 / 14.169) * .725 + h.normalizedAnnualProfit, 99.75441245);
  assert.ok(h.additionalRevenue > 400);
});

test('new round has no recycled companies or unexplained forecast inputs and all detail evidence resolves', async () => {
  const { researchSections } = await import('../scripts/potential_research_sections.mjs');
  const old = new Set(require('../data/potential-screening-prior.json').companies.map(c=>c.id));
  assert.equal(data.companies.length, 19);
  assert.equal(data.newScreenCount, 19);
  assert.ok(data.companies.every(c=>!old.has(c.id)));
  for (const c of data.companies.filter(c=>c.research)) {
    assert.equal(c.selected, false);
    assert.equal(c.research.modelStatus, 'no_calibrated_forecast');
    assert.equal(c.research.cases, undefined);
    c.quote = quotes.quotes.find(q=>q.symbol===c.id);
    const sections = researchSections(c);
    for (const section of sections) {
      for (const id of [...section.sources || [], ...(section.rowSources || []).flat()]) assert.ok(data.sources.some(s=>s.id===id), id);
    }
    const broken = structuredClone(c);
    broken.research.inputs[0].evidence = '';
    assert.throws(()=>researchSections(broken), /incomplete operating input evidence/);
  }
  for (const symbol of ['SIMO','FINV']) assert.equal(quotes.quotes.find(q=>q.symbol===symbol).marketCapUse, 'excluded');
});
