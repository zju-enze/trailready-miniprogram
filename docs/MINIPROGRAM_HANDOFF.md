# TrailReady 微信小程序开发交接

交接日期为 2026 年 11 月 17 日。TrailReady 帮助徒步者在出发前选装备、核对路线与接驳，并在下次打开微信时继续准备。本次交付的是原生微信小程序源码。AI 推荐、计划生成和风险评估已暂缓，当前版本只记录用户手工填写的徒步经历。

## 第一次运行

1. 准备 Git、Node.js 和微信开发者工具。本次使用 Node.js 22 验证。克隆公开仓库后，在终端进入 `miniprogram` 目录。

   ```sh
   git clone https://github.com/zju-enze/trailready-miniprogram.git
   cd trailready-miniprogram/miniprogram
   npm ci
   ```

2. 首次运行时，把 `utils/config.example.js` 复制为 `utils/config.js`，值可以留空。Windows PowerShell 可执行以下命令。

   ```powershell
   if (!(Test-Path utils/config.js)) { Copy-Item utils/config.example.js utils/config.js }
   ```

3. 在微信开发者工具中导入 **`miniprogram/`**，即包含 `project.config.json` 的目录。公开版使用游客 AppID。团队成员做真机预览、体验版或反馈收件测试时，使用自己有开发权限的小程序 AppID。
4. 依次点「工具 → 构建 npm」和「普通编译 → 编译」。首次启动要等微信基础库下载完成。若日志提示缺少 `WAWebview.js`，先看基础库下载是否成功，成功后重新编译。

## 从哪里接手

| 用户操作 | 主要源码 | 修改时应保留的行为 |
| --- | --- | --- |
| 在「准备」创建、切换和继续行程 | [总览页](../miniprogram/pages/overview/overview.js)、[行程编辑页](../miniprogram/pages/index/index.js) | 进入首页恢复上次选中的行程，更改接驳内容后需重新确认 |
| 在「装备」维护库存，为某趟行程选装备 | [装备库](../miniprogram/pages/gear/gear.js)、[本次装备](../miniprogram/pages/carry/carry.js) | 库存全局共用，携带数量、穿着方式和勾选归属单趟行程；身上穿着的物品不计包重 |
| 出发前核对已装包物品和待办 | [行前清单](../miniprogram/pages/checklist/checklist.js)、[存储和进度计算](../miniprogram/utils/trips.js) | 未知重量可留空。保存失败时给出提示，避免把未保存的操作算作已完成 |
| 在「经历」手工记录实际走过的路线 | [徒步经历](../miniprogram/pages/history/history.js) | 可以补录日期、里程、爬升、耗时、负重、体感和备注。经历可编辑、删除，规划中的行程不会自动变成经历 |

底部悬浮栏有「准备」「装备」「经历」三个入口。修改入口时同时更新 [页面注册与 tabBar](../miniprogram/app.json)、[悬浮栏](../miniprogram/custom-tab-bar/index.js)及选中、未选中的本地图标。页面共用的卡片、按钮与留白在 [app.wxss](../miniprogram/app.wxss)。

## 数据与外部服务

- `trailready_trips` 保存当前行程 ID、各趟行程及手工经历。较旧的本地数据可能没有 `history` 字段，按空列表读取。`trail_gear_closet` 保存个人装备库。清除微信小程序数据会清除这些记录，当前没有跨设备同步。
- 地点输入提示使用腾讯位置服务 WebServiceAPI，天气查询使用和风天气。两项服务曾在本机以「杭州九溪烟树 → 经纬度 → 对应日期预报」完成真实调用。公开仓库只提供空配置模板，尚未部署供体验用户使用的线上代理。[服务实现](../miniprogram/utils/weatherApi.js)
- 空配置下地点联想来自内置样例；行程页可手动选择参考天气。装备建议按规则计算。远期日期或供应商缺少当天数据时，底层代码可能返回季节估算，页面仍可能显示「查询预报」。正式对外使用前需区分实况来源、预报、手动条件和估算，并在缺数据时显示待核实。[装备推荐规则](../miniprogram/utils/recommendation.js)
- 正式接在线服务时，由服务端或云函数读取凭据。即使 `utils/config.js` 已被 Git 忽略，填入其中的内容仍可能进入上传的小程序包。勿将私钥、地图签名 SK 或服务端 API Key 放入发布包。

## 验证与试用

在 `miniprogram/` 执行以下命令，可测试装备增删改、装包统计、多行程冷启动恢复、接驳重新确认、经历增删改及存储失败行为。

```sh
node --test tests/packing.test.cjs tests/trip-resume.test.cjs
```

真机试用可从一趟一日徒步开始：新建行程，填入返程接驳，选一件装备并勾选装包；退出再打开，确认装备仍已装包、接驳仍待确认。新建第二趟行程，核对两趟进度相互独立。最后从「经历」补记一次已完成的徒步，并用「行前清单 → 反馈行前清单」提交一条测试意见，到团队的小程序管理后台核对收件。完整真机流程和反馈收件仍待验证。

小程序底版和界面图标分别保留了[上游许可证](../miniprogram/LICENSE)和[Phosphor Icons 许可证](../miniprogram/assets/nav/LICENSE)。[screenshots](../miniprogram/screenshots/) 保存的是上游参考图，当前界面以本仓库的普通编译结果为准。
