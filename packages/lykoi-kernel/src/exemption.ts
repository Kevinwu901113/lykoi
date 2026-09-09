export const EXEMPT_ACTION_TYPES: ReadonlySet<string> = new Set(['messenger.send'])

const SECRET = Symbol('lykoi-exemption')

export type ExemptionCategory = 'E1' | 'E2' | 'E3'

export class Exemption {
  readonly category: ExemptionCategory
  /** E2 专属：盖章时的对端 context id（空串抬成 null → 必然落空）。 */
  readonly peerContextId: string | null

  constructor(secret: symbol, category: ExemptionCategory, peerContextId: string | null) {
    if (secret !== SECRET) {
      throw new TypeError('Exemption can only be created via its factory functions')
    }
    this.category = category
    this.peerContextId = peerContextId
  }
}

/** E1：审批机制自身的通信。 */
export function approvalMachinery(): Exemption {
  return new Exemption(SECRET, 'E1', null)
}

/** E2：在场对话应答 —— 只在设备层盖（对端是谁在那里是结构事实）。 */
export function inPresenceReply(peerContextId: string): Exemption {
  const peer = typeof peerContextId === 'string' && peerContextId ? peerContextId : null
  return new Exemption(SECRET, 'E2', peer)
}

/** E3（D-07）：已在上游收过预算的投递线。 */
export function upstreamBudgetedDelivery(): Exemption {
  return new Exemption(SECRET, 'E3', null)
}

/**
 * 判定（policy_exemption.covers 对应物 + E3；纯函数，永不抛，默认 False）：
 *  1. 非 Exemption 实例 → false（字符串/字典/null 一律伪造不出来）；
 *  2. action_type 不在豁免面 → false（工具动作不因伴随应答而降级）；
 *  3. E1 / E3 → true；
 *  4. E2 → 必须有 peerContextId，且 params.context_id **精确字符串相等**。
 */
export function covers(
  actionType: string,
  params: Record<string, unknown>,
  exemption: unknown,
): boolean {
  if (!(exemption instanceof Exemption)) return false
  if (!EXEMPT_ACTION_TYPES.has(actionType)) return false
  if (exemption.category === 'E1' || exemption.category === 'E3') return true
  if (exemption.peerContextId === null) return false
  return params.context_id === exemption.peerContextId
}

export function label(exemption: unknown): string | null {
  return exemption instanceof Exemption ? exemption.category : null
}
