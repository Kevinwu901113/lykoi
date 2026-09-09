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
