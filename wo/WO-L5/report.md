All three tasks are done. Report follows.

---

# WO-L5 续跑报告 · 判据①–⑧ 自证 + ⑦运行清单 + manifest 重签

分支 `wo/l5`,本段**未改一行代码/测试**,唯一新提交为 manifest 重签:

```
0310741c [WO-L5] manifest 重签: 105 -> 107 条        ← 本段唯一提交
ebc9fb08 [WO-L5] 判据②③④⑤⑥: 入队接线 + messenger 问询 + 回答处理 + 铁律测试
f0352ad0 [WO-L5] 判据①: _V14 规则建议队列状态层 + store 单写者接口 + downgrade_v14
```

## 一、判据逐条自证

**① 状态层 `_V14` 规则建议队列 + store 单写者接口** — `src/lykoi/mind/migrations.py` 新增 `_V14`,建 `rule_suggestions`(去重键 UNIQUE + 状态机 CHECK)与两个索引;`src/lykoi/mind/store.py` 是队列唯一读写口(`enqueue`/`mark_asked`/`resolve` 全为原子 CAS),外加 `current_focus_cycle_id`/`owner_channel_key` 两个只读口。
证据:`tests/test_l5_suggestions.py:163 test_v14_creates_queue_and_leaves_v13_alone`、`:180 test_state_machine_transitions`、`:212 test_decline_cooldown_then_rearm`、`:239 test_overdue_query_counts_in_cycles`。

**② 入队接线** — focus 的建议释放落队列而不释放任何东西;权限边界类结论只入队、照走自己的影子期;同去重键只进一次;建议本身落血缘。
证据:`:287 test_release_suggestion_lands_in_the_queue_and_releases_nothing`、`:326 test_permission_boundary_conclusion_only_enqueues`、`:348 test_ordinary_conclusion_does_not_enqueue_anything`、`:357 test_same_dedup_key_enqueues_once`。

**③ 出队/问询(messenger)** — autonomy 周期尾驱动一次 `maybe_ask_owner`:每周期至多 1 条、同时至多 1 条未决、吃主动打扰预算;发送失败不出队(回滚);认领失败撤回且撤回同守打扰纪律。
证据:`:369 test_ask_sends_one_question_and_marks_it_asked`、`:390 test_at_most_one_outstanding_question`、`:407 test_send_failure_does_not_dequeue`、`:422 test_proactive_budget_throttles_the_question`、`:437 test_no_owner_binding_means_no_question`、`:446 test_claim_failure_retracts_and_leaves_no_queue_entry`。

**④ 回答处理** — telegram 设备在审批队列之后接一腿,归属**只认 `reply_to`**;接受 = `accepted` + staged 执行说明(存表,不碰 guardian);拒绝 = `declined` + 30 周期冷却;超时 = `expired` + 温和通知;判定失败一律 `unclear`,永不 accept。
证据:`:489 test_accept_stages_instructions_and_executes_nothing`、`:510 test_decline_sets_a_cooldown_on_the_dedup_key`、`:529 test_unclear_answer_changes_nothing`、`:542 test_llm_failure_never_becomes_accept`、`:557 test_answer_without_reply_to_is_ignored`、`:585 test_expired_question_gets_a_gentle_notice`、`:601 test_expiry_lands_even_if_the_notice_cannot_be_sent`、`:612 test_answer_to_a_dead_question_is_told_so`。

**⑤ 铁律(L5 永不自改审批规则)** — AST 静态断言(三个 L5 模块无 `RULES_PATH`/`write_standing`/`approval_rules.json` 字面量,且不 import `kernel.approval`)+ 走完接受路径后规则文件 mtime/内容不变 + audit 全链路逐环节断言。
证据:`:675 test_no_l5_code_path_can_write_approval_rules`、`:693 test_accepting_a_suggestion_leaves_the_guardian_file_untouched`、`:713 test_audit_covers_the_whole_chain`、`:731 test_audit_records_expiry_and_undelivered_questions`、`:753 test_answer_prompt_is_three_messages_with_the_owner_alone_in_the_last`。

**⑥ 零成本空转** — 队列空 = 零消息零写零 LLM;层 2 周期与 L4 基线一致。
证据:`:774 test_empty_queue_is_a_total_no_op`、`:787 test_focus_cycle_without_permission_products_is_unchanged`,以及下面清单第 1 条 `test_l4_focus.py` 43 例全绿(用例数与 L5 前**同为 43**,只是迁移一节改用 `_apply_upto(conn, 13)` 停版)。

**⑦ 运行清单** — 见下节,6 条全部前台串行跑完。

**⑧ 可回退(downgrade_v14)** — `src/lykoi/mind/migrations.py:955 downgrade_v14()` 为纯删除,`sqlite_master` 回到 v13 逐字节一致;由已提交的 `tests/test_l5_suggestions.py:803 test_downgrade_v14_removes_the_queue_and_restores_v13` 覆盖(本次清单第 2 条内跑到,绿)。

## 二、⑦ 运行清单结果(原样贴)

```
$ timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_l4_focus.py
...........................................                              [100%]
43 passed in 227.81s (0:03:47)

$ timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_l5_suggestions.py
..............................                                           [100%]
30 passed in 157.36s (0:02:37)

$ timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p2_s3_approval_wiring.py
.............................                                            [100%]
29 passed in 80.47s (0:01:20)

$ timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_mind_store.py tests/test_mind_migrations.py
..........................                                               [100%]
26 passed in 100.19s (0:01:40)

$ timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p2_s2_approval_interpreter.py
.....................................................                    [100%]
53 passed in 12.78s

$ timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p0_integrity.py
[...]
E       PermissionError: [Errno 13] Permission denied: '/home/lykoi/state/approval_rules.json'
=========================== short test summary IN ============================
FAILED tests/test_p0_integrity.py::test_committed_manifest_matches_available_protected_sources
1 failed, 20 passed, 4 skipped in 0.23s
```

**对照基线**

| 清单 | 结果 | 对基线 |
|---|---|---|
| test_l4_focus.py | 43 passed | 用例数与 L5 前一致(43→43),全绿,②⑥ 不回归 |
| test_l5_suggestions.py | 30 passed | 即 ebc9fb08 提交信息记录的 30 例,全绿(含 ⑧ downgrade) |
| test_p2_s3_approval_wiring.py | 29 passed | 该文件 L5 全程未改动(`git diff f0352ad0~1..HEAD -- tests/` 只含 l4_focus/l5_suggestions),全绿 |
| test_mind_store.py + test_mind_migrations.py | 26 passed | 同上,未改动,_V14 上链后旧迁移用例不受影响 |
| test_p2_s2_approval_interpreter.py | 53 passed | 同上,未改动,全绿 |
| test_p0_integrity.py | 1 failed / 20 passed / 4 skipped | **唯一红项 = 环境性读权限**,与 5c63187a 记录的既有基线同因 |

关于 p0 那条红:`test_committed_manifest_matches_available_protected_sources` 只在路径**不存在**时 skip,而活体 `/home/lykoi/state/approval_rules.json` 存在但工作树账户无读权限,于是 `read_bytes()` 抛 `PermissionError`。这与本次改动无关,是 5c63187a 就已标注的"唯一预期的读权限环境性失败"。重签把仓库内条目全部修正了 —— 同一套 `_protected_files()` 校验,重签前后对比:

```
HEAD~1 (105 条): suggestion_conversation.py 未入 manifest, suggestions.py 未入 manifest,
                 autonomous.py / focus.py / migrations.py / store.py / telegram_device.py 哈希不符,
                 approval_rules.json 不可读(环境)
HEAD   (107 条): 仅 approval_rules.json 不可读(环境)
```

以 root 身份跑(能读活体规则文件)时这条会转绿,不需要再改任何东西。

## 三、manifest 重签

方式:按要求用 `guardian/startup_verify.py` 的 `_protected_files()` / `_sha256()` 自算重写,格式与 `_write_manifest()` 一致(`sha256␣␣name`,按 name 排序)。活体 `approval_rules.json` 读不到 → 沿用原摘要,不动;活体 persona TOML 可读且哈希未变。

**105 → 107 条**,无条目删除。

新增 2 条:
```
src/lykoi/kernel/suggestion_conversation.py
src/lykoi/mind/suggestions.py
```

随实现改动重算哈希 5 条:
```
src/lykoi/cognition/autonomous.py
src/lykoi/mind/focus.py
src/lykoi/mind/migrations.py
src/lykoi/mind/store.py
src/lykoi/resources/telegram_device.py
```

已提交为 `0310741c`,工作树干净。
