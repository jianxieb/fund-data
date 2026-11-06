'use strict';
// Run from any directory: node docs/research/portfolio-daily-20261106/verify-daily.cjs [output.json]
// The old engine is taken from the previously delivered, immutable research archive.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = {}, frozenSources = {};
const archive = 'docs/research/portfolio-methods-20261106/reproduction.tar.gz';
assert.equal(hash(path.join(root, archive)), 'a450134e9c8a02a7e6dab5cc0b97c21ce60581fd9b93e550febc8cc5b344e555');
sources[archive] = hash(path.join(root, archive));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'changheng-daily-baseline-'));
execFileSync('tar', ['-xzf', path.join(root, archive), '-C', temp, 'portfolio-methods-20261106/production']);
const frozenRoot = path.join(temp, 'portfolio-methods-20261106/production');
const read = file => { frozenSources[file] = hash(path.join(frozenRoot, file)); return fs.readFileSync(path.join(frozenRoot, file), 'utf8'); };
const json = file => JSON.parse(read(file));
const old = require(path.join(frozenRoot, 'assets/portfolio-model.js'));
const current = require(path.join(root, 'assets/portfolio-model.js'));
for (const f of ['assets/model.js', 'assets/portfolio-model.js', 'assets/portfolio-systematic.js']) sources[f] = hash(path.join(root, f));
const text = read('data/portfolio/catalog.js');
const catalog = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;$/, ''));
const files = {
  'us:USD': 'data/portfolio/us/USD-b2e099b598f25d1d.json',
  'us:TQQQ': 'data/portfolio/us/TQQQ-235126570a4b63be.json',
  'us:QQQ': 'data/portfolio/us/QQQ-2d88370080c88a85.json'
};
const histories = Object.fromEntries(Object.entries(files).map(([id, f]) => [id, json(f)]));
const fxHistory = json('data/portfolio/fx/CNY-5f1b9958db2b35db.json');
const marketContext = json('data/portfolio/entry-context.json');
const methods = ['vix_panic_reentry', 'relative_strength_rotation', 'dual_risk_guard'];
const origins = [['2011-10-03', '2021-10-04'], ['2014-01-02', '2024-01-02'], ['2010-11-01', '2025-11-03']];
const base = {
  currency: 'CNY', initial: 100000, monthly: 0, rebalance: 'none', transactionFee: .1,
  feeBasis: 'net', years: 'custom', contributionMethod: 'dca_month',
  tax: { usCapitalGains: 20, usDividend: 20, liquidate: false }
};
const cases = [];
for (const method of methods) for (const weights of [[30, 30], [50, 50], [20, 40]])
  for (const [start, end] of origins) for (const monthly of [0, 1000])
    cases.push({ ...base, start, end, monthly, initialMethod: method, positions: weights.map((weight, i) => ({ id: ['us:USD', 'us:TQQQ'][i], weight })) });
for (const method of methods) for (const extra of [{ rebalance: 'year' }, { initial: 0, monthly: 1000 }, { tax: { ...base.tax, liquidate: true } }])
  cases.push({ ...base, ...extra, initialMethod: method, start: origins[1][0], end: origins[1][1], positions: [{ id: 'us:USD', weight: 30 }, { id: 'us:TQQQ', weight: 30 }] });
const input = config => ({ catalog, histories, fxHistory, marketContext, config });
const check = (engine, config) => { const result = engine.simulate(input(config)); assert.ok(!result.error, result.error); return result; };
const records = [], began = performance.now();
let valuations = 0, transactions = 0, snapshots = 0, budgetQuotes = 0, prefixRows = 0;
try {
  for (const config of cases) {
    const a = check(old, config), b = check(current, config);
    // Compare every previously exposed result field except controller metadata.
    // No tolerance: daily reporting must not change even one financial value.
    for (const key of Object.keys(a).filter(key => key !== 'systematic')) assert.deepEqual(b[key], a[key], key + ': ' + config.initialMethod);
    valuations += b.curve.length; transactions += b.transactions.length;
    const daily = b.systematic.daily;
    assert.ok(daily.length > 2000);
    const days = new Set(daily.map(row => row.day));
    assert.equal(days.size, daily.length);
    assert.equal(daily[0].day, b.start);
    for (const row of daily) {
      assert.equal(row.trackingStart, b.start);
      assert.ok(row.day <= b.end);
      if (row.status === 'ready') {
        if (config.initialMethod === 'relative_strength_rotation') {
          assert.ok(row.indicators.every(i => i.value >= 0 && i.value <= 100));
          assert.ok(Math.abs(row.indicators.reduce((s, i) => s + i.value, 0) - 100) < 1e-10);
        } else assert.ok([0, 100].includes(row.indicator));
      }
      const quote = current.additionAllocation(row, 10000);
      if (row.status === 'missing' || row.status === 'liquidated') assert.equal(quote, null);
      else {
        assert.ok(quote);
        const total = quote.orders.reduce((s, o) => s + o.amount + o.fee, 0) + quote.parkedCash + quote.originalCash;
        assert.ok(Math.abs(total - 10000) < 1e-7);
        assert.ok(Math.abs(quote.total - total) < 1e-7);
        budgetQuotes++;
      }
    }
    snapshots += daily.length;
    records.push({ method: config.initialMethod, weights: config.positions.map(p => p.weight), start: b.start, end: b.end, monthly: config.monthly, initial: config.initial, rebalance: config.rebalance, liquidate: config.tax.liquidate, value: b.value, annualReturn: b.annualReturn, dailyRows: daily.length, transactions: b.transactions.length });
  }
  // Extend the same account's end date. Future observations must not rewrite any
  // already published snapshot or pending order (including the earlier final day).
  for (const method of methods) {
    const config = { ...cases.find(c => c.initialMethod === method && c.start === '2014-01-02'), end: '2026-10-30' };
    const full = check(current, config);
    for (const end of ['2019-12-31', '2020-03-09', '2020-03-31', '2022-06-30']) {
      const shorter = check(current, { ...config, end });
      const prefix = full.systematic.daily.filter(row => row.day <= shorter.end);
      assert.deepEqual(shorter.systematic.daily, prefix, 'fixed-start extension: ' + method + '/' + end);
      prefixRows += prefix.length;
    }
  }
  for (const [file, digest] of Object.entries(sources)) assert.equal(hash(path.join(root, file)), digest, 'source changed during audit: ' + file);
  const result = {
    status: 'pass', scope: 'Daily reporting and new-budget preview only. Exact financial invariance versus delivered engine; real 10/15-year accounts, editable weights, monthly funding, yearly rebalance, zero initial capital and liquidation. Fixed-start extensions preserve all past daily snapshots. This does not retest predictive performance or establish an optimal strategy.',
    sources, frozenSources, scriptSHA256: hash(__filename), accounts: records.length, valuations, transactions, snapshots, budgetQuotes, prefixRows,
    financialDifferences: 0, elapsedSeconds: (performance.now() - began) / 1000, records
  };
  const output = path.resolve(process.argv[2] || path.join(__dirname, 'verification.json'));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, records: records.length, sources: Object.keys(sources).length, output }));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
