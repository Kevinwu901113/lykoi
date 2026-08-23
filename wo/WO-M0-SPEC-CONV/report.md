# WO-M0-SPEC-CONV · 对话路径行为规格提取报告

**基线**：`~/lykoi-work-m0/`，活体 HEAD `4463ae8` (tag `cordis-night-20260822`) 的只读文件树副本。所有 `file:line` 以此副本为准。零写入已遵守（本报告只读代码，未修改工作区任何文件，未触碰 `/home/lykoi/`，未跑测试）。

**标注约定**：[事实] = 代码可直接读出；[推断] = 由代码结构推导、未经运行验证；[建议] = 移植取舍意见。

**副本缺口（如实告知）**：工作副本比活体少 5 个 `.py`（治理账户 0600 不可读）：`cognition/permission_evidence_shadow.py`、`tests/test_core_v1_m3_r2c_r{1,2,3}_*.py`、`tests/test_salience_shadow_release_audit.py`。活体 tests 154 个 `.py`，副本 150（实测 `find tests -name '*.py' | wc -l` = 150；全树 273 个 `.py`）。`permission_evidence_shadow` 在 `conversation.py:31` 被 import、在 `:1776` 与 `:1828` 被调用，本报告对它的判断一律标"文件不可读，按引用侧证据推断"。

**与工单预估的行数出入**（[事实]，`wc -l` 实测）：`conversation.py` **1889** 行（工单写 ~1623）、`conversation_cycle.py` **685** 行（工单写 ~614）。其余：`telegram_device.py` 569、`telegram_transport.py` 438、`messenger.py` 277、`approval_conversation.py` 520、`approval_interpreter.py` 860、`policy_exemption.py` 112、`surface/app.py` 346、`prompts.py` 48。

---

## §1 入站全链路时序

### 1.1 文字版时序（每步带锚点）

```
[T0] telegram_device.run_forever                          telegram_device.py:517-561
 │    ├ transport = TelegramTransport()                    :528  (无 token 即 ValueError, transport.py:213-215)
 │    ├ messenger._TRANSPORT = transport                   :529  ← 进程级单写者替换
 │    ├ cursor = _load_cursor()                            :531  ← 读 state/telegram_cursor.json
 │    ├ has_any_identity_binding 告警(不阻塞)               :533-539
 │    └ while: _poll_once(...) ; _consume_outbox_once(...) :543-558  (两个独立 try)
 │
[T1] _poll_once(transport, cursor)                        :499-514
 │    └ transport.poll_updates(offset=cursor+1, timeout=25) :504 → transport.py:395-408
 │         └ _post("getUpdates", {...}, timeout=timeout+10) transport.py:401
 │              (offset 本身就是 Bot API 侧的 ack —— 平台不会再重发 < offset 的 update)
 │         └ _normalize_update(raw) 逐条                    transport.py:411-438
 │
[T2] 逐 update：                                            :505-513
 │    ├ update_id is None or <= cursor → continue          :507  ← 进程侧去重(第二道)
 │    ├ message is not None → await _handle_message(...)   :509-511
 │    └ cursor = update_id ; _save_cursor(cursor)          :512-513 ← **处理完才推进**
 │
[T3] _handle_message(message)                             :431-494
 │    ├ sender_id / chat_id 任一为 None → 直接 return       :434-435 (无事件、无痕)
 │    ├ _is_bound(sender_id) 否 → 计数 + 落事件 + return    :436-439 / :165-166
 │    │     event: telegram_inbound_dropped_unbound
 │    ├ **入站存档**: messenger.ingest_inbound({...})       :440-448
 │    │     → messenger.py:244-277, 写 state/messenger_inbound.json
 │    │       (file_lock + write_json_atomic, 环形保留 200 条 :273-274)
 │    │       event: messenger_inbound_ingested
 │    ├ if _is_owner(sender_id):                           :454 / :169-177
 │    │   ├ approval_conversation.handle_owner_answer(...) :455-460
 │    │   │    outcome != "ignored" → **消费掉这条消息, return** :461-467
 │    │   └ suggestion_conversation.handle_owner_answer(..) :474-479
 │    │        outcome != "ignored" → **消费掉, return**     :480-486
 │    ├ turn = _normalize_turn(await reply_fn(event["text"])) :487
 │    │     reply_fn 缺省 = _generate_reply                 :182-223
 │    ├ reply_to = str(message["message_id"]) or None      :488
 │    ├ if turn["reply"]: await _send_reply(...)            :491-492  ← 先说话
 │    └ if turn["approval_request"]: await _ask_about(...)  :493-494  ← 后请示
 │
[T4] _generate_reply(text)                                :182-223
 │    ├ SURFACE_TOKEN 空 → 空回合(不抛)                     :196-198
 │    └ POST {SURFACE_URL}/chat  timeout=120s trust_env=False :200-205
 │         body = {"message": text, "delegate_approval_ask": True}   :203
 │         任何失败(HTTPError / 非 200 / 非 JSON / 非 dict) → empty  :206-217
 │         返回 {"reply": str|None, "approval_request": dict|None}   :220-223
 │
[T5] surface/app.py chat()                                app.py:224-285
 │    ├ reply_to_notification_id 校验(404/422)              :227-233
 │    ├ log_event("chat_request", message=...)  ← 全文入 events :234
 │    ├ followup_runner.cancel_pending_retry()             :236
 │    ├ await conversation.send(message, reply_to_notification=..., 
 │    │                          delegate_approval_ask=...) :238-242
 │    ├ ContextBudgetError → HTTP 413 message_too_large     :243-250
 │    ├ 其它 Exception → HTTP 502 turn_failed + 调度后台重试  :251-266
 │    ├ take_followup_request() → schedule_followup         :268-269
 │    ├ pending banner 前置(除非本轮就是审批问句)            :270-274
 │    ├ log_event("chat_reply", reply=reply) ← 全文入 events :275
 │    └ take_delegated_ask() → body["approval_request"]     :281-284
 │
[T6] Conversation.send(...)                               conversation.py:674-780
      ├ interactive_lock.mark_active()  (写 state/interactive_activity.json) :692
      ├ async with self._lock:                             :693
      │   ├ 一轮一份的六个清场: _background/_followup_request/
      │   │   _delegate_approval_ask/_delegated_ask/_cycle_inner/_shadow_input :694-701
      │   ├ switched = self._switch_on()  ← **一轮读一次开关** :704
      │   ├ checkpoint = len(self._messages)                :705
      │   ├ append {"role":"user","content":message}        :706
      │   ├ self._relevant_memories = _build_relevant_memories(message) :708
      │   ├ reply = await (_run_cycle() if switched else _run_loop()) :710
      │   │    异常 → del self._messages[checkpoint:] + chat_turn_rolled_back + raise :711-719
      │   │    finally: self._relevant_memories = None      :720-723
      │   ├ 念头出口二选一(见 §2.4)                          :728-746
      │   ├ history_id = store.append_history("conversation", {...}) :747-749
      │   ├ log_event("inner_outer_pair", reply=..., inner=...) :755-761
      │   └ mind_reflow.conversation_turn_reflow(...) (吞异常) :765-770
      ├ await self._govern_context()   ← **锁外**做摘要网络调用 :777
      ├ interactive_lock.mark_active()                     :778
      └ self._spawn_shadow(reply, switched=switched)       :779
```

### 1.2 入站合并 / 去重 / 游标语义 [事实]

| 面 | 语义 | 锚点 |
|---|---|---|
| **平台侧 ack** | `getUpdates?offset=cursor+1` 本身即 ack：Telegram 不再重发 `< offset` 的 update | `transport.py:395-401`（docstring 明写"the Bot API's own dedup"） |
| **进程侧去重** | `update_id is None or update_id <= cursor → continue` | `telegram_device.py:507` |
| **游标推进点** | 每条 update **处理完毕之后**才 `cursor = update_id; _save_cursor(cursor)`——不是批量末尾 | `:512-513` |
| **游标持久化** | `file_lock(CURSOR_PATH)` + `write_json_atomic`；`state/telegram_cursor.json`，键 `last_update_id` | `:109-111` |
| **游标损坏语义** | 损坏 / 非 dict / 非 int → **返回 0**（从头重放）。取舍："worst case is a few replays, never a crash" | `:93-106` |
| **崩溃语义** | 处理完但游标未落盘时崩溃 → 下次重放该条 → 她会**重复回一次**。这是显式取舍 | `:499-503` docstring |
| **合并** | **无合并**。一条 update = 一条 message = 一个 `/chat` 回合，串行 `await`（`:511`），无批处理、无窗口聚合 | `:505-511` |
| **非 message update** | `update.get("message") is None`（channel post / callback query）→ 不处理，但**游标照推** | `:509-513` + `transport.py:411-421` |
| **edited_message** | `_normalize_update` 把 `edited_message` 当 `message` 处理——编辑一条旧消息会触发一次**新回合** | `transport.py:415` |
| **入站存档去重** | `messenger.ingest_inbound` **无去重**：每次调用都分配新 `id` 并 append。它只在通过 `_is_bound` 之后调用一次 | `messenger.py:268-275` |
| **入站存档有界** | 环形保留最近 200 条 | `messenger.py:227, 273-274` |
| **长轮询错误退避** | `_poll_once` 抛异常 → 指数退避 1→60s（`INITIAL_BACKOFF_S=1.0`, `MAX_BACKOFF_S=60.0`）；成功即复位 | `telegram_device.py:87-88, 546-551` |
| **错误降噪** | 同类连击只记首条 + 每第 10 条，恢复补 `telegram_poll_recovered`；**不改重连节奏** | `transport.py:74, 232-261` |

**[事实] 关键分层断言**：当轮入站 `message_id` **只存在于设备层**。`/chat` 的 `ChatRequest`（`app.py:146-155`）只有 `message` / `reply_to_notification_id` / `delegate_approval_ask` 三个字段，没有 `message_id`。这是 §4 归属判定与 §7 打扰预算的结构前提。

---

## §2 信封契约逐字

### 2.1 信封字段全集（[事实]，实测计数）

**Kinds：4 个**（`conversation_cycle.py:50-58`）
```
REPLY="reply"  SILENCE="silence"  TOOL_CALL="tool_call"  PROMISE_FOLLOWUP="promise_followup"
CONVERSATION_KINDS = (REPLY, SILENCE, TOOL_CALL, PROMISE_FOLLOWUP)
```

**content 必填：2 个**（`:62`）`CONVERSATION_CONTENT_REQUIRED = (REPLY, PROMISE_FOLLOWUP)`
**失败方向：**（`:66`）`CONVERSATION_SAFE_KIND = SILENCE`
**情境专属字段：2 个**（`:69`）`ENVELOPE_FIELDS = ("tool", "情绪脉冲")`

**JSON 载荷全集**（由 `ENVELOPE_SYSTEM_PROMPT` `:149-202` 声明 + `evaluate_message` `decide.py:564-608` 解析）：

| 路径 | 类型 | 解析者 | 备注 |
|---|---|---|---|
| `meaning_assessment[]` | list[{item, meaning, concern_id?, pull}] | `_sanitize_assessment` `decide.py:333-359` | `concern_id` fail-closed 过 `allowed_concern_ids` |
| `decision.kind` | str，必在 `CONVERSATION_KINDS` | `decide.py:572-574` | 否则 `ValueError` |
| `decision.content` | str \| None | `decide.py:576-582` | `reply`/`promise_followup` 空白即 `ValueError` |
| `decision.tool` | `{name, arguments}` | 抬入 `envelope` `decide.py:604-608` → `sanitize_tool` `cycle:227-251` | |
| `decision.reason` | str | `decide.py:584` | grounded 闸的输入 |
| `decision.url` | str \| None | `decide.py:594` | 对话侧未消费 |
| `decision.thread_id` / `concern_id` | int \| None | `_gated_int` `decide.py:379-388` | fail-closed 注入 id 门 |
| `inner.thoughts[]` | ≤2 条 | `_sanitize_inner` `decide.py:398-461` | kind 白名单 5 值、content ≤200 字 |
| `inner.resolve[]` | int[] | 同上 `:450-459` | 只留 `injected_ids` 内的 |
| `情绪脉冲` | str[] | `sanitize_pulse` `cycle:254-268` | 只认 `regulation.CAUSES` 的 **15** 个名字，去重保序 |
| `next_wake_after_minutes` | int \| None | `decide.py:585, 598` | 对话侧未消费 |

**`Decision` dataclass 字段：15 个**（`decide.py:84-110`）。
**`envelope` 出参：2 键**——`parse_envelope` `cycle:289-292` 把 `("tool","情绪脉冲")` 重写成 `{"tool": ..., "pulse": ...}`。

### 2.2 护栏（三道，逐条）[事实]

| 护栏 | 位置 | 语义 |
|---|---|---|
| **safe_kind 免辩护** | `decide.py:613-614` | `kind == silence` **直接返回，永不降级**。"安静不需要辩护" |
| **候选表闸** | `decide.py:615-617` | kind 不在 `{c.kind for c in candidates}` → `_demote(..., "kind_not_in_candidates")` |
| **grounded 引用闸** | `decide.py:618-619` | `grounded_entries(assessment, reason)` 为空 → `_demote(..., "reason_not_grounded")` |
| **grounded 判据** | `decide.py:362-372` + `GROUND_MIN_CHARS=4` `:72` | `entry["item"]` 或 `entry["meaning"]` 的**逐字文本**（去空白后 ≥4 字）必须出现在 `reason` 里 |
| **demote 效果** | `decide.py:623-629` | `original_kind` 存旧值 → `kind = safe_kind` → `demoted=True` / `demote_why` → **`grounded_concern_ids` 清空** |
| **fail-closed 注入 id 门（念头）** | `decide.py:414, 458` + `apply_inner` `:502-507` | `resolve` id 必须 ∈ 本轮注入集；解析层 + store 层**两道** |
| **fail-closed 注入 id 门（关切/线程）** | `decide.py:379-388, 568-569` | `allowed` 空 → 丢弃全部 id + `grounding_concern_out_of_snapshot` |
| **脉冲不可自定幅度** | `cycle:254-268` docstring | 信封只能报**名字**，delta 由 `store.apply_regulation_cause` 查表；表外名字静默丢弃 |
| **tool 不做白名单** | `cycle:227-233` | 只做形状 / 边界（name ≤64 字 `_TOOL_NAME_MAX`，arguments JSON ≤2000 字 `_TOOL_ARGS_CHARS_MAX`）；合法性归 `dispatch.KNOWN_ACTIONS`（**18** 项）/ `_build_action` |

**[事实] 关键推论**：`tool_call` 走的是**同一条 demote 护栏**。一个 `kind=tool_call` 但 `reason` 未逐字引用任何评估条目的信封，会被确定性降级为 `silence`——工具**不执行**，`_run_cycle` 在 `:1485-1489` 直接 `return ""`。见 §6b。

### 2.3 解析失败的每条路径与终态 [事实]

`parse_envelope` → `evaluate_message` 的抛出点，按 `classify_failure` (`cycle:396-447`) 的复验顺序（**六个归因**，`FAILURE_REASONS` 实测 6 项 `:316-323`）：

| # | 触发 | 抛出点 | reason | detail | 终态（切换态） |
|---|---|---|---|---|---|
| 1 | `_extract_json` 失败（非 JSON / 空 content / 截断） | `decide.py:319-330` | `not_json` | `first_char:{empty\|fence\|brace\|bracket\|quote\|digit\|ascii_alpha\|cjk\|other}` (`cycle:332-358`) | `u3_cycle_failed` + `return ""` → **沉默** |
| 2 | 顶层非 dict / 缺 `decision` / `decision` 非 dict | `decide.py:565-566` | `no_decision_object` | `top_level:not_object` \| `decision:missing` \| `decision:type:X` | 同上 |
| 3 | `kind` 不在 4 个之内 | `decide.py:573-574` | `unknown_kind` | `kind:{token}`——`_kind_token` `:361-378`：≤20 字原样，否则 `unrecognized:lenN`（**不截断**，防正文入日志） | 同上 |
| 4 | `reply`/`promise_followup` 无 content | `decide.py:581-582` | `missing_content` | `kind:{k}:content:{missing\|blank}` | 同上 |
| 5 | 脉冲形状不对**且**消毒器抛出 | `cycle:442-444` | `pulse_invalid` | `pulse:type:X` | **当前代码不可达**（两个消毒器都声明"永不抛"），保留是为了给未来失败留名字。注：形状不对的脉冲本身**不是失败**，`sanitize_pulse` 静默丢弃，周期照常成立 (`cycle:441` 注释) |
| 6 | 非 `ValueError`（超时/传输/其它） | `cycle:410-411` | `other` | `timeout` \| `cancelled` \| `transport` \| `none` \| `post_parse` \| `classifier_error` (`:381-393, 445-447`) | 同上 |
| 7 | `kind=tool_call` 但 `sanitize_tool` 返回 None | `conversation.py:1500-1504`（**不经 classify_failure**） | `missing_tool` | `tool:none` | `u3_cycle_failed` + 沉默 |
| 8 | `closing` 那一周期仍要 `tool_call` | `conversation.py:1505-1510` | — | — | `u3_cycle_tool_budget_exhausted` + 沉默 |

**隐私口径**（`cycle:304-307`）：`detail` 只能是模板组合，**不是模型文本的转录**。唯一逐字带出的是 `kind` 值，且必须整值 ≤20 字。`_other_detail` 明确**不记 `str(exc)`**——httpx 异常文本含 URL（`cycle:381-386`）。

**[事实] 失败方向不重试、不回落**：`_run_cycle` 的 except 分支 `conversation.py:1462-1472` 直接 `return ""`。docstring `:1444-1448` 明写理由——回落旧路径就等于同一轮两台机器都生成过回复，"开关开着时旧路径不生成回复"就再也证不了。

### 2.4 `LYKOI_U3_SWITCH_ENABLED` 读者的确切语义 [事实]

**唯一生产读者**：`Conversation._switch_on()` `conversation.py:650-664`（定义在 `conversation_cycle.switch_enabled()` `:93-105`）。全库 grep 只有两处：定义 + 这一个读者。由 `tests/test_u3s_switch.py`（31 个用例）静态钉死。

**默认：关**（`cycle:105` `_env_flag("LYKOI_U3_SWITCH_ENABLED", False)`）。真值集合 `{"1","true","yes","on"}`（大小写不敏感、去空白，`cycle:79-83`）。读在调用点，改 env + 重启即生效。

**一轮读一次**（`conversation.py:702-704`）：中途改 env 不会让同一回合前半段走新路、后半段走旧路。

| 环节 | 开关 = OFF（今天的默认） | 开关 = ON |
|---|---|---|
| **回合主体** | `_run_loop()` `:1358-1410`——tools API 工具循环 | `_run_cycle()` `:1422-1514`——信封周期 |
| **LLM 调用形状** | `_completion(tools=TOOLS)`（13 个工具定义）；收尾轮 `tools=None` | `_completion(tools=None, envelope=True)`——**从不带 tools** |
| **路由** | `llm_router.MAIN` | `llm_router.MAIN`（同一条，判据②：实验组身份延续） |
| **response_format** | `None`（从不上线） | `ENVELOPE_RESPONSE_FORMAT={"type":"json_object"}`，若 `envelope_json_mode()`（默认**开**，`llm_router.py:98-115`） |
| **上下文** | `_assemble()` 十二块 | `_assemble()` 十二块 **+ 尾部追加一条 system 信封契约**（`build_envelope_messages` `cycle:209-222`） |
| **念头出口** | `extract_inner_from_reply` + `_apply_conversation_inner`（分隔符转录机，`:739-746`） | **整条不走**（`:728-737`）；改由 `_apply_cycle_inner` `:1561-1588` 在周期内 `apply_inner` |
| **分隔符剥离** | 无条件剥离（即使 `CONVERSATION_INNER_ENABLED=False`），`:398-414` | 不剥离——`visible_reply = reply` `:736` |
| **影子双跑** | `_spawn_shadow` 起 `run_shadow`（`conversation_shadow` 路由） | **立刻返回**，零调用零事件（`:805-806`） |
| **一周期一账** | `u3_shadow_envelope`（23 栏，含 `diff_summary` 7 栏） | `u3_cycle_envelope`（17 栏，无 diff，`would_*` 改名 `sent_chars`/`dispatched`） |
| **失败账** | `u3_shadow_failed` | `u3_cycle_failed`（`conversation.py:359`）——刻意分开：影子失败 = 没对照数据，切换失败 = **她这一轮真的没说话** |
| **沉默** | 不可达（`_run_loop` 恒返回文本） | 合法结局：`return ""`，历史里**不补 assistant 消息** `:1485-1489` |
| **`resume_approved` 下半场** | `_run_loop()` | `_run_cycle()`（`:1808`，**重新读一次开关**，不是复用 send 那次） |

**逐消息**（开 = ON 时）：
- 普通来话 → `_run_cycle` 第 0 周期 → 四选一。
- 撞审批门的动作 → `_execute_cycle_tool` 返回 `_ask_for_approval` 的返回值，成为这一回合的回复（委托态下 = `""`）。
- owner 批准后的 `/approvals/{id}/approve` → `resume_approved` → 执行 → 追加一条 `[owner] approved ...` 的 **user** 消息 → 再走 `_run_cycle`。

### 2.5 `evaluate_message` / `apply_inner` 在对话侧的参数化差异（对照自主侧）[事实]

`evaluate_message` 的 4 个参数化关键字（`decide.py:536-539`）：

| 关键字 | 自主侧（缺省） | 对话侧（`cycle:284-287`） |
|---|---|---|
| `kinds` | `KINDS` = 7 项（explore/record_note/queue_notification/initiate_chat/tend_inner/rest/contemplate，`decide.py:36`） | `CONVERSATION_KINDS` = 4 项 |
| `content_required` | `CONTENT_REQUIRED_KINDS` = 4 项（`decide.py:42`） | 2 项 |
| `safe_kind` | `"rest"`（`decide.py:48`） | `"silence"` |
| `envelope_fields` | `()`——恒为空，`as_dict` 把 `{}` 过滤掉，自主 payload 逐字节不变（`decide.py:108-119`） | `("tool", "情绪脉冲")` |

**刻意不参数化的**（`decide.py:551-558` docstring 明列）：demote 护栏本身、fail-closed 注入 id 门、逐字引用要求、safe_kind 免降级。**这四条是纪律，不是词汇。**

候选表也是分叉的：自主侧 `build_candidates(snap)` `decide.py:140`（动态：预算耗尽摘候选、`prefer_rest`、`EXPLORE_STALL_OVERRIDE_H=24.0` 饥饿棘轮）；对话侧 `_CONVERSATION_CATALOGUE` `cycle:121-138` 是**静态四条恒在**，权重 0.5/0.4/0.4/0.3，只用于呈现（`cycle:117-120` 自证：对话轮里没有"预算耗尽摘候选"的对应物）。

`apply_inner` 的差异（`decide.py:464-526`）：

| | 自主侧 | 对话侧（切换态） | 对话侧（旧路径） |
|---|---|---|---|
| `source` | `"wake"` | `"conversation"`（`conversation.py:1583`） | `"conversation"`（`:635`） |
| 派生事件名 | `wake_inner_applied` | `conversation_inner_applied` | `conversation_inner_applied` |
| `injected_ids` | 本拍快照 Top-N | `set(self._last_injected_thought_ids)`（`:1457`） | 同左（`:633`） |
| 熔断 | 无 | `CONVERSATION_INNER_ENABLED` 关 → 落 `conversation_inner_dropped_switch_off` 并返回 False（`:1576-1581`） | `:743-746` |
| 兜异常 | 依赖"永不抛" | 额外兜一层 → `conversation_cycle_inner_failed`（`:1584-1586`） | 无 |

**[事实]** `source="conversation"` 而非 `"conversation_cycle"` 是刻意的：事件名由 source 派生，取这个值使切换前后"对话情境的念头"是同一条曲线（`:1564-1567`）。可辨性由 `u3_cycle_envelope` 另账保证。

**[事实] 影子期与切换期的 inner 差别**：影子期 `run_shadow` 只 `_sanitize_inner` 消毒后计数，**不 `apply_inner`**（`cycle:19-25` 给出理由：会挤占 `THOUGHT_OPEN_CAP=7` 硬上限、会让旧路径同轮 resolve 变成 `rejected_resolve`——两条都是活体行为的可观测改变）。

---

## §3 提示词与装配清单

### 3.1 三段式装配顺序（CACHE-INVERT）[事实]

`_assemble` `conversation.py:824-866`；标签枚举 `assemble_layout` `:868-885`；**12 个 `BLOCK_*` 常量**（实测）`:113-124`。

```
┌ [稳定前缀] _stable_prefix()  :942-979   —— 字节在轮与轮之间不变
│   1. BLOCK_PERSONA     self._messages[0]              :951   ← _build_persona_message :521-542
│   2. BLOCK_ORGANS      self._organs (可空)             :954-955 ← organs.build_organ_block()
│   3. BLOCK_NARRATIVE   (可空, flag 文件门控)            :960-970 ← mind_store.current_cognitive_narrative()
│   4. BLOCK_BACKFILL    self._backfill (可空)           :971-972 ← _build_backfill :587-612
│   5. BLOCK_SUMMARY     self._summary (可空)            :973-975 ← _summarize :1240-1275
│   6. BLOCK_CONCERNS    self._concerns (可空)           :976-978 ← _render_concerns_block :981-1017
│
├ [历史] self._messages[1:]   :864 / 标签 BLOCK_HISTORY :883
│
└ [易变尾部] _volatile_tail() :1019-1063  —— 每轮/轮内变
    7.  BLOCK_MEMORIES    self._relevant_memories (可空)  :1029-1030 ← _build_relevant_memories :1067-1113
    8.  BLOCK_THOUGHTS    (可空, INNER_ENABLED 门控)       :1031-1042 ← mind_thoughts.get_thoughts_for_snapshot()
    9.  BLOCK_TIME        恒在(分钟粒度, 每轮必变)          :1048-1053 ← clock.now() → 北京时区
    10. BLOCK_UNDELIVERED (可空)                          :1054-1056 ← _undelivered_block :1128-1168
    11. BLOCK_SELF_STATE  (可空)                          :1057-1062 ← self_state_injection.prepare_injection
```

**[事实] 注意一处顺序陷阱**：常量声明顺序（`:113-124`）把 `BLOCK_CONCERNS` 列在第 3 位，但**实际发出顺序**中它在稳定段**末尾**（`:976-978`）。移植时以 `_stable_prefix()` 的返回顺序为准，不是常量声明顺序。

**[事实] 切换态的第 13 块**：`build_envelope_messages(assembled)` `cycle:209-222` = `list(assembled) + [{"role":"system","content": envelope_system_prompt()}]`。**追加在最后**（不像自主路径放在 user 消息前），理由 `cycle:216-220`：三段带的易变尾部已占住生成点前的位置，契约插中间会把 U2 理顺的缓存边界顶回去。

**[事实] 空态零字节**（判据⑧a，贯穿全部可空块）：命中为空**不加块**，不加"没找到"的占位——`:1003-1004`、`:1099-1102`、`:1155-1158`、`:578-582`。这样"今天没召回"不会多一次 prefix cache miss。

**[事实] 缓存失效钩子**：`_refresh_identity_if_stale()` `:922-940` 在每次 `_stable_prefix()` 开头调用（`:950`）。印记 `_nightly_epoch()` `:889-920` = `(integration_state.last_integration_at, 最新 focus_cycles.id)`——**跨进程可读**（autonomy 进程写库，server 进程读库）。印记变了才重建人格头 / 器官 / 关切，落 `stable_prefix_rebuilt`。读不到印记返回 `None` → **保持现状**。

**[事实] 只读不标的纪律**：`_undelivered_block` 与 `_build_relevant_memories` 都**不在 `_assemble` 里做写操作**，因为 `_enforce_budget` `:1277-1309` 会为收敛预算反复调 `_assemble`。标 surfaced 落在 `_completion` 拿到回应之后（`:1888` → `_mark_undelivered_surfaced` `:1175-1189`）；记忆检索算在 `send()` 里（`:708`）。

### 3.2 sha256 逐字校验表（[事实]，`hashlib.sha256(text.encode())` 实测）

**A. 系统提示词与契约**

| 段 | file:line | 字符数 | sha256 |
|---|---|---|---|
| `prompts.SYSTEM_PROMPT` | `cognition/prompts.py:12-43` | 1418 | `72a3c1c128b63def708fdd5fedd89792098b821071662e164f511bc7e6a81314` |
| `conversation_cycle.ENVELOPE_SYSTEM_PROMPT`（raw，`{causes}` 未展开） | `cognition/conversation_cycle.py:149-202` | 1677 | `9d4f169eb3ea368be6cf46e44445fc0ea943a4d7052a3c03744ea63bdf869eb7` |
| `envelope_system_prompt()` **渲染后**（causes 已代入） | `cognition/conversation_cycle.py:205-206` | 1960 | `739494ec4d9dfe7696064d3f819de58c00db59f97aaa6bd75981398b5b21e54e` |
| `_PULSE_CAUSES` 拼接串（15 个 CAUSES 排序后 `", ".join`） | `cognition/conversation_cycle.py:147` | 291 | `ad676bb093c8ba1751040677f7543f01cef3d1c10abb8dadc6626a84316d1929` |
| `SUMMARIZE_SYSTEM_PROMPT` | `cognition/conversation.py:133-138` | 142 | `3eb2679bd75cfd812bbbf0ffaf1156d284c771f0e1e59dac2daa40173ee32759` |
| `Conversation.CYCLE_CLOSING_NOTE` | `cognition/conversation.py:1417-1420` | 92 | `575ffe30c167b2e111789deee1a4702ffe93bc0384e381ff9d78b35eaf06a36a` |
| `_run_loop` 收尾轮 system（内联字面量） | `cognition/conversation.py:1366-1369` | 49 | `94893b5d4d604d91ba2d1a491743f12596190ed0ddba6ea06b0258099ba9aef9` |
| `ASK_FALLBACK` | `cognition/conversation.py:428` | 15 | `66b17e244f974f0b8941b741a66d6990ec6a81cef9817b582a0cf63a8eaccd56` |

`CAUSES` 排序后（15 个，`mind/regulation.py:27-47`）：`action_taken, concern_lit_unfollowed, contact_answered, contact_unanswered, experience_backlog, experience_recorded, explore_completed, integration_completed, integration_digested, narrative_conflict, normal_interaction, owner_silence_anomaly, rested, suspension_overdue, suspension_resolved`

**B. 装配块的头部字面量**（每块的**固定前缀**，正文由数据填充）

| 块 | file:line | 字符数 | sha256 |
|---|---|---|---|
| 转正结论小标题（人格头内） | `conversation.py:585` | 27 | `48ddd6b81fdb4d597f65cdd658202667b1d7ef052945f6e20f20ced6df76ab29` |
| BLOCK_BACKFILL header | `conversation.py:611` | 35 | `fbd7132d2046bca9c4f2f12fb33dc59347ef21876782e4de01a6ad23e6bf4777` |
| BLOCK_NARRATIVE header | `conversation.py:968` | 19 | `3f62912463bc2f068cc34540cf3f137263f64061d6474ed4c79fa5a22702a019` |
| BLOCK_SUMMARY（f-string 骨架 `[早前对话摘要]\n{}`） | `conversation.py:975` | 11 | `598fe6863b6c3315a7b3329f8897f53b5c968f1cf1e2c63fc4b50f9650d7ec64` |
| BLOCK_CONCERNS header | `conversation.py:1013-1015` | 49 | `f65c29624e876c058691b8de306a6c705e1af92eddb1cc96e2fc5a560928df19` |
| BLOCK_THOUGHTS header | `conversation.py:1041` | 35 | `e8cc247f6b0e1d896966bb9fe44d0b9be0a1483c230cb72958d912299c29ec89` |
| BLOCK_THOUGHTS 行格式（骨架 `id={} kind={} charge={}: {}`） | `conversation.py:1036` | 27 | `a58edd000e6e5edc99652bd9dddb28fb06587b51c859080b5940e7ff3e4e9399` |
| BLOCK_TIME（骨架 `[当前时间] {} 周{} (北京时间)`） | `conversation.py:1051-1052` | 20 | `f2ed3e8081dacf51419c20138314fd1652bf5e30e2fdd8fdd1db51d7eb45673f` |
| BLOCK_MEMORIES header | `conversation.py:1108-1110` | 86 | `35f74e70ba5449e0039a748da6b492e5c92404cbed5de2ab1154af0c4e03bcfa` |
| BLOCK_MEMORIES 行格式（骨架 `- [{}] {}: {}`） | `conversation.py:1126` | 13 | `9a37c2b5ae1d546276356cd76a7cfd2d58bd89eb0afba870ec4c082f48caef9f` |
| BLOCK_UNDELIVERED header | `conversation.py:1164-1166` | 68 | `658c95ff5e9b49d65e43a54b4ae37e60bbdccfe0ad60b1b215d1233edd55c360` |
| BLOCK_UNDELIVERED 行格式（骨架 `- [{}] 「{}」`） | `conversation.py:1160` | 11 | `80e0c2ec4f0cbc683f3cf139290de769010b731fb6d4aca193cb56750a1dbf5a` |
| DSML 拦截提示（基础版） | `conversation.py:1336` | 25 | `b38e69bc8a8d4bfa3c9889284304428a452c15cdd799789807e0a89e07e1ac60` |
| DSML 拦截提示（后台桥接版） | `conversation.py:1348` | 40 | `75e8828bc313eddc40b1d676a34052bf74e19747b582b238a66a578f744e1195` |
| DSML 拦截提示（现场桥接版） | `conversation.py:1350` | 41 | `994f3d62037342676e93cc3fa87ac24153702af5bcde12e4c429dd8d0965bf17` |
| 工具步用完兜底回复 | `conversation.py:1410` | 18 | `0c31b120b80f0cb42f30a6bb6aea9adec4512b128f317e627a278aee00c6b634` |
| ContextBudgetError 文案（骨架） | `conversation.py:1308` | 33 | `584ca3b4ec76336911cd041626bf185889dcc27c820fb4a2b8941e7f2b2f2ead` |

**C. 审批对话文案**

| 段 | file:line | 字符数 | sha256 |
|---|---|---|---|
| `QUESTION_TEMPLATE` | `kernel/approval_conversation.py:73` | 30 | `886f07bf71951795d6a4107407e5626975852a68fae54cca650aebe95a1c4859` |
| `RETRACT_TEMPLATE` | `:74` | 51 | `a7019f4ace54528032a4d391be3d25c00c19e53cf534e03ed9dfc6376ef8c97a` |
| `DENY_CONFIRM` | `:75` | 8 | `0356d3db0b5ccefc78a85fc3378c04c89a2873d51dbf22d30afee63fc0a6817a` |
| `EXPIRED_REPLY` | `:76` | 16 | `77da6f54252aa439977ff54d70e3852857dafe408369a60614d86b3a426c4d2f` |
| `EXEC_OK_TEMPLATE` | `:85` | 28 | `5598a0dec5d29a57b980140cb3e4442715eb67c7be07841c5f0a147a3bd95ae5` |
| `EXEC_OK_NO_OUTPUT` | `:86` | 25 | `193cdb34432850de15ba2a7a6c4b4b1cf52d843f2443988e10ea7bfab5fc386c` |
| `EXEC_FAIL_TEMPLATE` | `:87` | 32 | `ab98ae11c9be857175454c5f962b22b693aa870dfa7486f5b76ca58ec9cc9d39` |
| `EXEC_SKIPPED_TEMPLATE` | `:88` | 30 | `84cb462f095751b820fe40014f2f17d694146ed7d4d881ad893862b1a70726e6` |
| `RESULT_TRUNCATED` | `:94` | 22 | `14d817806dcbbec9ef092c6c7ed941885f39e4874f4ba29af119e8a57fae1da9` |
| `INTERPRET_SYSTEM_PROMPT` | `kernel/approval_interpreter.py:177-203` | 851 | `ed9c86d112e4fd68c6a6f4b848741fcbb8dc64e6f6d4a05da2e02945e85def31` |
| `INTERPRET_ACTION_TEMPLATE` | `:214-218` | 119 | `5e070e34545f1de28948bda63e3c30d0dd733a5689adc23ca8e47fc6cffe2dea` |
| `INTERPRET_ANSWER_TEMPLATE` | `:220-223` | 81 | `49f2d82b805540f22e524844e23e1d42d0321e5e1bd99e9ba09771ea092ee523` |
| `_AMBIGUOUS_CLARIFY` | `:704-707` | 57 | `a3450d3fd7e711e170711d2dc7d84a7b2a6834325900f67097b6a3014823ec76` |

### 3.3 每段的内容来源函数 [事实]

| 块 | 来源函数 | 变化频度 |
|---|---|---|
| PERSONA | `build_persona_kernel(get_persona())` `config.py:172-206` + `render_restart_notice` `restart.py` + `SYSTEM_PROMPT` + `build_persona_prompt()` `memory/persona.py:18-28` + `_promoted_insights_section()` `conversation.py:544-585` | 整合边界 / 重启 |
| ORGANS | `organs.build_organ_block()` `organs.py` | 整合边界（`organ_inventory.invalidate()` `:936`） |
| NARRATIVE | `mind_store.current_cognitive_narrative()`，裁 `NARRATIVE_CLIP_CHARS=2000` `:80`；由 flag 文件 `NARRATIVE_FLAG_PATH` 门控（root-owned，`:85-87`） | 整合期 |
| BACKFILL | `store.get_recent_history_of_type("conversation", 20)` `:591`；每侧裁 `BACKFILL_CLIP_CHARS=400`；`dsml.strip_markup` 读侧卫生 `:600` | 进程启动一次；预算超限时被丢（`:1297-1299`） |
| SUMMARY | `_summarize()` `:1240-1275`——**MAIN 路由**，`max_tokens=1024`、`temperature=0.3`；空返回即 `raise` | 活窗溢出时 |
| CONCERNS | `mind_store.list_concerns("active")` 取前 5（`CONCERNS_CONTEXT_MAX=5`），描述裁 60 字 | 整合边界（自证 `:983-991`：`lit_count`/`last_lit_at` 是轮级但**不进渲染**） |
| MEMORIES | `mind_relevance.retrieve_for_concern({title: 来话前 200 字, ...}, limit=6)`——**零 LLM**，纯 stdlib 三轴打分；每条渲染 ≤80 字 | 每轮 |
| THOUGHTS | `mind_thoughts.get_thoughts_for_snapshot()`（`THOUGHT_SNAPSHOT_TOP=3`） | 每轮 |
| TIME | `clock.now().astimezone(_BEIJING_TZ)`，分钟粒度 | 每轮必变 |
| UNDELIVERED | `chat_outbox.unsurfaced_undelivered(limit=3)` | 每轮 |
| SELF_STATE | `self_state_injection.prepare_injection(live.context, enabled=...)`；`live` 由 `self_state_live_audit.evaluate_and_log_live_injection(consumer="conversation")` `:1843-1846` 给出 | 每轮 |

---

## §4 审批对话消费面

### 4.1 审批问句的产生（两条路）[事实]

**路 A（委托态，Telegram 走这条）**：
```
dispatch → Observation(success=False, data={"needs_approval": True, action_id, correlation_id})
  conversation.py:1391-1395 (_run_loop) / :1548-1552 (_execute_cycle_tool)
→ 未执行的调用补 deferred 结果  :1400-1404 / :1553-1556
→ _ask_for_approval(action, data)  :1590-1640
   ├ self._pending = action ; self._pending_id = None   :1600-1601
   ├ if _delegate_approval_ask:                          :1602
   │   self._delegated_ask = {action_type, params, action_id, correlation_id}  :1608-1613
   │   (DELEGATED_ASK_FIELDS :446, 实测 4 项)
   │   log_event("approval_ask_delegated")  → return ""  :1614-1616
   └ (认知侧本轮不 enqueue —— 排队跟着问句走)
→ app.py:281-284  take_delegated_ask() → body["approval_request"]
→ telegram_device._generate_reply 返回 approval_request  :219-222
→ _handle_message :493-494  await _ask_about(..., reply_to=当轮入站 message_id)
→ _ask_about :250-287
   ├ 形状校验(action_type 非空 str + params 是 dict) 否 → telegram_approval_ask_malformed, 不问  :269-272
   └ approval_conversation.request_approval(..., reply_to=reply_to, origin="interactive")  :273-281
```

**路 B（非委托，Mac app / 缺省）**：`_ask_for_approval` `:1617-1640` 自己调 `request_approval`，`context_id = _owner_context()` = `mind_store.owner_channel_key("telegram")`（`:462-466`，**无硬编码 chat id、无 env override**；没绑 owner 就问不出去 → `approval_ask_skipped` + 返回 `ASK_FALLBACK`）。**`reply_to` 缺省 None** ← 这正是 §7 打扰预算的病灶来源。

### 4.2 `request_approval` 的四道闸与"先发后排" [事实] `approval_conversation.py:148-274`

```
1. scope_key = approval.resolve_scope_key(action_type, params)         :174
2. find_live_pending 去重 → status="already_pending"                    :176-184
3. recent_denial(action_type, scope_key) ≠ None → status="quiet_period" :186-203
     (DENIAL_QUIET_H 静默期; audit stage="suppressed", 动作不执行)
4. text = question_text(...)  = QUESTION_TEMPLATE.format(describe_action(...))  :205 / :102-108
5. **先发**: delivery = await _send(context_id, text, reply_to)         :206
     失败 → audit stage="undelivered", outcome="deny_by_default"
            status="send_failed", **不排队**                            :207-224
6. **后排**: approval.enqueue_pending(..., question_message_id=delivery["message_id"],
                                       question_text=text)             :226-236
     失败 → 发 RETRACT_TEMPLATE 撤回 + audit stage="retracted"
            status="enqueue_failed", **无队列条目**                      :237-255
7. audit stage="asked" + log approval_question_sent → status="asked"    :257-274
```

**原子性口径**（模块 docstring `:43-61`）：*enqueued but never sent* 的害 > *sent but never enqueued* 的害——前者会让每一个**其它**回答都因为"两条悬置"而变成 `ambiguous_multiple`，一条未送达问句毒化所有真问句的消歧。

**没有递归**（`:37-42`）：从这里发出的 `messenger.send` 若回 `needs_approval`，只落 `approval_message_undelivered` 然后**终止**（`:134-138`）。一次问不可能生出第二次问。

### 4.3 归属判定（引用回复护栏）[事实] `approval_interpreter.resolve_target_detail` `:412-471`

信号按权威度递减：

| # | 信号 | 判定 | 锚点 |
|---|---|---|---|
| 0 | `records` 为空 | `NONE_PENDING` | `:436-439` |
| 1 | **引用**：`reply_to` == `question_message_id` **或** == pending `id` | 恰 1 条 → `MATCHED`；>1 → `AMBIGUOUS_MULTIPLE` | `:440-450` |
| 1b | 引用落空 **且** 不是 `looks_like_an_answer` | `NO_MATCH_CHITCHAT`（沉默，不追问） | `:451-454` |
| 1c | 引用落空 **但** 是应答词 | 落 `approval_answer_quote_unmatched`，**继续**走 2-4（保守方向） | `:455-458` |
| 2 | **语义匹配**：`_semantic_score ≥ SEMANTIC_MATCH_MIN=0.34` | 恰 1 → `MATCHED`；>1 → `AMBIGUOUS_MULTIPLE` | `:459-464` / `:68-70` |
| 3 | **悬置数量** > 1 且无上述信号 | `AMBIGUOUS_MULTIPLE`——**一条都不放行** | `:465-467` |
| 4 | **时间邻近**：单条悬置且 `age > UNREFERENCED_ANSWER_WINDOW_MIN=10.0` 分钟 | `STALE_UNREFERENCED` | `:468-470` / `:63` |
| — | 否则 | `MATCHED` | `:471` |

**`_semantic_score`** `:393-401` = `|问句 distinctive token ∩ 回答 token| / |问句 distinctive token|`，问句 token 集额外并入 `scope_key` 拆冒号后的 token。停用词表 `_STOPWORDS` **46 项**（实测，`:73-78`），token 正则 `[A-Za-z0-9_.:@+-]{2,}|[一-鿿]{2,}` `:80`。

**`_age_minutes`** 时间戳不可读 → `inf`（按 stale 处理，`:404-409`）。

**`looks_like_an_answer`** `:101-105`：`OWNER_ANSWER_WORDS`（**27 项**，实测 `:93-98`）**整值成员判定**，去 `_ANSWER_TRIM` 标点后精确相等。它只决定**路由**（能不能到解释器），从不决定 verdict。

**死问句拦截**：`_dead_question(reply_to)` `approval_conversation.py:396-401` 在最前面——`reply_to` 指向的问题若已消费/过期/已拒绝，回 `EXPIRED_REPLY` 并 audit `outcome="expired"`，**不落进解释器**（`:423-446`）。

### 4.4 批准 / 拒绝落地 [事实]

**确定性快通道**（`approval_interpreter.py:658-701, 787-793`）：仅当**恰好 1 条悬置**且回答精确等于 `执行` 或 `不要`（去空白/标点）时，跳过 LLM 产出 `{verdict, confidence:1.0, scope:"this_only"}`。因 `scope="this_only"`，`gate` 必给 `execute_once`——**永不产生常设授权**。存在理由：`clarify_text` 承诺过这两个词，被承诺的应答方式不能依赖 LLM 可用性（2026-08-12 实测事故）。

**LLM 解释器** `interpret` `:335-374`：三条消息（system 铁律 / **动作数据** / **主人的话**）——刻意分成两条 user 消息，防注入（`:205-213`）。`max_tokens=400`、`temperature=0.0`。**每一条失败路径都落 `unclear`，永不 `approve`**（`:344-373`：空回答 / 无 action_type / LLM 不可用 / 空 completion / 不可解析）。

**明确度门 `gate`** `:528-574`（纯函数，无写）：

| verdict | `hard_gated` | `standard` |
|---|---|---|
| `deny` | `deny` | `deny` |
| `approve`/`conditional` | `execute_once`，`may_grant=False`——**硬门永不产生常设授权** | `scope=="this_only"` → `execute_once`；否则 `grant`，`may_grant = (key is not None)` |
| `unclear` | `clarify`，**无轮次上限**（永远追问） | `clarify` 一次（`STANDARD_CLARIFY_LIMIT=1`），第二次 → `deny` |

`_CLARIFY_ROUNDS` **进程内、不持久化**（`:131-132`）：重启清零 → 她会**再问一次**而不是静默按拒绝算。失败方向朝问句。

**落地副作用**（`handle_answer` `:806-828`）：`clarify` → 计数 +1；`grant` → `approval.grant_standing(...)`；`deny` → `approval.record_denial(...)` 建静默期；`execute_once` → **显式不调 `grant_standing`**（`:824-828`：拒绝不该是 shell 命令与永久 allow 行之间唯一的屏障）。

**授权回滚**（`:838-844`）：`grant` 已建但 `audit_interaction` 返回 False → `revoke_standing` + `outcome` 改 `clarify` + `approval_grant_rolled_back`。

**执行**（`_execute_once` `approval_conversation.py:279-317`）：原子性点在 `approval.consume_pending`（跨进程 file lock 打 `consumed_at`，拒绝二次认领）——两个回答竞争或一个回答到两次，**恰好执行一次**。记录留在账本里"已消费"而不删除（`:285-287`：删了就再也认不出重复的「可以」是在回答已了结的事）。

**旁路 endpoint**：`POST /approvals/{id}/approve` → `Conversation.resume_approved` `:1762-1808`（`consume_pending` → `permission_evidence_shadow.record_owner_decision`【文件不可读，按引用侧证据推断：签名 `(grant, owner_decision=, decided_at=)`，纯记录、不影响控制流，`:1776-1780`】→ `dispatch(pre_approved=True, action_id=grant["id"])` → `drop_pending` → 追加 `[owner] approved ...` **user** 消息 → 再走一轮）。`POST /approvals/{id}/deny` → `deny_pending` `:1810-1835`（用 `pending_actions()` 而非 `find_pending`，**刻意排除过期项**，`:1815-1824`）。

### 4.5 执行回执回话 [事实]

`_report_execution` `approval_conversation.py:374-393` → `execution_report` `:353-371`：

- 未执行 → `EXEC_SKIPPED_TEMPLATE`
- 执行了但 `observation.success` 假 → `EXEC_FAIL_TEMPLATE`
- 成功有输出 → `EXEC_OK_TEMPLATE`；无输出 → `EXEC_OK_NO_OUTPUT`

`_result_body` `:327-350` 优先取 `stdout/output/result/text/content`，再补 `stderr:`，都没有就 `json.dumps` 兜底——"never nothing, and never unbounded"。`_truncate` `:320-324` 上限 `RESULT_MAX_CHARS=1500`，**显式告知截断**。

回执带 `_reply_ref(message_id)`（`:507-510`）——引用他的话，这同时是免打扰预算的机制。

**存在理由**（`:78-84`）：2026-08-12 Kevin 批准了 `terminal.exec`，它跑了，她一言不发。四个分支里 `granted`/`execute_once` 是**唯一**不说话的那个。

### 4.6 E1/E2 豁免的判定点与结构标记 [事实]

**类别**（`policy_exemption.py:45-48`）：`E1` = 审批机制自身的通信；`E2` = 在场对话应答。
**覆盖面**（`:54`）：`EXEMPT_ACTION_TYPES = frozenset({"messenger.send"})`——**只覆盖纯文本出站**，1 项。

**盖章点（构造入口，各恰一个）**：

| 类别 | 构造函数 | 盖章代码路径 |
|---|---|---|
| E1 | `approval_machinery()` `:76-78` | `approval_conversation._send` `:127-132`——审批/建议问答机的出站漏斗 |
| E2 | `in_presence_reply(peer_context_id)` `:81-87` | `telegram_device._send_reply` `:299-301`——**唯一有资格盖 E2 章的地方**，因为只有这一层"对端是谁"是结构事实 |

**判定 `covers(action_type, params, exemption)`** `:90-107`（纯函数，永不抛，默认 False）：
1. `not isinstance(exemption, Exemption)` → False——字符串 `"E1"` / 字典 `{"category":"E1"}` / None **一律伪造不出来**
2. `action_type not in EXEMPT_ACTION_TYPES` → False——工具动作不因伴随应答而降级
3. `E1` → True
4. `E2` → 必须有 `peer_context_id`，且 `params["context_id"]` **精确字符串相等**

**消费位置**：`approval.check` 的**最后一步**（`approval.py:359-360`，排在不可变硬规则、能力面、live always_deny、cap allow、hard ask、always_allow、DELEGATION_READONLY、scoped grant **之后**）。所以 E1 标记既不能让 `terminal.exec` 免过硬门（`hard == "ask"` 在 `:349-350` 先返回），也不能推翻 `always_deny`。**只能收紧，不能放宽。**

**审计栏**：`policy_exemption.label(exemption)` `:110-112` → `dispatch.py:472-478` 的 `intent["exemption"]`。非标记记 `None`——"豁免免掉的是**问**，从来不是**账**"（`dispatch.py:427-429`）。

**[事实] 今天的可观测影响：零。** `policy_exemption.py:32-37` 记录 WO-U3 判据②d 实测：活体 audit 里 `messenger.send`/origin=interactive 共 28 次全部 `decision=allow, pre_approved=False`——在 `check` 第三层就被 live `always_allow` 放行，走不到豁免这一步。它是冗余保险，**U3 切换后才承重**（因为那时"说"变成 decide 信封动作，未盖章的问句会对自己上门）。

### 4.7 `HARD_ASK_TYPES` 集合现值 [事实]

```python
# guardian/policy_core.py:33
HARD_ASK_TYPES = frozenset({"terminal.exec", "delegation.dispatch"})   # 2 项
HARD_DENY_TYPES: frozenset[str] = frozenset()                          # 0 项 (:37)
```
由 `tests/test_governance_invariants.py:452-457` 钉住集合内容。`risk_level()` 唯一真相源是 `approval.is_hard_gated`（`approval_interpreter.py:491-494`）。

`AUTONOMOUS_ALLOWED`（`policy_core.py:44-56`）9 项，含 `messenger.send` / `messenger.read`；`dispatch.KNOWN_ACTIONS` **18 项**（实测，`dispatch.py:325-354`）；`TOOL_TO_ACTION` **10 项**（实测，`conversation.py:141-152`）；`TOOLS` 定义 **13 个**（实测，其中 3 个 in-cognition：`vision_describe` / `promise_followup` / `post_progress`，`:351-353`）。

---

## §5 每轮触碰的 state 全表

格式对照 C-A 前半 §3 的写者×文件×触发条件矩阵，补对话侧全列。**默认路径均可由 `LYKOI_*` env 覆盖**（`shared/log.py`、`chat_outbox.py`、`approval.py` 等）。

### 5.1 每轮**必**触碰

| 文件 / 表 | 写者（file:line） | 触发条件 | 语义 |
|---|---|---|---|
| `state/events.jsonl` | `shared/log.py::log_event`，全路径 | 每一条事件 | 追加。**含全文**：`chat_request`(app.py:234)、`chat_reply`(app.py:275)、`inner_outer_pair`(conversation.py:755-761) 均写明文正文 |
| `state/interactive_activity.json` | `interactive_lock.mark_active` ← `conversation.py:692`、`:778` | send() 开头 + 结束 | 原子覆写 `{active_until, updated_at}`；autonomy 进程据此让路 |
| `memory.db · history` | `store.append_history("conversation", ...)` ← `conversation.py:747-749` | 回合成功（含 silence，此时 reply=""） | 一行 `{"user":..., "reply": visible_reply}` |
| `memory.db · experiences` | `mind_reflow.record_experience("conversation", ...)` ← `reflow.py:320` ← `conversation.py:766` | 同上；异常吞成 `conversation_reflow_failed` | 摘要经验（user/reply 各裁 80 字，`reflow.py:308-311`） |
| `memory.db · regulation` | `mind_store.apply_regulation_cause("normal_interaction")` ← `reflow.py:321` | 同上 | `relational_tension -0.10` |
| `memory.db · notifications`（条件） | `notifications.mark_replied` ← `reflow.py:315` | `reply_to_notification is not None` | 首写幂等 |
| `/var/log/lykoi-audit/audit.jsonl` | `dispatch._immutable_audit` `dispatch.py:204-222`（`action_dispatch` 在 handler **之前**、`action_result` 之后） | **每一次 dispatch** | root-owned。**写失败 = dispatch 失败 CLOSED**（`:480-490`） |

### 5.2 条件触碰（对话侧）

| 文件 / 表 | 写者 | 触发条件 |
|---|---|---|
| `memory.db · thoughts` | `mind_decide.apply_inner` ← `conversation.py:635`（旧路径）/ `:1583`（切换态） | 信封或尾块含 `thoughts`/`resolve` **且** `CONVERSATION_INNER_ENABLED` |
| `state/chat_undelivered`（`chat_outbox.UNDELIVERED_PATH` `:136-138`） | `chat_outbox.mark_undelivered_surfaced(ids)` ← `conversation.py:1186` | `_completion` 成功返回**之后**、且本轮装配过未送达块。失败吞成 `undelivered_surfaced_failed` |
| `state/chat_outbox.json` | `chat_outbox.append("⏳ "+content)` ← `conversation.py:1722`（`post_progress`） | 仅**后台回合**（`self._background`）；现场回合直接拒（`:1719-1720`） |
| `state/chat_outbox.json` | `chat_outbox.append(content, kind=...)` ← `followup.py:319` | followup/continuation 结果投递 |
| `state/pending_actions.json` | `approval.enqueue_pending` ← `approval_conversation.py:227` | 问句**已送达**之后 |
| 同上 | `approval.consume_pending` ← `approval_conversation.py:288` / `conversation.py:1771` | 批准执行；跨进程 file lock，二次拒绝 |
| 同上 | `approval.drop_pending` ← `conversation.py:1795`、`:1827` | endpoint 批准/拒绝 |
| 同上 | `approval.resolve_pending(id,"denied")` ← `approval_conversation.py:481` | 对话拒绝 |
| 同上 | `approval.set_question_message_id` ← `approval_conversation.py:470` | clarify 追问发出后，把新 message_id 挂回同一 pending |
| `state/standing_grants.json` | `approval.grant_standing` ← `approval_interpreter.py:811` | `outcome=="grant" and may_grant` |
| 同上 | `approval.revoke_standing` ← `approval_interpreter.py:841` | 授权已建但 audit 写失败 |
| 同上 | `approval.record_denial` ← `approval_interpreter.py:822` | `outcome=="deny"` 且有 scope_key（建静默期） |
| `state/notifications.json` | `notify.owner` action handler | 模型调 `notify_owner` 工具 |
| `state/continuations.json` | `shared/continuations` ← `followup.py` `_suspend/resolve` | 后台回合登记/了结挂起任务 |
| `memory.db`（多表） | `permission_evidence_shadow.record_owner_decision` ← `conversation.py:1776`、`:1828` | **文件不可读**，按引用侧证据推断：只在 endpoint 批准/拒绝两处调用，纯影子记录 |
| 进程内 `_REGISTRY`（无文件） | `attachments.register(path)` ← `conversation.py:1652` | `browser.screenshot` 成功 |
| 进程内 `_CLARIFY_ROUNDS` | `approval_interpreter.py:809` | clarify 计数；**刻意不持久化** |
| 进程内 `_SHADOW_TASKS` | `conversation.py:820-821` | 影子任务强引用（防 GC 提前回收） |

### 5.3 设备侧（telegram 进程）

| 文件 | 写者 | 触发条件 |
|---|---|---|
| `state/telegram_cursor.json` | `_save_cursor` `telegram_device.py:109-111` ← `:513` | **每条 update 处理完毕后**逐条落盘 |
| `state/telegram_outbox.cursor` | `_save_outbox_cursor` `:138-140` ← `:415`、`:425`；`_init_outbox_cursor` `:155` | 每投递一条（或跳过一条不可投 kind）后落盘 |
| `state/messenger_inbound.json` | `messenger.ingest_inbound` `messenger.py:268-275` | 每条通过 `_is_bound` 的入站；环形 200 |
| `state/messenger_outbound.json`（打扰账本） | `_reserve_proactive_slot` `messenger.py:165-180` | **仅当 `reply_to is None`** 的 `messenger.send`；环形 50 |
| `state/chat_undelivered` | `chat_outbox.append_undelivered` ← `telegram_transport.record_undelivered` `:132` | 重试耗尽 / dispatch 失败 / transport 未到 |
| `memory.db · experiences` | `mind_reflow.record_experience("conversation", ..., salience=0.6)` ← `telegram_transport.py:178-180` | 每条未送达记录都落成**她的一件事** |
| `state/messenger_transport.jsonl` | `NullTransport.send_message` `messenger.py:91-105` | **仅 NullTransport**（开发/测试）；telegram 进程启动时被真 transport 替换（`telegram_device.py:529`） |

**[事实] 每轮 dispatch 的策略读**（只读不写）：`state/approval_rules.json`、`state/standing_grants.json`、`guardian/policy_core.py`（immutable）。

---

## §6 U3 两缺陷结构定位

### 6a. json 空回复 — 有 tokens、content 空

#### 逐行代码路径 [事实]

```
① llm_client.chat_completion                        llm_client.py:140-178
   ├ response.raise_for_status()                     :157   ← 200，不抛
   ├ body = response.json()                          :158   ← 合法 JSON，不抛
   ├ usage = body.get("usage") or {}                 :159
   ├ log_event("llm_call", ..., completion_tokens=usage.get("completion_tokens"), ...)  :167-177
   │     ← **这里就是"有 tokens"的证据落点：completion_tokens > 0 被如实记下**
   └ return body["choices"][0]["message"]            :178
         ← message = {"role":"assistant","content":""} 或 content 缺失
         ← KeyError/IndexError 会被 :194 捕获并抛出，但 content 为空**不是** KeyError
         ← **本层不做任何 content 非空校验**

② llm_router.complete → 直接透传                      llm_router.py:232-236

③ Conversation._completion                          conversation.py:1875-1889
   ├ reply = await llm_router.complete(MAIN, messages, tools=None,
   │            response_format=ENVELOPE_RESPONSE_FORMAT)   :1875-1885
   ├ self._mark_undelivered_surfaced()                :1888  ← **展示期照收**（未送达条目被标掉）
   └ return reply                                     :1889  ← 空 content 原样返回

④ Conversation._run_cycle                            conversation.py:1455-1472
   ├ message = await self._completion(tools=None, envelope=True)   :1455
   ├ elapsed_ms = ...                                             :1456
   ├ decision = conversation_cycle.parse_envelope(message, ...)    :1459-1461
   │    └ mind_decide.evaluate_message(message, ...)               cycle:278-288
   │         └ raw = _extract_json(message.get("content") or "")   decide.py:564
   │              content = "".strip() = ""                        decide.py:320
   │              json.loads("") → JSONDecodeError                 decide.py:322-323
   │              content.find("{") = -1 → 不进 fallback           decide.py:324-325
   │              **raise ValueError(...)**                        decide.py:330
   ├ except Exception as exc:                                      :1462
   │    reason, detail = classify_failure(exc, message)            :1463
   │       → isinstance(exc, ValueError) 是                        cycle:410
   │       → content = "" (str)                                    cycle:412-413
   │       → mind_decide._extract_json("") 再抛                     cycle:415
   │       → return FAIL_NOT_JSON, f"first_char:{_first_char_class('')}"   cycle:416-417
   │            _first_char_class("") → "empty"                     cycle:340-341
   │    log_event(CYCLE_FAILURE_EVENT="u3_cycle_failed",
   │              error_type="ValueError", elapsed_ms, 
   │              reason="not_json", detail="first_char:empty", step)   :1464-1471
   └ **return ""**                                                  :1472  ← ★降级沉默的那一行★
```

#### 在哪一行决定降级沉默 [事实]

**`conversation.py:1472`** —— `_run_cycle` 的 except 分支尾部 `return ""`。

下游后果链：`send()` `:710` 得到 `reply=""` → `:736` `visible_reply=""` → `:747-749` **history 里落一行 `{"user": 来话, "reply": ""}`** → `:755-761` `inner_outer_pair(reply="")` → `:766` reflow 记一条"我答「」"的经验 → app.py `:276` `body={"reply":"", ...}` → telegram `_generate_reply` `:221` `reply.strip()` 为假 → `None` → `_handle_message:491` `if turn["reply"]:` 为假 → **不发送**。

Kevin 侧观测：**完全静默，无任何提示**。

#### 为什么无重试 [事实]

四层都没有：

| 层 | 有无重试 | 依据 |
|---|---|---|
| `llm_client` HTTP 层 | 有，但**不覆盖此情形**——只对 `_RETRYABLE_STATUS={429,500,502,503,504}`（`:36,145`）与 `httpx.TransportError`（`:179`）重试。一个 200 + 合法 JSON + 空 content 是"成功"，`MAX_RETRIES=2` 一次都不用 | `llm_client.py:145-156, 179-191` |
| `llm_router` | 无，纯透传 | `llm_router.py:232-236` |
| `_completion` | 无 | `conversation.py:1875-1889` |
| `_run_cycle` | **明确拒绝**：docstring `:1444-1448` 写死"信封解析失败在这里**不重试、不回落旧路径**"。理由：回落 = 同一轮两台机器都生成过回复，那条界线一旦模糊，"开关开着时旧路径不生成回复"就再也证不了。止损手段是开关本身 | `conversation.py:1444-1448, 1462-1472` |

`shadow` 那侧同样明写"影子失败静默, 只 log, 不重试"（`cycle:638`）。

#### "有 tokens 但 content 空"的成因 [推断]

`ENVELOPE_RESPONSE_FORMAT = {"type": "json_object"}` 默认开（`llm_router.py:97-115`），且 `llm_router.py:79-84` 的注释已经点名过这个坑：*"the provider can still return an EMPTY content field. That is not a special case for us: an empty body fails `_extract_json` like any other non-JSON response and lands as `reason=not_json, detail=first_char:empty`."*

代码树里 **grep 不到 `reasoning_content`**（实测：零命中）。DeepSeek thinking 模式下 `completion_tokens` 会算进推理 token 而 `content` 为空——本树完全没有读取 `reasoning_content` 的分支，也没有 `finish_reason` 的读取。因此"有 tokens 但 content 空"在**现结构下是不可区分的**：`llm_call` 事件里 `completion_tokens>0`，但 `u3_cycle_failed` 里只有 `first_char:empty`，两条事件之间没有任何关联字段（无 request_id、无 correlation_id）。

#### 【D-01】"有界重试一次 + 失败事件带原始响应元数据"的插入点 [建议]

**插入点 A（推荐，最小面）：`conversation.py:1455-1472`。**

在 `_run_cycle` 的周期体内，把"一次 completion + 一次 parse"包成一个内层有界循环：

```
for attempt in range(ENVELOPE_RETRY_MAX + 1):          # 新常量，建议 = 1（总 2 次）
    message = await self._completion(tools=None, envelope=True)   # 现 :1455
    try:
        decision = parse_envelope(message, ...)                   # 现 :1459
        break
    except Exception as exc:
        reason, detail = classify_failure(exc, message)           # 现 :1463
        if attempt < ENVELOPE_RETRY_MAX and reason == FAIL_NOT_JSON:
            log_event("u3_cycle_retried", reason=reason, detail=detail,
                      step=step, attempt=attempt + 1)             # 新事件
            continue
        log_event(CYCLE_FAILURE_EVENT, ..., attempts=attempt + 1) # 现 :1464，加一栏
        return ""                                                 # 现 :1472
```

为什么在这里而不是更低层：
- `llm_client` 层重试会污染**所有** MAIN 路由调用（工具循环、摘要、旧转录机），破坏 `judgement④`"关着时逐字节不变"。
- `_completion` 层重试拿不到"解析失败与否"这个信号——它不知道自己产出的东西能不能用。
- `_run_cycle` 层是**唯一同时握有响应与解析结果**的地方。

**只对 `FAIL_NOT_JSON` 重试**的理由：`unknown_kind` / `missing_content` 是模型理解偏差，重试大概率复现；空回复 / 截断是采样偶发，重试有实际收益。

**副作用清单（必须一并处理）**：
1. `_completion` 每次调用都会 `_mark_undelivered_surfaced()`（`:1888`）——重试会让未送达条目被标两次。第二次 `mark_undelivered_surfaced` 的入参 `self._pending_undelivered_ids` 在第一次调用后已被清空（`:1184`），所以**幂等**，但第二轮装配的 undelivered 块会是空的。[事实] 这是可接受的，但要写进规格。
2. `self._shadow_input` 只在第一次装配时留（`:1865-1866`），重试不影响。
3. 时延：`shadow_timeout_s()` 不管这条路；`llm_client.HTTP_TIMEOUT=60.0`。两次 = 最坏 120s，而 `telegram_device._generate_reply` 的 httpx timeout 是 **120.0**（`:200`）——**会撞上**。[建议] 重试版本必须同时把设备侧 timeout 抬到 180s，或给 `_run_cycle` 的重试加独立的 `asyncio.wait_for`。

**失败事件的原始响应元数据栏（新增，隐私安全）**——严格遵守 `cycle:304-307` 的隐私口径，只加**非内容**元数据：

| 新栏 | 取值 | 来源 |
|---|---|---|
| `attempts` | int | 循环计数 |
| `content_chars` | `len(message.get("content") or "")` | 长度，非内容 |
| `has_content_key` | bool | `"content" in message` |
| `finish_reason` | str \| None | **需 `llm_client` 一并透出**——今天 `:178` 只返回 `choices[0]["message"]`，丢掉了 `finish_reason`。这是区分"截断"与"契约失败"的唯一信号 |
| `completion_tokens` / `prompt_tokens` | int \| None | 同上，今天只进 `llm_call` 事件（`:172-173`），不进 message |
| `other_message_keys` | `sorted(set(message) - {"role","content"})` | 能直接暴露 `reasoning_content` 的存在，不泄露其内容 |

**[建议] 配套的最小 `llm_client` 改动**：把 `chat_completion` 的返回从 `body["choices"][0]["message"]` 改成附带一个不冲突的元数据键（如 `message["_meta"] = {"finish_reason":..., "usage":...}`），或增一个 `chat_completion_detailed`。前者会改变**所有**调用方看到的 dict 形状（`decide.py:564`、`approval_interpreter.py:368` 都只读 `content`，兼容），后者零风险但要改 `llm_router.complete` 签名。移植到 Cordis 时建议直接采用后者：新运行时没有"逐字节不变"的历史包袱。

---

### 6b. tool_call 派发链

#### 谁消费信封的 `kind=tool_call` [事实]

**`Conversation._run_cycle`** `conversation.py:1498-1513` → **`Conversation._execute_cycle_tool`** `:1516-1559`。

```
_run_cycle 第 step 周期，kind == TOOL_CALL：
  ├ tool = decision.envelope.get("tool")                          :1499
  │    (已经过 sanitize_tool 消毒: cycle:227-251)
  ├ tool is None → u3_cycle_failed reason="missing_tool" + return ""  :1500-1504
  ├ closing (step == MAX_TOOL_STEPS == 8) → 
  │    u3_cycle_tool_budget_exhausted + return ""  ← 不执行、不硬编总结  :1505-1510
  └ outcome = await self._execute_cycle_tool(step, tool)          :1511
       非 None → return outcome （撞了审批门）                      :1512-1513
       None    → **周期继续**，下一次 for 迭代                       :1450

_execute_cycle_tool(step, tool)：
  ├ call = _cycle_call(step, tool["name"], tool["arguments"])     :1531 / :362-374
  │    合成 tools-API 原生形状 {"id": f"cycle-{step}", "type":"function",
  │                              "function":{"name":..., "arguments": json.dumps(...)}}
  ├ self._messages.append({"role":"assistant","content":None,"tool_calls":[call]})  :1532
  │    ← 用 tools API 的词汇把"她决定动手"写进共用的对话历史
  ├ name == VISION_TOOL      → _handle_vision(call)  → return None   :1534-1536
  ├ name == FOLLOWUP_TOOL    → _handle_followup(call)→ return None   :1537-1539
  ├ name == PROGRESS_TOOL    → _handle_progress(call)→ return None   :1540-1542
  ├ action, error_payload = self._build_action(call)               :1543
  │    ★ error_payload is not None → _append_tool_result + return None  :1544-1546
  ├ observation = await dispatch(action, 
  │                  context=DispatchContext(origin="interactive"))  :1547
  ├ needs_approval → deferred 结果 + return await _ask_for_approval(...)  :1548-1557
  └ _append_tool_result(call["id"], _result_payload(action, observation)) ; return None  :1558-1559
```

#### 走不走 `kernel.dispatch` [事实]

**走。** `conversation.py:1547` 就是 `from lykoi.kernel.dispatch import ... dispatch` 的那个 `dispatch`（import `:41`），与 `_run_loop` 的 `:1390` **同一个函数、同一个 `DispatchContext(origin="interactive")`**。docstring `:1437-1440` 明写"同一个 `_build_action` / `dispatch` / 审批门 / 结果回填，分级照旧"。

`_execute_cycle_tool` 与 `_run_loop` 那一支是同一段语义，连"未执行的调用要补一条 deferred 结果"的不变量都照抄（`:1520-1524`）。

#### audit 为什么零痕迹 —— 断点的确切位置 [事实 + 推断]

**前提断言 [事实]**：`dispatch` 一旦被调用，audit **必然**有痕。`dispatch.py:472-490`——`intent = {"event":"action_dispatch", ...}` 在**任何 handler 运行之前**写进不可变 sink，写失败则整个 dispatch 失败 CLOSED（`error="audit_unavailable"`）。所以 **audit 零痕迹 ⟺ `dispatch` 从未被调用**。

断点候选，按"零痕迹程度"排序：

**★ 断点 1（唯一同时零 audit + 零 events 的路径）：`_build_action` 的 unknown-tool 分支。**

```python
# conversation.py:1744-1748
def _build_action(self, call: dict) -> tuple[Action | None, dict | None]:
    name = call["function"]["name"]
    action_type = TOOL_TO_ACTION.get(name)
    if action_type is None:
        return None, {"success": False, "error": f"unknown tool {name!r}"}
```

- `sanitize_tool`（`cycle:227-251`）**刻意不做白名单**（docstring `:231-233`：合法性归 `KNOWN_ACTIONS`/`_build_action` 管，"在这里再抄一份就是两处真相"）。所以任何 ≤64 字的字符串都能通过消毒。
- `TOOL_TO_ACTION` 只有 **10** 项（实测）。信封里她可以写出的名字远不止这 10 个——而信封契约 `ENVELOPE_SYSTEM_PROMPT`（`cycle:149-202`）**从头到尾没有列出任何工具名**！它只说 `"tool": {"name": "...", "arguments": {}}`。工具清单只在 `SYSTEM_PROMPT`（`prompts.py:16-23`）里以自然语言出现，而且那里写的是 `research_open`、`browser_navigate` 这样的名字（与 `TOOL_TO_ACTION` 的键一致），但没有 schema 约束。
- `_build_action` 返回的 error payload 走 `_append_tool_result`（`:1545` → `:1655-1658`）——**这两个函数都没有 `log_event`**。
- 结果：**零 audit 行、零 events 行、零遥测**，周期继续下一步，最多消耗完 8 步预算后 `u3_cycle_tool_budget_exhausted` 或落进 `closing` 周期。

**这是"零痕迹"最贴合的解释。** [推断] 首夜实弹若模型报了 `web_search` / `browser_search` / `search` 之类的名字，症状会与观测完全一致。

**断点 2：demote → silence（零 audit，但 events 有痕）。**
`decide.py:618-619` —— `reason` 未逐字引用任何 `meaning_assessment` 条目 → `_demote(decision, "reason_not_grounded", safe_kind="silence")` → `decision.kind` 变 `"silence"` → `_run_cycle:1485-1489` 直接 `return ""`。**tool 字段还在 `envelope` 里，但代码根本走不到 `:1499`。**
痕迹：`decision_ungrounded`（`decide.py:624`）+ `u3_cycle_envelope` 带 `demoted=True, demote_why="reason_not_grounded", original_kind="tool_call"`（`cycle:586-588`）。
[事实] 信封契约确实警告过（`cycle:173-175`："不引用任何评估条目的非 silence 决定会被确定性地降级为 silence"），但**没有说降级会让工具不执行**——模型看不到 `tool_call` 与这条闸的因果。

**断点 3：`sanitize_tool` 返回 None（零 audit，events 有痕）。**
`cycle:236-251` 的四个 return None：`raw` 非 dict、`name` 非 str、`name` 空或 >64 字。→ `:1500-1504` `u3_cycle_failed reason="missing_tool"`。
[推断] 若模型把 tool 写成 `"tool": "browser_navigate"`（字符串而非对象），正中第一条。

**断点 4：开关关（零 audit，shadow events 有痕）。**
`_switch_on()` 返回 False → 走 `_run_loop`，信封根本不生成；影子路径 `run_shadow` `cycle:613-685` **按设计不 dispatch**（`:620-621` 穷举副作用清单：只有一次 LLM 调用 + 一条事件，"没有第三样：不 dispatch、不 send、不 enqueue_pending、不 apply_inner"），只记 `would_dispatch` 意向。
[推断] 若首夜 `LYKOI_U3_SWITCH_ENABLED` 未真正生效（env 未落进 systemd drop-in、或落了没重启），这就是全部解释——而且 `u3_shadow_envelope` 里会有 `would_dispatch=<工具名>` 的读数，`u3_cycle_envelope` 一条都没有。**这是最容易验证的一条：查 events.jsonl 里 `u3_cycle_envelope` 的条数是否为 0。**

#### 对照自主路径同信封的执行链 [事实]

自主侧的 `Decision` **没有 tool 这个概念**：`envelope_fields=()`，`kind` 表是 7 项行为（explore / record_note / queue_notification / initiate_chat / tend_inner / rest / contemplate），每个 kind 直接对应一个既有动作，不存在"她点名一个工具名"这一步。所以自主路径**没有 `TOOL_TO_ACTION` 这一层名字映射，也就没有断点 1**。

对话侧多出来的那一层——信封里的**自由字符串工具名** → `TOOL_TO_ACTION` 十项映射——正是断点所在。这是对话情境**独有的新增结构**，不是从自主路径继承来的。

#### 【D-02】修正方向 [建议]

1. **契约里列出工具白名单**：把 `sorted(TOOL_TO_ACTION) + [VISION_TOOL, FOLLOWUP_TOOL, PROGRESS_TOOL]` 渲染进 `ENVELOPE_SYSTEM_PROMPT`（像 `{causes}` 那样代入，`cycle:205-206` 已有现成的代入机制）。这不违反"两处真相"——它是从**同一个** `TOOL_TO_ACTION` 派生的投影，不是抄的第二份。
2. **给 `_build_action` 的 unknown-tool 分支加 `log_event`**：这是全树少见的完全静默失败路径。
3. **让 demote 对 `tool_call` 可观测**：`u3_cycle_envelope` 已带 `original_kind`，但需要一条独立告警（如 `u3_cycle_tool_demoted`），因为"她想动手却被闸掉"与"她本来就想沉默"在运维上是两件完全不同的事。
4. **[建议] 新实现里把工具名做成枚举**：Cordis/TS 天然有 union type + 运行时 schema 校验（zod 等）。让"信封里的工具名"在类型层就只能是 10 个字面量之一，断点 1 从运行时错误降级为编译期错误。

---

## §7 出站链路

### 7.1 说话动作 → dispatch → 设备出站 [事实]

```
[切换态] _run_cycle kind==reply → decision.content 作为回合返回值        conversation.py:1490-1492
[旧路径] _run_loop 无 tool_calls → assistant["content"]                  conversation.py:1372-1374
                                    ↓
send() 返回 reply                                                        conversation.py:780
                                    ↓
app.py chat() body={"reply": reply, "pending_approvals": pending}        app.py:276
   ★ 注意：若 pending>0 且非本轮问句，reply 被前置横幅改写                :270-274
     "⚠️ 有 N 条待批准操作。\n\n" + reply
     ← [事实] 这意味着一个 silence 回合（reply=""）在有 pending 时
       会产出一条**非空**回复 "⚠️ 有 N 条待批准操作。\n\n"，
       于是 telegram 会真的发出去。沉默被横幅破坏。
                                    ↓
_generate_reply 归一化: reply.strip() 为假 → None                        telegram_device.py:218-223
                                    ↓
_handle_message: if turn["reply"]: await _send_reply(...)                :491-492
                                    ↓
_send_reply(context_id=chat_id, text=reply, reply_to=入站 message_id)     :292-349
   ├ ctx = DispatchContext(origin="interactive",
   │        exemption=policy_exemption.in_presence_reply(context_id))     :299-301  ← E2 盖章
   ├ params = {"text":..., "context_id":..., "reply_to":...}              :302
   ├ action = Action("messenger.send", params)                            :303
   └ observation = await dispatch.dispatch(action, context=ctx)           :304
                                    ↓
kernel.dispatch → approval.check(..., exemption=ctx.exemption)            dispatch.py:435-437
   → immutable audit "action_dispatch" (handler 之前，失败即 CLOSED)      dispatch.py:472-490
   → resources.messenger.send(params)                                     messenger.py:185-208
       ├ text 空 → ValueError                                             :197-198
       ├ context_id 空 → ValueError                                       :199-201
       ├ reply_to is None → _reserve_proactive_slot()                     :203-206  ← ★打扰预算★
       │     被挡 → return {"sent": False, "throttled": True, "reason": ...}
       └ _TRANSPORT.send_message(context_id, text, reply_to)              :207
                                    ↓
TelegramTransport.send_message                                            transport.py:347-378
   ├ reply_to 可 int 化 → payload["reply_to_message_id"]；否则**省略仍发** :349-353
   └ _post("sendMessage", payload, retry_backoff=SEND_RETRY_BACKOFF_S)     :354
```

### 7.2 分段 / 回执 / undelivered / 重试 [事实]

**分段：不存在。** 全树无消息分片逻辑。`text` 原样进 `sendMessage` payload（`transport.py:348`）。唯一的长度约束是**审批执行回执**的 `RESULT_MAX_CHARS=1500`（`approval_conversation.py:93, 320-324`），它裁的是回执正文而非分段。[事实] Telegram 4096 字上限会由 API 返回 `api_error`（`transport.py:340-342`）→ 落未送达账本。

**重试**（`transport.py:47-67, 284-321`）：
- 序列 `SEND_RETRY_BACKOFF_S = (2.0, 5.0, 15.0, 30.0)`——至多 4 次重试，总睡眠 52s ≤ 60s 总窗。
- **只有 `sendMessage` 传它**；`getUpdates` 的重连节奏归 device 的长轮询循环（`:276-277`）。
- 分类只决定 `ambiguous` **标记**，不决定重不重试（`:291`）：`DEFINITE_FAILURE_EXCEPTIONS = (ConnectError, ConnectTimeout, ProxyError)` → `ambiguous=False`；其余 `httpx.HTTPError` → `ambiguous=True` 但**照样重试**。
- **取舍钉死**（`:57-60`）：*丢话之害 > 偶发重复之害*。歧义类也重试，只在事件里标 `ambiguous=true` 供事后对账。
- 429 单独一路：`MAX_RATE_LIMIT_RETRIES=3`，honour `retry_after`（`:324-334`）。

**回执两结局，没有第三种**（模块 docstring `:20-21`）：

```
成功 → {"message_id": ..., "context_id": ..., "ts": ...}                transport.py:377-378
失败 → record_undelivered(...) + {"message_id": None, "sent": False,
                                  "error", "ambiguous", 
                                  "undelivered_recorded": True}         transport.py:355-376
```

`_send_reply` 的三分支（`telegram_device.py:305-349`）：
| 分支 | 条件 | 动作 |
|---|---|---|
| 送达 | `observation.success` 且 `data["sent"] is not False` 且 `message_id is not None` | `chat_reply_delivered` 事件（`:311-317`） |
| 未送达补记 | 成功但无 message_id 且 `not data.get("undelivered_recorded")` | `record_undelivered(source="chat_reply")`——transport 没到（被打扰频控挡下）时它没机会记账（`:318-325`） |
| 需审批 | `not success` 且 `data["needs_approval"]` | `request_approval(..., reply_to=reply_to)` + `telegram_reply_awaiting_approval`；**排队等批 ≠ 未送达**（`:327-341`） |
| dispatch 失败 | 其余 | `telegram_reply_send_incomplete` + `record_undelivered(source="chat_reply")`（`:342-349`） |

**`record_undelivered`** `transport.py:107-144`：事件与记录**在同一个函数里**，不存在"记了表没发事件"的半截状态。记录字段 9 项：`ts / context_id / text_summary(前 200 字) / chars / error / ambiguous / attempts / source / id`。事件里**只有字数，没有正文**。随后 `_record_undelivered_experience` `:147-190` 把它落成她的一条经验（`source="conversation"`, `salience=0.6`），经 `mind_reflow.record_experience` 单写者入口；失败吞掉但落 `telegram_undelivered_experience_failed`。

### 7.3 打扰预算与 reply_to 不计预算的判定 [事实]

```python
# resources/messenger.py:127-128
PROACTIVE_DAILY_CAP = 1
PROACTIVE_COOLDOWN_H = 6.0
_LEDGER_MAX_KEEP = 50

# resources/messenger.py:203-206  ← 判定点，唯一一处
reply_to = params.get("reply_to")
if reply_to is None:
    reason = _reserve_proactive_slot()
    if reason is not None:
        return {"sent": False, "throttled": True, "reason": reason}
```

**判定就是 `params["reply_to"] is None`**——不是空串判定、不是内容启发式。`_throttle_reason` `:152-162`：先查当日计数（ISO 前 10 字比日期）≥ 1 → `"daily_cap"`；再查距上次 < 6h → `"cooldown"`。`_reserve_proactive_slot` `:165-180` 在 `file_lock` 内**原子 check-and-reserve**。账本损坏当空（`:140-143`：最坏多发一条，仍受日配额约束）。

**节流不抛异常**（`:192-195`）：返回正常的 `{"sent": False, "throttled": True}`，与 `autonomy.initiate_chat` / `notify.owner` 同一形状——认知侧体验为**结局**，不是崩溃。

**[事实] 病灶复盘（`conversation.py:430-445` 与 `telegram_device.py:256-265` 两处同源记载）**：`_ask_for_approval` 在非委托态下自己发问句，而**认知侧没有当轮入站 message_id**——`/chat` 请求体里从来就没有它。于是问句是 `reply_to=None` 的 `messenger.send`，按主动打扰计费，cap 1/UTC 日一耗尽，当天余下每个问句都 `undelivered → deny_by_default`。2026-08-19 01:40 CST audit 里**6 连拒**。修法不是"把 id 送进认知侧"（那会破坏 P1 E2 分层），而是**把问句移到设备层去发**（`WO-FIX-APPROVAL-DELIVERY ②`，即 `delegate_approval_ask` 那条路）。

**[事实] 三条绕开打扰预算的合法路径**：
1. `reply_to` 非 None（应答 / 审批问句 / 回执 / clarify——都走 `_reply_ref`）。
2. `_deliver_outbox_item`（`telegram_device.py:354-388`）**直接调 `transport.send_message`，完全不过 dispatch**——理由 `:357-364`：预算已在上游收过（`autonomy.initiate_chat` 过 `proactive_chat` 账本日 1 条/冷却 ≥6h；followup 是他自己起的任务的下文），再收一遍是同一件事收两遍税。**副作用**：这条路上**零 audit 行、零 approval.check、零 E1/E2 章**。[建议] 移植时必须显式记录这一条，它是唯一一条绕过 dispatch 的对外文本出站。
3. `post_progress` → `chat_outbox.append`（`conversation.py:1722`）→ 由上面那条路投出去。

### 7.4 `chat_outbox` 与 telegram outbox 游标关系 [事实]

`shared/chat_outbox.py` 里住着**两张互不读写的表**（`:76-95` 明写这一点）：

| 表 | 路径 | 是什么 |
|---|---|---|
| **主动发言队列** | `OUTBOX_PATH` = `state/chat_outbox.json`（`:26`），环形 200（`:27`） | 广播日志。三个写者：`autonomy.initiate_chat`（kind=`proactive`）、`followup._deliver`（kind=`followup`/`approval_request`）、`post_progress`（默认 kind=`followup`） |
| **未送达账本** | `UNDELIVERED_PATH`（`:136-138`），环形 200（`:139`） | U0 的"没送出去"记录。**单写者**：只有 `telegram_transport.record_undelivered`（`:93-95`） |

**游标关系**：

- `chat_outbox` 是 **多消费者、各持游标的非破坏性广播日志**。`read_after(after, limit)` `:90-131` 只读不改，返回 `{messages, count, next_cursor, oldest_id, newest_id, gap}`。`gap=True` 表示消费者的游标已经掉出环形窗口（`:104`），是丢消息的显式信号。
- 消费者 1：`GET /chat/outbox`（`app.py:190-196`）——CLI/Mac 客户端，游标由客户端持有。
- 消费者 2：**telegram 设备**（`telegram_device.py:391-426`），游标持久化在 `OUTBOX_CURSOR_PATH` = `state/telegram_outbox.cursor`（`:70-72`），键 `last_outbox_id`。
- 两个消费者**互不影响**（读非破坏性）。同一条消息可能既被 Mac 渲染又被 telegram 投递——[推断] 这是设计接受的（Mac app 在具身转向后已非主用）。

**telegram outbox 游标的三条纪律**：

| 纪律 | 语义 | 锚点 |
|---|---|---|
| **首启起点 = 当前 max id** | `_init_outbox_cursor` `:143-157`：没有持久化游标（首启**或损坏**）→ `chat_outbox.newest_id()`。理由：账本是历史广播日志不是待发队列，首启全发等于给 Kevin 灌一遍几天前的死链（当时 42 条陈货） | `:144-150` |
| **损坏方向与入站游标相反** | 入站游标损坏当 0（重放，至多多回一次）；出站游标损坏当首启（**跳过**）。"宁跳过不重复灌陈货" | `:116-122` |
| **游标推进在结局落定之后** | 一条要么拿到 message_id、要么已进未送达账本，游标才落盘。崩在中间 → 下次重投。同 U0 取舍：丢话之害 > 偶发重复之害 | `:391-401, 423-425` |

**kind 过滤**：`OUTBOX_DELIVERABLE_KINDS = ("proactive", "followup")`（`:77`）。`approval_request` 被**显式跳过**（旧 surface 遗物；审批问答自 WO-S3 起由 `approval_conversation` 在同一 chat 里自问自答，从这条路再投一遍就是同一问题问两次）。跳过**落痕** `chat_outbox_skipped`，游标**照推**（`:411-416`）。

**无 owner 绑定**：游标**不推进**，落 `chat_outbox_no_owner_binding` 并 `return cursor`——这些话还没出过站，绑定补上之后仍该说出去（`:417-422`）。

**位置**：出站消费接在长轮询的**间隙**（`:552-558`），自成一个 `try`——出站这边出任何事都不许改长轮询的节奏，既不触发退避也不让它少转一圈。`OUTBOX_BATCH_LIMIT = 20`（`:78`）。

**§forbidden 纪律**（`:400-401`）：这条循环只投递"从未出过站的"（游标之后的条目），**绝不碰未送达账本**——重说是她的认知决定，不是循环的机械行为。未送达唯一回到她面前的路是 §3 的 `BLOCK_UNDELIVERED` 上下文块（≤3 条）。

---

## §8 行为规格总表

新实现必须保真的语义清单。三档标注：**【逐字】** = 必须逐字迁移（文案 / 常量 / 顺序）；**【等价】** = 语义等价即可；**【缺陷】** = 已知缺陷，新实现按修正版。缺陷修正版条目用 `D-` 前缀单列。

### A. 入站（S-01 ~ S-11）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-01 | 长轮询 `getUpdates?offset=cursor+1`，`timeout=25`，HTTP 客户端 timeout = `timeout+10`（长轮询等待不得被误判为网络故障） | `telegram_device.py:86, 504`; `transport.py:401` | 【等价】 |
| S-02 | 双重去重：Bot API 的 offset ack + 进程侧 `update_id <= cursor → continue` | `telegram_device.py:507`; `transport.py:395-399` | 【等价】 |
| S-03 | 入站游标**逐条**推进并落盘（`update_id` 处理完之后），不是批量末尾 | `telegram_device.py:512-513` | 【逐字】(时序) |
| S-04 | 入站游标损坏 / 缺失 → **0**（重放）。与出站游标方向相反 | `telegram_device.py:93-106, 116-122` | 【逐字】 |
| S-05 | `sender_id` 或 `chat_id` 缺失 → 静默丢弃，无事件 | `telegram_device.py:434-435` | 【等价】 |
| S-06 | 未绑定发送者 → 丢弃 + `telegram_inbound_dropped_unbound`（带进程级累计计数）。绑定表**只读，此进程绝不写** | `telegram_device.py:436-439, 165-166, 533-539` | 【逐字】 |
| S-07 | 入站存档 `ingest_inbound` 在 `_is_bound` **之后**、任何路由之前；无去重；环形 200；畸形输入降级为空字段而非抛出 | `telegram_device.py:440-448`; `messenger.py:244-277` | 【等价】 |
| S-08 | 三级路由，严格顺序：审批回答 → 规则建议回答 → 普通 `/chat`。前两级**仅 owner**，且各自 `outcome != "ignored"` 时**消费掉这条消息并 return** | `telegram_device.py:454-487` | 【逐字】(顺序) |
| S-09 | `_is_owner` 严格窄于 `_is_bound`：必须是 `owner_primary` 的 telegram 绑定；两侧任一未知即 False，永不默认 yes | `telegram_device.py:169-177` | 【逐字】 |
| S-10 | 出站顺序：**先说话，后请示**。空回复是合法结局，且不再意味着"这一轮没有下文" | `telegram_device.py:489-494` | 【逐字】(顺序) |
| S-11 | `edited_message` 被当作新 message 处理，会触发一次新回合 | `transport.py:415` | 【等价】+ 见 D-06 |

### B. 回合骨架（S-12 ~ S-22）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-12 | `send()` 全程持 `self._lock` 串行化；摘要（`_govern_context`）在**锁外**跑，只在短暂重入锁里做本地改列表 | `conversation.py:693, 772-777, 1197-1238` | 【等价】 |
| S-13 | 一轮开场清六个"一轮一份"字段：`_background`/`_followup_request`/`_delegate_approval_ask`/`_delegated_ask`/`_cycle_inner`/`_shadow_input` | `conversation.py:694-701` | 【逐字】 |
| S-14 | 回合异常 → **整轮回滚** `del self._messages[checkpoint:]` + `chat_turn_rolled_back` + 重抛。已 dispatch 的副作用留在 audit 里 | `conversation.py:705, 711-719` | 【逐字】 |
| S-15 | `_relevant_memories` 在 `finally` 里清空——召回是针对**这句话**的，展示期就是这一轮 | `conversation.py:720-723` | 【逐字】 |
| S-16 | 每个成功回合恰好一条 `history(conversation)` 行 + 一条 `inner_outer_pair` + 一次 `conversation_turn_reflow`（reflow 失败是遥测，不是坏掉的回合） | `conversation.py:747-770` | 【等价】 |
| S-17 | `interactive_lock.mark_active()` 在 send 开头**与**结尾各一次（告诉 autonomy 进程让路） | `conversation.py:692, 778` | 【等价】 |
| S-18 | `MAX_TOOL_STEPS = 8`；`range(MAX_TOOL_STEPS + 1)`，第 8 步是 closing 轮 | `conversation.py:54, 1363-1364, 1450-1451` | 【逐字】 |
| S-19 | closing 轮追加一条 system 提示；两条路径文案不同（`_run_loop` 说"不能再调用工具"，`_run_cycle` 还要指出 `promise_followup` 接力出口） | `conversation.py:1366-1369, 1417-1420, 1452-1453` | 【逐字】(sha 见 §3.2) |
| S-20 | `/chat` 的 `ContextBudgetError` → **HTTP 413** `{"error":"message_too_large"}`，且**不调度后台重试**（确定性失败） | `app.py:243-250` | 【逐字】 |
| S-21 | `/chat` 的其它异常 → **HTTP 502** `{"error":"turn_failed"}`，客户端只见泛化类别，`str(exc)` 只进内部日志（可能带 provider URL/配置） | `app.py:251-266` | 【逐字】 |
| S-22 | 后台回合（`background=True`）与现场回合**完全同路**，唯二差别：禁止再登记 `promise_followup`（无递归）+ `post_progress` 仅后台可用 | `conversation.py:686-691, 1702-1706, 1719-1720` | 【等价】 |

### C. 上下文装配（S-23 ~ S-34）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-23 | 三段带顺序：稳定前缀 → 历史 → 易变尾部。**12 个块标签**，顺序以 `_stable_prefix()`/`_volatile_tail()` 的返回序为准（**不是常量声明序**） | `conversation.py:113-124, 824-885, 942-1063` | 【逐字】 |
| S-24 | 稳定段实际顺序：persona → organs → narrative → backfill → summary → **concerns（末尾）** | `conversation.py:951-978` | 【逐字】 |
| S-25 | 易变尾部实际顺序：memories → thoughts → time → undelivered → self_state | `conversation.py:1029-1062` | 【逐字】 |
| S-26 | **空态零字节**：任何可空块为空时**不加块**，不加占位文案 | `conversation.py:578-582, 1003-1004, 1099-1102, 1155-1158` | 【逐字】 |
| S-27 | 稳定前缀的失效印记 = `(integration_state.last_integration_at, 最新 focus_cycles.id)`，**跨进程可读**；印记读不到 → 保持现状（不重建、不报错） | `conversation.py:889-940` | 【等价】 |
| S-28 | `CONTEXT_WINDOW_TURNS=8`（env 可覆写）、`CONTEXT_BACKFILL_ROWS=20`、`CONTEXT_MAX_INPUT_TOKENS=50000`、`SUMMARY_MAX_TOKENS=1024`、`SUMMARY_TEMPERATURE=0.3`、`BACKFILL_CLIP_CHARS=400`、`NARRATIVE_CLIP_CHARS=2000`、`_TOOL_RESULT_CLIP_CHARS=300`、`UNDELIVERED_CONTEXT_MAX=3`、`L3_PROBE_MAX_CHARS=200`、`L3_RETRIEVAL_LIMIT=6`、`L3_LINE_CHARS=80`、`CONCERNS_CONTEXT_MAX=5`、`CONCERNS_DESC_CHARS=60` | `conversation.py:72-91, 99-107` | 【逐字】 |
| S-29 | 裁剪**只在轮边界**（user 消息处）切，assistant 的 `tool_calls` 与它的 tool 结果永远同生共死 | `conversation.py:1191-1195` | 【逐字】 |
| S-30 | 硬预算裁剪顺序：最老的完整轮（不动当前轮）→ backfill → 都没了就抛 `ContextBudgetError` | `conversation.py:1292-1309` | 【逐字】 |
| S-31 | 软窗摘要按**对象身份**（`id(m)`）而非索引重新对齐，以支持无锁摘要；摘要失败**什么都不丢** | `conversation.py:1197-1238` | 【等价】 |
| S-32 | 读侧卫生：回灌与召回都过 `dsml.strip_markup`——库里已落的机器标记不许经这两条路重回上下文 | `conversation.py:600, 1125` | 【逐字】 |
| S-33 | `_undelivered_block` 与 `_build_relevant_memories` **只读不标**（`_enforce_budget` 会反复调 `_assemble`）；标 surfaced 落在 `_completion` 拿到回应之后，调用失败则不标 | `conversation.py:1144-1147, 1069-1073, 1886-1888` | 【逐字】 |
| S-34 | 转正结论只读 `promoted_focus_insights()`（status=`active`），**不读** `list_focus_insights()` 全集；只叠在对话路径，不进 `build_persona_prompt()`（那是 decide 共用的投影） | `conversation.py:544-585` | 【逐字】 |

### D. 信封契约（S-35 ~ S-47）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-35 | `CONVERSATION_KINDS` 恰 4 项；`CONTENT_REQUIRED` 恰 2 项（reply / promise_followup）；`SAFE_KIND = silence`；`ENVELOPE_FIELDS = ("tool","情绪脉冲")` | `conversation_cycle.py:50-69` | 【逐字】 |
| S-36 | `safe_kind` **永不降级**——它是失败方向，不需要辩护 | `decide.py:613-614` | 【逐字】 |
| S-37 | 候选表闸：kind 不在候选表 → demote `kind_not_in_candidates` | `decide.py:615-617` | 【逐字】 |
| S-38 | grounded 引用闸：`reason` 必须**逐字**包含某条 `meaning_assessment` 的 `item` 或 `meaning`（去空白后 ≥ `GROUND_MIN_CHARS=4`），否则 demote `reason_not_grounded` | `decide.py:72, 362-372, 618-619` | 【逐字】 |
| S-39 | demote 效果：存 `original_kind` → `kind=safe_kind` → `demoted=True` → **`grounded_concern_ids` 清空** | `decide.py:623-629` | 【逐字】 |
| S-40 | fail-closed 注入 id 门（念头 resolve）：解析层 + store 层**两道**；空 allowed 集丢弃全部 | `decide.py:414, 458, 502-507` | 【逐字】 |
| S-41 | fail-closed 注入 id 门（concern / thread）：不在快照注入集的 id 一律丢弃 + `grounding_concern_out_of_snapshot` | `decide.py:333-359, 379-388` | 【逐字】 |
| S-42 | 情绪脉冲只能报 `CAUSES` 表里的**名字**（15 个），去重保序；表外名字静默丢弃；**幅度不由调用方给** | `conversation_cycle.py:254-268`; `regulation.py:27-47` | 【逐字】 |
| S-43 | `sanitize_tool` 只做形状与边界（name ≤64、arguments JSON ≤2000），**刻意不做工具白名单**；两个消毒器都**永不抛** | `conversation_cycle.py:227-268` | 【逐字】+ 见 D-02 |
| S-44 | `inner.thoughts` ≤2 条/次（`_INNER_MAX_THOUGHTS_PER_CALL`）、content ≤200 字、kind 白名单 5 值、扫描上界 8 条 | `decide.py:393-448` | 【逐字】 |
| S-45 | `bool` 是 `int` 的子类，必须显式拒绝（`resolve` id / `charge_hint` / `concern_id` / `confidence`） | `decide.py:349, 434, 456`; `approval_interpreter.py:294` | 【逐字】 |
| S-46 | 六个失败归因 + `missing_tool` + `tool_budget_exhausted`，**全部**终态 = 沉默 + 落账 | §2.3 全表 | 【逐字】 |
| S-47 | 失败 detail **只能是模板组合，不是模型文本转录**；`kind` 值 ≤20 字才原样记（**不截断**，超长只记长度）；`_other_detail` 绝不记 `str(exc)` | `conversation_cycle.py:304-307, 361-393` | 【逐字】 |

### E. 切换开关（S-48 ~ S-53）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-48 | `LYKOI_U3_SWITCH_ENABLED` **恰好一个生产读者**：`Conversation._switch_on()`。默认关。真值集 `{"1","true","yes","on"}` | `conversation.py:650-664`; `conversation_cycle.py:79-105` | 【逐字】 |
| S-49 | 开关**一轮读一次**：一个回合只有一种身份，不许前半段新路后半段旧路 | `conversation.py:702-704` | 【逐字】 |
| S-50 | 切换态下旧转录机的念头出口（`extract_inner_from_reply` / `_apply_conversation_inner`）**零调用**——否则一个回复里恰好出现分隔符就会凭空多一条念头 | `conversation.py:728-737` | 【逐字】 |
| S-51 | 切换态下**不起影子**（`_spawn_shadow` 立刻返回），`conversation_shadow` 路由零调用零事件 | `conversation.py:805-806` | 【逐字】 |
| S-52 | `envelope=True` 时且仅此时传 `response_format`；`json` 强制默认**开**（`LYKOI_U3_ENVELOPE_JSON_MODE`），与切换开关是**两个独立的钮** | `conversation.py:1867-1885`; `llm_router.py:97-115` | 【逐字】 |
| S-53 | `resume_approved` 的下半场与回合本身走同一条路（**重新读一次开关**） | `conversation.py:1805-1808` | 【逐字】 |

### F. 工具执行与审批（S-54 ~ S-68）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-54 | 三个 in-cognition 工具不过 dispatch：`vision_describe`（本身是 LLM 调用）、`promise_followup`（队列登记）、`post_progress`（写对话出站队列）。它们不在 `TOOL_TO_ACTION` 里 | `conversation.py:351-353, 1377-1385, 1534-1542` | 【逐字】 |
| S-55 | `TOOL_TO_ACTION` 恰 10 项；`notify.owner` 的 `params["origin"]` 由**这个循环**盖章，永不由模型给 | `conversation.py:141-152, 1753-1754` | 【逐字】 |
| S-56 | `browser.screenshot` 的真实路径**永不交给模型**，只给不透明 `attachment_id`；只有可信生产者发出的 id 才 resolve | `conversation.py:1642-1653, 1668-1672` | 【逐字】 |
| S-57 | 撞审批门时，**这一个及其后所有未应答的 tool_call** 都要补 deferred 结果，然后才 return——一条 assistant/tool_calls 后面必须跟得上它的 tool 结果 | `conversation.py:1398-1405, 1520-1524, 1553-1556` | 【逐字】 |
| S-58 | `_ask_for_approval` 的返回值就是这一回合的回复；两条已有问句在途的路径**返回空串**（问句就是那条消息，不复述）；只有一条问句都问不出去时才说 `ASK_FALLBACK` | `conversation.py:1590-1640` | 【逐字】 |
| S-59 | 委托态（`delegate_approval_ask=True`）下认知侧**只交出动作载荷 4 项**，**不预先 enqueue**——排队跟着问句走，在设备侧由 `request_approval` 一次做完 | `conversation.py:446, 1602-1616`; `app.py:281-284` | 【逐字】 |
| S-60 | `take_delegated_ask` / `take_followup_request` 都是**取走即清**——同一载荷被两个调用方各问一遍就是同一件事两条问句 | `conversation.py:1729-1742` | 【逐字】 |
| S-61 | `request_approval` 四道闸顺序：去重 → 静默期 → **先发** → **后排**；每个非 `asked` 状态都意味着动作**不执行**，从这里没有任何执行路径 | `approval_conversation.py:148-274` | 【逐字】 |
| S-62 | enqueue 失败必须发撤回消息（`RETRACT_TEMPLATE`）且**不留队列条目**；撤回本身失败也仍然 audit + 无队列条目 | `approval_conversation.py:237-255` | 【逐字】 |
| S-63 | **没有递归**：审批漏斗发出的 `messenger.send` 若回 `needs_approval`，只落 `approval_message_undelivered` 然后终止 | `approval_conversation.py:37-42, 134-138` | 【逐字】 |
| S-64 | 归属判定四信号 + 三条硬拒（`ambiguous_multiple` / `stale_unreferenced` / `no_match_chitchat`）；两条追问、一条沉默；**多条悬置一律不猜** | `approval_interpreter.py:412-471, 736-782` | 【逐字】 |
| S-65 | `UNREFERENCED_ANSWER_WINDOW_MIN=10.0`、`SEMANTIC_MATCH_MIN=0.34`、`STANDARD_CLARIFY_LIMIT=1`、`_STOPWORDS` 46 项、`OWNER_ANSWER_WORDS` 27 项 | `approval_interpreter.py:63, 69, 73-78, 93-98, 126` | 【逐字】 |
| S-66 | `interpret` 的**每一条**失败路径都落 `unclear`，永不 `approve`；三消息结构（system / 动作**数据** / 主人的话）分离是防注入的结构面 | `approval_interpreter.py:335-374, 205-243` | 【逐字】 |
| S-67 | 硬门（`HARD_ASK_TYPES` = `{terminal.exec, delegation.dispatch}`）：unclear 永远追问（无轮次上限）；approve 只 `execute_once`，**永不产生常设授权**，且**显式不调** `grant_standing` | `approval_interpreter.py:528-574, 824-828`; `guardian/policy_core.py:33` | 【逐字】 |
| S-68 | 确定性快通道：仅当**恰 1 条悬置** + 回答精确等于 `执行`/`不要` 时跳过 LLM，且必产 `scope="this_only"` → `execute_once` | `approval_interpreter.py:658-701, 787-793` | 【逐字】 |

### G. 豁免与审计（S-69 ~ S-75）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-69 | 豁免只由 `Exemption` **类型**携带，从不由 `params` / 文本携带；字符串 `"E1"`、字典 `{"category":"E1"}`、None 一律不命中 | `policy_exemption.py:90-98` | 【逐字】 |
| S-70 | `EXEMPT_ACTION_TYPES` 恰 `{"messenger.send"}`——工具动作不因伴随应答而降级 | `policy_exemption.py:54, 99-100` | 【逐字】 |
| S-71 | E2 收件人必须与盖章时的 `peer_context_id` **精确字符串相等**；空 context_id 抬成 None → 必然落空 → 回到原分级 | `policy_exemption.py:81-87, 104-107` | 【逐字】 |
| S-72 | 豁免在 `approval.check` 的**最后一步**被咨询——**只能收紧不能放宽**：既不能让 `terminal.exec` 免过硬门，也不能推翻 `always_deny` | `approval.py:338-360` | 【逐字】 |
| S-73 | 豁免免掉的是**问**，从来不是**账**：一条免询出站在 audit 里必须比普通出站**多一栏**（`exemption`），非标记记 `None` | `dispatch.py:427-429, 472-478`; `policy_exemption.py:110-112` | 【逐字】 |
| S-74 | dispatch 的 `action_dispatch` audit 行在**任何 handler 之前**写入；写失败 → 整个 dispatch **失败 CLOSED**（`error="audit_unavailable"`，无副作用） | `dispatch.py:395-398, 480-490` | 【逐字】 |
| S-75 | `consume_pending` 是执行的原子性点（跨进程 file lock 打 `consumed_at`，拒绝二次认领）——两个回答竞争或一个回答到两次，**恰好执行一次**；消费后记录**留在账本里不删** | `approval_conversation.py:279-317`; `conversation.py:1771-1775` | 【逐字】 |

### H. 出站（S-76 ~ S-86）

| # | 语义 | 依据 | 档 |
|---|---|---|---|
| S-76 | 打扰预算判定点唯一且就是 `params["reply_to"] is None`；`PROACTIVE_DAILY_CAP=1`、`PROACTIVE_COOLDOWN_H=6.0`、`_LEDGER_MAX_KEEP=50` | `messenger.py:127-131, 203-206` | 【逐字】 |
| S-77 | 节流**返回结局不抛异常**：`{"sent": False, "throttled": True, "reason": "daily_cap"\|"cooldown"}` | `messenger.py:192-206` | 【逐字】 |
| S-78 | `_reserve_proactive_slot` 在 file_lock 内**原子 check-and-reserve**；账本损坏当空（最坏多发一条，仍受日配额约束） | `messenger.py:140-143, 165-180` | 【逐字】 |
| S-79 | E2 章只能在**设备层**盖（唯一知道"对端是谁"是结构事实的那一层） | `telegram_device.py:292-301` | 【逐字】 |
| S-80 | 一条出站消息只有两种结局：**有 message_id（送达）**，或**在未送达账本里**。没有第三种 | `transport.py:20-21, 355-378`; `telegram_device.py:305-349` | 【逐字】 |
| S-81 | 重试序列 `(2.0, 5.0, 15.0, 30.0)` 至多 4 次，总睡眠 52s；**只有 sendMessage 传它**；歧义类（`ReadTimeout` 等）**也重试**，只在事件里标 `ambiguous=true`。取舍：丢话之害 > 偶发重复之害 | `transport.py:47-67, 284-321, 354` | 【逐字】 |
| S-82 | 429 单独一路：`MAX_RATE_LIMIT_RETRIES=3` + honour `retry_after` | `transport.py:45, 324-334` | 【等价】 |
| S-83 | **token 纪律**：任何错误路径只暴露类别（异常类名 / HTTP status），**绝不** `str(exc)` 或请求 URL（httpx 异常字符串里嵌着含 token 的完整 URL）；`trust_env=False` 防环境代理劫持 | `transport.py:8-14, 101-104, 219-220` | 【逐字】 |
| S-84 | `record_undelivered` 里事件与记录**同一函数**（无半截状态）；事件只留字数，正文只在文件里留前 200 字；随后落成她的一条经验（`source="conversation"`, `salience=0.6`） | `transport.py:88-95, 107-190` | 【逐字】 |
| S-85 | telegram outbox 游标：首启/损坏 → **当前 max id**（不灌陈货）；已持久化 → 从那接着；**推进在结局落定之后**；`OUTBOX_DELIVERABLE_KINDS=("proactive","followup")`，`approval_request` 显式跳过**并落痕**；无 owner 绑定 → 游标**不推进** | `telegram_device.py:70-78, 116-157, 391-426` | 【逐字】 |
| S-86 | 出站消费接在长轮询**间隙**，自成一个 try——嘴哑了不许把耳朵带聋（不触发退避、不让长轮询少转一圈）；`OUTBOX_BATCH_LIMIT=20` | `telegram_device.py:78, 552-558` | 【逐字】 |

### I. 缺陷条目（D-01 ~ D-08）

| # | 缺陷 | 依据 | 修正版语义 |
|---|---|---|---|
| **D-01** | **json 空回复无重试、无归因元数据**。200 + 合法 JSON + 空 `content` 不是任何一层的可重试情形；`_run_cycle:1472` 直接降级沉默。`completion_tokens>0` 只进 `llm_call` 事件，与 `u3_cycle_failed` 之间**无任何关联字段** | `llm_client.py:145-178`; `conversation.py:1455-1472`; `decide.py:319-330` | 在 `_run_cycle` 周期体内加**有界重试一次**（只对 `FAIL_NOT_JSON`），落 `u3_cycle_retried`；失败事件新增 `attempts` / `content_chars` / `has_content_key` / `finish_reason` / `completion_tokens` / `other_message_keys`（**全部非内容元数据**）。`llm_client` 需一并透出 `finish_reason` 与 `usage`。**配套**：设备侧 httpx timeout 120s 必须抬高，否则重试会撞上 |
| **D-02** | **tool_call 派发链的静默断点**：`sanitize_tool` 不做白名单 + 信封契约**不列工具名** + `_build_action` 的 unknown-tool 分支**无 `log_event`** → 零 audit、零 events、零遥测 | `conversation_cycle.py:227-233, 149-202`; `conversation.py:1744-1748, 1655-1658` | ①把 `TOOL_TO_ACTION` 的键渲染进信封契约（用现成的 `{causes}` 代入机制，从同一真相源派生）；②给 unknown-tool 分支加 `log_event("cycle_unknown_tool", name=...)`；③新实现里把工具名做成运行时校验的字面量枚举 |
| **D-03** | **demote 对 `tool_call` 不可观测**：`reason_not_grounded` 把一个"她想动手"的信封悄悄变成沉默，运维上与"她本来就想沉默"读不出区别；契约也没告诉模型这条因果 | `decide.py:618-619`; `conversation.py:1485-1489`; `conversation_cycle.py:173-175` | 加独立事件 `u3_cycle_tool_demoted`（带 `original_kind` 与 `tool_name`）；契约里把降级后果写清（"tool_call 被降级 = 那个工具不会执行"） |
| **D-04** | **横幅破坏沉默**：`app.py:270-274` 在有 pending 时把 `"⚠️ 有 N 条待批准操作。\n\n"` 前置到 reply 上。当 reply 为 `""`（silence 回合）时，产出一条**非空**回复并被真的发出去——沉默作为一个正当动作被基础设施推翻 | `app.py:270-274`; `conversation.py:1485-1489`; `telegram_device.py:491` | reply 为空时**不加横幅**（`if pending and reply and not is_awaiting_approval()`）。沉默必须能一路走到底 |
| **D-05** | **重试会重复标 undelivered 展示期**：`_completion:1888` 每次调用都 `_mark_undelivered_surfaced()`。虽然第二次因 `_pending_undelivered_ids` 已清空而幂等，但重试的第二轮装配会**缺掉那个块**——模型看到的处境与第一次不同 | `conversation.py:1184, 1886-1888` | 与 D-01 一并处理：把标 surfaced 移到"这一周期最终成立"之后，而不是每次 completion 之后 |
| **D-06** | **`edited_message` 触发新回合**：Kevin 编辑一条旧消息会被当成新入站，走完整回合 | `transport.py:415`; `telegram_device.py:509-511` | 区分 `message` 与 `edited_message`；后者要么忽略，要么走独立语义（不是"她又收到一句新话"） |
| **D-07** | **两条对外文本出站绕过 dispatch**：`_deliver_outbox_item` 直接调 `transport.send_message`——零 audit 行、零 `approval.check`、零 E1/E2 章。这是审计闭合面上唯一的洞 | `telegram_device.py:354-388` | 新实现要么把它拉回 dispatch（带独立豁免类别 E3 = "已在上游收过预算的投递线"），要么在设计文档里把这个洞显式写成一条规格并给它自己的 audit 事件 |
| **D-08** | **全文入 events.jsonl**：`chat_request`(app.py:234)、`chat_reply`(app.py:275)、`inner_outer_pair`(conversation.py:755-761) 三处写明文正文，与 `u3_*` 系列刻意维持的"只记长度/哈希"隐私口径**自相矛盾** | `app.py:234, 275`; `conversation.py:755-761` | 统一口径：要么全部降级为长度 + 哈希（如 `diff_summary` 那样），要么把 events.jsonl 明确定为受保护存储并写进规格。**不能一半严一半松** |

---

### 规格表统计

**S- 条目 86 条，D- 条目 8 条，合计 94 条**（工单预计 40–80，实际超出——主要来自 §7 出站链路与 §4 审批消费面的常量密度）。

**档次分布**：【逐字】68 条，【等价】18 条，【缺陷】8 条（D- 前缀）。

**每条独立可验证性**：所有 S- 条目均带 `file:line` 锚点，其中 68 条【逐字】项对应的常量 / 文案已在 §3.2 给出 sha256，可在移植后逐字比对。

**测试覆盖参照**（实测 `grep -c -E "^[[:space:]]*(async )?def test_"`，21 个相关文件共 **390** 个用例）：
`test_p2_s2_approval_interpreter.py` 47、`test_p2_s3_approval_wiring.py` 40、`test_u3_conversation_cycle.py` 36、`test_u3s_switch.py` 31、`test_approval_delivery.py` 28、`test_chatloop.py` 21、`test_telegram_transport.py` 21、`test_conversation_inner.py` 20、`test_u3_policy_exemption.py` 19、`test_u3fix_failure_observability.py` 18、`test_u3fix_json_mode.py` 15、`test_telegram_device.py` 14、`test_u3s_zero_disturbance.py` 14、`test_u3_shadow_zero_disturbance.py` 12、`test_u3fix_zero_disturbance.py` 12、`test_messenger.py` 11、`test_u3s_approval_delivery.py` 8、`test_chat_reply_to.py` 7、`test_u3fix_contract_hardening.py` 7、`test_surface_approvals.py` 5、`test_chatloop_e2e.py` 4。
