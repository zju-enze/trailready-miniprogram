const { cpSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const path = require('node:path');

async function verifyEndpoint(url, header) {
  const probe = headers => fetch(url, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ action: 'places', query: '' })
  });
  const anonymous = await probe({ 'Content-Type': 'application/json' });
  if (anonymous.status !== 403) throw new Error('入口未返回配对校验的 403，请检查中转是否指向受保护的局域网地址。');
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

  const privateDir = path.resolve(__dirname, '../.local');
  mkdirSync(privateDir, { recursive: true });
  const project = mkdtempSync(path.join(privateDir, 'phone-internet-'));
  const publicFiles = new Set(['app.js', 'app.json', 'app.wxss', 'package.json', 'pages', 'custom-tab-bar', 'assets',
    'utils', 'miniprogram_npm', 'project.config.json', 'project.private.config.json']);
  cpSync(source, project, {
    recursive: true,
    filter: file => {
      const rel = path.relative(source, file);
      return !rel || (publicFiles.has(rel.split(path.sep)[0]) && rel !== path.join('utils', 'config.js'));
    }
  });
  const relay = { url: publicUrl, header: connection.header };
  writeFileSync(path.join(project, 'utils/previewConnection.js'),
    'module.exports = () => wx.getAccountInfoSync().miniProgram.envVersion === "develop" ? ' + JSON.stringify(relay) + ' : null;\n');
  return project;
}

if (require.main === module) {
  prepare(...process.argv.slice(2)).then(project => console.log('跨网预览工程 ' + project)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyEndpoint };
