module.exports = function previewConnection() {
  const account = wx.getAccountInfoSync?.();
  const device = wx.getDeviceInfo?.() || wx.getSystemInfoSync?.();
  if (account?.miniProgram?.envVersion === 'develop' && device?.platform === 'devtools') {
    return { url: 'http://127.0.0.1:8791/trail-assistant' };
  }
  return null;
};
