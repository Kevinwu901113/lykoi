/**
 * D-5②红测：下载隔离。
 *
 * 三件事各有归属：
 *  - `acceptDownloads:false` 与 `download` 事件上的 `cancel()` 住在
 *    `PlaywrightBackend`（唯一碰真浏览器的地方）——由**源码静态断言**钉住；
 *  - 审计行 `browser_download_blocked{url_domain, suggested_name_len}` 住在驱动层
 *    ——由假 backend 触发一次下载来钉；
 *  - `blob:` / `data:` / `file:` / `javascript:` 顶层导航拒绝走 SSRF 判定器
 *    ——在这里再钉一次"从动作口进来也拒"。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { BrowserOrganDriver } from '../src/driver.ts'
import { HOST_ERRORS } from '../src/protocol.ts'
import { SsrfGuard } from '../src/ssrf.ts'
import { FakeBackend, tableResolver } from './fake-backend.ts'

const TIMEOUTS = { navigate: 5000, getText: 5000, research: 5000 }
const RESOLVER = tableResolver({ 'good.example': ['93.184.216.34'] })

function makeDriver() {
  const backend = new FakeBackend({ 'https://good.example/dl': { body: '页面' } })
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

test('D-5②持久上下文装了下载钩子：触发一次 → browser_download_blocked{url_domain, suggested_name_len}', async () => {
  const { backend, driver, events } = makeDriver()
  await driver.navigate('https://good.example/dl')
  const context = backend.persistentContexts[0]!
  assert.notEqual(context.downloadHandler, null, '持久上下文必须装下载钩子')

  context.fireDownload('https://cdn.good.example/secret-payroll-2026.xlsx', 'secret-payroll-2026.xlsx')
  const audit = events.find((e) => e.name === 'browser_download_blocked')
  assert.ok(audit, '必须落一条 browser_download_blocked')
  assert.deepEqual(audit.fields, { url_domain: 'good.example', suggested_name_len: 24 })
  // 审计只留域与文件名长度：完整 URL 与文件名一个字节都不入账。
  assert.ok(!JSON.stringify(audit.fields).includes('secret-payroll'))
  assert.ok(!JSON.stringify(audit.fields).includes('cdn.good.example'))
})

test('D-5②一次性上下文同样装下载钩子（调研那只手不是例外）', async () => {
  const { backend, driver, events } = makeDriver()
  await driver.researchReadText('https://good.example/dl')
  const context = backend.ephemeralContexts[0]!
  assert.notEqual(context.downloadHandler, null)
  context.fireDownload('https://good.example/x.zip', 'x.zip')
  assert.ok(events.some((e) => e.name === 'browser_download_blocked'))
})

test('D-5②两个上下文都装了子请求判定钩子（每个子请求与每一跳重定向同样判定）', async () => {
  const { backend, driver } = makeDriver()
  await driver.navigate('https://good.example/dl')
  await driver.researchReadText('https://good.example/dl')
  const persistent = backend.persistentContexts[0]!
  const ephemeral = backend.ephemeralContexts[0]!
  assert.notEqual(persistent.filter, null)
  assert.notEqual(ephemeral.filter, null)
  // 子请求打到内网 → false（abort）；打到公网 → true。
  assert.equal(await persistent.filter!('http://169.254.169.254/latest/meta-data/'), false)
  assert.equal(await persistent.filter!('https://good.example/style.css'), true)
  assert.equal(await ephemeral.filter!('http://10.0.0.1/'), false)
})

test('D-5②blob: / data: / file: / javascript: 顶层导航从动作口进来也拒', async () => {
  const { driver } = makeDriver()
  for (const url of [
    'blob:https://good.example/9a1c',
    'data:text/html,<h1>x</h1>',
    'file:///etc/shadow',
    'javascript:fetch("http://10.0.0.1")',
  ]) {
    const navigated = await driver.navigate(url)
    assert.equal(navigated.ok, false, url)
    assert.equal((navigated as { ok: false; error: string }).error, HOST_ERRORS.blockedUrl, url)
    const researched = await driver.researchReadText(url)
    assert.equal(researched.ok, false, url)
    assert.equal((researched as { ok: false; error: string }).error, HOST_ERRORS.blockedUrl, url)
  }
})

test('D-5②静态断言：真 backend 的两处上下文构造都写死 acceptDownloads:false，download 事件一律 cancel()', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/driver.ts', import.meta.url)), 'utf8')
  // 两处：launch/launchPersistentContext 的选项，以及一次性上下文的 newContext。
  const occurrences = source.match(/acceptDownloads:\s*false/g) ?? []
  assert.equal(occurrences.length, 2, 'acceptDownloads:false 必须在两处上下文构造上各写一次')
  assert.match(source, /download\.cancel\(\)/)
  assert.ok(!/acceptDownloads:\s*true/.test(source))
})
