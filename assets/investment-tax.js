(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.ChanghengInvestmentTax = factory(root.Changheng);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const sources = {
    treaty: ['中美税收协定 · 第9、22条', 'https://www.irs.gov/pub/irs-trty/china.pdf'],
    china: ['境外所得与抵免 · 2020年第3号公告', 'https://www.chinatax.gov.cn/chinatax/n810219/n810744/n3752930/n3752974/c5143076/content.html'],
    law: ['个人所得税法', 'https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3970366/content.html'],
    irs: ['IRS · 非居民投资所得', 'https://www.irs.gov/individuals/international-taxpayers/federal-income-tax-withholding-and-reporting-on-other-kinds-of-us-source-income-paid-to-nonresident-aliens'],
    hsbc: ['汇丰 · 投资FAQ', 'https://www.hsbc.com.hk/help/faq/investments/'],
    hsbcTerms: ['汇丰账户条款 · 投资服务5.1.8', 'https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/accounts/personal-integrated/terms-and-conditions-3sep.pdf'],
    futu: ['富途香港 · 股息税查询指引', 'https://www.futuhk.com/hans/support/topic2_2337'],
    futuDrip: ['富途香港 · 股息再投资计划', 'https://www.futuhk.com/support/topic2_1770'],
    zheshang: ['浙商国际 · 2025-04-07预扣声明', 'https://www.cnzsqh.hk/hk/view.php?id=284'],
    ibkr: ['IBKR · 非美国人士预扣税', 'https://www.interactivebrokers.com/en/support/tax-nonus-initial.php'],
    ibkrRoc: ['IBKR · 预扣税课程及员工答复', 'https://www.interactivebrokers.com/campus/trading-lessons/what-kind-of-income-is-subject-to-withholding/'],
    ibkrDrip: ['IBKR · DRIP启用与适用条件', 'https://www.ibkrguides.com/brokerportal/dividendelection.htm'],
    ibkrForms: ['IBKR · 非美国客户税表', 'https://www.interactivebrokers.com/en/support/tax-nonus-forms.php'],
    qqqi: ['QQQI · 正式Form 8937，第3页', 'https://neosfunds.com/wp-content/uploads/NEOS-Nasdaq-100-High-Income-ETF-Form-8937-12.31.25.pdf'],
    qqqiStrategy: ['QQQI · 基金策略与分配', 'https://neosfunds.com/qqqi/'],
    qqqiProspectus: ['QQQI · 招募说明书', 'https://neosfunds.com/wp-content/uploads/QQQI-Prospectus.pdf'],
    qqq: ['QQQ · 2025年最终分配分类表', 'https://www.invesco.com/content/dam/invesco/us/en/documents/tax-documents/ICI-Primary-and-Secondary-and-NRA-File-IVZ-ETF-2025.xlsx'],
    spy: ['SPY · 2025年最终分配分类表', 'https://www.ssga.com/library-content/products/fund-docs/etfs/us/tax-documents/SPDR_ICI_Tax_Summary_Primary.xlsx'],
    ko: ['可口可乐 · 2025-05-01派息公告', 'https://www.coca-colacompany.com/media-center/coca-cola-board-of-directors-declares-regular-quarterly-dividend'],
    refund: ['IRS · Publication 519退税规则', 'https://www.irs.gov/publications/p519'],
    estate: ['IRS · 非居民美国遗产税', 'https://www.irs.gov/businesses/small-businesses-self-employed/estate-tax-for-nonresidents-not-citizens-of-the-united-states'],
    estateAssets: ['IRS · 境外托管的美国资产', 'https://www.irs.gov/individuals/international-taxpayers/some-nonresidents-with-us-assets-must-file-estate-tax-returns'],
    chinaEstate: ['财政部未开征遗产税答复 · 政府网站转述', 'https://www.pahz.gov.cn/xinfasudi/201711/t20171130_5865341.shtml'],
    hkStamp: ['香港税务局 · 香港股票定义', 'https://www.ird.gov.hk/eng/pdf/sog_pn04a.pdf'],
    domestic: ['国内开放式基金税收政策', 'https://www.chinatax.gov.cn/chinatax/n810341/n810765/n812203/200207/c1208424/content.html']
  };
  const tabs = Object.freeze([['comparison', '渠道收益比较'], ['rules', '税种与抵免'], ['products', '四只标的实例'], ['channels', '银行与券商']]);
  const historyTaxPolicy = Object.freeze({ usDividendTax: 10, usDividendCreditCap: 10, cnDividendTax: 20, capitalGainsTax: 20 });
  // This is a disclosed treaty/credit baseline, not an execution promise by a named broker.
  const historyFees = fees => ({ ...fees, ...historyTaxPolicy });
  const qqqiRecord = Object.freeze({ payableDate: '2025-12-26', shares: 1000,
    distributionPerShare: 0.64128519, rocPerShare: 0.63870371,
    rocPercent: 99.597452, formDate: '2026-02-27' });
  const records = Object.freeze({
    QQQI: qqqiRecord,
    QQQ: Object.freeze({ payableDate: '2025-10-31', shares: 1000, distributionPerShare: 0.69395, ordinaryPerShare: 0.69395, capitalGainPerShare: 0, rocPerShare: 0, sourceRow: 1819 }),
    SPY: Object.freeze({ payableDate: '2025-10-31', shares: 1000, distributionPerShare: 1.831114, ordinaryPerShare: 1.831114, capitalGainPerShare: 0, rocPerShare: 0, sourceRow: 1020 }),
    KO: Object.freeze({ payableDate: '2025-07-01', shares: 1000, distributionPerShare: 0.51, ordinaryPerShare: 0.51 })
  });
  const products = {
    QQQI: { label: 'QQQI', name: '纳指股票＋指数期权', frequency: '每月分配', source: 'qqqi',
      income: '持有纳指股票，并运用NDX指数期权策略。到账现金可能包含股息、已实现收益与本金返还；期权权利金不是直接给个人套税率的一项股息。',
      difference: '高现金分配中可能含本金返还，不能把分配率当作投资回报率。',
      sale: '美国税务成本先减去已认定的ROC，未来卖出时需使用调整后的成本；超过成本的ROC另按资本利得处理。内地申报不能直接照搬这套成本调整。' },
    QQQ: { label: 'QQQ', name: '纳斯达克100股票ETF', frequency: '季度分配', source: 'qqq',
      income: '基金收到成分股股息，扣除费用后作现金分配，也可能分配已实现收益。它是派息型基金，持仓上涨带来的净值收益与现金股息分开。',
      difference: '2025年分类表的四笔分配均列为普通股息，资本利得分配和ROC为0；不采用QQQI的ROC口径。',
      sale: '卖出QQQ份额的价差是你实现的证券转让所得，与基金派息分开。本例分配没有ROC，不因这笔普通股息下调原持仓成本。' },
    SPY: { label: 'SPY', name: '标普500股票ETF', frequency: '季度分配', source: 'spy',
      income: '现金分配主要来自标普500成分股股息。基金份额价格的涨跌形成另一项投资结果，现金分配不会把这部分浮盈全部发给持有人。',
      difference: '2025年分类表的四笔分配均列为普通股息，资本利得分配和ROC为0。与QQQ的普通股息规则相同，持仓和派息金额不同。',
      sale: '卖出SPY份额时，按卖价减成本及可扣费用计算净收益。本例分配没有ROC，普通股息和卖出收益分别计税。' },
    KO: { label: '可口可乐 KO', name: '美国经营公司股票', frequency: '季度现金股息', source: 'ko',
      income: '公司董事会宣派现金股息，来自公司向股东的利润分配。持有的是公司股票，没有基金层面的期权策略或基金资本利得分配。',
      difference: '本例是公司公告的每股$0.51普通现金股息。与两只指数ETF的普通股息适用同一协定规则，不因“个股”另加一层税。',
      sale: '卖出KO股票的净价差属于证券转让所得。此前收到的普通现金股息不再次计入卖出收入，也不会自动提高原股票的买入成本。' }
  };
  const esc = M.escapeHtml;
  const usd = (n, digits = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const link = (key, title) => `<a class="source-link" href="${sources[key][1]}" target="_blank" rel="noopener noreferrer">${esc(title || sources[key][0])} ↗</a>`;
  const sourceLine = (...keys) => `<p class="tax-caption">${keys.map(k => link(k)).join(' ')}</p>`;
  const step = (label, value, detail, cls = '') => `<div class="tax-cash-step ${cls}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`;
  const sectionHead = (title, subtitle = '') => `<div class="tax-section-head"><h2>${title}</h2>${subtitle ? `<span class="tax-unit">${subtitle}</span>` : ''}</div>`;
  const scope = () => '<p class="tax-scope">适用：内地税收居民、非美国税务人士，个人持有美国注册的普通股票 / ETF。规则查证：2026-10-15。</p>';
  function navigation(active = 'comparison') {
    return `<div class="tabs buy-view-tabs" role="tablist" aria-label="投资渠道内容">${tabs.map(([id, title]) => `<button type="button" id="buy-tab-${id}" role="tab" aria-selected="${id === active}" aria-controls="buy-panel" tabindex="${id === active ? 0 : -1}" class="${id === active ? 'active' : ''}" data-action="buy-tab" data-value="${id}">${title}</button>`).join('')}</div>`;
  }
  function panel(active, html) {
    return `<div id="buy-panel" role="tabpanel" aria-labelledby="buy-tab-${active}">${html}</div>`;
  }
  function ordinaryExample(product) {
    const record = records[product];
    if (!record || product === 'QQQI') return null;
    // Use a cent ledger for this illustrative cash flow so displayed subtraction reconciles.
    // Issuer per-share precision is preserved in records; real CN filing is in CNY.
    const gross = Math.round(record.shares * record.distributionPerShare * 100);
    const us = Math.round(gross / 10), cnTotal = Math.round(gross / 5);
    return { gross: gross / 100, usWithheld: us / 100, cnCredit: us / 100,
      cnTopUp: (cnTotal - us) / 100, firstCash: (gross - us) / 100,
      afterTax: (gross - cnTotal) / 100, record };
  }
  function qqqiExample() {
    const gross = qqqiRecord.shares * qqqiRecord.distributionPerShare;
    const roc = qqqiRecord.shares * qqqiRecord.rocPerShare;
    // Form 8937 proves the ROC amount; it cannot prove a client's withholding or Chinese liability.
    return { gross, roc, other: gross - roc, usWithheld: null, cnTax: null, finalCash: null };
  }
  function dividendFlow(r) {
    return `<div class="tax-cash-flow" aria-label="普通股息扣缴和抵免现金流">${
      step('税前普通股息', usd(r.gross), '发行人分配 × 持有份数') +
      step('美国代扣', '−' + usd(r.usWithheld), '已落实10%协定待遇', 'tax-deduction') +
      step('券商到账', usd(r.firstCash), '可留现金或用于DRIP') +
      step('内地另行缴纳', '−' + usd(r.cnTopUp), `${usd(r.gross * .2)}税额 − ${usd(r.cnCredit)}抵免`, 'tax-deduction') +
      step('两地税后可支配', usd(r.afterTax), '合计税负20% · 抵免成立时', 'tax-result')
    }</div>`;
  }
  function rules() {
    return scope() + `<section class="tax-section card">
      ${sectionHead('普通股息：美国扣10%，内地抵免后再缴10%', '同一笔收入 · 合计20%')}
      <p class="tax-lead">内地20%是抵免前税额。已合法缴给美国的10%，满足抵免条件后从这20%中扣除。</p>
      ${dividendFlow(M.ordinaryDividendTax(1000))}
      <p class="tax-caption">例：$1,000普通股息；具备中美协定资格、扣缴方已执行10%、抵免凭证齐全。内地申报须折算人民币。${link('treaty')} ${link('china')}</p>
    </section>
    <section class="tax-section card">${sectionHead('持有这些美国证券，会遇到哪些税')}
      <div class="table-wrap" tabindex="0" aria-label="投资收入与税种"><table class="tax-rules-table"><thead><tr><th>发生的事</th><th>美国端</th><th>内地端</th><th>计税看什么</th></tr></thead><tbody>
        <tr><th scope="row">普通现金股息</th><td>一般30%；符合中美协定可降至10%，由扣缴方执行。</td><td>20%计税，按规定抵免美国税后补缴。</td><td>税前股息；不能只拿到账的90%作税基。</td></tr>
        <tr><th scope="row">卖出股票 / ETF</th><td>符合非居民资本利得豁免条件时，通常不征。</td><td>实现的净收益按20%计财产转让所得税。</td><td>卖价 − 买入成本 − 合理费用；只对收益计税。</td></tr>
        <tr><th scope="row">基金返还本金 ROC</th><td>成本范围内通常先减税务成本；可能更正先前预扣。</td><td>须确认具体分配性质、成本口径；不能直接当作免税。</td><td>最终年度分类、持仓成本及账户调账记录。</td></tr>
        <tr><th scope="row">账户 / 债券利息</th><td>部分银行存款利息、合资格组合利息可豁免；看具体收入。</td><td>境外利息通常按20%分类计税，可依法抵免。</td><td>不能把券商的所有现金收益都视为免税利息。</td></tr>
        <tr><th scope="row">交易与汇款</th><td>佣金、SEC / FINRA征费属于交易费用。</td><td>汇回自己的本金不会再收一次“汇款所得税”。</td><td>本页美国证券不因香港开户而加征香港股票印花税。</td></tr>
        <tr><th scope="row">身故后继承</th><td>可能涉及美国遗产税，另看美国所在地资产及住所。</td><td>中国内地目前未开征遗产税。</td><td>继承事项单独判断，不加进每笔交易的税后收益。</td></tr>
      </tbody></table></div>${sourceLine('law', 'irs', 'hkStamp', 'estate')}
    </section>
    <div class="tax-two-column">
      <section class="tax-section card">${sectionHead('卖出税只对净收益计')}
        <div class="tax-sale-equation"><span>卖出 ¥120,000</span><b>−</b><span>成本 ¥100,000</span><b>−</b><span>费用 ¥1,000</span><b>=</b><strong>应税 ¥19,000</strong></div>
        <p>示例内地税额：<strong>¥19,000 × 20% = ¥3,800</strong>。股息和卖出收益是不同税基；浮盈、提取本金与卖出获利也要分开。</p>
      </section>
      <section class="tax-section card">${sectionHead('账户扣税，与个人申报分两步')}
        <p><strong>美国预扣：</strong>付款 / 托管链代扣。<strong>内地申报：</strong>居民个人通常在次年3月1日至6月30日申报境外所得、申请抵免；境外账户代扣美国税不等于已完成内地申报。</p>
        <p class="tax-caption">抵免按年度、国家及凭证核定。无合格凭证、多扣但协定不允许征的税、已退回的税，不能直接当作可抵免额。${link('china')}</p>
      </section>
    </div>
    <details class="buy-method tax-details"><summary><strong>美国遗产税为什么也可能涉及内地居民</strong><span>与内地是否开征遗产税是两件事</span></summary><div class="buy-method-body tax-detail-grid">
      <section><h3>看美国资产，而非香港开户地点</h3><p>内地目前未开征遗产税，但美国可以对非美国公民、非美国遗产税住所者的美国所在地资产征税。IRS明确，美国公司股票即使托管在境外、由代名人持有，仍可能属于美国所在地资产。本页美国注册股票 / ETF应纳入核查。</p>${sourceLine('estateAssets', 'chinaEstate')}</section>
      <section><h3>$60,000是常见申报门槛</h3><p>美国所在地资产连同有关调整项目超过$60,000，通常触发706-NA申报；不是每个账户各享6万美元，也不是一超过就按40%全额征税。遗产税的住所判断与所得税居民身份不同，实际税额另按资产、扣除和适用规则确定。</p>${sourceLine('estate')}</section>
    </div></details>
    <details class="buy-method tax-details"><summary>其他适用边界：卖出豁免、国内基金与年度分类</summary><div class="buy-method-body tax-detail-grid">
      <section><h3>美国卖出豁免有前提</h3><p>普通证券资本利得通常在非居民当年在美停留少于183天、无美国业务有效关联所得等条件下免美国税；183天条款不等于完整税收居民测试。房地产、REIT、PTP等特殊规则不套用本页普通证券例子。</p>${sourceLine('irs')}</section>
      <section><h3>国内公募不重复扣个人美股税</h3><p>国内公募个人申赎差价、基金分配按相应现行优惠处理。QDII基金内部的境外税已影响净值，不再对投资者假设持有美股而扣一次。ETF的资本利得分配、利息相关分配和ROC应看年度文件，不能永远按普通股息归类。</p>${sourceLine('domestic')}</section>
    </div></details>`;
  }
  function productMatrix() {
    return `<section class="tax-section card">${sectionHead('先看分配来源，再看扣税')}
      <div class="table-wrap" tabindex="0" aria-label="四只标的收入性质比较"><table class="tax-product-table"><thead><tr><th>标的</th><th>现金从哪里来</th><th>正式文件确认的例子</th><th>对持有人的含义</th></tr></thead><tbody>
        <tr><th scope="row">QQQI<span>每月分配</span></th><td>股票＋指数期权策略的现金分配</td><td>2025-12-26分配约99.6%为ROC</td><td>现金可能是返还本金；关注重分类和成本调整。</td></tr>
        <tr><th scope="row">QQQ<span>季度分配</span></th><td>纳指100成分股股息等基金收入</td><td>2025分类表：普通股息；ROC为0</td><td>本期普通股息无ROC退款依据。</td></tr>
        <tr><th scope="row">SPY<span>季度分配</span></th><td>标普500成分股股息等基金收入</td><td>2025分类表：普通股息；ROC为0</td><td>普通股息税制与QQQ相同，派息金额不同。</td></tr>
        <tr><th scope="row">KO<span>季度现金股息</span></th><td>可口可乐公司向股东派息</td><td>2025-07-01每股派$0.51</td><td>公司股息；卖出股票净收益另算。</td></tr>
      </tbody></table></div><p class="tax-caption">这些是指定历史记录，不是今后的固定分配构成。QQQ / SPY表中“qualified dividends”是美国税表分类，不代表内地居民可套美国居民的0% / 15%税率。</p>${sourceLine('qqqi', 'qqq', 'spy', 'ko')}
    </section>`;
  }
  function example(product = 'QQQI') {
    const p = products[product], record = records[product];
    if (!p) return '';
    const controls = `<div class="segmented tax-product-picker" role="group" aria-label="选择分配实例">${Object.entries(products).map(([id, v]) => `<button type="button" data-action="buy-tax-product" data-value="${id}" class="${id === product ? 'active' : ''}" aria-pressed="${id === product}">${v.label}</button>`).join('')}</div>`;
    let distribution, reinvestment;
    if (product === 'QQQI') {
      const r = qqqiExample();
      distribution = `<div class="tax-record-split"><div class="tax-record-total"><span>每份 $0.64128519 × 1,000份</span><strong>${usd(r.gross, 5)}</strong><small>真实税前分配 · ${record.payableDate}</small></div><div class="tax-composition"><div class="tax-composition-bar" role="img" aria-label="正式分配分类：ROC 99.597452%，其他0.402548%"><span style="width:${record.rocPercent}%"></span></div><div><span><i></i>本金返还 ROC <strong>${usd(r.roc, 5)}</strong></span><span>其余分配 <strong>${usd(r.other, 5)}</strong></span></div><p>Form 8937已确认ROC比例99.597452%；剩余部分的具体税务类别不在这份表中细分。</p></div></div>
        <div class="tax-lifecycle-grid"><article><h3>美国：先看最终分类</h3><p>在美国税务成本足够抵减的前提下，ROC部分通常先减成本，不作为当期普通股息。若已按股息预扣，IBKR明确会在确认重分类后调整退款。</p></article><article><h3>内地：不能直接沿用“ROC免税”</h3><p>尚缺这笔境外ROC在内地的所得分类及成本调整确认，因此不生成“最终免税”或精确税后总额。退回的美国税也不能继续抵免。</p></article></div>
        <p class="tax-caption">使用2026-02-27签署的正式8937，非19a月度估计。实际预扣及退款金额取决于账户已扣金额、最终分类和托管方执行。${link('qqqi')} ${link('ibkrRoc')}</p>`;
      reinvestment = '本例分配是现金。若账户及QQQI支持DRIP并已启用，先用当时实际到账的税后现金再买入；之后ROC退款是否继续再投，要看账户处理。再投的新份额单独记录成本，原份额的ROC成本调整也须保留。';
    } else {
      const r = ordinaryExample(product);
      distribution = `<p class="tax-example-context"><strong>${record.payableDate} · 每${product === 'KO' ? '股' : '份'} $${record.distributionPerShare} × 1,000${product === 'KO' ? '股' : '份'}</strong><span>真实派息金额 × 假设持有量；下方按已落实10%协定及有效抵免计算。</span></p>${dividendFlow(r)}
        <p class="tax-caption">${product === 'KO' ? '公司正式季度派息公告。' : '发行人2025年最终分类表：本笔全额列为普通股息，资本利得分配、非股息分配（ROC）均为0。'}示例按美分逐步取整；内地税以等值美元说明，实际申报须按人民币核定。${link(p.source)}</p>`;
      reinvestment = `本例券商美国扣税后到账${usd(r.firstCash)}，若标的及账户支持并启用DRIP，可用这笔现金扣除再投费用后买入更多${product}。内地仍需另备${usd(r.cnTopUp)}等值人民币申报补税；券商通常不会代留这笔内地税。`;
    }
    return `<section class="tax-section card tax-example">${sectionHead('一笔分配，连同卖出和再投一起看')}${controls}
      <div class="tax-product-intro"><div><span class="tax-product-symbol">${p.label}</span><h3>${p.name}</h3><span class="tax-frequency">${p.frequency}</span></div><p>${p.income}</p></div>
      <p class="tax-product-difference">${p.difference}</p><h3 class="tax-stage-title">01 · 分配到账</h3>${distribution}
      <div class="tax-lifecycle-grid tax-lifecycle-bottom"><article><h3>02 · 卖出持仓</h3><p>${p.sale}</p><p>符合前述非居民条件时，美国通常不征普通证券卖出资本利得税；内地按实现的净收益计20%，以人民币核定。</p></article><article><h3>03 · 分红再投资 DRIP</h3><p>${reinvestment}</p><p>DRIP需要渠道支持和账户指示，${product}本身并非自动累积型产品；再投不取消原收入的纳税义务。新买份额形成新的成本记录。</p></article></div>
      ${sourceLine(product === 'QQQI' ? 'qqqiProspectus' : 'irs', 'china', 'ibkrDrip', 'futuDrip')}
    </section>`;
  }
  function channels() {
    return scope() + `<section class="tax-section card">${sectionHead('税率按身份和收入性质确定，由扣缴方执行')}
      <p class="tax-lead">W-8BEN填写真实税籍并主张有资格享受的协定。开户在香港，不会把内地税籍自动变成香港税籍；“银行 / 香港券商 / 美资券商”也不能各自指定一种统一税率。</p>
      <div class="table-wrap" tabindex="0" aria-label="具体渠道扣缴和退款政策"><table class="tax-channel-table"><thead><tr><th>渠道</th><th>普通股息怎么扣</th><th>重分类 / 退款怎么处理</th><th>已核对的官方依据</th></tr></thead><tbody>
        <tr><th scope="row">汇丰香港<span>银行证券账户 · 含Trade25</span></th><td>FAQ写明最高30%，W-8BEN可用于申请适用的协定优惠。<strong>不能据此认定所有内地Trade25账户固定扣30%。</strong></td><td>账户条款5.1.8明确：银行不承担提供税款追索服务或协助的责任。<strong>未取得Trade25自动处理QQQI的ROC退款承诺。</strong></td><td>${link('hsbc')}${link('hsbcTerms')}<span class="tax-evidence-note">FAQ＋零售投资服务条款，PDF第38—39页。</span></td></tr>
        <tr><th scope="row">富途证券（香港）<span>香港券商</span></th><td>指引区分一般30%与协定优惠；香港税收居民的普通股息为30%。内地协定资格另判，不能把“香港开户”套成30%。</td><td>公开DRIP指引确认：只用预扣税后的现金再投，且须支持碎股和DRIP。<strong>本次未取得其QQQI自动ROC退款的官方承诺。</strong></td><td>${link('futu')}${link('futuDrip')}<span class="tax-evidence-note">已确认税籍区分和再投方式；没有补写统一退款政策。</span></td></tr>
        <tr><th scope="row">浙商国际<span>香港券商 · 明确30%公告</span></th><td><strong>2025-04-07公告明确按30%预扣。</strong>公告以其非QI的托管安排说明这一执行方式。</td><td>该公告没有承诺代办协定退款或基金ROC调账。不能把30%初扣直接等同于本人最终应纳税。</td><td>${link('zheshang')}<span class="tax-evidence-note">这是该渠道公告，不能推广为所有香港券商或“非QI必然30%”的法律规则。</span></td></tr>
        <tr><th scope="row">IBKR 盈透<span>国际券商 · 账户实体分别看</span></th><td>官方按W-8BEN与适用协定处理。内地符合条件的普通股息协定税率10%；源头能否执行还受账户实体与清算链影响。</td><td><strong>官方明确：美国证券分配后续认定为ROC，会调整并退回对应的先前预扣。</strong>正常普通股息税不会全部退。</td><td>${link('ibkr')}${link('ibkrRoc')}<span class="tax-evidence-note">员工答复：2025-08-14确认ROC处理；2026-01-13提示实体及清算链限制。</span></td></tr>
      </tbody></table></div>
    </section>
    <section class="tax-section card">${sectionHead('“退税”要分清三种情况')}
      <div class="tax-three-column"><article><span class="tax-path-number">01</span><h3>协定税率更正</h3><p>有10%资格却被扣30%，先由扣缴方核查W-8BEN与账户资格；能否更正、需要哪些凭证，由具体账户处理。多扣部分不是内地自动抵免额。</p></article><article><span class="tax-path-number">02</span><h3>基金分配重分类</h3><p>例如QQQI先按股息预扣，后确认部分为ROC，再调整对应税款。QQQ / SPY本页2025记录没有ROC；不能期待同样退款。</p></article><article><span class="tax-path-number">03</span><h3>向IRS申请退税</h3><p>扣缴方未处理的多扣税，可按适用规则用1040-NR申请，通常需1042-S等证据，必要时ITIN。银行不代办，不等于法律上永远不能退。</p></article></div>${sourceLine('refund', 'ibkrForms')}
    </section>
    <details class="buy-method tax-details"><summary>实际扣30%时，内地抵免和现金会怎样</summary><div class="buy-method-body"><p>限定仍具10%协定资格且抵免凭证有效：$1,000普通股息，美国实扣$300后先到账$700；协定不应征收的多扣$200不能直接抵内地税。内地$200税额减合法可抵免$100，另缴$100，退款未到账时暂余$600。美国端成功退回$200后才回到$800。该现金占用情景不能冒充30%的最终法定税率，也不保证退款获批。</p>${sourceLine('china', 'refund')}</div></details>
    <details class="buy-method tax-details"><summary>分红再投能否自动做：看账户服务，税不会因此免掉</summary><div class="buy-method-body"><p>IBKR及富途香港均有需启用的DRIP服务，只使用扣除预扣税及适用费用后的现金；并非每个账户、每只标的均符合条件。汇丰所核对资料未给出这四只标的统一DRIP承诺，本页不默认自动再投。指数回测中的“分红再投”是研究处理，不等于实际账户已经开启此服务。</p>${sourceLine('ibkrDrip', 'futuDrip')}</div></details>`;
  }
  function render(view = 'rules', product = 'QQQI') {
    if (view === 'products') return scope() + productMatrix() + example(product);
    if (view === 'channels') return channels();
    if (view === 'rules') return rules();
    return '';
  }
  return { navigation, panel, tabs, render, example, ordinaryExample, qqqiExample, qqqiRecord, records, sources, historyFees, historyTaxPolicy };
}));
