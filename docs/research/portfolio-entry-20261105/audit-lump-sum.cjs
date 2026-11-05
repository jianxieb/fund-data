#!/usr/bin/env node
'use strict';
// Independent replay of the archived buy schedules. No production model,
// archived research executable, external source, or original /tmp path is used.
const fs = require('node:fs'), path = require('node:path');
const zlib = require('node:zlib'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const here = __dirname, args = process.argv.slice(2);
assert(args.length <= 1 && (!args.length || ['--write', '--check'].includes(args[0])), 'Use --write or --check');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json')));
const bytes = fs.readFileSync(path.join(here, 'evidence.json.gz'));
assert.equal(sha(bytes), manifest.archiveSHA256);
const archive = JSON.parse(zlib.gunzipSync(bytes));
function read(name) {
  const text = archive.files[name];
  assert.equal(sha(text), archive.sha256[name], name);
  return JSON.parse(text);
}
function csv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else if (c !== '\r' || quoted) cell += c;
  }
  assert(!quoted && !row.length && !cell, 'CSV must end in a complete row');
  const header = rows.shift();
  return rows.map(values => { assert.equal(values.length, header.length); return Object.fromEntries(header.map((key, i) => [key, values[i]])); });
}
const inputCsv = fs.readFileSync(path.join(here, 'buy-method-results.csv'));
assert.equal(sha(inputCsv), archive.sha256['grid-results.csv']);
const grid = csv(inputCsv.toString('utf8'));
assert.equal(grid.length, 5136);
const features = read('features.json').rows;
const featureIndex = new Map(features.map((r, i) => [r.entry, i]));
const prices = new Map(read('holdouts.json').daily);
const baseline = read('system-baselines.json');
const origins = baseline.rows.filter(r => r.method === 'lump_sum' && r.years === 10 && r.start >= '2014' && r.start < '2017');
assert.equal(origins.length, 35);
const baselineByKey = new Map(baseline.rows.map(r => [r.start + '|' + r.years + '|' + r.method, r]));
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
function yearMean(rows, field) {
  const grouped = new Map();
  for (const r of rows) { const year = r.start.slice(0, 4); if (!grouped.has(year)) grouped.set(year, []); grouped.get(year).push(r[field]); }
  return mean([...grouped.values()].map(mean));
}
function compare(rows) {
  const pairs = rows.map(r => {
    const b = baselineByKey.get(r.start + '|10|lump_sum');
    assert(b && b.end === r.end, 'Same actual origin and maturity required');
    return { start: r.start, delta: r.annualReturn - b.annualReturn };
  });
  return { n: pairs.length, yearEqualCAGRpp: yearMean(pairs, 'delta'),
    wins: pairs.filter(r => r.delta > 1e-9).length, ties: pairs.filter(r => Math.abs(r.delta) <= 1e-9).length,
    losses: pairs.filter(r => r.delta < -1e-9).length };
}
function score(row, rule) {
  const d = row[rule.anchor], values = rule.extras.map(k => row[k]);
  if (d == null || values.some(v => v == null)) return null;
  const f = mean(values);
  return rule.blend === 'linear' ? (1 - rule.weight) * d + rule.weight * f : d ** (1 - rule.weight) * f ** rule.weight;
}
function account(origin, rule) {
  const index = featureIndex.get(origin.start), first = score(features[index], rule);
  if (first === null) return null; // Match this archived CSV's explicitly eligible starting cohort.
  let released = 0, shares = [0, 0], invested = 0; const hit = new Set();
  const count = rule.adapter === 'score_ladder' ? 37 : 12;
  for (let m = 0; m < count; m++) {
    const row = features[index + m];
    assert(row && row.signal < row.entry && row.entry <= origin.end);
    const s = score(row, rule); let fraction;
    if (rule.adapter === 'score_ladder') {
      fraction = m === 0 ? .25 : 0;
      if (s !== null) for (const threshold of [.6, .75, .9]) if (s >= threshold && !hit.has(threshold)) { fraction += .25; hit.add(threshold); }
      if (m === 36) fraction = 1 - released;
      fraction = Math.min(fraction, 1 - released);
    } else fraction = Math.max(released, (m + 1) / 12, s ?? 0) - released;
    if (fraction > 1e-12) {
      const px = prices.get(row.entry); assert(px);
      const money = fraction * 100; invested += money * .6;
      for (let j = 0; j < 2; j++) shares[j] += money * .3 / px[j];
      released += fraction;
    }
  }
  assert(Math.abs(released - 1) < 1e-10 && Math.abs(invested - 60) < 1e-8);
  const ending = prices.get(origin.end); assert(ending);
  const value = 100 - invested + shares[0] * ending[0] + shares[1] * ending[1];
  const days = (Date.parse(origin.end) - Date.parse(origin.start)) / 86400000;
  const annualReturn = 100 * ((value / 100) ** (365.2425 / days) - 1);
  const control = baselineByKey.get(origin.start + '|10|tranche_12');
  return { start: origin.start, end: origin.end, value, annualReturn, vs12: annualReturn - control.annualReturn };
}
const cohorts = [], cohortMap = new Map(), records = [];
let maxCsvReplayDifference = 0;
for (const row of grid) {
  const rule = { id: row['规则ID'], adapter: row['执行方式'], anchor: row['基础因子'],
    extras: row['附加因子'].split('+'), weight: Number(row['附加权重']), blend: row['混合公式'] };
  assert(['score_ladder', 'score_accelerated_12'].includes(rule.adapter));
  const accounts = origins.map(o => account(o, rule)).filter(Boolean);
  assert.equal(accounts.length, Number(row['后段有效起点']), rule.id);
  const error = Math.abs(yearMean(accounts, 'vs12') - Number(row['后段比12月分批年化差pp']));
  maxCsvReplayDifference = Math.max(maxCsvReplayDifference, error);
  assert(error < 1e-9, 'Independent replay differs from original CSV: ' + rule.id);
  const dates = accounts.map(r => r.start), key = dates.join('|');
  if (!cohortMap.has(key)) { cohortMap.set(key, cohorts.length); cohorts.push({ n: dates.length, starts: dates }); }
  const cmp = compare(accounts);
  records.push([rule.id, rule.adapter, cohortMap.get(key), cmp.yearEqualCAGRpp, cmp.wins, cmp.ties, cmp.losses]);
}
const methodRows = baseline.methods.map(method => {
  const id = method.key;
  return { id, ...compare(origins.map(o => baselineByKey.get(o.start + '|10|' + id))) };
});
const selected = read('qualifying-target-results.json').results.map(result => ({ id: result.c.id, family: result.c.family,
  ...compare(result.rows.filter(r => r.years === 10 && r.start >= '2014' && r.start < '2017')) }));
const sorted = records.slice().sort((a, b) => b[3] - a[3] || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const audit = {
  schemaVersion: 1, conclusion: 'WITHDRAWN_NO_POSITIVE_MEAN_INCREMENT_OVER_LUMP_SUM',
  sourceArchiveSHA256: manifest.archiveSHA256, sourceCsvSHA256: sha(inputCsv),
  scope: { assets: ['us:USD', 'us:TQQQ'], weights: [30, 30], cashWeight: 40, currency: 'CNY',
    initial: 100, monthly: 0, rebalance: 'none', transactionFee: 0, personalTax: 0,
    eligibleOriginRange: [origins[0].start, origins.at(-1).start], horizonYears: 10 },
  metric: 'Same-origin and same-maturity candidate CAGR minus lump-sum CAGR; average within entry year, then equally across represented entry years. Units: percentage points.',
  cohortPolicy: 'Each archived CSV rule includes only starts whose required initial factors exist. All later missing signals retain the fixed adapter fallback. The lump-sum control uses that exact same cohort; 13/17/23/35-start groups are not pooled or treated as equally covered.',
  interpretation: '0/5136 means no enumerated rule has positive entry-year-equal mean excess CAGR within its own eligible historical cohort. It does not mean every account loses, statistical proof of universal dominance, or that no other timing method can work. These are repeatedly examined overlapping historical paths, not independent or untouched validation.',
  productCorrection: 'The prior three indicators and composite were promoted despite this failed primary comparison. Their fixed-weight restriction was a hand-written research-scope guard, not a computational requirement. Reusing their score for different weights would not repair the missing performance evidence.',
  independentReplay: { rules: records.length, maxCsvYearEqualCAGRppError: maxCsvReplayDifference,
    allPrincipalReleasedExactlyOnce: true, commonPriceDateOrdersOnly: true, signalsStrictlyBeforeOrders: true },
  summary: { ruleCount: records.length, positiveMeanCount: records.filter(r => r[3] > 1e-9).length,
    zeroMeanCount: records.filter(r => Math.abs(r[3]) <= 1e-9).length, negativeMeanCount: records.filter(r => r[3] < -1e-9).length,
    bestHistoricalMeanCAGRpp: sorted[0][3], worstHistoricalMeanCAGRpp: sorted.at(-1)[3],
    anyWinningOriginRuleCount: records.filter(r => r[4] > 0).length },
  standardMethodsSame35: methodRows, withdrawnMethodsSame35: selected,
  cohortGroups: cohorts,
  recordColumns: ['ruleId', 'adapter', 'cohortGroupIndex', 'yearEqualCAGRppVsLump', 'wins', 'ties', 'losses'],
  bestHistoricalRowsForAuditOnly: sorted.slice(0, 10), records
};
const output = JSON.stringify(audit) + '\n', destination = path.join(here, 'lump-sum-audit.json');
if (args[0] === '--write') fs.writeFileSync(destination, output);
if (args[0] === '--check') assert.equal(fs.readFileSync(destination, 'utf8'), output, 'Audit output differs');
console.log(JSON.stringify({ ...audit.summary, independentReplay: audit.independentReplay,
  standardMethodsSame35: methodRows, withdrawnMethodsSame35: selected, outputSHA256: sha(output) }, null, 2));
