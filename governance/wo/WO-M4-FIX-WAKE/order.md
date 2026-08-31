# WO-M4-FIX-WAKE · 切换窗事故修复：wake 配置面定案 + learn 占位条目退役

> 签发：2026-09-01（治理侧，Kevin 口头授权"写出来自己开工"）。
> 执行形态：Mac 本地 Opus 子 Agent（工作副本 `~/Documents/lykoi/lykoi-cordis`），
> 非服务器无头派发。分支 `wo/m4-fix-wake`，基 = main `0db2183`。

## 背景（事故记录）

2026-09-01 00:54 切换窗：新体 lykoi-cordis 首次以 m4-switch 装配（`ebaeda8`）
起立，loader 阶段 AggregateError 未捕获、进程退出——**旧体已停、新体起不来**。
两条根因均为 m4-switch 翻位 commit 把「从未可启用的占位条目」一并翻开：

1. `wake (lykoi-wake)`：`$.persona missing required value`。
   `packages/lykoi-wake/src/index.ts` Config 的 `persona` 必填（raw persona
   数据面），prod yml 只有 dbPath/route/model/checkIntervalMs。插件头注明写
   "wake 入 profile 时由治理配置面决定改配 personaToml 路径"（W3 TODO⑤ 悬案），
   悬案未决即被翻开。
2. `learn (lykoi-learn)`：`invalid plugin, expect function or object with an
   "apply" method`。lykoi-learn 是纯库（re-export 桶，无 apply），消费者是
   wake（SA-171 整合/专注由 wake 串行驱动）。loader 条目本身就是错的。

止损（另行，root）：服务器 yml 两条恢复 disabled + 重签 + 重启。本单是完全修法。

## 治理定案（随单记录，落地即定案）

- **D-FIX-1**：wake 配置面改 `personaToml` 路径，**镜像 converse**
  （`loadPersona(resolve(config.personaToml))`，SA-156 fail-fast，同源同返回
  类型 PersonaConfig）。raw `persona` 配置面**取消**——profile 内联 persona
  数据 = 复制 root 属主 TOML 的第二事实源，违单一出处。W3 TODO⑤ 就此定案。
- **D-FIX-2**：`learn` 条目从 prod profile **整条删除**。不给 lykoi-learn 造
  插件壳——它的驱动位在 wake（SA-171），库形态是结构定案不是缺件。
- **D-FIX-3**（治理侧自留，不在本单范围）：m4-switch 重钉 = 新 main + 六器官位
  翻开；`grep -rn ebaeda8` 全部引用点更新（runbook/paste-1/approval-briefing）。

## 判据（每判据一 commit，`[WO-M4-FIX-WAKE]` 前缀）

① **wake 配置面**：`packages/lykoi-wake/src/index.ts`
   - Config：`persona: Schema.any().required()` → `personaToml:
     Schema.string().required()`；接口注释与文件内 W3 TODO⑤ 相关注述同步改写
     （引用本单定案，不留悬案字样）。
   - apply：`parsePersonaData(config.persona)` → `loadPersona(resolve(
     config.personaToml))`（import 从 lykoi-decide 调整；parsePersonaData 若
     再无使用点则从 import 清单去除）。
   - 装载失败姿态 = loadPersona 既有姿态（文件缺失/坏 TOML → PersonaConfigError
     启动即炸），不包不吞。

② **测试迁移与负例**：
   - 经 Config/apply 走插件全链的测试（plugin.test.ts 等）：新建
     `packages/lykoi-wake/test/fixtures/persona.toml`（内容 = TEST_PERSONA 等价
     形态，**必须落在 lykoi-decide TOML 子集解析器能力内**），config 改喂路径。
     直接调纯函数、不经 Config 的测试（learn-e2e 等喂 TEST_PERSONA 对象的）
     **不动**。
   - 新增负例：缺 personaToml → Config 校验拒绝；personaToml 指向不存在路径 →
     apply 抛 PersonaConfigError（对齐 converse 侧同型测试的既有写法，如有）。

③ **prod profile**：`profile/cordis.prod.yml`
   - wake 块补 `personaToml: /home/lykoi/runtime/persona/lykoi_base.toml`
     （`disabled: true` 保持——翻位永远只在 m4-switch）；
   - `learn` 条目整条删除；"自主侧（wake / learn）"注释块改写：learn=库，
     由 wake 经 SA-171 驱动，不设 loader 条目。

④ **全量收口**：仓库根 `npm test`（workspaces 全量）+ `npx tsc --noEmit` 全绿；
   基线 797 通过 / 0 失败（W1 时点，主 main 可能略有出入，以实跑为准），
   新数字如实报，任何失败逐条归因（注意 [[lykoi-test-clock-timebomb]]：
   单点无常失败先查真实时钟 vs 夹具日期，再查回归）。
   报告写 `governance/wo/WO-M4-FIX-WAKE/report.md` 并入本 commit。

## forbidden

- 不动 `packages/lykoi-learn/` 任何文件（不造 apply 壳、不改导出面）。
- 不动 kernel / gate / heart / converse / decide 等邻接包（decide 只 import
  不改）。
- 不动 `profile/cordis.yml`（dev 无 wake 条目，维持）与 `profile/index*.ts`。
- 不新增依赖、不改 package-lock。
- 不碰 m4-switch 分支（D-FIX-3 归治理侧复核后做）。
- 不 push（推送归治理侧）。
- 测试前台串行跑完再交卷；"还在跑"不是"跑完"（教训 44）。

## required_evidence（报告最低集）

- 每判据的 commit sha 与关键 diff 摘要。
- 全量测试与 typecheck 的**原样末尾输出**（数字 + 失败清单，若有）。
- 负例测试红→绿的自证（先证会拒，再证修后行为）。
- fixtures/persona.toml 与 TEST_PERSONA 的字段对应说明（哪些字段有意省略）。
