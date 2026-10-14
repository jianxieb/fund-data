(function () {
  'use strict';
  const M = window.ChanghengMarketHistoryModel;
  const state = { years: 20, market: 'all', category: 'all', chart: 'history', data: null, loading: false, error: false };
  const categories = { valuation: '估值', profitability: '盈利能力', risk: '波动与回撤', trend: '价格趋势', macro: '利率与信用' };
  const frequencies = { daily: '日频', weekly: '周频', monthly: '月频', quarterly: '季频' };
  let ctx, cachedSummaries = new Map();
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
      if (data.schemaVersion !== 1 || !Array.isArray(data.markets)) throw new Error('Invalid report');
      state.data = data; cachedSummaries = new Map();
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
    const estimated = metric.estimated || metric.estimatedDates?.includes(s.last[0]);
    const badges = [s.stale ? '更新滞后' : '', estimated ? '估算' : '', metric.caution ? '转载·未独立核验' : '', s.lateStart ? '起于' + s.points[0][0].slice(0, 7) : '', s.gaps.length ? '历史有缺口' : ''].filter(Boolean);
    return `<article class="mh-metric" data-metric="${market.id}:${metric.id}"><header><div><span class="mh-figure">FIG. ${String(index + 1).padStart(2, '0')} / ${categories[metric.category]}</span><h3>${esc(metric.label)}</h3><p>${esc(metric.english)}</p></div>${button('↗', 'detail', `${market.id}:${metric.id}`, 'mh-expand', `aria-label="查看${market.name}${metric.label}图表与数据"`)}</header>
      <div class="mh-reading"><div><strong>${fmt(s.last[1])}<small>${metric.unit}</small></strong><time datetime="${s.last[0]}">${s.last[0]}${badges.length ? ' <span class="mh-status">' + badges.join(' · ') + '</span>' : ''}</time></div><div class="mh-rank"><span>${rankPeriod(s)}</span><b>${fmt(s.percentile, 1)}<small>%</small></b></div></div>
      ${gauge(s)}${state.chart === 'history' ? svgLine(metric, s) : svgDistribution(metric, s)}
      <footer><span>${frequencies[metric.frequency]} · ${s.count.toLocaleString()} 个观测</span><span>中位 ${fmt(s.median)}${metric.unit}</span></footer></article>`;
  }
  function snapshots(market) {
    const rows = market.snapshots.filter(s => state.category === 'all' || s.category === state.category);
    if (!rows.length) return '';
    const at = rows[0].observedAt ? new Date(rows[0].observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未记录';
    return `<section class="mh-snapshots"><div class="mh-snapshot-head"><div><h3>最新基本面快照 <small>${rows.length} 项</small></h3><p>Finviz汇总口径 · 缺同口径历史，暂不计算分位</p></div><span>采集 ${esc(at)}（北京时间）</span></div><dl>${rows.map(s => `<div><dt>${esc(s.label)}</dt><dd>${fmt(s.value)}<small>${s.unit}</small></dd></div>`).join('')}</dl><div class="mh-snapshot-foot">${link(state.data.sources[rows[0].source].url, '数据来源')}<span>供应商未逐项披露财报截止日及完整聚合算法</span></div></section>`;
  }
  function marketSection(market) {
    const metrics = market.metrics.filter(m => state.category === 'all' || m.category === state.category);
    const snapshotHtml = snapshots(market);
    if (!metrics.length && !snapshotHtml) return '';
    return `<section class="mh-market" aria-labelledby="mh-${market.id}-title"><header class="mh-market-head"><div class="mh-market-name"><span class="mh-section-no">${market.id === 'spx' ? '01' : market.id === 'ndx' ? '02' : '03'}</span><div><h2 id="mh-${market.id}-title">${market.name}<span>${market.english}</span></h2><p>${market.id === 'macro' ? '两个指数的共同市场背景' : '与自身历史比较'} · ${metrics.length} 项历史指标</p></div></div>${market.close ? `<div class="mh-index-price"><strong>${fmt(market.close.value)}<small>点</small></strong><span>价格指数 · ${market.close.date}</span></div>` : ''}</header>
      ${metrics.length ? '<div class="mh-grid">' + metrics.map((m) => card(market, m, market.metrics.indexOf(m))).join('') + '</div>' : '<p class="mh-unavailable">' + esc(market.name) + '盈利指标缺少同口径历史序列，最新可得快照如下。</p>'}
      ${snapshotHtml}<div class="mh-coverage">尚缺历史：${esc(market.gaps.join('；'))}</div></section>`;
  }
  function view(context) {
    ctx = context;
    const header = `<header class="mh-report-head"><div><div class="eyebrow">MARKET VALUATION & RISK / 长衡研究</div><h1>美股历史分位</h1><p>标普500与纳斯达克100，分别观察当下在自身历史中的位置。</p></div><div class="mh-report-meta"><span>HISTORICAL POSITION</span><b>${state.data?.asOf || '—'}</b>${button('数据与口径 ↗', 'sources', '', 'mh-text-button')}</div></header>`;
    if (!state.data) {
      if (!state.loading && !state.error) load();
      return header + `<div class="mh-loading" role="status">${state.error ? '历史数据加载失败。' + button('重新加载', 'retry', '', 'btn') : '正在载入历史观测数据…'}</div>`;
    }
    const sections = [...state.data.markets, ...(state.data.context ? [state.data.context] : [])].filter(m => state.market === 'all' || state.market === m.id).map(marketSection).filter(Boolean);
    return `<div class="mh-report">${header}<div class="mh-toolbar"><div class="mh-control-block"><span>观察对象</span>${group('market', [['all', '全部'], ['spx', '标普500'], ['ndx', '纳斯达克100'], ['macro', '市场环境']], state.market, '选择指数或市场环境')}</div><div class="mh-control-block"><span>历史区间</span>${group('years', [[5, '5年'], [10, '10年'], [20, '20年']], state.years, '历史区间')}</div></div>
      <div class="mh-filterbar">${group('category', [['all', '全部指标'], ...Object.entries(categories)], state.category, '指标类别')}${group('chart', [['history', '历史走势'], ['distribution', '历史分布']], state.chart, '图表类型')}</div>
      <div class="mh-legend"><span>${M.windowStart(state.data.asOf, state.years)} — ${state.data.asOf}</span><div>${state.chart === 'history' ? '<span><i class="mh-key-line"></i>历史值</span><span><i class="mh-key-band"></i>25%—75%区间</span><span><i class="mh-key-median"></i>中位数</span>' : '<span><i class="mh-key-band"></i>历史观测分布</span>'}<span><i class="mh-key-dot"></i>最新可得</span></div></div>
      ${sections.length ? sections.join('') : '<div class="mh-unavailable">当前观察对象下没有这一类别的指标，请选择“全部指标”。</div>'}
      <footer class="mh-report-foot"><span>长衡研究 / ${state.years}年历史观察</span><span>分位表示数值在历史中的位置，不等同于预期回报。</span>${button('打印 / 保存PDF', 'print', '', 'mh-text-button')}</footer></div>`;
  }
  function find(value) {
    const [id, key] = value.split(':'), market = [...state.data.markets, state.data.context].filter(Boolean).find(m => m.id === id);
    const metric = market?.metrics.find(m => m.id === key);
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
    ctx.openModal(`<div class="mh-detail">${ctx.modalTitle('数据来源与计算口径', '每个指数独立计算；每项指标保留自己的观测日期。')}<section class="mh-method"><h3>历史分位</h3><p>默认观察最近20年，可切换5年或10年。有效原始观测按数值排序，重复值使用中位秩。当前值包含在样本内。高分位只表示数值相对较高，不统一代表贵、便宜或买卖信号。</p><h3>时间与口径</h3><p>图表使用指数数据；实际波动率、回撤、均线偏离和价格动量由该指数收盘价计算。盈利与估值保留月频、季频或周频，不填充成日线。月频估值中的最新估算单独计为一个观测。</p><h3>已知缺口</h3><p>纳斯达克100的滚动PE、PB、PS、股息率及盈利能力暂只有Finviz快照，缺少可复算的同口径20年历史。两项指数的现金流估值、ROE、ROA、ROIC、营业利润率和财务杠杆等快照指标仍缺同口径历史。快照不参与分位计算。</p><p>预期PE使用History of Market转载的周频一致预期序列，原始终端供应商未披露，保留其实际观测日；未与其他口径的每日PE拼接，亦未独立核验其原始终端数据。标普500净利率是DQYDJ重建估算序列。</p><h3>官方序列与修订</h3><p>VIX、VXN、VVIX、SKEW及短期隐含波动率直接使用Cboe数据。VXN、VIX3M、VIX9D及相关派生指标不足20年时，显示实际可用年限。国债利率来自美国财政部；金融条件指数来自芝加哥联储，采用最新修订历史，不用于模拟当时已知的信息。</p><h3>来源清单</h3></section><div class="mh-source-list">${used.map(([key, source]) => `<div><b>${link(source.url, source.name)}</b><span>${esc(key)}</span><small>${source.status === 'available' ? '采集 ' + (source.fetchedAt ? new Date(source.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' 北京时间' : '日期未记录') : '来源缺失'}${state.data.refreshFailures?.[key] ? ' · 本次刷新失败，保留旧观测' : ''}</small></div>`).join('')}</div><section class="mh-method"><p>History of Market 数据按 CC BY 4.0 署名使用。采集时间是访问来源的时间；指标卡片日期才是指标实际观测日期。</p></section></div>`);
  }
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-market-action]');
    if (!control || !ctx) return;
    const { marketAction: action, value } = control.dataset;
    if (action === 'retry') { load(); ctx.render(); return; }
    if (action === 'sources') { sources(); return; }
    if (action === 'detail') { detail(value); return; }
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
