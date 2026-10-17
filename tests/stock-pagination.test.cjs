const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function pagination() {
  const source = fs.readFileSync('assets/app.js', 'utf8');
  const start = source.indexOf('  const stockPages = ');
  const end = source.indexOf('  let loadObservers', start);
  const ctx = { action:(label, act, cls, attrs) => `<button ${attrs}>${label}</button>` };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.paging={stockPages,stockPageRows,stockPageFooter};', ctx);
  return ctx.paging;
}

test('stock pagination visits every company once without automatic appended rows', () => {
  const p = pagination(), rows = Array.from({length:43}, (_, i) => i);
  const seen = [];
  for (const page of [1, 2, 3]) {
    p.stockPages.set('stocks', page);
    p.stockPageRows('stocks', rows, row => { seen.push(row); return String(row); });
    assert.doesNotMatch(p.stockPageFooter('stocks'), /data-load-more/);
  }
  assert.deepEqual(seen, rows);
  assert.match(p.stockPageFooter('stocks'), /第 41–43 家，共 43 家/);
  assert.match(p.stockPageFooter('stocks'), /disabled>下一页/);
});

test('market page state is separate and shrinking filters never leave an empty page', () => {
  const p = pagination();
  p.stockPages.set('overseas-stocks', 2);
  p.stockPageRows('overseas-stocks', Array.from({length:24}, (_, i) => i), String);
  p.stockPageRows('stocks', [1,2,3,4,5,6], String);
  assert.match(p.stockPageFooter('overseas-stocks'), /第 21–24 家/);
  assert.match(p.stockPageFooter('stocks'), /第 1–6 家/);
  p.stockPageRows('overseas-stocks', [7], String);
  assert.match(p.stockPageFooter('overseas-stocks'), /第 1–1 家/);
  p.stockPageRows('stocks', [], String);
  assert.equal(p.stockPageFooter('stocks'), '');
});
