import type { AgentDefinition, Config, Json, Run } from './contracts.ts'

export function object(value: unknown): value is Config {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function pathValue(value: Json, path: Json): Json {
  if (
    !Array.isArray(path) ||
    path.some(
      (p) =>
        typeof p !== 'string' ||
        ['__proto__', 'prototype', 'constructor'].includes(p)
    )
  )
    throw new Error('invalid field path')
  for (const key of path as string[]) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`field is unavailable: ${key}`)
    value = (value as Config)[key]
  }
  return value
}
export function ancestors(d: AgentDefinition, id: string): Set<string> {
  const seen = new Set<string>(),
    pending = d.edges.filter((e) => e.to === id).map((e) => e.from)
  while (pending.length) {
    const next = pending.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    pending.push(...d.edges.filter((e) => e.to === next).map((e) => e.from))
  }
  return seen
}
export function references(binding: Json): { node: string; path: string[] }[] {
  if (Array.isArray(binding)) return binding.flatMap(references)
  if (!object(binding)) return []
  if (Object.hasOwn(binding, '$ref')) {
    const ref = binding.$ref
    if (
      Object.keys(binding).length !== 1 ||
      !object(ref) ||
      typeof ref.node !== 'string' ||
      Object.keys(ref).some((k) => !['node', 'path'].includes(k))
    )
      throw new Error('invalid value reference')
    const path = ref.path ?? []
    if (
      !Array.isArray(path) ||
      path.some(
        (p) =>
          typeof p !== 'string' ||
          ['__proto__', 'prototype', 'constructor'].includes(p)
      )
    )
      throw new Error('invalid field path')
    return [{ node: ref.node, path: (ref.path ?? []) as string[] }]
  }
  return Object.values(binding).flatMap(references)
}
export function resolveValue(binding: Json, run: Run): Json {
  if (Array.isArray(binding))
    return binding.map((item) => resolveValue(item, run))
  if (!object(binding)) return binding
  if (Object.hasOwn(binding, '$ref')) {
    const ref = binding.$ref as Config,
      id = String(ref.node)
    if (id !== '$input' && !Object.hasOwn(run.outputs, id))
      throw new Error(`referenced node has no result: ${id}`)
    return pathValue(
      id === '$input' ? run.input : run.outputs[id],
      ref.path ?? []
    )
  }
  return Object.fromEntries(
    Object.entries(binding).map(([key, value]) => [
      key,
      resolveValue(value, run)
    ])
  )
}
export function templateRefs(
  template: string
): { node: string; path: string[] }[] {
  return [
    ...template.matchAll(
      /\{\{nodes\.([a-zA-Z0-9_-]+)((?:\.[a-zA-Z0-9_-]+)*)\}\}/g
    )
  ].map((match) => ({
    node: match[1],
    path: match[2] ? match[2].slice(1).split('.') : []
  }))
}
export function renderTemplate(
  template: string,
  input: Json,
  run: Run
): string {
  const text = (v: Json) => (typeof v === 'string' ? v : JSON.stringify(v))
  return template.replace(
    /\{\{(input(?:\.[a-zA-Z0-9_-]+)*|nodes\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\}\}/g,
    (_match, selector: string) => {
      const parts = selector.split('.')
      if (parts.shift() === 'input') return text(pathValue(input, parts))
      const node = parts.shift()!
      if (!Object.hasOwn(run.outputs, node))
        throw new Error(`referenced node has no result: ${node}`)
      return text(pathValue(run.outputs[node], parts))
    }
  )
}

// Deliberately bounded JSON Schema subset; unsupported keywords fail at save time.
export function validateSchema(schema: Json, depth = 0): void {
  if (
    !object(schema) ||
    depth > 12 ||
    Object.keys(schema).some(
      (k) =>
        ![
          'type',
          'properties',
          'required',
          'items',
          'enum',
          'additionalProperties'
        ].includes(k)
    )
  )
    throw new Error('unsupported output/input schema')
  if (
    ![
      'string',
      'number',
      'integer',
      'boolean',
      'object',
      'array',
      'null'
    ].includes(String(schema.type))
  )
    throw new Error('schema requires a type')
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || !schema.enum.length)
  )
    throw new Error('invalid schema enum')
  if (schema.properties !== undefined) {
    if (schema.type !== 'object' || !object(schema.properties))
      throw new Error('invalid schema properties')
    Object.values(schema.properties).forEach((s) =>
      validateSchema(s, depth + 1)
    )
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some(
        (k) =>
          typeof k !== 'string' ||
          !Object.hasOwn(object(schema.properties) ? schema.properties : {}, k)
      ))
  )
    throw new Error('invalid required fields')
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean'
  )
    throw new Error('invalid additionalProperties')
  if (schema.items !== undefined) {
    if (schema.type !== 'array') throw new Error('items belongs to an array')
    validateSchema(schema.items, depth + 1)
  }
}
export function checkSchema(value: Json, schema: Json): void {
  const s = schema as Config,
    type = s.type
  const matches =
    type === 'null'
      ? value === null
      : type === 'array'
        ? Array.isArray(value)
        : type === 'object'
          ? object(value)
          : type === 'integer'
            ? typeof value === 'number' && Number.isSafeInteger(value)
            : typeof value === type
  if (!matches) throw new Error(`value must be ${type}`)
  if (
    s.enum &&
    !(s.enum as Json[]).some((v) => JSON.stringify(v) === JSON.stringify(value))
  )
    throw new Error('value is outside schema enum')
  if (object(value) && type === 'object') {
    const props = (s.properties ?? {}) as Config
    for (const key of (s.required ?? []) as string[])
      if (!Object.hasOwn(value, key)) throw new Error(`required field: ${key}`)
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) checkSchema(item, props[key])
      else if (s.additionalProperties === false)
        throw new Error(`unexpected field: ${key}`)
    }
  }
  if (Array.isArray(value) && s.items)
    value.forEach((v) => checkSchema(v, s.items))
}
