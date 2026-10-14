(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChanghengMarketHistoryModel = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const DAY = 86400000;
  const gapDays = { daily: 10, weekly: 15, monthly: 65, quarterly: 140 };
  function eligibleMetric(marketId, metric) {
    if (metric.estimated || metric.estimatedDates?.length || metric.caution) return false;
    const { id, source, evidence } = metric;
    if (typeof source !== 'string') return false;
    if (marketId === 'spx' || marketId === 'ndx') {
      const vol = marketId === 'spx' ? 'vix' : 'vxn';
      if (id === vol) return source === vol && evidence === 'published';
      return ['rv21', 'drawdown', 'ma200'].includes(id) && source === 'yahoo-' + marketId && evidence === 'calculated';
    }
    if (marketId !== 'macro') return false;
    if (id === 'nfci') return source === 'nfci' && evidence === 'published';
    if (id === 'real10y') return source.startsWith('treasury-real-') && evidence === 'published';
    return ['yield10y', 'curve10_2'].includes(id) && source.startsWith('treasury-nominal-') && evidence === (id === 'curve10_2' ? 'calculated' : 'published');
  }
  function windowStart(asOf, years) {
    const d = new Date(asOf + 'T00:00:00Z'), month = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    if (d.getUTCMonth() !== month) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function percentile(values, current) {
    if (!Number.isFinite(current) || !values.length) return null;
    let below = 0, equal = 0;
    values.forEach(v => { if (v < current) below++; else if (v === current) equal++; });
    return 100 * (below + equal / 2) / values.length;
  }
  function summarize(metric, asOf, years = 20) {
    const start = windowStart(asOf, years);
    const points = metric.points.filter(p => p[0] >= start && p[0] <= asOf && Number.isFinite(p[1]));
    if (!points.length) return null;
    const values = points.map(p => p[1]).sort((a, b) => a - b), last = points.at(-1);
    const threshold = gapDays[metric.frequency] || 140;
    const gaps = points.slice(1).flatMap((p, i) => (Date.parse(p[0]) - Date.parse(points[i][0])) / DAY > threshold ? [[points[i][0], p[0]]] : []);
    return { start, end: asOf, points, last, count: points.length, min: values[0], max: values.at(-1),
      coverageYears: (Date.parse(last[0]) - Date.parse(points[0][0])) / (365.2425 * DAY),
      p10: quantile(values, .1), p25: quantile(values, .25), median: quantile(values, .5), p75: quantile(values, .75), p90: quantile(values, .9),
      percentile: percentile(values, last[1]), lagDays: Math.floor((Date.parse(asOf) - Date.parse(last[0])) / DAY), gaps,
      lateStart: (Date.parse(points[0][0]) - Date.parse(start)) / DAY > threshold,
      stale: (Date.parse(asOf) - Date.parse(last[0])) / DAY > threshold };
  }
  // Retain extrema and both endpoints in time buckets; ranks always use every observation.
  function downsample(points, limit = 300) {
    if (points.length <= limit) return points;
    const bucketSize = Math.ceil((points.length - 2) / Math.max(1, Math.floor((limit - 2) / 2)));
    const indices = new Set([0, points.length - 1]);
    for (let i = 1; i < points.length - 1; i += bucketSize) {
      let low = i, high = i;
      for (let j = i + 1; j < Math.min(i + bucketSize, points.length - 1); j++) {
        if (points[j][1] < points[low][1]) low = j;
        if (points[j][1] > points[high][1]) high = j;
      }
      indices.add(low); indices.add(high);
    }
    return [...indices].sort((a, b) => a - b).map(i => points[i]);
  }
  function segments(points, frequency) {
    const output = [[]], threshold = (gapDays[frequency] || 140) * DAY;
    points.forEach((p, i) => {
      if (i && Date.parse(p[0]) - Date.parse(points[i - 1][0]) > threshold) output.push([]);
      output.at(-1).push(p);
    });
    return output;
  }
  function histogram(points, bins = 24) {
    const values = points.map(p => p[1]);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= Math.max(1, Math.abs(min) * .05); max += Math.max(1, Math.abs(max) * .05); }
    const width = (max - min) / bins;
    const counts = Array(bins).fill(0);
    values.forEach(v => counts[Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)))]++);
    return { min, max, width, counts, total: values.length };
  }
  function csv(market, metric, summary) {
    const cell = value => '"' + String(value).replace(/"/g, '""') + '"';
    const rows = [['index', 'metric', 'date', 'value', 'unit', 'source', 'window_start', 'window_end']];
    summary.points.forEach(([date, value]) => rows.push([market.symbol, metric.id, date, value, metric.unit, metric.source, summary.start, summary.end]));
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  return { eligibleMetric, windowStart, quantile, percentile, summarize, downsample, segments, histogram, csv };
});
