import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { CharacterInstance } from 'lykoi-contracts'
import type { Context } from '@deepseek-ai/cordis'
import type { IngressService } from 'lykoi-ingress'
import { instancePluginConfig } from 'lykoi-runtime/instance'
const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string, options: { schema: unknown }): unknown }

/** Read runtime configuration; state-bearing paths are always supplied by the instance. */
export function instanceEntries(path: string, instance: CharacterInstance): EntryOptions[] {
  const text = readFileSync(path, 'utf8')
  const entries: unknown = extname(path) === '.json' ? JSON.parse(text) : yaml.load(text, { schema: entryListSchema })
  if (!Array.isArray(entries) || entries.some(e => !e || typeof e.name !== 'string' || typeof e.id !== 'string' || e.group)) {
    throw new Error('runtime config must be a flat array of Cordis plugin entries')
  }
  return entries.map(e => ({ ...e, config: instancePluginConfig(instance, e.name, e.config) }))
}

/** Stop admission, finish owned work and durable ingress, then retire plugin handles. */
export async function drainInstance(root: Context): Promise<void> {
  await root.lykoiRuntime.quiesce()
  await (root.get('ingress') as IngressService | undefined)?.close()
  await root.loader.root.stop()
}
