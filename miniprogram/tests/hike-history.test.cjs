const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectRecord, normalizeEffort, EFFORT_LABELS } = require('../utils/hikeHistory');

const today = '2025-03-01';
const regular = { name: 'PROFILE TEST 平坦路线', date: '2024-02-29', distance: '8.5', hours: '2', ascent: '0', load: 0,
  effortLevel: 1, note: '天气炎热，中途休息' };

test('all five structured ratings have stable labels and preserve notes and valid zeroes', () => {
  const expected = ['非常轻松', '比较轻松', '适中', '比较吃力', '非常吃力'];
  assert.deepEqual(EFFORT_LABELS.slice(1), expected);
  expected.forEach((label, index) => {
    const result = inspectRecord({ ...regular, effort: 'ignored legacy label', effortLevel: index + 1 }, today);
    assert.equal(result.eligible, true);
    assert.equal(result.record.effortLevel, index + 1);
    assert.equal(result.record.effort, label);
    assert.equal(result.record.note, regular.note);
    assert.equal(result.record.ascent, 0);
    assert.equal(result.record.load, 0);
  });
});

test('legacy effort mapping is explicit and unknown labels are retained without a rating', () => {
  assert.deepEqual(normalizeEffort({ effort: '轻松' }), { level: 2, label: '比较轻松' });
  assert.deepEqual(normalizeEffort({ effort: '适中' }), { level: 3, label: '适中' });
  assert.deepEqual(normalizeEffort({ effort: '吃力' }), { level: 4, label: '比较吃力' });
  assert.deepEqual(normalizeEffort({ effort: '肌肉酸痛' }), { level: null, label: '肌肉酸痛' });
  for (const effortLevel of [0, 6, 2.5, '2', NaN]) {
    assert.equal(normalizeEffort({ effortLevel, effort: '轻松' }).level, null);
  }
});

test('required positive metrics reject missing, zero, negative and malformed input', () => {
  for (const key of ['distance', 'hours']) {
    for (const value of [null, '', ' ', 0, '0', '-1', NaN, Infinity, '1e4', '3 km', true]) {
      const result = inspectRecord({ ...regular, [key]: value }, today);
      assert.equal(result.validRecord, true);
      assert.equal(result.eligible, false);
      assert.match(result.fields[key], /大于 0/);
      assert.equal(result.record[key], null);
    }
  }
  const result = inspectRecord({ ...regular, ascent: ' ', load: null, hours: '' }, today);
  assert.deepEqual(result.missingFields, ['hours', 'ascent', 'load']);
});

test('optional metrics can be unknown but invalid values prevent use for assessment', () => {
  const unknown = inspectRecord({ ...regular, ascent: null, load: '' }, today);
  assert.equal(unknown.eligible, true);
  assert.deepEqual(unknown.missingFields, ['ascent', 'load']);
  const invalid = inspectRecord({ ...regular, ascent: -1, load: NaN }, today);
  assert.equal(invalid.eligible, false);
  assert.deepEqual(Object.keys(invalid.fields), ['ascent', 'load']);
});

test('calendar validation rejects impossible and future dates and accepts long multi-day records', () => {
  for (const date of ['2025-02-29', '2024-04-31', '2025-03-02', '2024-00-00', '2024-2-1', 20250228, '']) {
    assert.equal(inspectRecord({ ...regular, date }, today).validRecord, false);
  }
  assert.equal(inspectRecord({ ...regular, date: today, distance: 290, hours: 100, ascent: 9500, load: 45 }, today).eligible, true);
});
