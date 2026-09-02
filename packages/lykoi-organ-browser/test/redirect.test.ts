/**
 * D-4 红测：跳转出域即中止。
 *
 * 审批门只管得住"她想去哪个域"（`domain:<eTLD+1>` scope + 对话式审批）；
 * 它管不到"到了之后被 302 到别处"。器官承担的就是那一段：final_url 的 eTLD+1
 * 与请求不同 → 停止加载、**不读文本**、返回 redirect_off_domain。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserOrganDriver, domainOf, hostOf, isOffDomain } from '../src/driver.ts'
import { HOST_ERRORS } from '../src/protocol.ts'
import { SsrfGuard } from '../src/ssrf.ts'
import { FakeBackend, tableResolver } from './fake-backend.ts'

const TIMEOUTS = { navigate: 5000, getText: 5000, research: 5000 }

const RESOLVER = tableResolver({
  'good.example': ['93.184.216.34'],
  'www.good.example': ['93.184.216.34'],
  'blog.good.example': ['93.184.216.34'],
  'other.example': ['93.184.216.35'],
})

function makeDriver(sites: Record<string, { finalUrl?: string; title?: string; body?: string }>) {
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

test('D-4：`www.` 前缀差异不算出域（eTLD+1 相同）', async () => {
  const { driver } = makeDriver({
    'https://good.example/a': { finalUrl: 'https://www.good.example/a', title: 'T', body: '正文' },
  })
  const result = await driver.navigate('https://good.example/a')
  assert.equal(result.ok, true)
  assert.equal((result as { ok: true; data: Record<string, unknown> }).data.final_url,
    'https://www.good.example/a')
})

test('D-4：同一 eTLD+1 的子域跳转不算出域；http→https 也不算', async () => {
  const { driver } = makeDriver({
    'https://good.example/b': { finalUrl: 'https://blog.good.example/b' },
    'http://good.example/c': { finalUrl: 'https://good.example/c' },
  })
  assert.equal((await driver.navigate('https://good.example/b')).ok, true)
  assert.equal((await driver.navigate('http://good.example/c')).ok, true)
})

test('D-4：navigate 出域 → redirect_off_domain（带两端域名）+ 审计 + 不读文本', async () => {
  const { driver, events } = makeDriver({
    'https://good.example/x': {
      finalUrl: 'https://other.example/landing', title: '别处', body: '这段正文她不该读到',
    },
  })
  const result = await driver.navigate('https://good.example/x')
  assert.equal(result.ok, false)
  const failed = result as { ok: false; error: string; detail?: string }
  assert.equal(failed.error, HOST_ERRORS.redirectOffDomain)
  assert.equal(failed.detail, 'good.example->other.example')

  const audit = events.find((e) => e.name === 'browser_redirect_off_domain')
  assert.ok(audit, '必须落一条 browser_redirect_off_domain')
  assert.deepEqual(audit.fields, { op: 'navigate', from: 'good.example', to: 'other.example' })

  // 停止加载：页被扔掉，紧接着的 get_text 落 no_page —— 她没有落地，就读不到东西。
  const read = await driver.getText()
  assert.equal(read.ok, false)
  assert.equal((read as { ok: false; error: string }).error, HOST_ERRORS.noPage)
})

test('D-4：research_read_text 出域同样中止，且一次性上下文照样关掉', async () => {
  const { driver, backend, events } = makeDriver({
    'https://good.example/y': { finalUrl: 'https://other.example/y', body: '不该读到' },
  })
  const result = await driver.researchReadText('https://good.example/y')
  assert.equal(result.ok, false)
  assert.equal((result as { ok: false; error: string }).error, HOST_ERRORS.redirectOffDomain)
  assert.equal(backend.ephemeralContexts.length, 1)
  assert.equal(backend.ephemeralContexts[0]!.closed, true)
  assert.ok(events.some((e) => e.name === 'browser_redirect_off_domain'
    && e.fields.op === 'research_read_text'))
})

test('D-4 判定纯函数：eTLD+1 相同即在域；判不出来（空/畸形）一律算出域（fail closed）', () => {
  assert.equal(isOffDomain('https://good.example/a', 'https://www.good.example/b'), false)
  assert.equal(isOffDomain('https://a.b.good.example/', 'https://good.example/'), false)
  assert.equal(isOffDomain('https://good.example/', 'https://good.example.evil/'), true)
  assert.equal(isOffDomain('https://good.example/', 'https://other.example/'), true)
  assert.equal(isOffDomain('https://good.example/', 'about:blank'), true)
  assert.equal(isOffDomain('not a url', 'https://good.example/'), true)
  assert.equal(isOffDomain('https://good.example/', ''), true)
  assert.equal(hostOf('https://Good.Example/a'), 'good.example')
  assert.equal(hostOf('nonsense'), '')
  // 审计只落 eTLD+1，永不落完整 URL（D-6）。
  assert.equal(domainOf('https://blog.good.example/secret?token=abc'), 'good.example')
})

test('D-4 与审批门用的是同一个 eTLD+1 切分器（kernel scope.registeredDomain）', async () => {
  const kernel = await import('lykoi-kernel')
  for (const host of ['www.good.example', 'a.b.co.uk', '1.2.3.4', 'example.com']) {
    assert.equal(domainOf(`https://${host}/`), kernel.registeredDomain(host))
  }
})
