const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const sum = values => values.reduce((a, b) => a + b, 0);
function fixture(config = {}, qqqPrice) {
  const days = Array.from({ length: 340 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
  const assets = ['USD', 'TQQQ', 'QQQ'].map(code => ({ id: 'us:' + code, code, name: code, market: 'us', kind: 'etf', currency: 'USD', status: 'available' }));
  const histories = Object.fromEntries(assets.map(a => [a.id, { schemaVersion: 1, id: a.id, currency: 'USD', basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: days.map((day, i) => [day, a.code === 'QQQ' ? (qqqPrice ? qqqPrice(i) : i < 260 ? 100 : i < 300 ? 70 : 110) : a.code === 'TQQQ' ? i < 270 ? 100 : i < 300 ? 200 : 100 : 100]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} }
  }]));
  return { days, catalog: { assets }, histories, config: { positions: [{ id: 'us:USD', weight: 30 }, { id: 'us:TQQQ', weight: 30 }], initial: 100, monthly: 0, currency: 'USD',
    years: 'custom', start: days[255], end: days.at(-1), rebalance: 'none', transactionFee: 0, feeBasis: 'net', initialMethod: 'qqq_bear_confirm', ...config } };
}
function run(input) { const r = P.simulate(input); assert.equal(r.error, undefined); return r; }
const timing = r => r.transactions.filter(t => t.reason.startsWith('qqq_timing_'));
function reconcile(input, r) {
  const ids = input.config.positions.filter(p => p.weight > 0).map(p => p.id), units = Object.fromEntries(ids.map(id => [id, 0]));
  const price = (id, day) => P.at(input.histories[id].series, day).value * (input.config.currency === 'CNY' ? P.at(input.fxHistory.series, day).value : 1);
  let cash = 0, contributed = 0;
  for (const row of r.curve) {
    cash += row.contributed - contributed; contributed = row.contributed;
    for (const e of r.taxEvents.filter(e => e.day === row.day && e.type === 'dividend')) units[e.id] -= e.tax / price(e.id, row.day);
    for (const t of r.transactions.filter(t => t.day === row.day)) {
      const delta = (t.side === 'buy' ? 1 : -1) * t.amount;
      units[t.id] += delta / price(t.id, t.day); cash -= delta + t.fee + t.tax;
    }
    close(row.cash, cash, 1e-6); close(row.grossValue, cash + sum(ids.map(id => units[id] * price(id, row.day))), 1e-6);
    assert.ok(row.riskReserve >= -1e-7 && row.riskReserve <= row.cash + 1e-7);
    close(row.value, row.grossValue - row.taxReserve, 1e-6);
  }
  close(r.contributed, contributed); close(r.tradeCost, sum(r.transactions.map(t => t.fee)), 1e-6);
}

test('twenty consecutive deep-bear closes exit next day; three recovery closes reenter next day', () => {
  const input = fixture(), r = run(input);
  assert.deepEqual(timing(r).map(t => [t.day, t.side, t.signalDay]), [[input.days[280], 'sell', input.days[279]], [input.days[303], 'buy', input.days[302]]]);
  assert.ok(timing(r).every(t => t.id === 'us:TQQQ'));
  assert.equal(r.qqqTimingChanges, 2); assert.equal(r.riskReserve, 0);
  assert.deepEqual(r.transactions.filter(t => t.day === r.start), run({ ...input, config: { ...input.config, initialMethod: 'lump_sum' } }).transactions.filter(t => t.day === r.start));
  assert.ok(r.qqqTimingEvents.every(e => e.sourceDay <= e.signalDay && e.signalDay < e.day));
  reconcile(input, r);
});

test('failed confirmation resets the count, 19 days do not exit, and exact20% drawdown qualifies', () => {
  const interrupted = fixture({}, i => i < 260 || i === 270 ? 100 : i < 300 ? 80 : 110);
  assert.equal(timing(run(interrupted))[0].day, interrupted.days[291]);
  const brief = fixture({}, i => i >= 260 && i < 279 ? 70 : 110);
  assert.equal(timing(run(brief)).length, 0);
  const recoveryReset = fixture({}, i => i < 260 ? 100 : i < 300 || i === 302 ? 70 : 110);
  assert.equal(timing(run(recoveryReset))[1].day, recoveryReset.days[306]);
});

test('sale net of fees and realized tax alone funds reentry, preserving original cash', () => {
  const input = fixture({ transactionFee: 1, tax: { usCapitalGains: 20, usDividend: 20 } });
  const r = run(input), [sale, buy] = timing(r), scale = 1 / 1.006;
  close(sale.amount, 60 * scale); assert.ok(sale.tax > 0);
  const net = sale.amount - sale.fee - sale.tax;
  close(buy.amount + buy.fee, net); close(r.cash, 40 * scale);
  close(r.curve.find(x => x.day === sale.day).riskReserve, net);
  close(r.contributed, 100); reconcile(input, r);
});

test('starting off parks the TQQQ initial budget including its unspent buy fee', () => {
  const input = fixture({ transactionFee: 1 }); input.config.start = input.days[285];
  const r = run(input), scale = 1 / 1.006, initial = r.transactions.filter(t => t.day === r.start);
  assert.deepEqual(initial.map(t => t.id), ['us:USD']);
  close(r.curve[0].riskReserve, 30 * scale * 1.01); close(r.curve[0].cash - r.curve[0].riskReserve, 40 * scale);
  close(timing(r)[0].amount + timing(r)[0].fee, r.curve[0].riskReserve);
  assert.equal(r.qqqTimingChanges, 1); reconcile(input, r);
});

test('arbitrary weights, income methods, currencies and periodic rebalance preserve the cash ledger', () => {
  for (const weights of [[35, 25], [60, 40], [15, 65]]) for (const rebalance of ['none', 'month']) for (const currency of ['USD', 'CNY']) {
    const input = fixture({ monthly: 20, rebalance, currency, transactionFee: .3, contributionMethod: 'dca_ma_contrarian', tax: { usCapitalGains: 20, usDividend: 20 } });
    input.config.positions.forEach((p, i) => { p.weight = weights[i]; });
    input.histories['us:TQQQ'].dividendEvidence.fractions[input.days[275]] = .01;
    if (currency === 'CNY') {
      input.catalog.fx = { id: 'fx:CNY', currency: 'CNY', status: 'available' };
      input.fxHistory = { schemaVersion: 1, id: 'fx:CNY', currency: 'CNY', basis: 'provider_adjusted_close', dividends: 'reinvested', first: input.days[0], asOf: input.days.at(-1), series: input.days.map((d, i) => [d, 7 + i / 1000]) };
    }
    const r = run(input); reconcile(input, r);
    assert.deepEqual(r.holdings.map(h => h.targetWeight), weights);
    const offDays = new Set(r.curve.filter(x => !x.qqqOn).map(x => x.day));
    assert.ok(!r.transactions.some(t => t.id === 'us:TQQQ' && t.side === 'buy' && offDays.has(t.day)));
    assert.ok(r.contributed > 100); assert.ok(r.dividendTax > 0);
    if (rebalance === 'month') {
      assert.ok(r.rebalances > 0);
      const balanceDays = new Set(r.transactions.filter(t => t.reason === 'rebalance').map(t => t.day));
      for (const p of r.curve.filter(p => !p.qqqOn && balanceDays.has(p.day))) {
        close(p.riskReserve, p.grossValue * weights[1] / 100, 1e-6);
        close(p.cash - p.riskReserve, p.grossValue * (100 - sum(weights)) / 100, 1e-6);
      }
    }
  }
});

test('a separately held QQQ and other positions retain their ordinary investment plan', () => {
  const input = fixture({ monthly: 20, transactionFee: .1 });
  input.config.positions = [{ id: 'us:USD', weight: 10 }, { id: 'us:TQQQ', weight: 30 }, { id: 'us:QQQ', weight: 15 }];
  const r = run(input);
  const untouched = r.transactions.filter(t => t.id !== 'us:TQQQ');
  assert.ok(untouched.every(t => t.side === 'buy' && ['initial', 'contribution'].includes(t.reason)));
  assert.deepEqual(r.holdings.map(h => h.targetWeight), [10, 30, 15]);
  reconcile(input, r);
});

test('off-period new income is added to risk cash and never finances another sleeve', () => {
  const input = fixture({ monthly: 20, transactionFee: 1 }); input.config.start = input.days[285];
  const r = run(input), recovery = timing(r)[0], offIncome = r.plan.income.filter(p => p.day < recovery.day);
  const expected = (100 + sum(offIncome.map(p => p.amount))) / 1.006 * .3 * 1.01;
  close(recovery.amount + recovery.fee, expected); reconcile(input, r);
});

test('liquidation date never buys a returning risk sleeve just to sell it', () => {
  const input = fixture({ tax: { liquidate: true } }); input.config.end = input.days[303];
  const r = run(input);
  assert.ok(!r.transactions.some(t => t.day === r.end && t.reason === 'qqq_timing_in'));
  assert.equal(r.riskReserve, 0); assert.ok(r.holdings.every(h => h.grossValue === 0)); reconcile(input, r);
});

test('history identity, proxy freshness, warmup and absent positive TQQQ fail explicitly', () => {
  let input = fixture(); input.config.positions[1].weight = 0;
  assert.match(P.simulate(input).error, /权重大于0的TQQQ/);
  input = fixture(); input.histories['us:QQQ'].currency = 'CNY'; assert.match(P.simulate(input).error, /身份或币种/);
  input = fixture(); input.config.start = input.days[200]; assert.match(P.simulate(input).error, /252个交易日预热/);
  input = fixture(); delete input.histories['us:QQQ']; assert.match(P.simulate(input).error, /身份或币种/);
  input = fixture(); input.histories['us:QQQ'].series = input.histories['us:QQQ'].series.slice(0, 300); input.histories['us:QQQ'].asOf = input.days[299]; assert.match(P.simulate(input).error, /前缺7日内/);
});

test('common-history first close uses strictly earlier warmed QQQ; subsequent signals use previous common close', () => {
  const input = fixture({ years: 'common' });
  for (const id of ['us:USD', 'us:TQQQ']) {
    const h = input.histories[id]; h.series = h.series.slice(255); h.first = h.series[0][0];
  }
  const r = run(input);
  assert.equal(r.start, input.days[255]); assert.equal(r.curve[0].qqqSignalDay, input.days[254]);
  const h = input.histories['us:USD']; h.series = h.series.filter(([d]) => d !== input.days[279]);
  const missingCommon = run(input);
  assert.equal(timing(missingCommon)[0].day, input.days[281]);
  assert.equal(timing(missingCommon)[0].signalDay, input.days[280]);
  const earlier = missingCommon.curve.find(r => r.day === input.days[280]);
  assert.equal(earlier.qqqSignalDay, input.days[278]); assert.equal(earlier.qqqOn, true);
  reconcile(input, missingCommon);
});

test('changing and appending future proxy or asset prices cannot rewrite earlier signals or account values', () => {
  const input = fixture({ monthly: 20, transactionFee: .2, tax: { usCapitalGains: 20, usDividend: 20 } }), before = run(input), cutoff = input.days[295];
  for (const h of Object.values(input.histories)) {
    h.series.filter(r => r[0] > cutoff).forEach(r => { r[1] *= 4; });
    h.series.push(['2024-12-06', 999]); h.asOf = '2024-12-06'; h.dividendEvidence.through = h.asOf;
  }
  const after = run(input);
  for (const key of ['curve', 'transactions', 'taxEvents', 'qqqTimingEvents']) assert.deepEqual(after[key].filter(r => r.day <= cutoff), before[key].filter(r => r.day <= cutoff));
  const copy = P.sanitizeDraft({ schemaVersion: 1, ...input.config }, new Set(input.catalog.assets.map(a => a.id)));
  assert.equal(copy.initialMethod, 'qqq_bear_confirm'); assert.deepEqual(copy.positions, input.config.positions);
});
