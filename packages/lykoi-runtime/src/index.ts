import type { Context } from '@deepseek-ai/cordis'
import { BodySchemaRegistry, KNOWN_ACTION_LIST, isHardGated, unwiredResources } from 'lykoi-kernel'
import type {
  CapabilityRegistration, CharacterInstance, ResourceHandler, ResourceRegistry, RuntimeLog, RuntimeService,
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
  #handlers = new Map<string, ResourceHandler>()
  #actions = new Set<string>()
  #disposers = new Map<string, () => void>()
  #listeners = new Set<() => void>()
  #schema: BodySchemaRegistry
  #revision = 0
  #closed = false
  #accepting = true
  #work = new Set<Promise<unknown>>()
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
    this.#schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST, logEvent: (name, fields) => { this.#events.push([name, fields]) } })
    this.bodySchema = Object.freeze({ snapshot: () => this.#schema.snapshot() })
    const resources: Record<string, Record<string, ResourceHandler>> = {}
    const unwired = unwiredResources()
    for (const action of KNOWN_ACTION_LIST) {
      const [prefix, method] = action.split('.') as [string, string]
      resources[prefix] ??= {}
      Object.defineProperty(resources[prefix], method, {
        enumerable: true,
        get: () => this.#handlers.get(action) ?? unwired[prefix]![method],
      })
    }
    for (const methods of Object.values(resources)) Object.freeze(methods)
    this.resources = Object.freeze(resources)
    const runtime = this
    this.catalog = Object.freeze({
      get knownActions() { return KNOWN_ACTION_LIST.filter(action => runtime.#actions.has(action)) },
      isHardGated,
    })
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (!this.#accepting || this.#closed) throw new Error('instance runtime is stopping')
    const task = Promise.resolve().then(work)
    this.#work.add(task)
    try { return await task } finally { this.#work.delete(task) }
  }

  async quiesce(): Promise<void> {
    this.#accepting = false
    await Promise.allSettled([...this.#work])
  }

  get revision() { return this.#revision }

  register({ organId, handlers, sideEffects }: CapabilityRegistration): () => void {
    if (this.#closed) throw new Error('runtime is disposed')
    const entries = Object.entries(handlers)
    for (const [action, handler] of entries) {
      if (typeof handler !== 'function') throw new TypeError(`invalid handler: ${action}`)
      if (this.#handlers.has(action)) throw new Error(`action already registered: ${action}`)
    }
    // Validate the complete declaration before making handlers visible.
    const removeSchema = this.#schema.register({ organId, actions: entries.map(([a]) => a), sideEffects })
    const owned = new Map<string, ResourceHandler>()
    for (const [action, handler] of entries) {
      const guarded: ResourceHandler = async params => {
        if (this.#handlers.get(action) !== guarded) throw new Error(`capability retired: ${action}`)
        return handler(params)
      }
      owned.set(action, guarded)
      this.#handlers.set(action, guarded)
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
          this.#actions.delete(action)
        }
      }
      removeSchema()
      this.#changed()
    }
    this.#disposers.set(organId, dispose)
    this.#changed()
    return dispose
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
  }
}

export const name = 'lykoi-runtime'
export function apply(ctx: Context) {
  const runtime = new CapabilityRuntime((event, fields) => ctx.logger.debug('%s %o', event, fields), ctx.get('lykoiInstance'))
  ctx.provide('lykoiRuntime', runtime)
  ctx.effect(() => () => runtime.dispose(), 'runtime capability lifetime')
}
