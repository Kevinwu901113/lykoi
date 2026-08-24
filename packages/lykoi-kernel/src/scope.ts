/**
 * 授权范围键（kernel/scope.py 逐字对拍；WO-P2-S2 / approval_model_v1 §2；SK-69）。
 *
 * "批准一次，到底记住了什么？"常设授权从不挂在裸动作**类型**上 —— 那会把一句
 * "可以"变成"以后给任何人发消息"。它挂在**scope key** 上：动作触及对象的最窄
 * 标识。`scopeKey` 是那张映射唯一的家。
 *
 * 完整映射（含退化兜底）：
 *
 *  | action type                       | scope key                                  |
 *  |-----------------------------------|--------------------------------------------|
 *  | messenger.send                    | 收件人身份 — (channel, context_id) 在       |
 *  |                                   | identity_bindings 有绑定时 `user:<user_id>`,|
 *  |                                   | 否则 `channel:<channel>:<context_id>`       |
 *  | browser.navigate                  | 目标 URL 的 `domain:<eTLD+1>`               |
 *  | research_browser.open             | 目标 URL 的 `domain:<eTLD+1>`               |
 *  | terminal.exec / delegation.dispatch | null — 硬门，永不可 scope                 |
 *  | 其余有副作用者                     | `type:<action_type>`（退化键）              |
 *
 * 三条纪律（approval_model_v1 §2；此处与 kernel/approval 共同强制）：
 *  1. **默认最窄** —— 歧义向更窄的键解析：eTLD+1 切分器拿不准时多留一层标签
 *     （更窄的域），未绑定收件人停在 per-channel 键，绝不塌进更粗的桶。
 *  2. **只能收紧不能放宽** —— approval.check 只在不可变核已把决定交给 live
 *     文件的位置咨询 scoped grant；它永远抬不动 hard "ask" 或能力 "deny"。
 *  3. **可撤销** —— 每个键是普通字符串、一授权一行；见 approval.revokeStanding。
 */
import { logEvent } from './telemetry.ts'

/** scope key 取目标 URL 注册域的动作类型。 */
export const DOMAIN_SCOPED: ReadonlySet<string> = new Set([
  'browser.navigate',
  'research_browser.open',
])

// 永不可携带常设授权的动作类型。与不可变核经 approval.isHardGated 保持同拍 ——
// 本集合只是那个事实的 *scope* 侧（没有键可记），不是第二个策略源。
//
// WO-GW-01 ④ 加入 delegation.dispatch：与 terminal.exec 同源但更硬 —— 工单明写
// "她发起委托必须过审批，**无免询路径**"。默认分级已是 ask，但退化键
// `type:delegation.dispatch` 会让 grantStanding 写下常设授权 —— 那就是一条免询
// 路径。列入不可 scope 后 resolveScopeKey 返回 null，于是 grantStanding 拒绝
// 出具、scoped 匹配永远落空。真正不可变的那一层是 policy core 的
// HARD_ASK_TYPES（活体取证已含 delegation.dispatch —— SK-68 免询封堵三件套）。
export const UNSCOPABLE: ReadonlySet<string> = new Set([
  'terminal.exec',
  'delegation.dispatch',
])

/** params 未指名通道时消息落的通道（现存唯一 messenger 传输 = Telegram 设备）。 */
export const DEFAULT_CHANNEL = 'telegram'

// 实践中所见的两级公共后缀。**不是**完整 Public Suffix List：vendor/拉取会引入
// 新依赖。下面的判定因此在拿不准时**多留标签**（更窄的键）—— 纪律 1。漏一条的
// 代价是多问一次；它永远放不宽一条授权。
const _MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.tw', 'com.hk', 'com.sg',
  'co.in', 'net.in', 'org.in', 'co.nz', 'org.nz', 'ac.nz', 'govt.nz',
  'co.za', 'org.za', 'com.ua', 'com.pl', 'com.ru', 'co.il', 'com.my',
])

// 两字母 ccTLD 前几乎总标注注册级而非可注册名的二级标签（"something.co.uk"）。
// 经典启发式：让上表漏掉的条目仍解析到**更窄**的键，而不是把 "co.uk" 发出去
// 当 scope。
const _REGISTRY_SLDS: ReadonlySet<string> = new Set([
  'co', 'com', 'net', 'org', 'edu', 'gov', 'mil', 'ac', 'or', 'ne', 'go',
  'govt', 'sch', 'gob', 'nom', 'info', 'biz',
])

/**
 * host 的 eTLD+1（"注册域"），小写。近似、刻意偏窄：未识别后缀取末两标签
 * （普通情形）；后缀像注册级（表或启发式）时保留三标签。IP 字面量或单标签
 * host 原样返回 —— 没有更窄的可退。
 */
export function registeredDomain(host: string): string {
  let h = (host || '').trim().toLowerCase().replace(/\.+$/, '')
  // 任何冒号都意味着 IPv6 字面量 —— URL 里带括号写的，或 hostname 摘出来的裸
  // 形态。整体返回：对 ::ffff:1.2.3.4 这类 IPv4-mapped 形态做标签切分会得到
  // 无意义的 "3.4"，两个无关地址就会共享一个 scope key。
  if (h.includes(':')) return h
  const labels = h.split('.').filter((label) => label)
  if (labels.length <= 2) return labels.join('.')
  if (labels.every((label) => /^\d+$/.test(label))) return h // IPv4 字面量——不是域名
  const lastTwo = labels.slice(-2).join('.')
  const isRegistryLevel
    = _MULTI_LABEL_SUFFIXES.has(lastTwo)
    || (labels[labels.length - 1]!.length === 2 && _REGISTRY_SLDS.has(labels[labels.length - 2]!))
  return (isRegistryLevel ? labels.slice(-3) : labels.slice(-2)).join('.')
}

/**
 * urlsplit().hostname 的等价读法：'://' 缺席时按 `//url` 解析 netloc；去
 * userinfo、去端口、IPv6 去括号、小写。解析不出即空串（→ 无键 → 停在 ask，
 * 方向 = 不放宽）。
 */
function hostnameOf(url: string): string {
  let rest = url
  const schemeIdx = rest.indexOf('://')
  if (schemeIdx !== -1) rest = rest.slice(schemeIdx + 3)
  // netloc 止于第一个 / ? #
  const end = rest.split(/[/?#]/, 1)[0] ?? ''
  // userinfo 止于最后一个 @
  const at = end.lastIndexOf('@')
  let authority = at === -1 ? end : end.slice(at + 1)
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    return close === -1 ? '' : authority.slice(1, close).toLowerCase()
  }
  const colon = authority.indexOf(':')
  if (colon !== -1) authority = authority.slice(0, colon)
  return authority.toLowerCase()
}

function domainKey(params: Record<string, unknown>): string | null {
  const url = params.url ?? params.target ?? ''
  if (typeof url !== 'string' || !url.trim()) return null
  const host = hostnameOf(url)
  const domain = registeredDomain(host)
  return domain ? `domain:${domain}` : null
}

/**
 * identity_bindings 读点的注入位（Python 侧是 mind.store 的模块级 import；新体
 * kernel 是零依赖库模块，读点由接线方注入 —— lykoi-wake / lykoi-converse 的
 * apply 把 rw 层的 identityBindingUserId 递进来）。未注入 = 无绑定可查 →
 * 收窄到 channel 键（方向 = 不放宽）。
 */
export type IdentityBindingLookup = (channel: string, channelKey: string) => string | null

let _bindingLookup: IdentityBindingLookup | null = null

export function setIdentityBindingLookup(fn: IdentityBindingLookup | null): void {
  _bindingLookup = fn
}

/**
 * 收件人身份。绑定过的收件人塌到稳定 `user_id`（同一个人换个 chat id 还是同一
 * scope）；未绑定的钉死在触达他的那个 channel 键上。
 */
function messengerKey(params: Record<string, unknown>): string | null {
  const contextId = params.context_id
  if (contextId === null || contextId === undefined || contextId === '') return null
  const channel = (typeof params.channel === 'string' && params.channel) || DEFAULT_CHANNEL
  const channelKey = String(contextId)
  let userId: string | null = null
  if (_bindingLookup !== null) {
    try {
      userId = _bindingLookup(channel, channelKey)
    } catch (exc) {
      // 读不到绑定库不许放宽键（降级不放宽）：停在更窄的 channel 键。
      logEvent('scope_binding_lookup_failed', {
        channel,
        error: exc instanceof Error ? exc.message : String(exc),
      })
      userId = null
    }
  }
  if (userId) return `user:${userId}`
  return `channel:${channel}:${channelKey}`
}

/**
 * 这个动作最窄的常设授权键，或 null —— 动作永不可携带（硬门），或键无法从
 * params 确定（畸形请求 —— 退到更粗的键违反纪律 1，所以什么都不返回，动作
 * 停在 "ask"）。
 */
export function scopeKey(actionType: string, params: Record<string, unknown> | null = null): string | null {
  const p = params ?? {}
  if (UNSCOPABLE.has(actionType)) return null
  if (actionType === 'messenger.send') return messengerKey(p)
  if (DOMAIN_SCOPED.has(actionType)) return domainKey(p)
  return `type:${actionType}`
}
