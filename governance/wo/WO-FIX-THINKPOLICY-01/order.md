# WO-FIX-THINKPOLICY-01 · 推理策略回到一处（adapter 显式档位），先量后定

- 状态：**执行中**（Kevin 2026-09-04 01:40 放行，三单并行；opus 于 wt-fix-thinkpolicy-01 / wo/fix-thinkpolicy-01 执行，基线 main@4aec35f）
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

## 5 · 探针 v5 结果（2026-09-04 02:05 CST，Kevin root 跑，14/14 信封合法）

| 形态 | high | low | off |
|---|---|---|---|
| S0 真 persona 871 tok 首跑/次跑 | 8.1 / 3.3 s（reasoning 1677 / 729） | 9.3 / 1.4 s（5114 / 530） | 0.9 / 0.8 s |
| S0P 长前缀 14.5k tok 首跑/次跑 | 20.7 / 2.3 s（4919 / 192；cache_hit 0 → 14464） | 11.8 / 5.9 s（1914 / 1244） | — |
| S1 文本帧工具步后 | — | 1.6 / 1.1 s（reasoning ≈ 30） | 1.1 / 1.1 s |

读解：①前缀缓存命中与否是最大单项（5–18 s）；②high/low 的 reasoning 长度噪声大、不单调（S0 首跑 low 5114 > high 1677）；③生成约 105 tok/s，产线 85 s ≈ 9k 输出 token，探针任何档位未复现，产线 step 0 长输出来自完整契约 + 思考，须 D-0 落地后读真数；④off 在 S0 两次中一次选 reply「没法查」而非工具，step 0 不取 off。

**D-4 定档：low**（step 0 ≤ 15 s、step ≥ 1 ≤ 5 s、合法率 100% 三条均过）。D-0 追加：事件同时记 `cache_hit_tokens`（DeepSeek usage `prompt_cache_hit_tokens`，adapter 若不透传则记 null 并在报告说明）。前缀缓存失效率作为落地后读数之一。
