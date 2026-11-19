const trips = require('./trips');
const { getTodayString } = require('./dateUtils');

const EFFORT_LABELS = ['请选择', '非常轻松', '比较轻松', '适中', '比较吃力', '非常吃力'];
const LEGACY_LEVELS = new Map([['轻松', 2], ['适中', 3], ['吃力', 4]]);
const METRICS = [
  { key: 'distance', label: '实际里程', unit: 'km', required: true },
  { key: 'hours', label: '用时', unit: '小时', required: true },
  { key: 'ascent', label: '累计爬升', unit: 'm', required: false },
  { key: 'load', label: '背包重量', unit: 'kg', required: false }
];

function isRecord(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

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

function normalizeEffort({ effortLevel, effort }) {
  const legacy = typeof effort === 'string' && effort.trim() !== '未填写' ? effort.trim() : '';
  if (Number.isInteger(effortLevel) && effortLevel >= 1 && effortLevel <= 5) {
    return { level: effortLevel, label: EFFORT_LABELS[effortLevel] };
  }
  const level = effortLevel == null ? LEGACY_LEVELS.get(legacy) : undefined;
  return { level: level ?? null, label: level ? EFFORT_LABELS[level] : legacy };
}

function validDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// This checks data completeness only. It does not select representative hikes.
function inspectRecord(record, today = getTodayString()) {
  if (!isRecord(record)) return { validRecord: false, eligible: false, record: null, fields: {}, missingFields: [] };
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const effort = normalizeEffort(record);
  const fields = {};
  const missingFields = [];
  if (!name) fields.name = '请填写实际走过的路线名称。';
  if (!validDate(record.date, today)) fields.date = '请选择有效的徒步日期，日期不能晚于今天。';
  if (effort.level === null) fields.effortLevel = '请选择五级徒步体感。';
  for (const key of ['name', 'date', 'effortLevel']) {
    const value = key === 'effortLevel' ? record.effortLevel ?? record.effort : record[key];
    if (fields[key] && (value == null || value === '' || (key === 'effortLevel' && value === '未填写'))) {
      missingFields.push(key);
    }
  }
  const normalized = {
    id: typeof record.id === 'string' ? record.id : null,
    name, date: typeof record.date === 'string' ? record.date : '',
    effortLevel: effort.level, effort: effort.label, note: typeof record.note === 'string' ? record.note : ''
  };
  for (const { key, label, unit, required } of METRICS) {
    const value = metricNumber(record[key]);
    if (value === null) missingFields.push(key);
    if (required && (value == null || value === 0)) {
      fields[key] = label + '须填写大于 0 的数值（' + unit + '）。';
    } else if (value === undefined) {
      fields[key] = label + '须填写非负数（' + unit + '），未知可留空。';
    }
    normalized[key] = fields[key] ? null : value;
  }
  return { validRecord: !fields.name && !fields.date, eligible: Object.keys(fields).length === 0,
    record: normalized, fields, missingFields };
}

function readHistory(book) {
  try {
    if (book === undefined) book = trips.read();
  } catch {
    return { ok: false, error: { code: 'STORAGE_READ_FAILED', message: '暂时无法读取徒步经历，请重试。' } };
  }
  if (!isRecord(book) || (book.history != null && !Array.isArray(book.history))) {
    return { ok: false, error: { code: 'INVALID_HISTORY', message: '徒步经历格式异常，原数据已保留。' } };
  }
  return { ok: true, records: book.history || [] };
}

module.exports = { EFFORT_LABELS, METRICS, metricNumber, normalizeEffort, inspectRecord, readHistory };
