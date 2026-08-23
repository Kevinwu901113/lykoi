/**
 * C-22 写侧格式（M2-W1）：formatPyIso 沿用 Python isoformat 形态
 * （+00:00 偏移、微秒零省略、非零固定六位），并与 golden devstate 的真实
 * 历史行格式对拍（只读、只断格式，零内容输出）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStateTimestamp, ReadOnlyMemory } from '../src/index.ts'
import { formatPyIso } from '../src/rw.ts'
import { DEVSTATE, devstateSkip, PY_ISO_RE } from './fixture.ts'

test('formatPyIso：微秒为 0 → 整个小数部分省略（isoformat 行为）', () => {
  const out = formatPyIso(new Date(Date.UTC(2026, 7, 24, 12, 0, 0, 0)))
  assert.equal(out, '2026-08-24T12:00:00+00:00')
  assert.match(out, PY_ISO_RE)
})

test('formatPyIso：非零毫秒 → 六位微秒（毫秒三位 + 000，是 isoformat 的合法子集）', () => {
  assert.equal(
    formatPyIso(new Date(Date.UTC(2026, 7, 24, 1, 2, 3, 42))),
    '2026-08-24T01:02:03.042000+00:00',
  )
  assert.equal(
    formatPyIso(new Date(Date.UTC(2026, 7, 24, 1, 2, 3, 500))),
    '2026-08-24T01:02:03.500000+00:00',
  )
  assert.match(formatPyIso(new Date(Date.UTC(2026, 7, 24, 1, 2, 3, 999))), PY_ISO_RE)
})

test('formatPyIso ↔ parseStateTimestamp 往返：epoch 不变（C-22 读写闭环）', () => {
  for (const ms of [0, 1, 42, 500, 999]) {
    const d = new Date(Date.UTC(2026, 7, 24, 23, 59, 59, ms))
    assert.equal(parseStateTimestamp(formatPyIso(d)).getTime(), d.getTime())
  }
})

test('formatPyIso：非法 Date 拒绝', () => {
  assert.throws(() => formatPyIso(new Date('invalid')), /valid Date/)
  assert.throws(() => formatPyIso('2026-08-24' as never), /valid Date/)
})

test('devstate：真实业务行与 formatPyIso 同形态（只断格式，不打印任何值）', { skip: devstateSkip }, () => {
  const memory = new ReadOnlyMemory(DEVSTATE!)
  let checked = 0
  const rows: string[] = []
  for (const r of memory.regulationField()) rows.push(r.updatedAt)
  for (const r of memory.recentHistory(50)) rows.push(r.ts)
  for (const r of memory.recentExperiences(50)) rows.push(r.ts)
  for (const ts of rows) {
    // ① 真实行匹配业务行格式族（+00:00 偏移、微秒零省略/非零六位）
    assert.match(ts, PY_ISO_RE)
    // ② parse 后重排出的 formatPyIso 与原文同族：无小数行逐字回原；有小数行
    //    前 23 位（到毫秒）一致，尾三位是 JS 精度外的微秒（本写层恒排 000）。
    const parsed = parseStateTimestamp(ts)
    const round = formatPyIso(parsed)
    assert.match(round, PY_ISO_RE)
    if (parsed.getUTCMilliseconds() === 0) {
      // 毫秒位为零（含亚毫秒微秒被 JS 精度截断的行）→ 小数整体省略
      assert.equal(round, ts.slice(0, 19) + '+00:00')
    } else {
      assert.equal(round.slice(0, 23), ts.slice(0, 23))
      assert.ok(round.endsWith('000+00:00'))
    }
    checked += 1
  }
  assert.ok(checked >= 4, '至少覆盖 regulation_field 四行')
  memory.close()
})
