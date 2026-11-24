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
function walk(n, seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
  let close = 100;
  return Array.from({ length:n }, (_, i) => {
    if (i) close *= Math.exp(.0003 + .012 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
    return Number(close.toFixed(2));
  });
}
const series = sessions(walk(2600, 7));
const vix = series.map(([date], i) => [date, Number((14 + 14 * Math.abs(Math.sin(i / 23)) + (i % 7)).toFixed(2))]);
const data = C.compute(series, { vix }), view = C.frame(data);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not ' + expected);
const inside = (v, { lo, hi }) => Number.isFinite(v) && (lo === null || v >= lo - 1e-9) && (hi === null || v <= hi + 1e-9);
// Complete results among a study's samples, optionally only those whose signal day passes `keep`.
function tallyOf(frame, conditions, { ref, h = 21, gap = 21, era = 'all', keep = () => true } = {}) {
  const s = C.study(frame, { conditions, horizons:[h], ref, gap, era });
  const done = s.episodes.filter(e => keep(e.index) && e.outcomes[h].status === 'complete');
  return { n:done.length, wins:done.filter(e => e.outcomes[h].pct > 0).length, study:s };
}

test('the best combo holds only ranges the reference close meets, and its numbers are those of a study', () => {
  for (const [frame, options] of [[view, {}], [view, { gap:5, era:'exclude_dotcom', horizon:63 }], [C.frame(data, { wait:2 }), { horizon:5 }]]) {
    for (const ref of [frame.last, 1500, 900]) {
      const h = options.horizon || 21, b = C.best(frame, { ref, ...options });
      assert.ok(b.conditions, 'found a combo at ' + ref);
      const ids = Object.keys(b.conditions);
      assert.ok(ids.length >= 1 && ids.length <= C.bestDefaults.size);
      assert.deepEqual(ids, C.metrics.map(m => m.id).filter(id => ids.includes(id)), 'listed in the page order');
      for (const id of ids) {
        assert.ok(C.bestIds.includes(id), id);
        assert.ok(inside(frame.values[id][ref], b.conditions[id]), id + ' contains the reading at ' + ref);
      }
      const t = tallyOf(frame, b.conditions, { ref, h, gap:options.gap, era:options.era }), s = t.study.summary[h];
      assert.ok(b.summary.n >= C.bestDefaults.minSamples);
      assert.equal(b.summary.n, s.n);
      assert.equal(b.summary.upPct, s.upPct);
      assert.equal(b.summary.median, s.median);
      assert.equal(b.summary.min, s.min);
      assert.equal(b.wins, t.wins);
      assert.equal(b.episodes, t.study.episodes.length);
      assert.deepEqual(b.baseline, t.study.baseline[h]);
      near(b.score, C.wilson(t.wins, t.n));
      assert.deepEqual(C.best(frame, { ref, ...options }), b, 'the same inputs give the same combo');
    }
  }
});

test('no single candidate scores above the pick, and a second range adds at least the gain to the one it grew from', () => {
  for (const ref of [view.last, 1500, 900, 2000]) {
    const b = C.best(view, { ref }), score = conditions => { const t = tallyOf(view, conditions, { ref }); return { n:t.n, score:C.wilson(t.wins, t.n) }; };
    const singles = C.bestCandidates(view, ref).map(c => score({ [c.id]:c.range })).filter(x => x.n >= C.bestDefaults.minSamples);
    assert.ok(singles.length > 10, 'enough candidates at ' + ref);
    assert.ok(singles.every(x => x.score <= b.score + 1e-12), 'no single range beats the pick at ' + ref);
    const parts = Object.entries(b.conditions);
    if (parts.length === 2) assert.ok(parts.some(([id, range]) => b.score >= score({ [id]:range }).score + C.bestDefaults.gain - 1e-12));
  }
  // The Wilson lower bound ranks a small perfect sample below a large strong one.
  assert.ok(C.wilson(10, 10) < C.wilson(90, 100));
  near(C.wilson(10, 10), 1 / (1 + 1.96 ** 2 / 10));
  assert.equal(C.wilson(0, 0), 0);
});

test('candidates sit on the reading\'s side of the median at rounded thresholds, plus the band the match takes', () => {
  const ref = 1500, list = C.bestCandidates(view, ref);
  assert.ok(list.some(c => c.range.lo === null) && list.some(c => c.range.hi === null) && list.some(c => c.range.lo !== null && c.range.hi !== null));
  for (const { id, range } of list) {
    const m = C.byId[id], v = view.values[id][ref], median = C.quantile(view.stats[id].sorted, .5);
    assert.ok(inside(v, range) && C.validRange(id, range), id + ' ' + C.formatRange(range));
    if (range.lo !== null && range.hi !== null) assert.deepEqual(range, C.suggest(view, id, { ref }));
    else {
      const t = range.lo ?? range.hi, steps = t / m.step;
      assert.ok(t === 0 || Math.abs(steps - Math.round(steps)) < 1e-6, id + ' threshold on its step');
      if (range.lo === null) assert.ok(v <= median && t <= median + m.step / 2 && !(m.max !== undefined && t >= m.max));
      else assert.ok(v >= median && t >= median - m.step / 2 && !(m.min !== undefined && t <= m.min));
    }
  }
  // Readings without a history yet give nothing; the latest close always has some.
  assert.ok(C.bestCandidates(view, 100).every(c => !['ma200', 'dd252', 'r252', 'cross'].includes(c.id)));
  assert.ok(C.bestCandidates(view, view.last).length > 30);
});

test('a situation is held as the first range and only applies to a close that meets it', () => {
  const below = view.values.ma200.findLastIndex(v => v < -1), above = view.values.ma200.findLastIndex(v => v > 1);
  const b = C.best(view, { ref:below, scene:'below200' });
  assert.ok(b.scenes.includes('below200') && !b.scenes.includes('above200'));
  assert.deepEqual(b.conditions.ma200, { lo:null, hi:0 });
  assert.ok(Object.keys(b.conditions).length <= C.bestDefaults.size + 1);
  assert.equal(b.scene, 'below200');
  const t = tallyOf(view, b.conditions, { ref:below });
  assert.equal(b.summary.n, t.n);
  const off = C.best(view, { ref:above, scene:'below200' });
  assert.equal(off.reason, 'scene');
  assert.equal(off.conditions, null);
  assert.ok(off.scenes.includes('above200'));
  const drop = view.values.r1.findLastIndex(v => v <= -2);
  assert.ok(C.best(view, { ref:drop }).scenes.includes('drop'));
  assert.ok(!C.best(view, { ref:drop }).scenes.includes('rise'));
  assert.throws(() => C.best(view, { scene:'crash' }), /限定情形/);
  assert.throws(() => C.best(view, { horizon:7 }), /后续期限/);
});

test('without enough results or any reading the search says which is missing', () => {
  const none = C.best(view, { minSamples:100000 });
  assert.equal(none.reason, 'samples');
  assert.equal(none.conditions, null);
  // Every range is dropped before any set is tried, so nothing was compared.
  assert.ok(none.tested === 0 && none.candidates > 0);
  assert.equal(C.best(C.compute(series), { ref:0 }).reason, 'readings');
  // Merging a year of closes leaves too few samples in ten years of history.
  assert.equal(C.best(view, { gap:252 }).reason, 'samples');
});

test('the split check picks on each half alone and counts its pick on the other half', () => {
  const ref = view.last, h = 21, b = C.best(view, { ref, size:1 }), split = Math.floor(view.n / 2), least = Math.ceil(C.bestDefaults.minSamples / 2);
  assert.equal(b.check.split, view.dates[split]);
  const early = i => i + h < split, late = i => i >= split, candidates = C.bestCandidates(view, ref);
  // The share of a half's closes that rose; the fixture has no gaps or observation period, so every close with a result counts.
  const dayShare = keep => { let up = 0, all = 0; view.outcomes[h].pct.forEach((p, i) => { if (Number.isFinite(p) && keep(i)) { all++; if (p > 0) up++; } }); return up / all; };
  near(100 * dayShare(() => true), b.baseline.upPct);
  let wins = 0, n = 0, picks = 0, base = 0;
  for (const [fit, other] of [[early, late], [late, early]]) {
    // With one range, the pick on a half is simply the candidate ranked first on that half.
    const ranked = candidates.map(c => ({ ...c, key:c.id + '=' + C.formatRange(c.range), ...tallyOf(view, { [c.id]:c.range }, { ref, keep:fit }) }))
      .filter(c => c.n >= least).map(c => ({ ...c, score:C.wilson(c.wins, c.n) }))
      .sort((a, z) => z.score - a.score || z.n - a.n || (a.key < z.key ? -1 : 1));
    if (!ranked.length) continue;
    const t = tallyOf(view, { [ranked[0].id]:ranked[0].range }, { ref, keep:other });
    wins += t.wins; n += t.n; picks++; base += t.n * dayShare(other);
  }
  assert.deepEqual([b.check.wins, b.check.n, b.check.picks], [wins, n, picks]);
  near(b.check.upPct, 100 * wins / n);
  // The check is set against all days of the halves it counts on, weighted by its samples there.
  near(b.check.baseline, 100 * base / n);
  const full = C.best(view, { ref });
  assert.ok(full.check.n > 0 && full.check.picks === 2);
});
