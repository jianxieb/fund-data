const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/potential-model.js');
const data = require('../data/potential-stocks.json');
const quotes = require('../data/potential-quotes.json');
const byId = id => data.companies.find(c => c.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('stockholder return divides terminal value by diluted shares, not starting shares', () => {
  const c = byId('AMPX'), bull = M.scenario(c, 'bull'), p = M.project(c, bull);
  near(p.price, 2400 * .2 * 32 / 190);
  near(p.priceMultiple, p.capitalMultiple / (190 / 146.080618));
  const h = M.hurdle(c, bull);
  near(h.price, 77.1);
  near(h.equity, 14649);
  near(h.revenue, 2288.90625);
  near(M.project(c, { ...bull, revenue: h.revenue }).priceMultiple, 10);
  assert.ok(h.capitalMultiple > 13);
});

test('cash dividends stay separate from the price multiple and compound over five years', () => {
  const c = byId('688389'), base = M.scenario(c, 'base'), p = M.project(c, base);
  near(p.totalMultiple - p.priceMultiple, 2.5 / 10.82);
  near(M.returnPercent(10, false), 900);
  near(M.returnPercent(10, true), (10 ** .2 - 1) * 100);
  near(M.returnPercent(0, true), -100);
  assert.equal(M.returnPercent(-1, false), null);
});

test('losses require an explicit residual value and missing inputs never silently become zero', () => {
  const c = byId('AMPX'), bear = M.scenario(c, 'bear');
  near(M.project(c, bear).price, .4);
  assert.throws(() => M.project(c, { ...bear, equityValue: undefined }), RangeError);
  assert.throws(() => M.project(c, { ...bear, shares: 0 }), RangeError);
  assert.throws(() => M.project({ ...c, shares: { value: null } }, bear), RangeError);
  assert.equal(M.hurdle(c, bear), null);
  assert.equal(M.hurdle({ ...c, financials: { anchorRevenue: null } }, M.scenario(c, 'bull')), null);
  assert.equal(byId('688050').shares.knownPotential, null);
  assert.match(byId('688050').shares.gap, /限制|余额|激励/);
});

test('the price start, provenance, unit build and scenario claims reconcile for every candidate', () => {
  const sourceIds = new Set(data.sources.map(s => s.id));
  assert.equal(sourceIds.size, data.sources.length);
  for (const s of data.sources) {
    assert.match(s.url, /^https:\/\//);
    assert.match(s.publishedAt, /^\d{4}-\d\d-\d\d$/);
    assert.ok(s.publishedAt <= data.reviewedAt);
    assert.ok(s.period && s.locator && s.type);
  }
  for (const c of data.companies) {
    const q = quotes.find(q => q.symbol === c.price.symbol), last = q.observations.at(-1);
    near(c.price.value, Math.round(last.close * 100) / 100);
    assert.equal(last.date, c.price.asOf);
    assert.equal(q.currency, c.currency);
    assert.equal(c.price.asOf, data.priceDate);
    assert.equal(c.price.basis, 'regular_close_unadjusted');
    const ids = [c.financials.source, c.shares.source, ...c.facts.flatMap(f => f.sources), ...c.guidance.flatMap(g => g.sources), ...c.fundingSources, ...c.marketTest.sources, ...c.alternatives.flatMap(a => a.sources)];
    ids.forEach(id => assert.ok(sourceIds.has(id), `${c.id}: unknown source ${id}`));
    for (const p of c.marketTest.parts) near(p.units * p.price / 1e6, p.revenue);
    const bull = M.scenario(c, 'bull');
    near(c.marketTest.parts.reduce((sum, p) => sum + p.revenue, 0), bull.revenue);
    assert.ok(M.project(c, M.scenario(c, 'base')).priceMultiple < 10);
    assert.ok(M.project(c, bull).priceMultiple >= 10);
    assert.ok(M.project(c, { ...bull, pe: bull.pe * .75, shares: bull.shares * 1.2 }).priceMultiple < 7);
    assert.ok(c.withdraw.length >= 2 && c.gaps.length >= 2 && c.milestones.length >= 2);
    assert.ok(c.shares.futureBasis && c.shares.convertibles && c.marketTest.gap);
  }
});

test('filtering and the three-step sort cycle return to the research order', () => {
  let state = { market: 'us', status: 'all', sector: 'all', query: '', sort: 'default', descending: true };
  const ids = () => M.select(data.companies, state).map(c => c.id);
  assert.deepEqual(ids(), ['AMPX', 'OUST']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.deepEqual(ids(), ['OUST', 'AMPX']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.deepEqual(ids(), ['AMPX', 'OUST']);
  state = { ...state, ...M.cycleSort(state.sort, state.descending, 'revenue') };
  assert.equal(state.sort, 'default');
  assert.deepEqual(ids(), ['AMPX', 'OUST']);
  state.query = ' ampx ';
  assert.deepEqual(ids(), ['AMPX']);
  state.query = ''; state.status = 'watch';
  assert.deepEqual(ids(), ['OUST']);
  state.market = 'cn';
  assert.deepEqual(ids(), ['688050']);
});

function fixture() {
  const context = { window: { ChanghengPotentialModel: M, POTENTIAL_RESEARCH: structuredClone(data) } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/potential-stocks.js', 'utf8'), context);
  let renders = 0, preserved = 0, modal = '', html = '';
  const api = context.window.ChanghengPotential;
  const H = {
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '—',
    pct: (v, d = 2) => v.toFixed(d) + '%', pc: (v, d = 2) => v.toFixed(d) + '%',
    action: (text, action, cls = '', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`,
    modalTitle: (title, sub) => `<h2>${title}</h2><p>${sub}</p>`,
    openModal: content => { modal = content; },
    render: () => { renders++; html = api.view(H); },
    renderStockView: () => { preserved++; html = api.view(H); },
    annual: true, annualControl: () => '<button data-action="annual">累计收益</button>'
  };
  H.render();
  return { api, H, data: context.window.POTENTIAL_RESEARCH, click: (action, value) => api.handleAction({ dataset: { action, value } }), get html() { return html; }, get modal() { return modal; }, get preserved() { return preserved; }, get renders() { return renders; } };
}

test('switching financial, valuation and return views preserves sort and uses the existing scroll anchor', () => {
  const f = fixture();
  f.click('potential-sort', 'revenue');
  for (const mode of ['valuation', 'returns', 'financials']) {
    f.click('potential-view', mode);
    assert.ok(f.html.indexOf('data-stock-row="OUST"') < f.html.indexOf('data-stock-row="AMPX"'));
    assert.match(f.html, /按营收降序/);
  }
  assert.equal(f.preserved, 3);
  f.click('potential-sort-reset');
  assert.ok(f.html.indexOf('data-stock-row="AMPX"') < f.html.indexOf('data-stock-row="OUST"'));
  f.click('potential-view', 'returns');
  assert.match(f.html, /基准 \/ 年化/);
  f.H.annual = false; f.H.render();
  assert.match(f.html, /基准 \/ 累计/);
  assert.match(f.html, /data-action="annual"/);
});

test('both markets, empty search recovery and every detail tab expose complete evidence', () => {
  const f = fixture();
  for (const market of ['us', 'cn']) {
    f.click('potential-market', market);
    for (const c of data.companies.filter(c => c.market === market)) {
      assert.ok(f.html.includes(c.name));
      f.click('potential-detail', c.id);
      assert.match(f.modal, /已验证事实/);
      assert.match(f.modal, /管理层指引/);
      f.click('potential-detail-tab', 'scenarios');
      assert.match(f.modal, /期末股数/);
      assert.match(f.modal, /终值PE降低25%/);
      assert.match(f.modal, /缺项/);
      f.click('potential-detail-tab', 'evidence');
      assert.match(f.modal, /撤回或下修信号/);
      assert.match(f.modal, /原始来源与定位/);
      assert.ok(f.modal.includes(c.price.url.replace(/&/g, '&amp;')));
    }
  }
  f.api.handleInput({ value: 'no matching company' }); f.H.render();
  assert.match(f.html, /当前条件没有匹配公司/);
  f.click('potential-reset');
  assert.match(f.html, /普门科技/);
  f.click('potential-method');
  assert.match(f.modal, /10倍终值相当于累计\+900%/);
  assert.match(f.modal, /报价记录 JSON/);
});

test('company content is escaped and non-HTTPS source links are not executable', () => {
  const f = fixture();
  f.data.companies[0].name = '<img src=x onerror=alert(1)>';
  f.data.companies[0].tagline = 'a & b';
  f.data.sources[0].url = 'javascript:alert(1)';
  f.H.render();
  assert.match(f.html, /&lt;img/);
  assert.match(f.html, /a &amp; b/);
  assert.doesNotMatch(f.html, /<img/);
  f.click('potential-detail', 'AMPX');
  assert.doesNotMatch(f.modal, /href="javascript:/);
});
