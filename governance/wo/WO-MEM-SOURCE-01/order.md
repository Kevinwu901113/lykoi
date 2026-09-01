# WO-MEM-SOURCE-01 · 记忆来源 epistemic 第二轴

- 签发：治理侧，2026-09-01（认知主线第二单；D-PERS-1，Kevin 同日拍板
  "同意"并发派令）
- 承接：执行 Agent（opus）
- 基线：main@9ec6189
- 设计正本：governance/docs/persona_layering_design_v1_2026-09-01.md §3.1。
  本单不重复设计；实现与设计稿冲突以设计稿为准，设计稿与代码实况冲突
  时停工上报。

## goal

experiences 获得认识论第二轴 `epistemic`
（`observed|executed|user_reported|inferred|imagined|simulated`），与渠道
轴 `source` 正交共存；「imagined/simulated 永不自动晋升为事实性自传记忆」
的铁律用测试钉死；存量数据有可回放的**渠道级**回填迁移件。

## scope

1. **侦查段（先做，写进报告）**：① mind_schema 版本机制实证——
   lykoi-memory/src/index.ts:209 "refuse to open, migrate governance-side
   first" 的确切判定逻辑与现行版本值；② experiences 现行 DDL（testing.ts
   夹具与 STATE-CONTRACT §1.2 对照，注明夹具出处行号）；③ 所有写入
   experiences 的调用点枚举（file:line + 各点现用渠道值）。
2. **数据轴**：`epistemic` 列（TEXT，CHECK 六值或 NULL；NULL=旧行未回填，
   读侧按渠道推导兜底）。写路径带默认推导（映射表逐字按设计稿 §3.1：
   `wake_action/action_result→executed`、`owner_event→user_reported`、
   `silence/environment/system→observed`、`thought_lapse→inferred`、
   `conversation` 按消息方向劈：对方产出→user_reported、她自己产出→
   executed）+ 显式覆盖参数（如 contemplate 产物可标 imagined）。
3. **迁移件**：治理侧幂等 SQL 脚本（ALTER TABLE 或版本升格，依侦查段①
   实证的机制择一并写明理由）+ 存量渠道级回填。**脚本只入库交付，
   不施加于任何真实 db**。
4. **晋升铁律**：读侧凡向装配/晋升通道供给"事实性"记忆之处，
   `imagined|simulated` 必须被排除——本单落"排除"的最小实现 + 测试；
   "带标引用"文案属后续单，不做。
5. **测试**：红绿 + 对照组——六值写读回、默认推导逐渠道各一、显式覆盖、
   NULL 旧行兼容、铁律（imagined 不得进事实性供给）+ 对照组
   （observed/executed 照常进）；全量不回归。

## forbidden

- 不动 `experiences.source` 既有八值 CHECK 与 `ExperienceSource` 类型
  （rw.ts:83，STATE-CONTRACT §1.2 逐字约束）。
- 不做内容级重分类/回填（内容级=变相编造，设计稿 §2 边界 4）。
- 不动 kernel/gate；prompt/ENVELOPE sha 逐字节不变。
- 迁移脚本不施加于任何真实 memory.db（含 var/ 下样本）。
- 若实现必须改动"拒开"版本契约的语义（而非仅登记一个新版本号），
  **停工上报**。

## success_criteria

侦查段三项实证齐（复核将独立对照）；数据轴+推导+覆盖+NULL 兼容全测；
铁律测试点名通过 + 对照组零误报；迁移脚本幂等可回放（重跑零副作用）；
全量对照基线 **839/828/0/11** 零新增失败；tsc 净。

## required_evidence

一次性报告：侦查实证（file:line）、diff 摘要、全量数字、新测试点名
输出、迁移脚本全文。前台串行，禁后台挂起交卷。分支 `wo/mem-source`
不 push、不合并，报尖 sha。
