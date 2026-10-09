(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel;
  const STORE = 'changheng.money-flow.v2';
  const defaults = { budgetCny: '100000', currency: 'USD', plan: 'recommended', bank: '', exitBank: '',
    months: '12', balanceHkd: '0', profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1',
    intermediaryCny: '', returnExtraCny: '', tradeFeeUsd: '', depositHkd: '', inwardHkd: '', returnWireHkd: '', monthlyHkd: '',
    usdCny: '', usdHkd: '', usdCnh: '', entryPrice: '', exitPrice: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  let state = { ...defaults, ...stored };
  let H, timer;
  const esc = value => H.esc(value), num = (value, digits = 2) => value == null ? '—' : H.money(value, digits);
  const action = (label, act, extra = '', cls = 'btn') => H.action(label, 'money-flow-' + act, cls, extra);
  const source = key => D.sources[key] ? '<a class="source-link" target="_blank" rel="noopener noreferrer" href="' + esc(D.sources[key].url) + '">' + esc(D.sources[key].name) + ' ↗</a>' : '';
  const sourceList = keys => keys.map(source).join('');
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {} };
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const result = () => M.journeyPlans({ ...state, date: today() }, D, window.MONEY_FLOW_QUOTES || {});
  const bankName = id => D.mainlandBanks.find(bank => bank.id === id)?.name || id;
  const feeValue = (r, label) => r?.rows.find(row => row.label === label)?.cny;
  const feeText = (r, label) => { const v = feeValue(r, label); return v == null ? '费用未报价' : num(v) + ' CNY'; };
  function field(key, label, unit = '', placeholder = '') {
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input type="text" inputmode="decimal" data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div></label>';
  }
  function select(key, label, values) {
    return '<label class="flow-field"><span>' + esc(label) + '</span><select data-money-select="' + key + '" aria-label="' + esc(label) + '">' + values.map(([id, text]) => '<option value="' + esc(id) + '"' + (state[key] === id ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
  }
  const icons = {
    bank: '<path d="M3 9h18M5 9v10m5-10v10m4-10v10m5-10v10M3 21h18M2 7l10-5 10 5"/>',
    exchange: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    broker: '<path d="M4 3v17h17M7 14l4-4 4 3 6-9"/>',
    spend: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18m-13 6h3m4 0h2"/>'
  };
  function node(key, number, title, sub, value, currency, cls = '') {
    return '<button type="button" class="flow-stop ' + cls + '" data-action="money-flow-detail" data-value="' + key + '"><span class="flow-stop-head"><span>' + number + '</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[key] || icons.bank) + '</svg></span><strong>' + esc(title) + '</strong><span class="flow-stop-sub">' + esc(sub) + '</span><span class="flow-stop-value num">' + num(value) + '<small>' + esc(currency) + '</small></span></button>';
  }
  function arrow(label, cost, cls = '') {
    return '<div class="flow-connector ' + cls + '"><span>' + esc(label) + '</span><svg viewBox="0 0 90 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 8h82m-7-5 7 5-7 5"/></svg><small>' + esc(cost) + '</small></div>';
  }
  function diagram(data) {
    const r = data.selected, blocked = data.blocked;
    const currency = state.currency;
    const bank = r?.bank.name || '香港同名银行';
    const sourceTitle = { USD: '已有美元', CNH: '已有境外人民币', HKD: '已有港币', CNY: '内地人民币' }[currency];
    const brokerSub = currency === 'USD' ? 'IBKR · 美元原币入金' : r?.fxMode === 'auto' ? 'IBKR · 买入时自动换美元' : r?.fxMode === 'bank' ? '中银香港先换美元 · IBKR' : 'IBKR · 券商换美元';
    const fxCost = currency === 'USD' ? '无需换汇 · 0费用' : r?.fxMode === 'bank' ? '银行报价已含换汇价差' : feeText(r, '换汇佣金／自动加价');
    const exitFee = feeText(r, '回大陆汇出费');
    const remitUsd = r ? r.bankUsd - (feeValue(r, '回大陆汇出费') || 0) / r.refs.USD : null;
    const settledCny = remitUsd == null ? null : remitUsd * r.exitPrice - (M.number(state.returnExtraCny) || 0);
    return '<div class="flow-map-head"><div><h2>' + (state.bank ? '所选银行方案' : state.plan === 'minimum' ? '当前最低费用方案' : '推荐方案') + '</h2><span>' + (r ? esc(bank) + ' · ' + bankName(r.exitBank) + '结汇' : '买美股 → 人民币消费') + '</span></div>' +
      '<div class="segmented" aria-label="方案选择">' + [['recommended', '默认推荐'], ['minimum', '最低费用']].map(([id, text]) => action(text, 'set', 'data-field="plan" data-value="' + id + '" aria-pressed="' + (state.plan === id && !state.bank) + '"', state.plan === id && !state.bank ? 'active' : '')).join('') + '</div></div>' +
      '<div class="flow-inlet ' + (blocked ? 'blocked' : '') + '">' + action('内地 CNY <span>→ 出境用途核验</span> <b>⊣</b>', 'detail', 'data-value="mainland"', 'flow-inlet-link') + '<span>' + (blocked ? '便利化购汇不能用于美股' : '示例：已有合法境外资金及可用券商账户') + '</span>' + (blocked ? '<a href="#buy-location">境内投资渠道 ↗</a>' : '') + '</div>' +
      '<div class="flow-route ' + (blocked ? 'is-blocked' : '') + '" role="group" aria-label="完整资金流转图">' +
      node('bank', '01', sourceTitle, blocked ? '内地本人账户 · 用途待核验' : bank, blocked ? M.number(state.budgetCny) : r?.sourceAmount, currency, 'start') +
      arrow(blocked ? '投资用途不支持' : currency === 'USD' ? 'USD本地转账' : r?.fxMode === 'bank' ? '银行换USD再入金' : currency + '同币种入金', blocked ? '先核验合法投资渠道' : feeText(r, '本地入金费用'), 'entry') +
      node('exchange', '02', '美元入金', brokerSub, r?.investUsd, 'USD', 'funding') + arrow('买入美股', fxCost, 'invest') +
      node('broker', '03', '美股卖出', M.number(state.profitUsd) === 0 ? '按买卖持平测算' : '盈亏 ' + num(M.number(state.profitUsd)) + ' USD', r?.proceeds, 'USD', 'sale') +
      '<button type="button" class="flow-turn" data-action="money-flow-detail" data-value="tax"><svg viewBox="0 0 20 45" aria-hidden="true"><path d="M10 1v36m-5-7 5 7 5-7"/></svg><div><span>结算 · 预留税款 · 同名出金</span><small>税款 ' + num(r?.taxCny) + ' CNY · 出金＋汇入 ' + num(r ? feeValue(r, '券商出金费') + feeValue(r, '香港银行汇入费') : null) + ' CNY</small></div></button>' +
      node('bank', '04', '返回香港银行', bank, r?.bankUsd, 'USD', 'return') + arrow('USD汇回内地', '汇出 ' + exitFee, 'repatriate reverse') +
      node('exchange', '05', '内地结汇', r ? bankName(r.exitBank) + ' · 现汇买入价' : '银行审核资金来源', settledCny, 'CNY', 'settle') +
      arrow(r ? '1 USD = ' + num(r.exitPrice, 4) + ' CNY' : '美元换成人民币', '只在消费前换回人民币', 'consume reverse') +
      node('spend', '06', '人民币消费', '税款预留后的可用资金', r?.net, 'CNY', 'destination') + '</div>';
  }
  function summary(data) {
    const r = data.selected;
    if (!r) return '<div class="flow-message" role="status">' + esc(data.error) + '</div>';
    return '<div class="flow-totals" aria-live="polite"><div><span>' + (r.complete ? '预计人民币到账' : '人民币到账上限') + '</span><strong class="num">' + num(r.net) + '<small>CNY</small></strong></div><div><span>已知损耗</span><strong class="num">' + num(r.costCny) + '<small>CNY · ' + num(r.costCny / r.budgetCny * 100) + '%</small></strong></div><div><span>税款估算</span><strong class="num">' + num(r.taxCny) + '<small>CNY</small></strong></div></div>' +
      '<div class="flow-caption"><span>' + (r.missing.length ? '未含：' + r.missing.map(esc).join('、') + '。' : '') + (state.currency !== 'USD' ? '券商汇率按参考价估算。' : '') + '</span><span>' + esc(r.exitAsOf) + ' · 参考牌价</span></div>';
  }
  function comparison(data) {
    if (!data.plans.length) return '<p class="flow-message">' + esc(data.error) + '</p>';
    const r = data.selected;
    return '<div class="table-wrap"><table class="flow-bank-table"><thead><tr><th>香港出入金银行</th><th>入金 / CNY</th><th>汇入＋汇回 / CNY</th><th>账户费 / CNY</th><th>已知损耗 / CNY</th><th></th></tr></thead><tbody>' + data.plans.map(row => '<tr class="' + (row.bank.id === r.bank.id ? 'selected' : '') + '"><td><strong>' + esc(row.bank.name) + '</strong><small>' + (row.bank.thresholdHkd ? '免月费需另留' + num(row.bank.thresholdHkd, 0) + ' HKD资产' : '无最低资产 / 月费') + (row.bank.id === 'za' && today() < '2026-11-01' ? ' · SWIFT免收至10月底' : '') + '</small></td><td class="num">' + num(feeValue(row, '本地入金费用')) + '</td><td class="num">' + num(feeValue(row, '香港银行汇入费') + feeValue(row, '回大陆汇出费')) + '</td><td class="num">' + num(feeValue(row, '账户月费')) + '</td><td class="num">' + num(row.costCny) + '</td><td>' + action(row.bank.id === r.bank.id ? '已选' : '选用', 'bank', 'data-value="' + row.bank.id + '"') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="flow-comparison-foot"><div class="flow-exit-quotes">' + data.mainland.map(q => action(bankName(q.id) + '结汇 <b>' + num(q.buy, 4) + '</b>', 'set', 'data-field="exitBank" data-value="' + q.id + '"', 'btn' + (q.id === r.exitBank ? ' active' : ''))).join('') + action('自动择优', 'set', 'data-field="exitBank" data-value=""', 'btn') + '</div><span>限已收录的同名、同银行往返方案；按已知费用比较。</span></div>' +
      '<div class="flow-fx-comparison">' + fxComparison(data) + '</div>';
  }
  function fxComparison(data) {
    const r = data.selected;
    if (state.currency === 'USD') return '<span>已有USD无需换汇；不绕道HKD。</span>';
    const values = ['manual', 'auto'].map(mode => {
      const q = M.brokerFx(r.sourceAmount, state.currency, M.number(state.entryPrice) ?? data.refs.USD / data.refs[state.currency], mode, D.broker);
      return '<span>' + (mode === 'manual' ? '券商换汇：0.002%，最低2 USD' : '自动换汇：加价0.03%') + '<b>' + num(q?.usd) + ' USD</b></span>';
    });
    const q = window.MONEY_FLOW_QUOTES?.offshoreUsd?.bochk?.quotes[state.currency];
    if (q) values.push('<span>中银香港换汇：每USD ' + num(q.askPerUsd, 5) + ' ' + state.currency + '<b>' + num(r.sourceAmount / q.askPerUsd) + ' USD</b></span>');
    return values.join('') + '<small>此处单比换汇，不含各行入金费；完整方案已自动综合计算。</small>';
  }
  function parameters() {
    return '<div class="flow-adjustments"><div class="flow-parameter-grid">' + field('profitUsd', '卖出盈亏（交易费前）', 'USD') + field('tradeFeeUsd', '买卖交易费合计', 'USD', '未报价') + field('months', '账户使用月数', '月') + field('balanceHkd', '另留香港银行资产', 'HKD') + '</div><h3>税款与汇款</h3><div class="flow-parameter-grid">' + field('taxRate', '境外财产转让所得税率', '%') + field('taxableCny', '已核算人民币应税所得', 'CNY', '自动按净利润估算') + field('creditCny', '可抵免境外税额', 'CNY') + field('withdrawalIndex', '本月第几次券商出金', '次') + field('intermediaryCny', '券商出金中转费', 'CNY', '未知；免收填0') + field('returnExtraCny', '回内地中转 / 收款费', 'CNY', '未知；免收填0') + '</div><h3>成交报价与银行优惠</h3><div class="flow-parameter-grid">' + field('entryPrice', '券商换汇价：每1USD', state.currency === 'USD' ? 'USD' : state.currency, '自动读取参考价') + field('exitPrice', '内地结汇价：每1USD', 'CNY', '自动比较中行 / 招行') + field('depositHkd', '本地入金费', 'HKD', '所选银行公开标准') + field('inwardHkd', '香港银行汇入费', 'HKD', '所选银行公开标准') + field('returnWireHkd', '回内地汇出费', 'HKD', '所选银行公开标准') + field('monthlyHkd', '账户月费', 'HKD', '所选银行公开标准') + '</div><p class="flow-adjust-note">自填银行优惠将固定当前银行。未核算应税所得时，按净利润、汇率不变估税。</p><h3>额外成本与参考汇率</h3><div class="flow-parameter-grid">' + field('openingCny', '额外开户 / 赴港支出', 'CNY') + field('extraCapitalCny', '额外占用资产', 'CNY') + field('annualGapPct', '占用资产年收益差', '%') + field('usdCny', 'USD / CNY参照', '', '自动读取牌价中间值') + field('usdHkd', 'USD / HKD参照', '', '自动读取牌价中间值') + field('usdCnh', 'USD / CNH参照', '', '自动读取牌价中间值') + '</div><div class="flow-adjust-actions">' + action('恢复自动方案', 'reset') + action('费用明细', 'detail', 'data-value="cost"') + '</div></div>';
  }
  function view(helpers) {
    H = helpers;
    const data = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '美元买美股，人民币消费。', action('依据与条件', 'detail', 'data-value="sources"')) + '<div class="page-money-flow"><div class="flow-controls">' + field('budgetCny', '资金等值', 'CNY') + select('currency', '当前资金', [['USD', '已有境外美元 USD'], ['CNH', '已有境外人民币 CNH'], ['HKD', '已有境外港币 HKD'], ['CNY', '仅有内地人民币 CNY']]) + '<span>银行与换汇方式自动择优</span></div><section class="card flow-map-card"><div id="flow-live-diagram">' + diagram(data) + '</div><div id="flow-live-summary">' + summary(data) + '</div></section><details class="card flow-disclosure"><summary>银行与换汇对比</summary><div id="flow-live-comparison">' + comparison(data) + '</div></details><details class="card flow-disclosure"><summary>调整条件</summary>' + parameters() + '</details></div>';
  }
  function detail(key) {
    const data = result(), r = data.selected;
    const descriptions = {
      mainland: ['内地人民币如何进入这张图', '<p>不要求一律在内地换汇，也不需要先换港币。关键是资金来源及出境用途获准；转到同名香港账户不改变用途限制。</p><p>大陆个人便利化购汇不能用于境外证券投资。跨境人民币也分别受经常项目与资本项目规则约束，并不存在持大陆身份证就能自由把人民币汇往香港券商的通道。跨境理财通的闭环人民币账户不能转入普通券商。</p><p>图中默认为已有合法境外资金及合资格券商账户的费用示例；只有内地人民币时先核验合法投资渠道，不输出虚构的美股到账金额。</p>', ['safe', 'pbcRmb', 'scCnTerms', 'csrc']],
      bank: ['香港同名银行', '<p>默认推荐在已收录银行中，选择无最低资产、无月费且不依赖短期汇出优惠的低成本往返方案。当前最低费用则计入当日有效优惠；不为免小额费用要求维持50万元资产。</p><p>USD按券商当次收款指示使用本地CHATS/银行转账；CNH和HKD可按指示同币种转账。券商出金采用银行汇款费，不能套用内地中行同名汇入豁免。账户姓名、资金来源及开户资格均需银行与券商确认。</p><p>ZA的SWIFT免收费于2026年10月底结束；11月1日起按70港元计算。汇丰One的新开非香港身份证账户，另留资产不足1万港元时按100港元/月计算。</p>', ['hangHk', 'hangOpen', 'scHk', 'hsbcHk', 'bochkAccount', 'zaNov', 'ibFunding']],
      exchange: ['在哪里换汇，为何无需港币', '<p>买美股最终需要USD，消费最终需要CNY。已有合法境外CNH可按券商支持的入金指示直接入金，再换USD；无需先CNH→HKD→USD。已有USD直接原币入金。</p><p>手动换汇0.002%、最低2 USD；自动换汇加价0.03%，不额外再收佣金。页面按金额自动比较两者，小额可能自动换汇更便宜。仅在获得该银行美元卖价时计算银行先换USD的方案。</p><p>内地结汇采用现汇买入价，自动比较中行和招行；境外CNH/HKD参考中银香港美元买卖价的中间值。它不是IBKR可执行报价，实际下单价格可在调整条件中覆盖。</p>', ['ibCnh', 'ibFx', 'bochkUsdFx', 'bocFx', 'cmbFx']],
      broker: ['美股投资与出金', '<p>本页计算资金流转费用，不预测股票收益。默认买卖持平；填写卖出盈亏和交易费后重新计算。盈亏输入为交易费前，费用合计单独扣除。</p><p>在IBKR生成当次入金通知，并使用本人银行账户。卖出结算、入金提现等待期及账户使用资格按实际券商规则；不可把券商当作单纯的汇款换汇工具。已收录费率限IBKR直接客户，不适用于转介券商加价。</p>', ['ibFunding', 'ibFees', 'csrc']],
      tax: ['人民币税款估算', '<p>中国大陆税收居民的境外财产转让所得通常适用20%税率，以人民币收入减成本和允许费用核算；不是对本金或整笔提现征税。境外股息等所得另行核算，可抵免税额须有相应依据。</p><p>未填已核算应税所得时，仅按正的净交易利润×参照USD/CNY估算，假设买入、卖出汇率相同；不能替代人民币成本、汇率变化及允许费用的真实税务核算。填入已核算所得后优先使用该金额；亏损不产生负税款。</p>', ['tax']],
      spend: ['USD回内地，再用人民币消费', '<p>推荐以USD原币出金至香港同名银行，再按获银行审核的路径汇回本人内地外汇账户，最后按现汇买入价结汇成CNY。这样不额外经过HKD，不把香港卡片外币签账费算在内地人民币消费上。</p><p>保留银行与券商资金来源、交易和税务凭证；汇回与结汇分别遵守用途审核、额度及材料规则。不同银行的中转、收款费用与客户报价可能不同，未报价部分使金额成为到账上限。香港居民人民币汇款安排及跨境支付通资格不能直接套给大陆身份证客户。</p>', ['remit', 'safe', 'paymentHsbc', 'ibFunding']],
      cost: ['本次费用明细', r ? '<div class="flow-cost-detail">' + r.rows.map(row => '<div><span>' + esc(row.label) + '</span><b>' + (row.cny == null ? '未报价' : num(row.cny) + ' CNY') + '</b></div>').join('') + '<div><span>额外开户及资产机会成本</span><b>' + num(r.extraCny) + ' CNY</b></div><div><span>税款（独立列示）</span><b>' + num(r.taxCny) + ' CNY</b></div></div>' : '<p>' + esc(data.error) + '</p>', ['ibFx', 'ibFees', 'tax']],
      sources: ['自动方案的范围与依据', '<p>只比较已收录的5家香港银行同名、同银行往返方案及2家内地银行的公开结汇价，并自动选择已知成本更低的换汇方式。不同开户资格、App优惠、两家银行组合及未知中转费不构成全市场最优证明。</p><p>收费核对至' + D.verifiedAt + '；中行、招行及中银香港公开参考牌价随定时数据任务刷新，保留银行原始时间。CNH是境外人民币，与CNY单独定价。借助公开牌价的中间值统一折算损耗，不重复扣价差。</p><p>推荐方案避免未到期的短期优惠和额外资产门槛；最低费用方案按当天优惠计算。额外保留资产本金不整笔算损耗，只按自填收益差计算机会成本。已知费用排行不保证实际最低到账损耗。</p>', ['safe', 'pbcRmb', 'ibCnh', 'bocFx', 'cmbFx', 'bochkUsdFx', 'ibFx', 'ibFees', 'tax', 'hangHk', 'scHk', 'hsbcHk', 'bochkAccount', 'zaNov']]
    };
    const [title, body, keys] = descriptions[key] || descriptions.sources;
    H.openModal(H.modalTitle('跨境资金', title) + '<div class="flow-detail">' + body + '<div class="flow-detail-sources">' + sourceList(keys) + '</div></div>');
  }
  function refresh() {
    if (!document.querySelector('.page-money-flow')) return;
    const data = result();
    document.getElementById('flow-live-diagram').innerHTML = diagram(data);
    document.getElementById('flow-live-summary').innerHTML = summary(data);
    document.getElementById('flow-live-comparison').innerHTML = comparison(data);
  }
  function clearBankOverrides() { for (const key of ['depositHkd', 'inwardHkd', 'returnWireHkd', 'monthlyHkd']) state[key] = ''; }
  function handleAction(el) {
    const { action: act, value, field: key } = el.dataset;
    if (act === 'money-flow-detail') { detail(value); return; }
    if (act === 'money-flow-set' && Object.hasOwn(state, key)) {
      state[key] = value;
      if (key === 'plan') { state.bank = ''; clearBankOverrides(); }
      if (key === 'exitBank') state.exitPrice = '';
    }
    if (act === 'money-flow-bank') { state.bank = value; clearBankOverrides(); }
    if (act === 'money-flow-reset') { state = { ...defaults }; save(); H.render(); return; }
    save(); refresh();
    for (const key of ['depositHkd', 'inwardHkd', 'returnWireHkd', 'monthlyHkd', 'exitPrice']) {
      const input = document.querySelector('[data-money-field="' + key + '"]');
      if (input) input.value = state[key];
    }
  }
  // Recalculate only the picture and comparison while typing. Keeping the
  // input DOM intact preserves the cursor and the open parameter disclosure.
  function handleInput(el) {
    const key = el.dataset.moneyField;
    if (!key || !Object.hasOwn(state, key)) return false;
    if (['depositHkd', 'inwardHkd', 'returnWireHkd', 'monthlyHkd'].includes(key) && !state.bank) state.bank = result().selected?.bank.id || '';
    state[key] = el.value; save(); clearTimeout(timer); timer = setTimeout(refresh, 100); return true;
  }
  function handleChange(el) {
    if (el.dataset.moneySelect) {
      state[el.dataset.moneySelect] = el.value;
      state.entryPrice = ''; state.bank = ''; clearBankOverrides();
      save(); H.render(); return true;
    }
    return !!el.dataset.moneyField;
  }
  window.ChanghengMoneyFlow = { view, handleAction, handleInput, handleChange };
}());
