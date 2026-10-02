import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  ComposerStore,
  ComponentRegistry,
  ComposerEngine,
  builtins
} from '../packages/lykoi-composer/src/index.ts'
import { createComposerServer } from '../packages/lykoi-composer/src/server.ts'

// Deployment settings are supplied only through an explicit local JSON file.
const configPath = process.argv[2]
const config = configPath ? JSON.parse(readFileSync(resolve(configPath), 'utf8')) : {}
const stateRoot = resolve(config.stateRoot ?? 'var/composer')
const port = config.port ?? 4310
if (
  !Number.isSafeInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  (config.credentials &&
    (typeof config.credentials !== 'object' ||
      Array.isArray(config.credentials) ||
      Object.values(config.credentials).some((v) => typeof v !== 'string')))
)
  throw new Error('invalid deployment configuration')
mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
const lockPath = join(stateRoot, 'process.lock')
// No auto-stealing a deployment lock. After a forced kill, verify no old process survives
// before removing process.lock; this keeps recovery from racing a live external action.
const lock = openSync(lockPath, 'wx', 0o600)
let released = false
function releaseLock() {
  if (released) return
  released = true
  closeSync(lock)
  unlinkSync(lockPath)
}
// Covers startup failures too. SIGKILL deliberately leaves the recovery lock in place.
process.once('exit', releaseLock)
writeFileSync(lock, JSON.stringify({ pid: process.pid }))
const store = new ComposerStore(join(stateRoot, 'composer.sqlite'))
const registry = new ComponentRegistry((id, version) => store.required(id, version))
builtins.forEach((component) => registry.register(component))
const engine = new ComposerEngine(store, registry, {
  workspaceRoot: join(stateRoot, 'workspaces'),
  credentials: config.credentials
})
const server = createComposerServer(store, registry, engine)
let closing = false
async function close() {
  if (closing) return
  closing = true
  server.close()
  await engine.close()
  store.close()
  releaseLock()
}
process.once('SIGINT', () => {
  void close()
})
process.once('SIGTERM', () => {
  void close()
})
server.once('error', (error) => {
  console.error(`Composer could not listen: ${(error as NodeJS.ErrnoException).code ?? 'error'}`)
  void close().then(() => {
    process.exitCode = 1
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Composer: http://127.0.0.1:${port}`)
  void engine.recover().catch(() => {
    console.error('Composer recovery failed; inspect the local database')
    void close().then(() => {
      process.exitCode = 1
    })
  })
})
