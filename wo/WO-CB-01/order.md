# WO-CB-01 · C-B 心脏第一单(心跳影子 + 调度地基)

> **状态:已签发(2026-08-21)。** C 线第二段开工单。上游:WO-CA-BASELINE-1
> 复核 PASS,其报告为本单设计正本输入(本目录 `ca-baseline-report.md`,
> 下称"C-A 报告");白皮书 v1.2 第 37 章(37.2 双时钟)与 9.4/10.3/12.3/22.2
> 见本目录 `whitepaper_v1.2.md`;接轨方案见 `cordis_integration_plan.md`。
> **分支与基**:`wo/cb-heart`,基 = `32238013`(tag init-node-20260821,活体尖)。

你是执行 Agent,在 `~/lykoi-work-cb` 工作,分支 `wo/cb-heart` 已由治理侧建好,
直接 checkout。铁律:前台串行、**禁后台**、每判据一 commit(`[WO-CB-01]` 前缀)、
测试 `timeout 1800` 包裹、**stdout 即报告本体**、宁长勿略;侦查发现与本单冲突时,
停下写清楚。**并行执行注意(教训 38)**:同机可能另有执行器在跑,若全量中
`test_core_v1_shadow` 出现 TimeoutError 连锁失败,记录后对该文件单独串行复跑
一次定性,勿逐条归因。

## Owner 拍板(2026-08-21,本单约束与后续步骤的设计事实)

- **D-CB-1 发言权完全收回**:心跳件接管后,模型不再拥有"我想 N 分钟后再醒"的
  发言权,节律全归心跳件。**本单不改 DECIDE prompt、不动 `decision.
  next_wake_after_minutes` 的现有消费**(影子期主路径零扰动);心跳影子的节律
  策略**不读**该字段(读 `autonomy_state` 仅限对照读数)。prompt 契约字段退役
  与 `clamp_rest` 归属迁移属步 3 切换单。
- **D-CB-2 显著性源二选一定案 = salience_shadow**(同进程 sidecar)。Core 侧
  `attention_decisions` 明确**不接**(C 线后续再议)。
- **D-CB-3 层1/层2 节律锚改纯墙钟**:整合/专注的触发从 wake 计数迁到墙钟是
  已拍板方向,但**本单零实现、禁止顺手改**——迁移随步 3 前的独立单。本条写入
  报告的交接清单即可。

## 范围一句话

C-A 报告 §6 的**步 0 + 步 1 + 步 2**,加上复核新立的 R-CA-1 修复与 R-CA-3
补测,加 llm_call 自主侧归因。**步 3(切换)与步 4(推演切分)明确不在本单**
(C-A 报告纪律:正交勿捆)。

## 判据

① **侦查先行(单独一节入报告,引用代码行)**:
   a) `snapshot.assemble()` 四处写(C-A 报告 §5.2)的全部调用方与测试触达面;
   b) `salience_shadow.db` 的 schema、写入时机与索引现状——心跳件按什么查询
      读"新增高显著性记录",跨进程只读连接的锁形态(它是 WAL,论证读不阻塞写);
   c) `run_forever` 循环全部分支与现有 `log_event` 落点;
   d) events.jsonl 当前日志速率量级——心跳影子若每 5s 转都落一条会不会刷屏,
      给出有界方案(见⑥);
   e) `llm_router.complete` 调用点全景:自主进程内哪几点(含 `suggestion_
      conversation` 是否顺带)、归因参数穿透的最小改法、不带归因的调用方
      如何保证逐字节不变。

② **步 0 · 劈快照(纯重构)**:`mind/snapshot.py` 拆出 `maintain(now)`(四处
   维护写)与 `read(...)`(纯读装配),`assemble()` 保持"maintain 后 read"的
   兼容外观,**全部调用方零改动**。等价性判据:同 seed 跑
   `scripts/p4r_compressed_harness.py`,改动前后 concerns/thoughts/
   regulation_events 终态逐字节相同,证据入报告。顺带评估 H4(`_build_snapshot`
   测试钩子每调一次触发真实维护写):若能零语义代价切到 `read()` 则做,否则
   保持现状并在报告记录理由。

③ **"推演零写入"断言测试(步 4 的守门员,本单只立测试不切分)**:内存 DB 上
   全表 sha256 快照,跑 `_perceive()` + `evaluate_message()`(不含
   `execute_and_reflow`/`apply_inner`),断言全表哈希不变。该测试在步 0 之前
   必失败、步 0 之后必通过——commit 顺序与说明要体现这一点(它失败本身就是
   步 0 必要性的证据,C-A 报告 §7.3-3)。

④ **R-CA-3 骨架补测(阻塞级缺口)**:
   - `run_forever` 四条:(a) stop 置位后循环干净退出;(b) 600s 廉价 tick 闸按
     虚拟时钟生效,且 `cheap_tick` 抛异常不杀循环;(c) wake 返回 completed 时
     integrate/focus 各被调一次,failed/yielded/rested 都不被调;(d) `_due`
     为假时不发起 wake。
   - `_due` 边界四输入:None / 脏字符串 / 未来 / 过去。
   用 `test_scheduler_virtual.py` 已验证的虚拟时钟 + asyncio 模式,不新增
   基础设施。

⑤ **R-CA-1 唤醒风暴修复(本单唯一允许改动实际调度行为之处)**:
   a) `_due` 解析失败改 fail-closed + `log_event` telemetry + **自愈**(把
      `next_wake_at` 重写为 now+`DEFAULT_REST_MIN`,防脏值把她冻死在"永不醒");
   b) 最小拍间隔地板:**任何路径**两次 wake 发起间隔 ≥ `MIN_REST_MIN`,覆盖
      未来心跳件误配情形;
   c) 测试钉死两者,含负例"连续 rest 决定(不计小时 cap)也不可能 5s 连发"。

⑥ **步 1 · 心跳影子件**:新文件 `cognition/heartbeat.py`,确定性、**零 LLM、
   零表写**(events.jsonl 遥测除外)。在 `run_forever` 与 `_due` 判定并排
   (`autonomous.py` 插入量级 3-5 行),**实际是否 wake 仍完全由旧 `_due` 决定,
   不动 `wake()` 一个字节**。影子策略:基线间隔 env `LYKOI_HEARTBEAT_BASELINE_MIN`
   (默认 30,夹逼 [`MIN_REST_MIN`,`MAX_REST_MIN`])+ 地板;按 D-CB-1 **不读**
   模型的 next_wake 输出。落 `log_event("heartbeat_shadow", would_wake=...,
   reason=..., next_at=...)`,**日志量必须有界**(至少做到"仅判定翻转或
   would_wake=true 时落"或等价,报告写明口径与预期日频)。

⑦ **步 2 · 显著性输入(salience_shadow,仍只落日志)**:心跳件以只读连接读
   `salience_shadow.db`,确定性规则把"新增高显著性记录"计入 would_wake 判定
   (阈值/窗口由你设计,须确定性、报告里一句话说得清);`reason` 区分
   baseline/salience,使两套 would_wake 序列(纯定时 vs 定时+显著性)可分离
   读数;sidecar 不可用/不存在时 fail-quiet 回落纯基线(不杀循环,落 telemetry)。

⑧ **llm_call 归因(自主侧限定)**:`llm_router.complete` 增**可选**归因参数,
   自主侧调用点(`autonomous.py` 决策调用、`integrator.py`、`focus.py`)带
   `run_id`/`origin` 落入 `llm_call` 事件;**对话侧零 diff**(conversation/
   telegram/approval_interpreter 不动;`suggestion_conversation` 按①e 侦查
   结论,零风险才带,拿不准不带并记录)。不带归因的调用方行为与事件字节序
   完全不变(既有事件消费方零影响自证)。

⑨ **零扰动**:除判据⑤明列的两处行为变更外,wake 行为、决策语义、prompt、
   候选表、层1/层2 节律、预算闸全部与基分支一致;`mind/decide.py` 零 diff;
   对话路径、kernel、guardian(manifest 除外)、core 零 diff。

⑩ **全邻接前台串行 + manifest 重签 + conftest**:全量基线 **2169/3/6**
   (基 `32238013`;**先复跑核实基线再动手,对不上停下写清楚**);新增失败
   零容忍逐条解释。manifest 前后条数写明(以基分支
   `git show 32238013:guardian/manifest.sha256` 现值为基准,预期 112,不许
   凭记忆写)。新增 env/state 常量同提交补 conftest 默认值(教训 36)。

⑪ **报告(stdout 本体)**:①全节;每判据自证;**影子读数使用说明**——治理侧
   将用 heartbeat_shadow vs autonomy_wake 按日对齐做步 3 立项证据,写明查询
   口径(jq 或等价);**步 3/步 4 交接清单**——切换单要动的点全列(`_due` 换
   `heartbeat.due()`、DECIDE prompt 字段退役与 `clamp_rest` 归属、D-CB-3
   墙钟迁移面、费用前置闸挂点)。

## forbidden

不动 `wake()` 决策语义与 DECIDE prompt(步 0 等价重构与判据⑤除外);不碰
kernel/ 与 guardian/ 代码(manifest 重签除外)、不碰 `src/lykoi/core/`
(R-CA-2 刷屏销账不入本单);不碰对话路径(`conversation.py`/
`conversation_cycle.py`/telegram*/messenger/surface app——U3S 领地,同机
在跑);心跳件禁一切 LLM 调用与表写;不实现步 3 切换、步 4 推演切分、层1/层2
节律迁移(D-CB-3 记录不实现);不接 Core `attention_decisions`;
`salience_shadow.db` 严格只读;approval_rules 永无写路径;secrets 不入块与
日志;新增 state 路径常量同提交补 conftest;凡与 C-A 报告或本单冲突的侦查
发现,停下写清楚。
