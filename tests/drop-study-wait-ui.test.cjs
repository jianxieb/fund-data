const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/model.js');
const D = require('../assets/drop-study-model.js');
const W = require('../assets/drop-window-model.js');

function fixture({hash = '#drop-study', length = 300} = {}) {
  const day = new Date('2020-01-02T00:00:00Z');
  const series = Array.from({length}, (_, i) => {
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const row = [day.toISOString().slice(0, 10), i === 0 ? 100 : i === 1 ? 90 : 98];
    day.setUTCDate(day.getUTCDate() + 1);
    return row;
  });
  const assets = ['NDX', 'GSPC'].map(code => ({id:'index:^' + code, code:'^' + code,
    kind:'index', currency:'USD', basis:'price_index', historyUrl:'data/return-comparison/' + code + '.json'}));
  const high = {schemaVersion:1, id:'index:^NDX', currency:'USD', basis:'price_index_high', dividends:'excluded',
    field:'indicators.quote[0].high', closedSessionsOnly:true, dateConvention:'exchange_local_date',
    first:series[0][0], asOf:series.at(-1)[0], closes:series.map(row => row.slice()),
    series:series.map(([date, close], i) => [date, i === 9 ? 101 : close])};
  const entry = {...assets[0], status:'available', basis:'price_index_high', first:high.first, asOf:high.asOf,
    historyUrl:'data/drop-study/NDX-' + 'a'.repeat(16) + '.json'};
  const listeners = {}, downloads = [], modals = [], menus = new Map(), location = {hash};
  let closed = 0;
  const context = {window:{Changheng:M, ChanghengDropStudyModel:D, ChanghengDropWindowModel:W,
    ChanghengResearchHistory:{indexCatalog:async () => assets, history:async () => ({dividends:'excluded', series})}},
    document:{addEventListener:(type, listener) => {listeners[type] = listener;},
      querySelector:selector => selector.startsWith('#ds-wait-form') ? {focus(){}, select(){}} : null},
    location, URLSearchParams, history:{replaceState:(_, __, value) => {location.hash = value;}},
    fetch:async () => ({ok:true, json:async () => ({schemaVersion:1, assets:[entry]}), text:async () => JSON.stringify(high)})};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/drop-study.js'), 'utf8'), context);
  const ui = context.window.ChanghengDropStudy;
  const H = {head:(_, title, description) => '<h1>' + title + '</h1><p>' + description + '</p>',
    menu:(id, label, choices, value) => {
      menus.set(id, {choices, value});
      return '<div id="' + id + '">' + label + '：' + choices.find(([key]) => String(key) === String(value))?.[1] + '</div>';
    }, render:() => ui.view(H), openModal:html => modals.push(html),
    modalTitle:(title, subtitle = '') => '<h2>' + title + '</h2><p>' + subtitle + '</p>',
    download:(...args) => downloads.push(args)};
  const click = dataset => listeners.click({target:{closest:() => ({dataset})}});
  const submitWait = value => listeners.submit({preventDefault(){}, target:{id:'ds-wait-form',
    elements:{wait:{valueAsNumber:value}}, closest:() => ({close(){closed++;}})}});
  const settle = async () => {for (let i = 0; i < 6; i++) await new Promise(setImmediate); return ui.view(H);};
  ui.view(H);
  return {ui, H, series, high, menus, location, downloads, modals, click, submitWait, settle, closed:() => closed};
}

function csvRows(text) {
  return text.trim().replace(/^\uFEFF/, '').split(/\r?\n/).map(line =>
    Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), match => match[1].replace(/""/g, '"')));
}

test('long presets and arbitrary integer waits survive selection, URLs and a fresh view', async () => {
  const f = fixture();
  await f.settle();
  const choices = f.menus.get('ds-wait').choices;
  for (const wait of [2, 3, 4, 5, 10, 21, 42, 63, 126, 252]) assert.ok(choices.some(([key]) => Number(key) === wait));
  assert.ok(choices.some(([key, label]) => key === 'custom' && label === '自定义观察期…'));
  f.ui.choose('wait', '21');
  assert.match(await f.settle(), /从第 21 个交易日收盘起算/);
  f.ui.choose('wait', '17');
  const html = await f.settle();
  assert.match(f.location.hash, /wait=17/);
  assert.match(html, /17 个交易日/);
  assert.match(html, /第 17 天收盘/);
  assert.match(html, /从第 17 个交易日收盘起算/);
  assert.ok(f.menus.get('ds-wait').choices.some(([key]) => Number(key) === 17), 'the custom value remains named in its control');
  const restored = fixture({hash:f.location.hash});
  assert.match(await restored.settle(), /从第 17 个交易日收盘起算/);
  for (const value of ['1', '253', '2.5', 'NaN']) {
    const invalid = fixture({hash:'#drop-study?wait=' + value});
    assert.match(await invalid.settle(), /从第 2 个交易日收盘起算/);
  }
});

test('custom wait dialog applies only a valid integer and preserves the other filters', async () => {
  const f = fixture({hash:'#drop-study?threshold=6&era=exclude_dotcom'});
  await f.settle();
  f.ui.choose('wait', 'custom');
  const modal = f.modals.at(-1);
  assert.match(modal, /id="ds-wait-form"/);
  assert.match(modal, /name="wait"[^>]*min="2"[^>]*max="252"[^>]*step="1"/);
  const before = f.location.hash;
  for (const value of [1, 253, 2.5, NaN]) {
    f.submitWait(value);
    assert.equal(f.location.hash, before);
    assert.equal(f.closed(), 0);
  }
  f.submitWait(17);
  const html = await f.settle();
  assert.equal(f.closed(), 1);
  assert.match(f.location.hash, /wait=17/);
  assert.match(f.location.hash, /threshold=6/);
  assert.match(f.location.hash, /era=exclude_dotcom/);
  assert.match(html, /从第 17 个交易日收盘起算/);
});

test('condensed long observations preserve every date and price in details and CSV for both recovery bases', async () => {
  for (const recovery of ['close', 'high']) {
    const f = fixture({hash:'#drop-study?wait=17&group=all&recovery=' + recovery});
    const html = await f.settle();
    assert.match(html, /逐日观察记录 · 17 \/ 17 个交易日/);
    for (const [date] of f.series.slice(2, 19)) assert.ok(html.includes('<time>' + date + '</time>'), date + ' remains available');
    const condensed = html.replace(/<details class="ds-observation-details">[\s\S]*?<\/details>/g, '');
    assert.ok((condensed.match(/<time>/g) || []).length <= 5, 'the long window does not create dozens of visible cards');
    f.click({dsEvent:f.series[1][0]});
    const modal = f.modals.at(-1);
    assert.match(modal, /逐日观察记录 · 17 \/ 17 个交易日/);
    assert.ok(modal.includes('从 ' + f.series[18][0] + ' 收盘 98.00 点起算'));
    if (recovery === 'high') assert.ok(modal.includes(f.series[9][0]), 'the late intraday recovery remains visible');
    f.click({dsAction:'export'});
    const rows = csvRows(f.downloads.at(-1)[1]);
    assert.equal(rows.length, 2);
    const [header, row] = rows;
    assert.equal(row.length, header.length);
    assert.equal(row[header.indexOf('观察天数')], '17');
    assert.equal(row[header.indexOf('后续起算日')], f.series[18][0]);
    for (let i = 1; i <= 17; i++) {
      assert.equal(row[header.indexOf('观察日' + i)], f.series[i + 1][0]);
      assert.equal(row[header.indexOf('收盘点位' + i)], String(f.series[i + 1][1]));
      if (recovery === 'high') assert.equal(row[header.indexOf('盘中最高点位' + i)], String(f.high.series[i + 1][1]));
    }
    assert.equal(row[header.indexOf('5日实际终日')], f.series[23][0]);
  }
});

test('a 252-session observation preserves all records and independently censors forward maturities', async () => {
  const f = fixture({hash:'#drop-study?wait=252'});
  const html = await f.settle();
  assert.match(html, /逐日观察记录 · 252 \/ 252 个交易日/);
  assert.match(html, /从第 252 个交易日收盘起算/);
  f.click({dsAction:'export'});
  const [header, row] = csvRows(f.downloads.at(-1)[1]);
  assert.equal(row.length, header.length);
  assert.equal(row[header.indexOf('观察日252')], f.series[253][0]);
  assert.equal(row[header.indexOf('5日状态')], '已到期');
  assert.equal(row[header.indexOf('21日状态')], '已到期');
  assert.equal(row[header.indexOf('63日状态')], '未到期');
  assert.equal(row[header.indexOf('252日状态')], '未到期');
  assert.equal(row[header.indexOf('252日累计涨跌%')], '');
});

test('an unfinished long observation remains pending with no invented event or future anchor', async () => {
  const f = fixture({hash:'#drop-study?wait=252', length:20});
  const html = await f.settle();
  assert.match(html, /已取得 18 \/ 252 个跌后收盘，尚未纳入统计/);
  assert.match(html, /逐日观察记录 · 18 \/ 252 个交易日/);
  assert.match(html, /1 次观察中/);
  assert.match(html, /没有符合当前条件的事件/);
  assert.match(html, /data-ds-action="export" disabled/);
  assert.doesNotMatch(html, /data-ds-event=/);
});
