# WO-UTTER-01 · 报告

- 执行：主治理 Agent（Kevin 2026-09-05 令：不派 GPT）。完成：2026-09-05。
- 分支 `wo/utter-01`，从 `wo/fix-undelivered-bridge-01` 的代码提交 `2d40392` 开出（= `main@97431ab` + BRIDGE D-1/D-2）。
- 代码提交 `dbbe22d`；本报告为分支末尾提交。
- 工作树 `/Users/wukevin/lykoi/wo-utter-01`。包：`packages/lykoi-adapter-telegram`（唯一）。

## 1 · 改动文件

| 文件 | 改动 | manifest 域 |
|---|---|---|
| `src/transport.ts` | `TELEGRAM_TEXT_MAX`；纯函数 `splitForTelegram`；`sendMessage` 切段顺序发、`partial_delivery`、`telegram_transport_split` 事件 | 是 |
| `src/index.ts` | `TelegramSendResult.parts?`；`telegram/sent` 审计增 `parts`（缺席按 1）；`telegram/send_failed` 有则带 | 是 |
| `src/production.ts` | 真切了（≥ 2）才透传 `parts` | 是 |
| `src/testing.ts` | `MemoryTelegramTransport` 可选 `maxChars`；`RecordedSend.replyTo` 放宽为 `string \| null` | 是 |
| `test/split.test.ts` | 新增，21 例 | 否 |

未动：`contract.ts` / `prompts.ts` / `device.ts` / `outbox.ts`（`git diff main..HEAD` 对四者为空）。无 `parse_mode`。无迁移。无新 env。无新审计前缀：`telegram_transport_split` 是 transport telemetry（`logEvent`），不是审计事件；`telegram/sent` 只增字段。

## 2 · D-n 落点

| D | 落点 |
|---|---|
| D-1 | `src/transport.ts:217`；钉面 `test/split.test.ts:74` |
| D-2 | `src/transport.ts:232-267`（`splitForTelegram`） |
| D-3 | `src/transport.ts:484-547`（`sendMessage`）：`reply_to` 只首段 `:515`；`partial_delivery` `:522`；账本正文 = 剩余原文 `:526` |
| D-4 | `src/transport.ts:502`（split 事件，parts ≥ 2 才发）；`src/index.ts:578`（`telegram/sent.parts`）、`:591`（`send_failed` 有则带） |
| D-5 | 经验文案（`transport.ts` `_recordUndeliveredExperience`）未改；`partial_delivery` 沿现有路径（`split.test.ts:205` 断言经验恰 1 条且含 `partial_delivery`） |
| D-6 | `src/testing.ts:27-31`（`maxChars`）、`:50-54`（同一 `splitForTelegram`，`replyTo` 只首段）；`src/production.ts:135,139` |
| D-7 | `test/split.test.ts`：纯函数 13 例（`:74-151`）、`BotApiTransport` 5 例（`:173-241`）、审计 2 例（`:292`、`:304`）、fake 1 例（`:321`） |

## 3 · 切分样本表

| 样本 | chars | parts | 各段长度 | 切点 |
|---|---|---|---|---|
| a×4000 `\n\n` b×4000 `\n\n` c×100 | 8104 | 3 | 4002 / 4002 / 100 | 两次 `\n\n` |
| w×10000（单一超长词） | 10000 | 3 | 4096 / 4096 / 1808 | 硬切 |
| x×3000 `\n\n` y×1000 `\n` z×500 | 4503 | 2 | 3002 / 1501 | `\n\n` 优先于 `\n` |
| a×4095 + 😀 + b | 4098 | 2 | 4095 / 3 | 硬切退一格，不拆代理对 |

各行拼回均等于原文（测试断言）。

## 4 · order 字面之外的判断

- 分隔符归前一段（切点在分隔符之后）：这是"拼回逐字"的必然，`\n\n` / `\n` / 空白三级都如此。
- 第 1 段就失败**不叫** partial：`error` 沿用类别（`api_error` / 网络类），账本 `chars` = 全文，与从前逐字同；只有第 k ≥ 1 段失败才是 `partial_delivery`。
- 账本 `error` 在 partial 时记 `partial_delivery`；底层类别不丢——`#postApi` 已发 `telegram_transport_api_error` / `telegram_transport_network_error` 事件。
- `parts` 在 `TelegramSendResult` 里只在 ≥ 2 时出现：单段结果形状不变，`adapter.test.ts`「前置#8 生产桥」与 `bridge.test.ts` D-1 的 deepEqual 均不必改；审计层 `telegram/sent` 恒有 `parts`。
- `splitForTelegram('')` → `['']`（`transportSend` 本就拒空文本；纯函数保持"拼回等于原文"）。`max < 1` 或非整数抛 `RangeError`；`max = 1` 时代理对无法不拆（不可能的配置，未特判）。
- 第 2 段网络类失败照走 `SEND_RETRY_BACKOFF_S` 重试（4 次），`attempts` 记该段的（`split.test.ts:241`）。

## 5 · 测试

- 全量 `npm test`：tests 1131 / pass 1120 / fail 0 / skipped 11（基线 1106 / 1095 / 0 / 11；+4 BRIDGE、+21 本单）。
- `npm run typecheck` 净。
- 新增 21 例 ≥ 15；`TELEGRAM_TEXT_MAX` 钉面 `split.test.ts:74`。

## 6 · sha 表（本包改动的 src，sha256 前 16 位）

| 文件 | sha256[:16] |
|---|---|
| `src/transport.ts` | `98c4fd5f284acda3` |
| `src/index.ts` | `1d401cd7ac165e50` |
| `src/production.ts` | `b267677df6ba95b9` |
| `src/testing.ts` | `a65eef43348e0a8b` |

`index.ts` / `production.ts` / `testing.ts` 相对 BRIDGE 报告的 sha 已变——同批重签以本表为准。

## 7 · 范围外 / 候选

- partial 时"第几段失败"没有独立事件（可由 split 事件 `chars` 与账本 `chars` 反推）；若要直读，候选加 `telegram_transport_partial_delivery {parts, delivered}`。
- 切分不感知代码块围栏（``` 会被从中切开，仍逐字）；无 `parse_mode` 时无渲染后果，若日后加 `parse_mode` 需重估（实体计数不同）。
- converse e2e 未加切分用例（D-6 只要求提供 `maxChars` 能力）；候选在 INGRESS / INTERRUPT 落地后补。

## 8 · 落地提示

- LANDING-Q 同批。合并顺序：main ← `wo/fix-tailbrace-01`、`wo/fix-undelivered-bridge-01` ← `wo/utter-01`（utter 含 bridge 的代码提交 `2d40392`，不含其 report 提交，合并无冲突）。
- 无迁移；manifest 重签：本包 4 个 src（上表）。
- 落地后验收：事件流 `"telegram_transport_split"` 只在超长回复时出现；`telegram/sent` 每条带 `parts`；若出现 `partial_delivery` 账本记录，其 `chars` 小于对应 split 事件的 `chars`。
