# WO-INGRESS-01 · 入站持久 spool 与 Turn Assembler（A2）

- 状态：**待派**。执行方：执行子 Agent（sonnet 或 opus，Kevin 定）。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B（交互主线先行）；`governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md` §四 A2；白皮书 v1.3 候选 C-4（"入站持久 spool：游标推进以落盘为准，重启回放合并"，`governance/docs/whitepaper_v1.3_candidates_2026-09-04.md:13`）。
- 基线：`main@c557af2`。分支：`wo/ingress-01`。前置：无。后继：WO-INTERRUPT-01 从本分支尾开。
- 包：`packages/lykoi-adapter-telegram`（主）、`packages/lykoi-converse`（handleTurn 签名）、`packages/lykoi-gate`（ENV_PINS 一行）、`profile/`（路径表注释）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 本单不改提示词、不改契约、不改 schema。
- 本单新增一个状态文件，走 ENV_PINS 钉面体例（brief §1 第 4 条）。
- 字段命名通道中性（`seq`、`channel`，不用 `update_id` 作为主键名），因为 WO-CHANNEL-NEUTRAL-01 排在后面，不想再改一遍。
- 教训 S-03 方向不变："丢话之害 > 偶发重复之害"（`packages/lykoi-adapter-telegram/src/index.ts:346-347`）。本单把"重复"从"整轮重跑"收窄到"至多一次重放"，不是改成"至多一次"。

## 1 · 根因（事实）

| 现象 | 位置 | 事实 |
|---|---|---|
| 游标只在整轮对话完成后才落盘 | `packages/lykoi-adapter-telegram/src/index.ts:349-367`（`pollOnce`）、`:516`（`await ctx.parallel('lykoi/telegram/inbound')`）、`:362-363`（advance + `#persistCursor`） | 顺序 = 收批 → 交 converse → 等整轮结束（含 LLM 调用、工具、送达）→ 推进游标 → 落盘。轮中崩溃 = 整条 update 重投，归档、审计、LLM 全部重跑 |
| 轮询与消费是同一个循环 | `index.ts:682-725`（`runPollLoop`）、`:353-365`（顺序 `for` + `await #handleUpdate`） | 一轮慢，轮询就停；第二条 owner 消息只能排在后面，进程里看不到"有新话来了" |
| 归档不是 spool | `index.ts:184-199`、`:202`（`INBOUND_MAX_KEEP=200`）、`:581-593`、`:630-647` | 环形 200 条，无去重（S-07，`adapter.test.ts:196` 断言），无人回读做重放 |
| 无 update_id 去重集合 | `index.ts:355-359` | 只与单调游标比大小；没有 seen-set |
| 游标/归档路径是插件配置，不是钉面 | `index.ts:664-669`（`cursorPath` 缺省 `var/telegram-cursor.json`，`archivePath` 缺省 `var/telegram-inbound.json`）、`profile/cordis.prod.yml:210-211` | 与 `chat_outbox.json` 等 ENV_PINS 状态文件体例不同（`packages/lykoi-adapter-telegram/src/outbox.ts:47-49` 是体例样板） |
| 落盘写法 | `index.ts:213-225`（`writeJsonAtomic`：tmp → `handle.sync()` → rename） | 目录未 fsync；本单沿用即可 |
| 交接点 | `packages/lykoi-converse/src/index.ts:644-646`（`ctx.on('lykoi/telegram/inbound', … handleTurn(...))`）、`:693-698`（`handleTurn(ctx, conversation, message, continuations?)`）、`:700-702`（`turnId = inboundId = tg:${updateId}`，`runId = converse-${updateId}-${messageId}`） | 一条 update = 一轮；无合并 |
| 已有 turn/terminal 字段 | `converse/src/index.ts:874-892` | `turn_id, inbound_id, run_id, update_id, message_id, context_id, user_id, is_owner, status, reason, followup_registered, ask_sent, notice_sent, reply_chars, elapsed_ms, continuation_id` |
| 崩溃窗口 | 见 `index.ts:372-379,382,388-392,396-408,456-514` | 被丢弃/被 owner 路由消费的 update 不进 converse 但游标照推（有意，保留）；只有走到 `:516` 的消息才有"轮中崩溃重投"问题 |
| 测试双件 | `packages/lykoi-adapter-telegram/src/testing.ts:15-44`（`MemoryTelegramTransport`：`queueUpdate/pollOffsets/sends`）、`:52-62`（`isolateOutboundState`）、`test/adapter.test.ts:59-84`（`setup()`）、`:134`（S-03 崩溃方向测试） | 现有 S-01～S-11 测试对游标时序有断言，本单会改其中"游标在轮后推进"的前提 |

## 2 · 决定

- **D-1 新增入站 spool 文件** `var/state/inbound_spool.json`，ENV_PINS 行 `LYKOI_INBOUND_SPOOL` → `/home/lykoi/state/inbound_spool.json`（`kind:'path'`）。文件形态 `{version:1, entries:[…]}`，每条 `{seq, channel, context_id, user_id, is_owner, text, message_id, ts, state, attempts, enqueued_at, handled_at?}`；`seq` 对 Telegram = update_id；`state ∈ pending | handling | done`。环形上限 500 条（done 的最早淘汰；pending/handling 永不淘汰）。文件损坏 = 视为空 + 审计 `inbound/spool_corrupt {bytes}`。
- **D-2 轮询与消费分离**。`pollOnce` 改为：收批 → 逐条走既有前置（edited/S-05/S-06/owner 路由）→ 需要交 converse 的消息 **append 到 spool（落盘）** → 推进并落盘游标 → 返回。不再在 `pollOnce` 里 `await ctx.parallel(...)`。新增消费循环 `runSpoolLoop`（与 `runPollLoop` 并列、同一处启动），串行取 `pending` 条目：标 `handling`（落盘）→ 发 `lykoi/telegram/inbound`（事件名本单不改）→ 等 handleTurn 返回 → 标 `done`（落盘）。消费循环单实例，用一个 in-flight 标志保证不重入。
- **D-3 Turn Assembler（合并）**。消费循环取条目时，把 spool 里**同 context_id、同 user_id、连续的** pending 条目合并成一轮：`text` 用 `\n` 拼接、顺序保持；`InboundMessage` 增字段 `seqs: number[]`（合并的全部 seq，长度 ≥1）与 `merged: number`；`messageId`/`updateId` 取第一条。合并上限 8 条，超出留给下一轮。审计 `inbound/merged {turn_id, count, chars}`（只在 count ≥ 2 时记）。`turn/terminal` 增字段 `merged_count`。
- **D-4 重放**。进程启动时 `handling` 条目回到 `pending`（`attempts += 1`），审计 `inbound/replayed {seq, attempts}`；`attempts ≥ 3` 的条目标 `done` 并审计 `inbound/spool_gave_up {seq, attempts}`，不再投喂（避免毒消息死循环）。重放走同一消费循环，因此也参与合并。
- **D-5 转 `handling` 后 handleTurn 抛错** = 该条目标 `done`（既有 `turn/terminal status:failed` 由 handleTurn 自己写），不重试；只有进程死亡才触发 D-4。这与现状"监听器抛错则 pollOnce 拒绝、游标不推"不同：现在游标已在 D-2 推进，抛错不再影响游标。对应改 `adapter.test.ts:134` 的断言。
- **D-6 归档与 `telegram/inbound` 审计** 保持在 `pollOnce` 侧（消息落 spool 之前），不搬到消费侧；所以重放不会重复归档、重复审计 `telegram/inbound`。
- **D-7 handleTurn 签名不变**，`InboundMessage` 只增字段（`seqs`、`merged` 可选，缺省视作单条）。`converse/src/index.ts:700-702` 的 id 构造不改。
- **D-8 停机语义**：`stop()` 等待当前 in-flight 轮结束（沿用现有 `withDeadline` 上限），不等 pending 排空；pending 留在盘上给下次启动。
- **D-9 测试**：新增 `packages/lykoi-adapter-telegram/test/spool.test.ts`，至少覆盖：收批后游标先于轮结束落盘；轮中"崩溃"（模拟：消费循环不启动，直接重建 adapter）后 `handling` 回放一次；三次回放后放弃；三条连续 owner 消息合并成一轮且 `seqs` 完整；不同 context_id 不合并；spool 损坏视为空；`isolateOutboundState` 把 spool 也指到临时目录。改动 `adapter.test.ts` 中受 D-2/D-5 影响的断言，逐条在 report 列出旧断言 → 新断言。

## 3 · 边界

- 不改事件名 `lykoi/telegram/inbound`、不改 `ctx.provide('telegram')`（WO-CHANNEL-NEUTRAL-01）。
- 不做中断/打断（WO-INTERRUPT-01）；本单只保证"轮中新话可见"（spool 里有 pending）。
- 不动 owner 路由消费（approval/suggestion 回答）与 S-05/S-06 丢弃语义。
- 不把归档改成 spool、不删归档。
- 不改 `Conversation`（`conversation.ts`）任何行。

## 4 · 验收

1. `npm run typecheck` 与 `npm test` 全绿；新增用例数 ≥ 7。
2. `packages/lykoi-gate/test/env-pins.test.ts` 计数 22 → 23，path 名单含 `LYKOI_INBOUND_SPOOL`；`profile/cordis.prod.yml` 路径表注释同步。
3. 时序证据：一条测试用 `MemoryTelegramTransport.pollOffsets` 与 spool 文件内容证明"游标落盘时 spool 条目仍为 pending"。
4. `turn/terminal` 新字段 `merged_count` 出现在 `converse/test/outcome.test.ts` 或 e2e 的字段断言里。
5. report §7 写明：无迁移；触及 manifest 域（adapter src、converse src、gate surface.ts、profile 两个 yml）→ 落地要重签。

## 5 · 报告要求

按 brief §4。另加一段"S-01～S-11 断言变更表"：测试名 / 旧断言 / 新断言 / 理由（D-n）。
