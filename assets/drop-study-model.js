(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengDropStudyModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const horizons = Object.freeze([5, 21, 63, 252]);
  const waits = Object.freeze([2, 3, 4, 5]);
  const validThreshold = value => Number.isFinite(value) && value >= 3 && value <= 10 &&
    Math.round(value * 100) / 100 === value;
  const days = 86400000;
  const byHorizon = fn => Object.fromEntries(horizons.map(h => [h, fn(h)]));
  const change = (before, after) => 100 * ((after - before) / before);
  const facetOptions = Object.freeze({
    rebound: Object.freeze(['any', 'none', 'partial', 'half', 'full']),
    repeat: Object.freeze(['any', 'first', 'repeat']),
    trend: Object.freeze(['any', 'above', 'below']),
    drawdown: Object.freeze(['any', 'near', 'pullback', 'correction', 'bear'])
  });
  const facetKeys = Object.keys(facetOptions);
  function buckets({ reboundPct: r, priorDrops: n, ma200Pct: m, drawdownPct: d }) {
    return {
      rebound: r == null ? null : r <= 0 ? 'none' : r < 50 ? 'partial' : r < 100 ? 'half' : 'full',
      repeat: n == null ? null : n === 0 ? 'first' : 'repeat',
      trend: m == null ? null : m > 0 ? 'above' : 'below',
      drawdown: d == null ? null : d < 5 ? 'near' : d < 10 ? 'pullback' : d < 20 ? 'correction' : 'bear'
    };
  }
  const matches = (values, options, except) => facetKeys.every(k =>
    k === except || options[k] === undefined || options[k] === 'any' || values[k] === options[k]);
  const matchesFilters = (e, options = {}) => !!e && matches(buckets(e.features), options);
  function isDrop(prior, close, threshold) {
    const boundary = prior * (100 - threshold) / 100;
    return boundary - close > Number.EPSILON * prior * 2;
  }
  const snap = (v, edges, tolerance) => edges.find(edge => Math.abs(v - edge) <= tolerance) ?? v;

  function summarize(values) {
    const n = values.length;
    if (!n) return { n: 0, median: null, mean: null, upPct: null, min: null, max: null };
    values.sort((a, b) => a - b);
    return {
      n, median: (values[(n - 1) >> 1] + values[n >> 1]) / 2,
      mean: values.reduce((a, b) => a + b, 0) / n,
      upPct: 100 * values.filter(v => v > 0).length / n,
      min: values[0], max: values[n - 1]
    };
  }

  // The caller supplies validated, ordered [date, close] rows for ONE price index.
  function study(series, options = {}) {
    const { threshold = 5, wait = 2, group = 'unrecovered' } = options;
    if (!validThreshold(threshold) || !waits.includes(wait) ||
        !['unrecovered', 'recovered', 'all'].includes(group) ||
        facetKeys.some(k => options[k] !== undefined && !facetOptions[k].includes(options[k]))) throw new Error('未知的大跌统计条件');
    const last = series.length - 1;
    // Each long break starts a new segment. Weekends/holidays are not synthetic rows.
    let segment = 0, previousDay;
    const segments = series.map(([date], i) => {
      const day = Date.parse(date);
      if (i && day - previousDay > 10 * days) segment++;
      previousDay = day;
      return segment;
    });
    const empty = status => ({ status, date: null, close: null, pct: null });
    function outcome(anchor, h) {
      const end = anchor + h;
      if (segments[anchor] !== segments[Math.min(end, last)]) return empty('gap');
      if (end > last) return empty('pending');
      const [date, close] = series[end];
      return { status: 'complete', date, close, pct: change(series[anchor][1], close) };
    }

    function features(i, prior, close, anchor) {
      // All three lookbacks end at T−1; the 21 daily losses require 22 closing prices.
      const available = n => i >= n && segments[i - n] === segments[i - 1];
      let reboundPct = null, priorDrops = null, ma200Pct = null, drawdownPct = null;
      if (anchor !== null) {
        reboundPct = snap((anchor - close) / (prior - close) * 100, [50], 200 * Number.EPSILON * prior / (prior - close));
      }
      if (available(22)) {
        priorDrops = 0;
        for (let j = i - 21; j < i; j++) if (isDrop(series[j-1][1], series[j][1], threshold)) priorDrops++;
      }
      if (available(200)) {
        // Sum deviations from the last close: a flat decimal-valued series must stay exactly flat.
        let diff = 0;
        for (let j = i - 200; j < i; j++) diff += series[j][1] - prior;
        const offset = diff / 200;
        ma200Pct = snap(-offset / (prior + offset) * 100, [0], 200 * Number.EPSILON);
      }
      if (available(252)) {
        let high = prior;
        for (let j = i - 252; j < i - 1; j++) high = Math.max(high, series[j][1]);
        drawdownPct = snap((high - prior) / high * 100, [5, 10, 20], 200 * Number.EPSILON);
      }
      return { reboundPct, priorDrops, ma200Pct, drawdownPct };
    }
    const events = [], counts = { unrecovered: 0, recovered: 0, pending: 0, gap: 0, total: 0 };
    const groupValues = byHorizon(() => []), allValues = byHorizon(() => []);
    const facetCounts = Object.fromEntries(facetKeys.map(k => [k,
      Object.fromEntries([...facetOptions[k], 'missing'].map(v => [v, 0]))]));
    let latest = null, cohortN = 0;
    for (let i = 1; i <= last; i++) {
      // Every comparable anchor must have the same available lookback as an event.
      // These unconditional windows include events, and may overlap.
      if (i >= wait + 1 && segments[i] === segments[i - wait - 1]) {
        for (const h of horizons) {
          const end = i + h;
          if (end <= last && segments[end] === segments[i]) allValues[h].push(change(series[i][1], series[end][1]));
        }
      }
      if (segments[i] !== segments[i - 1]) continue; // Not a one-session return.
      const [priorDate, priorClose] = series[i - 1], [date, close] = series[i];
      if (!isDrop(priorClose, close, threshold)) continue;

      const observations = [];
      let status = 'pending', recoveryDate = null, anchorDate = null, anchorClose = null;
      for (let j = i + 1; j <= Math.min(i + wait, last); j++) {
        if (segments[j] !== segments[i]) { status = 'gap'; break; }
        observations.push(series[j]);
        if (!recoveryDate && series[j][1] >= priorClose) recoveryDate = series[j][0];
        if (j === i + wait) {
          status = recoveryDate ? 'recovered' : 'unrecovered';
          [anchorDate, anchorClose] = series[j];
        }
      }
      const outcomes = byHorizon(h => anchorDate ? outcome(i + wait, h) : empty(status));
      latest = { date, close, priorDate, priorClose, dropPct: change(priorClose, close),
        status, observations, recoveryDate, anchorDate, anchorClose, outcomes,
        features: features(i, priorClose, close, anchorClose) };
      counts[status]++; counts.total++;
      if (anchorDate && (group === 'all' || group === status)) {
        cohortN++;
        const values = buckets(latest.features);
        for (const k of facetKeys) if (matches(values, options, k)) {
          facetCounts[k].any++;
          facetCounts[k][values[k] ?? 'missing']++;
        }
        if (!matches(values, options)) continue;
        events.push(latest);
        for (const h of horizons) if (outcomes[h].status === 'complete') groupValues[h].push(outcomes[h].pct);
      }
    }
    return { first: series[0]?.[0] ?? null, asOf: series[last]?.[0] ?? null, threshold, wait, group,
      latest, counts, cohortN, facetCounts, events: events.reverse(), summary: byHorizon(h => summarize(groupValues[h])),
      baseline: byHorizon(h => summarize(allValues[h])) };
  }
  return { study, horizons, waits, validThreshold, facetOptions, matchesFilters };
});
