/**
 * prompt 对拍：DECIDE_SYSTEM_PROMPT 新 sha（G-2 重算）、persona 内核 fixture
 * sha（SA-154）、build_messages 五段顺序（SA-16/17）+ G-7 器官注入、
 * persona 投影三形状（SA-158）+ 影子门（focus 不在白名单）。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  buildMessages,
  buildPersonaKernel,
  buildPersonaPrompt,
  DECIDE_SYSTEM_PROMPT,
  parsePersonaData,
  PersonaConfigError,
  PERSONA_PROJECTION_CATEGORIES,
  type Candidate,
} from '../src/index.ts'
import { FIXTURE_PERSONA, FIXTURE_PERSONA_DATA } from './persona-fixture.ts'

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

test('G-2：DECIDE_SYSTEM_PROMPT 新 sha 钉死；next_wake_after_minutes 字段行已移除', () => {
  // 旧（活体 decide.py:244-288）：chars=1634
  //   sha256=a495848d8abaae9f5e22ec9aaa95688f8928ac1e0b8cca6ec14de5d8f38a636e
  // 新（移除 `  "next_wake_after_minutes": 45,` 一行后）：
  assert.equal([...DECIDE_SYSTEM_PROMPT].length, 1601)
  assert.equal(
    sha256(DECIDE_SYSTEM_PROMPT),
    'd54726e3ee182f600f5fc0222db76de940d3a66cddfb63cb8e29ff71b633e74c',
  )
  assert.ok(!DECIDE_SYSTEM_PROMPT.includes('next_wake_after_minutes'))
})

test('SA-154：persona 内核九段装配 fixture 对拍（chars=401、sha=1f5960b7…bec71）', () => {
  const kernel = buildPersonaKernel(FIXTURE_PERSONA)
  assert.equal([...kernel].length, 401)
  assert.equal(
    sha256(kernel),
    '1f5960b79d5e5251ba9be96922806879cd7d434e7ae0e52a6bc57fec1b5bec71',
  )
  // 全角标点是字节契约的一部分
  assert.ok(kernel.includes('（我的身体：lapwing-home VM (vmid 110)。）'))
  assert.ok(kernel.includes('默认用中文，技术术语用英文。')) // 'zh' 特判
  // 确定性：同 cfg 两次装配逐字节相同（PATH-AGNOSTIC 的前提）
  assert.equal(buildPersonaKernel(FIXTURE_PERSONA), kernel)
  // 非 'zh' 语言原样注入
  const en = buildPersonaKernel({
    ...FIXTURE_PERSONA,
    voice: { ...FIXTURE_PERSONA.voice, language: 'en' },
  })
  assert.ok(en.includes('默认用en，技术术语用英文。'))
})

test('SA-156：parsePersonaData fail-fast（缺 section / 类型错 / 空列表逐条炸）', () => {
  assert.deepEqual(parsePersonaData(FIXTURE_PERSONA_DATA), FIXTURE_PERSONA)
  const without = (key: string) => {
    const clone: Record<string, unknown> = { ...FIXTURE_PERSONA_DATA }
    delete clone[key]
    return clone
  }
  assert.throws(() => parsePersonaData(without('interests')),
    (e: unknown) => e instanceof PersonaConfigError
      && (e as Error).message === 'persona TOML missing [interests] section')
  assert.throws(() => parsePersonaData({
    ...FIXTURE_PERSONA_DATA,
    identity: { ...(FIXTURE_PERSONA_DATA.identity as object), name: '  ' },
  }), /persona TOML \[identity\]\.name must be a non-empty string/)
  assert.throws(() => parsePersonaData({
    ...FIXTURE_PERSONA_DATA,
    identity: { ...(FIXTURE_PERSONA_DATA.identity as object), nature_known: 'yes' },
  }), /persona TOML \[identity\]\.nature_known must be a boolean/)
  assert.throws(() => parsePersonaData({
    ...FIXTURE_PERSONA_DATA,
    personality: { traits: [], evolves: true },
  }), /persona TOML \[personality\]\.traits must be a non-empty list of strings/)
})

test('SA-158：persona 投影三形状 + 影子门（focus 类别不在白名单）', () => {
  const asked: string[] = []
  const store = (rows: Record<string, string[]>) => ({
    getInsights: (category: string) => {
      asked.push(category)
      return (rows[category] ?? []).map((content) => ({ content }))
    },
  })
  // 全空 → 空串（③）
  assert.equal(buildPersonaPrompt(store({})), '')
  // 两节齐 → 前置 \n\n（①）+ 节间 \n\n（②）
  assert.equal(
    buildPersonaPrompt(store({ persona: ['p1', 'p2'], preference: ['k1'] })),
    '\n\n你对自己的理解：\n- p1\n- p2\n\nKevin 的偏好：\n- k1',
  )
  // 单节
  assert.equal(buildPersonaPrompt(store({ preference: ['k1'] })), '\n\nKevin 的偏好：\n- k1')
  // 影子门：只查 persona/preference 两类，focus 永不进投影（SPEC-MIND §6.2）
  assert.deepEqual([...new Set(asked)].sort(), ['persona', 'preference'])
  assert.deepEqual([...PERSONA_PROJECTION_CATEGORIES], ['persona', 'preference'])
  assert.ok(!(PERSONA_PROJECTION_CATEGORIES as readonly string[]).includes('focus'))
})

const CAND: Candidate[] = [
  { kind: 'rest', weight: 0.5, cost: '0', note: 'n' },
]
const SNAP = { 调节场: {}, 环境: {} }

test('SA-16/17 + G-7：五段顺序；内核必须第一条；acquired/器官非空才注入', () => {
  // 全配置：内核 → acquired → 器官（G-7）→ decide 契约 → self-state → user
  const msgs = buildMessages(SNAP, CAND, {
    persona: FIXTURE_PERSONA,
    acquired: () => '\n\n你对自己的理解：\n- p1',
    organBlock: () => '[器官清单(只读)]\nX',
    selfState: () => ({ role: 'system', content: 'self-state' }),
  })
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'system', 'system', 'system', 'system', 'user'])
  assert.equal(msgs[0]!.content, buildPersonaKernel(FIXTURE_PERSONA)) // SA-17 第一条
  assert.equal(msgs[1]!.content, '你对自己的理解：\n- p1') // strip 后注入
  assert.equal(msgs[2]!.content, '[器官清单(只读)]\nX') // G-7：紧随 acquired、契约之前
  assert.equal(msgs[3]!.content, DECIDE_SYSTEM_PROMPT)
  assert.equal(msgs[4]!.content, 'self-state')
  assert.equal(
    msgs[5]!.content,
    JSON.stringify({ 快照: SNAP, 候选动作: [{ kind: 'rest', weight: 0.5, cost: '0', note: 'n' }] }),
  )
  // 空 acquired / 空器官 / 无 self-state → 三段收缩为 内核 → 契约 → user
  const bare = buildMessages(SNAP, CAND, {
    persona: FIXTURE_PERSONA,
    acquired: () => '   ',
    organBlock: () => null,
  })
  assert.equal(bare.length, 3)
  assert.equal(bare[0]!.content, buildPersonaKernel(FIXTURE_PERSONA))
  assert.equal(bare[1]!.content, DECIDE_SYSTEM_PROMPT)
  assert.equal(bare[2]!.role, 'user')
})
