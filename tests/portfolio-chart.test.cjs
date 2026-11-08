const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../assets/portfolio-model.js');
const M = require('../assets/model.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('chart zoom, cash weights and independent overlays follow the same dates without filling missing signals', async () => {
  const data = {};
  vm.runInNewContext(read('data/portfolio/catalog.js'), data);
  const cfg = {positions: [{id: 'us:SPY', weight: 30}], initial: 100000, currency: 'USD', monthly: 0,
    initialMethod: 'lump_sum', contributionMethod: 'dca_month', benchmarkId: '', years: 'custom', start: '2024-01-02', end: '2024-04-30'};
  // Exercise the actual simulation and UI with deliberately sparse indicator observations.
  const model = {...P, simulateWindows: () => [], chartIndicators: r => ({reason: '', series: [
    {id: 'score', label: '分数样本', kind: 'score', unit: '分', thresholds: [60], points: [[r.start, 0], ['2024-04-01', 4], ['2024-04-02', null], ['2024-04-03', 77], [r.end, 100]]},
    {id: 'gate', label: '开关样本', reference: true, kind: 'state', unit: '状态', points: [['2024-04-01', 100]]}
  ]})};
  const tooltip = {style: {}, offsetWidth: 100, offsetHeight: 80};
  const listeners = {}, eventsFor = (type, event) => (listeners[type] || []).forEach(fn => fn({type, preventDefault() {}, ...event}));
  const ctx = {requestAnimationFrame: () => 1, cancelAnimationFrame() {}, window: {Changheng: M, ChanghengPortfolioModel: model, PORTFOLIO_CATALOG: data.PORTFOLIO_CATALOG},
    localStorage: {getItem: () => JSON.stringify(cfg), setItem() {}},
    fetch: async url => ({ok: true, text: () => read(url)}),
    document: {addEventListener(type, cb) {(listeners[type] ||= []).push(cb);}, getElementById: id => id === 'portfolio-tooltip' ? tooltip : null, querySelectorAll: () => []}};
  vm.runInNewContext(read('assets/portfolio.js'), ctx);
  const ui = ctx.window.ChanghengPortfolio;
  const h = {esc: s => String(s ?? ''), action: (label, key, cls, extra) => '<button data-action="' + key + '" ' + extra + '>' + label + '</button>',
    card: (title, sub, body, controls) => '<section><h2>' + title + '</h2>' + sub + (controls || '') + body + '</section>', annual: false, annualControl: '',
    money: n => Number(n).toFixed(2), pc: String, pct: n => Number(n).toFixed(2) + '%', stat: () => '', loadFooter: () => '', lazyRows: () => '', resetList() {}, render: () => ui.view(h)};
  const click = (name, value) => ui.handleAction({dataset: {action: 'portfolio-' + name, value}});
  const change = (field, value, checked = true) => ui.handleChange({dataset: {portfolioField: 'chart-' + field}, value, checked, checkValidity: () => true});
  const chart = () => ui.view(h).split('<h2>组合走势</h2>')[1].split('</section>')[0];
  const range = () => [...chart().matchAll(/data-portfolio-field="chart-(?:from|to)"[^>]+value="([^"]+)"/g)].map(m => m[1]);
  ui.view(h); await click('run');
  assert.deepEqual(range(), [cfg.start, cfg.end]);
  assert.doesNotMatch(chart(), /data-indicator-line=/);
  assert.doesNotMatch(chart(), /模拟首日|现金流中性|首年按|<title>|横向拖选可放大/);
  assert.ok(chart().indexOf('data-chart-rail') > chart().indexOf('</svg>'));
  assert.match(chart(), /role="slider" data-nav-handle="from"/); assert.match(chart(), /role="slider" data-nav-handle="to"/);
  const events = {}, plot = {getBoundingClientRect: () => ({left: 0, top: 0, width: 920, height: 330}), hasPointerCapture: () => false, setPointerCapture() {},
    addEventListener: (key, cb) => {events[key] = cb;}, removeEventListener: key => {delete events[key];}};
  const hover = (x, type = 'pointermove') => ui.showPoint({type, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: 100, target: {closest: () => plot}});
  for (const mode of ['amount', 'allocation']) {
    click('metric', mode);
    assert.match(chart(), mode === 'amount' ? /持仓本金（不含现金）/ : /实际现金比例/);
    hover(65);
    assert.match(tooltip.innerHTML, /持仓本金（不含现金）<\/span><b>30000\.00 USD/);
    assert.match(tooltip.innerHTML, /现金<\/span><b>70000\.00 USD · 70\.00%/);
  }
  click('metric', 'return');
  click('chart-chooser'); await change('indicator', 'score'); await change('indicator', 'gate');
  assert.match(chart(), /data-indicator-axis="score"/); assert.match(chart(), /data-indicator-axis="state"/);
  assert.match(chart(), /data-score-threshold="60"/); assert.match(chart(), /买入门槛 60分/);
  assert.match(chart(), /参考 · 开关样本/);
  assert.match(chart(), /role="dialog" aria-label="选择叠加策略指标"/);
  eventsFor('keydown', {key: 'Escape', target: {closest: () => null}});
  assert.doesNotMatch(chart(), /role="dialog"/); assert.match(chart(), /data-indicator-line="score"/);
  click('chart-chooser'); eventsFor('pointerdown', {target: {closest: () => null}});
  assert.doesNotMatch(chart(), /role="dialog"/);
  click('chart-zoom', '1');
  // Mar 30 and 31 were closed; dates always snap to the first in-range valuation.
  assert.deepEqual(range(), ['2024-04-01', cfg.end]);
  click('metric', 'allocation');
  const html = chart();
  assert.match(html, /实际现金比例/); assert.match(html, /data-indicator-line="score"/);
  assert.ok(html.match(/data-indicator-line="score" d="([^"]*)"/)[1].split('M').length >= 4);
  assert.doesNotMatch(html, /NaN|undefined/);
  click('result-tab', 'periods');
  assert.doesNotMatch(ui.view(h), /data-portfolio-plot/);
  click('result-tab', 'chart');
  assert.deepEqual(range(), ['2024-04-01', cfg.end]);
  assert.match(chart(), /data-indicator-line="score"/);
  click('tab', 'settings'); click('tab', 'results'); assert.deepEqual(range(), ['2024-04-01', cfg.end]);
  await change('to', '2024-04-03');
  hover(65); assert.match(tooltip.innerHTML, /^<strong>2024-04-01/); assert.match(tooltip.innerHTML, /4分/); assert.match(tooltip.innerHTML, /开启/);
  hover(428); assert.match(tooltip.innerHTML, /^<strong>2024-04-02/); assert.match(tooltip.innerHTML, /无当日观测/); assert.doesNotMatch(tooltip.innerHTML, /77分|开启/);
  hover(791); assert.match(tooltip.innerHTML, /^<strong>2024-04-03/); assert.match(tooltip.innerHTML, /77分/);
  hover(791, 'pointerdown'); events.pointerup({type: 'pointerup', pointerId: 1, clientX: 428});
  assert.deepEqual(range(), ['2024-04-02', '2024-04-03']);
  assert.match(chart(), /参考 · 开关样本（此区间无有效观测）/);
  click('chart-zoom', 'all'); assert.deepEqual(range(), [cfg.start, cfg.end]);
  // The navigator never rescales to the zoomed data: its absolute indices stay anchored
  // to the entire history. Widen again, then pan, without rebuilding a captured knob.
  const bound = () => [...chart().matchAll(/data-nav-handle="(?:from|to)"[^>]*aria-valuenow="(\d+)"/g)].map(m => +m[1]);
  const [, last] = bound(), railEvents = {}, dates = {from: {}, to: {}};
  const rail = {isConnected: true, style: {setProperty() {}}, getBoundingClientRect: () => ({left: 10, width: last * 4}),
    parentElement: {querySelector: sel => sel.includes('from') ? dates.from : dates.to, querySelectorAll: () => []}, setPointerCapture() {},
    addEventListener: (key, fn) => {railEvents[key] = fn;}, removeEventListener: key => {delete railEvents[key];}};
  const parts = {};
  for (const key of ['from', 'to', 'pan']) parts[key] = {dataset: key === 'pan' ? {} : {navHandle: key}, focus() {}, setAttribute() {},
    closest: sel => sel === '[data-chart-rail]' ? rail : sel === '[data-nav-handle]' && key !== 'pan' || sel === '[data-nav-pan]' && key === 'pan' ? parts[key] : null};
  rail.querySelector = sel => sel.includes('from') ? parts.from : parts.to;
  const drag = (part, px, motion) => {
    eventsFor('pointerdown', {target: parts[part], pointerId: 1, button: 0, clientX: px, isPrimary: true});
    railEvents.pointermove({pointerId: 1, clientX: px + motion});
    railEvents.pointerup({type: 'pointerup', pointerId: 1, clientX: px + motion});
  };
  drag('from', 5, 40); drag('to', 10 + last * 4 + 5, -40); assert.deepEqual(bound(), [10, last - 10]);
  drag('from', 45, -20); assert.deepEqual(bound(), [5, last - 10]);
  drag('pan', 60, 12); assert.deepEqual(bound(), [8, last - 7]);
  eventsFor('keydown', {key: 'ArrowLeft', target: parts.from}); assert.deepEqual(bound(), [7, last - 7]);
  eventsFor('keydown', {key: 'Home', target: parts.from}); eventsFor('keydown', {key: 'End', target: parts.to});
  assert.deepEqual(range(), [cfg.start, cfg.end]);
  await change('indicator', 'score', false); assert.doesNotMatch(chart(), /data-indicator-axis="score"/); assert.match(chart(), /data-indicator-axis="state"/);
});
