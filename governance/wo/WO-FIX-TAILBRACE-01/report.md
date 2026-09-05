# WO-FIX-TAILBRACE-01 · 报告

- 执行方：主治理 Agent（本窗口自执行，未派子 Agent）。日期：2026-09-05。
- 分支：`wo/fix-tailbrace-01`。代码提交 `7090e60`；本 report 为末提交。基线：`main@97431ab`（代码基线 `main@c557af2` = 产线 `main@8da87dc`；其后提交为 #11/#12 测试与治理文档，无 src 改动）。
- 触及 manifest 域：**是**，src 3 个文件（`packages/lykoi-decide/src/index.ts`、`packages/lykoi-converse/src/contract.ts`、`packages/lykoi-converse/src/conversation.ts`）。
- 测试：1122 / 通过 1111 / 失败 0 / 跳过 11（基线 1106 / 1095 / 0 / 11；+16 恰为本单新增）。`npm run typecheck` 干净。
- 提示词：一字未改，无 sha 变更表。

## 1 · 改动文件

| 文件 | 改动 |
|---|---|
| `packages/lykoi-decide/src/index.ts` | 新增导出 `REPAIR_CLOSERS_MAX = 4`（:594）、内部 `stripFence`（:597）、导出 `repairTrailingClosers`（:612-648）。`extractJson`（:572）一字未动 |
| `packages/lykoi-converse/src/contract.ts` | 新增常量 `CYCLE_REPAIRED_EVENT = 'u3_cycle_repaired'`（:529）、`DETAIL_FIRST_CHAR_BRACE = 'first_char:brace'`（:532，D-2 触发键与 `classifyFailure` 产出的 detail 同一字面量） |
| `packages/lykoi-converse/src/conversation.ts` | `#runCycle` 重试循环 catch 分支（:984-1017）：归因为 `[not_json, first_char:brace]` 时先 `repairTrailingClosers` 再 `parseEnvelope`；`parseOpts` 抽成局部对象供两次解析共用（:978-981）。既有重试/失败路径（:1019 起）逐字未动 |
| `packages/lykoi-decide/test/repair.test.ts` | 新文件，13 例 |
| `packages/lykoi-converse/test/cycle.test.ts` | 追加 3 例（:555-613） |

## 2 · D-n 落实位置

| 决定 | 位置 | 说明 |
|---|---|---|
| D-1 纯函数 | `lykoi-decide/src/index.ts:612-648` | 去首尾空白 → 剥围栏（`:597-603`，末尾围栏可缺）→ 首字符须 `{` → 单遍扫描（字符串态 / 转义 / `{` `[` 栈）→ 栈空返回 null（合法输入不动）→ 错配返回 null → 末尾悬空反斜杠返回 null → 末尾在字符串内先补 `"` → 按栈序补 `}`/`]` → 总补齐 > 4 返回 null → `JSON.parse` 过才返回 `{text, added}` |
| D-2 调用点 | `lykoi-converse/src/conversation.ts:988-1017` | `classifyFailure` 得 `[FAIL_NOT_JSON, DETAIL_FIRST_CHAR_BRACE]` → `repairTrailingClosers(result.content)`；非 null → 先记 `u3_cycle_repaired {step, attempt, added_chars, finish_reason}`（`:999-1004`，`#log` 自动附 run_id/turn_id）→ 用修复文本重走 `parseEnvelope`（`:1006-1009`），成功即 `break`，**零 LLM 调用**；修复后仍抛 → `exc/reason/detail` 换成修复后的归因（`:1014-1015`），落到既有 `attempt < ENVELOPE_RETRY_MAX && reason === FAIL_NOT_JSON` 判断（`:1019`）。修复不了（返回 null）→ 不发事件，直接走既有路径 |
| D-3 不动 `extractJson` | `lykoi-decide/src/index.ts:572-589` | diff 中无该函数改动；`lykoi-wake/src/index.ts:344-361` 未触及 |
| D-4 测试 | `lykoi-decide/test/repair.test.ts`（13 例）；`lykoi-converse/test/cycle.test.ts:560,582,600`（3 例） | 见 §3 |

`u3_cycle_failed` 的 `content_chars / has_content / finish_reason / completion_tokens` 仍取**原始回包**（`result`），不取修复文本 —— 修复后倒在后面几关时，失败事件描述的仍是 LLM 实际给的那份。

## 3 · 测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `repair.test.ts` | 13 | 缺 `}` / 缺 `}}` / 缺 `]}` / 字符串内含四种括号 / 转义引号与转义反斜杠 / 围栏（含末尾围栏缺席）/ 首字符非 `{` 四形态 → null / 上限恰 4 可修、5 → null（两种：纯括号 5 个、`"`+4）/ 已合法三形态 → null / 末尾在字符串内先补 `"` / 错配·悬空反斜杠·尾逗号·缺值·`{"trunc` → null / 首尾空白 + `extractJson` 接住修复文本 / 多余右括号 → null |
| `cycle.test.ts` :560 | 1 | 信封只缺尾 `}`：回复正常、LLM 调用 **1** 次、`u3_cycle_repaired` 恰一条且字段集 `{step:0, attempt:1, added_chars:1, finish_reason:'stop', run_id, turn_id}`、事件序列化不含正文、无 `u3_cycle_retried`/`u3_cycle_failed` |
| `cycle.test.ts` :582 | 1 | 补齐后 kind 为 `REPLY`：`u3_cycle_repaired` 一条、`u3_cycle_failed.reason=unknown_kind, detail=kind:REPLY, attempts=1`、LLM 1 次、`content_chars` = 原始回包长度、outcome `envelope_failed` |
| `cycle.test.ts` :600 | 1（order 外加的安全网回归）| `{"trunc`（补 `"}` 仍非法）→ 不发 `u3_cycle_repaired`，`u3_cycle_retried.detail === 'first_char:brace'`，第二跳成功 —— 证 LANDING-K/L 重试链在修复失败时逐字保留 |

修前/修后同一形态的代价（信封只缺尾 `}`，low 档）：

| | LLM 调用 | 事件 |
|---|---|---|
| 修前 | 2 次（第二次带 nudge、去 json_object；中位 2536 completion tokens） | `u3_cycle_retried` 1 条 |
| 修后 | 1 次 | `u3_cycle_repaired` 1 条 |

## 4 · 越界未做项 / 候选（只列不做）

- **WO-FIX-TOOLSHAPE-01**（order §3 点名）：`sanitizeTool` 收到字符串型 `tool`（PROBE-CAP-01 off 档 P3-1 形态）仍静默降级为 `missing_tool`（`contract.ts:424-441`、`conversation.ts` tool_call 分支）。本单未触碰。
- **围栏形态未接入 D-2 触发**：`repairTrailingClosers` 按 D-1 会剥 ```` 围栏，但 D-2 只在 `first_char:brace` 时调用；````json\n{…` 缺尾的回包归因为 `first_char:fence`，仍走重试链。json_object 模式下不会出围栏，重试（去 json_object）后才可能出；落地后若 `u3_cycle_retried.detail=first_char:fence` 非零再考虑加一行触发键。
- **截断根因（max_tokens）**：本窗口无产线读数。`u3_cycle_repaired.finish_reason` 就是为此留的：落地后按 `stop`（停了但少写）与 `length`（截断）分桶，若 `length` 占多数则候选立单调 `max_tokens` 而非再加修复。
- `repairTrailingClosers` 只在 converse 使用；wake 路径（D-3）保持只重试一次的既有口径。若 wake 的 `autonomy_wake_retried` 也大量落在缺尾括号，可另立单接同一函数。

## 5 · 给 Kevin 的落地提示

- 迁移：**无**（零 schema 变更）。
- 重签 manifest：**要**（src 3 文件：decide / converse×2）。落地形态 = LANDING-F 稿（拉 main + root 重签 + 重启），建议与 #2 #5 合成 LANDING-Q。
- 服务器命令：落地前无。落地后读数（精确匹配 `"type":"u3_cycle_repaired"`，禁子串 grep）：

```bash
sudo grep -c '"type":"u3_cycle_repaired"' /var/log/lykoi-audit/audit.jsonl
sudo grep '"type":"u3_cycle_repaired"' /var/log/lykoi-audit/audit.jsonl | grep -o '"finish_reason":"[a-z_]*"' | sort | uniq -c
sudo grep '"type":"u3_cycle_retried"' /var/log/lykoi-audit/audit.jsonl | grep -c '"detail":"first_char:brace"'
```

  预期：第三行（brace 形态的重试）落地后应趋零；第一行的增长即修复次数。
