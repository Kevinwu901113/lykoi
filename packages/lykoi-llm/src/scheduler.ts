/** Three request slots, at most two background requests. Foreground always has a reserved slot. */
export class RequestSlots {
  #active = 0
  #background = 0
  #queue: Array<{ background: boolean; start(): void }> = []
  async run<T>(background: boolean, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const item = { background, start: () => {
        signal?.removeEventListener('abort', abort)
        this.#active++; if (background) this.#background++
        resolve()
      } }
      const abort = () => {
        this.#queue = this.#queue.filter(entry => entry !== item)
        reject(signal?.reason ?? new Error('request cancelled'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.#queue.push(item); this.#drain()
    })
    try { signal?.throwIfAborted(); return await work() }
    finally { this.#active--; if (background) this.#background--; this.#drain() }
  }
  #drain() {
    while (this.#active < 3) {
      let index = this.#queue.findIndex(item => !item.background)
      if (index < 0 && this.#background < 2) index = this.#queue.findIndex(item => item.background)
      if (index < 0) return
      this.#queue.splice(index, 1)[0]!.start()
    }
  }
}
