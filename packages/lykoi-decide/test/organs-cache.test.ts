/**
 * OrganInventoryCache（SA-160；W5 收口）：进程级缓存 / 空清单 → null /
 * invalidate 零读 / organ_inventory_built 事件 / 绑定读失败不毁一轮对话。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OrganInventoryCache, unwiredActionCatalog, type OrganBindingRow,
} from '../src/index.ts'

const BINDING: OrganBindingRow = {
  channel: 'telegram', user_id: 'user_001', display_name: 'owner', role: 'owner_primary',
}

function mk(bindings: () => readonly OrganBindingRow[]) {
  const events: [string, Record<string, unknown>][] = []
  const cache = new OrganInventoryCache({
    bindings,
    catalog: unwiredActionCatalog,
    logEvent: (n, f) => events.push([n, f]),
  })
  return { cache, events }
}

test('构建一次即缓存（每进程一次；不重复读登记处）+ organ_inventory_built 事件恰一条', () => {
  let reads = 0
  const { cache, events } = mk(() => {
    reads += 1
    return [BINDING]
  })
  const first = cache.block()
  assert.ok(first !== null && first.startsWith('[器官清单(只读)]'))
  assert.ok(first.includes('- telegram: owner — 所有者, 也是你的主用户'))
  assert.equal(cache.block(), first)
  assert.equal(reads, 1)
  assert.deepEqual(events.map(([n]) => n), ['organ_inventory_built'])
  assert.equal(events[0]![1].chars, first.length)
})

test('invalidate 零读：释放缓存本身不读登记处；下次 block() 才重新派生（S-27 整合边界的钩子）', () => {
  let reads = 0
  const { cache } = mk(() => {
    reads += 1
    return [BINDING]
  })
  cache.block()
  assert.equal(reads, 1)
  cache.invalidate()
  assert.equal(reads, 1, 'invalidate 自身零读')
  cache.block()
  assert.equal(reads, 2)
})

test('空清单 → null（判据⑧a 空态不注入）；unwired 动作面 = 动作段整段不出现', () => {
  const { cache, events } = mk(() => [])
  assert.equal(cache.block(), null)
  assert.equal(events[0]![1].chars, 0)
})

test('绑定读失败 → organ_inventory_bindings_failed + 身份段省略，不抛（不毁一轮对话）', () => {
  const { cache, events } = mk(() => {
    throw new TypeError('registry unreadable')
  })
  assert.equal(cache.block(), null) // 绑定段省略 + unwired 动作面 = 全空 → null
  assert.deepEqual(events.map(([n]) => n), ['organ_inventory_bindings_failed', 'organ_inventory_built'])
  assert.equal(events[0]![1].error_type, 'TypeError')
})
