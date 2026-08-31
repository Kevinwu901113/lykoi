# WO-OBS-LLM 收尾报告

## 1. 取舍说明

- **`log_event("llm_call")` 从请求前挪到成功响应后**（`src/lykoi/cognition/llm_client.py`）：原先在发请求前打点，现在改为在拿到 200 响应、解析出 `usage` 之后才打点。
- **失败路径不丢观测**：请求失败（重试耗尽 / `raise_for_status` 抛错）时走既有的 `llm_error` 事件路径，所以"移动打点位置"不会造成"调用不可见"——只是把"调用发生了"这个信号，拆成了"失败(`llm_error`)"和"成功(`llm_call`)"两条互斥事件。
- **语义变化**：`llm_call` 从"发起了一次调用"变成"成功完成的一次调用"。任何下游基于 `llm_call` 计数做流量统计的代码，含义要相应改为"成功调用数"而非"尝试调用数"。

## 2. 四数字段与缺省行为

新增字段：`prompt_tokens` / `completion_tokens` / `cache_hit_tokens` / `cache_miss_tokens`，来自响应体 `usage.{prompt_tokens, completion_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens}`；`usage` 整体缺失时用 `{}` 兜底，逐字段 `.get()` 缺省 `None`，不抛异常。

被以下 3 个新增测试（`tests/test_p0_llm_client.py`）钉住：

| 测试 | 钉住的行为 |
|---|---|
| `test_llm_call_event_records_usage_fields` | `usage` 四字段齐全时，`llm_call` 事件的四个字段与 `route`/`model`/`message_count` 一起被正确记录并原样传出 |
| `test_llm_call_event_tolerates_missing_usage` | 响应体完全没有 `usage` 键时，四字段均为 `None`，且不抛异常、`chat_completion` 仍正常返回 message |
| `test_llm_call_event_tolerates_partial_usage` | `usage` 只有 `prompt_tokens` 一项时，该项如实记录，其余三项各自独立缺省为 `None`（不是整体归零/整体报错） |

## 3. 清单逐文件 pytest 结果（前台串行，无一使用后台/sleep 等待）

| 文件 | 结果 |
|---|---|
| `tests/test_core_v1_m3_r2c_s7_shadow_wiring.py` | 6 passed |
| `tests/test_p0_llm_client.py` | 23 passed |
| `tests/test_core_v1_m3_r2b_execution_activation.py` | 1 failed, 17 passed — 失败为 `test_controller_is_executable_sealed_and_syntactically_valid`：`scripts/patches/core-v1-m3-r2b-execution-activation/root_apply.sh` 权限 0o775 ≠ 期望 0o755，与 llm_client.py 改动无关，属本次 checkout 的环境文件权限差异 |
| `tests/test_deepseek_v4_compat_rollout.py` | 1 failed, 8 passed — 同上根因（`scripts/patches/deepseek-v4-compat/root_apply.sh` 同样 0o775 vs 0o755） |
| `tests/test_l4_focus.py` | 43 passed（251.77s） |
| `tests/test_concern_floor.py` | 28 passed（76.54s） |

**`tests/test_p0_integrity.py`（重签后基线核验）**：20 passed, 4 skipped, **1 failed**——`test_committed_manifest_matches_available_protected_sources` 因 `PermissionError: /home/lykoi/state/approval_rules.json` 而失败，即工单预告的"唯一允许的 approval_rules.json 读权限环境性失败"，其余全部通过。回到基线状态确认。

（两个 `root_apply.sh` 权限失败与本次改动无关，未在工单预告范围内，如实呈报，未做处理。）

## 4. manifest diff

- 条数：105 → 105（`_protected_files()` 全集不变，只是同一路径下内容变了）
- 变化的唯一一条：

```
- 61927c1c35cadde6de53da2731a3e4556f312cd955eef04e25e2f637868d2419  src/lykoi/cognition/llm_client.py
+ 6570f0db2a10e54bbda2550e73a9e4330a807ada0cf469987bc39063d01b74ed  src/lykoi/cognition/llm_client.py
```

（因 `--write-manifest` 整体重写会在读取 `/home/lykoi/state/approval_rules.json` 时因权限被拒而中止，故用 `_protected_files()`/`_sha256()` 只重算并替换这一条，其余 104 条哈希与旧 manifest 逐一比对确认无变化后原样保留。）

---

**已提交** `5c63187a [WO-OBS-LLM] manifest 重签: llm_client.py usage 四数改动同步哈希 (105 -> 105)`，其余无代码改动。三件事全部完成。
