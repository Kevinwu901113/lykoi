import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { initState } from 'lykoi-memory/init-state'
import { loadPersona, buildPersonaKernel } from 'lykoi-decide'
import { adoptInstance, createInstance, restoreInstance, selectInstance, selectedInstance, instancePluginConfig } from '../instance-state.ts'

const fixture = new URL('../../packages/lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname
const now = new Date('2026-09-10T00:00:00Z')
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const options = (registry: string, id: string, definition = fixture) => ({ registry, id, definition, now, ownerName: 'Owner', telegramSenderId: '1001' })

test('v2 birth uses existing instance storage, freezes the definition and seeds interests only once', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-v2-'))
  try {
    const definition = join(registry, 'persona.toml')
    writeFileSync(definition, 'version = 2\n[character]\nname = "旅人"\ndescription = "喜欢地图的旅人"\ninterests = ["地图"]\nscenario = "在车站相遇"\nexamples = ["你好\\n你也在等车？"]\n')
    const instance = createInstance(options(registry, 'traveller', definition))
    writeFileSync(definition, 'source changed')
    const restored = restoreInstance(registry, 'traveller')
    assert.equal(restored.definitionHash, instance.definitionHash)
    assert.ok(buildPersonaKernel(loadPersona(restored.personaPath)).includes('你好\n你也在等车？'))
    for (const plugin of ['lykoi-converse', 'lykoi-wake', 'lykoi-task']) {
      assert.equal(instancePluginConfig(restored, plugin).personaToml, restored.personaPath)
    }
    const db = new ReadWriteMemory(join(restored.stateRoot, 'memory.db'))
    try {
      assert.equal(db.listConcerns().filter(x => x.title === '地图').length, 1)
      assert.ok(!db.getInsights(null).some(x => x.content.includes('在车站相遇')))
    } finally { db.close() }
  } finally { rmSync(registry, { recursive: true, force: true }) }
})

test('create A/B once; restore retains distinct experiences, relationships and definition snapshots', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-instance-'))
  try {
    const source = join(registry, 'source'); mkdirSync(source)
    const definition = join(source, 'persona.toml'); copyFileSync(fixture, definition)
    writeFileSync(join(source, 'seeds.toml'), '[seeds]\npreference = ["birth-only"]\n')
    const a = createInstance(options(registry, 'a', definition)), b = createInstance(options(registry, 'b', definition))
    for (const instance of [a, b]) {
      const db = new ReadWriteMemory(join(instance.stateRoot, 'memory.db'))
      try {
        db.upsertInsight('experience', `only-${instance.id}`, { now })
        db.createConcern('relationship_thread', `relationship-${instance.id}`, { weight: 0.5, origin: 'relationship', now })
      } finally { db.close() }
    }
    writeFileSync(definition, 'broken updated template')
    writeFileSync(join(source, 'seeds.toml'), '[seeds]\npreference = ["must-not-appear"]\n')
    for (const id of ['a', 'b', 'a']) {
      selectInstance(registry, id)
      const instance = selectedInstance(registry)
      const db = new ReadWriteMemory(join(instance.stateRoot, 'memory.db'))
      try {
        const insights = db.getInsights(null).map(x => x.content)
        assert.ok(insights.includes(`only-${id}`)); assert.ok(!insights.includes(`only-${id === 'a' ? 'b' : 'a'}`))
        assert.equal(insights.filter(x => x === 'birth-only').length, 1)
        assert.ok(!insights.includes('must-not-appear'))
        assert.ok(db.listConcerns().some(x => x.title === `relationship-${id}`))
        const changed = instancePluginConfig(instance, 'lykoi-converse', { route: 'new-model', dbPath: '/wrong', personaToml: '/wrong' })
        assert.equal(changed.dbPath, join(instance.stateRoot, 'memory.db'))
        assert.equal(changed.personaToml, instance.personaPath)
        assert.equal(changed.route, 'new-model')
      } finally { db.close() }
    }
    assert.throws(() => createInstance(options(registry, 'a')), /EEXIST/)
  } finally { rmSync(registry, { recursive: true, force: true }) }
})

test('adopt preserves existing memory bytes and bindings; no seed replay', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-adopt-'))
  try {
    const stateRoot = join(registry, 'existing'); mkdirSync(stateRoot)
    const path = join(stateRoot, 'memory.db')
    initState({ db: path, now, ownerName: 'Existing owner', telegramSenderId: '42' })
    const db = new ReadWriteMemory(path)
    db.upsertInsight('history', 'lived before registration', { now }); db.close()
    const before = digest(path)
    adoptInstance({ ...options(registry, 'first'), stateRoot })
    assert.equal(digest(path), before)
    restoreInstance(registry, 'first')
    assert.equal(digest(path), before)
    const restored = restoreInstance(registry, 'first')
    assert.throws(() => instancePluginConfig(restored, 'lykoi-budget'), /ENOENT/)
    assert.throws(() => adoptInstance({ ...options(registry, 'impostor'), stateRoot }), /already belongs/)
  } finally { rmSync(registry, { recursive: true, force: true }) }
})

test('missing/corrupt/misowned state fails restoration without rebirth', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-restore-'))
  try {
    const a = createInstance(options(registry, 'a'))
    const marker = join(a.stateRoot, 'instance.json'), original = readFileSync(marker)
    writeFileSync(marker, '{')
    assert.throws(() => restoreInstance(registry, 'a'), SyntaxError)
    writeFileSync(marker, original)
    const budget = join(a.stateRoot, 'budget.json'), originalBudget = readFileSync(budget)
    rmSync(budget)
    assert.throws(() => restoreInstance(registry, 'a'), /state missing: budget.json/)
    writeFileSync(budget, originalBudget)
    const db = join(a.stateRoot, 'memory.db'); rmSync(db)
    assert.throws(() => restoreInstance(registry, 'a'), /refusing rebirth/)
    assert.throws(() => readFileSync(db), /ENOENT/)
  } finally { rmSync(registry, { recursive: true, force: true }) }
})
