const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../data/international-cards.js');
const M = require('../assets/international-cards-model.js');
const ids = rows => rows.map(r=>r.id);

test('published research has distinct products, complete fee states and attributable evidence',()=>{
  assert.equal(M.validate(D),true);
  assert.ok(D.rows.length >= 40);
  assert.equal(new Set(D.rows.map(r=>r.rank)).size,D.rows.length);
  assert.deepEqual(ids(M.select(D.rows,{status:'priority'})),['hsbc-one','firstrade','schwab','velo','hsbc-us','fv-bank']);
  assert.ok(D.rows.every(r=>r.capital.status !== 'none' || r.capital.amount === 0));
});

test('unknown, conditional, temporary and conflicting fees cannot pass a free-fee filter',()=>{
  for(const key of M.feeFields){
    const rows = M.select(D.rows,{[key]:'free'});
    assert.ok(rows.every(r=>['free','included'].includes(r.fees[key].status)));
  }
  assert.ok(!ids(M.select(D.rows,{monthly:'free'})).includes('fv-bank'));
  assert.ok(!ids(M.select(D.rows,{monthly:'free'})).includes('hsbc-us'));
  assert.ok(!ids(M.select(D.rows,{opening:'free'})).includes('freedom'));
  assert.deepEqual(ids(M.select(D.rows,{monthly:'temporary'})),['fv-bank']);
  assert.deepEqual(ids(M.select(D.rows,{opening:'conflict'})),['freedom']);
});

test('combined classification selects the actual eligible subset instead of OR-ing filters',()=>{
  assert.deepEqual(ids(M.select(D.rows,{status:'priority',region:'美国',type:'broker',annual:'free'})),['firstrade']);
  assert.deepEqual(ids(M.select(D.rows,{status:'priority',region:'美国',format:'virtual'})),[]);
  assert.deepEqual(ids(M.select(D.rows,{query:'Wise 数字',format:'virtual',status:'conditional'})),['wise-digital']);
  assert.deepEqual(ids(M.select(D.rows,{query:'  fIrStRaDe  ',mode:'remote'})),['firstrade']);
  assert.deepEqual(ids(M.select(D.rows,{cardType:'secured-credit'})),['velo-secured']);
});

test('physical activation requirements are not erased by digital eligibility or a US statement',()=>{
  const physical = D.rows.find(r=>r.id === 'wise-physical');
  const digital = D.rows.find(r=>r.id === 'wise-digital');
  assert.equal(physical.status,'ineligible');
  assert.equal(physical.mode,'onsite');
  assert.equal(digital.status,'conditional');
  assert.match(digital.condition,/居留/);
  assert.equal(D.rows.find(r=>r.id === 'ibkr-karta').status,'ineligible');
  assert.match(D.rows.find(r=>r.id === 'ibkr-karta').condition,/国籍/);
});

test('capital is not charged as a fee; known current thresholds remain explicit',()=>{
  const first = D.rows.find(r=>r.id === 'firstrade'), velo = D.rows.find(r=>r.id === 'velo');
  assert.equal(first.capital.amount,25000);
  assert.equal(first.fees.annual.amount,0);
  assert.equal(velo.capital.amount,25000);
  assert.equal(velo.fees.opening.amount,300);
  assert.equal(D.rows.find(r=>r.id === 'schwab').capital.amount,0);
  assert.match(D.rows.find(r=>r.id === 'hsbc-us').notes.join(' '),/连续收取3次月费/);
});

test('fee sorting respects states without pretending different currencies are directly comparable',()=>{
  const source = D.rows.slice(), original = ids(source);
  const ranked = M.select(source,{sort:'annual'});
  const lastFree = ranked.findLastIndex(r=>['free','included'].includes(r.fees.annual.status));
  const firstUnknown = ranked.findIndex(r=>r.fees.annual.status === 'unknown');
  assert.ok(lastFree < firstUnknown);
  assert.deepEqual(ids(source),original);
  const demo = [{...source[0],rank:1,fees:{...source[0].fees,annual:{status:'paid',amount:1000,currency:'JPY'}}},{...source[1],rank:2,fees:{...source[1].fees,annual:{status:'paid',amount:10,currency:'USD'}}}];
  assert.deepEqual(M.select(demo,{sort:'annual'}).map(r=>r.rank),[1,2]);
});

test('status counts honor other filters and remain useful after changing a status',()=>{
  const counts = M.statusCounts(D.rows,{query:'Wise',status:'priority'});
  assert.equal(counts.all,2);
  assert.equal(counts.priority,0);
  assert.equal(counts.conditional,1);
  assert.equal(counts.ineligible,1);
  assert.equal(Object.values(counts).slice(1).reduce((a,b)=>a+b,0),counts.all);
});

test('exports retain filtered rows, currency, waiver notes and primary links',()=>{
  const csv = M.csv(M.select(D.rows,{query:'FV Bank'}),D);
  assert.equal(csv.split('\r\n').length,2);
  assert.match(csv,/100 USD/);
  assert.match(csv,/目前暂免/);
  assert.match(csv,/未承诺永久免费/);
  assert.match(csv,/https:\/\/fvbank.us\/debit-card-fees/);
  assert.doesNotMatch(csv,/Firstrade/);
});
