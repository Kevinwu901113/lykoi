# WO-OVERLAY-WAKE-01 · 执行报告

- 执行方：主治理 Agent。分支 `wo/overlay-wake-01`，基线 `wo/outcome-01@00f12ff`（A1 复核后）。日期：2026-09-04。
- 读数：typecheck 零错误；全量测试 1084 / 1073 过 / 0 失败 / 11 跳过（基线 1074 / 1063 / 0 / 11，净增 10 例）。prompt / persona sha 测试未动，通过。

## 改动文件

| 文件 | 改动 |
|---|---|
| `packages/lykoi-decide/src/overlay.ts`（新） | D-1：`RELATIONSHIP_OVERLAY_HEADER`、`OverlayReader`、`RelationshipOverlay`、`buildRelationshipOverlay` |
| `packages/lykoi-decide/src/index.ts` | `export * from './overlay.ts'`；`BuildMessagesDeps.overlay?()`；`buildMessages` 在 acquired 之后、器官块之前非空注入；装配序注释 |
| `packages/lykoi-converse/src/prompts.ts` | 字面量改为从 `lykoi-decide` 再导出，注释说明 |
| `packages/lykoi-converse/src/conversation.ts` | `#relationshipOverlaySection` 改调 `buildRelationshipOverlay`，只剩落账；事件加 `origin:'converse'`；不再 import 头常量 |
| `packages/lykoi-wake/src/index.ts` | 新导出 `overlayMessageDep(store, logEvent)`；`messageDeps.overlay` 接上；类型 import 加 `OverlayReader` |
| `packages/lykoi-decide/test/overlay.test.ts`（新） | 渲染四分支 + 装配三例（不给闭包 / 空 / 非空段位） |
| `packages/lykoi-wake/test/overlay.test.ts`（新） | 闭包三例（非空 injected、空态零事件、读失败 read_failed） |

## D 落点

- D-1：`overlay.ts:22-62`。四分支与 converse 旧实现逐字等价；converse 既有 D-5 三条测试（`assemble.test.ts:76-165`）未改断言，通过。
- D-2：`decide/src/index.ts` `buildMessages` overlay 注入；`wake/src/index.ts` `overlayMessageDep` + `messageDeps.overlay`。
- D-3 缓存：overlay 段在 system 前缀内、器官块之前。变化频率 = `promotedRelationshipInsights` 的写入点 = L4 relationship 转正（`lykoi-learn/src/l4.ts:699` 键控落库，随夜间整合），与 acquired（persona/preference insights）同为整合期写入。overlay 变化不比 acquired 更频繁。

## 偏离

- 无新增事件类型；既有两个事件加 `origin` 字段（converse 侧 `'converse'`、wake 侧 `'wake'`）。gate 词汇不需改。
- `overlayMessageDep` 导出为独立函数以便单测，不改 `wakeOnce` 签名。

## `grep -rn RELATIONSHIP_OVERLAY_HEADER packages/*/src`

```
packages/lykoi-converse/src/prompts.ts:117:export { RELATIONSHIP_OVERLAY_HEADER } from 'lykoi-decide'
packages/lykoi-decide/src/overlay.ts:22:export const RELATIONSHIP_OVERLAY_HEADER
packages/lykoi-decide/src/overlay.ts:61:  return { text: RELATIONSHIP_OVERLAY_HEADER + lines.join('\n'), ... }
```

## 落地

无迁移、无 env。重签 manifest 涉及 lykoi-decide、lykoi-converse、lykoi-wake。落地后首个 wake 拍若 owner 有 active relationship 行，审计出现 `relationship_overlay_injected{origin:'wake'}`。
