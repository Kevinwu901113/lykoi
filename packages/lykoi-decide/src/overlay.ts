/**
 * lykoi-decide/overlay — relationship overlay 段的唯一渲染真源（WO-OVERLAY-WAKE-01 D-1）。
 *
 * 此前这段只住在 lykoi-converse（`Conversation.#relationshipOverlaySection`），
 * 于是"她和 owner 相处的方式"只在对话路径可见，独处推演（wake）看不到。
 * 本模块把渲染规则搬到 decide，与 `buildPersonaKernel` / `buildPersonaPrompt`
 * 同层：对话与 wake 两路调同一个函数，同一段字节。
 *
 * 规则（与 converse 旧实现逐字等价）：
 * - subject = `store.ownerPrimaryUserId()`；null → 零字节；
 * - 行 = `store.promotedRelationshipInsights(subject)`（= status active，影子门同口径）；
 * - 每行 trim，空行过滤，`- ` 前缀，`\n` 连接；无行 → 零字节（连标题都不出现）；
 * - 读抛错 → `error` 带异常名 + 零字节（读不到就是这一层今天不叠，不毁整轮）。
 *
 * 函数本身不落审计：事件由调用方记（converse / wake 各带 `origin`）。
 */

/**
 * relationship overlay 小标题（含尾 \n；chars=38 sha=a0553be7…）。converse 侧
 * `prompts.ts` 从这里再导出，38 字钉测试不动。
 */
export const RELATIONSHIP_OVERLAY_HEADER
  = '你和眼前这个人相处的方式(专注思考里得出、已经站住、只关于这个人的结论):\n'

export type OverlayRowLike = Record<string, unknown>

/** 渲染的读依赖（lykoi-memory/rw 的两个读口）。 */
export interface OverlayReader {
  ownerPrimaryUserId(): string | null
  promotedRelationshipInsights(subjectUserId: string): OverlayRowLike[]
}

export interface RelationshipOverlay {
  /** 装配段；零字节表示不注入。 */
  text: string
  /** 进段的行数（零字节时为 0）。 */
  count: number
  /** 键到的对话者；owner 未登记时 null。 */
  subject: string | null
  /** 读失败时的异常名（`Error.name`）；成功时缺省。 */
  error?: string
}

export function buildRelationshipOverlay(store: OverlayReader): RelationshipOverlay {
  const subject = store.ownerPrimaryUserId()
  if (subject === null) return { text: '', count: 0, subject: null }
  let rows: OverlayRowLike[]
  try {
    rows = store.promotedRelationshipInsights(subject)
  } catch (exc) {
    return {
      text: '', count: 0, subject,
      error: exc instanceof Error ? exc.name : 'Error',
    }
  }
  const lines = rows
    .map((row) => String(row.content ?? '').trim())
    .filter((content) => content.length > 0)
    .map((content) => `- ${content}`)
  if (lines.length === 0) return { text: '', count: 0, subject }
  return { text: RELATIONSHIP_OVERLAY_HEADER + lines.join('\n'), count: lines.length, subject }
}
