(function () {
  'use strict';
  const M = window.ChanghengMarketHistoryModel;
  const state = { years: 20, market: 'all', category: 'all', chart: 'history', modes: {}, horizons: {}, expanded: {}, cursors: {}, data: null, loading: false, error: false };
  const categories = { risk: '波动与回撤', trend: '价格趋势', macro: '市场环境' };
  const evidenceLabels = { published: '官方发布', calculated: '行情计算' };
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
      if (data.schemaVersion !== 1 || data.publicationPolicy !== 'core-evidence-v1' || !Array.isArray(data.markets) || !data.context) throw new Error('Invalid report');
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
  function svgLine(metric, s, large = false) {
    const w = large ? 900 : 480, h = large ? 300 : 178, l = 39, r = 17, t = 16, b = h - 26;
    let min = s.min, max = s.max, padding = (max - min) * .12 || Math.max(Math.abs(max) * .1, 1);
    min -= padding; max += padding;
    const x = d => l + (Date.parse(d) - Date.parse(s.start)) / (Date.parse(s.end) - Date.parse(s.start)) * (w - l - r);
    const y = v => b - (v - min) / (max - min) * (b - t);
    const grid = [s.min, (s.max + s.min) / 2, s.max].map(v => `<line class="mh-gridline" x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 7}" y="${y(v) + 3}" text-anchor="end">${axis(v)}</text>`).join('');
    const series = M.segments(s.points, metric.frequency).map(points => M.downsample(points, large ? 700 : 240)).map(points => points.length > 1 ? `<path class="mh-series" d="${points.map(([d, v], i) => (i ? 'L' : 'M') + x(d).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ')}"/>` : `<circle class="mh-point" cx="${x(points[0][0])}" cy="${y(points[0][1])}" r="2.5"/>`).join('');
    const startYear = +s.start.slice(0, 4), endYear = +s.end.slice(0, 4);
    const years = [startYear, Math.round(startYear + (endYear - startYear) / 2), endYear];
    const dates = [s.start, `${years[1]}-01-01`, s.end];
    return `<svg class="mh-plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metric.label)}，${s.start}至${s.end}历史走势，最新${fmt(s.last[1])}${metric.unit}，历史分位${rankLabel(s)}"><title>${esc(metric.label)} · ${state.years}年历史走势</title>
      <rect class="mh-iqr" x="${l}" y="${y(s.p75)}" width="${w - l - r}" height="${Math.max(0, y(s.p25) - y(s.p75))}"/>${grid}
      <line class="mh-median" x1="${l}" x2="${w - r}" y1="${y(s.median)}" y2="${y(s.median)}"/>${series}
      <circle class="mh-current" cx="${x(s.last[0])}" cy="${y(s.last[1])}" r="3.7"/>
      ${years.map((year, i) => `<text x="${x(dates[i])}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${year}</text>`).join('')}</svg>`;
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
    const sourceLabel = metric.source.startsWith('yahoo-') ? 'Yahoo Finance' : metric.source.startsWith('treasury-') ? '美国财政部' : metric.source === 'nfci' ? '芝加哥联储' : 'Cboe';
    return `<article class="mh-metric" data-metric="${market.id}:${metric.id}"><header><div><span class="mh-figure">FIG. ${String(index + 1).padStart(2, '0')} / ${categories[metric.category]}</span><h3>${esc(metric.label)}</h3><p>${esc(metric.english)}<span class="mh-evidence">${evidenceLabels[metric.evidence]}</span></p></div>${button('↗', 'detail', `${market.id}:${metric.id}`, 'mh-expand', `aria-label="查看${market.name}${metric.label}图表与数据"`)}</header>
      <div class="mh-reading"><div><strong>${fmt(s.last[1])}<small>${metric.unit}</small></strong><time datetime="${s.last[0]}">${s.last[0]}${badges.length ? ' <span class="mh-status">' + badges.join(' · ') + '</span>' : ''}</time></div><div class="mh-rank"><span>${rankPeriod(s)}</span><b>${fmt(s.percentile, 1)}<small>%</small></b></div></div>
      ${gauge(s)}${state.chart === 'history' ? svgLine(metric, s) : svgDistribution(metric, s)}
      <footer><span>${sourceLabel} · ${frequencies[metric.frequency]} · ${s.count.toLocaleString()} 个观测</span><span>中位 ${fmt(s.median)}${metric.unit}</span></footer></article>`;
  }
  const periodLabel = sessions => ({21:'1个月',63:'3个月',126:'6个月',252:'12个月'})[sessions];
  const pct = v => Number.isFinite(v) ? (v > 0 ? '+' : '') + fmt(v, 1) + '%' : '—';
  function analysis(market) {
    const mode = state.modes[market.id] || 'joint', key = `${market.id}:${mode}:${state.years}`;
    if (!cachedStudies.has(key)) cachedStudies.set(key, M.study(market, state.data.asOf, state.years, mode));
    return cachedStudies.get(key);
  }
  function conditionText(c) {
    const name = {vix:'VIX',vxn:'VXN',rv21:'实际波动率',drawdown:'距一年高点',ma200:'均线偏离'}[c.id];
    const unit = c.unit;
    const band = !Number.isFinite(c.lo) ? `< ${axis(c.hi)}${unit}` : !Number.isFinite(c.hi) ? `≥ ${axis(c.lo)}${unit}` : `${axis(c.lo)} 至 < ${axis(c.hi)}${unit}`;
    return `${name} ${band}`;
  }
  function cursorReadout(a, index) {
    const point = a.timeline[index];
    if (!point) return '';
    return `<time>${point.date}</time><span>指数 <b>${fmt(point.price)}</b></span>${a.metrics.map((m,i) => `<span>${esc(m.id.toUpperCase().replace('MA200','均线偏离').replace('RV21','实际波动率').replace('DRAWDOWN','距一年高点'))} <b>${fmt(point.values[i])}${Number.isFinite(point.values[i]) ? m.unit : ''}</b></span>`).join('')}`;
  }
  function linkedChart(market, a, result, cursorIndex) {
    const width = 660, left = 58, right = 17, bottom = 178 + a.metrics.length * 102, height = bottom + 25;
    const x = d => left + (Date.parse(d)-Date.parse(a.start))/(Date.parse(a.end)-Date.parse(a.start))*(width-left-right);
    const panels = [{label:'价格指数 · 对数刻度', points:a.prices, top:28, base:164, log:true},
      ...a.metrics.map((m,i)=>({label:m.label + ' / ' + m.unit, points:m.points.filter(p=>p[0]>=a.start && p[0]<=a.end), top:204+i*102, base:264+i*102, condition:a.conditions[i]}))];
    let content = '';
    for (const panel of panels) {
      if (!panel.points.length) continue;
      const values = panel.points.map(p=>p[1]), low = Math.min(...values), high = Math.max(...values);
      const transform = v => panel.log ? Math.log(v) : v;
      const pad = (transform(high)-transform(low))*.08 || 1, lo = transform(low)-pad, hi = transform(high)+pad;
      const y = v => panel.base-(transform(v)-lo)/(hi-lo)*(panel.base-panel.top);
      const ticks = [low, panel.log ? Math.sqrt(low*high) : (low+high)/2, high];
      content += `<text class="mh-linked-label" x="${left}" y="${panel.top-10}">${esc(panel.label)}</text>`;
      if (panel.condition) {
        const c = panel.condition, bandLow = Math.max(low,c.lo), bandHigh = Math.min(high,c.hi);
        if (bandHigh>=bandLow) content += `<rect class="mh-state-band" x="${left}" y="${y(bandHigh)}" width="${width-left-right}" height="${Math.max(1,y(bandLow)-y(bandHigh))}"/>`;
      }
      content += ticks.map(v=>`<line class="mh-gridline" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${axis(v)}</text>`).join('');
      content += M.segments(panel.points,'daily').map(points=>`<path class="mh-series" d="${M.downsample(points,500).map(([d,v],i)=>(i?'L':'M')+x(d).toFixed(2)+' '+y(v).toFixed(2)).join(' ')}"/>`).join('');
      if (panel.log) {
        const prices = new Map(a.prices);
        content += result.matchedEvents.map(e=>`<circle class="mh-event-dot" cx="${x(e.signalDate)}" cy="${y(prices.get(e.signalDate))}" r="3.4"><title>${e.signalDate} · 后续${periodLabel(result.sessions)} ${pct(e.returnPct)}</title></circle>`).join('');
      }
    }
    const cursorX = x(a.timeline[cursorIndex].date);
    const mid = new Date((Date.parse(a.start)+Date.parse(a.end))/2).toISOString().slice(0,10);
    content += [a.start,mid,a.end].map((d,i)=>`<text x="${x(d)}" y="${height-5}" text-anchor="${i===0?'start':i===2?'end':'middle'}">${d.slice(0,7)}</text>`).join('');
    return `<svg class="mh-linked-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="${market.name}价格与${a.metrics.map(m=>m.label).join('、')}共用时间轴；金色圆点标出统计所用的历史相似月份"><title>价格与指标 · 同一时间轴</title>${content}<line class="mh-linked-cursor" x1="${cursorX}" x2="${cursorX}" y1="20" y2="${bottom}"/></svg>`;
  }
  function interpretation(result) {
    const s = result.matched, b = result.baseline;
    if (!s || !b) return `<div class="mh-interpretation"><div><span>决策参考</span><h4>没有走完观察期的相似样本</h4><p>当前历史窗口不足以判断后续表现。可扩大历史区间或观察单个指标。</p></div></div>`;
    const small = s.count < 12;
    const overlap = Math.max(s.q25,b.q25) <= Math.min(s.q75,b.q75);
    const title = small ? '样本偏少，不据此加减仓' : overlap ? '收益区间重叠，不据此择时' : '历史表现有差异，仍需验证';
    const finding = small ? `仅有${s.count}段不重叠样本，历史比例可能对个别行情很敏感。` : overlap ? '相似状态与全部时期的中间50%收益区间重叠，无法仅凭中位数差异判断择时优势。' : '分组结果存在差异，但尚未经过样本外验证，不能把历史关系当成有效交易规则。';
    return `<div class="mh-interpretation"><div><span>这对操作意味着什么</span><h4>${title}</h4><p>${finding}先以既定配置和再平衡计划为准。</p></div><div><span>${periodLabel(result.sessions)}持有压力 · ${small ? '少量历史案例' : '历史情景'}</span><h4>先检查能否承受 ${fmt(Math.abs(s.q25Drawdown),1)}% 的途中回撤</h4><p>这是相似样本回撤的较差四分位，历史最差为${fmt(Math.abs(s.worstDrawdown),1)}%。若无法承受，应先降低计划投入规模；这些数值不是未来损失上限。</p></div></div>`;
  }
  function studySection(market) {
    const a = analysis(market);
    if (a.error) return `<div class="mh-unavailable">${esc(a.error)}，暂停历史表现分析。</div>`;
    const sessions = state.horizons[market.id] || 126, result = a.results.find(r=>r.sessions===sessions), s = result.matched, b = result.baseline;
    const cursorIndex = Math.min(state.cursors[market.id] ?? a.timeline.length-1,a.timeline.length-1);
    const options = [['joint','波动＋趋势'],...market.metrics.map(m=>[m.id,{vix:'VIX',vxn:'VXN',rv21:'实际波动率',drawdown:'距一年高点',ma200:'均线偏离'}[m.id]])];
    const mode = state.modes[market.id] || 'joint';
    return `<section class="mh-study" data-study="${market.id}" aria-label="${market.name}历史相似状态分析">
      <header class="mh-study-head"><div><span class="mh-figure">HISTORICAL SCENARIOS</span><h3>相似状态之后，指数怎么走</h3></div><label>观察条件 <select data-study-mode="${market.id}" aria-label="${market.name}观察条件">${options.map(([v,label])=>`<option value="${v}" ${mode===v?'selected':''}>${label}</option>`).join('')}</select></label></header>
      <div class="mh-conditions"><span>当前 ${a.currentDate}</span>${a.conditions.map(c=>`<span class="mh-condition">${esc(conditionText(c))}<small>现值 ${fmt(c.value)}${c.unit}</small></span>`).join('')}</div>
      <div class="mh-study-grid"><div class="mh-linked"><div class="mh-study-caption"><b>价格与指标同步观察</b><span><i class="mh-key-dot"></i>相似月份 <i class="mh-key-band"></i>当前条件区间</span></div>${linkedChart(market,a,result,cursorIndex)}<div class="mh-cursor-readout">${cursorReadout(a,cursorIndex)}</div><label class="mh-scrubber"><span>拖动查看日期</span><input type="range" data-study-cursor="${market.id}" min="0" max="${a.timeline.length-1}" value="${cursorIndex}" step="1" aria-label="${market.name}历史月份" aria-valuetext="${a.timeline[cursorIndex].date}"/></label></div>
      <div class="mh-outcomes"><div class="mh-study-caption"><b>之后持有多久</b><span>累计收益 · 美元 · 不含分红</span></div><div class="mh-result-table-wrap"><table class="mh-result-table"><thead><tr><th>持有期</th><th>相似时期<small>收益中位</small></th><th>全部时期<small>收益中位</small></th><th>相似时期<small>亏损比例</small></th><th>相似<small>样本数</small></th></tr></thead><tbody>${a.results.map(r=>`<tr class="${r.sessions===sessions?'is-selected':''}"><th>${button(periodLabel(r.sessions),'horizon',market.id+':'+r.sessions,'',`aria-pressed="${r.sessions===sessions}" aria-label="${market.name}持有${periodLabel(r.sessions)}"`)}</th><td>${pct(r.matched?.median)}</td><td>${pct(r.baseline?.median)}</td><td>${r.matched?fmt(r.matched.lossRate,1)+'%':'—'}</td><td>${r.matched?.count ?? 0}</td></tr>`).join('')}</tbody></table></div>
      <div class="mh-outcome-detail"><div class="mh-study-caption"><b>${periodLabel(sessions)} · 历史收益中间50%</b><span>25%—75%分位</span></div><div class="mh-return-range"><span>相似时期</span><strong>${pct(s?.q25)} 至 ${pct(s?.q75)}</strong><small>${s?.count ?? 0}段</small></div><div class="mh-return-range is-baseline"><span>全部时期</span><strong>${pct(b?.q25)} 至 ${pct(b?.q75)}</strong><small>${b?.count ?? 0}段</small></div><dl class="mh-outcome-risk"><div><dt>途中最大回撤 · 中位</dt><dd>${pct(s?.medianDrawdown)}<small>基准 ${pct(b?.medianDrawdown)}</small></dd></div><div><dt>期末亏损比例</dt><dd>${s?fmt(s.lossRate,1)+'%':'—'}<small>基准 ${b?fmt(b.lossRate,1)+'%':'—'}</small></dd></div></dl></div>
      <div class="mh-study-evidence"><span>样本起于 ${a.sampleStart || '—'} · 持有窗口不重叠</span>${button('样本与算法 ↗','samples',market.id,'mh-text-button')}</div></div></div>${interpretation(result)}
      <p class="mh-study-foot">按月末观察，下一交易日收盘起算；1／3／6／12个月对应21／63／126／252个交易日。历史频率不等于未来概率。</p></section>`;
  }
  function marketSection(market) {
    const metrics = market.metrics.filter(m => M.eligibleMetric(market.id, m));
    if (!metrics.length) return '';
    const grid = `<div class="mh-grid">${metrics.map(m=>card(market,m,market.metrics.indexOf(m))).join('')}</div>`;
    const chartControl = group('chart',[['history','历史走势'],['distribution','历史分布']],state.chart,'指标图表类型');
    return `<section class="mh-market" aria-labelledby="mh-${market.id}-title"><header class="mh-market-head"><div class="mh-market-name"><span class="mh-section-no">${market.id==='spx'?'01':market.id==='ndx'?'02':'03'}</span><div><h2 id="mh-${market.id}-title">${market.name}<span>${market.english}</span></h2><p>${market.id==='macro'?'两个指数的共同市场背景':'与自身历史比较 · 关联后续收益与回撤'}</p></div></div>${market.close?`<div class="mh-index-price"><strong>${fmt(market.close.value)}<small>点</small></strong><span>价格指数 · ${market.close.date}</span></div>`:''}</header>
      ${market.id==='macro'?`<div class="mh-indicator-controls">${chartControl}</div>${grid}`:studySection(market)+`<details class="mh-indicators" data-indicator-details="${market.id}" ${state.expanded[market.id]?'open':''}><summary><span>4项指标的历史分位</span><small>展开图表与原始数据</small></summary><div class="mh-indicator-controls"><span>阴影：25%—75%区间 · 虚线：中位数</span>${chartControl}</div>${grid}</details>`}</section>`;
  }
  function view(context) {
    ctx = context;
    const header = `<header class="mh-report-head"><div><div class="eyebrow">MARKET HISTORY & RISK / 长衡研究</div><h1>美股历史分位</h1><p>把当前指标放回历史，观察相似状态后的收益与回撤。</p></div><div class="mh-report-meta"><span>HISTORICAL SCENARIOS</span><b>${state.data?.asOf||'—'}</b>${button('数据与口径 ↗','sources','','mh-text-button')}</div></header>`;
    if (!state.data) {
      if (!state.loading && !state.error) load();
      return header+`<div class="mh-loading" role="status">${state.error?'历史数据加载失败。'+button('重新加载','retry','','btn'):'正在载入历史观测数据…'}</div>`;
    }
    const markets = state.market==='macro'?[state.data.context]:state.data.markets.filter(m=>state.market==='all'||state.market===m.id);
    return `<div class="mh-report">${header}<div class="mh-toolbar"><div class="mh-control-block"><span>观察对象</span>${group('market',[['all','两个指数'],['spx','标普500'],['ndx','纳斯达克100'],['macro','市场环境']],state.market,'选择指数或市场环境')}</div><div class="mh-control-block"><span>历史区间</span>${group('years',[[5,'5年'],[10,'10年'],[20,'20年']],state.years,'历史区间')}</div></div>
      ${state.market!=='macro'?'<p class="mh-data-gap">PE、预期PE及盈利能力：缺已核验的同口径历史，暂不展示数值与分位。</p>':'<p class="mh-data-gap">市场环境仅作背景观察；NFCI为修订后历史，不参与相似状态收益统计。</p>'}
      ${markets.map(marketSection).join('')}<footer class="mh-report-foot"><span>长衡研究 / ${state.years}年历史观察</span><span>收益为美元价格指数累计涨跌，未计分红、费用与税款。</span>${button('打印 / 保存PDF','print','','mh-text-button')}</footer></div>`;
  }
  function samples(id) {
    const market = state.data.markets.find(m=>m.id===id), a = market && analysis(market);
    if (!a || a.error) return;
    const sessions = state.horizons[id] || 126, r = a.results.find(r=>r.sessions===sessions);
    const rows = r.matchedEvents.map(e=>`<tr><td>${e.signalDate}</td><td>${e.entryDate}</td><td>${e.exitDate}</td><td>${pct(e.returnPct)}</td><td>${pct(e.drawdownPct)}</td></tr>`).join('');
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle(esc(market.name+' · 历史相似样本'),periodLabel(sessions)+' / '+a.conditions.map(conditionText).map(esc).join('，'))}<section class="mh-method"><h3>收益与风险计算</h3><p>信号取每个已结束月份的最后交易日，指标与价格必须同日。用下一交易日收盘作为起点，向后持有${sessions}个交易日，只保留截至${a.end}已经走完观察期且价格没有超过10个日历日缺口的样本。收益为美元价格指数累计涨跌，不含分红、费用、税款。</p><p>最大回撤是持有区间内收盘价从前期高点到后续低点的最大跌幅，包含区间中途形成的高点；它不同于期末亏损。亏损比例仅计算期末收益小于0的样本。收益区间为历史样本的25%—75%分位，不是预测置信区间。</p><h3>条件、基准与样本数</h3><p>采用预先设定的固定数值分组，查找与当前读数同组的历史月份，未按后续收益优化阈值。相似组与全部时期组均按日期从早到晚保留样本，下一样本起点须晚于上一样本终点，分别去除重叠持有窗口。两组可能共享行情，去除窗口重叠也不意味着样本相互独立；基准包含相似月份，不是因果对照组。</p><p>历史窗口 ${a.start} — ${a.end}；有同日指标的月末样本起于 ${a.sampleStart}。满足条件并已走完观察期的月份${r.candidates}个，去重叠后${r.matchedEvents.length}段；全部时期基准${r.baselineEvents.length}段。同日有效月份中，${r.excludedIncomplete}个尚未走完${sessions}个交易日，未计入本期统计。</p><p>少于12段时提示样本偏少；这只是显示提醒阈值，达到12段不表示统计显著。区间重叠判断只描述历史分布，未做显著性检验、交易成本模型或样本外验证。这里是“当前状态的历史类比”，不是已验证的交易策略；当时公布版本也可能与现存历史文件不同。</p><p>来源：${link(state.data.sources[market.prices.source].url,'Yahoo Finance · '+market.symbol+'价格历史')}；${a.metrics.map(m=>link(state.data.sources[m.source].url,m.label)).join('；')}。</p></section><h3>相似样本 · ${r.matchedEvents.length}段</h3><div class="mh-sample-table-wrap"><table class="mh-sample-table"><thead><tr><th>观察月末</th><th>下一收盘起算</th><th>期末日期</th><th>累计收益</th><th>最大回撤</th></tr></thead><tbody>${rows||'<tr><td colspan="5">没有完整样本</td></tr>'}</tbody></table></div><div class="mh-detail-actions">${button('下载相似与基准样本 CSV','study-csv',id,'btn')}</div></div>`);
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
      <section class="mh-method"><h3>口径与来源</h3><p>${esc(metric.basis)}</p><p>实际样本：${s.points[0][0]} — ${s.last[0]}。${s.lateStart ? `历史不足${state.years}年，分位仅基于可用的${fmt(s.coverageYears, 1)}年。` : ''}${s.stale ? `最新观测距报告日 ${s.lagDays} 天。` : ''}${s.gaps.length ? `历史序列有 ${s.gaps.length} 处超过正常发布间隔的缺口，图中断线显示。` : ''}</p><p>分位 =（低于最新值的样本数 + 相同值样本数 × 0.5）÷ 有效样本数。保留原始发布频率，不补齐缺失日。</p><p>${[...new Set([metric.source, ...(metric.dependencies || [])])].map(key => link(state.data.sources[key].url, state.data.sources[key].name)).join(' · ')}${metric.attribution ? ' · ' + esc(metric.attribution) : ''}</p></section><div class="mh-detail-actions">${button('下载本指标数据 CSV', 'csv', value, 'btn')}</div></div>`);
  }
  function sources() {
    if (!state.data) return;
    const used = Object.entries(state.data.sources);
    const withheld = state.data.markets.map(m => `<section class="mh-method"><h3>${esc(m.name)} · 暂缺数据</h3><dl class="mh-withheld">${m.withheld.map(g => `<div><dt>${esc(g.label)}</dt><dd>${esc(g.reason)}</dd></div>`).join('')}</dl></section>`).join('');
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle('数据来源与计算口径', '每个指数独立计算；保留每项指标的实际观测日期。')}<section class="mh-method"><h3>发布值与计算值</h3><p>“官方发布”表示直接记录Cboe、美国财政部或芝加哥联储发布的序列。“行情计算”表示使用已列明的行情数据与固定公式复算，例如波动率、回撤、均线偏离或同日国债利差。它们均保留原始日期及来源；来源可追溯不等于所有历史观测已经独立复核。</p><p>VIX、VXN记录期权市场对未来波动的定价，不保证未来实际波动等于当前读数。NFCI使用官方最新修订历史，不是各历史时点当时已知的数据。</p><h3>PE的可比条件</h3><p>滚动PE使用过去12个月盈利；预期PE使用未来盈利预测，预测不能当成已实现利润。二者的对比必须确认相同价格日期、指数范围、聚合方法及一致的GAAP或调整后盈利口径，且明确预测是未来12个月还是某一财年。</p><p>已撤下的标普滚动PE为2026-10-13的供应商估算，预期PE却停留在2026-08-05。日期和盈利口径不一致，不能用两者差距推断盈利增长。净利率重建序列及未披露完整聚合方法的基本面快照也已撤下。</p><h3>历史分位</h3><p>默认最近20年，可切换5年、10年。有效原始观测按数值排序，重复值使用中位秩，当前值包含在样本内。不填补缺失日；不足20年时显示实际年限；超过正常更新间隔时暂停展示当前读数与分位。高分位只表示数值相对较高。</p></section>${withheld}<section class="mh-method"><h3>当前来源清单</h3><p>Finviz仅用于最近指数收盘读数的交叉检查，不提供本页基本面数据。收盘交叉检查不代表整段历史已经独立核验。</p></section><div class="mh-source-list">${used.map(([key, source]) => `<div><b>${link(source.url, source.name)}</b><span>${esc(key)}</span><small>${source.status === 'available' ? '采集 ' + (source.fetchedAt ? new Date(source.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' 北京时间' : '日期未记录') : '来源缺失'}${state.data.refreshFailures?.[key] ? ' · 本次刷新失败，保留旧观测' : ''}</small></div>`).join('')}</div></div>`);
  }
  document.addEventListener('toggle', event => {
    const id = event.target.dataset?.indicatorDetails;
    if (id) state.expanded[id] = event.target.open;
  }, true);
  document.addEventListener('change', event => {
    const id = event.target.dataset?.studyMode;
    if (!id || !ctx) return;
    state.modes[id] = event.target.value; delete state.cursors[id];
    ctx.render();
    document.querySelector(`[data-study-mode="${id}"]`)?.focus({preventScroll:true});
  });
  document.addEventListener('input', event => {
    const id = event.target.dataset?.studyCursor;
    if (!id || !state.data) return;
    const market = state.data.markets.find(m=>m.id===id), a = analysis(market), index = +event.target.value;
    if (a.error || !a.timeline[index]) return;
    state.cursors[id] = index;
    const root = event.target.closest('[data-study]'), point = a.timeline[index];
    root.querySelector('.mh-cursor-readout').innerHTML = cursorReadout(a,index);
    const x = 58 + (Date.parse(point.date)-Date.parse(a.start))/(Date.parse(a.end)-Date.parse(a.start))*585;
    const cursor = root.querySelector('.mh-linked-cursor');
    cursor.setAttribute('x1',x); cursor.setAttribute('x2',x);
    event.target.setAttribute('aria-valuetext',point.date);
  });
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-market-action]');
    if (!control || !ctx) return;
    const { marketAction: action, value } = control.dataset;
    if (action === 'retry') { load(); ctx.render(); return; }
    if (action === 'sources') { sources(); return; }
    if (action === 'detail') { detail(value); return; }
    if (action === 'samples') { samples(value); return; }
    if (action === 'study-csv') {
      const market = state.data.markets.find(m=>m.id===value), a = analysis(market), sessions = state.horizons[value] || 126;
      ctx.download(`${market.symbol}-scenarios-${sessions}D-${state.data.asOf}.csv`,M.studyCSV(market,a,sessions),'text/csv;charset=utf-8'); return;
    }
    if (action === 'horizon') {
      const [id,days] = value.split(':');
      if (!M.horizons.includes(+days)) return;
      state.horizons[id] = +days;
      ctx.render();
      document.querySelector(`[data-market-action="horizon"][data-value="${value}"]`)?.focus({preventScroll:true}); return;
    }
    if (action === 'csv') {
      const { market, metric, s } = find(value);
      ctx.download(`${market.symbol}-${metric.id}-${state.years}Y-${state.data.asOf}.csv`, M.csv(market, metric, s), 'text/csv;charset=utf-8'); return;
    }
    if (action === 'print') { window.print(); return; }
    if (!['years', 'market', 'category', 'chart'].includes(action)) return;
    state[action] = action === 'years' ? +value : value;
    if (action === 'years') state.cursors = {};
    if (action === 'market' && value === 'macro') state.category = 'all';
    if (action === 'market' && value !== 'macro' && state.category === 'macro') state.category = 'all';
    if (action === 'category' && value === 'macro') state.market = 'macro';
    if (action === 'category' && value !== 'macro' && value !== 'all' && state.market === 'macro') state.market = 'all';
    ctx.render();
    document.querySelector(`[data-market-action="${action}"][data-value="${value}"]`)?.focus({ preventScroll: true });
  });
  window.ChanghengMarketHistory = { view };
})();
