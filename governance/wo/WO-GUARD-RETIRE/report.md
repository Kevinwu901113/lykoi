# WO-GUARD-RETIRE 执行报告

> 执行：2026-09-01，Mac 本地 Opus 子 Agent，工作副本 `~/Documents/lykoi/lykoi-cordis`。
> 分支 `wo/guard-retire`（不切回 main、不 merge、不 push、未碰 m4-switch）。

## 0. 实际基

```
de4887b23977c79e499f054736e44510bf53c256 [治理][WO-GUARD-RETIRE] 签单：护栏旧体条目退役（事故驱动，CORE-RETIRE 正本代码侧）
```

= 签单预期的 main 尖（`de4887b`）。动手前工作树干净（`git status --short` 空）。
基线自测复核（未改动任何文件时跑一遍 `npm test`）：**tests 811 / pass 800 /
fail 0 / skipped 11，退出码 0** —— 与签单基线逐数一致。

## 1. 判据①：kernel 条目退役（D-GD-1 + D-GD-3 注释与机制钉）

**commit `841e74536d1236584f983808694a794a16e17fa8`**

```
 packages/lykoi-kernel/src/policy-core.ts       | 36 +++++++++++++++++-------
 packages/lykoi-kernel/test/path-guard.test.ts  | 39 ++++++++++++++++++++++----
 packages/lykoi-kernel/test/policy-core.test.ts | 20 +++++++------
 3 files changed, 71 insertions(+), 24 deletions(-)
```

diff 摘要：

- `policy-core.ts`：`PROTECTED_PATHS` 删 `/home/lykoi/projects/lykoi/guardian`，
  收敛为两条 —— `'/home/lykoi/secrets'` + `GATE_SOURCE_CANONICAL`。表上方注释
  改写为**退役记录**：抄录原条目路径与它自己写下的寿命条款（「必须留到旧体退役
  之后（CORE-RETIRE 正本）」）、到期缘由（WO-CORE-RETIRE 2026-09-01 封存旧仓）、
  归档区 `/home/lykoi/archive/old-body-20260901`（root:root 700）物理不可达因而
  无需条目接替。保史不是抹痕：删的是过期条目，那段历史留在注释里。
- 同处新增 **D-GD-3 条目寿命纪律**（原文入注释）：条目必须是机器上长存的路径；
  一条 base 从磁盘消失不是这一条失效，而是 `isProtectedPath` 恒 true = 护栏全
  封锁 = gate 检查项④拦启动。模块头注里「GK-13 第三条禁区」的表述随之校正为
  「重划的那条禁区（退役后是第二条）」。
- `policy-core.test.ts`：清单钉 3→2 条；「活体两条逐字保全」拆成「secrets 条
  逐字保全」+「退役后收敛为两条」，后者额外显式钉
  `PROTECTED_PATHS.includes('/home/lykoi/projects/lykoi/guardian') === false`。
- `path-guard.test.ts`：清单钉同步 3→2；新增 **D-GD-3 机制钉**
  「base 不存在 → 对任意存在的 path 判 true」——用 tmpdir 里自造的、从来没建过的
  base（不依赖本机有没有 `/home/lykoi/*`）对两条真实存在的 path 断言 true，并钉
  毒化沿 `classify` 传播（任一 base 命中即 deny），注明这是 SK-74 的设计方向而
  非缺陷，修法是退役过期条目、不是松开 fail closed。

**`path-guard.ts` 零改动**（`isWithin` / `classify` 的行为与 SK-74 逐字注释一个
字节没动）。判据①落地后：kernel 194 / pass 194 / fail 0（基线 193，+1 = 机制钉），
gate 71 全绿（此时探针尚未换防，生产语义替身对旧工作区路径答 false，故仍绿）。

## 2. 判据②：gate 检查项④探针换防（D-GD-2）

**commit `0ced24b3c456efb0d59f2125228c099c2519f625`**

```
 packages/lykoi-gate/src/verify.ts             | 22 ++++++++++++++---
 packages/lykoi-gate/test/gate-checks.test.ts  | 35 +++++++++++++++++++++++++--
 packages/lykoi-kernel/test/path-guard.test.ts |  3 ++-
 3 files changed, 53 insertions(+), 7 deletions(-)
```

diff 摘要：

- `verify.ts checkPathGuard`：第二条探针
  `if (guard('/home/lykoi/projects/lykoi/src/lykoi'))` →
  `if (guard(STATE_CANONICAL))`（`STATE_CANONICAL = '/home/lykoi/state'`，本文件
  原就 import 了它，**未动 `surface.ts`**）。message 随探针改为
  `path guard over-blocks the canonical state dir`（仍是 over-blocks 形态）。
  其余三条探针（secrets / 门自身 / 新体工作区）连同各自 message **逐字不动**。
- 注释同步：活体逐字保全的口径改为「secrets 探针逐字保全；旧工作区探针随旧体
  退役换防」，并写下换防缘由（旧探针路径自身消失后带上 SK-74 fail closed 自毒 =
  恒红 = 失去判别力；canonical state 是新体必须可写的绝对落点，被封 = 护栏坏死，
  与原探针同一问法且与新体同生共死）与事故门前留痕。
- `gate-checks.test.ts`：原「守卫写太宽」红测升格为**事故形态负例**（见下）；
  新增「canonical state 探针正负两态」用例。合成 guard 注入面照旧，未引入任何
  真实路径依赖。
- `path-guard.test.ts`：那条讲「检查项④在开发机上的行为」的示例断言，路径由已
  退役的旧体工作区换成换防后的 `/home/lykoi/state`（同一条 fail-closed 语义，
  只是不再引一个不存在的旧地址）。

### 2.1 事故形态负例：红 → 绿自证

**红（基线码 `de4887b` + 恒 true guard，= 任一 base 不可解析的实网等价物）** ——
在本机直接跑 `checkPathGuard`：

```
PROTECTED_PATHS = ["/home/lykoi/secrets","/home/lykoi/projects/lykoi/guardian","/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate"]
恒 true guard → 2 条:
  - path guard over-blocks the workspace
  - path guard over-blocks the new-body workspace
本机真 isProtectedPath（/home/lykoi/* 均不存在 = base 消失实网等价）→ 2 条:
  - path guard over-blocks the workspace
  - path guard over-blocks the new-body workspace
```

两条 message 与生产冷启失败**逐字同形**（`path guard over-blocks the workspace`
+ `path guard over-blocks the new-body workspace`）。注意第二跑：Mac 上
`/home/lykoi/*` 全不存在，真守卫的行为与「生产上旧 guardian base 被封存后」完全
同构 —— 事故在本机可复现，不是推理。

**绿（判据①②落地后，生产语义替身 = 退役后的两条表 + 纯前缀判定）**：

```
PROTECTED_PATHS = ["/home/lykoi/secrets","/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate"]
guard('/home/lykoi/state') = false
guard('/home/lykoi/secrets/llm.env') = true
guard('/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/src/verify.ts') = true
guard('/home/lykoi/projects/lykoi-cordis/packages/lykoi-kernel/src') = false
检查项④ → 0 条问题 []
恒 true guard 仍报 → 2 条:
  - path guard over-blocks the canonical state dir
  - path guard over-blocks the new-body workspace
```

即：条目退役后守卫恢复分辨力，四条探针全部答对，检查项④零问题；而**恒 true 的
守卫依旧被逮住两条** —— 门没有被削软，只是不再被一个过期条目自伤。红形态因此以
可执行用例的形式留在 `gate-checks.test.ts` 里（断言两条 message 同时出现，且红的
只会是 over-blocks 那一半：全封锁下「护住 secrets」「护住门自身」两条正向断言反而
是满足的，护栏坏死的自欺就长这样）。

判据②落地后：gate 72 / pass 72 / fail 0（基线 71，+1 = 正负两态用例）。

## 3. 判据③：全量收口

### `npm test`（仓库根，前台串行跑完，退出码 0）

逐包汇总（16 个 workspace 的 `ℹ` 行求和）：**tests 813 / pass 802 / fail 0 /
cancelled 0 / skipped 11 / todo 0**。

与基线（811 / 800 / 0 / 11）的差：**tests +2、pass +2、fail 0、skipped 不变**，
逐条归因：

| 增量 | 归属 | 用例 |
| --- | --- | --- |
| +1 | 判据① | `lykoi-kernel` 193→194：D-GD-3 机制钉（不存在 base → 对存在 path 判 true） |
| +1 | 判据② | `lykoi-gate` 71→72：canonical state 探针正负两态 |

**fail = 0，无需归因；skipped 11 与基线同（`lykoi-converse` 1 + `lykoi-learn` 1 +
`lykoi-memory` 9），本单未新增或消解任何 skip。**

各包末数：adapter-telegram 55、audit 3、budget 5、converse 94(skip 1)、decide 69、
**gate 72**、heart 14、**kernel 194**、learn 68(skip 1)、llm 3、llm-deepseek 5、
memory 80(skip 9)、reflow 31、regulation 45、snapshot 49、wake 26。

原样末尾输出（最后一个 workspace 的收尾块）：

```
✔ SA-171：失败拍不驱动整合/专注 (15.386959ms)
✔ rest 拍端到端：安静合法、demote 不发生、计数为零 (24.090625ms)
✔ 推演零写入（SA-47）+ 对照组（SA-48）：read→candidates→messages→evaluate 全程零写 (37.29425ms)
✔ 同一时刻两次 read 逐字段相同 + 均零写（分发给 N 个分支的前提，DA-10 唯一前提） (319.640167ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 688.543625
```

### `npx tsc --noEmit`（仓库根）

原样输出：**空**（零字节，一行都没有）。退出码 **0**。

## 4. 偏离与边界

- **零偏离**。forbidden 逐条自查：`path-guard.ts` 未动（行为与注释均零改动）；
  检查项④之外的 gate 检查零改动、`surface.ts` 零改动（只 import 其常量）；
  converse / wake / decide / memory / heart / adapter 零改动；`profile/*.yml`
  零改动；无新增依赖、`package-lock.json` 零改动；未 push、未切回 main、未 merge、
  未碰 `m4-switch`；manifest 未重签（`policy-core.ts` 与 `verify.ts` 均在签名域，
  随落地稿 B 的 `--write-manifest` 一并重签 —— 不归本单）。
- 两处签单未逐字点名、但属判据内配套的改动，在此明列：
  1. 判据②把检查项④第二条 message 由 `path guard over-blocks the workspace` 改为
     `path guard over-blocks the canonical state dir`（message 跟着探针走；仍是
     签单 required_evidence 要求的 over-blocks 形态，两条负例断言据此写）。
  2. 判据②顺手把 `path-guard.test.ts` 里那条讲检查项④开发机行为的**示例路径**从
     已退役的旧体工作区换成 `/home/lykoi/state`（断言语义不变，只是不再引用一个
     已经不存在的地址）。
- 本机纪律：`/home/lykoi/*` 在 Mac 上不存在，所有 gate 侧用例照旧走合成
  `env.isProtectedPath` 注入；D-GD-3 机制钉用 tmpdir 里自造的不存在 base + 真实
  存在的 path，不依赖本机真实路径解析。
- **生产落地提示（不在本单执行范围内）**：`policy-core.ts` 与 `verify.ts` 都在
  签名域，服务器上必须 root `--write-manifest` 重签后 ExecStartPre 才能过检查项⑤。
