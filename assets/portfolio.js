(function () {
  'use strict';
  const M = window.Changheng, P = window.ChanghengPortfolioModel, KEY = 'changheng.portfolio.v1';
  let H, catalog = window.PORTFOLIO_CATALOG || null, loading = false, loadError = '', running = false, runId = 0;
  const histories = new Map(), requests = new Map();
  const defaults = { positions: [], initial: 100000, monthly: 0, rebalance: 'none', transactionFee: 0,
    years: 5, start: '', end: '', benchmarkId: 'us:SPY', feeOverrides: {} };
  let draft = { ...defaults }, query = '', kind = 'all', market = 'all', hideBoards = false, pickerMode = 'holding';
  let result = null, resultKey = '', error = '', metric = 'return', importError = '';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.positions)) draft = { ...defaults, ...saved };
  } catch (_) {}
  const colors = ['#35654a', '#768855', '#aa8253', '#7d839f', '#64a6a1', '#ad6f78', '#8ba9cf', '#aab865'];
  const typeName = { stock: '个股', fund: '基金', etf: 'ETF' };
  const config = () => ({ ...draft, feeBasis: 'net', feeOverrides: {} });
  const signature = () => JSON.stringify(config());
  const asset = id => catalog?.assets.find(a => a.id === id);
  const btn = (text, act, cls = 'btn', extra = '') => H.action(text, 'portfolio-' + act, cls, extra);
  const tag = (text, cls = '') => '<span class="badge ' + cls + '">' + H.esc(text) + '</span>';
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch (_) { H.toast('浏览器未能保存组合，请导出配置'); } }
  function update() { H.render(); }
  function touch() {
    error = ''; persist();
    const label = document.getElementById('portfolio-dirty');
    if (label) label.textContent = result && resultKey !== signature() ? '参数已改动，重新模拟后生效' : '';
  }
  function ensureCatalog() {
    if (catalog || loading || loadError) return;
    loading = true;
    const script = document.createElement('script');
    script.src = document.getElementById('portfolio-source')?.dataset.src || 'data/portfolio/catalog.js';
    script.onload = () => {
      catalog = window.PORTFOLIO_CATALOG;
      loading = false;
      if (!catalog?.assets?.length) loadError = '组合标的库未加载成功';
      update();
    };
    script.onerror = () => { loading = false; loadError = '组合标的库加载失败，请重试'; update(); };
    document.head.append(script);
  }
  async function loadHistory(row) {
    if (!row || row.status !== 'available') throw new Error(row?.name + '：' + (row?.missing || '缺每日历史'));
    if (histories.has(row.id)) return histories.get(row.id);
    if (requests.has(row.id)) return requests.get(row.id);
    const promise = (async () => {
      if (!/^data\/portfolio\/[a-z]+\/[\w-]+\.json$/.test(row.historyUrl || '')) throw new Error(row.name + '：历史文件路径无效');
      const response = await fetch(row.historyUrl);
      if (!response.ok) throw new Error(row.name + '：历史文件请求失败（' + response.status + '）');
      const text = await response.text();
      if (globalThis.crypto?.subtle) {
        const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (digest !== row.sha256) throw new Error(row.name + '：历史文件校验不一致，请刷新页面');
      }
      const history = JSON.parse(text);
      P.validateHistory(row, history); histories.set(row.id, history);
      return history;
    })();
    requests.set(row.id, promise);
    try { return await promise; } finally { requests.delete(row.id); }
  }
  async function run() {
    if (running || !catalog) return;
    const params = config(), token = ++runId;
    try { P.validateConfig(params, new Set(catalog.assets.map(a => a.id))); }
    catch (e) { error = e.message; update(); return; }
    running = true; error = ''; update();
    try {
      const selected = params.positions.filter(p => p.weight > 0).map(p => asset(p.id));
      await Promise.all(selected.map(loadHistory));
      const benchmark = asset(params.benchmarkId);
      if (selected.some(a => a.currency === 'USD')) await loadHistory(catalog.fx);
      else if (benchmark?.currency === 'USD') await loadHistory(catalog.fx).catch(() => {});
      // Benchmark coverage is independent: an unavailable comparison cannot make
      // a valid user's combination impossible to simulate.
      if (benchmark && !selected.some(a => a.id === benchmark.id)) await loadHistory(benchmark).catch(() => {});
      if (token !== runId) return;
      const computed = P.simulate({ catalog, histories: Object.fromEntries(histories), config: params, fxHistory: histories.get(catalog.fx?.id) });
      if (computed.error) error = computed.error;
      else { result = computed; resultKey = JSON.stringify(params); }
    } catch (e) { if (token === runId) error = e.message; }
    finally { if (token === runId) { running = false; update(); } }
  }
  function menu(id, label, options, value) {
    const current = options.find(([key]) => String(key) === String(value)) || options[0];
    return '<details class="select-menu portfolio-menu"><summary id="portfolio-' + id + '" aria-label="' + H.esc(label + '：' + current[1]) + '"><span>' + H.esc(current[1]) + '</span></summary><div class="select-menu-list" role="group" aria-label="' + H.esc(label) + '">' + options.map(([key, name]) => btn(H.esc(name), 'select', 'select-menu-option' + (String(key) === String(value) ? ' active' : ''), 'data-field="' + id + '" data-value="' + H.esc(key) + '"')).join('') + '</div></details>';
  }
  function number(label, field, value, max, step = 'any', suffix = '') {
    return '<label class="portfolio-field"><span>' + label + '</span><span class="portfolio-number"><input id="portfolio-' + field + '" type="number" min="0" max="' + max + '" step="' + step + '" value="' + value + '" data-portfolio-field="' + field + '" aria-label="' + label + '">' + (suffix ? '<span>' + suffix + '</span>' : '') + '</span></label>';
  }
  function settings() {
    const benchmark = asset(draft.benchmarkId);
    return '<section class="card portfolio-settings"><div class="portfolio-settings-top"><h2>模拟设置</h2><div class="portfolio-return-controls"><span class="muted">回测区间</span>' + menu('years', '回测区间', [[1, '近1年'], [2, '近2年'], [3, '近3年'], [5, '近5年'], [10, '近10年'], ['common', '共同历史'], ['custom', '自定义区间']], draft.years) + H.annualControl + '</div></div>' +
      '<div class="portfolio-settings-grid">' + number('初始投入', 'initial', draft.initial, 1e12, 'any', '元') + number('每月追加', 'monthly', draft.monthly, 1e10, 'any', '元') +
      '<div class="portfolio-field"><span>再平衡</span>' + menu('rebalance', '再平衡周期', [['none', '不再平衡'], ['month', '每月'], ['quarter', '每季度'], ['year', '每年']], draft.rebalance) + '</div>' +
      number('买卖交易费率', 'transactionFee', draft.transactionFee, 5, 'any', '%') + '<div class="portfolio-field portfolio-benchmark"><span>对照标的</span>' + btn(H.esc(benchmark?.code || '不设置') + '<span>更换</span>', 'benchmark', 'portfolio-benchmark-button', 'aria-label="更换对照标的"') + '</div></div>' +
      (draft.years === 'custom' ? '<div class="portfolio-dates"><label>开始日<input type="date" id="portfolio-start" data-portfolio-field="start" value="' + H.esc(draft.start) + '"></label><label>结束日<input type="date" id="portfolio-end" data-portfolio-field="end" value="' + H.esc(draft.end) + '"></label></div>' : '') +
      '<div class="portfolio-settings-foot">' + H.feeControl + '<div class="portfolio-settings-note">人民币 · 分红再投 · 境内ETF净值 · 未计投资者税费 ' + btn('口径', 'method', 'text-link small', 'aria-label="组合回测口径"') + '</div></div></section>';
  }
  function holdingRow(position, index) {
    const row = asset(position.id), info = row && M.annualFeeInfo({ ...row, n: row.name }, config().feeOverrides[row.code]);
    return '<div class="portfolio-holding"><div class="portfolio-holding-name"><i style="background:' + colors[index % colors.length] + '"></i><div><strong>' + H.esc(row?.name || position.id) + '</strong><span>' + H.esc(row?.code || '') + ' · ' + H.esc(typeName[row?.kind] || '') + (row?.currency === 'USD' ? ' · 美元资产' : '') + (['star', 'chinext'].includes(row?.board) ? ' · ' + (row.board === 'star' ? '科创板' : '创业板') : '') + '</span>' +
      (row?.status !== 'available' ? '<span class="fee-missing">' + H.esc(row?.missing || '标的已移出研究对象') + '</span>' : '') + '</div></div><label class="portfolio-weight"><input type="number" min="0" max="100" step="any" value="' + position.weight + '" data-portfolio-weight="' + H.esc(position.id) + '" aria-label="' + H.esc((row?.name || position.id) + '的组合权重') + '"><span>%</span></label>' +
      btn('×', 'remove', 'portfolio-remove', 'data-value="' + H.esc(position.id) + '" aria-label="移除' + H.esc(row?.name || position.id) + '"') +
      (H.feeBasis === 'gross_estimate' && info?.applicable ? '<div class="portfolio-fee-field"><span>' + H.esc(info.rate === null ? info.missing : '估算有效年费') + '</span><label><input type="number" min="0" max="99" step="any" data-portfolio-fee="' + H.esc(row.code) + '" value="' + (draft.feeOverrides[row.code] ?? '') + '" placeholder="' + (info.rate ?? '填写有效费率') + '" aria-label="' + H.esc(row.name + '的估算有效年费') + '"><span>% / 年</span></label></div>' : '') + '</div>';
  }
  function structure(positions) {
    const a = P.allocation(positions, catalog.assets);
    return '<div class="portfolio-structure-main">' + [['etf', 'ETF'], ['stock', '个股'], ['fund', '基金'], ['cash', '现金']].map(([key, label]) => '<span>' + label + '<b>' + H.pct(a[key], 2, false) + '</b></span>').join('') + '</div><div class="portfolio-structure-leverage"><span>其中杠杆ETF</span><span>2x <b>' + H.pct(a.x2, 2, false) + '</b></span><span>3x <b>' + H.pct(a.x3, 2, false) + '</b></span></div>' + (a.invalid ? '<span class="negative small">请修正无效权重或超过100%的合计</span>' : '');
  }
  function allocationMarkup() {
    const total = draft.positions.reduce((s, p) => s + (Number(p.weight) || 0), 0), cash = Math.max(0, 100 - total);
    const bars = draft.positions.filter(p => p.weight > 0).map((p, i) => '<span style="flex:' + p.weight + ';background:' + colors[i % colors.length] + '" title="' + H.esc((asset(p.id)?.name || p.id) + ' ' + p.weight + '%') + '"></span>').join('') + (cash ? '<span style="flex:' + cash + ';background:#e4e7df" title="现金 ' + cash.toFixed(2) + '%"></span>' : '');
    return '<div class="portfolio-allocation-bar" aria-label="组合权重分布">' + (bars || '<span style="flex:100;background:#e4e7df"></span>') + '</div><div class="portfolio-allocation-total' + (total > 100 + 1e-8 ? ' negative' : '') + '"><strong>标的合计 ' + H.pct(total, 2, false) + '</strong></div><div class="portfolio-structure">' + structure(draft.positions) + '</div>';
  }
  function composition() {
    return H.card('我的组合', draft.positions.length + '只标的', '<div class="portfolio-composition"><div id="portfolio-allocation-summary" aria-live="polite">' + allocationMarkup() + '</div>' +
      (draft.positions.length ? draft.positions.map(holdingRow).join('') : '<div class="portfolio-empty-holdings"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 8h13v13H8zM27 8h13v13H27zM8 27h13v13H8zM33.5 27v13M27 33.5h13"/></svg><h3>从标的库开始构建</h3><p>ETF、个股和基金可以放在同一个组合中。</p></div>') + '</div>',
      '<div class="actions">' + btn('均分权重', 'equal', 'text-link small', draft.positions.length ? '' : 'disabled') + (draft.positions.length ? btn('清空', 'clear', 'text-link small') : '') + '</div>');
  }
  function libraryRows() {
    const q = query.trim().toLowerCase();
    return (catalog?.assets || []).filter(a => (kind === 'all' || a.kind === kind) && (market === 'all' || a.market === market) &&
      (!hideBoards || !/^stock:(68[89]|30[01])/.test(a.id)) && (!q || (a.name + ' ' + a.code + ' ' + a.category + ' ' + (a.style || '')).toLowerCase().includes(q)));
  }
  function pickerRow(row) {
    const selected = pickerMode === 'holding' ? draft.positions.some(p => p.id === row.id) : draft.benchmarkId === row.id;
    return '<div class="portfolio-library-row"><div><strong>' + H.esc(row.name) + ((row.leverage || 1) > 1 ? tag(row.leverage + '倍', 'warn') : '') + '</strong><span>' + H.esc(row.code) + ' · ' + H.esc(typeName[row.kind]) + ' · ' + (row.market === 'us' ? '海外' : '境内') + ' · ' + H.esc(row.category || '') + '</span><small>' + H.esc(row.status === 'available' ? row.first + ' — ' + row.asOf : row.missing) + '</small></div>' +
      btn(selected ? '已选' : pickerMode === 'holding' ? '+' : '选用', 'add', 'portfolio-add' + (selected ? ' selected' : ''), 'data-value="' + H.esc(row.id) + '" aria-label="' + H.esc((selected ? '已选择' : pickerMode === 'holding' ? '添加' : '设为对照') + row.name) + '"' + (selected ? ' disabled' : '')) + '</div>';
  }
  function library() {
    const rows = libraryRows();
    return H.card(pickerMode === 'holding' ? '添加标的' : '选择对照标的', '已收录 ' + (catalog?.summary.total || 0) + '只 · 当前匹配 ' + rows.length + '只',
      '<div class="portfolio-library-controls"><input id="portfolio-search" type="search" placeholder="搜索名称、代码或行业" aria-label="搜索组合标的" value="' + H.esc(query) + '"><div class="portfolio-filters">' +
      '<div class="filter-chips">' + [['all', '全部'], ['etf', 'ETF'], ['stock', '个股'], ['fund', '基金']].map(([k, label]) => btn(label, 'kind', 'filter-chip' + (kind === k ? ' active' : ''), 'data-value="' + k + '" aria-pressed="' + (kind === k) + '"')).join('') + '</div>' +
      '<div class="segmented">' + [['all', '全部市场'], ['cn', '境内'], ['us', '海外']].map(([k, label]) => btn(label, 'market', k === market ? 'active' : '', 'data-value="' + k + '"')).join('') + '</div></div>' +
      '<div class="portfolio-library-tools"><label class="check-label"><input type="checkbox" id="portfolio-hide-boards"' + (hideBoards ? ' checked' : '') + '>隐藏科创板 / 创业板个股</label>' + (query || kind !== 'all' || market !== 'all' ? btn('重置筛选', 'reset-filter', 'text-link small') : '') + '</div></div>' +
      '<div class="portfolio-library-scroll"><div data-list-body="portfolio-library">' + H.lazyRows('portfolio-library', rows, pickerRow, 25) + '</div>' + H.loadFooter('portfolio-library') + (!rows.length ? '<div class="portfolio-no-match">没有匹配的已收录标的</div>' : '') + '</div>',
      pickerMode === 'benchmark' ? '<div class="actions">' + btn('不设对照', 'no-benchmark', 'text-link small') + btn('返回添加标的', 'picker-holdings', 'text-link small') + '</div>' : '');
  }
  function chart() {
    const rows = result.curve, W = 920, HH = 330, pad = { x: 63, y: 24, right: 16, bottom: 34 };
    const primary = rows.map(p => metric === 'amount' ? p.value : metric === 'drawdown' ? p.drawdown : H.annual ? p.annualReturn : p.totalReturn);
    const secondary = metric === 'amount' ? rows.map(p => p.contributed) : metric === 'return' && result.benchmark ? result.benchmark.curve.map(p => H.annual ? (p.day === result.start ? 0 : P.annualReturn(p.nav, result.start, p.day)) : (p.nav - 1) * 100) : null;
    const values = [0, ...primary, ...(secondary || [])].filter(M.finite), min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const lo = min - span * .08, hi = max + span * .08;
    const x = i => pad.x + i / Math.max(1, rows.length - 1) * (W - pad.x - pad.right);
    const y = v => pad.y + (hi - v) / (hi - lo) * (HH - pad.y - pad.bottom);
    const path = data => data.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ');
    let grid = '';
    for (let i = 0; i < 5; i++) {
      const v = lo + (hi - lo) * i / 4, yy = y(v);
      grid += '<line x1="' + pad.x + '" y1="' + yy + '" x2="' + (W - pad.right) + '" y2="' + yy + '" stroke="#e8ece3"/><text x="' + (pad.x - 10) + '" y="' + (yy + 4) + '" text-anchor="end">' + (metric === 'amount' ? H.money(v / 10000, 1) + '万' : v.toFixed(1) + '%') + '</text>';
    }
    for (const i of [0, Math.floor((rows.length - 1) / 2), rows.length - 1]) grid += '<text x="' + x(i) + '" y="' + (HH - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle') + '">' + rows[i].day + '</text>';
    const area = path(primary) + 'L' + x(rows.length - 1) + ' ' + y(0) + 'L' + x(0) + ' ' + y(0) + 'Z';
    const label = metric === 'amount' ? '账户资产与累计投入' : metric === 'drawdown' ? '组合回撤' : H.annual ? '年化收益 · 首年按一年计' : '累计收益';
    return H.card('组合走势', label, '<div class="portfolio-chart-body"><div class="portfolio-chart-legend"><span><i style="background:#35654a"></i>我的组合</span>' + (secondary ? '<span><i style="background:#9c8d6e"></i>' + H.esc(metric === 'amount' ? '累计投入' : result.benchmark.name) + '</span>' : '') + '<span id="portfolio-chart-readout" aria-live="polite"></span></div><div class="portfolio-plot-wrap"><div id="portfolio-tooltip" class="portfolio-tooltip" hidden></div><svg class="portfolio-plot" data-portfolio-plot data-min="' + lo + '" data-max="' + hi + '" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="' + label + '"><title>' + label + '</title><defs><linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a4c1a2" stop-opacity=".24"/><stop offset="1" stop-color="#a4c1a2" stop-opacity=".02"/></linearGradient></defs>' + grid + '<path d="' + area + '" fill="url(#portfolio-fill)"/>' + (secondary ? '<path d="' + path(secondary) + '" stroke="#9c8d6e" fill="none" stroke-width="1.8" stroke-dasharray="5 4"/>' : '') + '<path d="' + path(primary) + '" stroke="#35654a" fill="none" stroke-width="2.3"/><line id="portfolio-cursor" x1="0" x2="0" y1="' + pad.y + '" y2="' + (HH - pad.bottom) + '" stroke="#83927c" stroke-dasharray="3 3" visibility="hidden" pointer-events="none"/><circle id="portfolio-point" r="4.5" fill="#35654a" stroke="white" stroke-width="2" visibility="hidden" pointer-events="none"/><rect x="63" y="24" width="841" height="272" fill="transparent" pointer-events="all"/></svg></div></div>',
      '<div class="segmented">' + [['return', '收益率'], ['amount', '账户资产'], ['drawdown', '回撤']].map(([key, name]) => btn(name, 'metric', key === metric ? 'active' : '', 'data-value="' + key + '"')).join('') + '</div>');
  }
  function results() {
    if (!result) return '<section class="portfolio-result-placeholder"><div><span class="eyebrow">YOUR PORTFOLIO, OVER TIME</span><h2>看组合如何走过市场起伏</h2><p>配置权重和投入方式后，开始模拟。</p></div><svg viewBox="0 0 460 135" aria-hidden="true"><path d="M3 120H457M3 80H457M3 40H457" stroke="#e0e5d7"/><path d="m3 101 37-13 37 14 38-28 37 7 38-22 38 12 37-31 37 5 40-26 38 6 40-23" fill="none" stroke="#96aa83" stroke-width="2"/><path d="m3 110 37-4 37 5 38-19 37 10 38-8 38-9 37 6 37-19 40 9 38-16 40 2" fill="none" stroke="#c3b291" stroke-width="1.5" stroke-dasharray="5 5"/></svg></section>';
    const r = result;
    const rows = r.holdings.map((h, i) => '<tr><td><span class="portfolio-result-name"><i style="background:' + colors[i % colors.length] + '"></i><span><strong>' + H.esc(h.name) + '</strong><small>' + H.esc(h.code) + '</small></span></span></td><td class="num">' + H.pct(h.targetWeight, 2, false) + '</td><td class="num">' + H.pct(h.actualWeight, 2, false) + '</td><td class="num">' + H.money(h.value, 2) + '</td><td class="num"><span class="' + (h.profit < 0 ? 'negative' : 'positive') + '">' + H.money(h.profit, 2) + '</span></td><td class="num">' + H.money(h.transactionCost, 2) + '</td></tr>').join('');
    const holdingTable = '<div class="table-wrap"><table class="portfolio-holdings-table"><thead><tr><th>标的</th><th>目标权重</th><th>期末权重</th><th>期末市值 / 元</th><th>盈亏贡献 / 元</th><th>交易费 / 元</th></tr></thead><tbody>' + rows + (r.cash > .005 ? '<tr><td>现金</td><td class="num">' + H.pct(r.cashWeight, 2, false) + '</td><td class="num">' + H.pct(r.cash / r.value * 100, 2, false) + '</td><td class="num">' + H.money(r.cash, 2) + '</td><td class="num">0.00</td><td class="num">0.00</td></tr>' : '') + '</tbody></table></div>';
    return '<div class="portfolio-results"><div class="portfolio-result-head"><div><h2>' + (resultKey === signature() ? '模拟结果' : '上次模拟结果') + '</h2><p>' + r.start + ' — ' + r.end + ' · ' + (r.config.feeBasis === 'net' ? '年费已扣除' : '扣费前估算') + ' · 投资者税前</p></div><div class="actions">' + btn('区间与来源', 'sources', 'text-link small') + btn('导出结果', 'export-result', 'btn sm') + '</div></div>' +
      '<div class="stats-grid">' + H.stat(H.annual ? '组合年化收益' : '组合累计收益', H.pct(H.annual ? r.annualReturn : r.totalReturn, 2, false), '', r.benchmark ? '对照 ' + H.pct(H.annual ? r.benchmark.annualReturn : r.benchmark.totalReturn) : '按现金流中性组合净值计算') +
      H.stat('期末资产', H.money(r.value), '元', '累计投入 ' + H.money(r.contributed) + ' 元') + H.stat('账面盈亏', H.money(r.profit), '元', '持仓与现金合计；未按期末清仓') + H.stat('最大回撤', H.pct(r.mdd, 2, false), '', '年化波动 ' + H.pct(r.volatility, 2, false)) + '</div>' +
      (r.benchmarkError ? '<div class="portfolio-warning">' + H.esc(r.benchmarkError) + '，当前仅显示组合曲线。</div>' : '') +
      chart() + '<div class="portfolio-result-notes"><span>投入 ' + r.deposits + '笔</span><span>再平衡 ' + r.rebalances + '次</span><span>交易费用 ' + H.money(r.tradeCost, 2) + '元</span>' + (r.xirr !== null ? '<span>资金年化 ' + H.pct(r.xirr) + '</span>' : '') + '</div>' +
      H.card('持仓贡献', '', '<div class="portfolio-structure portfolio-end-structure"><h3>期末结构</h3>' + structure(r.holdings.map(h => ({ id: h.id, weight: h.actualWeight }))) + '</div>' + holdingTable) + '<section class="card portfolio-yearly"><div class="card-head"><h2>年度表现</h2><span class="small">现金流中性 · 累计收益</span></div><div class="portfolio-year-grid">' + r.annual.map(y => '<div><span>' + y.year + '</span><strong class="num">' + H.pc(y.return) + '</strong><small>' + y.start.slice(5) + ' — ' + y.end.slice(5) + '</small></div>').join('') + '</div></section></div>';
  }
  function view(context) {
    H = context; ensureCatalog();
    if (!catalog) return '<section class="card pad"><h2>' + (loadError ? '标的库加载失败' : '正在载入组合标的库') + '</h2><p class="muted">' + H.esc(loadError || 'ETF、个股与基金每日历史按需载入。') + '</p>' + (loadError ? btn('重新加载', 'retry', 'btn primary') : '') + '</section>';
    const unknown = draft.positions.filter(p => !asset(p.id));
    return settings() + (unknown.length ? '<div class="portfolio-warning">' + unknown.length + '只保存的标的已不在当前研究对象中，请移除后模拟。</div>' : '') +
      '<div class="portfolio-builder">' + composition() + library() + '</div><div class="portfolio-run-bar"><div><span id="portfolio-dirty">' + (result && resultKey !== signature() ? '参数已改动，重新模拟后生效' : '') + '</span>' + (error || importError ? '<p class="negative" role="alert">' + H.esc(error || importError) + '</p>' : '') + '</div><div class="actions">' + btn('导入配置', 'import', 'btn') + btn('保存配置', 'save', 'btn', draft.positions.length ? '' : 'disabled') + btn(running ? '正在读取历史…' : '开始模拟', 'run', 'btn primary', running || !draft.positions.length ? 'disabled' : '') + '<input type="file" id="portfolio-import" accept="application/json,.json" hidden></div></div>' +
      (draft.positions.some(p => (asset(p.id)?.leverage || 1) > 1 && p.weight > 0) ? '<div class="portfolio-warning">组合含每日杠杆ETF，长期表现取决于价格路径；杠杆并非长期收益的固定倍数。</div>' : '') + results();
  }
  function method() {
    H.openModal(H.modalTitle('组合回测口径', '人民币 · 每日历史 · 投资者税前') + '<div class="rule-list"><p><strong>价格与分红：</strong>境内基金及ETF使用净值与已发布每日收益，默认不计场内溢价；个股和海外ETF使用含分红复权股价。分红视为再投资，支持碎股，不模拟申购暂停、涨跌停或整手限制。</p><p><strong>汇率与交易日：</strong>海外资产按美元兑人民币历史汇率估值。休市日沿用最近已发布价格；新增投入和再平衡推迟到所选资产都有真实报价的共同日期，不使用未来价格。</p><p><strong>投入与权重：</strong>未分配权重持有零息现金。每月追加按目标权重购买；再平衡按所选月份、季度或年份的首个共同交易日进行，先结算买卖费用再求目标持仓。</p><p><strong>费用与税：</strong>实际净值与复权股价已经反映产品持续年费，不再重复扣费，也不加回年费。买卖费率是统一自定义假设，未含最低佣金、换汇价差、申赎阶梯费率和投资者税费。期末为持仓估值，未扣清仓费用。跨境卖出和股息税后的渠道比较见“投资渠道”。</p><p><strong>收益：</strong>组合净值消除外部追加本金影响；账面盈亏为期末资产减累计投入。首年年化按至少一年计算；不满一年不显示资金年化。对照线为同币种、同区间持有回报，不计用户自定义交易费。</p></div><div class="actions"><a class="source-link" href="docs/portfolio-method.md" target="_blank" rel="noopener">完整公式与边界 ↗</a></div>');
  }
  function sources() {
    if (!result) return;
    const r = result;
    H.openModal(H.modalTitle('区间与来源', r.start + ' — ' + r.end) + '<div class="table-wrap"><table><thead><tr><th>标的</th><th>历史区间</th><th>收益来源</th></tr></thead><tbody>' + r.holdings.map(h => {
      const a = asset(h.id);
      return '<tr><td>' + H.esc(h.name) + '</td><td>' + h.first + '<br>' + h.asOf + '</td><td>' + (a?.sourceUrl && /^https:\/\//.test(a.sourceUrl) ? '<a class="source-link" href="' + H.esc(a.sourceUrl) + '" target="_blank" rel="noopener">' + (h.basis === 'provider_adjusted_close' ? '含分红复权股价' : '净值及已发布每日收益') + ' ↗</a>' : '缺来源链接') + (a?.refreshWarning ? '<span class="sub">' + H.esc(a.refreshWarning) + '</span>' : '') + '</td></tr>';
    }).join('') + (r.holdings.some(h => h.currency === 'USD') ? '<tr><td>美元兑人民币</td><td>' + catalog.fx.first + '<br>' + catalog.fx.asOf + '</td><td><a class="source-link" href="https://finance.yahoo.com/quote/CNY%3DX/history/" target="_blank" rel="noopener">CNY=X实际日汇率 ↗</a></td></tr>' : '') + '</tbody></table></div><p class="note">开始日采用指定日前最近共同交易日；结束日采用共同历史内的实际估值日。休市沿用最近价格 ' + r.carriedPrices + '次，沿用汇率 ' + r.carriedFx + '日。价格最多沿用14日，汇率最多7日；超限停止回测。</p>');
  }
  function exportResult() {
    if (!result) return;
    const rows = [['日期', '账户资产CNY', '累计投入CNY', '账面盈亏CNY', '组合净值', '累计收益%', '年化收益%（首年至少一年）', '回撤%', '年费口径', '配置JSON'],
      ...result.curve.map(p => [p.day, p.value, p.contributed, p.profit, p.nav, p.totalReturn, p.annualReturn, p.drawdown, result.config.feeBasis, JSON.stringify(result.config)])];
    H.download('长衡-组合模拟-' + result.end + '.csv', M.csv(rows), 'text/csv;charset=utf-8');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('portfolio-', ''), val = button.dataset.value;
    switch (act) {
      case 'retry': loadError = ''; ensureCatalog(); break;
      case 'run': run(); return;
      case 'add':
        if (pickerMode === 'benchmark') { draft.benchmarkId = val; pickerMode = 'holding'; }
        else if (asset(val) && !draft.positions.some(p => p.id === val)) draft.positions.push({ id: val, weight: draft.positions.length ? 0 : 100 });
        touch(); break;
      case 'remove': draft.positions = draft.positions.filter(p => p.id !== val); touch(); break;
      case 'clear': draft.positions = []; result = null; touch(); break;
      case 'equal': draft.positions.forEach((p, i) => { p.weight = i === draft.positions.length - 1 ? 100 - Math.floor(10000 / draft.positions.length) / 100 * i : Math.floor(10000 / draft.positions.length) / 100; }); touch(); break;
      case 'select': {
        const field = button.dataset.field;
        if (field === 'years') draft.years = /^\d+$/.test(val) ? Number(val) : val;
        else if (field === 'rebalance') draft.rebalance = val;
        touch(); break;
      }
      case 'kind': kind = val; H.resetList(); break;
      case 'market': market = val; H.resetList(); break;
      case 'reset-filter': query = ''; kind = 'all'; market = 'all'; hideBoards = false; H.resetList(); break;
      case 'benchmark': pickerMode = 'benchmark'; query = ''; kind = 'all'; market = 'all'; H.resetList(); break;
      case 'no-benchmark': draft.benchmarkId = ''; pickerMode = 'holding'; touch(); break;
      case 'picker-holdings': pickerMode = 'holding'; break;
      case 'metric': metric = val; break;
      case 'method': method(); return;
      case 'sources': sources(); return;
      case 'export-result': exportResult(); return;
      case 'save':
        try { P.validateConfig(config(), new Set(catalog.assets.map(a => a.id))); }
        catch (e) { H.toast(e.message); return; }
        H.download('长衡-组合配置.json', JSON.stringify({ schemaVersion: 1, ...config() }, null, 2)); return;
      case 'import': document.getElementById('portfolio-import')?.click(); return;
      default: return;
    }
    update();
  }
  function handleInput(el) {
    if (el.id === 'portfolio-search') { query = el.value; H.resetList(); return true; }
    if (el.dataset.portfolioWeight) {
      const p = draft.positions.find(p => p.id === el.dataset.portfolioWeight);
      if (p) p.weight = el.value.trim() ? Number(el.value) : NaN;
      touch();
      const summary = document.getElementById('portfolio-allocation-summary');
      if (summary) summary.innerHTML = allocationMarkup();
      return false;
    }
    if (el.dataset.portfolioField) {
      const key = el.dataset.portfolioField;
      if (['start', 'end'].includes(key)) draft[key] = el.value;
      else draft[key] = el.value.trim() ? Number(el.value) : NaN;
      touch(); return false;
    }
    return false;
  }
  async function handleChange(el) {
    if (el.id === 'portfolio-import') {
      const file = el.files?.[0];
      if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error('配置文件大于1MB');
        const next = P.sanitizeDraft(JSON.parse(await file.text()), new Set(catalog.assets.map(a => a.id)));
        H.setFeeBasis(next.feeBasis); draft = { ...defaults, ...next }; delete draft.feeBasis;
        importError = ''; result = null; touch();
      } catch (e) { importError = '配置导入失败：' + e.message; }
      update(); return;
    }
    if (el.id === 'portfolio-hide-boards') { hideBoards = el.checked; H.resetList(); update(); return; }
    if (el.dataset.portfolioFee) {
      const code = el.dataset.portfolioFee;
      if (!el.value.trim()) delete draft.feeOverrides[code];
      else if (el.checkValidity() && Number.isFinite(Number(el.value))) draft.feeOverrides[code] = Number(el.value);
      else { H.toast('请输入0至99之间的有效年费率'); return; }
      touch(); update(); return;
    }
    if (el.dataset.portfolioWeight || el.dataset.portfolioField) { handleInput(el); update(); }
  }
  function showPoint(event) {
    const plot = event.target.closest?.('[data-portfolio-plot]');
    if (!plot || !result) return;
    const box = plot.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left - box.width * 63 / 920) / (box.width * 841 / 920)));
    const index = Math.round(fraction * (result.curve.length - 1)), point = result.curve[index];
    const value = metric === 'amount' ? point.value : metric === 'drawdown' ? point.drawdown : H.annual ? point.annualReturn : point.totalReturn;
    const format = v => metric === 'amount' ? H.money(v, 2) + '元' : H.pct(v);
    const comparison = metric === 'amount' ? point.contributed : metric === 'return' && result.benchmark
      ? H.annual ? point.day === result.start ? 0 : P.annualReturn(result.benchmark.curve[index].nav, result.start, point.day)
      : (result.benchmark.curve[index].nav - 1) * 100 : null;
    const comparisonName = metric === 'amount' ? '累计投入' : result.benchmark?.name;
    const x = 63 + index / Math.max(1, result.curve.length - 1) * 841;
    const cursor = document.getElementById('portfolio-cursor'), dot = document.getElementById('portfolio-point');
    if (cursor) { cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('visibility', 'visible'); }
    if (dot) {
      const lo = Number(plot.dataset.min), hi = Number(plot.dataset.max);
      dot.setAttribute('cx', x); dot.setAttribute('cy', 24 + (hi - value) / (hi - lo) * 272); dot.setAttribute('visibility', 'visible');
    }
    const readout = document.getElementById('portfolio-chart-readout');
    if (readout) readout.textContent = point.day + ' · 组合 ' + format(value) + (comparison !== null ? ' · 对照 ' + format(comparison) : '');
    const tooltip = document.getElementById('portfolio-tooltip');
    if (tooltip) {
      const entries = [[metric === 'drawdown' ? '组合回撤' : '我的组合', format(value)]];
      if (comparison !== null) entries.push([comparisonName, format(comparison)]);
      if (metric !== 'amount') entries.push(['账户资产', H.money(point.value, 2) + '元'], ['累计投入', H.money(point.contributed, 2) + '元']);
      entries.push(['账面盈亏', H.money(point.profit, 2) + '元']);
      if (metric !== 'drawdown') entries.push(['回撤', H.pct(point.drawdown)]);
      tooltip.innerHTML = '<strong>' + point.day + '</strong>' + entries.map(([name, text]) => '<div><span>' + H.esc(name) + '</span><b>' + H.esc(text) + '</b></div>').join('');
      tooltip.hidden = false;
      const px = event.clientX - box.left, py = event.clientY - box.top;
      tooltip.style.left = Math.max(8, Math.min(box.width - tooltip.offsetWidth - 8, px > box.width / 2 ? px - tooltip.offsetWidth - 16 : px + 16)) + 'px';
      tooltip.style.top = Math.max(8, Math.min(box.height - tooltip.offsetHeight - 8, py + 16)) + 'px';
    }
  }
  function hidePoint(event) {
    const plot = event.target.closest?.('[data-portfolio-plot]');
    if (!plot || plot.contains(event.relatedTarget)) return;
    document.getElementById('portfolio-tooltip')?.setAttribute('hidden', '');
    document.getElementById('portfolio-cursor')?.setAttribute('visibility', 'hidden');
    document.getElementById('portfolio-point')?.setAttribute('visibility', 'hidden');
  }
  window.ChanghengPortfolio = { view, handleAction, handleInput, handleChange, showPoint, hidePoint, method };
})();
