(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel, STORE = 'changheng.money-flow.v4';
  const defaults = { budgetCny: '100000', currency: 'CNY', plan: 'custom', activeStep: '01', startBank: 'cib', route: 'USD', bank: 'bochk', returnBank: 'bochk', exitBank: 'hsbc', outcome: 'broker-balance',
    mainlandMethod: 'swift', depositMethod: 'chats', fxMode: 'manual', returnMethod: '', comparison: 'start', count: '1', usedFreeTransfers: '0',
    months: '12', balanceHkd: '0', returnBalanceHkd: '0', profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1', tradeFeeUsd: '',
    broker: 'za', buyOrders: '1', sellOrders: '1', sharePriceUsd: '100', trade25: false, chiefMonthly: false, usmartPromo: false, zaLv2: false,
    hsbcBalanceWaiver: false, otherTurnoverHkd: '0', usedPromoOrders: '0', usmartDays: '0', useVoucher: false, voucherScope: 'platform', voucherUsd: '0', voucherOrders: '1', voucherExpiry: '',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', inwardHkd: '', intermediaryCny: '',
    returnWireHkd: '', returnExtraCny: '', monthlyHkd: '', returnMonthlyHkd: '', startSell: '', entryPrice: '', exitPrice: '',
    usdCny: '', usdHkd: '', usdCnh: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  if (Object.keys(stored).length && !stored.outcome) stored.outcome = 'mainland';
  let state = { ...defaults, ...stored, currency: 'CNY' }, H, timer;
  if (!['01', '02', '03', '04'].includes(state.activeStep)) state.activeStep = '01';
  const catalog = (key, all) => D.calculator[key].map(id => all.find(x => x.id === id)).filter(Boolean);
  const mainland = catalog('mainland', D.mainlandBanks), banks = catalog('hkBanks', D.hkBanks), brokers = catalog('brokers', D.brokers);
  const comparisonData = { ...D, mainlandBanks: mainland };
  const quoteKeys = ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'returnMonthlyHkd', 'startSell', 'entryPrice', 'exitPrice', 'usdCny', 'usdHkd', 'usdCnh'];
  const outcomes = [['broker-balance', '留在买股账户'], ['usd-balance', '取回香港银行 · 保留美元'], ['usd-card', '美元原币消费'], ['cnh-card', '换人民币后消费'], ['mainland', '汇回内地结汇']];
  const currencyNames = { USD: '美元', HKD: '港币', CNH: '人民币原币' };
  const stageNames = ['内地出发', '香港收款', '入金与买股', '卖出后的资金'];
  const stageKeys = [['entryFx', 'sender', 'entryMiddle'], ['entryInward', 'account'],
    ['depositBank', 'depositOther', 'depositBroker', 'brokerSpread', 'brokerFx', 'trade', 'brokerAccount'],
    ['withdraw', 'returnInward', 'withdrawMiddle', 'returnWire', 'returnOther', 'exitFx', 'card', 'extra']];
  const options = new Map();
  const esc = value => H.esc(value), num = (value, digits = 2) => Number.isFinite(Number(value)) && value != null ? H.money(Number(value), digits) : '—';
  const action = (label, act, extra = '', cls = 'btn') => H.action(label, 'money-flow-' + act, cls, extra);
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {} };
  const pct = value => num(value * 100, 3) + '%';
  const quoteNum = value => num(value, 8).replace(/0+$/, '').replace(/\.$/, '');
  const shortName = value => value?.name?.replace(' · Pro Fixed', '').replace(' · 网上直属客户', '').replace(' · 个人标准账户', '').replace(' · 美股交易', '').replace(' · Trade25 / 普通证券', '证券') || '请选择';
  const cost = value => value == null ? '—' : Math.abs(value) > 0 && Math.abs(value) < .005 ? (value < 0 ? '−' : '') + '＜0.01 CNY' : num(value) + ' CNY';
  const amount = (value, currency) => '<b class="num">' + num(value) + ' <small>' + esc(currency) + '</small></b>';
  const source = key => D.sources[key] ? '<a class="source-link" target="_blank" rel="noopener noreferrer" href="' + esc(D.sources[key].url) + '">' + esc(D.sources[key].name) + ' ↗</a>' : '';
  let cacheKey, cacheResult;
  function result() {
    const inputs = { ...state, date: today() }, key = JSON.stringify(inputs);
    if (key !== cacheKey) { cacheKey = key; cacheResult = M.calculatorJourney(inputs, D, window.MONEY_FLOW_QUOTES || {}); }
    return cacheResult;
  }
  const selected = () => ({ start: D.mainlandBanks.find(x => x.id === state.startBank), bank: D.hkBanks.find(x => x.id === state.bank),
    broker: M.selectedBroker(state, D), returning: D.hkBanks.find(x => x.id === state.returnBank), exit: D.mainlandBanks.find(x => x.id === state.exitBank) });
  const row = (r, key) => r?.rows?.find(x => x.key === key);
  function field(key, label, unit = '', placeholder = '') {
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input ' +
      (key === 'voucherExpiry' ? 'type="date"' : 'type="text" inputmode="decimal"') + ' data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' +
      (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div></label>';
  }
  function checkbox(key, label) {
    return '<label class="flow-offer"><input type="checkbox" data-money-check="' + key + '"' + (state[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function select(key, label, values, value = state[key]) {
    options.set(key, { label, values });
    const current = values.find(([id]) => id === value);
    return '<div class="flow-field"><span>' + esc(label) + '</span>' + (values.length > 1 && values.length <= 3 && ['route', 'fxMode', 'voucherScope'].includes(key) ?
      '<div class="flow-segments" role="group" aria-label="' + esc(label) + '">' + values.map(([id, text]) => action(esc(text), 'choose', 'data-field="' + key + '" data-value="' + esc(id) + '" aria-pressed="' + (id === value) + '"', 'flow-segment')).join('') + '</div>' :
      action('<span>' + esc(current?.[1] || '请选择' + label) + '</span><span aria-hidden="true">⌄</span>', 'control-pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + (current?.[1] || '请选择')) + '"', 'flow-control-button')) + '</div>';
  }
  function account(key, label, item) {
    return action('<span><small>' + esc(label) + '</small><strong>' + esc(shortName(item)) + '</strong></span><span class="flow-account-change">更换 <i aria-hidden="true">↗</i></span>',
      'pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + shortName(item) + '，更换') + '"', 'flow-account-button');
  }
  function entryMethods() {
    const s = selected(), values = [['swift', s.start?.id === 'cib' ? '普通汇款 · 寰宇人生卡' : s.start?.tariffChannel || '普通汇款 · 公开标准价']];
    if (s.start?.id === 'boc') values.unshift(['boc-mobile', '手机银行 · 向同名境外中行汇款']);
    if (s.start?.id === 'cib') values.push(['cib-go', '小额全额到账 · 另加50 CNY/笔']);
    if (['hsbc', 'hang', 'sc'].includes(s.start?.id)) values.unshift(['linked', ({ hsbc: '同名环球转账', hang: '同名跨域转账', sc: '优先理财 · 同名速汇' })[s.start.id] + ' · 免费']);
    return values;
  }
  function depositMethods() {
    const s = selected(), currency = state.fxMode === 'bank' ? 'USD' : state.route;
    if (s.broker.integratedBank) return s.broker.integratedBank === s.bank?.id ? [['internal', '本行存款直接交收']] : [['chats', '本地美元转账 → 本人' + shortName(banks.find(b => b.id === s.broker.integratedBank)) + '账户']];
    return [...(s.broker.internalFundingBanks?.includes(s.bank?.id) ? [['internal', '同行转账 → 券商收款账户 · 免费']] : []),
      ...(currency === 'USD' ? [['chats', '本地美元转账 · CHATS'], ['swift', '美元电汇 · SWIFT']] : [['fps', '本地转账 · FPS'], ['edda', '券商发起扣款 · eDDA'], ['swift', '外币电汇 · SWIFT']])];
  }
  function returnMethods() {
    const s = selected(), values = [['swift', '普通网上电汇']];
    if (s.returning?.id === 'bochk') values.unshift(['bochk-fast', '中银快汇 → 同名内地中行']);
    if (['hsbc', 'hang', 'sc'].includes(s.returning?.id)) values.unshift(['linked', '两地同集团 · 同名专用转账']);
    return values;
  }
  const presets = [
    { id: 'cib-usd', title: '兴业 → 汇丰 → 汇丰证券', note: '内地购美元点差五折；可选Trade25美股优惠', config: { startBank: 'cib', bank: 'hsbc', broker: 'hsbc', route: 'USD', mainlandMethod: 'swift', returnBank: 'hsbc' } },
    { id: 'cib-za', title: '兴业 → 中银香港 → ZA', note: '内地购美元；中银香港转本人ZA美元账户免费', config: { startBank: 'cib', bank: 'bochk', broker: 'za', route: 'USD', mainlandMethod: 'swift', returnBank: 'bochk' } },
    { id: 'boc-mobile', title: '中行 → 中银香港 → 盈立', note: '手机银行同名双免情景；盈立中银香港同行入金免费', config: { startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', mainlandMethod: 'boc-mobile', returnBank: 'bochk' } },
    { id: 'hsbc-linked', title: '汇丰两地同名 → 汇丰证券', note: '已连通环球转账的账户；跨境转账免费', config: { startBank: 'hsbc', bank: 'hsbc', broker: 'hsbc', route: 'USD', mainlandMethod: 'linked', returnBank: 'hsbc' } },
    { id: 'boc-ibkr', title: '中行 → 中银香港 → IBKR', note: '内地购美元；IBKR每单1 USD起，平台费0', config: { startBank: 'boc', bank: 'bochk', broker: 'ibkr', route: 'USD', mainlandMethod: 'boc-mobile', returnBank: 'bochk' } }
  ];
  function presetState(p) {
    const next = M.calculatorRoute({ ...state, ...p.config, plan: p.id, activeStep: '01', fxMode: '', depositMethod: '', returnMethod: '' });
    for (const key of quoteKeys) next[key] = '';
    next.tradeFeeUsd = ''; next.useVoucher = false;
    return next;
  }
  function toolbar() {
    return '<div class="flow-toolbar"><div>' + action('快捷方案 <span aria-hidden="true">⌄</span>', 'presets', 'aria-haspopup="dialog"', 'btn flow-quick-button') +
      '<span>' + esc(presets.find(p => p.id === state.plan)?.title || '自由组合') + '</span></div>' +
      '<div>' + action('报价与依据', 'detail', 'data-value="quotes"', 'text-link') + action('重置', 'reset', '', 'text-link') + '</div></div>';
  }
  function rail() {
    const s = selected(), names = [shortName(s.start), shortName(s.bank), shortName(s.broker), outcomes.find(([id]) => id === state.outcome)?.[1] || '请选择用途'];
    const descriptions = [currencyNames[state.route] + '汇出', '香港本人银行账户', s.broker.integratedBank ? '银行证券交易' : '独立券商',
      state.outcome === 'broker-balance' ? shortName(s.broker) : shortName(s.returning) + (state.outcome === 'mainland' ? ' → ' + shortName(s.exit) : '')];
    return '<nav class="flow-route" aria-label="资金路线"><ol>' + names.map((name, i) => {
      const n = String(i + 1).padStart(2, '0');
      return '<li>' + action('<span class="flow-route-number">' + n + '</span><span><small>' + stageNames[i] + '</small><strong>' + esc(name) +
        '</strong><em>' + esc(descriptions[i]) + '</em></span><i aria-hidden="true">›</i>', 'step',
        'data-value="' + n + '" data-flow-stage="' + n + '" aria-current="' + (state.activeStep === n ? 'step' : 'false') + '" aria-controls="flow-live-editor"', 'flow-route-stop') + '</li>';
    }).join('') + '</ol><div class="flow-route-budget"><span>人民币本金</span>' + amount(M.number(state.budgetCny), 'CNY') + '</div></nav>';
  }
  function currentRows(r) { return (r?.rows || []).filter(x => stageKeys[Number(state.activeStep) - 1].includes(x.key)); }
  function metric(r) {
    const rows = currentRows(r), denominator = M.number(state.budgetCny);
    if (!rows.length || !denominator) return '';
    const sum = rows.reduce((s, x) => s + (x.cny || 0), 0), unknown = rows.some(x => x.cny == null);
    const blocked = rows.some(x => x.cny == null && !['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(x.key));
    const freshness = r.quoteFreshness, stale = freshness && (freshness.reference === false || state.activeStep === '01' && freshness.source === false ||
      state.activeStep === '03' && freshness.entryMarket === false || state.activeStep === '04' && freshness.exit === false);
    return '<div class="flow-stage-metric"><span>' + (stale ? '本步报价已过期' : '本步损耗' + (unknown ? '下限' : '')) + '</span><b class="num">' + (blocked || stale ? '—' : (unknown ? '≥ ' : '') + pct(sum / denominator)) +
      '</b><small>' + (stale ? '历史测算 ' : unknown ? '已计 ' : '') + cost(sum) + '</small></div>';
  }
  function feeLine(label, cny, description = '', native = '') {
    return '<div class="flow-fee-line"><div><strong>' + esc(label) + '</strong>' + (description ? '<small>' + esc(description) + '</small>' : '') +
      '</div><div>' + (cny == null ? '<span class="flow-variable">' + esc(native || '随实际汇路收费') + '</span>' : '<b class="num">' + esc(native || cost(cny)) + '</b>' + (native ? '<small>≈ ' + cost(cny) + '</small>' : '')) + '</div></div>';
  }
  function feeRow(r, key, label, description = '', currency = 'CNY') {
    const item = row(r, key); if (!item) return '';
    return feeLine(label || item.label, item.cny, description, item.cny == null ? item.rangeCny ? item.rangeCny.map(n => num(n)).join('–') + ' CNY' : item.status || '' :
      currency === 'CNY' ? '' : num(item.cny / r.refs[currency]) + ' ' + currency);
  }
  function balance(r, value, currency, label, through) {
    if (!r || value == null || !Number.isFinite(value)) return '';
    const rows = (r.rows || []).filter(x => stageKeys.slice(0, through + 1).flat().includes(x.key));
    const unpriced = rows.filter(x => x.cny == null), freshness = r.quoteFreshness;
    const stale = freshness && (!freshness.source || through >= 2 && freshness.entryMarket === false || through >= 3 && freshness.exit === false);
    const blocked = r.indicativeFx && through >= 2 || stale || unpriced.some(x => !['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(x.key));
    // First-stage remitted amount precedes intermediary deductions.
    const upper = unpriced.length && through > 0;
    return '<div class="flow-stage-balance"><span>' + esc(blocked ? label + ' · 缺成交报价' : upper ? label + '上限' : label) + '</span>' +
      (blocked ? '<b>—</b>' : (upper ? '<span>≤ </span>' : '') + amount(value, currency)) + '</div>';
  }
  function transferHint() {
    if (state.mainlandMethod === 'cib-go') return '附加服务：每笔≤等值10,000 USD，仅限App提供此服务的收款账户；包含境外行费用。';
    if (state.mainlandMethod === 'boc-mobile') return '双免按2026年公开报道情景计算；中银香港同名汇入基本费已获官网确认。';
    if (state.mainlandMethod === 'linked') return state.startBank === 'sc' ? '适用于渣打优先理财、两地同名账户及指定渠道。' : '适用于已连通的两地同名账户及指定转账页面。';
    return '';
  }
  function bankAccountSet(s) {
    return [...new Map([s.bank, banks.find(b => b.id === s.broker.integratedBank), ...(state.outcome === 'broker-balance' ? [] : [s.returning])].filter(Boolean).map(b => [b.id, b])).values()];
  }
  function offers(s, r) {
    const id = s.broker.id;
    let html = id === 'hsbc' ? checkbox('trade25', '已开通Trade25 · 仅美股月费0') : id === 'za' ? checkbox('zaLv2', 'ZA Perks Lv2 · 月前5笔平台费优惠') :
      id === 'chief' ? checkbox('chiefMonthly', 'App月供买入 · 首500 USD免佣／平台费') : id === 'usmart' ? checkbox('usmartPromo', '符合开户180天及指定标的优惠') : '';
    html += checkbox('useVoucher', '使用已获得的费用券');
    if (state.useVoucher) html += '<div class="flow-voucher-fields">' + select('voucherScope', '抵扣范围', [['commission', '佣金'], ['platform', '平台费'], ['both', '两者均可']]) +
      field('voucherUsd', '费用券额度', 'USD') + field('voucherOrders', '适用订单数', '笔') + field('voucherExpiry', '到期日') + '<p>' + esc(M.voucherState(state).message || '本次抵扣 ' + num(r?.trading?.discountUsd || 0) + ' USD') + '</p></div>';
    if (id === 'hsbc' && state.trade25) html += field('otherTurnoverHkd', '每个交易月已用成交额', 'HKD');
    if (id === 'za' && state.zaLv2) html += field('usedPromoOrders', '每月已用优惠笔数', '笔');
    if (id === 'usmart' && state.usmartPromo) html += field('usmartDays', '开户距今天数', '天');
    return '<div class="flow-inline-offers">' + html + '</div>';
  }
  function tradeLine(r, kind) {
    if (!r?.trading || r.trading.overridden) return '';
    const orders = r.trading.orders.filter(o => o.kind === kind), sum = key => orders.reduce((n, o) => n + o[key], 0);
    return feeLine((kind === 'buy' ? '买入' : '卖出') + '美股 · ' + orders.length + '笔', sum('feeUsd') * r.refs.USD,
      '佣金 ' + num(sum('commission')) + '＋平台 ' + num(sum('platform')) + '＋清算／监管 ' + num(sum('sec') + sum('taf') + sum('cat') + sum('clearing')) +
      (sum('discount') ? ' − 券抵扣 ' + num(sum('discount')) : '') + ' USD', num(sum('feeUsd')) + ' USD');
  }
  function editor(data) {
    const r = data.selected || data.partial, s = selected(), n = state.activeStep;
    let controls = '', fees = '', arrival = '', title = '';
    if (n === '01') {
      title = state.route === 'CNH' ? '人民币原币汇往香港' : '内地购' + currencyNames[state.route] + '，再汇往香港';
      controls = account('startBank', '出发银行', s.start) + '<div class="flow-form-grid">' + field('budgetCny', '人民币本金 · 含费用', 'CNY') +
        field('count', '汇出笔数', '笔') + '</div><div class="flow-form-grid">' + select('route', '汇出币种', Object.entries(currencyNames)) +
        select('mainlandMethod', '汇款渠道', entryMethods()) + '</div>';
      if (s.start?.id === 'cib') controls += '<details class="flow-trade-settings flow-transfer-options"><summary>寰宇人生：点差五折 · 优惠期内已汇出' + esc(state.usedFreeTransfers) + '笔</summary><div class="flow-allowance">' + field('usedFreeTransfers', '优惠期内已汇出笔数', '笔') + '<span>前30笔手续费及电讯费免<br>优惠至2027-06-30</span></div></details>';
      if (transferHint()) controls += '<p class="flow-context-note">' + esc(transferHint()) + '</p>';
      fees = feeRow(r, 'entryFx', state.route === 'CNH' ? '原币汇出 · 本步不换汇' : '购汇差额',
        r?.startSell && state.route !== 'CNH' ? '1 ' + state.route + ' = ' + quoteNum(r.startSell) + ' CNY' + (r.entryDiscount ? ' · 已含五折点差' : '') : '');
      const sender = row(r, 'sender');
      if (sender) fees += feeRow(r, 'sender', '汇出收费', (sender.items || []).filter(x => x.cny != null).map(x => x.label + ' ' + num(x.cny) + ' CNY').join(' · '));
      else fees += '<p class="flow-public-tariff">' + esc(s.start?.feeText || '请选择出发银行') + '</p>';
      if (row(r, 'entryMiddle')?.cny != null) fees += feeRow(r, 'entryMiddle', '跨境代理行费', state.mainlandMethod === 'cib-go' ? '已含在全额到账附加服务费内' : '');
      arrival = balance(r, r?.steps?.mainlandForeign, state.route, '实际汇出', 0);
    } else if (n === '02') {
      title = '汇入本人香港银行账户';
      controls = account('bank', '香港收款银行', s.bank) + '<div class="flow-form-grid">' + field('months', '账户使用／持有月数', '月') + '</div>';
      const accounts = bankAccountSet(s);
      if (accounts.some(b => b.id === 'hsbc')) controls += '<div class="flow-bank-condition">' + checkbox('hsbcBalanceWaiver', 'HSBC One已满足免管理费条件') +
        '<small>三个月平均理财总值≥10,000 HKD或其他豁免资格；这是银行账户费用。</small></div>';
      fees = feeRow(r, 'entryInward', shortName(s.bank) + ' · ' + state.route + '汇入',
        s.bank?.id === 'bochk' && s.start?.id === 'boc' ? '同名中行汇款，基本汇入费豁免' : state.mainlandMethod === 'cib-go' ? '已含全额到账附加服务' : '', 'HKD');
      if (row(r, 'account')) fees += row(r, 'account').items.map(x => feeLine(x.label, x.cny, num(x.monthlyHkd) + ' HKD/月 × ' + num(x.months, 0) + '个月', num(x.cny / r.refs.HKD) + ' HKD')).join('');
      else fees += '<p class="flow-public-tariff">' + accounts.map(b => esc(shortName(b)) + '管理费：' + (b.id === 'hsbc' && state.hsbcBalanceWaiver ? '已选豁免' : num(b.monthlyHkd) + ' HKD/月')).join('；') + '</p>';
      arrival = balance(r, r?.steps?.hongKong, state.route, '初次到账', 1);
    } else if (n === '03') {
      title = '转入买股账户，买入与卖出';
      controls = account('broker', '买美股的账户', s.broker);
      if (state.route !== 'USD') controls += select('fxMode', '这一步换成美元', [...(s.broker.id === 'ibkr' ? [['manual', 'IBKR手动换汇'], ['auto', 'IBKR自动换汇']] : []),
        ['bank', shortName(s.bank) + '换汇']]);
      controls += '<div class="flow-form-grid">' + select('depositMethod', '从' + shortName(s.bank) + '转入', depositMethods()) + '</div>' +
        '<details class="flow-trade-settings"><summary>交易设置 · 买' + esc(state.buyOrders) + '笔／卖' + esc(state.sellOrders) + '笔 · 股价' + esc(state.sharePriceUsd) +
        ' USD</summary><div class="flow-form-grid">' + field('sharePriceUsd', '买入均价', 'USD/股') + field('buyOrders', '买入笔数', '笔') + field('sellOrders', '卖出笔数', '笔') + '</div></details>' + offers(s, r);
      if (state.route !== 'USD') fees += feeRow(r, 'brokerSpread', (state.fxMode === 'bank' ? shortName(s.bank) : 'IBKR') + '换美元价差',
        r?.entryPrice && !r.indicativeFx ? '1 USD = ' + quoteNum(r.entryPrice) + ' ' + state.route : '') + feeRow(r, 'brokerFx', '换汇佣金／自动加价', '', 'USD');
      fees += feeRow(r, 'depositBank', null, '', 'USD');
      if (row(r, 'depositOther')?.cny > 0) fees += feeRow(r, 'depositOther');
      if (row(r, 'depositBroker')?.cny > 0) fees += feeRow(r, 'depositBroker', null, '', 'USD');
      fees += r?.trading?.overridden || !r?.trading && row(r, 'trade') ? feeRow(r, 'trade', '本次买卖交易费', '', 'USD') : tradeLine(r, 'buy') + tradeLine(r, 'sell');
      if (s.broker.id === 'hsbc' || row(r, 'brokerAccount')?.cny > 0) fees += feeRow(r, 'brokerAccount', null, state.trade25 ? '仅美股月费豁免，银行管理费在第二步' : '2026年底前及有交易月份豁免', 'USD');
      if (!r?.trading) fees += '<p class="flow-public-tariff">' + esc(s.broker.feeText) + '</p>';
      arrival = balance(r, r?.steps?.proceedsUsd, 'USD', '卖出后余额 · 税前', 2);
    } else {
      title = outcomes.find(([id]) => id === state.outcome)?.[1] || '选择资金用途';
      controls = select('outcome', '资金用途', outcomes);
      if (state.outcome !== 'broker-balance') controls += account('returnBank', '取回／消费银行', s.returning);
      if (state.outcome === 'mainland') controls += account('exitBank', '内地收款银行', s.exit) + select('returnMethod', '汇回渠道', returnMethods());
      if (state.outcome === 'broker-balance') fees += feeLine('美元留在' + shortName(s.broker), 0, '不出金，不换汇');
      else {
        fees += feeRow(r, 'withdraw', '买股账户出金费', '', 'USD') + feeRow(r, 'returnInward', null, '', s.broker.integratedBank ? 'USD' : 'HKD');
        if (row(r, 'withdrawMiddle')?.cny != null) fees += feeRow(r, 'withdrawMiddle');
      }
      if (state.outcome === 'mainland') fees += feeRow(r, 'returnWire', shortName(s.returning) + ' → ' + shortName(s.exit), '', 'HKD') +
        feeRow(r, 'exitFx', shortName(s.exit) + ' · 美元结汇', r?.exitPrice ? '1 USD = ' + quoteNum(r.exitPrice) + ' CNY' : '');
      if (state.outcome === 'cnh-card') fees += feeRow(r, 'exitFx', shortName(s.returning) + ' · 美元换人民币', r?.exitPrice ? '1 USD = ' + quoteNum(r.exitPrice) + ' CNH' : '');
      if (row(r, 'card')) fees += feeRow(r, 'card', null, '多币种扣账卡直接扣对应币种余额');
      if (row(r, 'extra')?.cny > 0) fees += feeRow(r, 'extra');
      controls += '<details class="flow-trade-settings"><summary>盈亏、出金次数与税款</summary><div class="flow-form-grid">' + field('profitUsd', '卖出盈亏 · 交易费前', 'USD') +
        field('withdrawalIndex', '本月第几次出金', '次') + field('taxRate', '应税所得税率', '%') + field('taxableCny', '人民币应税所得', 'CNY', '按正净利润估算') + field('creditCny', '税款抵免', 'CNY') + '</div></details>';
      if (r?.taxCny > 0) fees += feeLine('预留税款 · 单列，不计手续费损耗', r.taxCny);
    }
    const errorStage = data.partial?.errorStage || data.errorStage || '01';
    const error = data.error && errorStage === n ? '<p class="flow-error" role="status">' + esc(data.error) + '</p>' : '';
    const gaps = currentRows(r).filter(x => x.cny == null);
    const gapLine = gaps.length ? '<div class="flow-gap-note">' + action(esc(gaps.map(x => x.key === 'entryMiddle' ? '跨境代理行费' : x.label).join('、')) + '：查看计费条件 ↗', 'detail', 'data-value="cost"', 'text-link') + '</div>' : '';
    return '<section class="flow-editor" aria-label="' + stageNames[Number(n) - 1] + '"><header><div><span class="flow-eyebrow">' + n + ' / 04 · ' + stageNames[Number(n) - 1] + '</span><h2>' + esc(title) +
      '</h2></div>' + metric(r) + '</header>' + controls + error + '<div class="flow-fees">' + fees + '</div>' + gapLine + arrival +
      '<footer class="flow-step-navigation">' + (n !== '01' ? action('← 上一步', 'step', 'data-value="' + String(Number(n) - 1).padStart(2, '0') + '"', 'text-link') : '<span></span>') +
      action('本步费用明细', 'detail', 'data-value="stage"', 'text-link') + (n !== '04' ? action('下一步：' + stageNames[Number(n)], 'step', 'data-value="' + String(Number(n) + 1).padStart(2, '0') + '"', 'btn flow-next') : '<span></span>') + '</footer></section>';
  }
  function summary(data) {
    const r = data.selected || data.partial;
    if (!data.selected) return '<div class="flow-result flow-result-incomplete"><strong>全程结果</strong><span>' + esc(data.error || '请选择路线') + '</span>' +
      action('查看对应步骤 →', 'step', 'data-value="' + (data.partial?.errorStage || data.errorStage || '01') + '"', 'text-link') + '</div>';
    const gaps = r.rows.filter(x => x.cny == null), stale = r.missing.some(x => x.includes('超过3天'));
    const variableOnly = gaps.every(x => ['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(x.key));
    const blocked = !variableOnly || !!r.indicativeFx || stale;
    const prefix = gaps.length ? '≥ ' : '';
    return '<div class="flow-result"><div><span>' + (gaps.length ? '已计损耗下限' : '全程损耗') + '</span><b class="num">' + (blocked ? '—' : prefix + pct(r.costCny / r.budgetCny)) +
      '</b><small>' + (blocked ? '交易金额仍缺有效报价' : prefix + cost(r.costCny)) + '</small></div><div><span>' +
      (blocked ? '最终余额 · 暂不可算' : gaps.length ? '最终余额上限' : state.outcome.includes('card') ? '可消费金额' : '最终余额') + '</span>' +
      (blocked ? '<b>—</b>' : (gaps.length ? '<span class="flow-bound">≤ </span>' : '') + amount(r.net, r.currency)) + '<small>' +
      esc(state.outcome === 'broker-balance' ? shortName(r.broker) : state.outcome === 'mainland' ? shortName(r.exit) : shortName(r.returning)) + '</small></div>' +
      '<div class="flow-result-detail">' + action('全程费用明细 ↗', 'detail', 'data-value="cost"', 'text-link') +
      (gaps.length ? '<small>' + esc(gaps.length + '项实际汇路／成交报价影响结果') + '</small>' : '<small>同一基准 · 逐项加总</small>') +
      (stale ? '<small class="flow-variable">报价超过3天</small>' : '') + '</div></div>';
  }
  function view(helpers) {
    H = helpers; const data = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '选清账户，算清每一步。') + '<div class="page-money-flow"><div id="flow-live-toolbar">' + toolbar() +
      '</div><div class="flow-workspace"><div id="flow-live-route">' + rail() + '</div><div class="flow-main"><div id="flow-live-editor">' + editor(data) +
      '</div><div id="flow-live-summary" class="flow-summary-card" aria-live="polite">' + summary(data) + '</div></div></div><div class="flow-bottom-tools">' +
      action('实际成交报价与费用', 'detail', 'data-value="adjustments"', 'text-link') + '<span>便利化购汇不得用于境外证券投资；本页为费用测算。</span>' +
      action('适用条件', 'detail', 'data-value="mainland"', 'text-link') + '</div></div>';
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
  function refresh() {
    const data = result();
    for (const [id, render] of [['flow-live-toolbar', toolbar], ['flow-live-route', rail], ['flow-live-editor', editor], ['flow-live-summary', summary]]) {
      const element = document.getElementById(id); if (element) patch(element, render(data));
    }
  }
  function choiceState(key, value) {
    const next = { ...state, [key]: value, plan: 'custom' };
    const reset = {
      startBank: ['startSell', 'senderFeeCny', 'entryMiddleCny', 'mainlandMethod'],
      bank: ['entryInwardHkd', 'depositHkd', 'depositOtherCny', 'monthlyHkd', 'entryPrice', 'mainlandMethod', 'depositMethod'],
      broker: ['tradeFeeUsd', 'entryPrice', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'depositMethod'],
      returnBank: ['inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd', 'returnMethod'],
      route: ['startSell', 'entryPrice', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'fxMode', 'depositMethod', 'mainlandMethod'],
      fxMode: ['entryPrice', 'depositHkd', 'depositOtherCny', 'depositMethod'], depositMethod: ['depositHkd', 'depositOtherCny'],
      mainlandMethod: ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd'], outcome: ['exitPrice'],
      exitBank: ['exitPrice', 'returnExtraCny', 'returnMethod'], returnMethod: ['returnWireHkd', 'returnExtraCny']
    };
    for (const field of reset[key] || []) next[field] = '';
    if (key === 'bank' || key === 'route') { next.senderFeeCny = ''; next.entryMiddleCny = ''; }
    if (key === 'returnBank' && next.outcome === 'cnh-card') next.exitPrice = '';
    if (key === 'broker') {
      next.useVoucher = false; next.voucherScope = value === 'za' ? 'platform' : 'commission';
      if (value !== 'ibkr' && next.route !== 'USD') next.fxMode = 'bank';
    }
    return M.calculatorRoute(next);
  }
  function choose(key, value) {
    const allowed = ['startBank', 'bank', 'broker', 'outcome', 'returnBank', 'exitBank', 'route', 'mainlandMethod', 'depositMethod', 'returnMethod', 'fxMode', 'voucherScope'];
    if (!allowed.includes(key)) return;
    if (['startBank', 'exitBank'].includes(key) && !D.calculator.mainland.includes(value)) return;
    if (['bank', 'returnBank'].includes(key) && !D.calculator.hkBanks.includes(value)) return;
    if (key === 'broker' && !D.calculator.brokers.includes(value)) return;
    state = choiceState(key, value); save(); refresh();
  }
  function picker(key) {
    const titles = { startBank: '选择出发银行', bank: '选择香港收款银行', broker: '选择买美股的账户', outcome: '选择资金用途', returnBank: '选择取回／消费银行', exitBank: '选择内地收款银行' };
    const small = options.get(key), isMainland = ['startBank', 'exitBank'].includes(key), isBank = ['bank', 'returnBank'].includes(key);
    const list = key === 'outcome' ? outcomes.map(([id, name]) => ({ id, name })) : isMainland ? mainland : isBank ? banks : key === 'broker' ? brokers : (small?.values || []).map(([id, name]) => ({ id, name }));
    const comparison = key === 'startBank' ? M.purchaseComparison({ ...state, date: today() }, comparisonData, window.MONEY_FLOW_QUOTES || {}) : null;
    const copy = item => key === 'broker' ? item.feeShort : isMainland ? item.feeText : isBank ?
      ({ bochk: '中行同名汇入0；本地美元转账0；账户月费0', hsbc: '汇入及本地美元转账0；One月费按豁免条件', za: '本地美元转账0；账户月费0；可开美股交易', hang: '同名跨域转账0；本地美元转账0；优进月费0', sc: '本地USD转账标准费22 USD；快易月费0' })[item.id] : '';
    const price = item => {
      const q = comparison?.rows.find(x => x.bank.id === item.id);
      if (!comparison || state.route === 'CNH') return '';
      return '<span class="flow-picker-price">' + (q?.comparable ? '<b>' + quoteNum(q.sell) + '</b><small>CNY/' + state.route + '</small><em>' +
        (q.lossRate < 1e-9 ? '最低可比购汇价' : '购汇少得 ' + pct(q.lossRate)) + '</em>' : '<small>' + (q?.sell ? '报价超过3天' : ['hang', 'sc'].includes(item.id) ? '客户专属购汇价' : '公开牌价暂未更新') + '</small>') + '</span>';
    };
    H.openModal(H.modalTitle(titles[key] || small?.label || '选择') + '<div class="flow-picker">' + list.map(item =>
      action('<span class="flow-picker-copy"><strong>' + esc(item.name) + '</strong>' + (copy(item) ? '<small>' + esc(copy(item)) + '</small>' : '') + '</span>' + price(item) +
        '<span class="flow-picker-check">' + (item.id === state[key] ? '✓ 已选' : '') + '</span>', 'pick-choice',
        'data-field="' + key + '" data-value="' + esc(item.id) + '" aria-pressed="' + (item.id === state[key]) + '"', 'flow-picker-option')).join('') + '</div>' +
      (comparison?.best ? '<p class="flow-picker-caption">购汇价按每1外币计；手续费由所选渠道另算。报价时间见详情。</p>' : ''));
  }
  function showPresets() {
    H.openModal(H.modalTitle('快捷方案', '选好后仍可自由调整银行、买股账户和资金用途。') + '<div class="flow-picker">' + presets.map(p =>
      action('<span class="flow-picker-copy"><strong>' + esc(p.title) + '</strong><small>' + esc(p.note) + '</small></span><span class="flow-picker-check">' + (state.plan === p.id ? '✓ 已选' : '') +
        '</span>', 'preset', 'data-value="' + p.id + '"', 'flow-picker-option')).join('') + '</div>');
  }
  function adjustments() {
    return '<div class="flow-parameter-grid">' + [
      ['startSell', '每1汇出外币的购入价', 'CNY'], ['entryPrice', '香港每1USD的购入价', state.route], ['exitPrice', '每1USD换回金额', state.outcome === 'cnh-card' ? 'CNH' : 'CNY'],
      ['senderFeeCny', '每笔汇出手续费＋电讯费', 'CNY'], ['entryMiddleCny', '每笔跨境代理费', 'CNY'], ['entryInwardHkd', '每笔香港汇入费', 'HKD'],
      ['depositHkd', '股票入金转账费', 'HKD'], ['depositOtherCny', '股票入金收款行／代理费', 'CNY'], ['tradeFeeUsd', '本次买卖实际交易费', 'USD'],
      ['inwardHkd', '出金收款行费', 'HKD'], ['intermediaryCny', '出金代理费', 'CNY'], ['returnWireHkd', '回内地汇出费', 'HKD'], ['returnExtraCny', '回内地其他费用', 'CNY'],
      ['monthlyHkd', '收款银行月费', 'HKD'], ['returnMonthlyHkd', '取回银行月费', 'HKD'], ['balanceHkd', '收款银行保留资产', 'HKD'], ['returnBalanceHkd', '取回银行保留资产', 'HKD'], ['openingCny', '开户实际支出', 'CNY']
    ].map(args => field(...args, '留空使用公开收费')).join('') + '</div><p>' + action('恢复公开报价', 'clear-quotes') + '</p>';
  }
  function detail(key) {
    const data = result(), r = data.selected || data.partial, s = selected();
    let title = '费用明细', content = '', keys = [];
    if (key === 'mainland') {
      title = '适用条件'; keys = ['safe', 'pbcRmb', 'scCnTerms', 'csrc'];
      content = '<p>大陆个人便利化购汇不得用于境外证券投资；同名香港账户不改变用途限制。本页比较收费，实际资金来源、用途和汇款资格由相关机构审核。</p>';
    } else if (key === 'adjustments') {
      title = '实际成交报价与费用'; content = '<p>仅填写已取得的个人报价或回单。更换对应银行、渠道或币种后，该段覆盖值自动清除。</p>' + adjustments();
    } else if (key === 'quotes') {
      title = '汇率与收费依据'; keys = [s.start?.quoteSource, ...(s.start?.sources || []), ...(s.bank?.sources || []), ...(s.broker?.sources || []), 'usmartBocFunding'];
      const q = window.MONEY_FLOW_QUOTES || {}, comparison = M.purchaseComparison({ ...state, date: today() }, comparisonData, q);
      content = '<h3>同一个损耗基准</h3><p>本金扣去各项收费，再按所选报价换汇。内地购汇以本目录当前最低有效卖出价为基准；最优购汇差额为0。各步人民币差额与手续费相加，再除以同一本金。不会再把银行自身买卖中间价差混进另一套损耗率。</p>';
      content += '<div class="flow-cost-detail">' + comparison.rows.map(x => '<div><span>' + esc(x.bank.name) + '<small>' + esc(x.quote?.asOf || (['hang', 'sc'].includes(x.bank.id) ? '未公开客户成交牌价' : '公开牌价暂未更新')) +
        (x.quote?.timeBasis === 'observed' ? ' · 采集时点' : '') + '</small></span><b>' + (x.sell ? quoteNum(x.sell) + ' CNY/' + state.route : '客户专属价') + '</b></div>').join('') + '</div>';
      if (r?.refs) content += '<p>统一折算：1 USD = ' + num(r.refs.USD, 6) + ' CNY；1 HKD = ' + num(r.refs.HKD, 6) + ' CNY。CNY与CNH分开计价。</p>';
      content += '<h3>同名转账豁免</h3><p>中银香港官网确认同名内地中行的基本汇入费豁免，条款不含代理行费。内地手机银行双免采用2026年报道情景；2025年的优惠公告没有自动延长。恒生、汇丰、渣打的免费服务各须符合所列同名渠道和账户条件。</p>';
      keys.push('bochkSame', 'bocMobile2026', 'bocMobileGuide', 'hang', 'hsbcGlobal', 'sc');
    } else {
      const rows = key === 'stage' ? currentRows(r) : r?.rows || [];
      title = key === 'stage' ? stageNames[Number(state.activeStep) - 1] + ' · 费用明细' : '全程费用明细';
      content = rows.length ? '<div class="flow-cost-detail">' + rows.flatMap(x => x.items || [x]).map(x => '<div><span>' + esc(x.label) +
        (x.months != null ? '<small>' + num(x.monthlyHkd) + ' HKD/月 × ' + num(x.months, 0) + '个月</small>' : '') + '</span><b>' +
        (x.cny == null ? esc(x.rangeCny ? x.rangeCny.map(n => num(n)).join('–') + ' CNY' : x.status || '按实际汇路收费；未计入合计') : cost(x.cny)) + '</b></div>').join('') + '</div>' :
        '<p>' + esc(data.error || '选择对应账户后显示资费') + '</p>';
      if (r?.missing?.length) content += '<h3>影响最终金额的项目</h3><ul>' + r.missing.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      if (Number.isFinite(r?.netCny)) content += '<p>' + num(r.budgetCny) + ' 本金 ＋ ' + num(r.profitUsd * r.refs.USD) + ' 盈亏 − ' + num(r.costCny) + ' 成本 − ' + num(r.taxCny) +
        ' 税款' + (Math.abs(r.fxImpactCny || 0) > .005 ? ' ＋ ' + num(r.fxImpactCny) + ' 未报价换汇估值差额' : '') + ' ＝ ' + num(r.netCny) + ' CNY。' + (r.complete ? '' : '未报价项目未扣除，不是最终到账承诺。') + '按完整精度计算，分项显示到分时可能产生四舍五入尾差。</p>';
      keys = [...(s.start?.sources || []), ...(s.bank?.sources || []), ...(s.broker?.sources || []), ...(s.returning?.sources || [])];
    }
    H.openModal(H.modalTitle(title) + '<div class="flow-detail">' + content + '<div class="flow-detail-sources">' + [...new Set(keys)].filter(Boolean).map(source).join('') + '</div></div>');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('money-flow-', ''), value = button.dataset.value;
    if (act === 'step') { if (['01', '02', '03', '04'].includes(value)) { state.activeStep = value; save(); refresh(); document.querySelector?.('[data-action="money-flow-step"][data-value="' + value + '"]')?.focus(); } return; }
    if (act === 'pick' || act === 'control-pick') { picker(value); return; }
    if (act === 'presets') { showPresets(); return; }
    if (act === 'preset') { const p = presets.find(x => x.id === value); if (!p) return; document.getElementById('dialog')?.close(); state = presetState(p); save(); refresh(); return; }
    if (act === 'detail') { detail(value); return; }
    if (act === 'choose' || act === 'pick-choice') { if (act === 'pick-choice') document.getElementById('dialog')?.close(); choose(button.dataset.field, value); return; }
    if (act === 'clear-quotes') { for (const key of quoteKeys) state[key] = ''; state.tradeFeeUsd = ''; save(); document.getElementById('dialog')?.close(); refresh(); return; }
    if (act === 'reset') { state = { ...defaults }; save(); refresh(); }
  }
  function handleInput(el) {
    const key = el.dataset.moneyField; if (!key || !Object.hasOwn(defaults, key)) return false;
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
