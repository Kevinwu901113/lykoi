/** 旧全链测试的同步夹具；生产时序由 lykoi-ingress 自身的 durable/FIFO 套件覆盖。 */
import type { AuditService } from 'lykoi-audit'
import type {
  InboundPart, IngressService, TurnExecutor, UserTurn,
} from 'lykoi-ingress'

export class ImmediateTestIngress implements IngressService {
  #audit: AuditService
  #executor: TurnExecutor | null = null
  #pending: InboundPart[] = []

  constructor(audit: AuditService) {
    this.#audit = audit
  }

  registerExecutor(executor: TurnExecutor): void {
    this.#executor = executor
  }

  async accept(part: InboundPart) {
    if (this.#executor === null) throw new Error('ImmediateTestIngress: executor not registered')
    this.#pending.push(part)
    return {
      inboundId: part.inboundId,
      turnId: `turn:${part.inboundId}`,
      duplicate: false,
      partCount: 1,
    }
  }

  async kick() {
    const part = this.#pending.shift()
    if (part === undefined) return
    const executor = this.#executor
    if (executor === null) throw new Error('ImmediateTestIngress: executor not registered')
    const turn: UserTurn = {
      turnId: `turn:${part.inboundId}`,
      channel: part.channel,
      userId: part.userId,
      contextId: part.contextId,
      isOwner: part.isOwner,
      parts: [part],
      firstReceivedAt: part.receivedAt,
      lastReceivedAt: part.receivedAt,
      committedAt: part.receivedAt,
      commitReason: 'idle_timeout',
    }
    const runId = `run:${turn.turnId}:r0`
    const { terminal } = await executor(turn, { runId })
    await this.#audit.record({
      type: 'converse/turn_terminal',
      turn_id: turn.turnId,
      inbound_id: part.inboundId,
      inbound_ids: [part.inboundId],
      platform_message_ids: [part.platformMessageId],
      run_id: runId,
      update_id: part.platformUpdateId ?? null,
      message_id: part.platformMessageId,
      context_id: part.contextId,
      user_id: part.userId,
      is_owner: part.isOwner,
      part_count: 1,
      commit_reason: 'idle_timeout',
      ...terminal,
    })
  }

  async tick() {}
  async drain() {}
  async start() {}
  async close() {}
}
