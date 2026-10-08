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
    if (!knownFee(months) || invalidOptional(config, ['depositHkd', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'balanceHkd'])) return { error: '银行费用、保留资产及使用月数必须为非负数；未知费用请留空。' };
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
    const proceeds = investUsd + profitUsd;
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
    const explicit = (initial.commissionUsd + depositUsd + feesUsd + exit / config.usdHkd) * refs.USD + (knownFee(mainlandExtra) ? mainlandExtra : 0) + (knownFee(monthly) ? monthly * refs.HKD : 0);
    const fx = entryFx + exitFx + initial.markupUsd * refs.USD;
    const monthlySpend = knownFee(monthly) ? monthly * refs.HKD / refs[spend] : 0;
    const net = spending - monthlySpend;
    if (net < 0) return { error: '资金不足以支付账户月费。' };
    rows.push({ label: '本地入金费用', cny: knownFee(deposit) ? depositUsd * refs.USD : null });
    rows.push({ label: '换汇佣金／自动加价', cny: (initial.commissionUsd + initial.markupUsd) * refs.USD });
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
  return { number, reference, fee, remitPrincipal, inwardFee, outwardFee, maintenance, legalPath, eligible, opportunityCost, fxRoundTripLoss, mainlandTransfer, brokerFx, taxReserve, offshoreTransfer, consumption };
}));
