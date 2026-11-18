const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyEndpoint } = require('../scripts/prepare-https-preview.cjs');

test('跨网预览只对要求配对的入口发送会话码', async t => {
  const headers = { 'Content-Type': 'application/json', 'X-Trail-Preview': 'test-only' };
  const calls = [];
  const probe = t.mock.method(global, 'fetch', async (_url, options) => {
    calls.push(options.headers);
    assert.deepEqual(JSON.parse(options.body), { action: 'places', query: '' });
    return Response.json({ places: [] });
  });
  await assert.rejects(verifyEndpoint('https://preview.invalid', headers), /403/);
  assert.deepEqual(calls, [{ 'Content-Type': 'application/json' }]);
  probe.mock.mockImplementation(async (_url, options) =>
    options.headers['X-Trail-Preview'] === 'test-only' ? Response.json({ places: [] }) : new Response(null, { status: 403 }));
  await verifyEndpoint('https://preview.invalid', headers);
  await assert.rejects(verifyEndpoint('https://preview.invalid', { ...headers, 'X-Trail-Preview': 'expired' }), /失效/);
});
