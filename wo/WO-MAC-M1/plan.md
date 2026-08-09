# Mac 端接下来要做什么（M1 计划）· 2026-08-09

依据：`docs/lykoi_embodiment_redesign_v1_2026-08-09.md`（九条决议已定案，Kevin 批准
Telegram 起步 + 实施顺序）。本文件是 Mac lane 的完整行动计划，可直接转工单派发。

---

## ⚠️ 首要约束：切换顺序不能反（新增发现，写在最前）

**Mac app 是 Kevin 现在与 Lykoi 唯一的会面通道。** 如果先退役 app UI、Telegram 还没通，
Kevin 就与 Lykoi 完全失联（她也失去唯一的对话对象）。因此 M1 必须拆成两段，中间加一道门：

```
M1a（可立刻开工，零风险）            M1b（必须等门）
建独立感知服务 + 并行验证      →   [门：Telegram 通道上线并稳定运行]   →   退役 app UI
app 保持原样继续能用                                                      切纯后台形态
```

**门的判据（建议）**：她经 Telegram 与 Kevin 正常往来 ≥3 天、审批经对话走通 ≥1 次、
掉线可恢复。门未过，app 一律不动。

---

## M1a · 独立感知服务（现在就能做，与服务器 lane 并行）

目标：让 watcher 能脱离 app 独立常驻运行，且与现有 app 内嵌模式**并存不冲突**。

1. **launchd 常驻形态**
   - 复活/重写 `mac/launchd/com.lykoi.perception-watcher.plist`（仓库里有旧模板，
     README 标注"已被 app 子进程模型取代"——现在要取代回来）。
   - 关键：**互斥**。app 内嵌 watcher 与 launchd watcher 不能同时跑（会双写
     events.sqlite3 队列、双份上行）。用 pid 文件或 launchd label 检测；M1a 期间
     默认不启用 launchd 项，只做到"可手动启用验证"。
   - macOS TCC 坑（血泪教训 #15）：launchd 跑 `~/Documents` 下的脚本会被拒
     （`Operation not permitted`, exit 126）——**脚本与工作目录必须放 `~/lykoi/`**。
   - TCC 权限归属会变：现在权限授给 Lykoi.app 本体，脱离 app 后责任进程变成
     python/launchd——**辅助功能、屏幕录制权限需重新授权，且可能要重新签名**。
     这是 M1a 最大的未知风险，要先实测。

2. **配置来源脱离 app**
   - 现在 12 个环境变量由 PerceptionSupervisor 注入。改为：一个独立配置文件
     （`~/lykoi/perception/config.json`，0600）+ Keychain 取 percept token。
   - 保留 `capture.pause`/`uplink.pause` 两个机械闸文件（白皮书 7.4 硬要求，不可省）。

3. **percept 专用 token 与隧道收窄**
   - 现在 Mac 用 surface token 走全部端点。改为独立 percept token
     （Keychain 条目 `com.lykoi.mac-app/percept-token`），服务器侧 `/ingest/environment`
     已有独立 `require_perception_token` 鉴权，天然支持。
   - SSH 隧道用途收到只剩 `/ingest`；**建议同时换受限 key**（仅端口转发、
     ForceCommand），解决"用户端持有 lykoi 全权限钥匙"这个信任边界问题。
   - 这一步服务器侧要配合（发 token、配受限 key），需 Kevin 执行 root 部分。

4. **暂停闸的人肉入口（开放小问题）**
   - 候选：①极小 NSStatusItem（仅状态点+开关+退出，不是 app）；②纯命令行脚本
     `~/lykoi/perception/pause.sh`；③两者都要。
   - 建议 M1a 先做 ②（零 UI 成本、立刻可用），①留到 M1b 决定。

**M1a 验收**：launchd watcher 能独立跑通一次完整上行（事件→队列→/ingest 200）；
TCC 权限实测结论明确；pause 闸生效；与 app 内嵌模式互斥机制有效；app 功能零回归。

---

## M1b · 退役会面 UI（门后执行）

**退役清单**（约 2,700+ 行，全部打归档 tag 保留代码）：
- LykoiApp target 视图层：ChatDetailView(263)、ChatComponents(436)、
  NotificationsDetailView(153)、NotificationComponents(60)、ApprovalsDetailView(208)、
  WatcherView(403)、MainWindowView(111)、SettingsView(213)、TunnelStatusUI(64)、
  LykoiAppMain(231)、AppState(648)
- LykoiCore 会面侧：LykoiClient 的 chat/notifications/outbox/approvals/continuations
  部分、NotificationPoller、OutboxPoller、ChatStore、NotificationArchive、
  ConversationTimeline、MessageMarkup、AssetStore、LykoiTheme

**保留清单**（资产清点已确认自包含，无损迁移）：
- Python watcher 全套（perception_watcher/，2,312 行，一行不动）
- PerceptionSupervisor / ChildProcessGuard / lykoi_process_guard.c（若保留监督模式）
- KeychainStore、PerceptionSignals、WatcherInspector、AppConfig 的感知子集
- 构建脚本 make_app.sh / embed_python_runtime.sh（若仍需打包内嵌运行时）

**数据迁移**：`chat_history.jsonl`(203 条) + `notifications_archive.json` → 归档
（记忆基底在 core，这些是旧会面副本，但**这是 Kevin 与她两个月的对话记录，必须留档
不能删**）；`events.sqlite3`/terminal_id/token 原样保留。

**M1b 验收**：Lykoi.app 卸载或退化为纯后台后，感知链路零中断（队列/上行/pause 全正常）；
对话记录已安全归档；登录项与 launchd 状态正确。

---

## 需要 Kevin 决定或执行的

1. **TCC 重新授权**（M1a 实测后可能需要，只有你能点"允许"）
2. **服务器侧配合**：发 percept 专用 token、配受限 SSH key（root 操作）
3. **暂停闸形态**：命令行脚本先行，是否还要菜单栏项
4. **M1b 的门何时算过**（我建议的判据见文首，可调整）

## 不做的（明确排除）

- 音频相关一切（硬边界）
- D 层屏幕深度采集方案（整体重议中，stash@{0} 里的 OCR 聚合器半成品**不要复活**）
- 任何新增感知深度——M1 是形态迁移，不是能力扩张
