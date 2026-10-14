(function () {
  'use strict';
  const M = window.ChanghengMarketHistoryModel;
  const state = { years: 20, market: 'all', category: 'all', chart: 'history', horizon: 12, annual: true, sampling: 'monthly', expanded: {}, data: null, loading: false, error: false };
  const categories = { valuation: '估值', risk: '波动与回撤', trend: '价格趋势', macro: '市场环境' };
  const evidenceLabels = { published: '官方发布', calculated: '行情计算', provider: '供应商发布' };
  const frequencies = { daily: '日频', weekly: '周频', monthly: '月频', quarterly: '季频' };
  let ctx, cachedSummaries = new Map(), cachedStudies = new Map();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, n = 2) => Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: n, maximumFractionDigits: n }) : '—';
  const axis = v => Math.abs(v) >= 100 ? fmt(v, 0) : fmt(v, Math.abs(v) < 1 && v !== 0 ? 1 : 0);
  const rankLabel = s => fmt(s.percentile, 1) + '%';
  const rankPeriod = s => s.lateStart ? '可用' + fmt(s.coverageYears, 1) + '年分位' : state.years + '年历史分位';
  const button = (label, action, value = '', cls = '', attrs = '') => `<button type="button" data-market-action="${action}" data-value="${esc(value)}" class="${cls}" ${attrs}>${label}</button>`;
  const link = (url, label) => /^https:\/\//.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
  function summary(market, metric) {
    const key = `${market.id}:${metric.id}:${state.years}`;
    if (!cachedSummaries.has(key)) cachedSummaries.set(key, M.summarize(metric, state.data.asOf, state.years));
    return cachedSummaries.get(key);
  }
  function load() {
    if (state.loading) return;
    state.loading = true; state.error = false;
    fetch(document.querySelector('#market-history-source').dataset.src).then(response => {
      if (!response.ok) throw new Error('Report unavailable');
      return response.json();
    }).then(data => {
      if (data.schemaVersion !== 1 || data.publicationPolicy !== 'research-evidence-v2' || !Array.isArray(data.markets) || !data.context) throw new Error('Invalid report');
      if ([...data.markets, data.context].some(m => m.snapshots?.length || m.metrics.some(metric => !M.eligibleMetric(m.id, metric)))) throw new Error('Unreviewed data');
      state.data = data; cachedSummaries = new Map(); cachedStudies = new Map();
    }).catch(() => { state.error = true; }).finally(() => {
      state.loading = false;
      if (location.hash === '#market-history') ctx.render();
    });
  }
  function group(action, options, current, label) {
    return `<div class="mh-control" role="group" aria-label="${label}">${options.map(([value, text]) => button(text, action, value, String(current) === String(value) ? 'is-active' : '', `aria-pressed="${String(current) === String(value)}"`)).join('')}</div>`;
  }
  function svgLine(metric, s, large = false, pricePath = false) {
    const w = large ? 900 : 480, h = large ? 300 : 178, l = 39, r = 17, t = 16, b = h - 26;
    let min = s.min, max = s.max, padding = (max - min) * .12 || Math.max(Math.abs(max) * .1, 1);
    min -= padding; max += padding;
    const x = d => l + (Date.parse(d) - Date.parse(s.start)) / (Date.parse(s.end) - Date.parse(s.start)) * (w - l - r);
    const y = v => b - (v - min) / (max - min) * (b - t);
    const grid = [s.min, (s.max + s.min) / 2, s.max].map(v => `<line class="mh-gridline" x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 7}" y="${y(v) + 3}" text-anchor="end">${axis(v)}</text>`).join('');
    const series = M.segments(s.points, metric.frequency).map(points => M.downsample(points, large ? 700 : 240)).map(points => points.length > 1 ? `<path class="mh-series" d="${points.map(([d, v], i) => (i ? 'L' : 'M') + x(d).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ')}"/>` : `<circle class="mh-point" cx="${x(points[0][0])}" cy="${y(points[0][1])}" r="2.5"/>`).join('');
    const startYear = +s.start.slice(0, 4), endYear = +s.end.slice(0, 4);
    const years = [startYear, Math.round(startYear + (endYear - startYear) / 2), endYear];
    const dates = [s.start, new Date((Date.parse(s.start)+Date.parse(s.end))/2).toISOString().slice(0,10), s.end];
    const reference = pricePath ? '' : `<rect class="mh-iqr" x="${l}" y="${y(s.p75)}" width="${w-l-r}" height="${Math.max(0,y(s.p25)-y(s.p75))}"/><line class="mh-median" x1="${l}" x2="${w-r}" y1="${y(s.median)}" y2="${y(s.median)}"/>`;
    return `<svg class="mh-plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metric.label)}，${s.start}至${s.end}历史走势，最新${fmt(s.last[1])}${metric.unit}${pricePath?'，观察日归一为100':'，历史分位'+rankLabel(s)}"><title>${esc(metric.label)}</title>
      ${reference}${grid}${series}
      <circle class="mh-current" cx="${x(s.last[0])}" cy="${y(s.last[1])}" r="3.7"/>
      ${dates.map((date, i) => `<text x="${x(date)}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${pricePath?date:years[i]}</text>`).join('')}</svg>`;
  }
  function svgDistribution(metric, s, large = false) {
    const w = large ? 900 : 480, h = large ? 270 : 178, l = 39, r = 17, t = 27, b = h - 26;
    const hist = M.histogram(s.points, large ? 38 : 26), peak = Math.max(...hist.counts);
    const x = v => l + (v - hist.min) / (hist.max - hist.min) * (w - l - r), bar = (w - l - r) / hist.counts.length;
    const currentBin = Math.min(hist.counts.length - 1, Math.floor((s.last[1] - hist.min) / hist.width));
    return `<svg class="mh-plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metric.label)}历史分布，${s.count}个样本，最新${fmt(s.last[1])}${metric.unit}"><title>${esc(metric.label)} · 历史频数分布</title>
      <line class="mh-gridline" x1="${l}" x2="${w - r}" y1="${b}" y2="${b}"/><text x="${l}" y="14">样本占比</text>
      ${hist.counts.map((count, i) => { const height = count / peak * (b - t); return `<rect class="mh-hist-bar${i === currentBin ? ' is-current' : ''}" x="${l + i * bar + 1}" y="${b - height}" width="${Math.max(1, bar - 2)}" height="${height}"/>`; }).join('')}
      <line class="mh-marker" x1="${x(s.last[1])}" x2="${x(s.last[1])}" y1="${t}" y2="${b}"/>
      <text x="${Math.max(l + 26, Math.min(w - r - 26, x(s.last[1])))}" y="18" text-anchor="middle" class="mh-chart-current">最新值</text>
      <text x="${l - 7}" y="${t + 4}" text-anchor="end">${fmt(100 * peak / hist.total, 0)}%</text>
      ${[hist.min, (hist.min + hist.max) / 2, hist.max].map((v, i) => `<text x="${x(v)}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${axis(v)}${i === 2 ? metric.unit : ''}</text>`).join('')}</svg>`;
  }
  function gauge(s) {
    return `<div class="mh-gauge" aria-hidden="true"><span style="left:${Math.max(.7, Math.min(99.3, s.percentile))}%"></span><i></i></div><div class="mh-gauge-labels"><span>0</span><span>历史中位</span><span>100</span></div>`;
  }
  function card(market, metric, index) {
    const s = summary(market, metric);
    if (!s) return '';
    if (s.stale) return `<article class="mh-metric mh-metric-pending" data-metric="${market.id}:${metric.id}"><h3>${esc(metric.label)}</h3><p>当前读数待更新</p><span>最后观测 ${s.last[0]} · 暂不展示当前分位</span></article>`;
    const badges = [s.lateStart ? '起于' + s.points[0][0].slice(0, 7) : '', s.gaps.length ? '历史有缺口' : ''].filter(Boolean);
    const sourceLabel = metric.source.startsWith('jiucai-') ? '韭圈 · 整体法' : metric.source.startsWith('yahoo-') ? 'Yahoo Finance' : metric.source.startsWith('treasury-') ? '美国财政部' : metric.source === 'nfci' ? '芝加哥联储' : 'Cboe';
    return `<article class="mh-metric" data-metric="${market.id}:${metric.id}"><header><div><span class="mh-figure">FIG. ${String(index + 1).padStart(2, '0')} / ${categories[metric.category]}</span><h3>${esc(metric.label)}</h3><p>${esc(metric.english)}<span class="mh-evidence">${evidenceLabels[metric.evidence]}</span></p></div>${button('↗', 'detail', `${market.id}:${metric.id}`, 'mh-expand', `aria-label="查看${market.name}${metric.label}图表与数据"`)}</header>
      <div class="mh-reading"><div><strong>${fmt(s.last[1])}<small>${metric.unit}</small></strong><time datetime="${s.last[0]}">${s.last[0]}${badges.length ? ' <span class="mh-status">' + badges.join(' · ') + '</span>' : ''}</time></div><div class="mh-rank"><span>${rankPeriod(s)}</span><b>${fmt(s.percentile, 1)}<small>%</small></b></div></div>
      ${gauge(s)}${state.chart === 'history' ? svgLine(metric, s) : svgDistribution(metric, s)}
      <footer><span>${sourceLabel} · ${frequencies[metric.frequency]} · ${s.count.toLocaleString()} 个观测</span><span>中位 ${fmt(s.median)}${metric.unit}</span></footer></article>`;
  }
  const pct = v => Number.isFinite(v) ? (v > 0 ? '+' : '') + fmt(v, 1) + '%' : '—';
  const outcomeLabel = a => a.kind === 'risk' ? '随后21日实际波动 / 年化%' : `随后${a.months/12}年${a.annual?'年化':'累计'}价格收益 / %`;
  function analysis(market, kind='valuation') {
    const key = `${market.id}:${kind}:${state.years}:${state.horizon}:${state.annual}:${state.sampling}`;
    if (!cachedStudies.has(key)) cachedStudies.set(key, M.relationship(market,state.data.asOf,state.years,{kind,months:state.horizon,annual:state.annual,sampling:state.sampling}));
    return cachedStudies.get(key);
  }
  function bandLabel(b, unit='') {
    if (!Number.isFinite(b.lo) || b.lo===0) return `<${axis(b.hi)}${unit}`;
    if (!Number.isFinite(b.hi)) return `≥${axis(b.lo)}${unit}`;
    return `${axis(b.lo)}–<${axis(b.hi)}${unit}`;
  }
  function scatter(market,a) {
    const w=720,h=480,l=60,r=20,t=32,b=428;
    const values=a.events.map(e=>e.value), outcomes=a.events.map(e=>e.outcome);
    if (!values.length) return '<p class="mh-unavailable">此观察窗没有走完持有期的样本。</p>';
    const xMin=Math.max(0,Math.min(...values,a.current.value)-2), xMax=Math.max(...values,a.current.value)+2;
    const yMin=Math.min(0,...outcomes),yMax=Math.max(0,...outcomes),pad=(yMax-yMin)*.08||1;
    const low=a.kind==='risk'?0:yMin-pad,high=yMax+pad;
    const x=v=>l+(v-xMin)/(xMax-xMin)*(w-l-r),y=v=>b-(v-low)/(high-low)*(b-t);
    const ticks=Array.from({length:5},(_,i)=>low+(high-low)*i/4);
    const grid=ticks.map(v=>`<line class="mh-gridline" x1="${l}" x2="${w-r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l-10}" y="${y(v)+4}" text-anchor="end">${fmt(v,0)}%</text>`).join('');
    const band=a.bands[a.currentBand],bx0=x(Math.max(xMin,band.lo)),bx1=x(Math.min(xMax,band.hi));
    const line=a.fit?`<path class="mh-fit" d="M${x(Math.min(...values))},${y(a.fit.intercept+a.fit.slope*Math.min(...values))} L${x(Math.max(...values))},${y(a.fit.intercept+a.fit.slope*Math.max(...values))}"/>`:'';
    const identity=a.kind==='risk'?`<path class="mh-equality" d="M${x(Math.max(xMin,low))},${y(Math.max(xMin,low))} L${x(Math.min(xMax,high))},${y(Math.min(xMax,high))}"/>`:'';
    const sorted=a.events.map((e,index)=>({...e,index})).sort((u,v)=>(u.band===a.currentBand)-(v.band===a.currentBand));
    const dots=sorted.map(e=>`<circle class="mh-scatter-dot ${e.band===a.currentBand?'is-matched':''}" cx="${x(e.value)}" cy="${y(e.outcome)}" r="4" tabindex="0" role="button" data-market-action="observation" data-value="${market.id}:${a.kind}:${e.index}" aria-label="${e.date}，${a.metric.label}${fmt(e.value)}，${outcomeLabel(a)} ${fmt(e.outcome)}，查看价格路径"><title>${e.date} → ${e.exitDate}&#10;${a.metric.label} ${fmt(e.value)}${a.metric.unit}&#10;${outcomeLabel(a)} ${fmt(e.outcome,1)}%</title></circle>`).join('');
    const clip=`mh-scatter-${market.id}-${a.kind}`;
    return `<svg class="mh-scatter" viewBox="0 0 ${w} ${h}" role="group" aria-label="${market.name}，横轴${a.metric.label}，纵轴${outcomeLabel(a)}；每个点可查看该期价格路径"><title>${a.metric.label}与后续实际表现</title><defs><clipPath id="${clip}"><rect x="${l}" y="${t}" width="${w-l-r}" height="${b-t}"/></clipPath></defs><text x="${l}" y="16">${outcomeLabel(a)}</text><rect class="mh-state-band" x="${bx0}" y="${t}" width="${Math.max(0,bx1-bx0)}" height="${b-t}"/>${grid}<line class="mh-zero" x1="${l}" x2="${w-r}" y1="${y(0)}" y2="${y(0)}"/><g clip-path="url(#${clip})">${identity}${line}${dots}</g><line class="mh-marker" x1="${x(a.current.value)}" x2="${x(a.current.value)}" y1="${t}" y2="${b}"/><text class="mh-chart-current" x="${Math.max(l+70,Math.min(w-r-70,x(a.current.value)))}" y="${t+14}" text-anchor="middle">当前 ${fmt(a.current.value)}${a.metric.unit}</text>${Array.from({length:5},(_,i)=>xMin+(xMax-xMin)*i/4).map(v=>`<text x="${x(v)}" y="${b+21}" text-anchor="middle">${fmt(v,0)}</text>`).join('')}<text x="${(l+w-r)/2}" y="${h-5}" text-anchor="middle">月末${a.metric.label} / ${a.metric.unit}</text></svg>`;
  }
  function buckets(a) {
    const valid=a.bands.filter(b=>b.count),lo=Math.min(0,...valid.map(b=>b.q25)),hi=Math.max(1,...valid.map(b=>b.q75)),scale=v=>100*(v-lo)/(hi-lo);
    return `<div class="mh-buckets"><div class="mh-bucket-head"><b>按起始读数分组</b><span>中位数 · 中间50%区间</span></div>${a.bands.map(b=>`<div class="mh-bucket ${b.current?'is-current':''}"><span>${esc(bandLabel(b,a.metric.unit))}${b.current?'<small>当前所在</small>':''}</span><div class="mh-bucket-track">${b.count?`<i style="left:${scale(b.q25)}%;width:${Math.max(.5,scale(b.q75)-scale(b.q25))}%"></i><b style="left:${scale(b.median)}%"></b>`:'<em>无样本</em>'}<s style="left:${scale(0)}%"></s></div><strong>${b.count?(a.kind==='risk'?fmt(b.median,1)+'%':pct(b.median)):'—'}</strong><small>${b.count||0}期</small></div>`).join('')}<div class="mh-bucket-scale"><span>${pct(lo)}</span><span>${pct(hi)}</span></div></div>`;
  }
  function relationSection(market,kind) {
    const a=analysis(market,kind), risk=kind==='risk';
    if(a.error)return `<section class="mh-relation" data-relation="${market.id}:${kind}"><h3>${risk?'波动与持有风险':'估值与后续收益'}</h3><p class="mh-unavailable">${esc(a.error)}，暂停此项分析。</p></section>`;
    const s=a.matchedStats, band=a.bands[a.currentBand];
    const title=risk?'隐含波动与随后实际波动':`起始估值与后续${a.months/12}年收益`;
    const period=risk?'21个交易日':`${a.months/12}年`;
    const coverageYears=(Date.parse(a.coverageEnd)-Date.parse(a.coverageStart))/86400000/365.2425;
    const short=coverageYears<state.years-.2;
    const fit=a.fit?`R² ${fmt(a.fit.r2*100,1)}%`:'不足以拟合';
    const sub=risk?`${a.metric.id.toUpperCase()} ${fmt(a.current.value)} · 历史${fmt(a.percentile,1)}%分位`:`整体法TTM PE ${fmt(a.current.value)}倍 · 历史${fmt(a.percentile,1)}%分位`;
    const summaryText=s?risk?`相同波动区间之后，实际年化波动中位为 ${fmt(s.median,1)}%。`: `PE ${bandLabel(band,'倍')}的月份，随后${period}${a.annual?'年化':'累计'}收益中位 ${pct(s.median)}。`:'当前读数所在组尚无完整结果。';
    const interpretation=risk?'用于评估短期持有风险；波动大小不等于涨跌方向。':'用于观察估值与持有期的关系；图中历史收益不能直接作为当前买入的预期收益。';
    return `<section class="mh-relation" data-relation="${market.id}:${kind}"><header class="mh-relation-head"><div><span class="mh-figure">${risk?'02 / RISK CALIBRATION':'01 / VALUATION & RETURN'}</span><h3>${title}</h3><p>${sub}<time>${a.current.date}</time></p></div><div class="mh-fit-stat"><strong>${fit}</strong><span>历史线性拟合 · 非预测准确率</span></div></header><div class="mh-relation-grid"><div><div class="mh-chart-legend"><span><i class="mh-dot-key"></i>历史月份</span><span><i class="mh-dot-key is-gold"></i>当前读数所在组</span>${a.fit?'<span><i class="mh-fit-key"></i>线性拟合</span>':''}${risk?'<span><i class="mh-fit-key is-dashed"></i>相同年化波动</span>':''}</div>${scatter(market,a)}<p class="mh-chart-note">${short?`实际覆盖 ${a.coverageStart.slice(0,7)} 起约${fmt(coverageYears,1)}年；`:''}${a.events.length}个${a.sampling==='monthly'?`月度观察 · 其中可取${a.disjointCount}段不重叠窗口`:'不重叠窗口'}。${a.events.length?'点选圆点可查看当期价格路径。':''}</p></div><aside class="mh-relation-reading"><span class="mh-kicker">当前所在区间 · ${esc(bandLabel(band,a.metric.unit))}</span><h4>${esc(summaryText)}</h4>${s?`<dl class="mh-evidence-numbers"><div><dt>${risk?'实际波动':'收益'}中间50%</dt><dd>${risk?fmt(s.q25,1)+'%':pct(s.q25)} <small>至</small> ${risk?fmt(s.q75,1)+'%':pct(s.q75)}</dd></div><div><dt>${risk?'随后21日':'持有期末'}亏损月份</dt><dd>${s.losses}<small> / ${s.count} · ${fmt(s.lossRate,1)}%</small></dd></div></dl>`:''}${buckets(a)}<p class="mh-implication">${interpretation}${a.matchedDisjointCount<12?` 当前组仅可取${a.matchedDisjointCount}段不重叠窗口，样本有限。`:''}</p></aside></div><footer class="mh-relation-foot"><span>${risk?'Cboe；实际波动由同一指数收盘计算':'韭圈整体法PE；Yahoo指数价格'} · 样本月末 ${a.sampleStart||'—'} — ${a.sampleEnd||'—'}</span>${button('样本与口径 ↗','research-samples',market.id+':'+kind,'mh-text-button')}</footer></section>`;
  }
  function marketSection(market) {
    const metrics=market.metrics.filter(m=>M.eligibleMetric(market.id,m));
    const grid=`<div class="mh-grid">${metrics.map(m=>card(market,m,market.metrics.indexOf(m))).join('')}</div>`;
    const chartControl=group('chart',[['history','历史走势'],['distribution','历史分布']],state.chart,'指标图表类型');
    return `<section class="mh-market" aria-labelledby="mh-${market.id}-title"><header class="mh-market-head"><div class="mh-market-name"><span class="mh-section-no">${market.id==='spx'?'01':market.id==='ndx'?'02':'03'}</span><div><h2 id="mh-${market.id}-title">${market.name}<span>${market.english}</span></h2><p>${market.id==='macro'?'共同市场背景':'与自身历史对照 · 美元价格指数，不含分红'}</p></div></div>${market.close?`<div class="mh-index-price"><strong>${fmt(market.close.value)}<small>点</small></strong><span>收盘 ${market.close.date}</span></div>`:''}</header>${market.id==='macro'?`<div class="mh-indicator-controls">${chartControl}</div>${grid}`:relationSection(market,'valuation')+relationSection(market,'risk')+`<details class="mh-indicators" data-indicator-details="${market.id}" ${state.expanded[market.id]?'open':''}><summary><span>历史分位与原始序列</span><small>${metrics.length}项 · 查看长期走势</small></summary><div class="mh-indicator-controls">${chartControl}</div>${grid}</details>`}</section>`;
  }
  function briefing(markets) {
    return `<div class="mh-briefing">${markets.map(m=>{
      const a=analysis(m),r=analysis(m,'risk');
      if(a.error||r.error)return `<article><h3>${m.name}</h3><p>${esc(a.error||r.error)}</p></article>`;
      if(!a.events.length)return `<article><span>${m.name} / 研究摘要</span><h3>该窗口没有完整的${a.months/12}年收益样本</h3><p>扩大历史观察窗，或缩短后续持有期后查看；未完成的持有区间不计入收益统计。</p></article>`;
      const weak=a.fit&&a.fit.r2<.15;
      return `<article><span>${m.name} / 研究摘要</span><h3>${weak?'估值分位不能直接转成收益预期':`先看${a.months/12}年收益分布，再判断估值意义`}</h3><p>当前整体法PE处于可用历史的 <b>${fmt(a.percentile,1)}%</b> 分位。起始PE与随后${a.months/12}年收益的线性拟合R²为 <b>${a.fit?fmt(a.fit.r2*100,1)+'%':'—'}</b>；${r.metric.id.toUpperCase()}与随后实际波动的拟合R²为 <b>${r.fit?fmt(r.fit.r2*100,1)+'%':'—'}</b>。</p><small>两种关系的结果变量不同，R²只描述各自历史，不能据此比较投资优劣。</small></article>`;
    }).join('')}</div>`;
  }
  function view(context) {
    ctx=context;
    const header=`<header class="mh-report-head"><div><div class="eyebrow">VALUATION, RETURN & RISK / 长衡研究</div><h1>美股历史研究</h1><p>当前估值处在何处，历史回报如何，持有需要承担多大波动。</p></div><div class="mh-report-meta"><span>RESEARCH MONITOR</span><b>${state.data?.asOf||'—'}</b>${button('数据与口径 ↗','sources','','mh-text-button')}</div></header>`;
    if(!state.data){if(!state.loading&&!state.error)load();return header+`<div class="mh-loading" role="status">${state.error?'历史数据加载失败。'+button('重新加载','retry','','btn'):'正在载入历史观测数据…'}</div>`;}
    const markets=state.market==='macro'?[state.data.context]:state.data.markets.filter(m=>state.market==='all'||state.market===m.id);
    return `<div class="mh-report">${header}<div class="mh-toolbar"><div class="mh-control-block"><span>观察对象</span>${group('market',[['all','两个指数'],['spx','标普500'],['ndx','纳斯达克100'],['macro','市场环境']],state.market,'选择指数或市场环境')}</div><div class="mh-control-block"><span>历史窗口</span>${group('years',[[5,'5年'],[10,'10年'],[20,'20年']],state.years,'历史区间')}</div></div>${state.market!=='macro'?`<div class="mh-research-controls"><div><span>后续持有期</span>${group('research-horizon',[[12,'1年'],[36,'3年'],[60,'5年']],state.horizon,'后续持有期')}</div>${group('research-annual',[[1,'年化收益'],[0,'累计收益']],state.annual?1:0,'收益口径')}${group('research-sampling',[['monthly','月度样本'],['disjoint','不重叠窗口']],state.sampling,'历史样本方式')}</div><p class="mh-data-gap">PE公开历史始于2016年10月，采用韭圈整体法TTM口径，未提供各时点的发布版本；月度结果可能重叠，属于历史关系分析。</p>${briefing(markets)}`:'<p class="mh-data-gap">NFCI为修订后历史，仅作市场背景。</p>'}${markets.map(marketSection).join('')}<footer class="mh-report-foot"><span>长衡研究 / ${state.years}年观察窗</span><span>美元价格收益，不含分红、税费；历史分布不代表未来收益或风险上限。</span>${button('打印 / 保存PDF','print','','mh-text-button')}</footer></div>`;
  }
  function researchSamples(value) {
    const [id,kind]=value.split(':'),market=state.data.markets.find(m=>m.id===id),a=market&&analysis(market,kind);
    if(!a||a.error)return;
    const pe=kind==='valuation';
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle(esc(market.name+' · '+(pe?'估值与后续收益':'隐含与实际波动')),outcomeLabel(a))}<section class="mh-method"><h3>一行样本如何对应</h3><p>在每个已结束月份的最后交易日，严格匹配同日指标与指数收盘。${pe?`从该日收盘到${a.months}个日历月后月末收盘，计算价格收益。年化按两个实际日期间的天数 / 365.2425计算。`:'用其后21个交易日收盘对数收益的样本标准差 × √252，计算年化实际波动；它与Cboe定价的未来30个日历日并非完全相同期限。'}只保留截至报告日已完整结束的窗口；超过10日的行情断档剔除。不用ETF或总回报替代指数价格。</p><h3>样本与统计</h3><p>${a.monthlyCount}个月度结果，最多按时间顺序选出${a.disjointCount}段不重叠窗口；当前展示${a.events.length}项。${a.incomplete}个月份尚未走完整个持有期，${a.gaps}项行情有缺口。月度样本的持有区间可能重叠，不能视为相互独立；不重叠窗口共享起止收盘，但不共享收益区间，其结果受首个入选月份影响。</p><p>R²是横轴读数对纵轴结果的一元线性拟合解释度，不是预测准确率，不提供显著性或因果证明。分组区间预先固定，未以收益优化。横轴当前值仅标位置，没有给当前值放置“预测收益点”。中间50%为样本25%—75%分位，非预测置信区间。</p><h3>数据口径与缺口</h3><p>${esc(a.metric.basis)}</p>${pe?`<p>${esc(a.metric.limitations)} 这属于现存历史的描述分析，不是点时可交易策略。当前与历史都采用同一供应商序列；没有用其他供应商的Forward PE计算盈利增速。</p>`:''}<p>来源：${link(state.data.sources[a.metric.source].url,state.data.sources[a.metric.source].name)}；${link(state.data.sources[market.prices.source].url,'Yahoo Finance · '+market.symbol)}。实际指标覆盖 ${a.coverageStart} — ${a.coverageEnd}；本次纳入的信号日 ${a.sampleStart||'—'} — ${a.sampleEnd||'—'}。</p></section><h3>全部对应样本 · ${a.events.length}项</h3><div class="mh-sample-table-wrap"><table class="mh-sample-table"><thead><tr><th>观察月末</th><th>指标读数</th><th>结束日期</th><th>${pe?(a.annual?'年化收益':'累计收益'):'实际年化波动'}</th><th>途中最大回撤</th></tr></thead><tbody>${a.events.map(e=>`<tr><td>${e.date}</td><td>${fmt(e.value)}</td><td>${e.exitDate}</td><td>${pe?pct(e.outcome):fmt(e.outcome,1)+'%'}</td><td>${pct(e.drawdownPct)}</td></tr>`).join('')||'<tr><td colspan="5">没有完整样本</td></tr>'}</tbody></table></div><div class="mh-detail-actions">${button('下载对应样本 CSV','research-csv',value,'btn')}</div></div>`);
  }
  function observation(value) {
    const [id,kind,index]=value.split(':'),market=state.data.markets.find(m=>m.id===id),a=market&&analysis(market,kind),e=a?.events?.[+index];
    if(!e)return;
    const points=market.prices.points.filter(p=>p[0]>=e.entryDate&&p[0]<=e.exitDate).map(([d,p])=>[d,100*p/e.entryPrice]);
    const plotMetric={label:'这一个历史样本的价格路径',unit:'',frequency:'daily',points};
    const s={...M.summarize(plotMetric,e.exitDate,20),start:e.entryDate,end:e.exitDate};
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle(market.name+' · '+e.date+'的实际路径','以观察日收盘为100 · 美元价格指数 · 不含分红')}<div class="mh-detail-summary"><div><span>${esc(a.metric.label)} · ${e.date}</span><strong>${fmt(e.value)}<small>${a.metric.unit}</small></strong></div><div><span>随后累计价格收益</span><strong>${pct(e.returnPct)}</strong></div><div><span>途中最大回撤</span><strong>${pct(e.drawdownPct)}</strong></div></div>${svgLine(plotMetric,s,true,true)}<p class="mh-method">起点 ${e.entryDate}：${fmt(e.entryPrice)}点；终点 ${e.exitDate}：${fmt(e.exitPrice)}点。${a.kind==='risk'?'随后21日实际年化波动 '+fmt(e.realizedVol,1)+'%。':'对应年化价格收益 '+pct(e.annualizedPct)+'。'}这是图中单个历史点的已实现路径。</p></div>`);
  }
  function find(value) {
    const [id, key] = value.split(':'), market = [...state.data.markets, state.data.context].filter(Boolean).find(m => m.id === id);
    const metric = market?.metrics.find(m => m.id === key && M.eligibleMetric(market.id, m));
    return { market, metric, s: metric && summary(market, metric) };
  }
  function detail(value) {
    const { market, metric, s } = find(value);
    if (!s) return;
    const source = state.data.sources[metric.source];
    const stats = [['最新值', s.last[1]], ['历史最低', s.min], ['10%分位', s.p10], ['25%分位', s.p25], ['历史中位', s.median], ['75%分位', s.p75], ['90%分位', s.p90], ['历史最高', s.max]];
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle(esc(market.name + ' · ' + metric.label), metric.english + ' / ' + s.start + ' — ' + s.end)}<div class="mh-detail-summary"><div><span>最新可得 · ${s.last[0]}</span><strong>${fmt(s.last[1])}<small>${metric.unit}</small></strong></div><div><span>${rankPeriod(s)}</span><strong>${rankLabel(s)}</strong></div><div><span>有效观测 · ${frequencies[metric.frequency]}</span><strong>${s.count.toLocaleString()}</strong></div></div>
      <h3>历史走势 <span>阴影为25%—75%区间 · 虚线为中位数</span></h3>${svgLine(metric, s, true)}<h3>历史分布 <span>竖线为最新值 · 纵轴为样本占比</span></h3>${svgDistribution(metric, s, true)}
      <dl class="mh-statistics">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${fmt(v)}<small>${metric.unit}</small></dd></div>`).join('')}</dl>
      <section class="mh-method"><h3>口径与来源</h3><p>${esc(metric.basis)}</p>${metric.limitations?`<p>${esc(metric.limitations)}</p>`:''}<p>实际样本：${s.points[0][0]} — ${s.last[0]}。${s.lateStart ? `历史不足${state.years}年，分位仅基于可用的${fmt(s.coverageYears, 1)}年。` : ''}${s.stale ? `最新观测距报告日 ${s.lagDays} 天。` : ''}${s.gaps.length ? `历史序列有 ${s.gaps.length} 处超过正常发布间隔的缺口，图中断线显示。` : ''}</p><p>分位 =（低于最新值的样本数 + 相同值样本数 × 0.5）÷ 有效样本数。保留原始发布频率，不补齐缺失日。</p><p>${[...new Set([metric.source, ...(metric.dependencies || [])])].map(key => link(state.data.sources[key].url, state.data.sources[key].name)).join(' · ')}${metric.attribution ? ' · ' + esc(metric.attribution) : ''}</p></section><div class="mh-detail-actions">${button('下载本指标数据 CSV', 'csv', value, 'btn')}</div></div>`);
  }
  function sources() {
    if(!state.data)return;
    const withheld=state.data.markets.map(m=>`<section class="mh-method"><h3>${esc(m.name)} · 尚缺的证据</h3><dl class="mh-withheld">${m.withheld.map(g=>`<div><dt>${esc(g.label)}</dt><dd>${esc(g.reason)}</dd></div>`).join('')}</dl></section>`).join('');
    const sourceList=Object.entries(state.data.sources).map(([key,source])=>`<div><b>${link(source.url,source.name)}</b><span>${esc(key)}</span><small>采集 ${source.fetchedAt?new Date(source.fetchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 北京时间':'未记录'}${state.data.refreshFailures?.[key]?' · 本次刷新失败，保留旧观测':''}</small></div>`).join('');
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle('数据来源与研究口径','指数身份、观测日期与数据提供方分开记录')}<section class="mh-method"><h3>整体法TTM PE：供应商发布序列</h3><p>来源为韭圈，标普500代码SPX.GI、纳斯达克100代码NDX.GI。其公开定义为成分股市值之和除以成分股过去12个月净利润之和。当前与历史均来自同一公开序列，没有以ETF替代，也没有从图片读点或插值补齐。</p><p>该序列与其他供应商的指数加权PE可能不同。公开接口没有逐成分股财报、GAAP调整清单、亏损股处理明细及各历史时点的发布版本，因此本页按“供应商发布”展示，用于描述现存历史关系，不能称为已独立审计的数据或当时可执行的回测。</p><p>历史始于2016年10月，当前只能覆盖约10年。当前末值与同供应商独立快照接口进行同日校对，这是接口一致性检查，不是对所有财报的独立核验。超过10天未更新会暂停当前读数。${link('https://www.jiucaishuo.com/indicators?tab=index','韭圈估值与公式说明')}</p><h3>为什么没有同时给Forward PE与盈利归因</h3><p>预期PE本身包含未来盈利预测；预测值与错误数据是两回事。旧版把不同日期、不同供应商的TTM与Forward放在一起，无法用差值解释盈利增长。现在尚缺日期、财报调整和指数聚合口径相容的预期盈利历史，故未据PE反推“真实EPS”，也没有把行情涨幅硬拆成盈利贡献。</p><h3>波动与价格</h3><p>VIX与VXN取Cboe官方收盘，分别对应标普500和纳斯达克100期权的未来30日年化隐含波动。指数价格为Yahoo Finance的^GSPC、^NDX美元价格指数；实际波动、均线和回撤均由同一价格序列计算。价格收益未计分红、税费。Finviz只用于最近收盘交叉检查，不作为基本面来源。</p><h3>统计如何阅读</h3><p>横轴是历史月末的指标，纵轴是该月末之后实际发生的结果。金色竖线只标当前读数；没有当前“预测收益点”。收益观察期为1、3、5个日历年，风险图固定观察之后21个交易日。仅使用同日配对、完整结束且没有行情断档的样本。</p><p>月度持有窗口可能重叠；可以切换不重叠窗口检查敏感性。R²是历史样本内线性拟合解释度，不是预测准确率，也没有完成样本外策略检验。分组的中间50%表示历史样本四分位区间，不是预测置信区间。历史分位使用原始频率观测的中位秩，不补齐缺失日。</p><h3>研报参照</h3><p>${link('https://am.jpmorgan.com/content/dam/jpm-am-aem/global/en/insights/market-insights/guide-to-the-markets/mi-guide-to-the-markets-us.pdf','摩根资管 Guide to the Markets，第6–7页')}：起始估值与后续回报、盈利增长贡献。${link('https://www.nasdaq.com/docs/biweekly-investment-insights-what-to-do-what-to-do','Nasdaq Biweekly Investment Insights，第2页')}：NDX预期PE与后续1年、5年价格收益。${link('https://www.aqr.com/insights/research/white-papers/driving-with-the-rear-view-mirror','AQR Driving with the Rear-View Mirror')}：回报来源拆解。页面采用问题与证据对应的分析结构；没有把这些研报的回报数字当成本页统计。</p></section>${withheld}<div class="mh-source-list">${sourceList}</div></div>`);
  }
  document.addEventListener('toggle', event => {
    const id = event.target.dataset?.indicatorDetails;
    if (id) state.expanded[id] = event.target.open;
  }, true);
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.mh-scatter-dot')) {
      event.preventDefault(); observation(event.target.dataset.value);
    }
  });
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-market-action]');
    if (!control || !ctx) return;
    const { marketAction: action, value } = control.dataset;
    if (action === 'retry') { load(); ctx.render(); return; }
    if (action === 'sources') { sources(); return; }
    if (action === 'detail') { detail(value); return; }
    if (action === 'research-samples') { researchSamples(value); return; }
    if (action === 'observation') { observation(value); return; }
    if (action === 'research-csv') {
      const [id,kind]=value.split(':'),market=state.data.markets.find(m=>m.id===id),a=analysis(market,kind);
      ctx.download(`${market.symbol}-${kind}-${state.horizon}M-${state.data.asOf}.csv`,M.relationshipCSV(market,a),'text/csv;charset=utf-8'); return;
    }
    if (action.startsWith('research-')) {
      if (action==='research-horizon' && [12,36,60].includes(+value)) state.horizon=+value;
      else if (action==='research-annual') state.annual=value==='1';
      else if (action==='research-sampling' && ['monthly','disjoint'].includes(value)) state.sampling=value;
      else return;
      ctx.render();
      document.querySelector(`[data-market-action="${action}"][data-value="${value}"]`)?.focus({preventScroll:true}); return;
    }
    if (action === 'csv') {
      const { market, metric, s } = find(value);
      ctx.download(`${market.symbol}-${metric.id}-${state.years}Y-${state.data.asOf}.csv`, M.csv(market, metric, s), 'text/csv;charset=utf-8'); return;
    }
    if (action === 'print') { window.print(); return; }
    if (!['years', 'market', 'category', 'chart'].includes(action)) return;
    state[action] = action === 'years' ? +value : value;
    if (action === 'market' && value === 'macro') state.category = 'all';
    if (action === 'market' && value !== 'macro' && state.category === 'macro') state.category = 'all';
    if (action === 'category' && value === 'macro') state.market = 'macro';
    if (action === 'category' && value !== 'macro' && value !== 'all' && state.market === 'macro') state.market = 'all';
    ctx.render();
    document.querySelector(`[data-market-action="${action}"][data-value="${value}"]`)?.focus({ preventScroll: true });
  });
  window.ChanghengMarketHistory = { view };
})();
