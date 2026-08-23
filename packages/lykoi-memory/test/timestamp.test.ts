/** C-22 双时间戳格式统一 parse 的测试（纯函数，不碰任何 db）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStateTimestamp, stateTimestampMs } from '../src/index.ts'

test('C-22 业务行格式：+00:00 偏移，微秒精度且尾随零省略', () => {
  // isoformat() 微秒为 0 时不输出小数部分
  assert.equal(parseStateTimestamp('2026-08-09T00:00:00+00:00').getTime(),
    Date.UTC(2026, 7, 9, 0, 0, 0, 0))
  // 六位微秒 → 截到毫秒
  assert.equal(parseStateTimestamp('2026-08-09T12:34:56.123456+00:00').getTime(),
    Date.UTC(2026, 7, 9, 12, 34, 56, 123))
  // 尾随零省略后的短小数（isoformat 不会产生，但 parse 面要稳）
  assert.equal(parseStateTimestamp('2026-08-09T12:34:56.5+00:00').getTime(),
    Date.UTC(2026, 7, 9, 12, 34, 56, 500))
})

test('C-22 迁移台账格式：Z 后缀，固定毫秒三位', () => {
  assert.equal(parseStateTimestamp('2026-08-09T00:00:00.000Z').getTime(),
    Date.UTC(2026, 7, 9, 0, 0, 0, 0))
  assert.equal(parseStateTimestamp('2026-08-24T01:02:03.456Z').getTime(),
    Date.UTC(2026, 7, 24, 1, 2, 3, 456))
})

test('C-22 两种格式表示同一时刻时 parse 结果相等（字符串排序不可靠的替代口径）', () => {
  assert.equal(
    stateTimestampMs('2026-08-09T10:00:00+00:00'),
    stateTimestampMs('2026-08-09T10:00:00.000Z'),
  )
  // 混排排序：epoch 口径下正确（字符串口径下 '2026-08-09T09..Z' > '2026-08-09T10..+00:00' 会错）
  const later = '2026-08-09T10:00:00+00:00'
  const earlier = '2026-08-09T09:59:59.999Z'
  assert.ok(stateTimestampMs(earlier) < stateTimestampMs(later))
})

test('C-24 naive（无 tz）历史时间戳按 UTC 处理', () => {
  assert.equal(parseStateTimestamp('2026-08-09T00:00:00').getTime(),
    Date.UTC(2026, 7, 9, 0, 0, 0, 0))
})

test('非 UTC 偏移正确换算（防御性：契约里只见 +00:00，但格式面要正确）', () => {
  assert.equal(parseStateTimestamp('2026-08-09T08:00:00+08:00').getTime(),
    Date.UTC(2026, 7, 9, 0, 0, 0, 0))
  assert.equal(parseStateTimestamp('2026-08-08T19:30:00-04:30').getTime(),
    Date.UTC(2026, 7, 9, 0, 0, 0, 0))
})

test('解析失败：抛错且错误信息不回显输入内容（隐私纪律）', () => {
  for (const bad of ['not-a-timestamp', '2026/08/09 00:00:00', '', '2026-13-99T99:99:99Z']) {
    assert.throws(() => parseStateTimestamp(bad), (err: Error) => {
      assert.ok(!err.message.includes(bad) || bad === '', '错误信息不得包含输入原文')
      assert.match(err.message, /lykoi-memory/)
      return true
    })
  }
})
