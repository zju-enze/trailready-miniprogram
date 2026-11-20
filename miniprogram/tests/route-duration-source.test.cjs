const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../cloudfunctions/trailAssistant');

test('同一条腾讯步行路线只为缺失的用时补地图来源；输入的用时保留各自来源', async t => {
  Object.assign(process.env, { TENCENT_MAP_KEY: 'fixture', DEEPSEEK_API_KEY: 'fixture' });
  const to = { name: '终点', lat: 30.25, lng: 120.15 };
  let routeAvailable = true;
  t.mock.method(global, 'fetch', async url => {
    const target = new URL(url);
    if (target.pathname.includes('suggestion')) {
      return Response.json({ status: 0, data: [{ id: 'from', title: '起点', location: { lat: 30.20, lng: 120.12 } }] });
    }
    if (target.pathname.includes('walking')) {
      return Response.json({ status: 0, result: { routes: routeAvailable
        ? [{ distance: 7050, duration: 107, polyline: [30.20, 120.12, 50000, 30000] }] : [] } });
    }
    assert.equal(target.hostname, 'api.deepseek.com');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      summary: '测试行程', choices: [0], equipment: [], missing: [], notes: []
    }) } }] });
  });
  async function day(fields) {
    const reply = await main({ action: 'plan', destination: to.name, place: to, start: '2099-01-01',
      days: [{ from: '起点', destination: to.name, ...fields }] });
    assert.equal(reply.error, undefined);
    return reply.plan.days[0];
  }

  const mapped = await day({});
  assert.deepEqual([mapped.hours, mapped.hoursSource], [1.78, 'map']);
  for (const [hours, hoursSource] of [[3, 'manual'], [1.78, 'manual'], [0, 'manual'], [1.78, 'map'], [3, undefined]]) {
    const result = await day({ hours, hoursSource });
    assert.equal(result.map.points.length, 2);
    assert.deepEqual([result.hours, result.hoursSource], [hours, hoursSource ?? null]);
  }
  routeAvailable = false;
  const missing = await day({ hours: null, hoursSource: 'map' });
  assert.deepEqual([missing.hours, missing.hoursSource], [null, null]);
});
