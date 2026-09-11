import type {} from '@deepseek-ai/cordis'
/** Contracts shared by Runtime, governance and plugins. No implementation imports. */
export interface CapabilityExecutionContext {
  instanceId: string
  taskId: string
  operationId: string
  workspace: string
  signal?: AbortSignal
}
/** Trusted dispatch metadata, separate from model arguments and Task execution ownership. */
export interface ResourceAdmission { origin: string; messageBudget?: 'exempt' }
export type ResourceHandler = (params: Record<string, unknown>, context?: CapabilityExecutionContext, admission?: ResourceAdmission) => Promise<unknown>
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
  /** 这个器官**真正接得通**的动作类型；名称由插件声明。 */
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

/** The JSON Schema subset supported by installed capabilities. */
export type InputType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
export interface InputSchema {
  type: InputType | readonly InputType[]
  description?: string
  properties?: Readonly<Record<string, InputSchema>>
  required?: readonly string[]
  additionalProperties?: boolean
  items?: InputSchema
  enum?: readonly (string | number | boolean | null)[]
  minimum?: number
  maximum?: number
}
export interface CapabilityDefinition {
  name: string
  description: string
  inputSchema: InputSchema
}
export type CapabilityRecovery = { status: 'completed'; observation: unknown } | { status: 'pending' | 'unknown'; detail: string }
export interface Capability extends CapabilityDefinition {
  handler: ResourceHandler
  recover?: (params: Record<string, unknown>, context: CapabilityExecutionContext) => Promise<CapabilityRecovery>
  cancel?: (params: Record<string, unknown>, context: CapabilityExecutionContext) => Promise<CapabilityRecovery>
}
export interface CapabilityRegistration {
  organId: string
  capabilities: readonly Capability[]
  sideEffects: readonly SideEffectDeclaration[]
}
export interface CapabilityActivity {
  taskId?: string
  operationId?: string
  instanceId?: string
  id: string
  name: string
  phase: 'started' | 'result' | 'failed'
  result?: unknown
  error?: string
}
export interface RuntimeService {
  readonly instance?: CharacterInstance
  run<T>(work: () => Promise<T>): Promise<T>
  quiesce(): Promise<void>
  invoke(name: string, params: Record<string, unknown>, context?: CapabilityExecutionContext): Promise<unknown>
  recover(name: string, params: Record<string, unknown>, context: CapabilityExecutionContext): Promise<CapabilityRecovery>
  cancel(name: string, params: Record<string, unknown>, context: CapabilityExecutionContext): Promise<CapabilityRecovery>
  capabilities(): readonly CapabilityDefinition[]
  readonly resources: ResourceRegistry
  readonly actions: ReadonlySet<string>
  readonly catalog: ReadOnlyActionCatalog
  readonly bodySchema: { snapshot(): BodySchema }
  readonly revision: number
  register(registration: CapabilityRegistration): OrganDisposer
  onActivity(listener: (event: CapabilityActivity) => void): OrganDisposer
  onChange(listener: () => void): OrganDisposer
}
declare module '@deepseek-ai/cordis' {
  interface Context { lykoiRuntime: RuntimeService }
}

/** Immutable ownership for one running character. Configuration does not own these paths. */
export interface CharacterInstance {
  readonly version: 1
  readonly id: string
  readonly origin: 'created' | 'adopted'
  readonly createdAt: string
  readonly definitionHash: string
  readonly personaPath: string
  readonly stateRoot: string
}
declare module '@deepseek-ai/cordis' {
  interface Context { lykoiInstance: CharacterInstance }
}

export interface MindEvent { id: string; source: string; reference: string; content: string; createdAt: string }
export interface MindRecord {
  id: string; revision: number; kind: 'thought' | 'preference'; topic: string; understanding: string; open: string | null
  evidence: string[]; links: string[]; status: 'open' | 'waiting' | 'resolved' | 'released'; reconsiderAt: string | null
  basis: 'explicit' | 'inferred'; scope: string; updatedAt: string
}
export type MindUpdate = Omit<MindRecord, 'revision' | 'status' | 'updatedAt'>
export interface MindPatch { records?: MindUpdate[]; acknowledge?: string[]; continue?: boolean }
export interface MindView { records: MindRecord[]; events: MindEvent[] }
declare module '@deepseek-ai/cordis' { interface Context { skills: { recent(): unknown[] } } }
export interface CharacterMind {
  receive(event: MindEvent): void
  view(query?: string, limit?: number): MindView
  context(): string
  commit(patch: unknown, source: string, seen: MindView): void
}
declare module '@deepseek-ai/cordis' { interface Context { mind: CharacterMind } }

/** Result of an owner intent already handled by the interaction layer. The full message still reaches cognition. */
export interface OwnerInteraction { kind: 'approval_answer' | 'suggestion_answer'; outcome: string; executed?: boolean; replied?: boolean; observation?: unknown }
export interface TaskMessage { text: string; delaySeconds: number }
export interface TaskRequest { text: string; receivedAt: string }
export interface TaskSummary {
  scheduledMessage?: { text: string; dueAt: string }
  request?: TaskRequest
  origin?: 'user' | 'autonomous'; thoughtId?: string; reason?: string; result?: string; finding?: string
  id: string; goal: string; requirements: string; status: string; checkpoint: string
  wait: { kind: string; detail: string; until?: string; operationId?: string } | null
  delivery: { state: string; content: string; error: string | null } | null
}
export interface TaskDeliveryResult { state: 'sent' | 'failed' | 'unknown'; receipt?: unknown; error?: string }
export interface TaskInteractions {
  requestApproval(input: { name: string; args: Record<string, unknown>; operationId: string; taskId: string }): Promise<void>
  deliver(task: TaskSummary): Promise<TaskDeliveryResult>
}
export interface CharacterTasks {
  history(id: string, offset?: number, limit?: number): { operations: unknown[]; nextOffset: number | null }
  command(text: string): Promise<string | null>
  bindInteractions(interactions: TaskInteractions): () => void
  approve(operationId: string, action?: { name: string; args: Record<string, unknown> }): Promise<boolean>
  create(input: { goal: string; message?: TaskMessage; request?: TaskRequest; requirements?: string; criteria?: string; originTurnId?: string; taskId?: string; origin?: 'user' | 'autonomous'; thoughtId?: string; reason?: string }): TaskSummary
  get(id: string): TaskSummary
  list(): TaskSummary[]
  update(id: string, requirements: string, criteria?: string): TaskSummary
  control(id: string, command: 'pause' | 'resume' | 'cancel'): Promise<TaskSummary>
  retryDelivery(id: string): TaskSummary
  scan(): Promise<void>
  close(): Promise<void>
}
declare module '@deepseek-ai/cordis' { interface Context { tasks: CharacterTasks } }
