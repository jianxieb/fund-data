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
  assert.equal(rowIds(f.html).length,6);
  assert.ok(rowIds(f.html).includes('PL'));
  assert.ok(!rowIds(f.html).includes('688050'));
  assert.match(f.html,/利润增长靠什么/);
  assert.match(f.html,/股价快照 \/ 美元/);
  assert.equal(f.api.reportPath(),'docs/research/potential-screening-2026-10-19.md');
  assert.equal(f.api.companies().length,6);
  f.click('potential-history');
  assert.match(f.html,/此前研究 · 2026-10-18/);
  assert.ok(rowIds(f.html).includes('AMPX'));
  assert.doesNotMatch(f.html,/data-stock-row="PL"/);
  assert.equal(f.api.reportPath(),'docs/research/potential-stocks-2026-10-18.md');
  f.click('potential-current');
  assert.ok(rowIds(f.html).includes('PL'));
});

test('industry, priority and business search combine and clearing restores the screen', () => {
  const f=fixture();
  f.click('potential-sector','satellite');
  assert.deepEqual(rowIds(f.html),['PL','ASTS']);
  f.api.handleInput({value:'普通手机'});f.H.render();
  assert.deepEqual(rowIds(f.html),['ASTS']);
  f.click('potential-reset');
  f.click('potential-status','priority');
  assert.deepEqual(rowIds(f.html),['PL','ASTS','AUR']);
  f.click('potential-status','watch');
  assert.deepEqual(rowIds(f.html),['CRDO','ALAB','SERV']);
  f.api.handleInput({value:'no such business'});f.H.render();
  assert.match(f.html,/当前条件没有匹配公司/);
  f.click('potential-reset');
  assert.equal(rowIds(f.html).length,6);
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
  f.click('potential-screen-detail','ASTS');
  assert.match(f.modal,/不能把总收入都说成手机用户持续订阅/);
  f.click('potential-screen-detail','AUR');
  assert.match(f.modal,/非约束性MOU/);
});

test('market switching respects the existing market control and keeps prior A-share research reachable', () => {
  const f=fixture();
  f.H.market='cn';f.H.render();
  assert.deepEqual(rowIds(f.html),[]);
  assert.match(f.html,/A股暂无本轮结果/);
  assert.doesNotMatch(f.html,/stock-market-nav|potential-market/);
  f.click('potential-history');
  assert.ok(rowIds(f.html).includes('688050'));
  f.click('potential-current');
  f.H.market='us';f.H.render();
  assert.equal(rowIds(f.html).length,6);
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
