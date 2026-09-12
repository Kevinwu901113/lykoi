/** Local, synthetic instance; production continues to use its own explicit profile. */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance } from './instance-state.ts'
import { main } from './instance.ts'

const registry = resolve('var/panel/instances'), id = 'panel-demo'
if (!existsSync(resolve(registry, id))) createInstance({ registry, id,
  definition: resolve('packages/lykoi-decide/test/fixtures/instance/persona.toml'), ownerName: '本地体验者' })
await main(['run', '--registry', registry, '--id', id, '--config', resolve('profile/cordis.panel.yml')])
