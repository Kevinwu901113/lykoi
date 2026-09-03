# WO-FIX-TOOLSPEC-01 复核

- 复核人：主治理 Agent，2026-09-04 03:05 CST
- 复核对象：分支 `wo/fix-toolspec-01` tip `351b89a`（代码 3fd6f9a D-1/D-2 + e99ce1e D-3 + c10a8da D-4 + 351b89a report.md），基线 main@`4aec35f`
- 结论：**PASS**

## 一、逐条对照

| 条 | 要求 | 实际 | 判 |
|---|---|---|---|
| D-1 | `TOOL_TABLE: Record<string,{action,signature,purpose}>`，`TOOL_TO_ACTION` 派生投影 | 13 项（10 + 3 in-cognition 以 action:null 同表）；投影冻结、键值逐项不变，有用例断言相等；签名逐项有 handler 实读依据，无真身三项记 `...` 不编造 | ✅ |
| D-2 | `renderToolTable(wiredActions?)` `name(signature) — purpose` | 复用 `envelopeToolNames` 的序与过滤（不出现第二套）；代入点补 2 空格续行缩进 | ✅ |
| D-3 | prompts.ts 删逐工具散文、删 `query` 句 | 6 行工具散文 + notify_owner 一句删除；query 句改「自己换检索词重搜」；审批分级句保留 | ✅ |
| D-4 | 测试 | 投影相等 / 表完整性 / 渲染形状 / 生产行数 / 缩进 / renderSystemPrompt 恒等 / D-3 删改正反断言 | ✅ |
| D-5 | 字节变化声明 | SYSTEM_PROMPT 3014→2019 B；契约生产口径 3673→4892 B；两块合计净 +317 B；`#messages` 与 M 的缝未动 | ✅ |

偏差五处均接受，见 report.md。关键一条：无真身工具签名 `...` 比编一个 `()` 更诚实，生产口径下这三行本就不渲染。

表内 purpose 文本我逐行读过：notify_owner 那句「正在对话里就直接 reply，不要用它送答案」直接对应分析稿 §4 的观察；research_read_text 那句「只收 url，没有检索词参数」对应 §1 的 `query` 误用。

## 二、我方独立验证（worktree `wt-fix-toolspec-01`，tip c10a8da）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| lykoi-converse `npm test` | 131 / 130 / 0 / 1（既有 skip） |
| 执行方全量 | 1027 / 1016 / 0 / 11 |

## 三、风险评估

- 提示词内容变了（她读到的东西变了），这是本单的目的；行为读数看落地后 `u3_cycle_unknown_tool`、`url 必填` 类失败串、notify_owner 在对话中的误用是否下降。
- 前缀缓存失效一次（+317 B 在稳定带），预期。
- `renderSystemPrompt` 成恒等函数：轻框架原则下值得在后续清理单退役，本单不动。
- 回退：contract.ts + prompts.ts 两文件。

## 四、落地要点

- 与 ORGANOK / THINKPOLICY 同批（LANDING-N）。内容断言（`grep -F`）：`contract.ts` 含 `export const TOOL_TABLE` 与 `export function renderToolTable(`；`prompts.ts` 不含 `在 query 里加年份`、不含 `- terminal_exec`。
- §6 服务器实证跑 `contract.test.ts`、`prompts.test.ts`。
- 三分支合并试跑（merge-tree）无冲突；裁合后在合并树上再跑一次 converse/kernel 全包。
