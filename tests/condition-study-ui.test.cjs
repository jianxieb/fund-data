const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/model.js');
const C = require('../assets/condition-study-model.js');

function sessions(closes, start = '2001-01-02') {
  const day = new Date(start + 'T00:00:00Z');
  return closes.map(close => {
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const row = [day.toISOString().slice(0, 10), close];
    day.setUTCDate(day.getUTCDate() + 1);
    return row;
  });
}
// A seeded random walk: realistic enough that the latest-close fit keeps some conditions and drops others.
function walk(n, seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
  let close = 100;
  return Array.from({ length:n }, (_, i) => {
    if (i) close *= Math.exp(.0003 + .012 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
    return Number(close.toFixed(2));
  });
}
const element = tag => ({ tag, className:'', textContent:'', children:[], append(...nodes) { this.children.push(...nodes); } });
const text = node => node.textContent || node.children.map(text).filter(Boolean).join(' ');

function fixture({ hash = '#condition-study', seed = 2, series = sessions(walk(2600, seed)), badIdentity = false, dividends = 'excluded', fail = false } = {}) {
  const assets = ['NDX', 'GSPC'].map(code => ({ id:'index:^' + code, code:'^' + code, kind:'index', currency:'USD', basis:'price_index' }));
  if (badIdentity) assets[0].basis = 'etf_price';
  const location = { hash }, listeners = {}, downloads = [], modals = [], renders = [], state = { fail };
  const context = {
    window:{ Changheng:M, ChanghengConditionStudyModel:C, ChanghengResearchHistory:{
      indexCatalog:async () => assets,
      history:async () => { if (state.fail) throw new Error('缺少日线 <503>'); return { dividends, series }; } } },
    document:{ addEventListener:(type, listener) => { listeners[type] = listener; }, createElement:element },
    location, URLSearchParams, setTimeout,
    history:{ replaceState:(_, __, next) => { location.hash = next; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/condition-study.js'), 'utf8'), context);
  const ui = context.window.ChanghengConditionStudy;
  const H = { head:(_, title, desc) => '<h1>' + title + '</h1><p>' + desc + '</p>',
    menu:(id, label, choices, value) => '<div id="' + id + '">' + label + '：' + choices.find(x => x[0] === value)?.[1] + '</div>',
    render:() => renders.push(ui.view(H)), openModal:html => modals.push(html), modalTitle:(title, subtitle) => '<h2>' + title + '</h2><p>' + subtitle + '</p>',
    download:(...args) => downloads.push(args) };
  function click(kind, value) {
    const selector = kind === 'event' ? '[data-cs-event]' : '[data-cs-action]';
    const target = kind === 'event' ? { dataset:{ csEvent:value } } : { dataset:{ csAction:value }, disabled:false };
    listeners.click({ target:{ closest:s => s === selector ? target : null } });
  }
  function toggle(id, checked) { listeners.change({ target:{ dataset:{ csToggle:id }, checked } }); }
  // Bound edits apply on the next timer tick, after focus has moved on.
  async function enter(id, side, value) {
    const input = { dataset:{ csMetric:id, csBound:side }, value, error:'', setCustomValidity(v) { this.error = v; }, reportValidity() { return !this.error; } };
    listeners.change({ target:input });
    await settle();
    return input;
  }
  async function settle() {
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
    return ui.view(H);
  }
  ui.view(H);
  return { ui, H, series, data:C.compute(series), location, listeners, downloads, modals, renders, state, click, toggle, enter, settle };
}
const checked = (html, id) => new RegExp('id="cs-' + id + '-on"[^>]*\\schecked').test(html);
const inputValue = (html, id, side) => html.match(new RegExp('id="cs-' + id + '-' + side + '"[^>]*value="([^"]*)"'))?.[1];

test('with no conditions in the address, the page matches the latest close and says what it left out', async () => {
  const f = fixture(), html = await f.settle();
  const fit = C.fit(f.data, { gap:21 }), r = C.study(f.data, { conditions:fit.conditions, gap:21 });
  assert.ok(fit.added.length >= 1 && fit.skipped.length >= 1, 'the fixture must exercise both kept and dropped conditions');
  assert.equal(f.location.hash, '#condition-study');
  assert.match(html, /data-cs-action="fit" aria-pressed="true">✓ 已按最新收盘匹配/);
  assert.ok(html.includes('已按 ' + f.data.asOf + ' 收盘选取 ' + fit.added.length + ' 项，保留至少 10 段历史；另 ' +
    fit.skipped.filter(s => s.episodes != null).length + ' 项加入后不足 10 段，未勾选。'));
  for (const m of C.metrics) assert.equal(checked(html, m.id), fit.added.includes(m.id), m.id);
  for (const id of fit.added) {
    assert.equal(inputValue(html, id, 'lo'), String(fit.conditions[id].lo ?? ''));
    assert.equal(inputValue(html, id, 'hi'), String(fit.conditions[id].hi ?? ''));
  }
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  assert.ok(html.includes(f.data.asOf + ' 收盘满足全部 ' + fit.added.length + ' 项条件'));
  assert.match(html, /含最新收盘/);
  for (const [, title] of C.groups) assert.ok(html.includes('<legend>' + title + '</legend>'));
  for (const label of ['1周', '1个月', '3个月', '1年', '全部交易日', '期间最大回撤', '相对信号日最低']) assert.ok(html.includes(label), label);
  assert.match(html, /<svg data-cs-chart="main"[^>]+role="img"/);
  assert.match(html, /最近 63 个交易日（/);
  assert.match(html, /历史中位数/);
});

test('ticking or editing a condition switches to manual and keeps readable ranges in the address', async () => {
  const f = fixture();
  await f.settle();
  const fit = C.fit(f.data, { gap:21 }), extra = C.metrics.find(m => !fit.added.includes(m.id) && C.suggest(f.data, m.id)).id;
  f.toggle(extra, true);
  let html = await f.settle();
  const manual = { ...fit.conditions, [extra]:C.suggest(f.data, extra) };
  const expected = C.metrics.filter(m => manual[m.id]).map(m => m.id + '=' + C.formatRange(manual[m.id])).join('&');
  assert.equal(f.location.hash, '#condition-study?' + expected);
  assert.match(f.location.hash, /~/);
  assert.match(html, /data-cs-action="fit" aria-pressed="false">按最新收盘匹配/);
  assert.ok(html.includes('自选 ' + Object.keys(manual).length + ' 项条件'));
  assert.ok(checked(html, extra));

  const id = fit.added[0], { lo, hi } = fit.conditions[id];
  const wider = hi === null ? { lo:lo - 1, hi:null } : { lo, hi:hi + 1 };
  let input = await f.enter(id, hi === null ? 'lo' : 'hi', String(hi === null ? wider.lo : wider.hi));
  assert.equal(input.error, '');
  assert.ok(f.location.hash.includes(id + '=' + C.formatRange(wider)));

  const before = f.location.hash;
  input = await f.enter(id, 'lo', '1000');
  if (wider.hi !== null) assert.equal(input.error, '下限不能高于上限');
  else assert.equal(input.error, '');
  if (wider.hi !== null) assert.equal(f.location.hash, before, 'an invalid range must not be applied');
  input = await f.enter('since252', 'lo', '2.5');
  assert.equal(input.error, '请输入整数');
  input = await f.enter('r1', 'hi', '-1.234');
  assert.equal(input.error, '最多两位小数');
  f.listeners.input({ target:input });
  assert.equal(input.error, '', 'typing again clears the earlier message');
  const kept = f.location.hash, unreadable = { dataset:{ csMetric:id, csBound:'lo' }, value:'', validity:{ badInput:true }, reported:false,
    setCustomValidity() {}, reportValidity() { this.reported = true; } };
  f.listeners.change({ target:unreadable });
  await f.settle();
  assert.equal(f.location.hash, kept, 'unreadable text must not clear the bound');
  assert.equal(unreadable.reported, true);

  f.toggle(extra, false);
  html = await f.settle();
  assert.doesNotMatch(f.location.hash, new RegExp('[?&]' + extra + '='));
  assert.equal(checked(html, extra), false);
});

test('clearing leaves an honest empty state, and the match button restores the fit with market and spacing kept', async () => {
  const f = fixture({ hash:'#condition-study?market=spx&gap=63&r1=~-1' });
  let html = await f.settle();
  assert.match(html, /标普500/);
  assert.match(html, /63 个交易日 · 约3个月/);
  assert.match(html, /aria-pressed="false"/);
  assert.equal(inputValue(html, 'r1', 'hi'), '-1');
  f.click('action', 'clear');
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?market=spx&gap=63&mode=manual');
  assert.match(html, /尚未选择条件/);
  assert.doesNotMatch(html, /信号前后的走势|data-cs-action="clear"/);
  f.ui.choose('gap', '5');
  f.ui.choose('gap', '7');
  f.ui.choose('market', 'nope');
  assert.equal(f.location.hash, '#condition-study?market=spx&gap=5&mode=manual');
  f.click('action', 'fit');
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?market=spx&gap=5');
  assert.match(html, /✓ 已按最新收盘匹配/);
  const fit = C.fit(f.data, { gap:5 });
  assert.ok(html.includes('选取 ' + fit.added.length + ' 项'));
  assert.ok(html.includes('匹配 <b>' + C.study(f.data, { conditions:fit.conditions, gap:5 }).episodes.length + '</b> 段'));
});

test('unknown address values fall back to the defaults instead of half-applying', async () => {
  const f = fixture({ hash:'#condition-study?market=foo&gap=7&r1=abc&dd252=30~10&since252=2.5~' });
  const html = await f.settle();
  assert.match(html, /纳斯达克100/);
  assert.match(html, /21 个交易日 · 约1个月/);
  assert.match(html, /aria-pressed="true"/);
});

test('when nothing matches, each row shows what removing it would leave and export is off', async () => {
  const f = fixture({ hash:'#condition-study?r1=50~&dd252=0~' });
  const html = await f.settle();
  assert.match(html, /匹配 <b>0<\/b> 段/);
  assert.match(html, /没有同时满足全部条件的交易日/);
  assert.match(html, /data-cs-action="csv" disabled/);
  assert.match(html, /不满足：当日涨跌/);
  assert.ok(html.includes('去掉后 <b>' + C.count(f.data, { dd252:{ lo:0, hi:null } }, 21) + '</b> 段'));
  assert.match(html, /勾选后 <b>0<\/b> 段/);
  f.click('action', 'csv');
  assert.equal(f.downloads.length, 0);
});

test('CSV holds every episode and the condition source; paging reaches the rest of the table', async () => {
  const f = fixture({ seed:4 });
  let html = await f.settle();
  const fit = C.fit(f.data, { gap:21 }), r = C.study(f.data, { conditions:fit.conditions, gap:21 });
  assert.ok(r.episodes.length > 15, 'the fixture needs more than one page');
  f.click('action', 'csv');
  const [name, csv] = f.downloads.at(-1), lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(name, '行情条件后表现-纳斯达克100-' + f.data.asOf + '.csv');
  assert.equal(lines.length, r.episodes.length + 1);
  assert.match(lines[0], /"条件来源"/);
  assert.match(lines[0], /"1年相对信号日最低%"/);
  assert.ok(lines[1].includes('"按 ' + f.data.asOf + ' 收盘自动选取"'));
  for (const id of fit.added) assert.ok(lines[1].includes(C.byId[id].label), id);
  assert.ok(lines.at(-1).includes('"' + r.episodes.at(-1).date + '"'));
  const row = date => 'data-cs-event="' + date + '"';
  assert.ok(html.includes(row(r.episodes[0].date)));
  assert.ok(!html.includes(row(r.episodes[15].date)));
  f.click('action', 'next');
  html = await f.settle();
  assert.match(html, /第 2 \/ 2 页/);
  assert.ok(html.includes(row(r.episodes[15].date)));
  f.click('action', 'csv');
  assert.equal(f.downloads.at(-1)[1], csv);
  f.click('action', 'prev');
  assert.match(await f.settle(), /第 1 \/ 2 页/);
});

test('an episode opens its own path, outcomes and readings', async () => {
  const f = fixture({ seed:4 });
  await f.settle();
  const fit = C.fit(f.data, { gap:21 }), r = C.study(f.data, { conditions:fit.conditions, gap:21 });
  const old = r.episodes.at(-1), latest = r.episodes[0];
  f.click('event', old.date);
  let modal = f.modals.at(-1);
  assert.match(modal, /<svg data-cs-chart="event"[^>]+role="img"/);
  assert.ok(modal.includes(old.date + ' · 纳斯达克100'));
  assert.match(modal, /已走完 252 个交易日/);
  assert.ok(modal.includes(old.outcomes[252].date));
  assert.match(modal, /实际期末日/);
  for (const [, title] of C.groups) assert.ok(modal.includes('<h3>' + title + '</h3>'));
  assert.equal((modal.match(/class="is-active"/g) || []).length, fit.added.length);
  f.click('event', latest.date);
  modal = f.modals.at(-1);
  assert.match(modal, /已观察 \d+ \/ 252 个交易日/);
  assert.match(modal, /未到期/);
  f.click('event', '1900-01-01');
  assert.equal(f.modals.length, 2);
});

test('the chart tooltip follows the keyboard and the pointer, and hides when focus leaves', async () => {
  const f = fixture({ seed:4 });
  await f.settle();
  const fit = C.fit(f.data, { gap:21 }), r = C.study(f.data, { conditions:fit.conditions, gap:21 });
  const spread = new Map(C.spread(f.data, r.episodes.map(e => e.index)).map(x => [x.k, x]));
  const now = new Map(C.path(f.data, f.data.last, C.lookback, 0));
  const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
  const tip = { hidden:true, style:{}, offsetWidth:200, children:[], replaceChildren(...nodes) { this.children = nodes; }, setAttribute(k) { if (k === 'hidden') this.hidden = true; } };
  const cross = { attrs:{}, setAttribute(k, v) { this.attrs[k] = v; } };
  const svg = { dataset:{ csChart:'main' }, matches:s => s === 'svg[data-cs-chart]', closest:s => s === 'svg[data-cs-chart]' ? svg : null,
    querySelector:s => s === '.cs-crosshair' ? cross : null, parentElement:{ querySelector:s => s === '.cs-tooltip' ? tip : null },
    getBoundingClientRect:() => ({ left:0, width:1200 }) };
  const lines = () => tip.children.map(text);
  const key = (k, shiftKey = false) => f.listeners.keydown({ target:svg, key:k, shiftKey, preventDefault() {} });
  f.listeners.focusin({ target:svg });
  assert.equal(tip.hidden, false);
  assert.equal(lines()[0], '信号日');
  assert.ok(lines().includes('0.00% 最新'));
  assert.equal(cross.attrs.visibility, 'visible');
  key('ArrowRight', true);
  assert.equal(lines()[0], '信号后 21 个交易日');
  assert.ok(lines().includes(pct(spread.get(21).median - 100) + ' 中位数'));
  assert.ok(lines().includes(spread.get(21).n + ' 段 有数据的样本'));
  assert.ok(!lines().some(x => x.endsWith('最新')));
  key('Home');
  assert.equal(lines()[0], '信号前 63 个交易日');
  assert.ok(lines().includes(pct(now.get(-63) - 100) + ' 最新'));
  key('End');
  assert.equal(lines()[0], '信号后 252 个交易日');
  key('a');
  assert.equal(lines()[0], '信号后 252 个交易日');
  f.listeners.pointermove({ target:svg, clientX:58 + (126 + 63) / 315 * 1022 });
  assert.equal(lines()[0], '信号后 126 个交易日');
  f.listeners.pointermove({ target:{ closest:() => null } });
  assert.equal(tip.hidden, true);
  f.listeners.focusin({ target:svg });
  f.listeners.focusout({ target:svg });
  assert.equal(tip.hidden, true);
  assert.equal(cross.attrs.visibility, 'hidden');
});

test('wrong source identity and load failures are explicit, and retry reloads', async () => {
  const wrong = fixture({ badIdentity:true });
  let html = await wrong.settle();
  assert.match(html, /缺少 \^NDX 的美元价格指数日线/);
  assert.doesNotMatch(html, /信号前后的走势/);
  wrong.ui.choose('market', 'spx');
  assert.match(wrong.renders.at(-1), /正在读取标普500历史收盘/);
  html = await wrong.settle();
  assert.match(html, /cs-conditions-title/);
  const total = fixture({ dividends:'included' });
  assert.match(await total.settle(), /\^NDX 缺少不含分红的价格指数口径/);
  const failed = fixture({ fail:true });
  html = await failed.settle();
  assert.match(html, /缺少日线 &lt;503&gt;/);
  assert.match(html, /data-cs-action="retry"/);
  failed.state.fail = false;
  failed.click('action', 'retry');
  html = await failed.settle();
  assert.match(html, /cs-conditions-title/);
});
