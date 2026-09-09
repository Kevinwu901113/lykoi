/** Regulation state, decay and model-visible preferences. State does not remove choices or discount actual budgets. */
export type RegulationVariableName
  = 'coherence' | 'load' | 'relational_tension' | 'exploration_hunger'

export type DecayKind = 'regress' | 'accumulate'

export interface RegulationVariable {
  /** 回归目标（regress）或起点语义（accumulate 从 0 累积）。 */
  baseline: number
  decayKind: DecayKind
  /** 声明的因果出口 key —— 必须由 cognitiveEffects 真实产出（registryProblems 反查）。 */
  outletEffects: readonly string[]
  /** 当前认知出口的说明。 */
  outletDoc: string
}

/** 调节变量及其基线、衰减方式与效果映射。 */
export const REGISTRY: Readonly<Record<RegulationVariableName, RegulationVariable>> = {
  coherence: {
    baseline: 0.7,
    decayKind: 'regress',
    outletEffects: ['flag_low_coherence'],
    outletDoc: '低于 0.4:快照中提示连贯感较低，供自主选择时参考',
  },
  load: {
    baseline: 0.2,
    decayKind: 'regress',
    outletEffects: ['trigger_early_integration'],
    outletDoc: '高于 0.9:触发提前整合',
  },
  relational_tension: {
    baseline: 0.3,
    decayKind: 'regress',
    outletEffects: ['relationship_weight_bonus', 'unlock_proactive_contact'],
    outletDoc: '高于 0.6:意义评估中关系类条目权重加成;提示主动联系倾向',
  },
  exploration_hunger: {
    baseline: 0.0,
    decayKind: 'accumulate',
    outletEffects: ['exploration_weight_bonus'],
    outletDoc: '高于 0.6:探索类候选权重加成',
  },
}

/** 调节原因与变化量的集中定义。状态写入方按原因查询，调用点不自行传入变化量。 */
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

/** 各变量每小时的衰减或累积速率。 */
export const DECAY_RATE_PER_HOUR: Readonly<Record<RegulationVariableName, number>> = {
  coherence: 0.01, //           缓慢回归 —— 半衰期约 69 小时
  load: 0.03,
  relational_tension: 0.02,
  exploration_hunger: 0.008, // 累积:0→0.6 约 3 天
}

/** 将调节值限制在 [0, 1]。 */
export function clamp01(value: number): number {
  return Math.min(1.0, Math.max(0.0, value))
}

/** 应用变化量并保持调节值的取值范围。 */
export function applyDeltaValue(value: number, delta: number): number {
  return clamp01(value + delta)
}

/**
 * 按经过的小时数计算调节值：regress 指数回归基线，accumulate 线性累积。
 * 非正时间间隔不向未来外推；结果保持在 [0, 1]。
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

/** 念头 charge 每拍的线性衰减速率。 */
export const THOUGHT_CHARGE_DECAY = 0.04

/**
 * 按拍数衰减念头 charge，最低为零；非正拍数不返还注意力。
 * 它与按小时回归基线的 decayValue 使用不同的时间单位与状态含义。
 */
export function decayCharge(charge: number, beats: number): number {
  if (beats <= 0) return charge
  return Math.max(0.0, charge - THOUGHT_CHARGE_DECAY * beats)
}

/** open 念头的容量上限；超出且 charge 不高于最低者时拒绝新建。 */
export const THOUGHT_OPEN_CAP = 7
/** charge 低于此值时标记 abandoned 并生成 thought_lapse 经验。 */
export const ABANDON_THRESHOLD = 0.15
/** thought_lapse 经验的 salience。 */
export const THOUGHT_LAPSE_SALIENCE = 0.2
/** 快照中呈现的念头数量上限。 */
export const THOUGHT_SNAPSHOT_TOP = 3
/** open question 念头超龄小时数；快照维护将其与超龄悬置线合并为同一个惩罚原因。 */
export const QUESTION_OVERDUE_HOURS = 48

/** 当前认知效果的触发阈值。 */
export const THRESHOLDS = {
  coherence_low: 0.4,
  load_high_integration: 0.9,
  tension_high: 0.6,
  hunger_high: 0.6,
} as const

export const RELATIONSHIP_WEIGHT_BONUS = 0.2
export const EXPLORATION_WEIGHT_BONUS = 0.2

export type RegulationValues = Readonly<Record<RegulationVariableName, number>>

/** 认知效果字段；消费方读取这些字段决定当前行为。 */
export interface CognitiveEffects {
  flag_low_coherence: boolean
  trigger_early_integration: boolean
  relationship_weight_bonus: number
  unlock_proactive_contact: boolean
  exploration_weight_bonus: number
}

/**
 * 低 coherence 使用严格小于，其余阈值使用严格大于，等于阈值不触发。
 * load 高于 0.9 触发提前整合；其原始读数供模型解释。
 */
export function cognitiveEffects(values: RegulationValues): CognitiveEffects {
  const lowCoherence = values.coherence < THRESHOLDS.coherence_low //          严格小于
  const highLoadIntegration = values.load > THRESHOLDS.load_high_integration
  const highTension = values.relational_tension > THRESHOLDS.tension_high
  const highHunger = values.exploration_hunger > THRESHOLDS.hunger_high
  return {
    flag_low_coherence: lowCoherence,
    trigger_early_integration: highLoadIntegration,
    relationship_weight_bonus: highTension ? RELATIONSHIP_WEIGHT_BONUS : 0.0,
    unlock_proactive_contact: highTension,
    exploration_weight_bonus: highHunger ? EXPLORATION_WEIGHT_BONUS : 0.0,
  }
}

/** 可注入的检查对象；省略时检查当前变量、原因和衰减表。 */
export interface RegistryProblemsSubject {
  registry?: Readonly<Record<string, RegulationVariable>>
  causes?: Readonly<Record<string, readonly [string, number]>>
  decayRatePerHour?: Readonly<Record<string, number>>
}

/**
 * 检查变量取值范围、衰减率、升降原因和认知出口。
 * 将变量推向两个极值，验证声明的效果确实变化，并检查无主效果与无效原因。
 * 返回空列表表示未发现注册定义问题。
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

/** 在诊断文本中用单引号包裹名称。 */
function quoted(key: string): string {
  return `'${key}'`
}

function canonicalName(name: string): name is RegulationVariableName {
  return name in REGISTRY
}
