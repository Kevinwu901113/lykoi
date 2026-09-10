import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { runCognition, type CognitionDecision } from 'lykoi-runtime/cognition'
import type { CapabilityExecutionContext, TaskDeliveryResult } from 'lykoi-contracts'
import { TaskStore, type Artifact, type Operation, type Task, type TaskRun, type TaskWait } from './store.ts'

export interface TaskAction { name: string; args: Record<string, unknown> }
export type TaskResult = { finding?: string } & (
  | { status: 'continue'; checkpoint: string }
  | { status: 'waiting'; checkpoint: string; wait: TaskWait }
  | { status: 'completed'; checkpoint: string; content: string; artifacts: string[] }
  | { status: 'failed'; checkpoint: string; reason: string })
export type RecoveredOperation = { status: 'completed'; observation: unknown } | { status: 'pending' | 'unknown'; detail: string }
export interface TaskDependencies {
  reason(input: { task: Task; run: TaskRun; operations: Operation[]; closing: boolean; signal: AbortSignal; now: Date }): Promise<CognitionDecision<TaskAction, TaskResult>>
  dispatch(action: TaskAction, context: CapabilityExecutionContext, approved?: boolean): Promise<unknown>
  reconcile?(operation: Operation, task: Task): Promise<RecoveredOperation>
  cancel?(operation: Operation, task: Task): Promise<void>
  requestApproval?(operation: Operation, task: Task): Promise<void>
  recordCompleted?(task: Task): number
  deliver?(task: Task): Promise<TaskDeliveryResult>
  receive?(event: import('lykoi-contracts').MindEvent): void
  concurrency?: number
  now?: () => Date
  maxActions: number
  intervalMs: number
}
class RequirementsChanged extends Error {}

/** Independent task contexts; only synchronous store commits serialize. */
export class TaskRuntime {
  readonly store: TaskStore
  readonly deps: TaskDependencies
  #active = new Map<string, AbortController>()
  #scan: Promise<Promise<void>[]> | null = null
  #running = new Map<string, Promise<void>>()
  #closed = false
  constructor(store: TaskStore, deps: TaskDependencies) {
    if (!Number.isSafeInteger(deps.maxActions) || deps.maxActions < 1) throw new Error('task maxActions must be a positive integer')
    this.store = store; this.deps = deps
  }
  #now() { return this.deps.now?.() ?? new Date() }
  async recover() {
    this.store.recover()
    await this.reconcile()
  }
  async reconcile() {
    if (!this.deps.reconcile) return
    for (const task of this.store.list()) {
      const operations = this.store.operations(task.id).filter(op => op.status === 'unknown' || (task.wait?.kind === 'operation' && task.wait.operationId === op.id))
      for (const op of operations) {
        const result = await this.deps.reconcile(op, task)
        if (result.status !== 'completed') {
          if (task.wait?.operationId === op.id) this.store.edit(task.id, current => { if (current.wait?.operationId === op.id) current.wait.detail = result.detail })
          if ((task.status === 'paused' || task.status === 'cancelled') && result.status === 'pending') await this.deps.cancel?.(op, task)
          continue
        }
        this.store.saveOperation({ ...op, status: 'completed', observation: result.observation })
        const outstanding = this.store.operations(task.id).some(o => o.status !== 'completed')
        if (!outstanding) this.store.edit(task.id, current => {
          if (current.wait?.kind === 'verification' || current.wait?.operationId === op.id) {
            current.wait = null
            if (current.status === 'waiting') current.status = 'pending'
          }
        })
      }
    }
  }
  async control(id: string, command: 'pause' | 'resume' | 'cancel') {
    const task = this.store.control(id, command)
    if (command !== 'resume') {
      this.#active.get(id)?.abort(new Error(`task ${command} requested`))
      if (this.deps.cancel) for (const op of this.store.operations(id)) {
        if (op.status === 'inflight' || op.status === 'unknown' || (op.status === 'completed' && task.wait?.operationId === op.id)) await this.deps.cancel(op, task)
      }
    }
    const current = this.store.get(id)
    if (command === 'resume' && current.wait?.kind === 'approval' && current.wait.operationId) await this.#requestApproval(this.store.operation(current.wait.operationId)!, current)
    return this.store.get(id)
  }
  async #requestApproval(op: Operation, task: Task) {
    try {
      if (!this.deps.requestApproval) throw new Error('approval delivery unavailable')
      await this.deps.requestApproval(op, task)
      this.store.edit(task.id, current => { current.failure = null })
    } catch (error) {
      this.store.edit(task.id, current => { current.failure = `审批请求未送达：${error instanceof Error ? error.message : String(error)}` })
      throw error
    }
  }
  async close() {
    this.#closed = true
    for (const controller of this.#active.values()) controller.abort(new Error('task runtime stopping'))
    await this.#scan
    await Promise.allSettled(this.#running.values())
  }
  async scan(): Promise<void> {
    if (this.#closed) return
    if (!this.#scan) this.#scan = this.#tick().finally(() => { this.#scan = null })
    const runs = await this.#scan
    await Promise.all(runs)
  }
  async #settle() {
    if (this.deps.receive) this.store.relay(this.deps.receive)
    for (const t of this.store.list()) {
      if (t.status === 'completed' && t.experienceId === null && this.deps.recordCompleted) {
        const experienceId = this.deps.recordCompleted(t)
        this.store.edit(t.id, current => { current.experienceId = experienceId })
      }
      if (t.delivery?.state === 'pending' && !this.#closed) await this.deliver(t.id)
    }
  }
  async #tick(): Promise<Promise<void>[]> {
    await this.reconcile()
    await this.#settle()
    for (const task of this.store.list()) {
      if (task.status === 'waiting' && task.wait?.kind === 'due' && task.wait.until && Date.parse(task.wait.until) <= this.#now().getTime()) {
        this.store.edit(task.id, t => { t.status = 'pending'; t.wait = null })
      }
    }
    const tasks = this.store.list().filter(t => t.status === 'pending').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    return tasks.slice(0, Math.max(0, (this.deps.concurrency ?? 2) - this.#running.size)).map(task => this.advance(task.id))
  }
  advance(id: string): Promise<void> {
    const existing = this.#running.get(id)
    if (existing) return existing
    if (this.#running.size >= (this.deps.concurrency ?? 2) || this.#closed) return Promise.resolve()
    const running = this.#advance(id).then(() => this.#settle()).finally(() => { this.#running.delete(id) })
    this.#running.set(id, running)
    return running
  }
  async #advance(id: string) {
    if (this.#active.has(id) || this.#closed) return
    const run = this.store.claim(id, this.#now())
    if (!run) return
    const controller = new AbortController(), signal = controller.signal
    this.#active.set(id, controller)
    const current = () => {
      signal.throwIfAborted()
      const task = this.store.get(id)
      if (task.status !== 'running') throw new RequirementsChanged(`task is ${task.status}`)
      if (task.revision !== run.revision) throw new RequirementsChanged('requirements changed during cognition')
      return task
    }
    const act = async (action: TaskAction, approvedOp?: Operation) => {
      const task = current()
      const op = approvedOp ?? this.store.intent(id, run.id, action.name, action.args)
      if (approvedOp) {
        if (approvedOp.approvalRevision !== task.revision) throw new RequirementsChanged('approval belongs to earlier requirements')
        this.store.saveOperation({ ...op, status: 'inflight', approved: false })
      }
      const observation = await this.deps.dispatch(action, {
          instanceId: task.instanceId, taskId: id, operationId: op.id, workspace: task.workspace, signal,
        }, approvedOp?.approved)
      const text = JSON.stringify(observation), reference = `observation-${op.id}.json`
      if (text.length > 16000) await writeFile(resolve(task.workspace, reference), text, { flag: 'wx' })
      const data = (observation as { data?: { pending?: boolean; needs_approval?: boolean } })?.data
      const pending: Operation = data?.needs_approval
        ? { ...op, status: 'approval', observation, approvalRevision: task.revision, approved: false }
        : { ...op, status: 'completed', observation: text.length > 16000 ? { reference, preview: text.slice(0, 16000) } : observation }
      // The result and its wait are one commit. Late results never undo a pause or cancellation.
      const saved = this.store.edit(id, current => {
        this.store.saveOperation(pending)
        if (data?.pending || data?.needs_approval) {
          current.wait = data.needs_approval
            ? { kind: 'approval', operationId: op.id, detail: `需要批准 ${op.name}: ${JSON.stringify(op.args)}` }
            : { kind: 'operation', operationId: op.id, detail: `${op.name} 已启动，等待实际执行结果` }
          if (current.status === 'running') current.status = 'waiting'
        }
      })
      if (data?.needs_approval && saved.status === 'waiting') await this.#requestApproval(pending, saved)
      return observation
    }

    try {
      const approved = this.store.operations(id).find(op => op.status === 'approval' && op.approved)
      if (approved) {
        await act({ name: approved.name, args: approved.args }, approved)
        if (this.store.get(id).status === 'waiting') { this.store.finishRun(run, 'finished'); return }
      }
      const outcome = await runCognition<TaskAction, unknown, TaskResult>({ maxActions: this.deps.maxActions - (approved ? 1 : 0), signal,
        reason: async ({ closing }) => this.deps.reason({ task: current(), run, operations: this.store.operations(id), closing, signal, now: this.#now() }),
        act: action => act(action),

        observe: () => {
          const task = this.store.get(id)
          if (task.status === 'waiting' && task.wait) return { kind: 'finish', result: { status: 'waiting', checkpoint: task.checkpoint, wait: task.wait } }
        },
      })
      if (this.store.get(id).status === 'waiting' && outcome.status === 'finished' && outcome.result.status === 'waiting') { this.store.finishRun(run, 'finished'); return }
      current()
      const result = outcome.status === 'finished' ? outcome.result : { status: 'continue', checkpoint: this.store.get(id).checkpoint } as const
      const artifacts = result.status === 'completed' ? await this.artifacts(id, result.artifacts) : []
      current() // File verification can race a requirements update or a pause.
      this.store.edit(id, task => {
        task.checkpoint = result.checkpoint; task.failure = null
        if ('finding' in result && typeof result.finding === 'string') task.finding = result.finding
        if (result.status === 'continue') {
          task.status = 'waiting'; task.wait = { kind: 'due', detail: '下一次认知继续推进', until: new Date(this.#now().getTime() + this.deps.intervalMs).toISOString() }
        } else if (result.status === 'waiting') {
          if (result.wait.kind === 'due' && (!result.wait.until || !Number.isFinite(Date.parse(result.wait.until)))) throw new Error('due wait needs a valid timestamp')
          if (result.wait.kind === 'operation' && !this.store.operations(id).some(op => op.id === result.wait.operationId)) throw new Error('wait references an unknown operation')
          task.status = 'waiting'; task.wait = result.wait
        } else if (result.status === 'failed') {
          if (typeof result.reason !== 'string' || !result.reason.trim()) throw new TypeError('failed task requires a reason')
          task.status = 'failed'; task.failure = result.reason; task.wait = null
          task.delivery = task.origin === 'autonomous' ? null : { state: 'pending', content: `任务 ${task.id} 未完成：${result.reason}`, attempts: 0, error: null } }
        else {
          if (!result.content.trim()) throw new Error('completion requires an inspectable result')
          task.status = 'completed'; task.wait = null; task.artifacts = artifacts; task.result = result.content
          task.delivery = task.origin === 'autonomous' ? null : { state: 'pending', content: result.content, attempts: 0, error: null }
        }
      })
      this.store.finishRun(run, 'finished')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.finishRun(run, signal.aborted || error instanceof RequirementsChanged ? 'interrupted' : 'failed', message)
      this.store.edit(id, task => {
        const uncertain = this.store.operations(id).filter(op => op.status === 'inflight' || op.status === 'unknown')
        for (const op of uncertain) this.store.saveOperation({ ...op, status: 'unknown' })
        if (uncertain.length) task.wait = { kind: 'verification', operationId: uncertain[0]!.id, detail: message }
        if (task.status !== 'running') return
        if (uncertain.length) task.status = 'waiting'
        else if (signal.aborted || error instanceof RequirementsChanged) task.status = 'pending'
        else {
          task.status = 'failed'; task.failure = message
          task.delivery = task.origin === 'autonomous' ? null : { state: 'pending', content: `任务 ${task.id} 未完成：${message}`, attempts: 0, error: null }
        }
      })
    } finally { this.#active.delete(id) }
  }
  approve(operationId: string, action?: TaskAction): boolean {
    const op = this.store.operation(operationId)
    if (!op) return false
    const task = this.store.get(op.taskId)
    if (op.status !== 'approval' || op.approved) throw new Error('operation is not awaiting approval')
    if (action && (action.name !== op.name || !isDeepStrictEqual(action.args, op.args))) throw new Error('approval action does not match the task request')
    if (task.revision !== op.approvalRevision) throw new Error('requirements changed; request a new action')
    if (task.status !== 'waiting' && task.status !== 'paused') throw new Error(`task is ${task.status}`)
    this.store.transaction(() => {
      this.store.saveOperation({ ...op, approved: true })
      // Paused remains paused. An explicit resume is still required.
      if (task.status === 'waiting') {
        task.status = 'pending'; task.wait = null
        this.store.db.prepare('UPDATE persistent_tasks SET document=? WHERE id=?').run(JSON.stringify(task), task.id)
      }
    })
    return true
  }
  async artifacts(id: string, paths: string[]): Promise<Artifact[]> {
    const root = await realpath(this.store.get(id).workspace)
    return Promise.all(paths.map(async path => {
      const actual = await realpath(resolve(root, path)), rel = relative(root, actual)
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('artifact is outside task workspace')
      const data = await readFile(actual)
      return { path: actual, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
    }))
  }
  async deliver(id: string) {
    if (!this.deps.deliver) return
    const task = this.store.get(id)
    if (task.delivery?.state !== 'pending') return
    this.store.edit(id, t => { t.delivery!.state = 'sending'; t.delivery!.attempts++ })
    try {
      const result = await this.deps.deliver(this.store.get(id))
      this.store.edit(id, t => { t.delivery!.state = result.state; t.delivery!.receipt = result.receipt; t.delivery!.error = result.error ?? null })
    } catch (error) {
      this.store.edit(id, t => { t.delivery!.state = 'unknown'; t.delivery!.error = error instanceof Error ? error.message : String(error) })
    }
  }
  retryDelivery(id: string) {
    return this.store.edit(id, t => {
      if (t.delivery?.state !== 'failed') throw new Error('only confirmed failed delivery can be retried')
      t.delivery.state = 'pending'
    })
  }
}
