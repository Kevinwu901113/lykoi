/**
 * 种子 —— 出生证语义（P-D2 裁定；SA-166..168；W5 身份收口）。
 *
 * 两半（活体两处文件，语义各自逐字迁）：
 *
 * ① mind/seed.py —— TOML `interests.seeds` → origin='seed' concerns（蓝图 §3.2）。
 *    宪法定稿：种子起步，余下长出来。幂等的强形态（SA-166 逐字）：a seed title
 *    that has EVER existed as an origin='seed' concern — including a released
 *    one — is never re-inserted. 她在整合期放掉的种子不会被重启偷偷种回去；
 *    复活一个关切是她的判断，不是部署脚本的（红线 #3 的播种侧）。
 *
 * ② memory/seed.py —— 后天 insights 的起步种子。她是谁（名字/身体/所有者）
 *    如今在先天内核里，不再作 insight 播种 —— 那只会重复内核（SA-168）。
 *    后天层几乎空着出生，靠整合一点点长；这里只种从她第一句回话就值得知道的
 *    那一小撮 Kevin 偏好。upsert 按 (category, content) 去重，每次启动播种
 *    对已存在者是 no-op，never disturbs what she learns later。
 *
 * 接线纪律（mind/bootstrap.py:8-10 逐字方向）：seedConcerns 是显式的 owner 侧
 * 引导步骤（going live is an explicit owner-side step, not an import side
 * effect）—— **不**挂进任何 service 的启动路径；seedPersona 沿 surface/app.py
 * 的先例在对话面启动时调（首次 persona 投影之前）。
 */
import type { PersonaConfig } from './persona.ts'

// 初值,待观察期校准 —— 种子关切的出生权重（mind/seed.py:17；SA-167）
export const SEED_INITIAL_WEIGHT = 0.5

/** SA-167：描述固定文案（mind/seed.py:36 逐字）。 */
export const SEED_DESCRIPTION = '先天兴趣种子(来自人格 TOML)'

/** seedConcerns 的写依赖（lykoi-memory/rw 的结构化子集）。 */
export interface SeedConcernStore {
  /** 无参调用 = 全部状态**含 released**（SA-166 幂等强形态的读面前提）。 */
  listConcerns(status?: string | readonly string[]): { title: string; origin: string }[]
  createConcern(
    kind: string,
    title: string,
    opts: { weight: number; origin: string; description?: string; now: Date },
  ): number
}

/**
 * Plant any TOML seeds not yet present（mind/seed.py:20-41 逐字语义）。返回新建
 * 的 concern ids（首次之后每次运行都为空 —— 幂等）。
 */
export function seedConcerns(
  store: SeedConcernStore,
  persona: PersonaConfig,
  opts: { now: Date; logEvent?: (name: string, fields: Record<string, unknown>) => void },
): number[] {
  // SA-166：list_concerns() 无参数 = 全部状态含 released —— 曾经存在过的
  // seed title 永不重种。
  const existing = new Set(
    store.listConcerns().filter((row) => row.origin === 'seed').map((row) => row.title),
  )
  const created: number[] = []
  for (const title of persona.interests.seeds) {
    if (existing.has(title)) continue
    created.push(
      store.createConcern('interest', title, {
        weight: SEED_INITIAL_WEIGHT,
        origin: 'seed',
        description: SEED_DESCRIPTION,
        now: opts.now,
      }),
    )
  }
  if (created.length > 0) {
    opts.logEvent?.('mind_seeded', { count: created.length, ids: created })
  }
  return created
}

/** memory/seed.SEEDS 逐字：只有一条 preference（SA-168）。 */
export const MEMORY_SEEDS: readonly (readonly [string, string])[] = [
  ['preference', 'Kevin 用中文交流，技术术语用英文'],
]

/**
 * Insert the initial seeds if missing (idempotent). Returns the seed count.
 * （memory/seed.py:20-24 逐字；upsert 去重在库层。）
 */
export function seedPersona(
  store: { upsertInsight(category: string, content: string, opts: { now: Date }): number },
  opts: { now: Date },
): number {
  for (const [category, content] of MEMORY_SEEDS) {
    store.upsertInsight(category, content, { now: opts.now })
  }
  return MEMORY_SEEDS.length
}
