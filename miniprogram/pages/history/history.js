const trips = require('../../utils/trips');
const { getTodayString } = require('../../utils/dateUtils');

const efforts = ['未填写', '轻松', '适中', '吃力'];
const metrics = [
  { key: 'distance', label: '实际里程', unit: 'km' },
  { key: 'ascent', label: '累计爬升', unit: 'm' },
  { key: 'hours', label: '用时', unit: '小时' },
  { key: 'load', label: '背包重量', unit: 'kg' }
];

Page({
  data: { records: [], draft: null, today: '', efforts, metrics },
  onShow() {
    const records = (trips.read().history || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    this.setData({ records, today: getTodayString() });
  },
  edit(e) {
    const existing = this.data.records.find(item => item.id === e.currentTarget.dataset.id);
    this.setData({ draft: existing || { name: '', date: getTodayString(), effort: '', note: '' },
      effortIndex: existing ? Math.max(0, efforts.indexOf(existing.effort)) : 0, error: '' });
  },
  changeDate(e) { this.setData({ 'draft.date': e.detail.value }); },
  changeEffort(e) { this.setData({ effortIndex: Number(e.detail.value) }); },
  cancel() { this.setData({ draft: null }); },
  saveRecord(e) {
    const draft = this.data.draft;
    const values = e.detail.value;
    const record = { id: draft.id || String(Date.now()), date: draft.date, name: values.name.trim(),
      effort: this.data.effortIndex ? efforts[this.data.effortIndex] : '', note: values.note.trim() };
    if (!record.name) return this.setData({ error: '请填写实际走过的路线名称。' });
    if (!record.date || record.date > getTodayString()) return this.setData({ error: '请选择已完成徒步的日期。' });
    for (const { key, label } of metrics) {
      const raw = (values[key] || '').trim();
      record[key] = raw ? Number(raw) : null;
      if (raw && (!Number.isFinite(record[key]) || record[key] < 0)) return this.setData({ error: label + '请填写非负数，未知可留空。' });
    }
    if (trips.save(book => {
      const records = book.history || [];
      book.history = [record, ...records.filter(r => r.id !== record.id)];
    })) { this.cancel(); this.onShow(); }
  },
  remove() {
    const { id, name } = this.data.draft;
    wx.showModal({ title: '删除这次经历？', content: name, confirmText: '删除', success: res => {
      if (res.confirm && trips.save(book => { book.history = (book.history || []).filter(r => r.id !== id); })) {
        this.cancel(); this.onShow();
      }
    } });
  }
});
