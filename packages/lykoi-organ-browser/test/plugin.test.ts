/**
 * D-1/D-9 红测：大脑侧插件（假 socket 宿主）。
 *
 * 这里不起 Chrome —— 宿主用真的 `createHostServer` 配一个假 driver 起在 tmp
 * socket 上。测的是插件那一半：三动作注册/注销往返、宿主不可达不阻塞、串行
 * 纪律的 `busy`、审计摘要不泄露正文与完整 URL。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createDispatch, isUnwiredHandler, wiredActionCatalog, BodySchemaRegistry, KNOWN_ACTION_LIST }
  from 'lykoi-kernel'
import { clearOrganHandlers, outboundOrganResources } from 'lykoi-adapter-telegram/resources'
import type { Server } from 'node:net'
import { createHostServer, type HostDriverLike } from '../src/host.ts'
import { ACTION_TO_OP, HOST_ERRORS, ORGAN_ACTIONS, ORGAN_ID } from '../src/protocol.ts'
import { BrowserOrganDriver } from '../src/driver.ts'
import { SsrfGuard } from '../src/ssrf.ts'
import { FakeBackend } from './fake-backend.ts'
import { BrowserHostClient, auditDomain, createOrganHandler, wireBrowserOrgan } from '../src/index.ts'

const TMP = mkdtempSync(join(tmpdir(), 'lykoi-browser-plugin-'))
after(() => rmSync(TMP, { recursive: true, force: true }))

/** 假 driver：只回形状，不碰浏览器。`delayMs` 用来制造"正在忙"。 */
function fakeDriver(opts: { delayMs?: number } = {}): HostDriverLike {
  const wait = async () => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
  }
  return {
    async navigate(url: string) {
      await wait()
      return { ok: true as const, data: { url, final_url: url, title: 'T', screenshot: 's.png' } }
    },
    async getText() {
      await wait()
      return {
        ok: true as const,
        data: {
          url: 'https://good.example/a', title: 'T', text: '正文', chars: 2,
          truncated: false, untrusted: true, screenshot: 's.png',
        },
      }
    },
    async researchReadText(url: string) {
      await wait()
      return {
        ok: true as const,
        data: {
          url, final_url: url, title: 'T', text: '外部正文', chars: 4,
          truncated: true, untrusted: true, screenshot: 's.png',
        },
      }
    },
  }
}

let socketSeq = 0

async function startHost(driver: HostDriverLike): Promise<{ path: string; close: () => Promise<void> }> {
  const path = join(TMP, `host-${++socketSeq}.sock`)
  const server: Server = createHostServer({ driver })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  return {
    path,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test('D-1/D-9：三动作注册往返 —— 注册后 wired 含三项，注销后替身回位（无幻肢）', async () => {
  const before = outboundOrganResources()
  for (const action of ORGAN_ACTIONS) {
    const [prefix, method] = action.split('.', 2) as [string, string]
    assert.equal(isUnwiredHandler(before[prefix]![method]!), true, `${action} 起点应是替身`)
  }

  const schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
  const client = new BrowserHostClient({ socketPath: join(TMP, 'nobody.sock') })
  const unwire = wireBrowserOrgan(client, () => {}, schema)

  const wired = wiredActionCatalog(outboundOrganResources()).knownActions
  for (const action of ORGAN_ACTIONS) {
    assert.ok(wired.includes(action), `${action} 应在 wired 清单里`)
  }
  // explore 候选回来的那一项。
  assert.ok(wired.includes('research_browser.read_text'))
  // 其余六项刻意保持替身（capability_gap 是 v2 词汇的输入）。
  for (const still of ['browser.click', 'browser.type', 'browser.screenshot',
    'research_browser.open', 'research_browser.extract_links', 'research_browser.screenshot']) {
    assert.equal(wired.includes(still), false, `${still} 不该在 v1 接线`)
  }
  assert.deepEqual(schema.organIds(), [ORGAN_ID])
  assert.deepEqual(schema.snapshot().actions, [...ORGAN_ACTIONS].sort())

  unwire()

  assert.deepEqual(schema.organIds(), [])
  const after = wiredActionCatalog(outboundOrganResources()).knownActions
  for (const action of ORGAN_ACTIONS) {
    assert.equal(after.includes(action), false, `${action} 注销后不该还在清单里`)
  }
  clearOrganHandlers()
})

test('D-1：注销器幂等（cordis 异常路径上可能调两次）', () => {
  const schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
  const client = new BrowserHostClient({ socketPath: join(TMP, 'nobody.sock') })
  const unwire = wireBrowserOrgan(client, () => {}, schema)
  unwire()
  unwire()
  assert.deepEqual(schema.organIds(), [])
  clearOrganHandlers()
})

test('D-1：宿主不可达 → browser_host_unreachable，且远早于 2.5s（不抛、不阻塞）', async () => {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const client = new BrowserHostClient({ socketPath: join(TMP, '不存在.sock') })
  const handler = createOrganHandler('browser.navigate', client,
    (name, fields) => events.push({ name, fields }))
  const started = Date.now()
  const result = await handler({ url: 'https://good.example/a' })
  const elapsed = Date.now() - started
  assert.equal(result.ok, false)
  assert.equal(result.error, HOST_ERRORS.unreachable)
  assert.ok(elapsed < 2500, `不可达应在 2.5s 内返回，实测 ${elapsed}ms`)
  assert.equal(events[0]!.fields.status, HOST_ERRORS.unreachable)
})

test('D-1：宿主串行 —— 第二个并发请求立刻拿到 busy，不排队', async () => {
  const host = await startHost(fakeDriver({ delayMs: 200 }))
  const client = new BrowserHostClient({ socketPath: host.path })
  const first = client.call('navigate', { url: 'https://good.example/a' })
  const second = client.call('navigate', { url: 'https://good.example/b' })
  const [a, b] = await Promise.all([first, second])
  const oks = [a, b].filter((r) => r.ok)
  const busies = [a, b].filter((r) => r.error === HOST_ERRORS.busy)
  assert.equal(oks.length, 1)
  assert.equal(busies.length, 1)
  await host.close()
})

test('D-1：health 通 + 三个动作经真宿主往返（假 driver）', async () => {
  const host = await startHost(fakeDriver())
  const client = new BrowserHostClient({ socketPath: host.path })
  assert.equal((await client.call('health')).ok, true)

  const nav = createOrganHandler('browser.navigate', client, () => {})
  const navResult = await nav({ url: 'https://good.example/a' })
  assert.equal(navResult.ok, true)
  assert.equal(navResult.final_url, 'https://good.example/a')

  const read = createOrganHandler('research_browser.read_text', client, () => {})
  const readResult = await read({ url: 'https://good.example/doc' })
  assert.equal(readResult.ok, true)
  // reflow 的 explore 就读这一格（observation.data.text）。
  assert.equal(readResult.text, '外部正文')
  assert.equal(readResult.untrusted, true)
  await host.close()
})

test('D-1：get_text 不需要 url；navigate/read_text 缺 url 在大脑侧就被拦（不打扰宿主）', async () => {
  const client = new BrowserHostClient({ socketPath: join(TMP, 'nobody.sock') })
  for (const action of ['browser.navigate', 'research_browser.read_text'] as const) {
    const handler = createOrganHandler(action, client, () => {})
    const result = await handler({})
    assert.equal(result.ok, false)
    assert.equal(result.error, HOST_ERRORS.badRequest)
  }
  const host = await startHost(fakeDriver())
  const live = new BrowserHostClient({ socketPath: host.path })
  const getText = createOrganHandler('browser.get_text', live, () => {})
  assert.equal((await getText({})).ok, true)
  await host.close()
})

test('WO-FIX-ORGANOK-01：宿主回 timeout → 经 kernel 的 Observation.success 为 false，detail 仍在 data 里', async () => {
  // 器官整条链路（假 driver → 真宿主 → 真 client → 真 handler → 真 dispatch）：
  // 器官不抛而返回 {ok:false,...}，内核得听见它说的失败（否则超时记 success:true，
  // 白皮书 37.8 的回执背书在超时上失效）。
  process.env.LYKOI_APPROVAL_RULES = join(TMP, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(TMP, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(TMP, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(TMP, 'notifications.json')
  const timingOut: HostDriverLike = {
    ...fakeDriver(),
    async researchReadText() {
      return { ok: false as const, error: HOST_ERRORS.timeout, detail: '45s 未回' }
    },
  }
  const host = await startHost(timingOut)
  const schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
  const client = new BrowserHostClient({ socketPath: host.path })
  const unwire = wireBrowserOrgan(client, () => {}, schema)
  try {
    const dispatch = createDispatch({
      sink: { async record() {} },
      resources: outboundOrganResources(),
    })
    const observation = await dispatch(
      { type: 'research_browser.read_text', params: { url: 'https://good.example/doc' } },
      { context: { origin: 'autonomous' } }, // AUTONOMOUS_ALLOWED 里那一项
    )
    assert.equal(observation.success, false)
    assert.equal(observation.error, HOST_ERRORS.timeout)
    assert.equal(observation.data.ok, false)
    assert.equal(observation.data.detail, '45s 未回')
  } finally {
    unwire()
    clearOrganHandlers()
    await host.close()
  }
})

test('D-6：browser_action 摘要只有六个字段，不含正文、不含完整 URL', async () => {
  const host = await startHost(fakeDriver())
  const client = new BrowserHostClient({ socketPath: host.path })
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const handler = createOrganHandler('research_browser.read_text', client,
    (name, fields) => events.push({ name, fields }))
  await handler({ url: 'https://deep.good.example/a/b?token=秘密' })
  assert.equal(events.length, 1)
  assert.equal(events[0]!.name, 'browser_action')
  assert.deepEqual(Object.keys(events[0]!.fields).sort(),
    ['chars', 'domain', 'duration_ms', 'op', 'status', 'truncated'])
  assert.deepEqual(events[0]!.fields.domain, 'good.example')
  assert.equal(events[0]!.fields.truncated, true)
  assert.equal(events[0]!.fields.chars, 4)
  const serialized = JSON.stringify(events[0])
  assert.equal(serialized.includes('外部正文'), false)
  assert.equal(serialized.includes('秘密'), false)
  assert.equal(serialized.includes('/a/b'), false)
  await host.close()
})

test('D-6：auditDomain 只到 eTLD+1，畸形 URL 落 unknown', () => {
  assert.equal(auditDomain('https://www.good.example/x'), 'good.example')
  assert.equal(auditDomain('https://a.b.good.co.uk/x'), 'good.co.uk')
  assert.equal(auditDomain('不是个 URL'), 'unknown')
  assert.equal(auditDomain(undefined), 'unknown')
})

// ============ D-2：三个动作的返回形状（表里那三行就是契约） ============

test('D-2：navigate / get_text / research_read_text 的 data 键集逐字对表', async () => {
  const backend = new FakeBackend({
    'https://good.example/a': { title: 'T', body: '正文' },
    'https://good.example/doc': { title: 'D', body: '外部正文' },
  })
  const driver = new BrowserOrganDriver({
    backend,
    guard: new SsrfGuard({ resolve: async () => ['93.184.216.34'] }),
    dataDir: '',
    timeouts: { navigate: 5000, getText: 5000, research: 5000 },
  })
  const nav = await driver.navigate('https://good.example/a')
  assert.deepEqual(Object.keys((nav as { ok: true; data: object }).data).sort(),
    ['final_url', 'screenshot', 'title', 'url'])
  const text = await driver.getText()
  assert.deepEqual(Object.keys((text as { ok: true; data: object }).data).sort(),
    ['chars', 'screenshot', 'text', 'title', 'truncated', 'untrusted', 'url'])
  const research = await driver.researchReadText('https://good.example/doc')
  assert.deepEqual(Object.keys((research as { ok: true; data: object }).data).sort(),
    ['chars', 'final_url', 'screenshot', 'text', 'title', 'truncated', 'untrusted', 'url'])
})

test('D-2：其余六项刻意不接 —— research_browser.open 在 op 表里也没有对应项', () => {
  assert.deepEqual(Object.keys(ACTION_TO_OP).sort(), [...ORGAN_ACTIONS].sort())
  assert.equal(Object.hasOwn(ACTION_TO_OP, 'research_browser.open'), false)
})
