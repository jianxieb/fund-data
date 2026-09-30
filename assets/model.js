/* Pure helpers for public investment research and source-aware data normalization. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Changheng = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const copy = x => JSON.parse(JSON.stringify(x));
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const escapeHtml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function stockMatches(stock, group) {
    if (group === 'dividend') return stock.group === 'dividend';
    if (!['quality', 'growth', 'breakout'].includes(group) || !['quality', 'growth'].includes(stock.group)) return false;
    if (group === 'breakout' && (stockMatches(stock, 'quality') || stockMatches(stock, 'growth'))) return false;
    const review = group === 'quality' ? stock.longTermReview : group === 'growth' ? stock.growthReview : stock.breakoutReview;
    return review?.qualified === true && stock.qualityResearch?.status === 'reviewed' && stock.qualityResearch?.code === stock.c;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function annualized(total, years) {
    if (!finite(total) || total < -100 || !finite(years) || years <= 0) return null;
    const value = (Math.pow(1 + total / 100, 1 / years) - 1) * 100;
    return finite(value) ? value : null;
  }
  function yearsBetween(start, end) {
    if (!validDate(start) || !validDate(end) || end < start) return null;
    return (Date.parse(end) - Date.parse(start)) / 86400000 / 365.2425;
  }
  function hasWindow(start, end, years) {
    if (!validDate(start) || !validDate(end) || !Number.isInteger(years) || years <= 0 || start > end) return false;
    const d = new Date(end + 'T00:00:00Z'), m = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 0) return false;
    if (d.getUTCMonth() !== m) d.setUTCDate(0);
    return start <= d.toISOString().slice(0, 10);
  }
  function dedupeFunds(funds, extra) {
    const groups = new Map(), periods = [1, 2, 3, 5, 10];
    const date = value => validDate(value) ? value : null;
    const explicitEnd = (f, kind) => kind === 'return' ? date(f.returnAsOf) || date(f.retdate) : date(f.riskAsOf);
    const end = (f, kind) => explicitEnd(f, kind) || date(f.navdate);
    const first = (f, kind) => {
      const dates = [date(f.d), date(kind === 'return' ? f.returnFirst : f.riskFirst), kind === 'risk' ? date(f.riskStart) : null].filter(Boolean);
      return dates.length ? dates.sort().at(-1) : null;
    };
    // Net value, return and risk snapshots can have different dates. Select each
    // domain independently, without blending different return windows into one row.
    const latest = (rows, kind) => rows.slice().sort((a, b) => {
      if (kind !== 'nav') {
        const verifiedDates = Number(!!explicitEnd(b, kind)) - Number(!!explicitEnd(a, kind));
        if (verifiedDates) return verifiedDates;
      }
      const ad = kind === 'nav' ? date(a.navdate) : end(a, kind), bd = kind === 'nav' ? date(b.navdate) : end(b, kind);
      return (bd || '').localeCompare(ad || '') || Number(b.origin === 'overseas') - Number(a.origin === 'overseas');
    })[0];
    for (const [rows, origin] of [[extra, 'research'], [funds, 'overseas']]) for (const f of Array.isArray(rows) ? rows : []) {
      if (!record(f) || typeof f.c !== 'string' || !/^\d{6}$/.test(f.c)) continue;
      if (!groups.has(f.c)) groups.set(f.c, []);
      groups.get(f.c).push({ ...f, origin });
    }
    return [...groups.values()].map(rows => {
      const f = latest(rows, 'nav'), returns = latest(rows, 'return'), risk = latest(rows, 'risk');
      const returnEnd = end(returns, 'return'), riskEnd = end(risk, 'risk');
      const n = { ...f, exchange: !f.t || f.t === '场内ETF', returnAsOf: explicitEnd(returns, 'return'), riskAsOf: explicitEnd(risk, 'risk'),
        returnDateInferred: !explicitEnd(returns, 'return'), riskDateInferred: !explicitEnd(risk, 'risk'),
        returnFirst: date(returns.returnFirst), riskFirst: date(risk.riskFirst) || date(risk.riskStart),
        returnPeriods: Array.isArray(returns.returnPeriods) ? copy(returns.returnPeriods) : null,
        returnSource: returns.returnSource, returnSourceUrl: returns.returnSourceUrl,
        returnBasis: returns.returnBasis || returns.basis, riskBasis: risk.riskBasis || risk.basis,
        performanceVerifiedAt: returns.performanceVerifiedAt, riskVerifiedAt: risk.performanceVerifiedAt };
      n.r = periods.map((y, i) => {
        const raw = returns.r && returns.r[i];
        if (!hasWindow(first(returns, 'return'), returnEnd, y) || !finite(raw) || raw < -100) return null;
        if (n.returnPeriods) {
          const p = n.returnPeriods.find(p => record(p) && p.years === y);
          if (!p || !hasWindow(p.start, p.end, y) || p.end !== returnEnd || p.start < first(returns, 'return')) return null;
        }
        return raw;
      });
      n.returnYears = periods.map(y => {
        const p = n.returnPeriods && n.returnPeriods.find(p => record(p) && p.years === y);
        return p ? yearsBetween(p.start, p.end) : null;
      });
      for (const [key, y] of [['mdd5', 5], ['vol5', 5], ['mdd3', 3], ['v3', 3]]) {
        const v = risk[key], allowed = key.startsWith('mdd') ? finite(v) && v >= -100 && v <= 0 : finite(v) && v >= 0;
        n[key] = hasWindow(first(risk, 'risk'), riskEnd, y) && allowed ? v : null;
      }
      const fees = [0, 1, 2].map(i => Array.isArray(f.fee) && finite(f.fee[i]) && f.fee[i] >= 0 ? f.fee[i] : null);
      n.fee = fees;
      n.annualFee = fees[0] !== null && fees[1] !== null ? fees[0] + fees[1] : null;
      n.feeCoverage = fees.every(v => v !== null) ? 'complete' : fees.some(v => v !== null) ? 'partial' : 'unknown';
      n.knownOngoingFee = fees.some(v => v !== null) ? sum(fees.filter(v => v !== null)) : null;
      n.totalOngoingFee = n.feeCoverage === 'complete' ? sum(fees) : null;
      const text = (f.ix || '') + ' ' + (f.n || '');
      const indexLike = /指数|ETF|联接/.test(text);
      const mixed = /混合|灵活配置|固收[+＋]|偏债|可转债|转债|FOF|多资产|资产配置/.test(text);
      const physicalGold = /黄金|上海金|Au99|伦敦金/i.test(text) && !/黄金股|产业|矿业|股票/.test(text);
      const overseas = f.origin === 'overseas' || /QDII|海外|全球|美国|标普|纳斯达克|恒生|港股|香港|沪港深/.test(text);
      n.dividend = /红利|股息/.test(text);
      n.overseasExposure = overseas;
      n.fixedIncomeOrMixed = f.g === 'x5' || mixed || /债券|纯债|货币/.test(text);
      n.active = /主动|增强/.test(text) || !indexLike;
      n.asset = physicalGold && !mixed ? 'gold' : f.g === 'x5' || mixed || /原油|商品|期货|白银|沪港深/.test(text) ? 'other' : overseas ? 'global' : 'cn';
      n.assetInferred = true;
      return n;
    });
  }
  function visiblePeriods(value) {
    const selected = Array.isArray(value) ? [1, 2, 3, 5, 10].filter(y => value.includes(y)) : [];
    return selected.length ? selected : [3, 5, 10];
  }
  function crossborderPerformance(fund, evidence, basis = 'nav') {
    if (fund.exchange && basis === 'market') {
      return evidence?.market || { r: [null, null, null, null, null], returnAsOf: null,
        returnPeriods: [], mdd5: null, vol5: null, missing: '缺成交价复权历史' };
    }
    return evidence?.nav || fund;
  }
  function crossborderMatches(fund, filters) {
    const types = filters.types || [], channels = filters.channels || [];
    if (types.length && !types.includes(fund.ix)) return false;
    if (channels.length && !channels.includes(fund.exchange ? 'exchange' : 'off')) return false;
    if (filters.query && !(fund.c + fund.n + fund.ix).toLowerCase().includes(filters.query.toLowerCase())) return false;
    if (finite(filters.premiumMax) && fund.exchange && (!finite(fund.prem) || fund.prem > filters.premiumMax)) return false;
    if (filters.purchasable && !fund.exchange && !/开放|限大额/.test(fund.st || '')) return false;
    return true;
  }
  function compareNullable(a, b, descending = true) {
    if (a == null || typeof a === 'number' && !finite(a)) return b == null || typeof b === 'number' && !finite(b) ? 0 : 1;
    if (b == null || typeof b === 'number' && !finite(b)) return -1;
    return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * (descending ? -1 : 1);
  }
  function equityQualifies(rule, limits) {
    if (!record(rule) || !rule.equityEligible || !record(rule.thresholdInputs)) return false;
    const t = rule.thresholdInputs;
    for (const [field, limit] of [['a3', 'minA3'], ['a5', 'minA5'], ['historyYears', 'minHistoryYears'], ['scale', 'minScale']]) {
      if (!finite(t[field]) || !finite(limits[limit]) || t[field] < limits[limit]) return false;
    }
    if (limits.minA10 != null && (!finite(t.a10) || !finite(limits.minA10) || t.a10 < limits.minA10)) return false;
    if (!t.passive && (!finite(t.managerYears) || !finite(limits.minManagerYears) || t.managerYears < limits.minManagerYears)) return false;
    return true;
  }
  function csv(rows) {
    return '\ufeff' + rows.map(row => row.map(v => {
      let s = v == null ? '' : String(v);
      if (typeof v === 'string' && (/^[=+\-@\t\r\n]/.test(s) || /^[\s\u0000]*[=+\-@]/.test(s))) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
  }
  function buyLocationXirr(flows) {
    if (!Array.isArray(flows) || flows.length < 2 || !flows.some(x => x[1] < 0) || !flows.some(x => x[1] > 0)) return null;
    const first = Date.parse(flows[0][0] + 'T00:00:00Z');
    const npv = rate => flows.reduce((total, [day, amount]) => total + amount / Math.pow(1 + rate, (Date.parse(day + 'T00:00:00Z') - first) / 86400000 / 365.2425), 0);
    let low = -0.9999, high = 1;
    while (npv(high) > 0 && high < 1e6) high = high * 2 + 1;
    if (!(npv(low) > 0) || !(npv(high) < 0)) return null;
    for (let i = 0; i < 100; i++) {
      const mid = (low + high) / 2;
      if (npv(mid) > 0) low = mid; else high = mid;
    }
    return (low + high) * 50;
  }
  function buyLocationResult(data, config) {
    if (!record(data) || !Array.isArray(data.products) || !Array.isArray(data.fx)) return { error: '比较数据缺失' };
    const products = data.products.filter(p => p.family === config.family);
    if (!products.length || ![1, 2, 3, 5, 10].includes(config.years) || !['lump', 'monthly'].includes(config.plan)) return { error: '比较条件无效' };
    const amount = Number(config.plan === 'lump' ? config.lumpAmount : config.monthlyAmount);
    const fees = config.fees || {};
    const keys = ['usCommission', 'usMinimum', 'fxSpread', 'exchangeCommission', 'exchangeMinimum', 'subscription', 'redemption', 'usDividendTax', 'cnDividendTax', 'capitalGainsTax'];
    if (!finite(amount) || amount <= 0 || amount > 1e9 || keys.some(key => !finite(Number(fees[key])) || Number(fees[key]) < 0 || Number(fees[key]) > (key.endsWith('Minimum') ? 1e6 : 100))) return { error: '金额或费用假设无效' };
    const fundFees = config.fundFees || {};
    if (Object.values(fundFees).some(pair => !record(pair) || ['subscription', 'redemption'].some(key => !finite(Number(pair[key])) || Number(pair[key]) < 0 || Number(pair[key]) > 100))) return { error: '场外基金费率无效' };
    const fx = new Map(data.fx);
    const exchangeBasis = config.exchangeBasis || 'nav';
    if (!['nav', 'market'].includes(exchangeBasis)) return { error: '场内收益口径无效' };
    const chosen = products.map(p => p.channel === 'exchange' && exchangeBasis === 'nav' ? p.navSeries : p.series);
    if (chosen.some(s => !Array.isArray(s) || !s.length)) return { error: '所选口径缺少历史序列' };
    const series = chosen.map(s => new Map(s));
    let common = new Set(fx.keys());
    for (const prices of series) common = new Set([...common].filter(day => prices.has(day)));
    const available = [...common].filter(day => day <= data.asOf).sort();
    if (!available.length) return { error: '产品与汇率没有共同交易日' };
    const end = available.at(-1), anchor = new Date(end + 'T00:00:00Z');
    anchor.setUTCFullYear(anchor.getUTCFullYear() - config.years);
    const desiredStart = anchor.toISOString().slice(0, 10);
    const start = available.find(day => day >= desiredStart);
    if (!start || start > desiredStart.slice(0, 4) + '-12-31' || available[0] > desiredStart) return { error: '缺少完整共同历史窗口' };
    const months = new Set(), purchaseDays = [];
    for (const day of available) {
      if (day < start || day > end) continue;
      if (config.plan === 'lump') { if (day === start) purchaseDays.push(day); break; }
      const month = day.slice(0, 7);
      if (!months.has(month)) { months.add(month); purchaseDays.push(day); }
    }
    const purchaseSet = new Set(purchaseDays);
    const fxDays = [...fx.keys()].sort();
    const fxAt = day => {
      if (fx.has(day)) return fx.get(day);
      let lo = 0, hi = fxDays.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (fxDays[mid] <= day) lo = mid + 1; else hi = mid; }
      const prior = fxDays[lo - 1];
      return prior && (Date.parse(day) - Date.parse(prior)) / 86400000 <= 5 ? fx.get(prior) : null;
    };
    const buyAfterFee = (cash, pctRate, minimum) => {
      const rate = pctRate / 100;
      const proportional = cash / (1 + rate);
      const fee = proportional * rate >= minimum ? proportional * rate : minimum;
      return { invested: cash - fee, fee };
    };
    const rows = products.map((product, index) => {
      const points = chosen[index].filter(([day]) => day >= start && day <= end);
      let units = 0, basis = 0, transactionCost = 0, fxCost = 0, usDividendTax = 0, cnDividendTax = 0, contributed = 0, purchases = 0;
      const flows = [];
      for (const [day, price] of points) {
        if (!finite(price) || price <= 0) return { code: product.code, error: '价格序列无效' };
        if (product.channel === 'us' && units > 0) {
          const fraction = Number((product.dividendFraction || {})[day] || 0);
          if (fraction > 0) {
            const rate = fxAt(day);
            if (!finite(rate) || rate <= 0) return { code: product.code, error: '分红日汇率缺失' };
            const gross = units * price * fraction;
            const withheld = gross * fees.usDividendTax / 100;
            const extra = gross * Math.max(0, fees.cnDividendTax - fees.usDividendTax) / 100;
            usDividendTax += withheld * rate;
            cnDividendTax += extra * rate;
            units -= (withheld + extra) / price;
            basis += (gross - withheld - extra) * rate;
          }
        }
        if (!purchaseSet.has(day)) continue;
        const rate = fx.get(day);
        if (!finite(rate) || rate <= 0) return { code: product.code, error: '买入日汇率缺失' };
        let invested;
        if (product.channel === 'us') {
          const usd = amount / (rate * (1 + fees.fxSpread / 100));
          const result = buyAfterFee(usd, fees.usCommission, fees.usMinimum);
          invested = result.invested;
          transactionCost += result.fee * rate;
          fxCost += amount - usd * rate;
        } else {
          const result = buyAfterFee(amount, product.channel === 'exchange' ? fees.exchangeCommission : (fundFees[product.code]?.subscription ?? fees.subscription),
            product.channel === 'exchange' ? fees.exchangeMinimum : 0);
          invested = result.invested;
          transactionCost += result.fee;
        }
        if (invested <= 0) return { code: product.code, error: '单次投入不足以支付最低手续费' };
        units += invested / price;
        basis += amount;
        contributed += amount;
        purchases++;
        flows.push([day, -amount]);
      }
      const finalPrice = series[index].get(end), finalFx = fx.get(end);
      if (!finite(finalPrice) || !finite(finalFx)) return { code: product.code, error: '卖出日数据缺失' };
      const gross = units * finalPrice;
      let beforeCapitalTax;
      if (product.channel === 'us') {
        const fee = Math.max(gross * fees.usCommission / 100, fees.usMinimum);
        if (fee >= gross) return { code: product.code, error: '卖出金额不足以支付最低手续费' };
        transactionCost += fee * finalFx;
        fxCost += (gross - fee) * finalFx * fees.fxSpread / 100;
        beforeCapitalTax = (gross - fee) * finalFx * (1 - fees.fxSpread / 100);
      } else if (product.channel === 'exchange') {
        const fee = Math.max(gross * fees.exchangeCommission / 100, fees.exchangeMinimum);
        transactionCost += fee;
        beforeCapitalTax = gross - fee;
      } else {
        const fee = gross * (fundFees[product.code]?.redemption ?? fees.redemption) / 100;
        transactionCost += fee;
        beforeCapitalTax = gross - fee;
      }
      const taxableGain = product.channel === 'us' ? Math.max(0, beforeCapitalTax - basis) : 0;
      const capitalTax = taxableGain * fees.capitalGainsTax / 100;
      const terminal = beforeCapitalTax - capitalTax;
      flows.push([end, terminal]);
      const nav = new Map(product.navSeries || []);
      const market = new Map(product.series || []);
      const premiumRatioChange = product.channel === 'exchange' && nav.has(start) && nav.has(end) && market.has(start) && market.has(end)
        ? ((market.get(end) / market.get(start)) / (nav.get(end) / nav.get(start)) - 1) * 100 : null;
      return { code: product.code, name: product.name, channel: product.channel,
        contributed, terminal, profit: terminal - contributed,
        totalReturn: (terminal / contributed - 1) * 100, xirr: buyLocationXirr(flows),
        purchases, transactionCost, fxCost, usDividendTax, cnDividendTax,
        capitalTax, taxableGain, beforeCapitalTax, basis, premiumRatioChange,
        exchangeBasis: product.channel === 'exchange' ? exchangeBasis : null, dividendsIncluded: true };
    });
    return { start, end, purchaseDays, rows, exchangeBasis };
  }
  return { finite, sum, copy, escapeHtml, validDate, annualized, yearsBetween, hasWindow, dedupeFunds, visiblePeriods, compareNullable, equityQualifies, stockMatches, csv, buyLocationXirr, buyLocationResult, crossborderPerformance, crossborderMatches };
}));
