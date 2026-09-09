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
  owner?: { name: string }
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
    ...(data.owner === undefined ? {} : { owner: { name: str(section(data, 'owner'), 'owner', 'name') } }),
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

export function renderOwnerTemplate(text: string, persona?: PersonaConfig): string {
  const names = { owner: persona?.voice.address_owner ?? '所有者',
    owner_name: persona?.owner?.name ?? persona?.voice.address_owner ?? '所有者',
    self: persona?.identity.name ?? '你' }
  return text.replace(/\{(owner|owner_name|self)\}/g, (_match, key: keyof typeof names) => names[key])
}

export function buildPersonaPrompt(store: InsightsReader, config?: PersonaConfig): string {
  const persona = store.getInsights('persona')
  const prefs = store.getInsights('preference')
  const sections: string[] = []
  if (persona.length > 0) {
    sections.push('你对自己的理解：\n' + bullets(persona))
  }
  if (prefs.length > 0) {
    sections.push(renderOwnerTemplate('{owner} 的偏好：\n', config) + bullets(prefs))
  }
  if (sections.length === 0) return ''
  return '\n\n' + sections.join('\n\n')
}
