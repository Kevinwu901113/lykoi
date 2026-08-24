import test from 'node:test'
import assert from 'node:assert/strict'
import { CheapTickDriver, VirtualClock, systemClock } from '../src/index.ts'
import { T0 } from './fixture.ts'

test('clock 薄件（W1 TODO#7）：systemClock 返回真钟 Date；VirtualClock 只进不退（stepped 语义）', () => {
  const real = systemClock.now()
  assert.ok(real instanceof Date)
  assert.ok(Math.abs(real.getTime() - Date.now()) < 5_000)

  const clock = new VirtualClock(T0)
  assert.equal(clock.now().toISOString(), T0.toISOString())
  clock.advance(60_000)
  assert.equal(clock.now().toISOString(), '2026-08-24T10:01:00.000Z')
  assert.throws(() => clock.advance(-1), RangeError, '负 delta 抛（clock.py step 语义）')
  assert.throws(() => clock.set(T0), RangeError, '回拨抛（clock.py advance_to 语义）')
  clock.set(new Date(T0.getTime() + 120_000))
  assert.equal(clock.now().toISOString(), '2026-08-24T10:02:00.000Z')
  // now() 返回副本：调用方改不了钟。
  clock.now().setFullYear(1999)
  assert.equal(clock.now().getUTCFullYear(), 2026)
})

test('CheapTickDriver（SA-67）：600s 限频——首转即到期，期内拒绝，期满放行', () => {
  const driver = new CheapTickDriver()
  assert.equal(driver.due(T0), true, '首转即到期（last_cheap_tick=0 对应）')
  assert.equal(driver.due(new Date(T0.getTime() + 599_000)), false)
  assert.equal(driver.due(new Date(T0.getTime() + 600_000)), true)
  assert.equal(driver.due(new Date(T0.getTime() + 601_000)), false, '闸从上次放行起算')
})
