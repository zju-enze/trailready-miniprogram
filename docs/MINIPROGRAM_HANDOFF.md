# TrailReady 微信小程序开发交接

更新于 2026 年 11 月 19 日。TrailReady 用来准备一次具体的徒步。在「准备」输入目的地和出发日期，可以生成 AI 草稿，也可以手工安排行程。个人装备和实际徒步经历在不同的行程之间复用。

## 用户怎样使用

1. 在「装备」录入自己拥有的物品。有重量就填写克数，暂时不知道可以留空。在「经历」中可选填以往路线的里程、爬升、用时、负重及体感。第一次使用也能规划。
2. 在「准备」输入目的地和日期，点「查找目的地」，按地址选择地图地点。名称相同的地点依靠这一步区分。已有行程时，可主动打开「参考当前行程的每日安排」。开始生成后，规划服务会收到本次目的地、日期、选中的每日安排、装备库和最近 12 次经历的相关字段。经历备注留在微信本地。
3. 草稿按天展示路线地图、里程和耗时，以及和风天气的预报地点、晴雨和高低温。点选某一天即可查看该日的路线和天气。地图沿腾讯步行路网返回的轨迹绘制；只有已确认地点时显示标记，缺少当天预报时显示「天气待核实」。只输入目的地时，服务查找周边登山口和观景点，从 1 至 3 天的连续步行候选中推荐方案。
4. 「从装备库选用」优先列出适合本次行程的自有物品。同用途的装备可替代时优先用已有的。仍有缺口的物品列在「建议补充」，显示具体物品、建议数量和选择依据。库存为空时可直接查看补充建议。
5. 点击「采用并新建行程」后，已选的自有装备进入本次携带，补充物品进入行前待办。可在首页打开「原始 AI 方案」回看生成时保存的地图与预报。修改行程日期或路线后，原始方案仍按生成时的日期展示。较早版本保存的方案可继续查看当时的文字摘要。

腾讯地图提供的距离和时间是普通步行路网估算。每日预报对应查询地点和日期，山脊天气、山路是否开放、住宿营业和返程班次仍需出发前核对。用户已填写的爬升可以保留，腾讯普通步行路线缺少的累计爬升留空。

## 开发者工具与同网真机联调

本机使用 Node.js 22。首次在仓库根目录运行 `npm ci --prefix miniprogram`，再将 `miniprogram/` 导入微信开发者工具。在「工具」中构建 npm，然后编译。此处使用的微信测试号没有云开发权限。本机联调运行与微信云函数相同的服务代码。

仅在开发者工具模拟器使用时，从仓库根目录运行以下命令，并在联调期间保留终端：

```powershell
node --env-file-if-exists=.local/demo.env --env-file-if-exists=.local/trailready-services.env scripts/serve-assistant.cjs
```

服务监听本机 `127.0.0.1:8791`。要让手机访问服务，把手机和电脑连到同一个 Wi-Fi，再运行下列命令，把最后一项替换成电脑在该 Wi-Fi 下的实际 IPv4 地址：

```powershell
node --env-file-if-exists=.local/demo.env --env-file-if-exists=.local/trailready-services.env scripts/serve-assistant.cjs <电脑Wi-Fi的IPv4>
```

使用同一端口时先结束先前的本机服务。启动后，终端会打印本次生成的 `.local/phone-preview-*` 目录。**在微信开发者工具导入终端打印的那个工程**，进入「真机调试」扫码，并按微信提示启用调试。本次联调包带有该电脑的地址和本次会话的配对信息，服务端供应商密钥只存在电脑上。电脑或网络地址改变后要重新启动服务并导入新生成的工程。团队日常修改源码仍在 `miniprogram/`。[联调启动脚本](../scripts/serve-assistant.cjs)

## 测试号通过移动数据临时预览

先启动上文的局域网配对服务，再用 Cloudflare Quick Tunnel 将其公开地址转发到 `http://<电脑 Wi-Fi IPv4>:8791`。同一进程的 `127.0.0.1:8791` 仅供电脑模拟器使用，未设置配对校验，须留在本机。

```powershell
node scripts/prepare-https-preview.cjs <当前 .local/phone-preview-* 工程路径> https://<临时域名>.trycloudflare.com
```

把命令输出的 `.local/phone-internet-*` 导入微信开发者工具，生成普通预览码。手机微信扫码后，从右上角「…」选择「打开调试」，再用移动数据生成草稿。局域网服务和隧道都要保持运行；域名或配对码改变后重新生成预览包。正式云环境继续使用标准 `miniprogram/` 工程。[微信测试号说明](https://developers.weixin.qq.com/miniprogram/dev/devtools/sandbox.html)

## 正式微信云环境

在[小程序启动文件](../miniprogram/app.js)将 `cloudEnvironment` 填为此 AppID 已关联的环境 ID。配置完成后，标准工程的开发者工具和手机都会调用该环境的云函数。环境 ID 可放在前端；供应商密钥只填在云函数环境变量中。

正式体验码应从 `miniprogram/` 下的正式 AppID 工程生成。它通过微信云函数访问后端，手机可以使用移动数据，电脑可以关机。`.local/phone-preview-*` 生成的是局域网联调包，已经分发的这类二维码仍会连接当时的电脑。

正式小程序使用 `wx.cloud.callFunction` 调用名为 `trailAssistant` 的云函数。使用有开发权限的正式小程序 AppID 和已关联的微信云环境，将 `miniprogram/cloudfunctions/trailAssistant/` 作为云函数源码目录。选择 Node.js 20 运行时，入口为 `index.main`，执行超时设为 120 秒。函数使用 Node 自带的 HTTPS 请求能力，运行时无需安装额外依赖。[客户端调用入口](../miniprogram/utils/trailAssistant.js) · [云函数入口](../miniprogram/cloudfunctions/trailAssistant/index.js)

使用已登录的腾讯云开发 CLI 时，在仓库根目录执行 `tcb fn deploy trailAssistant -e <已关联的云环境ID>`。仓库的[部署配置](../cloudbaserc.json)指定函数目录、入口、Node.js 版本和超时时间。部署并配置好服务凭据后，用正式工程生成新码，关闭手机 Wi-Fi，以移动数据完成一次从搜索地点到生成草稿的验证。[腾讯云部署命令](https://docs.cloudbase.net/cli-v1/functions/deploy)

在云函数的环境变量中填写服务凭据。开发机也使用以下变量，但保存于仓库外或被 Git 忽略的本机环境文件中。小程序前端与上传包均不需要这些值。

| 环境变量 | 服务及用途 |
| --- | --- |
| `TENCENT_MAP_KEY` | 腾讯位置服务 WebServiceAPI，查询地点、周边及步行路线 |
| `TENCENT_MAP_SK` | 腾讯位置服务启用签名校验时填写 |
| `QWEATHER_HOST` | 和风天气控制台分配的专属 API Host，可直接填写主机名 |
| `QWEATHER_KEY` | 和风天气 API Key，用于查询对应日期的日预报 |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API 密钥 |

本机启动脚本也支持通过 `DEEPSEEK_API_KEY_FILE` 指向本机已有的密钥文件。云函数直接读取 `DEEPSEEK_API_KEY` 环境变量。

模型调用使用 `deepseek-flash`、启用思考、`reasoning_effort: high` 和 JSON 输出。DeepSeek 已将旧 V4 Flash 的名称映射到 V4.1 Flash。天气服务沿用支持最长 30 天的城市日预报 v7，和风公布的该接口停服日期为 2027 年 6 月 1 日。届时日预报接入需要升级。[DeepSeek 模型更新](https://api-docs.deepseek.com/updates/) · [思考模式](https://api-docs.deepseek.com/guides/thinking_mode/) · [和风城市日预报](https://dev.qweather.com/docs/api/weather/weather-daily-forecast-webapi-v7/) · [和风接口停服时间](https://dev.qweather.com/docs/deprecated/)

## 个人能力画像

「经历」首页显示已完成次数和最近三条记录，记录较多时可展开全部。打开「个人能力画像」可查看自评、历史最高记录和近期负重。从这里进入自评表单，可填写徒步经验、体能、舒适距离、累计爬升、时长和常见负重。所有自评字段可留空，爬升和负重允许填 0。自评资料保存在本机；AI 规划继续使用用户确认用于规划的历史经历字段。

`utils/userProfile.js` 导出 `read()`、`save(changes)` 和 `getPerformanceStats()`。`save` 接收自评字段的完整表单或部分更新，使用独立对象 Key `trailready_user_profile`，包含 `version`、`selfAssessment` 和 `updatedAt`。数值字段为 `comfortableDistanceKm`、`comfortableAscentM`、`comfortableDurationHours`、`typicalLoadKg`。调用返回 `{ ok: true, ... }` 或 `{ ok: false, error }`，读取损坏数据及未来版本时保留原存储。

已完成经历保存时要求路线名称、有效且不晚于今天的日期、正数里程（km）、正数用时（小时）和五级体感。爬升（m）和负重（kg）允许留空或填非负数。备注继续单独保存。五级体感的标准字段为数值 `effortLevel`（1 到 5），新保存记录也保留 `effort` 的中文标签，供当前规划链路读取。

旧版「轻松」「适中」「吃力」分别对应 2、3、4。未知旧体感显示原文并提示补充，用户选择新等级并保存时会保留原文到 `legacyEffort`。读取旧数据时原记录保持原样。缺少必填数据或格式异常的记录在列表标为「信息待完善」，可进入编辑修正。

历史统计读取全部 `trailready_trips.history`。路线名称和完成日期有效的记录计入次数，各指标单独验证。旧记录的 0 km 和 0 小时不再参与极值，0 m 和 0 kg 仍有效。历史最长记录用时表示整次徒步用时，历史最佳表现仅供参考。统计服务继续提供每项有效条数和记录来源。

后续评估可以使用 `utils/hikeHistory.js` 的 `readHistory()` 读取原始记录，用 `inspectRecord(record)` 得到规范化字段、`validRecord`、`eligible`、字段错误和缺失字段，再通过 `utils/userProfile.js` 的 `read()` 获取自评。`eligible` 仅表示通过数据校验。

## 代码与测试

| 工作内容 | 源码位置 |
| --- | --- |
| 地点选择、日期与是否引用手填安排 | [行程总览](../miniprogram/pages/overview/overview.js) |
| 显示 AI 草稿、确认后创建行程 | [方案页](../miniprogram/pages/assistant/assistant.js) · [生成与采用](../miniprogram/utils/aiPlan.js) |
| 腾讯地图、和风、DeepSeek 与按证据组装日程 | [云函数](../miniprogram/cloudfunctions/trailAssistant/index.js) · [外部接口](../miniprogram/cloudfunctions/trailAssistant/providers.js) |
| 手填路线、每日参数、住宿及接驳 | [行程编辑](../miniprogram/pages/index/index.js) |
| 个人装备、本次携带和行前勾选 | [装备页](../miniprogram/pages/gear/gear.js) · [携带页](../miniprogram/pages/carry/carry.js) · [清单页](../miniprogram/pages/checklist/checklist.js) |
| 手填既往经历、恢复上次行程 | [经历页](../miniprogram/pages/history/history.js) · [本地存储](../miniprogram/utils/trips.js) |

在仓库根目录运行以下测试。测试使用模拟服务响应，覆盖同名地点、预报缺失、跨日路线衔接、装备匹配、草稿确认、手工计划、进度恢复和写入失败。

```powershell
node --test tests/*.test.cjs miniprogram/tests/*.test.cjs
```

`trailready_trips` 保存用户的行程与经历，`trail_gear_closet` 保存个人库存。新用户从空库存开始。已安装旧版本且曾在行程中主动选过的样例物品会保留。清除微信小程序数据会清除本地记录。

正式云环境、手机端完整试用及微信公众平台的反馈收件需分别验证。真机可用一趟熟悉的路线试走上述操作，重点观察是否选对地点、合适的个人装备是否选入、关闭后能否继续，以及后台是否收到「反馈行前清单」提交的试用意见。小程序底版和导航图标各自保留了[上游许可](../miniprogram/LICENSE)和[图标许可](../miniprogram/assets/nav/LICENSE)。
