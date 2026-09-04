# PROBE-CAP-01 · 产线模型能力基线探针（目标 → 组合 → 委托 → 验证）

- 状态：**已跑并评分（Kevin 2026-09-04 深夜以 lykoi 跑；主治理 Agent 填 `report.md`）**。P4B-3-off 一项待 Kevin 从 log 补；排序修正建议在 report §6 待裁。执行方：主治理 Agent 写脚本与评分表；**Kevin 在服务器以 lykoi 账号跑**（探针 v3–v5 同法：脚本入工单目录，`set -a; . /home/lykoi/secrets/llm.env`）；读数回填 report；复核：主治理 Agent。
- 立单：2026-09-04，主治理 Agent。
- 依据：`governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md` 第一节第 4 点与 §四.1（全程前置：先用产线模型跑"目标→组合→委托→验证"探针，读数决定每层厚度）；Kevin 裁定 R-C（探针先行）；GPT 修订：C1 加直接基线；主治理 Agent 校正：delegation tax 真实数字出在 C2，C1 只按评分表预测委托提示充分度。
- 前置事实：产线模型 deepseek-v4-flash。LANDING-J～O 读数：工具帧上 wire 必 400；json_object 在工具帧后退化空白；step 0 思考 10–85 s；low 档 completion 中位 2536；缓存命中差 5–18 s。探针形态沿 `governance/wo/WO-FIX-THINKPOLICY-01/probe-v5.sh`（S0 / S0P / S1 三形态、档位循环、parse 函数、只打印前 160 字）。
- 本单**零代码改动**：不动 `packages/*`，不动产线，不动 profile。

## 0 · 执行方入场须知

- 产物：`governance/wo/PROBE-CAP-01/probe-cap.sh`（bash + 内嵌 python3，与 v5 同构，无第三方依赖）、`rubric.md`（评分表）、`report.md`（读数回填后由 Kevin 交回，执行方填分析）。
- 脚本约束：system = 产线 persona 正文（root 读 `/home/lykoi/runtime/persona/lykoi_base.toml`，正文零入库，与 v5 同）+ 契约常量；**不打印 persona 正文**；每形态每档跑 2 次；打印 time_total / reasoning_len / content_len / 信封是否合法 / usage / 首 160 字。输出落 `report.md` 的读数表，正文不入库。
- 档位：low（产线现状，THINKPOLICY 后显式 low）与 off 两档。high 只在 P1 跑一次作对照。
- 文档风格：事实。

## 1 · 四个形态

每个形态是一条"她要完成一个真实目标"的最小上下文。所有形态 user 侧只给目标，不给步骤。

| 形态 | 问题 | 消息形态 | 判据 |
|---|---|---|---|
| P1 目标 | 给一句目标，她能否产出合法信封并选对第一步 | S0 同构：persona + user 目标 + 契约；json_object | 信封合法率；kind 选择（reply/tool_call/promise_followup）与目标匹配；tool 名与参数合法（对照 `TOOL_TABLE`） |
| P2 组合 | 多步目标下，她能否把已知工具串成序列（不越界 MAX_TOOL_STEPS） | S1 同构文本帧：目标 → tool_call → `[工具结果]` 文本帧 → 契约，喂到第 3 步 | 每步信封合法率；第 2 步之后是否仍能给出下一工具而不是过早 reply；序列是否收敛 |
| P3 委托 | 给一个超出她工具面的目标，她写出的委托说明是否"够外部 Agent 干活" | persona + user 目标 + 契约，契约段临时加一种 `delegate` kind 的示例（**只在探针里**，不改产线契约） | rubric 五项打分：目标复述、完成判据、边界/禁止项、所需输入、交付形态。总分预测委托提示充分度；不是真实 tax |
| P4 验证 | 给她一个外部 Agent 的交付（含一处故意错），她能否发现并按 37.8 报 `unbacked_claim` | persona + user"这是委托结果" + 交付文本 + 契约 | 是否指出错处；是否要求回执/证据；是否直接把交付当事实转述给 owner |

直接基线（GPT 修订）：P3、P4 各加一组"无 persona、只契约"的对照，看 persona 前缀对委托/验证质量的影响方向。

目标样本每形态 3 条，固定写在脚本里（中文、日常、SFW，与现有 v5 的"东莞天气"同风格；P3 用"整理一份 X 的对比表"类；P4 的交付文本里埋一处可核的事实错）。

## 2 · 评分表（rubric.md）

- 信封合法：能 `extractJson` 且 `decision.kind` ∈ 契约四值（P3 加 `delegate`）。
- P1/P2 工具选择：与 `TOOL_TABLE` 名对上；参数键名对；搜索意图不塞进 `url`（v3 已知病）。
- P3 五项各 0/1/2，满分 10；≥7 记"充分"。
- P4 三项：发现错处 / 要求证据 / 未转述为事实，各 0/1。
- 时延与 reasoning_len 只记录不评分。

## 3 · 报数与结论格式

report.md 表：形态 × 档 × 次 → 合法 / 判据得分 / time_total / reasoning_len / content_len。末尾五条结论，每条一句：P1 信封稳定性；P2 序列收敛性；P3 委托提示充分度预测；P4 验证能力；low vs off 差异。结论只写读数支持的话。

## 4 · 用途

读数进 `governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md` 的排序修正：P2 决定 A4/E1 的厚度；P3 决定 E4-SPEC 里委托说明模板的粒度；P4 决定 37.8 验证平面的最小实现是否需要独立校验器官。C2（Codex 直跑对照）以本单脚本为 runner 基础。
