# WO-UTTER-01 · 出站长文按通道上限切分（A4）

- 状态：**已合入 main@257a72e，LANDING-Q 已落地（2026-09-05 11:31 CST）**（2026-09-05，主治理 Agent 自执行；`report.md` 在分支 `wo/utter-01` 末尾提交）。原派发方式：执行方：执行子 Agent。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B；memo 评估稿 §四 A4；白皮书 v1.3 候选 C-3（"出站切分在传输层，逐字，上限归通道不归契约"）。
- 基线：`main@c557af2`（与 INGRESS/INTERRUPT 无代码交叉，可并行；若先于它们落地，从 main 开）。分支：`wo/utter-01`。
- 包：`packages/lykoi-adapter-telegram`（唯一）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- **不改契约、不改提示词**：上限是通道事实，不告诉大脑。`contract.ts` 与 `prompts.ts` 一字不动。
- 切分逐字：不加省略号、不加"(1/3)"、不改动任何字符。
- Telegram Bot API `sendMessage` 的 text 上限 4096 个字符（Telegram 按 UTF-16 code unit 计）。

## 1 · 根因（事实）

| 现象 | 位置 | 事实 |
|---|---|---|
| 无任何长度检查 | 全仓 TS 无 `4096` 字面量；无 chunk/split 辅助函数 | 超长文本原样发出 |
| 超长的实际结局 | `packages/lykoi-adapter-telegram/src/transport.ts:407-410`（`status>=400` → `api_error`）→ `:441-461`（`recordUndelivered({error:'api_error', source:'telegram_transport.send_message'})`，返回 `sent:false`） | Telegram 回 400 `MESSAGE_TOO_LONG`，被当普通 `api_error` 记未送达 + 写一条经验（`:188-206`）；owner 看到的是"有话没送出去"，不是话 |
| 发送载荷 | `transport.ts:432-437` | `{chat_id, text}` + 可选 `reply_to_message_id`；无 `parse_mode` |
| 重试 | `transport.ts:343-413`（`#postApi`）、`:57`（`SEND_RETRY_BACKOFF_S`） | HTTP 4xx 不重试，attempts=1 |
| 回复路径不经 outbox | `packages/lykoi-converse/src/index.ts:806-814` → `OutboundOrgan.sendReply`（`device.ts:238-310`）→ dispatch `messenger.send` → `messenger.ts:230-247` → bridge → `adapter.transportSend` → `TelegramTransport.send` → `BotApiTransport.sendMessage` | 回复、outbox 投递（`device.ts:447-474`）、continuation 通知（`continuation.ts:277`）最终都汇到 `BotApiTransport.sendMessage` |
| 未送达账本记录形态 | `outbox.ts:204-216` | `text_summary` 前 200 code points、`chars`、`error`、`attempts`、`source` |
| 测试双件 | `test/adapter.test.ts:373-377`（`productionWith(post)`：真 `BotApiTransport` + 假 `HttpPost`）、`src/testing.ts:15-44`（`MemoryTelegramTransport.send` 忽略第 4 参） | 切分在 `BotApiTransport` 内做，用 `productionWith` 测 |

## 2 · 决定

- **D-1 常量** `TELEGRAM_TEXT_MAX = 4096`（`transport.ts`，导出，测试钉住）。长度按 UTF-16 code unit（`text.length`）。
- **D-2 切分点**：`BotApiTransport.sendMessage` 内，`text.length > TELEGRAM_TEXT_MAX` 时切成若干段，每段 ≤ 4096。切分优先级：最后一个 `\n\n` → 最后一个 `\n` → 最后一个空白 → 硬切；不切在 UTF-16 代理对中间。逐字：各段拼回等于原文。
- **D-3 顺序发送**，段间不并发；`reply_to_message_id` 只带在第一段。返回值：全部成功 → `sent:true, message_id` = 第一段的；第 k 段失败 → 停止，返回 `sent:false, error: 'partial_delivery'`（新 error 值），`recordUndelivered` 记一条，`text` = 未送出的剩余原文（账本本来就只存 200 字摘要 + chars），`attempts` = 该段的 attempts；`undelivered_recorded:true`。
- **D-4 事件** `telegram_transport_split {parts, chars}`（logEvent，零正文）只在 parts ≥ 2 时发；`telegram/sent` 审计（`index.ts:559-565`）的 `chars` 仍记全文长度，增 `parts` 字段。
- **D-5 未送达经验文案**（`transport.ts:186`）不因部分送达改写；`partial_delivery` 沿用现有经验路径。
- **D-6 `MemoryTelegramTransport`** 不做切分（它在 `TelegramTransport` 层）；为让 converse e2e 也能看到切分，`testing.ts` 增可选 `maxChars` 构造参数，缺省不限制，设置后按 D-2 同一函数切（把切分函数导出为纯函数 `splitForTelegram(text, max)` 供两处复用）。
- **D-7 测试** `test/split.test.ts`：纯函数 12 例（空串、恰 4096、4097、只有一个超长词、代理对边界、`\n\n` 优先、拼回等于原文）；`productionWith(post)` 下 3 段全成功 message_id 为第一段、第 2 段 502 → `partial_delivery` + 账本一条 + `undelivered_recorded:true`；`telegram/sent.parts === 3`。

## 3 · 边界

- 不改 `contract.ts`、`prompts.ts`、`device.ts` 的语义；不改 outbox 结构。
- 不加 `parse_mode`。
- 不做入站合并（那是 INGRESS）。
- 不改 `ProductionTelegramTransport` 桥的字段透传（WO-FIX-UNDELIVERED-BRIDGE-01）。

## 4 · 验收

1. 全绿；新增用例 ≥ 15。
2. `TELEGRAM_TEXT_MAX` 有测试钉面。
3. report 附一张表：切分前后 `chars` / `parts` / 各段长度，取三条测试样本。
4. 触及 manifest 域：是（adapter src）。

## 5 · 报告要求

按 brief §4。
