/**
 * restart 自我意识（SA-162..165；W5）：三句模板 / downtime 四档 / 记录+标记 /
 * 严格大于的未处理判定 / 读不到就省略绝不编造 / startup never dies on this。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatDowntime, latestRestartEvent, recordRestartEvent, renderRestartNotice,
  unprocessedRestartEvent, type RestartStore,
} from '../src/index.ts'

const T0 = new Date('2026-08-24T10:00:00Z')
const T1 = new Date('2026-08-24T11:00:00Z')

/** 内存 history（append-only 面）。 */
function memStore(): RestartStore & { rows: { ts: string; content: string; type: string }[] } {
  const rows: { ts: string; content: string; type: string }[] = []
  return {
    rows,
    appendHistory(eventType, content, opts) {
      rows.push({ ts: opts.now.toISOString(), content, type: eventType })
      return rows.length
    },
    getRecentHistoryOfType(eventType, n) {
      return rows.filter((r) => r.type === eventType).slice(-n).reverse()
    },
  }
}

function markerDir(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-restart-'))
}

test('formatDowntime 四档逐字：秒/分/时+分/天（≥1 天只报天数 —— 长睡眠的粒度）', () => {
  assert.equal(formatDowntime(59), '59 秒')
  assert.equal(formatDowntime(60), '1 分钟')
  assert.equal(formatDowntime(3599), '59 分钟')
  assert.equal(formatDowntime(3600), '1 小时 0 分钟')
  assert.equal(formatDowntime(86399), '23 小时 59 分钟')
  assert.equal(formatDowntime(86400), '1 天')
  assert.equal(formatDowntime(86400 * 21 + 3600 * 5), '21 天')
})

test('首次开机：单句 note + marker 落盘；第二次开机：重启句；代码变更句只在 HEAD 变时出现', () => {
  const store = memStore()
  const marker = join(markerDir(), 'marker.json')
  const first = recordRestartEvent(store, { markerPath: marker, now: T0, clues: { head: 'aaaa1111bbbb' } })!
  assert.deepEqual(first.notes, ['这是你第一次醒来（没有更早的启动记录）。'])
  assert.equal(first.code_changed, false)
  assert.equal(first.previous_seen_at, null)

  // 同 HEAD 重启：无代码变更句。
  const second = recordRestartEvent(store, { markerPath: marker, now: T1, clues: { head: 'aaaa1111bbbb' } })!
  assert.deepEqual(second.notes, ['你重启了一次——之前是睡着的，现在醒了。'])

  // HEAD 变了 + downtime：三句齐（SA-163 逐字，含 8 位短 sha 与全角句号）。
  const third = recordRestartEvent(store, {
    markerPath: marker,
    now: T1,
    clues: { head: 'cccc2222dddd', downtime: formatDowntime(86400 * 3) },
  })!
  assert.deepEqual(third.notes, [
    '你重启了一次——之前是睡着的，现在醒了。',
    '期间 Kevin 改了你的代码（aaaa1111 → cccc2222）。',
    '大约停了 3 天。',
  ])
  assert.equal(third.code_changed, true)
  assert.equal(store.rows.length, 3)
  // SA-162：渲染 = notes 无分隔符拼接 + 外层方括号。
  assert.equal(
    renderRestartNotice(third),
    '[你重启了一次——之前是睡着的，现在醒了。期间 Kevin 改了你的代码（aaaa1111 → cccc2222）。大约停了 3 天。]',
  )
})

test('SA-164：读不到的线索省略绝不编造（无 head 无 downtime → 单句；坏 marker 当第一次）', () => {
  const store = memStore()
  const marker = join(markerDir(), 'marker.json')
  writeFileSync(marker, 'not json{{{', 'utf8') // 损坏 marker → 当没有更早的启动记录
  const event = recordRestartEvent(store, { markerPath: marker, now: T0 })!
  assert.deepEqual(event.notes, ['这是你第一次醒来（没有更早的启动记录）。'])
  assert.equal(event.head, null)
  assert.equal(event.downtime, null)
  assert.equal(event.invocation_id, null)
})

test('startup must never die on this：history 写失败 → restart_event_failed + null，不抛', () => {
  const events: string[] = []
  const broken: RestartStore = {
    appendHistory() {
      throw new Error('disk full')
    },
    getRecentHistoryOfType: () => [],
  }
  const out = recordRestartEvent(broken, {
    markerPath: join(markerDir(), 'marker.json'),
    now: T0,
    logEvent: (n) => events.push(n),
  })
  assert.equal(out, null)
  assert.deepEqual(events, ['restart_event_failed'])
})

test('latest/unprocessed（SA-165）：严格大于才算未处理；sinceIso=null → 最新即未处理；消化后不再浮出', () => {
  const store = memStore()
  const marker = join(markerDir(), 'marker.json')
  assert.equal(latestRestartEvent(store), null)
  assert.equal(unprocessedRestartEvent(store, null), null)

  recordRestartEvent(store, { markerPath: marker, now: T0 })
  const latest = latestRestartEvent(store)!
  assert.equal(latest.ts, T0.toISOString())

  assert.ok(unprocessedRestartEvent(store, null) !== null, '从未醒过 → 最新即未处理')
  const before = new Date(T0.getTime() - 1000).toISOString()
  assert.ok(unprocessedRestartEvent(store, before) !== null, '上次醒来早于事件 → 未处理')
  // ts == sinceIso：**不**算未处理（严格大于）。
  assert.equal(unprocessedRestartEvent(store, T0.toISOString()), null)
  assert.equal(unprocessedRestartEvent(store, T1.toISOString()), null)
})
