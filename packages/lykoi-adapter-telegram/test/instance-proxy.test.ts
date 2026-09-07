import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInstanceProxy } from '../src/production.ts'

function fixture(text?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'proxy-instance-'))
  if (text !== undefined) writeFileSync(join(dir, 'deploy.toml'), text)
  return join(dir, 'persona.toml')
}

test('instance哨兵从同目录deploy.toml读取Telegram代理；不需要seeds文件', () => {
  const proxy = 'http://192.0.2.10:7890'
  assert.equal(resolveInstanceProxy({ proxy: 'instance', personaToml: fixture(`[telegram]\nproxy = "${proxy}"\n`) }), proxy)
})

test('instance缺文件、缺值、错误消费者、损坏或非法URL全部拒起且不回显值', () => {
  for (const text of [undefined, '', '[browser]\nproxy = "http://192.0.2.10:7890"', '[telegram]\nproxy = ""', '[telegram]\nproxy = 123', '[telegram]\nproxy = "PRIVATE_BAD_URL"', 'PRIVATE_BAD_TOML']) {
    assert.throws(() => resolveInstanceProxy({ proxy: 'instance', personaToml: fixture(text) }),
      (err: Error) => err.message.includes('deploy.toml') && !err.message.includes('PRIVATE_BAD'))
  }
  assert.throws(() => resolveInstanceProxy({ proxy: 'instance' }), /deploy.toml/)
})

test('非instance代理原样保留，直连也不读取无关实例文件', () => {
  const personaToml = fixture('BROKEN')
  for (const proxy of ['', 'http://192.0.2.10:7890']) assert.equal(resolveInstanceProxy({ proxy, personaToml }), proxy)
})
