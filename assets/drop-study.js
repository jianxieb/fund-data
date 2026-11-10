(function () {
  'use strict';
  const D = window.ChanghengDropStudyModel, R = window.ChanghengResearchHistory, M = window.Changheng;
  const markets = { ndx:['纳斯达克100','^NDX'], spx:['标普500','^GSPC'] };
  const groups = { unrecovered:'未收复', recovered:'已收复', all:'全部大跌' };
  const statuses = { ...groups, pending:'观察中', gap:'观察期行情断档' };
  const horizons = D.horizons, terms = { 5:'1周', 21:'1个月', 63:'3个月', 252:'1年' };
  const defaults = { market:'ndx', threshold:5, wait:2, group:'unrecovered' };
  const options = { market:Object.keys(markets), wait:D.waits, group:Object.keys(groups) };
  const thresholds = [3,4,5,6,7,8,9,10];
  const fmt = n => n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const pct = n => n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
  const signed = n => '<span class="' + (n < 0 ? 'negative' : n > 0 ? 'positive' : '') + '">' + pct(n) + '</span>';
  const escape = M.escapeHtml;
  const cache = new Map();
  let H, state, result, signature, horizon = 252, bin = null, page = 1, showBaseline = false;
  const size = 10;

  function readState() {
    const q = new URLSearchParams(location.hash.split('?')[1]);
    const threshold = Number(q.get('threshold'));
    return { threshold:D.validThreshold(threshold) ? threshold : defaults.threshold,
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
    return '<label><span>' + label + '</span><select id="ds-' + key + '" data-ds-field="' + key + '">' +
      choices.map(([v,l]) => '<option value="' + v + '"' + (state[key] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>';
  }
  function controls() {
    const steps = thresholds.includes(state.threshold) ? thresholds : [...thresholds,state.threshold].sort((a,b)=>a-b);
    return '<div class="ds-controls">' + select('研究指数','market', Object.entries(markets).map(([k,[l]])=>[k,l])) +
      select('单日收盘跌幅','threshold', [...steps.map(v => [v,'超过 ' + v + '%']),['custom','自定义跌幅…']]) +
      select('跌后观察期','wait',options.wait.map(v => [v,v + ' 个交易日'])) +
      select('纳入统计的大跌','group',Object.entries(groups).map(([v,l]) => [v, v === 'all' ? '全部已观察事件' : '期内' + l])) + '</div>';
  }
  function eventPoints(e) {
    return [['跌前收盘', e.priorDate, e.priorClose], ['大跌日',e.date,e.close],
      ...e.observations.map(([d,v],i) => ['第 ' + (i+1) + ' 个交易日', d, v])];
  }
  function timeline(e) {
    return '<ol class="ds-timeline">' + eventPoints(e).map(([label,day,close],i) =>
      '<li' + (i === 1 ? ' class="ds-fall"' : '') + '><span>' + label + '</span><b>' + fmt(close) + '</b><time>' + day + '</time></li>').join('') + '</ol>';
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
    return '<section class="ds-current" aria-label="最近一次大跌"><div class="ds-current-copy"><div class="ds-kicker">最近一次大跌 · ' + markets[state.market][0] + '</div>' +
      '<h2>' + e.date + '<span class="ds-drop">' + pct(e.dropPct) + '</span></h2><p><b>' + statuses[e.status] + '</b> · ' + observation +
      (e.anchorDate && state.group !== 'all' && state.group !== e.status ? '此次不在所选分组内。' : '') + '</p></div>' + timeline(e) + '</section>';
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
      '<div class="ds-scroll"><table id="ds-summary-table" class="ds-summary"><thead><tr><th rowspan="2" scope="col">后续期限</th><th colspan="4" scope="colgroup">' + group + ' · ' + result.events.length +
      ' 次</th>' + (showBaseline ? '<th class="ds-benchmark" colspan="3" scope="colgroup">同期全部可比交易日</th>' : '') +
      '</tr><tr><th>中位数</th><th>平均数</th><th>上涨占比</th><th>有效样本</th>' +
      (showBaseline ? '<th class="ds-benchmark">中位数</th><th>平均数</th><th>有效样本</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ds-foot">单日跌超 ' + state.threshold + '% 共 <b>' + c.total + '</b> 次，' + c.unrecovered + ' 次未收复，' + c.recovered + ' 次已收复' +
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
    return '<p class="ds-note">' + lead + '同一轮下跌可能多次触发，后续区间也可能重叠，样本数不等于独立危机的次数。</p>';
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
        e.date + '</button></td><td>' + signed(e.dropPct) + '</td><td>' + statuses[e.status] + '</td><td>' + e.anchorDate + '</td>' +
        horizons.map(h=>'<td>' + outcomeText(e.outcomes[h]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      (pages > 1 ? '<div class="ds-pagination"><button class="btn sm" data-ds-action="prev"' + (page === 1 ? ' disabled' : '') + '>上一页</button><span>' + page + ' / ' + pages +
        '</span><button class="btn sm" data-ds-action="next"' + (page === pages ? ' disabled' : '') + '>下一页</button></div>' : '') :
      '<p class="ds-foot">没有符合当前条件的事件。</p>') + '</section>';
  }
  function method() {
    const symbol = markets[state.market][1];
    return '<details class="ds-method"><summary>统计口径与数据来源</summary><p>单日跌幅与上一交易日收盘比较，恰好等于阈值不入样。观察期内任何一次收盘回到或超过跌前收盘即为已收复，盘中触及不计。所有组的起算点都是观察期最后一个收盘。</p>' +
      '<p>基准使用同一指数、同一覆盖期内所有具备同等观察窗口的交易日，包含触发事件的日期。每期平均数为算术平均；上涨占比只数涨幅大于零的记录。相邻收盘相隔超过 10 个自然日视为行情断档，跨过断档的窗口不计算。</p>' +
      (state.market === 'ndx' ? '<p>历史样本按 Yahoo 日线筛选。截至 2026-11-09，默认条件的全部触发日期及四期中位数、平均数（保留两位小数）已用 Nasdaq 官方历史日线复核。</p>' : '') +
      '<p><a href="https://finance.yahoo.com/quote/' + encodeURIComponent(symbol) + '/history/" target="_blank" rel="noopener noreferrer">Yahoo Finance · ' + symbol +
      ' 历史收盘 ↗</a> · <a href="https://github.com/jianxieb/fund-data/blob/main/docs/drop-study-method.md" target="_blank" rel="noopener noreferrer">完整方法与核对记录 ↗</a></p></details>';
  }
  function detail(e) {
    const rows = horizons.map(h => {
      const r = e.outcomes[h];
      return '<tr><th scope="row">' + terms[h] + '</th><td>' + (r.date || '—') + '</td><td>' + (r.close == null ? '—' : fmt(r.close)) + '</td><td>' + outcomeText(r) + '</td></tr>';
    }).join('');
    H.openModal(H.modalTitle(e.date + ' · ' + markets[state.market][0], '单日 ' + pct(e.dropPct) + ' · ' + state.wait + ' 个交易日内' + statuses[e.status]) +
      '<div class="ds-detail">' + timeline(e) + '<p>从 ' + e.anchorDate + ' 收盘 ' + fmt(e.anchorClose) + ' 点起算' +
      (e.recoveryDate ? '；首次收复于 ' + e.recoveryDate : '') + '。</p><div class="ds-scroll"><table><thead><tr><th>后续期限</th><th>实际终日</th><th>指数收盘</th><th>累计涨跌</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>');
  }
  function exportRows() {
    const rows = bin == null ? result.events : distribution()[bin].rows;
    const prefix = ['指数','行情截至','筛选组别','收益区间筛选','跌幅阈值%','观察天数','跌前日期','跌前收盘','大跌日','大跌日收盘','单日涨跌%','观察结果','首次收复日','后续起算日','起算收盘'];
    const header = [...prefix,...Array.from({ length:state.wait },(_,i)=>['观察日'+(i+1),'收盘点位'+(i+1)]).flat(),
      ...horizons.flatMap(h=>[h+'日状态',h+'日实际终日',h+'日收盘',h+'日累计涨跌%'])];
    const filter = bin == null ? '不限' : terms[horizon] + '后 ' + labelBin(distribution()[bin]);
    const data = rows.map(e=>[markets[state.market][1],result.asOf,groups[state.group],filter,state.threshold,state.wait,e.priorDate,e.priorClose,e.date,e.close,e.dropPct,
      statuses[e.status],e.recoveryDate,e.anchorDate,e.anchorClose,...e.observations.flat(),
      ...horizons.flatMap(h=>{const r=e.outcomes[h];return [r.status==='complete'?'已到期':r.status==='gap'?'行情断档':'未到期',r.date,r.close,r.pct];})]);
    H.download('大跌后表现-'+markets[state.market][0]+'-'+result.asOf+'.csv',M.csv([header,...data]),'text/csv;charset=utf-8');
  }
  function view(helpers) {
    H = helpers;
    state = readState();
    const sig = JSON.stringify(state);
    if (sig !== signature) { result = null; signature = sig; bin = null; page = 1; }
    const title = H.head('MARKET EVENT STUDY', '大跌后表现', '指数单日大跌后，短期内是否收复失地，与随后一周至一年的涨跌有什么关系？');
    const slot = cache.get(state.market);
    if (!slot) load(state.market);
    if (!slot?.series) return title + controls() + '<div role="status" class="ds-panel ds-loading">' + (slot?.error ? escape(slot.error) + ' <button class="text-link" data-ds-action="retry">重新加载</button>' : '正在读取指数收盘日线…') + '</div>';
    if (!result) result = D.study(slot.series, state);
    const bins = distribution();
    return title + controls() + latest() + summaryTable() + sampleNote() + distributions(bins) + eventsTable(bins) + method();
  }
  function setField(key, value) {
    const q = new URLSearchParams();
    const next = {...state,[key]:value};
    for (const [k,v] of Object.entries(next)) if (String(v) !== String(defaults[k])) q.set(k,v);
    history.replaceState(null,'','#drop-study' + (q.size ? '?' + q : ''));
    redraw();
  }
  document.addEventListener('change', event => {
    const key = event.target.dataset.dsField;
    if (key === 'threshold' && event.target.value === 'custom') {
      event.target.value = String(state.threshold);
      H.openModal(H.modalTitle('自定义跌幅') + '<form id="ds-threshold-form"><label>跌幅门槛（3%–10%）<input name="threshold" type="number" min="3" max="10" step="0.01" required value="' + state.threshold +
        '"></label><button type="submit" class="btn primary">应用</button></form>');
      const input = document.querySelector('#ds-threshold-form input');
      input.focus(); input.select();
    } else if (key === 'threshold' || Object.hasOwn(options,key)) setField(key,event.target.value);
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'ds-threshold-form') return;
    event.preventDefault();
    const value = event.target.elements.threshold.valueAsNumber;
    if (!D.validThreshold(value)) return;
    event.target.closest('dialog').close();
    setField('threshold',value);
  });
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-ds-action],[data-ds-h],[data-ds-bin],[data-ds-event]');
    if (!el || !H) return;
    if (el.dataset.dsH) { horizon = +el.dataset.dsH; bin = null; page = 1; }
    else if (el.dataset.dsBin != null) { const n = +el.dataset.dsBin; bin = n === bin ? null : n; page = 1; }
    else if (el.dataset.dsEvent) { const e = result.events.find(r=>r.date===el.dataset.dsEvent); if (e) detail(e); return; }
    else switch (el.dataset.dsAction) {
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
  window.ChanghengDropStudy = { view };
})();
