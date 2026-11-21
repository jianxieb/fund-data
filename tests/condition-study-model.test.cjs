const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/condition-study-model.js');

// Weekday sessions from a start date; `skip` inserts calendar days before a given row.
function sessions(closes, start = '2001-01-02', skip = {}) {
  const day = new Date(start + 'T00:00:00Z');
  return closes.map((close, i) => {
    if (skip[i]) day.setUTCDate(day.getUTCDate() + skip[i]);
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const row = [day.toISOString().slice(0, 10), close];
    day.setUTCDate(day.getUTCDate() + 1);
    return row;
  });
}
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not ' + expected);
const wave = n => Array.from({ length:n }, (_, i) => 100 * (1 + .002 * i) * (1 + .08 * Math.sin(i / 9)) * (1 + .03 * Math.sin(i / 2.3)));

test('returns, extremes and averages use the signal close and earlier closes only', () => {
  const closes = wave(320), d = C.compute(sessions(closes)), i = 300;
  near(d.values.r1[i], (closes[i] / closes[i - 1] - 1) * 100);
  near(d.values.r3[i], (closes[i] / closes[i - 3] - 1) * 100);
  near(d.values.r21[i], (closes[i] / closes[i - 21] - 1) * 100);
  near(d.values.r252[i], (closes[i] / closes[i - 252] - 1) * 100);
  const window = closes.slice(i - 251, i + 1), high = Math.max(...window), low = Math.min(...window);
  near(d.values.dd252[i], (1 - closes[i] / high) * 100);
  near(d.values.rise252[i], (closes[i] / low - 1) * 100);
  assert.equal(d.values.since252[i], i - (i - 251 + window.lastIndexOf(high)));
  near(d.values.ddMax[i], (1 - closes[i] / Math.max(...closes.slice(0, i + 1))) * 100);
  const mean = k => closes.slice(i - k + 1, i + 1).reduce((a, b) => a + b, 0) / k;
  near(d.values.ma50[i], (closes[i] / mean(50) - 1) * 100, 1e-8);
  near(d.values.ma200[i], (closes[i] / mean(200) - 1) * 100, 1e-8);
  near(d.values.cross[i], (mean(50) / mean(200) - 1) * 100, 1e-8);
  const daily = closes.slice(i - 20, i + 1).map((c, j) => (c / closes[i - 20 + j - 1] - 1) * 100);
  near(d.values.worst21[i], Math.min(...daily));
  const logs = closes.slice(i - 20, i + 1).map((c, j) => Math.log(c / closes[i - 20 + j - 1])), m = logs.reduce((a, b) => a + b) / 21;
  near(d.values.vol21[i], Math.sqrt(logs.reduce((s, v) => s + (v - m) ** 2, 0) / 20 * 252) * 100, 1e-9);
  // Appending later closes must not change any earlier reading.
  const longer = C.compute(sessions([...closes, 1, 500, 2])).values;
  for (const metric of C.metrics) for (let j = 0; j < closes.length; j++)
    assert.ok(Object.is(longer[metric.id][j], d.values[metric.id][j]), metric.id + ' changed at ' + j);
});

test('warm-up lengths are exact and a long outage starts a fresh history', () => {
  const d = C.compute(sessions(wave(300)));
  const first = id => d.values[id].findIndex(Number.isFinite);
  assert.deepEqual(['r1', 'r3', 'r5', 'r21', 'r63', 'worst21', 'vol21', 'rsi14', 'ma50', 'ma200', 'cross', 'dd252', 'ddMax', 'rise252', 'since252'].map(first),
    [1, 3, 5, 21, 63, 21, 21, 14, 49, 199, 199, 251, 251, 251, 251]);
  assert.equal(d.stats.dd252.first, d.dates[251]);
  const split = C.compute(sessions([...wave(260), ...wave(30)], '2001-01-02', { 260:12 }));
  assert.equal(split.starts[259], 0); assert.equal(split.starts[260], 260);
  for (const id of ['r1', 'r5', 'dd252', 'ma50', 'vol21', 'rsi14', 'down']) assert.ok(Number.isNaN(split.values[id][260]), id);
  near(split.values.r5[265], (split.closes[265] / split.closes[260] - 1) * 100);
  assert.ok(Number.isNaN(split.values.r21[280]));
  assert.equal(split.outcomes[5].pct.slice(255, 260).every(Number.isNaN), true, 'forward windows never bridge the outage');
  assert.equal(C.study(split, { conditions:{ r1:{ lo:-100, hi:100 } }, gap:5 }).episodes.find(e => e.index > 254 && e.index < 260).outcomes[5].status, 'gap');
});

test('RSI follows Wilder smoothing; streaks reset on flat closes and stay unknown at the start', () => {
  const closes = [100, 101, 102, 101, 103, 104, 103, 103, 102, 101, 100, 102, 104, 105, 104, 106, 107, 105, 104, 103];
  const d = C.compute(sessions(closes));
  let gain = 0, loss = 0;
  const reference = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1], up = Math.max(change, 0), down = Math.max(-change, 0);
    if (i <= 14) { gain += up; loss += down; if (i === 14) { gain /= 14; loss /= 14; } }
    else { gain = (gain * 13 + up) / 14; loss = (loss * 13 + down) / 14; }
    reference[i] = i >= 14 ? 100 - 100 / (1 + gain / loss) : NaN;
  }
  for (let i = 14; i < closes.length; i++) near(d.values.rsi14[i], reference[i], 1e-9);
  assert.equal(C.compute(sessions(Array.from({ length:20 }, (_, i) => 100 + i))).values.rsi14[19], 100);
  assert.equal(C.compute(sessions(Array(20).fill(100))).values.rsi14[19], 50);
  assert.deepEqual(Array.from(d.values.down.slice(0, 12)), [NaN, 0, 0, 1, 0, 0, 1, 0, 1, 2, 3, 0]);
  assert.deepEqual(Array.from(d.values.up.slice(0, 8)), [NaN, NaN, NaN, 0, 1, 2, 0, 0]);
});

test('flat decimal histories stay exactly on their averages; invalid series are rejected', () => {
  const d = C.compute(sessions(Array(260).fill(1234.56)));
  for (const id of ['ma50', 'ma200', 'cross', 'dd252', 'rise252', 'r252', 'vol21']) assert.equal(d.values[id][259], 0, id);
  assert.equal(d.values.since252[259], 0, 'the most recent equal high is the reference');
  for (const bad of [[], [['2020-01-02', 1]], [['2020-01-03', 1], ['2020-01-02', 1]], [['2020-01-02', 1], ['2020-01-03', 0]],
    [['2020-02-30', 1], ['2020-03-02', 1]], [['2020-01-02', 1], ['2020-01-03', 1, 2]]]) assert.throws(() => C.compute(bad), /序列/);
});

test('conditions include both bounds, need a known value, and samples keep the chosen spacing', () => {
  // Days 10..29 all drop 1%: every one matches "1-day ≤ −0.99%".
  const closes = Array(60).fill(100);
  for (let i = 10; i < 30; i++) closes[i] = closes[i - 1] * .99;
  for (let i = 30; i < 60; i++) closes[i] = closes[29];
  const d = C.compute(sessions(closes));
  const r = C.study(d, { conditions:{ r1:{ lo:null, hi:-1 } }, gap:5 });
  assert.equal(r.matchingDays, 20, 'exactly −1% equals the inclusive bound despite decimal residue');
  assert.deepEqual(r.episodes.map(e => e.index).reverse(), [10, 15, 20, 25]);
  assert.deepEqual(C.study(d, { conditions:{ r1:{ lo:null, hi:-1 } }, gap:21 }).episodes.map(e => e.index).reverse(), [10]);
  assert.equal(C.study(d, { conditions:{ r1:{ lo:-1, hi:-1 } }, gap:5 }).matchingDays, 20);
  assert.equal(C.study(d, { conditions:{ r1:{ lo:null, hi:-1.01 } }, gap:5 }).matchingDays, 0);
  // r21 is unknown before day 21: an active condition excludes those days, an inactive one keeps them.
  const known = C.study(d, { conditions:{ r1:{ lo:null, hi:-1 }, r21:{ lo:-100, hi:100 } }, gap:5 });
  assert.deepEqual(known.episodes.map(e => e.index).reverse(), [21, 26]);
  assert.throws(() => C.study(d, { conditions:{ nope:{ lo:1, hi:null } } }), /未知的行情条件/);
  assert.throws(() => C.study(d, { conditions:{ r1:{ lo:2, hi:1 } } }), /未知的行情条件/);
  assert.throws(() => C.study(d, { conditions:{}, gap:7 }), /样本间隔/);
});

test('outcomes, risk and summaries use complete windows; previews keep every other condition', () => {
  const closes = wave(700), d = C.compute(sessions(closes));
  const conditions = { r5:{ lo:null, hi:-1 }, ma50:{ lo:null, hi:0 } }, r = C.study(d, { conditions, gap:21 });
  assert.ok(r.episodes.length > 3);
  const e = r.episodes.at(-1), i = e.index, h = 63, path = closes.slice(i, i + h + 1);
  near(e.outcomes[h].pct, (path.at(-1) / path[0] - 1) * 100);
  let top = path[0], worst = 0;
  for (const c of path) { top = Math.max(top, c); worst = Math.min(worst, (c / top - 1) * 100); }
  near(e.outcomes[h].drawdown, worst);
  near(e.outcomes[h].low, (Math.min(...path) / path[0] - 1) * 100);
  assert.equal(e.outcomes[h].date, d.dates[i + h]);
  for (const horizon of C.horizons) {
    const done = r.episodes.filter(x => x.outcomes[horizon].status === 'complete').map(x => x.outcomes[horizon].pct).sort((a, b) => a - b);
    const s = r.summary[horizon];
    assert.equal(s.n, done.length);
    assert.equal(s.pending, r.episodes.length - done.length);
    near(s.mean, done.reduce((a, b) => a + b, 0) / done.length);
    near(s.median, (done[(done.length - 1) >> 1] + done[done.length >> 1]) / 2);
    near(s.upPct, 100 * done.filter(v => v > 0).length / done.length);
    assert.equal(r.baseline[horizon].n, closes.length - horizon);
  }
  const recent = C.study(d, { conditions:{ r1:{ lo:-100, hi:100 } }, gap:252 }).episodes[0];
  assert.equal(recent.outcomes[252].status, 'pending');
  assert.equal(r.previews.r5.kind, 'without');
  assert.equal(r.previews.r5.episodes, C.count(d, { ma50:conditions.ma50 }, 21));
  const band = C.suggest(d, 'vol21');
  assert.deepEqual(r.previews.vol21, { kind:'with', range:band, episodes:C.count(d, { ...conditions, vol21:band }, 21) });
});

test('suggested ranges contain the latest value, snap outward to steps and open at historical extremes', () => {
  const closes = wave(700);
  closes.push(closes.at(-1) * .9);
  const d = C.compute(sessions(closes));
  for (const m of C.metrics) {
    const band = C.suggest(d, m.id), v = d.values[m.id][d.last];
    if (!band) continue;
    assert.ok(C.validRange(m.id, band), m.id);
    assert.ok((band.lo === null || band.lo <= v) && (band.hi === null || band.hi >= v), m.id + ' must contain ' + v);
    for (const side of ['lo', 'hi']) if (band[side] !== null) near(band[side] / m.step, Math.round(band[side] / m.step), 1e-9);
  }
  assert.equal(C.suggest(d, 'r1').lo, null, 'a record one-day fall keeps every larger fall');
  assert.ok(C.suggest(d, 'r1').hi < 0);
  const calm = C.compute(sessions(wave(700)));
  const ma = C.suggest(calm, 'ma50');
  assert.ok(ma.lo !== null && ma.hi !== null, 'an ordinary reading gets a two-sided range');
  const top = C.compute(sessions(Array.from({ length:400 }, (_, i) => 100 + i)));
  assert.equal(C.suggest(top, 'dd252'), null, 'a drawdown floor of 0% with no upper limit is not a condition');
});

test('the latest-close fit is greedy, deterministic and keeps enough separate samples', () => {
  const closes = wave(3000);
  closes.push(closes.at(-1) * .95, closes.at(-1) * .93);
  const d = C.compute(sessions(closes));
  const fit = C.fit(d, { gap:21 });
  assert.deepEqual(C.fit(d, { gap:21 }), fit);
  assert.deepEqual([...fit.added, ...fit.skipped.map(s => s.id)].sort(), [...C.fitOrder].sort());
  assert.deepEqual(fit.added, C.fitOrder.filter(id => fit.added.includes(id)), 'conditions keep the fixed order');
  assert.ok(fit.episodes >= fit.minEpisodes);
  for (const s of fit.skipped) if (s.episodes !== null) assert.ok(s.episodes < fit.minEpisodes);
  const r = C.study(d, { conditions:fit.conditions, gap:21 });
  assert.equal(r.current.matches, true);
  assert.equal(r.current.episode, r.episodes[0].date);
  assert.equal(r.historical, fit.episodes);
  const strict = C.fit(d, { gap:21, minEpisodes:100000 });
  assert.deepEqual(strict.conditions, {});
  assert.throws(() => C.fit(d, { gap:4 }), /样本间隔/);
});

test('range text round-trips and invalid ranges are refused', () => {
  assert.deepEqual(C.parseRange('~-8'), { lo:null, hi:-8 });
  assert.deepEqual(C.parseRange('14~25'), { lo:14, hi:25 });
  assert.deepEqual(C.parseRange('-15.5~'), { lo:-15.5, hi:null });
  for (const bad of ['~', '', 'a~b', '1~2~3', '1', '--1~2']) assert.equal(C.parseRange(bad), null, bad);
  assert.equal(C.formatRange({ lo:null, hi:-8 }), '~-8');
  assert.equal(C.formatRange({ lo:14, hi:25 }), '14~25');
  assert.equal(C.validRange('r5', { lo:null, hi:-8 }), true);
  assert.equal(C.validRange('r5', { lo:-8, hi:-8 }), true);
  assert.equal(C.validRange('r5', { lo:-7, hi:-8 }), false);
  assert.equal(C.validRange('r5', { lo:null, hi:null }), false);
  assert.equal(C.validRange('r5', { lo:-8.125, hi:null }), false);
  assert.equal(C.validRange('down', { lo:2.5, hi:null }), false);
  assert.equal(C.validRange('down', { lo:2, hi:null }), true);
  assert.equal(C.validRange('missing', { lo:1, hi:null }), false);
  // A bad value is named before a reversed pair, so the message points at what was typed.
  assert.equal(C.rangeIssue('r5', { lo:2, hi:-1.234 }), 'decimals');
  assert.equal(C.rangeIssue('down', { lo:2.5, hi:1 }), 'integer');
  assert.equal(C.rangeIssue('r5', { lo:NaN, hi:null }), 'number');
  assert.equal(C.rangeIssue('r5', { lo:null, hi:100001 }), 'size');
  assert.equal(C.rangeIssue('r5', { lo:-7, hi:-8 }), 'order');
  assert.equal(C.rangeIssue('r5', { lo:null, hi:null }), 'empty');
  assert.equal(C.rangeIssue('missing', { lo:1, hi:null }), 'metric');
  assert.equal(C.rangeIssue('r5', { lo:-8, hi:-8 }), null);
  assert.equal(C.validGap(21), true); assert.equal(C.validGap(20), false);
});

test('paths and their spread are set to 100 at each signal and stop at the latest close', () => {
  const closes = wave(400), d = C.compute(sessions(closes));
  const p = C.path(d, 300);
  assert.equal(p[0][0], -63); assert.equal(p.at(-1)[0], 99);
  assert.deepEqual(p.find(([k]) => k === 0), [0, 100]);
  near(p.at(-1)[1], closes[399] / closes[300] * 100);
  const rows = C.spread(d, [100, 200, 300]);
  const at = k => rows.find(r => r.k === k);
  assert.equal(at(0).median, 100); assert.equal(at(99).n, 3); assert.equal(at(100).n, 2); assert.equal(at(252).n, 1);
  near(at(10).median, [100, 200, 300].map(i => closes[i + 10] / closes[i] * 100).sort((a, b) => a - b)[1]);
  near(C.percentile(d, 'r1', d.values.r1[d.last]), 100 * d.stats.r1.sorted.filter(v => v <= d.values.r1[d.last]).length / d.stats.r1.n);
});
