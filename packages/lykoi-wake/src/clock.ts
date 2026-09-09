export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

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

  advance(ms: number): Date {
    if (!(ms >= 0)) {
      throw new RangeError(`lykoi-wake: virtual clock step must be forward, got ${ms}`)
    }
    this.#at = new Date(this.#at.getTime() + ms)
    return this.now()
  }

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
