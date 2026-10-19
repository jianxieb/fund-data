const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/potential-model.js');

function fixture() {
  const context = { window: { ChanghengPotentialModel: M, POTENTIAL_RESEARCH: structuredClone(require('../data/potential-stocks.json')) } };
  vm.createContext(context);
  for (const path of ['data/potential-screening.js','assets/potential-stocks.js']) vm.runInContext(fs.readFileSync(path,'utf8'),context);
  let html = '', modal = '';
  const api = context.window.ChanghengPotential;
  const H = {
    esc: v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    money: (v,d=2) => v.toFixed(d), pct: v => v + '%', pc: v => v + '%',
    action: (text,action,cls='',extra='') => `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`,
    modalTitle: (title,subtitle) => `<h2>${title}</h2><p>${subtitle}</p>`,
    openModal: content => { modal=content; },
    render: () => { html=api.view(H); }, market: 'us', annual: false,
    annualControl: () => ''
  };
  H.render();
  return { api,H,screen:context.window.POTENTIAL_SCREENING,click:(action,value)=>api.handleAction({dataset:{action,value}}),get html(){return html;},get modal(){return modal;} };
}
const rowIds = html => [...html.matchAll(/data-stock-row="([^"]+)"/g)].map(x=>x[1]);

test('one cumulative list deduplicates all research and has no round navigation', () => {
  const f=fixture(), all=f.api.companies();
  assert.ok(all.length>=100);
  assert.ok(all.every(c=>['us','cn'].includes(c.market)));
  assert.ok(rowIds(f.html).includes('VICR'), 'legacy US market spelling must remain visible');
  assert.equal(new Set(all.map(c=>c.market+':'+c.id)).size,all.length);
  for (const id of ['BLZE','TSSI','VKTX','AMPX','AEHR','GCT']) assert.ok(rowIds(f.html).includes(id),id);
  assert.equal(all.filter(c=>c.id==='GCT').length,1);
  assert.equal(all.find(c=>c.id==='GCT').quoteSource,'screen1:screen-quotes');
  assert.doesNotMatch(f.html,/查看上一轮|返回本轮|查看更早研究|potential-history|potential-current/);
  assert.equal(f.api.reportPath(),'docs/research/potential-research-catalog.md');
  assert.match(f.html,/研究优先级/);
});

test('one search spans previous rounds and legacy comparisons, with priority and industry filters', () => {
  const f=fixture();
  for (const id of ['BLZE','TSSI','VKTX','AEHR','AMPX']) {
    f.api.handleInput({value:id});f.H.render();
    assert.ok(rowIds(f.html).includes(id),id);
  }
  f.click('potential-reset');f.click('potential-status','priority');
  assert.deepEqual(new Set(rowIds(f.html)),new Set(f.screen.companies.filter(c=>c.market==='us'&&c.selected).map(c=>c.id)));
  assert.ok(!rowIds(f.html).includes('VKTX'));
  f.click('potential-reset');f.click('potential-sector','infra');
  assert.ok(rowIds(f.html).includes('BLZE'));
  assert.ok(!rowIds(f.html).includes('VKTX'));
  f.api.handleInput({value:'no such business'});f.H.render();
  assert.match(f.html,/当前条件没有匹配公司/);
  f.click('potential-reset');
  assert.match(f.html,/<div class="stock-controls"><div class="filters"><input type="search" id="potential-search"/);
});

test('company ordering uses priority or the selected sort, not research round', () => {
  const f=fixture();
  const rows=rowIds(f.html).map(id=>f.screen.companies.find(c=>c.id===id));
  assert.ok(rows.every((c,i)=>!i||c.priorityRank>=rows[i-1].priorityRank));
  f.click('potential-catalog-sort','name');
  const names=rowIds(f.html).map(id=>f.screen.companies.find(c=>c.id===id).name);
  assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,'zh-CN')));
  f.click('potential-catalog-sort','recent');
  const dates=rowIds(f.html).map(id=>f.screen.companies.find(c=>c.id===id).reviewedAt);
  assert.deepEqual(dates,[...dates].sort().reverse());
});

test('each company preserves dated evidence, readable business and currency in the common detail', () => {
  const f=fixture();
  for (const c of f.screen.companies) {
    f.H.market=c.market;f.H.render();f.click('potential-screen-detail',c.id);
    const order=['公司做什么','机会为什么出现','利润如何放大','当前判断','关键风险与依据'].map(x=>f.modal.indexOf('<h3>'+x+'</h3>'));
    assert.ok(order.every((x,i)=>x>=0 && (!i || x>order[i-1])),c.id);
    assert.match(f.modal,/已检验问题/);
    assert.ok(f.modal.includes(c.reviewedAt));
    assert.ok(f.modal.includes(c.quote.tradeTimeUtc || c.quote.date));
    assert.ok(f.modal.includes(c.market==='cn'?'元':'美元'));
    assert.doesNotMatch(f.modal,/来源缺失：|undefined|NaN/);
    for (const id of c.sources) assert.ok(f.screen.sources.some(s=>s.id===id));
  }
  f.H.market='us';f.H.render();f.click('potential-screen-detail','BLZE');
  assert.match(f.modal,/636.64/);assert.match(f.modal,/盘前/);
  f.click('potential-screen-detail','QNST');assert.match(f.modal,/50.025/);
  f.click('potential-screen-detail','AMPX');assert.match(f.modal,/打开公司既有材料/);
});

test('existing market controls expose A shares directly and do not mix currencies', () => {
  const f=fixture();f.H.market='cn';f.H.render();
  for (const id of ['688050','688389','300832','688582']) assert.ok(rowIds(f.html).includes(id),id);
  assert.doesNotMatch(f.html,/A股暂无本轮|stock-market-nav|potential-market/);
  assert.match(f.html,/股价快照 \/ 人民币/);
  f.click('potential-screen-detail','688582');
  assert.match(f.modal,/30.70 元/);assert.doesNotMatch(f.modal,/股价 30.70 美元/);
  f.H.market='us';f.H.render();assert.ok(!rowIds(f.html).includes('688582'));
});

test('unified download includes every company and escapes source text in the product', () => {
  const f=fixture(), md=fs.readFileSync(f.screen.reportPath,'utf8');
  for (const c of f.screen.companies) {
    assert.ok(md.includes(c.business),c.id);
    assert.ok(md.includes(c.check.answer),c.id);
    assert.ok(md.includes(c.quote.tradeTimeUtc || c.quote.date),c.id);
  }
  const c=f.screen.companies.find(c=>c.id==='BLZE');
  c.business='<img src=x onerror=alert(1)>';
  f.click('potential-screen-detail',c.id);
  assert.doesNotMatch(f.modal,/<img src=x/);assert.match(f.modal,/&lt;img/);
});

test('withdrawn forecasts stay withdrawn after consolidation and keep their source provenance', () => {
  const f=fixture();
  for (const id of ['VKTX','KURA']) {
    const c=f.screen.companies.find(c=>c.id===id);
    f.click('potential-screen-detail',id);
    assert.equal(c.selected,false);assert.equal(c.research.modelStatus,'withdrawn');
    assert.match(f.modal,/原盈利预测已撤回/);
    assert.match(f.modal,/原利润输入及依据（逐项）/);
    assert.doesNotMatch(f.modal,/2031年条件情景|PE假设区间|股价倍数<\/th>/);
    for (const section of c.research.sections) for (const ids of section.rowSources || []) for (const id of ids) {
      const source=f.screen.sources.find(s=>s.id===id);assert.ok(source);
      assert.ok(f.modal.includes(f.H.esc(source.url)));
    }
  }
});

test('withdrawal bypasses valuation and requires evidence review for every operating and capital input', async () => {
  const {researchSections}=await import('../scripts/potential_research_sections.mjs');
  const c=structuredClone(require('../data/potential-screening-prior.json').companies.find(c=>c.id==='VKTX'));
  // With no quote or a usable issuance price, an active projection would fail.
  // A withdrawn case must still show its evidence without calculating prices.
  c.research.capital.issuePrice=0;
  const sections=researchSections(c);
  assert.equal(sections[0].title,'原盈利预测已撤回');
  c.research.cases[0].unexplainedForecast=1000000;
  assert.throws(()=>researchSections(c),/missing input evidence review for unexplainedForecast/);
  delete c.research.cases[0].unexplainedForecast;
  c.research.evidenceReview.assumptions[0].sources=[];
  assert.throws(()=>researchSections(c),/incomplete input evidence review/);
});
