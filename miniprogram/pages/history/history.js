const trips = require('../../utils/trips');
const profile = require('../../utils/userProfile');
const { getTodayString } = require('../../utils/dateUtils');
const { EFFORT_LABELS, METRICS, inspectRecord, readHistory } = require('../../utils/hikeHistory');
const { generateDailyAbility } = require('../../utils/abilityAssessment');

const HISTORY_PREVIEW_LIMIT = 3;
const FORM_VALIDATION_ERROR = '请检查标记的字段。';

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
const HISTORY_SUFFICIENCY = {
  insufficient: '多条历史统计的依据仍不足。',
  preliminary: '部分指标已有初步历史参考。',
  supported: '各项历史统计已有较充分依据。'
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

function abilityValue({ range, value, reportedValue, source }, unit) {
  if (range) return displayRange(range) + ' ' + unit;
  const number = source === 'self_reported' ? reportedValue : value;
  return number == null ? '暂无可靠参考' : displayNumber(number) + ' ' + unit;
}

function cohortLine(label, { condition, recordRefs, source }) {
  const qualifier = conditionLabel(condition);
  const name = qualifier ? label + '（' + qualifier + '）' : label;
  const basis = source === 'missing' ? '暂无可靠参考' : ABILITY_SOURCE[source];
  return name + ' · ' + recordRefs.length + ' 条历史经历 · ' + basis;
}

function distanceExamples(refs, records) {
  // Preview three records from the actual selected group, in its original order.
  const preview = refs.length <= 3 ? refs : [refs[0], refs[Math.floor(refs.length / 2)], refs[refs.length - 1]];
  return preview.map(ref => records.find(record => record.ref.index === ref.index)).filter(Boolean)
    .map(({ name, ref, distanceKm, ascentM }) => {
      const parts = [name, ref.date, displayNumber(distanceKm) + ' km'];
      if (ascentM != null) parts.push('爬升 ' + displayNumber(ascentM) + ' m');
      return parts.join(' · ');
    });
}

function dailyAbilityView({ status, metrics, recommendations, counts, referenceRecords, selfAssessment, generalTiming }) {
  const { distanceKm: distance, ascentM: ascent, lowAscentPaceMinPerKm: lowPace, highAscentPaceMinPerKm: highPace,
    shortTripLoadKg: shortLoad, longTripLoadKg: longLoad } = recommendations;
  const rows = ABILITY_FIELDS.map(({ key, label, unit }) => ({ key, label, value: abilityValue(recommendations[key], unit) }));

  const distanceCount = distance.recordRefs.length;
  const distanceSources = { single_history: '单次经历修正',
    limited_history: distanceCount + distance.burdenRefs.length <= 2 ? '少量经历修正' : '有限历史修正',
    calibrated_history: '多次历史校准' };
  const source = distanceSources[distance.source] ?? ABILITY_SOURCE[distance.source];
  const overview = [
    '距离评估采用' + source + '。',
    counts.usable + ' 条有效经历，其中 ' + counts.reference + ' 条体感为 1–3 级。',
    HISTORY_SUFFICIENCY[status]
  ];
  if (!distanceCount) overview.push('起步建议尚未经舒适经历验证。可选天气和路况良好、容易折返的低爬升路线试走。');

  const distanceLines = ['距离采用 ' + distanceCount + ' 条舒适经历。'];
  if (distance.historyRange) {
    const method = {
      typical_group_range: '典型距离组的观察范围',
      typical_group_interquartile: '典型距离组的四分位区间'
    }[metrics.distanceKm.method] ?? (distance.scopedGroup ? '较接近起步距离一组的典型范围' : '少量经历的观察距离');
    distanceLines.push(method + '为 ' + displayRange(distance.historyRange) + ' km，历史权重 '
      + Math.round(distance.historyWeight * 100) + '%。');
  }
  if (distance.prior.rejected) distanceLines.push('自评距离超出起步校准范围，请核对。');
  if (distance.prior.limited) distanceLines.push('起步距离已按自评经验和体能限制。');
  if (distance.sparseConflict) distanceLines.push('两条经历距离差异较大，采用更接近起步距离的一条。');
  if (!distanceCount && metrics.distanceKm.reason === 'dispersed_distances') {
    distanceLines.push('历史距离较分散，暂以起步距离作参考。');
  }
  if (counts.highEffort) {
    const burdenCount = distance.burdenRefs.length;
    distanceLines.push('有 ' + counts.highEffort + ' 条体感 4–5 级的经历，'
      + (burdenCount ? '其中 ' + burdenCount + ' 条用于谨慎下调。' : '作为对照。'));
  }
  distanceLines.push(cohortLine('爬升', ascent));
  if (ascent.source === 'self_assessment') distanceLines.push('自评爬升按对应距离的低爬升条件收敛。');
  if (ascent.recordRefs.length) distanceLines.push('爬升取与上述距离配对的记录中位数。');

  const paceLines = [
    cohortLine('低爬升', lowPace), cohortLine('高爬升', highPace),
    '按每公里累计爬升分组。全程配速为总用时（小时）× 60 ÷ 距离（km），取同类记录的中位数。总用时可能包含休息。'
  ];
  if (lowPace.source === 'missing' || highPace.source === 'missing') {
    paceLines.push('通用基础耗时（小时）≈ 距离（km）÷ ' + generalTiming.flatSpeedKmPerHour
      + ' + 爬升（m）÷ ' + generalTiming.climbMPerHour + '，未计休息。');
  }

  const loadLines = [cohortLine('短途', shortLoad), cohortLine('长途', longLoad), '两组分别取个人历史携带重量的中位数。'];
  if (selfAssessment.values.typicalLoadKg != null) {
    const selfLoad = '自评常见负重 ' + displayNumber(selfAssessment.values.typicalLoadKg) + ' kg。';
    const usesSelf = shortLoad.source === 'self_reported' || longLoad.source === 'self_reported';
    loadLines.push(selfLoad + (usesSelf ? '缺少该组历史时展示自评值，尚未经长短途记录验证。' : '两组参考均取自各自的历史记录。'));
  }

  const comparisons = selfAssessment.differences.map(({ key, metric, direction }) => {
    const { label } = profile.METRIC_FIELDS.find(field => field.key === key);
    const result = direction === 'above' ? '高于' : '低于';
    const group = { distanceKm: '典型距离组的参考', ascentM: '相近距离的历史',
      shortTripLoadKg: '短途历史', longTripLoadKg: '长途历史' }[metric];
    return '自评' + label + result + group + '范围。';
  });
  const limitations = ['评估采用规则和历史统计，实际路线安全需单独判断。'];
  if (ascent.value != null) limitations.push('累计爬升只描述爬升总量，地形和路况需另行核对。');
  const sections = [
    { key: 'overview', title: '整体评估', lines: overview },
    { key: 'distance', title: '距离与爬升', lines: distanceLines, examples: distanceExamples(distance.recordRefs, referenceRecords) },
    { key: 'pace', title: '全程配速', lines: paceLines },
    { key: 'load', title: '个人负重', lines: loadLines }
  ];
  if (comparisons.length) sections.push({ key: 'comparison', title: '自评与历史差异', lines: comparisons });
  sections.push({ key: 'limitations', title: '评估限制', lines: limitations });
  return { status, rows, sections, showSetup: distance.prior.source === 'generic' && distanceCount === 0 };
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
  changeEffort(e) {
    const effortIndex = Number(e.detail.value);
    const patch = { effortIndex };
    if (effortIndex > 0 && EFFORT_LABELS[effortIndex] && this.data.fields.effortLevel) {
      patch.fields = { ...this.data.fields };
      delete patch.fields.effortLevel;
      if (Object.keys(patch.fields).length <= 1 && this.data.error === FORM_VALIDATION_ERROR) patch.error = '';
    }
    this.setData(patch);
  },
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
    if (!eligible) return this.setData({ draft: form, fields, error: Object.keys(fields).length > 1 ? FORM_VALIDATION_ERROR : '' });

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
