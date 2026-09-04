# WO-CONTINUATION-01 · `promise_followup` 接消费者：PendingContinuation（不造 Task Runtime）

- 状态：**已执行，待 Kevin 合并 + 落地（含迁移 018）**。执行方：主治理 Agent（Kevin 2026-09-04 改令：不再派 GPT）；裁定：Kevin。报告：`report.md`。
- 立单：2026-09-04，主治理 Agent。
- 依据：`governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md` 第 7 条判断（`promise_followup` 最小落点 = 接消费者，在同一把对话锁上串行执行，不触 9.4）与 §六.2；GPT 修订意见（只允许 originTurnId / goal / dueAt / state / createdAt 五个字段；禁止 plan graph、subtasks、dependencies、artifact registry、worker pool、parallel jobs、generic retry policy，这些等 E2）；主治理 Agent 补充：续跑引擎不是 wake 路径，走 Conversation `#runCycle`；到期扫描挂 cheapTick；重启语义入验收；continuation 自己要有终局。Kevin 裁定 R-B（技术失败回执系统口吻）。
- 基线：**WO-OUTCOME-01 合并后的 main**（依赖 `turn/terminal`、`hasFollowupRequest()`、`TelegramSendOptions.recordUndeliveredExperience`）。分支 `wo/continuation-01`。
- 包：lykoi-memory（一张新表 + 读写面 + schema 版本 17→18 + 迁移脚本）；lykoi-converse（登记、续跑、终局、回执）；lykoi-wake（cheapTick 扫描挂钩，一处调用）；lykoi-gate（D-08 词汇登记 `continuation/`）。kernel / profile / 依赖 / 环境变量零改动。

## 0 · 执行方入场须知

- 仓库根在 `packages/*` 工作区，Node ≥ 24。命令：`npm run typecheck`、`npm test`（基线以合并后 main 的读数为准，report 里写出）。
- 不许新增配置键、环境变量或旋钮（GK-6）。所有时长与上限是源码常量。
- 隐私 D-08 / S-21：审计行只带字数、哈希、类别、代号、id，不带正文。**新增审计事件类型必须同时登记进 `packages/lykoi-gate/src/vocabulary.ts` 的 D-08 类**（WO-OUTCOME-01 R-1 教训）。
- 提示词不变：不改 SYSTEM_PROMPT、persona 装配、`contract.ts` 信封契约。现有 prompt/persona sha 测试一字不动地通过。续跑的输入是一条 user 消息，不是新的 system 段。
- 迁移：DDL 进 `packages/lykoi-memory/src/schema.ts`（新库）+ `governance/wo/WO-CONTINUATION-01/migrations/018_pending_continuations.up.sql` / `.down.sql`（存量库），头注沿 017 的写法（施加口令、停机要求）。执行方只在临时库上施加两次实录（up → down → up），不碰任何真实 db。`EXPECTED_MIND_SCHEMA_VERSION` 17→18。
- 命名：新增字段 snake_case。
- 产物：分支提交 + `governance/wo/WO-CONTINUATION-01/report.md`。不合并、不 push main、不碰产线。
- 文档风格：事实，不叙事。

## 1 · 根因（现状事实）

| 现象 | 位置 | 事实 |
|---|---|---|
| 生产无消费者 | `lykoi-converse/src/conversation.ts:1288-1310` `#handleFollowup` | 把 task 存进 `#followupRequest`，回复用户"回复结束后开始后台跟进"。`takeFollowupRequest()`（1379）无生产调用方；WO-OUTCOME-01 后 `handleTurn` 只读 `hasFollowupRequest()` 落 `followup_registered` 字段。ACK 已发，事不做。 |
| 一轮一清 | `conversation.ts:1408-1412` `send()` 开头 | `#followupRequest = null`（S-13）。登记只活到下一轮开始。 |
| 后台模式已有 | `send(message, { background: true })` | `#background` 为真时 `#handleFollowup` 记 `continuation_requested`，文案"等 Kevin 批准再继续"；后台回合是挂起信号，无递归续跑（S-54）。 |
| 进度出站已有 | `lykoi-converse/src/index.ts:496` `postProgress` → `appendOutbox(content, 'followup')` | chat_outbox 'followup' 类，消费者是设备层投递线。 |
| 周期家务已有 | `lykoi-wake/src/index.ts:600-614` CheapTickDriver → `reflow.cheapTick` | 600 s 限频、失败只 log。 |
| 让位语义 | `lykoi-wake/src/index.ts:235-243`（DK-11） | 对话活跃时 wake 让位且丢拍。Conversation `#lock` 串行，`markActive` 回合首尾各一次。 |
| 终局正本 | WO-OUTCOME-01 `turn/terminal` | 回合有终局，跟进没有。 |

## 2 · 决定

### D-1 数据：`pending_continuations` 表（lykoi-memory）

```sql
CREATE TABLE pending_continuations (
  id              TEXT PRIMARY KEY,            -- 'cont-<origin_turn_id>-<created_at 毫秒>'
  origin_turn_id  TEXT NOT NULL,
  origin_run_id   TEXT,
  goal            TEXT NOT NULL,               -- promise_followup 的 task 原文（state 库 = 她的记忆，非审计）
  due_at          TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending','running','completed','failed','expired')),
  terminal_reason TEXT,
  run_id          TEXT,                        -- 续跑那次 run
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_pending_continuations_due ON pending_continuations(state, due_at);
```

五个语义字段（origin_turn_id / goal / due_at / state / created_at）对应 GPT 修订清单；id、terminal_reason、run_id、updated_at 是账簿字段。**不加**：parent、depends_on、attempts、artifacts、priority。

读写面（`rw.ts`）：`registerContinuation(row)`、`dueContinuations(now, limit)`、`claimContinuation(id, runId, now)`（pending→running，CAS，返回是否成功）、`finishContinuation(id, state, reason, now)`、`runningContinuations()`（启动扫描用）。时间格式沿 `mind_schema` 口径。

### D-2 登记：回合终局时一次

`lykoi-converse/src/index.ts` `handleTurn`：终局 status ∈ {replied, intentional_silence, deferred} 且 `conversation.takeFollowupRequest()` 非空 → `registerContinuation({ origin_turn_id: turnId, origin_run_id: runId, goal, due_at: now })`。status = failed / consumed 不登记（失败的回合答应的事不算数；report 说明）。`turn/terminal` 的 `followup_registered` 字段语义不变，另加 `continuation_id`（登记成功时）。登记失败 → `continuation/register_failed` + 不阻塞回合。

`due_at = now`：promise_followup 的用户可见承诺是"回复结束后开始后台跟进"，不是延时。

### D-3 触发：三处，同一个扫描函数

`runDueContinuations(now)` 放在 converse 包（它持有 Conversation 实例）：

1. **回合终局后立即**：`handleTurn` finally 尾部（在 `turn/terminal` 落账之后）`void kick()`。不 await，不阻塞入站。
2. **cheapTick**：`lykoi-wake` 的 CheapTickDriver 回调里，在 `reflow.cheapTick` 之后调 `ctx.get('continuations')?.scan(now)`；converse 用 `ctx.provide('continuations', { scan })` 暴露。600 s 是安全网节律，不是主路径。
3. **启动**：converse `ctx.effect` 里进程起来先 `runningContinuations()` → 全部 `finishContinuation(id, 'failed', 'interrupted')` + 回执（D-6），再 `scan(now)`。

扫描每次最多取 `CONTINUATION_SCAN_LIMIT = 3` 条，串行执行；同一时刻只允许一个扫描在跑（进程内互斥标志，第二个调用直接返回）。

### D-4 执行：走 Conversation，不走 wake

一条 continuation 的执行 =

```ts
claimContinuation(id, runId, now)   // 失败 → 跳过（已被别的扫描拿走）
conversation.send(CONTINUATION_PROMPT(goal), { background: true, runId, turnId: id })
```

- `runId = 'continuation-<id>'`。`CONTINUATION_PROMPT` 是源码常量的一句 user 消息，形如 `【后台跟进】上一轮你答应完成：${goal}。现在继续。`，不改 system 段。
- 走 `send()` 就走同一把 `#lock`：与入站回合串行；`markActive` 首尾打点，wake 照常让位（DK-11 不动）。
- 续跑的答复文本（`send()` 返回值非空）→ `postProgress(content)`（chat_outbox 'followup' 既有通道），不经 `sendReply`。
- 续跑内再登记 `promise_followup`：S-54 不变（后台回合是挂起信号，不递归）。本单**不**为它开新行；记 `continuation/chained_request` 计数，本条照常按 D-5 收尾。链深 = 1。

### D-5 终局：`continuation/terminal`

每条 continuation 恰好一次终局：

| state | reason | 条件 |
|---|---|---|
| completed | — | 续跑周期出口 `lastCycleOutcome()` 为 reply / silence（有意）且无失败 |
| failed | 沿用 `TurnFailReason` 词汇 | 周期失败或 `send()` 抛错 |
| failed | interrupted | 启动扫描发现 running |
| expired | — | 扫描时 `now - due_at > CONTINUATION_TTL_S (= 6 h)` 仍 pending |

审计行字段：`continuation_id, origin_turn_id, origin_run_id, run_id, state, reason, goal_chars, elapsed_ms, reply_chars, chained_request`。零正文。

### D-6 回执：failed / expired 给 owner 系统口吻

R-B 同款：`[系统] 上一轮答应的跟进没有完成（代号 ${reason}）。` 通过 `telegram.send(contextId, text, undefined, { recordUndeliveredExperience: false })`，contextId 取 owner 主上下文（`ownerPrimaryUserId()` 对应的 context；执行方在 report 写出取法）。completed 不发回执（答复本身已通过 outbox 出去；无答复的 completed 是有意沉默）。回执失败 → `continuation/notice_failed`。

### D-7 词汇与常量

- `packages/lykoi-gate/src/vocabulary.ts` `CONVERSATION_FACING_PREFIXES` 加 `continuation/`，文档表同步。
- 常量集中在 `packages/lykoi-converse/src/continuation.ts`：`CONTINUATION_TTL_S = 21600`、`CONTINUATION_SCAN_LIMIT = 3`、`CONTINUATION_PROMPT`、`CONTINUATION_FAILURE_NOTICE`。

## 3 · 边界

- 不造 Task 对象、不建 tasks 表、不加并行、不加重试策略、不改 9.4/37.5 相关任何路径。
- 不改 wake 的推演/回流；wake 只多一处 `scan` 调用。
- 不改 kernel、审批、预算路由（续跑的 LLM 调用沿 converse 现有 route/origin；runId 前缀 `continuation-` 让 budget 账可分辨）。
- 不改 `#handleFollowup` 的用户可见文案。
- 不改任何 system 段与信封契约。

## 4 · 验收

1. typecheck 零错误；全量测试零失败；prompt/persona sha 测试一字不动通过。
2. lykoi-memory：表 DDL 进 schema；迁移 018 up/down 在临时库实录两次（report 贴 `sqlite_master` 与 `mind_schema` 前后）；`EXPECTED_MIND_SCHEMA_VERSION = 18`；旧版本库开门被拒的既有测试照常。
3. converse：（a）replied 回合登记一条 pending；（b）failed 回合不登记；（c）终局后 kick → 续跑 → completed，答复进 outbox 'followup'；（d）续跑周期失败 → failed + 回执一条，回执不进 history / 经验；（e）TTL 超过 → expired + 回执；（f）启动扫描把 running 改 failed/interrupted + 回执；（g）续跑内再 promise_followup → chained_request=1，不新增行；（h）扫描互斥；（i）入站回合与续跑串行（同锁），wake `shouldYieldToChat` 在续跑期间为真。
4. gate：`continuation/` 在 D-08 类；vocabulary 测试过。
5. wake：cheapTick 回调调用 `scan`；`scan` 抛错只 log 不致命；无 `continuations` 服务时（测试装配）不调用。
6. report：D-1～D-7 落点、偏离、测试计数、两次迁移实录、`grep -rn continuation packages/*/src` 清单、遗留问题。

## 5 · 报告要求

`governance/wo/WO-CONTINUATION-01/report.md`：改动文件清单；每条 D 的落点（文件:行）；偏离与理由；测试计数（基线与本分支）；迁移实录；sha 核对；out-of-scope 发现。
