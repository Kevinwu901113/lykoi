/**
 * 器官清单渲染（SA-160/161）：块结构逐字、空态不注入、未登记前缀兜底、
 * 硬门标注、四禁的输入面证据（channel_key 不存在于行类型/输出）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BLOCK_HEADER,
  organBlockFromInventory,
  renderOrganInventory,
  type OrganInventoryInput,
} from '../src/index.ts'

const EMPTY: OrganInventoryInput = {
  bindings: [],
  knownActions: [],
  isHardGated: () => false,
}

test('空清单 → 空串；organBlockFromInventory → null（空态不注入，SA-160）', () => {
  assert.equal(renderOrganInventory(EMPTY), '')
  assert.equal(organBlockFromInventory(EMPTY), null)
})

test('完整清单：头 + 导语 + 绑定节 + 通道节 + 动作节逐字', () => {
  const input: OrganInventoryInput = {
    bindings: [
      { channel: 'telegram', role: 'owner_primary', display_name: 'Kevin', user_id: 'user_001' },
      { channel: 'telegram', role: 'group_member', display_name: null, user_id: 'user_002' },
      { channel: 'matrix', role: 'weird_role', display_name: null, user_id: null },
    ],
    knownActions: [
      'notify.send', 'browser.navigate', 'browser.click', 'messenger.send_text', 'standalone',
    ],
    isHardGated: (a) => a === 'messenger.send_text',
  }
  const text = renderOrganInventory(input)
  const expected = [
    '[器官清单(只读)]',
    '下面是你此刻实际长着的部件 —— 从代码和登记处派生出来的, 不是谁告诉你的, '
    + '也不是你记得的。要判断「我能不能做某件事」, 以这里为准。',
    '',
    '身份绑定:',
    '- telegram: Kevin — 所有者, 也是你的主用户',
    '- telegram: user_002 — 群聊成员',
    '- matrix: (无名) — weird_role', //        未登记角色兜底显示原值
    '',
    '设备/通道(已登记的):',
    '- telegram(2 条绑定)',
    '- matrix(1 条绑定)',
    '',
    '动作能力(代码里实际接得通的全部):',
    '- 浏览器(她自己的, 带登录态): browser.click、browser.navigate',
    '- IM 收发(她的社交躯体): messenger.send_text, 其中每次都要 Kevin 点头的: messenger.send_text',
    '- 给 Kevin 的通知: notify.send',
    '- standalone: standalone', //             未登记前缀不丢弃：清单自己会长
  ].join('\n')
  assert.equal(text, expected)
  assert.ok(text.startsWith(BLOCK_HEADER))
})

test('只有动作、没有绑定：绑定节整体缺席', () => {
  const text = renderOrganInventory({
    ...EMPTY,
    knownActions: ['terminal.run'],
  })
  assert.ok(!text.includes('身份绑定'))
  assert.ok(text.includes('- 终端: terminal.run'))
})

test('只有绑定、动作为零：动作节（仅表头）不值得占一个块', () => {
  const text = renderOrganInventory({
    ...EMPTY,
    bindings: [{ channel: 'telegram', role: 'owner_primary', display_name: 'K', user_id: 'u' }],
  })
  assert.ok(text.includes('身份绑定'))
  assert.ok(!text.includes('动作能力'))
})

test('四禁之 1（SA-161）：channel_key 不在输出面（行类型上就没有该字段）', () => {
  // 即使调用方硬塞 channel_key，渲染器也不读它 —— 输出零出现
  const rows = [{
    channel: 'telegram', role: 'owner_primary', display_name: 'Kevin', user_id: 'u',
    channel_key: '-100987654321',
  }]
  const text = renderOrganInventory({ ...EMPTY, bindings: rows })
  assert.ok(!text.includes('-100987654321'))
  assert.ok(!text.includes('channel_key'))
})
