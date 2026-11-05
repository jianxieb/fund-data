const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const P = require('../assets/portfolio-model.js');
const E = require('../assets/portfolio-entry-model.js');

// Use the actual published histories, not a synthetic lookalike or a research
// directory in /tmp. The independent accounting below remains valid when a data
// refresh adjusts historical prices or appends new observations.
const root = path.resolve(__dirname, '..');
const catalogText = fs.readFileSync(path.join(root, 'data/portfolio/catalog.js'), 'utf8');
const catalog = JSON.parse(catalogText.slice(catalogText.indexOf('=') + 1).trim().replace(/;$/, ''));
const ids = ['us:USD', 'us:TQQQ'];
const assets = ids.map(id => catalog.assets.find(a => a.id === id));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const histories = Object.fromEntries(assets.map(a => [a.id, read(a.historyUrl)]));
const fxHistory = read(catalog.fx.historyUrl);
const entryContext = read('data/portfolio/entry-context.json');
const raw = ids.map(id => histories[id].series);
const DAYS = 86400000;
const epoch = day => Date.parse(day + 'T00:00:00Z');
const distance = (a, b) => (epoch(b) - epoch(a)) / DAYS;
const sum = values => values.reduce((a, b) => a + b, 0);
const close = (a, b, tolerance = 1e-8) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function quote(rows, day, maxDays = 14) {
  let left = 0, right = rows.length;
  while (left < right) { const mid = (left + right) >> 1; if (rows[mid][0] <= day) left = mid + 1; else right = mid; }
  const row = rows[left - 1];
  assert.ok(row && distance(row[0], day) <= maxDays, `No usable actual quote at ${day}`);
  return row[1];
}
const otherDates = new Set(raw[1].map(r => r[0]));
const common = raw[0].map(r => r[0]).filter(day => otherDates.has(day) && day >= fxHistory.first && day <= fxHistory.asOf);
const commonIndex = new Map(common.map((day, i) => [day, i]));
const allDates = [...new Set([...raw.flatMap(rows => rows.map(r => r[0])), ...fxHistory.series.map(r => r[0])])].sort();
const pricesAt = day => raw.map(rows => quote(rows, day) * quote(fxHistory.series, day, 7));
const features = E.buildFeatures({ dates: common, prices: common.map(pricesAt), weights: [.3, .3], context: entryContext });
const defaults = { positions: ids.map(id => ({ id, weight: 30 })), currency: 'CNY', initial: 100, monthly: 0,
  years: 'custom', rebalance: 'none', feeBasis: 'net', transactionFee: .1, tax: { liquidate: false } };
const windows = [
  ['2011-09-01', '2021-09-01'],
  ['2014-01-02', '2024-01-02'],
  ['2016-11-01', '2026-11-02']
];
function simulate(method, start = windows[1][0], end = windows[1][1], options = {}) {
  return P.simulate({ catalog, histories, fxHistory, entryContext, ...options,
    config: { ...defaults, initialMethod: method, start, end, ...options.config } });
}
function expectedPlan(method, start, end, initial = 100) {
  const days = common.filter(day => day >= start && day <= end);
  const months = days.filter((day, i) => !i || day.slice(0, 7) !== days[i - 1].slice(0, 7)).slice(0, 12);
  const scores = months.map(day => {
    const signalDate = common[commonIndex.get(day) - 1];
    return E.scores(features.byDate[signalDate]).methods[method].signal0to1;
  });
  // Closed-form running maxima, separate from the production plan allocator.
  const release = scores.map((score, i) => Math.max((i + 1) / 12, ...scores.slice(0, i + 1).map(s => s ?? 0)) * initial);
  return months.flatMap((day, i) => {
    const amount = release[i] - (release[i - 1] || 0);
    return amount > initial * 1e-12 ? [{ day, amount }] : [];
  });
}
function independentAccount(start, end, plan, feePct = .1, initial = 100, liquidate = false) {
  // Each release independently purchases two claims. No production ledger,
  // portfolio valuation, or rebalancing helpers are called here.
  const fee = feePct / 100;
  const claims = plan.map(order => ({ ...order, spent: order.amount * .6 / (1 + .6 * fee),
    units: pricesAt(order.day).map(p => order.amount * .3 / (1 + .6 * fee) / p) }));
  const dates = allDates.filter(day => day >= start && day <= end);
  let peak = initial, mdd = 0;
  const curve = dates.map(day => {
    const executed = claims.filter(c => c.day <= day), prices = pricesAt(day);
    const units = [0, 1].map(j => sum(executed.map(c => c.units[j])));
    const invested = sum(executed.map(c => c.spent));
    const purchaseFees = invested * fee;
    const marked = sum(units.map((u, j) => u * prices[j]));
    const exitFee = liquidate && day === end ? marked * fee : 0;
    const cash = initial - invested - purchaseFees + (liquidate && day === end ? marked - exitFee : 0);
    const value = initial - invested - purchaseFees + marked - exitFee;
    peak = Math.max(peak, value); mdd = Math.min(mdd, (value / peak - 1) * 100);
    return { day, value, cash, initialReserve: initial - sum(executed.map(c => c.amount)),
      fees: purchaseFees + exitFee, drawdown: (value / peak - 1) * 100 };
  });
  const last = curve.at(-1);
  return { ...last, curve, mdd, annualReturn: ((last.value / initial) ** (365.2425 / distance(start, end)) - 1) * 100 };
}

test('published sources are genuine adjusted USD ETF histories with usable CNY and paired option inputs', () => {
  for (const asset of [...assets, catalog.fx]) {
    const bytes = fs.readFileSync(path.join(root, asset.historyUrl));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
  assert.equal(common[0], '2010-02-11');
  assert.ok(common.length >= 4206);
  for (const id of ids) { assert.equal(histories[id].currency, 'USD'); assert.equal(histories[id].dividends, 'reinvested'); }
  assert.equal(entryContext.schemaVersion, 1);
  assert.ok(entryContext.series.length >= 4200);
  for (const [start, end] of windows) { assert.ok(commonIndex.has(start)); assert.ok(commonIndex.has(end)); }
});

test('four production methods match independent funding, execution and daily FX risk over three real ten-year windows', () => {
  for (const [start, end] of windows) for (const method of E.methods) {
    const result = simulate(method.id, start, end);
    assert.equal(result.error, undefined, `${method.id} ${start}: ${result.error}`);
    const plan = expectedPlan(method.id, start, end);
    const expected = independentAccount(start, end, plan);
    assert.deepEqual(result.plan.initial.map(p => p.day), plan.map(p => p.day));
    result.plan.initial.forEach((p, i) => close(p.amount, plan[i].amount));
    close(sum(result.plan.initial.map(p => p.amount)), 100);
    close(result.contributed, 100); assert.equal(result.deposits, 1);
    assert.equal(result.plan.income.length, 0); assert.equal(result.rebalances, 0);
    close(result.initialReserve, 0); close(result.cash, 40 / 1.0006);
    close(result.tradeCost, 100 * .0006 / 1.0006);
    close(result.value, expected.value); close(result.annualReturn, expected.annualReturn);
    close(result.mdd, expected.mdd); close(result.cash, expected.cash);
    assert.deepEqual(result.curve.map(p => p.day), expected.curve.map(p => p.day));
    result.curve.forEach((p, i) => {
      close(p.value, expected.curve[i].value); close(p.drawdown, expected.curve[i].drawdown);
      close(p.cash, expected.curve[i].cash); close(p.initialReserve, expected.curve[i].initialReserve);
      assert.ok(p.cash >= p.initialReserve - 1e-8);
    });
    // Both legs use their actual same-day close; the score uses the prior close.
    assert.equal(result.transactions.length, plan.length * 2);
    result.entryPlan.decisions.forEach(d => assert.equal(d.signalDate, common[commonIndex.get(d.day) - 1]));
    result.transactions.forEach(t => {
      assert.equal(t.side, 'buy'); assert.ok(commonIndex.has(t.day));
      close(t.fee, t.amount * .001);
      const release = plan.find(p => p.day === t.day);
      close(t.amount, release.amount * .3 / 1.0006);
    });
    assert.deepEqual(result.entryOpportunity.methods, E.scores(features.byDate[end]).methods);
    assert.equal(result.entryOpportunity.asOf, end);
  }
});

test('ten basis points reduce purchases rather than add funding; liquidation charges both actual sales', () => {
  const [start, end] = windows[1];
  for (const method of E.methods) {
    const zero = simulate(method.id, start, end, { config: { transactionFee: 0 } });
    const paid = simulate(method.id, start, end);
    close(paid.value, zero.value / 1.0006); close(paid.contributed, zero.contributed);
    assert.deepEqual(paid.entryPlan, zero.entryPlan);
  }
  const sold = simulate('entry_composite', start, end, { config: { tax: { liquidate: true } } });
  assert.equal(sold.error, undefined);
  const expected = independentAccount(start, end, expectedPlan('entry_composite', start, end), .1, 100, true);
  close(sold.value, expected.value); close(sold.cash, expected.value); close(sold.tradeCost, expected.fees); close(sold.mdd, expected.mdd);
  const sales = sold.transactions.filter(t => t.side === 'sell');
  assert.equal(sales.length, 2); assert.ok(sales.every(t => t.day === end && t.reason === 'liquidation'));
  assert.ok(sold.holdings.every(h => Math.abs(h.value) < 1e-8));
});

test('principal scale and separate monthly deposits cannot change the initial-principal signal or release percentages', () => {
  const original = simulate('entry_composite');
  const scaled = simulate('entry_composite', undefined, undefined, { config: { initial: 100000 } });
  const added = simulate('entry_composite', undefined, undefined, { config: { monthly: 50 } });
  assert.equal(scaled.error, undefined); assert.equal(added.error, undefined);
  close(scaled.value, original.value * 1000, 1e-6); close(scaled.mdd, original.mdd);
  assert.deepEqual(scaled.entryOpportunity, original.entryOpportunity);
  assert.deepEqual(added.entryOpportunity, original.entryOpportunity);
  assert.deepEqual(added.entryPlan, original.entryPlan);
  close(added.contributed, 100 + 50 * added.plan.income.length);
  scaled.plan.initial.forEach((order, i) => { assert.equal(order.day, original.plan.initial[i].day); close(order.amount, original.plan.initial[i].amount * 1000); });
  // This verifies execution isolation, not research validation of a contribution
  // strategy: the historical equal-principal study had no later deposits.
});

test('absent VIX uses exactly the 12-month baseline for dependent methods and preserves the other two', () => {
  const options = { entryContext: undefined };
  const baseline = simulate('tranche_12', undefined, undefined, options);
  for (const id of ['entry_option', 'entry_composite']) {
    const result = simulate(id, undefined, undefined, options);
    assert.equal(result.error, undefined); close(result.value, baseline.value); close(result.mdd, baseline.mdd);
    assert.equal(result.entryPlan.coverage.availableMonths, 0);
    assert.equal(result.entryPlan.decisions.length, 12);
    assert.equal(result.entryOpportunity.methods[id].available, false);
    assert.ok(result.entryOpportunity.methods[id].missingReasons.some(r => r.code === 'missing_vix_source'));
    assert.deepEqual(result.plan.initial.map(p => p.day), baseline.plan.initial.map(p => p.day));
    result.plan.initial.forEach(p => close(p.amount, 100 / 12));
  }
  for (const id of ['entry_volatility', 'entry_breadth']) {
    const result = simulate(id, undefined, undefined, options);
    assert.equal(result.entryPlan.coverage.availableMonths, 12);
    assert.deepEqual(result.plan.initial, simulate(id).plan.initial);
  }
});

test('changing or truncating future prices, FX and option observations cannot change existing plans and valuations', () => {
  const cutoff = '2014-07-01', start = windows[1][0], end = windows[1][1];
  const changedHistories = Object.fromEntries(ids.map((id, j) => [id, { ...histories[id],
    series: histories[id].series.map(([day, value]) => [day, day > cutoff ? value * (j + 2) : value]) }]));
  const changedFx = { ...fxHistory, series: fxHistory.series.map(([day, value]) => [day, day > cutoff ? value * 1.5 : value]) };
  const changedContext = { ...entryContext, series: entryContext.series.map(row => row[0] > cutoff ? [row[0], 99, 11] : row) };
  const truncate = history => {
    const series = history.series.filter(r => r[0] <= cutoff);
    return { ...history, series, asOf: series.at(-1)[0] };
  };
  for (const method of E.methods) {
    const original = simulate(method.id, start, end);
    const changed = simulate(method.id, start, end, { histories: changedHistories, fxHistory: changedFx, entryContext: changedContext });
    const truncated = simulate(method.id, start, cutoff, { histories: Object.fromEntries(ids.map(id => [id, truncate(histories[id])])),
      fxHistory: truncate(fxHistory), entryContext: { ...entryContext, series: entryContext.series.filter(r => r[0] <= cutoff) } });
    assert.equal(changed.error, undefined); assert.equal(truncated.error, undefined);
    const prefix = list => list.filter(p => p.day <= cutoff);
    assert.deepEqual(prefix(changed.plan.initial), prefix(original.plan.initial));
    assert.deepEqual(truncated.plan.initial, prefix(original.plan.initial));
    assert.deepEqual(prefix(changed.curve), prefix(original.curve));
    assert.deepEqual(truncated.curve, prefix(original.curve));
    assert.deepEqual(truncated.entryOpportunity.methods, E.scores(features.byDate[cutoff]).methods);
    assert.ok(truncated.entryPlan.remaining > 0);
  }
});

test('research methods reject unsupported account scope while ordinary methods remain available without a score', () => {
  for (const config of [{ currency: 'USD' }, { rebalance: 'month' }, { feeBasis: 'gross_estimate' },
    { positions: [{ id: 'us:USD', weight: 40 }, { id: 'us:TQQQ', weight: 20 }] }]) {
    for (const method of E.methods) assert.ok(simulate(method.id, undefined, undefined, { config }).error);
    const result = simulate('tranche_12', undefined, undefined, { config });
    assert.equal(result.error, undefined); assert.equal(result.entryOpportunity, null); assert.equal(result.entryPlan, null);
  }
});

test('common-history first day has no prior signal and still starts a funded 12-month schedule', () => {
  const result = simulate('entry_composite', common[0], '2010-05-03');
  assert.equal(result.error, undefined);
  assert.equal(result.entryPlan.decisions[0].signalDate, null);
  assert.equal(result.entryPlan.decisions[0].score, null);
  close(result.plan.initial[0].amount, 100 / 12);
  close(result.contributed, 100); assert.ok(result.initialReserve > 0);
});
