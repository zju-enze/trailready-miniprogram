const test = require('node:test');
const assert = require('node:assert/strict');
const trips = require('../utils/trips');
const service = require('../utils/trailAssistant');
const weather = require('../utils/weatherApi');
const { generatePlan, getSavedPlan } = require('../utils/aiPlan');
const { routeTimeText, lastHikeText } = require('../utils/routeTime');

function loadPage(name) {
  let page;
  global.Page = definition => { page = { ...definition, data: structuredClone(definition.data) }; };
  const path = require.resolve('../pages/' + name + '/' + name);
  delete require.cache[path];
  require(path);
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      const field = parts.pop();
      parts.reduce((parent, part) => parent[part], page.data)[field] = structuredClone(value);
    }
  };
  return page;
}

test('规划使用最近十二次有效日期的经历，兼容不完整旧记录并保留原始存储', async t => {
  const old = Array.from({ length: 12 }, (_, i) => ({ name: '山路', date: '2024-01-' + String(i + 1).padStart(2, '0') }));
  Object.assign(old[0], { distance: 7, hours: 3 });
  const book = { trips: [], history: [
    null, { name: '坏日期', date: 20250505 }, ...old,
    { name: '旧路线', date: '2025-01-10', distance: 0, hours: '2.5', ascent: '0', load: -2, effortLevel: 4, note: '私有备注' }
  ] };
  const before = structuredClone(book);
  global.wx = { getStorageSync: key => key === 'trailready_trips' ? book : '[]' };
  const transport = t.mock.method(service, 'callAssistant', async ({ history }) => {
    assert.equal(history.length, 12);
    assert.deepEqual(history[0], { name: '旧路线', date: '2025-01-10', distance: null, hours: 2.5, ascent: 0, load: null, effort: '比较吃力' });
    assert.equal(history.at(-1).date, '2024-01-02');
    return { plan: { days: [{}], equipment: [], missing: [], notes: [] } };
  });
  const input = { destination: '九溪', start: '2026-11-20' };
  await generatePlan(input);
  assert.deepEqual(book, before);
  book.history = '损坏的旧集合';
  await assert.rejects(generatePlan(input), /徒步经历格式异常/);
  assert.equal(book.history, '损坏的旧集合');
  assert.equal(transport.mock.callCount(), 1);
  assert.equal(lastHikeText(before), '你上次走了 7 公里，用时 3 小时');
  assert.equal(lastHikeText({ history: [] }), '');
});

test('路线卡按显式来源标时，分钟进位且旧地图不会替旧用时背书', () => {
  const map = { points: [{ latitude: 30.1, longitude: 120.1 }, { latitude: 30.2, longitude: 120.2 }] };
  const days = [
    { hours: 1.78, hoursSource: 'map', map }, { hours: 3, hoursSource: 'manual', map },
    { hours: 1.999, map }, { hours: 0.5 }, { hours: null }
  ];
  const book = { history: [{ name: '昨天的实际路线', date: '2025-07-10', distance: 8.5, hours: 2.25 }] };
  global.wx = { getStorageSync: () => book };
  const page = loadPage('assistant');
  page.showPlan({ days });
  assert.deepEqual(page.data.plan.days.map(d => d.timeText), [
    '地图步行估时约 1 小时 47 分', '手填计划用时 3 小时', '参考用时 2 小时', '参考用时 30 分', ''
  ]);
  assert.equal(page.data.lastHike, '你上次走了 8.5 公里，用时 2 小时 15 分');
  assert.equal(routeTimeText({ hours: 0 }, true), '手填计划用时 0 分');
});

test('手工改写及清空用时、修改地图路段、复用旧 AI 行程，均保留真实来源', async t => {
  const trip = trips.newTrip('周末');
  trip.aiPlan = { summary: '旧方案' };
  Object.assign(trip.days[0], { from: '原起点', destination: '原终点', hours: 1.78, hoursSource: 'map' });
  let book = { trips: [trip], activeId: trip.id, history: [] };
  global.wx = {
    getStorageSync: key => key === 'trailready_trips' ? structuredClone(book) : '',
    setStorageSync: (key, value) => { book = structuredClone(value); }, setNavigationBarTitle() {}
  };
  const editor = loadPage('index');
  editor.onLoad({ trip: trip.id, tab: 'trip' });
  const input = (field, value) => ({ currentTarget: { dataset: { index: 0, field } }, detail: { value } });
  editor.onDayFieldInput(input('from', '新起点'));
  assert.equal(book.trips[0].days[0].hours, null);
  assert.equal(book.trips[0].days[0].hoursSource, null);
  editor.onDayMetricInput(input('hours', '1.5'));
  editor.onDayFieldInput(input('from', '另一起点'));
  const home = loadPage('overview');
  home.onShow();
  assert.deepEqual(home.data.routeTimes, ['手填计划用时 1 小时 30 分']);
  editor.onDayMetricInput(input('hours', ''));
  assert.equal(book.trips[0].days[0].hoursSource, null);
  book.trips[0].days[0].hours = 2;
  delete book.trips[0].days[0].hoursSource;
  home.onShow();
  assert.deepEqual(home.data.routeTimes, ['参考用时 2 小时']);
  const transport = t.mock.method(service, 'callAssistant', async () => ({ plan: { days: [{}], equipment: [], missing: [], notes: [] } }));
  const request = { destination: '周末', start: trip.start, sourceTripId: trip.id };
  await generatePlan(request);
  assert.equal(transport.mock.calls[0].arguments[0].days[0].hoursSource, 'unknown');
  delete book.trips[0].aiPlan;
  await generatePlan(request);
  assert.equal(transport.mock.calls[1].arguments[0].days[0].hoursSource, 'manual');
});

test('草稿按天切换步行轨迹和仅有地点，并保留各日期的天气', () => {
  const a = { name: '入口', latitude: 30.20, longitude: 120.13 };
  const b = { name: '终点', latitude: 30.22, longitude: 120.15 };
  const points = [a, { latitude: 30.24, longitude: 120.12 }, b];
  const days = [
    { map: { from: a, to: b, points }, weatherPlace: '终点', weather: { source: 'qweather', tempMin: 0, tempMax: 5 } },
    { map: { to: b }, weather: null },
    { from: '手填起点', destination: '手填终点' }
  ];
  const page = loadPage('assistant');
  page.showPlan({ days });
  assert.deepEqual(page.data.mapView.line[0].points, points);
  const [sw, ne] = page.data.mapView.bounds;
  assert.ok(sw.latitude < 30.20 && sw.longitude < 120.12);
  assert.ok(ne.latitude > 30.24 && ne.longitude > 120.15);
  assert.equal(page.data.mapView.markers.length, 2);
  assert.equal(page.data.plan.days[page.data.dayIndex].weather.tempMin, 0);
  page.selectDay({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.plan.days[page.data.dayIndex].weather, null);
  assert.deepEqual(page.data.mapView.line, []);
  assert.equal(page.data.mapView.markers[0].latitude, b.latitude);
  page.selectDay({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(page.data.mapView, null);
  page.selectDay({ currentTarget: { dataset: { index: 0 } } });
  assert.deepEqual(page.data.mapView.line[0].points, points);
});

test('目的地确认后才生成，草稿可重试；采用后按天、按库存写入新行程', async t => {
  const history = [{ name: '绕湖', date: '2025-11-10', hours: 2, note: '未授权用于规划的备注' }];
  const source = trips.newTrip('原有手工计划');
  source.id = 'manual';
  source.days[0].from = '龙井村';
  source.days[0].ascent = 0;
  const book = { trips: [source], activeId: source.id, history };
  const pack = { id: 'my-pack', name: '我的背包', tags: [], weight: 500, category: 'misc' };
  const disk = new Map([['trailready_trips', book], ['trail_gear_closet', JSON.stringify([pack])]]);
  const place = { id: 'poi', name: '九溪烟树', address: '浙江省杭州市', lat: 30.2, lng: 120.1 };
  const map = { to: { name: '乙', latitude: 30.21, longitude: 120.13 }, points: [] };
  const forecast = { source: 'qweather', description: '晴', tempMin: 0, tempMax: 12, tempRange: '0~12°C', conditions: [] };
  let request, startPage, chosenTab;
  let saveFails = false;
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync: (key, value) => { if (saveFails) throw Error('测试存储满'); disk.set(key, structuredClone(value)); },
    showToast() {}, switchTab: options => { chosenTab = options.url; },
    navigateTo: options => options.success({ eventChannel: { emit: (_name, value) => { request = value; } } })
  };
  const search = t.mock.method(weather, 'searchCities', async () => [{ ...place, builtin: true }, place]);
  const transport = t.mock.method(service, 'callAssistant', async () => { throw Error('暂时未连接到规划服务'); });
  const home = loadPage('overview');
  home.onShow();
  home.changeDestination({ detail: { value: '杭州九溪' } });
  home.useCurrentDays({ detail: { value: true } });
  home.changePlanStart({ detail: { value: '2028-01-31' } });
  assert.equal(search.mock.callCount(), 0);
  await home.findDestination();
  assert.deepEqual(home.data.places, [place]);
  assert.equal(transport.mock.callCount(), 0);
  home.openPlanner({ currentTarget: { dataset: { index: 0 } } });
  const page = loadPage('assistant');
  page.getOpenerEventChannel = () => ({ on: (_name, callback) => { startPage = callback; } });
  page.onLoad();
  await startPage(request);
  assert.match(page.data.error, /暂时未连接/);
  assert.deepEqual(trips.read(), book);
  transport.mock.mockImplementation(async payload => {
    assert.equal(payload.days[0].ascent, 0);
    assert.deepEqual(payload.place, place);
    assert.equal(payload.history[0].note, undefined);
    assert.equal(payload.gear[0].id, 'my-pack');
    return { plan: { destination: '九溪烟树', summary: '两日缓行', notes: ['核实山道开放情况'],
      days: [{ from: '甲', destination: '乙', distance: 8.5, ascent: 0, hours: 1.78, hoursSource: 'map', stayType: 'hotel', stay: '客栈', transport: '',
        map, weather: forecast, weatherPlace: '乙' },
        { from: '乙', destination: '丙', distance: null, ascent: null, hours: null, stayType: 'daytrip', stay: '', transport: '公交' }],
      equipment: [{ id: pack.id, quantity: 1, reason: '携带物资' }, { id: 'invented-id', quantity: 1, reason: '' }],
      missing: [{ name: '路餐', reason: '选方便取用的小份包装' },
        { name: '饮用水', quantity: 2, reason: '每瓶 500 mL' }] } };
  });
  await page.generate();
  assert.equal(page.data.plan.equipment[0].name, pack.name);
  assert.deepEqual(trips.read(), book);
  saveFails = true;
  page.adopt();
  assert.equal(page.data.saved, false);
  assert.deepEqual(trips.read(), book);
  saveFails = false;
  page.adopt();
  page.adopt();
  const after = trips.read(), added = after.trips[1];
  assert.equal(after.trips.length, 2);
  assert.equal(after.activeId, added.id);
  assert.deepEqual(after.trips[0], source);
  assert.deepEqual(after.history, history);
  assert.deepEqual(added.days.map(day => day.dateString), ['2028-01-31', '2028-02-01']);
  assert.equal(added.days[1].transportConfirmed, false);
  assert.equal(added.days[0].ascent, 0);
  assert.deepEqual(added.carry, { 'my-pack': { quantity: 1, worn: false, packed: false } });
  assert.equal(added.checks.at(-2).text, '备齐路餐 · 选方便取用的小份包装');
  assert.equal(added.checks.at(-1).text, '备齐饮用水 × 2 · 每瓶 500 mL');
  assert.equal(added.checks.at(-1).done, false);
  assert.deepEqual(trips.loadGear(), [pack]);
  assert.equal(chosenTab, '/pages/overview/overview');
  assert.equal(added.days[0].map, undefined);
  assert.equal(added.days[0].weather, undefined);
  home.onShow();
  assert.equal(home.data.routeTimes[0], '地图步行估时约 1 小时 47 分');
  assert.equal(page.data.plan.days[0].timeText, home.data.routeTimes[0]);
  trips.update(added.id, trip => { trip.start = '2028-03-01'; trip.days[0].destination = '更换后的目的地'; });
  const original = getSavedPlan(added.id);
  assert.equal(original.start, '2028-01-31');
  assert.equal(original.days[0].destination, '乙');
  assert.deepEqual(original.days[0].map, map);
  assert.deepEqual(original.days[0].weather, forecast);
  assert.equal(original.address, place.address);
  const reopened = loadPage('assistant');
  reopened.onLoad({ trip: added.id });
  assert.equal(reopened.data.readOnly, true);
  assert.equal(reopened.data.mapView.markers[0].title, '终点 · 乙');
  assert.equal(reopened.data.plan.days[0].weather.tempMin, 0);
  reopened.adopt();
  assert.equal(trips.read().trips.length, 2);
  home.onShow();
  assert.equal(home.data.hasSavedPlan, true);
  assert.equal(reopened.data.plan.days[0].timeText, '地图步行估时约 1 小时 47 分');
  assert.equal(home.data.trip.aiPlan.days, undefined);
  trips.update(source.id, trip => { trip.aiPlan = { start: trip.start, summary: '旧版摘要', notes: [] }; });
  assert.equal(getSavedPlan(source.id), null);
  assert.equal(transport.mock.callCount(), 2);
});
