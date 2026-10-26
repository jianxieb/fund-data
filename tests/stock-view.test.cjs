const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/app.js', 'utf8');

test('retained valuation keeps its original date and displays the exact source gap', () => {
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/stock-valuation-outage-20261026.json', 'utf8'));
  const ctx = {esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;')};
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('  function stockValuationNotice('), source.indexOf('  function stockPercentile(')), ctx);
  const row = {...fixture.previous, priceAsOf: fixture.failed.priceAsOf,
    valuationRefreshStatus: 'retained_previous_valuation',
    valuationRefreshError: '估值接口本次未返回有效记录；保留2026-10-23估值及原PE历史窗口'};
  assert.match(ctx.stockValuationDate(row), /2026-10-23.*本次估值未更新/);
  assert.doesNotMatch(ctx.stockValuationDate(row), /2026-10-26/);
  assert.match(ctx.stockValuationNotice(row), /notice warn.*估值接口本次未返回有效记录/);
  assert.equal(ctx.stockValuationNotice(fixture.previous), '');
  assert.equal(ctx.stockValuationDate(fixture.previous), '2026-10-23');
  assert.doesNotMatch(ctx.stockValuationNotice({...row, valuationRefreshError:'<script>'}), /<script>/);
});

test('stock lists render every filtered company, including those beyond the former page boundary', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(source.match(/function stockRows\([^\n]+/)[0] + ';this.rows=stockRows;', ctx);
  const rows = Array.from({length:83}, (_, i) => 'company-' + i);
  assert.equal(ctx.rows(rows, r => '[' + r + ']'), rows.map(r => '[' + r + ']').join(''));
  assert.equal(ctx.rows([], String), '');
});

test('changing stock view retains the visible company below sticky headers even when row heights change', () => {
  const row = (code, top, height) => ({dataset:{stockRow:code}, getBoundingClientRect:() => ({top,bottom:top+height,height})});
  const wrap = (rows, left, top) => ({scrollLeft:left,scrollTop:top,
    getBoundingClientRect:() => ({top:-400}),
    querySelectorAll:selector => selector === 'thead th' ? [{getBoundingClientRect:() => ({bottom:50})}] : rows,
    querySelector:() => ({getBoundingClientRect:() => ({bottom:-400})})});
  const before = wrap([row('A',-250,100), row('B',-150,100), row('C',-50,200), row('D',150,200)], 340, 700);
  const after = wrap([row('A',100,80),row('B',180,80),row('C',260,80),row('D',340,80)], 0, 0);
  let current = before, windowScroll;
  const ctx = {document:{querySelector:() => current},
    window:{scrollX:0,scrollY:275,scrollTo:p => {windowScroll=p;}},
    render:() => {current=after;}};
  vm.createContext(ctx);
  const start=source.indexOf('  function renderStockView()');
  const end=source.indexOf('  function render()',start);
  vm.runInContext(source.slice(start,end)+';renderStockView();',ctx);
  assert.equal(after.scrollLeft,340);
  // C was half scrolled behind the sticky header; preserve that fraction in the shorter view.
  assert.equal(after.scrollTop,260 + 80 * .5 - 50);
  assert.equal(windowScroll.top,275);
});
