/**
 * 关切地板（WO-P4R-08 → mind/floor.py 移植；SA-173/174）。
 *
 * 打破 Phase 4 吸收态的确定性零 LLM 活性兜底：经验在场 + 无活吸收目标时，
 * 整合的每个操作都会被拒、叙事被空改写（narrative_only）。地板把
 * (active, dimming) 活性数在放干之前补到 FLOOR_N，让整合永远有目标可吸收。
 *
 * 铁律（floor.py 顶注逐字对应）：
 *  - **create-only 永不释放**（红线 #3）——未被点亮的地板关切靠自然老化降权，
 *    老化本身就是刻意的降权路径；
 *  - 计数只算 (active, dimming)、排除 dormant：mark_dimming_dormant 从不释放，
 *    含 dormant 的计数会对老化流失致盲；一次唤醒期检查同时覆盖释放流失与老化流失；
 *  - 代价不对称：多注入是有界的低权重噪声（会老化掉），少注入冒重新形成吸收态的
 *    风险 —— 所以地板维持的是 N 个**主动在场**的关切。
 *
 * 在 maintain 四写中的位置（SA-34）：紧跟 mark_dimming_dormant 之后（老化流失
 * 被覆盖）、整合读关切集之前（吸收目标始终存在）。
 */
import { ConcernCapError } from 'lykoi-memory/rw'
import type { SnapshotStore } from './index.ts'

/** 活性地板：维持 N 个主动在场的关切（暂定值，数据校准；SA-173）。 */
export const FLOOR_N = 2
/**
 * 低于有机权重出生（seed/grown 起点 0.5）：地板关切在 weight DESC 下沉底，
 * 只有她的整合点亮它才会爬升（毕业）。SA-173。
 */
export const FLOOR_BIRTH_WEIGHT = 0.25
/** 派生标题 = 线内容首个非空行，截 80 —— 够进整合信封（floor.py:43）。 */
const TITLE_MAX = 80

/**
 * narrative_threads.kind → concern.kind（floor.py:51-56 逐字）。线是叙事自己的
 * 结构化分解，映射成关切即得到零 NLP 的合法吸收目标。commitment → project
 * （一般情形；周期性承诺读起来像 ritual，但那个区分从行里推不出确定性，取一般
 * kind）。suspended_tension 是她悬着没解决的事 → question。
 */
export const THREAD_KIND_MAP: Readonly<Record<string, string>> = {
  open_question: 'question',
  commitment: 'project',
  suspended_tension: 'question',
  arc: 'interest',
}

/**
 * 最后手段的通用自我维护目标：仅当线 + 叙事都供不满 N 时使用。诚实的
 * origin='floor' 活性关切 —— 乏味但合法的吸收目标，不被点亮就老化掉。
 * (kind, title)（floor.py:61-65 逐字）。
 */
export const FALLBACK_TEMPLATES: readonly (readonly [string, string])[] = [
  ['question', '我现在最在意的是什么'],
  ['interest', '我最近在留意的事情'],
  ['ritual', '回到我搁置的关切'],
]

/** 确定性短标题：首个非空行（strip 后），按码点截到 TITLE_MAX（floor.py:68-71）。 */
export function titleFrom(content: string): string {
  const first = content.split('\n').map((ln) => ln.trim()).find((ln) => ln !== '')
    ?? content.trim()
  return [...first].slice(0, TITLE_MAX).join('')
}

/**
 * 按优先序产出 (kind, title, description) 吸收目标候选（SA-174）：
 * open/suspended 线（叙事的结构化分解）→ 显著的当前叙事 → 通用自我维护模板。
 * 确定性零 LLM：只有 store 读。generator 保持惰性（叙事只在线供不满时才读，
 * 与 Python 生成器的读取时序一致）。
 */
export function* floorCandidates(
  store: SnapshotStore,
): Generator<readonly [string, string, string]> {
  for (const thread of store.listThreads(['open', 'suspended'])) {
    const kind = THREAD_KIND_MAP[thread.kind] ?? 'question'
    yield [kind, titleFrom(thread.content), thread.content]
  }
  const narrative = store.currentCognitiveNarrative()
  if (narrative && (narrative.content || '').trim()) {
    yield ['interest', titleFrom(narrative.content), narrative.content]
  }
  for (const [kind, title] of FALLBACK_TEMPLATES) {
    yield [kind, title, '']
  }
}

/**
 * 把 (active, dimming) 活性数补到 FLOOR_N（floor.py maintain 对应物）。
 * 返回创建的 id（已达/超地板、或什么都派生不出时为空）。
 *
 * create-only（永不释放 —— 红线 #3）且零 LLM。地板处幂等：live >= N 即 no-op。
 * 去重按**已在场**（active/dimming）地板关切的 title：绝不铸造重复的活地板目标；
 * 只以 dormant 地板残骸存在的 title 可以被重新派生 —— 重新铸一个新的恢复活性
 * （dormant 残骸自己老化掉），代价不对称性偏向这一侧而不是饥饿侧。
 */
export function floorMaintain(store: SnapshotStore, now: Date): number[] {
  const liveRows = store.listConcerns(['active', 'dimming'])
  const live = liveRows.length
  const need = FLOOR_N - live
  if (need <= 0) return []
  const engagedFloorTitles = new Set(
    liveRows
      .filter((c) => c.origin === 'floor')
      .map((c) => c.title),
  )
  const created: number[] = []
  for (const [kind, title, description] of floorCandidates(store)) {
    if (created.length >= need) break
    if (engagedFloorTitles.has(title)) continue
    let cid: number
    try {
      cid = store.createConcern(kind, title, {
        description,
        weight: FLOOR_BIRTH_WEIGHT,
        origin: 'floor',
        now,
      })
    } catch (err) {
      if (err instanceof ConcernCapError) {
        // active == cap ⇒ 并不饥饿 ⇒ 正确的 no-op（防御位：(active,dimming)
        // 判据本已使这里不可达 —— floor.py:126-129 逐字）。
        break
      }
      throw err
    }
    created.push(cid)
    engagedFloorTitles.add(title)
  }
  return created
}
