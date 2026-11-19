const test = require('node:test');
const assert = require('node:assert/strict');
const trips = require('../utils/trips');

// 微信的 setData 同步更新页面数据，支持 dayPlans[0].transport 这类字段路径。
const pages = {};
for (const name of ['overview', 'gear', 'carry', 'checklist', 'index', 'history']) {
  global.Page = definition => { pages[name] = definition; };
  require('../pages/' + name + '/' + name);
}
function open(name, query = {}) {
  const page = { ...pages[name], data: structuredClone(pages[name].data) };
  page.setData = patch => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      const field = keys.pop();
      const parent = keys.reduce((obj, key) => obj[key], page.data);
      parent[field] = structuredClone(value);
    }
  };
  page.onLoad?.(query);
  page.onShow?.();
  return page;
}
function event(dataset, value) {
  return { currentTarget: { dataset }, detail: { value } };
}

test('每日计划里程、爬升和耗时支持小数、零、留空及冷启动恢复', () => {
  const trip = trips.newTrip('九溪两日');
  const disk = new Map([['trailready_trips', { activeId: trip.id, trips: [trip] }]]);
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync: (key, value) => disk.set(key, structuredClone(value)),
    setNavigationBarTitle() {}, showToast() {}
  };
  const query = { trip: trip.id, tab: 'trip' };
  let editor = open('index', query);
  assert.equal(editor.data.dayPlans[0].distance, undefined);
  editor.onDaysPlus();
  const metric = (index, field, value) => editor.onDayMetricInput(event({ index, field }, value));
  metric(0, 'distance', '8.');
  assert.equal(editor.data.dayPlans[0].distance, '8.');
  metric(0, 'distance', '8.75');
  metric(0, 'ascent', '0');
  metric(1, 'hours', '.5');
  assert.equal(metric(0, 'distance', '-2'), '8.75');
  assert.equal(metric(0, 'distance', '8..75'), '8.75');
  const [first, second] = open('overview').data.trip.days;
  assert.deepEqual([first.distance, first.ascent, first.hours], [8.75, 0, null]);
  assert.deepEqual([second.distance, second.ascent, second.hours], [null, null, 0.5]);
  editor = open('index', query);
  assert.equal(editor.data.dayPlans[1].hours, 0.5);
  metric(1, 'hours', '');
  assert.equal(open('overview').data.trip.days[1].hours, null);
});

test('手工经历可以独立于计划保存，重开后能修改及删除', () => {
  const disk = new Map();
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync: (key, value) => disk.set(key, structuredClone(value)),
    showModal: opts => opts.success({ confirm: true })
  };
  let page = open('history');
  page.edit(event({}));
  page.changeDate(event({}, '2020-05-06'));
  page.changeEffort(event({}, '3'));
  const values = { name: '九溪', note: '下雨折返', distance: '7.5', ascent: '', hours: '2', load: '' };
  page.saveRecord(event({}, values));
  page = open('history');
  const [record] = page.data.records;
  assert.equal(record.distance, 7.5);
  assert.equal(record.ascent, null);
  assert.equal(trips.read().trips.length, 0);
  page.edit(event({ index: record.index }));
  page.saveRecord(event({}, { ...values, distance: '8' }));
  assert.equal(page.data.records.length, 1);
  assert.equal(page.data.records[0].distance, 8);
  page.edit(event({ index: record.index }));
  page.remove();
  assert.equal(open('history').data.records.length, 0);
});

test('新用户装备库为空，没有行程也可添加、修改和删除自己的装备', () => {
  const disk = new Map();
  let back = 0;
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync: (key, value) => disk.set(key, structuredClone(value)),
    setNavigationBarTitle() {}, navigateBack() { back++; },
    showModal: opts => opts.success({ confirm: true })
  };
  const gear = open('gear');
  assert.equal(gear.data.count, 0);
  const editor = open('index', { tab: 'gear', edit: 'new' });
  assert.equal(editor.data.directGearEdit, true);
  editor.onFormNameInput(event({}, '手套'));
  editor.onSaveGear();
  gear.onShow();
  const item = gear.data.groups[0].items[0];
  assert.equal(item.name, '手套');
  const edit = open('index', { tab: 'gear', edit: item.id });
  assert.equal(edit.data.formName, '手套');
  edit.onFormWeightInput(event({}, '55'));
  edit.onSaveGear();
  gear.onShow();
  assert.equal(gear.data.groups[0].items[0].weight, 55);
  open('index', { tab: 'gear', edit: item.id }).onDeleteGear(event({ id: item.id }));
  gear.onShow();
  assert.equal(gear.data.count, 0);
  assert.equal(back, 3);
  assert.equal(trips.read().trips.length, 0);
});

test('保留旧行程选用过的样例装备，已有库存和个人清单与演示独立', () => {
  const disk = new Map();
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync: (key, value) => disk.set(key, structuredClone(value)),
    setNavigationBarTitle() {}, navigateBack() {}
  };
  const first = trips.newTrip('第一趟');
  const second = trips.newTrip('第二趟');
  first.id = 'first';
  second.id = 'second';
  first.carry['1'] = { quantity: 2, packed: true, worn: false };
  second.carry['13'] = { quantity: 1, packed: false, worn: false };
  disk.set('trailready_trips', { activeId: first.id, trips: [first, second] });
  assert.deepEqual(trips.loadGear().map(item => item.id), ['1', '13']);
  assert.equal(open('checklist').data.prep.items[0].packed, true);
  delete first.carry['1'];
  disk.set('trailready_trips', { activeId: first.id, trips: [first, second] });
  assert.deepEqual(trips.loadGear().map(item => item.id), ['1', '13']);

  const demo = open('index');
  assert.ok(demo.data.gearCount > 2);
  const editor = open('index', { tab: 'gear', edit: '1', demo: '1' });
  editor.onFormNameInput(event({}, '编辑演示物品'));
  editor.onSaveGear();
  assert.equal(trips.loadGear(true)[0].name, '编辑演示物品');
  assert.notEqual(trips.loadGear()[0].name, '编辑演示物品');
  disk.set('trail_gear_closet', '[]');
  assert.deepEqual(trips.loadGear(), []);
});

test('通过页面准备两趟行程，冷启动恢复当前行程及各自的装备与接驳进度', () => {
  const disk = new Map();
  let modalText = '九溪一日';
  let route;
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync: (key, value) => disk.set(key, structuredClone(value)),
    showModal: opts => opts.success({ confirm: true, content: modalText }),
    navigateTo: opts => { route = opts.url; }, setNavigationBarTitle() {}, navigateBack() {}, showToast() {}
  };
  let home = open('overview');
  assert.equal(home.data.trip, null);
  home.createTrip();
  const id = home.data.trip.id;
  assert.match(route, /index\/index\?tab=trip/);
  const editor = open('index', { trip: id, tab: 'trip' });
  editor._searchCitiesDebounced = () => {};
  editor.onDestinationInput(event({ index: 0 }, '龙井'));
  editor.onDayFieldInput(event({ index: 0, field: 'from' }, '九溪'));
  editor.onDayFieldInput(event({ index: 0, field: 'transport' }, '确认返程班车'));
  editor.onStartDateChange({ detail: { value: '2027-04-17' } });

  let carry = open('carry', { trip: id });
  assert.deepEqual(carry.data.available, []);
  const gearEditor = open('index', { tab: 'gear', edit: 'new' });
  gearEditor.onFormNameInput(event({}, '我的头灯'));
  gearEditor.onFormWeightInput(event({}, '85'));
  gearEditor.onSaveGear();
  carry.onShow();
  const gearId = carry.data.available[0].id;
  carry.changeItem(event({ id: gearId, action: 'add' }));
  carry.changeItem(event({ id: gearId, action: 'plus' }));
  const item = carry.data.prep.items[0];
  assert.equal(carry.data.prep.kg, (item.weight * item.quantity / 1000).toFixed(2));
  let list = open('checklist', { trip: id });
  list.toggleGear(event({ id: gearId }));
  list.toggleCheck(event({ id: list.data.trip.checks[0].id }));
  modalText = '给头灯充电';
  list.addCheck();
  home = open('overview');
  assert.equal(home.data.trip.start, '2027-04-17');
  assert.equal(home.data.trip.days[0].destination, '龙井');
  assert.equal(home.data.prep.done, 2);
  assert.equal(home.data.prep.total, 7);
  assert.equal(home.data.prep.logistics[0].done, false);
  list = open('checklist', { trip: id });
  list.toggleLogistics(event({ index: 0, field: 'transport' }));
  assert.equal(open('overview').data.prep.done, 3);

  modalText = '下一趟行程';
  home.createTrip();
  assert.notEqual(home.data.trip.id, id);
  assert.equal(home.data.prep.done, 0);
  assert.equal(home.data.prep.pieces, 0);
  home.selectTrip({ detail: { value: 0 } });
  assert.equal(open('overview').data.prep.done, 3);
  carry = open('carry', { trip: id });
  carry.changeItem(event({ id: gearId, action: 'worn' }));
  assert.equal(carry.data.prep.kg, '0.00');
  assert.equal(carry.data.prep.done, 2);
  assert.equal(carry.data.prep.items[0].quantity, 2);
  assert.equal(trips.read().activeId, id);

  const updated = open('index', { trip: id, tab: 'trip' });
  updated.onDayFieldInput(event({ index: 0, field: 'transport' }, '改乘另一班车'));
  assert.equal(open('checklist', { trip: id }).data.prep.logistics[0].done, false);

  const known = carry.data.prep.kg;
  disk.set('trail_gear_closet', JSON.stringify([...trips.loadGear(),
    { id: 'personal', name: '自己的水壶', weight: null, category: 'misc', tags: [] }]));
  carry = open('carry', {});
  carry.changeItem(event({ id: 'personal', action: 'add' }));
  assert.equal(carry.data.prep.missing, 1);
  assert.equal(carry.data.prep.kg, known);
  const before = open('checklist', {}).data.prep.done;
  wx.setStorageSync = () => { throw new Error('测试存储已满'); };
  list = open('checklist', {});
  list.toggleGear(event({ id: 'personal' }));
  assert.equal(list.data.prep.done, before);
  assert.equal(open('overview').data.prep.done, before);
});
