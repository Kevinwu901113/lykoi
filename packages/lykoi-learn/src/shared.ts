/**
 * lykoi-learn/shared — 学习环五模块的公共小件。
 *
 * 边界纪律（SA-137/SA-141 的结构面）：本包 src 的 import 面只允许
 * lykoi-regulation 与包内文件——store 一律走各模块自定义的**结构化接口**
 * （ReadWriteMemory 结构性满足之；类型层就把"层 2 拿不到调节场/叙事写口"钉死，
 * 比活体的模块纪律更强）。boundary.test.ts 静态扫描钉死这个 import 面。
 */

/** 事件注入位（形状同 lykoi-decide 的 LogEvent；此处自定义以守住 import 面）。 */
export type LogEvent = (name: string, fields: Record<string, unknown>) => void

/** LLM 注入位（integrator.py/focus.py 的 `completion` 参数对应物；测试注 fake）。 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type CompletionFn = (messages: ChatMessage[]) => Promise<{ content: string | null }>

/** 身份守卫所需的 persona 面（结构子集；全量 PersonaConfig 在 lykoi-decide）。 */
export interface PersonaLike {
  identity: { name: string }
  relationship: { partner: string }
}

/** 行原形（snake_case 列名，同 Python dict；与 lykoi-memory/rw 的 RawRow 同形）。 */
export type RawRow = Record<string, unknown>

/**
 * C-22 写侧同形的 ISO 时间戳（formatPyIso 的本地实现——重复 7 行是守住 import
 * 面的代价，等价性由测试对 lykoi-memory 的 formatPyIso 逐值断言）。
 */
export function pyIso(moment: Date): string {
  const iso = moment.toISOString()
  const head = iso.slice(0, 19)
  const ms = moment.getUTCMilliseconds()
  const frac = ms === 0 ? '' : `.${String(ms).padStart(3, '0')}000`
  return `${head}${frac}+00:00`
}

/**
 * integrator._extract_json 对应物（integrator.py:285-296 逐字姿态）：整体
 * JSON.parse，失败取首 `{` 到末 `}` 再试，两次都失败返回 **null**——与
 * lykoi-decide 的 extractJson（SA-18，失败抛错）是**两个函数**：学习环的失败
 * 必须是一条落账的降级，不是一个异常。只认对象（Python 返回 dict | None）。
 */
export function extractJsonOrNull(content: string | null | undefined): Record<string, unknown> | null {
  const text = (content ?? '').trim()
  const parse = (s: string): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(s)
      return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  const whole = parse(text)
  if (whole !== null) return whole
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    return parse(text.slice(start, end + 1))
  }
  return null
}

/** Python 字符串切片的码点口径（note[:500] 一类的有界裁剪）。 */
export function cpSlice(s: string, n: number): string {
  const cps = [...s]
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

/** Python `str(x or '')`：假值 → ''；对象在学习环信封里不进字符串位 → ''。 */
export function pyStrOrEmpty(v: unknown): string {
  if (v === null || v === undefined || v === '' || v === 0 || v === false) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/** Python `isinstance(x, int) and not isinstance(x, bool)`（JS Number.isInteger 天然排 bool）。 */
export function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/**
 * Python `max(0.0, min(1.0, float(raw)))`，raw 缺省 0.5、float() 失败也回 0.5
 * （integrator._parse_envelope 的 weight 口径）。
 */
export function parseWeight(v: unknown): number {
  let f: number | null = null
  if (v === undefined) f = 0.5
  else if (typeof v === 'number') f = Number.isNaN(v) ? null : v
  else if (typeof v === 'boolean') f = v ? 1.0 : 0.0
  else if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    f = Number.isNaN(n) ? null : n
  }
  if (f === null) f = 0.5
  return Math.max(0.0, Math.min(1.0, f))
}

/** 异常 → 事件/拒绝文本（Python str(exc) 位）。 */
export function errStr(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc)
}

// SA-131 血缘词汇（store.py:1706-1712 同源；本包持一份副本以守住 import 面，
// 与 lykoi-memory/rw 导出值的逐字相等由 boundary.test.ts 断言）。
export const LINEAGE_PRODUCT_INSIGHT = 'insight'
export const LINEAGE_PRODUCT_CONCERN = 'concern'
export const LINEAGE_PRODUCT_SUGGESTION = 'rule_suggestion'
export const LINEAGE_SOURCE_EXPERIENCE = 'experience'
export const LINEAGE_SOURCE_CONCERN = 'concern'
export const LINEAGE_SOURCE_INSIGHT = 'insight'

/**
 * WO-PERS-OVERLAY-01（D-2 修订版）：按对话者键控的相处方式结论的 insights 类别。
 * **正本在 `lykoi-memory/src/rw.ts`**；本包持副本的理由与上面六个血缘常量完全相同
 * ——守住 learn 的 import 面（boundary.test.ts:44-53："learn 的 store 面只能是注入
 * 的结构化接口"）。两处逐字相等由 boundary.test.ts 的副本对拍段断言，漂移不可能沉默。
 */
export const RELATIONSHIP_INSIGHT_CATEGORY = 'relationship'
