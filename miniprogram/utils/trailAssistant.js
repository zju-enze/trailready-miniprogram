const previewConnection = require('./previewConnection');
let cloudReady = false;
let connection;

function initAssistant(env) {
  cloudReady = false;
  connection = env ? null : previewConnection();
  if (connection || !wx.cloud) return;
  try {
    wx.cloud.init(env ? { env, traceUser: false } : { traceUser: false });
    cloudReady = true;
  } catch (error) {
    console.warn('微信云服务未能初始化');
  }
}

function assistantAvailable() {
  return !!connection || cloudReady;
}

async function callAssistant(data) {
  let result;
  if (connection) {
    result = await new Promise((resolve, reject) => wx.request({
      url: connection.url, header: connection.header || { 'content-type': 'application/json' },
      method: 'POST', data, timeout: 120000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 || response.data?.error) resolve(response.data);
        else reject(new Error('行前服务暂不可用'));
      },
      fail() { reject(new Error('未能连接行前服务，请检查网络后重试。')); }
    }));
  } else {
    if (!cloudReady) throw new Error('当前小程序未连接微信云服务');
    try {
      const response = await wx.cloud.callFunction({ name: 'trailAssistant', data });
      result = response.result;
    } catch (error) {
      throw new Error('暂时无法连接微信云服务');
    }
  }
  if (!result || typeof result !== 'object') throw new Error('行前服务未返回有效结果');
  if (result.error) throw new Error(result.error.message || String(result.error));
  return result;
}

module.exports = { callAssistant, initAssistant, assistantAvailable };
