import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { CharacterInstance } from 'lykoi-contracts'
import type { Context } from '@deepseek-ai/cordis'
import type { IngressService } from 'lykoi-ingress'
import { instancePluginConfig } from './instance-state.ts'
const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string, options: { schema: unknown }): unknown }

/** Read runtime configuration; state-bearing paths are always supplied by the instance. */
export function instanceEntries(path: string, instance: CharacterInstance, deploymentFile?: string): EntryOptions[] {
  const text = readFileSync(path, 'utf8')
  const entries: unknown = extname(path) === '.json' ? JSON.parse(text) : yaml.load(text, { schema: entryListSchema })
  if (!Array.isArray(entries) || entries.some(e => !e || typeof e.name !== 'string' || typeof e.id !== 'string' || e.group)) {
    throw new Error('runtime config must be a flat array of Cordis plugin entries')
  }
  const auditPath = entries.find(e => e.name === 'lykoi-audit')?.config?.path
  if (auditPath !== undefined && (typeof auditPath !== 'string' || !auditPath)) throw new Error('invalid deployment audit path')
  return entries.map(e => {
    const config = instancePluginConfig(instance, e.name, e.config, auditPath)
    if (e.name === 'lykoi-adapter-telegram/production' && config.proxy === 'deployment' && deploymentFile !== undefined) {
      config.deploymentFile = deploymentFile
    }
    return { ...e, config }
  })
}

/** Stop admission, finish owned work and durable ingress, then retire plugin handles. */
export async function drainInstance(root: Context): Promise<void> {
  await root.get('tasks')?.close()
  await root.lykoiRuntime.quiesce()
  await (root.get('ingress') as IngressService | undefined)?.close()
  await root.loader.root.stop()
}
