const trips = require('../../utils/trips');
const profile = require('../../utils/userProfile');
const { getTodayString } = require('../../utils/dateUtils');
const { EFFORT_LABELS, METRICS, inspectRecord, readHistory } = require('../../utils/hikeHistory');
const { generateDailyAbility } = require('../../utils/abilityAssessment');

const HISTORY_PREVIEW_LIMIT = 3;

const ABILITY_FIELDS = [
  { key: 'distanceKm', label: '参考徒步距离', unit: 'km' },
  { key: 'ascentM', label: '参考累计爬升', unit: 'm' },
  { key: 'paceMinPerKm', label: '历史全程参考配速', unit: '分/km' },
  { key: 'durationHours', label: '历史常见完成时长', unit: '小时' },
  { key: 'loadKg', label: '负重参考', unit: 'kg' }
];
const ABILITY_STATUS = {
  insufficient: '数据不足', preliminary: '初步历史参考', supported: '历史依据相对充分'
};

function displayNumber(value) {
  return value > 0 && value < 0.1 ? '<0.1' : String(Number(value.toFixed(1)));
}

function dailyAbilityView({ status, metrics, counts, message, selfAssessment, limitations }) {
  const rows = ABILITY_FIELDS.map(({ key, label, unit }) => {
    const { range, method, median, sampleCount } = metrics[key];
    const samples = sampleCount + ' 条记录';
    if (!range) return { key, label, value: '暂无可靠参考', detail: samples };
    const low = displayNumber(range.low);
    const high = displayNumber(range.high);
    const value = (low === high ? low : low + '–' + high) + ' ' + unit;
    const rangeType = method === 'interquartile' ? '中间一半 · 中位 ' + displayNumber(median) + ' ' + unit : '实际观察';
    return { key, label, value, detail: rangeType + ' · ' + samples };
  });
  const comparisons = selfAssessment.differences.map(({ key, direction }) => {
    const { label } = profile.METRIC_FIELDS.find(field => field.key === key);
    const result = direction === 'above' ? '高于' : '低于';
    return { key, text: '自评' + label + result + '已有日常参考记录的范围。' };
  });
  return { status, label: ABILITY_STATUS[status], rows, counts, message, comparisons, limitations };
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
