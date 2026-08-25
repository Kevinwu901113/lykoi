/**
 * 主动开口预算账本（shared/proactive_chat.py 逐字对应物；WO-NIGHT-01/B3）——
 * 比通知更紧：日 1 条、冷却 ≥6 小时。
 *
 * 执行点在 `autonomy.initiate_chat`（只经 kernel.dispatch 可达，origin=autonomous
 * 由 policy core 的 AUTONOMOUS_ALLOWED 放行 —— GK-12 的 8 项之一）；本模块是**账本
 * 与只读视图**，快照读 `remainingToday()` 做诚实呈现，不是执行层。上限是脑干层
 * 事实，调节场与模型输出都绕不过（红线 #5）。账本有界持久化，重启不清零。
 *
 * 住在 lykoi-kernel（CF-B1 非插件库模块）的理由：这条上限是治理事实而不是器官
 * 的实现细节 —— 快照侧（wake）与执行侧（M5 的 autonomy 器官）都够得着，且谁都
 * 改不动。**GK-13 受保护面重划（W4）时须把本文件与 interactive-lock.ts 一起
 * 判归属**：前者是 root 属主域的正当住户，后者只是单进程协调件。
 */
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

/**
 * 读账本（proactive_chat._load 逐字）。**坏账本按空处理**：最坏情况是多开一次
 * 口（仍受日 1 条上限），不值得为此拒启 —— 与 GK-2 的 pending 坏文件"照抄可见
 * 崩溃"刻意相反，两处各按活体原样（R-14 坏文件语义四档）。
 */
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

/** Python `ts[:10] == now.date().isoformat()`：ISO 串前 10 位的字面比较。 */
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
    // Python `(TypeError, ValueError) -> return None`：解析不了就不拦（宽），
    // 日上限那一层已经拦住了 —— 照抄。
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
