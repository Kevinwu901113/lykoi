import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDeploymentProxy } from '../src/production.ts'

function fixture(text?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'proxy-instance-'))
  if (text !== undefined) writeFileSync(join(dir, 'deploy.toml'), text)
  return join(dir, 'deploy.toml')
}

test('deployment 指定独立文件读取 Telegram 代理；不需要角色目录', () => {
  const proxy = 'http://192.0.2.10:7890'
  assert.equal(resolveDeploymentProxy({ proxy: 'deployment', deploymentFile: fixture(`[telegram]\nproxy = "${proxy}"\n`) }), proxy)
})

test('deployment 缺文件、缺值、错误消费者、损坏或非法URL全部拒起且不回显值', () => {
  for (const text of [undefined, '', '[browser]\nproxy = "http://192.0.2.10:7890"', '[telegram]\nproxy = ""', '[telegram]\nproxy = 123', '[telegram]\nproxy = "PRIVATE_BAD_URL"', 'PRIVATE_BAD_TOML']) {
    assert.throws(() => resolveDeploymentProxy({ proxy: 'deployment', deploymentFile: fixture(text) }),
      (err: Error) => err.message.includes('deploy.toml') && !err.message.includes('PRIVATE_BAD'))
  }
  assert.throws(() => resolveDeploymentProxy({ proxy: 'deployment' }), /deploy.toml/)
})

test('非 deployment 代理原样保留，直连不读取无关部署文件', () => {
  const deploymentFile = fixture('BROKEN')
  for (const proxy of ['', 'http://192.0.2.10:7890']) assert.equal(resolveDeploymentProxy({ proxy, deploymentFile }), proxy)
})
