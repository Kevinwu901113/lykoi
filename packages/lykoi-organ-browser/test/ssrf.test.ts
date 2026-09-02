/**
 * D-5 第一道·红测表：SSRF / URL 判定器。
 *
 * 派工单要求"上列每一类地址/主机名/scheme/端口至少一例，含『公网主机名解析到
 * 私网地址』（DNS rebinding 形态）与 IPv4-mapped v6；全部须拒"。本文件是那张表
 * 的可执行形态：每一行一个断言，红的方向永远是"该拒的拒住了"。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SSRF_REASONS, SsrfGuard, embeddedIpv4, inspectUrl, isBlockedAddress, isBlockedHostname,
  isBlockedIpv4, isBlockedIpv6, isIpLiteral, isSingleLabelHost, parseIpv4, parseIpv6,
} from '../src/ssrf.ts'

function guardOf(table: Record<string, readonly string[]>): SsrfGuard {
  return new SsrfGuard({
    resolve: async (host) => {
      const hit = table[host]
      if (hit === undefined) throw new Error(`test resolver: 未登记的主机 ${host}`)
      return hit
    },
  })
}

// ============================== scheme ==============================

test('D-5①scheme：只许 http/https —— file/data/blob/javascript/ftp/ws 全拒', () => {
  for (const url of [
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/2b2d-4f',
    'javascript:alert(document.cookie)',
    'ftp://example.com/x',
    'ws://example.com/socket',
    'gopher://example.com/1',
  ]) {
    const verdict = inspectUrl(url)
    assert.equal(verdict.ok, false, `${url} 必须拒`)
    assert.equal(verdict.reason, SSRF_REASONS.schemeNotAllowed, url)
  }
  assert.equal(inspectUrl('https://example.com/a').ok, true)
  assert.equal(inspectUrl('http://example.com/a').ok, true)
})

test('D-5①URL 畸形：空串/非 URL/无主机 → malformed_url（判不出来就拒）', () => {
  for (const url of ['', '   ', 'not a url', 'http://', '://example.com']) {
    const verdict = inspectUrl(url)
    assert.equal(verdict.ok, false, `${JSON.stringify(url)} 必须拒`)
    assert.equal(verdict.reason, SSRF_REASONS.malformedUrl, JSON.stringify(url))
  }
})

// ============================== 端口 ==============================

test('D-5①端口：只许 80/443 或省略 —— 8080/3000/22/8443 全拒', () => {
  for (const url of [
    'http://example.com:8080/',
    'https://example.com:3000/',
    'http://example.com:22/',
    'https://example.com:8443/',
    'https://example.com:0/',
  ]) {
    const verdict = inspectUrl(url)
    assert.equal(verdict.ok, false, `${url} 必须拒`)
    assert.equal(verdict.reason, SSRF_REASONS.portNotAllowed, url)
  }
  assert.equal(inspectUrl('http://example.com:80/').ok, true)
  assert.equal(inspectUrl('https://example.com:443/').ok, true)
})

// ============================== IP 字面量 ==============================

test('D-5①IP 字面量：v4 / v6 / 方括号 v6 / IPv4-mapped v6 一律拒（哪怕是公网地址）', () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://93.184.216.34/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[2606:2800:220:1:248:1893:25c8:1946]/',
  ]) {
    const verdict = inspectUrl(url)
    assert.equal(verdict.ok, false, `${url} 必须拒`)
    assert.equal(verdict.reason, SSRF_REASONS.ipLiteral, url)
  }
  assert.equal(isIpLiteral('127.0.0.1'), true)
  assert.equal(isIpLiteral('::1'), true)
  assert.equal(isIpLiteral('example.com'), false)
})

// ============================== 主机名禁表 ==============================

test('D-5①主机名：localhost / *.localhost / *.local / *.internal / *.home.arpa 全拒（含尾点、大写）', () => {
  for (const url of [
    'http://localhost/',
    'http://LOCALHOST./',
    'http://api.localhost/',
    'http://printer.local/',
    'http://vault.internal/',
    'http://gateway.home.arpa/',
    'http://home.arpa/',
  ]) {
    const verdict = inspectUrl(url)
    assert.equal(verdict.ok, false, `${url} 必须拒`)
    assert.equal(verdict.reason, SSRF_REASONS.blockedHostname, url)
  }
  assert.equal(isBlockedHostname('localhost'), true)
  assert.equal(isBlockedHostname('notlocalhost.com'), false)
  assert.equal(isBlockedHostname('example.com'), false)
})

test('D-5①单标签主机名（intranet / router / wiki）→ single_label_host', () => {
  for (const url of ['http://intranet/', 'http://router/', 'http://wiki/page']) {
    const verdict = inspectUrl(url)
    assert.equal(verdict.ok, false, `${url} 必须拒`)
    assert.equal(verdict.reason, SSRF_REASONS.singleLabelHost, url)
  }
  assert.equal(isSingleLabelHost('intranet'), true)
  assert.equal(isSingleLabelHost('example.com'), false)
})

// ============================== 地址段 ==============================

test('D-5①v4 禁段逐条：0/8 10/8 100.64/10 127/8 169.254/16 172.16/12 192.168/16 224/4 240/4 255.255.255.255', () => {
  const blocked = [
    '0.0.0.0', '0.1.2.3',
    '10.0.0.1', '10.255.255.254',
    '100.64.0.1', '100.127.255.254',
    '127.0.0.1', '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1', '172.31.255.254',
    '192.168.0.1', '192.168.255.254',
    '224.0.0.1', '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ]
  for (const address of blocked) {
    assert.equal(isBlockedAddress(address), true, `${address} 必须拒`)
  }
  const allowed = ['93.184.216.34', '1.1.1.1', '8.8.8.8', '100.63.255.255', '172.32.0.1', '223.255.255.255']
  for (const address of allowed) {
    assert.equal(isBlockedAddress(address), false, `${address} 不该被拒`)
  }
})

test('D-5①v6 禁段：:: / ::1 / fc00::/7 / fe80::/10 / ff00::/8', () => {
  for (const address of [
    '::', '::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
  ]) {
    assert.equal(isBlockedAddress(address), true, `${address} 必须拒`)
  }
  assert.equal(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false)
})

test('D-5①IPv4-mapped / IPv4-compatible / 6to4 / Teredo：取内嵌 v4 再判', () => {
  // IPv4-mapped ::ffff:a.b.c.d —— 云元数据地址换个写法照样拒。
  assert.equal(isBlockedAddress('::ffff:169.254.169.254'), true)
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true)
  assert.equal(isBlockedAddress('::ffff:10.0.0.1'), true)
  // 十六进制写法的同一个地址（::ffff:a9fe:a9fe = 169.254.169.254）。
  assert.equal(isBlockedAddress('::ffff:a9fe:a9fe'), true)
  // IPv4-compatible ::a.b.c.d
  assert.equal(isBlockedAddress('::10.0.0.1'), true)
  // 6to4 2002:<v4>::/16 —— 2002:0a00:0001:: = 10.0.0.1
  assert.equal(isBlockedAddress('2002:0a00:0001::1'), true)
  // Teredo 2001:0000:… 末四字节按位取反 = 10.0.0.1 → f5ff:fffe
  assert.equal(isBlockedAddress('2001:0000:4136:e378:8000:63bf:f5ff:fffe'), true)
  // 内嵌的是公网 v4 时不拒（判定只跟着内嵌地址走）。
  assert.equal(isBlockedAddress('::ffff:93.184.216.34'), false)

  assert.deepEqual(embeddedIpv4(parseIpv6('::ffff:1.2.3.4')!), [1, 2, 3, 4])
  assert.equal(embeddedIpv4(parseIpv6('2606:2800:220::1')!), null)
})

test('地址串解析不出来 = 拒（fail closed）', () => {
  for (const address of ['', '   ', 'not-an-ip', '999.1.1.1', '1.2.3', '010.0.0.1', 'gg::1']) {
    assert.equal(isBlockedAddress(address), true, `${JSON.stringify(address)} 必须拒`)
  }
  assert.equal(parseIpv4('010.0.0.1'), null) // 前导零：说不准就拒
  assert.equal(parseIpv4('1.2.3.4.5'), null)
  assert.equal(parseIpv6('1::2::3'), null)
  assert.equal(isBlockedIpv4([10, 0, 0, 1]), true)
  assert.equal(isBlockedIpv6(parseIpv6('::1')!), true)
})

// ============================== DNS 那一段 ==============================

test('D-5①DNS rebinding 形态：公网主机名解析到私网地址 → private_address（本单的核心红测）', async () => {
  const guard = guardOf({
    'metadata.evil.example': ['169.254.169.254'],
    'inside.evil.example': ['10.1.2.3'],
    'loop.evil.example': ['127.0.0.1'],
    'mapped.evil.example': ['::ffff:169.254.169.254'],
    'mixed.evil.example': ['93.184.216.34', '192.168.1.1'],
    'good.example': ['93.184.216.34'],
  })
  for (const host of [
    'metadata.evil.example', 'inside.evil.example', 'loop.evil.example', 'mapped.evil.example',
  ]) {
    const verdict = await guard.check(`https://${host}/x`)
    assert.equal(verdict.allowed, false, host)
    assert.equal(verdict.reason, SSRF_REASONS.privateAddress, host)
  }
  // 多地址：**任一**命中即拒（不许"有一个公网地址就放行"）。
  const mixed = await guard.check('https://mixed.evil.example/')
  assert.equal(mixed.allowed, false)
  assert.equal(mixed.reason, SSRF_REASONS.privateAddress)

  const ok = await guard.check('https://good.example/page')
  assert.equal(ok.allowed, true)
  assert.equal(ok.reason, null)
  assert.equal(ok.host, 'good.example')
})

test('D-5①解析器抛 / 解析出零地址 → 拒（fail closed，不是"查不到就放行"）', async () => {
  const throwing = new SsrfGuard({ resolve: async () => { throw new Error('SERVFAIL') } })
  const thrown = await throwing.check('https://example.com/')
  assert.equal(thrown.allowed, false)
  assert.equal(thrown.reason, SSRF_REASONS.resolveFailed)

  const empty = new SsrfGuard({ resolve: async () => [] })
  const none = await empty.check('https://example.com/')
  assert.equal(none.allowed, false)
  assert.equal(none.reason, SSRF_REASONS.noAddress)
})

test('判定器只经构造函数注入解析器；没给就大声抛（配置面永远够不到它）', () => {
  assert.throws(
    () => new SsrfGuard({ resolve: undefined as unknown as () => Promise<string[]> }),
    /解析器必须经构造函数注入/,
  )
})

test('语法拒的四类根本不碰 DNS（拒得早、拒得便宜）', async () => {
  let calls = 0
  const guard = new SsrfGuard({ resolve: async () => { calls += 1; return ['93.184.216.34'] } })
  for (const url of [
    'file:///etc/passwd', 'http://example.com:8080/', 'http://127.0.0.1/', 'http://localhost/',
  ]) {
    const verdict = await guard.check(url)
    assert.equal(verdict.allowed, false, url)
  }
  assert.equal(calls, 0)
})
