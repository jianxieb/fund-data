(function () {
  'use strict';
  const M = window.Changheng;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v, dec = 0) => M.finite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';
  const pct = (v, digits = 2, signed = true) => M.finite(v) ? (signed && v > 0 ? '+' : '') + v.toFixed(digits) + '%' : '—';
  const pc = (v, digits = 2) => '<span class="' + (M.finite(v) ? v < 0 ? 'negative' : 'positive' : 'muted') + '">' + pct(v, digits) + '</span>';
  const badge = (text, type = '') => '<span class="badge ' + type + '">' + esc(text) + '</span>';
  const safeUrl = url => /^https:\/\//i.test(url || '') ? esc(url) : '#quality';
  const extLink = (url, text) => /^https:\/\//i.test(url || '') ? '<a class="source-link" href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + ' ↗</a>' : '<span class="muted">' + esc(text) + '：链接未收录</span>';
  const verifiedReturn = f => !!f.performanceVerifiedAt || f.returnBasis === 'provider_daily_return_or_explicit_actions';
  const metricDate = (f, kind) => f[kind + 'AsOf'] || '未独立记录';
  const stamp = v => v && /T/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : v || '未记录';
  const basisText = value => ({ price_index: '价格指数，不含现金分红再投资', provider_adjusted_close: '供应商复权收盘价', provider_daily_return_or_explicit_actions: '根据每日净值及分红、拆分事件复算' }[value] || value || '口径未记录');
  const action = (text, act, cls = 'btn', extra = '') => '<button type="button" class="' + cls + '" data-action="' + act + '" ' + extra + '>' + text + '</button>';
  function selectMenu(id, label, options, value, cls = '') {
    const current = options.find(([key]) => key === value) || options[0] || ['', '暂无可选项'];
    return '<details class="select-menu ' + cls + '"><summary id="' + esc(id) + '" aria-label="' + esc(label + '：' + current[1]) + '"><span>' + esc(current[1]) + '</span></summary>' +
      '<div class="select-menu-list" role="group" aria-label="' + esc(label) + '">' + options.map(([key, text]) => action(esc(text), 'menu-choice', 'select-menu-option' + (key === value ? ' active' : ''), 'data-menu="' + esc(id) + '" data-value="' + esc(key) + '" aria-label="' + esc(text) + '" aria-current="' + (key === value) + '"')).join('') + '</div></details>';
  }
  const years = [1, 2, 3, 5, 10], titles = { overview: '研究总览', indices: '指数观察', funds: '基金研究', stocks: '个股深入', reports: '深入报告', strategy: '投入策略', 'buy-location': '投资渠道', quality: '数据与方法' };
  const funds = M.dedupeFunds(window.FUNDS, window.EXTRA);
  const policy = window.SCREEN_POLICY || { shortlist: [], byCode: {}, rules: [], counts: {} };
  const shortlist = new Set(policy.shortlist || []);
  const VIEW = 'changheng.research-view.v2';
  const columnNames = { manager: '现任经理', risk: '回撤与波动率', status: '申购与限额', size: '规模', fees: '持续费率', trade: '买入与卖出费率', nav: '净值与日涨跌', inception: '成立日期', quote: '交易价与溢价', dates: '数据日期与复核状态' };
  const defaultColumns = ['manager', 'risk', 'status', 'size', 'fees', 'trade', 'nav', 'inception', 'dates'];
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(VIEW) || '{}') || {}; } catch (_) {}
  const defaults = { minA3: 5, minA5: 8, minHistoryYears: 7, minScale: 1, minManagerYears: 5, ...policy.defaults };
  const state = {
    route: 'overview', annual: prefs.annual !== false, periods: M.visiblePeriods(prefs.periods),
    columns: new Set(Array.isArray(prefs.columns) ? prefs.columns.filter(x => Object.hasOwn(columnNames, x)) : defaultColumns),
    indexTab: 'us', indexSort: 'default', indexDescending: true, crossTypes: new Set(), crossChannels: new Set(), crossQuery: '', crossPremium: null, crossPurchasable: false, crossBasis: 'nav', crossSort: 'default', crossDesc: true, crossPage: 1, crossSelected: new Set(), currency: 'usd', benchmarkType: 'total', benchmarkCurrency: 'cny',
    fundTab: 'equity', poolCategory: 'all', query: '', channel: 'all', purchasable: false,
    screen: { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null }, equityAll: false,
    fundSort: 'default', descending: true, page: 1, selected: new Set(),
    stockTab: 'quality', stockQuery: '', stockCategory: 'all', stockView: 'financials', stockSort: 'default', stockDesc: true, reportCode: null, reportQuery: '',
    stratPanel: 'initial', stratView: 'results', stratYear: '2010', stratAsset: 'SPY', stratMethod: 'lump_sum',
    stratCompare: 'assets', stratMetric: 'amount', leverage: true, showLeverageAssets: false, chartHidden: new Set(),
    buyFamily: 'sp', buyYears: 5, buyPlan: 'lump', buyBasis: 'nav', buyLumpAmount: 100000, buyMonthlyAmount: 3000,
    buyFees: { usCommission: 0.02, usMinimum: 1, fxSpread: 0.15,
      exchangeCommission: 0.025, exchangeMinimum: 5, subscription: 0.12, redemption: 0,
      usDividendTax: 10, cnDividendTax: 20, capitalGainsTax: 20 },
    buyFundFees: { '050025': { subscription: 0.12, redemption: 0 }, '270042': { subscription: 0.13, redemption: 0 }, '040046': { subscription: 0.12, redemption: 0 } }
  };
  let lastFocus = null, toastTimer, searchTimer, activeCurve = null;
  let screenOpen = false;
  function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200); }
  function savePrefs() { try { localStorage.setItem(VIEW, JSON.stringify({ annual: state.annual, periods: state.periods, columns: [...state.columns] })); } catch (_) {} }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function head(eyebrow, title, subtitle, actions = '') {
    return '<div class="page-head"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + subtitle + '</p></div><div class="page-actions">' + actions + '</div></div>';
  }
  function stat(label, value, unit, foot, tag = '') {
    return '<div class="stat"><div class="stat-top"><span>' + label + '</span>' + tag + '</div><div class="stat-value num">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div><div class="stat-foot">' + foot + '</div></div>';
  }
  function card(title, sub, body, right = '', foot = '') {
    return '<section class="card"><div class="card-head"><div><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + right + '</div>' + body + (foot ? '<div class="panel-foot">' + foot + '</div>' : '') + '</section>';
  }
  function annualControl() { return '<div class="segmented" aria-label="收益口径">' + action('年化收益', 'annual', state.annual ? 'active' : '', 'data-value="1" aria-pressed="' + state.annual + '"') + action('累计收益', 'annual', !state.annual ? 'active' : '', 'data-value="0" aria-pressed="' + !state.annual + '"') + '</div>'; }
  function duration(record, y) {
    const periods = record && (record.returnPeriods || record.periods);
    const period = periods && periods.find(p => p.years === y);
    const start = period ? period.start : record && record.baseDates && record.baseDates[years.indexOf(y)];
    const end = period ? period.end : record && (record.returnAsOf || record.asof || record.asOf);
    return M.yearsBetween(start, end) || y;
  }
  function ret(v, y, record) { return state.annual ? M.annualized(v, duration(record, y)) : v; }
  function periodHead(y) { return '近' + y + '年' + (state.annual ? '年化' : '累计'); }
  function periodControl() {
    return '<fieldset class="period-control"><legend>显示收益周期</legend>' + years.map(y => '<label><input type="checkbox" data-period="' + y + '"' + (state.periods.includes(y) ? ' checked' : '') + '>' + y + '年</label>').join('') + '</fieldset>';
  }
  function returnControls() {
    return '<div class="return-controls">' + periodControl() + annualControl() + '</div>';
  }
  function benchmark() {
    return (window.BM || []).find(b => state.benchmarkType === 'total' ? b.n === 'SPY' : b.n === '标普500指数');
  }
  function benchmarkPanel() {
    const b = benchmark(), r = b && b[state.benchmarkCurrency];
    const shown = state.route === 'overview' ? years : state.periods;
    return '<section class="benchmark-panel' + (state.route === 'funds' ? ' compact' : '') + '" aria-label="标普500参照"><div class="benchmark-title"><div><span class="eyebrow">THE BENCHMARK</span><h2>标普500参照</h2></div><div class="benchmark-controls">' +
      selectMenu('benchmark-type', '标普500回报口径', [['total', 'SPY ETF · 含分红复权'], ['price', '标普500 · 价格指数']], state.benchmarkType) +
      selectMenu('benchmark-currency', '标普500计价币种', [['cny', '人民币'], ['usd', '美元']], state.benchmarkCurrency, 'short') + '</div></div>' +
      '<div class="benchmark-values">' + shown.map(y => '<div><span>' + periodHead(y) + '</span><strong class="num">' + pc(ret(r && r[years.indexOf(y)], y, b)) + '</strong></div>').join('') + '</div><div class="benchmark-foot"><span>截至 ' + esc(b && b.asOf || '未记录') + ' · ' + (state.route === 'funds' ? state.benchmarkType === 'total' ? 'SPY含分红、含产品费用' : '价格指数，不含分红' : state.benchmarkType === 'total' ? 'SPY为可投资ETF参照，含产品费用；不是指数全收益序列。' : '价格指数不含分红，不与基金含分红回报直接计算差值。') + '</span>' + action('查看区间与来源', 'benchmark-detail', 'text-link small') + '</div></section>';
  }
  function entryArrow() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>'; }
  function home() {
    const overseasFunds = funds.filter(f => f.origin === 'overseas' && !f.active);
    const qualityStocks = (window.STOCKS || []).filter(s => M.stockMatches(s, 'quality'));
    const growthStocks = (window.STOCKS || []).filter(s => M.stockMatches(s, 'growth'));
    const markets = [
      ['标普500', (window.BM || []).find(b => b.n === '标普500指数')],
      ['纳斯达克100', (window.BM || []).find(b => b.n === '纳斯达克100指数')],
      ['沪深300', (window.INDEX_DATA || []).find(b => b.c === '000300')],
      ['中证500', (window.INDEX_DATA || []).find(b => b.c === '000905')]
    ];
    const marketOverview = '<section class="home-markets" aria-label="市场一览"><div class="home-section-title"><h2>市场一览</h2><span>近5年年化 · 人民币 · 价格指数</span></div><div class="home-market-grid">' + markets.map(([name, b]) => {
      const r = b && (b.cny || b.r);
      return '<div class="home-market"><span>' + name + '</span><strong class="num">' + pc(M.annualized(r?.[3], duration(b, 5))) + '</strong><small>截至 ' + esc(b?.asOf || b?.asof || '—') + '</small></div>';
    }).join('') + '</div></section>';
    const entries = [
      ['indices', 'us', '海外指数', '标普500、纳指100与海外 ETF，连接境内可买的指数基金。', '01', '市场与工具', overseasFunds.length + '只跨境基金', '指数表现 / 基金成本'],
      ['funds', 'equity', '长期主动权益基金', '多年回报、经理任期与回撤，放在一起衡量。', '02', '基金与经理', funds.filter(f => fundTabPass(f, 'equity')).length + '只当前入选', '长期收益 / 经理任期'],
      ['funds', 'income', '红利、债券与固收', '从股息到利息，观察不同收益来源的表现与风险。', '03', '收益与防守', funds.filter(f => fundTabPass(f, 'income')).length + '只观察产品', '红利权益 / 债券固收'],
      ['strategy', 'initial', '投入策略', '同一资产，比较一次投入、分批投入与定投的实际结果。', '04', '投入方式', '3种投入方式', '资金效率 / 回撤路径']
    ];
    return head('LONG-TERM INVESTMENT RESEARCH', '长期表现，值得仔细比较。', '在市场、公司与投入方式之间，找到自己的长期尺度。') + marketOverview +
      '<div class="home-section-title home-research-title"><h2>研究方向</h2><span>回报 · 风险 · 成本</span></div><div class="research-entry-grid home-four">' + entries.map(([route, id, title, desc, no, group, count, topics]) =>
        '<a class="home-entry" href="#' + route + '" data-home-tab="' + id + '"><span class="home-entry-top"><span class="eyebrow">' + no + ' / ' + group + '</span><span class="home-entry-arrow" aria-hidden="true">' + entryArrow() + '</span></span><span class="home-entry-body"><strong>' + title + '</strong><span>' + desc + '</span></span><span class="home-entry-foot"><b>' + count + '</b><span>' + topics + '</span></span></a>').join('') + '</div>' +
      '<div class="home-secondary"><a class="home-secondary-card" href="#stocks" data-home-tab="quality"><span class="eyebrow">COMPANY RESEARCH</span><span class="home-secondary-title"><strong>个股深入</strong><span class="home-entry-arrow" aria-hidden="true">' + entryArrow() + '</span></span><p>' + qualityStocks.length + ' 家长期优质企业 · ' + growthStocks.length + ' 家高质成长股，结合深入报告研究业务、估值与风险。</p><span class="home-tags"><span>长期质量</span><span>成长阶段</span><span>盈利与股息</span></span></a>' +
      '<a class="home-secondary-card" href="#buy-location"><span class="eyebrow">INVESTMENT CHANNELS</span><span class="home-secondary-title"><strong>投资渠道</strong><span class="home-entry-arrow" aria-hidden="true">' + entryArrow() + '</span></span><p>同样投资标普500与纳指100，比较不同渠道扣除费用与税款后的结果。</p><span class="home-tags"><span>海外 ETF</span><span>境内场内</span><span>境内场外</span></span></a></div>';
  }
  function indexRows() {
    return state.indexTab === 'cn' ? window.INDEX_DATA || [] : window.BM || [];
  }
  function indices() {
    const domestic = window.INDEX_DATA || [], baseRows = indexRows();
    const tabNames = [['us', '海外指数'], ['crossborder', '境内跨境指数基金'], ['cn', '国内指数']];
    const metric = (r, key) => {
      const isDomestic = domestic.includes(r), c = isDomestic ? 'cny' : state.currency;
      const risk = isDomestic ? { mdd: r.mdd5, vol: r.vol5 } : r[c === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
      if (key.startsWith('return:')) return ret((isDomestic ? r.r : r[c])?.[years.indexOf(+key.split(':')[1])], +key.split(':')[1], r);
      if (key === 'mdd') return risk.mdd;
      if (key === 'vol') return risk.vol;
      if (key === 'date') return Date.parse(r.asof || r.asOf || '') || null;
      return r.n || '';
    };
    const sorted = input => {
      const rows = input.map(r => ({ r, i: baseRows.indexOf(r) }));
      if (state.indexSort !== 'default') rows.sort((a, b) => {
      const av = metric(a.r, state.indexSort), bv = metric(b.r, state.indexSort);
      const compared = state.indexSort === 'name' ? (state.indexDescending ? -1 : 1) * String(av).localeCompare(String(bv), 'zh-CN') : M.compareNullable(av, bv, state.indexDescending);
      return compared || a.i - b.i;
      });
      return rows;
    };
    const sortHead = (label, key) => '<th aria-sort="' + (state.indexSort === key ? state.indexDescending ? 'descending' : 'ascending' : 'none') + '">' + action(label + (state.indexSort === key ? state.indexDescending ? ' ↓' : ' ↑' : ''), 'index-sort', '', 'data-value="' + key + '"') + '</th>';
    const indexTable = (input, label, description) => {
      const rowsHtml = sorted(input).map(({ r, i }) => {
      const isDomestic = domestic.includes(r), displayCurrency = isDomestic ? 'cny' : state.currency;
      const returns = isDomestic ? r.r : r[displayCurrency];
      const risk = isDomestic ? { mdd: r.mdd5, vol: r.vol5 } : r[displayCurrency === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
      return '<tr><td>' + action(esc(r.n), 'index-detail', 'text-link', 'data-value="' + i + '"') + (r.status === 'unavailable' ? badge('缺原始日线', 'warn') : '') + '<span class="sub">' + esc(isDomestic ? '国内价格指数' : /指数/.test(r.tp) ? '海外价格指数' : '海外 ETF') + ' · ' + esc(r.c || r.symbol || r.tp || '') + '</span></td>' +
        state.periods.map(y => '<td>' + pc(ret(returns && returns[years.indexOf(y)], y, r)) + ((r.backfilledPeriods || []).includes(y) ? '<span class="sub">含发布前回溯</span>' : '') + '</td>').join('') +
        '<td>' + pc(risk.mdd, 1) + '</td><td>' + pct(risk.vol, 1, false) + '</td><td>' + esc(r.asof || r.asOf || (r.status === 'unavailable' ? '—' : '待核验')) + '</td></tr>';
      }).join('');
      return '<section class="card index-section"><div class="index-section-head"><div><h2>' + label + '</h2><p>' + description + '</p></div><span>' + input.length + '条</span></div><div class="table-wrap"><table class="research-table"><thead><tr>' + sortHead('指数 / 产品', 'name') + state.periods.map(y => sortHead(periodHead(y), 'return:' + y)).join('') + sortHead('5年最大回撤', 'mdd') + sortHead('5年波动率', 'vol') + sortHead('截至日', 'date') + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></section>';
    };
    return head('MARKET OBSERVATORY', '指数观察', '指数、海外 ETF 与境内跨境基金分别查看。') +
      '<div class="tabs" role="tablist">' + tabNames.map(([id, n]) => action(n, 'index-tab', state.indexTab === id ? 'active' : '', 'data-value="' + id + '" role="tab" aria-selected="' + (state.indexTab === id) + '"')).join('') + '</div>' +
      (state.indexTab === 'crossborder' ? crossborderView() :
      '<div class="index-controls"><div class="index-currency">' + (state.indexTab === 'us' ? '<span>计价币种</span><div class="segmented">' + action('美元', 'currency', state.currency === 'usd' ? 'active' : '', 'data-value="usd"') + action('人民币', 'currency', state.currency === 'cny' ? 'active' : '', 'data-value="cny"') + '</div>' : '<span>人民币口径</span>') + (state.indexSort !== 'default' ? action('恢复默认顺序', 'index-sort-reset', 'text-link small') : '') + '</div>' + returnControls() + '</div>' +
      (state.indexTab === 'cn' ? indexTable(domestic, '国内指数', '价格指数 · 不含分红') : indexTable(baseRows.filter(b => /指数/.test(b.tp)), '海外指数', '价格指数 · 不含分红') + indexTable(baseRows.filter(b => !/指数/.test(b.tp)), '海外 ETF', '复权产品表现 · 已包含产品持续费用')));
  }

  const crossPool = () => funds.filter(f => f.origin === 'overseas' && !f.active);
  const crossEvidence = code => window.CROSSBORDER_DATA?.byCode?.[code];
  const crossPerformance = f => M.crossborderPerformance(f, crossEvidence(f.c), state.crossBasis);
  function crossRows() {
    const rows = crossPool().filter(f => M.crossborderMatches(f, { types: [...state.crossTypes], channels: [...state.crossChannels], query: state.crossQuery, premiumMax: state.crossPremium, purchasable: state.crossPurchasable }));
    const metric = f => {
      const perf = crossPerformance(f), key = state.crossSort;
      if (key.startsWith('return:')) { const y = +key.split(':')[1]; return ret(perf.r?.[years.indexOf(y)], y, perf); }
      if (key === 'date') return perf.returnAsOf;
      if (key === 'mdd5') return perf.mdd5;
      return f[key];
    };
    if (state.crossSort !== 'default') rows.sort((a, b) => M.compareNullable(metric(a), metric(b), state.crossDesc));
    return rows;
  }
  function distributionLabel(code) {
    const a = crossEvidence(code)?.actions;
    if (!a || a.status !== 'recorded') return '缺分红记录';
    return a.cash.length ? a.cash.length + '次现金分红' : a.splits.length ? '未见分红 · 有拆分' : '未见现金分红';
  }
  function crossborderView() {
    const pool = crossPool(), rows = crossRows(), pages = Math.max(1, Math.ceil(rows.length / 15));
    state.crossPage = Math.max(1, Math.min(state.crossPage, pages));
    const page = rows.slice((state.crossPage - 1) * 15, state.crossPage * 15);
    const chips = (values, selected, act) => action('全部', act, 'filter-chip' + (!selected.size ? ' active' : ''), 'data-value="all" aria-pressed="' + !selected.size + '"') + values.map(([key, name]) => action(esc(name), act, 'filter-chip' + (selected.has(key) ? ' active' : ''), 'data-value="' + esc(key) + '" aria-pressed="' + selected.has(key) + '"')).join('');
    const filters = '<section class="cross-filters" aria-label="跨境基金筛选"><div class="cross-filter-row"><span>跟踪指数 <small>可多选</small></span><div class="filter-chips">' + chips([...new Set(pool.map(f => f.ix))].map(ix => [ix, ix]), state.crossTypes, 'cross-type') + '</div></div><div class="cross-filter-row"><span>交易渠道 <small>可多选</small></span><div class="filter-chips">' + chips([['exchange', '场内 ETF'], ['off', '场外基金']], state.crossChannels, 'cross-channel') + '</div></div><div class="cross-filter-row"><span>快照溢价</span><div class="filter-chips">' + [['all', '不限'], ['0', '折价 / 平价'], ['2', '≤ 2%'], ['5', '≤ 5%']].map(([v, label]) => action(label, 'cross-premium', 'filter-chip' + ((v === 'all' ? state.crossPremium === null : state.crossPremium === +v) ? ' active' : ''), 'data-value="' + v + '" aria-pressed="' + (v === 'all' ? state.crossPremium === null : state.crossPremium === +v) + '"')).join('') + '<label class="check-label cross-available"><input type="checkbox" id="cross-purchasable"' + (state.crossPurchasable ? ' checked' : '') + '>场外可申购</label></div></div><div class="cross-filter-foot"><label class="cross-search"><input type="search" id="cross-search" aria-label="搜索跨境基金名称或代码" placeholder="搜索基金名称或代码" value="' + esc(state.crossQuery) + '"></label><div>' + action('重置筛选', 'cross-reset', 'text-link small') + action('溢价与分红口径', 'cross-method', 'btn sm') + '</div></div></section>';
    const basis = '<div class="cross-basis"><span>场内收益</span><div class="segmented" aria-label="场内基金收益口径">' + [['nav', '净值 · 剔除溢价'], ['market', '成交价 · 含溢价']].map(([v, label]) => action(label, 'cross-basis', state.crossBasis === v ? 'active' : '', 'data-value="' + v + '" aria-pressed="' + (state.crossBasis === v) + '"')).join('') + '</div></div>';
    const th = (label, key) => '<th aria-sort="' + (state.crossSort === key ? state.crossDesc ? 'descending' : 'ascending' : 'none') + '">' + action(label + (state.crossSort === key ? state.crossDesc ? ' ↓' : ' ↑' : ''), 'cross-sort', '', 'data-value="' + key + '"') + '</th>';
    const table = '<section class="card index-section"><div class="cross-results-head"><div><h2>' + rows.length + '<small> / ' + pool.length + '只基金</small></h2><p>人民币 · 分红再投 · 已含产品持续费用' + (state.crossPremium !== null ? ' · 溢价筛选仅作用于场内，缺报价则排除' : '') + '</p></div>' + action('导出筛选结果', 'cross-export', 'btn sm') + '</div><div class="table-wrap cross-table-wrap" tabindex="0" aria-label="跨境基金研究表，可横向滚动"><table class="research-table crossborder-table"><thead><tr><th>基金 / 渠道</th>' + state.periods.map(y => th(periodHead(y), 'return:' + y)).join('') + th('持续费率 / 年', 'knownOngoingFee') + th('快照溢价', 'prem') + '<th>分红记录</th><th>买入费用 / 状态</th>' + th('5年最大回撤', 'mdd5') + th('收益截至', 'date') + '</tr></thead><tbody>' + page.map(f => {
      const perf = crossPerformance(f), selected = state.crossSelected.has(f.c);
      return '<tr><td><div class="fund-name-row">' + action(esc(f.n), 'fund-detail', 'text-link', 'data-code="' + f.c + '"') + action(selected ? '✓' : '+', 'cross-select', 'fund-compare' + (selected ? ' selected' : ''), 'data-code="' + f.c + '" aria-label="' + (selected ? '移出对比 ' : '加入对比 ') + esc(f.n) + '" aria-pressed="' + selected + '"') + '</div><span class="sub">' + f.c + ' · ' + (f.exchange ? '场内 ETF' : '场外') + ' · ' + esc(f.ix) + '</span></td>' + state.periods.map(y => '<td>' + pc(ret(perf.r?.[years.indexOf(y)], y, perf)) + '</td>').join('') + '<td>' + (M.finite(f.knownOngoingFee) ? (f.feeCoverage === 'complete' ? '' : '≥') + pct(f.knownOngoingFee, 2, false) : '—') + '</td><td>' + (f.exchange ? (M.finite(f.prem) ? '<span class="' + (f.prem > 5 ? 'negative' : '') + '">' + pct(f.prem) + '</span><span class="sub">' + esc((f.priceAsOf || f.quotedAt || '').slice(0, 10)) + '</span>' : '缺报价') : '不适用') + '</td><td>' + action(distributionLabel(f.c), 'fund-actions', 'text-link small', 'data-code="' + f.c + '"') + '<span class="sub">' + (perf.missing ? '收益序列缺失' : '含分红总回报') + '</span></td><td>' + buyFee(f) + '<span class="sub">' + (f.exchange ? '场内交易' : esc(f.st || '状态未收录') + (f.lm && f.lm !== '--' && !/暂停/.test(f.st || '') ? ' · ' + esc(f.lm) : '')) + '</span></td><td>' + pc(perf.mdd5, 1) + '</td><td>' + esc(perf.returnAsOf || '缺成交价历史') + '<span class="sub">' + (f.exchange && state.crossBasis === 'market' ? '成交价复权' : '净值总回报') + '</span></td></tr>';
    }).join('') + (!page.length ? '<tr><td colspan="' + (7 + state.periods.length) + '"><div class="empty">没有符合条件的基金' + action('重置筛选', 'cross-reset', 'btn sm') + '</div></td></tr>' : '') + '</tbody></table></div><div class="cross-pagination"><span>' + (rows.length ? (state.crossPage - 1) * 15 + 1 : 0) + '–' + Math.min(state.crossPage * 15, rows.length) + ' / ' + rows.length + '</span><div>' + action('上一页', 'cross-page', 'btn sm', 'data-value="-1"' + (state.crossPage === 1 ? ' disabled' : '')) + '<span>' + state.crossPage + ' / ' + pages + '</span>' + action('下一页', 'cross-page', 'btn sm', 'data-value="1"' + (state.crossPage === pages ? ' disabled' : '')) + '</div></div></section>';
    const comparison = state.crossSelected.size ? '<div class="compare-bar"><span>已选 ' + state.crossSelected.size + ' / 4 · ' + [...state.crossSelected].join(' · ') + '</span>' + action('清空', 'cross-clear', 'quiet') + action('并排比较', 'cross-compare', 'btn', state.crossSelected.size < 2 ? 'disabled' : '') + '</div>' : '';
    return filters + '<div class="index-controls">' + basis + returnControls() + '</div>' + (state.crossBasis === 'market' ? '<p class="basis-note">场内成交价回报包含买卖两端溢价变化；场外仍按净值。分红均再投，交易佣金另见投资渠道。</p>' : '') + table + comparison;
  }
  function distributionDetails(a, currency = '元') {
    if (!a || a.status !== 'recorded') return '<p class="notice warn">缺少已记录的分红事件；不能据此判断从未分红。</p>';
    const cash = a.cash || [], splits = a.splits || [];
    return '<p class="notice">收益已计入现金分红再投资，拆分仅调整份额。' + (currency === '美元' ? '投资渠道另按设定税率扣除美股股息税。' : '基金净值已包含底层证券股息及基金承担的税费。') + '</p>' + detailGrid([['已收录现金分红', cash.length + '次'], ['事件截至', esc(a.through)], ['最近现金分红', cash.length ? esc(cash.at(-1).date) + ' · 每份 ' + money(cash.at(-1).perUnit, 4) + currency : '所收录历史未见现金分红'], ['拆分记录', splits.length ? splits.map(e => esc(e.date) + ' · 1份变为' + money(e.factor, 3) + '份').join('<br>') : '所收录历史未见拆分']]) +
      (cash.length ? '<div class="table-wrap"><table><thead><tr><th>除息日</th><th>每份现金分红 / ' + currency + '</th><th>收益处理</th></tr></thead><tbody>' + [...cash].reverse().map(e => '<tr><td>' + esc(e.date) + '</td><td>' + money(e.perUnit, 4) + '</td><td>已计入再投回报</td></tr>').join('') + '</tbody></table></div>' : '') + '<div class="actions">' + extLink(a.source, '分红 / 拆分原始记录') + (a.verifiedEvents || []).map(e => extLink(e.sourceUrl, e.date + ' 官方公告')).join('') + '</div><p class="note">按所收录历史展示' + (a.observedAt ? '，记录采集于 ' + esc(a.observedAt) : '') + '；不把份额拆分当作分红收益。</p>';
  }
  function openCrossMethod() {
    openModal(modalTitle('溢价与分红口径', '境内跨境指数基金 · 人民币份额') + '<div class="rule-list"><div class="rule-item"><span class="rule-number">01</span><p><strong>默认剔除溢价</strong><br>使用基金分红再投净值，比较基金本身的回报。切换“成交价”后使用复权收盘价，计入买入和卖出时的溢价变化。剔除溢价不是把当前溢价从历史收益直接减掉。</p></div><div class="rule-item"><span class="rule-number">02</span><p><strong>快照溢价单独筛选</strong><br>报价相对当时 IOPV 的溢价；受时差及估值时点影响。它不参与默认净值回报计算，也不是实时可成交报价。开启上限后，场内缺报价的产品被排除，场外保留。</p></div><div class="rule-item"><span class="rule-number">03</span><p><strong>现金分红全部再投</strong><br>国泰 160213 的现金分红已计入净值总回报；国泰 513100 收录的是 2022-01-13 的 1拆5，不能算成现金分红。逐只点击“分红记录”查看事件与来源。历史不足的周期留空。</p></div><div class="rule-item"><span class="rule-number">04</span><p><strong>费用与实际成交</strong><br>净值和复权价已包含产品持续费用；此表不扣投资者佣金、申赎费。逐笔费率、定投和税后结果在投资渠道中计算。ETF 通常不能按净值直接成交。</p></div></div>' + '<div class="actions">' + extLink('https://static.cninfo.com.cn/finalpage/2022-01-14/1212179309.PDF', '国泰 513100 拆分公告') + extLink('https://st.gtfund.com/report/2025/05/国泰纳斯达克100指数证券投资基金分红公告.pdf', '国泰 160213 分红公告') + '</div>');
  }
  function openCrossCompare() {
    const selected = [...state.crossSelected].map(c => funds.find(f => f.c === c)).filter(Boolean);
    if (selected.length < 2) return;
    const row = (label, fn) => '<tr><td>' + label + '</td>' + selected.map(f => '<td>' + fn(f) + '</td>').join('') + '</tr>';
    openModal(modalTitle('跨境基金对比', (state.crossBasis === 'nav' ? '场内按净值 · 剔除溢价' : '场内按成交价 · 含溢价') + ' · 全部含分红再投') + '<div class="table-wrap"><table class="compare-table"><thead><tr><th>研究维度</th>' + selected.map(f => '<th>' + esc(f.n) + '<span class="sub">' + f.c + '</span></th>').join('') + '</tr></thead><tbody>' + row('指数 / 渠道', f => esc(f.ix) + ' / ' + (f.exchange ? '场内' : '场外')) + years.map((y, i) => row(periodHead(y), f => { const p = crossPerformance(f); return pc(ret(p.r?.[i], y, p)); })).join('') + row('收益截至', f => esc(crossPerformance(f).returnAsOf || '缺成交价历史')) + row('持续费率 / 年', f => (f.feeCoverage === 'complete' ? '' : '≥') + pct(f.knownOngoingFee, 2, false)) + row('快照溢价', f => f.exchange ? pct(f.prem) : '不适用') + row('已收录分红', f => distributionLabel(f.c)) + row('买入费用', buyFee) + row('申购状态', f => f.exchange ? '场内交易' : esc(f.st || '未记录')) + '</tbody></table></div><p class="note">各产品实际收益区间在详情中查看；不同截至日不直接计算跟踪差异。</p>');
  }
  function fundTabPass(f, tab) {
    const rule = (policy.byCode || {})[f.c] || {};
    if (tab === 'equity') return f.active && M.equityQualifies(rule, { ...defaults, ...state.screen }) && (state.equityAll || shortlist.has(f.c) || f.overseasExposure);
    if (tab === 'overseas') return rule.region ? ['overseas', 'global', 'cross_border', 'mixed', 'cn_hk'].includes(rule.region) : f.overseasExposure;
    if (tab === 'dividend') return rule.category === 'dividend' || f.dividend;
    if (tab === 'income') return rule.category === 'dividend' || f.dividend || rule.category === 'fixed_income' || /债券|偏债|货币|固收[+＋]/.test((f.n || '') + ' ' + (f.ix || ''));
    if (tab === 'theme') return rule.category === 'theme';
    if (tab === 'commodity') return rule.category === 'commodity' || f.asset === 'gold';
    if (tab === 'passive') return /指数|ETF|联接/.test((f.n || '') + ' ' + (f.ix || ''));
    if (tab === 'fixed') return rule.category === 'fixed_income' || /债券|偏债|货币|固收[+＋]/.test((f.n || '') + ' ' + (f.ix || ''));
    if (tab === 'active') return f.active && !['fixed_income', 'commodity', 'fof'].includes(rule.category);
    return true;
  }
  function fundRows() {
    const q = state.query.trim().toLowerCase();
    const result = funds.filter(f => fundTabPass(f, state.fundTab) && (state.fundTab !== 'all' || state.poolCategory === 'all' || fundTabPass(f, state.poolCategory)) && (!q || [f.n, f.c, f.ix, f.mgr].join(' ').toLowerCase().includes(q)) && (state.channel === 'all' || (state.channel === 'exchange' ? f.exchange : !f.exchange)) && (!state.purchasable || f.exchange || /^(开放|限大额|开放申购)$/.test(f.st)));
    const value = f => state.fundSort.startsWith('return:') ? ret(f.r[years.indexOf(+state.fundSort.split(':')[1])], +state.fundSort.split(':')[1], f) : state.fundSort === 'fee' ? f.annualFee : state.fundSort === 'risk' ? f.mdd5 : state.fundSort === 'size' ? f.sz : state.fundSort === 'manager' ? f.mten : f.c;
    if (state.fundSort !== 'default') result.sort((a, b) => M.compareNullable(value(a), value(b), state.descending) || a.c.localeCompare(b.c));
    else if (state.fundTab === 'equity') result.sort((a, b) => state.equityAll ? M.compareNullable((policy.byCode[a.c]?.thresholdInputs || {}).a5, (policy.byCode[b.c]?.thresholdInputs || {}).a5, true) || a.c.localeCompare(b.c) : (shortlist.has(a.c) ? 0 : 1) - (shortlist.has(b.c) ? 0 : 1) || M.compareNullable((policy.byCode[a.c]?.thresholdInputs || {}).a5, (policy.byCode[b.c]?.thresholdInputs || {}).a5, true) || a.c.localeCompare(b.c));
    return result;
  }
  function buyFee(f) { return f.exchange ? '券商佣金' : esc(f.buy || '未收录'); }
  function redemption(f, full = false) {
    return f.exchange ? '券商佣金' : f.rd ? esc(f.rd) + '%' + (full ? '；持有期对应关系待核验' : '') : '未收录';
  }
  function managerText(f, full = false) {
    if (Array.isArray(f.managerRecords) && f.managerRecords.length) return f.managerRecords.filter(m => !m.end || m.end === '至今').map(m => {
      return '<span class="manager-person">' + esc(m.name) + (full ? '<span class="sub">' + esc(m.start || '起点未核验') + (m.start ? '起' : '') + '</span><span class="sub">' + esc(m.tenureText || '任期未核验') + '</span>' : '<span class="manager-tenure"> · ' + esc(m.tenureText || '任期待核验') + '</span>') + '</span>';
    }).join('') || esc(f.mgr || '未收录');
    return esc(f.mgr || '未收录') + (full ? '<span class="sub">个人任职起点待核验</span>' + (f.mstart ? '<span class="sub">旧团队记录起点：' + esc(f.mstart) + '（不作为个人任期）</span>' : '') : '');
  }
  function ongoingFee(f) {
    const values = Array.isArray(f.fee) ? f.fee.slice(0, 3) : [];
    const known = values.filter(M.finite), complete = values.length === 3 && known.length === 3;
    const summary = !known.length ? '—' : (complete ? '' : '已知≥') + pct(known.reduce((a, b) => a + b, 0), 2, false);
    const details = ['管理费', '托管费', '销售服务费'].map((label, i) => label + ' ' + pct(values[i], 2, false)).join(' · ');
    return '<button type="button" class="fee-summary" data-action="fund-detail" data-code="' + esc(f.c) + '" title="' + esc(details + '；点击查看完整费用资料') + '" aria-label="持续费率' + esc(summary) + '；' + esc(details) + '；查看详情">' + esc(summary) + '</button>';
  }
  function fundDateCell(f) {
    const returns = metricDate(f, 'return'), risk = metricDate(f, 'risk'), same = returns === risk;
    const compactDate = value => value === '未独立记录' ? '—' : value;
    const summary = same ? compactDate(returns) : '收益 ' + compactDate(returns) + ' / 风险 ' + compactDate(risk);
    return '<span title="' + esc('收益截至 ' + returns + '；风险截至 ' + risk) + '">' + esc(summary) + '</span><span class="audit-mark" title="' + (verifiedReturn(f) ? '收益已复算' : '收益待核验') + '">' + (verifiedReturn(f) ? ' ✓' : ' 待核验') + '</span>';
  }
  function fundColumns() {
    const cols = [];
    const add = (group, label, cell, key = '', cls = '') => { if (state.columns.has(group)) cols.push({ label, cell, key, cls }); };
    add('manager', '现任经理', f => managerText(f), '', 'manager-cell');
    state.periods.forEach(y => cols.push({ label: periodHead(y), key: 'return:' + y, cell: f => pc(ret(f.r[years.indexOf(y)], y, f)) }));
    add('risk', '5年最大回撤', f => pc(f.mdd5, 1) + (f.mdd5 == null && M.finite(f.mdd3) ? '<span class="sub">3年 ' + pct(f.mdd3, 1) + '</span>' : ''), 'risk');
    add('risk', '5年波动率', f => pct(f.vol5, 1, false) + (f.vol5 == null && M.finite(f.v3) ? '<span class="sub">3年 ' + pct(f.v3, 1, false) + '</span>' : ''));
    add('status', '申购状态', f => badge(f.exchange ? '场内交易' : f.st || '未收录', /暂停/.test(f.st) && !f.exchange ? 'warn' : ''));
    add('status', '日限额', f => '<span class="limit-inline">' + (f.exchange || /暂停/.test(f.st) ? '—' : esc(f.lm || '—')) + '</span>');
    add('size', '规模 / 亿元', f => money(f.sz, 1), 'size');
    add('fees', '持续费率 / 年', ongoingFee, 'fee');
    add('trade', '买入费率', buyFee);
    add('trade', '卖出费率', f => redemption(f));
    add('nav', '净值 / 日涨跌', f => money(f.nav, 4) + ' <span class="nav-change">' + pc(f.dz, 2) + '</span>');
    add('inception', '成立日期', f => esc(f.d || '未收录'));
    add('quote', '交易价 / 溢价', f => money(f.p, 3) + ' / ' + pct(f.prem) + (f.priceAsOf || f.quotedAt ? '<span class="sub">' + esc(f.priceAsOf || f.quotedAt) + '</span>' : ''));
    add('dates', '收益 / 风险截至', fundDateCell);
    return cols;
  }
  function fundTable(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / 20));
    state.page = Math.min(totalPages, state.page);
    const page = rows.slice((state.page - 1) * 20, state.page * 20), cols = fundColumns();
    const sort = (n, k) => action(n + (state.fundSort === k ? (state.descending ? ' ↓' : ' ↑') : ''), 'fund-sort', '', 'data-value="' + k + '"');
    return '<div class="card"><div class="table-caption"><span><b>' + rows.length + '</b>只产品' + (state.query ? ' · 搜索“' + esc(state.query) + '”' : '') + ' · 人民币净值口径 · 每页20只' + (state.fundSort !== 'default' ? ' · ' + action('恢复默认顺序', 'fund-sort-reset', 'text-link small') : '') + '</span><div class="pagination">' + action('上一页', 'fund-prev', 'btn sm', state.page <= 1 ? 'disabled' : '') + '<span>' + state.page + ' / ' + totalPages + '</span>' + action('下一页', 'fund-next', 'btn sm', state.page >= totalPages ? 'disabled' : '') + '</div></div><div class="table-wrap fund-table-wrap" tabindex="0" aria-label="基金数据表，可横向滚动"><table class="research-table fund-table"><thead><tr><th>基金</th>' + cols.map(c => '<th' + (c.key ? ' aria-sort="' + (state.fundSort === c.key ? state.descending ? 'descending' : 'ascending' : 'none') + '"' : '') + '>' + (c.key ? sort(c.label, c.key) : c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      (page.length ? page.map(f => '<tr><td><div class="fund-name-row">' + action(esc(f.n), 'fund-detail', 'text-link', 'data-code="' + f.c + '" title="' + esc(f.c + ' · ' + (f.exchange ? '场内' : '场外') + ' · ' + (f.ix || '策略待核验')) + '"') + (state.fundTab === 'income' ? badge(f.dividend ? '红利' : '债券/固收') : '') + action(state.selected.has(f.c) ? '✓' : '＋', 'compare-toggle', 'fund-compare' + (state.selected.has(f.c) ? ' selected' : ''), 'data-code="' + f.c + '" aria-pressed="' + state.selected.has(f.c) + '" aria-label="对比' + esc(f.n) + '" title="加入或移出对比"') + '</div></td>' + cols.map(c => '<td class="' + (c.cls || '') + '">' + c.cell(f) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + (cols.length + 1) + '"><div class="empty"><b>没有符合条件的产品</b>试试名称、代码或更宽的筛选条件。<p>' + action('清除筛选', 'fund-reset', 'text-link') + '</p></div></td></tr>') +
      '</tbody></table></div><div class="panel-foot"><span>— 表示缺失或历史不足。净值、规模日期与逐项费率可在详情或 CSV 查看；部分规模日期尚未独立记录。</span>' + action('导出完整字段 CSV', 'export-funds', 'text-link') + '</div></div>';
  }
  function screenControls() {
    const qualified = funds.filter(f => f.active && M.equityQualifies(policy.byCode[f.c], { ...defaults, ...state.screen }));
    return '<details class="screen-panel"' + (screenOpen ? ' open' : '') + '><summary><span>3年年化 ≥ ' + state.screen.minA3 + '% · 5年年化 ≥ ' + state.screen.minA5 + '%' + (state.screen.minA10 === null ? '' : ' · 10年 ≥ ' + state.screen.minA10 + '%') + '</span><b>调整筛选条件</b></summary><div class="screen-heading"><div><h2>长期权益筛选</h2><p>收益门槛可调；债券、红利和行业主题另行研究。</p></div>' + action('完整筛选依据', 'screen-rules', 'text-link small') + '</div>' +
      '<div class="screen-inputs"><label>近3年年化至少 <span><input data-screen="minA3" type="number" min="-100" max="100" step="1" value="' + state.screen.minA3 + '">%</span></label><label>近5年年化至少 <span><input data-screen="minA5" type="number" min="-100" max="100" step="1" value="' + state.screen.minA5 + '">%</span></label><label>近10年年化至少 <span><input data-screen="minA10" type="number" min="-100" max="100" step="1" placeholder="不限" value="' + (state.screen.minA10 === null ? '' : state.screen.minA10) + '">%</span></label>' + action('恢复默认条件', 'screen-reset', 'quiet') + '</div><div class="screen-foot"><span>基金历史≥' + defaults.minHistoryYears + '年 · 规模≥' + defaults.minScale + '亿元 · 主动基金至少一位现任经理任职≥' + defaults.minManagerYears + '年</span>' + action(state.equityAll ? '返回精简候选' : '展开全部合格（' + qualified.length + '只）', 'equity-expand', 'text-link small') + '</div><p class="note">' + (state.equityAll ? '展示当前条件下的全部合格主动权益样本，按近5年年化排序。' : '默认展示精简候选和通过同一门槛的海外主动基金。候选按策略、经理与公司去重。') + '筛选通过与数据已复算分别标记，历史业绩不全由现任经理创造。</p></details>';
  }
  function columnControl() {
    return '<details class="column-picker"><summary>显示列 <span>' + state.columns.size + ' / ' + Object.keys(columnNames).length + '</span></summary><div class="column-menu">' + Object.entries(columnNames).map(([id, n]) => '<label><input type="checkbox" data-column="' + id + '"' + (state.columns.has(id) ? ' checked' : '') + '>' + n + '</label>').join('') + '<div class="column-actions">' + action('全部显示', 'columns-all', 'text-link') + action('恢复默认', 'columns-default', 'text-link') + '</div></div></details>';
  }
  function fundView() {
    const tabs = [['equity', '长期主动权益'], ['income', '红利 / 债券 / 固收'], ['passive', '指数工具'], ['all', '完整研究池']];
    return head('FUND RESEARCH', '基金研究', '比较多年表现、经理任期与完整成本。') +
      '<div class="tabs" aria-label="研究范围">' + tabs.map(([id, n]) => action(n, 'fund-tab', state.fundTab === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.fundTab === id) + '"')).join('') + '</div>' +
      (state.fundTab === 'equity' ? screenControls() + benchmarkPanel() : '') +
      '<div class="fund-controls"><div class="toolbar"><div class="filters"><input id="fund-search" type="search" aria-label="搜索基金名称、代码、指数或经理" placeholder="搜索名称、代码、指数或经理" value="' + esc(state.query) + '">' +
      (state.fundTab === 'all' ? selectMenu('fund-category', '研究池分类', [['all', '全部分类'], ['overseas', '海外'], ['active', '主动权益'], ['dividend', '红利'], ['fixed', '债券与固收'], ['theme', '行业主题'], ['commodity', '商品']], state.poolCategory) : '') +
      selectMenu('fund-channel', '交易渠道', [['all', '全部渠道'], ['exchange', '场内交易'], ['otc', '场外申赎']], state.channel) +
      '<label class="check-label"><input id="purchasable" type="checkbox"' + (state.purchasable ? ' checked' : '') + '>快照显示可买</label></div></div>' +
      '<div class="table-controls">' + columnControl() + returnControls() + '</div></div><div id="fund-results">' + fundTable(fundRows()) + '</div>' + compareBar() + '<p class="note">场外买入费率为原费率 / 历史渠道优惠，卖出费率需核对持有期档位；场内产品使用券商佣金，LOF 的两个交易渠道费用不同。资料只代表所示日期的快照。</p>';
  }
  function compareBar() {
    return '<div id="comparison-bar"' + (!state.selected.size ? ' class="hidden"' : ' class="compare-bar"') + '><span>已选 ' + state.selected.size + ' / 4 &nbsp; ' + [...state.selected].map(c => esc(c)).join(' · ') + '</span>' + action('清空', 'compare-clear', 'quiet') + action('并排比较 →', 'compare-open', 'btn', state.selected.size < 2 ? 'disabled' : '') + '</div>';
  }
  function stockPass(s, tab) { return M.stockMatches(s, tab); }
  function stockRules() {
    const growth = state.stockTab === 'growth', key = growth ? 'growthReview' : 'longTermReview';
    const checks = (window.STOCKS || []).find(s => s[key]?.qualified)?.[key]?.checks || [];
    openModal(modalTitle((growth ? '高质成长股' : '长期优质企业') + '的入选依据', growth ? '主营增长 · 连续两个单季 · 盈利与现金质量' : '五年经营记录 · 业务持续性 · 当前财务条件') +
      '<p class="notice">先核对增长、资本回报与现金流，再查主营产品、竞争依据和业务风险。完成报告研究且满足当前条件的公司才进入此页。</p><div class="rule-list">' + checks.map((c, i) => '<div class="rule-item"><span class="rule-number">' + String(i + 1).padStart(2, '0') + '</span><p>' + esc(c.label) + '</p></div>').join('') +
      '</div><p class="note">增长与ROE门槛是本项目的研究参数，未经收益优化。中报、季报与上年同期比较，不年化ROE。名单覆盖已完成研究的企业，不是全A股排名；入选不代表估值便宜。</p><div class="actions">' + extLink('https://github.com/jianxieb/fund-data/blob/main/docs/stock-quality-method.md', '名单来源与研究记录') + '</div>');
  }
  function reportLabel(report) {
    const day = report?.reportDate;
    return day ? day.slice(0, 4) + ({ '03-31': '一季报', '06-30': '中报', '09-30': '三季报', '12-31': '年报' }[day.slice(5)] || '财报') : '缺报告期';
  }
  function stockGrowth(report, key) {
    return M.finite(report?.[key + 'Growth']) ? pc(report[key + 'Growth']) : '<span class="muted">' + esc(report?.[key + 'GrowthStatus'] || '缺同比数据') + '</span>';
  }
  function stockGrowthCell(s, key) {
    const latest = s.latestFinancials, annual = s.financialHistory?.[0];
    return '<td class="stock-growth"><strong>' + stockGrowth(latest, key) + '</strong><span class="sub">' + esc(reportLabel(latest)) + '</span>' +
      (annual && annual.reportDate !== latest?.reportDate ? '<span class="stock-annual">' + esc(reportLabel(annual)) + ' ' + stockGrowth(annual, key) + '</span>' : '') + '</td>';
  }
  function stockIdentity(s) {
    const overlap = M.stockMatches(s, 'quality') && M.stockMatches(s, 'growth');
    return '<td class="stock-identity">' + action(esc(s.n), 'stock-detail', 'text-link', 'data-code="' + s.c + '"') + '<span class="sub">' + s.c + '</span><span class="stock-business-label">' + esc(s.businessLabel || s.ind) + '</span>' +
      (overlap ? '<span class="stock-overlap">长期优质 · 高成长</span>' : '') + stockDeepLink(s) + '</td>';
  }
  function stockDeepLink(s, cls = 'stock-deep-link') {
    return (window.STOCK_REPORTS?.reports || []).some(r => r.code === s.c) ? '<a class="' + cls + '" href="#stock-report/' + s.c + '" aria-label="' + esc(s.n) + '深入报告">深入报告 <span aria-hidden="true">↗</span></a>' : '';
  }
  function stockReportLink(s) {
    const research = s.qualityResearch, source = research?.sources?.[0];
    return source ? extLink(source.url + (source.businessPage ? '#page=' + source.businessPage : ''), reportLabel({reportDate: research.reportPeriod}) + ' · 业务依据') : '';
  }
  function stockReason(s) {
    const research = s.qualityResearch, growth = s.financialGrowth3;
    const thesis = state.stockTab === 'growth' ? research?.growth?.driver : research?.longTerm?.durability;
    return '<td class="stock-reason"><strong>' + esc(research?.title || '') + '</strong><span>' + esc(research?.thesis?.[0] || '') + '</span>' +
      '<span>' + esc(thesis || '') + '</span>' + (state.stockTab === 'growth' ? '<span class="stock-growth-basis">连续两季增长 · 扣非占比 ' + pct(s.growthReview?.coreProfitRatio * 100, 1, false) + '</span>' : '<span class="stock-growth-basis">5年平均ROE ' + pct(s.longTermReview?.roe5, 1, false) + ' · 3年扣非复合增长 ' + pc(growth?.deductedProfit, 1) + '</span>') + stockReportLink(s) + '</td>';
  }
  function stockRisks(s) { return [...(s.qualityReview?.watchouts || []), ...(s.qualityResearch?.risks || [])]; }
  function stockRisk(s) {
    const risks = stockRisks(s);
    return '<td class="stock-risk">' + risks.slice(0, 3).map(t => '<span>' + esc(t) + '</span>').join('') +
      (risks.length > 3 ? action('查看其余 ' + (risks.length - 3) + ' 项', 'stock-detail', 'text-link', 'data-code="' + s.c + '"') : '') + '</td>';
  }
  function stockRoe(s) {
    const r = s.latestFinancials;
    return '<strong>' + pct(r?.roe, 2, false) + '</strong><span class="sub">' + esc(reportLabel(r)) + '</span>' +
      (M.finite(r?.roePrevious) ? '<span class="stock-annual">上年同期 ' + pct(r.roePrevious, 2, false) + '</span>' : '<span class="sub">缺上年同期ROE</span>');
  }
  function stockPercentile(s, years) {
    const p = s.pePercentiles?.[years];
    return M.finite(p?.value) ? '<span class="stock-percentile">' + pct(p.value, 1, false) + '</span><span class="sub">' + p.samples.toLocaleString('zh-CN') + '个交易日</span>' : '<span class="muted">—</span><span class="sub">' + esc(p?.reason || '缺历史估值') + '</span>';
  }
  function stockDynamic(s) {
    return money(s.peDynamic, 2) + '<span class="sub">' + (M.finite(s.peDynamic) ? esc(reportLabel({ reportDate: s.peDynamicBasis?.reportDate })) + '利润年化' : s.peDynamicBasis?.status === 'loss' ? '本期亏损' : '缺当期利润或市值') + '</span>';
  }
  function stocks() {
    const all = window.STOCKS || [], dividend = state.stockTab === 'dividend';
    const financials = !dividend && state.stockView === 'financials', valuation = !dividend && state.stockView === 'valuation';
    const groups = [['quality', '长期优质企业'], ['growth', '高质成长股'], ['dividend', '红利价值']];
    const pool = all.filter(s => M.stockMatches(s, state.stockTab));
    const categories = [...new Set(pool.map(s => s.researchCategory || s.ind))];
    const rows = pool.filter(s => (state.stockCategory === 'all' || (s.researchCategory || s.ind) === state.stockCategory) &&
      (!state.stockQuery || (s.c + s.n + s.ind + (s.businessLabel || '') + (s.researchCategory || '')).toLowerCase().includes(state.stockQuery.toLowerCase())));
    const value = x => state.stockSort.startsWith('return:') ? ret(x.r[years.indexOf(+state.stockSort.split(':')[1])], +state.stockSort.split(':')[1], x) :
      state.stockSort.startsWith('growth:') ? x.latestFinancials?.[state.stockSort.split(':')[1] + 'Growth'] : state.stockSort.startsWith('percentile:') ? x.pePercentiles?.[state.stockSort.split(':')[1]]?.value : state.stockSort === 'latestRoe' ? x.latestFinancials?.roe : x[state.stockSort];
    if (state.stockSort !== 'default') rows.sort((a, b) => M.compareNullable(value(a), value(b), state.stockDesc));
    const sh = (n, k) => action(n + (state.stockSort === k ? state.stockDesc ? ' ↓' : ' ↑' : ''), 'stock-sort', '', 'data-value="' + k + '"');
    const viewControl = dividend ? '' : '<div class="segmented stock-view" aria-label="个股研究视图">' + [['financials', '财务与理由'], ['valuation', '估值分位'], ['returns', '收益与分红']].map(([id, label]) => action(label, 'stock-view', state.stockView === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.stockView === id) + '"')).join('') + '</div>';
    const financialHead = '<th>' + sh('最新报告 ROE', 'latestRoe') + '</th><th>' + sh('营收同比', 'growth:revenue') + '</th><th>' + sh('归母利润同比', 'growth:netProfit') + '</th><th>' + sh('扣非利润同比', 'growth:deductedProfit') + '</th><th>入选理由</th><th>风险</th>';
    const valuationHead = '<th>' + sh('PE / TTM', 'pe') + '</th><th>' + sh('动态PE', 'peDynamic') + '</th><th>' + sh('静态PE', 'peStatic') + '</th><th>' + sh('PE分位 / 5年', 'percentile:5') + '</th><th>' + sh('PE分位 / 10年', 'percentile:10') + '</th><th>' + sh('PB / MRQ', 'pb') + '</th><th>' + sh('市值 / 亿元', 'mcap') + '</th><th>估值截至</th>';
    const returnHead = '<th>现价</th>' + (dividend ? '<th>' + sh('PE / TTM', 'pe') + '</th><th>' + sh('PB / MRQ', 'pb') + '</th><th>' + sh('最新报告 ROE', 'latestRoe') + '</th><th>' + sh('市值 / 亿元', 'mcap') + '</th>' : '') + '<th>' + sh('近12月股息率', 'yield12') + '</th><th>5年分红年数</th>' + state.periods.map(y => '<th>' + sh(periodHead(y), 'return:' + y) + '</th>').join('') + '<th>' + sh('5年最大回撤', 'mdd5') + '</th><th>收益截至</th>';
    const financialRow = s => '<td class="stock-roe">' + stockRoe(s) + '</td>' + stockGrowthCell(s, 'revenue') + stockGrowthCell(s, 'netProfit') + stockGrowthCell(s, 'deductedProfit') + stockReason(s) + stockRisk(s);
    const valuationRow = s => '<td>' + money(s.pe, 2) + '</td><td>' + stockDynamic(s) + '</td><td>' + money(s.peStatic, 2) + '</td><td>' + stockPercentile(s, 5) + '</td><td>' + stockPercentile(s, 10) + '</td><td>' + money(s.pb, 2) + '</td><td>' + money(s.mcap, 1) + '</td><td>' + esc(s.valuationAsOf || '—') + '</td>';
    const returnRow = s => '<td>' + money(s.price, 2) + '</td>' + (dividend ? '<td>' + money(s.pe, 2) + '<span class="sub">' + esc(s.valuationAsOf || '缺估值日期') + '</span></td><td>' + money(s.pb, 2) + '</td><td class="stock-roe">' + stockRoe(s) + '</td><td>' + money(s.mcap, 1) + '</td>' : '') + '<td>' + pct(s.yield12, 2, false) + '</td><td>' + (s.divYears == null ? '—' : esc(s.divYears) + ' / 5') + '</td>' + state.periods.map(y => '<td>' + pc(ret(s.r?.[years.indexOf(y)], y, s)) + '</td>').join('') + '<td>' + pc(s.mdd5, 1) + '</td><td>' + esc(s.returnAsOf || '—') + '</td>';
    return head('STOCK WATCHLIST', '个股深入', dividend ? '关注现金分红、股息率与长期收益。' : state.stockTab === 'growth' ? '主营业务持续放量，收入与核心利润共同增长。' : '长期经营能力，经得起多年财务与当前业绩的检验。', '<a class="btn sm" href="#reports">研究报告</a>' + (dividend ? '' : action('入选标准', 'stock-rules', 'btn sm'))) +
      '<div class="tabs" role="tablist" aria-label="个股研究分组">' + groups.map(([id, label]) => action(label + '<span class="tab-count">' + all.filter(s => stockPass(s, id)).length + '</span>', 'stock-tab', state.stockTab === id ? 'active' : '', 'data-value="' + id + '" role="tab" aria-selected="' + (state.stockTab === id) + '"')).join('') + '</div>' +
      (dividend ? '' : '<div class="stock-category-filter" role="group" aria-label="企业类别">' + [['all', '全部类别'], ...categories.map(c => [c, c])].map(([id, label]) => action(esc(label), 'stock-category', 'filter-chip' + (state.stockCategory === id ? ' active' : ''), 'data-value="' + esc(id) + '" aria-pressed="' + (state.stockCategory === id) + '"')).join('') + '</div>') +
      '<div class="stock-controls"><div class="filters"><input type="search" id="stock-search" aria-label="搜索公司、代码或业务" placeholder="搜索公司、代码或业务" value="' + esc(state.stockQuery) + '"></div>' + (dividend || state.stockView === 'returns' ? returnControls() : '') + '</div>' +
      '<div class="card"><div class="table-caption stock-table-caption"><span><b>' + rows.length + '</b> / ' + pool.length + '家公司</span>' + viewControl + '</div><div class="table-wrap stock-table-wrap" tabindex="0" role="region" aria-label="个股研究表，可横向滚动"><table class="research-table stock-table' + (financials ? ' stock-financial-table' : '') + '"><thead><tr><th>公司 / 主营业务</th>' + (financials ? financialHead : valuation ? valuationHead : returnHead) + '</tr></thead><tbody>' + rows.map(s => '<tr>' + stockIdentity(s) + (financials ? financialRow(s) : valuation ? valuationRow(s) : returnRow(s)) + '</tr>').join('') + (rows.length ? '' : '<tr><td colspan="' + (financials ? 7 : valuation ? 9 : (dividend ? 10 : 6) + state.periods.length) + '"><div class="empty">没有匹配的公司</div></td></tr>') + '</tbody></table></div></div>';
  }
  function reportsView() {
    const reports = window.STOCK_REPORTS?.reports || [];
    const report = reports.find(r => r.code === state.reportCode);
    if (state.reportCode && !report) return head('COMPANY RESEARCH', '报告未收录', '', '<a class="btn" href="#reports">返回报告库</a>');
    if (!report) {
      const query = state.reportQuery.trim().toLowerCase();
      const rows = reports.filter(r => !query || (r.name + r.code + r.business + r.category).toLowerCase().includes(query));
      return head('COMPANY RESEARCH', '研究报告', '业务、财务、估值与风险，放在同一份分析里。', '<a class="btn sm" href="#stocks">返回个股研究</a>') +
        '<div class="report-library-controls"><label for="report-search">' + reports.length + '份报告</label><input id="report-search" type="search" placeholder="搜索公司、代码或业务" aria-label="搜索研究报告" value="' + esc(state.reportQuery) + '"></div>' +
        '<div class="report-library">' + rows.map(r => '<a class="report-cover" href="#stock-report/' + r.code + '"><div class="report-cover-top"><span>' + esc(r.code) + ' · ' + esc(r.category) + '</span><span>' + esc(r.asOf) + '</span></div><h2>' + esc(r.name) + '</h2><p class="report-cover-business">' + esc(r.business) + '</p><p>' + esc(r.summary) + '</p><div class="report-cover-bottom"><span>' + esc(r.groups.join(' · ') || '专题研究') + '</span><span>阅读全文 <span aria-hidden="true">↗</span></span></div></a>').join('') + '</div>' + (rows.length ? '' : '<div class="empty">没有匹配的报告</div>');
    }
    const table = t => '<div class="table-wrap" tabindex="0" role="region" aria-label="报告数据表，可横向滚动"><table><thead><tr>' + t.headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + t.rows.map(r => '<tr>' + r.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    const section = s => '<section class="report-section" id="report-' + esc(s.id) + '"><h2>' + esc(s.title) + '</h2>' + (s.paragraphs || []).map(p => '<p>' + esc(p) + '</p>').join('') + (s.bullets?.length ? '<ul>' + s.bullets.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') + (s.table ? table(s.table) : '') + (s.links?.length ? '<ul class="report-sources">' + s.links.map(l => '<li>' + extLink(l.url, l.label) + '</li>').join('') + '</ul>' : '') + '</section>';
    return '<div class="report-topline"><a href="#stocks">← 个股研究</a><a href="#reports">全部报告</a><a href="' + esc(report.markdownPath) + '" download>下载 Markdown</a></div>' +
      '<header class="report-header"><div class="eyebrow">COMPANY RESEARCH / ' + esc(report.code) + '</div><h1>' + esc(report.name) + '</h1><p class="report-business">' + esc(report.business) + '</p><div class="report-dates"><span>研究 ' + esc(report.asOf) + '</span><span>行情 ' + esc(report.marketAsOf) + '</span><span>财报 ' + esc(report.reportPeriod) + '</span><b>' + esc(report.groups.join(' · ') || '专题研究') + '</b></div></header>' +
      '<div class="report-layout"><nav class="report-toc" aria-label="报告章节">' + report.sections.map((s, i) => action('<span>' + String(i + 1).padStart(2, '0') + '</span>' + esc(s.title), 'report-section', '', 'data-value="' + esc(s.id) + '"')).join('') + '</nav><article class="report-article" aria-label="' + esc(report.name) + '深入分析">' + report.sections.map(section).join('') + (report.archivePath ? '<details class="report-archive"><summary>原版报告与修订记录</summary><p>原版日期为2026-09-02，已在文首追加更正；历史正文不代表当前结论。</p><a href="' + esc(report.archivePath) + '" download>下载原版与更正记录</a></details>' : '') + '</article></div>';
  }
  function curveCard(title, subtitle, entries, dates, metric, startDate) {
    const palette = ['#35654a', '#b58a46', '#557b9b', '#b36b5d', '#756c9b', '#698b6b', '#b78673', '#6e91a6', '#998a54'];
    const format = value => metric === 'amount' ? '$' + money(value) : pct(value, 2);
    const axisFormat = value => metric === 'amount' ? '$' + (value >= 1000000 ? money(value / 1000000, 1) + 'm' : value >= 1000 ? money(value / 1000, 0) + 'k' : money(value)) : pct(value, 0, false);
    const valid = entries.map((entry, i) => ({ ...entry, color: palette[i % palette.length] }))
      .filter(entry => Array.isArray(entry.values) && entry.values.length === dates.length && entry.values.every(v => M.finite(v) && (metric === 'amount' ? v > 0 : v > -100)));
    const visible = valid.filter(entry => !state.chartHidden.has(entry.key));
    const legend = '<div class="curve-legend">' + valid.map((entry, i) => (entry.experimental && (i === 0 || !valid[i - 1].experimental) ? '<div class="curve-legend-divider">杠杆 ETF 实验</div>' : '') + action('<i style="background:' + entry.color + '"></i><span>' + esc(entry.label) + '</span><b class="num">' + format(entry.values.at(-1)) + '</b>', 'chart-line', 'curve-key' + (entry.experimental ? ' experimental' : '') + (state.chartHidden.has(entry.key) ? ' is-hidden' : ''), 'data-value="' + esc(entry.key) + '" aria-pressed="' + !state.chartHidden.has(entry.key) + '" aria-label="' + esc(entry.label + '曲线') + '"')).join('') + '</div>';
    if (!dates.length || !valid.length) return '<section class="card curve-card"><div class="card-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div></div><div class="card-body muted">当前起点没有可绘制的历史路径。</div></section>';
    if (!visible.length) { activeCurve = null; return '<section class="card curve-card"><div class="card-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div></div><div class="curve-empty">点击图例以显示曲线</div>' + legend + '</section>'; }
    const allValues = visible.flatMap(entry => entry.values);
    let scaleY, ticks = [];
    const logarithmic = metric === 'amount' && state.stratCompare === 'assets';
    const annualizedLow = metric === 'annualized' ? Math.min(0, ...allValues) : 0;
    const annualizedHigh = metric === 'annualized' ? Math.max(0, ...allValues) : 0;
    const compressedAnnualized = metric === 'annualized' && (annualizedHigh > 250 || annualizedHigh - annualizedLow > 400);
    if (logarithmic) {
      const minExp = Math.floor(Math.log2(Math.min(...allValues))), maxExp = Math.max(minExp + 1, Math.ceil(Math.log2(Math.max(...allValues))));
      scaleY = value => 276 - (Math.log2(value) - minExp) / (maxExp - minExp) * 242;
      const step = Math.max(1, Math.ceil((maxExp - minExp) / 6));
      for (let exponent = minExp; exponent <= maxExp; exponent += step) {
        const value = 2 ** exponent, y = scaleY(value);
        ticks.push('<line x1="59" x2="888" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="curve-grid"/><text x="49" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="curve-axis">' + axisFormat(value) + '</text>');
      }
    } else if (compressedAnnualized) {
      const transform = value => Math.sign(value) * Math.log1p(Math.abs(value) / 20);
      const candidates = [-100, -50, -20, 0, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
      const minTick = candidates.filter(value => value <= annualizedLow).at(-1) ?? -100;
      const maxTick = candidates.find(value => value >= annualizedHigh) ?? Math.ceil(annualizedHigh / 10000) * 10000;
      const low = transform(minTick), high = transform(maxTick);
      scaleY = value => 276 - (transform(value) - low) / (high - low) * 242;
      const tickValues = candidates.filter(value => value >= minTick && value <= maxTick);
      if (!tickValues.includes(maxTick)) tickValues.push(maxTick);
      for (const value of tickValues) {
        const y = scaleY(value);
        ticks.push('<line x1="59" x2="888" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="curve-grid"/><text x="49" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="curve-axis">' + axisFormat(value) + '</text>');
      }
    } else {
      const low = metric === 'amount' ? 0 : Math.min(0, ...allValues), high = Math.max(0, ...allValues);
      const rough = Math.max(0.1, (high - low) / 5), magnitude = 10 ** Math.floor(Math.log10(rough));
      const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= rough) || magnitude * 10;
      const minTick = Math.floor(low / step) * step, maxTick = Math.max(minTick + step, Math.ceil(high / step) * step);
      scaleY = value => 276 - (value - minTick) / (maxTick - minTick) * 242;
      for (let value = minTick; value <= maxTick + step / 2; value += step) {
        const y = scaleY(value);
        ticks.push('<line x1="59" x2="888" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="curve-grid"/><text x="49" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="curve-axis">' + axisFormat(value) + '</text>');
      }
    }
    const times = dates.map(d => Date.parse(d + 'T00:00:00Z'));
    const requestedStart = Date.parse(startDate + 'T00:00:00Z');
    const originTime = metric === 'annualized' && Number.isFinite(requestedStart) && requestedStart < times[0] ? requestedStart : times[0];
    const span = Math.max(1, times.at(-1) - originTime);
    const scaleXTime = time => 59 + (time - originTime) / span * 829;
    const scaleX = i => scaleXTime(times[i]);
    activeCurve = { dates, times, entries: visible, scaleY, metric, originTime };
    const xTicks = [0, 0.25, 0.5, 0.75, 1]
      .map((fraction, i) => {
        const time = originTime + span * fraction;
        return '<text x="' + scaleXTime(time).toFixed(1) + '" y="303" text-anchor="' + (i === 0 ? 'start' : i === 4 ? 'end' : 'middle') + '" class="curve-axis">' + new Date(time).toISOString().slice(0, 7) + '</text>';
      }).join('');
    const unavailableWidth = scaleX(0) - 59;
    const unavailable = metric === 'annualized' && unavailableWidth > 0 ? '<rect x="59" y="34" width="' + unavailableWidth.toFixed(1) + '" height="242" class="curve-unavailable"/><line x1="' + scaleX(0).toFixed(1) + '" x2="' + scaleX(0).toFixed(1) + '" y1="34" y2="276" class="curve-unavailable-edge"/>' : '';
    const paths = visible.map(entry => {
      const path = entry.values.map((v, i) => (i ? 'L' : 'M') + scaleX(i).toFixed(1) + ',' + scaleY(v).toFixed(1)).join(' ');
      const intro = metric === 'annualized' && originTime < times[0]
        ? '<path d="M59,' + scaleY(0).toFixed(1) + ' L' + scaleX(0).toFixed(1) + ',' + scaleY(entry.values[0]).toFixed(1) + '" fill="none" stroke="' + entry.color + '" stroke-width="2" stroke-dasharray="2 3" opacity=".7"/>'
        : '';
      return intro + '<path d="' + path + '" fill="none" stroke="' + entry.color + '" stroke-width="2.5"' + (entry.experimental ? ' stroke-dasharray="7 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"><title>' + esc(entry.label + ' · 期末' + format(entry.values.at(-1))) + '</title></path>';
    }).join('');
    return '<section class="card curve-card"><div class="card-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div></div><div class="curve-body">' +
      '<div class="curve-plot"><svg class="curve-svg" viewBox="0 0 920 320" role="img" aria-label="' + esc(title + '；悬浮或点击查看具体交易日与' + (metric === 'amount' ? '账户金额' : '资金加权年化')) + '">' + unavailable + ticks.join('') + xTicks + (metric === 'annualized' ? '<line x1="59" x2="888" y1="' + scaleY(0).toFixed(1) + '" y2="' + scaleY(0).toFixed(1) + '" class="curve-base"/>' : '') + paths + '<g class="curve-hover-layer" hidden><line class="curve-hover-line" y1="34" y2="276"/>' + visible.map(entry => '<circle class="curve-hover-dot" data-key="' + esc(entry.key) + '" r="4" fill="' + entry.color + '"/>').join('') + '</g></svg><div class="curve-tooltip" hidden></div></div>' + legend +
      '</div><div class="panel-foot"><span>' + (metric === 'amount' ? '实际账户金额，含每次新增投入 · 每周实际交易日取样 · ' + (logarithmic ? '对数' : '线性') + '刻度' : '起点 0% 是绘图基线；满四周后从首个月末起计算 XIRR，首年为按实际天数计算的短期年化推算 · ' + (compressedAnnualized ? '高波动时采用不等距刻度' : '线性刻度')) + '；悬浮读取真实数值，图例可切换曲线。</span></div></section>';
  }
  function showCurvePoint(event, plot) {
    if (!activeCurve || !activeCurve.entries.length) return;
    const svg = plot.querySelector('svg'), rect = svg.getBoundingClientRect();
    const position = Math.max(59, Math.min(888, (event.clientX - rect.left) / rect.width * 920));
    const times = activeCurve.times, target = activeCurve.originTime + (position - 59) / 829 * (times.at(-1) - activeCurve.originTime);
    const layer = svg.querySelector('.curve-hover-layer'), tooltip = plot.querySelector('.curve-tooltip');
    if (activeCurve.metric === 'annualized' && target < times[0]) {
      layer.setAttribute('hidden', '');
      tooltip.innerHTML = '<strong>' + new Date(activeCurve.originTime).toISOString().slice(0, 10) + ' → ' + esc(activeCurve.dates[0]) + '</strong><span class="curve-tooltip-caption">起点 0% 仅是绘图基线；虚线连接首个真实月末 XIRR</span>';
      tooltip.hidden = false;
    } else {
      let lo = 0, hi = times.length - 1;
      while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (times[mid] < target) lo = mid + 1; else hi = mid; }
      const index = lo > 0 && Math.abs(times[lo - 1] - target) < Math.abs(times[lo] - target) ? lo - 1 : lo;
      const x = 59 + (times[index] - activeCurve.originTime) / Math.max(1, times.at(-1) - activeCurve.originTime) * 829;
      layer.removeAttribute('hidden');
      const line = layer.querySelector('.curve-hover-line'); line.setAttribute('x1', x); line.setAttribute('x2', x);
      for (const dot of layer.querySelectorAll('.curve-hover-dot')) {
        const entry = activeCurve.entries.find(item => item.key === dot.dataset.key);
        if (!entry) continue;
        const y = activeCurve.scaleY(entry.values[index]);
        dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      }
      tooltip.innerHTML = '<strong>' + esc(activeCurve.dates[index]) + '</strong><span class="curve-tooltip-caption">' + (activeCurve.metric === 'amount' ? '账户金额 · 美元' : '资金加权年化 · XIRR') + '</span>' +
        activeCurve.entries.map(entry => '<div><i style="background:' + entry.color + '"></i><span>' + esc(entry.label) + '</span><b class="num">' + (activeCurve.metric === 'amount' ? '$' + money(entry.values[index], 2) : pct(entry.values[index], 2)) + '</b></div>').join('');
      tooltip.hidden = false;
    }
    const plotRect = plot.getBoundingClientRect(), px = event.clientX - plotRect.left;
    const left = px < plotRect.width / 2 ? px + 15 : px - tooltip.offsetWidth - 15;
    tooltip.style.left = Math.max(5, Math.min(plotRect.width - tooltip.offsetWidth - 5, left)) + 'px';
    tooltip.style.top = Math.max(5, Math.min(plotRect.height - tooltip.offsetHeight - 5, event.clientY - plotRect.top - tooltip.offsetHeight / 2)) + 'px';
  }
  function strategies() {
    const rootMeta = window.STRATEGY_META || {}, definitions = window.STRATEGY_DEFS || [], assets = window.STRATEGY_ASSETS || [];
    const summaries = rootMeta.windows && rootMeta.windows.length ? rootMeta.windows : [{ year: 2010, start: rootMeta.start, end: rootMeta.end, assets: assets.map(a => a.c) }];
    if (!summaries.some(item => String(item.year) === state.stratYear) ||
        (state.stratYear !== '2010' && !(window.STRATEGY_WINDOWS || {})[state.stratYear])) state.stratYear = '2010';
    const archived = state.stratYear === '2010' ? null : (window.STRATEGY_WINDOWS || {})[state.stratYear];
    const selected = archived || { start: rootMeta.start, end: rootMeta.end, assets: assets.map(a => a.c), results: window.STRATEGY_RESULTS || [], curves: window.STRATEGY_CURVES || {} };
    const meta = { ...rootMeta, start: selected.start, end: selected.end };
    const available = new Set(selected.assets || []), ordinary = assets.filter(a => a.lev === '1x' && available.has(a.c));
    const leveraged = assets.filter(a => a.lev !== '1x' && available.has(a.c));
    const curves = selected.curves || { dates: [], account: {}, irrDates: [], irr: {} };
    const dates = state.stratMetric === 'amount' ? curves.dates || [] : curves.irrDates || [];
    if (!available.has(state.stratAsset)) state.stratAsset = ordinary[0]?.c || leveraged[0]?.c;
    const methods = definitions.filter(d => d.panel === state.stratPanel);
    if (!methods.some(d => d.id === state.stratMethod)) state.stratMethod = methods[0] && methods[0].id;
    const metricSeries = state.stratMetric === 'amount' ? curves.account : curves.irr;
    const seriesFor = (asset, method) => ((metricSeries || {})[asset] || {})[method];
    const across = [...ordinary, ...(state.leverage ? leveraged : [])].map(a => ({ key: 'asset:' + a.c, label: a.g + ' · ' + a.c + (a.lev === '1x' ? '' : ' · ' + a.lev), experimental: a.lev !== '1x', values: seriesFor(a.c, state.stratMethod) }));
    const byMethod = methods.map(d => ({ key: 'method:' + d.id, label: d.name, values: seriesFor(state.stratAsset, d.id) }));
    const rows = (selected.results || []).filter(r => r.p === state.stratPanel && r.a === state.stratAsset);
    const amountSpread = rows.length ? Math.max(...rows.map(r => r.end)) - Math.min(...rows.map(r => r.end)) : 0;
    const annualSpread = rows.length ? Math.max(...rows.map(r => r.irr)) - Math.min(...rows.map(r => r.irr)) : 0;
    const verified = meta.modelVersion >= 2 && meta.initialCashIncluded;
    const controls = '<div class="strategy-control-bar"><div class="segmented" aria-label="资金情境">' + action('已有一笔钱', 'strategy-panel', state.stratPanel === 'initial' ? 'active' : '', 'data-value="initial"') + action('持续有新收入', 'strategy-panel', state.stratPanel === 'dca' ? 'active' : '', 'data-value="dca"') + '</div>' +
      '<div class="strategy-year-picker"><span>回测起点</span><div class="strategy-year-buttons">' + summaries.map(item => action(item.year + '起', 'strategy-year', String(item.year) === state.stratYear ? 'active' : '', 'data-value="' + item.year + '" aria-pressed="' + (String(item.year) === state.stratYear) + '"')).join('') + '</div></div></div>';
    const context = '<p class="strategy-context' + (verified ? '' : ' warn') + '">实际共同交易日 ' + esc(meta.start) + ' → ' + esc(meta.end) + ' · ' + available.size + '只ETF有完整同期间行情 · ' + (verified ? '现金计入账户' : '模型待核验') + ' · 暂未计入交易税费</p>';
    const assetCard = a => {
      const enabled = available.has(a.c), first = (rootMeta.assetStarts || {})[a.c];
      const detail = enabled ? a.lev === '1x' ? '普通 ETF' : '每日目标杠杆' : first ? first.slice(0, 4) + '年起' : '当前不可选';
      return action('<span class="strategy-asset-multiple">' + esc(a.lev) + '</span><strong>' + esc(a.c) + '</strong><small>' + esc(detail) + '</small>', 'strategy-asset', 'strategy-asset-card' + (a.lev === '1x' ? '' : ' leveraged') + (state.stratAsset === a.c ? ' active' : '') + (enabled ? '' : ' unavailable'), 'data-value="' + esc(a.c) + '" aria-label="' + esc(a.g + ' ' + a.c + ' ' + a.lev + ' ' + detail) + '" aria-pressed="' + (state.stratAsset === a.c) + '"' + (enabled ? '' : ' disabled'));
    };
    const baseAssets = assets.filter(a => a.lev === '1x');
    const assetFamilies = baseAssets.map(base => '<div class="strategy-asset-family"><div class="strategy-family-title"><strong>' + esc(base.g) + '</strong><span>1×' + (state.showLeverageAssets && leveraged.length ? ' / 2× / 3×' : '') + '</span></div>' +
      [base, ...(state.showLeverageAssets && leveraged.length ? assets.filter(a => a.g === base.g && a.lev !== '1x') : [])].map(assetCard).join('') + '</div>').join('');
    const assetShelf = '<section class="strategy-asset-shelf"><div class="strategy-asset-heading"><div><h2>研究标的</h2><p>按市场或行业归类，选择普通、2×、3× ETF。</p></div><span>' + esc(state.stratAsset || '') + ' · ' + esc(state.stratYear) + '起</span></div>' +
      (leveraged.length ? '<div class="strategy-leverage-tools">' + action((state.showLeverageAssets ? '收起' : '展开') + ' 2× / 3× 杠杆 ETF <b>' + leveraged.length + '只</b>', 'strategy-leverage-picker', 'strategy-leverage-toggle' + (state.showLeverageAssets ? ' active' : ''), 'aria-expanded="' + state.showLeverageAssets + '"') + '<span>每日目标倍数，不是长期收益倍数；半导体组仅按行业归类</span></div>' : '<p class="strategy-unavailable">该起点没有可用于完整同期间比较的杠杆 ETF。</p>') +
      '<div class="strategy-asset-families">' + assetFamilies + '</div></section>';
    const sharedRisk = state.stratPanel === 'dca' && rows.length > 0 && rows.every(r => r.mdd === rows[0].mdd && r.uw === rows[0].uw && r.exp === rows[0].exp);
    const profitCell = r => '<span class="' + (r.end < r.inv ? 'negative' : 'positive') + '">' + (r.end >= r.inv ? '+' : '−') + '$' + money(Math.abs(r.end - r.inv)) + '</span>';
    const results = '<div class="card strategy-results-card"><div class="table-caption"><span>' + esc(state.stratAsset) + ' · ' + (state.stratPanel === 'initial' ? '首日资金 $' + money(meta.initial) : '基础月度预算 $' + money(meta.monthly)) + ' · 美元</span><span>比较投入额、账面盈亏、年化与风险</span></div>' +
      '<div class="table-wrap" tabindex="0" aria-label="投入策略结果表，可横向滚动"><table class="research-table strategy-results-table"><thead><tr><th>投入方式</th><th>累计投入</th><th>期末资产</th><th title="期末资产减累计投入，未扣交易税费">账面盈亏</th><th title="资金加权年化收益率">年化收益 XIRR</th><th>最差账面盈亏</th><th>低于本金最长<span class="strategy-th-unit">交易日</span></th><th>最大回撤</th><th>最长回撤时间<span class="strategy-th-unit">交易日</span></th><th>平均仓位</th><th>交易次数</th></tr></thead><tbody>' +
      rows.map(r => { const def = definitions.find(d => d.id === r.s); return '<tr><td>' + (def ? esc(def.name) : esc(r.s)) + '</td><td>$' + money(r.inv) + '</td><td>$' + money(r.end) + '</td><td>' + profitCell(r) + '</td><td>' + pc(verified ? r.irr : null) + '</td><td>' + pc(meta.modelVersion >= 5 ? r.worst_paid : null, 1) + '</td><td>' + money(meta.modelVersion >= 5 ? r.below_paid : null) + '</td><td>' + pc(verified ? r.mdd : null, 1) + '</td><td>' + money(r.uw) + '</td><td>' + pct(r.exp, 1, false) + '</td><td>' + r.tr + '</td></tr>'; }).join('') + '</tbody></table></div><div class="panel-foot"><span>最差账面盈亏按每日账户金额相对当日累计投入计算；最长天数按连续交易日。净值回撤剔除新增入金。' + (sharedRisk ? ' 满仓持有同一 ETF 时，净值风险与仓位相同；账户亏损和 XIRR 仍因入金节奏而变。' : '') + '</span>' + (leveraged.some(a => a.c === state.stratAsset) ? '<a class="text-link" href="docs/strategy-leverage-audit.md" target="_blank" rel="noopener">核对杠杆收益 ↗</a>' : '') + '</div></div>' +
      '<details class="strategy-rules"><summary>查看投入方式的计算规则</summary><div class="rule-list">' + methods.map((d, i) => '<div class="rule-item"><span class="rule-number">0' + (i + 1) + '</span><div><h3>' + esc(d.name) + '</h3><p>' + esc(d.desc) + '</p></div></div>').join('') + '</div></details>';
    const chartAssetChip = a => action(esc(a.g) + ' <strong>' + esc(a.c) + '</strong>', 'strategy-asset', 'strategy-curve-asset' + (state.stratAsset === a.c ? ' active' : ''), 'data-value="' + esc(a.c) + '" aria-pressed="' + (state.stratAsset === a.c) + '"');
    const chartAssets = '<div class="strategy-curve-assets"><span>研究标的</span><div>' + ordinary.map(chartAssetChip).join('') +
      (leveraged.length ? action(state.showLeverageAssets || leveraged.some(a => a.c === state.stratAsset) ? '收起杠杆 ETF' : '杠杆 ETF（' + leveraged.length + '）', 'strategy-leverage-picker', 'strategy-curve-more') : '') +
      (state.showLeverageAssets || leveraged.some(a => a.c === state.stratAsset) ? leveraged.map(chartAssetChip).join('') : '') + '</div></div>';
    const chart = '<div class="strategy-curve-toolbar"><div class="strategy-curve-modes"><div class="segmented" aria-label="比较对象">' + action('比较标的', 'strategy-compare', state.stratCompare === 'assets' ? 'active' : '', 'data-value="assets" aria-pressed="' + (state.stratCompare === 'assets') + '"') + action('比较投入方式', 'strategy-compare', state.stratCompare === 'methods' ? 'active' : '', 'data-value="methods" aria-pressed="' + (state.stratCompare === 'methods') + '"') + '</div><div class="segmented" aria-label="曲线指标">' + action('账户金额', 'strategy-metric', state.stratMetric === 'amount' ? 'active' : '', 'data-value="amount" aria-pressed="' + (state.stratMetric === 'amount') + '"') + action('年化收益', 'strategy-metric', state.stratMetric === 'annualized' ? 'active' : '', 'data-value="annualized" aria-pressed="' + (state.stratMetric === 'annualized') + '"') + '</div></div>' +
      (state.stratCompare === 'assets' ? '<div class="strategy-curve-choices"><div class="strategy-method-control"><span>统一投入方式</span>' + selectMenu('strategy-chart-method', '统一投入方式', methods.map(d => [d.id, d.name]), state.stratMethod) + '</div>' + (leveraged.length ? '<label class="check-label"><input id="show-leverage" type="checkbox"' + (state.leverage ? ' checked' : '') + '>显示杠杆 ETF（' + leveraged.length + '只）</label>' : '') + '</div>' : chartAssets) + '</div>' +
      curveCard(state.stratCompare === 'assets' ? '同图比较可用标的' : esc(state.stratAsset) + ' · 投入方式对比', state.stratCompare === 'assets' ? '同一投入方式、相同交易区间' : '同一标的、相同交易区间 · 期末金额差 $' + money(amountSpread) + '，XIRR 差 ' + money(annualSpread, 2) + ' 个百分点', state.stratCompare === 'assets' ? across : byMethod, dates, state.stratMetric, meta.start) +
      '<p class="note">账户金额包含投入本金；投入总额不同的方式需结合 XIRR 比较。杠杆 ETF 仅作路径实验，其每日倍数不等于长期倍数。</p>';
    return head('INVESTING RHYTHM', '投入策略', '比较同一资产的投入节奏，以及不同标的在同一条件下的历史路径。') +
      '<div class="tabs strategy-view-tabs" role="tablist" aria-label="投入策略视图">' + action('结果表', 'strategy-view', state.stratView === 'results' ? 'active' : '', 'data-value="results" role="tab" aria-selected="' + (state.stratView === 'results') + '"') + action('曲线对比', 'strategy-view', state.stratView === 'curves' ? 'active' : '', 'data-value="curves" role="tab" aria-selected="' + (state.stratView === 'curves') + '"') + '</div>' +
      controls + context + (state.stratView === 'results' ? assetShelf + results : chart) +
      '<p class="note">来源：' + esc(meta.source || '待核验') + '。历史回测受起点影响；零成本是假设，不能理解为可实现净收益。</p>';
  }
  function buyLocation() {
    const data = window.BUY_LOCATION_DATA;
    if (!data) return head('INVESTMENT CHANNELS', '投资渠道', '比较 SPY、QQQ 与国内场内、场外指数工具的历史税后结果。') + '<p class="notice red">比较数据未加载，请检查 data/buy-location.js。</p>';
    const config = { family: state.buyFamily, years: state.buyYears, plan: state.buyPlan,
      lumpAmount: state.buyLumpAmount, monthlyAmount: state.buyMonthlyAmount, fees: state.buyFees, fundFees: state.buyFundFees, exchangeBasis: state.buyBasis };
    const result = M.buyLocationResult(data, config);
    const feeField = (key, label, unit, hint = '') => '<label>' + label + '<span class="buy-field"><input type="number" min="0" max="' + (key.endsWith('Minimum') ? '1000000' : '100') + '" step="any" inputmode="decimal" data-buy-input="' + key + '" value="' + esc(state.buyFees[key]) + '"><span>' + unit + '</span></span>' + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
    const fundFeeFields = data.products.filter(p => p.family === state.buyFamily && p.channel === 'off').map(p => {
      const values = state.buyFundFees[p.code];
      return '<div class="buy-fund-fees"><span>' + esc(p.code + ' · ' + p.name) + '</span><div class="buy-fee-grid">' +
        ['subscription', 'redemption'].map(key => '<label>' + (key === 'subscription' ? '申购费' : '赎回费') + '<span class="buy-field"><input type="number" min="0" max="100" step="any" inputmode="decimal" data-buy-fund="' + esc(p.code) + '" data-fee="' + key + '" value="' + esc(values[key]) + '"><span>%</span></span></label>').join('') + '</div></div>';
    }).join('');
    const familySelect = '<div class="segmented" aria-label="跟踪指数">' + action('标普500', 'buy-family', state.buyFamily === 'sp' ? 'active' : '', 'data-value="sp" aria-pressed="' + (state.buyFamily === 'sp') + '"') + action('纳斯达克100', 'buy-family', state.buyFamily === 'nq' ? 'active' : '', 'data-value="nq" aria-pressed="' + (state.buyFamily === 'nq') + '"') + '</div>';
    const yearSelect = '<div class="segmented" aria-label="比较期间">' + years.map(y => action(y + '年', 'buy-years', state.buyYears === y ? 'active' : '', 'data-value="' + y + '" aria-pressed="' + (state.buyYears === y) + '"')).join('') + '</div>';
    const planSelect = '<div class="segmented" aria-label="买入方式">' + action('一次买入', 'buy-plan', state.buyPlan === 'lump' ? 'active' : '', 'data-value="lump" aria-pressed="' + (state.buyPlan === 'lump') + '"') + action('每月定投', 'buy-plan', state.buyPlan === 'monthly' ? 'active' : '', 'data-value="monthly" aria-pressed="' + (state.buyPlan === 'monthly') + '"') + '</div>';
    const amountField = '<label class="buy-amount">' + (state.buyPlan === 'lump' ? '首笔投入' : '每月投入') + '<span class="buy-field"><input type="number" min="1" max="1000000000" step="100" inputmode="decimal" data-buy-input="' + (state.buyPlan === 'lump' ? 'buyLumpAmount' : 'buyMonthlyAmount') + '" value="' + esc(state.buyPlan === 'lump' ? state.buyLumpAmount : state.buyMonthlyAmount) + '"><span>元</span></span></label>';
    const controls = '<section class="buy-controls"><div class="buy-control"><span>跟踪指数</span>' + familySelect + '</div><div class="buy-control"><span>历史窗口</span>' + yearSelect + '</div><div class="buy-control"><span>投入方式</span>' + planSelect + '</div>' + amountField + '</section>';
    const basisControls = '<div class="buy-basis-bar"><div class="cross-basis"><span>场内 ETF</span><div class="segmented" aria-label="投资渠道场内收益口径">' + [['nav', '净值 · 剔除溢价'], ['market', '成交价 · 含溢价']].map(([v, label]) => action(label, 'buy-basis', state.buyBasis === v ? 'active' : '', 'data-value="' + v + '" aria-pressed="' + (state.buyBasis === v) + '"')).join('') + '</div></div><span>' + (state.buyBasis === 'nav' ? '按净值模拟买卖，仍扣券商佣金；实际成交可能有溢价。' : '按历史成交价模拟，计入买卖两端溢价变化。') + '</span><strong>分红已再投</strong></div>';
    const constrained = data.products.filter(p => p.family === state.buyFamily && p.channel === 'off').map(p => {
      const f = funds.find(item => item.c === p.code);
      return f && (/暂停/.test(f.st || '') || /限/.test(f.st || '')) ? p.code + ' ' + (f.st || '交易待核验') + (f.lm && f.lm !== '--' ? '，单日' + f.lm : '') + (f.navdate ? '（快照 ' + f.navdate + '）' : '') : null;
    }).filter(Boolean);
    const availability = constrained.length ? '<p class="notice warn buy-availability"><strong>当前场外申购限制：</strong>' + esc(constrained.join('；')) + '。下方是历史可投资条件模拟，当前无法按输入金额直接复现；状态以基金研究快照为准。</p>' : '';
    const assumptions = '<details class="buy-assumptions" open><summary><strong>自定义交易、换汇与税费</strong><span>当前为示例费率，按你的券商与基金渠道修改</span></summary><div class="buy-assumption-grid">' +
      '<div><h3>香港券商买美股 ETF</h3><div class="buy-fee-grid">' + feeField('usCommission', '每笔佣金', '%') + feeField('usMinimum', '最低佣金', '美元') + feeField('fxSpread', '换汇单边价差', '%') + '</div></div>' +
      '<div><h3>国内场内 ETF</h3><div class="buy-fee-grid">' + feeField('exchangeCommission', '每笔佣金', '%') + feeField('exchangeMinimum', '最低佣金', '元') + '</div><h3>国内场外基金</h3>' + fundFeeFields + '<p>申购费是示例渠道折扣；赎回费对全部份额使用同一费率。定投份额持有期不同，按费档核对。</p></div>' +
      '<div><h3>大陆税收居民 · 美股 ETF</h3><div class="buy-fee-grid">' + feeField('usDividendTax', '美国分红预扣', '%') + feeField('cnDividendTax', '境内股息税率', '%') + feeField('capitalGainsTax', '卖出收益税率', '%') + '</div><p>默认按 W-8BEN 适用10%美股股息预扣；境内股息按20%并抵免已缴美税，卖出正收益按20%。实际抵免和计税基础以申报结果为准。</p></div>' +
      '</div></details>';
    const feeText = code => {
      if (code === 'SPY') return '0.0945%';
      if (code === 'QQQ') return '0.18%';
      const f = funds.find(item => item.c === code);
      if (!f || !M.finite(f.annualFee)) return '待核验';
      return (f.feeCoverage === 'complete' ? '' : '≥') + pct(f.annualFee, 2, false);
    };
    const channelText = { us: '香港券商 · 美股 ETF', exchange: '国内场内 ETF', off: '国内场外基金' };
    const table = result.error ? '<p class="notice red">' + esc(result.error) + '</p>' :
      '<section class="card buy-results"><div class="card-head"><div><h2>同一期间的税后账户结果</h2><p>' + esc(result.start) + ' → ' + esc(result.end) + ' · ' + (state.buyPlan === 'lump' ? '一次投入 ¥' + money(state.buyLumpAmount) : '每月投入 ¥' + money(state.buyMonthlyAmount) + '，共' + result.purchaseDays.length + '笔') + ' · 人民币</p></div>' + action('导出 CSV', 'buy-export', 'btn sm') + '</div>' +
      '<div class="table-wrap" tabindex="0" aria-label="购买渠道收益对比表，可横向滚动"><table class="research-table buy-table"><thead><tr><th>产品 / 渠道</th><th>持续费率 / 年<span class="strategy-th-unit">已含在行情中</span></th><th>累计投入</th><th>交易及换汇</th><th>美股股息税<span class="strategy-th-unit">预扣 + 境内补缴</span></th><th>卖出收益税</th><th>税后期末</th><th>累计收益</th><th>资金年化 XIRR</th></tr></thead><tbody>' +
      result.rows.map(row => {
        const product = data.products.find(p => p.code === row.code);
        if (row.error) return '<tr><td><strong>' + esc(product.name) + '</strong><span class="sub">' + esc(channelText[product.channel]) + ' · ' + esc(row.code) + '</span></td><td colspan="8">' + esc(row.error) + '</td></tr>';
        return '<tr><td><strong>' + esc(product.name) + '</strong><span class="sub">' + esc(channelText[row.channel]) + ' · ' + esc(row.code) + '</span>' +
          (row.channel === 'exchange' ? '<span class="sub buy-premium">' + (state.buyBasis === 'nav' ? '净值模拟 · 已剔除溢价' : '成交价复权 · 含溢价变化') + '</span>' : '') + '</td><td>' + feeText(row.code) + '</td><td>¥' + money(row.contributed) + '</td><td>¥' + money(row.transactionCost + row.fxCost) + '</td><td>¥' + money(row.usDividendTax + row.cnDividendTax) + '</td><td>¥' + money(row.capitalTax) + '</td><td><strong>¥' + money(row.terminal) + '</strong></td><td>' + pc(row.totalReturn) + '</td><td>' + pc(row.xirr) + '</td></tr>';
      }).join('') + '</tbody></table></div><div class="panel-foot"><span>持续费用已含于净值或复权价；现金分红已再投，美股 ETF 再扣投资者股息税。切换溢价口径仅改变场内价格序列。</span></div></section>';
    const distributions = '<details class="buy-method buy-distributions"><summary>各产品分红与拆分</summary><div class="buy-method-body"><div class="table-wrap"><table><thead><tr><th>产品</th><th>本区间现金分红</th><th>本区间拆分</th><th>收益处理</th><th>事件记录</th></tr></thead><tbody>' + data.products.filter(p => p.family === state.buyFamily).map(p => {
      const a = p.actions, within = e => result.start && e.date > result.start && e.date <= result.end;
      return '<tr><td>' + esc(p.name) + '<span class="sub">' + p.code + '</span></td><td>' + (a ? a.cash.filter(within).length + '次' : '缺事件记录') + '</td><td>' + (a ? a.splits.filter(within).map(e => e.date + ' · 1:' + e.factor).join('；') || '无' : '缺事件记录') + '</td><td>分红已再投' + (p.channel === 'us' ? '<span class="sub">已扣美股股息税</span>' : '') + '</td><td>' + action('查看', 'buy-actions', 'text-link', 'data-code="' + p.code + '"') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="note">统计区间 ' + esc(result.start || '—') + ' → ' + esc(result.end || '—') + '；现金分红进入总回报，份额拆分不创造额外收益。QDII 底层股息已反映在净值中。</p></div></details>';
    const key = '<div class="buy-key"><div><span class="eyebrow">TAX FIRST</span><h2>卖出时的税，已计入期末金额。</h2><p>以大陆税收居民经香港券商买入美国 ETF 为默认情境。香港账户不会自动免除境内境外所得申报；美国股息预扣、境内股息补缴和卖出正收益分别估算。</p></div><div class="buy-key-number"><strong>20%</strong><span>默认境外财产转让所得税率<br>只对本次卖出的估算正收益计税</span></div></div>';
    const notes = '<details class="buy-method"><summary>查看数据来源与计算边界</summary><div class="buy-method-body"><p>基于产品每日分红复权收盘价、场外基金分红再投净值及美元兑人民币实际日线。美股 ETF 使用同一日价格与汇率；每月定投在该月第一个共同交易日买入，期间股息税从账户扣除，期末全部卖出。手续费、换汇价差和投资者税费逐笔计算。场外基金按当天净值成交，未模拟申购确认时差、限购；场内默认按分红再投净值模拟买卖，剔除溢价但保留券商佣金；切换成交价后按复权收盘价模拟。净值不保证可成交，未模拟买卖价差、滑点和最小交易单位。汇率、境内纳税申报折算价、抵免及持有期间的费率变化可与个人实际交易不同。</p><p>国内基金投资者层面的申赎差价与分配在现行优惠口径下按0估算；QDII 底层可能已承担境外税，反映在净值中。美股 ETF 的历史复权价含产品运营费用，股息税按分红日折减；境外所得税抵免以简化的逐次股息模型估算。结果是历史条件模拟，不是个人税务申报金额。</p><div class="buy-sources">' +
      extLink('https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3970366/content.html', '个人所得税法') + extLink('https://www.chinatax.gov.cn/chinatax/n810219/n810744/n3752930/n3752974/c5143076/content.html', '境外所得及抵免公告') + extLink('https://www.chinatax.gov.cn/chinatax/n810341/n810765/n812203/200207/c1208424/content.html', '国内基金税收政策') + extLink('https://www.irs.gov/pub/irs-trty/china.pdf', '中美税收协定') + extLink('https://www.irs.gov/individuals/international-taxpayers/federal-income-tax-withholding-and-reporting-on-other-kinds-of-us-source-income-paid-to-nonresident-aliens', '美国税务局') + extLink('https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy', 'SPY 费用') + extLink('https://www.invesco.com/qqq-etf/en/market-outlook/whats-new-about-qqq.html', 'QQQ 费用') + '</div><div class="buy-sources">' + data.products.filter(p => p.family === state.buyFamily).map(p => extLink(p.source, p.code + ' 行情')).join('') + extLink(data.fxSource, '美元兑人民币汇率') + '</div><p>资料快照 ' + esc(data.asOf) + '；原始数据哈希和生成脚本保存在仓库。完整假设见 <a class="inline-link" href="docs/buy-location-method.md" target="_blank" rel="noopener">买入渠道研究方法</a>。</p></div></details>';
    return head('INVESTMENT CHANNELS', '投资渠道', '把 SPY、QQQ 与国内场内、场外工具放在同一人民币账户中，观察买入节奏、费用与税后的差别。') +
      key + controls + basisControls + availability + table + distributions + assumptions + notes;
  }
  function quality() {
    const q = window.DATA_QUALITY || { summary: {}, datasets: [] };
    const datasetLabel = d => ({ domestic_funds: '扩展基金研究池', funds: '海外基金基础样本' }[d.id] || d.label);
    const datasetDates = d => d.dateRange && d.dateRange[0] !== d.dateRange[1] ? d.dateRange.join(' → ') : d.asOf || d.asof || '各条目日期不同，见明细';
    const updateStates = (window.UPDATE_STATUS || {}).datasets || {};
    const runNote = d => {
      const item = updateStates[d.id === 'domestic_funds' ? 'screening' : d.id === 'benchmarks' ? 'funds' : d.id];
      if (!item) return '';
      const stamp = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录';
      const online = item.lastOnlineAttempt;
      return '<p class="note">最近运行：' + esc(stamp(item.attemptedAt)) + ' · ' + (item.mode === 'offline' ? '离线回放' : '在线更新') + ' · ' + esc({ cached: '缓存可读', success: '成功', checked: '检查通过', failed: '失败', partial: '部分失败' }[item.status] || item.status) + (online ? '<br>最近在线：' + esc(stamp(online.attemptedAt)) + ' · ' + esc({ success: '成功', failed: '失败', partial: '部分失败', checked: '检查通过' }[online.status] || online.status) : '') + '</p>';
    };
    const statusNames = { attention: '发现错误', checked: '计算检查通过', available: '已取得原始序列', error: '发现错误', unavailable: '缺少来源', failed: '更新失败', computed: '已重算' };
    const issueLabels = { funds: '费率生效日未核', benchmarks: '人民币风险缺汇率', stocks: '估值报告期未核', domestic_funds: '旧池收益待复算', indices: '万得微盘缺日线' };
    const coverage = d => {
      if (d.id === 'funds') return '收益已复算 ' + funds.filter(f => f.origin === 'overseas' && verifiedReturn(f)).length + ' / ' + d.records;
      if (d.id === 'stocks') return '历史收益已重算 ' + (window.STOCKS || []).filter(s => s.dataStatus === 'computed').length + ' / ' + d.records;
      if (d.id === 'domestic_funds') {
        const pending = (d.issues || []).find(i => i.code === 'domestic_basis_unverified');
        return '历史收益已复算 ' + (d.records - (pending?.affected?.length || 0)) + ' / ' + d.records;
      }
      return '';
    };
    const sources = [
      ['中证指数', 'https://www.csindex.com.cn/', '国内指数原始日线与指数身份'],
      ['国证指数', 'https://www.cnindex.com.cn/', '深证成指、创业板指日线'],
      ['万得指数', 'https://www.windindices.com/indices/zh/IndexF9/1a073179a3f0bebf923a0259cee963e4', '万得微盘股指数身份；尚无可复核完整日线'],
      ['天天基金 / 东方财富', 'https://fund.eastmoney.com/', '基金净值、申赎与费率资料'],
      ['Yahoo Finance', 'https://finance.yahoo.com/', '海外指数、复权ETF与汇率历史'],
      ['Investor.gov', 'https://www.investor.gov/introduction-investing/getting-started/asset-allocation', '资产配置、分散与再平衡方法']
    ];
    return head('DATA STATUS', '数据状态与来源', '查看各数据集的日期、覆盖范围和待补证据。', action('导出质量报告', 'export-quality', 'btn')) +
      '<div class="stats-grid">' + stat('公开国内指数', (window.INDEX_DATA || []).filter(r => ['available', 'cached'].includes(r.status)).length, '个', '指数源独立于基金产品') + stat('研究产品', funds.length, '只', '按基金代码去重') + stat('基础精简候选', shortlist.size, '只', '海外合格样本另纳入基金入口') + stat('待核验类别', q.summary.unverified || 0, '项', '逐项说明见下方') + '</div>' +
      '<div class="dataset-grid">' + (q.datasets || []).map(d => '<article class="dataset-card"><header><h3>' + esc(datasetLabel(d)) + '</h3>' + badge(statusNames[d.status] || issueLabels[d.id] || d.status, ['checked', 'available'].includes(d.status) ? 'green' : 'warn') + '</header><p>数据日期 ' + esc(datasetDates(d)) + (d.records != null ? ' · ' + d.records + '条' : '') + '</p>' + (coverage(d) ? '<p class="dataset-coverage">' + coverage(d) + '</p>' : '') + (d.issues && d.issues.length ? '<ul>' + d.issues.map(i => '<li>' + esc(i.message) + '</li>').join('') + '</ul>' : '') + runNote(d) + '</article>').join('') +
      (window.BUY_LOCATION_DATA ? '<article class="dataset-card"><header><h3>投资渠道</h3>' + badge('固定研究快照', 'warn') + '</header><p>行情截至 ' + esc(window.BUY_LOCATION_DATA.asOf) + ' · ' + window.BUY_LOCATION_DATA.products.length + '只产品</p><p>同日价格、净值及汇率经脚本构建；券商费用和投资者税率为可调整假设，税后结果是模拟值。</p><a class="text-link" href="docs/buy-location-method.md" target="_blank" rel="noopener">查看来源与计算边界 ↗</a></article>' : '') + '</div>' +
      '<div class="section-head"><h2>计算口径</h2></div><div class="quality-principles">' + [
        ['指数与产品', '指数取编制方日线；ETF 和基金按各自行情计算。'],
        ['收益周期', '不满完整周期留空；年化与累计可切换。'],
        ['缺失数据', '不以其他指数、币种或较短期间补齐。']
      ].map(([n, t]) => '<div><h3>' + n + '</h3><p>' + t + '</p></div>').join('') + '</div>' +
      '<div class="section-head"><h2>数据来源与核验资料</h2></div><div class="card pad"><div class="rule-list">' + sources.map(([n, url, text]) => '<div class="rule-item"><div><h3>' + extLink(url, n) + '</h3><p>' + text + '</p></div></div>').join('') + '</div><p class="note">更完整的方案比较、数据审计与测试记录见项目文档。' + '<a class="inline-link" href="docs/product-decisions.md" target="_blank" rel="noopener">产品决策</a> · <a class="inline-link" href="docs/data-pipeline-audit.md" target="_blank" rel="noopener">数据审计</a></p></div>';
  }
  function openModal(html) {
    const d = $('#dialog');
    if (!d.open) lastFocus = document.activeElement;
    d.innerHTML = html;
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }
  function modalTitle(title, sub = '') { return '<div class="detail-title"><div><h2 id="dialog-title">' + title + '</h2><p class="detail-sub">' + sub + '</p></div>' + action('×', 'close', 'close', 'aria-label="关闭弹窗"') + '</div>'; }
  function detailGrid(items) { return '<dl class="detail-grid">' + items.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>'; }
  function returnTable(r, record) {
    return '<div class="table-wrap"><table><thead><tr>' + years.map(y => '<th>' + periodHead(y) + '</th>').join('') + '</tr></thead><tbody><tr>' + years.map((y, i) => '<td>' + pc(ret(r && r[i], y, record)) + '</td>').join('') + '</tr></tbody></table></div>';
  }
  function openFund(code) {
    const f = funds.find(x => x.c === code); if (!f) return;
    const cross = state.route === 'indices' && state.indexTab === 'crossborder';
    const perf = cross ? crossPerformance(f) : f;
    const basis = cross && f.exchange && state.crossBasis === 'market' ? '成交价复权 · 含溢价与分红' : '净值总回报 · 剔除溢价 · 分红再投';
    const rule = (policy.byCode || {})[code];
    const fees = (f.fee || []).map(x => pct(x, 2, false));
    openModal(modalTitle(esc(f.n), esc(f.c) + ' · ' + esc(f.exchange ? '场内交易' : '场外申赎') + ' · ' + esc(f.ix)) +
      '<div class="pill-row">' + badge(/增强/.test(f.n + f.ix) ? '指数增强' : f.active ? '主动管理' : '指数 / 规则工具') + (f.dividend ? badge('红利是权益风格') : '') + badge(verifiedReturn(f) ? '收益已复算' : '历史字段待逐项核验', verifiedReturn(f) ? 'green' : 'warn') + '</div>' +
      (rule ? '<div class="notice"><strong>' + (rule.tier === 'shortlist' ? '权益候选：' : '研究池：') + '</strong>' + esc(rule.reason) + '<br>' + esc((rule.flags || []).join('；')) + '</div>' : '') +
      '<h3 class="detail-heading">' + basis + '</h3>' + returnTable(perf.r, perf) + '<p class="note">收益截至：' + esc(metricDate(perf, 'return')) + ' · ' + esc(f.historyNote || f.returnNote || '有实际区间时按日期跨度年化；旧快照无基期时按名义年数计算。完整周期不足留空。') + '</p>' +
      detailGrid([
        ['管理 / 托管 / 销售服务费（年）', fees.join(' / ') || '待核验'],
        ['买入费用', buyFee(f) + (f.exchange ? '，按实际券商约定' : '<span class="sub">原费率 / 历史渠道折扣，生效日待核验</span>')],
        ['卖出费用', redemption(f, true)],
        ['申购状态 / 日限额', f.exchange ? '场内交易；不使用场外申赎限制' : esc(f.st || '未收录') + ' / ' + (/暂停/.test(f.st) ? '暂停期间无可用额度' : esc(f.lm || '未收录'))],
        ['单位净值 / 日期', money(f.nav, 4) + ' / ' + esc(f.navdate || '未收录')],
        ['规模 / 成立日', money(f.sz, 1) + '亿元 / ' + esc(f.d) + (f.szdate ? '<span class="sub">规模截至：' + esc(f.szdate) + '</span>' : '')],
        ['近5年最大回撤 / 波动率', pct(perf.mdd5, 2, false) + ' / ' + pct(perf.vol5, 2, false) + '<span class="sub">截至：' + esc(metricDate(perf, 'risk')) + '</span>'],
        (Number.isFinite(f.mdd3) || Number.isFinite(f.v3) ?
          ['近3年净值回撤 / 波动率', pct(f.mdd3, 2, false) + ' / ' + pct(f.v3, 2, false) +
            '<span class="sub">截至：' + esc(metricDate(f, 'risk')) + '</span>'] : null),
        ['现任经理 / 本基金任期', managerText(f, true) + '<span class="sub">任期截至：' + esc(f.managerAsOf || '未记录') + '</span>'],
        (f.exchange || Number.isFinite(f.p) ? ['交易价 / 快照溢价', money(f.p, 3) + ' / ' + pct(f.prem) +
          (f.priceAsOf || f.quotedAt ? '<span class="sub">报价时间：' + esc(f.priceAsOf || f.quotedAt) + '；快照非实时</span>' : '')] : null)
      ].filter(Boolean)) +
      (crossEvidence(code) ? '<div class="fund-distribution-summary"><strong>分红与溢价</strong><span>' + basis + '</span>' + action(distributionLabel(code) + ' · 查看记录', 'fund-actions', 'text-link', 'data-code="' + code + '"') + '</div>' : '') +
      '<div class="actions">' + (cross ? extLink(perf.source, '当前回报原始来源') : '') + extLink(f.managerSourceUrl || 'https://fundf10.eastmoney.com/jjjl_' + code + '.html', '经理任职原文') + extLink('https://fund.eastmoney.com/' + code + '.html', '净值与基金资料') + extLink('https://fundf10.eastmoney.com/jjfl_' + code + '.html', '买入卖出费率') + extLink('https://fundf10.eastmoney.com/jjgg_' + code + '.html', '正式公告') + '</div>' +
      '<p class="note">经理资料采集：' + esc(stamp(f.managerCheckedAt)) + '；持续费率采集：' + esc(stamp(f.feeCheckedAt)) + '。' + (f.exchange ? '交易佣金以实际券商约定为准，未知费项不按0处理。' : '赎回费旧档缺少持有期映射，不能用于精确估算；未知费用不按0处理。') + esc(f.note || '') + '</p><div class="dialog-footer">' + action((cross ? state.crossSelected : state.selected).has(code) ? '移出对比' : '加入对比', cross ? 'cross-select' : 'compare-toggle', 'btn primary', 'data-code="' + code + '"') + '</div>');
  }
  function openIndex(i) {
    const rows = indexRows();
    const x = rows[i]; if (!x) return;
    const isDomestic = (window.INDEX_DATA || []).includes(x), displayCurrency = isDomestic ? 'cny' : state.currency;
    const r = isDomestic ? x.r : x[displayCurrency];
    const risk = isDomestic ? { mdd: x.mdd5, vol: x.vol5 } : x[displayCurrency === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
    openModal(modalTitle(esc(x.n), esc(x.c || x.symbol || x.tp || '')) + '<div class="notice">' + esc(basisText(x.basis)) + '。' + esc(x.note || '') + '</div>' + returnTable(r, x) +
      detailGrid([['数据截至', esc(x.asof || x.asOf || '未核验')], ['实际序列起点', esc(x.first || (x.periods && x.periods.length && x.periods[x.periods.length - 1].start) || '查看原始来源')], ['指数发布日', esc(x.launchDate || '见编制机构')], ['近5年回撤 / 年化波动', pct(risk.mdd, 2, false) + ' / ' + pct(risk.vol, 2, false) + '<span class="sub">' + (displayCurrency === 'usd' ? '美元' : '人民币') + '</span>'], ['数据源', esc(x.source || '见供应商日线')], ['周年窗口基准日', esc((x.baseDates || []).map((d, j) => years[j] + '年：' + (d || '不足')).join('；') || (x.periods || []).map(p => p.years + '年：' + p.start + ' → ' + p.end).join('；') || '各期间实际日期见原始数据')]]) +
      (risk.reason ? '<div class="notice warn">' + esc(risk.reason) + (risk.missingFxDates ? '。缺失日期：' + esc(risk.missingFxDates.join('、')) : '') + '</div>' : '') +
      (x.backfilledPeriods && x.backfilledPeriods.length ? '<div class="notice warn">近' + x.backfilledPeriods.join(' / ') + '年包含发布前回溯；这部分不是当时可投资的指数实绩。</div>' : '') +
      '<div class="actions">' + extLink(x.sourceUrl || x.source, '原始行情来源') + (x.identityUrl ? extLink(x.identityUrl, '官方指数说明') : '') + (displayCurrency === 'cny' && x.fxSourceUrl ? extLink(x.fxSourceUrl, '美元兑人民币汇率') : '') + '</div><div class="dialog-footer">' + action('在基金库搜索此标的', 'find-index-funds', 'btn primary', 'data-value="' + esc(x.n.replace(/指数$/, '')) + '"') + '</div>');
  }
  function openDividendStock(s) {
    openModal('<div class="stock-detail stock-dividend-detail">' + modalTitle(esc(s.n), s.c + ' · ' + esc(s.businessLabel || s.ind)) + stockDeepLink(s, 'btn sm') +
      '<h3 class="detail-heading">分红与长期收益</h3>' + detailGrid([
        ['近12月股息率', pct(s.yield12, 2, false) + '<span class="sub">截至 ' + esc(s.dividendAsOf || '缺日期') + '</span>'],
        ['近5年分红年数', (s.divYears == null ? '缺完整分红年度证据' : s.divYears + ' / 5') + '<span class="sub">' + esc(s.dividendWindow || '缺分红年度') + '</span>'],
        ['现价 / 市值', '¥' + money(s.price, 2) + ' / ' + money(s.mcap, 1) + '亿元'],
        ['5年最大回撤 / 波动率', pct(s.mdd5, 2, false) + ' / ' + pct(s.vol5, 2, false)],
      ]) + returnTable(s.r, s) + '<h3 class="detail-heading">估值与财务</h3>' + detailGrid([
        ['PE / TTM', money(s.pe, 2)], ['动态PE', stockDynamic(s)], ['静态PE / PB（MRQ）', money(s.peStatic, 2) + ' / ' + money(s.pb, 2)],
        ['PE-TTM分位 / 5年', stockPercentile(s, 5)], ['PE-TTM分位 / 10年', stockPercentile(s, 10)], ['最新报告 ROE', stockRoe(s)],
      ]) + '<p class="note">' + esc(basisText(s.returnBasis)) + '；收益截至 ' + esc(s.returnAsOf || '未记录') + '，估值截至 ' + esc(s.valuationAsOf || '未记录') + '，风险截至 ' + esc(s.riskAsOf || '未记录') + '。</p><div class="actions">' + extLink(s.valuationSourceUrl, 'PE / PB 估值来源') + extLink(s.fundamentalsSourceUrl, '财报数据来源') + extLink(s.sourceUrl, '复权日线来源') + '</div></div>');
  }
  function openStock(code) {
    const s = (window.STOCKS || []).find(x => x.c === code); if (!s) return;
    if (s.group === 'dividend') { openDividendStock(s); return; }
    if (!M.stockMatches(s, 'quality') && !M.stockMatches(s, 'growth')) return;
    const review = state.stockTab === 'growth' ? s.growthReview : s.longTermReview?.qualified ? s.longTermReview : s.growthReview, research = s.qualityResearch;
    const latest = s.latestFinancials;
    const reports = [latest, ...(s.financialHistory5 || s.financialHistory || [])].filter((r, i, all) => r && all.findIndex(x => x?.reportDate === r.reportDate) === i);
    const thesis = '<section class="stock-thesis"><div class="stock-thesis-title"><h3>入选理由</h3></div><p class="stock-business">' + esc(research.title) + '</p><ul class="stock-evidence-list">' +
      [...research.thesis, ...(review.reasons || []).filter(t => !t.startsWith('3年平均ROE'))].map(t => '<li>' + esc(t) + '</li>').join('') + '</ul><div class="actions">' + stockDeepLink(s, 'btn sm') + stockReportLink(s) + '</div></section>' +
      '<section class="stock-watchouts"><h3>风险</h3><ul>' + stockRisks(s).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></section>';
    const latestSummary = '<h3 class="detail-heading">' + esc(reportLabel(latest)) + '</h3><div class="stock-growth-summary">' +
      [['报告期 ROE', pct(latest?.roe, 2, false), M.finite(latest?.roePrevious) ? '上年同期 ' + pct(latest.roePrevious, 2, false) : '缺上年同期ROE'], ['营收同比', stockGrowth(latest, 'revenue'), '与上年同期相比'], ['归母利润同比', stockGrowth(latest, 'netProfit'), '与上年同期相比'], ['扣非利润同比', stockGrowth(latest, 'deductedProfit'), '与上年同期相比']].map(([label, value, period]) => '<div><span>' + label + '</span><strong>' + value + '</strong><small>' + esc(period) + '</small></div>').join('') + '</div>';
    const financials = '<details class="stock-screen-details"><summary>历史财务 · 营收、利润、现金流与年度 ROE</summary><p class="note">' + esc((s.financialHistory5 || []).map(r => r.year).sort().join('、')) + ' 年平均年度 ROE：' + pct(s.longTermReview?.roe5, 2, false) + '。</p><div class="table-wrap"><table class="stock-report-table"><thead><tr><th>报告期</th><th>营收 / 亿元</th><th>营收同比</th><th>归母利润 / 亿元</th><th>归母利润同比</th><th>扣非利润同比</th><th>经营现金流 / 亿元</th><th>加权平均ROE</th><th>公告日</th></tr></thead><tbody>' + reports.map(r => '<tr><td>' + esc(reportLabel(r)) + '</td><td>' + money(M.finite(r.revenue) ? r.revenue / 1e8 : null, 2) + '</td><td>' + stockGrowth(r, 'revenue') + '</td><td>' + money(M.finite(r.netProfit) ? r.netProfit / 1e8 : null, 2) + '</td><td>' + stockGrowth(r, 'netProfit') + '</td><td>' + stockGrowth(r, 'deductedProfit') + '</td><td>' + money(M.finite(r.operatingCashFlow) ? r.operatingCashFlow / 1e8 : null, 2) + '</td><td>' + pct(r.roe, 2, false) + '</td><td>' + esc(r.announcedAt) + '</td></tr>').join('') + '</tbody></table></div><p class="note">中报、季报均为年初至报告期末的累计金额；同比与上年同期比较。ROE 为该报告期数值，未将中报 ROE 年化。扣非利润为扣除非经常性损益后的归母净利润。</p></details>';
    const checks = review ? '<details class="stock-screen-details"><summary>财务条件与报告核对 · ' + review.checks.length + '项</summary><div class="stock-checks">' + review.checks.map(c => '<span class="' + (c.pass ? 'passed' : 'missed') + '">' + (c.pass ? '✓ ' : '— ') + esc(c.label) + (!c.pass && c.reason ? '<small>' + esc(c.reason) + '</small>' : '') + '</span>').join('') + '</div><p class="note">核算于 ' + esc(review.checkedAt) + '。业务依据对应所链接的公司报告；财报更新时重新核算，经营前景和估值仍有不确定性。</p></details>' : '';
    const valuationBasis = '<details class="stock-screen-details"><summary>PE口径与历史分位</summary><p class="note">TTM使用最近12个月归母利润；静态PE使用上一完整年度利润；动态PE使用估值日已公告的最新累计归母利润，按报告月份年化，不是分析师预测，季节性会影响结果。动态PE所用报告：' + esc(s.peDynamicBasis?.reportDate || '缺报告') + '，公告于 ' + esc(s.peDynamicBasis?.announcedAt || '—') + '。</p><div class="table-wrap"><table><thead><tr><th>PE-TTM分位</th><th>取样窗口</th><th>实际首末记录</th><th>正PE样本</th><th>剔除非正 / 缺失PE</th></tr></thead><tbody>' + [5, 10].map(y => {
      const p = s.pePercentiles?.[y];
      return '<tr><td>' + y + '年 · ' + (M.finite(p?.value) ? pct(p.value, 1, false) : esc(p?.reason || '缺历史估值')) + '</td><td>' + esc(p?.start || '—') + ' → ' + esc(p?.end || '—') + '</td><td>' + esc(p?.observedStart || '—') + ' → ' + esc(p?.observedEnd || '—') + '</td><td>' + (p?.samples ?? '—') + '</td><td>' + (p?.excluded ?? '—') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="note">分位按各交易日当时的PE-TTM计算；低于当前值的样本计1，相等计0.5，除以正PE样本数。PE统一保留两位小数，重复日期去重。2018年起采用东方财富，之前采用通过重叠区间核对的亿牛历史记录；两源历史修订与财报入库时点可能不同。分位越低代表相对自身历史越低，不代表未来收益越高。</p><div class="actions">' + extLink(s.peHistorySourceUrl, '每日PE历史') + (s.pePercentiles?.['10']?.legacySource ? extLink(s.pePercentiles['10'].legacySource, '2018年前历史来源') : '') + '</div></details>';
    openModal('<div class="stock-detail">' + modalTitle(esc(s.n), s.c + ' · ' + esc(s.businessLabel || s.ind)) + latestSummary + thesis + financials + checks +
      '<h3 class="detail-heading">估值与股东回报</h3>' + detailGrid([['PE / TTM', money(s.pe, 2) + '<span class="sub">估值截至 ' + esc(s.valuationAsOf || '缺交易日期') + '</span>'], ['动态PE', stockDynamic(s)], ['静态PE / PB（MRQ）', money(s.peStatic, 2) + ' / ' + money(s.pb, 2)], ['PE-TTM分位 / 5年', stockPercentile(s, 5)], ['PE-TTM分位 / 10年', stockPercentile(s, 10)], ['现价 / 市值', '¥' + money(s.price, 2) + ' / ' + money(s.mcap, 1) + '亿元'], ['近12月股息率', pct(s.yield12, 2, false)], ['近5年分红年数', s.divYears == null ? '缺完整分红年度证据' : s.divYears + ' / 5']]) + valuationBasis + returnTable(s.r, s) +
      '<p class="note">' + esc(basisText(s.returnBasis)) + '；收益截至 ' + esc(s.returnAsOf || '未记录') + '，风险截至 ' + esc(s.riskAsOf || '未记录') + '。分红窗口 ' + esc(s.dividendWindow || '未记录') + '，滚动股息截至 ' + esc(s.dividendAsOf || '未记录') + '。价格截至 ' + esc(s.priceAsOf || '未记录') + '。</p><div class="actions">' + (s.businessSourceUrl ? extLink(s.businessSourceUrl, '公司业务来源') : '') + extLink(s.valuationSourceUrl, 'PE / PB 估值来源') + extLink(s.fundamentalsSourceUrl, '财报数据来源') + extLink(s.sourceUrl, '复权日线来源') + '</div></div>');
  }
  function openCompare() {
    const selected = [...state.selected].map(c => funds.find(f => f.c === c)).filter(Boolean);
    if (selected.length < 2) return;
    const renderRow = (name, fn) => '<tr><td>' + name + '</td>' + selected.map(f => '<td>' + fn(f) + '</td>').join('') + '</tr>';
    openModal(modalTitle('把选择放在一起看', '最多4只 · 相同字段、相同期别；截至日不同的数值不计算排名或跟踪误差。') +
      '<div class="table-wrap" tabindex="0" aria-label="基金对比表，可横向滚动"><table class="compare-table"><thead><tr><th>比较维度</th>' + selected.map(f => '<th>' + esc(f.n) + '<span class="sub">' + f.c + '</span></th>').join('') + '</tr></thead><tbody>' +
      renderRow('投资策略', f => esc(f.ix)) + renderRow('现任经理 / 本基金任期', f => managerText(f, true)) + renderRow('成立日期', f => esc(f.d)) + renderRow('规模 / 亿元', f => money(f.sz, 1)) + renderRow('单位净值 / 日期', f => money(f.nav, 4) + ' / ' + esc(f.navdate)) + renderRow('收益截至', f => esc(metricDate(f, 'return'))) +
      years.map((y, i) => renderRow(periodHead(y), f => pc(ret(f.r[i], y, f)))).join('') +
      renderRow('5年最大回撤', f => pc(f.mdd5, 1)) + renderRow('5年波动率', f => pct(f.vol5, 1, false)) + renderRow('风险截至', f => esc(metricDate(f, 'risk'))) +
      renderRow('管理费 / 年', f => pct(f.fee && f.fee[0], 2, false)) + renderRow('托管费 / 年', f => pct(f.fee && f.fee[1], 2, false)) + renderRow('销售服务费 / 年', f => pct(f.fee && f.fee[2], 2, false)) + renderRow('买入费用', buyFee) + renderRow('卖出费用', f => redemption(f, true)) +
      renderRow('渠道 / 申购', f => f.exchange ? '场内交易' : esc(f.st || '待核验')) + renderRow('资料原文', f => extLink('https://fund.eastmoney.com/' + f.c + '.html', '基金资料')) +
      '</tbody></table></div><p class="note">缺失数据用—表示，不以0参与比较。费用折扣和赎回档位未经当前渠道确认；历史收益不等于未来收益。</p>');
  }
  function renderFundResults() {
    const result = $('#fund-results'); if (!result) return;
    const focus = document.activeElement;
    result.innerHTML = fundTable(fundRows());
    const bar = $('#comparison-bar'); if (bar) bar.outerHTML = compareBar();
    restoreFocus(focus);
  }
  function exportFunds() {
    const rows = [['名称', '代码', '策略', '渠道', '现任经理', '个人经理任职记录', '经理资料截至', '经理抓取时间', '经理来源',
      '成立日', '规模(亿元)', '规模日期', '单位净值', '日涨跌%', '净值截至', '交易价', '溢价%', '报价时间',
      '管理费%', '托管费%', '销售服务费%', '持续费率核对日', '买入费旧档', '卖出费旧档(持有期待核验)', '申购', '限额',
      '近5年最大回撤%', '近5年波动率%', '近3年最大回撤%', '近3年波动率%', '风险截至', '收益截至', '收益口径', '实际收益区间',
      ...years.map(y => '近' + y + '年累计%'), ...years.map(y => '近' + y + '年年化%'), '基金来源', '收益来源', '资料状态']];
    fundRows().forEach(f => rows.push([f.n, f.c, f.ix, f.exchange ? '场内' : '场外', f.mgr, JSON.stringify(f.managerRecords || []), f.managerAsOf, f.managerCheckedAt, f.managerSourceUrl,
      f.d, f.sz, f.szdate, f.nav, f.dz, f.navdate, f.p, f.prem, f.priceAsOf || f.quotedAt,
      ...[0, 1, 2].map(i => f.fee && f.fee[i]), f.feeCheckedAt, f.exchange ? '按实际券商约定' : f.buy, f.exchange ? '按实际券商约定' : f.rd, f.exchange ? '场内交易' : f.st, f.exchange || /暂停/.test(f.st) ? '' : f.lm,
      f.mdd5, f.vol5, f.mdd3, f.v3, metricDate(f, 'risk'), metricDate(f, 'return'), f.returnBasis, JSON.stringify(f.returnPeriods || []),
      ...f.r, ...f.r.map((r, i) => M.annualized(r, duration(f, years[i]))), 'https://fund.eastmoney.com/' + f.c + '.html', f.returnSourceUrl,
      verifiedReturn(f) ? '收益已复算；其他字段见个体核验记录' : '历史快照待核验；年化按名义周期估算']));
    download('长衡-基金研究.csv', M.csv(rows), 'text/csv;charset=utf-8'); toast('已导出当前筛选结果，含累计与年化两套口径');
  }
  function restoreFocus(previous) {
    if (!previous || previous.isConnected) return;
    const keys = ['action', 'value', 'code', 'period', 'column', 'screen'];
    const matches = [...$('#main').querySelectorAll('button,input,select,summary')];
    const next = matches.find(el => previous.id ? el.id === previous.id : keys.some(k => previous.dataset[k]) && keys.every(k => el.dataset[k] === previous.dataset[k]));
    if (!next) return;
    if (next.getClientRects().length) next.focus({ preventScroll: true });
    else if (next.closest('details')) next.closest('details').querySelector('summary').focus({ preventScroll: true });
  }
  function render() {
    const renderers = { overview: home, indices, funds: fundView, stocks, reports: reportsView, strategy: strategies, 'buy-location': buyLocation, quality };
    const focus = document.activeElement;
    document.title = '长衡 · ' + titles[state.route];
    const group = { indices: '研究对象', funds: '研究对象', stocks: '研究对象', reports: '研究对象', strategy: '研究方法', 'buy-location': '研究方法' }[state.route];
    $('#breadcrumb').innerHTML = (group ? '<span>' + group + '</span><span class="breadcrumb-separator" aria-hidden="true">/</span>' : '') + (state.route === 'reports' ? '<a href="#stocks">个股深入</a><span class="breadcrumb-separator" aria-hidden="true">/</span>' : '') + '<span aria-current="page">' + titles[state.route] + '</span>';
    $$('[data-route]').forEach(a => { const active = a.dataset.route === (state.route === 'reports' ? 'stocks' : state.route); a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#main').className = 'page-' + state.route;
    $('#main').innerHTML = renderers[state.route]();
    restoreFocus(focus);
  }
  function route() {
    const hash = location.hash.replace('#', ''), legacy = { us: 'funds', cn: 'funds', cnidx: 'indices', stock: 'stocks' };
    if (hash === 'main') { $('#main').focus(); return; }
    if (hash === 'us') { state.fundTab = 'all'; state.poolCategory = 'overseas'; }
    if (hash === 'cn') state.fundTab = 'equity';
    const reportMatch = hash.match(/^stock-report\/(\d{6})$/);
    state.reportCode = reportMatch ? reportMatch[1] : null;
    state.route = reportMatch ? 'reports' : titles[hash] ? hash : legacy[hash] || 'overview';
    if ($('#dialog').open) $('#dialog').close();
    render(); window.scrollTo(0, 0);
  }
  function go(name) { if (location.hash === '#' + name) { state.route = name; render(); } else location.hash = name; }
  document.addEventListener('click', event => {
    if (event.target.closest('.skip')) { event.preventDefault(); $('#main').focus(); $('#main').scrollIntoView(); return; }
    const homeEntry = event.target.closest('[data-home-tab]');
    if (homeEntry) {
      const tab = homeEntry.dataset.homeTab, target = homeEntry.getAttribute('href').slice(1);
      if (target === 'funds') { state.fundTab = tab; state.poolCategory = 'all'; state.query = ''; state.page = 1; }
      if (target === 'indices') state.indexTab = tab;
      if (target === 'stocks') { state.stockTab = tab; state.stockQuery = ''; state.stockSort = 'default'; }
      if (target === 'strategy') { state.stratPanel = tab; state.stratView = 'results'; }
      if (location.hash === '#' + target) { event.preventDefault(); render(); }
      return;
    }
    const currentMenu = event.target.closest('.select-menu,.column-picker');
    $$('.select-menu[open],.column-picker[open]').forEach(menu => { if (menu !== currentMenu) menu.open = false; });
    const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
    const act = button.dataset.action, val = button.dataset.value, code = button.dataset.code;
    switch (act) {
      case 'close': $('#dialog').close(); return;
      case 'annual': state.annual = val === '1'; savePrefs(); break;
      case 'menu-choice':
        switch (button.dataset.menu) {
          case 'benchmark-type': state.benchmarkType = val; break;
          case 'benchmark-currency': state.benchmarkCurrency = val; break;
          case 'fund-category': state.poolCategory = val; state.page = 1; break;
          case 'fund-channel': state.channel = val; state.page = 1; break;
          case 'strategy-chart-method': state.stratMethod = val; state.chartHidden.clear(); break;
          default: return;
        }
        break;
      case 'research-entry': {
        const target = button.dataset.route || 'funds';
        if (target === 'funds') { state.fundTab = val; state.poolCategory = 'all'; state.query = ''; state.page = 1; state.fundSort = 'default'; }
        if (target === 'indices') { state.indexTab = val; state.indexSort = 'default'; }
        if (target === 'strategy') { state.stratPanel = val; state.stratCompare = val === 'dca' ? 'methods' : 'assets'; state.stratView = 'results'; }
        if (target === 'buy-location') state.buyFamily = val;
        go(target); return;
      }
      case 'benchmark-detail': {
        const b = benchmark(); if (!b) return;
        openModal(modalTitle('标普500参照 · ' + esc(b.n), (state.benchmarkCurrency === 'cny' ? '人民币' : '美元') + ' · 截至 ' + esc(b.asOf)) + returnTable(b[state.benchmarkCurrency], b) + '<div class="notice" style="margin-top:20px">' + esc(basisText(b.basis)) + '。' + (b.basis === 'price_index' ? '价格指数与基金含分红回报的定义不同。' : 'SPY为含产品费用的ETF参照。') + (state.benchmarkCurrency === 'cny' ? '人民币回报包含汇率变化，实际区间列于下方。' : '当前显示美元回报，与人民币基金回报不直接计算差值。') + '</div>' + detailGrid((b.periods || []).map(p => ['近' + p.years + '年实际区间', esc(p.start) + ' → ' + esc(p.end)])) + '<div class="actions">' + extLink(b.sourceUrl || b.source, '原始行情来源') + (state.benchmarkCurrency === 'cny' ? extLink(b.fxSourceUrl, '汇率来源') : '') + '</div>'); return;
      }
      case 'columns-all': state.columns = new Set(Object.keys(columnNames)); savePrefs(); break;
      case 'columns-default': state.columns = new Set(defaultColumns); savePrefs(); break;
      case 'screen-reset': state.screen = { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null }; state.equityAll = false; state.page = 1; state.fundSort = 'default'; break;
      case 'equity-expand':
        screenOpen = true;
        state.equityAll = !state.equityAll;
        if (!state.equityAll) state.screen = { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null };
        state.page = 1; state.fundSort = 'default'; break;
      case 'cross-type':
      case 'cross-channel': {
        const set = act === 'cross-type' ? state.crossTypes : state.crossChannels;
        if (val === 'all') set.clear(); else if (set.has(val)) set.delete(val); else set.add(val);
        state.crossPage = 1; break;
      }
      case 'cross-premium': state.crossPremium = val === 'all' ? null : Number(val); state.crossPage = 1; break;
      case 'cross-basis': state.crossBasis = val; state.crossPage = 1; break;
      case 'cross-page': state.crossPage += Number(val); break;
      case 'cross-reset': state.crossTypes.clear(); state.crossChannels.clear(); state.crossQuery = ''; state.crossPremium = null; state.crossPurchasable = false; state.crossSort = 'default'; state.crossPage = 1; break;
      case 'cross-sort': state.crossDesc = state.crossSort === val ? !state.crossDesc : !['knownOngoingFee', 'prem', 'n'].includes(val); state.crossSort = val; state.crossPage = 1; break;
      case 'cross-select':
        if (state.crossSelected.has(code)) state.crossSelected.delete(code);
        else if (state.crossSelected.size < 4) state.crossSelected.add(code);
        else { toast('一次最多比较4只产品'); return; }
        if ($('#dialog').open) { render(); openFund(code); return; }
        break;
      case 'cross-clear': state.crossSelected.clear(); break;
      case 'cross-compare': openCrossCompare(); return;
      case 'cross-method': openCrossMethod(); return;
      case 'cross-export': {
        const rows = crossRows();
        download('长衡-跨境基金-' + state.crossBasis + '.csv', M.csv([['代码', '基金', '指数', '渠道', '收益口径', ...state.periods.map(periodHead), '收益截至', '快照溢价%', '报价日期', '持续费率%（已知）', '现金分红处理', '已收录分红次数'], ...rows.map(f => {
          const p = crossPerformance(f); return [f.c, f.n, f.ix, f.exchange ? '场内' : '场外', f.exchange && state.crossBasis === 'market' ? '成交价复权' : '净值总回报', ...state.periods.map(y => ret(p.r?.[years.indexOf(y)], y, p)), p.returnAsOf, f.prem, f.priceAsOf || f.quotedAt, f.knownOngoingFee, '已再投', crossEvidence(f.c)?.actions.cash.length];
        })]), 'text/csv;charset=utf-8'); return;
      }
      case 'fund-actions': {
        const f = funds.find(f => f.c === code); if (!f) return;
        openModal(modalTitle(esc(f.n) + ' · 分红与拆分', code) + distributionDetails(crossEvidence(code)?.actions)); return;
      }
      case 'stock-rules': stockRules(); return;
      case 'report-section': $('#report-' + val)?.scrollIntoView({ behavior: 'auto', block: 'start' }); return;
      case 'index-tab': state.indexTab = val; state.indexSort = 'default'; break;
      case 'stock-tab': state.stockTab = val; state.stockSort = 'default'; state.stockQuery = ''; state.stockCategory = 'all'; break;
      case 'stock-category': state.stockCategory = val; break;
      case 'stock-view': state.stockView = val; state.stockSort = 'default'; break;
      case 'index-sort':
        if (state.indexSort === val) { if (state.indexDescending) state.indexDescending = false; else { state.indexSort = 'default'; state.indexDescending = true; } }
        else { state.indexSort = val; state.indexDescending = true; }
        break;
      case 'index-sort-reset': state.indexSort = 'default'; state.indexDescending = true; break;
      case 'currency': state.currency = val; break;
      case 'index-detail': openIndex(Number(val)); return;
      case 'go-index-funds': state.fundTab = 'passive'; state.query = ''; state.page = 1; go('funds'); return;
      case 'find-index-funds': state.fundTab = 'all'; state.poolCategory = 'all'; state.query = val; state.page = 1; $('#dialog').close(); go('funds'); return;
      case 'fund-tab': state.fundTab = val; state.poolCategory = 'all'; state.page = 1; state.fundSort = 'default'; break;
      case 'fund-sort':
        if (state.fundSort === val) { if (state.descending) state.descending = false; else { state.fundSort = 'default'; state.descending = true; } }
        else { state.fundSort = val; state.descending = true; }
        state.page = 1; renderFundResults(); return;
      case 'fund-sort-reset': state.fundSort = 'default'; state.descending = true; state.page = 1; renderFundResults(); return;
      case 'fund-prev': state.page--; renderFundResults(); return;
      case 'fund-next': state.page++; renderFundResults(); return;
      case 'fund-reset': state.query = ''; state.poolCategory = 'all'; state.channel = 'all'; state.purchasable = false; state.page = 1; state.fundSort = 'default'; state.screen = { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null }; state.equityAll = false; break;
      case 'fund-detail': openFund(code); return;
      case 'export-funds': exportFunds(); return;
      case 'compare-toggle':
        if (state.selected.has(code)) state.selected.delete(code);
        else if (state.selected.size < 4) state.selected.add(code);
        else { toast('一次最多比较4只产品'); return; }
        renderFundResults(); if ($('#dialog').open) toast(state.selected.has(code) ? '已加入对比' : '已移出对比'); return;
      case 'compare-clear': state.selected.clear(); renderFundResults(); return;
      case 'compare-open': openCompare(); return;
      case 'screen-rules': openModal(modalTitle('长期权益，如何筛选', '规则生成日期 ' + esc(policy.asof || '未记录')) + '<div class="rule-list">' + (policy.rules || []).map((r, i) => '<div class="rule-item"><span class="rule-number">0' + (i + 1) + '</span><p>' + esc(r) + '</p></div>').join('') + '</div><p class="notice">原“综合分”保留为历史研究分；它不是未来概率，也不用于当前默认排序。完整研究池保留检索，研究候选不代表购买建议。</p>'); return;
      case 'stock-sort': state.stockDesc = state.stockSort === val ? !state.stockDesc : true; state.stockSort = val; break;
      case 'stock-detail': openStock(code); return;
      case 'strategy-panel': state.stratPanel = val; state.stratMethod = val === 'initial' ? 'lump_sum' : 'dca_month'; state.stratCompare = val === 'dca' ? 'methods' : 'assets'; state.chartHidden.clear(); break;
      case 'strategy-year': state.stratYear = val; state.chartHidden.clear(); break;
      case 'strategy-asset':
        state.stratAsset = val;
        if ((window.STRATEGY_ASSETS || []).some(a => a.c === val && a.lev !== '1x')) state.showLeverageAssets = true;
        break;
      case 'strategy-leverage-picker':
        state.showLeverageAssets = !state.showLeverageAssets;
        if (!state.showLeverageAssets && (window.STRATEGY_ASSETS || []).some(a => a.c === state.stratAsset && a.lev !== '1x')) state.stratAsset = 'SPY';
        break;
      case 'strategy-view': state.stratView = val; break;
      case 'strategy-compare': state.stratCompare = val; state.chartHidden.clear(); break;
      case 'strategy-metric': state.stratMetric = val; break;
      case 'buy-basis': state.buyBasis = val; break;
      case 'buy-actions': {
        const p = window.BUY_LOCATION_DATA?.products.find(p => p.code === code); if (!p) return;
        openModal(modalTitle(esc(p.name) + ' · 分红与拆分', code) + distributionDetails(p.actions, p.channel === 'us' ? '美元' : '元')); return;
      }
      case 'buy-family': state.buyFamily = val; break;
      case 'buy-years': state.buyYears = Number(val); break;
      case 'buy-plan': state.buyPlan = val; break;
      case 'buy-export': {
        const result = M.buyLocationResult(window.BUY_LOCATION_DATA, { family: state.buyFamily, years: state.buyYears,
          plan: state.buyPlan, lumpAmount: state.buyLumpAmount, monthlyAmount: state.buyMonthlyAmount, fees: state.buyFees, fundFees: state.buyFundFees, exchangeBasis: state.buyBasis });
        if (result.error) { toast(result.error); return; }
        const columns = ['产品代码', '产品名称', '渠道', '场内收益口径', '分红处理', '开始日', '结束日', '买入笔数', '累计投入CNY', '交易费用CNY', '换汇价差CNY', '美股股息预扣CNY', '境内股息补缴CNY', '卖出收益税CNY', '税后期末CNY', '累计收益%', 'XIRR%', '费用假设JSON'];
        download('长衡-买入渠道-' + result.end + '.csv', M.csv([columns, ...result.rows.filter(r => !r.error).map(r => [r.code, r.name,
          r.channel, r.exchangeBasis || '原渠道', '再投资', result.start, result.end, r.purchases, r.contributed, r.transactionCost, r.fxCost,
          r.usDividendTax, r.cnDividendTax, r.capitalTax, r.terminal, r.totalReturn, r.xirr, JSON.stringify({ ...state.buyFees, fundFees: state.buyFundFees })])]), 'text/csv;charset=utf-8');
        return;
      }
      case 'chart-line': state.chartHidden.has(val) ? state.chartHidden.delete(val) : state.chartHidden.add(val); break;
      case 'export-quality': download('长衡-数据质量.json', JSON.stringify(window.DATA_QUALITY || {}, null, 2)); return;
      default: return;
    }
    render();
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'report-search') { state.reportQuery = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => { const pos = el.selectionStart; render(); const input = $('#report-search'); if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(pos, pos); } }, 120); return; }
    if (el.id === 'fund-search') { state.query = el.value; state.page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(renderFundResults, 120); }
    if (el.id === 'cross-search') {
      state.crossQuery = el.value; state.crossPage = 1; clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { render(); $('#cross-search')?.focus(); }, 180);
    }
    if (el.id === 'stock-search') {
      state.stockQuery = el.value; clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { const value = state.stockQuery; render(); const input = $('#stock-search'); if (input) { input.focus(); input.value = value; } }, 200);
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'cross-purchasable') { state.crossPurchasable = el.checked; state.crossPage = 1; render(); return; }
    if (el.dataset.buyFund) {
      if (!el.checkValidity() || !el.value.trim() || !Number.isFinite(Number(el.value))) { toast('请输入0至100之间的费率'); render(); return; }
      const code = el.dataset.buyFund, fee = el.dataset.fee;
      if (state.buyFundFees[code] && ['subscription', 'redemption'].includes(fee)) state.buyFundFees[code][fee] = Number(el.value);
      render(); return;
    }
    if (el.dataset.buyInput) {
      if (!el.checkValidity() || !el.value.trim() || !Number.isFinite(Number(el.value))) { toast('请输入有效的非负数值'); render(); return; }
      const value = Number(el.value), key = el.dataset.buyInput;
      if (key === 'buyLumpAmount' || key === 'buyMonthlyAmount') state[key] = value;
      else if (Object.hasOwn(state.buyFees, key)) state.buyFees[key] = value;
      render(); return;
    }
    if (el.dataset.period) {
      const y = Number(el.dataset.period), next = el.checked ? [...state.periods, y] : state.periods.filter(x => x !== y);
      if (!next.length) { el.checked = true; toast('至少保留一个收益周期'); return; }
      state.periods = M.visiblePeriods(next); savePrefs(); render(); return;
    }
    if (el.dataset.column) {
      if (el.checked) state.columns.add(el.dataset.column); else state.columns.delete(el.dataset.column);
      savePrefs(); renderFundResults();
      const count = $('.column-picker summary span'); if (count) count.textContent = state.columns.size + ' / ' + Object.keys(columnNames).length;
      return;
    }
    if (el.dataset.screen) {
      screenOpen = true;
      if (el.dataset.screen === 'minA10' && !el.value.trim()) state.screen.minA10 = null;
      else if (!el.value.trim() || !el.checkValidity()) { toast('请输入−100至100之间的年化收益率'); el.value = state.screen[el.dataset.screen] ?? ''; return; }
      else state.screen[el.dataset.screen] = Number(el.value);
      state.equityAll = true; state.page = 1; state.fundSort = 'default'; render(); return;
    }
    if (el.id === 'purchasable') { state.purchasable = el.checked; state.page = 1; renderFundResults(); }
    else if (el.id === 'show-leverage') { state.leverage = el.checked; render(); }
  });
  document.addEventListener('pointermove', e => { const plot = e.target.closest('.curve-plot'); if (plot) showCurvePoint(e, plot); });
  document.addEventListener('pointerdown', e => { const plot = e.target.closest('.curve-plot'); if (plot) showCurvePoint(e, plot); });
  document.addEventListener('pointerout', e => {
    const plot = e.target.closest('.curve-plot');
    if (!plot || plot.contains(e.relatedTarget)) return;
    const layer = plot.querySelector('.curve-hover-layer'), tooltip = plot.querySelector('.curve-tooltip');
    if (layer) layer.setAttribute('hidden', '');
    if (tooltip) tooltip.hidden = true;
  });
  $('#dialog').addEventListener('close', () => { if (lastFocus && lastFocus.isConnected) lastFocus.focus(); else restoreFocus(lastFocus); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const menu = e.target.closest('.select-menu[open],.column-picker[open]') || $('.select-menu[open],.column-picker[open]');
      if (menu) { menu.open = false; menu.querySelector('summary').focus(); e.preventDefault(); return; }
    }
    const current = e.target.closest('[role="tab"]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...current.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(current), next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const key = tabs[next].dataset.value; e.preventDefault(); tabs[next].click();
    const selected = $$('[role="tab"]').find(t => t.dataset.value === key); if (selected) selected.focus();
  });
  document.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('.screen-panel')) screenOpen = e.target.open; }, true);
  window.addEventListener('hashchange', route);
  route();
}());
