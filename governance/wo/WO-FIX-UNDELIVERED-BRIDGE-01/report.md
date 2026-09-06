# WO-FIX-UNDELIVERED-BRIDGE-01 · 报告

- 执行：主治理 Agent（Kevin 2026-09-05 令：不派 GPT）。完成：2026-09-05。
- 分支 `wo/fix-undelivered-bridge-01`，基线 `main@97431ab`（#11/#12 合并后）。
- 代码提交 `2d40392`；本报告为分支末尾提交。
- 工作树 `/Users/wukevin/lykoi/wo-fix-undelivered-bridge-01`。

## 1 · 改动文件

| 文件 | 改动 | manifest 域 |
|---|---|---|
| `packages/lykoi-adapter-telegram/src/index.ts` | `TelegramSendResult` 增 `undelivered_recorded?` / `ambiguous?`；`messengerTransportBridge.sendMessage` 原样透传两键 | 是 |
| `packages/lykoi-adapter-telegram/src/production.ts` | `ProductionTelegramTransport.send` 失败分支透传两键 | 是 |
| `packages/lykoi-adapter-telegram/src/testing.ts` | `MemoryTelegramTransport.send` 失败分支返回 `undelivered_recorded:false` | 是 |
| `packages/lykoi-adapter-telegram/test/bridge.test.ts` | 新增，4 例 | 否 |

无迁移。`contract.ts` / `prompts.ts` 未动（`git diff main..HEAD` 空）。无新 env。无新审计前缀（`telegram/sent` / `telegram/send_failed` 既有）。`device.ts` 未动：两处兜底的判据 `undelivered_recorded !== true` 保持，非生产 transport（Null / Memory）失败时仍由器官补记一笔。

## 2 · D-n 落点

| D | 落点 |
|---|---|
| D-1 类型 | `src/index.ts:74`（`undelivered_recorded?`）、`:76`（`ambiguous?`） |
| D-1 桥透传 | `src/index.ts:798-801` |
| D-1 生产 transport 透传 | `src/production.ts:131-134` |
| D-2 | `src/testing.ts:40` |
| D-3 ① sendReply | `test/bridge.test.ts:115` |
| D-3 ② outbox 投递 | `test/bridge.test.ts:132` |
| D-1 桥单测（502 / 200 两向） | `test/bridge.test.ts:86` |
| D-2 单测 | `test/bridge.test.ts:148` |

## 3 · 读数（修前 / 修后）

链路：真 `BotApiTransport`（fake post 恒 502）→ `ProductionTelegramTransport` → `messengerTransportBridge` → `messenger.send` handler → 真 `OutboundOrgan`。修前读数在 `main@97431ab` 代码上用同一夹具的探针实测。

| 路径 | 修前账本 | 修前经验 | 修后账本 | 修后经验 |
|---|---|---|---|---|
| `sendReply` | 2（`telegram_transport.send_message` + `chat_reply`） | 2 | 1（`telegram_transport.send_message`） | 1 |
| `deliverOutboxItem` | 2（`telegram_transport.send_message` + `chat_outbox`） | 2 | 1（`telegram_transport.send_message`） | 1 |

`sendReply` 结局仍为 `undelivered`。

## 4 · 测试

- 全量 `npm test`：tests 1110 / pass 1099 / fail 0 / skipped 11（基线 1106 / 1095 / 0 / 11，+4）。
- `npm run typecheck` 净。
- `adapter.test.ts:379`（WO-OUTCOME-01 D-3 "账本 2"）未改：该用例直接调 `transport.send` 两次，不经 `OutboundOrgan`，两条是两次独立发送的正确读数，与本单无关。

## 5 · sha 表（改动的 src，sha256 前 16 位）

| 文件 | sha256[:16] |
|---|---|
| `src/index.ts` | `669cc7a1df16ea98` |
| `src/production.ts` | `822cdeb3bd90a9ac` |
| `src/testing.ts` | `c91dce256f384340` |

## 6 · 范围外 / 候选

- `MemoryTelegramTransport` 失败仍不记账（假体，D-2 只要求同形）。
- 桥层仍不透传 `ts` / `context_id`（无调用方需要）。
- `messenger.send` handler 对 `undelivered_recorded` 的转发依赖 `{...result}` 展开，未加类型约束；若日后 messenger 侧收窄返回类型需同步。

## 7 · 落地提示

- 同批 LANDING-Q（与 WO-FIX-TAILBRACE-01、WO-UTTER-01）。无迁移；manifest 需重签（上表 3 个 src）。
- WO-UTTER-01 分支从本分支的代码提交 `2d40392` 开出；合并顺序 main ← 本分支 ← `wo/utter-01`。
- 落地后验收：下一次 `telegram/send_failed` 后，`telegram_undelivered.json` 只新增一条（`source=telegram_transport.send_message`），不再伴随 `chat_reply` / `chat_outbox`；`telegram_undelivered_experience` 事件增量 = 账本增量。
