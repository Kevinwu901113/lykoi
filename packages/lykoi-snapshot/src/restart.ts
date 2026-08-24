/**
 * restart 自我意识（cognition/restart.py 对应物；SA-162..165；W5 身份收口）。
 *
 * Shutdown is sleep; waking is waking. Continuity here is NOT pretended
 * seamlessness — it is her SEEING the break and folding it into her own
 * narrative（restart.py:3-5 逐字）。启动时向 history 记**一条** restart 事件
 * （event_type="restart"），带上能读到的一切断裂线索；Unreadable clues are
 * OMITTED, never invented（SA-164）。It is material, not a script — she may
 * mention it or not。
 *
 * 两条消费路径（restart.py:17-20）：
 *  - 对话：latestRestartEvent —— 每进程生命周期建入她的上下文一次
 *    （lykoi-converse 的人格头装配）；
 *  - 自主：unprocessedRestartEvent —— 事件的 history ts **严格大于**她上次
 *    醒来才算未处理（SA-165），在重启后第一拍浮出，随后被消化。
 *
 * 新体形态适配（报告留痕）：活体自采线索（git HEAD 子进程、systemctl show
 * 的 downtime、INVOCATION_ID env）在新体是部署环境事实 —— 采集器归 M3 的
 * 生产接线；本模块把线索做成**显式入参**（clues），缺席即省略（与"读不到
 * 就省略"同向，且测试可注入）。downtime 的人话四档渲染（formatDowntime）
 * 逐字保留，供 M3 的 systemd 采集器复用（≥1 天只报天数 —— M4 停机切换在她
 * 眼里的粒度）。
 */
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

/**
 * downtime 的人话渲染（restart.py:104-111 逐字四档）。**≥1 天的档只报天数，
 * 丢弃小时** —— 这就是"长睡眠"在她眼里的粒度（SA-163）。
 */
export function formatDowntime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.trunc(seconds / 60)} 分钟`
  if (seconds < 86400) {
    return `${Math.trunc(seconds / 3600)} 小时 ${Math.trunc((seconds % 3600) / 60)} 分钟`
  }
  return `${Math.trunc(seconds / 86400)} 天`
}

/** 上次开机的标记（restart.py 的 MARKER_PATH 文件形态）。 */
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

/** R-12 手法的原子写（同目录临时文件 → rename）。 */
function writeMarkerAtomic(path: string, value: BootMarker): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.marker-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(tmp, JSON.stringify(value) + '\n', 'utf8')
  renameSync(tmp, path)
}

/** 环境可读的断裂线索（缺席即省略 —— SA-164：绝不编造）。 */
export interface RestartClues {
  /** 当前代码 HEAD（git 采集器归 M3；读不到 → null/省略）。 */
  head?: string | null
  /** 已渲染成人话的停机时长（formatDowntime 的产物；读不到 → null/省略）。 */
  downtime?: string | null
  /** systemd invocation id（读不到 → null/省略）。 */
  invocationId?: string | null
}

/**
 * 记一条 restart 事件 + 刷新开机标记（restart.py:157-205 逐字语义）。
 * once-per-boot 契约是**单一调用点**（对话面插件装载时），不是内部幂等守卫。
 * Best-effort end to end：任何失败只落 restart_event_failed 并返回 null ——
 * startup must never die on this。返回事件 content（也是写进 history 的值）。
 */
export function recordRestartEvent(
  store: RestartStore,
  opts: {
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

    // SA-163 三句模板逐字（restart.py:176-185）。
    const notes: string[] = []
    if (prev === null) {
      notes.push('这是你第一次醒来（没有更早的启动记录）。')
    } else {
      notes.push('你重启了一次——之前是睡着的，现在醒了。')
      if (codeChanged) {
        notes.push(`期间 Kevin 改了你的代码（${prevHead!.slice(0, 8)} → ${head!.slice(0, 8)}）。`)
      }
    }
    const downtime = opts.clues?.downtime ?? null
    if (downtime) {
      notes.push(`大约停了 ${downtime}。`)
    }

    // 字段序沿 Python dict 插入序（content JSON 的字节形态）。
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

/** 最近一条 restart 事件（已解析），或 null（restart.py:219-221）。 */
export function latestRestartEvent(store: RestartStore): RestartEvent | null {
  const rows = store.getRecentHistoryOfType(RESTART_EVENT_TYPE, 1)
  return parseEvent(rows[0])
}

/**
 * 她还没"醒进去"的最近一条 restart（restart.py:224-236 逐字）：history ts
 * **严格大于** sinceIso（她上次醒来）才算未处理；sinceIso 为 null（从未醒过）
 * → 最新那条即未处理（SA-165）。
 */
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
