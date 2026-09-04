# WO-E4-5 · 实例事实静态门 + CLAUDE.md 措辞（E4 第五批）

- 状态：**待派，排在 E4-1～E4-4 之后**。执行方：执行子 Agent。复核：主治理 Agent（改 gate 走治理复核）。
- 立单：2026-09-05，主治理 Agent。
- 依据：E4-SPEC §5（验收门提案）、§3.5、§4 表 E4-5；审计 A4、A6、B 表。
- 基线：WO-E4-3 与 WO-E4-4 均落地后的 main。分支：`wo/e4-5`。
- 包：`lykoi-gate`（新静态核）、`CLAUDE.md`。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 改 `packages/lykoi-gate/src` 是 root 域；新增的检查必须在 gate 自己的测试里有正反两例。
- 门只扫**运行时字面量**（`packages/*/src`、`profile/`、`deploy/` 的字符串常量与模板），不扫注释、不扫 `test/`、不扫 `governance/`。

## 1 · 事实

| 项 | 位置 | 事实 |
|---|---|---|
| gate 检查注册 | `packages/lykoi-gate/src/verify.ts:676` 附近（`state_canon` 等 check 的注册表） | 新核照此登记 |
| 现有词汇扫描样板 | `packages/lykoi-gate/src/vocabulary.ts:105-122`（`EMISSION_RE`、`scanTelemetryNames`） | 正则扫源码的既有写法 |
| token 表（第一版） | 审计 A1/A2 出现过的四个词：角色名 `Lykoi`（仅作为人名，不含包名/事件名/路径 `lykoi`）、所有者名 `Kevin`、代理 IP `192.168.0.202`、真实用户名 `Kevinwu901113`（README clone URL 除外） | 命中即 FAIL |
| CLAUDE.md | `CLAUDE.md:20,25,47,51` 四处 Kevin | 改"所有者"；治理角色表保留一处"本仓库当前所有者：Kevin" |
| 注释 158 处 | 审计 A6 | 不作验收项；门防的是新增运行时字面量 |

## 2 · 决定

- **D-1 新核 `instance_facts`**（`packages/lykoi-gate/src/instance-facts.ts`）：扫 `packages/*/src/**/*.ts`、`profile/*.yml`、`deploy/*`；剥注释（`//`、`/* */`、yml `#`）后对字符串字面量与模板字面量匹配 token 表；`Lykoi` 匹配用词边界且排除 `lykoi-`/`lykoi/`/路径前缀；例外清单只有 `README.md:99`（不在扫描范围，无需例外）。输出：命中文件:行:token；任一命中 → FAIL。
- **D-2 token 表是源码常量** `INSTANCE_TOKENS`，四项；注释写明"合成实例包的值（Fixture/Owner）允许出现在 test 与 fixture，不允许出现在 src"。
- **D-3 登记**：`verify.ts` 注册表加 `instance_facts`；`cli.ts` 输出行同其它核。
- **D-4 CLAUDE.md** 四处改"所有者"；角色表保留一处。
- **D-5 测试**：`packages/lykoi-gate/test/instance-facts.test.ts`：临时目录构造含/不含 token 的 src、注释里的 token 不算、`lykoi-adapter-telegram` 包名不算、yml 注释不算；对真实仓库跑一次 = 零命中（E4-1～4 落地后应零）。

## 3 · 边界

- 不改 manifest 逻辑、不改 ENV_PINS。
- 不扫 `docs/`（documentation_example 类由 E4-4 处理，门不管文档）。
- 不改 `docs/m*_blueprint.md` 的"Kevin 拍板"（治理史）。

## 4 · 验收

1. 全绿；gate 新核对真实树零命中。
2. 反例测试证明门能 FAIL。
3. 触及 manifest 域：是（gate src，root 域 → 落地重签）。

## 5 · 报告要求

按 brief §4。
