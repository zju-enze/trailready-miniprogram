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

test('zero to two daily samples produce observation counts without a numerical recommendation', () => {
  for (const records of [[], [A], [A, B], [A, B, C]]) {
    const result = daily(records);
    assert.equal(result.status, 'insufficient');
    assert.equal(result.availableCount, 0);
    assert.equal(result.metrics.distanceKm.reason, 'insufficient_samples');
    assert.equal(result.metrics.distanceKm.range, null);
    assert.equal(result.metrics.distanceKm.median, null);
    assert.equal(result.metrics.distanceKm.sampleCount, records.filter(record => record !== C).length);
  }
});

test('a wide history yields the dominant distance group, tracing only its paired ascent records', () => {
  const result = daily([A, { ...B, distance: 11 }, G, { ...D, distance: 39, ascent: 2700 }, C,
    { ...C, id: 'H', effortLevel: 4 }]);
  assert.equal(result.status, 'preliminary');
  assert.deepEqual(result.counts, { total: 6, usable: 6, reference: 4, comfortable: 3, moderate: 1, highEffort: 2, unrated: 0 });
  assert.deepEqual(result.highEffortRecords.map(record => record.ref.id), ['C', 'H']);
  assert.deepEqual(result.metrics.distanceKm.observedRange, { low: 8, high: 39 });
  assert.deepEqual(result.metrics.distanceKm.range, { low: 8, high: 11 });
  assert.equal(result.metrics.distanceKm.sampleCount, 4);
  assert.equal(result.metrics.distanceKm.usedCount, 3);
  assert.deepEqual(result.metrics.distanceKm.recordRefs.map(ref => ref.id), ['A', 'G', 'B']);
  assert.equal(result.metrics.ascentM.median, 400);
  assert.deepEqual(result.metrics.ascentM.condition.distanceKm, { low: 8, high: 11 });
  assert.deepEqual(result.metrics.ascentM.recordRefs.map(ref => ref.id), ['A', 'G', 'B']);
  assert.deepEqual(result.referenceRecords.map(record => [record.ref.id, record.ref.date, record.distanceKm, record.ascentM]),
    [['A', A.date, 8, 300], ['B', B.date, 11, 650], ['G', G.date, 9, 400], ['D', D.date, 39, 2700]]);
});

test('five typical distances give their middle half and leave the full observed limits separate', () => {
  const { status, metrics } = daily([A, { ...B, distance: 11 }, D, { ...E, distance: 8.5 }, G, { ...F, distance: 39 }]);
  assert.equal(status, 'preliminary');
  assert.equal(metrics.distanceKm.method, 'typical_group_interquartile');
  assert.equal(metrics.distanceKm.median, 9);
  assert.deepEqual(metrics.distanceKm.range, { low: 8.5, high: 10 });
  assert.deepEqual(metrics.distanceKm.observedRange, { low: 8, high: 39 });
  assert.deepEqual(metrics.ascentM.condition.distanceKm, { low: 8, high: 11 });
});

test('scattered distances and equally strong clusters with a gap withhold the distance and ascent recommendation', () => {
  for (const distances of [[3, 6, 9, 12, 15], [6, 6, 6, 14, 14, 14]]) {
    const records = distances.map((distance, i) => ({ ...A, id: i, distance }));
    const { metrics } = daily(records);
    assert.equal(metrics.distanceKm.status, 'insufficient');
    assert.equal(metrics.distanceKm.reason, 'dispersed_distances');
    assert.equal(metrics.distanceKm.range, null);
    assert.equal(metrics.distanceKm.sampleCount, records.length);
    assert.equal(metrics.ascentM.reason, 'no_distance_group');
    assert.equal(metrics.ascentM.median, null);
  }
});

test('sufficiency is independent of optional fields and depends on recency, time span and coverage', () => {
  const records = [A, B, D, E, F, G].map((record, i) => ({ ...record, distance: 7 + i / 2, ascent: null, load: 0 }));
  const { status, availableCount, metrics } = daily(records);
  assert.equal(status, 'preliminary');
  assert.equal(availableCount, 2);
  assert.equal(metrics.distanceKm.status, 'supported');
  assert.equal(metrics.ascentM.status, 'insufficient');
  assert.equal(metrics.shortTripLoadKg.status, 'supported');
  assert.equal(metrics.shortTripLoadKg.median, 0);
  assert.equal(metrics.longTripLoadKg.status, 'insufficient');
  assert.equal(daily(records.map(record => ({ ...record, date: '2026-10-01' }))).metrics.distanceKm.status, 'preliminary');
  assert.equal(daily(records.map(record => ({ ...record, date: record.date.replace('2026-', '2025-') }))).metrics.distanceKm.status, 'preliminary');
  const missingLoads = [7, 8, 9].map((distance, i) => ({ ...A, id: i, distance, load: null }));
  const partial = daily([...records, ...missingLoads]).metrics.shortTripLoadKg;
  assert.equal(partial.sampleCount, 6);
  assert.equal(partial.missingCount, 3);
  assert.equal(partial.status, 'preliminary');
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
  const flat = [A, G, D].map(record => ({ ...record, ascent: 0, load: 0 }));
  assert.equal(daily(flat).metrics.ascentM.median, 0);
  assert.equal(daily(flat).metrics.shortTripLoadKg.median, 0);
  assert.equal(estimate(flat, { ...route, ascentM: 0 }).sampleCount, 3);
  const mixed = [flat[0], { ...flat[1], ascent: '' }, { ...flat[2], ascent: -1, load: '无效' }];
  const result = daily(mixed);
  assert.equal(result.metrics.ascentM.sampleCount, 1);
  assert.equal(result.metrics.ascentM.missingCount, 1);
  assert.equal(result.metrics.ascentM.invalidCount, 1);
  assert.equal(result.metrics.ascentM.median, null);
  assert.equal(result.metrics.shortTripLoadKg.invalidCount, 1);
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

test('self assessment stays separate and flags substantial differences against the applicable groups', () => {
  const records = [A, { ...G, load: 2 }, { ...D, load: 3 }, { ...B, distance: 39, load: 100 }];
  const result = daily(records, { comfortableDistanceKm: 24, comfortableDurationHours: 1, comfortableAscentM: 900, typicalLoadKg: 10 });
  assert.deepEqual(result.metrics, daily(records).metrics);
  assert.equal(result.selfAssessment.source, 'trailready_user_profile');
  assert.equal(result.selfAssessment.values.comfortableDurationHours, 1);
  assert.deepEqual(result.selfAssessment.differences.map(({ metric, direction }) => [metric, direction]),
    [['distanceKm', 'above'], ['ascentM', 'above'], ['shortTripLoadKg', 'above']]);
});

test('pace uses total time and the 30/60 m/km boundaries without admitting moderate or unknown climbs', () => {
  const records = [
    { ...A, distance: 5, ascent: 150, hours: 1.5 },
    { ...B, distance: 8, ascent: 160, hours: 2.4 },
    { ...D, distance: 10, ascent: 0, hours: 4 },
    { ...E, distance: 10, ascent: 610, hours: 5 },
    { ...F, distance: 12, ascent: 900, hours: 7 },
    { ...G, distance: 15, ascent: 1000, hours: 10 },
    { ...A, id: 'over-low', distance: 10, ascent: 301, hours: 0.5 },
    { ...B, id: 'at-high', distance: 10, ascent: 600, hours: 0.5 },
    { ...D, id: 'unknown', ascent: null, hours: 0.5 },
    { ...E, id: 'invalid', ascent: -1, hours: 0.5 },
    { ...C, distance: 10, ascent: 300, hours: 99 }
  ];
  const result = daily(records);
  const { lowAscentPaceMinPerKm: low, highAscentPaceMinPerKm: high } = result.metrics;
  assert.equal(low.median, 18);
  assert.equal(high.median, 35);
  for (const metric of [low, high]) {
    assert.equal(metric.unit, 'min/km');
    assert.equal(metric.sampleCount, 3);
    assert.equal(metric.missingCount, 1);
    assert.equal(metric.invalidCount, 1);
  }
  assert.deepEqual(low.condition, { ascentMPerKm: { maxInclusive: 30 } });
  assert.deepEqual(high.condition, { ascentMPerKm: { minExclusive: 60 } });
  assert.deepEqual(low.recordRefs.map(ref => ref.id), ['A', 'B', 'D']);
  assert.deepEqual(high.recordRefs.map(ref => ref.id), ['E', 'F', 'G']);
  assert.deepEqual(result.referenceRecords.slice(6).map(record => record.ascentBand),
    ['moderate', 'moderate', 'unknown', 'unknown']);
  assert.equal(daily(records.filter(record => record.id !== 'E')).metrics.highAscentPaceMinPerKm.median, null);
});

test('short and long load groups use their own medians and allow lighter long-trip history', () => {
  const records = [
    { ...A, distance: 8, load: 0 }, { ...B, distance: 9, load: 8 }, { ...D, distance: 10, load: 4 },
    { ...E, distance: 10.01, load: 1 }, { ...F, distance: 12, load: 2 }, { ...G, distance: 14, load: 3 },
    { ...C, distance: 10, load: 99 }
  ];
  const { shortTripLoadKg: short, longTripLoadKg: long } = daily(records).metrics;
  assert.equal(short.median, 4);
  assert.equal(long.median, 2);
  assert.deepEqual(short.condition, { distanceKm: { maxInclusive: 10 } });
  assert.deepEqual(long.condition, { distanceKm: { minExclusive: 10 } });
  assert.deepEqual(short.recordRefs.map(ref => ref.id), ['A', 'B', 'D']);
  assert.deepEqual(long.recordRefs.map(ref => ref.id), ['E', 'F', 'G']);
  const conflict = daily(records, { typicalLoadKg: 100 });
  assert.deepEqual(conflict.selfAssessment.differences.map(item => item.metric), ['shortTripLoadKg', 'longTripLoadKg']);
  const sparse = daily(records.map(record => record.distance <= 10 ? { ...record, load: null } : record), { typicalLoadKg: 8 });
  assert.equal(sparse.metrics.shortTripLoadKg.sampleCount, 0);
  assert.equal(sparse.metrics.shortTripLoadKg.median, null);
  assert.equal(sparse.metrics.longTripLoadKg.median, 2);
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
