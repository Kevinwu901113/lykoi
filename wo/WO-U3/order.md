# WO-U3 · 周期合一(想/说统一 U 系列收官单;对话轮 = decide 的对话情境)

> **状态:草案(2026-08-18 下午)。签发前置:今晚 00:19 E 步 usage 复读(main ≥70%
> 确认 U2 实验组健康;不达标先评配重再签)。签发时填:分支名与尖 commit。**

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**分支 `wo/u3` 已由治理侧建好(尖 `〔签发时填〕` = 活体 main),直接 checkout,不要自己建分支。**
铁律:一切命令**前台串行**执行,禁止后台(&)、禁止 sleep 等待、禁止"稍后继续"式收尾;
每判据一 commit(注释 `[WO-U3]` 前缀);测试一律 `timeout 1800` 包裹;
**stdout 即报告本体,不要把报告写成文件**;宁长勿略。
侦查发现与工单冲突时,停下写清楚,不要自作主张改口径。
白皮书在 `~/wo/WO-U3/whitepaper_v1.1.md`(§8 人格分层、§26.2 最小上下文是硬边界);
**P1 政策附文在 `~/wo/WO-U3/policy_exemption_P1.md`(E1/E2 豁免类别,判据②的规范)**;
设计文档 `~/wo/WO-U3/mind_speech_design.md` §2 信封定义是目标形态。

## 背景(治理侧 2026-08-18 实measured,可直接引用)

- `cognition/conversation.py`(1516 行)是要退役的转录机;`Conversation` 单例活在
  **server 进程**(`surface/app.py:139`)。U2 三段带已就位(`_assemble` :682,
  稳定前缀/历史/易变尾部);inner 通道遗迹:`extract_inner_from_reply`(:372)、
  `_apply_conversation_inner`(:556);工具循环 `_handle_followup/_progress`
  (:1354/:1373);动作出站已经 U1 走 dispatch(`_build_action` :1399)。
- `mind/decide.py`(574 行)已有完整信封词汇:`Decision`/`Candidate`、
  `evaluate_message`(:500,kind 白名单+demote-to-rest 护栏+meaning_assessment
  溯源+fail-closed 注入 id 门)、`_sanitize_inner`(:373)/`apply_inner`(:439)。
  现行唯一消费者 = `cognition/autonomous.py:150`(autonomy 进程)。
- 跨进程模式已有先例:U2 的 `_nightly_epoch`(conversation.py:748)靠"两进程都
  读得到的库"传失效信号——对话情境的周期机器沿用同一模式,**不迁进程**。
- `llm_call` 按 `route` 记账(`cognition/llm_client.py:137-146`,四数已埋);
  main=U2 实验组、autonomous_cognition=对照组,**这两个标签的读数连续性不许破**。
- 现行对话出站的放行机制治理侧未实测(`approval_rules.json` 0600)——判据②d
  要你实测写明。
- Kevin 已拍板:D1 时延 <15s;D2 短近窗 8 轮(U2 已落);D4 **影子双跑 3 天再切**
  (适用本单);P1 附文 E1/E2(2026-08-18 CD2 决议随本单落地)。

## 判据

① **信封周期(本体)**:新建对话情境的 decide 周期:输入 = U2 三段带上下文原样
   (组装复用 `Conversation` 的既有块函数,不重摆、不加块);输出信封 =
   `{meaning_assessment, decision, inner, 情绪脉冲(沿既有 self_state 语义)}`,
   `decision.kind ∈ {reply, silence, 工具调用(沿用既有 followup/progress 有界
   语义), promise_followup(暂留,U4 改周期接力)}`。解析/护栏**复用**
   `evaluate_message`/`_sanitize_inner`/`apply_inner`(允许为对话情境扩 kind 表与
   字段,但 demote 护栏、fail-closed 注入 id 门、溯源要求原样继承,配测试)。
   一轮一调用;**silence 是决策有账**(事件落账,不发送);reply 经既有
   messenger.send dispatch。宿主 = server 进程(进程再布局是 C 线心脏单的领地)。
② **P1 落地(附文为规范)**:a) E1 审批机制通信免对话门——结构来源标记判定,
   递归负向断言(approval 问句路径不产生嵌套审批);b) E2 在场应答命中免询层、
   逐条入 audit,沉默同样落账;c) 负例三连:同信封工具动作不因伴随应答降级/
   环境来源伪造不了 E1/E2 结构标记/非对端收件人不命中 E2;d) **实测并报告现行
   放行机制**(今天对话回复是靠什么规则出站的,附证据)。
③ **P2 回执背书 v1**:信封生成提示词加硬约束(动作性事实陈述必须以 dispatch
   回执/工单收据为据,没干过的不说干过);影子探针:每个影子信封做确定性二元
   标注〔含动作性陈述?/有回执可对?〕(判定规则你定并自证——动词白名单起步
   即可,宁漏勿误),入影子事件,进 3 天对比统计。
④ **inner 通道在新路径消亡**:想 = 信封本体(`inner` 字段),不再从回复文本
   抽取;`extract_inner_from_reply`/`_apply_conversation_inner` 只余旧路径引用
   (随切换单退役)。新路径念头/荷变化经 `apply_inner(source="conversation")`
   一类落账,归因可辨。
⑤ **影子双跑(D4,本单交付形态)**:每个 inbound 轮,旧路径照常(活体行为
   逐字节不变、照常发送);新路径同轮生成信封但**零副作用**——不发送、工具不
   执行(记 would-dispatch 意向)、不写审批状态。影子事件
   `u3_shadow_envelope` 入 events.jsonl:{elapsed_ms, kind, would_send 文本长度,
   回执背书标注, 与旧回复的差异摘要(长度差+首 80 字差异指纹,不落原文全文),
   inner 操作计数}。**切换是独立动作**:切换开关走 env 门**默认关**;3 天影子
   数据治理侧复核 + Kevin 批准后另行部署切换(conversation.py 退役属切换单)。
⑥ **时延预算(D1)**:影子路径逐轮记 elapsed_ms;验收线 = 非工具轮中位 <15s。
   影子失败(异常/超时)只 log_event,静默,**永不影响旧路径回复**,不重试。
⑦ **usage 记账连续性**:影子路径 `llm_call` 用新 route 标签(建议
   `conversation_shadow`),**禁止复用 main/autonomous_cognition**(污染 U2
   读数);切换后的正式命名切换单再定。
⑧ **零扰动**:同输入下旧路径 `_assemble` 输出与 U2 后现状一致(结构测试);
   影子路径的库读全走既有读口,**不新增写路径**(除影子事件与 inner 落账——
   后者仅当你能证明 shadow 期不落真念头时才开,默认影子期 inner 只记不落,
   切换后才生效;二选一写明理由,配测试)。
⑨ **每判据配测试;全邻接前台串行**:conversation 21 文件口径 + `mind/decide`/
   `autonomous` 套件 + telegram 设备/传输套件 + `test_messenger` +
   `tests/test_gate5_l1_scan.py`(裸读时钟须 `# realtime-allow:` 尾注)+
   `tests/test_p0_integrity.py`(重签后)。基线:全量 3 failed / 1852 passed
   (2026-08-13 权威值)+ claude 身份 approval_rules 0600 假失败;逐条归因。
⑩ **manifest 重签**(现 108 条,前后条数写明);新增 state 路径常量同提交补
   `tests/conftest.py` 默认表(教训 36);新增 env/路径/文件全集入报告。
⑪ **报告(stdout 本体)**:信封 schema 与真实样例(脱敏);影子事件样例;
   放行机制实测记录(判据②d);全邻接清单原样+逐条归因;manifest 前后条数;
   每判据自证。**部署核对信息**:新代码跑在哪个进程/哪个 systemd 单元、需要
   哪些 EnvironmentFile/env 新键,逐一列明(合并包要用)。

## forbidden

影子期内新路径不得产生任何真实副作用(不发送、不执行工具、不写审批状态、
默认不落真念头);不动 kernel 问答机(S3/L5 reply_to 先行拦截——E1 判定在
policy 层,不是改问答机);不动传输层与长轮询(U0 领地);不删/不改
`conversation.py` 旧路径行为(退役在切换单);不动 decide 自主情境的候选表与
守卫语义(共享代码的每处改动列明并两情境都测);不改 main/autonomous_cognition
的 route 语义;approval_rules 永无写路径;secrets 不入任何块与日志;不碰
`guardian/` 与 `src/lykoi/core/`(封存边界);不做心脏/调度/进程布局重构
(C 线领地);凡与本单口径冲突的侦查发现,停下写清楚。
