/**
 * golden devstate 冒烟（gated：LYKOI_DEVSTATE_DB 未注入即 skip）。
 * 数据纪律：golden 永远只读 —— 先 copy 进 os.tmpdir 副本再 rw 打开；
 * 她的行内容零输出（断言只看结构与计数，任何失败信息不携带正文）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFileSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { makeConversation } from './fixture.ts'

const DEVSTATE = process.env.LYKOI_DEVSTATE_DB

test('devstate 副本上的真装配：三段带成立、块集合法、正文零输出', { skip: !DEVSTATE }, () => {
  const before = statSync(DEVSTATE!).mtimeMs
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-devstate-'))
  const copy = join(dir, 'memory.db')
  copyFileSync(DEVSTATE!, copy)
  const store = new ReadWriteMemory(copy)
  try {
    const h = makeConversation({ prepared: { store, path: copy } })
    const layout = h.conversation.assembleLayout()
    // 三段带骨架恒在；可空块只允许出自十二块词表。
    assert.equal(layout[0], 'persona')
    assert.ok(layout.includes('history'))
    assert.ok(layout.includes('time'))
    const legal = new Set([
      'persona', 'organs', 'narrative', 'backfill', 'summary', 'concerns',
      'history', 'memories', 'thoughts', 'time', 'undelivered', 'self_state',
    ])
    for (const tag of layout) {
      assert.ok(legal.has(tag), 'unknown block tag')
    }
    // 稳定段顺序（出现者之间的相对序 = S-24）。
    const order = ['persona', 'organs', 'narrative', 'backfill', 'summary', 'concerns', 'history']
    const present = order.filter((t) => layout.includes(t))
    assert.deepEqual(layout.slice(0, present.length), present)
  } finally {
    store.close()
  }
  // golden 只读纪律：mtime 未变。
  assert.equal(statSync(DEVSTATE!).mtimeMs, before)
})
