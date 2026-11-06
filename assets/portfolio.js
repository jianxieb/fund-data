(function () {
  'use strict';
  const M = window.Changheng, P = window.ChanghengPortfolioModel, KEY = 'changheng.portfolio.v1';
  let H, catalog = window.PORTFOLIO_CATALOG || null, loading = false, loadError = '', running = false, runId = 0;
  const histories = new Map(), requests = new Map();
  const defaults = { positions: [], currency: 'CNY', initial: 100000, monthly: 0, initialMethod: 'lump_sum', contributionMethod: 'dca_month', rebalance: 'none', transactionFee: 0,
    years: 5, start: '', end: '', benchmarkId: 'us:SPY', feeOverrides: {},
    tax: { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20 } };
  let draft = { ...defaults }, query = '', kind = 'all', market = 'all', hideBoards = false, pickerMode = 'holding';
  let result = null, resultKey = '', error = '', metric = 'return', importError = '', exportingPdf = false;
  let dailyDay = '', additionBudget = 10000;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.positions)) draft = { ...defaults, ...saved };
  } catch (_) {}
  if (draft.monthly == null || draft.monthly === '') draft.monthly = 0;
  draft.tax = { ...P.taxConfig(), ...draft.tax, overrides: { ...(draft.tax?.overrides || {}) } };
  const colors = ['#35654a', '#768855', '#aa8253', '#7d839f', '#64a6a1', '#ad6f78', '#8ba9cf', '#aab865'];
  const systematicMethods = new Set(['vix_panic_reentry', 'relative_strength_rotation', 'dual_risk_guard']);
  const typeName = { stock: '个股', fund: '基金', etf: 'ETF' };
  const config = () => ({ ...draft, feeBasis: 'net', feeOverrides: {} });
  const signature = () => JSON.stringify(config());
  const currency = (cfg = draft) => P.currencyInfo(cfg);
  const asset = id => catalog?.assets.find(a => a.id === id);
  const inputValue = (value, digits = 8) => M.finite(value) ? String(Number(value.toFixed(digits))) : '';
  const btn = (text, act, cls = 'btn', extra = '') => H.action(text, 'portfolio-' + act, cls, extra);
  const tag = (text, cls = '') => '<span class="badge ' + cls + '">' + H.esc(text) + '</span>';
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch (_) { H.toast('浏览器未能保存组合，请导出配置'); } }
  function update() { H.render(); }
  function touch() {
    error = ''; persist();
    const label = document.getElementById('portfolio-dirty');
    if (label) label.textContent = result && resultKey !== signature() ? '参数已改动，重新模拟后生效' : '';
    const extend = document.getElementById('portfolio-extend-latest'), reason = document.getElementById('portfolio-extend-reason');
    if (extend) extend.disabled = !result || resultKey !== signature() || result.config.tax?.liquidate || running;
    if (reason && result) reason.textContent = resultKey !== signature() ? '参数已改动，请先重新模拟' : result.config.tax?.liquidate ? '期末已清仓，不能延续账户' : '原起点 ' + result.start + ' 保持不变';
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
  async function run({ extend = false } = {}) {
    if (running || !catalog) return;
    if (extend && (!result || resultKey !== signature() || result.config.tax?.liquidate)) return;
    for (const position of draft.positions) {
      if (position.weight == null || typeof position.weight === 'string' && !position.weight.trim()) position.weight = 0;
    }
    persist();
    const originalSignature = signature(), previousStart = result?.start;
    const params = JSON.parse(JSON.stringify(config())), token = ++runId;
    try { P.validateConfig(params, new Set(catalog.assets.map(a => a.id))); }
    catch (e) { error = e.message; update(); return; }
    running = true; error = ''; update();
    try {
      let refreshMissing = '';
      try { await refreshCatalog(); }
      catch (e) {
        if (extend) throw e;
        refreshMissing = '未能确认最新行情：' + e.message + '。本次模拟使用已保存的历史数据。';
      }
      P.validateConfig(params, new Set(catalog.assets.map(a => a.id)));
      const marketContext = ['vix_panic_reentry', 'dual_risk_guard'].includes(params.initialMethod) ? await loadMarketContext() : null;
      const selected = params.positions.filter(p => p.weight > 0).map(p => asset(p.id));
      await Promise.all(selected.map(loadHistory));
      if (['qqq_bear_confirm', 'dual_risk_guard'].includes(params.initialMethod)) await loadHistory(asset('us:QQQ'));
      const benchmark = asset(params.benchmarkId);
      if (selected.some(a => a.currency !== currency(params).code)) await loadHistory(catalog.fx);
      else if (benchmark && benchmark.currency !== currency(params).code) await loadHistory(catalog.fx).catch(() => {});
      // Benchmark coverage is independent: an unavailable comparison cannot make
      // a valid user's combination impossible to simulate.
      if (benchmark && !selected.some(a => a.id === benchmark.id)) await loadHistory(benchmark).catch(() => {});
      if (token !== runId) return;
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
        error = '本次模拟未完成：' + computed.error;
      }
      else {
        computed.snapshots = P.simulateWindows(input, computed.end);
        if (params.initialMethod !== 'lump_sum') {
          computed.lumpSumComparison = P.simulate({ ...input, config: { ...params, initialMethod: 'lump_sum', benchmarkId: '' } });
        }
        computed.catalogRefresh = { checkedAt: new Date().toISOString(), available: !refreshMissing, missing: refreshMissing || null };
        if (extend && signature() === originalSignature) { Object.assign(draft, { years: params.years, start: params.start, end: params.end }); persist(); }
        dailyDay = computed.systematic?.daily?.at(-1)?.day || '';
        if (!extend) additionBudget = params.monthly > 0 ? params.monthly : 10000;
        result = computed; resultKey = JSON.stringify(params);
      }
    } catch (e) {
      if (token === runId) {
        error = '本次行情更新失败：' + e.message + (systematicMethods.has(params.initialMethod) && result ? '。仍显示上次成功模拟结果（' + result.end + '）。' : '');
      }
    }
    finally { if (token === runId) { running = false; update(); } }
  }
  function menu(id, label, options, value) {
    const current = options.find(([key]) => String(key) === String(value)) || [value, id === 'initialMethod' && /^entry_(option|volatility|breadth|composite)$/.test(value) ? '已撤回，请重新选择' : '请选择'];
    return '<details class="select-menu portfolio-menu"><summary id="portfolio-' + id + '" aria-label="' + H.esc(label + '：' + current[1]) + '"><span>' + H.esc(current[1]) + '</span></summary><div class="select-menu-list" role="group" aria-label="' + H.esc(label) + '">' + options.map(([key, name]) => btn(H.esc(name), 'select', 'select-menu-option' + (String(key) === String(value) ? ' active' : ''), 'data-field="' + id + '" data-value="' + H.esc(key) + '"')).join('') + '</div></details>';
  }
  function number(label, field, value, max, step = 'any', suffix = '') {
    return '<label class="portfolio-field"><span>' + label + '</span><span class="portfolio-number"><input id="portfolio-' + field + '" type="number" min="0" max="' + max + '" step="' + step + '" value="' + inputValue(value) + '" data-portfolio-field="' + field + '" aria-label="' + label + '">' + (suffix ? '<span>' + suffix + '</span>' : '') + '</span></label>';
  }
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
  function taxSettings() {
    const scenario = taxScenario();
    const presets = '<div class="segmented portfolio-tax-presets" aria-label="税务情景">' + [['mainland', '大陆居民假设'], ['zero', '不计税']].map(([key, label]) => btn(label, 'tax-' + key, scenario === key ? 'active' : '', 'aria-pressed="' + (scenario === key) + '"')).join('') + '</div>';
    const domestic = [['cnStock', 'A股'], ['cnFund', '境内基金 / ETF']].map(([key, label]) => '<span><strong>' + label + '</strong>卖出 ' + inputValue(draft.tax[key + 'CapitalGains']) + '% · ' + (key === 'cnStock' && !draft.tax.cnStockDividend ? '长期股息 ' : '分红 ') + inputValue(draft.tax[key + 'Dividend']) + '%</span>').join('');
    const overrides = draft.positions.map(p => asset(p.id)).filter(a => a && (a.market === 'us' || a.currency === 'USD' || a.kind === 'stock' || Object.keys(draft.tax.overrides[a.id] || {}).length)).map(a => {
      const rates = displayTaxRates(a), own = draft.tax.overrides[a.id] || {};
      const input = (field, label) => '<label><span>' + label + '</span><span class="portfolio-number"><input type="number" min="0" max="100" step="any" value="' + inputValue(own[field]) + '" placeholder="' + inputValue(rates[field]) + '" data-portfolio-tax-asset="' + H.esc(a.id) + '" data-tax-field="' + field + '" aria-label="' + H.esc(a.name + '的' + label) + '"><span>%</span></span></label>';
      const domesticStock = a.market !== 'us' && a.currency !== 'USD' && a.kind === 'stock' && own.gain === undefined;
      return '<div class="portfolio-tax-asset' + (domesticStock ? ' portfolio-tax-asset-single' : '') + '"><strong>' + H.esc(a.name) + '</strong>' + (domesticStock ? '' : input('gain', '卖出盈利税率')) + input('dividend', domesticStock ? '短期持股股息税率' : '股息总税负') + '</div>';
    }).join('');
    return '<div class="portfolio-tax-bar"><div class="portfolio-tax-top"><strong>模拟税率</strong>' + presets + '<span id="portfolio-tax-summary">' + H.esc(taxSummary()) + '</span><div class="portfolio-tax-options"><label class="check-label"><input type="checkbox" id="portfolio-liquidate"' + (draft.tax.liquidate ? ' checked' : '') + '>期末清仓</label>' + btn('税费口径', 'tax-method', 'text-link small') + '</div></div><details class="portfolio-tax-settings"><summary>自定义税率</summary><div class="portfolio-tax-body"><div class="portfolio-tax-grid">' + number('美股卖出盈利税率', 'tax-usCapitalGains', draft.tax.usCapitalGains, 100, 'any', '%') + number('美股股息总税负', 'tax-usDividend', draft.tax.usDividend, 100, 'any', '%') + '</div><div class="portfolio-tax-domestic">' + domestic + '</div>' + (overrides ? '<details class="portfolio-tax-overrides"><summary>特殊标的税率</summary>' + overrides + '</details>' : '') + '</div></details><p class="portfolio-tax-assumption">未卖出的盈利也按所设税率预留，结果显示扣除预留税后的估值。</p><p id="portfolio-tax-assumption" class="portfolio-tax-assumption"' + (hasLongHoldTaxAssumption() ? '' : ' hidden') + '>A股股息按长期持有0%估算，未自动计入短期卖出补税。</p></div>';
  }
  function strategyHints() {
    const systematicHint = { vix_panic_reentry: 'VIX恐慌持续时暂退TQQQ，恐慌缓和后买回', relative_strength_rotation: '分三批在USD ETF与TQQQ之间调整股票资金', dual_risk_guard: 'VIX恐慌或QQQ深熊任一触发时暂退TQQQ，两者解除后买回' }[draft.initialMethod];
    const initial = /^entry_(option|volatility|breadth|composite)$/.test(draft.initialMethod) ? '原研究投入方式已撤回：未证明优于一次性投入，请重新选择本金投入方式' : systematicHint || (draft.initial === 0 ? (draft.initialMethod === 'cash_topup' ? '持续投入后，用已有现金补足目标仓位，只买不卖' : draft.initialMethod === 'qqq_bear_confirm' ? '持续投入的TQQQ资金同样按QQQ状态持有或等待' : '初始金额为0，仅执行持续投入') : ({
      lump_sum: '初始本金一次买入', cash_topup: '按前日缺口用已有现金补仓，买入金额提前确定', qqq_bear_confirm: 'QQQ持续深跌时暂退TQQQ，趋势恢复后买回；其他持仓照常', tranche_6: '初始本金分6份，每月投入一份', tranche_12: '初始本金分12份，每月投入一份',
      tranche_24: '初始本金分24份，每月投入一份', drawdown_ladder: '先投入25%；回撤10% / 20% / 30%各投入25%', ma200_hold: '前收盘高于200日均线持有，否则持有现金'
    }[draft.initialMethod]));
    const income = draft.monthly === 0 ? '月预算为0，不追加投入' : ({
      dca_month: '每月投入基础月预算', dca_quarter: '季度首个共同交易日投入本季预算', dca_year: '年度首个共同交易日投入本年预算',
      dca_drawdown: '回撤10% / 20% / 30%时投入1.5 / 2 / 3倍月预算', dca_ma_trend: '不高于200日均线时投入半份月预算', dca_ma_contrarian: '不高于200日均线时投入双份月预算'
    }[draft.contributionMethod]);
    return { initial, income };
  }
  function syncStrategyHints() {
    const hints = strategyHints();
    for (const [key, value] of Object.entries(hints)) {
      const el = document.getElementById('portfolio-' + key + '-hint');
      if (el) el.textContent = value || '';
    }
  }
  function settings() {
    const benchmark = asset(draft.benchmarkId), hints = strategyHints();
    return '<section class="card portfolio-settings"><div class="portfolio-settings-top"><h2>模拟设置</h2><div class="portfolio-return-controls"><span class="muted">币种</span>' + menu('currency', '投入与计价币种', [['CNY', '人民币 CNY'], ['USD', '美元 USD']], draft.currency) + '<span class="muted">回测区间</span>' + menu('years', '回测区间', [[1, '近1年'], [2, '近2年'], [3, '近3年'], [5, '近5年'], [10, '近10年'], [15, '近15年'], [20, '近20年'], ['common', '共同历史'], ['custom', '自定义区间']], draft.years) + '</div></div>' +
      '<div class="portfolio-settings-grid"><div class="portfolio-field"><span>本金投入方式</span>' + menu('initialMethod', '本金投入方式', P.initialMethods, draft.initialMethod) + '<small id="portfolio-initial-hint" class="portfolio-strategy-hint">' + H.esc(hints.initial || '') + '</small></div>' +
      '<div class="portfolio-field"><span>持续投入方式</span>' + menu('contributionMethod', '持续投入方式', P.contributionMethods, draft.contributionMethod) + '<small id="portfolio-income-hint" class="portfolio-strategy-hint">' + H.esc(hints.income || '') + '</small></div>' + number('基础月预算', 'monthly', draft.monthly, 1e10, 'any', currency().unit) +
      '<div class="portfolio-field"><span>再平衡</span>' + menu('rebalance', '再平衡周期', [['none', '不再平衡'], ['month', '每月'], ['quarter', '每季度'], ['year', '每年']], draft.rebalance) + '</div>' +
      number('买卖交易费率', 'transactionFee', draft.transactionFee, 5, 'any', '%') + '<div class="portfolio-field portfolio-benchmark"><span>对照标的</span>' + btn(H.esc(benchmark?.code || '不设置') + '<span>更换</span>', 'benchmark', 'portfolio-benchmark-button', 'aria-label="更换对照标的"') + '</div></div>' +
      (draft.years === 'custom' ? '<div class="portfolio-dates"><label>开始日<input type="date" id="portfolio-start" data-portfolio-field="start" value="' + H.esc(draft.start) + '"></label><label>结束日<input type="date" id="portfolio-end" data-portfolio-field="end" value="' + H.esc(draft.end) + '"></label></div>' : '') +
      taxSettings() + '<div class="portfolio-settings-foot">' + H.feeControl + '<div class="portfolio-settings-note">' + currency().name + ' · 分红再投 · 境内ETF净值 ' + btn('口径', 'method', 'text-link small', 'aria-label="组合回测口径"') + '</div></div></section>';
  }
  function holdingRow(position, index) {
    const row = asset(position.id), info = row && M.annualFeeInfo({ ...row, n: row.name }, config().feeOverrides[row.code]);
    return '<div class="portfolio-holding"><div class="portfolio-holding-name"><i style="background:' + colors[index % colors.length] + '"></i><div><strong>' + H.esc(row?.name || position.id) + '</strong><span>' + H.esc(row?.code || '') + ' · ' + H.esc(typeName[row?.kind] || '') + (row?.currency === 'USD' ? ' · 美元资产' : '') + (['star', 'chinext'].includes(row?.board) ? ' · ' + (row.board === 'star' ? '科创板' : '创业板') : '') + '</span>' +
      (row?.status !== 'available' ? '<span class="fee-missing">' + H.esc(row?.missing || '标的已移出研究对象') + '</span>' : '') + '</div></div>' +
      '<div class="portfolio-holding-inputs"><label class="portfolio-field"><span>投入金额</span><span class="portfolio-number"><input type="number" min="0" max="1000000000000" step="0.01" value="' + inputValue(P.amountFromWeight(draft.initial, position.weight), 2) + '" data-portfolio-amount="' + H.esc(position.id) + '" aria-label="' + H.esc((row?.name || position.id) + '的投入金额') + '"' + (draft.initial > 0 ? '' : ' disabled') + '><span>' + currency().unit + '</span></span></label>' +
      '<label class="portfolio-field"><span>占比</span><span class="portfolio-number portfolio-weight"><input type="number" min="0" max="100" step="any" value="' + inputValue(position.weight) + '" data-portfolio-weight="' + H.esc(position.id) + '" aria-label="' + H.esc((row?.name || position.id) + '的组合权重') + '"><span>%</span></span></label></div>' +
      btn('×', 'remove', 'portfolio-remove', 'data-value="' + H.esc(position.id) + '" aria-label="移除' + H.esc(row?.name || position.id) + '"') +
      (H.feeBasis === 'gross_estimate' && info?.applicable ? '<div class="portfolio-fee-field"><span>' + H.esc(info.rate === null ? info.missing : '估算有效年费') + '</span><label><input type="number" min="0" max="99" step="any" data-portfolio-fee="' + H.esc(row.code) + '" value="' + (draft.feeOverrides[row.code] ?? '') + '" placeholder="' + (info.rate ?? '填写有效费率') + '" aria-label="' + H.esc(row.name + '的估算有效年费') + '"><span>% / 年</span></label></div>' : '') + '</div>';
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
    return H.card('我的组合', draft.positions.length + '只标的', '<div class="portfolio-composition"><div class="portfolio-budget">' + number('总投入金额', 'initial', draft.initial, 1e12, '0.01', currency().unit) + '<span>初始投入 · ' + currency().name + '</span></div><div id="portfolio-allocation-summary" aria-live="polite">' + allocationMarkup() + '</div>' +
      (draft.positions.length ? draft.positions.map(holdingRow).join('') : '<div class="portfolio-empty-holdings"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 8h13v13H8zM27 8h13v13H27zM8 27h13v13H8zM33.5 27v13M27 33.5h13"/></svg><h3>从标的库开始构建</h3><p>ETF、个股和基金可以放在同一个组合中。</p></div>') + '</div>',
      '<div class="actions">' + btn('均分权重', 'equal', 'text-link small', draft.positions.length ? '' : 'disabled') + (draft.positions.length ? btn('清空', 'clear', 'text-link small') : '') + '</div>',
      '<div class="actions portfolio-config-actions">' + btn('导入配置', 'import', 'btn portfolio-export') + btn('导出配置', 'save', 'btn portfolio-export', draft.positions.length ? '' : 'disabled') + '<input type="file" id="portfolio-import" accept="application/json,.json" hidden></div>');
  }
  function libraryRows() {
    const q = query.trim().toLowerCase();
    return (catalog?.assets || []).filter(a => (kind === 'all' || a.kind === kind) && (market === 'all' || a.market === market) &&
      (!hideBoards || !/^stock:(68[89]|30[01])/.test(a.id)) && (!q || (a.name + ' ' + a.code + ' ' + a.category + ' ' + (a.style || '')).toLowerCase().includes(q)));
  }
  function pickerRow(row) {
    const selected = pickerMode === 'holding' ? draft.positions.some(p => p.id === row.id) : draft.benchmarkId === row.id;
    const stock = row.kind === 'stock' ? (window.STOCKS || []).find(s => s.c === row.code) : null;
    const status = stock ? M.stockResearchStatus(stock) : null;
    const preview = row.performance;
    const metric = (label, value, reason, note, range) => '<div title="' + H.esc(reason || range || '') + '"><span>' + label + '</span><b class="' + (M.finite(value) ? value < 0 ? 'negative' : 'positive' : 'muted') + '">' + (M.finite(value) ? H.pct(value, 1) : reason?.startsWith('历史不足') ? H.esc(reason.replace('历史', '')) : '—') + '</b>' + (note ? '<small>' + H.esc(note) + '</small>' : '') + '</div>';
    const performance = '<div class="portfolio-library-metrics" role="group" aria-label="' + H.esc(row.name + '的历史收益与回撤') + '">' + [1, 3, 5].map(y => {
      const r = preview?.annual?.[y];
      return metric(y + '年年化', r?.value, r?.reason || (!r ? row.missing || '缺收益历史' : ''), '', r?.start && r.start + ' — ' + r.end);
    }).join('') + metric('5年内最大回撤', preview?.risk5?.mdd, preview?.risk5?.reason || (!preview ? row.missing || '缺回撤历史' : ''), preview?.risk5?.partial ? '实际' + H.money(preview.risk5.actualYears, 1) + '年' : '', preview?.risk5?.start && preview.risk5.start + ' — ' + preview.risk5.end) + '</div>';
    return '<div class="portfolio-library-row"><div class="portfolio-library-main"><strong>' + H.esc(row.name) + ((row.leverage || 1) > 1 ? tag(row.leverage + '倍', 'warn') : '') + '</strong><span>' + H.esc(row.code) + ' · ' + H.esc(typeName[row.kind]) + ' · ' + (row.market === 'us' ? '海外 · 美元' : '境内 · 人民币') + ' · ' + H.esc(row.category || '') + '</span><small>' + H.esc(row.status === 'available' ? row.first + ' — ' + row.asOf : row.missing) + '</small>' +
      (status ? '<div class="portfolio-stock-status"><span>' + H.esc(status.label) + '</span>' + H.action('研究详情', 'stock-detail', 'text-link small', 'data-code="' + H.esc(stock.c) + '" aria-label="' + H.esc(stock.n + '研究详情') + '"') + '</div>' : '') + '</div>' + performance +
      btn(selected ? '已选' : pickerMode === 'holding' ? '+' : '选用', 'add', 'portfolio-add' + (pickerMode === 'benchmark' ? ' portfolio-add-text' : '') + (selected ? ' selected' : ''), 'data-value="' + H.esc(row.id) + '" aria-label="' + H.esc((selected ? '已选择' : pickerMode === 'holding' ? '添加' : '设为对照') + row.name) + '"' + (selected ? ' disabled' : '')) + '</div>';
  }
  function library() {
    const rows = libraryRows();
    return H.card(pickerMode === 'holding' ? '添加标的' : '选择对照标的', '已收录 ' + (catalog?.summary.total || 0) + '只 · 当前匹配 ' + rows.length + '只',
      '<div class="portfolio-library-controls"><input id="portfolio-search" type="search" placeholder="搜索名称、代码或行业" aria-label="搜索组合标的" value="' + H.esc(query) + '"><div class="portfolio-filters">' +
      '<div class="filter-chips">' + [['all', '全部'], ['etf', 'ETF'], ['stock', '个股'], ['fund', '基金']].map(([k, label]) => btn(label, 'kind', 'filter-chip' + (kind === k ? ' active' : ''), 'data-value="' + k + '" aria-pressed="' + (kind === k) + '"')).join('') + '</div>' +
      '<div class="segmented">' + [['all', '全部市场'], ['cn', '境内'], ['us', '海外']].map(([k, label]) => btn(label, 'market', k === market ? 'active' : '', 'data-value="' + k + '"')).join('') + '</div></div>' +
      '<div class="portfolio-library-tools"><label class="check-label"><input type="checkbox" id="portfolio-hide-boards"' + (hideBoards ? ' checked' : '') + '>隐藏科创板 / 创业板个股</label>' + (query || kind !== 'all' || market !== 'all' ? btn('重置筛选', 'reset-filter', 'text-link small') : '') + '</div></div>' +
      '<div class="portfolio-library-scroll"><div data-list-body="portfolio-library">' + H.lazyRows('portfolio-library', rows, pickerRow, 29) + '</div>' + H.loadFooter('portfolio-library') + (!rows.length ? '<div class="portfolio-no-match">没有匹配的已收录标的</div>' : '') + '</div>',
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
    const label = metric === 'amount' ? '税后估值与累计投入 · ' + currency(result.config).name : metric === 'drawdown' ? '组合回撤' : H.annual ? '组合年化收益 · 现金流中性 · 首年按一年计' : '组合累计收益 · 现金流中性';
    return H.card('组合走势', label, '<div class="portfolio-chart-body"><div class="portfolio-chart-legend"><span><i style="background:#35654a"></i>我的组合</span>' + (secondary ? '<span><i style="background:#9c8d6e"></i>' + H.esc(metric === 'amount' ? '累计投入' : result.benchmark.name) + '</span>' : '') + '<span id="portfolio-chart-readout" aria-live="polite"></span></div><div class="portfolio-plot-wrap"><div id="portfolio-tooltip" class="portfolio-tooltip" hidden></div><svg class="portfolio-plot" data-portfolio-plot data-min="' + lo + '" data-max="' + hi + '" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="' + label + '"><title>' + label + '</title><defs><linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a4c1a2" stop-opacity=".24"/><stop offset="1" stop-color="#a4c1a2" stop-opacity=".02"/></linearGradient></defs>' + grid + '<path d="' + area + '" fill="url(#portfolio-fill)"/>' + (secondary ? '<path d="' + path(secondary) + '" stroke="#9c8d6e" fill="none" stroke-width="1.8" stroke-dasharray="5 4"/>' : '') + '<path d="' + path(primary) + '" stroke="#35654a" fill="none" stroke-width="2.3"/><line id="portfolio-cursor" x1="0" x2="0" y1="' + pad.y + '" y2="' + (HH - pad.bottom) + '" stroke="#83927c" stroke-dasharray="3 3" visibility="hidden" pointer-events="none"/><circle id="portfolio-point" r="4.5" fill="#35654a" stroke="white" stroke-width="2" visibility="hidden" pointer-events="none"/><rect x="63" y="24" width="841" height="272" fill="transparent" pointer-events="all"/></svg></div></div>',
      '<div class="portfolio-chart-controls"><div class="segmented" aria-label="走势内容">' + [['return', '收益率'], ['amount', '账户资产'], ['drawdown', '回撤']].map(([key, name]) => btn(name, 'metric', key === metric ? 'active' : '', 'data-value="' + key + '"')).join('') + '</div>' + btn('导出走势', 'export-result', 'btn portfolio-export') + '</div>');
  }
  function snapshots() {
    const periods = result.snapshots || [], unit = currency(result.config).unit;
    const measures = [['资金年化 XIRR', r => M.finite(r.xirr) ? H.pc(r.xirr) : '<span class="muted">' + H.esc(r.xirrMissing) + '</span>'],
      [H.annual ? '组合年化收益' : '组合累计收益', r => H.pc(H.annual ? r.annualReturn : r.totalReturn)],
      [H.annual ? '对照持有年化' : '对照持有累计', r => r.benchmark ? H.pc(H.annual ? r.benchmark.annualReturn : r.benchmark.totalReturn) : '<span class="muted">' + (r.config.benchmarkId ? '缺对照数据' : '未设置') + '</span>'],
      ['税后估值 / ' + unit, r => H.money(r.value)], ['累计投入 / ' + unit, r => H.money(r.contributed)],
      ['税后盈亏 / ' + unit, r => H.money(r.profit)], ['最大回撤', r => H.pc(r.mdd)], ['年化波动', r => H.pct(r.volatility, 2, false)]];
    return H.card('区间快照', '同一组合 · 同一投入方式 · 组合与对照收益均为现金流中性', '<div class="table-wrap"><table class="portfolio-snapshot-table"><thead><tr><th>指标</th>' + periods.map(r => '<th>近' + r.years + '年<small>' + (r.error ? '无法模拟' : r.start + ' — ' + r.end) + '</small></th>').join('') + '</tr></thead><tbody>' + measures.map(([label, format]) => '<tr><td>' + label + '</td>' + periods.map(r => '<td class="num">' + (r.error ? '—' : format(r)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + periods.filter(r => r.error || r.benchmarkError).map(r => '<p class="portfolio-snapshot-missing">近' + r.years + '年' + (r.error ? '：' : '对照：') + H.esc(r.error || r.benchmarkError) + '</p>').join(''));
  }
  function accountRisk() {
    const r = result, latest = r.curve.at(-1), fmt = value => H.pct(value, 2, false);
    const actualCash = r.grossValue > 0 ? r.cash / r.grossValue * 100 : null;
    const holdings = r.holdings.map(h => ({ ...h, weight: r.grossValue > 0 ? h.grossValue / r.grossValue * 100 : null }));
    const cashShortfall = M.finite(actualCash) && r.cashWeight - actualCash >= 5;
    const overweight = holdings.some(h => M.finite(h.weight) && h.weight - h.targetWeight >= 5);
    const body = '<div class="portfolio-risk-account"><div><strong>期末回撤 ' + fmt(latest?.drawdown) + '</strong><span>实际现金 ' + fmt(actualCash) + ' · 目标现金 ' + fmt(r.cashWeight) + '</span></div><p>' + holdings.map(h => H.esc(h.code) + ' ' + fmt(h.weight) + '（目标 ' + fmt(h.targetWeight) + '）').join(' · ') + '</p>' +
      (r.config.tax?.liquidate ? '<p>此模拟已期末清仓；账户为现金。</p>' : cashShortfall || overweight ? '<p class="negative">' + (cashShortfall ? '实际现金低于目标至少5个百分点。每笔投入预留现金，不代表账户一直保持该现金比例。' : '部分持仓已超出目标权重至少5个百分点。') + '</p>' : '') +
      '<small>仓位按未减浮盈预留税的市值计算；回撤基于模拟账户的现金流中性净值。</small></div>';
    return H.card('模拟账户的期末风险', r.end + ' · ' + currency(r.config).name + ' · 实际持仓与现金', '<div class="portfolio-risk-body">' + body + '<a class="source-link" href="docs/portfolio-method.md" target="_blank" rel="noopener">研究方法 ↗</a></div>');
  }
  function selectedDaily() {
    const rows = result?.systematic?.daily || [];
    return rows.find(row => row.day === dailyDay) || rows.at(-1) || null;
  }
  function accountActivityMarkup(r) {
    if (!r.systematic) return '';
    const a = window.ChanghengPortfolioPdf.accountActivity(r), unit = currency(r.config).unit;
    return '<div class="portfolio-account-activity"><strong>本次回测的实际资金与交易</strong><p>初始本金 ' + H.money(a.initial, 2) + ' ' + unit + ' · 入金 ' + a.deposits + '笔，累计 ' + H.money(a.contributed, 2) + ' ' + unit + ' · 规则调仓买入 ' + a.buys + '笔、卖出 ' + a.sells + '笔（不含初次建仓） · 追加资金买入 ' + a.contributionBuys + '笔</p><p>' + (r.config.initialMethod === 'relative_strength_rotation' ? '' : '持有状态 ' + a.holdDays + ' / ' + a.days + '个共同交易日；状态天数不等于买入次数。') + '年化来自实际模拟账本，新增预算试算不计入年化。</p></div>';
  }
  function dailyReason(row) {
    if (row.status === 'missing') return row.missing || '缺少该日有效信号，不能确定投入比例。';
    if (row.status === 'liquidated') return '该日模拟已清仓，不生成下一笔投入。';
    if (row.status === 'warming-up') return row.metadata?.reason || '历史仍在积累，新增预算沿用原配置。';
    const m = row.metadata || {};
    if (row.method === 'relative_strength_rotation') return '三个复核批次合并确定股票预算去向；未到复核日时沿用已确定的比例。';
    if (row.method === 'dual_risk_guard') return m.vixOn && m.qqqOn ? 'VIX与QQQ两道风险门均处于持有状态；状态不变时不重复买入。' : [m.vixOn === false ? 'VIX风险门尚未恢复' : '', m.qqqOn === false ? 'QQQ深熊风险门尚未恢复' : ''].filter(Boolean).join('；') + '，TQQQ对应预算暂存现金。';
    return m.vixOn ? 'VIX规则处于持有状态；没有新的状态变化时不调整旧持仓。' : 'VIX规则处于退出阶段，TQQQ对应预算暂存现金。';
  }
  function dailySources(row) {
    const m = row.metadata || {}, parts = [];
    if (m.vixDay) parts.push('VIX/VIX3M ' + m.vixDay);
    if (m.qqqDay) parts.push('QQQ ' + m.qqqDay);
    if (row.method === 'relative_strength_rotation' && m.sourceDay) parts.push('USD/TQQQ ' + m.sourceDay);
    return parts.length ? parts.join(' · ') : '源日期未提供';
  }
  function dailyFacts(row) {
    const m = row.metadata || {}, facts = [];
    const numeric = (key, label, suffix = '', digits = 2) => { if (M.finite(m[key])) facts.push([label, m[key].toFixed(digits) + suffix]); };
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
      '<div><span>策略暂存现金</span><strong>' + H.money(allocation.parkedCash, 2) + ' ' + unit + '</strong></div><div><span>原配置现金</span><strong>' + H.money(allocation.originalCash, 2) + ' ' + unit + '</strong></div><div><span>买入交易费</span><strong>' + H.money(allocation.fee, 2) + ' ' + unit + '</strong></div></div>' +
      '<p class="small muted">合计 ' + H.money(allocation.total, 2) + ' ' + unit + (allocation.status === 'fallback' ? ' · 预热期间沿用原配置' : '') + '。只分配这笔新增预算，不动用账户原有现金或未到账卖出款。</p>';
  }
  function dailyChart(rows, row) {
    if (!rows.length) return '';
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
    return '<div class="portfolio-daily-history"><div class="portfolio-daily-legend">' + indicators.map((item, k) => '<span><i style="background:' + colors[k] + '"></i>' + H.esc(window.ChanghengPortfolioPdf.dailyDisplay(item).label) + '</span>').join('') + '</div><svg viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="逐共同交易日的策略状态，使用下方日期滑块查看">' +
      (row.method === 'relative_strength_rotation' ? [0, 50, 100] : [0, 100]).map(v => '<line x1="' + left + '" x2="' + (W - right) + '" y1="' + (top + (100 - v) / 100 * height) + '" y2="' + (top + (100 - v) / 100 * height) + '" stroke="#e0e6dc"/><text x="' + (left - 8) + '" y="' + (top + (100 - v) / 100 * height + 4) + '" text-anchor="end">' + (row.method === 'relative_strength_rotation' ? v + '%' : v ? '持有' : '退出') + '</text>').join('') + paths +
      '<line x1="' + x(row.day) + '" x2="' + x(row.day) + '" y1="' + top + '" y2="' + (top + height) + '" stroke="#a18b63" stroke-dasharray="3 3"/>' +
      '<text x="' + left + '" y="180">' + rows[0].day + '</text><text x="' + (W - right) + '" y="180" text-anchor="end">' + rows.at(-1).day + '</text></svg>' +
      '<input id="portfolio-daily-index" data-portfolio-field="indicator-index" type="range" min="0" max="' + (rows.length - 1) + '" step="1" value="' + rows.indexOf(row) + '" aria-label="逐日策略状态日期" aria-valuetext="' + row.day + '"></div>';
  }
  function dailyCard() {
    if (!result || !systematicMethods.has(result.config.initialMethod)) return '';
    const r = result, rows = r.systematic?.daily || [], row = selectedDaily();
    if (!row) return H.card('每日策略状态', '缺逐日规则记录', '<p class="portfolio-warning">请重新模拟以读取完整策略状态。</p>');
    const index = rows.indexOf(row), unit = currency(r.config).unit;
    const blocked = resultKey !== signature() ? '参数已改动，请先重新模拟' : r.config.tax?.liquidate ? '期末已清仓，不能延续账户' : running ? '正在更新行情' : '';
    const action = btn('延续到最新行情', 'extend-latest', 'btn', 'id="portfolio-extend-latest"' + (blocked ? ' disabled title="' + H.esc(blocked) + '"' : ''));
    const body = '<div class="portfolio-daily-body"><div class="portfolio-daily-toolbar"><div class="portfolio-daily-date">' + btn('上一交易日', 'daily-prev', 'btn', index === 0 ? 'disabled' : '') +
      '<label>状态日期<input id="portfolio-daily-date" data-portfolio-field="indicator-date" type="date" value="' + row.day + '" min="' + rows[0].day + '" max="' + rows.at(-1).day + '"></label>' + btn('下一交易日', 'daily-next', 'btn', index === rows.length - 1 ? 'disabled' : '') + '</div>' +
      '<span id="portfolio-extend-reason" class="small muted">' + (blocked || '原起点 ' + r.start + ' 保持不变') + '</span></div><div class="portfolio-daily-main"><div class="portfolio-daily-signal"><div class="portfolio-daily-numbers">' + (row.indicators || []).map(item => { const d = window.ChanghengPortfolioPdf.dailyDisplay(item); return '<div><span>' + H.esc(d.label) + '</span><strong>' + H.esc(d.value) + '</strong><small>' + H.esc(d.basis) + '</small></div>'; }).join('') +
      '</div><p class="portfolio-daily-reason"' + (row.status === 'missing' ? ' role="status"' : '') + '>' + H.esc(dailyReason(row)) + '</p><p class="portfolio-daily-source">决策收盘 ' + row.day + ' · 来源 ' + H.esc(dailySources(row)) + '</p><dl class="portfolio-daily-facts">' + dailyFacts(row).map(([label, value]) => '<div><dt>' + H.esc(label) + '</dt><dd>' + H.esc(value) + '</dd></div>').join('') + '</dl><details class="portfolio-daily-calculation"><summary>本日怎么算</summary><dl>' + window.ChanghengPortfolioPdf.explainDaily(row).map(([label, text]) => '<div><dt>' + H.esc(label) + '</dt><dd>' + H.esc(text) + '</dd></div>').join('') + '</dl></details></div>' +
      '<div class="portfolio-addition"><h3>按当前策略分配新增资金（试算）</h3><label class="portfolio-field"><span>本次新增预算 / ' + unit + '</span><input id="portfolio-addition-budget" data-portfolio-field="indicator-budget" type="number" min="0" max="1000000000000" step="any" value="' + inputValue(additionBudget, 2) + '"></label><p class="small muted">预算试算，不计入回测年化</p><div id="portfolio-addition-values">' + additionMarkup(row) + '</div></div></div>' + dailyChart(rows, row) +
      '<p class="portfolio-daily-caption">持有状态不触发每日买入；本图未衡量当日加仓是否更划算。实际待单在下一共同收盘执行。</p>' +
      nextTradePlan({ ...r, selectedDailyDay: row.day, config: { ...r.config, tax: { ...r.config.tax, liquidate: row.status === 'liquidated' } }, systematic: { ...r.systematic, signalDay: row.day, state: { ...row, day: row.day }, executedTargets: row.executedTargets, nextPlan: row.nextPlan } }) +
      '<div class="portfolio-daily-footer">' + btn('导出逐日策略状态 CSV', 'export-daily', 'text-link small') + '<a class="source-link" href="docs/portfolio-entry-research.html#' + H.esc(r.config.initialMethod) + '" target="_blank" rel="noopener">规则说明与历史检验 ↗</a></div></div>';
    return H.card('每日策略状态', P.strategyNames(r.config).initial + ' · ' + row.day + '收盘', body, action);
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
      if (Array.isArray(s.executedTargets)) body += '<p>最近执行目标：' + ['USD ETF', 'TQQQ'].map((name, i) => name + ' ' + H.pct(s.executedTargets[i] * 100, 2, false)).join(' · ') + (r.selectedDailyDay ? '。这里是该日执行目标；下方账户风险为模拟期末。' : '；实际仓位见下方账户风险。') + '</p>';
    } else return '';
    return '<div class="portfolio-next-plan"><div class="portfolio-next-head"><h3>' + (r.selectedDailyDay ? '原有账户 · ' : '') + '下一共同交易日</h3><span>' + H.esc(source) + '</span></div>' + body + '</div>';
  }
  function lumpSumComparison() {
    const r = result, b = r.lumpSumComparison;
    if (!b) return '';
    if (b.error) return '<p class="portfolio-warning">一次性投入对照未完成：' + H.esc(b.error) + '</p>';
    const { unit } = currency(r.config), difference = r.value - b.value;
    const verdict = Math.abs(difference) < .005 ? '本区间与一次性投入持平' : difference > 0 ? '本区间高于一次性投入' : '本区间低于一次性投入';
    const pp = value => (value > 0 ? '+' : '') + value.toFixed(2) + ' 个百分点';
    const body = '<div class="portfolio-method-comparison"><div class="stats-grid portfolio-comparison-stats">' +
      H.stat('期末税后估值差', (difference > 0 ? '+' : '') + H.money(difference, 2), unit, '一次性投入 ' + H.money(b.value, 2) + ' ' + unit) +
      H.stat('年化收益差', pp(r.annualReturn - b.annualReturn), '', '一次性投入 ' + H.pct(b.annualReturn, 2, false)) +
      H.stat('最大回撤对照', H.pct(r.mdd, 2, false), '', '一次性投入 ' + H.pct(b.mdd, 2, false)) + '</div>' +
      (systematicMethods.has(r.config.initialMethod) && r.systematic?.daily?.length ? '' : nextTradePlan(r)) + (r.config.initialMethod === 'cash_topup' ? '<p class="portfolio-warning">使用账户现金补仓 ' + (r.topupTimes || 0) + ' 次，累计买入 ' + H.money(r.topupAmount || 0, 2) + ' ' + unit + '。现金会减少，股票风险可能增加；满仓且无现金时不产生补仓。</p>' : r.config.initialMethod === 'qqq_bear_confirm' ? '<p class="portfolio-warning">本次模拟状态切换 ' + (r.qqqTimingChanges || 0) + ' 次。研究中的ETF收益优势主要来自2022年一次避险，不能视为已验证的普遍买卖信号。</p>' : systematicMethods.has(r.config.initialMethod) ? '<p class="portfolio-warning">' + {
        vix_panic_reentry: '研究收益优势主要来自2020年一次事件，结果对阈值敏感。',
        relative_strength_rotation: '轮动可能集中于单只ETF，最大回撤可能增大。',
        dual_risk_guard: '研究优势集中于2020和2022两个历史事件，独立验证证据有限。'
      }[r.config.initialMethod] + '</p>' : '');
    return H.card('与一次性投入比较', verdict + ' · 同本金、初始权重、追加、税费与再平衡设置', body + '</div>',
      systematicMethods.has(r.config.initialMethod) ? '' : '<a class="source-link" href="docs/portfolio-entry-research.html" target="_blank" rel="noopener">投入方法研究 ↗</a>');
  }
  function results() {
    if (!result) return '<section class="portfolio-result-placeholder"><div><span class="eyebrow">YOUR PORTFOLIO, OVER TIME</span><h2>看组合如何走过市场起伏</h2><p>配置权重和投入方式后，开始模拟。</p></div><svg viewBox="0 0 460 135" aria-hidden="true"><path d="M3 120H457M3 80H457M3 40H457" stroke="#e0e5d7"/><path d="m3 101 37-13 37 14 38-28 37 7 38-22 38 12 37-31 37 5 40-26 38 6 40-23" fill="none" stroke="#96aa83" stroke-width="2"/><path d="m3 110 37-4 37 5 38-19 37 10 38-8 38-9 37 6 37-19 40 9 38-16 40 2" fill="none" stroke="#c3b291" stroke-width="1.5" stroke-dasharray="5 5"/></svg></section>';
    const r = result, strategy = P.strategyNames(r.config), { unit, name } = currency(r.config);
    const usesMa = r.config.initial > 0 && r.config.initialMethod === 'ma200_hold' || r.config.monthly > 0 && ['dca_ma_trend', 'dca_ma_contrarian'].includes(r.config.contributionMethod);
    const rows = r.holdings.map((h, i) => '<tr><td><span class="portfolio-result-name"><i style="background:' + colors[i % colors.length] + '"></i><span><strong>' + H.esc(h.name) + '</strong><small>' + H.esc(h.code) + '</small></span></span></td>' +
      '<td class="num">' + H.pc(h.performance.annualReturn) + '<span class="sub">' + H.esc(h.performance.annualMissing || (h.performance.annualBasis === 'money_weighted_xirr' ? 'XIRR' : '不足一年不外推')) + '</span></td><td class="num">' + H.pc(h.performance.totalReturn) + '</td><td class="num">' + H.pc(h.performance.mdd) + '</td><td class="num">' + H.pct(h.performance.volatility, 2, false) + '</td>' +
      '<td class="num">' + H.pct(h.targetWeight, 2, false) + '</td><td class="num">' + H.pct(h.actualWeight, 2, false) + '</td><td class="num">' + H.money(h.value, 2) + '</td><td class="num"><span class="' + (h.profit < 0 ? 'negative' : 'positive') + '">' + H.money(h.profit, 2) + '</span></td><td class="num">' + H.money(h.transactionCost, 2) + '</td><td class="num">' + H.money(h.taxCost, 2) + '</td></tr>').join('');
    const holdingTable = '<div class="table-wrap" tabindex="0" role="region" aria-label="持仓收益与风险明细"><table class="portfolio-holdings-table"><thead><tr class="portfolio-holdings-groups"><th rowspan="2" scope="col">标的</th><th colspan="4" scope="colgroup">策略收益与风险</th><th colspan="6" scope="colgroup">投入与贡献</th></tr><tr><th scope="col">策略年化收益</th><th scope="col" title="实际盈亏 ÷ 累计买入金额（含买入费）">累计投入收益</th><th scope="col">最大回撤</th><th scope="col">年化波动</th><th scope="col">目标权重</th><th scope="col">期末权重</th><th scope="col">税后估值 / ' + unit + '</th><th scope="col">盈亏贡献 / ' + unit + '</th><th scope="col">交易费 / ' + unit + '</th><th scope="col">税费含预留 / ' + unit + '</th></tr></thead><tbody>' + rows + (r.cash > .005 ? '<tr><td>现金</td><td class="num">0.00%</td><td class="num">0.00%</td><td class="num">0.00%</td><td class="num">0.00%</td><td class="num">' + H.pct(r.cashWeight, 2, false) + '</td><td class="num">' + H.pct(r.cash / r.value * 100, 2, false) + '</td><td class="num">' + H.money(r.cash, 2) + '</td><td class="num">0.00</td><td class="num">0.00</td><td class="num">0.00</td></tr>' : '') + '</tbody></table></div>';
    return '<div class="portfolio-results"><div class="portfolio-result-head"><div><h2>' + (resultKey === signature() ? '模拟结果' : '上次模拟结果') + '</h2><p>' + r.start + ' — ' + r.end + ' · ' + (r.config.feeBasis === 'net' ? '年费已扣除' : '扣费前估算') + ' · ' + (r.config.tax?.liquidate ? '清仓后结果' : '税后估值') + ' · ' + name + ' · 已计模拟税费及浮盈预留</p><p class="portfolio-result-strategy">' + H.esc((r.config.initial > 0 ? strategy.initial : '') + (r.config.initial > 0 && r.config.monthly > 0 ? ' ＋ ' : '') + (r.config.monthly > 0 ? strategy.contribution : '')) + '</p></div><div class="portfolio-result-tools">' + H.annualControl + '<div class="actions">' + btn('区间与来源', 'sources', 'text-link small') + btn(exportingPdf ? '正在生成 PDF…' : '导出 PDF', 'export-pdf', 'btn portfolio-export', running || exportingPdf ? 'disabled' : '') + '</div></div></div>' +
      '<div class="stats-grid portfolio-result-summary">' + H.stat('资金年化 XIRR', H.pct(r.xirr, 2, false), '', r.xirrMissing || '按实际投入时间和金额计算') +
      H.stat(H.annual ? '组合年化收益' : '组合累计收益', H.pct(H.annual ? r.annualReturn : r.totalReturn, 2, false), '', '现金流中性' + (r.benchmark ? ' · 对照持有 ' + H.pct(H.annual ? r.benchmark.annualReturn : r.benchmark.totalReturn) : ' · 剔除追加本金影响')) +
      H.stat('期末税后估值', H.money(r.value), unit, '累计投入 ' + H.money(r.contributed) + ' ' + unit) + H.stat(r.config.tax?.liquidate ? '清仓盈亏' : '税后盈亏', H.money(r.profit), unit, r.config.tax?.liquidate ? '已扣清仓交易费与盈利税' : '已减浮盈预留税 ' + H.money(r.taxReserve, 2) + ' ' + unit) + H.stat('最大回撤', H.pct(r.mdd, 2, false), '', '年化波动 ' + H.pct(r.volatility, 2, false)) + '</div>' +
      accountActivityMarkup(r) + (r.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(r.catalogRefresh.missing) + '</p>' : '') + dailyCard() + lumpSumComparison() + accountRisk() + snapshots() + (r.benchmarkError ? '<div class="portfolio-warning">' + H.esc(r.benchmarkError) + '，当前仅显示组合曲线。</div>' : '') +
      chart() + '<div class="portfolio-result-notes"><span>入金 ' + r.deposits + '笔</span><span>买入 ' + r.transactions.filter(t => t.side === 'buy').length + '笔</span><span>再平衡 ' + r.rebalances + '次</span><span>交易费用 ' + H.money(r.tradeCost, 2) + ' ' + unit + '</span><span>已实现盈利税 ' + H.money(r.capitalTax, 2) + ' ' + unit + '</span><span>分红税 ' + H.money(r.dividendTax, 2) + ' ' + unit + '</span><span>浮盈预留税 ' + H.money(r.taxReserve, 2) + ' ' + unit + '</span>' + (r.initialReserve > .005 ? '<span>待投入本金 ' + H.money(r.initialReserve, 2) + ' ' + unit + '</span>' : '') + (r.timingChanges ? '<span>择时切换 ' + r.timingChanges + '次</span>' : '') + '</div>' + (usesMa && r.strategy.insufficientMaDays ? '<div class="portfolio-warning">均线不足200个共同交易日的阶段按常规投入，未将缺历史视为下跌信号。</div>' : '') +
      H.card('持仓贡献', r.start + ' — ' + r.end + ' · ' + name + ' · 已减浮盈预留税', '<div class="portfolio-structure portfolio-end-structure"><h3>期末结构</h3>' + structure(r.holdings.map(h => ({ id: h.id, weight: h.actualWeight }))) + '</div>' + holdingTable, btn('导出持仓', 'export-holdings', 'btn portfolio-export')) + '<section class="card portfolio-yearly"><div class="card-head"><h2>年度表现</h2><span class="small">现金流中性 · 累计收益</span></div><div class="portfolio-year-grid">' + r.annual.map(y => '<div><span>' + y.year + '</span><strong class="num">' + H.pc(y.return) + '</strong><small>' + y.start.slice(5) + ' — ' + y.end.slice(5) + '</small></div>').join('') + '</div></section></div>';
  }
  function view(context) {
    H = context; ensureCatalog();
    if (!catalog) return '<section class="card pad"><h2>' + (loadError ? '标的库加载失败' : '正在载入组合标的库') + '</h2><p class="muted">' + H.esc(loadError || 'ETF、个股与基金每日历史按需载入。') + '</p>' + (loadError ? btn('重新加载', 'retry', 'btn primary') : '') + '</section>';
    const unknown = draft.positions.filter(p => !asset(p.id));
    return settings() + (unknown.length ? '<div class="portfolio-warning">' + unknown.length + '只保存的标的已不在当前研究对象中，请移除后模拟。</div>' : '') +
      '<div class="portfolio-builder">' + composition() + library() + '</div><div class="portfolio-run-bar"><div><span id="portfolio-dirty">' + (result && resultKey !== signature() ? '参数已改动，重新模拟后生效' : '') + '</span>' + (error || importError ? '<p class="negative" role="alert">' + H.esc(error || importError) + '</p>' : '') + '</div><div class="actions">' + btn(running ? '正在读取历史…' : '开始模拟', 'run', 'btn primary', running || exportingPdf || !draft.positions.length ? 'disabled' : '') + '</div></div>' +
      (draft.positions.some(p => (asset(p.id)?.leverage || 1) > 1 && p.weight > 0) ? '<div class="portfolio-warning">组合含每日杠杆ETF，长期表现取决于价格路径；杠杆并非长期收益的固定倍数。</div>' : '') + results();
  }
  function method() {
    H.openModal(H.modalTitle('组合回测口径', currency().name + ' · 每日历史 · 按所设税率') + '<div class="rule-list"><p><strong>价格与分红：</strong>境内基金及ETF使用净值与已发布每日收益，默认不计场内溢价；个股和海外ETF使用含分红复权股价。分红视为再投资，支持碎股，不模拟申购暂停、涨跌停或整手限制。</p><p><strong>汇率与交易日：</strong>本金、持续投入、成本与结果统一使用所选币种；切换币种保留输入数值，不自动兑换本金。资产币种不同时按当日或此前有效的美元兑人民币历史汇率换算；同币种直接使用原始价格。休市日沿用最近已发布价格；新增投入和再平衡推迟到所选资产都有真实报价的共同日期，不使用未来价格。</p><p><strong>投入与权重：</strong>本金与持续投入方式可分别选择。分批、回撤阶梯的待投入本金持有零息现金，再平衡不提前使用。季投、年投在周期首个共同交易日一次入金该周期预算，末期按窗口内月份数计；倍数定投改变实际入金金额。再平衡只调整已释放资金。</p><p><strong>回撤阶梯与原200日均线：</strong>使用独立目标组合按所选币种计价的收益路径，现金为零息，按目标权重每日复位；不受实际入金、择时仓位或投资者费用税款影响。前一个共同交易日收盘确定回撤和200日均线信号，下一共同交易日执行。回撤从模拟起点峰值计算；均线可使用窗口前真实历史。不足200次时按常规投入，原200日均线择时作用于整个已释放组合。</p><p><strong>现金补仓：</strong>前一共同收盘按实际持仓缺口确定每只标的的买入金额，下一共同收盘先执行已知金额，再处理当天入金和周期再平衡。只用已有现金，不按成交日价格重算金额；成交后比例可偏离目标。</p><p><strong>QQQ深熊确认：</strong>使用QQQ自身美元复权价，仅控制TQQQ对应资金。QQQ低于200日均线且距252日高点跌至少20%连续20日才退出，高于均线连续3日才恢复；按前一共同收盘时可知的QQQ状态执行。下一共同日计划与账户已执行仓位分别展示；若有更晚的QQQ收盘观察，单独列出。</p><p><strong>三种系统调仓：</strong>VIX恐慌恢复使用Cboe的VIX/VIX3M隐含波动指数控制TQQQ；三批相对强弱轮动在USD ETF与TQQQ之间分批调整股票资金；双重风险门合并VIX与QQQ状态。卖出比例对应的数量与买入金额在前一共同收盘确定，卖出回款到账后才用于后续买单；下一日计划与最近执行目标分别展示。</p><p><strong>费用与税：</strong>实际净值与复权股价已经反映产品持续年费，不再重复扣费，也不加回年费。买卖费率是统一自定义假设，未含最低佣金、换汇价差和申赎阶梯费率。投资者税使用所设综合税率；每日从持仓估值减去浮盈预留税，盈利下降时预留随之减少，不逐日重复扣款。期末清仓开启时扣实际清仓交易税费，并解除对应预留。跨境卖出和股息税后的渠道比较见“投资渠道”。</p><p><strong>收益：</strong>组合净值消除外部追加本金影响；税后盈亏为扣除浮盈预留税的期末资产减累计投入。首年年化按至少一年计算；不满一年不显示资金年化。对照线为同币种、同区间持有回报，使用同样税率和期末清仓设置，不计用户自定义交易费。</p><p><strong>持仓策略收益：</strong>逐笔使用实际买卖金额和费用。累计投入收益为（期末税后估值＋累计卖出净回款－累计买入含费金额）除以累计买入含费金额；反复买入的资金也计入分母。满一年按实际日期计算资金年化XIRR，不足一年显示累计投入收益、不外推；资金流找不到唯一年化解时留空。回撤和波动使用实际持仓的现金流中性净值，计入交易费、已发生税费及浮盈预留，追加和调仓转账本身不计收益。它们衡量持仓过程的风险，不是累计投入收益率的波动。</p></div><div class="actions"><a class="source-link" href="docs/portfolio-method.md" target="_blank" rel="noopener">完整公式与边界 ↗</a></div>');
  }
  function taxMethod() {
    H.openModal(H.modalTitle('组合税费口径', '中国大陆税收居民 · 2026-10-22更新') + '<div class="rule-list"><p><strong>美股普通股息的20%：</strong>是股息总税负。符合中美协定并向券商提交有效W-8BEN时，美国通常预扣10%；中国按20%计税，凭境外纳税凭证抵免10%后补税10%，合计20%。未享协定、ADR、REIT及特殊ETF分配需按实际性质与税单核定，不能一律套用20%，可在“特殊标的税率”中覆盖。</p><p><strong>卖出盈利税：</strong>大陆居民情景默认对美股正收益按20%估算。未卖出也按假设卖出计算：预留税＝max(0，持仓市值－预计卖出费－剩余成本)×税率，税后估值＝持仓市值＋现金－预留税。例如投入1,000美元、涨至1,200美元且无交易费，预留40美元，税后估值1,160美元。该预留只是估值扣减，不代表浮盈已产生实际纳税义务，不减少持股或可投资现金；实际卖出时解除对应预留并扣卖出税，避免重复。成本按所选币种移动平均计算，买入费用及税后分红再投入计入成本，逐笔亏损不抵减其他盈利。美元模式按美元收益估税，未模拟人民币申报折算差异。A股普通流通股卖出所得按现行暂免个税处理。</p><p><strong>境内分红：</strong>A股持股超过一年股息暂免，持股一个月以内为20%，超过一个月至一年为10%。默认只采用长期持有0%的简化情景，未自动重建逐笔持有期及卖出时的股息补税；短期买卖可单独设置股息税率。境内公募基金及ETF不在投资者层面追加个税，产品资产中已承担的税费仍保留在净值里。</p><p><strong>分红处理：</strong>复权行情已含税前分红再投，只按真实现金分配扣所设税额，再把净分红加入成本，避免重复增加分红或重复扣税。缺完整分红证据时停止应税回测，并指出缺失数据。</p><p><strong>不计税与期末清仓：</strong>“不计税”把模拟投资者税率设为0%，不会加回净值内已承担的税费。持仓估值已减浮盈预留税，但没有扣假设卖出的交易费本身；开启“期末清仓”会在末日卖出持仓并扣实际清仓交易费与正收益税；末日必须是所有持仓都有实际报价的共同交易日。休市日只能用于持仓估值，不能按沿用报价清仓；对照线同样要求当日实际报价。</p><p>这是统一有效税率情景，实际买卖与分红税、当前浮盈预留分别列示；未模拟申报延期、跨笔或跨年抵扣、外税结转、ADR费用和每次分配的税务分类。</p></div><div class="actions"><a class="source-link" href="https://www.irs.gov/pub/irs-trty/china.pdf" target="_blank" rel="noopener">中美税收协定第9条 ↗</a><a class="source-link" href="https://12366.chinatax.gov.cn/bzds/081/081-5-9.html" target="_blank" rel="noopener">境外所得抵免 ↗</a><a class="source-link" href="https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/201509/t418999.html" target="_blank" rel="noopener">A股股息持有期税率 ↗</a><a class="source-link" href="docs/portfolio-method.md" target="_blank" rel="noopener">完整依据与公式 ↗</a></div>');
  }
  function sources() {
    if (!result) return;
    const r = result;
    H.openModal(H.modalTitle('区间与来源', r.start + ' — ' + r.end) + '<div class="table-wrap"><table><thead><tr><th>标的</th><th>历史区间</th><th>收益来源</th></tr></thead><tbody>' + r.holdings.map(h => {
      const a = asset(h.id);
      return '<tr><td>' + H.esc(h.name) + '</td><td>' + h.first + '<br>' + h.asOf + '</td><td>' + (a?.sourceUrl && /^https:\/\//.test(a.sourceUrl) ? '<a class="source-link" href="' + H.esc(a.sourceUrl) + '" target="_blank" rel="noopener">' + (h.basis === 'provider_adjusted_close' ? '含分红复权股价' : '净值及已发布每日收益') + ' ↗</a>' : '缺来源链接') + (a?.refreshWarning ? '<span class="sub">' + H.esc(a.refreshWarning) + '</span>' : '') + '</td></tr>';
    }).join('') + (r.usesFx || r.benchmark?.usesFx ? '<tr><td>美元兑人民币</td><td>' + catalog.fx.first + '<br>' + catalog.fx.asOf + '</td><td><a class="source-link" href="https://finance.yahoo.com/quote/CNY%3DX/history/" target="_blank" rel="noopener">CNY=X实际日汇率 ↗</a></td></tr>' : '') + '</tbody></table></div><p class="note">开始日采用指定日前最近共同交易日；结束日采用共同历史内的实际估值日。休市沿用最近价格 ' + r.carriedPrices + '次，沿用汇率 ' + r.carriedFx + '日。价格最多沿用14日，汇率最多7日；超限停止回测。</p>');
  }
  function exportResult() {
    if (!result) return;
    const code = currency(result.config).code, amount = label => label + code;
    const rows = [['日期', amount('税后估值'), amount('累计投入'), amount('税后盈亏'), '组合净值', '组合累计收益%（现金流中性）', '组合年化收益%（现金流中性，首年至少一年）', '回撤%', amount('税费含当前预留'), amount('账户现金'), amount('待投入本金'), '择时仓位', '年费口径', '配置JSON', '全区间资金年化XIRR%', '资金年化缺项', amount('未减预留的资产'), amount('累计已发生税费'), amount('当前浮盈预留税')],
      ...result.curve.map(p => [p.day, p.value, p.contributed, p.profit, p.nav, p.totalReturn, p.annualReturn, p.drawdown, p.taxCost, p.cash, p.initialReserve, p.exposure, result.config.feeBasis, JSON.stringify(result.config), result.xirr, result.xirrMissing, p.grossValue, p.paidTax, p.taxReserve])];
    H.download('长衡-组合模拟-' + result.end + '.csv', M.csv(rows), 'text/csv;charset=utf-8');
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
    H.download('长衡-逐日策略状态-' + result.start + '_' + result.end + '.csv', M.csv([columns, ...records.map(row => columns.map(key => row[key] ?? ''))]), 'text/csv;charset=utf-8');
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
      H.toast('组合报告已导出');
    } catch (e) { H.toast('PDF 导出失败：' + e.message); }
    finally { exportingPdf = false; update(); }
  }
  function exportHoldings() {
    if (!result) return;
    const code = currency(result.config).code, amount = label => label + code;
    const rows = [['标的ID', '代码', '名称', '起始日', '结束日', '计价币种', '策略年化收益%', '累计投入收益%', '持仓净值最大回撤%', '持仓净值年化波动%', '目标权重%', '期末权重%', amount('期末税后估值'), amount('盈亏贡献'), amount('交易费'), amount('累计买入含费'), amount('累计卖出净回款'), '年化口径', '收益口径', amount('已实现盈利税'), amount('分红税'), amount('税费含当前预留'), '卖出盈利税率%', '分红综合税率%', amount('当前浮盈预留税'), amount('未减预留的市值')],
      ...result.holdings.map(h => [h.id, h.code, h.name, result.start, result.end, code, h.performance.annualReturn, h.performance.totalReturn, h.performance.mdd, h.performance.volatility, h.targetWeight, h.actualWeight, h.value, h.profit, h.transactionCost, h.performance.invested, h.performance.returned, h.performance.annualBasis, '实际投入、追加、再平衡；分红再投、年费、买卖税费及浮盈预留已含', h.capitalTax, h.dividendTax, h.taxCost, h.taxRates.gain, h.taxRates.dividend, h.taxReserve, h.grossValue])];
    if (result.cash > .005) rows.push(['cash:' + code, '', '现金', result.start, result.end, code, 0, 0, 0, 0, result.cashWeight, result.cash / result.value * 100, result.cash, 0, 0, '', '', '', '零息现金', 0, 0, 0, 0, 0, 0, result.cash]);
    H.download('长衡-持仓贡献-' + result.end + '.csv', M.csv(rows), 'text/csv;charset=utf-8');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('portfolio-', ''), val = button.dataset.value;
    switch (act) {
      case 'retry': loadError = ''; ensureCatalog(); break;
      case 'run': if (!exportingPdf) return run(); return;
      case 'add':
        if (pickerMode === 'benchmark') { draft.benchmarkId = val; pickerMode = 'holding'; }
        else if (asset(val) && !draft.positions.some(p => p.id === val)) draft.positions.push({ id: val, weight: draft.positions.length ? 0 : 100 });
        touch(); break;
      case 'remove': draft.positions = draft.positions.filter(p => p.id !== val); delete draft.tax.overrides[val]; touch(); break;
      case 'clear': draft.positions = []; draft.tax.overrides = {}; result = null; touch(); break;
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
      case 'benchmark': pickerMode = 'benchmark'; break;
      case 'no-benchmark': draft.benchmarkId = ''; pickerMode = 'holding'; touch(); break;
      case 'picker-holdings': pickerMode = 'holding'; break;
      case 'metric': metric = val; break;
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
      case 'tax-mainland': draft.tax = { ...P.taxConfig(), usCapitalGains: 20, usDividend: 20, liquidate: draft.tax.liquidate }; touch(); break;
      case 'tax-zero': draft.tax = { ...P.taxConfig(), liquidate: draft.tax.liquidate }; touch(); break;
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
    if (el.id === 'portfolio-addition-budget') {
      additionBudget = el.value.trim() ? Number(el.value) : NaN;
      const values = document.getElementById('portfolio-addition-values'), row = selectedDaily();
      if (values && row) values.innerHTML = additionMarkup(row);
      return false;
    }
    if (el.id === 'portfolio-daily-index' || el.id === 'portfolio-daily-date') return false;
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
      if (['initial', 'monthly'].includes(key)) syncStrategyHints();
      if (key.startsWith('tax-')) syncTax();
      return false;
    }
    return false;
  }
  function syncTax() {
    const summary = document.getElementById('portfolio-tax-summary');
    if (summary) summary.textContent = taxSummary();
    const scenario = taxScenario();
    document.querySelectorAll('.portfolio-tax-presets button').forEach(button => {
      const active = button.dataset.action === 'portfolio-tax-' + scenario;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
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
        H.setFeeBasis(next.feeBasis); draft = { ...defaults, ...next }; delete draft.feeBasis;
        importError = ''; result = null; touch();
      } catch (e) { importError = '配置导入失败：' + e.message; }
      update(); return;
    }
    if (el.id === 'portfolio-hide-boards') { hideBoards = el.checked; H.resetList(); update(); return; }
    if (el.id === 'portfolio-liquidate') { draft.tax.liquidate = el.checked; touch(); return; }
    if (el.dataset.portfolioFee) {
      const code = el.dataset.portfolioFee;
      if (!el.value.trim()) delete draft.feeOverrides[code];
      else if (el.checkValidity() && Number.isFinite(Number(el.value))) draft.feeOverrides[code] = Number(el.value);
      else { H.toast('请输入0至99之间的有效年费率'); return; }
      touch(); update(); return;
    }
    if (el.dataset.portfolioWeight || el.dataset.portfolioAmount || el.dataset.portfolioField || el.dataset.portfolioTaxAsset) {
      handleInput(el);
      if (el.dataset.portfolioField === 'monthly' && !el.value.trim() && !el.validity.badInput) el.value = '0';
    }
  }
  function showPoint(event) {
    const plot = event.target.closest?.('[data-portfolio-plot]');
    if (!plot || !result) return;
    const box = plot.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left - box.width * 63 / 920) / (box.width * 841 / 920)));
    const index = Math.round(fraction * (result.curve.length - 1)), point = result.curve[index];
    const value = metric === 'amount' ? point.value : metric === 'drawdown' ? point.drawdown : H.annual ? point.annualReturn : point.totalReturn;
    const unit = currency(result.config).unit;
    const format = v => metric === 'amount' ? H.money(v, 2) + ' ' + unit : H.pct(v);
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
      if (metric !== 'amount') entries.push(['税后估值', H.money(point.value, 2) + ' ' + unit], ['累计投入', H.money(point.contributed, 2) + ' ' + unit]);
      entries.push(['税后盈亏', H.money(point.profit, 2) + ' ' + unit]);
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
