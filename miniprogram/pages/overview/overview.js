const trips = require('../../utils/trips');
const { formatDateRange } = require('../../utils/dateUtils');

Page({
  data: { trip: null, choices: [], selectedIndex: 0, dateRange: '', prep: null },
  onShow() {
    const book = trips.read();
    const selectedIndex = Math.max(0, book.trips.findIndex(t => t.id === book.activeId));
    const trip = book.trips[selectedIndex] || null;
    this.setData({ trip, selectedIndex, choices: book.trips.map(t => ({ id: t.id, name: t.name })),
      dateRange: trip ? formatDateRange(trip.start, trip.days.length) : '',
      prep: trip ? trips.preparation(trip, trips.loadGear()) : null });
  },
  createTrip() {
    wx.showModal({
      title: '新建行程', editable: true, placeholderText: '行程名称，如「九溪一日徒步」', confirmText: '创建',
      success: res => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) return wx.showToast({ title: '请输入行程名称', icon: 'none' });
        const trip = trips.newTrip(name);
        if (trips.save(book => { book.trips.push(trip); book.activeId = trip.id; })) {
          this.onShow();
          this.editTrip();
        }
      }
    });
  },
  selectTrip(e) {
    const choice = this.data.choices[Number(e.detail.value)];
    if (choice && trips.save(book => { book.activeId = choice.id; })) this.onShow();
  },
  editTrip() { wx.navigateTo({ url: '/pages/index/index?tab=trip&trip=' + this.data.trip.id }); },
  openCarry() { wx.navigateTo({ url: '/pages/carry/carry?trip=' + this.data.trip.id }); },
  openChecklist() { wx.navigateTo({ url: '/pages/checklist/checklist?trip=' + this.data.trip.id }); }
});
