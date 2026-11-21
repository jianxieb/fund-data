(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengConditionStudyModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  // Every metric is known at the signal close and uses only that close and earlier ones.
  // Forward results start from the same close, so a signal never sees its own future.
  const horizons = Object.freeze([5, 21, 63, 252]);
  const gaps = Object.freeze([5, 10, 21, 63, 126, 252]);
  const lookback = 63;
  const dayMs = 86400000;
  const tolerance = 1e-9;
  const groups = Object.freeze([
    Object.freeze(['move', '近期涨跌']), Object.freeze(['range', '距高点与低点']),
    Object.freeze(['trend', '均线位置']), Object.freeze(['rhythm', '波动与节奏'])
  ]);
  const metric = spec => Object.freeze(spec);
  const metrics = Object.freeze([
    metric({ id:'r1', group:'move', label:'当日涨跌', unit:'%', step:0.5, days:1 }),
    metric({ id:'r3', group:'move', label:'近 3 日涨跌', unit:'%', step:0.5, days:3 }),
    metric({ id:'r5', group:'move', label:'近 5 日涨跌', hint:'约1周', unit:'%', step:0.5, days:5 }),
    metric({ id:'r21', group:'move', label:'近 21 日涨跌', hint:'约1个月', unit:'%', step:1, days:21 }),
    metric({ id:'r63', group:'move', label:'近 63 日涨跌', hint:'约3个月', unit:'%', step:2, days:63 }),
    metric({ id:'r252', group:'move', label:'近 252 日涨跌', hint:'约1年', unit:'%', step:5, days:252 }),
    metric({ id:'worst21', group:'move', label:'近 21 日最差单日', hint:'含当日', unit:'%', step:0.5 }),
    metric({ id:'dd252', group:'range', label:'距 252 日最高收盘', hint:'回撤', unit:'%', step:1, min:0 }),
    metric({ id:'ddMax', group:'range', label:'距历史最高收盘', hint:'回撤', unit:'%', step:1, min:0 }),
    metric({ id:'rise252', group:'range', label:'高于 252 日最低收盘', unit:'%', step:1, min:0 }),
    metric({ id:'since252', group:'range', label:'252 日最高收盘后', hint:'已过交易日', unit:'日', step:5, min:0, max:251, integer:true }),
    metric({ id:'ma50', group:'trend', label:'收盘相对 50 日均线', unit:'%', step:1 }),
    metric({ id:'ma200', group:'trend', label:'收盘相对 200 日均线', unit:'%', step:1 }),
    metric({ id:'cross', group:'trend', label:'50 日均线相对 200 日均线', unit:'%', step:1 }),
    metric({ id:'vol21', group:'rhythm', label:'21 日年化波动率', unit:'%', step:1, min:0 }),
    metric({ id:'rsi14', group:'rhythm', label:'14 日 RSI', unit:'', step:1, min:0, max:100 }),
    metric({ id:'down', group:'rhythm', label:'连续收跌', unit:'日', step:1, min:0, integer:true }),
    metric({ id:'up', group:'rhythm', label:'连续收涨', unit:'日', step:1, min:0, integer:true })
  ]);
  const byId = Object.freeze(Object.fromEntries(metrics.map(m => [m.id, m])));
  // Market state first, then the speed of the move, then trend and volatility.
  const fitOrder = Object.freeze(['dd252', 'r21', 'r5', 'r1', 'ma200', 'vol21', 'r3', 'r63']);
  const fitDefaults = Object.freeze({ width:0.75, minEpisodes:10, tail:0.1 });

  const round = value => Number(value.toFixed(6));
  const floorStep = (value, step) => round(Math.floor(value / step + tolerance) * step);
  const ceilStep = (value, step) => round(Math.ceil(value / step - tolerance) * step);
  const twoDecimals = value => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
  // The first problem with a range, or null: each bound's own value is checked before the order of the two.
  function rangeIssue(id, range) {
    const m = byId[id];
    if (!m || !range || typeof range !== 'object') return 'metric';
    const { lo = null, hi = null } = range;
    if (lo === null && hi === null) return 'empty';
    for (const v of [lo, hi]) {
      if (v === null) continue;
      if (!Number.isFinite(v)) return 'number';
      if (Math.abs(v) > 100000) return 'size';
      if (m.integer && !Number.isInteger(v)) return 'integer';
      if (!twoDecimals(v)) return 'decimals';
    }
    return lo !== null && hi !== null && lo > hi ? 'order' : null;
  }
  const validRange = (id, range) => rangeIssue(id, range) === null;
  function parseRange(text) {
    const match = /^(-?\d+(?:\.\d+)?)?~(-?\d+(?:\.\d+)?)?$/.exec(String(text ?? ''));
    if (!match || (match[1] === undefined && match[2] === undefined)) return null;
    return { lo:match[1] === undefined ? null : Number(match[1]), hi:match[2] === undefined ? null : Number(match[2]) };
  }
  const formatRange = ({ lo = null, hi = null }) => (lo ?? '') + '~' + (hi ?? '');
  const validGap = value => gaps.includes(value);

  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  }
  // Number of sorted values below (strict) or at most (inclusive) the value.
  function rank(sorted, value, inclusive) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inclusive ? sorted[mid] <= value : sorted[mid] < value) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  function summarize(values) {
    const sorted = values.slice().sort((a, b) => a - b), n = sorted.length;
    if (!n) return { n:0, median:null, mean:null, upPct:null, min:null, max:null };
    return { n, median:quantile(sorted, .5), mean:sorted.reduce((a, b) => a + b, 0) / n,
      upPct:100 * sorted.filter(v => v > 0).length / n, min:sorted[0], max:sorted[n - 1] };
  }

  // Input: [ISO trading date, positive price-index close] pairs, strictly ascending.
  function compute(series) {
    if (!Array.isArray(series) || series.length < 2) throw new Error('指数收盘序列过短');
    const n = series.length, last = n - 1, dates = new Array(n), closes = new Float64Array(n), starts = new Int32Array(n);
    let start = 0, previous = NaN;
    for (let i = 0; i < n; i++) {
      const row = series[i], date = row?.[0], close = row?.[1];
      const stamp = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
      if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date ||
          (i && stamp <= previous) || !Number.isFinite(close) || close <= 0)
        throw new Error('指数收盘序列的日期、顺序或点位有误');
      // A known outage of more than ten calendar days starts a fresh history; windows never bridge it.
      if (i && stamp - previous > 10 * dayMs) start = i;
      dates[i] = date; closes[i] = close; starts[i] = start; previous = stamp;
    }
    const blank = () => new Float64Array(n).fill(NaN);
    const has = (i, k) => i - k >= starts[i];
    const values = {};
    for (const m of metrics) if (m.days) {
      const out = blank();
      for (let i = 1; i < n; i++) if (has(i, m.days)) out[i] = (closes[i] / closes[i - m.days] - 1) * 100;
      values[m.id] = out;
    }
    const worst = blank();
    for (let i = 1; i < n; i++) if (has(i, 21)) {
      let low = Infinity;
      for (let j = i - 20; j <= i; j++) low = Math.min(low, values.r1[j]);
      worst[i] = low;
    }
    values.worst21 = worst;
    const dd = blank(), rise = blank(), since = blank(), ddMax = blank();
    let peak = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i === starts[i]) peak = -Infinity;
      peak = Math.max(peak, closes[i]);
      if (!has(i, 251)) continue;
      // Ties keep the most recent equal high, matching the drop study's auditable reference date.
      let high = -Infinity, at = i, low = Infinity;
      for (let j = i - 251; j <= i; j++) {
        if (closes[j] >= high) { high = closes[j]; at = j; }
        low = Math.min(low, closes[j]);
      }
      dd[i] = (1 - closes[i] / high) * 100;
      rise[i] = (closes[i] / low - 1) * 100;
      since[i] = i - at;
      ddMax[i] = (1 - closes[i] / peak) * 100;
    }
    Object.assign(values, { dd252:dd, ddMax, rise252:rise, since252:since });
    // Deviations from today's close keep a flat decimal history exactly on its average.
    const offset = (i, k) => {
      let sum = 0;
      for (let j = i - k + 1; j <= i; j++) sum += closes[j] - closes[i];
      return sum / k;
    };
    const ma50 = blank(), ma200 = blank(), cross = blank();
    for (let i = 0; i < n; i++) {
      // `+ 0` turns −0 from an exactly flat history into 0.
      if (has(i, 49)) { const o = offset(i, 50); ma50[i] = -o / (closes[i] + o) * 100 + 0; }
      if (has(i, 199)) {
        const o50 = offset(i, 50), o200 = offset(i, 200);
        ma200[i] = -o200 / (closes[i] + o200) * 100 + 0;
        cross[i] = (o50 - o200) / (closes[i] + o200) * 100 + 0;
      }
    }
    Object.assign(values, { ma50, ma200, cross });
    const vol = blank();
    for (let i = 1; i < n; i++) if (has(i, 21)) {
      const logs = [];
      for (let j = i - 20; j <= i; j++) logs.push(Math.log(closes[j] / closes[j - 1]));
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
      vol[i] = Math.sqrt(logs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (logs.length - 1) * 252) * 100;
    }
    values.vol21 = vol;
    // Wilder's 14-day RSI: a simple average for the first 14 changes, then (13 × previous + today) / 14.
    const rsi = blank();
    let gain = 0, loss = 0;
    for (let i = 0; i < n; i++) {
      if (i === starts[i]) { gain = 0; loss = 0; continue; }
      const change = closes[i] - closes[i - 1], up = Math.max(change, 0), down = Math.max(-change, 0), k = i - starts[i];
      if (k <= 14) { gain += up / 14; loss += down / 14; }
      else { gain = (gain * 13 + up) / 14; loss = (loss * 13 + down) / 14; }
      if (k >= 14) rsi[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
    }
    values.rsi14 = rsi;
    // A streak that reaches back to the first close of a history has an unknown length.
    const down = blank(), up = blank();
    for (let i = 0; i < n; i++) {
      if (i === starts[i]) continue;
      down[i] = closes[i] < closes[i - 1] ? down[i - 1] + 1 : 0;
      up[i] = closes[i] > closes[i - 1] ? up[i - 1] + 1 : 0;
    }
    Object.assign(values, { down, up });

    const stats = {};
    for (const m of metrics) {
      const sorted = values[m.id].filter(Number.isFinite).sort(), first = values[m.id].findIndex(Number.isFinite);
      stats[m.id] = { n:sorted.length, sorted, first:first < 0 ? null : dates[first] };
    }
    // Forward outcomes for every close: the common baseline and the episodes share one calculation.
    const outcomes = {}, longest = horizons[horizons.length - 1], slots = new Array(longest + 1).fill(null);
    for (const h of horizons) slots[h] = outcomes[h] = { pct:blank(), drawdown:blank(), low:blank() };
    for (let i = 0; i < n; i++) {
      const base = closes[i], end = Math.min(last, i + longest);
      let top = base, bottom = base, worstDrawdown = 0;
      for (let j = i + 1; j <= end && starts[j] === starts[i]; j++) {
        const close = closes[j];
        if (close > top) top = close;
        if (close < bottom) bottom = close;
        const drawdown = (close / top - 1) * 100;
        if (drawdown < worstDrawdown) worstDrawdown = drawdown;
        const slot = slots[j - i];
        if (slot) {
          slot.pct[i] = (close / base - 1) * 100;
          slot.drawdown[i] = worstDrawdown;
          slot.low[i] = (bottom / base - 1) * 100;
        }
      }
    }
    const baseline = Object.fromEntries(horizons.map(h => {
      const pct = outcomes[h].pct.filter(Number.isFinite), drawdown = outcomes[h].drawdown.filter(Number.isFinite);
      return [h, { ...summarize(Array.from(pct)), drawdown:summarize(Array.from(drawdown)) }];
    }));
    return { dates, closes, starts, values, stats, outcomes, baseline, last, first:dates[0], asOf:dates[last] };
  }

  const inRange = (value, { lo = null, hi = null }) => Number.isFinite(value) &&
    (lo === null || value >= lo - tolerance) && (hi === null || value <= hi + tolerance);
  function ordered(conditions) {
    const entries = Object.entries(conditions || {});
    for (const [id, range] of entries) if (!validRange(id, range)) throw new Error('未知的行情条件：' + id);
    return metrics.filter(m => Object.hasOwn(conditions, m.id)).map(m => [m.id, conditions[m.id]]);
  }
  function mask(data, entries) {
    const out = new Uint8Array(data.last + 1);
    for (let i = 0; i <= data.last; i++) {
      let ok = 1;
      for (const [id, range] of entries) if (!inRange(data.values[id][i], range)) { ok = 0; break; }
      out[i] = ok;
    }
    return out;
  }
  // The first matching close opens a sample; closes inside the next `gap` sessions are absorbed.
  function space(matches, gap) {
    const out = [];
    let next = 0;
    for (let i = 0; i < matches.length; i++) if (matches[i] && i >= next) { out.push(i); next = i + gap; }
    return out;
  }
  const historical = (data, indices) => indices.filter(i => i + horizons[0] <= data.last && data.starts[i + horizons[0]] === data.starts[i]).length;
  function count(data, conditions, gap) {
    return historical(data, space(mask(data, ordered(conditions)), gap));
  }

  function suggest(data, id, { width = fitDefaults.width, tail = fitDefaults.tail } = {}) {
    const m = byId[id], s = data.stats[id], value = data.values[id]?.[data.last];
    if (!m || !Number.isFinite(value) || s.n < 50) return null;
    let scale = (quantile(s.sorted, .75) - quantile(s.sorted, .25)) / 1.349;
    if (!(scale > 0)) scale = m.step;
    let lo = floorStep(value - width * scale, m.step), hi = ceilStep(value + width * scale, m.step);
    // An unusually low or high reading keeps everything beyond it instead of a narrow two-sided band.
    if (rank(s.sorted, value, false) / s.n < tail) lo = null;
    if (rank(s.sorted, value, true) / s.n > 1 - tail) hi = null;
    if (m.min !== undefined && lo !== null && lo <= m.min) lo = null;
    if (m.max !== undefined && hi !== null && hi >= m.max) hi = null;
    if (m.integer) { if (lo !== null) lo = Math.floor(lo); if (hi !== null) hi = Math.ceil(hi); }
    return lo === null && hi === null ? null : { lo, hi };
  }
  // Greedy and deterministic: try each metric in the fixed order and keep it only while
  // enough separate historical samples remain to read a distribution.
  function fit(data, { gap = 21, minEpisodes = fitDefaults.minEpisodes, width = fitDefaults.width } = {}) {
    if (!validGap(gap)) throw new Error('未知的样本间隔');
    const conditions = {}, added = [], skipped = [];
    for (const id of fitOrder) {
      const band = suggest(data, id, { width });
      if (!band) { skipped.push({ id, episodes:null }); continue; }
      const trial = { ...conditions, [id]:band }, episodes = count(data, trial, gap);
      if (episodes >= minEpisodes) { conditions[id] = band; added.push(id); }
      else skipped.push({ id, episodes });
    }
    return { conditions, added, skipped, asOf:data.asOf, gap, minEpisodes, episodes:count(data, conditions, gap) };
  }

  function outcome(data, i, h) {
    const end = i + h;
    if (data.starts[Math.min(end, data.last)] !== data.starts[i]) return { status:'gap', date:null, close:null, pct:null, drawdown:null, low:null };
    if (end > data.last) return { status:'pending', date:null, close:null, pct:null, drawdown:null, low:null };
    const o = data.outcomes[h];
    return { status:'complete', date:data.dates[end], close:data.closes[end], pct:o.pct[i], drawdown:o.drawdown[i], low:o.low[i] };
  }
  const snapshot = (data, i) => Object.fromEntries(metrics.map(m => {
    const v = data.values[m.id][i];
    return [m.id, Number.isFinite(v) ? v : null];
  }));

  function study(data, { conditions = {}, gap = 21, width = fitDefaults.width } = {}) {
    if (!validGap(gap)) throw new Error('未知的样本间隔');
    const entries = ordered(conditions), matches = mask(data, entries), indices = space(matches, gap);
    const episodes = indices.map(i => ({ index:i, date:data.dates[i], close:data.closes[i], values:snapshot(data, i),
      outcomes:Object.fromEntries(horizons.map(h => [h, outcome(data, i, h)])) }));
    const summary = Object.fromEntries(horizons.map(h => {
      const all = episodes.map(e => e.outcomes[h]), done = all.filter(o => o.status === 'complete');
      return [h, { ...summarize(done.map(o => o.pct)), pending:all.filter(o => o.status === 'pending').length,
        gap:all.filter(o => o.status === 'gap').length, drawdown:summarize(done.map(o => o.drawdown)), low:summarize(done.map(o => o.low)) }];
    }));
    // Each preview keeps every other condition: drop an active one, or add an inactive one at its suggested range.
    const previews = {};
    for (const m of metrics) {
      if (Object.hasOwn(conditions, m.id)) {
        const rest = Object.fromEntries(entries.filter(([id]) => id !== m.id));
        previews[m.id] = { kind:'without', episodes:count(data, rest, gap) };
      } else {
        const band = suggest(data, m.id, { width });
        previews[m.id] = band ? { kind:'with', range:band, episodes:count(data, { ...conditions, [m.id]:band }, gap) } : null;
      }
    }
    const last = data.last, latest = episodes.at(-1) || null;
    const failing = entries.filter(([id, range]) => !inRange(data.values[id][last], range)).map(([id]) => id);
    const current = { index:last, date:data.dates[last], close:data.closes[last], values:snapshot(data, last),
      matches:entries.length > 0 && !failing.length, failing,
      // The latest close may be absorbed into a sample that started earlier.
      episode:latest && matches[last] && last < latest.index + gap ? latest.date : null };
    let matchingDays = 0;
    for (const v of matches) matchingDays += v;
    return { first:data.first, asOf:data.asOf, gap, conditions:Object.fromEntries(entries), episodes:episodes.reverse(), summary,
      baseline:data.baseline, previews, current, matchingDays, historical:historical(data, indices) };
  }

  // Index paths around a signal, set to 100 at its close. Paths stop at an outage or the latest close.
  function path(data, i, before = lookback, after = horizons.at(-1)) {
    const points = [];
    for (let j = Math.max(data.starts[i], i - before); j <= Math.min(data.last, i + after) && data.starts[j] === data.starts[i]; j++)
      points.push([j - i, data.closes[j] / data.closes[i] * 100]);
    return points;
  }
  function spread(data, indices, before = lookback, after = horizons.at(-1)) {
    const rows = [];
    for (let k = -before; k <= after; k++) {
      const values = [];
      for (const i of indices) {
        const j = i + k;
        if (j >= data.starts[i] && j <= data.last && data.starts[j] === data.starts[i]) values.push(data.closes[j] / data.closes[i] * 100);
      }
      values.sort((a, b) => a - b);
      if (values.length) rows.push({ k, n:values.length, p10:quantile(values, .1), q25:quantile(values, .25),
        median:quantile(values, .5), q75:quantile(values, .75), p90:quantile(values, .9) });
    }
    return rows;
  }
  function percentile(data, id, value) {
    const s = data.stats[id];
    return Number.isFinite(value) && s?.n ? 100 * rank(s.sorted, value, true) / s.n : null;
  }

  return { horizons, gaps, lookback, groups, metrics, byId, fitOrder, fitDefaults, compute, study, fit, suggest, count,
    validRange, rangeIssue, parseRange, formatRange, validGap, quantile, summarize, path, spread, percentile };
});
