(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./investment-tax.js'));
  else root.ChanghengEtfDistributions = factory(root.Changheng, root.ChanghengInvestmentTax);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (M, Tax) {
  'use strict';
  const esc = M.escapeHtml;
  const usd = (n, digits = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const amount = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  const link = (url, title) => `<a class="source-link" target="_blank" rel="noopener noreferrer" href="${esc(url)}">${esc(title)} ↗</a>`;
  const source = key => link(Tax.sources[key][1], Tax.sources[key][0]);
  const sourceLine = (...keys) => `<p class="etf-div-sources">${keys.map(source).join(' ')}</p>`;
  const checkedAt = '2026-10-16';
  const brokers = Object.freeze([
    { id: 'ibkr', name: 'IBKR 盈透', status: '支持符合条件的标的',
      enable: 'Client Portal → Settings → Trading → Dividend Election；可选择现金或再投，持仓列表可覆盖默认设置。',
      conditions: '该账户实体及标的须符合DRIP条件；碎股另需权限。按通常交易佣金收费，资金或保证金不足可能不执行。',
      withholding: '按W-8BEN、收入分类和适用协定扣缴。符合内地协定的普通股息可适用10%，不是所有分配一律10%。',
      correction: '官方确认美国分配改列ROC后退回相应预扣；也以SGOV说明年度分类后调整误扣税。正常普通股息税不会全部退。',
      sources: ['ibkrDrip', 'ibkr', 'ibkrRoc'] },
    { id: 'hsbc', name: '汇丰香港 Trade25', status: '未确认美股ETF自动再投服务',
      enable: '可以收取现金；本次未找到Trade25对美股ETF提供DRIP的公开承诺。需再投时可手动下单。',
      conditions: '发行人提供的“现金或以股代息”公司行动，不能当作这些ETF均有自动再投服务的证据。手动买入按账户收费。',
      withholding: 'FAQ写明最高30%，并说明W-8BEN可申请适用协定优惠；实际按托管机构指示扣缴，不能断言Trade25统一扣30%。',
      correction: '条款5.1.8不承诺提供税款追索服务。未取得ETF的ROC或QII自动退款承诺；这不等于法律上永远无法申请退款。',
      sources: ['hsbc', 'hsbcTerms'] },
    { id: 'futu', name: '富途香港', status: '提供DRIP，逐只核对资格',
      enable: '富途App → 账户 → 更多 → 交易 → 股息再投；可选现金或开启符合条件标的的再投。',
      conditions: '须有综合账户及碎股权限，标的须在可再投名单；按非整股订单收费说明执行，不保证本页每只ETF都支持。',
      withholding: '官方明确只使用预扣税后的现金再投。税籍、协定资格与分配分类决定扣税，不因香港开户自动成为30%。',
      correction: '未找到对这些ETF自动办理ROC / QII重分类退款的公开承诺。开启DRIP不会额外取得退税资格。',
      sources: ['futuDrip', 'futu'] }
  ]);

  function taxCase(symbol, data) {
    if (data.qiiEvidence?.products[symbol]) return 'qii';
    if (symbol === 'QQQI') return 'roc';
    if (['QQQ', 'SPY'].includes(symbol)) return 'ordinary-confirmed';
    return 'classification-missing';
  }

  // Fixed, expressly conditional examples. Choosing cash/DRIP never changes tax.
  // A broker's current withholding execution is not an investor-selected input.
  function cashChoice(kind, choice) {
    if (!['ordinary', 'qii'].includes(kind) || !['cash', 'drip'].includes(choice)) return null;
    const r = kind === 'ordinary' ? M.ordinaryDividendTax(1000) : { gross: 1000, usWithheld: 0, cnTopUp: 200, firstCash: 1000, afterTax: 800 };
    return { gross: r.gross, usWithheld: r.usWithheld, cnTax: r.cnTopUp,
      availableAtPayment: r.firstCash, afterBothTaxes: r.afterTax,
      cashAtPayment: choice === 'cash' ? r.firstCash : 0,
      reinvestBeforeFees: choice === 'drip' ? r.firstCash : 0 };
  }

  function history(item, selectedYear) {
    const years = [...new Set(item.records.map(r => r.exDate.slice(0, 4)))];
    const year = years.includes(String(selectedYear)) ? String(selectedYear) : years[0];
    const rows = item.records.filter(r => r.exDate.startsWith(year));
    return `<div class="etf-div-history-table table-wrap" tabindex="0" aria-label="${esc(year || '')}年现金分配记录"><table><thead><tr><th>除息日</th><th>每份现金 / 美元</th><th>金额口径</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.exDate)}</td><td>${amount(r.perShare)}</td><td>${r.subsequentSplit ? '此后有拆分 · 供应商调整值' : '供应商现金记录'}</td></tr>`).join('') || '<tr><td colspan="3">此覆盖区间未记录正现金分配，不能据此承诺以后不分红。</td></tr>'}</tbody></table></div>`;
  }

  function historySection(symbol, item) {
    const years = [...new Set(item.records.map(r => r.exDate.slice(0, 4)))];
    return `<details class="etf-div-history"><summary>查看历史现金分配 <span>${item.records.length}笔${item.records.length ? ' · 最早除息 ' + esc(item.records[item.records.length - 1].exDate) : ''}</span></summary>
      <div class="etf-div-history-head"><p>除息日决定分红归属，<strong>不是现金到账日</strong>。</p><label>年份<select data-etf-history="${esc(symbol)}" aria-label="现金分配年份">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></label></div>
      <div id="etf-div-history-rows">${history(item)}</div>
      <p class="etf-div-caption">来源未提供支付日；实际到账查看发行人公告和账户派息单。行情源金额可能取整，历史金额可能按后续拆分调整，不能据此反推当年账户到账金额。</p>
      <p class="etf-div-sources">${link(item.sourceUrl, '逐笔现金记录来源')} ${link(item.issuerUrl, '发行人产品资料')}</p></details>`;
  }

  function classification(product, data) {
    const kind = taxCase(product.symbol, data);
    if (kind === 'qii') {
      const evidence = data.qiiEvidence, q = evidence.products[product.symbol], last = q.lastPayment;
      return `<div class="etf-div-classification"><strong>这只美债ETF：先看利息相关分配 QII</strong><p>发行人${evidence.taxYear}年最终文件中，${q.positivePayments}笔正金额收入分配的QII比例均为100%，符合条件的非美国人士可适用美国预扣豁免。最近一笔文件记录：${esc(last.payableDate)}支付，每份${amount(last.qiiPerShare)}。</p><p>这是${evidence.taxYear}年分类，<strong>不证明2026年每笔均免美国税</strong>；托管方可能先扣、再按最终分类调整。内地的境外所得申报仍需单独处理。</p><p class="etf-div-sources">${link(evidence.sourceUrl, 'iShares 2025 QII最终分类')} ${source('refund')}</p></div>`;
    }
    if (kind === 'roc') {
      const record = Tax.qqqiRecord;
      return `<div class="etf-div-classification"><strong>QQQI的现金，可能包含返还本金 ROC</strong><p>正式Form 8937确认：${record.payableDate}每份分配${amount(record.distributionPerShare)}，其中${amount(record.rocPerShare)}为ROC，占99.60%。这不是99.60%的投资收益率，也不能把每月分配都当普通股息。</p><p>美国端在成本范围内通常先减税务成本，已预扣部分可能更正。<strong>尚缺这笔ROC在内地的所得分类和成本调整确认</strong>，因此不填“最终免税”金额；再投资也不能补齐这项税务证据。</p>${sourceLine('qqqi', 'ibkrRoc')}</div>`;
    }
    if (kind === 'ordinary-confirmed') {
      return `<div class="etf-div-classification"><strong>${esc(product.symbol)}：2025年最终表列为普通股息</strong><p>发行人2025年分类表所列4笔分配均为普通股息，ROC为0。以下用普通股息说明现金与再投的差别；2026年最新分配仍须等对应最终分类，不预先承诺ROC退款。</p>${sourceLine(product.symbol.toLowerCase())}</div>`;
    }
    return `<div class="etf-div-classification"><strong>已收录现金记录，尚缺${esc(product.symbol)}的最终年度税务分类</strong><p>${product.category === '期权收益' ? '期权收益基金的分配可能包含普通股息、资本利得及ROC；' : '现金分配可能包含普通股息及其他税务类别；'}发行频率不能证明税务性质。以下是普通股息规则示例，<strong>不作为这只ETF最新一笔的税款报价</strong>。</p><p class="etf-div-sources">${link(product.identityUrl || data.products[product.symbol]?.issuerUrl, '发行人资料')}</p></div>`;
  }

  function choices(product, data) {
    const kind = taxCase(product.symbol, data);
    if (kind === 'roc') return `<section class="etf-div-section"><h3>选现金还是自动再投，原分配的分类都不改变</h3><div class="etf-div-choices"><article><span>领取现金</span><strong>保留实际净到账现金</strong><p>先看派息单的预扣，之后核对年度重分类、退款和原份额成本调整。</p></article><article><span>自动再投 DRIP</span><strong>用实际净到账额再买QQQI</strong><p>须渠道和标的支持。新份额记新成本；后续ROC退款是否继续再投，另看账户处理。</p></article></div><p class="etf-div-caption">两种选择均需核对内地申报；不会因为现金已变成份额而自动免税或递延。</p></section>`;
    const qii = kind === 'qii';
    const cash = cashChoice(qii ? 'qii' : 'ordinary', 'cash'), drip = cashChoice(qii ? 'qii' : 'ordinary', 'drip');
    return `<section class="etf-div-section"><div class="etf-div-section-head"><h3>同一笔分配：现金与再投怎样处理</h3><span>固定示例 · 税前$1,000</span></div>
      <p class="etf-div-caption">${qii ? '假设整笔已确认为QII、满足非居民豁免且扣缴方已执行，美国税为0；内地按境外利息 / 股息20%计税。' : '假设整笔为普通股息、具备中美协定资格且已执行10%预扣、抵免凭证有效。' }以下不含再投交易费用，内地税以等值美元说明，申报按人民币核定。</p>
      <div class="etf-div-equation"><span>税前 <b>${usd(cash.gross, 0)}</b></span><i>−</i><span>美国预扣 <b>${usd(cash.usWithheld, 0)}</b></span><i>→</i><span>账户先收 <b>${usd(cash.availableAtPayment, 0)}</b></span><i>；</i><span>内地另缴 <b>${usd(cash.cnTax, 0)}</b></span></div>
      <div class="etf-div-choices"><article><span>领取现金</span><strong>${usd(cash.availableAtPayment, 0)}留在账户</strong><p>预留内地税${usd(cash.cnTax, 0)}后，可支配${usd(cash.afterBothTaxes, 0)}。可以提取、留存，或自行决定何时买入。</p></article><article><span>自动再投 DRIP</span><strong>${usd(drip.reinvestBeforeFees, 0)}扣再投费用后买入</strong><p><b>仍需另备${usd(drip.cnTax, 0)}申报内地税。</b>券商不会因再投自动替你预留这笔税，新份额另记买入成本。</p></article></div>
      <p class="etf-div-takeaway">再投改变现金去向，不改变这笔收入的应税性质。没有“开启DRIP就少交一次分红税”。</p>${sourceLine('treaty', 'china', 'ibkrDrip', 'futuDrip')}</section>`;
  }

  function brokerComparison() {
    return `<section class="etf-div-section"><div class="etf-div-section-head"><h3>三个账户，分红怎样收、怎样再投</h3><span>官方规则核对 ${checkedAt}</span></div>
      <p class="etf-div-caption">适用内地税收居民、非美国税务人士。你可选择现金去向，预扣税率由扣缴方依据税籍、协定和收入性质执行。</p>
      <div class="table-wrap etf-div-brokers" tabindex="0" aria-label="IBKR、汇丰Trade25、富途香港分红服务比较"><table><thead><tr><th>账户</th><th>现金 / 自动再投</th><th>美国预扣与退款</th></tr></thead><tbody>${brokers.map(b => `<tr><th scope="row">${b.name}<small>${b.status}</small></th><td><p>${b.enable}</p><p>${b.conditions}</p></td><td><p>${b.withholding}</p><p>${b.correction}</p><div class="etf-div-sources">${b.sources.map(source).join(' ')}</div></td></tr>`).join('')}</tbody></table></div>
      <p class="etf-div-caption">服务可用不代表每只ETF都在DRIP名单；在相应账户找到该证券的可选状态后再启用。汇丰的公开资料缺的是美股ETF自动再投及重分类退款承诺，并非缺现金派息功能。</p></section>`;
  }

  function render(product, data) {
    const item = data?.products?.[product.symbol];
    if (!item) return '<p class="notice warn">缺这只ETF的逐笔现金分配记录。</p>';
    const latest = item.records[0];
    return `<div class="etf-div-detail"><div class="etf-div-summary"><div><span>现金分配</span><strong>${latest ? '有现金分配' : '此区间未记录现金'}</strong><small>${esc(item.frequency)}计划 · 不保证每期都有或金额固定</small></div><div><span>最近记录 · 每份税前（行情源）</span><strong>${latest ? amount(latest.perShare) : '—'}</strong><small>除息日 ${esc(latest?.exDate || '无记录')}${latest?.subsequentSplit ? ' · 后续拆分调整值' : ''}</small></div><div><span>记录覆盖至</span><strong>${esc(item.through)}</strong><small>分配金额不是收益率</small></div></div>
      ${item.status === 'stale' ? `<p class="notice warn">${esc(item.missingEvidence)}</p>` : ''}
      <p class="etf-div-caption">基金发现金，账户决定是否用净到账额再买入。页面历史回报假设分红再投，不表示你的账户已启用DRIP。</p>
      ${historySection(product.symbol, item)}${classification(product, data)}${choices(product, data)}${brokerComparison()}
      <details class="etf-div-footnote"><summary>卖出新份额、申报与来源口径</summary><p>再投形成一次新买入，保存成交价、份数与费用。普通股息不重复计为卖出收益；卖出时按售价减成本及合理费用核算净收益。符合非居民豁免条件的普通证券卖出，美国通常不征资本利得税，内地财产转让所得按20%核算。ROC可能另调原持仓成本，不把美国成本表直接当作内地结论。</p><p>内地境外所得通常在次年3月1日至6月30日申报；已退还或协定不应征的美国税不能继续抵免。保留现金分配、预扣、更正、成交和汇率记录。</p><p>现金表来自Yahoo事件记录，逐笔保留供应商金额，不用复权价格倒算。未提供支付日、客户实际预扣或逐只DRIP资格，均未补造。分配分类以注明年度的发行人最终文件为证，不把19a月度预估当最终税务结论。</p>${sourceLine('irs', 'china')}</details></div>`;
  }
  return { render, history, brokerComparison, brokers, taxCase, cashChoice, checkedAt };
}));
