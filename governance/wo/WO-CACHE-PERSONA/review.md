# WO-CACHE-PERSONA · 复核记录（治理侧）

> 复核：2026-09-01，治理侧（Mac）。执行方 = Opus 子 Agent。
> **结论：PASS，零追认项。** ff 合入 main。

## 独立复验

- **全量复跑**（复核侧独立执行）：`npm test` 总账 tests 811 / pass 800 /
  fail 0 / skipped 11，退出码 0；`npx tsc --noEmit` 退出码 0。与执行方逐数
  一致。+3 全部 = persona-toml.test.ts 守卫用例 1→4 的净增；11 skip 分布同
  基线（LYKOI_DEVSTATE_DB 环境闸）。
- **改动面**：`git diff --stat main..wo/cache-persona` = 4 代码/测试文件 +
  report.md。forbidden 域（gate/kernel/adapter/memory/heart/profile/lockfile）
  零文件；唯一新增 import 是 Node 内建 `node:path`。
- **判据①**：守卫「先装载后落坑」序（loadPersona 抛出时 cached/cachedPath
  原样 null）实现失败不占坑；冲突 message 两个 path 俱在且测试逐字钉；
  归一化双向（先绝对后相对 / 先相对后绝对）都有用例。
- **判据②**：converse:203 / wake:414 迁移干净，import 面同步；侦查清单
  8 个经 apply 装载的测试进程全部单 path，结论「②不需清缓存」成立。
  顺带核到的关键产线事实：`cordis.prod.yml` converse 与 wake 的 personaToml
  是**同一个绝对路径** —— 守卫产线静默、两器官自此共享同一份内核对象，
  SA-156 从「文件恰好没变」升级为机制保证。
- **判据③**：红→绿自证完整（改前第二 path 静默拿回首个人格且零告警；
  改后 PersonaConfigError 双 path 可排障）。

## 口径说明一条（认可，非追认）

D-CP-3 的 `resetPersonaCacheForTest` 导出：②侦查结论是「无双好 path 形态、
②不需要」，但判据①自己点名的四条守卫用例共享同一模块级缓存，非 reset
不可（否则用例靠书写顺序活着，「失败不占坑」更是在热缓存下测不到目标分支）。
需求方是①而非②，执行方如实写明，符合「不为假想需求开口子」的本意。
生产路径零调用已由复核侧 grep 独立复核。

## 旁事处置

执行方报告作业期间工作区出现未暂存的 `governance/wo/WO-CORE-RETIRE/
paste-retire.sh` 修改：**归属治理侧**（退役稿首跑/二跑实录驱动的 v2/v3 修订，
治理侧在执行方作业期间直接编辑了共享工作副本——已确认执行方三个 commit 均
显式路径 add，未误收）。该文件随本复核后的治理 commit 单独入库。教训记档：
执行方在场时治理侧避免动共享工作副本，或改动后即刻知会。
