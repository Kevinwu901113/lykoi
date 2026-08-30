/**
 * 事件词汇表与**双通道分流**（W2 TODO#6 定案 + W3 TODO#7 的 D-08/SK-05 口径分界）。
 *
 * ## 问题
 *
 * 新体把两条本来分立的通道写进了同一个 `audit.jsonl`：
 *
 *  - **immutable 治理账**（`kernel/dispatch.ts` 显式注入的 sink）：`action_dispatch`
 *    / `action_result` / `delegation_context_invalid`。写失败 **fail CLOSED**
 *    （动作不跑）。按 SK-05 口径，`params` 的 **redacted 副本在行内**。
 *  - **遥测**（`telemetry.ts` 的 `logEvent` → `auditLogEvent` 适配器 →
 *    `audit.record({type: name, ...fields})`）。写失败**静默**（遥测永不是控制流，
 *    SK-08）。按 D-08 口径，**零正文**，只记长度/哈希/条数。
 *
 * `delegation_context_invalid` 两边都发：immutable 行八栏（含 reason/origin/
 * run_id/correlation_id），遥测行两栏（action_type/action_id）。**同名不同字段集**，
 * 落在同一个文件里。一个事后读账的人（或 M4 的迁移脚本、或她自己回看）没法只凭
 * 名字知道自己读到的是「一条永不可篡改的治理事实」还是「一条丢了也无所谓的遥测」。
 *
 * ## 定案：显式分流（**不是**字段集判别）
 *
 * 遥测适配器给每一行盖一个保留字段 `channel: 'telemetry'`。
 * 判别规则：**带 `channel:'telemetry'` ⟺ 遥测行；不带 ⟺ 特权层治理行。**
 *
 * 三条理由：
 *
 *  1. **字段集会漂，名字与盖章不会。** 「字段集判别」等于把判别依据绑在最容易
 *     变的那一样东西上 —— 今天遥测行两栏，明天有人为了排障加两栏，判别就悄悄
 *     失效，而且没有任何测试会红。盖章是一个**不变量**，加多少栏都不影响。
 *  2. **失败方向相反。** 字段集判别的失败模式是「一条遥测行被读成治理行」——
 *     朝把不可靠证据当成权威的方向错。盖章的失败模式是「盖章掉了」，那条行被
 *     读成治理行 —— 同样朝坏方向，**但它是一条可以被门当场逮住的静态事实**
 *     （见下 V3），字段集判别没有任何静态可核对面。
 *  3. **只动新体自己造的那一半。** 盖章只加在遥测适配器上，immutable 信封
 *     （SK-06/SK-11 逐字字段序）**一个字节不动**。遥测适配器是 M2 TODO#4 的
 *     新体构造物，本来就没有逐字对拍对象 —— 分流的成本正好落在没有保真负担的
 *     那一侧。
 *
 * ## 门里核对什么（三条，各有红测）
 *
 *  - **V1 声明一致**：immutable 三名逐条出现在 `kernel/src/dispatch.ts` 的
 *    `type: '…'` 字面量里（有人改名 → 红）。
 *  - **V2 碰撞自动发现**：扫全树遥测发射点，与 immutable 名集求交，交集必须
 *    **恰好等于**下面声明的 `DUAL_NAMES`（新出现一个同名双发 → 红；旧的那个被
 *    悄悄拿掉 → 也红）。这条刻意做成「算出来的」而不是「抄一张 97 行的表」：
 *    表会过期，交集不会。
 *  - **V3 盖章在位**：遥测适配器源码里 `channel: 'telemetry'` 的字面量必须在
 *    （有人顺手删掉分流 → 红）。
 *
 * 本模块 import：只有 `node:*`。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectTs } from './surface.ts'

/** 分流用的保留字段名与值。 */
export const CHANNEL_FIELD = 'channel'
export const CHANNEL_TELEMETRY = 'telemetry'

/**
 * **immutable 治理账**的全部 type（`kernel/dispatch.ts` 注入 sink 的三种行）。
 * 口径 = SK-05：`params` 的 redacted 副本在行内（「豁免免掉的是问，从来不是账」）。
 */
export const IMMUTABLE_TYPES: readonly string[] = Object.freeze([
  'action_dispatch',
  'action_result',
  'delegation_context_invalid',
])

/**
 * 已知的**同名双发**（两条通道都出现的名字）。
 *
 * `delegation_context_invalid`：拒绝路径刻意两边都发 —— immutable 那条是账
 * （「有人试图以委托身份派发却说不出是哪张合同」必须留痕，SK-04），遥测那条是
 * 给运维看的计数。两条都该在，所以这不是缺陷，是需要**被分流**的既成事实。
 */
export const DUAL_NAMES: readonly string[] = Object.freeze([
  'delegation_context_invalid',
])

/**
 * D-08 与 SK-05 的口径分界（W3 TODO#7），以词汇表形式立此存照：
 *
 * | 面 | 成员 | 口径 | 正文可否在行内 |
 * |---|---|---|---|
 * | 特权层账 | `IMMUTABLE_TYPES` 三名 | SK-05 | **可**（`redactObj` 之后的副本；她做了什么、参数在内） |
 * | 对话面账 | `converse/*`、`u3_cycle_*`、`inner_outer_pair` | D-08 | 否（只记长度/哈希；正文归 history 表 = 她的记忆） |
 * | 遥测 | 其余全部 `logEvent` 名 | D-08 同向 | 否 |
 *
 * 运行期承重面在 `lykoi-converse/test/e2e.test.ts`（「对话面 audit 行零正文」
 * 逐行断言，且显式把 `action_dispatch`/`action_result` 排除在 D-08 适用面外）。
 * 门这一层核的是**声明**：口径分界写在这里，谁想挪它得改一个 root 属主域文件。
 */
export const CONVERSATION_FACING_PREFIXES: readonly string[] = Object.freeze([
  'converse/',
  'u3_cycle_',
])
export const CONVERSATION_FACING_NAMES: readonly string[] = Object.freeze([
  'inner_outer_pair',
])

/** 遥测发射点的四种写法：`logEvent('x'` / `logEvent?.('x'` / `.logEvent(...)` / `#logEvent?.(...)`。 */
const EMISSION_RE = /logEvent(?:\?\.)?\(\s*'([a-z0-9_/]+)'/g

/** 扫一棵 `packages/<pkg>/src` 收集全部遥测事件名。 */
export function scanTelemetryNames(repoRoot: string, packages: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const pkg of packages) {
    for (const file of collectTs(join(repoRoot, 'packages', pkg, 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(EMISSION_RE)) names.add(match[1]!)
    }
  }
  return names
}

/** 遥测适配器的落址（V3 盖章检查的对象）。 */
export const TELEMETRY_ADAPTER_REL = 'packages/lykoi-wake/src/index.ts'
/** immutable 行构造处（V1 声明一致检查的对象）。 */
export const IMMUTABLE_EMITTER_REL = 'packages/lykoi-kernel/src/dispatch.ts'
