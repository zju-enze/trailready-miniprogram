const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

function previewModule(connection, simulatorOnly) {
  const simulator = simulatorOnly ? ' && (wx.getDeviceInfo?.() || wx.getSystemInfoSync()).platform === "devtools"' : '';
  return 'module.exports = () => wx.getAccountInfoSync().miniProgram.envVersion === "develop"'
    + simulator + ' ? ' + JSON.stringify(connection) + ' : null;\n';
}

function writePreviewProject(source, output, prefix, connection, appid) {
  const config = JSON.parse(readFileSync(path.join(source, 'project.config.json'), 'utf8'));
  if (appid) config.appid = appid;
  delete config.cloudfunctionRoot;
  const simulatorOnly = prefix === 'simulator-preview-';
  config.projectname = simulatorOnly ? 'TrailReady-本机联调' : 'TrailReady-真机联调';
  if (prefix === 'phone-server-') config.projectname = 'TrailReady-服务器联调';

  if (!existsSync(path.join(source, 'miniprogram_npm/tdesign-miniprogram/button/button.js'))) {
    throw new Error('缺少 TDesign 组件。请先在小程序工程安装依赖，在微信开发者工具中构建 npm。');
  }
  mkdirSync(output, { recursive: true });
  const project = mkdtempSync(path.join(output, prefix));
  for (const file of ['app.js', 'app.json', 'app.wxss', 'pages', 'custom-tab-bar', 'assets', 'utils', 'package.json',
    'miniprogram_npm/tdesign-miniprogram']) {
    cpSync(path.join(source, file), path.join(project, file), {
      recursive: true, filter: p => p !== path.join(source, 'utils/config.js')
    });
  }
  writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2));
  writeFileSync(path.join(project, 'project.private.config.json'), JSON.stringify({ projectname: config.projectname, setting: { urlCheck: false } }));
  writeFileSync(path.join(project, 'utils/previewConnection.js'), previewModule(connection, simulatorOnly));
  return project;
}

module.exports = { writePreviewProject, previewModule };
