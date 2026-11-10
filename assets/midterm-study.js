(function () {
  'use strict';
  const M = window.Changheng, D = window.ChanghengMidtermStudyModel, R = window.ChanghengResearchHistory;
  const terms = {'1w':'1 周','1m':'1 个月','3m':'3 个月','6m':'6 个月','12m':'12 个月'};
  const choices = {
    era:{all:'1950 年起（含 2 届发布前数据）', live:'仅正式发布后（1958 届起）'},
    entry:{election:'选举日收盘（休市取前收盘）', next:'选后首个交易日收盘'},
    horizon:terms
  };
  const defaults = {entry:'election',era:'all',horizon:'12m'};
  const pct = n => n == null ? '—' : (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(n).toFixed(2) + '%';
  const rate = n => n == null ? '—' : Number(n.toFixed(1)) + '%';
  const price = n => n == null ? '—' : n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const sign = n => '<span class="' + (n > 0 ? 'positive' : n < 0 ? 'negative' : '') + '">' + pct(n) + '</span>';
  const esc = M.escapeHtml;
  let H, series, loading, error, active;
  const results = new Map();

  async function earlyHistory() {
    const url = document.getElementById('us-midterms-source').dataset.src;
    let text;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error();
      text = await response.text();
    } catch { throw new Error('无法读取 1950–1989 年标普历史收盘'); }
    if (globalThis.crypto?.subtle) {
      const sha = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      const token = [...new Uint8Array(sha).slice(0,6)].map(x=>x.toString(16).padStart(2,'0')).join('');
      if (new URL(url,location.href).searchParams.get('v') !== token) throw new Error('早期标普行情文件版本不一致，请刷新页面');
    }
    return JSON.parse(text);
  }
  async function recentHistory() {
    const row = (await R.indexCatalog()).find(r=>r.id==='index:^GSPC');
    if (!row || row.code!=='^GSPC' || row.kind!=='index' || row.basis!=='price_index' || row.currency!=='USD')
      throw new Error('缺少已核对的美元标普 500 价格指数行情');
    return R.history(row);
  }
  async function load() {
    loading = true; error = '';
    try {
      const [archive,recent] = await Promise.all([earlyHistory(),recentHistory()]);
      if (archive.id !== recent.id || archive.currency!=='USD' || archive.basis!=='price_index' ||
          archive.dividends!=='excluded' || recent.dividends!=='excluded' || archive.launchDate!=='1957-03-04' ||
          archive.series?.[0]?.[0]!=='1950-01-03' || archive.series.at(-1)[0]!=='1989-12-29')
        throw new Error('标普早期行情的身份、口径或覆盖区间不符');
      const seam = archive.overlap?.series;
      if (seam?.length!==22 || !seam.every(([day,close],i)=>recent.series[i]?.[0]===day && recent.series[i][1]===close))
        throw new Error('早期与后续日线在 1990 年 1 月未逐日对齐，无法合并统计');
      series = archive.series.concat(recent.series);
    } catch (e) { error = e.message || '标普历史行情读取失败'; }
    finally { loading = false; if (location.hash.split('?')[0]==='#midterm-study') H.render(); }
  }
  function state() {
    const q = new URLSearchParams(location.hash.split('?')[1]);
    return Object.fromEntries(Object.keys(defaults).map(k=>[k,Object.hasOwn(choices[k],q.get(k)) ? q.get(k) : defaults[k]]));
  }
  function select(field,label,st) {
    return H.menu('mt-'+field,label,Object.entries(choices[field]),st[field]);
  }
  function observationNote(r) {
    const s = r.summary['12m'], last = r.events[0];
    if (!last) return '';
    const notes = [];
    if (s.pending && last.outcomes['12m'].status==='pending') notes.push(last.year + ' 届尚未满 12 个月，未计入一年期统计。');
    if (s.missing) notes.push(s.missing + ' 届缺完整行情，未计入。');
    notes.push('历史上涨占比不是下一届的上涨概率。');
    return notes.join('');
  }
  function highlight(r) {
    const s = r.summary['12m'], w = r.events.filter(e=>e.outcomes['12m'].status==='complete')
      .reduce((a,b)=>!a || b.outcomes['12m'].pct<a.outcomes['12m'].pct ? b:a,null);
    const cell = (title,value,sub) => '<div><span>' + title + '</span><strong>' + value + '</strong><small>' + sub + '</small></div>';
    return '<section class="mt-highlight" aria-label="选后十二个月统计"><div class="mt-topline"><h2>选后 12 个月</h2><span>标普 500 · 美元价格回报，不含分红</span></div><div class="mt-figures">' +
      cell('历史上涨占比',rate(s.upPct),s.up + ' 届上涨 / ' + s.n + ' 届已到期且行情完整') +
      cell('涨跌幅中位数',pct(s.median),'各届等权') + cell('平均涨跌幅',pct(s.mean),'算术平均') +
      cell('最低期末涨跌幅',pct(s.min),w ? w.year + ' 届 · 期内最大回撤 ' + pct(w.outcomes['12m'].maxDrawdownPct) : '没有完整结果') +
      '</div><p>' + observationNote(r) + '</p></section>';
  }
  function summary(r) {
    return '<section class="ds-panel mt-panel"><div class="ds-panel-head"><div><h2>各期限历史结果</h2><p>从所选收盘起算，比较选举日后各日历期限的期末点位。</p></div><span class="ds-coverage">行情截至 ' + r.asOf + '</span></div>' +
      '<div class="ds-scroll"><table class="mt-summary"><thead><tr><th>选后期限</th><th>已到期有效届数</th><th>上涨 / 持平 / 下跌</th><th>上涨占比</th><th>中位数</th><th>平均数</th><th>最低</th><th>最高</th></tr></thead><tbody>' +
      D.horizons.map(h=>{const s=r.summary[h];return '<tr' + (h==='12m'?' class="mt-year"':'') + '><th scope="row">' + terms[h] + '</th><td>' + s.n +
        '</td><td>' + [s.up,s.flat,s.down].join(' / ') + '</td><td>' + rate(s.upPct) + '</td><td>' + sign(s.median) + '</td><td>' + sign(s.mean) +
        '</td><td>' + sign(s.min) + '</td><td>' + sign(s.max) + '</td></tr>';}).join('') + '</tbody></table></div></section>';
  }
  function eventRows(r,st) {
    const h = st.horizon;
    return '<section class="ds-panel mt-panel"><div class="ds-panel-head"><div><h2>逐届核对</h2><p>起点和终点都列出实际收盘日。最大回撤衡量期间从高点到随后低点的跌幅。</p></div><div class="mt-tools">' +
      select('horizon','查看选后期限',st) + '<button type="button" class="btn sm" data-mt-action="csv">导出全部期限 CSV</button></div></div>' +
      '<div class="ds-scroll"><table class="mt-events"><thead><tr><th>选举日</th><th>实际起算收盘</th><th>选后 ' + terms[h] + '目标日</th><th>实际期末收盘</th><th>累计涨跌</th><th>期内最大回撤</th></tr></thead><tbody>' +
      r.events.map(e=>{const o=e.outcomes[h];return '<tr><th scope="row">' + e.date + (e.preLaunch?'<small>指数发布前回算</small>':'') + '</th><td>' +
        (e.anchorDate ? price(e.anchorClose)+'<small>'+e.anchorDate+'</small>' : esc(e.anchorReason)) + '</td><td>' + o.targetDate + '</td><td>' +
        (o.status==='complete'?price(o.close)+'<small>'+o.date+'</small>':o.status==='pending'?'未到期':'缺行情<small>'+esc(o.reason)+'</small>') +
        '</td><td>' + sign(o.pct) + '</td><td>' + sign(o.maxDrawdownPct) + '</td></tr>';}).join('') + '</tbody></table></div></section>';
  }
  function method() {
    return '<details class="ds-method mt-method"><summary>日期口径、历史行情与复核来源</summary>' +
      '<p>美国中期选举在总统任期中间的偶数年举行，法定日期为 11 月第一个星期一之后的星期二。默认取选举日收盘，休市则用前一收盘；也可改为选后首个交易日收盘。两种起算方法都在选举日之后相同的日历目标日截止，遇休市取之前最近的收盘。</p>' +
      '<p>标普 500 正式发布于 1957-03-04。1950、1954 两届使用发布前回算行情；可改选仅含正式发布后的样本。结果是价格指数的累计涨跌，不含股息。区间出现超过 10 个自然日的行情断档时不计算收益或回撤。只有期末涨幅严格大于零才计入上涨。</p>' +
      '<p><a href="https://uscode.house.gov/us/usc/t2/s7/" target="_blank" rel="noopener noreferrer">美国选举日规定 ↗</a> · ' +
      '<a href="https://www.spglobal.com/spdji/en/indices/equity/sp-500/" target="_blank" rel="noopener noreferrer">标普指数资料 ↗</a> · ' +
      '<a href="https://finance.yahoo.com/quote/%5EGSPC/history/" target="_blank" rel="noopener noreferrer">历史收盘 ↗</a> · ' +
      '<a href="https://github.com/jianxieb/fund-data/blob/main/docs/midterm-study-method.md" target="_blank" rel="noopener noreferrer">逐届核对与完整方法 ↗</a></p></details>';
  }
  function download() {
    const rows = [['指数与口径','行情截至','样本范围','起算规则','届次','选举日','指数发布前回算','实际起算日','起算收盘','选后期限','目标日','实际期末日','期末收盘','状态','具体原因','累计涨跌%','期内最大回撤%']];
    for (const e of active.events) for (const h of D.horizons) {
      const o=e.outcomes[h];
      rows.push(['标普500 · 美元价格指数（不含分红）',active.asOf,choices.era[active.era],choices.entry[active.entry],e.year,e.date,e.preLaunch?'是':'否',e.anchorDate,e.anchorClose,
        terms[h],o.targetDate,o.date,o.close,{complete:'已到期',pending:'未到期',missing:'缺行情'}[o.status],o.reason,o.pct,o.maxDrawdownPct]);
    }
    H.download('标普500-中期选举-'+active.era+'-'+active.entry+'-'+active.asOf+'.csv',M.csv(rows),'text/csv;charset=utf-8');
  }
  function view(helpers) {
    H=helpers;
    const head=H.head('MIDTERM ELECTIONS','中期选举后表现','美国中期选举之后，标普 500 在不同期限内有多少届收涨？');
    if (!series && !loading && !error) load();
    if (!series) return head + '<div role="status" class="ds-panel ds-loading">' + (error ? esc(error) + ' <button class="text-link" data-mt-action="retry">重新加载</button>' : '正在读取标普 500 历史收盘…') + '</div>';
    const st=state(), key=st.era+'/'+st.entry;
    try { if (!results.has(key)) results.set(key,D.study(series,st)); }
    catch (e) { return head+'<div class="ds-panel ds-loading" role="status">'+esc(e.message)+'</div>'; }
    active=results.get(key);
    return head + '<div class="mt-controls">' + select('era','选举样本',st) + select('entry','起算点',st) + '</div>' + highlight(active) + summary(active) + eventRows(active,st) + method();
  }
  function choose(key,value) {
    if (!Object.hasOwn(defaults,key) || !Object.hasOwn(choices[key],value)) return;
    const next={...state(),[key]:value}, q=new URLSearchParams();
    for (const k of Object.keys(defaults)) if (next[k]!==defaults[k]) q.set(k,next[k]);
    history.replaceState(null,'','#midterm-study'+(q.size?'?'+q:''));
    H.render();
  }
  document.addEventListener('click',e=>{
    const key=e.target.closest('[data-mt-action]')?.dataset.mtAction;
    if (key==='retry') {error=''; H.render();}
    if (key==='csv' && active) download();
  });
  window.ChanghengMidtermStudy={view,choose};
})();
