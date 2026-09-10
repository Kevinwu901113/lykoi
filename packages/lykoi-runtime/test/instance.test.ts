import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInstance, restoreInstance } from '../src/instance.ts'

test('identity core owns only identity facts; birth storage is supplied by the assembly', () => {
  const registry = mkdtempSync(join(tmpdir(), 'identity-core-'))
  try {
    const definition = join(registry, 'source'); writeFileSync(definition, 'arbitrary definition snapshot')
    const instance = createInstance({ registry, id: 'a', definition, initialize(i) {
      writeFileSync(join(i.stateRoot, 'custom-organ-state'), 'lived state')
    } })
    assert.deepEqual(Object.keys(instance).sort(), ['version', 'id', 'origin', 'createdAt', 'definitionHash', 'personaPath', 'stateRoot'].sort())
    writeFileSync(definition, 'updated source')
    assert.deepEqual(restoreInstance(registry, 'a'), instance)
    assert.equal(readFileSync(join(instance.stateRoot, 'custom-organ-state'), 'utf8'), 'lived state')
  } finally { rmSync(registry, { recursive: true, force: true }) }
})
