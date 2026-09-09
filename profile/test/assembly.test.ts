import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInstance } from 'lykoi-runtime/instance'
import { instanceEntries } from '../assembly.ts'

test('production YAML is bound to the selected state and definition; model/channel settings survive', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-assembly-'))
  try {
    const instance = createInstance({ registry, id: 'selected', ownerName: 'Owner', definition:
      new URL('../../packages/lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname })
    const entries = instanceEntries(new URL('../cordis.prod.yml', import.meta.url).pathname, instance)
    for (const name of ['lykoi-memory', 'lykoi-converse', 'lykoi-wake']) {
      assert.equal(entries.find(e => e.name === name)?.config.dbPath, join(instance.stateRoot, 'memory.db'))
    }
    for (const name of ['lykoi-converse', 'lykoi-wake']) assert.equal(entries.find(e => e.name === name)?.config.personaToml, instance.personaPath)
    assert.equal(entries.find(e => e.name === 'lykoi-heart')?.config.salienceDb, '')
    assert.equal(entries.find(e => e.name === 'lykoi-converse')?.config.route, 'deepseek-official')
    assert.equal(entries.find(e => e.name === 'lykoi-adapter-telegram/production')?.config.tokenEnv, 'LYKOI_TELEGRAM_BOT_TOKEN')
  } finally { rmSync(registry, { recursive: true, force: true }) }
})
