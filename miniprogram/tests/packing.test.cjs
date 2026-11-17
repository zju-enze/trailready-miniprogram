const test = require('node:test');
const assert = require('node:assert/strict');

test('勾选和取消装包时同步更新清单行、分类和总进度', () => {
  let page;
  global.Page = definition => { page = definition; };
  global.wx = { getStorageSync() {}, setStorageSync() {} };
  require('../pages/index/index');
  page.setData = patch => Object.assign(page.data, patch);
  page.onLoad();
  page.data.dayPlans[0].destination = '试用路线';
  page._recompute();

  const item = page.data.packingGrouped[0].items[0];
  for (const packed of [true, false]) {
    page.onTogglePacked({ currentTarget: { dataset: { id: item.id } } });
    const group = page.data.packingGrouped[0];
    assert.equal(group.items[0].packed, packed);
    assert.equal(group.packed, Number(packed));
    assert.equal(page.data.packedCount, Number(packed));
  }
});
