/**
 * D-9 红测：装配。
 *
 * 两件事分开测：
 *  1. **静态**：`profile/cordis.prod.yml` 里 browser 位存在、名字对、只有
 *     socketPath 一项配置，且**排在 converse / wake 之前**；`profile/package.json`
 *     有依赖。
 *  2. **行为**：按那个顺序装配之后，wake / converse 那两处 `OrganInventoryCache`
 *     吃到的清单块里含三个动作，`research_browser.read_text ∈ wired`（explore
 *     候选回得来）。顺序反过来则清单里没有它们 —— 这正是 D-9 要求把位置定死的
 *     原因，也是"不改 wake / converse 一行 src"的代价所在。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { BodySchemaRegistry, KNOWN_ACTION_LIST, wiredActionCatalog } from 'lykoi-kernel'
import { OrganInventoryCache } from 'lykoi-decide'
import { clearOrganHandlers, outboundOrganResources } from 'lykoi-adapter-telegram/resources'
import { BrowserHostClient, wireBrowserOrgan } from '../src/index.ts'
import { ORGAN_ACTIONS } from '../src/protocol.ts'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROD_YML = readFileSync(join(REPO, 'profile', 'cordis.prod.yml'), 'utf8')

test('D-9：prod.yml 有 browser 位，名字与 socketPath 都对', () => {
  assert.match(PROD_YML, /^- id: browser\n {2}name: lykoi-organ-browser\n {2}config:\n {4}socketPath: \/run\/lykoi-browser\/host\.sock$/m)
})

test('D-9：browser 位排在 converse 与 wake 之前（清单快照在它们的 apply 里取）', () => {
  const browser = PROD_YML.indexOf('\n- id: browser\n')
  const converse = PROD_YML.indexOf('\n- id: converse\n')
  const wake = PROD_YML.indexOf('\n- id: wake\n')
  assert.ok(browser > 0 && converse > 0 && wake > 0, '三个位都得在')
  assert.ok(browser < converse, 'browser 必须在 converse 之前')
  assert.ok(browser < wake, 'browser 必须在 wake 之前')
})

test('D-9：profile/package.json 依赖了本包', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'profile', 'package.json'), 'utf8')) as
    { dependencies: Record<string, string> }
  assert.equal(pkg.dependencies['lykoi-organ-browser'], '0.1.0')
})

/** 复刻 wake:458 / converse:241 的建法：一次 outboundOrganResources() 喂两处。 */
function inventoryBlock(): string {
  const resources = outboundOrganResources()
  const cache = new OrganInventoryCache({
    bindings: () => [],
    catalog: wiredActionCatalog(resources),
  })
  return cache.block() ?? ''
}

test('D-9：按 yml 顺序装配 → 清单块含三个动作，read_text ∈ wired', () => {
  const schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
  const unwire = wireBrowserOrgan(
    new BrowserHostClient({ socketPath: '/run/lykoi-browser/host.sock' }), () => {}, schema)
  try {
    const block = inventoryBlock()
    for (const action of ORGAN_ACTIONS) {
      assert.ok(block.includes(action), `清单块应含 ${action}\n${block}`)
    }
    const wired = wiredActionCatalog(outboundOrganResources()).knownActions
    assert.ok(wired.includes('research_browser.read_text'))
  } finally {
    unwire()
    clearOrganHandlers()
  }
})

test('D-9：顺序反了（清单先建）就看不见这三项 —— 位置不是风格问题', () => {
  const before = inventoryBlock()
  for (const action of ORGAN_ACTIONS) {
    assert.equal(before.includes(action), false, `未接线时清单不该有 ${action}`)
  }
  const schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
  const unwire = wireBrowserOrgan(
    new BrowserHostClient({ socketPath: '/run/lykoi-browser/host.sock' }), () => {}, schema)
  try {
    // 已经建好的那份快照不会自己更新（缓存的语义）；重新建一份才看得见。
    assert.equal(before.includes('browser.navigate'), false)
    assert.ok(inventoryBlock().includes('browser.navigate'))
  } finally {
    unwire()
    clearOrganHandlers()
  }
})

test('D-9：宿主不可达时接线事实不变 —— 清单照列三项', async () => {
  const schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
  const client = new BrowserHostClient({ socketPath: '/run/绝无此物/host.sock' })
  const unwire = wireBrowserOrgan(client, () => {}, schema)
  try {
    const block = inventoryBlock()
    for (const action of ORGAN_ACTIONS) assert.ok(block.includes(action))
    const resources = outboundOrganResources()
    const result = await resources.browser!.navigate!({ url: 'https://good.example/a' }) as
      Record<string, unknown>
    assert.equal(result.ok, false)
    assert.equal(result.error, 'browser_host_unreachable')
  } finally {
    unwire()
    clearOrganHandlers()
  }
})
