# WO-FIX-POLLBACKOFF-01 · 执行报告（治理侧代写，据执行 Agent 两次一次性回报）

- 执行：opus，worktree `~/Documents/lykoi/wt-fix-pollbackoff-01`，分支 `wo/fix-pollbackoff-01`，基线 main@c88959c（代码树 = e299c1d）
- tip：e1b919a（6 提交：D-1 269d410 / D-2 0dba582 / D-3 f62e71d / D-4 204adb6 / D-5 a4bb2e2 / R-1 e1b919a）
- 改动：4 文件 +353/−28，全部在 packages/lykoi-adapter-telegram（src/transport.ts、src/production.ts、src/index.ts、test/adapter.test.ts）。kernel / gate / profile / deploy / package.json / package-lock.json 未动。

## 逐项

- D-1 `production.poll()`：`pollUpdates` 结果带 `error` 即抛 `TelegramPollError(error, status)`，不再转空批。错误类导出自 transport.ts，只带 `category` 与可选数字 `status`，`message` 固定 `getUpdates failed: <category>`。
- D-2 循环 `catch` 内落审计 `telegram/poll_backoff {category, status?, backoff_s}`，非 `TelegramPollError` 归 `unexpected`；审计自成 try；`ctx.logger.warn` 保留。
- D-3 transport 逻辑零改动；`#postApi` 上方注释保留并补三行说明；`production.poll` 注释改为「失败即抛，退避在设备层循环」。
- D-4 循环体抽成导出 `runPollLoop(adapter, {signal, sleep, audit, logger})`；`adapter` 类型 `Pick<TelegramAdapterService, 'pollOnce' | 'consumeOutboxOnce'>`；新导出窄接口 `PollLoopLogger`；`apply` 传真 sleep（定时器 + abort 提前唤醒）。
- D-5 新增 9 条测试：production 抛错 4 条（api_error 502 / network_error / token 纪律 / 成功形状不变），循环 5 条（`[1,2,4,8,1]`、封顶 `[1,2,4,8,16,32,60,60]`、`unexpected` 归类、审计失败不改节奏、审计行带 status 502）。原有用例语义未动，`MemoryTelegramTransport` 未动。
- D-6 全树 grep `pollOnce`：生产调用方只有 `runPollLoop`。
- R-1 `pollUpdates` 返回类型加 `status?: number`，失败分支仅在数字时透传；`production.poll` 带进错误类。

## 读数（执行方报，治理侧独立复跑一致）

- `npm run typecheck` 净。
- `npm test` 全量 1046 / 1035 / 0 / 11（基线 1037 / 1026 / 0 / 11，+9 全为本单新测试）。
- `npm test --workspace=lykoi-adapter-telegram` 64 / 64 / 0 / 0。

## 执行方发现

1. `TelegramPollError.status` 在 D-3 限制下为死位 → 治理侧撤回限制，R-1 修订已做。
2. 退避期间 `consumeOutboxOnce` 不跑（最长 60 s）→ 治理侧接受为本意，见 review.md。
3. `fetchUpdates`（messenger.read 后端）仍把失败吞成零条 → 不在本单。
