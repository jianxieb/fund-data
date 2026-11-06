'use strict';
// Reconcile displayed holding-state days with actual funding and transactions.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..'), sources = {};
const read = file => {
  const bytes = fs.readFileSync(path.join(root, file));
  sources[file] = crypto.createHash('sha256').update(bytes).digest('hex');
  return bytes.toString('utf8');
};
const text = read('data/portfolio/catalog.js');
const catalog = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;$/, ''));
const histories = Object.fromEntries(['us:USD', 'us:TQQQ', 'us:QQQ'].map(id => [id, JSON.parse(read(catalog.assets.find(a => a.id === id).historyUrl))]));
const fxHistory = JSON.parse(read(catalog.fx.historyUrl)), marketContext = JSON.parse(read('data/portfolio/entry-context.json'));
for (const file of ['assets/portfolio-model.js', 'assets/portfolio-systematic.js', 'assets/model.js']) read(file);
const P = require(path.join(root, 'assets/portfolio-model.js'));
const config = { positions: [{ id: 'us:USD', weight: 30 }, { id: 'us:TQQQ', weight: 30 }], currency: 'CNY',
  initial: 100000, monthly: 0, rebalance: 'none', transactionFee: .1, feeBasis: 'net', years: 'custom',
  start: '2014-01-02', end: '2024-01-02', contributionMethod: 'dca_month', tax: { usCapitalGains: 20, usDividend: 20, liquidate: false } };
const methods = ['lump_sum', 'vix_panic_reentry', 'dual_risk_guard', 'relative_strength_rotation'];
const results = methods.map(initialMethod => {
  const r = P.simulate({ catalog, histories, fxHistory, marketContext, config: { ...config, initialMethod } });
  assert.ok(!r.error, r.error);
  assert.equal(r.deposits, 1); assert.equal(r.contributed, config.initial); assert.deepEqual(r.plan.income, []);
  const daily = r.systematic?.daily || [], strategyTrades = r.transactions.filter(t => t.reason === initialMethod);
  const holdingDays = initialMethod === 'relative_strength_rotation' || !daily.length ? null : daily.filter(row => row.indicator === 100).length;
  const series = { method: initialMethod, start: r.start, end: r.end, deposits: r.deposits, contributed: r.contributed,
    initialPlan: r.plan.initial, incomePlan: r.plan.income, annualReturn: r.annualReturn, xirr: r.xirr, finalValue: r.value,
    commonDecisionDays: daily.length || null, holdingStateDays: holdingDays,
    holdingStatePercent: holdingDays === null ? null : 100 * holdingDays / daily.length,
    initialBuys: r.transactions.filter(t => t.reason === 'initial' && t.side === 'buy').length,
    strategyBuys: strategyTrades.filter(t => t.side === 'buy').length,
    strategySales: strategyTrades.filter(t => t.side === 'sell').length, transactions: r.transactions };
  if (initialMethod === 'vix_panic_reentry') {
    assert.equal(daily.length, 2517); assert.equal(holdingDays, 2501);
    assert.deepEqual(strategyTrades.map(t => [t.day, t.side]), [['2020-03-10', 'sell'], ['2020-04-01', 'buy']]);
    const exit = daily.find(row => row.day === '2020-03-09');
    assert.equal(exit.metadata.vixDecision.exitCountTested, 10);
    assert.equal(exit.metadata.vixDecision.exitTriggered, true);
    series.exitDecision = exit.metadata;
  }
  return series;
});
const result = { status: 'pass', scope: 'Holding-state codes are not buy-opportunity scores. Positive state days do not create deposits or daily orders. This audit reconciles state counts against the actual account ledger; it does not validate a buy-merit indicator.',
  formula: { vixStateCode: 'vixOn ? 100 : 0', dualStateCode: 'vixOn && qqqOn ? 100 : 0',
    rotationAllocation: 'mean of three retained phase allocations; not a buy-merit score',
    annualReturn: '100 * (finalCashFlowNeutralNAV ** (1 / years) - 1)',
    newBudgetPreview: 'pure allocation calculation; not inserted into historical cash flows' },
  config, sources, scriptSHA256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), results };
fs.writeFileSync(path.resolve(process.argv[2] || path.join(__dirname, 'state-claim-audit.json')), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, results: results.map(({ transactions, exitDecision, ...summary }) => summary) }));
