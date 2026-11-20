// 本机和扫码联调都运行正式版的云函数代码。
const { createServer } = require('node:http');
const { randomBytes } = require('node:crypto');
const { networkInterfaces } = require('node:os');
const { readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync } = require('node:fs');
const path = require('node:path');

const { main } = require('../miniprogram/cloudfunctions/trailAssistant');

async function handle(request, response, pairingToken) {
  const send = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  };
  if (request.method !== 'POST' || request.url !== '/trail-assistant') {
    return send(404, { error: '没有这个接口。' });
  }
  if (pairingToken && request.headers['x-trail-preview'] !== pairingToken) {
    return send(403, { error: '请重新扫描本次联调二维码。' });
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    return send(415, { error: '请发送 JSON 请求。' });
  }
  let event;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 256 * 1024) return send(413, { error: '行程资料过长。' });
      chunks.push(chunk);
    }
    event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(400, { error: '请检查请求内容。' });
  }
  try {
    send(200, await main(event));
  } catch {
    send(502, { error: '行前助手暂时无法完成请求，请稍后重试。' });
  }
}

function listen(address, pairingToken) {
  createServer((request, response) => handle(request, response, pairingToken))
    .listen(8791, address, () => console.log('行前助手已监听 ' + address + ':8791'));
}

function previewModule(address, token) {
  const connection = { url: 'http://' + (address || '127.0.0.1') + ':8791/trail-assistant' };
  if (address) connection.header = { 'Content-Type': 'application/json', 'X-Trail-Preview': token };
  const simulator = address ? '' : ' && (wx.getDeviceInfo?.() || wx.getSystemInfoSync()).platform === "devtools"';
  return 'module.exports = () => wx.getAccountInfoSync().miniProgram.envVersion === "develop"'
    + simulator + ' ? ' + JSON.stringify(connection) + ' : null;\n';
}

function preparePreview(address, token) {
  const source = path.resolve(__dirname, '../miniprogram');
  const output = path.resolve(__dirname, '../.local');
  mkdirSync(output, { recursive: true });
  const project = mkdtempSync(path.join(output, address ? 'phone-preview-' : 'simulator-preview-'));
  for (const file of ['app.js', 'app.json', 'app.wxss', 'package.json', 'pages', 'custom-tab-bar', 'assets', 'utils', 'miniprogram_npm']) {
    cpSync(path.join(source, file), path.join(project, file), {
      recursive: true, filter: p => path.basename(p) !== 'config.js' || path.dirname(p) !== path.join(source, 'utils')
    });
  }
  const config = JSON.parse(readFileSync(path.join(source, 'project.config.json'), 'utf8'));
  delete config.cloudfunctionRoot;
  config.projectname = address ? 'TrailReady-真机联调' : 'TrailReady-本机联调';
  writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2));
  writeFileSync(path.join(project, 'project.private.config.json'), JSON.stringify({ projectname: config.projectname, setting: { urlCheck: false } }));
  writeFileSync(path.join(project, 'utils/previewConnection.js'), previewModule(address, token));
  return project;
}

if (require.main === module) {
  const address = process.argv[2];
  if (address && !Object.values(networkInterfaces()).flat().some(ip => ip && ip.family === 'IPv4' && !ip.internal && ip.address === address)) {
    throw new Error('请传入电脑当前连接手机 Wi-Fi 的 IPv4 地址。');
  }
  if (!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY_FILE) {
    process.env.DEEPSEEK_API_KEY = readFileSync(process.env.DEEPSEEK_API_KEY_FILE, 'utf8').trim();
  }
  const token = address ? randomBytes(24).toString('hex') : null;
  const project = preparePreview(address, token);
  console.log((address ? '真机调试工程 ' : '本机调试工程 ') + project);
  if (address) listen(address, token);
  listen('127.0.0.1');
}

module.exports = { previewModule };
