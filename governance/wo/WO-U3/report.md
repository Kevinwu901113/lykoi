Tree clean, 6 commits. Report follows — stdout is the report body.

---

# WO-U3 执行报告 · 周期合一(想/说统一 U 系列收官单)

分支 `wo/u3`,尖 `a923c44e`,基 `2b8c477f`。6 个 commit,16 文件,+1968/−69。工作树干净。

---

## 0. 一句话结论

对话轮的 decide 信封已经存在并**每轮真跑**,但只跑在影子里:零发送、零工具执行、零审批写、零念头落库。旧路径逐字节不变,四条零扰动用例逐条钉住。P1 的 E1/E2 已落进 policy 层,今天可观测影响为零(实测证明今天这些出站根本走不到豁免层),U3 切换后才承重。**切换开关默认关,且生产代码里零个读者** —— 切换是切换单的事。

---

## 1. 判据②d:现行放行机制实测(附文 §1 未实测句的闭环)

### 1.1 可观测性边界(先说清楚我能看见什么)

以 `claude` 身份(`uid=1001(claude), groups=claude,lykoi`)实测 `/home/lykoi/state`:

```
approval_rules.json   0600 uid1000 gid1000  R_OK False   <- 读不到
standing_grants.json  0600 uid1000 gid1000  R_OK False   <- 读不到
events.jsonl          0600 uid1000 gid1000  R_OK False   <- 读不到
```

**治理侧"正本 0600 不可读"这一条对执行方同样成立** —— 0600 是属主位,我在 `lykoi` 组里也没用。

但真正的不可变审计**可读**:

```
/var/log/lykoi-audit           0750 uid0 gid1000  R_OK True
/var/log/lykoi-audit/audit.jsonl 0660 uid0 gid1000 R_OK True  (696 874 B, 1652 行)
```

(注:`/home/lykoi/state/audit.jsonl` 是 0664 但 **0 行** —— 它不是真 sink;真 sink 由 `guardian/audit_sink.py:13` 的 `AUDIT_PATH` 指到 `/var/log/lykoi-audit/`。)

### 1.2 实测结果(窗口 2026-06-05T14:39Z → 2026-08-17T07:57Z)

`messenger.send` 全部记录:

| event | origin | decision | pre_approved | success | 次数 |
|---|---|---|---|---|---|
| action_dispatch | interactive | **allow** | False | – | **28** |
| action_result | interactive | allow | – | True | 28 |

`ask` 0 次,`deny` 0 次,`pre_approved=True` 0 次。同窗口内 `standing_grant_created` **恒为 False**(19 条带 scope_key/grant 字段的记录全是 `terminal.exec` 的硬门问答)。

对照全表(证明这份审计确实有判别力,不是一律 allow):

```
browser.get_text     interactive  allow 46 / ask  3 / pre_approved 3
browser.navigate     interactive  allow 79 / ask 11 / pre_approved 8
browser.screenshot   interactive  allow 45 / ask  8 / pre_approved 8
terminal.exec        interactive  ask  25 / pre_approved 12
terminal.exec        autonomous   deny  2
messenger.send       interactive  allow 28          <- 从来没有 ask
```

### 1.3 结论

**今天的对话回复是靠 live `approval_rules.json` 里的一条 `always_allow` 放行的** —— 具体是在 `approval.check` 的第三层(`kernel/approval.py:321-324`),不是靠结构旁路,也不是靠 owner 逐条批准(`pre_approved` 全 False)。因果链已实测复现,钉成回归断言 `test_todays_release_route_is_the_live_always_allow_not_a_structural_bypass`:有那条规则就 `allow`,清空就 `ask`。

配套三条侦查结论:

1. `messenger.send` **不在**不可变核的硬门里(`guardian/policy_core.py:30` `HARD_ASK_TYPES` 只有 `terminal.exec`),所以 live 文件说了算。
2. **`bash bootstrap_owner_preauthorization` 在生产代码里没有任何调用点** —— 全仓只有两个测试文件调它。所以 P1 §1 说的"所有者预授权"若已装,不是这个函数在部署时装的;结合 §1.2 的"窗口内零 standing grant",那条 `always_allow` 要么早于 2026-06-05,要么是 Kevin 手写的。
3. 是**裸 `messenger.send`** 还是 **`messenger.send@user:<owner>`**,从外部区分不了(28 次全发给同一位收件人,两种编码给出相同结果),而文件本身读不到。**这一格我留空,没有猜。**

> **对本单的意义**:今天的对话回复**根本不是 decide 信封里的动作** —— 它是 `/chat` 返回文本后由 `telegram_device._send_reply` 单独 dispatch 出去的(`telegram_device.py:206`)。U3 切换后它才变成 `decision.kind=reply`。这正是 P1 缺口的物理面,也是 E1/E2 必须显式化的理由。

---

## 2. 信封 schema 与真实样例(脱敏)

契约见 `conversation_cycle.ENVELOPE_SYSTEM_PROMPT`。一次真实影子周期(内容虚构脱敏,结构与字段是真跑出来的):

```json
{
  "meaning_assessment": [
    {"item": "有话没送出去: 「昨晚那份对比我跑完了」",
     "meaning": "他根本没看到我说过这句, 现在这轮不重说一遍, 他会以为我一直没动",
     "pull": 0.85},
    {"item": "活跃关切: 影子期的读数够不够判", "meaning": "样本少这件事我自己也惦记着", "pull": 0.5}
  ],
  "decision": {
    "kind": "reply",
    "content": "昨晚那份对比我跑完了 —— 上一条没送到你手上, 所以再说一遍。结论我还没验完, 别当定论。",
    "reason": "他根本没看到我说过这句, 现在这轮不重说一遍, 他会以为我一直没动"
  },
  "inner": {"thoughts": [{"content": "送达失败这件事我现在能自己看见了",
                          "kind": "observation", "charge_hint": 0.6}], "resolve": []},
  "情绪脉冲": ["normal_interaction"]
}
```

`kind ∈ {reply, silence, tool_call, promise_followup}`;`tool_call` 另带 `decision.tool = {name, arguments}`。

**情绪脉冲的语义收口**:它只能是 `regulation.CAUSES` 的**名字**,不能是数值。因为 `apply_regulation_cause` 按名字查表取 delta —— 幅度不由调用方给。所以即便将来切换后真去 apply,她也不可能凭一个信封给自己的调节场任意赋值。`sanitize_pulse` 对不在表里的名字、对字典/数值形态一律丢弃。

---

## 3. 影子事件样例(`events.jsonl` 真正落下的那一行)

```json
{
  "event": "u3_shadow_envelope",
  "elapsed_ms": 3120,
  "kind": "reply", "demoted": false, "demote_why": null, "original_kind": null,
  "would_send_chars": 46,
  "would_dispatch": null, "would_dispatch_arg_count": 0,
  "pulse": ["normal_interaction"],
  "inner_thoughts": 1, "inner_resolve": 0, "inner_applied": false,
  "assessment_entries": 2, "grounded": true,
  "old_chars": 21, "new_chars": 46, "delta_chars": 25,
  "head80_equal": false, "common_prefix_chars": 0,
  "head80_old_sha": "8d228f75aabcc33f", "head80_new_sha": "b24062e716be96b8",
  "receipt_backing": {"has_action_claim": false, "receipt_available": false,
                      "unbacked_claim": false, "matched_verb": null},
  "tool_turn": false
}
```

**不落原文全文**:只有长度、公共前缀长度和两个 sha256 头。从 `events.jsonl` 重建不出她说过什么。`would_dispatch` 只记工具名与参数**条数**,URL/文本不进事件(用例 `test_shadow_records_would_dispatch_intent_without_executing` 断言 `secret.example` 不出现在事件里)。

失败另落 `u3_shadow_failed{error_type, elapsed_ms}`,不重试。

---

## 4. 逐判据自证

### ① 信封周期(本体)

`src/lykoi/cognition/conversation_cycle.py`(443 行,新)。

**输入原样**:影子**从不调用 `_assemble`**。它读的是 `_completion` 在本轮第一次装配时留下的浅拷贝快照(`conversation.py` `_shadow_input`)—— 那就是旧路径真正发出去的那一份。这不是省事,是必须:`_assemble` 有副作用(`_volatile_tail` 写 `_last_injected_thought_ids`,`_undelivered_block` 写 `_pending_undelivered_ids`),多调一次,旧路径这一轮的 inner resolve 就可能落到另一批 id 上。用例 `test_the_shadow_input_is_exactly_what_the_main_route_received` 断言:影子的 messages 去掉末尾一条契约后,与 main 收到的那份**逐字节相同**。

**唯一追加的一条**是生成点上的信封契约,地位等同于自主路径的 `DECIDE_SYSTEM_PROMPT`(它不是她处境的一部分,是"现在请产出一个信封"这件事本身;没有它就没有信封)。放在最后而非中间,因为易变尾部已经占住生成点前的位置,插到中间会把 U2 理顺的缓存边界又顶回去。

**护栏复用,一行未重写**。`evaluate_message` 增四个关键字(`kinds` / `content_required` / `safe_kind` / `envelope_fields`),默认值复现 U2 后的自主契约。刻意**没有**参数化的是纪律本身:demote、fail-closed 三个注入 id 门、逐字溯源、safe_kind 不被降级。

共享代码改动**逐处列明**(forbidden 要求两情境都测):

| 改动 | 自主侧证明 | 对话侧证明 |
|---|---|---|
| `evaluate_message` 增 4 关键字 | `test_autonomous_path_defaults_are_byte_identical_after_the_shared_change` | `test_every_conversation_kind_is_accepted` |
| kind 表隔离 | `test_conversation_kinds_are_rejected_by_the_autonomous_context` | `test_autonomous_kinds_are_rejected_in_the_conversation_context` |
| `CONTENT_REQUIRED_KINDS`/`SAFE_KIND` 提常量 | 取值断言 | `test_reply_requires_content_but_silence_does_not` |
| `_demote` 增 `safe_kind` | 默认 `"rest"` | `test_ungrounded_reason_is_demoted_to_silence_not_rest` |
| `Decision.envelope` + `as_dict` 丢弃表加 `{}` | `test_autonomous_decision_json_gains_no_new_key` | `test_envelope_fields_ride_through_evaluate_message` |
| 自主候选表 | `test_autonomous_candidate_table_is_untouched`(`build_candidates` 一行未动) | 对话情境有自己的静态表 |

**沉默是决策有账**:`kind=silence` 照落 `u3_shadow_envelope`,只是无出站文本(`test_shadow_silence_is_a_decision_with_an_account`)。失败方向 = 沉默,不是乱说(不变量 3)。

### ② P1 落地

见 §1(d)与下表。`src/lykoi/kernel/policy_exemption.py`(112 行,新)。19 passed。

| | 盖章点 | 验证 |
|---|---|---|
| **a) E1** | `approval_conversation._send`(S3)+ `suggestion_conversation._send`(L5) | 递归负向断言:问句出站命中 E1,**恰好一次 send**,不产生嵌套审批;被问的动作照旧没执行 |
| **b) E2** | `telegram_device._send_reply` | 恰好一次 dispatch、无问句、无 pending;沉默落 `u3_shadow_envelope` |
| **c) 负例①** | 工具不降级 | 带 E2 章的 `browser.*`/`notify.owner`/`messenger.read` 照旧 `ask`;带 E1 章的 `terminal.exec` 照旧撞硬门 |
| **c) 负例②** | 伪造不了 | 九种伪造(字符串 `"E1"`、字典、列表、`1`、`True`、`object()`、往 params 塞 `exemption`/`category`/`origin`)全部落空;类别不合法的 `Exemption` 构造即抛 |
| **c) 负例③** | 非对端不命中 | 跨情境 / 无收件人 / `context_id=None` / `params=None` / 空对端 五种全部回落 `ask` |

**最要紧的安全论证 —— 只能收紧,不能放宽。**`covers()` 在 `check` 里的位置是**最后一步**,排在不可变硬规则、能力面、live `always_deny`、hard ask、`always_allow`、scoped grant 全部之后,与 WO-P2-S2 的 scoped grant 同一位置同一纪律。一枚章能做的全部,就是把一个本会落到默认 `ask` 的**纯文本出站**变成 `allow`。三条守卫用例:`always_deny` 压过任何章 / 章不能加宽 autonomous 能力面 / 章不能加宽 scheduler 地板。

**标记放在 `DispatchContext` 而不是 `params` 上,这就是全部安全论证** —— context 由已知代码路径构造,params 可能被模型输出或环境内容塑形。`covers()` 只从 params 读一个键(E2 的 `context_id`,拿来做精确相等),类别一个字节都不从 params 来。

**我实现时自查出并补上的一条守卫**:E2 的前提是"user-authenticated 来话",而那个认证不在豁免层 —— 在上游 `_handle_message` 的 `_is_bound` 闸(`telegram_device.py:350`)。新增 `test_e2_is_unreachable_without_inbound_authentication`:未绑定发信人根本走不到 `_send_reply`。没有这条,"E2 只覆盖已认证来话"就只是文档里的一句话。

**今天可观测影响为零** —— §1.2 实测证明这些 send 在第三层就被放行,根本走不到豁免层。今天它是冗余保险(附文 §5),切换后才承重。

`approval_rules` 永无写路径:AST 静态断言本模块零写动词。S3/L5 的 kernel 层 `reply_to` 先行拦截一行未动。

### ③ P2 回执背书 v1

提示词"事实约束(不是建议)"段首条即回执背书,含"没干过的不说干过"。

探针 `annotate_receipt_backing` 是**纯函数**,判定规则全在三个常量元组里。**宁漏勿误**是唯一调参方向,三条都朝"不标注"倾斜:①必须命中动词白名单;②必须同时有完成标记;③命中意图/疑问标记则整句作废。白名单只收真有 dispatch 回执可对的动作(浏览/截图/发送/通知/终端),不收"想/看/觉得"—— 收了它们,"有回执可对"就永远是 False,统计也就没意义。

真值表用例:3 正例 + **6 个必须为 False 的反例**(意图"要"、意图"会"、疑问"吗?"、无完成标记、动词不在白名单、空串)。

`receipt_available` 不由文本推断:`(信封本身提了 tool_call) or (本轮上下文里已有成功的工具回执)`。后者只读快照,失败方向同样是"宁可判 True"(解析不出的 tool 消息按有回执算)。有意思的那一格是 `unbacked_claim`(说做过 + 无回执),它进影子事件,3 天统计盯的就是它。

> **诚实标注一处已知漏检**:§2 样例里"昨晚那份对比我跑完了"没有被标成动作性陈述 —— 白名单收的是"跑了",而文本是"跑完了",不是子串。这正是宁漏勿误的方向在起作用(漏一个样本,不是造一个假阳性),但也说明 v1 的召回率不高。3 天统计若发现 `has_action_claim` 命中率过低,该在切换单里补白名单,而不是现在放宽判据。

### ④ inner 通道在新路径消亡

新路径无分隔符概念,不 import `extract_inner_from_reply`;想 = 信封的 `inner` 字段本体。`apply_inner` 的事件名改为由 `source` 派生(`f"{source}_inner_applied"`),对现存两个 source **逐字节等价**(`wake`→`wake_inner_applied`,`conversation`→`conversation_inner_applied`),于是切换后新路径的落账与旧路径天然可辨。旧的两个遗迹(`conversation.py:372/556`)只余旧路径引用,随切换单退役。

### ⑤ 影子双跑(D4)

副作用清单**穷举**,反面由 `test_the_shadow_dispatches_nothing` 钉住(把 `dispatch` / `enqueue_pending` / `request_approval` / `chat_outbox.append` / `apply_inner` 五个口全部插桩,断言零次命中):

1. 一次 `conversation_shadow` 路由的 LLM 调用;
2. 一条 `u3_shadow_envelope` 事件。

没有第三样。

**fire-and-forget 而不是 inline await**:判据⑥ 的原话是"永不影响旧路径回复"。inline 会把影子的整个时延加在 Kevin 等回复的那条线上 —— 那不是不影响,那是把影子的成本转嫁给他。`test_send_returns_before_the_shadow_finishes` 用一个卡住的影子证明 `send` 已经返回。任务引用存模块级 `_SHADOW_TASKS`(asyncio 只持弱引用,不留强的 GC 会把它收走)。

**切换是独立动作**:`LYKOI_U3_SWITCH_ENABLED` 默认关,且**生产代码里零个读者** —— `test_no_module_reads_the_switch_to_release_a_side_effect` 静态扫全树,唯一命中是它自己的定义处。切换单要做的第一件事就是给它加第一个读者,那时这条用例会红,那正是它该红的时候。

### ⑥ 时延预算(D1)

逐轮记 `elapsed_ms`(`time.monotonic`,带 `# realtime-allow:` 尾注:时延预算必须量真实墙钟,虚拟时钟会把 15s 判据变成空话;`test_gate5_l1_scan` 已通过)。事件另记 `tool_turn`,好让验收线"**非工具轮**中位 <15s"能真按非工具轮算 —— 工具轮的耗时是工具的,不是架构的。

影子失败(异常/超时/信封畸形)只 log 一条 `u3_shadow_failed`,返回 None,**不抛、不重试**;超时上限 `LYKOI_U3_SHADOW_TIMEOUT_S` 默认 60s。`test_a_dead_shadow_never_breaks_the_turn` 断言旧路径回复不受影响。

> **验收线本身现在还判不了** —— 需要 3 天真实读数。本单交付的是量它的仪器。

### ⑦ usage 记账连续性

新路由 `CONVERSATION_SHADOW = "conversation_shadow"`。`llm_client` 按 `cfg.route` 记四数(`llm_client.py:137-146`),标签一加自动分栏。`test_shadow_uses_its_own_route_and_never_main` 断言影子调用的 route 既不是 `main` 也不是 `autonomous_cognition`。两个既有 builder 一字未动。

同模型、同凭据、同 thinking(要对比的就是 main 这条路上的她),只有 `LYKOI_SHADOW_*` 三项可独立覆盖。

### ⑧ 零扰动

对 `conversation.py` 的改动共三处,全是纯增量:`__init__` 加一个 `None` 字段;`send()` 开场清空 + 收工后 `_spawn_shadow`;`_completion` 在 `complete()` 之前留一份 `list(messages)` 浅拷贝。

四条零扰动用例:

- 发给 main 的 payload,影子开与关**逐字节相同**;
- 返回的 reply,影子开与关相同;
- `_assemble` 的**调用次数**,影子开与关相等;
- `_last_injected_thought_ids` / `_pending_undelivered_ids` 在影子跑完后仍是旧路径留下的那份。

另:回合抛异常整轮回滚时影子不跑;一轮一份快照,不留残留。

**⑧ 的二选一 —— 本单选"inner 只记不落",理由**:影子与旧路径同轮读同一批 `_last_injected_thought_ids`。若影子也 `apply_inner`,它创建的念头会挤占 `THOUGHT_OPEN_CAP`(7 条硬上限)、它 resolve 掉的 id 会让旧路径同一轮的 resolve 变成 `rejected_resolve` —— 两条都是**活体行为的可观测改变**,直接违反"逐字节不变"。所以消毒后只进事件计数(`inner_applied=False` 钉在事件里),不进 `apply_inner`(`test_shadow_counts_inner_but_never_applies_it` 断言零次)。切换后这层顾虑消失。

**不新增写路径**:AST 静态扫描断言 `conversation_cycle` 不调任何写动词、不 import `lykoi.kernel` / `lykoi.resources` / `chat_outbox`,唯一持久化出口是 `log_event`。

---

## 5. 判据⑨:全邻接测试(前台串行,逐条归因)

**"conversation 21 文件口径"已核实**:全仓恰好 21 个既有测试文件 import/触及 `cognition.conversation`,本单新增 3 个,合 24。

我跑的是**全量 132 文件**(比工单要求的邻接集更宽),因为我动了 `kernel/approval.py` 与 `kernel/dispatch.py` 这两处中枢,只跑邻接不足以负责。全量单次运行超过工具的 600s 前台上限,故按 8 段前台串行跑完,每段一律 `timeout 1800` 包裹,无后台、无并行:

| 段 | 内容 | 结果 | 耗时 |
|---|---|---|---|
| 1 | 对话核心 12 文件(含 3 个 U3 新文件) | 229 passed | 6:42 |
| 2 | `test_p2_s3_approval_wiring` | 40 passed | 1:41 |
| 3 | 信封/治理/L5/interpreter 14 文件 | 223 passed, 1 skipped | 4:06 |
| 4 | telegram/messenger/gate5/integrity/decide 11 文件 | 162 passed, 4 skipped, **1 failed** | 3:22 |
| 5 | core_v1 等 47 文件 | 715 passed, 1 skipped, **2 failed** | 7:11 |
| 6 | gates + L1–L4 8 文件 | 159 passed | 11:26 |
| 7 | mind store/thoughts/notifications 13 文件 | 206 passed | 7:51 |
| 8 | p0–p4 + 其余 26 文件 | 248 passed | 7:18 |

**合计:1982 passed / 6 skipped / 3 failed。**

### 3 个失败,逐条归因

1. `test_p0_integrity::test_committed_manifest_matches_available_protected_sources`
   `PermissionError: /home/lykoi/state/approval_rules.json` —— **工单基线明列的"claude 身份 approval_rules 0600 假失败"**。与 §1.1 同源:0600 属主 lykoi,执行方读不到。非回归。

2. `test_core_v1_shadow::test_secret_params_are_rejected_before_shadow_and_result_is_redacted`
3. `test_core_v1_shadow::test_redacted_dictionary_key_collisions_preserve_every_value`
   两条同因:`AttributeError: lykoi.kernel.redaction has no attribute '_SECRETS'`。**已在基提交 `2b8c477f` 上实跑复现,失败一模一样**(`git diff --name-only 2b8c477f..HEAD -- '*redaction*'` 为空,本单没碰过 redaction)。属基线 3 failed 的一部分。

对基线的核对:基线 `3 failed / 1852 passed`(2026-08-13)。现在 `3 failed / 1982 passed`,失败集合完全相同。passed 增量 +130 来自 U2 之后合入的用例与本单新增的 81 条(48 + 19 + 12 + 2 条新加在 S3 套件里)。

### ⚠️ 需要 owner 追认:S3 审批环四条既有断言的口径变更

单独一个 `tests:` commit(`8037ab95`),沿用 WO-U2 `2b8c477f` 的先例。这四条编码的是 **P1 之前**的世界(她的问句自己也撞门);P1 附文 §4.1 把"审批问句路径不经对话门"直接写成 U3 判据,所以它们是被本单**按工单要求**取代的旧口径,不是被碰坏的。

每一条我都保留了它真正守的那个不变量:

| 原用例 | 变化 | 守的东西 |
|---|---|---|
| `..._question_that_itself_needs_approval_is_not_asked_about` | `send_failed` → `asked` | 恰好一次 send / 无嵌套问句 / 无增长的链 —— **三行断言原样保留**;另加两条钉 E1 边界②(被问的动作照旧没执行) |
| `..._device_reply_needing_approval_asks_once_and_does_not_recurse` | "一次受阻 + 一个问句" → "一次 dispatch 就成" | 仍是恰好一次 dispatch,仍无增长的链 |
| `..._records_undelivered_questions_rather_than_retrying` | 失败源:策略门 → 传输故障 | 断言内容一字未改 |
| `..._ask_that_cannot_go_out_says_one_short_sentence...` | 同上 | 那句人话一字未改 |

顺带删掉 `_gate_only_stranger` 辅助函数(签名在 `check` 增参后对不上,且它模拟的 §2b 形状正是被 E2 取代的东西),新增两条:E1 结构标记的机制面、E2 的认证前提。

---

## 6. 判据⑩:manifest 重签 108 → 110

**新增 2 条**(本单仅有的两个新受保护源,分落 `cognition/` 与 `kernel/`,两个 glob 都会扫到):
```
src/lykoi/cognition/conversation_cycle.py   45a4e6d8…
src/lykoi/kernel/policy_exemption.py        69697732…
```

**改哈希 8 条**:`conversation.py` `09934099→7cea2d0c` / `llm_router.py` `66b5e15f→1d6466f6` / `approval.py` `e7d82dfa→950ded62` / `approval_conversation.py` `1eabec58→7c7f02df` / `dispatch.py` `ebd45a90→63fabbfa` / `suggestion_conversation.py` `512add46→b13810db` / `decide.py` `dfd8a513→398a407e` / `telegram_device.py` `d48de046→72979b2e`。

两条新增按 key **插到排序位**而非追加(manifest 本来有序,重写脚本里有 assert 钉住)。

`--write-manifest` 在本工作机仍跑不完(要哈希 owner 域 0600 文件),沿用 WO-U2 `67adbd11` / WO-U1 `60b12c0c` 先例:只逐行同步本次改动的源文件,那一行读不到的锚原样保留。另跑同逻辑但跳过不可读路径的核对:

```
受保护源 110 个 | 逐条核对通过 109 | 缺条目 0 | 哈希不符 0 | 读不到 1
manifest 条数 110 | 多余条目 0
读不到(原样保留): /home/lykoi/state/approval_rules.json (PermissionError)
```

### 教训 36 核对

**落在 state 目录的路径常量:零。**本单没有新增任何持久化文件 —— 影子唯一出口是既有的 `events.jsonl`(`LYKOI_EVENTS_PATH`,conftest 早已隔离),豁免层没有写路径。静态守卫 `test_no_state_path_constant_points_at_the_live_state_dir` 不受影响。

conftest 补了一条 `LYKOI_U3_SHADOW_ENABLED=0`。理由与教训 36 同源,只是这次漏的**不是路径而是行为**:影子挂在 `send` 的收尾上,于是每个碰 `send` 的既有用例都会顺带驱动一次影子,往它们插桩的 `llm_router.complete` 上多打一次调用。测试里默认关,想测的自己 setenv 打开;生产默认值由 `test_shadow_gate_defaults_open_but_is_killable` 钉住。

---

## 7. 部署核对信息(合并包用)

### 新代码跑在哪

| 模块 | 进程 / systemd 单元 |
|---|---|
| `cognition/conversation_cycle.py`(影子周期) | **`lykoi-server.service`** —— `Conversation` 是 server 进程的单例(`surface/app.py:139`),影子挂在它的 `send` 上。**进程再布局不属本单**(C 线心脏单领地),没有迁移。 |
| `kernel/policy_exemption.py` | 三个进程都 import(`approval`/`dispatch` 的依赖):`lykoi-server` / `lykoi-autonomy` / `lykoi-telegram` |
| E1 盖章(`approval_conversation`) | `lykoi-telegram.service`(S3 审批环在设备进程跑) |
| E1 盖章(`suggestion_conversation`) | `lykoi-autonomy.service`(L5 建议队列在 wake 循环里驱动) |
| E2 盖章(`telegram_device._send_reply`) | `lykoi-telegram.service` |
| `llm_router` 新路由 | 随 `lykoi-server`(影子是唯一消费者) |

### EnvironmentFile:**无需新增**

影子复用 DeepSeek 凭据(`LYKOI_DEEPSEEK_API_KEY` / `LYKOI_DEEPSEEK_BASE_URL`),已在 `lykoi-server.service` 的 `EnvironmentFile=/home/lykoi/secrets/llm.env` 里。三个单元的 EnvironmentFile 清单一行不用改。

### 新 env 键 7 个(全是开关/模型参数,**都不指向文件**)

| 键 | 作用 | 生产默认 | 是否需在合并包里显式设置 |
|---|---|---|---|
| `LYKOI_U3_SHADOW_ENABLED` | 影子双跑总开关 | **开** | 否(默认即所需);出质量/成本问题时设 `0` 即可停,无需回滚代码 |
| `LYKOI_U3_SWITCH_ENABLED` | **切换**开关 | **关** | **否 —— 本单绝不设置它。**切换是切换单 + Kevin 批准后的独立动作 |
| `LYKOI_U3_SHADOW_TIMEOUT_S` | 影子超时(秒) | 60 | 否 |
| `LYKOI_SHADOW_MODEL` | 影子模型 | 继承 `LYKOI_MAIN_MODEL` | 否 |
| `LYKOI_SHADOW_MAX_TOKENS` | 影子 max_tokens | 4096 | 否 |
| `LYKOI_SHADOW_TEMPERATURE` | 影子 temperature | 继承(未设则不下发) | 否 |
| `LYKOI_SHADOW_THINKING` | 影子 thinking | 继承 `LYKOI_MAIN_THINKING` | 否 |

**新增路径/文件:零。**部署后需 root 重签 manifest 才能过启动闸(与 kernel 同一条部署纪律)—— manifest 已在本分支重签好,root 侧照常核验即可。

### 成本提示

影子每个 inbound 轮多打一次 main 同级模型调用,prompt 与 main 同量级(约 8k tokens)。3 天影子期的增量成本 ≈ 对话轮数 × 一次 main 调用。读数在 `llm_call{route="conversation_shadow"}` 一栏,与 U2 的两条读数完全隔离。

---

## 8. 三天后治理侧复核该看什么

```
events.jsonl | event=u3_shadow_envelope
  ⑥ 时延:  median(elapsed_ms) where tool_turn=false   验收线 <15000
  ③ 背书:  count(receipt_backing.unbacked_claim=true) / count(*)
  ⑤ 分歧:  kind 分布(reply/silence/tool_call/promise_followup)
           head80_equal 比例、delta_chars 分布
  ①  护栏:  count(demoted=true) 与 demote_why 分布
  ④  念头:  inner_thoughts / inner_resolve 的量级(切换后它们会真的落库)
events.jsonl | event=u3_shadow_failed → 失败率与 error_type
llm_call     | route="conversation_shadow" → 成本与 cache 命中
```

不达标不切。切换开关默认关,今天生产代码里没有一个读者。

---

## 9. 两处需要 Kevin / 治理侧定夺的事

1. **S3 四条断言的口径变更**(§5 末)——按 P1 附文执行,但改动了既有安全断言,请追认。
2. **判据②d 留空的那一格**:今天放行的 `always_allow` 条目是裸 `messenger.send` 还是 `messenger.send@user:<owner>`,执行方读不到文件、也无法从审计区分。若治理侧要闭合这一格,需要一次 root/lykoi 身份的读取。这关系到切换后的行为:若是**裸条目**,则 E2 之外还有一条更宽的放行路径一直开着,切换单应考虑收窄它(附文 §5 说预授权"退化为冗余保险,不删",而裸条目比 §2b 描述的 scoped 预授权宽得多)。**我没有猜,也没有去绕过那个 0600。**
