(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengPortfolioEntry = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, WINDOW = 756, MIN_PRIOR = 126;
  const fields = ['D_all', 'D_252', 'D_21', 'VOL', 'BREADTH'];
  const definitions = [
    { id: 'entry_option', name: '期权期限结构', anchor: 'D_mix', factor: 'VIX' },
    { id: 'entry_volatility', name: '历史波动率', anchor: 'D_21', factor: 'VOL' },
    { id: 'entry_breadth', name: '两腿回撤广度', anchor: 'D_21', factor: 'BREADTH' },
    { id: 'entry_composite', name: '三类等权', anchor: null, factor: null }
  ];
  const methods = Object.freeze(definitions.map(value => Object.freeze(value)));
  const reasons = Object.freeze({
    unsupported_portfolio: '仅研究过人民币计价的USD 30%、TQQQ 30%、现金40%组合',
    unsupported_rebalance: '指标投入方式仅研究过不再平衡的持有方式',
    unsupported_fee_basis: '指标投入方式仅研究过已扣除基金年费的净值口径',
    insufficient_price_history: '共同收盘历史不足',
    insufficient_prior_observations: '此前有效观察不足126个',
    missing_vix_source: '缺VIX与VIX3M同日收盘记录',
    invalid_vix_source: 'VIX与VIX3M记录的日期、数值或精度无效',
    no_prior_vix_close: '信号日前没有VIX与VIX3M同日收盘记录',
    stale_vix_close: '信号日前的VIX与VIX3M记录超过7天',
    insufficient_vix_history: '此前VIX与VIX3M同日观察不足126个',
    missing_signal_close: '缺成交日前的共同收盘',
    missing_feature_row: '缺信号日的完整特征记录',
    invalid_feature: '特征值缺失或无效'
  });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const sum = values => values.reduce((a, b) => a + b, 0);
  const mean = values => sum(values) / values.length;
  const time = value => Date.parse(value + 'T00:00:00Z');
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(time(value)) && new Date(time(value)).toISOString().slice(0, 10) === value;
  const rankValue = value => finite(value) && value >= 0 && value <= 1;
  function supports(config = {}) {
    if (!config || typeof config !== 'object') config = {};
    const positions = Array.isArray(config.positions) ? config.positions.filter(p => p && p.weight !== 0) : [];
    const ids = new Set(positions.map(p => p.id));
    const portfolio = (config.currency ?? 'CNY') === 'CNY' && positions.length === 2 && ids.size === 2 &&
      ['us:USD', 'us:TQQQ'].every(id => positions.some(p => p.id === id && finite(p.weight) && Math.abs(p.weight - 30) < 1e-10));
    const reasonCode = !portfolio ? 'unsupported_portfolio' : (config.rebalance ?? 'none') !== 'none' ? 'unsupported_rebalance' :
      (config.feeBasis ?? 'net') !== 'net' ? 'unsupported_fee_basis' : null;
    return { supported: reasonCode === null, reason: reasonCode === null ? null : reasons[reasonCode],
      reasonCode, scope: 'CNY_USD30_TQQQ30_CASH40' };
  }
  function midpoint(value, previous) {
    // The window is 756 preceding common closes; null raw values occupy dates.
    const prior = previous.slice(-WINDOW).filter(finite);
    if (!finite(value) || prior.length < MIN_PRIOR) return { value: null, priorN: prior.length };
    let lower = 0, ties = 0;
    for (const old of prior) { if (old < value) lower++; else if (old === value) ties++; }
    return { value: (lower + ties / 2) / prior.length, priorN: prior.length };
  }
  function sampleSd(values) {
    const shifted = values.map(value => value - values[0]), average = mean(shifted);
    return Math.sqrt(sum(shifted.map(value => (value - average) ** 2)) / (values.length - 1));
  }
  function vixSource(context) {
    if (!context || !Array.isArray(context.series) || !context.series.length) return { rows: [], reason: 'missing_vix_source' };
    const rows = [];
    for (const item of context.series) {
      if (!Array.isArray(item) || !validDate(item[0]) || (rows.length && item[0] <= rows.at(-1).date)) return { rows: [], reason: 'invalid_vix_source' };
      const numbers = item.slice(1, 3).map(value => typeof value === 'string' && value.trim() ? Number(value) : value);
      const cents = numbers.map(value => Math.round(value * 100));
      if (numbers.length !== 2 || numbers.some((value, i) => !finite(value) || value <= 0 ||
          Math.abs(value * 100 - cents[i]) > 1e-7 || !Number.isSafeInteger(cents[i]) || cents[i] > 10000000)) {
        return { rows: [], reason: 'invalid_vix_source' };
      }
      rows.push({ date: item[0], a: cents[0], b: cents[1] });
    }
    return { rows, reason: null };
  }
  function vixFeature(day, source, cache) {
    if (source.reason) return { value: null, reason: source.reason, observationDay: null, priorN: 0 };
    const values = source.rows;
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid].date < day) lo = mid + 1; else hi = mid; }
    const index = lo - 1, current = values[index];
    if (!current) return { value: null, reason: 'no_prior_vix_close', observationDay: null, priorN: 0 };
    const priorN = Math.min(WINDOW, index);
    if ((time(day) - time(current.date)) / DAY > 7) return { value: null, reason: 'stale_vix_close', observationDay: current.date, priorN };
    if (priorN < MIN_PRIOR) return { value: null, reason: 'insufficient_vix_history', observationDay: current.date, priorN };
    if (!cache.has(index)) {
      let lower = 0, ties = 0;
      for (let j = Math.max(0, index - WINDOW); j < index; j++) {
        // Integer cents preserve exact equal ratios; do not rank rounded floats.
        const difference = current.a * values[j].b - current.b * values[j].a;
        if (difference > 0) lower++; else if (difference === 0) ties++;
      }
      cache.set(index, (lower + ties / 2) / priorN);
    }
    return { value: cache.get(index), reason: null, observationDay: current.date, priorN };
  }
  function buildFeatures({ dates, prices, weights, context } = {}) {
    if (!Array.isArray(dates) || !Array.isArray(prices) || dates.length !== prices.length ||
        !Array.isArray(weights) || !weights.length || weights.some(w => !finite(w) || w < 0) || sum(weights) > 1 + 1e-12) {
      throw new Error('共同日期、价格和目标权重无效');
    }
    const n = weights.length, cashWeight = 1 - sum(weights);
    const source = vixSource(context), cache = new Map(), levels = [], logReturns = [];
    const history = Object.fromEntries(fields.map(key => [key, []]));
    const scope = context?.config ? supports(context.config) : null;
    const rows = [], byDate = Object.create(null); let peak = 1;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i], quote = prices[i];
      if (!validDate(date) || (i && date <= dates[i - 1]) || !Array.isArray(quote) || quote.length !== n || quote.some(p => !finite(p) || p <= 0)) {
        throw new Error('共同日期须严格递增，所有价格须为正数');
      }
      let level = 1;
      if (i) {
        let ratio = cashWeight;
        for (let j = 0; j < n; j++) ratio += weights[j] * (quote[j] / prices[i - 1][j]);
        level = levels[i - 1] * ratio;
        if (!finite(level) || level <= 0) throw new Error('参考组合净值无效');
        logReturns.push(Math.log(ratio));
      }
      levels.push(level); peak = Math.max(peak, level);
      const raw = {
        D_all: 1 - level / peak,
        D_252: i >= 251 ? 1 - level / Math.max(...levels.slice(i - 251, i + 1)) : null,
        D_21: i >= 21 ? Math.max(0, 1 - level / levels[i - 21]) : null,
        VOL: i >= 21 ? sampleSd(logReturns.slice(-21)) : null,
        BREADTH: i >= 251 ? Math.min(...quote.map((p, j) => 1 - p / Math.max(...prices.slice(i - 251, i + 1).map(q => q[j])))) : null
      };
      const row = { date, raw, priorCounts: {}, missingReasons: {}, sourceDates: {}, ...(scope ? { scope } : {}) };
      for (const key of fields) {
        const ranked = midpoint(raw[key], history[key]);
        row[key] = ranked.value; row.priorCounts[key] = ranked.priorN;
        if (ranked.value === null) row.missingReasons[key] = raw[key] === null ? 'insufficient_price_history' : 'insufficient_prior_observations';
        history[key].push(raw[key]);
      }
      const three = [row.D_all, row.D_252, row.D_21];
      row.D_mix = three.every(rankValue) ? mean(three) : null;
      if (row.D_mix === null) row.missingReasons.D_mix = three.some(value => value === null) ? 'insufficient_prior_observations' : 'invalid_feature';
      const vix = vixFeature(date, source, cache);
      row.VIX = vix.value; row.priorCounts.VIX = vix.priorN;
      row.sourceDates.VIX = { observationDay: vix.observationDay, reason: vix.reason };
      if (vix.reason) row.missingReasons.VIX = vix.reason;
      rows.push(row); byDate[date] = row;
    }
    return { rows, byDate, scope, metadata: { reference: 'daily_target_weight', rankWindow: WINDOW, minimumPrior: MIN_PRIOR } };
  }
  function scores(row) {
    const result = { asOf: row?.date ?? null, methods: {} };
    for (const method of methods.slice(0, 3)) {
      const missing = [];
      if (!row) missing.push({ field: null, code: 'missing_feature_row' });
      else if (row.scope?.supported === false) missing.push({ field: null, code: row.scope.reasonCode || 'unsupported_portfolio' });
      else for (const key of [method.anchor, method.factor]) {
        if (!rankValue(row[key])) missing.push({ field: key, code: row.missingReasons?.[key] || 'invalid_feature' });
      }
      const d = row?.[method.anchor], f = row?.[method.factor];
      const signal = missing.length ? null : d + (2 / 3) * (1 - d) * Math.max(0, 2 * f - 1);
      result.methods[method.id] = { available: signal !== null, signal0to1: signal, score0to100: signal === null ? null : signal * 100,
        missingReasons: missing.map(item => ({ ...item, message: reasons[item.code] || reasons.invalid_feature })) };
    }
    const members = methods.slice(0, 3).map(method => result.methods[method.id]);
    const signal = members.every(value => value.available) ? mean(members.map(value => value.signal0to1)) : null;
    const missing = [...new Map(members.flatMap(value => value.missingReasons).map(value => [(value.field || '') + ':' + value.code, value])).values()];
    result.methods.entry_composite = { available: signal !== null, signal0to1: signal, score0to100: signal === null ? null : signal * 100, missingReasons: missing };
    return result;
  }
  function plan(months, featuresByDate, methodId, initial) {
    if (!methods.some(method => method.id === methodId)) throw new Error('未知的研究投入方式');
    if (!Array.isArray(months) || !finite(initial) || initial < 0) throw new Error('本金或月份计划无效');
    const orders = [], decisions = []; let used = 0, available = 0;
    const get = date => featuresByDate instanceof Map ? featuresByDate.get(date) : featuresByDate?.[date];
    for (let i = 0; i < Math.min(12, months.length); i++) {
      const item = months[i], day = item?.day, signalDate = item?.signalDate ?? null;
      if (!validDate(day) || (i && day.slice(0, 7) <= months[i - 1].day.slice(0, 7)) ||
          (signalDate !== null && (!validDate(signalDate) || signalDate >= day))) throw new Error('订单月份或前一共同收盘日期无效');
      const row = signalDate === null ? null : get(signalDate);
      if (row && row.date !== signalDate) throw new Error('特征日期与订单信号日期不符');
      const assessed = scores(row).methods[methodId], score = assessed.signal0to1;
      if (score !== null) available++;
      const target = i === 11 ? 1 : Math.min(1, Math.max(used, (i + 1) / 12, score ?? 0));
      const amount = initial * (target - used); used = target;
      const missingReasons = signalDate === null ? [{ field: null, code: 'missing_signal_close', message: reasons.missing_signal_close }] : assessed.missingReasons;
      decisions.push({ day, signalDate, score, cumulativeReleased: initial * used, missingReasons });
      if (amount > initial * 1e-12) orders.push({ day, signalDate, amount, score });
    }
    const released = sum(orders.map(order => order.amount));
    return { orders, decisions, released, remaining: Math.max(0, initial - released),
      coverage: { plannedMonths: decisions.length, availableMonths: available, missingMonths: decisions.length - available,
        initialAvailable: !!decisions.length && decisions[0].score !== null } };
  }
  return { buildFeatures, scores, plan, supports, methods, reasons, metadata: Object.freeze({
    version: 'entry-structure-1', usage: 'historical_research', validatedForecast: false,
    scoreMeaning: '固定规则刻度，不是上涨概率', scope: 'CNY_USD30_TQQQ30_CASH40',
    rebalance: 'none', feeBasis: 'net',
    optionInput: 'Cboe VIX/VIX3M期权期限比；不是VIX水平或组合自身隐含波动率',
    rankWindow: WINDOW, minimumPrior: MIN_PRIOR, allocationMonths: 12
  }) };
});
