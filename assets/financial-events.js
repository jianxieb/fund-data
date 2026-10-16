(function () {
  'use strict';
  const M = window.Changheng, F = window.ChanghengFinancialEventsModel, G = window.ChanghengResearchCharts, esc = M.escapeHtml;
  const state = { id:'dotcom', query:'', category:'all', mode:'chapter', annual:false, view:'line', marker:null };
  let data, historyData, loading, error = '', H, result;
  const percent = n => M.finite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '—';
  const basis = r => r.basis === 'price_index' ? '价格指数 · 不含分红' : '基金复权回报 · 再投口径';
  async function load() {
    if (loading) return;
    loading = true; error = '';
    try {
      const [a, b] = await Promise.all(['financial-events-source', 'financial-events-history-source'].map(async id => {
        const response = await fetch(document.getElementById(id).dataset.src);
        if (!response.ok) throw new Error(id === 'financial-events-source' ? '事件资料加载失败' : '事件行情加载失败');
        return response.text();
      }));
      const definitions = JSON.parse(a), histories = JSON.parse(b);
      if (globalThis.crypto?.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (hash !== histories.definitionsSha256) throw new Error('事件资料与行情版本不一致，请刷新后重试');
      }
      if (definitions.schemaVersion !== 1 || histories.schemaVersion !== 1) throw new Error('事件资料版本无法识别');
      definitions.events.forEach(e => F.validate(e, histories.events[e.id]));
      data = definitions; historyData = histories;
    } catch (e) { error = e.message; }
    finally { loading = false; if (location.hash.split('?')[0] === '#financial-events') H.render(); }
  }
  function refresh() {
    const list = document.querySelector('.fe-event-list'), top = list?.scrollTop;
    H.render();
    if (top != null) document.querySelector('.fe-event-list')?.scrollTo(0, top);
  }
  function references(ids) {
    return ids.map(id => `<a href="${esc(data.sources[id].url)}" target="_blank" rel="noopener noreferrer" title="${esc(data.sources[id].label)}">${esc(data.sources[id].label.split('：')[0])} ↗</a>`).join(' ');
  }
  function library() {
    const categories = [...new Set(data.events.map(e => e.category))];
    const q = state.query.trim().toLowerCase();
    const rows = data.events.filter(e => (state.category === 'all' || e.category === state.category) && [e.title,e.years,e.question,e.category].join(' ').toLowerCase().includes(q));
    return `<aside class="fe-library" aria-label="历史事件选择"><div class="fe-library-head"><b>事件时间线</b><span>${rows.length} / ${data.events.length}</span></div><input id="fe-search" type="search" placeholder="搜索事件、年份" aria-label="搜索历史事件" value="${esc(state.query)}"><select id="fe-category" aria-label="筛选事件类型"><option value="all">全部类型</option>${categories.map(c => `<option${c === state.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select><div class="fe-event-list">${rows.length ? rows.map(e => `<a href="#financial-events?event=${e.id}" class="fe-event${state.id === e.id ? ' active' : ''}"${state.id === e.id ? ' aria-current="true"' : ''}><time>${esc(e.years)}</time><strong>${esc(e.title)}</strong><small>${esc(e.category)}</small></a>`).join('') : '<p class="empty">没有匹配事件</p>'}</div></aside>`;
  }
  function market(e) {
    result = F.study(e, historyData.events[e.id], state.mode);
    const r = result, marker = state.marker || e.eventDate;
    const markerLabel = e.timeline.find(t => t.date === marker)?.title || '事件观察点';
    const options = [['chapter','完整过程'],['reaction','事件前后'],['year','后续一年']];
    return `<section class="fe-market card" aria-labelledby="fe-market-title"><div class="fe-section-head"><div><span class="fe-kicker">01 · 市场结果</span><h3 id="fe-market-title">${state.view === 'line' ? '把资产放在同一张收益图上' : '期末回报与期间回撤'}</h3></div><div class="segmented">${[['line','收益曲线'],['bars','回报柱状图']].map(([v,label]) => `<button data-fe-view="${v}" aria-pressed="${state.view === v}" class="${state.view === v ? 'active' : ''}">${label}</button>`).join('')}</div></div><div class="fe-chart-controls"><div class="segmented">${options.map(([v,label]) => `<button data-fe-mode="${v}" aria-pressed="${state.mode === v}" class="${state.mode === v ? 'active' : ''}">${label}</button>`).join('')}</div><label class="fe-check"><input type="checkbox" id="fe-annual"${state.annual ? ' checked' : ''}> 附加年化回报</label></div><p class="fe-period">${r.start} — ${r.end} · 基准收盘 ${r.baseDate} · 各资产原币 · 税前${r.incomplete ? ' <span class="badge warn">后续窗口尚未走完</span>' : ''}</p><div class="fe-legend">${r.rows.map((row,i) => `<div class="fe-legend-item"><i style="background:${G.colors[i]}"></i><div><b>${esc(row.code)}</b><span>${esc(row.name)}</span><small>${esc(row.currency)} · ${basis(row)}</small></div><div class="fe-return"><b>${percent(row.total)}</b><small>期末累计</small>${state.annual ? `<small>年化 ${row.annual === null ? '不足1年' : percent(row.annual)}</small>` : ''}<small>期间回撤 ${percent(row.mdd)}</small></div></div>`).join('')}</div>${state.view === 'line' ? G.line(r.rows, {title:e.title + '：相对基准收盘的累计回报',marker,markerLabel:markerLabel.slice(0,18)}) : G.bars(r.rows)}${state.view === 'line' ? `<div class="rc-date-scrubber"><label for="fe-date">查看日期</label><input id="fe-date" type="range" min="0" max="${r.dates.length - 1}" value="${r.dates.length - 1}"><output id="fe-date-label">${r.end}</output></div><div class="fe-cursor-values">${r.rows.map((row,i) => `<span style="--fe-color:${G.colors[i]}">${esc(row.code)} <b data-fe-value="${i}">${percent(row.total)}</b></span>`).join('')}</div>` : ''}<p class="rc-axis-note">${state.view === 'line' ? '纵轴为累计回报；' : ''}${state.mode === 'chapter' ? '以完整过程的首个共同收盘为0%' : '以事件前的共同收盘为0%，保留此前约20个交易日'}。${r.rows.some(row => row.code === 'USO') ? 'USO是原油期货基金，不能当作现货油价。' : ''}</p><details class="fe-outcomes" open><summary>事件之后，不同持有期发生了什么</summary><p>各自从事件观察交易日前一收盘起算；列名为各市场的交易日数。以下累计回报不随上方图表窗口改变。</p><div class="table-wrap"><table><thead><tr><th>资产 / 基准日</th>${F.horizons.map(n => `<th>后${n}个交易日</th>`).join('')}</tr></thead><tbody>${r.outcomes.map(row => `<tr><td><b>${esc(row.code)}</b><small>${row.baseDate || '缺前收盘'}</small></td>${row.results.map(v => `<td class="${v.value === null ? '' : v.value >= 0 ? 'fe-gain' : 'fe-loss'}"><b>${percent(v.value)}</b><small>${esc(v.reason || v.end)}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></details></section>`;
  }
  function narrative(e) {
    const ids = [...new Set(e.timeline.flatMap(t => t.sources))];
    return `<section class="fe-narrative"><div class="fe-section-head"><div><span class="fe-kicker">02 · 事件经过</span><h3>把价格变化放回当时的信息里</h3></div><span class="muted">点日期可标在上方曲线上</span></div><ol class="fe-timeline">${e.timeline.map(t => `<li>${t.date.length === 10 ? `<button data-fe-mark="${t.date}" class="fe-date" aria-label="在图上标记${t.date} ${esc(t.title)}">${t.date}</button>` : `<time class="fe-date">${t.date}</time>`}<div><h4>${esc(t.title)}</h4><p>${esc(t.body)}</p><div class="fe-citations">${references(t.sources)}</div></div></li>`).join('')}</ol></section><section class="fe-analysis"><div class="fe-section-head"><div><span class="fe-kicker">03 · 传导分析</span><h3>${esc(e.question)}</h3></div><span class="muted">以下为项目分析</span></div><div class="fe-channels">${e.channels.map((c,i) => `<article><span>${String(i+1).padStart(2,'0')}</span><h4>${esc(c.title)}</h4><p>${esc(c.body)}</p></article>`).join('')}</div><div class="fe-implication"><h4>对中国投资者的联系</h4><p>${esc(e.china)}</p></div><div class="fe-watch"><h4>把分析落到可观察的数据</h4>${e.watch.map(w => `<div><b>${esc(w.metric)}</b><p>${esc(w.meaning)}</p></div>`).join('')}</div><p class="fe-takeaway">${esc(e.lesson)}</p></section><details class="fe-evidence"><summary>来源、行情口径与分析边界 · 资料复核 ${data.reviewedAt}</summary><p>本页展示事件附近实际发生的回报，并未估计“如果事件没有发生”的反事实。相同日期还包含盈利、利率、仓位与其他消息；不能把全部涨跌归因于单个事件。观察区间由事后研究选定，不是事前买卖信号。</p>${e.anchorNote ? `<p>${esc(e.anchorNote)}</p>` : ''}<p>“后续一年”采用约252个共同交易日；表格按各市场自身交易日计数并列明实际结束日期。价格指数不含分红；ETF使用数据商复权价，反映分配再投与拆分调整，已含基金运营费，未扣投资者税费。不补齐缺失日期、不拼接尚未成立产品。</p><ul>${ids.map(id => `<li><a href="${esc(data.sources[id].url)}" target="_blank" rel="noopener noreferrer">${esc(data.sources[id].label)} ↗</a></li>`).join('')}</ul><div class="table-wrap"><table><thead><tr><th>行情</th><th>回报口径</th><th>源数据截至</th></tr></thead><tbody>${historyData.events[e.id].map(r => `<tr><td><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.name)} ↗</a></td><td>${esc(r.currency)} · ${basis(r)}</td><td>${r.historyAsOf}</td></tr>`).join('')}</tbody></table></div><p>日期采用交易所当地收盘日；早年上证历史由Yahoo Finance上证指数日线提供，不冒用中证接口覆盖范围。正文与图表数据分别更新：最新行情不代表事件分析已经重新复核。</p><a href="docs/financial-events-method.md" target="_blank" rel="noopener">完整研究方法 ↗</a></details>`;
  }
  function view(helpers) {
    H = helpers;
    const head = H.head('GLOBAL FINANCE / EVENT STUDIES','历史事件','从事件时间线到资产回报，再看政策、盈利与资金如何传导。');
    if (!data) { if (!error) load(); return head + `<div class="card fe-loading">${error ? esc(error) + ' <button class="btn" data-fe-retry>重新加载</button>' : '正在加载历史事件与实际行情…'}</div>`; }
    const id = new URLSearchParams(location.hash.split('?')[1] || '').get('event');
    if (id && id !== state.id && data.events.some(e => e.id === id)) { state.id=id; state.mode='chapter'; state.marker=null; }
    const e = data.events.find(x => x.id === state.id) || data.events[0];
    let chart;
    try { chart = market(e); } catch (ex) { chart = `<div class="notice">${esc(ex.message)}</div>`; }
    return head + `<div class="fe-layout">${library()}<article class="fe-chapter"><header class="fe-chapter-head"><div class="fe-meta">${esc(e.years)}<span>${esc(e.category)}</span>${e.ongoing ? '<b class="badge warn">尚在发展中</b>' : ''}</div><h2>${esc(e.title)}</h2><p>${esc(e.lead)}</p>${e.anchorNote ? `<small>${esc(e.anchorNote)}</small>` : ''}</header>${chart}${narrative(e)}</article></div>`;
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('.page-financial-events') && location.hash.split('?')[0] !== '#financial-events') return;
    const button = event.target.closest('[data-fe-mode],[data-fe-view],[data-fe-mark],[data-fe-retry]');
    if (!button) return;
    if (button.hasAttribute('data-fe-retry')) { load(); return; }
    if (button.dataset.feMode) state.mode = button.dataset.feMode;
    if (button.dataset.feView) state.view = button.dataset.feView;
    if (button.dataset.feMark) {
      state.marker = button.dataset.feMark;
      state.view = 'line';
      if (!result || state.marker < result.start || state.marker > result.end) state.mode='chapter';
    }
    refresh();
    if (button.dataset.feMark) document.querySelector('.fe-market')?.scrollIntoView({block:'start',behavior:'smooth'});
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'fe-search') { state.query=event.target.value; refresh(); }
    if (event.target.id === 'fe-date' && result) {
      const date = result.dates[+event.target.value];
      document.getElementById('fe-date-label').textContent=date;
      result.rows.forEach((row,i) => { document.querySelector(`[data-fe-value="${i}"]`).textContent=percent(row.points.find(p => p[0] === date)?.[1]); });
      const x = 72 + (Date.parse(date) - Date.parse(result.start)) / (Date.parse(result.end) - Date.parse(result.start)) * (1120-72-30);
      const line=document.querySelector('.fe-market [data-rc-cursor]'); line?.setAttribute('x1',x); line?.setAttribute('x2',x);
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'fe-category') { state.category=event.target.value; refresh(); }
    if (event.target.id === 'fe-annual') { state.annual=event.target.checked; refresh(); }
  });
  window.ChanghengFinancialEvents = { view };
})();
