# WO-GUARD-RETIRE · 复核记录（治理侧）

> 复核：2026-09-01，治理侧（Mac）。执行方 = Opus 子 Agent。事故驱动单。
> **结论：PASS，零追认项。** ff 合入 main。

## 独立复验

- **全量复跑**（复核侧独立执行）：`npm test` 总账 tests 813 / pass 802 /
  fail 0 / skipped 11，退出码 0；`npx tsc --noEmit` 退出码 0。与执行方
  逐数一致。+2 = kernel 机制钉 1 + gate 正负两态 1，归因清楚。
- **改动面**：6 文件（kernel 源 1 + 测试 2、gate 源 1 + 测试 1、报告）。
  `path-guard.ts`（SK-74 本体）零改动——复核侧 diff 实测；surface.ts、
  其余七检查、converse/wake/decide、profile、lockfile 均未动。
- **判据①**：PROTECTED_PATHS 收敛两条；退役记录保史（条目原文 + 原注释的
  寿命条款 + 到期缘由）；**条目寿命纪律**（base 消失 = 全封锁 = 检查项④
  拦启动）写进表头注释——正是本次事故的教训固化位。
- **判据②**：探针换防用 STATE_CANONICAL（surface.ts 既有导出，与检查项⑧
  同一 canonical 源，单一出处）；message 随语义改为 `over-blocks the
  canonical state dir`（执行方如实留档，认可——探针对象换了，message 撒谎
  才是问题）；其余三条探针逐字未动。
- **判据③红→绿的关键发现**（采纳并记档）：Mac 上 `/home/lykoi/*` 全不存在，
  基线码的真 isProtectedPath 天然等价于「任一 base 不可解析」的实网形态——
  执行方在本机对基线码复现出与生产冷启**逐字相同**的两条 FAIL message。
  事故的可执行留痕由此双份：机制钉（kernel）+ 事故形态负例（gate）。
- **D-GD-3 机制钉**：不依赖本机真实路径（临时目录自造 base），并把毒化沿
  classify 传播、以及「正向两条断言在全封锁下反而满足」这个自欺形态一并
  钉住。谁要松 fail closed 先撞测试。

## 交接事项（归落地稿 B，非追认）

policy-core.ts 与 verify.ts 均在签名域：服务器落地须 root `--write-manifest`
重签后检查项⑤才过——已排入落地稿 B 步 5，钉点树含本单即自动覆盖。
