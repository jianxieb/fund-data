(function (root) {
  'use strict';
  const M = root.ChanghengPotentialModel;
  const state = { market: 'us', status: 'all', sector: 'all', query: '', sort: 'default', descending: true, view: 'financials', company: null, detailTab: 'judgment' };
  const sortNames = { revenue: '营收', netIncome: '归母 / 普通股利润', operatingCash: '经营现金流', price: '收盘价', dilution: '股本增幅', hurdle: '十倍所需营收增速', bear: '悲观收益', base: '基准收益', bull: '乐观收益' };
  let H;
  const data = () => root.POTENTIAL_RESEARCH;
  const e = value => H.esc(value);
  const n = (value, digits = 2) => H.money(value, digits);
  const sub = text => '<span class="sub">' + e(text) + '</span>';
  const currency = c => c.currency === 'USD' ? '美元' : '元';
  const amount = (c, value) => n(value / 100) + '亿' + currency(c);
  const percent = value => H.pct(value * 100, 1, false);
  const status = c => c.status === 'priority' ? '重点跟踪' : '边界观察';
  const link = (url, label) => /^https:\/\//.test(url || '') ? '<a href="' + e(url) + '" target="_blank" rel="noopener noreferrer">' + e(label) + ' ↗</a>' : e(label);
  const sourceLinks = ids => '<span class="potential-refs">' + ids.map(id => { const s = data().sources.find(x => x.id === id); return s ? link(s.url, s.title) : '来源缺失：' + e(id); }).join(' · ') + '</span>';
  const paragraphs = items => items.map(t => '<p>' + e(t) + '</p>').join('');
  const list = items => '<ul>' + items.map(t => '<li>' + e(t) + '</li>').join('') + '</ul>';
  const allSources = c => [...new Set([c.financials.source, c.shares.source, ...(c.shares.sources || []),
    ...c.facts.flatMap(f => f.sources), ...c.guidance.flatMap(g => g.sources), ...c.fundingSources,
    ...c.marketTest.sources, ...c.alternatives.flatMap(a => a.sources), ...c.calibration.flatMap(a => a.sources),
    ...(c.financingCheck?.sources || []), ...(c.earningsAdjustment?.sources || []), ...(c.productCheck?.sources || []),
    ...(c.profitCheck?.sources || []), ...(c.cashCheck?.sources || []), ...(c.ownershipCheck?.sources || []),
    ...(c.cashAudit?.sources || []), ...(c.awardAudit?.sources || []), ...(c.dilutionAudit?.sources || []),
    ...(c.liquidityCheck?.sources || []), ...(c.medicalAudit?.sources || [])])];
  const evidenceTable = (headers, rows) => '<div class="table-wrap"><table class="potential-scenario-table"><thead><tr>' + headers.map(h => '<th>' + e(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((v, i) => i === 0 ? '<th scope="row">' + e(v) + '</th>' : '<td>' + e(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  function medicalEvidence(c) {
    const a = c.medicalAudit;
    if (!a) return '';
    const f = a.cash, debt = a.debt, h = a.history, p = a.project, k = a.commitment;
    const ttm = key => h.annual[key] + h.current[key] - h.prior[key];
    const bankDebt = debt.short[0] + debt.long[0] + debt.currentLong[0];
    const rows = [['经营现金流', f.operating], ['减：长期资产购建', -f.capex], ['两项相抵', f.operating - f.capex],
      ['收购子公司净支出', f.acquisitionNet], ['另购少数股权', f.minorityPurchases],
      ['净银行借款收现', f.borrowed - f.repaid], ['期末银行净债务', bankDebt - f.end]];
    let html = '<section><h3>并购现金与债务 · 2026上半年</h3>' + evidenceTable(['项目', '百万人民币'], rows.map(([label, v]) => [label, n(v, 3)])) + '<p>' + e(a.cashNote) + '</p>' + sourceLinks(['aibo']) + '</section>';
    html += '<details class="potential-method"><summary>查看产品毛利与历史利润</summary>' + evidenceTable(['2026H1产品', '收入 / 百万元', '毛利率'], a.products.map(r => [r.label, n(r.revenue, 3), percent(1 - r.cost / r.revenue)]));
    html += '<p>TTM收入 ' + amount(c, ttm('revenue')) + '，归母利润 ' + amount(c, ttm('netIncome')) + '，净利率 ' + percent(ttm('netIncome') / ttm('revenue')) + '。' + e(h.note) + '</p><p>' + e(a.productNote) + '</p>' + sourceLinks(['aibo', 'aibo-2025-audit']) + '</details>';
    html += '<details class="potential-method"><summary>查看被收购业务与利润承诺</summary>' + evidenceTable(['购买日至期末 / 百万元', '被购买方收入', '被购买方净利润', '原表现金流量'], a.acquisitions.map(r => [r.label, ...[r.revenue, r.netIncome, r.reportedCashFlow].map(v => n(v, 3))]));
    html += '<p>' + e(a.acquisitionNote) + '</p><p>德美H1考核实际 ' + n(k.h1Actual, 3) + '百万元，占全年 ' + n(k.targets[0]) + '百万元承诺的 ' + percent(k.h1Actual / k.targets[0]) + '。' + e(k.note) + '</p>' + sourceLinks(['aibo', 'aibo-acquisition']) + '</details>';
    html += '<section><h3>隐形眼镜产线 · 进度与投入</h3><p>预定可使用日期 ' + e(p.oldReady) + ' → ' + e(p.newReady) + '。募集资金投资额 ' + amount(c, p.fundedBudget) + '，截至7月底已投 ' + amount(c, p.spentAtJuly) + '。</p><p>' + e(p.note) + '</p>' + sourceLinks(['aibo-project-delay']) + '</section>';
    return html;
  }
  function medicalShareEvidence(c) {
    const a = c.medicalAudit?.incentives;
    if (!a) return '';
    return '<details class="potential-method"><summary>查看2021激励计划完整归属记录</summary><p>单位为实际股数。2024年发生1.8倍调整；最后34,560股已在2026年5月28日登记，旧计划剩余为零。</p>' + evidenceTable(['年度', '期初股数', '调整倍数', '归属', '作废', '剩余'], a.rollforward.map(r => [r.year, n(r.opening, 0), r.multiplier, n(r.vested, 0), n(r.canceled, 0), n(r.remaining, 0)])) + '<p>' + e(a.note) + '</p><p>登记总股本 ' + n(a.registeredAfter, 0) + ' 已含库存股 ' + n(a.treasury, 0) + '；旧计划清零不代表未来零稀释。已核验2026年69项公告，股本仍按6月底披露日期展示。</p>' + sourceLinks(['aibo-vesting-conditions', 'aibo-final-vesting', 'aibo-dividend', 'aibo-filings']) + '</details>';
  }
  function batteryCashEvidence(c) {
    if (!c.cashAudit) return '';
    const a = c.cashAudit, f = a.cash;
    const rows = [['报表经营现金流', f.operating], ['其中：退租付款', -f.leaseTerminationPaid],
      ['只移除退租后的经营现金', f.ocfExcludingTermination], ['营运项目净占用（不含租赁）', f.workingCapitalExcludingLeases],
      ['资本开支现金', -f.capexPaid], ['权证与期权行权融资', f.financing], ['期末可用现金', f.endCash]];
    return '<section><h3>现金复核 · 2026上半年</h3>' + evidenceTable(['项目', '百万美元'], rows.map(([label, v]) => [label, n(v, 3)])) + '<p>' + e(a.note) + '</p>' + sourceLinks(a.sources) + '</section>';
  }
  function liquidityEvidence(c) {
    const f = c.liquidityCheck;
    if (!f) return '';
    const summary = f.routes.flatMap(r => f.netIssuePrices.map(price => {
      const x = M.liquidityProjection(c, r, price);
      return [r.label, n(price) + '美元', n(x.totalRaised, 3), n(x.shares, 3), n(x.terminal.priceMultiple) + '×'];
    }));
    let html = '<section><h3>融资敏感性 · 逐年现金与稀释</h3><p class="potential-lead">' + e(f.headline) + '</p><p>以下均为研究假设。三条路径最终仍假定10亿美元收入、15%净利率、30倍PE；区别在中途盈利和回款。筹资为百万美元，股数为百万股。</p>' + evidenceTable(['现金路径', '净发行价', '累计需筹资', '期末股数', '股价倍数'], summary);
    html += '<details class="potential-method"><summary>查看逐年现金与融资</summary><p>金额为百万美元；从2026年6月底现金 ' + n(f.cash, 3) + ' 起算，期末最低现金假设 ' + n(f.minimumCash) + '。2026H2为半年流量，后续为全年。</p>';
    html += evidenceTable(['期间', '收入', '折旧摊销', '非现金SBC', '资本开支'], f.periods.map(p => [p.label, ...[p.revenue, p.depreciation, p.stockComp, p.capex].map(v => n(v, 3))]));
    for (const r of f.routes) {
      const x = M.liquidityProjection(c, r, 4);
      html += '<h4>' + e(r.label) + '</h4>' + evidenceTable(['期间', '净利率', '营运占用/收入', '经营现金', '项目净现金', '新增筹资', '期末现金'], x.rows.map((row, i) => [row.label, percent(r.netMargins[i]), percent(r.workingCapitalRatios[i]), ...[row.operatingCash, row.projectNet, row.raised, row.cash].map(v => n(v, 3))]));
    }
    html += '</details><details class="potential-method"><summary>查看假设依据与计算边界</summary>' + paragraphs(f.basis) + '</details><p>' + e(f.caveat) + '</p><p>权证全部失效、原价现金行权和未来激励增加的分支见下载研究；不把行权款或全部项目额度当成保证资金。</p>' + sourceLinks(f.sources) + '</section>';
    return html;
  }
  function profitEvidence(c) {
    const a = c.profitCheck;
    if (!a) return '';
    const current = M.investmentProfit(a.current), prior = M.investmentProfit(a.prior);
    const rows = [
      ['GAAP归母利润', a.current.reportedParentNet, a.prior.reportedParentNet],
      ['其中：未实现投资收益归母调整额', current.parentGain, prior.parentGain],
      ['扣除上述收益，保留股权薪酬', current.withoutGain, prior.withoutGain],
      ['公司non-GAAP归母（另加回股权薪酬）', a.current.issuerNonGaap, a.prior.issuerNonGaap]
    ];
    return '<section><h3>归母利润复核</h3><div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>百万' + currency(c) + '</th><th>' + e(a.current.label) + '</th><th>' + e(a.prior.label) + '</th></tr></thead><tbody>' + rows.map(([label, x, y]) => '<tr><th scope="row">' + e(label) + '</th><td>' + n(x, 3) + '</td><td>' + n(y, 3) + '</td></tr>').join('') + '</tbody></table></div><p>扣除上述收益后同比 ' + percent(current.withoutGain / prior.withoutGain - 1) + '，利润率 ' + percent(current.margin) + '；集团营业利润率 ' + percent(a.current.operatingIncome / a.current.revenue) + '。</p><p>' + e(a.caveat) + '</p>' + sourceLinks(a.sources) + '</section>';
  }
  function cashEvidence(c) {
    const f = c.cashCheck;
    if (!f) return '';
    const rows = [['经营现金流', f.operatingCash], ['购建固定资产支出', -f.capex],
      ['经营现金减固定资产支出', f.operatingCash - f.capex], ['公司定义FCF（再扣长期投资）', f.issuerFcf],
      ['母公司发行净筹资', f.parentEquityProceeds], ['出售子公司股权税前收入', f.subsidiarySaleGross],
      ['银行净借款', f.shortBorrowed - f.shortRepaid + f.longBorrowed - f.longRepaid], ['集团期权行权收入', f.optionProceeds]];
    return '<section><h3>现金来源与去向 · 2026上半年</h3><div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>项目</th><th>百万' + currency(c) + '</th></tr></thead><tbody>' + rows.map(([label, value]) => '<tr><th scope="row">' + e(label) + '</th><td>' + n(value, 3) + '</td></tr>').join('') + '</tbody></table></div><p>' + e(f.caveat) + '</p>' + sourceLinks(f.sources) + '</section>';
  }
  function marketBuild(c) {
    const m = c.marketTest;
    if (m.kind === 'segment_growth') return '<div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>产品线</th><th>2026H1</th><th>H1简单年化</th><th>2031收入假设</th><th>隐含五年增速</th></tr></thead><tbody>' + m.parts.map(p => '<tr><th scope="row">' + e(p.label) + '</th><td>' + amount(c, p.reportedRevenue) + '</td><td>' + amount(c, p.baseRevenue) + '</td><td>' + amount(c, p.revenue) + '</td><td>' + percent((p.revenue / p.baseRevenue) ** (1 / data().horizonYears) - 1) + '</td></tr>').join('') + '</tbody></table></div>';
    return '<div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>2031收入假设</th><th>数量</th><th>单位净收入</th><th>收入</th></tr></thead><tbody>' + m.parts.map(p => '<tr><th scope="row">' + e(p.label) + '</th><td>' + n(p.units, 0) + e(p.unitLabel) + '</td><td>' + n(p.price, 0) + currency(c) + '</td><td>' + amount(c, p.revenue) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function parameterEvidence(c) {
    let html = '<section><h3>参数根据与未验证条件</h3>' + c.calibration.map(a => '<p><strong>' + e(a.label) + '：</strong>' + e(a.basis) + sourceLinks(a.sources) + '</p>').join('') + '</section>';
    const old = c.priorBull;
    if (old) html += '<details class="potential-method"><summary>查看已撤回的旧乐观假设</summary><p>旧版收入 ' + amount(c, old.revenue) + '、净利率 ' + percent(old.margin) + '、' + old.pe + '倍PE、' + n(old.shares) + '百万股，计算为 ' + n(M.project(c, old).priceMultiple) + '倍。需求与利润条件不足，已撤回这组经营判断。</p></details>';
    if (c.ownershipCheck) {
      const o = c.ownershipCheck;
      html += '<section><h3>子公司融资稀释 · 独立于美股股数</h3><p>起点持股 ' + percent(o.ownership) + '；若新股占发行后 ' + percent(o.proposedFraction) + '，持股约 ' + percent(M.subsidiaryOwnership(o.ownership, o.proposedFraction)) + '；再按初始新股数超额配售 ' + percent(o.overAllotment) + '，约为 ' + percent(M.subsidiaryOwnership(o.ownership, o.proposedFraction, o.overAllotment)) + '。</p><p>' + e(o.caveat) + '</p>' + sourceLinks(o.sources) + '</section>';
    }
    if (c.liquidityCheck) return html + liquidityEvidence(c);
    if (!c.financingCheck) return html;
    const f = c.financingCheck, bull = M.scenario(c, 'bull');
    html += '<section><h3>融资敏感性 · 营运资金压力</h3><p>当前应收加库存减应付为 ' + amount(c, f.receivables + f.inventory - f.payables) + '；现金截至 ' + e(f.asOf) + ' 为 ' + amount(c, f.cash) + '。从乐观股数中先扣除已发行、既有潜在股份及未来激励 ' + n(f.reservedFutureAwards) + '百万股，剩余股份按下列净发行价测算。</p><div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>营运资金/收入</th><th>净发行价</th><th>假设筹资</th><th>额外营运资金</th><th>其他现金流前余额</th></tr></thead><tbody>';
    for (const ratio of f.ratios) for (const price of f.netIssuePrices) {
      const x = M.fundingStress(c, bull, ratio, price);
      html += '<tr><th>' + percent(ratio) + '</th><td>' + n(price) + currency(c) + '</td><td>' + amount(c, x.proceeds) + '</td><td>' + amount(c, x.additionalWorkingCapital) + '</td><td>' + amount(c, x.balanceBeforeOtherFlows) + '</td></tr>';
    }
    return html + '</tbody></table></div><p>' + e(f.caveat) + '</p><p>负值意味着需要更多现金来源；正值也不代表资本开支等支出已有保障。</p>' + sourceLinks(f.sources) + '</section>';
  }
  function th(label, key) {
    return '<th' + (key ? ' aria-sort="' + (state.sort === key ? state.descending ? 'descending' : 'ascending' : 'none') + '"' : '') + '>' + (key ? H.action(e(label) + (state.sort === key ? state.descending ? ' ↓' : ' ↑' : ''), 'potential-sort', '', 'data-value="' + key + '"') : e(label)) + '</th>';
  }
  function identity(c) {
    return '<td class="stock-identity potential-identity"><span class="potential-status ' + c.status + '">' + status(c) + '</span>' + sub(c.evidenceLabel) + '<span class="stock-name">' + H.action(e(c.name), 'potential-detail', 'text-link', 'data-value="' + e(c.id) + '" aria-label="查看' + e(c.name) + '研究"') + '</span>' + sub(c.id + ' · ' + c.sector) + '<span class="potential-tagline">' + e(c.tagline) + '</span></td>';
  }
  function scenarioRange(c) {
    const points = c.scenarios.map(s => ({ label: s.label, id: s.id, value: M.project(c, s).priceMultiple }));
    const x = v => 18 + Math.max(0, Math.min(12, v)) / 12 * 244;
    return '<svg class="potential-range" viewBox="0 0 280 72" role="img" aria-label="' + e(points.map(p => p.label + ' ' + n(p.value) + '倍').join('，') + '；虚线为十倍') + '"><line x1="18" x2="262" y1="32" y2="32" class="range-axis"/><line x1="' + x(10) + '" x2="' + x(10) + '" y1="12" y2="43" class="range-hurdle"/>' + points.map(p => '<circle cx="' + x(p.value) + '" cy="32" r="5" class="range-' + p.id + '"/>').join('') + '<text x="18" y="60">0×</text><text x="' + x(10) + '" y="60" text-anchor="middle">10×</text><text x="262" y="60" text-anchor="end">12×</text></svg>';
  }
  function returnCell(c, id) {
    const s = M.scenario(c, id), p = M.project(c, s);
    return '<td class="potential-return"><strong>' + H.pc(M.returnPercent(p.priceMultiple, H.annual, data().horizonYears), 1) + '</strong>' + sub('股价 ' + n(p.priceMultiple) + '× · ' + n(p.price) + currency(c)) + '<span class="potential-total">含现金分红 ' + H.pct(M.returnPercent(p.totalMultiple, H.annual, data().horizonYears), 1) + '</span></td>';
  }
  function view(helpers) {
    H = helpers;
    if (H.market && state.market !== H.market) { state.market = H.market; state.sector = 'all'; state.sort = 'default'; state.descending = true; }
    const d = data(), pool = d.companies.filter(c => c.market === state.market), rows = M.select(d.companies, state);
    const sectors = [...new Set(pool.map(c => c.sector))];
    const filters = '<div class="potential-filter-row"><div class="segmented" aria-label="研究优先级">' + [['all', '全部候选'], ['priority', '重点跟踪'], ['watch', '边界观察']].map(([id, label]) => H.action(label, 'potential-status', state.status === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.status === id) + '"')).join('') + '</div><input type="search" id="potential-search" aria-label="搜索潜力公司、代码或业务" placeholder="搜索公司、代码或业务" value="' + e(state.query) + '"></div>' + '<div class="stock-category-filter" role="group" aria-label="潜力公司行业">' + [['all', '全部行业'], ...sectors.map(s => [s, s])].map(([id, label]) => H.action(e(label), 'potential-sector', 'filter-chip' + (state.sector === id ? ' active' : ''), 'data-value="' + e(id) + '" aria-pressed="' + (state.sector === id) + '"')).join('') + '</div>';
    const views = '<div class="segmented stock-view" aria-label="潜力研究视图">' + [['financials', '判断与财务'], ['valuation', '十倍反算'], ['returns', '五年收益']].map(([id, label]) => H.action(label, 'potential-view', state.view === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.view === id) + '"')).join('') + '</div>';
    let headers, cells, count;
    if (state.view === 'financials') {
      count = 6;
      headers = th('营收 / 2026上半年', 'revenue') + th('归母 / 普通股利润', 'netIncome') + th('经营现金流', 'operatingCash') + th('判断') + th('下个验证点');
      cells = c => '<td>' + amount(c, c.financials.revenue) + sub(c.financials.label) + '</td><td>' + amount(c, c.financials.netIncome) + sub(c.profitCheck ? '含未实现投资收益' : '报表口径') + '</td><td>' + amount(c, c.financials.operatingCash) + sub('2026上半年') + '</td><td class="potential-prose">' + e(c.decision) + '</td><td class="potential-prose"><strong>' + e(c.milestones[0].when) + '</strong>' + sub(c.milestones[0].test) + '</td>';
    } else if (state.view === 'valuation') {
      count = 7;
      headers = th('起始收盘价', 'price') + th('期末股数 / 乐观', 'dilution') + th('十倍目标价') + th('十倍所需营收', 'hurdle') + th('终点估值假设') + th('十倍所需股权价值');
      cells = c => { const s = M.scenario(c, 'bull'), p = M.project(c, s), h = M.hurdle(c, s); return '<td>' + n(c.price.value) + currency(c) + sub(c.price.asOf) + '</td><td>' + n(s.shares, 1) + '百万股' + sub('较已发行增加 ' + percent(p.dilution)) + '</td><td>' + n(h.price) + currency(c) + sub('不含分红') + '</td><td>' + amount(c, h.revenue) + sub('五年营收CAGR ' + percent(h.revenueCagr)) + '</td><td>归母净利率 ' + percent(s.margin) + sub(s.pe + '倍PE · 研究假设') + '</td><td>' + amount(c, h.equity) + sub('较起始股本折算值 ' + n(h.capitalMultiple) + '×') + '</td>'; };
    } else {
      count = 5;
      headers = th('悲观 / ' + (H.annual ? '年化' : '累计'), 'bear') + th('基准 / ' + (H.annual ? '年化' : '累计'), 'base') + th('乐观 / ' + (H.annual ? '年化' : '累计'), 'bull') + th('股价终值倍数');
      cells = c => ['bear', 'base', 'bull'].map(id => returnCell(c, id)).join('') + '<td class="potential-range-cell">' + scenarioRange(c) + '</td>';
    }
    const foot = state.view === 'financials' ? '财务截至2026-06-30；财报中的事实与研究假设在公司详情中分开。' : state.view === 'valuation' ? '股本与报价各自记录日期；增长锚点为2026全年指引或研究假设，详见公司情景。' : '2026-10-16 → 2031-10-16 · 股票价格收益；分红按税前现金持有、不再投资。未扣税费及汇兑。';
    return '<div class="potential-page"><div class="potential-warning"><strong>十倍尚未获证据支持</strong><span>经营情景与十倍门槛分开看；具体缺项见各公司判断。</span></div>' + filters + '<section class="card"><div class="table-caption stock-table-caption"><span><b>' + rows.length + '</b> / ' + pool.length + ' 家候选 · 研究 ' + e(d.reviewedAt) + ' · 修订' + d.revision + '</span>' + views + (state.sort !== 'default' ? '<span class="stock-sort-status">按' + e(sortNames[state.sort]) + (state.descending ? '降序' : '升序') + H.action('恢复默认', 'potential-sort-reset', 'text-link small') + '</span>' : '') + '</div>' + (state.view === 'returns' ? '<div class="potential-return-controls"><span>未来五年 · 情景假设</span>' + H.annualControl() + '</div>' : '') + '<div class="table-wrap stock-table-wrap potential-table-wrap" tabindex="0" role="region" aria-label="潜力研究表，可横向滚动"><table class="research-table stock-table potential-table potential-' + state.view + '-table"><thead><tr><th>公司 / 主营业务</th>' + headers + '</tr></thead><tbody>' + rows.map(c => '<tr data-stock-row="' + e(c.id) + '">' + identity(c) + cells(c) + '</tr>').join('') + (!rows.length ? '<tr><td colspan="' + count + '"><div class="empty">当前条件没有匹配公司。' + H.action('清除筛选', 'potential-reset', 'text-link') + '</div></td></tr>' : '') + '</tbody></table></div><div class="panel-foot">' + e(foot) + '</div></section></div>';
  }
  function judgment(c) {
    return '<section><h3>研究判断</h3><p class="potential-lead">' + e(c.decision) + '</p>' + paragraphs(c.thesis) + '</section><div class="potential-detail-columns"><section><h3>已验证事实</h3>' + c.facts.map(f => '<p>' + e(f.text) + sourceLinks(f.sources) + '</p>').join('') + '</section><section><h3>管理层指引</h3>' + (c.guidance.length ? c.guidance.map(g => '<p>' + e(g.text) + sourceLinks(g.sources) + '</p>').join('') : '<p>未将未核实的全年经营目标设为公司指引。</p>') + '<h3>单位经济与竞争</h3><p>' + e(c.economics) + '</p></section></div>' + profitEvidence(c) + cashEvidence(c) + batteryCashEvidence(c) + medicalEvidence(c) + '<section><h3>管理层与资本配置</h3><p>' + e(c.management) + '</p><h3>融资与现金承受能力</h3><p>' + e(c.funding) + sourceLinks(c.fundingSources) + '</p></section><section><h3>为什么没有优先选常见替代</h3>' + c.alternatives.map(a => '<p><strong>' + e(a.name) + '</strong> — ' + e(a.reason) + sourceLinks(a.sources) + '</p>').join('') + '</section>';
  }
  function scenarios(c) {
    const bull = M.scenario(c, 'bull'), h = M.hurdle(c, bull), f = c.financials;
    const parameters = [['2031营收', s => amount(c, s.revenue)], ['归母净利率', s => percent(s.margin)], ['归母利润', s => amount(c, M.project(c, s).profit)], ['期末股数', s => n(s.shares, 1) + '百万股'], ['期末PE', s => s.pe === null ? '亏损残值法' : s.pe + '倍'], ['股权价值', s => amount(c, M.project(c, s).equity)], ['每股价格', s => n(M.project(c, s).price) + currency(c)], ['五年每股现金分红', s => n(s.dividends) + currency(c)], ['股价倍数', s => n(M.project(c, s).priceMultiple) + '×'], ['含现金分红财富倍数', s => n(M.project(c, s).totalMultiple) + '×']];
    const stress = [['乐观原假设', bull], ['终值PE降低25%', { ...bull, pe: bull.pe * .75 }], ['期末股份再增20%', { ...bull, shares: bull.shares * 1.2 }], ['两项同时发生', { ...bull, pe: bull.pe * .75, shares: bull.shares * 1.2 }]];
    return '<section><h3>2031年情景 · 全部为研究假设</h3><p>收入增长锚点：' + e(f.anchorLabel) + '，' + amount(c, f.anchorRevenue) + '。价格起点为 ' + e(c.price.asOf) + ' 收盘 ' + n(c.price.value) + currency(c) + '；五年期固定至 ' + e(data().horizonDate) + '。</p><div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>指标</th>' + c.scenarios.map(s => '<th>' + e(s.label) + '</th>').join('') + '</tr></thead><tbody>' + parameters.map(([label, get]) => '<tr><th scope="row">' + label + '</th>' + c.scenarios.map(s => '<td>' + get(s) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + c.scenarios.map(s => '<p><strong>' + e(s.label) + '：</strong>' + e(s.story) + '</p>').join('') + '</section><section><h3>十倍反算 · 先看每股，再看总额</h3><p class="potential-lead">每股 ' + n(h.price) + currency(c) + ' → 股权价值 ' + amount(c, h.equity) + ' → 归母利润 ' + amount(c, h.profit) + ' → 收入 ' + amount(c, h.revenue) + '。</p><p>按 ' + n(bull.shares, 1) + '百万期末股份、' + bull.pe + '倍PE和' + percent(bull.margin) + '归母净利率；所需收入五年复合增速 ' + percent(h.revenueCagr) + '。股权总值需扩大 ' + n(h.capitalMultiple) + '倍，才能让单股价格达到十倍。</p><div class="potential-stress">' + stress.map(([label, s]) => '<div><span>' + label + '</span><strong>' + n(M.project(c, s).priceMultiple) + '×</strong></div>').join('') + '</div></section><section><h3>股本与稀释</h3><p>已发行 ' + n(c.shares.value, 6) + '百万股，截至 ' + e(c.shares.asOf) + '。' + e(c.shares.potentialBasis) + '</p><p>' + e(c.shares.futureBasis) + '</p><p>' + e(c.shares.convertibles) + '</p><p class="potential-gap"><strong>缺项：</strong>' + e(c.shares.gap) + '</p>' + sourceLinks(c.shares.sources || [c.shares.source]) + medicalShareEvidence(c) + '</section><section><h3>市场容量与单位经济反查</h3><p>' + e(c.marketTest.headline) + '</p>' + marketBuild(c) + paragraphs([c.marketTest.assumptions, c.marketTest.boundary]) + '<p class="potential-gap"><strong>缺项：</strong>' + e(c.marketTest.gap) + '</p>' + sourceLinks(c.marketTest.sources) + '</section><details class="potential-method"><summary>计算口径</summary>' + paragraphs([data().method.formula, data().method.returnBasis, data().method.valuation, data().method.annualization]) + '</details>' + parameterEvidence(c);
  }
  function evidence(c) {
    const ids = allSources(c);
    return '<section><h3>验证里程碑 · 阈值为研究假设</h3><ol class="potential-milestones">' + c.milestones.map(m => '<li><strong>' + e(m.when) + '</strong><p>' + e(m.test) + '</p></li>').join('') + '</ol></section><div class="potential-detail-columns"><section><h3>撤回或下修信号</h3>' + list(c.withdraw) + '</section><section><h3>尚缺的具体证据</h3>' + list(c.gaps) + '</section></div><section><h3>价格与财报口径</h3><p>' + link(c.price.url, 'Yahoo Finance：' + c.price.symbol) + ' · ' + e(c.price.asOf) + ' 常规交易未复权收盘 ' + n(c.price.value) + currency(c) + '。</p><p>' + e(c.financials.netIncomeBasis) + '；' + e(c.financials.debtBasis) + '。</p><p>' + e(data().method.refresh) + '</p></section><section><h3>原始来源与定位</h3><ul class="potential-sources">' + [...ids].map(id => { const s = data().sources.find(x => x.id === id); return '<li>' + link(s.url, s.title) + '<span>公布 ' + e(s.publishedAt) + ' · 报告期 ' + e(s.period) + '</span><span>' + e(s.locator) + '</span></li>'; }).join('') + '</ul></section>';
  }
  function detail(id, tab = 'judgment') {
    const c = data().companies.find(x => x.id === id);
    if (!c) return;
    state.company = id; state.detailTab = tab;
    const tabs = '<div class="segmented potential-detail-tabs" aria-label="公司研究内容">' + [['judgment', '经营判断'], ['scenarios', '情景与反算'], ['evidence', '验证与来源']].map(([key, label]) => H.action(label, 'potential-detail-tab', tab === key ? 'active' : '', 'data-value="' + key + '" aria-pressed="' + (tab === key) + '"')).join('') + '</div>';
    H.openModal('<div class="potential-detail">' + H.modalTitle(e(c.name) + ' · ' + e(c.id), e(c.tagline)) + '<span class="potential-status ' + c.status + '">' + status(c) + '</span>' + tabs + ({ judgment, scenarios, evidence }[tab] || judgment)(c) + '</div>');
  }
  function method() {
    H.openModal('<div class="potential-detail">' + H.modalTitle('潜力研究口径', '研究版本 ' + e(data().reviewedAt)) + paragraphs(Object.values(data().method)) + '<p><a href="docs/research/potential-stocks-2026-10-18.md" download>下载完整研究</a> · <a href="data/potential-stocks.json" download>研究数据 JSON</a> · <a href="data/potential-quotes.json" download>报价记录 JSON</a></p></div>');
  }
  function handleAction(button) {
    const act = button.dataset.action, value = button.dataset.value;
    if (act === 'potential-detail') { detail(value); return; }
    if (act === 'potential-detail-tab') {
      detail(state.company, value);
      root.document?.querySelector('.potential-detail-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }
    if (act === 'potential-method') { method(); return; }
    if (act === 'potential-view') { state.view = value; (H.renderStockView || H.render)(); return; }
    if (act === 'potential-status') state.status = value;
    else if (act === 'potential-sector') state.sector = value;
    else if (act === 'potential-sort') Object.assign(state, M.cycleSort(state.sort, state.descending, value));
    else if (act === 'potential-sort-reset') { state.sort = 'default'; state.descending = true; }
    else if (act === 'potential-reset') { state.status = 'all'; state.sector = 'all'; state.query = ''; state.sort = 'default'; state.descending = true; }
    else return;
    H.render();
  }
  function handleInput(input) { state.query = input.value; }
  root.ChanghengPotential = { view, handleAction, handleInput };
})(window);
