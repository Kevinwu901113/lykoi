# WO-OBS-LLM · llm_call 事件补记 usage 四数（纯附加，零行为）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/obs-llm`，基于活体 main
最新提交，worktree 与 `.venv` 已备好）实现。
背景与全景：`~/llm_cache_observability_plan_2026-08-11.md`（本单是其中第 1 步）。

## 报告纪律

stdout 即报告本体；禁止摘要；不许等待步骤；测试 `timeout 600` 包裹；里程碑即 commit；
只跑文末清单不跑全量。

## goal（就一件事）

`src/lykoi/cognition/llm_client.py`：模型 API 响应中的 `usage` 目前整块丢弃。
把它记进**既有的** `log_event("llm_call", ...)` 事件（`:117` 附近——先读代码确认
响应解析处，可能需要把 log_event 挪到拿到响应之后或补第二个事件，你读完代码定，
报告说明取舍）：

- 新增字段：`prompt_tokens`、`completion_tokens`、`cache_hit_tokens`、
  `cache_miss_tokens`（DeepSeek 响应里是 `prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens`；字段缺失时记 `null`/省略，**不得因缺字段抛错**——
  别的模型/route 未必带）。
- 保留既有字段（route/model/message_count）——按 `route` 分路径看基线是本单目的。
- **零行为**：不改重试逻辑、不改返回值、不改任何调用方；失败路径不因记录而变。

## forbidden

不改 prompt 组装（那是 WO-CACHE-INVERT）；不动 conversation/decide/integrator；
不新增依赖；不 push；提交留在 `wo/obs-llm`。

## manifest

`cognition/` 在 manifest 覆盖内 → 照既有做法自算重签（当前 105 条口径以分支实际为准），
报告给出 diff。跑 `pytest tests/test_p0_integrity.py` 报数。

## success_criteria（mock 响应）

1. 带 usage 的响应 → 事件含四数且值正确；不带 usage / 缺单个字段 → 事件照发不炸。
2. API 错误路径行为与改前逐字节一致（既有重试测试全过）。
3. 零行为证明：llm_client 既有测试全过；conversation/decide 的既有测试全过。

## 必跑清单

```
tests/ 下所有 grep -l "llm_client\|llm_call" 命中的测试文件（先列出清单再跑）
tests/test_p0_integrity.py
```
