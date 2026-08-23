/** SA-81：registry_problems —— 真注册表空列表 + 人为破坏各类必报。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAUSES,
  REGISTRY,
  registryProblems,
  type RegulationVariable,
} from '../src/index.ts'

function cloneRegistry(): Record<string, RegulationVariable> {
  const out: Record<string, RegulationVariable> = {}
  for (const [k, v] of Object.entries(REGISTRY)) out[k] = { ...v, outletEffects: [...v.outletEffects] }
  return out
}

test('SA-81：真注册表 registry_problems() == []（注册表遵守蓝图）', () => {
  assert.deepEqual(registryProblems(), [])
})

test('破坏：baseline 出界必报', () => {
  const registry = cloneRegistry()
  registry.coherence = { ...registry.coherence!, baseline: 1.5 }
  const problems = registryProblems({ registry })
  assert.ok(problems.some((p) => p.includes('coherence') && p.includes('baseline')), problems.join('; '))
})

test('破坏：未知 decay_kind 必报', () => {
  const registry = cloneRegistry()
  registry.load = { ...registry.load!, decayKind: 'melt' as RegulationVariable['decayKind'] }
  const problems = registryProblems({ registry })
  assert.ok(problems.some((p) => p.includes('load') && p.includes('decay kind')), problems.join('; '))
})

test('破坏：decay rate 缺席 / 非正必报（衰减规则缺席）', () => {
  const missing = registryProblems({
    decayRatePerHour: { coherence: 0.01, load: 0.03, relational_tension: 0.02 },
  })
  assert.ok(missing.some((p) => p.includes('exploration_hunger') && p.includes('decay rate')))
  const zero = registryProblems({
    decayRatePerHour: { coherence: 0, load: 0.03, relational_tension: 0.02, exploration_hunger: 0.008 },
  })
  assert.ok(zero.some((p) => p.includes('coherence') && p.includes('decay rate')))
})

test('破坏：accumulate 变量没有显式泄压因必报', () => {
  const causes = Object.fromEntries(
    Object.entries(CAUSES).filter(([name]) => name !== 'explore_completed'),
  )
  const problems = registryProblems({ causes })
  assert.ok(
    problems.some((p) => p.includes('exploration_hunger') && p.includes('泄压因')),
    problems.join('; '),
  )
})

test('破坏：升因/降因缺席必报', () => {
  const noRaise = Object.fromEntries(
    Object.entries(CAUSES).filter(([name]) => !['integration_completed', 'suspension_resolved'].includes(name)),
  )
  assert.ok(registryProblems({ causes: noRaise }).some((p) => p.includes('coherence') && p.includes('升因')))
  const noLower = Object.fromEntries(
    Object.entries(CAUSES).filter(([name]) => !['integration_digested', 'rested'].includes(name)),
  )
  assert.ok(registryProblems({ causes: noLower }).some((p) => p.includes('load') && p.includes('降因')))
})

test('破坏：outlet_effects 为空必报（没有因果出口的状态是装饰）', () => {
  const registry = cloneRegistry()
  registry.relational_tension = { ...registry.relational_tension!, outletEffects: [] }
  const problems = registryProblems({ registry })
  assert.ok(problems.some((p) => p.includes('relational_tension') && p.includes('因果出口缺席')))
})

test('破坏：声明了 cognitive_effects 不产出的 outlet key 必报', () => {
  const registry = cloneRegistry()
  registry.coherence = {
    ...registry.coherence!,
    outletEffects: ['force_inner_tending', 'flag_low_coherence', 'no_such_effect'],
  }
  const problems = registryProblems({ registry })
  assert.ok(problems.some((p) => p.includes("'no_such_effect'") && p.includes('not produced')))
})

test('SA-81 功能性证明：出口永不点火必报 "outlet never fires (因果出口不通)"', () => {
  // 非正典变量声明了真实存在的 effect key，但它的值进不了 cognitive_effects 的输入面。
  const registry = cloneRegistry()
  registry.phantom = {
    baseline: 0.5,
    decayKind: 'regress',
    outletEffects: ['prefer_rest'],
    outletDoc: '（测试用）',
  }
  const causes = {
    ...CAUSES,
    phantom_up: ['phantom', +0.1] as const,
    phantom_down: ['phantom', -0.1] as const,
  }
  const rates = { coherence: 0.01, load: 0.03, relational_tension: 0.02, exploration_hunger: 0.008, phantom: 0.01 }
  const problems = registryProblems({ registry, causes, decayRatePerHour: rates })
  assert.ok(
    problems.some((p) => p.includes('phantom: outlet never fires (因果出口不通)')),
    problems.join('; '),
  )
})

test('SA-81 反向检查：无主 effect 必报 "effect {key!r} claimed by no variable"', () => {
  const registry = cloneRegistry()
  registry.exploration_hunger = { ...registry.exploration_hunger!, outletEffects: [] }
  const problems = registryProblems({ registry })
  assert.ok(
    problems.includes("effect 'exploration_weight_bonus' claimed by no variable"),
    problems.join('; '),
  )
})

test('破坏：cause 指向不存在变量 / delta 为零必报', () => {
  const causes = {
    ...CAUSES,
    ghost_cause: ['no_such_variable', 0.1] as const,
    zero_cause: ['coherence', 0] as const,
  }
  const problems = registryProblems({ causes })
  assert.ok(problems.some((p) => p.includes("'ghost_cause'") && p.includes('unknown variable')))
  assert.ok(problems.some((p) => p.includes("'zero_cause'") && p.includes('zero delta')))
})
