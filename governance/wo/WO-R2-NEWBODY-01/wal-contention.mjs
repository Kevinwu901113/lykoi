#!/usr/bin/env node
/**
 * WO-R2-NEWBODY-01 D-3 · WAL vs DELETE 写等待测量（临时库，不碰产线）。
 *
 * 问题：R2 前置 3 问的是"一具身体上多条推演分支并行读时，写方要等多久"。
 * 做法：同一个临时库分别建成 DELETE 与 WAL 两种 journal_mode，各跑一次：
 *   - 读方连接：BEGIN → SELECT → 事务保持打开
 *   - 写方连接：在读事务仍打开时 INSERT，busy_timeout=BUSY_MS
 *   记录写方从发起到返回（成功或超时失败）的墙钟毫秒数。
 *
 * node:sqlite 是同步 API，无法让读方"在写方等待期间"提交，所以这里测的是
 * 确定性事实：读事务打开时写方是否被挡、挡多久。这正是 R2 要的读数——
 * DELETE 模式下并行读会把写方顶到 busy_timeout 用尽；WAL 下读写不互斥。
 *
 * 只用 node:sqlite（Node ≥ 24 内置），零依赖。库建在 os.tmpdir() 下，跑完删。
 * 用法：node governance/wo/WO-R2-NEWBODY-01/wal-contention.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BUSY_MS = 10_000 // 写方 busy_timeout

function measure(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wal-'))
  const path = join(dir, 'probe.db')
  try {
    const setup = new DatabaseSync(path)
    setup.exec(`PRAGMA journal_mode = ${mode};`)
    const actual = setup.prepare('PRAGMA journal_mode;').get().journal_mode
    setup.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);')
    setup.exec("INSERT INTO t (v) VALUES ('seed');")
    setup.close()

    const reader = new DatabaseSync(path)
    reader.exec(`PRAGMA busy_timeout = ${BUSY_MS};`)
    const writer = new DatabaseSync(path)
    writer.exec(`PRAGMA busy_timeout = ${BUSY_MS};`)

    reader.exec('BEGIN;')
    reader.prepare('SELECT * FROM t;').all() // 读事务成立并保持打开

    const t0 = process.hrtime.bigint()
    let outcome
    try {
      writer.exec("INSERT INTO t (v) VALUES ('contended');")
      outcome = 'ok'
    } catch (err) {
      outcome = `blocked:${err.code ?? err.message}`
    }
    const waitedMs = Number(process.hrtime.bigint() - t0) / 1e6

    reader.exec('COMMIT;')
    reader.close()
    writer.close()
    return { mode: actual, outcome, waitedMs: waitedMs.toFixed(1) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const r of [measure('delete'), measure('wal')]) {
  console.log(`journal_mode=${r.mode}\twrite_during_open_read=${r.outcome}\twaited_ms=${r.waitedMs}`)
}
console.log(`\n参数：写方 busy_timeout=${BUSY_MS} ms；读事务在写方发起时保持打开。`)
console.log('读法：DELETE 下写方被挡到 busy_timeout 用尽后失败；WAL 下写方立即成功。')
