const trips = require('./trips');
const { getTodayString } = require('./dateUtils');

const STORAGE = 'trailready_user_profile';
const VERSION = 1;
const EXPERIENCE_OPTIONS = [
  { value: '', label: '尚未填写' },
  { value: 'beginner', label: '初学徒步' },
  { value: 'occasional', label: '偶尔徒步' },
  { value: 'regular', label: '经常徒步' }
];
const FITNESS_OPTIONS = [
  { value: '', label: '尚未填写' },
  { value: 'low', label: '自评较弱' },
  { value: 'medium', label: '自评一般' },
  { value: 'high', label: '自评较好' }
];
const METRIC_FIELDS = [
  { key: 'comfortableDistanceKm', label: '可接受距离', unit: 'km', positive: true },
  { key: 'comfortableAscentM', label: '可接受累计爬升', unit: 'm', positive: false },
  { key: 'comfortableDurationHours', label: '可接受徒步时长', unit: '小时', positive: true },
  { key: 'typicalLoadKg', label: '常见负重', unit: 'kg', positive: false }
];
const HISTORY_METRICS = [
  { key: 'distance', maximum: 'maxDistanceKm' },
  { key: 'ascent', maximum: 'maxAscentM' },
  { key: 'hours', maximum: 'maxDurationHours' },
  { key: 'load', maximum: 'maxLoadKg' }
];

function isObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function failure(code, message, fields) {
  return { ok: false, error: { code, message, ...(fields ? { fields } : {}) } };
}

// Missing values stay null; coercible booleans and objects are invalid.
function metricNumber(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    value = value.trim();
    if (!value) return null;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return undefined;
  }
  return value;
}

function normalizeAssessment(input) {
  const values = {};
  const fields = {};
  for (const [key, options] of [['experienceLevel', EXPERIENCE_OPTIONS], ['fitnessLevel', FITNESS_OPTIONS]]) {
    const value = input[key] == null ? '' : input[key];
    if (options.some(option => option.value === value)) values[key] = value;
    else fields[key] = '请选择列表中的选项。';
  }
  for (const field of METRIC_FIELDS) {
    const value = metricNumber(input[field.key]);
    if (value === undefined || (field.positive && value === 0)) {
      fields[field.key] = field.positive ? '请填写大于 0 的数值，或留空。' : '请填写非负数，或留空。';
    } else values[field.key] = value;
  }
  return { values, fields };
}

function read() {
  let stored;
  try {
    stored = wx.getStorageSync(STORAGE);
  } catch {
    return failure('STORAGE_READ_FAILED', '暂时无法读取自评资料，请重试。');
  }
  if (stored == null || stored === '') {
    return { ok: true, exists: false, profile: { version: VERSION, selfAssessment: normalizeAssessment({}).values, updatedAt: null } };
  }
  try {
    if (typeof stored === 'string') stored = JSON.parse(stored);
  } catch {
    return failure('INVALID_STORED_DATA', '自评资料格式异常，原数据已保留。');
  }
  if (!isObject(stored)) return failure('INVALID_STORED_DATA', '自评资料格式异常，原数据已保留。');
  const version = stored.version == null ? 0 : stored.version;
  if (Number.isInteger(version) && version > VERSION) {
    return failure('UNSUPPORTED_VERSION', '自评资料来自更新版本，请更新小程序后再编辑。');
  }
  if (version !== 0 && version !== VERSION) {
    return failure('INVALID_STORED_DATA', '自评资料版本异常，原数据已保留。');
  }
  const input = version === 0 ? (stored.selfAssessment || stored) : stored.selfAssessment;
  if (!isObject(input)) return failure('INVALID_STORED_DATA', '自评资料格式异常，原数据已保留。');
  // Read the names used by the early design without rewriting existing storage.
  const normalized = normalizeAssessment({
    ...input,
    comfortableDistanceKm: input.comfortableDistanceKm === undefined ? input.comfortableDistance : input.comfortableDistanceKm,
    comfortableAscentM: input.comfortableAscentM === undefined ? input.comfortableAscent : input.comfortableAscentM,
    comfortableDurationHours: input.comfortableDurationHours === undefined ? input.comfortableContinuousHours : input.comfortableDurationHours,
    typicalLoadKg: input.typicalLoadKg === undefined ? input.usualLoad : input.typicalLoadKg
  });
  if (Object.keys(normalized.fields).length) {
    return failure('INVALID_STORED_DATA', '部分自评资料格式异常，原数据已保留。', normalized.fields);
  }
  return {
    ok: true, exists: true,
    profile: {
      ...(version === VERSION ? stored : {}), version: VERSION,
      selfAssessment: { ...(version === VERSION ? input : {}), ...normalized.values },
      updatedAt: Number.isSafeInteger(stored.updatedAt) && stored.updatedAt >= 0 ? stored.updatedAt : null
    }
  };
}

function save(changes) {
  const allowed = ['experienceLevel', 'fitnessLevel', ...METRIC_FIELDS.map(field => field.key)];
  if (!isObject(changes) || Object.keys(changes).some(key => !allowed.includes(key))) {
    return failure('INVALID_INPUT', '请只保存自评表单中的字段。');
  }
  const current = read();
  if (!current.ok) return current;
  const assessment = normalizeAssessment({ ...current.profile.selfAssessment, ...changes });
  if (Object.keys(assessment.fields).length) {
    return failure('INVALID_INPUT', '请检查标记的自评信息。', assessment.fields);
  }
  const profile = {
    ...current.profile,
    selfAssessment: { ...current.profile.selfAssessment, ...assessment.values }, updatedAt: Date.now()
  };
  try {
    wx.setStorageSync(STORAGE, profile);
    return { ok: true, profile };
  } catch {
    return failure('STORAGE_WRITE_FAILED', '保存失败，请重试。');
  }
}

function validHistoryDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const date = new Date(value + 'T00:00:00');
  if (!Number.isFinite(date.getTime())) return false;
  return date.getFullYear() === Number(value.slice(0, 4)) && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10));
}

function getPerformanceStats() {
  let book;
  try {
    book = trips.read();
  } catch {
    return failure('STORAGE_READ_FAILED', '暂时无法读取徒步经历，请重试。');
  }
  if (!isObject(book) || (book.history != null && !Array.isArray(book.history))) {
    return failure('INVALID_HISTORY', '徒步经历格式异常，请核对原始记录。');
  }
  const stats = {
    source: 'trailready_trips.history', totalHikes: 0, ignoredRecordCount: 0,
    maxDistanceKm: null, maxAscentM: null, maxDurationHours: null, maxLoadKg: null,
    metricCounts: { distance: 0, ascent: 0, hours: 0, load: 0 },
    invalidValueCounts: { distance: 0, ascent: 0, hours: 0, load: 0 },
    maxRecords: { distance: null, ascent: null, hours: null, load: null }, loadRecords: []
  };
  const today = getTodayString();
  for (const record of book.history || []) {
    if (!isObject(record) || typeof record.name !== 'string' || !record.name.trim() || !validHistoryDate(record.date, today)) {
      stats.ignoredRecordCount++;
      continue;
    }
    stats.totalHikes++;
    const source = { id: typeof record.id === 'string' ? record.id : null, name: record.name, date: record.date };
    for (const metric of HISTORY_METRICS) {
      const value = metricNumber(record[metric.key]);
      if (value === undefined) {
        stats.invalidValueCounts[metric.key]++;
        continue;
      }
      if (value === null) continue;
      stats.metricCounts[metric.key]++;
      if (stats[metric.maximum] === null || value > stats[metric.maximum]) {
        stats[metric.maximum] = value;
        stats.maxRecords[metric.key] = source;
      }
      if (metric.key === 'load') stats.loadRecords.push({ ...source, loadKg: value });
    }
  }
  stats.loadRecords.sort((a, b) => b.date.localeCompare(a.date));
  return { ok: true, stats };
}

module.exports = { read, save, getPerformanceStats, EXPERIENCE_OPTIONS, FITNESS_OPTIONS, METRIC_FIELDS };
