# PROBE-RECALL-01 · 话题回忆探针（E5）

- 状态：**待派**。执行方：执行子 Agent 写脚本与评分表；**Kevin 在服务器以 lykoi 跑**（同 PROBE-CAP-01 之法）；执行方填分析。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B/R-C（Topic/Thread 移出阶段一，待探针读数；探针先行）；memo 评估稿第 228 行。
- 基线：`main@c557af2`。分支：`wo/probe-recall-01`（只放脚本、评分表、report）。**零代码改动**。
- 参考形态：`governance/wo/PROBE-CAP-01/probe-cap.sh`（bash + 内嵌 python3，`set -a; . /home/lykoi/secrets/llm.env`，每形态每档 2 次，只打印前 160 字，不打印 persona 正文）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 不碰产线 `memory.db`。真实对话数据**不进探针**；探针用执行方写的合成对话（中文、日常、SFW）。产线只跑一条只读计数 SQL（Part A），由 Kevin 执行。
- 产线模型 deepseek-v4-flash，档位 low（产线现状）。

## 1 · 事实（对话装配现状）

| 项 | 位置 | 事实 |
|---|---|---|
| 窗口 | `packages/lykoi-converse/src/conversation.ts:81`（`CONTEXT_WINDOW_TURNS` 缺省 8）、`:437-441`（`#limit()`：`windowTurns / backfillRows / maxInputTokens`） | 近 8 轮逐字进上下文 |
| 回灌 | `:524-549`（`#buildBackfill`：`getRecentHistoryOfType('conversation', backfillRows)`，每侧 `BACKFILL_CLIP_CHARS` 截断，渲染为 `[ts] Kevin: …\n我: …`）、**`:401` 只在构造时算一次**、块 `BLOCK_BACKFILL` `:606-607` | 进程存活期间回灌不更新 |
| 摘要 | `SUMMARIZE_SYSTEM_PROMPT`（`prompts.ts:90-93`）、`#summaryLock` `:379`、块 `BLOCK_SUMMARY` | 旧轮被裁掉时压缩成摘要块 |
| 记忆检索 | `:1464`（`#relevantMemories` 每次 send 按用户文本算）、块 `BLOCK_MEMORIES`；memo 第 160 行："Memory 检索（确定性三轴打分）" | 靠 insights 表命中 |
| 裁剪 | `:886-905`（`#enforceBudget`：先裁最老整轮，再丢回灌，再抛 `ContextBudgetError`） | |
| 块顺序 | `:771-777`（`#assemble`）、`:780-787`（`assembleLayout`） | persona → 稳定前缀块 → 历史 → 易变尾块 |

## 2 · Part A · 产线只读计数（Kevin 跑，root 或 lykoi）

脚本 `recall-stats.sql`（执行方写；只 SELECT）：`history` 表 `type='conversation'` 的总行数、按日计数近 30 天、每行 user/reply 字符数的中位与 p90、相邻两行间隔的中位（分钟）。输出只有数字。用途：知道真实"话题深度"分布（一天几轮、多久回一次）。

## 3 · Part B · 合成回忆探针（Kevin 以 lykoi 跑）

`probe-recall.sh`：执行方写 6 段合成对话脚本（每段 40 轮 user/assistant 交替，中文日常），每段在第 d 轮埋一个可核话题（一个具体名词 + 一个具体数字，如"周三去 XX 修车，报价 480"），d ∈ {3, 8, 15, 30}（回看深度）。第 41 轮 user 问一句需要该话题的问题（"上次修车那家报价多少来着"）。

三种装配，各对同一段对话跑：

| 装配 | 上下文 | 模拟的现状/候选 |
|---|---|---|
| W8 | persona + 近 8 轮逐字 | 现状（窗口内命中 = d ≤ 8） |
| W8+S | persona + 用 `SUMMARIZE_SYSTEM_PROMPT` 让同一模型先把第 1..(40-8) 轮压成摘要 + 近 8 轮 | 现状的摘要块路径 |
| W8+M | persona + 一条与话题匹配的 insight 行（执行方按 `insights` 表形态手写）+ 近 8 轮 | 记忆检索命中时 |

每组合 2 次，档位 low。打印：time_total / content_len / 是否命中（content 含埋的名词 **且** 数字）/ 首 160 字。

## 4 · 评分表（rubric.md）

- 命中 = 名词与数字都对；半命中 = 只对一个；错报 = 给出一个不同的数字（比"不记得"更坏，单列）。
- 报表：装配 × d → 命中率、错报率。
- 五条结论（各一句）：W8 在 d>8 的表现；摘要是否保住数字；记忆命中时是否被采用；错报率；是否需要 Topic/Thread（读数支持的话）。

## 5 · 用途

读数进 `governance/docs/whitepaper_v1.3_candidates_2026-09-04.md` Topic/Thread 条目的"是否立项"裁定；若 W8+S 保数字率 ≥ 80% 且错报率 ≤ 10%，Topic/Thread 不立项，改为修"回灌只算一次"（`conversation.ts:401`）这类小单。

## 6 · 报告要求

按 PROBE-CAP-01 report 形态：§0 合法性、§1 Part A 数字、§2 Part B 表、§3 结论、§4 建议。Kevin 回填读数前，report 只写脚本用法与评分表。
