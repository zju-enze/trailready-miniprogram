const test = require('node:test');
const assert = require('node:assert/strict');
const trips = require('../utils/trips');
const { DEFAULT_GEAR } = require('../utils/mockData');

let definition;
global.Page = page => { definition = page; };
require('../pages/gear/gear');
const event = dataset => ({ currentTarget: { dataset } });

test('浏览示例保持个人库存为空，单件与批量加入只追加缺少的装备', () => {
  const disk = new Map();
  let writes = 0;
  global.wx = {
    getStorageSync: key => structuredClone(disk.get(key)),
    setStorageSync(key, value) { writes++; disk.set(key, structuredClone(value)); },
    showToast() {}
  };
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  page.onShow();
  page.chooseCollection(event({ collection: 'examples' }));
  assert.equal(page.data.groups.flatMap(g => g.items).length, 26);
  assert.equal(page.data.count, 0);
  assert.equal(writes, 0);

  const [first, second] = DEFAULT_GEAR;
  page.addExamples(event({ id: first.id }));
  assert.deepEqual(trips.loadGear(), [first]);
  assert.equal(writes, 1);
  page.addExamples(event({ id: first.id }));
  assert.equal(writes, 1);

  const renamed = { ...first, name: '我改过的装备', weight: 340 };
  const sameName = { ...second, id: 'custom', name: second.name.toLowerCase(), weight: null };
  trips.saveGear([renamed, sameName]);
  const trip = trips.newTrip('周末');
  trip.carry[renamed.id] = { quantity: 2, worn: true, packed: true };
  disk.set('trailready_trips', { activeId: trip.id, trips: [trip] });
  page.onShow();
  const beforeWrites = writes;
  page.addExamples(event({ id: 'all' }));
  assert.deepEqual(trips.loadGear(), [renamed, sameName, ...DEFAULT_GEAR.slice(2)]);
  assert.equal(page.data.allOwned, true);
  assert.equal(writes, beforeWrites + 1);
  page.addExamples(event({ id: 'all' }));
  assert.equal(writes, beforeWrites + 1);
  assert.deepEqual(trips.read().trips[0].carry, trip.carry);
  page.chooseCollection(event({ collection: 'mine' }));
  assert.equal(page.data.count, 26);
  assert.equal(page.data.showExamples, false);
});
