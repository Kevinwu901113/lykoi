/**
 * 身体图式注册表（GK-11 / DK-15；**新建面，无活体逐字对拍对象**）。
 *
 * 设计正本：`docs/m3_schema_registry.md`（蓝图 GK-11 要求「先出设计小节再实现
 * 首版」）。四条验收：注册即感知 / 可逆副作用登记 / 卸载即消失（无幻肢）/
 * 认知可读不可写。
 *
 * 一句话定案：**一个器官在身体图式里出现，当且仅当它自己注册过。**
 * `KNOWN_ACTIONS` 是词汇表（这个动作类型合法），注册表是图式（这个器官此刻
 * 真的在位）。两者分开，是因为 W3 之后 18 项词汇里只有 5 项接了真传输面 ——
 * 让清单继续念满 18 项，就是在给她装幻肢，方向与器官清单四条禁止
 * （SA-161，全都朝「往少了说」）相反。
 *
 * 落位纪律：住 kernel（GK-13 root 属主域）。它是**权威源**，`lykoi-decide` 的
 * `OrganInventoryCache` 是只读渲染器 —— 本模块不 import 任何认知层包
 * （CF-B1：kernel 反向 import 一次都不许，W3 已立）。
 */
import { logEvent } from './telemetry.ts'

/** 一条副作用登记（§3）。 */
export interface SideEffectDeclaration {
  /** 是什么：'state_file' / 'outbound_channel' / 'cursor' / … */
  kind: string
  /** 落在哪：路径或通道名。**不放密钥、不放 channel_key**（SA-161 禁止①②同向）。 */
  target: string
  /** 卸载时能不能收回。true 必须带 `reverse`。 */
  reversible: boolean
  /** 可逆的收回动作 —— 注册时就交出来，不是卸载时才去找。 */
  reverse?: () => void
}

/** 一次器官注册（§2）。 */
export interface OrganRegistration {
  /** 器官标识（唯一）。 */
  organId: string
  /** 这个器官**真正接得通**的动作类型；必须 ⊆ 词汇表。 */
  actions: readonly string[]
  /** 副作用登记；可以是空数组，但必须显式给。 */
  sideEffects: readonly SideEffectDeclaration[]
}

/** 认知面读到的一条器官图式（冻结）。 */
export interface OrganSchema {
  readonly organId: string
  readonly actions: readonly string[]
  readonly sideEffects: readonly Readonly<Omit<SideEffectDeclaration, 'reverse'>>[]
}

/** 认知面读到的整张图式（冻结；**没有任何 mutator**）。 */
export interface BodySchema {
  readonly organs: readonly OrganSchema[]
  /** 所有在位器官的动作并集（已排序去重）。 */
  readonly actions: readonly string[]
}

/** 只读派生视图的形状（= lykoi-decide 的 OrganActionCatalog，结构等价、不 import）。 */
export interface ReadOnlyActionCatalog {
  readonly knownActions: readonly string[]
  isHardGated(actionType: string): boolean
}

/** 注销器：`register()` 的返回值本身（§4：谁注册谁负责注销）。 */
export type OrganDisposer = () => void

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
 * @param vocabulary 合法动作词汇表（kernel `KNOWN_ACTIONS` 等价物）。注册的动作
 *   越界即抛 —— 器官编不出词汇表以外的动作（防止绕过 dispatch 的 `_resolve`
 *   拒绝面）。
 * @param onChange 注册/注销后的回调（接线方在这里调 `organs.invalidate()`）。
 *   缓存失效是**接线方的编排**，不是注册表反向依赖认知层。
 */
export class BodySchemaRegistry {
  #vocabulary: ReadonlySet<string>
  #onChange: (() => void) | undefined
  #organs = new Map<string, OrganRegistration>()
  #order: string[] = []

  constructor(opts: {
    vocabulary: Iterable<string>
    onChange?: () => void
  }) {
    this.#vocabulary = new Set(opts.vocabulary)
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
    const unknown = actions.filter((a) => !this.#vocabulary.has(a))
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
    logEvent('organ_registered', {
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
        logEvent('organ_side_effect_irreversible_retained', {
          organ_id: organId, kind: decl.kind, target: decl.target,
        })
        continue
      }
      try {
        decl.reverse!()
        logEvent('organ_side_effect_reversed', {
          organ_id: organId, kind: decl.kind, target: decl.target,
        })
      } catch (exc) {
        logEvent('organ_side_effect_reverse_failed', {
          organ_id: organId,
          kind: decl.kind,
          target: decl.target,
          error: exc instanceof Error ? exc.message : String(exc),
        })
      }
    }
    logEvent('organ_unregistered', { organ_id: organId })
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
