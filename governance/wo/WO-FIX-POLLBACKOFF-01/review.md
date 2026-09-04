# WO-FIX-POLLBACKOFF-01 · 复核（2026-09-04，主治理 Agent）

- 受审尖：`wo/fix-pollbackoff-01` tip **e1b919a**（分支上另有 report.md 提交），基线 main@c88959c，代码树起点 e299c1d。
- 结论：**PASS，待 Kevin 裁合**。

## 独立核验

| 项 | 结果 |
|---|---|
| `git status` | 净 |
| 改动范围 | 4 文件，全在 packages/lykoi-adapter-telegram；kernel / gate / profile / deploy / 依赖零改动 |
| `npm run typecheck` | 净 |
| `npm test` 全量 | 1046 / 1035 / 0 / 11（基线 1037 / 1026 / 0 / 11） |
| diff 逐行 | `#postApi` 未动；`pollUpdates` 只加 status 透传；`production.poll` 一行抛；循环体搬入 `runPollLoop` 时退避常量、复位点、`consumeOutboxOnce` 位置与原文一致；审计写入自成 try |
| token 纪律 | `TelegramPollError` 构造只接 category 字串与数字 status，message 为固定模板；测试三条断言错误串无 token / URL / 原始异常文本 |

## 对执行方三点发现的处置

1. **status 死位**：D-3 写窄了。R-1 撤回限制，已做并复验（api_error 带 502、network_error 不带、审计行带 502）。
2. **退避期间出站队列不消费（最长 60 s）**：接受为本意。长轮询失败意味着平台或代理不可达，此时消费出站只会把 sendMessage 的 2/5/15/30 s 重试与未送达记录打进已知不可达的平台；一次成功即复位，出站随即恢复。这是本单引入的新语义，记在此处；`consumeOutboxOnce` 上方「出站出任何事不触发退避」那句方向相反，仍然成立。
3. **`fetchUpdates` 吞失败为零条**：不在本单，记 HANDOFF 待清理。

## 落地要点（LANDING-O）

- 零迁移、零 unit、零 profile、零依赖；src 三文件在 manifest 域内，重签期望仍 113 条。
- 停机形态同 G–N：大脑 `systemctl stop`（保持 enabled），watchdog timer 最先 disable，宿主 lykoi-browser 不动。
- §3 内容断言：`export class TelegramPollError extends Error`（transport.ts 1）、`throw new TelegramPollError(result.error, result.status)`（production.ts 1）、`export function runPollLoop(`（index.ts 1）、`type: 'telegram/poll_backoff'`（index.ts 1）；N/K/L/M 落点断言保留。
- §6 实证：`node --test packages/lykoi-adapter-telegram/test/adapter.test.ts` 64/64；落地前账 `telegram_transport_api_error` 累计、`telegram/poll_backoff` 累计（预期 0）。
- 落地后读数：下一次 Telegram 侧 502 / 超时期间，`telegram_transport_api_error` 相邻间隔 ≥ 1 s 递增，`telegram/poll_backoff` 出现并在恢复后停止。
