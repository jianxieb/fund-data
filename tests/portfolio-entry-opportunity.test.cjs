'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../scripts/check_portfolio_entry_opportunity.cjs');
const IDs = ['us:USD', 'us:TQQQ'];
function row(a, b, actual = 0) {
  const bound = O.bounds(a, b);
  return { componentLabels: { [IDs[0]]: a, [IDs[1]]: b }, ...bound, recordedV4DeltaPp: actual,
    commonBoundMinusV4Pp: bound.commonActionBoundPp - actual, separateBoundMinusV4Pp: bound.separateActionBoundPp - actual };
}
test('same-sign and zero labels exhaust the four fixed schedules', () => {
  assert.deepEqual(O.bounds(.02, .03), { commonActionBoundPp: 5, separateActionBoundPp: 5 });
  assert.deepEqual(O.bounds(-.02, -.03), { commonActionBoundPp: 0, separateActionBoundPp: 0 });
  assert.deepEqual(O.bounds(0, 0), { commonActionBoundPp: 0, separateActionBoundPp: 0 });
});
test('opposite signs distinguish common and separate budgets, without reweighting', () => {
  assert.deepEqual(O.bounds(.02, -.03), { commonActionBoundPp: 0, separateActionBoundPp: 2 });
  const x = O.bounds(-.02, .03); assert.ok(Math.abs(x.commonActionBoundPp - 1) < 1e-12); assert.equal(x.separateActionBoundPp, 3);
  // A separate-action v4 outcome can exceed the common-action bound.
  const s = O.summarize([row(.02, -.03, 2)]); assert.equal(s.meanCommonBoundMinusV4Pp, -2); assert.equal(s.meanSeparateBoundMinusV4Pp, 0);
});
test('negative actual choices and unchanged months remain in unconditional denominators', () => {
  const s = O.summarize([row(.02, -.03, -3), row(-.01, -.02), row(0, 0), row(.01, .01)]);
  assert.equal(s.months, 4); assert.equal(s.commonAction.meanPp, .5); assert.equal(s.separateAction.meanPp, 1);
  assert.equal(s.commonAction.medianPp, 0); assert.equal(s.separateAction.medianPp, 1);
  assert.equal(s.commonAction.opportunityMonths, 1); assert.equal(s.separateAction.opportunityMonths, 2);
  assert.deepEqual(s.componentFavorableMonths, { 'us:USD': 2, 'us:TQQQ': 1 });
  assert.equal(s.recordedV4MeanDeltaPp, -.75); assert.equal(s.meanSeparateBoundMinusV4Pp, 1.75);
});
test('opportunity tolerance is strict and does not erase small bound values', () => {
  const below = row(.5e-12, 0), boundary = row(1e-12, 0), above = row(1.5e-12, 0);
  assert.equal(boundary.separateActionBoundPp, 1e-10);
  const s = O.summarize([below, boundary, above]);
  assert.equal(s.separateAction.opportunityMonths, 1); assert.equal(s.componentFavorableMonths['us:USD'], 1);
  assert.ok(s.separateAction.meanPp > 0);
  // Summed tiny component opportunities are counted once by the full bound, not by per-leg counts.
  const both = O.summarize([row(.75e-12, .75e-12)]);
  assert.equal(both.separateAction.opportunityMonths, 1); assert.deepEqual(both.componentFavorableMonths, { 'us:USD': 0, 'us:TQQQ': 0 });
});
test('necessary mean condition preserves the frozen boundary and never means validation', () => {
  const threshold = .5 - 1e-10;
  assert.equal(O.necessaryCondition(threshold - 1e-12), 'excluded_by_wealth_upper_bound');
  for (const value of [threshold, .5, 100]) assert.equal(O.necessaryCondition(value), 'not_excluded_by_wealth_upper_bound');
  for (const value of [NaN, Infinity, -1]) assert.throws(() => O.necessaryCondition(value));
  const result = O.summarize([row(1, 1)]); assert.equal(result.separateAction.necessaryCondition, 'not_excluded_by_wealth_upper_bound');
  assert.equal('passed' in result.separateAction, false); assert.equal('accuracy' in result.separateAction, false);
});
test('nonfinite labels and empty evidence fail instead of producing a favorable result', () => {
  assert.throws(() => O.bounds(NaN, 0)); assert.throws(() => O.bounds(0, Infinity)); assert.throws(() => O.summarize([]));
});
function fixture() {
  const partitions = [{ id: 'development', months: 37 }, { id: 'validation', months: 36 }, { id: 'replication', months: 34 }];
  const protocol = { status: 'frozen_diagnostic_before_summary_calculation', necessaryCondition: { minimumMeanDeltaPp: .5, tolerancePp: 1e-10 },
    scope: { partitions, calendarDay: 1, evaluation: 'equal_age_lot', holdingYears: 1, scenario: 'base' } };
  const source = { id: 'test-v4', status: 'frozen_before_component_labels_predictions_and_outcomes', model: { id: 'v4', components: IDs.map(id => ({ id, originalWeight: .3 })) },
    selectionAndConfirmation: { unconditionalGates: { minimumMeanDeltaPp: .5 } } };
  const report = { protocolId: source.id, maturityQueue: [], dailyPredictions: [], results: [], coverage: [], pairedBaseWindows: [], primaryPredictionDiagnostics: [],
    decision: { status: 'development_failed_research_only', development: { passed: false }, eligibleForConfirmation: false, historicalConfirmationPassed: false, integrationEligible: false } };
  for (const [p, phase] of partitions.entries()) {
    const dates = [];
    for (let i = 0; i < phase.months; i++) {
      const day = new Date(Date.UTC(2010 + 5 * p, i, 1)).toISOString().slice(0, 10), end = new Date(Date.UTC(2011 + 5 * p, i, 1)).toISOString().slice(0, 10);
      const labels = [.02, -.03], legOffsets = { 'us:USD': 0, 'us:TQQQ': 5 };
      report.maturityQueue.push({ entryDay: day, exitDay: end, featureDay: day, components: Object.fromEntries(IDs.map((id, j) => [id, { y: labels[j] }])) });
      dates.push({ day, end, featureDay: day, deltaPp: -3, anyDelay: true, legOffsets, components: Object.fromEntries(IDs.map((id, j) => [id, { actualY: labels[j], legOffset: legOffsets[id] }])) });
      const account = terminalWealth => ({ terminalWealth, contributed: 100, depositCount: 1 });
      report.pairedBaseWindows.push({ calendarDay: 1, evaluation: 'equal_age_lot', years: 1, scenario: 'base', partition: phase.id, start: day, end, contributed: 100,
        fundingPlan: [{ day, amount: 100 }], rules: { v4: account(97), immediate: account(100), fixed_delay5: account(99) } });
    }
    report.primaryPredictionDiagnostics.push({ partition: phase.id, uniqueMonths: phase.months, dates });
    report.results.push({ calendarDay: 1, evaluation: 'equal_age_lot', horizonYears: 1, scenario: 'base', partition: phase.id,
      startRange: { first: dates[0].day, last: dates.at(-1).day }, rules: [{ id: 'v4', vsImmediate: { n: phase.months, meanDeltaPp: -3 } }] });
  }
  return seal({ report, source, protocol });
}
function seal(f) { f.report.statisticsSha256 = O.statisticsHash(f.report); f.protocol.sourceStatisticsSha256 = f.report.statisticsSha256; return f; }
test('full synthetic source binds 107 months, label/action/wealth identities and failed status', () => {
  const { report, source, protocol } = fixture(), result = O.auditSource(report, source, protocol);
  assert.equal(result.verification.uniquePrimaryMonths, 107); assert.equal(result.verification.enumeratedSchedules, 428);
  assert.deepEqual(result.partitions.map(p => p.months), [37, 36, 34]);
  for (const p of result.partitions) { assert.equal(p.commonAction.meanPp, 0); assert.equal(p.separateAction.meanPp, 2); assert.equal(p.recordedV4MeanDeltaPp, -3); }
});
test('source mutations cannot pass through fingerprints, eligibility or wealth identities', () => {
  const badHash = fixture(); badHash.report.results[0].rules[0].vsImmediate.meanDeltaPp = 7;
  assert.throws(() => O.auditSource(badHash.report, badHash.source, badHash.protocol), /fingerprint/);
  const mutations = [
    f => { f.report.decision.integrationEligible = true; },
    f => { f.report.primaryPredictionDiagnostics[0].dates[0].components['us:USD'].actualY = .3; },
    f => { f.report.pairedBaseWindows[0].rules.v4.terminalWealth = 150; },
    f => { f.report.pairedBaseWindows[0].rules.fixed_delay5.terminalWealth = 150; },
    f => { f.report.primaryPredictionDiagnostics[0].dates.push(f.report.primaryPredictionDiagnostics[0].dates[0]); },
    f => { f.report.maturityQueue.push(f.report.maturityQueue[0]); },
    f => { f.report.pairedBaseWindows[0].partition = 'replication'; },
    f => { f.report.primaryPredictionDiagnostics[0].dates[0].legOffsets['us:USD'] = 1; }
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); seal(f); assert.throws(() => O.auditSource(f.report, f.source, f.protocol)); }
});
