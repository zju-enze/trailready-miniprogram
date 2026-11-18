const { coordinates, suggestions, namedPlace, nearbyTrails, walking, forecastSpan, forecast, askModel } = require('./providers');

const text = value => typeof value === 'string' ? value.trim() : '';
const numberOrNull = value => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function dayDate(start, offset = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('请提供有效的出发日期。');
  const millis = Date.parse(start);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== start) throw new Error('出发日期无效。');
  return new Date(millis + offset * 86400000).toISOString().slice(0, 10);
}

function selectedPoint(event, name) {
  if (event.place) {
    const point = coordinates(event.place.lat, event.place.lng);
    if (!point || text(event.place.name) !== name) throw new Error('地点已更改，请重新选择。');
    return { ...point, name, id: text(event.place.id), address: text(event.place.address) };
  }
  if (event.coords) {
    const fields = String(event.coords).split(',');
    const point = fields.length === 2 && fields.every(i => i.trim()) && coordinates(Number(fields[1]), Number(fields[0]));
    if (!point) throw new Error('地点坐标无效，请重新选择。');
    return { ...point, name };
  }
  return null;
}

function readDays(event, destination) {
  const rows = Array.isArray(event.days) && event.days.length ? event.days : [{}];
  if (rows.length > 30) throw new Error('单次规划最多支持 30 天。');
  return rows.map((row, i) => ({
    date: dayDate(event.start, i), from: text(row.from), destination: text(row.destination) || destination,
    distance: numberOrNull(row.distance), ascent: numberOrNull(row.ascent), hours: numberOrNull(row.hours),
    stayType: ['camping', 'hotel', 'daytrip', 'pending'].includes(row.stayType) ? row.stayType : 'daytrip',
    stay: text(row.stay), transport: text(row.transport)
  }));
}

async function routeOptions(from, to) {
  if (!from || !to || from.name === to.name || (from.lat === to.lat && from.lng === to.lng)) return null;
  return walking(from, to).catch(() => null);
}

function mapMarker(point) {
  return point && { name: point.name, latitude: point.lat, longitude: point.lng };
}

function routeSummary({ from, destination, distance, hours }) {
  return { from, destination, distance, hours };
}

async function nearbyItineraries(center) {
  if (!center) return [];
  const [entrances, views] = await Promise.all([
    nearbyTrails(center).catch(() => []), nearbyTrails(center, true).catch(() => [])
  ]);
  // 城市的行政中心不是徒步终点；选择真实的观景点来规划当地步行段。
  const admin = /省$|市$|县$|自治州$/.test(center.name) || (center.name.endsWith('区') && !/景区|保护区|游览区/.test(center.name));
  const goal = admin || !entrances.length ? views[0] : center;
  if (!goal) return [];
  const starts = entrances.length ? entrances : (admin ? views.slice(1, 2) : [center]);
  const next = views.find(p => p.id !== goal.id && p.name !== goal.name);
  const legs = await Promise.all([
    ...starts.map(p => routeOptions(p, goal)), routeOptions(goal, next),
    ...starts.map(p => routeOptions(next, p))
  ]);
  const itineraries = [];
  for (let i = 0; i < starts.length; i++) {
    const first = legs[i];
    if (!first) continue;
    itineraries.push([first]);
    const second = legs[starts.length];
    if (!second || second.destination === first.from) continue;
    itineraries.push([first, second]);
    for (let j = 0; j < starts.length; j++) {
      const end = legs[starts.length + 1 + j];
      if (end && end.destination !== first.from && end.destination !== first.destination) itineraries.push([first, second, end]);
    }
  }
  return itineraries;
}

function packingRecommendations(gear, answer) {
  const key = value => text(value).toLowerCase().replace(/\s+/g, '');
  const byId = new Map(gear.map(item => [item.id, item]));
  const byName = new Map(gear.map(item => [key(item.name), item]));
  const selected = new Map();
  const covered = new Set();

  function select(owned, quantity, reason, need) {
    if (!selected.has(owned.id) && !covered.has(need)) selected.set(owned.id, { id: owned.id, quantity, reason });
    covered.add(key(owned.name));
    if (need) covered.add(need);
  }

  for (const row of answer.equipment) {
    const owned = byId.get(row?.id);
    if (owned && Number.isInteger(row.quantity) && row.quantity > 0 && text(row.reason)) {
      select(owned, row.quantity, text(row.reason), key(row.need));
    }
  }

  const candidates = [];
  for (const row of answer.missing) {
    const name = text(row?.name), reason = text(row?.reason);
    if (!name || !reason) continue;
    const need = key(row.need) || key(name);
    const quantity = Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1;
    // 先处理模型误放在补充组的同名库存，再对剩余建议按物品和具体需求去重。
    const owned = byName.get(key(name));
    if (owned) select(owned, quantity, reason, need);
    else candidates.push({ name, reason, quantity, need });
  }

  const missing = [];
  for (const { name, reason, quantity, need } of candidates) {
    if (covered.has(key(name)) || covered.has(need)) continue;
    covered.add(key(name));
    covered.add(need);
    missing.push({ name, reason, quantity });
  }
  return { equipment: [...selected.values()], missing };
}

async function planTrip(event, name, selected) {
  let days = readDays(event, name);
  const gear = (event.gear || []).filter(g => text(g.id) && text(g.name)).map(g => ({
    id: g.id, name: g.name, weight: numberOrNull(g.weight), category: text(g.category), tags: (g.tags || []).map(text).filter(Boolean)
  }));
  const history = (event.history || []).slice(0, 12).map(h => ({
    name: text(h.name), date: text(h.date), distance: numberOrNull(h.distance), ascent: numberOrNull(h.ascent),
    hours: numberOrNull(h.hours), load: numberOrNull(h.load), effort: text(h.effort)
  }));
  const center = selected || await namedPlace(name).catch(() => null);
  const firstDay = days[0];
  const automatic = days.length === 1 && firstDay.destination === name && !firstDay.from && !firstDay.stay && !firstDay.transport
    && firstDay.distance === null && firstDay.ascent === null && firstDay.hours === null && firstDay.stayType === 'daytrip';
  let itineraries;
  if (automatic) {
    itineraries = await nearbyItineraries(center);
    const count = Math.max(1, ...itineraries.map(legs => legs.length));
    days = Array.from({ length: count }, (_, i) => ({ ...firstDay, date: dayDate(event.start, i) }));
  }
  const lookups = new Map([[name, Promise.resolve(center)]]);
  function locate(label) {
    if (!lookups.has(label)) lookups.set(label, namedPlace(label, center).catch(() => null));
    return lookups.get(label);
  }
  const locations = await Promise.all(days.map(day => locate(day.destination)));
  const destinations = locations.map(mapMarker);
  const origins = await Promise.all(days.map(day => day.from ? locate(day.from) : null));
  const forecasts = new Map();
  const grid = point => point.longitude.toFixed(2) + ',' + point.latitude.toFixed(2);
  // 同一预报格点合并日期，包括 AI 可能选中的各日终点。
  for (const [i, day] of days.entries()) {
    const stops = [destinations[i], ...(itineraries || []).map(legs => legs[i]?.map.to)];
    for (const point of stops.filter(Boolean)) {
      const key = grid(point);
      if (!forecasts.has(key)) forecasts.set(key, { point, dates: new Set() });
      forecasts.get(key).dates.add(day.date);
    }
  }
  for (const group of forecasts.values()) {
    group.daily = forecast({ lat: group.point.latitude, lng: group.point.longitude }, [...group.dates]).catch(() => ({}));
  }
  async function weatherAt(point, date) {
    if (!point) return null;
    return (await forecasts.get(grid(point)).daily)[date] || null;
  }
  const evidence = await Promise.all(days.map(async (day, i) => {
    const point = locations[i];
    if (!point) return { date: day.date, candidates: [], weather: null };
    let starts = [];
    if (!automatic && day.from) {
      if (origins[i]) starts = [origins[i]];
    } else if (!automatic && days.length === 1 && !/(市|县)$/.test(point.name)) {
      starts = await nearbyTrails(point).catch(() => []);
    }
    const routes = await Promise.all(starts.map(from => routeOptions(from, point)));
    return { date: day.date, place: point.name, candidates: routes.filter(Boolean), weather: await weatherAt(destinations[i], day.date) };
  }));

  const modelItineraries = itineraries && await Promise.all(itineraries.map(legs => Promise.all(legs.map(async (leg, i) => ({
    ...routeSummary(leg), weather: await weatherAt(leg.map.to, days[i].date)
  })))));
  const answer = await askModel({ destination: name, start: event.start, days: automatic ? [] : days, itineraries: modelItineraries,
    evidence: evidence.map(day => ({ ...day, candidates: day.candidates.map(routeSummary) })), history, gear });
  if (!text(answer?.summary) || (!automatic && !Array.isArray(answer.choices)) || !Array.isArray(answer.equipment)
    || !Array.isArray(answer.missing) || !Array.isArray(answer.notes)) throw new Error('AI 返回的方案格式不完整，请重试。');
  const notes = [];
  const itinerary = automatic && Number.isInteger(answer.itinerary) ? itineraries[answer.itinerary] : null;
  if (automatic) days = days.slice(0, itinerary?.length || 1);
  const planDays = [];
  for (const [i, day] of days.entries()) {
    const { date, ...out } = day;
    if (automatic && i < days.length - 1) out.stayType = 'pending';
    const { candidates } = evidence[i];
    const route = automatic ? itinerary?.[i] : (Number.isInteger(answer.choices[i]) ? candidates[answer.choices[i]] : null);
    out.map = route?.map || null;
    if (!out.map && (origins[i] || destinations[i])) {
      out.map = { from: mapMarker(origins[i]), to: destinations[i], points: [] };
    }
    const weatherPoint = out.map?.to;
    out.weatherPlace = weatherPoint?.name || day.destination;
    out.weather = await weatherAt(weatherPoint, date);
    if (route) {
      out.from = out.from || route.from;
      if (automatic) out.destination = route.destination;
      out.distance = out.distance ?? route.distance;
      out.hours = out.hours ?? route.hours;
      notes.push(date + ' 腾讯地图步行路网参考：' + route.from + ' → ' + route.destination
        + '，约 ' + route.distance + ' km、' + route.hours + ' 小时。山路通行和折返需另行核对。');
    } else {
      notes.push(date + ' 尚未核实具体步行线路，出发前核对出入口、轨迹和返程。');
    }
    notes.push(out.weather ? date + ' ' + out.weatherPlace + ' · 和风天气预报：' + out.weather.description + ' ' + out.weather.tempRange
      : date + ' ' + out.weatherPlace + ' 暂无已核实的当日天气预报。');
    planDays.push(out);
  }
  if (automatic && days.length > 1) notes.push('尚未核实过夜地点、住宿营业情况及接驳。采用前请落实每天的落脚点。');
  if (!center) notes.unshift('目的地还没有确认地图坐标，请补充城市并从地点候选中选择。');
  return { destination: name, summary: answer.summary.trim(), days: planDays, ...packingRecommendations(gear, answer),
    notes: notes.concat(answer.notes.map(text).filter(Boolean)) };
}

exports.main = async function main(event = {}) {
  try {
    if (event.action === 'places') {
      const query = text(event.query);
      return { places: query ? await suggestions(query) : [] };
    }
    const destination = text(event.destination);
    if (!destination) throw new Error('请填写目的地。');
    const selected = selectedPoint(event, destination);
    if (event.action === 'plan') return { plan: await planTrip(event, destination, selected) };
    if (event.action !== 'weather') throw new Error('不支持的操作。');
    if (!Array.isArray(event.dates)) throw new Error('请提供要查询的日期。');
    const dates = event.dates.map(date => dayDate(date));
    if (!forecastSpan(dates)) return { weather: {} };
    const point = selected || await namedPlace(destination);
    if (!point) throw new Error('无法唯一确定地点，请从地图候选中选择。');
    return { weather: await forecast(point, dates) };
  } catch (err) {
    return { error: err instanceof TypeError ? '请求数据格式不正确。' : err.message };
  }
};
