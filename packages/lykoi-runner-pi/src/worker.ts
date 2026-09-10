/** Detached owner of one Pi RPC session. The host Runtime may exit without ending this execution. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync, appendFileSync, chmodSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { socketPath, writeReceipt, terminal, type RunnerConfig, type RunnerReceipt } from './protocol.ts'

const root = process.argv[2]!
const config: RunnerConfig = JSON.parse(readFileSync(join(root, 'request.json'), 'utf8'))
let receipt: RunnerReceipt = { operationId: config.operationId, taskId: config.taskId, instanceId: config.instanceId, state: 'starting', turns: 0, updatedAt: new Date().toISOString() }
const save = (patch: Partial<RunnerReceipt>) => { receipt = { ...receipt, ...patch, updatedAt: new Date().toISOString() }; writeReceipt(root, receipt) }
const child = spawn(config.command[0]!, [...config.command.slice(1), '--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-approve',
  '--provider', config.provider, '--model', config.model, '--session-dir', join(root, 'sessions')], {
  cwd: config.workspace, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PI_CODING_AGENT_DIR: config.agentDir, PI_TELEMETRY: '0' },
})
save({ pid: child.pid })
const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>()
const rpc = (type: string, fields: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
  const id = randomUUID()
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Pi ${type} response timeout; execution state requires verification`)) }, 30000)
  pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ type, id, ...fields }) + '\n')
})
let buffer = '', ending = false, cancelling = false
async function finish(state: RunnerReceipt['state'], error?: string) {
  if (ending) return
  ending = true
  try {
    const current = await rpc('get_state')
    if (current.isStreaming || current.isCompacting || current.pendingMessageCount) throw new Error('Pi has not stopped')
    const stats = await rpc('get_session_stats'), messages = await rpc('get_messages')
    const last = messages.messages?.filter((m: any) => m.role === 'assistant').at(-1)
    const output = last?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') ?? ''
    const failure = last?.stopReason === 'error' ? String(last.errorMessage ?? 'Pi provider failed') : error
    save({ state: failure && state === 'succeeded' ? 'failed' : state, stats, output, error: failure, sessionFile: current.sessionFile, sessionId: current.sessionId })
    child.kill('SIGTERM')
    server.close(); clearTimeout(deadline)
  } catch (error) { ending = false; save({ state: 'unknown', error: String(error) }) }
}
async function cancel(reason: string) {
  if (terminal(receipt)) return receipt
  cancelling = true
  await rpc('clear_queue'); await rpc('abort')
  await finish('cancelled', reason)
  return receipt
}
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  buffer += chunk
  let end: number
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line) continue
    const event = JSON.parse(line)
    if (event.type !== 'message_update') appendFileSync(join(root, 'events.jsonl'), line + '\n', { mode: 0o600 })
    if (event.type === 'response') {
      const call = pending.get(event.id)
      if (call) { pending.delete(event.id); clearTimeout(call.timer); event.success ? call.resolve(event.data) : call.reject(new Error(event.error)) }
    } else if (event.type === 'tool_execution_start') save({ progress: event.toolName })
    else if (event.type === 'turn_end') {
      save({ turns: receipt.turns + 1 })
      if (receipt.turns >= config.maxTurns && event.toolResults?.length > 0 && !cancelling) void cancel('runner turn budget exhausted').catch(error => save({ state: 'unknown', error: String(error) }))
    } else if (event.type === 'agent_settled' && !cancelling) void finish('succeeded')
  }
})
child.stderr.on('data', chunk => appendFileSync(join(root, 'stderr.log'), chunk, { mode: 0o600 }))
child.on('error', error => { save({ state: 'failed', error: String(error) }); server.close(); clearTimeout(deadline) })
child.on('exit', (code, signal) => {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Pi process exited')) }; pending.clear()
  if (!terminal(receipt)) save({ state: 'unknown', error: `Pi exited (${code ?? signal}); inspect session and external operations` })
  server.close(); clearTimeout(deadline)
})
const server = createServer(socket => {
  let request = ''
  socket.on('data', chunk => {
    request += chunk.toString('utf8')
    if (!request.includes('\n')) return
    socket.pause()
    void (async () => {
      const { command } = JSON.parse(request.split('\n')[0]!)
      if (command === 'cancel') await cancel('user requested cancellation')
      else if (command === 'status') {
        if (!terminal(receipt)) { const state = await rpc('get_state'); save({ sessionFile: state.sessionFile, sessionId: state.sessionId }) }
      } else throw new Error('unknown runner command')
      socket.end(JSON.stringify({ receipt }) + '\n')
    })().catch(error => socket.end(JSON.stringify({ error: String(error) }) + '\n'))
  })
  socket.on('error', () => { /* A host reconnect does not stop Pi. */ })
})
const socket = socketPath(root)
server.on('error', error => { save({ state: 'unknown', error: String(error) }); child.kill('SIGTERM'); clearTimeout(deadline) })
server.listen(socket, () => chmodSync(socket, 0o600))
server.on('close', () => { try { unlinkSync(socket) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } })
const deadline = setTimeout(() => { void cancel('runner deadline exceeded').catch(error => save({ state: 'unknown', error: String(error) })) }, config.timeoutMs)
try {
  await rpc('set_auto_retry', { enabled: false })
  const state = await rpc('get_state')
  save({ state: 'running', sessionFile: state.sessionFile, sessionId: state.sessionId })
  appendFileSync(join(root, 'events.jsonl'), JSON.stringify({ type: 'prompt_intent', operationId: config.operationId }) + '\n', { flush: true })
  await rpc('prompt', { message: config.prompt })
} catch (error) {
  save({ state: 'unknown', error: String(error) }); child.kill('SIGTERM'); server.close(); clearTimeout(deadline)
}
