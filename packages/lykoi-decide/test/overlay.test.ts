/**
 * WO-OVERLAY-WAKE-01：relationship overlay 渲染真源（D-1）与 wake 装配段位（D-2）。
 *
 * 四个渲染分支的期望逐字搬自 lykoi-converse 旧实现的测试（assemble.test.ts D-5
 * 三条）：subject null / 读抛错 / 空行 / 正常。装配三例：不给闭包、闭包返回空、
 * 闭包非空 → 段在 acquired 之后、器官块之前。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DECIDE_SYSTEM_PROMPT, RELATIONSHIP_OVERLAY_HEADER, buildMessages, buildPersonaKernel,
  buildRelationshipOverlay, type OverlayReader,
} from '../src/index.ts'
import { FIXTURE_PERSONA } from './persona-fixture.ts'

function reader(opts: {
  subject?: string | null
  rows?: Record<string, unknown>[]
  throws?: Error
}): OverlayReader & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    ownerPrimaryUserId: () => (opts.subject === undefined ? 'user_001' : opts.subject),
    promotedRelationshipInsights: (subject) => {
      asked.push(subject)
      if (opts.throws) throw opts.throws
      return opts.rows ?? []
    },
  }
}

test('D-1：header 38 字（converse 侧的钉从这里再导出）', () => {
  assert.equal([...RELATIONSHIP_OVERLAY_HEADER].length, 38)
  assert.ok(RELATIONSHIP_OVERLAY_HEADER.endsWith('\n'))
})

test('D-1：subject null → 零字节，不读行', () => {
  const r = reader({ subject: null })
  assert.deepEqual(buildRelationshipOverlay(r), { text: '', count: 0, subject: null })
  assert.deepEqual(r.asked, [])
})

test('D-1：读抛错 → error 带异常名 + 零字节', () => {
  const r = reader({ throws: new TypeError('boom') })
  assert.deepEqual(buildRelationshipOverlay(r), {
    text: '', count: 0, subject: 'user_001', error: 'TypeError',
  })
})

test('D-1：只有空行 → 零字节（连标题都不出现）', () => {
  const r = reader({ rows: [{ content: '   ' }, { content: '' }, {}] })
  assert.deepEqual(buildRelationshipOverlay(r), { text: '', count: 0, subject: 'user_001' })
})

test('D-1：正常 → 头部 + 每行 `- {content}`（trim、空行过滤）', () => {
  const r = reader({ rows: [
    { content: '他忙起来就不爱说话，那不是针对我' },
    { content: '  和他说话不用铺垫 ' },
    { content: '' },
  ] })
  const out = buildRelationshipOverlay(r)
  assert.equal(out.count, 2)
  assert.equal(out.subject, 'user_001')
  assert.equal(out.error, undefined)
  assert.equal(
    out.text,
    RELATIONSHIP_OVERLAY_HEADER + '- 他忙起来就不爱说话，那不是针对我\n- 和他说话不用铺垫',
  )
  assert.deepEqual(r.asked, ['user_001'])
})

const CAND = [{ kind: 'rest', weight: 0.5, cost: '0', note: 'n' }] as const
const SNAP = { 调节场: {}, 环境: {} }

test('D-2：不给 overlay 闭包 / 闭包返回空 → 装配逐字节与本单之前相同', () => {
  const base = {
    persona: FIXTURE_PERSONA,
    acquired: () => '\n\n你对自己的理解：\n- p1',
    organBlock: () => '[器官清单(只读)]\nX',
  }
  const without = buildMessages(SNAP, CAND, base)
  const empty = buildMessages(SNAP, CAND, { ...base, overlay: () => '' })
  assert.deepEqual(empty, without)
  assert.deepEqual(without.map((m) => m.content), [
    buildPersonaKernel(FIXTURE_PERSONA),
    '你对自己的理解：\n- p1',
    '[器官清单(只读)]\nX',
    DECIDE_SYSTEM_PROMPT,
    without[4]!.content,
  ])
})

test('D-2：overlay 非空 → 段在 acquired 之后、器官块之前，内容逐字', () => {
  const text = RELATIONSHIP_OVERLAY_HEADER + '- 和他说话不用铺垫'
  const msgs = buildMessages(SNAP, CAND, {
    persona: FIXTURE_PERSONA,
    acquired: () => '\n\n你对自己的理解：\n- p1',
    overlay: () => text,
    organBlock: () => '[器官清单(只读)]\nX',
  })
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'system', 'system', 'system', 'system', 'user'])
  assert.equal(msgs[1]!.content, '你对自己的理解：\n- p1')
  assert.equal(msgs[2]!.content, text)
  assert.equal(msgs[3]!.content, '[器官清单(只读)]\nX')
  assert.equal(msgs[4]!.content, DECIDE_SYSTEM_PROMPT)
  // acquired 为空时 overlay 仍在内核之后、器官块之前。
  const noAcquired = buildMessages(SNAP, CAND, {
    persona: FIXTURE_PERSONA,
    acquired: () => '',
    overlay: () => text,
    organBlock: () => null,
  })
  assert.deepEqual(noAcquired.map((m) => m.content).slice(0, 3), [
    buildPersonaKernel(FIXTURE_PERSONA), text, DECIDE_SYSTEM_PROMPT,
  ])
})
