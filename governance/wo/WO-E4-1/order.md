# WO-E4-1 · 合成测试实例包与七份夹具收敛（E4 第一批）

- 状态：**已完成，待合并**（2026-09-05；分支 `wo/e4-1`，代码 0242a43，report 见同目录 `report.md`）。执行方：主治理 Agent 自执行（Kevin 令：不派 GPT）。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-A（框架/实例分离立项，E4-SPEC 先行）；`governance/docs/e4_spec_framework_instance_separation_draft_2026-09-04.md` §3.4、§4 表 E4-1；`governance/docs/instance_fact_audit_2026-09-04.md` A3。
- 基线：`main@c557af2`。分支：`wo/e4-1`。前置：无。**零运行时改动**（只动 `test/` 与夹具）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 这是一次性 sha 变更批：persona 内核钉面 `chars=401 sha=1f5960b7…`（`packages/lykoi-decide/test/prompt.test.ts:35-40`，输入 `buildPersonaKernel(FIXTURE_PERSONA)`）会因夹具内容改变而变，**允许**，走 G-2 sha 变更表。`DECIDE_SYSTEM_PROMPT`、converse 各常量的钉面**不得变**（它们不吃夹具）。
- 合成值：`name = "Fixture"`、`partner = "Owner"`、`embodiment = "test VM"`、自述改为明显合成的一段（不含真实主机名、vmid、真实人名）。不要把新夹具写得像一个真实的人。

## 1 · 事实

| 项 | 位置 | 事实 |
|---|---|---|
| 七份副本 | `packages/lykoi-converse/test/fixtures/persona.toml`（sha `c9627b8b…`）；`packages/lykoi-decide/test/fixtures/lykoi_base.toml`（与上逐字节同）；`packages/lykoi-wake/test/fixtures/persona.toml`（独立小型，`embodiment="test VM"`）；TS 常量 `packages/lykoi-decide/test/persona-fixture.ts` `FIXTURE_PERSONA`、`packages/lykoi-converse/test/fixture.ts` `FIXTURE_PERSONA`、`packages/lykoi-wake/test/fixture.ts` `TEST_PERSONA`、`packages/lykoi-learn/test/fixture.ts` `PERSONA`（仅 name+partner） | 内容 = 第一实例（name=Lykoi / partner=Kevin / embodiment="lapwing-home VM (vmid 110)"） |
| 字符串写死断言 | `packages/lykoi-decide/test/persona-toml.test.ts:128,157,159,169`（`'Lykoi'` / `'NotLykoi'`） | |
| 钉面 | `packages/lykoi-decide/test/prompt.test.ts:35-40`（401 / `1f5960b7…`）；`packages/lykoi-converse/test/assemble.test.ts` 若有 persona 渲染 sha（执行方核） | 随夹具变 |
| 自述来源 | `docs/deploy.md:257-258` 自认这份 TOML "写的是另一个个体，不是给你搬去生产的" | 文档已承认，代码层未跟进 |

## 2 · 决定

- **D-1 一份 TOML**：`packages/lykoi-decide/test/fixtures/instance/persona.toml`（合成值）；converse 与 wake 的 TOML 副本删除，测试改为读这一份（相对路径经 `import.meta.url` 解析；跨包读夹具若被 workspace 布局阻碍，则在各包保留一个**逐字节复制**并加一条对拍测试断言三份 sha 相同——执行方选，report 说明）。
- **D-2 TS 常量由 TOML 派生**：四个 TS 常量改为 `loadPersona(<夹具路径>)` 的结果或与之逐字段对拍的测试；不再手写第二份真相。`lykoi-learn` 的 `PERSONA` 只需 name/partner，从同一夹具取。
- **D-3 字符串断言改读夹具**：`persona-toml.test.ts:128,157,159,169` 用 `FIXTURE.identity.name` 与 `FIXTURE.identity.name + '_other'`。
- **D-4 sha 变更表**：`prompt.test.ts:35-40` 新 chars+sha；report 贴旧→新。
- **D-5 目录名** `fixtures/instance/` 是"合成测试实例包"的雏形（E4-2 往里加 `seeds.toml`，E4-4 加 `deploy.toml`）。

## 3 · 边界

- 不动 `packages/*/src`。
- 不动 `docs/`、`profile/`、`deploy/`。
- 不改 `DECIDE_SYSTEM_PROMPT` 及 converse 常量钉面。

## 4 · 验收

1. 全绿；`grep -rn "Kevin\|lapwing\|vmid" packages/*/test` 剩余命中只在与"第一实例"无关的注释（report 贴前后计数；审计 B 表为基线）。
2. 夹具副本数 7 → 1（或 1 + 对拍副本，说明原因）。
3. sha 变更表一行。
4. 触及 manifest 域：否。

## 5 · 报告要求

按 brief §4。
