Tree clean, 4 commits, all suites run. Report follows.

---

# WO-S3 收尾报告

## 0. 落盘确认

分支 `wo/s3`，工作树干净，`01a8099c..HEAD` 共 4 个提交，WIP 已转正：

```
ad01041a [WO-S3] manifest re-sign (98 -> 104)          ← 本次由 WIP a91ab0a4 amend
61a5ec3f [WO-S3] tests: fix pending-ledger shape ...
bb5620f4 [WO-S3] tests: conversational approval wiring, all 9 success criteria
de7982dd [WO-S3] conversational approval wiring: ask/answer legs + hardening
```

未 push，未跑全量 pytest，未改 `/chat`、policy_core、审批语义。上述三个已有提交一行未动。

## 1. Manifest 复核 —— 与原单数字不符，已按实际签

**原单说 `103 -> 104`；实际是 `98 -> 104`。** `git show 01a8099c:guardian/manifest.sha256 | wc -l` = **98**，当前 = **104**。diff 是 **+9/−3**：3 行是重算哈希（旧行被替换），6 行是全新路径，净 +6。103 这个数无论按旧值还是按 +1 净增都对不上。我按实测值写了提交信息 `(98 -> 104)`，并在 body 里列清了 6+3 的构成——manifest 提交里挂一个错的条目数，正是复核方会绊住的地方。

**新增条目（6）**
| 路径 | 是否 WO-S3 触及 |
|---|---|
| `src/lykoi/kernel/approval_conversation.py` | ✅ 新文件 |
| `src/lykoi/kernel/approval_interpreter.py` | ✅ 被改，但**原先根本没有条目** |
| `src/lykoi/resources/telegram_device.py` | ✅ 被改，原先无条目 |
| `src/lykoi/resources/telegram_transport.py` | ✅ 被改，原先无条目 |
| `src/lykoi/kernel/scope.py` | ❌ 既有覆盖缺口 |
| `src/lykoi/resources/messenger.py` | ❌ 既有覆盖缺口 |

**重算哈希（3）**：`kernel/approval.py`（WO-S3 改动）、`kernel/dispatch.py`、`mind/store.py`（后两个是早先合并遗留的哈希漂移，非本单改动）。

也就是说这次重签顺手补了 4 处**既有**问题（scope/messenger 未覆盖、dispatch/store 哈希过期）。如实标注，不算在 WO-S3 账上。

**自算校验**（独立重算，非复用签名脚本）：逐条 `sha256` 比对当前工作树 —— **ok=98，mismatch=0，absent=6**。6 个 absent 是本 clone 不存在或沙箱不可读的 guardian 安装态路径：`/home/lykoi/state/approval_rules.json`(权限拒绝)、`audit_sink.py`、`path_guard.py`、`policy_core.py`、`startup_verify.py`、`watchdog.py`。`/home/lykoi/runtime/persona/lykoi_base.toml` 可读且**校验通过**。结论：manifest 无问题，直接转正，未做修补。

## 2. 测试结果（硬数字）

`timeout 300 .venv/bin/pytest` 未被拒，全程带 timeout 运行。

| 套件 | 结果 | 耗时 |
|---|---|---|
| `test_p2_s3_approval_wiring.py` | **29 passed** | 109.63s |
| `test_messenger.py` + `test_telegram_device.py` + `test_telegram_transport.py` | **35 passed**（合并跑） | 55.33s |
| `test_p2_s2_approval_interpreter.py` | **53 passed** | 21.76s |
| `test_p0_integrity.py` | **20 passed, 4 skipped, 1 failed（既有假失败）** | 0.26s |
| **六套件合并复跑** | **137 passed, 4 skipped, 1 failed** | 187.48s |

**唯一失败 = 原单预告的 claude 身份既有假失败，如实报告：**
`test_p0_integrity.py::test_committed_manifest_matches_available_protected_sources`
→ `PermissionError: [Errno 13] Permission denied: '/home/lykoi/state/approval_rules.json'`（`tests/test_p0_integrity.py:122`）

是**环境权限错误，不是断言不符**——`claude` 用户读不到 `/home/lykoi/state/`。我在动任何代码之前跑自己的校验脚本时就先撞上了同一个 `PermissionError`，与本单改动无关。未修（修它需要放宽沙箱或改测试跳过条件，两者都超出本单范围）。

无需修 bug —— 一次跑通，没有 commit 追加。

## 3. 九条 success_criteria 逐条对照

测试文件用 `# === criterion N: ... ===` 分段，29 个用例全部落位：

**准则 1 — 端到端 approve，恰好执行一次**（2 passed）
- `test_approve_end_to_end_asks_then_executes_the_action_exactly_once` ✅
- `test_a_repeated_yes_does_not_execute_the_action_a_second_time` ✅

**准则 2 — deny：记录 + 确认 + 未执行**（3 passed）
- `test_deny_records_the_refusal_confirms_it_and_never_executes` ✅
- `test_denied_pending_row_is_kept_as_resolved_not_deleted` ✅
- `test_denial_starts_a_quiet_period_so_she_stops_asking_about_that_scope` ✅

**准则 3 — clarify 链回同一个 pending**（2 passed）
- `test_clarify_sends_a_follow_up_and_repoints_the_same_pending_at_it` ✅
- `test_answering_the_clarification_executes_the_original_action` ✅

**准则 4 — 过期回「那条已经过期了」**（2 passed）
- `test_answering_an_expired_question_says_so_instead_of_silently_dropping_it` ✅
- `test_an_expired_question_is_detectable_although_pending_actions_hides_it` ✅

**准则 5 — 非所有者零作数**（3 passed）
- `test_a_bound_non_owner_cannot_answer_an_approval_question` ✅
- `test_the_owners_identical_message_does_reach_the_answer_leg` ✅（对照组）
- `test_is_owner_is_narrower_than_is_bound` ✅

**准则 6 — 无递归**（3 passed）
- `test_a_question_that_itself_needs_approval_is_not_asked_about` ✅
- `test_device_reply_needing_approval_asks_once_and_does_not_recurse` ✅
- `test_the_asking_path_records_undelivered_questions_rather_than_retrying` ✅ ⚠️

**准则 7 — 发送失败 = 终态；enqueue 失败 = 撤回**（4 passed）
- `test_a_send_failure_refuses_the_action_and_queues_nothing` ✅
- `test_a_throttled_question_is_also_a_terminal_refusal` ✅
- `test_an_enqueue_failure_retracts_the_question_and_refuses_the_action` ✅
- `test_an_identical_outstanding_question_is_not_asked_twice` ✅

**准则 8 — prompt 结构（数据/指令边界）**（3 passed）
- `test_the_interpret_prompt_is_three_messages_with_data_and_answer_separated` ✅
- `test_the_system_prompt_names_the_data_instruction_boundary` ✅
- `test_a_real_interpretation_sends_exactly_that_structure` ✅

**准则 9 — scope 重构行为不变**（4 passed）
- `test_resolve_scope_key_is_exactly_the_old_private_helper` ✅
- `test_resolve_scope_key_stays_fail_soft_on_a_broken_scope_module` ✅
- `test_the_private_alias_is_gone_and_callers_moved_over` ✅
- `test_scope_dependent_behavior_is_unchanged_end_to_end` ✅

**审计面（跨准则，3 passed）**
- `test_every_leg_of_one_approved_turn_is_audited` ✅
- `test_a_non_answer_from_the_owner_is_left_alone_as_conversation` ✅
- `test_transport_normalization_carries_reply_to_only_when_present` ✅

合计 2+3+2+2+3+3+4+3+4+3 = **29** ✅

⚠️ **一处归档瑕疵（不影响通过，未改）**：`test_the_asking_path_records_undelivered_questions_rather_than_retrying`（`tests/test_p2_s3_approval_wiring.py:542`）物理上落在准则 6 段内（准则 7 的分段注释在 `:555`），但它断言的是 `status == "send_failed"` / `outcome == "deny_by_default"`，语义属准则 7。只是段注释位置问题，挪一行注释即可——按「不重构」纪律留给复核方定夺。

## 4. 审计事件清单（事件名 + 字段）

三个事件名常量定义在 `src/lykoi/kernel/approval_conversation.py:77-79`，全部经 `interpreter.audit_event()` 落同一不可变 sink。该函数（`src/lykoi/kernel/approval_interpreter.py:576-593`）自动注入 `event` 与 `ts`，`OSError` 时返回 `False` 并记 `approval_audit_unavailable`，**不吞异常成静默成功**。

### `approval_question`（问的一腿，4 个 stage）
| stage | 行 | 字段 |
|---|---|---|
| `suppressed` | `:159` | `action_type`, `scope_key`, `outcome="quiet_period"`, `delivered=False` |
| `undelivered` | `:178` | `action_type`, `scope_key`, `question_text`, `outcome="deny_by_default"`, `delivered=False`, `reason` |
| `retracted` | `:210` | `action_type`, `scope_key`, `question_text`, `outcome="deny_by_default"`, `delivered=True`, `reason` |
| `asked` | `:227` | `action_type`, `scope_key`, `question_text`, `question_message_id`, `pending_id`, `outcome="asked"`, `delivered=True` |

### `approval_answer_routed`（答的一腿，2 个发射点）
| 场景 | 行 | 字段 |
|---|---|---|
| 过期回复 | `:322` | `outcome="expired"`, `answer_text`, `action_type`, `scope_key`, `pending_id`, `state`, `executed=False`, `replied` |
| 正常路由 | `:376` | `outcome`(`clarify`/`granted`/`execute_once`/`denied`), `answer_text`, `action_type`, `scope_key`, `risk_level`, `pending_id`, `executed`, `replied`, `standing_grant_created` |

### `approval_execution`（执行腿，2 个发射点）
| 场景 | 行 | 字段 |
|---|---|---|
| 未执行（claim 失败） | `:261` | `action_type`, `pending_id`, `executed=False`, `reason`(=`consumed`/`expired`/`mismatch`/`missing`) |
| 已执行 | `:278` | `action_type`, `pending_id`, `correlation_id`, `executed=True`, `success`, `error` |

### 六元组
`interpreter.audit_interaction()`（`approval_interpreter.py:596`）—— `question_text`, `answer_text`, `interpretation`, `risk_level`, `scope_key`, `standing_grant_created`，同一 sink。

一个完整 approve 回合共留 **4 条记录**（question/asked → 六元组 → answer_routed → execution），由 `test_every_leg_of_one_approved_turn_is_audited` 钉住。

配套结构化日志（非审计）：`approval_question_suppressed`、`approval_question_sent`、`approval_enqueue_failed`、`approval_execution_skipped`、`approval_answer_expired`、`approval_answer_routed`、`approval_audit_unavailable`。

## 5. 原子性方案落地位置

**设计原样保留，未推翻。** 两处，分属不同失败方向：

### (a) send → enqueue 顺序 + 撤回补偿
- **决策记录**：`src/lykoi/kernel/approval_conversation.py:43-60`（模块 docstring，写明为何选「先发后入队」：*enqueued but never sent* 是队列里躺着一个没人被问过的问题，不可检测；*sent but never enqueued* 在 enqueue 抛异常的那一刻**精确可检测**，因而可补偿）
- **发送**：`:176` → 失败即 `:177-194` 终态拒绝（deny-by-default，**队列不写任何东西**）
- **入队**：`:196-206`
- **补偿撤回**：`:207-225` —— `except` 捕获后先 `_send(RETRACT_TEMPLATE)` 把话收回，再审计 `stage="retracted"`，返回 `enqueue_failed`。撤回本身再失败也已审计，且**不留队列残留**。

### (b) 执行恰好一次 —— 真正的原子点
- **`src/lykoi/kernel/approval.py:679-705`** `consume_pending()`：整个「检查 + 盖戳」在 `with file_lock(PENDING_PATH)` 内完成（`:690`），依次判 `consumed_at`(`:695`) / `_expired`(`:697`) / `params_hash` 不符(`:699`)，通过才写 `consumed_at`+`actor`(`:701-702`) 并落盘。两个并发 approve 无法都拿到 `"ok"`。
- **调用方**：`approval_conversation.py:249-258`（`_execute_once` 的 docstring 明确「`consume_pending` 才是原子点，不是本函数」）→ `:258` 取 claim，`:269` 才 dispatch。
- **记录保留**：消费后**不删行**，只盖 consumed 戳 —— 否则重复的「可以」就无从识别为在答一件已了结的事（`:254-257`）。

## 6. 硬数字汇总

| 项 | 数值 |
|---|---|
| 实现改动文件数 | 5（`de7982dd`） |
| 实现改动行数 | **+669 / −32** |
| 新模块 `approval_conversation.py` | 411 行 |
| 测试文件 `test_p2_s3_approval_wiring.py` | 802 行（796 新增 + `61a5ec3f` 的 +12/−6） |
| manifest 改动 | +9 / −3 行；条目 **98 → 104**（新增 6 / 重算 3） |
| manifest 自算校验 | ok=98，mismatch=**0**，absent=6（沙箱外路径） |
| S3 wiring 套件 | **29 passed** |
| messenger + telegram_device + telegram_transport | **35 passed** |
| S2 interpreter 套件 | **53 passed** |
| p0 integrity | **20 passed / 4 skipped / 1 failed（既有环境假失败）** |
| 六套件合并 | **137 passed / 4 skipped / 1 failed**，187.48s |
| 本次新增 commit | 1（WIP 转正，无修复 commit） |

## 需要复核方定夺的两点

1. **原单 `103 -> 104` 与实测 `98 -> 104` 不符** —— 我按实测签了。若 103 有我不知道的来源（比如别的分支上的 manifest 状态），请指出，我改提交信息。
2. **本次重签顺带补了 4 处既有缺口**（`scope.py`/`messenger.py` 未覆盖，`dispatch.py`/`mind/store.py` 哈希漂移）。这是让 manifest 自洽的必要动作，但严格说超出 WO-S3 范围，已在提交 body 里标明来源，便于拆账。
