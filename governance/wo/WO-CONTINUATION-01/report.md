# WO-CONTINUATION-01 · 执行报告

- 执行方：主治理 Agent。分支 `wo/continuation-01`，基线 `wo/overlay-wake-01@0154bd9`（链：main ← wo/outcome-01 ← wo/overlay-wake-01 ← wo/continuation-01）。日期：2026-09-04。
- 读数：typecheck 零错误；全量测试 1104 / 1093 过 / 0 失败 / 11 跳过（基线 B2 后 1084 / 1073 / 0 / 11，净增 20 例）。prompt / persona sha 测试（`prompts.test.ts` §3.2 A/B 表、`assemble.test.ts` persona 头分层）未动，通过。
- 单包：memory 126/117 过（9 跳过 = devstate 缺席）；converse 166/165 过（1 跳过）；wake 37/37；gate 72/72；decide 102/102。

## 改动文件

| 文件 | 改动 |
|---|---|
| `packages/lykoi-memory/src/schema.ts` | D-1：`pending_continuations` 表 + `idx_pending_continuations_due`（`STATE_SCHEMA_DDL`，生产补齐面标记之前，:326-348） |
| `packages/lykoi-memory/src/index.ts` | `EXPECTED_MIND_SCHEMA_VERSION` 17 → 18（:38）+ 注释 |
| `packages/lykoi-memory/src/testing.ts` | fixture 台账加 `{ version: 18 }`（:82） |
| `packages/lykoi-memory/src/rw.ts` | `PendingContinuationRow` / `ContinuationState` 类型；`registerContinuation`（:2672）、`dueContinuations`（:2698）、`runningContinuations`（:2710）、`claimContinuation`（:2724，rowcount CAS）、`finishContinuation`（:2740，只从 pending/running 出发）、`getContinuation`（:2757，读面） |
| `packages/lykoi-memory/test/memory.test.ts`、`rw-store.test.ts` | 版本门断言 17 → 18；门测试加 17 与 19 两个方向 |
| `packages/lykoi-memory/test/rw-continuations.test.ts`（新） | 登记 / 到期序与 limit / CAS 租约与终局一次性 / CHECK 与索引，4 例 |
| `packages/lykoi-memory/test/migration-018.test.ts`（新） | 临时库 up → 幂等重跑拒绝 → down → down 幂等 → 前滚（只重放版本行），2 例；表 DDL 列体与 schema.ts 逐字比对 |
| `governance/wo/WO-CONTINUATION-01/migrations/018_pending_continuations.up.sql` / `.down.sql`（新） | 存量库迁移，017 体例（BEGIN IMMEDIATE；版本行无 OR IGNORE 作幂等守卫；-bail；down 只撤版本行） |
| `packages/lykoi-converse/src/continuation.ts`（新） | D-3/D-4/D-5/D-6/D-7：常量、`ContinuationRunner`（register / scan / kick / recoverOnStartup）、`ContinuationsService` 结构面 |
| `packages/lykoi-converse/src/failure.ts`（新） | `failureReason` 从 index.ts 抽出（回合与续跑共用同一映射） |
| `packages/lykoi-converse/src/index.ts` | 装配 runner（:604-626）；`ctx.provide('continuations')`；启动效应（recover → scan）；`handleTurn` 加第四参 `continuations?`（:697），finally 里登记（:868-871）、终局带 `continuation_id`（:891）、kick（:893）；Context 增 `continuations` |
| `packages/lykoi-converse/test/outcome.test.ts` | 假 Conversation 加 `takeFollowupRequest` |
| `packages/lykoi-converse/test/continuation.test.ts`（新） | §4.3 (a)–(h) + 登记失败 + 回执出口三态 + handleTurn 登记三例，共 12 例 |
| `packages/lykoi-gate/src/vocabulary.ts` | `CONVERSATION_FACING_PREFIXES` 加 `continuation/`（:98）；文档表同步（:87） |
| `packages/lykoi-wake/src/index.ts` | `ContinuationScanner` 结构面（:239）；`runCheapTick`（:248，从 interval 回调抽出）；回调改调它并递 `ctx.get('continuations')`（:672-675） |
| `packages/lykoi-wake/test/cheap-tick-continuation.test.ts`（新） | scan 被调且 now 透传 / 无扫描面零副作用 / 扫描拒绝与同步抛只落 `continuation/scan_failed`，2 例 |

kernel / profile / package.json 依赖 / 环境变量零改动。wake 不依赖 converse（结构面 + `ctx.get`）。

## D 落点

- D-1：`schema.ts:326-348`；`rw.ts:2672-2765`。时间格式 `formatPyIso`（与 autonomy 表同口径）。id 由 converse 铸：`cont-<origin_turn_id>-<now 毫秒>`。
- D-2：`index.ts:864-871`。条件 = 终局 status ∈ {replied, intentional_silence, deferred} 且 `takeFollowupRequest()` 非空；failed / consumed 不登记（失败回合答应的事不算数；`followup_registered` 仍按 `hasFollowupRequest()` 落账，语义不变）。`due_at = now`。登记失败 → `continuation/register_failed`（runner 内捕获，返回 null，终局照落）。
- D-3：`continuation.ts:147-187` `scan(now)`；三处触发：(1) `index.ts:893` `kick()`（终局落账之后，不 await）；(2) `wake/src/index.ts:672-675` cheap tick 回调；(3) `index.ts:617-626` 启动效应 `recoverOnStartup(now)` → `scan(now)`。上限 `CONTINUATION_SCAN_LIMIT = 3`，串行；进程内互斥见偏离 1。
- D-4：`continuation.ts:200-233` `#run`：`claimContinuation` 失败即跳过；`conversation.send(CONTINUATION_PROMPT(goal), { background: true, runId: 'continuation-<id>', turnId: id })`；非空答复 → `postProgress`（`appendOutbox(content, 'followup')`，与 index.ts:496 同一闭包形态）。续跑内再登记 followup → 取走丢弃，`chained_request = true`，不开新行。
- D-5：`continuation.ts:235-262` `#terminal`，字段与工单表一致。映射：`lastCycleOutcome().kind` reply / silence / followup → completed；envelope_failed / missing_tool / tool_budget → failed（`envelope_failed` / `missing_tool` / `tool_budget_exhausted`）；ask_pending → completed + reason `approval_pending`（审批问句由 Conversation 自己的路径处理，续跑不再问一遍）；`send()` 抛错 → failed + `failureReason(err)`；启动扫描 running → failed `interrupted`；`now - due_at > 6 h` 仍 pending → expired。
- D-6：`continuation.ts:265-291` `#notice`。contextId 取法：`store.ownerChannelKey('telegram')`（与 `OutboundOrgan.ownerChannelKey` 同一读点，P2-01 登记的 owner chat id）。发送走 `telegram.transportSend(chatId, text, null, { recordUndeliveredExperience: false })`，见偏离 2。无传输 / 无绑定 / 发抛 → `continuation/notice_failed{reason, error_name}`。
- D-7：`continuation.ts:26-34` 四个常量；gate `vocabulary.ts:98`。

## 偏离与理由

1. **互斥不是"第二个调用直接返回"而是"返回 skipped 并标记重扫"**（`continuation.ts:148-150, 181`）。纯直接返回时，回合终局后的 `kick()` 撞上正在跑的扫描就丢了，新登记的行要等下一个 cheap tick（≤ 600 s）。补扫让它在当前扫描收尾时被捡起。测试 (h) 覆盖。
2. **回执走 `transportSend` 而非 `send`**。`TelegramAdapterService.send` 的 `replyTo` 是 `string`（reply-only 门面），续跑没有当轮入站可回；`transportSend` 是 messenger transport 真身，`replyTo` 可为 null，接受同一个 `TelegramSendOptions`。
3. **`chained_request` 是终局行上的布尔字段，不是独立事件**。工单写"记 `continuation/chained_request` 计数"；字段形态已足够统计（`SELECT COUNT(*) WHERE chained_request=1`），少一个事件类型。
4. **`ask_pending` 归 completed(approval_pending)**，工单表未列此项。续跑撞审批门时 Conversation 已把待批动作交给设备层；本条的账到此为止，不发失败回执（它不是失败）。
5. **新增两个小事件**：`continuation/runner_failed{where, error_name}`（kick / 启动效应的 promise 拒绝，index.ts:611-613, 621-624）与 `continuation/scan_failed{error_name}`（wake 侧，`runCheapTick`）。都在 `continuation/` 前缀下，已登记。
6. **§4.3 (i)（入站与续跑同锁、wake 让位）未单独写测试**：结构保证 —— 续跑调 `Conversation.send`（`conversation.ts:1450-1451`：`markActive` + `#lock.run`），与入站回合完全同一条路；wake 的 `shouldYieldToChat`（`wake/src/index.ts:612`）读的就是 `markActive` 的窗口。要单独测得起真 Conversation，本单不加。
7. **`getContinuation(id)`** 是工单未列的读面，测试与观测用。
8. lykoi-memory 的 `continuation_registered` 遥测（`rw.ts` `#log`）沿 rw 层既有形态（`#log(...)`），不在 gate 的 `logEvent(` 扫描面内，与同层其他 rw 事件一致。

## 迁移实录（临时库；未碰任何真实 db）

前置库 = `STATE_SCHEMA_DDL` 剔除 018 段 + 台账 16/17（与 `migration-018.test.ts` 同一构造）。`sqlite3 -bail`，查询 = `sqlite_master` 里 `%continuation%` 与 `mind_schema`，以及台账版本串。

```
== before ==
table:mind_schema
ledger:16,17
== up #1 ==
mind_schema|18
pending_continuations_rows|0
index:idx_pending_continuations_due
index:sqlite_autoindex_pending_continuations_1
table:mind_schema
table:pending_continuations
ledger:16,17,18
== up #2 (expect refusal, byte-identical) ==
e4f250c65252994ef6909da3c46febc0
Runtime error near line 30: UNIQUE constraint failed: mind_schema.version (19)
exit=1
e4f250c65252994ef6909da3c46febc0
== down ==
mind_schema|17
pending_continuations_rows|0
index:idx_pending_continuations_due
index:sqlite_autoindex_pending_continuations_1
table:mind_schema
table:pending_continuations
ledger:16,17
== forward (version row only) ==
index:idx_pending_continuations_due
index:sqlite_autoindex_pending_continuations_1
table:mind_schema
table:pending_continuations
ledger:16,17,18
```

`sqlite_autoindex_pending_continuations_1` 是 `TEXT PRIMARY KEY` 的隐式索引。同一序列在 `migration-018.test.ts` 里以 `logicalDigest` 断言（up 重跑前后逐字节不变；down 重跑不变）。

## `grep -rln continuation packages/*/src`

```
packages/lykoi-converse/src/continuation.ts
packages/lykoi-converse/src/index.ts
packages/lykoi-converse/src/failure.ts
packages/lykoi-converse/src/conversation.ts   （既有：#handleFollowup 的 continuation_requested 文案，未改）
packages/lykoi-gate/src/vocabulary.ts
packages/lykoi-memory/src/schema.ts
packages/lykoi-memory/src/index.ts
packages/lykoi-memory/src/rw.ts
packages/lykoi-wake/src/index.ts
```

## 落地（Kevin，root）

1. 合并链：`git merge --no-ff wo/outcome-01` → `wo/overlay-wake-01` → `wo/continuation-01`（各自 fast-forward 关系，dry-run 无冲突）。
2. 停机窗：`systemctl disable --now lykoi-cordis-watchdog.timer` → `systemctl disable --now lykoi-cordis.service` → 备份 `state` → `sqlite3 -bail /home/lykoi/state/memory.db < governance/wo/WO-CONTINUATION-01/migrations/018_pending_continuations.up.sql`（期望输出 `mind_schema|18`）→ 重签 manifest（本链累计：converse、adapter-telegram、kernel、gate、decide、wake、memory）→ `systemctl enable --now lykoi-cordis.service`。GK-6 env 钉面先查（教训）。
3. 落地后读数：首个 `turn/terminal` 带 `continuation_id` 字段（无 followup 时为 null）；她下次说"稍后做"→ 同一分钟内应出现 `continuation/terminal`；`SELECT state, terminal_reason, COUNT(*) FROM pending_continuations GROUP BY 1,2`。
4. 回滚：`018_pending_continuations.down.sql` 只撤版本行；再前滚只重放版本行那一句（down 文件头注）。

## 遗留 / out-of-scope 发现

- 过期回执的代号是 `expired`，不在 `TurnFailReason` 词汇内；`CONTINUATION_FAILURE_NOTICE` 接 string。owner 看到"代号 expired / interrupted"两种非回合词汇，属本单新增语义，未扩 `TurnFailReason`。
- 续跑答复走 chat_outbox 'followup'，投递由设备层长轮询间隙消费；`continuation/terminal.reply_chars` 记的是产出字数，不是送达。送达账在 outbox 自己的行上（WO-OUTCOME-01 候选小单 WO-FIX-UNDELIVERED-BRIDGE-01 的范围）。
- `runCheapTick` 抽出后 interval 回调只剩取时与限频；`CheapTickDriver` 未动。
