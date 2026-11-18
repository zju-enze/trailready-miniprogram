const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../utils/userProfile');

let profileDefinition, historyDefinition;
global.Page = definition => { profileDefinition = definition; };
require('../pages/profile/profile');
global.Page = definition => { historyDefinition = definition; };
require('../pages/history/history');

let disk, failReadKey, failWrite, toasts, chosenTab;

test.beforeEach(() => {
  disk = new Map();
  failReadKey = '';
  failWrite = false;
  toasts = [];
  chosenTab = '';
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
    switchTab(options) { chosenTab = options.url; },
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

test('first visit renders missing self assessment and empty history independently', () => {
  const page = open();
  assert.equal(page.data.profileError, '');
  assert.equal(page.data.statsError, '');
  assert.equal(page.data.selfRows.length, 6);
  assert.ok(page.data.selfRows.every(row => row.value === '尚未填写'));
  assert.equal(page.data.stats.totalHikes, 0);
  assert.ok(page.data.statRows.every(row => row.value === '暂无记录'));
  assert.equal(disk.size, 0);
});

test('editing options and numbers saves offline and restores on another visit', () => {
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
  const reopened = open();
  assert.equal(reopened.data.selfRows.find(row => row.key === 'comfortableDistanceKm').value, '12.5 km');
  assert.equal(reopened.data.selfRows.find(row => row.key === 'typicalLoadKg').value, '0 kg');
  reopened.edit();
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
  assert.equal(page.data.selfRows.find(row => row.key === 'comfortableDistanceKm').value, '7 km');
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
  let page = open();
  assert.ok(page.data.statsError);
  assert.equal(page.data.stats, null);
  assert.equal(page.data.selfRows.length, 6);
  failReadKey = 'trailready_user_profile';
  page = open();
  assert.ok(page.data.profileError);
  assert.equal(page.data.stats.totalHikes, 0);
  page.edit();
  assert.equal(page.data.editing, false);
});

test('actual history save, edit and delete operations update statistics on profile re-entry', () => {
  const page = open();
  const history = open(historyDefinition);
  history.edit({ currentTarget: { dataset: {} } });
  const values = { name: 'PROFILE TEST hike', note: '', distance: '15', ascent: '', hours: '4', load: '0' };
  history.saveRecord({ detail: { value: values } });
  page.onShow();
  assert.equal(page.data.stats.totalHikes, 1);
  assert.equal(page.data.stats.maxDistanceKm, 15);
  assert.equal(page.data.stats.maxAscentM, null);
  assert.equal(page.data.stats.maxLoadKg, 0);
  const id = history.data.records[0].id;
  history.edit({ currentTarget: { dataset: { id } } });
  history.saveRecord({ detail: { value: { ...values, distance: '8' } } });
  page.onShow();
  assert.equal(page.data.stats.maxDistanceKm, 8);
  history.edit({ currentTarget: { dataset: { id } } });
  history.remove();
  page.onShow();
  assert.equal(page.data.stats.totalHikes, 0);
  assert.equal(page.data.stats.maxDistanceKm, null);
});

test('onShow refreshes history without losing an in-progress self assessment draft', () => {
  const page = open();
  page.edit();
  page.changeField(event('comfortableDistanceKm', '9.'));
  disk.set('trailready_trips', { trips: [], history: [{ name: 'PROFILE TEST', date: '2025-01-01', distance: 7 }] });
  page.onShow();
  assert.equal(page.data.stats.totalHikes, 1);
  assert.equal(page.data.draft.comfortableDistanceKm, '9.');
  assert.equal(page.data.editing, true);
  page.openHistory();
  assert.equal(chosenTab, '/pages/history/history');
});
