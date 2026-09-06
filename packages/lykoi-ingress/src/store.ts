/** SQLite 正本：durable accept、确定性组装、FIFO claim、终局去重。 */
import { DatabaseSync } from 'node:sqlite'
import { EXPECTED_MIND_SCHEMA_VERSION, parseStateTimestamp } from 'lykoi-memory'
import { formatPyIso } from 'lykoi-memory/rw'
import type {
  AcceptInboundResult,
  InboundPart,
  TurnCommitReason,
  TurnTerminalPayload,
  UserTurn,
} from './types.ts'

interface TurnRow {
  id: string
  channel: string
  user_id: string
  context_id: string
  is_owner: number
  state: string
  first_received_at: string
  last_received_at: string
  committed_at: string | null
  commit_reason: TurnCommitReason | null
  queue_seq: number | null
  run_id: string | null
  terminal_payload_json: string | null
}

interface PartRow {
  inbound_id: string
  channel: string
  platform_message_id: string
  platform_update_id: string | null
  user_id: string
  context_id: string
  is_owner: number
  text: string
  received_at: string
  source_timestamp: string | null
  reply_to_platform_message_id: string | null
  turn_id: string
  part_order: number
}

export interface StoreAcceptResult extends AcceptInboundResult {
  committed: UserTurn[]
}

function requireNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`lykoi-ingress: ${name} must be a non-empty string`)
  }
}

function dueOf(row: Pick<TurnRow, 'first_received_at' | 'last_received_at'>, idleMs: number, hardMs: number): {
  at: Date
  reason: TurnCommitReason
} {
  const idle = parseStateTimestamp(row.last_received_at).getTime() + idleMs
  const hard = parseStateTimestamp(row.first_received_at).getTime() + hardMs
  return idle <= hard
    ? { at: new Date(idle), reason: 'idle_timeout' }
    : { at: new Date(hard), reason: 'hard_timeout' }
}

export class DurableTurnStore {
  #db: DatabaseSync

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath)
    try {
      this.#db.exec('PRAGMA busy_timeout = 10000')
      this.#db.exec('PRAGMA foreign_keys = ON')
      const row = this.#db.prepare('SELECT MAX(version) AS version FROM mind_schema').get() as
        | { version: unknown }
        | undefined
      if (row?.version !== EXPECTED_MIND_SCHEMA_VERSION) {
        throw new Error(
          `lykoi-ingress: mind_schema version ${String(row?.version)} != expected `
          + `${EXPECTED_MIND_SCHEMA_VERSION}; durable ingress unavailable`,
        )
      }
    } catch (err) {
      this.#db.close()
      throw err
    }
  }

  #tx<T>(fn: () => T): T {
    if (this.#db.isTransaction) throw new Error('lykoi-ingress: nested transaction')
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.#db.exec('COMMIT')
      return result
    } catch (err) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK')
      throw err
    }
  }

  accept(part: InboundPart, idleMs: number, hardMs: number): StoreAcceptResult {
    for (const [value, name] of [
      [part.inboundId, 'inboundId'], [part.channel, 'channel'],
      [part.platformMessageId, 'platformMessageId'], [part.userId, 'userId'],
      [part.contextId, 'contextId'], [part.receivedAt, 'receivedAt'],
    ] as const) requireNonEmpty(value, name)
    parseStateTimestamp(part.receivedAt)
    if (!Number.isFinite(idleMs) || idleMs <= 0 || !Number.isFinite(hardMs) || hardMs <= 0) {
      throw new TypeError('lykoi-ingress: settle windows must be positive finite milliseconds')
    }
    if (idleMs > hardMs) {
      throw new TypeError('lykoi-ingress: idle window must not exceed hard window')
    }

    return this.#tx(() => {
      const existing = this.#db.prepare(
        `SELECT inbound_id, turn_id
           FROM inbound_parts
          WHERE inbound_id = ?
             OR (channel = ? AND context_id = ? AND platform_message_id = ?)
             OR (? IS NOT NULL AND channel = ? AND platform_update_id = ?)
          ORDER BY rowid ASC LIMIT 1`,
      ).get(
        part.inboundId,
        part.channel, part.contextId, part.platformMessageId,
        part.platformUpdateId ?? null, part.channel, part.platformUpdateId ?? null,
      ) as { inbound_id: string; turn_id: string } | undefined
      if (existing !== undefined) {
        return {
          inboundId: existing.inbound_id,
          turnId: existing.turn_id,
          duplicate: true,
          partCount: this.#partCount(existing.turn_id),
          committed: [],
        }
      }

      const receivedAt = parseStateTimestamp(part.receivedAt)
      const collecting = this.#db.prepare(
        `SELECT id, channel, user_id, context_id, is_owner, state, first_received_at,
                last_received_at, committed_at, commit_reason, queue_seq, run_id, terminal_payload_json
           FROM user_turns
          WHERE state = 'collecting' AND channel = ? AND context_id = ?
            AND user_id = ?`,
      ).get(part.channel, part.contextId, part.userId) as TurnRow | undefined

      const committed: UserTurn[] = []
      let turnId: string
      if (collecting !== undefined && (collecting.is_owner !== (part.isOwner ? 1 : 0)
        || receivedAt.getTime() >= dueOf(collecting, idleMs, hardMs).at.getTime())) {
        committed.push(this.#commit(collecting, idleMs, hardMs))
        turnId = this.#createTurn(part)
      } else if (collecting === undefined) {
        turnId = this.#createTurn(part)
      } else {
        turnId = collecting.id
      }

      const partOrder = this.#partCount(turnId)
      this.#db.prepare(
        `INSERT INTO inbound_parts
           (inbound_id, channel, platform_message_id, platform_update_id, user_id, context_id,
            is_owner, text, received_at, source_timestamp, reply_to_platform_message_id,
            turn_id, part_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        part.inboundId, part.channel, part.platformMessageId, part.platformUpdateId ?? null,
        part.userId, part.contextId, part.isOwner ? 1 : 0, part.text, part.receivedAt,
        part.sourceTimestamp ?? null, part.replyToPlatformMessageId ?? null,
        turnId, partOrder, part.receivedAt,
      )
      this.#db.prepare(
        `UPDATE user_turns SET last_received_at = ?, updated_at = ? WHERE id = ?`,
      ).run(part.receivedAt, part.receivedAt, turnId)
      return {
        inboundId: part.inboundId,
        turnId,
        duplicate: false,
        partCount: this.#partCount(turnId),
        committed,
      }
    })
  }

  #createTurn(part: InboundPart): string {
    const turnId = `turn:${part.inboundId}`
    this.#db.prepare(
      `INSERT INTO user_turns
         (id, channel, user_id, context_id, is_owner, state, first_received_at,
          last_received_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?)`,
    ).run(
      turnId, part.channel, part.userId, part.contextId, part.isOwner ? 1 : 0,
      part.receivedAt, part.receivedAt, part.receivedAt, part.receivedAt,
    )
    return turnId
  }

  #partCount(turnId: string): number {
    const row = this.#db.prepare(
      'SELECT COUNT(*) AS n FROM inbound_parts WHERE turn_id = ?',
    ).get(turnId) as { n: number }
    return Number(row.n)
  }

  #commit(row: TurnRow, idleMs: number, hardMs: number): UserTurn {
    const due = dueOf(row, idleMs, hardMs)
    const at = formatPyIso(due.at)
    const next = this.#db.prepare(
      'SELECT COALESCE(MAX(queue_seq), 0) + 1 AS n FROM user_turns',
    ).get() as { n: number }
    const changed = this.#db.prepare(
      `UPDATE user_turns
          SET state = 'queued', committed_at = ?, commit_reason = ?, queue_seq = ?, updated_at = ?
        WHERE id = ? AND state = 'collecting'`,
    ).run(at, due.reason, next.n, at, row.id)
    if (Number(changed.changes) !== 1) {
      throw new Error(`lykoi-ingress: collecting turn ${row.id} lost its state transition`)
    }
    return this.#loadTurn(row.id)
  }

  commitDue(now: Date, idleMs: number, hardMs: number): UserTurn[] {
    return this.#tx(() => {
      const rows = this.#db.prepare(
        `SELECT id, channel, user_id, context_id, is_owner, state, first_received_at,
                last_received_at, committed_at, commit_reason, queue_seq, run_id, terminal_payload_json
           FROM user_turns WHERE state = 'collecting'
          ORDER BY first_received_at ASC, rowid ASC`,
      ).all() as unknown as TurnRow[]
      const nowMs = now.getTime()
      return rows
        .filter((row) => nowMs >= dueOf(row, idleMs, hardMs).at.getTime())
        .map((row) => this.#commit(row, idleMs, hardMs))
    })
  }

  nextDeadline(idleMs: number, hardMs: number): Date | null {
    const rows = this.#db.prepare(
      `SELECT first_received_at, last_received_at FROM user_turns WHERE state = 'collecting'`,
    ).all() as Pick<TurnRow, 'first_received_at' | 'last_received_at'>[]
    let earliest = Number.POSITIVE_INFINITY
    for (const row of rows) earliest = Math.min(earliest, dueOf(row, idleMs, hardMs).at.getTime())
    return Number.isFinite(earliest) ? new Date(earliest) : null
  }

  claimNext(now: Date): { turn: UserTurn; runId: string } | null {
    return this.#tx(() => {
      const row = this.#db.prepare(
        `SELECT id FROM user_turns WHERE state = 'queued'
          ORDER BY queue_seq ASC LIMIT 1`,
      ).get() as { id: string } | undefined
      if (row === undefined) return null
      const runId = `run:${row.id}:r0`
      const info = this.#db.prepare(
        `UPDATE user_turns SET state = 'running', run_id = ?, updated_at = ?
          WHERE id = ? AND state = 'queued'`,
      ).run(runId, formatPyIso(now), row.id)
      if (Number(info.changes) !== 1) return null
      return { turn: this.#loadTurn(row.id), runId }
    })
  }

  finish(turnId: string, terminal: TurnTerminalPayload, now: Date): boolean {
    return this.#tx(() => {
      const info = this.#db.prepare(
        `UPDATE user_turns
            SET state = 'terminal', terminal_status = ?, terminal_reason = ?, terminal_at = ?,
                terminal_payload_json = ?, terminal_audited = 0, updated_at = ?
          WHERE id = ? AND state = 'running'`,
      ).run(
        terminal.status, terminal.reason, formatPyIso(now), JSON.stringify(terminal),
        formatPyIso(now), turnId,
      )
      return Number(info.changes) === 1
    })
  }

  recoverRunning(now: Date): UserTurn[] {
    return this.#tx(() => {
      const rows = this.#db.prepare(
        `SELECT id FROM user_turns WHERE state = 'running' ORDER BY first_received_at, rowid`,
      ).all() as { id: string }[]
      const terminal: TurnTerminalPayload = {
        status: 'failed', reason: 'interrupted', followup_registered: false,
        ask_sent: false, notice_sent: false, reply_chars: 0, elapsed_ms: 0,
        continuation_id: null,
      }
      const moment = formatPyIso(now)
      for (const row of rows) {
        this.#db.prepare(
          `UPDATE user_turns
              SET state = 'terminal', terminal_status = 'failed', terminal_reason = 'interrupted',
                  terminal_at = ?, terminal_payload_json = ?, terminal_audited = 0, updated_at = ?
            WHERE id = ? AND state = 'running'`,
        ).run(moment, JSON.stringify(terminal), moment, row.id)
      }
      return rows.map((row) => this.#loadTurn(row.id))
    })
  }

  unauditedTerminals(): { turn: UserTurn; runId: string | null; terminal: TurnTerminalPayload }[] {
    const rows = this.#db.prepare(
      `SELECT id, run_id, terminal_payload_json FROM user_turns
        WHERE state = 'terminal' AND terminal_audited = 0 AND terminal_payload_json IS NOT NULL
        ORDER BY terminal_at ASC, rowid ASC`,
    ).all() as { id: string; run_id: string | null; terminal_payload_json: string }[]
    return rows.map((row) => ({
      turn: this.#loadTurn(row.id),
      runId: row.run_id,
      terminal: JSON.parse(row.terminal_payload_json) as TurnTerminalPayload,
    }))
  }

  markTerminalAudited(turnId: string): void {
    this.#tx(() => {
      this.#db.prepare(
        `UPDATE user_turns SET terminal_audited = 1 WHERE id = ? AND state = 'terminal'`,
      ).run(turnId)
    })
  }

  getTurn(turnId: string): UserTurn | null {
    const exists = this.#db.prepare('SELECT 1 AS ok FROM user_turns WHERE id = ?').get(turnId)
    return exists === undefined ? null : this.#loadTurn(turnId)
  }

  #loadTurn(turnId: string): UserTurn {
    const row = this.#db.prepare(
      `SELECT id, channel, user_id, context_id, is_owner, state, first_received_at,
              last_received_at, committed_at, commit_reason, queue_seq, run_id, terminal_payload_json
         FROM user_turns WHERE id = ?`,
    ).get(turnId) as TurnRow | undefined
    if (row === undefined) throw new Error(`lykoi-ingress: turn ${turnId} not found`)
    if (row.committed_at === null || row.commit_reason === null) {
      throw new Error(`lykoi-ingress: turn ${turnId} is not committed`)
    }
    const parts = this.#db.prepare(
      `SELECT inbound_id, channel, platform_message_id, platform_update_id, user_id, context_id,
              is_owner, text, received_at, source_timestamp, reply_to_platform_message_id,
              turn_id, part_order
         FROM inbound_parts WHERE turn_id = ? ORDER BY part_order ASC`,
    ).all(turnId) as unknown as PartRow[]
    return {
      turnId: row.id,
      channel: row.channel,
      userId: row.user_id,
      contextId: row.context_id,
      isOwner: row.is_owner === 1,
      parts: parts.map((part) => ({
        inboundId: part.inbound_id,
        channel: part.channel,
        platformMessageId: part.platform_message_id,
        ...(part.platform_update_id === null ? {} : { platformUpdateId: part.platform_update_id }),
        userId: part.user_id,
        contextId: part.context_id,
        isOwner: part.is_owner === 1,
        text: part.text,
        receivedAt: part.received_at,
        ...(part.source_timestamp === null ? {} : { sourceTimestamp: part.source_timestamp }),
        ...(part.reply_to_platform_message_id === null
          ? {}
          : { replyToPlatformMessageId: part.reply_to_platform_message_id }),
      })),
      firstReceivedAt: row.first_received_at,
      lastReceivedAt: row.last_received_at,
      committedAt: row.committed_at,
      commitReason: row.commit_reason,
    }
  }

  close(): void {
    this.#db.close()
  }
}
