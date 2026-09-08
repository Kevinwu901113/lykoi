import test from 'node:test'
import assert from 'node:assert/strict'
import { ReadWriteMemory } from '../src/rw.ts'
import { makeWritableFixture, rawOpen } from './fixture.ts'

test('ownerBinding 仅取 active owner，跨通道按 channel/key 稳定排序，缺席为 null', () => {
  const path = makeWritableFixture()
  const db = rawOpen(path)
  const rw = new ReadWriteMemory(path)
  try {
    db.exec('DELETE FROM identity_bindings')
    assert.equal(rw.ownerBinding(), null)
    const insert = db.prepare('INSERT INTO identity_bindings (user_id,channel,channel_key,verified_by,created_at) VALUES (?,?,?,?,?)')
    for (const [channel, key] of [['telegram','1001'], ['matrix','z'], ['matrix','a']]) {
      insert.run('user_001', channel!, key!, 'owner', '2026-09-07T00:00:00+00:00')
    }
    assert.deepEqual({ ...rw.ownerBinding() }, { channel: 'matrix', channel_key: 'a' })
    assert.equal(rw.ownerChannelKey('telegram'), '1001', '平台绑定查询仍可使用')
    db.exec("UPDATE users SET status='archived' WHERE id='user_001'")
    assert.equal(rw.ownerBinding(), null)
  } finally { rw.close(); db.close() }
})
