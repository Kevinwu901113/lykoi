/**
 * 策略豁免标记（kernel/policy_exemption.py 对应物；S-69..S-73 + G-10 D-07）。
 *
 * 豁免只由 **Exemption 类型**携带，从不由 params / 文本携带（S-69）：字符串
 * "E1"、字典 {category:'E1'}、null 一律伪造不出来 —— 构造函数私有，实例只能
 * 出自三个工厂。消费位置是 approval.check 的**最后一步**（M3 真 kernel），
 * 排在硬规则/能力面/always_deny 之后 —— **只能收紧，不能放宽**（S-72）；
 * 豁免免掉的是**问**，从来不是**账**（S-73：audit 行多一栏 exemption）。
 *
 * 类别：
 *  - E1 = 审批机制自身的通信（问句/撤回/回执的出站漏斗）；
 *  - E2 = 在场对话应答 —— 只能在**设备层**盖（S-79：只有那一层"对端是谁"是
 *    结构事实），收件人必须与盖章时的 peer 精确字符串相等（S-71）；
 *  - E3 = **已在上游收过预算的投递线**（G-10 D-07 修正版）：活体的
 *    `_deliver_outbox_item` 直接调 transport 绕过 dispatch —— 零 audit、零
 *    approval.check、零章，是审计闭合面上唯一的洞。新体把那条线拉回 dispatch，
 *    投递线出站盖 E3 章：预算已在上游收过（proactive_chat 账本/followup 是他
 *    自己起的任务），免的是再问一遍，账照记。投递线本体（outbox 游标机）随
 *    M3 的出站器官落地 —— 本模块先把类别与判定立好（接口位）。
 *
 * 覆盖面（S-70）：EXEMPT_ACTION_TYPES 恰 {'messenger.send'} —— 只覆盖纯文本
 * 出站；工具动作不因伴随应答而降级。
 */

export const EXEMPT_ACTION_TYPES: ReadonlySet<string> = new Set(['messenger.send'])

const SECRET = Symbol('lykoi-exemption')

export type ExemptionCategory = 'E1' | 'E2' | 'E3'

export class Exemption {
  readonly category: ExemptionCategory
  /** E2 专属：盖章时的对端 context id（空串抬成 null → 必然落空）。 */
  readonly peerContextId: string | null

  /** 私有构造（S-69）：只能经三个工厂产生；类型之外无法伪造。 */
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

/** 审计栏（S-73）：非标记记 null —— 豁免免掉的是问，从来不是账。 */
export function label(exemption: unknown): string | null {
  return exemption instanceof Exemption ? exemption.category : null
}
