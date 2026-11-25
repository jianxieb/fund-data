(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengConditionStudyModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  // Signal-day readings use that close and earlier ones only. An optional observation period
  // follows the signal day; forward results then start from the close that ends it.
  const horizonChoices = Object.freeze([1, 2, 3, 4, 5, 10, 21, 63, 126, 252, 504]);
  const defaultHorizons = Object.freeze([5, 21, 63, 252]);
  const waits = Object.freeze([1, 2, 3, 4, 5, 10, 21, 42, 63, 126, 252]);
  const eras = Object.freeze({ all:null, exclude_dotcom:Object.freeze(['2000-01-01', '2002-12-31']) });
  const lookback = 63, chartAfter = 252, mature = 5;
  const dayMs = 86400000;
  const tolerance = 1e-9;
  const COMPLETE = 1, PENDING = 2, GAP = 3, MISSING = 4;
  const obsNames = ['', 'complete', 'pending', 'gap', 'missingHigh'];
  const groups = Object.freeze([
    Object.freeze(['move', '近期涨跌']), Object.freeze(['range', '距高点与低点']),
    Object.freeze(['trend', '均线位置']), Object.freeze(['rhythm', '波动与节奏']),
    Object.freeze(['prior', '信号前一日']), Object.freeze(['obs', '观察期'])
  ]);
  // Adjustable lookbacks: N for the extra return and drawdown windows, and the size of a "big drop".
  const params = Object.freeze({
    rNDays:Object.freeze({ min:1, max:2520, integer:true, fallback:10 }),
    ddNDays:Object.freeze({ min:2, max:2520, integer:true, fallback:63 }),
    dropsPct:Object.freeze({ min:0.01, max:99.99, integer:false, fallback:5 })
  });
  const metric = spec => Object.freeze(spec);
  const metrics = Object.freeze([
    metric({ id:'r1', group:'move', label:'当日涨跌', unit:'%', step:0.5, days:1 }),
    metric({ id:'r3', group:'move', label:'近 3 日涨跌', unit:'%', step:0.5, days:3 }),
    metric({ id:'r5', group:'move', label:'近 5 日涨跌', hint:'约1周', unit:'%', step:0.5, days:5 }),
    metric({ id:'r21', group:'move', label:'近 21 日涨跌', hint:'约1个月', unit:'%', step:1, days:21 }),
    metric({ id:'r63', group:'move', label:'近 63 日涨跌', hint:'约3个月', unit:'%', step:2, days:63 }),
    metric({ id:'r252', group:'move', label:'近 252 日涨跌', hint:'约1年', unit:'%', step:5, days:252 }),
    metric({ id:'rN', group:'move', label:'近 N 日涨跌', unit:'%', step:1, param:'rNDays' }),
    metric({ id:'worst21', group:'move', label:'近 21 日最差单日', hint:'含当日', unit:'%', step:0.5 }),
    metric({ id:'drops', group:'move', label:'近 21 日大跌天数', hint:'不含当日', unit:'天', step:1, min:0, max:21, integer:true, param:'dropsPct' }),
    metric({ id:'peer1', group:'move', label:'另一指数当日涨跌', unit:'%', step:0.5, source:'peer' }),
    metric({ id:'dd252', group:'range', label:'距 252 日最高收盘', hint:'回撤', unit:'%', step:1, min:0 }),
    metric({ id:'ddN', group:'range', label:'距近 N 日最高收盘', hint:'回撤', unit:'%', step:1, min:0, param:'ddNDays' }),
    metric({ id:'ddMax', group:'range', label:'距历史最高收盘', hint:'回撤', unit:'%', step:1, min:0 }),
    metric({ id:'rise252', group:'range', label:'高于 252 日最低收盘', unit:'%', step:1, min:0 }),
    metric({ id:'since252', group:'range', label:'252 日最高收盘后', hint:'已过交易日', unit:'日', step:5, min:0, max:251, integer:true }),
    metric({ id:'ma50', group:'trend', label:'收盘相对 50 日均线', unit:'%', step:1 }),
    metric({ id:'ma200', group:'trend', label:'收盘相对 200 日均线', unit:'%', step:1 }),
    metric({ id:'cross', group:'trend', label:'50 日均线相对 200 日均线', unit:'%', step:1 }),
    // VIX is Cboe's S&P 500 options index; it is used for both indices and matched by date only.
    metric({ id:'vix', group:'rhythm', label:'VIX 收盘', hint:'标普500期权隐含波动率', unit:'', step:1, min:0, source:'vix' }),
    metric({ id:'vix5', group:'rhythm', label:'VIX 近 5 日变化', unit:'%', step:5, source:'vix' }),
    metric({ id:'vol21', group:'rhythm', label:'21 日年化波动率', unit:'%', step:1, min:0 }),
    metric({ id:'rsi14', group:'rhythm', label:'14 日 RSI', unit:'', step:1, min:0, max:100 }),
    metric({ id:'down', group:'rhythm', label:'连续收跌', unit:'日', step:1, min:0, integer:true }),
    metric({ id:'up', group:'rhythm', label:'连续收涨', unit:'日', step:1, min:0, integer:true }),
    // The same readings as of the session before the signal day, so a large signal-day move is left out.
    metric({ id:'ma200p', group:'prior', label:'前一日相对 200 日均线', unit:'%', step:1 }),
    metric({ id:'dd252p', group:'prior', label:'前一日距 252 日最高收盘', hint:'回撤', unit:'%', step:1, min:0 }),
    metric({ id:'vol21p', group:'prior', label:'前一日 21 日年化波动率', unit:'%', step:1, min:0 }),
    // Known only once the observation period after the signal day has finished.
    metric({ id:'recov', group:'obs', label:'观察期内收复前一日收盘', choice:true, source:'obs' }),
    metric({ id:'broke', group:'obs', label:'观察期内跌破信号日收盘', choice:true, source:'obs' }),
    metric({ id:'rebound', group:'obs', label:'期末收回比例', hint:'收回信号日跌幅', unit:'%', step:10, source:'obs' }),
    metric({ id:'obsMove', group:'obs', label:'观察期涨跌', hint:'期末相对信号日收盘', unit:'%', step:1, source:'obs' })
  ]);
  const byId = Object.freeze(Object.fromEntries(metrics.map(m => [m.id, m])));
  const dynamicIds = Object.freeze(['rN', 'ddN', 'drops', 'peer1', 'recov', 'broke', 'rebound', 'obsMove']);
  // Market state first, then the speed of the move, then trend and volatility.
  const fitOrder = Object.freeze(['dd252', 'r21', 'r5', 'r1', 'ma200', 'vix', 'vol21', 'r3', 'r63']);
  const fitDefaults = Object.freeze({ width:0.75, minEpisodes:10, tail:0.1 });
  // The best combo searches every reading the reference close has, except the observation-period ones, which are known only
  // after the close. The three rows with a lookback of their own are searched at every lookback in `all`; a set holds at most
  // one lookback of each row, as the page does, and pairs use the lookbacks in `pairs`. Lookbacks a fixed row already shows
  // (近 21 日 is N = 21, 距 252 日最高收盘 is N = 252) are left out.
  const bestIds = Object.freeze(metrics.filter(m => !m.param && m.group !== 'obs').map(m => m.id));
  const span = (from, to, by = 1) => Array.from({ length:Math.round((to - from) / by) + 1 }, (_, i) => Number((from + i * by).toFixed(6)));
  const bestLookbacks = Object.freeze({
    rN:Object.freeze({ param:'rNDays', all:Object.freeze([...span(1, 252), 315, 378, 441, 504].filter(d => ![1, 3, 5, 21, 63, 252].includes(d))),
      pairs:Object.freeze([2, 4, 6, 7, 8, 10, 12, 15, 17, 25, 30, 35, 42, 50, 84, 105, 126, 168, 189, 210]) }),
    ddN:Object.freeze({ param:'ddNDays', all:Object.freeze([...span(2, 251), 315, 378, 441, 504]),
      pairs:Object.freeze([3, 5, 7, 10, 15, 21, 30, 42, 63, 84, 126, 189]) }),
    drops:Object.freeze({ param:'dropsPct', all:Object.freeze(span(0.5, 10, 0.5)), pairs:Object.freeze([1, 2, 3, 4, 5]) })
  });
  // Thresholds around the reference reading `v`, rounded outward to the reading's step: `steps` whole steps away (fixed
  // intervals), `v × (1 ± k)` for each `scale` k (proportional) and `share` of the history away (distribution), plus 0 where
  // readings change sign. A range runs from any low threshold (or none) to any high one (or none) and keeps at most `cover`
  // of the history.
  const bestThresholds = Object.freeze({ steps:Object.freeze([1, 2, 3, 4, 6, 8, 12, 16, 24, 32]), scale:Object.freeze([0.25, 0.5, 1, 2]),
    share:Object.freeze([0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5]), cover:0.85 });
  // `minApart`: samples whose result periods do not overlap. `gain`: what each further range must add over the set without it.
  // Sets of three or more grow from the `width` best sets one range smaller, up to `items` ranges; the `refine` leading sets
  // are then tried at every lookback. The ranking bound's z follows the number of sets compared (`bestZ`); `checkZ` judges
  // the one set the check picked, on data the pick never saw.
  const bestDefaults = Object.freeze({ horizon:21, minSamples:20, minApart:20, gain:0.02, width:40, items:6, refine:12, checkZ:1.96 });

  const round = value => Number(value.toFixed(6));
  const floorStep = (value, step) => round(Math.floor(value / step + tolerance) * step);
  const ceilStep = (value, step) => round(Math.ceil(value / step - tolerance) * step);
  const twoDecimals = value => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
  const validParam = (key, value) => {
    const p = params[key];
    return !!p && Number.isFinite(value) && value >= p.min && value <= p.max && (p.integer ? Number.isInteger(value) : twoDecimals(value));
  };
  const validWait = value => Number.isInteger(value) && value >= 0 && value <= 252;
  const validEra = value => Object.hasOwn(eras, value);
  // The first problem with a range, or null: each bound's own value is checked before the order of the two.
  function rangeIssue(id, range) {
    const m = byId[id];
    if (!m || !range || typeof range !== 'object') return 'metric';
    const { lo = null, hi = null } = range;
    if (lo === null && hi === null) return 'empty';
    if (m.choice) return lo === hi && (lo === 0 || lo === 1) ? null : 'choice';
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

  const isoDay = date => {
    const stamp = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? stamp : NaN;
  };
  // [ISO date, value] pairs, strictly ascending; anything else is refused rather than guessed.
  function byDate(rows, message) {
    if (!Array.isArray(rows)) throw new Error(message);
    const out = new Map();
    let previous = '';
    for (const row of rows) {
      const [date] = Array.isArray(row) ? row : [];
      if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(isoDay(date)) || date <= previous) throw new Error(message);
      out.set(date, row[1]);
      previous = date;
    }
    return out;
  }
  // Optional VIX closes; days off the index calendar are ignored.
  function vixByDate(vix) {
    const out = byDate(vix, 'VIX 日线的日期、顺序或读数有误');
    for (const close of out.values()) if (!Number.isFinite(close) || close <= 0) throw new Error('VIX 日线的日期、顺序或读数有误');
    if (out.size < 2) throw new Error('VIX 日线过短');
    return out;
  }
  const blank = n => new Float64Array(n).fill(NaN);
  function statsOf(dates, values) {
    const sorted = values.filter(Number.isFinite).sort(), first = values.findIndex(Number.isFinite);
    return { n:sorted.length, sorted, first:first < 0 ? null : dates[first] };
  }
  // A one-session fall strictly beyond the threshold, at full price precision.
  function isDrop(prior, close, threshold) {
    const boundary = prior * (100 - threshold) / 100;
    return boundary - close > Number.EPSILON * prior * 2;
  }

  // Input: [ISO trading date, positive price-index close] pairs, strictly ascending.
  function compute(series, { vix = null } = {}) {
    if (!Array.isArray(series) || series.length < 2) throw new Error('指数收盘序列过短');
    const n = series.length, last = n - 1, dates = new Array(n), closes = new Float64Array(n), starts = new Int32Array(n);
    let start = 0, previous = NaN;
    for (let i = 0; i < n; i++) {
      const row = series[i], date = row?.[0], close = row?.[1], stamp = isoDay(date);
      if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(stamp) || (i && stamp <= previous) || !Number.isFinite(close) || close <= 0)
        throw new Error('指数收盘序列的日期、顺序或点位有误');
      // A known outage of more than ten calendar days starts a fresh history; windows never bridge it.
      if (i && stamp - previous > 10 * dayMs) start = i;
      dates[i] = date; closes[i] = close; starts[i] = start; previous = stamp;
    }
    const has = (i, k) => i - k >= starts[i];
    const values = {};
    for (const m of metrics) if (m.days) {
      const out = blank(n);
      for (let i = 1; i < n; i++) if (has(i, m.days)) out[i] = (closes[i] / closes[i - m.days] - 1) * 100;
      values[m.id] = out;
    }
    const worst = blank(n);
    for (let i = 1; i < n; i++) if (has(i, 21)) {
      let low = Infinity;
      for (let j = i - 20; j <= i; j++) low = Math.min(low, values.r1[j]);
      worst[i] = low;
    }
    values.worst21 = worst;
    const dd = blank(n), rise = blank(n), since = blank(n), ddMax = blank(n);
    let peak = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i === starts[i]) peak = -Infinity;
      peak = Math.max(peak, closes[i]);
      if (!has(i, 251)) continue;
      // Ties keep the most recent equal high.
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
    const ma50 = blank(n), ma200 = blank(n), cross = blank(n);
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
    const vol = blank(n);
    for (let i = 1; i < n; i++) if (has(i, 21)) {
      const logs = [];
      for (let j = i - 20; j <= i; j++) logs.push(Math.log(closes[j] / closes[j - 1]));
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
      vol[i] = Math.sqrt(logs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (logs.length - 1) * 252) * 100;
    }
    values.vol21 = vol;
    // Wilder's 14-day RSI: a simple average for the first 14 changes, then (13 × previous + today) / 14.
    const rsi = blank(n);
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
    const down = blank(n), up = blank(n);
    for (let i = 0; i < n; i++) {
      if (i === starts[i]) continue;
      down[i] = closes[i] < closes[i - 1] ? down[i - 1] + 1 : 0;
      up[i] = closes[i] > closes[i - 1] ? up[i - 1] + 1 : 0;
    }
    Object.assign(values, { down, up });
    // The prior session's own reading, never one from across an outage.
    const prior = source => {
      const out = blank(n);
      for (let i = 1; i < n; i++) if (has(i, 1)) out[i] = source[i - 1];
      return out;
    };
    Object.assign(values, { ma200p:prior(ma200), dd252p:prior(dd), vol21p:prior(vol) });
    // A VIX reading exists only for a session with its own Cboe close on that date; nothing is carried forward.
    const vixClose = blank(n), vixChange = blank(n), vixDates = vix ? vixByDate(vix) : null;
    if (vixDates) {
      for (let i = 0; i < n; i++) if (vixDates.has(dates[i])) vixClose[i] = vixDates.get(dates[i]);
      for (let i = 0; i < n; i++) if (has(i, 5) && Number.isFinite(vixClose[i]) && Number.isFinite(vixClose[i - 5]))
        vixChange[i] = (vixClose[i] / vixClose[i - 5] - 1) * 100;
    }
    Object.assign(values, { vix:vixClose, vix5:vixChange });
    const vixKeys = vixDates ? [...vixDates.keys()] : [];
    const vixInfo = vixDates ? { first:vixKeys[0], asOf:vixKeys[vixKeys.length - 1],
      missing:dates.filter((d, i) => d >= vixKeys[0] && d <= vixKeys[vixKeys.length - 1] && !Number.isFinite(vixClose[i])) } : null;

    const stats = {};
    for (const m of metrics) if (values[m.id]) stats[m.id] = statsOf(dates, values[m.id]);
    // Forward outcomes from every close: the baseline and the samples share one calculation.
    const outcomes = {}, longest = horizonChoices[horizonChoices.length - 1], slots = new Array(longest + 1).fill(null);
    for (const h of horizonChoices) slots[h] = outcomes[h] = { pct:blank(n), drawdown:blank(n), low:blank(n) };
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
    return { framed:false, n, dates, closes, starts, values, stats, outcomes, last, first:dates[0], asOf:dates[last], vix:vixInfo };
  }

  function returnOver({ n, closes, starts }, days) {
    const out = blank(n);
    for (let i = 0; i < n; i++) if (i - days >= starts[i]) out[i] = (closes[i] / closes[i - days] - 1) * 100;
    return out;
  }
  // The highest close among the latest `days` closes, today included; a descending deque keeps it O(n).
  function drawdownOver({ n, closes, starts }, days) {
    const out = blank(n), queue = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) {
      if (i === starts[i]) head = tail = 0;
      const first = i - days + 1;
      while (head < tail && queue[head] < first) head++;
      while (head < tail && closes[queue[tail - 1]] <= closes[i]) tail--;
      queue[tail++] = i;
      if (first >= starts[i]) out[i] = (1 - closes[i] / closes[queue[head]]) * 100;
    }
    return out;
  }
  // One-session falls strictly beyond `pct` among the 21 sessions before the signal day.
  function dropCount({ n, closes, starts }, pct) {
    const out = blank(n);
    for (let i = 0; i < n; i++) {
      if (i - 22 < starts[i]) continue;
      let count = 0;
      for (let j = i - 21; j < i; j++) if (isDrop(closes[j - 1], closes[j], pct)) count++;
      out[i] = count;
    }
    return out;
  }
  // The other index over the same two adjacent closing dates; anything else stays unknown.
  function peerMove({ n, dates, starts }, peer) {
    const index = new Map([...byDate(peer, '对照指数日线的日期或顺序无效').keys()].map((date, j) => [date, j]));
    const out = blank(n);
    for (let i = 1; i < n; i++) {
      if (i - 1 < starts[i]) continue;
      const j = index.get(dates[i]);
      if (!(j > 0) || peer[j - 1][0] !== dates[i - 1]) continue;
      const before = peer[j - 1][1], after = peer[j][1];
      if (Number.isFinite(before) && before > 0 && Number.isFinite(after) && after > 0) out[i] = (after / before - 1) * 100;
    }
    return out;
  }
  // A daily high must be a positive number at or above that day's close; otherwise it is missing.
  function alignHighs({ n, dates, closes }, highs) {
    const out = blank(n);
    if (highs == null) return out;
    const map = byDate(highs, '盘中最高价历史日期或顺序无效');
    for (let i = 0; i < n; i++) {
      const high = map.get(dates[i]), close = closes[i];
      if (Number.isFinite(high) && high > 0 && high + Number.EPSILON * close * 4 >= close) out[i] = high;
    }
    return out;
  }
  // Every close may be a signal day. Its observation covers the next `wait` sessions, all inside one history.
  function observe(data, wait, basis, highs) {
    const { n, last, closes, starts } = data, high = basis === 'high' ? alignHighs(data, highs) : null;
    const status = new Uint8Array(n), touch = new Int32Array(n).fill(-1), missing = new Uint8Array(n);
    const recov = blank(n), broke = blank(n), rebound = blank(n), obsMove = blank(n);
    for (let i = 0; i < n; i++) {
      const end = i + wait, stop = Math.min(end, last);
      status[i] = starts[stop] !== starts[i] ? GAP : end > last ? PENDING : COMPLETE;
      if (status[i] !== COMPLETE) continue;
      const signal = closes[i], prior = i - 1 >= starts[i] ? closes[i - 1] : NaN;
      let first = -1, unknown = 0, below = 0;
      for (let k = i + 1; k <= end; k++) {
        const seen = high ? high[k] : closes[k];
        if (!Number.isFinite(seen)) unknown = 1;
        else if (first < 0 && seen >= prior) first = k;
        if (closes[k] < signal) below = 1;
      }
      missing[i] = unknown;
      // Judging recovery by highs needs every high in the period; such a close cannot become a sample.
      if (unknown) status[i] = MISSING;
      broke[i] = below;
      obsMove[i] = (closes[end] / signal - 1) * 100;
      if (!Number.isFinite(prior)) continue;
      if (!unknown) { recov[i] = first >= 0 ? 1 : 0; touch[i] = first; }
      if (prior > signal) rebound[i] = (closes[end] - signal) / (prior - signal) * 100;
    }
    return { wait, basis, high, status, touch, missing, recov, broke, rebound, obsMove };
  }

  // Settings that change readings, not conditions: lookbacks, observation period and its recovery basis,
  // and the optional peer and high histories. Studies and fits take the frame this returns.
  function frame(data, { params:given = {}, wait = 0, basis = 'close', peer = null, highs = null } = {}) {
    if (data?.framed) data = data.data;
    const p = {};
    for (const [key, spec] of Object.entries(params)) {
      const v = given[key] ?? spec.fallback;
      if (!validParam(key, v)) throw new Error('回看参数超出范围：' + key);
      p[key] = v;
    }
    if (!validWait(wait)) throw new Error('观察期须为 0–252 个交易日');
    if (basis !== 'close' && basis !== 'high') throw new Error('未知的收复判定');
    const values = { ...data.values, rN:returnOver(data, p.rNDays), ddN:drawdownOver(data, p.ddNDays), drops:dropCount(data, p.dropsPct),
      peer1:peer ? peerMove(data, peer) : blank(data.n) };
    const obs = wait > 0 ? observe(data, wait, basis, highs) : null;
    for (const id of ['recov', 'broke', 'rebound', 'obsMove']) values[id] = obs ? obs[id] : blank(data.n);
    const stats = { ...data.stats };
    for (const id of dynamicIds) stats[id] = statsOf(data.dates, values[id]);
    return { ...data, framed:true, data, values, stats, params:p, wait, basis, obs, peer:!!peer, cache:new Map() };
  }
  const framed = data => data?.framed ? data : frame(data);

  const inRange = (value, { lo = null, hi = null }) => Number.isFinite(value) &&
    (lo === null || value >= lo - tolerance) && (hi === null || value <= hi + tolerance);
  function ordered(view, conditions) {
    const entries = Object.entries(conditions || {});
    for (const [id, range] of entries) {
      if (!validRange(id, range)) throw new Error('未知的行情条件：' + id);
      if (byId[id].source === 'obs' && !view.obs) throw new Error('先设置观察期，才能按观察期条件筛选');
    }
    return metrics.filter(m => Object.hasOwn(conditions, m.id)).map(m => [m.id, conditions[m.id]]);
  }
  const excluded = (era, date) => !!eras[era] && date >= eras[era][0] && date <= eras[era][1];
  // A close qualifies when it meets every condition, sits outside an excluded era and, with an
  // observation period, has finished that period inside the same history.
  function mask(view, entries, era) {
    const out = new Uint8Array(view.n), obs = view.obs;
    for (let i = 0; i < view.n; i++) {
      if (excluded(era, view.dates[i]) || (obs && obs.status[i] !== COMPLETE)) continue;
      let ok = 1;
      for (const [id, range] of entries) if (!inRange(view.values[id][i], range)) { ok = 0; break; }
      out[i] = ok;
    }
    return out;
  }
  // Every matching close is a sample of its own.
  function matching(matches) {
    const out = [];
    for (let i = 0; i < matches.length; i++) if (matches[i]) out.push(i);
    return out;
  }
  // Historical: at least `mature` sessions of results after the anchor, inside the same history. Only these
  // count as samples; a newer one, such as a latest close that has just matched, has nothing to show yet.
  const historical = (view, i) => {
    const end = i + view.wait + mature;
    return end <= view.last && view.starts[end] === view.starts[i];
  };
  function checkStudy(era) {
    if (!validEra(era)) throw new Error('未知的历史范围');
  }
  function count(data, conditions, era = 'all') {
    const view = framed(data);
    checkStudy(era);
    return matching(mask(view, ordered(view, conditions), era)).filter(i => historical(view, i)).length;
  }
  const refOf = (view, ref) => {
    if (ref === undefined || ref === null) return view.last;
    if (!Number.isInteger(ref) || ref < 0 || ref > view.last) throw new Error('参照日不在行情范围内');
    return ref;
  };

  function suggest(data, id, { ref, width = fitDefaults.width, tail = fitDefaults.tail } = {}) {
    const view = framed(data), m = byId[id], s = view.stats[id], value = view.values[id]?.[refOf(view, ref)];
    if (!m || !Number.isFinite(value)) return null;
    if (m.choice) return { lo:value, hi:value };
    if (s.n < 50) return null;
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
  // Greedy and deterministic: try each metric in the fixed order around the reference close and keep
  // it only while enough separate historical samples remain to read a distribution.
  function fit(data, { era = 'all', ref, minEpisodes = fitDefaults.minEpisodes, width = fitDefaults.width } = {}) {
    const view = framed(data), at = refOf(view, ref);
    checkStudy(era);
    const conditions = {}, added = [], skipped = [], steps = [];
    for (const id of fitOrder) {
      const band = suggest(view, id, { ref:at, width });
      if (!band) { skipped.push({ id, episodes:null }); steps.push({ id, band:null, episodes:null, kept:false }); continue; }
      const trial = { ...conditions, [id]:band }, episodes = count(view, trial, era), kept = episodes >= minEpisodes;
      if (kept) { conditions[id] = band; added.push(id); }
      else skipped.push({ id, episodes });
      steps.push({ id, band, episodes, kept });
    }
    return { conditions, added, skipped, steps, ref:at, date:view.dates[at], asOf:view.asOf, era, minEpisodes,
      episodes:count(view, conditions, era) };
  }

  // The lower end of the Wilson score interval for a share `p` of `n` samples: small samples rank below large ones.
  function wilsonShare(p, n, z = 1.96) {
    if (!n) return 0;
    const z2 = z * z;
    return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  }
  // z with a share `q` of the normal distribution above it (Acklam's approximation, relative error about 1e-9).
  function upperZ(q) {
    const t = Math.min(q, 1 - q);
    let x;
    if (t < 0.02425) {
      const u = Math.sqrt(-2 * Math.log(t));
      x = (((((-7.784894002430293e-03 * u - 3.223964580411365e-01) * u - 2.400758277161838e+00) * u - 2.549732539343734e+00) * u +
        4.374664141464968e+00) * u + 2.938163982698783e+00) /
        ((((7.784695709041462e-03 * u + 3.224671290700398e-01) * u + 2.445134137142996e+00) * u + 3.754408661907416e+00) * u + 1);
    } else {
      const u = t - 0.5, r = u * u;
      x = (((((-3.969683028665376e+01 * r + 2.209460984245205e+02) * r - 2.759285104469687e+02) * r + 1.383577518672690e+02) * r -
        3.066479806614716e+01) * r + 2.506628277459239e+00) * u /
        (((((-5.447609879822406e+01 * r + 1.615858368580409e+02) * r - 1.556989798598866e+02) * r + 6.680131188771972e+01) * r -
        1.328068155288572e+01) * r + 1);
    }
    return q < 0.5 ? -x : x;
  }
  // The ranking bound for `sets` compared at once: a two-sided 0.05 / sets for each (Bonferroni), so every bound holds at once.
  const bestZ = sets => upperZ(0.025 / Math.max(1, sets));
  const lookbackStep = days => days <= 5 ? 0.5 : days <= 21 ? 1 : days <= 63 ? 2 : 5;
  // A row at one lookback, with its sorted copy, kept with the closes so every frame and reference date reuses it.
  const lookbackCache = new WeakMap();
  function lookbackValues(base, id, value) {
    let cache = lookbackCache.get(base);
    if (!cache) lookbackCache.set(base, cache = new Map());
    const key = id + ':' + value;
    let slot = cache.get(key);
    if (!slot) {
      const values = id === 'rN' ? returnOver(base, value) : id === 'ddN' ? drawdownOver(base, value) : dropCount(base, value);
      cache.set(key, slot = { values, sorted:values.filter(Number.isFinite).sort() });
    }
    return slot;
  }
  // One reading at the reference close: thresholds below its value `v` (nearest first) and above it, each close's bin between
  // them (0 below the farthest low threshold, `mid` from the nearest low to the nearest high, `size - 1` above the farthest
  // high, 255 unknown) and every range of bins `a`–`b` around `mid` that keeps at most `cover` of the history.
  function bestReading(id, lookback, values, sorted, at, order) {
    const m = byId[id], v = values[at], N = sorted.length;
    if (!Number.isFinite(v) || N < 50) return null;
    const step = id === 'rN' ? lookbackStep(lookback) : m.step, below = new Set(), above = new Set();
    const low = t => {
      t = (m.integer ? Math.floor(t + tolerance) : round(t)) + 0;
      if (t <= v + tolerance && t > sorted[0] + tolerance && !(m.min !== undefined && t <= m.min + tolerance)) below.add(t);
    };
    const high = t => {
      t = (m.integer ? Math.ceil(t - tolerance) : round(t)) + 0;
      if (t >= v - tolerance && t < sorted[N - 1] - tolerance && !(m.max !== undefined && t >= m.max - tolerance)) above.add(t);
    };
    const f = floorStep(v, step), c = ceilStep(v, step);
    for (const j of bestThresholds.steps) { low(f - (j - 1) * step); high(c + (j - 1) * step); }
    if (Math.abs(v) >= step) for (const k of bestThresholds.scale) {
      const x = v * (1 - k), y = v * (1 + k);
      low(floorStep(Math.min(x, y), step));
      high(ceilStep(Math.max(x, y), step));
    }
    const under = rank(sorted, v, false) / N, upTo = rank(sorted, v, true) / N;
    for (const d of bestThresholds.share) {
      if (under - d > 0) low(floorStep(quantile(sorted, under - d), step));
      if (upTo + d < 1) high(ceilStep(quantile(sorted, upTo + d), step));
    }
    if (sorted[0] < 0 && sorted[N - 1] > 0) (v >= 0 ? low : high)(0);
    const lows = [...below].sort((x, y) => y - x), highs = [...above].sort((x, y) => x - y), mid = lows.length, size = mid + highs.length + 1;
    const bin = new Uint8Array(values.length).fill(255), held = new Int32Array(size + 1);
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (!Number.isFinite(x)) continue;
      let b = mid;
      if (mid && x < lows[0] - tolerance) { let k = 1; while (k < mid && x < lows[k] - tolerance) k++; b = mid - k; }
      else if (highs.length && x > highs[0] + tolerance) { let k = 1; while (k < highs.length && x > highs[k] + tolerance) k++; b = mid + k; }
      bin[i] = b;
      held[b + 1]++;
    }
    for (let b = 0; b < size; b++) held[b + 1] += held[b];
    const ranges = [];
    for (let a = mid; a >= 0; a--) for (let b = mid; b < size; b++) {
      if ((a === 0 && b === size - 1) || held[b + 1] - held[a] > bestThresholds.cover * N + tolerance) continue;
      ranges.push({ a, b, lo:a ? lows[mid - a] : null, hi:b < size - 1 ? highs[b - mid] : null });
    }
    if (!ranges.length) return null;
    return { key:lookback === null ? id : id + ':' + lookback, id, param:lookback === null ? null : m.param, lookback, order, v, step,
      lows, highs, mid, size, bin, ranges, P:null, pool:false };
  }
  // The closes of each bin and below as bits, 32 closes to a word, one row of `W` words per bin.
  function bitsFor(r, W) {
    if (r.P) return r.P;
    const P = new Uint32Array(r.size * W), bin = r.bin;
    for (let i = 0; i < bin.length; i++) if (bin[i] !== 255) P[bin[i] * W + (i >>> 5)] |= 1 << (i & 31);
    for (let b = 1; b < r.size; b++) for (let w = 0; w < W; w++) P[b * W + w] |= P[(b - 1) * W + w];
    return r.P = P;
  }
  // How many counted closes in bins `a`–`b` of a reading (its rows `P`), and in bins `c`–`d` of a second one (`Q`) if given,
  // remain when each has to start at least `h` sessions after the one before.
  function spacedRanges(W, count, h, P, a, b, Q, c, d) {
    const pt = b * W, pu = (a - 1) * W, qt = d * W, qu = (c - 1) * W;
    let apart = 0, next = 0;
    for (let w = 0; w < W;) {
      const at = next >>> 5;
      if (at > w) { w = at; continue; }
      let x = P[pt + w] & count[w];
      if (a) x &= ~P[pu + w];
      if (Q) { x &= Q[qt + w]; if (c) x &= ~Q[qu + w]; }
      if (at === w && (next & 31)) x &= -1 << (next & 31);
      if (!x) { w++; continue; }
      apart++;
      next = (w << 5 | 31 - Math.clz32(x & -x)) + h;
    }
    return apart;
  }
  // The readings of a reference close, built once per frame and date (the last three are kept) and shared by every horizon,
  // history range and the check. `rows` limits them to some readings ('r1', 'rN:10'), so a test can check every set by hand.
  // Built one reading at a time: each step yields `building` (nothing compared yet), so a page running it in short slices
  // stays responsive while the lookback rows are computed.
  const building = Object.freeze({ done:0, total:0 });
  const drive = run => { let step; do step = run.next(); while (!step.done); return step.value; };
  function* bestContext(view, at, rows = null) {
    const id = rows ? at + '|' + rows.join(',') : at;
    let slots = view.cache.get('best');
    if (!slots) view.cache.set('best', slots = new Map());
    if (slots.has(id)) {
      const kept = slots.get(id);
      slots.delete(id);
      slots.set(id, kept);
      return kept;
    }
    const readings = [], family = { rN:[], ddN:[], drops:[] }, wanted = key => !rows || rows.includes(key);
    for (const [k, m] of metrics.entries()) {
      if (m.group === 'obs') continue;
      if (!m.param) {
        if (!wanted(m.id)) continue;
        const r = bestReading(m.id, null, view.values[m.id], view.stats[m.id].sorted, at, k * 1000);
        if (r) { r.pool = true; readings.push(r); }
        yield building;
        continue;
      }
      const spec = bestLookbacks[m.id], grid = new Set(spec.pairs);
      for (const [j, lookback] of spec.all.entries()) {
        if (!wanted(m.id + ':' + lookback)) continue;
        const { values, sorted } = lookbackValues(view.data, m.id, lookback);
        const r = bestReading(m.id, lookback, values, sorted, at, k * 1000 + j);
        if (r) { r.pool = grid.has(lookback); readings.push(r); family[m.id].push(r); }
        yield building;
      }
    }
    const pool = readings.filter(r => r.pool), sum = list => list.reduce((s, r) => s + r.ranges.length, 0);
    let pairs = 0;
    for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) if (pool[x].id !== pool[y].id) pairs += pool[x].ranges.length * pool[y].ranges.length;
    const ctx = { W:Math.ceil(view.n / 32), readings, pool, family, singles:sum(readings), pairs, poolRanges:sum(pool),
      familyRanges:{ rN:sum(family.rN), ddN:sum(family.ddN), drops:sum(family.drops) } };
    slots.set(id, ctx);
    if (slots.size > 3) slots.delete(slots.keys().next().value);
    return ctx;
  }
  // How many sets a search compares: every range alone, every pair of the paired lookbacks, and at most `width` sets per size
  // grown by every paired range, plus two rounds of the `refine` leading sets at every lookback.
  function bestPlan(ctx, { width, items, refine }) {
    const more = Math.max(0, items - 2) * width * ctx.poolRanges + 2 * refine * (ctx.familyRanges.rN + ctx.familyRanges.ddN + ctx.familyRanges.drops);
    return { singles:ctx.singles, pairs:ctx.pairs, more, total:ctx.singles + ctx.pairs + more };
  }
  // The signal days `keep` lets through whose result counts: as bits, as a list in order, and the way each moved.
  function bestMarks(view, era, h, keep) {
    const W = Math.ceil(view.n / 32), pct = view.outcomes[h].pct, wait = view.wait, count = new Uint32Array(W), list = [], way = [];
    for (let i = 0; i < view.n; i++) {
      if (excluded(era, view.dates[i]) || (view.obs && view.obs.status[i] !== COMPLETE) || !historical(view, i) || !keep(i)) continue;
      const p = pct[i + wait];
      if (!Number.isFinite(p)) continue;
      count[i >>> 5] |= 1 << (i & 31);
      list.push(i);
      way.push(p > 0 ? 1 : p < 0 ? -1 : 0);
    }
    return { W, count, days:Int32Array.from(list), dirs:Int8Array.from(way) };
  }
  // Every range alone at every lookback; every pair of ranges of two rows at the paired lookbacks; sets of three or more grown
  // one range at a time from the `width` best sets one range smaller; then the `refine` leading sets with each row that has a
  // lookback swapped for, or joined by, that row at every lookback. A set has to beat every set with one range fewer by `gain`
  // and is ranked by the Wilson lower bound of its win rate, with the samples whose result periods do not overlap as the
  // sample size. Ties go to more samples, then to fewer ranges, then to the set found first. Yields its progress.
  function* bestSearch(ctx, marks, o) {
    const { W, readings, pool } = ctx, { count, days, dirs } = marks, z2 = o.z * o.z;
    const progress = { done:0, total:o.total }, compared = { singles:0, pairs:0, more:0 };
    const score = (wins, n, apart) => wilsonShare(wins / n, apart, o.z);
    // Whether the bound of a share `p` over `s` samples is above `T`: wilsonShare turned around, without its square root.
    const clears = (p, s, T) => p > T && (p - T) * (p - T) * s > z2 * T * (1 - T);
    const keyOf = items => items.map(it => it.r.key + '#' + it.i).join('&');
    const better = (x, y) => !y || x.score > y.score + 1e-12 || (Math.abs(x.score - y.score) <= 1e-12 &&
      (x.n > y.n || (x.n === y.n && (x.items.length < y.items.length || (x.items.length === y.items.length && x.rank < y.rank)))));
    const boards = [], offered = new Set(), seen = new Set(), memo = new Map(), single = new Map();
    let top = null, rank = 0;
    function offer(items, t) {
      const key = keyOf(items);
      if (offered.has(key)) return;
      offered.add(key);
      const x = { items, key, n:t.n, up:t.up, down:t.down, apart:t.apart, score:t.score, rank:rank++ };
      if (better(x, top)) top = x;
      const list = boards[items.length] || (boards[items.length] = []);
      if (list.length >= o.width && !better(x, list[list.length - 1])) return;
      let k = list.length;
      while (k > 0 && better(x, list[k - 1])) k--;
      list.splice(k, 0, x);
      if (list.length > o.width) list.pop();
    }
    // The score a set of `size` ranges has to pass to matter: the last on its full board (the best set overall is above it).
    const floor = size => { const list = boards[size]; return list && list.length >= o.width ? list[list.length - 1].score : 0; };
    const inside = (it, d) => { const b = it.r.bin[d], g = it.r.ranges[it.i]; return b !== 255 && b >= g.a && b <= g.b; };
    // The counted closes of a set, in order, with the way each moved.
    function members(items) {
      const list = [], way = [];
      for (let k = 0; k < days.length; k++) if (items.every(it => inside(it, days[k]))) { list.push(days[k]); way.push(dirs[k]); }
      return { list, way };
    }
    // Exact counts of any set, walking its counted closes.
    function exact(items) {
      const key = keyOf(items);
      let t = memo.get(key);
      if (t) return t;
      const { list, way } = members(items);
      let up = 0, down = 0, apart = 0, next = -1;
      for (let k = 0; k < list.length; k++) {
        if (way[k] > 0) up++; else if (way[k] < 0) down++;
        if (list[k] >= next) { apart++; next = list[k] + o.h; }
      }
      const n = list.length;
      memo.set(key, t = { n, up, down, apart, score:n >= o.least && apart >= o.leastApart ? score(up >= down ? up : down, n, apart) : 0 });
      return t;
    }

    // Every range alone. A range below the sample floors leaves every set that contains it below them too.
    for (const r of readings) {
      const R = r.ranges.length, B = r.size, hn = new Int32Array(B + 1), hu = new Int32Array(B + 1), hd = new Int32Array(B + 1);
      for (let k = 0; k < days.length; k++) {
        const b = r.bin[days[k]];
        if (b === 255) continue;
        hn[b + 1]++;
        if (dirs[k] > 0) hu[b + 1]++; else if (dirs[k] < 0) hd[b + 1]++;
      }
      for (let b = 0; b < B; b++) { hn[b + 1] += hn[b]; hu[b + 1] += hu[b]; hd[b + 1] += hd[b]; }
      const s = { apart:new Int32Array(R), score:new Float64Array(R), usable:[] };
      for (let i = 0; i < R; i++) {
        const { a, b } = r.ranges[i], n = hn[b + 1] - hn[a];
        if (n < o.least) continue;
        const up = hu[b + 1] - hu[a], down = hd[b + 1] - hd[a];
        let apart = n;
        if (o.h > 1) apart = spacedRanges(W, count, o.h, bitsFor(r, W), a, b, null, 0, 0);
        if (apart < o.leastApart) continue;
        s.apart[i] = apart;
        s.score[i] = score(up >= down ? up : down, n, apart);
        s.usable.push(i);
        offer([{ r, i }], { n, up, down, apart, score:s.score[i] });
      }
      single.set(r, s);
      if (!r.pool) r.P = null;
      progress.done += R;
      compared.singles += R;
      yield progress;
    }

    // Every pair of ranges of two rows. A 2-D running count gives each pair's samples, rises and falls at once; the samples
    // that do not overlap are counted only when the most they could reach (the fewer of the two ranges' own) could still win.
    const hn2 = new Int32Array(64 * 64), hu2 = new Int32Array(64 * 64), hd2 = new Int32Array(64 * 64);
    function pairUp(X, Y, sx, sy) {
      const S = Y.size + 1, bx = X.bin, by = Y.bin;
      hn2.fill(0, 0, (X.size + 1) * S); hu2.fill(0, 0, (X.size + 1) * S); hd2.fill(0, 0, (X.size + 1) * S);
      for (let k = 0; k < days.length; k++) {
        const d = days[k], p = bx[d], q = by[d];
        if (p === 255 || q === 255) continue;
        const c = (p + 1) * S + q + 1;
        hn2[c]++;
        if (dirs[k] > 0) hu2[c]++; else if (dirs[k] < 0) hd2[c]++;
      }
      for (let a = 1; a <= X.size; a++) for (let b = 1; b < S; b++) {
        const c = a * S + b;
        hn2[c] += hn2[c - 1] + hn2[c - S] - hn2[c - S - 1];
        hu2[c] += hu2[c - 1] + hu2[c - S] - hu2[c - S - 1];
        hd2[c] += hd2[c - 1] + hd2[c - S] - hd2[c - S - 1];
      }
      let least = floor(2);
      for (const i of sx.usable) {
        const gx = X.ranges[i], r0 = gx.a * S, r1 = (gx.b + 1) * S, ax = sx.apart[i], barX = sx.score[i] + o.gain - 1e-12;
        for (const j of sy.usable) {
          const gy = Y.ranges[j], c0 = gy.a, c1 = gy.b + 1, n = hn2[r1 + c1] - hn2[r0 + c1] - hn2[r1 + c0] + hn2[r0 + c0];
          if (n < o.least) continue;
          const up = hu2[r1 + c1] - hu2[r0 + c1] - hu2[r1 + c0] + hu2[r0 + c0], down = hd2[r1 + c1] - hd2[r0 + c1] - hd2[r1 + c0] + hd2[r0 + c0];
          const wins = up >= down ? up : down, bar = Math.max(barX, sy.score[j] + o.gain - 1e-12), ay = sy.apart[j];
          if (!clears(wins / n, Math.min(n, ax, ay), Math.max(least, bar))) continue;
          let apart = n;
          if (o.h > 1) apart = spacedRanges(W, count, o.h, bitsFor(X, W), gx.a, gx.b, bitsFor(Y, W), gy.a, gy.b);
          if (apart < o.leastApart) continue;
          const sc = score(wins, n, apart);
          if (sc < bar) continue;
          offer([{ r:X, i }, { r:Y, i:j }], { n, up, down, apart, score:sc });
          least = floor(2);
        }
      }
    }
    for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) {
      const X = pool[x], Y = pool[y];
      if (X.id === Y.id) continue;
      const sx = single.get(X), sy = single.get(Y);
      if (sx.usable.length && sy.usable.length) pairUp(X, Y, sx, sy);
      progress.done += X.ranges.length * Y.ranges.length;
      compared.pairs += X.ranges.length * Y.ranges.length;
      yield progress;
    }

    // Each range of row `Y` added to the set `base`, whose counted closes are `D`: kept when it beats every set one range
    // smaller by `gain`, `base` among them.
    function extend(base, D, Y, s) {
      const B = Y.size, hn = new Int32Array(B + 1), hu = new Int32Array(B + 1), hd = new Int32Array(B + 1), bin = Y.bin, { list, way } = D;
      for (let k = 0; k < list.length; k++) {
        const b = bin[list[k]];
        if (b === 255) continue;
        hn[b + 1]++;
        if (way[k] > 0) hu[b + 1]++; else if (way[k] < 0) hd[b + 1]++;
      }
      for (let b = 0; b < B; b++) { hn[b + 1] += hn[b]; hu[b + 1] += hu[b]; hd[b + 1] += hd[b]; }
      const size = base.items.length + 1, bar = base.score + o.gain - 1e-12;
      for (const j of s.usable) {
        const g = Y.ranges[j], n = hn[g.b + 1] - hn[g.a];
        if (n < o.least) continue;
        const up = hu[g.b + 1] - hu[g.a], down = hd[g.b + 1] - hd[g.a], wins = up >= down ? up : down;
        if (!clears(wins / n, Math.min(n, base.apart, s.apart[j]), Math.max(floor(size), bar))) continue;
        const items = [...base.items, { r:Y, i:j }].sort((p, q) => p.r.order - q.r.order), key = keyOf(items);
        if (offered.has(key) || seen.has(key)) continue;
        seen.add(key);
        let apart = n;
        if (o.h > 1) {
          apart = 0;
          for (let k = 0, next = -1; k < list.length; k++) {
            const d = list[k], b = bin[d];
            if (b !== 255 && b >= g.a && b <= g.b && d >= next) { apart++; next = d + o.h; }
          }
        }
        if (apart < o.leastApart) continue;
        const sc = score(wins, n, apart);
        // Below the last on a full board a set cannot make the board or lead, so its smaller sets need no counting.
        if (sc < bar || sc < floor(size) - 1e-12) continue;
        if (items.some(it => it.r !== Y && exact(items.filter(x => x !== it)).score + o.gain - 1e-12 > sc)) continue;
        offer(items, { n, up, down, apart, score:sc });
      }
    }
    // Three ranges or more, grown from the best sets one range smaller.
    for (let size = 3; size <= o.items; size++) {
      const parents = (boards[size - 1] || []).slice();
      if (!parents.length) break;
      for (const base of parents) {
        const D = members(base.items), used = new Set(base.items.map(it => it.r.id));
        for (const Y of pool) {
          progress.done += Y.ranges.length;
          if (used.has(Y.id)) continue;
          extend(base, D, Y, single.get(Y));
          compared.more += Y.ranges.length;
          yield progress;
        }
      }
    }
    // The leading sets at every lookback: a row with a lookback is swapped for that row at each lookback, and a set without
    // the row is tried with it added.
    const tried = new Set();
    for (let pass = 0; pass < 2; pass++) {
      const before = top, leaders = boards.flatMap(list => list).sort((x, y) => better(x, y) ? -1 : better(y, x) ? 1 : 0).slice(0, o.refine);
      for (const base of leaders) for (const id of ['rN', 'ddN', 'drops']) {
        const tag = base.key + '|' + id;
        if (tried.has(tag)) continue;
        tried.add(tag);
        const k = base.items.findIndex(it => it.r.id === id), rest = k < 0 ? base.items : base.items.filter((_, q) => q !== k);
        if (!rest.length || rest.length >= o.items) { progress.done += ctx.familyRanges[id]; continue; }
        const t = exact(rest), stem = { items:rest, score:t.score, apart:t.apart }, D = members(rest);
        for (const Y of ctx.family[id]) {
          extend(stem, D, Y, single.get(Y));
          progress.done += Y.ranges.length;
          compared.more += Y.ranges.length;
          yield progress;
        }
      }
      if (top === before) break;
    }
    progress.done = progress.total;
    yield progress;
    return { top, compared };
  }
  const shareOf = (list, dir) => list.length ? 100 * list.filter(p => dir === 'up' ? p > 0 : p < 0).length / list.length : null;
  const holds = (items, d) => items.every(it => { const b = it.r.bin[d], g = it.r.ranges[it.i]; return b !== 255 && b >= g.a && b <= g.b; });
  // A set as the page shows it: its ranges, the lookbacks they use and a key that names it.
  const describe = items => ({
    key:items.map(it => it.r.key + '=' + formatRange(it.r.ranges[it.i])).join('&'),
    items:items.map(it => ({ id:it.r.id, param:it.r.param, lookback:it.r.lookback, range:{ lo:it.r.ranges[it.i].lo, hi:it.r.ranges[it.i].hi } })),
    conditions:Object.fromEntries(items.map(it => [it.r.id, { lo:it.r.ranges[it.i].lo, hi:it.r.ranges[it.i].hi }])),
    params:Object.fromEntries(items.filter(it => it.r.param).map(it => [it.r.param, it.r.lookback]))
  });
  function* bestOptions(data, { ref, horizon = bestDefaults.horizon, era = 'all', minSamples = bestDefaults.minSamples, minApart = bestDefaults.minApart,
      gain = bestDefaults.gain, width = bestDefaults.width, items = bestDefaults.items, refine = bestDefaults.refine, checkZ = bestDefaults.checkZ,
      rows = null } = {}) {
    const view = framed(data), at = refOf(view, ref);
    checkStudy(era);
    if (!horizonChoices.includes(horizon)) throw new Error('未知的后续期限');
    const ctx = yield* bestContext(view, at, rows), plan = bestPlan(ctx, { width, items, refine });
    return { view, at, h:horizon, era, minSamples, minApart, gain, width, items, refine, checkZ, ctx, plan, z:bestZ(plan.total) };
  }
  const searchOf = (o, least, leastApart) => ({ h:o.h, least, leastApart, gain:o.gain, width:o.width, items:o.items, refine:o.refine, z:o.z, total:o.plan.total });
  // The set, among those the reference close meets, whose samples most reliably moved one way after `horizon` sessions: `dir`
  // is that way (the sign of their median) and its win rate the share that moved that way. Run step by step; each step yields
  // `{ done, total }` sets compared, and the last returns the pick.
  function* bestRun(data, options = {}) {
    const o = yield* bestOptions(data, options), { view, at, h, era } = o, wait = view.wait;
    const found = yield* bestSearch(o.ctx, bestMarks(view, era, h, () => true), searchOf(o, o.minSamples, o.minApart));
    const out = { ref:at, date:view.dates[at], horizon:h, era, minSamples:o.minSamples, minApart:o.minApart, gain:o.gain, z:o.z, plan:o.plan,
      compared:found.compared, readings:o.ctx.readings.length, key:null, items:null, conditions:null, params:null, reason:null, dir:null, score:null,
      summary:null, wins:null, winPct:null, apart:null, episodes:0, baseline:baseline(view, era, [h])[h], basePct:null };
    if (!found.top) return { ...out, reason:o.ctx.readings.length ? 'samples' : 'readings' };
    const top = found.top, dir = top.up >= top.down ? 'up' : 'down', wins = dir === 'up' ? top.up : top.down, pct = view.outcomes[h].pct, samples = [];
    for (let i = 0; i < view.n; i++) {
      if (!excluded(era, view.dates[i]) && !(view.obs && view.obs.status[i] !== COMPLETE) && historical(view, i) && holds(top.items, i)) samples.push(i);
    }
    return { ...out, ...describe(top.items), dir, score:top.score, summary:summarize(samples.map(i => pct[i + wait]).filter(Number.isFinite)),
      wins, winPct:100 * wins / top.n, apart:top.apart, episodes:samples.length, basePct:shareOf(dayResults(view, era, h).pct, dir) };
  }
  // The same search on the signal days whose results had finished before the middle close, with half the sample floors; its
  // pick is counted, the way it called, on the signal days from the middle close on. `options.main` is the full pick.
  function* checkRun(data, options = {}) {
    const o = yield* bestOptions(data, options), { view, h, era } = o, wait = view.wait, split = Math.floor(view.n / 2);
    const half = [Math.ceil(o.minSamples / 2), Math.ceil(o.minApart / 2)];
    const found = yield* bestSearch(o.ctx, bestMarks(view, era, h, i => i + wait + h < split), searchOf(o, ...half));
    const check = { split:view.dates[split], key:null, items:null, conditions:null, params:null, dir:null, same:false, n:0, wins:0, apart:0,
      winPct:null, baseline:null, verdict:'none' };
    if (!found.top) return check;
    const top = found.top, dir = top.up >= top.down ? 'up' : 'down', later = bestMarks(view, era, h, i => i >= split);
    let n = 0, up = 0, down = 0, apart = 0;
    for (let k = 0, next = -1; k < later.days.length; k++) {
      const d = later.days[k];
      if (!holds(top.items, d)) continue;
      n++;
      if (later.dirs[k] > 0) up++; else if (later.dirs[k] < 0) down++;
      if (d >= next) { apart++; next = d + h; }
    }
    const wins = dir === 'up' ? up : down;
    Object.assign(check, describe(top.items), { dir, n, wins, apart, winPct:n ? 100 * wins / n : null,
      baseline:shareOf(dayResults(view, era, h, i => i >= split).pct, dir) });
    check.same = !!options.main?.key && options.main.key === check.key && options.main.dir === dir;
    // The call holds when its later win rate beats both a coin flip and how often every close of the same years moved that
    // way, clearly so when the lower bound of that rate does. One set is judged here, so the usual 95% bound applies.
    const bar = Math.max(50, check.baseline ?? 0);
    check.verdict = apart < half[1] ? 'few' : 100 * wilsonShare(wins / n, apart, o.checkZ) > bar ? 'pass' : check.winPct > bar ? 'weak' : 'fail';
    return check;
  }
  // The pick and its check in one call, run to the end.
  function best(data, options = {}) {
    const main = drive(bestRun(data, options));
    return { ...main, check:drive(checkRun(data, { ...options, main })) };
  }
  // The readings and ranges a search compares at a reference close.
  function bestReadings(data, ref, rows = null) {
    const view = framed(data), ctx = drive(bestContext(view, refOf(view, ref), rows));
    return ctx.readings.map(r => ({ id:r.id, param:r.param, lookback:r.lookback, value:r.v, step:r.step, pool:r.pool, lows:[...r.lows],
      highs:[...r.highs], ranges:r.ranges.map(g => ({ lo:g.lo, hi:g.hi })) }));
  }

  const empty = status => ({ status, date:null, close:null, pct:null, drawdown:null, low:null });
  function outcome(view, i, h) {
    if (view.obs && view.obs.status[i] !== COMPLETE) return empty(obsNames[view.obs.status[i]]);
    const anchor = i + view.wait, end = anchor + h;
    if (view.starts[Math.min(end, view.last)] !== view.starts[anchor]) return empty('gap');
    if (end > view.last) return empty('pending');
    const o = view.outcomes[h];
    return { status:'complete', date:view.dates[end], close:view.closes[end], pct:o.pct[anchor], drawdown:o.drawdown[anchor], low:o.low[anchor] };
  }
  // The lowest close from the signal day through `end`, against the signal-day close; 0 means no lower close.
  function fall(view, i, end) {
    const { closes, starts, dates, last } = view, stop = Math.min(end, last);
    let low = closes[i], at = i, j = i + 1;
    for (; j <= stop && starts[j] === starts[i]; j++) if (closes[j] < low) { low = closes[j]; at = j; }
    const reached = j - 1;
    return { status:reached === end ? 'complete' : j <= stop ? 'gap' : 'pending',
      pct:(low / closes[i] - 1) * 100, days:at - i, date:dates[at], through:dates[reached] };
  }
  const snapshot = (view, i) => Object.fromEntries(metrics.map(m => {
    const v = view.values[m.id][i];
    return [m.id, Number.isFinite(v) ? v : null];
  }));
  function observation(view, i) {
    const o = view.obs;
    if (!o) return null;
    const status = obsNames[o.status[i]];
    if (status === 'pending' || status === 'gap') return { status, waitLeft:status === 'pending' ? i + view.wait - view.last : null };
    const prior = i - 1 >= view.starts[i] ? view.closes[i - 1] : null, end = i + view.wait, days = [];
    for (let k = i + 1; k <= end; k++) days.push([view.dates[k], view.closes[k], o.high ? (Number.isFinite(o.high[k]) ? o.high[k] : null) : undefined]);
    return { status, priorDate:prior === null ? null : view.dates[i - 1], prior, days, missingHigh:o.missing[i] === 1,
      missingHighDates:o.high ? days.filter(d => d[2] === null).map(d => d[0]) : [],
      recovered:Number.isFinite(o.recov[i]) ? o.recov[i] === 1 : null, recoveryDate:o.touch[i] >= 0 ? view.dates[o.touch[i]] : null,
      broke:o.broke[i] === 1, rebound:Number.isFinite(o.rebound[i]) ? o.rebound[i] : null, move:o.obsMove[i],
      anchorDate:view.dates[end], anchorClose:view.closes[end] };
  }
  function checkHorizons(list) {
    if (!Array.isArray(list) || !list.length || list.some(h => !horizonChoices.includes(h)) || new Set(list).size !== list.length)
      throw new Error('未知的后续期限');
    return horizonChoices.filter(h => list.includes(h));
  }
  // Every close with the same observation prefix as a sample, anchored the same way: with an observation
  // period, the would-be signal day needs a prior close and a finished period. Excluded eras match by signal day.
  // Results of every trading day whose observation period has run, optionally only those whose signal day passes `keep`.
  function dayResults(view, era, h, keep = null) {
    const pct = [], drawdown = [], o = view.outcomes[h];
    for (let anchor = 0; anchor <= view.last; anchor++) {
      const i = anchor - view.wait;
      if (i < view.starts[anchor] || (view.obs && (i - 1 < view.starts[anchor] || view.obs.status[i] !== COMPLETE)) ||
          excluded(era, view.dates[i]) || !Number.isFinite(o.pct[anchor]) || (keep && !keep(i))) continue;
      pct.push(o.pct[anchor]); drawdown.push(o.drawdown[anchor]);
    }
    return { pct, drawdown };
  }
  function baseline(view, era, list) {
    const key = era + ':' + list.join(','), saved = view.cache?.get(key);
    if (saved) return saved;
    const out = {};
    for (const h of list) {
      const { pct, drawdown } = dayResults(view, era, h);
      out[h] = { ...summarize(pct), drawdown:summarize(drawdown) };
    }
    view.cache?.set(key, out);
    return out;
  }

  // `ref` is the reference close, the latest one when left out; `ref:null` studies the conditions without one.
  function study(data, { conditions = {}, era = 'all', horizons:requested = defaultHorizons, ref, width = fitDefaults.width } = {}) {
    const view = framed(data), at = ref === null ? null : refOf(view, ref), list = checkHorizons(requested);
    checkStudy(era);
    const entries = ordered(view, conditions), matches = mask(view, entries, era), indices = matching(matches), longest = list[list.length - 1];
    const segments = indices.map(i => {
      return { index:i, date:view.dates[i], close:view.closes[i], values:snapshot(view, i), observation:observation(view, i),
        outcomes:Object.fromEntries(list.map(h => [h, outcome(view, i, h)])), fall:fall(view, i, i + view.wait + longest) };
    });
    // The samples are the historical segments. `uncounted` ones (too new, or cut by an outage) stay out of every count, summary and chart.
    const episodes = segments.filter(e => historical(view, e.index)), uncounted = segments.filter(e => !historical(view, e.index));
    const summary = Object.fromEntries(list.map(h => {
      const all = episodes.map(e => e.outcomes[h]), done = all.filter(o => o.status === 'complete');
      return [h, { ...summarize(done.map(o => o.pct)), pending:all.filter(o => o.status === 'pending').length,
        gap:all.filter(o => o.status === 'gap').length, drawdown:summarize(done.map(o => o.drawdown)), low:summarize(done.map(o => o.low)) }];
    }));
    // Each preview keeps every other condition: drop an active one, add an inactive one at its suggested
    // range around the reference close (none without one), or for a yes/no reading, count both answers.
    const previews = {};
    for (const m of metrics) {
      const rest = Object.fromEntries(entries.filter(([id]) => id !== m.id)), active = Object.hasOwn(conditions, m.id);
      if (m.source === 'obs' && !view.obs) previews[m.id] = null;
      else if (m.choice) previews[m.id] = { kind:'choice', yes:count(view, { ...rest, [m.id]:{ lo:1, hi:1 } }, era),
        no:count(view, { ...rest, [m.id]:{ lo:0, hi:0 } }, era), without:active ? count(view, rest, era) : null };
      else if (active) previews[m.id] = { kind:'without', episodes:count(view, rest, era) };
      else {
        const band = at === null ? null : suggest(view, m.id, { ref:at, width });
        previews[m.id] = band ? { kind:'with', range:band, episodes:count(view, { ...conditions, [m.id]:band }, era) } : null;
      }
    }
    let reference = null;
    if (at !== null) {
      const failing = entries.filter(([id, range]) => !inRange(view.values[id][at], range)).map(([id]) => id);
      reference = { index:at, date:view.dates[at], close:view.closes[at], values:snapshot(view, at), observation:observation(view, at),
        excluded:excluded(era, view.dates[at]), matches:entries.length > 0 && matches[at] === 1, failing };
    }
    // Closes that already meet every signal-day condition but are still inside their observation period.
    let observing = null;
    const signalEntries = entries.filter(([id]) => byId[id].source !== 'obs');
    if (view.obs && signalEntries.length) {
      observing = { count:0, latest:null };
      for (let i = 0; i <= view.last; i++) if (view.obs.status[i] === PENDING && !excluded(era, view.dates[i]) &&
          signalEntries.every(([id, range]) => inRange(view.values[id][i], range))) { observing.count++; observing.latest = view.dates[i]; }
    }
    return { first:view.first, asOf:view.asOf, era, wait:view.wait, basis:view.basis, horizons:list, conditions:Object.fromEntries(entries),
      episodes:episodes.reverse(), uncounted:uncounted.reverse(), summary, baseline:baseline(view, era, list), previews, reference, observing };
  }

  // Index paths around a signal, set to 100 at its close. Paths stop at an outage or the latest close.
  function path(data, i, before = lookback, after = chartAfter) {
    const points = [];
    for (let j = Math.max(data.starts[i], i - before); j <= Math.min(data.last, i + after) && data.starts[j] === data.starts[i]; j++)
      points.push([j - i, data.closes[j] / data.closes[i] * 100]);
    return points;
  }
  function spread(data, indices, before = lookback, after = chartAfter) {
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
  // The last session on or before a calendar date; null before the first close.
  function sessionOn(data, date) {
    if (!Number.isFinite(isoDay(date))) return null;
    let lo = 0, hi = data.last + 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (data.dates[mid] <= date) lo = mid + 1; else hi = mid; }
    return lo ? lo - 1 : null;
  }

  // Settings of the former 指数大跌 page as the same study here. Its buckets become ranges on the readings
  // they were cut from; integer counts and yes/no answers stay exact.
  const legacyBuckets = Object.freeze({
    rebound:['rebound', { none:{ lo:null, hi:0 }, partial:{ lo:0, hi:50 }, half:{ lo:50, hi:100 }, full:{ lo:100, hi:null } }],
    repeat:['drops', { first:{ lo:0, hi:0 }, repeat:{ lo:1, hi:null } }],
    trend:['ma200p', { above:{ lo:0, hi:null }, below:{ lo:null, hi:0 } }],
    drawdown:['dd252p', { near:{ lo:null, hi:5 }, pullback:{ lo:5, hi:10 }, correction:{ lo:10, hi:20 }, bear:{ lo:20, hi:null } }],
    vol:['vol21p', { calm:{ lo:null, hi:20 }, active:{ lo:20, hi:30 }, high:{ lo:30, hi:null } }],
    peer:['peer1', { up:{ lo:0, hi:null }, mild:{ lo:-2, hi:0 }, moderate:{ lo:-4, hi:-2 }, severe:{ lo:null, hi:-4 } }],
    low:['broke', { hold:{ lo:0, hi:0 }, break:{ lo:1, hi:1 } }]
  });
  function fromDropStudy(query) {
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(String(query ?? '').replace(/^.*?\?/, ''));
    const num = k => q.has(k) ? Number(q.get(k)) : NaN;
    const percent = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi && twoDecimals(v);
    const pick = (k, list, fallback) => list.includes(q.get(k)) ? q.get(k) : fallback;
    const threshold = percent(num('threshold'), 3, 10) ? num('threshold') : 5;
    const waitDays = num('wait'), wait = Number.isInteger(waitDays) && waitDays >= 2 && waitDays <= 252 ? waitDays : 2;
    const group = pick('group', ['unrecovered', 'recovered', 'all'], 'unrecovered');
    const p = { rNDays:params.rNDays.fallback, ddNDays:params.ddNDays.fallback, dropsPct:threshold };
    const conditions = { r1:{ lo:null, hi:-threshold } };
    // A cap at or below the threshold matched nothing there; only a cap above it narrows the day's fall.
    const cap = Number(pick('cap', ['4', '5', '6', '7', '8', '9', '10', '12', '15'], NaN));
    if (cap > threshold) conditions.r1.lo = -cap;
    if (group !== 'all') conditions.recov = group === 'recovered' ? { lo:1, hi:1 } : { lo:0, hi:0 };
    for (const [key, [id, buckets]] of Object.entries(legacyBuckets)) {
      const bucket = q.get(key);
      if (Object.hasOwn(buckets, bucket)) conditions[id] = { ...buckets[bucket] };
    }
    // The two look-back windows applied only with a valid day count and a threshold above zero, strictly exceeded.
    // Its links left out a day count still at its default of 252 (peak) or 5 (loss).
    const windowOf = (key, minDays, fallbackDays) => {
      const days = q.has(key + 'Days') ? num(key + 'Days') : fallbackDays, min = num(key + 'Min');
      return Number.isInteger(days) && days >= minDays && days <= 2520 && percent(min, 0.01, 99.99) ? { days, min } : null;
    };
    const peak = windowOf('peak', 2, 252), loss = windowOf('loss', 1, 5);
    if (peak) { p.ddNDays = peak.days; conditions.ddN = { lo:peak.min, hi:null }; }
    if (loss) { p.rNDays = loss.days; conditions.rN = { lo:null, hi:-loss.min }; }
    return { market:pick('market', ['ndx', 'spx'], 'ndx'), wait, basis:pick('recovery', ['close', 'high'], 'close'),
      era:pick('era', ['all', 'exclude_dotcom'], 'all'), params:p, conditions };
  }

  return { horizonChoices, defaultHorizons, waits, eras, lookback, chartAfter, mature, groups, params, metrics, byId, fitOrder, fitDefaults,
    bestIds, bestLookbacks, bestThresholds, bestDefaults, compute, frame, study, fit, best, bestRun, checkRun, bestReadings, bestZ, upperZ,
    wilsonShare, suggest, count, validRange, rangeIssue, validParam,
    validWait, validEra, parseRange, formatRange, quantile, summarize, path, spread, percentile, sessionOn, isDrop, fromDropStudy };
});
