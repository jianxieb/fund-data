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
  function study(series, { threshold = 5, wait = 2, group = 'unrecovered' } = {}) {
    if (!validThreshold(threshold) || !waits.includes(wait) ||
        !['unrecovered', 'recovered', 'all'].includes(group)) throw new Error('未知的大跌统计条件');
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

    const events = [], counts = { unrecovered: 0, recovered: 0, pending: 0, gap: 0, total: 0 };
    const groupValues = byHorizon(() => []), allValues = byHorizon(() => []);
    let latest = null;
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
      const boundary = priorClose * (100 - threshold) / 100;
      // Equality (e.g. 100 -> 95) is not "more than 5%". Allow roundoff in the product only.
      if (boundary - close <= Number.EPSILON * priorClose * 2) continue;

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
        status, observations, recoveryDate, anchorDate, anchorClose, outcomes };
      counts[status]++; counts.total++;
      if (anchorDate && (group === 'all' || group === status)) {
        events.push(latest);
        for (const h of horizons) if (outcomes[h].status === 'complete') groupValues[h].push(outcomes[h].pct);
      }
    }
    return { first: series[0]?.[0] ?? null, asOf: series[last]?.[0] ?? null, threshold, wait, group,
      latest, counts, events: events.reverse(), summary: byHorizon(h => summarize(groupValues[h])),
      baseline: byHorizon(h => summarize(allValues[h])) };
  }
  return { study, horizons, waits, validThreshold };
});
