(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChanghengMarketHistoryModel = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const DAY = 86400000;
  const gapDays = { daily: 10, weekly: 15, monthly: 65, quarterly: 140 };
  function shanghaiDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const date = Object.fromEntries(parts.map(p => [p.type,p.value]));
    return `${date.year}-${date.month}-${date.day}`;
  }
  function observationFreshness(observedAt, frequency = 'daily', checkedOn = shanghaiDate()) {
    const lagDays = Math.floor((Date.parse(checkedOn + 'T00:00:00Z') - Date.parse(observedAt + 'T00:00:00Z')) / DAY);
    const threshold = gapDays[frequency] || 140;
    return {checkedOn, threshold, lagDays:Number.isFinite(lagDays)?lagDays:null,
      future:lagDays<0, stale:!Number.isFinite(lagDays)||lagDays<0||lagDays>threshold};
  }
  function eligibleMetric(marketId, metric) {
    if (metric.estimated || metric.estimatedDates?.length || metric.caution) return false;
    const { id, source, evidence } = metric;
    if (typeof source !== 'string') return false;
    if (marketId === 'spx' || marketId === 'ndx') {
      if (id === 'pe') return source === 'jiucai-' + marketId && evidence === 'provider' && metric.valuationBasis === 'aggregate_ttm' && metric.vintage === 'latest_available' && !!metric.limitations;
      const vol = marketId === 'spx' ? 'vix' : 'vxn';
      if (id === vol) return source === vol && evidence === 'published';
      return ['rv21', 'drawdown', 'mdd252', 'ma200', 'momentum'].includes(id) && source === 'yahoo-' + marketId && evidence === 'calculated';
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
  function summarize(metric, asOf, years = 20, checkedOn = shanghaiDate()) {
    const start = windowStart(asOf, years);
    const points = metric.points.filter(p => p[0] >= start && p[0] <= asOf && Number.isFinite(p[1]));
    if (!points.length) return null;
    const values = points.map(p => p[1]).sort((a, b) => a - b), last = points.at(-1);
    const threshold = gapDays[metric.frequency] || 140;
    const gaps = points.slice(1).flatMap((p, i) => (Date.parse(p[0]) - Date.parse(points[i][0])) / DAY > threshold ? [[points[i][0], p[0]]] : []);
    return { start, end: asOf, points, last, count: points.length, min: values[0], max: values.at(-1),
      coverageYears: (Date.parse(last[0]) - Date.parse(points[0][0])) / (365.2425 * DAY),
      p10: quantile(values, .1), p25: quantile(values, .25), median: quantile(values, .5), p75: quantile(values, .75), p90: quantile(values, .9),
      percentile: percentile(values, last[1]), gaps,
      lateStart: (Date.parse(points[0][0]) - Date.parse(start)) / DAY > threshold,
      ...observationFreshness(last[0], metric.frequency, checkedOn) };
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
  function priceHistory(market, asOf) {
    const h = market.prices, symbol = {spx:'^GSPC', ndx:'^NDX'}[market.id];
    if (!symbol || !h || h.symbol !== symbol || h.basis !== 'price_index' || h.currency !== 'USD' || h.source !== 'yahoo-' + market.id) return null;
    return h.points.filter(([d,v]) => d <= asOf && Number.isFinite(v) && v > 0);
  }
  // A shared calendar axis, with exact-date lookups. No interpolation or last-value
  // carry-forward: a weekly release and a holiday keep their own observation dates.
  function overlay(market, metric, asOf, years = 20, checkedOn = shanghaiDate()) {
    const prices = priceHistory(market, asOf);
    if (!prices) return {error:'缺少同一指数的美元价格历史'};
    const s = summarize(metric, asOf, years, checkedOn);
    if (!s) return {error:'所选窗口缺少该指标观测'};
    const visible = prices.filter(p => p[0] >= s.start);
    if (!visible.length) return {error:'所选窗口缺少指数价格'};
    const pMap = new Map(visible), mMap = new Map(s.points);
    const dates = [...new Set([...pMap.keys(), ...mMap.keys()])].sort();
    return {start:s.start, end:asOf, summary:s, prices:visible, metricPoints:s.points,
      timeline:dates.map(date => ({date, price:pMap.get(date) ?? null, value:mMap.get(date) ?? null}))};
  }
  function nearestObservation(timeline, date) {
    if (!timeline.length) return -1;
    const target = typeof date === 'number' ? date : Date.parse(date);
    let lo = 0, hi = timeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(timeline[mid].date) < target) lo = mid + 1; else hi = mid;
    }
    if (lo && target - Date.parse(timeline[lo-1].date) <= Date.parse(timeline[lo].date) - target) lo--;
    return lo;
  }
  // Calendar-year returns use the last close of the previous year. The first
  // visible partial year starts at the first close inside the requested window.
  function annualRows(market, metric, asOf, years = 20) {
    const prices = priceHistory(market, asOf);
    if (!prices?.length) return [];
    const start = windowStart(asOf, years), currentYear = +asOf.slice(0,4);
    const lookup = new Map(metric.points.filter(p => p[0] <= asOf && Number.isFinite(p[1])));
    const rows = [];
    for (let year = +start.slice(0,4); year <= currentYear; year++) {
      const from = year + '-01-01', until = year === currentYear ? asOf : year + '-12-31';
      const first = prices.findIndex(p => p[0] >= (from < start ? start : from) && p[0] <= until);
      if (first < 0) continue;
      let last = first;
      while (last + 1 < prices.length && prices[last+1][0] <= until) last++;
      const partialStart = from < start;
      const baseline = partialStart ? first : first - 1;
      const baselineOK = baseline >= 0 && (partialStart || (prices[baseline][0] < from && (Date.parse(from)-Date.parse(prices[baseline][0]))/DAY <= 10));
      const endOK = (Date.parse(until)-Date.parse(prices[last][0]))/DAY <= 10;
      const outcome = baselineOK && endOK ? pathOutcome(prices, baseline, last) : null;
      const values = metric.points.filter(([d,v]) => d >= (partialStart ? start : from) && d <= prices[last][0] && Number.isFinite(v)).map(p => p[1]).sort((a,b)=>a-b);
      rows.push({year, partialStart, ytd:year === currentYear && asOf.slice(5) !== '12-31',
        startDate:baselineOK ? prices[baseline][0] : prices[first][0], endDate:prices[last][0],
        price:prices[last][1], returnPct:outcome?.returnPct ?? null, drawdownPct:outcome?.drawdownPct ?? null,
        value:lookup.get(prices[last][0]) ?? null, median:quantile(values,.5), count:values.length,
        incomplete:!outcome});
    }
    return rows;
  }
  function annualCSV(market, metric, rows) {
    const cell = value => '"' + String(value ?? '').replace(/"/g,'""') + '"';
    const output = [['index','year','partial_start','year_to_date','start_date','end_date','price_index_close','price_return_pct','max_drawdown_pct','metric','metric_unit','same_date_metric','period_metric_median','metric_observations','metric_source','price_source']];
    rows.forEach(r => output.push([market.symbol,r.year,r.partialStart,r.ytd,r.startDate,r.endDate,r.price,r.returnPct,r.drawdownPct,metric.id,metric.unit,r.value,r.median,r.count,metric.source,market.prices.source]));
    return '\uFEFF' + output.map(row=>row.map(cell).join(',')).join('\r\n') + '\r\n';
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

  function regression(events) {
    if (events.length < 3) return null;
    const meanX = events.reduce((n,e)=>n+e.value,0)/events.length;
    const meanY = events.reduce((n,e)=>n+e.outcome,0)/events.length;
    let xx=0, yy=0, xy=0;
    events.forEach(e=>{ xx+=(e.value-meanX)**2; yy+=(e.outcome-meanY)**2; xy+=(e.value-meanX)*(e.outcome-meanY); });
    if (xx < 1e-12 || yy < 1e-12) return null;
    const slope=xy/xx;
    return {slope,intercept:meanY-slope*meanX,r:xy/Math.sqrt(xx*yy),r2:Math.min(1,xy*xy/(xx*yy))};
  }
  function relationStats(events) {
    if (!events.length) return null;
    const values=events.map(e=>e.outcome).sort((a,b)=>a-b);
    const losses=events.filter(e=>e.returnPct<0).length;
    return {count:events.length,median:quantile(values,.5),q25:quantile(values,.25),q75:quantile(values,.75),
      min:values[0],max:values.at(-1),lossRate:100*losses/events.length,losses,
      drawdown:quantile(events.map(e=>e.drawdownPct).sort((a,b)=>a-b),.5)};
  }
  function disjointObservations(events) {
    let lastExit=-1;
    return events.filter(e=>{if(e.entryIndex<lastExit)return false;lastExit=e.exitIndex;return true;});
  }
  function monthOffset(month, months) {
    const [year,m]=month.split('-').map(Number);
    return new Date(Date.UTC(year,m-1+months,1)).toISOString().slice(0,7);
  }
  function pathOutcome(prices, start, end) {
    if (end <= start || end >= prices.length) return null;
    let peak=prices[start][1], drawdown=0;
    const logs=[];
    for(let i=start+1;i<=end;i++) {
      if((Date.parse(prices[i][0])-Date.parse(prices[i-1][0]))/DAY>10) return null;
      logs.push(Math.log(prices[i][1]/prices[i-1][1]));
      peak=Math.max(peak,prices[i][1]);drawdown=Math.min(drawdown,prices[i][1]/peak-1);
    }
    const mean=logs.reduce((a,b)=>a+b,0)/logs.length;
    const variance=logs.length>1?logs.reduce((a,b)=>a+(b-mean)**2,0)/(logs.length-1):null;
    const ratio=prices[end][1]/prices[start][1],years=(Date.parse(prices[end][0])-Date.parse(prices[start][0]))/DAY/365.2425;
    return {entryDate:prices[start][0],exitDate:prices[end][0],entryIndex:start,exitIndex:end,
      entryPrice:prices[start][1],exitPrice:prices[end][1],returnPct:(ratio-1)*100,
      annualizedPct:Math.expm1(Math.log(ratio)/years)*100,drawdownPct:drawdown*100,
      realizedVol:variance===null?null:Math.sqrt(variance*252)*100};
  }
  // Descriptive monthly observations, not a tradeable backtest. PE is the provider's
  // latest historical vintage, with no assertion of point-in-time financial availability.
  function relationship(market, asOf, years=20, options={}) {
    const {kind='valuation',months=12,annual=true,sampling='monthly'}=options;
    if(!['valuation','risk'].includes(kind)||![12,36,60].includes(months)||!['monthly','disjoint'].includes(sampling)) return {error:'分析参数无效'};
    const history=market.prices,symbol={spx:'^GSPC',ndx:'^NDX'}[market.id];
    if(!symbol||!history||history.symbol!==symbol||history.source!=='yahoo-'+market.id||history.currency!=='USD'||history.basis!=='price_index')return {error:'缺少同一指数的美元价格历史'};
    const id=kind==='valuation'?'pe':market.id==='spx'?'vix':'vxn';
    const metric=market.metrics.find(m=>m.id===id&&eligibleMetric(market.id,m));
    if(!metric)return {error:'缺少'+(kind==='valuation'?'整体法TTM PE历史':'官方隐含波动历史')};
    const prices=history.points.filter(p=>p[0]<=asOf&&Number.isFinite(p[1])&&p[1]>0);
    const lookup=new Map(metric.points.filter(p=>p[0]<=asOf&&Number.isFinite(p[1])));
    const current=[...prices].reverse().find(p=>lookup.has(p[0]));
    if(!current||(Date.parse(asOf)-Date.parse(current[0]))/DAY>10)return {error:'指标与指数缺少近期同日观测'};
    const start=windowStart(asOf,years),monthEnds=new Map();
    prices.forEach((p,i)=>{if(p[0].slice(0,7)<asOf.slice(0,7))monthEnds.set(p[0].slice(0,7),i);});
    const edges=kind==='valuation'?[0,20,25,30,35,Infinity]:stateEdges[id];
    const bands=edges.slice(0,-1).map((lo,i)=>({lo,hi:edges[i+1]}));
    const currentValue=lookup.get(current[0]),currentBand=bands.findIndex(b=>inBand(currentValue,b));
    const candidates=[...monthEnds.values()].filter(i=>prices[i][0]>=start&&lookup.has(prices[i][0]));
    let incomplete=0, gaps=0;
    const all=candidates.flatMap(i=>{
      const end=kind==='risk'?i+21:monthEnds.get(monthOffset(prices[i][0].slice(0,7),months));
      if(end===undefined||end>=prices.length){incomplete++;return [];}
      const result=pathOutcome(prices,i,end);
      if(!result){gaps++;return [];}
      const value=lookup.get(prices[i][0]),outcome=kind==='risk'?result.realizedVol:annual?result.annualizedPct:result.returnPct;
      return [{...result,date:prices[i][0],value,outcome,band:bands.findIndex(b=>inBand(value,b))}];
    });
    const events=sampling==='disjoint'?disjointObservations(all):all;
    const matched=events.filter(e=>e.band===currentBand);
    const points=metric.points.filter(p=>p[0]>=start&&p[0]<=asOf&&lookup.has(p[0])&&Number.isFinite(p[1]));
    return {kind,months,annual,sampling,start,end:asOf,metric,current:{date:current[0],value:currentValue,price:current[1]},
      currentBand,bands:bands.map((b,i)=>({...b,...relationStats(events.filter(e=>e.band===i)),current:i===currentBand})),
      events,matched,stats:relationStats(events),matchedStats:relationStats(matched),fit:regression(events),
      monthlyCount:all.length,disjointCount:disjointObservations(all).length,matchedDisjointCount:disjointObservations(matched).length,
      incomplete,gaps,coverageStart:points[0]?.[0],coverageEnd:points.at(-1)?.[0],sampleStart:events[0]?.date,sampleEnd:events.at(-1)?.date,
      percentile:percentile(points.map(p=>p[1]),currentValue)};
  }
  function relationshipCSV(market,a) {
    const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const rows=[['index','metric','metric_source','metric_basis','historical_vintage','sampling','signal_date','metric_value','outcome','outcome_unit','entry_date','exit_date','entry_price','exit_price','price_return_pct','annualized_price_return_pct','realized_vol_pct','max_drawdown_pct','return_basis','currency','price_source']];
    a.events.forEach(e=>rows.push([market.symbol,a.metric.id,a.metric.source,a.metric.valuationBasis||a.metric.basis,a.metric.vintage||'published_history',a.sampling,e.date,e.value,e.outcome,a.kind==='risk'?'annualized_vol_pct':a.annual?'annualized_price_return_pct':'price_return_pct',e.entryDate,e.exitDate,e.entryPrice,e.exitPrice,e.returnPct,e.annualizedPct,e.realizedVol,e.drawdownPct,'price_index','USD',market.prices.source]));
    return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  return { shanghaiDate, observationFreshness, eligibleMetric, windowStart, quantile, percentile, summarize, downsample, segments, histogram, csv,
    priceHistory, overlay, nearestObservation, annualRows, annualCSV,
    stateBand, inBand, outcomeStats, nonOverlapping, forwardOutcome, study, studyCSV, horizons,
    regression, relationStats, disjointObservations, monthOffset, pathOutcome, relationship, relationshipCSV };
});
