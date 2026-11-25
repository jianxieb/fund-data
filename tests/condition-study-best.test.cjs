const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/condition-study-model.js');

function sessions(closes, start = '2001-01-02') {
  const day = new Date(start + 'T00:00:00Z');
  return closes.map(close => {
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const row = [day.toISOString().slice(0, 10), close];
    day.setUTCDate(day.getUTCDate() + 1);
    return row;
  });
}
// A seeded random walk with Cboe-style VIX closes on the same sessions.
function walk(n, seed, drift = () => .0003) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
  let close = 100;
  return Array.from({ length:n }, (_, i) => {
    if (i) close *= Math.exp(drift(i) + .012 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
    return Number(close.toFixed(2));
  });
}
const series = sessions(walk(2600, 7));
const vix = series.map(([date], i) => [date, Number((14 + 14 * Math.abs(Math.sin(i / 23)) + (i % 7)).toFixed(2))]);
const data = C.compute(series, { vix }), view = C.frame(data);
// A shorter history keeps the plain counts of every pair quick.
const short = C.frame(C.compute(series.slice(0, 1400), { vix:vix.slice(0, 1400) }));
// A market that drifts down, where most results are falls, and one that rises for its first half and falls for the second.
const market = closes => {
  const rows = sessions(closes);
  return C.frame(C.compute(rows, { vix:rows.map(([date], i) => [date, Number((16 + 12 * Math.abs(Math.cos(i / 19)) + (i % 5)).toFixed(2))]) }));
};
const falling = market(walk(1400, 11, () => -.0015)), turning = market(walk(1400, 11, i => i < 700 ? .0015 : -.0015));
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not ' + expected);
const inside = (v, { lo, hi }) => Number.isFinite(v) && (lo === null || v >= lo - 1e-9) && (hi === null || v <= hi + 1e-9);
const dotcom = date => date >= '2000-01-01' && date <= '2002-12-31';
const round6 = v => Number(v.toFixed(6));
const floorStep = (v, step) => round6(Math.floor(v / step + 1e-9) * step);
const ceilStep = (v, step) => round6(Math.ceil(v / step - 1e-9) * step);
const order = id => C.metrics.findIndex(m => m.id === id);
const rowsOf = (...ids) => ids;

// The page's own frame at a set of lookbacks: applying a pick sets them, so its counts have to come out the same there.
const frames = new WeakMap();
function frameAt(source, params = {}, wait = source.wait || 0) {
  const base = source.framed ? source.data : source;
  let kept = frames.get(base);
  if (!kept) frames.set(base, kept = new Map());
  const key = JSON.stringify([params, wait]);
  if (!kept.has(key)) kept.set(key, C.frame(base, { params, wait }));
  return kept.get(key);
}
const paramsOf = items => Object.fromEntries(items.filter(it => it.param).map(it => [it.param, it.lookback]));

// Whether close `i` has a result that counts: inside the history range, its observation period complete, not among the
// latest closes still waiting for a result, and with a result after `h` sessions.
function counted(frame, i, { era = 'all', h = 21, keep = () => true } = {}) {
  if ((era === 'exclude_dotcom' && dotcom(frame.dates[i])) || (frame.obs && frame.obs.status[i] !== 1) || !keep(i)) return false;
  const end = i + frame.wait + 5;
  return end <= frame.last && frame.starts[end] === frame.starts[i] && Number.isFinite(frame.outcomes[h].pct[i + frame.wait]);
}
// Counted close by close on the page's frame at the set's lookbacks, apart from the search's bins and bits: the samples, the
// rises and falls among them, and how many remain when each has to start at least `h` sessions after the one before.
function countOf(source, items, o = {}) {
  const { h = 21 } = o, frame = frameAt(source, paramsOf(items)), pct = frame.outcomes[h].pct, out = { n:0, up:0, down:0, apart:0 };
  for (let i = 0, free = 0; i < frame.n; i++) {
    if (!items.every(it => inside(frame.values[it.id][i], it.range)) || !counted(frame, i, o)) continue;
    const p = pct[i + frame.wait];
    out.n++;
    if (p > 0) out.up++; else if (p < 0) out.down++;
    if (i >= free) { out.apart++; free = i + h; }
  }
  return { ...out, dir:out.up >= out.down ? 'up' : 'down', wins:Math.max(out.up, out.down) };
}
// Every close with a result, as the all-days comparison counts them (the latest closes included): the share that rose and
// the share that fell.
function allDays(frame, h, { era = 'all', keep = () => true } = {}) {
  let up = 0, down = 0, all = 0;
  for (let i = 0; i + frame.wait <= frame.last; i++) {
    const p = frame.outcomes[h].pct[i + frame.wait], start = frame.starts[i + frame.wait];
    if (i < start || (frame.obs && (i - 1 < start || frame.obs.status[i] !== 1)) || (era === 'exclude_dotcom' && dotcom(frame.dates[i])) ||
        !keep(i) || !Number.isFinite(p)) continue;
    all++;
    if (p > 0) up++;
    if (p < 0) down++;
  }
  return { up:100 * up / all, down:100 * down / all };
}
const scoreOf = (t, z, least, leastApart) => t.n >= least && t.apart >= leastApart ? C.wilsonShare(t.wins / t.n, t.apart, z) : 0;

// The thresholds and ranges of one reading by the rules the page states: up to 32 steps out from the reading, the reading
// moved by 25%–200% of itself, a further 1%–50% of the history toward either end, and 0 where readings change sign; a
// range is any lower threshold (or none) with any upper one (or none) that keeps at most 85% of the history.
function expected(id, values, ref, step) {
  const m = C.byId[id], v = values[ref], sorted = values.filter(Number.isFinite).sort(), N = sorted.length, T = C.bestThresholds;
  if (!Number.isFinite(v) || N < 50) return null;
  const lows = new Set(), highs = new Set();
  const low = t => {
    t = (m.integer ? Math.floor(t + 1e-9) : round6(t)) + 0;
    if (t <= v + 1e-9 && t > sorted[0] + 1e-9 && !(m.min !== undefined && t <= m.min + 1e-9)) lows.add(t);
  };
  const high = t => {
    t = (m.integer ? Math.ceil(t - 1e-9) : round6(t)) + 0;
    if (t >= v - 1e-9 && t < sorted[N - 1] - 1e-9 && !(m.max !== undefined && t >= m.max - 1e-9)) highs.add(t);
  };
  const f = floorStep(v, step), c = ceilStep(v, step);
  for (const j of T.steps) { low(f - (j - 1) * step); high(c + (j - 1) * step); }
  if (Math.abs(v) >= step) for (const k of T.scale) {
    const x = v * (1 - k), y = v * (1 + k);
    low(floorStep(Math.min(x, y), step));
    high(ceilStep(Math.max(x, y), step));
  }
  const under = sorted.filter(x => x < v).length / N, upTo = sorted.filter(x => x <= v).length / N;
  for (const d of T.share) {
    if (under - d > 0) low(floorStep(C.quantile(sorted, under - d), step));
    if (upTo + d < 1) high(ceilStep(C.quantile(sorted, upTo + d), step));
  }
  if (sorted[0] < 0 && sorted[N - 1] > 0) (v >= 0 ? low : high)(0);
  const below = x => { let a = 0, b = N; while (a < b) { const k = (a + b) >> 1; if (sorted[k] < x) a = k + 1; else b = k; } return a; };
  const lo = [...lows].sort((a, b) => b - a), hi = [...highs].sort((a, b) => a - b), ranges = [];
  for (const a of [...lo, null]) for (const b of [...hi, null]) {
    if (a === null && b === null) continue;
    const kept = (b === null ? N : below(b + 1e-9 + 1e-12)) - (a === null ? 0 : below(a - 1e-9));
    if (kept <= T.cover * N + 1e-9) ranges.push({ lo:a, hi:b });
  }
  return ranges.length ? { lows:lo, highs:hi, ranges } : null;
}
const stepOf = (id, lookback) => id !== 'rN' ? C.byId[id].step : lookback <= 5 ? .5 : lookback <= 21 ? 1 : lookback <= 63 ? 2 : 5;

// Every range alone and every pair of ranges of two different paired rows, the sets a search of at most two ranges without
// refinement compares, counted on the page's frames with plain arrays: the best by the bound of its win rate at `z`, ties
// to more samples, then fewer ranges, then the one found first.
function brute(source, { ref, h = 21, era = 'all', keep, rows, least = 20, leastApart = 20, z = null } = {}) {
  const readings = C.bestReadings(source, ref, rows), pool = readings.filter(r => r.pool), size = list => list.reduce((s, r) => s + r.ranges.length, 0);
  let pairs = 0;
  for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) if (pool[x].id !== pool[y].id) pairs += pool[x].ranges.length * pool[y].ranges.length;
  z ??= C.bestZ(size(readings) + pairs);
  const base = frameAt(source), days = [], way = [];
  for (let i = 0; i < base.n; i++) if (counted(base, i, { era, h, keep })) { days.push(i); way.push(Math.sign(base.outcomes[h].pct[i + base.wait])); }
  const tally = (A, B) => {
    let n = 0, up = 0, down = 0, apart = 0, next = -1;
    for (let k = 0; k < days.length; k++) {
      const d = days[k];
      if (!A[d] || (B && !B[d])) continue;
      n++;
      if (way[k] > 0) up++; else if (way[k] < 0) down++;
      if (d >= next) { apart++; next = d + h; }
    }
    const t = { n, up, down, apart, wins:Math.max(up, down), dir:up >= down ? 'up' : 'down' };
    return { ...t, score:scoreOf(t, z, least, leastApart) };
  };
  const better = (x, y) => !y || x.score > y.score + 1e-12 || (Math.abs(x.score - y.score) <= 1e-12 &&
    (x.n > y.n || (x.n === y.n && x.items.length < y.items.length)));
  const singles = new Map();
  let top = null;
  for (const r of readings) {
    const values = frameAt(source, r.param ? { [r.param]:r.lookback } : {}).values[r.id], list = [];
    for (const range of r.ranges) {
      const mask = Uint8Array.from(values, v => inside(v, range) ? 1 : 0), x = { items:[{ id:r.id, param:r.param, lookback:r.lookback, range }], mask, ...tally(mask) };
      if (!x.score) continue;
      list.push(x);
      if (better(x, top)) top = x;
    }
    singles.set(r, list);
  }
  for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) {
    if (pool[x].id === pool[y].id) continue;
    for (const p of singles.get(pool[x])) for (const q of singles.get(pool[y])) {
      const s = { items:[p.items[0], q.items[0]], ...tally(p.mask, q.mask) };
      if (s.score && s.score >= Math.max(p.score, q.score) + C.bestDefaults.gain - 1e-12 && better(s, top)) top = s;
    }
  }
  return { top, z, singles:size(readings), pairs, readings };
}
const pick = b => [b.items, b.dir, b.summary.n, b.wins, b.apart];
const want = t => [t.items, t.dir, t.n, t.wins, t.apart];

test('every reading at the reference close gives thresholds from each family on its step, and ranges that cover it', () => {
  const sample = { rN:[2, 9, 47, 126, 315, 504], ddN:[2, 40, 189, 251, 504], drops:[0.5, 1, 2.5] };
  for (const ref of [view.last, 1500, 900, 400]) {
    const readings = C.bestReadings(view, ref), byKey = new Map(readings.map(r => [r.id + ':' + r.lookback, r]));
    assert.equal(byKey.size, readings.length, 'each reading once');
    const check = (id, lookback) => {
      const r = byKey.get(id + ':' + lookback), param = lookback === null ? null : C.byId[id].param;
      const values = frameAt(view, param ? { [param]:lookback } : {}).values[id], step = stepOf(id, lookback), e = expected(id, values, ref, step);
      if (!e) return assert.equal(r, undefined, id + ':' + lookback + ' has no ranges at ' + ref);
      assert.ok(r, id + ':' + lookback + ' at ' + ref);
      // The reading is the page's own at that lookback, so applying it shows the same value.
      assert.equal(r.value, values[ref]);
      assert.deepEqual([r.param, r.step, r.lows, r.highs, r.ranges], [param, step, e.lows, e.highs, e.ranges], id + ':' + lookback + ' at ' + ref);
      for (const g of r.ranges) assert.ok(inside(r.value, g) && C.validRange(id, g), id + ' ' + C.formatRange(g) + ' covers ' + r.value);
      assert.equal(r.pool, lookback === null || C.bestLookbacks[id].pairs.includes(lookback));
    };
    for (const id of C.bestIds) check(id, null);
    for (const [id, list] of Object.entries(sample)) for (const lookback of list) check(id, lookback);
    // Every lookback of the rows that take one is its own reading once its history is long enough.
    for (const id of ['rN', 'ddN']) {
      const have = readings.filter(r => r.id === id).map(r => r.lookback);
      assert.deepEqual(have, C.bestLookbacks[id].all.filter(d => d < ref), id + ' at ' + ref);
    }
    const drops = readings.filter(r => r.id === 'drops').map(r => r.lookback);
    assert.ok(drops.length && drops.every(d => C.bestLookbacks.drops.all.includes(d)));
  }
  // The examples the thresholds are meant to reach: a one-month fall of about 4% gets about 2% to 6%, fixed steps
  // around it, and one-sided ranges.
  const at = view.values.r21.findIndex((v, i) => i > 300 && v > -4.2 && v < -3.8), r21 = C.bestReadings(view, at).find(r => r.id === 'r21');
  const v = view.values.r21[at], has = (lo, hi) => r21.ranges.some(g => g.lo === lo && g.hi === hi);
  assert.ok(has(floorStep(v * 1.5, 1), ceilStep(v * .5, 1)), 'scaled by half: ' + floorStep(v * 1.5, 1) + '~' + ceilStep(v * .5, 1));
  assert.ok(has(floorStep(v, 1) - 2, ceilStep(v, 1) + 2), 'two steps out on each side');
  assert.ok(r21.ranges.some(g => g.lo === null) && r21.ranges.some(g => g.hi === null), 'one-sided ranges');
  // A reading far out in one tail gets thresholds close to it on that side and none past it.
  const topDay = view.values.r1.reduce((best, x, i) => Number.isFinite(x) && x > view.values.r1[best] ? i : best, 300);
  const r1 = C.bestReadings(view, topDay).find(r => r.id === 'r1');
  assert.ok(r1.highs.length === 0 && r1.ranges.every(g => g.hi === null), 'only "at least" ranges above the highest reading');
  assert.ok(r1.lows[0] > view.values.r1[topDay] - r1.step, 'a threshold within one step of the reading');
  // Readings without a history yet give nothing.
  assert.ok(C.bestReadings(view, 100).every(r => !['ma200', 'dd252', 'r252', 'cross'].includes(r.id)));
});

test('the bound tightens with the number of sets compared', () => {
  near(C.upperZ(.025), 1.959964, 1e-6);
  near(C.upperZ(.005), 2.575829, 1e-6);
  near(C.upperZ(1e-9), 5.997807, 1e-6);
  near(C.bestZ(1), C.upperZ(.025));
  near(C.bestZ(2e7), C.upperZ(.025 / 2e7));
  assert.ok(C.bestZ(1e3) < C.bestZ(1e6) && C.bestZ(1e6) < C.bestZ(2e7));
  // The plan counts every range, every pair of paired rows, the sets grown from each board and the refined leaders.
  const b = C.best(view, { ref:1800 }), o = C.bestDefaults, readings = C.bestReadings(view, 1800), pool = readings.filter(r => r.pool);
  const size = list => list.reduce((s, r) => s + r.ranges.length, 0), family = id => size(readings.filter(r => r.id === id));
  let pairs = 0;
  for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) if (pool[x].id !== pool[y].id) pairs += pool[x].ranges.length * pool[y].ranges.length;
  const more = (o.items - 2) * o.width * size(pool) + 2 * o.refine * (family('rN') + family('ddN') + family('drops'));
  assert.deepEqual(b.plan, { singles:size(readings), pairs, more, total:size(readings) + pairs + more });
  assert.equal(b.z, C.bestZ(b.plan.total));
  assert.ok(b.plan.total > 1e6, b.plan.total + ' sets');
  assert.deepEqual([b.compared.singles, b.compared.pairs], [b.plan.singles, b.plan.pairs]);
  assert.ok(b.compared.more > 0 && b.compared.more <= b.plan.more);
  assert.equal(b.readings, readings.length);
});

test('a pick counts the same once the page applies its ranges and lookbacks, for every history range and observation period', () => {
  for (const [source, era, h, ref] of [[view, 'all', 21, 1800], [view, 'all', 5, view.last], [view, 'exclude_dotcom', 1, 1800],
    [C.frame(data, { wait:2 }), 'all', 63, 1800]]) {
    const b = C.best(source, { ref, horizon:h, era, minSamples:5, minApart:5 });
    assert.ok(b.items, 'a pick for h ' + h);
    const t = countOf(source, b.items, { era, h });
    assert.deepEqual([b.dir, b.summary.n, b.wins, b.apart], [t.dir, t.n, t.wins, t.apart], 'h ' + h);
    near(b.winPct, 100 * t.wins / t.n);
    near(b.score, C.wilsonShare(t.wins / t.n, t.apart, b.z));
    // The way most samples moved is the side their median is on.
    assert.ok(b.dir === 'up' ? b.summary.median >= 0 : b.summary.median <= 0, b.dir + ' with median ' + b.summary.median);
    near(b.basePct, allDays(source, h, { era })[b.dir]);
    // The page set to the pick's lookbacks and ranges shows the same samples.
    assert.deepEqual(b.params, paramsOf(b.items));
    assert.deepEqual(b.conditions, Object.fromEntries(b.items.map(it => [it.id, it.range])));
    const s = C.study(frameAt(source, b.params), { conditions:b.conditions, horizons:[h], era, ref });
    for (const k of ['n', 'upPct', 'median', 'min', 'max']) assert.equal(b.summary[k], s.summary[h][k], k);
    assert.equal(b.episodes, s.episodes.length);
    assert.deepEqual(b.baseline, s.baseline[h]);
  }
});

test('up to two ranges without refinement, the pick is the best of every range alone and every pair, as brute force finds it', () => {
  // `rN:9` is compared alone only: pairs take the rows at the paired lookbacks.
  const rows = rowsOf('r5', 'vix', 'rsi14', 'rN:10', 'ddN:21', 'rN:9');
  const dirs = [];
  for (const [source, ref, h, era] of [[short, short.last, 21, 'all'], [short, 1100, 5, 'all'], [short, 900, 63, 'exclude_dotcom'],
    [falling, falling.last, 21, 'all'], [falling, 1000, 5, 'all']]) {
    const b = C.best(source, { ref, horizon:h, era, rows, items:2, refine:0, minSamples:10, minApart:10 });
    const w = brute(source, { ref, h, era, rows, least:10, leastApart:10 });
    assert.ok(w.top, 'a pick for h ' + h);
    assert.deepEqual([b.plan.singles, b.plan.pairs, b.plan.more], [w.singles, w.pairs, 0]);
    assert.equal(b.z, w.z);
    assert.deepEqual(pick(b), want(w.top), 'h ' + h);
    near(b.score, w.top.score);
    assert.ok(w.pairs > 0 && w.readings.some(r => r.id === 'rN' && r.lookback === 9 && !r.pool));
    dirs.push(b.dir);
  }
  assert.deepEqual([...new Set(dirs)].sort(), ['down', 'up'], 'picks that call a rise and picks that call a fall');
});

test('a set of two or more ranges beats every set one range smaller by the gain, and sets grow past two ranges', () => {
  const rows = rowsOf('r5', 'r21', 'vix', 'rsi14', 'rN:10', 'ddN:21');
  let grown = 0;
  for (const [source, ref, h] of [[short, short.last, 5], [short, 1100, 21], [view, 1800, 5], [view, view.last, 10], [falling, falling.last, 5]]) {
    const b = C.best(source, { ref, horizon:h, rows, items:4, refine:0, minSamples:10, minApart:10 });
    assert.ok(b.items, 'a pick for h ' + h);
    // Every single and pair is still compared, so the pick is at least the best of them at the same bound.
    const w = brute(source, { ref, h, rows, least:10, leastApart:10, z:b.z });
    assert.ok(b.score >= w.top.score - 1e-12, b.score + ' against ' + w.top.score);
    assert.equal(b.plan.more, 2 * C.bestDefaults.width * w.readings.filter(r => r.pool).reduce((s, r) => s + r.ranges.length, 0));
    const t = countOf(source, b.items, { h });
    assert.deepEqual([b.dir, b.summary.n, b.wins, b.apart], [t.dir, t.n, t.wins, t.apart]);
    near(b.score, C.wilsonShare(t.wins / t.n, t.apart, b.z));
    if (b.items.length > 1) for (const it of b.items) {
      const rest = b.items.filter(x => x !== it), sc = scoreOf(countOf(source, rest, { h }), b.z, 10, 10);
      assert.ok(b.score >= sc + C.bestDefaults.gain - 1e-12, 'beats ' + rest.map(x => x.id).join('&') + ' by the gain');
    }
    if (b.items.length > 2) grown++;
  }
  assert.ok(grown > 0, 'some picks have three or more ranges');
});

test('the leading set is tried at every lookback, so a lookback outside the paired ones can win', () => {
  const rows = rowsOf('vix', ...C.bestLookbacks.rN.all.filter(d => d <= 40).map(d => 'rN:' + d));
  let moved = 0;
  for (const [source, ref, h] of [[short, short.last, 21], [short, 1100, 5], [view, 1800, 10], [view, view.last, 21], [falling, falling.last, 5]]) {
    const b = C.best(source, { ref, horizon:h, rows, items:2, refine:1, minSamples:10, minApart:10 });
    const w = brute(source, { ref, h, rows, least:10, leastApart:10, z:b.z }), lead = w.top;
    // The leader before refinement, with its rise-or-fall row swapped for, or joined by, that row at every lookback.
    let best = lead;
    const rest = lead.items.filter(it => it.id !== 'rN');
    if (rest.length === 1) {
      const base = scoreOf(countOf(source, rest, { h }), b.z, 10, 10);
      for (const r of w.readings.filter(x => x.id === 'rN')) for (const range of r.ranges) {
        const add = { id:'rN', param:'rNDays', lookback:r.lookback, range }, items = [...rest, add].sort((x, y) => order(x.id) - order(y.id));
        const t = countOf(source, items, { h }), sc = scoreOf(t, b.z, 10, 10), alone = scoreOf(countOf(source, [add], { h }), b.z, 10, 10);
        if (sc && sc >= Math.max(base, alone) + C.bestDefaults.gain - 1e-12 && sc > best.score + 1e-12) best = { items, ...t, score:sc };
      }
    }
    assert.ok(b.score >= best.score - 1e-12, b.score + ' against ' + best.score);
    if (best !== lead) {
      moved++;
      assert.notDeepEqual(b.items, lead.items);
    }
  }
  assert.ok(moved > 0, 'refinement found a better lookback for some leader');
});

test('a set whose samples mostly fell is scored on its share down, beside how often every close fell', () => {
  const b = C.best(falling, { ref:falling.last });
  assert.equal(b.dir, 'down');
  const t = countOf(falling, b.items);
  assert.deepEqual([b.wins, b.summary.n], [t.down, t.n]);
  near(b.winPct, 100 * t.down / t.n);
  assert.ok(b.summary.median < 0 && b.winPct > 50);
  // Beside it, how often every close fell, not how often it rose.
  const all = allDays(falling, 21);
  near(b.basePct, all.down);
  assert.ok(all.down > all.up);
  near(b.score, C.wilsonShare(t.down / t.n, t.apart, b.z));
});

test('the check picks on the history before the middle close alone and counts that pick, the way it called, from the middle close on', () => {
  const rows = rowsOf('r5', 'vix', 'rsi14', 'rN:10', 'ddN:21');
  for (const [source, ref, h] of [[short, short.last, 21], [short, 1100, 5], [frameAt(short, {}, 2), 900, 63], [falling, falling.last, 21],
    [turning, turning.last, 21]]) {
    const b = C.best(source, { ref, horizon:h, rows, items:2, refine:0, minSamples:10, minApart:10 }), k = b.check, split = Math.floor(source.n / 2);
    assert.equal(k.split, source.dates[split]);
    const early = brute(source, { ref, h, rows, least:5, leastApart:5, z:b.z, keep:i => i + source.wait + h < split }).top;
    assert.ok(early, 'an early pick for h ' + h);
    assert.deepEqual([k.items, k.dir], [early.items, early.dir]);
    assert.equal(k.same, k.key === b.key && k.dir === b.dir);
    // Counted the way the early pick called, against every close of the same years moving that way.
    near(k.baseline, allDays(source, h, { keep:i => i >= split })[k.dir]);
    const t = countOf(source, k.items, { h, keep:i => i >= split }), wins = t[k.dir];
    assert.deepEqual([k.n, k.wins, k.apart], [t.n, wins, t.apart]);
    near(k.winPct, 100 * wins / t.n);
    const low = 100 * C.wilsonShare(wins / t.n, t.apart, C.bestDefaults.checkZ), bar = Math.max(50, k.baseline);
    assert.equal(k.verdict, t.apart < 5 ? 'few' : low > bar ? 'pass' : k.winPct > bar ? 'weak' : 'fail');
  }
  assert.equal(C.best(falling, { ref:falling.last, minSamples:10, minApart:10 }).check.dir, 'down');
  // Picked in the rising years, the check calls a rise and is counted on rises in the falling years after them.
  const turned = C.best(turning, { ref:turning.last, minSamples:10, minApart:10 });
  assert.deepEqual([turned.dir, turned.check.dir, turned.check.same, turned.check.verdict], ['down', 'up', false, 'fail']);
  // Without enough early history no pick is checked.
  const none = C.best(short, { ref:short.last, rows, minSamples:2000 });
  assert.deepEqual([none.check.verdict, none.check.items], ['none', null]);
});

test('the search runs in steps that report how far it has got, and gives the same pick as one call', () => {
  const o = { ref:1800, horizon:21 }, run = C.bestRun(view, o);
  let step, last = 0, total = 0, steps = 0;
  while (!(step = run.next()).done) {
    steps++;
    const { done, total:t } = step.value;
    // While the readings are built nothing is counted yet.
    if (!t) { assert.deepEqual([done, total], [0, 0]); continue; }
    total ||= t;
    assert.equal(t, total);
    assert.ok(done >= last && done <= t, done + ' of ' + t);
    last = done;
  }
  assert.equal(last, total);
  assert.ok(steps > 1000, steps + ' steps');
  const { check, ...main } = C.best(view, o);
  assert.deepEqual(step.value, main);
  assert.equal(total, main.plan.total);
  let k;
  for (const r = C.checkRun(view, { ...o, main }); !(k = r.next()).done;);
  assert.deepEqual(k.value, check);
});

test('samples whose periods overlap count once toward the sample size', () => {
  // Every close on its own: a one-day result never overlaps the next, a month-long one does.
  const rows = rowsOf('r1', 'r5', 'vix', 'rsi14', 'rN:10');
  const day = C.best(view, { horizon:1, rows }), month = C.best(view, { horizon:21, rows });
  assert.equal(day.apart, day.summary.n);
  assert.ok(month.apart < month.summary.n, month.apart + ' of ' + month.summary.n);
  assert.equal(month.apart, countOf(view, month.items, { h:21 }).apart);
  assert.ok(month.apart >= C.bestDefaults.minApart);
});

test('without readings or enough samples the search says which is missing', () => {
  const none = C.best(view, { minSamples:100000, rows:rowsOf('r1', 'vix', 'rN:10') });
  assert.deepEqual([none.reason, none.items, none.conditions, none.params], ['samples', null, null, null]);
  assert.ok(none.compared.singles > 0);
  assert.equal(C.best(C.compute(series), { ref:0 }).reason, 'readings');
  // Two years of results leave fewer than 20 separate periods in ten years of history.
  assert.equal(C.best(view, { horizon:504 }).reason, 'samples');
  assert.throws(() => C.best(view, { horizon:7 }), /后续期限/);
});
