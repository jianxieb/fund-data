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
  const years = [1, 2, 3, 5, 10], titles = { overview: '研究总览', indices: '指数观察', funds: '基金研究', stocks: '个股观察', strategy: '投入策略', quality: '数据与方法' };
  const funds = M.dedupeFunds(window.FUNDS, window.EXTRA);
  const policy = window.SCREEN_POLICY || { shortlist: [], byCode: {}, rules: [], counts: {} };
  const shortlist = new Set(policy.shortlist || []);
  const VIEW = 'changheng.research-view.v2';
  const columnNames = { manager: '基金经理与任期', risk: '回撤与波动率', fees: '管理、托管、销售服务费', trade: '买入与卖出费率', size: '规模', nav: '净值与日涨跌', inception: '成立日期', status: '申购与限额', quote: '交易价与溢价', dates: '数据日期与复核状态' };
  const defaultColumns = ['manager', 'risk', 'fees', 'trade', 'size', 'nav', 'inception', 'status', 'dates'];
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(VIEW) || '{}') || {}; } catch (_) {}
  const defaults = { minA3: 5, minA5: 8, minHistoryYears: 7, minScale: 1, minManagerYears: 5, ...policy.defaults };
  const state = {
    route: 'overview', annual: prefs.annual !== false, periods: M.visiblePeriods(prefs.periods),
    columns: new Set(Array.isArray(prefs.columns) ? prefs.columns.filter(x => Object.hasOwn(columnNames, x)) : defaultColumns),
    indexTab: 'cn', currency: 'usd', benchmarkType: 'total', benchmarkCurrency: 'cny',
    fundTab: 'equity', query: '', channel: 'all', purchasable: false,
    screen: { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null }, equityAll: false,
    fundSort: 'default', descending: true, page: 1, selected: new Set(),
    stockStyle: 'all', stockQuery: '', stockSort: 'default', stockDesc: true,
    stratPanel: 'initial', stratAsset: 'SPY', leverage: false
  };
  let lastFocus = null, toastTimer, searchTimer;
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
    return '<section class="benchmark-panel' + (state.route === 'funds' ? ' compact' : '') + '" aria-label="标普500参照"><div class="benchmark-title"><div><span class="eyebrow">THE BENCHMARK</span><h2>标普500参照</h2></div><div class="benchmark-controls"><select id="benchmark-type" aria-label="标普500回报口径"><option value="total"' + (state.benchmarkType === 'total' ? ' selected' : '') + '>SPY ETF · 含分红复权</option><option value="price"' + (state.benchmarkType === 'price' ? ' selected' : '') + '>标普500 · 价格指数</option></select><select id="benchmark-currency" aria-label="标普500计价币种"><option value="cny"' + (state.benchmarkCurrency === 'cny' ? ' selected' : '') + '>人民币</option><option value="usd"' + (state.benchmarkCurrency === 'usd' ? ' selected' : '') + '>美元</option></select></div></div>' +
      '<div class="benchmark-values">' + state.periods.map(y => '<div><span>' + periodHead(y) + '</span><strong class="num">' + pc(ret(r && r[years.indexOf(y)], y, b)) + '</strong></div>').join('') + '</div><div class="benchmark-foot"><span>截至 ' + esc(b && b.asOf || '未记录') + ' · ' + (state.route === 'funds' ? state.benchmarkType === 'total' ? 'SPY含分红、含产品费用' : '价格指数，不含分红' : state.benchmarkType === 'total' ? 'SPY为可投资ETF参照，含产品费用；不是指数全收益序列。' : '价格指数不含分红，不与基金含分红回报直接计算差值。') + '</span>' + action('查看区间与来源', 'benchmark-detail', 'text-link small') + '</div></section>';
  }
  function home() {
    const verified = funds.filter(verifiedReturn).length;
    const entries = [
      ['equity', '长期权益', '以多年收益和经理连续性筛选，逐项查看回撤与成本。', '01'],
      ['overseas', '海外基金', '将标普500、纳斯达克与其他海外市场放在一起研究。', '02'],
      ['dividend', '红利策略', '把分红风格作为权益研究的一部分，核对完整费用。', '03'],
      ['fixed', '债券与固收', '单独比较债券、偏债混合与固收工具。', '04']
    ];
    return head('LONG-TERM INVESTMENT RESEARCH', '长期表现，值得仔细比较。', '从指数到基金，从回报到成本。让每一次投资研究有据可查。', annualControl() + action('研究权益基金 →', 'research-entry', 'btn primary', 'data-value="equity"')) + '<div class="table-controls">' + periodControl() + '</div>' +
      '<div class="home-lead">' + benchmarkPanel() + '<section class="research-intro"><span class="eyebrow">EQUITY RESEARCH</span><h2>多看几年，<br>多问一层。</h2><p>一段漂亮的收益来自什么：市场、策略，还是现任经理？把不同周期、经理任期、风险与费用放在同一张表里判断。</p>' + action('打开基金研究 →', 'research-entry', 'text-link', 'data-value="equity"') + '</section></div>' +
      '<div class="research-entry-grid">' + entries.map(([id, title, desc, no]) => '<article class="review-card"><span class="eyebrow">' + no + ' / EXPLORE</span><h2>' + title + '</h2><p>' + desc + '</p>' + action('进入研究 →', 'research-entry', 'text-link', 'data-value="' + id + '"') + '</article>').join('') + '</div>' +
      '<div class="section-head"><div><h2>数据覆盖，公开可查</h2><p>研究池来自既有筛选样本，尚不覆盖全市场。</p></div><a href="#quality" class="text-link small">查看数据与方法 →</a></div><div class="stats-grid">' +
      stat('基金研究池', funds.length, '只', '统一经理、收益、风险、费用字段') + stat('收益已复算', verified, '只', '其余历史快照逐项标记待核验') + stat('独立国内指数', (window.INDEX_DATA || []).filter(r => ['available', 'cached'].includes(r.status)).length, '个', '直接使用指数日线计算收益') + stat('投入策略实验', (window.STRATEGY_RESULTS || []).length, '组', '相同期间，比较资金投入节奏') + '</div>' +
      '<div class="two-col">' + card('市场本身，表现如何？', '价格指数与含分红产品分别标注', '<div class="card-body"><p class="small muted">先用独立指数理解市场，再看具体产品是否提供了值得研究的回报。</p><a class="text-link entry-link" href="#indices">浏览国内与海外指数 →</a></div>') + card('同一资产，怎样投入？', '统一期间与投入假设', '<div class="card-body"><p class="small muted">比较一次投入、分批投入与定期投入，核对总投入、资金加权年化和回撤。</p><a class="text-link entry-link" href="#strategy">查看投入策略 →</a></div>') + '</div>';
  }
  function indices() {
    const domestic = window.INDEX_DATA || [], benchmarks = window.BM || [];
    let rows = state.indexTab === 'cn' ? domestic : benchmarks.filter(b => state.indexTab === 'us' ? /指数/.test(b.tp) : !/指数/.test(b.tp));
    const tabNames = [['cn', '国内指数'], ['us', '海外指数'], ['etf', '海外 ETF 参照']];
    const rowsHtml = rows.map((r, i) => {
      const returns = state.indexTab === 'cn' ? r.r : r[state.currency];
      const risk = state.indexTab === 'cn' ? { mdd: r.mdd5, vol: r.vol5 } : r[state.currency === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
      return '<tr><td>' + action(esc(r.n), 'index-detail', 'text-link', 'data-value="' + i + '"') + '<span class="sub">' + esc(r.c || r.symbol || r.tp || '') + ' &nbsp; ' + esc(r.category || (state.currency === 'usd' ? '美元' : '人民币')) + '</span></td>' +
        state.periods.map(y => '<td>' + pc(ret(returns && returns[years.indexOf(y)], y, r)) + ((r.backfilledPeriods || []).includes(y) ? '<span class="sub">含发布前回溯</span>' : '') + '</td>').join('') +
        '<td>' + pc(risk.mdd, 1) + '</td><td>' + pct(risk.vol, 1, false) + '</td><td>' + esc(r.asof || r.asOf || '待核验') + '</td></tr>';
    }).join('');
    return head('MARKET OBSERVATORY', '先理解资产，再选择工具。', '指数表现由指数自身计算；关联基金数量不参与收益计算。', annualControl()) +
      '<div class="tabs" role="tablist">' + tabNames.map(([id, n]) => action(n, 'index-tab', state.indexTab === id ? 'active' : '', 'data-value="' + id + '" role="tab" aria-selected="' + (state.indexTab === id) + '"')).join('') + '</div>' +
      '<div class="toolbar"><div class="study-summary"><span>' + (state.indexTab === 'cn' ? '12个公开指数 + 1个授权数据缺口' : state.indexTab === 'us' ? '价格指数 · 不含分红再投资' : '产品参照 · 杠杆ETF单日倍数不等于长期倍数') + '</span></div>' +
      (state.indexTab === 'cn' ? badge('人民币 · 价格口径') : '<div class="segmented">' + action('美元', 'currency', state.currency === 'usd' ? 'active' : '', 'data-value="usd"') + action('人民币', 'currency', state.currency === 'cny' ? 'active' : '', 'data-value="cny"') + '</div>') + '</div>' +
      '<div class="table-controls">' + periodControl() + '</div><div class="card"><div class="table-wrap"><table class="research-table"><thead><tr><th>指数 / 产品</th>' + state.periods.map(y => '<th>' + periodHead(y) + '</th>').join('') + '<th>5年最大回撤</th><th>5年波动率</th><th>截至日</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div><div class="panel-foot"><span>点击名称查看来源、基期与历史边界。— 表示未提供或历史不足，不等于0。</span></div></div>' +
      '<div class="notice" style="margin-top:20px">' + (state.indexTab === 'cn' ? '价格指数不含现金分红，与基金含分红收益不可直接相减。科创100、中证2000等部分长周期包含发布前回溯，已逐格标记；万得微盘缺少授权原始日线，保留数据缺口。' : (state.indexTab === 'us' ? '价格指数与基金总回报定义不同。本页不把二者的收益差称为跟踪误差；人民币收益使用各区间实际端点汇率。' : '普通ETF与杠杆ETF分别看待。风险列缺失时不采用其他产品或其他期间的数据代填。') + (state.currency === 'cny' ? '完整人民币日风险仍缺少实际汇率观测，留空并在详情列出缺失日；不以美元风险代填。' : '本页风险按美元序列计算。')) + '</div>' +
      '<div class="big-callout"><div><h2>同一个指数，也有不同的投资成本。</h2><p>在统一的基金研究库中，比较渠道、持续费用、申购限制与历史风险。</p></div>' + action('查找对应基金 →', 'go-index-funds', 'btn') + '</div>';
  }
  function fundTabPass(f, tab) {
    const rule = (policy.byCode || {})[f.c] || {};
    if (tab === 'equity') return M.equityQualifies(rule, { ...defaults, ...state.screen }) && (state.equityAll || shortlist.has(f.c));
    if (tab === 'overseas') return rule.region ? ['overseas', 'global', 'cross_border', 'mixed', 'cn_hk'].includes(rule.region) : f.overseasExposure;
    if (tab === 'dividend') return rule.category === 'dividend' || f.dividend;
    if (tab === 'theme') return rule.category === 'theme';
    if (tab === 'commodity') return rule.category === 'commodity' || f.asset === 'gold';
    if (tab === 'passive') return /指数|ETF|联接/.test((f.n || '') + ' ' + (f.ix || ''));
    if (tab === 'fixed') return rule.category === 'fixed_income' || /债券|偏债|货币|固收[+＋]/.test((f.n || '') + ' ' + (f.ix || ''));
    if (tab === 'active') return f.active && !['fixed_income', 'commodity', 'fof'].includes(rule.category);
    return true;
  }
  function fundRows() {
    const q = state.query.trim().toLowerCase();
    const result = funds.filter(f => fundTabPass(f, state.fundTab) && (!q || [f.n, f.c, f.ix, f.mgr].join(' ').toLowerCase().includes(q)) && (state.channel === 'all' || (state.channel === 'exchange' ? f.exchange : !f.exchange)) && (!state.purchasable || f.exchange || /^(开放|限大额|开放申购)$/.test(f.st)));
    const value = f => state.fundSort.startsWith('return:') ? ret(f.r[years.indexOf(+state.fundSort.split(':')[1])], +state.fundSort.split(':')[1], f) : state.fundSort === 'fee' ? f.annualFee : state.fundSort === 'risk' ? f.mdd5 : state.fundSort === 'size' ? f.sz : state.fundSort === 'manager' ? f.mten : f.c;
    if (state.fundSort !== 'default') result.sort((a, b) => M.compareNullable(value(a), value(b), state.descending) || a.c.localeCompare(b.c));
    else if (state.fundTab === 'equity') result.sort((a, b) => state.equityAll ? M.compareNullable((policy.byCode[a.c].thresholdInputs || {}).a5, (policy.byCode[b.c].thresholdInputs || {}).a5, true) || a.c.localeCompare(b.c) : policy.shortlist.indexOf(a.c) - policy.shortlist.indexOf(b.c));
    return result;
  }
  function buyFee(f) { return f.exchange ? '券商佣金' : esc(f.buy || '未收录'); }
  function redemption(f, full = false) {
    return f.exchange ? '券商佣金' : f.rd ? esc(f.rd) + '%' + (full ? '；持有期对应关系待核验' : '') : '未收录';
  }
  function managerText(f, full = false) {
    if (Array.isArray(f.managerRecords) && f.managerRecords.length) return f.managerRecords.filter(m => !m.end || m.end === '至今').map(m => {
      return '<span class="manager-person">' + esc(m.name) + '<span class="sub">' + esc(m.start || '起点未核验') + (m.start ? '起' : '') + '</span><span class="sub">' + esc(m.tenureText || '任期未核验') + '</span></span>';
    }).join('') || esc(f.mgr || '未收录');
    return esc(f.mgr || '未收录') + '<span class="sub">个人任职起点待核验</span>' + (full && f.mstart ? '<span class="sub">旧团队记录起点：' + esc(f.mstart) + '（不作为个人任期）</span>' : '');
  }
  function fundColumns() {
    const cols = [];
    const add = (group, label, cell, key = '', cls = '') => { if (state.columns.has(group)) cols.push({ label, cell, key, cls }); };
    add('manager', '现任经理 / 本基金任期', f => managerText(f), '', 'manager-cell t-left');
    state.periods.forEach(y => cols.push({ label: periodHead(y), key: 'return:' + y, cell: f => pc(ret(f.r[years.indexOf(y)], y, f)) }));
    add('risk', '5年最大回撤', f => pc(f.mdd5, 1) + (f.mdd5 == null && M.finite(f.mdd3) ? '<span class="sub">3年 ' + pct(f.mdd3, 1) + '</span>' : ''), 'risk');
    add('risk', '5年波动率', f => pct(f.vol5, 1, false) + (f.vol5 == null && M.finite(f.v3) ? '<span class="sub">3年 ' + pct(f.v3, 1, false) + '</span>' : ''));
    add('fees', '管理费 / 年', f => pct(f.fee && f.fee[0], 2, false));
    add('fees', '托管费 / 年', f => pct(f.fee && f.fee[1], 2, false));
    add('fees', '销售服务 / 年', f => pct(f.fee && f.fee[2], 2, false));
    add('trade', '买入费率', f => buyFee(f) + '<span class="sub">' + (f.exchange ? '按券商约定' : '原费率 / 历史优惠') + '</span>');
    add('trade', '卖出费率', f => redemption(f) + '<span class="sub">' + (f.exchange ? '按券商约定' : '持有期档位待核验') + '</span>');
    add('size', '规模 / 亿元', f => money(f.sz, 1) + '<span class="sub">' + esc(f.szdate || '日期未独立记录') + '</span>', 'size');
    add('nav', '单位净值 / 日涨跌', f => money(f.nav, 4) + '<span class="sub">' + pc(f.dz, 2) + ' · ' + esc(f.navdate || '日期未记录') + '</span>');
    add('inception', '成立日期', f => esc(f.d || '未收录'));
    add('status', '申购状态 / 日限额', f => badge(f.exchange ? '场内交易' : f.st || '未收录', /暂停/.test(f.st) && !f.exchange ? 'warn' : '') + '<span class="sub">' + (f.exchange ? '不适用场外限额' : /暂停/.test(f.st) ? '暂停期间无可用额度' : esc(f.lm || '限额未收录')) + '</span>');
    add('quote', '交易价 / 溢价', f => money(f.p, 3) + ' / ' + pct(f.prem) + '<span class="sub">' + esc(f.priceAsOf || f.quotedAt || '报价日期未独立记录') + '</span>');
    add('dates', '数据截至 / 收益复核', f => '收益 ' + esc(metricDate(f, 'return')) + '<span class="sub">风险 ' + esc(metricDate(f, 'risk')) + '</span>' + badge(verifiedReturn(f) ? '收益已复算' : '收益待核验', verifiedReturn(f) ? 'green' : 'warn'));
    return cols;
  }
  function fundTable(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / 20));
    state.page = Math.min(totalPages, state.page);
    const page = rows.slice((state.page - 1) * 20, state.page * 20), cols = fundColumns();
    const sort = (n, k) => action(n + (state.fundSort === k ? (state.descending ? ' ↓' : ' ↑') : ''), 'fund-sort', '', 'data-value="' + k + '"');
    return '<div class="card"><div class="table-caption"><span><b>' + rows.length + '</b>只产品' + (state.query ? ' · 搜索“' + esc(state.query) + '”' : '') + ' · 人民币净值口径 · 每页20只</span><div class="pagination">' + action('上一页', 'fund-prev', 'btn sm', state.page <= 1 ? 'disabled' : '') + '<span>' + state.page + ' / ' + totalPages + '</span>' + action('下一页', 'fund-next', 'btn sm', state.page >= totalPages ? 'disabled' : '') + '</div></div><div class="table-wrap fund-table-wrap" tabindex="0" aria-label="基金数据表，可横向滚动"><table class="research-table fund-table"><thead><tr><th>基金 / 跟踪策略</th>' + cols.map(c => '<th' + (c.key ? ' aria-sort="' + (state.fundSort === c.key ? state.descending ? 'descending' : 'ascending' : 'none') + '"' : '') + '>' + (c.key ? sort(c.label, c.key) : c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      (page.length ? page.map(f => '<tr><td><div class="fund-name-row">' + action(esc(f.n), 'fund-detail', 'text-link', 'data-code="' + f.c + '"') + action(state.selected.has(f.c) ? '✓' : '＋', 'compare-toggle', 'fund-compare' + (state.selected.has(f.c) ? ' selected' : ''), 'data-code="' + f.c + '" aria-pressed="' + state.selected.has(f.c) + '" aria-label="对比' + esc(f.n) + '" title="加入或移出对比"') + '</div>' + '<span class="sub"><span class="mono">' + f.c + '</span> · ' + esc(f.exchange ? '场内' : '场外') + '</span><span class="sub fund-strategy">' + esc(f.ix || (f.active ? '主动管理' : '待核验')) + '</span></td>' + cols.map(c => '<td class="' + (c.cls || '') + '">' + c.cell(f) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + (cols.length + 1) + '"><div class="empty"><b>没有符合条件的产品</b>试试名称、代码或更宽的筛选条件。<p>' + action('清除筛选', 'fund-reset', 'text-link') + '</p></div></td></tr>') +
      '</tbody></table></div><div class="panel-foot"><span>— 表示缺失或历史不足 · 收益、风险、净值日期独立记录</span>' + action('导出完整字段 CSV', 'export-funds', 'text-link') + '</div></div>';
  }
  function screenControls() {
    const qualified = funds.filter(f => M.equityQualifies(policy.byCode[f.c], { ...defaults, ...state.screen }));
    return '<details class="screen-panel"' + (screenOpen ? ' open' : '') + '><summary><span>3年年化 ≥ ' + state.screen.minA3 + '% · 5年年化 ≥ ' + state.screen.minA5 + '%' + (state.screen.minA10 === null ? '' : ' · 10年 ≥ ' + state.screen.minA10 + '%') + '</span><b>调整筛选条件</b></summary><div class="screen-heading"><div><h2>长期权益筛选</h2><p>收益门槛可调；债券、红利和行业主题另行研究。</p></div>' + action('完整筛选依据', 'screen-rules', 'text-link small') + '</div>' +
      '<div class="screen-inputs"><label>近3年年化至少 <span><input data-screen="minA3" type="number" min="-100" max="100" step="1" value="' + state.screen.minA3 + '">%</span></label><label>近5年年化至少 <span><input data-screen="minA5" type="number" min="-100" max="100" step="1" value="' + state.screen.minA5 + '">%</span></label><label>近10年年化至少 <span><input data-screen="minA10" type="number" min="-100" max="100" step="1" placeholder="不限" value="' + (state.screen.minA10 === null ? '' : state.screen.minA10) + '">%</span></label>' + action('恢复默认条件', 'screen-reset', 'quiet') + '</div><div class="screen-foot"><span>基金历史≥' + defaults.minHistoryYears + '年 · 规模≥' + defaults.minScale + '亿元 · 主动基金至少一位现任经理任职≥' + defaults.minManagerYears + '年</span>' + action(state.equityAll ? '返回精简候选' : '展开全部合格（' + qualified.length + '只）', 'equity-expand', 'text-link small') + '</div><p class="note">' + (state.equityAll ? '展示当前条件下的全部合格样本，按近5年年化排序。' : '默认精简至最多' + (defaults.maxShortlist || 24) + '只；同策略去重，同经理最多2只、同公司最多3只。') + '筛选通过与数据已复算分别标记，历史业绩不全由现任经理创造。</p></details>';
  }
  function columnControl() {
    return '<details class="column-picker"><summary>显示列 <span>' + state.columns.size + ' / ' + Object.keys(columnNames).length + '</span></summary><div class="column-menu">' + Object.entries(columnNames).map(([id, n]) => '<label><input type="checkbox" data-column="' + id + '"' + (state.columns.has(id) ? ' checked' : '') + '>' + n + '</label>').join('') + '<div class="column-actions">' + action('全部显示', 'columns-all', 'text-link') + action('恢复默认', 'columns-default', 'text-link') + '</div></div></details>';
  }
  function fundView() {
    const tabs = [['equity', '长期权益'], ['overseas', '海外基金'], ['dividend', '红利策略'], ['fixed', '债券与固收'], ['passive', '指数工具'], ['active', '主动权益'], ['theme', '行业主题'], ['commodity', '商品'], ['all', '完整研究池']];
    return head('FUND RESEARCH', '基金研究', '比较多年表现、经理任期与完整成本。', annualControl()) +
      '<div class="tabs" aria-label="研究范围">' + tabs.map(([id, n]) => action(n, 'fund-tab', state.fundTab === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.fundTab === id) + '"')).join('') + '</div>' +
      (state.fundTab === 'equity' ? screenControls() + benchmarkPanel() : '<div class="notice">' + (state.fundTab === 'dividend' ? '红利是权益风格，可能与海外、指数或主动基金重叠。买入、卖出和持续费率使用统一字段。' : state.fundTab === 'fixed' ? '债券与偏债混合单独研究；可转债及固收+仍可能承受明显的权益风险。' : '当前样本来自既有研究池，含历史预筛与幸存者偏差。收益是否已复算，请查看每只产品的资料状态。') + '</div>') +
      '<div class="fund-controls"><div class="toolbar"><div class="filters"><input id="fund-search" type="search" aria-label="搜索基金名称、代码、指数或经理" placeholder="搜索名称、代码、指数或经理" value="' + esc(state.query) + '"><select id="fund-channel" aria-label="交易渠道"><option value="all">全部渠道</option><option value="exchange"' + (state.channel === 'exchange' ? ' selected' : '') + '>场内交易</option><option value="otc"' + (state.channel === 'otc' ? ' selected' : '') + '>场外申赎</option></select><label class="check-label"><input id="purchasable" type="checkbox"' + (state.purchasable ? ' checked' : '') + '>快照显示可买</label></div></div>' +
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
  function strategies() {
    const meta = window.STRATEGY_META || {}, definitions = window.STRATEGY_DEFS || [], assets = window.STRATEGY_ASSETS || [];
    const available = assets.filter(a => state.leverage || a.lev === '1x');
    if (!available.some(a => a.c === state.stratAsset)) state.stratAsset = available[0] && available[0].c;
    const rows = (window.STRATEGY_RESULTS || []).filter(r => r.p === state.stratPanel && r.a === state.stratAsset);
    const verified = meta.modelVersion >= 2 && meta.initialCashIncluded;
    return head('INVESTING RHYTHM', '选择能坚持的投入方式。', '同一资产、相同期间，观察资金何时投入带来的差异。') +
      '<div class="notice' + (verified ? '' : ' warn') + '">' + (verified ? '已重算模型：初始资金在首日全部计入账户，等待买入的资金也算现金。' : '旧模型结果尚未验证，不能用于策略判断。') + ' 回测期 ' + esc(meta.start) + ' → ' + esc(meta.end) + '；默认税费、交易成本与现金利息为0，存在单一起点偏差。</div>' +
      '<div class="toolbar"><div class="segmented">' + action('已有一笔钱', 'strategy-panel', state.stratPanel === 'initial' ? 'active' : '', 'data-value="initial"') + action('持续有新收入', 'strategy-panel', state.stratPanel === 'dca' ? 'active' : '', 'data-value="dca"') + '</div><label class="check-label"><input id="show-leverage" type="checkbox"' + (state.leverage ? ' checked' : '') + '>包含杠杆实验（2× / 3×）</label></div><div class="pill-row">' + available.map(a => action(esc(a.n) + ' · ' + a.lev, 'strategy-asset', 'pill' + (state.stratAsset === a.c ? ' active' : ''), 'data-value="' + a.c + '"')).join('') + '</div>' +
      (state.leverage ? '<div class="notice warn">杠杆ETF通常追求每日倍数，复利路径可能与长期指数收益倍数相差很大。这里只比较实验结果，不进入默认权益候选。</div>' : '') +
      '<div class="card"><div class="table-caption"><span>' + (state.stratPanel === 'initial' ? '首日资金 $' + money(meta.initial) : '基础月度预算 $' + money(meta.monthly) + '；部分加倍投入策略实际预算不同') + '</span><span>' + esc(state.stratAsset) + ' · 美元</span></div><div class="table-wrap"><table class="research-table"><thead><tr><th>投入方式</th><th>累计投入</th><th>期末资产</th><th>XIRR</th><th>净值最大回撤</th><th>最长水下 / 日</th><th>平均仓位</th><th>交易次数</th></tr></thead><tbody>' + rows.map(r => { const def = definitions.find(d => d.id === r.s); return '<tr><td>' + (def ? esc(def.name) : esc(r.s)) + '</td><td>$' + money(r.inv) + '</td><td>$' + money(r.end) + '</td><td>' + pc(verified ? r.irr : null) + '</td><td>' + pc(verified ? r.mdd : null, 1) + '</td><td>' + money(r.uw) + '</td><td>' + pct(r.exp, 1, false) + '</td><td>' + r.tr + '</td></tr>'; }).join('') + '</tbody></table></div><div class="panel-foot"><span>XIRR 是资金加权年化；最大回撤剔除外部现金流影响。投入总额不同，不能只比期末资产。</span></div></div>' +
      '<div class="section-head"><h2>每种策略究竟做了什么</h2></div><div class="card pad"><div class="rule-list">' + definitions.filter(d => d.panel === state.stratPanel).map((d, i) => '<div class="rule-item"><span class="rule-number">0' + (i + 1) + '</span><div><h3>' + esc(d.name) + '</h3><p>' + esc(d.desc) + '</p></div></div>').join('') + '</div></div><p class="note">来源：' + esc(meta.source || '待核验') + '。零成本是假设，不能理解为可实现的净收益。</p>';
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
      '<div class="stats-grid">' + stat('公开国内指数', (window.INDEX_DATA || []).filter(r => ['available', 'cached'].includes(r.status)).length, '个', '指数源独立于基金产品') + stat('研究产品', funds.length, '只', '按基金代码去重') + stat('精简权益候选', shortlist.size, '只', '收益门槛与复核状态分开') + stat('待核验类别', q.summary.unverified || 0, '项', '逐项说明见下方') + '</div>' +
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
    const rows = state.indexTab === 'cn' ? (window.INDEX_DATA || []) : (window.BM || []).filter(b => state.indexTab === 'us' ? /指数/.test(b.tp) : !/指数/.test(b.tp));
    const x = rows[i]; if (!x) return;
    const r = state.indexTab === 'cn' ? x.r : x[state.currency];
    const risk = state.indexTab === 'cn' ? { mdd: x.mdd5, vol: x.vol5 } : x[state.currency === 'usd' ? 'riskUSD5' : 'riskCNY5'] || {};
    openModal(modalTitle(esc(x.n), esc(x.c || x.symbol || x.tp || '')) + '<div class="notice">' + esc(basisText(x.basis)) + '。' + esc(x.note || '') + '</div>' + returnTable(r, x) +
      detailGrid([['数据截至', esc(x.asof || x.asOf || '未核验')], ['实际序列起点', esc(x.first || (x.periods && x.periods.length && x.periods[x.periods.length - 1].start) || '查看原始来源')], ['指数发布日', esc(x.launchDate || '见编制机构')], ['近5年回撤 / 年化波动', pct(risk.mdd, 2, false) + ' / ' + pct(risk.vol, 2, false) + '<span class="sub">' + (state.indexTab === 'cn' ? '人民币' : state.currency === 'usd' ? '美元' : '人民币') + '</span>'], ['数据源', esc(x.source || '见供应商日线')], ['周年窗口基准日', esc((x.baseDates || []).map((d, j) => years[j] + '年：' + (d || '不足')).join('；') || (x.periods || []).map(p => p.years + '年：' + p.start + ' → ' + p.end).join('；') || '各期间实际日期见原始数据')]]) +
      (risk.reason ? '<div class="notice warn">' + esc(risk.reason) + (risk.missingFxDates ? '。缺失日期：' + esc(risk.missingFxDates.join('、')) : '') + '</div>' : '') +
      (x.backfilledPeriods && x.backfilledPeriods.length ? '<div class="notice warn">近' + x.backfilledPeriods.join(' / ') + '年包含发布前回溯；这部分不是当时可投资的指数实绩。</div>' : '') +
      '<div class="actions">' + extLink(x.sourceUrl || x.source, '原始行情来源') + (x.identityUrl ? extLink(x.identityUrl, '官方指数说明') : '') + (state.currency === 'cny' && x.fxSourceUrl ? extLink(x.fxSourceUrl, '美元兑人民币汇率') : '') + '</div><div class="dialog-footer">' + action('在基金库搜索此标的', 'find-index-funds', 'btn primary', 'data-value="' + esc(x.n.replace(/指数$/, '')) + '"') + '</div>');
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
    if (hash === 'us') state.fundTab = 'overseas';
    if (hash === 'cn') state.fundTab = 'equity';
    state.route = titles[hash] ? hash : legacy[hash] || 'overview';
    render(); window.scrollTo(0, 0);
  }
  function go(name) { if (location.hash === '#' + name) { state.route = name; render(); } else location.hash = name; }
  document.addEventListener('click', event => {
    if (event.target.closest('.skip')) { event.preventDefault(); $('#main').focus(); $('#main').scrollIntoView(); return; }
    const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
    const act = button.dataset.action, val = button.dataset.value, code = button.dataset.code;
    switch (act) {
      case 'close': $('#dialog').close(); return;
      case 'annual': state.annual = val === '1'; savePrefs(); break;
      case 'research-entry': state.fundTab = val; state.query = ''; state.page = 1; state.fundSort = 'default'; go('funds'); return;
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
      case 'index-tab': state.indexTab = val; break;
      case 'currency': state.currency = val; break;
      case 'index-detail': openIndex(Number(val)); return;
      case 'go-index-funds': state.fundTab = 'passive'; state.query = ''; state.page = 1; go('funds'); return;
      case 'find-index-funds': state.fundTab = 'all'; state.query = val; state.page = 1; $('#dialog').close(); go('funds'); return;
      case 'fund-tab': state.fundTab = val; state.page = 1; state.fundSort = 'default'; break;
      case 'fund-sort': state.descending = state.fundSort === val ? !state.descending : val !== 'fee'; state.fundSort = val; state.page = 1; renderFundResults(); return;
      case 'fund-prev': state.page--; renderFundResults(); return;
      case 'fund-next': state.page++; renderFundResults(); return;
      case 'fund-reset': state.query = ''; state.channel = 'all'; state.purchasable = false; state.page = 1; state.screen = { minA3: defaults.minA3, minA5: defaults.minA5, minA10: null }; state.equityAll = false; break;
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
      case 'strategy-panel': state.stratPanel = val; break;
      case 'strategy-asset': state.stratAsset = val; break;
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
    if (el.id === 'benchmark-type') { state.benchmarkType = el.value; render(); return; }
    if (el.id === 'benchmark-currency') { state.benchmarkCurrency = el.value; render(); return; }
    if (el.id === 'fund-channel') { state.channel = el.value; state.page = 1; renderFundResults(); }
    else if (el.id === 'purchasable') { state.purchasable = el.checked; state.page = 1; renderFundResults(); }
    else if (el.id === 'show-leverage') { state.leverage = el.checked; render(); }
  });
  $('#dialog').addEventListener('close', () => { if (lastFocus && lastFocus.isConnected) lastFocus.focus(); else restoreFocus(lastFocus); });
  document.addEventListener('keydown', e => {
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
