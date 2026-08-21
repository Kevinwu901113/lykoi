# WO-GW-01 复核（必要检测级，owner 2026-08-21 提速指令下）

- 执行：第 1 波撞限中断（②–⑥幸存）+ 第 2 波续跑单单次 EXIT=0（2026-08-21 18:55–22:22，opus），尖 `32238013`
- **结论：PASS**（含 1 项偏离追认，见 §3）

## 1. 必要检测（复核侧独立做）

- **改动面精确命中**：kernel 4 文件（approval/delegation 新/dispatch/scope）+ mind/migrations + resources/delegation 新 + manifest + 测试 6 文件。**guardian 代码 0 改动**（①c 实证：audit sink 收任意 dict，事件名是数据非枚举）。forbidden 区（conversation/telegram/surface/decide/broker/secrets）**零触碰**（复核侧 grep 独立证实 + 报告逐字节零 diff 断言）。
- **kernel 纯加法**：491 加 / 4 删，4 删全为原地扩写（origin Literal 加 "delegated"、audit dict 扩字段、UNSCOPABLE 扩 `delegation.dispatch`）。最后一条是**超工单加固**：堵死 `grant_standing` 常设授权绕过审批的口子（四重堵法之②）。
- **数字**：权威 2169/3/6 = 基线 2108 + 新增套件 61 全绿，失败集 = 基线三条不增不减；新套件单跑 61 passed 与 commit 声称逐数吻合；manifest 110→112（新 2 = 两个新 .py，改 4）与治理侧独立 wc 一致，且执行方用 startup_verify 自家函数整表重算非手改。
- **诚实披露认可**：③段复跑段 2 在 77% 被杀（并行 U3S 资源压力，教训 38 预告成真），执行方**没有**把它计入权威数，改用"全部 16 个引用 manifest 的测试文件重跑无新失败"的靶向替代验证——方法正确。
- **WIP 平反**：续跑单称 attempt1 manifest 为"半截重签"，执行方回退后独立重算再逐字节 diff 证明 attempt1 已签对——如实纠正治理侧判断，好行为。

## 2. 设计亮点（抽读认可）

`origin=="delegated"` 缺 ref 刻意不在 `__post_init__` 抛（构造期抛留不下审计行）；审计先于落库（账可多于事实，与 pre-dispatch 门同失败方向）；`transition` 库层 CAS（`WHERE id=? AND state=?`）；depth 取 `max(REQUESTER_DEPTH, params.depth)` 永远往严；session_id 由 contract_id 确定性派生不落列。

## 3. 偏离追认（治理侧裁决：**追认**）

`execution_receipts.verdict` CHECK 未逐字照抄冻结稿 §3.2：原文 `IN ('accepted','rejected',NULL)` 在 SQL 三值逻辑下**恒不失败**（不匹配时表达式为 NULL 非 FALSE，CHECK 只拦 FALSE）——是冻结稿的笔误级缺陷。落地写法 `IS NULL OR IN(...)` 取值集合与原文意图逐字相同、方向收紧。**治理侧追认，设计 v1.1 修订此行**（正本待补一行注记）。

## 4. 上呈采纳

- **`guardian/policy_core.HARD_ASK_TYPES` 加入 `delegation.dispatch`**（执行方两波一贯建议，本单 forbidden 不许动 guardian 故只提不做）：复核侧核实**零测试钉该集合内容**，采纳为治理侧修正 commit，随初始化节点统一尖入活体（root 落地=owner 认可）。
- GW-02 交接清单收录（Runner 出生环境接口点/broker 票据绑 contract_id 挂点/S4a 四条可测前提），随 GW-02 签发引用。
