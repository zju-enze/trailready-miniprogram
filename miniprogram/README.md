# TrailReady 微信小程序

本目录是 TrailReady 行前准备小程序的开发入口。源码引自 [TheBeginnerMeng/TrailReady](https://github.com/TheBeginnerMeng/TrailReady/tree/7ac82a98971056335b8b3bf855fa434460d769b8)，保留[上游 MIT 许可](LICENSE)与[原版页面截图](screenshots/)。团队接手时请先阅读[开发交接文档](../docs/MINIPROGRAM_HANDOFF.md)。

## 本地打开

在本目录执行 `npm ci`，首次使用时执行下面的 PowerShell 命令准备空白配置。

```powershell
if (!(Test-Path utils/config.js)) { Copy-Item utils/config.example.js utils/config.js }
```

用微信开发者工具导入本目录，选择「工具 → 构建 npm」，再编译。构建产物位于 `miniprogram_npm/`。体验版使用项目所属小程序的 AppID。

首页是「行程总览」。创建行程后填写每日路线与接驳，在「本次装备」中选择数量和穿着方式，在「行前清单」核对物品、准备事项与住宿接驳。底部的「反馈行前清单」使用 TDesign 按钮调用微信原生意见反馈。[微信反馈按钮](https://developers.weixin.qq.com/miniprogram/dev/component/button.html)

## 项目级技能与参考

仓库根目录的 [ui-design](../.agents/skills/ui-design/SKILL.md) 负责页面设计，[miniprogram-development](../.agents/skills/miniprogram-development/SKILL.md) 负责微信工程、调试与预览。两者来自[腾讯云官方技能仓库](https://github.com/TencentCloudBase/skills/tree/a5fbca30044c7fe4207260075bad80ccbb27a227)，配套说明位于各自目录及相邻的 `cloudbase-platform/references/protocols/`。

## 当前试用边界

行程、手选装备和核对进度随修改写入微信本地存储。退出再打开会恢复最近使用的行程，各趟行程的勾选独立，装备库共用。清除小程序数据会清除本地行程。行程编辑页的天气查询依赖外部服务，也可手动选择天气参考条件。

本地预览留空地图、天气凭据即可。上游接口设计在小程序端签名，发布前应把需要私钥或地图 SK 的请求移到服务端，小程序包内仅保留可公开配置。
