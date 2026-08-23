/**
 * lykoi-heart — 心脏插件：基线心跳。
 *
 * 蓝图（docs/m1_blueprint.md 包布局 + 波次 1）：
 * - 基线心跳「只置位不消费」：每拍 emit `heart/beat` 并把待处理拍计数 +1；
 *   消费者调 `heart.claim()` 取走并清零。
 * - tick 合并语义：错过 N 拍，claim 一次返回 { beats: N }，计数可观测
 *   （`heart.pending` 只读暴露当前置位数）。
 * - 显著性唤醒接口位：`heart.arouse(reason)` 立即置位并 emit（M2 接 salience）。
 * - 全部副作用经 ctx.effect 可逆：fiber 卸载即停拍。
 * - M1 验收线「每拍落 audit 行」：心跳对 audit 是硬依赖（inject），每拍 record 一行。
 *
 * 架构语义正本：白皮书 v1.2 第 37 章（心脏—大脑—器官）；心脏只起搏，不思考。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from 'lykoi-audit'

export interface HeartBeatPayload {
  /** 'interval' = 基线起搏；'arouse' = 显著性唤醒提前拍。 */
  source: 'interval' | 'arouse'
  /** arouse 的原因（M2 salience 接管此语义）。 */
  reason?: string
  /** 本拍置位后的待处理拍数。 */
  pending: number
  /** 本拍时刻（ISO-8601 UTC）。 */
  at: string
}

export interface HeartService {
  /** 当前待处理拍数（只置位不消费的可观测面）。 */
  readonly pending: number
  /** 取走全部待处理拍并清零。tick 合并：错过 N 拍返回 { beats: N }。 */
  claim(): { beats: number }
  /** 显著性唤醒接口位：立即置位并 emit（不等下一个 interval）。 */
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
// 每拍必须能落审计（M1 验收：心跳在跳、每拍过 audit）。
export const inject = ['audit']

export interface Config {
  /** 基线心跳间隔（毫秒）。 */
  intervalMs: number
}

export const Config: Schema<Config> = Schema.object({
  intervalMs: Schema.number().default(60_000),
})

export function apply(ctx: Context, config: Config) {
  let pending = 0

  const beat = (source: HeartBeatPayload['source'], reason?: string): void => {
    // 只置位不消费：心脏永远不动 pending 的消费端。
    pending += 1
    const payload: HeartBeatPayload = {
      source,
      ...(reason === undefined ? {} : { reason }),
      pending,
      at: new Date().toISOString(),
    }
    ctx.emit('heart/beat', payload)
    // 每拍落 audit 行。写失败记错误日志但不停拍：
    // TODO(M3): audit 持续写失败时心脏是否停搏（fail-closed 到什么层级）由治理移植定，
    // 蓝图未定此决策，此处不擅自定死。
    ctx.audit.record({ type: 'heart/beat', ...payload }).catch((err) => {
      ctx.logger.error('lykoi-heart: audit record failed for beat: %s', String(err))
    })
  }

  const heart: HeartService = {
    get pending() {
      return pending
    },
    claim() {
      // tick 合并：一次取走全部积压拍。
      const beats = pending
      pending = 0
      return { beats }
    },
    arouse(reason: string) {
      beat('arouse', reason)
    },
  }

  // 副作用经 ctx.effect 可逆：fiber 卸载 → disposer 清定时器 → 停拍。
  ctx.effect(() => {
    const timer = setInterval(() => beat('interval'), config.intervalMs)
    return () => clearInterval(timer)
  }, 'lykoi-heart baseline pacemaker')

  ctx.provide('heart', heart)
}
