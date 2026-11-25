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
const same = (actual, expected, what) => assert.ok(Object.is(actual, expected) || Math.abs(actual - expected) <= 1e-9, what + ': ' + actual + ' vs ' + expected);
const wave = n => Array.from({ length:n }, (_, i) => 100 * (1 + .002 * i) * (1 + .08 * Math.sin(i / 9)) * (1 + .03 * Math.sin(i / 2.3)));
const flat = (n, close = 100) => Array(n).fill(close);
const frameOf = (closes, options = {}, start, skip) => C.frame(C.compute(sessions(closes, start, skip)), options);

test('a recovery on day one counts even if the index falls back; results start at the end of the period', () => {
  // Day 30 falls 6%, day 31 closes exactly at the prior close, day 32 falls back 5%.
  const closes = [...flat(30), 94, 100, 95, ...Array.from({ length:40 }, (_, k) => 96 + k / 2)], v = frameOf(closes, { wait:2 });
  assert.equal(v.values.recov[30], 1, 'touching the prior close is inclusive');
  assert.equal(v.obs.touch[30], 31);
  assert.equal(v.values.broke[30], 0);
  near(v.values.obsMove[30], (95 / 94 - 1) * 100);
  near(v.values.rebound[30], (95 - 94) / (100 - 94) * 100);
  const recovered = C.study(v, { conditions:{ r1:{ lo:null, hi:-5 }, recov:{ lo:1, hi:1 } }, horizons:[1, 2, 3, 4] });
  assert.deepEqual(recovered.episodes.map(e => e.index), [30]);
  const e = recovered.episodes[0];
  assert.equal(e.observation.recoveryDate, v.dates[31]);
  assert.equal(e.observation.anchorDate, v.dates[32]);
  assert.deepEqual(e.observation.days.map(d => d[1]), [100, 95]);
  for (const h of [1, 2, 3, 4]) near(e.outcomes[h].pct, (closes[32 + h] / 95 - 1) * 100);
  // Day 32's −5.00% meets the inclusive bound; it never regains day 31's close.
  assert.deepEqual(C.study(v, { conditions:{ r1:{ lo:null, hi:-5 }, recov:{ lo:0, hi:0 } } }).episodes.map(x => x.index), [32]);
  assert.equal(C.study(frameOf(closes, { wait:1 }), { conditions:{ r1:{ lo:null, hi:-5 }, recov:{ lo:1, hi:1 } } }).episodes[0].observation.anchorDate, v.dates[31]);
  assert.throws(() => C.study(C.frame(v), { conditions:{ recov:{ lo:1, hi:1 } } }), /先设置观察期/);
  assert.equal(C.rangeIssue('recov', { lo:0, hi:1 }), 'choice');
  assert.equal(C.rangeIssue('broke', { lo:.5, hi:.5 }), 'choice');
});

test('an intraday touch recovers only on the high basis; returns stay on closes; missing highs exclude the day', () => {
  const closes = [...flat(30), 94, 99, 98, ...Array.from({ length:30 }, (_, k) => 98 + k / 10)], rows = sessions(closes);
  const highs = rows.map(([date, close], i) => [date, i === 31 ? 100 : close]);
  const byClose = C.frame(C.compute(rows), { wait:2 }), byHigh = C.frame(C.compute(rows), { wait:2, basis:'high', highs });
  assert.equal(byClose.values.recov[30], 0);
  assert.equal(byHigh.values.recov[30], 1);
  assert.equal(byHigh.obs.touch[30], 31);
  const one = view => C.study(view, { conditions:{ r1:{ lo:null, hi:-5 } } }).episodes.find(e => e.index === 30);
  assert.equal(one(byHigh).outcomes[5].pct, one(byClose).outcomes[5].pct);
  assert.deepEqual(one(byHigh).observation.days[0], [rows[31][0], 99, 100]);
  // A missing day-32 high leaves recovery unknown: not unrecovered, and not a sample at all.
  const gap = C.frame(C.compute(rows), { wait:2, basis:'high', highs:highs.filter((_, i) => i !== 32) });
  const seen = C.study(gap, { conditions:{ r1:{ lo:null, hi:-5 } }, ref:30 }).reference.observation;
  assert.equal(seen.status, 'missingHigh');
  assert.equal(seen.recovered, null);
  assert.deepEqual(seen.missingHighDates, [rows[32][0]]);
  assert.equal(one(gap), undefined);
  // A high below its own close is treated as missing too.
  const low = C.frame(C.compute(rows), { wait:2, basis:'high', highs:highs.map(([d, h], i) => [d, i === 31 ? 98.5 : h]) });
  assert.equal(C.study(low, { conditions:{ r1:{ lo:null, hi:-5 } }, ref:30 }).reference.observation.status, 'missingHigh');
  assert.throws(() => C.frame(C.compute(rows), { wait:2, basis:'high', highs:[[rows[1][0], 1], [rows[0][0], 1]] }), /最高价/);
  assert.throws(() => C.frame(C.compute(rows), { wait:2, basis:'open' }), /收复判定/);
});

test('unfinished or interrupted observations never become samples; the reference says how many sessions remain', () => {
  const closes = wave(300);
  closes.push(closes.at(-1) * .94);
  const v = frameOf(closes, { wait:5 }), last = v.last;
  const r = C.study(v, { conditions:{ r1:{ lo:null, hi:-5 } } });
  assert.equal(r.episodes.length, 0);
  assert.deepEqual(r.reference.observation, { status:'pending', waitLeft:5 });
  assert.deepEqual(r.reference.failing, []);
  assert.equal(r.reference.matches, false);
  assert.deepEqual(r.observing, { count:1, latest:v.dates[last] });
  // An outage inside the period ends it: a gap, never a shorter observation.
  const cut = wave(300);
  cut[197] = cut[196] * .94;
  const split = frameOf(cut, { wait:5 }, '2001-01-02', { 200:12 });
  assert.equal(split.starts[200], 200);
  const g = C.study(split, { conditions:{ r1:{ lo:null, hi:-5 } }, ref:197 });
  assert.equal(g.reference.observation.status, 'gap');
  assert.equal(g.episodes.length, 0);
});

test('the rebound uses the end-of-period close regardless of an earlier recovery; a tie is not a new low', () => {
  const recovered = frameOf([...flat(30), 90, 100, 95, ...flat(10)], { wait:2 });
  near(recovered.values.rebound[30], 50);
  assert.equal(recovered.values.recov[30], 1);
  assert.equal(recovered.values.broke[30], 0);
  assert.equal(frameOf([...flat(30), 90, 90, 92, ...flat(10)], { wait:2 }).values.broke[30], 0);
  const breached = frameOf([...flat(30), 90, 89.99, 95, ...flat(10)], { wait:2 });
  assert.equal(breached.values.broke[30], 1, 'a lower close stays a breach after the rebound');
  near(breached.values.rebound[30], 50);
  const up = frameOf([...flat(30), 101, 102, 103, ...flat(10)], { wait:2 });
  assert.equal(C.study(up, { conditions:{ r1:{ lo:0, hi:null } }, ref:30 }).reference.observation.rebound, null, 'no lost points to regain');
});

test('big-drop counts exclude the signal day, include day −21 and follow the chosen size', () => {
  const closes = flat(45);
  closes[19] = 94; closes[40] = 90; closes[41] = 90;
  const five = frameOf(closes, { params:{ dropsPct:5 } }), six = frameOf(closes, { params:{ dropsPct:6 } });
  assert.equal(five.values.drops[40], 1, 'day 19 is 21 sessions back; day 40 itself is left out');
  assert.equal(five.values.drops[41], 1, 'day 40 counts, day 19 has left the window');
  assert.equal(six.values.drops[40], 0, 'exactly 6% is not beyond 6%');
  assert.equal(six.values.drops[41], 1);
  assert.ok(Number.isNaN(five.values.drops[21]));
  assert.equal(five.values.drops[22], 1, 'the first count needs a close before the 21-session window');
  assert.equal(C.isDrop(100, 95, 5), false);
  assert.equal(C.isDrop(100, 94.99999, 5), true);
  assert.equal(C.validParam('dropsPct', 5.125), false);
  assert.throws(() => frameOf(closes, { params:{ rNDays:0 } }), /回看参数/);
});

test('custom look-back windows match full rescans and restart after an outage of more than ten days', () => {
  const closes = wave(400), v = frameOf(closes, { params:{ rNDays:7, ddNDays:30 } });
  for (let i = 0; i < closes.length; i++) {
    same(v.values.rN[i], i >= 7 ? (closes[i] / closes[i - 7] - 1) * 100 : NaN, 'rN ' + i);
    same(v.values.ddN[i], i >= 29 ? (1 - closes[i] / Math.max(...closes.slice(i - 29, i + 1))) * 100 : NaN, 'ddN ' + i);
  }
  const rows = [['2020-01-02', 100], ['2020-01-03', 101], ['2020-01-06', 102], ['2020-01-16', 103], ['2020-01-27', 104], ['2020-01-28', 105], ['2020-01-29', 106]];
  const split = C.frame(C.compute(rows), { params:{ rNDays:1, ddNDays:2 } });
  assert.deepEqual(Array.from(split.starts), [0, 0, 0, 0, 4, 4, 4], 'ten calendar days is still one history; eleven is not');
  near(split.values.rN[3], (103 / 102 - 1) * 100);
  assert.ok(Number.isNaN(split.values.rN[4]) && Number.isNaN(split.values.ddN[4]));
  near(split.values.rN[5], (105 / 104 - 1) * 100);
  assert.equal(split.values.ddN[5], 0);
});

test('the other index counts only over the same two adjacent closing dates', () => {
  const rows = [['2020-01-02', 100], ['2020-01-03', 101], ['2020-01-06', 102], ['2020-01-07', 103], ['2020-01-08', 104]];
  const peer = [['2020-01-02', 50], ['2020-01-03', 51], ['2020-01-07', 52], ['2020-01-08', 50]];
  const v = C.frame(C.compute(rows), { peer });
  const values = Array.from(v.values.peer1);
  assert.ok(Number.isNaN(values[0]) && Number.isNaN(values[2]) && Number.isNaN(values[3]), 'a missing date or a different previous date stays unknown');
  near(values[1], 2);
  near(values[4], (50 / 52 - 1) * 100);
  assert.equal(v.peer, true);
  assert.ok(C.frame(C.compute(rows)).values.peer1.every(Number.isNaN));
  assert.throws(() => C.frame(C.compute(rows), { peer:[['2020-01-03', 1], ['2020-01-02', 1]] }), /对照指数/);
});

test('pre-drop readings are the previous session\'s own values and never cross an outage', () => {
  const v = frameOf(wave(600), {}, '2001-01-02', { 400:12 });
  for (let i = 1; i < 600; i++) for (const [id, source] of [['ma200p', 'ma200'], ['dd252p', 'dd252'], ['vol21p', 'vol21']])
    same(v.values[id][i], i === v.starts[i] ? NaN : v.values[source][i - 1], id + ' ' + i);
  assert.ok(Number.isNaN(v.values.ma200p[400]));
});

test('excluding 2000–2002 drops those signal days from the samples and from the comparison', () => {
  const v = frameOf(wave(1300), {}, '1999-01-04'), conditions = { r1:{ lo:null, hi:0 } };
  const all = C.study(v, { conditions }), cut = C.study(v, { conditions, era:'exclude_dotcom' });
  const outside = date => date < '2000-01-01' || date > '2002-12-31';
  assert.ok(all.episodes.some(e => !outside(e.date)));
  assert.deepEqual(cut.episodes.map(e => e.date), all.episodes.map(e => e.date).filter(outside));
  const expected = v.dates.filter((date, i) => outside(date) && i + 5 <= v.last).length;
  assert.equal(cut.baseline[5].n, expected);
  assert.equal(all.baseline[5].n, v.n - 5);
  assert.equal(C.study(v, { conditions, era:'exclude_dotcom', ref:v.dates.indexOf('2001-03-01') }).reference.excluded, true);
  assert.throws(() => C.study(v, { conditions, era:'1990s' }), /历史范围/);
});

test('the fall since the signal day covers the observation and the longest selected horizon', () => {
  const closes = [...flat(30), 94, 92, 93, 91, 95, ...flat(10, 96)], v = frameOf(closes);
  const e = C.study(v, { conditions:{ r1:{ lo:null, hi:-5 } }, horizons:[1, 4] }).episodes[0];
  assert.deepEqual({ ...e.fall, pct:Number(e.fall.pct.toFixed(9)) },
    { status:'complete', pct:Number(((91 / 94 - 1) * 100).toFixed(9)), days:3, date:v.dates[33], through:v.dates[34] });
  const longer = C.study(frameOf(closes, { wait:2 }), { conditions:{ r1:{ lo:null, hi:-5 } }, horizons:[1] }).episodes[0];
  assert.equal(longer.fall.through, v.dates[33], 'two observation sessions plus one');
  assert.equal(longer.fall.days, 3);
  const none = C.study(frameOf([...flat(30), 94, ...flat(10, 95)]), { conditions:{ r1:{ lo:null, hi:-5 } }, horizons:[5] }).episodes[0];
  assert.equal(none.fall.pct, 0);
  assert.equal(none.fall.days, 0);
  const late = C.study(frameOf([...flat(30), 94, 93]), { conditions:{ r1:{ lo:null, hi:-5 } }, horizons:[5] }).uncounted[0];
  assert.equal(late.fall.status, 'pending');
  assert.equal(late.fall.days, 1);
  const cut = C.study(frameOf([...flat(30), 94, 93, ...flat(10, 90)], {}, '2001-01-02', { 32:12 }), { conditions:{ r1:{ lo:null, hi:-5 } }, horizons:[5] }).uncounted[0];
  assert.equal(cut.fall.status, 'gap');
  near(cut.fall.pct, (93 / 94 - 1) * 100);
  for (const bad of [[7], [5, 5], []]) assert.throws(() => C.study(v, { conditions:{}, horizons:bad }), /后续期限/);
});

test('every matching day is its own sample, and selected short horizons read the next closes', () => {
  const closes = [...flat(30), 98, 96, 94, 95, 96, 97, 98, 99, 100], v = frameOf(closes);
  const r = C.study(v, { conditions:{ r1:{ lo:null, hi:-1 } }, horizons:[1, 2, 3, 4] });
  assert.deepEqual(r.episodes.map(e => e.index), [32, 31, 30]);
  for (const e of r.episodes) for (const h of [1, 2, 3, 4]) near(e.outcomes[h].pct, (closes[e.index + h] / closes[e.index] - 1) * 100);
  assert.equal(r.summary[1].n, 3);
  assert.deepEqual(Object.keys(r.summary), ['1', '2', '3', '4']);
});

test('a reference date moves the readings, the automatic match and the reference status', () => {
  const v = frameOf(wave(3000)), at = 2000;
  const fit = C.fit(v, { ref:at });
  assert.equal(fit.ref, at);
  assert.equal(fit.date, v.dates[at]);
  assert.ok(fit.added.length > 0);
  for (const step of fit.steps) if (step.band) assert.deepEqual(step.band, C.suggest(v, step.id, { ref:at }));
  const r = C.study(v, { conditions:fit.conditions, ref:at });
  assert.equal(r.reference.index, at);
  assert.equal(r.reference.date, v.dates[at]);
  assert.equal(r.reference.matches, true, 'each band is built around the reference reading');
  assert.ok(r.episodes.some(e => e.index === at), 'the reference close is one of the samples');
  assert.equal(r.reference.values.dd252, v.values.dd252[at]);
  for (const bad of [-1, 1.5, 3000]) assert.throws(() => C.study(v, { conditions:{}, ref:bad }), /参照日/);
  // Without a reference date the samples are the same; there is no reference status and no reading to preview a tick with.
  const plain = C.study(v, { conditions:fit.conditions, ref:null });
  assert.equal(plain.reference, null);
  assert.deepEqual(plain.episodes.map(e => e.date), r.episodes.map(e => e.date));
  assert.deepEqual(plain.summary, r.summary);
  for (const m of C.metrics) if (!m.choice && m.source !== 'obs' && !fit.conditions[m.id]) assert.equal(plain.previews[m.id], null, m.id);
  for (const id of fit.added) assert.deepEqual(plain.previews[id], r.previews[id], id);
  assert.equal(C.sessionOn(v, v.dates[at]), at);
  const saturday = new Date(v.dates[at] + 'T00:00:00Z');
  while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
  const index = C.sessionOn(v, saturday.toISOString().slice(0, 10));
  assert.ok(v.dates[index] < saturday.toISOString().slice(0, 10) && v.dates[index + 1] > saturday.toISOString().slice(0, 10));
  for (const bad of ['1900-01-01', 'bad', '2001-02-30']) assert.equal(C.sessionOn(v, bad), null, bad);
  assert.equal(C.sessionOn(v, '2999-01-01'), v.last);
});

test('with an observation period the comparison needs the prior close and a finished period', () => {
  const v = frameOf(wave(400), { wait:3 });
  assert.equal(C.study(v, { conditions:{ r1:{ lo:-100, hi:100 } }, horizons:[5] }).baseline[5].n, 391);
  assert.equal(C.study(frameOf(wave(400)), { conditions:{}, horizons:[5] }).baseline[5].n, 395);
});

test('old 指数大跌 links open the same study here', () => {
  assert.deepEqual(C.fromDropStudy(''), { market:'ndx', wait:2, basis:'close', era:'all',
    params:{ rNDays:10, ddNDays:63, dropsPct:5 }, conditions:{ r1:{ lo:null, hi:-5 }, recov:{ lo:0, hi:0 } } });
  const full = C.fromDropStudy('#drop-study?market=spx&threshold=7.5&wait=21&group=recovered&recovery=high&era=exclude_dotcom&cap=10&rebound=half' +
    '&repeat=first&trend=below&drawdown=correction&vol=high&peer=severe&low=hold&peakDays=126&peakMin=8&lossDays=5&lossMin=6');
  assert.deepEqual(full, { market:'spx', wait:21, basis:'high', era:'exclude_dotcom', params:{ rNDays:5, ddNDays:126, dropsPct:7.5 },
    conditions:{ r1:{ lo:-10, hi:-7.5 }, recov:{ lo:1, hi:1 }, rebound:{ lo:50, hi:100 }, drops:{ lo:0, hi:0 }, ma200p:{ lo:null, hi:0 },
      dd252p:{ lo:10, hi:20 }, vol21p:{ lo:30, hi:null }, peer1:{ lo:null, hi:-4 }, broke:{ lo:0, hi:0 }, ddN:{ lo:8, hi:null }, rN:{ lo:null, hi:-6 } } });
  for (const [id, range] of Object.entries(full.conditions)) assert.ok(C.validRange(id, range), id);
  assert.deepEqual(C.fromDropStudy('group=all&repeat=repeat&rebound=none&trend=above&peer=mild').conditions,
    { r1:{ lo:null, hi:-5 }, drops:{ lo:1, hi:null }, rebound:{ lo:null, hi:0 }, ma200p:{ lo:0, hi:null }, peer1:{ lo:-2, hi:0 } });
  // Values the old page refused fall back the way it did; a cap at or below the threshold matched nothing and is dropped.
  const odd = C.fromDropStudy('threshold=11&wait=1&group=x&cap=4&peakDays=1&peakMin=8&lossDays=5&lossMin=0&rebound=bogus&market=hk&recovery=open&era=none');
  assert.deepEqual(odd, C.fromDropStudy(''));
  assert.equal(C.fromDropStudy('threshold=3.125').conditions.r1.hi, -5);
  assert.equal(C.fromDropStudy('threshold=4&cap=4').conditions.r1.lo, null);
  // Its links left out day counts still at their defaults, so a bare threshold means 252 (peak) or 5 (loss) days.
  const bare = C.fromDropStudy('peakMin=10&lossMin=4');
  assert.deepEqual(bare.params, { rNDays:5, ddNDays:252, dropsPct:5 });
  assert.deepEqual([bare.conditions.ddN, bare.conditions.rN], [{ lo:10, hi:null }, { lo:null, hi:-4 }]);
  assert.equal(C.fromDropStudy('peakDays=126').conditions.ddN, undefined);
});
