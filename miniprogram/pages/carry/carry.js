const trips = require('../../utils/trips');
const { generateMultiDayPackingList } = require('../../utils/recommendation');

Page({
  data: { trip: null, prep: null, available: [], choosing: false },
  onLoad(query) { this.tripId = query.trip || trips.read().activeId; },
  onShow() {
    const trip = trips.read().trips.find(t => t.id === this.tripId);
    if (!trip) return wx.reLaunch({ url: '/pages/overview/overview' });
    const gear = trips.loadGear();
    const suggested = generateMultiDayPackingList({ dayPlans: trip.days }, gear).items;
    const byId = new Map(suggested.map(item => [item.id, item]));
    const available = gear.filter(item => !trip.carry[item.id]).map(item => ({
      ...item, suggested: byId.has(item.id), quantity: byId.get(item.id)?.quantity || 1
    })).sort((a, b) => Number(b.suggested) - Number(a.suggested));
    this.setData({ trip, prep: trips.preparation(trip, gear), available });
  },
  togglePicker() { this.setData({ choosing: !this.data.choosing }); },
  openGear() { wx.navigateTo({ url: '/pages/index/index?tab=gear&trip=' + this.tripId }); },
  changeItem(e) {
    const { id, action } = e.currentTarget.dataset;
    if (trips.update(this.tripId, trip => {
      const item = trip.carry[id];
      if (action === 'add' && !item) {
        const gear = this.data.available.find(g => g.id === id);
        if (gear) trip.carry[id] = { quantity: gear.quantity, worn: false, packed: false };
      } else if (item) {
        if (action === 'remove') delete trip.carry[id];
        if (action === 'worn') item.worn = !item.worn;
        if (action === 'plus' || action === 'minus') {
          item.quantity = Math.max(1, item.quantity + (action === 'plus' ? 1 : -1));
          item.packed = false;
        }
      }
    })) this.onShow();
  }
});
