# WO-FIX-ORGANOK-01 · 收工报告

- 执行：opus 执行子 Agent，2026-09-04 01:40–01:50 CST（report.md 由主治理 Agent 代写入库：子代理被 harness 禁止写 report 文件，内容按原报告照录）
- 分支 `wo/fix-organok-01` tip 9693a54（基于 main@4aec35f）；两提交：36f46be D-1、9693a54 D-4
- tsc `--noEmit -p .`：净
- lykoi-kernel 205/205/0/0；lykoi-organ-browser 67/67/0/0；lykoi-converse 128/127/0/1（既有 skip）
- 根目录全量：1031 / 1020 / 0 / 11
- 改动：`packages/lykoi-kernel/src/dispatch.ts`（+22）、`packages/lykoi-kernel/test/dispatch.test.ts`（+93）、`packages/lykoi-organ-browser/test/plugin.test.ts`（+40/-1）、`packages/lykoi-converse/test/contract.test.ts`（+16）

## D-1 落点

`dispatch.ts` `_executeDecision` 内 handler try/catch 之后、原成功返回之前（389–410 行）：返回值是 plain object 且 `ok === false` → `{success:false, data: redactObj(data), error: data.error 为串则 redact 后用之，否则 'organ_failed'}`。抛错路径、`ok:true`、无 `ok` 字段、数组/标量返回值逐字节不变。注释说明缘由（红线 #5 返回不抛；白皮书 37.8 回执背书）。

## D-4 测试

- kernel：ok:false → success:false 且 data 整体保留 / error 取自 data.error / 缺失或非串 → 'organ_failed' / error 与 data 同过 redact / ok:true、无 ok、数组三路成功不变 / 抛错路径不变 / 审计 `action_result.success` 记 false（D-5 影响面）。
- organ-browser：假 driver 回 timeout → 真宿主 → 真 client → 真 handler → 真 dispatch，Observation.success false、error 为 timeout、data.detail 保留。
- converse：`receiptsPresentInContext` 补一条器官超时回执真实形状 `{success:false, data:{ok:false,error,detail}, error}` → 不算回执。源码零改动。

## 与工单的偏差（两处）

1. `error` 串过 `redact()`：工单写直接用 `data.error`；data 已过 `redactObj`，顶层 error 不遮等于开口子绕过 SK-05/SK-10。已配红测钉住。
2. converse 用例：工单允许「已有等价则跳过」，仍补一条写下器官超时回执的完整真实形状作为下游锚点。

## 顺带发现、未动

- 已接线的 kernel handler 中只有 organ-browser 的 `createOrganHandler` 会返回 `ok`；adapter-telegram transport 与 organ-browser driver/ssrf 的 `{ok:false}` 是包内部返回值，不经 ResourceRegistry。本单无误伤面。将来若有器官用 `ok:false` 表达「成功但结果为否」会被记失败，当前无此形态。
- `unwiredResources()` 替身 handler 走抛错路径，不受影响；`notify.owner` 节流返回不带 `ok`，走成功路径（已加测试）。
- organ-browser 那条集成用例在用例内就地设了四个 `LYKOI_*` state env 指向 tmp（该包没有 kernel 那样的隔离夹具）。以后若再加走 dispatch 的用例，值得提成夹具函数。
