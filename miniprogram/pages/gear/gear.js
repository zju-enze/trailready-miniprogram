const { loadGear } = require('../../utils/trips');
const { GEAR_CATEGORY_OPTIONS } = require('../../utils/mockData');

Page({
  data: { groups: [], count: 0 },
  onShow() {
    const gear = loadGear();
    const groups = GEAR_CATEGORY_OPTIONS.map(({ value, label }) => ({
      category: value, label, items: gear.filter(item => item.category === value)
    })).filter(group => group.items.length);
    this.setData({ groups, count: gear.length });
  }
});
