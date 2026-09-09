import { CapabilityRuntime } from 'lykoi-runtime'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateFixture } from 'lykoi-memory/testing'
import { apply, type Config } from '../src/index.ts'

test('多通道 owner 的 canonical binding 不得落到不同通道的单传输上', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'owner-channel-')), 'state.db')
  createStateFixture(dbPath)
  const db = new DatabaseSync(dbPath)
  db.prepare('INSERT INTO identity_bindings (user_id,channel,channel_key,verified_by,created_at) VALUES (?,?,?,?,?)')
    .run('user_001', 'matrix', '1001', 'owner', '2026-09-07T00:00:00+00:00')
  db.close()
  const ctx = new Context()
  ctx.provide('lykoiRuntime', new CapabilityRuntime())
  ctx.provide('messenger', { channel: 'telegram' } as Context['messenger'])
  assert.throws(() => apply(ctx, { dbPath } as Config), /owner binding channel does not match/)
})
