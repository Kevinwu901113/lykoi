/**
 * lykoi-learn/l1 — 档案层 / 原料池 分流判据（mind/experience_class.py 对应物，
 * 学习层 v2 设计 §3.1/§3.2；SA-83..88）。
 *
 * **唯一判据: 这条记录里有没有外部世界注入的新信息?**
 *
 * | source | 判定 | 依据（experience_class.py:5-13 逐字表） |
 * |---|---|---|
 * | conversation | 原料 | 与 Kevin 的交互,最高价值 |
 * | environment | 原料 | 关于 Kevin 生活的唯一来源(W1/W2 分期作废, §4.3) |
 * | action_result >80 字符 | 原料 | 例外通道:含实际返回内容 |
 * | action_result ≤80 字符 | 档案 | "ok/done" 级记账,零信息 |
 * | wake_action | 档案 | Kevin 定案 2:她的决策理由 = 思考轨迹,非外部输入（SA-85） |
 * | thought_lapse / silence | 档案 | 内部状态记录 |
 * | system / owner_event | 档案 | 兜底:判据只承认上表列出的原料来源 |
 *
 * 三条结构性约束（experience_class.py:15-23）：
 * 1. **纯函数**（SA-83）：只看 (source, content)，不读时钟/库/任何外部状态——
 *    "回填结果 == 重新分类结果"因此可单测证明。本模块零 import，是整个学习环
 *    的最底层叶子（lykoi-memory 的写层 import 它，方向与活体 mind/store.py
 *    import experience_class 一致）。
 * 2. **不改 experiences**（SA-86）：分类落影子表 experience_class；写入 SQL 在
 *    写层（lykoi-memory/rw 的经验写入点同事务 INSERT OR IGNORE，SA-88——先到者
 *    胜且两者答案相同因为 classify 是纯函数，忽略冲突是安全的不是掩盖错误）。
 * 3. **判据可升级**（SA-87）：每行带 RULE_VERSION；改 classify 的任何一条规则
 *    （含阈值）都必须 +1，否则新旧分类无法区分。
 *
 * 档案不是垃圾桶（设计 §7.4）：档案层永久保存、可检索,只是不进消化预算。
 * 历史回填（experience_class.backfill）不在本波移植——新体只认 mind_schema=16
 * 的已迁库（回填在活体由 _V11 迁移完成），数据迁移工装归 M4。
 */

export const WORKING = 'working'
export const ARCHIVE = 'archive'
export const CLASSES = [WORKING, ARCHIVE] as const
export type ExperienceClass = (typeof CLASSES)[number]

/** 无条件进原料池的来源——定义上就携带外部世界注入的新信息（SA-83 逐字二元集）。 */
export const WORKING_SOURCES: ReadonlySet<string> = new Set(['conversation', 'environment'])

/** 走"例外通道"的来源:同一来源里既有零信息模板、也有真实返回内容,只能按内容长度分。 */
export const LENGTH_GATED_SOURCES: ReadonlySet<string> = new Set(['action_result'])

/**
 * SA-84 阈值（experience_class.py:43-47 逐字理由）：活体 1573 条 action_result 中
 * 97% ≤80 字符、均长 29——那是 "ok"/"done"/"已发送" 一类的记账模板,零信息;
 * 超出模板长度的 43 条含实际返回内容,应进原料池。阈值卡在实测分布的断点上,
 * 不是拍脑袋的整数。判据是"内容里有没有信息",长度只是这一来源上信息量的
 * 可观测代理。**严格大于 80，按字符（码点）数不按字节**。
 */
export const ACTION_RESULT_MIN_LENGTH = 80

/** SA-87：判据版本。改动 classify() 的任何一条规则（含阈值）都必须 +1。 */
export const RULE_VERSION = 1

/**
 * SA-83：三行纯函数逐字。返回 'working'（进原料池）或 'archive'（进档案层）。
 *
 * 纯函数：同样的 (source, content) 永远给同样的答案,与调用时刻、数据库状态、
 * 进程状态都无关。历史回填和实时写入调用的是同一个它。
 *
 * content 允许 null/undefined（防御性：真实 schema 上 NOT NULL，但回填要能面对
 * 任何历史行），按空串处理——空壳 action_result 本来就是档案。
 * 长度按**字符**数（[...content].length = 码点数，对应 Python len(str)），
 * 与设计 §3.2 的实测口径一致（SA-84）。
 */
export function classifyExperience(source: string, content: string | null | undefined): ExperienceClass {
  if (WORKING_SOURCES.has(source)) return WORKING
  if (LENGTH_GATED_SOURCES.has(source) && [...(content ?? '')].length > ACTION_RESULT_MIN_LENGTH) {
    return WORKING
  }
  return ARCHIVE
}
