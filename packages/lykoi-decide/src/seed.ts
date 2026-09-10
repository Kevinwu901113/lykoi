import type { MemorySeed } from './character-package.ts'
import type { PersonaConfig } from './persona.ts'

export const SEED_INITIAL_WEIGHT = 0.5

export const SEED_DESCRIPTION = '先天兴趣种子(来自人格 TOML)'

/** seedConcerns 的写依赖（lykoi-memory/rw 的结构化子集）。 */
export interface SeedConcernStore {

  listConcerns(status?: string | readonly string[]): { title: string; origin: string }[]
  createConcern(
    kind: string,
    title: string,
    opts: { weight: number; origin: string; description?: string; now: Date },
  ): number
}

export function seedConcerns(
  store: SeedConcernStore,
  persona: PersonaConfig,
  opts: { now: Date; logEvent?: (name: string, fields: Record<string, unknown>) => void },
): number[] {

  const existing = new Set(
    store.listConcerns().filter((row) => row.origin === 'seed').map((row) => row.title),
  )
  const created: number[] = []
  for (const title of persona.interests.seeds) {
    if (existing.has(title)) continue
    created.push(
      store.createConcern('interest', title, {
        weight: SEED_INITIAL_WEIGHT,
        origin: 'seed',
        description: SEED_DESCRIPTION,
        now: opts.now,
      }),
    )
  }
  if (created.length > 0) {
    opts.logEvent?.('mind_seeded', { count: created.length, ids: created })
  }
  return created
}

export function seedPersona(
  store: { upsertInsight(category: string, content: string, opts: { now: Date }): number },
  seeds: readonly MemorySeed[],
  opts: { now: Date },
): number {
  for (const [category, content] of seeds) {
    store.upsertInsight(category, content, { now: opts.now })
  }
  return seeds.length
}
