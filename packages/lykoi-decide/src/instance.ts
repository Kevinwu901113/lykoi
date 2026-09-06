/**
 * 实例包（E4-SPEC §2.3 / §3.2；WO-E4-2）—— 框架 / 实例分离的第一个装载面。
 *
 * 缺省假设（Kevin 裁定 E4-SPEC §6.4 前生效）：**实例包根 = persona TOML 所在目录**
 * （产线 `/home/lykoi/runtime/persona/`）；零新路径常量，根只由 personaToml 派生。
 *
 * 目前包里只有一样东西：`seeds.toml` —— 后天 insights 的出生种子。它曾是 `seed.ts`
 * 里的一条框架常量（第一实例的一条偏好），每个新实例出生都被写进去；现在种子
 * 住在实例包，框架**零缺省种子**。语义：
 *  - 文件缺失 = 零种子（不是缺省一条）；
 *  - 文件损坏 / 形状不对 = 抛 InstancePackageError（出生证阶段抛错比静默好）；
 *  - 形态沿用本包既有的严格 TOML 子集（`[[array-of-tables]]` 不在子集内，故不用
 *    `[[seed]]`）：
 *        [seeds]
 *        preference = ["…", "…"]
 *    表名固定 `seeds`，键 = insight category，值 = 该类的种子内容（字符串数组）。
 *    展平为 [category, content][]，顺序 = 键序 × 数组序。空文件 / 空表 = 零种子。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseTomlSubset } from './persona-toml.ts'

export const SEEDS_FILENAME = 'seeds.toml'
export const SEEDS_TABLE = 'seeds'

export class InstancePackageError extends Error {}

/** 一条记忆种子：[insight category, content]。 */
export type MemorySeed = readonly [category: string, content: string]

export interface InstancePackage {
  /** 实例包根目录（= persona TOML 所在目录，绝对路径）。 */
  root: string
  /** seeds.toml 展平后的种子；文件缺失时为空数组。 */
  seeds: readonly MemorySeed[]
}

/** 实例包根 = persona TOML 所在目录（缺省假设，E4-SPEC §6.4 待裁）。 */
export function instanceRoot(personaPath: string): string {
  return dirname(resolve(personaPath))
}

/** seeds.toml 正文 → 种子数组；形状不对即抛（source 只用于报错文案）。 */
export function parseSeeds(text: string, source: string): MemorySeed[] {
  let data: Record<string, unknown>
  try {
    data = parseTomlSubset(text)
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc)
    throw new InstancePackageError(`${source} is not valid TOML: ${message}`)
  }
  const keys = Object.keys(data)
  if (keys.length === 0) return []
  if (keys.length !== 1 || keys[0] !== SEEDS_TABLE) {
    throw new InstancePackageError(
      `${source}: expected exactly one table [${SEEDS_TABLE}], got [${keys.join(', ')}]`,
    )
  }
  const table = data[SEEDS_TABLE]
  if (typeof table !== 'object' || table === null || Array.isArray(table)) {
    throw new InstancePackageError(`${source}: [${SEEDS_TABLE}] must be a table`)
  }
  const seeds: MemorySeed[] = []
  for (const [category, values] of Object.entries(table as Record<string, unknown>)) {
    if (
      !Array.isArray(values)
      || values.some((value) => typeof value !== 'string' || value.trim() === '')
    ) {
      throw new InstancePackageError(
        `${source}: [${SEEDS_TABLE}].${category} must be an array of non-empty strings`,
      )
    }
    for (const content of values as string[]) seeds.push([category, content])
  }
  return seeds
}

/**
 * 装载实例包：根 = persona TOML 所在目录；读 `seeds.toml`（缺失 = 零种子；
 * 读不了 / 解析不了 / 形状不对 = InstancePackageError）。不读 persona 正文——
 * 那是 getPersona 的事。
 */
export function loadInstancePackage(personaPath: string): InstancePackage {
  const root = instanceRoot(personaPath)
  const seedsPath = join(root, SEEDS_FILENAME)
  let text: string
  try {
    text = readFileSync(seedsPath, 'utf8')
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code === 'ENOENT') return { root, seeds: [] }
    const message = exc instanceof Error ? exc.message : String(exc)
    throw new InstancePackageError(`cannot read ${seedsPath}: ${message}`)
  }
  return { root, seeds: parseSeeds(text, seedsPath) }
}
