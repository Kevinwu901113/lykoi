# WO-OVERLAY-WAKE-01 · relationship overlay 进自主唤醒装配

- 状态：**已执行，待 Kevin 合并**。执行方：主治理 Agent（Kevin 2026-09-04 改令：不再派 GPT）；裁定：Kevin。
- 立单：2026-09-04，主治理 Agent。
- 依据：`governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md` 第 8 条（只读文本层 relationship overlay 只进对话不进 wake）与 §六.4；`governance/docs/persona_layering_design_v1_2026-09-01.md` §3.4（场景化表达 → overlay）；WO-PERS-OVERLAY-01 D-5（overlay 段的零字节口径）。
- 基线：WO-OUTCOME-01 合并后的 main（与本单无代码交集，先后皆可；若与 WO-CONTINUATION-01 同期，本单先做，体量小）。分支 `wo/overlay-wake-01`。
- 包：lykoi-decide（`buildMessages` 装配加一段；overlay 渲染函数落这里作唯一真源）；lykoi-converse（改调 decide 的渲染函数，行为逐字节不变）；lykoi-wake（`messageDeps` 加一个读闭包）。memory / kernel / gate / profile / 迁移 / env 零改动。

## 0 · 执行方入场须知

- 命令：`npm run typecheck`、`npm test`。单包：`npm test -w packages/lykoi-decide`。
- 不许新增配置键、环境变量或旋钮（GK-6）。
- 隐私 D-08：本单新增的审计行只带 count / subject_user_id / origin。新增事件类型须登记 gate D-08 类（本单沿用既有事件名 `relationship_overlay_injected` / `relationship_overlay_read_failed`，不新增类型，但字段加 `origin`）。
- **提示词钉**：对话路径 persona 头的字节形态不变（`lykoi-converse/test/assemble.test.ts` 的 overlay 位置断言与 `RELATIONSHIP_OVERLAY_HEADER` 38 字钉一字不动通过）；wake 路径 overlay 行为空时装配逐字节回到本单之前（既有 wake / decide fixture 测试不改断言）。
- 产物：分支提交 + `governance/wo/WO-OVERLAY-WAKE-01/report.md`。不合并、不 push main、不碰产线。

## 1 · 根因（现状事实）

| 现象 | 位置 | 事实 |
|---|---|---|
| overlay 只进对话 | `lykoi-converse/src/conversation.ts:434-435, 480-501` `#relationshipOverlaySection` | subject = `store.ownerPrimaryUserId()`，行 = `store.promotedRelationshipInsights(subject)`，非空才注入 `RELATIONSHIP_OVERLAY_HEADER + lines`；读失败一条事件 + 零字节。 |
| wake 装配无此段 | `lykoi-decide/src/index.ts:498-510` `buildMessages`；`lykoi-wake/src/index.ts:552-560` `messageDeps` | `messageDeps` 只有 persona / acquired / organBlock；acquired 非空才注入，organBlock 紧随其后。 |
| 标题常量在 converse | `lykoi-converse/src/prompts.ts:110-115` | `RELATIONSHIP_OVERLAY_HEADER`（含尾 `\n`；chars=38），测试钉在 converse。 |
| 同一个 persona 内核两路共用 | SA-154 | 对话与 wake 用同一个 `buildPersonaKernel`；acquired 也共用 `buildPersonaPrompt`。overlay 是唯一只在一路的慢变层。 |

后果：她独处时（proactive contact、关切推演）看不到"和 owner 相处的方式"，而这层的内容正是对谁说话时用的。

## 2 · 决定

### D-1 渲染函数唯一真源移到 decide

`packages/lykoi-decide/src/persona.ts`（或新文件 `overlay.ts`，执行方定，report 写出）：

```ts
export const RELATIONSHIP_OVERLAY_HEADER = <逐字节与 converse 现值相同>
export interface OverlayReader {
  ownerPrimaryUserId(): string | null
  promotedRelationshipInsights(subject: string): RawRowLike[]
}
export function buildRelationshipOverlay(store: OverlayReader): { text: string; count: number; subject: string | null; error?: string }
```

规则与 converse 现实现逐字：subject 为 null → 零字节；读失败 → `error` 字段 + 零字节；空行过滤；`- ` 前缀；非空才带标题。函数本身不落审计，调用方落。

`lykoi-converse/src/prompts.ts` 的 `RELATIONSHIP_OVERLAY_HEADER` 改为从 decide 再导出（`export { RELATIONSHIP_OVERLAY_HEADER } from '@lykoi/decide'` 或仓库现行的包引用写法），converse 的 38 字钉测试不动。`#relationshipOverlaySection` 改调 `buildRelationshipOverlay`，审计事件与字段照旧，另加 `origin: 'converse'`。

### D-2 wake 装配加段

`buildMessages` 的 `MessageDeps` 加可选 `overlay?: () => string`。非空才注入，位置 **acquired 之后、organBlock 之前**（与对话路径"转正结论 → overlay"的层序一致：wake 的 acquired 已含转正投影）。不给 `overlay` → 装配逐字节不变。

`lykoi-wake/src/index.ts` `messageDeps` 加：

```ts
overlay: () => {
  const r = buildRelationshipOverlay(store)
  if (r.error) logEvent('relationship_overlay_read_failed', { error_type: r.error, origin: 'wake' })
  else if (r.count > 0) logEvent('relationship_overlay_injected', { count: r.count, subject_user_id: r.subject, origin: 'wake' })
  return r.text
},
```

wake 的 `store` 类型需满足 `OverlayReader`（`ownerPrimaryUserId` / `promotedRelationshipInsights` 都在 `lykoi-memory/src/rw.ts:1092, 2255`）；若 wake 的 store 类型窄，只扩类型不改实现。

### D-3 缓存位置说明（report 必写）

overlay 段在 system 前缀内、organBlock 之前。`llm_cache_observability_plan` 口径：system 前缀任何一段变化 = 该点之后缓存全失。overlay 行只在 L4 转正时变（慢变），与 acquired 同频；执行方在 report 写出"overlay 变化频率 ≤ acquired 变化频率"的依据（`promotedRelationshipInsights` 的写入点）。

## 3 · 边界

- 不改 overlay 的产生（L4）、不改 `promotedRelationshipInsights` 语义、不改 subject 取法。
- 不改对话路径的字节形态。
- 不改 wake 其它装配段与推演/回流。
- 不加任何事件类型；不加旋钮。

## 4 · 验收

1. typecheck 零错误；全量测试零失败；converse 38 字钉与 assemble 层序断言一字不动通过；decide/wake 既有 fixture 断言不改。
2. decide：`buildMessages` 三例：无 `overlay` 闭包 → 与旧装配逐字节相同；闭包返回空 → 逐字节相同；闭包非空 → 段在 acquired 之后、organBlock 之前，内容逐字。
3. decide：`buildRelationshipOverlay` 四例：subject null / 读抛错 / 空行 / 正常，与 converse 旧实现的四个分支逐字节等价（把 converse 旧实现的测试期望搬过来对拍）。
4. wake：装 fake store 两例：有 overlay 行 → system 含段且 `relationship_overlay_injected{origin:'wake'}`；无行 → 零字节零事件。
5. converse：既有 overlay 测试全过，事件多一个 `origin:'converse'` 字段。
6. report：D-1～D-3 落点、两路 `grep -rn RELATIONSHIP_OVERLAY_HEADER packages` 清单（应只剩 decide 定义 + converse 再导出 + 测试）、测试计数、缓存说明。
