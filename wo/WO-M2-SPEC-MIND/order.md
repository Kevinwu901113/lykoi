# WO-M2-SPEC-MIND · 心智侧行为规格提取（只读审查单）

你是 Lykoi 治理平面的执行 Agent。背景：Lykoi 整体移植到 Cordis(TS/Node) 运行时，M1 骨架
已成（心跳/审计/预算/只读记忆/适配器/管线对话环）。M2 = 心智移植。对话路径规格已由
WO-M0-SPEC-CONV 交付（94 条）；**本单交付其姊妹篇：自主侧与学习环的行为规格**，是新体
lykoi-decide / lykoi-assembler / lykoi-learning 各插件的验收基准。语义逐条、契约逐字。

## 基线与工作区

- 工作区 `~/lykoi-work-m0/` = 活体 HEAD `4463ae8`（tag cordis-night-20260822）文件树只读
  副本（无 .git）。行号以副本为准。已知副本缺 5 个 0600 不可读 .py（R2c 产物），涉及处标注。
- 零写入、不碰 `/home/lykoi/`、不读 state/secrets、不跑 pytest。报告走 stdout。

## deliverables（报告七节，编号固定）

1. **自主侧决策契约逐字**：`mind/decide.py`——KINDS 7 项、CONTENT_REQUIRED、safe_kind、
   `Decision` 全字段；`DECIDE_SYSTEM_PROMPT` 的 file:line 范围+字符数+sha256；
   `build_candidates` 的**全部**动态规则（预算耗尽摘 kind、prefer_rest、force_inner_tending、
   探索饥饿棘轮 EXPLORE_STALL_OVERRIDE、权重与成本文案）逐条；`next_wake_after_minutes`
   契约与 clamp_rest（D-CB-1 已定发言权收回，注明现状 vs 定案差异）；demote/fail-closed
   护栏与对话侧共用部分只引用 SPEC-CONV 条目号不复述。
2. **快照装配（自主侧）**：CB-01 劈分后的现状——`snapshot.maintain()` 四维护写与
   `read()`/`assemble()` 边界；快照全部块的内容来源函数、顺序、每块字符预算/裁剪常量；
   注意力域（念头/关切/叙事线 id 注入集）的产生点。
3. **reflow 七 kind 逐支**：`execute_and_reflow` 每个 kind 的执行体、副作用清单、
   counts 口径（哪些计 action）、经验写入形态（wake_action/action_result 的 content 模板）、
   `_light_grounded_concerns` 二次活体校验语义；推演/回流切分边界与"推演零写入"断言测试
   的现状（CB-01 产物）。
4. **调节场逐字**：`mind/regulation.py`——四变量、15 个 CAUSES 的名字+delta 值**逐字表**、
   衰减/回归基线算法、cognitive_effects 阈值与效果（force_inner_tending/prefer_rest 的
   触发值）、单写者纪律。
5. **学习环 L1–L5**：L1 `experience_class.classify` 规则逐字；L2 integrator——触发闸
   （wakes_since/pending/load early）、容量 K、取料查询（水位线∩未消化∩原料池）、
   prompt sha256、narrative_class 语义、消化后写集（narrative/threads/concerns/
   regulation/experiences 标记）；L3 `relevance.retrieve_for_concern` 三轴打分纯函数
   逐字（权重/衰减/上限）；L4 focus——周期全流程（选择/召回/防自恋反刍闸/冷却/
   insight 状态机 shadow→active→contested→revised→withdrawn/血缘/影子门下游
   promoted_focus_insights）、prompt sha256；L5 suggestions——dedup_key 派生规则、
   入队条件、问询节律。
6. **persona 与身份装配**：`cognition/config.build_persona_kernel`、`memory/persona.
   build_persona_prompt` 投影规则（category 白名单）、`organs.build_organ_block` 纯函数
   出入口、restart 叙事（`render_restart_notice`——M4 停机切换将以此呈现"长睡眠"，逐字）、
   种子（mind/seed、memory/seed）内容形态。相关 prompt 全部 sha256。
7. **自主行为规格总表**（最终交付物）：SA-01..SA-NN 逐条编号，一句话语义+file:line+
   三档标注【必须逐字迁】/【语义等价即可】/【已知缺陷/已定改法按新版】（后者含
   D-CB-1/2/3 定案、R-CA-1 双护栏、层1/2 节律锚 wake 计数 vs 墙钟的定案）。预计 60–100 条。
   缺陷/定案改法条目 DA- 前缀单列。

## success_criteria

七节齐；断言带 file:line；[事实]/[推断]/[建议] 标注；全部 prompt 有 sha256；§7 逐条可独立验证。

## 纪律（逐字遵守）

- stdout 即报告本体，不要聊天式摘要。
- 全程前台串行，禁止后台；不跑 pytest；完成=七节打印完毕。
