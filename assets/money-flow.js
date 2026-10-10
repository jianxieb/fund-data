(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel, STORE = 'changheng.money-flow.v4';
  const defaults = { budgetCny: '100000', currency: 'CNY', plan: 'boc-za', activeStep: '01', startBank: 'boc', route: 'USD', bank: 'bochk', returnBank: 'bochk', exitBank: 'hsbc', outcome: 'broker-balance',
    mainlandMethod: 'boc-mobile', depositMethod: 'chats', fxMode: 'manual', returnMethod: '', comparison: 'start', count: '1', usedFreeTransfers: '0',
    months: '12', balanceHkd: '0', returnBalanceHkd: '0', profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1', tradeFeeUsd: '',
    broker: 'za', buyOrders: '1', sellOrders: '1', sharePriceUsd: '100', trade25: false, chiefMonthly: false, usmartPromo: false, zaLv2: false,
    hsbcBalanceWaiver: false, scCnhAccount: false, otherTurnoverHkd: '0', usedPromoOrders: '0', usmartDays: '0', useVoucher: false, voucherScope: 'platform', voucherUsd: '0', voucherOrders: '1', voucherExpiry: '',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', inwardHkd: '', intermediaryCny: '',
    returnWireHkd: '', returnExtraCny: '', monthlyHkd: '', returnMonthlyHkd: '', startSell: '', entryPrice: '', exitPrice: '',
    usdCny: '', usdHkd: '', usdCnh: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  if (Object.keys(stored).length && !stored.outcome) stored.outcome = 'mainland';
  let state = { ...defaults, ...stored, currency: 'CNY' }, H, timer, modalKey;
  // Earlier versions incorrectly offered the foreign-currency-only Global
  // Link channel for RMB. Keep all accounts and repair that saved method.
  if (state.startBank === 'sc' && state.route === 'CNH' && state.mainlandMethod === 'linked') state.mainlandMethod = 'swift';
  if (state.route !== 'USD' && state.broker !== 'ibkr') state.fxMode = 'bank';
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
    if (values.length === 1 && current) return '<div class="flow-field"><span>' + esc(label) + '</span><div class="flow-control-value">' + esc(current[1]) + '</div></div>';
    return '<div class="flow-field"><span>' + esc(label) + '</span>' + (values.length > 1 && values.length <= 3 && ['route', 'fxMode', 'voucherScope'].includes(key) ?
      '<div class="flow-segments" role="group" aria-label="' + esc(label) + '">' + values.map(([id, text]) => action(esc(text), 'choose', 'data-field="' + key + '" data-value="' + esc(id) + '" aria-pressed="' + (id === value) + '"', 'flow-segment')).join('') + '</div>' :
      action('<span>' + esc(current?.[1] || '请选择' + label) + '</span><span aria-hidden="true">⌄</span>', 'control-pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + (current?.[1] || '请选择')) + '"', 'flow-control-button')) + '</div>';
  }
  function account(key, label, item) {
    return action('<span><small>' + esc(label) + '</small><strong>' + esc(shortName(item)) + '</strong></span><span class="flow-account-change">更换 <i aria-hidden="true">↗</i></span>',
      'pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + shortName(item) + '，更换') + '"', 'flow-account-button');
  }
  function sourceTariffCopy(bank) {
    if (state.route !== 'CNH') return bank.feeText;
    if (bank.cnhTariff?.feeText) return bank.cnhTariff.feeText;
    if (bank.cnhTariff === true) return '人民币跨境' + num(bank.rate * 1000, 0) + '‰，' + bank.minimum + '–' + bank.maximum + '元＋' + bank.telegram + '元电讯费';
    return '人民币跨境汇出手续费／电讯费：尚未取得适用价目';
  }
  function entryMethods() {
    const s = selected(), tariff = state.route === 'CNH' && typeof s.start?.cnhTariff === 'object' ? s.start.cnhTariff : s.start;
    let channel = s.start?.id === 'cib' ? '普通汇款 · 寰宇人生卡' : tariff?.tariffChannel || '普通汇款 · 公开标准价';
    if (state.route === 'CNH') channel = typeof s.start.cnhTariff === 'object' ? tariff.tariffChannel :
      s.start.cnhTariff ? '人民币跨境电汇 · 公开标准价' : '人民币跨境汇款';
    const values = [['swift', channel]];
    if (s.start?.id === 'boc' && s.bank?.id === 'bochk' && state.route !== 'CNH') values.unshift(['boc-mobile', '手机银行 · 向同名境外中行汇款']);
    if (s.start?.id === 'cib' && state.route !== 'CNH') values.push(['cib-go', '小额全额到账 · 另加50 CNY/笔']);
    if (state.route === 'USD' && s.start?.fullAmountUsd != null) values.push(['full', '美元全额到账 · 另加' + s.start.fullAmountUsd + ' USD/笔']);
    if (['hsbc', 'hang', 'sc'].includes(s.start?.id) && s.start.group === s.bank?.group && (!s.start.linkedCurrencies || s.start.linkedCurrencies.includes(state.route))) values.unshift(['linked', ({ hsbc: '同名环球转账', hang: '优越理财 · 同名跨域转账', sc: '优先理财 · 同名速汇' })[s.start.id] + ' · 免费']);
    return values;
  }
  function depositMethods() {
    const s = selected(), currency = state.fxMode === 'bank' ? 'USD' : state.route;
    if (s.broker.integratedBank) return s.broker.integratedBank === s.bank?.id ? [['internal', '本行存款直接交收']] : [['chats', '本地美元转账 → 本人' + shortName(banks.find(b => b.id === s.broker.integratedBank)) + '账户']];
    return [...(s.broker.internalFundingBanks?.includes(s.bank?.id) ? [['internal', '同行转账 → 券商收款账户 · 免费']] : []),
      ...(currency === 'USD' ? s.broker.id === 'ibkr' ? [['chats', '香港收款指示 · USD本地转账'], ['swift', '境外收款指示 · USD电汇']] : [['chats', '本地美元转账 · CHATS'], ['swift', '美元电汇 · SWIFT']] : [
        ...(s.broker.id === 'chief' && currency === 'CNH' ? [] : [['fps', '本地转账 · FPS']]), ['edda', '券商发起扣款 · eDDA'], ['swift', '外币电汇 · SWIFT']])];
  }
  function returnMethods() {
    const s = selected(), values = [['swift', '普通网上电汇']];
    if (s.returning?.id === 'bochk' && s.exit?.group === 'boc') values.unshift(['bochk-fast', '中银快汇 → 同名内地中行']);
    if (['hsbc', 'hang', 'sc'].includes(s.returning?.id) && s.returning.group === s.exit?.group) values.unshift(['linked', '两地同集团 · 同名专用转账']);
    return values;
  }
  const presets = [
    { id: 'boc-za', title: '中行 → 中银香港 → ZA', note: '同名手机汇款；中银转本人ZA美元账户免费', config: { startBank: 'boc', bank: 'bochk', broker: 'za', route: 'USD', mainlandMethod: 'boc-mobile', returnBank: 'bochk' } },
    { id: 'cib-usd', title: '兴业 → 汇丰 → 汇丰证券', note: '内地购美元点差五折；可选Trade25美股优惠', config: { startBank: 'cib', bank: 'hsbc', broker: 'hsbc', route: 'USD', mainlandMethod: 'swift', returnBank: 'hsbc' } },
    { id: 'boc-chief', title: '中行 → 中银香港 → 致富', note: '同名手机汇款；致富同行入金免费、零佣金', config: { startBank: 'boc', bank: 'bochk', broker: 'chief', route: 'USD', mainlandMethod: 'boc-mobile', returnBank: 'bochk' } },
    { id: 'boc-mobile', title: '中行 → 中银香港 → 盈立', note: '手机银行同名双免情景；盈立中银香港同行入金免费', config: { startBank: 'boc', bank: 'bochk', broker: 'usmart', route: 'USD', mainlandMethod: 'boc-mobile', returnBank: 'bochk' } },
    { id: 'hsbc-linked', title: '汇丰两地同名 → 汇丰证券', note: '已连通环球转账的账户；跨境转账免费', config: { startBank: 'hsbc', bank: 'hsbc', broker: 'hsbc', route: 'USD', mainlandMethod: 'linked', returnBank: 'hsbc' } },
    { id: 'boc-ibkr', title: '中行 → 中银香港 → IBKR', note: '香港花旗／渣打USD收款指示；本地转账入金', config: { startBank: 'boc', bank: 'bochk', broker: 'ibkr', route: 'USD', mainlandMethod: 'boc-mobile', returnBank: 'bochk' } },
  ];
  function presetState(p) {
    const next = M.calculatorRoute({ ...state, fxMode: '', depositMethod: '', returnMethod: '', ...p.config, plan: p.id, activeStep: '01' });
    for (const key of quoteKeys) next[key] = '';
    next.tradeFeeUsd = ''; next.useVoucher = false; next.balanceHkd = '0'; next.returnBalanceHkd = '0';
    return next;
  }
  let visiblePresets = [];
  const routeName = (id, kind) => (kind === 'mainland' ? { boc: '中行', cib: '兴业', hsbc: '汇丰中国', hang: '恒生中国', sc: '渣打中国' } :
    kind === 'bank' ? { bochk: '中银香港', hsbc: '汇丰香港', hang: '恒生香港', sc: '渣打香港', za: 'ZA' } :
      { ibkr: 'IBKR', hsbc: '汇丰证券', chief: '致富', usmart: '盈立', za: 'ZA' })[id] || id;
  function candidatePresets() {
    const comparison = M.calculatorRecommendations({ ...state, date: today() }, D, window.MONEY_FLOW_QUOTES || {});
    const best = comparison.plans.map(p => {
      const r = p.result, config = { ...p.config };
      if (state.outcome === 'broker-balance') config.returnBank = state.returnBank;
      if (state.outcome !== 'mainland') config.exitBank = state.exitBank;
      const channel = ({ 'boc-mobile': '手机同名汇款', linked: '两地同名转账', 'cib-go': '全额到账50元/笔', full: '美元全额到账', swift: '普通电汇' })[r.mainlandMethod];
      const funding = r.broker.id === 'ibkr' && r.depositMethod === 'chats' ? '香港花旗／渣打收款指示' :
        r.route !== 'USD' ? (r.fxMode === 'bank' ? routeName(r.bank.id, 'bank') : 'IBKR') + '换美元' : r.depositMethod === 'internal' ? '同行交收' : '本地美元转账';
      const end = state.outcome === 'broker-balance' ? '美元留在' + routeName(r.broker.id, 'broker') :
        state.outcome === 'mainland' ? routeName(r.returning.id, 'bank') + ' → ' + routeName(r.exit.id, 'mainland') + '结汇' :
          routeName(r.returning.id, 'bank') + ' · ' + ({ 'usd-balance': '保留美元', 'usd-card': '美元消费', 'cnh-card': '人民币消费' })[state.outcome];
      return { ...p, config, title: routeName(r.start.id, 'mainland') + ' → ' + routeName(r.bank.id, 'bank') + ' → ' + routeName(r.broker.id, 'broker'),
        note: r.route + ' · ' + channel + '；' + funding, end };
    });
    // Keep a route to every stock venue, including an explicit unpriced result.
    // Incomplete routes are available but never ranked by their small subtotal.
    const covered = new Set(best.map(p => p.config.broker));
    const fallback = presets.filter(p => !covered.has(p.config.broker) && covered.add(p.config.broker));
    return [...best, ...fallback].map(p => {
      const calculated = p.result ? { selected: p.result } : M.calculatorJourney({ ...presetState(p), date: today() }, D, window.MONEY_FLOW_QUOTES || {});
      const r = calculated.selected || calculated.partial, rows = r?.rows || [], complete = !!r?.complete && !!r?.quotedCore;
      return { ...p, calculated, rows, complete, total: rows.reduce((sum, item) => sum + (item.cny ?? 0), 0) };
    }).sort((a, b) => Number(b.complete) - Number(a.complete) || (a.complete && b.complete ? a.total - b.total : 0));
  }
  function toolbar() {
    visiblePresets = candidatePresets();
    return '<div class="flow-toolbar"><h2>优选方案</h2><div><span>按全程损耗排序</span>' + action('报价与依据', 'detail', 'data-value="quotes"', 'text-link') + action('重置', 'reset', '', 'text-link') + '</div></div>' +
      '<div class="flow-presets" aria-label="优选方案">' + visiblePresets.map(p => {
        const { calculated, rows, complete, total } = p, r = calculated.selected || calculated.partial;
        const missing = r?.missing || [calculated.error].filter(Boolean);
        const price = rows.length ? '<span class="flow-preset-price"><small>' + (complete ? rows.some(x => x.estimate) ? '参考总损耗' : '全程损耗' : '已核费用') + '</small><b>' +
          (complete ? pct(total / M.number(state.budgetCny)) : cost(total)) + '</b>' + (complete ? '<small>' + cost(total) + '</small>' : '') + '</span>' : '<span class="flow-preset-price"><small>无法计算总额</small></span>';
        return action('<span class="flow-preset-route"><strong>' + esc(p.title) + '</strong><small>' + esc(p.note) + '</small><small class="flow-preset-outcome">→ ' +
          esc(p.end || outcomes.find(([id]) => id === state.outcome)?.[1] || '') + '</small>' + (!complete ? '<small class="flow-preset-gap">总损耗尚缺：' + esc(missing.join('、')) + '</small>' : '') + '</span>' + price,
          'preset', 'data-value="' + p.id + '" aria-pressed="' + (state.plan === p.id || Object.keys(p.config).filter(key => !(['exitBank', 'returnMethod'].includes(key) && state.outcome !== 'mainland')).every(key => p.config[key] === state[key])) + '" aria-label="优选方案：' + esc(p.title) + '"', 'flow-preset');
      }).join('') + '</div>';
  }
  const transferKeys = ['entryFx', 'sender', 'entryMiddle', 'entryInward'];
  const fundingKeys = ['depositBank', 'depositOther', 'depositBroker', 'brokerSpread', 'brokerFx'];
  const tradingKeys = ['trade', 'brokerAccount'];
  const withdrawKeys = ['withdraw', 'returnInward', 'withdrawMiddle'];
  const exitKeys = ['returnWire', 'returnOther', 'exitFx', 'card'];
  const costRows = (r, keys) => (r?.rows || []).filter(x => keys.includes(x.key));
  const sumRows = rows => rows.reduce((sum, x) => sum + (x.cny ?? 0), 0);
  function missingFeeStatus(r, item, part = item) {
    if (item.key === 'brokerSpread') return ((r?.fxMode || state.fxMode) === 'bank' ? shortName(r?.bank) : 'IBKR') + ' ' + state.route + '/USD成交价尚未取得';
    if (part.status || item.status) return part.status || item.status;
    if (['entryFx', 'exitFx'].includes(item.key)) return '尚缺该银行换汇报价';
    if (['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(item.key)) return '此汇路代理／收款行收费未公开';
    return '该项资费依据未取得';
  }
  function detailRows(r, rows) {
    return '<div class="flow-cost-detail">' + rows.flatMap(item => (item.items?.length ? item.items : [item]).map(part =>
      '<div><span>' + esc(part.label) + (part.months != null ? '<small>' + num(part.monthlyHkd) + ' HKD/月 × ' + num(part.months, 0) + '个月</small>' : '') +
      '</span><b>' + (part.cny == null ? esc(missingFeeStatus(r, item, part)) : (part.estimate ?? item.estimate ? '估算 ' : '') + cost(part.cny)) + '</b></div>')).join('') + '</div>';
  }
  function loss(r, keys, pending = '') {
    const rows = costRows(r, keys), total = sumRows(rows), missing = rows.some(x => x.cny == null);
    const stale = r?.quoteFreshness && (r.quoteFreshness.reference === false || keys.includes('entryFx') && r.quoteFreshness.source === false ||
      keys.includes('brokerSpread') && r.quoteFreshness.entryMarket === false || keys.includes('exitFx') && r.quoteFreshness.exit === false);
    const variableFx = rows.some(x => x.cny == null && ['entryFx', 'brokerSpread', 'exitFx'].includes(x.key));
    const partial = !!pending || variableFx || missing;
    const estimated = rows.some(x => x.estimate);
    const label = partial ? estimated ? '费用小计 · 含估算' : '已核费用' : stale ? '历史损耗' : estimated ? '参考损耗' : '损耗';
    const hasPrice = rows.some(x => x.cny != null);
    return '<div class="flow-edge-loss"><span>' + label + '</span><strong class="num">' + (hasPrice ?
      (partial ? cost(total) : pct(total / M.number(state.budgetCny))) : '—') + '</strong>' +
      (hasPrice && !partial ? '<small>' + cost(total) + '</small>' : '') + '</div>';
  }
  function nodeBalance(r, value, currency, label, keys = [], blocked = false) {
    const unknown = costRows(r, keys).some(x => x.cny == null), fx = costRows(r, keys).some(x => x.cny == null && ['entryFx', 'brokerSpread', 'exitFx'].includes(x.key));
    const stale = keys.length > 0 && r?.quoteFreshness && (r.quoteFreshness.source === false || keys.includes('brokerSpread') && r.quoteFreshness.entryMarket === false || keys.includes('exitFx') && r.quoteFreshness.exit === false);
    const available = Number.isFinite(value) && !blocked && !fx && !stale;
    return '<div class="flow-node-balance"><small>' + esc(available && unknown ? '已扣已核费用 · ' + label : label) + '</small><div>' +
      (available ? amount(value, currency) : '<b>— <small>' + esc(currency) + '</small></b>') + '</div>' +
      (keys.length && available ? '<small>' + (unknown ? '尚有未报价费用' : '累计损耗 ' + pct(sumRows(costRows(r, keys)) / M.number(state.budgetCny))) + '</small>' : '') + '</div>';
  }
  function node(number, key, label, item, balanceHtml, extra = '') {
    return '<section class="flow-node" data-flow-stage="' + number + '" aria-label="' + esc(label) + '"><span class="flow-node-number">' + number + '</span>' +
      account(key, label, item) + '<div class="flow-node-options">' + extra + '</div>' + balanceHtml + '</section>';
  }
  function edge(data, keys, title, controls, stage, note = '') {
    const r = data.selected || data.partial, failedAction = data.partial?.errorAction || data.partial?.errorStage || data.errorStage || '01';
    const pending = data.error && (failedAction === stage || failedAction === '04' && stage === 'withdraw' && state.outcome === 'usd-balance') ? data.error : '';
    const feeNamesIssue = pending && costRows(r, keys).some(item => item.status === pending || item.items?.some(part => part.status === pending));
    const edgeLoss = pending && stage === 'withdraw' && !costRows(r, keys).length ? '<div class="flow-edge-loss"><strong>本次无法出金</strong></div>' : loss(r, keys, pending);
    return '<section class="flow-edge" aria-label="' + esc(title) + '"><span class="flow-edge-arrow" aria-hidden="true">↓</span><div class="flow-edge-heading"><div class="flow-edge-title"><h3>' + esc(title) + '</h3>' +
      action('依据', 'detail', 'data-value="edge-' + stage + '" aria-label="' + esc(title + '收费依据') + '"', 'text-link') + '</div>' + edgeLoss + '</div><div class="flow-edge-main">' +
      (controls ? '<div class="flow-edge-controls">' + controls + '</div>' : '') + (note ? '<p class="flow-edge-note">' + note + '</p>' : '') +
      '<div class="flow-edge-fees">' + edgeFees(r, keys, stage) + '</div>' +
      (pending && !feeNamesIssue ? '<p class="flow-error" role="status">' + esc(pending) + '</p>' : '') + '</div></section>';
  }
  function edgeFees(r, keys, stage) {
    if (!r?.rows?.length) return '';
    const rows = costRows(r, keys);
    if (stage === 'trade' && r.trading && !r.trading.overridden) return tradeLine(r, 'buy') + tradeLine(r, 'sell') +
      feeRow(r, 'brokerAccount', null, '', r.trading.monthlyHkd ? 'HKD' : 'USD');
    return rows.flatMap(item => {
      if (state.route === 'USD' && ['brokerFx', 'brokerSpread'].includes(item.key)) return [];
      const parts = item.items?.length ? item.items : [item];
      return parts.map((part, i) => {
        let description = part.evidence || item.evidence || item.estimate || '';
        const exchange = item.exchanges?.[i];
        if (exchange) description = num(exchange.input) + ' ' + exchange.from + ' → ' + num(exchange.output) + ' ' + exchange.to;
        if (item.key === 'entryFx' && state.route !== 'CNH' && r.startSell > 0) description = '1 ' + state.route + ' = ' + quoteNum(r.startSell) + ' CNY' + (r.entryDiscount ? ' · 点差五折' : '');
        if (item.key === 'sender' && Number(state.count) > 1) description = (description ? description + ' · ' : '') + state.count + '笔合计';
        const feeCurrency = item.key === 'depositBank' && r.depositMethod === 'chats' && r.bank?.localUsdNative != null ? 'USD' : 'HKD';
        let native = part.cny == null ? missingFeeStatus(r, item, part) :
          ['entryInward', 'depositBank', 'returnWire'].includes(item.key) ? num(part.cny / r.refs[feeCurrency]) + ' ' + feeCurrency : '';
        if (part.cny != null && (part.estimate ?? item.estimate)) native = '估算 ' + (native || cost(part.cny));
        return feeLine(part.label, part.cny, description, native);
      });
    }).join('');
  }
  function flow(data) {
    const r = data.selected || data.partial, s = selected(), steps = r?.steps || {}, throughFunding = [...transferKeys, ...fundingKeys], throughTrade = [...throughFunding, ...tradingKeys];
    const sourceControls = '<div class="flow-count">' + select('count', '汇出笔数', [['1', '1笔'], ['2', '2笔'], ['3', '3笔'], ['4', '4笔'], ...(!['1', '2', '3', '4'].includes(String(state.count)) ? [[String(state.count), state.count + '笔']] : []), ['custom', '自定义笔数']], String(state.count)) +
      (r?.sourceRemainderCny > 1e-6 ? '<small>留在本账户 ' + cost(r.sourceRemainderCny) + '</small>' : '') + '</div>';
    const principal = nodeBalance(r, M.number(state.budgetCny), 'CNY', '人民币本金 · 含费用').replace('</div></div>', '</div>' + action('修改', 'detail', 'data-value="budget" aria-label="修改人民币本金" aria-haspopup="dialog"', 'text-link') + '</div>');
    let html = node('01', 'startBank', '内地出发银行', s.start, principal, sourceControls);
    html += edge(data, transferKeys, state.route === 'CNH' ? '人民币原币汇往香港' : '内地购' + currencyNames[state.route] + ' → 汇往香港',
      select('route', '汇出币种', Object.entries(currencyNames)) + select('mainlandMethod', '汇款渠道', entryMethods()), '01',
      state.mainlandMethod === 'linked' ? '两地同名已关联账户' : '' );
    const accounts = bankAccountSet(s), accountCost = row(r, 'account');
    const chargingBanks = accountCost?.items?.filter(item => item.cny > 0).map(item => item.label.replace('期间管理费', '')).join('＋');
    let accountOptions = action('账户使用 ' + esc(state.months) + '个月 · ' + esc(chargingBanks || '银行') + '管理费 ' + (accountCost ? cost(accountCost.cny) : accounts.map(b => num(b.monthlyHkd) + ' HKD/月').join('、')),
      'detail', 'data-value="bank-settings" aria-haspopup="dialog"', 'flow-setting-button');
    if (accounts.some(b => b.id === 'hsbc')) accountOptions += checkbox('hsbcBalanceWaiver', 'HSBC One已满足免管理费条件');
    html += node('02', 'bank', '香港收款银行', s.bank, nodeBalance(r, steps.hongKong, state.route, '汇款到账', transferKeys), accountOptions);
    const fxControl = state.route === 'USD' ? '' : select('fxMode', '换美元地点', [...(s.broker.id === 'ibkr' ? [['manual', 'IBKR手动换汇'], ['auto', 'IBKR自动换汇']] : []), ['bank', shortName(s.bank) + '换汇']]);
    const fundingPath = row(r, 'brokerSpread')?.path;
    html += edge(data, fundingKeys, state.route === 'USD' ? '转入买股账户' : state.fxMode === 'bank' ? (fundingPath ? '人民币 → 港币 → 美元' : '换成美元') + ' → 转入买股账户' : '转入IBKR → 换成美元', fxControl + select('depositMethod', '入金方式', depositMethods()), '03',
      state.route !== 'USD' ? esc(r?.indicativeFx ? r.indicativeFx.replace('（暂按参考中间价）', ' · 未含换汇差额') : r?.entryPrice ? '1 USD = ' + quoteNum(r.entryPrice) + ' ' + state.route + (fundingPath ? ' · 两次兑换' : '') : '') : '');
    html += node('03', 'broker', '买美股的账户', s.broker, nodeBalance(r, steps.fundedUsd, 'USD', '入金到账', throughFunding),
      action('买' + esc(state.buyOrders) + '笔 / 卖' + esc(state.sellOrders) + '笔 · 股价 ' + esc(state.sharePriceUsd) + ' USD', 'detail', 'data-value="trade-settings"', 'flow-setting-button') +
      (s.broker.id === 'hsbc' ? checkbox('trade25', 'Trade25 · 仅美股月费0') : '') +
      action(state.useVoucher ? r?.trading?.discountUsd > 0 ? '费用券 · 抵扣' + num(r.trading.discountUsd) + ' USD' : '费用券 · 未抵扣' : '优惠与费用券', 'detail', 'data-value="offers"', 'text-link'));
    html += edge(data, tradingKeys, '买入美股 → 卖出', action('盈亏 ' + num(M.number(state.profitUsd)) + ' USD', 'detail', 'data-value="profit-settings"', 'flow-setting-button'), 'trade', esc(row(r, 'trade')?.estimate || ''));
    const endSelect = select('outcome', '卖出后的资金', outcomes);
    html += '<section class="flow-node flow-end" data-flow-stage="04" aria-label="卖出后的资金"><span class="flow-node-number">04</span><div class="flow-end-choice">' + endSelect + '</div><div class="flow-node-options">' +
      (state.outcome === 'broker-balance' ? '<strong>' + esc(shortName(s.broker)) + '</strong><small>美元留在账户</small>' : account('returnBank', '取回／消费银行', s.returning)) +
      '</div>' + nodeBalance(r, steps.proceedsUsd, 'USD', '卖出后 · 税前', throughTrade) + '</section>';
    if (state.outcome !== 'broker-balance') html += edge(data, withdrawKeys, '出金 → ' + shortName(s.returning),
      action('本月第' + esc(state.withdrawalIndex) + '次出金', 'detail', 'data-value="profit-settings"', 'flow-setting-button'), 'withdraw');
    if (state.outcome === 'mainland') html += edge(data, exitKeys, '汇回内地 → 美元结汇', account('exitBank', '内地收款银行', s.exit) + select('returnMethod', '汇回渠道', returnMethods()), '04',
      !data.error && !r?.indicativeExit && r?.exitPrice > 1 ? '1 USD = ' + quoteNum(r.exitPrice) + ' CNY' : '');
    if (state.outcome === 'cnh-card' || state.outcome === 'usd-card') html += edge(data, exitKeys, state.outcome === 'cnh-card' ? (row(r, 'exitFx')?.path ? '美元 → 港币 → 人民币 → 消费' : '美元换人民币 → 消费') : '美元余额 → 原币消费',
      state.outcome === 'cnh-card' && s.returning?.cnhCardRequiresHkid ? checkbox('scCnhAccount', '持有效香港身份证，已开通渣打人民币储蓄账户') : '', '04',
      data.error || r?.indicativeExit ? '' : esc(state.outcome === 'cnh-card' && r?.exitPrice > 1 ? '1 USD = ' + quoteNum(r.exitPrice) + ' CNH' : '对应币种余额直接扣账'));
    return '<div class="flow-ledger" aria-label="完整资金流">' + html + '</div>';
  }
  function currentRows(r, stage = state.activeStep) { return (r?.rows || []).filter(x => stageKeys[Number(stage) - 1].includes(x.key)); }
  function feeLine(label, cny, description = '', native = '') {
    return '<div class="flow-fee-line"><div><strong>' + esc(label) + '</strong>' + (description ? '<small>' + esc(description) + '</small>' : '') +
      '</div><div>' + (cny == null ? '<span class="flow-variable">' + esc(native || '随实际汇路收费') + '</span>' : '<b class="num">' + esc(native || cost(cny)) + '</b>' + (native && !native.endsWith(' CNY') && cny !== 0 ? '<small>≈ ' + cost(cny) + '</small>' : '')) + '</div></div>';
  }
  function feeRow(r, key, label, description = '', currency = 'CNY') {
    const item = row(r, key); if (!item) return '';
    return feeLine(label || item.label, item.cny, description, item.cny == null ? item.rangeCny ? item.rangeCny.map(n => num(n)).join('–') + ' CNY' : item.status || '' :
      currency === 'CNY' ? '' : num(item.cny / r.refs[currency]) + ' ' + currency);
  }
  function transferHint() {
    if (state.mainlandMethod === 'cib-go') return '附加服务：每笔≤等值10,000 USD，仅限App提供此服务的收款账户；包含境外行费用。';
    if (state.mainlandMethod === 'full') return '美元全额到账附加服务按笔收费，汇出手续费、电讯费及收款行本行汇入费分别列示。';
    if (state.mainlandMethod === 'boc-mobile') return '双免按2026年公开报道情景计算；中银香港同名汇入基本费已获官网确认。';
    if (state.mainlandMethod === 'linked') return state.startBank === 'sc' ? '适用于渣打优先理财、两地同名账户及指定渠道。' : state.startBank === 'hang' ? '适用于恒生中国优越理财，经跨域转账页面汇往同名恒生香港账户；优进理财的累计3次本行费用优惠不适用此项。' : '适用于已连通的两地同名账户及指定转账页面。';
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
      (sum('discount') ? ' − 券抵扣 ' + num(sum('discount')) : '') + ' USD', (row(r, 'trade')?.estimate ? '估算 ' : '') + num(sum('feeUsd')) + ' USD');
  }
  function balancePresentation(data) {
    const r = data.selected || data.partial, rows = r?.rows || [], total = sumRows(rows), gaps = rows.filter(x => x.cny == null);
    const incomplete = !data.selected || !!r?.indicativeFx || !!r?.indicativeExit || !!r?.exitIssue;
    const stale = !r?.missingQuote && r?.quoteFreshness && (r.quoteFreshness.source === false || r.quoteFreshness.reference === false ||
      !r.indicativeFx && r.quoteFreshness.entryMarket === false || !r.indicativeExit && r.quoteFreshness.exit === false);
    const partial = incomplete || !!gaps.length;
    const estimated = rows.some(x => x.estimate);
    const label = stale ? '全程损耗 · 历史报价' : partial ? estimated ? '费用小计 · 含估算' : '全程已核费用' : estimated ? '参考总损耗' : '全程损耗';
    const canBalance = !!data.selected && !incomplete && !stale && gaps.every(x => ['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(x.key));
    const lastBalance = r?.steps?.remitUsd ?? r?.steps?.returnUsd ?? r?.steps?.proceedsUsd ?? r?.steps?.fundedUsd;
    const canShowLast = Number.isFinite(lastBalance) && !r?.indicativeFx && r?.quoteFreshness?.source !== false && r?.quoteFreshness?.entryMarket !== false;
    const lastPoint = canShowLast ? { amount: lastBalance, currency: 'USD' } :
      Number.isFinite(r?.steps?.hongKong) && r?.quoteFreshness?.source !== false ? { amount: r.steps.hongKong, currency: state.route } : null;
    return { r, rows, total, gaps, partial, estimated, label, canBalance, lastPoint };
  }
  function summary(data) {
    const { r, rows, total, gaps, partial, estimated, label, canBalance, lastPoint } = balancePresentation(data);
    const balanceLabel = canBalance ? (gaps.length ? '已扣已核费用后的余额' : estimated ? '按公布参考费计算的余额' : state.outcome.includes('card') ? '可消费金额' : '最终余额') : lastPoint ? '最后可计余额' : '最终余额暂不可算';
    const finalHtml = (canBalance ? amount(r.net, r.currency) : lastPoint ? amount(lastPoint.amount, lastPoint.currency) : '<b>—</b>') +
      (r?.sourceRemainderCny > 1e-6 ? '<small>另留内地账户 ' + cost(r.sourceRemainderCny) + '</small>' : '');
    return '<div class="flow-result"><div><span>' + label + '</span><strong class="num">' + (rows.some(x => x.cny != null) ? partial ? cost(total) : pct(total / M.number(state.budgetCny)) : '—') + '</strong>' +
      '<small>' + (rows.length ? partial ? data.error ? '第' + esc(r?.errorStage || data.errorStage || '01') + '步尚未完成' : '总损耗尚缺：' + esc(gaps.map(x => x.label).join('、') || r?.exitIssue || '有效成交报价') : cost(total) : esc(data.error || '选择有效本金和汇出报价')) + '</small></div><div class="flow-result-equation"><span>其中账户期间费</span><b>' +
      (row(r, 'account') ? cost(row(r, 'account').cny) : '—') + '</b>' + (r?.taxCny ? '<small>另预留税款 ' + cost(r.taxCny) + '</small>' : '<small>已计入合计</small>') + '</div><div><span>' + balanceLabel + '</span>' + finalHtml +
      '</div><div class="flow-result-detail">' +
      action('全程明细', 'detail', 'data-value="cost"', 'text-link') + '</div></div>';
  }
  function view(helpers) {
    H = helpers; const data = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '') + '<div class="page-money-flow"><div id="flow-live-toolbar">' + toolbar() +
      '</div><div id="flow-live-ledger">' + flow(data) + '</div><div id="flow-live-summary" class="flow-summary-card" aria-live="polite">' + summary(data) +
      '</div><div class="flow-bottom-tools">' + action('实际成交报价与费用', 'detail', 'data-value="adjustments"', 'text-link') +
      '<span>便利化购汇不得用于境外证券投资；本页为费用测算。</span>' + action('适用条件', 'detail', 'data-value="mainland"', 'text-link') + '</div></div>';
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
    for (const [id, render] of [['flow-live-toolbar', toolbar], ['flow-live-ledger', flow], ['flow-live-summary', summary]]) {
      const element = document.getElementById(id); if (element) patch(element, render(data));
    }
    if (modalKey && document.getElementById('dialog')?.open && document.getElementById('flow-detail-live')) detail(modalKey, true);
  }
  function choiceState(key, value) {
    const next = { ...state, [key]: value, plan: 'custom' };
    const reset = {
      startBank: ['startSell', 'senderFeeCny', 'entryMiddleCny', 'mainlandMethod'],
      bank: ['entryInwardHkd', 'depositHkd', 'depositOtherCny', 'monthlyHkd', 'entryPrice', 'mainlandMethod', 'depositMethod'],
      broker: ['tradeFeeUsd', 'entryPrice', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'depositMethod'],
      returnBank: ['exitPrice', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd', 'returnMethod'],
      route: ['startSell', 'entryPrice', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'fxMode', 'depositMethod', 'mainlandMethod'],
      fxMode: ['entryPrice', 'depositHkd', 'depositOtherCny', 'depositMethod'], depositMethod: ['depositHkd', 'depositOtherCny'],
      mainlandMethod: ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd'], outcome: ['exitPrice'],
      exitBank: ['exitPrice', 'returnExtraCny', 'returnMethod'], returnMethod: ['returnWireHkd', 'returnExtraCny']
    };
    for (const field of reset[key] || []) next[field] = '';
    if (key === 'broker') next.useVoucher = false;
    if (key === 'bank' || key === 'route') { next.senderFeeCny = ''; next.entryMiddleCny = ''; }
    if (key === 'returnBank' && next.outcome === 'cnh-card') next.exitPrice = '';
    if (key === 'broker') {
      next.useVoucher = false; next.voucherScope = value === 'za' ? 'platform' : 'commission';
      if (value !== 'ibkr' && next.route !== 'USD') next.fxMode = 'bank';
    }
    return M.calculatorRoute(next);
  }
  function choose(key, value) {
    const allowed = ['count', 'months', 'startBank', 'bank', 'broker', 'outcome', 'returnBank', 'exitBank', 'route', 'mainlandMethod', 'depositMethod', 'returnMethod', 'fxMode', 'voucherScope'];
    if (!allowed.includes(key)) return;
    if (['startBank', 'exitBank'].includes(key) && !D.calculator.mainland.includes(value)) return;
    if (['bank', 'returnBank'].includes(key) && !D.calculator.hkBanks.includes(value)) return;
    if (key === 'broker' && !D.calculator.brokers.includes(value)) return;
    if (key === 'count' && value === 'custom') { detail('budget'); return; }
    state = choiceState(key, value); save(); refresh();
  }
  function picker(key) {
    modalKey = null;
    const titles = { startBank: '选择出发银行', bank: '选择香港收款银行', broker: '选择买美股的账户', outcome: '选择资金用途', returnBank: '选择取回／消费银行', exitBank: '选择内地收款银行' };
    const small = options.get(key), isMainland = ['startBank', 'exitBank'].includes(key), isBank = ['bank', 'returnBank'].includes(key);
    const list = key === 'outcome' ? outcomes.map(([id, name]) => ({ id, name })) : isMainland ? mainland : isBank ? banks : key === 'broker' ? brokers : (small?.values || []).map(([id, name]) => ({ id, name }));
    const comparison = key === 'startBank' ? M.purchaseComparison({ ...state, date: today() }, comparisonData, window.MONEY_FLOW_QUOTES || {}) : null;
    const copy = item => key === 'broker' ? item.feeShort : key === 'exitBank' ? '境外USD汇入手续费：' + (item.inwardCny == null ? '尚未取得适用价目' : num(item.inwardCny) + ' CNY') : key === 'startBank' ? sourceTariffCopy(item) : isBank ?
      ({ bochk: '中行同名汇入0；本地美元转账0；账户月费0', hsbc: '汇入及本地美元转账0；One月费按豁免条件', za: '本地美元转账0；账户月费0；可开美股交易', hang: '同名跨域转账0；本地美元转账0；优进月费0', sc: '本地USD转账标准费22 USD；快易月费0' })[item.id] : '';
    const price = item => {
      if (key === 'exitBank') {
        const quote = window.MONEY_FLOW_QUOTES?.banks?.[item.id]?.quotes?.USD;
        return '<span class="flow-picker-price">' + (quote?.buy > 0 && M.quoteFresh(quote, today()) ? '<b>' + quoteNum(quote.buy) + '</b><small>CNY/USD · 结汇</small>' :
          '<small>' + (quote?.buy > 0 ? 'USD结汇牌价超过3天' : '尚未取得该行USD结汇牌价') + '</small>') + '</span>';
      }
      const q = comparison?.rows.find(x => x.bank.id === item.id);
      if (!comparison || state.route === 'CNH') return '';
      return '<span class="flow-picker-price">' + (q?.comparable ? '<b>' + quoteNum(q.sell) + '</b><small>CNY/' + state.route + '</small><em>' +
        (q.lossRate < 1e-9 ? '最低可比购汇价' : '购汇少得 ' + pct(q.lossRate)) + '</em>' : '<small>' + (q?.sell ? '报价超过3天' : '尚未取得该行' + state.route + '购汇牌价') + '</small>') + '</span>';
    };
    H.openModal(H.modalTitle(titles[key] || small?.label || '选择') + '<div class="flow-picker">' + list.map(item =>
      action('<span class="flow-picker-copy"><strong>' + esc(item.name) + '</strong>' + (copy(item) ? '<small>' + esc(copy(item)) + '</small>' : '') + '</span>' + price(item) +
        '<span class="flow-picker-check">' + (item.id === state[key] ? '✓ 已选' : '') + '</span>', 'pick-choice',
        'data-field="' + key + '" data-value="' + esc(item.id) + '" aria-pressed="' + (item.id === state[key]) + '"', 'flow-picker-option')).join('') + '</div>' +
      (comparison?.best ? '<p class="flow-picker-caption">购汇价按每1外币计；手续费由所选渠道另算。报价时间见详情。</p>' : ''));
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
  function detail(key, updating = false) {
    modalKey = key;
    const data = result(), r = data.selected || data.partial, s = selected();
    let title = '费用明细', content = '', keys = [];
    if (key === 'budget') {
      title = '本金与汇出笔数'; content = '<div class="flow-form-grid">' + field('budgetCny', '人民币本金 · 含费用', 'CNY') + field('count', '汇出笔数', '笔') + '</div>';
    } else if (key === 'bank-settings') {
      title = '香港银行账户费用'; content = '<div class="flow-form-grid">' + field('months', '账户使用／持有月数', '月') + '</div>';
      content += row(r, 'account')?.items.map(x => feeLine(x.label, x.cny, num(x.monthlyHkd) + ' HKD/月 × ' + num(x.months, 0) + '个月', num(x.cny / r.refs.HKD) + ' HKD')).join('') || '';
      if (bankAccountSet(s).some(b => b.id === 'hsbc')) content += '<p>HSBC One：过去三个月平均理财总值达到10,000 HKD即免管理费，包含汇丰所持美股市值，不仅是现金。2026年前开立的账户、香港身份证开户另获豁免。符合时勾选银行节点的免管理费条件；本次入金不代表过去三个月已达标。</p>';
      keys = bankAccountSet(s).flatMap(b => b.sources || []);
      if (bankAccountSet(s).some(b => b.id === 'hsbc')) keys.push('hsbcOneBalance');
    } else if (key === 'trade-settings') {
      title = '美股买卖设置'; content = '<div class="flow-form-grid">' + field('sharePriceUsd', '买入均价', 'USD/股') + field('buyOrders', '买入笔数', '笔') + field('sellOrders', '卖出笔数', '笔') + '</div>';
      content += tradeLine(r, 'buy') + tradeLine(r, 'sell'); keys = s.broker.sources || [];
    } else if (key === 'profit-settings') {
      title = '盈亏、出金与税款'; content = '<div class="flow-form-grid">' + field('profitUsd', '卖出盈亏 · 交易费前', 'USD') + field('withdrawalIndex', '本月第几次出金', '次') + field('taxRate', '应税所得税率', '%') + field('taxableCny', '人民币应税所得', 'CNY', '按正净利润估算') + field('creditCny', '税款抵免', 'CNY') + '</div>';
    } else if (key === 'offers') {
      title = shortName(s.broker) + ' · 优惠与费用券'; content = offers(s, r); keys = s.broker.sources || [];
    } else if (key.startsWith('edge-')) {
      const stage = key.slice(5), edgeKeys = ({ '01': transferKeys, '03': fundingKeys, trade: tradingKeys, withdraw: withdrawKeys, '04': exitKeys })[stage] || [];
      title = ({ '01': '内地购汇与跨境汇款', '03': '换汇与股票入金', trade: '美股买卖', withdraw: '出金至香港银行', '04': '资金使用' })[stage];
      content = detailRows(r, costRows(r, edgeKeys));
      const exchanges = costRows(r, edgeKeys).flatMap(x => x.exchanges || []);
      if (exchanges.length) content += '<h3>实际兑换顺序</h3><div class="flow-cost-detail">' + exchanges.map(x => '<div><span>' + num(x.input) + ' ' + x.from + ' → ' + num(x.output) + ' ' + x.to + '</span><b>1 ' + x.from + ' = ' + quoteNum(x.rate) + ' ' + x.to + '</b></div>').join('') + '</div>';
      if (stage === '01') {
        content += '<p>' + esc(transferHint() || sourceTariffCopy(s.start)) + '</p>';
        if (s.start.id === 'cib' && state.route !== 'CNH') content += field('usedFreeTransfers', '优惠期内已汇出笔数', '笔') + '<p>寰宇人生外汇汇出手续费免，优惠期前30笔电讯费免；优惠至2027-06-30。</p>';
      }
      if (stage === 'trade') content += tradeLine(r, 'buy') + tradeLine(r, 'sell');
      keys = [...(s.start?.sources || []), ...(s.bank?.sources || []), ...(s.broker?.sources || []), ...(s.returning?.sources || [])];
    } else if (key === 'mainland') {
      title = '适用条件'; keys = ['safe', 'pbcRmb', 'scCnTerms', 'csrc'];
      content = '<p>大陆个人便利化购汇不得用于境外证券投资；同名香港账户不改变用途限制。本页比较收费，实际资金来源、用途和汇款资格由相关机构审核。</p>';
    } else if (key === 'adjustments') {
      title = '实际成交报价与费用'; content = '<p>仅填写已取得的个人报价或回单。更换对应银行、渠道或币种后，该段覆盖值自动清除。</p>' + adjustments();
    } else if (key === 'quotes') {
      title = '汇率与收费依据'; keys = [s.start?.quoteSource, ...(s.start?.sources || []), ...(s.bank?.sources || []), ...(s.broker?.sources || []), 'usmartBocFunding'];
      const q = window.MONEY_FLOW_QUOTES || {}, comparison = M.purchaseComparison({ ...state, date: today() }, comparisonData, q);
      content = '<h3>同一个损耗基准</h3><p>本金扣去各项收费，再按所选报价换汇。内地购汇以本目录当前最低有效卖出价为基准；最优购汇差额为0。各步人民币差额与手续费相加，再除以同一本金。不会再把银行自身买卖中间价差混进另一套损耗率。</p>';
      content += '<div class="flow-cost-detail">' + comparison.rows.map(x => '<div><span>' + esc(x.bank.name) + '<small>' + esc(x.quote?.asOf || '尚未取得该行购汇牌价') +
        (x.quote?.timeBasis === 'observed' ? ' · 采集时点' : '') + '</small></span><b>' + (x.sell ? quoteNum(x.sell) + ' CNY/' + state.route : '—') + '</b></div>').join('') + '</div>';
      content += '<h3>香港银行公开换汇价</h3><div class="flow-cost-detail">' + Object.entries(q.offshoreUsd || {}).flatMap(([id, bank]) =>
        Object.entries(bank.quotes || {}).map(([currency, price]) => '<div><span>' + esc(shortName(banks.find(b => b.id === id))) + ' · USD/' + currency +
          '<small>' + esc(price.asOf) + (price.path === 'via-HKD' ? ' · 经HKD两次兑换' : '') + '</small></span><b>卖美元 ' + quoteNum(price.bidPerUsd) +
          '<small>买美元 ' + quoteNum(price.askPerUsd) + '</small></b></div>')).join('') + '</div>';
      if (r?.refs) content += '<p>统一折算：1 USD = ' + num(r.refs.USD, 6) + ' CNY；1 HKD = ' + num(r.refs.HKD, 6) + ' CNY。CNY与CNH分开计价。</p>';
      content += '<h3>同名转账豁免</h3><p>中银香港官网确认同名内地中行的基本汇入费豁免，条款不含代理行费。内地手机银行双免采用2026年报道情景；2025年的优惠公告没有自动延长。恒生、汇丰、渣打的免费服务各须符合所列同名渠道和账户条件。</p>';
      keys.push('bochkSame', 'bocMobile2026', 'bocMobileUsdGuide', 'hang', 'hsbcGlobal', 'sc', 'bochkUsdFx', 'hsbcHkFx', 'hangHkFx');
    } else {
      const rows = key === 'stage' ? currentRows(r) : r?.rows || [];
      title = key === 'stage' ? stageNames[Number(state.activeStep) - 1] + ' · 费用明细' : '全程费用明细';
      content = rows.length ? detailRows(r, rows) :
        '<p>' + esc(data.error || '选择对应账户后显示资费') + '</p>';
      if (r?.missing?.length) content += '<h3>影响最终金额的项目</h3><ul>' + r.missing.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      const { canBalance, lastPoint } = balancePresentation(data);
      if (canBalance && Number.isFinite(r?.netCny)) content += '<p>' + num(r.budgetCny) + ' 本金 ＋ ' + num(r.profitUsd * r.refs.USD) + ' 盈亏 − ' + num(r.costCny) + ' 成本 − ' + num(r.taxCny) +
        ' 税款 ＝ ' + num(r.netCny) + ' CNY。' + (r.complete ? '' : '未报价项目未扣除，不是最终到账承诺。') + '按完整精度计算，分项显示到分时可能产生四舍五入尾差。</p>';
      else if (lastPoint) content += '<p>最后可计余额：' + num(lastPoint.amount) + ' ' + esc(lastPoint.currency) + '</p>';
      keys = [...(s.start?.sources || []), ...(s.bank?.sources || []), ...(s.broker?.sources || []), ...(s.returning?.sources || [])];
    }
    const html = H.modalTitle(title) + '<div class="flow-detail">' + content + '<div class="flow-detail-sources">' + [...new Set(keys)].filter(Boolean).map(source).join('') + '</div></div>';
    if (updating) patch(document.getElementById('flow-detail-live'), html);
    else H.openModal('<div id="flow-detail-live">' + html + '</div>');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('money-flow-', ''), value = button.dataset.value;
    if (act === 'pick' || act === 'control-pick') { picker(value); return; }
    if (act === 'preset') { const p = visiblePresets.find(x => x.id === value) || presets.find(x => x.id === value); if (!p) return; document.getElementById('dialog')?.close(); state = presetState(p); save(); refresh(); return; }
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
