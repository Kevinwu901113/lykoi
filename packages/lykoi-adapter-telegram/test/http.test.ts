/**
 * M4 前置 #8：BotApiTransport 真 HTTP 接线的红测。
 *
 * 四样逐条钉（真 fetch / 代理 / 超时 / `trust_env=false` 等价），外加那条最硬的
 * **token 零外泄**：请求 URL 里带着 bot token，所以「一次 `String(exc)` 落日志」
 * 就等于把凭据写进磁盘。下面用一个**故意把完整 URL 塞进 message 与 cause** 的
 * 假 fetch 去撞它 —— 抛出来的东西、落账的记录、事件流里，一个 token 字节都不许有。
 *
 * 时钟纪律：超时断言用 20ms 量级的真实等待（远低于「不许真 sleep 长于 1s」的
 * 红线），且判定与测量都在被测那一侧同一条 AbortSignal 上，不牵扯任何夹具日期。
 *
 * 本文件仍然**零真网**：`fetch` 全程注入。真 fetch 只在生产装配面被选中，这一点
 * 由文末的源码扫描红测钉死。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFINITE_CONNECT_CODES, DEFAULT_HTTP_TIMEOUT_S, createFetchHttpPost, sanitizeTransportError,
  type FetchLike,
} from '../src/http.ts'
import {
  BotApiTransport, DEFINITE_FAILURE_ERRORS, setTransportLogEvent,
  setUndeliveredExperienceSink, undelivered, undeliveredPath,
} from '../src/index.ts'
import { ProductionTelegramTransport } from '../src/production.ts'
import { isolateOutboundState } from '../src/testing.ts'

const SRC = new URL('../src/', import.meta.url).pathname
/** 一个**看起来像真的**的 token（红测拿它逐字节搜索）。 */
const SECRET = '7654321:AAH-this-is-a-fake-bot-token-do-not-use'

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-tg-http-'))
  isolateOutboundState(dir)
  setTransportLogEvent(null)
  setUndeliveredExperienceSink(null)
  return dir
}

function telemetry(): { name: string; fields: Record<string, unknown> }[] {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  setTransportLogEvent((name, fields) => events.push({ name, fields }))
  return events
}

/** 一次成功响应的假 fetch（记下它收到的一切）。 */
function fakeFetch(status: number, body: string) {
  const seen: { url: string; init: Parameters<FetchLike>[1] }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, init })
    return { status, text: async () => body }
  }
  return { fetchImpl, seen }
}

// --- ① 真 fetch 的调用形状 ------------------------------------------------------

test('前置#8 调用形状：POST + application/json + JSON 正文；status 与同步 json() 原样带出', async () => {
  const { fetchImpl, seen } = fakeFetch(200, JSON.stringify({ ok: true, result: { message_id: 7 } }))
  const post = createFetchHttpPost({ fetch: fetchImpl })
  const response = await post('https://api.telegram.org/botX/sendMessage', { chat_id: '1001', text: '嗨' }, {})
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.init.method, 'POST')
  assert.equal(seen[0]!.init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(seen[0]!.init.body), { chat_id: '1001', text: '嗨' })
  assert.equal(response.status, 200)
  // `HttpResponse.json()` 是**同步**的（正文在 post 里读完）—— 上层照 httpx 形态用。
  assert.deepEqual(response.json(), { ok: true, result: { message_id: 7 } })
})

test('前置#8 坏正文：json() 抛，由上层归成 bad_response（不取任何 message）', async () => {
  isolate()
  const events = telemetry()
  const { fetchImpl } = fakeFetch(200, '<html>502 Bad Gateway</html>')
  const transport = new BotApiTransport({
    token: SECRET, post: createFetchHttpPost({ fetch: fetchImpl }),
    apiBase: 'https://example.invalid', sleep: async () => {},
  })
  const result = await transport.sendMessage({ contextId: '1001', text: 'x' })
  assert.equal(result.error, 'bad_response')
  const bad = events.find((e) => e.name === 'telegram_transport_bad_response')!
  assert.deepEqual(Object.keys(bad.fields).sort(), ['method', 'status'])
})

// --- ② 超时 ---------------------------------------------------------------------

test('前置#8 超时：每次请求一条 AbortSignal 边，撞线即断（歧义类 → 上层会重试）', async () => {
  let handed: AbortSignal | undefined
  const fetchImpl: FetchLike = (_url, init) => {
    handed = init.signal
    // 合作的对面：signal 一 abort 就用它的 reason 拒绝（真 fetch 的行为）。
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => { reject(init.signal.reason) })
    })
  }
  const post = createFetchHttpPost({ fetch: fetchImpl })
  await assert.rejects(
    post('https://api.telegram.org/botX/getUpdates', {}, { timeoutS: 0.02 }),
    (exc: unknown) => {
      assert.ok(exc instanceof Error)
      assert.equal(exc.name, 'TimeoutError')
      // 超时**不是**「确定未发出」：请求可能已经到了 Telegram（保守方向）。
      assert.equal(DEFINITE_FAILURE_ERRORS.includes(exc.name), false)
      return true
    },
  )
  assert.ok(handed instanceof AbortSignal)
  assert.equal(handed.aborted, true)
  assert.equal(DEFAULT_HTTP_TIMEOUT_S, 30)
})

// --- 错误分类（决定 ambiguous 标记） ---------------------------------------------

test('前置#8 分类：连不上 = ConnectError（确定未发出）；其余一律歧义', () => {
  for (const code of DEFINITE_CONNECT_CODES) {
    const exc = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) })
    const clean = sanitizeTransportError(exc)
    assert.equal(clean.name, 'ConnectError', code)
    assert.ok(DEFINITE_FAILURE_ERRORS.includes(clean.name))
  }
  // ETIMEDOUT / ECONNRESET 都可能发生在请求已送到之后 → **不许**标成确定。
  for (const code of ['ETIMEDOUT', 'ECONNRESET', 'EPIPE']) {
    const exc = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) })
    assert.equal(DEFINITE_FAILURE_ERRORS.includes(sanitizeTransportError(exc).name), false, code)
  }
  // 超时的几副面孔都归 TimeoutError（歧义）。
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  assert.equal(sanitizeTransportError(abort).name, 'TimeoutError')
  assert.equal(sanitizeTransportError(new Error('who knows')).name, 'TransportError')
})

// --- ③ token 零外泄（本单最硬的一条） --------------------------------------------

test('前置#8 token 零外泄：原始异常把 URL 嵌进 message 与 cause，出口一个字节都不带', async () => {
  const url = `https://api.telegram.org/bot${SECRET}/sendMessage`
  const raw = Object.assign(new TypeError(`request to ${url} failed`), {
    cause: Object.assign(new Error(`connect ECONNREFUSED for ${url}`), { code: 'ECONNREFUSED' }),
  })
  const fetchImpl: FetchLike = async () => { throw raw }
  const post = createFetchHttpPost({ fetch: fetchImpl })
  await assert.rejects(post(url, {}, {}), (exc: unknown) => {
    assert.ok(exc instanceof Error)
    assert.equal(exc.name, 'ConnectError')
    // message / stack / 整个对象 JSON 化 —— 三条路都搜不到 token。
    assert.equal(exc.message.includes(SECRET), false, 'message 泄了 token')
    assert.equal(String(exc.stack ?? '').includes(SECRET), false, 'stack 泄了 token')
    assert.equal(JSON.stringify(exc, Object.getOwnPropertyNames(exc)).includes(SECRET), false)
    // 原始对象整个被丢掉：cause 不再挂着（否则一次 `String(exc.cause)` 就漏了）。
    assert.equal((exc as { cause?: unknown }).cause, undefined)
    return true
  })
})

test('前置#8 token 零外泄（端到端）：事件流 / 未送达账本 / 返回值都不含 token', async () => {
  isolate()
  const events = telemetry()
  const url = `https://api.telegram.org/bot${SECRET}/sendMessage`
  const fetchImpl: FetchLike = async () => {
    throw Object.assign(new TypeError(`request to ${url} failed`), {
      cause: Object.assign(new Error(url), { code: 'ECONNREFUSED' }),
    })
  }
  const transport = new BotApiTransport({
    token: SECRET, post: createFetchHttpPost({ fetch: fetchImpl }), sleep: async () => {},
  })
  const result = await transport.sendMessage({ contextId: '1001', text: '她想说的话' })
  assert.equal(result.sent, false)
  assert.equal(result.undelivered_recorded, true)
  assert.equal(result.ambiguous, false, 'ECONNREFUSED = 确定未发出')
  assert.equal(undelivered()[0]!.error, 'ConnectError', '账本记的是**类别**')
  for (const dump of [
    JSON.stringify(result),
    JSON.stringify(events),
    readFileSync(undeliveredPath(), 'utf8'),
  ]) {
    assert.equal(dump.includes(SECRET), false)
    assert.equal(dump.includes('api.telegram.org'), false, 'URL 一并不许出现')
  }
})

// --- ④ 代理：大声不支持（绝不静默退化成直连） -----------------------------------

test('前置#8 代理：配了就构造期抛；措辞不回显代理地址本身', () => {
  assert.throws(
    () => createFetchHttpPost({ proxy: 'http://10.0.0.1:7890' }),
    (exc: unknown) => {
      assert.ok(exc instanceof Error)
      assert.match(exc.message, /proxied egress is not implemented/)
      assert.equal(exc.message.includes('10.0.0.1'), false)
      return true
    },
  )
  // 空串/缺席 = 直连，正常构造（今天生产走这条）。
  assert.equal(typeof createFetchHttpPost({ proxy: '' }), 'function')
  assert.equal(typeof createFetchHttpPost({ proxy: '   ' }), 'function')
  assert.equal(typeof createFetchHttpPost({}), 'function')
  // 生产装配面同理：proxy 非空 = 起不来，而不是悄悄裸奔。
  assert.throws(
    () => new ProductionTelegramTransport(SECRET, { proxy: 'http://10.0.0.1:7890' }),
    /proxied egress is not implemented/,
  )
})

// --- 生产桥：形状转换，零策略 ----------------------------------------------------

test('前置#8 生产桥：poll/send 桥到 BotApiTransport（纪律不复制一遍，只转形状）', async () => {
  isolate()
  const poll = fakeFetch(200, JSON.stringify({
    ok: true,
    result: [{
      update_id: 12,
      message: {
        message_id: 900, date: 1756000000, text: '在吗',
        chat: { id: 1001 }, from: { id: 1001 },
        reply_to_message: { message_id: 880 },
      },
    }],
  }))
  const polling = new ProductionTelegramTransport(SECRET, {
    api: new BotApiTransport({
      token: SECRET, post: createFetchHttpPost({ fetch: poll.fetchImpl }),
    }),
  })
  const updates = await polling.poll(5, { timeoutS: 25 })
  assert.equal(updates.length, 1)
  assert.equal(updates[0]!.updateId, 12)
  assert.equal(updates[0]!.message!.chatId, '1001')
  assert.equal(updates[0]!.message!.text, '在吗')
  assert.equal(updates[0]!.message!.replyToMessageId, '880')
  assert.deepEqual(JSON.parse(poll.seen[0]!.init.body), { offset: 5, timeout: 25 })

  const sending = fakeFetch(200, JSON.stringify({ ok: true, result: { message_id: 4242 } }))
  const sender = new ProductionTelegramTransport(SECRET, {
    api: new BotApiTransport({
      token: SECRET, post: createFetchHttpPost({ fetch: sending.fetchImpl }),
    }),
  })
  const sent = await sender.send('1001', '在的', '900')
  assert.deepEqual(sent, { messageId: '4242', sent: true })
  assert.equal(JSON.parse(sending.seen[0]!.init.body).reply_to_message_id, 900)
})

test('前置#8 生产桥：发失败 = 类别 + sent:false（两种结局的另一头已在账本里）', async () => {
  isolate()
  const fetchImpl: FetchLike = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  }
  const bridge = new ProductionTelegramTransport(SECRET, {
    api: new BotApiTransport({
      token: SECRET, post: createFetchHttpPost({ fetch: fetchImpl }), sleep: async () => {},
    }),
  })
  const result = await bridge.send('1001', '掉了的那句', null)
  assert.equal(result.sent, false)
  assert.equal(result.messageId, null)
  assert.equal(result.error, 'network_error')
  assert.equal(undelivered().length, 1, '未送达账本是另一头结局')
})

// --- ⑤ 结构纪律：零 env 读取 / trust_env=false 等价 / 真 fetch 唯一选择点 --------

/** 去掉整行注释与 JSDoc 续行 —— 扫的是**代码**，不是我们写给自己看的话。 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))
    })
    .join('\n')
}

function srcFiles(): string[] {
  return readdirSync(SRC).filter((f) => f.endsWith('.ts')).sort()
}

test('前置#8 transport 自身**零 env 读取**（代理钉面不许有后门）', () => {
  for (const file of ['transport.ts', 'http.ts']) {
    assert.equal(codeOf(join(SRC, file)).includes('process.env'), false,
      `${file} 读了 env —— 前置 #8 逐字要求传输层零 env 读取`)
  }
  // 包里其余的 env 读都是**治理 state 路径**那一类（GK-6 钉面逐条钉着），
  // 与传输层无关。这里钉的是"传输层不许有第二个入口"，不是全包禁 env。
  const httpLayer = ['transport.ts', 'http.ts']
  for (const file of srcFiles()) {
    if (!httpLayer.includes(file)) continue
    assert.equal(codeOf(join(SRC, file)).includes('process.env'), false, file)
  }
  // 生产装配面那一处是 token 的 env 引用（凭据永不落配置）——它必须还在。
  assert.ok(codeOf(join(SRC, 'production.ts')).includes('process.env[config.tokenEnv]'))
})

test('前置#8 `trust_env=false` 等价：本包永不给 Node 打开 env 代理那条路', () => {
  for (const file of srcFiles()) {
    const code = codeOf(join(SRC, file))
    // 这两样是 Node 内建 fetch 唯一的「改道」开关；本包一样都不碰。
    assert.equal(code.includes('setGlobalProxyFromEnv'), false, file)
    assert.equal(code.includes('NODE_USE_ENV_PROXY'), false, file)
    // 代理 env 名只作为**常量声明**存在（给 GK-6 扫描当钉面依据），不许被读。
    assert.equal(code.includes('env[PROXY_ENV_VAR]'), false, file)
  }
})

test('前置#8 真 fetch **只在生产装配面被选中**（测试零真网靠的是没有别的入口）', () => {
  const selectors = srcFiles().filter((f) => f !== 'http.ts' && codeOf(join(SRC, f)).includes('createFetchHttpPost'))
  assert.deepEqual(selectors, ['production.ts'])
  // 包根不导出它：拿到真 fetch 只有一条显式路径（`./http`）。
  assert.equal(codeOf(join(SRC, 'index.ts')).includes('./http.ts'), false)
})
