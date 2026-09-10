import { createHash } from 'node:crypto'
import { writeFileSync, renameSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RunnerConfig {
  command: string[]; provider: string; model: string; workspace: string; prompt: string
  operationId: string; taskId: string; instanceId: string; timeoutMs: number; maxTurns: number
  agentDir: string
}
export interface RunnerReceipt {
  operationId: string; taskId: string; instanceId: string
  state: 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  pid?: number; sessionFile?: string; sessionId?: string; progress?: string; output?: string; error?: string
  turns: number; stats?: unknown; updatedAt: string
}
export function socketPath(root: string) { return join('/tmp', `lykoi-pi-${createHash('sha256').update(root).digest('hex').slice(0, 24)}.sock`) }
export function writeReceipt(root: string, receipt: RunnerReceipt) {
  const target = join(root, 'receipt.json'), temporary = target + '.tmp'
  writeFileSync(temporary, JSON.stringify(receipt), { mode: 0o600, flush: true }); renameSync(temporary, target)
}
export function readReceipt(root: string): RunnerReceipt { return JSON.parse(readFileSync(join(root, 'receipt.json'), 'utf8')) }
export const terminal = (receipt: RunnerReceipt) => ['succeeded', 'failed', 'cancelled'].includes(receipt.state)
