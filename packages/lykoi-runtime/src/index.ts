import type { CapabilityExecutionContext, Capability, CapabilityRecovery } from 'lykoi-contracts'
import { MindStore } from './mind.ts'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { validateInput } from './capability.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { BodySchemaRegistry, isHardGated } from 'lykoi-kernel'
import type {
  CapabilityActivity, CapabilityDefinition, CapabilityRegistration, CharacterInstance, ResourceHandler, ResourceRegistry, RuntimeLog, RuntimeService,
} from 'lykoi-contracts'

/** A read-only, live set. Consumers cannot mutate registration through the view. */
function actionView(set: Set<string>): ReadonlySet<string> {
  const view: ReadonlySet<string> = Object.freeze({
    get size() { return set.size },
    has: (value: string) => set.has(value),
    entries: () => set.entries(),
    keys: () => set.keys(),
    values: () => set.values(),
    [Symbol.iterator]: () => set[Symbol.iterator](),
    forEach(callback: (value: string, key: string, set: ReadonlySet<string>) => void, thisArg?: unknown) {
      set.forEach(value => callback.call(thisArg, value, value, view))
    },
  })
  return view
}

/** One capability lifetime per Runtime. No process-wide registry or adapter dependency. */
export class CapabilityRuntime implements RuntimeService {
  #definitions = new Map<string, CapabilityDefinition>()
  #resources: Record<string, Record<string, ResourceHandler>> = Object.create(null)
  #recovery = new Map<string, Capability>()
  #handlers = new Map<string, ResourceHandler>()
  #actions = new Set<string>()
  #disposers = new Map<string, () => void>()
  #activity = new Set<(event: CapabilityActivity) => void>()
  #listeners = new Set<() => void>()
  #schema: BodySchemaRegistry
  #revision = 0
  #closed = false
  #accepting = true
  #work = new Set<Promise<unknown>>()
  #admission = new AsyncLocalStorage<{ active: boolean }>()
  #log: RuntimeLog
  #events: Array<[string, Record<string, unknown>]> = []
  readonly resources: ResourceRegistry
  readonly actions = actionView(this.#actions)
  readonly bodySchema: RuntimeService['bodySchema']
  readonly catalog: RuntimeService['catalog']

  readonly instance: CharacterInstance | undefined

  constructor(log: RuntimeLog = () => {}, instance?: CharacterInstance) {
    this.instance = instance
    this.#log = (name, fields) => {
      // Telemetry cannot prevent resource retirement or leak a half-registration.
      try { log(name, fields) } catch { /* Dispatch's immutable audit gate remains independent. */ }
    }
    this.#schema = new BodySchemaRegistry({ logEvent: (name, fields) => { this.#events.push([name, fields]) } })
    this.bodySchema = Object.freeze({ snapshot: () => this.#schema.snapshot() })
    // The outer view follows plugin additions; nested views retain identity across reloads.
    this.resources = new Proxy(this.#resources, {
      set() { throw new TypeError('read-only resources') },
      deleteProperty() { throw new TypeError('read-only resources') },
      defineProperty() { throw new TypeError('read-only resources') },
    })
    const runtime = this
    this.catalog = Object.freeze({
      get knownActions() { return [...runtime.#actions].sort() },
      isHardGated,
    })
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed || (!this.#accepting && !this.#admission.getStore()?.active)) {
      throw new Error('instance runtime is stopping')
    }
    const admission = { active: true }
    const task = this.#admission.run(admission, () => Promise.resolve().then(work))
    this.#work.add(task)
    try { return await task } finally { admission.active = false; this.#work.delete(task) }
  }

  async quiesce(): Promise<void> {
    if (this.#admission.getStore()?.active) throw new Error('cannot drain runtime from its own work')
    this.#accepting = false
    while (this.#work.size) await Promise.allSettled([...this.#work])
  }

  get revision() { return this.#revision }

  async #reconcile(kind: 'recover' | 'cancel', name: string, params: Record<string, unknown>, context: CapabilityExecutionContext): Promise<CapabilityRecovery> {
    const capability = this.#recovery.get(name), hook = capability?.[kind]
    if (!hook) return { status: 'unknown', detail: `No installed capability can ${kind} this operation` }
    try {
      if (context.instanceId !== this.instance?.id) throw new Error('operation belongs to another instance')
      validateInput(capability.inputSchema, params)
      return await hook(params, context)
    } catch (error) { return { status: 'unknown', detail: error instanceof Error ? error.message : String(error) } }
  }
  recover(name: string, params: Record<string, unknown>, context: CapabilityExecutionContext) { return this.#reconcile('recover', name, params, context) }
  cancel(name: string, params: Record<string, unknown>, context: CapabilityExecutionContext) { return this.#reconcile('cancel', name, params, context) }
  async invoke(name: string, params: Record<string, unknown>, context?: CapabilityExecutionContext): Promise<unknown> {
    const handler = this.#handlers.get(name)
    if (!handler) throw new Error(`capability not registered: ${name}`)
    return handler(params, context)
  }

  capabilities(): readonly CapabilityDefinition[] { return Object.freeze([...this.#definitions.values()]) }

  register({ organId, capabilities, sideEffects }: CapabilityRegistration): () => void {
    if (this.#closed) throw new Error('runtime is disposed')
    const names = new Set<string>()
    for (const capability of capabilities) {
      if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(capability.name)) throw new TypeError(`invalid capability name: ${capability.name}`)
      if (names.has(capability.name)) throw new Error(`duplicate capability: ${capability.name}`)
      names.add(capability.name)
      if (!capability.description || capability.inputSchema.type !== 'object') throw new TypeError('capability requires description and object input schema')
    }
    const entries = capabilities.map(c => [c.name, c.handler] as const)
    for (const [action, handler] of entries) {
      if (typeof handler !== 'function') throw new TypeError(`invalid handler: ${action}`)
      if (this.#handlers.has(action)) throw new Error(`action already registered: ${action}`)
    }
    const definitions = capabilities.map(({ name, description, inputSchema }) => {
      const schema = structuredClone(inputSchema)
      const freeze = (value: unknown): void => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
      }
      freeze(schema)
      return Object.freeze({ name, description, inputSchema: schema })
    })
    // Validate and snapshot the complete declaration before publishing any part of it.
    const removeSchema = this.#schema.register({ organId, actions: entries.map(([a]) => a), sideEffects })
    const owned = new Map<string, ResourceHandler>()
    for (const [index, [action, handler]] of entries.entries()) {
      const definition = definitions[index]!
      const inputSchema = definition.inputSchema
      this.#definitions.set(action, definition)
      const [prefix, method] = action.split('.') as [string, string]
      if (!this.#resources[prefix]) {
        this.#resources[prefix] = new Proxy(Object.create(null), {
          get: (_target, key) => typeof key === 'string' ? this.#handlers.get(`${prefix}.${key}`) : undefined,
          ownKeys: () => [...this.#handlers.keys()].filter(k => k.startsWith(prefix + '.')).map(k => k.slice(prefix.length + 1)),
          getOwnPropertyDescriptor: (_t, key) => this.#handlers.has(`${prefix}.${String(key)}`) ? { enumerable: true, configurable: true } : undefined,
          set() { throw new TypeError('read-only resources') }, deleteProperty() { throw new TypeError('read-only resources') }, defineProperty() { throw new TypeError('read-only resources') },
        })
      }
      const guarded: ResourceHandler = async (params, context, admission) => {
        if (this.#handlers.get(action) !== guarded) throw new Error(`capability retired: ${action}`)
        return this.run(async () => {
          if (this.#handlers.get(action) !== guarded) throw new Error(`capability retired: ${action}`)
          const id = randomUUID()
          const ownership = context ? { taskId: context.taskId, operationId: context.operationId, instanceId: context.instanceId } : {}
          this.#publish({ id, ...ownership, name: action, phase: 'started' })
          try {
            validateInput(inputSchema, params)
            context?.signal?.throwIfAborted()
            if (context && context.instanceId !== this.instance?.id) throw new Error('capability invocation belongs to another instance')
            const result = await handler(params, context, admission)
            this.#publish({ id, ...ownership, name: action, phase: 'result', result })
            return result
          } catch (error) {
            this.#publish({ id, ...ownership, name: action, phase: 'failed', error: error instanceof Error ? error.message : String(error) })
            throw error
          }
        })
      }
      owned.set(action, guarded)
      this.#handlers.set(action, guarded)
      this.#recovery.set(action, capabilities[index]!)
      this.#actions.add(action)
    }
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      this.#disposers.delete(organId)
      for (const [action, handler] of owned) {
        if (this.#handlers.get(action) === handler) {
          this.#handlers.delete(action)
          this.#recovery.delete(action)
          this.#actions.delete(action)
          this.#definitions.delete(action)
        }
      }
      removeSchema()
      this.#changed()
    }
    this.#disposers.set(organId, dispose)
    this.#changed()
    return dispose
  }

  onActivity(listener: (event: CapabilityActivity) => void): () => void {
    this.#activity.add(listener)
    return () => { this.#activity.delete(listener) }
  }
  #publish(event: CapabilityActivity) {
    for (const listener of this.#activity) {
      try { listener(event) } catch { /* A display failure cannot undo or repeat an action. */ }
    }
  }

  onChange(listener: () => void): () => void {
    if (this.#closed) throw new Error('runtime is disposed')
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #changed() {
    this.#revision++
    // Publish telemetry only after schema and handlers describe the same state.
    for (const [name, fields] of this.#events.splice(0)) this.#log(name, fields)
    for (const listener of [...this.#listeners]) {
      try { listener() } catch (error) {
        this.#log('runtime_listener_failed', { error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  dispose() {
    if (this.#closed) return
    this.#closed = true
    for (const dispose of [...this.#disposers.values()].reverse()) dispose()
    this.#listeners.clear()
    this.#activity.clear()
  }
}

export const name = 'lykoi-runtime'
export function apply(ctx: Context) {
  const runtime = new CapabilityRuntime((event, fields) => ctx.logger.debug('%s %o', event, fields), ctx.get('lykoiInstance'))
  if (runtime.instance) {
    const mind = new MindStore(join(runtime.instance.stateRoot, 'mind.sqlite'))
    const memoryPath = join(runtime.instance.stateRoot, 'memory.db')
    if (existsSync(memoryPath)) mind.migrate(memoryPath)
    ctx.provide('mind', mind)
    ctx.effect(() => runtime.register({ organId: 'mind', sideEffects: [], capabilities: [{
      name: 'mind.read', description: 'Read persistent questions and contextual user understanding. Search older or resolved records by plain text or ID; searched records are refreshed in the next cognition snapshot before updates.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
      handler: async p => mind.view(p.query as string | undefined, p.limit as number | undefined),
    }] }), 'mind read capability')
    ctx.effect(() => () => mind.close(), 'mind storage')
  }
  ctx.provide('lykoiRuntime', runtime)
  ctx.effect(() => () => runtime.dispose(), 'runtime capability lifetime')
}
