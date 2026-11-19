const profileService = require('../../utils/userProfile');

const { EXPERIENCE_OPTIONS, FITNESS_OPTIONS, METRIC_FIELDS } = profileService;
Page({
  data: {
    editing: false, profileError: '', saveError: '', errors: {}, draft: {},
    experienceOptions: EXPERIENCE_OPTIONS, fitnessOptions: FITNESS_OPTIONS, metricFields: METRIC_FIELDS,
    experienceIndex: 0, fitnessIndex: 0
  },
  onShow() {
    if (!this.data.editing) this.edit();
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
    wx.showToast({ title: '自评已保存', icon: 'success' });
    this.cancel();
  },
  cancel() {
    this.setData({ editing: false, draft: {}, errors: {}, saveError: '' });
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/history/history' }) });
  }
});
