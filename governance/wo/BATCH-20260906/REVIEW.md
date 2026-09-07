# 整批审阅交付 · 2026-09-06

状态：代码与实验工具分支交付，**未合并、未部署，整批实测验收未完成**。代码尖9e24bd7；对照origin/main c17e148，无主线新增分叉。所有依赖已按顺序叠在本审阅分支，一次审阅可见完整差异，各工单分支仍保留。

## 本次完成

| 工单 | 分支提交 | 结果 |
|---|---|---|
| A2 TURN/INGRESS | f0c0dae | 独立基础设施spool、立即续收、回放合并、markActive前移、终局持久投影 |
| A3 SCHED | 9c4fa24 | 同turn多run、两次revision上限、首次应用认知结果前打断、run_aborted与恢复 |
| Channel neutral | 1bccebe | messenger服务、ownerBinding、单传输错通道拒起 |
| A4 UTTERANCES | 6a705ee | utterances信封、锁内分段、串行投递失败截止、4096传输层 |
| E4-4 | fbf5a24 | deploy.toml真实Telegram代理接线，seeds/deploy共同签署和权限检查 |
| E4-3 | 343351e | 所有者/角色实例称呼、快照中性字段、模板与用户正文边界 |
| E4-5 | ca5bbac | instance_facts启动静态门、部署说明中性化 |
| C2准备 | 6553f52 | 12条G1采集器、G0/G2目录和证据校验、配对tax评分；**实测待做** |
| Topic Recall准备 | 4e52d9e | 只读统计、6主题×4深度×3装配×2重复；**实测待做** |
| C1末项修复 | 8f3ec5a | 无换行plan末项漏跑根因、仅P4B-3-off两次补跑 |
| A1/B3结果归属补修 | 9e24bd7 | CycleResult锁内快照，防摘要等待期间下一轮覆盖终局/承诺/待批 |

最终生产代码全量：**1215 tests /1204 pass /0 fail /11 skipped**，typecheck通过。实验离线测试：C2两项、Recall两项、C1 planner一项通过，dry-run无API。各工单report保留当时基线/计数，不能累加成最终测试数。

A1/B2/B3/B1、A4原4096与E4-1/2是已有合入成果。本次沿用并复核，不重新执行历史迁移/部署稿。Kevin在续接中重申A1的converse/turn_terminal四态要求，优先于旧工单。WO-OUTCOME-CONTRACT-02已将正本事件名对齐，并将silence改为终局派生；随后经Kevin授权代定为completed/intentional_silence/deferred/failed，消费应答以completed加reason表示，四态已对齐。A3截止点保守设在首次认知结果应用前，早于首次dispatch，避免内部写入后回滚。

## B3 接线与证据边界

continuation.scan经Conversation.send调用同一认知锁/#runCycle，非wake的单拍LLM路径。cheapTick每600s扫描，独立于wake被DK-11礼让；pending行持续存在。启动将running收为failed/interrupted，再扫描due pending；TTL过期、completed/failed/expired均有终局。回合结束kick可更早触发，不使用setTimeout。

现有全量涵盖CAS认领、互斥/重扫、TTL、启动恢复、真实runCycle与多条outbox，以及本次新增两条跨轮交错测试。completed只说明续跑收账；送达仍看outbox/设备回执。真实owner收到消息没有在本机测试中得到证明。

## 治理边界与待定项

- R-A/R-B/R-C/R-D依本任务授权执行；R-D评估稿仍为non-normative，不提升为白皮书规范。
- D4审计、E4-SPEC、v1.3候选和措辞稿已在仓库，本次不挪真实实例数据，不擅自改规范正本。
- D2报告仍为3/4，WAL前置未达，37.5/E2不解锁；旧生产journal_mode记录是历史读数，本次未连接生产刷新。
- E1已完成评估稿，**甲/乙案和record_note归并尚无明确实施裁定**。建议甲案先抽共用动作表、保持两处提示词SHA、保留现有枚举行为；record_note是否并入tend_inner另裁，不以零使用量自动删除能力。
- E4分离先于E6人格层的顺序保持；Recall准备不是Topic/Thread立项通过。
- C1旧报告推导的路由/验证器官建议仍是建议，不能把小样本发现率当成架构强制规则。

## Kevin 后续一次清单

1. 审阅本分支的代码与根域变更后，才授权合并；当前没有任何main merge或生产写操作。
2. 按PRECHECK.md提供生产只读状态。实际停机/备份/切树/部署文件/重签/启动脚本需据当前状态生成，不能复用旧LANDING的固定HEAD、manifest数量或017→018迁移。
3. C1仅补P4B-3-off两次；C2收12条G1；Recall收数字聚合与192请求实验。命令见各自report，必须由Kevin在服务器跑；输出人工检查后回传，不能包含persona或密钥。
4. C2还需3个G0与12个G2的独立新上下文执行及人工复核。当前runner是目录/证据层，不冒充已隔离执行的Agent runtime；无真实交付前拒算tax。
5. 落地后验收真实入站合并、审批应答消费、打断/排队、分段实收、续跑终局及outbox送达。任何缺失证据维持pending。

检查点在本机batch-20260906/PROGRESS.md；自动续接保持开启，等待期间只在新结果或可执行进展时通知。整批未达到实测完成，不能暂停为“已完成”。

## 后续决策更新

Kevin授权所有待定选择由执行方决定。E1选甲案，先收编共享动作事实并保持提示词SHA；保留七kind，record_note与tend_inner写入语义不同，不凭零次数合并。queue_notification保留；审批与接线真源仍在kernel，不能复制一张静态权限表。E2/37.5实际前置未满足，继续锁定。
