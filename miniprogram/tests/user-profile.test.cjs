const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const service = require('../utils/userProfile');

const PROFILE = 'trailready_user_profile';
const TRIPS = 'trailready_trips';
let disk, writes, failRead, failWrite;

test.beforeEach(() => {
  disk = new Map();
  writes = [];
  failRead = false;
  failWrite = false;
  global.wx = {
    getStorageSync(key) {
      if (failRead) throw Error('test read failure');
      return structuredClone(disk.get(key));
    },
    setStorageSync(key, value) {
      if (failWrite) throw Error('test write failure');
      writes.push(key);
      disk.set(key, structuredClone(value));
    },
    request() { throw Error('Profile must work offline'); }
  };
});

function hike(id, fields = {}) {
  return { id, name: 'PROFILE TEST ' + id, date: '2025-01-01', ...fields };
}

function setHistory(history) {
  disk.set(TRIPS, { activeId: '', trips: [], history });
}

test('missing profile returns defaults without writing; empty history has null maxima', () => {
  const result = service.read();
  assert.equal(result.ok, true);
  assert.equal(result.exists, false);
  assert.equal(result.profile.version, 1);
  assert.deepEqual(result.profile.selfAssessment, {
    experienceLevel: '', fitnessLevel: '', comfortableDistanceKm: null,
    comfortableAscentM: null, comfortableDurationHours: null, typicalLoadKg: null
  });
  const { stats } = service.getPerformanceStats();
  assert.equal(stats.totalHikes, 0);
  assert.equal(stats.maxDistanceKm, null);
  assert.equal(stats.maxAscentM, null);
  assert.equal(stats.maxDurationHours, null);
  assert.equal(stats.maxLoadKg, null);
  assert.deepEqual(stats.loadRecords, []);
  assert.deepEqual(writes, []);
});

test('saving and partial updates preserve other profile fields and existing trip and gear data', () => {
  setHistory([hike('old')]);
  disk.set('trail_gear_closet', '[{"id":"existing"}]');
  const before = structuredClone(disk);
  const result = service.save({ experienceLevel: 'beginner', fitnessLevel: 'medium',
    comfortableDistanceKm: '12.5', comfortableAscentM: '650', comfortableDurationHours: '4', typicalLoadKg: '5.5' });
  assert.equal(result.ok, true);
  assert.equal(result.profile.selfAssessment.comfortableDistanceKm, 12.5);
  assert.ok(Number.isSafeInteger(result.profile.updatedAt));
  assert.equal(service.save({ comfortableDistanceKm: 15 }).ok, true);
  assert.equal(service.read().profile.selfAssessment.comfortableDistanceKm, 15);
  assert.equal(service.read().profile.selfAssessment.typicalLoadKg, 5.5);
  assert.deepEqual(disk.get(TRIPS), before.get(TRIPS));
  assert.equal(disk.get('trail_gear_closet'), before.get('trail_gear_closet'));
  assert.deepEqual(writes, [PROFILE, PROFILE]);
});

test('blank input clears a field, ascent and load accept zero, distance and duration reject zero', () => {
  assert.equal(service.save({ comfortableDistanceKm: '.5', comfortableDurationHours: '8.',
    comfortableAscentM: '0', typicalLoadKg: 0 }).ok, true);
  assert.equal(service.read().profile.selfAssessment.comfortableDistanceKm, 0.5);
  assert.equal(service.read().profile.selfAssessment.comfortableDurationHours, 8);
  assert.equal(service.read().profile.selfAssessment.comfortableAscentM, 0);
  assert.equal(service.read().profile.selfAssessment.typicalLoadKg, 0);
  assert.equal(service.save({ comfortableDistanceKm: '  ' }).ok, true);
  assert.equal(service.read().profile.selfAssessment.comfortableDistanceKm, null);
  assert.equal(service.save({ comfortableDistanceKm: 0 }).ok, false);
  assert.equal(service.save({ comfortableDurationHours: '0' }).ok, false);
});

test('invalid numeric values are rejected without changing storage', () => {
  service.save({ comfortableDistanceKm: 10 });
  const before = structuredClone(disk.get(PROFILE));
  const invalid = [-1, '-1', 'hello', '12 km', true, false, [], {}, NaN, Infinity, -Infinity,
    '1e2', '0x20', '1,5', Number.MAX_SAFE_INTEGER + 1];
  for (const value of invalid) {
    const result = service.save({ comfortableDistanceKm: value });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.ok(result.error.fields.comfortableDistanceKm);
    assert.deepEqual(disk.get(PROFILE), before);
  }
});

test('classification choices and writable fields are restricted', () => {
  for (const patch of [{ experienceLevel: 'expert' }, { fitnessLevel: 2 }, { score: 99 },
    { version: 9 }, { updatedAt: 1 }, JSON.parse('{"__proto__":{"score":99}}'), null, [], new Date()]) {
    assert.equal(service.save(patch).ok, false);
  }
  assert.deepEqual(writes, []);
});

test('legacy flat and wrapped profiles are read without writes and migrate when explicitly saved', () => {
  const old = { experienceLevel: 'occasional', fitnessLevel: 'medium', comfortableDistance: '8.75',
    comfortableAscent: '0', comfortableContinuousHours: '2.5', usualLoad: '0' };
  for (const stored of [old, { version: 0, selfAssessment: old }, JSON.stringify(old)]) {
    disk.set(PROFILE, structuredClone(stored));
    const result = service.read();
    assert.equal(result.ok, true);
    assert.equal(result.profile.selfAssessment.comfortableDistanceKm, 8.75);
    assert.equal(result.profile.selfAssessment.comfortableDurationHours, 2.5);
    assert.equal(result.profile.selfAssessment.typicalLoadKg, 0);
    assert.deepEqual(disk.get(PROFILE), stored);
  }
  assert.deepEqual(writes, []);
  assert.equal(service.save({ typicalLoadKg: 4 }).ok, true);
  assert.equal(disk.get(PROFILE).version, 1);
  assert.equal(disk.get(PROFILE).selfAssessment.comfortableDistanceKm, 8.75);
});

test('corrupt and future stored profiles are protected from overwrite', () => {
  for (const stored of ['{bad json', false, 1, [], new Date(), { version: 2 }, { version: -1 },
    { version: '1' }, { version: 1, selfAssessment: null },
    { version: 1, selfAssessment: { typicalLoadKg: -2 } }]) {
    disk.set(PROFILE, structuredClone(stored));
    assert.equal(service.read().ok, false);
    assert.equal(service.save({ typicalLoadKg: 2 }).ok, false);
    assert.deepEqual(disk.get(PROFILE), stored);
  }
  assert.deepEqual(writes, []);
});

test('storage read and write failures return errors and keep the saved profile', () => {
  service.save({ typicalLoadKg: 4 });
  const before = structuredClone(disk.get(PROFILE));
  failRead = true;
  assert.equal(service.read().error.code, 'STORAGE_READ_FAILED');
  assert.equal(service.save({ typicalLoadKg: 8 }).error.code, 'STORAGE_READ_FAILED');
  assert.equal(service.getPerformanceStats().error.code, 'STORAGE_READ_FAILED');
  failRead = false;
  failWrite = true;
  assert.equal(service.save({ typicalLoadKg: 8 }).error.code, 'STORAGE_WRITE_FAILED');
  assert.deepEqual(disk.get(PROFILE), before);
});

test('all history is counted, including an oldest maximum beyond the most recent twelve', () => {
  setHistory(Array.from({ length: 15 }, (_, index) => hike(String(index), {
    date: '2025-01-' + String(index + 1).padStart(2, '0'),
    distance: index === 0 ? 40 : 5, ascent: index * 10, hours: index / 2, load: index
  })));
  const { stats } = service.getPerformanceStats();
  assert.equal(stats.totalHikes, 15);
  assert.equal(stats.maxDistanceKm, 40);
  assert.equal(stats.maxAscentM, 140);
  assert.equal(stats.maxDurationHours, 7);
  assert.equal(stats.maxLoadKg, 14);
  assert.equal(stats.maxRecords.distance.id, '0');
  assert.equal(stats.source, TRIPS + '.history');
});

test('missing metrics still count as hikes; zero and legacy numeric strings remain valid', () => {
  setHistory([hike('missing'), hike('zero', { distance: 0, ascent: 0, hours: 0, load: 0 }),
    hike('decimal', { distance: ' 8.5 ', ascent: '120.5', hours: '.5', load: '4' })]);
  const { stats } = service.getPerformanceStats();
  assert.equal(stats.totalHikes, 3);
  assert.equal(stats.maxDistanceKm, 8.5);
  assert.equal(stats.maxAscentM, 120.5);
  assert.equal(stats.maxDurationHours, 0.5);
  assert.equal(stats.maxLoadKg, 4);
  assert.deepEqual(stats.metricCounts, { distance: 2, ascent: 2, hours: 2, load: 2 });
  setHistory([hike('allMissing', { distance: null, ascent: '', hours: ' ', load: undefined })]);
  const missing = service.getPerformanceStats().stats;
  assert.equal(missing.totalHikes, 1);
  assert.equal(missing.maxDistanceKm, null);
  assert.equal(missing.maxLoadKg, null);
});

test('damaged entries and invalid metrics are excluded independently without crashing', () => {
  setHistory([null, false, 'bad', [], {}, hike('future', { date: '2999-01-01' }),
    hike('badDate', { date: '2025-02-30' }), hike('noName', { name: '' }),
    hike('valid', { distance: -1, ascent: '30', hours: false, load: Infinity })]);
  const { stats } = service.getPerformanceStats();
  assert.equal(stats.totalHikes, 1);
  assert.equal(stats.ignoredRecordCount, 8);
  assert.equal(stats.maxDistanceKm, null);
  assert.equal(stats.maxAscentM, 30);
  assert.equal(stats.maxDurationHours, null);
  assert.equal(stats.maxLoadKg, null);
  assert.deepEqual(stats.invalidValueCounts, { distance: 1, ascent: 0, hours: 1, load: 1 });
  setHistory([hike('legacy', { id: { toString: 5, valueOf: 6 }, distance: 3 })]);
  const legacy = service.getPerformanceStats().stats;
  assert.equal(legacy.totalHikes, 1);
  assert.equal(legacy.maxDistanceKm, 3);
  assert.equal(legacy.maxRecords.distance.id, null);
});

test('adding, editing and deleting history refreshes maxima on each read', () => {
  setHistory([hike('first', { distance: 8 })]);
  assert.equal(service.getPerformanceStats().stats.maxDistanceKm, 8);
  disk.get(TRIPS).history.push(hike('second', { distance: 20 }));
  assert.equal(service.getPerformanceStats().stats.totalHikes, 2);
  assert.equal(service.getPerformanceStats().stats.maxDistanceKm, 20);
  disk.get(TRIPS).history[1].distance = 5;
  assert.equal(service.getPerformanceStats().stats.maxDistanceKm, 8);
  disk.get(TRIPS).history.shift();
  assert.equal(service.getPerformanceStats().stats.maxDistanceKm, 5);
  disk.get(TRIPS).history = [];
  assert.equal(service.getPerformanceStats().stats.maxDistanceKm, null);
});

test('load records include zero, sort by activity date and preserve the source book', () => {
  setHistory([hike('old', { date: '2024-01-01', load: 7 }), hike('new', { date: '2025-03-01', load: 0 }),
    hike('missing'), hike('bad', { load: true })]);
  const before = structuredClone(disk.get(TRIPS));
  const { stats } = service.getPerformanceStats();
  assert.deepEqual(stats.loadRecords.map(record => [record.id, record.loadKg]), [['new', 0], ['old', 7]]);
  assert.deepEqual(disk.get(TRIPS), before);
  assert.deepEqual(writes, []);
});

test('legacy book without history is empty; malformed overall history returns a readable error', () => {
  disk.set(TRIPS, { activeId: '', trips: [] });
  assert.equal(service.getPerformanceStats().stats.totalHikes, 0);
  for (const book of ['bad book', { history: {} }, { history: 'bad' }]) {
    disk.set(TRIPS, book);
    assert.equal(service.getPerformanceStats().error.code, 'INVALID_HISTORY');
  }
});

test('history remains readable when self assessment is damaged, and current-version extension data survives saves', () => {
  setHistory([hike('test', { distance: 3 })]);
  disk.set(PROFILE, '{bad');
  assert.equal(service.read().ok, false);
  assert.equal(service.getPerformanceStats().stats.totalHikes, 1);
  disk.set(PROFILE, { version: 1, selfAssessment: { extension: 'kept' }, localRevision: 7 });
  assert.equal(service.save({ typicalLoadKg: 2 }).ok, true);
  assert.equal(disk.get(PROFILE).localRevision, 7);
  assert.equal(disk.get(PROFILE).selfAssessment.extension, 'kept');
});

test('plain objects from another runtime context work for profile input and mocked SDK reads', () => {
  const input = vm.runInNewContext('({ comfortableDistanceKm: 7.25, typicalLoadKg: 0 })');
  assert.equal(service.save(input).ok, true);
  const book = vm.runInNewContext("({ trips: [], history: [{ name: 'PROFILE TEST foreign context', date: '2025-01-01', distance: 9 }] })");
  const originalRead = wx.getStorageSync;
  wx.getStorageSync = key => key === TRIPS ? book : originalRead(key);
  const result = service.getPerformanceStats();
  assert.equal(result.ok, true);
  assert.equal(result.stats.totalHikes, 1);
  assert.equal(result.stats.maxDistanceKm, 9);
});
