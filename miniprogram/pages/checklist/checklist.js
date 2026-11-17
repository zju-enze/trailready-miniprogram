const trips = require('../../utils/trips');

Page({
  data: { trip: null, prep: null },
  onLoad(query) { this.tripId = query.trip || trips.read().activeId; },
  onShow() {
    const trip = trips.read().trips.find(t => t.id === this.tripId);
    if (!trip) return wx.reLaunch({ url: '/pages/overview/overview' });
    this.setData({ trip, prep: trips.preparation(trip, trips.loadGear()) });
  },
  change(edit) { if (trips.update(this.tripId, edit)) this.onShow(); },
  toggleGear(e) {
    this.change(trip => {
      const item = trip.carry[e.currentTarget.dataset.id];
      item.packed = !item.packed;
    });
  },
  toggleCheck(e) {
    this.change(trip => {
      const item = trip.checks.find(c => c.id === e.currentTarget.dataset.id);
      item.done = !item.done;
    });
  },
  toggleLogistics(e) {
    const { index, field } = e.currentTarget.dataset;
    this.change(trip => {
      const day = trip.days[index];
      day[field + 'Confirmed'] = !day[field + 'Confirmed'];
    });
  },
  addCheck() {
    wx.showModal({ title: '添加准备事项', editable: true, placeholderText: '例如：确认返程末班车', confirmText: '添加',
      success: res => {
        const text = (res.content || '').trim();
        if (res.confirm && text) this.change(trip => trip.checks.push({ id: String(Date.now()), text, done: false }));
      }
    });
  },
  removeCheck(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除准备事项？', content: this.data.trip.checks.find(c => c.id === id).text,
      confirmText: '删除', success: res => {
        if (res.confirm) this.change(trip => { trip.checks = trip.checks.filter(c => c.id !== id); });
      }
    });
  }
});
