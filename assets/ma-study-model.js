(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengMAStudyModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  const horizons = Object.freeze([5, 21, 63, 252]);
  const periods = Object.freeze([200, 250]);
  const directions = Object.freeze(['up', 'down', 'both']);
  const dayMs = 86400000;
  const validWindow = value => Number.isInteger(value) && value >= 1 && value <= 2520;
  const validMinCrossings = (value, window = 2520) => Number.isInteger(value) && value >= 1 && value <= window;
  const byHorizon = fn => Object.fromEntries(horizons.map(h => [h, fn(h)]));
  const change = (start, end) => (end / start - 1) * 100;

  function summarize(values) {
    const sorted = values.slice().sort((a, b) => a - b), n = sorted.length;
    return { n, mean:n ? sorted.reduce((a,b) => a+b, 0) / n : null,
      median:n ? (sorted[(n-1)>>1] + sorted[n>>1]) / 2 : null,
      min:n ? sorted[0] : null, max:n ? sorted[n-1] : null };
  }

  function study(series, {period = 200, direction = 'up', window = 63, minCrossings = null} = {}) {
    if (!periods.includes(period) || !directions.includes(direction) || !validWindow(window) ||
        (minCrossings !== null && !validMinCrossings(minCrossings, window)))
      throw new Error('未知的均线穿越统计条件');
    if (!Array.isArray(series)) throw new Error('指数收盘序列格式有误');

    // A known long outage starts a fresh MA warm-up and a fresh crossing history.
    const stamps = [], segments = [], segmentStarts = [];
    let segment = 0, segmentStart = 0;
    for (let i = 0; i < series.length; i++) {
      const row = series[i], date = row?.[0], close = row?.[1];
      const stamp = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
      if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(stamp) ||
          new Date(stamp).toISOString().slice(0,10) !== date || (i && stamp <= stamps[i-1]) ||
          !Number.isFinite(close) || close <= 0)
        throw new Error('指数收盘序列的日期、顺序或点位有误');
      if (i && stamp - stamps[i-1] > 10 * dayMs) { segment++; segmentStart = i; }
      stamps.push(stamp); segments.push(segment); segmentStarts.push(segmentStart);
    }

    const last = series.length - 1;
    const empty = status => ({status,date:null,close:null,pct:null,maxDrawdownPct:null,minFromStartPct:null});
    function outcome(anchor, h) {
      const end = anchor + h;
      if (segments[anchor] !== segments[Math.min(end,last)]) return empty('gap');
      if (end > last) return empty('pending');
      const start = series[anchor][1];
      let peak = start, trough = start, maxDrawdownPct = 0;
      for (let i = anchor + 1; i <= end; i++) {
        const close = series[i][1];
        peak = Math.max(peak, close); trough = Math.min(trough, close);
        maxDrawdownPct = Math.min(maxDrawdownPct, change(peak, close));
      }
      return {status:'complete',date:series[end][0],close:series[end][1],pct:change(start,series[end][1]),
        maxDrawdownPct,minFromStartPct:change(start,trough)};
    }

    const events = [], counts = {up:0,down:0,total:0,matching:0,windowIncomplete:0};
    let current = null, latest = null, latestMatching = null, cohortN = 0;
    let priorSide = 0, knownSince = null, crossIndices = [], firstCross = 0;
    for (let i = 0; i <= last; i++) {
      if (i === segmentStarts[i]) { priorSide = 0; knownSince = null; crossIndices = []; firstCross = 0; }
      const [date,close] = series[i];
      if (i - segmentStarts[i] + 1 < period) {
        current = {date,close,ma:null,distancePct:null,side:null,rollingCrosses:null,windowComplete:false};
        continue;
      }

      // Sum deviations from today's close with compensation. Flat decimal
      // histories stay exactly on their MA instead of manufacturing crossings.
      let sum = 0, compensation = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const term = (series[j][1] - close) - compensation;
        const next = sum + term;
        compensation = (next - sum) - term;
        sum = next;
      }
      const offset = sum / period, ma = close + offset;
      if (!Number.isFinite(ma) || ma <= 0) throw new Error('指数点位无法计算有效均线');
      const tolerance = Number.EPSILON * Math.max(close,ma) * 4;
      const side = Math.abs(offset) <= tolerance ? 0 : offset < 0 ? 1 : -1;
      let crossing = null;
      if (side) {
        if (priorSide && priorSide !== side) crossing = side > 0 ? 'up' : 'down';
        if (knownSince === null) knownSince = i;
        priorSide = side;
      }
      if (crossing) crossIndices.push(i);
      // The rolling window includes today: [i-window+1, i]. A known side
      // before its first session is needed to rule out an unobserved crossing.
      while (firstCross < crossIndices.length && crossIndices[firstCross] < i - window + 1) firstCross++;
      const windowComplete = knownSince !== null && i - knownSince >= window;
      const rollingCrosses = windowComplete ? crossIndices.length - firstCross : null;
      const distancePct = side ? change(ma,close) : 0;
      current = {date,close,ma,distancePct,side:side > 0 ? 'above' : side < 0 ? 'below' : 'equal',
        rollingCrosses,windowComplete};
      if (!crossing) continue;

      const event = {index:i,date,close,ma,direction:crossing,distancePct,rollingCrosses,windowComplete,
        anchorDate:date,anchorClose:close,outcomes:byHorizon(h => outcome(i,h))};
      latest = event; counts[crossing]++; counts.total++;
      if (direction !== 'both' && direction !== crossing) continue;
      cohortN++;
      if (!windowComplete) counts.windowIncomplete++;
      if (minCrossings !== null && (rollingCrosses === null || rollingCrosses < minCrossings)) continue;
      events.push(event); latestMatching = event; counts.matching++;
    }

    const summary = byHorizon(h => {
      const outcomes = events.map(e => e.outcomes[h]), complete = outcomes.filter(o => o.status === 'complete');
      const values = complete.map(o => o.pct), up = values.filter(v => v > 0).length;
      const flat = values.filter(v => v === 0).length;
      return {...summarize(values),up,flat,down:values.length-up-flat,upPct:values.length ? up/values.length*100 : null,
        pending:outcomes.filter(o => o.status === 'pending').length,missing:outcomes.filter(o => o.status === 'gap').length,
        drawdown:summarize(complete.map(o => o.maxDrawdownPct)),minFromStart:summarize(complete.map(o => o.minFromStartPct))};
    });
    return {first:series[0]?.[0] ?? null,asOf:series[last]?.[0] ?? null,period,direction,window,minCrossings,
      current,latest,latestMatching,counts,cohortN,events:events.reverse(),summary};
  }

  return {study,horizons,periods,directions,validWindow,validMinCrossings};
});
