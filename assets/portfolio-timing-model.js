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
  const SCORE_VERSION = 'add-score-v1';
  const scoreBands = Object.freeze([
    { id: 'wait', label: '暂缓额外加仓', min: 0, max: 39, action: '暂缓额外加仓，等待趋势或波动条件改善' },
    { id: 'watch', label: '观察，维持原计划', min: 40, max: 59, action: '继续观察，维持原有投入计划' },
    { id: 'small', label: '小额分批候选', min: 60, max: 79, action: '可列为小额分批候选，结合原有仓位执行' },
    { id: 'priority', label: '优先分批候选', min: 80, max: 100, action: '在原有投入额度内优先考虑分批加仓' }
  ].map(Object.freeze));
  function scoreFromMetrics(row) {
    if (!['value', 'ma200', 'ma200Prior20', 'ma50', 'percentile', 'volatilityPercentile'].every(key => Number.isFinite(row?.[key]))) return null;
    if (row.value <= 0 || row.ma200 <= 0 || row.ma200Prior20 <= 0 || row.ma50 <= 0 || row.percentile < 0 || row.percentile > 100 || row.volatilityPercentile < 0 || row.volatilityPercentile > 100) return null;
    const above200 = row.value > row.ma200, rising200 = row.ma200 > row.ma200Prior20, above50 = row.value > row.ma50;
    const location = 40 * (1 - row.percentile / 100), trend = (above200 ? 20 : 0) + (rising200 ? 10 : 0) + (above50 ? 10 : 0), stability = 20 * (1 - row.volatilityPercentile / 100);
    const raw = location + trend + stability, active = row.value < row.ma200 && row.ma200 < row.ma200Prior20;
    const capped = active ? Math.min(raw, 39) : raw, value = Math.max(0, Math.min(100, Math.round(capped)));
    return { value, raw, band: scoreBands.find(b => value >= b.min && value <= b.max), components: [
      { id: 'location', label: '长期位置', points: location, max: 40, value: row.percentile, detail: '均线偏离历史分位 ' + row.percentile.toFixed(2) + '%；相对位置越低，得分越高' },
      { id: 'trend', label: '趋势确认', points: trend, max: 40, value: trend, detail: '高于200日均线 ' + (above200 ? '+20' : '+0') + '；200日均线较20个共同收盘前上升 ' + (rising200 ? '+10' : '+0') + '；高于50日均线 ' + (above50 ? '+10' : '+0') },
      { id: 'stability', label: '波动稳定度', points: stability, max: 20, value: row.volatilityPercentile, detail: '63日波动历史分位 ' + row.volatilityPercentile.toFixed(2) + '%；相对波动越低，得分越高' }
    ], gate: { active, cap: active ? 39 : null, deduction: raw - capped, reason: active ? '净值低于200日均线且200日均线下降，评分上限39分' : null } };
  }
  function emptyScoring(missing) {
    return { version: SCORE_VERSION, value: null, raw: null, band: null, components: [], gate: { active: false, cap: null, deduction: 0, reason: null }, change20: null, history: [], evidence: { validation: 'descriptive', assessment: assessEvidence([]), horizons: [] }, missing };
  }
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
  function assessEvidence(samples) {
    const high = summarize(samples.filter(sample => sample.score >= 60)), low = summarize(samples.filter(sample => sample.score < 60));
    const medianDifference = high.median === null || low.median === null ? null : high.median - low.median;
    const status = high.nonOverlappingN < 5 || low.nonOverlappingN < 5 ? 'insufficient' : medianDifference <= 0 ? 'not_supported' : high.p10 < low.p10 || high.worstDrawdown < low.worstDrawdown ? 'mixed' : 'favorable';
    const label = { insufficient: '缺足够非重叠历史样本', not_supported: '暂未证实高分更好', mixed: '历史高分组收益与风险表现不一致', favorable: '历史高分组较有利（回溯检验）' }[status];
    const difference = medianDifference === null ? '缺少可比较的成熟样本' : '高分组一年收益中位数较低分组' + (medianDifference >= 0 ? '高 ' : '低 ') + Math.abs(medianDifference).toFixed(2) + ' 个百分点';
    return { status, label, detail: '按固定规则比较≥60分与<60分的成熟一年样本；' + difference + '。两组非重叠样本分别为 ' + high.nonOverlappingN + ' / ' + low.nonOverlappingN + '，每组至少需5个；属于回溯描述，未做样本外验证。', high, low, medianDifference };
  }
  function analyze(input, options = {}) {
    try { return run(input, options); }
    catch (error) { return { status: 'error', missing: error.message, scoring: emptyScoring(error.message) }; }
  }
  function run({ catalog, histories, config, fxHistory }, options) {
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    if (!validDay(today) || options.end !== undefined && !validDay(options.end)) fail('时点分析日期无效');
    if (options.end && options.end > today) {
      const missing = '分析结束日 ' + options.end + ' 晚于今天 ' + today + '，不能使用未来行情';
      return { status: 'future', missing, scoring: emptyScoring(missing) };
    }
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
    const end = common.at(-1), curve = [], priorDeviations = [], priorVolatilities = [], trailingReturns = [];
    let previous = null, value = 1, peak = 1, maSum = 0, ma50Sum = 0, firstDeviation = null, firstVolatility = null;
    for (let i = 0; i < common.length; i++) {
      const day = common[i];
      if (i && gap(common[i - 1], day) > 14) fail(common[i - 1] + ' — ' + day + ' 缺连续共同报价，无法分析长期趋势');
      const quote = fx ? P.at(fx, day, 7) : null;
      if (fx && !quote) fail(day + ' 前缺7日内美元兑人民币实际汇率，无法分析长期趋势');
      const prices = series.map(s => P.at(s.rows, day, 0).value * (s.asset.currency === currency ? 1 : currency === 'USD' ? 1 / quote.value : quote.value));
      if (previous) value *= cashWeight + sum(series.map((s, index) => s.weight * prices[index] / previous[index]));
      if (!Number.isFinite(value) || value <= 0) fail(day + ' 的参考组合净值无效');
      peak = Math.max(peak, value); maSum += value; ma50Sum += value;
      if (i >= 200) maSum -= curve[i - 200].value;
      if (i >= 50) ma50Sum -= curve[i - 50].value;
      const ma200 = i >= 199 ? maSum / 200 : null, ma50 = i >= 49 ? ma50Sum / 50 : null;
      const ma200Prior20 = i >= 219 ? curve[i - 20].ma200 : null;
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
      if (i) trailingReturns.push(value / curve[i - 1].value - 1);
      if (trailingReturns.length > 63) trailingReturns.shift();
      let volatility63 = null, volatilityPercentile = null;
      const volatilityPercentileSamples = priorVolatilities.length;
      if (trailingReturns.length === 63) {
        const mean = sum(trailingReturns) / 63;
        volatility63 = Math.sqrt(sum(trailingReturns.map(r => (r - mean) ** 2)) / 62 * 252) * 100;
        if (firstVolatility && day >= P.addYears(firstVolatility, 3) && volatilityPercentileSamples >= 600) {
          const lo = bound(priorVolatilities, volatility63, x => x), hi = bound(priorVolatilities, volatility63, x => x, true);
          volatilityPercentile = (lo + hi) / (2 * volatilityPercentileSamples) * 100;
        }
        priorVolatilities.splice(bound(priorVolatilities, volatility63, x => x), 0, volatility63);
        firstVolatility ??= day;
      }
      const row = { day, value, ma200, ma50, ma200Prior20, deviation, percentile, percentileSamples, band: band(percentile), drawdown: (value / peak - 1) * 100, volatility63, volatilityPercentile, volatilityPercentileSamples };
      const score = scoreFromMetrics(row);
      curve.push({ ...row, score: score?.value ?? null, scoreRaw: score?.raw ?? null, scoreBand: score?.band.id ?? null, scoreGate: score?.gate.active ?? false });
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
        samples.push({ signal: signal.day, entry: entry.day, exit: exit.day, percentile: signal.percentile, band: signal.band, score: signal.score, scoreBand: signal.scoreBand, return: (exit.value / entry.value - 1) * 100, drawdown });
      }
      const matched = latest.band === null ? [] : samples.filter(s => s.band === latest.band);
      return { years, baseline: summarize(samples), matched: summarize(matched), samples };
    });
    const sourceEnd = [...series.map(s => s.rows.at(-1)[0]), ...(fx ? [fx.at(-1)[0]] : [])].sort()[0];
    const historical = config.years === 'custom' && !!options.end && options.end < sourceEnd;
    const ageDays = gap(end, today), stale = !historical && ageDays > 7;
    const missing = stale ? '最新共同报价为 ' + end + '，距今天 ' + ageDays + ' 日，缺最近行情，不能判断今天的买卖时机' : latest.ma200 === null ? '仅有 ' + common.length + ' 个共同收盘，缺200个收盘的长期均线' : latest.percentile === null ? '均线偏离历史未同时满3年和600个此前观测，缺可靠长期分位' : latest.volatilityPercentile === null ? '63日波动率历史未同时满3年和600个此前观测，缺可靠波动分位' : null;
    const currentScore = missing ? null : scoreFromMetrics(latest), earlier = curve.at(-21);
    const scoring = { ...emptyScoring(missing), ...(currentScore || {}),
      change20: currentScore && Number.isFinite(earlier?.score) ? { value: currentScore.value - earlier.score, day: earlier.day, previous: earlier.score } : null,
      history: curve.filter(row => row.score !== null).map(row => ({ day: row.day, value: row.score, raw: row.scoreRaw, band: row.scoreBand, gateActive: row.scoreGate })),
      evidence: { validation: 'descriptive', horizonUnit: 'calendar_years', signalFrequency: 'completed_calendar_months', entryRule: 'next_common_close', percentileReference: 'expanding_prior_only', volatilityWindow: 63, volatilityAnnualization: 252, minimumPriorYears: 3, minimumPriorObservations: 600,
        assessment: assessEvidence(horizons[0].samples.filter(sample => sample.score !== null)),
        horizons: horizons.map(horizon => {
          const samples = horizon.samples.filter(sample => sample.score !== null);
          const bands = scoreBands.map(b => ({ id: b.id, label: b.label, min: b.min, max: b.max, ...summarize(samples.filter(sample => sample.scoreBand === b.id)) }));
          return { years: horizon.years, baseline: summarize(samples), bands, current: currentScore ? bands.find(b => b.id === currentScore.band.id) : null, samples };
        }) }
    };
    return { status: stale ? 'stale' : missing ? 'insufficient' : 'available', missing, first: common[0], end, today, ageDays,
      historical, sourceEnd, currency, cashWeight: cashWeight * 100, observations: curve.length, basis: 'target_weight_common_close_total_return_before_investor_costs',
      latest, band: latest.band, horizons, curve, monthly, scoring,
      caveat: '按目标权重每个共同收盘复位，现金零息；未计交易费和投资者税。历史月份及未来持有期重叠，只是描述性样本，不代表预测概率或已验证择时优势。' };
  }
  return { analyze, scoreFromMetrics, scoreBands };
});
