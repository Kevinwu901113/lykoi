# WO-E4-2 · report —— 记忆种子搬进实例包

- 分支 `wo/e4-2`（基线 main@e5bbd16 = WO-E4-1 合入后）。代码提交 bb0ffe0；本 report 为分支尾提交。
- 执行方：主治理 Agent 自执行（Kevin 令：不派 GPT、不等审查往前推）。
- 结论：框架 `MEMORY_SEEDS` 常量删除，出生种子改从实例包 `seeds.toml` 装载（缺失 = 零种子，损坏 = 出生即炸）；产线唯一调用点（converse 出生序）改传实例包种子。全量 1165/1154/0/11（基线 1159/1148/0/11，+6 新用例），typecheck 净。**触及 manifest 域：是**（decide 新增 1 个 src 文件 + 2 个 src 改动，converse 1 个 src 改动）。

## 1 · 交付

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/lykoi-decide/src/instance.ts` | **新增** | `loadInstancePackage(personaPath): { root, seeds }`、`instanceRoot`、`parseSeeds`、`InstancePackageError`、`SEEDS_FILENAME`、`SEEDS_TABLE`、`MemorySeed` 类型 |
| `packages/lykoi-decide/src/seed.ts` | 改 | 删 `MEMORY_SEEDS`；`seedPersona(store, seeds, opts)` 接种子数组，返回条数；头注更新 |
| `packages/lykoi-decide/src/index.ts` | 改 | `export * from './instance.ts'` |
| `packages/lykoi-converse/src/index.ts` | 改 | 出生序：`const instance = loadInstancePackage(resolve(config.personaToml))` → `seedPersona(store, instance.seeds, { now })`（:316-319）；import 加 `loadInstancePackage` |
| `packages/lykoi-decide/test/fixtures/instance/seeds.toml` | **新增** | 合成实例包的种子：一条 `preference`，内容"合成种子：Owner 偏好用中文交流…（测试实例包）" |
| `packages/lykoi-decide/test/fixtures/instance/persona.toml` | 改 | `interests.seeds` 四词合成化（"合成兴趣甲…丁"）；头注更新。内核不渲染 interests → SA-154 钉面不变 |
| `packages/lykoi-decide/test/instance.test.ts` | **新增** | 6 用例（§2 D-5） |
| `packages/lykoi-decide/test/seed.test.ts` | 改 | seedPersona 用例改读实例包；兴趣种子断言改读 `FIXTURE_PERSONA.interests.seeds` |

8 files changed, 217 insertions(+), 25 deletions(-)。`docs/`、`profile/`、`deploy/`、schema、`surface.ts`、persona TOML 格式零改动。

## 2 · D 项落实

| D | 落实 |
|---|---|
| D-1 装载器 | `instance.ts`：`root = dirname(resolve(personaPath))`（缺省假设：实例包根 = persona TOML 所在目录，零新路径常量）；`seeds.toml` 缺失（ENOENT）= `{ root, seeds: [] }`；读不了（如是目录）/ 不是合法 TOML / 形状不对 = `InstancePackageError`。**形态偏离**（§5 ①）：order 写的 `[[seed]] category=… content=…` 是 array-of-tables，本包严格 TOML 子集**明确拒绝**它（`persona-toml.ts` parseTomlSubset 头注），order §3 又不许改 persona TOML 格式/解析器，故改用子集内形态：`[seeds]` 表，键 = category，值 = 字符串数组；展平为 `[category, content][]` |
| D-2 seedPersona | 签名 `(store, seeds, { now })`；`MEMORY_SEEDS` 删除；唯一调用点 converse `index.ts:316-319` 改传 `loadInstancePackage(resolve(config.personaToml)).seeds` |
| D-3 合成包 | `fixtures/instance/seeds.toml` 一条合成 preference；`seed.test.ts` 断言 seedPersona 写入的正是它（content 全等、重跑单行、零种子写零行） |
| D-4 落地提示 | §7 |
| D-5 测试 | `instance.test.ts`：① 合成包 root/seeds 全等；② 无文件 → 0 条 + 相对路径归一；③ 一条 → 1 条内容一致 + 多类多条展平序；④ 空文件/空表/空数组 → 0 条；⑤ 损坏 → InstancePackageError（message 前缀 `<path> is not valid TOML: `）+ seeds.toml 是目录也抛；⑥ 形状不对七种 → 抛。`grep -rn MEMORY_SEEDS packages` = 0 |

## 3 · sha 变更表（G-2）

无。本单不碰任何提示词常量；`buildPersonaKernel` 不渲染 `interests`，SA-154 钉（367 / 72b48e63…）不变。

## 4 · 验收读数

| 项 | 基线（main@e5bbd16） | 本分支 |
|---|---|---|
| `npm test` | 1159 / 1148 / 0 / 11 | **1165 / 1154 / 0 / 11**（+6：instance.test.ts） |
| `npm run typecheck` | 净 | 净 |
| `grep -rn "MEMORY_SEEDS" packages` | 4 处 | **0** |
| `grep -rn "Kevin 用中文" packages/*/src` | 1（seed.ts:76） | **0** |
| 新增用例 | — | 6（≥3） |
| 触及 manifest 域 | — | **是**：src 文件 +1（`lykoi-decide/src/instance.ts`），改 3（decide seed.ts / index.ts，converse index.ts） |

## 5 · 偏离与执行方选择

1. **seeds.toml 形态 `[seeds]` 表而非 `[[seed]]`**：理由见 §2 D-1。语义等价（category × content 展平），且不引入第二个 TOML 解析路径。
2. **persona 夹具 `interests.seeds` 一并合成化**：E4-1 report §6 ④ 承诺"E4-2 一并做"。四词只被 `seed.test.ts` 按标题断言，已改读夹具；learn 的 l3/l5 用例里的"穿搭"是自由测试数据，与 persona 无关，未动。
3. **新错误类 `InstancePackageError`** 而非复用 `PersonaConfigError`：出错对象不是 persona，排障时一眼分得开。
4. seedPersona 仍不落审计事件（原本就没有）：零行为增量。

## 6 · 发现与候选

1. **产线 `seeds.toml` 不在完整性门的 manifest 里**：gate 只把 persona TOML 本身计入 root 域（`packages/lykoi-gate/src/manifest.ts:130`），目录级检查只查属主/不可写（`verify.ts:209-213`）。seeds.toml 若被改，门不响。归 **E4-5（实例事实静态门）**：存在时计入 root 域。
2. `docs/deploy.md` 尚无 seeds.toml 的安装说明（与 §6 ①、E4-1 的 `deploy.md:257` 失效路径一起归 E4-4 / 文档批）。
3. 只剩 `seedConcerns`（兴趣种子）读 persona TOML 自身的 `interests.seeds`，与实例包同源，无需搬。

## 7 · 落地要点（D-4）

1. **`seedPersona` 在产线启动路径上，证据**：`packages/lykoi-converse/src/index.ts:319`（converse 插件 `apply`，紧随 `getPersona(resolve(config.personaToml))` :313 之后），每次 converse 启动都跑。它只做 `upsertInsight`（`(category, content)` 去重，`lykoi-memory/rw.ts:1862`），从不删行。
2. **已诞生实例零影响的两条**：
   - Kevin **不放** `/home/lykoi/runtime/persona/seeds.toml` → `loadInstancePackage` 得零种子 → `seedPersona` 一行不写；产线 insights 表里现有那一行 `preference`（审计 A1 `seed.ts:75-77` 的原文）**原样留着**——框架层没有任何删除路径。这是缺省选项，落地不需要任何产线动作。
   - Kevin **放**该文件（内容 = 现有那一条，或空文件）→ upsert 按 `(category, content)` 去重，现有行命中 = no-op。**注意**：内容须与库里那行**逐字相同**（含全角逗号），差一个字符就是新增一行而非替换（审计 D.3）。文件须与 persona TOML 同属主同权限（`root:root 444`，目录 `root:root 755`）——门检查的是目录属主与不可写。
3. 损坏的 `seeds.toml` 会让 converse 启动即炸（`InstancePackageError`，姿态与 persona TOML 损坏一致）；这是有意的 fail-fast。
4. 落地形态：零迁移；manifest 重签（src +1）；可与 LANDING-S（#7）合批；EXPECT_OLD 仍 = 257a72e。
