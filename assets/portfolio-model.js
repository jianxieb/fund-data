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
  const initialMethods = [
    ['lump_sum', '一次性投入'], ['tranche_6', '6个月分批投入'], ['tranche_12', '12个月分批投入'],
    ['tranche_24', '24个月分批投入'], ['drawdown_ladder', '回撤阶梯投入'], ['ma200_hold', '200日均线择时']
  ];
  const contributionMethods = [
    ['dca_month', '每月定投'], ['dca_quarter', '每季度定投'], ['dca_year', '每年定投'],
    ['dca_drawdown', '回撤倍数定投'], ['dca_ma_trend', '均线顺势定投'], ['dca_ma_contrarian', '均线逆势定投']
  ];
  function strategyConfig(config) {
    const strategy = { initialMethod: config.initialMethod ?? 'lump_sum', contributionMethod: config.contributionMethod ?? 'dca_month' };
    if (!initialMethods.some(([key]) => key === strategy.initialMethod) || !contributionMethods.some(([key]) => key === strategy.contributionMethod)) fail('投入方式无效');
    return strategy;
  }
  function strategyNames(config) {
    const strategy = strategyConfig(config);
    return { initial: initialMethods.find(([key]) => key === strategy.initialMethod)[1], contribution: contributionMethods.find(([key]) => key === strategy.contributionMethod)[1] };
  }
  const taxDefaults = { usCapitalGains: 0, usDividend: 0, cnStockCapitalGains: 0, cnStockDividend: 0,
    cnFundCapitalGains: 0, cnFundDividend: 0, liquidate: false, overrides: {} };
  function taxConfig(value) {
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(taxDefaults, k)))) fail('模拟税费配置无效');
    if (value?.overrides !== undefined && (!value.overrides || typeof value.overrides !== 'object' || Array.isArray(value.overrides))) fail('单项税率配置无效');
    const tax = { ...taxDefaults, ...value, overrides: { ...(value?.overrides || {}) } };
    for (const key of Object.keys(taxDefaults).filter(k => !['liquidate', 'overrides'].includes(k))) {
      if (!finite(tax[key]) || tax[key] < 0 || tax[key] > 100) fail('模拟税率须在0至100%之间');
    }
    if (typeof tax.liquidate !== 'boolean') fail('期末清仓设置无效');
    for (const rates of Object.values(tax.overrides)) {
      if (!rates || typeof rates !== 'object' || Array.isArray(rates) || Object.keys(rates).some(k => !['gain', 'dividend'].includes(k)) ||
          Object.values(rates).some(r => !finite(r) || r < 0 || r > 100)) fail('单项标的税率须在0至100%之间');
    }
    return tax;
  }
  function taxRates(asset, value) {
    const tax = taxConfig(value), group = asset.market === 'us' || asset.currency === 'USD' ? 'us' : asset.kind === 'stock' ? 'cnStock' : 'cnFund';
    return { gain: tax.overrides[asset.id]?.gain ?? tax[group + 'CapitalGains'], dividend: tax.overrides[asset.id]?.dividend ?? tax[group + 'Dividend'] };
  }
  function validateDividendEvidence(asset, history, start, end, rates) {
    if (!rates.dividend && !rates.gain) return;
    const evidence = history.dividendEvidence;
    if (evidence?.status !== 'recorded' || !M.validDate(evidence.first) || !M.validDate(evidence.through) || evidence.first > start || evidence.through < end || !evidence.fractions || typeof evidence.fractions !== 'object' || Array.isArray(evidence.fractions)) {
      fail(asset.name + '：' + (evidence?.missing || (evidence?.first ? '现金分红与除权明细仅覆盖 ' + evidence.first + ' — ' + evidence.through : '缺覆盖模拟区间的现金分红与除权明细')) + '，无法计算分红税或分红再投成本');
    }
    const dates = new Set(history.series.map(r => r[0]));
    if (Object.entries(evidence.fractions).some(([day, fraction]) => !M.validDate(day) || !finite(fraction) || fraction < 0 || fraction >= 1 || !dates.has(day))) fail(asset.name + '：分红税依据日期或比例无效');
  }
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
  function annualVolatility(values) {
    const returns = values.slice(1).map((value, i) => value / values[i] - 1);
    if (returns.length < 2) return null;
    const mean = sum(returns) / returns.length;
    return Math.sqrt(sum(returns.map(r => (r - mean) ** 2)) / (returns.length - 1) * 250) * 100;
  }
  function holdingXirr(flows) {
    const byDay = new Map();
    flows.forEach(([day, amount]) => byDay.set(day, (byDay.get(day) || 0) + amount));
    const entries = [...byDay].sort(([a], [b]) => a.localeCompare(b)).filter(([, amount]) => Math.abs(amount) > EPS);
    if (!entries.some(([, a]) => a < 0) || !entries.some(([, a]) => a > 0)) return null;
    const terms = entries.map(([day, amount]) => [gap(entries[0][0], day) / YEAR, amount]);
    // Rebalancing can produce several cash-flow sign changes. Search for distinct
    // roots in log(1 + rate), rather than assuming the NPV is monotone.
    const npv = logRate => {
      const scale = Math.max(...terms.map(([years]) => -years * logRate));
      return sum(terms.map(([years, amount]) => amount * Math.exp(-years * logRate - scale)));
    };
    const roots = [], limit = Math.log(1e8), steps = 512;
    let a = -limit, fa = npv(a);
    for (let i = 1; i <= steps; i++) {
      const b = -limit + 2 * limit * i / steps, fb = npv(b);
      if (fa === 0) roots.push(a);
      else if (fa * fb < 0) {
        let low = a, high = b, flow = fa;
        for (let j = 0; j < 70; j++) {
          const mid = (low + high) / 2, fm = npv(mid);
          if (flow * fm <= 0) high = mid; else { low = mid; flow = fm; }
        }
        roots.push((low + high) / 2);
      }
      a = b; fa = fb;
    }
    const distinct = roots.filter((r, i) => !i || Math.abs(r - roots[i - 1]) > 1e-7);
    return distinct.length === 1 ? Math.expm1(distinct[0]) * 100 : null;
  }
  function holdingPerformance(rows, trades, terminalValue) {
    const start = trades.find(t => t.side === 'buy')?.day, end = rows.at(-1)[0];
    const activeRows = start ? rows.filter(([day]) => day >= start) : [];
    const invested = sum(trades.filter(t => t.side === 'buy').map(t => t.amount + t.fee));
    const returned = sum(trades.filter(t => t.side === 'sell').map(t => t.amount - t.fee - (t.tax || 0)));
    const profit = terminalValue + returned - invested;
    const totalReturn = invested > 0 ? profit / invested * 100 : null;
    const flows = trades.map(t => [t.day, t.side === 'buy' ? -(t.amount + t.fee) : t.amount - t.fee - (t.tax || 0)]);
    flows.push([end, terminalValue]);
    const short = !start || gap(start, end) < YEAR;
    const annual = short ? totalReturn : holdingXirr(flows);
    let peak = 1, mdd = 0;
    for (const [, value] of activeRows) {
      peak = Math.max(peak, value);
      mdd = Math.min(mdd, (value / peak - 1) * 100);
    }
    return { start, end, totalReturn, annualReturn: annual, mdd, invested, returned, profit, flows,
      annualBasis: short ? 'under_one_year_total_return' : 'money_weighted_xirr',
      annualMissing: !start ? '模拟区间内未买入' : annual === null ? '资金流未找到唯一年化解' : null,
      volatility: annualVolatility(activeRows.map(row => row[1])), observations: activeRows.length,
      currency: 'CNY', dividends: 'reinvested', transactionFeesIncluded: true,
      riskBasis: 'actual_holding_flow_adjusted_nav' };
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
    strategyConfig(config);
    const tax = taxConfig(config.tax);
    if (Object.keys(tax.overrides).some(id => !ids.has(id))) fail('单项税率含未收录的标的');
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
  function simulateWindows(input, end, periods = [1, 2, 3, 5]) {
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
      return { asset, rows, dividendEvidence: history.dividendEvidence, tax: taxRates(asset, config.tax), dates: new Set(rows.map(r => r[0])), weight: position.weight / 100,
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
    series.forEach(s => validateDividendEvidence(s.asset, histories[s.asset.id], start, end, s.tax));
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
    const strategy = strategyConfig(config), strategyDays = common.filter(day => day >= start && day <= end);
    const months = strategyDays.filter((day, i) => !i || day.slice(0, 7) !== strategyDays[i - 1].slice(0, 7));
    // Signals use a separate target-weight reference, without investor cash flows,
    // fees or taxes. Each close is formed only from prices already published.
    const signals = new Map(), needsSignal = strategy.initialMethod === 'drawdown_ladder' && config.initial > 0 ||
      strategy.initialMethod === 'ma200_hold' && config.initial > 0 || config.monthly > 0 && ['dca_drawdown', 'dca_ma_trend', 'dca_ma_contrarian'].includes(strategy.contributionMethod);
    let warmupDays = 0, insufficientMaDays = 0;
    if (needsSignal) {
      const warmDays = common.filter(day => day < start).slice(-200), referenceDays = [...warmDays, ...strategyDays];
      let reference = 1, referencePeak = null, previous = null, previousDay = null, closes = [];
      for (const day of referenceDays) {
        if (previousDay && gap(previousDay, day) > 14 && day <= start) { closes = []; previous = null; }
        const historyCount = closes.length;
        const trend = historyCount < 200 ? null : closes.at(-1) > sum(closes.slice(-200)) / 200;
        const drawdown = referencePeak === null || !historyCount ? 0 : Math.min(0, closes.at(-1) / referencePeak - 1);
        if (day >= start) {
          signals.set(day, { trend, drawdown, historyCount });
          if (day === start) warmupDays = historyCount;
          if (trend === null) insufficientMaDays++;
        }
        const current = pricesAt(day).map(p => p.value);
        if (previous) reference *= cashWeight + sum(series.map((s, i) => s.weight * current[i] / previous[i]));
        closes.push(reference); if (closes.length > 200) closes.shift();
        if (day >= start) referencePeak = Math.max(referencePeak ?? reference, reference);
        previous = current; previousDay = day;
      }
    }
    const initialPlan = new Map();
    if (config.initial > 0) {
      if (strategy.initialMethod.startsWith('tranche_')) {
        const count = Number(strategy.initialMethod.split('_')[1]);
        months.slice(0, count).forEach(day => initialPlan.set(day, config.initial / count));
      } else if (strategy.initialMethod === 'drawdown_ladder') {
        initialPlan.set(start, config.initial / 4);
        const hit = new Set(); let left = config.initial * .75;
        for (const day of strategyDays.slice(1)) {
          if (day === months[36]) { initialPlan.set(day, (initialPlan.get(day) || 0) + left); left = 0; break; }
          for (const threshold of [.1, .2, .3]) {
            if (!hit.has(threshold) && signals.get(day).drawdown <= -threshold + 1e-12 && left > EPS) {
              const amount = Math.min(config.initial / 4, left);
              initialPlan.set(day, (initialPlan.get(day) || 0) + amount); left -= amount; hit.add(threshold);
            }
          }
        }
      } else initialPlan.set(start, config.initial);
    }
    const incomePlan = new Map(), incomeMonths = config.initial > 0 ? months.slice(1) : months;
    if (config.monthly > 0) {
      if (['dca_quarter', 'dca_year'].includes(strategy.contributionMethod)) {
        // The quarterly/annual choice pre-funds that period's planned budget;
        // the final incomplete period uses only months inside this window.
        const frequency = strategy.contributionMethod === 'dca_quarter' ? 'quarter' : 'year';
        const groups = new Map();
        incomeMonths.forEach(day => { const key = periodKey(day, frequency); const group = groups.get(key) || []; group.push(day); groups.set(key, group); });
        for (const group of groups.values()) incomePlan.set(group[0], config.monthly * group.length);
      } else for (const day of incomeMonths) {
        const signal = signals.get(day); let multiplier = 1;
        if (strategy.contributionMethod === 'dca_drawdown') multiplier = signal.drawdown > -.1 + 1e-12 ? 1 : signal.drawdown > -.2 + 1e-12 ? 1.5 : signal.drawdown > -.3 + 1e-12 ? 2 : 3;
        else if (signal?.trend === false && strategy.contributionMethod === 'dca_ma_trend') multiplier = .5;
        else if (signal?.trend === false && strategy.contributionMethod === 'dca_ma_contrarian') multiplier = 2;
        incomePlan.set(day, config.monthly * multiplier);
      }
    }
    const units = series.map(() => 0), bought = series.map(() => 0), sold = series.map(() => 0), costs = series.map(() => 0);
    const basis = series.map(() => 0), capitalTaxes = series.map(() => 0), dividendTaxes = series.map(() => 0), taxEvents = [];
    const tax = taxConfig(config.tax);
    const holdingNav = series.map(() => 1);
    const fee = config.transactionFee / 100, transactions = [], flows = [];
    let cash = 0, contributed = 0, fundUnits = 0, tradeCost = 0, rebalances = 0, deposits = 0;
    let lastBalance = periodKey(start, config.rebalance), peak = 1, mdd = 0;
    let initialReserve = config.initial, exposure = 1, timingChanges = 0;
    const timing = config.initial > 0 && strategy.initialMethod === 'ma200_hold';
    let carriedPrices = 0, carriedFx = 0;
    const value = prices => cash + sum(units.map((unit, i) => unit * prices[i]));
    const saleTax = (i, amount, price, saleFee) => {
      const disposedBasis = units[i] > EPS ? basis[i] * amount / (units[i] * price) : 0;
      const gain = Math.max(0, amount - saleFee - disposedBasis);
      return { disposedBasis, gain, tax: gain * series[i].tax.gain / 100 };
    };
    const trade = (day, prices, deltas, fees, reason) => {
      let taxCharge = 0;
      deltas.forEach((delta, i) => {
        if (Math.abs(delta) > EPS) {
          const before = units[i] * prices[i];
          const sale = delta < 0 ? saleTax(i, -delta, prices[i], fees[i]) : { disposedBasis: 0, gain: 0, tax: 0 };
          holdingNav[i] *= delta > 0 ? (before + delta) / (before + delta + fees[i]) : (before - fees[i] - sale.tax) / before;
          basis[i] += delta > 0 ? delta + fees[i] : -sale.disposedBasis;
          capitalTaxes[i] += sale.tax; taxCharge += sale.tax;
          if (delta < 0) taxEvents.push({ day, id: series[i].asset.id, type: 'capital', proceeds: -delta, basis: sale.disposedBasis, gain: sale.gain, rate: series[i].tax.gain, tax: sale.tax });
          units[i] += delta / prices[i];
          if (delta > 0) bought[i] += delta; else sold[i] -= delta;
          costs[i] += fees[i];
          transactions.push({ day, id: series[i].asset.id, side: delta > 0 ? 'buy' : 'sell', amount: Math.abs(delta), fee: fees[i], tax: sale.tax, reason });
        }
      });
      const charge = sum(fees);
      cash -= sum(deltas) + charge + taxCharge;
      if (cash < -1e-5) fail('交易费用超过可用现金');
      if (Math.abs(cash) < 1e-5) cash = 0;
      tradeCost += charge;
    };
    function rebalance(day, prices, reason, targetExposure = exposure) {
      const wealth = Math.max(0, value(prices) - initialReserve), previous = units.map((u, i) => u * prices[i]);
      let lo = 0, hi = wealth;
      if (fee || series.some(s => s.tax.gain > 0)) {
        for (let i = 0; i < 70; i++) {
          const charge = (lo + hi) / 2;
          const implied = sum(series.map((s, k) => {
            const delta = targetExposure * s.weight * (wealth - charge) - previous[k], tradeFee = Math.abs(delta) * fee;
            return tradeFee + (delta < 0 ? saleTax(k, -delta, prices[k], tradeFee).tax : 0);
          }));
          if (implied > charge) lo = charge; else hi = charge;
        }
      } else hi = 0;
      const usable = wealth - hi, deltas = series.map((s, i) => targetExposure * s.weight * usable - previous[i]);
      trade(day, prices, deltas, deltas.map(delta => Math.abs(delta) * fee), reason);
      if (reason === 'rebalance') rebalances++;
    }
    function deposit(day, amount, prices) {
      if (!amount) return;
      const before = value(prices), nav = fundUnits ? before / fundUnits : 1;
      if (!finite(nav) || nav <= 0) fail('组合净值无效');
      fundUnits += amount / nav;
      cash += amount; contributed += amount; deposits++;
      flows.push([day, -amount]);
    }
    function invest(day, amount, prices, reason) {
      if (amount <= EPS || !exposure) return;
      const usable = amount / (1 + fee * total / 100);
      const deltas = series.map(s => usable * s.weight);
      trade(day, prices, deltas, deltas.map(delta => delta * fee), reason);
    }
    const curve = [], holdingPaths = series.map(() => []), fxDates = new Set((fx || []).map(row => row[0]));
    let lastPrices = null;
    for (const day of days) {
      const observations = pricesAt(day), prices = observations.map(p => p.value);
      series.forEach((s, i) => {
        if (lastPrices && units[i] > EPS) holdingNav[i] *= prices[i] / lastPrices[i];
        const fraction = s.dividendEvidence?.fractions?.[day] || 0;
        if (units[i] > EPS && fraction > 0 && day > start) {
          const before = units[i] * prices[i], gross = before * fraction, charge = gross * s.tax.dividend / 100;
          // Adjusted prices already reinvest the gross distribution. Remove only
          // its tax; net reinvestment adds cost basis without a second cash payment.
          units[i] -= charge / prices[i]; basis[i] += gross - charge;
          dividendTaxes[i] += charge;
          holdingNav[i] *= (before - charge) / before;
          taxEvents.push({ day, id: s.asset.id, type: 'dividend', gross, rate: s.tax.dividend, tax: charge, basisAdded: gross - charge });
        }
      });
      const tradesBefore = transactions.length;
      carriedPrices += observations.filter(p => p.carried).length;
      if (observations.some(p => p.fxCarried)) carriedFx++;
      if (commonSet.has(day)) {
        if (day === start) deposit(day, config.initial, prices);
        const released = Math.min(initialReserve, initialPlan.get(day) || 0), income = incomePlan.get(day) || 0;
        initialReserve = Math.max(0, initialReserve - released);
        deposit(day, income, prices);
        const nextExposure = timing && signals.get(day).trend === false ? 0 : 1;
        const switched = timing && (day === start ? nextExposure === 0 : nextExposure !== exposure);
        exposure = nextExposure;
        if (switched) { rebalance(day, prices, exposure ? 'timing_in' : 'timing_out'); if (day !== start) timingChanges++; }
        else {
          invest(day, released, prices, day === start ? 'initial' : 'initial_plan');
          invest(day, income, prices, 'contribution');
        }
        const balance = periodKey(day, config.rebalance);
        if (config.rebalance !== 'none' && day !== start && balance !== lastBalance) {
          rebalance(day, prices, 'rebalance'); lastBalance = balance;
        }
      }
      if (day === end && tax.liquidate) {
        const deltas = units.map((unit, i) => -unit * prices[i]);
        trade(day, prices, deltas, deltas.map(delta => -delta * fee), 'liquidation');
      }
      const traded = new Set(transactions.slice(tradesBefore).map(t => t.id));
      series.forEach((s, i) => {
        // Risk observes actual exposure and trade fees; external cash transfers
        // do not create gains or drawdowns. Extra foreign-market dates add no zeros.
        if (s.dates.has(day) || s.asset.currency === 'USD' && fxDates.has(day) || traded.has(s.asset.id) || day === start || day === end) holdingPaths[i].push([day, holdingNav[i]]);
      });
      lastPrices = prices;
      const account = value(prices), nav = account / fundUnits;
      peak = Math.max(peak, nav); mdd = Math.min(mdd, (nav / peak - 1) * 100);
      curve.push({ day, value: account, contributed, profit: account - contributed, nav, totalReturn: (nav - 1) * 100,
        annualReturn: day === start ? (nav - 1) * 100 : annualReturn(nav, start, day), drawdown: (nav / peak - 1) * 100, cash, initialReserve, exposure, taxCost: sum(capitalTaxes) + sum(dividendTaxes) });
    }
    const final = curve.at(-1), prices = pricesAt(end).map(p => p.value);
    flows.push([end, final.value]);
    const volatility = annualVolatility(curve.map(p => p.nav));
    const holdings = series.map((s, i) => ({ id: s.asset.id, code: s.asset.code, name: s.asset.name,
      targetWeight: s.weight * 100, actualWeight: final.value ? units[i] * prices[i] / final.value * 100 : 0,
      value: units[i] * prices[i], bought: bought[i], sold: sold[i], transactionCost: costs[i],
      profit: units[i] * prices[i] + sold[i] - bought[i] - costs[i] - capitalTaxes[i], first: s.rows[0][0], asOf: s.rows.at(-1)[0],
      capitalTax: capitalTaxes[i], dividendTax: dividendTaxes[i], taxCost: capitalTaxes[i] + dividendTaxes[i], costBasis: basis[i], taxRates: s.tax,
      basis: histories[s.asset.id].basis, currency: s.asset.currency, feeRate: s.feeRate,
      leveraged: (s.asset.leverage || 1) > 1,
      performance: holdingPerformance(holdingPaths[i], transactions.filter(t => t.id === s.asset.id), units[i] * prices[i]) }));
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
        const base = quote(start), rates = taxRates(asset, config.tax);
        validateDividendEvidence(asset, history, start, end, rates);
        let units = 1, basis = base, taxCost = 0;
        const values = new Map();
        const quoteDays = [...new Set([...rows.map(r => r[0]), ...curve.map(p => p.day)])].filter(day => day >= start && day <= end).sort();
        for (const day of quoteDays) {
          const price = quote(day), fraction = day > start ? history.dividendEvidence?.fractions?.[day] || 0 : 0;
          const gross = units * price * fraction, charge = gross * rates.dividend / 100;
          units -= charge / price; basis += gross - charge; taxCost += charge;
          let value = units * price;
          if (day === end && tax.liquidate) { const capital = Math.max(0, value - basis) * rates.gain / 100; value -= capital; taxCost += capital; }
          values.set(day, value);
        }
        const points = curve.map(p => ({ day: p.day, nav: values.get(p.day) / base }));
        benchmark = { id: asset.id, name: asset.name, curve: points, totalReturn: (points.at(-1).nav - 1) * 100,
          annualReturn: annualReturn(points.at(-1).nav, start, end), taxCost, taxRates: rates, taxBasis: 'same_simulation_rates' };
      } catch (error) { benchmarkError = error.message; }
    }
    return { start, end, requestedStart, requestedEnd, commonFirst: common[0], commonLast: common.at(-1),
      totalReturn: final.totalReturn, annualReturn: annualReturn(final.nav, start, end), value: final.value,
      contributed, profit: final.profit, mdd, volatility, cash, cashWeight: cashWeight * 100, holdings, curve, annual,
      // A short-period money-weighted figure is left unannualized rather than
      // exaggerating one month's change into a full-year compound rate.
      xirr: gap(start, end) / YEAR >= 1 ? M.buyLocationXirr(flows) : null,
      deposits, rebalances, transactions, tradeCost, initialReserve, timingChanges,
      strategy: { ...strategy, warmupDays, insufficientMaDays, signalBasis: 'prior_common_close_target_weight_reference' },
      plan: { initial: [...initialPlan].map(([day, amount]) => ({ day, amount })), income: [...incomePlan].map(([day, amount]) => ({ day, amount })) }, taxEvents, taxCost: sum(capitalTaxes) + sum(dividendTaxes), capitalTax: sum(capitalTaxes), dividendTax: sum(dividendTaxes), carriedPrices, carriedFx, benchmark, benchmarkError,
      config: JSON.parse(JSON.stringify(config)) };
  }
  function sanitizeDraft(value, ids) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.positions)) fail('组合配置格式无效');
    const positions = value.positions.map(p => ({ id: p.id, weight: p.weight }));
    const config = { positions, initial: value.initial, monthly: value.monthly, rebalance: value.rebalance,
      years: value.years, start: value.start || '', end: value.end || '', transactionFee: value.transactionFee,
      feeBasis: value.feeBasis || 'net', feeOverrides: value.feeOverrides || {}, benchmarkId: value.benchmarkId || '', tax: taxConfig(value.tax), ...strategyConfig(value) };
    validateConfig(config, ids);
    if (config.benchmarkId && !ids.has(config.benchmarkId)) fail('对照标的未收录');
    for (const [code, rate] of Object.entries(config.feeOverrides)) {
      if (!/^(\d{6}|[A-Z]{1,6})$/.test(code) || !finite(rate) || rate < 0 || rate >= 100) fail('自定义年费率无效');
    }
    return config;
  }
  return { simulate, simulateWindows, validateHistory, validateConfig, sanitizeDraft, allocation, amountFromWeight, weightFromAmount, at, annualReturn, holdingXirr, addYears, taxConfig, taxRates, strategyConfig, strategyNames, initialMethods, contributionMethods };
});
