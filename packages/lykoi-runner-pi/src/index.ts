import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { BudgetService } from 'lykoi-budget'
import type { Capability, CapabilityExecutionContext, CapabilityRecovery } from 'lykoi-contracts'
import { DelegationLedger } from 'lykoi-kernel'
import { PiRunner, type RunnerReceipt } from './client.ts'
import { terminal } from './protocol.ts'

export const name = 'lykoi-runner-pi'
export const inject = ['lykoiRuntime', 'audit', 'budget']
export interface Config { dbPath: string; root: string; command: string[]; provider: string; budgetRoute: string; model: string; agentDir: string; credentialEnv: string[]; timeoutMs: number; maxTurns: number }
export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(), root: Schema.string().required(), command: Schema.array(String).required(),
  provider: Schema.string().required(), budgetRoute: Schema.string().required(), model: Schema.string().required(), agentDir: Schema.string().required(),
  credentialEnv: Schema.array(String).default([]), timeoutMs: Schema.number().default(300000), maxTurns: Schema.number().default(8),
})

export function runnerCapabilities(runner: PiRunner, ledger: DelegationLedger, config: Config, budget: BudgetService): Capability[] {
  const sync = async (receipt: RunnerReceipt) => {
    let contract = ledger.getContract(receipt.operationId)
    if (!contract) throw new Error('runner execution has no delegation contract')
    if (receipt.state === 'unknown' || receipt.state === 'starting') return receipt
    if (contract.state === 'dispatched') contract = await ledger.transition(contract.id, 'running', { reason: 'Pi execution observed' })
    if (terminal(receipt)) {
      const stats = receipt.stats as { tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number } } | undefined
      if (stats?.tokens) await budget.charge({ route: config.budgetRoute, runId: receipt.operationId, receiptId: receipt.operationId,
        promptTokens: stats.tokens.input + (stats.tokens.cacheRead ?? 0) + (stats.tokens.cacheWrite ?? 0), completionTokens: stats.tokens.output })
      if (!ledger.getReceipt(`receipt-${receipt.operationId}`)) await ledger.addReceipt(contract.id, JSON.stringify(receipt), { receiptId: `receipt-${receipt.operationId}` })
      if (contract.state === 'running') await ledger.transition(contract.id, receipt.state === 'succeeded' ? 'collected' : 'rejected', { reason: receipt.state })
    }
    return receipt
  }
  const requireContext = (context?: CapabilityExecutionContext) => {
    if (!context) throw new Error('Runner execution must belong to a persistent task')
    context.signal?.throwIfAborted()
    return context
  }
  const recover = async (_params: Record<string, unknown>, context: CapabilityExecutionContext): Promise<CapabilityRecovery> => {
    const receipt = await sync(await runner.request(context.operationId, 'status'))
    return terminal(receipt) ? { status: 'completed', observation: { success: receipt.state === 'succeeded', data: receipt, error: receipt.state === 'succeeded' ? null : receipt.error ?? receipt.state } }
      : { status: receipt.state === 'unknown' ? 'unknown' : 'pending', detail: receipt.error ?? receipt.progress ?? receipt.state }
  }
  return [
    { name: 'delegation.dispatch', description: 'Start one real Pi coding execution for this task. Returns immediately with an execution ID; inspect progress and artifacts before treating the goal as completed. OS commands run under the deployed user, within the explicitly approved execution limits.',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'], additionalProperties: false },
      handler: async (params, execution) => {
        const context = requireContext(execution)
        await budget.gate(config.budgetRoute)
        const contractId = context.operationId
        let contract = ledger.getContract(contractId)
        if (!contract) contract = await ledger.createContract({ contractId, requester: context.instanceId, agentUserId: `pi-${context.instanceId}`, depth: 0,
          contractYaml: JSON.stringify({ taskId: context.taskId, workspace: context.workspace, prompt: params.prompt, timeoutMs: config.timeoutMs, maxTurns: config.maxTurns }) })
        if (contract.state === 'draft') await ledger.transition(contractId, 'dispatched', { reason: 'Pi launch requested' })
        const env: Record<string, string> = {}
        for (const key of config.credentialEnv) { const value = process.env[key]; if (value === undefined) throw new Error(`Runner credential environment missing: ${key}`); env[key] = value }
        context.signal?.throwIfAborted()
        const receipt = runner.start({ command: config.command, provider: config.provider, model: config.model, agentDir: config.agentDir,
          workspace: context.workspace, prompt: String(params.prompt), operationId: contractId, taskId: context.taskId, instanceId: context.instanceId,
          timeoutMs: config.timeoutMs, maxTurns: config.maxTurns }, env)
        return { ...receipt, pending: !terminal(receipt) }
      }, recover,
      cancel: async (_params, context) => {
        const receipt = await sync(await runner.request(context.operationId, 'cancel'))
        return terminal(receipt) ? { status: 'completed', observation: { success: receipt.state === 'succeeded', data: receipt, error: receipt.state === 'succeeded' ? null : receipt.error ?? receipt.state } } : { status: 'unknown', detail: receipt.error ?? 'Pi stop is not confirmed' }
      },
    },
    { name: 'delegation.status', description: 'Query the original Pi execution and its delegation contract; losing a connection does not mean it stopped.',
      inputSchema: { type: 'object', properties: { contract_id: { type: 'string' } }, required: ['contract_id'], additionalProperties: false },
      handler: async p => { const receipt = await sync(await runner.request(String(p.contract_id), 'status')); return { execution: receipt, contract: ledger.getContract(String(p.contract_id)), receipts: ledger.listReceipts(String(p.contract_id)) } },
    },
    { name: 'delegation.collect', description: 'Collect a real terminal Pi execution receipt. This is execution evidence, not acceptance of the task goal.',
      inputSchema: { type: 'object', properties: { contract_id: { type: 'string' } }, required: ['contract_id'], additionalProperties: false },
      handler: async p => { const receipt = await sync(await runner.request(String(p.contract_id), 'status')); if (!terminal(receipt)) return { ok: false, error: 'runner is not confirmed terminal', execution: receipt }; return { execution: receipt, receipts: ledger.listReceipts(String(p.contract_id)) } },
    },
  ]
}
export function apply(ctx: Context, config: Config) {
  if (!ctx.lykoiRuntime.instance) throw new Error('Pi Runner requires a Character Instance')
  if (!config.command.length || !Number.isSafeInteger(config.maxTurns) || config.maxTurns < 1 || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1) throw new Error('invalid Pi command or execution budget')
  const ledger = new DelegationLedger({ dbPath: config.dbPath, sink: ctx.audit }), runner = new PiRunner(config.root)
  ctx.effect(() => () => ledger.close(), 'runner delegation ledger')
  ctx.effect(() => ctx.lykoiRuntime.register({ organId: 'pi-runner', capabilities: runnerCapabilities(runner, ledger, config, ctx.budget), sideEffects: [] }), 'Pi capabilities')
}
