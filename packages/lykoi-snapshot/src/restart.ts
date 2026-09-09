import { readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { formatPyIso } from 'lykoi-memory/rw'
import type { RestartEvent } from './index.ts'

export const RESTART_EVENT_TYPE = 'restart'

/** restart 读写的 store 面（lykoi-memory/rw 的结构化子集）。 */
export interface RestartStore {
  appendHistory(eventType: string, content: string, opts: { now: Date }): number
  getRecentHistoryOfType(eventType: string, n: number): { ts: string; content: string }[]
}

export function formatDowntime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.trunc(seconds / 60)} 分钟`
  if (seconds < 86400) {
    return `${Math.trunc(seconds / 3600)} 小时 ${Math.trunc((seconds % 3600) / 60)} 分钟`
  }
  return `${Math.trunc(seconds / 86400)} 天`
}

interface BootMarker {
  head?: string | null
  invocation_id?: string | null
  recorded_at?: string | null
}

function readMarker(path: string): BootMarker | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as BootMarker
  } catch {
    return null
  }
}

function writeMarkerAtomic(path: string, value: BootMarker): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.marker-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(tmp, JSON.stringify(value) + '\n', 'utf8')
  renameSync(tmp, path)
}

export interface RestartClues {
  /** 当前代码 HEAD（git 采集器归 M3；读不到 → null/省略）。 */
  head?: string | null
  /** 已渲染成人话的停机时长（formatDowntime 的产物；读不到 → null/省略）。 */
  downtime?: string | null
  /** systemd invocation id（读不到 → null/省略）。 */
  invocationId?: string | null
}

export function recordRestartEvent(
  store: RestartStore,
  opts: {
    ownerName?: string
    markerPath: string
    now: Date
    clues?: RestartClues
    logEvent?: (name: string, fields: Record<string, unknown>) => void
  },
): Record<string, unknown> | null {
  try {
    const prev = readMarker(opts.markerPath)
    const head = opts.clues?.head ?? null
    const invocationId = opts.clues?.invocationId ?? null
    const prevHead = prev?.head ?? null
    const prevSeen = prev?.recorded_at ?? null
    const codeChanged = Boolean(prevHead && head && prevHead !== head)

    const notes: string[] = []
    if (prev === null) {
      notes.push('这是你第一次醒来（没有更早的启动记录）。')
    } else {
      notes.push('你重启了一次——之前是睡着的，现在醒了。')
      if (codeChanged) {
        notes.push(`期间 ${opts.ownerName ?? '所有者'} 改了你的代码（${prevHead!.slice(0, 8)} → ${head!.slice(0, 8)}）。`)
      }
    }
    const downtime = opts.clues?.downtime ?? null
    if (downtime) {
      notes.push(`大约停了 ${downtime}。`)
    }

    const content: Record<string, unknown> = {
      woke_at: formatPyIso(opts.now),
      previous_seen_at: prevSeen,
      downtime,
      head,
      previous_head: prevHead,
      code_changed: codeChanged,
      invocation_id: invocationId,
      notes,
    }
    store.appendHistory(RESTART_EVENT_TYPE, JSON.stringify(content), { now: opts.now })
    writeMarkerAtomic(opts.markerPath, {
      head, invocation_id: invocationId, recorded_at: formatPyIso(opts.now),
    })
    opts.logEvent?.('restart_event_recorded', { code_changed: codeChanged, downtime })
    return content
  } catch (exc) {
    opts.logEvent?.('restart_event_failed', {
      error: exc instanceof Error ? exc.message : String(exc),
    })
    return null
  }
}

function parseEvent(row: { ts: string; content: string } | undefined): RestartEvent | null {
  if (!row) return null
  let content: unknown
  try {
    content = JSON.parse(row.content)
  } catch {
    return null
  }
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null
  const event = content as RestartEvent
  event.ts = row.ts
  return event
}

export function latestRestartEvent(store: RestartStore): RestartEvent | null {
  const rows = store.getRecentHistoryOfType(RESTART_EVENT_TYPE, 1)
  return parseEvent(rows[0])
}

export function unprocessedRestartEvent(
  store: RestartStore,
  sinceIso: string | null,
): RestartEvent | null {
  const event = latestRestartEvent(store)
  if (event === null) return null
  if (sinceIso === null) return event
  const ts = event.ts
  if (typeof ts === 'string' && ts > sinceIso) return event
  return null
}
