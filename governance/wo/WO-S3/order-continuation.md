# WO-S3 续跑单 · 只补测试/重签/提交，实现已完成——不要重做

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work`（分支 `wo/s3`）继续 WO-S3。
上一段会话因 pytest 权限被卡而中断（已修：`timeout` 已入白名单）。

## 已完成的（在提交 `9aba485b` 里，⚠️ 一行都不要重构、不要重写）

| 文件 | 已有改动 |
|---|---|
| `kernel/approval_conversation.py` | **新增**——问答两腿：`request_approval` / `handle_owner_answer` / `_execute_once` / 审计事件 |
| `kernel/approval.py` | `_scope_key` → 公开 `resolve_scope_key`；`enqueue_pending(question_message_id=, question_text=)`；新增 `find_pending_by_question` / `pending_state` / `set_question_message_id` / `resolve_pending` / `find_live_pending`；`pending_actions()` 过滤 `resolved` |
| `kernel/approval_interpreter.py` | prompt 拆三条 message（`build_interpret_messages`）+ system 铁律 #5；公开 `audit_event`；改用 `resolve_scope_key` |
| `resources/telegram_device.py` | `_send_reply` 的 `needs_approval` 升级为 `request_approval`；`_handle_message` 先走 `handle_owner_answer`；新增 `_is_owner` |
| `resources/telegram_transport.py` | 归一 `reply_to_message_id`（可选键） |

原子性方案已定并写在代码注释里（dedupe → send → enqueue；send 败 = deny-by-default
不入队；enqueue 败 = 撤回消息 + deny-by-default）。无递归是结构性的
（`_send` 把 `needs_approval` 当投递失败返回）。**无新状态文件，conftest 不需要动。**

## 你要做的（只有这些）

1. **先复查再续**：读一遍上表五个文件的当前状态（确认 WIP 提交完整落盘），
   然后立刻 `git commit --amend` 或新提交，把 WIP 换成正式里程碑消息
   `[WO-S3] conversational approval wiring: ask/answer legs + hardening`。
2. **写 `tests/test_p2_s3_approval_wiring.py`**，覆盖原单 9 条 success_criteria
   （原单在 git 历史与下方附录；mock transport 照 telegram 既有测试模式）：
   端到端 approve 恰好一次 / deny 记录+确认+未执行 / clarify 链回同一 pending /
   过期回"要我重新问吗" / 非所有者零作数 / 无递归（send 计数）/ 发送失败终态 /
   prompt 结构断言 / scope 重构行为不变。写完立刻 commit。
3. **跑测试**（`timeout 300 .venv/bin/pytest ...` 现在可用；若仍被拒就去掉
   timeout 前缀直接 `.venv/bin/pytest`）：新文件 + `tests/test_messenger.py` +
   `tests/test_telegram_device.py` + `tests/test_telegram_transport.py` +
   `tests/test_p2_s2_approval_interpreter.py` + `tests/test_p0_integrity.py`。
   失败就修（只许修 bug 与测试，不许推翻设计决策），修完再 commit。
4. **重签 manifest**：照既有做法自算（`--write-manifest` 在 claude 身份会崩），
   预期 103 → 104（新增 `approval_conversation.py`），报告给出 diff。commit。
5. **报告**：stdout 即报告本体，宁长勿略。必含：每条 success_criteria 的用例名+结果、
   审计事件清单、既有套件通过数、p0 通过数（1 个既有假失败如实报）、manifest diff、
   硬数字（文件数/行数/测试数）。

## 纪律（不变）

不 push；不跑全量 pytest；不改 `/chat` 行为；不动 policy_core；不放宽审批语义；
每个里程碑立刻 commit。
