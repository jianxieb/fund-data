(function () {
  'use strict';
  const M = window.Changheng, C = window.ChanghengConditionStudyModel, R = window.ChanghengResearchHistory;
  const route = '#condition-study';
  const markets = { ndx:['纳斯达克100','^NDX'], spx:['标普500','^GSPC'] };
  const terms = { 5:'1周', 21:'1个月', 63:'3个月', 252:'1年' };
  const gapTerms = { 5:'约1周', 10:'约2周', 21:'约1个月', 63:'约3个月', 126:'约半年', 252:'约1年' };
  const shortLabels = { r1:'当日', r3:'近3日', r5:'近5日', r21:'近21日', r63:'近63日', r252:'近252日', worst21:'21日最差单日',
    dd252:'距252日高点', ddMax:'距历史高点', rise252:'高于252日低点', since252:'高点后', ma50:'距50日线', ma200:'距200日线',
    cross:'50/200日线', vol21:'波动率', rsi14:'RSI', down:'连跌', up:'连涨' };
  const signedIds = new Set(['r1','r3','r5','r21','r63','r252','worst21','ma50','ma200','cross']);
  const defaults = { market:'ndx', gap:21 };
  const status = { complete:'已到期', pending:'未到期', gap:'行情断档' };
  const issues = { number:'请输入数字', size:'数值过大', integer:'请输入整数', decimals:'最多两位小数', order:'下限不能高于上限' };
  const pageSize = 15, maxLines = 80, minBand = 3;
  const esc = M.escapeHtml;
  const cache = new Map(), results = new Map(), fits = new Map(), charts = new Map();
  let H, st, data, result, fitted, shown = null, signature = '', page = 1;

  const fixed = (v, digits = 2) => v.toLocaleString('zh-CN', { minimumFractionDigits:digits, maximumFractionDigits:digits });
  const pct = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
  const signed = v => '<span class="' + (v < 0 ? 'negative' : v > 0 ? 'positive' : '') + '">' + pct(v) + '</span>';
  const share = v => v == null ? '—' : v.toFixed(1) + '%';
  const minus = text => String(text).replace('-', '−');
  const label = m => m.label;
  const hint = m => m.id === 'ddMax' ? '自 ' + data.stats.ddMax.first.slice(0, 4) + ' 年数据起' : m.hint || '';
  function value(m, v) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (signedIds.has(m.id)) return pct(v);
    if (m.id === 'rsi14') return v.toFixed(1);
    if (m.integer) return v + (m.id === 'since252' ? ' 个交易日' : ' 日');
    return v.toFixed(2) + '%';
  }
  function bound(m, v) {
    const unit = m.id === 'since252' ? ' 个交易日' : m.unit === '日' ? ' 日' : m.unit;
    return (signedIds.has(m.id) && v > 0 ? '+' : '') + minus(v) + unit;
  }
  function rangeText(m, { lo = null, hi = null }) {
    if (lo !== null && hi !== null) return lo === hi ? '= ' + bound(m, lo) : bound(m, lo) + ' 至 ' + bound(m, hi);
    return lo !== null ? '≥ ' + bound(m, lo) : '≤ ' + bound(m, hi);
  }

  function readState() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const market = Object.hasOwn(markets, q.get('market')) ? q.get('market') : defaults.market;
    const gap = C.validGap(Number(q.get('gap'))) ? Number(q.get('gap')) : defaults.gap;
    const conditions = {};
    for (const m of C.metrics) if (q.has(m.id)) {
      const range = C.parseRange(q.get(m.id));
      if (range && C.validRange(m.id, range)) conditions[m.id] = range;
    }
    return { market, gap, conditions, manual:Object.keys(conditions).length > 0 || q.get('mode') === 'manual' };
  }
  // Built by hand so the ranges stay readable in the address bar (no %7E for "~").
  function write(next) {
    const parts = [];
    if (next.market !== defaults.market) parts.push('market=' + next.market);
    if (next.gap !== defaults.gap) parts.push('gap=' + next.gap);
    if (next.manual) {
      const ids = C.metrics.map(m => m.id).filter(id => next.conditions[id]);
      for (const id of ids) parts.push(id + '=' + C.formatRange(next.conditions[id]));
      if (!ids.length) parts.push('mode=manual');
    }
    history.replaceState(null, '', route + (parts.length ? '?' + parts.join('&') : ''));
    H.render();
  }
  function redraw() { if (location.hash.split('?')[0] === route) H.render(); }
  async function load(market) {
    const slot = {};
    cache.set(market, slot);
    try {
      const code = markets[market][1];
      const row = (await R.indexCatalog()).find(r => r.id === 'index:' + code);
      if (row?.kind !== 'index' || row.code !== code || row.currency !== 'USD' || row.basis !== 'price_index')
        throw new Error('缺少 ' + code + ' 的美元价格指数日线');
      const history = await R.history(row);
      if (history.dividends !== 'excluded') throw new Error(code + ' 缺少不含分红的价格指数口径');
      slot.data = C.compute(history.series);
    } catch (e) { slot.error = e.message || '无法读取指数日线'; }
    redraw();
  }
  function fitFor(market, gap) {
    const key = market + ':' + gap + ':' + data.asOf;
    if (!fits.has(key)) fits.set(key, C.fit(data, { gap }));
    return fits.get(key);
  }

  function controls() {
    const r = result;
    return '<div class="cs-toolbar">' +
      H.menu('cs-market', '研究指数', Object.entries(markets).map(([k, v]) => [k, v[0]]), st.market) +
      H.menu('cs-gap', '相邻样本至少相隔', C.gaps.map(g => [String(g), g + ' 个交易日 · ' + gapTerms[g]]), String(st.gap)) +
      '<div class="cs-toolbar-actions"><button type="button" class="btn primary" data-cs-action="fit" aria-pressed="' + !st.manual + '">' +
      (st.manual ? '按最新收盘匹配' : '✓ 已按最新收盘匹配') + '</button>' +
      (Object.keys(r.conditions).length ? '<button type="button" class="text-link" data-cs-action="clear">清除全部条件</button>' : '') + '</div>' +
      '<p class="cs-match" role="status">匹配 <b>' + r.episodes.length + '</b> 段 · ' + r.matchingDays.toLocaleString('zh-CN') + ' 个交易日满足条件</p></div>';
  }
  function fitNote() {
    const n = Object.keys(result.conditions).length;
    if (st.manual) return n ? '自选 ' + n + ' 项条件' : '未选择条件';
    const short = fitted.skipped.filter(s => s.episodes != null).length;
    return '已按 ' + fitted.asOf + ' 收盘选取 ' + fitted.added.length + ' 项，保留至少 ' + fitted.minEpisodes + ' 段历史' +
      (short ? '；另 ' + short + ' 项加入后不足 ' + fitted.minEpisodes + ' 段，未勾选' : '') + '。';
  }
  function currentStatus() {
    const c = result.current, n = Object.keys(result.conditions).length;
    if (!n) return '';
    return '<p class="cs-now-status' + (c.matches ? ' is-match' : '') + '">' + c.date + ' 收盘' +
      (c.matches ? '满足全部 ' + n + ' 项条件' : '不满足：' + c.failing.map(id => esc(label(C.byId[id]))).join('、')) + '</p>';
  }
  function strip(m, v, range) {
    const s = data.stats[m.id];
    if (s.n < 2) return '<span class="cs-strip"></span>';
    let lo = C.quantile(s.sorted, .01), hi = C.quantile(s.sorted, .99);
    if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!(hi > lo)) hi = lo + 1;
    const w = 128, x = n => (4 + (Math.min(hi, Math.max(lo, n)) - lo) / (hi - lo) * (w - 8)).toFixed(1);
    const q25 = x(C.quantile(s.sorted, .25)), q75 = x(C.quantile(s.sorted, .75));
    let svg = '<svg class="cs-strip" viewBox="0 0 ' + w + ' 20" width="' + w + '" height="20" aria-hidden="true" focusable="false">' +
      '<rect class="cs-strip-track" x="4" y="9" width="' + (w - 8) + '" height="2" rx="1"/>' +
      '<rect class="cs-strip-iqr" x="' + q25 + '" y="8" width="' + Math.max(1, q75 - q25).toFixed(1) + '" height="4" rx="2"/>';
    if (range) {
      const a = Number(x(range.lo ?? lo)), b = Number(x(range.hi ?? hi));
      svg += '<rect class="cs-strip-band" x="' + a.toFixed(1) + '" y="3" width="' + Math.max(3, b - a).toFixed(1) + '" height="14" rx="3"/>';
    }
    if (Number.isFinite(v)) svg += '<circle class="cs-strip-now" cx="' + x(v) + '" cy="10" r="4"/>';
    return svg + '</svg>';
  }
  function row(m) {
    const range = result.conditions[m.id], v = result.current.values[m.id], p = C.percentile(data, m.id, v);
    const preview = result.previews[m.id], name = label(m);
    const input = side => '<input id="cs-' + m.id + '-' + side + '" type="number" inputmode="decimal" step="any" data-cs-metric="' + m.id +
      '" data-cs-bound="' + side + '" value="' + (range?.[side] ?? '') + '" placeholder="不限" aria-label="' + esc(name + (side === 'lo' ? ' 下限' : ' 上限') + (m.unit ? '（' + m.unit + '）' : '')) + '">';
    const count = !preview ? '' : preview.kind === 'without' ? '去掉后 <b>' + preview.episodes + '</b> 段' : '勾选后 <b>' + preview.episodes + '</b> 段';
    return '<div class="cs-row' + (range ? ' is-active' : '') + '">' +
      '<label class="cs-name"><input id="cs-' + m.id + '-on" type="checkbox" data-cs-toggle="' + m.id + '"' + (range ? ' checked' : '') +
      (preview || range ? '' : ' disabled') + '><span>' + esc(name) + (hint(m) ? '<small>' + esc(hint(m)) + '</small>' : '') + '</span></label>' +
      '<span class="cs-now"><b>' + value(m, v) + '</b><small>' + (p == null ? '缺历史' : '分位 ' + (p < 1 || p > 99 ? p.toFixed(1) : Math.round(p)) + '%') + '</small></span>' +
      strip(m, v, range) +
      '<span class="cs-range">' + input('lo') + '<span>至</span>' + input('hi') + '<span class="cs-unit">' + esc(m.unit === '日' ? '日' : m.unit) + '</span></span>' +
      '<span class="cs-count">' + count + '</span></div>';
  }
  function conditionPanel() {
    const date = result.current.date;
    return '<section class="cs-conditions" aria-labelledby="cs-conditions-title"><div class="cs-conditions-head"><div><h2 id="cs-conditions-title">条件</h2>' +
      '<p>' + fitNote() + '</p></div>' + currentStatus() + '<p class="cs-key" aria-hidden="true"><span class="cs-key-now"></span>最新值<span class="cs-key-band"></span>条件范围' +
      '<span class="cs-key-iqr"></span>历史中间 50%</p></div><div class="cs-groups">' +
      C.groups.map(([g, title]) => '<fieldset class="cs-group"><legend>' + title + '</legend><div class="cs-row cs-row-head" aria-hidden="true"><span>指标</span><span>' + date +
        '</span><span>历史分布</span><span>范围（含边界）</span><span>样本</span></div>' + C.metrics.filter(m => m.group === g).map(row).join('') + '</fieldset>').join('') +
      '</div></section>';
  }

  // Charts: one viewBox-based SVG each, with a crosshair and tooltip registered for hover and keyboard focus.
  function niceTicks(lo, hi) {
    const raw = (hi - lo) / 5, magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= raw) || raw;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
    return ticks;
  }
  const line = points => points.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1)).join('');
  function frame(id, { lines, thin = [], band = null, labels = [], caption, legend }) {
    const width = 1200, height = 380, left = 58, right = 1080, top = 22, bottom = 330, x0 = -C.lookback, x1 = C.horizons.at(-1);
    // With a band, its 10–90% envelope sets the scale and outlying single paths are clipped.
    let lo = 100, hi = 100;
    const take = v => { if (v < lo) lo = v; if (v > hi) hi = v; };
    for (const l of lines) for (const p of l.points) take(p[1]);
    if (band) { for (const r of band) if (r.n >= minBand) { take(r.p10); take(r.p90); } }
    else for (const t of thin) for (const p of t.points) take(p[1]);
    const pad = Math.max(1, (hi - lo) * .06); lo -= pad; hi += pad;
    const sx = k => left + (k - x0) / (x1 - x0) * (right - left), sy = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
    const map = points => points.map(([k, v]) => [sx(k), sy(v)]);
    const clip = 'cs-clip-' + id;
    const grid = niceTicks(lo, hi).map(v => '<line class="cs-grid" x1="' + left + '" x2="' + right + '" y1="' + sy(v).toFixed(1) + '" y2="' + sy(v).toFixed(1) + '"/>' +
      '<text class="cs-axis" x="' + (left - 10) + '" y="' + (sy(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>').join('');
    const xticks = [-63, -21, 0, 21, 63, 126, 252].map(k => '<text class="cs-axis" x="' + sx(k).toFixed(1) + '" y="' + (bottom + 22) + '" text-anchor="middle">' +
      (k === 0 ? '信号日' : (k > 0 ? '+' : '−') + Math.abs(k)) + '</text>').join('');
    const usable = band ? band.filter(r => r.n >= minBand) : [];
    const area = usable.length > 1 ? '<path class="cs-band" d="' + line(map(usable.map(r => [r.k, r.q75]))) + 'L' +
      line(map(usable.slice().reverse().map(r => [r.k, r.q25]))).slice(1) + 'Z"/>' : '';
    charts.set(id, { width, x0, x1, sx, left, right,
      band:new Map(usable.map(r => [r.k, r])),
      lines:lines.map(l => ({ label:l.label, cls:l.cls, values:new Map(l.points) })) });
    return '<figure class="cs-chart">' + (legend || '') + '<div class="cs-chart-box"><svg data-cs-chart="' + id + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" tabindex="0" aria-label="' + esc(caption) + '">' +
      '<title>' + esc(caption) + '</title><defs><clipPath id="' + clip + '"><rect x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '"/></clipPath></defs>' +
      grid + '<line class="cs-base" x1="' + left + '" x2="' + right + '" y1="' + sy(100).toFixed(1) + '" y2="' + sy(100).toFixed(1) + '"/>' +
      '<line class="cs-signal" x1="' + sx(0).toFixed(1) + '" x2="' + sx(0).toFixed(1) + '" y1="' + top + '" y2="' + bottom + '"/>' + xticks +
      '<text class="cs-axis cs-axis-title" x="' + right + '" y="' + (bottom + 44) + '" text-anchor="end">交易日（相对信号日）</text>' +
      '<g clip-path="url(#' + clip + ')">' + area +
      thin.map(t => '<path class="cs-line-episode" d="' + line(map(t.points)) + '"><title>' + esc(t.label) + '</title></path>').join('') +
      lines.map(l => '<path class="' + l.cls + '" d="' + line(map(l.points)) + '"/>').join('') + '</g>' +
      labels.map(l => '<text class="cs-end-label" x="' + (sx(l.k) + (l.anchor === 'end' ? -8 : 8)).toFixed(1) + '" y="' + (sy(l.v) + (l.dy || 4)).toFixed(1) +
        '" text-anchor="' + (l.anchor || 'start') + '">' + esc(l.text) + '</text>').join('') +
      '<line class="cs-crosshair" x1="0" x2="0" y1="' + top + '" y2="' + bottom + '" visibility="hidden"/></svg>' +
      '<div class="cs-tooltip" hidden></div></div><figcaption>' + esc(caption) + '</figcaption></figure>';
  }
  const key = (cls, text) => '<span class="cs-legend-item"><i class="' + cls + '"></i>' + text + '</span>';
  function mainChart() {
    const indices = result.episodes.map(e => e.index), rows = result.spread || (result.spread = C.spread(data, indices));
    const now = C.path(data, data.last, C.lookback, 0), many = indices.length > maxLines;
    const median = rows.filter(r => r.n >= minBand).map(r => [r.k, r.median]);
    const end = median.at(-1), forward = rows.filter(r => r.k > 0 && r.n >= minBand);
    const lines = [...(median.length > 1 ? [{ label:'中位数', cls:'cs-line-median', points:median }] : []), { label:'最新', cls:'cs-line-now', points:now }];
    const labels = [{ text:'最新', k:now[0][0], v:now[0][1], dy:-10 }, ...(end ? [{ text:'中位数 ' + pct(end[1] - 100), k:end[0], v:end[1] }] : [])];
    const legend = '<div class="cs-legend">' + key('cs-key-line-now', '最近 ' + (now.length - 1) + ' 个交易日（' + data.dates[data.last - now.length + 1] + ' 至 ' + data.asOf + '）') +
      (median.length > 1 ? key('cs-key-line-median', '历史中位数') + key('cs-key-area', '中间 50% 区间') : '') +
      (many ? '' : key('cs-key-line-episode', '各段实际走势')) + '</div>';
    const caption = '每段以信号日收盘为 100，最新路径以 ' + data.asOf + ' 收盘为 100。' + (forward.length && forward.at(-1).n < indices.length ? '较新的样本尚未走完，右侧只计已发生部分。' : '') +
      (many ? '共 ' + indices.length + ' 段，只画中位数与区间。' : '');
    return '<section class="ds-panel cs-chart-panel"><div class="ds-panel-head"><div><h2>信号前后的走势</h2><p>前 ' + C.lookback + ' 个交易日至后 ' + C.horizons.at(-1) +
      ' 个交易日 · ' + indices.length + ' 段匹配样本</p></div></div>' +
      frame('main', { lines, thin:many ? [] : result.episodes.map(e => ({ label:e.date, points:C.path(data, e.index) })), band:indices.length >= minBand ? rows : null, labels, caption, legend }) + '</section>';
  }
  function episodeChart(e) {
    const own = C.path(data, e.index), now = C.path(data, data.last, C.lookback, 0);
    const legend = '<div class="cs-legend">' + key('cs-key-line-median', e.date + ' 前后') + key('cs-key-line-now', '最近 ' + (now.length - 1) + ' 个交易日') + '</div>';
    return frame('event', { lines:[{ label:e.date, cls:'cs-line-median', points:own }, { label:'最新', cls:'cs-line-now', points:now }],
      labels:[{ text:pct(own.at(-1)[1] - 100), k:own.at(-1)[0], v:own.at(-1)[1] }], legend,
      caption:e.date + ' 收盘为 100；' + (own.at(-1)[0] < C.horizons.at(-1) ? '已观察 ' + own.at(-1)[0] + ' / ' + C.horizons.at(-1) + ' 个交易日。' : '已走完 252 个交易日。') });
  }
  function tipRow(cls, text, strong) {
    const row = document.createElement('div'), key = document.createElement('i'), name = document.createElement('span'), value = document.createElement('b');
    key.className = cls; name.textContent = text; value.textContent = strong;
    row.append(key, value, name);
    return row;
  }
  function showAt(svg, k) {
    const model = charts.get(svg.dataset.csChart), tip = svg.parentElement.querySelector('.cs-tooltip'), cross = svg.querySelector('.cs-crosshair');
    if (!model || !tip || !cross) return;
    k = Math.max(model.x0, Math.min(model.x1, Math.round(k)));
    model.focus = k;
    const x = model.sx(k), band = model.band.get(k), rows = [];
    for (const l of model.lines) if (l.values.has(k)) rows.push(tipRow(l.cls.replace('cs-line', 'cs-key-line'), l.label, pct(l.values.get(k) - 100)));
    if (band) {
      rows.push(tipRow('cs-key-area', '中间 50%', pct(band.q25 - 100) + ' 至 ' + pct(band.q75 - 100)));
      rows.push(tipRow('', '有数据的样本', band.n + ' 段'));
    }
    const title = document.createElement('p');
    title.textContent = k === 0 ? '信号日' : k < 0 ? '信号前 ' + -k + ' 个交易日' : '信号后 ' + k + ' 个交易日';
    tip.replaceChildren(title, ...rows);
    tip.hidden = false;
    shown = svg;
    cross.setAttribute('x1', x.toFixed(1)); cross.setAttribute('x2', x.toFixed(1)); cross.setAttribute('visibility', 'visible');
    const box = svg.getBoundingClientRect(), px = x / model.width * box.width;
    tip.style.left = Math.min(Math.max(0, px + 14), Math.max(0, box.width - tip.offsetWidth - 4)) + 'px';
    if (px + 14 + tip.offsetWidth > box.width) tip.style.left = Math.max(0, px - tip.offsetWidth - 14) + 'px';
  }
  function hideTip(svg) {
    svg?.parentElement?.querySelector('.cs-tooltip')?.setAttribute('hidden', '');
    svg?.querySelector('.cs-crosshair')?.setAttribute('visibility', 'hidden');
    if (shown === svg) shown = null;
  }

  function summaryPanel() {
    const n = result.episodes.length;
    const rows = C.horizons.map(h => {
      const s = result.summary[h], b = result.baseline[h];
      const waiting = [s.pending ? s.pending + ' 段未到期' : '', s.gap ? s.gap + ' 段行情断档' : ''].filter(Boolean).join(' · ');
      return '<tr><th scope="row">' + terms[h] + '<small>' + h + ' 个交易日</small></th><td>' + s.n + (waiting ? '<small>' + waiting + '</small>' : '') + '</td>' +
        '<td><strong>' + signed(s.median) + '</strong></td><td>' + signed(s.mean) + '</td><td>' + share(s.upPct) + '</td>' +
        '<td class="cs-base-cell">' + pct(b.median) + '</td><td class="cs-base-cell">' + share(b.upPct) + '</td>' +
        '<td class="cs-risk-cell">' + signed(s.drawdown.median) + '</td><td>' + signed(s.drawdown.min) + '</td><td class="cs-base-cell">' + pct(b.drawdown.median) + '</td>' +
        '<td class="cs-risk-cell">' + signed(s.low.median) + '</td><td>' + signed(s.low.min) + '</td></tr>';
    }).join('');
    const year = result.summary[252].n;
    return '<section class="ds-panel" aria-labelledby="cs-summary-title"><div class="ds-panel-head"><div><h2 id="cs-summary-title">满足条件之后，指数涨跌多少？</h2>' +
      '<p>从信号日收盘起算 · 美元价格指数累计涨跌，不含分红</p></div><span class="ds-coverage">' + result.first + ' — ' + result.asOf + '</span></div>' +
      '<div class="ds-scroll"><table class="cs-summary"><thead><tr><th rowspan="2" scope="col">后续期限</th><th rowspan="2" scope="col">有效样本</th>' +
      '<th colspan="3" scope="colgroup">匹配的 ' + n + ' 段</th><th colspan="2" scope="colgroup" class="cs-base-cell">全部交易日</th>' +
      '<th colspan="3" scope="colgroup" class="cs-risk-cell">期间最大回撤</th><th colspan="2" scope="colgroup" class="cs-risk-cell">相对信号日最低</th></tr>' +
      '<tr><th>中位数</th><th>平均数</th><th>上涨占比</th><th class="cs-base-cell">中位数</th><th class="cs-base-cell">上涨占比</th>' +
      '<th class="cs-risk-cell">中位数</th><th>最深</th><th class="cs-base-cell">全部交易日</th><th class="cs-risk-cell">中位数</th><th>最深</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ds-foot">相邻样本至少相隔 ' + result.gap + ' 个交易日，后续区间仍可能重叠，样本数不等于独立行情的次数' +
      (year > 0 && year < 5 ? '；一年期只有 ' + year + ' 段完整结果，可逐段查看' : '') + '。</div></section>';
  }
  const pages = () => Math.max(1, Math.ceil(result.episodes.length / pageSize));
  function episodesPanel() {
    const ids = Object.keys(result.conditions), rows = result.episodes;
    page = Math.min(page, pages());
    const cell = o => o.status === 'complete' ? signed(o.pct) + '<small>回撤 ' + pct(o.drawdown) + '</small>' : '<span class="ds-faint">' + status[o.status] + '</span>';
    return '<section class="ds-panel"><div class="ds-panel-head"><div><h2>逐段记录</h2><p>每段取首个满足条件的交易日为信号日 · ' + rows.length + ' 段</p></div>' +
      '<button type="button" class="btn sm" data-cs-action="csv"' + (rows.length ? '' : ' disabled') + '>导出全部 ' + rows.length + ' 段 CSV</button></div>' +
      (rows.length ? '<div class="ds-scroll"><table class="cs-events"><thead><tr><th scope="col">信号日</th><th scope="col">收盘</th>' +
        ids.map(id => '<th scope="col">' + shortLabels[id] + '</th>').join('') + C.horizons.map(h => '<th scope="col">' + terms[h] + '后</th>').join('') + '</tr></thead><tbody>' +
        rows.slice((page - 1) * pageSize, page * pageSize).map(e => '<tr><th scope="row"><button type="button" class="text-link" data-cs-event="' + e.date + '" aria-label="查看 ' + e.date + ' 前后走势">' + e.date + '</button>' +
          (result.current.episode === e.date ? '<small class="cs-tag">含最新收盘</small>' : '') + '</th><td>' + fixed(e.close) + '</td>' +
          ids.map(id => '<td>' + value(C.byId[id], e.values[id]) + '</td>').join('') + C.horizons.map(h => '<td>' + cell(e.outcomes[h]) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>' + (pages() > 1 ? '<div class="ds-pagination"><span>第 ' + page + ' / ' + pages() + ' 页</span><button type="button" class="btn sm" data-cs-action="prev"' + (page === 1 ? ' disabled' : '') +
        '>上一页</button><button type="button" class="btn sm" data-cs-action="next"' + (page === pages() ? ' disabled' : '') + '>下一页</button></div>' : '') :
        '<p class="ds-foot">没有同时满足全部条件的交易日。可去掉或放宽一项：每行右侧显示去掉它之后的段数。</p>') + '</section>';
  }
  function emptyState() {
    return '<section class="ds-panel cs-empty" role="status"><h2>尚未选择条件</h2><p>勾选上方的指标后显示匹配的历史样本。</p></section>';
  }
  function detail(e) {
    const groups = C.groups.map(([g, title]) => '<div class="cs-detail-group"><h3>' + title + '</h3><dl>' + C.metrics.filter(m => m.group === g).map(m =>
      '<div' + (result.conditions[m.id] ? ' class="is-active"' : '') + '><dt>' + esc(label(m)) + '</dt><dd>' + value(m, e.values[m.id]) + '</dd></div>').join('') + '</dl></div>').join('');
    const rows = C.horizons.map(h => {
      const o = e.outcomes[h];
      return '<tr><th scope="row">' + terms[h] + '</th><td>' + (o.date || status[o.status]) + '</td><td>' + (o.close == null ? '—' : fixed(o.close)) + '</td><td>' + signed(o.pct) +
        '</td><td>' + signed(o.drawdown) + '</td><td>' + signed(o.low) + '</td></tr>';
    }).join('');
    H.openModal(H.modalTitle(e.date + ' · ' + markets[st.market][0], '信号日收盘 ' + fixed(e.close) + ' 点 · 美元价格指数，不含分红') + '<div class="cs-detail">' + episodeChart(e) +
      '<div class="ds-scroll"><table class="cs-detail-table"><thead><tr><th>后续期限</th><th>实际期末日</th><th>期末收盘</th><th>累计涨跌</th><th>期间最大回撤</th><th>相对信号日最低</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="cs-detail-groups">' + groups + '</div></div>');
  }
  function exportCsv() {
    const conditions = Object.entries(result.conditions).map(([id, range]) => label(C.byId[id]) + ' ' + rangeText(C.byId[id], range)).join('；') || '不限';
    const header = ['指数', '口径', '行情截至', '条件来源', '条件', '相邻样本至少相隔交易日', '信号日', '信号收盘', ...C.metrics.map(m => m.label + (m.unit ? '（' + m.unit + '）' : '')),
      ...C.horizons.flatMap(h => [terms[h] + '状态', terms[h] + '实际期末日', terms[h] + '期末收盘', terms[h] + '累计涨跌%', terms[h] + '期间最大回撤%', terms[h] + '相对信号日最低%'])];
    const rows = result.episodes.map(e => [markets[st.market][1], '美元价格指数，不含分红', result.asOf, st.manual ? '自选' : '按 ' + fitted.asOf + ' 收盘自动选取', conditions, result.gap,
      e.date, e.close, ...C.metrics.map(m => e.values[m.id]),
      ...C.horizons.flatMap(h => { const o = e.outcomes[h]; return [status[o.status], o.date, o.close, o.pct, o.drawdown, o.low]; })]);
    H.download('行情条件后表现-' + markets[st.market][0] + '-' + result.asOf + '.csv', M.csv([header, ...rows]), 'text/csv;charset=utf-8');
  }
  function method() {
    return '<details class="ds-method"><summary>条件、样本与收益口径</summary>' +
      '<p>所有指标都截至信号日收盘，只用当天及以前的收盘价：涨跌与 N 个交易日前的收盘比较；回撤取含当天的 252 个收盘中的最高点；均线含当天；波动率为 21 个日对数收益的样本标准差年化；RSI 为 14 日 Wilder 平滑。范围两端都包含在内，留空表示不限。</p>' +
      '<p>一段从首个满足全部条件的交易日开始，其后若干交易日内再次满足的日期并入同一段，后续收益从信号日收盘起算。按最新收盘匹配时，依次尝试距 252 日最高收盘、近 21 日、近 5 日、当日涨跌、200 日均线、波动率、近 3 日和近 63 日；每项取最新值附近的范围，最新值处于历史最低或最高的 10% 时改为单侧，加入后不足 10 段的项目不勾选。</p>' +
      '<p>结果描述历史样本，不代表下一次的概率；样本少时，范围稍变就可能明显改变结果。</p>' +
      '<p><a href="https://finance.yahoo.com/quote/' + encodeURIComponent(markets[st.market][1]) + '/history/" target="_blank" rel="noopener noreferrer">指数历史收盘 ↗</a> · ' +
      '<a href="https://github.com/jianxieb/fund-data/blob/main/docs/condition-study-method.md" target="_blank" rel="noopener noreferrer">完整方法与核对记录 ↗</a></p></details>';
  }

  function view(helpers) {
    H = helpers; st = readState();
    const title = H.head('MARKET CONDITION STUDY', '行情条件后表现', '按近期涨跌、距高点回撤、均线与波动率筛选历史交易日，查看之后一周至一年的涨跌与回撤。');
    if (!cache.has(st.market)) load(st.market);
    const slot = cache.get(st.market);
    if (!slot.data) return title + '<div class="ds-panel ds-loading" role="status">' + (slot.error ? esc(slot.error) + ' <button type="button" class="text-link" data-cs-action="retry">重新加载</button>' :
      '正在读取' + markets[st.market][0] + '历史收盘…') + '</div>';
    data = slot.data;
    fitted = st.manual ? null : fitFor(st.market, st.gap);
    const conditions = st.manual ? st.conditions : fitted.conditions;
    const sig = JSON.stringify([st.market, st.gap, data.asOf, C.metrics.map(m => conditions[m.id] ? C.formatRange(conditions[m.id]) : '')]);
    if (sig !== signature) { signature = sig; page = 1; }
    if (!results.has(sig)) results.set(sig, C.study(data, { conditions, gap:st.gap }));
    result = results.get(sig);
    charts.clear();
    return title + controls() + conditionPanel() + (Object.keys(result.conditions).length ? mainChart() + summaryPanel() + episodesPanel() : emptyState()) + method();
  }
  function choose(k, v) {
    const next = readState();
    if (k === 'market' && Object.hasOwn(markets, v)) next.market = v;
    else if (k === 'gap' && C.validGap(Number(v))) next.gap = Number(v);
    else return;
    write(next);
  }
  function toggle(id, on) {
    const conditions = { ...result.conditions };
    if (on) {
      const band = C.suggest(data, id);
      if (!band) { H.render(); return; }
      conditions[id] = band;
    } else delete conditions[id];
    write({ ...st, manual:true, conditions });
  }
  function edit(input) {
    const id = input.dataset.csMetric, side = input.dataset.csBound, raw = String(input.value).trim();
    if (!C.byId[id] || !['lo', 'hi'].includes(side)) return;
    // Text a number field cannot parse reads as empty; keep it on screen instead of treating it as "no limit".
    if (input.validity?.badInput) { input.reportValidity?.(); return; }
    const entered = raw === '' ? null : Number(raw), range = { lo:null, hi:null, ...result.conditions[id], [side]:entered };
    const conditions = { ...result.conditions }, issue = C.rangeIssue(id, range);
    if (issue === 'empty') delete conditions[id];
    else if (issue) {
      input.setCustomValidity(issues[issue] || '无法使用这个范围'); input.reportValidity?.();
      return;
    } else conditions[id] = range;
    write({ ...st, manual:true, conditions });
  }
  const active = () => H && location.hash.split('?')[0] === route && result;
  document.addEventListener('change', event => {
    const el = event.target;
    if (!active() || !el?.dataset) return;
    if (el.dataset.csToggle) toggle(el.dataset.csToggle, el.checked);
    // A change on blur fires before focus reaches the next field; render after it lands so focus is kept.
    else if (el.dataset.csMetric) setTimeout(() => { if (active()) edit(el); }, 0);
  });
  document.addEventListener('input', event => { if (event.target?.dataset?.csMetric) event.target.setCustomValidity(''); });
  document.addEventListener('click', event => {
    if (!H) return;
    const target = event.target;
    const row = target.closest?.('[data-cs-event]');
    if (row && result) { const e = result.episodes.find(x => x.date === row.dataset.csEvent); if (e) detail(e); return; }
    const button = target.closest?.('[data-cs-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.csAction) {
      case 'fit': write({ ...readState(), manual:false, conditions:{} }); break;
      case 'clear': write({ ...readState(), manual:true, conditions:{} }); break;
      case 'retry': cache.delete(readState().market); results.clear(); fits.clear(); H.render(); break;
      case 'csv': if (result?.episodes.length) exportCsv(); break;
      case 'prev': if (page > 1) { page--; H.render(); } break;
      case 'next': if (result && page < pages()) { page++; H.render(); } break;
    }
  });
  document.addEventListener('pointermove', event => {
    const svg = event.target.closest?.('svg[data-cs-chart]');
    if (svg) {
      const model = charts.get(svg.dataset.csChart), box = svg.getBoundingClientRect();
      if (model && box.width) showAt(svg, model.x0 + ((event.clientX - box.left) / box.width * model.width - model.left) / (model.right - model.left) * (model.x1 - model.x0));
    } else if (shown && shown !== document.activeElement) hideTip(shown);
  });
  document.addEventListener('focusin', event => { if (event.target.matches?.('svg[data-cs-chart]')) showAt(event.target, charts.get(event.target.dataset.csChart)?.focus ?? 0); });
  document.addEventListener('focusout', event => { if (event.target.matches?.('svg[data-cs-chart]')) hideTip(event.target); });
  document.addEventListener('keydown', event => {
    const svg = event.target;
    if (!svg.matches?.('svg[data-cs-chart]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const model = charts.get(svg.dataset.csChart);
    if (!model) return;
    event.preventDefault();
    const step = event.shiftKey ? 21 : 1, k = model.focus ?? 0;
    showAt(svg, event.key === 'Home' ? model.x0 : event.key === 'End' ? model.x1 : k + (event.key === 'ArrowLeft' ? -step : step));
  });
  window.ChanghengConditionStudy = { view, choose };
})();
