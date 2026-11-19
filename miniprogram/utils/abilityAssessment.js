const { inspectRecord, metricNumber } = require('./hikeHistory');

const RULES = Object.freeze({
  minimumSamples: 3,
  supportedSamples: 6,
  minimumCoverage: 0.75,
  recentDays: 180,
  minimumRecentShare: 0.5,
  minimumSpanDays: 21,
  minimumDistanceSpreadKm: 2,
  minimumAscentSpreadM: 150,
  distanceTolerance: 0.25,
  ascentTolerance: 0.30,
  minimumAscentToleranceM: 100,
  selfAssessmentTolerance: 0.10,
  flatSpeedKmPerHour: 5,
  climbMPerHour: 600
});

const DAILY_RULES = Object.freeze({
  quartileSamples: 5,
  distanceRadiusRatio: 0.40,
  minimumDistanceRadiusKm: 1.5,
  distanceGapRatio: 0.25,
  minimumDistanceGapKm: 2.5,
  minimumGroupShare: 2 / 3,
  lowAscentMaxMPerKm: 30,
  moderateAscentMaxMPerKm: 60,
  shortTripMaxKm: 10
});

const SOURCE = 'trailready_trips.history';
const DAY_MS = 86400000;
const ROUTE_LIMIT = '耗时为经验估计，可能包含休息时间。高海拔、极端天气和复杂技术路线超出模型适用范围。';
const SELF_FIELDS = [
  { key: 'comfortableDistanceKm', metrics: ['distanceKm'], minimumDifference: 1 },
  { key: 'comfortableAscentM', metrics: ['ascentM'], minimumDifference: 100 },
  { key: 'comfortableDurationHours', metrics: [] },
  { key: 'typicalLoadKg', metrics: ['shortTripLoadKg', 'longTripLoadKg'], minimumDifference: 1 }
];

function prepareHistory(history, asOfDate) {
  const asOfMs = Date.parse(asOfDate + 'T00:00:00Z');
  if (!Number.isFinite(asOfMs) || new Date(asOfMs).toISOString().slice(0, 10) !== asOfDate) {
    throw new TypeError('Expected asOfDate in YYYY-MM-DD format');
  }
  const records = Array.isArray(history) ? history : [];
  const usable = [];
  const needsReview = [];
  records.forEach((raw, index) => {
    const quality = inspectRecord(raw, asOfDate);
    const { record, fields, missingFields } = quality;
    const invalidFields = Object.keys(fields).filter(field => !missingFields.includes(field));
    const id = raw?.id;
    const ref = { id: typeof id === 'string' || Number.isFinite(id) ? id : null, date: record?.date || null, index };
    const pace = record?.distance && record?.hours ? 60 * record.hours / record.distance : null;
    const canUsePace = quality.validRecord && Number.isFinite(pace) && pace > 0;
    if (!quality.eligible || !canUsePace) {
      needsReview.push({ ref, validRecord: quality.validRecord, missingFields, invalidFields });
    }
    if (!canUsePace) return;
    usable.push({
      ref, name: record.name, distanceKm: record.distance, ascentM: record.ascent, durationHours: record.hours,
      loadKg: record.load, effortLevel: record.effortLevel, paceMinPerKm: pace, invalidFields
    });
  });
  return { asOfMs, totalCount: records.length, usable, needsReview };
}

function quantile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const index = Math.floor(position);
  return sorted[index] + ((sorted[index + 1] ?? sorted[index]) - sorted[index]) * (position - index);
}

function bounds(values) {
  if (!values.length) return null;
  let low = values[0], high = values[0];
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return { low, high };
}

function evidence(samples, asOfMs) {
  const dates = samples.map(sample => Date.parse(sample.ref.date + 'T00:00:00Z'));
  const dateBounds = bounds(dates);
  const distances = bounds(samples.map(sample => sample.distanceKm));
  const ascents = bounds(samples.map(sample => sample.ascentM).filter(value => value !== null));
  const recentCount = dates.filter(date => asOfMs - date <= RULES.recentDays * DAY_MS).length;
  const spanDays = dateBounds ? (dateBounds.high - dateBounds.low) / DAY_MS : 0;
  const distanceSpreadKm = distances ? distances.high - distances.low : 0;
  const ascentSpreadM = ascents ? ascents.high - ascents.low : 0;
  const recentShare = samples.length ? recentCount / samples.length : 0;
  return { recentCount, recentShare, spanDays, distanceSpreadKm, ascentSpreadM,
    diverse: distanceSpreadKm >= RULES.minimumDistanceSpreadKm && ascentSpreadM >= RULES.minimumAscentSpreadM };
}

function hasSupportedEvidence(sampleCount, coverage, ratedShare, quality) {
  return sampleCount >= RULES.supportedSamples && coverage >= RULES.minimumCoverage
    && ratedShare >= RULES.minimumCoverage && quality.recentShare >= RULES.minimumRecentShare
    && quality.spanDays >= RULES.minimumSpanDays && quality.diverse;
}

function typicalDistanceGroup(samples) {
  if (samples.length < RULES.minimumSamples) return [];
  const sorted = [...samples].sort((a, b) => a.distanceKm - b.distanceKm);
  const center = quantile(sorted.map(sample => sample.distanceKm), 0.5);
  const radius = Math.max(DAILY_RULES.minimumDistanceRadiusKm, center * DAILY_RULES.distanceRadiusRatio);
  const group = sorted.filter(sample => Math.abs(sample.distanceKm - center) <= radius);
  if (group.length < RULES.minimumSamples || group.length / samples.length < DAILY_RULES.minimumGroupShare) return [];
  const maxGap = Math.max(DAILY_RULES.minimumDistanceGapKm, center * DAILY_RULES.distanceGapRatio);
  const hasGap = group.some((sample, i) => i > 0 && sample.distanceKm - group[i - 1].distanceKm > maxGap);
  return hasGap ? [] : group;
}

function ascentBand({ ascentM, distanceKm }) {
  if (ascentM === null) return 'unknown';
  const ascentPerKm = ascentM / distanceKm;
  if (ascentPerKm <= DAILY_RULES.lowAscentMaxMPerKm) return 'low';
  return ascentPerKm <= DAILY_RULES.moderateAscentMaxMPerKm ? 'moderate' : 'high';
}

// Each metric reports availability in its own cohort. Missing/invalid ascent on
// an otherwise valid hike counts as unclassified for both pace metrics.
function summarizeMetric(samples, asOfMs, {
  key, unit, requiredKey = key, field, condition = null, selected,
  insufficientReason = 'insufficient_samples'
}) {
  const present = samples.filter(sample => sample[requiredKey] !== null);
  const invalidCount = field ? samples.filter(sample => sample.invalidFields.includes(field)).length : 0;
  const result = {
    unit, condition, status: 'insufficient', reason: insufficientReason, sampleCount: present.length, usedCount: 0,
    missingCount: samples.length - present.length - invalidCount, invalidCount,
    method: null, range: null, median: null, observedRange: bounds(present.map(sample => sample[key])), recordRefs: []
  };
  const used = selected ?? present;
  if (used.length < RULES.minimumSamples) return result;
  const values = used.map(sample => sample[key]).sort((a, b) => a - b);
  const { recentShare, spanDays } = evidence(used, asOfMs);
  const supported = used.length >= RULES.supportedSamples && used.length / samples.length >= RULES.minimumCoverage
    && recentShare >= RULES.minimumRecentShare && spanDays >= RULES.minimumSpanDays;
  let range = null;
  let method = 'median';
  if (key === 'distanceKm') {
    const quartiles = values.length >= DAILY_RULES.quartileSamples;
    method = quartiles ? 'typical_group_interquartile' : 'typical_group_range';
    range = quartiles ? { low: quantile(values, 0.25), high: quantile(values, 0.75) } : bounds(values);
  }
  return { ...result, status: supported ? 'supported' : 'preliminary', reason: null, usedCount: used.length,
    method, range, median: quantile(values, 0.5), recordRefs: used.map(sample => sample.ref) };
}

function compareSelfAssessment(selfAssessment, metrics) {
  const values = {
    experienceLevel: selfAssessment?.experienceLevel || '',
    fitnessLevel: selfAssessment?.fitnessLevel || ''
  };
  const differences = [];
  for (const { key, metrics: comparisonKeys, minimumDifference } of SELF_FIELDS) {
    const value = metricNumber(selfAssessment?.[key]) ?? null;
    values[key] = value;
    if (value === null) continue;
    for (const metric of comparisonKeys) {
      const { range, observedRange, status } = metrics[metric];
      if (status === 'insufficient') continue;
      const comparisonRange = range ?? observedRange;
      const tolerance = Math.max(minimumDifference, comparisonRange.high * RULES.selfAssessmentTolerance);
      if (value > comparisonRange.high + tolerance || value < comparisonRange.low - tolerance) {
        differences.push({ key, metric, value, comparisonRange, direction: value > comparisonRange.high ? 'above' : 'below' });
      }
    }
  }
  return { source: 'trailready_user_profile', values, differences };
}

// Pass the same local calendar date to reproduce the result. Each metric provides
// its own condition and supporting recordRefs. referenceRecords keep the original
// distance/ascent pairs, and ref.index identifies older records without an ID.
function generateDailyAbility(history, selfAssessment, asOfDate) {
  const { asOfMs, totalCount, usable, needsReview } = prepareHistory(history, asOfDate);
  const rated = usable.filter(record => record.effortLevel !== null);
  const referenceRecords = rated.filter(record => record.effortLevel <= 3)
    .map(record => ({ ...record, ascentBand: ascentBand(record) }));
  const moderateCount = referenceRecords.filter(record => record.effortLevel === 3).length;
  const highEffortRecords = rated.filter(record => record.effortLevel >= 4);
  const typical = typicalDistanceGroup(referenceRecords);
  const ascentCandidates = typical.length ? typical : referenceRecords;
  const ascentPairs = typical.filter(record => record.ascentM !== null);
  const ascentDistanceRange = bounds(ascentPairs.map(record => record.distanceKm));
  const { lowAscentMaxMPerKm, moderateAscentMaxMPerKm, shortTripMaxKm } = DAILY_RULES;
  const metrics = {
    distanceKm: summarizeMetric(referenceRecords, asOfMs, {
      key: 'distanceKm', unit: 'km', selected: typical,
      insufficientReason: referenceRecords.length >= RULES.minimumSamples ? 'dispersed_distances' : 'insufficient_samples'
    }),
    ascentM: summarizeMetric(ascentCandidates, asOfMs, {
      key: 'ascentM', unit: 'm', field: 'ascent', condition: { distanceKm: ascentDistanceRange },
      selected: ascentPairs,
      insufficientReason: typical.length ? 'insufficient_samples' : 'no_distance_group'
    }),
    lowAscentPaceMinPerKm: summarizeMetric(
      referenceRecords.filter(record => record.ascentBand === 'low' || record.ascentBand === 'unknown'), asOfMs,
      { key: 'paceMinPerKm', unit: 'min/km', requiredKey: 'ascentM', field: 'ascent',
        condition: { ascentMPerKm: { maxInclusive: lowAscentMaxMPerKm } } }
    ),
    highAscentPaceMinPerKm: summarizeMetric(
      referenceRecords.filter(record => record.ascentBand === 'high' || record.ascentBand === 'unknown'), asOfMs,
      { key: 'paceMinPerKm', unit: 'min/km', requiredKey: 'ascentM', field: 'ascent',
        condition: { ascentMPerKm: { minExclusive: moderateAscentMaxMPerKm } } }
    ),
    shortTripLoadKg: summarizeMetric(referenceRecords.filter(record => record.distanceKm <= shortTripMaxKm), asOfMs, {
      key: 'loadKg', unit: 'kg', field: 'load', condition: { distanceKm: { maxInclusive: shortTripMaxKm } }
    }),
    longTripLoadKg: summarizeMetric(referenceRecords.filter(record => record.distanceKm > shortTripMaxKm), asOfMs, {
      key: 'loadKg', unit: 'kg', field: 'load', condition: { distanceKm: { minExclusive: shortTripMaxKm } }
    })
  };
  const results = Object.values(metrics);
  const availableCount = results.filter(metric => metric.status !== 'insufficient').length;
  let status = availableCount ? 'preliminary' : 'insufficient';
  if (results.every(metric => metric.status === 'supported')) status = 'supported';
  return {
    asOfDate, source: SOURCE, status, availableCount, metrics,
    counts: { total: totalCount, usable: usable.length, reference: referenceRecords.length,
      comfortable: referenceRecords.length - moderateCount, moderate: moderateCount, highEffort: highEffortRecords.length,
      unrated: usable.length - rated.length },
    referenceRecords, highEffortRecords, needsReview,
    selfAssessment: compareSelfAssessment(selfAssessment, metrics),
    limitations: [
      '各项以体感 1–3 级的经历分组计算。距离和爬升需按原记录配对理解。',
      '爬升分组按每公里累计爬升计算，仅用于历史比较。',
      '负重仅反映个人历史携带表现，实际行前装备需求另行评估。'
    ]
  };
}

function baseHours(distanceKm, ascentM) {
  return distanceKm / RULES.flatSpeedKmPerHour + ascentM / RULES.climbMPerHour;
}

function comparableTo(route, sample) {
  return Math.abs(route.distanceKm - sample.distanceKm) <= route.distanceKm * RULES.distanceTolerance
    && Math.abs(route.ascentM - sample.ascentM) <= Math.max(RULES.minimumAscentToleranceM, route.ascentM * RULES.ascentTolerance);
}

// Route accepts {distanceKm, ascentM} and optional boolean flags highAltitude,
// extremeWeather and technicalTerrain. Only timed, dated hikes with known ascent
// calibrate the median factor, regardless of their reported effort.
function estimateTripDuration(route, history, asOfDate) {
  const { asOfMs, totalCount, usable } = prepareHistory(history, asOfDate);
  const samples = usable.filter(record => record.ascentM !== null).map(record => {
    const baseline = baseHours(record.distanceKm, record.ascentM);
    return { ...record, baseHours: baseline, factor: record.durationHours / baseline };
  }).filter(record => Number.isFinite(record.factor) && record.factor > 0);
  const distanceKm = metricNumber(route?.distanceKm);
  const ascentM = metricNumber(route?.ascentM);
  const result = {
    asOfDate, source: SOURCE, model: 'naismith-median-factor',
    status: 'insufficient', baseHours: null, factor: null, referenceHours: null, paceMinPerKm: null,
    sampleCount: samples.length, comparableCount: 0, calibrationRecords: samples,
    warnings: [], limitations: [ROUTE_LIMIT]
  };
  if (distanceKm == null || distanceKm <= 0 || ascentM == null || baseHours(distanceKm, ascentM) <= 0) {
    return { ...result, reason: 'route_metrics_required', message: '请提供目标路线的正距离和已知累计爬升。' };
  }
  if (route.highAltitude || route.extremeWeather || route.technicalTerrain) {
    return { ...result, reason: 'unsupported_conditions', message: ROUTE_LIMIT };
  }
  result.baseHours = baseHours(distanceKm, ascentM);
  if (samples.length < RULES.minimumSamples) {
    return { ...result, reason: 'insufficient_history', message: '暂无足够历史依据。' };
  }

  const distanceBounds = bounds(samples.map(record => record.distanceKm));
  const ascentBounds = bounds(samples.map(record => record.ascentM));
  const ascentMargin = Math.max(RULES.minimumAscentToleranceM, ascentM * RULES.ascentTolerance);
  const outsideCoverage = distanceKm > distanceBounds.high * (1 + RULES.distanceTolerance)
    || distanceKm < distanceBounds.low * (1 - RULES.distanceTolerance)
    || ascentM > ascentBounds.high + ascentMargin || ascentM < ascentBounds.low - ascentMargin;
  const target = { distanceKm, ascentM };
  result.comparableCount = samples.filter(record => comparableTo(target, record)).length;
  if (outsideCoverage) result.warnings.push('目标路线明显超出历史距离或爬升覆盖范围，耗时为外推参考。');
  if (result.comparableCount < RULES.minimumSamples) result.warnings.push('距离和爬升同时接近目标路线的历史记录不足。');

  const factors = samples.map(record => record.factor).sort((a, b) => a - b);
  const factor = quantile(factors, 0.5);
  const referenceHours = result.baseHours * factor;
  const paceMinPerKm = 60 * (referenceHours / distanceKm);
  if (!Number.isFinite(referenceHours) || !Number.isFinite(paceMinPerKm) || referenceHours <= 0 || paceMinPerKm <= 0) {
    return { ...result, reason: 'estimate_out_of_range', message: '输入超出可计算范围。' };
  }
  const ratedShare = samples.filter(record => record.effortLevel !== null).length / samples.length;
  const supported = !outsideCoverage && result.comparableCount >= RULES.minimumSamples
    && hasSupportedEvidence(samples.length, samples.length / totalCount, ratedShare, evidence(samples, asOfMs));
  return { ...result, status: supported ? 'supported' : 'preliminary', factor, referenceHours, paceMinPerKm };
}

module.exports = { generateDailyAbility, estimateTripDuration };
