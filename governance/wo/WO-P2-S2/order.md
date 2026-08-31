# WO-P2-S2 · 对话式审批解释器

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work`（分支 `wo/p2-s2`，基于 `wo/p2-s1b`）实现。
设计基准（都要读）：
- `~/approval_model_v1_2026-08-10.md`（**主基准**，含三层门、范围键、初始预授权 §2b）
- `~/lykoi_embodiment_redesign_v1_2026-08-09.md` §1.2
- 上两单产物：`src/lykoi/resources/messenger.py`、`telegram_device.py`

## 本单要解决的核心问题

上一单（S1B）发现死锁：`messenger.send` 默认走审批 → **她要回复主用户得先请求审批，
而请求审批要靠发消息**。本单实现的对话式审批 + 初始预授权是解开它的钥匙。

## goal

### 1. 初始预授权（先做这个，它解死锁）

按 `approval_model_v1` §2b 落地：
- 回复**已绑定所有者** → 免询；
- **主动**开口找所有者 → 免询（打扰纪律已在 S1A 资源层实现，不重复）；
- 发给**其它收件人** → 走对话审批。

落地形态：写入活规则（`approval_rules.json` 的既有机制，**先读它的现有 schema 与
`kernel/approval.py` 的判定顺序再动手**），并提供一个幂等的初始化函数
（部署时调用一次）。**不得修改 `guardian/policy_core.py`**（root-only，且本单无需）。

### 2. 范围键（本单的设计重心）

实现 `scope_key(action) -> str` 与规则匹配：

| 动作 | 范围键 |
|---|---|
| `messenger.send` | 收件人身份（已绑定者用 `user_id`，未绑定用 `channel:channel_key`） |
| `browser.navigate` / `research_browser.open` | **注册域名（eTLD+1）**，不是完整 URL |
| 其它有副作用动作 | 先给出你的方案并说明理由（可用动作类型本身作为退化键） |

**三条纪律**（写进代码注释与测试）：默认取**最窄**的键；活规则**只能收紧不能放宽**
（沿用既有铁律）；每条常设授权**可单条撤销**。

### 3. 回答解释器

`interpret(answer_text, question_context) -> {verdict, confidence, scope, conditions}`
其中 `verdict ∈ {approve, deny, conditional, unclear}`。

- 用 LLM 判定（复用 `cognition/llm_client.py` 的既有调用方式，**不新增依赖、不新建路由**）；
- **结构化输出**，解析失败一律降级为 `unclear`（fail-safe，绝不猜成 approve）；
- LLM 不可用时降级为 `unclear` 并记录（不阻塞、不误放行）。

### 4. 归属消歧（防"闲聊的好啊被当成批准"）

`resolve_target(answer, pending_questions) -> question | None`，综合四个信号：
引用关系（Telegram reply_to）、时间邻近、当前悬置问题数量、语义匹配。

**硬规则**：
- 存在**多条**悬置问题且回答未明确指向其一 → **不猜，追问**；
- 无引用、且最近悬置问题超过 N 分钟（N 自定并说明）→ 追问；
- 一条与任何悬置问题都不匹配的肯定回复 → **当作闲聊，不作为批准**。

### 5. 明确度门（风险分级）

- **高危/所有者管理类**（`policy_core.HARD_ASK_TYPES` 及硬性策略类）：
  `unclear` → **必须追问**，复述具体动作请求明确表态；追问无次数上限；
  **永不产生常设授权**（硬门不可提升，`policy_core` 的既有语义）。
- **常规类**：`unclear` → 追问**一次**；仍 `unclear` → **按拒绝处理**（不猜）。
- `approve` 且非硬门 → 写入该范围键的常设授权。
- `conditional` → 首版把条件**原文**随规则存下并在后续同范围动作时注入她的上下文，
  **不做机器可执行的条件判定**（明确记录这是首版限制）。

### 6. 审计（六元组）

每次审批交互必须落 immutable audit（经既有 guardian audit sink）：
**问题原文、回答原文、解释结果、风险级、范围键、是否产生了常设授权**。
事后要能回答"我当时到底授权了多大范围"。

## forbidden

- 不改 `guardian/` 下任何文件（policy_core 的扩面是 root 的活，不在本单）。
- 不改 `/chat`；不改 S1A/S1B 已有的打扰纪律与绑定门。
- 不新增第三方依赖；不新建 LLM 路由。
- 不 push、不合并；提交留在 `wo/p2-s2`。
- **不要跑全量 pytest**（复核方统一跑）。只跑你新增/相关的专项测试。

## manifest 纪律

会触及 `kernel/` 与/或 `resources/` → `python3 guardian/startup_verify.py --write-manifest`
重签，报告给出 diff，并跑 `pytest tests/test_p0_integrity.py` 报数
（claude 身份下有 1 个既有假失败 `PermissionError: approval_rules.json`，如实报告）。

## 输出纪律

- **stdout 即报告本体**；禁止摘要代替明细；**完成后立即 `git commit`**。
- **不要等待任何长任务**；不要以"我在等测试"结束会话。
- 必答硬数字：新增/修改文件数与行数、专项测试用例数与通过数、p0 通过数、manifest 条目数。

## success_criteria

1. 初始预授权生效后：她回复已绑定所有者**无需审批**（测试断言 dispatch 直接放行）。
2. 给新收件人发消息 → 触发提问 → 模拟 Kevin 回"可以" → 写入该收件人的常设授权 →
   **第二次给同一收件人发不再提问**；给**另一个**收件人仍然提问。
3. 归属消歧：两条悬置问题 + 一句无引用的"好啊" → **追问**，不放行任何一条。
4. 闲聊"好啊"（无悬置问题）→ 不产生任何授权。
5. 高危动作（`terminal.exec`）回答模糊 → 追问；即使明确批准也**不产生常设授权**。
6. LLM 不可用 → 一律 `unclear`，无任何动作被放行。
7. 审计六元组齐全（测试断言字段存在）。

## required_evidence

git log/diff --stat；`scope_key` 的完整映射表与退化策略；解释器的提示词与结构化 schema；
归属消歧的信号权重与阈值；每条 success_criteria 对应的测试用例名 + 结果；
manifest diff；必答硬数字。
