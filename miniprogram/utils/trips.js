const dates = require('./dateUtils');
const { DEFAULT_GEAR } = require('./mockData');

const STORAGE = 'trailready_trips';

function read() {
  const saved = wx.getStorageSync(STORAGE);
  return saved || { activeId: '', trips: [] };
}

function save(change) {
  try {
    const book = read();
    change(book);
    wx.setStorageSync(STORAGE, book);
    return true;
  } catch (error) {
    console.warn('行程未保存', error);
    wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    return false;
  }
}

function update(id, change) {
  return save(book => change(book.trips.find(t => t.id === id)));
}

function newTrip(name) {
  const start = dates.getTodayString();
  return {
    id: String(Date.now()), name, start,
    days: [{ ...dates.formatDayDate(start, 0), dayIndex: 1, destination: '', stayType: 'daytrip',
      weatherPreset: '', weatherPresetIndex: 0, from: '', stay: '', transport: '' }],
    carry: {},
    checks: ['核对天气与路况', '准备所需地图', '告知紧急联系人', '核对防雨装备']
      .map((text, i) => ({ id: String(i), text, done: false }))
  };
}

function gearStorageKey(demo) {
  return demo ? 'trailready_demo_gear' : 'trail_gear_closet';
}

function saveGear(gear, demo = false) {
  try {
    wx.setStorageSync(gearStorageKey(demo), JSON.stringify(gear));
    return true;
  } catch (error) {
    console.warn('装备数据保存失败', error);
    wx.showToast({ title: '装备保存失败，请重试', icon: 'none' });
    return false;
  }
}

function loadGear(demo = false) {
  const raw = wx.getStorageSync(gearStorageKey(demo));
  if (raw) {
    try {
      const gear = JSON.parse(raw);
      if (Array.isArray(gear)) return gear;
    } catch (error) { console.warn('无法读取装备库', error); }
  }
  if (demo) return DEFAULT_GEAR;
  // 旧版本只保存用户选入行程的装备 ID，可能从未写入装备库。
  const plans = read().trips;
  const selected = DEFAULT_GEAR.filter(item => plans.some(trip => trip.carry[item.id]));
  if (!raw && selected.length) saveGear(selected);
  return selected;
}

function preparation(trip, gear) {
  const items = gear.filter(g => trip.carry[g.id]).map(g => ({ ...g, ...trip.carry[g.id] }));
  const logistics = [];
  trip.days.forEach((day, index) => {
    for (const field of ['stay', 'transport']) {
      if (!day[field]) continue;
      const label = field === 'stay' ? '住宿' : '接驳';
      logistics.push({ id: field + index, index, field, text: '第 ' + (index + 1) + ' 天 · ' + label + ' · ' + day[field],
        done: !!day[field + 'Confirmed'] });
    }
  });
  const tasks = trip.checks.concat(logistics);
  const pending = tasks.find(t => !t.done);
  const unpacked = items.find(i => !i.packed);
  const done = items.filter(i => i.packed).length + tasks.filter(t => t.done).length;
  const total = items.length + tasks.length;
  const grams = items.reduce((sum, i) => sum + (i.worn ? 0 : i.weight * i.quantity), 0);
  const missing = items.filter(i => !i.worn && i.weight == null).reduce((sum, i) => sum + i.quantity, 0);
  return { items, logistics, done, total, remaining: total - done,
    percent: total ? Math.round(100 * done / total) : 0,
    next: pending ? pending.text : unpacked ? unpacked.name : '',
    pieces: items.reduce((sum, i) => sum + i.quantity, 0), missing, kg: (grams / 1000).toFixed(2) };
}

module.exports = { read, save, update, newTrip, loadGear, saveGear, preparation };
