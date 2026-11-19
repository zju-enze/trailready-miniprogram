const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../utils/userProfile');

let profileDefinition, historyDefinition;
global.Page = definition => { profileDefinition = definition; };
require('../pages/profile/profile');
global.Page = definition => { historyDefinition = definition; };
require('../pages/history/history');

let disk, failReadKey, failWrite, toasts, backCount;

test.beforeEach(() => {
  disk = new Map();
  failReadKey = '';
  failWrite = false;
  toasts = [];
  backCount = 0;
  global.wx = {
    getStorageSync(key) {
      if (key === failReadKey) throw Error('test read failure');
      return structuredClone(disk.get(key));
    },
    setStorageSync(key, value) {
      if (failWrite) throw Error('test write failure');
      disk.set(key, structuredClone(value));
    },
    showToast(options) { toasts.push(options.title); },
    navigateBack() { backCount++; },
    showModal(options) { options.success({ confirm: true }); },
    request() { throw Error('Profile must work offline'); }
  };
});

function open(definition = profileDefinition) {
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = patch => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      const field = keys.pop();
      const parent = keys.reduce((object, key) => object[key], page.data);
      parent[field] = structuredClone(value);
    }
  };
  page.onShow();
  return page;
}

function event(field, value) {
  return { currentTarget: { dataset: { field } }, detail: { value } };
}

function abilityExplanation(page, key) {
  return page.data.ability.sections.find(section => section.key === key)?.lines.join(' ') ?? '';
}

test('first visit renders missing self assessment and empty history independently', () => {
  const page = open(historyDefinition);
  assert.equal(page.data.profileError, '');
  assert.equal(page.data.historyError, '');
  assert.equal(page.data.selfRows.length, 6);
  assert.ok(page.data.selfRows.every(row => row.value === '尚未填写'));
  assert.equal(page.data.stats.totalHikes, 0);
  assert.deepEqual(page.data.recentRecords, []);
  assert.ok(page.data.statRows.every(row => row.value === '暂无记录'));
  assert.equal(disk.size, 0);
});

test('history previews the latest three records with ties in original storage order', () => {
  const history = [
    { id: 'older', date: '2025-01-01' },
    { id: 'same-day-first', date: '2025-01-03' },
    { id: 'bad-date', date: '2025-99-01' },
    { id: 'latest', date: '2025-01-04' },
    { id: 'same-day-second', date: '2025-01-03' }
  ].map(record => ({ ...record, name: record.id }));
  disk.set('trailready_trips', { trips: [], history });
  const page = open(historyDefinition);
  assert.equal(page.data.profileExpanded, false);
  assert.equal(page.data.historyExpanded, false);
  assert.deepEqual(page.data.recentRecords.map(record => record.id), ['latest', 'same-day-first', 'same-day-second']);
  assert.deepEqual(page.data.records.map(record => record.id), ['latest', 'same-day-first', 'same-day-second', 'older', 'bad-date']);
  assert.equal(page.data.stats.totalHikes, 4);
  assert.deepEqual(disk.get('trailready_trips').history, history);
});

test('the two panels toggle independently and retain their state across data refreshes', () => {
  const history = [1, 2].map(number => ({ id: String(number), name: '测试路线', date: '2025-01-0' + number }));
  disk.set('trailready_trips', { trips: [], history });
  const page = open(historyDefinition);
  assert.deepEqual(page.data.recentRecords.map(record => record.id), ['2', '1']);
  page.toggleProfile();
  assert.equal(page.data.historyExpanded, false);
  page.toggleHistory();
  page.onShow();
  assert.equal(page.data.profileExpanded, true);
  assert.equal(page.data.historyExpanded, true);
  page.toggleProfile();
  assert.equal(page.data.historyExpanded, true);
  page.toggleHistory();
  assert.equal(page.data.profileExpanded, false);
  assert.equal(page.data.historyExpanded, false);
});

test('creating and editing update the recent preview and deleting backfills it', () => {
  const history = [4, 1, 3, 2].map(number => ({ id: String(number), name: '路线 ' + number,
    date: '2025-01-0' + number, distance: number, hours: 1, effortLevel: 3 }));
  disk.set('trailready_trips', { trips: [], history });
  const page = open(historyDefinition);
  const recent = () => page.data.recentRecords.map(record => record.name);

  page.toggleProfile();
  page.edit({ currentTarget: { dataset: {} } });
  page.changeEffort({ detail: { value: '3' } });
  page.saveRecord({ detail: { value: { name: '新路线', distance: '10', hours: '2', note: '新备注' } } });
  assert.deepEqual(recent(), ['新路线', '路线 4', '路线 3']);
  assert.equal(page.data.stats.maxDistanceKm, 10);
  assert.equal(page.data.profileExpanded, true);
  assert.equal(page.data.historyExpanded, false);

  page.toggleHistory();
  const newest = page.data.recentRecords[0];
  page.edit({ currentTarget: { dataset: { index: newest.index } } });
  page.changeDate({ detail: { value: '2024-12-31' } });
  page.saveRecord({ detail: { value: { ...page.data.draft, distance: '2' } } });
  assert.deepEqual(recent(), ['路线 4', '路线 3', '路线 2']);
  assert.equal(page.data.stats.maxDistanceKm, 4);
  assert.equal(page.data.historyExpanded, true);

  page.edit({ currentTarget: { dataset: { index: page.data.recentRecords[0].index } } });
  page.remove();
  assert.deepEqual(recent(), ['路线 3', '路线 2', '路线 1']);
  assert.equal(page.data.stats.maxDistanceKm, 3);
  assert.equal(page.data.historyExpanded, true);
  assert.deepEqual(disk.get('trailready_trips').history.map(record => record.name), ['新路线', '路线 1', '路线 3', '路线 2']);
});

test('editing options and numbers saves offline and restores on another visit', () => {
  const history = open(historyDefinition);
  const page = open();
  page.edit();
  page.changeOption(event('experienceLevel', '1'));
  page.changeOption(event('fitnessLevel', '2'));
  page.changeField(event('comfortableDistanceKm', '12.5'));
  page.changeField(event('comfortableAscentM', '0'));
  page.changeField(event('comfortableDurationHours', '4'));
  page.changeField(event('typicalLoadKg', '0'));
  page.save();
  assert.equal(page.data.editing, false);
  assert.deepEqual(toasts, ['自评已保存']);
  assert.equal(backCount, 1);
  history.onShow();
  assert.equal(history.data.selfRows.find(row => row.key === 'comfortableDistanceKm').value, '12.5 km');
  assert.equal(history.data.selfRows.find(row => row.key === 'typicalLoadKg').value, '0 kg');
  const reopened = open();
  assert.equal(reopened.data.draft.comfortableDistanceKm, '12.5');
  assert.equal(reopened.data.experienceIndex, 1);
  assert.equal(reopened.data.fitnessIndex, 2);
});

test('cancel discards unsaved edits without mutating the saved object', () => {
  service.save({ comfortableDistanceKm: 7 });
  const before = structuredClone(disk);
  const page = open();
  page.edit();
  page.changeField(event('comfortableDistanceKm', '20'));
  page.cancel();
  assert.equal(page.data.editing, false);
  assert.equal(open(historyDefinition).data.selfRows.find(row => row.key === 'comfortableDistanceKm').value, '7 km');
  assert.equal(backCount, 1);
  assert.deepEqual(disk, before);
});

test('invalid input stays editable and correcting it clears the field error', () => {
  const page = open();
  page.edit();
  page.changeField(event('typicalLoadKg', '-3'));
  page.save();
  assert.equal(page.data.editing, true);
  assert.equal(page.data.draft.typicalLoadKg, '-3');
  assert.ok(page.data.errors.typicalLoadKg);
  assert.equal(disk.size, 0);
  page.changeField(event('typicalLoadKg', '0'));
  assert.equal(page.data.errors.typicalLoadKg, undefined);
  page.save();
  assert.equal(page.data.editing, false);
  assert.equal(service.read().profile.selfAssessment.typicalLoadKg, 0);
});

test('failed save preserves the draft and the previous stored value until a successful retry', () => {
  service.save({ typicalLoadKg: 3 });
  const before = structuredClone(disk);
  const page = open();
  page.edit();
  page.changeField(event('typicalLoadKg', '5'));
  failWrite = true;
  page.save();
  assert.equal(page.data.editing, true);
  assert.equal(page.data.draft.typicalLoadKg, '5');
  assert.match(page.data.saveError, /保存失败/);
  assert.deepEqual(disk, before);
  assert.deepEqual(toasts, []);
  failWrite = false;
  page.save();
  assert.equal(service.read().profile.selfAssessment.typicalLoadKg, 5);
});

test('profile and history read failures display errors without inventing zero statistics', () => {
  failReadKey = 'trailready_trips';
  let page = open(historyDefinition);
  assert.ok(page.data.historyError);
  assert.equal(page.data.stats, null);
  assert.equal(page.data.selfRows.length, 6);
  failReadKey = 'trailready_user_profile';
  page = open(historyDefinition);
  assert.ok(page.data.profileError);
  assert.equal(page.data.stats.totalHikes, 0);
  assert.equal(open().data.editing, false);
});

test('history save, edit and delete immediately refresh statistics on the main tab', () => {
  const history = open(historyDefinition);
  history.edit({ currentTarget: { dataset: {} } });
  history.changeEffort({ detail: { value: '3' } });
  const values = { name: 'PROFILE TEST hike', note: '', distance: '15', ascent: '', hours: '4', load: '0' };
  history.saveRecord({ detail: { value: values } });
  assert.equal(history.data.stats.totalHikes, 1);
  assert.equal(history.data.stats.maxDistanceKm, 15);
  assert.equal(history.data.stats.maxAscentM, null);
  assert.equal(history.data.stats.maxLoadKg, 0);
  const { index } = history.data.records[0];
  history.edit({ currentTarget: { dataset: { index } } });
  history.saveRecord({ detail: { value: { ...values, distance: '8' } } });
  assert.equal(history.data.stats.maxDistanceKm, 8);
  history.edit({ currentTarget: { dataset: { index } } });
  history.remove();
  assert.equal(history.data.stats.totalHikes, 0);
  assert.equal(history.data.stats.maxDistanceKm, null);
});

test('the visible daily reference recomputes after history and self assessment changes', () => {
  const date = require('../utils/dateUtils').getTodayString();
  service.save({ comfortableDistanceKm: 6 });
  disk.set('trailready_trips', { trips: [], history: [
    { id: 'old-a', name: 'A', date, distance: 8, hours: 3, ascent: 300, effortLevel: 2 },
    { id: 'old-b', name: 'B', date, distance: 10, hours: 5, ascent: 650, effortLevel: 3 }
  ] });
  const page = open(historyDefinition);
  const distanceRow = () => page.data.ability.rows.find(row => row.key === 'distanceKm');
  assert.equal(page.data.ability.status, 'insufficient');
  const sparse = distanceRow().value;
  assert.match(abilityExplanation(page, 'overview'), /少量经历修正/);
  assert.equal(page.data.ability.rows.length, 6);
  assert.match(abilityExplanation(page, 'distance'), /对应距离 8–10 km/);
  assert.equal(page.data.abilityExpanded, false);
  page.toggleAbility();
  page.edit({ currentTarget: { dataset: {} } });
  page.changeEffort({ detail: { value: '2' } });
  const values = { name: 'C', distance: '11', ascent: '500', hours: '6' };
  page.saveRecord({ detail: { value: values } });
  assert.equal(page.data.ability.status, 'preliminary');
  assert.match(abilityExplanation(page, 'overview'), /多次历史校准/);
  assert.notEqual(distanceRow().value, sparse);
  const created = distanceRow().value;
  assert.match(abilityExplanation(page, 'distance'), /对应距离 8–11 km/);
  assert.equal(page.data.ability.rows.find(row => row.key === 'longTripLoadKg').value, '暂无可靠参考');
  assert.equal(page.data.profileExpanded, false);
  assert.equal(page.data.abilityExpanded, true);

  const { index } = page.data.recentRecords[0];
  page.edit({ currentTarget: { dataset: { index } } });
  page.saveRecord({ detail: { value: { ...values, distance: '12' } } });
  assert.notEqual(distanceRow().value, created);
  const edited = distanceRow().value;
  service.save({ comfortableDistanceKm: 24 });
  page.onShow();
  assert.match(abilityExplanation(page, 'comparison'), /自评.*高于/);
  assert.notEqual(distanceRow().value, edited);
  const withNewSelf = distanceRow().value;

  page.edit({ currentTarget: { dataset: { index } } });
  page.remove();
  assert.equal(page.data.ability.status, 'insufficient');
  assert.notEqual(distanceRow().value, withNewSelf);
  assert.match(abilityExplanation(page, 'overview'), /少量经历修正/);
  assert.equal(abilityExplanation(page, 'comparison'), '');
});

test('the empty history card guides setup and shows the source when a self assessment is added', () => {
  const page = open(historyDefinition);
  const rec = () => page.data.ability;
  assert.equal(rec().rows[0].value, '3–5 km');
  assert.match(abilityExplanation(page, 'overview'), /通用起步建议/);
  assert.equal(rec().showSetup, true);
  assert.match(abilityExplanation(page, 'overview'), /尚未经舒适经历验证/);
  assert.match(abilityExplanation(page, 'pace'), /通用基础耗时/);
  service.save({ experienceLevel: 'beginner', comfortableDistanceKm: 8, typicalLoadKg: 3 });
  page.onShow();
  assert.equal(rec().rows[0].value, '4.2–6 km');
  assert.match(abilityExplanation(page, 'overview'), /自评初步建议/);
  assert.equal(rec().showSetup, false);
  assert.match(abilityExplanation(page, 'load'), /自评常见负重 3 kg/);
  assert.equal(rec().rows.find(row => row.key === 'lowAscentPaceMinPerKm').value, '暂无可靠参考');
});

test('the unified evidence section has traceable bases and toggles without altering any indicator or stored record', () => {
  const date = require('../utils/dateUtils').getTodayString();
  service.save({ comfortableDistanceKm: 24, typicalLoadKg: 6 });
  const history = [8, 9, 10, 11].map((distance, i) => ({
    id: String(i), name: '验收路线 ' + i, date, distance, hours: 3, ascent: i < 2 ? 160 : 720, load: 3, effortLevel: 2
  }));
  history.push({ id: 'hard', name: '高负担经历', date, distance: 5, hours: 3, ascent: 160, effortLevel: 5 });
  disk.set('trailready_trips', { trips: [], history });
  const before = structuredClone(disk);
  const page = open(historyDefinition);
  const summary = structuredClone(page.data.ability.rows);
  assert.equal(page.data.abilityExpanded, false);
  assert.equal(summary.length, 6);
  assert.ok(summary.every(row => Object.keys(row).sort().join(',') === 'key,label,value'));
  assert.match(abilityExplanation(page, 'overview'), /多次历史校准.*5 条有效经历/);
  assert.match(abilityExplanation(page, 'distance'), /距离采用 4 条舒适经历.*历史权重.*1 条用于谨慎下调/);
  const examples = page.data.ability.sections.find(section => section.key === 'distance').examples;
  assert.equal(examples.length, 3);
  assert.match(examples[0], /验收路线 0.*8 km.*爬升 160 m/);
  assert.match(abilityExplanation(page, 'pace'), /低爬升（≤30 m\/km） · 2 条历史经历/);
  assert.match(abilityExplanation(page, 'pace'), /高爬升（>60 m\/km） · 2 条历史经历/);
  assert.match(abilityExplanation(page, 'load'), /短途（≤10 km） · 3 条历史经历/);
  assert.match(abilityExplanation(page, 'load'), /长途（>10 km） · 1 条历史经历/);
  assert.match(abilityExplanation(page, 'comparison'), /自评可接受距离高于/);
  assert.match(abilityExplanation(page, 'limitations'), /实际路线安全/);
  for (const expanded of [true, false]) {
    page.toggleAbility();
    assert.equal(page.data.abilityExpanded, expanded);
    assert.equal(page.data.profileExpanded, false);
    assert.equal(page.data.historyExpanded, false);
    assert.deepEqual(page.data.ability.rows, summary);
  }
  assert.deepEqual(disk, before);
});

test('onShow refreshes history without losing an in-progress self assessment draft', () => {
  const page = open();
  page.edit();
  page.changeField(event('comfortableDistanceKm', '9.'));
  disk.set('trailready_trips', { trips: [], history: [{ name: 'PROFILE TEST', date: '2025-01-01', distance: 7 }] });
  page.onShow();
  assert.equal(open(historyDefinition).data.stats.totalHikes, 1);
  assert.equal(page.data.draft.comfortableDistanceKm, '9.');
  assert.equal(page.data.editing, true);
});

test('history tab displays legacy self assessment and mixed records without writing storage', () => {
  disk.set('trailready_user_profile', { comfortableDistance: '8.5', experienceLevel: 'occasional' });
  disk.set('trailready_trips', { trips: [], history: [
    { id: 'old', date: '2025-01-01', name: 'PROFILE TEST old', distance: 0, ascent: 800, effort: '自订体感', note: '原备注' },
    { id: 'new', date: '2025-01-02', name: 'PROFILE TEST new', distance: 15, hours: 4, ascent: 0, effortLevel: 4 },
    { name: 'PROFILE TEST malformed date', date: 20250101, distance: 100 }
  ] });
  const before = structuredClone(disk);
  const page = open(historyDefinition);
  assert.equal(page.data.selfRows.find(row => row.key === 'comfortableDistanceKm').value, '8.5 km');
  assert.equal(page.data.records.length, 3);
  assert.equal(page.data.records[1].needsReview, true);
  assert.equal(page.data.records[1].effort, '自订体感');
  assert.equal(page.data.records[1].note, '原备注');
  assert.equal(page.data.stats.totalHikes, 2);
  assert.equal(page.data.stats.maxDistanceKm, 15);
  assert.equal(page.data.stats.maxAscentM, 800);
  assert.deepEqual(disk, before);

  page.edit({ currentTarget: { dataset: { index: page.data.records[1].index } } });
  assert.equal(page.data.draft.distance, '0');
  assert.equal(page.data.effortIndex, 0);
  assert.equal(page.data.legacyEffort, '自订体感');
  page.changeEffort({ detail: { value: '2' } });
  page.saveRecord({ detail: { value: { ...page.data.draft, distance: '10', hours: '2' } } });
  const repaired = disk.get('trailready_trips').history[0];
  assert.equal(repaired.legacyEffort, '自订体感');
  assert.equal(repaired.note, '原备注');
  assert.equal(repaired.effortLevel, 2);
  assert.equal(page.data.records[1].needsReview, false);
});

test('history form rejects invalid input and retains the draft on validation and storage failures', () => {
  const original = { trips: [], history: [{ id: 'old', name: 'PROFILE TEST old', date: '2025-01-01' }] };
  disk.set('trailready_trips', structuredClone(original));
  const page = open(historyDefinition);
  page.edit({ currentTarget: { dataset: {} } });
  const fields = { name: 'PROFILE TEST flat', note: '记录天气和路况', distance: '0', hours: '0', ascent: '0', load: '0' };
  page.saveRecord({ detail: { value: fields } });
  assert.deepEqual(Object.keys(page.data.fields).sort(), ['distance', 'effortLevel', 'hours']);
  assert.equal(page.data.draft.note, fields.note);
  assert.equal(page.data.draft.load, '0');
  assert.deepEqual(disk.get('trailready_trips'), original);
  page.changeEffort({ detail: { value: '5' } });
  failWrite = true;
  page.saveRecord({ detail: { value: { ...fields, distance: '9', hours: '2' } } });
  assert.equal(page.data.draft.distance, '9');
  assert.equal(page.data.effortIndex, 5);
  assert.match(page.data.error, /未保存/);
  assert.deepEqual(disk.get('trailready_trips'), original);
  failWrite = false;
  page.saveRecord({ detail: { value: page.data.draft } });
  const saved = disk.get('trailready_trips').history[0];
  assert.equal(saved.ascent, 0);
  assert.equal(saved.load, 0);
  assert.equal(saved.effortLevel, 5);
  assert.equal(saved.effort, '非常吃力');
  assert.equal(saved.note, fields.note);
});

test('editing an incomplete entry cannot overwrite a record that moved after the form opened', () => {
  const page = open(historyDefinition);
  const old = { id: 'old', name: 'PROFILE TEST old', date: '2025-01-01', extra: 'keep' };
  disk.set('trailready_trips', { trips: [], history: [old] });
  page.onShow();
  page.edit({ currentTarget: { dataset: { index: 0 } } });
  const updated = { trips: [], history: [{ ...old, id: 'other' }, old] };
  disk.set('trailready_trips', updated);
  page.changeEffort({ detail: { value: '3' } });
  page.saveRecord({ detail: { value: { ...page.data.draft, distance: '2', hours: '1' } } });
  assert.match(page.data.error, /未保存/);
  assert.deepEqual(disk.get('trailready_trips'), updated);
});
