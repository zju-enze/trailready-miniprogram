const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateDailyAbility, estimateTripDuration } = require('../utils/abilityAssessment');

const asOfDate = '2026-11-19';
const route = { distanceKm: 10, ascentM: 450 };
const hike = (id, date, distance, ascent, hours, effortLevel, load) => ({
  id, name: '测试路线 ' + id, date, distance, ascent, hours, effortLevel, load
});
const A = hike('A', '2026-09-05', 8, 300, 3, 2, 0);
const B = hike('B', '2026-09-12', 12, 650, 5, 3, 4);
const C = hike('C', '2026-09-19', 16, 1000, 8, 5, 8);
const D = hike('D', '2026-09-26', 10, 500, 4, 1);
const E = hike('E', '2026-10-03', 14, 800, 6, 2, 5);
const F = hike('F', '2026-10-10', 6, 150, 2, 3, 2);
const G = hike('G', '2026-10-17', 9, 400, 4, 2, 3);
const daily = (records, self = null) => generateDailyAbility(records, self, asOfDate);
const estimate = (records, target = route) => estimateTripDuration(target, records, asOfDate);
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

test('zero to two daily samples produce counts and an explanation without a range or median', () => {
  for (const records of [[], [A], [A, B], [A, B, C]]) {
    const result = daily(records);
    assert.equal(result.status, 'insufficient');
    assert.match(result.message, /至少 3 次/);
    assert.equal(result.metrics.distanceKm.range, null);
    assert.equal(result.metrics.distanceKm.median, null);
    assert.equal(result.metrics.distanceKm.sampleCount, records.filter(record => record !== C).length);
  }
});

test('three or four observations give the actual range, paired evidence and whole-trip pace', () => {
  const result = daily([A, B, C, D, { ...C, id: 'H', effortLevel: 4 }]);
  assert.equal(result.status, 'preliminary');
  assert.deepEqual(result.counts, { total: 5, usable: 5, reference: 3, comfortable: 2, moderate: 1, highEffort: 2, unrated: 0 });
  assert.deepEqual(result.highEffortRecords.map(record => record.ref.id), ['C', 'H']);
  assert.deepEqual(result.metrics.distanceKm.range, { low: 8, high: 12 });
  assert.deepEqual(result.metrics.ascentM.range, { low: 300, high: 650 });
  assert.deepEqual(result.metrics.durationHours.range, { low: 3, high: 5 });
  assert.deepEqual(result.metrics.paceMinPerKm.range, { low: 22.5, high: 25 });
  assert.equal(result.metrics.paceMinPerKm.unit, 'min/km');
  assert.deepEqual(result.referenceRecords.map(record => [record.ref.id, record.ref.date, record.distanceKm, record.ascentM]),
    [['A', A.date, 8, 300], ['B', B.date, 12, 650], ['D', D.date, 10, 500]]);
  assert.equal(daily([A, B, D, E]).metrics.distanceKm.method, 'observed');
  assert.equal(result.metrics.loadKg.status, 'insufficient');
  assert.equal(result.metrics.loadKg.missingCount, 1);
});

test('five observations give a median, the middle half and the full observed limits separately', () => {
  const { status, metrics } = daily([A, B, D, E, F]);
  assert.equal(status, 'preliminary');
  assert.equal(metrics.distanceKm.method, 'interquartile');
  assert.equal(metrics.distanceKm.median, 10);
  assert.deepEqual(metrics.distanceKm.range, { low: 8, high: 12 });
  assert.deepEqual(metrics.distanceKm.observedRange, { low: 6, high: 14 });
});

test('six recent and diverse records support daily estimates, with separate metric sufficiency', () => {
  const result = daily([A, B, D, E, F, G]);
  assert.equal(result.status, 'supported');
  assert.equal(result.quality.pairedCount, 6);
  assert.equal(result.quality.recentCount, 6);
  assert.equal(result.metrics.distanceKm.status, 'supported');
  assert.deepEqual(result.metrics.distanceKm.range, { low: 8.25, high: 11.5 });
  assert.equal(result.metrics.loadKg.sampleCount, 5);
  assert.equal(result.metrics.loadKg.status, 'preliminary');
});

test('poor coverage, few ratings, older dates, short spans or homogeneous terrain limit evidence', () => {
  const diverse = [A, B, D, E, F, G];
  const unrated = diverse.map(record => ({ ...record, effortLevel: null }));
  const scenarios = [
    [...diverse, null, null, null],
    [...diverse, ...unrated],
    diverse.map(record => ({ ...record, date: record.date.replace('2026-', '2025-') })),
    diverse.map(record => ({ ...record, date: '2026-10-01' })),
    diverse.map(record => ({ ...record, distance: 10 })),
    diverse.map(record => ({ ...record, ascent: 0 }))
  ];
  for (const records of scenarios) assert.equal(daily(records).status, 'preliminary');
});

test('only strenuous outings remain available as comparison and duration calibration', () => {
  const records = [A, B, C].map(record => ({ ...record, effortLevel: 5 }));
  const result = daily(records);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.counts.highEffort, 3);
  assert.equal(result.referenceRecords.length, 0);
  assert.equal(estimate(records).sampleCount, 3);
});

test('missing or invalid distance and time are excluded and remain traceable by original ID', () => {
  const missingDistance = { ...A, distance: '', id: 7 };
  const missingTime = { ...B, hours: undefined };
  const invalidTime = { ...C, hours: 0 };
  const invalidDate = { ...E, date: '2026-11-20' };
  const records = [missingDistance, missingTime, invalidTime, invalidDate, D];
  const result = daily(records);
  assert.equal(result.counts.usable, 1);
  assert.deepEqual(result.needsReview.map(record => record.ref.id), [7, 'B', 'C', 'E']);
  assert.deepEqual(result.needsReview[0].missingFields, ['distance']);
  assert.deepEqual(result.needsReview[2].invalidFields, ['hours']);
  assert.equal(estimate(records).sampleCount, 1);
});

test('zero ascent and load are retained while missing and invalid fields stay distinct', () => {
  const flat = [A, B, D].map(record => ({ ...record, ascent: 0, load: 0 }));
  assert.deepEqual(daily(flat).metrics.ascentM.range, { low: 0, high: 0 });
  assert.deepEqual(daily(flat).metrics.loadKg.range, { low: 0, high: 0 });
  assert.equal(estimate(flat, { ...route, ascentM: 0 }).sampleCount, 3);
  const mixed = [flat[0], { ...flat[1], ascent: '' }, { ...flat[2], ascent: -1, load: '无效' }];
  const result = daily(mixed);
  assert.equal(result.metrics.ascentM.sampleCount, 1);
  assert.equal(result.metrics.ascentM.missingCount, 1);
  assert.equal(result.metrics.ascentM.invalidCount, 1);
  assert.equal(result.metrics.ascentM.range, null);
  assert.equal(result.metrics.loadKg.invalidCount, 1);
  assert.equal(result.metrics.distanceKm.sampleCount, 3);
  assert.equal(estimate(mixed).sampleCount, 1);
});

test('legacy effort uses Stage A mapping and unknown labels do not become moderate', () => {
  const records = [A, B, C, D].map((record, index) => ({
    ...record, effortLevel: undefined, effort: ['轻松', '适中', '吃力', '自订评价'][index]
  }));
  const result = daily(records);
  assert.deepEqual(result.referenceRecords.map(record => record.effortLevel), [2, 3]);
  assert.deepEqual(result.highEffortRecords.map(record => record.effortLevel), [4]);
  assert.equal(result.counts.unrated, 1);
  assert.equal(estimate(records).sampleCount, 4);
});

test('self assessment stays separate and flags substantial differences without altering metrics', () => {
  const records = [A, B, D];
  const result = daily(records, { comfortableDistanceKm: 24, comfortableDurationHours: 1, comfortableAscentM: 655 });
  assert.deepEqual(result.metrics, daily(records).metrics);
  assert.equal(result.selfAssessment.source, 'trailready_user_profile');
  assert.deepEqual(result.selfAssessment.differences.map(({ key, direction }) => [key, direction]),
    [['comfortableDistanceKm', 'above'], ['comfortableDurationHours', 'below']]);
});

test('Naismith target baseline and the personal median factor reproduce the sample calculation', () => {
  const result = estimate([A, B, C]);
  assert.equal(result.baseHours, 2.75);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.status, 'preliminary');
  approximately(result.calibrationRecords[0].baseHours, 2.1);
  approximately(result.factor, 5 / (12 / 5 + 650 / 600));
  approximately(result.referenceHours, 3.9473684210526314);
  approximately(result.paceMinPerKm, 23.68421052631579);
});

test('extreme but valid completion time is retained and has limited influence on the median', () => {
  const result = estimate([A, B, { ...C, hours: 1000 }]);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.calibrationRecords[2].durationHours, 1000);
  approximately(result.factor, 5 / (12 / 5 + 650 / 600));
  approximately(estimate([A, B, C, { ...D, hours: 1000 }]).factor,
    (5 / (12 / 5 + 650 / 600) + 8 / (16 / 5 + 1000 / 600)) / 2);
});

test('duration needs three calibrated records and both target inputs', () => {
  const sparse = estimate([A, B, { ...C, ascent: null }]);
  assert.equal(sparse.reason, 'insufficient_history');
  assert.match(sparse.message, /暂无足够历史依据/);
  assert.equal(sparse.referenceHours, null);
  assert.equal(sparse.factor, null);
  for (const target of [{ distanceKm: 10 }, { ascentM: 0 }, { distanceKm: 0, ascentM: 0 }, null]) {
    const result = estimate([A, B, C], target);
    assert.equal(result.reason, 'route_metrics_required');
    assert.equal(result.baseHours, null);
    assert.equal(result.referenceHours, null);
  }
});

test('duration warns about extrapolation or sparse joint coverage and declines flagged conditions', () => {
  const history = [A, B, D, E, F, G];
  const supported = estimate(history, { ...route, ascentM: 420 });
  assert.equal(supported.status, 'supported');
  assert.equal(supported.comparableCount, 3);
  assert.deepEqual(supported.warnings, []);
  const outside = estimate(history, { distanceKm: 40, ascentM: 2300 });
  assert.equal(outside.status, 'preliminary');
  assert.equal(outside.comparableCount, 0);
  assert.match(outside.warnings.join(' '), /外推参考/);
  assert.match(estimate([A, B, C]).warnings.join(' '), /同时接近/);
  for (const flag of ['highAltitude', 'extremeWeather', 'technicalTerrain']) {
    const unsupported = estimate(history, { ...route, [flag]: true });
    assert.equal(unsupported.reason, 'unsupported_conditions');
    assert.equal(unsupported.referenceHours, null);
  }
});

test('both results reproduce for identical inputs and an explicit date without altering records', () => {
  const records = Object.freeze([A, B, C, D].map(record => Object.freeze({ ...record })));
  const self = Object.freeze({ typicalLoadKg: 0 });
  const target = Object.freeze({ ...route });
  assert.deepEqual(daily(records, self), daily(records, self));
  assert.deepEqual(estimate(records, target), estimate(records, target));
  assert.throws(() => generateDailyAbility(records, self, '2026-11-31'), TypeError);
});
