(function () {
  'use strict';
  const M = window.ChanghengMarketHistoryModel;
  const state = {years:20, market:'spx', metric:'pe', allYears:false, data:null, loading:false, error:false};
  const categories = {valuation:'估值', risk:'波动与回撤', trend:'价格趋势', macro:'利率与金融环境'};
  const frequencies = {daily:'日频', weekly:'周频', monthly:'月频', quarterly:'季频'};
  const evidenceLabels = {published:'官方发布', calculated:'指数行情计算', provider:'供应商发布'};
  const guides = {
    pe:'PE 衡量为每单位过去12个月盈利支付的价格；结合价格曲线看估值扩张或收缩。',
    vix:'VIX 反映标普500期权定价的未来30日波动预期；尖峰对应的价格走势可在同一日期查看。',
    vxn:'VXN 反映纳斯达克100期权定价的未来30日波动预期；波动大小不表示涨跌方向。',
    rv21:'过去21个交易日的实际年化波动；数值越高，近期价格起伏越大。',
    drawdown:'相对过去252个交易日最高收盘的跌幅；0%表示处在一年高点，越负离高点越远。',
    mdd252:'过去252个交易日内最深的峰谷跌幅；反映这一年持有过程中经历过的回撤。',
    ma200:'价格高于200日均线时为正，低于时为负；可结合价格观察趋势与偏离程度。',
    momentum:'近252个交易日的累计价格涨跌；与本页自然年度涨跌的起止日期不同。',
    yield10y:'10年期美债名义收益率；可结合指数价格观察长期利率环境。',
    real10y:'10年期通胀保值国债实际收益率；可结合价格观察实际利率环境。',
    curve10_2:'10年减2年国债收益率；低于0表示这一段收益率曲线倒挂。',
    nfci:'NFCI 高于0代表金融条件比历史平均更紧，低于0更松；采用联储修订后周度历史。'
  };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v,n=2) => Number.isFinite(v) ? v.toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n}) : '—';
  const pct = v => Number.isFinite(v) ? (v>0?'+':'')+fmt(v,1)+'%' : '—';
  const axis = v => Math.abs(v)>=100 ? fmt(v,0) : fmt(v,Math.abs(v)<1&&v!==0?1:0);
  const rankLabel = s => fmt(s.percentile,1)+'%';
  const rankPeriod = s => s.stale ? '末次观测的历史分位' : s.lateStart ? '可用'+fmt(s.coverageYears,1)+'年分位' : state.years+'年历史分位';
  const freshnessNote = (label,date,fresh) => fresh.future
    ? `${label}观测日 ${date} 晚于设备北京时间 ${fresh.checkedOn}，请检查设备时间；以下保留该日历史读数。`
    : `${label}最近观测 ${date}，距北京时间 ${fresh.checkedOn} 已 ${fresh.lagDays} 天，超过 ${fresh.threshold} 天更新阈值；以下保留该日历史读数。`;
  const freshnessLabel = s => s.future ? '观测日晚于设备日期' : `已 ${s.lagDays} 天 · 超过 ${s.threshold} 天阈值`;
  const yearToDateLabel = (compact=false) => M.observationFreshness(state.data.asOf,'daily',M.shanghaiDate()).stale
    ? (compact?'截至':'年初至')+state.data.asOf.slice(5) : compact?'至今':'年初至今';
  const button = (label,action,value='',cls='',attrs='') => `<button type="button" data-market-action="${action}" data-value="${esc(value)}" class="${cls}" ${attrs}>${label}</button>`;
  const link = (url,label) => /^https:\/\//.test(url||'') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
  const sourceLabel = metric => metric.source.startsWith('jiucai-')?'韭圈 · 整体法':metric.source.startsWith('yahoo-')?'Yahoo Finance':metric.source.startsWith('treasury-')?'美国财政部':metric.source==='nfci'?'芝加哥联储':'Cboe';
  let ctx, summaries = new Map(), plots = new Map();
  function summary(market,metric) {
    const checkedOn = M.shanghaiDate(), key = `${market.id}:${metric.id}:${state.years}:${checkedOn}`;
    if (!summaries.has(key)) summaries.set(key,M.summarize(metric,state.data.asOf,state.years,checkedOn));
    return summaries.get(key);
  }
  function load() {
    if (state.loading) return;
    state.loading=true; state.error=false;
    fetch(document.querySelector('#market-history-source').dataset.src).then(response => {
      if (!response.ok) throw new Error('Report unavailable');
      return response.json();
    }).then(data => {
      if (data.schemaVersion!==1 || data.publicationPolicy!=='research-evidence-v2' || !Array.isArray(data.markets) || !data.context) throw new Error('Invalid report');
      if ([...data.markets,data.context].some(m=>m.snapshots?.length||m.metrics.some(metric=>!M.eligibleMetric(m.id,metric)))) throw new Error('Unreviewed data');
      state.data=data; summaries=new Map();
    }).catch(()=>{state.error=true;}).finally(()=>{
      state.loading=false;
      if (location.hash==='#market-history') ctx.render();
    });
  }
  function group(action,options,current,label) {
    return `<div class="mh-control" role="group" aria-label="${label}">${options.map(([v,t])=>button(t,action,v,String(current)===String(v)?'is-active':'',`aria-pressed="${String(current)===String(v)}"`)).join('')}</div>`;
  }
  function active() {
    const market=state.data.markets.find(m=>m.id===state.market);
    const owner=market.metrics.some(m=>m.id===state.metric)?market:state.data.context;
    const metric=owner.metrics.find(m=>m.id===state.metric)||market.metrics[0];
    return {market,owner:metric===market.metrics[0]?market:owner,metric};
  }
  function metricSelect(market,metric) {
    return `<label class="mh-select-label">叠加指标<select data-market-select="metric" aria-label="叠加指标">${Object.entries(categories).map(([key,label])=>`<optgroup label="${label}">${[...market.metrics,...state.data.context.metrics].filter(m=>m.category===key).map(m=>`<option value="${m.id}" ${metric.id===m.id?'selected':''}>${esc(m.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  }
  function bounds(values,zero=false) {
    let lo=Math.min(...values),hi=Math.max(...values);
    const pad=(hi-lo)*.1||Math.max(Math.abs(hi)*.1,1);
    lo-=pad;hi+=pad;
    if(zero){lo=Math.min(0,lo);hi=Math.max(0,hi);}
    if(Math.min(...values)>=0)lo=Math.max(0,lo);
    const power=10**Math.floor(Math.log10((hi-lo)/4));
    for(const factor of [1,2,2.5,5,10,20,25,50]) {
      const step=power*factor,base=Math.floor(lo/step)*step;
      if(base+4*step>=hi)return [base,base+4*step];
    }
    return [lo,hi];
  }
  const scale = (lo,hi,top,bottom) => v => bottom-(v-lo)/(hi-lo)*(bottom-top);
  function linePaths(points,frequency,x,y,cls,limit=1000) {
    return M.segments(points,frequency).filter(p=>p.length).map(segment=>{
      const ps=M.downsample(segment,limit);
      return ps.length===1?`<circle class="${cls}-point" cx="${x(ps[0][0])}" cy="${y(ps[0][1])}" r="2.5"/>`:`<path class="${cls}" d="${ps.map(([d,v],i)=>(i?'L':'M')+x(d).toFixed(2)+' '+y(v).toFixed(2)).join(' ')}"/>`;
    }).join('');
  }
  function overlayChart(market,metric,a) {
    const w=1200,h=430,l=68,r=68,t=30,b=387;
    const x=d=>l+(Date.parse(d)-Date.parse(a.start))/(Date.parse(a.end)-Date.parse(a.start))*(w-l-r);
    const pb=bounds(a.prices.map(p=>p[1])), mb=bounds(a.metricPoints.map(p=>p[1]));
    const py=scale(...pb,t,b),my=scale(...mb,t,b);
    plots.set('main',{...a,x,py,my,w,l,r,t,b,metric,market,index:a.timeline.length-1});
    const grid=Array.from({length:5},(_,i)=>{
      const p=pb[0]+(pb[1]-pb[0])*i/4,m=mb[0]+(mb[1]-mb[0])*i/4,y=py(p);
      return `<line class="mh-gridline" x1="${l}" x2="${w-r}" y1="${y}" y2="${y}"/><text class="mh-price-ink" x="${l-12}" y="${y+4}" text-anchor="end">${fmt(p,0)}</text><text class="mh-indicator-ink" x="${w-r+12}" y="${y+4}">${fmt(m,1)}</text>`;
    }).join('');
    const ticks=Array.from({length:6},(_,i)=>new Date(Date.parse(a.start)+(Date.parse(a.end)-Date.parse(a.start))*i/5).toISOString().slice(0,10));
    const missing=a.summary.lateStart?`<text class="mh-missing-label" x="${l+16}" y="${t+22}">${esc(metric.label)}历史始于 ${a.metricPoints[0][0].slice(0,7)}</text>`:'';
    const last=a.timeline.at(-1);
    return `<div class="mh-chart-shell"><svg class="mh-overlay" data-mh-plot="main" viewBox="0 0 ${w} ${h}" tabindex="0" role="img" aria-label="${market.name}价格与${esc(metric.label)}同时间轴叠图；左轴指数点位，右轴${metric.unit}。左右方向键逐日查看，Home与End跳至首尾。"><title>${market.name}价格与${esc(metric.label)} · ${a.start}至${a.end}</title>
      <text class="mh-price-ink" x="${l}" y="15">指数点位 / 左轴</text><text class="mh-indicator-ink" x="${w-r}" y="15" text-anchor="end">${esc(metric.label)}（${metric.unit}）/ 右轴</text>
      ${grid}<line class="mh-median" x1="${x(a.metricPoints[0][0])}" x2="${x(a.metricPoints.at(-1)[0])}" y1="${my(a.summary.median)}" y2="${my(a.summary.median)}"/>
      ${linePaths(a.prices,'daily',x,py,'mh-price-series')}${linePaths(a.metricPoints,metric.frequency,x,my,'mh-indicator-series')}${missing}
      ${ticks.map((d,i)=>`<text x="${x(d)}" y="${h-12}" text-anchor="${i===0?'start':i===5?'end':'middle'}">${d.slice(0,7)}</text>`).join('')}
      <g class="mh-cursor" aria-hidden="true"><line data-cursor-line x1="${x(last.date)}" x2="${x(last.date)}" y1="${t}" y2="${b}"/><circle data-cursor-price class="mh-price-dot" cx="${x(last.date)}" cy="${last.price===null?t:py(last.price)}" r="4" ${last.price===null?'visibility="hidden"':''}/><circle data-cursor-metric class="mh-indicator-dot" cx="${x(last.date)}" cy="${last.value===null?t:my(last.value)}" r="4" ${last.value===null?'visibility="hidden"':''}/></g>
      <rect class="mh-hit-area" x="${l}" y="${t}" width="${w-l-r}" height="${b-t}"/>
    </svg></div>`;
  }
  function mainChart(market,owner,metric) {
    const checkedOn=M.shanghaiDate(),a=M.overlay(market,metric,state.data.asOf,state.years,checkedOn);
    if(a.error)return `<section class="mh-panel"><p class="mh-unavailable">${a.error}</p></section>`;
    const s=a.summary,last=a.timeline.at(-1),p=a.prices.at(-1),priceFreshness=M.observationFreshness(p[0],'daily',checkedOn);
    const sameFreshness=priceFreshness.stale&&s.stale&&p[0]===s.last[0]&&priceFreshness.threshold===s.threshold;
    const freshnessWarnings=sameFreshness?[freshnessNote('指数与'+metric.label,p[0],s)]:[priceFreshness.stale?freshnessNote('指数',p[0],priceFreshness):'',s.stale?freshnessNote(metric.label,s.last[0],s):''].filter(Boolean);
    return `<section class="mh-panel mh-main-chart" id="mh-main-chart"><header class="mh-section-head"><div><span class="mh-kicker">01 / 同一时间，看价格与指标</span><h2>${market.name} · 价格与${esc(metric.label)}</h2></div>${metricSelect(market,metric)}</header>
      <div class="mh-readings"><div><span>${priceFreshness.stale?'末次指数收盘':'指数收盘'} <small>${p[0]}</small></span><strong>${fmt(p[1])}<small>点</small></strong></div><div><span>${s.stale?'末次观测 · ':''}${esc(metric.label)} <small>${s.last[0]}</small></span><strong class="mh-indicator-ink">${fmt(s.last[1])}<small>${metric.unit}</small></strong></div><div><span>${rankPeriod(s)}</span><strong>${rankLabel(s)}</strong></div><div><span>历史中位数</span><strong>${fmt(s.median)}<small>${metric.unit}</small></strong></div></div>
      ${freshnessWarnings.length?`<p class="mh-chart-reading mh-pending" role="status">${freshnessWarnings.map(esc).join('<br>')}</p>`:''}
      <div class="mh-chart-legend"><span><i class="mh-key-price"></i>${market.name} · 左轴</span><span><i class="mh-key-indicator"></i>${esc(metric.label)} · 右轴</span><span><i class="mh-key-median"></i>指标历史中位</span></div>
      <div class="mh-cross-readout" aria-live="off"><time data-readout-date>${last.date}</time><span class="mh-price-ink">${market.name} <b data-readout-price>${last.price===null?'无同日观测':fmt(last.price)+' 点'}</b></span><span class="mh-indicator-ink">${esc(metric.label)} <b data-readout-metric>${last.value===null?'无同日观测':fmt(last.value)+' '+metric.unit}</b></span><small>移到图上查看同日读数</small></div>
      ${overlayChart(market,metric,a)}
      <p class="mh-chart-reading">${s.stale?`截至 ${s.last[0]} 的历史读数处于可用样本的 <b>${fmt(s.percentile,1)}%</b> 分位。`:`${esc(guides[metric.id]||'')} 当前处于可用历史的 <b>${fmt(s.percentile,1)}%</b> 分位。`}</p>
      <footer class="mh-chart-foot"><span>${sourceLabel(metric)} · ${frequencies[metric.frequency]} · 指标覆盖 ${s.points[0][0]} — ${s.last[0]}${s.gaps.length?' · 缺口断线':''}</span>${button('本指标数据与口径 ↗','detail',`${owner.id}:${metric.id}`,'mh-text-button')}</footer>
    </section>`;
  }
  function rankCell(s) {
    return `<div class="mh-table-rank"><span class="mh-rank-track" aria-hidden="true"><i style="left:${Math.max(1,Math.min(99,s.percentile))}%"></i></span><b>${rankLabel(s)}</b></div>${s.stale?'<small class="mh-pending">末次观测分位</small>':''}`;
  }
  function overviewTable(market) {
    return `<section class="mh-panel mh-overview"><header class="mh-section-head"><div><span class="mh-kicker">02 / 最近观测在历史哪里</span><h2>指标分位一览</h2></div><p>分位越高，数值越高；不代表越值得买入。</p></header><div class="mh-table-scroll"><table class="mh-table mh-overview-table"><thead><tr><th scope="col">指标 · 点选叠图</th><th scope="col">最近观测值</th><th scope="col">历史分位</th><th scope="col">历史中位</th><th scope="col">历史中间80%区间</th><th scope="col">实际覆盖 / 最近日期</th></tr></thead><tbody>${Object.entries(categories).map(([category,label])=>{
      const owner=category==='macro'?state.data.context:market;
      const metrics=owner.metrics.filter(m=>m.category===category);
      if(!metrics.length)return '';
      return `<tr class="mh-category-row"><th colspan="6" scope="rowgroup">${label}${category==='macro'?' · 同样可与所选指数叠加':''}</th></tr>`+metrics.map(metric=>{
        const s=summary(owner,metric);if(!s)return '';
        const key=owner.id+':'+metric.id;
        return `<tr data-metric="${key}" class="${metric.id===state.metric?'is-selected':''}"><th scope="row">${button(esc(metric.label)+' <span aria-hidden="true">↗</span>','metric',metric.id,'mh-metric-link',`aria-label="叠加${esc(metric.label)}与${market.name}价格"`)}<small>${sourceLabel(metric)} · ${metric.id==='curve10_2'?'同日利率相减':evidenceLabels[metric.evidence]}</small></th><td><b>${fmt(s.last[1])}</b><small class="mh-unit">${metric.unit}</small>${s.stale?'<small class="mh-pending">待更新 · 保留历史值</small>':''}</td><td>${rankCell(s)}</td><td>${fmt(s.median)}<small class="mh-unit">${metric.unit}</small></td><td>${fmt(s.p10)} — ${fmt(s.p90)}<small class="mh-unit">${metric.unit}</small></td><td><span>${s.points[0][0].slice(0,7)} — ${s.last[0].slice(0,7)}</span><small>${s.last[0]}${s.lateStart?' · 不足'+state.years+'年':''}</small>${s.stale?'<small class="mh-pending">'+freshnessLabel(s)+'</small>':''}</td></tr>`;
      }).join('');
    }).join('')}</tbody></table></div></section>`;
  }
  function annualChart(market,metric,rows) {
    if(!rows.length)return '<p class="mh-unavailable">缺少年度价格记录</p>';
    const w=1200,h=290,l=68,r=68,t=30,b=239,step=(w-l-r)/rows.length;
    const rb=bounds(rows.map(r=>r.returnPct).filter(Number.isFinite).concat([0]),true);
    const metricValues=rows.map(r=>r.value).filter(Number.isFinite);
    const mb=bounds(metricValues.length?metricValues:[0]);
    const ry=scale(...rb,t,b),my=scale(...mb,t,b),x=i=>l+step*(i+.5);
    let line='';
    rows.forEach((row,i)=>{if(row.value===null)return;line+=(i&&rows[i-1].value!==null?' L':' M')+x(i).toFixed(2)+' '+my(row.value).toFixed(2);});
    return `<svg class="mh-annual-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${market.name}年度价格涨跌柱状图，叠加期末${esc(metric.label)}折线"><title>年度涨跌与同年期末${esc(metric.label)}</title><text class="mh-price-ink" x="${l}" y="15">年度涨跌（%）/ 左轴</text><text class="mh-indicator-ink" x="${w-r}" y="15" text-anchor="end">期末${esc(metric.label)}（${metric.unit}）/ 右轴</text>
      ${Array.from({length:5},(_,i)=>{const v=rb[0]+(rb[1]-rb[0])*i/4;return `<line class="mh-gridline" x1="${l}" x2="${w-r}" y1="${ry(v)}" y2="${ry(v)}"/><text x="${l-12}" y="${ry(v)+4}" text-anchor="end">${fmt(v,0)}%</text><text class="mh-indicator-ink" x="${w-r+12}" y="${ry(v)+4}">${fmt(mb[0]+(mb[1]-mb[0])*i/4,1)}</text>`;}).join('')}
      <line class="mh-zero" x1="${l}" x2="${w-r}" y1="${ry(0)}" y2="${ry(0)}"/>
      ${rows.map((row,i)=>`<g>${row.returnPct!==null?`<rect class="mh-return-bar ${row.returnPct<0?'is-negative':''}" x="${x(i)-step*.29}" y="${Math.min(ry(0),ry(row.returnPct))}" width="${step*.58}" height="${Math.max(.7,Math.abs(ry(row.returnPct)-ry(0)))}"><title>${row.year}${row.ytd?' '+yearToDateLabel():row.partialStart?' 窗口内':''}：${pct(row.returnPct)}；期末${esc(metric.label)} ${fmt(row.value)}${metric.unit}</title></rect><text class="mh-bar-value" x="${x(i)}" y="${ry(row.returnPct)+(row.returnPct>=0?-6:15)}" text-anchor="middle">${fmt(row.returnPct,0)}%</text>`:''}<text x="${x(i)}" y="${h-26}" text-anchor="middle">${row.year}</text>${row.ytd||row.partialStart?`<text class="mh-partial-label" x="${x(i)}" y="${h-10}" text-anchor="middle">${row.ytd?yearToDateLabel(true):'窗口内'}</text>`:''}</g>`).join('')}
      <path class="mh-indicator-series" d="${line}"/>${rows.map((row,i)=>row.value===null?'':`<circle class="mh-indicator-dot" cx="${x(i)}" cy="${my(row.value)}" r="3"><title>${row.endDate}：${fmt(row.value)}${metric.unit}</title></circle>`).join('')}</svg>`;
  }
  function annualSection(market,metric) {
    const rows=M.annualRows(market,metric,state.data.asOf,state.years),visible=[...rows].reverse().slice(0,state.allYears?rows.length:6);
    return `<section class="mh-panel mh-annual"><header class="mh-section-head"><div><span class="mh-kicker">03 / 每一年，涨跌与指标对应</span><h2>年度表现与期末${esc(metric.label)}</h2></div>${button('下载年度表 CSV','annual-csv','','mh-text-button')}</header><div class="mh-chart-legend"><span><i class="mh-key-bar"></i>年度价格涨跌 · 左轴</span><span><i class="mh-key-indicator"></i>期末${esc(metric.label)} · 右轴</span></div>${annualChart(market,metric,rows)}
      <p class="mh-chart-note">${state.data.asOf.slice(0,4)}年为${yearToDateLabel()}；首年“窗口内”仅统计所选起日之后。期末指标严格匹配收盘日，缺观测留空。</p>
      <div class="mh-table-scroll"><table class="mh-table mh-year-table"><thead><tr><th>年度 / 区间</th><th>价格涨跌</th><th>期间最大回撤</th><th>期末收盘</th><th>期末${esc(metric.label)}</th><th>期间指标中位</th></tr></thead><tbody>${visible.map(r=>`<tr><th scope="row">${r.year}${r.ytd?' · '+yearToDateLabel():r.partialStart?' · 窗口内':''}<small>${r.startDate} — ${r.endDate}</small></th><td class="${r.returnPct<0?'mh-negative':'mh-positive'}">${r.incomplete?'行情不完整':pct(r.returnPct)}</td><td>${pct(r.drawdownPct)}</td><td>${fmt(r.price)}<small class="mh-unit">点</small></td><td>${r.value===null?'<span class="mh-empty-value">缺少同日观测</span>':fmt(r.value)+'<small class="mh-unit">'+metric.unit+'</small>'}</td><td>${r.count?fmt(r.median)+'<small class="mh-unit">'+metric.unit+'</small>':'—'}<small>${r.count?r.count+'个观测':''}</small></td></tr>`).join('')}</tbody></table></div>${rows.length>6?button(state.allYears?'收起较早年份':'展开全部 '+rows.length+' 个年份','all-years','','mh-show-years'):''}</section>`;
  }
  function view(context) {
    ctx=context; plots=new Map();
    const header=`<header class="mh-report-head"><div><div class="eyebrow">MARKET HISTORY / 长衡研究</div><h1>历史分位</h1><p>看当前所处的位置，也看同一时期的价格表现。</p></div><div class="mh-report-meta"><span>数据截至</span><b>${state.data?.asOf||'—'}</b>${button('数据来源与缺口 ↗','sources','','mh-text-button')}</div></header>`;
    if(!state.data){if(!state.loading&&!state.error)load();return header+`<div class="mh-loading" role="status">${state.error?'历史数据加载失败。'+button('重新加载','retry','','btn'):'正在载入历史观测数据…'}</div>`;}
    const {market,owner,metric}=active();
    return `<div class="mh-report">${header}<div class="mh-toolbar">${group('market',[['spx','标普500'],['ndx','纳斯达克100']],state.market,'观察指数')}<div class="mh-control-block"><span>历史窗口</span>${group('years',[[5,'5年'],[10,'10年'],[20,'20年']],state.years,'历史区间')}</div></div>${mainChart(market,owner,metric)}${overviewTable(market)}${annualSection(market,metric)}<footer class="mh-report-foot"><span>指数点位与收益均为美元价格口径，不含分红、税费。双轴只对齐时间，不比较两条线的高低或交叉。</span>${button('打印 / 保存PDF','print','','mh-text-button')}</footer></div>`;
  }
  function svgDistribution(metric, s, large = false) {
    const w = large ? 900 : 480, h = large ? 270 : 178, l = 39, r = 17, t = 27, b = h - 26;
    const hist = M.histogram(s.points, large ? 38 : 26), peak = Math.max(...hist.counts);
    const x = v => l + (v - hist.min) / (hist.max - hist.min) * (w - l - r), bar = (w - l - r) / hist.counts.length;
    const currentBin = Math.min(hist.counts.length - 1, Math.floor((s.last[1] - hist.min) / hist.width));
    return `<svg class="mh-plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metric.label)}历史分布，${s.count}个样本，末次观测${fmt(s.last[1])}${metric.unit}"><title>${esc(metric.label)} · 历史频数分布</title>
      <line class="mh-gridline" x1="${l}" x2="${w - r}" y1="${b}" y2="${b}"/><text x="${l}" y="14">样本占比</text>
      ${hist.counts.map((count, i) => { const height = count / peak * (b - t); return `<rect class="mh-hist-bar${i === currentBin ? ' is-current' : ''}" x="${l + i * bar + 1}" y="${b - height}" width="${Math.max(1, bar - 2)}" height="${height}"/>`; }).join('')}
      <line class="mh-marker" x1="${x(s.last[1])}" x2="${x(s.last[1])}" y1="${t}" y2="${b}"/>
      <text x="${Math.max(l + 26, Math.min(w - r - 26, x(s.last[1])))}" y="18" text-anchor="middle" class="mh-chart-current">末次观测</text>
      <text x="${l - 7}" y="${t + 4}" text-anchor="end">${fmt(100 * peak / hist.total, 0)}%</text>
      ${[hist.min, (hist.min + hist.max) / 2, hist.max].map((v, i) => `<text x="${x(v)}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${axis(v)}${i === 2 ? metric.unit : ''}</text>`).join('')}</svg>`;
  }

  function find(value) {
    const [id,key]=value.split(':'),market=[...state.data.markets,state.data.context].find(m=>m.id===id);
    const metric=market?.metrics.find(m=>m.id===key&&M.eligibleMetric(market.id,m));
    return {market,metric,s:metric&&summary(market,metric)};
  }
  function detail(value) {
    const {market,metric,s}=find(value);if(!s)return;
    const stats=[['历史最低',s.min],['10%分位',s.p10],['历史中位',s.median],['90%分位',s.p90],['历史最高',s.max]];
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle(esc(market.name+' · '+metric.label),s.points[0][0]+' — '+s.last[0])}<div class="mh-detail-summary"><div><span>${s.stale?'末次观测':'最近观测'} · ${s.last[0]}</span><strong>${fmt(s.last[1])}<small>${metric.unit}</small></strong></div><div><span>${rankPeriod(s)}</span><strong>${rankLabel(s)}</strong></div><div><span>${frequencies[metric.frequency]}观测</span><strong>${s.count.toLocaleString()}</strong></div></div>${s.stale?'<p class="mh-chart-reading mh-pending" role="status">'+esc(freshnessNote(metric.label,s.last[0],s))+'</p>':''}<h3>历史分布 <span>金色为末次读数 · 柱高为样本占比</span></h3>${svgDistribution(metric,s,true)}<dl class="mh-statistics">${stats.map(([k,v])=>`<div><dt>${k}</dt><dd>${fmt(v)}<small>${metric.unit}</small></dd></div>`).join('')}</dl><section class="mh-method"><h3>计算口径与来源</h3><p>${esc(metric.basis)}</p>${metric.limitations?'<p>'+esc(metric.limitations)+'</p>':''}<p>分位 =（低于最新值的观测数 + 相同值观测数 × 0.5）÷ 有效观测数。历史中间80%区间为第10至第90百分位。原始频率统计；缺失日不填充。${s.lateStart?'本指标不足所选'+state.years+'年，仅使用实际覆盖历史。':''}${s.gaps.length?'图中断线代表超过正常发布间隔的缺口。':''}</p><p>${[...new Set([metric.source,...(metric.dependencies||[])])].map(key=>link(state.data.sources[key].url,state.data.sources[key].name)).join(' · ')}</p></section><div class="mh-detail-actions">${button('下载本指标数据 CSV','csv',value,'btn')}</div></div>`);
  }
  function sources() {
    if(!state.data)return;
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle('数据来源与缺口','每个指数与自己的历史对照')}<section class="mh-method"><h3>价格与指标如何对应</h3><p>主图按原始观测日放到同一时间轴。左轴为Yahoo Finance的^GSPC或^NDX美元价格指数，右轴为所选指标原值。悬停和年度期末数值只按同一天配对；未发布、节假日和历史缺口均不补值。双轴各用自己的单位与刻度，曲线的交叉或斜率不能直接说明相关性。</p><h3>观测日期与更新状态</h3><p>历史窗口和分位以报告截至日计算；是否仍可称为当前读数，按设备的北京时间日期另行判断。日频超过10天、周频超过15天、月频超过65天、季频超过140天会标为待更新，保留原数值、图表和末次观测分位，不推进历史统计区间。</p><h3>历史分位与PE</h3><p>分位按所选窗口的原始频率观测计算中位秩，最新值也计入样本。整体法TTM PE采用韭圈同一供应商序列，其公开历史始于2016年10月；不足20年的部分明确留空。供应商定义为成分股市值之和除以最近12个月净利润之和，未公开完整逐股调整和各时点发布版本，不与其他口径的Forward PE拼接。</p><p>${link('https://www.jiucaishuo.com/indicators?tab=index','韭圈估值口径')} · ${link('https://www.cboe.com/tradable_products/vix/vix_historical_data/','Cboe波动率历史')}</p><h3>年度柱状图和数据表</h3><p>自然年度价格涨跌从上一年最后收盘计算到本年最后收盘；当年截至报告日，首年若窗口从年中开始则仅计算窗口内部分，均不年化。回撤取该期间依次发生的收盘峰谷跌幅。指标折线是与期末收盘同日的指标，表中中位数取该期间所有原始指标观测；两者含义不同。价格区间有超过10天的缺口时，不发布该年涨跌与回撤。</p><h3>由真实行情计算的指标</h3><p>实际波动、均线偏离、近一年涨跌、距高点及最大回撤由同一指数收盘按公开公式计算，具体公式见本指标详情。它们不使用盈利估算或价格插值。所有收益均不含分红、税费，不能直接视为ETF持有总回报。</p></section>${state.data.markets.map(m=>`<section class="mh-method"><h3>${m.name} · 仍缺的证据</h3><dl class="mh-withheld">${m.withheld.map(g=>`<div><dt>${esc(g.label)}</dt><dd>${esc(g.reason)}</dd></div>`).join('')}</dl></section>`).join('')}<div class="mh-source-list">${Object.entries(state.data.sources).map(([key,source])=>`<div><b>${link(source.url,source.name)}</b><small>采集 ${source.fetchedAt?new Date(source.fetchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 北京时间':'未记录'}${state.data.refreshFailures?.[key]?' · 刷新失败，保留原日期':''}</small></div>`).join('')}</div></div>`);
  }
  function inspectDate(svg,index) {
    const p=plots.get(svg.dataset.mhPlot);if(!p)return;
    p.index=Math.max(0,Math.min(p.timeline.length-1,index));
    const row=p.timeline[p.index],x=p.x(row.date),panel=svg.closest('.mh-main-chart');
    panel.querySelector('[data-readout-date]').textContent=row.date;
    panel.querySelector('[data-readout-price]').textContent=row.price===null?'无同日观测':fmt(row.price)+' 点';
    panel.querySelector('[data-readout-metric]').textContent=row.value===null?'无同日观测':fmt(row.value)+' '+p.metric.unit;
    const line=svg.querySelector('[data-cursor-line]');line.setAttribute('x1',x);line.setAttribute('x2',x);
    for(const [key,value,y] of [['price',row.price,p.py],['metric',row.value,p.my]]) {
      const dot=svg.querySelector('[data-cursor-'+key+']');dot.setAttribute('visibility',value===null?'hidden':'visible');
      if(value!==null){dot.setAttribute('cx',x);dot.setAttribute('cy',y(value));}
    }
  }
  document.addEventListener('pointermove',event=>{
    const svg=event.target.closest?.('[data-mh-plot]'),p=svg&&plots.get(svg.dataset.mhPlot);if(!p)return;
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const position=point.matrixTransform(svg.getScreenCTM().inverse());
    const fraction=Math.max(0,Math.min(1,(position.x-p.l)/(p.w-p.l-p.r)));
    inspectDate(svg,M.nearestObservation(p.timeline,Date.parse(p.start)+fraction*(Date.parse(p.end)-Date.parse(p.start))));
  });
  document.addEventListener('keydown',event=>{
    const svg=event.target.closest?.('[data-mh-plot]'),p=svg&&plots.get(svg.dataset.mhPlot);if(!p)return;
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    inspectDate(svg,event.key==='Home'?0:event.key==='End'?p.timeline.length-1:p.index+(event.key==='ArrowLeft'?-1:1));
  });
  function selectMetric(value,scroll=false) {
    const market=state.data.markets.find(m=>m.id===state.market);
    if(![...market.metrics,...state.data.context.metrics].some(m=>m.id===value))return;
    state.metric=value;ctx.render();
    if(scroll)document.querySelector('#mh-main-chart')?.scrollIntoView({block:'start'});
    document.querySelector('[data-market-select="metric"]')?.focus({preventScroll:true});
  }
  document.addEventListener('change',event=>{
    if(event.target.matches?.('[data-market-select="metric"]')&&ctx)selectMetric(event.target.value);
  });
  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-market-action]');if(!control||!ctx)return;
    const {marketAction:action,value}=control.dataset;
    if(action==='retry'){load();ctx.render();return;}
    if(action==='sources'){sources();return;}
    if(action==='detail'){detail(value);return;}
    if(action==='print'){window.print();return;}
    if(action==='metric'){selectMetric(value,true);return;}
    if(action==='csv'){
      const {market,metric,s}=find(value);
      if(s)ctx.download(`${market.symbol}-${metric.id}-${state.years}Y-${state.data.asOf}.csv`,M.csv(market,metric,s),'text/csv;charset=utf-8');return;
    }
    if(action==='annual-csv'){
      const {market,metric}=active();ctx.download(`${market.symbol}-${metric.id}-annual-${state.data.asOf}.csv`,M.annualCSV(market,metric,M.annualRows(market,metric,state.data.asOf,state.years)),'text/csv;charset=utf-8');return;
    }
    if(action==='market'&&['spx','ndx'].includes(value)){
      state.market=value;
      if(['vix','vxn'].includes(state.metric))state.metric=value==='spx'?'vix':'vxn';
    }else if(action==='years'&&[5,10,20].includes(+value)){state.years=+value;state.allYears=false;}
    else if(action==='all-years')state.allYears=!state.allYears;
    else return;
    ctx.render();document.querySelector(`[data-market-action="${action}"][data-value="${value}"]`)?.focus({preventScroll:true});
  });
  window.ChanghengMarketHistory={view};
})();
