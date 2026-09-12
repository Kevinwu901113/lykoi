#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instanceEntries } from './assembly.ts'
import { acquireInstanceLock, adoptInstance, createInstance, instanceEnvironment, restoreInstance, selectedInstance, selectInstance } from './instance-state.ts'

function value(args: string[], key: string): string | undefined {
  const i = args.indexOf(key)
  if (i < 0) return undefined
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`${key} requires a value`)
  return args[i + 1]
}
function required(args: string[], key: string): string {
  const v = value(args, key)
  if (!v) throw new Error(`${key} is required`)
  return v
}
export async function main(args: string[]): Promise<void> {
  const [command] = args
  if (!command || command === '--help') {
    console.log('instance create --registry DIR --id ID --definition FILE --owner-name NAME [--telegram-sender-id ID]\ninstance adopt --registry DIR --id ID --definition FILE --state-root DIR [--audit-path FILE]\ninstance list|select --registry DIR [--id ID]\ninstance run --registry DIR --config FILE [--id ID] [--console]')
    return
  }
  const registry = resolve(required(args, '--registry'))
  if (command === 'create' || command === 'adopt') {
    const opts = { registry, id: required(args, '--id'), definition: resolve(required(args, '--definition')),
      ownerName: value(args, '--owner-name'), telegramSenderId: value(args, '--telegram-sender-id') }
    const instance = command === 'create' ? createInstance(opts) : adoptInstance({ ...opts,
      stateRoot: required(args, '--state-root') })
    console.log(JSON.stringify({ id: instance.id, stateRoot: instance.stateRoot, origin: instance.origin }))
    return
  }
  if (command === 'list') {
    for (const name of readdirSync(registry, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)) {
      const i = restoreInstance(registry, name)
      console.log(JSON.stringify({ id: i.id, stateRoot: i.stateRoot, origin: i.origin }))
    }
    return
  }
  if (command === 'select') { console.log(selectInstance(registry, required(args, '--id')).id); return }
  if (command !== 'run') throw new Error(`unknown instance command: ${command}`)
  const instance = value(args, '--id') ? restoreInstance(registry, required(args, '--id')) : selectedInstance(registry)
  const config = resolve(required(args, '--config'))
  const entries = instanceEntries(config, instance) // reject configuration before acquiring the run lock
  const lock = acquireInstanceLock(instance, registry)
  const worker = fileURLToPath(new URL('./instance-worker.ts', import.meta.url))
  const child = spawn(process.execPath, [worker, '--registry', registry, '--id', instance.id, '--config', config,
    ...(args.includes('--console') ? ['--console'] : [])], { stdio: 'inherit', env: instanceEnvironment(instance, entries.find(e => e.name === 'lykoi-audit')?.config?.path) })
  if (child.pid) lock.update(child.pid)
  const forward = (signal: NodeJS.Signals) => child.kill(signal)
  const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT')
  process.on('SIGTERM', term); process.on('SIGINT', interrupt)
  try {
    const code = await new Promise<number>((ok, fail) => { child.once('error', fail); child.once('exit', (code, signal) => ok(code ?? (signal ? 1 : 0))) })
    if (code !== 0) throw new Error(`instance ${instance.id} exited with code ${code}`)
  } finally {
    process.off('SIGTERM', term); process.off('SIGINT', interrupt)
    lock.release()
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(`instance: ${e.message}`); process.exitCode = 1 })
}
