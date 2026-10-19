const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/potential-screening.json');
const quotes = require('../' + data.quotePath);
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
  const b = require('../data/potential-screening-round4.json').companies.find(c=>c.id==='TSSI').research.integrationBridge;
  const h = integrationHurdle(99.75441245, b);
  close(h.normalizedAnnualProfit, 6.5424);
  close(h.additionalRevenue * (4.439 / 14.169) * .725 + h.normalizedAnnualProfit, 99.75441245);
  assert.ok(h.additionalRevenue > 400);
});

test('new discoveries extend the cumulative input without duplicates and resolve input evidence', async () => {
  const { researchSections } = await import('../scripts/potential_research_sections.mjs');
  const prior = require('../data/potential-screening-round4.json');
  const old = new Set([prior, require('../data/potential-screening-prior.json'), require('../data/potential-stocks.json')].flatMap(d => [...d.companies, ...d.comparisons || []]).map(c=>c.id));
  assert.ok(data.companies.length >= 29);
  assert.equal(data.newScreenCount, data.companies.length);
  assert.equal(new Set(data.companies.map(c=>c.id)).size, data.companies.length);
  assert.ok(data.companies.every(c=>!old.has(c.id)));
  assert.deepEqual(new Set(data.companies.filter(c=>c.selected).map(c=>c.id)), new Set(['BLZE','STRL','IESC']));
  for (const c of data.companies.filter(c=>c.research)) {
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
});

test('storage sensitivity separates business growth, gross profit and retained operating costs', async () => {
  const { storageScale } = await import('../scripts/potential_operating_review.mjs');
  const base={b2Revenue:100,backupRevenue:50,operatingExpenses:80,years:1};
  const scenario={b2Growth:1,backupGrowth:-.5,grossMargin:.6,expenseGrowth:.2};
  assert.deepEqual(storageScale(base,scenario),{revenue:225,grossProfit:135,operatingExpenses:96,operatingProfit:39});
  close(storageScale({...base,operatingExpenses:90},scenario).operatingProfit,27);
  assert.throws(()=>storageScale(base,{...scenario,grossMargin:1.1}));
  assert.throws(()=>storageScale(base,{...scenario,b2Growth:-1}));
  assert.throws(()=>storageScale({...base,years:0},scenario));
});

test('a strong storage operating case still does not prove tenfold net profit after dilution', async () => {
  const { storageScale, tenfoldRequirements } = await import('../scripts/potential_operating_review.mjs');
  const b=data.companies.find(c=>c.id==='BLZE');
  const r=b.research.storageScale;
  const result=storageScale(r.base,r.cases.at(-1));
  close(result.operatingProfit,151.613529);
  const hurdle=tenfoldRequirements(8.6,b.research.hurdle.shares,40);
  close(hurdle.profit,193.5);
  assert.ok(result.operatingProfit<hurdle.profit);
  // Do not compare a gross contract value or EBITDA with a net-profit requirement.
  assert.equal(b.research.hurdle.shares,90);
  assert.ok(b.research.storageScale.cases.every(c=>c.reason));
});

// Evidence-only reviews must not fabricate a tenfold model just to render facts.
test('an evidence-only CNY review renders without a dollar quote or PE assumptions', async () => {
  const { researchSections } = await import('../scripts/potential_research_sections.mjs');
  const c = structuredClone(data.companies.find(c=>c.id==='688630'));
  c.quote = quotes.quotes.find(q=>q.symbol===c.id);
  const sections=researchSections(c);
  assert.equal(c.quote.priceUsd,undefined);
  assert.equal(c.research.hurdle,undefined);
  assert.ok(sections.some(s=>s.title.includes('费用摊薄')));
  assert.ok(sections.every(s=>s.title!=='当前价格要求多大的利润'));
  assert.doesNotMatch(JSON.stringify(sections),/NaN|undefined/);
});
