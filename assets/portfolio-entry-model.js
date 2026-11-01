(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengPortfolioEntryModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, VERSION = 'entry-percentile-knn-v1', MIN_TRAINING = 36, MIN_NEIGHBORS = 24;
  const date = day => Date.parse(day + 'T00:00:00Z');
  const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(date(day)) && new Date(date(day)).toISOString().slice(0, 10) === day;
  const validPercentile = value => Number.isFinite(value) && value >= 0 && value <= 100;
  const order = (a, b) => a.signal.localeCompare(b.signal);
  const scoreBands = Object.freeze([
    { id: 'low', label: '低于40分', min: 0, max: 40, upperExclusive: true },
    { id: 'middle', label: '40至不足60分', min: 40, max: 60, upperExclusive: true },
    { id: 'high', label: '60分及以上', min: 60, max: 100, upperExclusive: false }
  ].map(Object.freeze));
  const method = Object.freeze({ designDate: '2026-11-01', feature: 'ma200_deviation_percentile', minimumMatureMonths: MIN_TRAINING,
    minimumNeighbors: MIN_NEIGHBORS, boundaryTies: 'include_all', horizonYears: 1, trainingRule: 'exit_lte_asof_and_signal_lt_asof',
    outcome: 'reference_cumulative_return_before_investor_costs', validation: 'historical_replay', genuineUnseenHoldout: false,
    scoreMeaning: '相近历史月份的一年收益在当时全部成熟月份中的平均中秩分位，不是上涨概率或预期收益率' });
  function anniversary(day) {
    const year = Number(day.slice(0, 4)) + 1, month = Number(day.slice(5, 7)), originalDay = Number(day.slice(8, 10));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return year + '-' + String(month).padStart(2, '0') + '-' + String(Math.min(originalDay, lastDay)).padStart(2, '0');
  }
  function quantile(sorted, fraction) {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * fraction, lower = Math.floor(at);
    return sorted[lower] + (sorted[Math.ceil(at)] - sorted[lower]) * (at - lower);
  }
  function summarize(samples) {
    const rows = (samples || []).filter(row => Number.isFinite(row?.return) && Number.isFinite(row?.drawdown));
    const returns = rows.map(row => row.return).sort((a, b) => a - b), drawdowns = rows.map(row => row.drawdown).sort((a, b) => a - b);
    let lastExit = '', nonOverlappingN = 0;
    for (const row of rows.slice().sort((a, b) => String(a.entry).localeCompare(String(b.entry)) || String(a.exit).localeCompare(String(b.exit)))) {
      if (validDay(row.entry) && validDay(row.exit) && row.entry > lastExit) { nonOverlappingN++; lastExit = row.exit; }
    }
    return { n: rows.length, median: quantile(returns, .5), p10: quantile(returns, .1), positiveRate: rows.length ? rows.filter(row => row.return > 0).length / rows.length * 100 : null,
      worstReturn: returns[0] ?? null, medianDrawdown: quantile(drawdowns, .5), p10Drawdown: quantile(drawdowns, .1), worstDrawdown: drawdowns[0] ?? null, nonOverlappingN };
  }
  function validSample(row) {
    if (!row || !validDay(row.signal) || !validDay(row.entry) || !validDay(row.exit) || !validPercentile(row.percentile) || !Number.isFinite(row.return) || !Number.isFinite(row.drawdown)) return false;
    if (row.signal >= row.entry || row.entry >= row.exit || row.return <= -100 || row.drawdown <= -100 || row.drawdown > 0) return false;
    const target = anniversary(row.entry);
    return row.exit >= target && (date(row.exit) - date(target)) / DAY <= 14;
  }
  function bound(sorted, value, upper = false) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value || upper && sorted[mid] === value) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function predict(state, matureSamples) {
    const asOf = state?.day ?? state?.asOf ?? null;
    const result = { value: null, asOf, feature: { id: method.feature, label: '200日均线偏离历史分位', value: validPercentile(state?.percentile) ? state.percentile : null },
      trainingN: 0, neighborN: 0, neighbors: [], matched: summarize([]), baseline: summarize([]), distanceRange: null, latestTrainingExit: null, missing: null };
    if (!validDay(asOf)) return { ...result, missing: '缺有效观察日期，无法确定当时已成熟的一年样本' };
    if (!validPercentile(state?.percentile)) return { ...result, missing: '缺200日均线偏离的长期历史分位，无法匹配历史月份' };
    // One observation per completed month. Keep the last dated observation if
    // callers supply duplicate months; duplicates cannot inflate the minimum.
    const byMonth = new Map();
    for (const sample of (matureSamples || []).filter(validSample).filter(row => row.signal < asOf && row.exit <= asOf).slice().sort(order)) byMonth.set(sample.signal.slice(0, 7), sample);
    const training = [...byMonth.values()].sort(order);
    result.trainingN = training.length; result.baseline = summarize(training);
    result.latestTrainingExit = training.length ? training.map(row => row.exit).sort().at(-1) : null;
    if (training.length < MIN_TRAINING) return { ...result, missing: '截至 ' + asOf + ' 仅有 ' + training.length + ' 个已成熟一年结果的历史月份，至少需要36个' };
    const ranked = training.map(row => ({ ...row, distance: Math.abs(row.percentile - state.percentile) })).sort((a, b) => a.distance - b.distance || order(a, b));
    const boundary = ranked[MIN_NEIGHBORS - 1].distance, selected = ranked.filter(row => row.distance <= boundary), returns = training.map(row => row.return).sort((a, b) => a - b);
    let rankTotal = 0;
    const neighbors = selected.map(row => {
      const rankNumerator = (bound(returns, row.return) + bound(returns, row.return, true)) / 2;
      rankTotal += rankNumerator;
      return { signal: row.signal, entry: row.entry, exit: row.exit, percentile: row.percentile, return: row.return, drawdown: row.drawdown, distance: row.distance, rank: rankNumerator / training.length * 100 };
    });
    return { ...result, value: rankTotal * 100 / training.length / neighbors.length, neighborN: neighbors.length, neighbors, matched: summarize(neighbors),
      distanceRange: { min: neighbors[0].distance, max: boundary } };
  }
  function scoreBand(value) {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value < 40 ? 'low' : value < 60 ? 'middle' : 'high' : null;
  }
  function comparison(samples) {
    const high = summarize(samples.filter(row => row.value >= 60)), rest = summarize(samples.filter(row => row.value < 60));
    const difference = key => high[key] === null || rest[key] === null ? null : high[key] - rest[key];
    return { high, rest, medianDifference: difference('median'), p10Difference: difference('p10'), medianDrawdownDifference: difference('medianDrawdown'), p10DrawdownDifference: difference('p10Drawdown') };
  }
  function rankingCorrelation(samples) {
    const rows = (samples || []).filter(row => Number.isFinite(row.value) && Number.isFinite(row.return));
    if (rows.length < 2) return null;
    const rank = values => {
      const sorted = values.slice().sort((a, b) => a - b);
      return values.map(value => (bound(sorted, value) + bound(sorted, value, true)) / 2);
    };
    const x = rank(rows.map(row => row.value)), y = rank(rows.map(row => row.return));
    const center = rows.length / 2;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < rows.length; i++) { const a = x[i] - center, b = y[i] - center; xy += a * b; xx += a * a; yy += b * b; }
    return xx && yy ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
  }
  function groupEvidence(samples) {
    const comparable = samples.filter(row => Number.isFinite(row.predictionMedian) && Number.isFinite(row.baselineMedian) && Number.isFinite(row.return));
    const mae = key => comparable.length ? comparable.reduce((total, row) => total + Math.abs(row[key] - row.return), 0) / comparable.length : null;
    return { baseline: summarize(samples), bands: scoreBands.map(band => ({ ...band, ...summarize(samples.filter(row => scoreBand(row.value) === band.id)) })), highVsRest: comparison(samples),
      rankingCorrelation: rankingCorrelation(samples), predictionMAE: mae('predictionMedian'), baselineMAE: mae('baselineMedian'), errorN: comparable.length };
  }
  function walkForward(history) {
    const predictions = history.filter(row => Number.isFinite(row.value)), samples = predictions.filter(row => row.actual).map(row => ({ ...row.actual, signal: row.day, value: row.value, predictionMedian: row.matched?.median, baselineMedian: row.baseline?.median }));
    const periods = [
      { id: 'before2020', label: '2020年之前', start: null, end: '2019-12-31' },
      { id: '2020to2022', label: '2020—2022年', start: '2020-01-01', end: '2022-12-31' },
      { id: 'from2023', label: '2023年及之后', start: '2023-01-01', end: null }
    ].map(period => ({ ...period, ...groupEvidence(samples.filter(row => (!period.start || row.signal >= period.start) && (!period.end || row.signal <= period.end))) }));
    return { validation: 'historical_replay', genuineUnseenHoldout: false, horizonYears: 1, predictionN: predictions.length, pendingN: predictions.length - samples.length,
      firstPrediction: predictions[0]?.day ?? null, lastPrediction: predictions.at(-1)?.day ?? null, ...groupEvidence(samples), periods,
      caveat: '按当时已成熟标签逐月重演；规则设计者已接触历史，不能称为真正未见数据的留出检验。持有窗口重叠，非重叠数量不等于统计独立样本。' };
  }
  function analyze(timing) {
    const base = { version: VERSION, usage: 'experimental_history_rank', method, historical: !!timing?.historical };
    const fail = (status, missing) => ({ ...base, ...predict(null, []), status, missing, history: [], walkForward: walkForward([]) });
    if (!timing || !Array.isArray(timing.curve) || !timing.curve.length) return fail(timing?.status || 'insufficient', timing?.missing || '缺共同收盘历史，无法校准历史条件结果');
    const cutoffs = [timing.end, timing.today].filter(validDay).sort();
    if (!cutoffs.length) return fail('error', '缺有效分析截止日，无法隔离未来数据');
    const cutoff = cutoffs[0], curve = timing.curve.filter(row => validDay(row?.day) && row.day <= cutoff).slice().sort((a, b) => a.day.localeCompare(b.day));
    if (!curve.length) return fail('insufficient', '分析截止日之前缺共同收盘历史');
    const latest = curve.at(-1), byDay = new Map(curve.map(row => [row.day, row])), lastByMonth = new Map(curve.map(row => [row.day.slice(0, 7), row.day]));
    // Never treat a still-open final month as a completed-month signal. We also
    // recheck the supplied monthly dates against the cutoff-clipped curve.
    const monthly = [...new Map((timing.monthly || []).filter(row => byDay.has(row.day) && row.day.slice(0, 7) < latest.day.slice(0, 7) && lastByMonth.get(row.day.slice(0, 7)) === row.day)
      .map(row => [row.day, byDay.get(row.day)])).values()].filter(row => validPercentile(row.percentile)).sort((a, b) => a.day.localeCompare(b.day));
    const monthDays = new Set(monthly.map(row => row.day));
    const samples = (timing.horizons?.find(h => h.years === 1)?.samples || []).filter(row => monthDays.has(row.signal) && row.exit <= latest.day && byDay.has(row.entry) && byDay.has(row.exit))
      .map(row => ({ ...row, percentile: byDay.get(row.signal).percentile })).filter(validSample);
    const actualBySignal = new Map(samples.map(row => [row.signal, row]));
    const history = monthly.map(state => {
      const prediction = predict(state, samples), actual = actualBySignal.get(state.day);
      return { day: state.day, ...prediction, band: scoreBand(prediction.value), actual: actual ? { entry: actual.entry, exit: actual.exit, return: actual.return, drawdown: actual.drawdown } : null };
    });
    const current = predict(latest, samples), unavailable = ['stale', 'error', 'future'].includes(timing.status);
    const missing = unavailable ? timing.missing || '行情状态为 ' + timing.status + '，不提供当前历史校准分' : current.missing;
    return { ...base, ...current, value: unavailable ? null : current.value, status: unavailable ? timing.status : current.missing ? 'insufficient' : 'available', missing,
      band: unavailable ? null : scoreBand(current.value), history, walkForward: walkForward(history) };
  }
  return { analyze, predict, summarize, scoreBand, scoreBands, walkForward, rankingCorrelation, method };
});
