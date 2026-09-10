import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseTomlSubset } from './persona-toml.ts'

export const SEEDS_FILENAME = 'seeds.toml'
export const SEEDS_TABLE = 'seeds'

export class CharacterPackageError extends Error {}

/** 一条记忆种子：[insight category, content]。 */
export type MemorySeed = readonly [category: string, content: string]

export interface CharacterPackage {
  /** 角色出生包根目录（= persona TOML 所在目录，绝对路径）。 */
  root: string
  /** seeds.toml 展平后的种子；文件缺失时为空数组。 */
  seeds: readonly MemorySeed[]
}

/** Birth inputs share the definition directory; deployment is located independently. */
export function characterRoot(personaPath: string): string {
  return dirname(resolve(personaPath))
}

/** seeds.toml 正文 → 种子数组；形状不对即抛（source 只用于报错文案）。 */
export function parseSeeds(text: string, source: string): MemorySeed[] {
  let data: Record<string, unknown>
  try {
    data = parseTomlSubset(text)
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc)
    throw new CharacterPackageError(`${source} is not valid TOML: ${message}`)
  }
  const keys = Object.keys(data)
  if (keys.length === 0) return []
  if (keys.length !== 1 || keys[0] !== SEEDS_TABLE) {
    throw new CharacterPackageError(
      `${source}: expected exactly one table [${SEEDS_TABLE}], got [${keys.join(', ')}]`,
    )
  }
  const table = data[SEEDS_TABLE]
  if (typeof table !== 'object' || table === null || Array.isArray(table)) {
    throw new CharacterPackageError(`${source}: [${SEEDS_TABLE}] must be a table`)
  }
  const seeds: MemorySeed[] = []
  for (const [category, values] of Object.entries(table as Record<string, unknown>)) {
    if (
      !Array.isArray(values)
      || values.some((value) => typeof value !== 'string' || value.trim() === '')
    ) {
      throw new CharacterPackageError(
        `${source}: [${SEEDS_TABLE}].${category} must be an array of non-empty strings`,
      )
    }
    for (const content of values as string[]) seeds.push([category, content])
  }
  return seeds
}

function readOptional(path: string): string | null {
  try { return readFileSync(path, 'utf8') }
  catch (exc) {
    if ((exc as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new CharacterPackageError(`cannot read ${path}`)
  }
}

export function loadCharacterPackage(personaPath: string): CharacterPackage {
  const root = characterRoot(personaPath)
  const seedsPath = join(root, SEEDS_FILENAME)
  const seeds = readOptional(seedsPath)
  return { root, seeds: seeds === null ? [] : parseSeeds(seeds, seedsPath) }
}
