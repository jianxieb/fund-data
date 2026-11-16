const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../assets/portfolio-model.js');
const M = require('../assets/model.js');

const KEY = 'changheng.portfolio.scenarios.v1';
function moduleWith(localStorage) {
  const context = { window: { Changheng: M, ChanghengPortfolioModel: P, ChanghengPortfolioComparison: { plot: () => '<svg></svg>', colorFor: () => '#000' } }, localStorage };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../assets/portfolio-scenarios.js'), 'utf8'), context);
  return context.window.ChanghengPortfolioScenarios;
}
function memory(initial) {
  const data = new Map(initial === undefined ? [] : [[KEY, initial]]);
  return { data, getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value) };
}
const config = (extra = {}) => ({ positions: [{ id: 'us:AAA', weight: 30 }, { id: 'us:BBB', weight: 30 }, { id: 'us:ZERO', weight: 0 }], currency: 'CNY',
  initial: 100000, monthly: 0, initialMethod: 'lump_sum', contributionMethod: 'dca_month', rebalance: 'none', transactionFee: 0, years: 10, start: '', end: '', ...extra });
const entry = (id, name, extra) => ({ id, name, config: config(extra) });
// The module runs in its own context, so its arrays are compared by content.
const plain = value => JSON.parse(JSON.stringify(value));

test('scenarios round-trip through storage and bad stored data is dropped, never trusted', () => {
  const storage = memory(), S = moduleWith(storage), list = [entry('a', '方案A'), entry('b', '方案B', { rebalance: 'year' })];
  assert.deepEqual(plain(S.load()), []);
  assert.equal(S.store(list), true);
  assert.deepEqual(plain(moduleWith(storage).load()), plain(list));
  const mixed = JSON.stringify([entry('a', '方案A'), null, 'x', { id: 1, name: 'n', config: config() }, { id: 'c', name: '缺持仓', config: {} }, { id: 'd', config: config() }]);
  assert.deepEqual(plain(moduleWith(memory(mixed)).load().map(s => s.id)), ['a']);
  assert.deepEqual(plain(moduleWith(memory(JSON.stringify(config()))).load()), [], 'another feature’s object under the key is not a list');
  assert.deepEqual(plain(moduleWith(memory('{not json')).load()), []);
  assert.deepEqual(plain(moduleWith({ getItem() { throw new Error('blocked'); }, setItem() {} }).load()), []);
  assert.equal(moduleWith({ getItem: () => null, setItem() { throw new Error('full'); } }).store(list), false);
  const many = Array.from({ length: 12 }, (_, i) => entry('s' + i, '方案' + i));
  assert.equal(moduleWith(memory(JSON.stringify(many))).load().length, S.LIMIT);
  assert.equal(S.LIMIT, 8);
});

test('names are offered in order and refused when empty, long, duplicate or past the limit', () => {
  const S = moduleWith(memory());
  assert.equal(S.nextName([]), '方案A');
  assert.equal(S.nextName([entry('a', '方案A'), entry('c', '方案C')]), '方案B');
  assert.equal(S.nextName('ABCDEFGH'.split('').map(c => entry(c, '方案' + c))), '');
  const list = [entry('a', '方案A')];
  assert.equal(S.nameError(list, '  低仓位  '), '');
  assert.match(S.nameError(list, '   '), /请填写方案名称/);
  assert.match(S.nameError(list, '一二三四五六七八九十一二三四五六七八九十一'), /不超过 20 个字/);
  assert.equal(S.nameError(list, '一二三四五六七八九十一二三四五六七八九十'), '');
  assert.match(S.nameError(list, ' 方案A '), /已有同名方案/);
  assert.match(S.nameError(Array.from({ length: 8 }, (_, i) => entry('s' + i, '方案' + i)), '新方案'), /最多保存 8 个方案/);
});

test('a summary names holdings, cash, the methods in use and the rebalancing rule', () => {
  const S = moduleWith(memory()), assets = [{ id: 'us:AAA', code: 'AAA' }, { id: 'us:BBB', code: 'BBB' }];
  assert.deepEqual({ ...S.summary(config(), assets) }, { holdings: 'AAA 30% · BBB 30% · 现金 40%', rules: '一次性投入 · 不再平衡' });
  const busy = S.summary(config({ positions: [{ id: 'us:AAA', weight: 62.5 }, { id: 'us:GONE', weight: 37.5 }], monthly: 2000, contributionMethod: 'dca_quarter',
    initialMethod: 'tranche_12', rebalance: 'band', rebalanceBand: 5 }), assets);
  assert.equal(busy.holdings, 'AAA 62.5% · us:GONE 37.5%');
  assert.equal(busy.rules, '12个月分批投入 · 每季度定投 · 偏离5个百分点再平衡');
  assert.equal(S.summary(config({ rebalance: 'quarter' }), assets).rules, '一次性投入 · 每季再平衡');
  assert.match(S.summary(config({ initialMethod: 'entry_composite' }), assets).rules, /投入方式已失效/);
  assert.equal(S.windowLabel({ years: 10 }), '近10年');
  assert.equal(S.windowLabel({ years: 'common' }), '共同历史');
  assert.equal(S.windowLabel({ years: 'custom', start: '2020-01-02', end: '2024-01-02' }), '2020-01-02 至 2024-01-02');
});

test('the comparison CSV has one line per scenario and keeps the reason for one that could not run', () => {
  const S = moduleWith(memory());
  const result = { start: '2020-01-02', end: '2024-01-02', contributed: 1000, annualReturn: 5, totalReturn: 21, profit: 210, mdd: -10, volatility: 12,
    tradeCost: 1.5, taxCost: 3, value: 1210, cash: 400, xirr: 5.1, xirrMissing: null, config: config() };
  const csv = S.csv({ config: { years: 10, start: '', end: '', currency: 'USD' }, start: '2020-01-02', end: '2024-01-02',
    scenarios: [{ id: 'a', label: '方案A', result }, { id: 'b', label: '缺历史', error: 'AAA：缺每日历史' }] });
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('"方案","模拟状态","缺项","实际开始日","实际结束日","计价币种","总投入本金USD"'));
  assert.ok(lines[1].startsWith('"方案A","已完成","","2020-01-02","2024-01-02","USD","1000","5","21","210","-10","12","0.5","1.5","3","1210","400"'));
  assert.ok(lines[2].startsWith('"缺历史","未完成","AAA：缺每日历史"'));
});
