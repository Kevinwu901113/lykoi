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
import { loadHostConfig } from '../src/host.ts'
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

// ============ 部署模板（D-7/D-8：模板是落地的唯一出处，得能被载入） ============

test('D-7：host.json 范例能被 loadHostConfig 原样吃下，值与定案一致', () => {
  const raw = JSON.parse(
    readFileSync(join(REPO, 'deploy', 'lykoi-browser.host.json.example'), 'utf8')) as unknown
  const config = loadHostConfig(raw)
  assert.equal(config.socketPath, '/run/lykoi-browser/host.sock')
  assert.equal(config.executablePath, '/usr/bin/google-chrome')
  assert.equal(config.userDataDir, '/home/lykoi-browser/profile')
  assert.equal(config.maxChars, 20_000)
  assert.equal(config.screenshotRetentionDays, 7)
  assert.equal(config.screencast.enabled, true)
  // D-6：画面只绑环回。
  assert.match(config.screencast.listen, /^127\.0\.0\.1:\d+$/)
  assert.deepEqual(config.timeouts, { navigate: 30_000, getText: 15_000, research: 45_000 })
  // 空 proxy = 直连（null），不是空串。
  assert.equal(config.proxy, null)
})

test('D-7：unit 模板带齐隔离与资源闸，且一个 Environment= 都没有', () => {
  const unit = readFileSync(join(REPO, 'deploy', 'lykoi-browser.service.template'), 'utf8')
  for (const line of [
    'User=lykoi-browser', 'CPUQuota=200%', 'MemoryMax=2G', 'TasksMax=512',
    'ProtectSystem=strict', 'PrivateTmp=true',
    'NoNewPrivileges=true', 'Restart=on-failure',
    'RuntimeDirectory=lykoi-browser',
  ]) {
    assert.ok(unit.includes(line), `unit 模板缺 ${line}`)
  }
  assert.ok(unit.includes('--config /etc/lykoi-browser/host.json'))
  // GK-6：宿主零 env —— 单元里不许出现 Environment= / EnvironmentFile=。
  assert.equal(/^Environment(File)?=/m.test(unit), false)
})

test('D-7 复核修订：隔离靠挂载命名空间，宿主一个附加组都不带', () => {
  const unit = readFileSync(join(REPO, 'deploy', 'lykoi-browser.service.template'), 'utf8')
  const directives = unit.split('\n').filter((l) => /^[A-Za-z]+=/.test(l))

  // /home 是空 tmpfs，只有自己家被 BindPaths 挂回来 —— /home/lykoi 不在视野里。
  assert.ok(directives.includes('ProtectHome=tmpfs'), 'ProtectHome 必须是 tmpfs')
  assert.ok(directives.includes('BindPaths=/home/lykoi-browser'))
  // ProtectHome=tmpfs 只能由 BindPaths= 打洞；ReadWritePaths= 打不动，留着是误导。
  assert.equal(directives.some((l) => l.startsWith('ReadWritePaths=')), false)

  // 代码树只读挂进来，宿主不需要能走进 /home/lykoi。
  assert.ok(directives.includes(
    'BindReadOnlyPaths=/home/lykoi/projects/lykoi-cordis:/opt/lykoi-browser/tree'))
  assert.ok(unit.includes('ExecStart=<NODE_BIN> /opt/lykoi-browser/tree/'
    + 'packages/lykoi-organ-browser/src/host.ts'))
  assert.equal(unit.includes('ExecStart=<NODE_BIN> /home/lykoi/'), false,
    'ExecStart 不许再直指宿主侧的 /home/lykoi 路径')

  // 反了的那条已经删干净：宿主不许带 lykoi 组（那能穿过 750 的 /home/lykoi 读到
  // 其下 755/775 的 state/backups、reports、.config）。
  assert.equal(directives.some((l) => l.startsWith('SupplementaryGroups=')), false)

  // 沙箱前提：服务器实测 NoNewPrivileges 下 Chrome 命名空间沙箱可用，两条都保留。
  assert.ok(directives.includes('NoNewPrivileges=true'))
  assert.ok(directives.includes('RestrictSUIDSGID=true'))
})

test('D-7 复核修订：手册把组的方向写成"大脑加入 lykoi-browser 组"，且带沙箱前验', () => {
  const doc = readFileSync(join(REPO, 'docs', 'browser_organ.md'), 'utf8')
  assert.ok(doc.includes('usermod -aG lykoi-browser lykoi'), '缺"大脑加入宿主组"')
  // 行首才算命令（§0 的历史说明里那句反例是散文，不是要执行的东西）。
  assert.equal(/^usermod -aG lykoi lykoi-browser/m.test(doc), false,
    '手册里不许再有"宿主加入 lykoi 组"的可执行命令')
  assert.ok(doc.includes('chmod 700 /home/lykoi-browser'), '家目录必须 700')
  assert.ok(doc.includes('install -d -o root -g root -m 755 /opt/lykoi-browser/tree'),
    '缺 bind 挂载点')
  assert.ok(doc.includes('srw-rw---- lykoi-browser lykoi-browser'), 'socket 期望属组写错')
  // 前验：探针命令与"失败不许用 --no-sandbox"。
  assert.ok(doc.includes('setpriv --no-new-privs /usr/bin/google-chrome'), '缺沙箱探针')
  assert.ok(doc.includes('不要加 `--no-sandbox`'), '缺"探针失败不许 --no-sandbox"')
})

test('R-4：unit 带 cgroup BPF 出网闸，且没写成 Allow 全网那种自废写法', () => {
  const unit = readFileSync(join(REPO, 'deploy', 'lykoi-browser.service.template'), 'utf8')
  // 只看生效指令行，注释里的样例（代理那行）不算数。
  const directives = unit.split('\n').filter((l) => /^[A-Za-z]+=/.test(l))
  const denyLines = directives.filter((l) => l.startsWith('IPAddressDeny='))
  const allowLines = directives.filter((l) => l.startsWith('IPAddressAllow='))

  assert.ok(denyLines.length > 0, 'unit 必须有 IPAddressDeny=')
  const denied = denyLines.flatMap((l) => l.slice('IPAddressDeny='.length).trim().split(/\s+/))

  // 私网/环回/链路本地各段（169.254 是云元数据那一段，最要紧）。
  for (const cidr of [
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
    '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
    '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8',
  ]) {
    assert.ok(denied.includes(cidr), `IPAddressDeny 缺 ${cidr}`)
  }

  // Allow 只有两个环回 /32：DNS 存根与 screencast 隧道入口。多一个都要过复核。
  const allowed = allowLines.flatMap((l) => l.slice('IPAddressAllow='.length).trim().split(/\s+/))
  assert.deepEqual(allowed.sort(), ['127.0.0.1/32', '127.0.0.53/32'],
    'IPAddressAllow 只许 127.0.0.53/32（resolved 存根）与 127.0.0.1/32（screencast）')

  // 自废写法：Allow 优先于 Deny，命中全网的 Allow 会把整张 Deny 表废掉。
  for (const trap of ['0.0.0.0/0', '::/0', 'any']) {
    assert.equal(allowed.includes(trap), false,
      `IPAddressAllow 不许含 ${trap} —— Allow 优先于 Deny，那等于没装防火墙`)
  }
  // 代理那行必须还是注释（缺省 host.json 不开代理）。
  assert.ok(unit.includes('# IPAddressAllow=192.168.0.202/32'), '代理放行应保持注释形态')
  assert.equal(allowed.includes('192.168.0.202/32'), false)
})

test('D-8：两份备份文档都写了 /home/lykoi-browser/profile 与"先停服务"', () => {
  for (const rel of [
    ['docs', 'deploy.md'],
    ['governance', 'reports', 'runbook_disaster_recovery.md'],
  ]) {
    const text = readFileSync(join(REPO, ...rel), 'utf8')
    assert.ok(text.includes('/home/lykoi-browser/profile'), `${rel.join('/')} 缺备份路径`)
    assert.ok(text.includes('systemctl stop lykoi-browser.service'), `${rel.join('/')} 缺停服务`)
  }
})
