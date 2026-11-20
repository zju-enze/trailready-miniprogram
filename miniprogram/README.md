# TrailReady 微信小程序

输入徒步目的地和出发日期，按地址选好地点，即可查看参考个人装备和以往经历生成的 AI 行前草稿。确认采用后，推荐装备进入本次携带清单，缺少的物品进入待办。也可以手动创建行程、逐日填写路线与接驳，退出后回来继续装包。

## 开发与试用

安装 Node.js 22，在仓库根目录运行 `npm ci --prefix miniprogram`。用微信开发者工具导入本目录，选择「工具 → 构建 npm」，然后编译。

标准工程在开发者工具与手机上均通过微信云函数 `trailAssistant` 访问腾讯地图、和风天气和 DeepSeek。需先在本 AppID 关联的环境部署函数并配置供应商环境变量。默认调用微信的默认环境，指定环境的方法见[开发交接](../docs/MINIPROGRAM_HANDOFF.md)。

使用本机服务调试时，从仓库根目录运行以下命令，再将终端输出的 `.local/simulator-preview-*` 工程导入开发者工具：

```powershell
node --env-file-if-exists=.local/demo.env --env-file-if-exists=.local/trailready-services.env scripts/serve-assistant.cjs
```

正式版通过微信云函数 `trailAssistant` 接入外部服务。供应商凭据保存在服务端。地点日预报和普通步行路网估算作为行前参考，山路开放、住宿及接驳需按实际路线核实。[云函数源码](cloudfunctions/trailAssistant/index.js)

项目底版来自 [TheBeginnerMeng/TrailReady](https://github.com/TheBeginnerMeng/TrailReady/tree/7ac82a98971056335b8b3bf855fa434460d769b8)。仓库保留[上游 MIT 许可](LICENSE)及[原版截图](screenshots/)。
