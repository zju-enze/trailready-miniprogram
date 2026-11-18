const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../miniprogram/cloudfunctions/trailAssistant');
const { walking } = require('../miniprogram/cloudfunctions/trailAssistant/providers');

Object.assign(process.env, { TENCENT_MAP_KEY: 'test-key', TENCENT_MAP_SK: 'test-signature',
  QWEATHER_HOST: 'test.example', QWEATHER_KEY: 'test-weather', DEEPSEEK_API_KEY: 'test-ai' });
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
const endpoint = { id: 'goal', name: '山顶', address: '杭州', lat: 30.22, lng: 120.12 };
const row = (id, title, lat) => ({ id, title, address: '杭州', location: { lat, lng: 120.12 } });
const json = data => new Response(JSON.stringify(data), { status: 200 });

test('腾讯步行路线展开正负坐标差，缺失完整轨迹时只保留地点', async t => {
  const from = { name: '东入口', lat: 30.201, lng: 120.101 };
  let polyline = [30.2, 120.1, 160, -230, -50, 330];
  t.mock.method(global, 'fetch', async () => json({ status: 0, result: { routes: [{ distance: 530, duration: 8, polyline }] } }));
  const route = await walking(from, endpoint);
  assert.deepEqual(route.map, {
    from: { name: '东入口', latitude: 30.201, longitude: 120.101 },
    to: { name: endpoint.name, latitude: endpoint.lat, longitude: endpoint.lng },
    points: [{ latitude: 30.2, longitude: 120.1 }, { latitude: 30.20016, longitude: 120.09977 },
      { latitude: 30.20011, longitude: 120.1001 }]
  });
  for (polyline of [undefined, [], [30.2, 120.1, 30]]) {
    const withoutTrace = await walking(from, endpoint);
    assert.deepEqual(withoutTrace.map, { ...route.map, points: [] });
    assert.equal(withoutTrace.distance, 0.53);
  }
});

function modelResponse(overrides = {}) {
  return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    summary: '按有据路线分日，出发前核对天气。', choices: [0], equipment: [], missing: [], notes: [], ...overrides
  }) } }] });
}

test('腾讯地点、重名未确认、指定坐标的日期预报及缺测温度', async t => {
  t.mock.method(global, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.hostname === 'apis.map.qq.com') {
      assert.equal(target.pathname, '/ws/place/v1/suggestion');
      assert.equal(target.searchParams.get('keyword'), '东湖');
      assert.ok(target.searchParams.get('sig'));
      return json({ status: 0, data: [row('1', '东湖', 30.1), row('2', '东湖', 42.2)] });
    }
    assert.equal(target.hostname, 'test.example');
    assert.equal(target.searchParams.get('location'), '120.12,30.22');
    assert.equal(options.headers['X-QW-Api-Key'], 'test-weather');
    return json({ code: '200', daily: [
      { fxDate: today, textDay: '小雨', tempMin: '0', tempMax: '8', windScaleDay: '5-6' },
      { fxDate: tomorrow, textDay: '晴', tempMin: '', tempMax: '10' }
    ] });
  });
  assert.equal((await main({ action: 'places', query: '东湖' })).places.length, 2);
  assert.match((await main({ action: 'weather', dates: [today], destination: '东湖' })).error, /唯一/);
  const { weather } = await main({ action: 'weather', destination: '山顶', dates: [today, tomorrow], coords: '120.119,30.221' });
  assert.deepEqual(Object.keys(weather), [today]);
  assert.deepEqual(weather[today].conditions, ['降水', '大风', '严寒']);
  assert.equal(weather[today].source, 'qweather');
  assert.deepEqual(await main({ action: 'weather', destination: '远期', dates: ['2099-01-01'] }), { weather: {} });
});

test('只有目的地时可按真实连续路段选择多天；人工数值与单日安排优先', async t => {
  let context;
  t.mock.method(global, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.pathname.includes('/suggestion')) return json({ status: 0, data: [row('from', '东入口', 30.19)] });
    if (target.pathname.includes('/search')) return json({ status: 0, data: target.searchParams.get('keyword') === '登山口'
      ? [row('east', '东登山口', 30.2), row('west', '西登山口', 30.25)] : [row('platform', '山脊观景台', 30.26)] });
    if (target.pathname.includes('/walking')) return json({ status: 0, result: { routes: [{ distance: 8200, duration: 120 }] } });
    if (target.hostname === 'test.example') {
      const grid = target.searchParams.get('location');
      const daily = grid === '120.12,30.22' ? [{ fxDate: today, textDay: '晴', tempMin: '0', tempMax: '8' }]
        : grid === '120.12,30.26' ? [{ fxDate: tomorrow, textDay: '小雨', tempMin: '3', tempMax: '10' }] : [];
      return json({ code: '200', daily });
    }
    assert.equal(target.hostname, 'api.deepseek.com');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'deepseek-flash');
    assert.equal(request.reasoning_effort, 'high');
    assert.deepEqual(request.thinking, { type: 'enabled' });
    assert.deepEqual(request.response_format, { type: 'json_object' });
    context = JSON.parse(request.messages[1].content);
    assert.equal(context.history[0].load, 4);
    assert.ok(!request.messages[1].content.includes('"map"'), '规划模型只需路线指标和天气，无需完整轨迹');
    return modelResponse({ itinerary: context.itineraries?.findIndex(i => i.length === 3), equipment: [
      { id: 'mine', quantity: 1, reason: '夜间照明' }, { id: 'invented', quantity: 1, reason: '没有该物品' }
    ] });
  });
  const input = { action: 'plan', destination: endpoint.name, place: endpoint, start: today,
    history: [{ name: '旧路线', load: 4 }], gear: [{ id: 'mine', name: '头灯' }] };
  let result = await main(input);
  assert.equal(result.error, undefined);
  assert.equal(result.plan.days.length, 3);
  assert.deepEqual(result.plan.days.map(day => day.stayType), ['pending', 'pending', 'daytrip']);
  assert.deepEqual(result.plan.days.map(day => day.destination), ['山顶', '山脊观景台', '西登山口']);
  assert.equal(result.plan.days[0].from, '东登山口');
  assert.equal(result.plan.days[1].from, '山顶');
  assert.equal(result.plan.days[2].from, '山脊观景台');
  assert.equal(result.plan.days[0].map.to.latitude, endpoint.lat);
  assert.equal(result.plan.days[0].weather.tempMin, 0);
  assert.equal(result.plan.days[1].weatherPlace, '山脊观景台');
  assert.equal(result.plan.days[1].weather.description, '小雨');
  assert.equal(result.plan.days[2].weather, null);
  assert.equal(result.plan.days[0].distance, 8.2);
  assert.equal(result.plan.days[0].hours, 2);
  assert.equal(result.plan.days[0].ascent, null);
  assert.deepEqual(result.plan.equipment.map(i => i.id), ['mine']);
  result = await main({ ...input, days: [{ from: '东入口', destination: '山顶', ascent: 0, distance: 9, transport: '自订班车' }] });
  assert.equal(result.plan.days.length, 1);
  assert.equal(result.plan.days[0].ascent, 0);
  assert.equal(result.plan.days[0].distance, 9);
  assert.equal(result.plan.days[0].transport, '自订班车');
});

test('服务无法核实时不采用模型编造的路线，空模型回复给出可重试错误', async t => {
  let blank = false;
  t.mock.method(global, 'fetch', async url => {
    if (new URL(url).hostname === 'api.deepseek.com') {
      if (blank) return json({ choices: [{ finish_reason: 'stop', message: { content: ' ' } }] });
      return modelResponse({ itinerary: null, days: [{ from: '不存在的小径', distance: 15, ascent: 240, transport: '假班车' }] });
    }
    throw new Error('模拟外部服务暂时不可用');
  });
  const input = { action: 'plan', destination: '未选地点', start: today, history: [], gear: [] };
  const result = await main(input);
  assert.equal(result.plan.days[0].from, '');
  assert.equal(result.plan.days[0].distance, null);
  assert.equal(result.plan.days[0].transport, '');
  assert.equal(result.plan.days[0].map, null);
  assert.equal(result.plan.days[0].weather, null);
  assert.ok(result.plan.notes.some(note => note.includes('暂无已核实')));
  blank = true;
  assert.match((await main(input)).error, /未生成完整/);
});

test('规划未获得步行线时保留已确认的目的地坐标', async t => {
  t.mock.method(global, 'fetch', async url => {
    if (new URL(url).hostname === 'api.deepseek.com') return modelResponse({ itinerary: null });
    throw new Error('模拟路网暂不可用');
  });
  const { plan } = await main({ action: 'plan', place: endpoint, destination: endpoint.name, start: today });
  assert.deepEqual(plan.days[0].map, { from: null, to: { name: endpoint.name, latitude: endpoint.lat, longitude: endpoint.lng }, points: [] });
  assert.equal(plan.days[0].weather, null);
});

test('先选库存与可替代装备，补充物品同名或同一需求只推荐一次', async t => {
  const headlamp = { id: 'lamp', name: 'Spot 400 头灯', tags: ['照明'] };
  const bottle = { id: 'bottle', name: '水壶', tags: ['饮水'] };
  const gear = [headlamp, bottle];
  const extras = [
    { name: '徒步头灯', need: '夜行主照明', quantity: 1, reason: '下山时照明' },
    { name: '随行水瓶', need: '饮水容器', quantity: 1, reason: '方便补水' },
    { name: '水壶', need: '饮水容器', quantity: 1, reason: '盛装饮水' },
    { name: '饮用水', need: '饮水补给', quantity: 1, reason: '出发前装满水壶' },
    { name: '备用电池', need: '头灯备用电源', quantity: 2, reason: '按头灯电池规格准备两节' },
    { name: '备用电池', need: '备用电量', quantity: 2, reason: '同一备件' }
  ];
  t.mock.method(global, 'fetch', async (url, options) => {
    if (new URL(url).hostname !== 'api.deepseek.com') throw Error('跳过地图与预报');
    const context = JSON.parse(JSON.parse(options.body).messages[1].content);
    return modelResponse({ equipment: context.gear.length ? [
      { id: 'lamp', need: '夜行主照明', quantity: 1, reason: '用于天黑后的步行' },
      { id: 'unknown', need: '饮水补给', quantity: 1, reason: '未登记' }
    ] : [], missing: extras });
  });
  const input = { action: 'plan', destination: '九溪', start: today };
  let { plan } = await main({ ...input, gear });
  assert.deepEqual(plan.equipment.map(i => i.id), ['lamp', 'bottle']);
  assert.deepEqual(plan.missing, [extras[3], extras[4]].map(({ name, quantity, reason }) => ({ name, quantity, reason })));
  ({ plan } = await main({ ...input, gear: [] }));
  assert.deepEqual(plan.equipment, []);
  assert.deepEqual(plan.missing.map(i => i.name), ['徒步头灯', '随行水瓶', '饮用水', '备用电池']);
});
