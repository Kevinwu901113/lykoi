import { taskFacts } from 'lykoi-runtime/task-facts'
import type { TaskMessage, TaskRequest } from 'lykoi-contracts'
import { parseStateTimestamp } from 'lykoi-memory'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const statuses = ['pending', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled'] as const
export type TaskStatus = typeof statuses[number]
export interface TaskWait { kind: 'due' | 'operation' | 'external' | 'approval' | 'verification'; detail: string; until?: string; operationId?: string }
export interface Artifact { path: string; sha256: string; bytes: number }
export interface Task {
  request?: TaskRequest
  scheduledMessage?: { text: string; dueAt: string }
  result?: string; finding?: string
  origin?: 'user' | 'autonomous'; thoughtId?: string; reason?: string
  id: string; instanceId: string; originTurnId: string | null; goal: string; requirements: string; criteria: string
  revision: number; status: TaskStatus; checkpoint: string; workspace: string; createdAt: string; updatedAt: string
  wait: TaskWait | null; failure: string | null; artifacts: Artifact[]
  delivery: { state: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown'; content: string; attempts: number; error: string | null; receipt?: unknown } | null
  experienceId: number | null
}
export interface TaskRun { id: string; taskId: string; revision: number; startedAt: string; finishedAt: string | null; status: 'running' | 'finished' | 'interrupted' | 'failed'; error: string | null }
export interface Operation {
  id: string; taskId: string; runId: string; revision: number; name: string; args: Record<string, unknown>
  status: 'inflight' | 'completed' | 'unknown' | 'approval'; approved?: boolean; approvalRevision?: number; observation: unknown; createdAt: string
}
const terminal = new Set<TaskStatus>(['completed', 'failed', 'cancelled'])

function scheduledMessage(message: TaskMessage | undefined, receivedAt: string, previous?: Task['scheduledMessage']) {
  if (message === undefined) return undefined
  if (typeof message.text !== 'string' || !message.text.trim()) throw new TypeError('message needs nonempty text')
  if (message.delaySeconds === undefined && previous) return { text: message.text, dueAt: previous.dueAt }
  if (typeof message.delaySeconds !== 'number' || !Number.isFinite(message.delaySeconds) || message.delaySeconds < 0) throw new TypeError('message needs nonempty text and a nonnegative delaySeconds')
  return { text: message.text, dueAt: new Date(Date.parse(receivedAt) + message.delaySeconds * 1000).toISOString() }
}

/** Instance-owned Task database, independent of memory storage. Every mutation is a short synchronous transaction. */
export class TaskStore {
  readonly db: DatabaseSync
  readonly dbPath: string
  readonly instanceId: string
  readonly root: string
  constructor(dbPath: string, instanceId: string, root: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.dbPath = resolve(dbPath)
    this.db = new DatabaseSync(dbPath)
    this.instanceId = instanceId; this.root = root
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS persistent_tasks (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, legacy_id TEXT UNIQUE, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_outbox(id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_operations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL, document TEXT NOT NULL);`)
    const foreign = this.db.prepare('SELECT id FROM persistent_tasks WHERE instance_id <> ? LIMIT 1').get(instanceId)
    if (foreign) { this.db.close(); throw new Error('task DB belongs to another character instance') }
  }
  close() { this.db.close() }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  #readTask(row: Record<string, unknown>): Task {
    const task = JSON.parse(String(row.document)) as Task
    if (!task || task.id !== row.id || task.instanceId !== this.instanceId || !statuses.includes(task.status)
      || !Number.isSafeInteger(task.revision) || task.revision < 1 || typeof task.goal !== 'string'
      || typeof task.requirements !== 'string' || typeof task.criteria !== 'string' || typeof task.checkpoint !== 'string'
      || task.workspace !== join(this.root, task.id, 'workspace') || !Array.isArray(task.artifacts)) throw new Error(`invalid persisted task: ${String(row.id)}`)
    if (task.wait && (typeof task.wait.detail !== 'string' || !['due', 'operation', 'external', 'approval', 'verification'].includes(task.wait.kind)
      || (task.wait.kind === 'due' && (!task.wait.until || !Number.isFinite(Date.parse(task.wait.until)))))) throw new Error(`invalid persisted task wait: ${task.id}`)
    if (task.scheduledMessage && (typeof task.scheduledMessage.text !== 'string' || !task.scheduledMessage.text.trim() || !Number.isFinite(Date.parse(task.scheduledMessage.dueAt)))) throw new Error(`invalid scheduled message: ${task.id}`)
    if (task.delivery && (typeof task.delivery.content !== 'string' || !['pending', 'sending', 'sent', 'failed', 'unknown'].includes(task.delivery.state))) throw new Error(`invalid persisted task delivery: ${task.id}`)
    return task
  }
  #readOperation(row: Record<string, unknown>): Operation {
    const operation = JSON.parse(String(row.document)) as Operation
    if (!operation || operation.id !== row.id || operation.taskId !== row.task_id || !['inflight', 'completed', 'unknown', 'approval'].includes(operation.status)
      || !Number.isSafeInteger(operation.revision) || !operation.args || typeof operation.args !== 'object' || Array.isArray(operation.args)
      || (operation.approved !== undefined && typeof operation.approved !== 'boolean')) throw new Error(`invalid persisted operation: ${String(row.id)}`)
    return operation
  }
  get(id: string): Task {
    const row = this.db.prepare('SELECT id, document FROM persistent_tasks WHERE id=? AND instance_id=?').get(id, this.instanceId)
    if (!row) throw new Error(`unknown task: ${id}`)
    return this.#readTask(row)
  }
  list(): Task[] {
    return this.db.prepare('SELECT id, document FROM persistent_tasks WHERE instance_id=? ORDER BY rowid').all(this.instanceId).map(row => this.#readTask(row))
  }
  edit(id: string, change: (task: Task) => void, now = new Date()): Task {
    return this.transaction(() => {
      const task = this.get(id); const before = JSON.stringify([task.status, task.wait?.kind, task.failure]); const priorFinding = task.finding; const priorDelivery = task.delivery?.state; change(task); task.updatedAt = now.toISOString()
      this.#readTask({ id, document: JSON.stringify(task) })
      this.db.prepare('UPDATE persistent_tasks SET document=? WHERE id=? AND instance_id=?').run(JSON.stringify(task), id, this.instanceId)
      const findingChanged = task.finding !== undefined && task.finding !== priorFinding
      const statusEvent = before !== JSON.stringify([task.status, task.wait?.kind, task.failure])
        && (terminal.has(task.status) || (task.status === 'waiting' && task.wait?.kind !== 'due'))
      const deliveryEvent = task.delivery?.state !== priorDelivery && ['sent', 'failed', 'unknown'].includes(task.delivery?.state ?? '')
      if (findingChanged || statusEvent || deliveryEvent) {
        const event = { id: randomUUID(), source: 'task', reference: task.id, createdAt: now.toISOString(),
          content: JSON.stringify(taskFacts(task, 'event')) }
        this.db.prepare('INSERT INTO task_outbox VALUES(?,?)').run(event.id, JSON.stringify(event))
      }
      return task
    })
  }
  relay(receive: (event: import('lykoi-contracts').MindEvent) => void) {
    for (const row of this.db.prepare('SELECT id, document FROM task_outbox ORDER BY rowid').all()) {
      receive(JSON.parse(String(row.document)))
      this.db.prepare('DELETE FROM task_outbox WHERE id=?').run(row.id)
    }
  }
  create(input: { goal: string; message?: TaskMessage; request?: TaskRequest; requirements?: string; criteria?: string; originTurnId?: string; taskId?: string; origin?: 'user' | 'autonomous'; thoughtId?: string; reason?: string }, now = new Date()): Task {
    if (!input.goal.trim()) throw new TypeError('task goal is required')
    if (input.message && input.origin === 'autonomous') throw new Error('scheduled delivery requires a user request')
    const message = scheduledMessage(input.message, input.request?.receivedAt ?? now.toISOString(), input.taskId ? this.get(input.taskId).scheduledMessage : undefined)
    if (input.taskId) return this.update(input.taskId, input.requirements ?? input.goal, input.criteria, now, message)
    const existing = input.originTurnId ? this.list().find(t => t.originTurnId === input.originTurnId) : undefined
    if (existing) return existing
    const id = `task-${randomUUID()}`, workspace = join(this.root, id, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const task: Task = { request: input.request, scheduledMessage: message, id, instanceId: this.instanceId, origin: input.origin ?? 'user', thoughtId: input.thoughtId, reason: input.reason, originTurnId: input.originTurnId ?? null, goal: input.goal,
      requirements: input.requirements ?? input.goal, criteria: input.criteria ?? '完成目标并提供可核验成果', revision: 1,
      status: message ? 'waiting' : 'pending', checkpoint: '', workspace, wait: message ? { kind: 'due', until: message.dueAt, detail: '等待已登记消息的发送时间' } : null, failure: null, artifacts: [], delivery: null,
      experienceId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    this.db.prepare('INSERT INTO persistent_tasks(id,instance_id,document) VALUES(?,?,?)').run(id, this.instanceId, JSON.stringify(task))
    return task
  }
  update(id: string, requirements: string, criteria?: string, now = new Date(), message?: Task['scheduledMessage']): Task {
    return this.edit(id, task => {
      if (task.status === 'completed' || task.status === 'cancelled') throw new Error('terminal task cannot be revised; create a new task explicitly')
      if (task.status === 'failed') { task.status = 'pending'; task.delivery = null }
      if (message && task.origin === 'autonomous') throw new Error('scheduled delivery requires a user task')
      // A new goal without a frozen message returns to ordinary cognition; never send stale text.
      task.scheduledMessage = message
      task.requirements = requirements; if (criteria !== undefined) task.criteria = criteria
      for (const op of this.operations(id)) if (op.status === 'approval') this.saveOperation({ ...op, status: 'completed', approved: false, observation: { success: false, error: 'requirements changed before execution' } })
      task.revision++; task.failure = null
      if (task.status === 'waiting' && task.wait?.kind !== 'verification' && task.wait?.kind !== 'operation') { task.status = 'pending'; task.wait = null }
    }, now)
  }
  control(id: string, command: 'pause' | 'resume' | 'cancel', now = new Date()): Task {
    return this.edit(id, task => {
      if (command === 'cancel' && task.delivery?.state === 'pending') {
        task.status = 'cancelled'; task.delivery = null; task.wait = null
        return
      }
      if (terminal.has(task.status)) throw new Error('task is already terminal')
      if (command === 'pause') task.status = 'paused'
      else if (command === 'cancel') {
        task.status = 'cancelled'
        for (const op of this.operations(id)) if (op.status === 'approval') this.saveOperation({ ...op, status: 'completed', approved: false, observation: { success: false, error: 'task cancelled before execution' } })
        if (task.wait?.kind === 'due' || task.wait?.kind === 'approval' || task.wait?.kind === 'external') task.wait = null
      }
      else {
        if (task.status !== 'paused' && task.status !== 'waiting') throw new Error('task is not paused or waiting')
        task.status = task.wait?.kind === 'verification' || task.wait?.kind === 'operation' || (task.wait?.kind === 'approval' && task.wait.operationId && this.operation(task.wait.operationId)?.status === 'approval' && !this.operation(task.wait.operationId)?.approved) ? 'waiting' : 'pending'
        if (task.status === 'pending') task.wait = null
      }
    }, now)
  }
  claim(id: string, now = new Date()): TaskRun | null {
    return this.transaction(() => {
      const task = this.get(id)
      if (task.status !== 'pending') return null
      const run: TaskRun = { id: `run-${randomUUID()}`, taskId: id, revision: task.revision, startedAt: now.toISOString(), finishedAt: null, status: 'running', error: null }
      task.status = 'running'; task.updatedAt = now.toISOString()
      this.db.prepare('UPDATE persistent_tasks SET document=? WHERE id=?').run(JSON.stringify(task), id)
      this.db.prepare('INSERT INTO task_runs VALUES(?,?,?)').run(run.id, id, JSON.stringify(run))
      return run
    })
  }
  runs(id: string): TaskRun[] { return this.db.prepare('SELECT document FROM task_runs WHERE task_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.document))) }
  finishRun(run: TaskRun, status: TaskRun['status'], error: string | null = null, now = new Date()) {
    this.db.prepare('UPDATE task_runs SET document=? WHERE id=?').run(JSON.stringify({ ...run, status, error, finishedAt: now.toISOString() }), run.id)
  }
  intent(taskId: string, runId: string, name: string, args: Record<string, unknown>, now = new Date()): Operation {
    const operation: Operation = { id: `op-${randomUUID()}`, taskId, runId, revision: this.get(taskId).revision, name, args, status: 'inflight', observation: null, createdAt: now.toISOString() }
    this.db.prepare('INSERT INTO task_operations VALUES(?,?,?,?)').run(operation.id, taskId, runId, JSON.stringify(operation))
    return operation
  }
  operations(taskId: string): Operation[] { return this.db.prepare('SELECT id, task_id, document FROM task_operations WHERE task_id=? ORDER BY rowid').all(taskId).map(r => this.#readOperation(r)) }
  operation(id: string): Operation | null {
    const row = this.db.prepare('SELECT id, task_id, document FROM task_operations WHERE id=?').get(id)
    return row ? this.#readOperation(row) : null
  }
  saveOperation(operation: Operation) { this.db.prepare('UPDATE task_operations SET document=? WHERE id=?').run(JSON.stringify(operation), operation.id) }

  /** An incomplete intent may already have performed a side effect. Never infer failure from a lost process. */
  recover(now = new Date()) {
    for (const task of this.list()) {
      for (const run of this.runs(task.id)) if (run.status === 'running') this.finishRun(run, 'interrupted', null, now)
      const uncertain = this.operations(task.id).filter(op => op.status === 'inflight' || op.status === 'unknown')
      for (const op of uncertain) { op.status = 'unknown'; this.saveOperation(op) }
      this.edit(task.id, current => {
        if (current.delivery?.state === 'sending') { current.delivery.state = 'unknown'; current.delivery.error = 'delivery outcome requires verification' }
        if (current.status === 'running') {
          current.status = uncertain.length ? 'waiting' : 'pending'
          current.wait = uncertain.length ? { kind: 'verification', operationId: uncertain[0]!.id, detail: '操作可能已经发生，需核对结果' } : null
        }
      }, now)
    }
  }

  /** Move pre-separation Task tables once; only this database executes tasks afterwards. */
  migrateFromMemory(memoryPath: string): void {
    if (resolve(memoryPath) === this.dbPath) throw new Error('TaskStore must be separate from memory DB')
    if (!statSync(memoryPath).isFile()) throw new Error('instance memory DB is missing')
    this.db.prepare('ATTACH DATABASE ? AS legacy').run(memoryPath)
    try {
      this.transaction(() => {
        for (const table of ['persistent_tasks', 'task_runs', 'task_operations']) {
          if (!this.db.prepare('SELECT name FROM legacy.sqlite_master WHERE name=?').get(table)) continue
          this.db.exec(`INSERT INTO main.${table} SELECT * FROM legacy.${table}`)
          if (table === 'persistent_tasks') for (const row of this.db.prepare('SELECT id, document FROM persistent_tasks').all()) this.#readTask(row)
          this.db.exec(`DROP TABLE legacy.${table}`)
        }
      })
    } finally { this.db.exec('DETACH DATABASE legacy') }
    const source = new DatabaseSync(memoryPath, { readOnly: true })
    try { this.migrateContinuations(source) } finally { source.close() }
  }

  /** A per-legacy-row marker and its task are committed together; source rows remain historical evidence. */
  migrateContinuations(source: DatabaseSync, now = new Date()): number {
    if (!source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_continuations'").get()) return 0
    let count = 0
    for (const row of source.prepare("SELECT * FROM pending_continuations WHERE state IN ('pending','running') OR (state='failed' AND terminal_reason IN ('delivery_failed','interrupted','chained_request','approval_pending'))").all()) {
      if (this.db.prepare('SELECT id FROM persistent_tasks WHERE legacy_id=?').get(row.id)) continue
      this.transaction(() => {
        const id = `legacy-${createHash('sha256').update(String(row.id)).digest('hex').slice(0, 24)}`, workspace = join(this.root, id, 'workspace')
        mkdirSync(workspace, { recursive: true })
        const uncertain = row.state !== 'pending'
        const task: Task = { id, instanceId: this.instanceId, originTurnId: String(row.origin_turn_id), goal: String(row.goal), requirements: String(row.goal), criteria: '完成原先承诺并交付可核验结果',
          revision: 1, status: 'waiting', checkpoint: uncertain ? `旧跟进 ${row.state}/${row.terminal_reason ?? 'unknown'}；需核实原执行与交付结果` : '', workspace,
          wait: uncertain ? { kind: 'verification', detail: '旧执行缺少操作记录，先核实执行及交付结果再继续' } : { kind: 'due', detail: '原承诺到期推进', until: parseStateTimestamp(String(row.due_at)).toISOString() },
          failure: null, artifacts: [], delivery: null, experienceId: null, createdAt: String(row.created_at), updatedAt: now.toISOString() }
        this.db.prepare('INSERT INTO persistent_tasks VALUES(?,?,?,?)').run(id, this.instanceId, row.id, JSON.stringify(task)); count++
      })
    }
    return count
  }
}
