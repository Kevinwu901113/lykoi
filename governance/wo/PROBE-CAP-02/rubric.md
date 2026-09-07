# C2 评分与隔离协议（evaluation / non-normative）

G0 输入逐字取 C1 P3 三目标。G1 沿用 C1 临时 delegate 契约，加明确委托指令；persona on/off × 3目标 × 2重复，固定 low。G2 仅收到对应 input.txt，不读取原目标、其他试次、评分答案或本对话上下文。每次在新任务上下文及独立目录执行，使用相同模型、工具面、研究日期与时间上限；实验管理员负责实际隔离。runner 只组织目录和校验记录，不提供 OS 沙箱或清空模型上下文。

每次保留 `input.txt`、`transcript.jsonl`（逐步调用/结果或可审阅会话导出）、`deliverable.md`、`score.json`。记录执行模型、工具面、开始/结束时间、步骤数、网络缺口。缺数据明确标缺，不凭估计填表。使用公开来源；真实 persona、凭证及产线数据不进入交付物或 Git。

交付物五项各0/1/2：覆盖全部目标限定、每格有出处、抽查三格无编造、结构符合目标、缺数标缺。独立复核者填写 reviewer 与五个 evidence 引用（具体段落/来源），不能用 runner 计算结果代替人工核验。说明充分度五项各0/1/2：目标复述、完成判据、边界禁止、所需输入、交付形态。

score.json 形态：

```json
{"criteria":[0,0,0,0,0],"reviewer":"待复核者填写","evidence":["待填","待填","待填","待填","待填"],"instruction_score":0,"elapsed_seconds":0,"steps":0}
```

以上零值仅形态示例，不是任何真实评分。G0 不需 instruction_score。整体 tax 为 G0均分−G2均分；persona分组同理。说明≥7子集使用相同case的G0配对平均差，避免样本筛选改变目标权重；空子集为null。缺失/失败样本不给零分冒充执行结果，完整实验未齐则拒算，并另列失败率。
