import test from 'node:test'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInstance } from '../instance-state.ts'
import { instanceEntries } from '../assembly.ts'

test('production YAML is bound to the selected state and definition; model/channel settings survive', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-assembly-'))
  try {
    const instance = createInstance({ registry, id: 'selected', ownerName: 'Owner', definition:
      new URL('../../packages/lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname })
    const entries = instanceEntries(new URL('../cordis.prod.yml', import.meta.url).pathname, instance, '/deployment/telegram.toml')
    for (const name of ['lykoi-memory', 'lykoi-converse', 'lykoi-wake']) {
      assert.equal(entries.find(e => e.name === name)?.config.dbPath, join(instance.stateRoot, 'memory.db'))
    }
    const task = entries.find(e => e.name === 'lykoi-task')!
    assert.equal(task.config.dbPath, join(instance.stateRoot, 'tasks.sqlite'))
    assert.equal(task.config.memoryPath, join(instance.stateRoot, 'memory.db'))
    for (const name of ['lykoi-converse', 'lykoi-wake']) assert.equal(entries.find(e => e.name === name)?.config.personaToml, instance.personaPath)
    assert.ok(!('auditPath' in instance)); assert.ok(!('requiredFiles' in instance))
    const telegram = entries.find(e => e.name === 'lykoi-adapter-telegram/production')!
    assert.ok(!('personaToml' in telegram.config))
    assert.equal(telegram.config.deploymentFile, '/deployment/telegram.toml')
    assert.equal(entries.find(e => e.name === 'lykoi-adapter-telegram')?.config.cursorPath, join(instance.stateRoot, 'telegram-cursor.json'))
    assert.equal(entries.find(e => e.name === 'lykoi-audit')?.config.path, '/var/log/lykoi-audit/audit.jsonl')
    assert.equal(entries.find(e => e.name === 'lykoi-heart')?.config.salienceDb, '')
    assert.equal(entries.find(e => e.name === 'lykoi-converse')?.config.route, 'deepseek-official')
    assert.equal(entries.find(e => e.name === 'lykoi-organ-workspace')?.config.directory, join(instance.stateRoot, 'workspace'))
    assert.equal(entries.find(e => e.name === '@deepseek-ai/dsh-attachment-local')?.config.dshHome, join(instance.stateRoot, 'media'))
    assert.equal(entries.find(e => e.name === 'lykoi-panel')?.config.port, 3210)
    assert.equal(entries.find(e => e.name === 'lykoi-adapter-telegram/production')?.config.tokenEnv, 'LYKOI_TELEGRAM_BOT_TOKEN')
  } finally { rmSync(registry, { recursive: true, force: true }) }
})

test('deployment YAML charges empty merge sources against the parser work limit', () => {
  const yaml = createRequire(import.meta.url)('js-yaml')
  assert.throws(() => yaml.load('empty: &empty {}\nmerged: { <<: [*empty, *empty] }', {maxTotalMergeKeys:1}), /maxTotalMergeKeys/)
  assert.deepEqual(yaml.load('empty: &empty {}\nmerged: { <<: [*empty] }', {maxTotalMergeKeys:1}), {empty:{},merged:{}})
})
