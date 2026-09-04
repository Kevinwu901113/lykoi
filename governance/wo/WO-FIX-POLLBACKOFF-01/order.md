# WO-FIX-POLLBACKOFF-01 · getUpdates 失败进入轮询循环的退避

- 状态：**复核 PASS，待 Kevin 裁合**（opus 执行于 wo/fix-pollbackoff-01，基线 main@c88959c，tip e1b919a，6 提交 + report.md；复核见 review.md；1046/1035/0/11）
- 立单：2026-09-04 15:30 CST，主治理 Agent
- 读数：governance/docs/landing_n_readout_2026-09-04.md §3
- 包：lykoi-adapter-telegram（production.ts、index.ts、transport.ts 注释；测试）。kernel / gate / profile / deploy 不动。

## 1 · 根因

三层各自把 getUpdates 失败的退避交给别处，结果没有一层退避：

| 位置 | 现状 |
|---|---|
| `src/transport.ts` `#postApi` | getUpdates 网络异常只计 streak、不 sleep，返回 `ok:false`；HTTP ≥ 400 或 `ok!==true` 记 `telegram_transport_api_error` 后立即返回 `ok:false`。文件头注释：getUpdates 的重连节奏归设备的长轮询循环管。 |
| `src/production.ts` `poll()` | `pollUpdates` 失败一律转空批返回，不抛。注释：失败就是空批，循环照常转。 |
| `src/index.ts` 常驻循环 | 退避 1→60 s 指数、成功复位（telegram_device.py:543-551），只写在 `catch`。空批不进 `catch`。 |

实测（2026-09-04T01:17:10–21Z）：Telegram 返回 502 期间 38 次 getUpdates，间隔约 290 ms（一个经代理的 HTTP 往返）。网络异常路径受 fetch 超时约束不成热循环；HTTP 快速失败路径以往返为节拍热循环到平台恢复。

## 2 · 决定

- D-1 `production.ts` `poll()`：`pollUpdates` 结果带 `error` 时**抛** `TelegramPollError`，不再转空批。错误类只带 `category`（`pollUpdates` 的 `error` 字面值：`network_error` / `api_error` / `bad_response` / `rate_limited`）与可选 `status`（数字）；`message` 固定为 `getUpdates failed: <category>`。不带 URL、token、原始异常文本（transport 的 token 纪律）。`TelegramPollError` 导出自 `transport.ts`。
- D-2 `index.ts` 循环：退避机制不改（1→60 s 指数、成功复位）。`catch` 内新增审计事件 `telegram/poll_backoff {category, status?, backoff_s}`，`category` 取 `err instanceof TelegramPollError ? err.category : 'unexpected'`（消费者 AggregateError 等走 `unexpected`）。审计写入自身 try 包住，失败不影响退避。`ctx.logger.warn` 现有一行保留。
- D-3 `transport.ts` 不改逻辑。`#postApi` 上方「getUpdates 的重连节奏归设备的长轮询循环管」注释保留，现在为真；`production.ts` `poll()` 的「失败就是空批」注释改为「失败即抛，退避在设备层循环」。`pollUpdates`、`fetchUpdates`（messenger.read 后端，`limit`+`timeout:0` 那条）不动。
- D-4 循环可测：把循环体抽成导出函数 `runPollLoop(adapter, { signal, sleep, audit, logger })`，`apply` 里 `autoStart` 分支调用它并传真 `sleep`；`sleep` 可注入是唯一目的，不加别的参数。
- D-5 测试：
  - production：假 api `pollUpdates` 返 `{updates:[], error:'api_error'}` 与 `{…, error:'network_error'}` → `poll()` 拒绝，`err instanceof TelegramPollError`、`category` 相符、`message` 不含 URL/token；成功路径形状不变。
  - 循环：假 adapter 的 `pollOnce` 连续拒绝 4 次后成功 1 次再拒绝 1 次，注入 `sleep` 记录序列，断言 `[1,2,4,8,1]`；上限 60 断言一次（连续拒绝 8 次后为 `[1,2,4,8,16,32,60,60]`）。审计事件 `telegram/poll_backoff` 条数与 `backoff_s` 序列一致；成功那轮 `consumeOutboxOnce` 被调用。
  - 现有 `adapter.test.ts` 不改语义；`MemoryTelegramTransport` 不动。
- D-6 影响面声明：`pollOnce()` 从「失败返回 0」改为「失败拒绝」。调用方只有循环与测试。落地后 `telegram_transport_api_error` 连发事件的相邻间隔应 ≥ 1 s 且递增；新事件 `telegram/poll_backoff` 出现。

## 3 · 边界

一处规则（poll 抛）+ 已有退避生效；不引入新的退避参数，不改 `INITIAL_BACKOFF_S` / `MAX_BACKOFF_S`，不改 sendMessage 路径，不改 `#postApi`。

## 4 · 验收

- `npm run typecheck` 净；`npm test` 全量 0 新增失败（基线 1037/1026/0/11）。
- 落地：src 变更在 manifest 域内，重签 113 条；零迁移、零 unit、零 profile、零依赖。
- 落地后读数：下一次 Telegram 侧 502 / 超时期间，`telegram_transport_api_error` 相邻间隔 ≥ 1 s 递增，`telegram/poll_backoff` 出现并在恢复后停止。

## 5 · 修订 R-1（2026-09-04 复核中，主治理 Agent）

执行方指出 `TelegramPollError.status` 是死位：`#postApi` 对 HTTP ≥ 400 返回 `{ok:false, error:'api_error', status}`，但 `pollUpdates` 只透出 `error`，D-3 又禁改 `pollUpdates`，于是审计行永远没有 `status`，502 与 401 账面上同为 `api_error`。撤回 D-3 对 `pollUpdates` 返回类型的限制：

- R-1a `pollUpdates` 返回类型加 `status?: number`，失败分支透传数字 status。`#postApi` 逻辑仍不动。
- R-1b `production.poll()` 抛 `TelegramPollError(result.error, result.status)`。
- R-1c 测试补 status 断言（api_error 502 有、network_error 无、审计行带 502）。

执行方另指出两点，治理侧处置：
- 退避期间 `consumeOutboxOnce` 不跑（最长 60 s）。接受为本意：长轮询失败说明平台或代理不可达，此时不消费出站避免把 sendMessage 重试与未送达记录打进已知不可达的平台；恢复即复位。写进 review.md。
- `fetchUpdates`（messenger.read 后端）仍把失败吞成零条。不在本单，记入 HANDOFF 待清理。
