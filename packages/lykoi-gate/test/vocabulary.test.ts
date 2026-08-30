/**
 * 事件词汇分流跑在**真仓库**上（只读）：W2 TODO#6 的定案落地之后，这条必须绿。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { checkEventVocabulary, productionEnv } from '../src/verify.ts'
import {
  DUAL_NAMES, IMMUTABLE_EMITTER_REL, IMMUTABLE_TYPES, TELEMETRY_ADAPTER_REL, scanTelemetryNames,
} from '../src/vocabulary.ts'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

test('真仓库：事件词汇检查项全绿（V1 声明一致 / V2 碰撞 = 声明 / V3 盖章在位）', () => {
  const problems: string[] = []
  checkEventVocabulary(productionEnv(REPO_ROOT), problems)
  assert.deepEqual(problems, [])
})

test('真仓库：碰撞面就是 `delegation_context_invalid` 一个（W2#6 描述的那一个）', () => {
  const telemetry = scanTelemetryNames(REPO_ROOT, [
    'lykoi-kernel', 'lykoi-converse', 'lykoi-wake', 'lykoi-learn', 'lykoi-adapter-telegram',
    'lykoi-memory', 'lykoi-decide', 'lykoi-snapshot',
  ])
  const collisions = IMMUTABLE_TYPES.filter((n) => telemetry.has(n))
  assert.deepEqual(collisions, [...DUAL_NAMES])
  // 另两个 immutable 名字**没有**遥测孪生（所以它们不需要分流也不会被误读）。
  assert.equal(telemetry.has('action_dispatch'), false)
  assert.equal(telemetry.has('action_result'), false)
})

test('真仓库：遥测适配器盖 channel 章；immutable 信封**一个字节没动**', () => {
  const adapter = readFileSync(join(REPO_ROOT, TELEMETRY_ADAPTER_REL), 'utf8')
  assert.match(adapter, /audit\.record\(\{ type: name, channel: 'telemetry', \.\.\.fields \}\)/)

  // immutable 那一侧：三条行的构造处不许出现 channel 字段（SK-06/SK-11 逐字字段序）。
  const dispatch = readFileSync(join(REPO_ROOT, IMMUTABLE_EMITTER_REL), 'utf8')
  assert.equal(dispatch.includes("channel: '"), false, 'immutable 信封被加了 channel 字段')
  for (const name of IMMUTABLE_TYPES) {
    assert.equal(dispatch.includes(`type: '${name}'`), true, name)
  }
})
