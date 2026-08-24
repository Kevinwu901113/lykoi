/**
 * lykoi-heart — 心脏插件：唯一节律源（M2 波次 3 转正；W1 的影子策略升正体）。
 *
 * 策略正本：活体 cognition/heartbeat.py 顶注（WO-CB-01 步 1+2 的影子策略，
 * 本波按 DA-02/G-2 定案转正为唯一节律源）：
 *
 *     基线 = clamp(env LYKOI_HEARTBEAT_BASELINE_MIN, MIN_REST_MIN, MAX_REST_MIN)，默认 30 分钟。
 *     地板 = MIN_REST_MIN(5 分钟)：两次拍之间无论如何不得更近（G-8 拍间隔地板）。
 *     显著性 = 自上次拍以来 salience_shadow.shadow_log 中 id 大于游标且 selected=1
 *              的**新增**行数 >= SALIENCE_TRIGGER_N(3) → 提前拍，仍受地板约束（G-3）。
 *
 *     would_wake = 地板已过 且 (基线到期 或 显著性达标)；
 *     reason ∈ {baseline, salience}(真) / {floor, waiting}(假)。
 *
 * 三条硬纪律（转正后依旧全数成立）：
 * - **零 LLM**：模块里没有任何模型/传输层引用。
 * - **G-2 不读模型任何发言权输入**：不读 decision.next_wake_after_minutes（该
 *   字段已随 G-2 从 Decision 整体移除），不读 autonomy_state 任何列——转正体比
 *   影子件更彻底：对 memory.db **零接触**（影子件读 last_wake_at 作开机播种，
 *   是因为影子期刻意不持久化状态；步 3 转正后心脏拥有自己的持久状态，播种
 *   来源随之消失）。对 salience_shadow.db 只开只读连接 + PRAGMA query_only
 *   双层防写（heartbeat.py:166-181 同款）。
 * - **G-8 双护栏**（DA-08 语义并入新体形态）：
 *   (a) 自身状态损坏 fail-closed + 自愈 + 幂等报警——state 文件不可解析时不凭
 *       脏值起拍，把影子钟重写为「现在」（下一拍=默认基线拍），落
 *       `heart/state_unparseable`；自愈后的文件可解析，报警不重复。
 *   (b) 拍间隔地板与到期判定**串联**：would_wake 要求 floor_open 为真——哪怕
 *       显著性堆满、基线被 env 误配，两拍也不可能在 5 分钟内连发。地板就是
 *       既有 MIN_REST_MIN，不新设阈值：正常节律（基线 ≥ 地板）下基线到期时
 *       地板必已开，对节律零扰动。
 *
 * 开机首拍：无持久状态（首次部署）→ 影子钟回拨到「基线-地板」前，地板一过
 * （MIN_REST_MIN 后）即第一拍——对应活体 run_forever 的 first boot: wake soon
 * （autonomous.py:301-302）。游标与影子钟持久化在 dev 路径（config.stateFile，
 * 缺省 var/heart-state.json），重启不把历史 selected 行算成新增。
 *
 * 服务面沿 M1：只置位不消费；claim 合并（错过 N 拍一次醒，{beats: N} 可观测）；
 * 每拍落 audit 行。tick(now?) 是唯一的判定驱动口——起搏定时器每转调一次，
 * 测试传显式 now 驱动虚拟节律（时间是起搏输入，不是模型发言权）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {} from 'lykoi-audit'

// --- 常量（heartbeat.py:61-83 逐字；与活体调度同源，钉死不许漂移） -------------
export const MIN_REST_MIN = 5
export const MAX_REST_MIN = 360
export const DEFAULT_BASELINE_MIN = 30
export const BASELINE_ENV = 'LYKOI_HEARTBEAT_BASELINE_MIN'
export const SALIENCE_DB_ENV = 'LYKOI_SALIENCE_DB'
/**
 * 步 2 的唯一阈值（heartbeat.py:69-72 逐字）：自上次拍以来的**新增** selected=1
 * 行数达到它就算"有事发生"。3 而不是 1：salience_shadow 的日预算本身就是个位
 * 数量级，单条 selected 是常态，连着三条才是"这一段时间里确实堆了东西"。
 */
export const SALIENCE_TRIGGER_N = 3
/** 只读连接的等待上限（heartbeat.py:74-75）：心脏绝不能为一个读数挂住。 */
export const SALIENCE_TIMEOUT_S = 2.0

export const REASON_BASELINE = 'baseline'
export const REASON_SALIENCE = 'salience'
export const REASON_FLOOR = 'floor'
export const REASON_WAITING = 'waiting'

/**
 * 基线间隔（分钟），env 可调，夹逼到 [MIN_REST_MIN, MAX_REST_MIN]
 * （heartbeat.py:99-112 逐字）。非法/缺失一律回落默认值——一个打错的 env 不该
 * 把她冻在 6 小时一拍上，也不该把她推到 5 秒一拍（R-CA-1 要防的形态）。
 */
export function baselineMinutes(env: Record<string, string | undefined> = process.env): number {
  const raw = env[BASELINE_ENV]
  if (raw === undefined || !raw.trim()) return DEFAULT_BASELINE_MIN
  const value = Number.parseInt(raw.trim(), 10)
  if (Number.isNaN(value)) return DEFAULT_BASELINE_MIN
  return Math.max(MIN_REST_MIN, Math.min(MAX_REST_MIN, value))
}

// ============================== salience 读侧（G-3） ==============================

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

/**
 * salience_shadow.db 只读侧（heartbeat.py:162-220 对应物）。连接层 readOnly +
 * `PRAGMA query_only = 1` 双层防写；sidecar 是 WAL（STATE-CONTRACT §3.1），
 * 读不阻塞摄入侧的 BEGIN IMMEDIATE。查询是 `WHERE id > ?` 的尾部范围扫描
 * （id 是 rowid 别名），代价与表的历史大小无关。
 */
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
  /** null = 还没有状态（开机首拍）；'dirty' = 有文件但不可解析（G-8(a)）。 */
  load(): LoadedHeartState
  save(state: HeartState): void
  /** load() 返回 'dirty' 后可读的原始内容（报警行呈现用）。 */
  dirtyRaw(): string
}

/** JSON 文件持久化（原子写：同目录临时文件 + rename，R-12 手法）。 */
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

// ============================== 判定核（策略正体） ==============================

/** 一转的判定。纯数据，无副作用（heartbeat.py:86-96 Verdict 对应物）。 */
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

  /** 最近一次判定得出的下一拍时刻（对外可观测；G-2：只写不读的档案面）。 */
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
      // G-8(a)：fail-closed（不凭脏值起拍）+ 自愈（重写为可解析值 → 报警幂等）。
      this.#lastBeatAt = now
      this.#cursor = this.#salience?.readCursor() ?? null
      this.#persist()
      this.#alarm?.('state_unparseable', {
        value: this.#state.dirtyRaw().slice(0, 200),
        healed_to: this.#lastBeatAt.toISOString(),
      })
    } else if (loaded === null) {
      // 开机首拍 wake soon（autonomous.py:301-302 对应）：地板一过即第一拍。
      this.#lastBeatAt = new Date(now.getTime() - (baselineMinutes() - MIN_REST_MIN) * 60_000)
      this.#cursor = this.#salience?.readCursor() ?? null
      this.#persist()
    } else {
      // 未来时刻的影子钟（脏值/时钟 regime 切换）按"现在"处理——与 R-CA-1 自愈同向。
      this.#lastBeatAt = loaded.lastBeatAt.getTime() > now.getTime() ? now : loaded.lastBeatAt
      this.#cursor = loaded.cursor ?? this.#salience?.readCursor() ?? null
    }
  }

  /** 只在**状态翻转**时落一条——不可用不该按 tick 刷屏（heartbeat.py:222-234）。 */
  #noteSalienceHealth(ok: boolean): void {
    if (this.#salienceOk === ok) return
    const previous = this.#salienceOk
    this.#salienceOk = ok
    if (previous === null && ok) return // 首次读通是常态,不值得一条日志
    this.#alarm?.('salience', { available: ok })
  }

  /** 一次显著性探测（heartbeat.py:236-243）：还没播种成功过则再试一次拿游标。 */
  #probeSalience(): SalienceProbe | null {
    if (this.#salience === null) return null
    if (this.#cursor === null) {
      const cursor = this.#salience.readCursor()
      return cursor !== null ? { salientNew: 0, newCursor: cursor } : null
    }
    return this.#salience.salientSince(this.#cursor)
  }

  /** G-8(b) 地板读数（arouse 路径共用同一道闸）。 */
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

  /** 算这一转的判定（heartbeat.py:246-294 逐字策略）。 */
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

    // G-8(b)：地板与到期判定串联——salience 也过不了关着的地板。
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
  /** 提前拍的原因（'salience' = G-3 显著性触发；其余 = arouse 调用方语义）。 */
  reason?: string
  /** 本拍置位后的待处理拍数。 */
  pending: number
  /** 本拍时刻（ISO-8601 UTC）。 */
  at: string
}

export interface HeartService {
  /** 当前待处理拍数（只置位不消费的可观测面）。 */
  readonly pending: number
  /** 心脏自己的下一拍时刻（ISO；G-2：对外档案读数，心脏自己不回读）。 */
  readonly nextAt: string | null
  /** 取走全部待处理拍并清零。tick 合并：错过 N 拍返回 { beats: N }。 */
  claim(): { beats: number }
  /**
   * 一次判定转（起搏定时器每 checkIntervalMs 调一次；测试传显式 now 驱动
   * 虚拟节律）。would_wake 为真则置位 + emit + audit。
   */
  tick(now?: Date): HeartVerdict
  /** 显式提前拍：过 G-8 地板才拍；关着则落 heart/arouse_suppressed（不抛）。 */
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
  /** 判定转的驱动间隔（毫秒；活体 TICK_SECONDS=5.0 的对应）。 */
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
      // G-8(b)：地板是任何路径都过不去的硬刹车——显式拍也不例外。
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
