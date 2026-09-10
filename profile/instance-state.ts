import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initState } from 'lykoi-memory/init-state'
import { ReadOnlyMemory } from 'lykoi-memory'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { loadPersona, loadCharacterPackage, seedConcerns, seedPersona } from 'lykoi-decide'
import type { CharacterInstance } from 'lykoi-contracts'
import * as identity from 'lykoi-runtime/instance'

const INITIAL_JSON: Record<string, unknown> = {
  'budget.json': { version: 1, days: {} },
  'approval_rules.json': { always_allow: [], always_deny: [], ask: [] },
  'standing_grants.json': { grants: [], denials: [] }, 'pending_actions.json': [],
  'proactive_chat.json': [],
  'chat_outbox.json': { version: 2, next_id: 1, items: [] },
  'notifications.json': { version: 2, next_id: 1, items: [] },
  'telegram-inbound.json': { version: 2, next_id: 1, items: [] },
  'telegram-cursor.json': { last_update_id: 0 },
  'telegram_outbox.cursor': { last_outbox_id: 0 },
  'telegram_undelivered.json': { next_id: 1, items: [] },
}

// This profile's storage and birth wiring, not part of character identity.
export interface CreateInstanceOptions extends Omit<identity.CreateInstanceOptions, 'initialize'> {
  ownerName?: string
  telegramSenderId?: string
}
export function createInstance(opts: CreateInstanceOptions): CharacterInstance {
  if (!opts.ownerName?.trim()) throw new Error('creating an instance requires an explicit owner name')
  const now = opts.now ?? new Date()
  const persona = loadPersona(opts.definition)
  const { seeds } = loadCharacterPackage(opts.definition)
  return identity.createInstance({ ...opts, initialize(instance) {
    initState({ db: join(instance.stateRoot, 'memory.db'), ownerName: opts.ownerName,
      telegramSenderId: opts.telegramSenderId, now })
    const db = new ReadWriteMemory(join(instance.stateRoot, 'memory.db'))
    try { seedConcerns(db, persona, { now }); seedPersona(db, seeds, { now }) } finally { db.close() }
    for (const [file, value] of Object.entries(INITIAL_JSON)) {
      writeFileSync(join(instance.stateRoot, file), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
    }
  } })
}
function validateMemory(stateRoot: string): void {
  if (!existsSync(join(stateRoot, 'memory.db'))) throw new Error('instance memory.db is missing; refusing rebirth')
  const db = new ReadOnlyMemory(join(stateRoot, 'memory.db')); db.close()
}
export function adoptInstance(opts: CreateInstanceOptions & { stateRoot: string }): CharacterInstance {
  loadPersona(opts.definition)
  validateMemory(opts.stateRoot)
  return identity.adoptInstance(opts)
}
export function restoreInstance(registry: string, id: string): CharacterInstance {
  const instance = identity.restoreInstance(registry, id)
  loadPersona(instance.personaPath)
  validateMemory(instance.stateRoot)
  for (const file of Object.keys(INITIAL_JSON)) {
    const path = join(instance.stateRoot, file)
    if (!existsSync(path)) {
      if (instance.origin === 'created') throw new Error(`instance state missing: ${file}`)
      continue // Adopt can register storage before optional plugins are configured.
    }
    JSON.parse(readFileSync(path, 'utf8'))
  }
  return instance
}
export function selectInstance(registry: string, id: string): CharacterInstance {
  restoreInstance(registry, id)
  return identity.selectInstance(registry, id)
}
export function selectedInstance(registry: string): CharacterInstance {
  return restoreInstance(registry, identity.selectedInstance(registry).id)
}

const STATE_ENV: Record<string, string> = {
  LYKOI_APPROVAL_RULES: 'approval_rules.json', LYKOI_STANDING_GRANTS: 'standing_grants.json',
  LYKOI_PENDING_ACTIONS: 'pending_actions.json', LYKOI_NOTIFICATIONS: 'notifications.json',
  LYKOI_PROACTIVE_CHAT_LEDGER: 'proactive_chat.json', LYKOI_CHAT_OUTBOX: 'chat_outbox.json',
  LYKOI_TELEGRAM_UNDELIVERED: 'telegram_undelivered.json', LYKOI_TELEGRAM_OUTBOX_CURSOR: 'telegram_outbox.cursor',
  LYKOI_MESSENGER_LEDGER: 'messenger_outbound.json',
}
/** Child-process environment. No mutation of the caller's running instance. */
export function instanceEnvironment(instance: CharacterInstance, auditPath?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const [key, file] of Object.entries(STATE_ENV)) env[key] = join(instance.stateRoot, file)
  env.LYKOI_AUDIT_PATH = auditPath ?? join(instance.stateRoot, 'audit.jsonl')
  env.LYKOI_PERSONA_TOML = instance.personaPath
  // Optional sidecar activation belongs to the runtime configuration, not the inherited environment.
  delete env.LYKOI_SALIENCE_DB
  delete env.LYKOI_MESSENGER_TRANSPORT_LOG
  return env
}

/** State-bearing options always come from the captured instance, never from model/channel configuration. */
export function instancePluginConfig(instance: CharacterInstance, plugin: string, config: Record<string, unknown> = {}, auditPath?: string): Record<string, unknown> {
  const state = (name: string) => join(instance.stateRoot, name)
  switch (plugin) {
    case 'lykoi-audit': return { ...config, path: auditPath ?? join(instance.stateRoot, 'audit.jsonl') }
    case 'lykoi-budget':
      JSON.parse(readFileSync(state('budget.json'), 'utf8')) // An installed budget must not recreate a lost ledger.
      return { ...config, ledgerPath: state('budget.json') }
    case 'lykoi-organ-workspace': return { ...config, directory: state('workspace') }
    case 'lykoi-runner-pi': return { ...config, root: state('runner-pi') }
    case 'lykoi-task': return { ...config, dbPath: state('tasks.sqlite'), memoryPath: state('memory.db'), root: state('tasks'), personaToml: instance.personaPath }
    case 'lykoi-memory': return { ...config, dbPath: state('memory.db') }
    case 'lykoi-ingress': return { ...config, dbPath: state('inbound-spool.db') }
    case 'lykoi-heart': return { ...config, stateFile: state('heart-state.json'), salienceDb: config.salienceDb ? state('salience_shadow.db') : '' }
    case 'lykoi-converse': return { ...config, dbPath: state('memory.db'), personaToml: instance.personaPath, restartMarker: state('restart-marker.json') }
    case 'lykoi-wake': return { ...config, dbPath: state('memory.db'), personaToml: instance.personaPath }
    case 'lykoi-adapter-telegram': return { ...config, cursorPath: state('telegram-cursor.json'), archivePath: state('telegram-inbound.json') }
    default: return config
  }
}
