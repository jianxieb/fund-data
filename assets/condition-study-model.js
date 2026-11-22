(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengConditionStudyModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  // Signal-day readings use that close and earlier ones only. An optional observation period
  // follows the signal day; forward results then start from the close that ends it.
  const horizonChoices = Object.freeze([1, 2, 3, 4, 5, 10, 21, 63, 126, 252, 504]);
  const defaultHorizons = Object.freeze([5, 21, 63, 252]);
  const gaps = Object.freeze([1, 5, 10, 21, 63, 126, 252]);
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

  const round = value => Number(value.toFixed(6));
  const floorStep = (value, step) => round(Math.floor(value / step + tolerance) * step);
  const ceilStep = (value, step) => round(Math.ceil(value / step - tolerance) * step);
  const twoDecimals = value => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
  const validParam = (key, value) => {
    const p = params[key];
    return !!p && Number.isFinite(value) && value >= p.min && value <= p.max && (p.integer ? Number.isInteger(value) : twoDecimals(value));
  };
  const validWait = value => Number.isInteger(value) && value >= 0 && value <= 252;
  const validGap = value => gaps.includes(value);
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
  // The first matching close opens a sample; closes inside the next `gap` sessions are absorbed.
  function space(matches, gap) {
    const out = [];
    let next = 0;
    for (let i = 0; i < matches.length; i++) if (matches[i] && i >= next) { out.push(i); next = i + gap; }
    return out;
  }
  // Historical: at least `mature` sessions of results after the anchor, inside the same history.
  const historical = (view, indices) => indices.filter(i => {
    const end = i + view.wait + mature;
    return end <= view.last && view.starts[end] === view.starts[i];
  }).length;
  function checkStudy(gap, era) {
    if (!validGap(gap)) throw new Error('未知的样本间隔');
    if (!validEra(era)) throw new Error('未知的历史范围');
  }
  function count(data, conditions, gap = 21, era = 'all') {
    const view = framed(data);
    checkStudy(gap, era);
    return historical(view, space(mask(view, ordered(view, conditions), era), gap));
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
  function fit(data, { gap = 21, era = 'all', ref, minEpisodes = fitDefaults.minEpisodes, width = fitDefaults.width } = {}) {
    const view = framed(data), at = refOf(view, ref);
    checkStudy(gap, era);
    const conditions = {}, added = [], skipped = [], steps = [];
    for (const id of fitOrder) {
      const band = suggest(view, id, { ref:at, width });
      if (!band) { skipped.push({ id, episodes:null }); steps.push({ id, band:null, episodes:null, kept:false }); continue; }
      const trial = { ...conditions, [id]:band }, episodes = count(view, trial, gap, era), kept = episodes >= minEpisodes;
      if (kept) { conditions[id] = band; added.push(id); }
      else skipped.push({ id, episodes });
      steps.push({ id, band, episodes, kept });
    }
    return { conditions, added, skipped, steps, ref:at, date:view.dates[at], asOf:view.asOf, gap, era, minEpisodes,
      episodes:count(view, conditions, gap, era) };
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
  function baseline(view, era, list) {
    const key = era + ':' + list.join(','), saved = view.cache?.get(key);
    if (saved) return saved;
    const out = {};
    for (const h of list) {
      const pct = [], drawdown = [], o = view.outcomes[h];
      for (let anchor = 0; anchor <= view.last; anchor++) {
        const i = anchor - view.wait;
        if (i < view.starts[anchor] || (view.obs && (i - 1 < view.starts[anchor] || view.obs.status[i] !== COMPLETE)) ||
            excluded(era, view.dates[i]) || !Number.isFinite(o.pct[anchor])) continue;
        pct.push(o.pct[anchor]); drawdown.push(o.drawdown[anchor]);
      }
      out[h] = { ...summarize(pct), drawdown:summarize(drawdown) };
    }
    view.cache?.set(key, out);
    return out;
  }

  function study(data, { conditions = {}, gap = 21, era = 'all', horizons:requested = defaultHorizons, ref, width = fitDefaults.width } = {}) {
    const view = framed(data), at = refOf(view, ref), list = checkHorizons(requested);
    checkStudy(gap, era);
    const entries = ordered(view, conditions), matches = mask(view, entries, era), indices = space(matches, gap), longest = list[list.length - 1];
    // `merged`: later matching closes inside the sample's spacing. They belong to it and add no results of their own.
    const episodes = indices.map(i => {
      const merged = [];
      for (let j = i + 1; j < Math.min(view.n, i + gap); j++) if (matches[j]) merged.push(view.dates[j]);
      return { index:i, date:view.dates[i], close:view.closes[i], merged, values:snapshot(view, i), observation:observation(view, i),
        outcomes:Object.fromEntries(list.map(h => [h, outcome(view, i, h)])), fall:fall(view, i, i + view.wait + longest) };
    });
    const summary = Object.fromEntries(list.map(h => {
      const all = episodes.map(e => e.outcomes[h]), done = all.filter(o => o.status === 'complete');
      return [h, { ...summarize(done.map(o => o.pct)), pending:all.filter(o => o.status === 'pending').length,
        gap:all.filter(o => o.status === 'gap').length, drawdown:summarize(done.map(o => o.drawdown)), low:summarize(done.map(o => o.low)) }];
    }));
    // Each preview keeps every other condition: drop an active one, add an inactive one at its suggested
    // range around the reference close, or for a yes/no reading, count both answers.
    const previews = {};
    for (const m of metrics) {
      const rest = Object.fromEntries(entries.filter(([id]) => id !== m.id)), active = Object.hasOwn(conditions, m.id);
      if (m.source === 'obs' && !view.obs) previews[m.id] = null;
      else if (m.choice) previews[m.id] = { kind:'choice', yes:count(view, { ...rest, [m.id]:{ lo:1, hi:1 } }, gap, era),
        no:count(view, { ...rest, [m.id]:{ lo:0, hi:0 } }, gap, era), without:active ? count(view, rest, gap, era) : null };
      else if (active) previews[m.id] = { kind:'without', episodes:count(view, rest, gap, era) };
      else {
        const band = suggest(view, m.id, { ref:at, width });
        previews[m.id] = band ? { kind:'with', range:band, episodes:count(view, { ...conditions, [m.id]:band }, gap, era) } : null;
      }
    }
    const failing = entries.filter(([id, range]) => !inRange(view.values[id][at], range)).map(([id]) => id);
    const containing = [...indices].reverse().find(i => i <= at);
    const reference = { index:at, date:view.dates[at], close:view.closes[at], values:snapshot(view, at), observation:observation(view, at),
      excluded:excluded(era, view.dates[at]), matches:entries.length > 0 && matches[at] === 1, failing,
      // The reference close may be absorbed into a sample that started earlier.
      episode:matches[at] && containing !== undefined && at < containing + gap ? view.dates[containing] : null };
    // Closes that already meet every signal-day condition but are still inside their observation period.
    let observing = null;
    const signalEntries = entries.filter(([id]) => byId[id].source !== 'obs');
    if (view.obs && signalEntries.length) {
      observing = { count:0, latest:null };
      for (let i = 0; i <= view.last; i++) if (view.obs.status[i] === PENDING && !excluded(era, view.dates[i]) &&
          signalEntries.every(([id, range]) => inRange(view.values[id][i], range))) { observing.count++; observing.latest = view.dates[i]; }
    }
    let matchingDays = 0;
    for (const v of matches) matchingDays += v;
    return { first:view.first, asOf:view.asOf, gap, era, wait:view.wait, basis:view.basis, horizons:list, conditions:Object.fromEntries(entries),
      episodes:episodes.reverse(), summary, baseline:baseline(view, era, list), previews, reference, observing, matchingDays,
      historical:historical(view, indices) };
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
      era:pick('era', ['all', 'exclude_dotcom'], 'all'), gap:1, params:p, conditions };
  }

  return { horizonChoices, defaultHorizons, gaps, waits, eras, lookback, chartAfter, mature, groups, params, metrics, byId, fitOrder, fitDefaults,
    compute, frame, study, fit, suggest, count, validRange, rangeIssue, validParam, validWait, validGap, validEra, parseRange, formatRange,
    quantile, summarize, path, spread, percentile, sessionOn, isDrop, fromDropStudy };
});
