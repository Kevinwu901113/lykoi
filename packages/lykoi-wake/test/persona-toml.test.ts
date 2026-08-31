/**
 * persona 配置面（D-FIX-1，WO-M4-FIX-WAKE）：装配面只给**路径**，先天内核从
 * owner 域 TOML 装载 —— 与 lykoi-converse 同形同源。
 *
 * 这三条钉的是切换窗事故（2026-09-01 00:54）根因①的修法：
 *  ① 等价钉：`test/fixtures/persona.toml` 与 `fixture.ts` 的 TEST_PERSONA 逐字段
 *    等价 —— 两份形状件不许漂（漂了以后「经 Config 的测试」和「直接喂对象的
 *    测试」就在测两个不同的她）。
 *  ② 缺 personaToml → **Config 校验就拒**（ValidationError）。事故那条是
 *    `$.persona missing required value`：必填项 + profile 从没填过 = 条目一翻开
 *    就炸在 loader 阶段。必填这件事本身是对的（半个自我不许开机），所以修法
 *    不是把它改成可选，而是把配置面换成**装配面真填得出**的那一个（路径）。
 *  ③ personaToml 指向不存在的文件 → apply **抛 PersonaConfigError**，不包不吞
 *    （SA-156 fail-fast；姿态与 loadPersona 既有姿态逐字相同）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import type { AuditService } from 'lykoi-audit'
import { loadPersona, PersonaConfigError } from 'lykoi-decide'
import type { HeartService } from 'lykoi-heart'
import type { LykoiLlmService } from 'lykoi-llm'
import * as wake from '../src/index.ts'
import { TEST_PERSONA, makeStore } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

/** 一套够 apply 跑起来的最小服务面（inject = heart / lykoiLlm / audit）。 */
function stubbedContext(): Context {
  const ctx = new Context()
  ctx.provide('audit', { async record() {} } satisfies Pick<AuditService, 'record'>)
  ctx.provide('heart', {
    get pending() {
      return 0
    },
    get nextAt() {
      return null
    },
    claim: () => ({ beats: 0 }),
  } satisfies Pick<HeartService, 'claim' | 'nextAt' | 'pending'>)
  ctx.provide('lykoiLlm', {
    async call() {
      return { text: '' }
    },
  } satisfies Pick<LykoiLlmService, 'call'>)
  return ctx
}

test('等价钉：fixtures/persona.toml 装载结果 === TEST_PERSONA（两份形状件不许漂）', () => {
  assert.deepEqual(loadPersona(PERSONA_TOML), TEST_PERSONA)
})

test('负例①：缺 personaToml → Config 校验拒（ValidationError，装配面就炸）', () => {
  // Schemastery 的入参在类型上是解析**后**的形状，所以这里断言式地传半份
  // （模拟 profile 条目只填了 dbPath —— 事故里 prod yml 的真实形态）。
  assert.throws(
    () => wake.Config({ dbPath: '/tmp/nope.db' } as Partial<wake.Config> as wake.Config),
    /\$\.personaToml missing required value/,
    '必填项缺席必须在校验期被点名，而不是带着半个自我往下走',
  )
  // 反向：给了路径就过校验（这一项不是「怎么填都炸」）。
  const resolved = wake.Config(
    { dbPath: '/tmp/nope.db', personaToml: PERSONA_TOML } as Partial<wake.Config> as wake.Config,
  )
  assert.equal(resolved.personaToml, PERSONA_TOML)
  assert.equal(resolved.route, wake.AUTONOMOUS_COGNITION) // 其余项缺省接得住
})

test('负例②：personaToml 指向不存在的文件 → apply 抛 PersonaConfigError（不包不吞）', async () => {
  const { store, path } = makeStore()
  store.close() // 插件自己持有 rw 句柄（W1 TODO#9）
  const ctx = stubbedContext()

  // ctx.plugin 返回 Fiber（thenable 而非 Promise 实例）—— 包一层拿真 Promise。
  await assert.rejects(
    async () => await ctx.plugin(wake, {
      dbPath: path,
      personaToml: '/nonexistent/lykoi/persona.toml',
      route: 'mock',
      model: 'mock-model',
      checkIntervalMs: 3_600_000,
    }),
    (err: unknown) => {
      assert.ok(err instanceof PersonaConfigError, `期望 PersonaConfigError，实得 ${String(err)}`)
      assert.equal(err.message, 'persona TOML not found: /nonexistent/lykoi/persona.toml')
      return true
    },
  )
  // 炸了就是炸了：服务不许挂上去（半个自我不许开机）。
  assert.equal(ctx.get('wake'), undefined)
})
