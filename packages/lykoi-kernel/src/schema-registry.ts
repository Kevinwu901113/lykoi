/** BodySchema declaration validation and immutable snapshots.
 * Runtime owns production instances and the attached capability names.
 * Registration describes attached organs, not all theoretically valid actions.
 */
import { logEvent } from './telemetry.ts'

import type { SideEffectDeclaration, OrganRegistration, OrganSchema, BodySchema, ReadOnlyActionCatalog, OrganDisposer, RuntimeLog } from 'lykoi-contracts'
export type { SideEffectDeclaration, OrganRegistration, OrganSchema, BodySchema, ReadOnlyActionCatalog, OrganDisposer } from 'lykoi-contracts'

function deepFreezeSideEffect(
  decl: SideEffectDeclaration,
): Readonly<Omit<SideEffectDeclaration, 'reverse'>> {
  // `reverse` 是接线方的能力，**刻意不进认知面**：认知读得到「这条副作用可逆」，
  // 读不到「怎么把它逆回来」（§5 可读不可写的一半）。
  return Object.freeze({ kind: decl.kind, target: decl.target, reversible: decl.reversible })
}

/**
 * 身体图式注册表。
 *
 * @param vocabulary Optional vocabulary restriction for callers that explicitly need one.
 * @param onChange 注册/注销后的回调（接线方在这里调 `organs.invalidate()`）。
 *   缓存失效是**接线方的编排**，不是注册表反向依赖认知层。
 */
export class BodySchemaRegistry {
  #log: RuntimeLog
  #vocabulary: ReadonlySet<string> | undefined
  #onChange: (() => void) | undefined
  #organs = new Map<string, OrganRegistration>()
  #order: string[] = []

  constructor(opts: {
    vocabulary?: Iterable<string>
    onChange?: () => void
    logEvent?: RuntimeLog
  }) {
    this.#log = opts.logEvent ?? logEvent
    this.#vocabulary = opts.vocabulary ? new Set(opts.vocabulary) : undefined
    this.#onChange = opts.onChange
  }

  /**
   * 登记一个器官，返回**注销器**。
   *
   * 抛的三种情况（全部是接线错误，不是运行期状况 —— 大声抛，绝不静默降级）：
   *  1. `organId` 已在位（重复注册）；
   *  2. `actions` 有词汇表以外的动作；
   *  3. `sideEffects` 缺席，或某条声明 `reversible: true` 却没给 `reverse`。
   */
  register(registration: OrganRegistration): OrganDisposer {
    const { organId, actions, sideEffects } = registration
    if (typeof organId !== 'string' || organId.length === 0) {
      throw new TypeError('schema-registry: organId must be a non-empty string')
    }
    if (this.#organs.has(organId)) {
      throw new Error(`schema-registry: organ already registered: ${organId}`)
    }
    if (!Array.isArray(actions)) {
      throw new TypeError(`schema-registry: ${organId}: actions must be an array`)
    }
    const unknown = actions.filter((a) => this.#vocabulary !== undefined && !this.#vocabulary.has(a))
    if (unknown.length > 0) {
      throw new Error(
        `schema-registry: ${organId}: actions outside the vocabulary: ${unknown.sort().join(', ')}`,
      )
    }
    if (!Array.isArray(sideEffects)) {
      // 「忘了写」和「确实没有」必须区分：空数组是一次声明，undefined 是一次遗漏。
      throw new TypeError(
        `schema-registry: ${organId}: sideEffects must be given explicitly (use [] for none)`,
      )
    }
    for (const decl of sideEffects) {
      if (decl.reversible && typeof decl.reverse !== 'function') {
        throw new TypeError(
          `schema-registry: ${organId}: side effect ${decl.kind}/${decl.target} `
          + 'declares reversible:true but provides no reverse()',
        )
      }
    }

    const frozen: OrganRegistration = {
      organId,
      actions: Object.freeze([...actions]),
      sideEffects: Object.freeze(sideEffects.map((d) => ({ ...d }))),
    }
    this.#organs.set(organId, frozen)
    this.#order.push(organId)
    this.#log('organ_registered', {
      organ_id: organId,
      actions: frozen.actions.length,
      side_effects: frozen.sideEffects.length,
    })
    this.#onChange?.()

    let disposed = false
    return () => {
      // 幂等：cordis 的 dispose 在异常路径上可能被调多次；第二次不再跑 reverse。
      if (disposed) return
      disposed = true
      this.#unregister(frozen)
    }
  }

  #unregister(registration: OrganRegistration): void {
    const { organId } = registration
    if (this.#organs.get(organId) !== registration) return // 已被别的路径摘掉
    this.#organs.delete(organId)
    this.#order = this.#order.filter((id) => id !== organId)

    // LIFO：后登记的副作用先逆回去。某一条抛了不阻断其余条 —— 半个注销比不注销
    // 更像幻肢。
    for (const decl of [...registration.sideEffects].reverse()) {
      if (!decl.reversible) {
        // 发出去的消息收不回来。登记的意义是让它**在账上**，不是让它消失。
        this.#log('organ_side_effect_irreversible_retained', {
          organ_id: organId, kind: decl.kind, target: decl.target,
        })
        continue
      }
      try {
        decl.reverse!()
        this.#log('organ_side_effect_reversed', {
          organ_id: organId, kind: decl.kind, target: decl.target,
        })
      } catch (exc) {
        this.#log('organ_side_effect_reverse_failed', {
          organ_id: organId,
          kind: decl.kind,
          target: decl.target,
          error: exc instanceof Error ? exc.message : String(exc),
        })
      }
    }
    this.#log('organ_unregistered', { organ_id: organId })
    this.#onChange?.()
  }

  /** 此刻在位的器官 id（注册序）。 */
  organIds(): readonly string[] {
    return Object.freeze([...this.#order])
  }

  /**
   * 认知面读到的整张图式：**逐层冻结**，且不含任何 `reverse` 句柄（§5）。
   */
  snapshot(): BodySchema {
    const organs = this.#order.map((id) => {
      const reg = this.#organs.get(id)!
      return Object.freeze({
        organId: reg.organId,
        actions: Object.freeze([...reg.actions]),
        sideEffects: Object.freeze(reg.sideEffects.map(deepFreezeSideEffect)),
      }) as OrganSchema
    })
    const actions = [...new Set(organs.flatMap((o) => o.actions))].sort()
    return Object.freeze({
      organs: Object.freeze(organs),
      actions: Object.freeze(actions),
    }) as BodySchema
  }
}

/**
 * 注册表 → 只读动作视图（接进 `OrganInventoryCache` 的那一头）。
 *
 * `isHardGated` 由调用方注入不可变治理核的判定（`hardDecision(a) === 'ask'`
 * 的等价物）—— 注册表**不**自己判硬门：那是治理核的话语权，注册表只说
 * 「谁在位」。核不可用时调用方应传 fail closed 的恒真（往少了说）。
 */
export function registryActionCatalog(
  registry: BodySchemaRegistry,
  isHardGated: (actionType: string) => boolean,
): ReadOnlyActionCatalog {
  return Object.freeze({
    get knownActions(): readonly string[] {
      return registry.snapshot().actions
    },
    isHardGated,
  }) as ReadOnlyActionCatalog
}
