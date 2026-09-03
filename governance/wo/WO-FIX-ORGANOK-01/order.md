# WO-FIX-ORGANOK-01 · 内核听器官的 ok：返回值 ok:false 即失败观察

- 状态：**已裁合，待落地 LANDING-N**（Kevin 03:30「都合」，合入 main@e299c1d；Kevin 2026-09-04 01:40 放行；opus 执行于 wo/fix-organok-01，基线 main@4aec35f，tip 5624a2f；复核 PASS 02:20，见 review.md）
- 立单：2026-09-04 01:30 CST，主治理 Agent
- 分析：governance/docs/tool_step_structural_analysis_2026-09-04.md §2
- 包：lykoi-kernel（dispatch.ts + 测试）；organ-browser 只加 e2e 断言；converse 不动

## 1 · 根因

`dispatch.ts` 把 handler「返回」一律记 `success:true`（SK-10：抛才是失败）。器官宿主为保留失败细节刻意返回 `{ok:false,error,detail}` 而不抛（红线 #5：抛错路径 `data:{}` 丢细节）。结果超时/拦截在审计 `action_result`、模型回执 payload、`receiptsPresentInContext()` 三处都被当成功，白皮书 37.8 回执背书在超时上失效。

## 2 · 决定

- D-1 `dispatch.ts` handler 返回后、redact 之前加一条规则：返回值是 plain object 且 `ok === false` → `{ success: false, data: redactObj(data), error: typeof data.error === 'string' ? data.error : 'organ_failed' }`。data 整体保留（detail 仍给模型读）。其余返回值路径逐字节不变；抛错路径不变。
- D-2 不改器官（它已经说真话），不改 converse `#resultPayload`/回执逻辑（它们读 `success`，改后自然正确），不改审计事件结构。
- D-3 `notify.owner` 节流返回 `{queued:false, throttled:true}` 不带 `ok`，不受影响；审批 `needs_approval` 路径在 handler 之前，不受影响。
- D-4 测试：kernel dispatch 单测（ok:false → success:false 且 data 保留、error 取自 data.error、无 error 串时 'organ_failed'；ok:true / 无 ok 字段 / 抛错三路不变）；organ-browser e2e 一条：宿主回 timeout → Observation.success false。converse 现有 `receiptsPresentInContext` 用例补一条：超时回执不算回执。
- D-5 影响面声明：`action_result.success` 对器官失败改记 false，观测周报按此口径；`u3_cycle_envelope.receipt_backing.unbacked_claim` 在「查失败仍说查了」时会开始为 true——这是本单要的。

## 3 · 边界

一条规则，一处；不引入新的 Observation 字段，不引入错误分类枚举。

## 4 · 验收

- tsc clean；kernel、organ-browser、converse 三包绿。
- 落地后读数：`browser_action status:timeout|blocked_url` 对应的 `action_result.success` 应为 false；出现 `unbacked_claim:true` 的回合数（信息性）。
