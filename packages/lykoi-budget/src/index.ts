/**
 * lykoi-budget — 治理地基②：费用硬顶。
 *
 * 蓝图（docs/m1_blueprint.md 包布局）：route 会计 + run 归因 + 前置闸；
 * 每次 LLM 调用必经；超顶拒调并落审计；按 UTC 日滚动，per-route + 总量两层。
 *
 * - `budget.charge({route, runId, promptTokens, completionTokens})` 记账：
 *   按 route 累计到当日（UTC）桶，落 audit 行，账本持久化（原子写：临时文件+rename，
 *   手法对齐 WO-M0-STATE-CONTRACT R-12：同目录临时文件 + fsync + rename）。
 * - `budget.gate(route)` 前置闸：当日用量已达 per-route 或总量硬顶即抛
 *   BudgetExceeded（拒调本身也落审计）。
 * - 账本损坏当空，但仍受当日硬顶保护（损坏不解除任何闸）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { AuditService } from 'lykoi-audit'
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdir, open, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface ChargeInput {
  /** 计费路由（与 dsh-llm 的 provider route 同词汇）。 */
  route: string
  /** run 归因：这次消耗属于哪一次运行/决策周期。 */
  runId: string
  promptTokens: number
  completionTokens: number
}

/** 超过硬顶时 gate 抛出的错误。 */
export class BudgetExceeded extends Error {
  override readonly name = 'BudgetExceeded'
  readonly scope: 'route' | 'total'
  readonly route: string
  readonly day: string
  readonly used: number
  readonly cap: number

  constructor(scope: 'route' | 'total', route: string, day: string, used: number, cap: number) {
    super(
      `budget hard cap exceeded (${scope}): route=${route} day=${day} used=${used} cap=${cap}`,
    )
    this.scope = scope
    this.route = route
    this.day = day
    this.used = used
    this.cap = cap
  }
}

interface DayBucket {
  totalTokens: number
  routes: Record<string, number>
}

interface Ledger {
  version: 1
  days: Record<string, DayBucket>
}

export interface BudgetCaps {
  /** 当日（UTC）全部 route 合计 token 硬顶。 */
  dailyTotalTokens: number
  /** 当日（UTC）per-route token 硬顶；未列出的 route 只受总量层约束。 */
  dailyRouteTokens: Record<string, number>
}

export interface BudgetService {
  gate(route: string): Promise<void>
  charge(input: ChargeInput): Promise<void>
  /** 只读观测：当日（UTC）用量。 */
  usage(route?: string): { day: string; totalTokens: number; routeTokens: number }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    budget: BudgetService
  }
}

function emptyLedger(): Ledger {
  return { version: 1, days: {} }
}

function assertTokenCount(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`lykoi-budget: ${field} must be a finite non-negative number`)
  }
}

/**
 * 账本核心。与 cordis 解耦以便测试直接注入 audit/时钟；
 * 插件层（apply）负责接线。
 */
export class BudgetAccountant implements BudgetService {
  #audit: AuditService
  #warn: (message: string) => void
  #ledgerPath: string
  #caps: BudgetCaps
  #now: () => number
  #ledger: Ledger = emptyLedger()
  #persistTail: Promise<unknown> = Promise.resolve()
  #tmpSeq = 0

  constructor(options: {
    audit: AuditService
    warn: (message: string) => void
    ledgerPath: string
    caps: BudgetCaps
    /** 时钟注入位：仅测试用（跨日复位红测）；生产走 Date.now。 */
    now?: () => number
  }) {
    this.#audit = options.audit
    this.#warn = options.warn
    this.#ledgerPath = resolve(options.ledgerPath)
    this.#caps = options.caps
    this.#now = options.now ?? Date.now
  }

  /** UTC 日滚动窗口的键：YYYY-MM-DD（蓝图：按 UTC 日滚动）。 */
  #utcDay(): string {
    return new Date(this.#now()).toISOString().slice(0, 10)
  }

  #bucket(day: string): DayBucket {
    return (this.#ledger.days[day] ??= { totalTokens: 0, routes: {} })
  }

  /**
   * 启动时装载账本。损坏（读不出/解析不了/形状不对）一律当空——
   * 但当日硬顶继续生效：当空只清历史计数，不解除任何闸。
   */
  load(): void {
    let raw: string
    try {
      raw = readFileSync(this.#ledgerPath, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        this.#warn(`lykoi-budget: ledger unreadable (${String(err)}); treating as empty`)
      }
      this.#ledger = emptyLedger()
      return
    }
    try {
      const parsed = JSON.parse(raw) as Ledger
      if (parsed === null || typeof parsed !== 'object' || parsed.version !== 1
        || parsed.days === null || typeof parsed.days !== 'object') {
        throw new Error('unexpected ledger shape')
      }
      for (const bucket of Object.values(parsed.days)) {
        if (typeof bucket?.totalTokens !== 'number' || bucket.routes === null
          || typeof bucket.routes !== 'object') {
          throw new Error('unexpected day bucket shape')
        }
      }
      this.#ledger = parsed
    } catch (err) {
      this.#warn(`lykoi-budget: ledger corrupt (${String(err)}); treating as empty`)
      this.#ledger = emptyLedger()
    }
  }

  usage(route?: string): { day: string; totalTokens: number; routeTokens: number } {
    const day = this.#utcDay()
    const bucket = this.#ledger.days[day]
    return {
      day,
      totalTokens: bucket?.totalTokens ?? 0,
      routeTokens: route === undefined ? 0 : bucket?.routes[route] ?? 0,
    }
  }

  /**
   * 前置闸：调用发生之前必须过闸。当日用量已达硬顶（>= cap，顶=耗尽）即拒，
   * 拒调落审计后抛 BudgetExceeded。两层：per-route 先查，总量后查。
   */
  async gate(route: string): Promise<void> {
    if (typeof route !== 'string' || route.length === 0) {
      throw new TypeError('lykoi-budget: gate(route) requires a non-empty route')
    }
    const day = this.#utcDay()
    const bucket = this.#ledger.days[day]
    const routeUsed = bucket?.routes[route] ?? 0
    const totalUsed = bucket?.totalTokens ?? 0

    let refusal: BudgetExceeded | null = null
    const routeCap = this.#caps.dailyRouteTokens[route]
    if (routeCap !== undefined && routeUsed >= routeCap) {
      refusal = new BudgetExceeded('route', route, day, routeUsed, routeCap)
    } else if (totalUsed >= this.#caps.dailyTotalTokens) {
      refusal = new BudgetExceeded('total', route, day, totalUsed, this.#caps.dailyTotalTokens)
    }
    if (refusal) {
      // 蓝图：「超顶拒调并落审计」。审计失败也不放行——两条路都是拒（fail-closed）。
      await this.#audit.record({
        type: 'budget/refusal',
        scope: refusal.scope,
        route,
        day,
        used: refusal.used,
        cap: refusal.cap,
      })
      throw refusal
    }
  }

  /**
   * 记账（调用后必经）。顺序：内存累计 → 账本持久化 → 落 audit；
   * 任何一步失败都抛给调用方，但内存计数保留（保护方向：宁可多算，不可漏算）。
   */
  async charge(input: ChargeInput): Promise<void> {
    if (typeof input?.route !== 'string' || input.route.length === 0) {
      throw new TypeError('lykoi-budget: charge requires a non-empty route')
    }
    if (typeof input.runId !== 'string' || input.runId.length === 0) {
      throw new TypeError('lykoi-budget: charge requires a non-empty runId')
    }
    assertTokenCount(input.promptTokens, 'promptTokens')
    assertTokenCount(input.completionTokens, 'completionTokens')

    const day = this.#utcDay()
    const tokens = input.promptTokens + input.completionTokens
    const bucket = this.#bucket(day)
    bucket.totalTokens += tokens
    bucket.routes[input.route] = (bucket.routes[input.route] ?? 0) + tokens

    await this.#persist()
    await this.#audit.record({
      type: 'budget/charge',
      route: input.route,
      runId: input.runId,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      day,
      dayRouteTokens: bucket.routes[input.route],
      dayTotalTokens: bucket.totalTokens,
    })
  }

  /**
   * 原子写（进程内串行）：同目录临时文件 → 写全量 JSON → fsync → rename。
   * 手法对齐 R-12（临时文件不 fsync 就 rename 会在断电时留下空账本）。
   */
  #persist(): Promise<void> {
    const prev = this.#persistTail
    const job = (async () => {
      await prev.catch(() => {})
      const dir = dirname(this.#ledgerPath)
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `.tmp-budget-${process.pid}-${this.#tmpSeq++}.json`)
      const data = JSON.stringify(this.#ledger, null, 2) + '\n'
      const handle = await open(tmp, 'w')
      try {
        await handle.writeFile(data, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tmp, this.#ledgerPath)
    })()
    this.#persistTail = job.catch(() => {})
    return job
  }
}

export const name = 'lykoi-budget'
// 治理地基②依赖①：记账与拒调都必须能落审计。
export const inject = ['audit']

export interface Config {
  /** 账本 JSON 路径（相对进程 cwd 解析）。M1 dev 默认 var/budget.json。 */
  ledgerPath: string
  dailyTotalTokens: number
  dailyRouteTokens: Record<string, number>
}

export const Config: Schema<Config> = Schema.object({
  ledgerPath: Schema.string().default('var/budget.json'),
  // TODO(蓝图纪律 2「不发明」): 默认硬顶数值是占位（dev 保护值），生产硬顶由
  // 治理侧在 profile/patch 层显式配置；M3 治理移植时定正式数值与调整流程。
  dailyTotalTokens: Schema.number().default(1_000_000),
  dailyRouteTokens: Schema.dict(Schema.number()).default({}),
})

export function apply(ctx: Context, config: Config) {
  // 账本目录先立起来，装载路径的失败在启动期暴露而非首次记账时。
  mkdirSync(dirname(resolve(config.ledgerPath)), { recursive: true })
  const accountant = new BudgetAccountant({
    audit: ctx.audit,
    warn: (message) => ctx.logger.warn(message),
    ledgerPath: config.ledgerPath,
    caps: {
      dailyTotalTokens: config.dailyTotalTokens,
      dailyRouteTokens: config.dailyRouteTokens,
    },
  })
  accountant.load()
  ctx.provide('budget', accountant)
}
