# WO-FIX-THINKPOLICY-01 · 推理策略回到一处（adapter 显式档位），先量后定

- 状态：**待放行**（探针 v5 先行，代码后行）
- 立单：2026-09-04 01:30 CST，主治理 Agent
- 分析：governance/docs/tool_step_structural_analysis_2026-09-04.md §3
- 包：profile/cordis.prod.yml、lykoi-converse（conversation.ts 一行删除 + 事件字段）、探针脚本

## 1 · 根因

思考档位由两处决定：profile 未配置 → vendor 隐式 HIGH；converse `#completion` per-step 覆盖（J：step ≥ 1 off）。J 是原生工具帧 400 的绕行，根因已由 TOOLFRAME-01 消除。step 0 时延 85/10/69 s 无 token 读数，无法归因。

## 2 · 决定

- D-0 观测先行（converse）：`u3_cycle_envelope` 与 `u3_cycle_failed` 补 `prompt_tokens / completion_tokens / reasoning_len`（来自 `LlmResult.usage` 与 `reasoningLength`，已存在，不加 wire 字段）。
- D-1 探针 v5（Kevin root 跑，治理侧备稿）：取一份与产线 step 0 同形态的请求（persona 前缀 + 契约 + 一条短 user），thinking enabled × reasoning_effort ∈ {high, low} 与 thinking disabled，各两次；记 time_total、reasoning_content 长度、content 是否合法信封。另取 step ≥ 1 形态（文本帧工具步后）× {low, off} 各两次。
- D-2 profile `llm-deepseek` 显式 `config: { thinking: enabled, reasoningEffort: <v5 定> }`，隐式 HIGH 消失。
- D-3 converse 删 `...(step >= 1 ? { reasoningEffort: 'off' } : {})`，`#completion` 不再传 reasoningEffort；推理策略只有 adapter 一处。
- D-4 取值规则（v5 前预设，v5 后按数改）：若 low 在 step 0 时延 ≤ 15 s 且 step ≥ 1 ≤ 5 s 且信封合法率 100% → low；否则 off，并在 HANDOFF 记「思考对信封质量的收益未证」。不选 high。
- D-5 测试：wire 用例断言 step ≥ 1 请求不再带 reasoningEffort；事件字段用例。

## 3 · 边界

- 不做 per-step、per-purpose 档位；不加环境旋钮（GK-6 钉面纪律）；profile 变化是装配变化，落地稿 §3 的「零装配」断言本单要改口。
- 若 v5 显示时延主因是前缀缓存未命中而非思考，则 D-2/D-3 照做（一处真相仍成立），时延另立单查装配器。

## 4 · 验收

- 落地后连续 10 条 Telegram：step 0 时延分布、reasoning_len 分布、信封首跳合法率；对照 M 后基线（85/10/69 s）。
