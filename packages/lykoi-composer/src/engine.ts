import { join } from 'node:path'
import type { ComponentRegistry } from './registry.ts'
import type { ComposerStore } from './store.ts'
import type {
  AgentDefinition,
  Config,
  CoreDecision,
  InvocationContext,
  Json,
  Model,
  NodeDefinition,
  Operation,
  Run
} from './contracts.ts'
import { assertJson, graphOrder, validateDefinition } from './definition.ts'
import { compatibleModel, coreMessages, demoModel, ensureWorkspace } from './builtins.ts'
import { runCognition } from './cognition.ts'

class Suspended extends Error {}
const terminal = (run: Run) => ['succeeded', 'failed', 'cancelled'].includes(run.status)
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {}
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('operation aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
    ])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
export type ResourceFactory = (
  resource: AgentDefinition['resources'][number],
  instanceId: string
) => Promise<Model | { root: string }>

/** Single deployment writer. The HTTP entry point holds a deployment process lock. */
export class ComposerEngine {
  readonly store: ComposerStore
  readonly registry: ComponentRegistry
  #active = new Map<string, { promise: Promise<void>; controller: AbortController }>()
  #resources = new Map<string, Promise<Model | { root: string }>>()
  #factory: ResourceFactory
  #accepting = true
  constructor(
    store: ComposerStore,
    registry: ComponentRegistry,
    options: {
      workspaceRoot: string
      credentials?: Record<string, string>
      resourceFactory?: ResourceFactory
    }
  ) {
    this.store = store
    this.registry = registry
    this.#factory =
      options.resourceFactory ??
      (async (resource, instanceId) => {
        if (resource.type === 'workspace')
          return ensureWorkspace(join(options.workspaceRoot, instanceId, resource.id))
        if (resource.config.provider === 'demo') return { ...demoModel }
        const handle = resource.config.credential
        const credential = typeof handle === 'string' ? options.credentials?.[handle] : undefined
        if (handle && !credential) throw new Error('configured credential handle is unavailable')
        return compatibleModel(resource.config, credential)
      })
  }
  start(instanceId: string, input: Json): Run {
    if (!this.#accepting) throw new Error('runtime is stopping')
    const version = this.store.definition(this.store.instance(instanceId).agentId)
    validateDefinition(version.definition, this.registry)
    const run = this.store.createRun(instanceId, input)
    void this.drive(run.id)
    return run
  }
  async recover(): Promise<void> {
    // Interrupted operations require evidence, never an automatic duplicate call.
    for (const run of this.store.runs().filter((r) => !terminal(r))) {
      for (const op of this.store.operations(run.id).filter((o) => o.status === 'started'))
        this.store.settleOperation({
          ...op,
          status: 'unknown',
          prompt: '进程在操作完成前退出。请核验结果，不会自动重做。'
        })
      if (run.status === 'paused') continue
      if (run.status === 'running')
        this.store.editRun(run.id, (r) => {
          r.status = 'queued'
        })
      if (this.store.run(run.id).status === 'queued') await this.drive(run.id)
    }
  }
  drive(id: string): Promise<void> {
    if (this.#active.has(id)) return this.#active.get(id)!.promise
    if (!this.#accepting) return Promise.resolve()
    const controller = new AbortController()
    // Defer until #active is published; all errors become durable run state.
    const promise = Promise.resolve()
      .then(() => this.#drive(id, controller))
      .finally(() => this.#active.delete(id))
    this.#active.set(id, { promise, controller })
    return promise
  }
  async idle(id: string) {
    await this.#active.get(id)?.promise
  }
  pause(id: string): Run {
    return this.store.editRun(id, (r) => {
      if (terminal(r)) throw new Error('run is terminal')
      r.status = 'paused'
      this.store.trace(id, 'run.paused', {})
    })
  }
  async resume(id: string): Promise<Run> {
    await this.idle(id)
    this.store.editRun(id, (r) => {
      if (terminal(r) || r.wait) throw new Error('resolve the pending operation before resuming')
      r.status = 'queued'
      this.store.trace(id, 'run.resumed', {})
    })
    void this.drive(id)
    return this.store.run(id)
  }
  cancel(id: string): Run {
    const run = this.store.editRun(id, (r) => {
      if (terminal(r)) throw new Error('run is terminal')
      r.status = 'cancelled'
      delete r.wait
      this.store.trace(id, 'run.cancelled', {})
    })
    this.#active.get(id)?.controller.abort(new Error('user cancelled the run'))
    return run
  }
  async resolve(id: string, operationId: string, value: Json): Promise<Run> {
    assertJson(value)
    await this.idle(id)
    const run = this.store.run(id),
      op = this.store.operation(operationId)
    if (!op || op.runId !== id) throw new Error('invalid callback ownership')
    if (op.status === 'completed') {
      if (!equal(op.result, value)) throw new Error('callback conflicts with committed result')
      return run
    }
    if (terminal(run) || run.wait?.operationId !== operationId || !['waiting', 'unknown'].includes(op.status))
      throw new Error('operation is not awaiting input')
    if (this.registry.get(op.component, op.version).kind === 'core') {
      const v = value as any
      if (!v || v.kind !== 'finish' || v.result === undefined)
        throw new Error('unknown model operation requires a verified {kind:"finish",result:...} receipt')
    } else if (this.registry.get(op.component, op.version).output === 'text' && typeof value !== 'string')
      throw new Error('component requires a text result')
    this.store.resolveOperation(id, operationId, value)
    if (this.store.run(id).status === 'queued') void this.drive(id)
    return this.store.run(id)
  }
  async #context(
    run: Run,
    node: NodeDefinition,
    operationId: string,
    signal: AbortSignal
  ): Promise<InvocationContext> {
    const values = new Map<string, Model | { root: string }>()
    for (const [role, id] of Object.entries(node.resources)) {
      const resource = run.version.definition.resources.find((r) => r.id === id)!
      const key = JSON.stringify([run.instanceId, resource])
      if (!this.#resources.has(key))
        this.#resources.set(
          key,
          this.#factory(resource, run.instanceId).catch((error) => {
            this.#resources.delete(key)
            throw error
          })
        )
      values.set(role, await this.#resources.get(key)!)
    }
    return {
      instanceId: run.instanceId,
      runId: run.id,
      operationId,
      signal,
      resource: (role) => {
        if (!values.has(role)) throw new Error('resource is outside component bindings')
        return values.get(role)!
      }
    }
  }
  async #operation(
    run: Run,
    node: NodeDefinition,
    suffix: string,
    input: Json,
    signal: AbortSignal,
    invoke?: (context: InvocationContext) => Promise<Json>
  ): Promise<Json> {
    const id = `${run.id}:${node.id}:${suffix}`,
      previous = this.store.operation(id)
    if (
      previous &&
      (!equal(previous.input, input) ||
        previous.component !== node.component ||
        previous.version !== node.version)
    )
      throw new Error('persisted operation differs from the pinned definition')
    if (previous?.status === 'completed') return previous.result!
    if (previous) {
      const reason = previous.status === 'waiting' ? 'input' : 'unknown'
      this.#wait(run.id, node.id, id, reason, previous.prompt ?? '操作结果不确定，请核验后提供结果。')
      throw new Suspended()
    }
    if (this.store.run(run.id).status !== 'running') throw new Suspended()
    signal.throwIfAborted()
    // Preparation has no external side effect and may fail before an intention is written.
    const context = await abortable(this.#context(run, node, id, signal), signal)
    signal.throwIfAborted()
    if (this.store.run(run.id).status !== 'running') throw new Suspended()
    const op: Operation = {
      id,
      runId: run.id,
      nodeId: node.id,
      component: node.component,
      version: node.version,
      input,
      status: 'started'
    }
    this.store.startOperation(op)
    try {
      const work = this.registry.use(node.component, node.version, async (spec) => {
        if (spec.input === 'text' && typeof input !== 'string')
          throw new Error('component requires text input')
        if (invoke) return { status: 'completed' as const, value: await invoke(context) }
        return spec.invoke!(input, node.config, context)
      })
      const result = await abortable(work, signal)
      if (result.status === 'waiting') {
        this.store.settleOperation({ ...op, status: 'waiting', prompt: result.prompt })
        this.#wait(run.id, node.id, id, 'input', result.prompt)
        throw new Suspended()
      }
      assertJson(result.value)
      this.store.settleOperation({ ...op, status: 'completed', result: result.value })
      return result.value
    } catch (error) {
      if (error instanceof Suspended) throw error
      // Any exception after intention publication may follow an external effect.
      this.store.settleOperation({ ...op, status: 'unknown', prompt: '操作未取得确定回执，请核验实际结果。' })
      this.#wait(run.id, node.id, id, 'unknown', '操作未取得确定回执，请核验实际结果。')
      throw new Suspended()
    }
  }
  #wait(runId: string, nodeId: string, operationId: string, reason: 'input' | 'unknown', prompt: string) {
    this.store.editRun(runId, (r) => {
      if (terminal(r)) return
      if (r.status !== 'paused') r.status = 'waiting'
      r.wait = { operationId, nodeId, reason, prompt }
      this.store.trace(runId, 'run.waiting', { operationId, reason, prompt })
    })
  }
  async #core(run: Run, node: NodeDefinition, input: Json, signal: AbortSignal): Promise<Json> {
    const d = run.version.definition,
      messages = coreMessages(String(node.config.system), input)
    const toolNodes = node.tools.map((id) => d.nodes.find((n) => n.id === id)!)
    const tools = toolNodes.map((n) => {
      const spec = this.registry.get(n.component, n.version)
      return { name: n.id, description: spec.description, parameters: spec.toolSchema ?? {} }
    })
    const otherActions = this.store
      .operations(run.id)
      .filter((op) =>
        d.nodes.some(
          (n) => n.id !== node.id && n.tools.some((t) => op.id.startsWith(`${run.id}:${t}:${n.id}-tool-`))
        )
      ).length
    const outcome = await runCognition<{ tool: string; input: Json; callId: string }, Json, Json>({
      maxActions: d.execution.mode === 'tools' ? Math.max(0, d.execution.maxActions - otherActions) : 0,
      signal,
      reason: async ({ index, closing }) => {
        const decision = (await this.#operation(
          run,
          node,
          `compute-${index}`,
          messages as unknown as Json,
          signal,
          async (context) =>
            (context.resource('model') as Model).compute(
              messages,
              closing ? [] : tools,
              signal
            ) as unknown as Promise<Json>
        )) as unknown as CoreDecision
        if (!decision || !['act', 'finish'].includes(decision.kind)) throw new Error('invalid Core decision')
        if (decision.kind === 'act') {
          const { tool, input, callId } = decision.action
          if (!toolNodes.some((n) => n.id === tool) || typeof callId !== 'string')
            throw new Error('Core requested a tool outside its bindings')
          assertJson(input)
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: callId, type: 'function', function: { name: tool, arguments: JSON.stringify(input) } }
            ]
          })
        }
        return decision
      },
      act: (action, index) =>
        this.#operation(
          run,
          toolNodes.find((n) => n.id === action.tool)!,
          `${node.id}-tool-${index}`,
          action.input,
          signal
        ),
      observe: (observation, action) => {
        messages.push({ role: 'tool', tool_call_id: action.callId, content: JSON.stringify(observation) })
      }
    })
    if (outcome.status === 'budget_exhausted') throw new Error('execution step budget exhausted')
    return outcome.result
  }
  async #drive(id: string, controller: AbortController) {
    let timer: NodeJS.Timeout | undefined
    let startedAt: number | undefined
    try {
      let run = this.store.run(id)
      if (run.status !== 'queued') return
      validateDefinition(run.version.definition, this.registry)
      const remaining = run.version.definition.execution.timeoutMs - (run.activeMs ?? 0)
      if (remaining <= 0) throw new Error('run active-time budget exhausted')
      run = this.store.editRun(id, (r) => {
        r.status = 'running'
        this.store.trace(id, 'run.started', {})
      })
      startedAt = performance.now()
      timer = setTimeout(() => controller.abort(new Error('run deadline exceeded')), remaining)
      const d = run.version.definition
      for (const nodeId of graphOrder(d)) {
        run = this.store.run(id)
        if (run.status !== 'running') return
        const node = d.nodes.find((n) => n.id === nodeId)!,
          spec = this.registry.get(node.component, node.version)
        if (spec.kind === 'tool' || Object.hasOwn(run.outputs, nodeId)) continue
        controller.signal.throwIfAborted()
        const upstream = d.edges.find((e) => e.to === nodeId)?.from
        const input = upstream ? run.outputs[upstream] : run.input
        const output =
          spec.kind === 'core'
            ? await this.#core(run, node, input, controller.signal)
            : await this.#operation(run, node, 'invoke', input, controller.signal)
        this.store.editRun(id, (r) => {
          if (r.status === 'cancelled') return
          r.outputs[nodeId] = output
          this.store.trace(id, 'node.completed', { nodeId, output })
        })
      }
      this.store.editRun(id, (r) => {
        if (r.status !== 'running') return
        r.result = r.outputs[d.output]
        r.status = 'succeeded'
        delete r.wait
        this.store.trace(id, 'run.succeeded', {})
      })
    } catch (error) {
      if (error instanceof Suspended) return
      this.store.editRun(id, (r) => {
        if (terminal(r) || r.status === 'paused') return
        r.status = 'failed'
        r.error = error instanceof Error ? error.message : 'execution failed'
        this.store.trace(id, 'run.failed', { error: r.error })
      })
    } finally {
      clearTimeout(timer)
      if (startedAt !== undefined)
        this.store.editRun(id, (r) => {
          r.activeMs = (r.activeMs ?? 0) + Math.max(0, performance.now() - startedAt!)
        })
    }
  }
  async close() {
    this.#accepting = false
    for (const [id, active] of this.#active) {
      this.pause(id)
      active.controller.abort(new Error('runtime is stopping'))
    }
    await Promise.allSettled([...this.#active.values()].map((a) => a.promise))
  }
}
