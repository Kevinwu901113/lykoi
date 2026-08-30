/**
 * GK-6 env 钉面全表（DK-10「env 钉面不对称」的收紧落法）跑在**真仓库**上。
 *
 * 这份测试同时是报告里那张「钉面全表」的可执行版本：条数、分类、以及
 * 「源码里读到的每一个 LYKOI_* 都被钉住」这条覆盖性断言。
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { ENV_PINS, scanEnvReads } from '../src/surface.ts'
import { checkEnvPins, productionEnv } from '../src/verify.ts'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

test('GK-6 钉面全表：22 条 = 路径 13 + 旋钮 7 + unset 1 + secret 1', () => {
  const byKind = (kind: string): string[] =>
    ENV_PINS.filter((p) => p.kind === kind).map((p) => p.name)

  assert.equal(ENV_PINS.length, 22)
  assert.deepEqual(byKind('path'), [
    // W1 治理三路（活体只钉了第一条）
    'LYKOI_APPROVAL_RULES', 'LYKOI_STANDING_GRANTS', 'LYKOI_PENDING_ACTIONS',
    // 审计 sink + 人格（活体逐字另两条）
    'LYKOI_AUDIT_PATH', 'LYKOI_PERSONA_TOML',
    // 通知 / 主动开口
    'LYKOI_NOTIFICATIONS', 'LYKOI_PROACTIVE_CHAT_LEDGER',
    // W3 出站（六路里的五条路径；第六条是代理，unset 类）
    'LYKOI_CHAT_OUTBOX', 'LYKOI_TELEGRAM_UNDELIVERED', 'LYKOI_TELEGRAM_OUTBOX_CURSOR',
    'LYKOI_MESSENGER_LEDGER', 'LYKOI_MESSENGER_TRANSPORT_LOG',
    // 感知输入
    'LYKOI_SALIENCE_DB',
  ])
  assert.deepEqual(byKind('unset'), ['LYKOI_TELEGRAM_PROXY'])
  assert.deepEqual(byKind('secret'), ['LYKOI_TELEGRAM_BOT_TOKEN'])
  assert.equal(byKind('knob').length, 7)
})

test('GK-6 相对活体的收紧面：活体只钉三条，新体钉全部', () => {
  const live = ['LYKOI_APPROVAL_RULES', 'LYKOI_PERSONA_TOML', 'LYKOI_AUDIT_PATH']
  const names = ENV_PINS.map((p) => p.name)
  for (const name of live) assert.equal(names.includes(name), true, `活体那三条不许丢：${name}`)
  assert.equal(ENV_PINS.length > live.length, true)
  // 新体新钉的那 19 条里，W1 两条与 W3 六条是 TODO 台账点名要的。
  for (const name of [
    'LYKOI_STANDING_GRANTS', 'LYKOI_PENDING_ACTIONS', // W1#4
    'LYKOI_CHAT_OUTBOX', 'LYKOI_TELEGRAM_UNDELIVERED', 'LYKOI_TELEGRAM_OUTBOX_CURSOR',
    'LYKOI_MESSENGER_LEDGER', 'LYKOI_MESSENGER_TRANSPORT_LOG', 'LYKOI_TELEGRAM_PROXY', // W3#5
  ]) {
    assert.equal(names.includes(name), true, name)
  }
})

test('钉面覆盖全：源码里读到的每一个 LYKOI_* 都在表里（算出来的，不是抄的）', () => {
  const read = scanEnvReads(REPO_ROOT)
  const pinned = new Set(ENV_PINS.map((p) => p.name))
  const unpinned = [...read].filter((n) => !pinned.has(n)).sort()
  assert.deepEqual(unpinned, [], `有治理 env 面没被钉：${unpinned.join(', ')}`)
  // 反过来：表里也不该有源码根本不读的幽灵条目（钉一个不存在的变量是虚假安全感）。
  const ghosts = [...pinned].filter((n) => !read.has(n)).sort()
  assert.deepEqual(ghosts, [], `钉面里有幽灵条目：${ghosts.join(', ')}`)
})

test('真仓库 + 干净环境：钉面检查项全绿（未设 = 走已签名的缺省）', () => {
  const problems: string[] = []
  checkEnvPins({ ...productionEnv(REPO_ROOT), environ: {} }, problems)
  assert.deepEqual(problems, [])
})

test('每条钉都有 owner 说明（失败信息要能让人知道这钉的是谁的什么）', () => {
  for (const pin of ENV_PINS) {
    assert.equal(pin.owner.length > 0, true, pin.name)
    assert.equal(pin.kind === 'path' ? pin.canonical !== null : pin.canonical === null, true, pin.name)
  }
})
