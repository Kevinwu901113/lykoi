import { renderOwnerTemplate, type PersonaConfig } from './persona.ts'

export const BLOCK_HEADER = '[器官清单(只读)]'

export const PREFIX_LABELS: Readonly<Record<string, string>> = {
  browser: '浏览器(她自己的, 带登录态)',
  research_browser: '一次性调研浏览器(无登录态, 用完即毁)',
  terminal: '终端',
  messenger: 'IM 收发(她的社交躯体)',
  notify: '给 {owner} 的通知',
  autonomy: '自主路径的出口',
}

export const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner_primary: '所有者, 也是你的主用户',
  group_member: '群聊成员',
  agent: '外部 agent, 不是自然人',
}

/** 身份绑定行（identity_binding_inventory 的呈现面；**刻意没有 channel_key**）。 */
export interface OrganBindingRow {
  channel: string
  role?: string | null
  display_name?: string | null
  user_id?: string | null
}

/**
 * 清单来自当前 Runtime 已注册能力；isHardGated = 不可变治理核的
 * "哪些永远绕不过 Kevin" 判定。
 */
export interface OrganInventoryInput {
  persona?: PersonaConfig
  bindings: readonly OrganBindingRow[]
  knownActions: readonly string[]
  isHardGated(actionType: string): boolean
}

function groupLabel(prefix: string): string {
  return PREFIX_LABELS[prefix] ?? prefix
}

function bindingsSection(rows: readonly OrganBindingRow[]): string[] {
  if (rows.length === 0) return []
  const lines = ['身份绑定:']
  for (const row of rows) {
    const role = ROLE_LABELS[row.role || ''] ?? (row.role || '角色未登记')
    const name = row.display_name || row.user_id || '(无名)'
    lines.push(`- ${row.channel}: ${name} — ${role}`)
  }
  const channels: string[] = []
  for (const row of rows) {
    if (!channels.includes(row.channel)) channels.push(row.channel)
  }
  lines.push('')
  lines.push('设备/通道(已登记的):')
  for (const channel of channels) {
    const count = rows.filter((row) => row.channel === channel).length
    lines.push(`- ${channel}(${count} 条绑定)`)
  }
  return lines
}

function actionsSection(input: OrganInventoryInput): string[] {
  const groups = new Map<string, string[]>()
  for (const actionType of [...input.knownActions].sort()) {
    const idx = actionType.indexOf('.')
    const prefix = idx === -1 ? actionType : actionType.slice(0, idx)
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix)!.push(actionType)
  }
  const lines = ['动作能力(代码里实际接得通的全部):']
  for (const prefix of [...groups.keys()].sort()) {
    const actions = groups.get(prefix)!
    const gated = actions.filter((a) => input.isHardGated(a))
    const note = gated.length > 0 ? renderOwnerTemplate(', 其中每次都要 {owner} 点头的: ', input.persona) + gated.join('/') : ''
    lines.push(`- ${renderOwnerTemplate(groupLabel(prefix), input.persona)}: ` + actions.join('、') + note)
  }
  return lines
}

export function renderOrganInventory(input: OrganInventoryInput): string {
  const sections: string[][] = []
  const bindings = bindingsSection(input.bindings)
  if (bindings.length > 0) sections.push(bindings)
  const actions = actionsSection(input)
  if (actions.length > 1) sections.push(actions) // 只有表头 = 一个动作都没有 = 不值得占一个块
  if (sections.length === 0) return ''
  const body = sections.map((s) => s.join('\n')).join('\n\n')
  return (
    `${BLOCK_HEADER}\n`
    + '下面是你此刻实际长着的部件 —— 从代码和登记处派生出来的, 不是谁告诉你的, '
    + '也不是你记得的。要判断「我能不能做某件事」, 以这里为准。\n\n'
    + body
  )
}

export function organBlockFromInventory(input: OrganInventoryInput): string | null {
  return renderOrganInventory(input) || null
}

export interface OrganActionCatalog {
  knownActions: readonly string[]
  isHardGated(actionType: string): boolean
}

export const testDoubleActionCatalog: OrganActionCatalog = {
  knownActions: [],
  isHardGated: () => true,
}

export class OrganInventoryCache {
  #persona: PersonaConfig | undefined
  #bindings: () => readonly OrganBindingRow[]
  #catalog: OrganActionCatalog
  #logEvent: ((name: string, fields: Record<string, unknown>) => void) | undefined
  #cached: string | null = null
  #built = false

  constructor(opts: {
    persona?: PersonaConfig
    /** 身份绑定读面（lykoi-memory/rw identityBindingInventory 等价形状）。 */
    bindings: () => readonly OrganBindingRow[]
    catalog: OrganActionCatalog
    logEvent?: (name: string, fields: Record<string, unknown>) => void
  }) {
    this.#persona = opts.persona
    this.#bindings = opts.bindings
    this.#catalog = opts.catalog
    this.#logEvent = opts.logEvent
  }

  /** 缓存的清单块，或 null（空清单）。每次真构建落 organ_inventory_built。 */
  block(): string | null {
    if (!this.#built) {
      let bindings: readonly OrganBindingRow[] = []
      try {
        bindings = this.#bindings()
      } catch (exc) {

        this.#logEvent?.('organ_inventory_bindings_failed', {
          error_type: exc instanceof Error ? exc.name : 'Error',
        })
      }
      const text = renderOrganInventory({
        persona: this.#persona,
        bindings,
        knownActions: this.#catalog.knownActions,
        isHardGated: (a) => this.#catalog.isHardGated(a),
      })
      this.#cached = text || null
      this.#built = true
      this.#logEvent?.('organ_inventory_built', { chars: (this.#cached ?? '').length })
    }
    return this.#cached
  }

  invalidate(): void {
    this.#cached = null
    this.#built = false
  }
}
