import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readReceipt, writeReceipt, socketPath, terminal, type RunnerConfig, type RunnerReceipt } from './protocol.ts'
export type { RunnerConfig, RunnerReceipt } from './protocol.ts'

export class PiRunner {
  readonly root: string
  constructor(root: string) { this.root = resolve(root); mkdirSync(this.root, { recursive: true }) }
  directory(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid runner execution ID')
    return join(this.root, id)
  }
  start(config: RunnerConfig, env: Record<string, string>): RunnerReceipt {
    const root = this.directory(config.operationId)
    try { mkdirSync(root, { mode: 0o700 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return readReceipt(root) // Existing execution is never relaunched, even if its worker is unreachable.
    }
    writeFileSync(join(root, 'request.json'), JSON.stringify(config), { mode: 0o600, flag: 'wx' })
    const receipt: RunnerReceipt = { operationId: config.operationId, taskId: config.taskId, instanceId: config.instanceId, state: 'starting', turns: 0, updatedAt: new Date().toISOString() }
    writeReceipt(root, receipt)
    const log = openSync(join(root, 'worker.log'), 'a', 0o600)
    const worker = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url)), root], {
      detached: true, stdio: ['ignore', log, log], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: config.workspace, ...env },
    })
    worker.on('error', error => writeReceipt(root, { ...receipt, state: 'failed', error: String(error) }))
    closeSync(log)
    worker.unref()
    return receipt
  }
  async request(id: string, command: 'status' | 'cancel'): Promise<RunnerReceipt> {
    const root = this.directory(id), previous = readReceipt(root)
    if (terminal(previous)) return previous
    try {
      return await new Promise<RunnerReceipt>((resolve, reject) => {
        const socket = connect(socketPath(root)), timer = setTimeout(() => socket.destroy(new Error('worker response timeout')), 35000)
        let text = ''
        socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'))
        socket.on('data', chunk => { text += chunk.toString('utf8') })
        socket.on('end', () => { try { const result = JSON.parse(text); result.error ? reject(new Error(result.error)) : resolve(result.receipt) } catch (error) { reject(error) } })
        socket.on('error', reject); socket.on('close', () => clearTimeout(timer))
      })
    } catch (error) {
      // Read again: the worker may have committed its terminal result before closing the socket.
      const current = readReceipt(root)
      return terminal(current) ? current : { ...current, state: 'unknown', error: String(error) }
    }
  }
}
