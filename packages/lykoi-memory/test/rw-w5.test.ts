/**
 * rw W5 面：身份登记处读面（identityBindingInventory / ownerPrimaryUserId）。
 * 器官清单（SA-161/D5）与对话路径 L3 实体轴的库层来源。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory } from 'lykoi-memory/rw'

function mk(): { path: string; store: ReadWriteMemory } {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-rw-w5-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  return { path, store: new ReadWriteMemory(path) }
}

function seedBinding(
  path: string,
  row: { userId: string; channel: string; channelKey: string },
): void {
  // 孤儿绑定的产生方式与活体一致：Python sqlite3 连接缺省不开 FK 强制，
  // 所以 users 缺行的绑定在库里真实可存在 —— 播种连接关 FK 复现同一形态。
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false })
  try {
    db.prepare(
      `INSERT INTO identity_bindings (user_id, channel, channel_key, verified_by, created_at)
       VALUES (?, ?, ?, 'owner_console', '2026-08-24T00:00:00+00:00')`,
    ).run(row.userId, row.channel, row.channelKey)
  } finally {
    db.close()
  }
}

test('ownerPrimaryUserId：中性基线 user_001 即 owner；没有 active owner 行时 null', () => {
  const { path, store } = mk()
  try {
    assert.equal(store.ownerPrimaryUserId(), 'user_001')
    // 归档 owner → 不再是 active owner（S-09 fail-closed 前提：未知即无 owner）。
    const db = new DatabaseSync(path)
    db.prepare("UPDATE users SET status = 'archived' WHERE id = 'user_001'").run()
    db.close()
    assert.equal(store.ownerPrimaryUserId(), null)
  } finally {
    store.close()
  }
})

test('identityBindingInventory：channel,user_id 排序；LEFT JOIN 孤儿绑定不消失；行上没有 channel_key 键（D5）', () => {
  const { path, store } = mk()
  try {
    assert.deepEqual(store.identityBindingInventory(), [])
    seedBinding(path, { userId: 'user_001', channel: 'telegram', channelKey: '1001' })
    // 孤儿绑定（users 无此行）—— 仍出现在清单里，role/display_name 为 null。
    seedBinding(path, { userId: 'ghost_user', channel: 'mac', channelKey: 'dev-1' })
    const rows = store.identityBindingInventory()
    assert.deepEqual(rows, [
      { channel: 'mac', user_id: 'ghost_user', display_name: null, role: null },
      { channel: 'telegram', user_id: 'user_001', display_name: 'owner', role: 'owner_primary' },
    ])
    // D5：channel_key 在返回形状上物理不存在 —— 寻址标识不进任何呈现面。
    for (const row of rows) {
      assert.equal('channel_key' in row, false)
    }
  } finally {
    store.close()
  }
})
