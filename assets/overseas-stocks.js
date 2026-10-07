(function (root) {
  'use strict';
  const M = root.Changheng;
  const state = { view: 'financials', category: 'all', query: '', sort: 'default', descending: true };
  let H;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const sub = text => '<span class="sub">' + H.esc(text || '') + '</span>';
  const amount = (n, currency) => finite(n) ? H.money(n / 1e8, 2) + sub('亿' + (currency === 'TWD' ? '新台币' : '美元')) : '—';
  const growth = g => finite(g?.value) ? H.pc(g.value, 1) + sub(g.label) : H.esc(g?.label || '缺同期数据');
  const pe = s => finite(s.pe) ? H.money(s.pe, 2) : s.peStatus === 'loss' ? '<span class="negative">亏损</span>' : '缺TTM每股收益';
  const periodLabel = f => f.dateBasis === 'issuer_report_end' ? f.reportDate : f.period + '季';
  const cagr = value => finite(value?.value) ? H.pct(value.value, 1) : value?.reason || '缺年度历史';
  const identity = s => '<td class="stock-identity overseas-company"><span class="stock-name">' + H.action(H.esc(s.n), 'os-stock-detail', 'text-link', 'data-value="' + H.esc(s.symbol) + '"') + '</span>' + sub(s.symbol + ' · ' + (s.securityType || '美股')) + '<span class="stock-business-label">' + H.esc(s.business) + '</span><a class="stock-report-entry" href="#stock-report/' + s.symbol + '" aria-label="' + H.esc(s.n + '深入报告') + '">深入报告 <span aria-hidden="true">↗</span></a></td>';
  const paragraphs = lines => (lines || []).map(text => '<span>' + H.esc(text) + '</span>').join('');
  const estimatedPe = (s, key) => {
    if (finite(s[key])) return H.money(s[key], 2);
    const latest = key === 'peDynamic' ? s.financials : s.analysis.annual.at(-1);
    const eps = latest?.[s.financialCurrency === 'USD' ? 'DilutedEPS' : 'ListingDilutedEPSUSD'];
    return '<span class="muted">' + (finite(eps) ? eps < 0 ? '亏损' : 'EPS为零' : '缺美元' + (s.financialCurrency === 'USD' ? '' : 'ADR') + (key === 'peDynamic' ? '季度' : '年度') + 'EPS') + '</span>';
  };
  function rows() {
    const query = state.query.trim().toLowerCase();
    const result = (root.OVERSEAS_STOCKS || []).filter(s => (state.category === 'all' || s.category === state.category) && (!query || [s.symbol, s.name, s.issuer, s.category, s.business].join(' ').toLowerCase().includes(query)));
    const metric = s => state.sort.startsWith('return:') ? s.r[[1, 2, 3, 5, 10].indexOf(+state.sort.split(':')[1])] : state.sort === 'roe' ? s.financials.roeTTM : state.sort === 'revenueGrowth' ? s.financials.revenueGrowth.value : state.sort === 'profitGrowth' ? s.financials.profitGrowth.value : state.sort === 'cashConversion' ? s.analysis.cashConversion : s[state.sort];
    if (state.sort !== 'default') result.sort((a, b) => M.compareNullable(metric(a), metric(b), state.descending));
    return result;
  }
  function th(label, key) {
    return '<th aria-sort="' + (state.sort === key ? state.descending ? 'descending' : 'ascending' : 'none') + '">' + (key ? H.action(H.esc(label) + (state.sort === key ? state.descending ? ' ↓' : ' ↑' : ''), 'os-stock-sort', '', 'data-value="' + key + '"') : H.esc(label)) + '</th>';
  }
  function view(helpers) {
    H = helpers;
    const all = root.OVERSEAS_STOCKS || [], data = rows(), categories = [...new Set(all.map(s => s.category))];
    const filters = '<div class="stock-category-filter" role="group" aria-label="海外公司行业">' + [['all', '全部行业'], ...categories.map(c => [c, c])].map(([id, name]) => H.action(H.esc(name), 'os-stock-category', 'filter-chip' + (state.category === id ? ' active' : ''), 'data-value="' + H.esc(id) + '" aria-pressed="' + (state.category === id) + '"')).join('') + '</div>';
    const controls = '<div class="stock-controls"><div class="filters"><input type="search" id="os-stock-search" aria-label="搜索海外公司、代码或业务" placeholder="搜索海外公司、代码或业务" value="' + H.esc(state.query) + '"></div>' + (state.view === 'returns' ? H.returnControls(false) : '') + '</div>';
    const views = '<div class="segmented stock-view" aria-label="海外个股研究视图">' + [['financials', '财务与理由'], ['valuation', '估值'], ['returns', '收益与风险']].map(([id, label]) => H.action(label, 'os-stock-view', state.view === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.view === id) + '"')).join('') + '</div>';
    let headers, cells;
    if (state.view === 'financials') {
      headers = th('资本回报', 'roe') + th('营收增长', 'revenueGrowth') + th('利润增长', 'profitGrowth') + th('现金回收', 'cashConversion') + th('研究要点') + th('风险');
      cells = s => { const f = s.financials, a = s.analysis; return '<td class="stock-roe"><strong>' + (finite(f.roeTTM) ? H.pct(f.roeTTM, 1, false) : '—') + '</strong>' + sub('ROE / TTM · ' + periodLabel(f)) + '<span class="stock-annual">3年均值 ' + H.pct(a.roe3, 1, false) + '</span>' + (!finite(f.roeTTM) ? sub(f.roeMissing) : '') + '</td><td>' + growth(f.revenueGrowth) + sub('最新单季 · ' + periodLabel(f)) + '<span class="stock-annual">3年复合 ' + H.esc(cagr(a.revenueCagr3)) + '</span></td><td>' + growth(f.profitGrowth) + sub('最新单季报表利润') + '<span class="stock-annual">TTM净利率 ' + H.pct(a.ttmNetMargin, 1, false) + '</span>' + (f.note && s.symbol === 'LITE' ? H.action('债转股一次性损失', 'os-stock-detail', 'text-link small', 'data-value="LITE"') : '') + '</td><td><strong>' + (finite(a.cashConversion) ? H.money(a.cashConversion, 2) + '倍' : '—') + '</strong>' + sub('TTM经营现金 / 净利润') + '<span class="stock-annual">经营现金 ' + (finite(f.ttmCash) ? H.money(f.ttmCash / 1e8, 1) + '亿' + (s.financialCurrency === 'TWD' ? '新台币' : '美元') : '缺连续四季') + '</span>' + (!finite(a.cashConversion) && finite(f.ttmProfit) && f.ttmProfit <= 0 ? sub('报表亏损，不计算倍数') : '') + '</td><td class="stock-reason overseas-reason">' + paragraphs(s.research.thesis.slice(0, 2)) + '</td><td class="stock-risk overseas-risk">' + paragraphs(s.research.risks.slice(0, 2)) + '</td>'; };
    } else if (state.view === 'valuation') {
      headers = th('收盘价 / 美元', 'price') + th('PE / TTM', 'pe') + th('季度年化PE', 'peDynamic') + th('静态PE', 'peStatic') + th('预测PE', 'peForward') + th('每股收益 / 美元', 'epsTTM') + th('收盘 / 预测日期');
      cells = s => '<td>' + H.money(s.price, 2) + '</td><td>' + pe(s) + '</td><td>' + estimatedPe(s, 'peDynamic') + sub(periodLabel(s.financials) + '单季 × 4') + '</td><td>' + estimatedPe(s, 'peStatic') + sub(s.staticPeriod + '财年') + '</td><td>' + H.money(s.peForward, 2) + sub('分析师年度预期') + '</td><td>' + H.money(s.epsTTM, 2) + sub('TTM') + '<span class="stock-annual">预测 ' + H.money(s.epsForward, 2) + '</span></td><td>' + H.esc(s.priceAsOf) + sub('预期采集 ' + s.estimateAsOf) + '</td>';
    } else {
      headers = th('近12月股息率', 'yield12') + H.periods.map(y => th(H.periodHead(y), 'return:' + y)).join('') + th('上市以来累计', 'sinceListing') + th('近5年内最大回撤', 'mdd5') + th('近5年内波动率', 'vol5') + th('收益截至');
      cells = s => '<td>' + H.pct(s.yield12, 2, false) + sub(finite(s.cashDividend12) ? '每份 ' + H.money(s.cashDividend12, 3) + '美元' : s.dividendMissing) + '</td>' + H.periods.map(y => '<td>' + H.pc(H.ret(s.r[[1, 2, 3, 5, 10].indexOf(y)], y, s)) + (s.r[[1, 2, 3, 5, 10].indexOf(y)] == null ? sub('历史不足' + y + '年') : '') + '</td>').join('') + '<td>' + H.pc(s.sinceListing) + sub(s.first + '起') + '</td><td>' + H.pc(s.mdd5, 1) + (s.risk5.partial ? sub('上市以来') : '') + '</td><td>' + H.pct(s.vol5, 1, false) + (s.risk5.partial ? sub('上市以来') : '') + '</td><td>' + H.esc(s.returnAsOf) + '</td>';
    }
    return filters + controls + '<section class="card"><div class="table-caption stock-table-caption"><span><b>' + data.length + '</b> / ' + all.length + '家公司</span>' + views + '</div><div class="table-wrap stock-table-wrap" tabindex="0" role="region" aria-label="海外个股研究表，可横向滚动"><table class="research-table stock-table overseas-stock-table ' + (state.view === 'financials' ? 'overseas-financial-table' : '') + '"><thead><tr><th>公司 / 主营业务</th>' + headers + '</tr></thead><tbody>' + H.lazyRows('overseas-stocks', data, s => '<tr>' + identity(s) + cells(s) + '</tr>') + (!data.length ? '<tr><td colspan="12"><div class="empty">没有匹配的海外公司</div></td></tr>' : '') + '</tbody></table></div>' + H.loadFooter('overseas-stocks') + (state.view === 'returns' ? '<div class="panel-foot"><span>美元 · 含分红再投资 · 未扣个人交易费与税款</span></div>' : '') + '</section>';
  }
  function detail(symbol) {
    const s = (root.OVERSEAS_STOCKS || []).find(r => r.symbol === symbol);
    if (!s) return;
    const f = s.financials, c = s.financialCurrency;
    const sourceLink = (url, label) => '<a href="' + H.esc(url) + '" target="_blank" rel="noopener noreferrer">' + H.esc(label) + ' ↗</a>';
    const financialRows = Object.values(s.financialHistory.quarterly).sort((a, b) => b.period.localeCompare(a.period));
    const table = '<div class="table-wrap"><table><thead><tr><th>季度截至</th><th>营收 / 亿' + (c === 'TWD' ? '新台币' : '美元') + '</th><th>净利润</th><th>营业利润</th><th>经营现金流</th></tr></thead><tbody>' + financialRows.map(q => '<tr><td>' + H.esc(periodLabel(q)) + '</td>' + ['TotalRevenue', 'NetIncome', 'TotalOperatingIncomeAsReported', 'OperatingCashFlow'].map(k => '<td>' + (finite(q[k]) ? H.money(q[k] / 1e8, 2) : '—') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    const annual = '<h3 class="overseas-detail-heading">年度财务 · ' + (c === 'TWD' ? '新台币' : '美元') + '</h3><div class="table-wrap"><table><thead><tr><th>财年截至</th><th>营收 / 亿</th><th>营收同比</th><th>净利润 / 亿</th><th>利润同比</th><th>经营现金 / 亿</th><th>ROE</th></tr></thead><tbody>' + [...s.analysis.annual].reverse().map(q => '<tr><td>' + H.esc(q.dateBasis === 'issuer_report_end' ? q.reportDate : q.period) + '</td><td>' + H.money(q.TotalRevenue / 1e8, 2) + '</td><td>' + H.pc(q.revenueGrowth, 1) + '</td><td>' + H.money(q.NetIncome / 1e8, 2) + '</td><td>' + H.pc(q.profitGrowth, 1) + '</td><td>' + (finite(q.OperatingCashFlow) ? H.money(q.OperatingCashFlow / 1e8, 2) : '—') + '</td><td>' + H.pct(q.roe, 1, false) + '</td></tr>').join('') + '</tbody></table></div>';
    H.openModal(H.modalTitle(H.esc(s.name) + ' · ' + s.symbol, H.esc(s.business)) + '<p class="overseas-summary">' + H.esc(s.research.summary) + '</p><a class="stock-report-entry" href="#stock-report/' + s.symbol + '">阅读全文：业务、财务、估值与风险 ↗</a>' +
      '<div class="overseas-detail-research"><section><h3>研究要点</h3>' + s.research.thesis.map(t => '<p>' + H.esc(t) + '</p>').join('') + '</section><section><h3>风险</h3>' + s.research.risks.map(t => '<p>' + H.esc(t) + '</p>').join('') + '</section></div>' +
      (f.note ? '<p class="notice warn">' + H.esc(f.note) + '</p>' : '') +
      H.detailGrid([['最新财报', H.esc(periodLabel(f))], ['TTM ROE', finite(f.roeTTM) ? H.pct(f.roeTTM, 1) : H.esc(f.roeMissing)], ['本季营收', amount(f.TotalRevenue, c)], ['本季净利润', amount(f.NetIncome, c)], ['营业利润率', H.pct(f.operatingMargin, 1)], ['TTM经营现金流', amount(f.ttmCash, c)], ['三年营收复合增长', H.esc(cagr(s.analysis.revenueCagr3))], ['三年利润复合增长', H.esc(cagr(s.analysis.profitCagr3))], ['PE / TTM', pe(s)], ['预测PE', H.money(s.peForward, 2)], ['股价截至', H.esc(s.priceAsOf)], ['可用行情起点', H.esc(s.first)]]) + annual + '<h3 class="overseas-detail-heading">季度财务 · ' + (c === 'TWD' ? '新台币' : '美元') + '</h3>' + table +
      '<details class="overseas-method"><summary>数据口径与来源</summary><p>本板块为指定公司研究名单；没有自动授予国内“长期优质企业”或“高质成长股”的筛选结论。同比比较同一公司、同一报告币种的对应季度；亏损基数显示扭亏或亏损变化，不制造增长百分比。ROE为连续四季净利润除以期初期末平均净资产。</p><p>PE使用美元上市证券的TTM每股收益与已收盘股价；TSM使用美元ADR口径。预测PE使用接口提供的分析师年度EPS预期，未与国内“本期利润年化”的动态PE混用。尚缺5年、10年逐时点历史EPS，未计算历史PE分位。不同年度的股份稀释会影响单季EPS加总与年度EPS。</p><p>财报按报表口径（美国公司为GAAP、台积电为IFRS）展示；不以Non-GAAP利润代替。标为“季”的历史日期是接口归一化月份。收益含拆分和分红再投资，未扣个人交易费用及税款；SPCX从SpaceX上市首日收盘开始，未使用IPO发行价。</p><div class="actions">' + sourceLink(s.sourceUrl, '公司原始财报') + sourceLink(s.returnSourceUrl, '股价与分红历史') + sourceLink('https://finance.yahoo.com/quote/' + s.symbol + '/financials/', '财报接口对应页面') + sourceLink('https://finance.yahoo.com/quote/' + s.symbol + '/analysis/', '盈利预期') + (s.identitySourceUrl ? sourceLink(s.identitySourceUrl, 'SPCX身份与历史隔离公告') : '') + '</div></details>');
  }
  function handleAction(button) {
    const act = button.dataset.action, value = button.dataset.value;
    if (act === 'os-stock-detail') { detail(value); return; }
    if (act === 'os-stock-view') { state.view = value; state.sort = 'default'; state.descending = true; }
    else if (act === 'os-stock-category') state.category = value;
    else if (act === 'os-stock-sort') { state.descending = state.sort === value ? !state.descending : true; state.sort = value; }
    else return;
    H.resetList(); H.render();
  }
  function handleInput(el) { state.query = el.value; H.resetList(); }
  root.ChanghengOverseasStocks = { view, handleAction, handleInput };
})(window);
