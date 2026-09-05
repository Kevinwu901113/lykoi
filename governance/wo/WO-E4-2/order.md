# WO-E4-2 · 记忆种子搬进实例包（E4 第二批）

- 状态：**已完成，已合入 main**（2026-09-05；分支 `wo/e4-2`，代码 bb0ffe0，report 见同目录 `report.md`）。执行方：主治理 Agent 自执行（Kevin 令：不派 GPT、不等审查往前推）。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：E4-SPEC §3.2、§2.3、§4 表 E4-2、§6.4（实例包路径：本稿建议 = persona TOML 所在目录）；审计 A1 `seed.ts:75-77`（严重）与 D.3。
- 基线：WO-E4-1 分支尾。分支：`wo/e4-2`。
- 包：`lykoi-decide`（seed）、装配入口（persona 路径已知处）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- **缺省假设（Kevin 裁定 E4-SPEC §6.4 前生效）**：实例包根 = persona TOML 所在目录（产线 `/home/lykoi/runtime/persona/`）；零新路径常量。若 Kevin 裁定不同，按裁定改。
- 已诞生实例的记忆库**不触碰**：产线 insights 表里那行 `preference: Kevin 用中文交流，技术术语用英文` 留着（E4-SPEC §3.2）。本单对已跑实例零影响的证据要写进 report。

## 1 · 事实

| 项 | 位置 | 事实 |
|---|---|---|
| 种子常量 | `packages/lykoi-decide/src/seed.ts:75`（`MEMORY_SEEDS`）、`:83`（`seedPersona(`）、`:87-90`（逐条写入，返回条数） | 每个新实例都被写进第一实例的偏好 |
| 去重语义 | 审计 D.3：`(category, content)` 去重；改内容 = 新增而非替换 | 搬家只影响未来出生的实例 |
| persona 路径常量 | `packages/lykoi-gate/src/surface.ts:31`（`PERSONA_TOML_CANONICAL = '/home/lykoi/runtime/persona/lykoi_base.toml'`）、装配入口读 `LYKOI_PERSONA_TOML` 钉面 | 实例包根可由此派生 |
| 合成实例包 | `packages/lykoi-decide/test/fixtures/instance/`（E4-1 建） | 本单加 `seeds.toml` |

## 2 · 决定

- **D-1 实例包加载器** `loadInstancePackage(personaPath): { root, seeds: [category, content][] }`（`lykoi-decide/src/instance.ts`，新文件）：`root = dirname(personaPath)`；`seeds.toml` 形态 `[[seed]] category="preference" content="…"`；文件缺失 = 零种子（不是缺省一条）；文件损坏 = 抛错（出生证阶段抛错比静默好）。
- **D-2 `seedPersona(store, seeds)`** 改为接收种子数组；`MEMORY_SEEDS` 常量删除。调用点改为传 `loadInstancePackage(personaPath).seeds`。
- **D-3 合成实例包** `fixtures/instance/seeds.toml` 放一条合成种子（`category="preference"`，内容明显合成）；测试断言 seedPersona 写入的正是它。
- **D-4 产线落地提示**：本单落地前 Kevin 需在 `/home/lykoi/runtime/persona/` 放 `seeds.toml`（内容 = 现有那一条，或空文件）；因为 `seedPersona` 只在新实例出生时跑，产线已诞生实例即便没有该文件也零影响——report 写清这两条并给出 `seedPersona` 在产线启动路径上是否被调用的 file:line 证据。
- **D-5 测试**：无文件 → 0 条；一条 → 1 条且内容一致；损坏 → 抛；`grep MEMORY_SEEDS packages` 为零。

## 3 · 边界

- 不改 persona TOML 格式；不改 schema。
- 不改 `surface.ts`（persona 钉面不动）。
- 不做导入器（P-D2）。

## 4 · 验收

1. 全绿；新增用例 ≥ 3。
2. `packages/*/src` 零 `MEMORY_SEEDS`、零 `Kevin 用中文`。
3. report §7 含 D-4 两条落地提示。
4. 触及 manifest 域：是（decide src）。

## 5 · 报告要求

按 brief §4。
