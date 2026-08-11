# LLM 缓存观测与前缀重组计划 · 2026-08-11

来源：Kevin 侧只读勘察（2026-08-11，L4 执行期间）+ 治理窗口核实与补充。
白皮书立场：**缓存零约束**（通篇未提），守住的是 8 章人格分层可区分性与 26.2
最小上下文/可见性；usage 观测本身是 26.2 的正向推进（治理活，不只是性能活）。

## 已核实的事实（活体只读，2026-08-11）

1. `cognition/llm_client.py:117`：`log_event("llm_call")` 只记 route/model/
   message_count；**API 返回的 usage（含 DeepSeek `prompt_cache_hit_tokens` /
   `prompt_cache_miss_tokens`）整块丢弃——命中率零观测**。
2. `cognition/conversation.py` `_assemble` 顺序：人格头（内核 TOML + 纪律 +
   acquired）→ 自我叙事 → 回灌块 → 对话摘要 → **[念头]（每轮变）→ [当前时间]
   （分钟粒度，每轮必变）→ self-state** → 对话历史。易变块卡在历史之前，
   前缀缓存从时间块起全 miss——历史恰是最大且增长的部分。`:588` 注释
   "放在补充块末尾, 最大化前缀缓存"意图对、方向反。
3. `decide.py` 自主唤醒路径天然正确（稳定前缀 + 易变 snapshot 垫底）——
   **天然对照组**。小不一致：acquired 层排序两路径不同（decide 在
   DECIDE_SYSTEM_PROMPT 前、会话在后）。

## 行动序列（定案）

| 序 | 单 | 内容 | 时机 |
|---|---|---|---|
| 1 | **WO-OBS-LLM** | `llm_client` 记 usage 四数（prompt/completion/cache_hit/cache_miss）入 `llm_call` 事件，按既有 `route` 字段分路径；纯附加零行为 | **L4 收官过审后当天**（cognition/ 在六目录锁内，不与 L4 并行——教训 26） |
| 2 | 基线积累 | 一天样本足够（她的调用量：几分钟一醒 + nightly + 对话）；decide vs conversation 的命中率差值 = 反转的预期收益 | L5 执行期间自然积累 |
| 3 | **WO-CACHE-INVERT** | 易变块（时间/念头/self-state）移到历史之后、生成点之前；**内容集合不变只动顺序**（26.2 自动无损）；尾部块的角色/措辞先查 DeepSeek 对尾部 system 的实际处理再定；顺手对齐 decide 路径 acquired 排序；8.6 精神的小规模对话回归（尾部强调效应：时间/念头敏感度会升，验语气不漂） | L5 之后 |
| 4 | 验证 | 反转后 conversation 与 decide 的命中率差值应收敛；首 token 延迟下降 | 改后一天 |
| 5 | **人格设计备忘录** | Insight 运行时写入链补全（30.3 洞 #1）+ acquired 层刷新时机 + 8 章版本化 [PLANNED]。治理窗口倾向：**整合边界刷新**——每晚 nightly 后重建 system 头，计划内全量 miss 一次/天，同时解人格新鲜度、缓存重建节律、**L4 insights 的下游出口**三件事 | L5 之后、与 3 并行讨论 |

## 硬边界

- 不为缓存牺牲人格分层可区分性（8 章）与发送内容可见性（26.2）
- usage 只是整数无内容，入 events.jsonl 无隐私问题
- 所有改动走标准工单流程（全邻接必跑清单、串行全量复核、manifest 重签）
