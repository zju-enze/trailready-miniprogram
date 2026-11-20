const trips = require('../../utils/trips');
const { formatDateRange, getTodayString } = require('../../utils/dateUtils');
const { routeTimeText } = require('../../utils/routeTime');
const weatherApi = require('../../utils/weatherApi');

Page({
  data: { trip: null, choices: [], selectedIndex: 0, dateRange: '', prep: null,
    destination: '', planStart: '', useCurrentDays: false, places: null, searching: false, planExpanded: false },
  onShow() {
    this.getTabBar?.()?.setData({ route: this.route });
    this.openingPlanner = false;
    const book = trips.read();
    const selectedIndex = Math.max(0, book.trips.findIndex(t => t.id === book.activeId));
    const trip = book.trips[selectedIndex] || null;
    const hasSavedPlan = !!trip?.aiPlan?.days?.length;
    const changedTrip = (trip && trip.id) !== (this.data.trip && this.data.trip.id);
    this.setData({ ...(changedTrip ? { useCurrentDays: false, destination: '', places: null, searching: false, planExpanded: false } : {}),
      planStart: changedTrip || !this.data.planStart ? getTodayString() : this.data.planStart,
      trip: hasSavedPlan ? { ...trip, aiPlan: { start: trip.aiPlan.start } } : trip,
      routeTimes: trip ? trip.days.map(day => routeTimeText(day, !trip.aiPlan)) : [],
      hasSavedPlan, selectedIndex, choices: book.trips.map(t => ({ id: t.id, name: t.name })),
      dateRange: trip ? formatDateRange(trip.start, trip.days.length) : '',
      prep: trip ? trips.preparation(trip, trips.loadGear()) : null });
  },
  changeDestination(e) { this.setData({ destination: e.detail.value, places: null, searching: false }); },
  changePlanStart(e) { this.setData({ planStart: e.detail.value }); },
  togglePlan() { this.setData({ planExpanded: !this.data.planExpanded }); },
  showDataUse() {
    wx.showModal({
      title: 'AI 使用的数据',
      content: '规划服务使用目的地、出发日期、装备库及最近 12 次徒步经历。经历包含路线名、日期、里程、爬升、用时、负重和体感。开启「参考行程」后，也会使用该行程的每日安排。',
      showCancel: false, confirmText: '知道了'
    });
  },
  useCurrentDays(e) {
    const enabled = e.detail.value;
    this.setData({ useCurrentDays: enabled, planStart: enabled ? this.data.trip.start : this.data.planStart });
  },
  async findDestination() {
    const keyword = this.data.destination.trim();
    if (!keyword) return wx.showToast({ title: '请输入目的地和所在城市', icon: 'none' });
    if (this.data.searching) return;
    this.setData({ searching: true });
    let places = [];
    try {
      places = (await weatherApi.searchCities(keyword)).filter(place => !place.builtin);
    } catch {
      // 地图暂时不可用时仍可由用户明确采用手填地点。
    }
    if (this.data.destination.trim() === keyword) this.setData({ places, searching: false });
  },
  openPlanner(e) {
    const keyword = this.data.destination.trim();
    if (!keyword || this.openingPlanner) return;
    const place = (this.data.places || [])[e.currentTarget.dataset.index];
    const request = { destination: place ? place.name : keyword, start: this.data.planStart,
      sourceTripId: this.data.useCurrentDays ? this.data.trip.id : '', place: place || null };
    this.openingPlanner = true;
    wx.navigateTo({ url: '/pages/assistant/assistant',
      success: res => res.eventChannel.emit('generatePlan', request),
      fail: () => { this.openingPlanner = false; wx.showToast({ title: '未能打开规划，请重试', icon: 'none' }); }
    });
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
