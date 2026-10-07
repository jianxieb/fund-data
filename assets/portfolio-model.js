(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.ChanghengPortfolioModel = factory(root.Changheng);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const DAY = 86400000, YEAR = 365.2425, EPS = 1e-8;
  const finite = M.finite;
  const time = day => Date.parse(day + 'T00:00:00Z');
  const gap = (a, b) => (time(b) - time(a)) / DAY;
  const sum = values => values.reduce((a, b) => a + b, 0);
  const fail = message => { throw new Error(message); };
  function addYears(day, amount) {
    const d = new Date(time(day)), target = d.getUTCFullYear() + amount, month = d.getUTCMonth();
    d.setUTCFullYear(target);
    if (d.getUTCMonth() !== month) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  function validateHistory(asset, history) {
    if (!history || history.schemaVersion !== 1 || history.id !== asset.id || history.currency !== asset.currency) fail(asset.name + '：历史身份或币种不一致');
    if (!['provider_adjusted_close', 'provider_daily_return_or_explicit_actions'].includes(history.basis) || history.dividends !== 'reinvested') fail(asset.name + '：缺含分红再投资的历史口径');
    if (!Array.isArray(history.series) || history.series.length < 2) fail(asset.name + '：每日历史不足两条');
    let previous = '';
    for (const row of history.series) {
      if (!Array.isArray(row) || !M.validDate(row[0]) || row[0] <= previous || !finite(row[1]) || row[1] <= 0) fail(asset.name + '：历史日期或数值无效');
      previous = row[0];
    }
    if (history.first !== history.series[0][0] || history.asOf !== previous) fail(asset.name + '：历史日期与元数据不一致');
    return history.series;
  }
  function at(series, day, maxGap = 14) {
    let lo = 0, hi = series.length - 1, index = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid][0] <= day) { index = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (index < 0 || gap(series[index][0], day) > maxGap) return null;
    return { day: series[index][0], value: series[index][1], carried: series[index][0] !== day };
  }
  function annualReturn(ratio, start, end) {
    const years = gap(start, end) / YEAR;
    return finite(ratio) && ratio >= 0 && years > 0 ? (Math.pow(ratio, 1 / Math.max(1, years)) - 1) * 100 : null;
  }
  function amountFromWeight(total, weight) {
    return finite(total) && total >= 0 && finite(weight) && weight >= 0 ? total * weight / 100 : NaN;
  }
  function weightFromAmount(total, amount) {
    return finite(total) && total > 0 && finite(amount) && amount >= 0 ? amount / total * 100 : NaN;
  }
  function allocation(positions, assets) {
    const byId = new Map(assets.map(a => [a.id, a]));
    const result = { etf: 0, stock: 0, fund: 0, cash: 0, unclassified: 0, total: 0, x2: 0, x3: 0, invalid: false };
    for (const p of positions) {
      if (!finite(p.weight) || p.weight < 0 || p.weight > 100) { result.invalid = true; continue; }
      result.total += p.weight;
      const a = byId.get(p.id);
      result[['etf', 'stock', 'fund'].includes(a?.kind) ? a.kind : 'unclassified'] += p.weight;
      if (a?.kind === 'etf' && a.leverage === 2) result.x2 += p.weight;
      if (a?.kind === 'etf' && a.leverage === 3) result.x3 += p.weight;
    }
    result.cash = Math.max(0, 100 - result.total);
    result.invalid ||= result.total > 100 + EPS || result.unclassified > EPS;
    return result;
  }
  function validateConfig(config, ids) {
    if (!config || !Array.isArray(config.positions) || !config.positions.length) fail('先添加组合标的并设置权重');
    const used = new Set();
    const positions = config.positions.filter(p => {
      if (!p || !ids.has(p.id) || used.has(p.id)) fail('组合含未收录或重复的标的');
      used.add(p.id);
      if (!finite(p.weight) || p.weight < 0 || p.weight > 100) fail('每项权重须在0至100%之间');
      return p.weight > 0;
    });
    const total = sum(positions.map(p => p.weight));
    if (!positions.length) fail('至少一个标的的权重需要大于0');
    if (total > 100 + EPS) fail('权重合计超过100%；请调整权重');
    if (!finite(config.initial) || config.initial < 0 || config.initial > 1e12 || !finite(config.monthly) || config.monthly < 0 || config.monthly > 1e10 || config.initial + config.monthly <= 0) fail('初始投入与每月投入须为有效非负金额，至少一项大于0');
    if (!finite(config.transactionFee) || config.transactionFee < 0 || config.transactionFee > 5) fail('交易费率须在0至5%之间');
    if (!['none', 'month', 'quarter', 'year'].includes(config.rebalance)) fail('再平衡周期无效');
    if (!['net', 'gross_estimate'].includes(config.feeBasis)) fail('年费口径无效');
    if (![1, 2, 3, 5, 10, 'common', 'custom'].includes(config.years)) fail('回测区间无效');
    if (config.years === 'custom' && (!M.validDate(config.start) || !M.validDate(config.end) || config.start >= config.end)) fail('请填写有效且先后有序的起止日期');
    return { positions, total, cashWeight: Math.max(0, 1 - total / 100) };
  }
  function periodKey(day, frequency) {
    if (frequency === 'month') return day.slice(0, 7);
    if (frequency === 'quarter') return day.slice(0, 4) + '-' + Math.floor((Number(day.slice(5, 7)) - 1) / 3);
    return day.slice(0, 4);
  }
  function simulate(input) {
    try { return run(input); } catch (error) { return { error: error.message }; }
  }
  function simulateWindows(input, end, periods = [3, 5]) {
    return periods.map(years => ({ years, ...simulate({ ...input,
      config: { ...input.config, years: 'custom', start: addYears(end, -years), end } }) }));
  }
  function run({ catalog, histories, config, fxHistory }) {
    const assets = new Map((catalog?.assets || []).map(a => [a.id, a]));
    const { positions, total, cashWeight } = validateConfig(config, new Set(assets.keys()));
    const series = positions.map(position => {
      const asset = assets.get(position.id);
      if (asset.status !== 'available') fail(asset.name + '：' + (asset.missing || '缺每日历史'));
      if (!['CNY', 'USD'].includes(asset.currency)) fail(asset.name + '：币种未接入');
      const history = histories[position.id];
      const rows = validateHistory(asset, history);
      const info = M.annualFeeInfo({ ...asset, n: asset.name }, config.feeOverrides?.[asset.code]);
      if (config.feeBasis === 'gross_estimate' && info.applicable && info.rate === null) fail(asset.name + '：' + info.missing + '，请填写有效年费率或选择扣除年费');
      return { asset, rows, dates: new Set(rows.map(r => r[0])), weight: position.weight / 100,
        feeRate: config.feeBasis === 'gross_estimate' && info.applicable ? info.rate : 0 };
    });
    const needsFx = series.some(s => s.asset.currency === 'USD');
    let fx = null;
    if (needsFx) {
      if (catalog.fx?.status !== 'available') fail(catalog.fx?.missing || '缺美元兑人民币日汇率');
      fx = validateHistory(catalog.fx, fxHistory);
    }
    const first = [ ...series.map(s => s.rows[0][0]), ...(fx ? [fx[0][0]] : []) ].sort().at(-1);
    const last = [ ...series.map(s => s.rows.at(-1)[0]), ...(fx ? [fx.at(-1)[0]] : []) ].sort()[0];
    if (first >= last) fail('所选标的没有可回测的共同历史');
    const shortest = series.reduce((a, b) => a.rows.length < b.rows.length ? a : b);
    const common = shortest.rows.map(r => r[0]).filter(day => day >= first && day <= last && series.every(s => s.dates.has(day)) && (!fx || at(fx, day, 7)));
    if (common.length < 2) fail('所选标的缺两次共同实际交易日，无法建仓与回测');
    const commonSet = new Set(common);
    const requestedEnd = config.years === 'custom' ? config.end : last;
    if (requestedEnd > last) fail('结束日超过共同历史末日 ' + last);
    const requestedStart = config.years === 'common' ? common[0] : config.years === 'custom' ? config.start : addYears(requestedEnd, -config.years);
    if (requestedStart < first) {
      const latest = series.filter(s => s.rows[0][0] === first).map(s => s.asset.name).join('、') || '人民币汇率';
      fail(latest + '的历史始于 ' + first + '，不覆盖所选区间；可选择“共同历史”');
    }
    const start = common.filter(day => day <= requestedStart).at(-1);
    if (!start || gap(start, requestedStart) > 14) fail('开始日前14日内缺共同实际交易日；可选择“共同历史”或调整日期');
    const days = [...new Set([...series.flatMap(s => s.rows.map(r => r[0])), ...(fx ? fx.map(r => r[0]) : [])])].filter(day => day >= start && day <= requestedEnd).sort();
    const end = days.at(-1);
    if (!end || end <= start || gap(end, requestedEnd) > 14) fail('结束日前14日内缺有效估值，无法回测');
    for (const s of series) {
      for (let i = 1; i < s.rows.length; i++) {
        const a = s.rows[i - 1][0], b = s.rows[i][0];
        if (b > start && a < end && gap(a, b) > 14) fail(s.asset.name + '在 ' + a + ' — ' + b + ' 存在超过14日的报价缺口，请缩短回测区间');
      }
    }
    const pricesAt = day => series.map(s => {
      const observation = at(s.rows, day);
      if (!observation) fail(s.asset.name + '在 ' + day + ' 前缺14日内有效价格');
      const quote = s.asset.currency === 'USD' ? at(fx, day, 7) : null;
      if (s.asset.currency === 'USD' && !quote) fail(day + ' 前缺7日内美元兑人民币实际汇率');
      const feeFactor = s.feeRate ? M.annualFeeFactor(s.feeRate, start, day) : 1;
      return { value: observation.value * (quote?.value || 1) * feeFactor,
        carried: observation.carried, fxCarried: !!quote?.carried };
    });
    const units = series.map(() => 0), bought = series.map(() => 0), sold = series.map(() => 0), costs = series.map(() => 0);
    const fee = config.transactionFee / 100, transactions = [], flows = [];
    let cash = 0, contributed = 0, fundUnits = 0, tradeCost = 0, rebalances = 0, deposits = 0;
    let lastMonth = start.slice(0, 7), lastBalance = periodKey(start, config.rebalance), peak = 1, mdd = 0;
    let carriedPrices = 0, carriedFx = 0;
    const value = prices => cash + sum(units.map((unit, i) => unit * prices[i]));
    const trade = (day, prices, deltas, fees, reason) => {
      deltas.forEach((delta, i) => {
        if (Math.abs(delta) > EPS) {
          units[i] += delta / prices[i];
          if (delta > 0) bought[i] += delta; else sold[i] -= delta;
          costs[i] += fees[i];
          transactions.push({ day, id: series[i].asset.id, side: delta > 0 ? 'buy' : 'sell', amount: Math.abs(delta), fee: fees[i], reason });
        }
      });
      const charge = sum(fees);
      cash -= sum(deltas) + charge;
      if (cash < -1e-5) fail('交易费用超过可用现金');
      if (Math.abs(cash) < 1e-5) cash = 0;
      tradeCost += charge;
    };
    function rebalance(day, prices, reason) {
      const wealth = value(prices), previous = units.map((u, i) => u * prices[i]);
      let lo = 0, hi = wealth;
      if (fee) {
        for (let i = 0; i < 70; i++) {
          const charge = (lo + hi) / 2;
          const implied = fee * sum(series.map((s, k) => Math.abs(s.weight * (wealth - charge) - previous[k])));
          if (implied > charge) lo = charge; else hi = charge;
        }
      } else hi = 0;
      const usable = wealth - hi, deltas = series.map((s, i) => s.weight * usable - previous[i]);
      trade(day, prices, deltas, deltas.map(delta => Math.abs(delta) * fee), reason);
      if (reason === 'rebalance') rebalances++;
    }
    function deposit(day, amount, prices, initial) {
      if (!amount) return;
      const before = value(prices), nav = fundUnits ? before / fundUnits : 1;
      if (!finite(nav) || nav <= 0) fail('组合净值无效');
      fundUnits += amount / nav;
      cash += amount; contributed += amount; deposits++;
      flows.push([day, -amount]);
      if (initial) rebalance(day, prices, 'initial');
      else {
        const usable = amount / (1 + fee * total / 100);
        const deltas = series.map(s => usable * s.weight);
        trade(day, prices, deltas, deltas.map(delta => delta * fee), 'contribution');
      }
    }
    const curve = [];
    for (const day of days) {
      const observations = pricesAt(day), prices = observations.map(p => p.value);
      carriedPrices += observations.filter(p => p.carried).length;
      if (observations.some(p => p.fxCarried)) carriedFx++;
      if (day === start) deposit(day, config.initial || config.monthly, prices, true);
      else if (commonSet.has(day)) {
        if (config.monthly && day.slice(0, 7) !== lastMonth) {
          deposit(day, config.monthly, prices, false);
          lastMonth = day.slice(0, 7);
        }
        const balance = periodKey(day, config.rebalance);
        if (config.rebalance !== 'none' && balance !== lastBalance) {
          rebalance(day, prices, 'rebalance'); lastBalance = balance;
        }
      }
      const account = value(prices), nav = account / fundUnits;
      peak = Math.max(peak, nav); mdd = Math.min(mdd, (nav / peak - 1) * 100);
      curve.push({ day, value: account, contributed, profit: account - contributed, nav, totalReturn: (nav - 1) * 100,
        annualReturn: day === start ? (nav - 1) * 100 : annualReturn(nav, start, day), drawdown: (nav / peak - 1) * 100 });
    }
    const final = curve.at(-1), prices = pricesAt(end).map(p => p.value);
    flows.push([end, final.value]);
    const returns = curve.slice(1).map((p, i) => p.nav / curve[i].nav - 1);
    const mean = returns.length ? sum(returns) / returns.length : 0;
    const volatility = returns.length > 1 ? Math.sqrt(sum(returns.map(r => (r - mean) ** 2)) / (returns.length - 1) * 250) * 100 : null;
    const holdings = series.map((s, i) => ({ id: s.asset.id, code: s.asset.code, name: s.asset.name,
      targetWeight: s.weight * 100, actualWeight: final.value ? units[i] * prices[i] / final.value * 100 : 0,
      value: units[i] * prices[i], bought: bought[i], sold: sold[i], transactionCost: costs[i],
      profit: units[i] * prices[i] + sold[i] - bought[i] - costs[i], first: s.rows[0][0], asOf: s.rows.at(-1)[0],
      basis: histories[s.asset.id].basis, currency: s.asset.currency, feeRate: s.feeRate,
      leveraged: (s.asset.leverage || 1) > 1 }));
    if (Math.abs(sum(holdings.map(h => h.profit)) - final.profit) > Math.max(1e-4, contributed * 1e-10)) fail('组合持仓盈亏未与账户勾稽');
    const annual = [];
    let base = 1, year = curve[0].day.slice(0, 4), from = start;
    for (let i = 0; i < curve.length; i++) {
      if (i === curve.length - 1 || curve[i + 1].day.slice(0, 4) !== year) {
        const p = curve[i];
        annual.push({ year, start: from, end: p.day, return: (p.nav / base - 1) * 100 });
        base = p.nav;
        if (curve[i + 1]) { year = curve[i + 1].day.slice(0, 4); from = curve[i + 1].day; }
      }
    }
    let benchmark = null, benchmarkError = null;
    if (config.benchmarkId) {
      try {
        const asset = assets.get(config.benchmarkId), history = histories[config.benchmarkId];
        if (!asset || asset.status !== 'available') fail('对照标的缺有效每日历史');
        const rows = validateHistory(asset, history);
        let benchmarkFx = fx;
        if (asset.currency === 'USD' && !benchmarkFx) benchmarkFx = validateHistory(catalog.fx, fxHistory);
        if (rows[0][0] > start || rows.at(-1)[0] < end || benchmarkFx && (benchmarkFx[0][0] > start || benchmarkFx.at(-1)[0] < end)) fail('对照标的的历史不覆盖组合区间');
        const info = M.annualFeeInfo({ ...asset, n: asset.name }, config.feeOverrides?.[asset.code]);
        if (config.feeBasis === 'gross_estimate' && info.applicable && info.rate === null) fail('对照标的' + info.missing);
        const rate = config.feeBasis === 'gross_estimate' && info.applicable ? info.rate : 0;
        const quote = day => {
          const p = at(rows, day), f = asset.currency === 'USD' ? at(benchmarkFx, day, 7) : null;
          if (!p || asset.currency === 'USD' && !f) fail('对照标的在 ' + day + ' 缺可用价格或汇率');
          return p.value * (f?.value || 1) * (rate ? M.annualFeeFactor(rate, start, day) : 1);
        };
        const base = quote(start);
        const points = curve.map(p => ({ day: p.day, nav: quote(p.day) / base }));
        benchmark = { id: asset.id, name: asset.name, curve: points, totalReturn: (points.at(-1).nav - 1) * 100,
          annualReturn: annualReturn(points.at(-1).nav, start, end) };
      } catch (error) { benchmarkError = error.message; }
    }
    return { start, end, requestedStart, requestedEnd, commonFirst: common[0], commonLast: common.at(-1),
      totalReturn: final.totalReturn, annualReturn: annualReturn(final.nav, start, end), value: final.value,
      contributed, profit: final.profit, mdd, volatility, cash, cashWeight: cashWeight * 100, holdings, curve, annual,
      // A short-period money-weighted figure is left unannualized rather than
      // exaggerating one month's change into a full-year compound rate.
      xirr: gap(start, end) / YEAR >= 1 ? M.buyLocationXirr(flows) : null,
      deposits, rebalances, transactions, tradeCost, carriedPrices, carriedFx, benchmark, benchmarkError,
      config: JSON.parse(JSON.stringify(config)) };
  }
  function sanitizeDraft(value, ids) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.positions)) fail('组合配置格式无效');
    const positions = value.positions.map(p => ({ id: p.id, weight: p.weight }));
    const config = { positions, initial: value.initial, monthly: value.monthly, rebalance: value.rebalance,
      years: value.years, start: value.start || '', end: value.end || '', transactionFee: value.transactionFee,
      feeBasis: value.feeBasis || 'net', feeOverrides: value.feeOverrides || {}, benchmarkId: value.benchmarkId || '' };
    validateConfig(config, ids);
    if (config.benchmarkId && !ids.has(config.benchmarkId)) fail('对照标的未收录');
    for (const [code, rate] of Object.entries(config.feeOverrides)) {
      if (!/^(\d{6}|[A-Z]{1,6})$/.test(code) || !finite(rate) || rate < 0 || rate >= 100) fail('自定义年费率无效');
    }
    return config;
  }
  return { simulate, simulateWindows, validateHistory, validateConfig, sanitizeDraft, allocation, amountFromWeight, weightFromAmount, at, annualReturn, addYears };
});
