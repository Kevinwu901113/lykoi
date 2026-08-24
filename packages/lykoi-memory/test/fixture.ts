/**
 * 写层测试共用夹具。
 *
 * 两条数据来源，两条纪律：
 * 1. 合成 fixture —— 表 DDL/索引/触发器单一来源在 `lykoi-memory/testing`
 *    （W2 TODO#5 收口：此前两包各持一份逐字 DDL，"两处同改"约定升级为单一出处；
 *    不含她的任何数据），保证触发器契约测试在 devstate 缺席的机器上也必跑；
 * 2. golden devstate —— `LYKOI_DEVSTATE_DB` 注入，**只许只读**；一切写测试先
 *    copy 进 os.tmpdir 的独立文件再 rw 打开，测试结束不回写；她的行内容零输出。
 */
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture, PY_ISO_RE } from '../src/testing.ts'

export { PY_ISO_RE }

export const DEVSTATE = process.env.LYKOI_DEVSTATE_DB
export const devstateSkip = DEVSTATE
  ? false
  : 'LYKOI_DEVSTATE_DB 未注入（devstate 副本缺席时 skip 不 fail）'

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-memory-rw-'))
}

/** golden devstate → os.tmpdir 独立副本（写测试唯一允许的打开对象）。 */
export function copyDevstate(): string {
  const dest = join(tmp(), 'devstate-copy.db')
  cpSync(DEVSTATE!, dest)
  return dest
}

/**
 * 合成 fixture：共享 schema（lykoi-memory/testing）+ 本包测试的最小播种
 * （一条 active 关切，供外键/related_concern_id 路径）。
 */
export function makeWritableFixture(): string {
  const path = join(tmp(), 'fixture.db')
  createStateFixture(path)
  const db = new DatabaseSync(path)
  db.exec(`
    INSERT INTO concerns (id, kind, title, description, weight, origin, status, created_at)
      VALUES (1, 'interest', 'fixture-concern', '', 0.5, 'seed', 'active', '2026-08-20T00:00:00+00:00');
  `)
  db.close()
  return path
}

/** 裸连接（测试断言/触发器红测直发 SQL 用）。 */
export function rawOpen(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  return db
}
