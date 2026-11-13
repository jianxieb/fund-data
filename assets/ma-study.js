(function () {
  'use strict';
  const M = window.Changheng, D = window.ChanghengMAStudyModel, R = window.ChanghengResearchHistory;
  const markets = {ndx:['纳斯达克100','^NDX'],spx:['标普500','^GSPC']};
  const directions = {up:'上穿均线',down:'下穿均线',both:'上穿或下穿'};
  const sides = {above:'收盘在均线上方',below:'收盘在均线下方',equal:'收盘等于均线'};
  const terms = {5:'1周',21:'1个月',63:'3个月',252:'1年'};
  const defaults = {market:'ndx',period:200,direction:'up',window:63,minCrossings:null};
  const esc = M.escapeHtml;
  const pct = value => value == null ? '—' : (value < 0 ? '−' : value > 0 ? '+' : '') + Math.abs(value).toFixed(2) + '%';
  const price = value => value == null ? '—' : value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const signed = value => '<span class="'+(value < 0 ? 'negative' : value > 0 ? 'positive' : '')+'">'+pct(value)+'</span>';
  const percent = value => value == null ? '—' : Number(value.toFixed(1))+'%';
  const statusName = {complete:'已到期',pending:'未到期',gap:'缺连续行情'};
  const cache = new Map(), results = new Map();
  const pageSize = 20;
  let H, st, active, series, signature='', page=1;

  function readState() {
    const q=new URLSearchParams(location.hash.split('?')[1]);
    const market=Object.hasOwn(markets,q.get('market'))?q.get('market'):defaults.market;
    const period=D.periods.includes(Number(q.get('period')))?Number(q.get('period')):defaults.period;
    const direction=Object.hasOwn(directions,q.get('direction'))?q.get('direction'):defaults.direction;
    const window=D.validWindow(Number(q.get('window')))?Number(q.get('window')):defaults.window;
    const value=q.has('minCrossings')?Number(q.get('minCrossings')):null;
    const minCrossings=value!==null&&D.validMinCrossings(value,window)?value:null;
    return {market,period,direction,window,minCrossings};
  }
  function redraw() { if (location.hash.split('?')[0]==='#ma-study') H.render(); }
  async function load(market) {
    const slot={}; cache.set(market,slot);
    try {
      const code=markets[market][1];
      const row=(await R.indexCatalog()).find(r=>r.id==='index:'+code);
      if (row?.kind!=='index'||row.code!==code||row.currency!=='USD'||row.basis!=='price_index')
        throw new Error('缺少 '+code+' 的美元价格指数日线');
      const history=await R.history(row);
      if (history.dividends!=='excluded') throw new Error(code+' 缺少不含分红的价格指数口径');
      slot.series=history.series; slot.row=row;
    } catch(e) { slot.error=e.message||'无法读取指数日线'; }
    redraw();
  }
  function update(next) {
    const q=new URLSearchParams();
    for (const key of Object.keys(defaults)) if(next[key]!==defaults[key]&&next[key]!=null) q.set(key,next[key]);
    history.replaceState(null,'','#ma-study'+(q.size?'?'+q:''));
    H.render();
  }
  function choose(key,value) {
    const next=readState();
    if(key==='market'&&Object.hasOwn(markets,value)) next.market=value;
    else if(key==='period'&&D.periods.includes(Number(value))) next.period=Number(value);
    else if(key==='direction'&&Object.hasOwn(directions,value)) next.direction=value;
    else if(key==='repeat'&&['any','min'].includes(value)) {
      if(value==='min') { next.window=Math.max(2,next.window); next.minCrossings=next.minCrossings??2; }
      else next.minCrossings=null;
    } else return;
    update(next);
  }
  function controls() {
    return '<div class="ma-controls">'+
      H.menu('ma-market','研究指数',Object.entries(markets).map(([k,v])=>[k,v[0]]),st.market)+
      H.menu('ma-period','简单移动平均线',D.periods.map(n=>[String(n),n+' 日均线（'+n+'MA）']),String(st.period))+
      H.menu('ma-direction','当次穿越方向',Object.entries(directions),st.direction)+
      H.menu('ma-repeat','近期穿越次数',[['any','不限'],['min','窗口内合计至少 N 次']],st.minCrossings==null?'any':'min')+
      '</div>'+(st.minCrossings==null?'':
      '<form id="ma-repeat-form" class="ma-repeat-form"><label for="ma-window">回看窗口（交易日，含信号当天）<input id="ma-window" name="window" type="number" inputmode="numeric" min="1" max="2520" step="1" required value="'+st.window+'"></label>'+
      '<label for="ma-count">上穿与下穿合计至少（次）<input id="ma-count" name="minCrossings" type="number" inputmode="numeric" min="1" max="2520" step="1" required value="'+st.minCrossings+'"></label>'+
      '<button type="submit" class="btn sm">应用次数条件</button><p>只在新的穿越发生当天入样。</p></form>')+
      '<div class="ma-filter-status"><span role="status">匹配 '+active.events.length+' / '+active.cohortN+' 次'+directions[st.direction]+'</span>'+
      (st.minCrossings!=null?'<span>最近 '+st.window+' 个交易日合计至少 '+st.minCrossings+' 次</span><button type="button" class="text-link" data-ma-action="clear-repeat">清除次数条件</button>':'')+
      '</div>';
  }
  function current() {
    const c=active.current, latest=active.latestMatching;
    if(!c) return '';
    const cell=(label,value,sub)=>'<div><span>'+label+'</span><strong>'+value+'</strong><small>'+sub+'</small></div>';
    return '<section class="ma-current" aria-label="当前指数与均线"><div class="ma-current-head"><h2>'+markets[st.market][0]+' · 当前与 '+st.period+'MA 的位置</h2><span>'+c.date+' 收盘</span></div><div class="ma-current-values">'+
      cell('指数收盘',price(c.close),'美元价格指数')+cell(st.period+' 日均线',price(c.ma),c.ma==null?'不足 '+st.period+' 个连续收盘':sides[c.side]||'位置待核对')+
      cell('收盘距均线',pct(c.distancePct),'（收盘 ÷ 均线 − 1）')+
      cell('近 '+st.window+' 日穿越次数',c.rollingCrosses==null?'—':c.rollingCrosses+' 次',c.windowComplete?'上穿与下穿合计':'缺完整窗口的穿越记录')+
      '</div><p class="ma-latest">'+(latest?'最近匹配：<button type="button" class="text-link" data-ma-event="'+latest.date+'">'+latest.date+' '+directions[latest.direction]+'</button> · 收盘 '+price(latest.close)+' · 均线 '+price(latest.ma):'当前条件没有匹配的历史穿越事件。')+'</p></section>';
  }
  function periodCell(h) { return '<th scope="row">'+terms[h]+'<small>'+h+' 个交易日</small></th>'; }
  function maturity(s) { return '<span>'+s.n+'</span>'+((s.pending||s.missing)?'<small>'+[s.pending?s.pending+' 次未到期':'',s.missing?s.missing+' 次缺行情':''].filter(Boolean).join(' · ')+'</small>':''); }
  function summary() {
    return '<section class="ds-panel ma-panel"><div class="ds-panel-head"><div><h2>穿越之后，指数涨跌多少？</h2><p>从信号日收盘起算 · 累计价格涨跌，不含分红</p></div><span class="ds-coverage">'+active.first+' — '+active.asOf+'</span></div>'+
      '<div class="ds-scroll"><table class="ma-table"><thead><tr><th>后续期限</th><th>有效样本</th><th>中位数</th><th>平均数</th><th>上涨占比</th><th>最低</th><th>最高</th></tr></thead><tbody>'+
      D.horizons.map(h=>{const s=active.summary[h];return '<tr>'+periodCell(h)+'<td>'+maturity(s)+'</td><td>'+signed(s.median)+'</td><td>'+signed(s.mean)+'</td><td>'+percent(s.upPct)+'</td><td>'+signed(s.min)+'</td><td>'+signed(s.max)+'</td></tr>';}).join('')+
      '</tbody></table></div><p class="ds-foot">每一期只纳入有完整后续行情的事件。密集穿越可能共享后续行情，上涨占比不是下一次的上涨概率。</p></section>';
  }
  function risk() {
    return '<section class="ds-panel ma-panel"><div class="ds-panel-head"><div><h2>期间回撤与起点以下的跌幅</h2><p>最大回撤看期间高点到后续低点；相对起点最大跌幅看最低收盘比信号日低多少。</p></div></div>'+
      '<div class="ds-scroll"><table class="ma-table ma-risk"><thead><tr><th rowspan="2">后续期限</th><th rowspan="2">有效样本</th><th colspan="3">期间最大收盘回撤</th><th colspan="3">相对起点最大跌幅</th></tr><tr><th>中位数</th><th>平均数</th><th>最深</th><th>中位数</th><th>平均数</th><th>最深</th></tr></thead><tbody>'+
      D.horizons.map(h=>{const s=active.summary[h],a=s.drawdown,b=s.minFromStart;return '<tr>'+periodCell(h)+'<td>'+maturity(s)+'</td>'+[a.median,a.mean,a.min,b.median,b.mean,b.min].map(v=>'<td>'+signed(v)+'</td>').join('')+'</tr>';}).join('')+
      '</tbody></table></div></section>';
  }
  function pathFor(e) {
    const rows=[series[e.index]];
    let gap=false;
    for(let i=e.index+1;i<Math.min(series.length,e.index+253);i++) {
      if(Date.parse(series[i][0])-Date.parse(series[i-1][0])>10*86400000) {gap=true;break;}
      rows.push(series[i]);
    }
    return {rows,gap};
  }
  function chart(e) {
    const {rows,gap}=pathFor(e), points=rows.map((r,i)=>[i,r[1]/e.close*100]), last=points.length-1;
    const values=points.map(p=>p[1]);
    let lo=Math.min(100,...values), hi=Math.max(100,...values);
    const pad=Math.max(1,(hi-lo)*.12);lo-=pad;hi+=pad;
    const left=62,right=870,top=20,bottom=218,width=900,height=264;
    const x=d=>left+d/Math.max(1,last)*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
    const ticks=[0,5,21,63,126,252,last].filter((n,i,a)=>n<=last&&a.indexOf(n)===i).sort((a,b)=>a-b);
    // Keep adjacent labels apart when a partially observed path ends near a standard horizon.
    const visible=ticks.filter((n,i)=>i===0||i===ticks.length-1||x(ticks[i+1])-x(n)>45).filter((n,i,a)=>i===0||x(n)-x(a[i-1])>35);
    const grid=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4).map(v=>'<line x1="'+left+'" x2="'+right+'" y1="'+y(v).toFixed(2)+'" y2="'+y(v).toFixed(2)+'" class="ma-chart-grid"/><text x="'+(left-10)+'" y="'+(y(v)+4).toFixed(2)+'" text-anchor="end">'+v.toFixed(1)+'</text>').join('');
    const path=points.map(([day,v],i)=>(i?'L':'M')+x(day).toFixed(2)+','+y(v).toFixed(2)).join(' ');
    const caption=e.date+' '+directions[e.direction]+'，信号日收盘设为 100；'+(gap?'后续行情出现断档，曲线截至断档前。':last<252?'已观察 '+last+' / 252 个交易日。':'已走完 252 个交易日。');
    return '<figure class="ma-chart"><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(caption)+'"><title>'+esc(caption)+'</title>'+grid+
      '<line x1="'+left+'" x2="'+right+'" y1="'+y(100).toFixed(2)+'" y2="'+y(100).toFixed(2)+'" class="ma-chart-baseline"/>'+
      '<path d="'+path+'" class="ma-chart-line"/><circle cx="'+x(last).toFixed(2)+'" cy="'+y(values.at(-1)).toFixed(2)+'" r="4" class="ma-chart-dot"/>'+
      visible.map(n=>'<text x="'+x(n).toFixed(2)+'" y="240" text-anchor="middle">'+n+'</text>').join('')+
      '<text x="'+right+'" y="259" text-anchor="end">信号后的交易日</text></svg><figcaption>'+caption+'<span>'+rows[0][0]+' — '+rows.at(-1)[0]+' · 实际累计 '+pct((rows.at(-1)[1]/e.close-1)*100)+'</span></figcaption></figure>';
  }
  function latestPath() {
    const e=active.latestMatching;
    if(!e) return '';
    return '<section class="ds-panel ma-panel"><div class="ds-panel-head"><div><h2>最近匹配事件的后续走势</h2><p>'+e.date+' · '+directions[e.direction]+' '+st.period+'MA</p></div><button type="button" class="btn sm" data-ma-event="'+e.date+'">查看该次结果</button></div>'+chart(e)+'</section>';
  }
  function eventRows() {
    const events=active.events, total=Math.max(1,Math.ceil(events.length/pageSize));page=Math.min(page,total);
    return '<section class="ds-panel ma-panel"><div class="ds-panel-head"><div><h2>逐次表现 · 全部期限</h2><p>日期可查看实际路径；每个期限下方列出期间最大回撤。</p></div><button type="button" class="btn sm" data-ma-action="csv"'+(events.length?'':' disabled')+'>导出全部事件 CSV</button></div>'+
      (events.length?'<div class="ds-scroll"><table class="ma-table ma-events"><thead><tr><th>信号日</th><th>穿越方向</th><th>信号收盘 / 均线</th><th>近 '+st.window+' 日穿越</th>'+D.horizons.map(h=>'<th>'+terms[h]+'后</th>').join('')+'</tr></thead><tbody>'+
      events.slice((page-1)*pageSize,page*pageSize).map(e=>'<tr><th scope="row"><button type="button" class="text-link" data-ma-event="'+e.date+'">'+e.date+'</button></th><td>'+directions[e.direction]+'</td><td>'+price(e.close)+'<small>'+st.period+'MA '+price(e.ma)+'</small></td><td>'+(e.rollingCrosses==null?'窗口不完整':e.rollingCrosses+' 次')+'</td>'+
        D.horizons.map(h=>{const o=e.outcomes[h];return '<td>'+(o.status==='complete'?signed(o.pct)+'<small>回撤 '+pct(o.maxDrawdownPct)+'</small>':statusName[o.status])+'</td>';}).join('')+'</tr>').join('')+
      '</tbody></table></div><div class="ds-pagination"><span>共 '+events.length+' 次 · 第 '+page+' / '+total+' 页</span><button type="button" class="btn sm" data-ma-action="previous"'+(page===1?' disabled':'')+'>上一页</button><button type="button" class="btn sm" data-ma-action="next"'+(page===total?' disabled':'')+'>下一页</button></div>':
      '<p class="ds-foot">没有匹配事件。'+(st.minCrossings!=null?'<button type="button" class="text-link" data-ma-action="clear-repeat">清除次数条件</button>':'可切换指数、均线或穿越方向。')+'</p>')+'</section>';
  }
  function detail(e) {
    H.openModal(H.modalTitle(e.date+' · '+directions[e.direction]+' '+st.period+'MA',markets[st.market][0]+' · 信号日收盘起算，不含分红')+
      '<div class="ma-detail"><p>信号收盘 '+price(e.close)+' · '+st.period+'MA '+price(e.ma)+' · 距均线 '+pct(e.distancePct)+' · 近 '+st.window+' 日穿越 '+(e.rollingCrosses==null?'缺完整记录':e.rollingCrosses+' 次')+'</p>'+chart(e)+
      '<div class="ds-scroll"><table class="ma-table"><thead><tr><th>期限</th><th>实际期末日</th><th>期末收盘</th><th>累计涨跌</th><th>最大回撤</th><th>相对起点最大跌幅</th></tr></thead><tbody>'+
      D.horizons.map(h=>{const o=e.outcomes[h];return '<tr>'+periodCell(h)+'<td>'+(o.date||statusName[o.status])+'</td><td>'+price(o.close)+'</td><td>'+signed(o.pct)+'</td><td>'+signed(o.maxDrawdownPct)+'</td><td>'+signed(o.minFromStartPct)+'</td></tr>';}).join('')+'</tbody></table></div></div>');
  }
  function method() {
    return '<details class="ds-method ma-method"><summary>均线、穿越次数与收益口径</summary>'+
      '<p>均线是截至当天最近 '+st.period+' 个交易日收盘的算术平均。收盘从均线下方变到上方记上穿，反向记下穿；恰好等于均线只算触线，直到再次位于另一侧才记一次穿越。均线与触发条件均只使用当天及之前的信息。</p>'+
      '<p>次数条件统计截至每个信号日的最近 X 个交易日，上穿与下穿合计，包含信号当天。只有完整窗口才应用次数筛选；即使次数已达到门槛，也只在新的穿越日入样。</p>'+
      '<p>后续收益以信号日收盘为起点，分别观察 5、21、63、252 个交易日，不含触发日涨跌。最大回撤从这段持有期内的历史最高收盘计算；相对起点最大跌幅以信号日收盘为基准。二者均只看收盘，不使用盘中最低价。</p>'+
      '<p>单个行情断档超过 10 个自然日会重置均线与穿越状态，跨断档的后续结果不计入。历史上涨占比是事件频数，事件区间可能重叠；结果不等于可按信号收盘成交的交易策略。</p>'+
      '<p><a href="https://finance.yahoo.com/quote/'+encodeURIComponent(markets[st.market][1])+'/history/" target="_blank" rel="noopener noreferrer">指数历史收盘 ↗</a> · <a href="https://github.com/jianxieb/fund-data/blob/main/docs/ma-study-method.md" target="_blank" rel="noopener noreferrer">完整方法与核对记录 ↗</a></p></details>';
  }
  function download() {
    const rows=[['指数','口径','行情截至','均线交易日','当次方向筛选','回看窗口交易日','窗口至少穿越次数','信号日','穿越方向','信号收盘','信号均线','距均线%','窗口穿越次数','窗口完整','后续交易日','期限','状态','实际期末日','期末收盘','累计涨跌%','最大收盘回撤%','相对起点最大跌幅%']];
    for(const e of active.events) for(const h of D.horizons) {
      const o=e.outcomes[h];rows.push([markets[st.market][0],'美元价格指数，不含分红',active.asOf,st.period,directions[st.direction],st.window,st.minCrossings??'不限',e.date,directions[e.direction],e.close,e.ma,e.distancePct,e.rollingCrosses,e.windowComplete?'是':'否',h,terms[h],statusName[o.status],o.date,o.close,o.pct,o.maxDrawdownPct,o.minFromStartPct]);
    }
    H.download(markets[st.market][0]+'-'+st.period+'MA-'+st.direction+'-'+active.asOf+'.csv',M.csv(rows),'text/csv;charset=utf-8');
  }
  function view(helpers) {
    H=helpers;st=readState();
    const head=H.head('MOVING AVERAGE CROSSOVERS','均线穿越后表现','比较标普500、纳斯达克100上穿、下穿或反复穿越长期均线后的收益与回撤。');
    if(!cache.has(st.market)) load(st.market);
    const slot=cache.get(st.market);
    if(!slot.series) return head+'<div class="ds-panel ds-loading" role="status">'+(slot.error?esc(slot.error)+' <button type="button" class="text-link" data-ma-action="retry">重新加载</button>':'正在读取'+markets[st.market][0]+'历史收盘…')+'</div>';
    series=slot.series;
    const key=JSON.stringify(st);
    if(signature!==key) {page=1;signature=key;}
    try {if(!results.has(key)) results.set(key,D.study(series,st));active=results.get(key);}
    catch(e) {return head+'<div class="ds-panel ds-loading" role="status">'+esc(e.message)+'</div>';}
    return head+controls()+current()+summary()+risk()+latestPath()+eventRows()+method();
  }
  document.addEventListener('submit',event=>{
    if(event.target.id!=='ma-repeat-form') return;
    event.preventDefault();
    const form=event.target,windowInput=form.elements.namedItem('window'),countInput=form.elements.namedItem('minCrossings');
    const window=Number(windowInput.value),minCrossings=Number(countInput.value);
    windowInput.setCustomValidity(D.validWindow(window)?'':'请输入 1 至 2520 的整数交易日');
    countInput.setCustomValidity(D.validMinCrossings(minCrossings,window)?'':'穿越次数须为 1 至回看交易日数之间的整数');
    if(!form.reportValidity()) return;
    update({...readState(),window,minCrossings});
  });
  document.addEventListener('input',event=>{
    const form=event.target.closest('#ma-repeat-form');
    if(form) for(const key of ['window','minCrossings']) form.elements.namedItem(key).setCustomValidity('');
  });
  document.addEventListener('click',event=>{
    const date=event.target.closest('[data-ma-event]')?.dataset.maEvent;
    if(date&&active) {const row=active.events.find(e=>e.date===date);if(row) detail(row);return;}
    const button=event.target.closest('[data-ma-action]');if(!button||button.disabled) return;
    const action=button.dataset.maAction;
    if(action==='retry') {cache.delete(readState().market);results.clear();H.render();}
    else if(action==='clear-repeat') update({...readState(),minCrossings:null});
    else if(action==='csv'&&active) download();
    else if(action==='previous'&&page>1) {page--;H.render();}
    else if(action==='next'&&active&&page<Math.ceil(active.events.length/pageSize)) {page++;H.render();}
  });
  window.ChanghengMAStudy={view,choose};
})();
