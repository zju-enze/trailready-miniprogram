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
const ABILITY_SOURCE = {
  generic: '通用起步建议',
  self_assessment: '自评初步建议',
  single_history: '单次历史参考',
  limited_history: '有限历史参考',
  calibrated_history: '多次历史参考',
  self_reported: '自评常见负重',
  missing: ''
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

function dailyAbilityView({ status, metrics, recommendations, counts, selfAssessment, limitations, generalTiming }) {
  const distance = recommendations.distanceKm;
  const rows = ABILITY_FIELDS.map(({ key, label, unit }) => {
    const { source, range, value: observed, reportedValue, recordRefs, condition } = recommendations[key];
    const qualifier = conditionLabel(condition);
    let sourceLabel = ABILITY_SOURCE[source];
    let value = '暂无可靠参考';
    let basis = '';
    if (range) {
      value = displayRange(range) + ' ' + unit;
      if (distance.historyWeight > 0) {
        basis = recordRefs.length + ' 条舒适经历 · 历史权重 ' + Math.round(distance.historyWeight * 100) + '%';
      }
      if (distance.burdenRefs.length) {
        basis = [basis, distance.burdenRefs.length + ' 条相近高负担经历用于下调'].filter(Boolean).join(' · ');
      }
      const distanceSources = { single_history: '单次经历修正',
        limited_history: recordRefs.length + distance.burdenRefs.length <= 2 ? '少量经历修正' : '有限历史修正',
        calibrated_history: '多次历史校准' };
      sourceLabel = distanceSources[source] ?? sourceLabel;
    } else if (source === 'self_reported') {
      value = displayNumber(reportedValue) + ' ' + unit;
      basis = '未按长短途验证';
    } else if (observed != null) {
      value = displayNumber(observed) + ' ' + unit;
      basis = recordRefs.length ? recordRefs.length + ' 条经历的中位数' : '自评按对应距离的低爬升条件收敛';
    } else {
      basis = '缺少对应的历史数据';
    }
    return { key, label, value, sourceLabel, condition: key === 'ascentM' ? qualifier : '',
      detail: [key === 'ascentM' ? '' : qualifier, basis].filter(Boolean).join(' · ') };
  });
  const comparisons = selfAssessment.differences.map(({ key, metric, direction }) => {
    const { label } = profile.METRIC_FIELDS.find(field => field.key === key);
    const result = direction === 'above' ? '高于' : '低于';
    const group = { distanceKm: '典型距离组的参考', ascentM: '相近距离的历史',
      shortTripLoadKg: '短途历史', longTripLoadKg: '长途历史' }[metric];
    return { key: metric, text: '自评' + label + result + group + '范围。' };
  });
  const guidance = [];
  if (!distance.recordRefs.length) {
    guidance.push('尚未经历史经历验证。可先选路况和天气良好、容易折返的简单低爬升路线试走。');
  }
  if (distance.prior.rejected) guidance.push('自评距离超出起步校准范围，请核对。');
  if (distance.prior.limited) guidance.push('起步距离已按自评经验和体能限制。');
  if (distance.burdenRefs.length) guidance.push('相近路线曾较吃力，已谨慎下调距离参考。');
  if (distance.sparseConflict) guidance.push('两条经历距离差异较大，暂采用更接近起步距离的一条。');
  if (distance.scopedGroup) guidance.push('历史距离分成多组，采用较接近起步距离的一组。');
  else if (metrics.distanceKm.reason === 'dispersed_distances') guidance.push('历史距离较分散，暂以起步距离作参考。');
  const missingPace = ['lowAscentPaceMinPerKm', 'highAscentPaceMinPerKm']
    .some(key => recommendations[key].source === 'missing');
  const baseTimeNote = missingPace
    ? '通用基础耗时（小时）≈ 距离（km）÷ ' + generalTiming.flatSpeedKmPerHour
      + ' + 爬升（m）÷ ' + generalTiming.climbMPerHour + '，未计休息。'
    : '';
  return { status, rows, counts, comparisons, limitations, guidance, baseTimeNote,
    showSetup: distance.prior.source === 'generic' && distance.recordRefs.length === 0,
    label: distance.recordRefs.length ? '历史校准参考' : '起步参考' };
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
