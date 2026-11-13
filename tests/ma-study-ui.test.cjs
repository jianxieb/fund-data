const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/model.js');
const D = require('../assets/ma-study-model.js');

function prices(length=700) {
  const day=new Date('2018-01-02T00:00:00Z');
  return Array.from({length},(_,i)=>{
    while([0,6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate()+1);
    const row=[day.toISOString().slice(0,10),100+18*Math.sin(i/7)];
    day.setUTCDate(day.getUTCDate()+1);return row;
  });
}
function fixture({hash='#ma-study',series=prices(),badIdentity=false,fail=false}={}) {
  const assets=['NDX','GSPC'].map(code=>({id:'index:^'+code,code:'^'+code,kind:'index',currency:'USD',basis:'price_index'}));
  if(badIdentity) assets[0].basis='etf_price';
  const location={hash},listeners={},downloads=[],modals=[],renders=[];
  const state={fail};
  const context={window:{Changheng:M,ChanghengMAStudyModel:D,ChanghengResearchHistory:{
    indexCatalog:async()=>assets,history:async()=>{if(state.fail) throw new Error('缺少日线 <503>');return {dividends:'excluded',series};}}},
    document:{addEventListener:(type,listener)=>{listeners[type]=listener;}},location,URLSearchParams,
    history:{replaceState:(_,__,hash)=>{location.hash=hash;}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../assets/ma-study.js'),'utf8'),context);
  const ui=context.window.ChanghengMAStudy;
  const H={head:(_,title,desc)=>'<h1>'+title+'</h1><p>'+desc+'</p>',
    menu:(id,label,choices,value)=>'<div id="'+id+'">'+label+'：'+choices.find(x=>x[0]===value)?.[1]+'</div>',
    render:()=>renders.push(ui.view(H)),openModal:html=>modals.push(html),modalTitle:(title,subtitle)=>'<h2>'+title+'</h2><p>'+subtitle+'</p>',
    download:(...args)=>downloads.push(args)};
  function click(kind,value) {
    listeners.click({target:{closest:selector=>selector==='[data-ma-'+kind+']'?{dataset:{[kind==='event'?'maEvent':'maAction']:value}}:null}});
  }
  async function settle() {for(let i=0;i<5;i++) await new Promise(setImmediate);return ui.view(H);}
  ui.view(H);
  return {ui,H,series,location,listeners,downloads,modals,renders,state,click,settle};
}

test('MA study presents all horizons and risk measures, and an event opens an actual path',async()=>{
  const f=fixture(),html=await f.settle();
  assert.match(html,/200 日均线（200MA）/);
  assert.match(html,/穿越之后，指数涨跌多少/);
  assert.match(html,/期间最大收盘回撤/);
  assert.match(html,/相对起点最大跌幅/);
  for(const label of ['1周','1个月','3个月','1年']) assert.ok(html.includes(label));
  assert.match(html,/未到期/);
  assert.doesNotMatch(html,/<select\b|id="ma-repeat-form"/);
  const event=D.study(f.series).latestMatching;
  f.click('event',event.date);
  const modal=f.modals.at(-1);
  assert.match(modal,/<svg[^>]+role="img"/);
  assert.ok(modal.includes(event.date));
  assert.match(modal,/实际期末日/);
  assert.match(modal,/已观察 \d+ \/ 252 个交易日/);
});

test('custom window and N persist, invalid input stays unapplied, and filters can yield an honest empty state',async()=>{
  const f=fixture();await f.settle();
  f.ui.choose('period','250');f.ui.choose('direction','both');f.ui.choose('repeat','min');
  let html=await f.settle();
  assert.match(f.location.hash,/period=250/);assert.match(f.location.hash,/direction=both/);
  assert.match(f.location.hash,/minCrossings=2/);assert.match(html,/id="ma-repeat-form"/);
  const fields={window:{value:'20',error:'',setCustomValidity(value){this.error=value;}},minCrossings:{value:'30',error:'',setCustomValidity(value){this.error=value;}}};
  const form={id:'ma-repeat-form',elements:{namedItem:key=>fields[key]},reportValidity:()=>!fields.window.error&&!fields.minCrossings.error};
  let prevented=false;
  f.listeners.submit({target:form,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.match(fields.minCrossings.error,/穿越次数/);
  assert.doesNotMatch(f.location.hash,/window=20/);
  f.listeners.input({target:{closest:()=>form}});
  assert.equal(fields.minCrossings.error,'','editing the window must clear an earlier dependent count error');
  fields.minCrossings.value='20';f.listeners.submit({target:form,preventDefault(){}});
  html=await f.settle();
  assert.match(f.location.hash,/window=20/);assert.match(f.location.hash,/minCrossings=20/);
  assert.match(html,/没有匹配事件/);assert.match(html,/data-ma-action="csv" disabled/);
  f.click('action','clear-repeat');html=await f.settle();
  assert.doesNotMatch(f.location.hash,/minCrossings=/);assert.match(f.location.hash,/period=250/);
  assert.doesNotMatch(html,/没有匹配事件/);
});

test('CSV exports every event and every horizon, including those beyond the current page',async()=>{
  const f=fixture({hash:'#ma-study?direction=both'});await f.settle();
  const expected=D.study(f.series,{direction:'both'});
  assert.ok(expected.events.length>20);
  f.click('action','csv');
  const csv=f.downloads.at(-1)[1],lines=csv.trim().split('\n');
  assert.equal(lines.length,expected.events.length*4+1);
  assert.match(csv,/最大收盘回撤%/);assert.match(csv,/相对起点最大跌幅%/);
  assert.ok(csv.includes(expected.events.at(-1).date));
  f.click('action','next');const html=await f.settle();
  assert.match(html,/第 2 \/ /);
  assert.ok(html.includes(expected.events[20].date));
  f.click('action','csv');assert.equal(f.downloads.at(-1)[1],csv);
});

test('source identity and retry failures are explicit rather than empty statistics',async()=>{
  const wrong=fixture({badIdentity:true});let html=await wrong.settle();
  assert.match(html,/缺少 \^NDX 的美元价格指数日线/);
  assert.doesNotMatch(html,/穿越之后，指数涨跌多少/);
  wrong.ui.choose('market','spx');html=await wrong.settle();
  assert.match(html,/标普500 · 当前/);
  const failed=fixture({fail:true});html=await failed.settle();
  assert.match(html,/缺少日线 &lt;503&gt;/);assert.match(html,/重新加载/);
  failed.state.fail=false;failed.click('action','retry');html=await failed.settle();
  assert.match(html,/穿越之后，指数涨跌多少/);
});

test('a chart stops at a known data gap and never fills pending outcomes with zero',async()=>{
  const data=prices(330),anchor=D.study(data).latestMatching;
  const prefix=data.slice(0,anchor.index+3);
  const after=new Date(prefix.at(-1)[0]+'T00:00:00Z');after.setUTCDate(after.getUTCDate()+20);
  const gapped=prefix.concat([[after.toISOString().slice(0,10),140]]);
  const f=fixture({series:gapped});await f.settle();
  f.click('event',anchor.date);
  const modal=f.modals.at(-1);
  assert.match(modal,/后续行情出现断档/);
  assert.match(modal,/缺连续行情/);
  assert.doesNotMatch(modal,new RegExp(after.toISOString().slice(0,10)));
});
