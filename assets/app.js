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
  const years = [1, 2, 3, 5, 10], titles = { overview: '研究总览', indices: '指数观察', funds: '基金研究', stocks: '个股深入', strategy: '投入策略', quality: '数据与方法' };
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
    indexTab: 'all', indexSort: 'default', indexDescending: true, currency: 'usd', benchmarkType: 'total', benchmarkCurrency: 'cny',
    fundTab: 'equity', poolCategory: 'all', query: '', channel: 'all', purchasable: false,
    screen: { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null }, equityAll: false,
    fundSort: 'default', descending: true, page: 1, selected: new Set(),
    stockStyle: 'all', stockQuery: '', stockSort: 'default', stockDesc: true,
    stratPanel: 'initial', stratView: 'results', stratYear: '2010', stratAsset: 'SPY', stratMethod: 'lump_sum', leverage: true, showLeverageAssets: false, chartHidden: new Set()
  };
  let lastFocus = null, toastTimer, searchTimer, activeCurve = null;
  let screenOpen = false;
  function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200); }
  function savePrefs() { try { localStorage.setItem(VIEW, JSON.stringify({ annual: state.annual, periods: state.periods, columns: [...state.columns] })); } catch (_) {} }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  function benchmark() {
    return (window.BM || []).find(b => state.benchmarkType === 'total' ? b.n === 'SPY' : b.n === '标普500指数');
  }
  function benchmarkPanel() {
    const b = benchmark(), r = b && b[state.benchmarkCurrency];
    const shown = state.route === 'overview' ? years : state.periods;
    return '<section class="benchmark-panel' + (state.route === 'funds' ? ' compact' : '') + '" aria-label="标普500参照"><div class="benchmark-title"><div><span class="eyebrow">THE BENCHMARK</span><h2>标普500参照</h2></div><div class="benchmark-controls">' +
      selectMenu('benchmark-type', '标普500回报口径', [['total', 'SPY ETF · 含分红复权'], ['price', '标普500 · 价格指数']], state.benchmarkType) +
      selectMenu('benchmark-currency', '标普500计价币种', [['cny', '人民币'], ['usd', '美元']], state.benchmarkCurrency, 'short') + '</div></div>' +
      '<div class="benchmark-return-toggle">' + annualControl() + '</div>' +
      '<div class="benchmark-values">' + shown.map(y => '<div><span>' + periodHead(y) + '</span><strong class="num">' + pc(ret(r && r[years.indexOf(y)], y, b)) + '</strong></div>').join('') + '</div><div class="benchmark-foot"><span>截至 ' + esc(b && b.asOf || '未记录') + ' · ' + (state.route === 'funds' ? state.benchmarkType === 'total' ? 'SPY含分红、含产品费用' : '价格指数，不含分红' : state.benchmarkType === 'total' ? 'SPY为可投资ETF参照，含产品费用；不是指数全收益序列。' : '价格指数不含分红，不与基金含分红回报直接计算差值。') + '</span>' + action('查看区间与来源', 'benchmark-detail', 'text-link small') + '</div></section>';
  }
  function home() {
    const verified = funds.filter(verifiedReturn).length;
    const entries = [
      ['indices', 'us', '海外指数', '先比较标普500、纳斯达克等市场，再寻找对应的投资工具。', '01'],
      ['funds', 'equity', '长期主动权益基金', '国内与海外放在同一研究入口，检查收益、经理、风险与费用。', '02'],
      ['funds', 'income', '红利、债券与固收', '把防守类和收益型工具集中查找，保留各自风险类别。', '03'],
      ['strategy', 'initial', '投入策略', '查看同一资产不同投入节奏，以及不同标的的实际净值路径。', '04']
    ];
    return head('LONG-TERM INVESTMENT RESEARCH', '长期表现，值得仔细比较。', '先看市场，再研究产品和投入方式。让每一次比较有据可查。', action('观察海外指数 →', 'research-entry', 'btn primary', 'data-route="indices" data-value="us"')) +
      '<div class="home-lead">' + benchmarkPanel() + '<section class="research-intro"><span class="eyebrow">EQUITY RESEARCH</span><h2>多看几年，<br>多问一层。</h2><p>一段漂亮的收益来自什么：市场、策略，还是现任经理？把不同周期、经理任期、风险与费用放在同一张表里判断。</p>' + action('打开基金研究 →', 'research-entry', 'text-link', 'data-value="equity"') + '</section></div>' +
      '<div class="research-entry-grid">' + entries.map(([route, id, title, desc, no]) => '<article class="review-card"><span class="eyebrow">' + no + '</span><h2>' + title + '</h2><p>' + desc + '</p>' + action('进入研究 →', 'research-entry', 'text-link', 'data-route="' + route + '" data-value="' + id + '"') + '</article>').join('') + '</div>' +
      '<div class="section-head"><div><h2>数据覆盖，公开可查</h2><p>研究池来自既有筛选样本，尚不覆盖全市场。</p></div><a href="#quality" class="text-link small">查看数据与方法 →</a></div><div class="stats-grid">' +
      stat('基金研究池', funds.length, '只', '统一经理、收益、风险、费用字段') + stat('收益已复算', verified, '只', '其余历史快照逐项标记待核验') + stat('独立国内指数', (window.INDEX_DATA || []).filter(r => ['available', 'cached'].includes(r.status)).length, '个', '直接使用指数日线计算收益') + stat('投入策略实验', (window.STRATEGY_META || {}).totalExperiments || (window.STRATEGY_RESULTS || []).length, '组', '不同真实起点与资金投入节奏') + '</div>' +
      '<div class="two-col">' + card('市场本身，表现如何？', '价格指数与含分红产品分别标注', '<div class="card-body"><p class="small muted">先用独立指数理解市场，再看具体产品是否提供了值得研究的回报。</p><a class="text-link entry-link" href="#indices">浏览国内与海外指数 →</a></div>') + card('同一资产，怎样投入？', '统一期间与投入假设', '<div class="card-body"><p class="small muted">比较一次投入、分批投入与定期投入，核对总投入、资金加权年化和回撤。</p><a class="text-link entry-link" href="#strategy">查看投入策略 →</a></div>') + '</div>';
  }
  function indexRows() {
    const domestic = window.INDEX_DATA || [], overseas = (window.BM || []).filter(b => /指数/.test(b.tp));
    if (state.indexTab === 'all') return [...overseas, ...domestic];
    if (state.indexTab === 'us') return overseas;
    if (state.indexTab === 'cn') return domestic;
    return (window.BM || []).filter(b => !/指数/.test(b.tp));
  }
  function indices() {
    const domestic = window.INDEX_DATA || [], baseRows = indexRows();
    const tabNames = [['all', '全部指数'], ['us', '海外指数'], ['etf', '海外 ETF 参照'], ['cn', '国内指数']];
    const currencyFor = r => state.indexTab === 'all' || domestic.includes(r) ? 'cny' : state.currency;
    const metric = (r, key) => {
      const isDomestic = domestic.includes(r), c = currencyFor(r);
      const risk = isDomestic ? { mdd: r.mdd5, vol: r.vol5 } : r[c === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
      if (key.startsWith('return:')) return ret((isDomestic ? r.r : r[c])?.[years.indexOf(+key.split(':')[1])], +key.split(':')[1], r);
      if (key === 'mdd') return risk.mdd;
      if (key === 'vol') return risk.vol;
      if (key === 'date') return Date.parse(r.asof || r.asOf || '') || null;
      return r.n || '';
    };
    const rows = baseRows.map((r, i) => ({ r, i }));
    if (state.indexSort !== 'default') rows.sort((a, b) => {
      const av = metric(a.r, state.indexSort), bv = metric(b.r, state.indexSort);
      const compared = state.indexSort === 'name' ? (state.indexDescending ? -1 : 1) * String(av).localeCompare(String(bv), 'zh-CN') : M.compareNullable(av, bv, state.indexDescending);
      return compared || a.i - b.i;
    });
    const sortHead = (label, key) => '<th aria-sort="' + (state.indexSort === key ? state.indexDescending ? 'descending' : 'ascending' : 'none') + '">' + action(label + (state.indexSort === key ? state.indexDescending ? ' ↓' : ' ↑' : ''), 'index-sort', '', 'data-value="' + key + '"') + '</th>';
    const rowsHtml = rows.map(({ r, i }) => {
      const isDomestic = domestic.includes(r), displayCurrency = state.indexTab === 'all' || isDomestic ? 'cny' : state.currency;
      const returns = isDomestic ? r.r : r[displayCurrency];
      const risk = isDomestic ? { mdd: r.mdd5, vol: r.vol5 } : r[displayCurrency === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
      return '<tr><td>' + action(esc(r.n), 'index-detail', 'text-link', 'data-value="' + i + '"') + '<span class="sub">' + esc(isDomestic ? '国内价格指数' : state.indexTab === 'etf' ? '海外 ETF' : '海外价格指数') + ' · ' + esc(r.c || r.symbol || r.tp || '') + '</span></td>' +
        state.periods.map(y => '<td>' + pc(ret(returns && returns[years.indexOf(y)], y, r)) + ((r.backfilledPeriods || []).includes(y) ? '<span class="sub">含发布前回溯</span>' : '') + '</td>').join('') +
        '<td>' + pc(risk.mdd, 1) + '</td><td>' + pct(risk.vol, 1, false) + '</td><td>' + esc(r.asof || r.asOf || '待核验') + '</td></tr>';
    }).join('');
    return head('MARKET OBSERVATORY', '先理解资产，再选择工具。', '指数表现由指数自身计算；关联基金数量不参与收益计算。', annualControl()) +
      '<div class="tabs" role="tablist">' + tabNames.map(([id, n]) => action(n, 'index-tab', state.indexTab === id ? 'active' : '', 'data-value="' + id + '" role="tab" aria-selected="' + (state.indexTab === id) + '"')).join('') + '</div>' +
      '<div class="toolbar"><div class="study-summary"><span>' + (state.indexTab === 'all' ? '默认海外在前、国内在后 · 人民币价格口径' : state.indexTab === 'cn' ? '12个公开指数 + 1个授权数据缺口' : state.indexTab === 'us' ? '价格指数 · 不含分红再投资' : '产品参照 · 杠杆ETF单日倍数不等于长期倍数') + '</span>' + (state.indexSort !== 'default' ? action('恢复默认顺序', 'index-sort-reset', 'text-link small') : '') + '</div>' +
      (state.indexTab === 'cn' || state.indexTab === 'all' ? badge('人民币 · 价格口径') : '<div class="segmented">' + action('美元', 'currency', state.currency === 'usd' ? 'active' : '', 'data-value="usd"') + action('人民币', 'currency', state.currency === 'cny' ? 'active' : '', 'data-value="cny"') + '</div>') + '</div>' +
      '<div class="table-controls">' + periodControl() + '</div><div class="card"><div class="table-wrap"><table class="research-table"><thead><tr>' + sortHead('指数 / 产品', 'name') + state.periods.map(y => sortHead(periodHead(y), 'return:' + y)).join('') + sortHead('5年最大回撤', 'mdd') + sortHead('5年波动率', 'vol') + sortHead('截至日', 'date') + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div><div class="panel-foot"><span>点击表头排序；再次点击切换方向，第三次恢复默认。— 表示未提供或历史不足，不等于0。</span></div></div>' +
      '<div class="notice" style="margin-top:20px">' + (state.indexTab === 'cn' || state.indexTab === 'all' ? '价格指数不含现金分红，与基金含分红收益不可直接相减。科创100、中证2000等部分长周期包含发布前回溯，已逐格标记；万得微盘缺少授权原始日线，保留数据缺口。' : (state.indexTab === 'us' ? '价格指数与基金总回报定义不同。本页不把二者的收益差称为跟踪误差；人民币收益使用各区间实际端点汇率。' : '普通ETF与杠杆ETF分别看待。风险列缺失时不采用其他产品或其他期间的数据代填。') + (state.currency === 'cny' ? '完整人民币日风险仍缺少实际汇率观测，留空并在详情列出缺失日；不以美元风险代填。' : '本页风险按美元序列计算。')) + '</div>' +
      '<div class="big-callout"><div><h2>同一个指数，也有不同的投资成本。</h2><p>在统一的基金研究库中，比较渠道、持续费用、申购限制与历史风险。</p></div>' + action('查找对应基金 →', 'go-index-funds', 'btn') + '</div>';
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
    return head('FUND RESEARCH', '基金研究', '比较多年表现、经理任期与完整成本。', state.fundTab === 'equity' ? '' : annualControl()) +
      '<div class="tabs" aria-label="研究范围">' + tabs.map(([id, n]) => action(n, 'fund-tab', state.fundTab === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.fundTab === id) + '"')).join('') + '</div>' +
      (state.fundTab === 'equity' ? screenControls() + benchmarkPanel() : '<div class="notice">' + (state.fundTab === 'income' ? '红利是权益风格；债券、偏债与固收+承受不同风险。此处合并查找，逐只保留原分类与费用。' : state.fundTab === 'passive' ? '指数工具的收益包含具体产品费用，需与指数自身回报区分。' : '研究池含历史预筛样本，收益复算状态见表格和详情。') + '</div>') +
      '<div class="fund-controls"><div class="toolbar"><div class="filters"><input id="fund-search" type="search" aria-label="搜索基金名称、代码、指数或经理" placeholder="搜索名称、代码、指数或经理" value="' + esc(state.query) + '">' +
      (state.fundTab === 'all' ? selectMenu('fund-category', '研究池分类', [['all', '全部分类'], ['overseas', '海外'], ['active', '主动权益'], ['dividend', '红利'], ['fixed', '债券与固收'], ['theme', '行业主题'], ['commodity', '商品']], state.poolCategory) : '') +
      selectMenu('fund-channel', '交易渠道', [['all', '全部渠道'], ['exchange', '场内交易'], ['otc', '场外申赎']], state.channel) +
      '<label class="check-label"><input id="purchasable" type="checkbox"' + (state.purchasable ? ' checked' : '') + '>快照显示可买</label></div></div>' +
      '<div class="table-controls">' + periodControl() + columnControl() + '</div></div><div id="fund-results">' + fundTable(fundRows()) + '</div>' + compareBar() + '<p class="note">场外买入费率为原费率 / 历史渠道优惠，卖出费率需核对持有期档位；场内产品使用券商佣金，LOF 的两个交易渠道费用不同。资料只代表所示日期的快照。</p>';
  }
  function compareBar() {
    return '<div id="comparison-bar"' + (!state.selected.size ? ' class="hidden"' : ' class="compare-bar"') + '><span>已选 ' + state.selected.size + ' / 4 &nbsp; ' + [...state.selected].map(c => esc(c)).join(' · ') + '</span>' + action('清空', 'compare-clear', 'quiet') + action('并排比较 →', 'compare-open', 'btn', state.selected.size < 2 ? 'disabled' : '') + '</div>';
  }
  function stocks() {
    const all = window.STOCKS || [];
    const rows = all.filter(s => (!state.stockQuery || (s.c + s.n + s.ind).toLowerCase().includes(state.stockQuery.toLowerCase())) && (state.stockStyle === 'all' || state.stockStyle === 'dividend' && (s.style || []).includes('高股息')));
    const value = x => state.stockSort.startsWith('return:') ? ret(x.r[years.indexOf(+state.stockSort.split(':')[1])], +state.stockSort.split(':')[1], x) : x[state.stockSort];
    if (state.stockSort !== 'default') rows.sort((a, b) => M.compareNullable(value(a), value(b), state.stockDesc));
    const sh = (n, k) => action(n + (state.stockSort === k ? state.stockDesc ? ' ↓' : ' ↑' : ''), 'stock-sort', '', 'data-value="' + k + '"');
    return head('STOCK WATCHLIST', '看懂公司，也看清集中风险。', '有限的人工观察样本；“高股息”是研究标签，不代表持续分红承诺。', annualControl()) +
      '<div class="notice">23只股票的历史收益和分红窗口已重算。财务报告期未核验时，PE、PB、ROE保留为空；观察标签需要结合公司公告判断。' + '<a class="inline-link" href="#quality">查看核验状态</a></div>' +
      '<div class="toolbar"><div class="filters"><input type="search" id="stock-search" aria-label="搜索股票名称、代码或行业" placeholder="搜索股票名称、代码或行业" value="' + esc(state.stockQuery) + '"></div><div class="segmented">' + action('全部观察', 'stock-style', state.stockStyle === 'all' ? 'active' : '', 'data-value="all"') + action('高股息标签', 'stock-style', state.stockStyle === 'dividend' ? 'active' : '', 'data-value="dividend"') + '</div></div>' +
      '<div class="table-controls">' + periodControl() + '</div><div class="card"><div class="table-caption"><span>' + rows.length + ' / ' + all.length + '只观察样本</span><span>点名称查看完整资料</span></div><div class="table-wrap"><table class="research-table"><thead><tr><th>公司 / 行业</th><th>现价</th><th>PE / TTM</th><th>PB</th><th>ROE</th><th>市值 / 亿元</th><th>' + sh('近12月股息率', 'yield12') + '</th><th>5年完整分红年数</th>' + state.periods.map(y => '<th>' + sh(periodHead(y), 'return:' + y) + '</th>').join('') + '<th>' + sh('5年最大回撤', 'mdd5') + '</th><th>5年波动率</th><th>截至日</th></tr></thead><tbody>' + rows.map(s => '<tr><td>' + action(esc(s.n), 'stock-detail', 'text-link', 'data-code="' + s.c + '"') + '<span class="sub">' + s.c + ' · ' + esc(s.ind) + '</span></td><td>' + money(s.price, 2) + '</td><td>' + money(s.pe, 2) + '</td><td>' + money(s.pb, 2) + '</td><td>' + pct(s.roe, 2, false) + '</td><td>' + money(s.mcap, 1) + '</td><td>' + pct(s.yield12, 2, false) + '</td><td>' + (s.divYears == null ? '—' : esc(s.divYears) + ' / 5') + '</td>' + state.periods.map(y => '<td>' + pc(ret(s.r && s.r[years.indexOf(y)], y, s)) + '</td>').join('') + '<td>' + pc(s.mdd5, 1) + '</td><td>' + pct(s.vol5, 1, false) + '</td><td>' + esc(s.latest || window.STOCK_ASOF) + '</td></tr>').join('') + (rows.length ? '' : '<tr><td colspan="' + (11 + state.periods.length) + '"><div class="empty">没有匹配的公司</div></td></tr>') + '</tbody></table></div></div><p class="note">收益为供应商复权收盘价口径，保留原始序列与重算记录；未对每笔公司行动做独立审计。税费、实际成交价格与个股流动性另行考虑。</p>';
  }
  function curveCard(title, subtitle, entries, dates) {
    const palette = ['#35654a', '#b58a46', '#557b9b', '#b36b5d', '#756c9b', '#698b6b', '#b78673', '#6e91a6', '#998a54'];
    const valid = entries.map((entry, i) => ({ ...entry, color: palette[i % palette.length] }))
      .filter(entry => Array.isArray(entry.values) && entry.values.length === dates.length && entry.values.every(v => M.finite(v) && v > 0));
    const visible = valid.filter(entry => !state.chartHidden.has(entry.key));
    const legend = '<div class="curve-legend">' + valid.map((entry, i) => (entry.experimental && (i === 0 || !valid[i - 1].experimental) ? '<div class="curve-legend-divider">杠杆 ETF 实验</div>' : '') + action('<i style="background:' + entry.color + '"></i><span>' + esc(entry.label) + '</span><b class="num">' + money(entry.values.at(-1), 0) + '</b>', 'chart-line', 'curve-key' + (entry.experimental ? ' experimental' : '') + (state.chartHidden.has(entry.key) ? ' is-hidden' : ''), 'data-value="' + esc(entry.key) + '" aria-pressed="' + !state.chartHidden.has(entry.key) + '" aria-label="' + esc(entry.label + '曲线') + '"')).join('') + '</div>';
    if (!dates.length || !valid.length) return '<section class="card curve-card"><div class="card-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div></div><div class="card-body muted">当前起点没有可绘制的历史路径。</div></section>';
    const allValues = visible.flatMap(entry => entry.values), low = Math.min(100, ...allValues), high = Math.max(100, ...allValues);
    const minExp = Math.floor(Math.log2(low)), maxExp = Math.max(minExp + 1, Math.ceil(Math.log2(high)));
    const scaleY = value => 276 - (Math.log2(value) - minExp) / (maxExp - minExp) * 242;
    const times = dates.map(d => Date.parse(d + 'T00:00:00Z'));
    const scaleX = i => 59 + (times[i] - times[0]) / Math.max(1, times.at(-1) - times[0]) * 829;
    activeCurve = { dates, times, entries: visible, minExp, maxExp };
    const step = Math.max(1, Math.ceil((maxExp - minExp) / 6));
    const ticks = [];
    for (let exponent = minExp; exponent <= maxExp; exponent += step) {
      const value = 2 ** exponent, y = scaleY(value);
      ticks.push('<line x1="59" x2="888" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="curve-grid"/><text x="49" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="curve-axis">' + money(value, value < 10 ? 1 : 0) + '</text>');
    }
    const xTicks = [0, Math.round((dates.length - 1) / 4), Math.round((dates.length - 1) / 2), Math.round((dates.length - 1) * 3 / 4), dates.length - 1]
      .map(i => '<text x="' + scaleX(i).toFixed(1) + '" y="303" text-anchor="' + (i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle') + '" class="curve-axis">' + esc(dates[i].slice(0, 7)) + '</text>').join('');
    const paths = visible.map(entry => {
      const path = entry.values.map((v, i) => (i ? 'L' : 'M') + scaleX(i).toFixed(1) + ',' + scaleY(v).toFixed(1)).join(' ');
      return '<path d="' + path + '" fill="none" stroke="' + entry.color + '" stroke-width="2.5"' + (entry.experimental ? ' stroke-dasharray="7 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"><title>' + esc(entry.label) + ' · 起点100，终点' + money(entry.values.at(-1), 1) + '</title></path>';
    }).join('');
    return '<section class="card curve-card"><div class="card-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div></div><div class="curve-body">' +
      (visible.length ? '<div class="curve-plot"><svg class="curve-svg" viewBox="0 0 920 320" role="img" aria-label="' + esc(title + '；悬浮或点击查看具体交易日和各标的单位净值') + '">' + ticks.join('') + xTicks + '<line x1="59" x2="888" y1="' + scaleY(100).toFixed(1) + '" y2="' + scaleY(100).toFixed(1) + '" class="curve-base"/>' + paths + '<g class="curve-hover-layer" hidden><line class="curve-hover-line" y1="34" y2="276"/>' + visible.map(entry => '<circle class="curve-hover-dot" data-key="' + esc(entry.key) + '" r="4" fill="' + entry.color + '"/>').join('') + '</g></svg><div class="curve-tooltip" hidden></div></div>' : '<div class="curve-empty">点击图例以显示曲线</div>') + legend +
      '</div><div class="panel-foot"><span>首日单位净值＝100 · 每周最后一个实际交易日取样 · 对数刻度；将光标移到曲线上读取具体日期。图例可切换曲线。</span></div></section>';
  }
  function showCurvePoint(event, plot) {
    if (!activeCurve || !activeCurve.entries.length) return;
    const svg = plot.querySelector('svg'), rect = svg.getBoundingClientRect();
    const position = Math.max(59, Math.min(888, (event.clientX - rect.left) / rect.width * 920));
    const times = activeCurve.times, target = times[0] + (position - 59) / 829 * (times.at(-1) - times[0]);
    let lo = 0, hi = times.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (times[mid] < target) lo = mid + 1; else hi = mid; }
    const index = lo > 0 && Math.abs(times[lo - 1] - target) < Math.abs(times[lo] - target) ? lo - 1 : lo;
    const x = 59 + (times[index] - times[0]) / Math.max(1, times.at(-1) - times[0]) * 829;
    const layer = svg.querySelector('.curve-hover-layer'); layer.removeAttribute('hidden');
    const line = layer.querySelector('.curve-hover-line'); line.setAttribute('x1', x); line.setAttribute('x2', x);
    for (const dot of layer.querySelectorAll('.curve-hover-dot')) {
      const entry = activeCurve.entries.find(item => item.key === dot.dataset.key);
      if (!entry) continue;
      const y = 276 - (Math.log2(entry.values[index]) - activeCurve.minExp) / (activeCurve.maxExp - activeCurve.minExp) * 242;
      dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    }
    const tooltip = plot.querySelector('.curve-tooltip');
    tooltip.innerHTML = '<strong>' + esc(activeCurve.dates[index]) + '</strong><span class="curve-tooltip-caption">单位净值 · 起点 100</span>' +
      activeCurve.entries.map(entry => '<div><i style="background:' + entry.color + '"></i><span>' + esc(entry.label) + '</span><b class="num">' + money(entry.values[index], 2) + '</b></div>').join('');
    tooltip.hidden = false;
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
    const curves = selected.curves || { dates: [], series: {} }, dates = curves.dates || [];
    if (!available.has(state.stratAsset)) state.stratAsset = ordinary[0]?.c || leveraged[0]?.c;
    const methods = definitions.filter(d => d.panel === state.stratPanel);
    if (!methods.some(d => d.id === state.stratMethod)) state.stratMethod = methods[0] && methods[0].id;
    const seriesFor = (asset, method) => ((curves.series || {})[asset] || {})[method];
    const across = [...ordinary, ...(state.leverage ? leveraged : [])].map(a => ({ key: 'asset:' + a.c, label: a.g + ' · ' + a.c + (a.lev === '1x' ? '' : ' · ' + a.lev), experimental: a.lev !== '1x', values: seriesFor(a.c, state.stratMethod) }));
    const rows = (selected.results || []).filter(r => r.p === state.stratPanel && r.a === state.stratAsset);
    const verified = meta.modelVersion >= 2 && meta.initialCashIncluded;
    const controls = '<div class="strategy-control-bar"><div class="segmented" aria-label="资金情境">' + action('已有一笔钱', 'strategy-panel', state.stratPanel === 'initial' ? 'active' : '', 'data-value="initial"') + action('持续有新收入', 'strategy-panel', state.stratPanel === 'dca' ? 'active' : '', 'data-value="dca"') + '</div>' +
      '<div class="strategy-year-picker"><span>回测起点</span><div class="strategy-year-buttons">' + summaries.map(item => action(item.year + '起', 'strategy-year', String(item.year) === state.stratYear ? 'active' : '', 'data-value="' + item.year + '" aria-pressed="' + (String(item.year) === state.stratYear) + '"')).join('') + '</div></div></div>';
    const context = '<p class="strategy-context' + (verified ? '' : ' warn') + '">实际共同交易日 ' + esc(meta.start) + ' → ' + esc(meta.end) + ' · ' + available.size + '只ETF有完整同期间行情 · ' + (verified ? '现金计入账户' : '模型待核验') + ' · 暂未计入交易税费</p>';
    const assetCard = a => {
      const enabled = available.has(a.c), first = (rootMeta.assetStarts || {})[a.c];
      return action('<span class="strategy-asset-name">' + esc(a.g) + '</span><strong>' + esc(a.c) + '</strong><small>' + (enabled ? a.lev === '1x' ? '普通 ETF' : a.lev + ' · 杠杆实验' : first ? esc(first.slice(0, 4) + '年起') : '当前不可选') + '</small>', 'strategy-asset', 'strategy-asset-card' + (state.stratAsset === a.c ? ' active' : '') + (enabled ? '' : ' unavailable'), 'data-value="' + esc(a.c) + '" aria-pressed="' + (state.stratAsset === a.c) + '"' + (enabled ? '' : ' disabled'));
    };
    const assetShelf = '<section class="strategy-asset-shelf"><div class="strategy-asset-heading"><div><h2>研究标的</h2><p>先选择ETF，再比较同一资产的投入方式。</p></div><span>' + esc(state.stratAsset || '') + ' · ' + esc(state.stratYear) + '起</span></div><div class="strategy-asset-grid">' + assets.filter(a => a.lev === '1x').map(assetCard).join('') + '</div>' +
      (leveraged.length ? '<div class="strategy-leverage-heading">' + action(state.showLeverageAssets ? '收起杠杆 ETF' : '查看杠杆 ETF 实验（' + leveraged.length + '只）', 'strategy-leverage-picker', 'text-link') + '<span>每日倍数不等于长期倍数</span></div>' + (state.showLeverageAssets ? '<div class="strategy-asset-grid leveraged">' + leveraged.map(assetCard).join('') + '</div>' : '') : '<p class="strategy-unavailable">该起点没有可用于完整同期间比较的杠杆 ETF。</p>') + '</section>';
    const results = '<div class="card strategy-results-card"><div class="table-caption"><span>' + esc(state.stratAsset) + ' · ' + (state.stratPanel === 'initial' ? '首日资金 $' + money(meta.initial) : '基础月度预算 $' + money(meta.monthly)) + ' · 美元</span><span>资金投入总额不同，请结合 XIRR 判断</span></div><div class="table-wrap"><table class="research-table"><thead><tr><th>投入方式</th><th>累计投入</th><th>期末资产</th><th>XIRR</th><th>净值最大回撤</th><th>最长水下 / 日</th><th>平均仓位</th><th>交易次数</th></tr></thead><tbody>' + rows.map(r => { const def = definitions.find(d => d.id === r.s); return '<tr><td>' + (def ? esc(def.name) : esc(r.s)) + '</td><td>$' + money(r.inv) + '</td><td>$' + money(r.end) + '</td><td>' + pc(verified ? r.irr : null) + '</td><td>' + pc(verified ? r.mdd : null, 1) + '</td><td>' + money(r.uw) + '</td><td>' + pct(r.exp, 1, false) + '</td><td>' + r.tr + '</td></tr>'; }).join('') + '</tbody></table></div><div class="panel-foot"><span>XIRR 是资金加权年化；最大回撤剔除外部现金流影响。</span></div></div>' +
      '<details class="strategy-rules"><summary>查看投入方式的计算规则</summary><div class="rule-list">' + methods.map((d, i) => '<div class="rule-item"><span class="rule-number">0' + (i + 1) + '</span><div><h3>' + esc(d.name) + '</h3><p>' + esc(d.desc) + '</p></div></div>').join('') + '</div></details>';
    const chart = '<div class="strategy-curve-toolbar"><div class="strategy-method-control"><span>统一投入方式</span>' + selectMenu('strategy-chart-method', '统一投入方式', methods.map(d => [d.id, d.name]), state.stratMethod) + '</div>' + (leveraged.length ? '<label class="check-label"><input id="show-leverage" type="checkbox"' + (state.leverage ? ' checked' : '') + '>显示杠杆 ETF（' + leveraged.length + '只）</label>' : '') + '</div>' +
      curveCard('同图比较可用标的', '同一投入方式、相同交易区间 · 悬浮查看每周数据', across, dates) +
      (state.leverage ? '<p class="note">杠杆 ETF 的每日倍数不等于长期收益倍数；在同图中仅作路径实验。</p>' : '');
    return head('INVESTING RHYTHM', '投入策略', '比较同一资产的投入节奏，以及不同标的在同一条件下的历史路径。') +
      '<div class="tabs strategy-view-tabs" role="tablist" aria-label="投入策略视图">' + action('结果表', 'strategy-view', state.stratView === 'results' ? 'active' : '', 'data-value="results" role="tab" aria-selected="' + (state.stratView === 'results') + '"') + action('曲线对比', 'strategy-view', state.stratView === 'curves' ? 'active' : '', 'data-value="curves" role="tab" aria-selected="' + (state.stratView === 'curves') + '"') + '</div>' +
      controls + context + (state.stratView === 'results' ? assetShelf + results : chart) +
      '<p class="note">来源：' + esc(meta.source || '待核验') + '。历史回测受起点影响；零成本是假设，不能理解为可实现净收益。</p>';
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
    const statusNames = { attention: '发现错误', checked: '计算检查通过', available: '已取得原始序列', warning: '有条件使用', unverified: '部分待核验', error: '发现错误', unavailable: '缺少来源', failed: '更新失败', computed: '已重算' };
    const sources = [
      ['中证指数', 'https://www.csindex.com.cn/', '国内指数原始日线与指数身份'],
      ['国证指数', 'https://www.cnindex.com.cn/', '深证成指、创业板指日线'],
      ['天天基金 / 东方财富', 'https://fund.eastmoney.com/', '基金净值、申赎与费率资料'],
      ['Yahoo Finance', 'https://finance.yahoo.com/', '海外指数、复权ETF与汇率历史'],
      ['Investor.gov', 'https://www.investor.gov/introduction-investing/getting-started/asset-allocation', '资产配置、分散与再平衡方法']
    ];
    return head('EVIDENCE & METHODOLOGY', '每一个数字，都有边界。', '区分数据截至日、采集时间与核验结论；验证过计算，不等于所有原始资料都正确。', action('导出质量报告', 'export-quality', 'btn')) +
      '<div class="stats-grid">' + stat('公开国内指数', (window.INDEX_DATA || []).filter(r => ['available', 'cached'].includes(r.status)).length, '个', '指数源独立于基金产品') + stat('研究产品', funds.length, '只', '按基金代码去重') + stat('基础精简候选', shortlist.size, '只', '海外合格样本另纳入基金入口') + stat('待核验类别', q.summary.unverified || 0, '项', '逐项说明见下方') + '</div>' +
      '<div class="dataset-grid">' + (q.datasets || []).map(d => '<article class="dataset-card"><header><h3>' + esc(datasetLabel(d)) + '</h3>' + badge(statusNames[d.status] || d.status, ['checked', 'available'].includes(d.status) ? 'green' : 'warn') + '</header><p>数据日期 ' + esc(datasetDates(d)) + (d.records != null ? ' · ' + d.records + '条' : '') + '</p>' + (d.issues && d.issues.length ? '<ul>' + d.issues.map(i => '<li>' + esc(i.message) + '</li>').join('') + '</ul>' : '<p>来源与计算检查通过；仍保留供应商数据误差和历史范围限制。</p>') + runNote(d) + '</article>').join('') + '</div>' +
      '<div class="section-head"><h2>统一的方法口径</h2></div><div class="card pad"><div class="rule-list">' + [
        ['指数与产品分开', '指数用自身日线计算；价格指数不含分红。基金净值、ETF交易价、总回报与价格回报分别标注，不用基金中位数代替指数。'],
        ['完整周期才显示完整周期', '累计收益与几何年化分开；不足1/2/3/5/10年留空；5年风险要求覆盖完整5年。中证2000等发布前回溯不能当作同期可投资记录。'],
        ['年化参数可以追溯', '有实际基期的收益按日数 / 365.2425年化；旧快照未记录基期时按名义年数估算并标记日期未知。波动率沿用已复算来源约定：国内指数与国内研究基金252日，海外基金、海外基准和股票250日；不能据此作精细风险排名。'],
        ['权益筛选公开透明', (policy.rules || []).join(' ')],
        ['基金经理逐人记录', '个人任职起点来自现任经理资料，不把团队组合变化日期当作个人上任日期。至少一位现任经理任职满足筛选门槛，也不表示所有历史业绩属于当前团队。'],
        ['基准可参照，差值要可比', '标普500价格指数不含分红，SPY复权ETF是另一种产品参照。人民币与美元、实际区间与截至日不一致时，不计算跑赢幅度或跟踪误差。'],
        ['成本不可默认完整', '管理与托管费是已知持续费用的部分；销售服务费、交易费、税费需单列。费档缺少持有期映射时明确标记，渠道优惠不是承诺。'],
        ['数据失败要可见', '更新脚本按数据集记录状态，失败保留真实旧日期，不用本次运行时间冒充最新数据；全站更新通过统一入口，默认不推送发布。'],
        ['公开研究与可复现', '所有页面使用公开产品、指数和历史实验数据。浏览器只记住收益周期与显示列偏好，筛选结果可以导出完整字段。']
      ].map(([n, t], i) => '<div class="rule-item"><span class="rule-number">0' + (i + 1) + '</span><div><h3>' + n + '</h3><p>' + esc(t) + '</p></div></div>').join('') + '</div></div>' +
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
    const rule = (policy.byCode || {})[code];
    const fees = (f.fee || []).map(x => pct(x, 2, false));
    openModal(modalTitle(esc(f.n), esc(f.c) + ' · ' + esc(f.exchange ? '场内交易' : '场外申赎') + ' · ' + esc(f.ix)) +
      '<div class="pill-row">' + badge(/增强/.test(f.n + f.ix) ? '指数增强' : f.active ? '主动管理' : '指数 / 规则工具') + (f.dividend ? badge('红利是权益风格') : '') + badge(verifiedReturn(f) ? '收益已复算' : '历史字段待逐项核验', verifiedReturn(f) ? 'green' : 'warn') + '</div>' +
      (rule ? '<div class="notice"><strong>' + (rule.tier === 'shortlist' ? '权益候选：' : '研究池：') + '</strong>' + esc(rule.reason) + '<br>' + esc((rule.flags || []).join('；')) + '</div>' : '') +
      returnTable(f.r, f) + '<p class="note">收益截至：' + esc(metricDate(f, 'return')) + ' · ' + esc(f.historyNote || f.returnNote || '有实际区间时按日期跨度年化；旧快照无基期时按名义年数计算。完整周期不足留空。') + '</p>' +
      detailGrid([
        ['管理 / 托管 / 销售服务费（年）', fees.join(' / ') || '待核验'],
        ['买入费用', buyFee(f) + (f.exchange ? '，按实际券商约定' : '<span class="sub">原费率 / 历史渠道折扣，生效日待核验</span>')],
        ['卖出费用', redemption(f, true)],
        ['申购状态 / 日限额', f.exchange ? '场内交易；不使用场外申赎限制' : esc(f.st || '未收录') + ' / ' + (/暂停/.test(f.st) ? '暂停期间无可用额度' : esc(f.lm || '未收录'))],
        ['单位净值 / 日期', money(f.nav, 4) + ' / ' + esc(f.navdate || '未收录')],
        ['规模 / 成立日', money(f.sz, 1) + '亿元 / ' + esc(f.d) + '<span class="sub">规模截至：' + esc(f.szdate || '未独立记录') + '</span>'],
        ['近5年最大回撤 / 波动率', pct(f.mdd5, 2, false) + ' / ' + pct(f.vol5, 2, false) + '<span class="sub">截至：' + esc(metricDate(f, 'risk')) + '</span>'],
        ['近3年最大回撤 / 波动率', pct(f.mdd3, 2, false) + ' / ' + pct(f.v3, 2, false) + '<span class="sub">截至：' + esc(metricDate(f, 'risk')) + '</span>'],
        ['现任经理 / 本基金任期', managerText(f, true) + '<span class="sub">任期截至：' + esc(f.managerAsOf || '未记录') + '</span>'],
        ['交易价 / 快照溢价', money(f.p, 3) + ' / ' + pct(f.prem) + '<span class="sub">报价时间：' + esc(f.priceAsOf || f.quotedAt || '未独立记录') + '；快照非实时</span>']
      ]) +
      '<div class="actions">' + extLink(f.managerSourceUrl || 'https://fundf10.eastmoney.com/jjjl_' + code + '.html', '经理任职原文') + extLink('https://fund.eastmoney.com/' + code + '.html', '净值与基金资料') + extLink('https://fundf10.eastmoney.com/jjfl_' + code + '.html', '买入卖出费率') + extLink('https://fundf10.eastmoney.com/jjgg_' + code + '.html', '正式公告') + '</div>' +
      '<p class="note">经理资料采集：' + esc(stamp(f.managerCheckedAt)) + '；持续费率采集：' + esc(stamp(f.feeCheckedAt)) + '。' + (f.exchange ? '交易佣金以实际券商约定为准，未知费项不按0处理。' : '赎回费旧档缺少持有期映射，不能用于精确估算；未知费用不按0处理。') + esc(f.note || '') + '</p><div class="dialog-footer">' + action('加入对比', 'compare-toggle', 'btn primary', 'data-code="' + code + '"') + '</div>');
  }
  function openIndex(i) {
    const rows = indexRows();
    const x = rows[i]; if (!x) return;
    const isDomestic = (window.INDEX_DATA || []).includes(x), displayCurrency = state.indexTab === 'all' || isDomestic ? 'cny' : state.currency;
    const r = isDomestic ? x.r : x[displayCurrency];
    const risk = isDomestic ? { mdd: x.mdd5, vol: x.vol5 } : x[displayCurrency === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
    openModal(modalTitle(esc(x.n), esc(x.c || x.symbol || x.tp || '')) + '<div class="notice">' + esc(basisText(x.basis)) + '。' + esc(x.note || '') + '</div>' + returnTable(r, x) +
      detailGrid([['数据截至', esc(x.asof || x.asOf || '未核验')], ['实际序列起点', esc(x.first || (x.periods && x.periods.length && x.periods[x.periods.length - 1].start) || '查看原始来源')], ['指数发布日', esc(x.launchDate || '见编制机构')], ['近5年回撤 / 年化波动', pct(risk.mdd, 2, false) + ' / ' + pct(risk.vol, 2, false) + '<span class="sub">' + (displayCurrency === 'usd' ? '美元' : '人民币') + '</span>'], ['数据源', esc(x.source || '见供应商日线')], ['周年窗口基准日', esc((x.baseDates || []).map((d, j) => years[j] + '年：' + (d || '不足')).join('；') || (x.periods || []).map(p => p.years + '年：' + p.start + ' → ' + p.end).join('；') || '各期间实际日期见原始数据')]]) +
      (risk.reason ? '<div class="notice warn">' + esc(risk.reason) + (risk.missingFxDates ? '。缺失日期：' + esc(risk.missingFxDates.join('、')) : '') + '</div>' : '') +
      (x.backfilledPeriods && x.backfilledPeriods.length ? '<div class="notice warn">近' + x.backfilledPeriods.join(' / ') + '年包含发布前回溯；这部分不是当时可投资的指数实绩。</div>' : '') +
      '<div class="actions">' + extLink(x.sourceUrl || x.source, '原始行情来源') + (x.identityUrl ? extLink(x.identityUrl, '官方指数说明') : '') + (displayCurrency === 'cny' && x.fxSourceUrl ? extLink(x.fxSourceUrl, '美元兑人民币汇率') : '') + '</div><div class="dialog-footer">' + action('在基金库搜索此标的', 'find-index-funds', 'btn primary', 'data-value="' + esc(x.n.replace(/指数$/, '')) + '"') + '</div>');
  }
  function openStock(code) {
    const s = (window.STOCKS || []).find(x => x.c === code); if (!s) return;
    openModal(modalTitle(esc(s.n), s.c + ' · ' + esc(s.ind) + ' · 行情截至' + esc(s.latest || window.STOCK_ASOF)) + returnTable(s.r, s) +
      detailGrid([['现价 / 市值', '¥' + money(s.price, 2) + ' / ' + money(s.mcap, 1) + '亿元'], ['PE（TTM） / PB', money(s.pe, 2) + ' / ' + money(s.pb, 2)], ['ROE', pct(s.roe, 2, false) + '<span class="sub">报告期未完整收录，不参与质量打分</span>'], ['近12月股息率', pct(s.yield12, 2, false)], ['近5年分红年数', s.divYears == null ? '待重算核验' : s.divYears + ' / 5'], ['5年最大回撤 / 波动率', pct(s.mdd5, 2, false) + ' / ' + pct(s.vol5, 2, false)]]) +
      '<p class="notice">' + esc(basisText(s.returnBasis)) + '；收益截至 ' + esc(s.returnAsOf || '未记录') + '，风险截至 ' + esc(s.riskAsOf || '未记录') + '。分红窗口 ' + esc(s.dividendWindow || '未记录') + '，滚动股息截至 ' + esc(s.dividendAsOf || '未记录') + '。</p><p class="note">报价时间：' + esc(s.priceAsOf || '未记录') + '。观察标签是研究起点，需要结合最新公告重新判断。</p><div class="actions">' + extLink(s.sourceUrl, '复权日线来源') + extLink('https://quote.eastmoney.com/' + (code.startsWith('6') ? 'sh' : 'sz') + code + '.html', '行情与公司公告') + '</div>');
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
    const renderers = { overview: home, indices, funds: fundView, stocks, strategy: strategies, quality };
    const focus = document.activeElement;
    document.title = '长衡 · ' + titles[state.route];
    $('#breadcrumb').textContent = '公开研究 / ' + titles[state.route];
    $$('[data-route]').forEach(a => { const active = a.dataset.route === state.route; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#main').className = 'page-' + state.route;
    $('#main').innerHTML = renderers[state.route]();
    restoreFocus(focus);
  }
  function route() {
    const hash = location.hash.replace('#', ''), legacy = { us: 'funds', cn: 'funds', cnidx: 'indices', stock: 'stocks' };
    if (hash === 'main') { $('#main').focus(); return; }
    if (hash === 'us') { state.fundTab = 'all'; state.poolCategory = 'overseas'; }
    if (hash === 'cn') state.fundTab = 'equity';
    state.route = titles[hash] ? hash : legacy[hash] || 'overview';
    render(); window.scrollTo(0, 0);
  }
  function go(name) { if (location.hash === '#' + name) { state.route = name; render(); } else location.hash = name; }
  document.addEventListener('click', event => {
    if (event.target.closest('.skip')) { event.preventDefault(); $('#main').focus(); $('#main').scrollIntoView(); return; }
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
        if (target === 'strategy') { state.stratPanel = val; state.stratView = 'results'; }
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
      case 'index-tab': state.indexTab = val; state.indexSort = 'default'; break;
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
      case 'stock-style': state.stockStyle = val; break;
      case 'stock-sort': state.stockDesc = state.stockSort === val ? !state.stockDesc : true; state.stockSort = val; break;
      case 'stock-detail': openStock(code); return;
      case 'strategy-panel': state.stratPanel = val; state.stratMethod = val === 'initial' ? 'lump_sum' : 'dca_month'; state.chartHidden.clear(); break;
      case 'strategy-year': state.stratYear = val; state.chartHidden.clear(); break;
      case 'strategy-asset': state.stratAsset = val; break;
      case 'strategy-leverage-picker': state.showLeverageAssets = !state.showLeverageAssets; break;
      case 'strategy-view': state.stratView = val; break;
      case 'chart-line': state.chartHidden.has(val) ? state.chartHidden.delete(val) : state.chartHidden.add(val); break;
      case 'export-quality': download('长衡-数据质量.json', JSON.stringify(window.DATA_QUALITY || {}, null, 2)); return;
      default: return;
    }
    render();
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'fund-search') { state.query = el.value; state.page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(renderFundResults, 120); }
    if (el.id === 'stock-search') {
      state.stockQuery = el.value; clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { const value = state.stockQuery; render(); const input = $('#stock-search'); if (input) { input.focus(); input.value = value; } }, 200);
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
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
