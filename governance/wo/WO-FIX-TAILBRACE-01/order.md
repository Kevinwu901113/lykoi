# WO-FIX-TAILBRACE-01 · 信封尾缺括号的本地修复（不重调 LLM）

- 状态：**待派**。执行方：执行子 Agent（小单，sonnet 可）。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：`governance/wo/PROBE-CAP-01/report.md` §0（json_object 下出现"JSON 缺尾 `}`"新形态，low 档 34/36、off 档 32/34 合法，非法样本里此形态占多数）与 §6；LANDING-K/L 的 not_json 重试链是安全网，本单在它前面加一层零成本修复。
- 基线：`main@c557af2`。分支：`wo/fix-tailbrace-01`。可与任何单并行。
- 包：`lykoi-decide`（纯函数）、`lykoi-converse`（调用点）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：不改提示词、不改 `JSON_RETRY_NUDGE`、不改 wake 路径。

## 1 · 根因（事实）

| 现象 | 位置 | 事实 |
|---|---|---|
| 缺尾括号必抛 | `packages/lykoi-decide/src/index.ts:572`（`extractJson`）：整串 parse 失败后切 `indexOf('{')`..`lastIndexOf('}')+1`，守卫 `start !== -1 && end > start`；无 `}` 时 `end === -1` 直接抛 | 没有任何括号平衡修复 |
| 已有的形态桶 | `packages/lykoi-converse/src/contract.ts:546-552`（`firstCharClass` → `brace` 注释："多半是 max_tokens 截断而非契约失败"）、`:612`（`classifyFailure` → `[not_json, 'first_char:brace']`） | 能识别，不能修 |
| 重试代价 | `conversation.ts:963-1026`（`attempt < ENVELOPE_RETRY_MAX && reason === FAIL_NOT_JSON` 才重试；重试丢 json_object、带 nudge） | 每次重试一次完整 LLM 调用（low 档中位 2536 completion tokens） |
| 三处独立解析器 | `lykoi-decide/src/index.ts:572`、`lykoi-learn/src/shared.ts:44`、`lykoi-kernel/src/approval-interpreter.ts:354`（唯一剥 ``` 围栏的） | 刻意不统一；本单不合并 |
| 现有失败字段 | `u3_cycle_failed` 含 `finish_reason, completion_tokens, content_chars`（`conversation.ts:1005-1023`） | 能事后区分"截断"与"停止但少写" |
| 测试 | `converse/test/cycle.test.ts:174`（前缀散文 + JSON 靠切片恢复）、`contract.test.ts:132,:177`（六类归因；`classifyFailure` 永不抛） | 样板 |

## 2 · 决定

- **D-1 纯函数** `repairTrailingClosers(text): { text: string; added: string } | null`（放 `lykoi-decide/src/index.ts`，导出）：输入去首尾空白并剥 ``` 围栏；首字符必须是 `{`；单遍扫描，跟踪字符串态与转义，统计未闭合的 `{`/`[` 栈；若栈非空且末尾不在字符串内，按栈序补 `}`/`]`；补齐 ≤ 4 个；补完 `JSON.parse` 成功才返回，否则 null。末尾在未闭合字符串内 → 先补 `"` 再补括号（仍受 ≤ 4 总数限制，`"` 计一个）。
- **D-2 调用点**：`conversation.ts` 重试循环里，`classifyFailure` 得 `[not_json, 'first_char:brace']` 时，先 `repairTrailingClosers(content)`；非 null 则用修复文本重走 `parseEnvelope`（不重调 LLM），审计 `u3_cycle_repaired {step, attempt, added_chars, finish_reason}`；修复后仍失败则按现有路径重试。
- **D-3 不动 `extractJson`**：wake 路径行为不变（它保留 json_object 并只重试一次，`lykoi-wake/src/index.ts:344-361`）。
- **D-4 测试**：`lykoi-decide/test/repair.test.ts` ≥ 10 例（缺 `}`、缺 `}}`、缺 `]}`、字符串内含 `}`、转义引号、围栏包裹、首字符非 `{` → null、补 5 个 → null、已合法 → null（不修改合法输入）、末尾在字符串内）；`converse/test/cycle.test.ts` 增两例：缺尾 `}` 一次修复成功 → LLM 调用 1 次、`u3_cycle_repaired` 一条、无 `u3_cycle_retried`；修复后 kind 非法 → 走 `unknown_kind` 不重试。

## 3 · 边界

- 不改 learn / kernel 的解析器。
- 不改 `ENVELOPE_RETRY_MAX`、不改 json_object 开关逻辑。
- 不做"截断根因"处理（max_tokens）；report 若从 `finish_reason` 看出截断占比，列候选。
- `sanitizeTool` 收到字符串型 `tool`（PROBE-CAP-01 off 档 P3-1 形态）目前静默降级为 `missing_tool`（`contract.ts:424-441`、`conversation.ts:1082-1091`）：本单不改，report 列候选 WO-FIX-TOOLSHAPE-01。

## 4 · 验收

1. 全绿；新增用例 ≥ 12。
2. `u3_cycle_repaired` 字段零正文。
3. 触及 manifest 域：是（decide、converse src）。

## 5 · 报告要求

按 brief §4。
