const { callAssistant } = require('./trailAssistant');
const dates = require('./dateUtils');

const MAX_FORECAST_DAYS = 30;
const BUILTIN_PLACES = {
  '东湖': [
    { title: '东湖风景区', address: '湖北省武汉市武昌区沿湖大道16号', lat: 30.55, lng: 114.38, category: '旅游景点:风景名胜' },
    { title: '东湖生态旅游风景区', address: '湖北省武汉市洪山区珞喻路', lat: 30.52, lng: 114.42, category: '旅游景点:公园' },
    { title: '东湖公园', address: '广东省深圳市罗湖区爱国路', lat: 22.55, lng: 114.14, category: '旅游景点:公园' },
    { title: '南昌市东湖区', address: '江西省南昌市东湖区', lat: 28.69, lng: 115.87, category: '行政区划:区县' }
  ],
  '华山': [
    { title: '华山风景名胜区', address: '陕西省渭南市华阴市G310(连天线)', lat: 34.48, lng: 110.09, category: '旅游景点:风景名胜' },
    { title: '华山国家森林公园', address: '陕西省渭南市华阴市', lat: 34.49, lng: 110.08, category: '旅游景点:森林公园' }
  ],
  '雨崩': [
    { title: '雨崩村', address: '云南省迪庆藏族自治州德钦县云岭乡', lat: 28.40, lng: 98.79, category: '旅游景点:村落' }
  ],
  '四姑娘山': [
    { title: '四姑娘山景区', address: '四川省阿坝藏族羌族自治州小金县', lat: 31.11, lng: 102.90, category: '旅游景点:风景名胜' }
  ],
  '香格里拉': [
    { title: '香格里拉', address: '云南省迪庆藏族自治州香格里拉市', lat: 27.83, lng: 99.70, category: '行政区划:地级市' },
    { title: '香格里拉·普达措国家公园', address: '云南省迪庆藏族自治州香格里拉市建塘镇', lat: 27.86, lng: 99.99, category: '旅游景点:国家级景点' }
  ],
  '稻城': [
    { title: '稻城亚丁风景区', address: '四川省甘孜藏族自治州稻城县', lat: 28.46, lng: 100.28, category: '旅游景点:风景名胜' },
    { title: '稻城县', address: '四川省甘孜藏族自治州稻城县', lat: 29.04, lng: 100.29, category: '行政区划:县' }
  ],
  '梅里雪山': [
    { title: '梅里雪山国家公园', address: '云南省迪庆藏族自治州德钦县', lat: 28.44, lng: 98.68, category: '旅游景点:森林公园' }
  ],
  '武功山': [
    { title: '武功山国家级风景名胜区', address: '江西省萍乡市芦溪县', lat: 27.47, lng: 114.19, category: '旅游景点:风景名胜' }
  ]
};

function isDateInForecastRange(date) {
  const today = dates.getTodayString();
  return date >= today && date <= dates.formatDayDate(today, MAX_FORECAST_DAYS - 1).dateString;
}

async function searchCities(text) {
  const query = text.trim();
  if (!query) return [];
  try {
    const { places } = await callAssistant({ action: 'places', query });
    if (places?.length) return places;
  } catch (error) {
    // 离线仍可查内置地点，用户也可以直接保留自己输入的地名。
  }
  const matches = BUILTIN_PLACES[query] || Object.values(BUILTIN_PLACES).flat().filter(
    place => place.title.includes(query) || place.address.includes(query)
  );
  return matches.map(place => ({
    id: place.title + ',' + place.lat + ',' + place.lng, builtin: true,
    name: place.title, address: place.address, lat: place.lat, lng: place.lng, category: place.category
  }));
}

async function fetchTripWeather(destination, days, coords) {
  const dates = days.filter(isDateInForecastRange);
  if (!dates.length) return {};
  const data = { action: 'weather', destination, dates };
  if (coords) data.coords = coords;
  const { weather } = await callAssistant(data);
  return weather || {};
}

module.exports = { searchCities, fetchTripWeather, isDateInForecastRange, MAX_FORECAST_DAYS };
