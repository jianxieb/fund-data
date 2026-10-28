(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio-model.js'));
  else root.ChanghengPortfolioTimingModel = factory(root.ChanghengPortfolioModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  const DAY = 86400000, YEAR = 365.2425;
  const date = day => Date.parse(day + 'T00:00:00Z');
  const gap = (a, b) => (date(b) - date(a)) / DAY;
  const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(date(day)) && new Date(date(day)).toISOString().slice(0, 10) === day;
  const sum = values => values.reduce((a, b) => a + b, 0);
  const fail = message => { throw new Error(message); };
  const band = percentile => percentile === null ? null : percentile <= 20 ? 'low' : percentile >= 80 ? 'high' : 'middle';
  function quantile(sorted, fraction) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * fraction, lo = Math.floor(index);
    return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);
  }
  function bound(rows, value, selector, upper = false) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1, current = selector(rows[mid]);
      if (current < value || upper && current === value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function summarize(samples) {
    const values = samples.map(s => s.return).sort((a, b) => a - b);
    let lastEnd = '', nonOverlappingN = 0;
    for (const sample of samples) {
      if (sample.entry > lastEnd) { nonOverlappingN++; lastEnd = sample.exit; }
    }
    return { n: samples.length, positiveRate: samples.length ? samples.filter(s => s.return > 0).length / samples.length * 100 : null,
      median: quantile(values, .5), p10: quantile(values, .1), worstReturn: values[0] ?? null,
      worstDrawdown: samples.length ? Math.min(...samples.map(s => s.drawdown)) : null, nonOverlappingN };
  }
  function analyze(input, options = {}) {
    try { return run(input, options); }
    catch (error) { return { status: 'error', missing: error.message }; }
  }
  function run({ catalog, histories, config, fxHistory }, options) {
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    if (!validDay(today) || options.end !== undefined && !validDay(options.end)) fail('时点分析日期无效');
    if (options.end && options.end > today) return { status: 'future', missing: '分析结束日 ' + options.end + ' 晚于今天 ' + today + '，不能使用未来行情' };
    const assets = new Map((catalog?.assets || []).map(a => [a.id, a]));
    const { positions, cashWeight } = P.validateConfig(config, new Set(assets.keys()));
    const currency = P.currencyInfo(config).code;
    const series = positions.map(position => {
      const asset = assets.get(position.id), history = histories?.[position.id];
      if (asset.status !== 'available') fail(asset.name + '：' + (asset.missing || '缺每日历史'));
      if (!['CNY', 'USD'].includes(asset.currency)) fail(asset.name + '：币种未接入');
      const rows = P.validateHistory(asset, history);
      if (asset.first && asset.first !== history.first || asset.asOf && asset.asOf !== history.asOf || asset.basis && asset.basis !== history.basis) fail(asset.name + '：标的库与历史日期或口径不一致');
      return { asset, rows, dates: new Set(rows.map(r => r[0])), weight: position.weight / 100 };
    });
    const needsFx = series.some(s => s.asset.currency !== currency);
    let fx = null;
    if (needsFx) {
      if (catalog.fx?.status !== 'available') fail(catalog.fx?.missing || '缺美元兑人民币日汇率');
      fx = P.validateHistory(catalog.fx, fxHistory);
      if (catalog.fx.first && catalog.fx.first !== fxHistory.first || catalog.fx.asOf && catalog.fx.asOf !== fxHistory.asOf) fail('汇率标的库与历史日期不一致');
    }
    const first = [...series.map(s => s.rows[0][0]), ...(fx ? [fx[0][0]] : [])].sort().at(-1);
    const cutoff = [options.end || today, today, ...series.map(s => s.rows.at(-1)[0]), ...(fx ? [fx.at(-1)[0]] : [])].sort()[0];
    if (first >= cutoff) fail('所选标的没有可分析的共同历史');
    for (const s of series) {
      for (let i = 1; i < s.rows.length; i++) {
        const a = s.rows[i - 1][0], b = s.rows[i][0];
        if (b > first && b <= cutoff && gap(a, b) > 14) fail(s.asset.name + '在 ' + a + ' — ' + b + ' 存在超过14日的报价缺口，无法分析连续长期历史');
      }
    }
    const shortest = series.reduce((a, b) => a.rows.length < b.rows.length ? a : b);
    const common = shortest.rows.map(r => r[0]).filter(day => day >= first && day <= cutoff && series.every(s => s.dates.has(day)));
    if (common.length < 2) fail('所选标的缺两次共同实际报价，无法分析');
    const end = common.at(-1), curve = [], priorDeviations = [];
    let previous = null, value = 1, peak = 1, maSum = 0, firstDeviation = null;
    for (let i = 0; i < common.length; i++) {
      const day = common[i];
      if (i && gap(common[i - 1], day) > 14) fail(common[i - 1] + ' — ' + day + ' 缺连续共同报价，无法分析长期趋势');
      const quote = fx ? P.at(fx, day, 7) : null;
      if (fx && !quote) fail(day + ' 前缺7日内美元兑人民币实际汇率，无法分析长期趋势');
      const prices = series.map(s => P.at(s.rows, day, 0).value * (s.asset.currency === currency ? 1 : currency === 'USD' ? 1 / quote.value : quote.value));
      if (previous) value *= cashWeight + sum(series.map((s, index) => s.weight * prices[index] / previous[index]));
      if (!Number.isFinite(value) || value <= 0) fail(day + ' 的参考组合净值无效');
      peak = Math.max(peak, value); maSum += value;
      if (i >= 200) maSum -= curve[i - 200].value;
      const ma200 = i >= 199 ? maSum / 200 : null;
      const deviation = ma200 === null ? null : (value / ma200 - 1) * 100;
      const percentileSamples = priorDeviations.length;
      let percentile = null;
      if (deviation !== null) {
        if (firstDeviation && day >= P.addYears(firstDeviation, 3) && percentileSamples >= 600) {
          // Midrank handles repeated values, and the current observation is excluded.
          const lo = bound(priorDeviations, deviation, x => x), hi = bound(priorDeviations, deviation, x => x, true);
          percentile = (lo + hi) / (2 * percentileSamples) * 100;
        }
        priorDeviations.splice(bound(priorDeviations, deviation, x => x), 0, deviation);
        firstDeviation ??= day;
      }
      curve.push({ day, value, ma200, deviation, percentile, percentileSamples, band: band(percentile), drawdown: (value / peak - 1) * 100 });
      previous = prices;
    }
    const latest = { ...curve.at(-1), trend: curve.at(-1).deviation === null ? null : Math.abs(curve.at(-1).deviation) < 1e-10 ? 'flat' : curve.at(-1).deviation > 0 ? 'above' : 'below', return1y: null, volatility1y: null };
    const anniversary = P.addYears(end, -1), index1y = bound(curve, anniversary, r => r.day, true) - 1;
    if (index1y >= 0 && gap(curve[index1y].day, anniversary) <= 14) {
      latest.return1y = (latest.value / curve[index1y].value - 1) * 100;
      const values = curve.slice(index1y), returns = values.slice(1).map((row, index) => row.value / values[index].value - 1);
      if (returns.length >= 100) {
        const mean = sum(returns) / returns.length, observationsPerYear = returns.length * YEAR / gap(values[0].day, end);
        latest.volatility1y = Math.sqrt(sum(returns.map(r => (r - mean) ** 2)) / (returns.length - 1) * observationsPerYear) * 100;
      }
    }
    // Current month is excluded even when the latest quote happens to be its last session.
    const monthly = curve.filter((row, index) => row.percentile !== null && row.day.slice(0, 7) < end.slice(0, 7) && (!curve[index + 1] || curve[index + 1].day.slice(0, 7) !== row.day.slice(0, 7)));
    const horizons = [1, 3].map(years => {
      const samples = [];
      for (const signal of monthly) {
        const entryIndex = bound(curve, signal.day, r => r.day, true);
        if (entryIndex >= curve.length) continue;
        const entry = curve[entryIndex], target = P.addYears(entry.day, years), exitIndex = bound(curve, target, r => r.day);
        if (exitIndex >= curve.length || gap(target, curve[exitIndex].day) > 14) continue;
        const exit = curve[exitIndex];
        let runningPeak = entry.value, drawdown = 0;
        for (let i = entryIndex; i <= exitIndex; i++) {
          runningPeak = Math.max(runningPeak, curve[i].value);
          drawdown = Math.min(drawdown, (curve[i].value / runningPeak - 1) * 100);
        }
        samples.push({ signal: signal.day, entry: entry.day, exit: exit.day, percentile: signal.percentile, band: signal.band, return: (exit.value / entry.value - 1) * 100, drawdown });
      }
      const matched = latest.band === null ? [] : samples.filter(s => s.band === latest.band);
      return { years, baseline: summarize(samples), matched: summarize(matched), samples };
    });
    const sourceEnd = [...series.map(s => s.rows.at(-1)[0]), ...(fx ? [fx.at(-1)[0]] : [])].sort()[0];
    const historical = config.years === 'custom' && !!options.end && options.end < sourceEnd;
    const ageDays = gap(end, today), stale = !historical && ageDays > 7;
    const missing = stale ? '最新共同报价为 ' + end + '，距今天 ' + ageDays + ' 日，缺最近行情，不能判断今天的买卖时机' : latest.ma200 === null ? '仅有 ' + common.length + ' 个共同收盘，缺200个收盘的长期均线' : latest.percentile === null ? '均线偏离历史未同时满3年和600个此前观测，缺可靠长期分位' : null;
    return { status: stale ? 'stale' : missing ? 'insufficient' : 'available', missing, first: common[0], end, today, ageDays,
      historical, sourceEnd, currency, cashWeight: cashWeight * 100, observations: curve.length, basis: 'target_weight_common_close_total_return_before_investor_costs',
      latest, band: latest.band, horizons, curve, monthly,
      caveat: '按目标权重每个共同收盘复位，现金零息；未计交易费和投资者税。历史月份及未来持有期重叠，只是描述性样本，不代表预测概率或已验证择时优势。' };
  }
  return { analyze };
});
