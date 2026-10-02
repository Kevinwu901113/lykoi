import type { AgentDefinition, Json } from './contracts.ts'
import type { ComponentRegistry } from './registry.ts'
import { ancestors, references, templateRefs } from './values.ts'
import { branchIds } from './flow.ts'
import { validateEndpoint } from './providers.ts'

export const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  !['__proto__', 'constructor', 'prototype'].includes(id) &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)
export function assertJson(value: unknown): asserts value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach(assertJson)
    return
  }
  if (
    typeof value === 'object' &&
    value &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('reserved object key')
      assertJson(item)
    }
    return
  }
  throw new Error('expected finite JSON data')
}
const object = (x: unknown): x is Record<string, Json> =>
  !!x && typeof x === 'object' && !Array.isArray(x)
export function validateDefinition(
  value: unknown,
  registry: ComponentRegistry
): AgentDefinition {
  assertJson(value)
  const d = value as unknown as AgentDefinition
  if (
    !object(value) ||
    !validId(d.id) ||
    typeof d.name !== 'string' ||
    !d.name.trim() ||
    d.name.length > 160
  )
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
    if (
      !validId(r.id) ||
      !['model', 'workspace', 'http'].includes(r.type) ||
      !object(r.config)
    )
      throw new Error('invalid resource')
    // Definition exports never carry provider credentials or deployment filesystem paths.
    const keys = Object.keys(r.config)
    if (r.type === 'workspace' && keys.length)
      throw new Error('workspace root is owned by the instance')
    if (r.config.credential !== undefined && !validId(r.config.credential))
      throw new Error('invalid credential handle')
    if (r.type === 'http') {
      if (keys.some((k) => !['baseUrl', 'credential'].includes(k)))
        throw new Error('HTTP resources support credential handles only')
      validateEndpoint(r.config.baseUrl)
    }
    if (r.type === 'model') {
      if (
        keys.some(
          (k) =>
            !['provider', 'baseUrl', 'model', 'credential', 'answers'].includes(
              k
            )
        )
      )
        throw new Error('model supports credential handles only')
      if (
        ![
          'demo',
          'openai-compatible',
          'jev',
          'decision-compatible',
          'decision-fixture'
        ].includes(String(r.config.provider))
      )
        throw new Error('unsupported model provider')
      if (
        r.config.provider !== 'decision-fixture' &&
        r.config.answers !== undefined
      )
        throw new Error('answers belong to a manual fixture')
      if (r.config.provider === 'decision-fixture' && !object(r.config.answers))
        throw new Error('decision fixture requires explicit answers')
      if (
        ['openai-compatible', 'jev', 'decision-compatible'].includes(
          String(r.config.provider)
        )
      ) {
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
    if (
      n.invocation !== undefined &&
      (n.invocation !== 'workflow' || spec.kind !== 'tool')
    )
      throw new Error('invalid tool invocation mode')
    if (spec.kind === 'core' || spec.kind === 'decision') {
      const provider = resources.get(n.resources.model)?.config.provider
      const decision = [
        'jev',
        'decision-compatible',
        'decision-fixture'
      ].includes(String(provider))
      if ((spec.kind === 'decision') !== decision)
        throw new Error('model capability does not match the node')
    }
    if (
      Object.keys(n.resources).some(
        (role) => !Object.hasOwn(spec.resourceRoles, role)
      )
    )
      throw new Error('undeclared resource role')
    for (const [role, type] of Object.entries(spec.resourceRoles)) {
      if (resources.get(n.resources[role])?.type !== type)
        throw new Error(`missing ${type} resource for ${n.id}.${role}`)
    }
    if (
      new Set(n.tools).size !== n.tools.length ||
      (spec.kind !== 'core' && n.tools.length)
    )
      throw new Error('tools belong to a Core')
    for (const tool of n.tools) {
      const target = nodes.get(tool)
      if (
        !target ||
        target.invocation === 'workflow' ||
        registry.get(target.component, target.version).kind !== 'tool'
      )
        throw new Error('invalid tool binding')
    }
  }
  const entries = d.nodes.filter((n) => n.component === 'flow.input')
  if (entries.length > 1) throw new Error('a workflow has only one input node')
  if (entries.length) {
    const reachable = new Set([entries[0].id])
    let changed = true
    while (changed) {
      changed = false
      for (const e of d.edges)
        if (reachable.has(e.from) && !reachable.has(e.to)) {
          reachable.add(e.to)
          changed = true
        }
    }
    if (
      d.nodes.some(
        (n) =>
          (registry.get(n.component, n.version).kind !== 'tool' ||
            n.invocation === 'workflow') &&
          !reachable.has(n.id)
      )
    )
      throw new Error('workflow node is disconnected from the input')
  }
  const targets = new Set<string>(),
    edgeIds = new Set<string>()
  for (const edge of d.edges) {
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to)
    if (!from || !to || edge.from === edge.to) throw new Error('invalid edge')
    const a = registry.get(from.component, from.version),
      b = registry.get(to.component, to.version)
    if (targets.has(edge.to) && to.component !== 'flow.merge')
      throw new Error(
        'duplicate input; only an exclusive merge accepts multiple inputs'
      )
    if (
      (a.kind === 'tool' && from.invocation !== 'workflow') ||
      (b.kind === 'tool' && to.invocation !== 'workflow') ||
      (a.output === 'any' && b.input === 'text' && to.input === undefined)
    )
      throw new Error('incompatible ports')
    if (from.component === 'flow.branch') {
      if (!edge.branch || !branchIds(from.config).includes(edge.branch))
        throw new Error('conditional edge requires a declared branch')
    } else if (edge.branch !== undefined)
      throw new Error('branch label belongs to a conditional node')
    const key = JSON.stringify([edge.from, edge.to, edge.branch])
    if (edgeIds.has(key)) throw new Error('duplicate edge')
    edgeIds.add(key)
    targets.add(edge.to)
  }
  for (const n of d.nodes) {
    const incoming = d.edges.filter((e) => e.to === n.id)
    if (
      n.component === 'flow.input' &&
      (incoming.length || n.input !== undefined)
    )
      throw new Error('input node must read the run input at the root')
    if (n.component === 'flow.merge' && !incoming.length)
      throw new Error('merge requires incoming branches')
    const allowed = ancestors(d, n.id)
    const refs = n.input === undefined ? [] : references(n.input)
    for (const key of ['template', 'system', 'prompt'])
      if (typeof n.config[key] === 'string')
        refs.push(...templateRefs(n.config[key] as string))
    if (refs.some((ref) => ref.node !== '$input' && !allowed.has(ref.node)))
      throw new Error('value reference must target a control-flow ancestor')
    // Dynamic Core tool input belongs to the model call, not an independent workflow binding.
    if (
      registry.get(n.component, n.version).kind === 'tool' &&
      n.invocation !== 'workflow' &&
      n.input !== undefined
    )
      throw new Error('tool input bindings require workflow invocation')
  }
  if (
    !nodes.has(d.output) ||
    (registry.get(nodes.get(d.output)!.component, nodes.get(d.output)!.version)
      .kind === 'tool' &&
      nodes.get(d.output)!.invocation !== 'workflow')
  )
    throw new Error('invalid output node')
  graphOrder(d) // Detect cycles before persisting a new version.
  return structuredClone(d)
}
export function graphOrder(d: AgentDefinition): string[] {
  const toolIds = new Set(d.nodes.flatMap((n) => n.tools))
  // Tools may be installed before being bound, so component kind is handled by the caller too.
  const left = new Set(
      d.nodes.filter((n) => !toolIds.has(n.id)).map((n) => n.id)
    ),
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
