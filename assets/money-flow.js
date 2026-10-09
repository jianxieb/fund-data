(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel, STORE = 'changheng.money-flow.v3';
  const defaults = { budgetCny: '100000', currency: 'CNY', plan: 'recommended', startBank: '', route: '', bank: '', returnBank: '', exitBank: '',
    mainlandMethod: '', depositMethod: '', fxMode: '', returnMethod: '', comparison: 'start', count: '1', usedFreeTransfers: '0',
    months: '12', balanceHkd: '0', returnBalanceHkd: '0', profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1', tradeFeeUsd: '0',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', inwardHkd: '', intermediaryCny: '',
    returnWireHkd: '', returnExtraCny: '', monthlyHkd: '', returnMonthlyHkd: '', startSell: '', entryPrice: '', exitPrice: '',
    usdCny: '', usdHkd: '', usdCnh: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  let state = { ...defaults, ...stored, currency: 'CNY' }, H, timer;
  const esc = value => H.esc(value), num = (value, digits = 2) => value == null ? '—' : H.money(value, digits);
  const action = (label, act, extra = '', cls = 'btn') => H.action(label, 'money-flow-' + act, cls, extra);
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {} };
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const result = () => M.journeyPlans({ ...state, date: today() }, D, window.MONEY_FLOW_QUOTES || {});
  const source = key => D.sources[key] ? '<a class="source-link" target="_blank" rel="noopener noreferrer" href="' + esc(D.sources[key].url) + '">' + esc(D.sources[key].name) + ' ↗</a>' : '';
  const rowFee = (r, key) => r?.rows?.find(row => row.key === key)?.cny;
  const sumFees = (r, keys) => keys.reduce((sum, key) => sum + (rowFee(r, key) ?? 0), 0);
  const feeText = value => value == null ? '未报价' : num(value) + ' CNY';
  const routes = { USD: '内地换美元 → 美元入金', HKD: '内地换港币 → 再换美元', CNH: '人民币到港 → 再换美元' };
  const bankOptions = banks => banks.map(bank => [bank.id, bank.name]);
  function field(key, label, unit = '', placeholder = '') {
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input type="text" inputmode="decimal" data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div></label>';
  }
  function select(key, label, values, value) {
    return '<label class="flow-field"><span>' + esc(label) + '</span><select data-money-select="' + key + '" aria-label="' + esc(label) + '">' + values.map(([id, text]) => '<option value="' + esc(id) + '"' + (value === id ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
  }
  function entryMethods(s) {
    return [['swift', '网银／App · 普通SWIFT'], ...(['hang', 'hsbc', 'sc'].includes(s.start?.id) && s.start.group === s.bank?.group ? [['linked', '两地同名专用渠道']] : []),
      ...(s.route === 'USD' && s.start?.fullAmountUsd != null ? [['full', 'SWIFT · 全额到账（加25 USD）']] : [])];
  }
  function depositMethods(s) {
    return s.route === 'USD' || s.fxMode === 'bank' ? [['chats', 'USD本地CHATS转账'], ['swift', 'USD SWIFT电汇']] :
      [['fps', 'HKD／CNH转数快 FPS'], ['edda', 'HKD／CNH eDDA扣款'], ['swift', 'HKD／CNH SWIFT电汇']];
  }
  function returnMethods(s) {
    return [['swift', 'USD · 普通SWIFT汇款'], ...(s.returning?.id === 'bochk' && s.exit?.group === 'boc' ? [['bochk-fast', '中银快汇 · 网上汇至内地中行']] : []),
      ...(['hang', 'hsbc', 'sc'].includes(s.returning?.id) && s.returning.group === s.exit?.group ? [['linked', '两地同名专用渠道']] : [])];
  }
  const note = text => '<p class="flow-stop-note">' + text + '</p>';
  function stepCost(r, keys) {
    if (!r) return '等待有效报价';
    const rows = r.rows.filter(row => keys.includes(row.key)), unknown = rows.filter(row => row.cny == null);
    const impact = rows.reduce((sum, row) => sum + (row.fxImpactCny ?? 0), 0);
    return '该步已知费用 <b class="num">' + num(sumFees(r, keys)) + ' CNY</b>' +
      (Math.abs(impact) >= .005 ? '<span class="flow-fx-impact">汇率折算影响 ' + (impact > 0 ? '+' : '') + num(impact) + ' CNY</span>' : '') +
      (unknown.length ? '<span>待确认：' + unknown.map(row => esc(row.label)).join('、') + '</span>' : '');
  }
  function node(cls, step, title, content, value, currency, cost, detailKey) {
    return '<section class="flow-stop ' + cls + '"><header><span class="flow-step">' + step + '</span><h3>' + esc(title) + '</h3>' +
      action('详情 ↗', 'detail', 'data-value="' + detailKey + '"', 'flow-node-detail') + '</header><div class="flow-stop-body">' + content + '</div>' +
      '<footer><div class="flow-stop-value num">' + num(value) + '<small>' + esc(currency) + '</small></div><div class="flow-step-cost">' + cost + '</div></footer></section>';
  }
  function arrow(cls, reverse = false) {
    return '<div class="flow-connector ' + cls + (reverse ? ' reverse' : '') + '" aria-hidden="true"><svg viewBox="0 0 38 18"><path d="M2 9h30m-6-5 6 5-6 5"/></svg></div>';
  }
  function bankChoices(data) {
    const r = data.selected, s = r || data.selection || {}, route = s.route || 'USD';
    const choices = (data.mainland || D.mainlandBanks).map(bank => {
      const item = data.alternatives?.start?.find(row => row.start.id === bank.id), q = bank.quotes?.[route];
      const selected = bank.id === s.start?.id, price = route === 'CNH' ? 1 : selected ? r?.startSell ?? q?.sell : q?.sell;
      const coefficient = price > 0 ? 1 / price : null;
      let sender = rowFee(item, 'sender');
      // An unavailable exchange quote does not invalidate an independently
      // published remittance tariff, such as CIB's free-transfer allowance.
      const linked = ['hang', 'hsbc', 'sc'].includes(bank.id), sameGroup = bank.group === s.bank?.group;
      if (sender == null && item?.error && (!linked || sameGroup) && (route !== 'CNH' || sameGroup || bank.cnhTariff || bank.id === 'abc')) {
        const count = M.number(state.count), used = M.number(state.usedFreeTransfers) || 0;
        const tariffRows = count > 0 && Number.isInteger(count) ? Array.from({ length: Math.min(120, count) }, (_, i) => M.remitPrincipal(M.number(state.budgetCny) / count, bank, used + i + 1, today())) : [];
        if (tariffRows.length && tariffRows.every(Boolean)) sender = tariffRows.reduce((sum, row) => sum + row.fee, 0);
      }
      const entryMissing = item?.rows?.filter(row => ['sender', 'entryMiddle', 'entryInward'].includes(row.key) && row.cny == null) || [];
      const fresh = route === 'CNH' || (q && M.quoteFresh(q, today()));
      const status = coefficient == null ? '本行' + route + '牌价未公开' : !fresh ? '牌价已过期' : sender == null ? '汇出收费需核对' : entryMissing.length ? '中转费按实收取' : '已计到港费用';
      return '<button type="button" class="flow-bank-choice' + (selected ? ' selected' : '') + '" data-action="money-flow-choose" data-field="startBank" data-value="' + bank.id + '" aria-pressed="' + selected + '">' +
        '<strong>' + esc(bank.name) + (selected ? '<span aria-hidden="true">✓</span>' : '') + '</strong>' +
        '<span class="flow-bank-coefficient">1 CNY → <b class="num">' + num(coefficient, 6) + '</b> ' + route + '</span>' +
        '<span class="flow-bank-quote-fee">汇出费 <b class="num">' + (sender == null ? '待核对' : num(sender) + ' CNY') + '</b></span>' +
        '<span class="flow-bank-arrival">到港' + (entryMissing.length || item?.error ? '上限' : '') + ' <b class="num">' + num(item?.steps?.hongKong) + '</b> ' + route + '</span>' +
        '<small>' + esc(status) + (q?.asOf ? ' · ' + esc(q.asOf) : '') + '</small></button>';
    }).join('');
    return '<div class="flow-bank-picker"><div class="flow-bank-picker-head"><h3>选择出发银行</h3>' + select('route', '换汇路径', Object.entries(routes), route) + '</div>' +
      '<div class="flow-bank-choices" role="group" aria-label="出发银行汇率与到港系数">' + choices + '</div></div>';
  }
  function diagram(data) {
    const r = data.selected, s = r || data.selection || {}, route = s.route || state.route || 'USD';
    const mainland = data.mainland || D.mainlandBanks, fxModes = route === 'USD' ? [['manual', '美元原币 · 无需换汇']] :
      [['manual', 'IBKR · 手动换美元'], ['auto', 'IBKR · 买入时自动换美元'], ['bank', '香港银行先换美元']];
    const title = state.plan === 'custom' ? '自选往返方案' : !data.recommended ? '报价需更新 · 参考情景' : state.plan === 'minimum' ? '最低已知费用' : '最佳实践 · 美元直达';
    let html = '<div class="flow-map-head"><div><h2>' + title + '</h2><span>' + esc(s.start?.name || '内地银行卡') + ' → ' + esc(s.bank?.name || '香港同名银行') + ' → IBKR → 内地人民币</span></div><div class="segmented" aria-label="方案选择">' +
      [['recommended', '最佳实践'], ['minimum', '最低已知费用']].map(([id, label]) => action(label, 'preset', 'data-value="' + id + '" aria-pressed="' + (state.plan === id) + '"', state.plan === id ? 'active' : '')).join('') + '</div></div>' +
      '<div class="flow-inlet"><span>费用情景：便利化购汇不适用于境外证券投资；资金来源和出境用途须获准。</span>' + action('适用条件', 'detail', 'data-value="mainland"', 'text-link') + '</div>' +
      (r?.requirements.length ? '<div class="flow-conditions">' + r.requirements.map(esc).join(' · ') + '</div>' : '') + bankChoices(data) +
      '<div class="flow-route" role="group" aria-label="内地人民币到美股再到人民币消费的完整资金图">';
    html += node('start', '01', '内地银行卡人民币', note('<strong>' + esc(s.start?.name || '请选择出发银行') + '</strong>') + note(esc(routes[route])) +
      note(route === 'CNH' ? 'CNY原币汇出 · 到港为CNH' : '现汇卖出：1 ' + route + ' = <b class="num">' + num(r?.startSell, 5) + '</b> CNY') +
      note('汇出主金额：<b class="num">' + num(r?.steps.mainlandForeign) + ' ' + route + '</b>') +
      note(r?.entryAsOf ? '牌价 ' + esc(r.entryAsOf) : ''), M.number(state.budgetCny), 'CNY本金', stepCost(r, ['sender', 'entryFx', 'entryMiddle']), 'entry');
    html += arrow('entry');
    html += node('receiving', '02', '香港同名银行', select('bank', '香港入金银行', bankOptions(D.hkBanks), s.bank?.id) +
      select('mainlandMethod', '内地 → 香港方式', entryMethods({ ...s, route }), r?.mainlandMethod || state.mainlandMethod || 'swift') +
      note('首次汇入费：<b>' + feeText(rowFee(r, 'entryInward')) + '</b>') + note('本人账户 · 同币种收款'),
      r?.steps.hongKong, route, stepCost(r, ['entryInward']), 'bank');
    html += arrow('invest');
    html += node('funding', '03', '券商入金 · IBKR', select('depositMethod', '银行 → 券商方式', depositMethods({ ...s, route }), r?.depositMethod || state.depositMethod || (route === 'USD' ? 'chats' : 'fps')) +
      select('fxMode', '换成美元', fxModes, s.fxMode || 'manual') +
      '<div class="flow-fee-pair"><span>银行转账费<b>' + feeText(rowFee(r, 'depositBank')) + '</b></span><span>IBKR入金费<b>' + feeText(rowFee(r, 'depositBroker')) + '</b></span></div>',
      r?.investUsd, 'USD可投资', stepCost(r, ['depositBank', 'depositBroker', 'depositOther', 'brokerFx', 'brokerSpread']), 'broker');
    html += '<div class="flow-turn"><div><span>买入美股 → 卖出结算 → 预留税款</span>' + action('税款 ' + num(r?.taxCny) + ' CNY ↗', 'detail', 'data-value="tax"', 'text-link') + '</div><svg viewBox="0 0 20 40" aria-hidden="true"><path d="M10 1v32m-5-6 5 6 5-6"/></svg></div>';
    html += node('return', '04', '卖出与同名出金', select('returnBank', '香港回款银行', bankOptions(D.hkBanks), s.returning?.id) +
      note('方式：IBKR USD电汇 → 本人银行账户') + note('卖出余额：<b class="num">' + num(r?.proceeds) + ' USD</b>') +
      note('券商出金费：' + feeText(rowFee(r, 'withdraw')) + '<br>银行收款费：' + feeText(rowFee(r, 'returnInward'))),
      r?.steps.returnUsd, 'USD税后回款', stepCost(r, ['trade', 'withdraw', 'returnInward', 'withdrawMiddle']), 'withdraw');
    html += arrow('repatriate', true);
    html += node('settle', '05', '汇回内地 · 结汇', select('exitBank', '内地收款／结汇银行', bankOptions(mainland), s.exit?.id) +
      select('returnMethod', '香港 → 内地方式', returnMethods(s), r?.returnMethod || state.returnMethod || 'swift') +
      note('现汇买入：1 USD = <b class="num">' + num(r?.exitPrice, 5) + '</b> CNY') + note(r?.exitAsOf ? '牌价 ' + esc(r.exitAsOf) : ''),
      r?.steps.settledCny, 'CNY到账', stepCost(r, ['returnWire', 'returnOther', 'exitFx']), 'spend');
    html += arrow('consume', true);
    html += node('destination', '06', '内地人民币消费', '<div class="flow-final-breakdown"><span>内地本金<b class="num">' + num(M.number(state.budgetCny)) + '</b></span>' +
      '<span>卖出盈亏折合<b class="num">' + num(r ? M.number(state.profitUsd) * r.refs.USD : null) + '</b></span>' +
      '<span>已知全程费用<b class="num">−' + num(r?.costCny) + '</b></span>' +
      (r && Math.abs(r.fxImpactCny) >= .005 ? '<span>汇率折算影响<b class="num">' + (r.fxImpactCny > 0 ? '+' : '') + num(r.fxImpactCny) + '</b></span>' : '') +
      '<span>预留税款<b class="num">−' + num(r?.taxCny) + '</b></span></div>',
      r?.net, r?.complete ? 'CNY可用' : 'CNY可用上限', stepCost(r, ['account', 'extra']), 'cost');
    return html + '</div>';
  }
  function summary(data) {
    const r = data.selected;
    if (!r) return '<div class="flow-message" role="status">' + esc(data.error || '缺少有效报价') + ' ' + action('填入成交报价', 'detail', 'data-value="quotes"') + '</div>';
    return '<div class="flow-totals" aria-live="polite"><div><span>' + (r.complete ? '最终人民币可用' : '最终人民币可用上限') + '</span><strong class="num">' + num(r.net) + '<small>CNY</small></strong></div>' +
      '<div><span>全程已知费用（含点差）</span><strong class="num">' + num(r.costCny) + '<small>CNY · ' + num(r.costCny / r.budgetCny * 100) + '%</small></strong>' +
      (Math.abs(r.fxImpactCny) >= .005 ? '<span>汇率折算影响 ' + (r.fxImpactCny > 0 ? '+' : '') + num(r.fxImpactCny) + ' CNY</span>' : '') + '</div>' +
      '<div><span>税款单列</span><strong class="num">' + num(r.taxCny) + '<small>CNY</small></strong></div>' + action('逐笔费用 ↗', 'detail', 'data-value="cost"') + '</div>' +
      '<div class="flow-caption"><span>' + (r.missing.length ? '未计：' + r.missing.map(esc).join('、') + '。' : '所填费用已全部计入。') + '</span>' +
      action('成交报价与费用', 'detail', 'data-value="quotes"', 'text-link') + '</div>';
  }
  function comparison(data) {
    const key = state.comparison, rows = data.alternatives?.[key] || [], r = data.selected;
    const heads = key === 'start' ? ['出发银行', '1 CNY 换算系数', '同银行换汇往返损耗', '汇出费'] :
      key === 'bank' ? ['香港入金银行', '银行入金费', '首次汇入费', '账户费'] : ['换汇路径', '购汇及换USD价差', '换USD佣金', '汇出费'];
    const tableRows = rows.map(item => {
      const id = key === 'start' ? item.start.id : key === 'bank' ? item.bank.id : item.route;
      const selected = id === (key === 'start' ? r?.start.id || data.selection?.start.id : key === 'bank' ? r?.bank.id || data.selection?.bank.id : r?.route || data.selection?.route);
      const identity = key === 'start' ? item.start.name : key === 'bank' ? item.bank.name : routes[item.route];
      const condition = key === 'start' ? item.start.condition : key === 'bank' ? item.bank.condition : item.route === 'USD' ? '只在内地换USD，不经过港币' : item.route === 'HKD' ? '内地CNY→HKD，再在港换USD' : '内地CNY原币到港，CNH→USD';
      let cells;
      if (key === 'start') {
        const q = item.start.quotes?.[item.route || r?.route || data.selection?.route || 'USD'], route = item.route || r?.route || data.selection?.route || 'USD';
        cells = '<td class="num">' + num(route === 'CNH' ? 1 : q?.sell > 0 ? 1 / q.sell : null, 6) + ' ' + route + '<small>' + esc(q?.asOf || (route === 'CNH' ? '原币汇出，不换汇' : '本行牌价未公开')) + '</small></td>' +
          '<td class="num">' + (route === 'CNH' ? '未换汇' : num(M.fxRoundTripLoss(q?.buy, q?.sell)) + '%') + '</td><td class="num">' + feeText(rowFee(item, 'sender')) + '</td>';
      } else if (key === 'bank') cells = ['depositBank', 'entryInward', 'account'].map(name => '<td class="num">' + feeText(rowFee(item, name)) + '</td>').join('');
      else cells = '<td class="num">' + (item.error ? '—' : num(sumFees(item, ['entryFx', 'brokerSpread']))) + '</td><td class="num">' + feeText(rowFee(item, 'brokerFx')) + '</td><td class="num">' + feeText(rowFee(item, 'sender')) + '</td>';
      const status = item.error || (!item.rankable ? '关键费用／牌价未核齐，未参与推荐' : item.missing?.length ? '未计：' + item.missing.join('、') : '费用已计齐');
      return '<tr class="' + (selected ? 'selected' : '') + '"><td><strong>' + esc(identity) + '</strong><small>' + esc(condition) + '</small></td>' + cells +
        '<td class="num">' + num(item.costCny) + '<small>' + esc(status) + '</small></td><td class="num">' + num(item.net) + (r && item.rankable ? '<small>费用差 ' + (item.costCny >= r.costCny ? '+' : '') + num(item.costCny - r.costCny) + '</small>' : '') + '</td>' +
        '<td>' + action(selected ? '已选' : '选用', 'choose', 'data-field="' + ({ start: 'startBank', bank: 'bank', route: 'route' }[key]) + '" data-value="' + id + '"') + '</td></tr>';
    }).join('');
    return '<div class="flow-comparison-head"><div><h2>银行基准与方案对比</h2><span>只切换这一环，比较全程费用与人民币到账 · 公开牌价基准</span></div><div class="segmented" aria-label="费用对比">' +
      [['start', '出发银行'], ['bank', '香港入金银行'], ['route', '换汇路径']].map(([id, label]) => action(label, 'compare', 'data-value="' + id + '" aria-pressed="' + (key === id) + '"', key === id ? 'active' : '')).join('') + '</div></div>' +
      '<div class="table-wrap"><table class="flow-bank-table"><thead><tr>' + [...heads, '全程已知费用', '最终人民币上限', ''].map(text => '<th>' + text + '</th>').join('') + '</tr></thead><tbody>' + tableRows + '</tbody></table></div>';
  }
  function parameters() {
    const group = (title, fields) => '<h3>' + title + '</h3><div class="flow-parameter-grid">' + fields.map(args => field(...args)).join('') + '</div>';
    return '<div class="flow-adjustments">' +
      group('汇款与账户', [['count', '内地汇出笔数', '笔'], ['usedFreeTransfers', '已用优惠免费笔数', '笔'], ['balanceHkd', '入金银行另留资产', 'HKD'], ['returnBalanceHkd', '回款银行另留资产', 'HKD']]) +
      group('交易与税款', [['tradeFeeUsd', '买卖交易费合计', 'USD', '未报价'], ['taxRate', '境外财产转让所得税率', '%'], ['taxableCny', '已核算人民币应税所得', 'CNY', '按净利润估算'], ['creditCny', '可抵免境外税额', 'CNY'], ['withdrawalIndex', '本月第几次券商出金', '次']]) +
      group('内地 → 香港', [['senderFeeCny', '每笔汇出手续费＋电讯费', 'CNY', '银行公开基准'], ['entryMiddleCny', '每笔内地→香港中转费', 'CNY', '未报价；免收填0'], ['entryInwardHkd', '每笔香港首次汇入费', 'HKD', '所选银行公开基准']]) +
      group('香港 → 券商 → 香港', [['depositHkd', '银行向券商转账费', 'HKD', '所选方式公开基准'], ['depositOtherCny', '入金代理／收款行费', 'CNY', '未报价；免收填0'], ['inwardHkd', '券商出金银行收款费', 'HKD', '所选银行公开基准'], ['intermediaryCny', '券商出金中转费', 'CNY', '未报价；免收填0']]) +
      group('香港 → 内地', [['returnWireHkd', '香港回内地汇出费', 'HKD', '所选方式公开基准'], ['returnExtraCny', '回内地中转／收款费', 'CNY', '未报价；免收填0'], ['monthlyHkd', '入金银行月费', 'HKD', '所选账户标准'], ['returnMonthlyHkd', '回款银行月费', 'HKD', '相同银行不重复扣']]) +
      group('额外成本', [['openingCny', '开户／赴港实际支出', 'CNY'], ['extraCapitalCny', '另占用资产本金', 'CNY'], ['annualGapPct', '占用资产年收益差', '%']]) +
      '<div class="flow-adjust-actions">' + action('成交汇率', 'detail', 'data-value="quotes"') + action('恢复官方报价与费用', 'clear-quotes') + action('重置全部', 'reset') + '</div></div>';
  }
  function view(helpers) {
    H = helpers;
    const data = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '内地银行卡人民币 → 买美股 → 内地人民币消费', action('官方依据', 'detail', 'data-value="sources"')) +
      '<div class="page-money-flow"><div class="flow-controls">' + field('budgetCny', '内地人民币本金', 'CNY') + field('profitUsd', '卖出盈亏（交易费前）', 'USD') + field('months', '账户使用月数', '月') + '</div>' +
      '<section class="card flow-map-card"><div id="flow-live-diagram">' + diagram(data) + '</div><div id="flow-live-summary">' + summary(data) + '</div></section>' +
      '<section class="card" id="flow-live-comparison">' + comparison(data) + '</section><details class="card flow-disclosure"><summary>调整手续费、账户与税款</summary>' + parameters() + '</details></div>';
  }
  function refresh() {
    const data = result();
    for (const [id, renderer] of [['flow-live-diagram', diagram], ['flow-live-summary', summary], ['flow-live-comparison', comparison]]) {
      const element = document.getElementById(id);
      if (element) element.innerHTML = renderer(data);
    }
    // Editable inputs live outside the updated regions, preserving the caret,
    // focus and the open adjustments panel through every recalculation.
  }
  function lockCurrent() {
    const data = result(), s = data.selected || data.selection;
    if (!s) return;
    for (const [key, value] of Object.entries({ startBank: s.start?.id, bank: s.bank?.id, returnBank: s.returning?.id, exitBank: s.exit?.id,
      route: s.route, fxMode: s.fxMode, mainlandMethod: s.mainlandMethod, depositMethod: s.depositMethod, returnMethod: s.returnMethod })) {
      if (!state[key] && value) state[key] = value;
    }
  }
  const quoteKeys = ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'returnMonthlyHkd', 'startSell', 'entryPrice', 'exitPrice', 'usdCny', 'usdHkd', 'usdCnh'];
  function clear(keys) {
    for (const key of keys) { state[key] = ''; document.querySelectorAll('[data-money-field="' + key + '"]').forEach(input => { input.value = ''; }); }
  }
  function choose(key, value) {
    lockCurrent(); const previousRoute = state.route; state[key] = value; state.plan = 'custom';
    if (key === 'startBank') clear(['startSell', 'senderFeeCny', 'entryMiddleCny']);
    if (key === 'bank') clear(['entryInwardHkd', 'depositHkd', 'depositOtherCny', 'monthlyHkd', 'entryPrice']);
    if (key === 'returnBank') clear(['inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd']);
    if (key === 'route') {
      clear(['startSell', 'entryPrice']);
      if (value === 'USD' || previousRoute === 'USD') state.fxMode = 'manual';
      const methods = depositMethods({ route: value, fxMode: state.fxMode });
      if (!methods.some(([id]) => id === state.depositMethod)) state.depositMethod = methods[0][0];
    }
    if (key === 'fxMode') { clear(['entryPrice', 'depositHkd', 'depositOtherCny']); state.depositMethod = value === 'bank' || state.route === 'USD' ? 'chats' : 'fps'; }
    if (key === 'depositMethod') clear(['depositHkd', 'depositOtherCny']);
    if (key === 'mainlandMethod') clear(['senderFeeCny', 'entryMiddleCny']);
    if (key === 'exitBank') clear(['exitPrice', 'returnExtraCny']);
    if (key === 'returnMethod') clear(['returnWireHkd', 'returnExtraCny']);
    const start = D.mainlandBanks.find(bank => bank.id === state.startBank), bank = D.hkBanks.find(bank => bank.id === state.bank),
      returning = D.hkBanks.find(bank => bank.id === state.returnBank), exit = D.mainlandBanks.find(bank => bank.id === state.exitBank);
    if (['startBank', 'bank'].includes(key)) state.mainlandMethod = ['hang', 'hsbc', 'sc'].includes(start?.id) && start.group === bank?.group ? 'linked' : 'swift';
    if (['startBank', 'bank', 'route'].includes(key) && !entryMethods({ start, bank, route: state.route }).some(([id]) => id === state.mainlandMethod)) state.mainlandMethod = 'swift';
    if (['exitBank', 'returnBank'].includes(key)) state.returnMethod = returnMethods({ returning, exit }).find(([id]) => id !== 'swift')?.[0] || 'swift';
    save(); refresh();
  }
  function detail(key) {
    const data = result(), r = data.selected, s = r || data.selection || {};
    const descriptions = {
      mainland: ['适用条件', '从内地银行卡人民币开始计算完整往返费用；金额测算不等于出境许可。大陆个人便利化购汇不能用于境外证券投资，同名香港账户不改变用途。跨境人民币也须符合真实用途、资本项目和银行准入规则。资金来源、获准渠道和券商接受身份必须先确认；银行优惠不代表证券投资出境资格。', ['safe', 'pbcRmb', 'scCnTerms', 'csrc']],
      entry: ['内地人民币出发', '汇出手续费、电讯费和全额到账附加费先从人民币预算内扣除，再按出发银行现汇卖出价购汇。买美股可以直接换USD，不必经过港币。人民币原币到港后为CNH，此步没有换汇点差。CNY/CNH及不同时点、银行报价的折算影响单列，正值不代表银行返还手续费。普通SWIFT中转费无统一值；农行USD全额到账附加25美元按每笔计入。指定同名优惠须匹配银行集团和账户条件。', s.start?.sources || ['bocFx', 'abc']],
      bank: ['香港同名银行', '入金银行与回款银行可以不同，月费分别算；相同银行不重复扣。最佳实践优先美元直达、无验资门槛和月费，不依赖即将结束的优惠。最低已知费用包含有条件账户，条件在图中列出。汇丰One新开非香港身份证账户不足1万港元按100港元/月；渣打中国同名优惠须优先理财及指定渠道。', ['hangOpen', 'hsbcHk', 'sc', 'scTier', 'hang', 'hsbcGlobal']],
      broker: ['入金方式与换美元', '先在IBKR建立当次入金通知，按收款指示核对币种、银行所在地与本人账户。USD本地CHATS；HKD/CNH可用FPS或eDDA（须授权），两者均不支持USD。SWIFT另外计算电汇费。IBKR现金入金费0不代表银行、代理及收款行都免费。渣打USD本地RTGS公开费为22美元。手动换汇0.002%、最低2美元；自动换汇加价0.03%，不叠加手动佣金。银行换USD仅用该行实际报价，目前公开数据覆盖中银香港，其他行需账户询价。', ['ibFunding', 'ibDeposits', 'ibEdda', 'ibFx', 'scHk', 'bochkUsdFx']],
      withdraw: ['卖出与券商出金', '卖出盈亏为交易费前USD；交易费另扣。税款预留后USD电汇返回香港本人银行账户。IBKR每月前两次出金免费，之后USD电汇10美元；中转及银行收款费另计。中银香港的内地中行同名优惠不能套在券商汇入上。卖出结算、入金等待期及提款余额按实际账户规则；券商不是纯汇款换汇工具。', ['ibFees', 'ibFunding', 'bochk']],
      spend: ['回内地人民币消费', 'USD汇回本人内地外汇账户，用收款银行现汇买入价结汇为CNY，无需再经HKD，也不计算香港卡签账费。中银快汇网上至内地中行汇出费0，普通SWIFT汇出65港元；中转、收款行费用另核。两地同名回款须匹配银行集团。保留资金来源、交易与税务凭证并满足汇回、结汇审核。', ['bochk', 'remit', 'safe', 'hang', 'hsbcGlobal']],
      tax: ['税款按利润单列', '大陆税收居民境外财产转让所得通常20%，按人民币收入减成本及允许费用核算，不是对本金或整笔提现征税；股息另行核算。默认仅以正的净交易利润×USD/CNY参照估算，假定买卖汇率相同。有已核算人民币应税所得时优先使用，境外税抵免须有依据。不能代替真实人民币成本及汇率损益核算。', ['tax']],
      sources: ['官方报价与收费依据', '自动更新7家内地银行及中银香港牌价，各行时间分别保留。出发银行覆盖10种账户／渠道，香港银行5家。兴业公开接口无报价，恒生中国及渣打中国需账户询价；工行与交行现行个人汇出完整费用未核齐，不参与自动推荐。超过3天的报价不参与推荐。最低是已收录账户、渠道及已知费用中的低损耗方案，未报价中转费可能改变排序；券商参考价不是可执行价。每笔手续费只扣一次。人民币原币汇出没有换汇费用，CNY/CNH及不同银行、时点的参考折算影响单列；最终人民币＋已知费用＋税款＝人民币本金＋USD盈亏折合＋汇率折算影响。', Object.keys(D.sources)]
    };
    let title, content, keys;
    if (key === 'cost') {
      title = '全程逐笔费用与汇率影响'; keys = ['ibFees', 'tax'];
      content = r ? '<div class="flow-cost-detail">' + r.rows.map(row => '<div><span>' + esc(row.label) + '</span><b class="num">' + feeText(row.cny) + '</b></div>' +
        (Math.abs(row.fxImpactCny ?? 0) >= .005 ? '<div><span>' + esc(row.label) + ' · 汇率折算影响</span><b class="num">' + (row.fxImpactCny > 0 ? '+' : '') + num(row.fxImpactCny) + ' CNY</b></div>' : '')).join('') +
        '<div><span>全程已知费用</span><b class="num">' + num(r.costCny) + ' CNY</b></div><div><span>汇率折算影响（独立列示）</span><b class="num">' + (r.fxImpactCny > 0 ? '+' : '') + num(r.fxImpactCny) + ' CNY</b></div>' +
        '<div><span>税款（独立列示）</span><b class="num">' + num(r.taxCny) + ' CNY</b></div></div>' : '<p>' + esc(data.error) + '</p>';
    } else if (key === 'quotes') {
      title = '本方案成交报价与费用'; keys = ['bocFx', 'cmbFx', 'icbcFx', 'ccbFx', 'abcFx', 'commFx', 'hsbcFx', 'bochkUsdFx'];
      content = '<p>留空读取官方基准；未知费用留空，确认免收才填0。报价及银行优惠绑定当前所选银行。</p><div class="flow-parameter-grid">' +
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
    if (act === 'preset') {
      for (const key of ['startBank', 'bank', 'returnBank', 'exitBank', 'route', 'fxMode', 'mainlandMethod', 'depositMethod', 'returnMethod']) state[key] = '';
      clear(quoteKeys); state.plan = value; save(); refresh(); return;
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
    if (el.dataset.moneySelect) { choose(el.dataset.moneySelect, el.value); return true; }
    if (el.dataset.moneyField) { clearTimeout(timer); refresh(); return true; }
    return false;
  }
  window.ChanghengMoneyFlow = { view, handleAction, handleInput, handleChange };
}());
