# WO-L2 · 层 1 改造：原料池取料（带水位线）+ K 标定 + 关切 origin

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l2`，基于活体 main
`01a8099c`，worktree 与 `.venv` 已备好）实现。
设计基准：`~/learning_layer_v2_design_2026-08-10.md` **§3.3**（本单主体）、§3.5（origin
三来源）、§4.3（W1/W2 分期作废）、§4.4（K 重标定）、§5.2（历史积压不补消化）。
前置已在本分支（都已在活体上线）：L1 的 `experience_class` 影子表 + 活体已回填
（working 1340 / archive 3652 · 2026-08-11 实测）；L3 的 `relevance.py`。

## 报告纪律（先读）

- 你的 **stdout 就是报告本体**，不要把报告写成文件。**禁止用摘要代替明细，宁长勿略。**
- 流程里不许有"等待"步骤；测试命令一律 `timeout 300` 包裹；
  **每完成一个里程碑（水位线迁移 / 取料改造 / origin / 测试）立刻 `git commit`**。
- 只跑本单专项测试 + integrator 全部既有测试 + `pytest tests/test_p0_integrity.py`，
  不要跑全量 pytest（复核方统一跑）。
- 用 `.venv/bin/python` / `.venv/bin/pytest`。

## 本单的分量（读懂再动手）

这是学习层 v2 **第一个真正改变她行为**的单：55 天里她的消化队列只有 3.1% 外部信息、
1178 条关于 Kevin 的感知被一行 `source <> 'environment'` 挡在门外——本单拆掉那扇门。
设计明令（§3.3"不改"）：**叙事重写逻辑、连续性门、情绪调节一概不动**——那是她唯一
活着的学习回路，本单只换"喂什么"，不动"怎么消化"。

## goal

### 1. 取料改造（§3.3 改造 1 + §4.3）

integrator 的原料来源从"全部未消化且 `source <> 'environment'`"改为：

```
原料池未消化项 且 id > 水位线
（experience_class.class='working' AND integrated=0 AND e.id > watermark）
```

- **先读代码**：找到 integrator 实际取料的函数（briefing 线索：`pending_experiences()`，
  docstring 有"W1 environment 沉淀明确不进入 nightly"字样），确认所有调用方后再动。
- `source <> 'environment'` 硬排除**删除**（W1/W2 分期作废，§4.3）；感知自此自动进入
  nightly 消化。
- 旧接口若还有其它调用方，保持其行为不变并在报告里列出调用方清单；integrator 切换到
  新取料口。`integrated` 的写回语义一个字不改（§5.3）。

### 2. 水位线（§5.2，本单最重要的设计点）

**活体现状（2026-08-11 实测，写进注释）**：working 池未消化 1180 条，**全部**是历史
感知（conversation/action_result 的 working 项均已消化）。设计 §5.2 明令：
"补 1178 条积压是伪需求：层 2 需要时会检索它们"——**历史积压永久不进 nightly 队列**，
由 L3 检索伺服。落地：

- 新增 mind 迁移 `_V12`：在既有 `integration_state`（先读它的 schema 与读写 helper，
  不要假设形状；若确实不适合存键值，允许建一张单行小表，报告里说明理由）写入
  `l2_intake_watermark_id` = 迁移执行时 `MAX(experiences.id)`（空表则 0）。
  幂等：已有键则不覆盖（水位线是历史事实，重放迁移不得抬高它）。
- `downgrade_v12` 删除该键（/表）即回到现状。
- 取料查询读这个水位线；**水位线之下的 working 项仍是原料池成员**（`working_set_pending`
  与 L3 检索照常看得到它们），只是不进 nightly。

### 3. K 标定（§3.3 改造 2 + §4.4）

`INTEGRATION_CAPACITY_K=30` **数值保留**，但注释重写为 2026-08-11 实测依据：
水位线之上起步为 0 条，近期流入 ≈ 3 条/天（对话 + 感知低活跃期），历史感知高活跃日
≈ 40 条/天量级，K=30/晚 覆盖充分；并写明重标触发条件（水位线上未消化持续 > 3K 时
上调或加密周期——那是将来的观察决定，本单不做自适应）。

### 4. 关切 origin（§3.3 改造 3 + §3.5）

- 先确认 `concerns.origin` 字段现状（§3.5 说"已存在，直接用"——**实读 schema 验证**，
  不存在就停下来报告，不要自建）。
- integrator 显式产出关切时标 `origin='emergent'`（现有机制产出的都是这类）。
- 消化 `conversation` 原料时识别**所有者关注表达**（"我希望你留意 X""帮我盯着 Y"类）
  → 产出 `origin='owner_directed'` 的关切。识别发生在层 1 的 LLM 整合步内：
  照 integrator 既有测试的 LLM mock 模式写测试——**确定性部分**（prompt 里含识别指令、
  LLM 返回 owner_directed 标记时管线正确落库、非对话原料不会产出 owner_directed）
  必须可测；识别效果本身留活体观察，本单不为它造真 LLM 调用。
- `origin='derived'` 是层 2 的事（L4），本单**不实现**；但落库路径不得写死只认两种值。

## forbidden

- 不改叙事重写、连续性门、情绪调节、`INTEGRATION_EVERY_WAKES` 节律（§3.3"不改"清单）
- 不动 `experiences` 表结构/触发器；`integrated` 语义不变；不删任何记录
- 不实现关切选择策略 / 反刍防护 / 层 2 循环（L4）；不接 bandit（§4.2 降级留位）
- 不新增依赖；不新增带默认绝对路径的状态文件（有需要即停下来报告）；
  新增状态键若涉及文件，须进 `tests/conftest.py` 隔离清单（HANDOFF 教训）
- 不 push；提交留在 `wo/l2`；不跑全量 pytest

## manifest 纪律

触及 `mind/` → 照 WO-L1/L3 的做法重签 `guardian/manifest.sha256`（claude 身份下
`--write-manifest` 会崩，用 `startup_verify._protected_files()`/`._sha256()` 自算，
读不到的那条沿用旧行），报告给出 diff 与条目数（现为 103）。
跑 `pytest tests/test_p0_integrity.py` 报数（claude 身份 1 个既有假失败，如实报告）。

## success_criteria（合成 fixture，禁止使用真实备份）

1. **取料**：正例（水位线上的 working 未消化项进队列，含 environment——这是 55 天来
   第一次）；反例（水位线下的 1180 类积压不进；archive 不进；已消化不进）。
2. **水位线**：迁移幂等（重放不抬高）；downgrade 后回到现状；水位线下的项在
   `working_set_pending` / `archive_search`(working 不算 archive——用 L3
   `retrieve_for_concern` 验证检索域) 仍可见。
3. **K**：队列长度 > K 时恰取 K 条；≤ K 时全取。
4. **origin**：emergent 默认标注；对话中的关注表达（mock LLM 返回标记）产出
   owner_directed；非对话原料不产出 owner_directed；旧关切行（origin 为空/旧值）读取
   不炸。
5. **不冒险证明**：叙事/连续性门/情绪调节相关的既有测试**逐文件全过**（本单不该碰它们）；
   integrator 既有测试中因"取料口变化"而合理变红的，逐条列出并说明为什么新行为才是
   设计要的（引设计条款），修改钉在行为语义上而不是版本号上。
6. 逆迁移后：v11 状态完全恢复，integrator 行为回到今天（有测试证明）。

## required_evidence

git log/diff --stat；新取料查询完整 SQL/代码；`_V12` 与 downgrade 代码；水位线读写
代码；origin 落库代码与 prompt 改动原文；每条 success_criteria 的用例名+结果；
既有 integrator 测试的逐文件通过数（改动过的逐条说明）；manifest diff 与条目数；
必答硬数字（新增/修改文件数与行数、专项通过数、p0 通过数）。
