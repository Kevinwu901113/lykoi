/**
 * 器官清单（cognition/organs.py 移植；SA-160/161；G-7 的注入体）。
 *
 * 她每一轮都被告知自己是谁、想着什么、现在几点，却从来没有被告知**她长着什么**。
 * 本模块把答案从代码与登记处派生成一段只读文本。三条来源全部是代码/登记处派生，
 * 没有一条是人写的清单（D5 定界）：身份绑定（identity_bindings + users）、
 * 设备/通道（同一张表的 channel 维度）、动作能力（KNOWN_ACTIONS + is_hard_gated）。
 *
 * **四条禁止（SA-161，移植必须同样成立）**：
 *  1. 不写 channel_key —— 那是 Telegram 的 chat id，一个寻址标识，对"我长着
 *     什么"零信息量；把寻址标识放进每轮上下文只会让它更容易被某段不可信输入
 *     （白皮书 24 章）引用。她要发消息走 owner_channel_key 的读点，不是从
 *     prompt 里抄一个 id。本渲染器的输入行类型上就没有 channel_key 字段。
 *  2. secrets 永不进 —— 不读 os.environ、不读 *.env、不读 approval_rules.json、
 *     不碰 standing_grants；清单里连"密钥""token""api key"这些键名都不出现。
 *     本模块是纯函数，物理上没有 I/O 面。
 *  3. 不读活规则 —— "今天这条被 always_allow 了"是策略事实不是器官事实；
 *     isHardGated 必须来自不可变治理核的判定（fail closed 成 "ask" → 全表硬门，
 *     方向永远是往少了说）。
 *  4. 时效与健康不进清单 —— 通道最后一次收到事件、浏览器起没起来：易变量混进
 *     静态清单会每轮改字节、打碎前缀缓存。
 *
 * W2 形态：纯渲染器 + 数据输入接口位（M1 尚无 kernel.dispatch/identity 登记面
 * 可直读）。TODO(M2-W5): 接真实来源（mind.store.identity_binding_inventory +
 * kernel dispatch 的 KNOWN_ACTIONS 对应物 + is_hard_gated）、进程级缓存
 * build_organ_block（SA-160：空清单 → null；invalidate 零读；每次构建落
 * organ_inventory_built 事件；读不到登记处落 organ_inventory_bindings_failed
 * 而不毁一轮对话）。
 */

export const BLOCK_HEADER = '[器官清单(只读)]'

/**
 * 动作前缀 → 给她看的人话（organs.py:53-60 逐字）。清单按前缀分组，因为
 * "我有没有浏览器"是器官级问题，browser.navigate / browser.click 是同一个
 * 器官的不同用法。未登记的前缀不丢弃 —— groupLabel 兜底返回 prefix 本身，
 * 新器官接进来时清单自己会长。
 */
export const PREFIX_LABELS: Readonly<Record<string, string>> = {
  browser: '浏览器(她自己的, 带登录态)',
  research_browser: '一次性调研浏览器(无登录态, 用完即毁)',
  terminal: '终端',
  messenger: 'IM 收发(她的社交躯体)',
  notify: '给 Kevin 的通知',
  autonomy: '自主路径的出口',
}

/** 角色 → 人话（organs.py:62-67 逐字；users.role 取值域由 migrations CHECK 钉死）。 */
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
 * 清单的三条数据来源（接口位，W5 接线）。knownActions = kernel dispatch 的
 * KNOWN_ACTIONS 等价物（可派发动作的完整面）；isHardGated = 不可变治理核的
 * "哪些永远绕不过 Kevin" 判定。
 */
export interface OrganInventoryInput {
  bindings: readonly OrganBindingRow[]
  knownActions: readonly string[]
  isHardGated(actionType: string): boolean
}

function groupLabel(prefix: string): string {
  return PREFIX_LABELS[prefix] ?? prefix
}

/** 身份绑定 + 设备/通道。两者同源同一张表，所以一起算、分开写（organs.py:77-108）。 */
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

/**
 * 动作能力表（organs.py:111-134）。两个事实都取自代码而不是可变规则文件：
 * 她能派发哪些动作、哪些永远绕不过 Kevin。
 */
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
    const note = gated.length > 0 ? ', 其中每次都要 Kevin 点头的: ' + gated.join('/') : ''
    lines.push(`- ${groupLabel(prefix)}: ` + actions.join('、') + note)
  }
  return lines
}

/**
 * 派生一次清单文本；空清单返回空串（判据⑧a：空态不注入）。
 * 纯函数式的"读三处、拼一段"，不写任何状态（organs.py:137-159 逐字对应）。
 */
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

/** 空清单 → null（SA-160 的注入判定形态；进程级缓存归 W5 的接线层）。 */
export function organBlockFromInventory(input: OrganInventoryInput): string | null {
  return renderOrganInventory(input) || null
}
