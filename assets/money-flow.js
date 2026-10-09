(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel, STORE = 'changheng.money-flow.v4';
  const defaults = { budgetCny: '100000', currency: 'CNY', plan: 'custom', startBank: 'boc', route: 'USD', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc', outcome: 'usd-balance',
    mainlandMethod: 'boc-mobile', depositMethod: 'chats', fxMode: 'manual', returnMethod: 'bochk-fast', comparison: 'start', count: '1', usedFreeTransfers: '0',
    months: '12', balanceHkd: '0', returnBalanceHkd: '0', profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1', tradeFeeUsd: '',
    broker: 'za', buyOrders: '1', sellOrders: '1', sharePriceUsd: '100', trade25: false, chiefMonthly: false, usmartPromo: false, zaLv2: false,
    hsbcBalanceWaiver: false, otherTurnoverHkd: '0', usedPromoOrders: '0', usmartDays: '0', useVoucher: false, voucherScope: 'platform', voucherUsd: '0', voucherOrders: '1', voucherExpiry: '',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', inwardHkd: '', intermediaryCny: '',
    returnWireHkd: '', returnExtraCny: '', monthlyHkd: '', returnMonthlyHkd: '', startSell: '', entryPrice: '', exitPrice: '',
    usdCny: '', usdHkd: '', usdCnh: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  if (!stored.broker && stored.tradeFeeUsd === '0') delete stored.tradeFeeUsd;
  // Keep existing account choices; old complete-return scenarios retain their endpoint.
  if (Object.keys(stored).length && !stored.outcome) stored.outcome = 'mainland';
  let state = { ...defaults, ...stored, currency: 'CNY' }, H, timer;
  const esc = value => H.esc(value), num = (value, digits = 2) => value == null ? '—' : H.money(value, digits);
  const action = (label, act, extra = '', cls = 'btn') => H.action(label, 'money-flow-' + act, cls, extra);
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {} };
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  let cachedKey, cachedData;
  const result = () => {
    const inputs = { ...state, selectedOnly: true, date: today() }, key = JSON.stringify(inputs);
    if (key !== cachedKey) { cachedData = M.journeyPlans(inputs, D, window.MONEY_FLOW_QUOTES || {}); cachedKey = key; }
    return cachedData;
  };
  const source = key => D.sources[key] ? '<a class="source-link" target="_blank" rel="noopener noreferrer" href="' + esc(D.sources[key].url) + '">' + esc(D.sources[key].name) + ' ↗</a>' : '';
  const feeText = value => value == null ? '未报价' : value > 0 && value < .005 ? '＜0.01 CNY' : num(value) + ' CNY';
  const remittanceCurrencies = { USD: '美元 · 内地购汇后汇出', HKD: '港币 · 内地购汇后汇出', CNH: '人民币 · 原币汇出' };
  const bankOptions = banks => banks.map(bank => [bank.id, bank.name]);
  function field(key, label, unit = '', placeholder = '') {
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input ' + (key === 'voucherExpiry' ? 'type="date"' : 'type="text" inputmode="decimal"') + ' data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div></label>';
  }
  function select(key, label, values, value) {
    return '<label class="flow-field"><span>' + esc(label) + '</span><select data-money-select="' + key + '" aria-label="' + esc(label) + '">' + values.map(([id, text]) => '<option value="' + esc(id) + '"' + (id === value ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
  }
  function checkbox(key, label) {
    return '<label class="flow-offer"><input type="checkbox" data-money-check="' + key + '"' + (state[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  const outcomes = [['usd-balance', '保留美元'], ['usd-card', '美元原币消费'], ['cnh-card', '换人民币后刷卡'], ['mainland', '汇回内地结汇']];
  function entryMethods(s) {
    return [...(s.start?.id === 'boc' && s.bank?.id === 'bochk' && s.route !== 'CNH' ? [['boc-mobile', '中行手机银行 · 向境外中行']] : []),
      ['swift', s.start?.tariffChannel || '普通电汇 · 标准价'],
      ...(s.start?.id === 'boc' && s.bank?.id === 'bochk' && s.route === 'CNH' ? [['payment-connect', '跨境支付通 · 人民币原币']] : []),
      ...(['hang', 'hsbc', 'sc'].includes(s.start?.id) && s.start.group === s.bank?.group ? [['linked', '两地同名专用转账']] : []),
      ...(s.route === 'USD' && s.start?.fullAmountUsd != null ? [['full', 'SWIFT全额到账 · 加25 USD/笔']] : [])];
  }
  function depositMethods(s) {
    if (s.broker?.integratedBank === s.bank?.id) return [['internal', '同一银行内部交收']];
    if (s.broker?.integratedBank) return [['chats', '本地美元CHATS → 本人结算账户']];
    return s.route === 'USD' || s.fxMode === 'bank' ? [['chats', '本地美元CHATS'], ['swift', '美元SWIFT电汇']] : [['fps', '转数快FPS'], ['edda', 'eDDA扣款'], ['swift', 'SWIFT电汇']];
  }
  function returnMethods(s) {
    return [...(s.returning?.id === 'bochk' && s.exit?.group === 'boc' ? [['bochk-fast', '中银快汇 · 内地同名中行']] : []),
      ...(['hang', 'hsbc', 'sc'].includes(s.returning?.id) && s.returning.group === s.exit?.group ? [['linked', '两地同名专用转账']] : []), ['swift', '美元SWIFT电汇']];
  }
  const pct = value => num(value * 100, 3) + '%';
  const row = (r, key) => r?.rows?.find(item => item.key === key);
  const shortName = value => value?.name?.replace(' · Pro Fixed', '').replace(' · 美股交易', '').replace(' · Trade25 / 普通证券', '证券') || '请选择';
  function routeBar(data) {
    const s = data.selected || data.selection || {};
    return '<nav class="flow-route-bar" aria-label="当前资金路线">' + [
      ['startBank', '01 · 出发银行', shortName(s.start)], ['bank', '02 · 香港收款银行', shortName(s.bank)],
      ['broker', '03 · 买美股的账户', shortName(s.broker)], ['outcome', '04 · 资金用途', outcomes.find(([id]) => id === state.outcome)?.[1]]
    ].map(([key, label, text]) => action('<span>' + label + '</span><strong>' + esc(text) + '</strong><i aria-hidden="true">⌄</i>', 'pick', 'data-value="' + key + '" aria-label="' + esc(label + '：' + text + '，更换') + '"', 'flow-route-button')).join('') + '</nav>';
  }
  function amount(value, currency) { return '<b class="num">' + num(value) + ' <small>' + currency + '</small></b>'; }
  function charge(label, cny, description = '', native = '', evidence = '') {
    return '<div class="flow-operation"><div><strong>' + esc(label) + '</strong>' + (description ? '<small>' + esc(description) + '</small>' : '') + (evidence ? '<span class="flow-evidence">' + esc(evidence) + '</span>' : '') + '</div><div class="flow-operation-price">' + (native ? '<strong class="num">' + esc(native) + '</strong><small>≈ ' + feeText(cny) + '</small>' : '<strong class="num">' + feeText(cny) + '</strong>') + '</div><span class="num flow-operation-rate">' + (cny == null ? '—' : pct(cny / M.number(state.budgetCny))) + '</span></div>';
  }
  function feeRow(r, key, label, description = '', currency = 'CNY', evidence = '') {
    const item = row(r, key); if (!item || item.cny == null) return '';
    const native = currency !== 'CNY' ? num(item.cny / r.refs[currency]) + ' ' + currency : '';
    return charge(label || item.label, item.cny, description, native, evidence);
  }
  function section(n, title, content, balance) {
    return '<section class="flow-stage"><header><span class="flow-stage-number">' + n + '</span><h2>' + esc(title) + '</h2>' + (balance || '') + '</header>' + content + '</section>';
  }
  function brokerOffers(r) {
    const id = r.broker.id;
    let html = id === 'hsbc' ? checkbox('trade25', '已开通Trade25 · 仅美股月费0') + checkbox('hsbcBalanceWaiver', 'HSBC One已满足免管理费条件') : id === 'za' ? checkbox('zaLv2', 'ZA Perks Lv2 · 月前5笔平台费优惠') : id === 'chief' ? checkbox('chiefMonthly', 'App月供买入 · 首500 USD免佣/平台费') : id === 'usmart' ? checkbox('usmartPromo', '已符合开户180天及指定标的优惠') : '';
    html += checkbox('useVoucher', '使用已获得的费用券');
    if (state.useVoucher) html += '<div class="flow-voucher-fields">' + select('voucherScope', '抵扣范围', [['commission', '佣金'], ['platform', '平台费'], ['both', '佣金及平台费']], state.voucherScope) + field('voucherUsd', '额度', 'USD') + field('voucherOrders', '订单数', '笔') + field('voucherExpiry', '到期日') + '<p>' + esc(M.voucherState(state).message || '本次抵扣 ' + num(r.trading?.discountUsd || 0) + ' USD') + '</p></div>';
    return '<div class="flow-inline-offers">' + html + '</div>';
  }
  function tradingSide(r, kind) {
    if (!r.trading || r.trading.overridden) return '';
    const orders = r.trading.orders.filter(o => o.kind === kind);
    const sum = key => orders.reduce((total, o) => total + o[key], 0);
    const fees = sum('feeUsd'), tax = sum('sec') + sum('taf') + sum('cat') + sum('clearing');
    return charge((kind === 'buy' ? '买入' : '卖出') + '美股 · ' + orders.length + '笔', fees * r.refs.USD,
      '佣金 ' + num(sum('commission')) + ' + 平台 ' + num(sum('platform')) + ' + 清算/监管 ' + num(tax) + (sum('discount') ? ' − 券抵扣 ' + num(sum('discount')) : '') + ' USD', num(fees) + ' USD');
  }
  function diagram(data) {
    const r = data.selected, s = r || data.selection || {};
    const currency = s.route || 'USD', units = Object.entries(remittanceCurrencies);
    const entryControls = select('route', '汇出币种', units, currency) + select('mainlandMethod', '汇款渠道', entryMethods(s), r?.mainlandMethod || state.mainlandMethod);
    if (!r) return '<div class="flow-inline-controls">' + entryControls + select('returnBank', '取回／消费银行', bankOptions(D.hkBanks), s.returning?.id) + select('exitBank', '内地收款银行', bankOptions(D.mainlandBanks), s.exit?.id) + '</div><p class="notice warn">' + esc(data.error || '报价未载入') + '</p>' + action('调整成交报价', 'detail', 'data-value="quotes"');
    const count = M.number(state.count) || 1, sender = row(r, 'sender');
    let first = '<div class="flow-inline-controls">' + entryControls + '</div>';
    if (currency !== 'CNH') first += feeRow(r, 'entryFx', r.start.name + ' · 人民币购入' + (currency === 'USD' ? '美元' : '港币'), '1 ' + currency + ' = ' + num(r.startSell, 5) + ' CNY · ' + (r.entryAsOf || '') + ' · 点差已含在成交价中');
    else first += charge('人民币原币汇出', 0, '到港为CNH，本动作不换汇');
    if (sender?.cny != null) first += (sender.items || [sender]).map(item => charge(r.start.name + ' · ' + item.label, item.cny, count + '笔', '', item.evidence || '')).join('');
    first += feeRow(r, 'entryInward', r.bank.name + ' · ' + currency + '汇入', r.bank.id === 'bochk' && r.start.id === 'boc' ? '内地中行同名个人账户 · 基本手续费豁免' : '', 'HKD', '官方资费');
    if (row(r, 'entryMiddle')?.cny != null && row(r, 'entryMiddle').cny > 0) first += feeRow(r, 'entryMiddle');
    let html = section('01', currency === 'CNH' ? '人民币原币汇到香港' : '内地购汇 → 汇到香港', first, '<div class="flow-stage-balance"><span>' + esc(r.bank.name) + '到账</span>' + amount(r.steps.hongKong, currency) + '</div>');
    const fxOptions = [...(r.broker.id === 'ibkr' ? [['manual', 'IBKR手动换美元'], ['auto', 'IBKR买入时自动换美元']] : []), ['bank', r.bank.name + '先换美元']];
    let second = '<div class="flow-inline-controls">' + (currency !== 'USD' ? select('fxMode', '换美元的地点', fxOptions, r.fxMode) : '') + select('depositMethod', '股票账户入金', depositMethods(r), r.depositMethod) + '</div>';
    const conversion = currency !== 'USD' ? feeRow(r, 'brokerSpread', (r.fxMode === 'bank' ? r.bank.name : r.broker.name) + ' · ' + currency + '换美元点差', '1 USD = ' + num(r.entryPrice, 5) + ' ' + currency + ' · ' + (r.indicativeFx ? '参考中间价，不含成交点差' : r.fxAsOf || '')) + feeRow(r, 'brokerFx', '换美元佣金／自动加价', r.fxMode === 'manual' ? '0.002%，最低2 USD' : r.fxMode === 'auto' ? '0.03%加价' : '银行牌价换汇', 'USD') : '';
    const transfer = feeRow(r, 'depositBank', null, r.settlementBank ? '转入本人' + shortName(r.settlementBank) + '美元账户，再用于买股' : '', 'USD') + feeRow(r, 'depositOther', null, '', 'USD') + feeRow(r, 'depositBroker', r.broker.name + ' · 入金／内部交收', '', 'USD');
    second += r.fxMode === 'bank' ? conversion + transfer : transfer + conversion;
    html += section('02', '香港收款银行 → 股票交易账户', second, '<div class="flow-stage-balance"><span>买入前可用美元</span>' + amount(r.steps.fundedUsd, 'USD') + '</div>');
    let third = '<div class="flow-inline-controls flow-trade-inputs">' + field('sharePriceUsd', '买入均价', 'USD/股') + field('buyOrders', '买入笔数', '笔') + field('sellOrders', '卖出笔数', '笔') + field('months', '持有期', '月') + '</div>' + brokerOffers(r);
    if (r.broker.id === 'hsbc' && state.trade25) third += '<div class="flow-inline-controls">' + field('otherTurnoverHkd', '每个交易月已用成交额', 'HKD') + '</div>';
    if (r.broker.id === 'za' && state.zaLv2) third += '<div class="flow-inline-controls">' + field('usedPromoOrders', '每月已用优惠笔数', '笔') + '</div>';
    if (r.broker.id === 'usmart' && state.usmartPromo) third += '<div class="flow-inline-controls">' + field('usmartDays', '开户距今天数', '天') + '</div>';
    third += r.trading?.overridden ? feeRow(r, 'trade', '买卖交易费 · 实际金额', '', 'USD') : tradingSide(r, 'buy') + tradingSide(r, 'sell');
    const trade25 = r.broker.id === 'hsbc' && state.trade25;
    const custodyNote = trade25 ? '美国股票月费豁免，直至另行通知 · HSBC 2026年9月收费表' : r.broker.id === 'hsbc' ? '5 USD/月 × ' + num((r.trading?.monthlyUsd || 0) / 5, 0) + '个月；2026年底前及有交易月份豁免' : '按现行证券账户收费表';
    third += feeRow(r, 'brokerAccount', null, custodyNote, trade25 ? 'HKD' : 'USD');
    html += section('03', r.broker.name + ' · 买入与卖出', third, '<div class="flow-stage-balance"><span>卖出后美元余额</span>' + amount(r.steps.proceedsUsd - r.taxCny / r.refs.USD, 'USD') + '</div>');
    let last = '<div class="flow-inline-controls">' + select('returnBank', '取回／消费银行', bankOptions(D.hkBanks), r.returning.id) + (state.outcome === 'mainland' ? select('exitBank', '内地收款银行', bankOptions(D.mainlandBanks), r.exit.id) + select('returnMethod', '回内地渠道', returnMethods(r), r.returnMethod) : '') + '</div>';
    last += feeRow(r, 'withdraw', null, r.broker.withdrawalText, 'USD') + feeRow(r, 'returnInward', null, '', 'USD');
    if (row(r, 'withdrawMiddle')?.cny > 0) last += feeRow(r, 'withdrawMiddle');
    if (state.outcome === 'mainland') last += feeRow(r, 'returnWire', r.returning.name + ' → ' + r.exit.name + ' · 汇出', '', 'HKD') + feeRow(r, 'returnOther') + feeRow(r, 'exitFx', r.exit.name + ' · 美元结汇成人民币', '1 USD = ' + num(r.exitPrice, 5) + ' CNY · ' + (r.exitAsOf || ''));
    if (state.outcome === 'cnh-card') last += feeRow(r, 'exitFx', null, '1 USD = ' + num(r.exitPrice, 5) + ' CNH · ' + (window.MONEY_FLOW_QUOTES?.offshoreUsd?.bochk?.quotes?.CNH?.asOf || ''));
    last += feeRow(r, 'card', null, '多币种扣账卡 · 对应币种余额充足 · 直接刷卡，不含第三方支付平台附加费', r.currency);
    if (state.outcome === 'usd-balance') last += charge('美元留在' + r.returning.name, 0, '不换汇');
    const accounts = row(r, 'account');
    if (accounts?.cny > 0) last += accounts.items.filter(i => i.cny > 0).map(i => charge(i.label, i.cny, num(i.monthlyHkd) + ' HKD/月 × ' + num(i.months, 0) + '个月', num(i.cny / r.refs.HKD) + ' HKD')).join('');
    else last += feeRow(r, 'account', '所用香港银行账户管理费', num(M.number(state.months), 0) + '个月 · 同一账户只计一次', 'HKD');
    if (row(r, 'extra')?.cny > 0) last += feeRow(r, 'extra');
    html += section('04', outcomes.find(([id]) => id === state.outcome)?.[1] || '资金用途', last, '');
    return html;
  }
  function summary(data) {
    const r = data.selected; if (!r) return '';
    const gaps = r.rows.filter(x => x.cny == null), cost = r.costCny;
    const gapText = gaps.map(item => item.rangeCny ? item.label + ' ' + item.rangeCny.map(v => num(v)).join('–') + ' CNY' : item.key === 'entryMiddle' ? '跨境代理行费用（如发生）' : item.key === 'sender' ? item.label + '：' + item.status : item.label).join('、');
    const stale = r.missing.filter(item => item.includes('超过3天'));
    const notes = [(gapText ? '上述余额未扣：' + gapText : ''), r.indicativeFx ? '换汇按参考情景：' + r.indicativeFx : '', stale.length ? stale.join('、') + '，当前金额仅供参考' : ''].filter(Boolean);
    return '<div class="flow-result"><div><span>' + (state.outcome.includes('card') ? '可消费金额' : '最终余额') + '</span>' + amount(r.net, r.currency) + '</div><div><span>已列费用合计 · 含换汇点差</span>' + amount(cost, 'CNY') + '<small>占本金 ' + pct(cost / r.budgetCny) + '</small></div><div><span>折算损耗率' + (gaps.length ? ' · 不含下列浮动项' : '') + '</span><b class="num">' + pct((r.budgetCny + r.profitUsd * r.refs.USD - r.netCny) / r.budgetCny) + '</b></div></div>' +
      (notes.length ? '<p class="flow-unpriced">' + notes.map(esc).join('。') + '。</p>' : '') +
      (Math.abs(r.fxImpactCny) >= .005 || r.taxCny || r.profitUsd ? '<p class="flow-reconcile">人民币核对：本金 ' + num(r.budgetCny) + (r.profitUsd ? ' + 投资盈亏 ' + num(r.profitUsd * r.refs.USD) : '') + ' − 费用 ' + num(cost) + (r.taxCny ? ' − 税款 ' + num(r.taxCny) : '') + ' + 汇率折算影响 ' + num(r.fxImpactCny) + ' = 余额折合 ' + num(r.netCny) + ' CNY</p>' : '') +
      '<div class="flow-bottom-links">' + action('收费依据与逐笔核对', 'detail', 'data-value="cost"', 'text-link') + action('调整成交报价', 'detail', 'data-value="quotes"', 'text-link') + '</div>';
  }
  function parameters() {
    return '<div class="flow-adjustments"><div class="flow-parameter-grid">' + field('profitUsd', '卖出盈亏（交易费前）', 'USD') + field('tradeFeeUsd', '实际买卖交易费', 'USD', '留空按资费算') + field('withdrawalIndex', '本月第几次出金', '次') + field('taxRate', '应税所得税率', '%') + field('taxableCny', '人民币应税所得', 'CNY', '按正净利润估算') + field('creditCny', '税款抵免', 'CNY') + '</div><details><summary>个别成交回单与账户费用</summary><div class="flow-parameter-grid">' + [
      ['senderFeeCny', '每笔汇出手续费＋电讯费', 'CNY'], ['entryMiddleCny', '每笔跨境代理费', 'CNY'], ['entryInwardHkd', '每笔香港汇入费', 'HKD'],
      ['depositHkd', '入金转账费', 'HKD'], ['depositOtherCny', '入金收款行／代理费', 'CNY'], ['inwardHkd', '出金收款行费', 'HKD'], ['intermediaryCny', '出金代理费', 'CNY'],
      ['returnWireHkd', '回内地汇出费', 'HKD'], ['returnExtraCny', '回内地其他费用', 'CNY'], ['monthlyHkd', '收款银行月费', 'HKD'], ['returnMonthlyHkd', '消费银行月费', 'HKD'],
      ['balanceHkd', '收款银行保留资产', 'HKD'], ['returnBalanceHkd', '消费银行保留资产', 'HKD'], ['openingCny', '开户实际支出', 'CNY']
    ].map(a => field(...a, '可选：覆盖公开收费')).join('') + '</div></details><div class="flow-bottom-links">' + action('恢复公开报价', 'clear-quotes') + action('重置路线', 'reset') + '</div></div>';
  }
  function view(helpers) {
    H = helpers; const data = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '选银行、选交易账户，逐笔看清费用。') +
      '<div class="page-money-flow"><div class="flow-budget">' + field('budgetCny', '人民币本金（含汇出费用）', 'CNY') + field('count', '汇出笔数', '笔') + '<span>费用核对 ' + D.verifiedAt + '</span></div><div id="flow-live-route" class="flow-route-sticky">' + routeBar(data) + '</div>' +
      '<div class="flow-sheet"><div class="flow-sheet-label"><span>实际动作与计费依据</span><span>本次费用</span><span>占人民币本金</span></div><div id="flow-live-diagram">' + diagram(data) + '</div><div id="flow-live-summary">' + summary(data) + '</div></div>' +
      '<details class="card flow-disclosure"><summary>调整盈亏、税款与实际费用</summary>' + parameters() + '</details><p class="flow-footnote">便利化购汇不得用于境外证券投资；此页为费用测算。' + action('适用条件', 'detail', 'data-value="mainland"', 'text-link') + '</p></div>';
  }
  function patch(element, html) {
    const template = document.createElement('template'); template.innerHTML = html;
    const identity = node => node.nodeType === 1 ? ['moneyField', 'moneySelect', 'moneyCheck'].map(key => node.dataset[key] || '').join(':') : '';
    function sync(old, fresh) {
      if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName || identity(old) !== identity(fresh)) { old.replaceWith(fresh.cloneNode(true)); return; }
      if (old.nodeType === 3) { if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue; return; }
      if (old.nodeType !== 1) return;
      for (const attr of [...old.attributes]) if (!fresh.hasAttribute(attr.name) && !(old.tagName === 'DETAILS' && attr.name === 'open')) old.removeAttribute(attr.name);
      for (const attr of fresh.attributes) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
      if (old.tagName === 'INPUT') {
        if (old !== document.activeElement && old.value !== fresh.value) old.value = fresh.value;
        old.checked = fresh.checked; return;
      }
      const target = [...fresh.childNodes];
      target.forEach((child, i) => old.childNodes[i] ? sync(old.childNodes[i], child) : old.appendChild(child.cloneNode(true)));
      while (old.childNodes.length > target.length) old.lastChild.remove();
      if (old.tagName === 'SELECT' && old.value !== fresh.value) old.value = fresh.value;
    }
    const wrapper = document.createElement(element.tagName); wrapper.append(template.content);
    // Keep the region itself and every unchanged control in the DOM. This
    // preserves focus, caret, native selection and open disclosure state.
    const children = [...wrapper.childNodes];
    children.forEach((node, i) => element.childNodes[i] ? sync(element.childNodes[i], node) : element.appendChild(node.cloneNode(true)));
    while (element.childNodes.length > children.length) element.lastChild.remove();
  }
  function syncFields() {
    document.querySelectorAll('[data-money-field]').forEach(input => { if (input !== document.activeElement) input.value = state[input.dataset.moneyField] ?? ''; });
    document.querySelectorAll('[data-money-check]').forEach(input => { input.checked = !!state[input.dataset.moneyCheck]; });
  }
  function refresh() {
    const data = result();
    for (const [id, renderer] of [['flow-live-route', routeBar], ['flow-live-diagram', diagram], ['flow-live-summary', summary]]) {
      const element = document.getElementById(id); if (element) patch(element, renderer(data));
    }
    syncFields();
  }
  function lockCurrent() {
    const data = result(), s = data.selected || data.selection;
    if (!s) return;
    for (const [key, value] of Object.entries({ startBank: s.start?.id, bank: s.bank?.id, returnBank: s.returning?.id, exitBank: s.exit?.id,
      route: s.route, broker: s.broker?.id, fxMode: s.fxMode, mainlandMethod: s.mainlandMethod, depositMethod: s.depositMethod, returnMethod: s.returnMethod })) {
      if (!state[key] && value) state[key] = value;
    }
  }
  const quoteKeys = ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'returnMonthlyHkd', 'startSell', 'entryPrice', 'exitPrice', 'usdCny', 'usdHkd', 'usdCnh'];
  function clear(keys) {
    for (const key of keys) { state[key] = ''; document.querySelectorAll('[data-money-field="' + key + '"]').forEach(input => { input.value = ''; }); }
  }
  function choose(key, value) {
    lockCurrent(); const previousRoute = state.route, previousBank = state.bank, previousMethod = state.mainlandMethod; state[key] = value; state.plan = 'custom';
    const provider = M.selectedBroker(state, D);
    if (key === 'broker') {
      clear(['tradeFeeUsd', 'entryPrice', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny']); state.useVoucher = false;
      state.fxMode = state.route === 'USD' ? 'manual' : provider.id === 'ibkr' ? 'manual' : 'bank';
      state.depositMethod = provider.integratedBank === state.bank ? 'internal' : state.route === 'USD' || state.fxMode === 'bank' ? 'chats' : 'fps';
      state.voucherScope = provider.id === 'chief' || provider.id === 'usmart' || provider.id === 'za' ? 'platform' : 'commission';
    }
    if (key === 'startBank') clear(['startSell', 'senderFeeCny', 'entryMiddleCny']);
    if (key === 'bank') clear(['entryInwardHkd', 'depositHkd', 'depositOtherCny', 'monthlyHkd', 'entryPrice']);
    if (key === 'returnBank') clear(['inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd', ...(state.outcome === 'cnh-card' ? ['exitPrice'] : [])]);
    if (key === 'route') {
      clear(['startSell', 'entryPrice']);
      if (value === 'USD' || previousRoute === 'USD') state.fxMode = value !== 'USD' && provider.id !== 'ibkr' ? 'bank' : 'manual';
      const methods = depositMethods({ route: value, fxMode: state.fxMode, broker: provider, bank: { id: state.bank } });
      if (!methods.some(([id]) => id === state.depositMethod)) state.depositMethod = methods[0][0];
    }
    if (key === 'fxMode') { clear(['entryPrice', 'depositHkd', 'depositOtherCny']); state.depositMethod = value === 'bank' || state.route === 'USD' ? 'chats' : 'fps'; }
    if (key === 'depositMethod') clear(['depositHkd', 'depositOtherCny']);
    if (key === 'mainlandMethod') clear(['senderFeeCny', 'entryMiddleCny']);
    if (key === 'outcome') clear(['exitPrice']);
    if (key === 'exitBank') clear(['exitPrice', 'returnExtraCny']);
    if (key === 'returnMethod') clear(['returnWireHkd', 'returnExtraCny']);
    const start = D.mainlandBanks.find(bank => bank.id === state.startBank), bank = D.hkBanks.find(bank => bank.id === state.bank),
      returning = D.hkBanks.find(bank => bank.id === state.returnBank), exit = D.mainlandBanks.find(bank => bank.id === state.exitBank);
    if (['startBank', 'bank', 'broker'].includes(key) && !entryMethods({ start, bank, route: state.route }).some(([id]) => id === state.mainlandMethod)) state.mainlandMethod = ['hang', 'hsbc', 'sc'].includes(start?.id) && start.group === bank?.group ? 'linked' : 'swift';
    if (['startBank', 'bank', 'route', 'broker'].includes(key) && !entryMethods({ start, bank, route: state.route }).some(([id]) => id === state.mainlandMethod)) state.mainlandMethod = 'swift';
    if (state.bank !== previousBank || state.route !== previousRoute || state.mainlandMethod !== previousMethod) clear(['senderFeeCny', 'entryMiddleCny']);
    if (['exitBank', 'returnBank', 'broker'].includes(key)) state.returnMethod = returnMethods({ returning, exit }).find(([id]) => id !== 'swift')?.[0] || 'swift';
    save(); refresh();
  }
  function picker(key) {
    const titles = { startBank: '选择出发银行', bank: '选择香港收款银行', broker: '选择买美股的账户', outcome: '选择资金用途' };
    const values = key === 'outcome' ? outcomes.map(([id, name]) => ({ id, name })) : key === 'startBank' ? D.mainlandBanks : key === 'bank' ? D.hkBanks : D.brokers;
    const copy = item => key === 'broker' ? item.feeShort : key === 'startBank' ? item.id === 'boc' ? '手机银行向境外中行：2026公开双免情景' : item.feeText : key === 'bank' ? item.id === 'bochk' ? '内地中行同名汇入0；本地USD CHATS汇出0' : '账户管理费 ' + item.monthlyHkd + ' HKD/月' : ({ 'usd-balance': '卖出后取回香港银行，保留USD', 'usd-card': '多币种扣账卡直接使用美元余额', 'cnh-card': '中银香港USD换CNH，再以人民币余额直接刷卡', mainland: '美元汇回本人内地银行，再按该行买入价结汇' })[item.id];
    H.openModal(H.modalTitle(titles[key]) + '<div class="flow-picker">' + values.map(item => action('<span><strong>' + esc(item.name) + '</strong><small>' + esc(copy(item) || '') + '</small></span><b>' + (item.id === state[key] ? '✓' : '选择') + '</b>', 'pick-choice', 'data-field="' + key + '" data-value="' + item.id + '" aria-pressed="' + (item.id === state[key]) + '"', 'flow-picker-option')).join('') + '</div>');
  }
  function detail(key) {
    const data = result(), r = data.selected;
    let title = '收费依据', content = '', keys = Object.keys(D.sources);
    if (key === 'quotes') {
      title = '成交报价'; keys = ['bocFx', 'bochkUsdFx'];
      content = '<div class="flow-parameter-grid">' + field('startSell', '每1汇出外币的人民币购入价', 'CNY', '所选银行牌价') + field('entryPrice', '香港每1USD的原币购入价', r?.route || '原币', '对应银行牌价／参考价') + field('exitPrice', '每1USD换回的金额', r?.currency || 'CNY', '对应银行牌价') + '</div>';
    } else if (key === 'mainland') {
      title = '适用条件'; keys = ['safe', 'pbcRmb', 'scCnTerms', 'csrc'];
      content = '<p>大陆个人便利化购汇不能用于境外证券投资，同名香港账户不改变用途限制。银行免费汇款、券商接受入金和资金出境许可是不同条件。本页计算费用，不代替实际资金来源与用途审核。</p>';
    } else {
      keys = ['bochkSame', 'bocMobile2026', 'bocMobileGuide', 'bocMobileHistory', 'boc', 'bochk', 'za', 'zaLocalUsd', 'hsbcUsTariff', 'trade25Age', 'hsbcOne', 'bochkCard', 'hsbcCard', ...(r?.broker.sources || [])];
      content = '<h3>中行 → 中银香港</h3><p>中银香港官网确认同名个人账户的基本汇入手续费豁免。内地汇出手续费、电讯费按2026年公开报道及转账实录的双免情景计算，证据等级为公开报道；并非根据2025年公告推定全国永久免费。代理行费不在中银香港的豁免范围，购汇点差单独计算。</p>' +
        '<h3>银行与股票账户</h3><p>香港收款银行独立选择。中银香港向本人ZA／汇丰美元账户走本地CHATS；两端银行的本地资费均为0。ZA官方直连银行名单包括中银香港和汇丰。银行证券账户用本行美元存款交收，持有其他收款银行不受限制。</p>' +
        '<h3>Trade25仅美股</h3><p>汇丰2026年9月美股收费表第3、10页明确豁免美国股票月费至另行通知。每月首25万港元累计成交额度及首次跨额整单免佣；后续订单按标准佣金。仅美股不扣25 HKD月费。HSBC One账户管理费及监管费另算。普通证券账户的5 USD托管月费豁免至2026年底，之后有交易月份免收。</p>' +
        '<h3>消费与计价</h3><p>美元原币消费要求支持USD的多币种扣账卡且余额充足。人民币刷卡使用中银香港USD/CNH现汇买入价，不能复用内地USD/CNY结汇价。仅计算直接刷卡，不含支付宝、微信或商户另收费用；不预扣尚未发生的现金回赠。</p>';
      if (r) content += '<h3>当前路线逐笔金额（CNY）</h3><div class="flow-cost-detail">' + r.rows.flatMap(item => item.items || [item]).map(item => '<div><span>' + esc(item.label) + '</span><b>' + (item.cny == null ? esc(item.status || '随实际汇路或成交报价确定') : feeText(item.cny)) + '</b></div>').join('') + '</div><p>参考值：1 USD = ' + num(r.refs.USD, 6) + ' CNY；1 HKD = ' + num(r.refs.HKD, 6) + ' CNY。月费先算原币单价×月数，再按此参考值折算，不将每月价与全年金额并列。</p>';
    }
    H.openModal(H.modalTitle(title) + '<div class="flow-detail">' + content + '<div class="flow-detail-sources">' + [...new Set(keys)].map(source).join('') + '</div></div>');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('money-flow-', ''), value = button.dataset.value;
    if (act === 'pick') { picker(value); return; }
    if (act === 'detail') { detail(value); return; }
    if (act === 'choose' || act === 'pick-choice') {
      if (act === 'pick-choice') document.getElementById('dialog')?.close();
      choose(button.dataset.field, value); return;
    }
    if (act === 'clear-quotes') { clear(quoteKeys); save(); refresh(); return; }
    if (act === 'reset') { state = { ...defaults }; save(); H.render(); }
  }
  function handleInput(el) {
    const key = el.dataset.moneyField; if (!key) return false;
    state[key] = el.value; state.plan = 'custom'; save(); clearTimeout(timer); timer = setTimeout(refresh, 120); return true;
  }
  function handleChange(el) {
    if (el.dataset.moneyCheck) { state[el.dataset.moneyCheck] = el.checked; save(); refresh(); return true; }
    if (el.dataset.moneySelect) { choose(el.dataset.moneySelect, el.value); return true; }
    if (el.dataset.moneyField) { clearTimeout(timer); refresh(); return true; }
    return false;
  }
  window.ChanghengMoneyFlow = { view, handleAction, handleInput, handleChange };
}());
