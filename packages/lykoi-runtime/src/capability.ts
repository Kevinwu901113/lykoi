import type { InputSchema } from 'lykoi-contracts'

/** Validate model input at the capability boundary; no repair or coercion. */
export function validateInput(schema: InputSchema, value: unknown, path = '$'): void {
  if (typeof schema.type !== 'string') {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const selected = schema.type.find(type => type === actual || (type === 'integer' && typeof value === 'number' && Number.isInteger(value)))
    if (!selected) throw new TypeError(`${path}: expected ${schema.type.join(' or ')}`)
    return validateInput({ ...schema, type: selected }, value, path)
  }
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) throw new TypeError(`${path}: value is not in enum`)
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path}: expected object`)
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) throw new TypeError(`${path}.${key}: required`)
    for (const [key, item] of Object.entries(record)) {
      const child = schema.properties?.[key]
      if (child) validateInput(child, item, `${path}.${key}`)
      else if (schema.additionalProperties === false) throw new TypeError(`${path}.${key}: unexpected field`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new TypeError(`${path}: expected array`)
    if (schema.items) value.forEach((item, index) => validateInput(schema.items!, item, `${path}[${index}]`))
  } else if (schema.type === 'null') {
    if (value !== null) throw new TypeError(`${path}: expected null`)
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) throw new TypeError(`${path}: expected ${schema.type}`)
    if (schema.minimum !== undefined && value < schema.minimum) throw new TypeError(`${path}: below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) throw new TypeError(`${path}: above maximum`)
  } else if (typeof value !== schema.type) throw new TypeError(`${path}: expected ${schema.type}`)
}
