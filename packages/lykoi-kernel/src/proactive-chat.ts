import { existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomic } from './jsonio.ts'
import { logEvent } from './telemetry.ts'

export function proactiveChatLedgerPath(): string {
  return process.env.LYKOI_PROACTIVE_CHAT_LEDGER ?? 'var/state/proactive_chat.json'
}

/** 主动开口每日上限（通知是 2）。 */
export const PROACTIVE_CHAT_DAILY_CAP = 1
/** 两次主动开口最小间隔（小时；通知是 2h）。 */
export const PROACTIVE_CHAT_COOLDOWN_H = 6.0
/** 账本有界：只留最近 N 次发送时刻。 */
const LEDGER_MAX_KEEP = 50

function _load(): string[] {
  const path = proactiveChatLedgerPath()
  if (!existsSync(path)) return []
  let data: unknown
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  return Array.isArray(data) ? data as string[] : []
}

function _todayCount(sent: readonly string[], now: Date): number {
  const day = now.toISOString().slice(0, 10)
  let n = 0
  for (const ts of sent) if (typeof ts === 'string' && ts.slice(0, 10) === day) n += 1
  return n
}

function _throttleReason(sent: readonly string[], now: Date): string | null {
  if (_todayCount(sent, now) >= PROACTIVE_CHAT_DAILY_CAP) return 'daily_cap'
  if (sent.length > 0) {
    const last = new Date(String(sent[sent.length - 1]))

    if (Number.isNaN(last.getTime())) return null
    if ((now.getTime() - last.getTime()) / 1000 < PROACTIVE_CHAT_COOLDOWN_H * 3600) {
      return 'cooldown'
    }
  }
  return null
}

/**
 * 原子地检查并占用一次主动开口份额（proactive_chat.try_send 逐字）。返回 null =
 * 占用成功（已记账），否则返回 throttle 原因（`daily_cap` | `cooldown`），不记账。
 */
export function trySend(now?: Date): string | null {
  const moment = now ?? new Date()
  const sent = _load()
  const reason = _throttleReason(sent, moment)
  if (reason !== null) {
    logEvent('proactive_chat_throttled', { reason })
    return reason
  }
  sent.push(moment.toISOString())
  writeJsonAtomic(proactiveChatLedgerPath(), sent.slice(-LEDGER_MAX_KEEP))
  return null
}

/** 今日还剩几次主动开口（只读视图，快照用；冷却由执行点兜底）。 */
export function proactiveRemainingToday(now?: Date): number {
  const moment = now ?? new Date()
  return Math.max(0, PROACTIVE_CHAT_DAILY_CAP - _todayCount(_load(), moment))
}
