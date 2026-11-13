(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./drop-window-model.js'));
  else root.ChanghengDropStudyModel = factory(root.ChanghengDropWindowModel);
})(typeof window === 'object' ? window : this, function (W) {
  'use strict';
  const horizons = Object.freeze([5, 21, 63, 252]);
  const waits = Object.freeze([2, 3, 4, 5, 10, 21, 42, 63, 126, 252]);
  const validWait = value => Number.isInteger(value) && value >= 2 && value <= 252;
  const eraRanges = Object.freeze({ exclude_dotcom: Object.freeze(['2000-01-01', '2002-12-31']) });
  const excludedDate = (date, era) => !!eraRanges[era] && date >= eraRanges[era][0] && date <= eraRanges[era][1];
  const validThreshold = value => Number.isFinite(value) && value >= 3 && value <= 10 &&
    Math.round(value * 100) / 100 === value;
  const days = 86400000;
  const byHorizon = fn => Object.fromEntries(horizons.map(h => [h, fn(h)]));
  const change = (before, after) => 100 * ((after - before) / before);
  const facetOptions = Object.freeze({
    rebound: Object.freeze(['any', 'none', 'partial', 'half', 'full']),
    repeat: Object.freeze(['any', 'first', 'repeat']),
    trend: Object.freeze(['any', 'above', 'below']),
    drawdown: Object.freeze(['any', 'near', 'pullback', 'correction', 'bear']),
    cap: Object.freeze(['any', '4', '5', '6', '7', '8', '9', '10', '12', '15']),
    peer: Object.freeze(['any', 'up', 'mild', 'moderate', 'severe']),
    vol: Object.freeze(['any', 'calm', 'active', 'high']),
    low: Object.freeze(['any', 'hold', 'break'])
  });
  const facetKeys = Object.keys(facetOptions);
  const windowKeys = ['peak','loss'];
  const matchesWindow = (windows, options, k) => options[k+'Min'] == null || W.exceeds(windows?.[k], options[k+'Min']);
  const caps = facetOptions.cap.slice(1).map(Number);
  function facetValues({ dropPct, features: { reboundPct: r, priorDrops: n, ma200Pct: m, drawdownPct: d,
    peerPct: p, volPct: v, brokeLow } }) {
    return {
      rebound: r == null ? null : r <= 0 ? 'none' : r < 50 ? 'partial' : r < 100 ? 'half' : 'full',
      repeat: n == null ? null : n === 0 ? 'first' : 'repeat',
      trend: m == null ? null : m > 0 ? 'above' : 'below',
      drawdown: d == null ? null : d < 5 ? 'near' : d < 10 ? 'pullback' : d < 20 ? 'correction' : 'bear',
      cap: snap(-dropPct, caps, 200 * Number.EPSILON),
      peer: p == null ? null : p >= 0 ? 'up' : p > -2 ? 'mild' : p > -4 ? 'moderate' : 'severe',
      vol: v == null ? null : v < 20 ? 'calm' : v < 30 ? 'active' : 'high',
      low: brokeLow == null ? null : brokeLow ? 'break' : 'hold'
    };
  }
  // An upper bound is inclusive and cumulative; other options are disjoint buckets.
  const matchesOne = (k, value, option) => k === 'cap' ? value <= Number(option) : value === option;
  const matches = (values, options, except) => facetKeys.every(k =>
    k === except || options[k] === undefined || options[k] === 'any' || matchesOne(k, values[k], options[k]));
  const matchesFilters = (e, options = {}) => !!e && !excludedDate(e.date, options.era) && matches(facetValues(e), options) &&
    windowKeys.every(k => matchesWindow(e.features.windows, options, k));
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

  // Close histories remain intact: the optional high history changes only the
  // recovery observation, never the drop trigger, return anchor or price path.
  function study(series, options = {}, peerSeries = null, highSeries = null) {
    const { threshold = 5, wait = 2, group = 'unrecovered', peakDays = 252, lossDays = 5, recovery = 'close', era = 'all' } = options;
    if (!validThreshold(threshold) || !validWait(wait) ||
        !W.validDays('peak', peakDays) || !W.validDays('loss', lossDays) ||
        windowKeys.some(k => options[k+'Min'] != null && !W.validThreshold(options[k+'Min'])) ||
        !['unrecovered', 'recovered', 'all'].includes(group) || !['close', 'high'].includes(recovery) ||
        !['all', ...Object.keys(eraRanges)].includes(era) ||
        facetKeys.some(k => options[k] !== undefined && !facetOptions[k].includes(options[k]))) throw new Error('未知的大跌统计条件');
    const last = series.length - 1;
    const windows = W.rolling(series, {peakDays, lossDays});
    const highDates = new Map();
    if (recovery === 'high' && highSeries != null) {
      if (!Array.isArray(highSeries)) throw new Error('盘中最高价历史须为逐日数据');
      let previous = '';
      for (const row of highSeries) {
        const day = row?.[0], stamp = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day) : NaN;
        if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== day || day <= previous)
          throw new Error('盘中最高价历史日期或顺序无效');
        highDates.set(day, row[1]); previous = day;
      }
    }
    const highAt = i => {
      const [day, close] = series[i], high = highDates.get(day);
      return Number.isFinite(high) && high > 0 && high + Number.EPSILON * close * 4 >= close ? high : null;
    };
    const completeHighs = (first, end) => {
      for (let j = first; j <= end; j++) if (highAt(j) === null) return false;
      return true;
    };
    const peerDates = new Map(peerSeries?.map(([date], i) => [date, i]));
    function peerChange(i) {
      const j = peerDates.get(series[i][0]);
      // Must be the same two adjacent closing dates on both indices.
      if (!(j > 0) || peerSeries[j-1][0] !== series[i-1][0]) return null;
      const prior = peerSeries[j-1][1], close = peerSeries[j][1];
      if (![prior, close].every(n => Number.isFinite(n) && n > 0)) return null;
      return snap(change(prior, close), [-4, -2], 200 * Number.EPSILON);
    }
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

    function features(i, prior, close, anchor, observations) {
      // Pre-drop context ends at T−1; the two selectable windows end at the actual drop close T.
      const available = n => i >= n && segments[i - n] === segments[i - 1];
      let reboundPct = null, priorDrops = null, ma200Pct = null, drawdownPct = null, volPct = null;
      if (anchor !== null) {
        reboundPct = snap((anchor - close) / (prior - close) * 100, [50], 200 * Number.EPSILON * prior / (prior - close));
      }
      if (available(22)) {
        priorDrops = 0;
        const logs = [];
        for (let j = i - 21; j < i; j++) {
          const prev = series[j-1][1], next = series[j][1];
          if (isDrop(prev, next, threshold)) priorDrops++;
          logs.push(Math.log(next / prev));
        }
        const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
        const variance = logs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (logs.length - 1);
        volPct = snap(Math.sqrt(variance * 252) * 100, [20, 30], 400 * Math.sqrt(252) * Number.EPSILON);
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
      return { windows: windows[i], reboundPct, priorDrops, ma200Pct, drawdownPct, volPct, peerPct: peerChange(i),
        brokeLow: anchor === null ? null : observations.some(([, v]) => v < close) };
    }
    const events = [], counts = { unrecovered: 0, recovered: 0, pending: 0, gap: 0, missingHigh: 0, total: 0 };
    const groupValues = byHorizon(() => []), allValues = byHorizon(() => []);
    const facetCounts = Object.fromEntries(facetKeys.map(k => [k,
      Object.fromEntries([...facetOptions[k], 'missing'].map(v => [v, 0]))]));
    const windowCounts = Object.fromEntries(windowKeys.map(k => [k,
      {any: 0, match: options[k+'Min'] == null ? null : 0, missing: 0}]));
    let latest = null, cohortN = 0, excludedEvents = 0;
    for (let i = 1; i <= last; i++) {
      // Comparable anchors require the basic daily-drop/observation prefix, never the optional filters.
      // These unconditional windows include events, and may overlap.
      if (i >= wait + 1 && segments[i] === segments[i - wait - 1] &&
          !excludedDate(series[i - wait][0], era) &&
          (recovery === 'close' || completeHighs(i - wait + 1, i))) {
        for (const h of horizons) {
          const end = i + h;
          if (end <= last && segments[end] === segments[i]) allValues[h].push(change(series[i][1], series[end][1]));
        }
      }
      if (segments[i] !== segments[i - 1]) continue; // Not a one-session return.
      const [priorDate, priorClose] = series[i - 1], [date, close] = series[i];
      if (!isDrop(priorClose, close, threshold)) continue;
      if (excludedDate(date, era)) { excludedEvents++; continue; }

      const observations = [], observationHighs = [], missingHighDates = [];
      let status = 'pending', recoveryDate = null, anchorDate = null, anchorClose = null;
      for (let j = i + 1; j <= Math.min(i + wait, last); j++) {
        if (segments[j] !== segments[i]) { status = 'gap'; break; }
        observations.push(series[j]);
        const observed = recovery === 'high' ? highAt(j) : series[j][1];
        if (recovery === 'high') {
          observationHighs.push([series[j][0], observed]);
          if (observed === null) missingHighDates.push(series[j][0]);
        }
        if (!recoveryDate && observed !== null && observed >= priorClose) recoveryDate = series[j][0];
        if (j === i + wait) {
          status = missingHighDates.length ? 'missingHigh' : recoveryDate ? 'recovered' : 'unrecovered';
          [anchorDate, anchorClose] = series[j];
        }
      }
      // Missing an earlier high leaves the first recovery day unknown. A later
      // observed touch must not be advertised as the first touch in that window.
      if (missingHighDates.length) recoveryDate = null;
      const outcomes = byHorizon(h => anchorDate ? outcome(i + wait, h) : empty(status));
      latest = { date, close, priorDate, priorClose, dropPct: change(priorClose, close),
        status, observations, recoveryDate, anchorDate, anchorClose, outcomes,
        ...(recovery === 'high' ? { observationHighs, missingHighDates } : {}),
        features: features(i, priorClose, close, anchorClose, observations) };
      counts[status]++; counts.total++;
      if (anchorDate && status !== 'missingHigh' && (group === 'all' || group === status)) {
        cohortN++;
        const values = facetValues(latest);
        const passesFacets = matches(values, options);
        const passesPeak = matchesWindow(windows[i], options, 'peak');
        const passesLoss = matchesWindow(windows[i], options, 'loss');
        if (passesFacets) {
          for (const k of windowKeys) {
            if (!(k === 'peak' ? passesLoss : passesPeak)) continue; // Preview this window with all other filters intact.
            const count = windowCounts[k];
            count.any++;
            if (windows[i][k] == null) count.missing++;
            else if (count.match != null && (k === 'peak' ? passesPeak : passesLoss)) count.match++;
          }
        }
        if (!passesPeak || !passesLoss) continue;
        for (const k of facetKeys) if (matches(values, options, k)) {
          const count = facetCounts[k];
          count.any++;
          if (values[k] == null) count.missing++;
          else for (const option of facetOptions[k]) if (option !== 'any' && matchesOne(k, values[k], option)) count[option]++;
        }
        if (!passesFacets) continue;
        events.push(latest);
        for (const h of horizons) if (outcomes[h].status === 'complete') groupValues[h].push(outcomes[h].pct);
      }
    }
    return { first: series[0]?.[0] ?? null, asOf: series[last]?.[0] ?? null, threshold, wait, group, recovery, era,
      latest, counts, excludedEvents, cohortN, facetCounts, windowCounts, events: events.reverse(), summary: byHorizon(h => summarize(groupValues[h])),
      baseline: byHorizon(h => summarize(allValues[h])) };
  }
  return { study, horizons, waits, validWait, validThreshold, facetOptions, matchesFilters, eraRanges };
});
