/**
 * vision seam（M3-W3 ⑦；cognition/llm_router.describe_image:239-259 逐字形态）。
 *
 * 真模型调用**不做**（本波纪律：零真网）—— 断言的是调用**形状**：读文件 →
 * base64 → 一条 user 消息（先文字提示、后 data:<media>;base64 的 image_url）→
 * VISION 路由。以及 S-56 的那道闸仍在 Conversation 里：只有可信生产者发出的
 * attachment id 才 resolve。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  VISION_DEFAULT_PROMPT, buildVisionMessages, createDescribeImage, visionMediaType,
  type VisionMessage,
} from '../src/vision.ts'

test('媒体类型：.jpg/.jpeg → image/jpeg，其余一律 image/png（大小写不敏感）', () => {
  assert.equal(visionMediaType('/tmp/a.png'), 'image/png')
  assert.equal(visionMediaType('/tmp/a.JPG'), 'image/jpeg')
  assert.equal(visionMediaType('/tmp/a.jpeg'), 'image/jpeg')
  assert.equal(visionMediaType('/tmp/screenshot'), 'image/png')
})

test('消息形状：单条 user，两段 content —— 文字提示在前、image_url 在后', () => {
  const messages = buildVisionMessages('QUJD', null, 'image/png')
  assert.equal(messages.length, 1)
  assert.equal(messages[0]!.role, 'user')
  assert.deepEqual(messages[0]!.content, [
    { type: 'text', text: VISION_DEFAULT_PROMPT },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
  ])
  // 给了问题就用他的问题（缺省提示词只在没问题时出场）。
  const asked = buildVisionMessages('QUJD', '这个按钮在哪', 'image/jpeg')
  assert.equal(asked[0]!.content[0]!.text, '这个按钮在哪')
  assert.equal(asked[0]!.content[1]!.image_url!.url, 'data:image/jpeg;base64,QUJD')
})

test('缺省提示词逐字（llm_router.py:246-248）', () => {
  assert.equal(VISION_DEFAULT_PROMPT,
    '请详细描述这张截图里的内容：页面标题、主要文字、以及可点击/可输入的元素。')
})

test('describeImage：读文件 → base64 → 注入的 completion（零真网）；空回落空串', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-vision-'))
  const path = join(dir, 'shot.png')
  writeFileSync(path, Buffer.from([0x41, 0x42, 0x43])) // "ABC"
  const seen: VisionMessage[][] = []
  const describe = createDescribeImage({
    completion: async (messages) => {
      seen.push(messages)
      return { content: '页面上有一个登录框' }
    },
  })
  assert.equal(await describe(path, null), '页面上有一个登录框')
  assert.equal(seen[0]![0]!.content[1]!.image_url!.url, 'data:image/png;base64,QUJD')

  // 空回 / null 回 → 空串（活体 `message.get("content") or ""` 同形）
  const empty = createDescribeImage({ completion: async () => ({ content: null }) })
  assert.equal(await empty(path, null), '')
  const nothing = createDescribeImage({ completion: async () => null })
  assert.equal(await nothing(path, null), '')
})

test('读不了的图/调不通的模型都**不吞** —— 由 Conversation 的 vision_error 分支接住', async () => {
  const describe = createDescribeImage({ completion: async () => ({ content: 'x' }) })
  await assert.rejects(() => describe('/nonexistent/shot.png', null))
  const boom = createDescribeImage({ completion: async () => { throw new Error('vision down') } })
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-vision-'))
  const path = join(dir, 'a.png')
  writeFileSync(path, Buffer.from([1]))
  await assert.rejects(() => boom(path, null), /vision down/)
})
