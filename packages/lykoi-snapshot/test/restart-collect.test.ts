/**
 * restart 线索生产采集器（M2 遗留 #8；SK-163 语义的新体对应物）。
 *
 * 全部纪律归结成一条：**采集失败 = 省略，绝不编造**（SA-164）。所以这份测试
 * 里失败路比成功路多 —— 每一种读不出来的方式都必须回 null 而不是回一个像样
 * 的假值。
 *
 * 零子进程：命令执行面是注入位（`RunCommand`），本文件一个 `git`/`systemctl`
 * 都不真跑。零真网。
 *
 * 时钟纪律：downtime 是 `now − 上次停机时刻`，两头**都由测试显式给**（固定 T0
 * 只用在全程显式传 now 的路径上 —— 本模块正是这样一条路径）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectDowntime, collectHead, collectInvocationId, collectRestartClues, recordDeployEvent,
  type RunCommand,
} from '../src/restart-collect.ts'

const HEAD = '174942a1b2c3d4e5f60718293a4b5c6d7e8f9012'
const T0 = new Date('2026-08-25T12:00:00Z') // 全程显式传入，从不当作"现在"

function events(): {
  log: (name: string, fields: Record<string, unknown>) => void
  rows: { name: string; fields: Record<string, unknown> }[]
} {
  const rows: { name: string; fields: Record<string, unknown> }[] = []
  return { log: (name, fields) => rows.push({ name, fields }), rows }
}

/** 命令替身：按 (file, args[前两个]) 查表；表里没有就抛。 */
function runner(table: Record<string, string>): RunCommand {
  return (file, args) => {
    const key = `${file} ${args.join(' ')}`
    const hit = Object.entries(table).find(([k]) => key.includes(k))
    if (!hit) throw new Error(`no such command: ${key}`)
    return hit[1]
  }
}

// ============================== git HEAD ==============================

test('HEAD：`git rev-parse HEAD` 读到 40 位 hex → 原样带上', () => {
  const head = collectHead({
    repoRoot: '/srv/lykoi-cordis', now: T0,
    run: runner({ 'rev-parse HEAD': `${HEAD}\n` }),
  })
  assert.equal(head, HEAD)
})

test('HEAD：git 不在 / 不是仓库 / 超时 → null + 一条说明是哪样读不到的遥测', () => {
  const ev = events()
  const head = collectHead({
    repoRoot: '/not/a/repo', now: T0,
    run: () => { throw new Error('ENOENT') },
    logEvent: ev.log,
  })
  assert.equal(head, null)
  assert.deepEqual(ev.rows, [{ name: 'restart_clue_unreadable', fields: { clue: 'head', reason: 'Error' } }])
})

test('HEAD：读到的**不是**一个 40 位 hex（错误提示、空串、短 sha）→ null，不当 HEAD 用', () => {
  for (const output of ['', 'fatal: not a git repository\n', '174942a\n', `${HEAD}extra\n`]) {
    const ev = events()
    const head = collectHead({
      repoRoot: '/srv', now: T0, run: runner({ 'rev-parse HEAD': output }), logEvent: ev.log,
    })
    assert.equal(head, null, JSON.stringify(output))
    assert.equal(ev.rows[0]!.fields.reason, 'unexpected_shape')
  }
})

// ============================== downtime ==============================

test('downtime：InactiveEnterTimestamp → 四档人话渲染（≥1 天只报天数，SA-163）', () => {
  const cases: [string, string][] = [
    ['2026-08-25T11:59:30Z', '30 秒'],
    ['2026-08-25T11:45:00Z', '15 分钟'],
    ['2026-08-25T08:30:00Z', '3 小时 30 分钟'],
    ['2026-08-22T04:00:00Z', '3 天'], // 3 天 8 小时 → 只报天数
  ]
  for (const [stoppedAt, expected] of cases) {
    const downtime = collectDowntime({
      repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
      run: runner({ 'InactiveEnterTimestamp': `${stoppedAt}\n` }),
    })
    assert.equal(downtime, expected, stoppedAt)
  }
})

test('downtime：单元名没给 → null（连问都不问）', () => {
  const ev = events()
  assert.equal(collectDowntime({ repoRoot: '/srv', now: T0, logEvent: ev.log }), null)
  assert.deepEqual(ev.rows, [], '没配就不是"读不到"，不该落遥测')
})

test('downtime：systemctl 读不到 → null', () => {
  const ev = events()
  const downtime = collectDowntime({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    run: () => { throw new Error('ENOENT') }, logEvent: ev.log,
  })
  assert.equal(downtime, null)
  assert.equal(ev.rows[0]!.fields.clue, 'downtime')
})

test('downtime：`n/a`（这个单元从没停过 = 第一次启动）→ null，不编一个"0 秒"', () => {
  const ev = events()
  const downtime = collectDowntime({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    run: runner({ 'InactiveEnterTimestamp': 'n/a\n' }), logEvent: ev.log,
  })
  assert.equal(downtime, null)
  assert.equal(ev.rows[0]!.fields.reason, 'never_stopped')
})

test('downtime：时间戳解析不出来 → null', () => {
  const ev = events()
  const downtime = collectDowntime({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    run: runner({ 'InactiveEnterTimestamp': 'Mon 2026-08-25 whenever\n' }), logEvent: ev.log,
  })
  assert.equal(downtime, null)
  assert.equal(ev.rows[0]!.fields.reason, 'unparsable_timestamp')
})

test('downtime：算出来是负的（钟被调过）→ null —— 一个负的停机时长是假事实', () => {
  const ev = events()
  const downtime = collectDowntime({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    run: runner({ 'InactiveEnterTimestamp': '2026-08-25T13:00:00Z\n' }), // 比 now 还晚
    logEvent: ev.log,
  })
  assert.equal(downtime, null)
  assert.equal(ev.rows[0]!.fields.reason, 'negative_interval')
})

// ============================== invocation id ==============================

test('invocation id：env 有就带上，空串/缺席 → null', () => {
  assert.equal(collectInvocationId({ INVOCATION_ID: 'abc123' }), 'abc123')
  assert.equal(collectInvocationId({ INVOCATION_ID: '' }), null)
  assert.equal(collectInvocationId({}), null)
})

// ============================== 三条一起 ==============================

test('三条一次采齐：成功路三样都在', () => {
  const clues = collectRestartClues({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    run: runner({
      'rev-parse HEAD': `${HEAD}\n`,
      'InactiveEnterTimestamp': '2026-08-25T11:00:00Z\n',
    }),
  })
  assert.equal(clues.head, HEAD)
  // 整 3600 秒落在"小时"档（`seconds < 3600` 是严格小于）——四档边界照 restart.ts 逐字。
  assert.equal(clues.downtime, '1 小时 0 分钟')
})

test('SA-164 全断路：三样全读不到 → 三个 null（她照样醒来，只是知道得少一点）', () => {
  const clues = collectRestartClues({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    run: () => { throw new Error('nothing works here') },
  })
  assert.deepEqual({ head: clues.head, downtime: clues.downtime }, { head: null, downtime: null })
  // 关键断言：没有任何一样被填成了"看起来像真的"的值。
  assert.equal(JSON.stringify(clues).includes('unknown'), false)
  assert.equal(JSON.stringify(clues).includes('0 秒'), false)
})

// ============================== deploy event ==============================

test('deploy_event：`record_deploy_event(unit=…)` 的新体对应物 —— 一条遥测，不进她的 history', () => {
  const ev = events()
  recordDeployEvent({
    repoRoot: '/srv', unit: 'lykoi-cordis', now: T0,
    clues: { head: HEAD, downtime: '60 分钟', invocationId: 'abc123' },
    logEvent: ev.log,
  })
  assert.deepEqual(ev.rows, [{
    name: 'deploy_event',
    fields: { unit: 'lykoi-cordis', head: HEAD, invocation_id: 'abc123', downtime: '60 分钟' },
  }])
})

test('deploy_event：线索缺席就记 null（同一条纪律，不编造）', () => {
  const ev = events()
  recordDeployEvent({
    repoRoot: '/srv', now: T0,
    clues: { head: null, downtime: null, invocationId: null },
    logEvent: ev.log,
  })
  assert.deepEqual(ev.rows[0]!.fields, { unit: null, head: null, invocation_id: null, downtime: null })
})
