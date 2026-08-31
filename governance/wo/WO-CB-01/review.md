# WO-CB-01 复核 · C-B 心脏第一单(心跳影子 + 调度地基)

- 复核人：治理 Agent（主窗口）
- 复核日期：2026-08-22 晨
- 级别：必要检测级
- 执行情况：三波（两次假完成 + 第 3 波单次 EXIT=0 全交付，3h39m）
- **结论：PASS（追认项 1 条，见 §4）**

## 1. 合规核

- 尖 `8dad2770`，基 `32238013`，11 commit 每判据一个，工作树干净。
- **足迹独立核查**：15 文件 = 7 源（autonomous/heartbeat 新/llm_client/llm_router/
  focus/integrator/snapshot）+ conftest + 6 测试 + manifest，全在工单范围。
- **封存区零 diff 独立确认**：decide.py、conversation*、telegram*、kernel/、
  core/、guardian/*.py 全空——判据⑨的零扰动主张成立；对话侧归因刻意不做
  （kernel 下两调用点是规则禁止，报告如实分类）。
- forbidden 全项遵守；步 3/4、节律迁移（D-CB-3）、Core attention 均未越界。

## 2. 独立验证

- **套件复跑**（6 个新套件 + 邻接 test_p4_autonomy + test_mind_beat）：
  **95 passed / 0 failed**（4m05s）。
- **manifest 独立重算**：113 条全部核毕——107 条脚本直核 + 5 条 guardian 裸名
  补核 + 1 条 owner 域沿签（approval_rules.json，与历代口径一致），**0 差异**；
  112→113 的唯一新增 = `cognition/heartbeat.py`（新受保护模块入册，正确）。
- 全量对账采信执行方 2224/3/6（= 基线 2169/3/6 + 55，collect 2233=2178+55
  精确闭合）；3 条失败全部在基 `32238013` 干净 worktree **现场复现**（不是引用
  基线数字）——p0 假失败 + core_v1_shadow 两条（实为 AttributeError 形态，
  见 §4 注）。**新增失败 0。**

## 3. 决审要点

- **步 0 双向证据**：GREEN/RED 两场景 harness + 四表逐行 sha256 逐字节相同；
  "推演零写入"断言先红后绿（红即步 0 必要性证据，C-A §7.3-3 的设计意图落实）。
- **R-CA-1 修复的负例**质量高：真 wake + 恒 rest 桩证明"恰好 1 次调用且 cap
  读数为 0"——把 C-A 风险 B 的"cap 救不了场"钉成了直接证据。
- **心跳件三条硬性质都有测试**：零 LLM（AST 级）、零表写、不读发言权
  （D-CB-1 的分叉构造用例——读错字段结论就反）。
- **日志有界方案**：只在 would_wake=true 落账 → 硬上限 288/日/series，
  期望 ~96/日两序列合计；sidecar 可用性只在翻转落。刷屏风险闭合。
- **ContextVar 归因改法**优于工单原设想（形参加法破坏五处既有测试替身），
  第 2 波修正 commit 自证。
- **偏差 2 条均据实交代、理由成立**：eq_before.json 旧哈希器不可比（改为
  干净树现算 + 双跑自决定性证明——这比直接引用更强）；core_v1_shadow 基线
  失败形态与教训 38 预期不符（AttributeError 非 TimeoutError），执行方仍按
  要求串行复跑 + 基树复现双重定性。

## 4. 追认项与新知（呈 Kevin）

1. **追认**：偏差 1（eq_before 改现算）——建议追认，方法更严。
2. **新知（非本单缺陷，入总账）**：基线 3 失败中 core_v1_shadow 两条的**稳态
   形态是 `kernel.redaction._SECRETS` AttributeError**（用例与代码脱节），与
   GW-02 实证的"负载浮动 TimeoutError 带"是**两种不同的既有病**。两报告合并
   看：该文件既有顺序依赖又有脱节断言——**测试隔离收敛单（GW-01 遗留③）
   优先级上调**，且其失败数不宜再作回归基线成分（GW-02 §10.5 附议）。

## 5. 交接采纳

步 3/步 4 交接清单（报告 §步 3/4）采纳为切换单设计输入；其中**费用画像的
kernel 侧授权缺口**（suggestion_conversation 未归因）与**心跳件持久拍钟决策**
两条列入步 3 工单必答题。影子读数查询口径（jq 五条）随本报告归档，治理侧
按日读数自 A 段落地起算。
