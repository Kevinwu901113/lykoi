import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {} from 'lykoi-audit'

export const MIN_REST_MIN = 5
export const MAX_REST_MIN = 360
export const DEFAULT_BASELINE_MIN = 30
export const BASELINE_ENV = 'LYKOI_HEARTBEAT_BASELINE_MIN'
export const SALIENCE_DB_ENV = 'LYKOI_SALIENCE_DB'

export const SALIENCE_TRIGGER_N = 3

export const SALIENCE_TIMEOUT_S = 2.0

export const REASON_BASELINE = 'baseline'
export const REASON_SALIENCE = 'salience'
export const REASON_FLOOR = 'floor'
export const REASON_WAITING = 'waiting'

export function baselineMinutes(env: Record<string, string | undefined> = process.env): number {
  const raw = env[BASELINE_ENV]
  if (raw === undefined || !raw.trim()) return DEFAULT_BASELINE_MIN
  const value = Number.parseInt(raw.trim(), 10)
  if (Number.isNaN(value)) return DEFAULT_BASELINE_MIN
  return Math.max(MIN_REST_MIN, Math.min(MAX_REST_MIN, value))
}

export interface SalienceProbe {
  salientNew: number
  newCursor: number
}

/** 显著性输入的读面（sidecar 缺席/读不通一律 null——fail-quiet 回落纯基线）。 */
export interface SalienceReader {
  /** 当前 shadow_log 最大 id（播种用：开机不把历史算成"新增"）。 */
  readCursor(): number | null
  /** (新增 selected=1 行数, 新游标)；读不到返回 null。 */
  salientSince(cursor: number): SalienceProbe | null
}

export class SalienceReadSide implements SalienceReader {
  #path: string

  constructor(path: string) {
    this.#path = path
  }

  #connect(): DatabaseSync | null {
    try {
      const db = new DatabaseSync(this.#path, { readOnly: true })
      db.exec('PRAGMA query_only = 1') // 第二道：即便 readOnly 被绕过也写不了
      db.exec(`PRAGMA busy_timeout = ${Math.trunc(SALIENCE_TIMEOUT_S * 1000)}`)
      return db
    } catch {
      return null
    }
  }

  readCursor(): number | null {
    const db = this.#connect()
    if (db === null) return null
    try {
      const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM shadow_log').get() as
        | { cursor: number | bigint }
        | undefined
      return row === undefined ? null : Number(row.cursor)
    } catch {
      return null
    } finally {
      db.close()
    }
  }

  salientSince(cursor: number): SalienceProbe | null {
    const db = this.#connect()
    if (db === null) return null
    try {
      const row = db.prepare(
        'SELECT COALESCE(MAX(id), ?) AS next_cursor, COALESCE(SUM(selected), 0) AS salient '
        + 'FROM shadow_log WHERE id > ?',
      ).get(cursor, cursor) as { next_cursor: number | bigint; salient: number | bigint } | undefined
      if (row === undefined) return null
      return { salientNew: Number(row.salient), newCursor: Number(row.next_cursor) }
    } catch {
      return null
    } finally {
      db.close()
    }
  }
}

// ============================== 心脏持久状态（游标+影子钟，dev 路径） ==============================

export interface HeartState {
  lastBeatAt: Date
  cursor: number | null
}

export type LoadedHeartState = HeartState | 'dirty' | null

export interface HeartStateStore {

  load(): LoadedHeartState
  save(state: HeartState): void
  /** load() 返回 'dirty' 后可读的原始内容（报警行呈现用）。 */
  dirtyRaw(): string
}

export class FileHeartState implements HeartStateStore {
  #path: string
  #dirtyRaw = ''

  constructor(path: string) {
    this.#path = path
  }

  load(): LoadedHeartState {
    let raw: string
    try {
      raw = readFileSync(this.#path, 'utf8')
    } catch {
      return null // 文件不存在 = 开机首拍，不是脏值（"那不是脏值,那是还没定过"）
    }
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      const at = new Date(String(data.last_beat_at))
      if (Number.isNaN(at.getTime())) throw new Error('unparseable last_beat_at')
      const cursor = data.cursor
      if (cursor !== null && (typeof cursor !== 'number' || !Number.isInteger(cursor))) {
        throw new Error('unparseable cursor')
      }
      return { lastBeatAt: at, cursor: cursor as number | null }
    } catch {
      this.#dirtyRaw = raw
      return 'dirty'
    }
  }

  save(state: HeartState): void {
    mkdirSync(dirname(this.#path), { recursive: true })
    const tmp = `${this.#path}.tmp`
    writeFileSync(tmp, JSON.stringify({
      last_beat_at: state.lastBeatAt.toISOString(),
      cursor: state.cursor,
    }))
    renameSync(tmp, this.#path)
  }

  dirtyRaw(): string {
    return this.#dirtyRaw
  }
}

export interface HeartVerdict {
  wouldWake: boolean
  reason: string
  /** 心脏自己的下一拍时刻（ISO）。 */
  nextAt: string
  baselineMin: number
  /** 本次窗口新增的 selected=1 行数（未启用/读不到时 0）。 */
  salientNew: number
  /** 显著性读侧这次读通了没有（未启用时恒 true：无事可失败）。 */
  salienceOk: boolean
}

export type HeartAlarm = (name: string, fields: Record<string, unknown>) => void

export class HeartCore {
  #state: HeartStateStore
  #salience: SalienceReader | null
  #alarm: HeartAlarm | undefined
  #lastBeatAt: Date | null = null
  #cursor: number | null = null
  #seeded = false
  #salienceOk: boolean | null = null // null = 还没试过;用于翻转才落日志
  #nextAt: string | null = null

  constructor(opts: { state: HeartStateStore; salience?: SalienceReader | null; alarm?: HeartAlarm }) {
    this.#state = opts.state
    this.#salience = opts.salience ?? null
    this.#alarm = opts.alarm
  }

  get nextAt(): string | null {
    return this.#nextAt
  }

  #persist(): void {
    this.#state.save({ lastBeatAt: this.#lastBeatAt!, cursor: this.#cursor })
  }

  #seed(now: Date): void {
    this.#seeded = true
    const loaded = this.#state.load()
    if (loaded === 'dirty') {

      this.#lastBeatAt = now
      this.#cursor = this.#salience?.readCursor() ?? null
      this.#persist()
      this.#alarm?.('state_unparseable', {
        value: this.#state.dirtyRaw().slice(0, 200),
        healed_to: this.#lastBeatAt.toISOString(),
      })
    } else if (loaded === null) {

      this.#lastBeatAt = new Date(now.getTime() - (baselineMinutes() - MIN_REST_MIN) * 60_000)
      this.#cursor = this.#salience?.readCursor() ?? null
      this.#persist()
    } else {

      this.#lastBeatAt = loaded.lastBeatAt.getTime() > now.getTime() ? now : loaded.lastBeatAt
      this.#cursor = loaded.cursor ?? this.#salience?.readCursor() ?? null
    }
  }

  #noteSalienceHealth(ok: boolean): void {
    if (this.#salienceOk === ok) return
    const previous = this.#salienceOk
    this.#salienceOk = ok
    if (previous === null && ok) return // 首次读通是常态,不值得一条日志
    this.#alarm?.('salience', { available: ok })
  }

  #probeSalience(): SalienceProbe | null {
    if (this.#salience === null) return null
    if (this.#cursor === null) {
      const cursor = this.#salience.readCursor()
      return cursor !== null ? { salientNew: 0, newCursor: cursor } : null
    }
    return this.#salience.salientSince(this.#cursor)
  }

  floorOpen(now: Date): boolean {
    if (!this.#seeded) this.#seed(now)
    const last = this.#lastBeatAt ?? now
    return now.getTime() - last.getTime() >= MIN_REST_MIN * 60_000
  }

  /** 显式拍（arouse 通过地板后）：影子钟+游标推进并持久化。 */
  consumeExplicitBeat(now: Date): void {
    if (!this.#seeded) this.#seed(now)
    this.#lastBeatAt = now
    const probe = this.#probeSalience()
    if (probe !== null) this.#cursor = probe.newCursor
    this.#nextAt = new Date(now.getTime() + baselineMinutes() * 60_000).toISOString()
    this.#persist()
  }

  evaluate(now: Date): HeartVerdict {
    if (!this.#seeded) this.#seed(now)
    const last = this.#lastBeatAt ?? now
    const baseline = baselineMinutes()

    const elapsedMs = now.getTime() - last.getTime()
    const floorOpen = elapsedMs >= MIN_REST_MIN * 60_000
    const baselineDue = elapsedMs >= baseline * 60_000

    let salientNew = 0
    let newCursor = this.#cursor
    let salienceOk = true
    if (this.#salience !== null) {
      const probe = this.#probeSalience()
      this.#noteSalienceHealth(probe !== null)
      salienceOk = probe !== null
      if (probe !== null) {
        salientNew = probe.salientNew
        newCursor = probe.newCursor
      }
    }

    const salienceDue = floorOpen && salientNew >= SALIENCE_TRIGGER_N

    let wouldWake: boolean
    let reason: string
    if (!floorOpen) {
      wouldWake = false
      reason = REASON_FLOOR
    } else if (baselineDue) {
      wouldWake = true
      reason = REASON_BASELINE
    } else if (salienceDue) {
      wouldWake = true
      reason = REASON_SALIENCE
    } else {
      wouldWake = false
      reason = REASON_WAITING
    }

    let nextAt: Date
    if (wouldWake) {
      // 心脏消费掉自己的这一拍：影子钟推进 + 游标推进（+持久化，重启安全）。
      this.#lastBeatAt = now
      this.#cursor = newCursor
      this.#persist()
      nextAt = new Date(now.getTime() + baseline * 60_000)
    } else {
      nextAt = new Date(last.getTime() + baseline * 60_000)
    }
    this.#nextAt = nextAt.toISOString()

    return {
      wouldWake,
      reason,
      nextAt: this.#nextAt,
      baselineMin: baseline,
      salientNew,
      salienceOk,
    }
  }
}

// ============================== 插件面（服务契约沿 M1） ==============================

export interface HeartBeatPayload {
  /** 'interval' = 基线拍；'arouse' = 显著性/显式提前拍。 */
  source: 'interval' | 'arouse'

  reason?: string
  /** 本拍置位后的待处理拍数。 */
  pending: number
  /** 本拍时刻（ISO-8601 UTC）。 */
  at: string
}

export interface HeartService {
  /** 当前待处理拍数（只置位不消费的可观测面）。 */
  readonly pending: number

  readonly nextAt: string | null
  /** 取走全部待处理拍并清零。tick 合并：错过 N 拍返回 { beats: N }。 */
  claim(): { beats: number }
  /**
   * 一次判定转（起搏定时器每 checkIntervalMs 调一次；测试传显式 now 驱动
   * 虚拟节律）。would_wake 为真则置位 + emit + audit。
   */
  tick(now?: Date): HeartVerdict

  arouse(reason: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    heart: HeartService
  }
  interface Events {
    'heart/beat'(payload: HeartBeatPayload): void
  }
}

export const name = 'lykoi-heart'
// 每拍必须能落审计（M1 验收线沿用：心脏在跳、每拍过 audit）。
export const inject = ['audit']

export interface Config {

  checkIntervalMs: number
  /** 游标+影子钟持久化路径（dev 路径；相对进程 cwd 解析）。 */
  stateFile: string
  /** salience_shadow.db 路径；'' = 显著性输入未接（纯基线）。env LYKOI_SALIENCE_DB 优先。 */
  salienceDb: string
}

export const Config: Schema<Config> = Schema.object({
  checkIntervalMs: Schema.number().default(5_000),
  stateFile: Schema.string().default('var/heart-state.json'),
  salienceDb: Schema.string().default(''),
})

export function apply(ctx: Context, config: Config) {
  let pending = 0

  const alarm: HeartAlarm = (alarmName, fields) => {
    // 报警落 audit；写失败记错误日志但不停搏（TODO(M3) 同 beat：fail-closed 层级由治理定）。
    ctx.audit.record({ type: `heart/${alarmName}`, ...fields }).catch((err) => {
      ctx.logger.error('lykoi-heart: audit record failed for %s: %s', alarmName, String(err))
    })
  }

  const saliencePath = process.env[SALIENCE_DB_ENV] || config.salienceDb
  const core = new HeartCore({
    state: new FileHeartState(resolve(config.stateFile)),
    salience: saliencePath ? new SalienceReadSide(saliencePath) : null,
    alarm,
  })

  const beat = (source: HeartBeatPayload['source'], reason: string | undefined, at: Date): void => {
    // 只置位不消费：心脏永远不动 pending 的消费端。
    pending += 1
    const payload: HeartBeatPayload = {
      source,
      ...(reason === undefined ? {} : { reason }),
      pending,
      at: at.toISOString(),
    }
    ctx.emit('heart/beat', payload)
    // 每拍落 audit 行（M1 验收线）。写失败记错误日志但不停拍：
    // TODO(M3): audit 持续写失败时心脏是否停搏（fail-closed 到什么层级）由治理移植定。
    ctx.audit.record({ type: 'heart/beat', ...payload }).catch((err) => {
      ctx.logger.error('lykoi-heart: audit record failed for beat: %s', String(err))
    })
  }

  const heart: HeartService = {
    get pending() {
      return pending
    },
    get nextAt() {
      return core.nextAt
    },
    claim() {
      // tick 合并：一次取走全部积压拍（错过 N 拍一次醒）。
      const beats = pending
      pending = 0
      return { beats }
    },
    tick(now?: Date) {
      const moment = now ?? new Date()
      const verdict = core.evaluate(moment)
      if (verdict.wouldWake) {
        beat(
          verdict.reason === REASON_SALIENCE ? 'arouse' : 'interval',
          verdict.reason === REASON_SALIENCE ? 'salience' : undefined,
          moment,
        )
      }
      return verdict
    },
    arouse(reason: string) {
      const moment = new Date()

      if (!core.floorOpen(moment)) {
        alarm('arouse_suppressed', { reason, next_at: core.nextAt })
        return
      }
      core.consumeExplicitBeat(moment)
      beat('arouse', reason, moment)
    },
  }

  // 副作用经 ctx.effect 可逆：fiber 卸载 → disposer 清定时器 → 停拍。
  ctx.effect(() => {
    const timer = setInterval(() => heart.tick(), config.checkIntervalMs)
    return () => clearInterval(timer)
  }, 'lykoi-heart pacemaker')

  ctx.provide('heart', heart)
}
