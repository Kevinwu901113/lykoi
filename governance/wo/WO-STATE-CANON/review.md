# WO-STATE-CANON · 复核记录（治理侧）

> 复核：2026-09-01，治理侧（Mac）。执行方 = Opus 子 Agent。
> **结论：PASS，零追认项。** ff 合入 main。

## 独立复验

- **全量复跑**（复核侧独立执行）：`npm test` 总账 tests 808 / pass 797 /
  fail 0 / skipped 11；`npx tsc --noEmit` 退出码 0。与执行方逐数一致。
  +8 全部 = state-canon.test.ts 新增；11 skip 分布与基线同（LYKOI_DEVSTATE_DB
  环境闸）。执行方顺带订正了基线口径（800 = tests 总数而非 pass 数），采纳。
- **改动面**：`git diff --name-only main..wo/state-canon` = 12 文件；
  forbidden 域（kernel/adapter/converse/wake/decide/memory/heart/lockfile）
  diff 行数 = 0，实测。
- **prod yml 只加注释**：js-yaml 解析前后 JSON 全等，复核侧独立重验 = true。
- **判据①**：检查项⑧与②b checkResolutionLink 同构（symlink + realpath 断言，
  fail closed 三态 + 悬空/指错两分支）；`stateCanonical` 刻意不读 env（D-SC-1）；
  链接落址不参数化（repoRoot + STATE_LINK_REL，测的就是真会被写的位置）。
  **无 skip 开关**——侦查证实 verify() 全仓唯一非测试调用点 = cli.ts
  （ExecStartPre），生产判定由拓扑保证，dev 路径上没有门。此结论采纳并记档。
- **判据②**：deploy.md §4b 后果先行 + 三态说明；paste-1 §3b 硬断言
  （if/exit，教训 48 姿态），且 `ln -sfn` 撞既存真实目录会生成 var/state/state
  被 `[ -L ]` 当场逮住——**不静默覆盖已分叉目录**，与 D-SC-2 口径一致，
  这是刻意设计，复核认可。
- **判据③**：红→绿自证完整（5 负例先红：verify() 对五种分叉形态返回 0
  problems——正是本单消灭的缺口的可执行证据）。

## 执行方留档两条的处置

1. `docs/m4_handoff.md:180`「七检查项」→ 本波 m4_handoff 实质修订窗一并改
   （连同 :51「四条」），随落地稿 B 重签覆盖哈希。
2. D-SC-2 / D-SC-3 归落地稿 B 与退役稿（WO-CORE-RETIRE），按序执行。
