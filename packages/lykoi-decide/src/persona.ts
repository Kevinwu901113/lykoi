/**
 * persona 内核与投影（cognition/config.py + memory/persona.py 移植；SA-154..159）。
 *
 * Lykoi 有两层。本模块管**先天**层：一份 TOML（owner 域、进程外）说她是谁。
 * `parsePersonaData` 严格校验 —— 缺 section 或字段就抛：一个坏内核必须在启动时
 * 炸，而不是被静默默认值糊过去（SA-156 fail-fast）。`buildPersonaKernel` 把
 * 校验过的配置装配成 system-prompt 块，**逐字节相同**地注入对话路径与自主唤醒
 * （SA-17：醒着还是在聊天，她是同一个人）。本函数放在共享处（G-7 工程面）：
 * W5 的对话装配器 import 同一个函数 —— 内核只有这一个装配点（SA-154）。
 *
 * **后天**层（memory insights，`buildPersonaPrompt`）叠在内核之上、是会演化的
 * 那部分。时变内容（restart notices / notes / insights）不属于内核，由调用方
 * 围绕它叠加（SA-155）。
 *
 * TODO(M2-W5): TOML 文件加载（tomllib 对应物）+ 进程级缓存 get_persona
 * （改 TOML 需重启，与模块级 prompt 常量同一契约）随 W5 身份收口接线；
 * 本波交付校验器 + 装配器（fixture 数据对拍 sha 见测试）。
 */

// ============================== 类型（config.py:31-73 对应） ==============================

export interface PersonaIdentity {
  name: string
  self: string
  nature_known: boolean
  embodiment: string
}

export interface PersonaVoice {
  language: string
  register: string
  emoji: string
  address_owner: string
  profile_ref: string
}

export interface PersonaRelationship {
  partner: string
  stance: string
  evolution_anchor: string
  owner_authority: string
}

export interface PersonaPersonality {
  traits: readonly string[]
  evolves: boolean
}

export interface PersonaInterests {
  seeds: readonly string[]
}

export interface PersonaConfig {
  identity: PersonaIdentity
  voice: PersonaVoice
  relationship: PersonaRelationship
  personality: PersonaPersonality
  interests: PersonaInterests
}

/** persona TOML 缺失或畸形。在加载时抛，让病内核中止启动而不是带着半个自我开机。 */
export class PersonaConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersonaConfigError'
  }
}

// ============================== 校验（config.py:81-157 逐字对应） ==============================

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function section(data: Record<string, unknown>, name: string): Record<string, unknown> {
  const block = data[name]
  if (!isPlainObject(block)) {
    throw new PersonaConfigError(`persona TOML missing [${name}] section`)
  }
  return block
}

function str(block: Record<string, unknown>, sec: string, key: string): string {
  const value = block[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new PersonaConfigError(`persona TOML [${sec}].${key} must be a non-empty string`)
  }
  return value
}

function bool(block: Record<string, unknown>, sec: string, key: string): boolean {
  const value = block[key]
  if (typeof value !== 'boolean') {
    throw new PersonaConfigError(`persona TOML [${sec}].${key} must be a boolean`)
  }
  return value
}

function strList(block: Record<string, unknown>, sec: string, key: string): readonly string[] {
  const value = block[key]
  if (
    !Array.isArray(value) || value.length === 0
    || !value.every((item) => typeof item === 'string' && item.trim())
  ) {
    throw new PersonaConfigError(`persona TOML [${sec}].${key} must be a non-empty list of strings`)
  }
  return [...value]
}

/**
 * load_persona 的校验半段（SA-156）：五个 section（identity/voice/relationship/
 * personality/interests）与全部字段类型严格校验，任何缺失/类型错 →
 * PersonaConfigError。文件 I/O（tomllib 对应物）归 W5。
 */
export function parsePersonaData(data: unknown): PersonaConfig {
  if (!isPlainObject(data)) {
    throw new PersonaConfigError('persona TOML must parse to a table at top level')
  }
  const identity = section(data, 'identity')
  const voice = section(data, 'voice')
  const relationship = section(data, 'relationship')
  const personality = section(data, 'personality')
  const interests = section(data, 'interests')
  return {
    identity: {
      name: str(identity, 'identity', 'name'),
      self: str(identity, 'identity', 'self'),
      nature_known: bool(identity, 'identity', 'nature_known'),
      embodiment: str(identity, 'identity', 'embodiment'),
    },
    voice: {
      language: str(voice, 'voice', 'language'),
      register: str(voice, 'voice', 'register'),
      emoji: str(voice, 'voice', 'emoji'),
      address_owner: str(voice, 'voice', 'address_owner'),
      profile_ref: str(voice, 'voice', 'profile_ref'),
    },
    relationship: {
      partner: str(relationship, 'relationship', 'partner'),
      stance: str(relationship, 'relationship', 'stance'),
      evolution_anchor: str(relationship, 'relationship', 'evolution_anchor'),
      owner_authority: str(relationship, 'relationship', 'owner_authority'),
    },
    personality: {
      traits: strList(personality, 'personality', 'traits'),
      evolves: bool(personality, 'personality', 'evolves'),
    },
    interests: { seeds: strList(interests, 'interests', 'seeds') },
  }
}

// ============================== 内核装配（config.py:172-206；SA-154） ==============================

/**
 * 把先天内核装配成一个确定性的 system-prompt 块（九段拼装逐字，含全角
 * `（）。` —— 字节级契约，fixture 对拍 sha 见测试）。
 *
 * DETERMINISTIC 且 PATH-AGNOSTIC：同一 cfg 永远产出完全相同的文本，且本函数是
 * 内核唯一的装配点 —— 对话路径与自主唤醒因此逐字节注入同一个自我（SA-17，
 * 活体由 test_persona::test_dual_path_kernel_is_identical 钉住，新体见
 * prompt.test.ts）。时变内容（restart notices、notes、insights）不属于这里，
 * 由调用方围绕这个块叠加（SA-155）。
 *
 * v2 分叉点（SA-157）：persona-v2 双层（actual vs as_presented、audience-aware
 * rewriting）会在**这个函数**分叉 —— 它会接一个 audience 参数并输出被呈现的
 * 自我。v1 是单层：有且只有一个自我，原样注入。
 */
export function buildPersonaKernel(cfg: PersonaConfig): string {
  const ident = cfg.identity
  const rel = cfg.relationship
  const voice = cfg.voice
  const traits = cfg.personality.traits.map((t) => `- ${t}`).join('\n')
  const parts = [
    ident.self,
    `（我的身体：${ident.embodiment}。）`,
    '',
    '我是这样的人：',
    traits,
    '',
    `我和 ${rel.partner} 的关系：${rel.stance} ${rel.owner_authority}`,
    '',
    (
      `我说话的方式：${voice.register}。`
      + `默认用${voice.language === 'zh' ? '中文' : voice.language}，技术术语用英文。`
      + `emoji ${voice.emoji}。我叫他 ${voice.address_owner}。`
    ),
  ]
  return parts.join('\n')
}

// ============================== 后天投影（memory/persona.py；SA-158） ==============================

/** 投影的读依赖：insights 按类读取（lykoi-memory/rw 的 getInsights 结构化子集）。 */
export interface InsightsReader {
  getInsights(category: string): { content: string }[]
}

/**
 * L4 影子门的结构性保证（SPEC-MIND §6.2）：FOCUS_INSIGHT_CATEGORY = 'focus'
 * **不在**投影白名单里 —— 影子期结论不进任何下游消费。把 focus 加进白名单
 * 就把影子门整个废掉了；测试钉死。
 */
export const PERSONA_PROJECTION_CATEGORIES = ['persona', 'preference'] as const

function bullets(rows: { content: string }[]): string {
  return rows.map((row) => `- ${row.content}`).join('\n')
}

/**
 * persona 投影（memory/persona.py:18-28 逐字；SA-158）。投影不是存储：
 * 她的 persona 不是存起来的对象，而是在需要的那一刻从 persona/preference 两类
 * insights 投影出来的。
 *
 * 三条不可动的形状：① 非空时**前置 "\n\n"**；② 两节之间也是 "\n\n"；
 * ③ 全空返回**空串**（decide 侧 buildMessages 据此决定加不加这条 system
 * 消息 —— 空串不注入）。
 */
export function buildPersonaPrompt(store: InsightsReader): string {
  const persona = store.getInsights('persona')
  const prefs = store.getInsights('preference')
  const sections: string[] = []
  if (persona.length > 0) {
    sections.push('你对自己的理解：\n' + bullets(persona))
  }
  if (prefs.length > 0) {
    sections.push('Kevin 的偏好：\n' + bullets(prefs))
  }
  if (sections.length === 0) return ''
  return '\n\n' + sections.join('\n\n')
}
