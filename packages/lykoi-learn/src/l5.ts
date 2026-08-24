/**
 * lykoi-learn/l5 — 规则建议队列的入队侧（mind/suggestions.py 对应物；SA-141..147/
 * SA-152；学习层 v2 §3.5/§3.8）。
 *
 * §3.8 的门是一道阶梯，四级从松到紧（suggestions.py:3-8 逐字）：
 *   1. 叙事/情绪连续性——连续性门，照旧；
 *   2. insights——影子期 S=2 未被 contested 则自动转正，**不经本队列**；
 *   3. procedures 的 reliability——单写者，照旧；
 *   4. **产物影响她自己的权限边界**——必须问 Kevin，永不自动。
 *
 * 第 4 级就是本模块。它是整个学习层里唯一一处"她想到了一件事，但这件事她自己
 * 一步也不能走"的地方，所以这里的规矩比别处都硬：
 *
 * **铁律（SA-141）——落笔永远是 Kevin 的 root 会话。** 本模块没有任何一行写
 * approval_rules.json，没有 import 任何审批件，也没有任何路径去调 write_standing。
 * 她可以观察"这类事 Kevin 总是批准"、可以把这个观察排进队列、可以在他点头之后
 * 把"该怎么落笔"写清楚——但那一笔本身，只能是他在 root 会话里落下的。这不是
 * 一条可以为了顺手而放宽的工程约定：一个能改自己权限的系统，它的权限边界就不
 * 是边界了。新体钉法（学 heart 的 G-2 零依赖钉法，更硬于活体）：
 *   · 类型层——SuggestStore 接口只有 enqueueRuleSuggestion + recordLineage 两个
 *     方法，别的写口在类型上就不存在；
 *   · import 面——boundary.test.ts 静态扫描：本文件（与全包 src）import 不含
 *     approval/messenger/fs 类说明符，源码零 write_standing / approval_rules 引用。
 *
 * **为什么入队侧与问答侧分成两个模块**（suggestions.py:21-25）：层 2 的安全边界
 * 不许碰 messenger；本模块被 focus 直接调用，必须留在同一条线内——它只碰 store
 * 与日志，一个字都不知道 messenger 的存在。往外问的那一半
 * （kernel/suggestion_conversation.py：QUESTION_TEMPLATE / ANSWER_* prompts /
 * maybe_ask_owner 七状态）按规格归属 kernel 对话面——它 import messenger、
 * policy_exemption、dispatch 上下文，那些器官 M3 才长出来——**本波只实现队列侧，
 * 问答侧留 M3/W5**（store 层的状态机 pending→asked→…已在 lykoi-memory/rw 备好）。
 *
 * **队列空转时零副作用、零 LLM 调用**：本模块只在有东西可建议时写一行，没有
 * 任何后台任务、没有任何定时器、不发一次模型调用。
 */
import {
  LINEAGE_PRODUCT_SUGGESTION, LINEAGE_SOURCE_CONCERN, LINEAGE_SOURCE_INSIGHT,
  errStr, type LogEvent, type RawRow,
} from './shared.ts'

// --- 建议的种类（SA-143：与 _V14 的 CHECK 枚举同源） --------------------------
export const KIND_CONCERN_RELEASE = 'concern_release' // §3.5:反刍超限 → 建议释放一条关切
export const KIND_PERMISSION_RULE = 'permission_rule' // §3.8:结论触到了她自己的权限边界
export const KIND_STANDING_GRANT = 'standing_grant' //   "这类事你总是批准, 要不要常设授权"（今日无写者，枚举位子留好）

// --- 权限边界的识别口径（SA-144） ---------------------------------------------
// 一条结论算不算"影响她自己的权限边界"，由**代码**按词表判，不由 LLM 自陈。
// 理由与血缘入账口径同源（l4.applyConclusion）：自陈可以漏、可以编，而一个能
// 自己声明"我这条不算权限建议"的模型，等于这道门没有门闩。
//
// 词表宽松是有意的（suggestions.py:44-53 逐字），因为两个方向的代价不对称：
//   · 误判为权限建议（假阳性）——代价是她多问 Kevin 一句，而问他本来就是
//     这一级门的正确行为；
//   · 漏判（假阴性）——代价是一条关于她自己权限的想法悄悄留在 insights 里。
//     它今天不会造成任何生效变更（没有任何代码路径写规则文件），但它也就
//     永远不会被 Kevin 看见。
// 所以往宽了判。这是 §6.4 "拿不准往严" 在这道门上的形状。
export const PERMISSION_MARKERS: readonly string[] = [
  '审批', '权限', '授权', '预授权', '常设', '白名单', '黑名单', '放行',
  '不用问我', '不用再问', '以后都可以', '自动批准', '规则文件', '策略文件',
  'approval', 'allowlist', 'always_allow', 'always_deny', 'always_ask',
  'standing_grant', 'policy',
]

/** 建议文本进队列前的截断长度——她的结论是 LLM 产出的自由文本，最终会出现在发给 Kevin 的消息里，有界是必须的。 */
export const SUGGESTION_TEXT_CHARS = 400

/**
 * SA-142 去重键 = `种类:来源 id`。**由代码派生**，不由 LLM 给：一个模型能自己
 * 编的去重键等于没有去重（换个说法就能再问一次）。键上有 UNIQUE，所以"同一件
 * 事只排一次"是库层面的事实，不是调用方的自觉。
 */
export function dedupKey(kind: string, ref: string | number): string {
  return `${kind}:${ref}`
}

/** SA-144/145：这条结论是不是在谈她自己的权限边界（§3.8 第 4 级）。 */
export function isPermissionBoundary(text: string | null | undefined): boolean {
  if (!text) return false
  const lowered = text.toLowerCase()
  return PERMISSION_MARKERS.some((marker) => lowered.includes(marker.toLowerCase()))
}

// --- 入队 --------------------------------------------------------------------

/** L5 的 store 面：只有入队与血缘两个写口——别的写口在类型上就不存在（铁律的类型面）。 */
export interface SuggestStore {
  enqueueRuleSuggestion(opts: {
    kind: string
    dedupKey: string
    suggestionText: string
    rationale?: string
    sourceKind?: string
    sourceId?: string | number
    cycleId?: number | null
    now: Date
  }): { id: number; status: string; enqueued: boolean; reason: string }
  recordLineage(opts: {
    productKind: string
    productId: string | number
    sources: readonly (readonly [string, string | number])[]
    cycleId: number
    now: Date
  }): number
}

export interface EnqueueResult {
  id: number
  status: string
  enqueued: boolean
  reason: string
}

const cp = (s: string): string[] => [...s]
function clip(s: string, n: number): string {
  const cps = cp(s)
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

/**
 * 一条建议入队 + 它自己的血缘行（suggestions.py:83-120）。
 *
 * 血缘（§3.7）：建议本身也是一种产物（rule_suggestion），原料是它的来源产物
 * （一条关切、一条结论）——任取一条建议都能沿 product_lineage 走回具体的
 * experience id 集合，"她凭什么建议这件事"与"她凭什么得出这条结论"是同一套
 * 可审计口径。
 *
 * SA-147：**血缘失败不回滚入队**——一条记不下血缘的建议仍然是一条该问 Kevin
 * 的建议，而把它丢掉才是真的损失。失败落 telemetry，可见、可查。
 */
function enqueue(store: SuggestStore, logEvent: LogEvent, opts: {
  kind: string
  key: string
  text: string
  rationale: string
  sourceKind: string
  sourceId: string | number
  cycleId: number | null
  extraSources?: readonly (readonly [string, string | number])[]
  now: Date
}): EnqueueResult {
  const result = store.enqueueRuleSuggestion({
    kind: opts.kind, dedupKey: opts.key,
    suggestionText: clip(opts.text, SUGGESTION_TEXT_CHARS),
    rationale: clip(opts.rationale, SUGGESTION_TEXT_CHARS),
    sourceKind: opts.sourceKind, sourceId: opts.sourceId,
    cycleId: opts.cycleId, now: opts.now,
  })
  if (result.enqueued && opts.cycleId) {
    const sources: (readonly [string, string | number])[] = [[opts.sourceKind, opts.sourceId]]
    sources.push(...(opts.extraSources ?? []))
    try {
      store.recordLineage({
        productKind: LINEAGE_PRODUCT_SUGGESTION,
        productId: result.id, sources, cycleId: opts.cycleId, now: opts.now,
      })
    } catch (exc) {
      logEvent('rule_suggestion_lineage_failed', {
        suggestion_id: result.id, error: errStr(exc),
      })
    }
  }
  return result
}

/**
 * §3.5 的"建议释放"（suggestions.py:123-151）：一条关切反复深挖不出东西、累计
 * 冷却超阈值 → 入队。**释放本身一步都没往前走**（红线 #3：释放只属于整合期的
 * 她或 owner 后门）——她排的是一句话，不是一个动作；哪怕 Kevin 说"好"，本模块
 * 也不会去释放它：接受路径的产物是一段给他看的执行说明，不是一次执行。
 */
export function suggestConcernRelease(store: SuggestStore, logEvent: LogEvent, opts: {
  concern: RawRow
  cycleId: number
  cooldownCount: number
  now: Date
}): EnqueueResult {
  const concern = opts.concern
  const text = `我在「${concern.title}」上反复想了很多轮都没有新东西 `
    + `(已经强制冷却 ${opts.cooldownCount} 次)。要不要把这条关切放掉?`
  const rationale = `concern #${concern.id} · origin=${concern.origin} · `
    + `lit_count=${concern.lit_count} · cooldowns=${opts.cooldownCount}`
  return enqueue(store, logEvent, {
    kind: KIND_CONCERN_RELEASE,
    key: dedupKey(KIND_CONCERN_RELEASE, concern.id as number),
    text, rationale,
    sourceKind: LINEAGE_SOURCE_CONCERN, sourceId: concern.id as number,
    cycleId: opts.cycleId, now: opts.now,
  })
}

/**
 * §3.8 第 4 级（suggestions.py:154-186）：一条**触到她自己权限边界**的结论，
 * 只入队，绝不直接生效。"绝不直接生效"是双重的：
 * 1. 结构上——本模块（与它调用的 store 那一节）没有写规则文件的路径，所以
 *    "生效"这个动作在代码里根本不存在，不是被某个 if 拦住了；
 * 2. 门上——这条结论作为 insight 仍走它自己的影子期（SA-146 硬约束 2：S=2 自动
 *    转正不经本队列），但转正只让它成为"她认可的一句话"，与任何权限变更无关。
 */
export function suggestPermissionRule(store: SuggestStore, logEvent: LogEvent, opts: {
  insightId: number
  conclusion: string
  concernId?: number | null
  cycleId: number
  now: Date
}): EnqueueResult {
  const text = opts.conclusion.trim()
  const concernId = opts.concernId ?? null
  const rationale = `insight #${opts.insightId}`
    + (concernId !== null ? ` · concern #${concernId}` : '')
    + ' · 触及权限边界, 按 §3.8 只能问 Kevin'
  const extra: (readonly [string, string | number])[]
    = concernId !== null ? [[LINEAGE_SOURCE_CONCERN, concernId]] : []
  const result = enqueue(store, logEvent, {
    kind: KIND_PERMISSION_RULE,
    key: dedupKey(KIND_PERMISSION_RULE, opts.insightId),
    text, rationale,
    sourceKind: LINEAGE_SOURCE_INSIGHT, sourceId: opts.insightId,
    cycleId: opts.cycleId, extraSources: extra, now: opts.now,
  })
  logEvent('rule_suggestion_permission_gated', {
    insight_id: opts.insightId, cycle_id: opts.cycleId,
    enqueued: result.enqueued, reason: result.reason,
  })
  return result
}

// --- 接受之后：给 Kevin 的 root 会话看的执行说明（SA-152） --------------------
// 这是"她能做到的最远处"。不是补丁、不是待执行的命令、不经 guardian——一段
// 存在表里的文本，他读了之后自己决定落不落笔。

const HOWTO: Readonly<Record<string, string>> = {
  [KIND_CONCERN_RELEASE]:
    '释放一条关切走 owner 后门(mind console 的释放路径),'
    + '理由建议照抄上面的原话。她自己没有释放关切的路径。',
  [KIND_PERMISSION_RULE]:
    '若要落实, 由你在 root 会话里改 guardian 侧的审批规则 —— '
    + '这是唯一的落笔处。她这边不存在写规则文件的代码路径, '
    + '所以这条建议在你动手之前对系统没有任何影响。',
  [KIND_STANDING_GRANT]:
    '常设授权的落笔处是 root 会话下的审批规则 + standing grants 台账。'
    + '落之前请对着 approval_model_v1 §5.1 的回顾清单看一眼范围。',
}

/**
 * SA-152：逐字迁（mind/suggestions.py:209-216）。chars=240，
 * sha256=c4d946b5e3814e2cbfc98e83310ad4e4958ce1c33ecdac6e821e44801d8780af
 * （prompt.test.ts 常驻对拍）。要害在末行：在他落笔之前，系统里什么都没有变。
 */
export const STAGED_TEMPLATE = `[规则建议 #{sid} · 你已经同意 · 等你在 root 会话落笔]
建议: {text}
来源: {source_kind} {source_id} ({rationale})
血缘: product_lineage where product_kind='rule_suggestion' and product_id='{sid}'
你的原话: {answer}

怎么落: {howto}
在你落笔之前, 系统里什么都没有变 —— 她没有、也不会有写审批规则的路径。`

/**
 * 把一条被接受的建议渲染成给 Kevin 的执行说明。纯文本，**零副作用**。
 * 单遍替换（Python str.format 口径）：占位符只在模板里找，代入值不再被扫描
 * ——建议正文是 LLM 自由文本，它自带的花括号不许变成第二轮展开。
 */
export function stagedInstructions(row: RawRow, opts?: { answerText?: string }): string {
  const fields: Record<string, string> = {
    sid: String(row.id),
    text: String(row.suggestion_text),
    source_kind: String((row.source_kind as string) || '?'),
    source_id: String((row.source_id as string) || '?'),
    rationale: String((row.rationale as string) || ''),
    answer: clip((opts?.answerText ?? '').trim(), 200),
    howto: HOWTO[row.kind as string] ?? '由你判断。',
  }
  return STAGED_TEMPLATE.replace(
    /\{(sid|text|source_kind|source_id|rationale|answer|howto)\}/g,
    (_, key: string) => fields[key]!,
  )
}
