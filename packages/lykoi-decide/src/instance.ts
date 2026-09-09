import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseTomlSubset } from './persona-toml.ts'

export const DEPLOY_FILENAME = 'deploy.toml'
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
  deploy: { telegram_proxy?: string }
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
/** 部署事实只接受明确的 Telegram 代理；解析失败不回显原文或凭据。 */
export function parseDeploy(text: string, source = DEPLOY_FILENAME): InstancePackage['deploy'] {
  let data: Record<string, unknown>
  try { data = parseTomlSubset(text) }
  catch { throw new InstancePackageError(`${source}: invalid TOML`) }
  if (Object.keys(data).length === 0) return {}
  const telegram = data.telegram
  if (Object.keys(data).length !== 1 || typeof telegram !== 'object' || telegram === null || Array.isArray(telegram)) {
    throw new InstancePackageError(`${source}: expected [telegram] table`)
  }
  const table = telegram as Record<string, unknown>
  if (Object.keys(table).some(key => key !== 'proxy') || typeof table.proxy !== 'string' || !table.proxy) {
    throw new InstancePackageError(`${source}: expected non-empty [telegram].proxy`)
  }
  try {
    const url = new URL(table.proxy)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error()
  } catch { throw new InstancePackageError(`${source}: invalid proxy URL`) }
  return { telegram_proxy: table.proxy }
}

function readOptional(path: string): string | null {
  try { return readFileSync(path, 'utf8') }
  catch (exc) {
    if ((exc as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new InstancePackageError(`cannot read ${path}`)
  }
}

export function loadInstancePackage(personaPath: string): InstancePackage {
  const root = instanceRoot(personaPath)
  const seedsPath = join(root, SEEDS_FILENAME)
  const deployPath = join(root, DEPLOY_FILENAME)
  const seeds = readOptional(seedsPath)
  const deploy = readOptional(deployPath)
  return { root, seeds: seeds === null ? [] : parseSeeds(seeds, seedsPath),
    deploy: deploy === null ? {} : parseDeploy(deploy, deployPath) }
}
