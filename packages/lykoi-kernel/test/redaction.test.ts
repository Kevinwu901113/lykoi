/**
 * 密文遮蔽（SK-05 语义对拍 shared/redaction.py）：redact/redactObj/assertNoSecrets。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { _setSecretsForTest, assertNoSecrets, redact, redactObj } from '../src/index.ts'

test('redact：已知密钥值全替换 [REDACTED]；非字符串原样', () => {
  _setSecretsForTest(['hunter2secret', 'anotherlongkey'])
  try {
    assert.equal(redact('token=hunter2secret&x=anotherlongkey'), 'token=[REDACTED]&x=[REDACTED]')
    assert.equal(redact('hunter2secret hunter2secret'), '[REDACTED] [REDACTED]')
    assert.equal(redact('clean text'), 'clean text')
    assert.equal(redact(42 as unknown as string), 42 as unknown as string)
  } finally {
    _setSecretsForTest(null)
  }
})

test('redactObj：递归遮 dict/list/标量；键也遮；撞键加 #n 后缀保值', () => {
  _setSecretsForTest(['secretvalue1', 'secretvalue2'])
  try {
    assert.deepEqual(
      redactObj({ a: 'secretvalue1', nested: { list: ['x secretvalue2', 3, null] } }),
      { a: '[REDACTED]', nested: { list: ['x [REDACTED]', 3, null] } },
    )
    // 两个原键遮蔽后同名 → 后到的挂 #2，两个值都保住，后缀不含键素材。
    assert.deepEqual(
      redactObj({ secretvalue1: 'a', secretvalue2: 'b' }),
      { '[REDACTED]': 'a', '[REDACTED]#2': 'b' },
    )
  } finally {
    _setSecretsForTest(null)
  }
})

test('assertNoSecrets：params 任何位置出现密钥值即抛；干净参数通过', () => {
  _setSecretsForTest(['deepsecretvalue'])
  try {
    assert.throws(() => assertNoSecrets({ x: { y: ['deepsecretvalue'] } }), /secret value present/)
    assert.throws(() => assertNoSecrets({ note: 'prefix deepsecretvalue suffix' }), /secret value present/)
    assertNoSecrets({ x: 'clean', n: 7 })
  } finally {
    _setSecretsForTest(null)
  }
})

test('env 快照口径：只收 _API_KEY/_SECRET/_PASSWORD 后缀且 ≥6 字符', () => {
  process.env.LYKOI_TEST_FAKE_API_KEY = 'longenoughvalue'
  process.env.LYKOI_TEST_FAKE_SECRET = 'short' // 5 字符 → 忽略
  process.env.LYKOI_TEST_UNRELATED = 'unrelatedvalue'
  try {
    _setSecretsForTest(null) // 从 env 重新快照
    assert.equal(redact('x longenoughvalue y'), 'x [REDACTED] y')
    assert.equal(redact('short stays'), 'short stays')
    assert.equal(redact('unrelatedvalue stays'), 'unrelatedvalue stays')
  } finally {
    delete process.env.LYKOI_TEST_FAKE_API_KEY
    delete process.env.LYKOI_TEST_FAKE_SECRET
    delete process.env.LYKOI_TEST_UNRELATED
    _setSecretsForTest(null)
  }
})
