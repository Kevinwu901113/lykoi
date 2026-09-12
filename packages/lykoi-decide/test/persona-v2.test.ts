import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePersonaData, buildPersonaKernel } from '../src/persona.ts'
import { parseTomlSubset } from '../src/persona-toml.ts'

test('v2 accepts a minimal character without inventing traits, relationship or interests', () => {
  const p = parsePersonaData(parseTomlSubset('version = 2\n[character]\nname = "旅人"\ndescription = "一位沉默的旅人。"'))
  assert.equal(buildPersonaKernel(p), '角色：旅人\n\n一位沉默的旅人。')
  assert.deepEqual(p.interests.seeds, [])
  assert.deepEqual(p.personality.traits, [])
})

test('v2 keeps multiline character content and distinguishes birth fiction from lived state', () => {
  const description = '第一行\n第二行 <tag> # 原文'
  const p = parsePersonaData({ version: 2, character: {
    name: '旅人', description, language: '中文', voice: '句子简短', relationship: '初次见面',
    address_owner: '朋友', embodiment: '虚构的人类', traits: ['好奇'], interests: ['地图'],
    scenario: '在车站相遇', examples: ['朋友：你好\n旅人：你好。\n旅人：你也在等车？'],
  } })
  const prompt = buildPersonaKernel(p)
  assert.ok(prompt.includes(description))
  assert.ok(prompt.includes('不是当前状态'))
  assert.ok(prompt.includes('不是实际发生的对话'))
  assert.ok(prompt.includes('旅人：你好。\n旅人：你也在等车？'))
  assert.deepEqual(p.interests.seeds, ['地图'])
  assert.equal(p.voice.address_owner, '朋友')
})

test('version and schema mistakes fail at load instead of silently dropping content', () => {
  const parse = (character: unknown) => parsePersonaData({ version: 2, character })
  assert.throws(() => parsePersonaData({ version: 3 }), /unsupported persona version/)
  assert.throws(() => parse([]), /requires/)
  assert.throws(() => parse({ name: '旅人' }), /description/)
  assert.throws(() => parse({ name: '旅人', description: '描述', examples: 'wrong' }), /examples/)
  assert.throws(() => parse({ name: '旅人', description: '描述', voice: null }), /voice/)
  assert.throws(() => parse({ name: '旅人', description: '描述', temperament: 'lost' }), /unknown character field/)
  assert.throws(() => parsePersonaData({ version: 2, character: { name: '旅人', description: '描述' }, runtime: {} }), /unknown section/)
})
