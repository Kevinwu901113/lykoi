import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, type FinishReason, type GenerateOptions, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { BudgetService, ChargeInput } from 'lykoi-budget'
import type { LykoiLlmService } from '../src/index.ts'
import { LlmFinishError } from '../src/index.ts'
import * as lykoiLlm from '../src/index.ts'
import { MockAdapter } from '../src/mock.ts'
import * as mock from '../src/mock.ts'

/** 可编程 budget 假体：记录 gate/charge 调用，gate 可注入拒绝。 */
function fakeBudget(options: { refuse?: Error } = {}) {
  const gates: string[] = []
  const charges: ChargeInput[] = []
  const budget: BudgetService = {
    async gate(route) {
      gates.push(route)
      if (options.refuse) throw options.refuse
    },
    async charge(input) {
      charges.push(input)
    },
    usage() {
      return { day: '', totalTokens: 0, routeTokens: 0 }
    },
  }
  return { budget, gates, charges }
}

function request(): GenerateOptions {
  return {
    provider: 'mock',
    model: 'mock-model',
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      }),
    ],
  }
}

async function setup(budget: BudgetService) {
  const ctx = new Context()
  ctx.provide('budget', budget)
  await ctx.plugin(LlmRuntime)
  const adapter = new MockAdapter({ replyText: 'mock says hi', promptTokens: 21, completionTokens: 13 })
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(lykoiLlm)
  const svc = ctx.get('lykoiLlm') as LykoiLlmService
  return { ctx, adapter, svc }
}

test('红测：gate 拒绝时调用不发生（adapter 零调用、charge 零发生）', async () => {
  const refusal = new Error('BudgetExceeded (sentinel)')
  const { budget, gates, charges } = fakeBudget({ refuse: refusal })
  const { adapter, svc } = await setup(budget)

  await assert.rejects(() => svc.call(request(), { runId: 'run-red' }), (err: unknown) => {
    assert.equal(err, refusal, '闸的拒绝必须原样传播')
    return true
  })
  assert.deepEqual(gates, ['mock'], '闸必须先于调用被查询')
  assert.equal(adapter.calls, 0, '结构保证：拒绝后 adapter 一次都不能被触达')
  assert.equal(charges.length, 0, '未发生的调用不得记账')
})

test('绿测：gate 放行 → 调用发生 → 恰好一次 charge，用量按 dsh-llm usage 词汇映射', async () => {
  const { budget, gates, charges } = fakeBudget()
  const { adapter, svc } = await setup(budget)

  const result = await svc.call(request(), { runId: 'run-green' })
  assert.equal(result.text, 'mock says hi')
  assert.equal(result.usage?.inputTokens, 21)
  assert.equal(result.finish?.kind, 'stop')
  assert.equal(adapter.calls, 1)
  assert.deepEqual(gates, ['mock'])
  assert.deepEqual(charges, [
    {
      route: 'mock',
      runId: 'run-green',
      promptTokens: 21, // TokenUsage.inputTokens → promptTokens（蓝图口径）
      completionTokens: 13, // TokenUsage.outputTokens → completionTokens
    },
  ])
})

// --- WO-LLM-FINISH-01：失败类 finish 不再静默随返回值带出 --------------------

/**
 * 可编程终止 adapter：按给定 finish.reason 收尾。
 *
 * 形状照抄 MockAdapter（block-start/text-delta/block-end → usage → finish），
 * 只把最后一枚 chunk 换成待测的 reason —— LlmRuntime 的
 * `adapterFailureChunk` 归一出来的就是这一枚（NO_ADAPTER 事故的现场形态）。
 */
class FinishAdapter extends LlmAdapter {
  calls = 0
  #reason: FinishReason
  #text: string
  #usage: TokenUsage | null

  constructor(reason: FinishReason, options: { text?: string; usage?: TokenUsage | null } = {}) {
    super()
    this.#reason = reason
    this.#text = options.text ?? ''
    this.#usage = options.usage === undefined ? { inputTokens: 21, outputTokens: 13 } : options.usage
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.#text !== '') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: this.#text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: this.#text } }
    }
    if (this.#usage !== null) yield { type: 'usage', usage: this.#usage }
    yield { type: 'finish', reason: this.#reason }
  }
}

/** setup 的同胞：把 mock 路由换成待测 adapter（其余接线逐字相同）。 */
async function setupWith(budget: BudgetService, adapter: LlmAdapter) {
  const ctx = new Context()
  ctx.provide('budget', budget)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(lykoiLlm)
  const svc = ctx.get('lykoiLlm') as LykoiLlmService
  return { ctx, svc }
}

const NO_ADAPTER_FAILURE = {
  message: 'no adapter registered for provider "mock"',
  code: 'NO_ADAPTER',
  status: 503,
} as const

test('红测（WO-LLM-FINISH-01）：finish{error} → call() reject（LlmFinishError，reason 全量保真）', async () => {
  const reason: FinishReason = { kind: 'error', failure: NO_ADAPTER_FAILURE }
  const adapter = new FinishAdapter(reason)
  const { budget, gates, charges } = fakeBudget()
  const { svc } = await setupWith(budget, adapter)

  await assert.rejects(() => svc.call(request(), { runId: 'run-finish-error' }), (err: unknown) => {
    assert.ok(err instanceof LlmFinishError, '失败类 finish 必须以带类型错误抛出')
    assert.equal(err.name, 'LlmFinishError')
    // reason 全量保真 —— 不是压扁成一个字符串。
    assert.deepEqual(err.reason, reason)
    assert.equal(err.reason.kind, 'error')
    assert.equal(err.reason.failure.code, 'NO_ADAPTER')
    assert.equal(err.reason.failure.status, 503)
    assert.equal(err.reason.failure.message, NO_ADAPTER_FAILURE.message)
    // route / usage / text 长度随错误一起到场。
    assert.equal(err.route, 'mock')
    assert.equal(err.usage?.inputTokens, 21)
    assert.equal(err.usage?.outputTokens, 13)
    assert.equal(err.textLength, 0, '事故现场就是这个 0 —— 空 text 曾被当作正常返回')
    // 错误信息里带得出根因（下游只记 message 的失败路径也看得见 NO_ADAPTER）。
    assert.match(err.message, /NO_ADAPTER/)
    assert.match(err.message, /route=mock/)
    return true
  })

  assert.deepEqual(gates, ['mock'], '闸的次序不变')
  assert.equal(adapter.calls, 1)
  assert.deepEqual(charges, [
    { route: 'mock', runId: 'run-finish-error', promptTokens: 21, completionTokens: 13 },
  ], '记账必须仍然发生，且发生在抛出之前（口径一个字不变）')
})

test('红测：finish{aborted} 同属失败类；usage 缺席仍按 0 记账（M2 口径不变）', async () => {
  const reason: FinishReason = {
    kind: 'aborted',
    failure: { message: 'request aborted', code: 'ABORTED' },
  }
  const adapter = new FinishAdapter(reason, { text: '半截话', usage: null })
  const { budget, charges } = fakeBudget()
  const { svc } = await setupWith(budget, adapter)

  await assert.rejects(() => svc.call(request(), { runId: 'run-finish-aborted' }), (err: unknown) => {
    assert.ok(err instanceof LlmFinishError)
    assert.equal(err.reason.kind, 'aborted')
    assert.equal(err.reason.failure.code, 'ABORTED')
    assert.equal(err.usage, undefined, 'usage 缺席就是缺席，不编一个出来')
    assert.equal(err.textLength, 3, '已经拼到的那半截只报长度，不带正文')
    return true
  })

  assert.deepEqual(charges, [
    { route: 'mock', runId: 'run-finish-aborted', promptTokens: 0, completionTokens: 0 },
  ], 'usage 缺席按 0 记账 —— 本单不动这条 TODO(M2)')
})

test('绿测：非失败类 finish（tool-calls / max-tokens / stop）行为不变，仍随返回值带出', async () => {
  for (const kind of ['stop', 'tool-calls', 'max-tokens'] as const) {
    const adapter = new FinishAdapter({ kind }, { text: 'ok' })
    const { budget, charges } = fakeBudget()
    const { svc } = await setupWith(budget, adapter)

    const result = await svc.call(request(), { runId: `run-${kind}` })
    assert.equal(result.text, 'ok')
    assert.deepEqual(result.finish, { kind })
    assert.equal(result.usage?.inputTokens, 21)
    assert.deepEqual(charges, [
      { route: 'mock', runId: `run-${kind}`, promptTokens: 21, completionTokens: 13 },
    ])
  }
})

test('mock 插件形态：经 cordis 装载注册路由，listProviders 可见', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(mock, {
    provider: 'mock',
    replyText: 'hi',
    promptTokens: 1,
    completionTokens: 1,
  })
  const providers = ctx.llm.listProviders().map((p) => p.id)
  assert.deepEqual(providers, ['mock'])
})
