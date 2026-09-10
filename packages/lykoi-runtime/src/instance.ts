import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { CharacterInstance } from 'lykoi-contracts'

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
function instanceDirectory(registry: string, id: string): string {
  if (!ID.test(id)) throw new TypeError('invalid instance id')
  return join(resolve(registry), id)
}

export interface CreateInstanceOptions {
  registry: string
  id: string
  definition: string
  initialize?: (instance: CharacterInstance) => void
  now?: Date
}
export interface AdoptInstanceOptions extends CreateInstanceOptions {
  stateRoot: string
}

function register(opts: CreateInstanceOptions, adopt?: AdoptInstanceOptions): CharacterInstance {
  const directory = instanceDirectory(opts.registry, opts.id)
  const definition = readFileSync(opts.definition, 'utf8')
  const now = opts.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new TypeError('invalid creation time')
  const stateRoot = adopt ? realpathSync(adopt.stateRoot) : join(directory, 'state')
  if (adopt && existsSync(join(stateRoot, 'instance.json'))) throw new Error('state already belongs to an instance')
  mkdirSync(resolve(opts.registry), { recursive: true })
  // Exclusive directory creation also rejects accidental recreation.
  mkdirSync(directory)
  let ownedMarker = false
  try {
    const personaPath = join(directory, 'definition.toml')
    writeFileSync(personaPath, definition, { flag: 'wx', mode: 0o444 })
    if (!adopt) mkdirSync(stateRoot)
    const instance: CharacterInstance = {
      version: 1, id: opts.id, createdAt: now.toISOString(), origin: adopt ? 'adopted' : 'created',
      definitionHash: hash(definition), personaPath, stateRoot,
    }
    if (!adopt) opts.initialize?.(Object.freeze(instance))
    const text = JSON.stringify(instance, null, 2) + '\n'
    writeFileSync(join(stateRoot, 'instance.json'), text, { flag: 'wx', mode: 0o600 })
    ownedMarker = true
    writeFileSync(join(directory, 'instance.json'), text, { flag: 'wx', mode: 0o600 })
    return Object.freeze(instance)
  } catch (error) {
    if (adopt && ownedMarker) rmSync(join(stateRoot, 'instance.json'))
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

/** Create identity and invoke the assembly birth initializer once; existing directories are refused. */
export function createInstance(opts: CreateInstanceOptions): CharacterInstance { return register(opts) }
/** Register existing storage without reseeding, copying, rewriting or migrating its DB. */
export function adoptInstance(opts: AdoptInstanceOptions): CharacterInstance { return register(opts, opts) }

export function restoreInstance(registry: string, id: string): CharacterInstance {
  const directory = instanceDirectory(registry, id)
  const raw = json(join(directory, 'instance.json'))
  if (!object(raw) || raw.version !== 1 || raw.id !== id
    || !['created', 'adopted'].includes(String(raw.origin))
    || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))
    || typeof raw.definitionHash !== 'string' || typeof raw.stateRoot !== 'string'
    || typeof raw.personaPath !== 'string') {
    throw new Error('invalid instance descriptor')
  }
  const instance = raw as unknown as CharacterInstance
  if (instance.personaPath !== join(directory, 'definition.toml')) throw new Error('instance definition path mismatch')
  if (hash(readFileSync(instance.personaPath, 'utf8')) !== instance.definitionHash) throw new Error('instance definition snapshot changed')
  const owner = json(join(instance.stateRoot, 'instance.json'))
  if (JSON.stringify(owner) !== JSON.stringify(raw)) throw new Error('instance state ownership mismatch')
  return Object.freeze(instance)
}

/** Selection changes the next launch only; a running process keeps its captured binding. */
export function selectInstance(registry: string, id: string): CharacterInstance {
  const instance = restoreInstance(registry, id)
  const target = join(resolve(registry), 'selected.json')
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, id }) + '\n', { flag: 'wx', mode: 0o600 })
  renameSync(temporary, target)
  return instance
}
export function selectedInstance(registry: string): CharacterInstance {
  const selected = json(join(resolve(registry), 'selected.json'))
  if (!object(selected) || selected.version !== 1 || typeof selected.id !== 'string') throw new Error('invalid instance selection')
  return restoreInstance(registry, selected.id)
}
