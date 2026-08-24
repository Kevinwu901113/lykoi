/**
 * clock 薄件（W1 TODO#7 落地；shared/clock.py 的新体形态）。
 *
 * 活体三 regime（PRODUCTION / COMPRESSED_LIVE / COMPRESSED_DETERMINISTIC）收敛
 * 为一个注入面：`Clock.now()`。生产 = systemClock（唯一允许读真实墙钟的点，
 * C-23 对应）；测试 = VirtualClock（clock.py stepped 语义：只进不退）。
 *
 * 全部调用方 **now 必传**纪律不变：状态层（lykoi-memory/rw）、快照、reflow 的
 * API 都不读钟——编排层（lykoi-wake）经本件取 now 后显式传入。压缩/确定性
 * regime（COMPRESSED_*）若日后需要，实现为另一个 Clock 注入体，调用方零改动。
 */

export interface Clock {
  now(): Date
}

/** 生产钟：全仓唯一允许读真实墙钟的注入体（C-23 的对应豁免点）。 */
export const systemClock: Clock = {
  now: () => new Date(),
}

/**
 * 虚拟钟（测试注入源）。语义沿 clock.py 的 stepped 模式：
 * 只进不退——advance 负 delta / set 回拨一律抛（reads stay monotonic by
 * construction）。
 */
export class VirtualClock implements Clock {
  #at: Date

  constructor(start: Date | string) {
    const at = start instanceof Date ? start : new Date(start)
    if (Number.isNaN(at.getTime())) {
      throw new TypeError('lykoi-wake: VirtualClock requires a valid start time')
    }
    this.#at = new Date(at.getTime())
  }

  now(): Date {
    return new Date(this.#at.getTime())
  }

  /** 前进 ms 毫秒（负值抛——clock.py step 语义）。返回新的 now。 */
  advance(ms: number): Date {
    if (!(ms >= 0)) {
      throw new RangeError(`lykoi-wake: virtual clock step must be forward, got ${ms}`)
    }
    this.#at = new Date(this.#at.getTime() + ms)
    return this.now()
  }

  /** 设到指定时刻（回拨抛——clock.py advance_to 语义）。返回新的 now。 */
  set(to: Date | string): Date {
    const target = to instanceof Date ? to : new Date(to)
    if (Number.isNaN(target.getTime())) {
      throw new TypeError('lykoi-wake: VirtualClock.set requires a valid time')
    }
    if (target.getTime() < this.#at.getTime()) {
      throw new RangeError(
        `lykoi-wake: virtual clock cannot move backward: ${target.toISOString()} < ${this.#at.toISOString()}`,
      )
    }
    this.#at = new Date(target.getTime())
    return this.now()
  }
}
