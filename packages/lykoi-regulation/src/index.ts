/**
 * lykoi-regulation — 调节场纯函数（M2 波次 1 交付②）。
 *
 * 规格正本：治理仓库 WO-M2-SPEC-MIND §4（SA-73..SA-82）。
 * 移植自活体 `mind/regulation.py`（HEAD 4463ae8）。
 *
 * SA-73（模块纪律，regulation.py:3-4 逐字）：PURE module —— no sqlite, no I/O,
 * no clock reads。持久化独占归 lykoi-memory 写层（mind/store.py 的对应物）。
 * 本文件 import 面为零、不读 Date.now()、不碰进程环境。
 *
 * 建构规则（regulation.py:7-8 逐字）：每个变量必须有 (a) 更新规则 (b) 衰减规则
 * (c) 对认知的因果出口。三者缺一就不许建 —— 没有因果出口的状态是装饰，
 * 宪法明令禁止。可执行判据 = registryProblems()（SA-81）。
 */

// ============================== 四变量（SA-76） ==============================

export type RegulationVariableName
  = 'coherence' | 'load' | 'relational_tension' | 'exploration_hunger'

export type DecayKind = 'regress' | 'accumulate'

export interface RegulationVariable {
  /** 回归目标（regress）或起点语义（accumulate 从 0 累积）。 */
  baseline: number
  decayKind: DecayKind
  /** 声明的因果出口 key —— 必须由 cognitiveEffects 真实产出（registryProblems 反查）。 */
  outletEffects: readonly string[]
  /** 蓝图原文（SPEC-MIND §4.1 表，逐字）。 */
  outletDoc: string
}

/** SA-76：四变量四元组（regulation.py:111-136 逐字）。 */
export const REGISTRY: Readonly<Record<RegulationVariableName, RegulationVariable>> = {
  coherence: {
    baseline: 0.7,
    decayKind: 'regress',
    outletEffects: ['force_inner_tending', 'flag_low_coherence'],
    outletDoc: '低于 0.4:下次唤醒强制把预算优先给"内部整理";快照中标红',
  },
  load: {
    baseline: 0.2,
    decayKind: 'regress',
    outletEffects: ['budget_multiplier', 'prefer_rest', 'trigger_early_integration'],
    outletDoc: '高于 0.7:唤醒预算减半、倾向 rest;高于 0.9:触发提前整合',
  },
  relational_tension: {
    baseline: 0.3,
    decayKind: 'regress',
    outletEffects: ['relationship_weight_bonus', 'unlock_proactive_contact'],
    outletDoc: '高于 0.6:意义评估中关系类条目权重加成;解锁"主动联系"候选',
  },
  exploration_hunger: {
    baseline: 0.0,
    decayKind: 'accumulate',
    outletEffects: ['exploration_weight_bonus'],
    outletDoc: '高于 0.6:探索类候选权重加成',
  },
}

// ============================== 15 CAUSES（SA-74/75） ==============================

/**
 * SA-74：15 条 CAUSES 的变量与 delta 逐字（regulation.py:27-47，SPEC-MIND §4.2 表）。
 * SA-75：delta 只从这张表查 —— "so a call site cannot invent its own magnitude"
 * （regulation.py:24-25 逐字）。lykoi-memory 写层的 applyRegulationCause 只收 cause
 * 名，接口上不存在 delta 参数；这是移植时最不可妥协的一张表。
 */
export const CAUSES: Readonly<Record<string, readonly [RegulationVariableName, number]>> = {
  integration_completed: ['coherence', +0.15], //  1 integrator（仅 integrated_now 非空，红线 #1）
  suspension_resolved: ['coherence', +0.10], //    2 integrator（revise 解开一条 suspended 线）
  experience_backlog: ['coherence', -0.10], //     3 integrator（count_intake_pending() > 90）
  suspension_overdue: ['coherence', -0.05], //     4 snapshot（24h 闸内一次）
  narrative_conflict: ['coherence', -0.15], //     5 integrator（叙事终拒）
  experience_recorded: ['load', +0.04], //         6 reflow（每条经验）
  action_taken: ['load', +0.06], //                7 reflow（每次非 rest）
  integration_digested: ['load', -0.30], //        8 integrator（仅 absorbs > 0）
  rested: ['load', -0.10], //                      9 reflow
  owner_silence_anomaly: ['relational_tension', +0.15], // 10 reflow cheap_tick
  contact_unanswered: ['relational_tension', +0.20], //    11 reflow cheap_tick（>24h）
  normal_interaction: ['relational_tension', -0.10], //    12 reflow（每轮对话）
  contact_answered: ['relational_tension', -0.15], //      13 reflow（_resolve_contact_answered 唯一写入点）
  concern_lit_unfollowed: ['exploration_hunger', +0.05], // 14 reflow（lit 且 kind ∈ {rest, record_note}）
  explore_completed: ['exploration_hunger', -0.40], //      15 reflow（仅 explore success）
}

// ============================== 衰减双算法（SA-77/78） ==============================

/** SA-77：DECAY_RATE_PER_HOUR 四值逐字（regulation.py:53-58）。 */
export const DECAY_RATE_PER_HOUR: Readonly<Record<RegulationVariableName, number>> = {
  coherence: 0.01, //           缓慢回归 —— 半衰期约 69 小时
  load: 0.03,
  relational_tension: 0.02,
  exploration_hunger: 0.008, // 累积:0→0.6 约 3 天
}

/** clamp01（regulation.py:139-140 逐字）：min(1.0, max(0.0, value))。 */
export function clamp01(value: number): number {
  return Math.min(1.0, Math.max(0.0, value))
}

/** apply_delta_value（regulation.py:156-158 逐字）：clamp01(value + delta)。 */
export function applyDeltaValue(value: number, delta: number): number {
  return clamp01(value + delta)
}

/**
 * SA-77 decay_value（regulation.py:143-153 逐字）—— 懒衰减，读时从 updated_at 起算：
 *   hours_elapsed <= 0 → clamp01(value)（不外推未来）；
 *   regress    → clamp01(baseline + (value - baseline) * exp(-rate * hours))；
 *   accumulate → clamp01(value + rate * hours)（只升不降）。
 */
export function decayValue(
  name: RegulationVariableName,
  value: number,
  hoursElapsed: number,
): number {
  if (hoursElapsed <= 0) return clamp01(value)
  const rate = DECAY_RATE_PER_HOUR[name]
  const variable = REGISTRY[name]
  if (variable.decayKind === 'regress') {
    return clamp01(variable.baseline + (value - variable.baseline) * Math.exp(-rate * hoursElapsed))
  }
  return clamp01(value + rate * hoursElapsed) // accumulate: 只升不降
}

/** 念头 charge 线性衰减速率（regulation.py，SPEC-MIND §4.3）。 */
export const THOUGHT_CHARGE_DECAY = 0.04

/**
 * SA-78 decay_charge（regulation.py:161-177 逐字）—— 与 decayValue 是两个函数，
 * 签名与不变量真不相同（"signatures and invariants are genuinely different, so this
 * is its own function"），新体不得合并：
 *   beats <= 0 → no-op 而非返还 —— "attention can only be paid forward, never refunded"；
 *   否则 max(0.0, charge - THOUGHT_CHARGE_DECAY * beats)。
 */
export function decayCharge(charge: number, beats: number): number {
  if (beats <= 0) return charge
  return Math.max(0.0, charge - THOUGHT_CHARGE_DECAY * beats)
}

// ============================== 念头常量（SA-175/177 消费面） ==============================

/** SA-175：open 念头容量软上限（超出且 charge 不严格大于最低者 → 拒建）。 */
export const THOUGHT_OPEN_CAP = 7
/** SA-177：charge 跌破此值 → abandoned + thought_lapse（regulation.py:84 一带）。 */
export const ABANDON_THRESHOLD = 0.15
/**
 * SA-177：thought_lapse 经验的 salience（regulation.py:86 一带，值 0.2 逐字）。
 * TODO(M2-W1): 该常量在 Python 源中的确切名字未经比对（规格只钉了数值与用途）。
 */
export const THOUGHT_LAPSE_SALIENCE = 0.2
/** 快照念头块 Top-N（SPEC-MIND §2.2：regulation.THOUGHT_SNAPSHOT_TOP = 3）。 */
export const THOUGHT_SNAPSHOT_TOP = 3

// ============================== 八 effects（SA-79/80） ==============================

/** SA-79：THRESHOLDS 五值逐字（regulation.py:61-69）。 */
export const THRESHOLDS = {
  coherence_low: 0.4,
  load_high: 0.7,
  load_high_integration: 0.9, // P4-01: 与 load_high 分离
  tension_high: 0.6,
  hunger_high: 0.6,
} as const

export const RELATIONSHIP_WEIGHT_BONUS = 0.2
export const EXPLORATION_WEIGHT_BONUS = 0.2
/** 高负荷时唤醒预算减半。 */
export const LOAD_BUDGET_MULTIPLIER = 0.5

export type RegulationValues = Readonly<Record<RegulationVariableName, number>>

/** 八个效果键（SA-80；key 逐字，消费方按字符串取）。 */
export interface CognitiveEffects {
  force_inner_tending: boolean
  flag_low_coherence: boolean
  budget_multiplier: number
  prefer_rest: boolean
  trigger_early_integration: boolean
  relationship_weight_bonus: number
  unlock_proactive_contact: boolean
  exploration_weight_bonus: number
}

/**
 * SA-79/80 cognitive_effects（regulation.py:180-204 逐字）。
 * 比较符号是契约：coherence 严格 **<** 0.4，其余三个严格 **>**（恰等于阈值不触发）。
 * P4-01（regulation.py:64-65 逐字）：early-integration trigger isolated above the
 * shared high-load band; prefer_rest / budget_multiplier stay on load_high=0.7 ——
 * 所以 load ∈ (0.7, 0.9] 只被推向休息，不触发提前整合；> 0.9 才两者兼有。
 */
export function cognitiveEffects(values: RegulationValues): CognitiveEffects {
  const lowCoherence = values.coherence < THRESHOLDS.coherence_low //          严格小于
  const highLoad = values.load > THRESHOLDS.load_high //                       严格大于
  const highLoadIntegration = values.load > THRESHOLDS.load_high_integration
  const highTension = values.relational_tension > THRESHOLDS.tension_high
  const highHunger = values.exploration_hunger > THRESHOLDS.hunger_high
  return {
    force_inner_tending: lowCoherence,
    flag_low_coherence: lowCoherence,
    budget_multiplier: highLoad ? LOAD_BUDGET_MULTIPLIER : 1.0,
    prefer_rest: highLoad,
    trigger_early_integration: highLoadIntegration,
    relationship_weight_bonus: highTension ? RELATIONSHIP_WEIGHT_BONUS : 0.0,
    unlock_proactive_contact: highTension,
    exploration_weight_bonus: highHunger ? EXPLORATION_WEIGHT_BONUS : 0.0,
  }
}

// ============================== registry_problems（SA-81） ==============================

/**
 * 测试注入面（SA-81 标【等价】：本移植把被检对象参数化，缺省即真注册表；
 * Python 版直接读模块全局，语义相同）。
 */
export interface RegistryProblemsSubject {
  registry?: Readonly<Record<string, RegulationVariable>>
  causes?: Readonly<Record<string, readonly [string, number]>>
  decayRatePerHour?: Readonly<Record<string, number>>
}

/**
 * SA-81 registry_problems（regulation.py:219-266 全套移植）——
 * "没有因果出口的状态是装饰"这条宪法的可执行判据。空列表 == 注册表遵守蓝图。
 *
 * 对每个变量检查（§4.6）：baseline ∈ [0,1]；decay_kind 合法；有 decay rate 且 > 0；
 * accumulate 变量必须有显式泄压因（delta < 0 的 cause）；有升因；有降因；
 * 有 outlet_effects；每个声明的 outlet key 确实由 cognitive_effects 产出。
 * 功能性证明（:247-258）：把变量推到 0.0 / 1.0 两个极值，其声明的效果必须相对
 * neutral（全体取各自 baseline）至少动一个，否则报 "outlet never fires (因果出口不通)"。
 * 反向检查（:259-265）：effect_keys - claimed → "effect {key!r} claimed by no variable"；
 * 每条 cause 的目标变量必须存在、delta 非零。
 */
export function registryProblems(subject: RegistryProblemsSubject = {}): string[] {
  const registry = subject.registry ?? REGISTRY
  const causes = subject.causes ?? CAUSES
  const rates: Readonly<Record<string, number>> = subject.decayRatePerHour ?? DECAY_RATE_PER_HOUR
  const problems: string[] = []

  // neutral：四个正典变量各取其（被检注册表内的，缺席则真注册表的）baseline。
  const canonical = Object.keys(REGISTRY) as RegulationVariableName[]
  const neutralValues = {} as Record<RegulationVariableName, number>
  for (const name of canonical) {
    neutralValues[name] = registry[name]?.baseline ?? REGISTRY[name].baseline
  }
  const neutralEffects = cognitiveEffects(neutralValues)
  const effectKeys = Object.keys(neutralEffects)

  const claimed = new Set<string>()
  for (const [name, variable] of Object.entries(registry)) {
    if (!(variable.baseline >= 0.0 && variable.baseline <= 1.0)) {
      problems.push(`${name}: baseline ${variable.baseline} outside [0, 1]`)
    }
    if (variable.decayKind !== 'regress' && variable.decayKind !== 'accumulate') {
      problems.push(`${name}: unknown decay kind ${quoted(String(variable.decayKind))}`)
    }
    const rate = rates[name]
    if (rate === undefined || !(rate > 0)) {
      problems.push(`${name}: no positive decay rate (衰减规则缺席)`)
    }
    const deltas = Object.values(causes)
      .filter(([target]) => target === name)
      .map(([, delta]) => delta)
    if (variable.decayKind === 'accumulate' && !deltas.some((d) => d < 0)) {
      problems.push(`${name}: accumulate variable has no explicit relief cause (泄压因缺席)`)
    }
    if (!deltas.some((d) => d > 0)) {
      problems.push(`${name}: no cause raises it (升因缺席)`)
    }
    if (!deltas.some((d) => d < 0)) {
      problems.push(`${name}: no cause lowers it (降因缺席)`)
    }
    if (variable.outletEffects.length === 0) {
      problems.push(`${name}: no outlet effects (因果出口缺席)`)
    }
    for (const key of variable.outletEffects) {
      claimed.add(key)
      if (!effectKeys.includes(key)) {
        problems.push(`${name}: outlet ${quoted(key)} not produced by cognitive_effects`)
      }
    }
    // 功能性证明：极值 0.0 / 1.0 下，声明的效果必须相对 neutral 至少动一个。
    if (variable.outletEffects.length > 0 && canonicalName(name)) {
      const moved = [0.0, 1.0].some((extreme) => {
        const values = { ...neutralValues, [name]: extreme }
        const effects = cognitiveEffects(values) as unknown as Record<string, unknown>
        return variable.outletEffects.some(
          (key) => effects[key] !== (neutralEffects as unknown as Record<string, unknown>)[key],
        )
      })
      if (!moved) problems.push(`${name}: outlet never fires (因果出口不通)`)
    } else if (variable.outletEffects.length > 0) {
      // 非正典变量无法进入 cognitiveEffects 的输入面 → 它声明的出口必然不通。
      problems.push(`${name}: outlet never fires (因果出口不通)`)
    }
  }

  // 反向检查：无主 effect。
  for (const key of effectKeys) {
    if (!claimed.has(key)) {
      problems.push(`effect ${quoted(key)} claimed by no variable`)
    }
  }
  // 每条 cause 的目标变量必须存在、delta 非零。
  for (const [cause, [target, delta]] of Object.entries(causes)) {
    if (!(target in registry)) {
      problems.push(`cause ${quoted(cause)} targets unknown variable ${quoted(target)}`)
    }
    if (delta === 0) {
      problems.push(`cause ${quoted(cause)} has zero delta`)
    }
  }
  return problems
}

/** Python `{key!r}` 的输出形态（单引号包裹）—— 消息片段是契约（§4.6 逐字）。 */
function quoted(key: string): string {
  return `'${key}'`
}

function canonicalName(name: string): name is RegulationVariableName {
  return name in REGISTRY
}
