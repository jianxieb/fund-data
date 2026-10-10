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
  // Regional schedules are evidence, but not a single executable quote.
  // Keep both inclusive-budget endpoints; never silently pick the cheapest.
  function senderFeeRange(bank, budgetCny, count, used, date, currency) {
    const range = bank?.tariffRange;
    if (!range?.currencies.includes(currency) || !positive(budgetCny) || !Number.isInteger(count) || count < 1 ||
      (range.validFrom && date < range.validFrom) || (range.validUntil && date > range.validUntil)) return null;
    const bounds = [range.lower, range.upper].map(tariff => {
      let total = 0;
      for (let i = 0; i < count; i++) {
        const solved = remitPrincipal(budgetCny / count, tariff, used + i + 1, date);
        if (!solved) return null;
        total += solved.fee;
      }
      return total;
    });
    return bounds.every(knownFee) ? bounds : null;
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
  function quotedMainlandBanks(data, quotes, date) {
    return data.mainlandBanks.map(bank => {
      const discount = bank.fxSpreadDiscount && date >= bank.fxValidFrom && date <= bank.fxValidUntil ? bank.fxSpreadDiscount : 1;
      const prices = Object.fromEntries(Object.entries(quotes.banks?.[bank.id]?.quotes || {}).map(([currency, q]) => {
        if (discount === 1 || !positive(q.buy) || !positive(q.sell) || q.buy > q.sell) return [currency, { ...q }];
        const mid = (q.buy + q.sell) / 2;
        return [currency, { ...q, publishedBuy: q.buy, publishedSell: q.sell,
          buy: mid - (mid - q.buy) * discount, sell: mid + (q.sell - mid) * discount, spreadDiscount: discount }];
      }));
      return { ...bank, quotes: prices };
    });
  }
  function purchaseComparison(config, data, quotes) {
    const currency = config.route || 'USD';
    if (currency === 'CNH') return { currency, rows: [], best: null };
    const rows = quotedMainlandBanks(data, quotes, config.date).map(bank => {
      const quote = bank.quotes[currency];
      const override = bank.id === config.startBank ? number(config.startSell) : null;
      const sell = override ?? quote?.sell;
      return { bank, quote, sell, custom: positive(override), comparable: positive(sell) && (positive(override) || quoteFresh(quote, config.date)) };
    });
    const best = rows.filter(row => row.comparable).sort((a, b) => a.sell - b.sell)[0] || null;
    for (const row of rows) row.lossRate = row.comparable && best ? Math.max(0, 1 - best.sell / row.sell) : null;
    return { currency, rows, best };
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
  // Personal local USD CHATS receiving tariffs. Do not reuse SWIFT inward fees.
  function localUsdInward(bank) { return ['bochk', 'za', 'hsbc', 'hang', 'sc'].includes(bank?.id) ? 0 : null; }
  function localUsdTransfer(from, to, refs, date) {
    if (from.id === to.id) return 0;
    const sending = depositFee(from, 'chats', 'USD', refs, date), receiving = localUsdInward(to);
    return sending == null || receiving == null ? null : sending + receiving * refs.USD;
  }
  function returnFee(bank, mainland, method, refs, date) {
    if (method === 'bochk-fast') return bank.id === 'bochk' && mainland.group === 'boc' ? 0 : null;
    if (method === 'linked') return ['hang', 'hsbc', 'sc'].includes(bank.id) && bank.group === mainland.group ? 0 : null;
    // BOCHK's personal same-name waiver also covers online SWIFT to BOC,
    // provided the destination is identified by the required BIC/CNAPS code.
    if (method === 'swift' && bank.id === 'bochk' && mainland.group === 'boc') return 0;
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
  function voucherState(config) {
    const amount = number(config.voucherUsd) ?? 0, orders = number(config.voucherOrders) ?? 1;
    const expiry = config.voucherExpiry || '', scope = config.voucherScope || 'commission';
    const parsed = Date.parse(expiry), missing = [];
    if (!positive(amount)) missing.push('抵扣额度');
    if (!positive(orders) || !Number.isInteger(orders) || orders > 240) missing.push('可用订单数（1–240）');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== expiry) missing.push('有效截止日期');
    if (!['commission', 'platform', 'both'].includes(scope)) missing.push('适用费用');
    const pending = !!config.useVoucher && missing.length > 0;
    return { amount, orders, expiry, scope, ready: !!config.useVoucher && !pending, pending,
      message: pending ? '费用券待补充：' + missing.join('、') + '；暂按未抵扣计算。' : '' };
  }
  // Equal-size buy orders in the starting month and equal-size sell orders in
  // the final holding month are a fee benchmark, not a return simulation.
  // Buy-side charges fit inside available USD, including voucher allocation.
  function brokerTradingFees(config, broker, cashUsd, profitUsd, refs) {
    const buys = number(config.buyOrders) ?? 1, sells = number(config.sellOrders) ?? 1;
    const price = number(config.sharePriceUsd) ?? 100, months = number(config.months) ?? 1;
    if (![buys, sells].every(v => positive(v) && Number.isInteger(v) && v <= 120) || !positive(price) || !knownFee(months) || months > 1200) return { error: '交易笔数须为1–120整数，测算股价须为正数，使用月数不超过1200。' };
    const usedQuota = number(config.usedPromoOrders) ?? 0, usedTurnover = number(config.otherTurnoverHkd) ?? 0;
    const voucher = voucherState(config);
    if (!knownFee(usedQuota) || !Number.isInteger(usedQuota) || !knownFee(usedTurnover)) return { error: '优惠已用笔数须为非负整数，月成交额须为非负数。' };
    const date = config.date || '2026-10-09', heldMonths = Math.max(1, Math.ceil(months));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return { error: '测算日期无效。' };
    const sellDate = shiftedMonth(date, heldMonths - 1), sameMonth = date.slice(0, 7) === sellDate.slice(0, 7);
    const usmartDays = number(config.usmartDays) ?? 0;
    if (!knownFee(usmartDays) || !Number.isInteger(usmartDays)) return { error: '开户距今须为非负整数天。' };
    const centsUp = value => value > 0 ? Math.ceil((value - 1e-10) * 100) / 100 : 0;
    const promoDate = d => d >= '2026-04-20' && d <= '2026-12-31';
    const estimate = buyValue => {
      const shares = buyValue / price, saleValue = buyValue + profitUsd;
      let remainingVoucher = voucher.ready ? voucher.amount : 0, couponsUsed = 0;
      let turnover = usedTurnover, orderIndex = usedQuota;
      const orders = [];
      function side(kind, count, total, d) {
        if (kind === 'sell' && !sameMonth) { turnover = usedTurnover; orderIndex = usedQuota; }
        for (let i = 0; i < count; i++) {
          const value = total / count, qty = shares / count, stockPrice = value / qty;
          let commission = cappedCharge(broker.commission, qty, value), platform = cappedCharge(broker.platform, qty, value), offer = '';
          if (broker.id === 'hsbc') {
            // The entire first order crossing HKD250,000 is exempt (tariff appendix note 3).
            const chargedQty = config.trade25 && turnover <= 250000 ? 0 : qty;
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
          const voucherBase = voucher.scope === 'platform' ? platform : voucher.scope === 'both' ? commission + platform : commission;
          const discount = remainingVoucher > 0 && d <= voucher.expiry && couponsUsed < voucher.orders ? Math.min(remainingVoucher, voucherBase) : 0;
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
    // September 2026 US tariff explicitly waives Trade25 US monthly fees until further notice.
    const monthlyHkd = 0;
    const monthlyUsd = broker.id === 'hsbc' && !config.trade25 ? Array.from({ length: heldMonths }, (_, i) => shiftedMonth(date, i))
      .filter(d => d > '2026-12-31' && d.slice(0, 7) !== date.slice(0, 7) && d.slice(0, 7) !== sellDate.slice(0, 7)).length * 5 : 0;
    const override = number(config.tradeFeeUsd), warnings = [];
    if (broker.id === 'usmart' && config.usmartPromo && !orders.some(order => order.offer)) warnings.push('盈立0.99优惠未适用：须股价≥100 USD、合资格标的、开户180天内且在推广期');
    if (broker.id === 'chief' && config.chiefMonthly && date > '2026-12-31') warnings.push('致富2026年月供优惠已过期，按普通网上交易基准测算');
    if (voucher.pending) warnings.push(voucher.message);
    if (voucher.ready && voucher.expiry < date) warnings.push('费用券已过期，未抵扣。');
    return { investUsd: override == null ? low : cashUsd, buyFeeUsd, sellFeeUsd, orders, monthlyHkd, monthlyUsd, warnings, voucher,
      totalUsd: override ?? buyFeeUsd + sellFeeUsd, overridden: override != null,
      discountUsd: override == null ? orders.reduce((sum, row) => sum + row.discount, 0) : 0, price, buys, sells, sellDate };
  }
  function flowLedger(result) {
    if (!result?.steps || !result.refs) return null;
    const r = result, rates = r.refs;
    if (!finite(r.net)) {
      if (!finite(r.steps.hongKong)) return null;
      const grouped = r.rows.filter(row => ['sender', 'entryFx', 'entryMiddle', 'entryInward'].includes(row.key));
      const rows = grouped.flatMap(row => row.items?.length ? row.items.map(item => ({ ...item, key: row.key })) : [row]);
      const costCny = rows.reduce((sum, row) => sum + (row.cny ?? 0), 0), outputCny = r.steps.hongKong * rates[r.route];
      const missing = rows.filter(row => row.cny == null).map(row => row.label), coefficient = outputCny / r.budgetCny;
      return { rates, stops: [
        { id: 'start', account: r.start.name, currency: 'CNY', amount: r.budgetCny, valueCny: r.budgetCny, cumulativeLossCny: 0, missing: [] },
        { id: 'receiving', account: r.bank.name, currency: r.route, amount: r.steps.hongKong, valueCny: outputCny, cumulativeLossCny: r.budgetCny - outputCny, missing }
      ], legs: [{ from: 'start', to: 'receiving', rows, costCny, taxCny: 0, profitCny: 0, inputCny: r.budgetCny, outputCny,
        lossCny: r.budgetCny - outputCny, coefficient, lossRate: 1 - coefficient, missing,
        fxImpactCny: grouped.reduce((sum, row) => sum + (row.fxImpactCny || 0), 0) }] };
    }
    const keys = [
      ['sender', 'entryFx', 'entryMiddle', 'entryInward'],
      ['depositBank', 'depositBroker', 'depositOther', 'brokerFx', 'brokerSpread'],
      ['trade', 'brokerAccount'], ['withdraw', 'returnInward', 'withdrawMiddle'],
      ['returnWire', 'returnOther', 'exitFx', 'card'], ['account', 'extra']
    ];
    const stops = [
      { id: 'start', amount: r.budgetCny, currency: 'CNY', account: r.start.name },
      { id: 'receiving', amount: r.steps.hongKong, currency: r.route, account: r.bank.name },
      { id: 'funding', amount: r.steps.fundedUsd, currency: 'USD', account: r.broker.name },
      { id: 'sold', amount: r.steps.proceedsUsd - r.taxCny / rates.USD, currency: 'USD', account: r.broker.name },
      { id: 'return', amount: r.steps.returnUsd, currency: 'USD', account: r.returning.name },
      { id: 'settle', amount: r.steps.terminal ?? r.steps.settledCny, currency: r.currency || 'CNY', account: r.outcome && r.outcome !== 'mainland' ? r.returning.name : r.exit.name },
      { id: 'destination', amount: r.net, currency: r.currency || 'CNY', account: r.outcome && r.outcome !== 'mainland' ? r.returning.name : r.exit.name }
    ];
    let cumulative = 0, tax = 0, impact = 0, investmentProfit = 0;
    const missing = [];
    stops[0] = { ...stops[0], valueCny: r.budgetCny, cumulativeCostCny: 0, cumulativeTaxCny: 0, cumulativeLossCny: 0, cumulativeImpactCny: 0, missing: [] };
    const legs = keys.map((list, i) => {
      const grouped = r.rows.filter(row => list.includes(row.key));
      const rows = grouped.flatMap(row => row.items?.length ? row.items.map(item => ({ ...item, key: row.key })) : [row]);
      const costCny = rows.reduce((sum, row) => sum + (row.cny ?? 0), 0);
      const taxCny = i === 2 ? r.taxCny : 0, profitCny = i === 2 ? (r.profitUsd || 0) * rates.USD : 0;
      const fxImpactCny = grouped.reduce((sum, row) => sum + (row.fxImpactCny ?? 0), 0);
      cumulative += costCny; tax += taxCny; impact += fxImpactCny; investmentProfit += profitCny;
      const inputCny = stops[i].amount * rates[stops[i].currency], outputCny = stops[i + 1].amount * rates[stops[i + 1].currency];
      const lossCny = inputCny + profitCny - outputCny;
      const legMissing = rows.filter(row => row.cny == null).map(row => row.label);
      if (i === 1 && r.indicativeFx && !grouped.some(row => row.key === 'brokerSpread' && row.cny == null)) legMissing.push(r.indicativeFx);
      missing.push(...legMissing);
      stops[i + 1] = { ...stops[i + 1], valueCny: outputCny, indicative: i >= 1 && !!r.indicativeFx, cumulativeCostCny: cumulative, cumulativeTaxCny: tax,
        cumulativeLossCny: r.budgetCny + investmentProfit - outputCny, cumulativeImpactCny: impact, missing: [...missing] };
      // Both sides are valued at the SAME reference vector. Subtract scenario
      // profit before measuring channel retention; never divide USD by CNY.
      const coefficient = inputCny > 0 ? (outputCny - profitCny) / inputCny : null;
      return { from: stops[i].id, to: stops[i + 1].id, rows, costCny, taxCny, profitCny, fxImpactCny, lossCny, inputCny, outputCny,
        coefficient, indicative: i >= 1 && !!r.indicativeFx, lossRate: coefficient == null ? null : 1 - coefficient, missing: legMissing };
    });
    return { stops, legs, rates, lossCny: r.budgetCny + (r.profitUsd || 0) * rates.USD - (r.netCny ?? r.net) };
  }
  const routeKeys = ['startBank', 'bank', 'returnBank', 'exitBank', 'route', 'broker', 'fxMode', 'mainlandMethod', 'depositMethod', 'returnMethod'];
  function diagramLedger(result) {
    const ledger = flowLedger(result);
    if (!ledger || ledger.legs.length !== 6) return ledger;
    // The audit retains pre-budget settlement; the public diagram presents
    // the spendable CNY once, after all account and additional costs.
    const a = ledger.legs[4], b = ledger.legs[5], coefficient = b.outputCny / a.inputCny;
    const closing = { ...a, to: b.to, rows: [...a.rows, ...b.rows], outputCny: b.outputCny,
      costCny: a.costCny + b.costCny, taxCny: a.taxCny + b.taxCny, fxImpactCny: a.fxImpactCny + b.fxImpactCny,
      lossCny: a.inputCny - b.outputCny, coefficient, lossRate: 1 - coefficient, missing: [...a.missing, ...b.missing] };
    return { ...ledger, stops: [...ledger.stops.slice(0, 5), ledger.stops[6]], legs: [...ledger.legs.slice(0, 4), closing] };
  }
  function comparisonMetric(item, key, scope = 'comparison') {
    // Selectors inside a diagram leg describe that leg, not the broader
    // counterfactual range used in the comparison table below the diagram.
    if (scope === 'step') return diagramLedger(item)?.legs[{ start: 0, bank: 0, returnBank: 3, exit: 4 }[key]] || null;
    const range = { start: [0, 1], bank: [0, 2], route: [0, 2], broker: [1, 4], returnBank: [3, 5], exit: [4, 5] }[key];
    const ledger = flowLedger(item);
    if (!range || !ledger?.stops[range[1]]) return null;
    const legs = ledger.legs.slice(...range), inputCny = ledger.stops[range[0]].valueCny, outputCny = ledger.stops[range[1]].valueCny;
    const sum = key => legs.reduce((total, leg) => total + leg[key], 0);
    const missing = [...new Set(legs.flatMap(leg => leg.missing))], indicative = legs.some(leg => leg.indicative);
    if (indicative && item.indicativeFx && !missing.includes(item.indicativeFx)) missing.push(item.indicativeFx);
    const complete = !missing.length && !indicative;
    // A fee subtotal remains useful, but an incomplete route must not look
    // cheaper because its unquoted charges were omitted from the arithmetic.
    const lossCny = complete ? inputCny + sum('profitCny') - outputCny : null;
    return { inputCny, outputCny, lossCny, lossRate: lossCny != null && inputCny > 0 ? lossCny / inputCny : null,
      costCny: sum('costCny'), taxCny: sum('taxCny'), fxImpactCny: sum('fxImpactCny'),
      rows: legs.flatMap(leg => leg.rows), complete, indicative, missing };
  }
  const bankQuoteKeys = ['senderFeeCny', 'entryMiddleCny', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'returnMonthlyHkd', 'startSell', 'entryPrice', 'exitPrice'];
  let mainlandPlanCache;
  function routeConfiguration(r) {
    return { startBank: r.start.id, bank: r.bank.id, returnBank: r.returning.id, exitBank: r.exit.id, route: r.route, broker: r.broker.id,
      fxMode: r.fxMode, mainlandMethod: r.mainlandMethod, depositMethod: r.depositMethod, returnMethod: r.returnMethod };
  }
  function applyRoute(config, route, id = 'custom') {
    // A route card replaces every routing choice and customer-specific quote.
    // General budget, duration, eligibility and trade assumptions survive.
    return { ...config, ...Object.fromEntries(bankQuoteKeys.map(key => [key, ''])), ...routeConfiguration(route),
      balanceHkd: '0', returnBalanceHkd: '0', tradeFeeUsd: '', useVoucher: false, voucherUsd: '0', voucherExpiry: '', voucherOrders: '1',
      voucherScope: ['chief', 'usmart', 'za'].includes(route.broker.id) ? 'platform' : 'commission', plan: id };
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
    const mainland = quotedMainlandBanks(data, quotes, config.date);
    const fresh = mainland.filter(bank => positive(bank.quotes.USD?.buy) && positive(bank.quotes.USD?.sell) && quoteFresh(bank.quotes.USD, config.date));
    const refRow = fresh.find(bank => bank.id === 'boc')?.quotes.USD || fresh[0]?.quotes.USD || mainland.find(bank => positive(bank.quotes.USD?.buy) && positive(bank.quotes.USD?.sell))?.quotes.USD;
    const offshore = quotes.offshoreUsd?.bochk?.quotes || {};
    const mid = currency => positive(offshore[currency]?.bidPerUsd) && positive(offshore[currency]?.askPerUsd) ? (offshore[currency].bidPerUsd + offshore[currency].askPerUsd) / 2 : null;
    const relativeBasis = config.pricingBasis === 'best-quote';
    const comparisonData = { ...data, mainlandBanks: data.mainlandBanks.filter(bank => !data.calculator || data.calculator.mainland.includes(bank.id)) };
    const benchmarks = relativeBasis ? Object.fromEntries(['USD', 'HKD'].map(route => [route,
      purchaseComparison({ ...config, route, startSell: route === config.route ? config.startSell : '' }, comparisonData, quotes).best])) : {};
    const usdReference = relativeBasis && benchmarks.USD ? benchmarks.USD.sell : refRow ? (refRow.buy + refRow.sell) / 2 : null;
    const refs = reference({ usdCny: number(config.usdCny) ?? usdReference,
      usdHkd: number(config.usdHkd) ?? (relativeBasis && benchmarks.HKD ? usdReference / benchmarks.HKD.sell : mid('HKD')),
      usdCnh: number(config.usdCnh) ?? mid('CNH') });
    if (!refs) return empty('缺少有效的USD/CNY、USD/HKD或USD/CNH参考牌价。');
    const extraCny = (number(config.openingCny) ?? 0) + opportunityCost(number(config.extraCapitalCny) ?? 0, number(config.annualGapPct) ?? 0, number(config.months));
    const broker = selectedBroker(config, data), autoTrade = !!config.broker, tradingCache = new Map(), senderCache = new Map();
    function calculate(start, bank, route, fxMode, exit, returning, selections = {}, provider = broker) {
      const settlementBank = data.hkBanks.find(row => row.id === provider.integratedBank);
      const internalDeposit = !!settlementBank && bank.id === settlementBank.id ||
        config.depositMethod === 'internal' && provider.internalFundingBanks?.includes(bank.id);
      const outcome = config.outcome || 'mainland', keepInBroker = outcome === 'broker-balance';
      if (route !== 'USD' && provider.id !== 'ibkr' && fxMode !== 'bank') return { error: provider.name + '换汇成交价未公开；请选香港银行先换USD，或内地直接换USD。' };
      const currency = route, sameGroup = start.group === bank.group;
      const isSelectedStart = config.startBank === start.id, isSelectedBank = config.bank === bank.id;
      const isSelectedReturn = (config.returnBank || config.bank) === returning.id;
      const own = (key, selected) => selected && !selections.public ? number(config[key]) : null;
      const account = maintenance(bank, own('balanceHkd', isSelectedBank) ?? 0, number(config.months), own('monthlyHkd', isSelectedBank) ?? (bank.id === 'hsbc' && config.hsbcBalanceWaiver ? 0 : null));
      const returnAccount = keepInBroker || bank.id === returning.id ? 0 : maintenance(returning, own('returnBalanceHkd', isSelectedReturn) ?? 0, number(config.months), own('returnMonthlyHkd', isSelectedReturn) ?? (returning.id === 'hsbc' && config.hsbcBalanceWaiver ? 0 : null));
      const settlementAccount = settlementBank && ![bank.id, ...(keepInBroker ? [] : [returning.id])].includes(settlementBank.id) ? maintenance(settlementBank, 0, number(config.months), settlementBank.id === 'hsbc' && config.hsbcBalanceWaiver ? 0 : null) : 0;
      const accountCny = account == null || returnAccount == null || settlementAccount == null ? null : (account + returnAccount + settlementAccount) * refs.HKD;
      const accountItems = [{ label: bank.name + '期间管理费', cny: account == null ? null : account * refs.HKD }, ...(keepInBroker || bank.id === returning.id ? [] : [{ label: returning.name + '期间管理费', cny: returnAccount == null ? null : returnAccount * refs.HKD }])];
      if (settlementBank && ![bank.id, ...(keepInBroker ? [] : [returning.id])].includes(settlementBank.id)) accountItems.push({ label: settlementBank.name + '期间管理费', cny: settlementAccount == null ? null : settlementAccount * refs.HKD });
      accountItems.forEach(item => { item.months = number(config.months); item.monthlyHkd = item.cny == null ? null : item.cny / refs.HKD / (number(config.months) || 1); });
      const q = start.quotes[currency], quote = currency === 'CNH' ? 1 : own('startSell', isSelectedStart) ?? q?.sell;
      const missingSourceQuote = !positive(quote);
      const linked = ['hang', 'hsbc', 'sc'].includes(start.id);
      const method = (key, fallback) => (Object.hasOwn(selections, key) ? selections[key] : config[key]) || fallback;
      const bocMobilePair = start.id === 'boc' && bank.id === 'bochk' && currency !== 'CNH';
      const mainlandMethod = method('mainlandMethod', linked && sameGroup ? 'linked' : 'swift');
      const bocMobile = mainlandMethod === 'boc-mobile';
      const paymentConnect = mainlandMethod === 'payment-connect';
      const swiftGo = mainlandMethod === 'cib-go';
      if (swiftGo && (start.id !== 'cib' || !['USD', 'HKD'].includes(currency))) return { error: 'SWIFT GO仅收录兴业寰宇人生的USD/HKD全额到账服务。' };
      if (bocMobile && !bocMobilePair) return { error: '中行手机银行向境外中行渠道须选择中国银行→同名中银香港，使用USD或HKD；人民币支付通是另一渠道。' };
      if (paymentConnect && !(start.id === 'boc' && bank.id === 'bochk' && currency === 'CNH')) return { error: '此跨境支付通测算仅收录中国银行→中银香港、人民币原币到账；其他银行及币种须另核。' };
      if (mainlandMethod === 'linked' && !(linked && sameGroup)) return { error: '两地同名专用渠道须选择同一银行集团的香港账户。' };
      if (mainlandMethod === 'full' && !(currency === 'USD' && knownFee(start.fullAmountUsd))) return { error: '所选银行未收录USD全额到账收费，请改用普通汇款。' };
      const isSelectedEntry = isSelectedStart && isSelectedBank && (!config.route || config.route === currency) && (!config.mainlandMethod || config.mainlandMethod === mainlandMethod);
      const senderOverride = own('senderFeeCny', isSelectedEntry);
      // Standard wire prices and the 2026 reported mobile waiver are separate
      // scenarios. Public reporting does not establish a nationwide guarantee.
      const reportedMobile = bocMobile && !!data.bocMobileEvidence;
      const effectiveSender = senderOverride ?? (reportedMobile ? data.bocMobileEvidence.feeCny + data.bocMobileEvidence.telegramCny : null);
      const standardTariff = mainlandMethod === 'swift' && start.standardTariff;
      const senderBank = standardTariff ? { ...start, ...standardTariff } : start;
      const unknownSender = effectiveSender == null && (bocMobile || paymentConnect || fee(senderBank, 0, used + 1, config.date) == null || (linked && mainlandMethod !== 'linked' && !standardTariff) || (currency === 'CNH' && !sameGroup && !senderBank.cnhTariff && start.id !== 'abc'));
      if (missingSourceQuote && mainlandMethod === 'full') return { error: start.name + '的' + currency + '现汇卖出价尚未取得；到账金额暂不可算。', missingQuote: currency };
      const fullFee = swiftGo ? start.swiftGoCny : mainlandMethod === 'full' ? start.fullAmountUsd * quote : 0;
      let principal = 0, sender = 0, commission = 0, telegram = 0;
      const senderKey = [start.id, quote, mainlandMethod, senderOverride, unknownSender].join(':');
      const cachedSender = senderCache.get(senderKey);
      if (cachedSender) ({ principal, sender, commission, telegram } = cachedSender);
      else {
      for (let i = 0; i < count; i++) {
        const solved = remitPrincipal(budget / count, senderBank, used + i + 1, config.date, unknownSender ? 0 : effectiveSender == null ? null : effectiveSender + fullFee);
        if (!solved) return { error: '预算不足以支付汇出费，或所选优惠不在有效期内。' };
        // Full-amount service is an extra per-transfer charge, not a second
        // percentage commission. Include it in the budget equation.
        const fullSolved = fullFee && senderOverride == null ? remitPrincipal(budget / count - fullFee, start, used + i + 1, config.date, null) : null;
        if (fullFee && senderOverride == null && !fullSolved) return { error: '预算不足以支付全额到账服务费。' };
        principal += fullSolved ? fullSolved.principal : solved.principal;
        sender += fullSolved ? fullSolved.fee + fullFee : solved.fee;
        if (!unknownSender && effectiveSender == null) {
          commission += Math.min(senderBank.maximum, Math.max(senderBank.minimum, (fullSolved || solved).principal * senderBank.rate));
          telegram += senderBank.freeTelegram && used + i + 1 <= senderBank.freeTelegram ? 0 : senderBank.telegram;
        }
      }
      senderCache.set(senderKey, { principal, sender, commission, telegram });
      }
      // A priced full-amount service has a per-payment limit. Never silently
      // switch to an ordinary wire or split a customer's payment to fit it.
      if (swiftGo && !missingSourceQuote) {
        if (currency !== 'USD' && (!positive(start.quotes.USD?.buy) || !quoteFresh(start.quotes.USD, config.date))) return { error: '兴业USD牌价缺失或超过3天，无法校验SWIFT GO港币单笔上限。' };
        const usdEquivalent = currency === 'USD' ? principal / quote / count : principal / count / start.quotes.USD.buy;
        if (usdEquivalent > start.swiftGoLimitUsd + 1e-8) return { error: 'SWIFT GO单笔上限为等值10,000 USD；当前每笔约' + usdEquivalent.toFixed(2) + ' USD，超出服务范围。' };
      }
      const rows = [], missing = [], requirements = [], steps = {};
      let balance = missingSourceQuote ? null : principal / quote, unit = currency;
      const add = (key, label, cny, step, reason = label) => {
        rows.push({ key, label, cny, step });
        if (cny == null) missing.push(reason); else balance -= cny / refs[unit];
      };
      // Bank spreads are costs; differences between currencies, banks and
      // observation times are valuation effects. Neither is charged again.
      const fxRow = (key, label, referenceDifference, spreadCost, step) => {
        // The product uses one benchmark for both percentages and cash amounts.
        // A favourable cross-rate is a signed gain, never a hidden balancing item.
        const cny = relativeBasis ? referenceDifference : Math.max(0, spreadCost);
        rows.push({ key, label, cny, step, fxImpactCny: cny - referenceDifference });
      };
      const crossLegs = (item, market, sourceAmount, buyingUsd, deferred = 0) => {
        if (market?.path !== 'via-HKD' || !market.legs) return;
        const { usdBuy, usdSell, cnhBuy, cnhSell } = market.legs;
        const hkd = sourceAmount * (buyingUsd ? cnhBuy : usdBuy);
        const target = hkd / (buyingUsd ? usdSell : cnhSell);
        const sourceCurrency = buyingUsd ? 'CNH' : 'USD', targetCurrency = buyingUsd ? 'USD' : 'CNH';
        item.path = [sourceCurrency, 'HKD', targetCurrency];
        item.exchanges = [
          { from: sourceCurrency, to: 'HKD', input: sourceAmount, output: hkd, rate: buyingUsd ? cnhBuy : usdBuy },
          { from: 'HKD', to: targetCurrency, input: hkd, output: target, rate: 1 / (buyingUsd ? usdSell : cnhSell) }
        ];
        // In the product's common-reference ledger each real exchange keeps
        // its own signed difference; the two amounts exactly sum to the row.
        if (relativeBasis) {
          const firstCny = sourceAmount * refs[sourceCurrency] - hkd * refs.HKD + deferred;
          item.items = [
            { label: sourceCurrency + ' → HKD换汇差额', cny: firstCny },
            { label: 'HKD → ' + targetCurrency + '换汇差额', cny: item.cny - firstCny }
          ];
        }
      };
      rows.push({ key: 'sender', label: '内地汇出手续费＋电讯费' + (fullFee ? '＋全额到账费' : ''), cny: unknownSender ? null : sender, step: 'entry' });
      if (reportedMobile && senderOverride == null) rows[0].evidence = '2026公开报道 · 双免情景';
      const senderLabel = bocMobile ? '中行手机银行向境外中行·现行' : start.name;
      rows[0].items = unknownSender ? [{ label: senderLabel + '汇出手续费', cny: null }, { label: senderLabel + '电讯费', cny: null }] :
        senderOverride == null ? [{ label: '汇出手续费', cny: commission, evidence: reportedMobile ? '2026公开报道' : '' }, { label: '汇出电讯费', cny: telegram, evidence: reportedMobile ? '2026公开报道' : '' }] : [{ label: '本人报价：汇出手续费及电讯费', cny: senderOverride * count }];
      if (fullFee) rows[0].items.push({ label: swiftGo ? 'SWIFT GO全额到账 · 50 CNY/笔' : '全额到账附加费 · ' + (start.fullAmountUsd * count) + ' USD', cny: fullFee * count });
      if (paymentConnect) Object.assign(rows[0], { label: '跨境支付通汇出服务费', items: [{ label: senderOverride == null ? '跨境支付通本次汇出服务费' : '本人报价：跨境支付通汇出服务费', cny: senderOverride == null ? null : senderOverride * count }] });
      if (unknownSender) {
        const rangeCny = mainlandMethod === 'swift' ? senderFeeRange(start, budget, count, used, config.date, currency) : null;
        const status = rangeCny ? '按地区定价' : bocMobile ? '2026优惠公告未查到' : paymentConnect ? '2026费率未查到' :
          currency === 'CNH' && !start.cnhTariff ? '人民币资费未收录' : '该渠道资费未收录';
        Object.assign(rows[0], { status, rangeCny });
        if (rangeCny) rows[0].items = [{ label: '汇出手续费＋电讯费（地区定价）', cny: null, rangeCny, status }];
        else rows[0].items.forEach(item => { if (item.cny == null) item.status = status; });
        missing.push(start.name + '所选渠道汇出收费');
      }
      const entryMiddle = paymentConnect ? 0 : own('entryMiddleCny', isSelectedEntry) ?? (reportedMobile ? data.bocMobileEvidence.intermediaryCny ?? null : mainlandMethod === 'linked' && start.includedIntermediary ? 0 : mainlandMethod === 'full' || swiftGo ? 0 : null);
      if (missingSourceQuote) {
        // Sender charges in CNY are independent of the unavailable FX quote.
        // Keep their real values without inventing a converted cash balance.
        const error = start.name + '的' + currency + '现汇卖出价尚未取得；到账金额暂不可算。';
        rows.push({ key: 'entryFx', label: '内地购汇差额', cny: null, step: 'entry', status: error });
        rows.push({ key: 'entryMiddle', label: '内地→香港中转行费', cny: entryMiddle == null ? null : entryMiddle * count, step: 'entry' });
        const knownInward = own('entryInwardHkd', isSelectedBank) ?? (swiftGo || bank.inwardHkd === 0 || bank.sameGroupWaiver && sameGroup ? 0 : null);
        rows.push({ key: 'entryInward', label: '香港首次汇入费', cny: knownInward == null ? null : knownInward * refs.HKD * count, step: 'entry',
          status: knownInward == null ? '须先确定外币到账额及适用汇入资费' : '' });
        rows.push({ key: 'account', label: '香港账户期间管理费', cny: accountCny, step: 'spend', items: accountItems });
        return { error, errorStage: '01', missingQuote: currency, rows, steps, route, mainlandMethod, fxMode,
          refs, budgetCny: budget, start, bank, returning, exit, broker: provider, quoteFreshness: { source: false } };
      }
      const entryMid = currency === 'CNH' ? 1 : positive(q?.buy) ? (q.buy + q.sell) / 2 : refs[currency];
      const deferredCnhBasis = relativeBasis && currency === 'CNH' ? principal - balance * refs.CNH : 0;
      fxRow('entryFx', currency === 'CNH' ? '人民币原币汇出（未换汇）' : relativeBasis ? '内地购汇差额' : '内地购汇点差',
        relativeBasis && currency === 'CNH' ? 0 : principal - balance * refs[currency], currency === 'CNH' ? 0 : principal - balance * entryMid, 'entry');
      steps.mainlandForeign = balance;
      add('entryMiddle', paymentConnect ? '跨境支付通直连（无SWIFT中转）' : '内地→香港中转行费', entryMiddle == null ? null : entryMiddle * count, 'entry');
      if (reportedMobile && own('entryMiddleCny', isSelectedEntry) == null && entryMiddle != null) rows[rows.length - 1].evidence = 'USD/HKD同行SHA路径 · 2026公开操作记录';
      const inward = own('entryInwardHkd', isSelectedBank) ?? (swiftGo ? 0 : inwardFee(bank, balance * refs[currency] / refs.HKD / count, start.group));
      add('entryInward', '香港首次汇入费', inward == null ? null : inward * refs.HKD * count, 'entry');
      steps.hongKong = balance;
      let trading = null, taxCny = 0;
      const downstreamError = (error, errorStage = '03') => ({ error, errorStage, rows: [...rows,
        { key: 'account', label: '香港账户期间管理费', cny: accountCny, step: 'spend', items: accountItems },
        { key: 'extra', label: '开户及资产机会成本', cny: extraCny, step: 'spend' }], steps, startSell: quote, route, mainlandMethod, fxMode, refs, budgetCny: budget, start, bank, returning, exit, broker: provider,
        trading: trading?.error ? null : trading, taxCny, indicativeFx: rows.find(x => x.key === 'brokerSpread' && x.cny == null)?.label || '',
        quoteFreshness: { source: currency === 'CNH' || own('startSell', isSelectedStart) != null || quoteFresh(q, config.date) } });
      const depositMethod = internalDeposit ? 'internal' : settlementBank ? 'chats' : method('depositMethod', currency === 'USD' || fxMode === 'bank' ? 'chats' : 'fps');
      const depositCurrency = fxMode === 'bank' ? 'USD' : currency;
      if (depositMethod === 'internal' && !internalDeposit) return downstreamError('同行入金须使用券商已公布的同银行收款账户；此组合可改选本地转账。');
      if (['fps', 'edda'].includes(depositMethod) && depositCurrency === 'USD') return downstreamError('FPS/eDDA不支持USD；美元入金请选本地美元转账或SWIFT。');
      if (provider.id === 'chief' && depositMethod === 'fps' && depositCurrency !== 'HKD') return downstreamError('致富FPS只接受港币；人民币入金请用同行转账或eDDA。');
      if (depositMethod === 'chats' && depositCurrency !== 'USD') return downstreamError('本地美元转账使用USD；HKD/CNH可选FPS或eDDA。');
      const bankFxQuote = quotes.offshoreUsd?.[bank.id]?.quotes?.[currency];
      const ownEntryPrice = own('entryPrice', isSelectedBank);
      const unquotedBankFx = currency !== 'USD' && fxMode === 'bank' && ownEntryPrice == null && !positive(bankFxQuote?.askPerUsd);
      // Retain known broker tariffs using the same reference scenario as IBKR.
      // A reference conversion is never an executable bank quote or a ranked route.
      const entryPrice = currency === 'USD' ? 1 : ownEntryPrice ?? (fxMode === 'bank' && !unquotedBankFx ? bankFxQuote?.askPerUsd : refs.USD / refs[currency]);
      if (!positive(entryPrice)) return downstreamError(bank.name + '缺少' + currency + '换USD的成交报价。');
      const transfer = () => {
        const charge = own('depositHkd', isSelectedBank);
        add('depositBank', internalDeposit ? settlementBank ? '本人银行账户内部交收' : bank.name + ' → ' + provider.name + '同银行收款账户' : bank.name + ' → ' + (settlementBank?.name || provider.name) + ' · ' + depositMethod.toUpperCase(), internalDeposit ? 0 : charge == null ? depositFee(bank, depositMethod, depositCurrency, refs, config.date) : charge * refs.HKD, 'deposit');
        add('depositBroker', provider.name + '入金费', knownFee(provider.depositUsd) ? provider.depositUsd * refs.USD : null, 'deposit');
        // Other banks' fees can exist even when the sending bank or IBKR
        // waives its own fee. FPS has no SWIFT correspondent-bank leg.
        const localInward = settlementBank ? localUsdInward(settlementBank) : null;
        add('depositOther', settlementBank ? settlementBank.name + ' · 本地USD收款' : '入金代理／收款行费', internalDeposit ? 0 : settlementBank ? localInward == null ? null : localInward * refs.USD : own('depositOtherCny', isSelectedBank) ?? (depositMethod === 'fps' || depositMethod === 'edda' ? 0 : null), 'deposit');
      };
      const convert = () => {
        const oldBalance = balance, oldUnit = unit;
        const fx = brokerFx(balance, unit, entryPrice, fxMode, data.broker);
        if (!fx) return null;
        balance = fx.usd; unit = 'USD';
        rows.push({ key: 'brokerFx', label: '换USD佣金／自动加价', cny: (fx.commissionUsd + fx.markupUsd) * refs.USD, step: 'deposit' });
        const grossUsd = balance + fx.commissionUsd + fx.markupUsd;
        const referenceDifference = oldBalance * refs[oldUnit] - grossUsd * refs.USD + deferredCnhBasis;
        const bankMid = fxMode === 'bank' && positive(bankFxQuote?.bidPerUsd) && positive(bankFxQuote?.askPerUsd)
          ? (bankFxQuote.bidPerUsd + bankFxQuote.askPerUsd) / 2 : null;
        fxRow('brokerSpread', relativeBasis ? '香港换汇差额' : fxMode === 'bank' ? '香港银行换汇点差' : '换汇成交点差', referenceDifference,
          bankMid ? (oldBalance / bankMid - grossUsd) * refs.USD : referenceDifference, 'deposit');
        if (fxMode === 'bank' && ownEntryPrice == null && !unquotedBankFx) crossLegs(rows[rows.length - 1], bankFxQuote, oldBalance, true, deferredCnhBasis);
        if (unquotedBankFx) Object.assign(rows[rows.length - 1], { cny: null, fxImpactCny: -referenceDifference, label: bank.name + ' ' + currency + '换USD点差（缺成交价）' });
        else if (currency !== 'USD' && fxMode !== 'bank' && ownEntryPrice == null) Object.assign(rows[rows.length - 1], {
          cny: null, fxImpactCny: -referenceDifference, label: 'IBKR ' + currency + '/USD实时成交点差', status: '按实时成交价计算' });
        return fx;
      };
      let brokerFxResult;
      if (fxMode === 'bank') { brokerFxResult = convert(); steps.hkConvertedUsd = balance; if (brokerFxResult) transfer(); }
      else { transfer(); steps.brokerOriginal = balance; brokerFxResult = convert(); }
      if (!brokerFxResult || balance <= 0) return { error: '余额不足以支付入金及换汇费用。' };
      const tradingKey = provider.id + ':' + balance.toFixed(8) + ':' + !!selections.public;
      if (autoTrade && !tradingCache.has(tradingKey)) tradingCache.set(tradingKey, brokerTradingFees(provider.id === broker.id && !selections.public ? config : { ...config, useVoucher: false, tradeFeeUsd: '' }, provider, balance, profit, refs));
      trading = autoTrade ? tradingCache.get(tradingKey) : null;
      if (trading?.error) return downstreamError(trading.error);
      steps.fundedUsd = balance;
      steps.investUsd = trading?.investUsd ?? balance;
      balance += profit;
      const trade = trading?.totalUsd ?? number(config.tradeFeeUsd);
      add('trade', '证券买卖交易费', trade == null ? null : trade * refs.USD, 'investment');
      if (trading && !trading.overridden) {
        rows[rows.length - 1].items = ['buy', 'sell'].flatMap(kind => {
          const orders = trading.orders.filter(order => order.kind === kind), label = kind === 'buy' ? '买入' : '卖出';
          return ['commission', 'platform', 'clearing', 'sec', 'taf', 'cat'].map(key => {
            const cny = orders.reduce((sum, order) => {
              const discounted = config.voucherScope === 'platform' ? 'platform' : 'commission';
              const commissionDiscount = config.voucherScope === 'both' ? Math.min(order.commission, order.discount) : discounted === 'commission' ? order.discount : 0;
              const discount = key === 'commission' ? commissionDiscount : key === 'platform' ? order.discount - commissionDiscount : 0;
              return sum + order[key] - discount;
            }, 0) * refs.USD;
            return { label: label + ({ commission: '佣金', platform: '平台费', clearing: '清算费', sec: 'SEC费', taf: 'TAF费', cat: 'CAT费' }[key]), cny };
          });
        });
      }
      const brokerAccountCny = (trading?.monthlyHkd ?? 0) * refs.HKD + (trading?.monthlyUsd ?? 0) * refs.USD;
      if (autoTrade) add('brokerAccount', provider.id === 'hsbc' && config.trade25 ? 'Trade25美股月费 · 现行豁免' : '证券账户／托管费', brokerAccountCny, 'investment');
      steps.proceedsUsd = balance;
      const taxableCny = number(config.taxableCny) ?? Math.max(0, (profit - (trade ?? 0)) * refs.USD);
      taxCny = taxReserve(taxableCny, taxRate, credit);
      balance -= taxCny / refs.USD;
      if (!keepInBroker) {
      const localCheque = provider.localChequeBanks?.includes(returning.id);
      const virtualReturn = provider.withdrawalMethod === 'local' && !localCheque;
      if (virtualReturn && balance <= provider.virtualWithdrawalMinimumUsd) return downstreamError(provider.name + '美元提至数字银行须超过' + provider.virtualWithdrawalMinimumUsd + ' USD。', '04');
      const withdrawal = provider.withdrawalMinimumHkd && balance * refs.USD / refs.HKD < provider.withdrawalMinimumHkd ? null :
        withdrawalIndex <= (provider.freeWithdrawals ?? 0) ? 0 : provider.withdrawUsd;
      add('withdraw', provider.name + '出金费', withdrawal == null ? null : withdrawal * refs.USD, 'withdraw');
      const localReturnCny = settlementBank ? localUsdTransfer(settlementBank, returning, refs, trading?.sellDate || config.date) : null;
      const returnInward = settlementBank ? localReturnCny == null ? null : localReturnCny / refs.HKD : own('inwardHkd', isSelectedReturn) ??
        (localCheque ? 0 : virtualReturn ? provider.virtualWithdrawalUsd * refs.USD / refs.HKD : provider.withdrawalMethod === 'cheque' ? returning.localUsdChequeHkd ?? null : inwardFee(returning, balance * refs.USD / refs.HKD, 'broker'));
      const returnLabel = settlementBank ? settlementBank.name + ' → ' + returning.name + (settlementBank.id === returning.id ? ' · 内部交收' : ' · USD CHATS') :
        localCheque || provider.withdrawalMethod === 'cheque' ? returning.name + ' · 本地USD支票存入' : virtualReturn ? '数字银行USD提款 · 官网参考7.5 USD' : '券商→香港银行汇入费';
      add('returnInward', returnLabel, returnInward == null ? null : returnInward * refs.HKD, 'withdraw');
      if (virtualReturn && own('inwardHkd', isSelectedReturn) == null) rows[rows.length - 1].estimate = '盈立公布约7.5 USD，由银行收取';
      add('withdrawMiddle', '券商出金中转行费', provider.integratedBank || provider.withdrawalMethod === 'cheque' || provider.withdrawalMethod === 'local' ? 0 : own('intermediaryCny', isSelectedReturn), 'withdraw');
      }
      steps.returnUsd = balance;
      const returnMethod = outcome !== 'mainland' ? '' : method('returnMethod', returning.id === 'bochk' && exit.group === 'boc' ? 'bochk-fast' : ['hang', 'hsbc', 'sc'].includes(returning.id) && returning.group === exit.group ? 'linked' : 'swift');
      const returningFee = own('returnWireHkd', isSelectedReturn);
      const returnDate = trading?.sellDate || config.date;
      const publishedReturnFee = returnFee(returning, exit, returnMethod, refs, returnDate);
      if (outcome === 'mainland' && returnMethod !== 'swift' && publishedReturnFee == null) return downstreamError('所选回款专用渠道与内地收款银行不匹配。', '04');
      let exitPrice = 1, indicativeExit = false, exitIssue = '';
      const returnFxQuote = quotes.offshoreUsd?.[returning.id]?.quotes?.CNH;
      if (outcome === 'mainland') {
      add('returnWire', '香港→内地汇出费', returningFee == null ? publishedReturnFee : returningFee * refs.HKD, 'return');
      add('returnOther', '回内地中转／收款费', own('returnExtraCny', isSelectedReturn && config.exitBank === exit.id) ?? (returnMethod === 'linked' ? 0 : null), 'return');
      if (rows[rows.length - 1].cny == null) rows[rows.length - 1].items = [{ label: '回内地中转行费', cny: null, status: '按实际汇路收费' }, { label: exit.name + 'USD收款费', cny: exit.inwardCny === 0 ? 0 : null, status: '汇入资费未收录' }];
      steps.remitUsd = balance;
      const exitQuote = exit.quotes.USD;
      const discountExpired = exitQuote?.spreadDiscount && returnDate > exit.fxValidUntil;
      const quotedExitPrice = own('exitPrice', config.exitBank === exit.id) ?? (discountExpired ? exitQuote.publishedBuy : exitQuote?.buy);
      indicativeExit = !positive(quotedExitPrice);
      exitIssue = indicativeExit ? exit.name + 'USD现汇买入价尚未取得；已保留结汇前美元余额' : '';
      exitPrice = indicativeExit ? refs.USD : quotedExitPrice;
      const preSettle = balance;
      balance *= exitPrice; unit = 'CNY';
      const exitMid = positive(exit.quotes.USD?.sell) ? (exit.quotes.USD.buy + exit.quotes.USD.sell) / 2 : refs.USD;
      fxRow('exitFx', relativeBasis ? '内地结汇差额' : '内地结汇点差', preSettle * refs.USD - balance, preSettle * (exitMid - exitPrice), 'return');
      if (indicativeExit) { Object.assign(rows[rows.length - 1], { cny: null, status: exitIssue }); missing.push(exitIssue); }
      steps.settledCny = balance;
      } else if (outcome === 'cnh-card') {
        if (!returning.directCnhCard) return downstreamError(returning.name + '扣账卡以港币结算，不支持人民币余额原币消费；已保留出金后的美元余额。', '04');
        if (returning.cnhCardRequiresHkid && !config.scCnhAccount) return downstreamError('渣打人民币原币消费须持有效香港身份证，并已开通人民币储蓄账户；已保留出金后的美元余额。', '04');
        const quotedPrice = own('exitPrice', isSelectedReturn) ?? returnFxQuote?.bidPerUsd;
        indicativeExit = !positive(quotedPrice);
        exitIssue = indicativeExit ? returning.name + ' USD/CNH换汇价尚未取得；已保留换汇前美元余额' : '';
        // A reference valuation keeps the ledger intact. It is never rendered
        // as a bank quote or a spendable CNH balance when the bank is unpriced.
        exitPrice = indicativeExit ? refs.USD / refs.CNH : quotedPrice;
        const usd = balance; balance *= exitPrice; unit = 'CNH';
        const returnMid = positive(returnFxQuote?.bidPerUsd) && positive(returnFxQuote?.askPerUsd) ? (returnFxQuote.bidPerUsd + returnFxQuote.askPerUsd) / 2 : refs.USD / refs.CNH;
        fxRow('exitFx', returning.name + ' USD → CNH换汇差额', usd * refs.USD - balance * refs.CNH,
          usd * (returnMid - exitPrice) * refs.CNH, 'return');
        if (!indicativeExit && own('exitPrice', isSelectedReturn) == null) crossLegs(rows[rows.length - 1], returnFxQuote, usd, false);
        if (indicativeExit) { Object.assign(rows[rows.length - 1], { cny: null, status: exitIssue }); missing.push(exitIssue); }
        add('card', '人民币原币刷卡手续费', 0, 'return');
      } else if (outcome === 'usd-card') {
        if (!returning.directUsdCard) return downstreamError(returning.name + '不支持本页美元余额原币刷卡；请选择中银香港、汇丰、恒生或渣打。', '04');
        add('card', '美元原币刷卡手续费', 0, 'return');
      } else if (!['usd-balance', 'broker-balance'].includes(outcome)) return downstreamError('请选择有效的资金用途。', '04');
      steps.terminal = balance; steps.settledCny = balance * refs[unit];
      add('account', '香港账户期间管理费', accountCny, 'spend');
      rows[rows.length - 1].items = accountItems;
      add('extra', '开户及资产机会成本', extraCny, 'spend');
      rows[rows.length - 1].items = [{ label: '开户／赴港支出', cny: number(config.openingCny) ?? 0 }, { label: '另留资产机会成本', cny: extraCny - (number(config.openingCny) ?? 0) }];
      if (!finite(balance) || balance < 0 || Object.values(steps).some(value => value < 0)) return { error: '资金不足以覆盖所选费用、亏损及税款。' };
      if (start.condition) requirements.push(start.condition);
      if (swiftGo) requirements.push('仅适用兴业App为该收款账户提供SWIFT GO的交易；50元/笔涵盖境外行费用。普通电汇不适用此报价。');
      if (bocMobile) requirements.push(data.bocMobileEvidence.note);
      if (paymentConnect) requirements.push('跨境支付通已查到中行南向零手续费实例，本次服务费仍须确认；南向受年度等值5万美元便利化额度及用途审核约束，不作为美股入金推荐。');
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
      const exitFresh = outcome !== 'mainland' || own('exitPrice', config.exitBank === exit.id) != null || quoteFresh(exit.quotes.USD, config.date);
      const entryMarketFresh = currency === 'USD' || own('entryPrice', isSelectedBank) != null || quoteFresh(fxMode === 'bank' ? bankFxQuote : offshore[currency], config.date);
      const exitMarketFresh = outcome !== 'cnh-card' || own('exitPrice', isSelectedReturn) != null || quoteFresh(returnFxQuote, config.date);
      const marketFresh = exitMarketFresh && entryMarketFresh;
      if (!sourceFresh) missing.push(start.name + '购汇牌价超过3天');
      if (!exitFresh && !indicativeExit) missing.push(exit.name + '结汇牌价超过3天');
      if ((!entryMarketFresh && !unquotedBankFx) || (!exitMarketFresh && !indicativeExit)) missing.push('香港换汇参考牌价超过3天');
      const referenceFresh = number(config.usdCny) != null || quoteFresh(refRow, config.date);
      if (!referenceFresh) missing.push('USD/CNY参照牌价超过3天');
      const indicativeFx = unquotedBankFx ? bank.name + ' ' + currency + '/USD成交价（暂按参考中间价）' :
        currency !== 'USD' && fxMode !== 'bank' && ownEntryPrice == null ? 'IBKR ' + currency + '/USD成交价（暂按参考中间价）' : '';
      if (indicativeFx && !unquotedBankFx) missing.push(indicativeFx);
      const preciseMissing = [...unpriced.flatMap(row => (row.items || [row]).filter(item => item.cny == null).map(item => item.label)),
        ...missing.filter(reason => !unpriced.some(row => reason === row.label || row.key === 'sender' && reason === start.name + '所选渠道汇出收费'))];
      const requiredEligibility = [...new Set([start.required, ...(returnMethod === 'linked' ? [exit.required] : [])].filter(Boolean))];
      const eligibilityReasons = requiredEligibility.map(id => mainland.find(row => row.required === id)?.condition).filter(Boolean);
      return { budgetCny: budget, origin: 'mainland', permission, currency: unit, outcome, settlementBank, route, start, bank, returning, exit, exitBank: exit.id, broker: provider, trading,
        mainlandMethod, depositMethod, fxMode, returnMethod, returnDate, indicativeFx, indicativeExit, exitIssue, startSell: quote, entryPrice, exitPrice,
        entryAsOf: currency === 'CNH' ? null : q?.asOf, entryTimeBasis: q?.timeBasis, entryDiscount: own('startSell', isSelectedStart) == null ? q?.spreadDiscount : undefined,
        exitAsOf: outcome === 'cnh-card' ? returnFxQuote?.asOf : exit.quotes.USD?.asOf,
        fxAsOf: currency === 'USD' ? null : (fxMode === 'bank' ? bankFxQuote : offshore[currency])?.asOf,
        quoteFreshness: { source: sourceFresh, exit: exitFresh && exitMarketFresh, entryMarket: entryMarketFresh, market: marketFresh, reference: referenceFresh },
        sourceAmount: budget, profitUsd: profit, investUsd: steps.investUsd, proceeds: steps.proceedsUsd, bankUsd: steps.returnUsd,
        net: balance, netCny: balance * refs[unit], taxCny, taxableCny, estimatedTax: number(config.taxableCny) == null, rows, steps,
        missing: [...new Set(preciseMissing)], complete: !preciseMissing.length, requiredEligibility, eligibilityReasons, requirements: [...new Set([...requirements, ...eligibilityReasons])],
        refs, benchmarks, pricingBasis: config.pricingBasis, costCny, fxCny, fxImpactCny, explicitCny: costCny - fxCny, extraCny, brokerFx: brokerFxResult,
        quotedCore: !indicativeFx && !indicativeExit && !exitIssue && sourceFresh && exitFresh && marketFresh && referenceFresh && !unknownSender && !unpriced.some(row => ['depositBank', 'entryInward', 'returnWire', 'account'].includes(row.key)),
        rankable: !(reportedMobile && senderOverride == null) && !paymentConnect && !indicativeFx && !indicativeExit && !exitIssue && sourceFresh && exitFresh && marketFresh && referenceFresh && !unknownSender && !unpriced.some(row => ['depositBank', 'entryInward', 'returnInward', 'returnWire', 'account'].includes(row.key)) };
    }
    // The interactive calculator evaluates the selected route, not thousands
    // of incomplete counterfactuals presented as recommendations.
    if (config.selectedOnly) {
      const start = mainland.find(row => row.id === config.startBank) || mainland[0];
      const bank = data.hkBanks.find(row => row.id === config.bank) || data.hkBanks.find(row => row.id === 'bochk');
      const returning = data.hkBanks.find(row => row.id === config.returnBank) || bank;
      const exit = mainland.find(row => row.id === config.exitBank) || start;
      const route = config.route || 'USD', fxMode = route === 'USD' ? 'manual' : broker.id !== 'ibkr' ? 'bank' : config.fxMode || 'manual';
      const selected = calculate(start, bank, route, fxMode, exit, returning);
      return { permission, origin: 'mainland', selected: selected.error ? undefined : selected, partial: selected.error ? selected : undefined,
        error: selected.error, selection: { start, bank, returning, exit, route, fxMode, broker }, mainland, refs, plans: [] };
    }
    const publicKeys = new Set([...routeKeys, ...bankQuoteKeys, 'comparison', 'plan', 'balanceHkd', 'returnBalanceHkd',
      ...(autoTrade ? ['tradeFeeUsd', 'useVoucher', 'voucherUsd', 'voucherOrders', 'voucherScope', 'voucherExpiry'] : [])]);
    const planKey = JSON.stringify([Object.fromEntries(Object.entries(config).filter(([key]) => !publicKeys.has(key))), autoTrade, quotes, data.mainlandBanks, data.hkBanks, data.brokers, data.broker]);
    const plans = mainlandPlanCache?.key === planKey ? mainlandPlanCache.plans : [];
    if (mainlandPlanCache?.key !== planKey) {
    for (const provider of autoTrade ? data.brokers : [broker]) for (const start of mainland) for (const bank of data.hkBanks) for (const route of ['USD', 'HKD', 'CNH']) {
      if (provider.integratedBank && bank.id !== provider.integratedBank) continue;
      if (route === 'CNH' && !(['hang', 'hsbc', 'sc', 'abc', 'boc'].includes(start.id))) continue;
      const returningBanks = provider.integratedBank ? [bank] : data.hkBanks;
      const modes = route === 'USD' ? ['manual'] : [...(provider.id === 'ibkr' ? ['manual', 'auto'] : []), ...(bank.id === 'bochk' && offshore[route] ? ['bank'] : [])];
      const entryMethods = ['hang', 'hsbc', 'sc'].includes(start.id) && start.group === bank.group ? ['linked', 'swift'] :
        ['swift', ...(start.id === 'boc' && bank.id === 'bochk' && route !== 'CNH' ? ['boc-mobile'] : []), ...(route === 'USD' && start.fullAmountUsd != null ? ['full'] : [])];
      for (const returning of returningBanks) for (const fxMode of modes) for (const exit of fresh) for (const mainlandMethod of entryMethods) {
        const deposits = provider.integratedBank ? ['internal'] : route === 'USD' || fxMode === 'bank' ? ['chats', 'swift'] : ['fps', 'edda', 'swift'];
        for (const depositMethod of deposits) {
        const r = calculate(start, bank, route, fxMode, exit, returning, {
          public: true, mainlandMethod, depositMethod, returnMethod: '' }, provider);
        if (!r.error) plans.push(r);
        }
      }
    }
    mainlandPlanCache = { key: planKey, plans };
    }
    const rankable = plans.filter(row => row.rankable).sort((a, b) => b.net - a.net);
    const allowed = row => row.requiredEligibility.every(id => !!config['eligible_' + id]);
    const available = rankable.filter(allowed), verifiedMinimum = available.find(row => row.complete);
    const minimum = available[0], recommended = minimum;
    const simple = available.find(row => row.route === 'USD' && row.bank.id === row.returning.id && !row.requiredEligibility.length);
    const conditional = rankable.find(row => !allowed(row));
    const reason = row => !row ? '' : [row.complete ? '费用已核齐' : '按已知费用比较，缺项另列', row.route === 'USD' ? '内地直购USD，少一次换汇' : row.route === 'CNH' ? '人民币原币到港后换USD' : '内地购HKD后换USD',
      row.broker.integratedBank ? '银行证券直接交收' : row.bank.id === row.returning.id ? '只用一个香港银行账户' : '入金、回款分用两家香港银行',
      row.requiredEligibility.length ? row.eligibilityReasons.join('；') : '无指定优先理财门槛'].join('；');
    const bestRoute = route => available.find(row => row.route === route) || plans.filter(row => row.route === route && allowed(row) && row.quotedCore).sort((a, b) => b.net - a.net)[0];
    const bocMobileRoute = plans.find(row => row.mainlandMethod === 'boc-mobile' && row.route === 'USD' && row.broker.id === 'ibkr' && row.returning.id === 'bochk' && row.exit.id === 'boc' && row.depositMethod === 'chats');
    const presets = [
      ['boc-mobile', '中行 → 中银香港 · 手机银行同名', bocMobileRoute],
      ['recommended', '公开报价基准', recommended], ['simple', '美元直达 · 一个香港账户', simple],
      ['CNH', '人民币到港 · 香港换USD', bestRoute('CNH')], ['HKD', '内地换HKD · 再换USD', bestRoute('HKD')],
      ...['ibkr', 'hsbc', 'chief', 'usmart', 'za'].map(id => [id, data.brokers?.find(row => row.id === id)?.name, available.find(row => row.broker.id === id) || plans.filter(row => row.broker.id === id && allowed(row) && row.quotedCore && row.route === 'USD').sort((a, b) => b.net - a.net)[0]])
    ].filter(([, , row]) => row).map(([id, name, row]) => ({ id, name, result: row, reason: reason(row), evidenceOnly: id === 'boc-mobile', differenceCny: recommended && id !== 'boc-mobile' ? recommended.net - row.net : null }));
    const automatic = config.plan === 'minimum' ? minimum : recommended || minimum;
    // Missing automatic recommendations must not disable a customer's own
    // confirmed quotes. Stale references remain dated and explicitly warned.
    const fallback = automatic || { start: mainland[0], bank: data.hkBanks.find(row => row.id === (broker.integratedBank || 'hang')) || data.hkBanks[0], exit: fresh[0] || mainland[0], route: 'USD', fxMode: 'manual' };
    const start = mainland.find(row => row.id === config.startBank) || fallback.start;
    const activeBroker = !config.startBank && !config.bank && !config.route ? fallback.broker || broker : broker;
    const bank = data.hkBanks.find(row => row.id === config.bank) || fallback.bank;
    const returning = data.hkBanks.find(row => row.id === config.returnBank) || fallback.returning || bank;
    const exit = mainland.find(row => row.id === config.exitBank) || fallback.exit;
    const route = config.route || fallback.route;
    const fxMode = config.fxMode || (route === fallback.route ? fallback.fxMode : 'manual');
    const selected = calculate(start, bank, route, fxMode, exit, returning, {}, activeBroker);
    // Counterfactuals vary one step and preserve the rest of the selected route.
    const alternatives = {
      start: mainland.map(row => ({ start: row, ...calculate(row, bank, route, fxMode, exit, returning, { mainlandMethod: row.id === start.id ? selected.mainlandMethod : '' }, activeBroker) })),
      bank: data.hkBanks.map(row => ({ bank: row, ...calculate(start, row, route, fxMode, exit, returning, { mainlandMethod: row.id === bank.id ? selected.mainlandMethod : '', depositMethod: row.id === bank.id ? selected.depositMethod : route === 'USD' || fxMode === 'bank' ? 'chats' : 'fps' }, activeBroker) })),
      route: ['USD', 'HKD', 'CNH'].map(value => {
        const mode = value === 'USD' ? 'manual' : activeBroker.id !== 'ibkr' ? 'bank' : route === 'USD' ? 'manual' : fxMode;
        const methods = value === 'USD' || mode === 'bank' ? ['chats', 'swift'] : ['fps', 'edda', 'swift'];
        const deposit = methods.includes(selected.depositMethod) ? selected.depositMethod : methods[0];
        const entry = (selected.mainlandMethod === 'full' && value !== 'USD') || (selected.mainlandMethod === 'boc-mobile' && value === 'CNH') || (selected.mainlandMethod === 'payment-connect' && value !== 'CNH') ? '' : selected.mainlandMethod;
        return { route: value, ...calculate(start, bank, value, mode, exit, returning, { mainlandMethod: entry, depositMethod: deposit }, activeBroker) };
      }),
      returnBank: data.hkBanks.map(row => ({ returning: row, ...calculate(start, bank, route, fxMode, exit, row, { returnMethod: row.id === returning.id ? selected.returnMethod : '' }, activeBroker) })),
      exit: mainland.map(row => ({ exit: row, ...calculate(start, bank, route, fxMode, row, returning, { returnMethod: row.id === exit.id ? selected.returnMethod : '' }, activeBroker) })),
      broker: (data.brokers || [broker]).map(provider => {
        const entryBank = bank;
        const returnBank = returning;
        const mode = route !== 'USD' && provider.id !== 'ibkr' ? 'bank' : fxMode;
        return { broker: provider, ...calculate(start, entryBank, route, mode, exit, returnBank, { mainlandMethod: entryBank.id === bank.id ? selected.mainlandMethod : '', depositMethod: provider.id === activeBroker.id ? selected.depositMethod : '', returnMethod: returnBank.id === returning.id ? selected.returnMethod : '' }, provider) };
      })
    };
    return { permission, origin: 'mainland', selected: selected.error ? undefined : selected, partial: selected.error ? selected : undefined, error: selected.error,
      selection: { start, bank, returning, exit, route, fxMode, broker: activeBroker }, recommended, minimum, simple, conditional, verifiedMinimum, presets,
      recommendationReason: reason(recommended), plans: available, alternatives, mainland, refs, extraCny };
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
  function calculatorRoute(config) {
    const s = { ...config };
    const paired = ({ boc: 'bochk', hsbc: 'hsbc', hang: 'hang', sc: 'sc' })[s.startBank] === s.bank;
    s.mainlandMethod ||= paired && s.startBank === 'boc' && s.route !== 'CNH' ? 'boc-mobile' : paired && s.startBank !== 'boc' ? 'linked' : 'swift';
    s.fxMode = s.route === 'USD' ? 'manual' : s.fxMode || (s.broker === 'ibkr' ? 'manual' : 'bank');
    s.depositMethod ||= ['hsbc', 'za'].includes(s.broker) && s.broker === s.bank ? 'internal' :
      s.broker === 'usmart' && s.bank === 'bochk' || s.broker === 'chief' && ['bochk', 'hsbc', 'hang'].includes(s.bank) ? 'internal' :
      s.route === 'USD' || s.fxMode === 'bank' ? 'chats' : s.broker === 'chief' && s.route === 'CNH' ? 'edda' : 'fps';
    s.returnMethod ||= s.returnBank === 'bochk' && s.exitBank === 'boc' ? 'bochk-fast' :
      ['hsbc', 'hang', 'sc'].includes(s.returnBank) && s.returnBank === s.exitBank ? 'linked' : 'swift';
    return s;
  }
  function calculatorIssue(config, data) {
    const p = data.calculator, s = config;
    if (!p.mainland.includes(s.startBank)) return '请选择目录中的出发银行。农业银行已按要求移除。';
    if (s.outcome === 'mainland' && !p.mainland.includes(s.exitBank)) return '请选择目录中的内地收款银行。农业银行已按要求移除。';
    if (!p.hkBanks.includes(s.bank)) return '请选择目录中的香港收款银行。';
    if (s.outcome !== 'broker-balance' && !p.hkBanks.includes(s.returnBank)) return '请选择目录中的取回／消费银行。';
    if (!p.brokers.includes(s.broker)) return '请选择目录中的买股账户。';
    if (!p.currencies.includes(s.route)) return '请选择USD、HKD或人民币原币。';
    if (!['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland'].includes(s.outcome)) return '请选择资金用途。';
    return '';
  }
  function calculatorJourney(config, data, quotes) {
    const issue = calculatorIssue(config, data);
    if (issue) return { error: issue, errorStage: /内地收款|取回|资金用途/.test(issue) ? '04' : /买股/.test(issue) ? '03' : /香港收款/.test(issue) ? '02' : '01', plans: [] };
    // Partial public prices remain visible. Missing evidence never changes the
    // account catalogue, disables a picker or silently turns an unknown fee to 0.
    return mainlandJourney({ ...config, pricingBasis: 'best-quote', currency: 'CNY', selectedOnly: true }, data, quotes);
  }
  return { calculatorRoute, calculatorIssue, calculatorJourney, number, reference, fee, remitPrincipal, senderFeeRange, inwardFee, outwardFee, maintenance, legalPath, eligible, opportunityCost, fxRoundTripLoss, mainlandTransfer, brokerFx, taxReserve, offshoreTransfer, consumption, journeyPlans, mainlandJourney, depositFee, localUsdTransfer, returnFee, quoteFresh, quotedMainlandBanks, purchaseComparison, selectedBroker, cappedCharge, brokerTradingFees, voucherState, flowLedger, diagramLedger, comparisonMetric, routeConfiguration, applyRoute, routeKeys, bankQuoteKeys };
}));
