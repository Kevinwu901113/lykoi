import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { initState } from 'lykoi-memory/init-state'
import { ReadOnlyMemory } from 'lykoi-memory'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { loadPersona, parseSeeds, seedConcerns, seedPersona } from 'lykoi-decide'
import type { CharacterInstance } from 'lykoi-contracts'

const INITIAL_JSON: Record<string, unknown> = {
  'budget.json': { version: 1, days: {} },
  'approval_rules.json': { always_allow: [], always_deny: [], ask: [] },
  'standing_grants.json': { grants: [], denials: [] }, 'pending_actions.json': [],
  'proactive_chat.json': [], 'messenger_outbound.json': [],
  'chat_outbox.json': { version: 2, next_id: 1, items: [] },
  'notifications.json': { version: 2, next_id: 1, items: [] },
  'telegram-inbound.json': { version: 2, next_id: 1, items: [] },
  'telegram-cursor.json': { last_update_id: 0 },
  'telegram_outbox.cursor': { last_outbox_id: 0 },
  'telegram_undelivered.json': { next_id: 1, items: [] },
}
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
  ownerName?: string
  telegramSenderId?: string
  now?: Date
}
export interface AdoptInstanceOptions extends CreateInstanceOptions {
  stateRoot: string
  auditPath?: string
}

function register(opts: CreateInstanceOptions, adopt?: AdoptInstanceOptions): CharacterInstance {
  if (!adopt && !opts.ownerName?.trim()) throw new Error('creating an instance requires an explicit owner name')
  const directory = instanceDirectory(opts.registry, opts.id)
  const definition = readFileSync(opts.definition, 'utf8')
  const persona = loadPersona(opts.definition)
  // Runtime facts such as deploy.toml never become character definition.
  const seedsPath = join(dirname(opts.definition), 'seeds.toml')
  const seeds = adopt || !existsSync(seedsPath) ? [] : parseSeeds(readFileSync(seedsPath, 'utf8'), seedsPath)
  const now = opts.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new TypeError('invalid creation time')
  const stateRoot = adopt ? realpathSync(adopt.stateRoot) : join(directory, 'state')
  if (adopt && existsSync(join(stateRoot, 'instance.json'))) throw new Error('state already belongs to an instance')
  if (adopt) {
    if (!existsSync(join(stateRoot, 'memory.db'))) throw new Error('cannot adopt missing memory.db')
    const db = new ReadOnlyMemory(join(stateRoot, 'memory.db'))
    db.close()
  }
  mkdirSync(resolve(opts.registry), { recursive: true })
  // Exclusive directory creation also rejects accidental recreation.
  mkdirSync(directory)
  let ownedMarker = false
  try {
    const personaPath = join(directory, 'definition.toml')
    writeFileSync(personaPath, definition, { flag: 'wx', mode: 0o444 })
    if (!adopt) {
      mkdirSync(stateRoot)
      initState({ db: join(stateRoot, 'memory.db'), ownerName: opts.ownerName,
        telegramSenderId: opts.telegramSenderId, now })
      const db = new ReadWriteMemory(join(stateRoot, 'memory.db'))
      try { seedConcerns(db, persona, { now }); seedPersona(db, seeds, { now }) } finally { db.close() }
      for (const [file, value] of Object.entries(INITIAL_JSON)) {
        writeFileSync(join(stateRoot, file), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
      }
    }
    const instance: CharacterInstance = {
      version: 1, id: opts.id, createdAt: now.toISOString(), origin: adopt ? 'adopted' : 'created',
      definitionHash: hash(definition), personaPath, stateRoot,
      auditPath: adopt?.auditPath ? resolve(adopt.auditPath) : join(stateRoot, 'audit.jsonl'),
      requiredFiles: [...Object.keys(INITIAL_JSON), 'heart-state.json', 'restart-marker.json', 'inbound-spool.db']
        .filter(file => existsSync(join(stateRoot, file))),
    }
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

/** The only operation that applies definition seeds. Existing directories are refused. */
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
    || typeof raw.personaPath !== 'string' || typeof raw.auditPath !== 'string'
    || !Array.isArray(raw.requiredFiles) || raw.requiredFiles.some(f => typeof f !== 'string' || f.includes('/') || f.includes('..'))) {
    throw new Error('invalid instance descriptor')
  }
  const instance = raw as unknown as CharacterInstance
  if (instance.personaPath !== join(directory, 'definition.toml')) throw new Error('instance definition path mismatch')
  if (hash(readFileSync(instance.personaPath, 'utf8')) !== instance.definitionHash) throw new Error('instance definition snapshot changed')
  loadPersona(instance.personaPath)
  const owner = json(join(instance.stateRoot, 'instance.json'))
  if (JSON.stringify(owner) !== JSON.stringify(raw)) throw new Error('instance state ownership mismatch')
  if (!existsSync(join(instance.stateRoot, 'memory.db'))) throw new Error('instance memory.db is missing; refusing rebirth')
  for (const file of instance.requiredFiles) {
    const path = join(instance.stateRoot, file)
    if (!existsSync(path)) throw new Error(`instance state missing: ${file}`)
    if (file.endsWith('.json') || file.endsWith('.cursor')) json(path)
  }
  const db = new ReadOnlyMemory(join(instance.stateRoot, 'memory.db'))
  db.close()
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

const STATE_ENV: Record<string, string> = {
  LYKOI_APPROVAL_RULES: 'approval_rules.json', LYKOI_STANDING_GRANTS: 'standing_grants.json',
  LYKOI_PENDING_ACTIONS: 'pending_actions.json', LYKOI_NOTIFICATIONS: 'notifications.json',
  LYKOI_PROACTIVE_CHAT_LEDGER: 'proactive_chat.json', LYKOI_CHAT_OUTBOX: 'chat_outbox.json',
  LYKOI_TELEGRAM_UNDELIVERED: 'telegram_undelivered.json', LYKOI_TELEGRAM_OUTBOX_CURSOR: 'telegram_outbox.cursor',
  LYKOI_MESSENGER_LEDGER: 'messenger_outbound.json',
}
/** Child-process environment. No mutation of the caller's running instance. */
export function instanceEnvironment(instance: CharacterInstance): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const [key, file] of Object.entries(STATE_ENV)) env[key] = join(instance.stateRoot, file)
  env.LYKOI_AUDIT_PATH = instance.auditPath
  env.LYKOI_PERSONA_TOML = instance.personaPath
  // Optional sidecar activation belongs to the runtime configuration, not the inherited environment.
  delete env.LYKOI_SALIENCE_DB
  delete env.LYKOI_MESSENGER_TRANSPORT_LOG
  return env
}

/** State-bearing options always come from the captured instance, never from model/channel configuration. */
export function instancePluginConfig(instance: CharacterInstance, plugin: string, config: Record<string, unknown> = {}): Record<string, unknown> {
  const state = (name: string) => join(instance.stateRoot, name)
  switch (plugin) {
    case 'lykoi-audit': return { ...config, path: instance.auditPath }
    case 'lykoi-budget': return { ...config, ledgerPath: state('budget.json') }
    case 'lykoi-memory': return { ...config, dbPath: state('memory.db') }
    case 'lykoi-ingress': return { ...config, dbPath: state('inbound-spool.db') }
    case 'lykoi-heart': return { ...config, stateFile: state('heart-state.json'), salienceDb: config.salienceDb ? state('salience_shadow.db') : '' }
    case 'lykoi-converse': return { ...config, dbPath: state('memory.db'), personaToml: instance.personaPath, restartMarker: state('restart-marker.json') }
    case 'lykoi-wake': return { ...config, dbPath: state('memory.db'), personaToml: instance.personaPath }
    case 'lykoi-adapter-telegram': return { ...config, cursorPath: state('telegram-cursor.json'), archivePath: state('telegram-inbound.json') }
    default: return config
  }
}
