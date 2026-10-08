(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel;
  const STORE = 'changheng.money-flow.v1';
  const defaults = {
    origin: 'mainland', purpose: 'consume', mainlandBank: 'boc', hkBank: 'za', currency: 'HKD',
    amount: '100000', count: '1', months: '12', usedFreeTransfers: '0', balanceHkd: '0',
    enabled: [], intermediaryCny: '', senderFeeCny: '', monthlyHkd: '',
    usdCny: '6.70715', usdHkd: '7.85', usdCnh: '6.70',
    brokerApproved: false, fxMode: 'manual', entryPrice: '7.85', spend: 'USD', exitPrice: '',
    profitUsd: '0', taxableCny: '0', taxRate: '20', creditCny: '0', withdrawalIndex: '1',
    depositHkd: '', inwardHkd: '', returnWireHkd: '', returnExtraCny: '',
    extraCapitalCny: '0', annualGapPct: '0', openingCny: '0',
    consumeMethod: 'local', cardPct: '', cardBankHkdPerUsd: '', cardNetworkHkdPerUsd: '', overseasProcessed: false,
    quotes: {}, compareTab: 'mainland', origins: {}, step: null
  };
  const initialUsd = window.MONEY_FLOW_QUOTES?.banks.boc?.quotes.USD;
  if (initialUsd) defaults.usdCny = String(Number(((initialUsd.buy + initialUsd.sell) / 2).toFixed(6)));
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  let state = { ...defaults, ...stored, quotes: stored.quotes || {}, origins: stored.origins || {}, enabled: Array.isArray(stored.enabled) ? stored.enabled : [] };
  let H, timer;
  const n = M.number;
  const esc = value => H.esc(value);
  const num = (value, digits = 2) => H.money(value, digits);
  const asDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const quoteData = () => window.MONEY_FLOW_QUOTES || { banks: {} };
  const button = (label, act, value, active = false, extra = '') => H.action(esc(label), 'money-flow-' + act, 'btn' + (active ? ' active' : ''), 'data-value="' + esc(value) + '"' + extra);
  const source = (key, label) => {
    const row = D.sources[key];
    return row ? '<a class="source-link" href="' + esc(row.url) + '" target="_blank" rel="noopener noreferrer">' + esc(label || row.name) + ' ↗</a>' : '';
  };
  const sourceList = keys => keys.map(key => source(key)).join('');
  function save() { try { localStorage.setItem(STORE, JSON.stringify({ ...state, step: null })); } catch (_) {} }
  function field(key, label, unit = '', extra = '') {
    return '<label class="flow-field"><span>' + label + '</span><div class="flow-input"><input inputmode="decimal" type="text" data-money-field="' + key + '" value="' + esc(state[key]) + '" aria-label="' + esc(label.replace(/<[^>]*>/g, '')) + '" ' + extra + '>' + (unit ? '<span>' + unit + '</span>' : '') + '</div></label>';
  }
  function choices(label, key, rows) {
    return '<div class="flow-choice"><span>' + label + '</span><div class="segmented" aria-label="' + label + '">' + rows.map(([value, text]) => H.action(esc(text), 'money-flow-set', state[key] === value ? 'active' : '', 'data-field="' + key + '" data-value="' + value + '" aria-pressed="' + (state[key] === value) + '"')).join('') + '</div></div>';
  }
  function bank(id) { return D.mainlandBanks.find(row => row.id === id) || D.mainlandBanks[0]; }
  function hkBank(id = state.hkBank) { return D.hkBanks.find(row => row.id === id) || D.hkBanks[0]; }
  function quote(id = state.mainlandBank) {
    const key = id + ':' + state.currency;
    if (Object.hasOwn(state.quotes, key)) return n(state.quotes[key]) == null ? null : n(state.quotes[key]) / 100;
    return quoteData().banks[id]?.quotes[state.currency]?.sell ?? null;
  }
  function quoteText(id) {
    const row = quoteData().banks[id]?.quotes[state.currency];
    if (Object.hasOwn(state.quotes, id + ':' + state.currency)) return '自行录入成交价';
    return row ? '参考牌价 · ' + row.asOf : '填入App最终报价';
  }
  function config() {
    return { ...state, amount: n(state.amount), count: n(state.count), months: n(state.months),
      usdCny: n(state.usdCny), usdHkd: n(state.usdHkd), usdCnh: n(state.usdCnh),
      date: asDate(), sell: quote(), purpose: state.origin === 'mainland' ? state.purpose : 'invest' };
  }
  function result(id = state.mainlandBank) {
    const c = config();
    for (const key of ['extraCapitalCny', 'annualGapPct', 'openingCny']) if (n(state[key]) == null || n(state[key]) < 0) return { error: '额外资产、年收益差与开户支出须填非负数。' };
    const r = state.origin === 'mainland' ? M.mainlandTransfer({ ...c, sell: quote(id) }, bank(id), hkBank()) : M.offshoreTransfer(c, hkBank(), D.broker);
    if (!r.error) {
      r.consumer = r.net == null ? { net: null, cost: null, missing: [] } : M.consumption({ amount: r.net, currency: r.currency, method: r.currency === 'USD' ? 'card' : state.consumeMethod, cardPct: state.cardPct, bankHkdPerUsd: state.cardBankHkdPerUsd, networkHkdPerUsd: state.cardNetworkHkdPerUsd, overseasProcessed: state.overseasProcessed }, hkBank());
      if (r.consumer.error) return { error: r.consumer.error };
      r.consumerCostCny = r.consumer.cost == null ? null : r.consumer.cost * r.refs[r.currency];
      r.allMissing = [...new Set([...r.missing, ...r.consumer.missing])];
    }
    return r;
  }
  const icons = {
    mainland: '<path d="M3 9h18M5 9v10m5-10v10m4-10v10m5-10v10M3 21h18M2 7l10-5 10 5"/>',
    exchange: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    bank: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18m-13 6h3m4 0h2"/>',
    broker: '<path d="M4 3v17h17M7 14l4-4 4 3 6-9"/>',
    tax: '<path d="m12 2 8 4v7c0 5-8 9-8 9s-8-4-8-9V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
    spend: '<path d="M4 7h16l-2 10H6L4 7Zm0 0L3 3H1"/><circle cx="8" cy="21" r="1"/><circle cx="17" cy="21" r="1"/>'
  };
  const icon = key => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + icons[key] + '</svg>';
  function node(key, no, title, subtitle, value, currency, cls = '') {
    return '<button type="button" class="flow-node ' + cls + '" data-action="money-flow-detail" data-value="' + key + '"><span class="flow-node-top"><span>' + no + '</span>' + icon(key) + '</span><strong>' + esc(title) + '</strong><span class="flow-node-sub">' + esc(subtitle) + '</span><span class="flow-node-amount num">' + (value == null ? '—' : num(value)) + '<small>' + currency + '</small></span></button>';
  }
  function arrow(label, fee, cls = '') {
    return '<div class="flow-arrow ' + cls + '"><span>' + esc(label) + '</span><svg viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><path d="M1 8h55m-7-6 7 6-7 6"/></svg><small>' + esc(fee) + '</small></div>';
  }
  function diagram(r) {
    const mainland = state.origin === 'mainland';
    const allowed = M.legalPath(state.origin, mainland ? state.purpose : 'invest', state.brokerApproved);
    const title = mainland ? '人民币出境，用在真实用途上' : '合法境外资金，从投资到账户消费';
    let flow;
    if (mainland) {
      const blocked = state.purpose === 'invest';
      flow = node('mainland', '01', '大陆银行', '人民币现汇购汇', n(state.amount), 'CNY') + arrow('购汇', '卖出价含换汇价差') +
        node('exchange', '02', '换汇与汇出', bank(state.mainlandBank).name, r.converted, state.currency) + arrow(blocked ? '用途不支持' : '同名汇款', blocked ? '境外证券投资' : '汇出费＋中转费', blocked ? 'blocked' : '') +
        node('bank', '03', '香港同名账户', hkBank().name, r.net, state.currency) + arrow('真实境外用途', '消费 · 留学 · 生活') +
        node('spend', '04', '可消费金额', state.currency === 'HKD' ? state.consumeMethod === 'card' ? '港元卡片签账' : '港元本地消费' : hkBank().id === 'za' ? '先换港元，再以Visa消费USD' : '足额美元余额直接扣账', r.consumer?.net, state.currency, 'destination');
    } else {
      flow = node('bank', '01', '香港同名账户', hkBank().name, n(state.amount), state.currency) + arrow(state.fxMode === 'bank' && state.currency !== 'USD' ? '先换USD再入金' : '本地同币种入金', '以券商收款指示为准') +
        node('broker', '02', '券商投资', state.currency === 'USD' ? '美元入金，无需换汇' : (state.fxMode === 'bank' ? '先在银行换美元' : state.fxMode === 'auto' ? '买证券时自动换汇' : '券商手动换美元'), r.investUsd, 'USD') + arrow('卖出并结算', '现金可提取后出金') +
        node('tax', '03', '预留税款', '按人民币应税所得估算', r.taxCny, 'CNY') + arrow('同名出金', '券商费＋银行费') +
        node('bank', '04', '返回香港银行', '换汇与账户月费另计', r.bankUsd, 'USD') + arrow(state.spend === 'CNY' ? '汇回并结汇' : state.spend === 'USD' ? '美元消费' : '换成港元', state.spend === 'CNY' ? '银行审核资金来源' : r.consumer?.net == null ? '消费报价待补' : '已计所选消费费用') +
        node('spend', '05', '可消费金额', { USD: hkBank().id === 'za' ? '先换港元，再以Visa消费USD' : '对应美元余额直接扣账', HKD: '港元本地消费', CNY: '大陆人民币消费' }[state.spend], r.consumer?.net, state.spend, 'destination');
    }
    return '<section class="card flow-map-card"><div class="card-head"><div><h2>' + title + '</h2><p>点选节点，查看该步所需材料与费用。</p></div><span class="flow-legend"><i></i>' + (r.error ? '条件未满足' : r.allMissing?.length ? '未报价费用未扣除' : '按已填报价测算') + '</span></div><div class="flow-map ' + (mainland ? '' : 'flow-map-invest') + '" role="group" aria-label="资金流转图">' + flow + '</div>' +
      '<div class="flow-boundary ' + (!allowed.allowed ? 'warning' : '') + '"><span class="flow-boundary-symbol">' + (!allowed.allowed || mainland ? '!' : '✓') + '</span><span>' + esc(mainland ? '大陆5万美元便利化购汇额度不能用于境外证券投资；转入同名香港账户也不改变用途限制。' : allowed.reason) + '</span>' + source(mainland ? 'safe' : 'csrc', '规定') + '</div>' +
      (mainland ? '<div class="flow-alternative"><span>境外证券投资</span><span class="flow-stop">大陆购汇 <b>×</b> 香港券商</span><span>另需符合规定的投资渠道，或已有合法境外资金及可使用的券商账户。</span></div>' : '') + '</section>';
  }
  function setup() {
    const mainland = state.origin === 'mainland';
    return '<section class="card flow-setup"><div class="flow-origin-tabs">' + choices('资金起点', 'origin', [['mainland', '大陆人民币'], ['offshore', '已有合法境外资金']]) +
      '<span class="flow-research-date">收费核对 ' + D.verifiedAt + '</span></div>' +
      '<div class="flow-setup-grid">' + field('amount', mainland ? '本次总预算' : '本次境外资金', mainland ? 'CNY' : state.currency) +
      (mainland ? choices('分几笔汇出', 'count', [['1', '一次'], ['4', '分4笔'], ['12', '分12笔']]) : choices('当前币种', 'currency', [['USD', '美元'], ['HKD', '港元'], ['CNH', '离岸人民币']])) +
      (mainland ? choices('购汇币种', 'currency', [['HKD', '港元'], ['USD', '美元']]) : choices('消费币种', 'spend', [['USD', '美元'], ['HKD', '港元'], ['CNY', '大陆人民币']])) + '</div>' +
      '<div class="flow-bank-choice"><span>' + (mainland ? '香港收款账户' : '香港出入金账户') + '</span><div class="flow-bank-pills">' + D.hkBanks.map(row => H.action(esc(row.name), 'money-flow-set', 'btn' + (state.hkBank === row.id ? ' active' : ''), 'data-field="hkBank" data-value="' + row.id + '" aria-pressed="' + (state.hkBank === row.id) + '"')).join('') + '</div></div>' +
      (!mainland ? '<label class="flow-check"><input type="checkbox" data-money-check="brokerApproved"' + (state.brokerApproved ? ' checked' : '') + '><span>已有获准使用的券商账户，资金来源合法且可投资</span></label>' : '') + '</section>';
  }
  function versions() {
    const mainland = state.origin === 'mainland';
    return '<div class="flow-versions"><article class="flow-version"><div class="flow-version-label"><span>01</span>最低损耗版</div><h2>' + (mainland ? '减掉固定费用，只换一次币。' : '美元入金，美元出金，美元消费。') + '</h2><p>' + (mainland ? '已有两地同名账户，优先比较恒生跨域、渣打同名速汇及汇丰环球转账；无高资产账户，可比较兴业寰宇人生当前优惠。' : '已有合法美元和合资格账户时，同币种本地入金免去入金换汇；卖出后提USD到香港银行，保留美元余额用于美元消费。') + '</p><div class="flow-version-route">' + (mainland ? 'CNY <span>→ 一次购汇 →</span> HKD / USD' : 'USD <span>→ 券商 → 同名银行 →</span> USD') + '</div><div class="flow-version-condition">' + (mainland ? '指定账户与优惠资格必须成立；免费汇款仍可能有换汇价差。' : '汇丰、恒生、中银、渣打的指定多币种扣账卡，须启用功能且有足额USD余额；普通卡不能套用。') + '</div>' + sourceList(mainland ? ['cib', 'hang', 'sc', 'hsbcGlobal'] : ['ibFees', 'hsbcCard', 'hangCard', 'bochkCard', 'scCard']) + '</article>' +
      '<article class="flow-version"><div class="flow-version-label"><span>02</span>最佳实践版</div><h2>' + (mainland ? '已有银行优先，小额验证后再汇。' : '同名账户闭合，投资与生活费分开。') + '</h2><p>' + (mainland ? '从零开始可比较兴业寰宇人生优惠＋恒生优进：无需为免汇款费专门维持50万元；港元生活费也可考虑ZA。已有账户先比较App成交价与实际到账。' : '按券商当次收款指示从同名银行入金。恒生优进或中银普通个人账户可减少月费负担；预留税款与生活费，结算后集中出金。') + '</p><div class="flow-version-route">' + (mainland ? '真实用途 <span>→ 实时报价 →</span> 同名收款' : '同名入金 <span>→ 结算＋税款 →</span> 同名出金') + '</div><div class="flow-version-condition">' + (mainland ? '开户需真实证件、地址及资金来源；赴港交通、月费和保留资产另计。' : '部分远程开户方法需同名银行转入≥1万港元；这是身份验证存款，不是手续费，也不是所有券商的统一门槛。') + '</div>' + sourceList(mainland ? ['safe', 'zaVisit', 'hangOpen'] : ['ibFunding', 'sfc']) + '</article></div>';
  }
  function resultPanel(r) {
    if (r.error) return '<aside class="flow-result"><span class="eyebrow">本次测算</span><h2>先满足这项条件</h2><p class="flow-result-error">' + esc(r.error) + '</p><span class="muted small">可继续查看流程及各行收费。</span></aside>';
    const extra = M.opportunityCost(n(state.extraCapitalCny), n(state.annualGapPct), n(state.months));
    const opening = n(state.openingCny);
    const budgetCny = state.origin === 'mainland' ? n(state.amount) : n(state.amount) * r.refs[state.currency];
    const total = r.costCny == null ? null : r.costCny + (r.consumerCostCny || 0) + extra + opening;
    return '<aside class="flow-result" aria-live="polite"><span class="eyebrow">本次测算</span><h2>' + (r.complete ? state.origin === 'mainland' ? '香港账户可用余额' : '税款预留后银行余额' : '已知费用下的余额上限') + '</h2><div class="flow-result-value num">' + num(r.net) + '<small>' + r.currency + '</small></div>' +
      '<dl class="flow-result-totals"><div><dt>已知流转成本</dt><dd class="num">' + num(r.costCny) + ' <small>CNY</small></dd></div><div><dt>其中显式手续费</dt><dd class="num">' + num(r.explicitCny) + ' <small>CNY</small></dd></div>' +
      (state.origin !== 'mainland' ? '<div><dt>预留税款（独立列示）</dt><dd class="num">' + num(r.taxCny) + ' <small>CNY</small></dd></div>' : '') + '</dl>' +
      '<div class="flow-consumer-total"><span>扣消费费后可购买</span><strong class="num">' + num(r.consumer.net) + ' ' + r.currency + '</strong></div>' +
      (r.allMissing.length ? '<div class="flow-missing"><b>还缺：' + r.allMissing.map(esc).join('、') + '</b><span>未报价费用未扣除，不能据此认定该路线最便宜。</span></div>' : '') +
      '<div class="flow-cost-bars">' + r.rows.map(row => '<div><span>' + esc(row.label) + '</span><b class="num">' + (row.cny == null ? '待填费用' : num(row.cny)) + '</b></div>').join('') + '</div>' +
      '<div class="flow-cost-bars"><div><span>消费签账费与换汇损耗</span><b class="num">' + (r.consumerCostCny == null ? '待填费用' : num(r.consumerCostCny)) + '</b></div></div>' +
      '<div class="flow-extra-total"><span>额外开户支出＋资产机会成本</span><strong class="num">' + num(opening + extra) + ' CNY</strong><small>全部已知损耗：' + num(total) + ' CNY · ' + (total != null && budgetCny > 0 ? num(total / budgetCny * 100) + '%' : '—') + '</small></div>' +
      '<p class="flow-result-foot">按同一组参照汇率折算CNY；汇率差额可为负值。保留资产本金不作为损耗扣除。</p></aside>';
  }
  function mainlandCompare() {
    const c = config();
    return '<div class="flow-compare-main"><div class="flow-table-intro"><span>购汇价：每100 ' + state.currency + ' 需多少CNY</span><span>金额已包含汇出手续费</span></div><div class="table-wrap"><table class="flow-rate-table"><thead><tr><th>大陆汇出渠道</th><th>购汇价 / CNY</th><th>汇出费合计 / CNY</th><th>使用条件</th><th></th></tr></thead><tbody>' + D.mainlandBanks.map(row => {
      const q = quote(row.id), count = n(state.count) || 1;
      let total = 0, valid = true;
      for (let i = 0; i < count; i++) {
        const calculation = M.remitPrincipal((n(state.amount) || 0) / count, row, i + 1 + (n(state.usedFreeTransfers) || 0), c.date, row.id === state.mainlandBank ? n(state.senderFeeCny) : null);
        if (!calculation) valid = false; else total += calculation.fee;
      }
      const active = row.id === state.mainlandBank, enabled = M.eligible(row, state.enabled);
      return '<tr class="' + (active ? 'flow-selected' : '') + '"><td><strong>' + esc(row.name) + '</strong><small>' + esc(row.feeText) + '</small>' + source(row.sources[0], '收费依据') + '</td><td><div class="flow-quote-input"><input type="text" inputmode="decimal" data-money-quote="' + row.id + '" aria-label="' + esc(row.name + '每100' + state.currency + '购汇价') + '" value="' + (q == null ? '' : esc(Number((q * 100).toFixed(5)))) + '" placeholder="填App报价"></div><small>' + esc(quoteText(row.id)) + '</small>' + (row.quoteSource ? source(row.quoteSource, '查牌价') : '') + '</td><td class="num"><strong>' + (valid ? num(total) : '优惠已到期') + '</strong><small>' + count + '笔，未含中转/收款费</small></td><td class="flow-condition">' + esc(row.condition) + (row.required ? '<label class="flow-check"><input type="checkbox" data-money-eligible="' + row.required + '"' + (enabled ? ' checked' : '') + '><span>已符合上述条件</span></label>' : '') + '</td><td>' + button(active ? '已选' : '选用', 'bank', row.id, active, enabled ? '' : ' disabled') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
      '<div class="flow-parameters">' + field('intermediaryCny', '中转行费用 / 每笔', 'CNY', 'placeholder="未知；确认免收填0"') + field('senderFeeCny', '覆盖所选渠道汇出费 / 每笔', 'CNY', 'placeholder="留空采用公开收费"') + field('usedFreeTransfers', '优惠期已用免费笔数', '笔') + '</div><p class="flow-short-note">中国银行、招商银行为公开渠道标准价；实际App优惠可覆盖。兴业前30笔免电讯费不含中转行费。SHA/OUR分配费用，并不自动减少总费用。</p></div>';
  }
  function offshoreCompare() {
    const c = config(), currency = state.currency, price = n(state.entryPrice);
    const manual = M.brokerFx(n(state.amount), currency, price, 'manual', D.broker);
    const auto = M.brokerFx(n(state.amount), currency, price, 'auto', D.broker);
    const bankMode = state.fxMode === 'bank';
    return '<div class="flow-compare-main"><div class="flow-fx-methods">' + [['manual', '券商手动换汇', '0.002%，最低US$2', manual], ['auto', '买入时自动换汇', '汇率通常加价0.03%，无独立佣金', auto], ['bank', '银行先换美元', '按银行App成交价，同币种入券商', null]].map(([value, title, desc, estimate]) =>
      '<button class="flow-method ' + (state.fxMode === value ? 'active' : '') + '" type="button" data-action="money-flow-set" data-field="fxMode" data-value="' + value + '" aria-pressed="' + (state.fxMode === value) + '"><strong>' + title + '</strong><span>' + desc + '</span><b class="num">' + (currency === 'USD' ? '无需换汇' : estimate ? '可得 ' + num(estimate.usd) + ' USD' : '填银行报价') + '</b></button>').join('') + '</div>' +
      (currency !== 'USD' ? '<div class="flow-parameters">' + field('entryPrice', (bankMode ? '银行成交价' : '券商换汇基准价') + '：1 USD需多少' + currency, currency) + '</div><p class="flow-short-note">默认7.85仅为HKD情景参照；请替换为成交价。手动模式仍有市场买卖价差；自动模式只适用于合资格账户的证券买入。</p>' : '<p class="flow-short-note">已有USD不应为了入金先转HKD再买回USD。券商基准币种设成USD也不会自动替你换汇。</p>') +
      '<div class="flow-parameters">' + field('depositHkd', '本地入金费用 / 本次', 'HKD', 'placeholder="留空用银行公开价"') + field('withdrawalIndex', '当月第几次出金', '次') + field('inwardHkd', '券商出金后银行汇入费', 'HKD', 'placeholder="留空用银行公开价"') + field('intermediaryCny', '出金中转行费 / 本次', 'CNY', 'placeholder="未知；确认免收填0"') + '</div>' +
      '<div class="flow-subsection"><h3>卖出与预留税款</h3><div class="flow-parameters">' + field('profitUsd', '已实现卖出盈亏', 'USD') + field('taxableCny', '已核算应税所得', 'CNY') + field('taxRate', '应税所得税率', '%') + field('creditCny', '可抵免境外已纳税额', 'CNY') + '</div><p class="flow-short-note">卖出盈亏填扣交易费后的金额；填0仅比较流转费用。应税所得须按人民币成本、处置收入等核算，不直接用USD盈亏代替。税款不是对整笔提现征收。</p></div>' +
      (state.spend !== 'USD' ? '<div class="flow-subsection"><h3>' + (state.spend === 'HKD' ? '换成港元消费' : '汇回大陆并结汇') + '</h3><div class="flow-parameters">' + field('exitPrice', '1 USD最终可换多少' + state.spend, state.spend, 'placeholder="填银行买入成交价"') + (state.spend === 'CNY' ? field('returnWireHkd', '香港汇出费', 'HKD', 'placeholder="留空用公开收费"') + field('returnExtraCny', '回大陆中转费＋收款费', 'CNY', 'placeholder="未知；确认免收填0"') : '') + '</div></div>' : '') +
      '<div class="flow-compare-sources">' + sourceList(['ibFx', 'ibFees', 'tax']) + '</div></div>';
  }
  function comparison(r) {
    return '<section class="card flow-comparison"><div class="card-head"><div><h2>' + (state.origin === 'mainland' ? '大陆购汇与汇出费用' : '券商入金、出金与税款') + '</h2><p>' + (state.origin === 'mainland' ? '同一预算、同一香港收款账户，逐项比较。' : 'IBKR直接客户作费用示例；实际账户实体及收款指示优先。') + '</p></div>' + (state.origin === 'mainland' ? button('恢复参考牌价', 'reset-quotes', '') : '') + '</div><div class="flow-compare-grid">' + (state.origin === 'mainland' ? mainlandCompare() : offshoreCompare()) + '<div id="flow-live-result">' + resultPanel(r) + '</div></div></section>';
  }
  function consumerOutput(r) {
    if (r.error) return '<span class="muted">满足上方测算条件后显示消费金额。</span>';
    return '<div class="flow-consumer-preview"><div><span>消费前余额</span><strong class="num">' + num(r.net) + ' ' + r.currency + '</strong></div><span aria-hidden="true">→</span><div><span>可购买的商品金额' + (r.complete ? '' : '上限') + '</span><strong class="num">' + num(r.consumer.net) + ' ' + r.currency + '</strong></div><div><span>消费额外损耗</span><strong class="num">' + num(r.consumerCostCny) + ' CNY</strong></div></div>' + (r.consumer.missing.length ? '<p class="flow-short-note">还缺：' + r.consumer.missing.map(esc).join('、') + '</p>' : '');
  }
  function consumerControls(r) {
    const currency = state.origin === 'mainland' ? state.currency : state.spend;
    const card = currency === 'USD' || (currency === 'HKD' && state.consumeMethod === 'card');
    return '<section class="card flow-consumption"><div class="card-head"><div><h2>最后一步：消费</h2><p>用所选银行余额支付，单独算签账费与额外换汇。</p></div>' + button('消费与提款', 'detail', 'spend') + '</div>' +
      (currency === 'HKD' ? choices('港元支付方式', 'consumeMethod', [['local', '本地支付 / FPS'], ['card', '银行卡消费']]) : '') +
      (card ? '<div class="flow-parameters">' + field('cardPct', '覆盖卡片签账费率', '%', 'placeholder="留空用指定扣账卡收费"') + (currency === 'USD' && hkBank().id === 'za' ? field('cardBankHkdPerUsd', '银行：1 USD可换多少HKD', 'HKD', 'placeholder="填USD换HKD成交价"') + field('cardNetworkHkdPerUsd', 'Visa：1 USD消费扣多少HKD', 'HKD', 'placeholder="填Visa折算价，不含1.95%"') : '') + '</div>' : '') +
      (currency === 'HKD' && card && hkBank().id === 'za' ? '<label class="flow-check"><input type="checkbox" data-money-check="overseasProcessed"' + (state.overseasProcessed ? ' checked' : '') + '><span>交易由香港以外商户处理（ZA另收1.95%）</span></label>' : '') +
      '<div id="flow-live-consumer">' + consumerOutput(r) + '</div><p class="flow-short-note">' + (currency === 'USD' ? hkBank().id === 'za' ? 'ZA卡按港元结算：USD先换HKD，Visa再折算USD签账，最后计1.95%。' : '按该行多币种Mastercard扣账卡、USD直接扣账已启用且余额足额测算。' : currency === 'CNY' ? '汇回大陆并结汇后，以到账人民币本地支付。' : '本地港元支付不换汇。') + ' 现金提款、商户DCC及奖励回赠不在本次签账测算中。</p></section>';
  }
  function hkCompare() {
    return '<section class="card"><div class="card-head"><div><h2>香港账户与消费成本</h2><p>本地入金用本地渠道；USD不是转数快的结算币种。</p></div></div><div class="table-wrap"><table class="flow-hk-table"><thead><tr><th>香港银行</th><th>一般跨境汇入</th><th>网上本地转账</th><th>账户成本 / 门槛</th><th>指定扣账卡消费</th><th>USD汇回大陆</th></tr></thead><tbody>' + D.hkBanks.map(row => '<tr><td><strong>' + esc(row.name) + '</strong>' + source(row.sources[0], '收费依据') + (row.directUsdCard ? source(row.sources.find(key => key.toLowerCase().includes('card')), '卡片依据') : '') + '</td><td>' + (row.inwardHkd === 0 ? '免费¹' : '60 HKD / 笔²') + '</td><td>' + (row.localUsd === 0 ? 'HKD/CNH：FPS免费<br>USD：网上CHATS免费' : 'HKD/CNH：网上非RTGS免费<br>USD：RTGS标准价22 USD<br><span class="muted">App另有豁免可覆盖</span>') + '</td><td>' + (row.id === 'hsbc' ? '新开非香港身份证One<br>另有≥10,000 HKD资产可免月费<br><span class="muted">否则100 HKD / 月</span>' : '所列个人账户免管理费') + '</td><td>' + (row.directUsdCard ? '对应币种余额足额：直接扣账<br>外币交易费免<br><span class="muted">须启用相应多币种扣账功能</span>' : '外币签账及海外处理HKD：1.95%<br>Visa折算价差另计') + '</td><td>' + num(M.outwardFee(row, asDate()), 0) + ' HKD / 笔<br><span class="muted">一般网上渠道，不含其他银行费</span></td></tr>').join('') + '</tbody></table></div><div class="flow-table-notes"><span>¹ 汇丰汇入免费不适用于OUR指示；非本地转账可能仍有中转行费。</span><span>² 中银香港≤500 HKD等值汇入免；内地中行同名优惠可免，但内地汇出费不因此自动豁免。</span><span>众安SWIFT汇出：目前免，2026-11-01起70 HKD。恒生/汇丰同名指定渠道、中银快汇及渣打优先账户另有豁免，实际费用可覆盖。</span></div>' +
      '<div class="flow-spend-cards"><article><span>在香港消费</span><strong>HKD → 本地支付</strong><p>用已有港元余额或本地FPS；美元用途无需先换港元。</p></article><article><span>境外美元消费</span><strong>USD → USD扣账</strong><p>对应币种足额才可直接扣账；ZA等港元结算卡还会涉及换汇和签账费。</p></article><article><span>拿回大陆消费</span><strong>USD汇回 → CNY结汇</strong><p>银行审核资金来源与用途；结汇额度不等于免税额度。跨境支付通另看身份与额度。</p></article></div></section>';
  }
  function advanced() {
    return '<section class="card flow-advanced"><details><summary>账户门槛、机会成本与参照汇率</summary><div class="flow-advanced-body"><div class="flow-parameters">' + field('balanceHkd', '香港账户另有理财总值', 'HKD') + field('monthlyHkd', '覆盖香港账户月费', 'HKD', 'placeholder="留空按已知账户规则"') + field('months', '账户使用月数', '月') + field('openingCny', '额外开户 / 赴港支出', 'CNY') + '</div><div class="flow-parameters">' + field('extraCapitalCny', '额外为资格保留的资产', 'CNY') + field('annualGapPct', '保留资产的年收益差', '%') + '</div><p class="flow-short-note">“另有资产”与本次流转预算分开。验资/存款仍归你所有，不整笔扣除；机会成本=额外资产×年收益差×月数/12。未填实际差额时，0只代表情景假设。</p><div class="flow-parameters">' + field('usdCny', '折算参照：1 USD =', 'CNY') + field('usdHkd', '情景参照：1 USD =', 'HKD') + field('usdCnh', '情景参照：1 USD =', 'CNH') + '</div><p class="flow-short-note">初始CNY参照取中行买卖中间值，非市场中间价；HKD/CNH为可修改情景参照。CNY与CNH不能默认按同一外汇成交价兑换。</p></div></details></section>';
  }
  function view(helpers) {
    H = helpers;
    const r = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '从人民币、港元到美元，看看钱在哪一步换汇、在哪一步损耗。', button('费用与依据', 'detail', 'sources')) +
      setup() + '<div id="flow-live-diagram">' + diagram(r) + '</div>' + versions() + comparison(r) + consumerControls(r) + hkCompare() + advanced();
  }
  function detail(key) {
    const descriptions = {
      mainland: ['大陆人民币与用途', '<p>年度便利化购汇与结汇额度分别为等值5万美元，超过额度的真实经常项目可凭材料办理；额度不是获准投资境外证券的额度。</p><p>旅游、留学、医疗等用途应有真实依据。购汇和汇款用途必须一致，不能用同名香港账户、拆分或借用他人额度改变实际用途。</p>', ['safe', 'remit']],
      exchange: ['换汇与跨境汇出', '<p>购汇选现汇，并读取银行现汇卖出价；结汇读取现汇买入价。报价有买卖价差，即使“换汇手续费为0”也未必没有损耗。</p><p>大陆牌价通常是每100外币的人民币价格；香港USD/HKD一般是每1美元的港元价。SHA、OUR、BEN只改变费用承担方，OUR不保证所有链路费用已被固定价格覆盖。</p><p>账户内外汇汇出材料门槛与年度购汇额度是两项规则；两者不应混为一谈。</p>', ['bocFx', 'cmbFx', 'cmb', 'remit']],
      bank: ['香港同名银行账户', '<p>准备本人有效证件、出入境记录、真实地址及职业/资金来源资料。访港手机开户要满足银行对人在香港、网络及文件的要求，银行仍可要求补充资料。</p><p>汇款姓名和券商账户姓名应一致。HKD/CNH可用FPS；USD应按照券商当次指示使用香港本地CHATS或指定银行转账，不能把USD按FPS直接发送。</p><p>选择较高账户级别前，比较月费与维持资产的机会成本；资产门槛不代表一次验资后就能永久免除条件。</p>', ['zaVisit', 'hangOpen', 'hsbcHk', 'ibFunding']],
      broker: ['券商入金与换汇', '<p>先核对券商是否接受自己的居住地、税务身份及资金来源。香港银行卡不等于有券商开户资格，也不改变大陆购汇用途限制。</p><p>在券商生成当次入金通知，核对币种、收款银行、收款人及附言识别码；再从同名银行按该指示转账。不要采用他人的收款截图或第三方账户。</p><p>IBKR直接客户的手动换汇首档佣金为0.002%、最低2美元；自动换汇通常在汇率上加价0.03%，无额外独立佣金。账户基准币种只是报表币种。</p><p>指定香港银行账户的远程开户身份验证方法要求初始转账不少于1万港元，后续存取限指定账户。其他合资格开户方式另有条件，不能写成所有券商统一验资。</p>', ['csrc', 'ibFunding', 'ibFx', 'sfc']],
      tax: ['卖出、结算与税款', '<p>卖出后须等资金满足券商结算及提现要求；入金本身也可能有提现等待期。预留生活费，不能把未结算卖出款当成当天可消费的余额。</p><p>中国大陆税收居民的境外所得按适用规则申报。境外股票转让属于财产转让所得范畴，通常以人民币处置收入减成本和允许费用核算应税所得；一般税率20%，可抵免境外税款受限额及凭证条件约束。</p><p>本页的税款是自填“已核算人民币应税所得”的预留估计，不对整笔本金或提现金额征20%。股息、交易收益及汇率成本应独立核算；最终以申报材料和适用规则为准。</p>', ['tax', 'ibFunding']],
      spend: ['投资资金如何用于消费', '<div class="flow-detail-path"><strong>香港HKD消费</strong><span>香港银行HKD余额 → 本地支付 / FPS / 相应卡片</span><strong>境外USD消费</strong><span>券商USD出金 → 香港银行USD余额 → 支持USD直接扣账的卡</span><strong>大陆CNY消费</strong><span>券商出金 → 香港银行 → 获银行审核的汇回 → 大陆结汇</span></div><p>汇丰、恒生、中银、渣打指定多币种扣账卡在功能启用、对应币种余额足够时可直接扣相应余额。余额不足后的兑换按各卡规则另核。ZA外币及海外处理港元签账收1.95%，另有Visa折算价。图中银行节点显示消费前余额，最后节点按所选支付方式扣除签账费和已填换汇损耗；ATM提款及商户DCC不在该金额内。</p><p>结账一般选择商户当地币种；DCC由商户/ATM提供，应先看其汇率及费用。ATM现金提现还可能有固定手续费或运营商附加费。</p><p>跨境支付通用于真实小额跨境支付，资格随银行与身份而不同。汇丰当前北向服务要求香港居民；不能将香港身份证持有人的每日8万元人民币同名汇款安排直接套给仅持内地身份证的客户。</p><p>不能把券商设计成专门的“入金—换汇—立刻出金”汇款通道，也不能将闭环理财通资金导入普通券商。</p>', ['hsbcCard', 'hangCard', 'bochkCard', 'scCard', 'hsbcHk', 'zaCard', 'payment', 'paymentHsbc', 'safe']],
      sources: ['费用与研究依据', '<p>收费人工核对至' + D.verifiedAt + '；中国银行、招商银行公开牌价由定时数据任务刷新，保留各行原始报价时间。香港银行与券商成交价由用户输入，未获取的费用不作为0处理。</p><p>比较总预算内的逐笔手续费，最低费与封顶费逐笔计算；重复换汇按实际方向计算，不重复扣除已含在成交价里的价差。未报价的非负费用使结果成为余额上限，不能产生“最低损耗银行”排名。</p><p>最低损耗版是满足条件后的路径设计；不同银行报价时间、客户优惠、维护成本与开户资格不同，不宣称某家银行普遍最便宜。</p>', Object.keys(D.sources)]
    };
    const [title, body, keys] = descriptions[key] || descriptions.sources;
    H.openModal(H.modalTitle('跨境资金', title) + '<div class="flow-detail">' + body + '<div class="flow-detail-sources">' + sourceList(keys) + '</div></div>');
  }
  function changeOrigin(value) {
    const keys = ['amount', 'currency', 'hkBank', 'intermediaryCny', 'monthlyHkd', 'balanceHkd', 'exitPrice'];
    state.origins[state.origin] = Object.fromEntries(keys.map(key => [key, state[key]]));
    state.origin = value;
    const next = value === 'mainland' ? { amount: '100000', currency: 'HKD', hkBank: 'za', intermediaryCny: '', monthlyHkd: '', balanceHkd: '0', exitPrice: '' } : { amount: '10000', currency: 'USD', hkBank: 'hsbc', intermediaryCny: '', monthlyHkd: '', balanceHkd: '0', exitPrice: '' };
    Object.assign(state, next, state.origins[value] || {});
  }
  function handleAction(el) {
    const action = el.dataset.action, value = el.dataset.value, key = el.dataset.field;
    if (action === 'money-flow-detail') { detail(value); return; }
    if (action === 'money-flow-set') {
      if (key === 'origin') changeOrigin(value);
      else if (Object.hasOwn(state, key)) {
        state[key] = value;
        if (key === 'currency' && state.origin !== 'mainland') state.entryPrice = value === 'CNH' ? state.usdCnh : state.usdHkd;
        if (key === 'spend') state.exitPrice = '';
      }
    }
    if (action === 'money-flow-bank') {
      state.mainlandBank = value; state.senderFeeCny = '';
      const row = bank(value);
      if (['hang', 'hsbc', 'sc'].includes(value)) state.hkBank = value;
    }
    if (action === 'money-flow-reset-quotes') state.quotes = {};
    save(); H.render();
  }
  // Numeric inputs update output regions only. Replacing the whole page while
  // typing would reset the caret and collapse open account-cost controls.
  function handleInput(el) {
    if (el.dataset.moneyQuote) state.quotes[el.dataset.moneyQuote + ':' + state.currency] = el.value;
    else if (el.dataset.moneyField && Object.hasOwn(state, el.dataset.moneyField)) state[el.dataset.moneyField] = el.value;
    else return false;
    save(); clearTimeout(timer);
    timer = setTimeout(() => {
      if (!document.querySelector('.page-money-flow')) return;
      const r = result();
      document.getElementById('flow-live-result').innerHTML = resultPanel(r);
      document.getElementById('flow-live-diagram').innerHTML = diagram(r);
      document.getElementById('flow-live-consumer').innerHTML = consumerOutput(r);
      document.querySelectorAll('.flow-method[data-value]').forEach(el => {
        const mode = el.dataset.value, fx = M.brokerFx(n(state.amount), state.currency, n(state.entryPrice), mode, D.broker);
        el.querySelector('b').textContent = state.currency === 'USD' ? '无需换汇' : mode === 'bank' ? '填银行报价' : fx ? '可得 ' + num(fx.usd) + ' USD' : '需填换汇价格';
      });
      document.querySelectorAll('.flow-rate-table tbody tr').forEach((tr, i) => {
        const row = D.mainlandBanks[i], c = config(); let cost = 0, valid = true;
        for (let index = 0; index < (n(state.count) || 1); index++) {
          const line = M.remitPrincipal((n(state.amount) || 0) / (n(state.count) || 1), row, index + 1 + (n(state.usedFreeTransfers) || 0), c.date, row.id === state.mainlandBank ? n(state.senderFeeCny) : null);
          if (!line) valid = false; else cost += line.fee;
        }
        const total = tr.querySelector('td:nth-child(3) strong'); if (total) total.textContent = valid ? num(cost) : '优惠已到期';
        if (el.dataset.moneyQuote === row.id) tr.querySelector('td:nth-child(2) small').textContent = '自行录入成交价';
      });
    }, 100);
    return true;
  }
  function handleChange(el) {
    if (el.dataset.moneyEligible) {
      const id = el.dataset.moneyEligible;
      state.enabled = el.checked ? [...new Set([...state.enabled, id])] : state.enabled.filter(key => key !== id);
      save(); H.render(); return true;
    }
    if (el.dataset.moneyCheck) { state[el.dataset.moneyCheck] = el.checked; save(); H.render(); return true; }
    if (el.dataset.moneyField || el.dataset.moneyQuote) return true;
    return false;
  }
  window.ChanghengMoneyFlow = { view, handleAction, handleInput, handleChange };
}());
