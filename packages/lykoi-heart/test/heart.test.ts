import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import type { HeartBeatPayload, HeartService } from '../src/index.ts'
import * as heart from '../src/index.ts'

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

async function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timeout')
    await sleep(2)
  }
}

test('tick 合并：错过 N 拍，claim 一次返回 {beats: N}，二次 claim 归零；每拍落 audit 行', async () => {
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  const beats: HeartBeatPayload[] = []
  ctx.on('heart/beat', (payload) => beats.push(payload))

  const fiber = await ctx.plugin(heart, { intervalMs: 5 })
  const svc = ctx.get('heart') as HeartService

  await waitUntil(() => beats.length >= 3)
  // 同步区内读数并 claim：不给新拍插进来的机会。
  const observed = svc.pending
  const { beats: claimed } = svc.claim()
  assert.equal(claimed, observed, 'claim 必须取走恰好全部积压拍')
  assert.ok(claimed >= 3)
  assert.equal(svc.claim().beats, 0, '取走后立刻再 claim 必须为 0')

  // 每拍事件 payload 携带递增的 pending（只置位不消费的可观测面）。
  for (let i = 0; i < claimed; i++) {
    assert.equal(beats[i]!.pending, i + 1)
    assert.equal(beats[i]!.source, 'interval')
  }
  // 每拍恰好一行 audit（M1 验收线）。
  const auditBeats = audit.events.filter((e) => e.type === 'heart/beat')
  assert.ok(auditBeats.length >= claimed)
  await fiber.dispose() // 收拍，别让定时器吊着测试进程
})

test('arouse 提前拍：立即置位并 emit，不等 interval', async () => {
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  const beats: HeartBeatPayload[] = []
  ctx.on('heart/beat', (payload) => beats.push(payload))

  const fiber = await ctx.plugin(heart, { intervalMs: 3_600_000 }) // 基线一小时一拍：期间不会有 interval 拍
  const svc = ctx.get('heart') as HeartService

  assert.equal(svc.pending, 0)
  svc.arouse('salience-test')
  // emit 是同步派发：调用返回时事件已经送达。
  assert.equal(beats.length, 1)
  assert.equal(beats[0]!.source, 'arouse')
  assert.equal(beats[0]!.reason, 'salience-test')
  assert.equal(svc.pending, 1)
  assert.deepEqual(svc.claim(), { beats: 1 })
  await fiber.dispose()
})

test('fiber 卸载后定时器停：不再有新拍', async () => {
  const ctx = new Context()
  ctx.provide('audit', fakeAudit())
  const beats: HeartBeatPayload[] = []
  ctx.on('heart/beat', (payload) => beats.push(payload))

  const fiber = await ctx.plugin(heart, { intervalMs: 5 })
  await waitUntil(() => beats.length >= 2)
  await fiber.dispose()

  const frozen = beats.length
  await sleep(40) // 若定时器仍活着，5ms 间隔早该多出好几拍
  assert.equal(beats.length, frozen, '卸载后不得再有心跳')
  assert.equal(ctx.get('heart'), undefined, '服务应随 fiber 注销')
})
