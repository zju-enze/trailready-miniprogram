const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateDailyAbility } = require('../utils/abilityAssessment');

const today = '2026-11-19';
const hike = (id, overrides = {}) => ({
  id, name: '路线 ' + id, date: today, distance: 8, ascent: 120, hours: 2, effortLevel: 2, load: 3, ...overrides
});
const assess = (history, self = null) => generateDailyAbility(history, self, today);
const distance = (history, self) => assess(history, self).recommendations.distanceKm;
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

test('blank profiles receive the generic 3–5 km trial range and no invented personal measurements', () => {
  const { recommendations, generalTiming } = assess([]);
  assert.equal(recommendations.distanceKm.source, 'generic');
  assert.deepEqual(recommendations.distanceKm.range, { low: 3, high: 5 });
  assert.equal(recommendations.distanceKm.historyWeight, 0);
  for (const [key, entry] of Object.entries(recommendations)) {
    if (key === 'distanceKm') continue;
    assert.equal(entry.source, 'missing');
    assert.equal(entry.value, null);
  }
  assert.deepEqual(generalTiming, { flatSpeedKmPerHour: 5, climbMPerHour: 600 });
});

test('cold-start distance uses experience and fitness and keeps climb and load labelled as self reported', () => {
  const self = { experienceLevel: 'beginner', fitnessLevel: 'low', comfortableDistanceKm: 10, comfortableAscentM: 900, typicalLoadKg: 0 };
  const { distanceKm, ascentM, shortTripLoadKg, longTripLoadKg } = assess([], self).recommendations;
  assert.equal(distanceKm.source, 'self_assessment');
  assert.equal(distanceKm.prior.limited, true);
  closeTo(distanceKm.range.low, 3.15);
  assert.equal(distanceKm.range.high, 4.5);
  assert.equal(ascentM.source, 'self_assessment');
  closeTo(ascentM.value, 94.5);
  assert.deepEqual(ascentM.condition.distanceKm, distanceKm.range);
  for (const weight of [shortTripLoadKg, longTripLoadKg]) {
    assert.equal(weight.source, 'self_reported');
    assert.equal(weight.reportedValue, 0);
    assert.equal(weight.value, null);
  }
  assert.equal(distance([], { ...self, fitnessLevel: 'medium' }).range.high, 6);
  assert.equal(distance([], { ...self, experienceLevel: 'regular' }).range.high, 9);
});

test('a 100 km self assessment is excluded from the blend without discarding other self fields', () => {
  const self = { experienceLevel: 'occasional', fitnessLevel: 'medium' };
  for (const history of [[], [hike('A')]]) {
    const rejected = distance(history, { ...self, comfortableDistanceKm: 100 });
    assert.equal(rejected.prior.rejected, true);
    assert.deepEqual(rejected.range, distance(history, self).range);
  }
  assert.deepEqual(distance([], { comfortableDistanceKm: 100 }).range, { low: 3, high: 5 });
});

test('a single easy outing gently adjusts distance and gives single observations for applicable metrics', () => {
  const { recommendations, metrics } = assess([hike('easy')]);
  const { distanceKm, ascentM, lowAscentPaceMinPerKm, highAscentPaceMinPerKm, shortTripLoadKg, longTripLoadKg } = recommendations;
  assert.equal(distanceKm.source, 'single_history');
  assert.equal(distanceKm.historyWeight, 0.2);
  closeTo(distanceKm.range.low, 3.6);
  closeTo(distanceKm.range.high, 5.2);
  assert.deepEqual(distanceKm.recordRefs.map(ref => ref.id), ['easy']);
  assert.equal(ascentM.value, 120);
  assert.deepEqual(ascentM.condition.distanceKm, { low: 8, high: 8 });
  assert.equal(lowAscentPaceMinPerKm.source, 'single_history');
  assert.equal(lowAscentPaceMinPerKm.value, 15);
  assert.equal(shortTripLoadKg.value, 3);
  assert.equal(highAscentPaceMinPerKm.value, null);
  assert.equal(longTripLoadKg.value, null);
  assert.equal(metrics.lowAscentPaceMinPerKm.median, null);
});

test('a similar strenuous hike can only lower the trial range and a distant or steep one carries less influence', () => {
  const hard = hike('hard', { distance: 4, ascent: 60, effortLevel: 5 });
  const rec = distance([hard]);
  assert.equal(rec.source, 'single_history');
  assert.equal(rec.historyWeight, 0);
  assert.equal(rec.burdenWeight, 0.2);
  closeTo(rec.range.high, 4.72);
  assert.deepEqual(rec.recordRefs, []);
  assert.deepEqual(rec.burdenRefs.map(ref => ref.id), ['hard']);
  const steep = distance([{ ...hard, ascent: 320 }]);
  assert.ok(steep.range.high > rec.range.high && steep.range.high < 5);
  assert.deepEqual(distance([{ ...hard, distance: 40, hours: 16 }]).range, { low: 3, high: 5 });
});

test('two conflicting distances use the closer observation while two comparable records both contribute', () => {
  const recent = hike('normal');
  const remote = hike('long', { distance: 39, ascent: 1000, hours: 12 });
  const sparse = distance([recent, remote]);
  assert.equal(sparse.sparseConflict, true);
  assert.deepEqual(sparse.range, distance([recent]).range);
  assert.deepEqual(sparse.recordRefs.map(ref => ref.id), ['normal']);
  const comparable = distance([recent, { ...remote, distance: 9, ascent: 200, hours: 3 }]);
  assert.equal(comparable.source, 'limited_history');
  assert.deepEqual(comparable.recordRefs.map(ref => ref.id), ['normal', 'long']);
  closeTo(comparable.historyWeight, 1 / 3);
});

test('three to five recent comparable records share the estimate with the self-assessment prior', () => {
  const history = [7, 7.5, 8, 8.5, 9].map((distance, i) => hike(i, { distance }));
  const self = { comfortableDistanceKm: 6 };
  for (const count of [3, 4, 5]) {
    const result = distance(history.slice(0, count), self);
    assert.equal(result.source, 'calibrated_history');
    assert.equal(result.effectiveCount, count);
    closeTo(result.historyWeight, count / (count + 4));
    assert.ok(result.range.high > 6 && result.range.high < result.historyRange.high);
  }
});

test('more than ten good records outweigh the prior and expose a conflicting self assessment', () => {
  const history = Array.from({ length: 12 }, (_, i) => hike(i, { distance: 7 + i % 4 / 4 }));
  const result = assess(history, { experienceLevel: 'regular', comfortableDistanceKm: 20 });
  const rec = result.recommendations.distanceKm;
  assert.equal(rec.prior.range.high, 12);
  assert.equal(rec.historyWeight, 0.75);
  assert.ok(rec.range.high < 9);
  assert.ok(result.selfAssessment.differences.some(item => item.metric === 'distanceKm' && item.direction === 'above'));
});

test('separated route groups use a discounted coherent group while scattered individual records remain uncalibrated', () => {
  const history = Array.from({ length: 12 }, (_, i) => hike(i, i < 6
    ? { distance: 8, ascent: 160 } : { distance: 11, ascent: 720, hours: 5 }));
  const result = assess(history);
  const rec = result.recommendations.distanceKm;
  assert.equal(result.metrics.distanceKm.reason, 'dispersed_distances');
  assert.equal(rec.scopedGroup, true);
  assert.equal(rec.source, 'calibrated_history');
  assert.equal(rec.effectiveCount, 4.5);
  closeTo(rec.historyWeight, 4.5 / 8.5);
  assert.deepEqual(rec.recordRefs.map(ref => ref.id), [0, 1, 2, 3, 4, 5]);
  assert.equal(result.recommendations.ascentM.value, 160);
  assert.deepEqual(result.recommendations.ascentM.condition.distanceKm, { low: 8, high: 8 });
  const scattered = distance([3, 6, 9, 12, 15].map((distance, i) => hike(i, { distance })));
  assert.equal(scattered.historyWeight, 0);
  assert.equal(scattered.source, 'generic');
});

test('invalid or unrated outings do not inflate effective evidence and missing ascent stays metric-specific', () => {
  const partial = hike('known-distance', { ascent: null, load: null });
  const invalid = [
    hike('unknown-feeling', { effortLevel: null, effort: '自订' }),
    hike('missing-time', { hours: null }),
    hike('invalid-distance', { distance: 0 }),
    hike('future', { date: '2026-11-20' })
  ];
  const { recommendations, needsReview } = assess([partial, ...invalid]);
  assert.deepEqual(recommendations.distanceKm, distance([partial]));
  assert.equal(recommendations.distanceKm.effectiveCount, 0.8);
  assert.equal(recommendations.ascentM.value, null);
  assert.equal(recommendations.lowAscentPaceMinPerKm.value, null);
  assert.equal(recommendations.shortTripLoadKg.value, null);
  assert.equal(needsReview.length, 4);
});

test('low and high pace and short and long loads use independent traceable observations', () => {
  const history = [
    hike('low'), hike('moderate', { ascent: 320, load: null }),
    hike('high', { distance: 12, ascent: 900, hours: 7, load: 2 }),
    hike('unknown-ascent', { distance: 13, ascent: null, load: null })
  ];
  const rec = assess(history).recommendations;
  assert.equal(rec.lowAscentPaceMinPerKm.value, 15);
  assert.equal(rec.highAscentPaceMinPerKm.value, 35);
  assert.deepEqual(rec.highAscentPaceMinPerKm.recordRefs.map(ref => ref.id), ['high']);
  assert.deepEqual(rec.shortTripLoadKg.recordRefs.map(ref => ref.id), ['low']);
  assert.deepEqual(rec.longTripLoadKg.recordRefs.map(ref => ref.id), ['high']);
  assert.equal(rec.longTripLoadKg.value, 2);
});

test('recency, moderate effort, repeated routes and unusual duration lower distance evidence credit', () => {
  const current = [hike('a'), hike('b')];
  assert.equal(distance(current).effectiveCount, 2);
  assert.equal(distance(current.map(item => ({ ...item, date: '2026-05-23' }))).effectiveCount, 1);
  assert.equal(distance(current.map(item => ({ ...item, effortLevel: 3 }))).effectiveCount, 1.7);
  assert.equal(distance(current.map(item => ({ ...item, name: '同一路线' }))).effectiveCount, 1.65);
  assert.equal(distance(current.map(item => ({ ...item, hours: 60 }))).effectiveCount, 1.2);
});

test('history weight grows continuously with diminishing increments as useful observations accrue', () => {
  const history = Array.from({ length: 12 }, (_, i) => hike(i));
  let previousWeight = 0;
  let previousIncrement = 1;
  for (let count = 1; count <= history.length; count++) {
    const { historyWeight } = distance(history.slice(0, count));
    closeTo(historyWeight, count / (count + 4));
    const increment = historyWeight - previousWeight;
    assert.ok(increment > 0 && increment < previousIncrement);
    previousWeight = historyWeight;
    previousIncrement = increment;
  }
});

test('an isolated 120 km record has bounded influence and does not widen a mature typical group', () => {
  const extreme = hike('extreme', { distance: 120, ascent: 4000, hours: 40 });
  assert.deepEqual(distance([extreme]).range, distance([hike('normal')]).range);
  const history = Array.from({ length: 6 }, (_, i) => hike(i, { distance: 7 + i / 4 }));
  assert.deepEqual(distance([...history, extreme]), distance(history));
});

test('repeating exactly the same input is deterministic without modifying history or self assessment', () => {
  const history = Object.freeze([Object.freeze(hike('A')), Object.freeze(hike('B', { effortLevel: 5, distance: 4 }))]);
  const self = Object.freeze({ comfortableDistanceKm: 7, comfortableAscentM: 100 });
  assert.deepEqual(assess(history, self), assess(history, self));
});
