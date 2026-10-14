(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.ChanghengInvestmentTax = factory(root.Changheng);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const sources = {
    treaty: ['中美税收协定 · 第9条', 'https://www.irs.gov/pub/irs-trty/china.pdf'],
    china: ['境外所得抵免 · 2020年第3号公告', 'https://www.chinatax.gov.cn/chinatax/n810341/n810765/c101653/202001/c5149318/content.html'],
    law: ['个人所得税法', 'https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3970366/content.html'],
    irs: ['IRS · 非居民投资所得', 'https://www.irs.gov/individuals/international-taxpayers/federal-income-tax-withholding-and-reporting-on-other-kinds-of-us-source-income-paid-to-nonresident-aliens'],
    hsbc: ['汇丰 · 投资常见问题', 'https://www.hsbc.com.hk/help/faq/investments/'],
    hsbcTerms: ['汇丰综合账户条款 · 5.1.8', 'https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/accounts/personal-integrated/terms-and-conditions-3sep.pdf'],
    ibkr: ['IBKR · 非美国人士预扣税', 'https://www.interactivebrokers.com/en/support/tax-nonus-initial.php'],
    ibkrRoc: ['IBKR · ROC重分类官方答复', 'https://www.interactivebrokers.com/campus/trading-lessons/what-kind-of-income-is-subject-to-withholding/'],
    ibkrForms: ['IBKR · 1042-S与分红报告', 'https://www.interactivebrokers.com/en/support/tax-nonus-forms.php'],
    qqqi: ['QQQI · 正式Form 8937，第3页', 'https://neosfunds.com/wp-content/uploads/NEOS-Nasdaq-100-High-Income-ETF-Form-8937-12.31.25.pdf'],
    qqqiProspectus: ['QQQI · 招募说明书', 'https://neosfunds.com/wp-content/uploads/QQQI-Prospectus.pdf'],
    qqq: ['Invesco · ETF年度税务资料', 'https://www.invesco.com/us/en/accounts/tax-center/etf-tax-center.html'],
    spy: ['SPY · 发行人资料', 'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy'],
    ko: ['可口可乐 · 现金股息记录', 'https://investors.coca-colacompany.com/stock-info/dividends'],
    refund: ['IRS · 非居民税务指南与退税', 'https://www.irs.gov/publications/p519'],
    estate: ['IRS · 非居民遗产税', 'https://www.irs.gov/businesses/small-businesses-self-employed/estate-tax-for-nonresidents-not-citizens-of-the-united-states'],
    hkStamp: ['香港税务局 · 股票印花税定义', 'https://www.ird.gov.hk/eng/pdf/sog_pn04a.pdf'],
    domestic: ['国内开放式基金税收政策', 'https://www.chinatax.gov.cn/chinatax/n810341/n810765/n812203/200207/c1208424/content.html']
  };
  const qqqiRecord = Object.freeze({ payableDate: '2025-12-26', shares: 1000,
    distributionPerShare: 0.64128519, rocPerShare: 0.63870371,
    rocPercent: 99.597452, formDate: '2026-02-27' });
  const products = {
    QQQI: { label: 'QQQI', name: '纳指高收益策略 ETF', type: '真实分配记录 · 本金返还 ROC', source: 'qqqi' },
    QQQ: { label: 'QQQ', name: '纳斯达克100 ETF', type: '普通股息情景', source: 'qqq' },
    SPY: { label: 'SPY', name: '标普500 ETF', type: '普通股息情景', source: 'spy' },
    KO: { label: '可口可乐 KO', name: '美国公司现金股息', type: '普通股息情景', source: 'ko' }
  };
  const esc = M.escapeHtml;
  const usd = value => '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const link = (key, title) => '<a class="source-link" href="' + sources[key][1] + '" target="_blank" rel="noopener noreferrer">' + esc(title || sources[key][0]) + ' ↗</a>';
  const button = (text, action, value, active) => '<button type="button" class="' + (active ? 'active' : '') + '" data-action="' + action + '" data-value="' + value + '" aria-pressed="' + active + '">' + text + '</button>';
  const step = (label, value, detail, cls = '') => '<div class="tax-cash-step ' + cls + '"><span>' + label + '</span><strong>' + value + '</strong><small>' + detail + '</small></div>';
  function qqqiExample(rate = 10) {
    if (![10, 30].includes(rate)) return null;
    const gross = qqqiRecord.shares * qqqiRecord.distributionPerShare;
    const roc = qqqiRecord.shares * qqqiRecord.rocPerShare;
    const initialWithholding = gross * rate / 100;
    const rocAdjustment = roc * rate / 100;
    // The 8937 identifies ROC, not the tax character of the remaining distribution.
    // This is cash after a hypothetical successful ROC adjustment, not final tax liability.
    const remainingWithholding = (gross - roc) * rate / 100;
    return { gross, roc, other: gross - roc, initialWithholding,
      firstCash: gross - initialWithholding, rocAdjustment, remainingWithholding,
      cashAfterRocAdjustment: gross - remainingWithholding, cnTax: null, finalCash: null };
  }
  function example(product, rate) {
    const p = products[product];
    if (!p || ![10, 30].includes(rate)) return '';
    let content;
    if (product === 'QQQI') {
      const r = qqqiExample(rate);
      content = '<p class="tax-example-context"><strong>持有1,000份，2025-12-26收到分配</strong> · 每份 $0.64128519，其中 $0.63870371 为正式确认的 ROC（99.597452%）。</p>' +
        '<div class="tax-cash-flow" aria-label="QQQI分配和ROC调账示例">' +
        step('税前分配', usd(r.gross), '这笔现金包含本金返还') +
        step('美国初次预扣', '−' + usd(r.initialWithholding), '假设整笔先按' + rate + '%扣缴', 'tax-deduction') +
        step('初次到账', usd(r.firstCash), '分配日的账户现金') +
        step('ROC部分可调回', '+' + usd(r.rocAdjustment), '假设托管方完成重分类', 'tax-adjustment') +
        step('美方调账后现金', usd(r.cashAfterRocAdjustment), '尚未扣境内可能应纳税额', 'tax-result') + '</div>' +
        '<div class="tax-example-notes"><p><strong>哪些钱能退：</strong>仅上面已认定为本金返还的部分；要求美国税务成本足以抵减。剩余 ' + usd(r.other) + ' 的分配性质未在此表细分，本例暂留原预扣 ' + usd(r.remainingWithholding) + '，最终看税单。</p>' +
        '<p class="tax-pending"><strong>境内税后金额：待确认。</strong>尚缺内地对这笔境外 ROC 的所得分类和成本调整口径，不能把美国退回的税直接当作内地免税。若整笔按股息20%计税，境内税额先按 ' + usd(r.gross * 0.2) + ' 等值人民币计算，再减合法且未退回的可抵免税。</p></div>' +
        '<p class="tax-caption">这是已披露历史分配的调账情景，不代表未来每月分配。19a月度通知属于预估；本例使用发行人2026-02-27签署的正式表。' + link('qqqi') + '</p>';
    } else {
      const r = M.ordinaryDividendTax(1000, rate, 20, 10);
      content = '<p class="tax-example-context"><strong>假设收到 $1,000.00 普通现金股息</strong> · ' + esc(p.name) + ' · 已符合协定与抵免凭证条件；不是当期派息预测。</p>' +
        '<div class="tax-cash-flow" aria-label="普通股息两地扣税示例">' +
        step('税前普通股息', usd(r.gross), '按整笔普通股息计算') +
        step('美国实际预扣', '−' + usd(r.usWithheld), '当前情景：' + rate + '%', 'tax-deduction') +
        step('初次到账', usd(r.firstCash), '美国预扣后') +
        step('境内另行补缴', '−' + usd(r.cnTopUp), '$200税额 − $100抵免', 'tax-deduction') +
        step(rate === 30 ? '多扣税未退时剩余' : '两地税后剩余', usd(r.afterTax), '境内税以等值美元展示', 'tax-result') + '</div>' +
        '<div class="tax-example-notes"><p><strong>' + (rate === 30 ? '多扣的$200另走退款：' : '正确扣掉的$100不会因为换券商就退：') + '</strong>' +
        (rate === 30 ? '本例仍具有10%协定资格，多扣的20%不能直接抵境内税。若美国端最终退回$200，税后剩余才从$600变成$800；未获批准、未到账时不算已退。' : '内地普通股息税额为$200，抵免合法美国税$100后，再补$100。香港银行、香港券商或IBKR开户，本身都不会免掉这笔境内义务。') + '</p>' +
        '<p>' + (product === 'KO' ? '可口可乐是公司股息；卖出KO的价差另算财产转让所得。' : product + '是基金分配；本例只算普通股息部分。若年度文件另列资本利得分配、利息相关分配或ROC，必须按性质重新处理，不能照搬QQQI的比例。') + '</p></div>' +
        '<p class="tax-caption">抵免按个人年度、国家及凭证核定；这里用同一笔收入说明现金流。' + link(p.source) + '</p>';
    }
    return '<section class="tax-example card" aria-labelledby="tax-example-title"><div class="tax-section-head"><div><span class="eyebrow">CASH RECEIVED</span><h2 id="tax-example-title">分红进账户，最后留下多少</h2></div><span class="tax-unit">金额：美元 · 仅本例情景</span></div>' +
      '<div class="tax-example-controls"><div class="segmented" role="group" aria-label="分红示例产品">' + Object.entries(products).map(([key, v]) => button(v.label, 'buy-tax-product', key, key === product)).join('') + '</div>' +
      '<div class="tax-rate-control"><span>初次预扣</span><div class="segmented" role="group" aria-label="示例初次预扣率">' + [10, 30].map(v => button(v + '%', 'buy-tax-rate', v, v === rate)).join('') + '</div></div></div>' + content + '</section>';
  }
  function render(product = 'QQQI', rate = 10) {
    return '<section class="tax-overview" aria-labelledby="tax-overview-title"><div class="tax-section-head"><div><span class="eyebrow">CROSS-BORDER TAX</span><h2 id="tax-overview-title">分红、卖出、继承，分别看税</h2></div><span class="tax-unit">规则核对：2026-10-15</span></div>' +
      '<p class="tax-scope">适用：中国内地税收居民、非美国税务人士，以个人名义持有美国注册的普通股票 / ETF。税籍决定协定资格，开户渠道决定具体扣缴与调账服务。</p>' +
      '<div class="tax-overview-grid">' +
      '<article><span>美国 · 普通股息预扣</span><strong>10%<small>符合协定时</small></strong><p>由付款或托管链代扣。有效W-8BEN并符合受益所有人条件可用10%；一般法定税率30%。</p></article>' +
      '<article><span>内地 · 境外股息所得</span><strong>20%<small>抵免前</small></strong><p>个人申报。合法已缴、未退回的美国税可按规则抵免；常见10%美国税后，再补10%。</p></article>' +
      '<article><span>内地 · 卖出财产所得</span><strong>20%<small>实现的净收益</small></strong><p>卖出价款减成本及合理费用后计税。不是按卖出总额计，也不以汇回内地为触发点。</p></article>' +
      '<article><span>美国 · 遗产税申报</span><strong>$60,000<small>通常申报门槛</small></strong><p>非美国公民且非美国遗产税住所者，身故时美国所在地资产超过此值，通常须申报。不是统一税率或账户免税额。</p></article></div>' +
      '<p class="tax-overview-foot">普通美股卖出价差，美国对符合条件的非居民通常不征资本利得税；内地20%的义务仍需单独考虑。' + link('treaty', '股息协定') + ' ' + link('china', '内地抵免规则') + ' ' + link('estate', '遗产税规则') + '</p></section>' +
      example(product, rate) +
      '<section class="card tax-channels" aria-labelledby="tax-channels-title"><div class="tax-section-head"><div><span class="eyebrow">WITHHOLDING & REFUNDS</span><h2 id="tax-channels-title">银行、香港券商、IBKR，差别在哪里</h2></div></div>' +
      '<div class="table-wrap" tabindex="0" aria-label="投资渠道的扣税与退税服务"><table class="tax-channel-table"><thead><tr><th>持有渠道</th><th>普通股息如何扣</th><th>QQQI等基金重分类 / 退税</th><th>开户或买入前确认</th></tr></thead><tbody>' +
      '<tr><th scope="row">香港银行<span>汇丰 Trade25</span></th><td>汇丰说明最高按30%预扣；W-8BEN可申请适用的协定优惠。<strong>未找到Trade25所有内地客户固定扣30%的官方规定。</strong></td><td>综合账户条款5.1.8说明银行不承担代办税款追索的责任。<strong>尚缺该账户自动处理ROC重分类退款的明确承诺。</strong>不代办，不等于法律上一律不能申请退税。</td><td>让银行确认本人账户的实际税率、ROC调账流程，以及能否提供本人可用的扣税凭证。' + link('hsbc', '汇丰FAQ') + ' ' + link('hsbcTerms', '账户条款') + '</td></tr>' +
      '<tr><th scope="row">香港持牌券商<span>须按具体券商及托管链核对</span></th><td>内地协定资格与香港开户是两回事。10%优惠是否在源头执行，要看税务表格及扣缴方。<strong>香港税收居民不能直接套用内地10%。</strong></td><td>不能把IBKR的调账政策推给其他香港券商。<strong>本页未取得各家券商对QQQI自动退回ROC预扣税的逐一承诺。</strong></td><td>确认W-8BEN税籍、普通分红实际预扣、年度重分类是否补退、退税收费与可提供的凭证。</td></tr>' +
      '<tr><th scope="row">国际券商<span>IBKR 盈透 · 留意账户所属实体</span></th><td>按W-8BEN和协定资格处理；符合内地协定条件的普通股息可按10%。<strong>普通股息依法扣掉的税不会全部退。</strong></td><td>IBKR官方明确：美国证券分配后续重分类为ROC时，会调整并退回相应初扣税。需等发行人最终分类；退款金额及时间以账户调账记录为准。</td><td>保存Activity Statement、Dividend Report与1042-S；核对重分类和退款。美国端退回的税，不能继续用于内地抵免。' + link('ibkr', '预扣说明') + ' ' + link('ibkrRoc', 'ROC官方答复') + '</td></tr>' +
      '</tbody></table></div><div class="tax-channel-bottom"><strong>税收协定优惠、券商年终调账、向IRS申请退税，是三条不同路径。</strong><span>30%仅是示例预扣率，不代表上表所有银行或券商的统一政策。</span></div></section>' +
      details() + '<div class="tax-history-heading"><span class="eyebrow">AFTER-TAX COMPARISON</span><h2>把税费带入历史渠道收益</h2><p>下方比较SPY / QQQ与国内基金；税率单独设置，不使用QQQI的ROC比例。</p></div>';
  }
  function details() {
    return '<details class="buy-method tax-details"><summary><strong>全部税种、申报与退税依据</strong><span>美国卖出税、印花税、利息、遗产税与办理材料</span></summary><div class="buy-method-body tax-detail-grid">' +
      '<section><h3>股息税怎么抵，什么时候申报</h3><p>内地居民境外股息通常按20%计个人所得税；按规定抵免合法已缴的境外所得税。协定不应征收的多扣税、已退回或获补偿的税不能抵免。境外所得一般在次年3月1日至6月30日申报。这里只展示单笔简化情景，实际抵免按年度、国家和凭证计算。</p><p>' + link('law') + ' ' + link('china') + '</p></section>' +
      '<section><h3>卖出获利，与账户提取现金不同</h3><p>假设人民币买入成本10万元，卖出收入12万元，另有可扣合理费用1,000元：应税收益19,000元，20%税额3,800元。税率不对本金收取；浮盈、把自己的现金转回银行也不是同一笔卖出所得。实际成本、汇率及可扣费用按申报规则确定。</p><p>美国方面：非居民在相关年度停留少于183天、无有效关联收入等适用条件下，普通证券买卖资本利得通常不征税；美国房地产权益、合伙企业等另有规则。此处183天规则不能代替税收居民身份判断。' + link('irs') + '</p></section>' +
      '<section><h3>QQQI：分配率不等于收益率</h3><p>现金分配可能包含股息、资本利得及ROC本金返还。美国税法下，ROC通常先减低持仓税务成本，超过成本的部分另按资本利得处理。不能据此推断内地也按相同规则免税。月度19a是估计；最终分类看发行人年度资料和账户税单。美国基金层面的期权60/40规则，也不是内地个人直接套用的分红税率。</p><p>' + link('qqqi') + ' ' + link('qqqiProspectus') + '</p></section>' +
      '<section><h3>如果账户扣了30%，怎么处理</h3><p>先确认本人有无10%协定资格、W-8BEN是否有效，再问扣缴方能否更正。基金ROC则核对发行人最终分类及券商调账。若无法通过扣缴方处理，可按IRS非居民退税规则评估1040-NR申报，通常需要1042-S等扣税证据，必要时申请ITIN。是否能退、证明材料与办理成本须按本人账户确认。</p><p>IBKR的官方ROC答复不等于所有税都能退。银行不提供协助，也不构成IRS必然拒绝退税的依据。' + link('refund') + ' ' + link('ibkrForms') + '</p></section>' +
      '<section><h3>美国遗产税：看资产与住所，非开户地点</h3><p>适用范围是非美国公民、非美国遗产税住所者；遗产税的住所标准与所得税税籍不同。美国公司股票及美国注册基金份额，放在香港银行或券商也可能属于美国所在地资产。通常超过6万美元触发706-NA申报；最终税额取决于全部应税遗产、扣除及适用规则，不能理解为超过门槛即按一个固定比例收税。</p><p>' + link('estate') + '</p></section>' +
      '<section><h3>还有哪些税费，哪些不重复加</h3><p><strong>利息：</strong>美国某些银行存款利息、符合条件的组合利息对非居民可免美国税；内地境外利息通常仍按20%分类处理。不能把所有券商现金收益都一律判作免税。' + link('irs', 'IRS利息规则') + '</p><p><strong>印花税与交易收费：</strong>本例四只美国证券，不因在香港开户就变成香港股票印花税标的。SEC、FINRA等交易征费是另列费用，不是20%的所得税。' + link('hkStamp', '印花税范围') + '</p><p><strong>国内公募 / QDII：</strong>个人基金分配、申赎差价按现行优惠口径处理；基金内部境外税已进入净值，不再当作个人美股预扣税扣一次。' + link('domestic', '国内基金税收依据') + '</p></section>' +
      '</div></details>';
  }
  return { render, example, qqqiExample, qqqiRecord, sources };
}));
