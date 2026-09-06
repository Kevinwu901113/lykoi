# WO-TURN-01 · Durable Ingress + Turn Assembler

## 2026-09-06 接续裁定（优先于下方原始施工建议）

Kevin 在整批接续中明确：spool 属于基础设施，不能写认知状态库；入站落盘时立即 markActive；停机积压按原文与来源时间顺序合为一个 turn。落实如下：

- 基线更新为 `origin/main@c17e148`；先保存遗留实现，再整合已合入的传输拆分、PULSE、实例包与 subtraction。
- SQLite spool 独立路径 `inbound-spool.db`，`user_version=1`；新库确定性建表，误配到认知库拒开。`mind_schema` 保持 18，撤去本单未部署的 019 候选迁移。原文 §4.1 的认知迁移仅为可选建议，本次不采用。
- 适配器开机零等待补收，来源时间早于启动的消息标为 replay；跨 poll 保留为 collecting，直到空批收齐才提交 `restart_replay`。replay collecting 的持久标记可跨崩溃恢复；普通实时输入仍用 idle 1500 / hard 4000 ms。
- 多 part 与 replay 的认知投影使用 `[sourceTimestamp 或 receivedAt]\n原文` 按序拼接；单条实时消息原样。正本 parts 不改字，不写进审计。
- durable accept 的同步完成通知调用 interactive-lock.markActive，发生在后续审计 I/O 之前；cursor 仍只在 accept 返回后推进。
- `turn/terminal` 沿用已落地正本名称和状态；A3 只改 run/revision，不用第六种 turn 状态替代 run 终局。
- 本次施工不等于合并或部署。manifest 本地验证与生产签名分开；生产仍由 Kevin 执行。

## 0. 基线与目标

仓库：

`Kevinwu901113/lykoi`

当前已知基线为：

`main@c557af20ed90f9e7fa0b37c0d035e8d1b15c6fc2`

开工前先拉取并核当前 `main`。若已有更新，以最新 `main` 为准，先确认本单假设是否仍成立；不要回退或覆盖已经落地的：

- WO-OUTCOME-01：`turn/*` 终局正本与 ID linkage
- WO-OVERLAY-WAKE-01
- WO-CONTINUATION-01
- schema 18 / migration 018
- PROBE-CAP-01 治理材料

本单对应下一阶段 **A2**。

目标不是“加一个聊天 debounce”。

目标是第一次把：

**接收外界输入**

和

**处理当前 cognition**

结构性解耦，使 Lykoi 在一个长 cognition 正在运行时，仍然可以持续接收、可靠保存后续消息，并把短时间连续消息组成一个 `UserTurn`。

本单完成后的目标行为：

```text
Telegram message A1 ─┐
Telegram message A2 ─┼→ UserTurn A → cognition
Telegram message A3 ─┘

A cognition 正在运行……

Telegram message B1 ─┐
Telegram message B2 ─┘→ UserTurn B → FIFO waiting

Telegram 仍继续 poll，不因 A cognition 卡住。
```

注意：

**本单不实现打断。**

因此完成 A2 后：

```text
A 正在搜索
用户发“算了”
```

“算了”必须能立即被接收、持久化并形成后续 turn，但仍在 FIFO 中等待 A 完成。

真正：

```text
“算了” → Abort A → revise
```

属于后续 **A3 / WO-SCHED-01**，本单禁止提前实现。

---

# 1. 当前根因

当前 Telegram adapter 的语义仍是：

```text
poll update
↓
handle inbound
↓
await cognition consumer
↓
consumer 完成
↓
推进 cursor
↓
处理下一条
```

`lykoi-converse` 也仍直接依赖：

```ts
InboundMessage from 'lykoi-adapter-telegram'
```

即认知层仍知道 Telegram-specific inbound type。

这导致两个问题：

1. cognition 慢时，新的 Telegram update 无法及时进入 Lykoi；
2. 即使直接在 Converse 前加 1.5 秒 settle timer，后续消息也可能根本还没有被 poll 进来，所以无法真正完成多消息合并。

因此本单必须先建立：

```text
Transport
   ↓
Normalize
   ↓
Durable Accept
   ↓
cursor may advance
   ↓
Turn Assembler
   ↓
FIFO Turn Executor
   ↓
Converse
```

---

# 2. 核心裁定

## D-1 · Message ≠ Turn ≠ Run

禁止继续让一个 ID 同时承担多个概念。

至少明确：

```text
platformMessageId
    平台原始消息 ID

inboundId
    Lykoi 接收到的一条 normalized inbound part

turnId
    一个 UserTurn；可包含多个 inboundId

runId
    一次 cognition attempt

correlationId
    Kernel dispatch/action trace
```

本单暂时一个 committed turn 只有一次 cognition attempt。

后续 A3 出现 revision 后允许：

```text
turn-42
 ├─ run-42-r0 aborted
 └─ run-42-r1 completed
```

因此现在的数据结构和 audit 不得假设：

```text
turnId === runId
```

也不得假设：

```text
一条 platform message === 一个 turn
```

---

# 3. Neutral Inbound Model

认知层不应继续从 Telegram adapter 导入平台专属 `InboundMessage`。

建立最小、中性的 inbound part 结构。

具体文件位置由你侦查后选最小合理落点；不要为了这一单创建庞大 Messaging Hub。

语义至少包含：

```ts
InboundPart {
  inboundId
  channel
  platformMessageId
  platformUpdateId?       // 平台存在则保留
  userId
  contextId
  isOwner
  text
  receivedAt
  sourceTimestamp?
}
```

要求：

- 原文逐字保存；
- 原始 message boundary 不丢；
- 原始时序不丢；
- 不摘要；
- 不改写；
- 不提前拼成一个字符串；
- Telegram adapter 只负责 Telegram → neutral inbound；
- Converse 不应再需要理解 Telegram update 结构。

不要在本单实现 QQ / WeChat。

只要中间契约不再绑 Telegram 即可。

---

# 4. Durable Ingress

这是本单最重要的结构要求。

必须满足：

```text
平台 update 到达
↓
normalized inbound durable commit 成功
↓
才允许推进 Telegram cursor
```

禁止：

```text
放进 JS memory queue
↓
推进 cursor
```

因为：

```text
cursor 已推进
+
进程 crash
=
消息永久丢失
```

## 4.1 持久化要求

可以：

- 复用现有 SQLite/state 基础；
- 或增加最小 persistent ingress state。

不要引入：

- Kafka
- Redis
- 外部 MQ
- 新网络服务

当前 Telegram inbound archive 是 bounded ring/history 语义。如果其最多保留固定数量且不能表达 processing/turn state，则**不得把它直接当作唯一 authoritative queue**。

如果需要 schema migration，按现有 `lykoi-memory` 迁移纪律完成：

- schema version 正确推进；
- up/down migration；
- temp DB tests；
- index；
- 重启恢复测试；
- gate/manifest 对应更新。

## 4.2 幂等

Telegram crash/retry 时同一 update/message 可能再次出现。

必须保证：

```text
same channel + platform identity
↓
same logical inbound
↓
不会重复进入 UserTurn
```

重复 accept 可以返回已有 `inboundId`，但不能再新增一份 part。

---

# 5. Turn Assembler

实现确定性的：

```text
InboundPart[]
→ UserTurn
```

第一版默认参数：

```text
idle settle ≈ 1500 ms
hard maximum ≈ 4000 ms
```

这两个数字必须是配置项/单一出处，便于之后影子实测校准。

它们当前只是初始实验值，不是长期人格参数。

## 5.1 合并规则

只合并同一个 conversation/peer scope 的消息。

绝不能跨：

- context
- user
- channel conversation
- sender

错误合并。

时间规则：

```text
part 1 到达 t0

idle_deadline = last_part + idleWindow
hard_deadline = first_part + hardWindow

每来一个新 part：
    更新 last_part
    idle_deadline 后移
    但永远不得超过 hard_deadline
```

触发任一：

```text
idle timeout
hard timeout
```

就 commit 当前 UserTurn。

持续疯狂连发也必须被 hard max 强制切 turn，不能永远不提交。

---

# 6. UserTurn 形状

不要直接：

```ts
text: parts.map(...).join('\n')
```

作为唯一正本。

正本必须保留：

```ts
UserTurn {
  turnId
  userId
  contextId
  isOwner
  parts: InboundPart[]

  firstReceivedAt
  lastReceivedAt
  committedAt

  commitReason:
    'idle_timeout'
    | 'hard_timeout'
}
```

如果现有 Converse 最终仍只吃一个文本 user message，可在**最后装配边界**生成 deterministic render：

```text
part1
part2
part3
```

但：

> rendered text 是 projection，不是存储正本。

原始 `parts[]` 必须仍可审计和恢复。

---

# 7. reply_to 策略

一个 UserTurn 可能有多个 Telegram message ID。

第一版使用确定性规则：

> **普通 turn 的 reply anchor = 最后一个 part 的 platformMessageId。**

即：

```text
msg 101
msg 102
msg 103
↓
reply_to = 103
```

不要随机，也不要由 LLM 决定。

若现有 approval/suggestion/reply-to routing 存在特殊语义，不得破坏。

开工时先核：

- approval owner answer
- suggestion owner answer
- explicit reply_to attribution

这些当前如何进入 Converse。

如果它们必须保持即时/特殊路由，可以作为 assembler 的明确 bypass/special case，但必须：

1. 保持现有 S-08 语义；
2. 配回归测试；
3. 在 report 写明为什么 bypass；
4. 不顺手重构 approval/suggestion。

---

# 8. cognition 与 ingress 解耦

本单结束后，Telegram poll 不得再等待完整 `Conversation.send()` 才继续收世界。

但是：

**本单禁止真正多 Turn 并发 cognition。**

使用一个简单 FIFO committed-turn executor：

```text
Ingress                 Cognition worker

A1 ─┐
A2 ─┼→ Turn A ─────────→ running
A3 ─┘

B1 ─┐
B2 ─┘→ Turn B ─────────→ queued

C1 ───→ Turn C ────────→ queued
```

认知执行仍然：

```text
A → B → C
```

串行。

必须做到：

```text
A cognition 很慢
≠
Telegram 停止 poll
≠
B/C 无法 durable accept
```

这就是本单验收的核心。

不要在这里：

- Abort A；
- revise A；
- B 抢占 A；
- A/B cognition 并行；
- 判断 read-only/side-effect；
- 建 scheduler policy。

全部留给 A3。

---

# 9. Crash / Restart 语义

本单必须是 crash-safe，不接受“timer 在内存里，重启就算了”。

重启后：

```text
已 durable accept
但尚未 commit 的 parts
```

必须能恢复。

建议语义：

- 若 idle/hard deadline 已经过期 → 启动后立即 commit；
- 若还没过期 → 按持久化 timestamp 重新 arm 剩余时间；
- 不得把同一 part 再加入第二个 turn；
- 已 committed 但未 cognition 的 turn 必须继续保留为待执行状态；
- 已 terminal 的 turn 不重复执行。

如果具体实现因当前架构需要略有不同，可以调整数据形状，但必须保持以上不丢、不重、可恢复语义。

---

# 10. A1 Terminal Outcome 兼容

WO-OUTCOME-01 已经成为当前正本，本单不得破坏。

从本单开始：

```text
多个 inbound part
→ 一个 UserTurn
→ 一个 turn/terminal
```

因此 terminal observability 必须能反查：

```text
turnId
→ constituent inboundIds / platformMessageIds
```

要求：

```text
每个 committed UserTurn
最终 exactly one canonical terminal outcome
```

而每个 raw inbound part 至少拥有：

```text
durable accepted
→ attached to turnId
```

的可追踪关系。

不要为了兼容旧假设，给同一个 merged UserTurn 人工制造三份 terminal。

---

# 11. Continuation 不得被误改造成普通 inbound

WO-CONTINUATION-01 已经落地。

它属于 internal continuation runtime。

本单默认只处理：

> 外部 channel inbound → UserTurn

不要把：

```text
ContinuationRunner → Conversation.send()
```

强行塞进 1.5 秒 settle pipeline。

必须跑现有 continuation tests，保证：

```text
pending_continuations
continuation/terminal
owner notice
wake cheap-tick scan
```

语义不变。

---

# 12. Audit / Observability

新增的正本事件命名遵守现有 gate vocabulary。

建议至少能看到：

```text
inbound/accepted
turn/collecting
turn/committed
turn/queued
```

具体名称如现有事件规范已有更合适词汇，可沿用，不必机械照抄。

但必须能回答：

```text
这条 Telegram message 有没有被可靠收到？
属于哪个 turn？
这个 turn 有几个 part？
为什么在这个时间 commit？
现在是在 queue 还是已经 cognition？
最后 terminal 是什么？
```

正文继续遵守现有 audit 纪律：

- 不把消息正文写进 audit；
- 可记长度/hash/id/timing/count；
- secrets 不进日志。

---

# 13. 必测用例

至少覆盖以下测试。

## T1 · 单消息

```text
A
```

idle window 后：

```text
UserTurn.parts = [A]
```

只调用一次 cognition。

---

## T2 · 连续三条

```text
t0      A
t0+0.5  B
t0+1.0  C
```

结果：

```text
一个 UserTurn
parts = [A,B,C]
顺序完全一致
边界完全保留
```

---

## T3 · hard max

持续每 1 秒来一条，idle deadline 一直被刷新。

达到 hard max 后仍必须 commit 第一批 turn。

---

## T4 · 不同 peer/context 不合并

交错：

```text
user/context A
user/context B
```

绝不能进入同一个 turn。

---

## T5 · duplicate redelivery

同一 Telegram update/message 重放两次：

```text
只产生一个 inbound part
```

---

## T6 · crash point：durable 后 cursor 前

模拟：

```text
durable accepted
↓
process crash
↓
Telegram redeliver
```

重启后不得：

- 丢消息；
- 重复 part；
- 重复 turn。

---

## T7 · collecting 中重启

A 已进入 collecting，进程重启。

恢复后：

- deadline 已到则立即 commit；
- 未到则继续剩余 settle；
- A 不丢。

---

## T8 · cognition 不堵 ingress

使用 fake cognition：

```text
Turn A handler sleep/block
```

期间注入 B/C。

必须证明：

```text
B/C 已 durable accepted
Telegram poll/cursor 可继续
```

而 cognition executor 仍：

```text
A → B/C turn
```

FIFO 串行。

这是本单最关键测试。

---

## T9 · terminal linkage

三个 part → 一个 turn。

最终：

```text
turn/terminal = exactly one
```

并能从 terminal/turn trace 找回三条 constituent inbound。

---

## T10 · reply anchor

多 part turn 回复时：

```text
reply_to = last part platformMessageId
```

---

## T11 · approval/suggestion regression

现有：

- approval answer
- suggestion answer
- explicit reply attribution

全部保持原有语义。

---

## T12 · continuation regression

WO-CONTINUATION-01 全部邻接测试保持绿。

---

# 14. Forbidden

本工单严格禁止顺手做：

### A3

```text
AbortController arbitration
interrupt
revision
cancel
side-effect classification
foreground/background policy
```

### A4

```text
utterances[]
多 bubble
发送间隔
4096 transport fragmentation
sticker
```

### E2

```text
Task
subtask
dependency graph
background task runtime
worker pool
```

### E3

```text
Capability Resolver
Forge
Registry redesign
```

### 人格新层

```text
Behavioral Seed
Expression State
Relationship Moment
```

### 其它

- 不重构 Wake；
- 不改变 KINDS；
- 不改 LLM prompt 内容；
- 不顺手解决 PROBE-CAP 的 tail-brace；
- 不改 outbound policy；
- 不让 Telegram adapter 获得 cognition；
- 不引入通用 Message Hub 产品化；
- 不引入第二 IM。

---

# 15. 工程原则

优先复用现有：

- Cordis service/event pattern
- `lykoi-memory`
- audit
- migration discipline
- gate manifest
- existing Telegram identity binding
- existing A1 turn outcome

不要为了“未来可能有 QQ”现在造一个大型 abstraction framework。

目标只是建立最小正确 seam：

```text
Telegram Adapter
      ↓
Neutral Durable Ingress
      ↓
Turn Assembler
      ↓
Serial Turn Executor
      ↓
Converse
```

未来 QQ/WeChat 只需要接入：

```text
Neutral Durable Ingress
```

以上部分即可复用。

---

# 16. 提交建议

建议按可独立审查的里程碑拆 commit，不要求机械遵循，如发现当前代码结构更适合别的切法可以调整，但禁止一个巨大 commit。

推荐：

### Commit 1

Neutral inbound types + persistent schema + migration + idempotent accept。

### Commit 2

TurnAssembler + settle/hard-window + crash recovery。

### Commit 3

Telegram poll → durable ingress 解耦 + serial executor。

### Commit 4

A1 trace linkage + regression tests + gate/manifest/docs。

每一步保持测试可跑。

---

# 17. 完成标准

只有同时满足以下条件才能报完成：

```text
[ ] cognition 慢时 Telegram 仍继续可靠接收消息
[ ] cursor 只在 durable accept 后推进
[ ] duplicate redelivery 不产生重复 part
[ ] 多条短消息形成一个 UserTurn
[ ] UserTurn 正本保留 parts[]，不是只有 join 后字符串
[ ] idle + hard settle 两个边界都有测试
[ ] restart 后 collecting / queued state 可恢复
[ ] cognition 仍 FIFO 串行，没有偷偷实现 A3
[ ] Converse 不再依赖 Telegram-specific inbound type
[ ] merged turn 只有一个 turn/terminal
[ ] A1 / B2 / B3 现有语义不退化
[ ] approval/suggestion routing 不退化
[ ] 全量邻接测试通过
[ ] TypeScript compile / lint / gate 按仓库现行规则通过
[ ] 如 protected surface 改动，manifest 正确重签
```

---

# 18. 交付报告必须回答

实现完不要只说“done”。

报告至少给：

1. 开工与完工 commit SHA；
2. 修改文件列表；
3. 实际数据模型；
4. ID 生命周期图；
5. Telegram cursor 新时序；
6. crash/restart recovery 时序；
7. 三条连续消息的真实测试 trace；
8. cognition 被 fake 阻塞时，B/C 仍被接收的测试证据；
9. duplicate redelivery 测试证据；
10. terminal ↔ constituent inbound linkage 示例；
11. approval/suggestion/continuation 回归结果；
12. 全量测试数字；
13. 新 schema / migration / env / config / audit event 全清单；
14. 是否发现任何会影响 A3 的结构事实。

如果侦查发现当前 `main` 已经改变到本工单关键前提不成立，不要硬套设计。

先停在“侦查报告 + 建议修订”，明确说明冲突点，不得自行扩大范围。

## 最终架构边界

本单只完成这一跳：

```text
过去：

收到 A
→ 完整处理 A
→ 才能继续听

本单之后：

一直听
→ durable 收下所有消息
→ 短消息组成 Turn
→ Turn 仍串行处理
```

下一单 A3 才负责：

```text
一直听
+
理解新输入与当前 cognition 的关系
+
必要时打断 / 修正 / 排队
```