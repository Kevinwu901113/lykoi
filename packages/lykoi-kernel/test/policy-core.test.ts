/**
 * policy core TS 对应物 —— guardian-live-20260825/policy_core.py 逐字对拍
 * （三表 + PROTECTED_PATHS + 两旋钮；GK-12 结构测试）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTONOMOUS_ALLOWED, HARD_ASK_TYPES, HARD_DENY_TYPES, PROTECTED_PATHS,
  capabilityProfile, hardDecision,
} from '../src/index.ts'

test('HARD_ASK_TYPES 逐字 = {terminal.exec, delegation.dispatch}（活体取证 SK-68）', () => {
  assert.deepEqual(new Set(HARD_ASK_TYPES), new Set(['terminal.exec', 'delegation.dispatch']))
})

test('HARD_DENY_TYPES 逐字 = ∅（保留位）', () => {
  assert.equal(HARD_DENY_TYPES.size, 0)
})

test('AUTONOMOUS_ALLOWED 8 项逐字全序（guardian-live 正本；DK-02 闭合：不存在第 9 项）', () => {
  // 插入序 = guardian 文件书写序；Set 迭代保序，逐位断言。
  assert.deepEqual([...AUTONOMOUS_ALLOWED], [
    'research_browser.open',
    'research_browser.read_text',
    'research_browser.extract_links',
    'research_browser.screenshot',
    'autonomy.queue_notification',
    'autonomy.initiate_chat',
    'messenger.send',
    'messenger.read',
  ])
  assert.equal(AUTONOMOUS_ALLOWED.size, 8)
})

test('GK-12：messenger.send ∈ AUTONOMOUS_ALLOWED —— 建议问答机的承重依赖显式钉死', () => {
  // W3 的建议问答机 _send 走 origin=autonomous 的 messenger.send（S-52）；这条
  // 白名单成员资格是它能开口的**结构前提**。谁要缩这张表，先撞这条测试。
  assert.ok(AUTONOMOUS_ALLOWED.has('messenger.send'))
  assert.equal(capabilityProfile('autonomous', 'messenger.send'), 'allow')
})

test('PROTECTED_PATHS：活体两条**逐字保全**（一个字节没动）', () => {
  // W1 立的这条断言在 W4 之后仍旧成立 —— GK-13 重划只**追加**，不改不删。
  // 第二条（旧体 guardian）尤其不许删：M4 切换窗新旧体同机共存（R-01），
  // 旧体的 guardian 在那段时间必须照旧不可达，直到 CORE-RETIRE 落定。
  assert.equal(PROTECTED_PATHS[0], '/home/lykoi/secrets')
  assert.equal(PROTECTED_PATHS[1], '/home/lykoi/projects/lykoi/guardian')
})

test('PROTECTED_PATHS：W4 GK-13 重划追加第三条 = 新体完整性门源目录', () => {
  assert.deepEqual([...PROTECTED_PATHS], [
    '/home/lykoi/secrets',
    '/home/lykoi/projects/lykoi/guardian',
    '/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate',
  ])
  // 「guardian 自身不可达」这条禁区在 CF-B2 退役后的新住址（DK-05）。
  // 判定函数本体与 realpath 语义见 test/path-guard.test.ts。
})

test('hardDecision：deny 表 > ask 表 > null（defer to live rules）', () => {
  assert.equal(hardDecision('terminal.exec'), 'ask')
  assert.equal(hardDecision('delegation.dispatch'), 'ask')
  assert.equal(hardDecision('messenger.send'), null)
  assert.equal(hardDecision('browser.navigate'), null)
})

test('capabilityProfile：只约束 autonomous；白名单内 allow、其余 deny；其它 origin null', () => {
  assert.equal(capabilityProfile('autonomous', 'research_browser.open'), 'allow')
  assert.equal(capabilityProfile('autonomous', 'terminal.exec'), 'deny')
  assert.equal(capabilityProfile('autonomous', 'browser.navigate'), 'deny')
  assert.equal(capabilityProfile('autonomous', 'delegation.dispatch'), 'deny')
  assert.equal(capabilityProfile('interactive', 'terminal.exec'), null)
  assert.equal(capabilityProfile('system', 'browser.navigate'), null)
})
