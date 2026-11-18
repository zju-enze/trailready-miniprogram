const { createHash } = require('node:crypto');

async function request(service, url, options = {}, timeout = 6500) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    if (response.ok) return await response.json();
  } catch {
    throw new Error(service + '连接超时或暂时不可用，请稍后重试。');
  }
  if (service === 'DeepSeek' && response.status === 402) throw new Error('DeepSeek 账户额度不足。');
  throw new Error(service + '暂时不可用（HTTP ' + response.status + '）。');
}

async function mapRequest(path, params) {
  if (!process.env.TENCENT_MAP_KEY) throw new Error('尚未配置腾讯位置服务。');
  params.key = process.env.TENCENT_MAP_KEY;
  if (process.env.TENCENT_MAP_SK) {
    // 腾讯签名使用排序后的原始参数值，发送时再 URL 编码。
    const query = Object.keys(params).sort().map(key => key + '=' + params[key]).join('&');
    params.sig = createHash('md5').update(path + '?' + query + process.env.TENCENT_MAP_SK).digest('hex');
  }
  const data = await request('腾讯地图', 'https://apis.map.qq.com' + path + '?' + new URLSearchParams(params));
  if (data.status !== 0) throw new Error('腾讯地图未能返回结果（' + Number(data.status) + '）。');
  return data;
}

function coordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function pois(data) {
  return (data.data || []).filter(p => p.id && p.title && coordinates(p.location?.lat, p.location?.lng))
    .map(p => ({ id: String(p.id), name: p.title, address: p.address || '', ...p.location }));
}

async function suggestions(keyword, near) {
  const params = { keyword, get_ad: '1', page_index: '1', page_size: '8' };
  if (near) params.location = near.lat + ',' + near.lng;
  return pois(await mapRequest('/ws/place/v1/suggestion', params));
}

async function namedPlace(name, near) {
  if (near && near.name === name) return near;
  const places = await suggestions(name, near);
  const exact = places.filter(p => p.name === name || (name.endsWith(p.name) && p.address.includes(name.slice(0, -p.name.length))));
  if (exact.length === 1) return exact[0];
  if (places.length === 1) return places[0];
  if (near) {
    const nearby = exact.filter(p => Math.abs(near.lat - p.lat) < 0.2 && Math.abs(near.lng - p.lng) < 0.2);
    if (nearby.length === 1) return nearby[0];
  }
  return null;
}

async function nearbyTrails(point, scenic = false) {
  const data = await mapRequest('/ws/place/v1/search', {
    keyword: scenic ? '观景台' : '登山口', boundary: 'nearby(' + point.lat + ',' + point.lng + ',6000,0)',
    page_size: '8', page_index: '1', orderby: '_distance'
  });
  const kind = scenic ? /观景台|观景平台|观景点|山顶|峰顶/ : /登山口|步道入口|登山入口/;
  return pois(data).filter(p => kind.test(p.name) && !/停车场|酒店|餐厅|公交站/.test(p.name)
    && p.id !== point.id && p.name !== point.name).slice(0, 2);
}

function walkingPoints(polyline) {
  if (!Array.isArray(polyline) || polyline.length < 4 || polyline.length % 2 || !polyline.every(Number.isFinite)) return [];
  // 腾讯首对坐标为度，其余为相对于前一点的微度差值。
  let lat = Math.round(polyline[0] * 1e6);
  let lng = Math.round(polyline[1] * 1e6);
  const points = [];
  for (let i = 0; i < polyline.length; i += 2) {
    if (i > 0) {
      lat += polyline[i];
      lng += polyline[i + 1];
    }
    const latitude = lat / 1e6, longitude = lng / 1e6;
    if (!coordinates(latitude, longitude)) return [];
    points.push({ latitude, longitude });
  }
  return points;
}

async function walking(from, to) {
  const data = await mapRequest('/ws/direction/v1/walking/', {
    from: from.lat + ',' + from.lng, to: to.lat + ',' + to.lng
  });
  const route = data.result?.routes?.[0];
  if (!route || !Number.isFinite(route.distance) || route.distance <= 0 || !Number.isFinite(route.duration) || route.duration <= 0) return null;
  return { from: from.name, destination: to.name, distance: Number((route.distance / 1000).toFixed(2)),
    hours: Number((route.duration / 60).toFixed(2)),
    map: {
      from: { name: from.name, latitude: from.lat, longitude: from.lng },
      to: { name: to.name, latitude: to.lat, longitude: to.lng },
      points: walkingPoints(route.polyline)
    }
  };
}

function forecastSpan(dates) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const offsets = dates.map(date => (Date.parse(date) - Date.parse(today)) / 86400000 + 1).filter(n => n >= 1 && n <= 30);
  return offsets.length ? [3, 7, 10, 15, 30].find(n => n >= Math.max(...offsets)) : 0;
}

async function forecast(point, dates) {
  const span = forecastSpan(dates);
  if (!span) return {};
  if (!process.env.QWEATHER_HOST || !process.env.QWEATHER_KEY) throw new Error('尚未配置和风天气。');
  const host = process.env.QWEATHER_HOST.trim().replace(/^https:\/\//, '').replace(/\/$/, '');
  const location = point.lng.toFixed(2) + ',' + point.lat.toFixed(2);
  const result = await request('和风天气', 'https://' + host + '/v7/weather/' + span + 'd?location=' + encodeURIComponent(location), {
    headers: { 'X-QW-Api-Key': process.env.QWEATHER_KEY }
  });
  if (String(result.code) !== '200' || !Array.isArray(result.daily)) throw new Error('和风天气未能返回预报（' + Number(result.code) + '）。');
  const weather = {};
  for (const row of result.daily) {
    if (!dates.includes(row.fxDate) || row.tempMin == null || row.tempMax == null
      || String(row.tempMin).trim() === '' || String(row.tempMax).trim() === '') continue;
    const tempMin = Number(row.tempMin), tempMax = Number(row.tempMax);
    if (!Number.isFinite(tempMin) || !Number.isFinite(tempMax) || tempMin > tempMax) continue;
    const description = [...new Set([row.textDay, row.textNight].filter(Boolean))].join('转');
    const conditions = [];
    if (/雨|雷阵|冰雹/.test(description)) conditions.push('降水');
    if (/雪/.test(description)) conditions.push('降雪');
    if ([row.windScaleDay, row.windScaleNight].some(scale => Math.max(...(String(scale).match(/\d+/g) || [0])) >= 6)) conditions.push('大风');
    if (tempMin <= 0) conditions.push('严寒');
    weather[row.fxDate] = { source: 'qweather', tempMin, tempMax, tempRange: tempMin + '~' + tempMax + '°C', description, conditions };
  }
  return weather;
}

const instructions = `你是 TrailReady 行前准备助手。选择与使用者主动提供的徒步经历、其装备、当日天气相适合的出行草稿，简洁中文。
days 是用户的手填规划；candidates 是腾讯地图两点之间的普通步行路网估算；weather 是和风指定地点预报，不代表山脊或全线路况。
若有 itineraries，比较连续行走的 1 至 3 天方案、每日里程及用时与历史经历、天气、装备，选择适合使用者的一条，将从 0 开始的编号放入 itinerary。合理的一日路线不拆成多天；过夜和退路未核实必须提示。没有合理方案填 null，由用户补充路线。
若有手填行程，逐日从 evidence 的 candidates 的 0 起始索引中选一个，缺少合理路线可选 null，写入 choices。历史经历用于解释取舍；不把以前的路线当作本次路线。
不要创造地点、里程、爬升、开放情况、交通班次、住宿或天气事实。没有核实的情况列入出发前检查。不得认定能走完或给安全等级。
装备按这次路线、天气和过夜安排决定。先逐项查看完整 gear 的名称、分类、标签和已知规格，把能满足需求的自有装备放进 equipment，使用其原始 id、建议携带数量，并说明本次为什么带。名称不同而用途和规格足以替代的也优先选用。相同用途有多个合适选项时选最合适的一件；同一件装备兼顾多个用途时只列一次。不要为了用上库存而带无关物品。
检查完自有装备，再把仍有缺口的需求放进 missing，直接给可准备的具体物品、建议数量、简短的适用规格或选择理由。不要重复推荐已满足的需求，也不要把库外推荐称为已拥有。库存空时，仍按行程直接给出合适清单；全部够用时 missing 为空。不要只列“照明类”等大类，也不要编造品牌型号、价格或购买链接。
两组中每项的 need 表示具体的可替代需求，如“夜行主照明”“头灯备用电源”。同一需求使用相同文字。水壶能装水，不能代替饮用水；防雨外套能给人挡雨，不能代替背包防雨罩。不要仅凭相同标签判断已满足。
不要添加用户没有提供的个人资料。只输出以下格式的 JSON：
{"summary":"一至三句具体建议","itinerary":0,"choices":[0],"equipment":[{"id":"已有装备id","need":"具体需求","quantity":1,"reason":"本次选择依据"}],"missing":[{"name":"具体物品","need":"具体需求","quantity":1,"reason":"适用规格或选择理由"}],"notes":["出发前可执行的检查"]}`;

async function askModel(context) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('尚未配置 DeepSeek。');
  const reply = await request('DeepSeek', 'https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'enabled' }, reasoning_effort: 'high',
      response_format: { type: 'json_object' }, max_tokens: 8192, stream: false,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(context) }] })
  }, 85000);
  const choice = reply.choices?.[0];
  try {
    if (choice?.finish_reason !== 'stop') throw new Error();
    return JSON.parse(choice.message.content);
  } catch {
    throw new Error('AI 方案未生成完整，请重试。');
  }
}

module.exports = { coordinates, suggestions, namedPlace, nearbyTrails, walking, forecastSpan, forecast, askModel };
