(function (root) {
  'use strict';
  const M = root.ChanghengPotentialModel;
  const state = { market: 'us', status: 'all', sector: 'all', query: '', sort: 'default', descending: true, view: 'financials', company: null, detailTab: 'judgment', legacy: false, historyDepth: 0 };
  const sortNames = { revenue: '营收', netIncome: '归母 / 普通股利润', operatingCash: '经营现金流', price: '收盘价', dilution: '股本增幅', hurdle: '十倍所需营收增速', bear: '悲观收益', base: '基准收益', bull: '乐观收益' };
  let H;
  const data = () => root.POTENTIAL_RESEARCH;
  const screening = () => { let d = root.POTENTIAL_SCREENING; for (let i = 0; i < state.historyDepth && d?.previous; i++) d = d.previous; return d; };
  const companies = () => screening() && !state.legacy ? screening().companies : data().companies;
  const reportPath = () => screening() && !state.legacy ? screening().reportPath : 'docs/research/potential-stocks-2026-10-18.md';
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
    ...(c.liquidityCheck?.sources || []), ...(c.medicalAudit?.sources || []), ...(c.diagnosticAudit?.sources || []), ...(c.sensingAudit?.sources || []), ...(c.dataServiceAudit?.sources || [])])];
  const evidenceTable = (headers, rows, rowSources) => '<div class="table-wrap"><table class="potential-scenario-table"><thead><tr>' + headers.map(h => '<th>' + e(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((row, index) => '<tr>' + row.map((v, i) => i === 0 ? '<th scope="row">' + e(v) + '</th>' : '<td>' + e(v) + '</td>').join('') + (rowSources ? '<td>' + screeningSources(rowSources[index]) + '</td>' : '') + '</tr>').join('') + '</tbody></table></div>';
  function dataServiceEvidence(c) {
    const a = c.dataServiceAudit;
    if (!a) return '';
    const f = a.cash;
    let html = '<section><h3>GAAP盈利与项目现金</h3>' + evidenceTable(['百万美元', '收入', 'GAAP毛利率', '营业利润', '归母净利', '其中SBC成本'], a.periods.map(p=>[p.label,n(p.revenue,3),percent(1-p.cost/p.revenue),n(p.operating,3),n(p.net,3),n(p.sbc,3)])) + '<p>' + e(a.earningsNote) + '</p>';
    html += '<details class="potential-method"><summary>查看项目款与现金余额</summary>' + evidenceTable(['2026H1 / 百万美元','金额'], [['期初现金及等价物',f.start],['经营现金',f.operating],['投资现金',f.investing],['筹资现金',f.financing],['汇率影响',f.fx],['期末现金及等价物',f.end],['另有短期投资',f.shortInvestments],['客户预收',f.advances],['项目已发生未付成本',f.unpaidProjectCosts],['静态扣除两项余额后',f.end+f.shortInvestments-f.advances-f.unpaidProjectCosts],['管理层剔项目预收现金约数',f.managementNetCash],['未衔接口径差额',f.managementNetCash-(f.end+f.shortInvestments-f.advances-f.unpaidProjectCosts)]].map(([label,v])=>[label,n(v,3)])) + '<p>' + e(a.cashNote) + '</p></details>';
    html += '<details class="potential-method"><summary>查看利润至经营现金桥</summary>' + evidenceTable(['2026H1 / 百万美元','金额'],a.ocfRows.map(([label,v])=>[label,n(v,3)])) + '<p>经营现金减资本开支 ' + n(f.operating-f.capex,3) + ' 百万美元仍包含项目款，不能作为可持续自由现金。</p></details>';
    return html + sourceLinks(['inod-q','inod-k','inod-release']) + '</section>';
  }
  function dataServiceShares(c) {
    const a=c.dataServiceAudit;
    if (!a) return '';
    const s=a.capital;
    return '<details class="potential-method"><summary>查看最大业绩RSU与股本口径</summary>' + evidenceTable(['2026-06-30 / 百万股','数量'],[['已发行（含库存股）',s.juneIssued],['库存股',s.juneTreasury],['外部股数',s.juneOutstanding],['期权',s.juneOptions.reduce((v,p)=>v+p.shares,0)],['普通RSU',s.ordinaryRsu],['业绩RSU（已按最大股数）',s.performanceRsu],['既有潜在股份',c.shares.knownPotential]].map(([label,v])=>[label,n(v,6)])) + '<p>' + e(a.shareNote) + '</p>' + sourceLinks(c.shares.sources) + '</details>';
  }
  function dataServiceFinancing(c) {
    if (!c.dataServiceAudit) return '';
    const a=c.dataServiceAudit,s=a.capital,bull=M.scenario(c,'bull');
    return '<section><h3>ATM发行价格与营运资金敏感性</h3><p>全额发行仅为研究假设，发行总额 ' + n(s.atmGross) + ' 百万美元；最高佣金 ' + percent(s.commissionMax) + '，另有其他费用。</p>' + evidenceTable(['假设发行价 / 美元','佣金后净款 / 百万美元','新股 / 百万','合计股数 / 百万','同一经营情景股价倍数'],s.issuePrices.map(price=>{
      const x=M.dataServiceFunding(c,price);
      return [n(price),n(x.netProceeds),n(x.newShares),n(x.shares,6),n(M.project(c,{...bull,shares:x.shares}).priceMultiple)+'×'];
    })) + evidenceTable(['净营运占用比例假设','乐观终点占用 / 百万美元'],a.workingCapitalRatios.map(r=>[percent(r),n(bull.revenue*r)])) + '<p>' + e(a.fundingNote) + '</p>' + sourceLinks(['inod-q','inod-atm']) + '</section>';
  }
  function comparisonPool() {
    const query=state.query.trim().toLowerCase();
    return (data().comparisons || []).filter(c=>c.market===state.market && (!query || [c.id,c.name,c.facts,c.judgment].join(' ').toLowerCase().includes(query)));
  }
  function comparisonEntry() {
    const rows=comparisonPool();
    if (!rows.length) return '';
    return '<div class="panel-foot potential-comparisons">' + H.action('比较观察 · ' + rows.length + ' 家', 'potential-comparisons', 'text-link') + '<span>' + e(rows.map(c=>c.name).join('、')) + '</span></div>';
  }
  function comparisonDetail() {
    const rows=comparisonPool();
    if (!rows.length) return;
    const sections=rows.map(c=>{
      const revenue=c.price.value*10*c.shares/c.margin/c.pe;
      let html='<section><h3>' + e(c.name) + ' · ' + e(c.id) + '</h3><p class="potential-lead">' + e(c.judgment) + '</p><p>' + e(c.facts) + '</p><p>起始收盘 ' + n(c.price.value) + currency(c) + '（' + e(c.price.asOf) + '）；股数 ' + n(c.shares,6) + '百万，截至 ' + e(c.shareDate) + '。' + e(c.shareBasis || '未计未来稀释，只是门槛下限。') + '</p><p>按 ' + percent(c.margin) + '归母净利率、' + c.pe + '倍PE的研究假设，十倍需要收入 ' + amount(c,revenue) + '；相对“' + e(c.anchorLabel) + '”为 ' + n(revenue/c.anchorRevenue) + '倍，期间不同只比较量级。</p>';
      if (c.audit?.kind==='chemical_screen') {
        const a=c.audit,f=a.cash,s=a.capital;
        html+='<details class="potential-method"><summary>查看现金与增长目标</summary>' + evidenceTable(['2026H1 / 百万元','金额'],[['归母净利',a.financials.net],['经营现金',f.operating],['资本开支',f.capex],['经营现金减资本开支',f.operating-f.capex],['期末现金等价物',f.end],['另有受限资金',f.restricted],['期末应收账款净额',f.receivables]].map(([label,v])=>[label,n(v,3)])) + '<p>' + e(a.cashNote) + '</p>' + evidenceTable(['收入考核年度','目标 / 亿元'],s.targets.map(p=>[p.year,n(p.revenue/100)])) + '<p>' + e(a.capitalNote) + '</p><p>' + e(a.businessNote) + '</p></details>';
        html+='<details class="potential-method"><summary>查看增股压力与收入量级</summary>' + evidenceTable(['研究假设','期末股数 / 百万','净利率 / PE','十倍所需收入'],a.hurdleCases.map(p=>[p.label,n(p.shares,6),percent(p.margin)+' / '+p.pe,amount(c,c.price.value*10*p.shares/p.margin/p.pe)]));
        const p=M.project({price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}},{...a.scaleExample,dividends:0});
        html+='<p>量级示例：收入 ' + amount(c,a.scaleExample.revenue) + '、期末 ' + n(a.scaleExample.shares) + '百万股、' + percent(a.scaleExample.margin) + '净利率、' + a.scaleExample.pe + '倍PE，计算每股 ' + n(p.price) + currency(c) + '，约 ' + n(p.priceMultiple) + '倍。</p><p>' + e(a.scaleNote) + '</p></details>';
      }
      if (c.audit?.kind==='operating_screen') html+=operatingScreenDetail(c);
      return html+'<p class="potential-gap"><strong>具体缺项：</strong>' + e(c.gaps) + '</p><p><strong>下一验证点：</strong>' + e(c.next) + '</p>' + sourceLinks(c.sources) + '</section>';
    }).join('');
    H.openModal('<div class="potential-detail">' + H.modalTitle('比较观察','经营进展与当前价格门槛') + sections + '</div>');
  }
  function operatingScreenDetail(c) {
    const a=c.audit,f=a.cash,company={price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}};
    const unit=c.currency==='USD'?'百万美元':'百万元';
    let html='<details class="potential-method"><summary>查看报表利润与现金</summary>' + evidenceTable(['期间 / '+unit,'收入','毛利率','营业利润',a.netLabel||'归母净利','经营现金'],a.periods.map(p=>[p.label,n(p.revenue,3),percent(1-p.cost/p.revenue),n(p.operating,3),n(p.net,3),p.operatingCash===null?'未单列季度数':n(p.operatingCash,3)])) + '<p>' + e(a.earningsNote) + '</p>';
    html+=evidenceTable([f.period+' / '+unit,'金额'],[['期初'+(f.basis||'现金及等价物'),f.start],['经营现金',f.operating],['购建长期资产及设备预付款',f.capex+f.capexPrepaid],['经营现金减上述资本投入',f.operating-f.capex-f.capexPrepaid],['投资现金合计',f.investing],['融资现金合计',f.financing],['汇率影响',f.fx],['期末'+(f.basis||'现金及等价物'),f.end]].map(([label,v])=>[label,n(v,3)])) + '<p>' + e(a.cashNote) + '</p></details>';
    for(const section of a.sections) html+='<details class="potential-method"><summary>' + e(section.title) + '</summary>' + (section.rows?evidenceTable(section.headers,section.rows.map(row=>row.map(v=>typeof v==='number'?n(v,6):v))):'') + paragraphs(section.paragraphs) + sourceLinks(section.sources) + '</details>';
    html+='<h4>五年经营情景 · 2031年终值</h4>' + evidenceTable(['情景','收入 / 亿'+currency(c),'归母净利率','PE','期末股数 / 百万','每股价格','股价倍数'],a.scenarios.map(s=>{
      const p=M.project(company,s);
      return [s.label,n(s.revenue/100),percent(s.margin),s.pe??'亏损残值法',n(s.shares),n(p.price)+currency(c),n(p.priceMultiple)+'×'];
    })) + '<p>' + e(a.scenarioNote) + '</p>';
    html+='<details class="potential-method"><summary>查看情景条件与十倍反算</summary>' + list(a.scenarios.map(s=>s.label+'：'+s.story)) + evidenceTable(['假设','期末股数 / 百万','净利率 / PE','十倍所需收入'],a.hurdleCases.map(s=>[s.label,n(s.shares,6),percent(s.margin)+' / '+s.pe,amount(c,c.price.value*10*s.shares/s.margin/s.pe)]));
    const bull=a.scenarios.find(s=>s.id==='bull');
    html+='<p>终值PE降低25%时，乐观股价倍数为 ' + n(M.project(company,{...bull,pe:bull.pe*.75}).priceMultiple) + '×；总股数增加20%时为 ' + n(M.project(company,{...bull,shares:bull.shares*1.2}).priceMultiple) + '×；同时发生为 ' + n(M.project(company,{...bull,pe:bull.pe*.75,shares:bull.shares*1.2}).priceMultiple) + '×。</p><p>' + e(a.valuationNote) + '</p></details>';
    return html;
  }
  function sensingEvidence(c) {
    const a = c.sensingAudit;
    if (!a) return '';
    const f = a.cash, k = a.customerContract;
    let html = '<section><h3>软件收费与项目交付</h3>' + a.commercial.map(r => '<p><strong>' + e(r.label) + ' · ' + e(r.stage) + '</strong><br>' + e(r.evidence) + ' ' + e(r.boundary) + sourceLinks(r.sources) + '</p>').join('') + '</section>';
    html += '<details class="potential-method"><summary>查看客户报价与许可确认方式</summary>' + evidenceTable(['纳什维尔合同附件', '客户单价 / 美元', '运费 / 美元'], k.priceRows.map(r => [r.label, n(r.price), n(r.shipping)])) + '<p>' + e(k.note) + '</p><p>' + e(a.software.recognition) + '</p><p>' + e(a.software.note) + '</p>' + sourceLinks(['oust-nashville-contract','oust-k','oust-software']) + '</details>';
    html += '<details class="potential-method"><summary>查看并购前后的收入口径</summary>' + evidenceTable(['百万美元', '本期报表', '上年报表', '本期备考', '上年备考', '备考增长'], a.revenue.map(r => [r.label, ...[r.reported,r.priorReported,r.proforma,r.priorProforma].map(v=>n(v,3)), percent(r.proforma/r.priorProforma-1)])) + '<p>' + e(a.proformaNote) + '</p>' + sourceLinks(['oust-q']) + '</details>';
    html += '<details class="potential-method"><summary>查看退款与现金流</summary>' + evidenceTable(['2026H1 / 百万美元', '金额'], [['报表经营现金',f.operating],['减：资本开支',-f.capex],['两项相抵',f.operating-f.capex],['关税退款收益',f.tariffProfitBenefit],['其中H1已到账',f.tariffCashReceived],['只移除已到账退款后的经营现金',f.operating-f.tariffCashReceived],['净并购付款',f.acquisitionNet],['6月底非受限现金及短期投资',f.cashEquivalents+f.shortInvestments],['另有受限现金',f.restrictedCurrent+f.restrictedNoncurrent]].map(([label,v])=>[label,n(v,3)])) + '<p>' + e(a.cashNote) + '</p><p>' + e(a.contracts.note) + '</p>' + sourceLinks(['oust-q']) + '</details>';
    return html;
  }
  function sensingTargets(c) {
    const s = c.sensingAudit?.softwareStress;
    if (!s) return '';
    return '<details class="potential-method"><summary>查看软件规模与渠道实收敏感性</summary>' + evidenceTable(['客户年费 / 美元', '厂家实收假设', '厂家年收入 / 计费单位', '达到1.8亿美元所需年度计费单位'], s.realizationFractions.map(r => [n(s.retailAnnualFee), percent(r), n(s.retailAnnualFee*r), n(s.annualRevenueTarget*1e6/(s.retailAnnualFee*r),0)])) + '<p>' + e(s.note) + '</p>' + sourceLinks(['oust-nashville-contract','oust-k','oust-software']) + '</details>';
  }
  function sensingShareEvidence(c) {
    const s = c.sensingAudit?.shares;
    if (!s) return '';
    return '<details class="potential-method"><summary>查看7月股本对平与后续行权</summary>' + evidenceTable(['实际股数', '股数'], [['6月底已发行',s.juneIssued],['7月公开发行',s.julyIssued],['7月董事费股份',s.julyDirector],['7月底已发行',s.julyTotal]].map(([label,v])=>[label,n(v,0)])) + '<p>' + e(s.note) + '</p>' + sourceLinks(['oust-q','oust-offering','oust-director-july','oust-exercise-aug','oust-director-oct']) + '</details>';
  }
  function diagnosticEvidence(c) {
    const a = c.diagnosticAudit;
    if (!a) return '';
    const f = a.cash;
    let html = '<section><h3>试剂量价 · 2025全年</h3>' + evidenceTable(['主要试剂', '收入 / 百万元', '销量变化', '均价变化', '收入变化'], a.products.filter(p => p.label.endsWith('试剂')).map(p => [p.label, n(p.revenue, 3), percent(p.volumeGrowth), percent(p.priceGrowth), percent(p.revenueGrowth)])) + '<p>试剂占IVD收入 ' + percent(a.reagentRevenue / a.ivdRevenue) + '。销量增长仍可能被降价抵消。</p>' + sourceLinks(['pumen-inquiry','pumen-auditor']) + '</section>';
    html += '<details class="potential-method"><summary>查看新增装机与境外出货</summary>' + evidenceTable(['产品 / 地区', '仪器口径', '2025台数', '2024台数', '2025试剂 / 万人份', '2024试剂 / 万人份'], a.installations.map(p => [p.label, p.deviceBasis === 'new_domestic_installations' ? '当年新增装机' : '境外出货', ...p.devices.map(v => v === null ? '未披露' : n(v,0)), ...p.reagents.map(v=>n(v,2))])) + '<p>' + e(a.installationNote) + '</p><p>' + e(a.regionNote) + '</p>' + sourceLinks(['pumen-inquiry']) + '</details>';
    html += '<section><h3>海外准入与商业进展</h3>' + a.commercial.map(p => '<p><strong>' + e(p.label) + ' · ' + e(p.date) + '</strong><br>' + e(p.evidence) + ' ' + e(p.boundary) + sourceLinks(p.sources) + '</p>').join('') + '</section>';
    html += '<details class="potential-method"><summary>查看现金来源与可用资金</summary>' + evidenceTable(['2026H1 / 百万元', '金额'], [['经营现金', f.operating], ['减：长期资产购建', -f.capex], ['两项相抵', f.operating-f.capex], ['分红及付息现金', f.dividendsAndInterest], ['净偿还银行借款', f.repaid-f.borrowed], ['期末现金及等价物', f.end], ['另有定期存款',f.termDeposits], ['另有应计利息',f.accruedInterest], ['诉讼冻结资金',f.frozen], ['期末短期银行借款',f.shortDebtEnd]].map(([label,value])=>[label,n(value,3)])) + '<p>' + e(a.cashNote) + '</p>' + sourceLinks(['pumen','pumen-cash-management']) + '</details>';
    html += '<details class="potential-method"><summary>查看利润变动与财务费用</summary>' + evidenceTable(['财务费用 / 百万元', '2026H1', '2025H1', '费用变化'], a.financeRows.map(p=>[p.label,n(p.current,3),n(p.prior,3),n(p.current-p.prior,3)])) + '<p>归母利润由 ' + n(a.history.prior.netIncome,3) + ' 降至 ' + n(a.history.current.netIncome,3) + ' 百万元。税项和少数损益已在下载研究中逐项对平；上述财务费用是税前数，不能直接全部加回归母。</p>' + sourceLinks(['pumen','pumen-ir']) + '</details>';
    return html;
  }
  function diagnosticTargets(c) {
    const a = c.diagnosticAudit;
    if (!a) return '';
    return '<details class="potential-method"><summary>查看试剂增长与降价压力</summary><p>' + e(a.targetNote) + '</p>' + evidenceTable(['试剂 / 百万元', '2025实际', '2031假设', '六年收入增速', '均价年降5%时所需销量增速'], a.reagentTargets.map(p=>[p.label,n(p.base,3),n(p.target),percent((p.target/p.base)**(1/a.targetYears)-1),percent((p.target/p.base)**(1/a.targetYears)/.95-1)])) + sourceLinks(['pumen-inquiry','pumen-quidel']) + '</details>';
  }
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
    if (m.kind === 'annual_segments') return evidenceTable(['产品线', m.baseYear + '实际收入', m.targetYear + '收入假设', '所需' + (m.targetYear-m.baseYear) + '年增速'], m.parts.map(p=>[p.label,amount(c,p.baseRevenue),amount(c,p.revenue),percent((p.revenue/p.baseRevenue)**(1/(m.targetYear-m.baseYear))-1)])) + diagnosticTargets(c);
    if (m.kind === 'segment_growth') return '<div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>产品线</th><th>2026H1</th><th>H1简单年化</th><th>2031收入假设</th><th>隐含五年增速</th></tr></thead><tbody>' + m.parts.map(p => '<tr><th scope="row">' + e(p.label) + '</th><td>' + amount(c, p.reportedRevenue) + '</td><td>' + amount(c, p.baseRevenue) + '</td><td>' + amount(c, p.revenue) + '</td><td>' + percent((p.revenue / p.baseRevenue) ** (1 / data().horizonYears) - 1) + '</td></tr>').join('') + '</tbody></table></div>';
    return '<div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>2031收入假设</th><th>数量</th><th>单位净收入</th><th>收入</th></tr></thead><tbody>' + m.parts.map(p => '<tr><th scope="row">' + e(p.label) + '</th><td>' + (p.kind === 'annual_revenue' ? e(p.quantityBasis || '年度收入假设；计费数量另测') : n(p.units, 0) + e(p.unitLabel)) + '</td><td>' + (p.kind === 'annual_revenue' ? e(p.priceBasis || '未假定已知厂家单价') : n(p.price, 0) + currency(c)) + '</td><td>' + amount(c, p.revenue) + '</td></tr>').join('') + '</tbody></table></div>' + sensingTargets(c);
  }
  function parameterEvidence(c) {
    let html = '<section><h3>参数根据与未验证条件</h3>' + c.calibration.map(a => '<p><strong>' + e(a.label) + '：</strong>' + e(a.basis) + sourceLinks(a.sources) + '</p>').join('') + '</section>';
    const old = c.priorBull;
    if (old) html += '<details class="potential-method"><summary>查看已撤回的旧乐观假设</summary><p>旧版收入 ' + amount(c, old.revenue) + '、净利率 ' + percent(old.margin) + '、' + old.pe + '倍PE、' + n(old.shares) + '百万股，计算为 ' + n(M.project(c, old).priceMultiple) + '倍。需求与利润条件不足，已撤回这组经营判断。</p></details>';
    if (c.ownershipCheck) {
      const o = c.ownershipCheck;
      html += '<section><h3>子公司融资稀释 · 独立于美股股数</h3><p>起点持股 ' + percent(o.ownership) + '；若新股占发行后 ' + percent(o.proposedFraction) + '，持股约 ' + percent(M.subsidiaryOwnership(o.ownership, o.proposedFraction)) + '；再按初始新股数超额配售 ' + percent(o.overAllotment) + '，约为 ' + percent(M.subsidiaryOwnership(o.ownership, o.proposedFraction, o.overAllotment)) + '。</p><p>' + e(o.caveat) + '</p>' + sourceLinks(o.sources) + '</section>';
    }
    html += dataServiceFinancing(c);
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
  function screeningSources(ids) {
    return '<span class="potential-refs">' + ids.map(id => {
      const s = screening().sources.find(s => s.id === id);
      if (!s) return '来源缺失：' + e(id);
      return s.url === screening().quotePath ? '<a href="' + e(s.url) + '" download>' + e(s.title) + '</a>' : link(s.url, s.title);
    }).join(' · ') + '</span>';
  }
  function screeningView() {
    const d = screening(), pool = d.companies.filter(c => c.market === state.market);
    const sectors = d.sectors.filter(s => pool.some(c => c.sector === s.id));
    const query = state.query.trim().toLowerCase();
    const rows = pool.filter(c => (state.sector === 'all' || c.sector === state.sector) && (state.status === 'all' || (state.status === 'priority') === c.selected) && (!query || [c.id,c.name,c.business,c.opportunity,c.profitMechanism,c.judgment,d.sectors.find(s=>s.id===c.sector)?.name].join(' ').toLowerCase().includes(query)));
    const filters = '<div class="stock-category-filter" role="group" aria-label="潜力公司行业">' + [['all','全部行业'], ...sectors.map(s => [s.id,s.name])].map(([id,label]) => H.action(e(label),'potential-sector','filter-chip' + (state.sector === id ? ' active' : ''),'data-value="' + e(id) + '" aria-pressed="' + (state.sector === id) + '"')).join('') + '</div>' + '<div class="stock-controls"><div class="filters"><input type="search" id="potential-search" aria-label="搜索公司、代码或业务" placeholder="搜索公司、代码或业务" value="' + e(state.query) + '"></div><div class="segmented stock-scope" aria-label="研究取舍">' + [['all','全部结果'],['priority','保留候选'],['watch','暂不深入']].map(([id,label]) => H.action(label,'potential-status',state.status === id ? 'active' : '','data-value="' + id + '" aria-pressed="' + (state.status === id) + '"')).join('') + '</div></div>';
    const industries = sectors.filter(s => state.sector === 'all' ? s.featured !== false : state.sector === s.id).map(s => '<article><h3>' + e(s.name) + '</h3><strong>' + e(s.verdict) + '</strong><p>' + e(s.change) + '</p><p>' + e(s.profit) + '</p><details class="potential-industry-evidence"><summary>行业依据</summary><p>' + e(s.evidence) + '</p>' + screeningSources(s.sources) + '</details></article>').join('');
    const history = '<div class="panel-foot potential-screen-history">' + (state.historyDepth ? H.action('返回本轮研究','potential-current','text-link') : '') + H.action(d.previous ? '查看上一轮 · ' + d.previous.companies.length + '家' : '查看更早研究 · 2026-10-18', d.previous ? 'potential-history' : 'potential-legacy', 'text-link') + '</div>';
    if (!pool.length) return '<div class="potential-page potential-screening">' + filters + '<section class="card"><div class="empty">本批研究从美股开始，A股暂无本轮结果。</div>' + history + '</section></div>';
    return '<div class="potential-page potential-screening">' + filters + '<div class="potential-industry-grid">' + industries + '</div><div class="potential-screen-summary"><strong>' + e(d.summary) + '</strong><span>研究 ' + e(d.reviewedAt) + ' · 五年视角 · 可能性为定性判断</span></div><section class="card"><div class="table-caption stock-table-caption"><span><b>' + rows.length + '</b> / ' + pool.length + ' 家研究记录</span><span>' + pool.filter(c => c.research).length + '份公司详析 · 点击查看依据与缺口</span></div><div class="table-wrap stock-table-wrap" tabindex="0" role="region" aria-label="行业筛选与公司研究表，可横向滚动"><table class="research-table stock-table potential-screen-table"><thead><tr><th>公司</th><th>公司做什么</th><th>利润增长靠什么</th><th>五年十倍可能性</th><th>股价快照 / 美元</th><th>研究优先级</th></tr></thead><tbody>' + rows.map(c => '<tr data-stock-row="' + e(c.id) + '"><td class="stock-identity"><span class="stock-name">' + H.action(e(c.name),'potential-screen-detail','text-link','data-value="' + e(c.id) + '" aria-label="查看' + e(c.name) + '公司与机会"') + '</span>' + sub(c.id + ' · ' + d.sectors.find(s=>s.id===c.sector).name) + '</td><td>' + e(c.businessBrief) + '</td><td>' + e(c.profitBrief) + '</td><td><strong class="potential-possibility">' + e(c.tenfold) + '</strong>' + e(c.judgment) + '</td><td class="potential-screen-price">' + n(c.quote.priceUsd, Number.isInteger(c.quote.priceUsd * 100) ? 2 : 3) + sub(c.quote.label || '10月16日 · 盘后') + '</td><td><span class="potential-status ' + (c.selected ? 'priority' : '') + '">' + e(c.priority) + '</span>' + sub(c.stage) + '</td></tr>').join('') + (!rows.length ? '<tr><td colspan="6"><div class="empty">当前条件没有匹配公司。' + H.action('清除筛选','potential-reset','text-link') + '</div></td></tr>' : '') + '</tbody></table></div>' + history + '</section></div>';
  }
  function screeningResearch(c) {
    return (c.research?.sections || []).map(s => {
      const body = paragraphs(s.paragraphs) + (s.headers ? '<div class="potential-research-evidence' + (s.proseTable ? ' prose' : '') + '">' + evidenceTable(s.headers, s.rows, s.rowSources) + '</div>' : '') + (s.notes ? list(s.notes) : '') + (s.sources ? screeningSources(s.sources) : '');
      return s.collapsed ? '<details class="potential-method"><summary>' + e(s.title) + '</summary>' + body + '</details>' : '<section><h3>' + e(s.title) + '</h3>' + body + '</section>';
    }).join('');
  }
  function screeningDetail(id) {
    const d = screening(), c = d?.companies.find(c => c.id === id);
    if (!c) return;
    const sector = d.sectors.find(s => s.id === c.sector);
    const section = (title, body) => '<section><h3>' + title + '</h3>' + body + '</section>';
    const body = section('公司做什么', paragraphs([c.business])) + section('机会为什么出现', paragraphs([c.opportunity]) + screeningSources(c.sources.filter(id => id !== 'screen-quotes'))) + section('利润如何放大', paragraphs([c.profitMechanism])) + section('当前判断', '<p class="potential-lead">五年十倍可能性：' + e(c.tenfold) + ' · 研究优先级：' + e(c.priority) + '</p>' + paragraphs([c.judgment,c.startingValue]) + '<p class="small">股价 ' + n(c.quote.priceUsd, Number.isInteger(c.quote.priceUsd * 100) ? 2 : 3) + ' 美元 · ' + e(c.quote.tradeTimeUtc) + '（UTC，' + e(c.quote.sessionLabel || '盘后') + '）</p>' + '<details class="potential-method"><summary>估值与股本口径</summary>' + paragraphs([c.capitalBasis,d.priceBasis]) + screeningSources(['screen-quotes']) + '</details>') + screeningResearch(c) + section('关键风险与依据', list(c.risks) + c.facts.map(f => '<p><strong>' + e(f.label) + '</strong><br>' + e(f.text) + screeningSources(f.sources) + '</p>').join('')) + section('本轮已检验：' + e(c.check.question), paragraphs([c.check.answer]) + screeningSources(c.check.sources)) + section('什么会改变判断', '<p><strong>上调：</strong>' + e(c.upgrade) + '</p><p><strong>下调：</strong>' + e(c.downgrade) + '</p>') + section(c.research ? '本轮结论与重开条件' : '本轮取舍', paragraphs([c.nextQuestion])) + '<details class="potential-method"><summary>原始来源与定位</summary><ul class="potential-sources">' + [...new Set(c.sources)].map(id => { const s=d.sources.find(s=>s.id===id); return '<li>' + screeningSources([id]) + '<span>' + e(s.publishedAt + ' · ' + s.locator) + '</span></li>'; }).join('') + '</ul></details>';
    H.openModal('<div class="potential-detail potential-screen-detail">' + H.modalTitle(e(c.name) + ' · ' + e(c.id), e(c.stage) + ' · ' + e(d.reviewedAt) + ' · ' + e(sector.name)) + body + '</div>');
  }
  function view(helpers) {
    H = helpers;
    if (H.market && state.market !== H.market) { state.market = H.market; state.sector = 'all'; state.sort = 'default'; state.descending = true; }
    if (screening() && !state.legacy) return screeningView();
    const d = data(), pool = d.companies.filter(c => c.market === state.market), rows = M.select(d.companies, state);
    const sectors = [...new Set(pool.map(c => c.sector))];
    const filters = '<div class="stock-category-filter" role="group" aria-label="潜力公司行业">' + [['all', '全部行业'], ...sectors.map(s => [s, s])].map(([id, label]) => H.action(e(label), 'potential-sector', 'filter-chip' + (state.sector === id ? ' active' : ''), 'data-value="' + e(id) + '" aria-pressed="' + (state.sector === id) + '"')).join('') + '</div>' + '<div class="stock-controls"><div class="filters"><input type="search" id="potential-search" aria-label="搜索公司、代码或业务" placeholder="搜索公司、代码或业务" value="' + e(state.query) + '"></div><div class="segmented stock-scope" aria-label="研究优先级">' + [['all', '全部候选'], ['priority', '重点跟踪'], ['watch', '边界观察']].map(([id, label]) => H.action(label, 'potential-status', state.status === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.status === id) + '"')).join('') + '</div></div>';
    const views = '<div class="segmented stock-view" aria-label="潜力研究视图">' + [['financials', '判断与财务'], ['valuation', '十倍反算'], ['returns', '五年收益']].map(([id, label]) => H.action(label, 'potential-view', state.view === id ? 'active' : '', 'data-value="' + id + '" aria-pressed="' + (state.view === id) + '"')).join('') + '</div>';
    let headers, cells, count;
    if (state.view === 'financials') {
      count = 6;
      headers = th('营收 / 2026上半年', 'revenue') + th('归母 / 普通股利润', 'netIncome') + th('经营现金流', 'operatingCash') + th('判断') + th('下个验证点');
      cells = c => '<td>' + amount(c, c.financials.revenue) + sub(c.financials.label) + '</td><td>' + amount(c, c.financials.netIncome) + sub(c.profitCheck ? '含未实现投资收益' : '报表口径') + '</td><td>' + amount(c, c.financials.operatingCash) + sub(c.financials.operatingCashNote || '2026上半年') + '</td><td class="potential-prose">' + e(c.decision) + '</td><td class="potential-prose"><strong>' + e(c.milestones[0].when) + '</strong>' + sub(c.milestones[0].test) + '</td>';
    } else if (state.view === 'valuation') {
      count = 7;
      headers = th('起始收盘价', 'price') + th('期末股数 / 乐观', 'dilution') + th('十倍目标价') + th('十倍所需营收', 'hurdle') + th('终点估值假设') + th('十倍所需股权价值');
      cells = c => { const s = M.scenario(c, 'bull'), p = M.project(c, s), h = M.hurdle(c, s); return '<td>' + n(c.price.value) + currency(c) + sub(c.price.asOf) + '</td><td>' + n(s.shares, 1) + '百万股' + sub('较起始股数增加 ' + percent(p.dilution)) + '</td><td>' + n(h.price) + currency(c) + sub('不含分红') + '</td><td>' + amount(c, h.revenue) + sub('五年营收CAGR ' + percent(h.revenueCagr)) + '</td><td>归母净利率 ' + percent(s.margin) + sub(s.pe + '倍PE · 研究假设') + '</td><td>' + amount(c, h.equity) + sub('较起始股本折算值 ' + n(h.capitalMultiple) + '×') + '</td>'; };
    } else {
      count = 5;
      headers = th('悲观 / ' + (H.annual ? '年化' : '累计'), 'bear') + th('基准 / ' + (H.annual ? '年化' : '累计'), 'base') + th('乐观 / ' + (H.annual ? '年化' : '累计'), 'bull') + th('股价终值倍数');
      cells = c => ['bear', 'base', 'bull'].map(id => returnCell(c, id)).join('') + '<td class="potential-range-cell">' + scenarioRange(c) + '</td>';
    }
    const foot = state.view === 'financials' ? '财务截至2026-06-30；财报中的事实与研究假设在公司详情中分开。' : state.view === 'valuation' ? '股本与报价各自记录日期；增长锚点为2026全年指引或研究假设，详见公司情景。' : '2026-10-16 → 2031-10-16 · 股票价格收益；分红按税前现金持有、不再投资。未扣税费及汇兑。';
    return '<div class="potential-page">' + (screening() ? '<div class="potential-screen-history"><strong>此前研究 · ' + e(d.reviewedAt) + '</strong>' + H.action('返回本轮研究','potential-current','text-link') + '</div>' : '') + filters + '<div class="potential-warning"><strong>十倍尚未获证据支持</strong><span>经营情景与十倍门槛分开看；具体缺项见各公司判断。</span></div>' + '<section class="card"><div class="table-caption stock-table-caption"><span><b>' + rows.length + '</b> / ' + pool.length + ' 家候选 · 研究 ' + e(d.reviewedAt) + ' · 修订' + d.revision + '</span>' + views + (state.sort !== 'default' ? '<span class="stock-sort-status">按' + e(sortNames[state.sort]) + (state.descending ? '降序' : '升序') + H.action('恢复默认', 'potential-sort-reset', 'text-link small') + '</span>' : '') + '</div>' + (state.view === 'returns' ? '<div class="potential-return-controls"><span>未来五年 · 情景假设</span>' + H.annualControl() + '</div>' : '') + '<div class="table-wrap stock-table-wrap potential-table-wrap" tabindex="0" role="region" aria-label="潜力研究表，可横向滚动"><table class="research-table stock-table potential-table potential-' + state.view + '-table"><thead><tr><th>公司 / 主营业务</th>' + headers + '</tr></thead><tbody>' + rows.map(c => '<tr data-stock-row="' + e(c.id) + '">' + identity(c) + cells(c) + '</tr>').join('') + (!rows.length ? '<tr><td colspan="' + count + '"><div class="empty">当前条件没有匹配公司。' + H.action('清除筛选', 'potential-reset', 'text-link') + '</div></td></tr>' : '') + '</tbody></table></div><div class="panel-foot">' + e(foot) + '</div></section>' + comparisonEntry() + '</div>';
  }
  function judgment(c) {
    return '<section><h3>研究判断</h3><p class="potential-lead">' + e(c.decision) + '</p>' + paragraphs(c.thesis) + '</section><div class="potential-detail-columns"><section><h3>已验证事实</h3>' + c.facts.map(f => '<p>' + e(f.text) + sourceLinks(f.sources) + '</p>').join('') + '</section><section><h3>管理层指引</h3>' + (c.guidance.length ? c.guidance.map(g => '<p>' + e(g.text) + sourceLinks(g.sources) + '</p>').join('') : '<p>未将未核实的全年经营目标设为公司指引。</p>') + '<h3>单位经济与竞争</h3><p>' + e(c.economics) + '</p></section></div>' + profitEvidence(c) + cashEvidence(c) + batteryCashEvidence(c) + medicalEvidence(c) + diagnosticEvidence(c) + sensingEvidence(c) + dataServiceEvidence(c) + '<section><h3>管理层与资本配置</h3><p>' + e(c.management) + '</p><h3>融资与现金承受能力</h3><p>' + e(c.funding) + sourceLinks(c.fundingSources) + '</p></section><section><h3>为什么没有优先选常见替代</h3>' + c.alternatives.map(a => '<p><strong>' + e(a.name) + '</strong> — ' + e(a.reason) + sourceLinks(a.sources) + '</p>').join('') + '</section>';
  }
  function scenarios(c) {
    const bull = M.scenario(c, 'bull'), h = M.hurdle(c, bull), f = c.financials;
    const parameters = [['2031营收', s => amount(c, s.revenue)], ['归母净利率', s => percent(s.margin)], ['归母利润', s => amount(c, M.project(c, s).profit)], ['期末股数', s => n(s.shares, 1) + '百万股'], ['期末PE', s => s.pe === null ? '亏损残值法' : s.pe + '倍'], ['股权价值', s => amount(c, M.project(c, s).equity)], ['每股价格', s => n(M.project(c, s).price) + currency(c)], ['五年每股现金分红', s => n(s.dividends) + currency(c)], ['股价倍数', s => n(M.project(c, s).priceMultiple) + '×'], ['含现金分红财富倍数', s => n(M.project(c, s).totalMultiple) + '×']];
    const stress = [['乐观原假设', bull], ['终值PE降低25%', { ...bull, pe: bull.pe * .75 }], ['期末股份再增20%', { ...bull, shares: bull.shares * 1.2 }], ['两项同时发生', { ...bull, pe: bull.pe * .75, shares: bull.shares * 1.2 }]];
    return '<section><h3>2031年情景 · 全部为研究假设</h3><p>收入增长锚点：' + e(f.anchorLabel) + '，' + amount(c, f.anchorRevenue) + '。价格起点为 ' + e(c.price.asOf) + ' 收盘 ' + n(c.price.value) + currency(c) + '；五年期固定至 ' + e(data().horizonDate) + '。</p><div class="table-wrap"><table class="potential-scenario-table"><thead><tr><th>指标</th>' + c.scenarios.map(s => '<th>' + e(s.label) + '</th>').join('') + '</tr></thead><tbody>' + parameters.map(([label, get]) => '<tr><th scope="row">' + label + '</th>' + c.scenarios.map(s => '<td>' + get(s) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + c.scenarios.map(s => '<p><strong>' + e(s.label) + '：</strong>' + e(s.story) + '</p>').join('') + '</section><section><h3>十倍反算 · 先看每股，再看总额</h3><p class="potential-lead">每股 ' + n(h.price) + currency(c) + ' → 股权价值 ' + amount(c, h.equity) + ' → 归母利润 ' + amount(c, h.profit) + ' → 收入 ' + amount(c, h.revenue) + '。</p><p>按 ' + n(bull.shares, 1) + '百万期末股份、' + bull.pe + '倍PE和' + percent(bull.margin) + '归母净利率；所需收入五年复合增速 ' + percent(h.revenueCagr) + '。股权总值需扩大 ' + n(h.capitalMultiple) + '倍，才能让单股价格达到十倍。</p><div class="potential-stress">' + stress.map(([label, s]) => '<div><span>' + label + '</span><strong>' + n(M.project(c, s).priceMultiple) + '×</strong></div>').join('') + '</div></section><section><h3>股本与稀释</h3><p>' + e(c.shares.label || '已发行股数') + ' ' + n(c.shares.value, 6) + '百万股，截至 ' + e(c.shares.asOf) + '。' + e(c.shares.potentialBasis) + '</p><p>' + e(c.shares.futureBasis) + '</p><p>' + e(c.shares.convertibles) + '</p><p class="potential-gap"><strong>缺项：</strong>' + e(c.shares.gap) + '</p>' + sourceLinks(c.shares.sources || [c.shares.source]) + medicalShareEvidence(c) + sensingShareEvidence(c) + dataServiceShares(c) + '</section><section><h3>市场容量与单位经济反查</h3><p>' + e(c.marketTest.headline) + '</p>' + marketBuild(c) + paragraphs([c.marketTest.assumptions, c.marketTest.boundary]) + '<p class="potential-gap"><strong>缺项：</strong>' + e(c.marketTest.gap) + '</p>' + sourceLinks(c.marketTest.sources) + '</section><details class="potential-method"><summary>计算口径</summary>' + paragraphs([data().method.formula, data().method.returnBasis, data().method.valuation, data().method.annualization]) + '</details>' + parameterEvidence(c);
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
    const process = data().researchProcess;
    const current = screening() && !state.legacy;
    const workflow = process ? '<p class="potential-lead">' + e(process.objective) + '</p><ol class="potential-milestones">' + process.stages.map(s => '<li><strong>' + e(s.title) + '</strong><p>' + e(s.body) + '</p></li>').join('') + '</ol><p>' + e(process.history) + '</p><h3>每家公司先讲清楚什么</h3><p>' + e(process.companyReadingOrder) + '</p><p>' + e(process.reset) + '</p>' : '';
    H.openModal('<div class="potential-detail">' + H.modalTitle('潜力研究口径', process ? '方法确认于 ' + e(process.confirmedAt) : '研究版本 ' + e(data().reviewedAt)) + workflow + (screening() ? paragraphs([screening().profitPrinciple,screening().historyLesson,screening().judgmentBasis]) : '') + '<details class="potential-method"><summary>此前情景的估值与数据口径</summary>' + paragraphs(Object.values(data().method)) + '</details><p><a href="' + e(reportPath()) + '" download>下载当前研究</a> · <a href="' + (current ? e(screening().dataPath || 'data/potential-screening.json') : 'data/potential-stocks.json') + '" download>研究数据 JSON</a> · <a href="' + (current ? e(screening().quotePath) : 'data/potential-quotes.json') + '" download>报价记录 JSON</a></p></div>');
  }
  function handleAction(button) {
    const act = button.dataset.action, value = button.dataset.value;
    if (act === 'potential-screen-detail') { screeningDetail(value); return; }
    if (['potential-history', 'potential-current', 'potential-legacy'].includes(act)) {
      const next = screening()?.previous;
      Object.assign(state, { legacy: act === 'potential-legacy' || (act === 'potential-history' && !next), historyDepth: act === 'potential-history' && next ? state.historyDepth + 1 : (act === 'potential-current' ? 0 : state.historyDepth), status: 'all', sector: 'all', query: '', sort: 'default', descending: true });
      H.render(); return;
    }
    if (act === 'potential-detail') { detail(value); return; }
    if (act === 'potential-detail-tab') {
      detail(state.company, value);
      root.document?.querySelector('.potential-detail-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }
    if (act === 'potential-method') { method(); return; }
    if (act === 'potential-comparisons') { comparisonDetail(); return; }
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
  root.ChanghengPotential = { view, handleAction, handleInput, companies, reportPath };
})(window);
