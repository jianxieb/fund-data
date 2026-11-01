const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../scripts/research_portfolio_entry_scope.cjs');
const V2 = require('../scripts/research_portfolio_entry_predictive.cjs');
const parent = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-protocol-v1.json')));
const protocol = JSON.parse(fs.readFileSync(require.resolve('../docs/research/portfolio-entry-scope-audit-protocol-v1.json')));
const portfolio = parent.portfolio, rules = [{ id: V2.MODEL_ID }, ...protocol.strategy.benchmarks];
const candidate = rules[0], immediate = rules[1], base = { annualCashRate: 0, feeRate: 0, capitalTaxRate: 0, dividendTaxRate: 0 };
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
function market(start = '2020-01-01', end = '2023-12-31', fn = () => [100, 50]) {
  const rows = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) rows.push({ day: d.toISOString().slice(0, 10), prices: fn(rows.length) }); }
  return rows;
}
function preds(rows, decide = () => 5) {
  return rows.map((row, i) => ({ day: row.day, executionDay: row.day, featureDay: i ? rows[i - 1].day : null,
    trainingN: i ? 756 : 0, latestTrainingExit: i ? rows[i - 1].day : null, predictedY: i ? decide(i) === 5 ? .01 : -.01 : null, offset: i ? decide(i) : null }));
}
function episode(rows, indices = [1], endIndex = rows.length - 1) {
  return { evaluation: indices.length === 1 ? 'equal_age_lot' : 'twelve_deposit_account', years: 1, partition: 'all',
    startIndex: indices[0], start: rows[indices[0]].day, endIndex, end: rows[endIndex].day, lastFundingDay: rows[indices.at(-1)].day,
    anniversary: rows[endIndex].day, depositCount: indices.length, contributed: indices.length * 100,
    fundingPlan: indices.map(i => ({ index: i, day: rows[i].day, amount: 100 })) };
}
function sim(rows, rule = candidate, scenario = base, prediction = preds(rows), ep = episode(rows)) { return R.simulateFundingPlan(rows, ep, rule, scenario, portfolio, prediction, true); }
const allPartition = [{ id: 'all', start: null, end: null }];

test('nominal 1/10/20 funding rolls forward only inside that calendar month', () => {
  const rows = market('2024-06-01', '2024-06-30');
  assert.equal(R.buildArrivalSchedule(rows, 1)[0].day, '2024-06-03');
  assert.equal(R.buildArrivalSchedule(rows, 10)[0].day, '2024-06-10');
  assert.equal(R.buildArrivalSchedule(rows, 20)[0].day, '2024-06-20');
  assert.equal(R.buildArrivalSchedule(rows, 1)[0].requestedDay, '2024-06-01');
  assert.throws(() => R.buildArrivalSchedule(rows, 15));
});

test('missing calendar months are retained and never replaced with a close from the following month', () => {
  const rows = ['2024-01-02', '2024-01-25', '2024-03-01', '2024-03-25'].map(day => ({ day, prices: [1, 1] }));
  const result = R.buildArrivalSchedule(rows, 20); assert.equal(result.length, 3);
  assert.equal(result[0].day, '2024-01-25'); assert.equal(result[1].day, null); assert.equal(result[1].missing, 'no_common_close_remaining_in_month');
  assert.equal(result[2].day, '2024-03-25');
  const earlyEnd = R.buildArrivalSchedule(rows.slice(0, 3), 20); assert.equal(earlyEnd[2].missing, 'requested_date_after_data_end');
});

test('equal-age lot endpoint is anchored on funding, not delayed purchase', () => {
  const rows = market('2019-12-30', '2025-01-31'), predictions = preds(rows), schedule = R.buildArrivalSchedule(rows, 20);
  const result = R.buildScopeEpisodes(rows, schedule, predictions, allPartition, 'equal_age_lot', 1);
  const ep = result.episodes.find(e => e.start === '2020-06-22'); assert.ok(ep);
  assert.equal(ep.anniversary, '2021-06-22'); assert.equal(ep.end, '2021-06-22'); assert.equal(ep.lastFundingDay, ep.start);
  assert.equal(ep.fundingPlan.length, 1); assert.equal(ep.contributed, 100);
  const delay = sim(rows, candidate, base, predictions, ep), now = sim(rows, immediate, base, predictions, ep);
  assert.equal(delay.end, now.end); assert.ok(delay.trades.find(t => t.side === 'buy').day > ep.start);
});

test('twelve consecutive monthly deposits are exact and held until the last actual arrival anniversary', () => {
  const rows = market('2019-12-30', '2026-01-31'), predictions = preds(rows), schedule = R.buildArrivalSchedule(rows, 10);
  const result = R.buildScopeEpisodes(rows, schedule, predictions, allPartition, 'twelve_deposit_account', 3);
  const ep = result.episodes.find(e => e.start === '2020-01-10'); assert.ok(ep);
  assert.equal(ep.fundingPlan.length, 12); assert.equal(ep.fundingPlan.at(-1).day, '2020-12-10');
  assert.equal(ep.anniversary, '2023-12-10'); assert.equal(ep.end, '2023-12-11'); assert.equal(ep.contributed, 1200);
  assert.ok(ep.fundingPlan.every((p, i) => p.day.slice(0, 7) === `2020-${String(i + 1).padStart(2, '0')}`));
  const account = sim(rows, candidate, base, predictions, ep);
  assert.equal(account.externalFlows.length, 12); assert.equal(account.contributed, 1200); close(account.terminalWealth, 1200);
  assert.ok(account.trades.filter(t => t.side === 'sell').every(t => t.day === ep.end));
  assert.equal(account.contributionAttribution.length, 12);
});

test('missing one required month or prediction excludes the whole twelve-deposit comparison', () => {
  const rows = market('2019-12-30', '2024-01-31').filter(r => !r.day.startsWith('2020-06'));
  const predictions = preds(rows), schedule = R.buildArrivalSchedule(rows, 1);
  const result = R.buildScopeEpisodes(rows, schedule, predictions, allPartition, 'twelve_deposit_account', 1);
  assert.ok(result.rejected.some(r => r.start === '2020-01-01' && r.reason === 'required_funding_date_missing'));
  assert.ok(!result.episodes.some(e => e.start === '2020-01-01'));
  const complete = market('2019-12-30', '2024-01-31'), ps = preds(complete), sc = R.buildArrivalSchedule(complete, 1);
  ps[sc.find(r => r.month === '2020-06').index].predictedY = null;
  const missing = R.buildScopeEpisodes(complete, sc, ps, allPartition, 'twelve_deposit_account', 1);
  assert.ok(missing.rejected.some(r => r.start === '2020-01-01' && r.reason === 'prediction_unavailable_on_funding_date'));
});

test('complete outcome purging remains strict and rejection counts are mutually exclusive', () => {
  const rows = market('2019-12-30', '2024-01-31'), schedule = R.buildArrivalSchedule(rows, 1), predictions = preds(rows);
  const partitions = [{ id: 'early', start: null, end: '2021-12-31' }, { id: 'late', start: '2022-01-01', end: null }];
  const result = R.buildScopeEpisodes(rows, schedule, predictions, partitions, 'twelve_deposit_account', 1);
  assert.ok(result.rejected.some(r => r.start === '2021-01-01' && r.reason === 'complete_outcome_crosses_partition'));
  assert.equal(result.attemptedStartMonths, result.episodes.length + result.rejected.length);
  assert.equal(Object.values(result.excluded).reduce((a, b) => a + b, 0), result.rejected.length);
  for (const ep of result.episodes) { const p = partitions.find(p => p.id === ep.partition); assert.ok(!p.end || ep.end <= p.end); }
});

test('leap anniversary clamps and an excessively late terminal quote is not silently accepted', () => {
  const rows = ['2024-02-28', '2024-02-29', '2025-02-28', '2027-02-28'].map(day => ({ day, prices: [1, 1] }));
  const schedule = [{ month: '2024-02', requestedDay: '2024-02-20', day: '2024-02-29', index: 1, missing: null }];
  const result = R.buildScopeEpisodes(rows, schedule, preds(rows), allPartition, 'equal_age_lot', 1);
  assert.equal(result.episodes[0].anniversary, '2025-02-28'); assert.equal(result.episodes[0].end, '2025-02-28');
  const late = [rows[0], rows[1], { day: '2025-03-20', prices: [1, 1] }];
  const missed = R.buildScopeEpisodes(late, schedule, preds(late), allPartition, 'equal_age_lot', 1);
  assert.equal(missed.rejected[0].reason, 'terminal_close_more_than_14_calendar_days_late');
});

test('flat paths reconcile forty strategic cash, actual units, and both fee sides', () => {
  const rows = market('2020-01-01', '2020-01-20'), fee = .001, result = sim(rows, candidate, { ...base, feeRate: fee });
  close(result.terminalWealth, 40 + 60 * .999 / 1.001); close(result.fees, 100 - result.terminalWealth);
  close(result.contributionAttribution[0].strategicCash, 40);
  const lot = result.contributionAttribution[0].scheduledPurchases[0];
  close(lot.units[0], 30 / 1.001 / 100); close(lot.units[1], 30 / 1.001 / 50);
  close(lot.buyFees + lot.sellFees, result.fees); close(result.contributionAttribution[0].terminalWealth, result.terminalWealth);
});

test('each deposit uses its own arrival prediction and later updates cannot alter that order', () => {
  const rows = market('2020-01-01', '2020-04-30'), ps = preds(rows, () => 0), indices = [1, 23];
  ps[1].predictedY = .01; ps[1].offset = 5;
  const result = sim(rows, candidate, base, ps, episode(rows, indices)), buys = result.trades.filter(t => t.side === 'buy');
  assert.ok(buys.filter(t => t.arrivalDay === rows[1].day).every(t => t.day === rows[6].day && t.featureDay === rows[0].day));
  assert.ok(buys.filter(t => t.arrivalDay === rows[23].day).every(t => t.day === rows[23].day && t.featureDay === rows[22].day));
  assert.ok(result.curve.filter(p => p.day < rows[23].day).every(p => p.contributed === 100 && p.value <= 100 + 1e-8));
  const corrupt = structuredClone(ps); corrupt[1].featureDay = rows[1].day;
  assert.throws(() => sim(rows, candidate, base, corrupt, episode(rows, indices)), /strictly prior/);
});

test('two-asset price paths give hand-calculable terminal lots rather than reference NAV units', () => {
  const rows = market('2020-01-01', '2020-01-15'); rows.forEach(r => { r.prices = [100, 100]; });
  rows[6].prices = [50, 200]; const result = sim(rows);
  close(result.terminalWealth, 115); assert.deepEqual(result.contributionAttribution[0].scheduledPurchases[0].units, [.6, .15]);
});

test('waiting interest begins at actual funding and per-arrival attribution includes all cash interest', () => {
  const rows = market('2024-06-01', '2024-06-30'), ep = episode(rows, [0], 3);
  const result = sim(rows, { id: 'fixed_delay5', offsets: [5] }, { ...base, annualCashRate: .02 }, preds(rows), ep);
  const factor = 1.02 ** (3 / 365.2425); // June 3 actual close, not June 1 nominal date.
  close(result.terminalWealth, 100 * factor); close(result.pendingCash, 60 * factor);
  close(result.contributionAttribution[0].strategicCash, 40 * factor); close(result.contributionAttribution[0].interest, 100 * (factor - 1));
  assert.equal(result.trades.length, 0);
});

test('three tranches preserve independent cash interest and exact scheduled execution', () => {
  const rows = market('2020-01-01', '2020-04-30'), ep = episode(rows), scenario = { ...base, annualCashRate: .02 }, result = sim(rows, rules[3], scenario);
  const factor = i => 1.02 ** ((Date.parse(rows[i].day) - Date.parse(rows[1].day)) / 86400000 / 365.2425);
  close(result.terminalWealth, 40 * factor(ep.endIndex) + 20 + 20 * factor(22) + 20 * factor(43));
  const lots = result.contributionAttribution[0].scheduledPurchases;
  assert.deepEqual(lots.map(l => l.executedDay), [rows[1].day, rows[22].day, rows[43].day]);
  assert.equal(lots.length, 3); close(result.fees, 0);
});

test('all base and stress accounts have identical flows and immutable action dates', () => {
  const rows = market('2020-01-01', '2021-12-31', i => [100 * Math.exp(i / 1000), 50 * Math.exp(Math.sin(i / 31) / 10)]);
  const ps = preds(rows, i => i % 2 ? 5 : 0), schedule = R.buildArrivalSchedule(rows, 10), indices = schedule.slice(0, 12).map(s => s.index), ep = episode(rows, indices);
  const all = parent.scenarios.map(s => sim(rows, candidate, s, ps, ep));
  const actions = r => r.trades.filter(t => t.side === 'buy').map(({ day, id, arrivalDay, offset, predictedY }) => ({ day, id, arrivalDay, offset, predictedY }));
  for (const result of all) {
    assert.equal(result.contributed, 1200); assert.deepEqual(result.externalFlows, all[0].externalFlows); assert.deepEqual(actions(result), actions(all[0]));
    close(result.contributionAttribution.reduce((s, a) => s + a.terminalWealth, 0), result.terminalWealth);
    close(result.contributionAttribution.reduce((s, a) => s + a.fees, 0), result.fees);
    close(result.contributionAttribution.reduce((s, a) => s + a.interest, 0), result.interest);
  }
});

test('future price mutations and appended rows cannot change past cash-flow or trade prefixes', () => {
  const rows = market('2020-01-01', '2020-04-30'), ps = preds(rows), ep = episode(rows, [1, 23]), original = sim(rows, candidate, base, ps, ep), cutoff = 35;
  const changed = structuredClone(rows); changed.slice(cutoff + 1).forEach(r => { r.prices = [1e6, .001]; });
  const after = sim(changed, candidate, base, ps, ep);
  assert.deepEqual(after.trades.filter(t => t.day <= rows[cutoff].day), original.trades.filter(t => t.day <= rows[cutoff].day));
  assert.deepEqual(after.curve.slice(0, cutoff), original.curve.slice(0, cutoff));
  const appended = [...rows, ...market('2020-05-01', '2020-05-31')];
  assert.deepEqual(sim(appended, candidate, base, [...ps, ...preds(appended).slice(rows.length)], ep), original);
});

test('terminal-day execution precedes liquidation and pending later orders never move to terminal', () => {
  const rows = market('2020-01-01', '2020-01-20'), ps = preds(rows);
  const due = sim(rows, candidate, { ...base, feeRate: .001 }, ps, episode(rows, [1], 6));
  assert.deepEqual(due.trades.map(t => t.side), ['buy', 'buy', 'sell', 'sell']); assert.ok(due.trades.every(t => t.day === rows[6].day));
  close(due.terminalWealth, 40 + 60 * .999 / 1.001);
  const early = sim(rows, candidate, base, ps, episode(rows, [1], 5)); assert.equal(early.trades.length, 0); close(early.pendingCash, 60);
  assert.equal(early.contributionAttribution[0].scheduledPurchases[0].scheduledDay, rows[6].day);
});

test('repeated arrival decisions are counted once with explicit occurrence counts', () => {
  const rows = market('2020-01-01', '2020-04-30'), ps = preds(rows, i => i === 23 ? 5 : 0);
  const a = episode(rows, [1, 23]), b = episode(rows, [23, 43]), d = R.decisionCoverage([a, b], ps);
  assert.equal(d.uniqueArrivalDecisions, 3); assert.equal(d.delayedUniqueDecisions, 1);
  assert.equal(d.dates.find(r => r.day === rows[23].day).occurrencesInAccounts, 2);
});

function fakeAccount(i, wealth = 100) { return { start: `${2000 + i}-01-01`, end: `${2000 + i}-12-31`, terminalWealth: wealth, contributed: 100, accountReturnPp: wealth - 100,
  maxDrawdownPp: 0, meanWaitSessions: 0, fees: 0, interest: 0, pendingCash: 0, externalFlows: [{ day: `${2000 + i}-01-01`, amount: 100 }] }; }
test('descriptive blocks scale with equal-age or full twelve-deposit account span', () => {
  for (const [evaluation, years, block] of [['equal_age_lot', 1, 12], ['equal_age_lot', 3, 36], ['twelve_deposit_account', 1, 24], ['twelve_deposit_account', 3, 48]]) {
    const a = Array.from({ length: block }, (_, i) => fakeAccount(i, 101)), b = a.map((_, i) => fakeAccount(i));
    const result = R.pairedSummary(a, b, evaluation, years); assert.equal(result.meanInterval.blockLength, block); assert.equal(result.meanInterval.status, 'insufficient_blocks'); close(result.meanDeltaPp, 1);
    a.push(fakeAccount(block, 101)); b.push(fakeAccount(block)); assert.equal(R.pairedSummary(a, b, evaluation, years).meanInterval.status, 'descriptive');
  }
  assert.equal(R.pairedSummary([], [], 'equal_age_lot', 1).meanInterval.status, 'no_samples');
});

test('all 108 registered result cells are present, including empty cells, without selection or refitting', () => {
  const rows = market('2020-01-01', '2020-04-30'), ps = preds(rows), before = JSON.stringify(ps);
  const result = R.evaluateScope(rows, ps, parent, rules, { protocol });
  assert.equal(result.results.length, 108); assert.equal(result.coverage.length, 12); assert.equal(result.pairedBaseWindows.length, 0);
  assert.ok(result.results.every(r => r.rules.length === 4 && r.rules.every(x => x.summary.n === 0 && x.vsImmediate.meanInterval.status === 'no_samples')));
  assert.equal(JSON.stringify(ps), before); assert.ok(!Object.hasOwn(result, 'selectedRule')); assert.ok(!Object.hasOwn(result, 'integrationPassed'));
});
