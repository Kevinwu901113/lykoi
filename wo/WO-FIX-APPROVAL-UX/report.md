# WO-FIX-APPROVAL-UX 报告

分支 `wo/fix-approval-ux`(从 `wo/l5` 尖 `71a72720`),三个 commit:`3b8b1e61`(③④)、`d6687943`(①②)、`e2609878`(manifest)。

---

## 判据① 执行结果主动回报 — `kernel/approval_conversation.py`

`granted`/`execute_once` 是 `handle_owner_answer` 四个出口里唯一不回话的分支;执行完 `observation` 直接丢掉,Kevin 得再发一条消息才能把结果带出来。

**改动点**
- `approval_conversation.py:79-95` — 四条文案常量 + `RESULT_MAX_CHARS = 1500` / `RESULT_TRUNCATED`。
- `:315-345` `_truncate` / `_result_body` — 依次取 `stdout`/`output`/`result`/`text`/`content`,再拼 `stderr`,都没有就 JSON dump;超长截断并写明"这里只显示前 1500 字"。
- `:348-367` `execution_report` — 成功「做完了: <describe_action>」+ 正文;失败「跑了, 但出错了」+ error;没执行成(竞态/过期)一句说明。描述用的是问句同一个 `describe_action`。
- `:370-390` `_report_execution` — 整段 try/except,发送异常或被拒只落 `approval_result_report_failed` telemetry,**不动已完成的执行**。
- `:452-456` 接线 `replied = await _report_execution(..., _reply_ref(message_id))` —— 引用 Kevin 的批准消息(S1A 豁免打扰预算);出站仍走既有 `_send` → `dispatch messenger.send`,脱敏/审计照常。`AUDIT_ANSWER_ROUTED` 的 `replied` 由此变成真值。

**测试**(`tests/test_p2_s3_approval_wiring.py`)
- `:799` 成功回报引用了批准消息(`report["reply_to"] == "78"`)+ 审计 `replied is True`
- `:823` 输出截断且注明
- `:839` 失败回报
- `:850` **发送失败不影响执行结果**:回报 `_send` 抛异常,`executed is True`、动作仍恰好执行一次、执行审计 `success is True`、`replied is False`

## 判据② 老横幅退役 — `cognition/conversation.py`

**改动点**
- `:347` `_approval_prompt` 整个删除(那段 `POST /approvals/{id}/approve` 是 Mac 时代遗物;08-12 每个撞门的工具步都重播一次 → 4 连横幅)。换成 `ASK_FALLBACK` + `_owner_context()`(只读 `mind_store.owner_channel_key("telegram")`,无硬编码/无环境变量)。
- `:800` 调用点由 `enqueue_pending` + 横幅改成 `return await self._ask_for_approval(action, observation.data)`。
- `:838-872` `_ask_for_approval` — 调 S3 `request_approval`;`asked`/`already_pending` 一律返回 `""`(**沉默**,问句本身就是那条消息);没绑 owner / 预算 / 传输失败 → `ASK_FALLBACK`(「这事需要你点头, 我稍后再问。」,不带端点)。surface 的 POST 端点本身保留。

**测试**
- `:928` 横幅文本不再出现:源文件里 `我想执行动作`/`批准：POST` 均不存在、`_approval_prompt` 属性不存在、问出去的那条不含 `POST`
- `:950` 问在他的对话里 + 回合沉默
- `:961` **同一 pending 不重复播报**:三次调用 → `first == second == third == ""`,只问一次、只排一条
- `:976` 问不出去回一句人话,队列里不留空悬行
- `:988` 没绑 owner 一个字都不发

## 判据③ 确定性快通道 — `kernel/approval_interpreter.py`

`clarify_text` 对硬门动作承诺了「请直接回「执行」或「不要」」;08-12 判读器 LLM 在 telegram 进程 KeyError,字面「执行」一律 clarify。

**改动点** `:650-694` `LITERAL_EXECUTE`/`LITERAL_DENY`/`literal_verdict`/`_fast_path_interpretation`;`:783-797` 在 `interpret` **之前**接线,`len(live) == 1` 时才生效。approve 合成 `scope="this_only"` → 经既有 `gate` 落到 `execute_once`,标准动作也产不出常设授权。

**测试**(`tests/test_p2_s2_approval_interpreter.py`)
- `:282` LLM 抛异常时字面「执行」仍 `execute_once`,`calls == []`
- `:298` 字面「不要。」→ `denied`,不问模型
- `:308` 标点/空白容忍;`:316` 只放行两个词(「执行吧」「先别执行」「不」全 None)
- `:322` 标准动作也只 `execute_once`,`standing_grants() == []`
- `:338` 多条悬置时字面词照走 LLM 与归属消歧 → `clarify`

## 判据④ 前置过滤词表 — 同文件

`resolve_target_detail` 的引用分支:引用落空即 `NO_MATCH_CHITCHAT`,Kevin 引着一条没登记成问询的消息回「批准」,判读器根本没看到。

**改动点** `:83-105` `OWNER_ANSWER_WORDS`(批准/同意/好/可以/行/不行/别/算了/拒绝…)+ `looks_like_an_answer`;`:447-456` 引用落空但这句话本身就是应答时,落到未引用信号(语义/条数/时近)而不是直接判闲聊。保守方向不变。

**测试**
- `:359` 引用落空的「批准」进得了判读器(`len(calls) == 1`)→ `granted`
- `:377` 词表识别 + 真闲聊仍不算应答
- `:385` 引用落空 + 多条悬置 = 追问,一条不放行
- `:401` **进得去不等于过得了**:判读器回 unclear 仍是 `clarify`
- `:254` 原 chitchat 用例改判:用一句真闲聊(「这个图我等下再看」),断言 `calls == []` —— 该用例原来编码的正是这次修的病灶行为

---

## 判据⑤ 运行清单(前台串行,原样)

```
tests/test_p2_s3_approval_wiring.py        38 passed in 81.90s
tests/test_p2_s2_approval_interpreter.py   63 passed in 15.03s
tests/test_l5_suggestions.py               30 passed in 149.48s
conversation 邻接(见下)                    116 passed, 1 skipped in 166.58s
                                           1 failed, 110 passed in 113.85s
tests/test_p0_integrity.py                 1 failed, 20 passed, 4 skipped in 0.21s
```

conversation 邻接清单先列后跑 —— `grep -rl "conversation"` 命中 54 个文件多是词面误命中,收窄成真正 import/驱动 `cognition.conversation` 的 **21 个**,全部跑到:
`test_chatloop / test_conversation_inner / test_dsml / test_followup / test_governance_invariants / test_inner_outer_pair / test_p0_context / test_p0_surface_errors / test_pending_hygiene / test_persona` + `test_core_v1_m3_r2c_{r12,r1,s4,s5,s6,s7,s9} / test_mind_beat / test_mind_red_lines / test_mind_thoughts_outlets` + 已单列的两个 approval 文件。

**两条 failed 都是环境既有,与本工单 diff 无关 —— 已在 `wo/l5` 干净 worktree 上逐条复现确认:**

1. `test_core_v1_m3_r2c_r12_code_rollout::test_controller_is_executable_canonical_and_shell_valid` — `scripts/patches/.../root_apply.sh` 磁盘上是 `0o775`,git index 里是正解的 `100755`,是本次 checkout 的 umask 漂移。基线 worktree 同样 failed。修法是 `chmod 755`,但该命令被本会话权限层拒绝,**未执行**,留给你或有权限的一侧。
2. `test_p0_integrity::test_committed_manifest_matches_available_protected_sources` — 现在卡在 `PermissionError: /home/lykoi/state/approval_rules.json`(root 属主的活体规则文件,本 agent 以 `claude` 身份跑读不到)。基线 worktree 一字不差同样 failed。**本工单该负责的那部分(三条源哈希)已经过了** —— 重签前它报的是 `approval_conversation.py` 哈希不符,重签后才走到这个越界文件。

## 判据⑥ manifest

条数 **107 → 107**(不新增锚,只重算三条):

| 文件 | 前 | 后 |
|---|---|---|
| `src/lykoi/cognition/conversation.py` | `a6a734c8…` | `15f43b9c…` |
| `src/lykoi/kernel/approval_conversation.py` | `7c06bf93…` | `1eabec58…` |
| `src/lykoi/kernel/approval_interpreter.py` | `e7ce225c…` | `f670587f…` |

硬约束核对:判读失败方向仍是 clarify/unclear,快通道只放行两个字面词;`approval.py` 的 consume/grant 语义、guardian、L5 建议队列一行未动。
