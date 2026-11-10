(function () {
  'use strict';
  const D = window.ChanghengDropStudyModel, W = window.ChanghengDropWindowModel, R = window.ChanghengResearchHistory, M = window.Changheng;
  const markets = { ndx:['纳斯达克100','^NDX'], spx:['标普500','^GSPC'] };
  const groups = { unrecovered:'始终未收复', recovered:'至少一次收复', all:'全部已观察事件' };
  const statuses = { ...groups, pending:'观察中', gap:'观察期行情断档' };
  const horizons = D.horizons, terms = { 5:'1周', 21:'1个月', 63:'3个月', 252:'1年' };
  const dropCutoff = () => '跌超 ' + state.threshold + '%';
  const facetLabels = {
    get rebound(){return state.group==='recovered'
      ? {any:'不限',full:'守住跌前收盘（收回 ≥100%）',half:'回落，收回 50% 至不足 100%',partial:'回落，收回部分但不足 50%',none:'回落到大跌日收盘或更低'}
      : {any:'不限',none:'未收回或继续下跌',partial:'收回部分但不足 50%',half:'收回 50% 至不足 100%',full:'收回全部或更多'};},
    get repeat(){return {any:'不限',first:'没有一天'+dropCutoff(),repeat:'至少一天'+dropCutoff()};},
    trend:{any:'不限',above:'高于均线',below:'等于或低于均线'},
    drawdown:{any:'不限',near:'不足 5%',pullback:'5% 至不足 10%',correction:'10% 至不足 20%',bear:'20% 及以上'},
    cap:Object.fromEntries(D.facetOptions.cap.map(v=>[v,v==='any'?'不限':'不超过 '+v+'%'])),
    peer:{any:'不限',up:'持平或上涨',mild:'下跌不足 2%',moderate:'下跌 2% 至不足 4%',severe:'下跌 4% 及以上'},
    vol:{any:'不限',calm:'低于 20%',active:'20% 至不足 30%',high:'30% 及以上'},
    low:{any:'不限',hold:'收盘未再跌破',break:'收盘曾再跌破'}
  };
  const advancedKeys = ['trend','drawdown','vol','cap','peer','low'];
  const facetKeys = Object.keys(facetLabels);
  const facetDefaults = Object.fromEntries(facetKeys.map(k=>[k,'any']));
  const windowRules = {
    peak:{label:'距区间最高收盘的回撤',metric:'回撤',days:252,min:10,minDays:2,source:'区间最高收盘',description:'从区间内最高收盘到大跌日收盘；回看天数含大跌当天。'},
    loss:{label:'近 N 个交易日累计跌幅',metric:'累计跌幅',days:5,min:5,minDays:1,source:'区间起算收盘',description:'比较大跌日与 N 个交易日前的收盘，期间不要求每天都下跌。'}
  };
  const windowKeys = Object.keys(windowRules);
  const windowDefaults = Object.fromEntries(windowKeys.flatMap(k=>[[k+'Days',windowRules[k].days],[k+'Min',null]]));
  const defaults = { market:'ndx', threshold:5, wait:2, group:'unrecovered', ...facetDefaults, ...windowDefaults };
  const options = { market:Object.keys(markets), wait:D.waits, group:Object.keys(groups), ...D.facetOptions };
  const thresholds = [3,4,5,6,7,8,9,10];
  const fmt = n => n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const pct = n => n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
  const signed = n => '<span class="' + (n < 0 ? 'negative' : n > 0 ? 'positive' : '') + '">' + pct(n) + '</span>';
  const escape = M.escapeHtml;
  const cache = new Map();
  let H, state, result, signature, resultPeer, horizon = 252, bin = null, page = 1, showBaseline = false, showExtra = false;
  const size = 10;
  const peerMarket = () => state.market === 'ndx' ? 'spx' : 'ndx';
  const peerName = () => markets[peerMarket()][0];

  function readState() {
    const q = new URLSearchParams(location.hash.split('?')[1]);
    const threshold = Number(q.get('threshold'));
    const windows = {...windowDefaults};
    for (const k of windowKeys) {
      const days = q.has(k+'Days') ? Number(q.get(k+'Days')) : windowDefaults[k+'Days'], min = Number(q.get(k+'Min'));
      if (W.validDays(k,days) && W.validThreshold(min)) {
        windows[k+'Days'] = days; windows[k+'Min'] = min;
      }
    }
    return { threshold:D.validThreshold(threshold) ? threshold : defaults.threshold, ...windows,
      ...Object.fromEntries(Object.entries(options).map(([k, values]) =>
        [k, values.find(v => String(v) === q.get(k)) ?? defaults[k]])) };
  }
  function redraw() {
    if (location.hash.split('?')[0] === '#drop-study') H.render();
  }
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
      slot.series = history.series;
    } catch (e) { slot.error = e.message || '无法读取指数日线'; }
    redraw();
  }

  function select(label, key, choices) {
    return H.menu('ds-'+key,label,choices,state[key]);
  }
  const filterNames = {
    get rebound(){return '第 '+state.wait+' 天收盘：'+(state.group==='recovered'?'守住还是回落':'收回多少原跌幅');},
    get repeat(){return '此前 21 个交易日单日'+dropCutoff();},
    trend:'跌前收盘与 200 日均线', drawdown:'跌前距 252 日最高收盘的回撤',
    vol:'跌前 21 日年化波动率', cap:'大跌日的跌幅上限', get peer(){return peerName()+'同日涨跌';},
    low:'观察期内是否跌破大跌日收盘'
  };
  function peerStatus() {
    const slot = cache.get(peerMarket());
    if (slot?.series) return '';
    return slot?.error ? peerName() + '日线未能读取：' + slot.error : '正在读取' + peerName() + '日线';
  }
  function facetSelect(key) {
    const counts = result?.facetCounts[key];
    const unavailable = key === 'peer' ? peerStatus() : '';
    let values = D.facetOptions[key];
    if (key === 'rebound') {
      if (state.group==='recovered') values = ['any','full','half','partial','none'];
      if (state.group==='unrecovered' && state.rebound!=='full') values = values.filter(v=>v!=='full');
    }
    const choices = values.filter(v=>key!=='cap' || v==='any' || Number(v)>state.threshold || v===state.cap)
      .map(v=>[v,facetLabels[key][v] + (counts && !unavailable ? ' · ' + counts[v] + (key==='repeat'?' 次事件':' 次') : ''),
        key==='rebound' && v!=='any' && (counts?.[v]===0 || (v==='full' && state.group==='unrecovered'))]);
    const missing = {repeat:'缺完整的 21 个日涨跌幅',trend:'缺完整的 200 日收盘',drawdown:'缺完整的 252 日收盘',
      vol:'缺完整的 21 个日涨跌幅',peer:'缺对照指数同一对交易日的收盘'};
    let hint = '';
    if (unavailable) hint = escape(unavailable) + (cache.get(peerMarket())?.error ? ' <button type="button" class="text-link" data-ds-action="retry-peer">重试</button>' : '…');
    else if (key==='rebound' && state.group==='unrecovered' && state.rebound==='full') hint = '期内始终未收复，期末不可能收回全部。 <button type="button" class="text-link" data-ds-action="clear-rebound">清除期末条件</button>';
    else if (key==='rebound' && state.group==='recovered' && counts?.any) hint = '曾收复的 '+counts.any+' 次中，'+counts.full+' 次守住，'+(counts.half+counts.partial+counts.none)+' 次回落。';
    else if (key === 'cap' && capConflict()) hint = '上限须高于起筛跌幅 ' + state.threshold + '%，否则没有匹配事件。';
    else if (counts?.missing && missing[key]) hint = counts.missing + ' 次' + missing[key];
    return '<div>' + select(filterNames[key],key,choices) + (hint ? '<small class="ds-missing">' + hint + '</small>' : '') + '</div>';
  }
  const capConflict = () => state.cap!=='any' && Number(state.cap)<=state.threshold;
  const activeWindows = () => windowKeys.filter(k=>state[k+'Min'] != null);
  const hasFilters = () => activeWindows().length > 0 || facetKeys.some(k=>state[k]!=='any');
  const windowName = k => k === 'peak' ? '距近 ' + state.peakDays + ' 个交易日最高收盘的回撤' : '近 ' + state.lossDays + ' 个交易日累计跌幅';
  const windowShort = k => '近 ' + state[k+'Days'] + ' 个交易日 · ' + windowRules[k].metric + '超过 ' + state[k+'Min'] + '%';
  const windowMissing = k => '缺完整的 ' + state[k+'Days'] + (k==='peak' ? ' 个交易日收盘' : ' 个交易日涨跌幅');
  function windowControl(k) {
    const active = state[k+'Min'] != null, label = windowRules[k].label, c = result?.windowCounts[k];
    const value = active ? windowShort(k) : '不限';
    return '<div class="ds-window-rule"><span id="ds-'+k+'-label">'+label+'</span><div class="ds-window-actions">' +
      '<button type="button" id="ds-'+k+'" class="ds-window-edit" data-ds-action="edit-'+k+'" aria-haspopup="dialog" aria-label="'+label+'：'+value+'，设置条件">'+
      '<span>'+value+'</span><span class="ds-window-verb">'+(active?'修改':'设置')+'</span></button>'+
      (active ? '<button type="button" class="text-link" data-ds-action="clear-'+k+'" aria-label="移除'+label+'条件">移除</button>' : '') + '</div>' +
      (active && c ? '<small class="ds-missing">保留其余条件时，'+c.match+' / '+c.any+' 次符合此项'+(c.missing?'；'+c.missing+' 次'+windowMissing(k):'')+'。</small>' : '') + '</div>';
  }
  function editWindow(k) {
    const spec=windowRules[k];
    H.openModal(H.modalTitle(spec.label,spec.description) + '<form id="ds-window-form" data-rule="'+k+'"><label>回看交易日数<input name="days" type="number" min="'+spec.minDays+'" max="2520" step="1" required value="'+state[k+'Days']+'"></label>'+
      '<label>'+spec.metric+'超过（%）<input name="min" type="number" min="0.01" max="99.99" step="0.01" required value="'+(state[k+'Min']??spec.min)+'"></label>'+
      '<button type="submit" class="btn primary">应用筛选</button></form>');
    const input=document.querySelector('#ds-window-form [name="days"]');
    input.focus(); input.select();
  }
  function controls() {
    const steps = thresholds.includes(state.threshold) ? thresholds : [...thresholds,state.threshold].sort((a,b)=>a-b);
    const advanced = advancedKeys.filter(k=>state[k]!=='any');
    const applied = [...advanced.map(k=>filterNames[k]+'：'+facetLabels[k][state[k]]), ...activeWindows().map(windowShort)];
    return '<div class="ds-controls">' + select('研究指数','market', Object.entries(markets).map(([k,[l]])=>[k,l])) +
      select('单日收盘跌幅','threshold', [...steps.map(v => [v,'超过 ' + v + '%']),['custom','自定义跌幅…']]) +
      select('跌后观察期','wait',options.wait.map(v => [v,v + ' 个交易日'])) +
      select('观察期内是否收复跌前收盘','group',Object.entries(groups)) +
      facetSelect('rebound') + facetSelect('repeat') + '</div>' +
      '<div class="ds-filter-bar"><button type="button" class="text-link" data-ds-action="extra-filters" aria-controls="ds-extra-filters" aria-expanded="' + showExtra + '">' +
      (showExtra ? '▾' : '▸') + ' 更多可选条件</button>' +
      (!showExtra && applied.length ? '<span class="ds-active-filters">' + applied.join('；') + '</span>' : '') +
      (result ? '<span class="ds-match-count" role="status">匹配 <b>' + result.events.length + '</b> / ' + result.cohortN + ' 次事件</span>' : '') +
      (hasFilters() ? '<button type="button" class="text-link" data-ds-action="reset-facets">清除细分条件</button>' : '') + '</div>' +
      '<div id="ds-extra-filters" class="ds-extra-filters"' + (showExtra ? '' : ' hidden') + '>' +
      '<fieldset><legend>大跌前</legend>' + ['trend','drawdown','vol'].map(facetSelect).join('') + '</fieldset>' +
      '<fieldset><legend>大跌当天及观察期</legend>' + ['cap','peer','low'].map(facetSelect).join('') + '</fieldset>'+
      '<fieldset class="ds-window-rules"><legend>截至大跌日收盘 · 自定义区间</legend>' + windowKeys.map(windowControl).join('') + '</fieldset></div>';
  }
  function eventPoints(e) {
    return [['跌前收盘', e.priorDate, e.priorClose], ['大跌日',e.date,e.close],
      ...e.observations.map(([d,v],i) => ['第 ' + (i+1) + ' 个交易日', d, v])];
  }
  function timeline(e) {
    return '<ol class="ds-timeline">' + eventPoints(e).map(([label,day,close],i) =>
      '<li' + (i === 1 ? ' class="ds-fall"' : '') + '><span>' + label + '</span><b>' + fmt(close) + '</b><time>' + day + '</time></li>').join('') + '</ol>';
  }
  function featureValues(e) {
    const f = e.features;
    return {
      rebound:f.reboundPct == null ? (e.status === 'gap' ? '观察期行情断档' : '观察期未满') : f.reboundPct.toFixed(2) + '%',
      repeat:f.priorDrops == null ? '缺完整的 21 个日涨跌幅' : f.priorDrops + ' 天',
      trend:f.ma200Pct == null ? '缺完整的 200 日收盘' : pct(f.ma200Pct),
      drawdown:f.drawdownPct == null ? '缺完整的 252 日收盘' : f.drawdownPct.toFixed(2) + '%',
      peer:f.peerPct == null ? (peerStatus() || '缺同一对交易日的收盘') : pct(f.peerPct),
      vol:f.volPct == null ? '缺完整的 21 个日涨跌幅' : f.volPct.toFixed(2) + '%',
      low:f.brokeLow == null ? (e.status === 'gap' ? '观察期行情断档' : '观察期未满') : (f.brokeLow ? '曾跌破' : '未跌破')
    };
  }
  function windowValue(e,k,withSource=false) {
    const metric=e.features.windows[k];
    if (!metric) return windowMissing(k);
    const value = k==='peak' ? metric.pct.toFixed(2)+'%' :
      metric.pct > 0 ? '下跌 '+metric.pct.toFixed(2)+'%' : metric.pct < 0 ? '上涨 '+(-metric.pct).toFixed(2)+'%' : '持平';
    return value + (withSource ? '（'+windowRules[k].source+'：'+metric.date+'，'+fmt(metric.close)+' 点）' : '');
  }
  function latest() {
    const e = result.latest;
    if (!e) return '<section class="ds-current"><h2>未找到单日跌幅超过 ' + state.threshold + '% 的记录</h2><p>行情覆盖 ' + result.first + ' 至 ' + result.asOf + '。</p></section>';
    const last = e.observations.at(-1);
    const distance = last ? (last[1] / e.priorClose - 1) * 100 : null;
    const observation = e.status === 'pending' ? '已取得 ' + e.observations.length + ' / ' + state.wait + ' 个跌后收盘，尚未纳入统计。' :
      e.status === 'gap' ? '观察期间行情断档，未纳入统计。' :
      (e.recoveryDate ? e.recoveryDate + ' 收盘收复跌幅。' : state.wait + ' 个交易日的收盘都低于跌前点位。') +
      (distance === 0 ? '观察期末回到跌前收盘点位。' : '观察期末' + (distance < 0 ? '低于' : '高于') + '跌前收盘 ' + Math.abs(distance).toFixed(2) + '%。');
    const matches = e.anchorDate && (state.group === 'all' || state.group === e.status) && D.matchesFilters(e,state);
    const facts = featureValues(e);
    const context = [...['vol','peer','low'].filter(k => state[k] !== 'any')
      .map(k=>filterNames[k]+'：<b>'+escape(facts[k])+'</b>'),
      ...activeWindows().map(k=>windowName(k)+'：<b>'+windowValue(e,k)+'</b>')].join(' · ');
    return '<section class="ds-current" aria-label="最近一次大跌"><div class="ds-current-copy"><div class="ds-kicker">最近一次大跌 · ' + markets[state.market][0] + '</div>' +
      '<h2>' + e.date + '<span class="ds-drop">' + pct(e.dropPct) + '</span></h2><p><b>' + recoveryPath(e) + '</b> · ' + observation +
      (e.anchorDate && !matches ? '此次不符合当前筛选。' : '') + '</p><p class="ds-latest-facts">' +
      (e.anchorDate ? '期末收回比例 <b>' + facts.rebound + '</b> · ' : '') + filterNames.repeat + '：<b>' + facts.repeat + '</b></p>' +
      (context ? '<p class="ds-latest-facts">' + context + '</p>' : '') + '</div>' + timeline(e) + '</section>';
  }
  function summaryTable() {
    const group = state.group === 'all' ? '全部已观察大跌' : '期内' + groups[state.group];
    const rows = horizons.map(h => {
      const r = result.summary[h], b = result.baseline[h];
      return '<tr><th scope="row">' + terms[h] + '<small>' + h + ' 个交易日</small></th><td><strong>' + signed(r.median) +
        '</strong></td><td><strong>' + signed(r.mean) + '</strong></td><td>' + (r.upPct == null ? '—' : r.upPct.toFixed(1) + '%') +
        '</td><td>' + r.n + '</td>' + (showBaseline ? '<td class="ds-benchmark">' + pct(b.median) + '</td><td>' + pct(b.mean) + '</td><td>' + b.n.toLocaleString() + '</td>' : '') + '</tr>';
    }).join('');
    const c = result.counts;
    return '<section class="ds-panel" aria-labelledby="ds-summary-title"><div class="ds-panel-head"><div><h2 id="ds-summary-title">确认之后，指数涨跌了多少？</h2><p>从第 ' +
      state.wait + ' 个交易日收盘起算 · 美元价格指数累计涨跌，不含分红</p></div><div class="ds-summary-tools"><span class="ds-coverage">' + result.first + ' — ' + result.asOf + '</span>' +
      '<button type="button" class="btn sm" aria-controls="ds-summary-table" aria-expanded="' + showBaseline + '" data-ds-action="baseline">' + (showBaseline ? '收起交易日对比' : '对比全部交易日') + '</button></div></div>' +
      '<div class="ds-scroll"><table id="ds-summary-table" class="ds-summary"><thead><tr><th rowspan="2" scope="col">后续期限</th><th colspan="4" scope="colgroup">' + group + ' · ' + (hasFilters() ? '细分后 ' : '') + result.events.length +
      ' 次</th>' + (showBaseline ? '<th class="ds-benchmark" colspan="3" scope="colgroup">同期全部可比交易日</th>' : '') +
      '</tr><tr><th>中位数</th><th>平均数</th><th>上涨占比</th><th>有效样本</th>' +
      (showBaseline ? '<th class="ds-benchmark">中位数</th><th>平均数</th><th>有效样本</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ds-foot">单日跌超 ' + state.threshold + '% 共 <b>' + c.total + '</b> 次，' + c.unrecovered + ' 次始终未收复，' + c.recovered + ' 次曾收复' +
      (c.pending ? '，' + c.pending + ' 次观察中' : '') + (c.gap ? '，' + c.gap + ' 次观察期断档' : '') + '。每个期限只计入已有完整行情的事件。</div></section>';
  }

  // Fixed boundaries per horizon, in percent. Assign each completed return to precisely one bin.
  function distribution() {
    const step = { 5:2, 21:5, 63:10, 252:20 }[horizon];
    const edges = [-2*step,-step,0,step,2*step];
    const bounds = [-Infinity,...edges,Infinity];
    const bins = bounds.slice(0,-1).map((lo,i) => ({lo, hi:bounds[i+1], rows:[]}));
    for (const e of result.events) {
      const r = e.outcomes[horizon];
      if (r.status === 'complete') bins.find(b => r.pct >= b.lo && r.pct < b.hi).rows.push(e);
    }
    return bins;
  }
  const bound = n => String(n).replace('-', '−') + '%';
  const labelBin = b => b.lo === -Infinity ? '低于 ' + bound(b.hi) : b.hi === Infinity ? bound(b.lo) + ' 及以上' : bound(b.lo) + ' 至 ' + bound(b.hi);
  function sampleNote() {
    const events = result.events;
    if (!events.length) return '';
    const counts = new Map();
    for (const e of events) {
      const year = Number(e.date.slice(0,4));
      counts.set(year, (counts.get(year) || 0) + 1);
    }
    const clusters = [...counts.keys()].filter(y => counts.has(y+1))
      .map(y => ({ y, n:counts.get(y) + counts.get(y+1) })).sort((a,b) => b.n - a.n || a.y - b.y);
    const c = clusters[0];
    const lead = c && c.n >= events.length / 3 ? '所选 ' + events.length + ' 次大跌中，' + c.n + ' 次发生在 ' + c.y + '–' + (c.y+1) + ' 年。' : '';
    const n = result.summary[252].n;
    const sample = n > 0 && n <= 5 ? '一年期只有 ' + n + ' 次完整结果，可逐次查看。' : '';
    return '<p class="ds-note">' + sample + lead + '同一轮下跌可能多次触发，后续区间也可能重叠，样本数不等于独立危机的次数。</p>';
  }
  function distributions(bins) {
    const r = result.summary[horizon];
    const max = Math.max(1,...bins.map(b=>b.rows.length));
    const tabs = '<div class="segmented" aria-label="分布期限">' + horizons.map(h=>'<button data-ds-h="' + h + '" aria-pressed="' + (h === horizon) + '" class="' + (h === horizon ? 'active' : '') + '">' + terms[h] + '</button>').join('') + '</div>';
    return '<section class="ds-panel"><div class="ds-panel-head"><div><h2>后续涨跌分布</h2><p>' + terms[horizon] + '后 · ' + r.n + ' 个有效样本' +
      (r.n ? ' · 最差 ' + pct(r.min) + '，最好 ' + pct(r.max) : '') + '</p></div>' + tabs + '</div>' +
      (r.n ? '<div class="ds-histogram" role="group" aria-label="按涨跌区间筛选逐次记录">' + bins.map((b,i) =>
        '<button type="button" class="ds-bin ' + (b.hi <= 0 ? 'ds-loss' : 'ds-gain') + '" data-ds-bin="' + i + '" aria-pressed="' + (i === bin) +
        '" aria-label="' + labelBin(b) + '，' + b.rows.length + ' 次，筛选下方记录"' + (!b.rows.length ? ' disabled' : '') + '><span class="ds-bar-area"><i style="height:' +
        (b.rows.length/max*72) + 'px"><b>' + b.rows.length + ' 次</b></i></span><span class="ds-bin-label">' + labelBin(b) + '</span></button>').join('') +
        '</div><div class="ds-foot">区间含下限、不含上限。选择柱形可查看对应的大跌记录。</div>' : '<p class="ds-foot">没有走完该期限且行情完整的事件。</p>') + '</section>';
  }
  function outcomeText(r) {
    return r.status === 'complete' ? signed(r.pct) : '<span class="ds-faint">' + (r.status === 'gap' ? '行情断档' : '未到期') + '</span>';
  }
  function eventsTable(bins) {
    const rows = bin == null ? result.events : bins[bin].rows;
    const pages = Math.max(1,Math.ceil(rows.length/size));
    return '<section class="ds-panel"><div class="ds-panel-head"><div><h2>逐次大跌记录</h2><p>' +
      (bin == null ? '全部匹配事件' : terms[horizon] + '后 ' + labelBin(bins[bin])) + ' · ' + rows.length + ' 次' +
      (bin == null ? '' : ' <button class="text-link" data-ds-action="clear-bin">清除区间筛选</button>') + '</p></div>' +
      '<button class="btn sm" data-ds-action="export"' + (rows.length ? '' : ' disabled') + '>导出这 ' + rows.length + ' 次记录</button></div>' +
      (rows.length ? '<div class="ds-scroll"><table class="ds-events"><thead><tr><th>大跌日</th><th>单日涨跌</th><th>观察结果</th><th>起算日</th>' +
      horizons.map(h=>'<th>' + terms[h] + '后</th>').join('') + '</tr></thead><tbody>' +
      rows.slice((page-1)*size,page*size).map(e=>'<tr><td><button class="text-link" data-ds-event="' + e.date + '" aria-label="查看 ' + e.date + ' 大跌明细">' +
        e.date + '</button></td><td>' + signed(e.dropPct) + '</td><td>' + recoveryPath(e) + '</td><td>' + e.anchorDate + '</td>' +
        horizons.map(h=>'<td>' + outcomeText(e.outcomes[h]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      (pages > 1 ? '<div class="ds-pagination"><button class="btn sm" data-ds-action="prev"' + (page === 1 ? ' disabled' : '') + '>上一页</button><span>' + page + ' / ' + pages +
        '</span><button class="btn sm" data-ds-action="next"' + (page === pages ? ' disabled' : '') + '>下一页</button></div>' : '') :
      '<p class="ds-foot">没有符合当前条件的事件。</p>') + '</section>';
  }
  function recoveryPath(e) {
    if (e.status!=='recovered') return statuses[e.status];
    return '曾收复，期末'+(e.anchorClose >= e.priorClose ? '守住' : '回落');
  }
  function method() {
    const symbol = markets[state.market][1];
    return '<details class="ds-method"><summary>统计口径与数据来源</summary><p>单日跌幅与上一交易日收盘比较，恰好等于阈值不入样。观察期内任何一次收盘回到或超过跌前收盘即为已收复，盘中触及不计。所有组的起算点都是观察期最后一个收盘。</p>' +
      '<p>期末收回比例＝（观察期末收盘 − 大跌日收盘）÷（跌前收盘 − 大跌日收盘）。期内曾收复的事件也可能在期末再度回落。此前 21 个交易日逐日比较相邻收盘，只数单日'+dropCutoff()+'的天数，不含本次大跌日。</p>' +
      '<p>「大跌前」的均线及 252 日高点回撤截至前一日。「自定义区间」则算到大跌日收盘：回撤取含当日的 N 个收盘中的最高点，累计跌幅与 N 个交易日前的收盘比较。两项均须严格超过设定值；历史不足或跨行情断档时，只有该项不限才保留。选项旁的次数保留其余筛选条件。</p>' +
      '<p>跌幅须超过起筛门槛，选了上限则可以等于上限。另一指数的涨跌比较同一对交易日的收盘。跌前波动率用截至前一交易日的 21 个日对数收益的样本标准差年化；观察期内只要有一天收盘低于大跌日收盘，就记为曾跌破。</p>' +
      '<p>基准使用同一指数、同一覆盖期内所有具备同等观察窗口的交易日，包含触发事件的日期。每期平均数为算术平均；上涨占比只数涨幅大于零的记录。相邻收盘相隔超过 10 个自然日视为行情断档，跨过断档的窗口不计算。</p>' +
      (state.market === 'ndx' ? '<p>历史样本按 Yahoo 日线筛选。截至 2026-11-09，默认条件的全部触发日期及四期中位数、平均数（保留两位小数）已用 Nasdaq 官方历史日线复核。</p>' : '') +
      '<p><a href="https://finance.yahoo.com/quote/' + encodeURIComponent(symbol) + '/history/" target="_blank" rel="noopener noreferrer">Yahoo Finance · ' + symbol +
      ' 历史收盘 ↗</a> · <a href="https://github.com/jianxieb/fund-data/blob/main/docs/drop-study-method.md" target="_blank" rel="noopener noreferrer">完整方法与核对记录 ↗</a></p></details>';
  }
  function detail(e) {
    const facts = featureValues(e);
    const rows = horizons.map(h => {
      const r = e.outcomes[h];
      return '<tr><th scope="row">' + terms[h] + '</th><td>' + (r.date || '—') + '</td><td>' + (r.close == null ? '—' : fmt(r.close)) + '</td><td>' + outcomeText(r) + '</td></tr>';
    }).join('');
    H.openModal(H.modalTitle(e.date + ' · ' + markets[state.market][0], '单日 ' + pct(e.dropPct) + ' · 观察 ' + state.wait + ' 个交易日：' + recoveryPath(e)) +
      '<div class="ds-detail">' + timeline(e) + '<dl class="ds-feature-values">' +
      facetKeys.filter(k=>k!=='cap').map(k=>'<div><dt>' + (k === 'trend' ? '跌前收盘相对 200 日均线' : k==='rebound' ? '第 '+state.wait+' 天收回原跌幅的比例' : filterNames[k]) + '</dt><dd>' + escape(facts[k]) + '</dd></div>').join('') +
      windowKeys.map(k=>'<div><dt>截至大跌日 · '+windowName(k)+'</dt><dd>'+escape(windowValue(e,k,true))+'</dd></div>').join('') +
      '</dl><p>从 ' + e.anchorDate + ' 收盘 ' + fmt(e.anchorClose) + ' 点起算' +
      (e.recoveryDate ? '；首次收复于 ' + e.recoveryDate : '') + '。</p><div class="ds-scroll"><table><thead><tr><th>后续期限</th><th>实际终日</th><th>指数收盘</th><th>累计涨跌</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>');
  }
  function exportRows() {
    const rows = bin == null ? result.events : distribution()[bin].rows;
    const prefix = ['指数','行情截至','筛选组别','收益区间筛选','跌幅阈值%','观察天数','跌前日期','跌前收盘','大跌日','大跌日收盘','单日涨跌%','观察结果','首次收复日','后续起算日','起算收盘'];
    const header = [...prefix,...facetKeys.map(k=>'筛选：'+filterNames[k]),'期末收回原跌幅%',filterNames.repeat+'的天数','跌前收盘相对200日均线%','跌前距252日最高收盘回撤%',
      '对照指数','对照指数同日涨跌%','对照行情状态','跌前21日年化波动率%','观察期内收盘曾跌破大跌日收盘',
      '高点回看交易日数','筛选：回撤超过%','区间最高收盘日','区间最高收盘','大跌日距区间高点回撤%','累计跌幅交易日数','筛选：累计跌幅超过%','累计跌幅起算日','起算日指数收盘','截至大跌日累计跌幅%（正数为下跌）',
      ...Array.from({ length:state.wait },(_,i)=>['观察日'+(i+1),'收盘点位'+(i+1)]).flat(),
      ...horizons.flatMap(h=>[h+'日状态',h+'日实际终日',h+'日收盘',h+'日累计涨跌%'])];
    const filter = bin == null ? '不限' : terms[horizon] + '后 ' + labelBin(distribution()[bin]);
    const data = rows.map(e=>[markets[state.market][1],result.asOf,groups[state.group],filter,state.threshold,state.wait,e.priorDate,e.priorClose,e.date,e.close,e.dropPct,
      recoveryPath(e),e.recoveryDate,e.anchorDate,e.anchorClose,...facetKeys.map(k=>facetLabels[k][state[k]]),
      e.features.reboundPct,e.features.priorDrops,e.features.ma200Pct,e.features.drawdownPct,
      markets[peerMarket()][1],e.features.peerPct,e.features.peerPct == null ? (peerStatus() || '缺同一对交易日的收盘') : '同一对交易日',
      e.features.volPct,e.features.brokeLow == null ? null : e.features.brokeLow ? '是' : '否',
      ...windowKeys.flatMap(k=>{const w=e.features.windows[k];return [state[k+'Days'],state[k+'Min']??'不限',w?.date,w?.close,w?.pct];}),...e.observations.flat(),
      ...horizons.flatMap(h=>{const r=e.outcomes[h];return [r.status==='complete'?'已到期':r.status==='gap'?'行情断档':'未到期',r.date,r.close,r.pct];})]);
    H.download('大跌后表现-'+markets[state.market][0]+'-'+result.asOf+'.csv',M.csv([header,...data]),'text/csv;charset=utf-8');
  }
  function view(helpers) {
    H = helpers;
    const next = readState();
    if (advancedKeys.some(k=>next[k]!=='any' && next[k]!==state?.[k]) || windowKeys.some(k=>next[k+'Min']!=null && next[k+'Min']!==state?.[k+'Min']) ||
        (next.threshold !== state?.threshold && next.cap!=='any' && Number(next.cap)<=next.threshold)) showExtra = true;
    state = next;
    const sig = JSON.stringify(state);
    if (sig !== signature) { result = null; signature = sig; bin = null; page = 1; }
    const title = H.head('MARKET EVENT STUDY', '大跌后表现', '指数单日大跌后，短期内是否收复失地，与随后一周至一年的涨跌有什么关系？');
    const other = peerMarket(), slot = cache.get(state.market), peer = cache.get(other);
    if (!slot) load(state.market);
    if (!peer) load(other);
    if (!slot?.series) return title + controls() + '<div role="status" class="ds-panel ds-loading">' + (slot?.error ? escape(slot.error) + ' <button class="text-link" data-ds-action="retry">重新加载</button>' : '正在读取指数收盘日线…') + '</div>';
    if (state.peer !== 'any' && !peer?.series) return title + controls() + '<div role="status" class="ds-panel ds-loading">' +
      (peer?.error ? '缺少' + peerName() + '日线，暂时无法统计所选的同日涨跌区间。' : '正在读取' + peerName() + '日线，等待核对同日涨跌。') +
      ' <button class="text-link" data-ds-action="clear-peer">取消同日涨跌筛选</button></div>';
    if (!result || resultPeer !== peer?.series) {
      resultPeer = peer?.series;
      result = D.study(slot.series, state, resultPeer);
    }
    const bins = distribution();
    return title + controls() + latest() + summaryTable() + sampleNote() + distributions(bins) + eventsTable(bins) + method();
  }
  function setFields(fields) {
    const q = new URLSearchParams();
    const next = {...state,...fields};
    if (fields.group==='unrecovered' && next.rebound==='full') next.rebound='any';
    for (const [k,v] of Object.entries(next)) if (String(v) !== String(defaults[k])) q.set(k,v);
    history.replaceState(null,'','#drop-study' + (q.size ? '?' + q : ''));
    redraw();
  }
  function choose(key, value) {
    if (key === 'threshold' && value === 'custom') {
      H.openModal(H.modalTitle('自定义跌幅') + '<form id="ds-threshold-form"><label>跌幅门槛（3%–10%）<input name="threshold" type="number" min="3" max="10" step="0.01" required value="' + state.threshold +
        '"></label><button type="submit" class="btn primary">应用</button></form>');
      const input = document.querySelector('#ds-threshold-form input');
      input.focus(); input.select();
    } else if (key === 'threshold' || Object.hasOwn(options,key)) setFields({[key]:value});
  }
  document.addEventListener('submit', event => {
    if (event.target.id === 'ds-window-form') {
      event.preventDefault();
      const form=event.target,k=form.dataset.rule,days=form.elements.days.valueAsNumber,min=form.elements.min.valueAsNumber;
      if (!W.validDays(k,days) || !W.validThreshold(min)) return;
      form.closest('dialog').close();
      setFields({[k+'Days']:days,[k+'Min']:min});
      return;
    }
    if (event.target.id !== 'ds-threshold-form') return;
    event.preventDefault();
    const value = event.target.elements.threshold.valueAsNumber;
    if (!D.validThreshold(value)) return;
    event.target.closest('dialog').close();
    setFields({threshold:value});
  });
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-ds-action],[data-ds-h],[data-ds-bin],[data-ds-event]');
    if (!el || !H) return;
    if (el.dataset.dsH) { horizon = +el.dataset.dsH; bin = null; page = 1; }
    else if (el.dataset.dsBin != null) { const n = +el.dataset.dsBin; bin = n === bin ? null : n; page = 1; }
    else if (el.dataset.dsEvent) { const e = result.events.find(r=>r.date===el.dataset.dsEvent); if (e) detail(e); return; }
    else switch (el.dataset.dsAction) {
      case 'edit-peak': case 'edit-loss': editWindow(el.dataset.dsAction.slice(5)); return;
      case 'clear-peak': case 'clear-loss': {
        const k=el.dataset.dsAction.slice(6);
        setFields({[k+'Days']:windowDefaults[k+'Days'],[k+'Min']:null}); return;
      }
      case 'extra-filters': showExtra = !showExtra; break;
      case 'clear-rebound': setFields({rebound:'any'}); return;
      case 'clear-peer': setFields({peer:'any'}); return;
      case 'retry-peer': cache.delete(peerMarket()); break;
      case 'reset-facets': setFields({...facetDefaults,...windowDefaults}); return;
      case 'baseline': showBaseline = !showBaseline; break;
      case 'prev': page--; break;
      case 'next': page++; break;
      case 'clear-bin': bin = null; page = 1; break;
      case 'export': exportRows(); return;
      case 'retry': cache.delete(state.market); break;
      default: return;
    }
    redraw();
  });
  window.ChanghengDropStudy = { view, choose };
})();
