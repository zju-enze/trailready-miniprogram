const trips = require('../../utils/trips');
const profile = require('../../utils/userProfile');
const { getTodayString } = require('../../utils/dateUtils');
const { EFFORT_LABELS, METRICS, inspectRecord, readHistory } = require('../../utils/hikeHistory');

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
    records: [], draft: null, error: '', fields: {}, today: '', efforts: EFFORT_LABELS, metrics: METRICS,
    effortIndex: 0, legacyEffort: '', profileError: '', historyError: '', selfRows: [], stats: null, statRows: [],
    recentLoads: [], showLoads: false, statsNotice: ''
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
    this.historyRecords = history.ok ? history.records : [];
    const records = this.historyRecords.map((raw, index) => {
      const quality = inspectRecord(raw, today);
      return { ...quality.record, index, needsReview: !quality.eligible };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stats = performance.ok ? performance.stats : null;
    this.setData({
      today, records, stats,
      historyError: history.ok ? '' : history.error.message,
      profileError: assessment.ok ? '' : assessment.error.message,
      selfRows: assessment.ok ? selfRows(assessment.profile.selfAssessment) : [],
      statRows: stats ? STAT_FIELDS.map(field => ({ ...field,
        value: stats[field.maximum] == null ? '暂无记录' : stats[field.maximum] + ' ' + field.unit
      })) : [],
      recentLoads: stats ? stats.loadRecords.slice(0, 5).map((record, key) => ({ ...record, key })) : [],
      statsNotice: stats && stats.ignoredRecordCount ? '部分记录的路线名称或日期待完善，暂不计入统计。' : ''
    });
  },
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
