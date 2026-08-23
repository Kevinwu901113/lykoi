import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AuditService } from '../src/index.ts'
import * as audit from '../src/index.ts'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-audit-'))
}

test('并发 record 不交错：每行都是完整 JSON，一条不丢', async () => {
  const path = join(tmp(), 'audit.jsonl')
  const ctx = new Context()
  await ctx.plugin(audit, { path })
  const svc = ctx.get('audit') as AuditService

  const n = 100
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      // 长短悬殊的负载：若分片写或不串行，行必然交错、JSON.parse 必炸。
      svc.record({ type: 'test/concurrency', i, pad: 'x'.repeat(500 + (i % 7) * 997) }),
    ),
  )

  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0)
  assert.equal(lines.length, n)
  const seen = new Set<number>()
  for (const line of lines) {
    const row = JSON.parse(line) as { type: string; i: number; pad: string; ts: string }
    assert.equal(row.type, 'test/concurrency')
    assert.equal(row.pad.length, 500 + (row.i % 7) * 997)
    assert.equal(typeof row.ts, 'string')
    seen.add(row.i)
  }
  assert.equal(seen.size, n)
})

test('写失败向调用方传播（fail-closed）', async () => {
  const dir = tmp()
  const blocker = join(dir, 'not-a-dir')
  writeFileSync(blocker, 'occupied')
  // 父路径是普通文件 → mkdir/open 必失败 → record 必须 reject 给调用方。
  const path = join(blocker, 'audit.jsonl')
  const ctx = new Context()
  await ctx.plugin(audit, { path })
  const svc = ctx.get('audit') as AuditService
  await assert.rejects(() => svc.record({ type: 'test/failure' }))
  // 失败不毒化链：后续调用仍走完整路径（仍失败，但依旧传播而非挂起）。
  await assert.rejects(() => svc.record({ type: 'test/failure-2' }))
})

test('fiber 卸载后 record 拒绝（audit 不在 = 不许静默继续）', async () => {
  const path = join(tmp(), 'audit.jsonl')
  const ctx = new Context()
  const fiber = await ctx.plugin(audit, { path })
  const svc = ctx.get('audit') as AuditService
  await svc.record({ type: 'test/before-dispose' })
  await fiber.dispose()
  await assert.rejects(() => svc.record({ type: 'test/after-dispose' }))
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0)
  assert.equal(lines.length, 1)
})
