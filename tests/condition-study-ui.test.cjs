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
// A seeded random walk: realistic enough that the automatic match keeps some conditions and drops others.
function walk(n, seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
  let close = 100;
  return Array.from({ length:n }, (_, i) => {
    if (i) close *= Math.exp(.0003 + .012 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
    return Number(close.toFixed(2));
  });
}
// Cboe-style VIX closes on the same sessions, plus one session without a published close.
const vixFor = (series, skip = 40) => series.filter((_, i) => i !== skip).map(([date], i) => [date, Number((14 + 14 * Math.abs(Math.sin(i / 23)) + (i % 7)).toFixed(2))]);
const element = tag => ({ tag, className:'', textContent:'', children:[], append(...nodes) { this.children.push(...nodes); } });
const text = node => node.textContent || node.children.map(text).filter(Boolean).join(' ');
const pct = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
const short = { dd252:'距252日高点', r21:'近21日', r5:'近5日', r1:'当日', ma200:'距200日线', vix:'VIX', vol21:'波动率', r3:'近3日', r63:'近63日' };

function fixture({ hash = '#condition-study', seed = 2, series = sessions(walk(2600, seed)), badIdentity = false, dividends = 'excluded', fail = false,
  vix = vixFor(series), vixMode = 'ok', highsMode = 'ok' } = {}) {
  const assets = ['NDX', 'GSPC'].map(code => ({ id:'index:^' + code, code:'^' + code, kind:'index', currency:'USD', basis:'price_index' }));
  if (badIdentity) assets[0].basis = 'etf_price';
  const location = { hash }, listeners = {}, downloads = [], modals = [], renders = [], state = { fail, fetches:[] }, nodes = {};
  const vixRow = { id:'index:^VIX', code:'^VIX', basis:'implied_volatility_index', status:'available', first:vix[0][0], asOf:vix.at(-1)[0],
    historyUrl:'data/condition-study/VIX-0123456789abcdef.json', sha256:'0'.repeat(64), ...(vixMode === 'stale' ? { refreshMissing:'source timed out' } : {}) };
  const vixHistory = { schemaVersion:1, id:vixRow.id, basis:vixRow.basis, field:'CLOSE', closedSessionsOnly:true, first:vixRow.first, asOf:vixRow.asOf,
    series:vixMode === 'unordered' ? [...vix.slice(0, 5), vix[6], vix[5], ...vix.slice(7)] : vix };
  // Daily highs 0.6% above each close; "mismatch" publishes one close that disagrees with the index file.
  const highs = series.map(([date, close]) => [date, Number((close * 1.006).toFixed(2))]);
  const highCloses = series.map(([date, close], i) => [date, highsMode === 'mismatch' && i === series.length - 300 ? close + .01 : close]);
  const highRows = ['NDX', 'GSPC'].map(code => ({ id:'index:^' + code, code:'^' + code, currency:'USD', basis:'price_index_high', status:'available',
    first:series[0][0], asOf:series.at(-1)[0], historyUrl:'data/drop-study/' + code + '-0123456789abcdef.json', sha256:'0'.repeat(64),
    ...(highsMode === 'stale' ? { refreshMissing:'source timed out' } : {}) }));
  async function fetch(url) {
    state.fetches.push(url);
    if (url.startsWith('data/condition-study/catalog.json'))
      return vixMode === 'down' ? { ok:false, status:503 } : { ok:true, json:async () => ({ schemaVersion:1, assets:[vixRow] }) };
    if (url === vixRow.historyUrl) return { ok:true, text:async () => JSON.stringify(vixHistory) };
    if (url.startsWith('data/drop-study/catalog.json'))
      return highsMode === 'down' ? { ok:false, status:503 } : { ok:true, json:async () => ({ schemaVersion:1, assets:highRows }) };
    const row = highRows.find(r => r.historyUrl === url);
    if (row) return { ok:true, text:async () => JSON.stringify({ schemaVersion:1, id:row.id, currency:'USD', basis:row.basis, dividends:'excluded',
      closedSessionsOnly:true, dateConvention:'exchange_local_date', field:'indicators.quote[0].high', first:row.first, asOf:row.asOf, series:highs, closes:highCloses }) };
    return { ok:false, status:404 };
  }
  const sources = { '#condition-vix-source':'data/condition-study/catalog.json?v=test', '#drop-high-source':'data/drop-study/catalog.json?v=test' };
  const context = {
    window:{ Changheng:M, ChanghengConditionStudyModel:C, ChanghengResearchHistory:{
      indexCatalog:async () => assets,
      history:async () => { if (state.fail) throw new Error('缺少日线 <503>'); return { dividends, series }; } } },
    document:{ addEventListener:(type, listener) => { listeners[type] = listener; }, createElement:element,
      querySelector:selector => sources[selector] ? { dataset:{ src:sources[selector] } } : nodes[selector] || null },
    location, URLSearchParams, setTimeout, fetch, innerWidth:1600, innerHeight:900, scrollX:0, scrollY:1000,
    history:{ replaceState:(_, __, next) => { location.hash = next; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/condition-study.js'), 'utf8'), context);
  const ui = context.window.ChanghengConditionStudy;
  const H = { head:(_, title, desc) => '<h1>' + title + '</h1><p>' + desc + '</p>',
    menu:(id, label, choices, value) => '<div id="' + id + '">' + label + '：' + choices.find(x => x[0] === value)?.[1] + '</div>',
    render:() => renders.push(ui.view(H)), openModal:html => modals.push(html), modalTitle:(title, subtitle) => '<h2>' + title + '</h2><p>' + subtitle + '</p>',
    download:(...args) => downloads.push(args) };
  // Each control is found by the attribute the page listens for.
  function press(selector, target) { listeners.click({ target:{ closest:s => s === selector ? target : null } }); }
  const click = (kind, value) => kind === 'event' ? press('[data-cs-event]', { dataset:{ csEvent:value } }) : press('[data-cs-action]', { dataset:{ csAction:value }, disabled:false });
  const chip = (h, disabled = false) => press('[data-cs-horizon]', { dataset:{ csHorizon:String(h) }, disabled });
  const choice = (id, value) => press('[data-cs-choice]', { dataset:{ csChoice:id, value } });
  const spacing = gap => press('[data-cs-gap]', { dataset:{ csGap:String(gap) } });
  function toggle(id, checked) { listeners.change({ target:{ dataset:{ csToggle:id }, checked } }); }
  // Typed values apply on the next timer tick, after focus has moved on.
  async function enter(id, side, value) {
    const input = { dataset:{ csMetric:id, csBound:side }, value, error:'', setCustomValidity(v) { this.error = v; }, reportValidity() { return !this.error; } };
    listeners.change({ target:input });
    await settle();
    return input;
  }
  async function param(key, value) {
    const input = { dataset:{ csParam:key }, value, error:'', setCustomValidity(v) { this.error = v; }, reportValidity() { return !this.error; } };
    listeners.change({ target:input });
    await settle();
    return input;
  }
  async function setDate(value) {
    listeners.change({ target:{ id:'cs-ref', value, dataset:{} } });
    return settle();
  }
  function submitWait(wait) {
    let closed = false;
    listeners.submit({ target:{ id:'cs-wait-form', elements:{ wait:{ valueAsNumber:wait } }, closest:() => ({ close() { closed = true; } }) }, preventDefault() {} });
    return closed;
  }
  async function settle() {
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 6; i++) await new Promise(setImmediate);
    return ui.view(H);
  }
  const first = ui.view(H);
  const data = C.compute(series, ['ok', 'stale'].includes(vixMode) ? { vix } : {});
  // Both index files are the same walk here, so the other index's move equals the index's own.
  const frameFor = (options = {}) => C.frame(data, { peer:series, ...options });
  return { ui, H, series, vix, highs, data, view:frameFor(), frameFor, first, location, listeners, downloads, modals, renders, state, nodes,
    click, chip, choice, spacing, toggle, enter, param, setDate, submitWait, settle };
}
const checked = (html, id) => new RegExp('id="cs-' + id + '-on"[^>]*\\schecked').test(html);
const inputValue = (html, id, side) => html.match(new RegExp('id="cs-' + id + '-' + side + '"[^>]*value="([^"]*)"'))?.[1];
// One condition row, from its opening tag to the next row.
function rowOf(html, id) {
  const at = html.indexOf('id="cs-' + id + '-on"'), end = html.indexOf('<div class="cs-row', at);
  return html.slice(html.lastIndexOf('<div class="cs-row', at), end < 0 ? undefined : end);
}
const nameOf = m => ({ rN:'近 10 日涨跌', ddN:'距近 63 日最高收盘', drops:'近 21 日跌超 5% 的天数', peer1:'标普500当日涨跌' })[m.id] || m.label;

test('with no conditions in the address, the page matches the latest close and says what it left out', async () => {
  const f = fixture();
  assert.match(f.first, /正在读取纳斯达克100历史收盘/);
  const html = await f.settle();
  const fit = C.fit(f.view, { gap:21 }), r = C.study(f.view, { conditions:fit.conditions, gap:21 });
  assert.ok(fit.added.length >= 1 && fit.skipped.length >= 1, 'the fixture must exercise both kept and dropped conditions');
  assert.equal(f.location.hash, '#condition-study');
  assert.match(html, /data-cs-action="fit" aria-pressed="true">✓ 已按参照日匹配/);
  const skipped = fit.steps.filter(s => s.band && !s.kept).map(s => short[s.id]);
  assert.ok(html.includes('已按 ' + f.data.asOf + ' 的读数选取 ' + fit.added.length + ' 项，保留至少 10 段历史；' + skipped.join('、') + ' 加入后不足 10 段，未勾选。改任一数字即转为自选。'));
  for (const m of C.metrics) if (!m.choice) assert.equal(checked(html, m.id), fit.added.includes(m.id), m.id);
  for (const id of fit.added) {
    assert.equal(inputValue(html, id, 'lo'), String(fit.conditions[id].lo ?? ''));
    assert.equal(inputValue(html, id, 'hi'), String(fit.conditions[id].hi ?? ''));
    assert.ok(rowOf(html, id).includes('>随参照日</small>'), id);
  }
  assert.ok(html.includes('<span>范围（含边界）</span><span>改选后匹配</span>'));
  assert.ok(r.matchingDays > r.episodes.length, 'the fixture must merge some matching days');
  assert.ok(html.includes('个交易日满足条件<small>其中 ' + (r.matchingDays - r.episodes.length) + ' 天并入所在段</small>'));
  assert.ok(html.includes('data-cs-gap="1" aria-pressed="false">每天单独计</button><button type="button" class="active" data-cs-gap="21" aria-pressed="true">合并为一段'));
  assert.ok(html.includes('合并范围：21 个交易日内 · 约1个月'));
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  assert.ok(html.includes(f.data.asOf + ' 收盘满足全部 ' + fit.added.length + ' 项条件'));
  assert.match(html, /含最新收盘/);
  for (const [g, title] of C.groups) assert.equal(html.includes('<legend>' + title + '</legend>'), g !== 'obs', g);
  assert.ok(html.includes('<input id="cs-ref" type="date" min="' + f.data.first + '" max="' + f.data.asOf + '" value="' + f.data.asOf + '"><small>最新收盘</small>'));
  for (const [h, term] of [[1, '1日'], [4, '4日'], [5, '1周'], [252, '1年'], [504, '2年']])
    assert.match(html, new RegExp('data-cs-horizon="' + h + '" aria-pressed="' + C.defaultHorizons.includes(h) + '" title="' + h + ' 个交易日">' + term + '<'), term);
  for (const label of ['1周', '1个月', '3个月', '1年', '全部交易日', '期间最大回撤', '自信号日最大跌幅']) assert.ok(html.includes(label), label);
  assert.match(html, /<svg data-cs-chart="main"[^>]+role="img"/);
  assert.match(html, /最近 63 个交易日（/);
  assert.match(html, /历史中位数/);
  assert.doesNotMatch(html, /<line class="cs-mark"/, 'no observation period, no marker');
});

test('ticking or editing a condition switches to manual and keeps readable ranges in the address', async () => {
  const f = fixture();
  await f.settle();
  const fit = C.fit(f.view, { gap:21 }), extra = C.metrics.find(m => !m.choice && !fit.added.includes(m.id) && C.suggest(f.view, m.id)).id;
  f.toggle(extra, true);
  let html = await f.settle();
  // Ranges taken from the reference date keep following it, so the address names the rows, not their numbers.
  const ticked = [...fit.added, extra];
  assert.equal(f.location.hash, '#condition-study?' + C.metrics.filter(m => ticked.includes(m.id)).map(m => m.id + '=ref').join('&'));
  assert.match(html, /data-cs-action="fit" aria-pressed="false">按参照日匹配/);
  assert.ok(html.includes('自选 ' + ticked.length + ' 项条件'));
  assert.ok(checked(html, extra));
  const band = C.suggest(f.view, extra);
  assert.deepEqual([inputValue(html, extra, 'lo'), inputValue(html, extra, 'hi')], [String(band.lo ?? ''), String(band.hi ?? '')]);
  assert.ok(rowOf(html, extra).includes('>随参照日</small>'));
  const r = C.study(f.view, { conditions:{ ...fit.conditions, [extra]:band }, gap:21 });
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  assert.ok(rowOf(html, extra).includes('<small>取消勾选后</small><b>' + r.previews[extra].episodes.toLocaleString('zh-CN') + '</b> 段'));

  // Typing a number fixes that row as shown, other bound included; the other rows still follow the date.
  const id = fit.added[0], { lo, hi } = fit.conditions[id];
  const wider = hi === null ? { lo:lo - 1, hi:null } : { lo, hi:hi + 1 };
  let input = await f.enter(id, hi === null ? 'lo' : 'hi', String(hi === null ? wider.lo : wider.hi));
  assert.equal(input.error, '');
  assert.ok(f.location.hash.includes(id + '=' + C.formatRange(wider)));
  assert.ok(f.location.hash.includes(extra + '=ref'));
  html = await f.settle();
  assert.ok(rowOf(html, id).includes('>手动填写</small>'));

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

test('a chosen reference date re-reads every row and the match, and returns to the latest close on request', async () => {
  const f = fixture();
  await f.settle();
  const at = f.data.n - 400, date = f.data.dates[at];
  let html = await f.setDate(date);
  assert.equal(f.location.hash, '#condition-study?date=' + date);
  const fit = C.fit(f.view, { gap:21, ref:at }), r = C.study(f.view, { conditions:fit.conditions, gap:21, ref:at });
  assert.ok(html.includes('已按 ' + date + ' 的读数选取 ' + fit.added.length + ' 项'));
  assert.ok(html.includes('value="' + date + '"><button type="button" class="text-link" data-cs-action="latest">回到最新</button>'));
  assert.ok(html.includes('<span>指标</span><span>' + date + '</span>'), 'the readings column is headed by the reference date');
  assert.ok(html.includes(date + ' 收盘满足全部 ' + fit.added.length + ' 项条件'));
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  assert.ok(html.includes('参照日 ' + date + ' 前后'));
  if (r.episodes.slice(0, 15).some(e => e.date === r.reference.episode)) assert.match(html, /含参照日/);
  for (const id of fit.added) assert.equal(inputValue(html, id, 'lo'), String(fit.conditions[id].lo ?? ''), id);

  // A weekend resolves to the session before it; a hand-typed one says which session it used.
  const saturday = new Date(date + 'T00:00:00Z');
  while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
  const weekend = saturday.toISOString().slice(0, 10), friday = f.data.dates[C.sessionOn(f.data, weekend)];
  await f.setDate(weekend);
  assert.equal(f.location.hash, '#condition-study?date=' + friday);
  const typed = fixture({ hash:'#condition-study?date=' + weekend });
  assert.ok((await typed.settle()).includes(weekend + ' 无收盘，用 ' + friday));

  // Ranges typed by hand stay put when the date moves; only the readings change.
  await f.enter('r1', 'hi', '-2');
  const manual = f.location.hash;
  assert.match(manual, /date=[^&]+&.*\br1=[^&]*~-2(&|$)/);
  await f.setDate(f.data.asOf);
  assert.equal(f.location.hash, manual.replace(/date=[^&]+&/, ''));
  f.click('action', 'fit');
  await f.settle();
  await f.setDate(date);
  f.click('action', 'latest');
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study');
  assert.match(html, /<small>最新收盘<\/small>/);
});

test('ticked ranges follow the reference date, typed numbers stay, and a row without a reading waits', async () => {
  const f = fixture();
  await f.settle();
  const at = f.data.n - 400, date = f.data.dates[at];
  const moves = id => C.suggest(f.view, id) && C.suggest(f.view, id, { ref:at }) &&
    C.formatRange(C.suggest(f.view, id)) !== C.formatRange(C.suggest(f.view, id, { ref:at }));
  const [a, b] = C.metrics.filter(m => !m.choice && m.id !== 'r1' && moves(m.id)).map(m => m.id);
  assert.ok(a && b, 'the fixture must move at least two suggested ranges between the dates');
  f.click('action', 'clear');
  await f.settle();
  f.toggle(a, true);
  await f.settle();
  f.toggle(b, true);
  await f.settle();
  await f.enter('r1', 'hi', '-2');
  const ids = C.metrics.filter(m => [a, b, 'r1'].includes(m.id)).map(m => m.id);
  const query = ids.map(id => id + '=' + (id === 'r1' ? '~-2' : 'ref')).join('&');
  assert.equal(f.location.hash, '#condition-study?' + query);

  let html = await f.setDate(date);
  assert.equal(f.location.hash, '#condition-study?date=' + date + '&' + query);
  const conditions = { [a]:C.suggest(f.view, a, { ref:at }), [b]:C.suggest(f.view, b, { ref:at }), r1:{ lo:null, hi:-2 } };
  for (const id of [a, b]) {
    assert.deepEqual([inputValue(html, id, 'lo'), inputValue(html, id, 'hi')], [String(conditions[id].lo ?? ''), String(conditions[id].hi ?? '')], id);
    assert.ok(rowOf(html, id).includes('>随参照日</small>'), id);
  }
  assert.equal(inputValue(html, 'r1', 'hi'), '-2');
  assert.ok(rowOf(html, 'r1').includes('>手动填写</small>'));
  const r = C.study(f.view, { conditions, gap:21, ref:at });
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  // Ranges taken from the date always hold there, so only the typed one can fail.
  assert.deepEqual(r.reference.failing.filter(id => id !== 'r1'), []);
  assert.ok(html.includes(r.reference.matches ? date + ' 收盘满足全部 3 项条件' : date + ' 收盘不满足：当日涨跌'));

  // Typing into a following row fixes it with the range shown, the other bound included.
  const band = conditions[a], side = band.hi === null ? 'lo' : 'hi', moved = side === 'lo' ? band.lo - 1 : band.hi + 1;
  await f.enter(a, side, String(moved));
  assert.ok(f.location.hash.includes(a + '=' + C.formatRange({ ...band, [side]:moved })));
  html = await f.setDate(f.data.asOf);
  assert.equal(inputValue(html, a, side), String(moved));
  assert.ok(rowOf(html, a).includes('>手动填写</small>'));
  assert.deepEqual([inputValue(html, b, 'lo'), inputValue(html, b, 'hi')].join(), [C.suggest(f.view, b).lo ?? '', C.suggest(f.view, b).hi ?? ''].join());

  // With an observation still running at the latest close, a followed observation reading has nothing to follow yet.
  const g = fixture({ hash:'#condition-study?obs=2&r1=~-2&rebound=ref' });
  html = await g.settle();
  const v = g.frameFor({ wait:2 });
  assert.equal(C.suggest(v, 'rebound'), null);
  assert.ok(html.includes('自选 1 项条件；收回比例 参照日无读数，暂不生效'));
  assert.ok(checked(html, 'rebound') && rowOf(html, 'rebound').includes('参照日无读数，暂不生效'));
  assert.ok(html.includes('匹配 <b>' + C.study(v, { conditions:{ r1:{ lo:null, hi:-2 } }, gap:21 }).episodes.length + '</b> 段'));
  // On a day with a finished period and a down signal day, the same row applies.
  let day = v.last;
  while (day > 0 && !C.suggest(v, 'rebound', { ref:day })) day--;
  html = await g.setDate(v.dates[day]);
  const rebound = C.suggest(v, 'rebound', { ref:day });
  assert.ok(html.includes('自选 2 项条件'));
  assert.equal(inputValue(html, 'rebound', 'lo'), String(rebound.lo ?? ''));
  assert.ok(html.includes('匹配 <b>' + C.study(v, { conditions:{ r1:{ lo:null, hi:-2 }, rebound }, gap:21, ref:day }).episodes.length + '</b> 段'));
});

test('an observation period adds the recovery rows, moves where results start and shows each period', async () => {
  const f = fixture({ hash:'#condition-study?obs=2&r1=~-2' });
  let html = await f.settle();
  const v = f.frameFor({ wait:2 }), r = C.study(v, { conditions:{ r1:{ lo:null, hi:-2 } }, gap:21 });
  assert.ok(html.includes('<legend>观察期 · 信号后 2 个交易日</legend>'));
  assert.ok(html.includes('<div id="cs-basis">收复判定：收盘</div>'));
  assert.match(html, /从信号后第 2 个交易日（观察期末）收盘起算/);
  assert.ok(html.includes('<th scope="col">观察 2 日结果</th><th scope="col">起算日</th>'));
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  assert.match(html, /<line class="cs-mark"/);
  const p = r.previews.recov;
  assert.ok(html.includes('data-cs-choice="recov" data-value="no" aria-pressed="false">始终未收复<small>' + p.no + ' 段</small>'));
  assert.ok(html.includes('data-cs-choice="recov" data-value="any" aria-pressed="true">不限</button>'));
  assert.match(html, /先收复再跌回也算曾收复/);

  f.choice('recov', 'no');
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?obs=2&r1=~-2&recov=no');
  const unrecovered = C.study(v, { conditions:{ r1:{ lo:null, hi:-2 }, recov:{ lo:0, hi:0 } }, gap:21 }), e = unrecovered.episodes[0];
  assert.equal(unrecovered.historical, p.no, 'the count on the choice is the sample it leaves');
  assert.ok(html.includes('匹配 <b>' + unrecovered.episodes.length + '</b> 段'));
  assert.ok(html.includes('<small>改为不限后</small><b>' + C.count(v, { r1:{ lo:null, hi:-2 } }, 21) + '</b> 段'));
  assert.ok(html.includes('始终未收复<small>观察期 ' + pct(e.observation.move)));
  assert.ok(html.includes('<td>' + e.observation.anchorDate + '</td>'));
  f.click('event', e.date);
  const modal = f.modals.at(-1);
  assert.match(modal, /<h3>观察期 · 2 个交易日<\/h3>/);
  assert.ok(modal.includes('后续收益从 ' + e.observation.anchorDate + ' 收盘'));
  assert.ok(modal.includes('<th scope="row">第 2 日</th><td>' + e.observation.anchorDate + '</td>'));
  f.click('action', 'csv');
  const header = f.downloads.at(-1)[1].replace(/^﻿/, '').split('\r\n')[0];
  for (const name of ['观察期内收复前一日收盘', '首次收复日', '起算日', '期末收回比例%']) assert.ok(header.includes('"' + name + '"'), name);

  // Without an observation period its conditions leave the address too.
  f.ui.choose('wait', '0');
  assert.equal(f.location.hash, '#condition-study?r1=~-2');
  f.ui.choose('wait', 'custom');
  assert.match(f.modals.at(-1), /id="cs-wait-form"/);
  assert.equal(f.submitWait(0), false);
  assert.equal(f.submitWait(253), false);
  assert.equal(f.submitWait(7), true);
  assert.equal(f.location.hash, '#condition-study?obs=7&r1=~-2');
  assert.match(await f.settle(), /<div id="cs-wait">信号后观察期：7 个交易日<\/div>/);
});

test('a reference close still inside its observation period says how many sessions remain', async () => {
  const closes = walk(2599, 2);
  closes.push(Number((closes.at(-1) * .93).toFixed(2)));
  const f = fixture({ hash:'#condition-study?obs=5&r1=~-5', series:sessions(closes) });
  const html = await f.settle();
  assert.ok(html.includes(f.data.asOf + ' 收盘满足信号日条件，观察期还差 5 个交易日'));
  assert.match(html, /cs-now-status is-wait/);
  assert.doesNotMatch(html, /另有 \d+ 个交易日满足信号日条件/);
  assert.ok(html.includes('<b>—</b><small>观察期还差 5 个交易日</small>'));
});

test('the intraday-high basis uses closed-session highs that agree with the published closes', async () => {
  const f = fixture({ hash:'#condition-study?obs=2&basis=high&r1=~-2' });
  let html = await f.settle();
  assert.ok(f.state.fetches.some(url => url.startsWith('data/drop-study/catalog.json')));
  const v = f.frameFor({ wait:2, basis:'high', highs:f.highs }), r = C.study(v, { conditions:{ r1:{ lo:null, hi:-2 } }, gap:21 });
  assert.ok(html.includes('<div id="cs-basis">收复判定：盘中最高价</div>'));
  assert.ok(html.includes('匹配 <b>' + r.episodes.length + '</b> 段'));
  assert.ok(html.includes('观察期 · 信号后 2 个交易日 · 按盘中最高价判定收复'));
  const touched = r.episodes.slice(0, 15).find(e => e.observation.recovered);
  if (touched) assert.match(html, /盘中曾触及，期末/);
  f.click('event', r.episodes[0].date);
  assert.match(f.modals.at(-1), /<th>盘中最高<\/th>/);

  const mismatch = fixture({ hash:'#condition-study?obs=2&basis=high&r1=-100~', highsMode:'mismatch' });
  html = await mismatch.settle();
  const odd = mismatch.series.length - 300, kept = mismatch.highs.filter((_, i) => i !== odd);
  const expected = C.study(mismatch.frameFor({ wait:2, basis:'high', highs:kept }), { conditions:{ r1:{ lo:-100, hi:null } }, gap:21 });
  assert.ok(html.includes('匹配 <b>' + expected.episodes.length + '</b> 段'), 'a high whose close disagrees is left out, not trusted');

  const down = fixture({ hash:'#condition-study?obs=2&basis=high&r1=~-2', highsMode:'down' });
  html = await down.settle();
  assert.match(html, /盘中最高价未能读取：最高价目录加载失败（503）/);
  assert.match(html, /data-cs-action="retry-high"/);
  assert.match(html, /匹配 <b>0<\/b> 段/);
  const stale = fixture({ hash:'#condition-study?obs=2&basis=high&r1=~-2', highsMode:'stale' });
  assert.ok((await stale.settle()).includes('最高价最近一次更新失败，沿用截至 ' + stale.data.asOf + ' 的数据。'));
});

test('chosen horizons drive the summary, the record columns, the fall window and the export', async () => {
  const f = fixture({ hash:'#condition-study?r1=~-2' });
  await f.settle();
  f.chip(1);
  let html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?h=1,5,21,63,252&r1=~-2');
  assert.ok(html.includes('<th scope="row">1日<small>1 个交易日</small></th>'));
  assert.ok(html.includes('<th scope="col">1日后</th>'));
  for (const h of [5, 21, 63, 252]) { f.chip(h); await f.settle(); }
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?h=1&r1=~-2');
  assert.match(html, /data-cs-horizon="1" aria-pressed="true" title="1 个交易日" disabled>1日</);
  f.chip(1, true);
  assert.equal(f.location.hash, '#condition-study?h=1&r1=~-2', 'the last horizon stays selected');
  const r = C.study(f.view, { conditions:{ r1:{ lo:null, hi:-2 } }, gap:21, horizons:[1] }), e = r.episodes[0];
  assert.ok(html.includes('自信号日最大跌幅<small>1日内</small>'));
  const where = e.fall.pct === 0 ? '未再跌破' : '第 ' + e.fall.days + ' 日 · ' + e.fall.date;
  assert.ok(html.includes(pct(e.fall.pct) + '</span><small>' + where));
  assert.doesNotMatch(html, /<th scope="col">1周后<\/th>/);
  f.click('action', 'csv');
  const header = f.downloads.at(-1)[1].replace(/^﻿/, '').split('\r\n')[0];
  assert.ok(header.includes('"1日累计涨跌%"') && !header.includes('"1周累计涨跌%"'));
  assert.ok(header.includes('"自信号日最大跌幅%","最大跌幅日","距信号日交易日数"'));
});

test('look-back numbers typed into a row name re-read that row and keep its range', async () => {
  const f = fixture({ hash:'#condition-study?rN=~-3' });
  let html = await f.settle();
  assert.ok(html.includes('近 <input class="cs-param" type="number" inputmode="decimal" data-cs-param="rNDays" value="10"'));
  let input = await f.param('rNDays', '20');
  assert.equal(input.error, '');
  assert.equal(f.location.hash, '#condition-study?rNDays=20&rN=~-3');
  html = await f.settle();
  const v = f.frameFor({ params:{ rNDays:20 } });
  assert.ok(html.includes('匹配 <b>' + C.study(v, { conditions:{ rN:{ lo:null, hi:-3 } }, gap:21 }).episodes.length + '</b> 段'));
  assert.ok(html.includes('aria-label="关于近 20 日涨跌"'));
  input = await f.param('rNDays', '0');
  assert.equal(input.error, '请输入 1–2520 的整数');
  input = await f.param('dropsPct', '5.125');
  assert.equal(input.error, '请输入 0.01–99.99，最多两位小数');
  assert.equal(f.location.hash, '#condition-study?rNDays=20&rN=~-3');
  // While the match is automatic, a new look-back keeps it automatic.
  const g = fixture();
  await g.settle();
  await g.param('ddNDays', '126');
  assert.equal(g.location.hash, '#condition-study?ddNDays=126');
  assert.match(await g.settle(), /✓ 已按参照日匹配[\s\S]*距近 <input class="cs-param"[^>]*value="126"/);
});

test('clearing leaves an honest empty state, and the match button restores the fit with market and spacing kept', async () => {
  const f = fixture({ hash:'#condition-study?market=spx&gap=63&r1=~-1' });
  let html = await f.settle();
  assert.match(html, /标普500/);
  assert.match(html, /合并范围：63 个交易日内 · 约3个月/);
  assert.match(html, /data-cs-action="fit" aria-pressed="false"/);
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
  assert.match(html, /✓ 已按参照日匹配/);
  const fit = C.fit(f.view, { gap:5 });
  assert.ok(html.includes('选取 ' + fit.added.length + ' 项'));
  assert.ok(html.includes('匹配 <b>' + C.study(f.view, { conditions:fit.conditions, gap:5 }).episodes.length + '</b> 段'));
  f.ui.choose('gap', '1');
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?market=spx&gap=1');
  // Counting each day separately hides the merge window and offers the last one back.
  assert.ok(html.includes('data-cs-gap="1" aria-pressed="true">每天单独计</button><button type="button" class="" data-cs-gap="5" aria-pressed="false">合并为一段'));
  assert.doesNotMatch(html, /id="cs-gap"/);
});

test('unknown address values fall back to the defaults instead of half-applying', async () => {
  const f = fixture({ hash:'#condition-study?market=foo&gap=7&r1=abc&dd252=30~10&since252=2.5~&obs=300&h=7&date=2001-13-01&rNDays=0&recov=yes' });
  const html = await f.settle();
  assert.match(html, /纳斯达克100/);
  assert.match(html, /合并范围：21 个交易日内 · 约1个月/);
  assert.match(html, /data-cs-action="fit" aria-pressed="true"/);
  assert.match(html, /信号后观察期：不设/);
  assert.match(html, /<small>最新收盘<\/small>/);
  assert.ok(html.includes('data-cs-param="rNDays" value="10"'));
  assert.doesNotMatch(html, /data-cs-choice/, 'observation rows need an observation period');
});

test('when nothing matches, each row shows what removing it would leave and export is off', async () => {
  const f = fixture({ hash:'#condition-study?r1=50~&dd252=0~' });
  const html = await f.settle();
  assert.match(html, /匹配 <b>0<\/b> 段/);
  assert.match(html, /没有同时满足全部条件的交易日/);
  assert.match(html, /data-cs-action="csv" disabled/);
  assert.match(html, /不满足：当日涨跌/);
  assert.ok(html.includes('<small>取消勾选后</small><b>' + C.count(f.view, { dd252:{ lo:0, hi:null } }, 21).toLocaleString('zh-CN') + '</b> 段'));
  assert.match(html, /<small>勾选后<\/small><b>0<\/b> 段/);
  assert.ok(rowOf(html, 'r1').includes('>手动填写</small>'), 'ranges from the address are typed ones');
  f.click('action', 'csv');
  assert.equal(f.downloads.length, 0);
});

test('CSV holds every episode and the condition source; paging reaches the rest of the table', async () => {
  // Without VIX this walk keeps more than one page of samples; it also shows a VIX outage leaves the study usable.
  const f = fixture({ seed:4, vixMode:'down' });
  let html = await f.settle();
  const fit = C.fit(f.view, { gap:21 }), r = C.study(f.view, { conditions:fit.conditions, gap:21 });
  assert.ok(r.episodes.length > 15, 'the fixture needs more than one page');
  f.click('action', 'csv');
  const [name, csv] = f.downloads.at(-1), lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(name, '行情条件后表现-纳斯达克100-' + f.data.asOf + '.csv');
  assert.equal(lines.length, r.episodes.length + 1);
  for (const column of ['条件来源', '参照日', '1年自信号日最大跌幅%', 'VIX 收盘', '自信号日最大跌幅%', '最大跌幅窗口']) assert.ok(lines[0].includes('"' + column + '"'), column);
  assert.ok(lines[1].includes('"按 ' + f.data.asOf + ' 读数自动选取"'));
  for (const id of fit.added) assert.ok(lines[1].includes(C.byId[id].label), id);
  assert.ok(lines.at(-1).includes('"' + r.episodes.at(-1).date + '"'));
  const row = date => 'data-cs-event="' + date + '"';
  assert.ok(html.includes(row(r.episodes[0].date)));
  assert.ok(!html.includes(row(r.episodes[15].date)));
  f.click('action', 'next');
  html = await f.settle();
  assert.match(html, /第 2 \/ \d+ 页/);
  assert.ok(html.includes(row(r.episodes[15].date)));
  f.click('action', 'csv');
  assert.equal(f.downloads.at(-1)[1], csv);
  f.click('action', 'prev');
  assert.match(await f.settle(), /第 1 \/ \d+ 页/);
});

test('merged days show under their segment, in the detail and the CSV; counting each day separately lists them all', async () => {
  const f = fixture({ hash:'#condition-study?h=1,2,5,21&r1=~-2' });
  let html = await f.settle();
  const r = C.study(f.view, { conditions:{ r1:{ lo:null, hi:-2 } }, gap:21, horizons:[1, 2, 5, 21] }), merged = r.matchingDays - r.episodes.length;
  const e = r.episodes.slice(0, 15).find(x => x.merged.length);
  assert.ok(e, 'the first page needs a segment with merged days');
  assert.ok(html.includes('<small>其中 ' + merged.toLocaleString('zh-CN') + ' 天并入所在段</small>'));
  const last = e.merged.at(-1), until = last.slice(0, 4) === e.date.slice(0, 4) ? last.slice(5) : last;
  assert.ok(html.includes('<small title="并入的满足日：' + e.merged.join('、') + '">并入 ' + e.merged.length + ' 天 · 至 ' + until + '</small>'));
  assert.ok(html.includes('每段只从首个满足日起算，另 ' + merged.toLocaleString('zh-CN') + ' 个满足日不计入，1日至1周的结果尤其受影响；后续区间仍可能重叠'));
  f.click('event', e.date);
  assert.ok(f.modals.at(-1).includes('并入本段的 ' + e.merged.length + ' 个满足日：'));
  f.click('action', 'csv');
  const lines = f.downloads.at(-1)[1].replace(/^﻿/, '').split('\r\n');
  assert.ok(lines[0].includes('"相近满足日"') && lines[0].includes('"信号收盘","并入的满足日"'));
  assert.ok(lines.find(line => line.includes('"' + e.date + '"')).includes('"合并 21 个交易日内"'));
  assert.ok(lines.some(line => line.includes('"' + e.date + '"') && line.includes('"' + e.merged.join(' ') + '"')));
  // Horizons at or beyond the merge window drop the short-horizon warning.
  for (const h of [1, 2, 5]) f.chip(h);
  html = await f.settle();
  assert.ok(html.includes('另 ' + merged.toLocaleString('zh-CN') + ' 个满足日不计入；后续区间仍可能重叠'));
  for (const h of [1, 2, 5]) f.chip(h);
  f.spacing(1);
  html = await f.settle();
  assert.equal(f.location.hash, '#condition-study?gap=1&h=1,2,5,21&r1=~-2');
  assert.ok(html.includes('匹配 <b>' + r.matchingDays + '</b> 段'));
  assert.doesNotMatch(html, /天并入所在段|并入 \d+ 天 · 至/);
  assert.ok(html.includes('每个满足日单独计；相近日期的较长期限结果大量重叠'));
  const days = C.study(f.view, { conditions:{ r1:{ lo:null, hi:-2 } }, gap:1, horizons:[1, 2, 5, 21] });
  assert.equal(days.summary[1].n + days.summary[1].pending + days.summary[1].gap, r.matchingDays, 'every matching day has a 1-day result or a status');
  f.spacing(21);
  assert.equal(f.location.hash, '#condition-study?h=1,2,5,21&r1=~-2');
});

test('an episode opens its own path, outcomes, fall and readings', async () => {
  const f = fixture({ seed:4 });
  await f.settle();
  const fit = C.fit(f.view, { gap:21 }), r = C.study(f.view, { conditions:fit.conditions, gap:21 });
  const old = r.episodes.at(-1), latest = r.episodes[0];
  f.click('event', old.date);
  let modal = f.modals.at(-1);
  assert.match(modal, /<svg data-cs-chart="event"[^>]+role="img"/);
  assert.ok(modal.includes(old.date + ' · 纳斯达克100'));
  assert.match(modal, /已走完 252 个交易日/);
  assert.ok(modal.includes(old.outcomes[252].date));
  assert.match(modal, /实际期末日/);
  assert.ok(modal.includes('自信号日最大跌幅 <b>' + pct(old.fall.pct) + '</b>'));
  for (const [g, title] of C.groups) assert.equal(modal.includes('<h3>' + title + '</h3>'), g !== 'obs', g);
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
  const fit = C.fit(f.view, { gap:21 }), r = C.study(f.view, { conditions:fit.conditions, gap:21 });
  const spread = new Map(C.spread(f.data, r.episodes.map(e => e.index)).map(x => [x.k, x]));
  const now = new Map(C.path(f.data, f.data.last, C.lookback, 0));
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
  html = await wrong.settle();
  assert.match(html, /cs-conditions-title/);
  assert.ok(html.includes('<b>—</b><small>缺纳斯达克100日线</small>'), 'the other index names what is missing');
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

test('VIX loads once for both indices, names its exact gaps, and a VIX outage leaves the index study intact', async () => {
  const f = fixture();
  let html = await f.settle();
  const now = id => html.match(new RegExp('id="cs-' + id + '-on"[\\s\\S]*?<span class="cs-now"><b>([^<]*)</b><small>([^<]*)</small>'))?.slice(1);
  assert.ok(f.data.vix && f.data.vix.missing.length === 1, 'the fixture has one session without a Cboe close');
  assert.equal(now('vix')[0], f.vix.at(-1)[1].toFixed(2));
  assert.match(now('vix')[1], /^分位 /);
  assert.ok(html.includes('缺 ' + f.data.vix.missing[0] + ' 的读数，当日按未知处理'));
  f.ui.choose('market', 'spx');
  await f.settle();
  assert.equal(f.state.fetches.filter(url => url.startsWith('data/condition-study/catalog.json')).length, 1, 'both indices share one VIX download');

  const lagging = fixture({ vix:vixFor(sessions(walk(2600, 2))).slice(0, -1) });
  html = await lagging.settle();
  const asOf = lagging.data.asOf;
  const lagNow = id => html.match(new RegExp('id="cs-' + id + '-on"[\\s\\S]*?<span class="cs-now"><b>([^<]*)</b><small>([^<]*)</small>'))?.slice(1);
  assert.deepEqual(lagNow('vix'), ['—', '缺 ' + asOf + ' VIX'], 'a VIX file that stops a day early names the missing date');
  assert.deepEqual(lagNow('vix5'), ['—', '缺 ' + asOf + ' VIX']);
  assert.match(html, /id="cs-vix-on"[^>]*disabled/);

  const down = fixture({ vixMode:'down' });
  html = await down.settle();
  assert.match(html, /缺 VIX 日线：VIX 目录加载失败（503）/);
  assert.match(html, /id="cs-vix-on"[^>]*disabled/);
  assert.match(html, /cs-conditions-title/);
  assert.ok(!html.includes('ds-loading'), 'the index study still renders');

  const unordered = fixture({ vixMode:'unordered' });
  assert.match(await unordered.settle(), /缺 VIX 日线：VIX 日线的日期、顺序或读数有误/);

  const stale = fixture({ vixMode:'stale' });
  assert.match(await stale.settle(), /最近一次更新失败，保留原读数/);
});

test('each indicator explains itself, and the match explains why it ticked or skipped it', async () => {
  const f = fixture();
  const html = await f.settle();
  const fit = C.fit(f.view, { gap:21 }), r = C.study(f.view, { conditions:fit.conditions, gap:21 });
  const pop = id => html.match(new RegExp('<div id="cs-info-' + id + '" class="cs-info-pop" popover>(.*?)</div>'))?.[1] || '';
  for (const m of C.metrics) if (m.source !== 'obs') {
    assert.ok(html.includes('<button type="button" class="cs-info" popovertarget="cs-info-' + m.id + '" aria-label="关于' + nameOf(m) + '">i</button>'), m.id);
    assert.ok(pop(m.id).startsWith('<b>' + nameOf(m) + '</b><p>'), m.id);
  }
  assert.doesNotMatch(html, /<label[^>]*>(?:(?!<\/label>).)*<button/, 'an info button is never nested inside a label');
  const rule = pop('fit');
  assert.ok(rule.includes('依次尝试 ' + C.fitOrder.length + ' 项：距252日高点、近21日、近5日、当日、距200日线、VIX、波动率、近3日、近63日。'));
  assert.ok(rule.includes('其余项目不自动尝试，可手动勾选或填写。'));
  const kept = fit.steps.find(s => s.kept), keptAt = C.fitOrder.indexOf(kept.id) + 1;
  assert.ok(pop(kept.id).includes('按参照日匹配第 ' + keptAt + ' 项：') && pop(kept.id).includes('加入时仍有 ' + kept.episodes + ' 段，已勾选。'), kept.id);
  const skipped = fit.steps.find(s => s.band && !s.kept);
  assert.ok(pop(skipped.id).includes('加入时只剩 ' + skipped.episodes + ' 段，少于 10 段，未勾选'), skipped.id);
  const now = r.previews[skipped.id].episodes;
  if (now !== skipped.episodes) assert.ok(pop(skipped.id).includes('按现有条件勾选会剩 ' + now + ' 段'));
  assert.ok(pop('rsi14').includes('按参照日匹配不尝试此项。勾选后按参照日读数取 '), 'a reading outside the automatic list says so');
  assert.match(pop('ddMax'), /收盘比 2001 年数据起点以来的最高收盘低多少/);
  assert.match(pop('vix'), /研究纳斯达克100时也用它/);
  assert.match(pop('vix'), /数据：Cboe 官方日收盘，2001-01-02 至 /);
  assert.match(pop('drops'), /不含信号日/);

  f.toggle('rsi14', true);
  const manual = await f.settle();
  const after = id => manual.match(new RegExp('<div id="cs-info-' + id + '" class="cs-info-pop" popover>(.*?)</div>'))?.[1] || '';
  assert.match(after('rsi14'), /已勾选 (?:[≥≤] \d+|\d+ 至 \d+)，范围随参照日；取消勾选后匹配 \d+ 段。/);
  assert.match(after('up'), /勾选后按参照日读数取 |参照日读数未知/);
});

test('an info popover opens under its button, inside the window, and upward near the bottom edge', async () => {
  const f = fixture();
  await f.settle();
  const style = {}, pop = { id:'cs-info-vix', classList:{ contains:name => name === 'cs-info-pop' }, style, offsetHeight:180 };
  f.nodes['[popovertarget="cs-info-vix"]'] = { getBoundingClientRect:() => ({ left:1500, top:300, bottom:318 }) };
  f.listeners.beforetoggle({ target:pop, newState:'open' });
  assert.deepEqual(style, { width:'360px', left:String(1600 - 360 - 16) + 'px', top:String(1000 + 318 + 6) + 'px' });
  f.listeners.toggle({ target:pop, newState:'open' });
  assert.equal(style.top, String(1000 + 318 + 6) + 'px', 'enough room below keeps it under the button');
  f.nodes['[popovertarget="cs-info-vix"]'] = { getBoundingClientRect:() => ({ left:20, top:820, bottom:838 }) };
  f.listeners.beforetoggle({ target:pop, newState:'open' });
  f.listeners.toggle({ target:pop, newState:'open' });
  assert.equal(style.top, String(1000 + 820 - 6 - 180) + 'px');
  assert.equal(style.left, '20px');
  const untouched = { ...style };
  f.listeners.beforetoggle({ target:{ ...pop, classList:{ contains:() => false } }, newState:'open' });
  f.listeners.beforetoggle({ target:pop, newState:'closed' });
  assert.deepEqual(style, untouched);
});

test('old 指数大跌 links open here with the same settings', async () => {
  const f = fixture();
  await f.settle();
  assert.equal(f.ui.legacy('#drop-study'), '#condition-study?obs=2&gap=1&r1=~-5&recov=no');
  assert.equal(f.ui.legacy('#drop-study?threshold=7&wait=5&group=recovered&recovery=high&trend=below&market=spx'),
    '#condition-study?market=spx&obs=5&basis=high&gap=1&dropsPct=7&r1=~-7&ma200p=~0&recov=yes');
  const g = fixture({ hash:f.ui.legacy('#drop-study?threshold=3&repeat=first') });
  const html = await g.settle();
  assert.ok(html.includes('<div id="cs-wait">信号后观察期：2 个交易日</div>'));
  assert.ok(html.includes('data-cs-gap="1" aria-pressed="true">每天单独计'));
  assert.ok(html.includes('data-cs-choice="recov" data-value="no" aria-pressed="true"'));
  assert.ok(html.includes('近 21 日跌超 <input class="cs-param" type="number" inputmode="decimal" data-cs-param="dropsPct" value="3"'));
  const expected = C.study(g.frameFor({ wait:2, params:{ dropsPct:3 } }), { conditions:{ r1:{ lo:null, hi:-3 }, drops:{ lo:0, hi:0 }, recov:{ lo:0, hi:0 } }, gap:1 });
  assert.ok(html.includes('匹配 <b>' + expected.episodes.length + '</b> 段'));
});
