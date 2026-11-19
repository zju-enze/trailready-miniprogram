const { readFileSync } = require('node:fs');
const path = require('node:path');
const { writePreviewProject } = require('./preview-project.cjs');

const privateDir = path.resolve(__dirname, '../.local');

async function verifyEndpoint(url, header) {
  const probe = headers => fetch(url, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ action: 'places', query: '' })
  });
  const anonymous = await probe({ 'Content-Type': 'application/json' });
  if (anonymous.status !== 403) throw new Error('入口未返回配对校验的 403，请检查服务器是否启用了配对校验。');
  const paired = await probe(header);
  if (!paired.ok || !Array.isArray((await paired.json()).places)) throw new Error('联调工程的配对信息已失效。');
}

async function prepare(pairedProject, origin) {
  if (!pairedProject || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(origin || '')) {
    throw new Error('用法：node scripts/prepare-https-preview.cjs <局域网联调工程路径> https://<临时域名>.trycloudflare.com');
  }
  const source = path.resolve(pairedProject);
  if (path.basename(path.dirname(source)) !== '.local' || !path.basename(source).startsWith('phone-preview-')) {
    throw new Error('请选择 serve-assistant.cjs 生成的 .local/phone-preview-* 工程。');
  }
  const modulePath = path.join(source, 'utils/previewConnection.js');
  global.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) };
  const connection = require(modulePath)();
  if (!connection?.header?.['X-Trail-Preview']) throw new Error('所选工程缺少联调配对信息。');
  const publicUrl = new URL('/trail-assistant', origin).href;
  await verifyEndpoint(connection.url, connection.header);
  await verifyEndpoint(publicUrl, connection.header);

  return writePreviewProject(source, privateDir, 'phone-internet-', { url: publicUrl, header: connection.header });
}

async function prepareServer(origin, source = path.resolve(__dirname, '../miniprogram'), output = privateDir) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('请只填写可信服务器的 HTTPS 源地址，例如 https://trail.example.com。');
  }
  const token = process.env.TRAIL_PREVIEW_TOKEN || (process.env.TRAIL_PREVIEW_TOKEN_FILE &&
    readFileSync(process.env.TRAIL_PREVIEW_TOKEN_FILE, 'utf8').trim());
  if (!token) throw new Error('请设置 TRAIL_PREVIEW_TOKEN 或 TRAIL_PREVIEW_TOKEN_FILE。');
  const appid = process.env.TRAIL_WECHAT_APPID || JSON.parse(readFileSync(path.join(source, 'project.config.json'), 'utf8')).appid;
  if (!/^wx[\da-f]{16}$/i.test(appid)) throw new Error('请在 TRAIL_WECHAT_APPID 中填写当前微信小程序的真实 AppID。');
  url.pathname = '/trail-assistant';
  const connection = { url: url.href, header: { 'Content-Type': 'application/json', 'X-Trail-Preview': token } };
  await verifyEndpoint(connection.url, connection.header);
  return writePreviewProject(source, output, 'phone-server-', connection, appid);
}

if (require.main === module) {
  const [mode, origin] = process.argv.slice(2);
  const prepared = mode === '--server' ? prepareServer(origin) : prepare(mode, origin);
  prepared.then(project => console.log('跨网预览工程 ' + project)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyEndpoint, prepareServer };
