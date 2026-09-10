import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestSlots } from '../src/scheduler.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('two blocked background calls cannot block foreground; cancelled queue never executes', async () => {
  const slots = new RequestSlots(), release = deferred()
  const started: string[] = []
  const background = (name: string) => slots.run(true, undefined, async () => { started.push(name); await release.promise })
  const a = background('A'), b = background('B')
  const abort = new AbortController()
  const c = slots.run(true, abort.signal, async () => { started.push('C') })
  const rejected = assert.rejects(c, /cancelled/)
  await slots.run(false, undefined, async () => { started.push('foreground') })
  assert.deepEqual(started, ['A','B','foreground'])
  abort.abort(new Error('cancelled'))
  await rejected; release.resolve(); await Promise.all([a,b])
  assert.ok(!started.includes('C'))
})
