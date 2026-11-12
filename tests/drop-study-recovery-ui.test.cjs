const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/model.js');
const D = require('../assets/drop-study-model.js');
const W = require('../assets/drop-window-model.js');

function fixture({ start = '2020-01-02', unavailable = false, mismatch = false, refreshMissing = '', hash = '#drop-study' } = {}) {
  const day = new Date(start + 'T00:00:00Z');
  const series = [100,90,99,98,...Array(260).fill(98)].map(close => {
    while ([0,6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const row = [day.toISOString().slice(0,10), close]; day.setUTCDate(day.getUTCDate() + 1); return row;
  });
  const assets = ['NDX','GSPC'].map(code => ({ id:'index:^'+code, code:'^'+code, name:code, kind:'index',
    status:'available', currency:'USD', basis:'price_index', historyUrl:'data/return-comparison/'+code+'.json', sha256:'a'.repeat(64) }));
  const high = { schemaVersion:1, id:'index:^NDX', currency:'USD', basis:'price_index_high', dividends:'excluded',
    field:'indicators.quote[0].high', closedSessionsOnly:true, dateConvention:'exchange_local_date',
    first:series[0][0], asOf:series.at(-1)[0], series:series.map(([d,c],i) => [d,i===2?101:c]),
    closes:series.map(row => row.slice()), sourceUrl:'https://finance.yahoo.com/quote/%5ENDX/history/',
    closeValidation:{historyUrl:assets[0].historyUrl,sha256:assets[0].sha256,tolerance:.005} };
  if (mismatch) high.closes[2][1] = 80;
  const entry = { ...assets[0], basis:'price_index_high', first:high.first, asOf:high.asOf,
    historyUrl:'data/drop-study/NDX-'+'a'.repeat(16)+'.json',
    status:unavailable?'unavailable':'available', missing:unavailable?'NDX 缺官方最高价历史':undefined, refreshMissing };
  const listeners = {}, downloads = [], renders = [], fetches = [], location = {hash};
  const context = {window:{Changheng:M,ChanghengDropStudyModel:D,ChanghengDropWindowModel:W,
    ChanghengResearchHistory:{indexCatalog:async()=>assets,history:async()=>({dividends:'excluded',series})}},
    document:{addEventListener:(name,fn)=>{listeners[name]=fn;},querySelector:()=>null},
    location, history:{replaceState:(_,__,value)=>{location.hash=value;}}, URLSearchParams,
    fetch:async url=>{fetches.push(url);return {ok:true,json:async()=>({schemaVersion:1,assets:[entry]}),text:async()=>JSON.stringify(high)};}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/drop-study.js'),'utf8'),context);
  const ui = context.window.ChanghengDropStudy;
  const H = {head:(_,title,description)=>'<h1>'+title+'</h1><p>'+description+'</p>',
    menu:(id,label,choices,value)=>'<div id="'+id+'"><label>'+label+'</label><b>'+choices.find(([key])=>String(key)===String(value))?.[1]+'</b></div>',
    render:()=>renders.push(ui.view(H)),download:(...args)=>downloads.push(args)};
  const action = name=>listeners.click({target:{closest:()=>({dataset:{dsAction:name}})}});
  const settle = async()=>{for(let i=0;i<8;i++) await new Promise(setImmediate);return ui.view(H);};
  ui.view(H);
  return {ui,H,series,high,location,fetches,downloads,renders,action,settle};
}

test('recovery criterion persists in the URL and a high-only touch has visible evidence and CSV provenance', async () => {
  const f = fixture({refreshMissing:'Yahoo 请求失败（503）'});
  let html = await f.settle();
  assert.match(html,/收盘确认/); assert.match(html,/包含全部历史/);
  assert.equal(f.fetches.length,0,'close confirmation needs no high data fetch');
  assert.match(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
  f.ui.choose('recovery','high');
  html = await f.settle();
  assert.match(f.location.hash,/recovery=high/);
  assert.match(html,/盘中触及/);
  assert.match(html,/最高价更新失败：Yahoo 请求失败（503）；沿用截至/);
  assert.match(html,/最高 101\.00/);
  assert.match(html,new RegExp(f.series[2][0] + ' 盘中触及跌前收盘'));
  assert.doesNotMatch(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
  f.ui.choose('group','recovered'); html = await f.settle();
  assert.match(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
  assert.match(html,/盘中曾触及，期末回落/);
  assert.doesNotMatch(html,/盘中触及不计/);
  f.action('export');
  const csv = f.downloads.at(-1)[1];
  assert.match(csv,/"收复判定","历史事件范围"/);
  assert.match(csv,/"盘中触及","包含全部历史"/);
  assert.match(csv,/"盘中最高点位1"/);
  assert.ok(csv.includes('"'+f.series[2][0]+'","99","101"'));
  f.ui.choose('recovery','close'); f.ui.choose('group','unrecovered'); html=await f.settle();
  assert.doesNotMatch(f.location.hash,/recovery=/);
  assert.match(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
});

test('a missing or mismatched high does not become an unrecovered event, and close mode remains usable', async () => {
  for (const mode of [{unavailable:true},{mismatch:true}]) {
    const f = fixture({...mode,hash:'#drop-study?recovery=high'});
    let html = await f.settle();
    assert.match(html,/缺.*最高价/);
    assert.doesNotMatch(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
    if (mode.unavailable) assert.match(html,/重试最高价/);
    if (mode.mismatch) assert.match(html,new RegExp(f.series[2][0]));
    f.ui.choose('recovery','close'); html=await f.settle();
    assert.match(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
    assert.doesNotMatch(html,/重试最高价/);
  }
});

test('dotcom exclusion is optional, preserves query choices, and leaves the original history available', async () => {
  const f = fixture({start:'2000-01-03'});
  let html = await f.settle();
  assert.match(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
  f.ui.choose('era','exclude_dotcom'); html = await f.settle();
  assert.match(f.location.hash,/era=exclude_dotcom/);
  assert.match(html,/已排除 1 次 2000—2002 年发生的事件/);
  assert.doesNotMatch(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
  f.ui.choose('recovery','high'); html=await f.settle();
  assert.match(f.location.hash,/era=exclude_dotcom/);
  assert.match(f.location.hash,/recovery=high/);
  f.ui.choose('era','all'); f.ui.choose('group','recovered'); html=await f.settle();
  assert.doesNotMatch(f.location.hash,/era=/);
  assert.match(html,new RegExp('data-ds-event="' + f.series[1][0] + '"'));
  f.action('export'); assert.match(f.downloads.at(-1)[1],/"包含全部历史"/);
});
