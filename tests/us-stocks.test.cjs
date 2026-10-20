const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/model.js');

function page() {
  const ctx = { Changheng: M };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('data/overseas-stocks.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('assets/overseas-stocks.js', 'utf8'), ctx);
  let symbols = [], modal = '', resets = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[x]);
  const number = x => typeof x === 'number' ? x.toFixed(1) : '—';
  const helpers = { esc, money:number, pct:number, pc:number,
    action:(label, action, cls, attrs='') => `<button data-action="${action}" class="${cls || ''}" ${attrs}>${label}</button>`,
    stockRows:(rows, render) => { symbols=rows.map(s => s.symbol); return rows.map(render).join(''); },
    returnControls:() => '<div>收益周期</div>',
    periods:[1,3,5], periodHead:y => `${y}年`, ret:x => x,
    modalTitle:(name, description) => `<h2>${name}</h2><p>${description}</p>`,
    detailGrid:rows => rows.map(r => r.join(':')).join(' '),
    openModal:html => { modal=html; }, resetList:() => { resets++; }, render:() => {} };
  const app=ctx.ChanghengOverseasStocks;
  const view=() => app.view(helpers);
  const click=(action, value) => app.handleAction({dataset:{action:'os-stock-'+action, value}});
  return { ctx, app, view, click, symbols:() => symbols, modal:() => modal, resets:() => resets };
}

test('US companies default to selected companies within four groups', () => {
  const p=page(), html=p.view();
  const names=['长期优质企业','盈利成长企业','业绩爆发股','红利价值'];
  let previous=-1;
  for (const name of names) { const i=html.indexOf(name); assert.ok(i>previous); previous=i; }
  assert.doesNotMatch(html, /data-value="other"/);
  assert.match(html, /全部相关公司/);
  assert.match(html, /stock-overlap-company/);
  for (const group of ['quality','growth','breakout','dividend']) {
    p.click('group',group); p.view();
    assert.deepEqual([...p.symbols()], Array.from(p.ctx.OVERSEAS_STOCKS.filter(s => s.screening.groups.includes(group)), s => s.symbol));
  }
});

test('search persists across groups and mature quality no longer depends on ten percent growth', () => {
  const p=page(); p.view();
  p.app.handleInput({value:'AAPL'});
  p.click('group','growth');
  assert.match(p.view(), /value="AAPL"/); assert.equal(p.symbols().length,0);
  p.click('scope','true'); assert.match(p.view(), /入选 \/ 未入选理由/);
  assert.deepEqual([...p.symbols()],['AAPL']);
  assert.match(p.view(),/未入选/);
  p.click('group','breakout'); p.view(); assert.equal(p.symbols().length,0);
  p.click('group','quality');
  const html=p.view(); assert.deepEqual([...p.symbols()],['AAPL']);
  assert.match(html, /苹果/);
  assert.equal(p.ctx.OVERSEAS_STOCKS.find(s=>s.symbol==='AAPL').analysis.profitCagr3.value.toFixed(2),'3.92');
  p.click('view','valuation'); assert.match(p.view(), /value="AAPL"/);
  p.click('detail','AAPL'); assert.match(p.modal(), /分类依据与未入选原因/);
  assert.match(p.modal(), /软硬件生态.*重复服务收入/);
  assert.match(p.modal(), /重新评估的信号/);
});

test('dividend view and detail distinguish REIT AFFO from GAAP earnings', () => {
  const p=page(); p.view(); p.click('group','dividend');
  const html=p.view(); assert.match(html,/5年分红年数/); assert.match(html,/本季已付普通股股息 \/ AFFO/);
  assert.ok(p.symbols().includes('O'));
  p.click('detail','O'); assert.match(p.modal(), /74.5%/); assert.match(p.modal(), /5.4倍/);
  assert.doesNotMatch(p.modal(), /没有自动授予国内/);
});

test('each market exposes separate quality and growth reasons without treating working capital as insolvency', () => {
  const ctx={}; vm.createContext(ctx); vm.runInContext(fs.readFileSync('data/snapshot.js','utf8'),ctx);
  const fii=ctx.STOCKS.find(s=>s.c==='601138'), zijin=ctx.STOCKS.find(s=>s.c==='601899');
  assert.match(M.stockSelectionReason(fii,'quality'),/23\.92%/);
  assert.match(M.stockSelectionReason(fii,'quality'),/970\.45/);
  assert.equal(M.stockMatches(fii,'quality'),true);
  assert.match(M.stockSelectionReason(fii,'growth'),/230%/);
  assert.match(M.stockSelectionReason(zijin,'quality'),/1\.53倍/);
  assert.match(M.stockSelectionReason(zijin,'growth'),/销量增长29\.49%/);
  const p=page(); p.view(); p.click('detail','AMZN');
  assert.match(p.modal(),/负76亿美元/);
  const stale=structuredClone(fii); stale.companySelection.status='pending'; stale.companySelection.rationale='缺新报告业务评审';
  assert.equal(M.stockSelectionReason(stale,'growth'),'缺新报告业务评审');
});


test('switching financial views preserves both directions and loaded rows', () => {
  const p=page(); p.view(); p.click('scope','true'); p.click('view','valuation'); p.click('sort','pe');
  p.view(); const descending=[...p.symbols()], resets=p.resets();
  p.click('view','returns'); assert.match(p.view(), /按PE \/ TTM降序/);
  assert.deepEqual([...p.symbols()],descending); assert.equal(p.resets(),resets);
  p.click('view','valuation'); p.click('sort','pe'); p.view(); const ascending=[...p.symbols()];
  assert.notDeepEqual(ascending,descending);
  p.click('view','financials'); p.view(); assert.deepEqual([...p.symbols()],ascending);
  p.click('sort-reset'); assert.doesNotMatch(p.view(), /stock-sort-status/);
});

test('US table third header click restores the original companies and keeps the active filter', () => {
  const p=page(); p.view(); p.click('scope','true'); p.click('view','valuation'); p.view();
  const original=[...p.symbols()];
  p.click('sort','pe'); assert.match(p.view(), /按PE \/ TTM降序/);
  p.click('sort','pe'); assert.match(p.view(), /按PE \/ TTM升序/);
  p.click('sort','pe'); assert.doesNotMatch(p.view(), /stock-sort-status/);
  assert.deepEqual([...p.symbols()],original);
  assert.match(p.view(), /全部相关公司/);
});

test('related-company scope never duplicates mature firms into breakout or Dongshan into quality/growth', () => {
  const p=page();p.view();p.click('scope','true');p.click('group','growth');p.view();
  assert.ok(p.symbols().includes('AAPL'));assert.ok(p.symbols().includes('MSFT'));
  p.click('group','breakout');p.view();
  assert.ok(!p.symbols().includes('AAPL'));assert.ok(!p.symbols().includes('MSFT'));
  const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('data/snapshot.js','utf8'),ctx);
  const ds=ctx.STOCKS.find(r=>r.c==='002384');
  assert.equal(M.stockVisibleInGroup(ds,'breakout'),false);
  assert.equal(M.stockVisibleInGroup(ds,'breakout',true),true);
  assert.equal(M.stockVisibleInGroup(ds,'quality',true),false);
  assert.equal(M.stockVisibleInGroup(ds,'growth',true),false);
  assert.match(M.stockSelectionReason(ds,'breakout'),/并表/);
  for(const s of [...ctx.STOCKS,...p.ctx.OVERSEAS_STOCKS]) {
    const groups=M.stockResearchGroups(s);
    // Dividend eligibility can change with the daily close without creating
    // quality/growth/breakout research coverage for an income-only company.
    if(!groups.length&&(s.group==='dividend'||s.companySelection.previousGroups?.includes('dividend')))continue;
    assert.ok(groups.length>0,s.c);
    for(const g of groups)assert.ok(M.stockSelectionReason(s,g).length>20,s.c+':'+g);
  }
});

test('losing dividend eligibility does not create unrelated research coverage', () => {
  for(const groups of [['dividend'],['other']]) {
    const s={companySelection:{researchGroups:[],previousGroups:['dividend'],groups}};
    assert.deepEqual(M.stockResearchGroups(s),[]);
    assert.equal(M.stockMatches(s,'dividend'),groups.includes('dividend'));
    for(const g of ['quality','growth','breakout']) {
      assert.equal(M.stockVisibleInGroup(s,g),false);
      assert.equal(M.stockVisibleInGroup(s,g,true),false);
    }
  }
});

test('a passing label in another group cannot hide newly failing checks in the compact reason', () => {
  const s={companySelection:{status:'selected',groups:['quality'],groupSummaries:{growth:'此前增长良好'},reviews:{growth:{qualified:false,checks:[{pass:false,reason:'最新单季营业利润下降'}]}}}};
  assert.equal(M.stockSelectionReason(s,'growth',true),'最新单季营业利润下降');
});
