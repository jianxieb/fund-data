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
// A market that drifts down, where most results are falls, and one that rises for its first half and falls for the second.
const market = closes => {
  const rows = sessions(closes);
  return C.frame(C.compute(rows, { vix:rows.map(([date], i) => [date, Number((16 + 12 * Math.abs(Math.cos(i / 19)) + (i % 5)).toFixed(2))]) }));
};
const falling = market(walk(1400, 11, () => -.0015)), turning = market(walk(1400, 11, i => i < 700 ? .0015 : -.0015));
// Every close with a result, as the all-days comparison counts them: the share that rose and the share that fell.
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
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not ' + expected);
const inside = (v, { lo, hi }) => Number.isFinite(v) && (lo === null || v >= lo - 1e-9) && (hi === null || v <= hi + 1e-9);
const dotcom = date => date >= '2000-01-01' && date <= '2002-12-31';

// Counted close by close with plain arrays, apart from the search's bitsets: the samples a study takes (every matching
// close), those whose result counts, the rises and falls among them, and how many remain when each has to start at least
// `h` sessions after the one before.
function samplesOf(frame, list, { era = 'all', h = 21, keep = () => true } = {}) {
  const out = { n:0, up:0, down:0, apart:0 };
  let free = 0;
  for (let i = 0; i < frame.n; i++) {
    if ((era === 'exclude_dotcom' && dotcom(frame.dates[i])) || (frame.obs && frame.obs.status[i] !== 1) ||
        !list.every(([id, range]) => inside(frame.values[id][i], range))) continue;
    const end = i + frame.wait + 5;
    if (!(end <= frame.last && frame.starts[end] === frame.starts[i]) || !keep(i)) continue;
    const p = frame.outcomes[h].pct[i + frame.wait];
    if (!Number.isFinite(p)) continue;
    out.n++;
    if (p > 0) out.up++;
    if (p < 0) out.down++;
    if (i >= free) { out.apart++; free = i + h; }
  }
  return { ...out, dir:out.up >= out.down ? 'up' : 'down', wins:Math.max(out.up, out.down) };
}
const entries = conditions => Object.entries(conditions);
// The pick by brute force: every candidate range alone and every pair of two readings, each counted close by close and
// scored on the share that moved the way most of its samples did.
function brute(frame, { ref, horizon:h = 21, era = 'all', keep, minSamples = C.bestDefaults.minSamples, minApart = C.bestDefaults.minApart } = {}) {
  const { z, gain } = C.bestDefaults, score = t => C.wilsonShare(t.wins / t.n, t.apart, z);
  const alone = [];
  for (const c of C.bestCandidates(frame, ref)) {
    const t = samplesOf(frame, [[c.id, c.range]], { era, h, keep });
    if (t.n >= minSamples && t.apart >= minApart) alone.push({ list:[c], t, score:score(t) });
  }
  const better = (x, y) => !y || x.score > y.score + 1e-12 ||
    (Math.abs(x.score - y.score) <= 1e-12 && (x.t.n > y.t.n || (x.t.n === y.t.n && x.list.length < y.list.length)));
  let top = null;
  for (const x of alone) if (better(x, top)) top = x;
  for (let i = 0; i < alone.length; i++) for (let j = i + 1; j < alone.length; j++) {
    const [p, q] = [alone[i], alone[j]];
    if (p.list[0].id === q.list[0].id) continue;
    const list = [p.list[0], q.list[0]], t = samplesOf(frame, list.map(c => [c.id, c.range]), { era, h, keep });
    if (t.n < minSamples || t.apart < minApart) continue;
    const x = { list, t, score:score(t) };
    if (x.score >= Math.max(p.score, q.score) + gain - 1e-12 && better(x, top)) top = x;
  }
  return top && { conditions:Object.fromEntries(top.list.map(c => [c.id, c.range])), ...top.t };
}

test('every range covers the reference reading, with thresholds that follow it on its step and within the caps', () => {
  for (const ref of [view.last, 1500, 900, 400]) {
    const list = C.bestCandidates(view, ref);
    assert.ok(list.length > 100, 'enough ranges at ' + ref);
    const seen = new Set();
    for (const { id, range } of list) {
      const m = C.byId[id], v = view.values[id][ref], s = view.stats[id].sorted, text = id + '=' + C.formatRange(range);
      assert.ok(C.bestIds.includes(id) && !seen.has(text), text);
      seen.add(text);
      assert.ok(C.validRange(id, range) && inside(v, range), text + ' covers ' + v);
      for (const t of [range.lo, range.hi]) if (t !== null) {
        assert.ok(t === 0 || Math.abs(t / m.step - Math.round(t / m.step)) < 1e-6, text + ' on the step');
        assert.ok(!(m.min !== undefined && t <= m.min) && !(m.max !== undefined && t >= m.max), text + ' inside the natural ends');
      }
      // The share of the history a range keeps stays under its cap, so every range leaves something out.
      const kept = s.filter(x => inside(x, range)).length / s.length;
      assert.ok(kept <= (range.lo !== null && range.hi !== null ? C.bestReach.bandCover : C.bestReach.sideCover) + 1e-9, text + ' keeps ' + kept);
    }
  }
  // A reading far out in one tail gets thresholds close to it on that side and none past it.
  const top = view.values.r1.reduce((best, v, i) => Number.isFinite(v) && v > view.values.r1[best] ? i : best, 300);
  const r1 = C.bestCandidates(view, top).filter(c => c.id === 'r1');
  assert.ok(r1.length >= 5 && r1.every(c => c.range.hi === null), 'only "at least" ranges above the highest reading');
  assert.ok(r1.some(c => c.range.lo >= view.values.r1[top] - 2), 'a threshold within 2 points of the reading');
  // Readings without a history yet give nothing.
  assert.ok(C.bestCandidates(view, 100).every(c => !['ma200', 'dd252', 'r252', 'cross'].includes(c.id)));
});

test('counting with bits matches counting close by close, for every history range and observation period', () => {
  for (const [frame, era, h] of [[view, 'all', 21], [view, 'all', 5], [view, 'exclude_dotcom', 1], [C.frame(data, { wait:2 }), 'all', 63],
    [view, 'exclude_dotcom', 252]]) {
    const b = C.best(frame, { ref:1800, horizon:h, era, minSamples:5, minApart:5 });
    assert.ok(b.conditions, 'a pick for h ' + h);
    const t = samplesOf(frame, entries(b.conditions), { era, h });
    assert.deepEqual([b.dir, b.summary.n, b.wins, b.apart], [t.dir, t.n, t.wins, t.apart], 'h ' + h);
    near(b.winPct, 100 * t.wins / t.n);
    // The way most samples moved is the side their median is on.
    assert.ok(b.dir === 'up' ? b.summary.median >= 0 : b.summary.median <= 0, b.dir + ' with median ' + b.summary.median);
    near(b.basePct, allDays(frame, h, { era })[b.dir]);
    const s = C.study(frame, { conditions:b.conditions, horizons:[h], era, ref:1800 });
    assert.equal(b.summary.n, s.summary[h].n);
    assert.equal(b.summary.upPct, s.summary[h].upPct);
    assert.equal(b.summary.median, s.summary[h].median);
    assert.equal(b.summary.min, s.summary[h].min);
    assert.equal(b.summary.max, s.summary[h].max);
    assert.equal(b.episodes, s.episodes.length);
    assert.deepEqual(b.baseline, s.baseline[h]);
    if (b.dir === 'up') near(b.basePct, b.baseline.upPct);
  }
});

test('the pick is the best of every range alone and every pair of two readings, as brute force finds it', () => {
  // A smaller history keeps the plain-array count of every pair quick.
  const short = C.frame(C.compute(series.slice(0, 1400), { vix:vix.slice(0, 1400) }));
  const dirs = [];
  for (const [frame, ref, h, era] of [[short, short.last, 21, 'all'], [short, 1100, 5, 'all'], [short, 900, 63, 'exclude_dotcom'],
    [falling, falling.last, 21, 'all'], [falling, 1000, 5, 'all']]) {
    const b = C.best(frame, { ref, horizon:h, era, minSamples:10, minApart:10 });
    const want = brute(frame, { ref, horizon:h, era, minSamples:10, minApart:10 });
    assert.ok(want, 'a pick for h ' + h);
    assert.deepEqual(b.conditions, want.conditions, 'h ' + h);
    assert.deepEqual([b.dir, b.summary.n, b.wins, b.apart], [want.dir, want.n, want.wins, want.apart]);
    assert.equal(b.usable + b.pairs > b.candidates, true, 'pairs were compared');
    dirs.push(b.dir);
  }
  assert.deepEqual([...new Set(dirs)].sort(), ['down', 'up'], 'picks that call a rise and picks that call a fall');
});

test('a set whose samples mostly fell is scored on its share down, beside how often every close fell', () => {
  const b = C.best(falling, { ref:falling.last });
  assert.equal(b.dir, 'down');
  const t = samplesOf(falling, entries(b.conditions));
  assert.deepEqual([b.wins, b.summary.n], [t.down, t.n]);
  near(b.winPct, 100 * t.down / t.n);
  assert.ok(b.summary.median < 0 && b.winPct > 50);
  // Beside it, how often every close fell, not how often it rose.
  const all = allDays(falling, 21);
  near(b.basePct, all.down);
  assert.ok(all.down > all.up);
  near(b.score, C.wilsonShare(t.down / t.n, t.apart, C.bestDefaults.z));
});

test('the check picks on the history before the middle close alone and counts that pick, in the way it called, from the middle close on', () => {
  const short = C.frame(C.compute(series.slice(0, 1400), { vix:vix.slice(0, 1400) }));
  for (const [frame, ref, h] of [[short, short.last, 21], [short, 1100, 5], [C.frame(C.compute(series.slice(0, 1400), { vix:vix.slice(0, 1400) }), { wait:2 }), 900, 63],
    [falling, falling.last, 21], [turning, turning.last, 21]]) {
    const b = C.best(frame, { ref, horizon:h, minSamples:10, minApart:10 }), k = b.check, split = Math.floor(frame.n / 2);
    assert.equal(k.split, frame.dates[split]);
    const pick = brute(frame, { ref, horizon:h, minSamples:5, minApart:5, keep:i => i + frame.wait + h < split });
    assert.ok(pick, 'an early pick for h ' + h);
    assert.deepEqual([k.conditions, k.dir], [pick.conditions, pick.dir]);
    assert.equal(k.same, JSON.stringify(k.conditions) === JSON.stringify(b.conditions) && k.dir === b.dir);
    // Counted the way the early pick called, against every close of the same years moving that way.
    near(k.baseline, allDays(frame, h, { keep:i => i >= split })[k.dir]);
    const t = samplesOf(frame, entries(k.conditions), { h, keep:i => i >= split }), wins = t[k.dir];
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
  const none = C.best(short, { ref:short.last, minSamples:2000 });
  assert.equal(none.check.verdict, 'none');
  assert.equal(none.check.conditions, null);
});

test('samples whose periods overlap count once toward the sample size', () => {
  // Every close on its own: a one-day result never overlaps the next, a month-long one does.
  const day = C.best(view, { horizon:1 }), month = C.best(view, { horizon:21 });
  assert.equal(day.apart, day.summary.n);
  assert.ok(month.apart < month.summary.n, month.apart + ' of ' + month.summary.n);
  assert.equal(month.apart, samplesOf(view, entries(month.conditions), { h:21 }).apart);
  assert.ok(month.apart >= C.bestDefaults.minApart);
});

test('without readings or enough samples the search says which is missing', () => {
  const none = C.best(view, { minSamples:100000 });
  assert.equal(none.reason, 'samples');
  assert.equal(none.conditions, null);
  assert.ok(none.candidates > 0 && none.usable === 0 && none.pairs === 0);
  assert.equal(C.best(C.compute(series), { ref:0 }).reason, 'readings');
  // Two years of results leave fewer than 20 separate periods in ten years of history.
  const long = C.best(view, { horizon:504 });
  assert.equal(long.reason, 'samples');
  assert.throws(() => C.best(view, { horizon:7 }), /后续期限/);
});
