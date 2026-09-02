# WO-M5-ORGAN-BROWSER · 浏览器器官 · 立项书

- 状态：**复核 PASS（经一轮修订，tip 0006e75）→ 待裁合**（Kevin 2026-08-31 批准；2026-09-02 spec 四决断落定，派工单 `order.md`）
- 前置：M4 切换完成（m4_handoff 11 硬前置全绿）；本工单在 M4 收口前不动工
- 队列位置（2026-09-02）：人格分层三单（D-PERS-1/3/2）当日全部并入，**本单为下一单**；前置补一条：`wo/WO-FIX-LOOP-01` 并入（清单只列接得通的动作、`not_wired` gap 发射点、
  explore 候选按接线闸——本单接上 `research_browser.*` 真 handler 后这三处自动跟着变真）
- 包名：`lykoi-organ-browser`

## Kevin 决策记录（2026-08-31）

1. **浏览器器官立项为 M5 第一个器官**。
2. **旧 browser-profile 不迁移**：服务器上活体的 ~4.3GB browser-profile（08-28 清点
   确认的备份盲区）**封存待退役审批，不作为新器官的输入**；新器官以她自己的账号
   **重新登录起步**——干净，且符合「她使用自己的社交身份」的既有定案。
   封存后的删除仍走报告 §3.5 纪律：逐目标清单 + 部署者显式确认，不做模糊匹配清理。

## 边界定案（本立项采用，随 spec 细化）

- **兴趣/主题/偏好归大脑，登录态/cookies/历史归器官**。器官被拆除时她失去的是
  "手"，不是"记得自己喜欢什么"——这是 37.4 无伤拔插里「伤」的定义：**本体无伤**。
- 器官自有持久态（profile 目录）**纳入核心治理的备份面**（BACKUP-04 体系扩一条目），
  但大脑不读其内容——备份是治理义务，不是认知通道。

## 架构定位

37 章器官（第一类插件），非通道适配器。缝已在位，本工单是把替身换真身：

- **动作词汇已在册**：`browser.navigate` 已在 kernel 动作词汇表（dispatch.ts）、
  scope 键已定（`domain:<eTLD+1>`，scope.ts）、审批/静默期规则面已通（approval.ts）。
  词汇扩充（read/click/download 等）随 spec 定，逐条过 GK 词汇门。
- **注册即感知、注销即消失**：经 W4 落地的 `BodySchemaRegistry.register()` 登记
  （actions + sideEffects 显式声明，漏报大声抛），返回注销器；`apply` 注册、
  `dispose` 注销。器官目录切 `registryActionCatalog`（18→5）属 M5 编排总盘，
  与本工单协调、不由本工单顺手做（m4_handoff 告诫在案）。
- **治理接线零新面**：动作走既有 dispatch → 三层门 → 审计链；22.2 硬门
  （金钱/凭据/密钥/隐私）永不因器官化旁路。

## 技术路径（v1）

- 真身：Playwright `launchPersistentContext(userDataDir)`——长驻 Chromium +
  持久 profile，跑在服务器独立 OS 用户/容器（17 章隔离），24 小时慢节奏。
- 观察面：测试期 CDP screencast 出实时画面（愿景访谈要求的试用期可观察性）；
  稳态关画面，留轨迹摘要入审计。

## v1 必备硬化（24 章缺口，不得推 v2）

- SSRF/内网地址与 URL scheme 限制（fail closed）；
- 下载隔离（下载物不落器官宿主外、不自动执行）；
- 不可信内容标记：页面内容进大脑一律带 untrusted 标注，页面中的指令**永远是数据**。

## 验收门槛（spec 时细化为编号断言)

登记/注销的身体图式往返（无幻肢）；domain scope 审批实弹（含静默期）；SSRF 红测；
下载隔离红测；拔插后本体记忆无伤（兴趣仍在、登录态确实消失）；审计链每动作
intent/result 成对。

## spec 决断（Kevin 2026-09-02）

- 域名：空白名单 + 逐域首次审批（走 kernel 既有 domain scope + 对话式审批；器官只管跳转出域中止）。
- 词汇 v1：只读两项 `browser.navigate` + `browser.get_text`，加一次性 `research_browser.read_text`（explore 那只手）；不点不输不下载。
- 宿主：独立 OS 用户 `lykoi-browser` + systemd 单元（CPU 2 核 / 内存 2G），playwright-core 驱动系统 Chrome，本地 socket。
- 观察面：CDP screencast 实时画面（只绑 127.0.0.1）+ 逐步截图留 7 天。
- 报备后果：`research_browser.*` 在 AUTONOMOUS_ALLOWED，她独处上网不逐域问；改它属 policy-core 单独立单。
