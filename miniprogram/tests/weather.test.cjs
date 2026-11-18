const { test } = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../utils/dateUtils');
const trips = require('../utils/trips');
const { generateMultiDayPackingList } = require('../utils/recommendation');
const api = require('../utils/weatherApi');
const { callAssistant, initAssistant, assistantAvailable } = require('../utils/trailAssistant');

test('开发者工具开发版使用本机，体验版、正式版和真机开发版只使用微信云', async () => {
  let envVersion = 'develop';
  let platform = 'devtools';
  let local = 0;
  let cloud = 0;
  const payload = { action: 'places', query: '龙井村' };
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    getDeviceInfo: () => ({ platform }),
    request(options) {
      local++;
      assert.match(options.url, /^http:\/\/127\.0\.0\.1:/);
      assert.equal(options.method, 'POST');
      assert.deepEqual(options.data, payload);
      options.success({ statusCode: 200, data: { places: [] } });
    },
    cloud: { init() {}, async callFunction(options) {
      cloud++;
      assert.deepEqual(options, { name: 'trailAssistant', data: payload });
      return { result: { places: [] } };
    } }
  };
  for ([envVersion, platform] of [['develop', 'devtools'], ['trial', 'devtools'], ['release', 'devtools'], ['develop', 'ios']]) {
    initAssistant();
    await callAssistant(payload);
  }
  assert.equal(local, 1);
  assert.equal(cloud, 3);
  envVersion = 'develop';
  platform = 'devtools';
  wx.cloud.init = options => assert.equal(options.env, 'trail-test-env');
  initAssistant('trail-test-env');
  await callAssistant(payload);
  assert.equal(local, 1);
  assert.equal(cloud, 4);
  wx.cloud.init = () => { throw new Error('未开通'); };
  initAssistant('trail-test-env');
  assert.equal(assistantAvailable(), false);
  await assert.rejects(callAssistant(payload), /微信云服务/);
  assert.equal(local, 1);
});

test('地点天气使用约定的云函数参数，缺报和服务失败时可离线准备', async () => {
  const today = dates.getTodayString();
  const tomorrow = dates.formatDayDate(today, 1).dateString;
  const outside = dates.formatDayDate(today, 30).dateString;
  const requests = [];
  const places = [{ id: 'hz', name: '九溪', address: '杭州', lat: 30.2, lng: 120.1 }];
  global.wx = { cloud: { init() {}, async callFunction({ data }) {
    requests.push(data);
    if (data.action === 'places') return { result: { places } };
    return { result: { weather: { [today]: { source: 'qweather', tempMin: 0, tempMax: 0, tempRange: '0~0°C', conditions: [] } } } };
  } } };
  initAssistant();
  const query = days => api.fetchTripWeather('九溪', days, '120,30');
  assert.deepEqual(await query([outside]), {});
  assert.equal(requests.length, 0);
  const result = await query([today, tomorrow, outside]);
  assert.deepEqual(Object.keys(result), [today]);
  assert.equal(result[today].tempRange, '0~0°C');
  assert.deepEqual(await api.searchCities('九溪'), places);
  assert.deepEqual(requests, [
    { action: 'weather', destination: '九溪', coords: '120,30', dates: [today, tomorrow] },
    { action: 'places', query: '九溪' }
  ]);
  wx.cloud.callFunction = async () => ({ result: { error: { message: '服务未配置' } } });
  await assert.rejects(query([today]), /服务未配置/);
  const [place] = await api.searchCities('华山');
  assert.ok(place.id);
  assert.equal(place.builtin, true);
});

test('旧版估算不影响携带建议，手选与查询失败可独立保存并重新查询', async t => {
  const trip = trips.newTrip('九溪一日');
  const day = trip.days[0];
  day.destination = '九溪';
  day._locationLngLat = '120,30';
  const seasonal = { tempMin: -12, tempMax: 2, description: '经典冬季模型', conditions: ['严寒'] };
  day.fetchedWeather = day.simulatedWeather = seasonal;
  const downJacket = { id: 'down', name: '羽绒服', category: 'clothing', weight: 200, tags: ['羽绒'] };
  const suggested = plan => generateMultiDayPackingList({ dayPlans: [plan] }, [downJacket]);
  assert.equal(suggested(day).climateSummary.minTemp, null);
  assert.equal(suggested(day).items.length, 0);
  let book = { activeId: trip.id, trips: [trip] };
  global.wx = {
    getStorageSync(key) { if (key === 'trailready_trips') return structuredClone(book); },
    setStorageSync(key, value) { if (key === 'trailready_trips') book = structuredClone(value); },
    setNavigationBarTitle() {}, showLoading() {}, hideLoading() {}, showToast() {}
  };
  let page;
  global.Page = definition => { page = definition; };
  require('../pages/index/index');
  page.setData = function (patch) {
    for (const [key, value] of Object.entries(patch)) {
      const match = key.match(/^dayPlans\[(\d+)\]\.(\w+)$/);
      if (match) this.data.dayPlans[match[1]][match[2]] = value;
      else this.data[key] = value;
    }
  };
  page.onLoad({ tab: 'trip', trip: trip.id });
  assert.equal(page.data.dayPlans[0].fetchedWeather, null);
  const event = { currentTarget: { dataset: { index: 0 } }, detail: { value: '6' } };
  page.onWeatherPresetChange(event);
  assert.equal(suggested(book.trips[0].days[0]).items[0].id, 'down');
  const request = t.mock.method(api, 'fetchTripWeather', () => Promise.reject(new Error('offline')));
  await page.refreshWeather(event);
  assert.equal(book.trips[0].days[0].weatherPreset, 'snow');
  assert.equal(book.trips[0].days[0].fetchedWeather, null);
  request.mock.mockImplementation(async (destination, days, coords) => {
    assert.deepEqual(days, [day.dateString]);
    assert.equal(coords, day._locationLngLat);
    return { [day.dateString]: { source: 'qweather', tempMin: 8, tempMax: 15, conditions: [] } };
  });
  await page.refreshWeather(event);
  assert.equal(book.trips[0].days[0].fetchedWeather.source, 'qweather');
  assert.equal(suggested(book.trips[0].days[0]).items.length, 0);
  page.onWeatherPresetChange(event);
  assert.equal(book.trips[0].days[0].fetchedWeather, null);
  assert.equal(suggested(book.trips[0].days[0]).items[0].id, 'down');
});
