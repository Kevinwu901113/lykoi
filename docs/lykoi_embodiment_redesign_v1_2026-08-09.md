# Lykoi 具身重设计 v1 · 社交器官 + 极简感知端 · 2026-08-09

- **地位**: Mac 端重新设计的落点文档。Kevin 与主治理 Agent 讨论定案（决议见 §0）。
- **一句话**: Lykoi 通过**她自己使用的社交软件**与 Kevin 相处；Mac 退化为纯感知器官
  （无 app UI）；审批从按钮变成对话，明确度随风险升门，极简安全操作免询。
- **前置**: 建立在阶段 2 设计 v1（数据模型/Gateway/broker）与感知需求分析之上。
- **关系**: 取代"住在 Mac app 里会面"的旧形态；感知设计 v0.3 的屏幕/音频结论保持
  （音频一概不做仍是硬边界）。

---

## 0. 定案决议（Kevin 2026-08-09）

1. **哲学定调**: Lykoi **使用**社交工具，不是"平台给她开消息通道"。社交软件是她身体的
   器官，她经自己的意志操作它——架构对应物 = 浏览器（她有常驻 Chrome，经 dispatch 操作）。
2. **审批 = 对话**: 不依赖按钮。她用语言问，Kevin 用语言答，她据回答判断；高危/重要动作
   若回答模棱两可，她复述具体动作并请求明确表态，追问到无歧义为止。
3. **归属靠多信号**: 回答归属到哪个待批动作，不单纯依赖 reply——用引用+时间邻近+悬置
   动作数+语义匹配综合判断，有歧义即追问（复用"当前 Claude 确认动作"的判断方式）。
4. **免询层（auto）**: 极简安全操作（只读、无副作用、无外发：browser.read、curl GET、
   状态查询）不询问，直接执行只记审计。
5. **隐私与通道失陷风险**: Kevin 承担，不做特殊处理（不设"所有者覆盖类不走 IM"的例外）。
6. **多平台是常态**: 社交软件会越来越多，这是她的社交生活；不担心单平台身份风险。
   Telegram 起步，其它平台后续增设。
7. **记忆基底全在 core**: IM 只是传输，聊天记录是副本；Mac chat_history 转归档。
8. **Mac 极端瘦身**: 连 app UI 都不要，退化为后台感知服务 + 暂停闸 + 最小配置。
9. 打扰纪律原样平移；messenger 预留群聊 context 钩子。

---

## 1. 核心架构转换

### 1.1 IM 作为器官（与浏览器同构）

```
她的既有器官：Xvfb+Chrome（设备/systemd） ← dispatch ← browser.* 动作
她的新器官：  IM 会话进程（设备/systemd）  ← dispatch ← messenger.* 动作
```

- **新资源 `messenger.*`**：`messenger.send` / `messenger.read` /（后续 `messenger.react`
  等）。经 kernel dispatch → 自动继承审批门、immutable audit、shadow 侧写、预算。
  **发消息是她的一次"做"**，与 terminal.exec 同等地位，不是 surface 自动投递。
- **收消息是她的感知**：入站消息 = 事件进注意力管线（"手机震了"），**她决定**读与回。
  这替代旧的 `/chat` RPC 形态——对话从端点请求-响应变成她的行动（通常瞬时，主体在她）。
- **IM 会话进程 = 设备**：常驻 daemon 维持长连接（对应 lykoi-chrome），产入站事件、
  执发送动作，systemd 管理，本身不做判断——判断全在 core。
- **账号 = 她的身份资产**：所有权/找回归 Kevin（所有者），使用权归她；凭证进 broker
  （句柄第二号）；账号写入她的 persona 身份事实。
- **纯度光谱（记录在案）**：最纯 = 她在自己浏览器里用 Telegram Web（真·像人用软件，
  工程重且脆）；**务实中间态 = bot API 作为她的"设备"**（设备属于她、操作经她意志，
  哲学成立）。v1 从中间态起步。

### 1.2 三层审批模型（白皮书 22 双层策略的具体化）

| 层 | 动作类 | 交互 | 依据 |
|---|---|---|---|
| **免询（auto）** | 只读/无副作用/无外发：browser.read、research 取回、curl GET、状态查询 | 直接执行，只记审计，不打扰 | policy_core 判定为无副作用类 |
| **对话审批** | 有副作用但常规：messenger.send、写工作区文件 | 她问 → Kevin 自然语言答 → 解释器判定（批准/拒绝/有条件/不明确） | policy_core 常规副作用类 |
| **硬门** | 高危/所有者管理（白皮书 22.2 硬性策略） | 模棱两可**必追问**，复述具体动作请求明确，无歧义肯定才放行；追问无上限，超时进积压提醒 | policy_core 硬性策略分级 |

**回答解释器纪律**：
- 输入四元组 `{问题原文, 回答原文, 解释结果, 风险级}` **全进 immutable audit**——事后可
  复盘"她是否理解错 Kevin"。
- **归属护栏（针对多消息/闲聊混流）**：她的审批提问是可引用消息；回答归属用
  引用+时间邻近+悬置动作数+语义匹配综合判断；**存在多条悬置或回答可对应多个动作时，
  不猜——追问**。一句闲聊的"好啊"永不被解释为对悬置动作的批准，除非唯一悬置且语境无歧义。

---

## 2. Mac 端：极端瘦身为感知器官

### 2.1 退役（会面全走 IM 后）

- **整个 Swift app UI**：ChatDetailView/ChatComponents/NotificationsDetailView/
  ApprovalsDetailView/WatcherView/MainWindow/Settings 等约 2,700+ 行 LykoiApp target 退役。
- LykoiClient 的会面端点（chat/notifications/outbox/approvals/continuations）退役；
  只保留感知上行所需。
- NotificationPoller/OutboxPoller/ChatStore/NotificationArchive/ConversationTimeline/
  MessageMarkup 等会面侧 Core 模块退役（打归档 tag，代码留档）。

### 2.2 保留（感知器官本体，资产清点已确认自包含）

- **Python watcher 全套**（perception_watcher/，2,312 行）——采集/滤网/队列/上行/CLI。
- **PerceptionSupervisor + ChildProcessGuard + lykoi_process_guard.c**——子进程监督。
- **KeychainStore**——token 保管（percept 专用 token，作用域收窄）。
- **PerceptionSignals**——capture.pause/uplink.pause 机械闸（白皮书 7.4，必须保留）。
- **AppConfig 的感知相关子集** + **WatcherInspector**（自监控用）。
- **SSHTunnel**——但用途只剩 `/ingest`（见 2.3）。

### 2.3 形态：后台服务，配置最小化

- 目标形态回归 **launchd 常驻 watcher**（绕回 2026-07-05 前的本来形态，但带上这一年
  积累的滤网/队列/监督成熟度）。是否保留一个**极小菜单栏项**（仅：感知开/关、状态点、
  退出）作为暂停闸的人肉入口，是本文档唯一留给实现期定的小问题——不是 app，是一个
  NSStatusItem。
- **SSH 隧道收窄**：只转发 `/ingest/environment` 一个用途；surface 侧对 Mac 关闭
  chat/approvals 等端点；percept token 作用域收到只能 ingest。**信任边界顺带修好**
  （旧的 lykoi 全权限 key 问题因用途单一而自然收敛；仍建议换受限 key）。

### 2.4 数据迁移

- Mac chat_history.jsonl / notifications_archive.json → 归档（她的记忆基底在 core，
  这些是旧会面副本）。
- events.sqlite3 队列、terminal_id、percept token → 原样保留。

---

## 3. 服务器端：新组件与接线

### 3.1 messenger 资源与 IM 设备

- **新资源** `src/lykoi/resources/messenger.py`（进 manifest 六目录纪律）：
  send/read 动作，经 dispatch。
- **IM 设备** = 新 systemd 服务 `lykoi-telegram`（维持长连接，入站转事件、出站执动作）；
  绑代理（家内网 192.168.0.202:7890，Telegram 需翻墙）。
- **入站事件**：进 core 注意力管线（与感知事件同管线不同类），触发她的读/回决策。
- **出站**：messenger.send 经 dispatch，打扰纪律（日上限/冷却/白名单触发）在此层强制。

### 3.2 与阶段 2 组件的接线

- **broker（P2-03A 已建）**：Telegram bot token 成为**第二个凭证句柄**
  `im.telegram.bot`（scoped_token 或 http_proxy 型）——她的 IM 设备经 broker 用 token，
  不直接持明文。**S4a 在此再获一次验证**。
- **identity_bindings（P2-01）**：`channel='telegram', channel_key=<Kevin 的 tg id>`
  → 绑定到 user_001。**第一个真实的非 owner-token 身份绑定**。
- **contexts（P2-01）**：Kevin 的 1-1 IM 会话 = `ctx_direct_user_001`；预留群聊
  `kind='group'` 钩子（§0.9）。
- **Delegation Gateway（P2-03B）**：messenger 是她的直接能力（白皮书 15.2 她自己保留
  的能力，不委托），不走 Gateway；但审批解释器与 Gateway 的合同解释共享设计。

### 3.3 审批解释器落点

- 挂在 messenger 入站处理 + policy_core 之间：待批动作 → 生成自然语言问句（messenger.send
  出站，带引用）→ 等 Kevin 回复 → 解释器判定 → 回填 dispatch 审批结果。
- 四元组审计经 guardian audit sink（immutable）。
- 免询层：在 dispatch 审批门前置一个"无副作用直放"判定（policy_core 已有副作用分类，
  复用不新发明）。

---

## 4. 实施切分（草案，待 Kevin 确认顺序后开工单）

| # | 工单 | 面 | 依赖 | 并行性 |
|---|---|---|---|---|
| M1 | Mac 瘦身：退役会面 UI，watcher 转 launchd 后台服务 + 最小菜单栏闸 | Mac | — | 独立 lane |
| S1 | messenger 资源 + lykoi-telegram 设备 + 入站事件接管线 | 服务器六目录 | P2-01 合并后 | 排六目录锁 |
| S2 | 审批解释器（三层 + 归属护栏 + 四元组审计） | 服务器六目录 | S1 | 序于 S1 |
| S3 | broker 加 im.telegram.bot 句柄；identity_bindings 接 tg id | 服务器 | P2-03A/01 | 可与 S1 并 |
| S4 | 打扰纪律平移 + presence 联动 messenger 静默判断 | 服务器 | S1 | 序于 S1 |

M1（Mac）与服务器 lane 天然并行。IM 设备与解释器是本轮真正的新建主体。

---

## 5. 开放小问题（实现期定，非阻塞）

1. Mac 是否保留极小菜单栏闸（vs 纯文件/命令行暂停）。
2. Telegram 入站的 presence 感知：她该"已读不回等合适时机"还是"即时回"——presence 模型
  接入 messenger 的静默策略细节。
3. bot token 句柄类型（scoped_token vs http_proxy 反代 Telegram API）。
4. 群聊 context 钩子的最小预留字段（不实现，只留位）。
