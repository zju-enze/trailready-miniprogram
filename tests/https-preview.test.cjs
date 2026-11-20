const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyEndpoint } = require('../scripts/prepare-https-preview.cjs');
const { previewModule } = require('../scripts/serve-assistant.cjs');
const { runInNewContext } = require('node:vm');

test('独立本机和局域网预览仅在对应开发端启用', () => {
  let platform = 'devtools', envVersion = 'develop';
  const wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion } }), getDeviceInfo: () => ({ platform }) };
  const load = (address, token) => runInNewContext(previewModule(address, token), { wx, module: {} });
  const simulator = load(), phone = load('192.168.1.2', 'test-only');
  assert.equal(simulator().url, 'http://127.0.0.1:8791/trail-assistant');
  platform = 'ios';
  assert.equal(simulator(), null);
  assert.equal(phone().url, 'http://192.168.1.2:8791/trail-assistant');
  assert.equal(phone().header['X-Trail-Preview'], 'test-only');
  for (envVersion of ['trial', 'release']) {
    assert.equal(phone(), null);
    assert.equal(simulator(), null);
  }
});

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
