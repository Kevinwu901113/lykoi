# WO-CHANNEL-NEUTRAL-01 · 通道中性化第一批（B1）

- 状态：**待派**。执行方：执行子 Agent。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B；memo 评估稿 §四 B1（耦合面 = 事件名 `lykoi/telegram/inbound` + runId 里的 updateId 构造；`autonomy.initiate_chat` 面向"canonical person"）；E4-SPEC §1（身体 = 通道账号是实例事实，框架对通道中立）。
- 基线：WO-INTERRUPT-01 分支尾（INGRESS 改了 `InboundMessage` 与消费循环，本单在其上改名）。分支：`wo/channel-neutral-01`。
- 包：`lykoi-adapter-telegram`、`lykoi-converse`、`lykoi-kernel`、`lykoi-memory`、`lykoi-wake`、`lykoi-organ-browser`（各自的引用点）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 本单是**改名与单一真相**，不是搬包。`OutboundOrgan`/outbox/undelivered 仍留在 adapter 包（搬到中性包是 B2，另立）。
- 不改提示词。`contract.ts` 工具表里 `messenger.send` 等动作名已是中性，不动。
- 不改 schema：`identity_bindings.channel` 已是列值（`packages/lykoi-memory/src/schema.ts:211-219`）。
- 不改 `init-state` CLI 的 `--telegram-sender-id`（它就是 Telegram 绑定工具，名副其实）。
- 不改 `packages/lykoi-gate/src/surface.ts` 的 `LYKOI_TELEGRAM_*` 钉面名（状态文件改名 = 落地搬文件，另议）。

## 1 · 根因（事实）

| 类 | 位置 | 事实 |
|---|---|---|
| 事件名 | 声明 `packages/lykoi-adapter-telegram/src/index.ts:170-179`（模块增强：`Context.telegram`、`Context.telegramTransport`、事件 `'lykoi/telegram/inbound'`）；发 `:516`；订 `packages/lykoi-converse/src/index.ts:644` | 事件名含平台 |
| 服务名 | `ctx.provide('telegram', adapter)`（adapter `index.ts:736`）；`ctx.get('telegram')` 于 converse `index.ts:608,632,710,749`，`continuation.ts:70,266` | 服务名含平台；`TelegramAdapterService` 类型（adapter `index.ts:116-168`）被 converse 值/类型导入（`index.ts:30,35`） |
| id 构造 | converse `index.ts:700-702`：`inboundId = turnId = tg:${updateId}`，`runId = converse-${updateId}-${messageId}` | 前缀 `tg` 写死 |
| `'telegram'` 字面量 | converse `index.ts:637`（`store.ownerChannelKey('telegram')`）、`continuation.ts:267`、`packages/lykoi-kernel/src/suggestion-conversation.ts:56`（`MESSENGER_CHANNEL='telegram'`，用于 `:336`）、`packages/lykoi-kernel/src/scope.ts:50`（`DEFAULT_CHANNEL='telegram'`，`:147` 兜底） | 四处各自写死 owner 通道 |
| 已中性的部分 | `packages/lykoi-memory/src/rw.ts:1173-1180`（`ownerChannelKey(channel)` 参数化）、`:1110-1116`（`ownerPrimaryUserId()`）、`:1137`（绑定清单）、`:1158`（反查）；`lykoi-kernel/src/scope.ts:144-160`（`_bindingLookup(channel, key)` 注入） | store 层已参数化，缺"owner 的通道是哪个"的单一取值 |
| 值导入 | `packages/lykoi-wake/src/index.ts:67-69`（`outboundOrganResources, setMessengerLogEvent, setTransportLogEvent` 自 adapter）、`packages/lykoi-organ-browser/src/index.ts:28`（`registerOrganHandler` 自 `lykoi-adapter-telegram/resources`） | 本单不动（B2） |
| 审计事件名 | 全在 adapter 内：`telegram_approval_turn`、`telegram_rule_suggestion_turn`、`chat_outbox_delivered_telegram`、`telegram/sent`、`telegram/send_failed`、`telegram_undelivered_experience*`、`telegram/inbound*`、`telegram/poll_backoff` | 不动：它们是 Telegram 适配器自己的事件，名实相符 |
| 注释 | kernel 多处注释提 Telegram（`approval-*.ts`、`dispatch.ts:183`、`notifications.ts:184` 等） | 不作为验收项 |
| 测试面 | converse `test/wire.test.ts:35-37,123-126,142,162`（`ctx.provide('telegramTransport')` + `ctx.get('telegram')`）、`test/continuation.test.ts:99-108,332-340`（假 telegram 服务）、`test/fixture.ts:68`（`seedBinding(path, channel='telegram', key='1001')`） | 随改名同步 |

## 2 · 决定

- **D-1 事件改名** `lykoi/telegram/inbound` → `lykoi/messenger/inbound`；类型 `InboundMessage` 增 `channel: string`（adapter 填 `'telegram'`）。模块增强声明留在 adapter（本单不建新包），但事件名与类型名中性。
- **D-2 服务名** `ctx.provide('telegram')` → `ctx.provide('messenger')`；导出接口改名 `MessengerAdapterService`（保留 `TelegramAdapterService` 作类型别名一版，供外部引用过渡；report 列出仍用别名的位置）。`ctx.provide('telegramTransport')` 不动（它确实是 Telegram 传输）。
- **D-3 id 构造**：`inboundId = turnId = ${message.channel}:${seq}`（INGRESS 后 `seq` 即 update_id）；`runId = converse-${seq}-${messageId}` 不带平台。现有对 `tg:` 前缀的测试断言改成按 channel 拼。
- **D-4 owner 通道单一真相**：`rw.ts` 增 `ownerBinding(): { channel: string; channel_key: string } | null`（owner_primary 的第一条绑定，`ORDER BY channel, channel_key`）；四处 `'telegram'` 字面量改为读它：converse `index.ts:637`、`continuation.ts:267` 用 `ownerBinding()?.channel_key`；`suggestion-conversation.ts:56` 的 `MESSENGER_CHANNEL` 与 `scope.ts:50` 的 `DEFAULT_CHANNEL` 删除，改为从注入的 store 取 `ownerBinding()?.channel`，取不到时 scope 兜底改为抛 `scope: owner binding missing`（不再默默当 telegram）。
- **D-5 canonical person**：`autonomy.initiate_chat` 与 outbox 投递的 `ownerChannelKey` 回调（converse `index.ts:637`）统一走 D-4；`device.ts:516-518` 的 `chat_outbox_no_owner_binding` 语义不变。
- **D-6 测试**：全部 `'lykoi/telegram/inbound'`、`ctx.get('telegram')` 引用改名；新增 `packages/lykoi-memory/test` 用例：无 owner 绑定 → `ownerBinding()` 为 null；两条绑定取排序第一。kernel `scope` 用例：无绑定抛错而非兜底。
- **D-7 词汇**：`lykoi/messenger/inbound` 是 cordis 事件不是审计事件，不涉 `vocabulary.ts`；本单不新增审计事件。

## 3 · 边界

- 不搬 `OutboundOrgan`、outbox、undelivered 出 adapter。
- 不动 wake、organ-browser 的值导入。
- 不动 `LYKOI_TELEGRAM_*` 钉面与状态文件名。
- 不改 `init-state` CLI。
- 不改 adapter 内部审计事件名。

## 4 · 验收

1. 全绿。
2. `grep -rn "lykoi/telegram/inbound\|ctx.get('telegram')\|'telegram'" packages/*/src` 剩余命中只在 `lykoi-adapter-telegram/src` 与 `lykoi-memory/src/init-state.ts`；report 贴前后计数。
3. `ownerBinding()` 有测试；scope 无绑定抛错有测试。
4. 触及 manifest 域：是（六个包 src）。

## 5 · 报告要求

按 brief §4，另附"剩余耦合清单"（B2 输入）：文件 / 行 / 类别（值导入 / 状态文件名 / 审计事件名 / CLI）。
