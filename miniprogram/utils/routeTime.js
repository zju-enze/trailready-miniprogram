const { getTodayString } = require('./dateUtils');
const { inspectRecord, readHistory } = require('./hikeHistory');

function durationText(hours) {
  const minutes = Math.round(hours * 60);
  const wholeHours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!wholeHours) return minutes === 0 && hours > 0 ? '不足 1 分' : minutes + ' 分';
  return wholeHours + ' 小时' + (remainder ? ' ' + remainder + ' 分' : '');
}

function hoursSourceFor(day, manualTrip) {
  if (day.hours == null) return null;
  return day.hoursSource || (manualTrip ? 'manual' : 'unknown');
}

function routeTimeText(day, manualTrip = false) {
  if (day.hours == null) return '';
  const source = hoursSourceFor(day, manualTrip);
  const label = source === 'map' ? '地图步行估时约 ' : source === 'manual' ? '手填计划用时 ' : '参考用时 ';
  return label + durationText(day.hours);
}

function lastHikeText(book) {
  const history = readHistory(book);
  if (!history.ok) return '';
  const today = getTodayString();
  let latest = null;
  for (const raw of history.records) {
    const { validRecord, record } = inspectRecord(raw, today);
    if (validRecord && record.distance > 0 && record.hours > 0 && (!latest || record.date > latest.date)) latest = record;
  }
  return latest ? '你上次走了 ' + latest.distance + ' 公里，用时 ' + durationText(latest.hours) : '';
}

module.exports = { hoursSourceFor, routeTimeText, lastHikeText };
