const trips = require('./trips');
const dates = require('./dateUtils');
const assistant = require('./trailAssistant');
const { inspectRecord, readHistory } = require('./hikeHistory');

async function generatePlan({ destination, start, place, sourceTripId }) {
  const book = trips.read();
  const previousHikes = readHistory(book);
  if (!previousHikes.ok) throw new Error(previousHikes.error.message);
  const source = book.trips.find(trip => trip.id === sourceTripId);
  const gear = trips.loadGear();
  const today = dates.getTodayString();
  const history = previousHikes.records.flatMap(raw => {
    const { validRecord, record } = inspectRecord(raw, today);
    return validRecord ? [record] : [];
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)
    .map(({ name, date, distance, ascent, hours, load, effort }) =>
      ({ name, date, distance, ascent, hours, load, effort }));
  const days = (source ? source.days : []).map(({ from, destination, distance, ascent, hours, stayType, stay, transport }) =>
    ({ from, destination, distance, ascent, hours, stayType, stay, transport }));
  const result = await assistant.callAssistant({ action: 'plan', destination, start, days, history,
    gear: gear.map(({ id, name, category, weight, tags }) => ({ id, name, category, weight, tags })),
    ...(place ? { place: { id: place.id, name: place.name, address: place.address, lat: place.lat, lng: place.lng } } : {}) });
  const plan = result && result.plan;
  if (!plan || !Array.isArray(plan.days) || !plan.days.length || !Array.isArray(plan.equipment)
      || !Array.isArray(plan.missing) || !Array.isArray(plan.notes)) {
    throw new Error('规划结果不完整，请重新生成。');
  }
  const inventory = new Map(gear.map(item => [item.id, item]));
  return { ...plan, address: place?.address || '', days: plan.days.map((day, index) => ({ ...day, ...dates.formatDayDate(start, index), dayIndex: index + 1 })),
    equipment: plan.equipment.filter(item => inventory.has(item.id))
    .map(item => ({ ...item, name: inventory.get(item.id).name })) };
}

function adoptPlan(plan, start) {
  const trip = trips.newTrip(plan.destination + '徒步');
  trip.start = start;
  trip.aiPlan = { ...plan, start };
  // 轨迹与预报对应生成时的路线和日期，只保存在原始方案里。
  trip.days = plan.days.map(({ map, weather, weatherPlace, ...day }) => ({ ...day,
    weatherPreset: '', weatherPresetIndex: 0, stayConfirmed: false, transportConfirmed: false }));
  const owned = new Set(trips.loadGear().map(item => item.id));
  const missing = plan.missing.slice();
  for (const item of plan.equipment) {
    if (owned.has(item.id)) trip.carry[item.id] = { quantity: item.quantity, worn: false, packed: false };
    else missing.push(item);
  }
  missing.forEach((item, index) => {
    const quantity = item.quantity > 1 ? ' × ' + item.quantity : '';
    trip.checks.push({ id: 'ai-gear-' + index, text: '备齐' + item.name + quantity + (item.reason ? ' · ' + item.reason : ''), done: false });
  });
  return trips.save(book => { book.trips.push(trip); book.activeId = trip.id; });
}

function getSavedPlan(tripId) {
  const plan = trips.read().trips.find(trip => trip.id === tripId)?.aiPlan;
  return plan?.days?.length ? plan : null;
}

module.exports = { generatePlan, adoptPlan, getSavedPlan };
