# WO-R2-NEWBODY-01 · 9.4 重评 R2 四前置在新体上重做实证（D2）

- 状态：**待派**。执行方：执行子 Agent。前置 3 需 Kevin 服务器一条只读命令。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-D（Task Runtime E2 锁在 D2 之后）；`governance/docs/whitepaper_v1.3_candidates_2026-09-04.md` §2（四前置表：劈快照 / 推演零写 / WAL / 费用闸）；白皮书 9.4、37.5。
- 基线：`main@c557af2`。分支：`wo/r2-newbody-01`。**只允许新增测试与只读脚本，不改 src**。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单结论只有四行"达成 / 未达 + 证据位置"；四件全达才解锁 37.5，任一未达则 E2 不立项。不要为了"达成"去改 src——未达就写未达。

## 1 · 事实（起点）

| 前置 | 位置 | 已知 |
|---|---|---|
| 1 劈快照 | `packages/lykoi-snapshot/src/index.ts:530`（`maintain(store, deps, now): Date`）、`:546`（`read(store, deps, now): Snapshot`）、`:385-400`（`regulationBlock` 只读 `getRegulation` / `recentRegulationEvents`） | 两半已分；`read` 是否零写未被断言 |
| 2 推演零写 | `packages/lykoi-wake/src/index.ts:325`（"阶段 4：推演（纯读，G-9/SA-47 零写断言常驻本包测试）"）、`packages/lykoi-wake/test/zero-write.test.ts` | 断言存在；覆盖范围（是否包住 `buildCandidates` + `buildMessages` + LLM 调用整段）未核 |
| 3 WAL | 无代码事实；产线 `PRAGMA journal_mode` 未读 | 需 Kevin：`sudo -u lykoi sqlite3 -readonly /home/lykoi/state/memory.db 'PRAGMA journal_mode; PRAGMA user_version;'` |
| 4 费用闸 | `packages/lykoi-budget/src/index.ts:175-197`（`gate(route)`：当日用量 ≥ cap 即抛 `BudgetExceeded`，审计 `budget/refusal`）、`packages/lykoi-llm/src/index.ts:174`（每次调用前 `budget.gate(provider)`）、`:203-216`（调用后必 charge，usage 缺失记 0） | 硬顶存在；要核：产线 profile 的 cap 是否非零、是否所有 LLM 入口都经 `lykoi-llm`（grep 直连供应商的调用） |

## 2 · 决定

- **D-1 前置 1**：新增 `packages/lykoi-snapshot/test/read-zero-write.test.ts`：用带写入计数的 store 双件（拦截所有非 SELECT 方法）跑 `read()`；断言零写。若 `read` 有写路径 → 未达，报告写出该行。
- **D-2 前置 2**：读 `zero-write.test.ts`，列出它包住的调用段；若不含候选构建、消息构建、LLM 调用整段，补用例（同一双件）；补不上（因为推演段本身有写）→ 未达。
- **D-3 前置 3**：交 Kevin 上面那条只读命令；另写 `wal-contention.mjs`（临时库，`node:sqlite`，不碰产线）：一读事务持续 2 s 时，写事务在 DELETE 与 WAL 两种模式下各等多久；输出两行毫秒数。
- **D-4 前置 4**：核 `profile/cordis.prod.yml` 的 budget cap 值（只读）；grep `packages/*/src` 直接 `fetch`/供应商 SDK 的调用，确认都经 `lykoi-llm`；写一条测试断言 `gate` 在 `charge` 之前被调用且 cap=0 时拒绝（若已有则引用）。
- **D-5 结论表**：`report.md` 四行 + 一句"37.5 解锁 / 不解锁"。

## 3 · 边界

- 不改 src；不改 profile。
- 不做 Task Runtime 设计。
- 不改费用记账的 `TODO(M2)`（WO-INTERRUPT-01 已列候选）。

## 4 · 验收

1. 全绿；新增用例 ≥ 2（或说明为何零新增）。
2. 四行结论各带 file:line 或命令输出。
3. 触及 manifest 域：否（只有 test 与脚本）。

## 5 · 报告要求

按 brief §4。前置 3 的 Kevin 读数回填前，该行标"待 Kevin"。
