const { loadGear, saveGear } = require('../../utils/trips');
const { DEFAULT_GEAR, GEAR_CATEGORY_OPTIONS } = require('../../utils/mockData');

const nameKey = name => name.trim().toLowerCase().replace(/\s+/g, '');

function ownsExample(gear, example) {
  const name = nameKey(example.name);
  return gear.some(item => item.id === example.id || nameKey(item.name) === name);
}

Page({
  data: { groups: [], count: 0, showExamples: false, exampleCount: DEFAULT_GEAR.length, allOwned: false },
  onShow() {
    this.getTabBar?.()?.setData({ route: this.route });
    this.refresh(this.data.showExamples);
  },
  chooseCollection(e) {
    this.refresh(e.currentTarget.dataset.collection === 'examples');
  },
  refresh(showExamples) {
    const gear = loadGear();
    const items = showExamples ? DEFAULT_GEAR.map(item => ({ ...item, owned: ownsExample(gear, item) })) : gear;
    const groups = GEAR_CATEGORY_OPTIONS.map(({ value, label }) => ({
      category: value, label, items: items.filter(item => item.category === value)
    })).filter(group => group.items.length);
    this.setData({ groups, count: gear.length, showExamples, allOwned: showExamples && items.every(item => item.owned) });
  },
  addExamples(e) {
    const id = e.currentTarget.dataset.id;
    const gear = loadGear();
    const additions = DEFAULT_GEAR.filter(item => (id === 'all' || item.id === id) && !ownsExample(gear, item));
    if (additions.length && !saveGear(gear.concat(additions))) return;
    this.refresh(true);
  }
});
