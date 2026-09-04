import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import type { BudgetService } from '../src/index.ts'
import { BudgetAccountant, BudgetExceeded } from '../src/index.ts'
import * as budget from '../src/index.ts'

/** 录音式 audit 假体：满足 fail-closed 接口，记录全部事件。 */
function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-budget-'))
}

const DAY1 = Date.UTC(2026, 7, 24, 12, 0, 0) // 2026-08-24T12:00Z
const DAY2 = Date.UTC(2026, 7, 25, 0, 30, 0) // 2026-08-25T00:30Z（隔一个 UTC 日）

test('红测：超过 per-route 硬顶后 gate 拒绝并落审计', async () => {
  const audit = fakeAudit()
  const acct = new BudgetAccountant({
    audit,
    warn: () => {},
    ledgerPath: join(tmp(), 'budget.json'),
    caps: { dailyTotalTokens: 1000, dailyRouteTokens: { mock: 50 } },
    now: () => DAY1,
  })
  acct.load()

  await acct.gate('mock') // 空账本必须放行
  await acct.charge({ route: 'mock', runId: 'run-1', promptTokens: 21, completionTokens: 13 })
  await acct.gate('mock') // 34 < 50 仍放行
  await acct.charge({ route: 'mock', runId: 'run-2', promptTokens: 21, completionTokens: 13 })

  // 68 >= 50：必须拒
  await assert.rejects(() => acct.gate('mock'), (err: unknown) => {
    assert.ok(err instanceof BudgetExceeded)
    assert.equal(err.scope, 'route')
    assert.equal(err.route, 'mock')
    assert.equal(err.used, 68)
    assert.equal(err.cap, 50)
    return true
  })
  const refusal = audit.events.find((e) => e.type === 'budget/refusal')
  assert.ok(refusal, '拒调必须落审计')
  assert.equal(refusal.route, 'mock')
  assert.equal(refusal.scope, 'route')
})

test('红测：总量层独立于 per-route 层生效', async () => {
  const audit = fakeAudit()
  const acct = new BudgetAccountant({
    audit,
    warn: () => {},
    ledgerPath: join(tmp(), 'budget.json'),
    caps: { dailyTotalTokens: 100, dailyRouteTokens: {} }, // 无 per-route 顶
    now: () => DAY1,
  })
  acct.load()
  await acct.charge({ route: 'a', runId: 'run-1', promptTokens: 60, completionTokens: 0 })
  await acct.charge({ route: 'b', runId: 'run-2', promptTokens: 40, completionTokens: 0 })
  await assert.rejects(() => acct.gate('c'), (err: unknown) => {
    assert.ok(err instanceof BudgetExceeded)
    assert.equal(err.scope, 'total')
    assert.equal(err.used, 100)
    return true
  })
})

test('跨 UTC 日复位：昨日打满，今日放行；账本保留两日记录', async () => {
  const audit = fakeAudit()
  const path = join(tmp(), 'budget.json')
  let nowMs = DAY1
  const acct = new BudgetAccountant({
    audit,
    warn: () => {},
    ledgerPath: path,
    caps: { dailyTotalTokens: 100, dailyRouteTokens: {} },
    now: () => nowMs,
  })
  acct.load()
  await acct.charge({ route: 'mock', runId: 'run-1', promptTokens: 100, completionTokens: 0 })
  await assert.rejects(() => acct.gate('mock'), BudgetExceeded)

  nowMs = DAY2 // UTC 日翻页
  await acct.gate('mock') // 复位后必须放行
  await acct.charge({ route: 'mock', runId: 'run-2', promptTokens: 1, completionTokens: 2 })
  assert.equal(acct.usage('mock').day, '2026-08-25')
  assert.equal(acct.usage('mock').routeTokens, 3)

  const ledger = JSON.parse(readFileSync(path, 'utf8')) as {
    days: Record<string, { totalTokens: number }>
  }
  assert.equal(ledger.days['2026-08-24']?.totalTokens, 100)
  assert.equal(ledger.days['2026-08-25']?.totalTokens, 3)
})

test('账本损坏当空，但当日硬顶继续保护', async () => {
  const audit = fakeAudit()
  const path = join(tmp(), 'budget.json')
  writeFileSync(path, '{"version":1,"days":{"2026-08-24"') // 截断的 JSON
  const warnings: string[] = []
  const acct = new BudgetAccountant({
    audit,
    warn: (m) => warnings.push(m),
    ledgerPath: path,
    caps: { dailyTotalTokens: 50, dailyRouteTokens: {} },
    now: () => DAY1,
  })
  acct.load()
  assert.ok(warnings.some((w) => w.includes('corrupt')), '损坏必须告警')
  assert.equal(acct.usage().totalTokens, 0) // 当空

  await acct.gate('mock') // 当空后放行
  await acct.charge({ route: 'mock', runId: 'run-1', promptTokens: 50, completionTokens: 0 })
  // 硬顶保护未被损坏解除：
  await assert.rejects(() => acct.gate('mock'), BudgetExceeded)
  // 且持久化已修复为合法 JSON：
  const ledger = JSON.parse(readFileSync(path, 'utf8')) as { version: number }
  assert.equal(ledger.version, 1)
})

test('插件形态：经 cordis 树装载后 ctx.budget 可用，charge 落真 audit 事件', async () => {
  const dir = tmp()
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  await ctx.plugin(budget, {
    ledgerPath: join(dir, 'budget.json'),
    dailyTotalTokens: 100,
    dailyRouteTokens: { mock: 10 },
  })
  const svc = ctx.get('budget') as BudgetService
  await svc.charge({ route: 'mock', runId: 'run-x', promptTokens: 7, completionTokens: 3 })
  await assert.rejects(() => svc.gate('mock'), BudgetExceeded)
  assert.deepEqual(
    audit.events.map((e) => e.type),
    ['budget/charge', 'budget/refusal'],
  )
})

/**
 * WO-R2-NEWBODY-01 D-4：cap=0 是「硬顶」语义的边界——零用量也必须拒（`>= cap`
 * 而非 `> cap`，`src/index.ts:189`）。R2 的费用闸前置靠这一条兜底：一具新体
 * 若把某条 route 的 cap 配成 0，它必须一次调用都发不出去，而不是"先发一次再说"。
 * per-route 与总量两层各断一次。
 */
test('D-4：cap=0 在零用量时即拒（per-route 与总量两层）', async () => {
  const audit = fakeAudit()
  const acct = new BudgetAccountant({
    audit,
    warn: () => {},
    ledgerPath: join(tmp(), 'budget.json'),
    caps: { dailyTotalTokens: 1000, dailyRouteTokens: { mock: 0 } },
    now: () => DAY1,
  })
  acct.load()
  assert.equal(acct.usage('mock').routeTokens, 0)
  await assert.rejects(() => acct.gate('mock'), (err: unknown) => {
    assert.ok(err instanceof BudgetExceeded)
    assert.equal(err.scope, 'route')
    assert.equal(err.used, 0)
    assert.equal(err.cap, 0)
    return true
  })
  assert.equal(audit.events.filter((e) => e.type === 'budget/refusal').length, 1)
  // 未配 per-route 的 route 落到总量层；总量 cap=0 同样零用量即拒。
  const total0 = new BudgetAccountant({
    audit,
    warn: () => {},
    ledgerPath: join(tmp(), 'budget.json'),
    caps: { dailyTotalTokens: 0, dailyRouteTokens: {} },
    now: () => DAY1,
  })
  total0.load()
  await assert.rejects(() => total0.gate('other'), (err: unknown) => {
    assert.ok(err instanceof BudgetExceeded)
    assert.equal(err.scope, 'total')
    assert.equal(err.used, 0)
    assert.equal(err.cap, 0)
    return true
  })
})
