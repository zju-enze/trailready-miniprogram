const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { verifyEndpoint, prepareServer } = require('../scripts/prepare-https-preview.cjs');

test('服务器缺少配对码时拒绝启动', () => {
  const result = spawnSync(process.execPath, [require.resolve('../scripts/serve-assistant.cjs'), '--server'], {
    env: { ...process.env, TRAIL_PREVIEW_TOKEN: '', DEEPSEEK_API_KEY_FILE: '' }, encoding: 'utf8', timeout: 3000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TRAIL_PREVIEW_TOKEN/);
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

test('服务器预览从源码生成小程序，仅开发版带配对信息', async t => {
  const temp = mkdtempSync(path.join(tmpdir(), 'trail-preview-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'miniprogram');
  for (const folder of ['pages', 'custom-tab-bar', 'assets', 'utils', 'cloudfunctions', 'miniprogram_npm/tdesign-miniprogram/button']) {
    mkdirSync(path.join(source, folder), { recursive: true });
  }
  for (const file of ['app.js', 'app.json', 'app.wxss', 'package.json', 'utils/config.js', 'miniprogram_npm/tdesign-miniprogram/button/button.js']) {
    writeFileSync(path.join(source, file), file.endsWith('.json') ? '{}' : '');
  }
  writeFileSync(path.join(source, 'project.config.json'), '{"appid":"touristappid","cloudfunctionRoot":"cloudfunctions/"}');
  writeFileSync(path.join(temp, 'token'), 'test-pairing-code\n');
  const originalEnv = process.env;
  process.env = { ...originalEnv, TRAIL_PREVIEW_TOKEN: '', TRAIL_PREVIEW_TOKEN_FILE: path.join(temp, 'token'), TRAIL_WECHAT_APPID: 'wx0000000000000001' };
  t.after(() => { process.env = originalEnv; });
  const origin = 'https://preview.example.com';
  const output = path.join(temp, '.local');
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, origin + '/trail-assistant');
    return options.headers['X-Trail-Preview'] === 'test-pairing-code' ? Response.json({ places: [] }) : new Response(null, { status: 403 });
  });
  await assert.rejects(prepareServer('http://preview.example.com', source, output), /HTTPS/);
  const project = await prepareServer(origin, source, output);
  const config = JSON.parse(readFileSync(path.join(project, 'project.config.json')));
  assert.equal(config.appid, 'wx0000000000000001');
  assert.equal(config.cloudfunctionRoot, undefined);
  assert.ok(existsSync(path.join(project, 'miniprogram_npm/tdesign-miniprogram/button/button.js')));
  assert.ok(!existsSync(path.join(project, 'utils/config.js')));
  assert.ok(!existsSync(path.join(project, 'cloudfunctions')));
  const connection = require(path.join(project, 'utils/previewConnection.js'));
  let envVersion = 'develop';
  global.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion } }) };
  t.after(() => { delete global.wx; });
  assert.deepEqual(connection(), { url: origin + '/trail-assistant', header: { 'Content-Type': 'application/json', 'X-Trail-Preview': 'test-pairing-code' } });
  for (envVersion of ['trial', 'release']) assert.equal(connection(), null);
});
