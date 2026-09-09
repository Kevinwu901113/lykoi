export type LogEvent = (name: string, fields: Record<string, unknown>) => void

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type CompletionFn = (messages: ChatMessage[]) => Promise<{ content: string | null }>

/** 身份守卫所需的 persona 面（结构子集；全量 PersonaConfig 在 lykoi-decide）。 */
export interface PersonaLike {
  identity: { name: string }
  relationship: { partner: string }
}

export type RawRow = Record<string, unknown>

export function pyIso(moment: Date): string {
  const iso = moment.toISOString()
  const head = iso.slice(0, 19)
  const ms = moment.getUTCMilliseconds()
  const frac = ms === 0 ? '' : `.${String(ms).padStart(3, '0')}000`
  return `${head}${frac}+00:00`
}

export function extractJsonOrNull(content: string | null | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content ?? '')
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function cpSlice(s: string, n: number): string {
  const cps = [...s]
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

export function pyStrOrEmpty(v: unknown): string {
  if (v === null || v === undefined || v === '' || v === 0 || v === false) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

export function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

export function parseWeight(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new TypeError('concern weight must be a finite number in [0, 1]')
  }
  return v
}

export function errStr(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc)
}

export const LINEAGE_PRODUCT_INSIGHT = 'insight'
export const LINEAGE_PRODUCT_CONCERN = 'concern'
export const LINEAGE_PRODUCT_SUGGESTION = 'rule_suggestion'
export const LINEAGE_SOURCE_EXPERIENCE = 'experience'
export const LINEAGE_SOURCE_CONCERN = 'concern'
export const LINEAGE_SOURCE_INSIGHT = 'insight'

export const RELATIONSHIP_INSIGHT_CATEGORY = 'relationship'
