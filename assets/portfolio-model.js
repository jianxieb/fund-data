(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./portfolio-systematic.js'));
  else root.ChanghengPortfolioModel = factory(root.Changheng, root.ChanghengPortfolioSystematic);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, Systematic) {
  'use strict';
  const DAY = 86400000, YEAR = 365.2425, EPS = 1e-8;
  const finite = M.finite;
  const time = day => Date.parse(day + 'T00:00:00Z');
  const gap = (a, b) => (time(b) - time(a)) / DAY;
  const sum = values => values.reduce((a, b) => a + b, 0);
  const fail = message => { throw new Error(message); };
  const failStrategy = message => { throw Object.assign(new Error(message), { field: 'initialMethod' }); };
  // Chart-only observations stay out of exported account ledgers and rolling-window comparisons.
  const chartSources = new WeakMap();
  function immutableCopy(value) {
    const cloned = JSON.parse(JSON.stringify(value));
    function freeze(item) {
      if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
      return item;
    }
    return freeze(cloned);
  }
  function additionAllocation(row, budget) {
    if (!row || !['ready', 'warming-up'].includes(row.status) || row.missing || row.liquidated) return null;
    if (!finite(budget) || budget < 0) fail('新增资金须为不小于0的有效金额');
    const positions = row.positions, feeRate = row.fee;
    if (!Array.isArray(positions) || !positions.length || !finite(feeRate) || feeRate < 0 ||
        positions.some(p => !p || typeof p.id !== 'string' || !finite(p.weight) || p.weight <= 0)) return null;
    const originalWeight = sum(positions.map(p => p.weight));
    if (originalWeight > 1 + 1e-10) return null;
    if (row.metadata?.opportunity) {
      const opportunity = row.metadata.opportunity, pair = ['us:USD', 'us:TQQQ'];
      const otherWeight = sum(positions.filter(p => !pair.includes(p.id)).map(p => p.weight));
      // New pair capital is cash first; each later purchase funds its own fee.
      const usable = budget / (1 + feeRate * otherWeight), parked = [];
      const orders = positions.map(p => {
        const leg = opportunity.legs?.find(l => l.id === p.id);
        const intensity = pair.includes(p.id) ? leg && finite(leg.score) && !leg.blockedByRisk && leg.score >= opportunity.threshold ?
          Math.max(0, Math.min(1, (leg.score - opportunity.threshold + 10) / (110 - opportunity.threshold))) : 0 : null;
        const amount = intensity === null ? usable * p.weight : usable * p.weight * intensity / (1 + feeRate);
        if (intensity !== null) parked.push({ id: p.id, amount: usable * p.weight * (1 - intensity) });
        return { id: p.id, code: p.code, name: p.name, targetWeight: budget ? amount / budget : 0, amount, fee: amount * feeRate };
      });
      const fee = sum(orders.map(o => o.fee)), parkedCash = sum(parked.map(p => p.amount));
      const originalCash = usable * Math.max(0, 1 - originalWeight);
      return { day: row.day, status: row.warmingUp ? 'waiting' : 'ready', reason: row.warmingUp ? '评分预热，相关新增资金暂留现金' : null,
        budget, currency: row.currency, feeRate, orders, parked, parkedCash, originalCash, fee,
        total: sum(orders.map(o => o.amount)) + fee + parkedCash + originalCash, basis: 'same_score_new_cash_no_tail_sweep' };
    }
    const desired = row.nextPlan?.desiredTargets || row.executedTargets;
    const parkedWeights = row.nextPlan?.parkedWeights || row.executedParked;
    if (![desired, parkedWeights].every(a => Array.isArray(a) && a.length === 2 && a.every(w => finite(w) && w >= 0))) return null;
    const pair = ['us:USD', 'us:TQQQ'];
    const targets = positions.map(p => pair.includes(p.id) ? desired[pair.indexOf(p.id)] : p.weight);
    if (Math.abs(sum(targets) + sum(parkedWeights) - originalWeight) > 1e-9) return null;
    // The same fee-funded budget as invest(): parked sleeves keep their
    // unspent buying fee, while the user's original cash allocation stays idle.
    const usable = budget / (1 + feeRate * originalWeight);
    const orders = positions.map((p, i) => ({ id: p.id, code: p.code, name: p.name, targetWeight: targets[i],
      amount: usable * targets[i], fee: usable * targets[i] * feeRate }));
    const parked = pair.map((id, i) => ({ id, amount: usable * parkedWeights[i] * (1 + feeRate) })).filter(p => p.amount > 0);
    const fee = sum(orders.map(p => p.fee)), parkedCash = sum(parked.map(p => p.amount));
    const originalCash = usable * Math.max(0, 1 - originalWeight);
    const total = sum(orders.map(p => p.amount)) + fee + parkedCash + originalCash;
    return { day: row.day, status: row.warmingUp ? 'fallback' : 'ready',
      reason: row.warmingUp ? row.metadata?.reason || '信号历史预热，按用户原比例分配' : null,
      budget, currency: row.currency, feeRate, orders, parked, parkedCash, originalCash, total, fee };
  }
  function currencyInfo(config = {}) {
    const code = config.currency === undefined ? 'CNY' : config.currency;
    if (!['CNY', 'USD'].includes(code)) fail('模拟币种须为人民币或美元');
    return { code, name: code === 'USD' ? '美元' : '人民币', unit: code === 'USD' ? 'USD' : '元' };
  }
  const initialMethods = [
    ['lump_sum', '一次性投入'], ['tranche_6', '6个月分批投入'], ['tranche_12', '12个月分批投入'],
    ['tranche_24', '24个月分批投入'], ['drawdown_ladder', '回撤阶梯投入'], ['ma200_hold', '200日均线择时'],
    ['cash_topup', '现金补足目标仓位'], ['qqq_bear_confirm', 'QQQ深熊确认调仓'],
    ['vix_panic_reentry', 'VIX恐慌恢复调仓'], ['relative_strength_rotation', '三批相对强弱轮动'], ['dual_risk_guard', '双重风险门调仓'],
    ['opportunity_discount_10', '低位评分加仓·10%预留'], ['opportunity_discount_20', '低位评分加仓·20%预留'],
    ['opportunity_mixed_10', '低位与恐慌评分加仓·10%预留']
  ];
  const contributionMethods = [
    ['dca_month', '每月定投'], ['dca_quarter', '每季度定投'], ['dca_year', '每年定投'],
    ['dca_drawdown', '回撤倍数定投'], ['dca_ma_trend', '均线顺势定投'], ['dca_ma_contrarian', '均线逆势定投']
  ];
  const comparisonMethods = initialMethods.filter(([id]) => !['lump_sum', 'tranche_6', 'tranche_12', 'tranche_24'].includes(id));
  function strategyConfig(config) {
    const strategy = { initialMethod: config.initialMethod ?? 'lump_sum', contributionMethod: config.contributionMethod ?? 'dca_month' };
    if (/^entry_(option|volatility|breadth|composite)$/.test(strategy.initialMethod)) failStrategy('原研究投入方式已撤回：未证明优于一次性投入，请重新选择本金投入方式');
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
  const dividendPolicies = [['reinvest', '自动再投资'], ['cash', '计入账户现金']];
  function dividendPolicyOf(config) {
    const policy = config.dividendPolicy === undefined ? 'reinvest' : config.dividendPolicy;
    if (!dividendPolicies.some(([id]) => id === policy)) fail('分红处理方式无效');
    return policy;
  }
  function validateDividendEvidence(asset, history, start, end, rates, policy) {
    if (policy !== 'cash' && !rates.dividend && !rates.gain) return;
    const evidence = history.dividendEvidence;
    if (evidence?.status !== 'recorded' || !M.validDate(evidence.first) || !M.validDate(evidence.through) || evidence.first > start || evidence.through < end || !evidence.fractions || typeof evidence.fractions !== 'object' || Array.isArray(evidence.fractions)) {
      fail(asset.name + '：' + (evidence?.missing || asset.dividendTaxData?.missing || (evidence?.first ? '现金分红与除权明细仅覆盖 ' + evidence.first + ' — ' + evidence.through : '缺覆盖模拟区间的现金分红与除权明细')) + (policy === 'cash' ? '，无法拆出现金分红' : '，无法计算分红税或分红再投成本'));
    }
    const dates = new Set(history.series.map(r => r[0]));
    if (Object.entries(evidence.fractions).some(([day, fraction]) => !M.validDate(day) || !finite(fraction) || fraction < 0 || fraction >= 1 || !dates.has(day))) fail(asset.name + '：分红依据日期或比例无效');
  }
  // An adjusted mark includes the gross distribution. Leaving dividends in cash
  // separates the ex-dividend price path from the payout, keeping existing real
  // share quantities (including yesterday's pending orders) unchanged.
  function distribution(units, price, fraction, rate, policy) {
    const gross = units * price * fraction, tax = gross * rate / 100;
    return policy === 'cash'
      ? { gross, tax, priceFactor: 1 - fraction, removedUnits: 0, cashPaid: gross - tax, basisAdded: 0 }
      : { gross, tax, priceFactor: 1, removedUnits: tax / price, cashPaid: 0, basisAdded: gross - tax };
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
  function qqqBearStates(rows, end) {
    const states = new Map();
    let on = true, exitRun = 0, entryRun = 0;
    for (let i = 0; i < rows.length && rows[i][0] <= end; i++) {
      const [day, price] = rows[i];
      if (i && gap(rows[i - 1][0], day) > 7) fail('QQQ在 ' + rows[i - 1][0] + ' — ' + day + ' 缺连续行情，无法确认退出与回归');
      if (i < 251) { states.set(day, { ready: false }); continue; }
      const ma = sum(rows.slice(i - 199, i + 1).map(r => r[1])) / 200;
      const high = Math.max(...rows.slice(i - 251, i + 1).map(r => r[1]));
      const drawdown = price / high - 1;
      if (on) {
        exitRun = price < ma && price / high <= .8 ? exitRun + 1 : 0;
        if (exitRun >= 20) { on = false; exitRun = 0; entryRun = 0; }
      } else {
        entryRun = price > ma ? entryRun + 1 : 0;
        if (entryRun >= 3) { on = true; exitRun = 0; entryRun = 0; }
      }
      states.set(day, { ready: true, on, ma, drawdown, exitRun, entryRun });
    }
    return states;
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
  function holdingPerformance(rows, trades, terminalValue, currency, dividendFlows, policy) {
    const start = trades.find(t => t.side === 'buy')?.day, end = rows.at(-1)[0];
    const activeRows = start ? rows.filter(([day]) => day >= start) : [];
    const invested = sum(trades.filter(t => t.side === 'buy').map(t => t.amount + t.fee));
    const returned = sum(trades.filter(t => t.side === 'sell').map(t => t.amount - t.fee - (t.tax || 0))) + sum(dividendFlows.map(([, net]) => net));
    const profit = terminalValue + returned - invested;
    const totalReturn = invested > 0 ? profit / invested * 100 : null;
    const flows = trades.map(t => [t.day, t.side === 'buy' ? -(t.amount + t.fee) : t.amount - t.fee - (t.tax || 0)]);
    if (dividendFlows.length) { flows.push(...dividendFlows); flows.sort(([a], [b]) => a.localeCompare(b)); }
    flows.push([end, terminalValue]);
    const short = !start || end < addYears(start, 1);
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
      currency, dividends: policy === 'cash' ? 'cash' : 'reinvested', transactionFeesIncluded: true, taxReserveIncluded: true,
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
    currencyInfo(config);
    const tax = taxConfig(config.tax);
    if (Object.keys(tax.overrides).some(id => !ids.has(id))) fail('单项税率含未收录的标的');
    if (![1, 2, 3, 5, 10, 15, 20, 'common', 'custom'].includes(config.years)) fail('回测区间无效');
    if (config.years === 'custom' && (!M.validDate(config.start) || !M.validDate(config.end) || config.start >= config.end)) fail('请填写有效且先后有序的起止日期');
    return { positions, total, cashWeight: Math.max(0, 1 - total / 100), dividendPolicy: dividendPolicyOf(config) };
  }
  function periodKey(day, frequency) {
    if (frequency === 'month') return day.slice(0, 7);
    if (frequency === 'quarter') return day.slice(0, 4) + '-' + Math.floor((Number(day.slice(5, 7)) - 1) / 3);
    return day.slice(0, 4);
  }
  function simulate(input) {
    try { return run(input); } catch (error) { return { error: error.message, ...(error.field ? { errorField: error.field } : {}) }; }
  }
  function simulateWindows(input, end, periods = [1, 2, 3, 5]) {
    return periods.map(years => ({ years, ...simulate({ ...input, requireFullWindow: true,
      config: { ...input.config, years: 'custom', start: addYears(end, -years), end } }) }));
  }
  // Each row owns the entire configured account. These are parallel scenarios,
  // not sleeves sharing money or votes controlling a combined trade.
  function simulateStrategies(input) {
    const config = input?.config;
    try {
      validateConfig({ ...config, initialMethod: 'lump_sum' }, new Set((input?.catalog?.assets || []).map(a => a.id)));
    } catch (error) {
      return { config, start: null, end: null, strategies: [], error: error.message,
        ...(error.field ? { errorField: error.field } : {}) };
    }
    let start = null, end = null;
    const strategies = comparisonMethods.map(([id, label]) => {
      const result = simulate({ ...input, config: { ...config, initialMethod: id, benchmarkId: '' } });
      if (result.error) return { id, label, error: result.error, ...(result.errorField ? { errorField: result.errorField } : {}) };
      if (start !== null && (result.start !== start || result.end !== end)) {
        return { id, label, error: '实际回测区间与其他策略不一致，无法按同一区间比较' };
      }
      start = result.start; end = result.end;
      return { id, label, result };
    });
    return { config: JSON.parse(JSON.stringify(config)), start, end, strategies };
  }
  // Comparisons use the account's existing valuation dates; a new benchmark never trades or shortens that account.
  function compareBenchmark({ catalog, histories, fxHistory }, { start, end, curve, config }, benchmarkId = config.benchmarkId) {
    if (!benchmarkId) return { benchmark: null, benchmarkError: null };
    try {
      const asset = catalog.assets.find(a => a.id === benchmarkId), history = histories[benchmarkId];
      const currency = currencyInfo(config).code, tax = taxConfig(config.tax), dividendPolicy = dividendPolicyOf(config);
      if (!asset || asset.status !== 'available') fail('对照标的缺有效每日历史');
      const rows = validateHistory(asset, history);
      const benchmarkFx = asset.currency !== currency ? validateHistory(catalog.fx, fxHistory) : null;
      if (rows[0][0] > start || rows.at(-1)[0] < end) fail('对照标的的历史不覆盖组合区间：' + asset.name + '仅有 ' + rows[0][0] + ' — ' + rows.at(-1)[0]);
      if (benchmarkFx && (benchmarkFx[0][0] > start || benchmarkFx.at(-1)[0] < end)) fail('对照所需汇率不覆盖组合区间：仅有 ' + benchmarkFx[0][0] + ' — ' + benchmarkFx.at(-1)[0]);
      if (tax.liquidate && !rows.some(row => row[0] === end)) fail('对照标的' + asset.name + '在期末 ' + end + ' 缺当日实际报价，无法计算该日的清仓后对照收益');
      const info = M.annualFeeInfo({ ...asset, n: asset.name }, config.feeOverrides?.[asset.code]);
      if (config.feeBasis === 'gross_estimate' && info.applicable && info.rate === null) fail('对照标的' + info.missing);
      const rate = config.feeBasis === 'gross_estimate' && info.applicable ? info.rate : 0;
      const quote = day => {
        const p = at(rows, day), f = asset.currency !== currency ? at(benchmarkFx, day, 7) : null;
        if (!p || asset.currency !== currency && !f) fail('对照标的在 ' + day + ' 缺可用价格或汇率');
        return p.value * (f ? currency === 'USD' ? 1 / f.value : f.value : 1) * (rate ? M.annualFeeFactor(rate, start, day) : 1);
      };
      const base = quote(start), rates = taxRates(asset, config.tax);
      validateDividendEvidence(asset, history, start, end, rates, dividendPolicy);
      let units = 1, basis = base, paidTax = 0, taxReserve = 0, cashDividends = 0, priceFactor = 1;
      const values = new Map();
      const quoteDays = [...new Set([...rows.map(r => r[0]), ...curve.map(p => p.day)])].filter(day => day >= start && day <= end).sort();
      for (const day of quoteDays) {
        const price = quote(day) * priceFactor, fraction = day > start ? history.dividendEvidence?.fractions?.[day] || 0 : 0;
        const d = distribution(units, price, fraction, rates.dividend, dividendPolicy);
        units -= d.removedUnits; basis += d.basisAdded; paidTax += d.tax;
        cashDividends += d.cashPaid; priceFactor *= d.priceFactor;
        const stockValue = units * price * d.priceFactor;
        taxReserve = Math.max(0, stockValue - basis) * rates.gain / 100;
        const value = stockValue + cashDividends - taxReserve;
        if (day === end && tax.liquidate) { paidTax += taxReserve; taxReserve = 0; }
        values.set(day, value);
      }
      const points = curve.map(p => ({ day: p.day, nav: values.get(p.day) / base }));
      const benchmark = { id: asset.id, name: asset.name, curve: points, dividendPolicy, cashDividends, totalReturn: (points.at(-1).nav - 1) * 100,
        annualReturn: annualReturn(points.at(-1).nav, start, end), taxCost: paidTax + taxReserve, paidTax, taxReserve, usesFx: !!benchmarkFx, taxRates: rates, taxBasis: 'same_simulation_rates' };
      return { benchmark, benchmarkError: null };
    } catch (error) { return { benchmark: null, benchmarkError: error.message }; }
  }
  function run({ catalog, histories, config, fxHistory, marketContext, requireFullWindow = false }) {
    const assets = new Map((catalog?.assets || []).map(a => [a.id, a]));
    const { positions, total, cashWeight, dividendPolicy } = validateConfig(config, new Set(assets.keys()));
    const tax = taxConfig(config.tax);
    const currency = currencyInfo(config).code;
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
    const needsFx = series.some(s => s.asset.currency !== currency);
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
    const startAtInception = config.years === 'custom' && !requireFullWindow && requestedStart < common[0];
    if (!startAtInception && requestedStart < first) {
      const latest = series.filter(s => s.rows[0][0] === first).map(s => s.asset.name).join('、') || '人民币汇率';
      fail(latest + '的历史始于 ' + first + '，不覆盖所选区间；可选择“共同历史”');
    }
    const start = startAtInception ? common[0] : common.filter(day => day <= requestedStart).at(-1);
    if (!start || (!startAtInception && gap(start, requestedStart) > 14)) fail('开始日前14日内缺共同实际交易日；可选择“共同历史”或调整日期');
    const days = [...new Set([...series.flatMap(s => s.rows.map(r => r[0])), ...(fx ? fx.map(r => r[0]) : [])])].filter(day => day >= start && day <= requestedEnd).sort();
    const end = days.at(-1);
    if (startAtInception && (!end || end <= start)) fail('最早共同建仓日为 ' + start + '；所选区间内还没有之后的估值日，请延后结束日');
    if (!end || end <= start || gap(end, requestedEnd) > 14) fail('结束日前14日内缺有效估值，无法回测');
    if (tax.liquidate && !commonSet.has(end)) {
      const unavailable = series.filter(s => !s.dates.has(end)).map(s => s.asset.name).join('、');
      const latest = common.filter(day => day > start && day <= end).at(-1);
      fail('期末 ' + end + '，' + (unavailable || '所选标的') + '缺当日实际报价，不能用沿用估值清仓。' +
        (latest ? '最近共同交易日为 ' + latest + '，请将结束日改为该日，或取消期末清仓。' : '区间内没有建仓后的共同交易日，请调整区间，或取消期末清仓。'));
    }
    series.forEach(s => validateDividendEvidence(s.asset, histories[s.asset.id], start, end, s.tax, dividendPolicy));
    for (const s of series) {
      for (let i = 1; i < s.rows.length; i++) {
        const a = s.rows[i - 1][0], b = s.rows[i][0];
        if (b > start && a < end && gap(a, b) > 14) fail(s.asset.name + '在 ' + a + ' — ' + b + ' 存在超过14日的报价缺口，请缩短回测区间');
      }
    }
    const pricesAt = day => series.map(s => {
      const observation = at(s.rows, day);
      if (!observation) fail(s.asset.name + '在 ' + day + ' 前缺14日内有效价格');
      const quote = s.asset.currency !== currency ? at(fx, day, 7) : null;
      if (s.asset.currency !== currency && !quote) fail(day + ' 前缺7日内美元兑人民币实际汇率');
      const feeFactor = s.feeRate ? M.annualFeeFactor(s.feeRate, start, day) : 1;
      return { value: observation.value * (quote ? currency === 'USD' ? 1 / quote.value : quote.value : 1) * feeFactor,
        carried: observation.carried, fxCarried: !!quote?.carried };
    });
    const strategy = strategyConfig(config), strategyDays = common.filter(day => day >= start && day <= end);
    const opportunity = Systematic?.opportunityDefinitions?.[strategy.initialMethod] || null;
    if (strategy.initialMethod.startsWith('opportunity_') && !opportunity) fail('加仓评分模块未加载，请刷新页面');
    const systematicMethod = !!opportunity || ['vix_panic_reentry', 'relative_strength_rotation', 'dual_risk_guard'].includes(strategy.initialMethod);
    const pairIds = ['us:USD', 'us:TQQQ'], pairIndices = pairIds.map(id => series.findIndex(s => s.asset.id === id));
    const pairWeights = pairIndices.map(i => i < 0 ? 0 : series[i].weight);
    let systematicController = null;
    if (systematicMethod) {
      if (!Systematic) fail('系统投入方法模块未加载，请刷新页面');
      if (strategy.initialMethod === 'relative_strength_rotation' && pairIndices.some(i => i < 0)) failStrategy('三批相对强弱轮动需要USD与TQQQ均有正权重');
      if (opportunity ? pairIndices.every(i => i < 0) : pairIndices[1] < 0) failStrategy(opportunity ? '加仓评分需要组合中有USD或TQQQ' : '该投入方法需要组合中有权重大于0的TQQQ');
      const required = pairIds.filter((id, leg) => pairIndices[leg] >= 0);
      if (strategy.initialMethod === 'dual_risk_guard') required.push('us:QQQ');
      if (opportunity) {
        if (pairIndices[0] >= 0) required.push('us:SOXX');
        if (pairIndices[1] >= 0) required.push('us:QQQ');
      }
      const rawHistories = {};
      for (const id of required) {
        const asset = assets.get(id), history = histories[id], code = id.slice(3);
        if (!asset || asset.code !== code || asset.kind !== 'etf' || asset.currency !== 'USD') fail('缺' + code + '实际美元ETF身份，无法计算该投入方法');
        rawHistories[id] = validateHistory(asset, history);
        if (history.basis !== 'provider_adjusted_close') fail(code + '需要实际美元含分红复权收盘价');
      }
      systematicController = Systematic.create({ method: strategy.initialMethod, weights: pairWeights, rawHistories, vixContext: marketContext });
    }
    const qqqTiming = strategy.initialMethod === 'qqq_bear_confirm';
    const tqqqIndex = series.findIndex(s => s.asset.id === 'us:TQQQ');
    const qqqSignals = new Map();
    let qqqLatestSignal = null, qqqNextState = null;
    if (qqqTiming) {
      if (tqqqIndex < 0) failStrategy('QQQ深熊确认调仓需要组合中有权重大于0的TQQQ');
      const qqqAsset = assets.get('us:QQQ'), qqqHistory = histories['us:QQQ'];
      if (!qqqAsset || qqqAsset.currency !== 'USD' || qqqAsset.code !== 'QQQ' || qqqAsset.kind !== 'etf') fail('缺QQQ实际美元ETF身份，无法计算QQQ深熊确认调仓信号');
      const qqqRows = validateHistory(qqqAsset, qqqHistory);
      if (qqqHistory.basis !== 'provider_adjusted_close') fail('QQQ深熊确认调仓需要实际美元复权收盘价');
      const states = qqqBearStates(qqqRows, end), previousDays = new Map(common.map((day, i) => [day, common[i - 1]]));
      for (const day of strategyDays) {
        // At the ETF's first common close there cannot be an earlier common
        // close. Its already-published QQQ predecessor still supplies a causal
        // initial state, provided it is fresh and has the full proxy warmup.
        const priorCommon = previousDays.get(day);
        const signalDay = priorCommon || qqqRows.filter(r => r[0] < day).at(-1)?.[0];
        if (!signalDay || !priorCommon && gap(signalDay, day) > 7) fail('QQQ深熊确认调仓在开始日前缺7日内实际QQQ收盘价');
        const source = at(qqqRows, signalDay, 7);
        if (!source) fail('QQQ在信号日 ' + signalDay + ' 前缺7日内实际复权收盘价');
        const state = states.get(source.day);
        if (!state?.ready) fail('QQQ在 ' + source.day + ' 缺252个交易日预热，无法计算200日均线与一年高点');
        qqqSignals.set(day, { signalDay, sourceDay: source.day, ...state });
      }
      const latest = at(qqqRows, end, 7);
      qqqLatestSignal = latest ? { available: true, signalDay: latest.day, sourceDay: latest.day, ...states.get(latest.day) } :
        { available: false, signalDay: null, sourceDay: qqqRows.filter(r => r[0] <= end).at(-1)?.[0] || null,
          on: null, missing: 'QQQ在模拟末日 ' + end + ' 前缺7日内实际复权收盘价' };
      // A later QQQ-only close can be a useful observation, but the next actual
      // shared-market execution uses the last common close, like the backtest.
      const nextSignalDay = strategyDays.at(-1), nextSource = at(qqqRows, nextSignalDay, 7);
      qqqNextState = nextSource ? { available: true, signalDay: nextSignalDay, sourceDay: nextSource.day, ...states.get(nextSource.day) } :
        { available: false, signalDay: nextSignalDay, sourceDay: qqqRows.filter(r => r[0] <= nextSignalDay).at(-1)?.[0] || null,
          on: null, missing: 'QQQ在最后共同收盘 ' + nextSignalDay + ' 前缺7日内实际复权收盘价' };
    }
    const months = strategyDays.filter((day, i) => !i || day.slice(0, 7) !== strategyDays[i - 1].slice(0, 7));
    // Signals use a separate target-weight reference, without investor cash flows,
    // fees or taxes. Each close is formed only from prices already published.
    const signals = new Map(), needsSignal = strategy.initialMethod === 'drawdown_ladder' && config.initial > 0 ||
      strategy.initialMethod === 'ma200_hold' && config.initial > 0 || config.monthly > 0 && ['dca_drawdown', 'dca_ma_trend', 'dca_ma_contrarian'].includes(strategy.contributionMethod);
    let warmupDays = 0, insufficientMaDays = 0, referenceCloses = null;
    function referenceHistory() {
      if (referenceCloses) return referenceCloses;
      referenceCloses = [];
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
        if (day >= start) referenceCloses.push({ day, drawdown: Math.min(0, reference / referencePeak - 1) * 100,
          deviation: closes.length < 200 ? null : (reference / (sum(closes) / 200) - 1) * 100 });
        previous = current; previousDay = day;
      }
      return referenceCloses;
    }
    if (needsSignal) referenceHistory();
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
    // Cash actually spent buying the remaining shares. Automatic dividend
    // reinvestment increases tax basis, but adds no principal from the account.
    const positionPrincipal = series.map(() => 0);
    const dividendPriceFactor = series.map(() => 1), cashDividends = series.map(() => 0), dividendFlows = series.map(() => []);
    const holdingNav = series.map(() => 1);
    const fee = config.transactionFee / 100, transactions = [], flows = [];
    let cash = 0, contributed = 0, fundUnits = 0, tradeCost = 0, rebalances = 0, deposits = 0;
    let lastBalance = periodKey(start, config.rebalance), peak = 1, mdd = 0;
    let initialReserve = config.initial, exposure = 1, timingChanges = 0;
    let pendingTopup = null, topupSignalDay = null, topupTimes = 0, topupAmount = 0, topupFees = 0;
    let maxActualExposure = 0, maxActualExposureDay = null;
    const cashTopup = strategy.initialMethod === 'cash_topup';
    const timing = config.initial > 0 && strategy.initialMethod === 'ma200_hold';
    let riskReserve = 0, qqqOn = true, qqqTimingChanges = 0, lastQqqSignal = null;
    const qqqTimingEvents = [];
    // Only cash assigned to the USD/TQQQ pair may finance its strategy orders.
    // Unallocated cash and other positions' proceeds remain outside this pool.
    const systematicCash = [0, 0], systematicEvents = [], systematicDaily = [];
    let systematicTargets = pairWeights.map(w => opportunity ? w * (1 - opportunity.reserve) : w);
    let systematicParked = pairWeights.map(w => opportunity ? w * opportunity.reserve : 0), pendingSystematic = null;
    let systematicSignalDay = null, systematicPlans = 0, systematicTrades = 0, systematicFills = [];
    let carriedPrices = 0, carriedFx = 0;
    const value = prices => cash + sum(units.map((unit, i) => unit * prices[i]));
    // Gross marked weight of all stocks, ETFs and funds; not leverage or volatility.
    function recordExposure(day, prices) {
      const gross = value(prices), weight = gross > 0 ? (gross - cash) / gross : 0;
      if (weight > maxActualExposure) { maxActualExposure = weight; maxActualExposureDay = day; }
    }
    // A valuation liability, never a cash debit or a daily tax payment. Actual
    // sales reduce both the position and its reserve, avoiding double taxation.
    const reserve = (i, price) => Math.max(0, units[i] * price * (1 - fee) - basis[i]) * series[i].tax.gain / 100;
    const netHolding = (i, price) => units[i] * price - reserve(i, price);
    const netValue = prices => cash + sum(prices.map((price, i) => netHolding(i, price)));
    const saleTax = (i, amount, price, saleFee) => {
      const disposedBasis = units[i] > EPS ? basis[i] * amount / (units[i] * price) : 0;
      const gain = Math.max(0, amount - saleFee - disposedBasis);
      return { disposedBasis, gain, tax: gain * series[i].tax.gain / 100 };
    };
    const trade = (day, prices, deltas, fees, reason, signalDay) => {
      let taxCharge = 0;
      deltas.forEach((delta, i) => {
        if (Math.abs(delta) > EPS) {
          const before = netHolding(i, prices[i]);
          const sale = delta < 0 ? saleTax(i, -delta, prices[i], fees[i]) : { disposedBasis: 0, gain: 0, tax: 0 };
          basis[i] += delta > 0 ? delta + fees[i] : -sale.disposedBasis;
          if (delta > 0) positionPrincipal[i] += delta + fees[i];
          else positionPrincipal[i] *= Math.max(0, 1 + delta / (units[i] * prices[i]));
          capitalTaxes[i] += sale.tax; taxCharge += sale.tax;
          if (delta < 0) taxEvents.push({ day, id: series[i].asset.id, type: 'capital', proceeds: -delta, basis: sale.disposedBasis, gain: sale.gain, rate: series[i].tax.gain, tax: sale.tax });
          units[i] += delta / prices[i];
          const after = netHolding(i, prices[i]);
          holdingNav[i] *= delta > 0 ? after / (before + delta + fees[i]) : (after - delta - fees[i] - sale.tax) / before;
          if (delta > 0) bought[i] += delta; else sold[i] -= delta;
          costs[i] += fees[i];
          transactions.push({ day, id: series[i].asset.id, side: delta > 0 ? 'buy' : 'sell', amount: Math.abs(delta), fee: fees[i], tax: sale.tax, reason,
            ...(signalDay ? { signalDay } : {}) });
        }
      });
      const charge = sum(fees);
      cash -= sum(deltas) + charge + taxCharge;
      if (cash < -1e-5) fail('交易费用超过可用现金');
      if (Math.abs(cash) < 1e-5) cash = 0;
      tradeCost += charge;
      recordExposure(day, prices);
    };
    function targetWeight(s, i) {
      const leg = pairIndices.indexOf(i);
      if (systematicMethod && leg >= 0) return systematicTargets[leg];
      return qqqTiming && !qqqOn && i === tqqqIndex ? 0 : s.weight;
    }
    function rebalance(day, prices, reason, targetExposure = exposure) {
      const wealth = Math.max(0, value(prices) - initialReserve), previous = units.map((u, i) => u * prices[i]);
      // A periodic rebalance must not recreate a spent opportunity reserve.
      // Preserve each sleeve's current stock/cash split while restoring its
      // configured total weight. This is separate from new-money allocation.
      const keptFractions = opportunity ? pairIndices.map((index, leg) => {
        const marked = index < 0 ? 0 : previous[index], pool = marked + Math.max(0, systematicCash[leg]);
        return pool > EPS ? marked / pool : 1;
      }) : null;
      const target = (s, i) => {
        const leg = pairIndices.indexOf(i);
        return targetExposure * (opportunity && leg >= 0 ? pairWeights[leg] * keptFractions[leg] : targetWeight(s, i));
      };
      let lo = 0, hi = wealth;
      if (fee || series.some(s => s.tax.gain > 0)) {
        for (let i = 0; i < 70; i++) {
          const charge = (lo + hi) / 2;
          const implied = sum(series.map((s, k) => {
            const delta = target(s, k) * (wealth - charge) - previous[k], tradeFee = Math.abs(delta) * fee;
            return tradeFee + (delta < 0 ? saleTax(k, -delta, prices[k], tradeFee).tax : 0);
          }));
          if (implied > charge) lo = charge; else hi = charge;
        }
      } else hi = 0;
      const usable = wealth - hi, deltas = series.map((s, i) => target(s, i) * usable - previous[i]);
      trade(day, prices, deltas, deltas.map(delta => Math.abs(delta) * fee), reason);
      if (qqqTiming) riskReserve = qqqOn ? 0 : Math.min(Math.max(0, cash - initialReserve), usable * series[tqqqIndex].weight);
      if (systematicMethod) systematicParked.forEach((w, leg) => {
        systematicCash[leg] = usable * (opportunity ? pairWeights[leg] * (1 - keptFractions[leg]) : w);
      });
      if (reason === 'rebalance') rebalances++;
    }
    function deposit(day, amount, prices) {
      if (!amount) return;
      const before = netValue(prices), nav = fundUnits ? before / fundUnits : 1;
      if (!finite(nav) || nav <= 0) fail('组合净值无效');
      fundUnits += amount / nav;
      cash += amount; contributed += amount; deposits++;
      flows.push([day, -amount]);
    }
    function invest(day, amount, prices, reason) {
      if (amount <= EPS || !exposure) return;
      if (opportunity) {
        const fresh = reason === 'contribution';
        const targets = series.map((s, i) => pairIndices.includes(i) ? fresh ? 0 : s.weight * (1 - opportunity.reserve) : s.weight);
        const usable = amount / (1 + fee * sum(targets)), deltas = targets.map(w => usable * w);
        trade(day, prices, deltas, deltas.map(delta => delta * fee), reason);
        pairWeights.forEach((w, leg) => { systematicCash[leg] += usable * w * (fresh ? 1 : opportunity.reserve); });
        return;
      }
      const usable = amount / (1 + fee * total / 100);
      const deltas = series.map((s, i) => usable * targetWeight(s, i));
      trade(day, prices, deltas, deltas.map(delta => delta * fee), reason);
      if (qqqTiming && !qqqOn) riskReserve += usable * series[tqqqIndex].weight * (1 + fee);
      if (systematicMethod) systematicParked.forEach((w, leg) => { systematicCash[leg] += usable * w * (1 + fee); });
    }
    function updateQqq(day, prices) {
      const signal = qqqSignals.get(day), previous = qqqOn;
      lastQqqSignal = signal;
      // End liquidation never buys a parked sleeve merely to sell it again.
      if (day === end && tax.liquidate && !qqqOn && signal.on) return;
      qqqOn = signal.on;
      if (day === start || previous === qqqOn) return;
      const deltas = series.map(() => 0), beforeCash = cash;
      deltas[tqqqIndex] = qqqOn ? riskReserve / (1 + fee) : -units[tqqqIndex] * prices[tqqqIndex];
      trade(day, prices, deltas, deltas.map(d => Math.abs(d) * fee), qqqOn ? 'qqq_timing_in' : 'qqq_timing_out', signal.signalDay);
      riskReserve = qqqOn ? 0 : riskReserve + cash - beforeCash;
      qqqTimingChanges++;
      qqqTimingEvents.push({ day, signalDay: signal.signalDay, sourceDay: signal.sourceDay, on: qqqOn, ma: signal.ma, drawdown: signal.drawdown, riskReserve });
    }
    function topup(day, prices) {
      const plan = pendingTopup; pendingTopup = null;
      if (!plan || day === start || day === end && tax.liquidate) return;
      const rounding = Math.max(EPS, Number.EPSILON * 16 * Math.max(cash, plan.cashRequired));
      if (plan.cashRequired > cash + rounding) fail('前一共同收盘的补仓计划超过已留存现金');
      // Execute yesterday's fixed currency amounts before today's deposits or
      // rebalance. Today's price changes units, never the promised order budget.
      const orders = new Map(plan.orders.map(order => [order.id, order]));
      const deltas = series.map(s => orders.get(s.asset.id)?.amount || 0);
      const fees = series.map(s => orders.get(s.asset.id)?.fee || 0);
      trade(day, prices, deltas, fees, 'cash_topup', plan.signalDay);
      topupTimes++; topupAmount += plan.amount; topupFees += plan.fee;
    }
    function planTopup(day, prices) {
      topupSignalDay = day;
      if (day === end && tax.liquidate) return null;
      const marks = units.map((unit, i) => unit * prices[i]), wealth = value(prices), stock = sum(marks), target = total / 100;
      const rounding = Math.max(EPS, Number.EPSILON * 16 * wealth);
      if (cash <= EPS || stock >= target * wealth - rounding) return null;
      const deficits = series.map((s, i) => Math.max(0, s.weight * wealth - marks[i])), deficit = sum(deficits);
      if (deficit <= EPS) return null;
      const budget = Math.min(cash / (1 + fee), Math.max(0, (target * wealth - stock) / (1 + target * fee)));
      if (budget <= EPS) return null;
      const orders = series.map((s, i) => ({ id: s.asset.id, amount: budget * deficits[i] / deficit }))
        .filter(order => order.amount > EPS).map(order => ({ ...order, fee: order.amount * fee }));
      const amount = sum(orders.map(order => order.amount)), charge = sum(orders.map(order => order.fee));
      return amount > EPS ? { signalDay: day, amount, fee: charge, cashRequired: amount + charge, orders,
        portfolioValue: wealth, stockValue: stock, availableCash: cash, targetWeight: total } : null;
    }
    function executeSystematic(day, prices) {
      systematicFills = [];
      const plan = pendingSystematic; pendingSystematic = null;
      if (!plan || day === start || day === end && tax.liquidate) return;
      const available = Math.max(0, sum(systematicCash)), tolerance = Math.max(EPS, Number.EPSILON * 32 * value(prices));
      if (plan.buyAmount + plan.buyFee > Math.min(cash, available) + tolerance) fail('前一收盘的策略订单超过已归属的可用现金');
      const deltas = series.map(() => 0), charges = series.map(() => 0), before = transactions.length, fullySold = new Set();
      for (const order of plan.orders) {
        const i = series.findIndex(s => s.asset.id === order.id);
        if (i < 0) fail('策略待单标的不在当前组合中');
        const sellUnits = order.side === 'sell' ? Math.min(units[i], order.units) : 0;
        if (order.side === 'sell' && sellUnits > 0 && sellUnits === units[i]) fullySold.add(i);
        const delta = order.side === 'buy' ? order.amount : -sellUnits * prices[i];
        deltas[i] += delta; charges[i] += Math.abs(delta) * fee;
      }
      trade(day, prices, deltas, charges, strategy.initialMethod, plan.signalDay);
      // A complete inventory sale leaves exactly zero units and cost basis.
      // Re-dividing its currency proceeds can otherwise leave a negative ULP
      // that grows with the investor's capital and later quote changes.
      fullySold.forEach(i => { units[i] = 0; basis[i] = 0; positionPrincipal[i] = 0; });
      for (const transaction of transactions.slice(before)) {
        const leg = pairIds.indexOf(transaction.id), netCash = transaction.side === 'sell'
          ? transaction.amount - transaction.fee - transaction.tax : -transaction.amount - transaction.fee;
        systematicCash[leg] += netCash;
        systematicFills.push({ ...transaction, leg, units: transaction.amount / prices[pairIndices[leg]], netCash });
      }
      systematicTargets = plan.desiredTargets.slice(); systematicParked = plan.parkedWeights.slice();
      systematicTrades += transactions.length - before;
      systematicEvents.push({ day, signalDay: plan.signalDay, desiredTargets: systematicTargets.slice(), metadata: plan.metadata, trades: transactions.length - before });
    }
    function planSystematic(day, prices) {
      systematicSignalDay = day;
      if (day === end && tax.liquidate && !opportunity) return null;
      const pairPrices = pairIndices.map(i => i < 0 ? 0 : prices[i]), pairUnits = pairIndices.map(i => i < 0 ? 0 : units[i]);
      const marks = pairUnits.map((u, leg) => u * pairPrices[leg]), available = Math.max(0, sum(systematicCash));
      const planned = systematicController.step({ day, prices: pairPrices, units: pairUnits, marks,
        basis: pairIndices.map(i => i < 0 ? 0 : basis[i]), cash: available, cashByLeg: systematicCash.slice(),
        wealth: sum(marks) + available, initialCash: 0, initial: config.initial, weights: pairWeights, fee, latestFills: systematicFills });
      if (planned?.missing) {
        if (day !== strategyDays.at(-1)) fail(planned.missing);
        return null;
      }
      if (!planned) return null;
      // The market score remains observable after liquidation. Only account
      // orders stop; keep the final source dates and operands current.
      if (day === end && tax.liquidate) return null;
      const orders = [];
      for (let leg = 0; leg < 2; leg++) {
        const fraction = planned.sellFractions[leg], amount = planned.buyAmounts[leg];
        if (!finite(fraction) || fraction < 0 || fraction > 1 + 1e-10 || !finite(amount) || amount < 0) fail('策略订单比例或金额无效');
        if (fraction > EPS && amount > EPS) fail('同一策略订单不能同时买卖同一标的');
        if (pairIndices[leg] < 0 && (fraction > EPS || amount > EPS)) fail('策略不能交易零权重标的');
        if (fraction > EPS && pairUnits[leg] > EPS) orders.push({ id: pairIds[leg], side: 'sell', sellFraction: Math.min(1, fraction), units: pairUnits[leg] * Math.min(1, fraction) });
        if (amount > EPS) orders.push({ id: pairIds[leg], side: 'buy', amount });
      }
      const buyAmount = sum(orders.filter(o => o.side === 'buy').map(o => o.amount)), buyFee = buyAmount * fee;
      if (buyAmount + buyFee > Math.min(cash, available) + Math.max(EPS, available * Number.EPSILON * 32)) fail('策略不能预花未来卖出回款或其他资产的现金');
      if (!orders.length && !planned.allocationStateChange && !planned.metadata?.allocationStateChange) return null;
      systematicPlans++;
      return { signalDay: day, orders, buyAmount, buyFee, desiredTargets: planned.desiredTargets.slice(),
        parkedWeights: planned.parkedWeights.slice(), metadata: planned.metadata };
    }
    function reconcileSystematicCash() {
      if (opportunity) {
        const tolerance = Number.EPSILON * 32 * Math.max(1, Math.abs(cash), Math.abs(contributed));
        systematicCash.forEach((amount, leg) => {
          if (amount < 0 && -amount <= tolerance) systematicCash[leg] = 0;
          else if (amount < 0) fail('加仓策略不能使用另一标的或账户原现金填补负余额');
        });
      }
      const assigned = sum(systematicCash);
      const rounding = Number.EPSILON * 32 * Math.max(1, Math.abs(cash), sum(systematicCash.map(Math.abs)));
      // Rotation records transfers as opposite signed leg balances. Their
      // cancellation can leave one ULP even when actual settled cash is zero.
      // Restore only that representational boundary, never additional funding.
      const corrected = assigned < 0 && -assigned <= rounding ? 0 :
        assigned > cash && assigned - cash <= rounding ? cash : null;
      if (corrected !== null) {
        const leg = Math.abs(systematicCash[0]) >= Math.abs(systematicCash[1]) ? 0 : 1;
        systematicCash[leg] = corrected - systematicCash[1 - leg];
      }
    }
    function snapshotSystematic(day) {
      const state = systematicController.state(), liquidated = day === end && tax.liquidate;
      const status = liquidated ? 'liquidated' : state.status, valid = status === 'ready';
      const rotation = strategy.initialMethod === 'relative_strength_rotation';
      const allowed = state.metadata?.vixOn && (strategy.initialMethod !== 'dual_risk_guard' || state.metadata?.qqqOn);
      const scoreLegs = state.metadata?.opportunity?.legs || [];
      const weightedScore = opportunity && pairWeights.every((w, i) => !w || finite(scoreLegs[i]?.score)) ?
        sum(pairWeights.map((w, i) => w * (scoreLegs[i]?.score || 0))) / sum(pairWeights) : null;
      const indicator = opportunity ? state.missing ? null : weightedScore : rotation || !valid ? null : allowed ? 100 : 0;
      const indicators = opportunity ? pairIds.map((id, i) => ({ id, label: (i ? 'TQQQ' : 'USD ETF') + '加仓分数',
        value: state.missing ? null : scoreLegs[i]?.score ?? null, unit: 'points', kind: 'buy_score', basis: 'opportunity_rule' })).filter((_, i) => pairWeights[i] > 0) : rotation ? ['us:USD', 'us:TQQQ'].map((id, i) => ({ id,
        label: (i ? 'TQQQ' : 'USD ETF') + '股票预算分配', value: valid ? state.targetShares[i] * 100 : null,
        unit: '%', kind: 'allocation_share', basis: 'pair_stock_budget' })) : [{ id: 'us:TQQQ',
        label: 'TQQQ持仓状态', value: indicator, unit: 'state_code', kind: 'holding_state', basis: 'holding_permission' }];
      systematicDaily.push(immutableCopy({ day, method: strategy.initialMethod, status, missing: state.missing,
        warmingUp: state.warmingUp, liquidated, trackingStart: start, indicator, indicators,
        metadata: { ...state.metadata, observationDay: state.day }, desiredTargets: state.desiredTargets,
        executedTargets: systematicTargets, executedParked: systematicParked, nextPlan: liquidated ? null : pendingSystematic,
        positions: series.map(s => ({ id: s.asset.id, code: s.asset.code, name: s.asset.name, weight: s.weight })), fee, currency }));
    }
    const curve = [], holdingPaths = series.map(() => []), fxDates = new Set((fx || []).map(row => row[0]));
    let lastPrices = null;
    for (const day of days) {
      const observations = pricesAt(day), prices = observations.map((p, i) => p.value * dividendPriceFactor[i]);
      series.forEach((s, i) => {
        const beforeMark = lastPrices && units[i] > EPS ? netHolding(i, lastPrices[i]) : 0;
        const fraction = s.dividendEvidence?.fractions?.[day] || 0;
        let cashPaid = 0;
        if (fraction > 0 && day > start) {
          const d = distribution(units[i] > EPS ? units[i] : 0, prices[i], fraction, s.tax.dividend, dividendPolicy);
          dividendPriceFactor[i] *= d.priceFactor; prices[i] *= d.priceFactor;
          if (units[i] > EPS) {
            units[i] -= d.removedUnits; basis[i] += d.basisAdded; dividendTaxes[i] += d.tax;
            cashPaid = d.cashPaid;
            if (cashPaid > 0) {
              cash += cashPaid; cashDividends[i] += cashPaid; dividendFlows[i].push([day, cashPaid]);
            }
            taxEvents.push({ day, id: s.asset.id, type: 'dividend', gross: d.gross, rate: s.tax.dividend, tax: d.tax, cashPaid, basisAdded: d.basisAdded });
          }
        }
        if (beforeMark > EPS) holdingNav[i] *= (netHolding(i, prices[i]) + cashPaid) / beforeMark;
      });
      const tradesBefore = transactions.length;
      carriedPrices += observations.filter(p => p.carried).length;
      if (observations.some(p => p.fxCarried)) carriedFx++;
      recordExposure(day, prices);
      if (commonSet.has(day)) {
        if (systematicMethod) executeSystematic(day, prices);
        if (cashTopup) topup(day, prices);
        if (qqqTiming) updateQqq(day, prices);
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
        if (qqqTiming) riskReserve = 0;
        if (systematicMethod) { systematicCash.fill(0); pendingSystematic = null; }
      }
      if (qqqTiming && (riskReserve < -1e-5 || riskReserve > cash + 1e-5)) fail('QQQ风险现金与账户现金未勾稽');
      if (cashTopup && commonSet.has(day)) {
        pendingTopup = planTopup(day, prices);
      }
      if (systematicMethod) {
        reconcileSystematicCash();
        const reserveCash = sum(systematicCash), tolerance = Math.max(1e-5, Math.abs(cash) * Number.EPSILON * 32);
        if (reserveCash < -tolerance || reserveCash > cash + tolerance) fail('策略归属现金未与组合实际现金勾稽');
        if (commonSet.has(day)) {
          pendingSystematic = planSystematic(day, prices);
          snapshotSystematic(day);
        }
      }
      const traded = new Set(transactions.slice(tradesBefore).map(t => t.id));
      series.forEach((s, i) => {
        // Risk observes actual exposure and trade fees; external cash transfers
        // do not create gains or drawdowns. Extra foreign-market dates add no zeros.
        if (s.dates.has(day) || s.asset.currency !== currency && fxDates.has(day) || traded.has(s.asset.id) || day === start || day === end) holdingPaths[i].push([day, holdingNav[i]]);
      });
      lastPrices = prices;
      const account = netValue(prices), nav = account / fundUnits;
      const taxReserve = sum(prices.map((price, i) => reserve(i, price))), paidTax = sum(capitalTaxes) + sum(dividendTaxes);
      peak = Math.max(peak, nav); mdd = Math.min(mdd, (nav / peak - 1) * 100);
      curve.push({ day, value: account, contributed, positionPrincipal: sum(positionPrincipal), profit: account - contributed, nav, totalReturn: (nav - 1) * 100,
        annualReturn: day === start ? (nav - 1) * 100 : annualReturn(nav, start, day), drawdown: (nav / peak - 1) * 100, cash, initialReserve, exposure,
        grossValue: value(prices), taxReserve, paidTax, taxCost: paidTax + taxReserve,
        ...(systematicMethod ? { systematicTargets: systematicTargets.slice(), systematicCash: systematicCash.slice() } : {}),
        ...(qqqTiming ? { riskReserve, qqqOn, qqqSignalDay: lastQqqSignal?.signalDay, qqqSourceDay: lastQqqSignal?.sourceDay } : {}) });
    }
    const final = curve.at(-1), prices = lastPrices;
    flows.push([end, final.value]);
    const volatility = annualVolatility(curve.map(p => p.nav));
    const holdings = series.map((s, i) => ({ id: s.asset.id, code: s.asset.code, name: s.asset.name,
      targetWeight: s.weight * 100, actualWeight: final.value ? netHolding(i, prices[i]) / final.value * 100 : 0,
      value: netHolding(i, prices[i]), grossValue: units[i] * prices[i], taxReserve: reserve(i, prices[i]), bought: bought[i], sold: sold[i], transactionCost: costs[i],
      profit: netHolding(i, prices[i]) + sold[i] - bought[i] - costs[i] - capitalTaxes[i] + cashDividends[i], cashDividends: cashDividends[i], first: s.rows[0][0], asOf: s.rows.at(-1)[0],
      capitalTax: capitalTaxes[i], dividendTax: dividendTaxes[i], taxCost: capitalTaxes[i] + dividendTaxes[i] + reserve(i, prices[i]), costBasis: basis[i], taxRates: s.tax,
      basis: histories[s.asset.id].basis, currency: s.asset.currency, feeRate: s.feeRate,
      leveraged: (s.asset.leverage || 1) > 1,
      performance: holdingPerformance(holdingPaths[i], transactions.filter(t => t.id === s.asset.id), netHolding(i, prices[i]), currency, dividendFlows[i], dividendPolicy) }));
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
    const { benchmark, benchmarkError } = compareBenchmark({ catalog, histories, fxHistory }, { start, end, curve, config });
    const fullYear = end >= addYears(start, 1);
    const xirr = fullYear ? M.buyLocationXirr(flows) : null;
    const xirrMissing = xirr !== null ? null : !fullYear ? '模拟不足一年，不外推资金年化' : '实际资金流缺可用年化解';
    const result = { start, end, requestedStart, requestedEnd, commonFirst: common[0], commonLast: common.at(-1), currency, usesFx: needsFx,
      totalReturn: final.totalReturn, annualReturn: annualReturn(final.nav, start, end), value: final.value,
      contributed, profit: final.profit, mdd, volatility, cash, cashDividends: sum(cashDividends), cashWeight: cashWeight * 100, holdings, curve, annual,
      // A short-period money-weighted figure is left unannualized rather than
      // exaggerating one month's change into a full-year compound rate.
      xirr, xirrMissing,
      deposits, rebalances, transactions, tradeCost, initialReserve, timingChanges, topupTimes, topupAmount, topupFees,
      maxActualExposure, maxActualExposureDay,
      ...(cashTopup ? { nextTopupPlan: tax.liquidate ? null : pendingTopup, topupSignalDay } : {}),
      ...(systematicMethod ? { systematic: { method: strategy.initialMethod, signalDay: systematicSignalDay,
        state: systematicController.state(), executedTargets: systematicTargets.slice(), nextPlan: tax.liquidate ? null : pendingSystematic,
        planCount: systematicPlans, tradeCount: systematicTrades, events: systematicEvents, cashByLeg: systematicCash.slice(),
        daily: Object.freeze(systematicDaily) } } : {}),
      ...(qqqTiming ? { qqqTimingChanges, riskReserve, qqqTimingEvents, qqqLatestSignal,
        qqqNextSignal: tax.liquidate ? null : { ...qqqNextState, executedOn: qqqOn,
          pendingChange: qqqNextState?.available ? qqqNextState.on !== qqqOn : null } } : {}),
      strategy: { ...strategy, warmupDays, insufficientMaDays, signalBasis: systematicMethod ? 'prior_common_close_fixed_units_and_cash_orders' : qqqTiming ? 'prior_common_close_actual_qqq_200ma_252high_20out_3in' : cashTopup ? 'prior_common_close_fixed_cash_orders_next_common_close' : 'prior_common_close_target_weight_reference' },
      plan: { initial: [...initialPlan].map(([day, amount]) => ({ day, amount })), income: [...incomePlan].map(([day, amount]) => ({ day, amount })) }, taxEvents,
      grossValue: final.grossValue, taxReserve: final.taxReserve, paidTax: final.paidTax, taxCost: final.taxCost, capitalTax: sum(capitalTaxes), dividendTax: sum(dividendTaxes), carriedPrices, carriedFx, benchmark, benchmarkError,
      config: JSON.parse(JSON.stringify({ ...config, currency, dividendPolicy })) };
    chartSources.set(result, { days: strategyDays, referenceHistory,
      qqq: qqqTiming ? [...qqqSignals.values(), qqqNextState].filter(p => p && p.signalDay >= start)
        .map(p => [p.signalDay, p.ready && p.on != null ? Number(p.on) * 100 : null]) : null });
    return result;
  }
  // Closing positions after fills. Invested capital, target weights, and a
  // timing rule's 0/1 permission do not measure what the account actually owns.
  function accountAllocation(row) {
    const gross = row?.grossValue, cash = row?.cash;
    if (!finite(gross) || !finite(cash)) return { securitiesValue: null, cash: null, securitiesPct: null, cashPct: null };
    const securitiesValue = gross - cash;
    return { securitiesValue, cash, securitiesPct: gross > 0 ? securitiesValue / gross * 100 : null, cashPct: gross > 0 ? cash / gross * 100 : null };
  }
  function strategyStatus(result, day = result?.end) {
    if (!result?.curve?.length || !M.validDate(day)) return null;
    const latest = rows => {
      let lo = 0, hi = rows.length - 1, index = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].day <= day) { index = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return rows[index] || null;
    };
    const point = latest(result.curve);
    if (!point) return null;
    const method = result.strategy.initialMethod, allocation = accountAllocation(point), source = chartSources.get(result);
    const atEnd = point.day === result.end, liquidated = atEnd && !!result.config.tax?.liquidate;
    const account = { day: point.day, value: point.value, cash: point.cash, grossValue: point.grossValue,
      securitiesValue: allocation.securitiesValue, securitiesPct: allocation.securitiesPct,
      initialReserve: point.initialReserve, positionPrincipal: point.positionPrincipal };
    const observationDay = source?.days.filter(value => value <= point.day).at(-1) || point.day;
    const state = { day: point.day, observationDay, method, status: liquidated ? 'liquidated' : 'ready',
      label: liquidated ? '已清仓' : '持仓中', detail: '', account, signalDay: null, sourceDay: null,
      indicators: [], nextPlan: null, nextPlanAvailable: liquidated, nextSignal: null, observation: null };
    const number = value => Number(value.toFixed(2));
    const observation = latest(result.systematic?.daily || []);
    if (observation) {
      Object.assign(state, { status: observation.status, observationDay: observation.day, signalDay: observation.day,
        sourceDay: observation.metadata?.sourceDay || null, indicators: observation.indicators,
        nextPlan: observation.nextPlan, nextPlanAvailable: true, observation });
      if (observation.status === 'liquidated') state.label = '已清仓';
      else if (observation.status === 'missing') { state.label = '缺少策略数据'; state.detail = observation.missing; }
      else if (observation.status === 'warming-up') { state.label = '策略预热中'; state.detail = observation.metadata?.reason || '有效历史不足，尚未形成策略信号'; }
      else if (observation.metadata?.opportunity) {
        state.label = observation.nextPlan?.orders.some(o => o.side === 'sell') ? '待退出' : observation.nextPlan?.orders.some(o => o.side === 'buy') ? '待加仓' : '暂无新订单';
        state.detail = observation.indicators.map(i => i.label + ' ' + (finite(i.value) ? number(i.value) + ' 分' : '暂无评分')).join('；');
      } else if (method === 'relative_strength_rotation') {
        state.label = '轮动配置';
        state.detail = observation.indicators.map(i => i.label + ' ' + (finite(i.value) ? number(i.value) + '%' : '暂无数据')).join('；');
      } else {
        state.label = observation.indicator === 100 ? 'TQQQ 持有信号' : 'TQQQ 退出信号';
        state.detail = observation.nextPlan?.orders.length ? '信号已生成，等待下一共同收盘执行' : '状态未改变，暂无新订单';
      }
      return state;
    }
    if (liquidated) return state;
    if (method === 'drawdown_ladder') {
      state.label = point.initialReserve > EPS ? '等待阶梯加仓' : '本金已释放';
      state.detail = result.config.initial > 0 ? '已释放初始本金 ' + number(result.config.initial - point.initialReserve) : '未设置初始本金';
    } else if (method === 'ma200_hold') {
      const completed = source ? Math.max(0, source.days.filter(d => d <= point.day).length - 1) : 0;
      if (result.config.initial <= 0) { state.label = '未启用本金择时'; state.detail = '初始本金为 0，按持续投入设置运行'; }
      else if (source && result.strategy.warmupDays + completed < 200) {
        state.status = 'warming-up'; state.label = '均线预热中'; state.detail = '未满 200 个共同收盘，按原配置投入';
      } else { state.label = point.exposure ? '均线策略持有' : '均线策略持币'; state.detail = '最近执行的仓位状态'; }
    } else if (method === 'qqq_bear_confirm') {
      state.label = point.qqqOn ? 'TQQQ 允许持有' : 'TQQQ 已退出';
      state.signalDay = point.qqqSignalDay || null; state.sourceDay = point.qqqSourceDay || null;
      state.detail = '最近执行的风险状态';
      if (atEnd) {
        state.nextSignal = result.qqqNextSignal;
        if (state.nextSignal?.available && state.nextSignal.pendingChange) state.detail += state.nextSignal.on ? '；下一共同收盘恢复 TQQQ' : '；下一共同收盘退出 TQQQ';
        else if (state.nextSignal?.missing) state.detail += '；' + state.nextSignal.missing;
      }
    } else if (method === 'cash_topup') {
      state.label = allocation.securitiesPct !== null && allocation.securitiesPct < 100 - result.cashWeight - 1e-8 ? '低于目标仓位' : '已达目标仓位';
      state.detail = '目标股票仓位 ' + number(100 - result.cashWeight) + '%';
      if (atEnd) {
        state.nextPlanAvailable = true; state.signalDay = result.topupSignalDay;
        if (result.nextTopupPlan) state.nextPlan = { ...result.nextTopupPlan, orders: result.nextTopupPlan.orders.map(order => ({ ...order, side: 'buy' })) };
      }
    }
    return state;
  }
  const chartPair = ['us:USD', 'us:TQQQ'];
  const chartLine = (id, label, kind, points, extra = {}) => ({ id, label, kind,
    unit: kind === 'score' ? '分' : kind === 'state' ? '状态' : kind === 'gap' ? '百分点' : '%', points, ...extra });
  const stateCode = on => typeof on === 'boolean' ? Number(on) * 100 : null;
  const scoreId = (family, id) => family + ':' + id;
  const scoreName = (family, id) => (family === 'discount' ? '低位' : '低位与恐慌') + '评分 · ' + (id === 'us:USD' ? 'USD ETF' : 'TQQQ');
  const thresholdName = rule => Math.round(rule.reserve * 100) + '%预留 ' + rule.threshold + '分';
  const stateNames = { qqq: 'QQQ 深熊确认 · TQQQ 持仓状态', vix: 'VIX 恐慌恢复 · TQQQ 持仓状态', dual: '双重风险门 · TQQQ 持仓状态' };
  const relativeName = '相对强弱轮动 · USD 相对 TQQQ 强度';
  const relativeNote = '504日复权收益倍率之比减1；三批轮动按月检视，+25%和−20%为切换门槛。';
  function portfolioLines(result, source, { drawdown, deviation, gap }) {
    const lines = [];
    if (drawdown || deviation) {
      const history = source.referenceHistory();
      if (drawdown) lines.push(chartLine('basket:drawdown', '回撤阶梯 / 定投 · 参考组合回撤', 'drawdown',
        history.map(p => [p.day, p.drawdown]), { thresholds: [-10, -20, -30], note: '目标权重组合自模拟开始的回撤，用于阶梯投入和回撤定投。' }));
      if (deviation) lines.push(chartLine('basket:ma200', '均线择时 / 定投 · 参考组合距200日均线', 'deviation',
        history.map(p => [p.day, p.deviation]), { thresholds: [0], note: '目标权重组合收盘高于均线为正；预热不足200次收盘时留空。' }));
    }
    if (gap) {
      const dates = new Set(source.days), target = 100 - result.cashWeight;
      lines.push(chartLine('account:topup', '现金补仓 · 本账户股票仓位缺口', 'gap',
        result.curve.filter(p => dates.has(p.day)).map(p => [p.day, p.grossValue <= 0 || p.day === result.end && result.config.tax?.liquidate ? null :
          Math.max(0, target - accountAllocation(p).securitiesPct)]),
        { note: '按本次账户股票市值与总资产计算，显示低于目标仓位的百分点；实际买入还受现金与费用限制。' }));
    }
    return lines;
  }
  function chartIndicators(result, references) {
    const source = chartSources.get(result), strategy = result?.strategy || {}, config = result?.config || {};
    const active = source ? portfolioLines(result, source, {
      drawdown: strategy.initialMethod === 'drawdown_ladder' && config.initial > 0 || strategy.contributionMethod === 'dca_drawdown' && config.monthly > 0,
      deviation: strategy.initialMethod === 'ma200_hold' && config.initial > 0 || ['dca_ma_trend', 'dca_ma_contrarian'].includes(strategy.contributionMethod) && config.monthly > 0,
      gap: strategy.initialMethod === 'cash_topup'
    }) : [];
    if (source?.qqq) active.push(chartLine('state:qqq', stateNames.qqq, 'state', source.qqq));
    const daily = result?.systematic?.daily || [], method = strategy.initialMethod, rule = Systematic?.opportunityDefinitions?.[method];
    if (daily.length) {
      const ids = new Set(result.holdings.map(h => h.id));
      for (const indicator of daily[0].indicators.filter(i => ids.has(i.id))) {
        const points = daily.map(row => [row.day, row.indicators.find(i => i.id === indicator.id)?.value ?? null]);
        if (rule) {
          const id = scoreId(rule.family, indicator.id);
          const variants = references?.series?.some(l => l.id === id) ? Object.values(Systematic.opportunityDefinitions)
            .filter(r => r.family === rule.family && r.threshold !== rule.threshold) : [];
          active.push(chartLine(id, scoreName(rule.family, indicator.id), 'score', points, {
            thresholds: [rule.threshold, ...variants.map(r => r.threshold)], thresholdLabel: ['本次 ' + rule.threshold + '分', ...variants.map(thresholdName)].join('；'),
            note: '本次策略买入门槛为' + rule.threshold + '分；分数不代表新增仓位比例。' }));
        }
        else if (indicator.kind === 'allocation_share') active.push(chartLine('rotation:' + indicator.id,
          '轮动目标 · ' + indicator.id.slice(3) + ' 股票预算占比', 'allocation', points));
        else {
          const id = method === 'dual_risk_guard' ? 'dual' : 'vix';
          active.push(chartLine('state:' + id, stateNames[id], 'state', points));
        }
      }
      if (rule && ids.has('us:TQQQ')) active.push(chartLine('state:vix', stateNames.vix, 'state',
        daily.map(row => [row.day, row.missing || !row.metadata?.vixDecision ? null : stateCode(row.metadata.vixOn)])));
      if (method === 'relative_strength_rotation') active.push(chartLine('rotation:relative', relativeName, 'relative',
        daily.map(row => [row.day, row.missing || row.metadata?.observationDay !== row.day || !finite(row.metadata?.relativeRatio) ? null :
          100 * (row.metadata.relativeRatio - 1)]), { thresholds: [-20, 25], note: relativeNote }));
    }
    const ids = new Set(active.map(line => line.id));
    const series = [...active, ...(references?.series || []).filter(line => !ids.has(line.id))];
    return { series, reason: references?.reason || (series.length ? '' : '本次投入方式不使用行情指标。') };
  }
  function chartReferences(result, input) {
    const source = chartSources.get(result);
    if (!source || !input) return { series: [], reason: '缺本次模拟的共同交易日或行情。' };
    const series = portfolioLines(result, source, { drawdown: true, deviation: true, gap: true });
    const held = chartPair.map(id => result.holdings.some(h => h.id === id));
    const missing = [];
    if (held.some(Boolean)) {
      const rawHistories = {};
      for (const [i, proxy] of ['us:SOXX', 'us:QQQ'].entries()) if (held[i]) {
        for (const id of [chartPair[i], proxy]) {
          const asset = input.catalog?.assets?.find(a => a.id === id), history = input.histories?.[id], code = id.slice(3);
          if (!asset || asset.code !== code || asset.kind !== 'etf' || asset.currency !== 'USD' || history?.basis !== 'provider_adjusted_close') {
            missing.push('缺' + code + '实际美元ETF复权日线'); continue;
          }
          try { rawHistories[id] = validateHistory(asset, history); } catch (error) { missing.push(error.message); }
        }
      }
      const { observations, missing: vixMissing } = Systematic.chartMarkets({ rawHistories, days: source.days, vixContext: input.marketContext });
      if (vixMissing) missing.push(vixMissing);
      for (const [leg, proxy] of ['us:SOXX', 'us:QQQ'].entries()) if (held[leg] && rawHistories[proxy] && rawHistories[chartPair[leg]]) {
        for (const family of ['discount', 'mixed']) {
          if (family === 'mixed' && vixMissing) continue;
          const rules = Object.values(Systematic.opportunityDefinitions).filter(rule => rule.family === family);
          const thresholds = [...new Set(rules.map(rule => rule.threshold))];
          series.push(chartLine(scoreId(family, chartPair[leg]), scoreName(family, chartPair[leg]), 'score',
            observations.map(o => [o.day, o.scores[leg][family]]), { thresholds, thresholdLabel: rules.map(thresholdName).join('；'),
              note: rules.map(rule => '预留' + Math.round(rule.reserve * 100) + '%的买入门槛为' + rule.threshold + '分').join('；') + '。' }));
        }
      }
      if (held[1] && rawHistories['us:TQQQ']) {
        if (rawHistories['us:QQQ']) series.push(chartLine('state:qqq', stateNames.qqq, 'state', observations.map(o => [o.day, stateCode(o.qqqOn)])));
        if (!vixMissing) series.push(chartLine('state:vix', stateNames.vix, 'state', observations.map(o => [o.day, stateCode(o.vixOn)])));
        if (rawHistories['us:QQQ'] && !vixMissing) series.push(chartLine('state:dual', stateNames.dual, 'state',
          observations.map(o => [o.day, o.vixOn === null || o.qqqOn === null ? null : stateCode(o.vixOn && o.qqqOn)])));
      }
      if (held.every(Boolean) && chartPair.every(id => rawHistories[id])) series.push(chartLine('rotation:relative', relativeName, 'relative',
        observations.map(o => [o.day, o.relative]), { thresholds: [-20, 25], note: relativeNote }));
    }
    return { series: series.map(s => ({ ...s, reference: true })), reason: missing.join('；') };
  }
  function sanitizeDraft(value, ids) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.positions)) fail('组合配置格式无效');
    const positions = value.positions.map(p => ({ id: p.id, weight: p.weight }));
    const config = { positions, currency: currencyInfo(value).code, dividendPolicy: dividendPolicyOf(value), initial: value.initial, monthly: value.monthly, rebalance: value.rebalance,
      years: value.years, start: value.start || '', end: value.end || '', transactionFee: value.transactionFee,
      feeBasis: value.feeBasis || 'net', feeOverrides: value.feeOverrides || {}, benchmarkId: value.benchmarkId || '', tax: taxConfig(value.tax), ...strategyConfig(value) };
    validateConfig(config, ids);
    if (config.benchmarkId && !ids.has(config.benchmarkId)) fail('对照标的未收录');
    for (const [code, rate] of Object.entries(config.feeOverrides)) {
      if (!/^(\d{6}|[A-Z]{1,6})$/.test(code) || !finite(rate) || rate < 0 || rate >= 100) fail('自定义年费率无效');
    }
    return config;
  }
  return { simulate, simulateWindows, simulateStrategies, strategyStatus, comparisonMethods, compareBenchmark, chartIndicators, chartReferences, validateHistory, validateConfig, sanitizeDraft, allocation, accountAllocation, additionAllocation, amountFromWeight, weightFromAmount, at, annualReturn, holdingXirr, addYears, taxConfig, taxRates, currencyInfo, strategyConfig, strategyNames, initialMethods, contributionMethods, dividendPolicies, opportunityDefinitions: Systematic?.opportunityDefinitions || {} };
});
