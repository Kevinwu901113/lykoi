import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
import { parsePersonaData } from 'lykoi-decide'

/** Import source bytes without ever rewriting the original card or dropping its metadata. */
export function readCard(bytes: Buffer): Record<string, unknown> {
  let json = bytes.toString('utf8')
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const cards = new Map<string, string>()
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw new Error('truncated PNG chunk')
      const length = bytes.readUInt32BE(offset), end = offset + length + 12
      if (end > bytes.length) throw new Error('truncated PNG chunk')
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG checksum mismatch')
      const data = bytes.subarray(offset + 8, end - 4)
      const separator = data.indexOf(0), key = data.subarray(0, separator).toString('ascii')
      if (type === 'tEXt' && separator >= 0 && ['chara', 'ccv3'].includes(key)) {
        if (cards.has(key)) throw new Error('ambiguous PNG character metadata')
        cards.set(key, Buffer.from(data.subarray(separator + 1).toString('ascii'), 'base64').toString('utf8'))
      }
      offset = end
      if (type === 'IEND') break
    }
    const card = cards.get('ccv3') ?? cards.get('chara')
    if (card === undefined) throw new Error('PNG has no supported chara metadata')
    json = card
  }
  const card: unknown = JSON.parse(json)
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('character card must be an object')
  return card as Record<string, unknown>
}

export function convertCard(card: Record<string, unknown>, owner: string) {
  if (!owner.trim()) throw new Error('explicit owner name required for {{user}}')
  if (card.spec !== undefined && !((card.spec === 'chara_card_v2' && card.spec_version === '2.0') || (card.spec === 'chara_card_v3' && card.spec_version === '3.0'))) throw new Error('supported formats: Character Card v1, v2.0 and v3.0')
  const data = card.spec === undefined ? card : card.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('character card data must be an object')
  const d = data as Record<string, unknown>
  const value = (key: string) => {
    const v = d[key] ?? ''
    if (typeof v !== 'string') throw new Error(`${key} must be a string`)
    return v
  }
  const name = value('name')
  const expand = (s: string) => s.replace(/\{\{(char|user)\}\}/gi, (_m, key: string) => key.toLowerCase() === 'char' ? value('nickname') || name : owner)
  const character = {
    name, description: expand(value('description') || value('personality')),
    traits: value('personality') ? [expand(value('personality'))] : [],
    scenario: expand(value('scenario')), address_owner: owner,
    examples: [value('first_mes'), value('mes_example')].filter(Boolean).map(expand),
  }
  parsePersonaData({ version: 2, character })
  const warnings: string[] = []
  for (const key of ['system_prompt', 'post_history_instructions', 'character_book', 'alternate_greetings', 'group_only_greetings', 'assets']) {
    if (d[key] && (!Array.isArray(d[key]) || d[key].length)) warnings.push(`${key} retained in source only; not activated`)
  }
  if (/\{\{[^}]+\}\}/.test(JSON.stringify(character))) warnings.push('unknown macros retained literally; only {{char}} and {{user}} are expanded')
  const toml = 'version = 2\n\n[character]\n' + Object.entries(character).map(([key, v]) => `${key} = ${JSON.stringify(v)}`).join('\n') + '\n'
  return { toml, warnings }
}

export function importCharacter(source: string, directory: string, owner: string) {
  const bytes = readFileSync(source), converted = convertCard(readCard(bytes), owner)
  const output = resolve(directory)
  mkdirSync(output) // Existing package is never replaced.
  try {
    writeFileSync(join(output, 'persona.toml'), converted.toml, { flag: 'wx' })
    writeFileSync(join(output, 'source.card'), bytes, { flag: 'wx' })
    writeFileSync(join(output, 'import.json'), JSON.stringify({ format: 'lykoi-character-import-v1', warnings: converted.warnings }, null, 2) + '\n', { flag: 'wx' })
  } catch (error) { rmSync(output, { recursive: true, force: true }); throw error }
  return { definition: join(output, 'persona.toml'), warnings: converted.warnings }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, owner] = process.argv.slice(2)
  if (!source || !output || !owner) { console.error('usage: node profile/character-import.ts CARD.json|CARD.png NEW_DIRECTORY OWNER_NAME'); process.exitCode = 1 }
  else try { console.log(JSON.stringify(importCharacter(source, output, owner), null, 2)) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
