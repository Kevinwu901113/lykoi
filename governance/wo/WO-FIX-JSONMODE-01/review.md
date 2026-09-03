# WO-FIX-JSONMODE-01 · 复核

- 复核：主治理 Agent，2026-09-03 19:05 CST
- 对象：`wo/fix-jsonmode-01` tip 5167e46（bdf0193 之上 3 提交：3e0745f 代码、9b2f5b8 测试、5167e46 report）
- 结论：**PASS**，待 Kevin 裁合

## 1 · 范围

改动仅 `packages/lykoi-converse/src/conversation.ts`（+20/-2）、`test/cycle.test.ts`、`test/e2e.test.ts`，以及 report.md。wake、contract.ts、decide、profile、词汇表未动（diff 为空）。

## 2 · 逐条

- D-1 ✅ `#completion`：`responseFormat: nudge ? null : (envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null)`。nudge 缺省/false 那一支表达式原样，attempt 0 字节不变；测试钉 `call0.opts.responseFormat` 深等 `{type:'json_object'}`，且下一轮全新的 attempt 0 仍带（不是"重试后就一直去"）。seam（index.ts:350-352）在 responseFormat 为 null 时不发键，wire body 无 response_format。
- D-2 ✅ `jsonMode = !nudge && envelopeJsonMode()` 记「刚发出去的这一次」；retried/failed 两事件各补 `json_mode`。cycle 与 e2e 两处断言 attempt 0 → true、attempt 1/2 → false。词汇表不钉字段集合，无需同步（执行方核过）。
- D-3 ✅ 契约常量未动。执行方实测 extractJson 花括号切片对围栏与前后缀说明均容错，新增 D-4③ 用例「前缀说明 + JSON + 后缀」直接出 reply、无 u3_cycle_failed。
- D-4 ✅ 四条断言齐；step ≥ 1 的重试同时验 reasoningEffort:off + 引导 + responseFormat null。
- D-5 ✅ wake 不动。

## 3 · 我方复跑

- tsc `--noEmit -p .`：净。
- converse cycle + e2e：24/24。执行方全仓 1021 / 1010 / 0 / 11（K 时 1015 → 净增 6，含改名与新增）。

## 4 · 落地要点（LANDING-L）

- 零迁移、零 profile、零依赖变化；manifest 仍 113 条重签（只改 converse src）。
- 内容断言：`responseFormat: nudge ? null : (envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null)` 1 处；`json_mode: jsonMode,` 2 处；J/K 落点仍在（`reasoningEffort: 'off' as const`、`ENVELOPE_RETRY_MAX = 2`）。
- §6 服务器跑 cycle.test.ts 与 e2e.test.ts；读数：落地前 u3_cycle_failed{not_json} 累计（今日已 4）。
- 落地后验收：`u3_cycle_retried{json_mode:true}` 之后的重试是否出 u3_cycle_envelope；first_char 分布是否出现 fence/cjk 等新形态；not_json 失败日计。
