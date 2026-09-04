# WO-INTERRUPT-01 · 只读认知阶段可被新话打断（A3）

- 状态：**待派**。执行方：执行子 Agent。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B；memo 评估稿 §四 A3（"只读认知在第一次派发前可中止 + pending 队列"）；LANDING-J～O 读数：step 0 思考 10–85 s，是打断收益的来源。
- 基线：WO-INGRESS-01 分支尾（需要 spool 的 pending 可见性）。分支：`wo/interrupt-01`。
- 包：`packages/lykoi-converse`（主）、`packages/lykoi-adapter-telegram`（消费循环触发）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 不改提示词、不改契约。
- "打断"只对**只读阶段**成立：第一条工具帧入 `#messages` 之前、第一次 kernel 派发之前。派发之后不可打断，这是硬边界（副作用已发生，白皮书 9.4 不允许回滚已派发动作）。
- 打断后被打断的那条消息**不丢**：回到 spool `pending`，与新话合并成下一轮（依赖 WO-INGRESS-01 D-3）。

## 1 · 根因（事实）

| 现象 | 位置 | 事实 |
|---|---|---|
| `send()` 串行锁，只排队不拒绝 | `packages/lykoi-converse/src/conversation.ts:333-349`（`AsyncLock` promise 链）、`:378` | 第二个 `send()` FIFO 等前一个；没有 tryLock、没有忙标志 |
| 锁内顺序 | `:1451-1528` | 清 S-13 状态 → 赋 `#lastRunId/#lastTurnId`（:1459-1460）→ `checkpoint = #messages.length`（:1461）→ push user 消息（:1462）→ `withDeadline(... #runCycle(signal))`（:1469-1470） |
| 第一次 LLM 调用带 signal | `:973`（`#completion(signal, nudge)`）、`:924-932`（`...(signal === undefined ? {} : { signal })`）→ `packages/lykoi-converse/src/index.ts:422` → `ctx.lykoiLlm.call` | signal 已经穿到 llm 层 |
| 第一次不可逆点 | `:1112`（`#messages.push` 工具帧）、`:1132`（`await dispatchFn(action, { origin:'interactive' })`） | `reply/silence/promise_followup` 三种 kind 在 `:1056/:1061/:1067` 返回，无外部副作用 |
| 失败即回滚 | `:1471-1486`（`DeadlineExceededError` → `u3_cycle_timeout`；无条件 `#messages.splice(checkpoint)` + `chat_turn_rolled_back`；rethrow） | 抛错的轮不写 history 行（`test/deadline.test.ts:216-217` 断言无 `inner_outer_pair`） |
| 取消原语 | `packages/lykoi-converse/src/deadline.ts:102-126`（`withDeadline`：自建 `AbortController` :113，超时 `controller.abort(exc)` :119，`Promise.race` :125） | 只有超时会 abort；没有外部 abort 入口 |
| llm 层 | `packages/lykoi-llm/src/index.ts:83`（`FAILURE_FINISH_KINDS = ['error','aborted']`）、`:203-216`（调用后必 charge；usage 缺失记 0） | abort 被识别为失败 finish；费用在 usage 缺失时记 0（`TODO(M2)` :202-203） |
| 供应商适配 | `packages/lykoi-llm-deepseek/src/index.ts` 无 `signal`/`abort` 字样 | 是否真能取消 HTTP 流取决于 `dsh-llm` `GenerateOptions.signal`；未验证 |
| kernel 派发 | `packages/lykoi-kernel/src/dispatch.ts:470` | 无 signal；进入即不可取消 |
| TurnStatus | `packages/lykoi-converse/src/outcome.ts:6-11` | `replied | intentional_silence | deferred | consumed | failed`；无 aborted/superseded |
| 交互锁 | `packages/lykoi-kernel/src/interactive-lock.ts:2-8,64-76` | 只让 wake 让位，"没有硬抢占"；与本单无关，不动 |
| 测试空白 | `packages/lykoi-converse/test/` 无并发/锁行为断言 | `deadline.test.ts:187` 是最近的样板（断言 `seen.aborted === true`） |
| 双件 | `test/fixture.ts:167-190`（`FakeLlm.calls[].opts` 可观察 `signal`；`push()` 可放函数，可做"挂起直到 signal"） | 可用 |

## 2 · 决定

- **D-1 `Conversation` 增方法 `interrupt(reason: 'newer_inbound'): boolean`**。语义：若当前有轮在锁内且 `#dispatchStarted === false`（新增私有标志，在 `:1112` 之前置 true），则触发外部 abort 并返回 true；否则返回 false，无副作用。`#dispatchStarted` 在每轮 `:1455-1458` 清态处重置。
- **D-2 外部 abort 与 deadline 合成**。`withDeadline` 增第四参 `external?: AbortSignal`；内部 controller 在 `external` abort 时以 `new InterruptedError(reason)` abort（新错误类，`deadline.ts` 内定义，携 `reason`、`elapsedMs`）。`Promise.race` 增一腿：external abort 立刻 reject，不等 LLM 返回（被丢弃的那次调用继续在后台完成，其 `budget/charge` 照常落，本单不改费用语义）。
- **D-3 send() 的中断处理**。`:1471-1486` 增 `InterruptedError` 分支：审计 `converse/cycle_interrupted {run_id, turn_id, step, elapsed_ms, reason}`；S-14 回滚照做；rethrow 一个带 `interrupted: true` 标记的错误（或返回值形态，执行方选，report 说明）。
- **D-4 TurnStatus 增 `superseded`**（`outcome.ts:6-11`），`TurnFailReason` 不动。`handleTurn`（`converse/src/index.ts:693-895`）捕获中断 → `turn/terminal status:'superseded', reason:'newer_inbound'`；不发系统回执、不注册 continuation（`CONTINUATION_ELIGIBLE_STATUSES` 不含它）；`elapsed_ms` 照记。
- **D-5 触发源**：WO-INGRESS-01 的消费循环在 append 新 owner 条目到 spool 时（pollOnce 侧）发一个进程内信号（简单做法：adapter 持有 `onPendingAppended` 回调，converse 装配时注册为 `() => conversation.interrupt('newer_inbound')`）。仅当新条目与 in-flight 轮同 context_id、同 user_id 且 `is_owner` 时触发。`interrupt()` 返回 true 时，消费循环把 in-flight 条目从 `handling` 改回 `pending`（`attempts` 不加），使之与新条目合并成下一轮。
- **D-6 打断预算**：同一条目被打断最多 2 次（spool 条目增 `interrupted: number`）；第 3 次不再打断，让它跑完。防止 owner 连发时永远跑不完一轮。
- **D-7 验证 deepseek 取消行为**：执行方在本地用 `FakeLlm` 之外，写一段一次性脚本（不入库）观察 `dsh-llm` 是否消费 `signal`；结论写 report §6：真取消 / 仅逻辑丢弃。两种情况本单都算完成（D-2 的 race 保证锁释放时间与 LLM 无关）。
- **D-8 测试**：新增 `packages/lykoi-converse/test/interrupt.test.ts`：step 0 LLM 挂起时 `interrupt()` 返回 true，锁在 50 ms 内释放，`chat_turn_rolled_back` 出现，无 history 行，`turn/terminal status:superseded`；工具帧已推后 `interrupt()` 返回 false 且轮正常结束；打断两次后第三次返回 false；`FakeLlm.calls[0].opts.signal.aborted === true`。adapter 侧：spool 条目从 `handling` 回 `pending` 并与新条目合并（在 `spool.test.ts` 增用例）。

## 3 · 边界

- 不给 kernel `dispatch` 加 signal。
- 不改交互锁 S-17。
- 不改费用记账（usage 缺失记 0 的 `TODO(M2)` 原样保留，report 列为候选小单 WO-FIX-ABORT-CHARGE-01）。
- 不改提示词，不改 `TurnFailReason`。
- 不做"超时后也合并"：`DeadlineExceededError` 路径语义不变（status `failed`）。

## 4 · 验收

1. 全绿；新增用例 ≥ 6。
2. 一条端到端用例（`converse/test/e2e.test.ts` 或新文件）：两条 owner 消息在 step 0 期间到达 → 恰一条 `turn/terminal superseded` + 恰一条 `turn/terminal replied` 且后者 `merged_count = 2`，LLM 调用次数 = 2（被打断 1 + 合并轮 1）。
3. `outcome.test.ts` 的状态枚举断言更新为六值。
4. report §6 写明 D-7 结论。

## 5 · 报告要求

按 brief §4，另附"打断时序图"（文本表：t0 收到第一条 → t1 LLM 调用开始 → t2 第二条落 spool → t3 interrupt → t4 锁释放 → t5 合并轮开始），用测试里的事件顺序证明。
