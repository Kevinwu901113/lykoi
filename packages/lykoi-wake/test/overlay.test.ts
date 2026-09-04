/**
 * WO-OVERLAY-WAKE-01 D-2：wake 侧 overlay 读闭包 —— 渲染在 decide，这里只验落账
 * 口径：非空一条 injected（origin:'wake'）；空态零字节零事件；读失败一条
 * read_failed（origin:'wake'）+ 零字节。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { RELATIONSHIP_OVERLAY_HEADER, type OverlayReader } from 'lykoi-decide'
import { overlayMessageDep } from '../src/index.ts'

function harness(store: OverlayReader) {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const dep = overlayMessageDep(store, (name, fields) => { events.push({ name, fields: fields ?? {} }) })
  return { dep, events }
}

test('有 overlay 行 → 段非空 + relationship_overlay_injected{origin:wake}', () => {
  const h = harness({
    ownerPrimaryUserId: () => 'user_001',
    promotedRelationshipInsights: () => [{ content: '他忙起来就不爱说话' }, { content: '不用铺垫' }],
  })
  assert.equal(h.dep(), RELATIONSHIP_OVERLAY_HEADER + '- 他忙起来就不爱说话\n- 不用铺垫')
  assert.deepEqual(h.events, [{
    name: 'relationship_overlay_injected',
    fields: { count: 2, subject_user_id: 'user_001', origin: 'wake' },
  }])
})

test('无行 / owner 未登记 → 零字节零事件', () => {
  const empty = harness({
    ownerPrimaryUserId: () => 'user_001',
    promotedRelationshipInsights: () => [],
  })
  assert.equal(empty.dep(), '')
  assert.deepEqual(empty.events, [])
  const noOwner = harness({
    ownerPrimaryUserId: () => null,
    promotedRelationshipInsights: () => { throw new Error('must not be called') },
  })
  assert.equal(noOwner.dep(), '')
  assert.deepEqual(noOwner.events, [])
})

test('读抛错 → relationship_overlay_read_failed{origin:wake} + 零字节', () => {
  const h = harness({
    ownerPrimaryUserId: () => 'user_001',
    promotedRelationshipInsights: () => { throw new RangeError('db') },
  })
  assert.equal(h.dep(), '')
  assert.deepEqual(h.events, [{
    name: 'relationship_overlay_read_failed',
    fields: { error_type: 'RangeError', origin: 'wake' },
  }])
})
