(function () {
  'use strict';
  const M = window.Changheng, P = window.ChanghengPortfolioModel, KEY = 'changheng.portfolio.v1';
  let H, catalog = window.PORTFOLIO_CATALOG || null, loading = false, loadError = '', running = false, runId = 0;
  const histories = new Map(), requests = new Map(), chartInputs = new WeakMap();
  const defaults = { positions: [], currency: 'CNY', initial: 100000, monthly: 0, initialMethod: 'lump_sum', contributionMethod: 'dca_month', rebalance: 'none', transactionFee: 0,
    years: 5, start: '', end: '', benchmarkId: 'us:SPY', dividendPolicy: 'reinvest', feeOverrides: {},
    tax: { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20 } };
  let draft = { ...defaults }, query = '', kind = 'all', market = 'all', hideBoards = false;
  const workspaceTabs = [['settings', '模拟设置'], ['holdings', '我的组合'], ['results', '模拟结果']];
  let workspaceTab = 'settings', calculationOpen = false, benchmarkRequest = null;
  let resultTab = 'chart';
  let result = null, resultKey = '', error = '', metric = 'return', importError = '', exportingPdf = false;
  let dailyDay = '', additionBudget = 10000;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.positions)) draft = { ...defaults, ...saved };
  } catch (_) {}
  if (draft.monthly == null || draft.monthly === '') draft.monthly = 0;
  draft.tax = { ...P.taxConfig(), ...draft.tax, overrides: { ...(draft.tax?.overrides || {}) } };
  const colors = ['#35654a', '#768855', '#aa8253', '#7d839f', '#64a6a1', '#ad6f78', '#8ba9cf', '#aab865'];
  const opportunityMethods = new Set(['opportunity_discount_10', 'opportunity_discount_20', 'opportunity_mixed_10']);
  const systematicMethods = new Set(['vix_panic_reentry', 'relative_strength_rotation', 'dual_risk_guard', ...opportunityMethods]);
  const typeName = { stock: '个股', fund: '基金', etf: 'ETF' };
  const config = () => ({ ...draft, feeBasis: 'net', feeOverrides: {} });
  const signature = () => JSON.stringify(config());
  const currency = (cfg = draft) => P.currencyInfo(cfg);
  const asset = id => catalog?.assets.find(a => a.id === id);
  const inputValue = (value, digits = 8) => M.finite(value) ? String(Number(value.toFixed(digits))) : '';
  const btn = (text, act, cls = 'btn', extra = '') => H.action(text, 'portfolio-' + act, cls, extra);
  const tag = (text, cls = '') => '<span class="badge ' + cls + '">' + H.esc(text) + '</span>';
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch (_) { H.toast('浏览器未能保存组合，请导出配置'); } }
  function dividendControl() {
    return '<div class="portfolio-dividend-control"><strong>分红处理</strong><div class="segmented" role="group" aria-label="分红处理">' +
      P.dividendPolicies.map(([id, label]) => btn(label, 'dividend-policy', id === draft.dividendPolicy ? 'active' : '',
        'data-value="' + id + '" aria-pressed="' + (id === draft.dividendPolicy) + '"')).join('') + '</div></div>';
  }
  function update() { H.render(); }
  function draftNotice() {
    if (!result || resultKey === signature()) return '';
    return workspaceTab === 'results' ? '参数已改动，当前显示上次模拟结果。' : '参数已改动，重新模拟后生效';
  }
  const runError = message => message + (result ? '。仍显示上次成功模拟结果（' + result.end + '）。' : '');
  function touch() {
    error = ''; persist();
    const label = document.getElementById('portfolio-dirty');
    if (label) label.textContent = draftNotice();
    const extend = document.getElementById('portfolio-extend-latest'), reason = document.getElementById('portfolio-extend-reason');
    if (extend && result) extend.disabled = !!extendBlock(result);
    if (reason && result) reason.textContent = extendBlock(result);
    syncPurchasePlan();
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
    const currentRow = () => row.id === catalog.fx?.id ? catalog.fx : asset(row.id);
    const matchesCatalog = () => { const current = currentRow(); return current?.sha256 === row.sha256 && current?.historyUrl === row.historyUrl; };
    if (matchesCatalog() && histories.has(row.id)) return histories.get(row.id);
    const key = [row.id, row.historyUrl, row.sha256].join(':');
    if (requests.has(key)) return requests.get(key);
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
      P.validateHistory(row, history);
      if (matchesCatalog()) histories.set(row.id, history);
      return history;
    })();
    requests.set(key, promise);
    try { return await promise; } finally { requests.delete(key); }
  }
  async function refreshCatalog() {
    // The document can stay open for months. Revalidate the published manifest
    // every run, and only discard cached histories whose content hash changed.
    const response = await fetch('data/portfolio/catalog.js', { cache: 'no-store' });
    if (!response.ok) throw new Error('最新标的库请求失败（' + response.status + '）');
    const source = await response.text(), match = source.match(/^\s*var\s+PORTFOLIO_CATALOG\s*=\s*([\s\S]+);\s*$/);
    if (!match) throw new Error('最新标的库格式无效');
    const next = JSON.parse(match[1]);
    if (next.schemaVersion !== 1 || !Array.isArray(next.assets) || !next.assets.length || !next.fx) throw new Error('最新标的库结构不完整');
    const old = new Map([...catalog.assets, catalog.fx].filter(Boolean).map(a => [a.id, a]));
    const updated = new Map([...next.assets, next.fx].map(a => [a.id, a]));
    for (const id of histories.keys()) {
      if (!updated.has(id) || updated.get(id).sha256 !== old.get(id)?.sha256 || updated.get(id).historyUrl !== old.get(id)?.historyUrl) histories.delete(id);
    }
    catalog = next; window.PORTFOLIO_CATALOG = next;
  }
  async function loadMarketContext() {
    const response = await fetch('data/portfolio/entry-context.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('最新VIX/VIX3M配对数据请求失败（' + response.status + '）');
    let context;
    try { context = JSON.parse(await response.text()); }
    catch (_) { throw new Error('最新VIX/VIX3M配对数据格式无效'); }
    if (context?.schemaVersion !== 1 || context.status !== 'available' || !Array.isArray(context.series) ||
        context.series.length < 2 || context.asOf !== context.series.at(-1)?.[0] || context.series.some((row, i) =>
          !Array.isArray(row) || row.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(row[0]) ||
          i > 0 && row[0] <= context.series[i - 1][0] || !row.slice(1).every(value => M.finite(value) && value > 0))) {
      throw new Error('最新VIX/VIX3M配对数据不完整或日期无效');
    }
    return context;
  }
  function chartReferenceState(account) {
    return chartInputs.get(account) || { status: 'idle', refs: null, error: '' };
  }
  async function loadChartReferences() {
    const account = result, state = chartInputs.get(account);
    if (!state || state.status === 'loading' || state.status === 'ready') return;
    state.status = 'loading'; state.error = ''; update();
    const input = state.input, ids = new Set(input.config.positions.filter(p => p.weight > 0).map(p => p.id));
    const sources = [];
    for (const [holding, proxy] of [['us:USD', 'us:SOXX'], ['us:TQQQ', 'us:QQQ']]) {
      if (ids.has(holding) && !input.histories[proxy]) sources.push([proxy.slice(3), async () => {
        const row = input.catalog.assets.find(a => a.id === proxy);
        if (!row) throw new Error('标的库缺少 ' + proxy.slice(3));
        input.histories[proxy] = await loadHistory(row);
      }]);
    }
    if ((ids.has('us:TQQQ') || ids.has('us:USD')) && !input.marketContext) sources.push(['VIX/VIX3M', async () => { input.marketContext = await loadMarketContext(); }]);
    try {
      const loaded = await Promise.allSettled(sources.map(([, fetchSource]) => fetchSource()));
      const missing = loaded.flatMap((item, i) => item.status === 'rejected' ? [sources[i][0] + '：' + (item.reason?.message || '读取失败')] : []);
      state.refs = P.chartReferences(account, input);
      state.error = missing.join('；');
      state.status = missing.length ? 'error' : 'ready';
    } catch (e) {
      state.error = e.message; state.status = 'error';
    }
    if (account === result) update();
  }
  async function run({ extend = false } = {}) {
    if (running || !catalog) return;
    if (extend && (!result || resultKey !== signature() || result.config.tax?.liquidate)) return;
    for (const position of draft.positions) {
      if (position.weight == null || typeof position.weight === 'string' && !position.weight.trim()) position.weight = 0;
    }
    persist();
    const originalSignature = signature(), previousStart = result?.start;
    const params = JSON.parse(JSON.stringify(config())), token = ++runId;
    let showResults = false;
    try { P.validateConfig(params, new Set(catalog.assets.map(a => a.id))); }
    catch (e) { error = runError(e.message); update(); revealWorkspace(); return; }
    benchmarkRequest = null; running = true; error = ''; update();
    try {
      let refreshMissing = '';
      try { await refreshCatalog(); }
      catch (e) {
        if (extend) throw e;
        refreshMissing = '未能确认最新行情：' + e.message + '。本次模拟使用已保存的历史数据。';
      }
      P.validateConfig(params, new Set(catalog.assets.map(a => a.id)));
      const positiveIds = new Set(params.positions.filter(p => p.weight > 0).map(p => p.id));
      const needsOpportunityVix = opportunityMethods.has(params.initialMethod) && (positiveIds.has('us:TQQQ') || params.initialMethod === 'opportunity_mixed_10');
      const marketContext = ['vix_panic_reentry', 'dual_risk_guard'].includes(params.initialMethod) || needsOpportunityVix ? await loadMarketContext() : null;
      const selected = params.positions.filter(p => p.weight > 0).map(p => asset(p.id));
      await Promise.all(selected.map(loadHistory));
      if (opportunityMethods.has(params.initialMethod)) await Promise.all([['us:TQQQ', 'us:QQQ'], ['us:USD', 'us:SOXX']].filter(([id]) => positiveIds.has(id)).map(([, proxy]) => loadHistory(asset(proxy))));
      else if (['qqq_bear_confirm', 'dual_risk_guard'].includes(params.initialMethod)) await loadHistory(asset('us:QQQ'));
      const benchmark = asset(params.benchmarkId);
      if (selected.some(a => a.currency !== currency(params).code)) await loadHistory(catalog.fx);
      else if (benchmark && benchmark.currency !== currency(params).code) await loadHistory(catalog.fx).catch(() => {});
      // Benchmark coverage is independent: an unavailable comparison cannot make
      // a valid user's combination impossible to simulate.
      if (benchmark && !selected.some(a => a.id === benchmark.id)) await loadHistory(benchmark).catch(() => {});
      if (token !== runId || originalSignature !== signature()) return;
      if (extend) {
        const rows = selected.map(a => histories.get(a.id).series);
        const common = rows.slice(1).map(series => new Set(series.map(row => row[0])));
        const fxEnd = selected.some(a => a.currency !== currency(params).code) ? histories.get(catalog.fx.id).series.at(-1)[0] : '9999-12-31';
        const latest = rows[0].filter(row => row[0] <= fxEnd && common.every(days => days.has(row[0]))).at(-1)?.[0];
        if (!latest || latest < previousStart) throw new Error('最新历史没有覆盖原模拟起点的共同交易日');
        Object.assign(params, { years: 'custom', start: previousStart, end: latest });
      }
      const input = { catalog, histories: Object.fromEntries(histories), config: params, fxHistory: histories.get(catalog.fx?.id), ...(marketContext ? { marketContext } : {}) };
      const computed = P.simulate(input);
      if (computed.error) {
        error = runError('本次模拟未完成：' + computed.error);
      }
      else {
        computed.snapshots = P.simulateWindows(input, computed.end);
        if (params.initialMethod !== 'lump_sum') {
          computed.lumpSumComparison = P.simulate({ ...input, config: { ...params, initialMethod: 'lump_sum', benchmarkId: '' } });
        }
        computed.catalogRefresh = { checkedAt: new Date().toISOString(), available: !refreshMissing, missing: refreshMissing || null };
        if (extend && signature() === originalSignature) { Object.assign(draft, { years: params.years, start: params.start, end: params.end }); persist(); }
        dailyDay = computed.systematic?.daily?.at(-1)?.day || '';
        if (!extend) { additionBudget = params.monthly > 0 ? params.monthly : 10000; resultTab = 'chart'; }
        chartInputs.set(computed, { input, status: 'idle', refs: null, error: '' });
        result = computed; resultKey = JSON.stringify(params);
        showResults = resultKey === signature();
      }
    } catch (e) {
      if (token === runId && originalSignature === signature()) {
        error = runError('本次行情更新失败：' + e.message);
      }
    }
    finally {
      if (token === runId) {
        running = false;
        if (showResults) openWorkspaceTab('results', { fresh: true });
        else { update(); if (error) revealWorkspace(); }
      }
    }
  }
  function menu(id, label, options, value) {
    const current = options.find(([key]) => String(key) === String(value)) || [value, id === 'initialMethod' && /^entry_(option|volatility|breadth|composite)$/.test(value) ? '已撤回，请重新选择' : '请选择'];
    return '<details class="select-menu portfolio-menu"><summary id="portfolio-' + id + '" aria-label="' + H.esc(label + '：' + current[1]) + '"><span>' + H.esc(current[1]) + '</span></summary><div class="select-menu-list" role="group" aria-label="' + H.esc(label) + '">' + options.map(([key, name]) => btn(H.esc(name), 'select', 'select-menu-option' + (String(key) === String(value) ? ' active' : ''), 'data-field="' + id + '" data-value="' + H.esc(key) + '"')).join('') + '</div></details>';
  }
  function number(label, field, value, max, step = 'any', suffix = '') {
    return '<label class="portfolio-field"><span>' + label + '</span><span class="portfolio-number"><input id="portfolio-' + field + '" type="number" min="0" max="' + max + '" step="' + step + '" value="' + inputValue(value) + '" data-portfolio-field="' + field + '" aria-label="' + label + '">' + (suffix ? '<span>' + suffix + '</span>' : '') + '</span></label>';
  }
  let manualTaxChoice = false;
  const selectedTaxMode = () => manualTaxChoice ? 'custom' : taxScenario();
  function taxSummary() {
    if (taxScenario() === 'zero') return '全部标的 0%';
    return '美股卖出 ' + inputValue(draft.tax.usCapitalGains) + '% · 股息总税负 ' + inputValue(draft.tax.usDividend) + '%' + (['cnStockCapitalGains', 'cnStockDividend', 'cnFundCapitalGains', 'cnFundDividend'].some(key => draft.tax[key] !== 0) ? ' · 境内自定义' : '') + (Object.keys(draft.tax.overrides).length ? ' · 含单项税率' : '');
  }
  function taxScenario() {
    if (Object.keys(draft.tax.overrides).length) return 'custom';
    const rates = Object.keys(P.taxConfig()).filter(key => key.endsWith('CapitalGains') || key.endsWith('Dividend'));
    if (rates.every(key => draft.tax[key] === 0)) return 'zero';
    return rates.every(key => draft.tax[key] === (key.startsWith('us') ? 20 : 0)) ? 'mainland' : 'custom';
  }
  function displayTaxRates(a) {
    const group = a.market === 'us' || a.currency === 'USD' ? 'us' : a.kind === 'stock' ? 'cnStock' : 'cnFund';
    return { gain: draft.tax.overrides[a.id]?.gain ?? draft.tax[group + 'CapitalGains'], dividend: draft.tax.overrides[a.id]?.dividend ?? draft.tax[group + 'Dividend'] };
  }
  function hasLongHoldTaxAssumption() {
    return taxScenario() !== 'zero' && draft.positions.some(p => {
      const a = asset(p.id);
      return p.weight > 0 && a?.kind === 'stock' && a.market !== 'us' && a.currency !== 'USD' && displayTaxRates(a).dividend === 0;
    });
  }
  function settlementHint() {
    const taxableHoldings = draft.positions.filter(p => p.weight > 0).map(p => asset(p.id)).filter(Boolean).some(a => displayTaxRates(a).gain > 0);
    if (draft.tax.liquidate) return '末日卖出全部持仓，扣除卖出手续费' + (taxableHoldings ? '和适用的盈利税' : '') + '后结为现金。';
    return taxableHoldings ? '末日不卖出。估值扣除浮盈预留税，持股和现金不变。' : '末日不卖出，保留持仓，不收取清仓手续费。';
  }
  function manualTaxFields() {
    const domestic = [['cnStock', 'A股'], ['cnFund', '境内基金 / ETF']].map(([key, label]) =>
      number(label + '卖出盈利税率', 'tax-' + key + 'CapitalGains', draft.tax[key + 'CapitalGains'], 100, 'any', '%') +
      number(label + '股息税率', 'tax-' + key + 'Dividend', draft.tax[key + 'Dividend'], 100, 'any', '%')).join('');
    const overrides = draft.positions.map(p => asset(p.id)).filter(a => a && (a.market === 'us' || a.currency === 'USD' || a.kind === 'stock' || Object.keys(draft.tax.overrides[a.id] || {}).length)).map(a => {
      const rates = displayTaxRates(a), own = draft.tax.overrides[a.id] || {};
      const input = (field, label) => '<label><span>' + label + '</span><span class="portfolio-number"><input type="number" min="0" max="100" step="any" value="' + inputValue(own[field]) + '" placeholder="' + inputValue(rates[field]) + '" data-portfolio-tax-asset="' + H.esc(a.id) + '" data-tax-field="' + field + '" aria-label="' + H.esc(a.name + '的' + label) + '"><span>%</span></span></label>';
      const domesticStock = a.market !== 'us' && a.currency !== 'USD' && a.kind === 'stock' && own.gain === undefined;
      return '<div class="portfolio-tax-asset' + (domesticStock ? ' portfolio-tax-asset-single' : '') + '"><strong>' + H.esc(a.name) + '</strong>' + (domesticStock ? '' : input('gain', '卖出盈利税率')) + input('dividend', domesticStock ? '短期持股股息税率' : '股息总税负') + '</div>';
    }).join('');
    return '<div class="portfolio-tax-body"><div class="portfolio-tax-grid">' +
      number('美股卖出盈利税率', 'tax-usCapitalGains', draft.tax.usCapitalGains, 100, 'any', '%') + number('美股股息总税负', 'tax-usDividend', draft.tax.usDividend, 100, 'any', '%') +
      '</div><div class="portfolio-tax-details"><details class="portfolio-tax-overrides"><summary>境内标的税率</summary><div class="portfolio-tax-grid">' + domestic + '</div></details>' +
      (overrides ? '<details class="portfolio-tax-overrides"><summary>单只标的税率</summary>' + overrides + '</details>' : '') + '</div></div>';
  }
  function taxSettings() {
    const mode = selectedTaxMode();
    const choices = (label, options, selected, action) => '<div class="segmented portfolio-setting-choices" role="group" aria-label="' + label + '">' +
      options.map(([key, title]) => btn(title, action + key, selected === key ? 'active' : '', 'aria-pressed="' + (selected === key) + '"')).join('') + '</div>';
    const tax = choices('税务情景', [['mainland', '大陆居民假设'], ['zero', '不计税'], ['custom', '手动设置']], mode, 'tax-');
    const settlement = choices('期末处理', [['hold', '保留持仓'], ['sell', '全部卖出']], draft.tax.liquidate ? 'sell' : 'hold', 'settle-');
    return '<section class="portfolio-settings-section portfolio-tax-settings" aria-labelledby="portfolio-tax-title"><h2 id="portfolio-tax-title">税费与期末处理</h2><div class="portfolio-tax-controls">' +
      '<div class="portfolio-tax-group"><h3>模拟税率</h3><div class="portfolio-tax-options"><div class="portfolio-field portfolio-tax-mode">' + tax +
      (mode === 'zero' ? '' : '<small id="portfolio-tax-summary">' + H.esc(taxSummary()) + '</small>') +
      (mode !== 'zero' ? '<p id="portfolio-tax-assumption" class="portfolio-tax-assumption"' + (hasLongHoldTaxAssumption() ? '' : ' hidden') + '>A股股息按长期持有0%估算，未自动计入短期卖出补税。</p>' : '') +
      btn('税费口径', 'tax-method', 'text-link portfolio-tax-method', 'aria-haspopup="dialog"') + '</div>' +
      (mode === 'custom' ? manualTaxFields() : '') + '</div></div><div class="portfolio-fee-settlement">' +
      number('买卖交易费率', 'transactionFee', draft.transactionFee, 5, 'any', '%') +
      '<div class="portfolio-field portfolio-settlement"><span>期末处理</span>' + settlement + '<small id="portfolio-settlement-note">' + H.esc(settlementHint()) + '</small></div></div></div></section>';
  }
  function opportunityTerms(method) {
    return method === 'opportunity_discount_20' ? {reserve: .2, threshold: 50} : {reserve: .1, threshold: 35};
  }
  function purchasePlanMarkup() {
    const method = draft.initialMethod, unit = currency().unit, fee = draft.transactionFee / 100;
    const money = value => H.money(value, 2) + ' ' + unit;
    const opportunity = opportunityMethods.has(method), {reserve, threshold} = opportunityTerms(method);
    const instructions = {
      lump_sum: { first: '首个共同交易日收盘，按配置比例一次性买入。此后涨跌不会触发这笔本金重复买入。', next: [], execution: [] },
      vix_panic_reentry: { first: '首个共同交易日收盘，按原比例一次性建仓；此后才执行VIX退出与回买。', next: ['VIX ÷ VIX3M > 1.10 连续10次，卖出全部TQQQ。', '离场至少5次观测且VIX从离场后峰值回落30%，或比值 < 1 连续5次，才买回。'], execution: ['回买金额 = TQQQ已到账专属现金 ÷（1 + 买入费率）；不动用USD ETF或原配置现金。', 'VIX取严格早于决策日的收盘；订单在决策后的下一共同收盘成交。持有状态不变时，不重复买入。', '恢复后，比值 < 1 连续5次才重新启用退出计数。'] },
      relative_strength_rotation: { first: '首个共同交易日收盘，按原比例一次性建仓；三个批次也从原比例开始。', next: ['比较USD ETF与TQQQ的504日增长倍数：比值 > 1.25，本批转向USD；< 0.80，转向TQQQ；中间保留原方向。', '起始收盘复核当月批次，此后每月首个共同日更新一批；三批各占两只ETF股票资金的1/3。'], execution: ['只有三批合成目标变化才调仓；金额取决于两只ETF的持仓及专属现金，原配置现金不参与。', '下一共同收盘先卖出；回款到账后确定后续买单，再下一共同收盘买入。已有专属现金可先买。', '目标不变时不重复买入；不足505个共同收盘时保持原比例。'] },
      dual_risk_guard: { first: '首个共同交易日收盘，按原比例一次性建仓；此后由VIX与QQQ两道门管理TQQQ。', next: ['VIX门：比值 > 1.10 连续10次退出；等待至少5次且VIX回落30%，或比值 < 1 连续5次恢复。', 'QQQ门：低于200日均线且距252日高点跌至少20%，连续20次退出；高于均线连续3次恢复。'], execution: ['任一门退出就卖出全部TQQQ；两门都恢复，才用TQQQ专属现金 ÷（1 + 买入费率）买回。', 'VIX取决策日前收盘，QQQ可用决策日收盘；下一共同收盘成交。状态不变不重复买入，USD和原现金不参与。'] },
      cash_topup: { first: '首个共同交易日收盘，按原配置买入，余款保留为现金。', next: ['每日收盘比较股票市值与配置目标。低于目标且账户有现金时，只买入不足的标的。', '每笔金额按各标的缺口分配，并受现有现金及交易费约束；不额外入金，也不卖股票。'], execution: ['前一共同收盘锁定买入金额，下一共同收盘成交。', '连续下跌可能多次补仓，直到达到目标或可用现金不足。'] },
      qqq_bear_confirm: { first: '首次按QQQ已知状态执行：允许持有时按下列金额买入；退出时TQQQ预算留作专属现金，其他标的照常。', next: ['QQQ低于200日均线且距252日高点跌至少20%，连续20次后退出全部TQQQ。', 'QQQ连续3次高于200日均线后，用TQQQ专属现金 ÷（1 + 买入费率）买回。'], execution: ['使用前一共同收盘已知信号，在下一共同收盘执行。', '状态保持不变时不重复买入；USD及其他标的继续持有。'], conditional: true },
      drawdown_ladder: { first: '首个共同交易日先释放本金的25%，按配置比例买入。其余75%留作待投入本金。', next: ['相对本次模拟起点后的组合参考高点，回撤首次达到10%、20%、30%时，各释放本金的25%。', '每档只触发一次；同一天跨越多档可同时投入。第37个月释放仍未投入的余款。'], execution: ['用前一共同收盘的回撤确定本日投入；分配比例保持原配置。', '已经投入的部分继续持有，回撤相同不会重复消耗同一档本金。'] },
      ma200_hold: { first: '首日若前一共同收盘高于200日均线，按下列金额买入；否则本金全留现金。', next: ['组合参考曲线高于200日均线时持有；不高于均线时卖出已释放组合并持有现金。', '重新高于均线时，用账户资金按原配置买回；历史不足200次时按常规投入。'], execution: ['读取前一共同收盘状态，本共同收盘执行。', '只在状态切换时整体买卖；连续处于持有状态不会每天重买。'], conditional: true }
    };
    let info = instructions[method], fraction = method === 'drawdown_ladder' ? .25 : 1;
    if (opportunity) info = {
      first: '首个共同收盘，先买USD ETF与TQQQ各自股票预算的' + (100 - reserve * 100) + '%，各留' + reserve * 100 + '%作待加仓现金；其他标的照常，原配置现金不参与。',
      next: ['TQQQ用QQQ、USD ETF用SOXX计算0至100分。达到' + threshold + '分才买；分数越高，动用该标的待加现金的比例越大。', '买入金额 = 该标的待加现金 × 限制在0至1的[(分数 − ' + threshold + ' + 10) ÷ ' + (110 - threshold) + '] ÷（1 + 买入费率）。低分不卖。'],
      execution: ['收盘固定金额，下一共同收盘成交。连续高分可继续买，但只消耗已有现金；现金用完即停，不会自动追加本金。', 'VIX / VIX3M > 1.10连续10次退出TQQQ。离场至少5次且VIX从离场后峰值回落30%，或比值 < 1连续5次，才恢复按分数买回。', '尾款低于初始本金0.01%时，在达标日一并买入。']
    };
    if (/^tranche_(6|12|24)$/.test(method)) {
      const count = Number(method.slice(8)); fraction = 1 / count;
      info = { first: '本金分成' + count + '份，首个共同交易日投入第1份。', next: ['之后每月首个共同交易日投入1份，每份预算 ' + (M.finite(draft.initial) ? money(draft.initial / count) : '待填写本金') + '，均按原配置比例分配。', '未到期的本金保留为现金，不参加再平衡。'], execution: [] };
    }
    if (!info) return '<p class="portfolio-purchase-pending">' + (/^entry_(option|volatility|breadth|composite)$/.test(method) ? '原研究投入方式已撤回：未证明优于一次性投入，请重新选择本金投入方式。' : '请选择有效的本金投入方式。') + '</p>';
    if (draft.initial === 0 && (method === 'lump_sum' || method === 'ma200_hold' || method === 'drawdown_ladder' || method.startsWith('tranche_'))) return '<p>初始本金为 0，仅执行持续投入。</p>';
    const raw = draft.positions || [], validWeights = raw.length && raw.every(p => M.finite(p.weight) && p.weight >= 0 && p.weight <= 100);
    const positions = validWeights ? raw.filter(p => p.weight > 0).map(p => ({ id: p.id, code: asset(p.id)?.code || p.id, name: asset(p.id)?.name || p.id, weight: p.weight / 100 })) : [];
    const weight = positions.reduce((sum, p) => sum + p.weight, 0);
    const hasRequired = opportunity ? positions.some(p => ['us:USD', 'us:TQQQ'].includes(p.id)) : (!(systematicMethods.has(method) || method === 'qqq_bear_confirm') || positions.some(p => p.id === 'us:TQQQ')) && (method !== 'relative_strength_rotation' || positions.some(p => p.id === 'us:USD'));
    const valid = hasRequired && positions.length && weight <= 1 + 1e-10 && M.finite(draft.initial) && draft.initial >= 0 && draft.initial <= 1e12 && M.finite(fee) && fee >= 0 && fee <= .05;
    const pairWeights = ['us:USD', 'us:TQQQ'].map(id => positions.find(p => p.id === id)?.weight || 0);
    let quote = valid ? P.additionAllocation({ status: 'ready', positions, fee, currency: currency().code,
      executedTargets: pairWeights.map(w => w * (opportunity ? 1 - reserve : 1)), executedParked: pairWeights.map(w => opportunity ? w * reserve : 0) }, draft.initial * fraction) : null;
    if (valid && opportunity) {
      const pairWeight = pairWeights.reduce((total, value) => total + value, 0);
      const usable = draft.initial / (1 + fee * (weight - pairWeight * reserve));
      const orders = positions.map(p => ({ ...p, amount: usable * p.weight * (['us:USD', 'us:TQQQ'].includes(p.id) ? 1 - reserve : 1) }));
      const parked = ['us:USD', 'us:TQQQ'].map((id, i) => ({ id, amount: usable * pairWeights[i] * reserve })).filter(p => p.amount > 0);
      quote = { orders, parked, originalCash: usable * Math.max(0, 1 - weight), fee: orders.reduce((total, order) => total + order.amount * fee, 0), total: draft.initial };
    }
    const initialText = draft.initial === 0 ? '初始本金为 0，不执行首次建仓。' : info.first;
    let allocations = '';
    if (quote && draft.initial > 0) {
      const amounts = [
        ...quote.orders.map(order => [order.code === 'USD' ? '买USD ETF' : '买' + order.code, order.amount]),
        ...(opportunity ? quote.parked.map(p => [p.id.replace('us:', '') + '待加现金', p.amount]) : []),
        [opportunity ? '原配置现金' : '本笔保留现金', quote.originalCash], ['本笔买入费', quote.fee], ['首笔合计', quote.total]
      ];
      allocations = '<dl class="portfolio-purchase-amounts" aria-label="首笔金额">' + amounts.map(([label, amount]) => '<div><dt>' + H.esc(label) + '</dt><dd>' + money(amount) + '</dd></div>').join('') + '</dl>';
      if (info.conditional) allocations += '<p class="portfolio-purchase-caption">以上金额以首日满足持有条件为前提。</p>';
    } else if (draft.initial !== 0 && hasRequired) {
      const missing = !M.finite(draft.initial) || draft.initial < 0 || draft.initial > 1e12 ? '请填写有效的初始本金。' :
        !raw.length ? '添加持仓后可查看各标的首笔金额。' : !validWeights || !positions.length || weight > 1 + 1e-10 ? '请检查组合权重。' : '请检查买卖交易费率。';
      allocations = '<p class="portfolio-purchase-pending">' + missing + '</p>';
    }
    const required = opportunity ? hasRequired ? '' : '此方法需要USD ETF或TQQQ有正权重。' : systematicMethods.has(method) || method === 'qqq_bear_confirm' ? !positions.some(p => p.id === 'us:TQQQ') ? '此方法需要TQQQ有正权重。' : method === 'relative_strength_rotation' && !positions.some(p => p.id === 'us:USD') ? '三批轮动还需要USD ETF有正权重。' : '' : '';
    const rules = info.next.concat(info.execution);
    return (required ? '<p class="portfolio-purchase-pending">' + required + '</p>' : '') + '<p>' + H.esc(initialText) + '</p>' + allocations +
      (rules.length ? '<div class="portfolio-plan-rules"><h4>后续执行规则</h4><ul class="portfolio-execution-rules">' + rules.map(line => '<li>' + H.esc(line) + '</li>').join('') + '</ul></div>' : '');
  }
  function contributionPlan() {
    const method = draft.initialMethod, money = value => H.money(value, 2) + ' ' + currency().unit;
    const monthly = draft.monthly;
    let income = '预算为 0，不追加资金。';
    if (!M.finite(monthly) || monthly < 0 || monthly > 1e10) return '填写有效的每月追加预算后显示投入金额。';
    if (monthly > 0) income = ({
      dca_month: '每月首个共同交易日追加 ' + money(monthly) + '。',
      dca_quarter: '每季首个可投入的共同交易日追加本季预算，完整季度为 ' + money(monthly * 3) + '；首尾不足整季按窗口内月份计。',
      dca_year: '每年首个可投入的共同交易日追加本年预算，完整年度为 ' + money(monthly * 12) + '；首尾不足整年按窗口内月份计。',
      dca_drawdown: '每月按前收盘参考回撤追加：低于10%为 ' + money(monthly) + '；达到10% / 20% / 30%分别为 ' + [1.5, 2, 3].map(m => money(monthly * m)).join(' / ') + '。',
      dca_ma_trend: '每月追加 ' + money(monthly) + '；前收盘不高于200日均线时减为 ' + money(monthly * .5) + '。',
      dca_ma_contrarian: '每月追加 ' + money(monthly) + '；前收盘不高于200日均线时增为 ' + money(monthly * 2) + '。'
    }[draft.contributionMethod] || '按所选持续投入方式执行。') + (draft.initial > 0 ? ' 从建仓后的下一月开始。' : ' 从首个模拟月份开始。');
    if (monthly > 0 && opportunityMethods.has(method)) income += ' USD ETF与TQQQ的新增股票预算全部进入各自待加现金池，按每日分数买入；其他标的和原现金比例照常。';
    else if (monthly > 0 && systematicMethods.has(method)) income += ' 到账后按已执行的策略配置分配；不会因“持有状态”每天自动追加。';
    return income;
  }
  function syncPurchasePlan() {
    const initial = document.getElementById('portfolio-purchase-plan'), monthly = document.getElementById('portfolio-contribution-plan');
    if (initial && H && catalog) initial.innerHTML = purchasePlanMarkup();
    if (monthly && H) monthly.textContent = contributionPlan();
  }
  function settings() {
    const field = (label, control) => '<div class="portfolio-field"><span>' + label + '</span>' + control + '</div>';
    return '<div class="portfolio-settings"><section class="card portfolio-settings-section portfolio-strategy-settings" aria-labelledby="portfolio-strategy-settings-title"><h2 id="portfolio-strategy-settings-title">交易策略</h2>' +
      '<div class="portfolio-decision" role="group" aria-label="本金投入"><div class="portfolio-decision-controls">' +
      field('本金投入方式', menu('initialMethod', '本金投入方式', P.initialMethods, draft.initialMethod)) +
      number('初始本金', 'initial', draft.initial, 1e12, '0.01', currency().unit) +
      '</div><section class="portfolio-plan-panel" aria-labelledby="portfolio-opening-title"><h3 id="portfolio-opening-title">本金策略说明</h3><div id="portfolio-purchase-plan" class="portfolio-purchase-plan">' + purchasePlanMarkup() + '</div></section></div>' +
      '<div class="portfolio-decision" role="group" aria-label="持续投入" aria-describedby="portfolio-contribution-plan"><div class="portfolio-decision-controls">' +
      field('持续投入方式', menu('contributionMethod', '持续投入方式', P.contributionMethods, draft.contributionMethod)) +
      number('每月追加预算', 'monthly', draft.monthly, 1e10, 'any', currency().unit) +
      '</div><section class="portfolio-plan-panel" aria-labelledby="portfolio-recurring-title"><h3 id="portfolio-recurring-title">追加安排</h3><p id="portfolio-contribution-plan">' + H.esc(contributionPlan()) + '</p></section></div>' +
      '<div class="portfolio-decision"><div class="portfolio-decision-controls">' + field('再平衡周期', menu('rebalance', '再平衡周期', [['none', '不再平衡'], ['month', '每月'], ['quarter', '每季度'], ['year', '每年']], draft.rebalance)) + '</div></div></section>' +
      '<div class="card portfolio-model-settings"><section class="portfolio-settings-section" aria-labelledby="portfolio-conditions-title"><h2 id="portfolio-conditions-title">回测条件</h2><div class="portfolio-backtest-row">' +
      field('回测区间', menu('years', '回测区间', [[1, '近1年'], [2, '近2年'], [3, '近3年'], [5, '近5年'], [10, '近10年'], [15, '近15年'], [20, '近20年'], ['common', '共同历史'], ['custom', '自定义区间']], draft.years)) +
      field('计价币种', menu('currency', '投入与计价币种', [['CNY', '人民币 CNY'], ['USD', '美元 USD']], draft.currency)) + '</div>' +
      (draft.years === 'custom' ? '<div class="portfolio-dates"><label>开始日<input type="date" id="portfolio-start" data-portfolio-field="start" value="' + H.esc(draft.start) + '"></label><label>结束日<input type="date" id="portfolio-end" data-portfolio-field="end" value="' + H.esc(draft.end) + '"></label></div>' : '') +
      '</section>' + taxSettings() + '</div></div>';
  }
  function holdingRow(position, index) {
    const row = asset(position.id);
    return '<div class="portfolio-holding"><div class="portfolio-holding-name"><i style="background:' + colors[index % colors.length] + '"></i><div><strong>' + H.esc(row?.name || position.id) + '</strong><span>' + H.esc(row?.code || '') + ' · ' + H.esc(typeName[row?.kind] || '') + (row?.currency === 'USD' ? ' · 美元资产' : '') + (['star', 'chinext'].includes(row?.board) ? ' · ' + (row.board === 'star' ? '科创板' : '创业板') : '') + '</span>' +
      (row?.status !== 'available' ? '<span class="fee-missing">' + H.esc(row?.missing || '标的已移出研究对象') + '</span>' : '') + '</div></div>' +
      '<div class="portfolio-holding-inputs"><label class="portfolio-field"><span>分配本金</span><span class="portfolio-number"><input type="number" min="0" max="1000000000000" step="0.01" value="' + inputValue(P.amountFromWeight(draft.initial, position.weight), 2) + '" data-portfolio-amount="' + H.esc(position.id) + '" aria-label="' + H.esc((row?.name || position.id) + '的分配本金') + '"' + (draft.initial > 0 ? '' : ' disabled') + '><span>' + currency().unit + '</span></span></label>' +
      '<label class="portfolio-field"><span>占比</span><span class="portfolio-number portfolio-weight"><input type="number" min="0" max="100" step="any" value="' + inputValue(position.weight) + '" data-portfolio-weight="' + H.esc(position.id) + '" aria-label="' + H.esc((row?.name || position.id) + '的组合权重') + '"><span>%</span></span></label></div>' +
      btn('×', 'remove', 'portfolio-remove', 'data-value="' + H.esc(position.id) + '" aria-label="移除' + H.esc(row?.name || position.id) + '"') +
      '</div>';
  }
  function structure(positions) {
    const a = P.allocation(positions, catalog.assets);
    return '<div class="portfolio-structure-main">' + [['etf', 'ETF'], ['stock', '个股'], ['fund', '基金'], ['cash', '现金'], ['x2', '其中2x ETF'], ['x3', '其中3x ETF']].map(([key, label]) => '<span' + (key.startsWith('x') ? ' title="每日' + key.slice(1) + '倍ETF占整个组合的比例，已包含在ETF占比内"' : '') + '>' + label + '<b>' + H.pct(a[key], 2, false) + '</b></span>').join('') + '</div>' + (a.invalid ? '<span class="negative small">请修正无效权重或超过100%的合计</span>' : '');
  }
  function allocationMarkup() {
    const total = draft.positions.reduce((s, p) => s + (Number(p.weight) || 0), 0), cash = Math.max(0, 100 - total);
    const bars = draft.positions.filter(p => p.weight > 0).map((p, i) => '<span style="flex:' + p.weight + ';background:' + colors[i % colors.length] + '" title="' + H.esc((asset(p.id)?.name || p.id) + ' ' + p.weight + '%') + '"></span>').join('') + (cash ? '<span style="flex:' + cash + ';background:#e4e7df" title="现金 ' + cash.toFixed(2) + '%"></span>' : '');
    const balance = P.amountFromWeight(draft.initial, Math.abs(100 - total));
    const budget = !M.finite(draft.initial) || draft.initial < 0 || draft.initial > 1e12 ? '请输入有效总金额' : draft.initial === 0 ? '仅定投 · 按占比投入' : (total > 100 + 1e-8 ? '超出总额 ' : '现金 ') + H.money(balance, 2) + ' ' + currency().unit;
    return '<div class="portfolio-allocation-bar" aria-label="组合权重分布">' + (bars || '<span style="flex:100;background:#e4e7df"></span>') + '</div><div class="portfolio-allocation-total' + (total > 100 + 1e-8 ? ' negative' : '') + '"><strong>标的合计 ' + H.pct(total, 2, false) + '</strong><span>' + budget + '</span></div><div class="portfolio-structure">' + structure(draft.positions) + '</div>';
  }
  function composition() {
    const hasFund = draft.positions.some(p => p.weight > 0 && ['fund', 'etf'].includes(asset(p.id)?.kind));
    return H.card('我的组合', draft.positions.length + '只标的', '<div class="portfolio-composition"><div id="portfolio-allocation-summary" aria-live="polite">' + allocationMarkup() + '</div>' + dividendControl() +
      (draft.positions.length ? draft.positions.map(holdingRow).join('') : '<div class="portfolio-empty-holdings"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 8h13v13H8zM27 8h13v13H27zM8 27h13v13H8zM33.5 27v13M27 33.5h13"/></svg><h3>从标的库开始构建</h3><p>ETF、个股和基金可以放在同一个组合中。</p></div>') + (hasFund ? '<p class="portfolio-product-fees">基金与 ETF 的历史收益已扣产品年费。</p>' : '') + '</div>',
      '<div class="actions">' + btn('均分权重', 'equal', 'text-link small', draft.positions.length ? '' : 'disabled') + (draft.positions.length ? btn('清空', 'clear', 'text-link small') : '') + '</div>',
      '<div class="actions portfolio-config-actions">' + btn('导入配置', 'import', 'btn portfolio-export') + btn('导出配置', 'save', 'btn portfolio-export', draft.positions.length ? '' : 'disabled') + '<input type="file" id="portfolio-import" accept="application/json,.json" hidden></div>');
  }
  function filterAssets(assets, filters) {
    const q = filters.query.trim().toLowerCase();
    return assets.filter(a => (filters.kind === 'all' || a.kind === filters.kind) && (filters.market === 'all' || a.market === filters.market) &&
      (!filters.hideBoards || !/^stock:(68[89]|30[01])/.test(a.id)) &&
      (!q || [a.name, a.code, a.category, a.style, a.id].filter(Boolean).join(' ').toLowerCase().includes(q)));
  }
  function pickerMetrics(row, showRiskYears = false) {
    const preview = row.performance;
    const metric = (label, value, reason, note, range) => '<div title="' + H.esc(reason || range || '') + '"><span>' + label + '</span><b class="' + (M.finite(value) ? value < 0 ? 'negative' : 'positive' : 'muted') + '">' + (M.finite(value) ? H.pct(value, 1) : reason?.startsWith('历史不足') ? H.esc(reason.replace('历史', '')) : '—') + '</b>' + (note ? '<small>' + H.esc(note) + '</small>' : '') + '</div>';
    return '<div class="portfolio-library-metrics" role="group" aria-label="' + H.esc(row.name + '的历史收益与回撤') + '">' + [1, 3, 5].map(y => {
      const r = preview?.annual?.[y];
      return metric(y + '年年化', r?.value, r?.reason || (!r ? row.missing || '缺收益历史' : ''), '', r?.start && r.start + ' — ' + r.end);
    }).join('') + metric('5年内最大回撤', preview?.risk5?.mdd, preview?.risk5?.reason || (!preview ? row.missing || '缺回撤历史' : ''), M.finite(preview?.risk5?.actualYears) && (showRiskYears || preview.risk5.partial) ? '实际' + H.money(preview.risk5.actualYears, 1) + '年' : '', preview?.risk5?.start && preview.risk5.start + ' — ' + preview.risk5.end) + '</div>';
  }
  function pickerRow(row) {
    const selected = draft.positions.some(p => p.id === row.id);
    const stock = row.kind === 'stock' ? (window.STOCKS || []).find(s => s.c === row.code) : null;
    const status = stock ? M.stockResearchStatus(stock) : null;
    const performance = pickerMetrics(row);
    return '<div class="portfolio-library-row"><div class="portfolio-library-main"><strong>' + H.esc(row.name) + ((row.leverage || 1) > 1 ? tag(row.leverage + '倍', 'warn') : '') + '</strong><span>' + H.esc(row.code) + ' · ' + H.esc(typeName[row.kind]) + ' · ' + (row.market === 'us' ? '海外 · 美元' : '境内 · 人民币') + ' · ' + H.esc(row.category || '') + '</span><small>' + H.esc(row.status === 'available' ? row.first + ' — ' + row.asOf : row.missing) + '</small>' +
      (status ? '<div class="portfolio-stock-status"><span>' + H.esc(status.label) + '</span>' + H.action('研究详情', 'stock-detail', 'text-link small', 'data-code="' + H.esc(stock.c) + '" aria-label="' + H.esc(stock.n + '研究详情') + '"') + '</div>' : '') + '</div>' + performance +
      btn(selected ? '已选' : '+', 'add', 'portfolio-add' + (selected ? ' selected' : ''), 'data-value="' + H.esc(row.id) + '" aria-label="' + H.esc((selected ? '已选择' : '添加') + row.name) + '"' + (selected ? ' disabled' : '')) + '</div>';
  }
  function library() {
    const rows = filterAssets(catalog?.assets || [], { query, kind, market, hideBoards });
    return H.card('添加标的', '已收录 ' + (catalog?.summary.total || 0) + '只 · 当前匹配 ' + rows.length + '只',
      '<div class="portfolio-library-controls"><input id="portfolio-search" type="search" placeholder="搜索名称、代码或行业" aria-label="搜索组合标的" value="' + H.esc(query) + '"><div class="portfolio-filters">' +
      '<div class="filter-chips">' + [['all', '全部'], ['etf', 'ETF'], ['stock', '个股'], ['fund', '基金']].map(([k, label]) => btn(label, 'kind', 'filter-chip' + (kind === k ? ' active' : ''), 'data-value="' + k + '" aria-pressed="' + (kind === k) + '"')).join('') + '</div>' +
      '<div class="segmented">' + [['all', '全部市场'], ['cn', '境内'], ['us', '海外']].map(([k, label]) => btn(label, 'market', k === market ? 'active' : '', 'data-value="' + k + '"')).join('') + '</div></div>' +
      '<div class="portfolio-library-tools"><label class="check-label"><input type="checkbox" id="portfolio-hide-boards"' + (hideBoards ? ' checked' : '') + '>隐藏科创板 / 创业板个股</label>' + (query || kind !== 'all' || market !== 'all' ? btn('重置筛选', 'reset-filter', 'text-link small') : '') + '</div></div>' +
      '<div class="portfolio-library-scroll"><div data-list-body="portfolio-library">' + H.lazyRows('portfolio-library', rows, pickerRow, 29) + '</div>' + H.loadFooter('portfolio-library') + (!rows.length ? '<div class="portfolio-no-match">没有匹配的已收录标的</div>' : '') + '</div>');
  }
  const benchmarkFilters = { query: '', market: 'all', kind: 'all' };
  function benchmarkOptions() {
    const saved = chartInputs.get(result).input.catalog.assets;
    const q = benchmarkFilters.query.trim().toLowerCase();
    const preferred = new Set([result.config.benchmarkId, ...result.config.positions.filter(p => p.weight > 0).map(p => p.id), 'us:SPY', 'us:QQQ'].filter(Boolean));
    const rows = filterAssets(saved, benchmarkFilters);
    rows.sort((a,b) => Number(b.code.toLowerCase() === q) - Number(a.code.toLowerCase() === q) || Number(preferred.has(b.id)) - Number(preferred.has(a.id)));
    if (!rows.length) return '<p class="muted">没有匹配的对照标的</p>';
    const row = a => {
      const current = a.id === result.config.benchmarkId, active = current && result.benchmark;
      const choice = active ? '当前对照' : current ? '重试对照' : '选作对照';
      return '<div class="portfolio-library-row"><div class="portfolio-library-main"><strong>' + H.esc(a.name) + '</strong><span>' +
        H.esc(a.code) + ' · ' + H.esc(typeName[a.kind] || a.kind) + '</span><small>' + H.esc(a.status === 'available' ? a.first + ' — ' + a.asOf : a.missing || '缺历史行情') +
        '</small></div>' + pickerMetrics(a, true) + btn(choice, 'select-benchmark', 'text-link small',
        'data-value="' + H.esc(a.id) + '" aria-label="' + H.esc(a.name + '：' + choice) + '"' + (active ? ' disabled' : '')) + '</div>';
    };
    return '<div data-list-body="portfolio-benchmarks">' + H.lazyRows('portfolio-benchmarks', rows, row, 24) + '</div>' + H.loadFooter('portfolio-benchmarks');
  }
  function benchmarkFilter(field, label, options) {
    return '<label>' + label + '<select data-portfolio-field="benchmark-' + field + '">' +
      options.map(([id,name]) => '<option value="' + id + '">' + name + '</option>').join('') + '</select></label>';
  }
  let benchmarkTriggerId = 'portfolio-benchmark';
  function openBenchmark(button) {
    if (!result || running || exportingPdf) return;
    benchmarkTriggerId = button.id || 'portfolio-benchmark';
    Object.assign(benchmarkFilters, { query: '', market: 'all', kind: 'all' });
    H.resetList('portfolio-benchmarks');
    H.openModal(H.modalTitle('选择对照标的') + '<div class="portfolio-benchmark-search"><div class="portfolio-benchmark-filters"><input type="search" id="portfolio-benchmark-query" data-portfolio-field="benchmark-query" aria-label="搜索对照标的" placeholder="搜索代码或名称">' +
      benchmarkFilter('market', '市场', [['all', '全部市场'], ['cn', '境内'], ['us', '海外']]) + benchmarkFilter('kind', '类别', [['all','全部类别'], ['etf','ETF'], ['stock','个股'], ['fund','基金']]) + '</div>' +
      '<div class="portfolio-library-scroll portfolio-benchmark-options" id="portfolio-benchmark-options">' + benchmarkOptions() + '</div><div class="portfolio-benchmark-actions">' +
      H.action('取消并返回', 'close', 'btn') + btn('不设对照', 'no-benchmark', 'btn primary') + '</div></div>');
    const search = document.getElementById('portfolio-benchmark-query');
    H.bindAutoLoad?.();
    search?.addEventListener('compositionend', () => handleInput(search));
    search?.focus({preventScroll:true});
  }
  async function changeBenchmark(id) {
    if (!result || running || exportingPdf) return;
    const account = result, input = chartInputs.get(account).input;
    const row = id ? input.catalog.assets.find(a => a.id === id) : null;
    if (id && !row) return;
    document.getElementById('dialog')?.close();
    const request = { id, name: row?.code }, triggerId = benchmarkTriggerId;
    const refocus = () => document.getElementById(triggerId)?.focus({ preventScroll: true });
    benchmarkRequest = request;
    if (id) { update(); refocus(); }
    let failure = null;
    try {
      if (row) {
        const needed = [row];
        if (row.currency !== currency(account.config).code) needed.push(input.catalog.fx);
        const evidence = await Promise.all(needed.map(a => a.id === input.catalog.fx?.id && input.fxHistory ? input.fxHistory : input.histories[a.id] || loadHistory(a)));
        input.histories[row.id] = evidence[0];
        if (needed.length > 1) input.fxHistory = evidence[1];
      }
    } catch (e) { failure = e.message; }
    if (benchmarkRequest !== request || result !== account) return;
    benchmarkRequest = null;
    for (const part of [account, ...(account.snapshots || [])]) {
      if (part.error) continue;
      Object.assign(part, failure ? { benchmark: null, benchmarkError: failure } : P.compareBenchmark(input, part, id));
      part.config.benchmarkId = id;
    }
    input.config.benchmarkId = id;
    resultKey = JSON.stringify(input.config);
    const refocusAfterRender = !id || document.activeElement?.id === triggerId;
    draft.benchmarkId = id; persist(); update();
    if (refocusAfterRender) refocus();
  }
  function benchmarkLegend(value) {
    const a = asset(result.config.benchmarkId);
    const name = result.benchmark?.name || a?.name || result.config.benchmarkId;
    const text = benchmarkRequest ? '正在读取 ' + benchmarkRequest.name + '…' : name ? '对照：' + name + (M.finite(value) ? ' ' + H.pct(value) : '') : '添加对照标的';
    return btn((result.benchmark ? '<i></i>' : '') + H.esc(text) + (name && !benchmarkRequest ? '<span>更换</span>' : ''), 'benchmark', 'portfolio-benchmark-trigger',
      'id="portfolio-benchmark" aria-haspopup="dialog"' + (running || exportingPdf ? ' disabled' : ''));
  }
  const chartLayout = { width: 920, height: 330, left: 65, top: 28, bottom: 296 };
  const principalLabel = '持仓本金（不含现金）';
  const indicatorColors = ['#366ca6', '#ad5e23', '#795395', '#168683', '#ae4669', '#617c25', '#8d6239', '#5864aa', '#b43e47', '#247c55', '#92822a', '#70617c', '#b35185'];
  let chartView, plotted;
  const chartObservations = new WeakMap();
  function chartState() {
    if (chartView?.owner !== result) chartView = { owner: result, from: 0, to: result.curve.length - 1, preset: 'all', selected: new Set(), chooser: false,
      refs: undefined, indicators: null };
    if (!chartView.benchmark || chartView.comparison !== result.benchmark) {
      chartView.comparison = result.benchmark;
      chartView.benchmark = new Map((result.benchmark?.curve || []).map(p => [p.day, p]));
    }
    const reference = chartReferenceState(result);
    if (!chartView.indicators || chartView.refs !== reference.refs) {
      chartView.refs = reference.refs;
      chartView.indicators = P.chartIndicators(result, reference.refs);
    }
    return chartView;
  }
  function curveIndex(day, end = false) {
    const rows = result.curve;
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const i = (lo + hi) >>> 1;
      if (rows[i].day < day || (end && rows[i].day === day)) lo = i + 1;
      else hi = i;
    }
    return Math.max(0, Math.min(rows.length - 1, end ? lo - 1 : lo));
  }
  function chartZoom(preset) {
    const view = chartState(), last = result.curve.at(-1).day;
    view.preset = preset; view.to = result.curve.length - 1;
    if (preset === 'all') { view.from = 0; return; }
    const date = new Date(last + 'T00:00:00Z'), d = date.getUTCDate();
    // Calendar months, including ranges that end on the 29th–31st.
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - Number(preset) + 1); date.setUTCDate(0);
    date.setUTCDate(Math.min(date.getUTCDate(), d));
    view.from = curveIndex(date.toISOString().slice(0, 10));
  }
  function visibleValue(row) {
    return metric === 'allocation' ? P.accountAllocation(row)?.securitiesPct : metric === 'amount' ? row.value : metric === 'drawdown' ? row.drawdown : H.annual ? row.annualReturn : row.totalReturn;
  }
  function returnBasis(r) {
    return !H.annual ? '累计' : r.end >= P.addYears(r.start, 1) ? '年化' : '区间';
  }
  function comparisonValue(row, view) {
    if (metric === 'amount') return row.positionPrincipal;
    if (metric === 'allocation') return P.accountAllocation(row)?.cashPct;
    const b = metric === 'return' && view.benchmark.get(row.day);
    if (!b || !M.finite(b.nav)) return null;
    return H.annual ? (row.day === result.start ? 0 : P.annualReturn(b.nav, result.start, row.day)) : (b.nav - 1) * 100;
  }
  function chartPath(values, x, y, step = false) {
    let path = '', drawing = false;
    values.forEach((v, i) => {
      if (!M.finite(v)) { drawing = false; return; }
      const xx = x(i).toFixed(2), yy = y(v).toFixed(2);
      path += !drawing ? 'M' + xx + ' ' + yy + 'h0' : step ? 'H' + xx + 'V' + yy : 'L' + xx + ' ' + yy;
      drawing = true;
    });
    return path;
  }
  const axisNames = { score: '分数', allocation: '分配比例', state: '开关', drawdown: '回撤', deviation: '均线偏离', gap: '仓位缺口', relative: '相对强弱' };
  function chartAxis(key, lines) {
    if (['score', 'allocation', 'state'].includes(key)) return [0, 100];
    let low = 0, high = 0;
    for (const {values} of lines) for (const v of values) if (M.finite(v)) { low = Math.min(low, v); high = Math.max(high, v); }
    return low < high ? [low, high] : [0, 1];
  }
  function indicatorValue(line, v, tick = false) {
    if (!M.finite(v)) return '无当日观测';
    if (line.kind === 'state') return v ? '开启' : '关闭';
    return Number(v.toFixed(tick ? 1 : 2)) + line.unit;
  }
  function chartFigure() {
    const view = chartState(), { width: W, height: HH, left, top, bottom } = chartLayout;
    const rows = result.curve.slice(view.from, view.to + 1), primary = rows.map(visibleValue);
    const secondary = (['amount', 'allocation'].includes(metric) || (metric === 'return' && result.benchmark)) ? rows.map(row => comparisonValue(row, view)) : null;
    const catalog = view.indicators, allLines = catalog.series;
    const observed = allLines.filter(line => view.selected.has(line.id)).map(line => {
      if (!chartObservations.has(line)) chartObservations.set(line, new Map(line.points));
      const byDay = chartObservations.get(line);
      return { ...line, color: indicatorColors[allLines.indexOf(line) % indicatorColors.length], values: rows.map(r => byDay.get(r.day)) };
    });
    const axes = [...new Set(observed.map(s => s.kind))];
    const right = W - 15 - axes.length * 57;
    const x = i => rows.length === 1 ? (left + right) / 2 : left + i / (rows.length - 1) * (right - left);
    const domain = [...primary, ...(secondary || [])].filter(M.finite), min = Math.min(...domain), max = Math.max(...domain);
    const span = max - min || Math.abs(max) * .05 || 1;
    const lo = metric === 'allocation' || !domain.length ? 0 : min - span * .06, hi = metric === 'allocation' || !domain.length ? 100 : max + span * .06;
    const y = v => top + (hi - v) / (hi - lo) * (bottom - top);
    plotted = { view, rows, primary, secondary, observed, x, y, right };
    let grid = '', overlays = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4, yy = y(v);
      grid += '<line x1="' + left + '" y1="' + yy + '" x2="' + right + '" y2="' + yy + '" stroke="#e8ece3"/><text x="' + (left - 7) + '" y="' + (yy + 4) + '" text-anchor="end">' + (metric === 'amount' ? H.money(v / 10000, 1) + '万' : v.toFixed(1) + '%') + '</text>';
    }
    for (const i of new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])) grid += '<text x="' + x(i) + '" y="' + (HH - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle') + '">' + rows[i].day + '</text>';
    axes.forEach((kind, j) => {
      const lines = observed.filter(s => s.kind === kind), line = lines[0], [low, high] = chartAxis(kind, lines);
      const yy = v => bottom - (v - low) / (high - low) * (bottom - top), xx = right + 6 + j * 57;
      grid += '<g data-indicator-axis="' + H.esc(kind) + '"><text x="' + xx + '" y="13">' + H.esc(axisNames[kind] || line.unit) + '</text>';
      for (const fraction of kind === 'state' ? [0, 1] : [0, .5, 1]) {
        const v = low + (high - low) * fraction;
        grid += '<text x="' + xx + '" y="' + (yy(v) + 4) + '">' + H.esc(indicatorValue(line, v, true)) + '</text>';
      }
      grid += '</g>';
      if (kind === 'score') for (const threshold of new Set(lines.flatMap(l => l.values.some(M.finite) ? l.thresholds || [] : []).filter(M.finite))) {
        // Shared scores can have different buying thresholds for different reserve sizes.
        grid += '<line data-score-threshold="' + threshold + '" x1="' + left + '" x2="' + right + '" y1="' + yy(threshold) + '" y2="' + yy(threshold) + '" stroke="#9e8474" stroke-dasharray="2 5"/>';
      }
      for (const l of lines) overlays += '<path data-indicator-line="' + H.esc(l.id) + '" d="' + chartPath(l.values, x, yy, kind === 'state' || kind === 'allocation') + '" stroke="' + l.color + '" fill="none" stroke-width="1.6" stroke-linecap="round"/>';
    });
    const mainPath = chartPath(primary, x, y);
    const area = mainPath && primary.every(M.finite) ? '<path d="' + mainPath + 'L' + x(rows.length - 1) + ' ' + bottom + 'L' + x(0) + ' ' + bottom + 'Z" fill="url(#portfolio-fill)"/>' : '';
    const label = metric === 'allocation' ? '实际仓位' : metric === 'amount' ? '账户资产 · ' + currency(result.config).name : metric === 'drawdown' ? '组合回撤' : '组合' + returnBasis(result) + '收益';
    const legend = (name, color) => '<span><i style="background:' + color + '"></i>' + H.esc(name) + '</span>';
    const lineLabel = line => (line.reference ? '参考 · ' : '') + line.label;
    const legendLabel = line => lineLabel(line) + (!line.values.some(M.finite) ? '（此区间无有效观测）' :
      line.kind === 'score' && line.thresholds?.length ? '（买入门槛 ' + (line.thresholdLabel || line.thresholds.join(' / ') + '分') + '）' : '');
    return '<div class="portfolio-chart-legend">' + legend(metric === 'return' ? '我的组合 ' + H.pct(primary.at(-1)) : metric === 'allocation' ? '实际持仓' : '我的组合', '#35654a') +
      (metric === 'return' ? benchmarkLegend(secondary?.at(-1)) : secondary ? legend(metric === 'amount' ? principalLabel : '实际现金比例', '#9c8d6e') : '') + observed.map(l => legend(legendLabel(l), l.color)).join('') +
      (observed.some(l => l.kind === 'score' && l.thresholds?.length && l.values.some(M.finite)) ? '<span class="portfolio-threshold-key">虚线：分数门槛</span>' : '') + '</div><div class="portfolio-plot-wrap"><div id="portfolio-tooltip" class="portfolio-tooltip" hidden></div><svg class="portfolio-plot" data-portfolio-plot viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="' + label + '"><defs><linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a4c1a2" stop-opacity=".24"/><stop offset="1" stop-color="#a4c1a2" stop-opacity=".02"/></linearGradient></defs>' + grid + area +
      (secondary ? '<path d="' + chartPath(secondary, x, y) + '" stroke="#9c8d6e" fill="none" stroke-linecap="round" stroke-width="1.8" stroke-dasharray="5 4"/>' : '') + '<path d="' + mainPath + '" stroke="#35654a" fill="none" stroke-linecap="round" stroke-width="2.3"/>' + overlays +
      '<rect id="portfolio-zoom-selection" y="' + top + '" height="' + (bottom - top) + '" fill="#508b79" opacity=".18" width="0"/><line id="portfolio-cursor" x1="0" x2="0" y1="' + top + '" y2="' + bottom + '" stroke="#83927c" stroke-dasharray="3 3" visibility="hidden"/><circle id="portfolio-point" r="4.5" fill="#35654a" stroke="white" stroke-width="2" visibility="hidden"/><rect x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '" fill="transparent" pointer-events="all"/></svg></div>';
  }
  function chartOptions(view) {
    const {series, reason} = view.indicators;
    return '<div role="dialog" aria-label="选择叠加策略指标" id="portfolio-overlay-options" class="portfolio-overlay-options">' +
      series.map(s => '<label title="' + H.esc(s.note || s.label) + '"><input type="checkbox" data-portfolio-field="chart-indicator" data-value="' + H.esc(s.id) + '" value="' + H.esc(s.id) + '"' + (view.selected.has(s.id) ? ' checked' : '') + '> ' + H.esc((s.reference ? '参考 · ' : '') + s.label) + '</label>').join('') +
      (reason ? '<span>' + H.esc(reason) + '</span>' : '') + chartReferenceControl() + '</div>';
  }
  function chartChooser(view) {
    const count = view.selected.size;
    const button = btn('叠加策略指标' + (count ? ' · ' + count : ''), 'chart-chooser', 'btn', 'id="portfolio-overlay-trigger" aria-haspopup="dialog" aria-expanded="' + view.chooser + '" aria-controls="portfolio-overlay-options"');
    return '<div class="portfolio-chart-chooser">' + button + (view.chooser ? chartOptions(view) : '') + '</div>';
  }
  function navigatorHandle(side, view) {
    const isStart = side === 'from', i = view[side], last = result.curve.length - 1;
    return '<button type="button" class="portfolio-nav-handle" role="slider" data-nav-handle="' + side + '" aria-label="调整' + (isStart ? '起始' : '结束') +
      '日期" aria-valuemin="' + (isStart ? 0 : view.from) + '" aria-valuemax="' + (isStart ? view.to : last) + '" aria-valuenow="' + i + '" aria-valuetext="' + result.curve[i].day + '"></button>';
  }
  function chartNavigator(view) {
    const rows = result.curve, n = Math.max(1, rows.length - 1);
    const date = (side, start) => '<input data-portfolio-field="chart-' + side + '" type="date" aria-label="走势图' + (start ? '起始' : '结束') + '日期" min="' + rows[start ? 0 : view.from].day +
      '" max="' + rows[start ? view.to : rows.length - 1].day + '" value="' + rows[view[side]].day + '">';
    return '<div class="portfolio-chart-navigator"><div class="portfolio-nav-rail" data-chart-rail style="--from:' + (100 * view.from / n) + '%;--to:' + (100 * view.to / n) + '%">' +
      '<div class="portfolio-nav-track"></div><div class="portfolio-nav-band" data-nav-pan></div>' + navigatorHandle('from', view) + navigatorHandle('to', view) + '</div>' +
      '<div class="portfolio-nav-extent"><span>' + rows[0].day + '</span><span>' + rows.at(-1).day + '</span></div><div class="portfolio-chart-range"><div class="segmented" aria-label="走势图时间范围">' +
      [['1', '近1月'], ['3', '近3月'], ['12', '近1年'], ['36', '近3年'], ['all', '全部']].map(([key, name]) => btn(name, 'chart-zoom', view.preset === key ? 'active' : '', 'data-value="' + key + '" aria-pressed="' + (view.preset === key) + '"')).join('') + '</div>' +
      '<div class="portfolio-chart-dates">' + date('from', true) + '<span>至</span>' + date('to', false) + '</div></div></div>';
  }
  function chart() {
    const view = chartState();
    return H.card('组合走势', '', '<div class="portfolio-chart-body"><div id="portfolio-chart-figure">' + chartFigure() + '</div>' + chartNavigator(view) + '</div>',
      '<div class="portfolio-chart-controls"><div class="segmented" aria-label="走势内容">' + [['return', '收益率'], ['amount', '账户资产'], ['allocation', '实际仓位'], ['drawdown', '回撤']].map(([key, name]) => btn(name, 'metric', key === metric ? 'active' : '', 'data-value="' + key + '" aria-pressed="' + (key === metric) + '"')).join('') + '</div>' + chartChooser(view) +
      btn('导出逐日走势 CSV', 'export-result', 'portfolio-result-link') + '</div>');
  }
  function closeChartChooser(focus = false) {
    if (!chartView?.chooser) return;
    chartView.chooser = false;
    document.getElementById('portfolio-overlay-options')?.remove();
    const trigger = document.getElementById('portfolio-overlay-trigger');
    trigger?.setAttribute('aria-expanded', 'false');
    if (focus) trigger?.focus({preventScroll: true});
  }
  function updateRangePlot(rail, view) {
    const rows = result.curve, n = rows.length - 1, nav = rail.parentElement;
    rail.style.setProperty('--from', 100 * view.from / Math.max(1, n) + '%');
    rail.style.setProperty('--to', 100 * view.to / Math.max(1, n) + '%');
    for (const side of ['from', 'to']) {
      const knob = rail.querySelector('[data-nav-handle="' + side + '"]'), date = nav.querySelector('[data-portfolio-field="chart-' + side + '"]');
      const [min, max] = side === 'from' ? [0, view.to] : [view.from, n];
      knob.setAttribute('aria-valuenow', view[side]); knob.setAttribute('aria-valuetext', rows[view[side]].day);
      knob.setAttribute('aria-valuemin', min); knob.setAttribute('aria-valuemax', max);
      date.min = rows[min].day; date.max = rows[max].day; date.value = rows[view[side]].day;
    }
    for (const b of nav.querySelectorAll('[data-action="portfolio-chart-zoom"]')) {
      b.classList.toggle('active', b.dataset.value === view.preset);
      b.setAttribute('aria-pressed', String(b.dataset.value === view.preset));
    }
    const figure = document.getElementById('portfolio-chart-figure');
    if (figure) figure.innerHTML = chartFigure();
  }
  document.addEventListener?.('pointerdown', event => {
    if (chartView?.chooser && !event.target.closest?.('.portfolio-chart-chooser')) closeChartChooser();
    const rail = event.target.closest?.('[data-chart-rail]');
    if (!rail || !result || event.button !== 0 || event.isPrimary === false) return;
    const view = chartState(), box = rail.getBoundingClientRect(), n = result.curve.length - 1;
    if (!n || !box.width) return;
    event.preventDefault();
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const at = px => clamp(Math.round((px - box.left) / box.width * n), 0, n);
    const from = view.from, to = view.to, anchor = at(event.clientX), handle = event.target.closest?.('[data-nav-handle]');
    const side = handle?.dataset.navHandle || (event.target.closest?.('[data-nav-pan]') ? 'pan' : Math.abs(anchor - from) <= Math.abs(anchor - to) ? 'from' : 'to');
    handle?.focus({preventScroll: true});
    rail.setPointerCapture(event.pointerId);
    // Keep the captured rail mounted; redraw only the plot, at most once per frame.
    let frame = 0, changed = false;
    const paint = () => { frame = 0; if (changed && view === chartView && rail.isConnected) updateRangePlot(rail, view); changed = false; };
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      const motion = Math.round((e.clientX - event.clientX) / box.width * n);
      const position = handle ? clamp(side === 'from' ? from + motion : to + motion, 0, n) : at(e.clientX);
      const delta = clamp(motion, -from, n - to);
      const nextFrom = side === 'pan' ? from + delta : side === 'from' ? Math.min(to, position) : from;
      const nextTo = side === 'pan' ? to + delta : side === 'to' ? Math.max(from, position) : to;
      if (view.from === nextFrom && view.to === nextTo) return;
      view.from = nextFrom; view.to = nextTo; view.preset = ''; changed = true;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const stop = e => {
      if (e.pointerId !== event.pointerId) return;
      if (e.type === 'pointerup') move(e);
      rail.removeEventListener('pointermove', move); rail.removeEventListener('pointerup', stop); rail.removeEventListener('lostpointercapture', stop);
      if (frame) cancelAnimationFrame(frame);
      paint();
    };
    rail.addEventListener('pointermove', move); rail.addEventListener('pointerup', stop); rail.addEventListener('lostpointercapture', stop);
    if (!handle && side !== 'pan') move(event);
  });
  document.addEventListener?.('keydown', event => {
    if (event.key === 'Escape' && chartView?.chooser) { event.preventDefault(); closeChartChooser(true); return; }
    const knob = event.target.closest?.('[data-nav-handle]'), side = knob?.dataset.navHandle;
    if (!side || !result) return;
    const view = chartState(), n = result.curve.length - 1, page = Math.max(1, Math.round(n / 10));
    const [min, max] = side === 'from' ? [0, view.to] : [view.from, n];
    const distances = {ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageUp: page, PageDown: -page, Home: min - view[side], End: max - view[side]};
    if (!(event.key in distances)) return;
    event.preventDefault(); view[side] = Math.max(min, Math.min(max, view[side] + distances[event.key])); view.preset = '';
    updateRangePlot(knob.closest('[data-chart-rail]'), view);
  });
  document.addEventListener?.('focusin', event => {
    if (chartView?.chooser && !event.target.closest?.('.portfolio-chart-chooser')) closeChartChooser();
  });
  function chartReferenceControl() {
    const {status, error} = chartReferenceState(result);
    if (status === 'ready') return '';
    return '<div class="portfolio-chart-reference">' + (status === 'error' ? '<span>' + H.esc(error) + '</span>' : '') + btn(status === 'error' ? '重试加载其他策略参考指标' : status === 'loading' ? '正在加载参考指标…' : '显示其他策略参考指标', 'chart-references', 'text-link small', status === 'loading' ? 'disabled' : '') + '</div>';
  }
  function snapshots() {
    const periods = result.snapshots || [], unit = currency(result.config).unit;
    const benchmark = asset(result.config.benchmarkId);
    const code = benchmark?.code || result.benchmark?.name || result.config.benchmarkId;
    const comparison = btn(benchmarkRequest ? '正在读取 ' + H.esc(benchmarkRequest.name) + '…' : code ?
      H.esc(code) + (H.annual ? ' 持有年化收益' : ' 持有累计收益') + '<span>更换</span>' : '添加对照标的',
      'benchmark', 'portfolio-benchmark-trigger', 'id="portfolio-period-benchmark" aria-haspopup="dialog"' + (running || exportingPdf ? ' disabled' : ''));
    const measures = [[H.annual ? '组合年化收益' : '组合累计收益', r => H.pc(H.annual ? r.annualReturn : r.totalReturn)],
      ...(periods.some(r => !r.error && r.deposits > 1) ? [['资金年化 XIRR', r => M.finite(r.xirr) ? H.pc(r.xirr) : '<span class="muted">' + H.esc(r.xirrMissing) + '</span>']] : []),
      [comparison, r => r.benchmark ? H.pc(H.annual ? r.benchmark.annualReturn : r.benchmark.totalReturn) : '<span class="muted">' + (r.config.benchmarkId ? '缺对照数据' : '未设置') + '</span>'],
      ['税后估值 / ' + unit, r => H.money(r.value)], ['累计投入 / ' + unit, r => H.money(r.contributed)],
      ['税后盈亏 / ' + unit, r => H.money(r.profit)], ['最大回撤', r => H.pc(r.mdd)], ['年化波动', r => H.pct(r.volatility, 2, false)]];
    return H.card('区间快照', '各区间独立建仓', '<div class="table-wrap"><table class="portfolio-snapshot-table"><thead><tr><th>指标</th>' + periods.map(r => '<th>近' + r.years + '年<small>' + (r.error ? '无法模拟' : r.start + ' — ' + r.end) + '</small></th>').join('') + '</tr></thead><tbody>' + measures.map(([label, format]) => '<tr><td>' + label + '</td>' + periods.map(r => '<td class="num">' + (r.error ? '—' : format(r)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + periods.filter(r => r.error || r.benchmarkError).map(r => '<p class="portfolio-snapshot-missing">近' + r.years + '年' + (r.error ? '：' : '对照：') + H.esc(r.error || r.benchmarkError) + '</p>').join(''));
  }
  function selectedDaily() {
    const rows = result?.systematic?.daily || [];
    return rows.find(row => row.day === dailyDay) || rows.at(-1) || null;
  }
  function accountActivityMarkup(r) {
    if (!r.systematic) return '';
    const a = window.ChanghengPortfolioPdf.accountActivity(r), unit = currency(r.config).unit;
    return '<div class="portfolio-account-activity"><strong>本次回测的实际资金与交易</strong><p>初始本金 ' + H.money(a.initial, 2) + ' ' + unit + ' · 入金 ' + a.deposits + '笔，累计 ' + H.money(a.contributed, 2) + ' ' + unit + ' · 规则调仓买入 ' + a.buys + '笔、卖出 ' + a.sells + '笔（不含初次建仓） · 追加资金买入 ' + a.contributionBuys + '笔</p><p>' + (opportunityMethods.has(r.config.initialMethod) ? '高分只动用实际待加仓现金；没有可用现金就不买。' : r.config.initialMethod === 'relative_strength_rotation' ? '' : '持有状态 ' + a.holdDays + ' / ' + a.days + '个共同交易日；状态天数不等于买入次数。') + '年化来自实际模拟账本，新增预算试算不计入年化。</p></div>';
  }
  function dailyReason(row) {
    if (row.status === 'missing') return row.missing || '缺少该日有效信号，不能确定投入金额。';
    if (row.status === 'liquidated') return '该日模拟已清仓，不生成下一笔投入。';
    if (row.status === 'warming-up') return row.metadata?.reason || (row.metadata?.opportunity ? '评分历史仍在积累，待加仓资金继续留现金。' : '历史仍在积累，新增预算沿用原配置。');
    const m = row.metadata || {};
    if (m.opportunity) {
      const o = m.opportunity;
      return (o.legs || []).filter(leg => row.positions?.some(p => p.id === leg.id && p.weight > 0)).map(leg => {
        const name = leg.id === 'us:USD' ? 'USD ETF' : leg.id.replace('us:', '');
        if (leg.blockedByRisk) return name + '风险门关闭，暂停加仓';
        if (!M.finite(leg.score)) return name + '缺完整评分数据';
        if (leg.score < o.threshold) return name + '低于' + o.threshold + '分，待加现金继续保留';
        if (!(leg.availableCash > 0)) return name + '达到阈值，但待加现金已用完';
        return name + '达到阈值，计划买入' + H.money(leg.buyAmount, 2) + ' ' + currency(result.config).unit;
      }).join('；') + '。';
    }
    if (row.method === 'relative_strength_rotation') return '三个复核批次合并确定股票预算去向；未到复核日时沿用已确定的比例。';
    if (row.method === 'dual_risk_guard') return m.vixOn && m.qqqOn ? 'VIX与QQQ两道风险门均处于持有状态；状态不变时不重复买入。' : [m.vixOn === false ? 'VIX风险门尚未恢复' : '', m.qqqOn === false ? 'QQQ深熊风险门尚未恢复' : ''].filter(Boolean).join('；') + '，TQQQ对应预算暂存现金。';
    return m.vixOn ? 'VIX规则处于持有状态；没有新的状态变化时不调整旧持仓。' : 'VIX规则处于退出阶段，TQQQ对应预算暂存现金。';
  }
  function dailySources(row) {
    const m = row.metadata || {}, parts = [];
    if (m.vixDay) parts.push('VIX/VIX3M ' + m.vixDay);
    if (m.qqqDay) parts.push('QQQ ' + m.qqqDay);
    if (m.opportunity) for (const leg of m.opportunity.legs || []) if (leg.sourceDay) parts.push(leg.proxyId.replace('us:', '') + ' ' + leg.sourceDay + ' → ' + leg.id.replace('us:', ''));
    if (row.method === 'relative_strength_rotation' && m.sourceDay) parts.push('USD/TQQQ ' + m.sourceDay);
    return parts.length ? parts.join(' · ') : '源日期未提供';
  }
  function dailyFacts(row) {
    const m = row.metadata || {}, facts = [];
    const numeric = (key, label, suffix = '', digits = 2) => { if (M.finite(m[key])) facts.push([label, m[key].toFixed(digits) + suffix]); };
    if (m.opportunity) {
      const o = m.opportunity;
      facts.push(['本方法买入阈值', o.threshold + ' 分']);
      facts.push(['首次股票预算预留', H.pct(o.reserve * 100, 0, false)]);
      for (const leg of o.legs || []) {
        if (!row.positions?.some(p => p.id === leg.id && p.weight > 0)) continue;
        const name = leg.id === 'us:USD' ? 'USD ETF' : leg.id.replace('us:', '');
        if (M.finite(leg.availableCash)) facts.push([name + '待加现金', H.money(leg.availableCash, 2) + ' ' + currency(result.config).unit]);
      }
    }
    numeric('vixValue', 'VIX收盘');
    numeric('vix3mValue', 'VIX3M收盘');
    numeric('vixRatio', 'VIX / VIX3M', '', 3);
    if (m.vixOn && m.vixArmed) numeric('vixExitRun', '恐慌连续确认', '次 · 阈值10次', 0);
    if (m.vixOn === false || m.vixArmed === false) numeric('vixCalmRun', '正常比值确认', '次 · 阈值5次', 0);
    if (m.vixOn === false) {
      if (M.finite(m.vixPeakDrop)) facts.push(['VIX从离场后峰值回落', H.pct(m.vixPeakDrop * 100, 2, false)]);
      numeric('vixHeld', '离场后观测', '次', 0);
    }
    if (m.vixOn && typeof m.vixArmed === 'boolean') facts.push(['再次退出计数', m.vixArmed ? '已启用' : '等待比值正常化']);
    numeric('qqqPrice', 'QQQ复权价格');
    numeric('qqqMA', 'QQQ 200日均线');
    if (M.finite(m.qqqDrawdown)) facts.push(['QQQ距252日高点', H.pct(m.qqqDrawdown * 100, 2, false)]);
    if (m.qqqOn) numeric('qqqExitRun', '深熊连续确认', '次 · 阈值20次', 0);
    else if (m.qqqOn === false) numeric('qqqEntryRun', '均线恢复确认', '次 · 阈值3次', 0);
    numeric('relativeRatio', '504日相对增长倍数', '倍', 3);
    if (Array.isArray(m.leaders)) facts.push(['三个批次', m.leaders.map(v => v === 0 ? 'USD' : v === 1 ? 'TQQQ' : '原比例').join(' / ')]);
    if (row.method === 'relative_strength_rotation' && M.finite(m.phase)) facts.push(['本月复核批次', '第' + (m.phase + 1) + '批']);
    if (m.lastReviewDay) facts.push(['最近复核', m.lastReviewDay + (m.reviewedToday ? ' · 今日复核' : '')]);
    return facts;
  }
  function dailyAllocation(row) {
    if (!row || !M.finite(additionBudget) || additionBudget < 0) return null;
    return P.additionAllocation(row, additionBudget);
  }
  function additionMarkup(row) {
    const allocation = dailyAllocation(row), unit = currency(result.config).unit;
    if (!M.finite(additionBudget) || additionBudget < 0) return '<p class="negative" role="status">请输入不小于0的有效预算。</p>';
    if (!allocation || !Array.isArray(allocation.orders)) return '<p class="portfolio-warning">' + H.esc(allocation?.reason || row.missing || (row.status === 'liquidated' ? '该日已清仓，不换算新投入。' : '缺有效比例，暂不换算金额。')) + '</p>';
    return '<div class="portfolio-addition-amounts">' + allocation.orders.map(order => '<div><span>买入 ' + H.esc(order.code || order.id) + '</span><strong>' + H.money(order.amount, 2) + ' ' + unit + '</strong></div>').join('') +
      '<div><span>' + (row.metadata?.opportunity ? '留作后续加仓' : '策略暂存现金') + '</span><strong>' + H.money(allocation.parkedCash, 2) + ' ' + unit + '</strong></div><div><span>原配置现金</span><strong>' + H.money(allocation.originalCash, 2) + ' ' + unit + '</strong></div><div><span>买入交易费</span><strong>' + H.money(allocation.fee, 2) + ' ' + unit + '</strong></div></div>' +
      '<p class="small muted">合计 ' + H.money(allocation.total, 2) + ' ' + unit + (allocation.status === 'fallback' ? ' · 预热期间沿用原配置' : '') + '。只分配这笔新增预算，不动用账户原有现金或未到账卖出款。</p>';
  }
  function dailyChart(rows, row) {
    if (!rows.length) return '';
    const opportunity = !!row.metadata?.opportunity;
    const W = 920, HH = 190, left = 44, right = 16, top = 18, height = 130;
    const first = Date.parse(rows[0].day), last = Date.parse(rows.at(-1).day), x = day => left + (Date.parse(day) - first) / Math.max(1, last - first) * (W - left - right);
    const indicators = row.indicators || [], paths = indicators.map((indicator, k) => {
      let d = '', previous = null;
      for (const point of rows) {
        const value = point.indicators?.find(item => item.id === indicator.id)?.value;
        if (!M.finite(value)) { previous = null; continue; }
        const xx = x(point.day), yy = top + (100 - value) / 100 * height;
        d += previous === null ? 'M' + xx + ',' + yy : 'H' + xx + 'V' + yy; previous = value;
      }
      return '<path d="' + d + '" fill="none" stroke="' + colors[k] + '" stroke-width="2.3"' + (k ? ' stroke-dasharray="6 4"' : '') + '/>';
    }).join('');
    return '<div class="portfolio-daily-history"><div class="portfolio-daily-legend">' + indicators.map((item, k) => '<span><i style="background:' + colors[k] + '"></i>' + H.esc(window.ChanghengPortfolioPdf.dailyDisplay(item).label) + '</span>').join('') + '</div><svg viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="逐共同交易日的' + (opportunity ? '加仓分数' : '策略状态') + '，使用下方日期滑块查看">' +
      (opportunity || row.method === 'relative_strength_rotation' ? [0, 50, 100] : [0, 100]).map(v => '<line x1="' + left + '" x2="' + (W - right) + '" y1="' + (top + (100 - v) / 100 * height) + '" y2="' + (top + (100 - v) / 100 * height) + '" stroke="#e0e6dc"/><text x="' + (left - 8) + '" y="' + (top + (100 - v) / 100 * height + 4) + '" text-anchor="end">' + (opportunity ? v + '分' : row.method === 'relative_strength_rotation' ? v + '%' : v ? '持有' : '退出') + '</text>').join('') + (opportunity ? '<line x1="' + left + '" x2="' + (W - right) + '" y1="' + (top + (100 - row.metadata.opportunity.threshold) / 100 * height) + '" y2="' + (top + (100 - row.metadata.opportunity.threshold) / 100 * height) + '" stroke="#a18b63" stroke-dasharray="5 5"/><text x="' + (W - right) + '" y="' + (top + (100 - row.metadata.opportunity.threshold) / 100 * height - 5) + '" text-anchor="end">买入阈值 ' + row.metadata.opportunity.threshold + '分</text>' : '') + paths +
      '<line x1="' + x(row.day) + '" x2="' + x(row.day) + '" y1="' + top + '" y2="' + (top + height) + '" stroke="#a18b63" stroke-dasharray="3 3"/>' +
      '<text x="' + left + '" y="180">' + rows[0].day + '</text><text x="' + (W - right) + '" y="180" text-anchor="end">' + rows.at(-1).day + '</text></svg>' +
      '<input id="portfolio-daily-index" data-portfolio-field="indicator-index" type="range" min="0" max="' + (rows.length - 1) + '" step="1" value="' + rows.indexOf(row) + '" aria-label="逐日' + (opportunity ? '加仓分数' : '策略状态') + '日期" aria-valuetext="' + row.day + '"></div>';
  }
  function dailyCard() {
    if (!result || !systematicMethods.has(result.config.initialMethod)) return '';
    const r = result, rows = r.systematic?.daily || [], row = selectedDaily();
    const opportunity = opportunityMethods.has(r.config.initialMethod), title = opportunity ? '每日加仓分数' : '每日策略状态';
    if (!row) return H.card(title, '缺逐日规则记录', '<p class="portfolio-warning">请重新模拟以读取完整记录。</p>');
    const index = rows.indexOf(row), unit = currency(r.config).unit;
    const action = btn(opportunity ? '导出逐日加仓分数 CSV' : '导出逐日策略状态 CSV', 'export-daily', 'portfolio-result-link');
    const calculation = '<dl>' + window.ChanghengPortfolioPdf.explainDaily(row).map(([label, text]) => '<div><dt>' + H.esc(label) + '</dt><dd>' + H.esc(text) + '</dd></div>').join('') + '</dl>';
    const body = '<div class="portfolio-daily-body"><div class="portfolio-daily-toolbar"><div class="portfolio-daily-date">' + btn('上一交易日', 'daily-prev', 'btn', index === 0 ? 'disabled' : '') +
      '<label>' + (opportunity ? '评分日期' : '状态日期') + '<input id="portfolio-daily-date" data-portfolio-field="indicator-date" type="date" value="' + row.day + '" min="' + rows[0].day + '" max="' + rows.at(-1).day + '"></label>' + btn('下一交易日', 'daily-next', 'btn', index === rows.length - 1 ? 'disabled' : '') + '</div>' +
      '</div><div class="portfolio-daily-main"><div class="portfolio-daily-signal"><div class="portfolio-daily-numbers">' + (row.indicators || []).map(item => { const d = window.ChanghengPortfolioPdf.dailyDisplay(item); return '<div><span>' + H.esc(d.label) + '</span><strong>' + H.esc(d.value) + '</strong><small>' + H.esc(d.basis) + '</small></div>'; }).join('') +
      '</div><p class="portfolio-daily-reason"' + (row.status === 'missing' ? ' role="status"' : '') + '>' + H.esc(dailyReason(row)) + '</p><p class="portfolio-daily-source">决策收盘 ' + row.day + ' · 来源 ' + H.esc(dailySources(row)) + '</p><dl class="portfolio-daily-facts">' + dailyFacts(row).map(([label, value]) => '<div><dt>' + H.esc(label) + '</dt><dd>' + H.esc(value) + '</dd></div>').join('') + '</dl>' + (opportunity ? '' : '<details class="portfolio-daily-calculation"><summary>本日怎么算</summary>' + calculation + '</details>') + '</div>' +
      '<div class="portfolio-addition"><h3>' + (opportunity ? '按本日分数分配新增资金（试算）' : '按当前策略分配新增资金（试算）') + '</h3><label class="portfolio-field"><span>本次新增预算 / ' + unit + '</span><input id="portfolio-addition-budget" data-portfolio-field="indicator-budget" type="number" min="0" max="1000000000000" step="any" value="' + inputValue(additionBudget, 2) + '"></label><p class="small muted">预算试算，不计入回测年化</p><div id="portfolio-addition-values">' + additionMarkup(row) + '</div></div></div>' +
      (opportunity ? '<details id="portfolio-score-calculation" class="portfolio-daily-calculation portfolio-opportunity-calculation"' + (calculationOpen ? ' open' : '') + '><summary>本日分数与买入金额怎么算</summary>' + calculation + '</details>' : '') + dailyChart(rows, row) +
      '<p class="portfolio-daily-caption">' + (opportunity ? '历史研究规则，非胜率。分数控制待加仓现金的投入速度；其独立收益增益尚未证实。' : '持有状态不触发每日买入；本图未衡量当日加仓是否更划算。') + '实际待单在下一共同收盘执行。</p>' +
      nextTradePlan({ ...r, selectedDailyDay: row.day, config: { ...r.config, tax: { ...r.config.tax, liquidate: row.status === 'liquidated' } }, systematic: { ...r.systematic, signalDay: row.day, state: { ...row, day: row.day }, executedTargets: row.executedTargets, nextPlan: row.nextPlan } }) +
      '<div class="portfolio-daily-footer"><a class="source-link" href="docs/portfolio-entry-research.html#' + (opportunity ? 'opportunity' : H.esc(r.config.initialMethod)) + '" target="_blank" rel="noopener">规则说明与历史检验 ↗</a></div></div>';
    return H.card(title, P.strategyNames(r.config).initial + ' · ' + row.day + '收盘' + (opportunity ? ' · 历史研究规则，非胜率' : ''), body, action);
  }
  function nextTradePlan(r) {
    if (r.config.tax?.liquidate) return '';
    const { unit } = currency(r.config);
    let source = '', body = '';
    if (r.config.initialMethod === 'cash_topup') {
      const p = r.nextTopupPlan;
      source = (p?.signalDay || r.topupSignalDay || '最近共同交易日') + '收盘确定';
      body = p ? '<div class="portfolio-next-orders">' + p.orders.map(order => {
        const code = r.holdings.find(h => h.id === order.id)?.code || order.id;
        return '<div><span>买入 ' + H.esc(code) + '</span><strong>' + H.money(order.amount, 2) + ' ' + unit + '</strong></div>';
      }).join('') + '</div><p>买入金额 ' + H.money(p.amount, 2) + ' ' + unit + '，另预留交易费 ' + H.money(p.fee, 2) + ' ' + unit + '。金额已确定；成交价格变化会使实际仓位偏离目标。</p>' : '<strong>暂无补仓计划</strong>';
    } else if (r.config.initialMethod === 'qqq_bear_confirm') {
      const s = r.qqqNextSignal;
      if (!s?.available) return '<p class="portfolio-warning">下一交易日信号不可用：' + H.esc(s?.missing || '缺QQQ最新收盘状态') + '</p>';
      source = 'QQQ ' + s.sourceDay + '收盘信号';
      const action = s.pendingChange ? s.on ? '买回TQQQ对应仓位' : '退出TQQQ对应仓位' : s.on ? '继续持有TQQQ' : '继续持有对应现金';
      body = '<strong>' + action + '</strong>' + (s.pendingChange ? '<span class="badge">待执行</span>' : '') +
        (s.pendingChange && s.on ? '<p>使用本策略待投资金 ' + H.money(r.riskReserve, 2) + ' ' + unit + '（含交易费）。</p>' : '') +
        '<p>模拟账户当前' + (s.executedOn ? '持有TQQQ' : '持有对应现金') + '；以上为下一共同交易日的动作。</p>';
      const latest = r.qqqLatestSignal;
      if (latest?.available && latest.sourceDay > s.sourceDay) body += '<p>较新观察：QQQ ' + H.esc(latest.sourceDay) + '收盘为' + (latest.on ? '持有TQQQ' : '持有现金') + '状态；尚未进入本组合的共同收盘决策，暂不改变上述计划。</p>';
    } else if (systematicMethods.has(r.config.initialMethod)) {
      const s = r.systematic, state = s?.state || {}, p = s?.nextPlan;
      if (!s) return '<p class="portfolio-warning">下一交易日计划不可用：缺策略状态。</p>';
      source = (p?.signalDay || s.signalDay || state.day || '最近共同交易日') + '收盘确定';
      const orders = p?.orders || [], missing = Array.isArray(state.missing) ? state.missing.filter(Boolean).join('；') : state.missing;
      if (orders.length) {
        body = '<span class="badge">待执行</span><div class="portfolio-next-orders">' + orders.map(order => {
          const code = r.holdings.find(h => h.id === order.id)?.code || asset(order.id)?.code || order.id;
          const value = order.side === 'sell' ? (M.finite(order.sellFraction) ? '信号日持仓的 ' + H.pct(order.sellFraction * 100, 2, false) : '卖出比例缺失') : H.money(order.amount, 2) + ' ' + unit;
          return '<div><span>' + (order.side === 'sell' ? '卖出 ' : '买入 ') + H.esc(code) + '</span><strong>' + value + '</strong></div>';
        }).join('') + '</div>';
        if (p.buyAmount > 0) body += '<p>固定买入金额 ' + H.money(p.buyAmount, 2) + ' ' + unit + '，另预留交易费 ' + H.money(p.buyFee || 0, 2) + ' ' + unit + '。</p>';
        body += '<p>卖出比例以信号日持仓为准；买入金额提前确定。</p>';
        if (orders.some(order => order.side === 'sell') && !orders.some(order => order.side === 'buy')) body += '<p>未来买入只使用已到账回款。</p>';
      } else if (missing) {
        body = '<strong>暂不生成新计划</strong>';
      } else if (state.warmingUp) {
        body = '<strong>等待信号历史积累</strong>';
      } else {
        body = '<strong>暂无调仓计划</strong>';
      }
      if (missing) body += '<p class="portfolio-warning">信号缺项：' + H.esc(missing) + '</p>';
      else if (state.warmingUp) body += '<p>' + H.esc(typeof state.warmingUp === 'string' ? state.warmingUp : state.metadata?.reason || '历史观测不足，暂未形成完整信号。') + '</p>';
      if (Array.isArray(s.executedTargets) && !opportunityMethods.has(r.config.initialMethod)) body += '<p>最近执行目标：' + ['USD ETF', 'TQQQ'].map((name, i) => name + ' ' + H.pct(s.executedTargets[i] * 100, 2, false)).join(' · ') + '。实际持仓见组合走势中的“实际仓位”。' + '</p>';
    } else return '';
    return '<div class="portfolio-next-plan"><div class="portfolio-next-head"><h3>' + (r.selectedDailyDay ? '原有账户 · ' : '') + '下一共同交易日</h3><span>' + H.esc(source) + '</span></div>' + body + '</div>';
  }
  function lumpSumComparison() {
    const r = result, b = r.lumpSumComparison;
    if (!b) return '';
    if (b.error) return '<p class="portfolio-warning">一次性投入对照未完成：' + H.esc(b.error) + '</p>';
    const { unit } = currency(r.config), difference = r.value - b.value;
    const verdict = Math.abs(difference) < .005 ? '本区间与一次性投入持平' : difference > 0 ? '本区间高于一次性投入' : '本区间低于一次性投入';
    const selectedReturn = H.annual ? r.annualReturn : r.totalReturn, baselineReturn = H.annual ? b.annualReturn : b.totalReturn;
    const pp = value => (value > 0 ? '+' : '') + value.toFixed(2) + ' 个百分点';
    const body = '<div class="portfolio-method-comparison"><div class="stats-grid portfolio-comparison-stats">' +
      H.stat('期末税后估值差', (difference > 0 ? '+' : '') + H.money(difference, 2), unit, '一次性投入 ' + H.money(b.value, 2) + ' ' + unit) +
      H.stat(returnBasis(r) + '收益差', M.finite(selectedReturn) && M.finite(baselineReturn) ? pp(selectedReturn - baselineReturn) : '—', '', '一次性投入 ' + H.pct(baselineReturn, 2, false)) +
      H.stat('最大回撤对照', H.pct(r.mdd, 2, false), '', '一次性投入 ' + H.pct(b.mdd, 2, false)) + '</div>' +
      (systematicMethods.has(r.config.initialMethod) && r.systematic?.daily?.length ? '' : nextTradePlan(r)) + (opportunityMethods.has(r.config.initialMethod) ? '<p class="portfolio-warning">历史研究规则，非胜率。历史收益优势主要来自VIX风险退出，分数自身的独立增益尚未证实。</p>' : r.config.initialMethod === 'cash_topup' ? '<p class="portfolio-warning">使用账户现金补仓 ' + (r.topupTimes || 0) + ' 次，累计买入 ' + H.money(r.topupAmount || 0, 2) + ' ' + unit + '。现金会减少，股票风险可能增加；满仓且无现金时不产生补仓。</p>' : r.config.initialMethod === 'qqq_bear_confirm' ? '<p class="portfolio-warning">本次模拟状态切换 ' + (r.qqqTimingChanges || 0) + ' 次。研究中的ETF收益优势主要来自2022年一次避险，不能视为已验证的普遍买卖信号。</p>' : systematicMethods.has(r.config.initialMethod) ? '<p class="portfolio-warning">' + {
        vix_panic_reentry: '研究收益优势主要来自2020年一次事件，结果对阈值敏感。',
        relative_strength_rotation: '轮动可能集中于单只ETF，最大回撤可能增大。',
        dual_risk_guard: '研究优势集中于2020和2022两个历史事件，独立验证证据有限。'
      }[r.config.initialMethod] + '</p>' : '');
    return H.card('与一次性投入比较', verdict + ' · 同本金、初始权重、追加、税费与再平衡设置', body + '</div>',
      systematicMethods.has(r.config.initialMethod) ? '' : '<a class="source-link" href="docs/portfolio-entry-research.html" target="_blank" rel="noopener">投入方法研究 ↗</a>');
  }
  function resultHoldings(r) {
    const { unit, name } = currency(r.config);
    const gainTax = r.holdings.some(h => h.taxRates.gain > 0), dividendTax = r.holdings.some(h => h.taxRates.dividend > 0);
    const closed = r.config.tax.liquidate;
    const rows = r.holdings.map((h, i) => '<tr><td><span class="portfolio-result-name"><i style="background:' + colors[i % colors.length] + '"></i><span><strong>' + H.esc(h.name) + '</strong><small>' + H.esc(h.code) + '</small></span></span></td>' +
      '<td class="num">' + H.pc(h.performance.annualReturn) + '<span class="sub">' + H.esc(h.performance.annualMissing || (h.performance.annualBasis === 'money_weighted_xirr' ? 'XIRR' : '不足一年不外推')) + '</span></td><td class="num">' + H.pc(h.performance.totalReturn) + '</td><td class="num">' + H.pc(h.performance.mdd) + '</td><td class="num">' + H.pct(h.performance.volatility, 2, false) + '</td>' +
      '<td class="num">' + H.pct(h.targetWeight, 2, false) + '</td><td class="num">' + H.pct(h.actualWeight, 2, false) + '</td><td class="num">' + H.money(h.value, 2) + '</td><td class="num"><span class="' + (h.profit < 0 ? 'negative' : 'positive') + '">' + H.money(h.profit, 2) + '</span></td><td class="num">' + H.money(h.transactionCost, 2) + '</td><td class="num">' + H.money(h.taxCost, 2) + '</td></tr>').join('');
    const holdingTable = '<div class="table-wrap" tabindex="0" role="region" aria-label="持仓收益与风险明细"><table class="portfolio-holdings-table"><thead><tr class="portfolio-holdings-groups"><th rowspan="2" scope="col">标的</th><th colspan="4" scope="colgroup">策略收益与风险</th><th colspan="6" scope="colgroup">投入与贡献</th></tr><tr><th scope="col">策略年化收益</th><th scope="col" title="实际盈亏 ÷ 累计买入金额（含买入费）">累计投入收益</th><th scope="col">最大回撤</th><th scope="col">年化波动</th><th scope="col">目标权重</th><th scope="col">期末权重</th><th scope="col">税后估值 / ' + unit + '</th><th scope="col">盈亏贡献 / ' + unit + '</th><th scope="col">交易费 / ' + unit + '</th><th scope="col">税费含预留 / ' + unit + '</th></tr></thead><tbody>' + rows + (r.cash > .005 ? '<tr><td>现金</td><td class="num">0.00%</td><td class="num">0.00%</td><td class="num">0.00%</td><td class="num">0.00%</td><td class="num">' + H.pct(r.cashWeight, 2, false) + '</td><td class="num">' + H.pct(r.cash / r.value * 100, 2, false) + '</td><td class="num">' + H.money(r.cash, 2) + '</td><td class="num">0.00</td><td class="num">0.00</td><td class="num">0.00</td></tr>' : '') + '</tbody></table></div>';
    return H.card('持仓贡献', r.start + ' — ' + r.end + ' · ' + name + (gainTax && !closed ? ' · 已减浮盈预留税' : ''), '<div class="portfolio-structure portfolio-end-structure"><h3>期末结构</h3>' + structure(r.holdings.map(h => ({ id: h.id, weight: h.actualWeight }))) + '</div>' + holdingTable,
      btn('导出持仓收益明细 CSV', 'export-holdings', 'portfolio-result-link')) + '<div class="portfolio-result-notes"><span>入金 ' + r.deposits + '笔</span><span>买入 ' + r.transactions.filter(t => t.side === 'buy').length + '笔</span><span>再平衡 ' + r.rebalances + '次</span><span>交易费用 ' + H.money(r.tradeCost, 2) + ' ' + unit + '</span>' + (gainTax ? '<span>已实现盈利税 ' + H.money(r.capitalTax, 2) + ' ' + unit + '</span>' : '') + (dividendTax ? '<span>分红税 ' + H.money(r.dividendTax, 2) + ' ' + unit + '</span>' : '') + (gainTax && !closed ? '<span>浮盈预留税 ' + H.money(r.taxReserve, 2) + ' ' + unit + '</span>' : '') + (r.config.dividendPolicy === 'cash' ? '<span>累计现金分红 ' + H.money(r.cashDividends, 2) + ' ' + unit + '</span>' : '') + (r.initialReserve > .005 ? '<span>待投入本金 ' + H.money(r.initialReserve, 2) + ' ' + unit + '</span>' : '') + (r.timingChanges ? '<span>择时切换 ' + r.timingChanges + '次</span>' : '') +
      btn('逐项来源', 'sources', 'portfolio-result-link', 'aria-haspopup="dialog"') + '</div>';
  }
  function yearlyResults(r) {
    return '<section class="card portfolio-yearly"><div class="card-head"><h2>年度表现</h2><span class="small">本次账户 · 自然年累计收益</span></div><div class="portfolio-year-grid">' + r.annual.map(y => '<div><span>' + y.year + '</span><strong class="num">' + H.pc(y.return) + '</strong><small>' + y.start.slice(5) + ' — ' + y.end.slice(5) + '</small></div>').join('') + '</div></section>';
  }
  function resultSummary(r) {
    const { unit } = currency(r.config);
    const taxed = r.holdings.some(h => h.taxRates.gain > 0 || h.taxRates.dividend > 0), closed = r.config.tax.liquidate;
    const fullYear = r.end >= P.addYears(r.start, 1), basis = returnBasis(r);
    const pct = n => H.pct(M.finite(n) && Math.abs(n) < .005 ? 0 : n, 2, false);
    const amount = (n, signed = false) => {
      const digits = n !== 0 && Math.abs(n) < 1 ? 2 : 0;
      const rounded = Math.abs(n) < .005 ? 0 : n;
      return (signed && rounded > 0 ? '+' : '') + H.money(rounded, digits) + ' <small>' + unit + '</small>';
    };
    const line = (label, value, color = '') => '<p class="portfolio-summary-detail"><span>' + label + '</span><b' + (color ? ' class="' + color + '"' : '') + '>' + value + '</b></p>';
    const metric = (label, value, detail, cls = '') => '<div class="portfolio-summary-metric' + (cls ? ' ' + cls : '') + '"><h2>' + label + '</h2><p class="portfolio-summary-value">' + value + '</p>' + detail + '</div>';
    const account = metric(closed ? '清仓后现金' : taxed ? '期末税后估值' : '期末账户资产', amount(r.value),
      line(closed ? '清仓盈亏' : taxed ? '税后净盈亏' : '账户净盈亏', amount(r.profit, true), r.profit < -.005 ? 'negative' : '') +
      (!closed && r.taxReserve >= .005 ? '<p class="portfolio-summary-note">已扣浮盈预留税 ' + H.money(r.taxReserve, 2) + ' ' + unit + '</p>' : ''), 'portfolio-summary-account');
    let returnDetail = '';
    if (fullYear && r.deposits > 1) {
      returnDetail = '<details class="portfolio-summary-basis"><summary>资金年化 XIRR <b>' + (M.finite(r.xirr) ? pct(r.xirr) : H.esc(r.xirrMissing)) +
        '</b></summary><p>组合收益看净值涨跌；资金年化还考虑每笔入金的日期和金额。</p></details>';
    } else if (H.annual && !fullYear) {
      returnDetail = '<p class="portfolio-summary-note">不足一年，显示区间实际收益</p>';
    }
    return '<section class="portfolio-result-summary" aria-label="模拟结果摘要">' + account +
      metric('组合' + basis + '收益', pct(basis === '年化' ? r.annualReturn : r.totalReturn), returnDetail) +
      metric('最大回撤', pct(r.mdd), line('年化波动', pct(r.volatility))) + '</section>';
  }
  function hasResultSignals(r) {
    return systematicMethods.has(r.config.initialMethod) || ['qqq_bear_confirm', 'cash_topup'].includes(r.config.initialMethod);
  }
  function runSourceRows(r) {
    const { catalog: manifest, histories, fxHistory, marketContext } = chartInputs.get(r).input;
    const rows = [], roles = new Map(), method = r.config.initialMethod;
    const add = (id, role) => roles.set(id, [...(roles.get(id) || []), role]);
    r.holdings.forEach(h => add(h.id, '组合'));
    if (r.benchmark) add(r.benchmark.id, '对照');
    const has = id => r.holdings.some(h => h.id === id);
    if (['qqq_bear_confirm', 'dual_risk_guard'].includes(method) || (opportunityMethods.has(method) && has('us:TQQQ'))) add('us:QQQ', '策略参考');
    if (opportunityMethods.has(method) && has('us:USD')) add('us:SOXX', '策略参考');
    if (r.usesFx || r.benchmark?.usesFx) add(manifest.fx.id, '汇率');
    const collect = (name, basis, url, first, asOf, warning) => {
      const host = /^https:\/\/([a-z\d.-]+)(?:[/:?#]|$)/i.exec(url || '')?.[1]?.toLowerCase();
      const provider = !host ? '缺来源链接' : /(^|\.)yahoo\.com$/.test(host) ? 'Yahoo Finance' :
        /(^|\.)eastmoney\.com$/.test(host) ? '东方财富' : /(^|\.)cboe\.com$/.test(host) ? 'Cboe' : host;
      rows.push({ name, basis, url: host ? url : '', provider, first, asOf, warning });
    };
    for (const [id, uses] of roles) {
      const fx = id === manifest.fx?.id, a = fx ? manifest.fx : manifest.assets.find(row => row.id === id);
      const h = fx ? fxHistory : histories[id];
      const basis = fx ? '美元兑人民币日汇率' : ({ provider_adjusted_close: '含分红复权收盘价', provider_daily_return_or_explicit_actions: '基金净值及每日收益' })[h?.basis] || '缺收益口径';
      collect((a?.name || id) + (uses.length === 1 && uses[0] === '组合' ? '' : ' · ' + uses.join(' / ')),
        basis, h?.sourceUrl || a?.sourceUrl, h?.first, h?.asOf, a?.refreshWarning);
      if (fx && h?.supplement) {
        const s = h.supplement;
        collect(s.name + ' · 汇率历史补档', basis, s.sourceUrl, s.first, s.asOf);
      }
    }
    if (['vix_panic_reentry', 'dual_risk_guard', 'opportunity_mixed_10'].includes(method) || (opportunityMethods.has(method) && has('us:TQQQ'))) {
      for (const code of ['VIX', 'VIX3M']) {
        const s = marketContext?.sources?.[code];
        collect(code + ' · 策略参考', '波动率指数收盘值', s?.actualUrl || s?.url, s?.first, s?.asOf);
      }
    }
    return rows;
  }
  function resultContext(r) {
    const cfg = r.config, strategy = P.strategyNames(cfg), methods = [], amounts = [], { name, unit } = currency(cfg);
    if (cfg.initial > 0 || hasResultSignals(r)) methods.push(strategy.initial);
    if (cfg.initial > 0) amounts.push('本金 ' + H.money(cfg.initial) + ' ' + unit);
    if (cfg.monthly > 0) { methods.push(strategy.contribution); amounts.push('每月预算 ' + H.money(cfg.monthly) + ' ' + unit); }
    amounts.push(({ none: '不再平衡', month: '每月再平衡', quarter: '每季再平衡', year: '每年再平衡' })[cfg.rebalance]);
    const position = (label, weight) => '<span class="portfolio-run-position">' + H.esc(label) + ' <b>' + inputValue(weight) + '%</b></span>';
    const allocations = r.holdings.map(h => position(!h.code || h.name.includes(h.code) ? h.name : h.name + ' (' + h.code + ')', h.targetWeight));
    if (r.cashWeight > 1e-8) allocations.push(position('现金', r.cashWeight));
    const first = r.curve[0], reserve = first.systematicCash;
    const opening = opportunityMethods.has(cfg.initialMethod) && Array.isArray(reserve) ?
      '<dt>首日实际持仓</dt><dd><span>' + H.money(P.accountAllocation(first).securitiesValue, 2) + ' ' + unit + '</span><span class="portfolio-run-meta">待加仓现金 ' + H.money(reserve.reduce((s, n) => s + n, 0), 2) + ' ' + unit + '</span></dd>' : '';
    return '<dl class="portfolio-run-context"><dt>目标配置</dt><dd class="portfolio-run-positions">' + allocations.join('') + '</dd>' +
      '<dt>' + (resultKey === signature() ? '本次策略' : '上次模拟策略') + '</dt><dd><strong class="portfolio-run-strategy">' + H.esc(methods.join(' ＋ ')) + '</strong><span class="portfolio-run-meta">' + H.esc(amounts.join(' · ')) + '</span></dd>' +
      opening + '<dt>回测区间</dt><dd><span>' + H.esc(r.start) + ' 至 ' + H.esc(r.end) + '</span><span class="portfolio-run-meta">' + H.esc(name) + '计价</span>' + resultExtendControl(r) + '</dd></dl>';
  }
  function extendBlock(r) {
    return resultKey !== signature() ? '参数已改动，请先重新模拟' : r.config.tax?.liquidate ? '期末已清仓，不能延续账户' : running ? '正在更新行情' : '';
  }
  function resultExtendControl(r) {
    if (!systematicMethods.has(r.config.initialMethod)) return '';
    const blocked = extendBlock(r);
    return btn('延续到最新行情', 'extend-latest', 'text-link', 'id="portfolio-extend-latest" aria-describedby="portfolio-extend-reason"' + (blocked ? ' disabled' : '')) +
      '<small id="portfolio-extend-reason">' + H.esc(blocked) + '</small>';
  }
  function resultSections(r) {
    const usesMa = r.config.initial > 0 && r.config.initialMethod === 'ma200_hold' || r.config.monthly > 0 && ['dca_ma_trend', 'dca_ma_contrarian'].includes(r.config.contributionMethod);
    const sections = [['chart', '组合走势', () =>
      (r.benchmarkError ? '<p class="portfolio-warning">' + H.esc(r.benchmarkError) + '，当前仅显示组合曲线。</p>' : '') + chart() +
      (usesMa && r.strategy.insufficientMaDays ? '<p class="portfolio-warning">均线不足200个共同交易日的阶段按常规投入，未将缺历史视为下跌信号。</p>' : '')]];
    if (systematicMethods.has(r.config.initialMethod)) sections.push(['daily', opportunityMethods.has(r.config.initialMethod) ? '每日加仓分数' : '每日策略状态', () => dailyCard() + accountActivityMarkup(r)]);
    if (r.lumpSumComparison) sections.push(['comparison', '策略对照', lumpSumComparison]);
    return sections.concat([['periods', '区间表现', () => snapshots() + yearlyResults(r)], ['holdings', '持仓贡献', () => resultHoldings(r)]]);
  }
  function results() {
    if (!result) return '<section class="portfolio-result-placeholder"><div><h2>还没有模拟结果</h2><p>' + (draft.positions.length ? '点击“开始模拟”查看组合走势和收益。' : '先添加标的并设置权重，再开始模拟。') + '</p></div><svg viewBox="0 0 460 135" aria-hidden="true"><path d="M3 120H457M3 80H457M3 40H457" stroke="#e0e5d7"/><path d="m3 101 37-13 37 14 38-28 37 7 38-22 38 12 37-31 37 5 40-26 38 6 40-23" fill="none" stroke="#96aa83" stroke-width="2"/><path d="m3 110 37-4 37 5 38-19 37 10 38-8 38-9 37 6 37-19 40 9 38-16 40 2" fill="none" stroke="#c3b291" stroke-width="1.5" stroke-dasharray="5 5"/></svg></section>';
    const r = result, sections = resultSections(r);
    if (!sections.some(([id]) => id === resultTab)) resultTab = 'chart';
    const tabs = sections.map(([id, label]) => btn(label, 'result-tab', 'portfolio-result-tab',
      'id="portfolio-result-tab-' + id + '" data-value="' + id + '" role="tab" aria-controls="portfolio-result-pane-' + id +
      '" aria-selected="' + (id === resultTab) + '" tabindex="' + (id === resultTab ? '0' : '-1') + '"')).join('');
    const tools = '<div class="portfolio-result-tools">' + H.annualControl +
      btn(exportingPdf ? '正在生成模拟报告…' : resultKey === signature() ? '导出模拟报告 PDF' : '重新模拟并导出 PDF', 'export-pdf', 'portfolio-result-link', running || exportingPdf ? 'disabled' : '') + '</div>';
    return '<div class="portfolio-results"><div class="portfolio-result-head">' + resultContext(r) +
      '<div class="portfolio-result-nav"><div role="tablist" aria-label="模拟结果分区" class="portfolio-result-tabs">' + tabs + '</div>' + tools + '</div></div><div class="portfolio-result-content">' +
      (r.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(r.catalogRefresh.missing) + '</p>' : '') + resultSummary(r) +
      sections.map(([id, , content]) => '<div class="portfolio-result-pane" id="portfolio-result-pane-' + id + '" role="tabpanel" aria-labelledby="portfolio-result-tab-' +
        id + '"' + (id === resultTab ? '>' + content() : ' hidden>') + '</div>').join('') + '</div></div>';
  }
  function revealWorkspace() {
    const workspace = document.getElementById('portfolio-workspace');
    if (workspace && workspace.getBoundingClientRect().top < 0) workspace.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  const workspaceDepth = new Map();
  function openWorkspaceTab(tab, { fresh = false } = {}) {
    if (!workspaceTabs.some(([id]) => id === tab)) return;
    if (workspaceTab === tab && !fresh) return;
    const top = document.getElementById('portfolio-workspace')?.getBoundingClientRect().top;
    if (Number.isFinite(top)) workspaceDepth.set(workspaceTab, Math.max(0, -top));
    if (fresh) workspaceDepth.delete(tab);
    workspaceTab = tab;
    update();
    document.getElementById('portfolio-tab-' + tab)?.focus({ preventScroll: true });
    const depth = workspaceDepth.get(tab) || 0;
    const nextTop = document.getElementById('portfolio-workspace')?.getBoundingClientRect().top;
    if (Number.isFinite(nextTop) && (depth > 0 || nextTop < 0)) {
      window.scrollTo({ top: window.scrollY + nextTop + depth, behavior: 'instant' });
    }
  }
  function workspaceBar() {
    const tabs = workspaceTabs.map(([id, name]) => {
      const active = id === workspaceTab;
      return btn(name + (id === 'holdings' && draft.positions.length ? '<span class="portfolio-tab-count">' + draft.positions.length + '</span>' : ''), 'tab', 'portfolio-tab',
        'id="portfolio-tab-' + id + '" data-value="' + id + '" role="tab" aria-controls="portfolio-panel-' + id + '" aria-selected="' + active + '" tabindex="' + (active ? '0' : '-1') + '"');
    }).join('');
    const primary = !draft.positions.length && workspaceTab !== 'holdings'
      ? btn('添加标的', 'tab', 'btn primary', 'data-value="holdings"')
      : btn(running ? '正在模拟…' : '开始模拟', 'run', 'btn primary', running || exportingPdf || !draft.positions.length ? 'disabled' : '');
    return '<div class="portfolio-workspace-bar"><div class="portfolio-workspace-tabs" role="tablist" aria-label="组合模拟" aria-orientation="horizontal">' + tabs +
      '</div><div class="portfolio-run-actions"><span id="portfolio-dirty" role="status">' + draftNotice() + '</span>' + primary + '</div></div>';
  }
  function workspaceContent() {
    if (workspaceTab === 'settings') return settings();
    if (workspaceTab === 'results') return results();
    const unknown = draft.positions.filter(p => !asset(p.id));
    return (unknown.length ? '<div class="portfolio-warning">' + unknown.length + '只保存的标的已不在当前研究对象中，请移除后模拟。</div>' : '') +
      '<div class="portfolio-builder">' + composition() + library() + '</div>';
  }
  function view(context) {
    H = context; ensureCatalog();
    if (!catalog) return '<section class="card pad"><h2>' + (loadError ? '标的库加载失败' : '正在载入组合标的库') + '</h2><p class="muted">' + H.esc(loadError || 'ETF、个股与基金每日历史按需载入。') + '</p>' + (loadError ? btn('重新加载', 'retry', 'btn primary') : '') + '</section>';
    const previousCalculation = document.getElementById('portfolio-score-calculation');
    if (previousCalculation) calculationOpen = previousCalculation.open;
    return '<div id="portfolio-workspace">' + workspaceBar() + '<div class="portfolio-workspace-body">' +
      (error || importError ? '<p class="portfolio-workspace-error negative" role="alert">' + H.esc(error || importError) + '</p>' : '') +
      workspaceTabs.map(([id]) => '<div id="portfolio-panel-' + id + '" role="tabpanel" aria-labelledby="portfolio-tab-' + id + '"' +
        (id === workspaceTab ? '>' + workspaceContent() : ' hidden>') + '</div>').join('') + '</div></div>';
  }
  function method() {
    H.openModal(H.modalTitle('组合回测口径', currency().name + ' · 每日历史 · 按所设税率') + '<div class="rule-list"><p><strong>价格与分红：</strong>境内基金及ETF使用净值与已发布每日收益，默认不计场内溢价；个股和海外ETF使用含分红复权股价。在“我的组合”选择分红自动再投或计入现金；现金模式按除息日记账，不模拟到账延迟。支持碎股，不模拟申购暂停、涨跌停或整手限制。</p><p><strong>汇率与交易日：</strong>本金、持续投入、成本与结果统一使用所选币种；切换币种保留输入数值，不自动兑换本金。资产币种不同时按当日或此前有效的美元兑人民币历史汇率换算；同币种直接使用原始价格。休市日沿用最近已发布价格；新增投入和再平衡推迟到所选资产都有真实报价的共同日期，不使用未来价格。</p><p><strong>投入与权重：</strong>本金与持续投入方式可分别选择。分批、回撤阶梯的待投入本金持有零息现金，再平衡不提前使用。季投、年投在周期首个共同交易日一次入金该周期预算，末期按窗口内月份数计；倍数定投改变实际入金金额。再平衡只调整已释放资金。</p><p><strong>回撤阶梯与原200日均线：</strong>使用独立目标组合按所选币种计价的收益路径，现金为零息，按目标权重每日复位；不受实际入金、择时仓位或投资者费用税款影响。前一个共同交易日收盘确定回撤和200日均线信号，下一共同交易日执行。回撤从模拟起点峰值计算；均线可使用窗口前真实历史。不足200次时按常规投入，原200日均线择时作用于整个已释放组合。</p><p><strong>现金补仓：</strong>前一共同收盘按实际持仓缺口确定每只标的的买入金额，下一共同收盘先执行已知金额，再处理当天入金和周期再平衡。只用已有现金，不按成交日价格重算金额；成交后比例可偏离目标。</p><p><strong>QQQ深熊确认：</strong>使用QQQ自身美元复权价，仅控制TQQQ对应资金。QQQ低于200日均线且距252日高点跌至少20%连续20日才退出，高于均线连续3日才恢复；按前一共同收盘时可知的QQQ状态执行。下一共同日计划与账户已执行仓位分别展示；若有更晚的QQQ收盘观察，单独列出。</p><p><strong>三种系统调仓：</strong>VIX恐慌恢复使用Cboe的VIX/VIX3M隐含波动指数控制TQQQ；三批相对强弱轮动在USD ETF与TQQQ之间分批调整股票资金；双重风险门合并VIX与QQQ状态。卖出比例对应的数量与买入金额在前一共同收盘确定，卖出回款到账后才用于后续买单；下一日计划与最近执行目标分别展示。</p><p><strong>费用与税：</strong>实际净值与复权股价已经反映产品持续年费，不再重复扣费，也不加回年费。买卖费率是统一自定义假设，未含最低佣金、换汇价差和申赎阶梯费率。投资者税使用所设综合税率；每日从持仓估值减去浮盈预留税，盈利下降时预留随之减少，不逐日重复扣款。期末清仓开启时扣实际清仓交易税费，并解除对应预留。跨境卖出和股息税后的渠道比较见“投资渠道”。</p><p><strong>收益：</strong>组合净值消除外部追加本金影响；税后盈亏为扣除浮盈预留税的期末资产减累计投入。首年年化按至少一年计算；不满一年不显示资金年化。对照线为同币种、同区间持有回报，使用同样税率和期末清仓设置，不计用户自定义交易费。</p><p><strong>持仓策略收益：</strong>逐笔使用实际买卖金额和费用。累计投入收益为（期末税后持仓估值＋累计卖出净回款＋实际派入现金的税后分红－累计买入含费金额）除以累计买入含费金额；反复买入的资金也计入分母。满一年按实际日期计算资金年化XIRR，不足一年显示累计投入收益、不外推；资金流找不到唯一年化解时留空。回撤和波动使用实际持仓的现金流中性净值，计入交易费、已发生税费及浮盈预留，追加和调仓转账本身不计收益。它们衡量持仓过程的风险，不是累计投入收益率的波动。</p></div><div class="actions"><a class="source-link" href="docs/portfolio-method.md" target="_blank" rel="noopener">完整公式与边界 ↗</a></div>');
  }
  function taxMethod() {
    H.openModal(H.modalTitle('组合税费口径', '中国大陆税收居民 · 2026-10-22更新') + '<div class="rule-list"><p><strong>美股普通股息的20%：</strong>是股息总税负。符合中美协定并向券商提交有效W-8BEN时，美国通常预扣10%；中国按20%计税，凭境外纳税凭证抵免10%后补税10%，合计20%。未享协定、ADR、REIT及特殊ETF分配需按实际性质与税单核定，不能一律套用20%，可在“单只标的税率”中覆盖。</p><p><strong>卖出盈利税：</strong>大陆居民情景默认对美股正收益按20%估算。未卖出也按假设卖出计算：预留税＝max(0，持仓市值－预计卖出费－剩余成本)×税率，税后估值＝持仓市值＋现金－预留税。例如投入1,000美元、涨至1,200美元且无交易费，预留40美元，税后估值1,160美元。该预留只是估值扣减，不代表浮盈已产生实际纳税义务，不减少持股或可投资现金；实际卖出时解除对应预留并扣卖出税，避免重复。成本按所选币种移动平均计算，买入费用及税后分红再投入计入成本，逐笔亏损不抵减其他盈利。美元模式按美元收益估税，未模拟人民币申报折算差异。A股普通流通股卖出所得按现行暂免个税处理。</p><p><strong>境内分红：</strong>A股持股超过一年股息暂免，持股一个月以内为20%，超过一个月至一年为10%。默认只采用长期持有0%的简化情景，未自动重建逐笔持有期及卖出时的股息补税；短期买卖可单独设置股息税率。境内公募基金及ETF不在投资者层面追加个税，产品资产中已承担的税费仍保留在净值里。</p><p><strong>分红处理：</strong>复权行情已含分红再投。自动再投时扣分红税、净额计入成本；选择留现金时，将分配从复权持仓中拆出，税后净额在除息日计入现金，不增加持仓成本。分配明细覆盖不足时，留现金或需计分红相关税的模拟会提示具体缺项。</p><p><strong>不计税与期末清仓：</strong>“不计税”把模拟投资者税率设为0%，不会加回净值内已承担的税费。持仓估值已减浮盈预留税，但没有扣假设卖出的交易费本身；开启“期末清仓”会在末日卖出持仓并扣实际清仓交易费与正收益税；末日必须是所有持仓都有实际报价的共同交易日。休市日只能用于持仓估值，不能按沿用报价清仓；对照线同样要求当日实际报价。</p><p>这是统一有效税率情景，实际买卖与分红税、当前浮盈预留分别列示；未模拟申报延期、跨笔或跨年抵扣、外税结转、ADR费用和每次分配的税务分类。</p></div><div class="actions"><a class="source-link" href="https://www.irs.gov/pub/irs-trty/china.pdf" target="_blank" rel="noopener">中美税收协定第9条 ↗</a><a class="source-link" href="https://12366.chinatax.gov.cn/bzds/081/081-5-9.html" target="_blank" rel="noopener">境外所得抵免 ↗</a><a class="source-link" href="https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/201509/t418999.html" target="_blank" rel="noopener">A股股息持有期税率 ↗</a><a class="source-link" href="docs/portfolio-method.md" target="_blank" rel="noopener">完整依据与公式 ↗</a></div>');
  }
  function sources() {
    if (!result) return;
    const r = result;
    H.openModal(H.modalTitle('逐项数据来源', r.start + ' — ' + r.end + ' · ' + currency(r.config).name) + '<div class="table-wrap"><table><thead><tr><th>标的</th><th>可用历史</th><th>数据口径</th><th>来源</th></tr></thead><tbody>' + runSourceRows(r).map(s =>
      '<tr><td>' + H.esc(s.name) + '</td><td>' + H.esc(s.first || '缺起始日期') + '<br>' + H.esc(s.asOf || '缺结束日期') + '</td><td>' + H.esc(s.basis) + '</td><td>' +
      (s.url ? '<a class="source-link" href="' + H.esc(s.url) + '" target="_blank" rel="noopener">' + H.esc(s.provider) + ' ↗</a>' : '缺来源链接') +
      (s.warning ? '<span class="sub">' + H.esc(s.warning) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table></div><p class="note">开始日采用指定日前最近共同交易日；结束日采用共同历史内的实际估值日。休市沿用最近价格 ' + r.carriedPrices + '次，沿用汇率 ' + r.carriedFx + '日。价格最多沿用14日，汇率最多7日；超限停止回测。</p>');
  }
  function exportResult() {
    if (!result) return;
    const code = currency(result.config).code, amount = label => label + code;
    const rows = [['日期', amount('税后估值'), amount('累计转入本金（含现金）'), amount('税后盈亏'), '组合净值', '组合累计收益%（现金流中性）', '组合年化收益%（现金流中性，首年至少一年）', '回撤%', amount('税费含当前预留'), amount('账户现金'), amount('分批策略待投入本金'), '实际证券仓位%', '年费口径', '配置JSON', '全区间资金年化XIRR%', '资金年化缺项', amount('未减预留的资产'), amount('累计已发生税费'), amount('当前浮盈预留税'), amount('实际证券市值'), '实际现金占比%', amount('加仓策略待加现金'), amount(principalLabel)],
      ...result.curve.map(p => {
        const a = P.accountAllocation(p);
        return [p.day, p.value, p.contributed, p.profit, p.nav, p.totalReturn, p.annualReturn, p.drawdown, p.taxCost, p.cash, p.initialReserve, a.securitiesPct, result.config.feeBasis, JSON.stringify(result.config), result.xirr, result.xirrMissing, p.grossValue, p.paidTax, p.taxReserve, a.securitiesValue, a.cashPct, opportunityMethods.has(result.config.initialMethod) ? p.systematicCash.reduce((s, n) => s + n, 0) : null, p.positionPrincipal];
      })];
    H.download('长衡-组合逐日走势-' + result.start + '_' + result.end + '.csv', M.csv(rows), 'text/csv;charset=utf-8');
  }
  function exportDaily() {
    const daily = result?.systematic?.daily || [];
    if (!daily.length) return;
    if (!M.finite(additionBudget) || additionBudget < 0) { H.toast('请输入有效新增预算再导出'); return; }
    const flatten = (value, prefix = '', output = {}) => {
      for (const [key, item] of Object.entries(value || {})) {
        const name = prefix ? prefix + '.' + key : key;
        if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, name, output);
        else output[name] = Array.isArray(item) ? JSON.stringify(item) : item;
      }
      return output;
    };
    const records = daily.map(row => flatten({ ...row, budgetAllocation: P.additionAllocation(row, additionBudget),
      reason: dailyReason(row), sourceLabel: dailySources(row), budgetInput: additionBudget,
      unitsBasis: 'nextPlan.orders.units为内部归一化复权份额，不是券商实际股数' }));
    const columns = [...new Set(records.flatMap(row => Object.keys(row)))];
    H.download('长衡-' + (opportunityMethods.has(result.config.initialMethod) ? '逐日加仓分数-' : '逐日策略状态-') + result.start + '_' + result.end + '.csv', M.csv([columns, ...records.map(row => columns.map(key => row[key] ?? ''))]), 'text/csv;charset=utf-8');
  }
  async function exportPdf() {
    if (running || exportingPdf || !result) return;
    exportingPdf = true; update();
    try {
      if (resultKey !== signature()) await run();
      if (error) throw new Error(error);
      if (!result || resultKey !== signature()) throw new Error('参数在模拟期间发生改动，请重新导出');
      const row = selectedDaily();
      const report = window.ChanghengPortfolioPdf.snapshot(result, catalog, undefined, row ? {
        day: row.day, budget: additionBudget, reason: dailyReason(row), sourceLabel: dailySources(row), facts: dailyFacts(row)
      } : null);
      const blob = await window.ChanghengPortfolioPdf.create(report);
      H.download('长衡-组合模拟-' + report.result.start + '_' + report.result.end + '.pdf', blob, 'application/pdf');
      H.toast('组合模拟报告 PDF 已导出');
    } catch (e) { H.toast('PDF 导出失败：' + e.message); }
    finally { exportingPdf = false; update(); }
  }
  function exportHoldings() {
    if (!result) return;
    const code = currency(result.config).code, amount = label => label + code;
    const rows = [['标的ID', '代码', '名称', '起始日', '结束日', '计价币种', '策略年化收益%', '累计投入收益%', '持仓净值最大回撤%', '持仓净值年化波动%', '目标权重%', '期末权重%', amount('期末税后估值'), amount('盈亏贡献'), amount('交易费'), amount('累计买入含费'), amount('累计卖出净回款'), '年化口径', '收益口径', amount('已实现盈利税'), amount('分红税'), amount('税费含当前预留'), '卖出盈利税率%', '分红综合税率%', amount('当前浮盈预留税'), amount('未减预留的市值'), amount('累计税后现金分红')],
      ...result.holdings.map(h => [h.id, h.code, h.name, result.start, result.end, code, h.performance.annualReturn, h.performance.totalReturn, h.performance.mdd, h.performance.volatility, h.targetWeight, h.actualWeight, h.value, h.profit, h.transactionCost, h.performance.invested, h.performance.returned - h.cashDividends, h.performance.annualBasis, (result.config.dividendPolicy === 'cash' ? '分红计入账户现金' : '分红自动再投') + '；按本次交易费与税费计算', h.capitalTax, h.dividendTax, h.taxCost, h.taxRates.gain, h.taxRates.dividend, h.taxReserve, h.grossValue, h.cashDividends])];
    if (result.cash > .005) rows.push(['cash:' + code, '', '现金', result.start, result.end, code, 0, 0, 0, 0, result.cashWeight, result.cash / result.value * 100, result.cash, 0, 0, '', '', '', '零息现金', 0, 0, 0, 0, 0, 0, result.cash, '']);
    H.download('长衡-持仓收益明细-' + result.start + '_' + result.end + '.csv', M.csv(rows), 'text/csv;charset=utf-8');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('portfolio-', ''), val = button.dataset.value;
    switch (act) {
      case 'tab': return openWorkspaceTab(val);
      case 'result-tab':
        if (!result || resultTab === val || !resultSections(result).some(([id]) => id === val)) return;
        resultTab = val; update();
        document.getElementById('portfolio-result-tab-' + val)?.focus({preventScroll: true});
        return;
      case 'retry': loadError = ''; ensureCatalog(); break;
      case 'run': if (!exportingPdf) return run(); return;
      case 'add':
        if (asset(val) && !draft.positions.some(p => p.id === val)) draft.positions.push({ id: val, weight: draft.positions.length ? 0 : 100 });
        touch(); break;
      case 'remove': draft.positions = draft.positions.filter(p => p.id !== val); delete draft.tax.overrides[val]; touch(); break;
      case 'clear': draft.positions = []; draft.tax.overrides = {}; touch(); break;
      case 'equal': draft.positions.forEach((p, i) => { p.weight = i === draft.positions.length - 1 ? 100 - Math.floor(10000 / draft.positions.length) / 100 * i : Math.floor(10000 / draft.positions.length) / 100; }); touch(); break;
      case 'select': {
        const field = button.dataset.field;
        if (field === 'years') draft.years = /^\d+$/.test(val) ? Number(val) : val;
        else if (['currency', 'rebalance', 'initialMethod', 'contributionMethod'].includes(field)) draft[field] = val;
        touch(); break;
      }
      case 'kind': kind = val; H.resetList(); break;
      case 'market': market = val; H.resetList(); break;
      case 'reset-filter': query = ''; kind = 'all'; market = 'all'; hideBoards = false; H.resetList(); break;
      case 'benchmark': return openBenchmark(button);
      case 'select-benchmark': return changeBenchmark(val);
      case 'no-benchmark': return changeBenchmark('');
      case 'metric': metric = val; break;
      case 'chart-chooser': {
        const view = chartState();
        if (view.chooser) { closeChartChooser(); return; }
        view.chooser = true;
        const trigger = document.getElementById('portfolio-overlay-trigger');
        if (!trigger) break;
        trigger.setAttribute('aria-expanded', 'true'); trigger.insertAdjacentHTML('afterend', chartOptions(view)); trigger.focus({preventScroll: true});
        return;
      }
      case 'chart-zoom': if (['1', '3', '12', '36', 'all'].includes(val)) chartZoom(val); break;
      case 'chart-references': return loadChartReferences();
      case 'extend-latest': return run({ extend: true });
      case 'daily-prev':
      case 'daily-next': {
        const rows = result?.systematic?.daily || [], index = rows.indexOf(selectedDaily());
        dailyDay = rows[Math.max(0, Math.min(rows.length - 1, index + (act === 'daily-prev' ? -1 : 1)))]?.day || '';
        break;
      }
      case 'method': method(); return;
      case 'sources': sources(); return;
      case 'export-result': exportResult(); return;
      case 'export-daily': exportDaily(); return;
      case 'export-pdf': return exportPdf();
      case 'export-holdings': exportHoldings(); return;
      case 'tax-method': taxMethod(); return;
      case 'dividend-policy':
        if (!P.dividendPolicies.some(([id]) => id === val)) return;
        draft.dividendPolicy = val; touch(); break;
      case 'settle-hold': case 'settle-sell': draft.tax.liquidate = act === 'settle-sell'; touch(); break;
      case 'tax-custom': manualTaxChoice = true; break;
      case 'tax-mainland': manualTaxChoice = false; draft.tax = { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20, liquidate: draft.tax.liquidate }; touch(); break;
      case 'tax-zero': manualTaxChoice = false; draft.tax = { ...P.taxConfig(), liquidate: draft.tax.liquidate }; touch(); break;
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
    if (el.dataset?.portfolioField?.startsWith('chart-')) return false;
    if (el.id === 'portfolio-addition-budget') {
      additionBudget = el.value.trim() ? Number(el.value) : NaN;
      const values = document.getElementById('portfolio-addition-values'), row = selectedDaily();
      if (values && row) values.innerHTML = additionMarkup(row);
      return false;
    }
    if (el.id === 'portfolio-daily-index' || el.id === 'portfolio-daily-date') return false;
    if (['benchmark-query', 'benchmark-kind', 'benchmark-market'].includes(el.dataset.portfolioField)) {
      const key = el.dataset.portfolioField.slice(10);
      if (benchmarkFilters[key] !== el.value) {
        benchmarkFilters[key] = el.value;
        const list = document.getElementById('portfolio-benchmark-options');
        if (list && result) {
          H.resetList('portfolio-benchmarks');
          list.innerHTML = benchmarkOptions(); list.scrollTop = 0; H.bindAutoLoad?.();
        }
      }
      return false;
    }
    if (el.id === 'portfolio-search') { query = el.value; H.resetList(); return true; }
    if (el.dataset.portfolioTaxAsset) {
      const id = el.dataset.portfolioTaxAsset, key = el.dataset.taxField;
      draft.tax.overrides[id] ||= {};
      if (!el.value.trim()) delete draft.tax.overrides[id][key];
      else draft.tax.overrides[id][key] = Number(el.value);
      if (!Object.keys(draft.tax.overrides[id]).length) delete draft.tax.overrides[id];
      touch(); syncTax(); return false;
    }
    if (el.dataset.portfolioWeight || el.dataset.portfolioAmount) {
      const p = draft.positions.find(p => p.id === (el.dataset.portfolioWeight || el.dataset.portfolioAmount));
      const value = el.value.trim() ? Number(el.value) : el.validity?.badInput ? NaN : 0;
      if (p) p.weight = el.dataset.portfolioAmount ? P.weightFromAmount(draft.initial, value) : value;
      touch();
      syncBudget(el);
      return false;
    }
    if (el.dataset.portfolioField) {
      const key = el.dataset.portfolioField;
      if (key.startsWith('tax-')) draft.tax[key.slice(4)] = el.value.trim() ? Number(el.value) : NaN;
      else if (['start', 'end'].includes(key)) draft[key] = el.value;
      else draft[key] = el.value.trim() ? Number(el.value) : key === 'monthly' && !el.validity.badInput ? 0 : NaN;
      touch();
      if (key === 'initial') syncBudget(el);
      if (key.startsWith('tax-')) syncTax();
      return false;
    }
    return false;
  }
  function syncTax() {
    const summary = document.getElementById('portfolio-tax-summary');
    if (summary) summary.textContent = taxSummary();
    const note = document.getElementById('portfolio-settlement-note');
    if (note) note.textContent = settlementHint();
    const assumption = document.getElementById('portfolio-tax-assumption');
    if (assumption) assumption.hidden = !hasLongHoldTaxAssumption();
    document.querySelectorAll('[data-portfolio-tax-asset]').forEach(input => {
      const a = asset(input.dataset.portfolioTaxAsset);
      if (a) input.placeholder = inputValue(displayTaxRates(a)[input.dataset.taxField]);
    });
  }
  function syncBudget(active) {
    const summary = document.getElementById('portfolio-allocation-summary');
    if (summary) summary.innerHTML = allocationMarkup();
    // Keep numeric input nodes intact so editing, caret positions and blur clicks survive.
    document.querySelectorAll('[data-portfolio-amount], [data-portfolio-weight]').forEach(input => {
      const p = draft.positions.find(p => p.id === (input.dataset.portfolioAmount || input.dataset.portfolioWeight));
      if (!p) return;
      if (input.dataset.portfolioAmount) input.disabled = !(draft.initial > 0);
      if (input === active) return;
      input.value = input.dataset.portfolioAmount ? inputValue(P.amountFromWeight(draft.initial, p.weight), 2) : inputValue(p.weight);
    });
    syncTax();
  }
  async function handleChange(el) {
    const chartField = el.dataset?.portfolioField;
    if (chartField?.startsWith('chart-') && result) {
      const view = chartState();
      if (chartField === 'chart-indicator') {
        if (view.indicators.series.some(s => s.id === el.value)) {
          if (el.checked) view.selected.add(el.value); else view.selected.delete(el.value);
          const figure = document.getElementById('portfolio-chart-figure'), trigger = document.getElementById('portfolio-overlay-trigger');
          if (figure && trigger) {
            figure.innerHTML = chartFigure();
            trigger.textContent = '叠加策略指标' + (view.selected.size ? ' · ' + view.selected.size : '');
            return;
          }
        }
      } else if (['chart-from', 'chart-to'].includes(chartField) && /^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.checkValidity()) {
        if (chartField === 'chart-from') view.from = Math.min(view.to, curveIndex(el.value));
        else view.to = Math.max(view.from, curveIndex(el.value, true));
        view.preset = '';
      }
      update();
      return;
    }
    if (el.id === 'portfolio-addition-budget') { handleInput(el); return; }
    if (el.id === 'portfolio-daily-date' || el.id === 'portfolio-daily-index') {
      const rows = result?.systematic?.daily || [];
      const row = el.id === 'portfolio-daily-index' ? rows[Math.max(0, Math.min(rows.length - 1, Number(el.value)))] : rows.filter(row => row.day <= el.value).at(-1);
      if (row) dailyDay = row.day;
      update(); return;
    }
    if (el.id === 'portfolio-import') {
      const file = el.files?.[0];
      if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error('配置文件大于1MB');
        const next = P.sanitizeDraft(JSON.parse(await file.text()), new Set(catalog.assets.map(a => a.id)));
        manualTaxChoice = false; draft = { ...defaults, ...next }; delete draft.feeBasis;
        importError = ''; touch();
      } catch (e) { importError = '配置导入失败：' + e.message; }
      update(); return;
    }
    if (el.id === 'portfolio-hide-boards') { hideBoards = el.checked; H.resetList(); update(); return; }
    if (el.dataset.portfolioWeight || el.dataset.portfolioAmount || el.dataset.portfolioField || el.dataset.portfolioTaxAsset) {
      handleInput(el);
      if (el.dataset.portfolioField === 'monthly' && !el.value.trim() && !el.validity.badInput) el.value = '0';
    }
  }
  function showPoint(event) {
    const plot = event.target.closest?.('[data-portfolio-plot]');
    if (!plot || !result) return;
    const box = plot.getBoundingClientRect();
    const {rows, view, x, y, primary, secondary, observed, right} = plotted;
    const {left, width: W} = chartLayout;
    const indexAt = px => Math.round(Math.max(0, Math.min(1, ((px - box.left) * W / box.width - left) / (right - left))) * (rows.length - 1));
    const index = indexAt(event.clientX), point = rows[index], value = primary[index];
    if (event.type === 'pointerdown' && event.button === 0 && event.pointerType !== 'touch' && !plot.hasPointerCapture(event.pointerId)) {
      plot.setPointerCapture(event.pointerId);
      const brush = document.getElementById('portfolio-zoom-selection'), anchor = event.clientX;
      const move = e => {
        if (e.pointerId !== event.pointerId || !brush) return;
        const a = x(index), b = x(indexAt(e.clientX));
        brush.setAttribute('x', Math.min(a, b)); brush.setAttribute('width', Math.abs(b - a));
      };
      const stop = e => {
        if (e.pointerId !== event.pointerId) return;
        plot.removeEventListener('pointermove', move); plot.removeEventListener('pointerup', stop);
        plot.removeEventListener('lostpointercapture', stop);
        brush?.setAttribute('width', 0);
        if (e.type !== 'pointerup' || Math.abs(e.clientX - anchor) < 6) return;
        const i = indexAt(e.clientX);
        if (i === index) return;
        const start = view.from;
        view.from = start + Math.min(i, index); view.to = start + Math.max(i, index); view.preset = '';
        update();
      };
      plot.addEventListener('pointermove', move); plot.addEventListener('pointerup', stop); plot.addEventListener('lostpointercapture', stop);
    }
    const unit = currency(result.config).unit, amount = v => H.money(v, 2) + ' ' + unit;
    const format = v => !M.finite(v) ? '无当日观测' : metric === 'amount' ? amount(v) : H.pct(v);
    const cursor = document.getElementById('portfolio-cursor'), dot = document.getElementById('portfolio-point');
    if (cursor) { cursor.setAttribute('x1', x(index)); cursor.setAttribute('x2', x(index)); cursor.setAttribute('visibility', 'visible'); }
    if (dot) {
      if (M.finite(value)) { dot.setAttribute('cx', x(index)); dot.setAttribute('cy', y(value)); }
      dot.setAttribute('visibility', M.finite(value) ? 'visible' : 'hidden');
    }
    const tooltip = document.getElementById('portfolio-tooltip');
    if (tooltip) {
      const entries = [], alloc = P.accountAllocation(point);
      if (metric !== 'allocation') entries.push([metric === 'drawdown' ? '组合回撤' : '我的组合', format(value)]);
      if (secondary && metric === 'return') {
        entries.push([result.benchmark.name, format(secondary[index])]);
        if (M.finite(value) && M.finite(secondary[index])) entries.push(['与对照相差', H.money(value - secondary[index], 2) + ' 个百分点']);
      }
      if (metric !== 'amount') entries.push(['税后估值', amount(point.value)]);
      entries.push([principalLabel, amount(point.positionPrincipal)]);
      if (M.finite(alloc?.securitiesValue)) entries.push(['实际持仓', amount(alloc.securitiesValue) + ' · ' + H.pct(alloc.securitiesPct, 2, false)], ['现金', amount(alloc.cash) + ' · ' + H.pct(alloc.cashPct, 2, false)]);
      entries.push(['税后盈亏', amount(point.profit)]);
      if (metric !== 'drawdown') entries.push(['回撤', H.pct(point.drawdown)]);
      for (const line of observed) entries.push([(line.reference ? '参考 · ' : '') + line.label, indicatorValue(line, line.values[index])]);
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
