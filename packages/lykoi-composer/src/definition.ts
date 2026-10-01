import type { AgentDefinition, Json } from './contracts.ts'
import type { ComponentRegistry } from './registry.ts'

export const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)
export function assertJson(value: unknown): asserts value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach(assertJson)
    return
  }
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('reserved object key')
      assertJson(item)
    }
    return
  }
  throw new Error('expected finite JSON data')
}
const object = (x: unknown): x is Record<string, Json> => !!x && typeof x === 'object' && !Array.isArray(x)
export function validateDefinition(value: unknown, registry: ComponentRegistry): AgentDefinition {
  assertJson(value)
  const d = value as unknown as AgentDefinition
  if (!object(value) || !validId(d.id) || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 160)
    throw new Error('invalid Agent identity')
  if (
    !Array.isArray(d.nodes) ||
    !d.nodes.length ||
    d.nodes.length > 64 ||
    !Array.isArray(d.edges) ||
    d.edges.length > 128 ||
    !Array.isArray(d.resources)
  )
    throw new Error('invalid graph size')
  if (
    !d.execution ||
    !['single', 'tools'].includes(d.execution.mode) ||
    !Number.isSafeInteger(d.execution.maxActions) ||
    d.execution.maxActions < 0 ||
    d.execution.maxActions > 32 ||
    !Number.isSafeInteger(d.execution.timeoutMs) ||
    d.execution.timeoutMs < 100 ||
    d.execution.timeoutMs > 300000
  )
    throw new Error('invalid execution limits')
  const resources = new Map(d.resources.map((r) => [r.id, r]))
  if (resources.size !== d.resources.length || resources.size > 32)
    throw new Error('duplicate or excess resources')
  for (const r of d.resources) {
    if (!validId(r.id) || !['model', 'workspace'].includes(r.type) || !object(r.config))
      throw new Error('invalid resource')
    // Definition exports never carry provider credentials or deployment filesystem paths.
    const keys = Object.keys(r.config)
    if (r.type === 'workspace' && keys.length) throw new Error('workspace root is owned by the instance')
    if (r.type === 'model') {
      if (keys.some((k) => !['provider', 'baseUrl', 'model', 'credential'].includes(k)))
        throw new Error('model supports credential handles only')
      if (!['demo', 'openai-compatible'].includes(String(r.config.provider)))
        throw new Error('unsupported model provider')
      if (r.config.provider === 'openai-compatible') {
        if (
          typeof r.config.baseUrl !== 'string' ||
          typeof r.config.model !== 'string' ||
          !r.config.model.trim()
        )
          throw new Error('model requires baseUrl and model')
        const url = new URL(r.config.baseUrl)
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('invalid model endpoint')
        if (r.config.credential !== undefined && !validId(r.config.credential))
          throw new Error('invalid credential handle')
      }
    }
  }
  const nodes = new Map(d.nodes.map((n) => [n.id, n]))
  if (nodes.size !== d.nodes.length) throw new Error('duplicate node')
  if (d.editor !== undefined) {
    const editor = d.editor
    const coordinate = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000
    if (
      !object(editor) ||
      !object(editor.positions) ||
      !object(editor.viewport) ||
      Object.keys(editor).some(
        (key) => !['positions', 'viewport'].includes(key)
      ) ||
      Object.keys(editor.viewport).some(
        (key) => !['x', 'y', 'zoom'].includes(key)
      ) ||
      !coordinate(editor.viewport.x) ||
      !coordinate(editor.viewport.y) ||
      typeof editor.viewport.zoom !== 'number' ||
      editor.viewport.zoom < 0.25 ||
      editor.viewport.zoom > 1.8 ||
      Object.entries(editor.positions).some(
        ([id, point]) =>
          !nodes.has(id) ||
          !object(point) ||
          Object.keys(point).some((key) => !['x', 'y'].includes(key)) ||
          !coordinate(point.x) ||
          !coordinate(point.y)
      )
    )
      throw new Error('invalid editor geometry')
  }
  for (const n of d.nodes) {
    if (
      !validId(n.id) ||
      typeof n.component !== 'string' ||
      typeof n.version !== 'string' ||
      !object(n.config) ||
      !object(n.resources) ||
      !Array.isArray(n.tools)
    )
      throw new Error('invalid node')
    const spec = registry.get(n.component, n.version)
    spec.validate(n.config)
    if (Object.keys(n.resources).some((role) => !Object.hasOwn(spec.resourceRoles, role)))
      throw new Error('undeclared resource role')
    for (const [role, type] of Object.entries(spec.resourceRoles)) {
      if (resources.get(n.resources[role])?.type !== type)
        throw new Error(`missing ${type} resource for ${n.id}.${role}`)
    }
    if (new Set(n.tools).size !== n.tools.length || (spec.kind !== 'core' && n.tools.length))
      throw new Error('tools belong to a Core')
    for (const tool of n.tools) {
      const target = nodes.get(tool)
      if (!target || registry.get(target.component, target.version).kind !== 'tool')
        throw new Error('invalid tool binding')
    }
  }
  const targets = new Set<string>()
  for (const edge of d.edges) {
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to)
    if (!from || !to || targets.has(edge.to))
      throw new Error('invalid edge or duplicate input; joins are not supported yet')
    const a = registry.get(from.component, from.version),
      b = registry.get(to.component, to.version)
    if (a.kind === 'tool' || b.kind === 'tool' || (a.output === 'any' && b.input === 'text'))
      throw new Error('incompatible ports')
    targets.add(edge.to)
  }
  if (
    !nodes.has(d.output) ||
    registry.get(nodes.get(d.output)!.component, nodes.get(d.output)!.version).kind === 'tool'
  )
    throw new Error('invalid output node')
  graphOrder(d) // Detect cycles before persisting a new version.
  return structuredClone(d)
}
export function graphOrder(d: AgentDefinition): string[] {
  const toolIds = new Set(d.nodes.flatMap((n) => n.tools))
  // Tools may be installed before being bound, so component kind is handled by the caller too.
  const left = new Set(d.nodes.filter((n) => !toolIds.has(n.id)).map((n) => n.id)),
    order: string[] = []
  while (left.size) {
    const ready = [...left].filter((id) =>
      d.edges.filter((e) => e.to === id).every((e) => order.includes(e.from))
    )
    if (!ready.length) throw new Error('graph contains a cycle')
    ready.forEach((id) => {
      left.delete(id)
      order.push(id)
    })
  }
  return order
}
