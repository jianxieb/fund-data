(function (root) {
  'use strict';
  const M = root.Changheng;
  const groups = [['quality', '长期优质企业'], ['growth', '盈利成长企业'], ['breakout', '业绩爆发股'], ['dividend', '红利价值'], ['other', '未入选公司']];
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
    if (s.companySelection && state.group !== 'dividend') return paragraphs([s.companySelection.rationale]) + H.action('查看财报依据', 'os-stock-detail', 'text-link small', 'data-value="' + H.esc(s.symbol) + '"');
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
      cells = s => '<td>' + H.money(s.price, 2) + '</td><td>' + pe(s) + '</td><td>' + estimatedPe(s, 'peDynamic') + sub(periodLabel(s.financials) + '单季 × 4') + '</td><td>' + estimatedPe(s, 'peStatic') + sub(s.staticPeriod + '财年') + '</td><td>' + H.money(s.peForward, 2) + sub('预测期间未提供') + '</td><td>' + H.money(s.epsTTM, 2) + sub('TTM') + '<span class="stock-annual">预测 ' + H.money(s.epsForward, 2) + '</span></td><td>' + H.esc(s.priceAsOf) + sub('预期采集 ' + s.estimateAsOf) + '</td>';
    } else {
      headers = th('近12月股息率', 'yield12') + th('5年分红年数') + th('派息比率') + H.periods.map(y => th(H.periodHead(y), 'return:' + y)).join('') + th('上市以来累计', 'sinceListing') + th('近5年内最大回撤', 'mdd5') + th('近5年内波动率', 'vol5') + th('收益截至');
      cells = s => '<td>' + H.pct(s.yield12, 2, false) + sub(finite(s.cashDividend12) ? '每份 ' + H.money(s.cashDividend12, 3) + '美元' : s.dividendMissing) + '</td><td>' + s.screening.dividendYears5 + ' / 5</td><td>' + H.pct(finite(s.screening.payoutRatio) ? s.screening.payoutRatio * 100 : null, 1, false) + sub(s.accountingModel === 'reits' ? '本季现金股息 / AFFO' : '近12月现金股息 / TTM EPS') + '</td>' + H.periods.map(y => '<td>' + H.pc(H.ret(s.r[[1, 2, 3, 5, 10].indexOf(y)], y, s)) + (s.r[[1, 2, 3, 5, 10].indexOf(y)] == null ? sub('历史不足' + y + '年') : '') + '</td>').join('') + '<td>' + H.pc(s.sinceListing) + sub(s.first + '起') + '</td><td>' + H.pc(s.mdd5, 1) + (s.risk5.partial ? sub('上市以来') : '') + '</td><td>' + H.pct(s.vol5, 1, false) + (s.risk5.partial ? sub('上市以来') : '') + '</td><td>' + H.esc(s.returnAsOf) + '</td>';
    }
    return tabs + filters + controls + '<section class="card"><div class="table-caption stock-table-caption"><span><b>' + data.length + '</b> / ' + pool.length + '家公司</span>' + (['quality', 'growth'].includes(state.group) ? '<span class="stock-overlap-legend">绿色公司：质量与成长同时入选</span>' : '') + views + (state.sort === 'default' ? '' : '<span class="stock-sort-status">按' + M.stockSortLabel(state.sort) + (state.descending ? '降序' : '升序') + H.action('恢复默认', 'os-stock-sort-reset', 'text-link small') + '</span>') + '</div><div class="table-wrap stock-table-wrap" tabindex="0" role="region" aria-label="美股研究表，可横向滚动"><table class="research-table stock-table overseas-stock-table ' + (mode === 'financials' ? 'overseas-financial-table' : '') + '"><thead><tr><th>公司 / 主营业务</th>' + headers + '</tr></thead><tbody data-list-body="overseas-stocks">' + H.lazyRows('overseas-stocks', data, s => '<tr data-stock-row="' + s.symbol + '">' + identity(s) + cells(s) + '</tr>') + (!data.length ? '<tr><td colspan="14"><div class="empty">当前分组没有匹配的美股公司</div></td></tr>' : '') + '</tbody></table></div>' + H.loadFooter('overseas-stocks') + (mode === 'returns' ? '<div class="panel-foot"><span>美元 · 含分红再投资 · 未扣个人交易费与税款</span></div>' : '') + '</section>';
  }
  function detail(symbol) {
    const s = (root.OVERSEAS_STOCKS || []).find(r => r.symbol === symbol);
    if (!s) return;
    const f = s.financials, c = s.financialCurrency, revenue = H.esc(s.revenueLabel || '营收');
    const sourceLink = (url, label) => '<a href="' + H.esc(url) + '" target="_blank" rel="noopener noreferrer">' + H.esc(label) + ' ↗</a>';
    const names = Object.fromEntries(groups);
    const classification = '<div class="overseas-classification"><strong>' + s.screening.groups.map(g => names[g]).join(' · ') + '</strong>' + sub('财务核对 ' + s.screening.checkedAt + ' · 经营研究 ' + s.research.reportPeriod) + '<p>' + H.esc(s.companySelection?.rationale || s.coverageBasis) + '</p>' + (s.companySelection ? '<p><strong>重新评估的信号：</strong>' + H.esc(s.companySelection.invalidation) + '</p>' : '') + '</div><details class="overseas-method"><summary>分类依据与未入选原因</summary><div class="table-wrap"><table><thead><tr><th>分类</th><th>当前条件</th></tr></thead><tbody>' + Object.entries(s.screening.reviews).map(([group, review]) => '<tr><td>' + names[group] + sub(review.qualified ? '已入选' : '未入选') + '</td><td>' + H.esc(review.checks.filter(x => !x.pass).map(x => x.reason).join('；') || (review.qualified ? '财务与本期经营证据均成立' : '已进入长期优质或高质成长，展示在对应分组')) + '</td></tr>').join('') + '</tbody></table></div></details>';
    const income = s.research.incomeReview;
    const incomeReview = income ? '<section class="overseas-income"><h3>分红承受能力</h3><p>' + H.esc(income.rationale) + '</p><p>' + H.esc(income.capitalReview) + '</p></section>' : '';
    const financialRows = Object.values(s.financialHistory.quarterly).sort((a, b) => b.period.localeCompare(a.period));
    const table = '<div class="table-wrap"><table><thead><tr><th>季度截至</th><th>' + revenue + ' / 亿' + (c === 'TWD' ? '新台币' : '美元') + '</th><th>净利润</th><th>营业利润</th><th>经营现金流</th></tr></thead><tbody>' + financialRows.map(q => '<tr><td>' + H.esc(periodLabel(q)) + '</td>' + ['TotalRevenue', 'NetIncome', 'TotalOperatingIncomeAsReported', 'OperatingCashFlow'].map(k => '<td>' + (finite(q[k]) ? H.money(q[k] / 1e8, 2) : '—') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    const annual = '<h3 class="overseas-detail-heading">年度财务 · ' + (c === 'TWD' ? '新台币' : '美元') + '</h3><div class="table-wrap"><table><thead><tr><th>财年截至</th><th>' + revenue + ' / 亿</th><th>' + revenue + '同比</th><th>净利润 / 亿</th><th>利润同比</th><th>经营现金 / 亿</th><th>ROE</th></tr></thead><tbody>' + [...s.analysis.annual].reverse().map(q => '<tr><td>' + H.esc(q.dateBasis === 'issuer_report_end' ? q.reportDate : q.period) + '</td><td>' + H.money(q.TotalRevenue / 1e8, 2) + '</td><td>' + H.pc(q.revenueGrowth, 1) + '</td><td>' + H.money(q.NetIncome / 1e8, 2) + '</td><td>' + H.pc(q.profitGrowth, 1) + '</td><td>' + (finite(q.OperatingCashFlow) ? H.money(q.OperatingCashFlow / 1e8, 2) : '—') + '</td><td>' + H.pct(q.roe, 1, false) + '</td></tr>').join('') + '</tbody></table></div>';
    H.openModal(H.modalTitle(H.esc(s.name) + ' · ' + s.symbol, H.esc(s.business)) + classification + '<p class="overseas-summary">' + H.esc(s.research.summary) + '</p><a class="stock-report-entry" href="#stock-report/' + s.symbol + '">阅读全文：业务、财务、估值与风险 ↗</a>' +
      '<div class="overseas-detail-research"><section><h3>研究要点</h3>' + s.research.thesis.map(t => '<p>' + H.esc(t) + '</p>').join('') + '</section><section><h3>风险</h3>' + s.research.risks.map(t => '<p>' + H.esc(t) + '</p>').join('') + '</section></div>' +
      incomeReview + (f.note ? '<p class="notice warn">' + H.esc(f.note) + '</p>' : '') +
      H.detailGrid([['最新财报', H.esc(periodLabel(f))], ['TTM ROE', finite(f.roeTTM) ? H.pct(f.roeTTM, 1) : H.esc(f.roeMissing)], ['本季' + revenue, amount(f.TotalRevenue, c)], ['本季净利润', amount(f.NetIncome, c)], ['营业利润率', H.pct(f.operatingMargin, 1)], ['TTM经营现金流', amount(f.ttmCash, c)], ['三年' + revenue + '复合增长', H.esc(cagr(s.analysis.revenueCagr3))], ['三年利润复合增长', H.esc(cagr(s.analysis.profitCagr3))], ['PE / TTM', pe(s)], ['预测PE', H.money(s.peForward, 2) + sub('预测期间未提供')], ['股价截至', H.esc(s.priceAsOf)], ['可用行情起点', H.esc(s.first)]]) + annual + '<h3 class="overseas-detail-heading">季度财务 · ' + (c === 'TWD' ? '新台币' : '美元') + '</h3>' + table +
      '<details class="overseas-method"><summary>数据口径与来源</summary><p>美股按当前财务和本期经营研究独立分类；蓝筹未满足当前条件时保留在其他已收录。同比比较同一公司、同一报告币种的对应季度；亏损基数显示扭亏或亏损变化，不制造增长百分比。ROE为连续四季净利润除以期初期末平均净资产。</p><p>PE使用美元上市证券的TTM每股收益与已收盘股价；TSM使用美元ADR口径。预测PE使用供应商的forward EPS；接口未提供目标财年或未来12个月、参与分析师数量及盈利调整口径，不能把它与TTM的差值直接理解为预期利润增幅。季度年化PE是最新单季EPS乘4，与预测PE不同。尚缺5年、10年逐时点历史EPS，未计算历史PE分位。不同年度的股份稀释会影响单季EPS加总与年度EPS。</p><p>财报按报表口径（美国公司为GAAP、台积电为IFRS）展示；不以Non-GAAP利润代替。标为“季”的历史日期是接口归一化月份。收益含拆分和分红再投资，未扣个人交易费用及税款；SPCX从SpaceX上市首日收盘开始，未使用IPO发行价。</p><div class="actions">' + sourceLink(s.sourceUrl, '公司原始财报') + sourceLink(s.returnSourceUrl, '股价与分红历史') + sourceLink('https://finance.yahoo.com/quote/' + s.symbol + '/financials/', '财报接口对应页面') + sourceLink('https://finance.yahoo.com/quote/' + s.symbol + '/analysis/', '盈利预期') + (s.identitySourceUrl ? sourceLink(s.identitySourceUrl, '证券身份与历史延续公告') : '') + '</div></details><div class="dialog-footer"><a class="btn primary" href="#holding-period/' + H.esc(s.symbol) + '">研究不同买入月份</a></div>');
  }
  function rules() {
    const rows = [
      ['长期优质企业', '逐家公司确认竞争优势、重复需求和再投资路径；至少五个完整财年的正利润、正经营现金，以及本期业务证据。ROE、现金转换与估值用于分析，不机械等同于公司好坏。'],
      ['盈利成长企业', '确认已实现的主营扩张及持续性，最新核心盈利仍增长、TTM利润与经营现金为正；投资估值、税务、并购及低基数单独解释。'],
      ['业绩爆发股', '已实现的核心盈利快速释放，且已有具体业务证据；明确周期、短盈利记录及失效条件。'],
      ['红利价值', '按现金分红记录、收益率和派息承受力独立评审；金融及REIT采用适用的资本或AFFO口径。'],
      ['未入选公司', '当前不在精选名单中，保留原始财务、收益和具体未入选原因，可继续查阅与比较。']
    ];
    H.openModal(H.modalTitle('美股入选依据', '公司研究结论与原始财报') + '<div class="table-wrap"><table><thead><tr><th>分组</th><th>依据</th></tr></thead><tbody>' + rows.map(([n,t]) => '<tr><td>'+n+'</td><td>'+t+'</td></tr>').join('') + '</tbody></table></div><p>新财报不自动继承旧结论。只靠财务数字过线不能入选，入选也不代表估值便宜。</p>');
  }
  function handleAction(button) {
    const act = button.dataset.action, value = button.dataset.value;
    if (act === 'os-stock-detail') { detail(value); return; }
    if (act === 'os-stock-rules') { rules(); return; }
    if (act === 'os-stock-group') { state.group = value; state.category = 'all'; state.sort = 'default'; state.descending = true; if (value === 'dividend') state.view = 'returns'; }
    else if (act === 'os-stock-view') { state.view = value; (H.renderStockView || H.render)(); return; }
    else if (act === 'os-stock-sort-reset') state.sort = 'default';
    else if (act === 'os-stock-category') state.category = value;
    else if (act === 'os-stock-sort') { state.descending = state.sort === value ? !state.descending : true; state.sort = value; }
    else return;
    H.resetList(); H.render();
  }
  function handleInput(el) { state.query = el.value; H.resetList(); }
  root.ChanghengOverseasStocks = { view, handleAction, handleInput };
})(window);
