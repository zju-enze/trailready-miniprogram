const { inspectRecord, metricNumber } = require('./hikeHistory');

const RULES = Object.freeze({
  minimumSamples: 3,
  quartileSamples: 5,
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

const SOURCE = 'trailready_trips.history';
const DAY_MS = 86400000;
const ROUTE_LIMIT = '耗时为经验估计，可能包含休息时间。高海拔、极端天气和复杂技术路线超出模型适用范围。';
const METRICS = [
  { key: 'distanceKm', unit: 'km' },
  { key: 'ascentM', unit: 'm', field: 'ascent' },
  { key: 'paceMinPerKm', unit: 'min/km' },
  { key: 'durationHours', unit: 'h' },
  { key: 'loadKg', unit: 'kg', field: 'load' }
];
const SELF_FIELDS = [
  { key: 'comfortableDistanceKm', metric: 'distanceKm', minimumDifference: 1 },
  { key: 'comfortableAscentM', metric: 'ascentM', minimumDifference: 100 },
  { key: 'comfortableDurationHours', metric: 'durationHours', minimumDifference: 0.5 },
  { key: 'typicalLoadKg', metric: 'loadKg', minimumDifference: 1 }
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

function summarizeMetric(samples, metric, asOfMs, baseSupported) {
  const present = samples.filter(sample => sample[metric.key] !== null);
  const invalidCount = samples.filter(sample => sample.invalidFields.includes(metric.field)).length;
  const result = {
    unit: metric.unit, status: 'insufficient', sampleCount: present.length,
    missingCount: samples.length - present.length - invalidCount, invalidCount,
    method: null, range: null, median: null, observedRange: null, recordRefs: present.map(sample => sample.ref)
  };
  if (present.length < RULES.minimumSamples) return result;
  const values = present.map(sample => sample[metric.key]).sort((a, b) => a - b);
  const observedRange = { low: values[0], high: values[values.length - 1] };
  const isQuartile = present.length >= RULES.quartileSamples;
  const supported = baseSupported && hasSupportedEvidence(
    present.length, present.length / samples.length, 1, evidence(present, asOfMs)
  );
  return { ...result, status: supported ? 'supported' : 'preliminary',
    method: isQuartile ? 'interquartile' : 'observed',
    range: isQuartile ? { low: quantile(values, 0.25), high: quantile(values, 0.75) } : observedRange,
    median: quantile(values, 0.5), observedRange };
}

function compareSelfAssessment(selfAssessment, metrics) {
  const values = {
    experienceLevel: selfAssessment?.experienceLevel || '',
    fitnessLevel: selfAssessment?.fitnessLevel || ''
  };
  const differences = [];
  for (const { key, metric, minimumDifference } of SELF_FIELDS) {
    const value = metricNumber(selfAssessment?.[key]) ?? null;
    values[key] = value;
    const observed = metrics[metric].observedRange;
    if (value === null || !observed) continue;
    const tolerance = Math.max(minimumDifference, observed.high * RULES.selfAssessmentTolerance);
    if (value > observed.high + tolerance || value < observed.low - tolerance) {
      differences.push({ key, metric, value, observedRange: observed, direction: value > observed.high ? 'above' : 'below' });
    }
  }
  return { source: 'trailready_user_profile', values, differences };
}

// Pass the same local calendar date to reproduce the result. Ranges are marginal;
// referenceRecords provide the original distance/ascent pairs. ref.index is the
// position in this input snapshot and also identifies older records with no ID.
function generateDailyAbility(history, selfAssessment, asOfDate) {
  const { asOfMs, totalCount, usable, needsReview } = prepareHistory(history, asOfDate);
  const rated = usable.filter(record => record.effortLevel !== null);
  const referenceRecords = rated.filter(record => record.effortLevel <= 3);
  const moderateCount = referenceRecords.filter(record => record.effortLevel === 3).length;
  const highEffortRecords = rated.filter(record => record.effortLevel >= 4);
  const paired = referenceRecords.filter(record => record.ascentM !== null);
  const quality = {
    ...evidence(paired, asOfMs), pairedCount: paired.length,
    usableShare: totalCount ? usable.length / totalCount : 0,
    ratedShare: usable.length ? rated.length / usable.length : 0,
    pairedShare: referenceRecords.length ? paired.length / referenceRecords.length : 0
  };
  const supported = quality.pairedShare >= RULES.minimumCoverage
    && hasSupportedEvidence(paired.length, quality.usableShare, quality.ratedShare, quality);
  const enough = referenceRecords.length >= RULES.minimumSamples;
  let status = 'insufficient';
  if (enough) status = supported ? 'supported' : 'preliminary';
  const metrics = {};
  for (const metric of METRICS) metrics[metric.key] = summarizeMetric(referenceRecords, metric, asOfMs, supported);
  return {
    asOfDate, source: SOURCE, status, metrics, quality,
    message: enough ? null : `记录至少 ${RULES.minimumSamples} 次体感 1–3 级、距离和用时完整的徒步后，可查看日常参考。`,
    counts: { total: totalCount, usable: usable.length, reference: referenceRecords.length,
      comfortable: referenceRecords.length - moderateCount, moderate: moderateCount, highEffort: highEffortRecords.length,
      unrated: usable.length - rated.length },
    referenceRecords, highEffortRecords, needsReview,
    selfAssessment: compareSelfAssessment(selfAssessment, metrics),
    limitations: [
      '距离与爬升分别统计，两项上限不能组合为安全路线。',
      '全程配速和记录用时可能含休息。实际用时仍取决于具体路线和条件。'
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
