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
  let symbols = [], modal = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[x]);
  const number = x => typeof x === 'number' ? x.toFixed(1) : '—';
  const helpers = { esc, money:number, pct:number, pc:number,
    action:(label, action, cls, attrs='') => `<button data-action="${action}" class="${cls || ''}" ${attrs}>${label}</button>`,
    lazyRows:(_id, rows, render) => { symbols=rows.map(s => s.symbol); return rows.map(render).join(''); },
    loadFooter:() => '', returnControls:() => '<div>收益周期</div>',
    periods:[1,3,5], periodHead:y => `${y}年`, ret:x => x,
    modalTitle:(name, description) => `<h2>${name}</h2><p>${description}</p>`,
    detailGrid:rows => rows.map(r => r.join(':')).join(' '),
    openModal:html => { modal=html; }, resetList:() => {}, render:() => {} };
  const app=ctx.ChanghengOverseasStocks;
  const view=() => app.view(helpers);
  const click=(action, value) => app.handleAction({dataset:{action:'os-stock-'+action, value}});
  return { ctx, app, view, click, symbols:() => symbols, modal:() => modal };
}

test('US companies use five current groups with other coverage last and overlap colored', () => {
  const p=page(), html=p.view();
  const names=['长期优质企业','高质成长股','业绩爆发股','红利价值','其他已收录'];
  let previous=-1;
  for (const name of names) { const i=html.indexOf(name); assert.ok(i>previous); previous=i; }
  assert.match(html, /stock-other-tab/);
  assert.match(html, /stock-overlap-company/);
  for (const group of ['quality','growth','breakout','dividend','other']) {
    p.click('group',group); p.view();
    assert.deepEqual([...p.symbols()], Array.from(p.ctx.OVERSEAS_STOCKS.filter(s => s.screening.groups.includes(group)), s => s.symbol));
  }
});

test('search persists across groups and bluechips remain visible in other coverage', () => {
  const p=page(); p.view();
  p.app.handleInput({value:'AAPL'});
  p.click('group','growth');
  assert.match(p.view(), /value="AAPL"/); assert.equal(p.symbols().length,0);
  p.click('group','other');
  const html=p.view(); assert.deepEqual([...p.symbols()],['AAPL']);
  assert.match(html, /三年利润复合 3.92%/);
  p.click('view','valuation'); assert.match(p.view(), /value="AAPL"/);
  p.click('detail','AAPL'); assert.match(p.modal(), /分类依据与未入选原因/);
  assert.match(p.modal(), /重要蓝筹/);
});

test('dividend view and detail distinguish REIT AFFO from GAAP earnings', () => {
  const p=page(); p.view(); p.click('group','dividend');
  const html=p.view(); assert.match(html,/5年分红年数/); assert.match(html,/本季现金股息 \/ AFFO/);
  assert.ok(p.symbols().includes('O'));
  p.click('detail','O'); assert.match(p.modal(), /74.5%/); assert.match(p.modal(), /5.4倍/);
  assert.doesNotMatch(p.modal(), /没有自动授予国内/);
});
