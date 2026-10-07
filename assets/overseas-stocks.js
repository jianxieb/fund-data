(function (root) {
  'use strict';
  const M = root.Changheng;
  const groups = [['quality', '长期优质企业'], ['growth', '高质成长股'], ['breakout', '业绩爆发股'], ['dividend', '红利价值'], ['other', '其他已收录']];
  const state = { group: 'quality', view: 'financials', category: 'all', query: '', sort: 'default', descending: true };
  let H;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const sub = text => '<span class="sub">' + H.esc(text || '') + '</span>';
  const amount = (n, currency) => finite(n) ? H.money(n / 1e8, 2) + sub('亿' + (currency === 'TWD' ? '新台币' : '美元')) : '—';
  const growth = g => finite(g?.value) ? H.pc(g.value, 1) + sub(g.label) : H.esc(g?.label || '缺同期数据');
  const pe = s => finite(s.pe) ? H.money(s.pe, 2) : s.peStatus === 'loss' ? '<span class="negative">亏损</span>' : '缺TTM每股收益';
  const periodLabel = f => f.dateBasis === 'issuer_report_end' ? f.reportDate : f.period + '季';
  const cagr = value => finite(value?.value) ? H.pct(value.value, 1) : value?.reason || '缺年度历史';
  const overlap = s => s.screening.groups.includes('quality') && s.screening.groups.includes('growth');
  const identity = s => '<td class="stock-identity overseas-company' + (overlap(s) ? ' stock-overlap-company' : '') + '"' + (overlap(s) ? ' title="同时入选长期优质与高质成长"' : '') + '><span class="stock-name">' + H.action(H.esc(s.n), 'os-stock-detail', 'text-link', 'data-value="' + H.esc(s.symbol) + '"') + '</span>' + sub(s.symbol + ' · ' + (s.securityType || '美股')) + '<span class="stock-business-label">' + H.esc(s.business) + '</span><a class="stock-report-entry" href="#stock-report/' + s.symbol + '" aria-label="' + H.esc(s.n + '深入报告') + '">深入报告 <span aria-hidden="true">↗</span></a></td>';
  const paragraphs = lines => (lines || []).map(text => '<span>' + H.esc(text) + '</span>').join('');
  const estimatedPe = (s, key) => {
    if (finite(s[key])) return H.money(s[key], 2);
    const latest = key === 'peDynamic' ? s.financials : s.analysis.annual.at(-1);
    const eps = latest?.[s.financialCurrency === 'USD' ? 'DilutedEPS' : 'ListingDilutedEPSUSD'];
    return '<span class="muted">' + (finite(eps) ? eps < 0 ? '亏损' : 'EPS为零' : '缺美元' + (s.financialCurrency === 'USD' ? '' : 'ADR') + (key === 'peDynamic' ? '季度' : '年度') + 'EPS') + '</span>';
  };
  const matches = s => s.screening.groups.includes(state.group);
  function reason(s) {
    const r = s.research, a = s.analysis;
    if (state.group === 'other') return paragraphs([r.thesis[0], s.screening.otherReasons[0]]) + H.action('查看分类依据', 'os-stock-detail', 'text-link small', 'data-value="' + H.esc(s.symbol) + '"');
    if (state.group === 'quality') return paragraphs([r.longTerm.durability, '5年平均ROE ' + (finite(s.screening.roe5) ? s.screening.roe5.toFixed(1) + '%' : '—') + ' · 3年利润复合 ' + cagr(a.profitCagr3)]);
    if (state.group === 'dividend') return paragraphs([r.thesis[0], '连续5年现金分红 · 派息比率 ' + (s.screening.payoutRatio * 100).toFixed(1) + '%' + (s.accountingModel === 'reits' ? ' / AFFO' : ' / 报表EPS')]);
    return paragraphs([r.earningsReview.driver, s.screening.quarters.map(q => q.reportDate + '：利润 ' + (finite(q.profitGrowth) ? q.profitGrowth.toFixed(1) + '%' : '缺正基数') + ' / 营业利润 ' + (finite(q.operatingGrowth) ? q.operatingGrowth.toFixed(1) + '%' : '缺正基数')).join('；')]);
  }
  function rows() {
    const query = state.query.trim().toLowerCase();
    const result = (root.OVERSEAS_STOCKS || []).filter(s => matches(s) && (state.category === 'all' || s.category === state.category) && (!query || [s.symbol, s.name, s.issuer, s.category, s.business].join(' ').toLowerCase().includes(query)));
    const metric = s => state.sort.startsWith('return:') ? s.r[[1, 2, 3, 5, 10].indexOf(+state.sort.split(':')[1])] : state.sort === 'roe' ? s.financials.roeTTM : state.sort === 'revenueGrowth' ? s.financials.revenueGrowth.value : state.sort === 'profitGrowth' ? s.financials.profitGrowth.value : state.sort === 'cashConversion' ? s.analysis.cashConversion : s[state.sort];
    if (state.sort !== 'default') result.sort((a, b) => M.compareNullable(metric(a), metric(b), state.descending));
    return result;
  }
  function th(label, key) {
    return '<th aria-sort="' + (state.sort === key ? state.descending ? 'descending' : 'ascending' : 'none') + '">' + (key ? H.action(H.esc(label) + (state.sort === key ? state.descending ? ' ↓' : ' ↑' : ''), 'os-stock-sort', '', 'data-value="' + key + '"') : H.esc(label)) + '</th>';
  }
  function view(helpers) {
    H = helpers;
    const all = root.OVERSEAS_STOCKS || [], pool = all.filter(matches), data = rows(), categories = [...new Set(pool.map(s => s.category))];
    const mode = state.view;
    const tabs = '<div class="tabs stock-tabs" role="tablist" aria-label="美股研究分组">' + groups.map(([id, label]) => H.action(label + '<span class="tab-count">' + all.filter(s => s.screening.groups.includes(id)).length + '</span>', 'os-stock-group', (state.group === id ? 'active ' : '') + (id === 'other' ? 'stock-other-tab' : ''), 'data-value="' + id + '" role="tab" aria-selected="' + (state.group === id) + '"')).join('') + '</div>';
    const filters = '<div class="stock-category-filter" role="group" aria-label="美股公司行业">' + [['all', '全部行业'], ...categories.map(c => [c, c])].map(([id, name]) => H.action(H.esc(name), 'os-stock-category', 'filter-chip' + (state.category === id ? ' active' : ''), 'data-value="' + H.esc(id) + '" aria-pressed="' + (state.category === id) + '"')).join('') + '</div>';
    const controls = '<div class="stock-controls"><div class="filters"><input type="search" id="os-stock-search" aria-label="搜索美股公司、代码或业务" placeholder="搜索美股公司、代码或业务" value="' + H.esc(state.query) + '"></div>' + (mode === 'returns' ? H.returnControls(false) : '') + '</div>';
    const views = '<div class="segmented stock-view" aria-label="美股研究视图">' + [['financials', '财务与理由'], ['valuation', '估值'], ['returns', '收益与分红']].map(([id, label]) => H.action(label, 'os-stock-view', state.view === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.view === id) + '"')).join('') + '</div>';
    let headers, cells;
    if (mode === 'financials') {
      headers = th('资本回报', 'roe') + th('营收增长', 'revenueGrowth') + th('利润增长', 'profitGrowth') + th('现金回收', 'cashConversion') + th(state.group === 'other' ? '研究要点 / 未入选原因' : '入选理由') + th('风险');
      cells = s => { const f = s.financials, a = s.analysis; return '<td class="stock-roe"><strong>' + (finite(f.roeTTM) ? H.pct(f.roeTTM, 1, false) : '—') + '</strong>' + sub('ROE / TTM · ' + periodLabel(f)) + '<span class="stock-annual">3年均值 ' + H.pct(a.roe3, 1, false) + '</span>' + (!finite(f.roeTTM) ? sub(f.roeMissing) : '') + '</td><td>' + growth(f.revenueGrowth) + sub((s.revenueLabel || '营收') + ' · ' + periodLabel(f)) + '<span class="stock-annual">3年复合 ' + H.esc(cagr(a.revenueCagr3)) + '</span></td><td>' + growth(f.profitGrowth) + sub('最新单季报表利润') + '<span class="stock-annual">TTM净利率 ' + H.pct(a.ttmNetMargin, 1, false) + '</span>' + (f.note && s.symbol === 'LITE' ? H.action('债转股一次性损失', 'os-stock-detail', 'text-link small', 'data-value="LITE"') : '') + '</td><td><strong>' + (finite(a.cashConversion) ? H.money(a.cashConversion, 2) + '倍' : '—') + '</strong>' + sub(['bank', 'financial', 'holding'].includes(s.accountingModel) ? '金融现金流 · 不套工业门槛' : s.accountingModel === 'reits' ? 'REIT派息另看AFFO' : 'TTM经营现金 / 净利润') + '<span class="stock-annual">经营现金 ' + (finite(f.ttmCash) ? H.money(f.ttmCash / 1e8, 1) + '亿' + (s.financialCurrency === 'TWD' ? '新台币' : '美元') : '缺连续四季') + '</span>' + (!finite(a.cashConversion) && finite(f.ttmProfit) && f.ttmProfit <= 0 ? sub('报表亏损，不计算倍数') : '') + '</td><td class="stock-reason overseas-reason">' + reason(s) + '</td><td class="stock-risk overseas-risk">' + paragraphs(s.research.risks.slice(0, 2)) + '</td>'; };
    } else if (mode === 'valuation') {
      headers = th('收盘价 / 美元', 'price') + th('PE / TTM', 'pe') + th('季度年化PE', 'peDynamic') + th('静态PE', 'peStatic') + th('预测PE', 'peForward') + th('每股收益 / 美元', 'epsTTM') + th('收盘 / 预测日期');
      cells = s => '<td>' + H.money(s.price, 2) + '</td><td>' + pe(s) + '</td><td>' + estimatedPe(s, 'peDynamic') + sub(periodLabel(s.financials) + '单季 × 4') + '</td><td>' + estimatedPe(s, 'peStatic') + sub(s.staticPeriod + '财年') + '</td><td>' + H.money(s.peForward, 2) + sub('分析师年度预期') + '</td><td>' + H.money(s.epsTTM, 2) + sub('TTM') + '<span class="stock-annual">预测 ' + H.money(s.epsForward, 2) + '</span></td><td>' + H.esc(s.priceAsOf) + sub('预期采集 ' + s.estimateAsOf) + '</td>';
    } else {
      headers = th('近12月股息率', 'yield12') + th('5年分红年数') + th('派息比率') + H.periods.map(y => th(H.periodHead(y), 'return:' + y)).join('') + th('上市以来累计', 'sinceListing') + th('近5年内最大回撤', 'mdd5') + th('近5年内波动率', 'vol5') + th('收益截至');
      cells = s => '<td>' + H.pct(s.yield12, 2, false) + sub(finite(s.cashDividend12) ? '每份 ' + H.money(s.cashDividend12, 3) + '美元' : s.dividendMissing) + '</td><td>' + s.screening.dividendYears5 + ' / 5</td><td>' + H.pct(finite(s.screening.payoutRatio) ? s.screening.payoutRatio * 100 : null, 1, false) + sub(s.accountingModel === 'reits' ? '本季现金股息 / AFFO' : '近12月现金股息 / TTM EPS') + '</td>' + H.periods.map(y => '<td>' + H.pc(H.ret(s.r[[1, 2, 3, 5, 10].indexOf(y)], y, s)) + (s.r[[1, 2, 3, 5, 10].indexOf(y)] == null ? sub('历史不足' + y + '年') : '') + '</td>').join('') + '<td>' + H.pc(s.sinceListing) + sub(s.first + '起') + '</td><td>' + H.pc(s.mdd5, 1) + (s.risk5.partial ? sub('上市以来') : '') + '</td><td>' + H.pct(s.vol5, 1, false) + (s.risk5.partial ? sub('上市以来') : '') + '</td><td>' + H.esc(s.returnAsOf) + '</td>';
    }
    return tabs + filters + controls + '<section class="card"><div class="table-caption stock-table-caption"><span><b>' + data.length + '</b> / ' + pool.length + '家公司</span>' + (['quality', 'growth'].includes(state.group) ? '<span class="stock-overlap-legend">绿色公司：长期优质＋高成长</span>' : '') + views + '</div><div class="table-wrap stock-table-wrap" tabindex="0" role="region" aria-label="美股研究表，可横向滚动"><table class="research-table stock-table overseas-stock-table ' + (mode === 'financials' ? 'overseas-financial-table' : '') + '"><thead><tr><th>公司 / 主营业务</th>' + headers + '</tr></thead><tbody data-list-body="overseas-stocks">' + H.lazyRows('overseas-stocks', data, s => '<tr>' + identity(s) + cells(s) + '</tr>') + (!data.length ? '<tr><td colspan="14"><div class="empty">当前分组没有匹配的美股公司</div></td></tr>' : '') + '</tbody></table></div>' + H.loadFooter('overseas-stocks') + (mode === 'returns' ? '<div class="panel-foot"><span>美元 · 含分红再投资 · 未扣个人交易费与税款</span></div>' : '') + '</section>';
  }
  function detail(symbol) {
    const s = (root.OVERSEAS_STOCKS || []).find(r => r.symbol === symbol);
    if (!s) return;
    const f = s.financials, c = s.financialCurrency, revenue = H.esc(s.revenueLabel || '营收');
    const sourceLink = (url, label) => '<a href="' + H.esc(url) + '" target="_blank" rel="noopener noreferrer">' + H.esc(label) + ' ↗</a>';
    const names = Object.fromEntries(groups);
    const classification = '<div class="overseas-classification"><strong>' + s.screening.groups.map(g => names[g]).join(' · ') + '</strong>' + sub('财务核对 ' + s.screening.checkedAt + ' · 经营研究 ' + s.research.reportPeriod) + '<p>' + H.esc(s.coverageBasis) + '</p></div><details class="overseas-method"><summary>分类依据与未入选原因</summary><div class="table-wrap"><table><thead><tr><th>分类</th><th>当前条件</th></tr></thead><tbody>' + Object.entries(s.screening.reviews).map(([group, review]) => '<tr><td>' + names[group] + sub(review.qualified ? '已入选' : '未入选') + '</td><td>' + H.esc(review.checks.filter(x => !x.pass).map(x => x.reason).join('；') || (review.qualified ? '财务与本期经营证据均成立' : '已进入长期优质或高质成长，展示在对应分组')) + '</td></tr>').join('') + '</tbody></table></div></details>';
    const income = s.research.incomeReview;
    const incomeReview = income ? '<section class="overseas-income"><h3>分红承受能力</h3><p>' + H.esc(income.rationale) + '</p><p>' + H.esc(income.capitalReview) + '</p></section>' : '';
    const financialRows = Object.values(s.financialHistory.quarterly).sort((a, b) => b.period.localeCompare(a.period));
    const table = '<div class="table-wrap"><table><thead><tr><th>季度截至</th><th>' + revenue + ' / 亿' + (c === 'TWD' ? '新台币' : '美元') + '</th><th>净利润</th><th>营业利润</th><th>经营现金流</th></tr></thead><tbody>' + financialRows.map(q => '<tr><td>' + H.esc(periodLabel(q)) + '</td>' + ['TotalRevenue', 'NetIncome', 'TotalOperatingIncomeAsReported', 'OperatingCashFlow'].map(k => '<td>' + (finite(q[k]) ? H.money(q[k] / 1e8, 2) : '—') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    const annual = '<h3 class="overseas-detail-heading">年度财务 · ' + (c === 'TWD' ? '新台币' : '美元') + '</h3><div class="table-wrap"><table><thead><tr><th>财年截至</th><th>' + revenue + ' / 亿</th><th>' + revenue + '同比</th><th>净利润 / 亿</th><th>利润同比</th><th>经营现金 / 亿</th><th>ROE</th></tr></thead><tbody>' + [...s.analysis.annual].reverse().map(q => '<tr><td>' + H.esc(q.dateBasis === 'issuer_report_end' ? q.reportDate : q.period) + '</td><td>' + H.money(q.TotalRevenue / 1e8, 2) + '</td><td>' + H.pc(q.revenueGrowth, 1) + '</td><td>' + H.money(q.NetIncome / 1e8, 2) + '</td><td>' + H.pc(q.profitGrowth, 1) + '</td><td>' + (finite(q.OperatingCashFlow) ? H.money(q.OperatingCashFlow / 1e8, 2) : '—') + '</td><td>' + H.pct(q.roe, 1, false) + '</td></tr>').join('') + '</tbody></table></div>';
    H.openModal(H.modalTitle(H.esc(s.name) + ' · ' + s.symbol, H.esc(s.business)) + classification + '<p class="overseas-summary">' + H.esc(s.research.summary) + '</p><a class="stock-report-entry" href="#stock-report/' + s.symbol + '">阅读全文：业务、财务、估值与风险 ↗</a>' +
      '<div class="overseas-detail-research"><section><h3>研究要点</h3>' + s.research.thesis.map(t => '<p>' + H.esc(t) + '</p>').join('') + '</section><section><h3>风险</h3>' + s.research.risks.map(t => '<p>' + H.esc(t) + '</p>').join('') + '</section></div>' +
      incomeReview + (f.note ? '<p class="notice warn">' + H.esc(f.note) + '</p>' : '') +
      H.detailGrid([['最新财报', H.esc(periodLabel(f))], ['TTM ROE', finite(f.roeTTM) ? H.pct(f.roeTTM, 1) : H.esc(f.roeMissing)], ['本季' + revenue, amount(f.TotalRevenue, c)], ['本季净利润', amount(f.NetIncome, c)], ['营业利润率', H.pct(f.operatingMargin, 1)], ['TTM经营现金流', amount(f.ttmCash, c)], ['三年' + revenue + '复合增长', H.esc(cagr(s.analysis.revenueCagr3))], ['三年利润复合增长', H.esc(cagr(s.analysis.profitCagr3))], ['PE / TTM', pe(s)], ['预测PE', H.money(s.peForward, 2)], ['股价截至', H.esc(s.priceAsOf)], ['可用行情起点', H.esc(s.first)]]) + annual + '<h3 class="overseas-detail-heading">季度财务 · ' + (c === 'TWD' ? '新台币' : '美元') + '</h3>' + table +
      '<details class="overseas-method"><summary>数据口径与来源</summary><p>美股按当前财务和本期经营研究独立分类；蓝筹未满足当前条件时保留在其他已收录。同比比较同一公司、同一报告币种的对应季度；亏损基数显示扭亏或亏损变化，不制造增长百分比。ROE为连续四季净利润除以期初期末平均净资产。</p><p>PE使用美元上市证券的TTM每股收益与已收盘股价；TSM使用美元ADR口径。预测PE使用接口提供的分析师年度EPS预期，未与国内“本期利润年化”的动态PE混用。尚缺5年、10年逐时点历史EPS，未计算历史PE分位。不同年度的股份稀释会影响单季EPS加总与年度EPS。</p><p>财报按报表口径（美国公司为GAAP、台积电为IFRS）展示；不以Non-GAAP利润代替。标为“季”的历史日期是接口归一化月份。收益含拆分和分红再投资，未扣个人交易费用及税款；SPCX从SpaceX上市首日收盘开始，未使用IPO发行价。</p><div class="actions">' + sourceLink(s.sourceUrl, '公司原始财报') + sourceLink(s.returnSourceUrl, '股价与分红历史') + sourceLink('https://finance.yahoo.com/quote/' + s.symbol + '/financials/', '财报接口对应页面') + sourceLink('https://finance.yahoo.com/quote/' + s.symbol + '/analysis/', '盈利预期') + (s.identitySourceUrl ? sourceLink(s.identitySourceUrl, '证券身份与历史延续公告') : '') + '</div></details>');
  }
  function rules() {
    const rulesRows = [
      ['长期优质企业', '连续5年正利润与正经营现金；5年平均年度ROE≥15%，最新年度≥15%；3年利润复合与最新年度增长≥10%；最新单季利润、营业利润增长≥10%，TTM ROE≥10%；当前长期业务研究成立。'],
      ['高质成长股', '连续两个相邻单季利润及营业利润均增长≥30%，正基数；近两个完整财年利润与经营现金为正；年度及TTM ROE≥10%，TTM现金/利润≥50%；本期增长来源已复核。'],
      ['业绩爆发股', '连续两季利润和营业利润均增长≥100%，正基数；最新完整年度正利润、正现金；年度及TTM ROE≥5%，TTM和最新单季现金/利润≥50%；本期爆发来源已复核。'],
      ['红利价值', '近12月已除息现金股息率≥3%；最近5个完整年度都有现金分红；派息比率≤85%及本期现金/资本承受能力成立；REIT另用AFFO。'],
      ['其他已收录', '重要蓝筹与行业研究仍完整保留，列明当前未入选原因。']
    ];
    H.openModal(H.modalTitle('美股入选标准', '财务条件与本期经营证据') + '<div class="table-wrap"><table><thead><tr><th>分类</th><th>条件</th></tr></thead><tbody>' + rulesRows.map(([name, criteria]) => '<tr><td>' + name + '</td><td>' + criteria + '</td></tr>').join('') + '</tbody></table></div><p>最新已披露财季距核对日不超过155天，经营复核必须对应本期。营业利润、特殊项、周期与并表交叉核对；新财报不自动继承旧研究结论。金融与投资控股保留专题研究，ROE不适用时不补成正值。爆发股已满足质量或成长时展示在相应分组。</p>');
  }
  function handleAction(button) {
    const act = button.dataset.action, value = button.dataset.value;
    if (act === 'os-stock-detail') { detail(value); return; }
    if (act === 'os-stock-rules') { rules(); return; }
    if (act === 'os-stock-group') { state.group = value; state.category = 'all'; state.sort = 'default'; state.descending = true; if (value === 'dividend') state.view = 'returns'; }
    else if (act === 'os-stock-view') { state.view = value; state.sort = 'default'; state.descending = true; }
    else if (act === 'os-stock-category') state.category = value;
    else if (act === 'os-stock-sort') { state.descending = state.sort === value ? !state.descending : true; state.sort = value; }
    else return;
    H.resetList(); H.render();
  }
  function handleInput(el) { state.query = el.value; H.resetList(); }
  root.ChanghengOverseasStocks = { view, handleAction, handleInput };
})(window);
