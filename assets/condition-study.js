(function () {
  'use strict';
  const M = window.Changheng, C = window.ChanghengConditionStudyModel, R = window.ChanghengResearchHistory;
  const route = '#condition-study';
  const markets = { ndx:['纳斯达克100','^NDX'], spx:['标普500','^GSPC'] };
  const terms = { 1:'1日', 2:'2日', 3:'3日', 4:'4日', 5:'1周', 10:'2周', 21:'1个月', 63:'3个月', 126:'半年', 252:'1年', 504:'2年' };
  const gapTerms = { 5:'约1周', 10:'约2周', 21:'约1个月', 63:'约3个月', 126:'约半年', 252:'约1年' };
  const waitTerms = { 5:'约1周', 10:'约2周', 21:'约1个月', 42:'约2个月', 63:'约3个月', 126:'约半年', 252:'约1年' };
  const eraNames = { all:'全部历史', exclude_dotcom:'排除 2000—2002 年信号' };
  const basisNames = { close:'收盘', high:'盘中最高价' };
  const choices = { recov:{ yes:'曾收复', no:'始终未收复' }, broke:{ yes:'曾跌破', no:'未跌破' } };
  const peerOf = market => market === 'ndx' ? 'spx' : 'ndx';
  const peerName = () => markets[peerOf(st.market)][0];
  const shortLabels = { r1:'当日', r3:'近3日', r5:'近5日', r21:'近21日', r63:'近63日', r252:'近252日', worst21:'21日最差单日',
    dd252:'距252日高点', ddMax:'距历史高点', rise252:'高于252日低点', since252:'高点后', ma50:'距50日线', ma200:'距200日线',
    cross:'50/200日线', vix:'VIX', vix5:'VIX 5日变化', vol21:'波动率', rsi14:'RSI', down:'连跌', up:'连涨',
    ma200p:'前日距200日线', dd252p:'前日距252日高点', vol21p:'前日波动率', recov:'收复', broke:'跌破信号日收盘', rebound:'收回比例', obsMove:'观察期涨跌' };
  const shortLabel = id => id === 'rN' ? '近' + st.params.rNDays + '日' : id === 'ddN' ? '距' + st.params.ddNDays + '日高点' :
    id === 'drops' ? '21日跌超' + st.params.dropsPct + '%' : id === 'peer1' ? (st.market === 'ndx' ? '标普' : '纳指') + '当日' : shortLabels[id];
  const signedIds = new Set(['r1','r3','r5','r21','r63','r252','rN','worst21','peer1','ma50','ma200','cross','ma200p','vix5','obsMove']);
  // What each reading is, then how it is usually read. Shown on demand beside its name.
  const notes = {
    r1:['信号日收盘相对前一交易日收盘的涨跌。', '单日冲击的大小；配合近 3、5 日涨跌，可区分一次性急跌与连续下跌。'],
    r3:['相对 3 个交易日前收盘的涨跌，不要求每天同向。', '捕捉几天之内的急跌或急涨。'],
    r5:['相对 5 个交易日前（约一周）收盘的涨跌。', '一周内的累计冲击。'],
    r21:['相对 21 个交易日前（约一个月）收盘的涨跌。', '区分短线回调与持续一个月的下跌。'],
    r63:['相对 63 个交易日前（约三个月）收盘的涨跌。', '季度级别的趋势。'],
    r252:['相对 252 个交易日前（约一年）收盘的涨跌。', '所处的牛熊背景。'],
    rN:['相对 N 个交易日前收盘的涨跌；N 可填 1–2,520。', '用于预设之外的回看长度，例如 10 日或 2 年。'],
    worst21:['近 21 个交易日（含当日）中跌得最多的一天。', '用来筛选近一个月内出现过大跌，不要求大跌就在当天。'],
    drops:['信号日之前 21 个交易日里，单日跌幅严格超过所填百分比的天数，不含信号日。', '0 表示近一个月没有同等级的大跌，可区分首次大跌与连续大跌。'],
    peer1:['研究纳斯达克100时看标普500，反之看纳斯达克100；两者须是同一对相邻交易日的收盘。', '另一指数是否同日大跌，可区分个别板块下跌与普跌。'],
    dd252:['收盘比近 252 个交易日内的最高收盘低多少。', '常说的回调 10%、熊市 20%，看的就是距前高的跌幅。'],
    ddN:['收盘比含当日的近 N 个交易日最高收盘低多少；N 可填 2–2,520。', '例如 N 取 63，看的是距近三个月高点的回撤。'],
    ddMax:['收盘比数据起点以来的最高收盘低多少。', '接近 0 表示仍在历史高位附近。'],
    rise252:['收盘比近 252 个交易日内的最低收盘高多少。', '接近 0 表示仍在一年低点附近。'],
    since252:['近 252 个交易日的最高收盘出现在几个交易日之前。', '数值小表示刚从高点回落；接近 251 表示一年来未再创新高。'],
    ma50:['收盘相对含当日的 50 日简单均线偏离多少。', '正值在均线上方，衡量中短期的偏离。'],
    ma200:['收盘相对含当日的 200 日简单均线偏离多少。', '常用的长期趋势线；负值即收在 200 日线下方。'],
    cross:['50 日均线相对 200 日均线高出或低于多少。', '正值即 50 日线在上方（俗称金叉后的状态），负值为死叉后的状态。'],
    vix:['Cboe 按标普500期权价格计算的未来 30 天隐含波动率。研究纳斯达克100时也用它代表美股整体的恐慌程度。', '常用分界为 15、20、30，越高表示期权市场预期的波动越大。'],
    vix5:['VIX 相对 5 个交易日前的变化。', '大幅上升表示恐慌快速升温；与 VIX 水平一起看，可区分突然飙升与长期高位。'],
    vol21:['近 21 个交易日实际日收益的年化波动率。', '这是已经发生的波动；VIX 则是期权市场对未来的预期。'],
    rsi14:['14 日相对强弱指标，范围 0–100，按 Wilder 平滑。', '常把 30 以下视为超卖、70 以上视为超买。'],
    down:['截至当日连续收低的交易日数，收平即中断。', '下跌持续了几天。'],
    up:['截至当日连续收高的交易日数，收平即中断。', '上涨持续了几天。'],
    ma200p:['信号日前一交易日的收盘相对截至该日的 200 日均线。', '不受信号日涨跌影响，看大跌之前是否仍在长期均线上方。'],
    dd252p:['信号日前一交易日的收盘距截至该日的 252 日最高收盘有多远。', '大跌前离一年高点有多远。'],
    vol21p:['截至信号日前一交易日的 21 日年化波动率，不含信号日。', '大跌前市场是否已经动荡。'],
    recov:['信号日之后的观察期内，任一日收盘（或所选的盘中最高价）达到或高于信号日前一交易日的收盘。', '先收复再跌回也算曾收复；始终未收复表示观察期内每天都低于这一点位。'],
    broke:['观察期内任一日收盘严格低于信号日收盘。', '曾跌破表示信号日之后还有更低的收盘；相等不算跌破。'],
    rebound:['（观察期末收盘 − 信号日收盘）÷（前一日收盘 − 信号日收盘）× 100%，只对信号日收跌的样本有值。', '100% 以上表示期末已回到跌前点位；负值表示期末低于信号日收盘。'],
    obsMove:['观察期最后一个交易日收盘相对信号日收盘的涨跌。', '后续收益从这一收盘起算，因此观察期内的涨跌不计入后续结果。']
  };
  const defaults = { market:'ndx', gap:21, wait:0, basis:'close', era:'all', horizons:C.defaultHorizons };
  const status = { complete:'已到期', pending:'未到期', gap:'行情断档', missingHigh:'缺最高价' };
  const issues = { number:'请输入数字', size:'数值过大', integer:'请输入整数', decimals:'最多两位小数', order:'下限不能高于上限' };
  const paramIssues = { rNDays:'请输入 1–2520 的整数', ddNDays:'请输入 2–2520 的整数', dropsPct:'请输入 0.01–99.99，最多两位小数' };
  const pageSize = 15, maxLines = 80, minBand = 3;
  const esc = M.escapeHtml;
  const cache = new Map(), highCache = new Map(), frames = new Map(), results = new Map(), fits = new Map(), charts = new Map();
  let H, st, data, ref, result, fitted, shown = null, signature = '', page = 1, vixLoad = null;

  const fixed = (v, digits = 2) => v.toLocaleString('zh-CN', { minimumFractionDigits:digits, maximumFractionDigits:digits });
  const pct = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
  const signed = v => '<span class="' + (v < 0 ? 'negative' : v > 0 ? 'positive' : '') + '">' + pct(v) + '</span>';
  const share = v => v == null ? '—' : v.toFixed(1) + '%';
  const minus = text => String(text).replace('-', '−');
  function label(m) {
    if (m.id === 'rN') return '近 ' + st.params.rNDays + ' 日涨跌';
    if (m.id === 'ddN') return '距近 ' + st.params.ddNDays + ' 日最高收盘';
    if (m.id === 'drops') return '近 21 日跌超 ' + st.params.dropsPct + '% 的天数';
    if (m.id === 'peer1') return peerName() + '当日涨跌';
    return m.label;
  }
  const firstYear = () => (data.stats.ddMax.first || data.first).slice(0, 4);
  const hint = m => m.id === 'ddMax' ? '自 ' + firstYear() + ' 年数据起' : m.id === 'peer1' ? '同一对交易日' : m.hint || '';
  function value(m, v) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (m.choice) return v === 1 ? choices[m.id].yes : choices[m.id].no;
    if (signedIds.has(m.id)) return pct(v);
    if (m.id === 'rsi14') return v.toFixed(1);
    if (m.id === 'vix') return v.toFixed(2);
    if (m.id === 'drops') return v + ' 天';
    if (m.integer) return v + (m.id === 'since252' ? ' 个交易日' : ' 日');
    return minus(v.toFixed(2)) + '%';
  }
  function bound(m, v) {
    const unit = m.id === 'since252' ? ' 个交易日' : m.unit === '日' || m.unit === '天' ? ' ' + m.unit : m.unit;
    return (signedIds.has(m.id) && v > 0 ? '+' : '') + minus(v) + unit;
  }
  function rangeText(m, { lo = null, hi = null }) {
    if (m.choice) return lo === 1 ? choices[m.id].yes : choices[m.id].no;
    if (lo !== null && hi !== null) return lo === hi ? '= ' + bound(m, lo) : bound(m, lo) + ' 至 ' + bound(m, hi);
    return lo !== null ? '≥ ' + bound(m, lo) : '≤ ' + bound(m, hi);
  }

  function readState(query = location.hash.split('?')[1] || '') {
    const q = new URLSearchParams(query);
    const num = k => q.has(k) ? Number(q.get(k)) : NaN;
    const wait = C.validWait(num('obs')) ? num('obs') : defaults.wait;
    const date = M.validDate(q.get('date')) ? q.get('date') : null;
    const picked = (q.get('h') || '').split(',').map(Number).filter(h => C.horizonChoices.includes(h));
    const params = Object.fromEntries(Object.entries(C.params).map(([k, spec]) => [k, C.validParam(k, num(k)) ? num(k) : spec.fallback]));
    const conditions = {};
    for (const m of C.metrics) if (q.has(m.id) && (m.source !== 'obs' || wait)) {
      const text = q.get(m.id);
      const range = m.choice ? (text === 'yes' ? { lo:1, hi:1 } : text === 'no' ? { lo:0, hi:0 } : null) : C.parseRange(text);
      if (range && C.validRange(m.id, range)) conditions[m.id] = range;
    }
    return { market:Object.hasOwn(markets, q.get('market')) ? q.get('market') : defaults.market,
      gap:C.validGap(num('gap')) ? num('gap') : defaults.gap, wait, basis:q.get('basis') === 'high' ? 'high' : 'close',
      era:C.validEra(q.get('era')) ? q.get('era') : defaults.era, date,
      horizons:picked.length ? C.horizonChoices.filter(h => picked.includes(h)) : [...defaults.horizons], params, conditions,
      manual:Object.keys(conditions).length > 0 || q.get('mode') === 'manual' };
  }
  // Built by hand so the ranges stay readable in the address bar (no %7E for "~").
  function address(next) {
    const parts = [];
    if (next.market !== defaults.market) parts.push('market=' + next.market);
    if (next.date) parts.push('date=' + next.date);
    if (next.wait) parts.push('obs=' + next.wait);
    if (next.wait && next.basis === 'high') parts.push('basis=high');
    if (next.era !== defaults.era) parts.push('era=' + next.era);
    if (next.gap !== defaults.gap) parts.push('gap=' + next.gap);
    if (next.horizons.join() !== defaults.horizons.join()) parts.push('h=' + next.horizons.join(','));
    for (const [k, spec] of Object.entries(C.params)) if (next.params[k] !== spec.fallback) parts.push(k + '=' + next.params[k]);
    if (next.manual) {
      const ids = C.metrics.filter(m => next.conditions[m.id] && (m.source !== 'obs' || next.wait)).map(m => m.id);
      for (const id of ids) parts.push(id + '=' + (C.byId[id].choice ? (next.conditions[id].lo === 1 ? 'yes' : 'no') : C.formatRange(next.conditions[id])));
      if (!ids.length) parts.push('mode=manual');
    }
    return route + (parts.length ? '?' + parts.join('&') : '');
  }
  function write(next) {
    history.replaceState(null, '', address(next));
    H.render();
  }
  // Links to the former 指数大跌 page open the same study here.
  function legacy(hash) {
    return address({ ...readState(''), ...C.fromDropStudy(String(hash).split('?')[1] || ''), manual:true });
  }
  function redraw() { if (location.hash.split('?')[0] === route) H.render(); }
  async function readVix() {
    const response = await fetch(document.querySelector('#condition-vix-source')?.dataset.src || 'data/condition-study/catalog.json', { cache:'no-cache' });
    if (!response.ok) throw new Error('VIX 目录加载失败（' + response.status + '）');
    const catalog = await response.json();
    const row = catalog.schemaVersion === 1 && catalog.assets?.find(item => item.id === 'index:^VIX');
    if (!row || row.status !== 'available') throw new Error(row?.missing || '目录中没有可用的 VIX 日线');
    if (row.code !== '^VIX' || row.basis !== 'implied_volatility_index' || !/^data\/condition-study\/VIX-[a-f0-9]{16}\.json$/.test(row.historyUrl || ''))
      throw new Error('VIX 身份或文件路径无效');
    const fetched = await fetch(row.historyUrl);
    if (!fetched.ok) throw new Error('VIX 文件加载失败（' + fetched.status + '）');
    const text = await fetched.text();
    if (globalThis.crypto?.subtle) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
      if (hash !== row.sha256) throw new Error('VIX 文件版本不一致，请刷新页面');
    }
    const history = JSON.parse(text);
    if (history.schemaVersion !== 1 || history.id !== row.id || history.basis !== row.basis || history.field !== 'CLOSE' || history.closedSessionsOnly !== true ||
        !Array.isArray(history.series) || history.first !== row.first || history.asOf !== row.asOf ||
        history.series[0]?.[0] !== history.first || history.series.at(-1)?.[0] !== history.asOf)
      throw new Error('VIX 日线的身份、日期或口径不一致');
    return { series:history.series, row };
  }
  const vixOnce = () => vixLoad || (vixLoad = readVix().catch(e => { vixLoad = null; return { error:e.message || 'VIX 日线读取失败' }; }));
  async function load(market) {
    const slot = {};
    cache.set(market, slot);
    try {
      const code = markets[market][1], vix = vixOnce();
      const row = (await R.indexCatalog()).find(r => r.id === 'index:' + code);
      if (row?.kind !== 'index' || row.code !== code || row.currency !== 'USD' || row.basis !== 'price_index')
        throw new Error('缺少 ' + code + ' 的美元价格指数日线');
      const history = await R.history(row);
      if (history.dividends !== 'excluded') throw new Error(code + ' 缺少不含分红的价格指数口径');
      slot.vix = await vix;
      try { slot.data = C.compute(history.series, slot.vix.series ? { vix:slot.vix.series } : {}); }
      catch (e) {
        if (!slot.vix.series) throw e;
        // A malformed VIX file must not hide the index study; its readings stay unknown and say why.
        slot.vix = { error:e.message };
        slot.data = C.compute(history.series);
      }
      slot.series = history.series;
    } catch (e) { slot.error = e.message || '无法读取指数日线'; }
    redraw();
  }
  // Daily highs of closed sessions, checked against the published closes before use.
  async function loadHigh(market) {
    const slot = {};
    highCache.set(market, slot);
    try {
      const response = await fetch(document.querySelector('#drop-high-source')?.dataset.src || 'data/drop-study/catalog.json', { cache:'no-cache' });
      if (!response.ok) throw new Error('最高价目录加载失败（' + response.status + '）');
      const catalog = await response.json(), code = markets[market][1];
      const row = catalog.schemaVersion === 1 && catalog.assets?.find(item => item.id === 'index:' + code);
      if (!row || row.status !== 'available') throw new Error(row?.missing || code + ' 缺历史最高价');
      if (row.code !== code || row.currency !== 'USD' || row.basis !== 'price_index_high' ||
          !/^data\/drop-study\/[A-Z]+-[a-f0-9]{16}\.json$/.test(row.historyUrl || '')) throw new Error(code + ' 最高价身份或文件路径无效');
      const fetched = await fetch(row.historyUrl);
      if (!fetched.ok) throw new Error(code + ' 最高价文件加载失败（' + fetched.status + '）');
      const text = await fetched.text();
      if (globalThis.crypto?.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== row.sha256) throw new Error(code + ' 最高价文件版本不一致，请刷新页面');
      }
      const history = JSON.parse(text), closes = new Map(cache.get(market)?.series || []);
      if (history.schemaVersion !== 1 || history.id !== row.id || history.currency !== 'USD' || history.basis !== 'price_index_high' ||
          history.dividends !== 'excluded' || history.closedSessionsOnly !== true || history.dateConvention !== 'exchange_local_date' ||
          history.field !== 'indicators.quote[0].high' || !Array.isArray(history.series) || !Array.isArray(history.closes) ||
          history.closes.length !== history.series.length || history.first !== row.first || history.asOf !== row.asOf ||
          history.series[0]?.[0] !== history.first || history.series.at(-1)?.[0] !== history.asOf)
        throw new Error(code + ' 最高价历史身份、日期或口径不一致');
      if (history.series.some((point, i) => !Array.isArray(point) || point.length !== 2 || !M.validDate(point[0]) ||
          i > 0 && point[0] <= history.series[i - 1][0] || !Number.isFinite(point[1]) || point[1] <= 0 ||
          history.closes[i]?.[0] !== point[0] || !Number.isFinite(history.closes[i]?.[1]) || history.closes[i][1] <= 0 ||
          point[1] + 1e-8 < history.closes[i][1])) throw new Error(code + ' 最高价日期或数值未与来源收盘勾稽');
      // Only highs whose own close agrees with the published close are used; the rest count as missing.
      slot.series = history.series.filter((point, i) => closes.has(point[0]) &&
        Math.abs(history.closes[i][1] - closes.get(point[0])) <= .005 && point[1] + 1e-8 >= closes.get(point[0]));
      slot.history = history; slot.refreshMissing = row.refreshMissing || '';
    } catch (e) { slot.error = e.message || '无法读取历史最高价'; }
    redraw();
  }
  function fitFor(key) {
    const id = key + '|' + st.gap + '|' + st.era + '|' + ref;
    if (!fits.has(id)) fits.set(id, C.fit(data, { gap:st.gap, era:st.era, ref }));
    return fits.get(id);
  }

  function waitOptions() {
    const list = [...new Set([...C.waits, ...(st.wait ? [st.wait] : [])])].sort((a, b) => a - b);
    return [['0', '不设'], ...list.map(w => [String(w), w + ' 个交易日' + (waitTerms[w] ? ' · ' + waitTerms[w] : '')]), ['custom', '自定义…']];
  }
  function refField() {
    const latest = ref === data.last;
    return '<div class="event-menu-field cs-ref"><label for="cs-ref">参照日</label><div class="cs-ref-box">' +
      '<input id="cs-ref" type="date" min="' + data.first + '" max="' + data.asOf + '" value="' + data.dates[ref] + '">' +
      (latest ? '<small>最新收盘</small>' : '<button type="button" class="text-link" data-cs-action="latest">回到最新</button>') + '</div>' +
      (st.date && st.date !== data.dates[ref] ? '<small class="cs-ref-note">' + st.date + ' 无收盘，用 ' + data.dates[ref] + '</small>' : '') + '</div>';
  }
  function horizonPicker() {
    return '<div class="event-menu-field cs-horizons"><span id="cs-h-label">后续期限</span><div class="cs-chips" role="group" aria-labelledby="cs-h-label">' +
      C.horizonChoices.map(h => {
        const on = st.horizons.includes(h);
        return '<button type="button" class="cs-chip' + (on ? ' active' : '') + '" data-cs-horizon="' + h + '" aria-pressed="' + on + '" title="' + h + ' 个交易日"' +
          (on && st.horizons.length === 1 ? ' disabled' : '') + '>' + terms[h] + '</button>';
      }).join('') + '</div></div>';
  }
  function toolbar() {
    return '<div class="cs-toolbar">' +
      H.menu('cs-market', '研究指数', Object.entries(markets).map(([k, v]) => [k, v[0]]), st.market) + refField() +
      H.menu('cs-wait', '信号后观察期', waitOptions(), String(st.wait)) +
      (st.wait ? H.menu('cs-basis', '收复判定', Object.entries(basisNames), st.basis) : '') +
      H.menu('cs-era', '历史范围', Object.entries(eraNames), st.era) +
      H.menu('cs-gap', '相邻样本至少相隔', C.gaps.map(g => [String(g), g === 1 ? '不合并 · 每个交易日单独计' : g + ' 个交易日 · ' + gapTerms[g]]), String(st.gap)) +
      horizonPicker() + '</div>';
  }
  function highNote() {
    if (!st.wait || st.basis !== 'high') return '';
    const slot = highCache.get(st.market);
    if (slot?.error) return '<p class="cs-basis-note" role="status">盘中最高价未能读取：' + esc(slot.error) + '；观察期内收复无法判断，相关交易日不计入。 <button type="button" class="text-link" data-cs-action="retry-high">重试</button></p>';
    if (slot?.refreshMissing) return '<p class="cs-basis-note" role="status">最高价最近一次更新失败，沿用截至 ' + slot.history.asOf + ' 的数据。</p>';
    return '';
  }
  function fitNote() {
    const n = Object.keys(result.conditions).length;
    if (st.manual) return n ? '自选 ' + n + ' 项条件' : '未选择条件';
    const short = fitted.steps.filter(step => step.band && !step.kept).map(step => shortLabel(step.id));
    return '已按 ' + fitted.date + ' 的读数选取 ' + fitted.added.length + ' 项，保留至少 ' + fitted.minEpisodes + ' 段历史' +
      (short.length ? '；' + short.join('、') + ' 加入后不足 ' + fitted.minEpisodes + ' 段，未勾选' : '') + '。改任一数字即转为自选。';
  }
  function referenceStatus() {
    const r = result.reference, n = Object.keys(result.conditions).length;
    if (!n) return '';
    const badge = (cls, text) => '<p class="cs-now-status' + cls + '">' + text + '</p>';
    // While its observation period is still running, the reference close can only fail its own signal-day readings.
    const open = r.observation && r.observation.status !== 'complete', signalFails = r.failing.filter(id => C.byId[id].source !== 'obs');
    let text;
    if (r.matches) text = badge(' is-match', r.date + ' 收盘满足全部 ' + n + ' 项条件');
    else if (r.excluded) text = badge('', r.date + ' 在排除的 2000—2002 年内');
    else if (open && !signalFails.length) text = badge(' is-wait', r.date + ' 收盘满足信号日条件，' + observationText(r.observation));
    else text = badge('', r.date + ' 收盘不满足：' + (open ? signalFails : r.failing).map(id => esc(label(C.byId[id]))).join('、') +
      (open ? '；' + observationText(r.observation) : ''));
    const o = result.observing;
    return text + (o?.count && !(o.count === 1 && o.latest === r.date) ? '<p class="cs-observing">另有 ' + o.count + ' 个交易日满足信号日条件、仍在观察期内（最近 ' + o.latest + '）</p>' : '');
  }
  const dateList = list => list.length > 3 ? list.slice(0, 2).join('、') + ' 等 ' + list.length + ' 个交易日' : list.join('、');
  const observationText = o => o.status === 'pending' ? '观察期还差 ' + o.waitLeft + ' 个交易日' : o.status === 'gap' ? '观察期内行情断档' :
    '缺 ' + dateList(o.missingHighDates || []) + ' 最高价';
  // Native popovers: light dismiss and Esc come from the browser; the page only anchors them under their button.
  function info(id, name, title, body) {
    return '<button type="button" class="cs-info" popovertarget="cs-info-' + id + '" aria-label="' + esc(name) + '">i</button>' +
      '<div id="cs-info-' + id + '" class="cs-info-pop" popover><b>' + esc(title) + '</b>' + body.map(p => '<p>' + p + '</p>').join('') + '</div>';
  }
  const fitList = () => C.fitOrder.map(id => shortLabels[id]).join('、');
  function fitInfo() {
    return info('fit', '按参照日匹配如何选条件', '按参照日匹配如何选条件', [
      '依次尝试 ' + C.fitOrder.length + ' 项：' + esc(fitList()) + '。',
      '每项以参照日的读数为中心取一段范围；读数处于历史最低或最高 10% 时只限一侧。',
      '加入后仍有至少 ' + C.fitDefaults.minEpisodes + ' 段历史样本才勾选，否则跳过。其余项目不自动尝试，可手动勾选或填写。']);
  }
  function vixGap(m) {
    if (!data.vix) return '缺 VIX 日线';
    const days = m.id === 'vix5' ? [ref, ref - 5] : [ref];
    const gap = days.find(i => i >= 0 && !Number.isFinite(data.values.vix[i]));
    return gap === undefined ? '' : '缺 ' + data.dates[gap] + ' VIX';
  }
  function peerGap() {
    const slot = cache.get(peerOf(st.market));
    if (!data.peer) return slot?.error ? '缺' + peerName() + '日线' : '正在读取' + peerName();
    return '缺同一对交易日收盘';
  }
  function obsGap(m) {
    const o = result.reference.observation;
    if (!o) return '';
    if (o.status !== 'complete') return observationText(o);
    if (m.id === 'recov' && o.recovered === null) return '缺前一日收盘';
    if (m.id === 'rebound' && o.rebound === null) return o.prior === null ? '缺前一日收盘' : '信号日未下跌';
    return '';
  }
  function nowNote(m, v, p) {
    if (p != null && !m.choice) return '分位 ' + (p < 1 || p > 99 ? p.toFixed(1) : Math.round(p)) + '%';
    if (m.source === 'vix') return vixGap(m) || '缺历史';
    if (m.source === 'peer') return Number.isFinite(v) ? '缺历史' : peerGap();
    if (m.source === 'obs') return obsGap(m) || (m.id === 'recov' && v === 1 ? result.reference.observation.recoveryDate || '' : '');
    return Number.isFinite(v) ? '缺历史' : '回看不足';
  }
  function fitLine(m) {
    const preview = result.previews[m.id], range = result.conditions[m.id];
    const offer = preview?.kind === 'with' ? '勾选后按参照日读数取 ' + esc(rangeText(m, preview.range)) + '，剩 ' + preview.episodes + ' 段。' : '';
    if (st.manual) {
      if (m.choice) return range ? '已选 ' + rangeText(m, range) + '；改为不限后 ' + preview.without + ' 段。' : '';
      return range ? '已勾选 ' + esc(rangeText(m, range)) + '；去掉后 ' + preview.episodes + ' 段。' : offer || '参照日读数未知，无法按参照日取范围。';
    }
    const k = C.fitOrder.indexOf(m.id), step = fitted.steps[k];
    if (k < 0) return '按参照日匹配不尝试此项。' + offer;
    if (!step.band) return '按参照日匹配第 ' + (k + 1) + ' 项：参照日读数未知，无法取范围。';
    return '按参照日匹配第 ' + (k + 1) + ' 项：取 ' + esc(rangeText(m, step.band)) + '，加入时' +
      (step.kept ? '仍有 ' + step.episodes + ' 段，已勾选。' : '只剩 ' + step.episodes + ' 段，少于 ' + fitted.minEpisodes + ' 段，未勾选' +
        // Later conditions may narrow it further, so the count for ticking it now can differ.
        (preview?.kind === 'with' && preview.episodes !== step.episodes ? '；按现有条件勾选会剩 ' + preview.episodes + ' 段' : '') + '。');
  }
  function sourceLines(m) {
    if (m.source === 'vix') {
      if (!data.vix) return ['缺 VIX 日线：' + esc(cache.get(st.market)?.vix?.error || '未能读取') + '。'];
      const row = cache.get(st.market).vix.row, gaps = data.vix.missing;
      return ['数据：Cboe 官方日收盘，' + data.vix.first + ' 至 ' + data.vix.asOf + (gaps.length ? '；缺 ' + gaps.join('、') + ' 的读数，当日按未知处理' : '') + '。' +
        (row?.refreshMissing ? '最近一次更新失败，保留原读数。' : '')];
    }
    if (m.id === 'recov' && st.basis === 'high') return ['按盘中最高价判定：使用已收盘交易日的最高点位；观察期内任一天缺最高价，该交易日不计入样本。'];
    return [];
  }
  function rowInfo(m) {
    const [what, read] = notes[m.id], first = m.id === 'ddMax' ? what.replace('数据起点', ' ' + firstYear() + ' 年数据起点') : what;
    const fit = fitLine(m);
    return info(m.id, '关于' + label(m), label(m), [esc(first), esc(read), ...sourceLines(m), ...(fit ? ['<span class="cs-info-fit">' + fit + '</span>'] : [])]);
  }
  function strip(m, v, range) {
    const s = data.stats[m.id];
    if (!s || s.n < 2) return '<span class="cs-strip"></span>';
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
  // A lookback typed into the name itself, e.g. "近 [10] 日涨跌".
  function nameHtml(m) {
    if (!m.param) return esc(label(m));
    const spec = C.params[m.param], names = { rNDays:'近 N 日涨跌的交易日数', ddNDays:'最高收盘的回看交易日数', dropsPct:'大跌的单日跌幅门槛（%）' };
    const field = '<input class="cs-param" type="number" inputmode="decimal" data-cs-param="' + m.param + '" value="' + st.params[m.param] + '" min="' + spec.min +
      '" max="' + spec.max + '" step="' + (spec.integer ? 1 : 0.01) + '" aria-label="' + names[m.param] + '">';
    if (m.id === 'rN') return '近 ' + field + ' 日涨跌';
    if (m.id === 'ddN') return '距近 ' + field + ' 日最高收盘';
    return '近 21 日跌超 ' + field + '% 的天数';
  }
  function choiceRow(m) {
    const range = result.conditions[m.id], p = result.previews[m.id], picked = range ? (range.lo === 1 ? 'yes' : 'no') : 'any', v = result.reference.values[m.id];
    const option = (key, text, n) => '<button type="button" class="cs-choice-option' + (picked === key ? ' active' : '') + '" data-cs-choice="' + m.id + '" data-value="' + key +
      '" aria-pressed="' + (picked === key) + '">' + text + (n == null ? '' : '<small>' + n + ' 段</small>') + '</button>';
    return '<div class="cs-row cs-row-choice' + (range ? ' is-active' : '') + '">' +
      '<div class="cs-name"><span class="cs-name-text">' + esc(label(m)) + '</span>' + rowInfo(m) + '</div>' +
      '<span class="cs-now"><b>' + value(m, v) + '</b><small>' + nowNote(m, v, null) + '</small></span>' +
      '<span class="cs-range cs-choice" role="group" aria-label="' + esc(label(m)) + '">' + option('any', '不限') + option('yes', choices[m.id].yes, p?.yes) +
      option('no', choices[m.id].no, p?.no) + '</span><span class="cs-count">' + (p?.without != null ? '不限时 <b>' + p.without + '</b> 段' : '') + '</span></div>';
  }
  function row(m) {
    if (m.choice) return choiceRow(m);
    const range = result.conditions[m.id], v = result.reference.values[m.id], p = C.percentile(data, m.id, v);
    const preview = result.previews[m.id], name = label(m), unit = m.unit;
    const input = side => '<input id="cs-' + m.id + '-' + side + '" type="number" inputmode="decimal" step="any" data-cs-metric="' + m.id +
      '" data-cs-bound="' + side + '" value="' + (range?.[side] ?? '') + '" placeholder="不限" aria-label="' + esc(name + (side === 'lo' ? ' 下限' : ' 上限') + (unit ? '（' + unit + '）' : '')) + '">';
    const count = !preview ? '' : preview.kind === 'without' ? '去掉后 <b>' + preview.episodes + '</b> 段' : '勾选后 <b>' + preview.episodes + '</b> 段';
    return '<div class="cs-row' + (range ? ' is-active' : '') + '">' +
      '<div class="cs-name"><label><input id="cs-' + m.id + '-on" type="checkbox" data-cs-toggle="' + m.id + '" aria-label="' + esc(name) + '"' + (range ? ' checked' : '') +
      (preview || range ? '' : ' disabled') + '><span>' + nameHtml(m) + (hint(m) ? '<small>' + esc(hint(m)) + '</small>' : '') + '</span></label>' + rowInfo(m) + '</div>' +
      '<span class="cs-now"><b>' + value(m, v) + '</b><small>' + nowNote(m, v, p) + '</small></span>' +
      strip(m, v, range) +
      '<span class="cs-range">' + input('lo') + '<span>至</span>' + input('hi') + '<span class="cs-unit">' + esc(unit) + '</span></span>' +
      '<span class="cs-count">' + count + '</span></div>';
  }
  function conditionPanel() {
    const date = data.dates[ref], n = Object.keys(result.conditions).length;
    const legend = (g, title) => g === 'obs' ? '观察期 · 信号后 ' + st.wait + ' 个交易日' + (st.basis === 'high' ? ' · 按盘中最高价判定收复' : '') : title;
    return '<section class="cs-conditions" aria-labelledby="cs-conditions-title"><div class="cs-conditions-head">' +
      '<div class="cs-conditions-title"><h2 id="cs-conditions-title">条件</h2><p>' + fitNote() + '</p></div>' +
      '<div class="cs-conditions-actions"><span class="cs-fit"><button type="button" class="btn sm" data-cs-action="fit" aria-pressed="' + !st.manual + '">' +
      (st.manual ? '按参照日匹配' : '✓ 已按参照日匹配') + '</button>' + fitInfo() + '</span>' +
      (n ? '<button type="button" class="text-link" data-cs-action="clear">清除全部条件</button>' : '') + '</div>' +
      '<div class="cs-conditions-status"><p class="cs-match" role="status">匹配 <b>' + result.episodes.length + '</b> 段 · ' +
      result.matchingDays.toLocaleString('zh-CN') + ' 个交易日满足条件</p>' + referenceStatus() +
      '<p class="cs-key" aria-hidden="true"><span class="cs-key-now"></span>参照日读数<span class="cs-key-band"></span>条件范围<span class="cs-key-iqr"></span>历史中间 50%</p></div></div>' +
      '<div class="cs-groups">' + C.groups.filter(([g]) => g !== 'obs' || st.wait).map(([g, title]) => '<fieldset class="cs-group cs-group-' + g + '"><legend>' + legend(g, title) +
        '</legend><div class="cs-row cs-row-head" aria-hidden="true"><span>指标</span><span>' + date + (g === 'obs' ? ' 起' : '') + '</span><span>历史分布</span><span>' +
        (g === 'obs' ? '范围' : '范围（含边界）') + '</span><span>样本</span></div>' + C.metrics.filter(m => m.group === g).map(row).join('') + '</fieldset>').join('') +
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
  function frame(id, { lines, thin = [], band = null, labels = [], caption, legend, marks = [] }) {
    const width = 1200, height = 380, left = 58, right = 1080, top = 22, bottom = 330, x0 = -C.lookback, x1 = C.chartAfter;
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
      '<line class="cs-signal" x1="' + sx(0).toFixed(1) + '" x2="' + sx(0).toFixed(1) + '" y1="' + top + '" y2="' + bottom + '"/>' +
      marks.filter(mark => mark.k > x0 && mark.k <= x1).map(mark => '<line class="cs-mark" x1="' + sx(mark.k).toFixed(1) + '" x2="' + sx(mark.k).toFixed(1) + '" y1="' + top + '" y2="' + bottom + '"/>' +
        '<text class="cs-axis cs-mark-label" x="' + (sx(mark.k) + 5).toFixed(1) + '" y="' + (top + 12) + '">' + esc(mark.text) + '</text>').join('') + xticks +
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
  const refPath = () => C.path(data, ref, C.lookback, ref === data.last ? 0 : C.chartAfter);
  const refName = () => ref === data.last ? '最新' : '参照日';
  const refLegend = points => ref === data.last ? '最近 ' + (points.length - 1) + ' 个交易日（' + data.dates[data.last - points.length + 1] + ' 至 ' + data.asOf + '）' :
    '参照日 ' + data.dates[ref] + ' 前后';
  const waitMark = () => st.wait ? [{ k:st.wait, text:'观察期末' }] : [];
  function mainChart() {
    const indices = result.episodes.map(e => e.index), rows = result.spread || (result.spread = C.spread(data, indices));
    const now = refPath(), many = indices.length > maxLines;
    const median = rows.filter(r => r.n >= minBand).map(r => [r.k, r.median]);
    const end = median.at(-1), forward = rows.filter(r => r.k > 0 && r.n >= minBand);
    const start = now.find(p => p[0] === -C.lookback) || now[0], tail = now.at(-1);
    const lines = [...(median.length > 1 ? [{ label:'中位数', cls:'cs-line-median', points:median }] : []), { label:refName(), cls:'cs-line-now', points:now }];
    const labels = [{ text:refName(), k:start[0], v:start[1], dy:-10 }, ...(end ? [{ text:'中位数 ' + pct(end[1] - 100), k:end[0], v:end[1] }] : []),
      ...(ref < data.last && tail[0] > 0 ? [{ text:pct(tail[1] - 100), k:tail[0], v:tail[1], anchor:tail[0] > 230 ? 'end' : 'start', dy:-10 }] : [])];
    const legend = '<div class="cs-legend">' + key('cs-key-line-now', refLegend(now)) +
      (median.length > 1 ? key('cs-key-line-median', '历史中位数') + key('cs-key-area', '中间 50% 区间') : '') +
      (many ? '' : key('cs-key-line-episode', '各段实际走势')) + '</div>';
    const caption = '每段以信号日收盘为 100，' + (ref === data.last ? '最新路径以 ' + data.asOf : '参照日路径以 ' + data.dates[ref]) + ' 收盘为 100。' +
      (forward.length && forward.at(-1).n < indices.length ? '较新的样本尚未走完，右侧只计已发生部分。' : '') + (many ? '共 ' + indices.length + ' 段，只画中位数与区间。' : '');
    return '<section class="ds-panel cs-chart-panel"><div class="ds-panel-head"><div><h2>信号前后的走势</h2><p>前 ' + C.lookback + ' 个交易日至后 ' + C.chartAfter +
      ' 个交易日 · ' + indices.length + ' 段匹配样本</p></div></div>' +
      frame('main', { lines, thin:many ? [] : result.episodes.map(e => ({ label:e.date, points:C.path(data, e.index) })), band:indices.length >= minBand ? rows : null,
        labels, caption, legend, marks:waitMark() }) + '</section>';
  }
  function episodeChart(e) {
    const own = C.path(data, e.index), lines = [{ label:e.date, cls:'cs-line-median', points:own }];
    if (e.index !== ref) lines.push({ label:refName(), cls:'cs-line-now', points:refPath() });
    const legend = '<div class="cs-legend">' + key('cs-key-line-median', e.date + ' 前后') + (e.index !== ref ? key('cs-key-line-now', refLegend(refPath())) : '') + '</div>';
    return frame('event', { lines, labels:[{ text:pct(own.at(-1)[1] - 100), k:own.at(-1)[0], v:own.at(-1)[1] }], legend, marks:waitMark(),
      caption:e.date + ' 收盘为 100；' + (own.at(-1)[0] < C.chartAfter ? '已观察 ' + own.at(-1)[0] + ' / ' + C.chartAfter + ' 个交易日。' : '已走完 ' + C.chartAfter + ' 个交易日。') });
  }
  function tipRow(cls, text, strong) {
    const row = document.createElement('div'), mark = document.createElement('i'), name = document.createElement('span'), amount = document.createElement('b');
    mark.className = cls; name.textContent = text; amount.textContent = strong;
    row.append(mark, amount, name);
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

  const anchorName = () => st.wait ? '起算日' : '信号日';
  function summaryPanel() {
    const n = result.episodes.length, longest = result.horizons.at(-1);
    const rows = result.horizons.map(h => {
      const s = result.summary[h], b = result.baseline[h];
      const waiting = [s.pending ? s.pending + ' 段未到期' : '', s.gap ? s.gap + ' 段行情断档' : ''].filter(Boolean).join(' · ');
      return '<tr><th scope="row">' + terms[h] + '<small>' + h + ' 个交易日</small></th><td>' + s.n + (waiting ? '<small>' + waiting + '</small>' : '') + '</td>' +
        '<td><strong>' + signed(s.median) + '</strong></td><td>' + signed(s.mean) + '</td><td>' + share(s.upPct) + '</td>' +
        '<td class="cs-base-cell">' + pct(b.median) + '</td><td class="cs-base-cell">' + share(b.upPct) + '</td>' +
        '<td class="cs-risk-cell">' + signed(s.drawdown.median) + '</td><td>' + signed(s.drawdown.min) + '</td><td class="cs-base-cell">' + pct(b.drawdown.median) + '</td>' +
        '<td class="cs-risk-cell">' + signed(s.low.median) + '</td><td>' + signed(s.low.min) + '</td></tr>';
    }).join('');
    const few = result.summary[longest].n;
    const spacing = st.gap === 1 ? '每个满足条件的交易日单独计，相邻样本的后续区间大量重叠' : '相邻样本至少相隔 ' + result.gap + ' 个交易日，后续区间仍可能重叠，样本数不等于独立行情的次数';
    return '<section class="ds-panel" aria-labelledby="cs-summary-title"><div class="ds-panel-head"><div><h2 id="cs-summary-title">满足条件之后，指数涨跌多少？</h2>' +
      '<p>' + (st.wait ? '从信号后第 ' + st.wait + ' 个交易日（观察期末）收盘起算' : '从信号日收盘起算') + ' · 美元价格指数累计涨跌，不含分红</p></div><span class="ds-coverage">' +
      result.first + ' — ' + result.asOf + '</span></div>' +
      '<div class="ds-scroll"><table class="cs-summary"><thead><tr><th rowspan="2" scope="col">后续期限</th><th rowspan="2" scope="col">有效样本</th>' +
      '<th colspan="3" scope="colgroup">匹配的 ' + n + ' 段</th><th colspan="2" scope="colgroup" class="cs-base-cell">全部交易日</th>' +
      '<th colspan="3" scope="colgroup" class="cs-risk-cell">期间最大回撤</th><th colspan="2" scope="colgroup" class="cs-risk-cell">自' + anchorName() + '最大跌幅</th></tr>' +
      '<tr><th>中位数</th><th>平均数</th><th>上涨占比</th><th class="cs-base-cell">中位数</th><th class="cs-base-cell">上涨占比</th>' +
      '<th class="cs-risk-cell">中位数</th><th>最深</th><th class="cs-base-cell">全部交易日</th><th class="cs-risk-cell">中位数</th><th>最深</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ds-foot">' + spacing + (st.era !== 'all' ? '；已排除 2000—2002 年的信号' : '') +
      (few > 0 && few < 5 ? '；' + terms[longest] + '期只有 ' + few + ' 段完整结果，可逐段查看' : '') + '。</div></section>';
  }
  const pages = () => Math.max(1, Math.ceil(result.episodes.length / pageSize));
  function fallCell(f) {
    const where = f.pct === 0 ? '未再跌破' : '第 ' + f.days + ' 日 · ' + f.date;
    return signed(f.pct) + '<small>' + where + (f.status === 'pending' ? ' · 至今' : f.status === 'gap' ? ' · 断档前' : '') + '</small>';
  }
  function observationCell(o) {
    const path = o.recovered === null ? (o.missingHigh ? '缺最高价' : '缺前一日收盘') : !o.recovered ? '始终未收复' :
      (st.basis === 'high' ? '盘中曾触及，期末' : '曾收复，期末') + (o.anchorClose >= o.prior ? '守住' : '回落');
    return path + '<small>观察期 ' + pct(o.move) + (o.broke ? ' · 曾跌破信号日收盘' : '') + '</small>';
  }
  function episodesPanel() {
    const ids = Object.keys(result.conditions), rows = result.episodes, longest = result.horizons.at(-1);
    page = Math.min(page, pages());
    const cell = o => o.status === 'complete' ? signed(o.pct) + '<small>回撤 ' + pct(o.drawdown) + '</small>' : '<span class="ds-faint">' + status[o.status] + '</span>';
    return '<section class="ds-panel"><div class="ds-panel-head"><div><h2>逐段记录</h2><p>' + (st.gap === 1 ? '每个满足条件的交易日都是信号日' : '每段取首个满足条件的交易日为信号日') +
      ' · ' + rows.length + ' 段</p></div>' +
      '<button type="button" class="btn sm" data-cs-action="csv"' + (rows.length ? '' : ' disabled') + '>导出全部 ' + rows.length + ' 段 CSV</button></div>' +
      (rows.length ? '<div class="ds-scroll"><table class="cs-events"><thead><tr><th scope="col">信号日</th><th scope="col">收盘</th>' +
        (st.wait ? '<th scope="col">观察 ' + st.wait + ' 日结果</th><th scope="col">起算日</th>' : '') +
        ids.map(id => '<th scope="col">' + shortLabel(id) + '</th>').join('') +
        '<th scope="col" class="cs-fall">自信号日最大跌幅<small>' + (st.wait ? '观察期及' : '') + terms[longest] + '内</small></th>' +
        result.horizons.map(h => '<th scope="col">' + terms[h] + '后</th>').join('') + '</tr></thead><tbody>' +
        rows.slice((page - 1) * pageSize, page * pageSize).map(e => '<tr><th scope="row"><button type="button" class="text-link" data-cs-event="' + e.date + '" aria-label="查看 ' + e.date + ' 前后走势">' + e.date + '</button>' +
          (result.reference.episode === e.date ? '<small class="cs-tag">含' + (ref === data.last ? '最新收盘' : '参照日') + '</small>' : '') + '</th><td>' + fixed(e.close) + '</td>' +
          (st.wait ? '<td>' + observationCell(e.observation) + '</td><td>' + e.observation.anchorDate + '</td>' : '') +
          ids.map(id => '<td>' + value(C.byId[id], e.values[id]) + '</td>').join('') + '<td class="cs-fall">' + fallCell(e.fall) + '</td>' +
          result.horizons.map(h => '<td>' + cell(e.outcomes[h]) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>' + (pages() > 1 ? '<div class="ds-pagination"><span>第 ' + page + ' / ' + pages() + ' 页</span><button type="button" class="btn sm" data-cs-action="prev"' + (page === 1 ? ' disabled' : '') +
        '>上一页</button><button type="button" class="btn sm" data-cs-action="next"' + (page === pages() ? ' disabled' : '') + '>下一页</button></div>' : '') :
        '<p class="ds-foot">没有同时满足全部条件的交易日。可去掉或放宽一项：每行右侧显示去掉它之后的段数。</p>') + '</section>';
  }
  function emptyState() {
    return '<section class="ds-panel cs-empty" role="status"><h2>尚未选择条件</h2><p>勾选或填写上方任一指标后显示匹配的历史样本。</p></section>';
  }
  function timeline(e) {
    const o = e.observation, high = st.basis === 'high';
    const rows = [['前一日', o.priorDate, o.prior, undefined], ['信号日', e.date, e.close, undefined], ...o.days.map((d, k) => ['第 ' + (k + 1) + ' 日', d[0], d[1], d[2]])];
    const body = rows.map(([name, date, close, top]) => '<tr' + (date === o.recoveryDate ? ' class="is-touch"' : '') + '><th scope="row">' + name + '</th><td>' + (date || '—') + '</td><td>' +
      (close == null ? '—' : fixed(close)) + '</td>' + (high ? '<td>' + (top === undefined ? '' : top === null ? '缺数据' : fixed(top)) + '</td>' : '') + '</tr>').join('');
    const table = '<div class="ds-scroll cs-timeline"><table><thead><tr><th>观察</th><th>日期</th><th>收盘</th>' + (high ? '<th>盘中最高</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    const summary = (o.recovered === null ? (o.missingHigh ? '缺 ' + dateList(o.missingHighDates) + ' 最高价，收复无法判断' : '缺前一日收盘，收复无法判断') :
      o.recovered ? o.recoveryDate + (high ? ' 盘中触及' : ' 收盘收复') + '前一日收盘 ' + fixed(o.prior) : st.wait + ' 个交易日都低于前一日收盘 ' + fixed(o.prior)) +
      '；后续收益从 ' + o.anchorDate + ' 收盘 ' + fixed(o.anchorClose) + ' 点起算。';
    return '<div class="cs-observation"><h3>观察期 · ' + st.wait + ' 个交易日</h3><p>' + summary + '</p>' +
      (o.days.length > 8 ? '<details><summary>逐日记录 · ' + o.days.length + ' 个交易日</summary>' + table + '</details>' : table) + '</div>';
  }
  function detail(e) {
    const groups = C.groups.filter(([g]) => g !== 'obs' || st.wait).map(([g, title]) => '<div class="cs-detail-group"><h3>' + title + '</h3><dl>' + C.metrics.filter(m => m.group === g).map(m =>
      '<div' + (result.conditions[m.id] ? ' class="is-active"' : '') + '><dt>' + esc(label(m)) + '</dt><dd>' + value(m, e.values[m.id]) + '</dd></div>').join('') + '</dl></div>').join('');
    const rows = result.horizons.map(h => {
      const o = e.outcomes[h];
      return '<tr><th scope="row">' + terms[h] + '</th><td>' + (o.date || status[o.status]) + '</td><td>' + (o.close == null ? '—' : fixed(o.close)) + '</td><td>' + signed(o.pct) +
        '</td><td>' + signed(o.drawdown) + '</td><td>' + signed(o.low) + '</td></tr>';
    }).join('');
    const f = e.fall, fall = '自信号日最大跌幅 <b>' + pct(f.pct) + '</b>（' + (f.pct === 0 ? '其后收盘未再低于信号日' : f.date + ' 收盘，第 ' + f.days + ' 个交易日') +
      '；统计至 ' + f.through + (f.status === 'complete' ? '' : f.status === 'pending' ? '，窗口尚未走完' : '，其后行情断档') + '）';
    H.openModal(H.modalTitle(e.date + ' · ' + markets[st.market][0], '信号日收盘 ' + fixed(e.close) + ' 点 · 美元价格指数，不含分红') + '<div class="cs-detail">' + episodeChart(e) +
      '<p class="cs-detail-fall">' + fall + '</p>' + (st.wait ? timeline(e) : '') +
      '<div class="ds-scroll"><table class="cs-detail-table"><thead><tr><th>后续期限</th><th>实际期末日</th><th>期末收盘</th><th>累计涨跌</th><th>期间最大回撤</th><th>自' + anchorName() + '最大跌幅</th></tr></thead><tbody>' +
      rows + '</tbody></table></div><div class="cs-detail-groups">' + groups + '</div></div>');
  }
  function exportCsv() {
    const conditions = Object.entries(result.conditions).map(([id, range]) => label(C.byId[id]) + ' ' + rangeText(C.byId[id], range)).join('；') || '不限';
    const metrics = C.metrics.filter(m => m.source !== 'obs');
    const header = ['指数', '口径', '行情截至', '参照日', '条件来源', '条件', '相邻样本至少相隔交易日', '观察期交易日', '收复判定', '历史范围', '信号日', '信号收盘',
      ...metrics.map(m => label(m) + (m.unit ? '（' + m.unit + '）' : '')),
      ...(st.wait ? ['观察状态', '前一日', '前一日收盘', '观察期内收复前一日收盘', '首次收复日', '观察期内跌破信号日收盘', '期末收回比例%', '观察期涨跌%', '起算日', '起算收盘'] : []),
      '自信号日最大跌幅%', '最大跌幅日', '距信号日交易日数', '最大跌幅统计至', '最大跌幅窗口',
      ...result.horizons.flatMap(h => [terms[h] + '状态', terms[h] + '实际期末日', terms[h] + '期末收盘', terms[h] + '累计涨跌%', terms[h] + '期间最大回撤%', terms[h] + '自' + anchorName() + '最大跌幅%'])];
    const rows = result.episodes.map(e => {
      const o = e.observation, f = e.fall;
      return [markets[st.market][1], '美元价格指数，不含分红', result.asOf, data.dates[ref], st.manual ? '自选' : '按 ' + fitted.date + ' 读数自动选取', conditions, result.gap,
        st.wait, st.wait ? basisNames[st.basis] : '', eraNames[st.era], e.date, e.close, ...metrics.map(m => e.values[m.id]),
        ...(st.wait ? [o.status === 'complete' ? '已完成' : o.status, o.priorDate, o.prior, o.recovered === null ? '未知' : o.recovered ? '是' : '否', o.recoveryDate, o.broke ? '是' : '否',
          o.rebound, o.move, o.anchorDate, o.anchorClose] : []),
        f.pct, f.date, f.days, f.through, f.status === 'complete' ? '完整' : f.status === 'pending' ? '未走完' : '行情断档',
        ...result.horizons.flatMap(h => { const x = e.outcomes[h]; return [status[x.status], x.date, x.close, x.pct, x.drawdown, x.low]; })];
    });
    H.download('行情条件后表现-' + markets[st.market][0] + '-' + result.asOf + '.csv', M.csv([header, ...rows]), 'text/csv;charset=utf-8');
  }
  function method() {
    return '<details class="ds-method"><summary>条件、样本与收益口径</summary>' +
      '<p>信号日读数只用当天及以前的收盘：涨跌与 N 个交易日前的收盘比较；回撤取含当天的 N 个收盘中的最高点；均线含当天；波动率为 21 个日对数收益的样本标准差年化；RSI 为 14 日 Wilder 平滑；「信号前一日」各项截至前一交易日。范围两端都包含在内，留空表示不限。</p>' +
      '<p>设置观察期后，信号日之后的 N 个交易日用于判断是否收复前一日收盘、是否跌破信号日收盘等；观察期走完才计入样本，后续收益从观察期末收盘起算。按盘中最高价判定时，观察期内每天都须有已收盘的最高价。</p>' +
      '<p>一段从首个满足全部条件的交易日开始，其后若干交易日内再次满足的日期并入同一段；选择「不合并」时每个交易日单独计。按参照日匹配时，依次尝试' + esc(fitList()) + '；每项取参照日读数附近的范围，读数处于历史最低或最高的 10% 时改为单侧，加入后不足 10 段的项目不勾选。VIX 为 Cboe 官方日收盘，只按同一日期配对。</p>' +
      '<p>结果描述历史样本，不代表下一次的概率；样本少时，范围稍变就可能明显改变结果。</p>' +
      '<p><a href="https://finance.yahoo.com/quote/' + encodeURIComponent(markets[st.market][1]) + '/history/" target="_blank" rel="noopener noreferrer">指数历史收盘 ↗</a> · ' +
      '<a href="https://github.com/jianxieb/fund-data/blob/main/docs/condition-study-method.md" target="_blank" rel="noopener noreferrer">完整方法与核对记录 ↗</a></p></details>';
  }

  function view(helpers) {
    H = helpers; st = readState();
    const title = H.head('MARKET CONDITION STUDY', '行情条件后表现', '自填条件或按任一交易日的行情读数筛选历史交易日，查看之后几天至两年的涨跌与回撤。');
    const other = peerOf(st.market);
    if (!cache.has(st.market)) load(st.market);
    if (!cache.has(other)) load(other);
    const slot = cache.get(st.market), peer = cache.get(other);
    if (!slot.data) return title + '<div class="ds-panel ds-loading" role="status">' + (slot.error ? esc(slot.error) + ' <button type="button" class="text-link" data-cs-action="retry">重新加载</button>' :
      '正在读取' + markets[st.market][0] + '历史收盘…') + '</div>';
    const needHighs = st.wait > 0 && st.basis === 'high';
    if (needHighs && !highCache.has(st.market)) loadHigh(st.market);
    const highSlot = needHighs ? highCache.get(st.market) : null;
    const frameKey = [st.market, slot.data.asOf, Object.values(st.params).join(','), st.wait, st.wait ? st.basis : '', peer?.data ? 'peer' : '', highSlot?.series ? 'highs' : ''].join('|');
    if (!frames.has(frameKey)) frames.set(frameKey, C.frame(slot.data, { params:st.params, wait:st.wait, basis:st.basis, peer:peer?.data ? peer.series : null, highs:highSlot?.series || null }));
    data = frames.get(frameKey);
    ref = st.date ? C.sessionOn(data, st.date) ?? 0 : data.last;
    if (needHighs && !highSlot.series && !highSlot.error) return title + toolbar() + '<div class="ds-panel ds-loading" role="status">正在读取已收盘交易日的历史最高价…</div>';
    fitted = st.manual ? null : fitFor(frameKey);
    const conditions = st.manual ? st.conditions : fitted.conditions;
    const sig = JSON.stringify([frameKey, st.gap, st.era, st.horizons, ref, C.metrics.map(m => conditions[m.id] ? C.formatRange(conditions[m.id]) : '')]);
    if (sig !== signature) { signature = sig; page = 1; }
    if (!results.has(sig)) results.set(sig, C.study(data, { conditions, gap:st.gap, era:st.era, horizons:st.horizons, ref }));
    result = results.get(sig);
    charts.clear();
    return title + toolbar() + highNote() + conditionPanel() + (Object.keys(result.conditions).length ? mainChart() + summaryPanel() + episodesPanel() : emptyState()) + method();
  }
  function choose(k, v) {
    const next = readState();
    if (k === 'market' && Object.hasOwn(markets, v)) next.market = v;
    else if (k === 'gap' && C.validGap(Number(v))) next.gap = Number(v);
    else if (k === 'era' && C.validEra(v)) next.era = v;
    else if (k === 'basis' && Object.hasOwn(basisNames, v)) next.basis = v;
    else if (k === 'wait' && v === 'custom') { askWait(); return; }
    else if (k === 'wait' && C.validWait(Number(v))) next.wait = Number(v);
    else return;
    write(next);
  }
  function askWait() {
    H.openModal(H.modalTitle('自定义观察期', '信号日之后观察的交易日数；后续收益从观察期末收盘起算。') +
      '<form id="cs-wait-form"><label>观察交易日数（1–252）<input name="wait" type="number" min="1" max="252" step="1" required value="' + (st.wait || 2) + '"></label>' +
      '<button type="submit" class="btn primary">应用</button></form>');
    const input = document.querySelector('#cs-wait-form input');
    input?.focus(); input?.select();
  }
  function toggle(id, on) {
    const conditions = { ...result.conditions };
    if (on) {
      const band = C.suggest(data, id, { ref });
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
  function editParam(input) {
    const k = input.dataset.csParam, v = Number(String(input.value).trim());
    if (!Object.hasOwn(C.params, k)) return;
    if (input.validity?.badInput || !C.validParam(k, v)) { input.setCustomValidity(paramIssues[k]); input.reportValidity?.(); return; }
    // Ticked ranges stay as typed and are re-read with the new N; an automatic match stays automatic.
    write({ ...st, params:{ ...st.params, [k]:v } });
  }
  function editDate(input) {
    if (!input.value) { write({ ...readState(), date:null }); return; }
    const at = C.sessionOn(data, input.value) ?? 0;
    write({ ...readState(), date:at === data.last ? null : data.dates[at] });
  }
  function pickChoice(id, picked) {
    const conditions = { ...result.conditions };
    if (picked === 'yes') conditions[id] = { lo:1, hi:1 };
    else if (picked === 'no') conditions[id] = { lo:0, hi:0 };
    else delete conditions[id];
    write({ ...st, manual:true, conditions });
  }
  const active = () => H && location.hash.split('?')[0] === route && result;
  document.addEventListener('change', event => {
    const el = event.target;
    if (!active() || !el?.dataset) return;
    if (el.dataset.csToggle) toggle(el.dataset.csToggle, el.checked);
    // A change on blur fires before focus reaches the next field; render after it lands so focus is kept.
    else if (el.dataset.csMetric) setTimeout(() => { if (active()) edit(el); }, 0);
    else if (el.dataset.csParam) setTimeout(() => { if (active()) editParam(el); }, 0);
    else if (el.id === 'cs-ref') setTimeout(() => { if (active()) editDate(el); }, 0);
  });
  document.addEventListener('input', event => { if (event.target?.dataset?.csMetric || event.target?.dataset?.csParam) event.target.setCustomValidity(''); });
  document.addEventListener('submit', event => {
    if (event.target?.id !== 'cs-wait-form') return;
    event.preventDefault();
    const wait = event.target.elements.wait.valueAsNumber;
    if (!(wait >= 1) || !C.validWait(wait)) return;
    event.target.closest('dialog')?.close();
    write({ ...readState(), wait });
  });
  document.addEventListener('click', event => {
    if (!H) return;
    const target = event.target;
    const row = target.closest?.('[data-cs-event]');
    if (row && result) { const e = result.episodes.find(x => x.date === row.dataset.csEvent); if (e) detail(e); return; }
    const chip = target.closest?.('[data-cs-horizon]');
    if (chip && result && !chip.disabled) {
      const h = Number(chip.dataset.csHorizon), list = st.horizons.includes(h) ? st.horizons.filter(x => x !== h) : [...st.horizons, h];
      if (list.length) write({ ...readState(), horizons:C.horizonChoices.filter(x => list.includes(x)) });
      return;
    }
    const pick = target.closest?.('[data-cs-choice]');
    if (pick && result) { pickChoice(pick.dataset.csChoice, pick.dataset.value); return; }
    const button = target.closest?.('[data-cs-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.csAction) {
      case 'fit': write({ ...readState(), manual:false, conditions:{} }); break;
      case 'clear': write({ ...readState(), manual:true, conditions:{} }); break;
      case 'latest': write({ ...readState(), date:null }); break;
      case 'retry': cache.delete(readState().market); results.clear(); fits.clear(); frames.clear(); H.render(); break;
      case 'retry-high': highCache.delete(readState().market); H.render(); break;
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
  document.addEventListener('beforetoggle', event => {
    const pop = event.target;
    if (event.newState !== 'open' || !pop.classList?.contains('cs-info-pop')) return;
    const button = document.querySelector('[popovertarget="' + pop.id + '"]');
    if (!button) return;
    const box = button.getBoundingClientRect(), width = Math.min(360, innerWidth - 32);
    pop.style.width = width + 'px';
    pop.style.left = Math.round(scrollX + Math.max(16, Math.min(box.left, innerWidth - width - 16))) + 'px';
    pop.style.top = Math.round(scrollY + box.bottom + 6) + 'px';
  }, true);
  // Near the bottom edge, open upward instead once the height is known.
  document.addEventListener('toggle', event => {
    const pop = event.target;
    if (event.newState !== 'open' || !pop.classList?.contains('cs-info-pop')) return;
    const button = document.querySelector('[popovertarget="' + pop.id + '"]'), box = button?.getBoundingClientRect();
    if (box && box.bottom + 6 + pop.offsetHeight > innerHeight && box.top - 6 - pop.offsetHeight > 0)
      pop.style.top = Math.round(scrollY + box.top - 6 - pop.offsetHeight) + 'px';
  }, true);
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
  window.ChanghengConditionStudy = { view, choose, legacy };
})();
