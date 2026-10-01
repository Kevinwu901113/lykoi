import type { Component, Config, Json, InvocationContext } from './contracts.ts'

const key = (id: string, version: string) => `${id}@${version}`
const freeze = (value: any): any => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

/** Trusted providers only. Registration never opens a Mind store or changes policy. */
export class ComponentRegistry {
  #entries = new Map<string, Component>()
  #users = new Map<string, number>()
  #required: (id: string, version: string) => boolean = () => false
  constructor(required?: (id: string, version: string) => boolean) {
    if (required) this.#required = required
  }
  register(component: Component): () => void {
    if (!/^[a-z][a-z0-9.-]*$/.test(component.id) || !/^\d+\.\d+\.\d+$/.test(component.version))
      throw new Error('invalid component identity')
    const name = key(component.id, component.version)
    if (this.#entries.has(name)) throw new Error(`duplicate component: ${name}`)
    if (
      !component.title ||
      !component.description ||
      typeof component.validate !== 'function' ||
      (component.kind !== 'core' && typeof component.invoke !== 'function')
    )
      throw new Error('incomplete component')
    // Copy metadata; provider functions remain explicit, trusted code references.
    const snapshot = freeze({
      ...component,
      defaultConfig: structuredClone(component.defaultConfig),
      resourceRoles: structuredClone(component.resourceRoles),
      ...(component.toolSchema ? { toolSchema: structuredClone(component.toolSchema) } : {})
    }) as Component
    this.#entries.set(name, snapshot)
    let retired = false
    return () => {
      if (retired) return
      if ((this.#users.get(name) ?? 0) > 0 || this.#required(component.id, component.version))
        throw new Error('component is required by an unfinished run')
      retired = true
      this.#entries.delete(name)
    }
  }
  get(id: string, version: string): Component {
    const name = key(id, version),
      entry = this.#entries.get(name)
    if (!entry) throw new Error(`component unavailable: ${id}@${version}`)
    const current = () => {
      if (this.#entries.get(name) !== entry) throw new Error(`component retired: ${name}`)
    }
    return Object.freeze({
      ...entry,
      validate: (config: Config) => {
        current()
        entry.validate(config)
      },
      ...(entry.invoke
        ? {
            invoke: async (input: Json, config: Config, context: InvocationContext) => {
              current()
              return this.use(id, version, (c) => c.invoke!(input, config, context))
            }
          }
        : {})
    }) as Component
  }
  catalog() {
    return [...this.#entries.values()].map(({ validate, invoke, ...metadata }) => structuredClone(metadata))
  }
  async use<T>(id: string, version: string, work: (component: Component) => Promise<T>): Promise<T> {
    const name = key(id, version),
      entry = this.#entries.get(name)
    if (!entry) throw new Error(`component unavailable: ${name}`)
    this.#users.set(name, (this.#users.get(name) ?? 0) + 1)
    try {
      return await work(entry)
    } finally {
      this.#users.set(name, this.#users.get(name)! - 1)
    }
  }
}
