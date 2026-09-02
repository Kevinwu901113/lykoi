/**
 * D-3 红测：上下文隔离。
 *
 * `browser.*` 走持久上下文（她的登录态在里面），`research_browser.read_text` 每次
 * 都开一个全新的一次性上下文，读完即毁 —— 异常路径也要毁。两者不共享 cookie，
 * 是因为它们从来不是同一个上下文。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserOrganDriver } from '../src/driver.ts'
import { HOST_ERRORS } from '../src/protocol.ts'
import { SsrfGuard } from '../src/ssrf.ts'
import type { FakeSite } from './fake-backend.ts'
import { FakeBackend, tableResolver } from './fake-backend.ts'

const TIMEOUTS = { navigate: 5000, getText: 5000, research: 200 }

const RESOLVER = tableResolver({
  'good.example': ['93.184.216.34'],
  'slow.example': ['93.184.216.36'],
  'boom.example': ['93.184.216.37'],
})

function makeDriver(sites: Record<string, FakeSite>) {
  const backend = new FakeBackend(sites)
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const driver = new BrowserOrganDriver({
    backend,
    guard: new SsrfGuard({ resolve: RESOLVER }),
    dataDir: '',
    timeouts: TIMEOUTS,
    emit: (name, fields) => events.push({ name, fields }),
  })
  return { backend, driver, events }
}

test('D-3：research 用一次性上下文，成功路径上响应前已关闭', async () => {
  const { backend, driver } = makeDriver({
    'https://good.example/doc': { title: 'D', body: '一段外部正文' },
  })
  const result = await driver.researchReadText('https://good.example/doc')
  assert.equal(result.ok, true)
  assert.equal(backend.ephemeralContexts.length, 1)
  assert.equal(backend.ephemeralContexts[0]!.closed, true)
  // 持久上下文根本没被碰过：她的登录态不进这条路。
  assert.equal(backend.persistentContexts.length, 0)
})

test('D-3：两次 research → 两个互不相同的上下文，且都关掉了', async () => {
  const { backend, driver } = makeDriver({
    'https://good.example/1': { body: 'a' },
    'https://good.example/2': { body: 'b' },
  })
  await driver.researchReadText('https://good.example/1')
  await driver.researchReadText('https://good.example/2')
  assert.equal(backend.ephemeralContexts.length, 2)
  assert.notEqual(backend.ephemeralContexts[0], backend.ephemeralContexts[1])
  assert.deepEqual(backend.ephemeralContexts.map((c) => c.closed), [true, true])
})

test('D-3：导航抛异常时一次性上下文照样关闭', async () => {
  const { backend, driver } = makeDriver({
    'https://boom.example/x': { failWith: 'net::ERR_CONNECTION_REFUSED' },
  })
  const result = await driver.researchReadText('https://boom.example/x')
  assert.equal(result.ok, false)
  assert.equal((result as { ok: false; error: string }).error, HOST_ERRORS.navigationFailed)
  assert.equal(backend.ephemeralContexts.length, 1)
  assert.equal(backend.ephemeralContexts[0]!.closed, true)
})

test('D-3：超时路径也不会漏掉一次性上下文', async () => {
  const { backend, driver } = makeDriver({
    'https://slow.example/x': { delayMs: 2000, body: '来不及' },
  })
  const result = await driver.researchReadText('https://slow.example/x')
  assert.equal(result.ok, false)
  assert.equal((result as { ok: false; error: string }).error, HOST_ERRORS.timeout)
  assert.equal(backend.ephemeralContexts.length, 1)
  assert.equal(backend.ephemeralContexts[0]!.closed, true)
})

test('D-3：SSRF 拦下时压根不开一次性上下文', async () => {
  const { backend, driver } = makeDriver({})
  const result = await driver.researchReadText('http://127.0.0.1:8080/admin')
  assert.equal(result.ok, false)
  assert.equal((result as { ok: false; error: string }).error, HOST_ERRORS.blockedUrl)
  assert.equal(backend.ephemeralContexts.length, 0)
})

test('D-3：research 不动持久上下文 —— 中间插一次 research，navigate 的页面还在', async () => {
  const { backend, driver } = makeDriver({
    'https://good.example/home': { title: '首页', body: '登录后的正文' },
    'https://good.example/doc': { title: 'D', body: '外部正文' },
  })
  assert.equal((await driver.navigate('https://good.example/home')).ok, true)
  const persistent = backend.persistentContexts[0]!
  await driver.researchReadText('https://good.example/doc')
  assert.equal(persistent.closed, false)
  assert.equal(driver.hasPage(), true)
  const text = await driver.getText()
  assert.equal(text.ok, true)
  assert.match(String((text as { ok: true; data: Record<string, unknown> }).data.text), /登录后的正文/)
  // 全程只开过一个持久上下文。
  assert.equal(backend.persistentContexts.length, 1)
})
