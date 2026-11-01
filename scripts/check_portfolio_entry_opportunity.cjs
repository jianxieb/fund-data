#!/usr/bin/env node
'use strict';
// A fixed-history impossibility screen. No model fit, trading signal or policy selection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = 'docs/research/portfolio-entry-opportunity-audit-protocol-v1.json';
const OUTPUT = 'docs/evidence/portfolio-entry-opportunity-v1.json';
const IDS = ['us:USD', 'us:TQQQ'];
const TOLERANCE_PP = 1e-10, MINIMUM_MEAN_PP = .5;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sum = xs => xs.reduce((a, b) => a + b, 0);
const average = xs => sum(xs) / xs.length;
function median(xs) { const a = [...xs].sort((x, y) => x - y), i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; }
function arithmeticEqual(a, b, label, scale = 1) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b), label + ': finite values required');
  assert.ok(Math.abs(a - b) <= 256 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b), scale), label + ': arithmetic identity');
}
function indexUnique(rows, key, label) {
  const result = new Map();
  for (const row of rows) { const k = key(row); assert.ok(!result.has(k), label + ': duplicate ' + k); result.set(k, row); }
  return result;
}
function bounds(usd, tqqq) {
  assert.ok(Number.isFinite(usd) && Number.isFinite(tqqq), 'finite frozen labels required');
  // Enumerate the four schedules separately from the closed-form maxima.
  const schedules = [];
  for (const waitUsd of [false, true]) for (const waitTqqq of [false, true]) {
    schedules.push({ waitUsd, waitTqqq, deltaPp: 100 * ((waitUsd ? usd : 0) + (waitTqqq ? tqqq : 0)) });
  }
  const commonActionBoundPp = 100 * Math.max(0, usd + tqqq);
  const separateActionBoundPp = 100 * (Math.max(0, usd) + Math.max(0, tqqq));
  arithmeticEqual(commonActionBoundPp, Math.max(...schedules.filter(s => s.waitUsd === s.waitTqqq).map(s => s.deltaPp)), 'common schedule maximum');
  arithmeticEqual(separateActionBoundPp, Math.max(...schedules.map(s => s.deltaPp)), 'separate schedule maximum');
  assert.ok(commonActionBoundPp >= 0 && separateActionBoundPp >= commonActionBoundPp);
  return { commonActionBoundPp, separateActionBoundPp };
}
function necessaryCondition(meanBoundPp) {
  assert.ok(Number.isFinite(meanBoundPp) && meanBoundPp >= 0, 'finite nonnegative upper bound required');
  return meanBoundPp < MINIMUM_MEAN_PP - TOLERANCE_PP ? 'excluded_by_wealth_upper_bound' : 'not_excluded_by_wealth_upper_bound';
}
function summarize(rows) {
  assert.ok(rows.length > 0, 'empty scope cannot establish a bound');
  const summarizeBound = key => {
    const values = rows.map(r => r[key]), meanPp = average(values);
    return { meanPp, medianPp: median(values), opportunityMonths: values.filter(v => v > TOLERANCE_PP).length, necessaryCondition: necessaryCondition(meanPp) };
  };
  return { months: rows.length, commonAction: summarizeBound('commonActionBoundPp'), separateAction: summarizeBound('separateActionBoundPp'),
    componentFavorableMonths: Object.fromEntries(IDS.map(id => [id, rows.filter(r => 100 * r.componentLabels[id] > TOLERANCE_PP).length])),
    meanSeparateMinusCommonPp: average(rows.map(r => r.separateActionBoundPp - r.commonActionBoundPp)),
    recordedV4MeanDeltaPp: average(rows.map(r => r.recordedV4DeltaPp)),
    meanCommonBoundMinusV4Pp: average(rows.map(r => r.commonBoundMinusV4Pp)),
    meanSeparateBoundMinusV4Pp: average(rows.map(r => r.separateBoundMinusV4Pp)) };
}
function statisticsHash(report) {
  return sha(JSON.stringify({ maturityQueue: report.maturityQueue, dailyPredictions: report.dailyPredictions, results: report.results,
    coverage: report.coverage, pairedBaseWindows: report.pairedBaseWindows, primaryPredictionDiagnostics: report.primaryPredictionDiagnostics, decision: report.decision }));
}
function auditSource(report, sourceProtocol, protocol) {
  assert.equal(report.protocolId, sourceProtocol.id);
  assert.equal(report.statisticsSha256, protocol.sourceStatisticsSha256);
  assert.equal(statisticsHash(report), protocol.sourceStatisticsSha256, 'source statistics fingerprint');
  assert.equal(report.decision.status, 'development_failed_research_only');
  for (const field of ['eligibleForConfirmation', 'historicalConfirmationPassed', 'integrationEligible']) assert.equal(report.decision[field], false);
  assert.equal(report.decision.development.passed, false);
  assert.equal(sourceProtocol.status, 'frozen_before_component_labels_predictions_and_outcomes');
  assert.deepEqual(sourceProtocol.model.components, IDS.map(id => ({ id, originalWeight: .3 })));
  assert.equal(sourceProtocol.selectionAndConfirmation.unconditionalGates.minimumMeanDeltaPp, MINIMUM_MEAN_PP);
  assert.equal(protocol.status, 'frozen_diagnostic_before_summary_calculation');
  assert.equal(protocol.necessaryCondition.minimumMeanDeltaPp, MINIMUM_MEAN_PP);
  assert.equal(protocol.necessaryCondition.tolerancePp, TOLERANCE_PP);
  assert.deepEqual(protocol.scope.partitions, [{ id: 'development', months: 37 }, { id: 'validation', months: 36 }, { id: 'replication', months: 34 }]);
  assert.equal(protocol.scope.calendarDay, 1); assert.equal(protocol.scope.evaluation, 'equal_age_lot'); assert.equal(protocol.scope.holdingYears, 1); assert.equal(protocol.scope.scenario, 'base');
  const queue = indexUnique(report.maturityQueue, r => r.entryDay, 'annual labels');
  const diagnostics = indexUnique(report.primaryPredictionDiagnostics, r => r.partition, 'primary diagnostics');
  assert.equal(diagnostics.size, 3);
  const isPrimary = r => r.calendarDay === 1 && r.evaluation === 'equal_age_lot' && r.scenario === 'base';
  const windows = indexUnique(report.pairedBaseWindows.filter(r => isPrimary(r) && r.years === 1), r => r.start, 'primary windows');
  assert.equal(windows.size, 107);
  const groups = indexUnique(report.results.filter(r => isPrimary(r) && r.horizonYears === 1), r => r.partition, 'primary groups');
  assert.equal(groups.size, 3);
  const allDates = new Set(), partitions = []; let maximumWealthIdentityErrorPp = 0, maximumFixedDelayIdentityErrorPp = 0;
  for (const phase of protocol.scope.partitions) {
    const diagnostic = diagnostics.get(phase.id), group = groups.get(phase.id);
    assert.ok(diagnostic && group);
    assert.equal(diagnostic.dates.length, phase.months); assert.equal(diagnostic.uniqueMonths, phase.months);
    assert.equal(new Set(diagnostic.dates.map(r => r.day.slice(0, 7))).size, phase.months, 'unique calendar months');
    const monthly = diagnostic.dates.map((d, i) => {
      assert.ok(!allDates.has(d.day), 'unique primary arrival'); allDates.add(d.day);
      assert.ok(!i || diagnostic.dates[i - 1].day < d.day, 'ordered primary arrivals');
      const label = queue.get(d.day), window = windows.get(d.day); assert.ok(label && window, 'matched annual label and account');
      assert.equal(window.partition, phase.id); assert.equal(d.end, label.exitDay); assert.equal(d.end, window.end); assert.equal(d.featureDay, label.featureDay);
      assert.equal(window.contributed, 100); assert.equal(window.fundingPlan.length, 1); assert.equal(window.fundingPlan[0].day, d.day); assert.equal(window.fundingPlan[0].amount, 100);
      const actual = window.rules[sourceProtocol.model.id], immediate = window.rules.immediate, fixed = window.rules.fixed_delay5;
      for (const account of [actual, immediate, fixed]) { assert.equal(account.contributed, 100); assert.equal(account.depositCount, 1); }
      const componentLabels = Object.fromEntries(IDS.map(id => {
        const y = label.components[id].y; assert.ok(Number.isFinite(y)); assert.equal(d.components[id].actualY, y); assert.ok([0, 5].includes(d.legOffsets[id])); assert.equal(d.components[id].legOffset, d.legOffsets[id]); return [id, y];
      }));
      assert.equal(d.anyDelay, IDS.some(id => d.legOffsets[id] === 5));
      const recordedV4DeltaPp = 100 * (actual.terminalWealth - immediate.terminalWealth) / window.contributed;
      const selectedDeltaPp = 100 * sum(IDS.map(id => d.legOffsets[id] === 5 ? componentLabels[id] : 0));
      const fixedDeltaPp = 100 * (fixed.terminalWealth - immediate.terminalWealth) / window.contributed;
      const scale = 100 * (Math.abs(actual.terminalWealth) + Math.abs(immediate.terminalWealth) + Math.abs(fixed.terminalWealth)) / window.contributed;
      arithmeticEqual(recordedV4DeltaPp, d.deltaPp, 'recorded primary delta', scale);
      arithmeticEqual(recordedV4DeltaPp, selectedDeltaPp, 'selected-leg wealth identity', scale);
      arithmeticEqual(fixedDeltaPp, 100 * sum(Object.values(componentLabels)), 'both-delay wealth identity', scale);
      maximumWealthIdentityErrorPp = Math.max(maximumWealthIdentityErrorPp, Math.abs(recordedV4DeltaPp - selectedDeltaPp));
      maximumFixedDelayIdentityErrorPp = Math.max(maximumFixedDelayIdentityErrorPp, Math.abs(fixedDeltaPp - 100 * sum(Object.values(componentLabels))));
      const maximum = bounds(...IDS.map(id => componentLabels[id]));
      // v4 permits separate actions: only the separate bound must dominate v4.
      assert.ok(selectedDeltaPp <= maximum.separateActionBoundPp);
      if (recordedV4DeltaPp > maximum.separateActionBoundPp) arithmeticEqual(recordedV4DeltaPp, maximum.separateActionBoundPp, 'v4 bounded above', scale);
      return { day: d.day, annualTerminal: d.end, componentLabels, recordedLegOffsets: { ...d.legOffsets }, ...maximum, recordedV4DeltaPp,
        commonBoundMinusV4Pp: maximum.commonActionBoundPp - recordedV4DeltaPp, separateBoundMinusV4Pp: maximum.separateActionBoundPp - recordedV4DeltaPp };
    });
    const summary = summarize(monthly), candidate = group.rules.find(r => r.id === sourceProtocol.model.id);
    assert.equal(candidate.vsImmediate.n, phase.months); arithmeticEqual(summary.recordedV4MeanDeltaPp, candidate.vsImmediate.meanDeltaPp, 'source mean unchanged');
    assert.deepEqual(group.startRange, { first: monthly[0].day, last: monthly.at(-1).day });
    // Recompute aggregate maxima via discrete enumeration, rather than averaging the closed forms again.
    let commonSum = 0, separateSum = 0, commonCount = 0, separateCount = 0;
    for (const row of monthly) {
      const [a, b] = IDS.map(id => row.componentLabels[id]), four = [0, 100 * a, 100 * b, 100 * (a + b)];
      const common = Math.max(four[0], four[3]), separate = Math.max(...four);
      commonSum += common; separateSum += separate; commonCount += common > TOLERANCE_PP; separateCount += separate > TOLERANCE_PP;
    }
    arithmeticEqual(commonSum / phase.months, summary.commonAction.meanPp, 'independent common aggregate');
    arithmeticEqual(separateSum / phase.months, summary.separateAction.meanPp, 'independent separate aggregate');
    assert.equal(commonCount, summary.commonAction.opportunityMonths); assert.equal(separateCount, summary.separateAction.opportunityMonths);
    partitions.push({ partition: phase.id, arrivalRange: group.startRange, ...summary, monthly });
  }
  assert.equal(allDates.size, windows.size);
  return { partitions, verification: { sourceFailurePreserved: true, uniquePrimaryMonths: allDates.size, enumeratedSchedules: allDates.size * 4,
    selectedLegAndFixedDelayWealthIdentities: allDates.size * 2, maximumWealthIdentityErrorPp, maximumFixedDelayIdentityErrorPp,
    arithmeticIdentityComparison: '256 * Number.EPSILON * max(1, compared magnitudes, account-wealth scale); never changes opportunity counts, bounds or gate thresholds' } };
}
function runAudit() {
  const bytes = fs.readFileSync(path.join(ROOT, PROTOCOL)), protocol = JSON.parse(bytes);
  assert.equal(protocol.id, 'frozen-five-session-opportunity-audit-v1'); assert.equal(protocol.inputs.length, 2);
  const files = [{ path: PROTOCOL, sha256: sha(bytes) }, ...protocol.inputs];
  const sources = protocol.inputs.map(input => { const data = fs.readFileSync(path.join(ROOT, input.path)); assert.equal(sha(data), input.sha256, input.path + ': frozen hash'); return JSON.parse(data); });
  const audited = auditSource(sources[0], sources[1], protocol);
  for (const input of files) assert.equal(sha(fs.readFileSync(path.join(ROOT, input.path))), input.sha256, 'source unchanged after calculation');
  const evidence = { protocolId: protocol.id, generatedAt: new Date().toISOString(), status: 'diagnostic_completed', tradable: false, candidate: false,
    predictiveValidation: false, integrationEligible: false, originalGoalComplete: false,
    inputs: files, sourceStatisticsSha256: protocol.sourceStatisticsSha256, sourceDecisionStatus: sources[0].decision.status,
    checker: { path: path.relative(ROOT, __filename), sha256: sha(fs.readFileSync(__filename)) },
    tests: { path: 'tests/portfolio-entry-opportunity.test.cjs', sha256: sha(fs.readFileSync(path.join(ROOT, 'tests/portfolio-entry-opportunity.test.cjs'))) },
    scope: protocol.scope, definitions: protocol.definitions, necessaryCondition: protocol.necessaryCondition, ...audited,
    limitations: [
      'Every maximum uses future realized outcomes. It is not tradable, a new candidate, a signal, a score, a probability or predictive validation.',
      'Opportunity months are descriptive dates, not independent observations or successful predictions. No oracle full-gate, risk, action-coverage or bootstrap confirmation is applied.',
      'A common-action bound does not bound v4 separate actions; commonBoundMinusV4Pp may be negative. The separate-action bound bounds v4 in this scope.',
      'Not excluded means only that this mean upper-bound screen did not rule out the space. It supplies no evidence that contemporaneous inputs can identify profitable actions.',
      'Positive terminal prices make each base component label sign depend only on its future five-session relative price. Its magnitude, and mixed-sign common-action outcomes, depend on the annual terminal.',
      'This exposed fixed history, provisional one-year holding period and five-session waiting assumption cannot establish user preference, future performance or a different waiting space. Personal taxes are absent.',
      protocol.stoppingRule
    ] };
  evidence.statisticsSha256 = sha(JSON.stringify({ partitions: evidence.partitions, verification: evidence.verification }));
  return evidence;
}
if (require.main === module) {
  assert.ok(process.argv.slice(2).every(arg => arg === '--write'), 'only optional --write is supported');
  const evidence = runAudit();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(path.join(ROOT, OUTPUT), JSON.stringify(evidence, null, 2) + '\n');
    for (const input of evidence.inputs) assert.equal(sha(fs.readFileSync(path.join(ROOT, input.path))), input.sha256, 'source unchanged after evidence write');
    console.log(JSON.stringify({ output: OUTPUT, statisticsSha256: evidence.statisticsSha256, status: evidence.status, predictiveValidation: false,
      partitions: evidence.partitions.map(({ monthly, ...summary }) => summary) }, null, 2));
  } else console.log(JSON.stringify(evidence, null, 2));
}
module.exports = { bounds, necessaryCondition, summarize, statisticsHash, auditSource, runAudit, TOLERANCE_PP, MINIMUM_MEAN_PP };
