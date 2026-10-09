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
  const controlOptions = new Map();
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
  const remittanceCurrencies = { USD: '购美元', HKD: '购港币', CNH: '人民币原币' };
  const bankOptions = banks => banks.map(bank => [bank.id, bank.name]);
  function field(key, label, unit = '', placeholder = '') {
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input ' + (key === 'voucherExpiry' ? 'type="date"' : 'type="text" inputmode="decimal"') + ' data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div></label>';
  }
  function select(key, label, values, value) {
    controlOptions.set(key, { label, values });
    const selected = values.find(([id]) => id === value);
    if (!values.length) return '';
    const caption = selected?.[1] || '请选择' + label;
    const choices = values.length <= 3 && key !== 'mainlandMethod' && key !== 'depositMethod';
    return '<div class="flow-field"><span>' + esc(label) + '</span>' + (choices && values.length > 1 ?
      '<div class="flow-segments" role="group" aria-label="' + esc(label) + '">' + values.map(([id, text]) => action(esc(text), 'choose', 'data-field="' + key + '" data-value="' + esc(id) + '" aria-pressed="' + (id === value) + '"', 'flow-segment')).join('') + '</div>' :
      values.length === 1 && selected ? '<div class="flow-fixed-choice">' + esc(caption) + '</div>' :
      action('<span>' + esc(caption) + '</span><span aria-hidden="true">⌄</span>', 'control-pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + caption) + '"', 'flow-control-button')) + '</div>';
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
  const presets = [
    { id: 'cib-usd', title: '兴业购美元 → 汇丰', note: '汇丰证券 · 可用Trade25', config: { startBank: 'cib', bank: 'hsbc', broker: 'hsbc', route: 'USD', mainlandMethod: 'swift', fxMode: 'manual', depositMethod: 'internal', returnBank: 'hsbc' } },
    { id: 'cib-hkd', title: '兴业购港币 → 汇丰 → IBKR', note: 'IBKR换美元 · 成交价随市场', config: { startBank: 'cib', bank: 'hsbc', broker: 'ibkr', route: 'HKD', mainlandMethod: 'swift', fxMode: 'manual', depositMethod: 'fps', returnBank: 'hsbc' } },
    { id: 'boc-za', title: '中行 → 中银香港 → ZA', note: '美元转账 · 银行与买股账户分开', config: { startBank: 'boc', bank: 'bochk', broker: 'za', route: 'USD', mainlandMethod: 'boc-mobile', fxMode: 'manual', depositMethod: 'chats', returnBank: 'bochk' } }
  ];
  function quickPlans() {
    return '<div class="flow-quick-heading"><h2>快捷方案</h2><span>选中后可逐步调整</span></div><div class="flow-presets">' + presets.map(p => action('<strong>' + esc(p.title) + '</strong><small>' + esc(p.note) + '</small><span aria-hidden="true">' + (state.plan === p.id ? '✓' : '↗') + '</span>', 'preset', 'data-value="' + p.id + '" aria-pressed="' + (state.plan === p.id) + '"', 'flow-preset')).join('') + '</div>';
  }
  function accountButton(key, label, text) {
    return action('<small>' + esc(label) + '</small><strong>' + esc(text) + '</strong><span>更换 <i aria-hidden="true">↗</i></span>', 'pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + text + '，更换') + '"', 'flow-account-button');
  }
  function amount(value, currency) { return '<b class="num">' + num(value) + ' <small>' + currency + '</small></b>'; }
  function charge(label, cny, description = '', native = '', evidence = '', pending = '按实际汇路收取') {
    return '<div class="flow-operation"><div><strong>' + esc(label) + '</strong>' + (description ? '<small>' + esc(description) + '</small>' : '') + (evidence ? '<span class="flow-evidence">' + esc(evidence) + '</span>' : '') + '</div><div class="flow-operation-price">' + (cny == null ? '<span class="flow-pending">' + esc(pending) + '</span>' : native ? '<strong class="num">' + esc(native) + '</strong><small>≈ ' + feeText(cny) + '</small>' : '<strong class="num">' + feeText(cny) + '</strong>') + '</div></div>';
  }
  function feeRow(r, key, label, description = '', currency = 'CNY', evidence = '') {
    const item = row(r, key); if (!item) return '';
    const native = currency !== 'CNY' && item.cny != null ? num(item.cny / r.refs[currency]) + ' ' + currency : '';
    const pending = item.rangeCny ? item.rangeCny.map(v => num(v)).join('–') + ' CNY' : item.status || (['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(key) ? '按实际汇路收取' : '缺少该项报价');
    return charge(label || item.label, item.cny, description, native, evidence, pending);
  }
  const variableCharge = x => ['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(x.key) || x.status === '按实时成交价计算';
  const stageKeys = [ ['entryFx', 'sender'], ['entryMiddle', 'entryInward', 'account'],
    ['depositBank', 'depositOther', 'depositBroker', 'brokerSpread', 'brokerFx', 'trade', 'brokerAccount'],
    ['withdraw', 'returnInward', 'withdrawMiddle', 'returnWire', 'returnOther', 'exitFx', 'card', 'extra'] ];
  function stageMetric(r, index) {
    const rows = (r?.rows || []).filter(x => stageKeys[index].includes(x.key));
    if (!rows.length) return '<span class="flow-stage-metric">损耗率 —</span>';
    const missing = rows.some(x => x.cny == null), blocked = rows.some(x => x.cny == null && !variableCharge(x)), cost = rows.reduce((sum, x) => sum + (x.cny || 0), 0);
    return '<span class="flow-stage-metric" title="本步已列手续费和换汇点差 ÷ 人民币本金">' + (missing ? '已知损耗率' : '损耗率') + '<b class="num">' + (blocked ? '—' : pct(cost / M.number(state.budgetCny))) + '</b><small>' + (missing ? '已知费用 ' : '费用 ') + feeText(cost) + '</small></span>';
  }
  function stageBalance(r, value, currency, label, stage) {
    const relevant = stageKeys.slice(0, stage + 1).flat(), gaps = (r?.rows || []).filter(x => relevant.includes(x.key) && x.cny == null);
    const blocked = gaps.some(x => !variableCharge(x));
    const status = blocked || !Number.isFinite(value) ? '金额暂不可算' : gaps.length ? label + ' · 未扣浮动费用' : label;
    return '<div class="flow-stage-balance"><span>' + esc(status) + '</span>' + (blocked || !Number.isFinite(value) ? '<b>—</b>' : amount(value, currency)) + '</div>';
  }
  function section(n, label, aside, title, controls, content, balance, r) {
    return '<section class="flow-stage" data-flow-stage="' + n + '"><aside><div class="flow-step-label"><span>' + n + '</span>' + esc(label) + '</div>' + aside + '</aside><div class="flow-stage-body"><header><h2>' + esc(title) + '</h2>' + stageMetric(r, Number(n) - 1) + '</header>' + controls + '<div class="flow-operations">' + content + '</div>' + (balance || '') + '</div></section>';
  }
  function quoteComparison() {
    const comparison = M.purchaseComparison({ ...state, date: today() }, D, window.MONEY_FLOW_QUOTES || {});
    const selected = comparison.rows.find(x => x.bank.id === state.startBank);
    if (!selected?.comparable || !comparison.best) return '';
    return '<div class="flow-fx-comparison"><strong>' + ('购汇相对损耗 ' + pct(selected.lossRate) + (selected.lossRate < 1e-9 ? ' · 当前最优' : '')) + '</strong><span>基准：' + esc(comparison.best.bank.name) + ' · ' + num(comparison.best.sell, 5) + ' CNY/' + comparison.currency + '</span></div>';
  }
  function brokerOffers(r) {
    const id = r.broker.id;
    let html = id === 'hsbc' ? checkbox('trade25', '已开通Trade25 · 仅美股月费0') : id === 'za' ? checkbox('zaLv2', 'ZA Perks Lv2 · 月前5笔平台费优惠') : id === 'chief' ? checkbox('chiefMonthly', 'App月供买入 · 首500 USD免佣/平台费') : id === 'usmart' ? checkbox('usmartPromo', '已符合开户180天及指定标的优惠') : '';
    html += checkbox('useVoucher', '使用已获得的费用券');
    if (state.useVoucher) html += '<div class="flow-voucher-fields">' + select('voucherScope', '抵扣范围', [['commission', '佣金'], ['platform', '平台费'], ['both', '佣金及平台费']], state.voucherScope) + field('voucherUsd', '额度', 'USD') + field('voucherOrders', '订单数', '笔') + field('voucherExpiry', '到期日') + '<p>' + esc(M.voucherState(state).message || '本次抵扣 ' + num(r.trading?.discountUsd || 0) + ' USD') + '</p></div>';
    return '<div class="flow-inline-offers">' + html + '</div>';
  }
  function tradingSide(r, kind) {
    if (!r?.trading || r.trading.overridden) return '';
    const orders = r.trading.orders.filter(o => o.kind === kind);
    const sum = key => orders.reduce((total, o) => total + o[key], 0);
    const fees = sum('feeUsd'), tax = sum('sec') + sum('taf') + sum('cat') + sum('clearing');
    return charge((kind === 'buy' ? '买入' : '卖出') + '美股 · ' + orders.length + '笔', fees * r.refs.USD,
      '佣金 ' + num(sum('commission')) + ' + 平台 ' + num(sum('platform')) + ' + 清算/监管 ' + num(tax) + (sum('discount') ? ' − 券抵扣 ' + num(sum('discount')) : '') + ' USD', num(fees) + ' USD');
  }
  function diagram(data) {
    const r = data.selected || data.partial;
    // Selections remain editable even when a quote or an input is unavailable.
    const s = { start: D.mainlandBanks.find(x => x.id === state.startBank), bank: D.hkBanks.find(x => x.id === state.bank),
      broker: M.selectedBroker(state, D), returning: D.hkBanks.find(x => x.id === state.returnBank), exit: D.mainlandBanks.find(x => x.id === state.exitBank),
      route: state.route, fxMode: state.fxMode, ...data.selection, ...(data.selected || {}) };
    const currency = s.route, count = M.number(state.count) || 1, sender = row(r, 'sender');
    const accountSet = [...new Map([s.bank, D.hkBanks.find(x => x.id === s.broker.integratedBank), s.returning].filter(Boolean).map(b => [b.id, b])).values()];
    const errorStage = r?.errorStage || '01';
    const errorFor = stage => data.error && errorStage === stage ? '<p class="flow-error" role="status">' + esc(data.error) + '</p>' : '';
    const firstAside = accountButton('startBank', '出发银行', shortName(s.start)) + '<div class="flow-budget">' + field('budgetCny', '人民币本金 · 含费用', 'CNY') + field('count', '汇出笔数', '笔') + '</div>';
    let first = errorFor('01');
    if (currency !== 'CNH') first += feeRow(r, 'entryFx', '人民币买入' + (currency === 'USD' ? '美元' : '港币') + ' · 换汇点差',
      r?.startSell ? '1 ' + currency + ' = ' + num(r.startSell, 5) + ' CNY' + (r.entryDiscount ? ' · 已按寰宇人生五折点差计算' : '') + ' · ' + (r.entryTimeBasis === 'observed' ? '采集 ' : '') + (r.entryAsOf || '') : '');
    else first += charge('人民币原币汇出', 0, '不购汇，到港币种为CNH');
    if (sender) first += (sender.items || [sender]).map(item => charge(item.label, item.cny, count + '笔', '', item.evidence || '', item.rangeCny ? item.rangeCny.map(v => num(v)).join('–') + ' CNY' : item.status || '缺少本渠道资费')).join('');
    else first += '<p class="flow-tariff">' + esc(s.start.feeText) + '</p>';
    let firstControls = '<div class="flow-inline-controls">' + select('route', '汇出币种', Object.entries(remittanceCurrencies), currency) + select('mainlandMethod', '汇款渠道', entryMethods(s), s.mainlandMethod || state.mainlandMethod) + '</div>';
    if (s.start.id === 'cib') firstControls += '<div class="flow-allowance">' + field('usedFreeTransfers', '优惠期内已汇出笔数', '笔') + '<span>前30笔电讯费免 · 至2027-06-30</span></div>';
    firstControls += quoteComparison();
    let html = section('01', '内地出发', firstAside, currency === 'CNH' ? '人民币原币汇出' : '人民币购汇 → 汇出' + (currency === 'USD' ? '美元' : '港币'), firstControls, first,
      stageBalance(r, r?.steps?.mainlandForeign, currency, '汇出金额', 0), r);

    let secondAside = accountButton('bank', '香港收款银行', shortName(s.bank)) + field('months', '账户使用／持有月数', '月');
    if (accountSet.some(b => b.id === 'hsbc')) secondAside += '<div class="flow-bank-condition">' + checkbox('hsbcBalanceWaiver', 'HSBC One已满足免管理费条件') + '<small>三个月平均理财总值≥10,000 HKD或其他豁免资格</small></div>';
    let second = errorFor('02') + feeRow(r, 'entryInward', s.bank.name + ' · ' + currency + '汇入费', s.bank.id === 'bochk' && s.start.id === 'boc' ? '内地中行同名个人账户豁免' : '', 'HKD');
    second += feeRow(r, 'entryMiddle', '跨境代理行费');
    const accounts = row(r, 'account');
    if (accounts) second += accounts.items.map(i => charge(i.label, i.cny, num(i.monthlyHkd) + ' HKD/月 × ' + num(i.months, 0) + '个月', i.cny == null ? '' : num(i.cny / r.refs.HKD) + ' HKD')).join('');
    else second += '<p class="flow-tariff">' + accountSet.map(b => esc(b.name) + '：' + (b.id === 'hsbc' && state.hsbcBalanceWaiver ? '管理费豁免' : num(b.monthlyHkd) + ' HKD/月')).join('；') + '</p>';
    html += section('02', '香港收款', secondAside, shortName(s.start) + ' → ' + shortName(s.bank), '', second,
      stageBalance(r, r?.steps?.hongKong, currency, '初次到账', 1), r);

    let thirdAside = accountButton('broker', '买美股的账户', shortName(s.broker));
    if (s.broker.integratedBank && s.broker.integratedBank !== s.bank.id) thirdAside += '<p class="flow-account-note">从' + esc(shortName(s.bank)) + '转入本人' + esc(shortName(D.hkBanks.find(b => b.id === s.broker.integratedBank))) + '结算账户</p>';
    const fxOptions = [...(s.broker.id === 'ibkr' ? [['manual', 'IBKR手动换美元'], ['auto', 'IBKR自动换美元']] : []), ['bank', shortName(s.bank) + '换美元']];
    let thirdControls = '<div class="flow-inline-controls">' + (currency !== 'USD' ? select('fxMode', '换美元', fxOptions, s.fxMode) : '') + select('depositMethod', '转入股票账户', depositMethods(s), s.depositMethod || state.depositMethod) + '</div>';
    thirdControls += '<details class="flow-trade-settings"><summary>交易设置 · 买' + esc(state.buyOrders) + '笔／卖' + esc(state.sellOrders) + '笔 · 股价' + esc(state.sharePriceUsd) + ' USD</summary><div class="flow-inline-controls flow-trade-inputs">' + field('sharePriceUsd', '买入均价', 'USD/股') + field('buyOrders', '买入笔数', '笔') + field('sellOrders', '卖出笔数', '笔') + '</div></details>';
    thirdControls += brokerOffers(s);
    if (s.broker.id === 'hsbc' && state.trade25) thirdControls += '<div class="flow-inline-controls flow-trade-inputs">' + field('otherTurnoverHkd', '每个交易月已用成交额', 'HKD') + '</div>';
    if (s.broker.id === 'za' && state.zaLv2) thirdControls += '<div class="flow-inline-controls flow-trade-inputs">' + field('usedPromoOrders', '每月已用优惠笔数', '笔') + '</div>';
    if (s.broker.id === 'usmart' && state.usmartPromo) thirdControls += '<div class="flow-inline-controls flow-trade-inputs">' + field('usmartDays', '开户距今天数', '天') + '</div>';
    const conversion = currency !== 'USD' ? feeRow(r, 'brokerSpread', (s.fxMode === 'bank' ? s.bank.name : s.broker.name) + ' · ' + currency + '换美元点差', r?.entryPrice ? '1 USD = ' + num(r.entryPrice, 5) + ' ' + currency + (r.indicativeFx ? ' · 参考中间价，成交点差另计' : '') : '') + feeRow(r, 'brokerFx', '换美元佣金', s.fxMode === 'manual' ? '0.002%，最低2 USD' : s.fxMode === 'auto' ? '自动换汇加价0.03%' : '', 'USD') : '';
    const internal = s.broker.integratedBank === s.bank.id;
    const transfer = feeRow(r, 'depositBank', null, '', ['chats', 'internal'].includes(s.depositMethod || state.depositMethod) ? 'USD' : 'HKD') + (internal ? '' : feeRow(r, 'depositOther', null, '', 'USD')) + (s.broker.integratedBank ? '' : feeRow(r, 'depositBroker', s.broker.name + ' · 入金', '', 'USD'));
    let third = errorFor('03') + (s.fxMode === 'bank' ? conversion + transfer : transfer + conversion);
    third += r?.trading?.overridden ? feeRow(r, 'trade', '买卖交易费 · 实际金额', '', 'USD') : tradingSide(r, 'buy') + tradingSide(r, 'sell');
    const trade25 = s.broker.id === 'hsbc' && state.trade25;
    third += feeRow(r, 'brokerAccount', null, trade25 ? '仅美股月费豁免，直至另行通知' : s.broker.id === 'hsbc' ? '5 USD/月；2026年底前及有交易月份豁免' : '', trade25 ? 'HKD' : 'USD');
    if (!r?.trading && !data.selected) third += '<p class="flow-tariff">' + esc(s.broker.feeText) + '</p>';
    html += section('03', '买卖美股', thirdAside, shortName(s.broker) + ' · 入金、买入与卖出', thirdControls, third,
      stageBalance(r, r?.steps?.proceedsUsd == null ? null : r.steps.proceedsUsd - (r.taxCny || 0) / r.refs.USD, 'USD', '卖出后余额', 2), r);

    const fourthAside = accountButton('outcome', '资金用途', outcomes.find(([id]) => id === state.outcome)?.[1] || '') +
      accountButton('returnBank', '取回／消费银行', shortName(s.returning)) + (state.outcome === 'mainland' ? accountButton('exitBank', '内地收款银行', shortName(s.exit)) : '');
    const internalReturn = s.broker.integratedBank === s.returning.id;
    let last = errorFor('04') + (internalReturn ? '' : feeRow(r, 'withdraw', null, '', 'USD') + feeRow(r, 'returnInward', null, '', s.broker.integratedBank ? 'USD' : 'HKD'));
    if (row(r, 'withdrawMiddle')?.cny !== 0) last += feeRow(r, 'withdrawMiddle');
    if (state.outcome === 'mainland') last += feeRow(r, 'returnWire', s.returning.name + ' → ' + s.exit.name + ' · 汇出', '', 'HKD') + feeRow(r, 'returnOther') + feeRow(r, 'exitFx', s.exit.name + ' · 美元结汇', r?.exitPrice ? '1 USD = ' + num(r.exitPrice, 5) + ' CNY' : '');
    if (state.outcome === 'cnh-card') last += feeRow(r, 'exitFx', '中银香港 · 美元换人民币', r?.exitPrice ? '1 USD = ' + num(r.exitPrice, 5) + ' CNH' : '');
    last += feeRow(r, 'card', null, '多币种扣账卡直接刷卡 · 对应币种余额充足', r?.currency || 'USD');
    if (state.outcome === 'usd-balance') last += charge('美元留在' + s.returning.name, 0, '不换汇');
    if (row(r, 'extra')?.cny > 0) last += feeRow(r, 'extra');
    html += section('04', '取回与使用', fourthAside, outcomes.find(([id]) => id === state.outcome)?.[1] || '资金用途',
      state.outcome === 'mainland' ? '<div class="flow-inline-controls">' + select('returnMethod', '汇回渠道', returnMethods(s), s.returnMethod || state.returnMethod) + '</div>' : '', last, '', r);
    return html;
  }
  function summary(data) {
    const r = data.selected;
    if (!r) return '<div class="flow-result"><span>全程损耗与最终余额：报价补齐后显示</span></div><div class="flow-bottom-links">' + action('收费依据与逐笔核对', 'detail', 'data-value="cost"', 'text-link') + action('调整成交报价', 'detail', 'data-value="quotes"', 'text-link') + '</div>';
    const gaps = r.rows.filter(x => x.cny == null), blocked = gaps.some(x => !variableCharge(x));
    const cost = r.costCny, indicative = !!r.indicativeFx;
    const stale = r.missing.filter(text => text.includes('超过3天'));
    return '<div class="flow-result"><div><span>' + (blocked ? '最终余额暂不可算' : gaps.length || indicative ? '估算余额 · 未扣浮动费用' : state.outcome.includes('card') ? '可消费金额' : '最终余额') + '</span>' + (blocked ? '<b>—</b>' : amount(r.net, r.currency)) + '</div><div><span>' + (gaps.length || indicative ? '已知费用 · 含换汇点差' : '费用合计 · 含换汇点差') + '</span>' + amount(cost, 'CNY') + '</div><div><span>' + (gaps.length || indicative ? '全程已知损耗率' : '全程损耗率') + '</span><b class="num">' + (blocked ? '—' : pct(cost / r.budgetCny)) + '</b><small>费用合计 ÷ 人民币本金</small></div></div>' +
      (stale.length ? '<p class="flow-error flow-result-warning">' + stale.map(esc).join('；') + '</p>' : '') + '<div class="flow-bottom-links">' + action('收费依据与逐笔核对', 'detail', 'data-value="cost"', 'text-link') + action('调整成交报价', 'detail', 'data-value="quotes"', 'text-link') + '<span>银行管理费计入全程费用</span></div>';
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
    return H.head('CROSS-BORDER MONEY', '跨境资金', '银行、买股账户和资金用途，沿着路线逐步选择。') +
      '<div class="page-money-flow"><div id="flow-live-presets">' + quickPlans() + '</div>' +
      '<div id="flow-live-diagram" class="flow-journey">' + diagram(data) + '</div><div id="flow-live-summary" class="flow-summary-card">' + summary(data) + '</div>' +
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
    for (const [id, renderer] of [['flow-live-presets', quickPlans], ['flow-live-diagram', diagram], ['flow-live-summary', summary]]) {
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
    const titles = { startBank: '选择出发银行', bank: '选择香港收款银行', broker: '选择买美股的账户', outcome: '选择资金用途', returnBank: '选择取回／消费银行', exitBank: '选择内地收款银行' };
    const small = controlOptions.get(key), mainland = ['startBank', 'exitBank'].includes(key), bank = ['bank', 'returnBank'].includes(key);
    const values = key === 'outcome' ? outcomes.map(([id, name]) => ({ id, name })) : mainland ? D.mainlandBanks : bank ? D.hkBanks : key === 'broker' ? D.brokers : (small?.values || []).map(([id, name]) => ({ id, name }));
    const comparison = key === 'startBank' ? M.purchaseComparison({ ...state, date: today() }, D, window.MONEY_FLOW_QUOTES || {}) : null;
    const copy = item => key === 'broker' ? item.feeShort : mainland ? state.route === 'CNH' && !item.cnhTariff && item.id !== 'abc' ? '本页未收录该行人民币跨境资费；外汇优惠不能直接套用' : item.feeText : bank ? item.id === 'bochk' ? '内地中行同名汇入0；本地美元转账0；管理费0' : item.condition : key === 'outcome' ? ({ 'usd-balance': '保留美元余额，无需结汇', 'usd-card': '支持美元的多币种扣账卡原币消费', 'cnh-card': '中银香港美元换CNH后直接刷卡', mainland: '汇回本人内地银行，再按该行买入价结汇' })[item.id] : '';
    const price = item => {
      if (!comparison || state.route === 'CNH') return '';
      const q = comparison.rows.find(x => x.bank.id === item.id);
      return '<span class="flow-picker-price">' + (q?.sell ? '<b>' + num(q.sell, 5) + '</b><small>CNY/' + state.route + (q.quote?.spreadDiscount ? ' · 五折点差' : '') + '</small><em>' + (q.lossRate == null ? '牌价超过3天' : q.lossRate < 1e-9 ? '相对损耗 0.000%' : '少得 ' + pct(q.lossRate)) + '</em>' : '<small>未公开该币种牌价</small>') + '</span>';
    };
    H.openModal(H.modalTitle(titles[key] || small?.label || '选择') + (comparison?.best ? '<p class="flow-picker-caption">同额人民币购' + state.route + '，以当前最低卖出价为基准；汇款费另列。牌价为不同采集时点。</p>' : '') + '<div class="flow-picker">' + [...values].sort((a, b) => (b.id === state[key]) - (a.id === state[key]) || (comparison ? (comparison.rows.find(x => x.bank.id === a.id)?.comparable ? comparison.rows.find(x => x.bank.id === a.id).sell : Infinity) - (comparison.rows.find(x => x.bank.id === b.id)?.comparable ? comparison.rows.find(x => x.bank.id === b.id).sell : Infinity) : 0)).map(item => action('<span class="flow-picker-copy"><strong>' + esc(item.name) + '</strong><small>' + esc(copy(item) || '') + '</small></span>' + price(item) + '<b>' + (item.id === state[key] ? '✓' : '选择') + '</b>', 'pick-choice', 'data-field="' + key + '" data-value="' + esc(item.id) + '" aria-pressed="' + (item.id === state[key]) + '"', 'flow-picker-option')).join('') + '</div>');
  }
  function detail(key) {
    const data = result(), r = data.selected || data.partial;
    let title = '收费依据', content = '', keys = Object.keys(D.sources);
    if (key === 'quotes') {
      title = '成交报价'; keys = ['bocFx', 'bochkUsdFx'];
      content = '<div class="flow-parameter-grid">' + field('startSell', '每1汇出外币的人民币购入价', 'CNY', '所选银行牌价') + field('entryPrice', '香港每1USD的原币购入价', r?.route || '原币', '对应银行牌价／参考价') + field('exitPrice', '每1USD换回的金额', r?.currency || 'CNY', '对应银行牌价') + '</div>';
    } else if (key === 'mainland') {
      title = '适用条件'; keys = ['safe', 'pbcRmb', 'scCnTerms', 'csrc'];
      content = '<p>大陆个人便利化购汇不能用于境外证券投资，同名香港账户不改变用途限制。银行免费汇款、券商接受入金和资金出境许可是不同条件。本页计算费用，不代替实际资金来源与用途审核。</p>';
    } else {
      keys = [...(r?.start?.sources || data.selection?.start?.sources || []), 'cibCard', 'cmbTariff', 'bochkSame', 'bocMobile2026', 'bocMobileGuide', 'bocMobileHistory', 'boc', 'bochk', 'za', 'zaLocalUsd', 'hsbcUsTariff', 'trade25Age', 'hsbcOne', 'bochkCard', 'hsbcCard', ...(r?.broker.sources || [])];
      content = '<h3>中行 → 中银香港</h3><p>中银香港官网确认同名个人账户的基本汇入手续费豁免。内地汇出手续费、电讯费按2026年公开报道及转账实录的双免情景计算，证据等级为公开报道；并非根据2025年公告推定全国永久免费。代理行费不在中银香港的豁免范围，购汇点差单独计算。</p>' +
        '<h3>银行与股票账户</h3><p>香港收款银行独立选择。中银香港向本人ZA／汇丰美元账户走本地CHATS；两端银行的本地资费均为0。ZA官方直连银行名单包括中银香港和汇丰。银行证券账户用本行美元存款交收，持有其他收款银行不受限制。</p>' +
        '<h3>Trade25仅美股</h3><p>汇丰2026年9月美股收费表第3、10页明确豁免美国股票月费至另行通知。每月首25万港元累计成交额度及首次跨额整单免佣；后续订单按标准佣金。仅美股不扣25 HKD月费。HSBC One账户管理费及监管费另算。普通证券账户的5 USD托管月费豁免至2026年底，之后有交易月份免收。</p>' +
        '<h3>消费与计价</h3><p>美元原币消费要求支持USD的多币种扣账卡且余额充足。人民币刷卡使用中银香港USD/CNH现汇买入价，不能复用内地USD/CNY结汇价。仅计算直接刷卡，不含支付宝、微信或商户另收费用；不预扣尚未发生的现金回赠。</p>';
      if (r?.rows) content += '<h3>当前路线逐笔金额（CNY）</h3><div class="flow-cost-detail">' + r.rows.flatMap(item => item.items || [item]).map(item => '<div><span>' + esc(item.label) + '</span><b>' + (item.cny == null ? esc(item.status || '随实际汇路或成交报价确定') : feeText(item.cny)) + '</b></div>').join('') + '</div><p>参考值：1 USD = ' + num(r.refs.USD, 6) + ' CNY；1 HKD = ' + num(r.refs.HKD, 6) + ' CNY。月费先算原币单价×月数，再按此参考值折算，不将每月价与全年金额并列。</p>';
    }
    if (key === 'cost' && Number.isFinite(r?.netCny)) content += '<p>人民币核对：' + num(r.budgetCny) + '（本金）＋' + num(r.profitUsd * r.refs.USD) + '（盈亏）−' + num(r.costCny) + '（费用）−' + num(r.taxCny) + '（税款）＋' + num(r.fxImpactCny) + '（币种及牌价时点折算影响）＝' + num(r.netCny) + ' CNY（余额折合）。每步损耗率统一为已列费用除以本金；购汇比较则以同额人民币在当前最低卖出价下取得的外币为基准。</p>';
    H.openModal(H.modalTitle(title) + '<div class="flow-detail">' + content + '<div class="flow-detail-sources">' + [...new Set(keys)].map(source).join('') + '</div></div>');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('money-flow-', ''), value = button.dataset.value;
    if (act === 'pick' || act === 'control-pick') { picker(value); return; }
    if (act === 'preset') {
      const preset = presets.find(p => p.id === value); if (!preset) return;
      clear(quoteKeys);
      state = { ...state, ...preset.config, plan: preset.id, outcome: 'usd-balance', useVoucher: false, tradeFeeUsd: '', returnMethod: preset.config.returnBank === 'bochk' ? 'bochk-fast' : 'swift' };
      save(); refresh(); return;
    }
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
