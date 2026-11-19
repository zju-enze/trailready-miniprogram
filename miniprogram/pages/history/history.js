const trips = require('../../utils/trips');
const profile = require('../../utils/userProfile');
const { getTodayString } = require('../../utils/dateUtils');
const { EFFORT_LABELS, METRICS, inspectRecord, readHistory } = require('../../utils/hikeHistory');
const { generateDailyAbility } = require('../../utils/abilityAssessment');

const HISTORY_PREVIEW_LIMIT = 3;

const ABILITY_FIELDS = [
  { key: 'distanceKm', label: '适宜徒步距离', unit: 'km' },
  { key: 'ascentM', label: '适宜累计爬升', unit: 'm' },
  { key: 'lowAscentPaceMinPerKm', label: '低爬升参考全程配速', unit: '分/km' },
  { key: 'highAscentPaceMinPerKm', label: '高爬升参考全程配速', unit: '分/km' },
  { key: 'shortTripLoadKg', label: '短途个人参考负重', unit: 'kg' },
  { key: 'longTripLoadKg', label: '长途个人参考负重', unit: 'kg' }
];
const ABILITY_STATUS = {
  insufficient: '数据不足', preliminary: '初步历史参考', supported: '历史依据相对充分'
};

function displayNumber(value) {
  return value > 0 && value < 0.1 ? '<0.1' : String(Number(value.toFixed(1)));
}

function displayRange({ low, high }) {
  const start = displayNumber(low);
  const end = displayNumber(high);
  return start === end ? start : start + '–' + end;
}

function conditionLabel(condition) {
  const density = condition?.ascentMPerKm;
  const distance = condition?.distanceKm;
  if (distance?.low != null) return '对应距离 ' + displayRange(distance) + ' km';
  const bounds = density ?? distance;
  if (!bounds) return '';
  const limit = bounds.maxInclusive == null ? '>' + bounds.minExclusive : '≤' + bounds.maxInclusive;
  return limit + (density ? ' m/km' : ' km');
}

function dailyAbilityView({ status, metrics, counts, selfAssessment, limitations }) {
  const rows = ABILITY_FIELDS.map(({ key, label, unit }) => {
    const metric = metrics[key];
    const { range, method, median, sampleCount, usedCount } = metric;
    const condition = conditionLabel(metric.condition);
    if (median === null) {
      const reason = {
        dispersed_distances: '距离过于分散',
        no_distance_group: '缺少可比距离组',
        insufficient_samples: '样本不足'
      }[metric.reason];
      const detail = [condition, reason, sampleCount + ' 条有效记录'].filter(Boolean).join(' · ');
      return { key, label, value: '暂无可靠参考', detail };
    }
    const value = (range ? displayRange(range) : displayNumber(median)) + ' ' + unit;
    const basis = {
      typical_group_range: '典型距离组',
      typical_group_interquartile: '典型组中间一半',
      median: '历史中位数'
    }[method];
    const detail = [key === 'ascentM' ? '' : condition, ABILITY_STATUS[metric.status], basis, usedCount + ' 条'].filter(Boolean).join(' · ');
    return { key, label, value, detail, condition: key === 'ascentM' ? condition : '' };
  });
  const comparisons = selfAssessment.differences.map(({ key, metric, direction }) => {
    const { label } = profile.METRIC_FIELDS.find(field => field.key === key);
    const result = direction === 'above' ? '高于' : '低于';
    const group = { distanceKm: '典型距离组的参考', ascentM: '相近距离的历史',
      shortTripLoadKg: '短途历史', longTripLoadKg: '长途历史' }[metric];
    return { key: metric, text: '自评' + label + result + group + '范围。' };
  });
  return { status, label: ABILITY_STATUS[status], rows, counts, comparisons, limitations };
}

const STAT_FIELDS = [
  { key: 'distance', maximum: 'maxDistanceKm', label: '最长距离', unit: 'km' },
  { key: 'ascent', maximum: 'maxAscentM', label: '最大累计爬升', unit: 'm' },
  { key: 'hours', maximum: 'maxDurationHours', label: '最长记录用时', unit: '小时' },
  { key: 'load', maximum: 'maxLoadKg', label: '最大负重', unit: 'kg' }
];

function selfRows(assessment) {
  return [
    { key: 'experienceLevel', label: '徒步经验', value: profile.EXPERIENCE_OPTIONS.find(option => option.value === assessment.experienceLevel).label },
    { key: 'fitnessLevel', label: '自评体能', value: profile.FITNESS_OPTIONS.find(option => option.value === assessment.fitnessLevel).label },
    ...profile.METRIC_FIELDS.map(({ key, label, unit }) => ({ key, label,
      value: assessment[key] == null ? '尚未填写' : assessment[key] + ' ' + unit }))
  ];
}

function formText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

Page({
  data: {
    records: [], recentRecords: [], profileExpanded: false, historyExpanded: false,
    draft: null, error: '', fields: {}, today: '', efforts: EFFORT_LABELS, metrics: METRICS,
    effortIndex: 0, legacyEffort: '', profileError: '', historyError: '', selfRows: [], stats: null, statRows: [],
    recentLoads: [], showLoads: false, statsNotice: '', ability: null, abilityExpanded: false
  },
  onShow() {
    this.getTabBar?.()?.setData({ route: this.route });
    this.refresh();
  },
  refresh() {
    const today = getTodayString();
    const history = readHistory();
    const assessment = profile.read();
    const performance = profile.getPerformanceStats(history);
    this.historyRecords = history.ok ? [...history.records] : [];
    const records = this.historyRecords.map((raw, index) => {
      const quality = inspectRecord(raw, today);
      return { ...quality.record, index, needsReview: !quality.eligible,
        sortDate: quality.fields.date ? '' : (quality.record?.date || '') };
    }).sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.index - b.index);
    const stats = performance.ok ? performance.stats : null;
    const selfAssessment = assessment.ok ? assessment.profile.selfAssessment : null;
    const ability = history.ok ? dailyAbilityView(generateDailyAbility(history.records, selfAssessment, today)) : null;
    const rows = selfAssessment ? selfRows(selfAssessment) : [];
    const hasAssessment = rows.some(row => row.value !== '尚未填写');
    const summary = rows.slice(0, 2).find(row => row.value !== '尚未填写');
    this.setData({
      today, records, recentRecords: records.slice(0, HISTORY_PREVIEW_LIMIT), stats, ability,
      historyError: history.ok ? '' : history.error.message,
      profileError: assessment.ok ? '' : assessment.error.message,
      selfRows: rows, hasAssessment, profileSummary: summary?.value || (hasAssessment ? '已填写' : '未填写'),
      statRows: stats ? STAT_FIELDS.map(field => ({ ...field,
        value: stats[field.maximum] == null ? '暂无记录' : stats[field.maximum] + ' ' + field.unit
      })) : [],
      recentLoads: stats ? stats.loadRecords.slice(0, 5).map((record, key) => ({ ...record, key })) : [],
      statsNotice: stats && stats.ignoredRecordCount ? stats.ignoredRecordCount + ' 条记录缺少有效路线名或日期，暂未计入次数。' : ''
    });
  },
  toggleAbility() { this.setData({ abilityExpanded: !this.data.abilityExpanded }); },
  toggleProfile() { this.setData({ profileExpanded: !this.data.profileExpanded }); },
  toggleHistory() { this.setData({ historyExpanded: !this.data.historyExpanded }); },
  toggleLoads() { this.setData({ showLoads: !this.data.showLoads }); },
  edit(e) {
    if (this.data.historyError) return;
    const { index } = e.currentTarget.dataset;
    const existing = Number.isInteger(index);
    const raw = existing ? this.historyRecords[index] : null;
    const { record, fields } = inspectRecord(raw, this.data.today);
    this.editingRecord = existing ? { index, snapshot: JSON.stringify(raw), raw: record ? raw : null } : null;
    const draft = { name: record?.name || '', date: existing ? record?.date || '' : this.data.today, note: record?.note || '' };
    for (const { key } of METRICS) draft[key] = formText(raw?.[key]);
    this.setData({ draft, existing, pickerDate: fields.date ? this.data.today : draft.date || this.data.today,
      effortIndex: record?.effortLevel ?? 0,
      legacyEffort: typeof raw?.legacyEffort === 'string' ? raw.legacyEffort
        : (record?.effortLevel == null ? record?.effort || '' : ''), error: '', fields: {} });
  },
  changeDate(e) { this.setData({ 'draft.date': e.detail.value, pickerDate: e.detail.value }); },
  changeEffort(e) { this.setData({ effortIndex: Number(e.detail.value) }); },
  cancel() {
    this.editingRecord = null;
    this.setData({ draft: null });
  },
  saveRecord(e) {
    const { draft, effortIndex } = this.data;
    const values = e.detail.value;
    const form = { ...draft, name: formText(values.name), note: formText(values.note) };
    for (const { key } of METRICS) form[key] = formText(values[key]);
    const { eligible, record, fields } = inspectRecord({ ...form, effortLevel: effortIndex || null });
    if (!eligible) return this.setData({ draft: form, fields, error: '请检查标记的字段。' });

    const editing = this.editingRecord;
    const previous = editing?.raw;
    const legacyEffort = previous?.effort;
    const next = { ...previous, ...record, id: (typeof previous?.id === 'string' && previous.id) || String(Date.now()) };
    if (this.data.legacyEffort && next.legacyEffort === undefined) next.legacyEffort = legacyEffort;
    if (!this.persistRecord(next, editing)) {
      return this.setData({ draft: form, fields: {}, error: '经历未保存，请重试。若记录已变化，请返回后重新打开。' });
    }
    this.cancel();
    this.refresh();
  },
  persistRecord(record, editing) {
    return trips.save(book => {
      const history = book.history ?? [];
      if (!Array.isArray(history)) throw Error('Invalid history');
      if (editing && JSON.stringify(history[editing.index]) !== editing.snapshot) throw Error('History entry changed');
      book.history = editing
        ? history.flatMap((item, index) => index === editing.index ? (record ? [record] : []) : [item])
        : [record, ...history];
    });
  },
  remove() {
    const editing = this.editingRecord;
    if (!editing) return;
    wx.showModal({ title: '删除这次经历？', content: this.data.draft.name || '未命名徒步', confirmText: '删除', success: res => {
      if (!res.confirm) return;
      if (this.persistRecord(null, editing)) {
        this.cancel();
        this.refresh();
      } else this.setData({ error: '经历未删除，请返回后重新打开记录。' });
    } });
  }
});
