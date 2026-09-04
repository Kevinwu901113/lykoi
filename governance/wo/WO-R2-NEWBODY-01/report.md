# WO-R2-NEWBODY-01 · 报告

- 执行方：主治理 Agent（本窗口自执行，未派子 Agent）。日期：2026-09-05。
- 分支：`wo/r2-newbody-01`。基线：`main@dde5ab9`（代码基线 `main@c557af2`，其后两笔均为治理文档）。
- 触及 manifest 域：**否**。只新增 2 条测试用例与 1 个只读脚本，`packages/*/src` 与 `profile/` 一字未改。
- 产线读数：§3.1 已回填（2026-09-05）。
- 测试：1106 / 通过 1095 / 失败 0 / 跳过 11（基线 1104 / 1093 / 0 / 11；+2 恰为本单新增两条）。`npm run typecheck` 干净。

## 1 · 四行结论

| 前置 | 结论 | 证据 |
|---|---|---|
| 1 劈快照（`read` 零写） | **达成**（无需新增，已有断言） | `packages/lykoi-snapshot/test/read.test.ts:255`「read 零写（SA-47）+ 对照组（SA-48）」：`dbDigest` 前后相等，且对照组一次 `recordExperience` 后摘要必须变。`read()` 本体在 `packages/lykoi-snapshot/src/index.ts:546-576`，只调读面块与 `deps.unprocessedRestartEvent` |
| 2 推演零写 | **达成**（补一条覆盖 LLM 跳） | 原有两条在 `packages/lykoi-wake/test/zero-write.test.ts:19,59`，只包到 `evaluateMessage`，**不含 `deps.llm`**；本单补 `:71` 起一条，把 llm 调用与 not_json 重试分支纳入同一摘要区间，仍零写 + 对照组 |
| 3 WAL | **未达**（代码定性 + 产线读数确认） | `packages/lykoi-memory/src/rw.ts:19` C-29 明文「不设 journal_mode（memory.db 现行 rollback journal；切 WAL 是独立决策项）」；`init-state.ts:105` 与 `rw.ts:418-419` 只设 `busy_timeout` / `foreign_keys`，全树无 `journal_mode` 设置点。产线读数 `journal_mode=delete`（§3.1）。竞争测量见 §3.2 |
| 4 费用闸 | **达成** | 硬顶：`packages/lykoi-budget/src/index.ts:189`（`>= cap` 即拒，拒调先落 `budget/refusal` 审计再抛）。产线 cap 非零：`profile/cordis.prod.yml:62-65`（总量 2000000，`deepseek-official` 2000000）。入口收敛：全部 LLM 调用点经 `ctx.lykoiLlm.call`（converse `src/index.ts:410,466,548,582`；wake `src/index.ts:567`），`lykoi-llm/src/index.ts:172` gate 前置、`:211` charge 后置。已有断言 `packages/lykoi-llm/test/llm.test.ts:55,69`；本单补 cap=0 边界 |

**37.5 解锁判定：不解锁。** 四件中前置 3 未达。

## 2 · 新增物

- `packages/lykoi-wake/test/zero-write.test.ts` 新增用例「推演零写（D-2 补）：含 LLM 调用与 not_json 重试整段仍零写」。与 `src/index.ts:325-370` 阶段 4 同构：`read → buildCandidates → buildMessages → llm(首答坏) → extractJson 抛 → llm(次答合法) → evaluateMessage`，断言两跳 llm 都发生过、决策合法、全库摘要不变，并保留 SA-48 对照组。
- `packages/lykoi-budget/test/budget.test.ts` 新增用例「D-4：cap=0 在零用量时即拒（per-route 与总量两层）」。`>= cap` 与 `> cap` 的差别在新体上是"一次调用都发不出去"与"先发一次再说"的差别，值得钉住。
- `governance/wo/WO-R2-NEWBODY-01/wal-contention.mjs`：临时库测量脚本，`node:sqlite` 零依赖，库建在 `os.tmpdir()` 跑完即删，**不碰产线**。

## 3 · 前置 3 的两半

### 3.1 产线读数：已回填（Kevin 2026-09-05 于服务器跑）

```
# sudo -u lykoi sqlite3 -readonly /home/lykoi/state/memory.db 'PRAGMA journal_mode; PRAGMA user_version;'
delete
0
```

`journal_mode=delete` —— 产线库确为 rollback journal，与 `rw.ts:19` C-29 一字不差，无人在库外改过。**前置 3 未达，由产线读数确认，不再是推断。**

`user_version=0` 是既定口径，不是异常：schema 版本记在台账表里读 `MAX(version)`（STATE-CONTRACT §1.0），`PRAGMA user_version` 从不使用。`packages/lykoi-memory/src/schema.ts:14` 明文"`PRAGMA user_version` 两侧同为 0"。

### 3.2 竞争测量：已跑

`node governance/wo/WO-R2-NEWBODY-01/wal-contention.mjs`（Mac，Node v24.18.0，2026-09-05）：

```
journal_mode=delete	write_during_open_read=blocked:ERR_SQLITE_ERROR	waited_ms=10382.1
journal_mode=wal	write_during_open_read=ok	waited_ms=0.5
```

读法：rollback journal 下，一个**打开着的**读事务把写方顶满 `busy_timeout`（10 s）后失败；WAL 下写方 0.5 ms 通过。

### 3.3 一条限定，不要读过头

这两行不等于"今天的产线在挨饿"。现行推演路径**不持有跨 LLM 调用的读事务**：`read()` 逐条 `prepare/all` 后返回一个纯对象，连接不在事务中（`rw.ts` 无 `BEGIN` 包住读面）。所以单分支的今天碰不到上面那 10 s。

它约束的是 R2 想做的事：若 N 条并行分支各自持一个打开的读事务，rollback journal 下写方会被顶到超时。因此前置 3 的真正含义是——**要么先切 WAL，要么把"分支不持事务"写成 R2 的硬约束**。二者都是决策，不是现状。

## 4 · 顺带发现（不在本单范围，仅记）

`packages/lykoi-llm/src/index.ts:9` 自带 `TODO(M3)`：裸 `ctx.llm` 未对业务插件遮蔽。费用闸靠约定而非隔离——今天全树无人绕过（`grep ctx.llm` 只命中 `lykoi-llm` 自身与 mock 适配器注册），但这是 grep 事实，不是结构保证。前置 4 记"达成"是按现状；若 R2 引入新体或第三方插件，这条要重估。
