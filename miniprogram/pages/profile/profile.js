const profileService = require('../../utils/userProfile');

const { EXPERIENCE_OPTIONS, FITNESS_OPTIONS, METRIC_FIELDS } = profileService;
const STAT_FIELDS = [
  { key: 'distance', maximum: 'maxDistanceKm', label: '历史最长距离', unit: 'km' },
  { key: 'ascent', maximum: 'maxAscentM', label: '历史最大累计爬升', unit: 'm' },
  { key: 'hours', maximum: 'maxDurationHours', label: '历史最长记录用时', unit: '小时' },
  { key: 'load', maximum: 'maxLoadKg', label: '历史最大负重', unit: 'kg' }
];

function selfRows(assessment) {
  return [
    { key: 'experienceLevel', label: '徒步经验', value: EXPERIENCE_OPTIONS.find(option => option.value === assessment.experienceLevel).label },
    { key: 'fitnessLevel', label: '自评体能', value: FITNESS_OPTIONS.find(option => option.value === assessment.fitnessLevel).label },
    ...METRIC_FIELDS.map(field => ({ key: field.key, label: field.label,
      value: assessment[field.key] == null ? '尚未填写' : assessment[field.key] + ' ' + field.unit }))
  ];
}

Page({
  data: {
    editing: false, profileError: '', statsError: '', saveError: '', errors: {}, draft: {},
    selfRows: [], statRows: [], stats: null, recentLoads: [], dataWarning: '',
    experienceOptions: EXPERIENCE_OPTIONS, fitnessOptions: FITNESS_OPTIONS, metricFields: METRIC_FIELDS,
    experienceIndex: 0, fitnessIndex: 0
  },
  onShow() {
    const result = profileService.read();
    const performance = profileService.getPerformanceStats();
    const patch = {
      profileError: result.ok ? '' : result.error.message,
      selfRows: result.ok ? selfRows(result.profile.selfAssessment) : [],
      statsError: performance.ok ? '' : performance.error.message, stats: performance.ok ? performance.stats : null,
      statRows: [], recentLoads: [], dataWarning: ''
    };
    if (performance.ok) {
      const stats = performance.stats;
      patch.statRows = STAT_FIELDS.map(field => ({ ...field,
        value: stats[field.maximum] == null ? '暂无记录' : stats[field.maximum] + ' ' + field.unit,
        count: stats.metricCounts[field.key], record: stats.maxRecords[field.key] }));
      patch.recentLoads = stats.loadRecords.slice(0, 5).map((record, index) => ({ ...record, key: index }));
      const invalidFields = Object.values(stats.invalidValueCounts).reduce((sum, count) => sum + count, 0);
      if (stats.ignoredRecordCount || invalidFields) {
        patch.dataWarning = '已跳过 ' + stats.ignoredRecordCount + ' 条不完整或日期异常的记录、' + invalidFields + ' 个异常数值，请在经历中核对。';
      }
    }
    this.setData(patch);
  },
  edit() {
    const result = profileService.read();
    if (!result.ok) return this.setData({ profileError: result.error.message });
    const assessment = result.profile.selfAssessment;
    const draft = { experienceLevel: assessment.experienceLevel, fitnessLevel: assessment.fitnessLevel };
    for (const field of METRIC_FIELDS) draft[field.key] = assessment[field.key] == null ? '' : String(assessment[field.key]);
    this.setData({ editing: true, draft, saveError: '', errors: {}, profileError: '',
      experienceIndex: EXPERIENCE_OPTIONS.findIndex(option => option.value === draft.experienceLevel),
      fitnessIndex: FITNESS_OPTIONS.findIndex(option => option.value === draft.fitnessLevel) });
  },
  changeField(e) {
    const field = e.currentTarget.dataset.field;
    if (!METRIC_FIELDS.some(item => item.key === field)) return;
    const errors = { ...this.data.errors };
    delete errors[field];
    this.setData({ draft: { ...this.data.draft, [field]: e.detail.value }, errors, saveError: '' });
  },
  changeOption(e) {
    const field = e.currentTarget.dataset.field;
    const options = field === 'experienceLevel' ? EXPERIENCE_OPTIONS : FITNESS_OPTIONS;
    if (field !== 'experienceLevel' && field !== 'fitnessLevel') return;
    const index = Number(e.detail.value);
    if (!Number.isInteger(index) || !options[index]) return;
    const indexField = field === 'experienceLevel' ? 'experienceIndex' : 'fitnessIndex';
    this.setData({ draft: { ...this.data.draft, [field]: options[index].value }, [indexField]: index, saveError: '' });
  },
  save() {
    const result = profileService.save(this.data.draft);
    if (!result.ok) {
      return this.setData({ errors: result.error.fields || {}, saveError: result.error.message });
    }
    this.setData({ editing: false, draft: {}, errors: {}, saveError: '' });
    this.onShow();
    wx.showToast({ title: '自评已保存', icon: 'success' });
  },
  cancel() {
    this.setData({ editing: false, draft: {}, errors: {}, saveError: '' });
    this.onShow();
  },
  openHistory() { wx.switchTab({ url: '/pages/history/history' }); }
});
