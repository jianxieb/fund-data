(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel, STORE = 'changheng.money-flow.v4';
  const defaults = { budgetCny: '100000', currency: 'CNY', plan: 'recommended', startBank: '', route: '', bank: '', returnBank: '', exitBank: '',
    mainlandMethod: '', depositMethod: '', fxMode: '', returnMethod: '', comparison: 'start', count: '1', usedFreeTransfers: '0',
    months: '12', balanceHkd: '0', returnBalanceHkd: '0', profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1', tradeFeeUsd: '',
    broker: 'ibkr', buyOrders: '1', sellOrders: '1', sharePriceUsd: '100', trade25: false, chiefMonthly: false, usmartPromo: false, zaLv2: false,
    hsbcBalanceWaiver: false, otherTurnoverHkd: '0', usedPromoOrders: '0', usmartDays: '0', useVoucher: false, voucherScope: 'commission', voucherUsd: '0', voucherOrders: '1', voucherExpiry: '',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', inwardHkd: '', intermediaryCny: '',
    returnWireHkd: '', returnExtraCny: '', monthlyHkd: '', returnMonthlyHkd: '', startSell: '', entryPrice: '', exitPrice: '',
    usdCny: '', usdHkd: '', usdCnh: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  if (!stored.broker && stored.tradeFeeUsd === '0') delete stored.tradeFeeUsd;
  let state = { ...defaults, ...stored, currency: 'CNY' }, H, timer;
  const esc = value => H.esc(value), num = (value, digits = 2) => value == null ? '—' : H.money(value, digits);
  const action = (label, act, extra = '', cls = 'btn') => H.action(label, 'money-flow-' + act, cls, extra);
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {} };
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  let cachedKey, cachedData;
  const result = () => {
    const inputs = { ...state, date: today() }, key = JSON.stringify(inputs);
    if (key !== cachedKey) { cachedData = M.journeyPlans(inputs, D, window.MONEY_FLOW_QUOTES || {}); cachedKey = key; }
    return cachedData;
  };
  const source = key => D.sources[key] ? '<a class="source-link" target="_blank" rel="noopener noreferrer" href="' + esc(D.sources[key].url) + '">' + esc(D.sources[key].name) + ' ↗</a>' : '';
  const rowFee = (r, key) => r?.rows?.find(row => row.key === key)?.cny;
  const sumFees = (r, keys) => keys.reduce((sum, key) => sum + (rowFee(r, key) ?? 0), 0);
  const feeText = value => value == null ? '未报价' : value > 0 && value < .005 ? '＜0.01 CNY' : num(value) + ' CNY';
  const routes = { USD: '内地换美元 → 美元入金', HKD: '内地换港币 → 再换美元', CNH: '人民币到港 → 再换美元' };
  const remittanceCurrencies = { USD: '美元 · 内地购汇后汇出', HKD: '港币 · 内地购汇后汇出', CNH: '人民币 · 原币汇出' };
  const bankOptions = banks => banks.map(bank => [bank.id, bank.name]);
  function field(key, label, unit = '', placeholder = '') {
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input ' + (key === 'voucherExpiry' ? 'type="date"' : 'type="text" inputmode="decimal"') + ' data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div></label>';
  }
  function select(key, label, values, value) {
    const current = values.find(([id]) => id === value) || values[0] || ['', '暂无可选项'];
    const copy = ([, text, detail]) => '<span class="flow-select-copy"><span>' + esc(text) + '</span>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</span>';
    return '<div class="flow-field"><span>' + esc(label) + '</span><details class="select-menu flow-select" data-money-select="' + esc(key) + '">' +
      '<summary id="flow-select-' + esc(key) + '" aria-label="' + esc(label + '：' + current.slice(1).filter(Boolean).join('，')) + '">' + copy(current) + '</summary>' +
      '<div class="select-menu-list" role="group" aria-label="' + esc(label) + '">' + values.map(option => action(copy(option) + '<span class="flow-option-check" aria-hidden="true">' + (option[0] === value ? '✓' : '') + '</span>',
        'select-choice', 'data-field="' + esc(key) + '" data-value="' + esc(option[0]) + '" aria-pressed="' + (option[0] === value) + '"', 'select-menu-option flow-select-option')).join('') + '</div></details></div>';
  }
  function checkbox(key, label) {
    return '<label class="flow-offer"><input type="checkbox" data-money-check="' + key + '"' + (state[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function brokerOffers(provider, r) {
    const offers = provider.id === 'hsbc' ? checkbox('trade25', '已获Trade25资格 · 年龄/One+及持有期续用条件') + checkbox('hsbcBalanceWaiver', '已满足One连续3个月免月费条件') :
      provider.id === 'chief' ? checkbox('chiefMonthly', '本次为合资格App月供 · 首500 USD优惠') :
      provider.id === 'usmart' ? checkbox('usmartPromo', '合资格标的 · 开户180天内0.99 USD优惠') :
      provider.id === 'za' ? checkbox('zaLv2', 'ZA Perks Lv2 · 每月前5笔平台费优惠') : '';
    const voucher = M.voucherState(state);
    const voucherMessage = r?.trading?.overridden ? '已按填写的实际交易费计算，不再重复抵扣费用券。' : voucher.message ||
      (r?.trading?.warnings.find(text => text.includes('费用券已过期')) || '本次抵扣 ' + num(r?.trading?.discountUsd ?? 0) + ' USD；仅抵所选佣金／平台费。');
    return '<div class="flow-broker-offers">' + note(esc(provider.feeShort || provider.feeText)) + offers + checkbox('useVoucher', '使用已获佣金／平台费券') +
      (state.useVoucher ? '<div class="flow-voucher"><div class="flow-parameter-grid">' +
        select('voucherScope', '券适用费用', [['commission', '仅佣金'], ['platform', '仅平台费'], ['both', '佣金及平台费']], state.voucherScope) +
        field('voucherUsd', '券总抵扣额度', 'USD') + field('voucherOrders', '券可用订单数', '笔') + field('voucherExpiry', '券有效截止日期') +
        '</div><p class="flow-voucher-status" role="status">' + esc(voucherMessage) + '</p></div>' : '') + '</div>';
  }
  function entryMethods(s) {
    return [['swift', '普通电汇 · 公开标准价'], ...(s.start?.id === 'boc' && s.bank?.id === 'bochk' ? s.route === 'CNH' ? [['payment-connect', '跨境支付通 · 人民币原币到账']] : [['boc-mobile', '中行手机银行 · 向境外中行汇款']] : []), ...(['hang', 'hsbc', 'sc'].includes(s.start?.id) && s.start.group === s.bank?.group ? [['linked', '两地同名专用渠道']] : []),
      ...(s.route === 'USD' && s.start?.fullAmountUsd != null ? [['full', 'SWIFT · 全额到账（加25 USD）']] : [])];
  }
  function depositMethods(s) {
    if (s.broker?.integratedBank) return [['internal', '本人银行USD账户直接交收']];
    return s.route === 'USD' || s.fxMode === 'bank' ? [['chats', 'USD本地CHATS转账'], ['swift', 'USD SWIFT电汇']] :
      [['fps', 'HKD／CNH转数快 FPS'], ['edda', 'HKD／CNH eDDA扣款'], ['swift', 'HKD／CNH SWIFT电汇']];
  }
  function returnMethods(s) {
    return [['swift', 'USD · 普通SWIFT汇款'], ...(s.returning?.id === 'bochk' && s.exit?.group === 'boc' ? [['bochk-fast', '中银快汇 · 网上汇至内地中行']] : []),
      ...(['hang', 'hsbc', 'sc'].includes(s.returning?.id) && s.returning.group === s.exit?.group ? [['linked', '两地同名专用渠道']] : [])];
  }
  const note = text => '<p class="flow-stop-note">' + text + '</p>';
  const pct = value => value == null ? '未报价' : num(value * 100, 3) + '%';
  const exactMissing = r => r?.missing?.length ? '待确认：' + r.missing.join('、') : '';
  const lossLabel = metric => (metric?.indicative ? '参考' : metric?.missing.length ? '已知' : '') + '损耗';
  const impactLabel = value => '参考汇率折算' + (value >= 0 ? '增值（抵减损耗，非返费）' : '减值（增加损耗）');
  const signedFee = value => (value > 0 ? '+' : '') + feeText(value);
  const stepFeeText = metric => metric.rows.some(row => row.key === 'sender' && row.cny == null) ? '汇出服务费待确认' :
    '本段' + (metric.missing.length ? '已知费用 ' : '费用 ') + feeText(metric.costCny);
  function legMetric(leg) {
    if (!leg) return '<span>等待本段报价</span>';
    if (leg.rows.some(row => row.key === 'sender' && row.cny == null)) return '<span>本段损耗待核 · 汇出服务费未确认</span>';
    const valuation = Math.abs(leg.fxImpactCny) >= .005;
    return '<span>' + (valuation ? '折算后' : '本段') + lossLabel(leg) + ' <b class="num">' + feeText(leg.lossCny) + '</b></span><span>' + (valuation ? '折算损耗率' : '损耗率') + ' <b class="num">' + pct(leg.lossRate) + '</b></span>';
  }
  function fees(leg) {
    if (!leg) return '<p class="flow-stop-note">缺少本段有效报价</p>';
    return '<dl class="flow-fee-list">' + leg.rows.map(row => '<div><dt>' + esc(row.label) + '</dt><dd class="num">' + feeText(row.cny) + '</dd></div>').join('') + '</dl>' +
      '<div class="flow-leg-total"><span>' + (leg.missing.length ? '本段已知费用' : '本段费用合计') + '</span><b class="num">' + feeText(leg.costCny) + '</b></div>' +
      (leg.taxCny ? '<div class="flow-leg-adjustment"><span>税款预留（增加损耗）</span><b class="num">' + feeText(leg.taxCny) + '</b></div>' : '') +
      (Math.abs(leg.fxImpactCny) >= .005 ? '<div class="flow-leg-adjustment"><span>' + impactLabel(leg.fxImpactCny) + '</span><b class="num">' + signedFee(leg.fxImpactCny) + '</b></div>' : '');
  }
  function stop(stop, index, title) {
    const starting = stop.id === 'start';
    return '<section class="flow-balance' + (stop.id === 'destination' ? ' destination' : '') + '"><span class="flow-step">' + String(index + 1).padStart(2, '0') + '</span>' +
      '<h3>' + title + '</h3><p>' + esc(stop.account) + '</p><strong class="flow-stop-value num">' + num(stop.amount) + '<small>' + stop.currency + '</small></strong>' +
      '<span class="flow-balance-status">' + (starting ? '起始本金 · 汇出前' : stop.indicative ? '参考成交价情景余额' : stop.missing?.length ? '未报价费用扣除前余额' : '测算余额') + '</span>' +
      (!starting && stop.currency !== 'CNY' && stop.valueCny != null ? '<span class="flow-balance-status">参考折合 ' + feeText(stop.valueCny) + '</span>' : '') +
      (starting ? '' : '<span class="flow-cumulative">截至此处累计' + (stop.missing?.length ? '已知' : '') + '损耗 <b class="num">' + feeText(stop.cumulativeLossCny) + '</b></span>') + '</section>';
  }
  function planCards(data) {
    const shown = (data.presets || []).filter(p => ['recommended', 'simple', 'CNH', 'HKD'].includes(p.id));
    const bocMobile = (data.presets || []).filter(p => p.id === 'boc-mobile');
    const brokerPlans = (data.presets || []).filter(p => !['boc-mobile', 'recommended', 'simple', 'CNH', 'HKD'].includes(p.id));
    const sharedMissing = shown.length ? shown[0].result.missing.filter(gap => shown.every(p => p.result.missing.includes(gap))) : [];
    const cards = (plans, common = []) => plans.map(p => {
      const r = p.result, loss = r.budgetCny + r.profitUsd * r.refs.USD - r.net;
      const selected = state.plan === p.id && M.routeKeys.every(key => state[key] === M.routeConfiguration(r)[key]);
      return '<button type="button" class="flow-plan' + (selected ? ' selected' : '') + '" data-action="money-flow-preset" data-value="' + p.id + '" aria-pressed="' + selected + '">' +
        '<strong>' + esc(p.name) + '</strong><span>' + esc(r.start.name + ' → ' + r.bank.name + ' → ' + r.broker.name) + '</span>' +
        '<b class="num">' + (p.evidenceOnly ? '同名汇入手续费 0 · 汇出优惠待核' : (r.complete ? '全程损耗 ' : '已知损耗 ') + feeText(loss) + ' · ' + pct(loss / r.budgetCny)) + '</b>' +
        '<small>' + esc([r.route === 'USD' ? '内地直购USD' : '中银香港换USD', r.bank.id === r.returning.id ? '一个香港账户' : '回款用' + r.returning.name, rowFee(r, 'account') === 0 ? '账户免月费' : '已计账户月费'].join('；')) + '</small>' +
        (p.differenceCny > .005 ? '<small>比公开基准多 ' + feeText(p.differenceCny) + '</small>' : '') +
        (p.evidenceOnly ? '<small class="flow-gap">内地汇出手续费、电讯费及中转费待核；暂不参与排名。</small>' : r.missing.some(gap => !common.includes(gap)) ? '<small class="flow-gap">待确认：' + esc(r.missing.filter(gap => !common.includes(gap)).join('、')) + '</small>' : '') + '</button>';
    }).join('');
    const conditional = data.conditional && data.recommended && data.conditional.net > data.recommended.net ? '<p class="flow-conditional">另有条件方案已知损耗少 ' + feeText(data.conditional.net - data.recommended.net) + '：' + esc(data.conditional.eligibilityReasons.join('；')) + '。在高级设置确认资格后纳入比较。</p>' : '';
    return '<div class="flow-plan-picker"><h2>完整路线</h2><p class="flow-gap">' + esc(D.comparisonNotice) + '</p>' + (bocMobile.length ? '<div class="flow-channel-review">' + cards(bocMobile) + '</div>' : '') + '<div class="flow-plans">' + cards(shown, sharedMissing) + '</div>' +
      (sharedMissing.length ? '<p class="flow-gap">以上方案均待确认：' + esc(sharedMissing.join('、')) + '。已知损耗用于比较，不能保证实际最低。</p>' : '') + conditional +
      '<details class="flow-broker-plans"><summary>按交易账户选择整条路线</summary><div class="flow-plans">' + cards(brokerPlans) + '</div></details></div>';
  }
  function diagram(data) {
    const r = data.selected, s = r || data.selection || {}, route = s.route || 'USD', provider = s.broker || M.selectedBroker(state, D);
    const banks = provider.integratedBank ? D.hkBanks.filter(row => row.id === provider.integratedBank) : D.hkBanks;
    const fxModes = route === 'USD' ? [['manual', '美元原币 · 无需换汇']] : [...(provider.id === 'ibkr' ? [['manual', 'IBKR收到原币后手动换USD'], ['auto', 'IBKR买入时自动换USD']] : []), ['bank', '香港银行先换USD，再入金']];
    const ledger = M.diagramLedger(r || data.partial);
    const selection = key => key === 'startBank' ? s.start?.id : key === 'bank' ? s.bank?.id : key === 'returnBank' ? s.returning?.id : key === 'exitBank' ? s.exit?.id : state[key];
    const control = (key, label, options, value) => {
      const group = { startBank: 'start', bank: 'bank', returnBank: 'returnBank', exitBank: 'exit' }[key];
      const selectedId = value ?? selection(key);
      if (group) options = options.map(([id, name]) => {
        const entity = { start: 'start', bank: 'bank', returnBank: 'returning', exit: 'exit' }[group];
        const item = id === selectedId ? r || data.partial : data.alternatives?.[group]?.find(row => row[entity]?.id === id), metric = item && M.comparisonMetric(item, group, 'step');
        return [id, name, metric ? stepFeeText(metric) : item?.error?.replace(name, '').replace('；填入该行成交价后可计算。', '') || '缺少本段报价'];
      });
      return select(key, label, options, selectedId);
    };
    const controls = [
      control('startBank', '内地出发银行', bankOptions(data.mainland || D.mainlandBanks)) + control('bank', '香港入金银行', bankOptions(banks)) +
      control('route', '汇出币种', Object.entries(remittanceCurrencies), route) + control('mainlandMethod', '内地 → 香港方式', entryMethods(s), r?.mainlandMethod || state.mainlandMethod || 'swift') +
      (r?.mainlandMethod === 'payment-connect' ? '<div class="flow-channel-quote">' + note('已查到南向零手续费实例；本次收费以App确认页为准。仅作汇款费用情景，不作为美股入金推荐。') + field('senderFeeCny', '本次每笔跨境支付通服务费', 'CNY', '确认免收后填0') + '</div>' : ''),
      control('broker', '券商／银行证券账户', bankOptions(D.brokers), provider.id) + control('fxMode', '换成美元', fxModes, s.fxMode || 'manual') +
      control('depositMethod', '银行 → 交易账户方式', depositMethods(s), r?.depositMethod || state.depositMethod || 'chats'),
      brokerOffers(provider, r),
      control('returnBank', '香港回款银行', bankOptions(banks)) + note(esc(provider.withdrawalText)),
      control('exitBank', '内地收款／结汇银行', bankOptions(data.mainland || D.mainlandBanks)) + control('returnMethod', '香港 → 内地方式', returnMethods(s), r?.returnMethod || state.returnMethod || 'swift') +
      note('本段合并结汇及使用期支出；银行月费、开户支出、另留资产成本分别列出。')
    ];
    const titles = [route === 'CNH' ? '人民币原币汇出 → 香港收到CNH' : '内地购' + route + ' → 原币汇到香港',
      route === 'USD' ? 'USD原币转入交易账户' : s.fxMode === 'bank' ? '香港银行换USD → 美元入金' : '原币入金 → 券商换USD',
      '买入美股 → 卖出结算', '出金 → 香港本人账户', '汇回内地 → 结汇与支出'];
    const nodeTitles = ['内地银行卡人民币', '香港本人银行账户', '交易账户 · 买入前现金', '交易账户 · 卖出后现金', '香港本人回款账户', '内地人民币消费'];
    let html = planCards(data) + '<div class="flow-map-head"><div><h2>' + (state.plan === 'custom' ? '自选完整资金图' : '完整资金图') + '</h2><span>默认本金不涨不跌 · 各段使用同一参考基准 · 费用金额统一折合CNY</span></div>' + action('计算口径 ↗', 'detail', 'data-value="cost"', 'text-link') + '</div>' +
      '<div class="flow-inlet"><span>费用情景：便利化购汇不适用于境外证券投资；资金来源和出境用途须获准。</span>' + action('适用条件', 'detail', 'data-value="mainland"', 'text-link') + '</div>';
    html += '<div class="flow-inlet flow-scenario"' + (M.number(state.profitUsd) || M.number(state.taxableCny) ? '' : ' hidden') + '>高级情景已启用：交易费前盈亏 ' + num(M.number(state.profitUsd)) + ' USD；税款单列，损耗率剔除该盈亏。</div>';
    html += '<div class="flow-message" role="status"' + (r ? ' hidden' : '') + '>' + esc(data.error || '缺少报价') + ' ' + action('填入成交报价', 'detail', 'data-value="quotes"') + '</div>';
    html += '<div class="flow-ledger" role="group" aria-label="内地人民币到美股再到人民币消费的完整资金图">';
    for (let i = 0; i < 5; i++) {
      const leg = ledger?.legs[i], point = ledger?.stops[i] || { id: ['start', 'receiving', 'funding', 'sold', 'return', 'settle'][i], account: [s.start?.name, s.bank?.name, provider.name, provider.name, s.returning?.name, s.exit?.name][i] || '', currency: i === 0 || i === 5 ? 'CNY' : i === 1 ? route : 'USD', amount: i === 0 ? M.number(state.budgetCny) : null, cumulativeLossCny: i === 0 ? 0 : null };
      html += '<div class="flow-ledger-step">' + stop(point, i, nodeTitles[i]) + '<section class="flow-leg"><header><h3><span aria-hidden="true">↓</span> ' + titles[i] + '</h3>' +
        action(i === 0 ? '渠道与费用 ↗' : '详情 ↗', 'detail', 'data-value="' + ['entry', 'broker', 'broker', 'withdraw', 'spend', 'cost'][i] + '"', 'flow-node-detail') + '</header>' +
        '<div class="flow-leg-controls' + (i === 2 ? ' offers' : '') + '">' + controls[i] + '</div>' +
        (i === 1 && route !== 'USD' && r ? note(s.fxMode === 'bank' ? esc(s.bank.name) + '换汇后：' + num(r.steps.hkConvertedUsd) + ' USD，再转账入金' : esc(provider.name) + '先收到：' + num(r.steps.brokerOriginal) + ' ' + route + '，再换USD') : '') +
        fees(leg) + '<div class="flow-leg-metrics">' + legMetric(leg) + '</div>' +
        (leg?.missing.length ? '<p class="flow-gap">' + esc('未计／待确认：' + leg.missing.join('、')) + '</p>' : '') + '</section></div>';
    }
    const last = ledger?.stops[5] || { id: 'destination', account: s.exit?.name || '', currency: 'CNY' };
    html += '<div class="flow-ledger-end">' + stop(last, 5, nodeTitles[5]) + '<div class="flow-end-totals">' +
      '<div><span>全程' + (r?.complete ? '' : '已知') + '损耗</span><b class="num">' + feeText(ledger?.lossCny) + ' · ' + pct(r ? ledger.lossCny / r.budgetCny : null) + '</b></div>' +
      '<div><span>全程费用合计（含点差）</span><b class="num">' + feeText(r?.costCny) + '</b></div>' +
      (Math.abs(r?.fxImpactCny) >= .005 ? '<div><span>' + impactLabel(r.fxImpactCny) + '</span><b class="num">' + signedFee(r.fxImpactCny) + '</b></div>' : '') +
      '<div><span>税款预留（单列）</span><b class="num">' + feeText(r?.taxCny) + '</b></div>' +
      (r?.trading?.discountUsd ? '<div><span>已应用交易费券</span><b class="num">' + feeText(r.trading.discountUsd * r.refs.USD) + '</b></div>' : '') +
      '<p>' + (r?.indicativeFx ? '最终余额按参考成交价测算；' + esc(exactMissing(r)) : r?.missing.length ? '最终余额为未报价费用扣除前上限；' + esc(exactMissing(r)) : r ? '全部已知费用已计入上述余额。' : '待补齐报价后计算最终人民币。') + '</p></div></div></div>';
    return html;
  }
  function summary(data) {
    return '<div class="flow-caption"><span>损耗＝费用＋税款−参考汇率折算增值；折算减值则增加损耗。点差已含在成交价内，不会再次扣款。</span>' + action('成交报价与费用', 'detail', 'data-value="quotes"', 'text-link') + '</div>';
  }
  function comparisonOperations(item, key, fallback) {
    const s = { ...fallback, ...item }, bank = s.bank?.name || '香港银行', broker = s.broker?.name || '交易账户';
    const currency = { CNH: '人民币', USD: '美元', HKD: '港币' }[s.route] || '原币';
    const entry = { swift: '普通电汇', 'boc-mobile': '中行手机银行向境外中行', 'payment-connect': '跨境支付通', linked: '两地同名专用转账', full: 'SWIFT全额到账' }[item.mainlandMethod];
    const deposit = { fps: 'FPS', edda: 'eDDA', chats: 'CHATS', swift: 'SWIFT', internal: '内部交收' }[item.depositMethod] || '入金渠道待核';
    const returning = { swift: '普通SWIFT', 'bochk-fast': '中银快汇', linked: '两地同名专用转账' }[item.returnMethod] || '回款渠道待核';
    const arrival = s.route === 'CNH' ? '人民币原币汇出，香港收人民币（CNH）' : '人民币购入' + currency + '，以' + currency + '汇到香港';
    const funding = s.route === 'USD' ? '美元原币经' + deposit + '入金' : s.fxMode === 'bank' ? bank + '先将' + currency + '换美元，再经' + deposit + '入金' : currency + '经' + deposit + '入金，' + (s.fxMode === 'auto' ? '买入时自动换美元' : '在券商手动换美元');
    const withdrawal = { wire: '美元电汇出金', swift: '美元电汇出金', cheque: '美元支票出金', internal: '美元内部交收' }[s.broker?.withdrawalMethod] || '美元出金';
    const operations = [
      [(s.start?.name || '内地出发银行') + ' → ' + bank, arrival, entry || '汇出渠道待核'],
      [bank + ' → ' + broker, funding],
      ['在' + broker + '买入、卖出美股', '美元结算；交易费与税款计入本次比较'],
      [broker + ' → ' + (s.returning?.name || '香港回款账户'), withdrawal],
      [(s.returning?.name || '香港回款账户') + ' → ' + (s.exit?.name || '内地收款行'), '以美元汇回，再结汇成人民币 · ' + returning]
    ];
    const range = { start: [0, 1], bank: [0, 2], route: [0, 2], broker: [1, 4], returnBank: [3, 5], exit: [4, 5] }[key];
    return operations.slice(...range).map(([path, ...details]) => '<div class="flow-compare-operation"><span>' + esc(path) + '</span><small>' + details.map(esc).join(' · ') + '</small></div>').join('');
  }
  function comparison(data) {
    const key = state.comparison, rows = data.alternatives?.[key] || [], r = data.selected;
    const labels = { start: '内地出发银行', bank: '香港入金银行', route: '换汇路径', broker: '交易账户', returnBank: '香港回款银行', exit: '内地结汇银行' };
    const titles = { start: '汇款到香港 · 比较出发银行', bank: '汇款及入金 · 比较香港银行', route: '购汇、汇款及入金 · 比较换汇路径', broker: '入金、交易及出金 · 比较交易账户', returnBank: '出金并汇回内地 · 比较回款银行', exit: '汇回内地并结汇 · 比较收款银行' };
    const spans = { start: '范围：内地人民币汇出 → 香港银行到账', bank: '范围：内地人民币出发 → 交易账户美元入金', route: '范围：内地人民币出发 → 交易账户美元入金', broker: '范围：香港银行余额 → 入金、买卖及出金到账', returnBank: '范围：交易账户出金 → 香港银行回款 → 内地结汇', exit: '范围：香港美元汇回 → 内地人民币到账' };
    const identity = item => key === 'route' ? item.route : item[{ start: 'start', bank: 'bank', broker: 'broker', returnBank: 'returning', exit: 'exit' }[key]]?.id;
    const fallback = r || data.selection || {}, selectedId = identity(fallback);
    const tableRows = rows.map(item => {
      const id = identity(item), entity = key === 'route' ? null : item[{ start: 'start', bank: 'bank', broker: 'broker', returnBank: 'returning', exit: 'exit' }[key]];
      const metric = M.comparisonMetric(item, key), selected = id === selectedId;
      const included = new Set(metric?.rows.map(row => row.key) || []);
      const charges = (item.rows || []).filter(row => included.has(row.key)).flatMap(row => row.key === 'sender' ? row.items || [row] : [row]).filter(row => row.cny > 0);
      const pending = metric?.missing.length ? '缺少：' + metric.missing.join('、') : item.error || '缺少本次操作的费用报价';
      const costs = metric ? '<strong>' + (metric.complete ? '费用合计 ' : '已知费用小计 ') + feeText(metric.costCny) + '</strong>' +
        charges.map(row => '<small>' + esc(row.label) + ' ' + feeText(row.cny) + '</small>').join('') : '—';
      const loss = metric?.complete ? '<strong class="num">' + feeText(metric.lossCny) + '</strong><span class="num">' + pct(metric.lossRate) + '</span>' +
        (metric.taxCny ? '<small>含税款预留 ' + feeText(metric.taxCny) + '</small>' : '') +
        (Math.abs(metric.fxImpactCny) >= .005 ? '<small>' + impactLabel(metric.fxImpactCny) + ' ' + signedFee(metric.fxImpactCny) + '</small>' : '') :
        '<strong class="flow-comparison-pending">' + (metric ? '损耗待核' : '无法计算') + '</strong><small>' + esc(pending) + '</small>';
      return '<tr class="' + (selected ? 'selected' : '') + '"><td><strong>' + esc(key === 'route' ? routes[id] : entity?.name) + '</strong>' +
        (item.eligibilityReasons?.length ? '<small>' + esc(item.eligibilityReasons.join('；')) + '</small>' : '') + '</td>' +
        '<td>' + comparisonOperations(item, key, fallback) + '</td><td class="flow-comparison-cost">' + costs + '</td><td>' + loss + '</td><td>' +
        action(selected ? '已选' : '选用', 'choose', 'data-field="' + ({ start: 'startBank', bank: 'bank', route: 'route', broker: 'broker', returnBank: 'returnBank', exit: 'exitBank' }[key]) + '" data-value="' + esc(id) + '"' + (selected ? ' disabled' : '')) + '</td></tr>';
    }).join('');
    return '<div class="flow-comparison-head"><div><h2>' + titles[key] + '</h2><span>' + spans[key] + ' · 起始本金 ' + feeText(M.number(state.budgetCny)) + '</span></div></div>' +
      '<div class="flow-comparison-tabs segmented" aria-label="费用对比">' + Object.entries(labels).map(([id, label]) => action(label, 'compare', 'data-value="' + id + '" aria-pressed="' + (key === id) + '"', key === id ? 'active' : '')).join('') + '</div>' +
      '<div class="table-wrap"><table class="flow-bank-table"><thead><tr>' + [labels[key], '本次比较的操作与渠道', '操作费用 · CNY', '折算损耗 · CNY / %', ''].map(t => '<th>' + t + '</th>').join('') + '</tr></thead><tbody>' + tableRows + '</tbody></table></div>';
  }
  function parameters() {
    const group = (title, fields) => '<h3>' + title + '</h3><div class="flow-parameter-grid">' + fields.map(args => field(...args)).join('') + '</div>';
    return '<div class="flow-adjustments"><h3>已确认的账户资格</h3><div class="flow-eligibility">' + [['cib', '持有兴业寰宇人生指定卡'], ['hang', '已有恒生两地账户及跨域转账资格'], ['hsbc', '已有汇丰两地环球转账资格及卓越理财豁免／达标'], ['sc', '已有渣打两地优先理财及同名速汇资格']].map(([id, label]) => checkbox('eligible_' + id, label)).join('') + '</div>' +
      group('汇款与账户', [['count', '内地汇出笔数', '笔'], ['usedFreeTransfers', '已用优惠免费笔数', '笔'], ['balanceHkd', '入金银行另留资产', 'HKD'], ['returnBalanceHkd', '回款银行另留资产', 'HKD']]) +
      group('盈亏情景、税款与出金', [['profitUsd', '卖出盈亏（交易费前）', 'USD'], ['taxRate', '境外财产转让所得税率', '%'], ['taxableCny', '已核算人民币应税所得', 'CNY', '按净利润估算'], ['creditCny', '可抵免境外税额', 'CNY'], ['withdrawalIndex', '本月第几次券商出金', '次']]) +
      group('内地 → 香港', [['senderFeeCny', '每笔汇出手续费＋电讯费', 'CNY', '按渠道；确认双免填0'], ['entryMiddleCny', '每笔内地→香港中转费', 'CNY', '未报价；免收填0'], ['entryInwardHkd', '每笔香港首次汇入费', 'HKD', '所选银行公开基准']]) +
      group('香港 → 券商 → 香港', [['depositHkd', '银行向券商转账费', 'HKD', '所选方式公开基准'], ['depositOtherCny', '入金代理／收款行费', 'CNY', '未报价；免收填0'], ['inwardHkd', '券商出金银行收款费', 'HKD', '所选银行公开基准'], ['intermediaryCny', '券商出金中转费', 'CNY', '未报价；免收填0']]) +
      group('香港 → 内地', [['returnWireHkd', '香港回内地汇出费', 'HKD', '所选方式公开基准'], ['returnExtraCny', '回内地中转／收款费', 'CNY', '未报价；免收填0'], ['monthlyHkd', '入金银行月费', 'HKD', '所选账户标准'], ['returnMonthlyHkd', '回款银行月费', 'HKD', '相同银行不重复扣']]) +
      group('额外成本', [['openingCny', '开户／赴港实际支出', 'CNY'], ['extraCapitalCny', '另占用资产本金', 'CNY'], ['annualGapPct', '占用资产年收益差', '%']]) +
      '<div class="flow-adjust-actions">' + action('成交汇率', 'detail', 'data-value="quotes"') + action('恢复官方报价与费用', 'clear-quotes') + action('重置全部', 'reset') + '</div></div>';
  }
  function view(helpers) {
    H = helpers;
    const data = result();
    if (!state.startBank && data.selected) { Object.assign(state, M.routeConfiguration(data.selected)); save(); }
    return H.head('CROSS-BORDER MONEY', '跨境资金', '内地银行卡人民币 → 买美股 → 内地人民币消费', action('官方依据', 'detail', 'data-value="sources"')) +
      '<div class="page-money-flow"><div class="flow-controls">' + field('budgetCny', '内地人民币本金', 'CNY') + field('months', '账户使用月数', '月') + '</div>' +
      '<section class="card flow-map-card"><div id="flow-live-diagram">' + diagram(data) + '</div><div id="flow-live-summary">' + summary(data) + '</div></section>' +
      '<section class="card flow-trading-card"><h2>交易费测算</h2><p>按测算均价、买卖笔数及账户使用月数计算；实际交易费可直接覆盖。</p><div class="flow-parameter-grid">' +
        field('sharePriceUsd', '测算买入均价', 'USD/股') + field('buyOrders', '买入笔数', '笔') + field('sellOrders', '卖出笔数', '笔') + field('tradeFeeUsd', '实际买卖交易费合计', 'USD', '留空按收费表计算') + '</div>' +
        '<div class="flow-parameter-grid flow-extra-trade" data-money-when="hsbc"' + (state.broker === 'hsbc' ? '' : ' hidden') + '>' + field('otherTurnoverHkd', '各交易月其他已用成交额', 'HKD') + '</div>' +
        '<div class="flow-parameter-grid flow-extra-trade" data-money-when="za"' + (state.broker === 'za' ? '' : ' hidden') + '>' + field('usedPromoOrders', '各交易月已用Lv2笔数', '笔') + '</div>' +
        '<div class="flow-parameter-grid flow-extra-trade" data-money-when="usmart"' + (state.broker === 'usmart' ? '' : ' hidden') + '>' + field('usmartDays', '开户距今', '天') + '</div></section>' +
      '<section class="card" id="flow-live-comparison">' + comparison(data) + '</section><details class="card flow-disclosure"><summary>高级设置 · 盈亏、税款、账户与手续费</summary>' + parameters() + '</details></div>';
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
    for (const [id, renderer] of [['flow-live-diagram', diagram], ['flow-live-summary', summary], ['flow-live-comparison', comparison]]) {
      const element = document.getElementById(id);
      if (element) patch(element, renderer(data));
    }
    document.querySelectorAll('[data-money-when]').forEach(element => { element.hidden = element.dataset.moneyWhen !== state.broker; });
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
      if (provider.integratedBank) {
        state.bank = state.returnBank = provider.integratedBank;
        clear(['entryInwardHkd', 'monthlyHkd', 'returnMonthlyHkd', 'returnWireHkd', 'returnExtraCny']);
      }
      state.fxMode = state.route === 'USD' ? 'manual' : provider.id === 'ibkr' ? 'manual' : 'bank';
      state.depositMethod = provider.integratedBank ? 'internal' : state.route === 'USD' || state.fxMode === 'bank' ? 'chats' : 'fps';
      state.voucherScope = provider.id === 'chief' || provider.id === 'usmart' || provider.id === 'za' ? 'platform' : 'commission';
    }
    if (key === 'startBank') clear(['startSell', 'senderFeeCny', 'entryMiddleCny']);
    if (key === 'bank') clear(['entryInwardHkd', 'depositHkd', 'depositOtherCny', 'monthlyHkd', 'entryPrice']);
    if (key === 'returnBank') clear(['inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd']);
    if (key === 'route') {
      clear(['startSell', 'entryPrice']);
      if (value === 'USD' || previousRoute === 'USD') state.fxMode = value !== 'USD' && provider.id !== 'ibkr' ? 'bank' : 'manual';
      const methods = depositMethods({ route: value, fxMode: state.fxMode, broker: provider });
      if (!methods.some(([id]) => id === state.depositMethod)) state.depositMethod = methods[0][0];
    }
    if (key === 'fxMode') { clear(['entryPrice', 'depositHkd', 'depositOtherCny']); state.depositMethod = value === 'bank' || state.route === 'USD' ? 'chats' : 'fps'; }
    if (key === 'depositMethod') clear(['depositHkd', 'depositOtherCny']);
    if (key === 'mainlandMethod') clear(['senderFeeCny', 'entryMiddleCny']);
    if (key === 'exitBank') clear(['exitPrice', 'returnExtraCny']);
    if (key === 'returnMethod') clear(['returnWireHkd', 'returnExtraCny']);
    const start = D.mainlandBanks.find(bank => bank.id === state.startBank), bank = D.hkBanks.find(bank => bank.id === state.bank),
      returning = D.hkBanks.find(bank => bank.id === state.returnBank), exit = D.mainlandBanks.find(bank => bank.id === state.exitBank);
    if (['startBank', 'bank', 'broker'].includes(key)) state.mainlandMethod = ['hang', 'hsbc', 'sc'].includes(start?.id) && start.group === bank?.group ? 'linked' : start?.id === 'boc' && bank?.id === 'bochk' && state.route !== 'CNH' ? 'boc-mobile' : 'swift';
    if (['startBank', 'bank', 'route', 'broker'].includes(key) && !entryMethods({ start, bank, route: state.route }).some(([id]) => id === state.mainlandMethod)) state.mainlandMethod = 'swift';
    if (state.bank !== previousBank || state.route !== previousRoute || state.mainlandMethod !== previousMethod) clear(['senderFeeCny', 'entryMiddleCny']);
    if (['exitBank', 'returnBank', 'broker'].includes(key)) state.returnMethod = returnMethods({ returning, exit }).find(([id]) => id !== 'swift')?.[0] || 'swift';
    save(); refresh();
  }
  function detail(key) {
    const data = result(), r = data.selected, s = r || data.selection || {};
    const provider = s.broker || M.selectedBroker(state, D);
    const descriptions = {
      mainland: ['适用条件', '从内地银行卡人民币开始计算完整往返费用；金额测算不等于出境许可。大陆个人便利化购汇不能用于境外证券投资，同名香港账户不改变用途。跨境人民币也须符合真实用途、资本项目和银行准入规则。资金来源、获准渠道和券商接受身份必须先确认；银行优惠不代表证券投资出境资格。', ['safe', 'pbcRmb', 'scCnTerms', 'csrc']],
      entry: ['内地人民币出发', '汇出手续费、电讯费和全额到账附加费先从人民币预算内扣除，再按出发银行现汇卖出价购汇。买美股可以直接换USD，不必经过港币。人民币原币到港后为CNH，此步没有换汇点差。CNY/CNH及不同时点、银行报价的折算影响单列，正值不代表银行返还手续费。普通SWIFT中转费无统一值；农行USD全额到账附加25美元按每笔计入。指定同名优惠须匹配银行集团和账户条件。', s.start?.sources || ['bocFx', 'abc']],
      bank: ['香港同名银行', '入金银行与回款银行可以不同，月费分别算；相同银行不重复扣。公开基准遍历已收录的银行、换汇路径、交易账户、香港回款银行及内地结汇行。中行手机银行同名优惠、跨境支付通等现行收费未核齐，不能据此判定哪家最低。普通电汇标准价与手机银行专属优惠分开；中银香港同名中行汇入基本手续费为0，不能由此推定内地汇出端及中转端全部免费。有门槛的账户在确认资格后纳入比较。汇丰One新开非香港身份证账户不足1万港元按100港元/月；渣打中国同名优惠须优先理财及指定渠道。', ['hangOpen', 'hsbcHk', 'sc', 'scTier', 'hang', 'hsbcGlobal']],
      broker: ['美股交易账户与优惠', provider.fundingText + '。' + provider.feeText + '。' +
        (provider.id === 'hsbc' ? '2026年18–35岁可申请Trade25；26岁以上通常须每年完成25笔交易才能续用，25岁转26岁的加入年份等有例外。36岁以上须符合One+新股票客户专门条件。每月首25万港元成交额免佣金及平台费，超额按普通美股收费；持仓或交易月份仍收25港元，监管费另计。One的三个月平均全面理财总值包括该行证券持仓，须实际满足后才勾免月费，不能把100港元银行月费与25港元Trade25月费混为一项。' :
          provider.id === 'chief' ? '网上直属客户常规佣金为0，平台费和清算费仍计入。2026年App月供每只股票每次首500美元免佣金及平台费，超额0.15%；仅合资格月供买入，普通卖出仍按标准价。' :
          provider.id === 'usmart' ? '按非香港身份证个人标准账户收费。0.99美元平台费要求合资格标的、成交股价至少100美元、App交易及开户180天内；已核实推广期至2026年12月31日。本测算只在有效期内应用优惠，后续卖出自动恢复常规费率。清算及监管费另计。' :
          provider.id === 'za' ? '常规佣金已是0，不能再次把迎新免佣当作额外收益。Lv2每月前5笔港/美股交易平台费0.008美元/股、最低0.99美元；后续恢复常规费率。卖出资金直接回存款账户。随机开户奖赏不抵扣成本；已到账的费用券须自行确认范围、额度、可用笔数和有效期。' :
          '按IBKR Pro Fixed收费；Lite免佣只适用于符合条件的美国居民。手动换汇0.002%、最低2美元；自动换汇加价0.03%，不叠加手动佣金。USD用CHATS/SWIFT，HKD/CNH可用FPS/eDDA。') +
        '银行先换USD优先使用该行实际报价；目前公开覆盖中银香港。其他行缺成交价时，按统一参考中间价保留已知交易收费测算，换汇点差仍为未报价，整条路线标为参考且不参与排名；填入该行账户报价后按成交价计算。其他券商不套用IBKR换汇佣金。费用券信息未填齐时不抵扣，也不影响其他费用；只抵指定佣金/平台费，不抵税费、清算费或月费。', [...provider.sources, 'bochkUsdFx']],
      withdraw: ['卖出与同名出金', provider.withdrawalText + '。卖出盈亏按交易费前USD输入，买卖费用与证券月费另扣。' +
        (provider.withdrawalMethod === 'internal' ? '该行证券交易直接交收至本人USD存款账户，不叠加外部券商入金、中转或电汇收款费。' : provider.withdrawalMethod === 'cheque' ? '支票出金没有SWIFT中转行费；收款银行美元支票处理费用需另核，未报价不默认为0。需已登记美元账户；遥距开户限制可能需到分行解除。' :
          '券商豁免提款收费不代表银行汇入或中转费也免；未公开费用按实际单据填写。') + '交易费用按起始月均分买入、账户使用最后一个月均分卖出估算；不足一月仍按一个交易月，不含中间调仓、分红、融资或ADR额外收费。长期结果使用当前常规费率基准，限期优惠只在已核实有效期内应用。', provider.sources],
      spend: ['回内地人民币消费', 'USD汇回本人内地外汇账户，用收款银行现汇买入价结汇为CNY，无需再经HKD，也不计算香港卡签账费。中银快汇网上至内地中行汇出费0，普通SWIFT汇出65港元；中转、收款行费用另核。两地同名回款须匹配银行集团。保留资金来源、交易与税务凭证并满足汇回、结汇审核。', ['bochk', 'remit', 'safe', 'hang', 'hsbcGlobal']],
      tax: ['税款按利润单列', '大陆税收居民境外财产转让所得通常20%，按人民币收入减成本及允许费用核算，不是对本金或整笔提现征税；股息另行核算。默认仅以正的净交易利润×USD/CNY参照估算，假定买卖汇率相同。有已核算人民币应税所得时优先使用，境外税抵免须有依据。不能代替真实人民币成本及汇率损益核算。', ['tax']],
      sources: ['官方报价与收费依据', '自动更新7家内地银行及中银香港牌价，各行时间分别保留。出发银行覆盖10种账户／渠道，香港银行5家。兴业公开接口无报价，恒生中国及渣打中国需账户询价；工行与交行现行个人汇出完整费用未核齐，不参与公开基准排序。超过3天的报价不参与排序。中行手机银行同名优惠和跨境支付通仍缺完整现行证据，因此只提供渠道测算，不发布最低损耗推荐。中行2022年手机银行双免公告已过有效期，不自动延长；普通电汇标准价也不能冒充手机银行实际收费。未报价费用可能改变排序；券商参考价不是可执行价。每笔手续费只扣一次。人民币原币汇出没有换汇费用，CNY/CNH及不同银行、时点的参考折算影响单列；最终人民币＋已知费用＋税款＝人民币本金＋USD盈亏折合＋汇率折算影响。', Object.keys(D.sources)]
    };
    let title, content, keys;
    if (key === 'cost') {
      title = '逐笔费用、参考估值与守恒核对'; keys = [...provider.sources, 'tax'];
      content = r ? '<p>损耗率＝1−（本段流出余额×统一参考价−本段投资盈亏）÷（本段流入余额×统一参考价）。累计损耗＝本金＋累计投资盈亏折合−当前余额折合。同一基准贯穿每条路线；负损耗只表示参考折算增值，不是银行返费。费用使用非负金额，未知费用留空。金额内部保留精度，逐项显示四舍五入可能有分差。</p><p>银行买卖中间价用于拆解点差；统一参考价用于比较币值，两者差额已在各段费用下单列。该差额不作为补贴，也不从余额重复扣除。</p><div class="flow-cost-detail">' + r.rows.map(row => '<div><span>' + esc(row.label) + '</span><b class="num">' + feeText(row.cny) + '</b></div>' +
        (Math.abs(row.fxImpactCny ?? 0) >= .005 ? '<div><span>' + esc(row.label) + ' · 汇率折算影响</span><b class="num">' + (row.fxImpactCny > 0 ? '+' : '') + num(row.fxImpactCny) + ' CNY</b></div>' : '')).join('') +
        '<div><span>全程已知费用</span><b class="num">' + num(r.costCny) + ' CNY</b></div><div><span>汇率折算影响（独立列示）</span><b class="num">' + (r.fxImpactCny > 0 ? '+' : '') + num(r.fxImpactCny) + ' CNY</b></div>' +
        '<div><span>税款（独立列示）</span><b class="num">' + num(r.taxCny) + ' CNY</b></div></div>' +
        (r.trading && !r.trading.overridden ? '<h3>交易费明细 · USD</h3><div class="table-wrap"><table class="flow-trade-detail"><thead><tr><th>订单</th><th>佣金</th><th>平台费</th><th>清算/监管</th><th>券抵扣</th><th>实收</th></tr></thead><tbody>' + r.trading.orders.map(order => '<tr><td>' + (order.kind === 'buy' ? '买入' : '卖出') + '<small>' + order.date + (order.offer ? ' · ' + esc(order.offer) : '') + '</small></td>' +
          [order.commission, order.platform, order.clearing + order.sec + order.taf + order.cat, order.discount, order.feeUsd].map(value => '<td class="num">' + num(value, 4) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '') : '<p>' + esc(data.error) + '</p>';
    } else if (key === 'entry') {
      title = '内地 → 香港：渠道与费用';
      keys = ['boc', 'bochkSame', 'bocPaymentConnect', 'bocPaymentCase', 'paymentCurrent', 'bocMobileHistory'];
      content = '<p>“零损耗”需要明确币种、渠道和范围：人民币原币到账、所有汇出及收款费用均为0时，才是这段名义金额无损；之后换美元及交易另计。</p>' +
        '<div class="table-wrap"><table class="flow-channel-table"><thead><tr><th>渠道</th><th>已核实</th><th>适用范围／待确认</th></tr></thead><tbody>' +
        '<tr><th>跨境支付通</th><td>中行支持人民币汇出、人民币或港币到账；2025年中行南向汇款有零手续费实例。</td><td>本次收费按App确认页；人民币原币到账不换汇，港币到账需另计汇率差。南向占用年度等值5万美元便利化额度，实际交易限额及用途须银行确认。</td></tr>' +
        '<tr><th>手机银行向境外中行</th><td>同名中银香港基本汇入费豁免。</td><td>内地汇出手续费、电讯费及代理行费另核；取得的双免公告仅覆盖2022年，不能作为现行承诺。</td></tr>' +
        '<tr><th>普通电汇</th><td>中行公开标准价：1‰，每笔50–260元，香港电讯费80元。</td><td>只用于所选标准电汇情景，不代表手机银行优惠或跨境支付通实际收费。</td></tr></tbody></table></div>' +
        '<p>截至2026-10-09，已确认零手续费实例真实存在；尚未找到覆盖所有中行客户的现行南向永久免费条款。支付通本次费率留空，确认免收后填0；不纳入美股入金推荐。</p>' +
        '<p>' + esc(descriptions.entry[1]) + '</p>';
    } else if (key === 'quotes') {
      title = '本方案成交报价与费用'; keys = ['bocFx', 'cmbFx', 'icbcFx', 'ccbFx', 'abcFx', 'commFx', 'hsbcFx', 'bochkUsdFx'];
      content = '<p>留空读取官方基准；未知费用留空，确认免收才填0。报价及银行优惠绑定当前所选银行。</p>' + (r ? '<div class="flow-cost-detail"><div><span>' + esc(r.start.name) + '每1' + r.route + '现汇卖出 · ' + esc(M.number(state.startSell) != null ? '本人填入的执行价' : r.entryAsOf || '人民币原币汇出') + '</span><b class="num">' + num(r.startSell, 6) + ' CNY</b></div><div><span>每1USD换汇成交价 · ' + esc(M.number(state.entryPrice) != null ? '本人填入的执行价' : r.fxAsOf || 'USD原币') + '</span><b class="num">' + num(r.entryPrice, 6) + ' ' + r.route + '</b></div><div><span>' + esc(r.exit.name) + '每1USD现汇买入 · ' + esc(M.number(state.exitPrice) != null ? '本人填入的执行价' : r.exitAsOf) + '</span><b class="num">' + num(r.exitPrice, 6) + ' CNY</b></div><div><span>统一参考值 USD / HKD / CNH（CNY）</span><b class="num">' + [r.refs.USD, r.refs.HKD, r.refs.CNH].map(v => num(v, 6)).join(' / ') + '</b></div></div>' : '') + '<div class="flow-parameter-grid">' +
        field('startSell', '出发银行每1外币卖出价', 'CNY', '所选银行官方报价') + field('senderFeeCny', '每笔汇出手续费＋电讯费', 'CNY', '银行公开基准') +
        field('entryPrice', '香港换USD：每1USD原币价', s.route || 'USD', '券商参考／本行报价') + field('exitPrice', '收款银行每1USD买入价', 'CNY', '所选银行官方报价') +
        field('usdCny', '损耗折算参照 USD/CNY', '', '内地买卖价中间值') + field('usdHkd', '损耗折算参照 USD/HKD', '', '中银香港中间值') +
        field('usdCnh', '损耗折算参照 USD/CNH', '', '中银香港中间值') + '</div>';
    } else {
      const description = descriptions[key] || descriptions.sources;
      [title, , keys] = description;
      content = '<p>' + esc(description[1]) + '</p>';
    }
    H.openModal(H.modalTitle(title, '内地人民币出发 · 美股投资 · 内地人民币消费') + '<div class="flow-detail">' + content + '<div class="flow-detail-sources">' + keys.map(source).join('') + '</div></div>');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('money-flow-', ''), value = button.dataset.value;
    if (act === 'detail') { detail(value); return; }
    if (act === 'compare') { state.comparison = value; save(); refresh(); return; }
    if (act === 'choose') { choose(button.dataset.field, value); return; }
    if (act === 'select-choice') {
      const key = button.dataset.field;
      button.closest('.flow-select').open = false;
      if (button.getAttribute('aria-pressed') !== 'true') choose(key, value);
      document.getElementById('flow-select-' + key)?.focus({ preventScroll: true });
      return;
    }
    if (act === 'preset') {
      const preset = result().presets?.find(row => row.id === value);
      if (preset) { state = M.applyRoute(state, preset.result, value); syncFields(); save(); refresh(); }
      return;
    }
    if (act === 'clear-quotes') { clear(quoteKeys); save(); refresh(); return; }
    if (act === 'reset') { state = { ...defaults }; save(); H.render(); }
  }
  function handleInput(el) {
    const key = el.dataset.moneyField;
    if (!key) return false;
    if (!['budgetCny', 'profitUsd', 'months'].includes(key)) { lockCurrent(); state.plan = 'custom'; }
    state[key] = el.value;
    document.querySelectorAll('[data-money-field="' + key + '"]').forEach(input => { if (input !== el) input.value = el.value; });
    save(); clearTimeout(timer); timer = setTimeout(refresh, 100); return true;
  }
  function handleChange(el) {
    if (el.dataset.moneyCheck) { lockCurrent(); state[el.dataset.moneyCheck] = el.checked; state.plan = 'custom'; save(); refresh(); return true; }
    if (el.dataset.moneySelect) { choose(el.dataset.moneySelect, el.value); return true; }
    if (el.dataset.moneyField) { clearTimeout(timer); refresh(); return true; }
    return false;
  }
  document.addEventListener('keydown', event => {
    const menu = event.target.closest('.flow-select');
    if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...menu.querySelectorAll('.flow-select-option')];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(event.target.closest('.flow-select-option'));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : current < 0 ? options.findIndex(option => option.getAttribute('aria-pressed') === 'true') : current + (event.key === 'ArrowDown' ? 1 : -1);
    menu.open = true;
    const target = options[Math.max(0, Math.min(options.length - 1, next))];
    target.focus({ preventScroll: true });
    const list = menu.querySelector('.select-menu-list'), targetRect = target.getBoundingClientRect(), listRect = list.getBoundingClientRect();
    if (targetRect.top < listRect.top) list.scrollTop += targetRect.top - listRect.top - 6;
    if (targetRect.bottom > listRect.bottom) list.scrollTop += targetRect.bottom - listRect.bottom + 6;
  });
  document.addEventListener('focusin', event => {
    // Pointer clicks close other menus after mouseup in the shared handler,
    // so collapsing a preceding list cannot move the target mid-click.
    if (document.documentElement.dataset.inputMode !== 'keyboard') return;
    document.querySelectorAll('.flow-select[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('toggle', event => {
    const menu = event.target;
    if (!menu.matches('.flow-select') || !menu.open) return;
    const list = menu.querySelector('.select-menu-list'), focused = document.activeElement?.closest('.flow-select-option');
    const rect = menu.querySelector('summary').getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
    const opensAbove = below < Math.min(264, list.scrollHeight) && above > below;
    menu.dataset.side = opensAbove ? 'above' : 'below';
    list.style.maxHeight = Math.max(40, Math.min(264, opensAbove ? above : below)) + 'px';
    const target = focused && list.contains(focused) ? focused : list.querySelector('[aria-pressed="true"]');
    if (target) list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top - 6;
  }, true);
  const closeSelects = event => document.querySelectorAll('.flow-select[open]').forEach(menu => {
    if (!(event.target instanceof Node) || !menu.querySelector('.select-menu-list').contains(event.target)) menu.open = false;
  });
  document.addEventListener('scroll', closeSelects, true);
  window.addEventListener('resize', closeSelects);
  window.ChanghengMoneyFlow = { view, handleAction, handleInput, handleChange };
}());
