/**
 * persona fixture —— 由**合成测试实例包** `fixtures/instance/persona.toml`（WO-E4-1）
 * 装载派生；不再手写第二份真相。内核对拍锚见 prompt.test.ts（SA-154）。
 */
import { loadPersona, type PersonaConfig } from '../src/index.ts'

/** 合成测试实例包的 persona TOML（converse / wake / learn 的夹具也读这一份）。 */
export const FIXTURE_PERSONA_TOML = new URL('./fixtures/instance/persona.toml', import.meta.url).pathname

export const FIXTURE_PERSONA: PersonaConfig = loadPersona(FIXTURE_PERSONA_TOML)

/** 同一数据的"原始 TOML 表"形态（parsePersonaData 的输入面）。 */
export const FIXTURE_PERSONA_DATA: Record<string, unknown> = {
  identity: {
    name: FIXTURE_PERSONA.identity.name,
    self: FIXTURE_PERSONA.identity.self,
    nature_known: FIXTURE_PERSONA.identity.nature_known,
    embodiment: FIXTURE_PERSONA.identity.embodiment,
  },
  voice: { ...FIXTURE_PERSONA.voice },
  relationship: { ...FIXTURE_PERSONA.relationship },
  personality: {
    traits: [...FIXTURE_PERSONA.personality.traits],
    evolves: FIXTURE_PERSONA.personality.evolves,
  },
  interests: { seeds: [...FIXTURE_PERSONA.interests.seeds] },
}
