import assert from 'node:assert/strict'
import test from 'node:test'
import { integrationIdentityGuard } from '../src/l2.ts'
import { focusIdentityGuard } from '../src/l4.ts'
import { PERSONA } from './fixture.ts'

test('learning identity guards use the supplied definition', () => {
  const other = { identity: { name: 'OtherInstance' }, relationship: { partner: 'OtherOwner' } }
  for (const guard of [integrationIdentityGuard, focusIdentityGuard]) {
    assert.ok(guard(PERSONA).includes(PERSONA.identity.name))
    assert.ok(guard(other).includes(other.identity.name))
    assert.ok(guard(other).includes(other.relationship.partner))
    assert.ok(!guard(other).includes(PERSONA.identity.name))
  }
})
