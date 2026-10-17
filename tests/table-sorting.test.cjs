const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/model.js');

test('every sortable app table returns to its original order on the third click', () => {
  const source = fs.readFileSync('assets/app.js', 'utf8');
  for (const [action, sortField, directionField, key, firstDescending] of [
    ['index-sort','indexSort','indexDescending','return:5',true],
    ['fund-sort','fundSort','descending','a5',true],
    ['stock-sort','stockSort','stockDesc','latestRoe',true],
    ['cross-sort','crossSort','crossDesc','return:5',true],
    ['cross-sort','crossSort','crossDesc','knownOngoingFee',false],
    ['cross-sort','crossSort','crossDesc','prem',false],
  ]) {
    const start = source.indexOf("case '" + action + "':");
    const end = source.indexOf('\n      case ', start + 1);
    assert.ok(start >= 0 && end > start);
    const run = new vm.Script('(function(){switch(action){' + source.slice(start, end) + '}})()');
    const state = {[sortField]:'default',[directionField]:true};
    const ctx = vm.createContext({M,state,action,val:key,renderFundResults:()=>{}});
    run.runInContext(ctx);
    assert.equal(state[sortField],key,action);
    assert.equal(state[directionField],firstDescending,action);
    run.runInContext(ctx);
    assert.equal(state[sortField],key,action);
    assert.equal(state[directionField],!firstDescending,action);
    run.runInContext(ctx);
    assert.equal(state[sortField],'default',action);
  }
});

test('changing a column starts with that column direction and never keeps a stale reverse order', () => {
  assert.deepEqual(M.cycleSort('fee',false,'return:5'),{sort:'return:5',descending:true});
  assert.deepEqual(M.cycleSort('return:5',true,'fee',false),{sort:'fee',descending:false});
});
