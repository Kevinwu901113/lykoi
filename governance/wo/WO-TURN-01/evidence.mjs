#!/usr/bin/env node

/**
 * WO-TURN-01 A2 local acceptance evidence.
 *
 * This is deliberately an ingress-layer probe. It feeds normalized
 * InboundPart values into the real DurableIngress and DurableTurnStore, so
 * no Telegram transport, cursor, network, or production state is involved.
 * Every timestamp comes from the fixed clock below; the temporary schema-19
 * database and synthetic persona are removed before the single JSON result is
 * written to stdout.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_HARD_WINDOW_MS,
  DEFAULT_IDLE_WINDOW_MS,
  DurableIngress,
  DurableTurnStore,
} from '../../../packages/lykoi-ingress/src/index.ts'
import { createStateFixture } from '../../../packages/lykoi-memory/src/testing.ts'
import {
  computeManifest,
  parseManifest,
  protectedEntries,
  renderManifest,
  sha256File,
} from '../../../packages/lykoi-gate/src/manifest.ts'

const BASE_MS = Date.parse('2026-09-05T00:00:00.000Z')
const IDLE_MS = DEFAULT_IDLE_WINDOW_MS
const HARD_MS = DEFAULT_HARD_WINDOW_MS

function isoAt(offsetMs) {
  return new Date(BASE_MS + offsetMs).toISOString()
}

function dateAt(offsetMs) {
  return new Date(BASE_MS + offsetMs)
}

function inbound(n, receivedMs, text, overrides = {}) {
  return {
    inboundId: `in:telegram:${n}`,
    channel: 'telegram',
    platformMessageId: String(100 + n),
    platformUpdateId: String(n),
    userId: 'user-1',
    contextId: 'chat-1',
    isOwner: true,
    text,
    receivedAt: isoAt(receivedMs),
    ...overrides,
  }
}

function terminal(status = 'replied', reason = null) {
  return {
    status,
    reason,
    followup_registered: false,
    ask_sent: false,
    notice_sent: false,
    reply_chars: status === 'replied' ? 2 : 0,
    elapsed_ms: 3,
    continuation_id: null,
  }
}

function auditSink() {
  const events = []
  const onceIds = new Set()
  return {
    events,
    async record(event) {
      events.push({ ...event })
    },
    async recordOnce(eventId, event) {
      if (onceIds.has(eventId)) return false
      onceIds.add(eventId)
      events.push({ ...event, event_id: eventId })
      return true
    },
  }
}

function service(dbPath, initialNowMs = 0, options = {}) {
  let nowMs = initialNowMs
  const audit = auditSink()
  const ingress = new DurableIngress({
    dbPath,
    audit,
    idleWindowMs: options.idleMs,
    hardWindowMs: options.hardMs,
    autoStart: false,
    now: () => dateAt(nowMs),
  })
  return {
    ingress,
    audit,
    setNow(offsetMs) {
      nowMs = offsetMs
    },
    nowMs() {
      return nowMs
    },
  }
}

function dbSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const schema = db.prepare('SELECT MAX(version) AS version FROM mind_schema').get()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user_turns', 'inbound_parts') ORDER BY name",
    ).all().map((row) => row.name)
    const turns = db.prepare(
      `SELECT id, state, first_received_at, last_received_at, committed_at,
              commit_reason, queue_seq, run_id, terminal_status, terminal_reason,
              terminal_audited
         FROM user_turns ORDER BY rowid`,
    ).all()
    const parts = db.prepare(
      `SELECT inbound_id, platform_message_id, platform_update_id, turn_id,
              part_order, received_at
         FROM inbound_parts ORDER BY turn_id, part_order`,
    ).all()
    const stateCounts = { collecting: 0, queued: 0, running: 0, terminal: 0 }
    for (const row of turns) {
      if (Object.hasOwn(stateCounts, row.state)) stateCounts[row.state] += 1
    }
    return {
      schemaVersion: Number(schema?.version ?? -1),
      tables,
      stateCounts,
      turns,
      parts,
    }
  } finally {
    db.close()
  }
}

function traceDb(dbPath) {
  const snapshot = dbSnapshot(dbPath)
  return {
    schemaVersion: snapshot.schemaVersion,
    stateCounts: snapshot.stateCounts,
    turns: snapshot.turns.map((row) => ({
      id: row.id,
      state: row.state,
      commitReason: row.commit_reason,
      queueSeq: row.queue_seq,
      runId: row.run_id,
      terminalStatus: row.terminal_status,
      terminalReason: row.terminal_reason,
      terminalAudited: row.terminal_audited,
    })),
    parts: snapshot.parts,
  }
}

function reopenTurn(dbPath, turnId) {
  const store = new DurableTurnStore(dbPath)
  try {
    const turn = store.getTurn(turnId)
    assert.ok(turn, `durably reopened turn ${turnId}`)
    return turn
  } finally {
    store.close()
  }
}

async function acceptTrace(handle, dbPath, part, trace) {
  const accepted = await handle.ingress.accept(part)
  trace.push({
    op: 'accept',
    atMs: Date.parse(part.receivedAt) - BASE_MS,
    inboundId: part.inboundId,
    result: accepted,
    db: traceDb(dbPath),
  })
  return accepted
}

async function tickTrace(handle, dbPath, atMs, trace, drain = true, executorCalls = () => null) {
  handle.setNow(atMs)
  await handle.ingress.tick(dateAt(atMs))
  if (drain) await handle.ingress.drain()
  trace.push({
    op: 'tick',
    atMs,
    executorCalls: executorCalls(),
    db: traceDb(dbPath),
  })
}

async function multipartIdleEvidence(makeDb) {
  const dbPath = makeDb('multipart-idle')
  const handle = service(dbPath)
  const executed = []
  const trace = []
  handle.ingress.registerExecutor(async (turn, context) => {
    executed.push({
      turnId: turn.turnId,
      runId: context.runId,
      parts: turn.parts.map((part) => ({
        inboundId: part.inboundId,
        platformMessageId: part.platformMessageId,
        text: part.text,
        receivedAt: part.receivedAt,
      })),
      commitReason: turn.commitReason,
    })
    return { terminal: terminal() }
  })
  try {
    await acceptTrace(handle, dbPath, inbound(1, 0, 'A'), trace)
    await acceptTrace(handle, dbPath, inbound(2, 500, 'B'), trace)
    await acceptTrace(handle, dbPath, inbound(3, 1_000, 'C'), trace)
    await tickTrace(handle, dbPath, 2_499, trace, true, () => executed.length)
    assert.equal(executed.length, 0, 'three-part turn remains collecting before idle deadline')
    await tickTrace(handle, dbPath, 2_500, trace, true, () => executed.length)
    assert.equal(executed.length, 1, 'three-part turn executes once at idle deadline')
  } finally {
    await handle.ingress.close()
  }

  const persisted = reopenTurn(dbPath, executed[0].turnId)
  const terminals = handle.audit.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(terminals.length, 1, 'merged turn has one terminal event')
  assert.deepEqual(persisted.parts.map((part) => part.text), ['A', 'B', 'C'])
  assert.deepEqual(persisted.parts.map((part) => part.platformMessageId), ['101', '102', '103'])
  assert.equal(persisted.commitReason, 'idle_timeout')
  assert.equal(terminals[0].message_id, '103', 'terminal reply anchor is last platform message')

  return {
    name: 'multipart_idle',
    layer: 'ingress',
    status: 'pass',
    assertions: {
      oneTurn: executed.length === 1,
      partsPreserveBoundaryAndOrder: true,
      idleCommitAtMs: 2_500,
      commitReason: persisted.commitReason,
      persistedByReopenedStore: true,
    },
    trace,
    execution: executed,
    terminalLinkage: {
      count: terminals.length,
      eventId: terminals[0].event_id,
      turnId: terminals[0].turn_id,
      inboundIds: terminals[0].inbound_ids,
      platformMessageIds: terminals[0].platform_message_ids,
      replyAnchorMessageId: terminals[0].reply_anchor_message_id,
    },
    auditTypes: handle.audit.events.map((event) => event.type),
  }
}

async function hardMaxEvidence(makeDb) {
  const dbPath = makeDb('hard-max')
  const handle = service(dbPath)
  const executed = []
  const trace = []
  handle.ingress.registerExecutor(async (turn) => {
    executed.push({
      turnId: turn.turnId,
      parts: turn.parts.map((part) => part.text),
      commitReason: turn.commitReason,
      committedAt: turn.committedAt,
    })
    return { terminal: terminal() }
  })

  try {
    await acceptTrace(handle, dbPath, inbound(11, 0, 'H1'), trace)
    await acceptTrace(handle, dbPath, inbound(12, 1_000, 'H2'), trace)
    await acceptTrace(handle, dbPath, inbound(13, 2_000, 'H3'), trace)
    await acceptTrace(handle, dbPath, inbound(14, 3_000, 'H4'), trace)
    await tickTrace(handle, dbPath, 3_999, trace, true, () => executed.length)
    assert.equal(executed.length, 0, 'hard-max turn does not commit before hard deadline')
    await tickTrace(handle, dbPath, 4_000, trace, true, () => executed.length)
    assert.equal(executed.length, 1, 'continuous input is cut at hard deadline')
  } finally {
    await handle.ingress.close()
  }

  assert.equal(executed[0].commitReason, 'hard_timeout')
  assert.equal(Date.parse(executed[0].committedAt), BASE_MS + 4_000)
  const persisted = reopenTurn(dbPath, executed[0].turnId)
  assert.deepEqual(persisted.parts.map((part) => part.text), ['H1', 'H2', 'H3', 'H4'])

  return {
    name: 'hard_max',
    layer: 'ingress',
    status: 'pass',
    assertions: {
      oneTurn: executed.length === 1,
      hardCommitAtMs: 4_000,
      commitReason: executed[0].commitReason,
      allFourBoundariesPreserved: true,
      persistedByReopenedStore: true,
    },
    trace,
    execution: executed,
  }
}

async function duplicateEvidence(makeDb) {
  const dbPath = makeDb('duplicate')
  const handle = service(dbPath)
  const executed = []
  const trace = []
  handle.ingress.registerExecutor(async (turn) => {
    executed.push(turn.turnId)
    return { terminal: terminal() }
  })

  try {
    const first = await acceptTrace(handle, dbPath, inbound(21, 0, 'original'), trace)
    const replay = await acceptTrace(
      handle,
      dbPath,
      inbound(99, 10, 'redelivery with different local payload', {
        inboundId: 'in:telegram:redelivery',
        platformMessageId: '121',
        platformUpdateId: '21',
      }),
      trace,
    )
    trace.push({ op: 'duplicate_check', first, replay })
    assert.equal(first.duplicate, false)
    assert.equal(replay.duplicate, true)
    assert.equal(replay.inboundId, first.inboundId)
    assert.equal(replay.turnId, first.turnId)

    await tickTrace(handle, dbPath, 1_500, trace, true, () => executed.length)
    assert.equal(executed.length, 1)
  } finally {
    await handle.ingress.close()
  }

  const snapshot = dbSnapshot(dbPath)
  const terminalEvents = handle.audit.events.filter((event) => event.type === 'turn/terminal')
  const acceptedEvents = handle.audit.events.filter((event) => event.type === 'inbound/accepted')
  assert.equal(snapshot.parts.length, 1, 'redelivery does not add a second part')
  assert.equal(snapshot.turns.length, 1, 'redelivery does not add a second turn')
  assert.equal(terminalEvents.length, 1, 'redelivery does not add a second terminal')
  assert.equal(acceptedEvents.filter((event) => event.duplicate === true).length, 1)

  return {
    name: 'duplicate_idempotence',
    layer: 'ingress',
    status: 'pass',
    assertions: {
      samePlatformIdentityMapsToOriginalInbound: true,
      partCount: snapshot.parts.length,
      turnCount: snapshot.turns.length,
      terminalCount: terminalEvents.length,
      duplicateAuditCount: acceptedEvents.filter((event) => event.duplicate === true).length,
    },
    trace,
    audit: acceptedEvents.map((event) => ({
      type: event.type,
      inboundId: event.inbound_id,
      turnId: event.turn_id,
      platformMessageId: event.platform_message_id,
      duplicate: event.duplicate,
    })),
  }
}

async function blockedFifoEvidence(makeDb) {
  const dbPath = makeDb('blocked-fifo')
  const handle = service(dbPath)
  const order = []
  const executionTrace = []
  let active = 0
  let maxConcurrency = 0
  let releaseA = () => {}
  let resolveAStarted
  const aStarted = new Promise((resolve) => { resolveAStarted = resolve })
  const blockedA = new Promise((resolve) => { releaseA = resolve })

  handle.ingress.registerExecutor(async (turn, context) => {
    active += 1
    maxConcurrency = Math.max(maxConcurrency, active)
    const text = turn.parts[0].text
    order.push(text)
    executionTrace.push({ event: 'start', text, atMs: handle.nowMs(), runId: context.runId, active })
    if (text === 'A') {
      resolveAStarted()
      await blockedA
    }
    executionTrace.push({ event: 'finish', text, atMs: handle.nowMs(), active })
    active -= 1
    return { terminal: terminal() }
  })

  const trace = []
  let beforeRelease
  try {
    await acceptTrace(handle, dbPath, inbound(31, 0, 'A'), trace)
    await tickTrace(handle, dbPath, 1_500, trace, false, () => order.length)
    await aStarted

    const bAccepted = await acceptTrace(handle, dbPath, inbound(32, 2_000, 'B'), trace)
    await tickTrace(handle, dbPath, 3_500, trace, false, () => order.length)
    const cAccepted = await acceptTrace(handle, dbPath, inbound(33, 4_000, 'C'), trace)
    await tickTrace(handle, dbPath, 5_500, trace, false, () => order.length)
    beforeRelease = traceDb(dbPath)
    trace.push({
      op: 'blocked_snapshot',
      atMs: 5_500,
      accepted: { b: bAccepted, c: cAccepted },
      db: beforeRelease,
    })
    assert.equal(beforeRelease.parts.length, 3, 'B/C are durably accepted while A is blocked')
    assert.equal(beforeRelease.stateCounts.running, 1, 'A remains the only running turn')
    assert.equal(beforeRelease.stateCounts.queued, 2, 'B/C are queued behind A')

    releaseA()
    await handle.ingress.drain()
    assert.deepEqual(order, ['A', 'B', 'C'])
    assert.equal(maxConcurrency, 1, 'FIFO executor never runs two turns concurrently')
  } finally {
    releaseA()
    await handle.ingress.close()
  }

  const afterRelease = dbSnapshot(dbPath)
  assert.equal(afterRelease.stateCounts.terminal, 3)
  assert.equal(active, 0)

  return {
    name: 'blocked_a_fifo',
    layer: 'ingress',
    status: 'pass',
    assertions: {
      durablePartsWhileABlocked: beforeRelease.parts.length,
      queuedTurnsWhileABlocked: beforeRelease.stateCounts.queued,
      fifoOrder: order,
      maxConcurrency,
      terminalTurnsAfterRelease: afterRelease.stateCounts.terminal,
    },
    trace,
    execution: executionTrace,
    transportEvidence: {
      included: false,
      reason: 'normalized InboundPart feed only; Telegram poll/cursor is a separate adapter-layer proof',
    },
  }
}

async function restartEvidence(makeDb) {
  const dbPath = makeDb('restart-lifecycle')
  const part = inbound(41, 0, 'restart-me')
  const phases = []

  const first = service(dbPath, 0)
  try {
    await first.ingress.accept(part)
    phases.push({ phase: 'collecting_before_restart', atMs: 0, db: traceDb(dbPath) })
  } finally {
    await first.ingress.close()
  }

  const second = service(dbPath, 1_000)
  try {
    await second.ingress.start()
    phases.push({ phase: 'collecting_after_restart_before_deadline', atMs: 1_000, db: traceDb(dbPath) })
  } finally {
    await second.ingress.close()
  }

  const third = service(dbPath, 1_500)
  try {
    await third.ingress.start()
    phases.push({ phase: 'queued_after_restart_due_tick', atMs: 1_500, db: traceDb(dbPath) })
  } finally {
    await third.ingress.close()
  }

  const fourth = service(dbPath, 2_000)
  const executed = []
  try {
    await fourth.ingress.start()
    phases.push({ phase: 'queued_after_restart_start', atMs: 2_000, db: traceDb(dbPath) })
    fourth.ingress.registerExecutor(async (turn, context) => {
      executed.push({ turnId: turn.turnId, runId: context.runId, parts: turn.parts.map((item) => item.text) })
      return { terminal: terminal() }
    })
    await fourth.ingress.drain()
    phases.push({ phase: 'terminal_after_restart_execution', atMs: 2_000, db: traceDb(dbPath) })
  } finally {
    await fourth.ingress.close()
  }

  const fifth = service(dbPath, 3_000)
  const rerun = []
  try {
    fifth.ingress.registerExecutor(async (turn) => {
      rerun.push(turn.turnId)
      return { terminal: terminal() }
    })
    await fifth.ingress.start()
    await fifth.ingress.drain()
  } finally {
    await fifth.ingress.close()
  }

  const finalSnapshot = dbSnapshot(dbPath)
  const reopened = reopenTurn(dbPath, executed[0].turnId)
  const terminalEvents = fourth.audit.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(phases[0].db.stateCounts.collecting, 1)
  assert.equal(phases[1].db.stateCounts.collecting, 1)
  assert.equal(phases[2].db.stateCounts.queued, 1)
  assert.equal(phases[3].db.stateCounts.queued, 1)
  assert.equal(phases[4].db.stateCounts.terminal, 1)
  assert.equal(executed.length, 1, 'queued turn executes once after restart')
  assert.equal(rerun.length, 0, 'terminal turn does not execute again after another restart')
  assert.equal(terminalEvents.length, 1)
  assert.equal(reopened.parts[0].text, 'restart-me')

  return {
    name: 'restart_collecting_queued_terminal',
    layer: 'ingress',
    status: 'pass',
    assertions: {
      collectingSurvivesRestart: true,
      queuedSurvivesRestart: true,
      terminalSurvivesRestart: true,
      executionCount: executed.length,
      rerunCountAfterTerminalRestart: rerun.length,
      finalStateCounts: finalSnapshot.stateCounts,
    },
    phases,
    execution: executed,
    terminalAudit: terminalEvents.map((event) => ({
      eventId: event.event_id,
      turnId: event.turn_id,
      runId: event.run_id,
      inboundIds: event.inbound_ids,
      platformMessageIds: event.platform_message_ids,
      status: event.status,
      reason: event.reason,
    })),
  }
}

function manifestEvidence(repoRoot, sessionDir) {
  const personaPath = join(sessionDir, 'synthetic-persona', 'lykoi.toml')
  mkdirSync(join(sessionDir, 'synthetic-persona'), { recursive: true })
  writeFileSync(personaPath, 'name = "synthetic-lykoi-evidence"\n', 'utf8')

  const entries = protectedEntries(repoRoot, { personaToml: personaPath })
  const lines = computeManifest(entries, sha256File)
  const rendered = renderManifest(lines)
  const parsed = parseManifest(rendered)
  assert.equal(parsed.size, lines.length, 'manifest render/parse preserves entry count')
  for (const line of lines) assert.equal(parsed.get(line.name), line.digest, line.name)

  const expectedIngress = [
    'packages/lykoi-ingress/package.json',
    'packages/lykoi-ingress/src/index.ts',
    'packages/lykoi-ingress/src/store.ts',
    'packages/lykoi-ingress/src/types.ts',
  ]
  const ingressEntries = expectedIngress.map((name) => {
    const entry = entries.find((candidate) => candidate.name === name)
    assert.ok(entry, `manifest protectedEntries covers ${name}`)
    return { name, digest: parsed.get(name), domain: entry.domain }
  })
  assert.equal(ingressEntries.length, 4)
  assert.equal(new Set(ingressEntries.map((entry) => entry.name)).size, 4)

  return {
    name: 'manifest_preflight',
    layer: 'governance-manifest',
    status: 'pass',
    syntheticPersona: true,
    productionSignature: false,
    writesProductionManifest: false,
    entries: lines.length,
    roundTripEntries: parsed.size,
    ingressEntries,
    note: 'ephemeral computeManifest/render/parse only; no packages/lykoi-gate/manifest.sha256 write',
  }
}

async function main() {
  const sessionDir = mkdtempSync(join(tmpdir(), 'lykoi-turn-evidence-'))
  const repoRoot = join(import.meta.dirname, '..', '..', '..')
  const output = {
    schema: 1,
    workOrder: 'WO-TURN-01',
    stage: 'A2',
    status: 'failed',
    clock: {
      base: '2026-09-05T00:00:00.000Z',
      source: 'fixed BASE_MS plus injected DurableIngress.now and explicit tick dates',
      idleWindowMs: IDLE_MS,
      hardWindowMs: HARD_MS,
      wallClockReads: 0,
    },
    database: {
      fixture: 'lykoi-memory/testing.createStateFixture',
      expectedSchemaVersion: 19,
      temporary: true,
    },
    scope: {
      real: [
        'DurableIngress',
        'DurableTurnStore',
        'lykoi-memory schema-19 fixture',
        'lykoi-gate protectedEntries/manifest pure functions',
      ],
      fake: ['in-memory AuditService sink', 'FIFO TurnExecutor'],
      transport: 'excluded; no Telegram transport/cursor is fabricated',
      network: 'zero external calls',
    },
    scenarios: [],
  }

  const createdDbDirs = []
  const makeDb = (name) => {
    const dir = join(sessionDir, name)
    mkdirSync(dir, { recursive: true })
    createdDbDirs.push(dir)
    const dbPath = join(dir, 'state.db')
    createStateFixture(dbPath)
    const snapshot = dbSnapshot(dbPath)
    assert.equal(snapshot.schemaVersion, 19, `${name} uses schema-19 fixture`)
    assert.deepEqual(snapshot.tables, ['inbound_parts', 'user_turns'])
    return dbPath
  }

  try {
    output.scenarios.push(await multipartIdleEvidence(makeDb))
    output.scenarios.push(await hardMaxEvidence(makeDb))
    output.scenarios.push(await duplicateEvidence(makeDb))
    output.scenarios.push(await blockedFifoEvidence(makeDb))
    output.scenarios.push(await restartEvidence(makeDb))
    output.scenarios.push(manifestEvidence(repoRoot, sessionDir))
    output.status = 'pass'
  } catch (error) {
    output.error = {
      name: error?.name ?? 'Error',
      message: error?.message ?? String(error),
    }
  } finally {
    const existedBeforeCleanup = existsSync(sessionDir)
    rmSync(sessionDir, { recursive: true, force: true })
    output.cleanup = {
      temporaryDirectoryRemoved: !existsSync(sessionDir),
      temporaryDirectoriesCreated: createdDbDirs.length,
      existedBeforeCleanup,
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    if (output.status !== 'pass') process.exitCode = 1
  }
}

await main()
