(function () {
  'use strict';
  const M = window.ChanghengHoldingPeriodModel;
  const state = { symbol: 'BRK-B', currency: 'USD', years: 2, catalog: null, loadingCatalog: false, catalogError: '', showAll: false, selected: null };
  const histories = new Map(), pending = new Map(), errors = new Map(), studies = new Map();
  let ctx, plot = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const pct = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + num(value) + '%' : '—';
  const code = asset => asset.code === 'BRK-B' ? 'BRK.B' : asset.code;
  const button = (label, action, value = '', cls = '', extra = '') => `<button type="button" class="${cls}" data-hp="${action}" data-value="${esc(value)}" ${extra}>${label}</button>`;
  const link = (url, label) => /^https:\/\//.test(url || '') ? `<a class="hp-text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : '';
  const rerender = () => { if (/^#holding-period(?:\/|$)/.test(location.hash)) ctx?.render(); };
  function loadCatalog() {
    if (window.PORTFOLIO_CATALOG) { state.catalog = window.PORTFOLIO_CATALOG; return; }
    if (state.loadingCatalog || state.catalogError) return;
    state.loadingCatalog = true;
    const script = document.createElement('script');
    script.src = document.querySelector('#portfolio-source')?.dataset.src || 'data/portfolio/catalog.js';
    script.onload = () => {
      state.loadingCatalog = false;
      if (window.PORTFOLIO_CATALOG?.schemaVersion !== 1 || !Array.isArray(window.PORTFOLIO_CATALOG.assets)) state.catalogError = '标的目录格式不支持';
      else state.catalog = window.PORTFOLIO_CATALOG;
      rerender();
    };
    script.onerror = () => { state.loadingCatalog = false; state.catalogError = '标的目录加载失败'; rerender(); };
    document.head.append(script);
  }
  function loadHistory(asset) {
    if (!asset || histories.has(asset.id) || pending.has(asset.id) || errors.has(asset.id)) return;
    const request = (async () => {
      if (asset.status !== 'available') throw new Error(asset.name + '：' + (asset.missing || '缺已发布历史'));
      if (!/^data\/portfolio\/[a-z]+\/[\w-]+\.json$/.test(asset.historyUrl || '')) throw new Error(asset.name + '：历史路径无效');
      if (!/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw new Error(asset.name + '：缺历史文件校验摘要');
      if (!globalThis.crypto?.subtle) throw new Error('浏览器无法校验历史文件，请使用 HTTPS 或本机 localhost 页面');
      const response = await fetch(asset.historyUrl);
      if (!response.ok) throw new Error(asset.name + '：历史请求失败（' + response.status + '）');
      const raw = await response.text(), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(n => n.toString(16).padStart(2, '0')).join('');
      if (hash !== asset.sha256) throw new Error(asset.name + '：历史文件与目录校验不一致，请刷新页面');
      const history = JSON.parse(raw);
      M.validateHistory(asset, history, asset.id === 'fx:CNY');
      histories.set(asset.id, history);
    })().catch(error => { errors.set(asset.id, error.message); }).finally(() => { pending.delete(asset.id); rerender(); });
    pending.set(asset.id, request);
  }
  function selectedAsset() { return M.eligibleAssets(state.catalog).find(a => a.code === state.symbol); }
  function studyFor(asset) {
    if (!histories.has(asset.id) || state.currency === 'CNY' && !histories.has(state.catalog.fx?.id)) return null;
    const key = asset.id + ':' + state.currency;
    if (!studies.has(key)) {
      try { studies.set(key, M.analyze({ asset, history: histories.get(asset.id), currency: state.currency, fxAsset: state.catalog.fx, fxHistory: histories.get(state.catalog.fx?.id) })); }
      catch (error) { studies.set(key, { error: error.message }); }
    }
    return studies.get(key);
  }
  function controls(asset) {
    const assets = M.eligibleAssets(state.catalog), groups = [['stock', '美股公司'], ['etf', '海外 ETF']];
    return `<div class="hp-controls"><label class="hp-asset-label">研究标的<select data-hp-select="asset" aria-label="研究标的">${asset ? '' : `<option value="${esc(state.symbol)}">${esc(state.symbol)} · 未收录</option>`}${groups.map(([kind, name]) => `<optgroup label="${name}">${assets.filter(a => a.kind === kind).sort((a, b) => a.code.localeCompare(b.code)).map(a => `<option value="${esc(a.code)}" ${a.code === state.symbol ? 'selected' : ''}>${esc(a.name)}${a.status !== 'available' ? ' · 缺历史' : ''}</option>`).join('')}</optgroup>`).join('')}</select></label><div class="hp-control-group"><span>收益币种</span><div class="hp-segmented" role="group" aria-label="收益币种">${[['USD', '美元'], ['CNY', '人民币']].map(([id, label]) => button(label, 'currency', id, state.currency === id ? 'is-active' : '', `aria-pressed="${state.currency === id}"`)).join('')}</div></div><div class="hp-control-group"><span>持有期限</span><div class="hp-segmented" role="group" aria-label="持有期限">${M.PERIODS.map(y => button(y + '年', 'years', y, state.years === y ? 'is-active' : '', `aria-pressed="${state.years === y}"`)).join('')}</div></div></div>`;
  }
  function loading(message, retry = false) { return `<div class="hp-empty" role="status"><p>${esc(message)}</p>${retry ? button('重新加载', 'retry', '', 'btn') : ''}</div>`; }
  function summary(period, study) {
    const latest = period.latest;
    return `<section class="hp-summary" aria-label="当前区间与历史样本"><div class="hp-current"><span>最近${period.years}年年化</span><strong>${latest ? button(pct(latest.annualReturn), 'window', period.years + ':latest', 'hp-current-link' + (latest.annualReturn < 0 ? ' hp-negative' : ''), 'aria-label="查看最近' + period.years + '年的实际区间与路径"') : '—'}</strong><small>${latest ? latest.start + ' — ' + latest.end : esc(period.latestMissing)}</small>${latest && period.count ? `<p>处于历史月末窗口的 <b>${num(period.latestRank, 1)}%</b> 分位</p>` : ''}</div><div><span>历史窗口年化中位</span><strong>${pct(period.median)}</strong><small>${period.count ? '中间80%：' + pct(period.p10) + ' 至 ' + pct(period.p90) : '没有完整窗口'}</small></div><div><span>历史亏损月份占比</span><strong>${period.count ? num(period.lossShare, 1) + '%' : '—'}</strong><small>${period.count ? period.lossCount + ' / ' + period.count + ' 个买入月份期末亏损' : '没有完整窗口，不计算比例'}</small></div><div><span>完整历史窗口</span><strong>${period.count}<small>个</small></strong><small>${period.count ? period.samples[0].start.slice(0, 7) + ' — ' + period.samples.at(-1).start.slice(0, 7) + ' 买入' : '自身行情不足或端点缺失'}</small></div></section>`;
  }
  function chart(study, period) {
    const samples = period.samples;
    if (!samples.length) return loading('尚无完整的' + period.years + '年历史月末窗口；可以切换较短期限。');
    const w = 1200, h = 350, l = 65, r = 30, t = 26, b = 299;
    const values = samples.map(s => s.annualReturn).concat(period.latest ? [period.latest.annualReturn] : [], [0]);
    let low = Math.min(...values), high = Math.max(...values), pad = (high - low) * .12 || 2;
    low -= pad; high += pad;
    const first = Date.parse(samples[0].start), last = Date.parse(samples.at(-1).start), span = last - first || 86400000;
    const x = day => l + (Date.parse(day) - first) / span * (w - l - r), y = value => b - (value - low) / (high - low) * (b - t);
    let path = '';
    samples.forEach((s, i) => { const disconnected = !i || Date.parse(s.start) - Date.parse(samples[i - 1].start) > 45 * 86400000; path += (disconnected ? ' M' : ' L') + x(s.start).toFixed(2) + ' ' + y(s.annualReturn).toFixed(2); });
    const remembered = samples.findIndex(s => s.start === state.selected), index = remembered < 0 ? samples.length - 1 : remembered;
    plot = { study, period, samples, x, y, index, w, l, r, t, b, first, span };
    const selected = samples[index];
    return `<div class="hp-chart-readout"><time data-hp-read-date>${selected.start} 买入</time><span>持有${period.years}年年化 <b data-hp-read-return>${pct(selected.annualReturn)}</b></span><span data-hp-read-end>截至 ${selected.end}</span>${button('查看这一窗口', 'selected', '', 'hp-text-link')}</div><svg class="hp-chart" viewBox="0 0 ${w} ${h}" data-hp-plot tabindex="0" role="img" aria-label="各买入月份持有${period.years}年的年化收益。横轴为买入月份；左右方向键选择窗口，回车查看详情。"><title>${esc(study.asset.name)}：各买入月份持有${period.years}年的年化收益</title><text x="${l}" y="14">年化收益（%）</text>${Array.from({ length: 5 }, (_, i) => { const v = low + (high - low) * i / 4; return `<line class="hp-gridline" x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 12}" y="${y(v) + 4}" text-anchor="end">${num(v, 0)}%</text>`; }).join('')}<line class="hp-zero" x1="${l}" x2="${w - r}" y1="${y(0)}" y2="${y(0)}"/>${period.latest ? `<line class="hp-latest-line" x1="${l}" x2="${w - r}" y1="${y(period.latest.annualReturn)}" y2="${y(period.latest.annualReturn)}"/>` : ''}<path class="hp-return-line" d="${path}"/>${samples.length === 1 ? `<circle class="hp-return-point" cx="${x(selected.start)}" cy="${y(selected.annualReturn)}" r="4"/>` : ''}${Array.from({ length: samples.length === 1 ? 1 : 6 }, (_, i) => { const s = samples[Math.round((samples.length - 1) * i / 5)]; return `<text x="${x(s.start)}" y="${h - 26}" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}">${s.start.slice(0, 7)}</text>`; }).join('')}<text x="${w - r}" y="${h - 6}" text-anchor="end">买入月份</text><g class="hp-cursor" aria-hidden="true"><line data-hp-cursor x1="${x(selected.start)}" x2="${x(selected.start)}" y1="${t}" y2="${b}"/><circle data-hp-point cx="${x(selected.start)}" cy="${y(selected.annualReturn)}" r="4"/></g><rect x="${l}" y="${t}" width="${w - l - r}" height="${b - t}" fill="transparent"/></svg><div class="hp-chart-legend"><span><i></i>每月末买入，持有${period.years}年</span>${period.latest ? `<span><i class="hp-legend-latest"></i>最近${period.years}年 ${pct(period.latest.annualReturn)}</span>` : ''}<small>每一点是一段完整持有期，收益已包含分红再投。</small></div>`;
  }
  function periodTable(study) {
    return `<section class="hp-panel"><header class="hp-section-head"><div><span class="hp-kicker">不同期限，结果分散到什么程度</span><h2>持有时间与历史结果</h2></div><span>统一按实际持有天数年化</span></header><div class="hp-table-scroll"><table class="hp-table"><thead><tr><th>持有期限</th><th>最近区间</th><th>历史中位</th><th>历史中间80%</th><th>最差窗口</th><th>最好窗口</th><th>亏损月份占比</th><th>样本数</th></tr></thead><tbody>${study.periods.map(p => `<tr class="${state.years === p.years ? 'is-selected' : ''}"><th scope="row">${button(p.years + '年', 'years', p.years, 'hp-text-link')}</th><td>${pct(p.latest?.annualReturn)}${p.latest ? '' : `<small>${esc(p.latestMissing)}</small>`}</td><td>${pct(p.median)}</td><td>${p.count ? pct(p.p10) + ' 至 ' + pct(p.p90) : '—'}</td><td>${p.worst ? button(pct(p.worst.annualReturn), 'window', p.years + ':' + p.worst.start, 'hp-text-link' + (p.worst.annualReturn < 0 ? ' hp-negative' : '')) : '—'}</td><td>${p.best ? button(pct(p.best.annualReturn), 'window', p.years + ':' + p.best.start, 'hp-text-link' + (p.best.annualReturn < 0 ? ' hp-negative' : '')) : '—'}</td><td>${p.count ? num(p.lossShare, 1) + '%' : '—'}</td><td>${p.count}</td></tr>`).join('')}</tbody></table></div><p class="hp-note">各期限使用各自已走完的窗口，买入月份范围并不相同。没有样本时留空，不能用较短持有期代替。</p></section>`;
  }
  function samplesTable(study, period) {
    const rows = [...period.samples].reverse(), shown = rows.slice(0, state.showAll ? rows.length : 12);
    return `<section class="hp-panel"><header class="hp-section-head"><div><span class="hp-kicker">具体在哪个月买入，结果怎样</span><h2>${period.years}年持有窗口明细</h2></div>${button('导出全部样本 CSV', 'csv', '', 'btn sm', period.count ? '' : 'disabled')}</header><div class="hp-table-scroll"><table class="hp-table hp-samples"><thead><tr><th>买入收盘日</th><th>卖出收盘日</th><th>实际年数</th><th>累计收益</th><th>年化收益</th><th>路径</th></tr></thead><tbody>${shown.length ? shown.map(s => `<tr><th scope="row">${s.start}</th><td>${s.end}</td><td>${num(s.actualYears, 3)}</td><td class="${s.totalReturn < 0 ? 'hp-negative' : ''}">${pct(s.totalReturn)}</td><td class="${s.annualReturn < 0 ? 'hp-negative' : ''}">${pct(s.annualReturn)}</td><td>${button('查看', 'window', period.years + ':' + s.start, 'hp-text-link', `aria-label="查看${s.start}买入持有${period.years}年的路径"`)}</td></tr>`).join('') : '<tr><td colspan="6">没有完整样本</td></tr>'}</tbody></table></div>${rows.length > 12 ? button(state.showAll ? '收起较早窗口' : '展开全部 ' + rows.length + ' 个窗口', 'all', '', 'hp-show-all') : ''}${Object.keys(period.excluded).length ? `<details class="hp-exclusions"><summary>已剔除 ${Object.values(period.excluded).reduce((a, b) => a + b, 0)} 个资料不足的窗口</summary><ul>${Object.entries(period.excluded).map(([reason, count]) => `<li>${esc(reason)}：${count} 个</li>`).join('')}</ul></details>` : ''}</section>`;
  }
  function view(context) {
    ctx = context; plot = null;
    const requested = context.symbol || 'BRK-B';
    if (state.symbol !== requested) { state.symbol = requested; state.selected = null; state.showAll = false; }
    if (!state.catalog) loadCatalog();
    const header = `<header class="hp-header"><div><div class="eyebrow">HOLDING PERIOD RESEARCH</div><h1>持有期研究</h1><p>换一个买入月份，持有同样久，结果会怎样？</p></div>${button('数据与计算口径', 'method', '', 'hp-text-link')}</header>`;
    if (!state.catalog) return `<div class="hp-report">${header}${loading(state.catalogError || '正在读取研究标的…', !!state.catalogError)}</div>`;
    const asset = selectedAsset();
    let body = '';
    if (!asset) body = loading(state.symbol + ' 尚未收录为海外ETF或美股，不使用其他产品替代。');
    else {
      loadHistory(asset);
      if (state.currency === 'CNY') loadHistory(state.catalog.fx);
      const error = errors.get(asset.id) || (state.currency === 'CNY' && (errors.get(state.catalog.fx?.id) || (!state.catalog.fx ? '缺美元兑人民币汇率目录' : '')));
      const study = error ? null : studyFor(asset);
      if (error || study?.error) body = loading(error || study.error, true);
      else if (!study) body = loading('正在读取并校验' + esc(code(asset)) + '的真实历史…');
      else {
        const period = study.periods.find(p => p.years === state.years);
        body = `<div class="hp-identity"><h2>${esc(asset.name)}</h2><span>${asset.kind === 'stock' ? '公司股票' : 'ETF'} · ${state.currency === 'USD' ? '美元' : '人民币，含汇率变化'} · 行情 ${study.first} — ${study.asOf}${asset.leverage > 1 ? ' · ' + asset.leverage + '倍每日杠杆产品' : ''}</span></div>${asset.leverage > 1 ? '<p class="hp-warning">该产品按日重设杠杆，长期收益不等于标的指数收益乘以杠杆倍数。</p>' : ''}${asset.historyNote ? `<p class="hp-warning">${esc(asset.historyNote)} ${link(asset.historySourceUrl, '策略变更依据')}</p>` : ''}${summary(period, study)}<section class="hp-panel hp-chart-panel"><header class="hp-section-head"><div><span class="hp-kicker">买入时点如何改变持有结果</span><h2>持有${period.years}年，每个月买入的结果</h2></div><span>${period.count} 个已完成窗口</span></header>${chart(study, period)}<p class="hp-note hp-important">历史亏损月份占比不是未来亏损概率。${period.count ? `相邻窗口大量重叠，不是${period.count}次独立试验；图中收益是期末结果，不代表期间没有回撤。` : '没有完整窗口时，收益与比例均不计算。'}</p></section>${periodTable(study)}${samplesTable(study, period)}<footer class="hp-footer"><span>分红再投；产品年费已包含，未扣个人税款、佣金及换汇价差。当前存续证券的样本不能代表所有曾上市产品。</span>${link(study.priceSource, '原始行情')}</footer>`;
      }
    }
    return `<div class="hp-report">${header}${controls(asset)}${body}</div>`;
  }
  function currentStudy() { const a = selectedAsset(); return a && studyFor(a); }
  function pathChart(study, sample) {
    const points = M.windowPath(study, sample), valid = points.filter(p => Number.isFinite(p[1]));
    const w = 860, h = 285, l = 58, r = 18, t = 25, b = 244, range = valid.map(p => p[1]).concat([100]);
    const low = Math.min(...range) * .95, high = Math.max(...range) * 1.05;
    const x = d => l + (Date.parse(d) - Date.parse(sample.start)) / (Date.parse(sample.end) - Date.parse(sample.start)) * (w - l - r), y = v => b - (v - low) / (high - low) * (b - t);
    let path = '', gap = true;
    for (const [d, value] of points) { if (value === null) { gap = true; continue; } path += (gap ? ' M' : ' L') + x(d).toFixed(2) + ' ' + y(value).toFixed(2); gap = false; }
    return `<svg class="hp-window-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${sample.start}投入100份计价货币，持有至${sample.end}的含分红价值路径"><title>初始价值100，${study.currency}计价</title>${Array.from({ length: 4 }, (_, i) => { const v = low + (high - low) * i / 3; return `<line class="hp-gridline" x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 10}" y="${y(v) + 4}" text-anchor="end">${num(v, 0)}</text>`; }).join('')}<line class="hp-zero" x1="${l}" x2="${w - r}" y1="${y(100)}" y2="${y(100)}"/><path class="hp-return-line" d="${path}"/><text x="${l}" y="15">初始价值100 · ${study.currency}</text><text x="${l}" y="${h - 12}">${sample.start}</text><text x="${w - r}" y="${h - 12}" text-anchor="end">${sample.end}</text></svg>${valid.length !== points.length ? '<p class="hp-note">部分中途日期缺7天内汇率，路径断线；起止端点齐全，区间收益仍可计算。</p>' : ''}`;
  }
  function openWindow(value) {
    const study = currentStudy(); if (!study || study.error) return;
    const [year, start] = value.split(':'), period = study.periods.find(p => p.years === Number(year));
    const sample = start === 'latest' ? period?.latest : period?.samples.find(s => s.start === start);
    if (!sample) return;
    ctx.openModal(`<div class="hp-detail">${ctx.modalTitle(esc(study.asset.name) + ' · 持有' + sample.years + '年', sample.start + ' — ' + sample.end)}<div class="hp-detail-stats"><div><span>累计收益</span><strong>${pct(sample.totalReturn)}</strong></div><div><span>年化收益</span><strong>${pct(sample.annualReturn)}</strong></div><div><span>实际持有年数</span><strong>${num(sample.actualYears, 3)}</strong></div></div>${pathChart(study, sample)}<dl class="hp-endpoints"><div><dt>买入 / 卖出复权价</dt><dd>${num(sample.startPrice, 6)} / ${num(sample.endPrice, 6)} USD</dd></div><div><dt>周年目标日 / 实际终日</dt><dd>${sample.targetEnd} / ${sample.end}</dd></div>${study.currency === 'CNY' ? `<div><dt>起日USD/CNY</dt><dd>${num(sample.startFx, 6)} · ${sample.fxStart}</dd></div><div><dt>终日USD/CNY</dt><dd>${num(sample.endFx, 6)} · ${sample.fxEnd}</dd></div>` : ''}</dl><p class="hp-note">复权价只用于还原含分红持有回报，不是该日可成交报价；分红已再投，不另加分红。股价与汇率均只取当日或此前观测。</p><div class="hp-detail-links">${link(study.priceSource, '股价来源')}${study.currency === 'CNY' ? link(study.fxSource, '汇率来源') : ''}</div></div>`);
  }
  function method() {
    ctx.openModal(`<div class="hp-detail">${ctx.modalTitle('持有期研究口径', '历史买入月份，不是未来情景概率')}<div class="hp-method"><h3>每个样本怎样形成</h3><p>采用该股票或ETF自身的美元复权收盘历史。每个已结束自然月最后一个真实收盘日买入，周年目标日及此前7天内最近收盘日卖出，只保留已经走完的1、2、3、5、10年窗口。买入日距离月末超过7天，或持有期间行情中断超过14天，均剔除。</p><h3>人民币、分红与费用</h3><p>人民币累计回报＝终点复权价÷起点复权价×终点USD/CNY÷起点USD/CNY−1。汇率取端点当日或此前7天内最近有效观测，不使用未来值；缺端点则排除该窗口。年化按实际持有天数÷365.2425计算；周年日休市可能使一年窗口略短于一年，仍使用真实日期年化，不把日期补到周年日。分红按供应商口径再投，基金运营年费已反映在历史中，不再扣一次；未扣个人税费和交易费用。</p><h3>如何读统计</h3><p>中位数与10%—90%分位使用完整历史月末样本，分位采用线性插值。亏损月份占比只统计该持有期结束时累计收益小于0的月份。最近区间截至最新股价日，起点取周年日前7天内最近收盘；它通常不是月末窗口，因此单列，不混入历史样本数。</p><h3>历史不能回答什么</h3><p>月度窗口大量重叠，不能当作独立试验或未来概率。不同期限的可用起点不相同；当前收录产品有存续证券和人工选择偏差。已退市、清盘的产品不在这个总体中；ETF策略和跟踪基准也可能变化。较长持有期曾经更少亏损，不保证今后保本。</p><p>只研究当前收录证券自身的历史，不将指数点位替换为ETF，不拼接成立前历史。分红复权定义和来源沿用公开组合历史目录；下载文件通过SHA-256与目录校验，计算检查不等于独立核验全部供应商价格。</p><a class="hp-text-link" href="docs/holding-period-method.md" target="_blank" rel="noopener">完整方法记录 ↗</a></div></div>`);
  }
  function inspect(index, svg) {
    if (!plot) return;
    plot.index = Math.max(0, Math.min(plot.samples.length - 1, index));
    const sample = plot.samples[plot.index]; state.selected = sample.start;
    const panel = svg.closest('.hp-chart-panel');
    panel.querySelector('[data-hp-read-date]').textContent = sample.start + ' 买入';
    panel.querySelector('[data-hp-read-return]').textContent = pct(sample.annualReturn);
    panel.querySelector('[data-hp-read-end]').textContent = '截至 ' + sample.end;
    const cursor = svg.querySelector('[data-hp-cursor]'), point = svg.querySelector('[data-hp-point]');
    cursor.setAttribute('x1', plot.x(sample.start)); cursor.setAttribute('x2', plot.x(sample.start));
    point.setAttribute('cx', plot.x(sample.start)); point.setAttribute('cy', plot.y(sample.annualReturn));
  }
  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-hp]'); if (!target || !ctx) return;
    const action = target.dataset.hp, value = target.dataset.value;
    if (action === 'currency' && ['USD', 'CNY'].includes(value)) { state.currency = value; state.selected = null; }
    else if (action === 'years' && M.PERIODS.includes(Number(value))) { state.years = Number(value); state.selected = null; state.showAll = false; }
    else if (action === 'all') state.showAll = !state.showAll;
    else if (action === 'method') { method(); return; }
    else if (action === 'window') { openWindow(value); return; }
    else if (action === 'selected' && plot) { openWindow(plot.period.years + ':' + plot.samples[plot.index].start); return; }
    else if (action === 'csv') { const study = currentStudy(); if (study && !study.error) ctx.download(`${state.symbol}-${state.currency}-${state.years}年持有窗口.csv`, M.toCSV(study, state.years), 'text/csv;charset=utf-8'); return; }
    else if (action === 'retry') { state.catalogError = ''; errors.clear(); studies.clear(); }
    else return;
    ctx.render();
  });
  document.addEventListener('change', event => {
    if (event.target.matches?.('[data-hp-select="asset"]') && ctx) location.hash = 'holding-period/' + encodeURIComponent(event.target.value);
  });
  document.addEventListener('pointermove', event => {
    const svg = event.target.closest?.('[data-hp-plot]'); if (!svg || !plot) return;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    const target = plot.first + Math.max(0, Math.min(1, (local.x - plot.l) / (plot.w - plot.l - plot.r))) * plot.span;
    let nearest = 0;
    plot.samples.forEach((sample, i) => { if (Math.abs(Date.parse(sample.start) - target) < Math.abs(Date.parse(plot.samples[nearest].start) - target)) nearest = i; });
    inspect(nearest, svg);
  });
  document.addEventListener('keydown', event => {
    const svg = event.target.closest?.('[data-hp-plot]'); if (!svg || !plot) return;
    if (event.key === 'Enter') { event.preventDefault(); openWindow(plot.period.years + ':' + plot.samples[plot.index].start); }
    else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); inspect(event.key === 'Home' ? 0 : event.key === 'End' ? plot.samples.length - 1 : plot.index + (event.key === 'ArrowLeft' ? -1 : 1), svg); }
  });
  window.ChanghengHoldingPeriod = { view };
})();
