const { generatePlan, adoptPlan, getSavedPlan } = require('../../utils/aiPlan');
const { routeTimeText, lastHikeText } = require('../../utils/routeTime');

function routeView(route) {
  if (!route) return null;
  const points = route.points || [];
  const markers = [];
  for (const [endpoint, prefix] of [[route.from, '起点'], [route.to, '终点']]) {
    if (!endpoint) continue;
    markers.push({
      id: markers.length + 1, latitude: endpoint.latitude, longitude: endpoint.longitude,
      iconPath: '/pages/assistant/route-pin.png', width: 22, height: 28,
      ...(route.from && route.to ? { label: { content: prefix, fontSize: 11, color: '#174b39',
        bgColor: '#ffffff', borderRadius: 4, padding: 2, anchorX: 10, anchorY: -19 } } : {}),
      title: prefix + ' · ' + endpoint.name
    });
  }
  const locations = points.concat(markers);
  if (!locations.length) return null;
  let south = locations[0].latitude, north = south;
  let west = locations[0].longitude, east = west;
  for (const { latitude, longitude } of locations) {
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
  }
  // include-points 只容纳坐标，需为图钉高度和地图署名留白。
  const latInset = (north - south) * .34, lngInset = (east - west) * .18;
  return {
    latitude: (south + north) / 2, longitude: (west + east) / 2, markers,
    bounds: south === north && west === east ? [] : [
      { latitude: south - latInset, longitude: west - lngInset }, { latitude: north + latInset, longitude: east + lngInset }
    ],
    line: points.length > 1 ? [{ points, color: '#086b52', width: 5, borderColor: '#ffffff', borderWidth: 1, arrowLine: true }] : []
  };
}

Page({
  data: { destination: '', address: '', start: '', loading: false, error: '', plan: null, saved: false,
    detailsOpen: false, dayIndex: 0, mapView: null, readOnly: false },
  onLoad(options = {}) {
    if (options.trip) {
      this.setData({ readOnly: true });
      const plan = getSavedPlan(options.trip);
      if (plan) {
        this.setData({ destination: plan.destination, start: plan.start, address: plan.address || '' });
        this.showPlan(plan);
      }
      return;
    }
    const channel = this.getOpenerEventChannel();
    if (!channel || !channel.on) return;
    channel.on('generatePlan', request => {
      this.request = request;
      this.setData({ destination: request.destination, start: request.start, address: request.place ? request.place.address : '' });
      return this.generate();
    });
  },
  onUnload() { this.closed = true; },
  toggleDetails() { this.setData({ detailsOpen: !this.data.detailsOpen }); },
  showPlan(plan) {
    this.plan = plan;
    // 原始轨迹留给保存和地图，避免把所有天数的坐标都发送给页面渲染层。
    const days = plan.days.map(({ map, ...day }) => ({ ...day, timeText: routeTimeText(day) }));
    this.setData({ plan: { ...plan, days }, lastHike: lastHikeText(), dayIndex: 0, mapView: routeView(plan.days[0].map) });
  },
  selectDay(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index !== this.data.dayIndex) this.setData({ dayIndex: index, mapView: routeView(this.plan.days[index].map) });
  },
  async generate() {
    if (!this.request || this.data.loading || this.data.saved) return;
    this.setData({ loading: true, error: '' });
    try {
      const plan = await generatePlan(this.request);
      if (!this.closed) this.showPlan(plan);
    } catch (error) {
      if (!this.closed) this.setData({ error: error.message || '暂时无法生成方案，请重试。' });
    } finally {
      if (!this.closed) this.setData({ loading: false });
    }
  },
  adopt() {
    if (!this.plan || this.data.saved || this.data.readOnly) return;
    if (adoptPlan(this.plan, this.data.start)) {
      this.setData({ saved: true });
      this.openTrip();
    }
  },
  openTrip() { wx.switchTab({ url: '/pages/overview/overview' }); }
});
