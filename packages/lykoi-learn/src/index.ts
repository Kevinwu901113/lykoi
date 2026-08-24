/**
 * lykoi-learn — 学习环 L1..L5（M2 波次 4）。
 *
 * 治理缺省的单包五模块布局：
 *   l1 分流判据（SA-83..88，纯函数叶子；lykoi-memory/rw 的经验写入点 import 它，
 *      方向与活体 mind/store.py → experience_class 一致）
 *   l2 整合（SA-89..108；G-4 墙钟锚）
 *   l3 相关性检索（SA-109..116；零写入）
 *   l4 专注思考（SA-117..140；SA-130 影子期周期序号例外）
 *   l5 建议队列入队侧（SA-141..147/152 铁律；问答侧归 kernel 对话面，M3/W5）
 *
 * 包边界（铁律的结构面）：src 的 import 面 = lykoi-regulation + 包内文件，
 * store 一律走结构化接口注入（boundary.test.ts 静态钉死）。
 */
export * from './shared.ts'
export * from './l1.ts'
export * from './l2.ts'
export * from './l3.ts'
export * from './l4.ts'
export * from './l5.ts'
