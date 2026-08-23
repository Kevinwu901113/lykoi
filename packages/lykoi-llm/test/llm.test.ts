import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { BudgetService, ChargeInput } from 'lykoi-budget'
import type { LykoiLlmService } from '../src/index.ts'
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
