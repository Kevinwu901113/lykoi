# WO-FIX-TOOLSPEC-01 · 收工报告

- 执行：opus 执行子 Agent，2026-09-04 01:40–02:00 CST（report.md 由主治理 Agent 代写入库：子代理被 harness 禁止写 report 文件，内容按原报告照录）
- 分支 `wo/fix-toolspec-01` tip c10a8da（基于 main@4aec35f）；三提交：3fd6f9a D-1/D-2、e99ce1e D-3、c10a8da D-4
- tsc `--noEmit -p .`：净
- lykoi-converse 131/130/0/1（既有 skip）；根目录全量 1027/1016/0/11
- 改动：`packages/lykoi-converse/src/contract.ts`（+158）、`src/prompts.ts`（+29/-…）、`test/contract.test.ts`（+24）、`test/prompts.test.ts`（±123）

## D-1 TOOL_TABLE

`contract.ts` 新增 `ToolSpec {action: string|null, signature, purpose}` 与 `TOOL_TABLE`（13 项：S-55 十项 + 三个 in-cognition 工具 action 为 null）。`TOOL_TO_ACTION` 改为从 `TOOL_TABLE` 过滤 `action !== null` 的冻结投影，键集与值逐项不变；`EnvelopeToolName`、`toolDispatchGate`、`#buildAction`、`conversation.ts` 零改动。

签名依据（handler 实读参数名）：browser_navigate `url`（organ-browser toArgs/needsUrl）；browser_get_text `max_chars?`（不收 url）；research_read_text `url, max_chars?`（无 query）；notify_owner `content`（resources.ts，origin 由 conversation 盖章不入签名）；vision_describe `attachment_id, question?`、promise_followup `task`、post_progress `content`（conversation.ts 各处）；terminal_exec `command`（仓库无真身，按派发链上游与工单）；research_open/extract_links `url`（按 needsUrl 惯例）；browser_click/type/screenshot `...`（无真身无宿主 op，工单禁猜，记形状未定）。

## D-2 renderToolTable

`renderToolTable(wiredActions?)` 复用 `envelopeToolNames` 的行序与过滤，每行 `name(signature) — purpose`，自身不带缩进；`envelopeSystemPrompt` 代入时续行缩进 2 空格。生产接线口径 8 行（5 个未接线整行消失）。

## D-3 SYSTEM_PROMPT

删「你的环境与工具」段逐工具散文 6 行、「审批与安全」段 notify_owner 那句；「在 query 里加年份」句改为「自己换检索词重搜」。保留虚拟电脑句、结构化来源句、审批段点名 browser_type/terminal_exec 的分级说明。`prompts.ts` 模块头与 `renderSystemPrompt` doc 注释改口。

## D-4 测试

contract.test.ts：投影相等、in-cognition 三项同表不入投影、13 项各有 signature/purpose。prompts.test.ts：两条 D-3b 过滤快照失去对象，替换为「对任何接线集恒等于原文」+ D-3 删改内容正反断言；三条新用例（表渲染形状、生产口径行数、缩进代入）。

## D-5 字节变化

| 文本 | 旧 | 新 |
|---|---|---|
| SYSTEM_PROMPT | 3014 B / 1418 chars（72a3c1c1…） | 2019 B / 891 chars（075d4282…） |
| ENVELOPE_SYSTEM_PROMPT 模板 | 3264 B | 不变 |
| envelopeSystemPrompt() 全量 | 3761 B | 5476 B |
| envelopeSystemPrompt(生产接线) | 3673 B | 4892 B |
| 生产两块合计 | 6594 B | 6911 B（净 +317） |

稳定前缀缓存失效一次，预期。`#messages` 与 `toDshEnvelopeMessages` 未动。

## 与工单的偏差

1. 三个无真身工具签名记 `...` 而非 `()`；生产口径不渲染。
2. terminal_exec 的 `command` 非产线 handler 实参（仓库无真身），如实标出。
3. prompts.ts 两处注释改口（旧文已成假话）。
4. 投影相等用例放 contract.test.ts。
5. 两条 D-3b 快照测试替换而非改数值。

## 发现但未动

- `renderSystemPrompt` 已成恒等函数（SYSTEM_PROMPT 无工具枚举行），`conversation.ts` 仍调它；是否退役由治理裁。
- 她读工具的第三处 `lykoi-decide/src/organs.ts` 器官清单仍无参数，本单未触及。
- 生产 `wiredActions` 来自 kernel `wiredActionCatalog.knownActions`（已注册 handler）；terminal 真身不在本仓，产线若未接则 `{tools}` 少 terminal_exec 一行，与 `envelopeToolNames` 一致。
- 审批段仍点名 browser_type/terminal_exec（讲审批不讲工具，按工单保留）。
