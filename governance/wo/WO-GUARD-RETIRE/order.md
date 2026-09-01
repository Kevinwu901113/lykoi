# WO-GUARD-RETIRE · 护栏的旧体条目退役（CORE-RETIRE 正本代码侧）

> 签发：2026-09-01（治理侧，事故驱动：退役三跑步 9 冷启失败，gate 检查项④
> 双 FAIL，她现停机等本单落地）。
> 执行形态：Mac 本地 Opus 子 Agent（工作副本 `~/Documents/lykoi/lykoi-cordis`）。
> 分支 `wo/guard-retire`，基 = main（动手前 `git log -1` 记录实际基）。

## 背景（事故链，已实证）

WO-CORE-RETIRE 三跑步 6 封存旧仓 `/home/lykoi/projects/lykoi` 后，新体冷启
被 gate 拒：`path guard over-blocks the workspace` + `path guard over-blocks
the new-body workspace`。链条：

1. `lykoi-kernel/src/policy-core.ts:81`：`PROTECTED_PATHS` 第二条
   `/home/lykoi/projects/lykoi/guardian` 是旧体 guardian，注释亲口预告
   「必须留到旧体退役之后（CORE-RETIRE 正本）」——退役已于 2026-09-01 完成，
   该条目的既定寿命到期，但退役单只做了 ops 侧，代码侧配套（本单）缺位。
2. `lykoi-kernel/src/path-guard.ts` 的 `isWithin` 是 SK-74 fail-closed：
   realpath 解析失败（**base 或 path 任一**）一律返回 true。旧 guardian base
   随封存消失后，**任何路径**对它都「在内」→ 整个护栏全封锁。
3. gate 检查项④（`verify.ts checkPathGuard`）的两条「不得误封」探针因此
   双 FAIL：旧工作区探针 `/home/lykoi/projects/lykoi/src/lykoi` 自身也已
   消失（自带 fail-closed），新体工作区探针被②的全封锁殃及。ExecStartPre
   拒启——**fail-closed 各层全部按设计履职**，本单只退役过期条目，不动机制。

## 治理定案

- **D-GD-1**：`PROTECTED_PATHS` 删除旧 guardian 条目，收敛为两条
  （`/home/lykoi/secrets`、`GATE_SOURCE_CANONICAL`）。注释改写为退役记录
  （保史：条目原文、寿命条款、2026-09-01 WO-CORE-RETIRE 到期退役），不是
  抹掉痕迹。归档区 `/home/lykoi/archive/old-body-20260901`（root:root 700）
  物理不可达，无需护栏条目接替。
- **D-GD-2**：检查项④的旧工作区探针换成退役后的等价物：
  `guard('/home/lykoi/state')` 必须为 false（canonical state 是新体必须
  可写的绝对落点，被封 = 护栏坏死）。其余三条探针逐字不动。注释同步
  （活体逐字保全的口径改为「前两条中 secrets 探针逐字保全；旧工作区探针
  随旧体退役换防」）。
- **D-GD-3**：「base 消失毒化全护栏」这一机制**不改**（SK-74 fail-closed
  正是这次把事故拦在门口的东西），但必须钉进测试与注释：path-guard 测试
  加一条机制钉——不存在的 base 对任意存在的 path 返回 true；policy-core
  注释明写「PROTECTED_PATHS 条目必须是机器上长存的路径，条目消失 =
  护栏全封锁 = gate 检查项④拦启动」。诊断改良（gate 逐 base 报
  unresolvable）刻意不做——检查项④已证明能拦，加注入面属范围蔓延。

## 判据（每判据一 commit，`[WO-GUARD-RETIRE]` 前缀）

① **kernel 条目退役**：policy-core.ts 实现 D-GD-1；policy-core.test.ts 的
   清单钉 3→2 条同步；path-guard.test.ts 加 D-GD-3 机制钉（不存在 base →
   对存在 path 返回 true，注明这是设计不是缺陷）。`isWithin` 与
   path-guard.ts 行为零改动。
② **gate 探针换防**：verify.ts checkPathGuard 实现 D-GD-2；其测试同步
   （合成 guard 注入面照旧）：须含一条**事故形态负例**——恒 true 的 guard
   （= 任一 base 不可解析的实网等价物）必须同时报出两条 over-blocks
   message（红形态即本次事故的可执行留痕）；`/home/lykoi/state` 探针的
   正负两态用例。
③ **全量收口**：`npm test` + `npx tsc --noEmit` 全绿；基线（main 现尖）
   tests 811 / pass 800 / fail 0 / skipped 11。新数字如实报，失败逐条归因。
   报告写 `governance/wo/WO-GUARD-RETIRE/report.md` 并入本 commit。

## forbidden

- 不动 `path-guard.ts`（`isWithin`/`classify` 行为与注释里的 SK-74 逐字条款）。
- 不动检查项④之外的任何 gate 检查；不动 `surface.ts`。
- 不动 converse / wake / decide / memory / heart / adapter。
- 不动 `profile/*.yml`；不新增依赖、不改 package-lock。
- 不碰 m4-switch；不 push。manifest 重签不归本单（policy-core.ts 与
  verify.ts 均在签名域，随落地稿 B 的 `--write-manifest` 一并重签）。
- 测试前台串行跑完再交卷（教训 23/44）。

## required_evidence

每判据 commit sha + diff 摘要；②的事故形态负例红→绿自证（红 = 现行代码 +
恒 true guard 复现两条 message；绿 = 换防后 `/home/lykoi/state` 探针语义）；
全量测试与 tsc 原样末尾输出。
