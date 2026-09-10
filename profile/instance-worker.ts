import { Context, Logger } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createInterface } from 'node:readline/promises'
import { restoreInstance, instanceEnvironment } from './instance-state.ts'
import type { ConverseService } from 'lykoi-converse'
import { instanceEntries, drainInstance } from './assembly.ts'

const arg = (key: string) => { const i = process.argv.indexOf(key); if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${key}`); return process.argv[i + 1]! }
// One immutable binding per OS process. No selection pointer is consulted after this point.
const instance = restoreInstance(arg('--registry'), arg('--id'))
const entries = instanceEntries(arg('--config'), instance)
Object.assign(process.env, instanceEnvironment(instance, entries.find(e => e.name === 'lykoi-audit')?.config?.path))
const root = new Context()
root.provide('lykoiInstance', instance)
const exporter = { colors: 0, export(message: Parameters<typeof Logger.format>[1]) { console.error(Logger.format(exporter, message)) } }
root.logger.exporter(exporter)
root.baseUrl = import.meta.url
await root.plugin(Loader, { baseUrl: import.meta.url })
await root.loader.root.update(entries)
await root.loader.await()
for (const name of ['lykoiRuntime', 'audit', 'lykoiMemory', 'converse'] as const) {
  if (!root.get(name)) throw new Error(`instance startup missing ${name}`)
}
if (entries.some(e => e.name === 'lykoi-task' && !e.disabled) && !root.get('tasks')) throw new Error('instance startup missing tasks')
if (process.argv.includes('--console')) root.lykoiRuntime.onActivity(event => {
  const { result, ...metadata } = event
  console.log(JSON.stringify({ type: 'instance/capability', instanceId: instance.id, ...metadata,
    ...(result === undefined ? {} : { preview: JSON.stringify(result).slice(0, 4000) }) }))
})
if (process.argv.includes('--console') && root.get('tasks')) root.tasks.bindInteractions({
  requestApproval: async action => { console.log(JSON.stringify({ type: 'task/approval', instanceId: instance.id, ...action, command: `/task approve ${action.operationId}` })) },
  deliver: async task => { console.log(JSON.stringify({ type: 'task/delivery', instanceId: instance.id, taskId: task.id, text: task.delivery!.content })); return { state: 'sent', receipt: { channel: 'console', taskId: task.id } } },
})
console.log(JSON.stringify({ type: 'instance/ready' , instanceId: instance.id }))
let closing = false
let conversation: Promise<unknown> = Promise.resolve()
let shutdown: Promise<void> | undefined
function close(): Promise<void> {
  if (shutdown) return shutdown
  closing = true
  shutdown = (async () => {
    // Keep the old result's stdout and persistent destination alive until completion.
    await Promise.allSettled([conversation, root.get('tasks')?.close()])
    await drainInstance(root)
  })()
  return shutdown
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  close().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
})
if (process.argv.includes('--console')) {
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  try {
    for await (const line of input) {
      if (closing) break
      if (!line.trim()) continue
      if (/^\/mind(?:\s|$)/.test(line)) {
        console.log(JSON.stringify({ type: 'mind/state', instanceId: instance.id, state: root.mind.view(line.replace(/^\/mind\s*/, '')) }))
        continue
      }
      try {
        const command = await root.get('tasks')?.command(line)
        if (command != null) { console.log(JSON.stringify({ type: 'task/command', text: command })); continue }
      } catch (error) { console.error(JSON.stringify({ type: 'task/error', error: String(error) })); continue }
      conversation = (root.get('converse') as ConverseService).conversation.send(line)
      const reply = await conversation
      const outcome = (root.get('converse') as ConverseService).conversation.lastCycleOutcome()
      console.log(JSON.stringify({ type: 'instance/reply', instanceId: instance.id, text: reply, outcome }))
    }
  } finally { await close() }
}
