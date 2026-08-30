/**
 * D-01 超时预算红测（M4-W1 交付①）。
 *
 * 要钉死的是四件事：
 *  ①**按时切断**——假 LLM 挂住（而且完全不理会 signal），调用方仍在上限处拿回
 *    控制权（`Promise.race` 的那条边），不是等对面开恩。
 *  ②**AbortSignal 形态**——signal 真的递到了被等待的一方，且撞线时真的 abort
 *    （递进 dsh-llm 的 `GenerateOptions.signal` 后，那一跳的连接与 tokens 不再挂着）。
 *  ③**事件形状**——与 G-10 失败事件同族：`error_type`/`elapsed_ms`/`reason`/
 *    `attempts`，零正文（D-08 口径）。
 *  ④**单一出处**——源码缺省、Schema 缺省、`cordis.prod.yml` 三处同数；profile
 *    那三行删掉不会换一套语义。
 *
 * 时钟纪律（W4 时钟炸弹教训）：本文件**没有任何夹具固定日期参与时延判定**。
 * elapsed 与超时判定读的是 `withDeadline` 内部同一只单调表（同一次调用里的两点
 * 差）；夹具的 T0 只管 store 的行时间戳，与这里的断言无关。真实等待一律
 * 20–80ms 量级（远低于「不许真 sleep 长于 1s」的红线）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CYCLE_TIMEOUT_EVENT, Config, D01_CYCLE_TIMEOUT_S, D01_DEFAULTS,
  D01_INTERPRET_RETRIES, D01_INTERPRET_TIMEOUT_S, DeadlineExceededError,
  INTERPRET_FAILURE_EVENT, INTERPRET_RETRY_EVENT, deadlineMs,
  runInterpretWithDeadline, withDeadline,
} from '../src/index.ts'
import { envelope, eventNames, lastEvent, makeConversation } from './fixture.ts'

/** 一个永不落定、且**完全无视 signal** 的等待（最坏的对面）。 */
function hangsForever(): Promise<never> {
  return new Promise<never>(() => {})
}

function collector(): { events: [string, Record<string, unknown>][]; log: (n: string, f: Record<string, unknown>) => void } {
  const events: [string, Record<string, unknown>][] = []
  return { events, log: (n, f) => { events.push([n, f]) } }
}

// --- ① 按时切断 + ② AbortSignal 形态 -------------------------------------------

test('withDeadline：对面挂死且不理会 signal，调用方仍按时拿回控制权', async () => {
  let seen: AbortSignal | undefined
  const started = performance.now() // realtime-allow: 与被测同一只表
  await assert.rejects(
    withDeadline('unit_probe', 40, (signal) => { seen = signal; return hangsForever() }),
    (exc: unknown) => {
      assert.ok(exc instanceof DeadlineExceededError)
      assert.equal(exc.name, 'DeadlineExceededError')
      assert.equal(exc.what, 'unit_probe')
      assert.equal(exc.timeoutMs, 40)
      assert.equal(typeof exc.elapsedMs, 'number')
      return true
    },
  )
  const waited = performance.now() - started // realtime-allow
  // 上界比下界重要：证明「没等到天荒地老」。宽到不会在忙碌 CI 上假红。
  assert.ok(waited < 2000, `等了 ${waited}ms，超时没有按时切断`)
  // ②：signal 递到了，而且撞线时真的 abort（reason = 本次超时本体）。
  assert.ok(seen instanceof AbortSignal)
  assert.equal(seen.aborted, true)
  assert.ok(seen.reason instanceof DeadlineExceededError)
})

test('withDeadline：没撞线就原样返回；上限 <= 0 = 不设限（显式关掉这条边）', async () => {
  assert.equal(await withDeadline('unit_probe', 5000, async () => 'ok'), 'ok')
  assert.equal(await withDeadline('unit_probe', 0, async () => 'unbounded'), 'unbounded')
  assert.equal(deadlineMs(0), 0)
  assert.equal(deadlineMs(undefined), 0)
  assert.equal(deadlineMs(-1), 0)
  assert.equal(deadlineMs(30), 30_000)
})

test('withDeadline：输掉比赛那条腿的拒绝被就地吞掉（不炸成 unhandledRejection）', async () => {
  const rejections: unknown[] = []
  const onUnhandled = (err: unknown) => { rejections.push(err) }
  process.on('unhandledRejection', onUnhandled)
  try {
    await assert.rejects(
      // 先撞线，随后那条腿才拒绝 —— 天真写法会在这里留下一个无人接的 rejection。
      withDeadline('unit_probe', 20, () => new Promise((_r, reject) => {
        setTimeout(() => { reject(new Error('late transport failure')) }, 60)
      })),
      DeadlineExceededError,
    )
    await new Promise((r) => { setTimeout(r, 120) })
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  assert.deepEqual(rejections, [])
})

// --- ③ 判读调用：超时 + 有界重试 + 事件形状 -------------------------------------

test('判读超时：有界重试一次后终局失败，事件形状与 G-10 失败事件同族', async () => {
  const { events, log } = collector()
  let attempts = 0
  await assert.rejects(
    runInterpretWithDeadline('terminal.exec', { timeoutS: 0.03, retries: 1, logEvent: log }, () => {
      attempts += 1
      return hangsForever()
    }),
    DeadlineExceededError,
  )
  assert.equal(attempts, 2, 'retries=1 = 至多两次尝试，不多不少')

  const retry = lastEvent(events, INTERPRET_RETRY_EVENT)
  assert.ok(retry, '第一次撞线要落一条重试事件')
  assert.equal(retry.action_type, 'terminal.exec')
  assert.equal(retry.attempt, 1)
  assert.equal(retry.reason, 'timeout')
  assert.equal(retry.error_type, 'DeadlineExceededError')
  assert.equal(typeof retry.elapsed_ms, 'number')

  const failed = lastEvent(events, INTERPRET_FAILURE_EVENT)
  assert.ok(failed, '终局要落一条失败事件')
  assert.deepEqual(Object.keys(failed).sort(), [
    'action_type', 'attempts', 'elapsed_ms', 'error_type', 'reason', 'retries', 'timeout_s',
  ])
  assert.equal(failed.action_type, 'terminal.exec')
  assert.equal(failed.error_type, 'DeadlineExceededError')
  assert.equal(failed.reason, 'timeout')
  assert.equal(failed.attempts, 2)
  assert.equal(failed.timeout_s, 0.03)
  assert.equal(failed.retries, 1)
  assert.equal(typeof failed.elapsed_ms, 'number')
  // D-08：零正文 —— 事件里不许出现答复/问句/参数的任何一个字。
  assert.equal(JSON.stringify(failed).includes('答'), false)
  assert.equal(events.filter(([n]) => n === INTERPRET_RETRY_EVENT).length, 1)
})

test('判读：retries=0 = 一次就终局（有界的意思是最坏时延算得出来）', async () => {
  const { events, log } = collector()
  let attempts = 0
  await assert.rejects(
    runInterpretWithDeadline('messenger.send', { timeoutS: 0.02, retries: 0, logEvent: log }, () => {
      attempts += 1
      return hangsForever()
    }),
    DeadlineExceededError,
  )
  assert.equal(attempts, 1)
  assert.equal(eventNames(events).includes(INTERPRET_RETRY_EVENT), false)
  assert.equal(lastEvent(events, INTERPRET_FAILURE_EVENT)?.attempts, 1)
})

test('判读：传输抛（非超时）同样有界重试，reason=error 且 error_type 是真类名', async () => {
  const { events, log } = collector()
  let attempts = 0
  await assert.rejects(
    runInterpretWithDeadline('browser.open', { timeoutS: 5, retries: 1, logEvent: log }, async () => {
      attempts += 1
      throw new TypeError('provider 502')
    }),
    TypeError,
  )
  assert.equal(attempts, 2)
  const failed = lastEvent(events, INTERPRET_FAILURE_EVENT)
  assert.equal(failed?.reason, 'error')
  assert.equal(failed?.error_type, 'TypeError')
})

test('判读：第二次成功就是成功（重试留痕，不落失败事件）；一次过则安静', async () => {
  const { events, log } = collector()
  let attempts = 0
  const got = await runInterpretWithDeadline('terminal.exec', { timeoutS: 0.03, retries: 1, logEvent: log }, async (signal) => {
    attempts += 1
    if (attempts === 1) return await hangsForever()
    assert.equal(signal.aborted, false, '新一次尝试要拿到一条干净的 signal')
    return 'verdict'
  })
  assert.equal(got, 'verdict')
  assert.equal(lastEvent(events, INTERPRET_FAILURE_EVENT), undefined)
  assert.ok(lastEvent(events, INTERPRET_RETRY_EVENT))

  const quiet = collector()
  assert.equal(
    await runInterpretWithDeadline('terminal.exec', { timeoutS: 5, retries: 1, logEvent: quiet.log }, async () => 'ok'),
    'ok',
  )
  assert.deepEqual(quiet.events, [], '顺利那次不该有任何噪音')
})

// --- 周期超时（Conversation.send）-----------------------------------------------

test('周期超时：LLM 挂住 → 按时切断 + u3_cycle_timeout + S-14 整轮回滚', async () => {
  let seen: AbortSignal | undefined
  const h = makeConversation({
    cycleTimeoutS: 0.05,
    llm: async (_messages, opts) => {
      seen = opts.signal
      return await hangsForever()
    },
  })
  await assert.rejects(h.conversation.send('在吗'), DeadlineExceededError)

  const timedOut = lastEvent(h.events, CYCLE_TIMEOUT_EVENT)
  assert.ok(timedOut, '撞线要落 u3_cycle_timeout')
  assert.equal(timedOut.error_type, 'DeadlineExceededError')
  assert.equal(timedOut.reason, 'cycle_timeout')
  assert.equal(timedOut.timeout_ms, 50)
  assert.equal(typeof timedOut.elapsed_ms, 'number')
  assert.equal(typeof timedOut.run_id, 'string')
  assert.notEqual(timedOut.run_id, '')
  // 零正文：她说的那句话不许出现在事件里。
  assert.equal(JSON.stringify(timedOut).includes('在吗'), false)

  // signal 递到了信封调用那一层，并在撞线时 abort（AbortSignal 形态贯穿全程）。
  assert.ok(seen instanceof AbortSignal)
  assert.equal(seen.aborted, true)

  // S-14：整轮回滚 —— 消息列表不留半截轮，否则之后每一次装配都被毒化。
  const rolledBack = lastEvent(h.events, 'chat_turn_rolled_back')
  assert.ok(rolledBack)
  assert.ok(Number(rolledBack.dropped_messages) >= 1)
  // 失败方向不是「沉默」：这一轮**没有**成功回合的账（history 行不存在）。
  assert.equal(eventNames(h.events).includes('inner_outer_pair'), false)
})

test('周期超时后下一轮照常：回滚干净，不是把上一轮的残骸接着往下拼', async () => {
  let hang = true
  const h = makeConversation({
    cycleTimeoutS: 0.05,
    llm: async () => {
      if (hang) return await hangsForever()
      return { content: envelope() }
    },
  })
  await assert.rejects(h.conversation.send('第一句'), DeadlineExceededError)
  hang = false
  const reply = await h.conversation.send('第二句')
  assert.equal(reply, '在的，怎么了？')
  assert.ok(lastEvent(h.events, 'inner_outer_pair'), '第二轮是一个完整成功回合')
})

test('周期上限缺省 = D01_CYCLE_TIMEOUT_S；正常回合一条超时事件都不落', async () => {
  const h = makeConversation({ llm: async () => ({ content: envelope() }) })
  assert.equal(await h.conversation.send('在吗'), '在的，怎么了？')
  assert.equal(eventNames(h.events).includes(CYCLE_TIMEOUT_EVENT), false)
  assert.equal(D01_CYCLE_TIMEOUT_S, 180)
})

// --- ④ 单一出处：源码缺省 == Schema 缺省 == cordis.prod.yml ----------------------

test('三旋钮单一出处：源码常量 = Schema 缺省 = 生产 profile 的值', () => {
  assert.deepEqual({ ...D01_DEFAULTS }, {
    interpretTimeoutS: D01_INTERPRET_TIMEOUT_S,
    interpretRetries: D01_INTERPRET_RETRIES,
    cycleTimeoutS: D01_CYCLE_TIMEOUT_S,
  })
  // profile 那三行删掉 = 回到同样三个数（不是悄悄换一套语义）。
  // 故意**不给**那三个键（模拟 profile 里那三行被删掉）；断言就是缺省接得住。
  // Schemastery 的入参在类型上是解析**后**的形状，所以这里断言式地传半份。
  const resolved = Config({ dbPath: 'x', personaToml: 'y' } as Partial<Config> as Config)
  assert.equal(resolved.interpretTimeoutS, D01_DEFAULTS.interpretTimeoutS)
  assert.equal(resolved.interpretRetries, D01_DEFAULTS.interpretRetries)
  assert.equal(resolved.cycleTimeoutS, D01_DEFAULTS.cycleTimeoutS)

  const prod = readFileSync(join(import.meta.dirname, '../../../profile/cordis.prod.yml'), 'utf8')
  assert.match(prod, new RegExp(`^\\s+interpretTimeoutS: ${D01_DEFAULTS.interpretTimeoutS}$`, 'm'))
  assert.match(prod, new RegExp(`^\\s+interpretRetries: ${D01_DEFAULTS.interpretRetries}$`, 'm'))
  assert.match(prod, new RegExp(`^\\s+cycleTimeoutS: ${D01_DEFAULTS.cycleTimeoutS}$`, 'm'))
  // 位不再是占位符（「只留位不填数」的时代结束于 M4-W1）。
  assert.equal(prod.includes('<M4 填>'), false)
})
