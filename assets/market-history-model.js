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
  // Fixed descriptive bands, never calibrated to subsequent returns.
  const stateEdges = {
    vix: [-Infinity, 15, 20, 30, Infinity], vxn: [-Infinity, 20, 25, 35, Infinity],
    rv21: [-Infinity, 10, 20, 30, Infinity], drawdown: [-Infinity, -20, -10, -5, Infinity],
    ma200: [-Infinity, -10, 0, 10, Infinity]
  };
  const horizons = [21, 63, 126, 252];
  function stateBand(id, value) {
    const edges = stateEdges[id];
    if (!edges || !Number.isFinite(value)) return null;
    const i = edges.findIndex((n, i) => i < edges.length - 1 && value >= n && value < edges[i + 1]);
    return i < 0 ? null : {lo:edges[i], hi:edges[i + 1]};
  }
  function inBand(value, band) { return Number.isFinite(value) && value >= band.lo && value < band.hi; }
  function outcomeStats(events) {
    if (!events.length) return null;
    const returns = events.map(e => e.returnPct).sort((a,b) => a-b), drawdowns = events.map(e => e.drawdownPct).sort((a,b) => a-b);
    return {count:events.length, median:quantile(returns,.5), q25:quantile(returns,.25), q75:quantile(returns,.75),
      lossRate:100 * events.filter(e => e.returnPct < 0).length/events.length,
      medianDrawdown:quantile(drawdowns,.5), q25Drawdown:quantile(drawdowns,.25), worstDrawdown:drawdowns[0]};
  }
  function nonOverlapping(events) {
    let lastExit = -1;
    return events.filter(e => { if (e.entryIndex <= lastExit) return false; lastExit = e.exitIndex; return true; });
  }
  function forwardOutcome(prices, signalIndex, sessions) {
    const entryIndex = signalIndex + 1, exitIndex = entryIndex + sessions;
    if (exitIndex >= prices.length) return null;
    let peak = prices[entryIndex][1], drawdown = 0;
    for (let i = signalIndex + 1; i <= exitIndex; i++) {
      if ((Date.parse(prices[i][0]) - Date.parse(prices[i-1][0])) / DAY > 10) return null;
      peak = Math.max(peak, prices[i][1]);
      drawdown = Math.min(drawdown, prices[i][1] / peak - 1);
    }
    return {signalDate:prices[signalIndex][0], entryDate:prices[entryIndex][0], exitDate:prices[exitIndex][0], entryIndex, exitIndex,
      entryPrice:prices[entryIndex][1], exitPrice:prices[exitIndex][1], returnPct:(prices[exitIndex][1]/prices[entryIndex][1]-1)*100, drawdownPct:drawdown*100};
  }
  function study(market, asOf, years = 20, mode = 'joint') {
    const history = market.prices;
    const symbol = {spx:'^GSPC', ndx:'^NDX'}[market.id];
    if (!symbol || !history || history.basis !== 'price_index' || history.symbol !== symbol || history.currency !== 'USD' || history.source !== 'yahoo-' + market.id) return {error:'缺少同一指数的美元价格历史'};
    const prices = history.points.filter(p => p[0] <= asOf && Number.isFinite(p[1]) && p[1] > 0);
    const keys = mode === 'joint' ? [market.id === 'spx' ? 'vix' : 'vxn', 'ma200'] : [mode];
    const metrics = keys.map(key => market.metrics.find(m => m.id === key && eligibleMetric(market.id, m)));
    if (metrics.some(m => !m || !stateEdges[m.id])) return {error:'该指标缺少可用于历史条件统计的证据'};
    const lookups = metrics.map(m => new Map(m.points.filter(p => p[0] <= asOf && Number.isFinite(p[1]))));
    const current = [...prices].reverse().find(p => lookups.every(values => values.has(p[0])));
    if (!current || (Date.parse(asOf)-Date.parse(current[0]))/DAY > 10) return {error:'指数与指标缺少近期同日观测'};
    const conditions = metrics.map((m,i) => ({id:m.id, label:m.label, unit:m.unit, value:lookups[i].get(current[0]), ...stateBand(m.id,lookups[i].get(current[0]))}));
    const start = windowStart(asOf, years), monthEnds = new Map();
    prices.forEach((p,i) => { if (p[0] >= start && p[0].slice(0,7) < asOf.slice(0,7)) monthEnds.set(p[0].slice(0,7),i); });
    const eligible = [...monthEnds.values()].filter(i => lookups.every(values => values.has(prices[i][0])));
    const matched = i => conditions.every((c,j) => inBand(lookups[j].get(prices[i][0]),c));
    const results = horizons.map(sessions => {
      const all = eligible.flatMap(i => { const e = forwardOutcome(prices,i,sessions); return e ? [{...e,matched:matched(i),values:lookups.map(values=>values.get(prices[i][0]))}] : []; });
      const baselineEvents = nonOverlapping(all), matchedEvents = nonOverlapping(all.filter(e=>e.matched));
      return {sessions, baseline:outcomeStats(baselineEvents), matched:outcomeStats(matchedEvents), baselineEvents, matchedEvents,
        candidates:all.filter(e=>e.matched).length, excludedIncomplete:eligible.filter(i => i+1+sessions>=prices.length).length};
    });
    const visiblePrices = prices.filter(p=>p[0]>=start);
    const timeline = [...monthEnds.values()].map(i=>prices[i]);
    if (visiblePrices.length && timeline.at(-1)?.[0] !== visiblePrices.at(-1)[0]) timeline.push(visiblePrices.at(-1));
    return {mode, start, end:asOf, currentDate:current[0], conditions, results, metrics, prices:visiblePrices,
      timeline:timeline.map(([date,price])=>({date,price,values:lookups.map(values=>values.get(date) ?? null)})),
      sampleStart:eligible.length ? prices[eligible[0]][0] : null};
  }
  function studyCSV(market, analysis, sessions) {
    const result = analysis.results.find(r=>r.sessions===sessions);
    const cell = v => '"'+String(v ?? '').replace(/"/g,'""')+'"';
    const rows = [['index','group','signal_date','entry_date','exit_date','sessions','entry_price','exit_price','price_return_pct','max_drawdown_pct','conditions','condition_values','return_basis','currency','price_source']];
    const bounds = analysis.conditions.map(c=>`${c.id}:[${c.lo},${c.hi})`).join('; ');
    for (const [group,events] of [['similar',result.matchedEvents],['all_periods',result.baselineEvents]]) {
      events.forEach(e=>rows.push([market.symbol,group,e.signalDate,e.entryDate,e.exitDate,sessions,e.entryPrice,e.exitPrice,e.returnPct,e.drawdownPct,bounds,analysis.conditions.map((c,i)=>c.id+':'+e.values[i]).join('; '),'price_index','USD',market.prices.source]));
    }
    return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  return { eligibleMetric, windowStart, quantile, percentile, summarize, downsample, segments, histogram, csv,
    stateBand, inBand, outcomeStats, nonOverlapping, forwardOutcome, study, studyCSV, horizons };
});
