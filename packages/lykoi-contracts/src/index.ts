import type { Context } from '@deepseek-ai/cordis'
/** Contracts shared by Runtime, governance and plugins. No implementation imports. */
export type ResourceHandler = (params: Record<string, unknown>) => Promise<unknown>
export type ResourceRegistry = Readonly<Record<string, Readonly<Record<string, ResourceHandler>>>>
export type RuntimeLog = (name: string, fields: Record<string, unknown>) => void
/** 一条副作用登记。 */
export interface SideEffectDeclaration {
  /** 是什么：'state_file' / 'outbound_channel' / 'cursor' / … */
  kind: string
  /** 落在哪：路径或通道名。**不放密钥、不放 channel_key**。 */
  target: string
  /** 卸载时能不能收回。true 必须带 `reverse`。 */
  reversible: boolean
  /** 可逆的收回动作 —— 注册时就交出来，不是卸载时才去找。 */
  reverse?: () => void
}

/** 一次器官注册。 */
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

/** 注销器：`register()` 的返回值本身。 */
export type OrganDisposer = () => void


export interface CapabilityRegistration {
  organId: string
  handlers: Readonly<Record<string, ResourceHandler>>
  sideEffects: readonly SideEffectDeclaration[]
}
export interface RuntimeService {
  readonly resources: ResourceRegistry
  readonly actions: ReadonlySet<string>
  readonly catalog: ReadOnlyActionCatalog
  readonly bodySchema: { snapshot(): BodySchema }
  readonly revision: number
  register(registration: CapabilityRegistration): OrganDisposer
  onChange(listener: () => void): OrganDisposer
}
declare module '@deepseek-ai/cordis' {
  interface Context { lykoiRuntime: RuntimeService }
}
