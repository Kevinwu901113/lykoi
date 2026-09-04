# PROBE-CAP-02 · 委托实跑对照：delegation tax 真实数字（C2）

- 状态：**待派**。执行方：执行子 Agent（本单里执行方**本人就是"外部 Agent"**）；服务器侧脚本由 Kevin 以 lykoi 跑。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-C（探针先行）与"不派 GPT"（执行子 Agent 直接充当外部 Agent）；`governance/wo/PROBE-CAP-01/report.md` §3（P3 有 persona 时 0/12 选 delegate，唯一一条 delegate 评 10/10）与 §6（C2 增"直接要求用 delegate"指令组）；PROBE-CAP-01 order §4（C2 以其脚本为 runner 基础）。
- 基线：`main@c557af2`。分支：`wo/probe-cap-02`（脚本、评分表、交付物、report）。**零代码改动**。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- 服务器脚本沿 `governance/wo/PROBE-CAP-01/probe-cap.sh` 的 P3 形态（persona + user 目标 + 契约 + 临时 `delegate` kind 示例；**不改产线契约**）。
- 执行方在本地充当外部 Agent 时，只用执行环境自带的工具；无网络就如实记"无网络，只做离线可完成部分"。
- 交付物（执行方写的表格）入 `deliverables/`，是执行方产物，不是 persona 正文。

## 1 · 三组对照

| 组 | 谁做 | 输入 | 产出 |
|---|---|---|---|
| G0 直跑 | 执行方 | P3 三条原始目标（PROBE-CAP-01 脚本里的 P3-1/2/3 文本，原样） | 三份交付物 + 用时 + 步骤数 |
| G1 委托说明 | 产线模型（Kevin 跑 `probe-cap-02.sh`） | P3 三目标 × 指令"这件事请委托给外部 Agent 做，输出 delegate 信封" × persona/无 persona × 2 次 | 12 条委托说明（信封 content） |
| G2 按说明跑 | 执行方 | 每条 G1 委托说明，**只按说明干活**，说明没说的不做、没给的输入不猜 | 12 份交付物 + 用时 + 步骤数 + "说明缺什么"记录 |

## 2 · 评分表（rubric.md）

- 委托说明：沿 PROBE-CAP-01 rubric §3 五项（目标复述 / 完成判据 / 边界禁止 / 所需输入 / 交付形态），满分 10。
- 交付物（G0、G2 同表）五项各 0/1/2：覆盖原目标全部限定项 / 每格有出处 / 无编造（抽查 3 格可核）/ 结构符合目标 / 缺数标缺。满分 10。
- **delegation tax** = 均分(G0) − 均分(G2)，另列 persona 组与无 persona 组分别的 tax，以及"说明分 ≥ 7 的 G2 子集"的 tax。
- 用时、步骤数只记录。

## 3 · P4 回灌（可选，若时间允许）

把 G2 的 3 份交付物（各埋一处错）送回产线模型按 PROBE-CAP-01 P4 形态验证；读数与 P4 表并列。

## 4 · 结论格式

四句：委托说明充分度（均分 + persona 差）；tax 数字；说明分与交付分的相关方向；37.8 验证器官最小实现是否需要"逐条回执"（读数支持的话）。

## 5 · 用途

读数进 E4-SPEC 委托说明模板粒度与 37.8 验证平面的立项判断；tax 数字进白皮书 v1.3 候选表。
