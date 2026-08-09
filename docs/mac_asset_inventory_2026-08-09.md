# Mac 端资产清点（中立事实版）· 2026-08-09

- **用途**: Mac 端整体重新设计的输入。只记事实，不含设计建议。
- **三个来源**: ①仓库逐模块清点（Explore Agent，36 次工具调用逐文件核实）；
  ②运行时资产清点（主治理 Agent）；③全盘散落扫描（sonnet Agent，只读）。
- **既定硬边界**: 音频相关一概不做（Kevin 2026-08-09）。

---

## 一、仓库资产（percept-02-mac-repo/mac/，源码约 10,647 行）

### 1.1 Swift · LykoiCore（15 文件 / 2,231 行，仅依赖 Foundation + SQLite3/Security 各一处）

| 文件 | 行 | 职责 |
|---|---|---|
| AppConfig.swift | 249 | 配置结构 + 路径 + ConfigStore（JSON 0600 / Keychain 双写、token 迁移） |
| LykoiClient.swift | 353 | REST 客户端与全部 wire 模型 |
| SSHTunnel.swift | 189 | ssh -N -L 端口转发监督 + /health 探测 + 复用判定 |
| PerceptionSupervisor.swift | 248 | watcher 子进程拉起/退避重启/回收 |
| WatcherInspector.swift | 314 | 只读观测：SQLite 队列、uplink.log/inspection.log 正则解析 |
| KeychainStore.swift | 90 | TokenVault 协议 + Keychain/内存两实现 |
| ChatStore.swift | 118 | 聊天 JSONL append-only 本地记录 |
| NotificationArchive.swift | 80 | 通知本地归档（merge/已读/2000 上限） |
| NotificationPoller.swift / OutboxPoller.swift | 97/107 | /notifications 与 /chat/outbox 轮询 |
| ConversationTimeline.swift | 96 | 聊天+通知合并时间线（纯函数） |
| MessageMarkup.swift | 215 | 分块/审批 id/DSML 脱敏/人话化（纯函数） |
| PerceptionSignals.swift | 54 | capture.pause / uplink.pause 文件信号 |
| ChildProcessGuard.swift | 61 | 子进程守护参数整形 |
| MemoryFusePolicy.swift | 60 | 内存保险丝纯状态机 |

### 1.2 Swift · LykoiApp（14 文件 / 2,750 行，SwiftUI+AppKit）

AppState(648，见 1.3)、LykoiAppMain(231：@main+菜单栏+主窗控制器)、MainWindowView(111)、
ChatDetailView(263)、ChatComponents(436：8 组件一文件)、NotificationsDetailView(153)、
NotificationComponents(60)、ApprovalsDetailView(208)、WatcherView(403)、SettingsView(213)、
TunnelStatusUI(64)、MemorySafetyMonitor(96：越界 _exit(78))、AssetStore(61)、LykoiTheme(11)。

### 1.3 AppState 结构事实

25 个 @Published（配置 2 / 聊天 6 / 审批续跑 8 / 通知 4 / 感知 6 / 路由 1，按组）；
持有 9 类 Core 组件；7 个视图 @EnvironmentObject 观察（引用密度：ChatDetail 24、
Watcher 22、Approvals 21、Settings 14、Notifications 10、MainWindow 9、ApprovalCard 6）。
`perception` 刻意不做 objectWillChange 转发（2026-07-07 卡顿修复的成果）。
环境开关：LYKOI_DISABLE_SERVER / LYKOI_DISABLE_PERCEPTION / LYKOI_HEADLESS / LYKOI_DIAGNOSTIC_SENDING。

### 1.4 客户端使用的服务器端点全表

统一 `http://127.0.0.1:<localPort>`（默认 18080=SSH 隧道），头 `X-Lykoi-Token`：

GET /health(3s) · POST /chat(180s) · GET /notifications?mark_read(15s) ·
GET /chat/outbox?after&limit(15s) · GET /approvals(15s) ·
POST /approvals/{id}/approve|deny(120s) · GET /continuations(15s) ·
POST /continuations/{id}/approve|deny(30s)。
另：watcher 直接 POST /ingest/environment（Bearer 头，同隧道同 token）。
ApprovalGrant 模型刻意不含 params；错误体支持 FastAPI 两种形态；401/413/502/404/422/409 各有中文文案。

### 1.5 SSH 隧道事实

`/usr/bin/ssh -N -x -o BatchMode=yes -o ExitOnForwardFailure=yes ... -L 127.0.0.1:18080:127.0.0.1:8080 -p 2223 lykoi@lapw1ng.com`；
健康每 20s 探测；不健康 spawn + 10s 建立窗口 + 退避 2s→60s；支持复用外部隧道（owned 标记）。
**当前以 lykoi 本体账户全权限 key 建隧道**（清点事实，处置属设计议题）。

### 1.6 Python watcher（14 文件 / 2,312 行）

constants(66：9 事件类、7 类上行白名单、全部阈值)、paths(40：terminal_id 生成)、
events(74)、privacy(126：13 bundle id + 12 名称子串敏感名单；14+5 噪声 chrome 名单)、
processor(166：防抖/前台时长/60 条每 60s 限速/四类 emit)、queue(93：SQLite events+metrics)、
uplink(130：批 20、仅 accepted/deduped/dropped 删行、网络异常整批保留、pause 零网络)、
macos(393：NSWorkspace/锁屏/Quartz 空闲/pause 轮询/enqueue 分流汇合点)、
screen(410：CGWindowList 全屏抓帧 + 8×8 aHash 变更检测 + Vision OCR，**上行仅摘要与
sha256 摘要指纹，原文不出事件**；采样策略 5/15/120s + 汉明阈值 8)、
audio(557：AVAudioEngine+SCK+SFSpeech 本地转写，默认关)、local_inspection(66)、
diagnostics(22)、cli(195：run/flush/emit-fixture/replay-day)。

数据流：捕获（Workspace/Lock/Idle/Screen/Audio）→ processor（噪声丢弃→隐私滤网→防抖
合并→限速）→ enqueue（capture.pause 全丢；先写本地 inspection 明细；**7 类白名单外只计数
不入队**）→ 后台 flusher（uplink.pause 零网络；批 20 上行；按服务器 disposition 删行）。

### 1.7 devtools / 测试 / 构建

- fake_surface.py(251，纯 stdlib)：契约 9 端点 + 2 测试注入端点 + 故障触发词(make413/make502/slow)。
- Swift 测试 9 文件 1,540 行（含起真 fake_surface 的端到端）；Python 测试 5 文件 701 行。
- make_app.sh(164)：release 构建→bundle 0.4.6→ProcessGuard 编译→内嵌 CPython 3.14→
  签名（"Lykoi Codesign" 身份，无则 ad-hoc 并警告 TCC 重置）→内嵌解释器 smoke→verify。
- embed_python_runtime.sh(174)：裁剪 CPython + 15 PyObjC 模块 + 依赖闭包扫描改 @rpath。
- Helpers/lykoi_process_guard.c(128)：零依赖 C 守护（父进程消失→SIGTERM 进程组）。
- launchd/ 备用独立部署模板（README 注明已被 app 子进程模型取代）。

### 1.8 耦合度事实

- 汇合点：AppState（Swift 全汇合）、macos.py（Python 全汇合）、AppConfig（19 字段被 7 处消费）。
- 隐式契约：WatcherInspector 两条正则 ↔ cli.py 日志行格式（无 schema 硬耦合）。
- **自包含可单独拿走**：Swift 的 MessageMarkup/MemoryFusePolicy/ConversationTimeline/
  ChildProcessGuard/KeychainStore/AssetStore；Python 的 constants/diagnostics/events/
  local_inspection/queue/privacy/paths；工具 fake_surface.py 与 lykoi_process_guard.c。
- **双侧接触点（代码零共享）**：进程管理（spawn+stderr 嗅探）、12 个环境变量（单向）、
  2 个 pause 文件（单向）、events.sqlite3（Py 写 Swift 只读）、2 份日志（Py 写 Swift 正则读）、
  3 个路径约定、同隧道同 token 的网络路径、打包内嵌、2 处测试跨界。

---

## 二、运行时资产（仓库外）

| 资产 | 事实 |
|---|---|
| /Applications/Lykoi.app | 0.4.6，55M，登录项自启，感知+屏幕开/音频配置开但 CLI 默认关 |
| ~/Library/Application Support/LykoiApp/ | chat_history.jsonl 80K(203 行)、notifications_archive 24K、outbox 游标、config.json |
| ~/Library/Application Support/LykoiPerceptionWatcher/ | events.sqlite3 384K（积压 2 条≈正常 flush）、terminal_id 配置 |
| ~/Library/Logs/ | LykoiPerceptionWatcher 三份日志 1M；Lykoi/（memory_fuse）；LykoiPerceptionMock/ |
| Keychain | com.lykoi.mac-app/surface-token；"Lykoi Codesign" 签名身份；account "lykoi" 一条（用途待确认） |
| launchd | com.lykoi.backup-pull 每 6h（活跃）；com.lykoi.maceye.plist.disabled-20260710（已禁用未删） |
| SSH | Host lykoi-gov（治理 key）+ lykoi_percept_02_mac_ed25519（7/5 的 percept 专键，现用情况待核）+ 孤立 User lykoi 行待核 |
| git | 9 分支（3 条 stale Codex 分支内容已由服务器线落地）+ stash@{0}（8/9 D 层聚合器半成品）|

## 三、全盘散落发现（17 项，摘要）

- **额外仓库**: ~/Documents/lykoi/{core-v1-repo, server-integration-repo}（服务器 core 的本地检出与旧副本）
- **身份不明**: `lykoi-contract-check` 进程痕迹（HTTPStorages/Caches/崩溃报告，7/10）；~/Documents/ChatGPT/lykoi/ 空仓库
- **旧原型体量**: Desktop 47M + ~/Library/Application Support/LykoiMacEye/ 42M（含键盘/剪贴板采集数据，隐私敏感）
- **第二备份目录**: ~/lykoi-backups/ 49M；5 份 Lykoi.app 历史快照（0.2.0–0.4.4）
- **散落文档**: Pages 版白皮书 v0.1；~/Downloads/phase5_design_memo_v1.md（7/9，与 maceye 内"Mac感知摄入"工单草稿疑似同源）；~/Documents/lykoi 顶层一批交接文档与 r2c 运维脚本
- **杂物**: leetcode_data + pet-runs 约 17M 混入项目目录；4 个悬空 git worktree 记录；/tmp 一个 known_hosts 片段
- **待 Kevin 确认 6 项**: LykoiMacEye/PerceptionMock 残留清理与否；ChatGPT/lykoi 来源；lykoi-contract-check 身份；ssh config 孤立行；phase5 备忘归档与否；Keychain "lykoi" 条目用途

（全文详表见本次会话三个 Agent 报告，散落扫描硬数字：A 类 13 / B 类 17 / C 类 8 / D 类 6。）

---

## 四、归拢执行记录（2026-08-09 晚，Kevin 授权）

散落资产已全部归拢到 **`~/Documents/lykoi/archive/`**（146M，14 项，逐条 mv 记录在
`archive/MANIFEST.md`，可原路移回）：桌面 lykoi-mac-eye、LykoiMacEye 运行时数据、
PerceptionMock 日志、已禁用 maceye launchd 文件、旧备份位置 lykoi-backups、
server-integration-repo 重复仓库、7 月交接文档与 r2c 脚本、lykoi-contract-check 系统痕迹、
/tmp 片段。两份散落文档（Pages 白皮书 v0.1、phase5_design_memo_v1.md）归入 `docs/`；
非 Lykoi 杂物（leetcode_data、pet-runs）移出项目目录至 ~/Documents/；core-v1-repo 的
4 条悬空 worktree 记录已 prune。

**按指令未动**：`~/Documents/ChatGPT/lykoi/`（ChatGPT 项目对话保存）、
`~/Library/Caches/claude-cli-nodejs/`、`~/.codex/memories/`（Agent 工具缓存）。
**活跃资产未动**：Lykoi.app、两个 App Support 活跃目录、`~/lykoi/`（backup-pull 目的地）、
SSH 密钥、Keychain、登录项与 backup-pull launchd。

清点前散落 17 项 → 现全部 Lykoi 内容集中于 `~/Documents/lykoi/`（含 archive）+ 活跃运行时。
