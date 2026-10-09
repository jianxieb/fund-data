(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ChanghengMoneyFlowModel = model;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const positive = v => finite(v) && v > 0;
  const knownFee = v => finite(v) && v >= 0;
  function number(value) {
    if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    return finite(n) ? n : null;
  }
  function invalidOptional(config, keys) {
    return keys.some(key => config[key] != null && String(config[key]).trim() !== '' && !knownFee(number(config[key])));
  }
  function reference(config) {
    const usdCny = number(config.usdCny), usdHkd = number(config.usdHkd), usdCnh = number(config.usdCnh);
    if (![usdCny, usdHkd, usdCnh].every(positive)) return null;
    return { CNY: 1, USD: usdCny, HKD: usdCny / usdHkd, CNH: usdCny / usdCnh };
  }
  function fee(bank, principalCny, index = 1, date = '2026-10-08') {
    if (!bank || !knownFee(principalCny)) return null;
    if (![bank.rate, bank.minimum, bank.maximum, bank.telegram].every(knownFee)) return null;
    if ((bank.validFrom && date < bank.validFrom) || (bank.validUntil && date > bank.validUntil)) return null;
    const commission = Math.min(bank.maximum, Math.max(bank.minimum, principalCny * bank.rate));
    const telegram = bank.freeTelegram && index <= bank.freeTelegram ? 0 : bank.telegram;
    return commission + telegram;
  }
  // Sender fees are paid inside the declared budget, so charging r * budget
  // would overcharge an uncapped percentage fee. Solve principal + fee = budget.
  function remitPrincipal(budgetCny, bank, index, date, override) {
    if (!positive(budgetCny)) return null;
    const charge = x => knownFee(override) ? override : fee(bank, x, index, date);
    const minimum = charge(0);
    if (minimum == null || minimum >= budgetCny) return null;
    let low = 0, high = budgetCny;
    for (let i = 0; i < 64; i++) {
      const mid = (low + high) / 2;
      if (mid + charge(mid) > budgetCny) high = mid; else low = mid;
    }
    return { principal: low, fee: charge(low) };
  }
  function inwardFee(bank, amountHkd, senderGroup, local = false) {
    if (local && knownFee(bank.localHkd)) return bank.localHkd;
    if (bank.sameGroupWaiver && bank.group === senderGroup) return 0;
    if (bank.inwardSmallLimitHkd && amountHkd <= bank.inwardSmallLimitHkd) return 0;
    return knownFee(bank.inwardHkd) ? bank.inwardHkd : null;
  }
  function outwardFee(bank, date = '2026-10-08') {
    if (!bank) return null;
    const change = [...(bank.outwardChanges || [])].reverse().find(row => date >= row.from);
    return change ? change.fee : knownFee(bank.outwardHkd) ? bank.outwardHkd : null;
  }
  function maintenance(bank, balanceHkd, months, override) {
    if (![balanceHkd, months].every(knownFee)) return null;
    if (knownFee(override)) return override * months;
    if (!knownFee(bank.monthlyHkd)) return null;
    return bank.thresholdHkd && balanceHkd >= bank.thresholdHkd ? 0 : bank.monthlyHkd * months;
  }
  function legalPath(origin, purpose, brokerApproved) {
    if (origin === 'mainland' && purpose === 'invest') return { allowed: false, reason: '大陆个人便利化购汇不能用于境外证券投资；同名香港账户不改变用途限制。' };
    if (purpose === 'invest' && !brokerApproved) return { allowed: false, reason: '需先确认券商接受你的身份与资金来源；开户条件与汇款用途是两项独立要求。' };
    return { allowed: true, reason: origin === 'mainland' ? '仅限真实、获银行审核的经常项目用途。' : '已有合法境外资金；仍须符合银行及券商的资金来源审核。' };
  }
  function eligible(bank, enabled) { return !bank.required || (enabled || []).includes(bank.required); }
  function opportunityCost(capital, annualGapPct, months) {
    if (![capital, annualGapPct, months].every(knownFee)) return null;
    return capital * annualGapPct / 100 * months / 12;
  }
  function fxRoundTripLoss(buy, sell) {
    return positive(buy) && positive(sell) ? (1 - buy / sell) * 100 : null;
  }
  function mainlandTransfer(config, bank, hkBank) {
    if (config.purpose === 'invest') return { error: legalPath('mainland', 'invest', false).reason };
    const refs = reference(config), budget = number(config.amount), count = number(config.count), months = number(config.months);
    const quote = number(config.sell), currency = config.currency === 'USD' ? 'USD' : 'HKD';
    const missing = [], rows = [];
    if (!refs || !positive(budget) || !positive(count) || !Number.isInteger(count) || count > 120 || !knownFee(months)) return { error: '请输入有效金额、1–120笔汇款及非负月数。' };
    if (invalidOptional(config, ['intermediaryCny', 'senderFeeCny', 'monthlyHkd', 'balanceHkd', 'usedFreeTransfers'])) return { error: '银行费用、保留资产及已用笔数必须为非负数；未知费用请留空。' };
    if (!Number.isInteger(number(config.usedFreeTransfers) || 0)) return { error: '已用免费笔数须为非负整数。' };
    if (!positive(quote)) missing.push('所选银行的现汇卖出成交价');
    const middle = number(config.intermediaryCny), override = number(config.senderFeeCny);
    const sameGroup = bank.group === hkBank.group;
    if (bank.required && !sameGroup && ['hang', 'hsbc', 'sc'].includes(bank.id)) return { error: '所选免费渠道只适用于该集团在香港的同名账户。' };
    if (!eligible(bank, config.enabled)) return { error: '该路线的账户/优惠资格尚未确认。' };
    const actualMiddle = knownFee(middle) ? middle : bank.includedIntermediary && sameGroup ? 0 : null;
    if (!knownFee(actualMiddle)) missing.push('中转行费用');
    let principal = 0, sendingFees = 0;
    const used = Math.max(0, Math.floor(number(config.usedFreeTransfers) || 0));
    for (let i = 0; i < count; i++) {
      const row = remitPrincipal(budget / count, bank, used + i + 1, config.date, override);
      if (!row) return { error: bank.validUntil && config.date > bank.validUntil ? '该优惠已到期，请填入当前每笔汇出费用。' : '预算不足以支付汇出费用，或该收费优惠尚未生效。' };
      principal += row.principal; sendingFees += row.fee;
    }
    const converted = positive(quote) ? principal / quote : null;
    const inward = inwardFee(hkBank, converted == null ? Infinity : converted / count * refs[currency] / refs.HKD, bank.group);
    if (inward == null) missing.push('香港收款行汇入费用');
    const monthly = maintenance(hkBank, number(config.balanceHkd) || 0, months, number(config.monthlyHkd));
    if (monthly == null) missing.push('香港账户月费');
    const knownMiddleCny = knownFee(actualMiddle) ? actualMiddle * count : 0;
    const inwardCny = knownFee(inward) ? inward * count * refs.HKD : 0;
    const monthlyCny = knownFee(monthly) ? monthly * refs.HKD : 0;
    const explicitCny = sendingFees + knownMiddleCny + inwardCny + monthlyCny;
    const net = converted == null ? null : converted - (knownMiddleCny + inwardCny + monthlyCny) / refs[currency];
    if (net != null && net < 0) return { error: '预算不足以支付汇入或账户费用。' };
    const fxCny = converted == null ? null : principal - converted * refs[currency];
    rows.push({ label: '汇出手续费＋电讯费', cny: sendingFees });
    rows.push({ label: '中转行费用', cny: knownFee(actualMiddle) ? knownMiddleCny : null });
    rows.push({ label: '香港汇入费', cny: knownFee(inward) ? inwardCny : null });
    rows.push({ label: '账户月费', cny: monthly == null ? null : monthlyCny });
    rows.push({ label: '成交价与参照价差额', cny: fxCny });
    return { budget, principal, sendingFees, converted, net, currency, explicitCny, fxCny, costCny: fxCny == null ? null : explicitCny + fxCny, rows, missing: [...new Set(missing)], complete: !missing.length, refs };
  }
  // Price is source units per USD; the commission must fit inside the cash.
  // Automatic conversion uses a 0.03% price markup, never a second commission.
  function brokerFx(amount, currency, price, mode, broker) {
    if (!positive(amount)) return null;
    if (currency === 'USD') return { usd: amount, commissionUsd: 0, markupUsd: 0 };
    if (!positive(price)) return null;
    const grossUsd = amount / price;
    if (mode === 'auto') {
      const usd = grossUsd / (1 + broker.autoMarkup);
      return { usd, commissionUsd: 0, markupUsd: grossUsd - usd };
    }
    if (mode === 'bank') return { usd: grossUsd, commissionUsd: 0, markupUsd: 0 };
    const minimumUsd = broker.manualMinimumUsd;
    let usd = grossUsd - minimumUsd;
    if (usd <= 0) return null;
    if (usd * broker.manualRate > minimumUsd) usd = grossUsd / (1 + broker.manualRate);
    return { usd, commissionUsd: Math.max(minimumUsd, usd * broker.manualRate), markupUsd: 0 };
  }
  function taxReserve(taxableCny, ratePct, creditCny) {
    if (![taxableCny, ratePct, creditCny].every(knownFee) || ratePct > 100) return null;
    return Math.max(0, taxableCny * ratePct / 100 - creditCny);
  }
  function offshoreTransfer(config, hkBank, broker) {
    const permission = legalPath(config.origin || 'offshore', 'invest', config.brokerApproved);
    if (!permission.allowed) return { error: permission.reason };
    const refs = reference(config), amount = number(config.amount), currency = ['HKD', 'CNH', 'USD'].includes(config.currency) ? config.currency : 'USD';
    const missing = [], rows = [];
    if (!refs || !positive(amount)) return { error: '请输入有效金额与正汇率。' };
    const months = number(config.months);
    if (!knownFee(months) || invalidOptional(config, ['depositHkd', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'balanceHkd', 'tradeFeeUsd'])) return { error: '银行费用、保留资产及使用月数必须为非负数；未知费用请留空。' };
    const price = number(config.entryPrice);
    const localDefault = currency === 'USD' || config.fxMode === 'bank' ? (knownFee(hkBank.localUsdNative) ? hkBank.localUsdNative * refs.USD / refs.HKD : hkBank.localUsd) : hkBank.localHkd;
    const deposit = number(config.depositHkd) ?? localDefault;
    if (!knownFee(deposit)) missing.push('银行至券商本地转账费');
    const depositUsd = knownFee(deposit) ? deposit / config.usdHkd : 0;
    const sourceDeposit = config.fxMode === 'bank' ? 0 : depositUsd * refs.USD / refs[currency];
    const initial = brokerFx(amount - sourceDeposit, currency, price, config.fxMode, broker);
    if (!initial) return { error: currency === 'USD' ? '请输入有效金额。' : '需填入换汇成交价，且余额须足够支付最低佣金。' };
    const investUsd = initial.usd - (config.fxMode === 'bank' ? depositUsd : 0);
    if (investUsd <= 0) return { error: '余额不足以支付入金费用。' };
    const profitUsd = number(config.profitUsd);
    if (!finite(profitUsd)) return { error: '请输入有效卖出盈亏；0表示仅比较资金流转费用。' };
    const tradeFee = number(config.tradeFeeUsd);
    if (Object.hasOwn(config, 'tradeFeeUsd') && !knownFee(tradeFee)) missing.push('证券交易费用');
    const proceeds = investUsd + profitUsd - (knownFee(tradeFee) ? tradeFee : 0);
    const tax = taxReserve(number(config.taxableCny), number(config.taxRate), number(config.creditCny));
    if (tax == null) return { error: '请输入非负应税所得、0–100%税率及可抵免税额。' };
    const withdrawalIndex = number(config.withdrawalIndex);
    if (!positive(withdrawalIndex) || !Number.isInteger(withdrawalIndex)) return { error: '请输入当月第几次出金。' };
    const withdrawal = withdrawalIndex <= broker.freeWithdrawals ? 0 : broker.withdrawUsd;
    // Broker withdrawal is a bank wire. A free local inward payment tariff
    // must not silently waive an overseas USD wire's receiving fee.
    const inward = number(config.inwardHkd) ?? inwardFee(hkBank, proceeds * config.usdHkd, 'broker');
    if (!knownFee(inward)) missing.push('券商USD汇入香港银行费');
    const middle = number(config.intermediaryCny);
    if (!knownFee(middle)) missing.push('出金中转行费用');
    const feesUsd = withdrawal + (knownFee(inward) ? inward / config.usdHkd : 0) + (knownFee(middle) ? middle / refs.USD : 0);
    const bankUsd = proceeds - feesUsd - tax / refs.USD;
    if (bankUsd <= 0) return { error: '卖出资金不足以覆盖出金费与预留税款。' };
    const spend = ['USD', 'HKD', 'CNY'].includes(config.spend) ? config.spend : 'USD';
    const spendRate = spend === 'USD' ? 1 : number(config.exitPrice);
    if (!positive(spendRate)) return { error: '需填入USD换成消费币种的银行成交价。' };
    let exit = spend === 'CNY' ? number(config.returnWireHkd) ?? outwardFee(hkBank, config.date) : 0;
    if (!knownFee(exit)) { missing.push('香港汇回大陆手续费'); exit = 0; }
    const mainlandExtra = spend === 'CNY' ? number(config.returnExtraCny) : 0;
    if (!knownFee(mainlandExtra)) missing.push('回大陆的中转费及收款行费');
    const spending = (bankUsd - exit / config.usdHkd) * spendRate - (knownFee(mainlandExtra) ? mainlandExtra / refs[spend] : 0);
    if (spending < 0) return { error: '资金不足以支付消费端汇款费。' };
    const entryFx = currency === 'USD' ? 0 : (amount - sourceDeposit) * refs[currency] - ((amount - sourceDeposit) / price) * refs.USD;
    const exitFx = (bankUsd - exit / config.usdHkd) * refs.USD - (bankUsd - exit / config.usdHkd) * spendRate * refs[spend];
    const monthly = maintenance(hkBank, number(config.balanceHkd) || 0, months, number(config.monthlyHkd));
    if (monthly == null) missing.push('香港账户月费');
    const explicit = (initial.commissionUsd + depositUsd + feesUsd + exit / config.usdHkd + (knownFee(tradeFee) ? tradeFee : 0)) * refs.USD + (knownFee(mainlandExtra) ? mainlandExtra : 0) + (knownFee(monthly) ? monthly * refs.HKD : 0);
    const fx = entryFx + exitFx + initial.markupUsd * refs.USD;
    const monthlySpend = knownFee(monthly) ? monthly * refs.HKD / refs[spend] : 0;
    const net = spending - monthlySpend;
    if (net < 0) return { error: '资金不足以支付账户月费。' };
    rows.push({ label: '本地入金费用', cny: knownFee(deposit) ? depositUsd * refs.USD : null });
    rows.push({ label: '换汇佣金／自动加价', cny: (initial.commissionUsd + initial.markupUsd) * refs.USD });
    if (Object.hasOwn(config, 'tradeFeeUsd')) rows.push({ label: '证券交易费用', cny: knownFee(tradeFee) ? tradeFee * refs.USD : null });
    rows.push({ label: '券商出金费', cny: withdrawal * refs.USD });
    rows.push({ label: '香港银行汇入费', cny: knownFee(inward) ? inward / config.usdHkd * refs.USD : null });
    rows.push({ label: '出金中转行费', cny: knownFee(middle) ? middle : null });
    if (spend === 'CNY') { rows.push({ label: '回大陆汇出费', cny: exit * refs.HKD }); rows.push({ label: '回大陆其他银行费', cny: knownFee(mainlandExtra) ? mainlandExtra : null }); }
    rows.push({ label: '账户月费', cny: monthly == null ? null : monthly * refs.HKD });
    rows.push({ label: '银行成交价与参照价差额', cny: entryFx + exitFx });
    return { amount, currency: spend, investUsd, proceeds, bankUsd, net, taxCny: tax, explicitCny: explicit, fxCny: fx, costCny: explicit + fx, rows, missing: [...new Set(missing)], complete: !missing.length, refs, brokerFx: initial };
  }
  // Buying power uses the available balance, rather than charging a surcharge
  // on the entire budget and then spending what remains. For a 1.95% card fee,
  // purchases + 1.95% * purchases = budget.
  function consumption(config, bank) {
    const amount = number(config.amount), currency = config.currency;
    if (!knownFee(amount)) return { net: null, missing: ['消费前银行余额'] };
    if (currency === 'CNY' || (currency === 'HKD' && config.method !== 'card')) return { net: amount, cost: 0, fee: 0, fx: 0, missing: [] };
    if (invalidOptional(config, ['cardPct'])) return { error: '签账费率须为非负数。', net: null, missing: [] };
    let pct = number(config.cardPct);
    if (pct == null) pct = currency === 'HKD' && bank.id === 'za' && !config.overseasProcessed ? 0 : bank.cardForeignPct;
    const missing = [];
    if (!knownFee(pct)) missing.push('所选卡片的签账费率');
    if (currency === 'USD' && bank.id === 'za') {
      const bid = number(config.bankHkdPerUsd), network = number(config.networkHkdPerUsd);
      if (!positive(bid)) missing.push('ZA将USD换HKD的成交价');
      if (!positive(network)) missing.push('Visa美元签账的HKD折算价');
      if (missing.length) return { net: null, missing };
      const beforeFee = amount * bid / network, net = beforeFee / (1 + pct / 100);
      return { net, cost: amount - net, fee: beforeFee - net, fx: amount - beforeFee, missing: [] };
    }
    if (currency === 'USD' && !bank.directUsdCard && !config.sameCurrencyCard) missing.push('支持USD直接扣账且有足额余额的卡片');
    if (missing.length) return { net: null, missing };
    const net = amount / (1 + pct / 100);
    return { net, cost: amount - net, fee: amount - net, fx: 0, missing: [] };
  }
  function quoteFresh(quote, date) {
    if (!quote?.asOf) return false;
    const age = (Date.parse(date + 'T23:59:59+08:00') - Date.parse(quote.asOf.replace(' ', 'T') + (quote.asOf.length === 10 ? 'T00:00:00+08:00' : '+08:00'))) / 864e5;
    return finite(age) && age >= 0 && age < 4;
  }
  function depositFee(bank, method, currency, refs, date) {
    if (method === 'fps' || method === 'edda') return currency === 'USD' ? null : knownFee(bank.localHkd) ? bank.localHkd * refs.HKD : null;
    if (method === 'chats') return currency === 'USD' ? knownFee(bank.localUsdNative) ? bank.localUsdNative * refs.USD : knownFee(bank.localUsd) ? bank.localUsd * refs.HKD : null : null;
    if (method === 'swift') { const v = outwardFee(bank, date); return v == null ? null : v * refs.HKD; }
    return null;
  }
  function returnFee(bank, mainland, method, refs, date) {
    if (method === 'bochk-fast') return bank.id === 'bochk' && mainland.group === 'boc' ? 0 : null;
    if (method === 'linked') return ['hang', 'hsbc', 'sc'].includes(bank.id) && bank.group === mainland.group ? 0 : null;
    if (method === 'swift') { const v = outwardFee(bank, date); return v == null ? null : v * refs.HKD; }
    return null;
  }
  function selectedBroker(config, data) {
    return data.brokers?.find(row => row.id === (config.broker || 'ibkr')) || { ...data.broker, id: 'ibkr', withdrawalMethod: 'wire' };
  }
  function cappedCharge(rule, shares, value) {
    if (!rule || value <= 0) return 0;
    const raw = shares * rule.perShare, limit = value * rule.cap;
    return rule.capWins ? Math.min(limit, Math.max(rule.minimum, raw)) : Math.max(rule.minimum, Math.min(limit, raw));
  }
  function shiftedMonth(date, months) {
    const d = new Date(date + 'T12:00:00Z'), day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  }
  // Equal-size buy orders in the starting month and equal-size sell orders in
  // the final holding month are a fee benchmark, not a return simulation.
  // Buy-side charges fit inside available USD, including voucher allocation.
  function brokerTradingFees(config, broker, cashUsd, profitUsd, refs) {
    const buys = number(config.buyOrders) ?? 1, sells = number(config.sellOrders) ?? 1;
    const price = number(config.sharePriceUsd) ?? 100, months = number(config.months) ?? 1;
    if (![buys, sells].every(v => positive(v) && Number.isInteger(v) && v <= 120) || !positive(price) || !knownFee(months) || months > 1200) return { error: '交易笔数须为1–120整数，测算股价须为正数，使用月数不超过1200。' };
    const usedQuota = number(config.usedPromoOrders) ?? 0, usedTurnover = number(config.otherTurnoverHkd) ?? 0;
    const voucher = number(config.voucherUsd) ?? 0, voucherOrders = number(config.voucherOrders) ?? 1;
    if (!knownFee(usedQuota) || !Number.isInteger(usedQuota) || !knownFee(usedTurnover) || !knownFee(voucher) || !positive(voucherOrders) || !Number.isInteger(voucherOrders) || voucherOrders > 240) return { error: '优惠已用笔数、月成交额及抵扣额度须为非负数，券可用笔数须为1–240整数。' };
    const date = config.date || '2026-10-09', heldMonths = Math.max(1, Math.ceil(months));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return { error: '测算日期无效。' };
    const sellDate = shiftedMonth(date, heldMonths - 1), sameMonth = date.slice(0, 7) === sellDate.slice(0, 7);
    const expiry = config.voucherExpiry || '';
    if (config.useVoucher && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(expiry)))) return { error: '请填入已获交易费券的有效截止日期。' };
    const usmartDays = number(config.usmartDays) ?? 0;
    if (!knownFee(usmartDays) || !Number.isInteger(usmartDays)) return { error: '开户距今须为非负整数天。' };
    const centsUp = value => value > 0 ? Math.ceil((value - 1e-10) * 100) / 100 : 0;
    const promoDate = d => d >= '2026-04-20' && d <= '2026-12-31';
    const estimate = buyValue => {
      const shares = buyValue / price, saleValue = buyValue + profitUsd;
      let remainingVoucher = config.useVoucher ? voucher : 0, couponsUsed = 0;
      let turnover = usedTurnover, orderIndex = usedQuota;
      const orders = [];
      function side(kind, count, total, d) {
        if (kind === 'sell' && !sameMonth) { turnover = usedTurnover; orderIndex = usedQuota; }
        for (let i = 0; i < count; i++) {
          const value = total / count, qty = shares / count, stockPrice = value / qty;
          let commission = cappedCharge(broker.commission, qty, value), platform = cappedCharge(broker.platform, qty, value), offer = '';
          if (broker.id === 'hsbc') {
            const over = Math.max(0, turnover + value * refs.USD / refs.HKD - 250000) - Math.max(0, turnover - 250000);
            const chargedQty = config.trade25 ? qty * Math.min(1, over / (value * refs.USD / refs.HKD)) : qty;
            commission = chargedQty > 0 ? 18 + Math.max(0, chargedQty - 1000) * .015 : 0;
            if (config.trade25 && commission === 0) offer = 'Trade25月额度';
          }
          if (broker.id === 'chief' && config.chiefMonthly && kind === 'buy' && d >= '2026-01-01' && d <= '2026-12-31') {
            platform = Math.max(0, value - 500) * .0015; offer = '月供首500 USD';
          }
          const days = (Date.parse(d) - Date.parse(date)) / 864e5 + usmartDays;
          if (broker.id === 'usmart' && config.usmartPromo && promoDate(d) && days < 180 && stockPrice >= 100) {
            platform = .99; offer = '合资格0.99 USD';
          }
          if (broker.id === 'za' && config.zaLv2 && orderIndex < 5) {
            platform = cappedCharge({ perShare: .008, minimum: .99, cap: .015 }, qty, value); offer = 'ZA Perks Lv2';
          }
          const clearing = cappedCharge(broker.clearing, qty, value);
          const sec = kind === 'sell' ? Math.max(.01, centsUp(value * .0000206)) : 0;
          const holiday = d >= '2026-10-01' && d <= '2026-12-31';
          const taf = kind === 'sell' && !holiday ? Math.max(.01, Math.min(9.79, centsUp(qty * .000195))) : 0;
          const cat = broker.catMinimum != null ? Math.max(broker.catMinimum, qty * .000003) : 0;
          const voucherBase = config.voucherScope === 'platform' ? platform : config.voucherScope === 'both' ? commission + platform : commission;
          const discount = remainingVoucher > 0 && d <= expiry && couponsUsed < voucherOrders ? Math.min(remainingVoucher, voucherBase) : 0;
          if (discount > 0) { remainingVoucher -= discount; couponsUsed++; }
          orders.push({ kind, date: d, value, shares: qty, commission, platform, clearing, sec, taf, cat, discount, offer,
            feeUsd: commission + platform + clearing + sec + taf + cat - discount });
          turnover += value * refs.USD / refs.HKD; orderIndex++;
        }
      }
      side('buy', buys, buyValue, date); side('sell', sells, Math.max(0, saleValue), sellDate);
      return orders;
    };
    let low = 0, high = cashUsd;
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      const buyFee = estimate(middle).filter(order => order.kind === 'buy').reduce((sum, order) => sum + order.feeUsd, 0);
      if (middle + buyFee > cashUsd) high = middle; else low = middle;
    }
    const orders = estimate(low), buyFeeUsd = orders.filter(order => order.kind === 'buy').reduce((sum, order) => sum + order.feeUsd, 0);
    const sellFeeUsd = orders.filter(order => order.kind === 'sell').reduce((sum, order) => sum + order.feeUsd, 0);
    const monthlyHkd = broker.id === 'hsbc' && config.trade25 ? 25 * heldMonths : 0;
    const override = number(config.tradeFeeUsd), warnings = [];
    if (broker.id === 'usmart' && config.usmartPromo && !orders.some(order => order.offer)) warnings.push('盈立0.99优惠未适用：须股价≥100 USD、合资格标的、开户180天内且在推广期');
    if (broker.id === 'chief' && config.chiefMonthly && date > '2026-12-31') warnings.push('致富2026年月供优惠已过期，按普通网上交易基准测算');
    if (config.useVoucher && voucher === 0) warnings.push('已勾交易费券但未填抵扣额度，尚未抵扣');
    return { investUsd: override == null ? low : cashUsd, buyFeeUsd, sellFeeUsd, orders, monthlyHkd, warnings,
      totalUsd: override ?? buyFeeUsd + sellFeeUsd, overridden: override != null,
      discountUsd: override == null ? orders.reduce((sum, row) => sum + row.discount, 0) : 0, price, buys, sells, sellDate };
  }
  // A mainland-origin tariff scenario is not a remittance authorisation. Keep
  // the numerical ledger independent of the purpose check, without passing a
  // fictitious consumption purpose or relabelling mainland funds as offshore.
  function mainlandJourney(config, data, quotes) {
    const budget = number(config.budgetCny), permission = legalPath('mainland', 'invest', false);
    const empty = error => ({ error, permission, origin: 'mainland', plans: [] });
    if (!positive(budget)) return empty('请输入正数内地银行卡人民币本金。');
    const overrides = ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'returnMonthlyHkd', 'balanceHkd', 'returnBalanceHkd', 'tradeFeeUsd', 'taxableCny', 'creditCny', 'openingCny', 'extraCapitalCny', 'annualGapPct'];
    if (invalidOptional(config, overrides) || !knownFee(number(config.months))) return empty('费用、资产、应税所得和使用月数须为非负数；未报价请留空。');
    if (['startSell', 'usdCny', 'usdHkd', 'usdCnh', 'entryPrice', 'exitPrice'].some(key => config[key] != null && String(config[key]).trim() !== '' && !positive(number(config[key])))) return empty('汇率须为有效正数；留空使用该行官方牌价。');
    const count = number(config.count) ?? 1, used = number(config.usedFreeTransfers) ?? 0;
    if (!positive(count) || !Number.isInteger(count) || count > 120 || !knownFee(used) || !Number.isInteger(used)) return empty('汇款笔数须为1–120的整数，已用免费笔数须为非负整数。');
    const profit = number(config.profitUsd), taxRate = number(config.taxRate), credit = number(config.creditCny) ?? 0;
    if (!finite(profit) || !knownFee(taxRate) || taxRate > 100) return empty('请输入有效盈亏及0–100%的税率。');
    const withdrawalIndex = number(config.withdrawalIndex) ?? 1;
    if (!positive(withdrawalIndex) || !Number.isInteger(withdrawalIndex)) return empty('本月券商出金次数须为正整数。');
    const mainland = data.mainlandBanks.map(bank => ({ ...bank, quotes: quotes.banks?.[bank.id]?.quotes || {} }));
    const fresh = mainland.filter(bank => positive(bank.quotes.USD?.buy) && positive(bank.quotes.USD?.sell) && quoteFresh(bank.quotes.USD, config.date));
    const refRow = fresh.find(bank => bank.id === 'boc')?.quotes.USD || fresh[0]?.quotes.USD || mainland.find(bank => positive(bank.quotes.USD?.buy) && positive(bank.quotes.USD?.sell))?.quotes.USD;
    const offshore = quotes.offshoreUsd?.bochk?.quotes || {};
    const mid = currency => positive(offshore[currency]?.bidPerUsd) && positive(offshore[currency]?.askPerUsd) ? (offshore[currency].bidPerUsd + offshore[currency].askPerUsd) / 2 : null;
    const refs = reference({ usdCny: number(config.usdCny) ?? (refRow ? (refRow.buy + refRow.sell) / 2 : null), usdHkd: number(config.usdHkd) ?? mid('HKD'), usdCnh: number(config.usdCnh) ?? mid('CNH') });
    if (!refs) return empty('缺少有效的USD/CNY、USD/HKD或USD/CNH参考牌价。');
    const extraCny = (number(config.openingCny) ?? 0) + opportunityCost(number(config.extraCapitalCny) ?? 0, number(config.annualGapPct) ?? 0, number(config.months));
    const broker = selectedBroker(config, data), autoTrade = !!config.broker, tradingCache = new Map();
    function calculate(start, bank, route, fxMode, exit, returning, selections = {}, provider = broker) {
      if (provider.integratedBank && (bank.id !== provider.integratedBank || returning.id !== provider.integratedBank)) return { error: provider.name + '须使用本人' + provider.integratedBank.toUpperCase() + '银行账户直接交收。' };
      if (route !== 'USD' && provider.id !== 'ibkr' && fxMode !== 'bank') return { error: provider.name + '换汇成交价未公开；请选香港银行先换USD，或内地直接换USD。' };
      const currency = route, sameGroup = start.group === bank.group;
      const isSelectedStart = config.startBank === start.id, isSelectedBank = config.bank === bank.id;
      const isSelectedReturn = (config.returnBank || config.bank) === returning.id;
      const own = (key, selected) => selected ? number(config[key]) : null;
      const q = start.quotes[currency], quote = currency === 'CNH' ? 1 : own('startSell', isSelectedStart) ?? q?.sell;
      if (!positive(quote)) return { error: start.name + '缺少' + currency + '现汇卖出价；填入该行成交价后可计算。' };
      const linked = ['hang', 'hsbc', 'sc'].includes(start.id);
      const method = (key, fallback) => (Object.hasOwn(selections, key) ? selections[key] : config[key]) || fallback;
      const mainlandMethod = method('mainlandMethod', linked && sameGroup ? 'linked' : 'swift');
      if (mainlandMethod === 'linked' && !(linked && sameGroup)) return { error: '两地同名专用渠道须选择同一银行集团的香港账户。' };
      if (mainlandMethod === 'full' && !(currency === 'USD' && knownFee(start.fullAmountUsd))) return { error: '所选银行未收录USD全额到账收费，请改用普通汇款。' };
      const senderOverride = own('senderFeeCny', isSelectedStart);
      const unknownSender = senderOverride == null && (fee(start, 0, used + 1, config.date) == null || (linked && mainlandMethod !== 'linked') || (currency === 'CNH' && !sameGroup && !start.cnhTariff && start.id !== 'abc'));
      const fullFee = mainlandMethod === 'full' ? start.fullAmountUsd * quote : 0;
      let principal = 0, sender = 0;
      for (let i = 0; i < count; i++) {
        const solved = remitPrincipal(budget / count, start, used + i + 1, config.date, unknownSender ? 0 : senderOverride == null ? null : senderOverride + fullFee);
        if (!solved) return { error: '预算不足以支付汇出费，或所选优惠不在有效期内。' };
        // Full-amount service is an extra per-transfer charge, not a second
        // percentage commission. Include it in the budget equation.
        const fullSolved = fullFee && senderOverride == null ? remitPrincipal(budget / count - fullFee, start, used + i + 1, config.date, null) : null;
        principal += fullSolved ? fullSolved.principal : solved.principal;
        sender += fullSolved ? fullSolved.fee + fullFee : solved.fee;
      }
      const rows = [], missing = [], requirements = [], steps = {};
      let balance = principal / quote, unit = currency;
      const add = (key, label, cny, step, reason = label) => {
        rows.push({ key, label, cny, step });
        if (cny == null) missing.push(reason); else balance -= cny / refs[unit];
      };
      // Bank spreads are costs; differences between currencies, banks and
      // observation times are valuation effects. Neither is charged again.
      const fxRow = (key, label, referenceDifference, spreadCost, step) => {
        const cny = Math.max(0, spreadCost);
        rows.push({ key, label, cny, step, fxImpactCny: cny - referenceDifference });
      };
      rows.push({ key: 'sender', label: '内地汇出手续费＋电讯费' + (fullFee ? '＋全额到账费' : ''), cny: unknownSender ? null : sender, step: 'entry' });
      if (unknownSender) missing.push(start.name + '所选渠道汇出收费');
      const entryMid = currency === 'CNH' ? 1 : positive(q?.buy) ? (q.buy + q.sell) / 2 : refs[currency];
      fxRow('entryFx', currency === 'CNH' ? '人民币原币汇出（未换汇）' : '内地购汇点差',
        principal - balance * refs[currency], currency === 'CNH' ? 0 : principal - balance * entryMid, 'entry');
      steps.mainlandForeign = balance;
      const entryMiddle = own('entryMiddleCny', isSelectedStart) ?? (mainlandMethod === 'linked' && start.includedIntermediary ? 0 : mainlandMethod === 'full' ? 0 : null);
      add('entryMiddle', '内地→香港中转行费', entryMiddle == null ? null : entryMiddle * count, 'entry');
      const inward = own('entryInwardHkd', isSelectedBank) ?? inwardFee(bank, balance * refs[currency] / refs.HKD / count, start.group);
      add('entryInward', '香港首次汇入费', inward == null ? null : inward * refs.HKD * count, 'entry');
      steps.hongKong = balance;
      const downstreamError = error => ({ error, rows, steps, startSell: quote, route });
      if (!positive(exit.quotes.USD?.buy) && !positive(number(config.exitPrice))) return downstreamError(exit.name + '缺少USD现汇买入价。');
      const depositMethod = provider.integratedBank ? 'internal' : method('depositMethod', currency === 'USD' || fxMode === 'bank' ? 'chats' : 'fps');
      const depositCurrency = fxMode === 'bank' ? 'USD' : currency;
      if (['fps', 'edda'].includes(depositMethod) && depositCurrency === 'USD') return { error: 'FPS/eDDA不支持USD；美元入金请选CHATS或SWIFT。' };
      if (depositMethod === 'chats' && depositCurrency !== 'USD') return { error: '本页CHATS收费为USD本地转账；HKD/CNH可选FPS或eDDA。' };
      const bankFxQuote = bank.id === 'bochk' ? offshore[currency] : null;
      const entryPrice = currency === 'USD' ? 1 : (fxMode === 'bank' ? own('entryPrice', isSelectedBank) : number(config.entryPrice)) ?? (fxMode === 'bank' ? bankFxQuote?.askPerUsd : refs.USD / refs[currency]);
      if (!positive(entryPrice)) return downstreamError(bank.name + '缺少' + currency + '换USD的成交报价。');
      const transfer = () => {
        const charge = own('depositHkd', isSelectedBank);
        add('depositBank', provider.integratedBank ? '本人银行证券账户内部交收' : '银行→券商转账费', provider.integratedBank ? 0 : charge == null ? depositFee(bank, depositMethod, depositCurrency, refs, config.date) : charge * refs.HKD, 'deposit');
        add('depositBroker', provider.name + '入金费', knownFee(provider.depositUsd) ? provider.depositUsd * refs.USD : null, 'deposit');
        // Other banks' fees can exist even when the sending bank or IBKR
        // waives its own fee. FPS has no SWIFT correspondent-bank leg.
        add('depositOther', '入金代理／收款行费', provider.integratedBank ? 0 : own('depositOtherCny', isSelectedBank) ?? (depositMethod === 'fps' || depositMethod === 'edda' ? 0 : null), 'deposit');
      };
      const convert = () => {
        const oldBalance = balance, oldUnit = unit;
        const fx = brokerFx(balance, unit, entryPrice, fxMode, data.broker);
        if (!fx) return null;
        balance = fx.usd; unit = 'USD';
        rows.push({ key: 'brokerFx', label: '换USD佣金／自动加价', cny: (fx.commissionUsd + fx.markupUsd) * refs.USD, step: 'deposit' });
        const grossUsd = balance + fx.commissionUsd + fx.markupUsd;
        const referenceDifference = oldBalance * refs[oldUnit] - grossUsd * refs.USD;
        const bankMid = fxMode === 'bank' && positive(bankFxQuote?.bidPerUsd) && positive(bankFxQuote?.askPerUsd)
          ? (bankFxQuote.bidPerUsd + bankFxQuote.askPerUsd) / 2 : null;
        fxRow('brokerSpread', fxMode === 'bank' ? '香港银行换汇点差' : '换汇成交点差', referenceDifference,
          bankMid ? (oldBalance / bankMid - grossUsd) * refs.USD : referenceDifference, 'deposit');
        return fx;
      };
      let brokerFxResult;
      if (fxMode === 'bank') { brokerFxResult = convert(); if (brokerFxResult) transfer(); }
      else { transfer(); brokerFxResult = convert(); }
      if (!brokerFxResult || balance <= 0) return { error: '余额不足以支付入金及换汇费用。' };
      const tradingKey = provider.id + ':' + balance.toFixed(8);
      if (autoTrade && !tradingCache.has(tradingKey)) tradingCache.set(tradingKey, brokerTradingFees(provider.id === broker.id ? config : { ...config, useVoucher: false, tradeFeeUsd: '' }, provider, balance, profit, refs));
      const trading = autoTrade ? tradingCache.get(tradingKey) : null;
      if (trading?.error) return downstreamError(trading.error);
      steps.fundedUsd = balance;
      steps.investUsd = trading?.investUsd ?? balance;
      balance += profit;
      const trade = trading?.totalUsd ?? number(config.tradeFeeUsd);
      add('trade', '证券买卖交易费', trade == null ? null : trade * refs.USD, 'investment');
      const brokerAccountCny = (trading?.monthlyHkd ?? 0) * refs.HKD;
      if (autoTrade) add('brokerAccount', provider.id === 'hsbc' && config.trade25 ? 'Trade25每月25 HKD' : '证券账户／托管费', brokerAccountCny, 'investment');
      steps.proceedsUsd = balance;
      const taxableCny = number(config.taxableCny) ?? Math.max(0, (profit - (trade ?? 0)) * refs.USD);
      const taxCny = taxReserve(taxableCny, taxRate, credit);
      balance -= taxCny / refs.USD;
      const withdrawal = provider.withdrawalMinimumHkd && balance * refs.USD / refs.HKD < provider.withdrawalMinimumHkd ? null :
        withdrawalIndex <= (provider.freeWithdrawals ?? 0) ? 0 : provider.withdrawUsd;
      add('withdraw', provider.name + '出金费', withdrawal == null ? null : withdrawal * refs.USD, 'withdraw');
      const returnInward = provider.integratedBank ? 0 : own('inwardHkd', isSelectedReturn) ?? (provider.withdrawalMethod === 'cheque' ? null : inwardFee(returning, balance * refs.USD / refs.HKD, 'broker'));
      add('returnInward', provider.withdrawalMethod === 'cheque' ? '收款银行USD支票处理费' : '券商→香港银行汇入费', returnInward == null ? null : returnInward * refs.HKD, 'withdraw');
      add('withdrawMiddle', '券商出金中转行费', provider.integratedBank || provider.withdrawalMethod === 'cheque' ? 0 : own('intermediaryCny', isSelectedReturn), 'withdraw');
      steps.returnUsd = balance;
      const returnMethod = method('returnMethod', returning.id === 'bochk' && exit.group === 'boc' ? 'bochk-fast' : ['hang', 'hsbc', 'sc'].includes(returning.id) && returning.group === exit.group ? 'linked' : 'swift');
      const returningFee = own('returnWireHkd', isSelectedReturn);
      const publishedReturnFee = returnFee(returning, exit, returnMethod, refs, config.date);
      if (returnMethod !== 'swift' && publishedReturnFee == null) return { error: '所选回款专用渠道与内地收款银行不匹配。' };
      add('returnWire', '香港→内地汇出费', returningFee == null ? publishedReturnFee : returningFee * refs.HKD, 'return');
      add('returnOther', '回内地中转／收款费', own('returnExtraCny', isSelectedReturn && config.exitBank === exit.id) ?? (returnMethod === 'linked' ? 0 : null), 'return');
      steps.remitUsd = balance;
      const exitPrice = config.exitBank === exit.id ? number(config.exitPrice) ?? exit.quotes.USD?.buy : exit.quotes.USD?.buy;
      const preSettle = balance;
      balance *= exitPrice; unit = 'CNY';
      const exitMid = positive(exit.quotes.USD?.sell) ? (exit.quotes.USD.buy + exit.quotes.USD.sell) / 2 : refs.USD;
      fxRow('exitFx', '内地结汇点差', preSettle * refs.USD - balance, preSettle * (exitMid - exitPrice), 'return');
      steps.settledCny = balance;
      const account = maintenance(bank, number(config.balanceHkd) ?? 0, number(config.months), own('monthlyHkd', isSelectedBank) ?? (bank.id === 'hsbc' && config.hsbcBalanceWaiver ? 0 : null));
      const returnAccount = bank.id === returning.id ? 0 : maintenance(returning, number(config.returnBalanceHkd) ?? 0, number(config.months), own('returnMonthlyHkd', isSelectedReturn));
      add('account', '香港账户月费', account == null || returnAccount == null ? null : (account + returnAccount) * refs.HKD, 'spend');
      add('extra', '开户及资产机会成本', extraCny, 'spend');
      if (!finite(balance) || balance < 0 || Object.values(steps).some(value => value < 0)) return { error: '资金不足以覆盖所选费用、亏损及税款。' };
      if (start.condition) requirements.push(start.condition);
      if (returnMethod === 'linked') requirements.push('回款须已登记' + returning.name + '两地同名专用转账');
      if (bank.thresholdHkd && account > 0) requirements.push(bank.name + '尚未确认免月费资格，已按标准月费计入');
      if (currency === 'CNH') requirements.push('人民币跨境汇款须符合实际用途及银行准入；不能套用香港居民安排');
      if (trading) requirements.push(...trading.warnings);
      if (provider.withdrawalMethod === 'cheque') requirements.push('致富USD出金需已登记美元银行账户；遥距开户限制可能须到分行解除');
      const unpriced = rows.filter(row => row.cny == null);
      const costCny = rows.reduce((sum, row) => sum + (row.cny ?? 0), 0);
      const fxImpactCny = rows.reduce((sum, row) => sum + (row.fxImpactCny ?? 0), 0);
      const fxKeys = ['entryFx', 'brokerSpread', 'exitFx'];
      const fxCny = rows.filter(row => fxKeys.includes(row.key)).reduce((sum, row) => sum + (row.cny ?? 0), 0);
      const sourceFresh = currency === 'CNH' || own('startSell', isSelectedStart) != null || quoteFresh(q, config.date);
      const exitFresh = (config.exitBank === exit.id && number(config.exitPrice) != null) || quoteFresh(exit.quotes.USD, config.date);
      const marketFresh = currency === 'USD' || number(config.entryPrice) != null || quoteFresh(offshore[currency], config.date);
      if (!sourceFresh) missing.push(start.name + '购汇牌价超过3天');
      if (!exitFresh) missing.push(exit.name + '结汇牌价超过3天');
      if (!marketFresh) missing.push('香港换汇参考牌价超过3天');
      const referenceFresh = number(config.usdCny) != null || quoteFresh(refRow, config.date);
      if (!referenceFresh) missing.push('USD/CNY参照牌价超过3天');
      return { budgetCny: budget, origin: 'mainland', permission, currency: 'CNY', route, start, bank, returning, exit, exitBank: exit.id, broker: provider, trading,
        mainlandMethod, depositMethod, fxMode, returnMethod, startSell: quote, entryPrice, exitPrice,
        entryAsOf: currency === 'CNH' ? null : q?.asOf, exitAsOf: exit.quotes.USD?.asOf, fxAsOf: currency === 'USD' ? null : offshore[currency]?.asOf,
        sourceAmount: budget, investUsd: steps.investUsd, proceeds: steps.proceedsUsd, bankUsd: steps.returnUsd,
        net: balance, taxCny, taxableCny, estimatedTax: number(config.taxableCny) == null, rows, steps,
        missing: [...new Set(missing)], complete: !missing.length, requirements: [...new Set(requirements)],
        refs, costCny, fxCny, fxImpactCny, explicitCny: costCny - fxCny, extraCny, brokerFx: brokerFxResult,
        rankable: sourceFresh && exitFresh && marketFresh && referenceFresh && !unknownSender && !unpriced.some(row => ['depositBank', 'entryInward', 'returnInward', 'returnWire', 'account'].includes(row.key)) };
    }
    const plans = [], errors = [];
    for (const start of mainland) for (const bank of data.hkBanks) for (const route of ['USD', 'HKD', 'CNH']) {
      if (broker.integratedBank && bank.id !== broker.integratedBank) continue;
      if (route === 'CNH' && !(['hang', 'hsbc', 'sc', 'abc', 'boc'].includes(start.id))) continue;
      const returning = data.hkBanks.find(row => row.id === (broker.integratedBank || config.returnBank)) || bank;
      const modes = route === 'USD' ? ['manual'] : [...(broker.id === 'ibkr' ? ['manual', 'auto'] : []), ...(bank.id === 'bochk' && offshore[route] ? ['bank'] : [])];
      for (const fxMode of modes) for (const exit of fresh) {
        const r = calculate(start, bank, route, fxMode, exit, returning, {
          mainlandMethod: '', depositMethod: route === 'USD' || fxMode === 'bank' ? 'chats' : 'fps', returnMethod: '' });
        if (!r.error) plans.push(r); else errors.push(r.error);
      }
    }
    const rankable = plans.filter(row => row.rankable).sort((a, b) => b.net - a.net);
    const practical = rankable.filter(row => row.route === 'USD' && !row.start.required && row.rows.find(fee => fee.key === 'account')?.cny === 0 && !row.bank.outwardChanges?.some(change => change.from > config.date));
    const recommended = practical[0], minimum = rankable[0];
    const automatic = config.plan === 'minimum' ? minimum : recommended || minimum;
    // Missing automatic recommendations must not disable a customer's own
    // confirmed quotes. Stale references remain dated and explicitly warned.
    const fallback = automatic || { start: mainland[0], bank: data.hkBanks.find(row => row.id === (broker.integratedBank || 'hang')) || data.hkBanks[0], exit: fresh[0] || mainland[0], route: 'USD', fxMode: 'manual' };
    const start = mainland.find(row => row.id === config.startBank) || fallback.start;
    const bank = data.hkBanks.find(row => row.id === (broker.integratedBank || config.bank)) || fallback.bank;
    const returning = data.hkBanks.find(row => row.id === (broker.integratedBank || config.returnBank)) || bank;
    const exit = mainland.find(row => row.id === config.exitBank) || fallback.exit;
    const route = config.route || fallback.route;
    const fxMode = config.fxMode || (route === fallback.route ? fallback.fxMode : 'manual');
    const selected = calculate(start, bank, route, fxMode, exit, returning);
    // Counterfactuals vary one step and preserve the rest of the selected route.
    const alternatives = {
      start: mainland.map(row => ({ start: row, ...calculate(row, bank, route, fxMode, exit, returning, { mainlandMethod: row.id === start.id ? selected.mainlandMethod : ['hang', 'hsbc', 'sc'].includes(row.id) && row.group === bank.group ? 'linked' : 'swift' }) })),
      bank: data.hkBanks.map(row => ({ bank: row, ...calculate(start, row, route, fxMode, exit, returning, { mainlandMethod: row.id === bank.id ? selected.mainlandMethod : '', depositMethod: row.id === bank.id ? selected.depositMethod : route === 'USD' || fxMode === 'bank' ? 'chats' : 'fps' }) })),
      route: ['USD', 'HKD', 'CNH'].map(value => {
        const mode = value === 'USD' ? 'manual' : broker.id !== 'ibkr' ? 'bank' : route === 'USD' ? 'manual' : fxMode;
        const methods = value === 'USD' || mode === 'bank' ? ['chats', 'swift'] : ['fps', 'edda', 'swift'];
        const deposit = methods.includes(selected.depositMethod) ? selected.depositMethod : methods[0];
        const entry = selected.mainlandMethod === 'full' && value !== 'USD' ? 'swift' : selected.mainlandMethod;
        return { route: value, ...calculate(start, bank, value, mode, exit, returning, { mainlandMethod: entry, depositMethod: deposit }) };
      }),
      broker: (data.brokers || [broker]).map(provider => {
        const entryBank = provider.integratedBank ? data.hkBanks.find(row => row.id === provider.integratedBank) : bank;
        const returnBank = provider.integratedBank ? entryBank : returning;
        const mode = route !== 'USD' && provider.id !== 'ibkr' ? 'bank' : fxMode;
        return { broker: provider, ...calculate(start, entryBank, route, mode, exit, returnBank, { mainlandMethod: '', depositMethod: '', returnMethod: '' }, provider) };
      })
    };
    return { permission, origin: 'mainland', selected: selected.error ? undefined : selected, error: selected.error,
      selection: { start, bank, returning, exit, route, fxMode, broker }, recommended, minimum, plans: rankable, alternatives, mainland, refs, extraCny };
  }
  // Compare complete, same-bank round trips. A public mid quote is a scenario
  // reference, never an executable IBKR quote. CNH and mainland CNY have
  // separate units and cannot share a bank bid/ask row.
  function journeyPlans(config, data, quotes) {
    if (config.currency === 'CNY') return mainlandJourney(config, data, quotes);
    const budget = number(config.budgetCny), currency = config.currency;
    if (!positive(budget) || !['USD', 'CNH', 'HKD'].includes(currency)) return { error: '请输入正数金额。', plans: [] };
    if (['usdCny', 'usdHkd', 'usdCnh', 'entryPrice', 'exitPrice'].some(key => config[key] != null && String(config[key]).trim() !== '' && !positive(number(config[key])))) return { error: '汇率须为有效正数；留空使用自动参考价。', plans: [] };
    const mainland = Object.entries(quotes.banks || {}).flatMap(([id, bank]) => {
      const row = bank.quotes?.USD;
      return row && positive(row.buy) && positive(row.sell) && row.buy <= row.sell ? [{ id, ...row }] : [];
    });
    if (!mainland.length) return { error: '缺少内地银行USD现汇买入牌价。', plans: [] };
    const offshore = quotes.offshoreUsd?.bochk?.quotes || {};
    const chosenExit = mainland.find(row => row.id === config.exitBank);
    const exit = chosenExit || [...mainland].sort((a, b) => b.buy - a.buy)[0];
    const refRow = mainland.find(row => row.id === 'boc') || mainland[0];
    const cnyMid = (refRow.buy + refRow.sell) / 2;
    const midpoint = key => offshore[key] && positive(offshore[key].bidPerUsd) && positive(offshore[key].askPerUsd) && offshore[key].bidPerUsd <= offshore[key].askPerUsd ? (offshore[key].bidPerUsd + offshore[key].askPerUsd) / 2 : null;
    const refs = reference({ usdCny: number(config.usdCny) ?? cnyMid, usdHkd: number(config.usdHkd) ?? midpoint('HKD'), usdCnh: number(config.usdCnh) ?? midpoint('CNH') });
    if (!refs) return { error: '缺少USD/HKD或USD/CNH参考汇率。', plans: [] };
    const sourceAmount = budget / refs[currency];
    const entryPrice = number(config.entryPrice) ?? (currency === 'USD' ? 1 : refs.USD / refs[currency]);
    const exitPrice = number(config.exitPrice) ?? exit.buy;
    const profit = number(config.profitUsd);
    if (!finite(profit)) return { error: '请输入有效卖出盈亏。', plans: [] };
    if (invalidOptional(config, ['taxableCny', 'openingCny', 'extraCapitalCny', 'annualGapPct', 'depositHkd', 'inwardHkd', 'returnWireHkd', 'monthlyHkd']) || !knownFee(number(config.months))) return { error: '应税所得、银行费用、开户支出、保留资产和使用月数须为非负数。', plans: [] };
    const taxableCny = number(config.taxableCny) ?? Math.max(0, (profit - (number(config.tradeFeeUsd) ?? 0)) * refs.USD);
    const inputs = { ...config, amount: sourceAmount, currency, origin: 'offshore', brokerApproved: true,
      usdCny: refs.USD, usdHkd: refs.USD / refs.HKD, usdCnh: refs.USD / refs.CNH,
      entryPrice, exitPrice, profitUsd: profit, taxableCny, spend: 'CNY' };
    const extraCny = (number(config.openingCny) ?? 0) + opportunityCost(number(config.extraCapitalCny) ?? 0, number(config.annualGapPct) ?? 0, number(config.months));
    const errors = [];
    const plans = data.hkBanks.flatMap(bank => {
      const modes = currency === 'USD' ? ['manual'] : ['manual', 'auto', ...(bank.id === 'bochk' && positive(offshore[currency]?.askPerUsd) ? ['bank'] : [])];
      const rows = modes.map(mode => {
        // Customer-specific fee overrides apply only to the explicitly chosen
        // bank. They must not silently waive competing banks' public tariffs.
        const bankInputs = { ...inputs, fxMode: mode };
        if (config.bank !== bank.id) for (const key of ['depositHkd', 'inwardHkd', 'returnWireHkd', 'monthlyHkd']) delete bankInputs[key];
        if (mode === 'bank') bankInputs.entryPrice = offshore[currency].askPerUsd;
        const result = offshoreTransfer(bankInputs, bank, data.broker);
        if (result.error) { errors.push(result.error); return null; }
        const net = result.net - extraCny;
        if (net < 0) { errors.push('预算不足以支付开户与资产机会成本。'); return null; }
        return { ...result, net, costCny: result.costCny + extraCny, extraCny, bank, fxMode: mode, sourceAmount,
          entryPrice: bankInputs.entryPrice, exitPrice, exitBank: exit.id, exitAsOf: exit.asOf,
          taxableCny, estimatedTax: number(config.taxableCny) == null, budgetCny: budget };
      }).filter(Boolean).sort((a, b) => b.net - a.net);
      return rows.slice(0, 1);
    }).sort((a, b) => b.net - a.net);
    if (!plans.length) return { error: errors[0] || '当前条件无法完成测算。', plans: [] };
    // Avoid a short-lived SWIFT promotion in the default long-term route.
    // Priority accounts with maintenance capital are not required by default.
    const stable = plans.filter(row => !row.bank.outwardChanges?.some(change => change.from > config.date) && row.bank.monthlyHkd === 0);
    const recommended = stable[0] || plans[0];
    const selected = plans.find(row => row.bank.id === config.bank) || (config.plan === 'minimum' ? plans[0] : recommended);
    return { selected, recommended, minimum: plans[0], plans, refs, sourceAmount, exit, mainland, extraCny };
  }
  return { number, reference, fee, remitPrincipal, inwardFee, outwardFee, maintenance, legalPath, eligible, opportunityCost, fxRoundTripLoss, mainlandTransfer, brokerFx, taxReserve, offshoreTransfer, consumption, journeyPlans, mainlandJourney, depositFee, returnFee, quoteFresh, selectedBroker, cappedCharge, brokerTradingFees };
}));
