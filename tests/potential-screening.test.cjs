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

test('current research opens the fresh finite screen and changes downloads and counts with history', () => {
  const f=fixture();
  assert.equal(rowIds(f.html).length,19);
  assert.ok(rowIds(f.html).includes('TSSI'));
  assert.ok(!rowIds(f.html).includes('688050'));
  assert.match(f.html,/利润增长靠什么/);
  assert.match(f.html,/股价快照 \/ 美元/);
  assert.equal(f.api.reportPath(),'docs/research/potential-screening-2026-10-19.md');
  assert.equal(f.api.companies().length,19);
  f.click('potential-history');
  assert.equal(rowIds(f.html).length,27);
  assert.ok(rowIds(f.html).includes('VKTX'));
  assert.equal(f.api.reportPath(),'docs/research/potential-screening-prior-2026-10-19.md');
  f.click('potential-legacy');
  assert.match(f.html,/此前研究 · 2026-10-18/);
  assert.ok(rowIds(f.html).includes('AMPX'));
  assert.doesNotMatch(f.html,/data-stock-row="VKTX"/);
  assert.equal(f.api.reportPath(),'docs/research/potential-stocks-2026-10-18.md');
  f.click('potential-current');
  assert.ok(rowIds(f.html).includes('TSSI'));
});

test('industry, priority and business search combine and clearing restores the screen', () => {
  const f=fixture();
  f.click('potential-sector','compute');
  assert.deepEqual(rowIds(f.html),['TSSI','SIMO','POWL','SANM','AMSC','AIP']);
  f.api.handleInput({value:'闪存'});f.H.render();
  assert.deepEqual(rowIds(f.html),['SIMO']);
  f.click('potential-reset');
  f.click('potential-status','priority');
  assert.deepEqual(rowIds(f.html),[]);
  assert.match(f.html,/没有高概率十倍结论/);
  f.click('potential-status','watch');
  assert.equal(rowIds(f.html).length,19);
  assert.ok(rowIds(f.html).includes('TSSI'));
  assert.ok(rowIds(f.html).includes('CXDO'));
  f.api.handleInput({value:'no such business'});f.H.render();
  assert.match(f.html,/当前条件没有匹配公司/);
  f.click('potential-reset');
  assert.equal(rowIds(f.html).length,19);
  assert.match(f.html,/<div class="stock-controls"><div class="filters"><input type="search" id="potential-search"/);
});

test('each company explains business and profit before judgement with traceable evidence', () => {
  const f=fixture();
  for (const c of f.screen.companies) {
    f.click('potential-screen-detail',c.id);
    const order=['公司做什么','机会为什么出现','利润如何放大','当前判断','关键风险与依据'].map(x=>f.modal.indexOf('<h3>'+x+'</h3>'));
    assert.ok(order.every((x,i)=>x>=0 && (!i || x>order[i-1])));
    assert.match(f.modal,/本轮已检验/);
    assert.match(f.modal,/什么会改变判断/);
    assert.match(f.modal,/UTC，盘后/);
    assert.match(f.modal,/原始来源与定位/);
    for (const id of c.sources) assert.ok(f.screen.sources.some(s=>s.id===id));
  }
  f.click('potential-screen-detail','TSSI');
  assert.match(f.modal,/每项经营输入：依据、用途与缺口/);
  assert.match(f.modal,/收入99%来自同一OEM/);
  f.click('potential-screen-detail','CXDO');
  assert.match(f.modal,/并发会话/);
  assert.match(f.modal,/6.83%/);
});

test('market switching respects the existing market control and keeps prior A-share research reachable', () => {
  const f=fixture();
  f.H.market='cn';f.H.render();
  assert.deepEqual(rowIds(f.html),[]);
  assert.match(f.html,/A股暂无本轮结果/);
  assert.doesNotMatch(f.html,/stock-market-nav|potential-market/);
  f.click('potential-history');
  assert.deepEqual(rowIds(f.html),[]);
  f.click('potential-legacy');
  assert.ok(rowIds(f.html).includes('688050'));
  f.click('potential-current');
  f.H.market='us';f.H.render();
  assert.equal(rowIds(f.html).length,19);
});

test('screen escapes source text and exports the same evidence and price time basis', () => {
  const f=fixture();
  const c=f.screen.companies[0];
  c.business='<img src=x onerror=alert(1)>';
  f.click('potential-screen-detail',c.id);
  assert.doesNotMatch(f.modal,/<img src=x/);
  assert.match(f.modal,/&lt;img/);
  const md=fs.readFileSync(f.screen.reportPath,'utf8');
  assert.match(md,/盘后/);
  assert.doesNotMatch(md,/十倍所需收入CAGR/);
  for (const company of f.screen.companies) {
    assert.ok(md.includes(company.profitMechanism));
    assert.ok(md.includes(company.check.answer));
    assert.ok(md.includes(company.quote.tradeTimeUtc));
  }
});


test('withdrawn forecasts cannot remain investment priorities or appear in product and report', () => {
  const f=fixture();
  f.click('potential-history');
  const archived=f.screen.previous;
  assert.equal(archived.newScreenCount,21);
  assert.deepEqual(Array.from(archived.companies.filter(c=>c.research), c=>c.id),['VKTX','KURA']);
  for (const id of ['PL','ASTS','AUR','BKSY','ARDX']) assert.equal(archived.companies.find(c=>c.id===id).selected,false);
  for (const id of ['VKTX','KURA']) {
    f.click('potential-screen-detail',id);
    assert.match(f.modal,/原盈利预测已撤回/);
    assert.match(f.modal,/原利润输入及依据（逐项）/);
    assert.match(f.modal,/重新估算需要的依据/);
    assert.doesNotMatch(f.modal,/2031年条件情景|PE假设区间|股价倍数<\/th>|份完整研究/);
    assert.doesNotMatch(f.modal,/进入下一轮|下一轮研究重点/);
    const c=archived.companies.find(c=>c.id===id);
    assert.equal(c.selected,false);
    assert.equal(c.research.modelStatus,'withdrawn');
    const md=fs.readFileSync(archived.reportPath,'utf8');
    assert.doesNotMatch(md,/### 2031年条件情景|\| PE假设区间 \|/);
    for (const section of c.research.sections) {
      for (const row of section.rows || []) for (const cell of row) {
        assert.ok(f.modal.includes(f.H.esc(cell)));
        assert.ok(md.includes(cell));
      }
      for (const sourceIds of section.rowSources || []) for (const sourceId of sourceIds) {
        const source=archived.sources.find(s=>s.id===sourceId);
        assert.ok(source,sourceId);
        assert.ok(f.modal.includes(f.H.esc(source.url)));
        assert.ok(md.includes(source.url));
      }
    }
  }
  f.click('potential-screen-detail','KURA');
  assert.match(f.modal,/50%/);
  assert.match(f.modal,/海外提成/);
  f.click('potential-screen-detail','VKTX');
  assert.match(f.modal,/治疗中止率28%/);
  assert.match(f.modal,/24.5%/);
  assert.match(f.modal,/449美元\/28天/);
  assert.match(f.modal,/不证明有人这样付满一年/);
  assert.match(f.modal,/50美元\/月/);
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
