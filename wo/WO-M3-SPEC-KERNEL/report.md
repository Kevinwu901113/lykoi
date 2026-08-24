# WO-M3-SPEC-KERNEL · 治理层行为规格清点（治理侧存档）

- 执行：Mac 只读侦查 Agent（一次流中断续联收口，SendMessage 续跑范式首用——阅读上下文
  保留，零重读成本）；报告全文见下（§0-§6 逐字存档）。
- 复核（2026-08-25）：抽查 PASS——refsrc 缺 guardian/ 证实（§0-1 勘误成立）；
  ASK_FALLBACK 15 字 `66b17e24…`、QUESTION_TEMPLATE 30 字 `886f07bf…` 独立实算吻合；
  KNOWN_ACTIONS 18 项逐项核对全等（SK-01）；建议状态机 6 值（DK-06 口径正确）；
  MAX_DELEGATION_DEPTH=1/MAX_CHILD_AGENTS=0（SK-63）；check 三层门 docstring 在位。
- **取证增补（2026-08-25，ssh lykoi-gov 只读，闭合 DK-01/DK-02）**：
  - 活体 guardian 五文件已拉回 `guardian-live-20260825/`（sha256 前缀与服务器逐位对账：
    audit_sink c003f6bd / path_guard b28596e2 / policy_core 144b9bfb /
    startup_verify 8fe20848 / watchdog 61364ae4；manifest.sha256 113 行）——
    **M3 各波 guardian 对拍以此目录为正本**，core-v1-repo 镜像作废（§0-2 陈旧证实：
    startup_verify 镜像 f22f31b6 ≠ 活体 8fe20848）。
  - **DK-02 定案：`AUTONOMOUS_ALLOWED` 活体实为 8 项**（research_browser
    open/read_text/extract_links/screenshot + autonomy queue_notification/
    initiate_chat + messenger send/read）；SPEC-CONV §4.7 所记"9 项"系计数误差，
    不存在第 9 项。`HARD_ASK_TYPES = {terminal.exec, delegation.dispatch}`、
    `HARD_DENY_TYPES = ∅`、`PROTECTED_PATHS = (/home/lykoi/secrets, …/guardian)`
    逐字实录在案。建议问答机 `messenger.send ∈ AUTONOMOUS_ALLOWED` 依赖成立
    （DK-02 承重路径的规格化要求转入 M3 蓝图 GK 定案）。

---

以下为执行 Agent 报告全文（逐字）。

# WO-M3-SPEC-KERNEL · 治理层（kernel）行为规格清点报告

**基线**：`/Users/wukevin/Documents/lykoi/lykoi-cordis-refsrc/lykoi/`（活体 HEAD `4463ae8` = tag `cordis-night-20260822` 文件树快照）。以下 `file:line` 除特别注明外均相对该快照。零写入已遵守。

## §0 基线勘误

**0-1【事实】refsrc 快照不含 `guardian/`，也不含 `tests/`。** guardian 内容三重证据链：本地镜像 core-v1-repo（【事实·镜像】）+ 治理仓 hard-ask-delegation.patch（9372041…，be2fba1 在 4463ae8 祖先链）+ SPEC-CONV §4.7 转引。→ **已由取证增补闭合：正本=guardian-live-20260825/**。

**0-2【事实】core-v1-repo 镜像对活体已知陈旧三处**：HARD_ASK 只有 terminal.exec（活体 +delegation.dispatch）；AUTONOMOUS_ALLOWED 6 项（活体 8 项）；manifest 90 行（活体 113）。

## §1 SK 行为规格总表（摘要索引；逐条正本=执行 Agent 报告原文，本档保留全部条目号与锚点）

### A. dispatch 主链（kernel/dispatch.py）
- SK-01 KNOWN_ACTIONS 18 项 frozenset 全表（:325-354）【逐字】：browser 5 + terminal.exec + research_browser 4 + autonomy 2 + notify.owner + messenger 2 + delegation 3。分级不写在这张表里。
- SK-02 `_resolve` 四重拒绝全 raise（:293-303, 357-370）【逐字】。
- SK-03 DispatchContext：origin 五值 Literal 无默认；exemption/delegation 骑 context 不骑 params（:248-283）【逐字】。
- SK-04 delegated 必带 DelegationRef，缺失=拒绝+落账，位于策略判定之前（:231-246, 402-421）【逐字】。
- SK-05 先 assert_no_secrets 再 redact_obj；审计带 redacted 副本，raw 只用于 scope key（:422-423, 740-753）【逐字】。
- SK-06 `_policy_decision` 四值；check→deny 恒 deny 硬 deny 胜过批准（:373-398, 740-767）【逐字】。
- SK-07 pre-dispatch 不可变审计门 fail CLOSED（:474-492）【逐字】。
- SK-08 degraded 状态机：immutable 写失败→degraded 拒副作用；telemetry 永不可顶替（:41-73, 493, 708-737）【逐字】。
- SK-09 `_immutable_audit`：OSError→False，其它异常传播（:204-222）【逐字】。
- SK-10 决策执行四路（deny/ask/allow/handler 异常），成功数据先 redact 再交回认知（:762-785）【逐字】。
- SK-11 action_result 不带 data 正文（:654-657）【逐字】。
- SK-12 无委托返回空 dict 非 None 栏（:138-158）【逐字】。
- SK-13 guardian 路径由文件路径推导不可 env 重定向；加载失败=每次 dispatch fail CLOSED（dispatch.py:26-34; approval.py:44-61）【逐字】。
- SK-14 Core R2A/execution_session/shadow 分支=CF-B2 退役不迁（:433-707）【事实】。

### B. 三层门（kernel/approval.py）
- SK-15 check 判定全序 10 步（:305-368）【逐字】：①hard deny ②capability deny（先于 hard ask）③live always_deny ④capability allow ⑤hard ask ⑥live always_allow ⑦DELEGATION_READONLY ⑧scoped grant 精确相等 ⑨policy_exemption.covers（最末位）⑩默认 ask。
- SK-16 capability 地板：scheduler=kernel 级 {notify.owner}；autonomous=policy_core（core 缺失 fail closed deny）；interactive/system/delegated=None（:70-110）【逐字】。
- SK-17 `_origin_rules` autonomous 子块只收紧（:113-130）【逐字】。
- SK-18 validate_rules 顶层键钉死；与 startup_verify._rules_schema_problems 孪生双拷贝（:133-162, 226-234）【逐字】。
- SK-19 `_load` fail CLOSED 空默认+事件；_save/_persist 分立（:169-208）【逐字】。
- SK-20 is_hard_gated：core 缺失 fail closed 到 ask 也是硬门（:257-261）【逐字】。
- SK-21 DELEGATION_READONLY 代码常量非规则行（:79-93, 353-356）【逐字】。
- SK-22 scoped grant `"type@key"` 存 always_allow；精确串相等消费永不通配（:221-302）【逐字】。
- SK-23 grant_standing 三拒绝（hard_gated/无 key/key 含 *）；幂等；conditions=Kevin 原话非机器约束（:393-452）【逐字】。
- SK-24 revoke 恰删一行；standing_grants 权威=规则行（:455-509）【逐字】。
- SK-25 record_denial advisory-only 不接 check；DENIAL_QUIET_H=24；denials 尾 100（:512-550）【逐字】。
- SK-26 OWNER_PREAUTHORIZED_ACTIONS=("messenger.send",)；bootstrap 部署期一次幂等（:553-603）【逐字】。
- SK-27 pending：TTL 900s；(type, params_key) 去重同 grant 同 id；字段 12 项（:606-708）【逐字】。
- SK-28 consume_pending 原子认领四拒绝态（:722-748）【逐字】。
- SK-29 队列生命周期组：find 含死记录/判序 consumed>resolved>expired>live/问句单链/mark-only 永不删（:751-891）【逐字】。

### C. 审批对话机（approval_conversation.py）
- SK-30 request_approval 四道闸+先发后排；每个非 asked 态=动作不执行（:43-62, 148-274）【逐字】。
- SK-31 `_send` 漏斗=唯一的嘴=E1 盖章处；拒绝永不是新问句（:113-143）【逐字】。
- SK-32 `_execute_once`：consume 原子点；pre_approved=True 原 origin 重派同 correlation 链（:279-317）【逐字】。
- SK-33 执行回执四分支；RESULT_MAX_CHARS=1500 截断显式告知；_reply_ref 免预算；投递失败吞（:78-94, 320-393）【逐字】。
- SK-34 handle_owner_answer 路由：dead question 最前拦（:396-504）【逐字】。
- SK-35 审计事件全集含六元组 approval_interaction（:96-99; interpreter:577-655）【逐字】。

### D. 答复解释器（approval_interpreter.py）
- SK-36 interpret 五失败路全落 unclear 永不 approve；MAX_TOKENS=400/T=0.0（:52-53, 246-256, 335-374）【逐字】。
- SK-37 三消息防注入结构（:177-243）【逐字】。
- SK-38 `_coerce` 词表外归 None/0/unspecified 不猜（:283-332）【逐字】。
- SK-39 describe_action 分型摘要永不整体 dump（:259-280）【逐字】。
- SK-40 resolve_target_detail 归属信号序（=S-64 正本；:412-471）【逐字】。
- SK-41 OWNER_ANSWER_WORDS 27 词只决定路由永不决定 verdict（:86-105）【逐字】。
- SK-42 gate 真值表：硬门永不常设授权/this_only 一次性/unclear 硬门无限追问、标准一次后 deny；_CLARIFY_ROUNDS 进程内不持久（:116-132, 528-574）【逐字】。
- SK-43 确定性快通道 `执行`/`不要`（:658-701, 787-793）【逐字】。
- SK-44 授权回滚：六元组审计失败→revoke+rolled_back（:838-844）【逐字】。
- SK-45 ambiguous/stale 零放行照写六元组（:704-707, 736-770）【逐字】。
- SK-46 risk_level 唯一源=is_hard_gated；execute_once 显式不 grant（:491-494, 806-828）【逐字】。

### E. 豁免（policy_exemption.py）
- SK-47 E1/E2 全语义（EXEMPT 恰 {messenger.send}；构造入口恰两个；covers 四步；消费位=check 末步；豁免免问不免账；活体今日零承重）（:1-113）【逐字】。
- SK-48 新体 exemption.ts 已立 E1/E2/E3（Symbol 私有化）；E3 本体归 M3 出站器官【事实】。

### F. 建议问答机（suggestion_conversation.py + store 队列面）
- SK-49 铁律零写 rules/不 import approval/无 write_standing；staged=给 root 会话的说明（:9-14, 119-136）【逐字】。
- SK-50 节律按周期序号：ASK_TTL=7/DECLINE_COOLDOWN=30/EXPIRE_COOLDOWN=10（:44-48）【逐字】。
- SK-51 maybe_ask_owner 六步驱动序（过期最前/FIFO 无旋钮/owner 只认 P2-01 绑定/先发后记/撤回不开频控后门）（:141-246）【逐字】。
- SK-52 `_send` origin=autonomous + E1 章两件各归各；问询吃预算答复不吃（:71-107）【逐字】。
- SK-53 答复归属只认 reply_to；unclear 状态一字不动（:251-412）【逐字】。
- SK-54 队列 6 状态+迁移表（applied_by_owner←accepted 仅 owner console；pending←declined/expired 再武装）；原子认领 CAS（store.py:2225-2241, 2394-2510）【逐字】。
- SK-55 入队侧衔接（M2 已迁）；staged_for_owner=list("accepted")（suggestions.py:66, 219）【逐字】。

### G. 通知（notifications.py + handlers）
- SK-56 队列 state/notifications.json 环 500；唯一调用方=两 handler；内容不入审计只入队列（:1-30）【逐字】。
- SK-57 autonomous 节流持久队列算：CAP=2/UTC 日、COOLDOWN=2h、同日同题去重；缺表 origin 不节流是显式政策（:32-77, 91-111）【逐字】。
- SK-58 id=max+1（DK-03）；mark_replied 首写获胜幂等（:112-128, 154-168）【逐字】。
- SK-59 contact 链全貌 + 新体接口位 NotificationsView【事实】。
- SK-60 notify.owner _ALLOWED_ORIGINS 显式排除 autonomous；params["origin"] 由可信调用方盖章（notify.py:19-33）【逐字】。

### H. 委托台账（kernel/delegation.py + resources/delegation.py）
- SK-61 七态状态机 CHECK+TRANSITIONS 双层；collected 后无 expired 边；三终态无出边（:71-96）【逐字】。
- SK-62 每次迁移一条审计写在落库前 fail closed 抛 DelegationAuditUnavailable（:143-168）【逐字】。
- SK-63 depth 闸 MAX_DEPTH=1/MAX_CHILD=0；越界连 draft 都不留（:98-108, 187-201, 250-257）【逐字】。
- SK-64 ensure_agent_user 无 identity_bindings 写路径（:206-237）【逐字】。
- SK-65 transition 库层 CAS；set_verdict 唯一合法写入点一判不改（:312-356, 361-453）【逐字】。
- SK-66 audit_session_id=dsess_{contract_id} 确定性派生（:130-141, 373）【逐字】。
- SK-67 资源层薄壳三道门全继承；depth 取 max 不信 params；verdict 不在资源层写（resources/delegation.py:42-152）【逐字】。
- SK-68 免询封堵三件套：UNSCOPABLE={terminal.exec, delegation.dispatch}/EXEMPT 只 messenger.send/HARD_ASK 活体={terminal.exec, delegation.dispatch}（取证实录）【逐字】。

### I. scope key（scope.py）
- SK-69 映射全表+eTLD+1 刻意偏窄+UNSCOPABLE→None+退化键 type:（:52-173）【逐字】。

### J. guardian 与启动完整性门（正本=guardian-live-20260825/）
- SK-70 startup_verify ExecStartPre 任一问题 exit 1；--write-manifest root 重签入口；stdlib-only【事实·正本】。
- SK-71 检查项 7 项：①guardian 属主 ②受保护树（src 边界/kernel/core/pycache/persona TOML）③env 钉三条 ④path guard 自检 ⑤manifest 三向核对+反向核对（root 属主域 vs GOV-01 hash-only 域）⑥rules 硬门核对（两处 always_allow 不得含 HARD_ASK∪HARD_DENY）⑦audit sink 供给六断言【事实·正本】。
- SK-72 rules schema 孪生双拷贝是结构要求【事实·正本】。
- SK-73 policy_core 三旋钮（hard_decision/capability_profile/is_protected_path）【事实·正本】。
- SK-74 path_guard 解析失败当"在内" fail closed；audit_sink append-only；watchdog 独立 root 进程【事实·正本】。
- SK-75 kernel 侧 audit_provision 运行时孪生六断言（audit_provision.py:33-100）【逐字】。
- SK-76 封存边界目录集；CF-B2 退役后受保护面须 M3 重划（DK-05）【事实】+【建议】。

### K. 出站设备层（增量锚点）
- SK-77 审批问句设备层发（包 14 已在活体）：_ask_about 形状校验宁可不问/reply_to=入站 id/不重试；认知只交四项载荷 _delegated_ask 取走即清；先说话后请示（telegram_device.py:248-287, 487-494; surface/app.py:155, 276-285; P1 附文 §6）【逐字】。
- SK-78 E2 盖章唯一点=_send_reply；三分支结局=S-79/80 正本（:292-349）【逐字】。
- SK-79 出站游标机：入站坏当 0 出站坏当首启方向刻意相反；推进在结局落定后；approval_request 显式跳过；_deliver_outbox_item 直调 transport 绕 dispatch=D-07 洞（:60-78, 114-157, 352-426, 552-558）【逐字】。
- SK-80 messenger 资源契约：reply_to is None 才过 _reserve_proactive_slot（CAP=1/6h/环 50）；_TRANSPORT 默认 Null 单写者=device（messenger.py:116-221）【逐字】。
- SK-81 transport 纪律：重试 (2,5,15,30)s 只给 sendMessage/429 单独路/record_undelivered 9 字段+经验回灌（telegram_transport.py:45-67, 107-190, 284-378）【逐字】。
- SK-82 三级路由消费位仅 _is_owner；前两级非 ignored 即消费（telegram_device.py:165-177, 449-494）【逐字】。

### L. 回执背书结构层（19.2 自体/37.8）
- SK-83 契约事实约束段逐字（conversation_cycle.py:186-193）【逐字】。
- SK-84 探针 annotate_receipt_backing 宁漏勿误；receipt_available 不由文本推断；M2 已迁；M3 增量=真 dispatch 回执接计算源+委托侧由 SK-65 verdict 承接（:450-505）【逐字】+【事实】。

### M. 新体接口位等待面（7 处，全部【事实】）
ConverseDispatchFn/needs_approval 消费/DispatchFn 自主侧/OrganActionCatalog/NotificationsView/Exemption E3/可选项五件（markReplied/UndeliveredView/postProgress/markActive/describeImage）——各自现状替身与等待面见原文表。

## §2 prompt/模板 sha256 实测表（全部本机实算；与 SPEC-CONV 重叠 14 条全吻合）

A. approval_conversation 10 条（QUESTION_TEMPLATE 30/886f07bf…、RETRACT 51/a7019f4a…、DENY_CONFIRM 8/0356d3db…、EXPIRED_REPLY 16/77da6f54…、EXEC_OK 28/5598a0de…、EXEC_OK_NO_OUTPUT 25/193cdb34…、EXEC_FAIL 32/ab98ae11…、EXEC_SKIPPED 30/84cb462f…、RESULT_TRUNCATED 22/14d81780…、审计事件名三串）。
B. approval_interpreter 10 条（INTERPRET_SYSTEM_PROMPT 851/ed9c86d1…、ACTION_TEMPLATE 119/5e070e34…、ANSWER_TEMPLATE 81/49f2d82b…、_AMBIGUOUS_CLARIFY 57/a3450d3f…、执行 2/32c8d373…、不要 2/77af2f33…、FAST_PATH_REASON 24/e0be634c…、clarify 硬门尾句 39/7d9641cf…、硬门骨架 69/3181b45f…、标准骨架 41/61e4ecb6…）。
C. suggestion_conversation 10 条（QUESTION 89/3d3252d7…、RETRACT 38/0bd3c89a…、ACCEPT 42/de16218b…、DECLINE 24/71babb39…、UNCLEAR 36/3c705262…、EXPIRED_NOTICE 36/6d5e1ee7…、DEAD_REPLY 18/630aaf0f…、ANSWER_SYSTEM_PROMPT 656/74f4efdb…、DATA_TEMPLATE 80/95107a69…、OWNER_TEMPLATE 81/f68f4704…）。
D. ASK_FALLBACK 15/66b17e24… 复核通过（随审批器官归 M3 迁移）。

## §3 写集全表

A. immutable sink 事件词汇全集（action_dispatch/action_result/delegation_context_invalid/approval_question/approval_answer_routed/approval_execution/approval_interaction 六元组/rule_suggestion_interaction 九 stage/delegation 四事件）。
B. state 文件/表 13 路逐条对拍 STATE-CONTRACT §4 全吻合（含 R-14 坏文件语义四档三处刻意相反、四个无保护文件不许顺手 try/catch）。
C. 策略只读面三件。

## §4 DK 缺陷/歧义清单

- DK-01 refsrc 缺 guardian —— **已闭合**（取证增补，正本 guardian-live-20260825/）。
- DK-02 AUTONOMOUS_ALLOWED 第 9 项不可复原 —— **已闭合**：活体 8 项全表实录，SPEC-CONV "9 项"系计数误差；建议问答机 messenger.send∈ALLOWED 依赖成立，须写进 M3 规格。
- DK-03 notifications id=max+1 复用风险（C-28）→ 新体持久 next_id【建议】。
- DK-04 pending_actions 坏文件抛=审批面不可用（安全向不可见）→ 新体拍板姿态。
- DK-05 完整性门受保护面 CF-B2 后重划 → M3-W4 治理设计点。
- DK-06 建议状态机 6 态非 7 态（unclear 刻意不是状态）→ 规格以 6 态+迁移表为正本。
- DK-07 活体 U3 缺陷或被 FIX-01 挪基线；新体需 e2e 断言"自称 dispatched ⟺ audit 有行"。
- DK-08 _CLARIFY_ROUNDS 跨进程不一致 → 新体同进程自然消解或声明计数域。
- DK-09 _dead_question 对 denied 也说"过期"（轻微，可照抄）。
- DK-10 env 钉面不对称 → 新体统一钉全部治理 state 路径（收紧无害）。
- DK-11 delegated origin 无 capability 地板；Core 退役后须拍板策略面。
- DK-12 通知队列 pull 模型在具身转向后的到达面 → 拍板（并入投递线/维持/降级）。
- DK-13 bootstrap_owner_preauthorization 是部署期动作 → M4 切换清单必含。
- DK-14 建议撤回吃预算残余窗口=刻意，立案防"顺手修好"。
- DK-15 图式注册机制无活体正本=新建面，先出设计小节（注册即感知/可逆副作用登记/卸载即消失/认知可读不可写）。

## §5 M3 波次切分建议（3+1 波）

W1 特权层骨架（kernel 真身+治理核+三处 DispatchFn 接线）→ W2 审批器官（S-54..68 全量+终端硬门实弹+DK-07 e2e）→ W3 出站器官+建议问答+通知（E3 投递线本体/S-08 路由/interactive_lock/快照读数）→ W4 完整性门+生产收口（受保护面重划红绿双验/图式注册首版/restart 采集器/cordis.yml/DA-11 取证）。依赖严格串行。

## §6 M2 收口遗留 14 项归位表

1 dispatch 真身→W1；2 审批器官→W2；3 建议问答→W3；4 出站+D-07→W3；5 LLM adapter 面→W2（vision 可后置）；6 interactive_lock→W3；7 self-state→留 M4（活体缺省 disabled 维持）；8 restart 采集器→W4；9 快照三读数→W3；10 cordis.yml→W4；11 kernel notifications→W3；12 S-08 路由→W3；13 tool_calls wire→W2；14 DA-11 persona TOML sha→W4（已可并入本次取证通道）。
