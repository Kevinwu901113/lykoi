# WO-FIX-UNDELIVERED-BRIDGE-01 · `undelivered_recorded` 过桥，杜绝双记

- 状态：**待派**。执行方：执行子 Agent（小单）。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：`governance/wo/WO-OUTCOME-01/review.md:49,71`（§4.4 候选小单）；`WO-OUTCOME-01/report.md:167`（out-of-scope 第 4 条）。
- 基线：`main@c557af2`。分支：`wo/fix-undelivered-bridge-01`。若 WO-UTTER-01 先落地，从其分支尾开（同文件 `transport.ts` 返回值）。
- 包：`lykoi-adapter-telegram`（唯一）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单只做字段透传与一条端到端测试。

## 1 · 根因（事实）

| 环节 | 位置 | 事实 |
|---|---|---|
| 源头产出 | `packages/lykoi-adapter-telegram/src/transport.ts:441-461`（`BotApiTransport.sendMessage` 失败时 `recordUndelivered` 并返回 `{sent:false, error, ambiguous, undelivered_recorded:true}`） | 字段齐 |
| 桥 1 | `packages/lykoi-adapter-telegram/src/production.ts:111-130`（`ProductionTelegramTransport.send` 返回 `{messageId, sent, error}`） | 丢 `undelivered_recorded`、`ambiguous` |
| 桥 2 | `packages/lykoi-adapter-telegram/src/index.ts` `messengerTransportBridge`（返回 `{message_id, context_id, sent, error?}`） | 同上 |
| 下游透传 | `messenger.ts:243-246`（`messenger.send` 展开 transport 返回值） | 有啥传啥 |
| 二次记账 | `device.ts:270-277`（`sendReply`：`undelivered_recorded !== true` 则 `recordUndelivered(source:'chat_reply')`）、`device.ts:464-473`（outbox 投递同理，`source:'chat_outbox'`） | 生产失败一次 → 账本两条 + 经验两条 |
| 现有测试 | `test/adapter.test.ts:379`（真 `BotApiTransport` + `productionWith(post)` 502：普通发送账本 2 / 经验 1 —— 这个 "2" 就是双记的读数）、`test/outbound.test.ts:515`（`sendReply` 四分支，用假 dispatch） | 没有一条测试同时穿过桥与 `OutboundOrgan` |

## 2 · 决定

- **D-1** `ProductionTelegramTransport.send` 与 `messengerTransportBridge` 的返回值增 `undelivered_recorded?: boolean`、`ambiguous?: boolean`，原样透传；类型同步。
- **D-2** `MemoryTelegramTransport.send`（`testing.ts:15-44`）失败分支也返回 `undelivered_recorded:false`（它不记账），使测试面与生产面同形。
- **D-3 测试** `test/bridge.test.ts`：`productionWith(post)`（502）+ 真 `OutboundOrgan.sendReply` 经真 `messenger.send` handler → 账本恰 1 条（`source:'telegram_transport.send_message'`）、经验恰 1 条、`sendReply` 结果 `undelivered`；outbox 投递失败同样恰 1 条。`adapter.test.ts:379` 的"账本 2"断言改为按新语义（若该用例本就绕过 OutboundOrgan，保持 2 并注明原因；执行方查清后在 report 写明）。

## 3 · 边界

- 不改账本结构、不改经验文案、不改重试常量。
- 不改 `device.ts` 的两处兜底逻辑本身（它们在字段到位后自然不触发）。

## 4 · 验收

1. 全绿；新增用例 ≥ 2。
2. report 贴：修前/修后同一失败路径的账本条数与经验条数。
3. 触及 manifest 域：是。

## 5 · 报告要求

按 brief §4。
