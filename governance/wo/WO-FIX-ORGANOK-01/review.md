# WO-FIX-ORGANOK-01 复核

- 复核人：主治理 Agent，2026-09-04 02:20 CST
- 复核对象：分支 `wo/fix-organok-01` tip `5624a2f`（代码 `36f46be` D-1 + `9693a54` D-4 + `5624a2f` report.md），基线 main@`4aec35f`
- 结论：**PASS**

## 一、逐条对照

| 条 | 要求 | 实际 | 判 |
|---|---|---|---|
| D-1 | dispatch 返回值处一条规则：plain object 且 `ok === false` → `{success:false, data: redactObj(data), error}`；其余路径逐字节不变 | `dispatch.ts` 389–410 行，位于 try/catch 之后、原成功返回之前；`typeof data === 'object' && data !== null && !Array.isArray(data) && data.ok === false`；抛错路径与成功返回行未动 | ✅ |
| D-2 | 不改器官/converse/审计事件结构 | 差异只在 kernel `dispatch.ts` 与三包测试 | ✅ |
| D-3 | notify.owner 节流、审批路径不受影响 | 节流返回不带 `ok`，测试钉住走成功路径；审批在 handler 之前 | ✅ |
| D-4 | kernel 单测 / organ-browser 集成 / converse 补一条 | kernel 六条（含 redact 与审计 success:false）；organ-browser 一条走真宿主真 dispatch；converse 一条超时回执真实形状 | ✅ |
| D-5 | 影响面声明 | 审计 `action_result.success` 对器官失败记 false，测试直接断言审计行 | ✅ |

偏差两处，均接受：
1. `error` 串过 `redact()`。工单写直接用 `data.error`；执行方指出 data 已过 `redactObj` 而顶层 error 不遮会形成遮蔽口子，与抛错路径一致地 redact 更对。有红测。
2. converse 补了用例而非跳过。写下器官超时回执的完整形状作为下游锚点，源码零改动。

## 二、我方独立验证（worktree `wt-fix-organok-01`，tip 9693a54）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| lykoi-kernel `npm test` | 205 / 205 / 0 / 0 |
| lykoi-organ-browser `npm test` | 67 / 67 / 0 / 0 |
| lykoi-converse `npm test` | 128 / 127 / 0 / 1（既有 skip） |
| 执行方全量 | 1031 / 1020 / 0 / 11 |

## 三、风险评估

- 影响面：只有 organ-browser 的 `createOrganHandler` 是会返回 `ok` 的已接线 handler（执行方核过 adapter-telegram transport 与 driver/ssrf 的 `{ok:false}` 不经 ResourceRegistry）。
- 落地后可见变化：超时/拦截的 `action_result.success` 变 false；模型回执 payload `success:false`；`receiptsPresentInContext` 对超时判无回执 → `unbacked_claim` 在「查失败仍说查了」时开始为 true。这些都是本单要的。
- 未来约束：器官不得用 `ok:false` 表达「成功但结果为否」；写入分析文档 §2 结论即可，不需代码。
- 回退：单文件回退 `dispatch.ts`。

## 四、落地要点

- 与 TOOLSPEC / THINKPOLICY 同批落地（一次停机），脚本内容断言：`dispatch.ts` 含 `.ok === false` 与 `'organ_failed'`（`grep -F`）。
- §6 服务器实证跑 `packages/lykoi-kernel/test/dispatch.test.ts` 与 `packages/lykoi-organ-browser/test/plugin.test.ts`。
- 落地后读数：审计 `action_result` 中 `research_browser.read_text` 的 `success:false` 开始出现（对照 browser_action `status` 非 ok 的条数）；`u3_cycle_envelope` 的 `unbacked_claim:true` 条数。
