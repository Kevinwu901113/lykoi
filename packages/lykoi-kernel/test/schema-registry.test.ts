/**
 * 身体图式注册表（GK-11 / DK-15）—— **验收四条**逐条实测：
 *   ①注册即感知（插件注册 → 身体图式可见）
 *   ②可逆副作用登记
 *   ③卸载即消失（无幻肢）
 *   ④认知可读不可写
 *
 * 设计正本：docs/m3_schema_registry.md。①③另跑一遍与 M2 已有
 * `OrganInventoryCache`（只读渲染器）的接合 —— 那才是「她真的读到了」的面。
 *
 * 时钟纪律：零时间语义（没有一条断言依赖"还活着/没过期"）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { OrganInventoryCache } from 'lykoi-decide'
import { BodySchemaRegistry, registryActionCatalog } from '../src/schema-registry.ts'
import { setKernelLogEvent } from '../src/telemetry.ts'

/** 词汇表替身（kernel KNOWN_ACTIONS 的子集形状）。 */
const VOCAB = [
  'messenger.send', 'messenger.read', 'notify.owner',
  'autonomy.initiate_chat', 'autonomy.queue_notification',
  'terminal.exec', 'browser.navigate',
]

function capture(): { events: { name: string; fields: Record<string, unknown> }[]; stop: () => void } {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  setKernelLogEvent((name, fields) => events.push({ name, fields }))
  return { events, stop: () => setKernelLogEvent(null) }
}

// ============================== ① 注册即感知 ==============================

test('①注册即感知：register → snapshot 与 catalog 立刻看得见', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  assert.deepEqual(registry.snapshot().organs, [])
  assert.deepEqual(registry.snapshot().actions, [])

  registry.register({
    organId: 'telegram',
    actions: ['messenger.send', 'messenger.read'],
    sideEffects: [],
  })

  const schema = registry.snapshot()
  assert.deepEqual(schema.organs.map((o) => o.organId), ['telegram'])
  assert.deepEqual([...schema.actions], ['messenger.read', 'messenger.send'])
  assert.deepEqual([...registryActionCatalog(registry, () => false).knownActions],
    ['messenger.read', 'messenger.send'])
})

test('①注册即感知（与 OrganInventoryCache 接合）：注册 → 她的器官清单里出现', () => {
  let generation = 0
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB, onChange: () => { generation += 1 } })
  const organs = new OrganInventoryCache({
    bindings: () => [{ channel: 'telegram', role: 'owner_primary', display_name: 'Kevin' }],
    catalog: registryActionCatalog(registry, (a) => a === 'terminal.exec'),
  })

  // 一个器官都没注册：动作段整段不出现（清单如实说"接得通的没有"）。
  const before = organs.block() ?? ''
  assert.equal(before.includes('动作能力'), false, '没注册就不该有动作段')

  registry.register({ organId: 'telegram', actions: ['messenger.send', 'messenger.read'], sideEffects: [] })
  assert.equal(generation, 1, 'onChange 是接线方失效缓存的钩子')
  organs.invalidate() // 接线方的编排（注册表不反向依赖认知层）

  const after = organs.block() ?? ''
  assert.match(after, /动作能力/)
  assert.match(after, /messenger\.read、messenger\.send/)
  assert.match(after, /IM 收发\(她的社交躯体\)/)
})

test('①：注册的动作必须 ⊆ 词汇表 —— 编不出词汇表以外的器官', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  assert.throws(
    () => registry.register({ organId: 'ghost', actions: ['nuclear.launch'], sideEffects: [] }),
    /actions outside the vocabulary: nuclear\.launch/,
  )
  assert.deepEqual(registry.organIds(), [], '抛了就不该留下半个登记')
})

test('①：同一个 organId 不许注册两次（重复注册 = 接线错误，大声抛）', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  registry.register({ organId: 'telegram', actions: [], sideEffects: [] })
  assert.throws(
    () => registry.register({ organId: 'telegram', actions: [], sideEffects: [] }),
    /organ already registered: telegram/,
  )
})

// ============================== ② 可逆副作用登记 ==============================

test('②可逆副作用登记：reversible:true 必须带 reverse（"可逆"是函数不是形容词）', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  assert.throws(
    () => registry.register({
      organId: 'telegram',
      actions: [],
      sideEffects: [{ kind: 'state_file', target: 'chat_outbox.json', reversible: true }],
    }),
    /declares reversible:true but provides no reverse\(\)/,
  )
})

test('②：sideEffects 必须显式给 —— 「忘了写」和「确实没有」是两件事', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  assert.throws(
    // @ts-expect-error 刻意漏掉 sideEffects：这正是要被逮住的接线错误
    () => registry.register({ organId: 'telegram', actions: [] }),
    /sideEffects must be given explicitly \(use \[\] for none\)/,
  )
  // 空数组是一次声明，合格。
  registry.register({ organId: 'telegram', actions: [], sideEffects: [] })
  assert.deepEqual(registry.organIds(), ['telegram'])
})

test('②：注销时可逆副作用按 LIFO 逆回去；不可逆的**留在账上**不静默消失', () => {
  const cap = capture()
  try {
    const order: string[] = []
    const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
    const dispose = registry.register({
      organId: 'telegram',
      actions: ['messenger.send'],
      sideEffects: [
        { kind: 'state_file', target: 'chat_outbox.json', reversible: true, reverse: () => order.push('outbox') },
        { kind: 'cursor', target: 'telegram_outbox.cursor', reversible: true, reverse: () => order.push('cursor') },
        { kind: 'outbound_message', target: 'telegram:owner', reversible: false },
      ],
    })

    dispose()
    assert.deepEqual(order, ['cursor', 'outbox'], 'LIFO：后登记的先逆')

    const reversed = cap.events.filter((e) => e.name === 'organ_side_effect_reversed')
    assert.deepEqual(reversed.map((e) => e.fields.target), ['telegram_outbox.cursor', 'chat_outbox.json'])
    const retained = cap.events.filter((e) => e.name === 'organ_side_effect_irreversible_retained')
    assert.equal(retained.length, 1)
    assert.equal(retained[0]!.fields.target, 'telegram:owner')
  } finally {
    cap.stop()
  }
})

test('②：某一条 reverse 抛了不阻断其余条（半个注销比不注销更像幻肢）', () => {
  const cap = capture()
  try {
    const done: string[] = []
    const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
    const dispose = registry.register({
      organId: 'telegram',
      actions: [],
      sideEffects: [
        { kind: 'state_file', target: 'a', reversible: true, reverse: () => done.push('a') },
        { kind: 'state_file', target: 'b', reversible: true, reverse: () => { throw new Error('boom') } },
        { kind: 'state_file', target: 'c', reversible: true, reverse: () => done.push('c') },
      ],
    })
    dispose()
    assert.deepEqual(done, ['c', 'a'], 'b 抛了，a 和 c 照样逆回去')
    const failed = cap.events.filter((e) => e.name === 'organ_side_effect_reverse_failed')
    assert.equal(failed.length, 1)
    assert.equal(failed[0]!.fields.target, 'b')
    assert.equal(failed[0]!.fields.error, 'boom')
    assert.deepEqual(registry.organIds(), [], '器官照样摘干净')
  } finally {
    cap.stop()
  }
})

// ============================== ③ 卸载即消失（无幻肢） ==============================

test('③卸载即消失：dispose 之后 snapshot / catalog / 器官清单里都没有它', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  const organs = new OrganInventoryCache({
    bindings: () => [{ channel: 'telegram', role: 'owner_primary', display_name: 'Kevin' }],
    catalog: registryActionCatalog(registry, () => false),
  })
  const dispose = registry.register({
    organId: 'telegram', actions: ['messenger.send'], sideEffects: [],
  })
  organs.invalidate()
  assert.match(organs.block() ?? '', /messenger\.send/)

  dispose()
  organs.invalidate()

  assert.deepEqual(registry.snapshot().organs, [])
  assert.deepEqual([...registry.snapshot().actions], [])
  assert.deepEqual([...registryActionCatalog(registry, () => false).knownActions], [])
  const after = organs.block() ?? ''
  assert.equal(after.includes('messenger.send'), false, '幻肢：清单还念着一个已经卸下的器官')
  assert.equal(after.includes('动作能力'), false)
})

test('③：注销器幂等 —— 第二次调用是 no-op，不重跑 reverse', () => {
  let reversals = 0
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  const dispose = registry.register({
    organId: 'telegram',
    actions: [],
    sideEffects: [{ kind: 'state_file', target: 'a', reversible: true, reverse: () => { reversals += 1 } }],
  })
  dispose()
  dispose()
  dispose()
  assert.equal(reversals, 1)
})

test('③：卸一个不影响另一个（多器官在位时的摘除是精确的）', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  const disposeA = registry.register({ organId: 'telegram', actions: ['messenger.send'], sideEffects: [] })
  registry.register({ organId: 'notify', actions: ['notify.owner'], sideEffects: [] })
  assert.deepEqual(registry.organIds(), ['telegram', 'notify'])

  disposeA()
  assert.deepEqual(registry.organIds(), ['notify'])
  assert.deepEqual([...registry.snapshot().actions], ['notify.owner'])
})

// ============================== ④ 认知可读不可写 ==============================

test('④认知可读不可写：snapshot 逐层冻结，改不动', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  registry.register({
    organId: 'telegram',
    actions: ['messenger.send'],
    sideEffects: [{ kind: 'state_file', target: 'chat_outbox.json', reversible: true, reverse: () => {} }],
  })
  const schema = registry.snapshot()

  assert.equal(Object.isFrozen(schema), true)
  assert.equal(Object.isFrozen(schema.organs), true)
  assert.equal(Object.isFrozen(schema.actions), true)
  assert.equal(Object.isFrozen(schema.organs[0]), true)
  assert.equal(Object.isFrozen(schema.organs[0]!.actions), true)
  assert.equal(Object.isFrozen(schema.organs[0]!.sideEffects), true)
  assert.equal(Object.isFrozen(schema.organs[0]!.sideEffects[0]), true)

  // 严格模式（ESM 模块天然严格）下写冻结对象直接抛。
  assert.throws(() => { (schema.organs as unknown as unknown[]).push({}) }, TypeError)
  assert.throws(() => { (schema.actions as unknown as string[]).push('terminal.exec') }, TypeError)
  // 就算硬改也改不动注册表本身。
  assert.deepEqual([...registry.snapshot().actions], ['messenger.send'])
})

test('④：认知面拿不到 reverse 句柄（读得到"这条可逆"，读不到"怎么逆"）', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  registry.register({
    organId: 'telegram',
    actions: [],
    sideEffects: [{ kind: 'state_file', target: 'chat_outbox.json', reversible: true, reverse: () => {} }],
  })
  const decl = registry.snapshot().organs[0]!.sideEffects[0]!
  assert.deepEqual(Object.keys(decl).sort(), ['kind', 'reversible', 'target'])
  assert.equal('reverse' in decl, false, 'reverse 是接线方的能力，不进认知面')
})

test('④：派生视图是 OrganActionCatalog 形状 —— 没有一个 mutator', () => {
  const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
  const catalog = registryActionCatalog(registry, (a) => a === 'terminal.exec')
  assert.deepEqual(Object.keys(catalog).sort(), ['isHardGated', 'knownActions'])
  assert.equal(Object.isFrozen(catalog), true)
  assert.equal(catalog.isHardGated('terminal.exec'), true)
  assert.equal(catalog.isHardGated('messenger.send'), false)

  // 视图是活的：注册表变了它跟着变（但方向只有一个 —— 读）。
  registry.register({ organId: 'telegram', actions: ['messenger.send'], sideEffects: [] })
  assert.deepEqual([...catalog.knownActions], ['messenger.send'])
})

// ============================== 遥测 ==============================

test('注册/注销各落一条遥测（organ_registered / organ_unregistered）', () => {
  const cap = capture()
  try {
    const registry = new BodySchemaRegistry({ vocabulary: VOCAB })
    const dispose = registry.register({
      organId: 'telegram',
      actions: ['messenger.send', 'messenger.read'],
      sideEffects: [{ kind: 'state_file', target: 'a', reversible: false }],
    })
    dispose()
    const names = cap.events.map((e) => e.name)
    assert.deepEqual(names, [
      'organ_registered', 'organ_side_effect_irreversible_retained', 'organ_unregistered',
    ])
    assert.deepEqual(cap.events[0]!.fields, { organ_id: 'telegram', actions: 2, side_effects: 1 })
  } finally {
    cap.stop()
  }
})
